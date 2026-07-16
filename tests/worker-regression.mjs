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
const TEST_SESSION_TTL_MS = 10 * 60 * 1000;
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
  assert.equal(root.headers.get("clear-site-data"), null, "one-time cache purge is retired");
  assertSecurity(root, true);
  assert.match(root.headers.get("content-security-policy") || "", /https:\/\/static\.cloudflareinsights\.com/, "CSP must allow Cloudflare Web Analytics");
  assert.match(await root.text(), /In Econometrics We Trust/);

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
  // A ?v on a non-/assets/ path must NOT pin an immutable year-long copy.
  const sitemapVersioned = await fetch(base + "/sitemap.xml?v=9");
  assert.notEqual(sitemapVersioned.headers.get("cache-control"), "public, max-age=31536000, immutable", "only /assets/ paths may be cached immutably");
  const sitemap = await sitemapResponse.text();
  const sitemapURLs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(sitemapURLs, [
    SITE_ORIGIN + "/", SITE_ORIGIN + "/lab/", ...COURSE_TOPICS.map((topic) => SITE_ORIGIN + topic.path),
    SITE_ORIGIN + "/lab/projects/macro-forecasting-desk/",
    SITE_ORIGIN + "/lab/projects/fx-volatility-risk/",
    SITE_ORIGIN + "/lab/projects/factor-pricing-lab/",
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
  assert.deepEqual(await json(await fetch(base + "/api/bootstrap", { headers: { Cookie: "session=%" } }), 200), { user: null });
  assert.deepEqual(await json(await fetch(base + "/api/v2/bootstrap", { headers: { Cookie: "session=%" } }), 200), { user: null });
  const method = await fetch(base + "/api/me", { method: "POST" });
  const methodBody = await json(method, 405);
  assert.equal(method.headers.get("allow"), "GET");
  assert.equal(methodBody.error.code, "method_not_allowed");
  const bootstrapMethod = await fetch(base + "/api/bootstrap", { method: "POST" });
  assert.equal((await json(bootstrapMethod, 405)).error.code, "method_not_allowed");
  assert.equal(bootstrapMethod.headers.get("allow"), "GET");
  const academyBootstrapMethod = await fetch(base + "/api/v2/bootstrap", { method: "POST" });
  assert.equal((await json(academyBootstrapMethod, 405)).error.code, "method_not_allowed");
  assert.equal(academyBootstrapMethod.headers.get("allow"), "GET");
  assert.equal((await json(await fetch(base + "/api/v2/progress", { method: "PUT" }), 401)).error.code, "unauthorized");
  const academyProgressMethod = await fetch(base + "/api/v2/progress");
  assert.equal((await json(academyProgressMethod, 405)).error.code, "method_not_allowed");
  assert.equal(academyProgressMethod.headers.get("allow"), "PUT");
  assert.equal((await json(await fetch(base + "/api/progress"), 401)).error.code, "unauthorized");
  assert.equal((await json(await fetch(base + "/api/mastery"), 401)).error.code, "unauthorized");
  assert.equal((await json(await fetch(base + "/api/placement"), 401)).error.code, "unauthorized");
  const progressMethod = await fetch(base + "/api/progress", { method: "POST" });
  assert.equal((await json(progressMethod, 405)).error.code, "method_not_allowed");
  assert.equal(progressMethod.headers.get("allow"), "GET, PUT, DELETE");
  const statsMethod = await fetch(base + "/api/stats", { method: "DELETE" });
  assert.equal((await json(statsMethod, 405)).error.code, "method_not_allowed");
  assert.equal(statsMethod.headers.get("allow"), "GET, PUT");
  const masteryMethod = await fetch(base + "/api/mastery", { method: "DELETE" });
  assert.equal((await json(masteryMethod, 405)).error.code, "method_not_allowed");
  assert.equal(masteryMethod.headers.get("allow"), "GET, PUT");
  const placementMethod = await fetch(base + "/api/placement", { method: "POST" });
  assert.equal((await json(placementMethod, 405)).error.code, "method_not_allowed");
  assert.equal(placementMethod.headers.get("allow"), "GET, PUT, DELETE");
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

  const session = await signSession({ sub: "g_test", email: "test@example.com", name: "Test", exp: Date.now() + TEST_SESSION_TTL_MS }, SESSION_SECRET);
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
  // tables. The first authenticated bootstrap must migrate them lazily.
  await server.d1("DROP TABLE learning_sync");
  await server.d1("DROP TABLE mastery_attempts");
  await server.d1("DROP TABLE mastery");
  await server.d1("DROP TABLE placement");
  const emptyBootstrap = await learningJSON(await fetch(base + "/api/bootstrap", {
    headers: { Cookie: `session=${session}`, Accept: "application/json" },
  }), 200, 0);
  assert.deepEqual(emptyBootstrap, {
    user: { id: "g_test", email: "test@example.com", name: "Test" },
    progress: {},
    stats: { points: 0, streak: 0, last: null },
    mastery: {},
    placement: null,
    generation: 0,
  }, "bootstrap must hydrate every sanitized learning domain in one response");
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
    assert.deepEqual(
      await learningJSON(await fetch(base + "/api/placement", { headers }), 200, 0),
      { placement: null, generation: 0 },
      "placement reads must allow an absent or matching owner",
    );
  }
  for (const apiPath of ["/api/bootstrap", "/api/v2/bootstrap", "/api/progress", "/api/stats", "/api/mastery", "/api/placement"]) {
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
      ["/api/placement", { method: "PUT", headers, body: JSON.stringify({ band: "foundation", score: 3, total: 15, completedDay: "2026-07-14", recommendedTopic: "ols" }) }],
      ["/api/v2/progress", { method: "PUT", headers, body: JSON.stringify({ courseId: "ols", stageId: "ols-line-01", complete: true }) }],
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
    ["/api/placement", { method: "PUT", headers: crossOriginAuth, body: JSON.stringify({ band: "foundation", score: 3, total: 15, completedDay: "2026-07-14", recommendedTopic: "ols" }) }],
    ["/api/v2/progress", { method: "PUT", headers: crossOriginAuth, body: JSON.stringify({ courseId: "ols", stageId: "ols-line-01", complete: true }) }],
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
      ["/api/placement", { band: "foundation", score: 3, total: 15, completedDay: "2026-07-14", recommendedTopic: "ols" }],
      ["/api/v2/progress", { courseId: "ols", stageId: "ols-line-01", complete: true }],
    ]) {
      const response = await fetch(base + apiPath, {
        method: "PUT", headers: generationHeaders, body: JSON.stringify(body),
      });
      const denied = await json(response, 409);
      assert.equal(denied.error.code, "reset_required", `${apiPath}: ${label} generation must refresh state`);
      assert.equal(response.headers.get("x-iewt-generation"), "0", `${apiPath}: ${label} reset fence must return the current generation`);
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

  const putPlacement = (value, headers = auth) => fetch(base + "/api/placement", {
    method: "PUT", headers, body: JSON.stringify(value),
  });
  const appliedPlacement = {
    band: "applied", score: 9, total: 15, completedDay: "2026-07-14", recommendedTopic: "did",
  };
  const savedPlacement = await learningJSON(await putPlacement({
    ...appliedPlacement, responses: ["must never be stored"], weakestTopic: "did",
  }), 200, 0);
  assert.deepEqual(savedPlacement.placement, appliedPlacement, "placement API must persist only the five-field summary");
  const olderPlacement = await learningJSON(await putPlacement({
    band: "foundation", score: 3, total: 15, completedDay: "2026-07-13", recommendedTopic: "ols",
  }), 200, 0);
  assert.deepEqual(olderPlacement.placement, appliedPlacement, "an older placement must not replace a newer checkpoint");
  for (const invalid of [
    { ...appliedPlacement, total: 14 },
    { ...appliedPlacement, band: "advanced" },
    { ...appliedPlacement, recommendedTopic: "constructor" },
    { ...appliedPlacement, completedDay: "9999-12-31" },
  ]) {
    assert.equal((await json(await putPlacement(invalid), 400)).error.code, "invalid_placement", "invalid placement summary was accepted");
  }
  assert.deepEqual(await learningJSON(await fetch(base + "/api/placement", {
    method: "DELETE", headers: auth,
  }), 200, 0), { ok: true, placement: null, generation: 0 }, "placement clear response drifted");
  assert.deepEqual(await learningJSON(await fetch(base + "/api/placement", {
    headers: { Cookie: `session=${session}`, "X-IEWT-Owner": "g_test" },
  }), 200, 0), { placement: null, generation: 0 }, "placement clear did not persist");
  const advancedPlacement = {
    band: "advanced", score: 13, total: 15, completedDay: "2026-07-15", recommendedTopic: "gmm",
  };
  assert.deepEqual((await learningJSON(await putPlacement(advancedPlacement), 200, 0)).placement, advancedPlacement);

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
  const hydrated = await learningJSON(await fetch(base + "/api/bootstrap", {
    headers: { Cookie: `session=${session}`, "X-IEWT-Owner": "g_test" },
  }), 200, 0);
  assert.deepEqual(hydrated, {
    user: { id: "g_test", email: "test@example.com", name: "Test" },
    progress: { ols: { done: [0, 1, 2, 3] } },
    stats: { points: 40, streak: 3, last: "2026-07-12" },
    mastery: { "ols:ols-line-04": hintedMastery.record },
    placement: advancedPlacement,
    generation: 0,
  }, "bootstrap must preserve granular API sanitization and generation semantics");
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

  // Academy v2 state is stable-id based, idempotent, owner scoped, and kept
  // separate from code/output data. Completing a stage already present in the
  // legacy snapshot proves the compatibility union without changing points.
  const academyPut = (apiPath, body, headers = auth) => fetch(base + apiPath, {
    method: "PUT", headers, body: JSON.stringify(body),
  });
  const stableStage = { courseId: "ols", stageId: "ols-line-01", complete: true };
  const stableSaved = await learningJSON(await academyPut("/api/v2/progress", stableStage), 200, 0);
  assert.deepEqual(stableSaved.done, ["ols-line-01"]);
  const stableRetry = await learningJSON(await academyPut("/api/v2/progress", stableStage), 200, 0);
  assert.deepEqual(stableRetry.done, ["ols-line-01"], "stable completion retry must be idempotent");
  assert.equal((await json(await academyPut("/api/v2/progress", {
    courseId: "ols", stageId: "not-a-stage", complete: true,
  }), 400)).error.code, "invalid_progress");

  const skillId = "foundations.probability-models";
  const skillAttempt = (attemptId, correct, hinted, day) => academyPut("/api/v2/attempt", {
    attemptId, skillId, itemId: `${skillId}:v1`, correct, hinted, day,
  });
  const skillClean = await learningJSON(await skillAttempt("skill-clean", true, false, "2026-07-14"), 200, 0);
  assert.equal(skillClean.duplicate, false);
  assert.deepEqual({ level: skillClean.record.level, dueDay: skillClean.record.dueDay, attempts: skillClean.record.attempts }, {
    level: 1, dueDay: "2026-07-15", attempts: 1,
  });
  const skillDuplicate = await learningJSON(await skillAttempt("skill-clean", true, false, "2026-07-14"), 200, 0);
  assert.equal(skillDuplicate.duplicate, true);
  assert.equal(skillDuplicate.record.attempts, 1, "duplicate skill attempt incremented counters");
  assert.equal((await json(await skillAttempt("skill-clean", false, false, "2026-07-14"), 409)).error.code, "attempt_conflict");
  const skillHinted = await learningJSON(await skillAttempt("skill-hinted", true, true, "2026-07-15"), 200, 0);
  assert.deepEqual({ level: skillHinted.record.level, dueDay: skillHinted.record.dueDay }, { level: 1, dueDay: "2026-07-16" });
  const skillWrong = await learningJSON(await skillAttempt("skill-wrong", false, false, "2026-07-15"), 200, 0);
  assert.deepEqual({ level: skillWrong.record.level, dueDay: skillWrong.record.dueDay }, { level: 0, dueDay: "2026-07-16" });

  const preferences = { activePathId: "time-series", sessionMinutes: 45, weeklyGoalMinutes: 300 };
  assert.deepEqual((await learningJSON(await academyPut("/api/v2/preferences", preferences), 200, 0)).preferences, preferences);
  assert.equal((await json(await academyPut("/api/v2/preferences", {
    activePathId: "unknown", sessionMinutes: 45, weeklyGoalMinutes: 300,
  }), 400)).error.code, "invalid_preferences");

  const projectId = "macro-forecasting-desk";
  const projectBodies = ["inspect-vintage", "transform-series"].map((taskId) => ({
    projectId, mode: "guided", completedTaskIds: [taskId],
  }));
  for (const response of await Promise.all(projectBodies.map((body) => academyPut("/api/v2/project", body)))) {
    await learningJSON(response, 200, 0);
  }
  const projectSaved = await learningJSON(await academyPut("/api/v2/project", {
    projectId, mode: "unguided", completedTaskIds: ["fit-benchmark"],
  }), 200, 0);
  assert.deepEqual(projectSaved.project, {
    mode: "unguided", done: ["fit-benchmark", "inspect-vintage", "transform-series"],
  }, "concurrent project task updates must union atomically");
  assert.equal((await json(await academyPut("/api/v2/project", {
    projectId, mode: "guided", completedTaskIds: ["not-a-task"],
  }), 400)).error.code, "invalid_project");

  const academyHydrated = await learningJSON(await fetch(base + "/api/v2/bootstrap", {
    headers: { Cookie: `session=${session}`, "X-IEWT-Owner": "g_test" },
  }), 200, 0);
  assert.deepEqual(academyHydrated.stableProgress.ols.done, ["ols-line-01", "ols-line-02", "ols-line-03", "ols-line-04"],
    "legacy index completion was not projected through the stable manifest");
  assert.deepEqual(academyHydrated.skillMastery[skillId], skillWrong.record);
  assert.deepEqual(academyHydrated.preferences, preferences);
  assert.deepEqual(academyHydrated.projects[projectId], projectSaved.project);
  assert.deepEqual(academyHydrated.progress, hydrated.progress, "v2 bootstrap drifted from the legacy compatibility snapshot");

  await server.d1("UPDATE stats SET points=999999 WHERE user_id='g_test'");
  const repairedPoints = await json(await fetch(base + "/api/stats", { headers: { Cookie: `session=${session}` } }), 200);
  assert.equal(repairedPoints.stats.points, 40, "legacy or forged stored points must be recomputed exactly");

  const streakSession = await signSession({ sub: "g_streak", exp: Date.now() + TEST_SESSION_TTL_MS }, SESSION_SECRET);
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
  const legacyFutureSession = await signSession({ sub: "g_legacy_future", exp: Date.now() + TEST_SESSION_TTL_MS }, SESSION_SECRET);
  const legacyFuture = await learningJSON(await fetch(base + "/api/bootstrap", {
    headers: { Cookie: `session=${legacyFutureSession}` },
  }), 200, 0);
  assert.deepEqual(legacyFuture.stats, { points: 0, streak: 0, last: null }, "legacy future-dated streak must be repaired atomically");

  const other = await signSession({ sub: "g_other", exp: Date.now() + TEST_SESSION_TTL_MS }, SESSION_SECRET);
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
  const otherPlacement = {
    band: "foundation", score: 4, total: 15, completedDay: "2026-07-14", recommendedTopic: "ols",
  };
  assert.deepEqual((await learningJSON(await putPlacement(otherPlacement, otherAuth), 200, 0)).placement, otherPlacement);

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
    stableProgress: {},
    skillMastery: {},
    projects: {},
    placement: null,
    generation: 1,
  }, "reset response must expose the deterministic empty state");

  for (const [apiPath, body] of [
    ["/api/progress", { model: "ols", done: [8] }],
    ["/api/stats", { streak: 99, last: "2026-07-13" }],
    ["/api/mastery", { itemId: "ols:ols-line-04", attemptId: "stale-attempt", correct: true, hinted: false, day: "2026-07-14" }],
    ["/api/placement", { band: "applied", score: 9, total: 15, completedDay: "2026-07-15", recommendedTopic: "did" }],
    ["/api/v2/progress", { courseId: "ols", stageId: "ols-line-05", complete: true }],
    ["/api/v2/attempt", { attemptId: "stale-skill", skillId: "foundations.probability-models", itemId: "foundations.probability-models:v1", correct: true, hinted: false, day: "2026-07-15" }],
    ["/api/v2/preferences", { activePathId: "causal", sessionMinutes: 10, weeklyGoalMinutes: 60 }],
    ["/api/v2/project", { projectId: "macro-forecasting-desk", mode: "guided", completedTaskIds: ["inspect-vintage"] }],
  ]) {
    const staleWrite = await learningJSON(await fetch(base + apiPath, {
      method: "PUT", headers: auth, body: JSON.stringify(body),
    }), 409, 1);
    assert.equal(staleWrite.error.code, "reset_required", `${apiPath}: a pre-reset write must be fenced out`);
  }

  const academyAfterReset = await learningJSON(await fetch(base + "/api/v2/bootstrap", {
    headers: { Cookie: `session=${session}`, "X-IEWT-Owner": "g_test" },
  }), 200, 1);
  assert.deepEqual(academyAfterReset.stableProgress, {}, "reset retained stable-id completion");
  assert.deepEqual(academyAfterReset.skillMastery, {}, "reset retained conceptual mastery");
  assert.deepEqual(academyAfterReset.projects, {}, "reset retained capstone task progress");
  assert.deepEqual(academyAfterReset.preferences, preferences, "reset must preserve learning preferences");
  assert.deepEqual({ progress: academyAfterReset.progress, mastery: academyAfterReset.mastery, placement: academyAfterReset.placement }, {
    progress: {}, mastery: {}, placement: null,
  }, "v2 bootstrap retained legacy learning state after reset");

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
  assert.deepEqual(
    await learningJSON(await fetch(base + "/api/placement", { headers: { Cookie: `session=${session}` } }), 200, 1),
    { placement: null, generation: 1 },
    "reset must atomically delete placement and stale writes must not restore it",
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
  const isolatedPlacement = await learningJSON(
    await fetch(base + "/api/placement", { headers: { Cookie: `session=${other}` } }), 200, 0,
  );
  assert.deepEqual(isolatedPlacement.placement, otherPlacement, "reset must not affect another user's placement");
  const expired = await signSession({ sub: "g_expired", exp: Date.now() - 1 }, SESSION_SECRET);
  assert.equal((await json(await fetch(base + "/api/progress", { headers: { Cookie: `session=${expired}` } }), 401)).error.code, "unauthorized");

  console.log("✓ worker: routing, metadata, headers, API validation, D1 union, mastery and placement isolation, generation-fenced reset, derived points");
} finally {
  await server.stop();
}
