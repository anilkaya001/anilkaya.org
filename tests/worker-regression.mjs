import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { COURSE_TOPICS, SITE_ORIGIN } from "../shared/course-seo.js";
import { applyMastery } from "../shared/mastery.js";
import { signSession } from "../shared/session.js";
import { REPO_ROOT, SESSION_SECRET, startWorker } from "./worker-server.mjs";

const server = await startWorker();
const base = server.baseURL;
const assetVersion = (await readFile(path.join(REPO_ROOT, "assets/version.txt"), "utf8")).trim();
const securityHeaders = [
  "strict-transport-security", "x-content-type-options", "referrer-policy",
  "x-frame-options", "cross-origin-opener-policy", "permissions-policy",
  "x-permitted-cross-domain-policies",
];

const decode = (value) => String(value).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const attr = (html, selector, name = "content") => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = html.match(new RegExp(`<[^>]+${escaped}[^>]*>`, "i"));
  if (!tag) return null;
  const value = tag[0].match(new RegExp(`${name}="([^"]*)"`, "i"));
  return value ? decode(value[1]) : null;
};

function assertSecurity(response, html = false) {
  for (const name of securityHeaders) assert(response.headers.get(name), `${name} missing on ${response.url}`);
  assert.equal(!!response.headers.get("content-security-policy"), html, `CSP scope wrong on ${response.url}`);
}

async function json(response, status) {
  assert.equal(response.status, status, `${response.url}: unexpected status`);
  assert.match(response.headers.get("content-type") || "", /^application\/json\b/, `${response.url}: expected JSON`);
  assert.equal(response.headers.get("cache-control"), "no-store", `${response.url}: API must not cache`);
  assertSecurity(response, false);
  return response.json();
}

async function learningJSON(response, status, generation) {
  assert.equal(
    response.headers.get("x-iewt-generation"),
    String(generation),
    `${response.url}: sync generation header`,
  );
  const body = await json(response, status);
  assert.equal(body.generation, generation, `${response.url}: sync generation body`);
  return body;
}

try {
  const root = await fetch(base + "/");
  assert.equal(root.status, 200);
  assert.equal(root.headers.get("cache-control"), "no-cache");
  assert.equal(root.headers.get("clear-site-data"), '"cache"');
  assert.match(root.headers.get("set-cookie") || "", /cachefix=1/);
  assertSecurity(root, true);
  assert.match(root.headers.get("content-security-policy") || "", /https:\/\/static\.cloudflareinsights\.com/, "CSP must allow Cloudflare Web Analytics");
  assert.match(await root.text(), /In Econometrics We Trust/);

  const repeat = await fetch(base + "/", { headers: { Cookie: "cachefix=1" } });
  assert.equal(repeat.headers.get("clear-site-data"), null, "cache purge must happen once per browser");

  const css = await fetch(base + `/assets/css/base.css?v=${assetVersion}`);
  assert.equal(css.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const cssEtag = css.headers.get("etag");
  assertSecurity(css, false);
  const localCSS = await readFile(path.join(REPO_ROOT, "assets/css/base.css"), "utf8");
  assert.equal(await css.text(), localCSS, "response cloning changed CSS bytes");
  assert(cssEtag, "versioned asset ETag missing");
  const revalidatedCSS = await fetch(base + `/assets/css/base.css?v=${assetVersion}`, { headers: { "If-None-Match": cssEtag } });
  assert.equal(revalidatedCSS.status, 304);
  assert.equal(revalidatedCSS.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assertSecurity(revalidatedCSS, false);

  const unversioned = await fetch(base + "/assets/css/base.css");
  assert.equal(unversioned.headers.get("cache-control"), "public, max-age=3600");
  assertSecurity(unversioned, false);
  for (const asset of [`/assets/js/nav.js?v=${assetVersion}`, `/assets/fonts/LM-regular.woff2?v=${assetVersion}`, "/assets/img/og.png"]) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200, `${asset}: missing`);
    assertSecurity(response, false);
  }
  const missing = await fetch(base + "/definitely-missing");
  assert.equal(missing.status, 404);
  assertSecurity(missing, true);
  const missingVersioned = await fetch(base + `/definitely-missing.js?v=${assetVersion}`);
  assert.equal(missingVersioned.status, 404);
  assert.notEqual(missingVersioned.headers.get("cache-control"), "public, max-age=31536000, immutable");
  for (const privatePath of ["/.wrangler/cache/cf.json", "/articles/_template/", "/CNAME"]) {
    assert.equal((await fetch(base + privatePath)).status, 404, `${privatePath} must not be a public asset`);
  }

  const robots = await fetch(base + "/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type") || "", /^text\/plain\b/);
  assert.equal((await robots.text()).trim(), "User-agent: *\nAllow: /\n\nSitemap: https://anilkaya.org/sitemap.xml");

  const sitemapResponse = await fetch(base + "/sitemap.xml");
  assert.equal(sitemapResponse.status, 200);
  assert.match(sitemapResponse.headers.get("content-type") || "", /xml/i);
  const sitemap = await sitemapResponse.text();
  const sitemapURLs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(sitemapURLs, [
    SITE_ORIGIN + "/", SITE_ORIGIN + "/lab/", SITE_ORIGIN + "/lab/review/", ...COURSE_TOPICS.map((topic) => SITE_ORIGIN + topic.path),
  ]);
  for (const canonicalURL of sitemapURLs) {
    const path = new URL(canonicalURL).pathname;
    const response = await fetch(base + path, { headers: { Cookie: "cachefix=1" } });
    assert.equal(response.status, 200, `${path}: sitemap URL must return 200`);
    const html = await response.text();
    assert.equal(attr(html, 'rel="canonical"', "href"), canonicalURL, `${path}: sitemap URL must self-canonicalize`);
    assert(!/content="[^"]*noindex/i.test(html), `${path}: sitemap URL must not be noindex`);
  }

  const articles = await fetch(base + "/articles/", { headers: { Cookie: "cachefix=1" } });
  assert.equal(articles.status, 200);
  const articlesHTML = await articles.text();
  assert.equal(attr(articlesHTML, 'name="robots"'), "noindex,follow");
  assert.equal(attr(articlesHTML, 'rel="canonical"', "href"), SITE_ORIGIN + "/articles/");
  assert(!sitemap.includes("/articles/"), "noindexed Articles placeholder must not be in sitemap");

  for (const unknown of ["/lab/not-a-course", "/lab/not-a-course/"]) {
    const response = await fetch(base + unknown);
    assert.equal(response.status, 404, `${unknown}: unknown clean slug must be a 404`);
    const html = await response.text();
    assert.equal(attr(html, 'name="robots"'), "noindex", `${unknown}: 404 must be noindex`);
    assert.equal(attr(html, 'rel="canonical"', "href"), null, `${unknown}: 404 must not canonicalize`);
    const head = await fetch(base + unknown, { method: "HEAD" });
    assert.equal(head.status, 404, `${unknown}: HEAD status`);
    assert.equal(await head.text(), "", `${unknown}: HEAD body must be empty`);
  }

  for (const topic of COURSE_TOPICS) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(base + `/lab/course?m=${topic.id}`, { method, redirect: "manual" });
      assert.equal(response.status, 308, `${topic.id} ${method}: legacy course redirect`);
      assert.equal(response.headers.get("location"), base + topic.path);
      if (method === "HEAD") assert.equal(await response.text(), "", `${topic.id}: HEAD redirect body must be empty`);
    }
  }

  for (const legacy of [
    "/lab/course.html?m=ols", "/lab/course/?m=ols",
    "/lab/lesson?m=ols", "/lab/lesson.html?m=ols", "/lab/lesson/?m=ols",
  ]) {
    const response = await fetch(base + legacy, { redirect: "manual" });
    assert.equal(response.status, 308, `${legacy}: expected permanent canonical redirect`);
    assert.equal(response.headers.get("location"), base + "/lab/ordinary-least-squares/");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assertSecurity(response, false);
  }

  for (const missingTopic of ["/lab/course", "/lab/course?m=unknown", "/lab/course?m=constructor", "/lab/lesson?m=unknown"]) {
    const response = await fetch(base + missingTopic, { redirect: "manual" });
    assert.equal(response.status, 308, `${missingTopic}: generic course shell must not be indexable`);
    assert.equal(response.headers.get("location"), base + "/lab/");
  }

  for (const topic of COURSE_TOPICS) {
    const noSlash = await fetch(base + topic.path.slice(0, -1), { redirect: "manual" });
    assert.equal(noSlash.status, 308, `${topic.id}: missing-slash URL must canonicalize`);
    assert.equal(noSlash.headers.get("location"), base + topic.path);

    const response = await fetch(base + topic.path + "?utm_source=regression", { headers: { Cookie: "cachefix=1" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(response.headers.get("etag"), null, `${topic.id}: backing ETag leaked after rewrite`);
    assertSecurity(response, true);
    const html = await response.text();
    const pageText = decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
    assert.equal(decode(html.match(/<title>([^<]+)<\/title>/)?.[1]), topic.pageTitle, `${topic.id}: title`);
    assert.equal(attr(html, 'name="description"'), topic.description, `${topic.id}: description`);
    assert.equal(attr(html, 'rel="canonical"', "href"), SITE_ORIGIN + topic.path, `${topic.id}: canonical`);
    assert.equal(attr(html, 'property="og:url"'), SITE_ORIGIN + topic.path, `${topic.id}: og:url`);
    assert.equal(attr(html, 'property="og:site_name"'), "Anıl Kaya", `${topic.id}: site name`);
    assert.equal(attr(html, 'property="og:image"'), SITE_ORIGIN + topic.image, `${topic.id}: image`);
    assert.equal(attr(html, 'name="twitter:image"'), SITE_ORIGIN + topic.image, `${topic.id}: Twitter image`);
    assert.match(html, new RegExp(`<h1>${topic.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "&amp;")}</h1>`), `${topic.id}: raw HTML H1`);
    for (const module of topic.modules) assert(pageText.includes(module.title), `${topic.id}: missing crawlable module ${module.title}`);
    for (const related of COURSE_TOPICS.filter((item) => item.id !== topic.id)) {
      assert(html.includes(`href="${related.path}"`), `${topic.id}: missing related link to ${related.id}`);
    }
    const script = html.match(/<script id="courseStructuredData" type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert(script, `${topic.id}: structured data missing`);
    const structured = JSON.parse(script);
    assert.deepEqual(structured["@graph"].map((entry) => entry["@type"]), ["Course", "BreadcrumbList"]);
    assert.equal(structured["@graph"][0]["@id"], SITE_ORIGIN + topic.path);
    assert.equal(structured["@graph"][0].url, SITE_ORIGIN + topic.path);
    assert.equal(structured["@graph"][0].educationalLevel, topic.level, `${topic.id}: education level`);
    assert.equal(structured["@graph"][0].provider["@id"], SITE_ORIGIN + "/#person", `${topic.id}: provider ID`);
    assert.equal(structured["@graph"][0].provider.url, SITE_ORIGIN + "/", `${topic.id}: provider URL`);
    assert.deepEqual(
      structured["@graph"][1].itemListElement.map((item) => item.item),
      [SITE_ORIGIN + "/", SITE_ORIGIN + "/lab/", SITE_ORIGIN + topic.path],
      `${topic.id}: breadcrumb URLs`,
    );

    const head = await fetch(base + topic.path, { method: "HEAD", headers: { Cookie: "cachefix=1" } });
    assert.equal(head.status, 200, `${topic.id}: HEAD status`);
    assert.equal(await head.text(), "", `${topic.id}: HEAD body must be empty`);
  }

  const conditionalCourse = await fetch(base + COURSE_TOPICS[0].path, { headers: { "If-None-Match": '"backing-asset-validator"', Cookie: "cachefix=1" } });
  assert.equal(conditionalCourse.status, 200, "rewritten metadata must not use the backing asset validator");
  assert.equal(conditionalCourse.headers.get("etag"), null);
  assert.match(await conditionalCourse.text(), /<title>Ordinary Least Squares — Econometrics Lab<\/title>/);

  assert.deepEqual(await json(await fetch(base + "/api/me", { headers: { Cookie: "session=%" } }), 200), { user: null });
  const method = await fetch(base + "/api/me", { method: "POST" });
  const methodBody = await json(method, 405);
  assert.equal(method.headers.get("allow"), "GET");
  assert.equal(methodBody.error.code, "method_not_allowed");
  assert.equal((await json(await fetch(base + "/api/progress"), 401)).error.code, "unauthorized");
  assert.equal((await json(await fetch(base + "/api/mastery"), 401)).error.code, "unauthorized");
  const progressMethod = await fetch(base + "/api/progress", { method: "POST" });
  assert.equal((await json(progressMethod, 405)).error.code, "method_not_allowed");
  assert.equal(progressMethod.headers.get("allow"), "GET, PUT, DELETE");
  const statsMethod = await fetch(base + "/api/stats", { method: "DELETE" });
  assert.equal((await json(statsMethod, 405)).error.code, "method_not_allowed");
  assert.equal(statsMethod.headers.get("allow"), "GET, PUT");
  const masteryMethod = await fetch(base + "/api/mastery", { method: "DELETE" });
  assert.equal((await json(masteryMethod, 405)).error.code, "method_not_allowed");
  assert.equal(masteryMethod.headers.get("allow"), "GET, PUT");
  assert.equal((await json(await fetch(base + "/api/progress", { method: "DELETE" }), 401)).error.code, "unauthorized");
  assert.equal((await json(await fetch(base + "/api/not-a-route"), 404)).error.code, "not_found");

  const authStart = await fetch(base + "/auth/google", { redirect: "manual" });
  assert.equal(authStart.status, 302);
  assert.equal(authStart.headers.get("cache-control"), "no-store");
  assert.match(authStart.headers.get("location") || "", /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.match(authStart.headers.get("set-cookie") || "", /oauth_state=/);
  assertSecurity(authStart, false);
  const badCallback = await fetch(base + "/auth/callback?code=x&state=wrong", { redirect: "manual" });
  assert.equal(badCallback.status, 302);
  assert.equal(badCallback.headers.get("location"), base + "/lab/?auth=error");

  const logoutGet = await fetch(base + "/auth/logout", { redirect: "manual" });
  assert.equal((await json(logoutGet, 405)).error.code, "method_not_allowed");
  assert.equal(logoutGet.headers.get("allow"), "POST");

  const session = await signSession({ sub: "g_test", email: "test@example.com", name: "Test", exp: Date.now() + 60000 }, SESSION_SECRET);
  const authWithoutGeneration = {
    Cookie: `session=${session}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
    "X-IEWT-Owner": "g_test",
  };
  const auth = { ...authWithoutGeneration, "X-IEWT-Generation": "0" };
  const crossOriginLogout = await json(await fetch(base + "/auth/logout", {
    method: "POST",
    headers: { ...auth, Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
  }), 403);
  assert.equal(crossOriginLogout.error.code, "forbidden", "cross-site sign-out must be rejected");
  const staleOwnerLogout = await json(await fetch(base + "/auth/logout", {
    method: "POST",
    headers: { ...auth, "X-IEWT-Owner": "g_other" },
  }), 409);
  assert.equal(staleOwnerLogout.error.code, "account_changed", "stale tabs must not sign out a new account");
  const logout = await fetch(base + "/auth/logout", { method: "POST", headers: auth });
  assert.deepEqual(await json(logout, 200), { ok: true });
  assert.match(logout.headers.get("set-cookie") || "", /session=;.*Max-Age=0/, "sign-out must clear the session cookie");

  // Deployed databases created before the generation barrier do not have this
  // table. The first authenticated learning request must migrate them lazily.
  await server.d1("DROP TABLE learning_sync");
  await server.d1("DROP TABLE mastery_attempts");
  await server.d1("DROP TABLE mastery");
  for (const headers of [
    { Cookie: `session=${session}`, Accept: "application/json" },
    { Cookie: `session=${session}`, Accept: "application/json", "X-IEWT-Owner": "g_test" },
  ]) {
    assert.deepEqual(
      await learningJSON(await fetch(base + "/api/progress", { headers }), 200, 0),
      { progress: {}, generation: 0 },
      "progress reads must allow an absent or matching owner",
    );
    assert.deepEqual(
      await learningJSON(await fetch(base + "/api/stats", { headers }), 200, 0),
      { stats: { points: 0, streak: 0, last: null }, generation: 0 },
      "stats reads must allow an absent or matching owner",
    );
    assert.deepEqual(
      await learningJSON(await fetch(base + "/api/mastery", { headers }), 200, 0),
      { mastery: {}, generation: 0 },
      "mastery reads must allow an absent or matching owner",
    );
  }
  for (const apiPath of ["/api/progress", "/api/stats", "/api/mastery"]) {
    const denied = await json(await fetch(base + apiPath, {
      headers: { Cookie: `session=${session}`, Accept: "application/json", "X-IEWT-Owner": "g_other" },
    }), 409);
    assert.equal(denied.error.code, "account_changed", `${apiPath}: mismatched read owner must be rejected`);
  }
  const missingOwnerAuth = {
    Cookie: `session=${session}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
  };
  const mismatchedOwnerAuth = { ...auth, "X-IEWT-Owner": "g_other" };
  for (const [label, headers] of [["missing", missingOwnerAuth], ["mismatched", mismatchedOwnerAuth]]) {
    for (const [apiPath, init] of [
      ["/api/progress", { method: "PUT", headers, body: JSON.stringify({ model: "ols", done: [0] }) }],
      ["/api/stats", { method: "PUT", headers, body: JSON.stringify({ streak: 1, last: "2026-07-12" }) }],
      ["/api/mastery", { method: "PUT", headers, body: JSON.stringify({ itemId: "ols:ols-line-04", attemptId: "owner-check", correct: true, hinted: false, day: "2026-07-14" }) }],
      ["/api/progress", { method: "DELETE", headers }],
    ]) {
      const denied = await json(await fetch(base + apiPath, init), 409);
      assert.equal(denied.error.code, "account_changed", `${apiPath}: ${label} owner must be rejected`);
    }
  }
  const crossOriginAuth = { ...auth, Origin: "https://attacker.example" };
  for (const [apiPath, init] of [
    ["/api/progress", { method: "PUT", headers: crossOriginAuth, body: JSON.stringify({ model: "ols", done: [0] }) }],
    ["/api/stats", { method: "PUT", headers: crossOriginAuth, body: JSON.stringify({ streak: 1, last: "2026-07-12" }) }],
    ["/api/mastery", { method: "PUT", headers: crossOriginAuth, body: JSON.stringify({ itemId: "ols:ols-line-04", attemptId: "origin-check", correct: true, hinted: false, day: "2026-07-14" }) }],
    ["/api/progress", { method: "DELETE", headers: crossOriginAuth }],
  ]) {
    const denied = await json(await fetch(base + apiPath, init), 403);
    assert.equal(denied.error.code, "forbidden", `${apiPath}: cross-origin mutation must be denied`);
  }
  const fetchMetadataDenied = await json(await fetch(base + "/api/progress", {
    method: "DELETE",
    headers: { Cookie: `session=${session}`, "Sec-Fetch-Site": "cross-site" },
  }), 403);
  assert.equal(fetchMetadataDenied.error.code, "forbidden", "Sec-Fetch-Site must independently block cross-site mutations");

  for (const [label, generationHeaders] of [
    ["missing", authWithoutGeneration],
    ["malformed", { ...authWithoutGeneration, "X-IEWT-Generation": "00" }],
    ["mismatched", { ...authWithoutGeneration, "X-IEWT-Generation": "1" }],
  ]) {
    for (const [apiPath, body] of [
      ["/api/progress", { model: "ols", done: [0] }],
      ["/api/stats", { streak: 1, last: "2026-07-12" }],
      ["/api/mastery", { itemId: "ols:ols-line-04", attemptId: "generation-check", correct: true, hinted: false, day: "2026-07-14" }],
    ]) {
      const denied = await learningJSON(await fetch(base + apiPath, {
        method: "PUT", headers: generationHeaders, body: JSON.stringify(body),
      }), 409, 0);
      assert.equal(denied.error.code, "reset_required", `${apiPath}: ${label} generation must refresh state`);
    }
  }

  const putProgress = (done) => fetch(base + "/api/progress", { method: "PUT", headers: auth, body: JSON.stringify({ model: "ols", done }) });
  for (const response of await Promise.all([putProgress([0, 2]), putProgress([1, 3])])) {
    await learningJSON(response, 200, 0);
  }
  const progress = await learningJSON(
    await fetch(base + "/api/progress", { headers: { Cookie: `session=${session}` } }),
    200,
    0,
  );
  assert.deepEqual(progress.progress.ols.done, [0, 1, 2, 3], "concurrent snapshots must union");

  const badModel = await json(await fetch(base + "/api/progress", {
    method: "PUT", headers: auth, body: JSON.stringify({ model: "constructor", done: [0] }),
  }), 400);
  assert.equal(badModel.error.code, "invalid_progress");
  assert.equal((await json(await fetch(base + "/api/progress", {
    method: "PUT", headers: { ...auth, "Content-Type": "text/plain" }, body: "{}",
  }), 415)).error.code, "unsupported_media_type");
  assert.equal((await json(await fetch(base + "/api/progress", {
    method: "PUT", headers: { ...auth, "Content-Type": "text/application/json-evil" }, body: "{}",
  }), 415)).error.code, "unsupported_media_type");
  assert.equal((await json(await fetch(base + "/api/progress", {
    method: "PUT", headers: auth, body: "{" ,
  }), 400)).error.code, "invalid_json");
  assert.equal((await json(await fetch(base + "/api/progress", {
    method: "PUT", headers: auth, body: JSON.stringify({ model: "ols", done: [], padding: "x".repeat(17000) }),
  }), 413)).error.code, "payload_too_large");

  const initialStats = await json(await fetch(base + "/api/stats", { headers: { Cookie: `session=${session}` } }), 200);
  assert.equal(initialStats.stats.points, 40, "points must derive from four unique stages");
  const savedStats = await json(await fetch(base + "/api/stats", {
    method: "PUT", headers: auth, body: JSON.stringify({ points: 999999, streak: 3, last: "2026-7-12" }),
  }), 200);
  assert.deepEqual(savedStats.stats, { points: 40, streak: 3, last: "2026-07-12" }, "client points must not be trusted");
  const staleStats = await json(await fetch(base + "/api/stats", {
    method: "PUT", headers: auth, body: JSON.stringify({ streak: 99, last: "2026-07-11" }),
  }), 200);
  assert.deepEqual(staleStats.stats, { points: 40, streak: 3, last: "2026-07-12" }, "older writes must not regress stats");
  assert.equal((await json(await fetch(base + "/api/stats", {
    method: "PUT", headers: auth, body: JSON.stringify({ streak: 100000, last: "9999-12-31" }),
  }), 400)).error.code, "invalid_stats", "far-future activity must be rejected");

  const masteryAttempt = (attemptId, correct, hinted = false, itemId = "ols:ols-line-04", headers = auth, day = "2026-07-14") =>
    fetch(base + "/api/mastery", {
      method: "PUT", headers,
      body: JSON.stringify({ itemId, attemptId, correct, hinted, day }),
    });
  const firstMastery = await learningJSON(await masteryAttempt("attempt-1", false), 200, 0);
  assert.deepEqual(firstMastery.record, {
    level: 0, dueDay: "2026-07-15", attempts: 1, correct: 0,
    lastResult: false, lastAttemptId: "attempt-1", updatedAt: firstMastery.record.updatedAt,
  }, "incorrect review must reset mastery and schedule tomorrow");
  assert.equal(firstMastery.duplicate, false);
  const retryMastery = await learningJSON(await masteryAttempt("attempt-1", false), 200, 0);
  assert.equal(retryMastery.duplicate, true, "a retried attempt must be identified as a duplicate");
  assert.equal(retryMastery.record.attempts, 1, "a retried attempt must not increment counters");
  assert.equal((await json(await masteryAttempt("attempt-1", true), 409)).error.code, "attempt_conflict", "attempt ids must not be reusable for different data");
  const secondMastery = await learningJSON(await masteryAttempt("attempt-2", true), 200, 0);
  assert.equal(secondMastery.record.level, 1);
  assert.equal(secondMastery.record.dueDay, "2026-07-15");
  assert.equal(secondMastery.record.attempts, 2);
  assert.equal(secondMastery.record.correct, 1);
  const thirdMastery = await learningJSON(await masteryAttempt("attempt-3", true), 200, 0);
  assert.equal(thirdMastery.record.level, 2);
  assert.equal(thirdMastery.record.dueDay, "2026-07-17", "level two must use the three-day interval");
  const hintedMastery = await learningJSON(await masteryAttempt("attempt-4", true, true), 200, 0);
  assert.equal(hintedMastery.record.level, 1, "hinted recall must cap mastery at level one");
  assert.equal(hintedMastery.record.dueDay, "2026-07-15");
  const masterySnapshot = await learningJSON(await fetch(base + "/api/mastery", {
    headers: { Cookie: `session=${session}`, "X-IEWT-Owner": "g_test" },
  }), 200, 0);
  assert.deepEqual(masterySnapshot.mastery["ols:ols-line-04"], hintedMastery.record);
  assert.equal((await json(await masteryAttempt("unknown-item", true, false, "constructor"), 400)).error.code, "invalid_mastery_attempt");

  let parityRecord = null;
  const paritySteps = [
    { day: "2025-01-01", correct: true, hinted: false },
    { day: "2025-01-02", correct: true, hinted: false },
    { day: "2025-01-05", correct: true, hinted: false },
    { day: "2025-01-12", correct: true, hinted: false },
    { day: "2025-02-02", correct: true, hinted: false },
    { day: "2025-04-03", correct: true, hinted: false },
    { day: "2025-06-02", correct: true, hinted: true },
    { day: "2025-06-03", correct: false, hinted: false },
  ];
  for (const [index, step] of paritySteps.entries()) {
    const attemptId = `parity-${index + 1}`;
    const payload = await learningJSON(
      await masteryAttempt(attemptId, step.correct, step.hinted, "ols:ols-line-05", auth, step.day),
      200,
      0,
    );
    const expected = applyMastery(parityRecord, {
      ...step,
      attemptId,
      today: step.day,
      updatedAt: payload.record.updatedAt,
    });
    assert.deepEqual(payload.record, expected, `Worker mastery transition ${index + 1} drifted from the shared scheduler`);
    parityRecord = payload.record;
  }

  const concurrentMastery = await Promise.all([
    masteryAttempt("attempt-concurrent", true, false, "ols:ols-math-03"),
    masteryAttempt("attempt-concurrent", true, false, "ols:ols-math-03"),
  ]);
  const concurrentPayloads = await Promise.all(concurrentMastery.map((response) => learningJSON(response, 200, 0)));
  assert.deepEqual(concurrentPayloads.map((payload) => payload.duplicate).sort(), [false, true], "concurrent retry was applied more than once");
  assert(concurrentPayloads.every((payload) => payload.record.attempts === 1), "concurrent retry incremented mastery twice");

  await server.d1("UPDATE stats SET points=999999 WHERE user_id='g_test'");
  const repairedPoints = await json(await fetch(base + "/api/stats", { headers: { Cookie: `session=${session}` } }), 200);
  assert.equal(repairedPoints.stats.points, 40, "legacy or forged stored points must be recomputed exactly");

  const streakSession = await signSession({ sub: "g_streak", exp: Date.now() + 60000 }, SESSION_SECRET);
  const streakAuth = {
    Cookie: `session=${streakSession}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
    "X-IEWT-Owner": "g_streak",
    "X-IEWT-Generation": "0",
  };
  await json(await fetch(base + "/api/stats", {
    method: "PUT", headers: streakAuth, body: JSON.stringify({ streak: 10, last: "2026-07-11" }),
  }), 200);
  const continued = await json(await fetch(base + "/api/stats", {
    method: "PUT", headers: streakAuth, body: JSON.stringify({ streak: 1, last: "2026-07-12" }),
  }), 200);
  assert.deepEqual(continued.stats, { points: 0, streak: 11, last: "2026-07-12" }, "next-day stale client must not regress a known streak");

  await server.d1("INSERT INTO stats (user_id, points, streak, last, updated_at) VALUES ('g_legacy_future', 123, 77, '9999-12-31', 1)");
  const legacyFutureSession = await signSession({ sub: "g_legacy_future", exp: Date.now() + 60000 }, SESSION_SECRET);
  const legacyFuture = await json(await fetch(base + "/api/stats", { headers: { Cookie: `session=${legacyFutureSession}` } }), 200);
  assert.deepEqual(legacyFuture.stats, { points: 0, streak: 0, last: null }, "legacy future-dated streak must be repaired atomically");

  const other = await signSession({ sub: "g_other", exp: Date.now() + 60000 }, SESSION_SECRET);
  const otherAuth = {
    Cookie: `session=${other}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
    "X-IEWT-Owner": "g_other",
    "X-IEWT-Generation": "0",
  };
  await json(await fetch(base + "/api/progress", {
    method: "PUT", headers: otherAuth, body: JSON.stringify({ model: "ols", done: [0] }),
  }), 200);
  await json(await fetch(base + "/api/stats", {
    method: "PUT", headers: otherAuth, body: JSON.stringify({ streak: 7, last: "2026-07-12" }),
  }), 200);
  await learningJSON(await masteryAttempt("other-attempt", true, false, "ols:ols-line-04", otherAuth), 200, 0);

  const resetHeaders = {
    Cookie: `session=${session}`,
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
    "X-IEWT-Owner": "g_test",
    Accept: "application/json",
  };
  const reset = await learningJSON(await fetch(base + "/api/progress", {
    method: "DELETE",
    headers: resetHeaders,
  }), 200, 1);
  assert.deepEqual(reset, {
    ok: true,
    progress: {},
    stats: { points: 0, streak: 0, last: null },
    mastery: {},
    generation: 1,
  }, "reset response must expose the deterministic empty state");

  for (const [apiPath, body] of [
    ["/api/progress", { model: "ols", done: [8] }],
    ["/api/stats", { streak: 99, last: "2026-07-13" }],
    ["/api/mastery", { itemId: "ols:ols-line-04", attemptId: "stale-attempt", correct: true, hinted: false, day: "2026-07-14" }],
  ]) {
    const staleWrite = await learningJSON(await fetch(base + apiPath, {
      method: "PUT", headers: auth, body: JSON.stringify(body),
    }), 409, 1);
    assert.equal(staleWrite.error.code, "reset_required", `${apiPath}: a pre-reset write must be fenced out`);
  }

  assert.deepEqual(
    await learningJSON(await fetch(base + "/api/progress", { headers: { Cookie: `session=${session}` } }), 200, 1),
    { progress: {}, generation: 1 },
    "reset must delete every progress row and stale writes must not restore it",
  );
  assert.deepEqual(
    await learningJSON(await fetch(base + "/api/stats", { headers: { Cookie: `session=${session}` } }), 200, 1),
    { stats: { points: 0, streak: 0, last: null }, generation: 1 },
    "reset must atomically zero stats and stale writes must not restore them",
  );
  assert.deepEqual(
    await learningJSON(await fetch(base + "/api/mastery", { headers: { Cookie: `session=${session}` } }), 200, 1),
    { mastery: {}, generation: 1 },
    "reset must atomically delete mastery and its retry ledger",
  );

  const generationOneAuth = { ...authWithoutGeneration, "X-IEWT-Generation": "1" };
  const reusedAfterReset = await learningJSON(
    await masteryAttempt("attempt-1", true, false, "ols:ols-line-04", generationOneAuth),
    200,
    1,
  );
  assert.equal(reusedAfterReset.duplicate, false, "reset did not clear the mastery retry ledger");
  assert.equal(reusedAfterReset.record.attempts, 1, "post-reset mastery inherited deleted counters");
  await learningJSON(await fetch(base + "/api/progress", {
    method: "PUT",
    headers: generationOneAuth,
    body: JSON.stringify({ model: "ols", done: [4] }),
  }), 200, 1);
  const secondReset = await learningJSON(await fetch(base + "/api/progress", {
    method: "DELETE", headers: resetHeaders,
  }), 200, 2);
  assert.equal(secondReset.generation, 2, "each reset must advance the barrier exactly once");
  const staleGenerationOne = await learningJSON(await fetch(base + "/api/progress", {
    method: "PUT",
    headers: generationOneAuth,
    body: JSON.stringify({ model: "ols", done: [9] }),
  }), 409, 2);
  assert.equal(staleGenerationOne.error.code, "reset_required", "every prior generation must remain fenced out");
  assert.deepEqual(
    await learningJSON(await fetch(base + "/api/progress", { headers: { Cookie: `session=${session}` } }), 200, 2),
    { progress: {}, generation: 2 },
    "the second reset must win over both accepted older work and delayed writes",
  );

  const isolated = await learningJSON(
    await fetch(base + "/api/progress", { headers: { Cookie: `session=${other}` } }),
    200,
    0,
  );
  assert.deepEqual(isolated.progress.ols.done, [0], "reset must not affect another user's progress");
  const isolatedStats = await learningJSON(
    await fetch(base + "/api/stats", { headers: { Cookie: `session=${other}` } }),
    200,
    0,
  );
  assert.deepEqual(isolatedStats.stats, { points: 5, streak: 7, last: "2026-07-12" }, "reset must not affect another user's stats");
  const isolatedMastery = await learningJSON(
    await fetch(base + "/api/mastery", { headers: { Cookie: `session=${other}` } }), 200, 0,
  );
  assert.equal(isolatedMastery.mastery["ols:ols-line-04"].attempts, 1, "reset must not affect another user's mastery");
  const expired = await signSession({ sub: "g_expired", exp: Date.now() - 1 }, SESSION_SECRET);
  assert.equal((await json(await fetch(base + "/api/progress", { headers: { Cookie: `session=${expired}` } }), 401)).error.code, "unauthorized");

  console.log("✓ worker: routing, metadata, headers, API validation, D1 union, mastery idempotency, generation-fenced reset, derived points");
} finally {
  await server.stop();
}
