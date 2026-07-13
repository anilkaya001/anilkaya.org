import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { signSession } from "../shared/session.js";
import { REPO_ROOT, SESSION_SECRET, startWorker } from "./worker-server.mjs";

const server = await startWorker();
const base = server.baseURL;
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

try {
  const root = await fetch(base + "/");
  assert.equal(root.status, 200);
  assert.equal(root.headers.get("cache-control"), "no-cache");
  assert.equal(root.headers.get("clear-site-data"), '"cache"');
  assert.match(root.headers.get("set-cookie") || "", /cachefix=1/);
  assertSecurity(root, true);
  assert.match(await root.text(), /In Econometrics We Trust/);

  const repeat = await fetch(base + "/", { headers: { Cookie: "cachefix=1" } });
  assert.equal(repeat.headers.get("clear-site-data"), null, "cache purge must happen once per browser");

  const css = await fetch(base + "/assets/css/base.css?v=17");
  assert.equal(css.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const cssEtag = css.headers.get("etag");
  assertSecurity(css, false);
  const localCSS = await readFile(path.join(REPO_ROOT, "assets/css/base.css"), "utf8");
  assert.equal(await css.text(), localCSS, "response cloning changed CSS bytes");
  assert(cssEtag, "versioned asset ETag missing");
  const revalidatedCSS = await fetch(base + "/assets/css/base.css?v=17", { headers: { "If-None-Match": cssEtag } });
  assert.equal(revalidatedCSS.status, 304);
  assert.equal(revalidatedCSS.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assertSecurity(revalidatedCSS, false);

  const unversioned = await fetch(base + "/assets/css/base.css");
  assert.equal(unversioned.headers.get("cache-control"), "public, max-age=3600");
  assertSecurity(unversioned, false);
  for (const asset of ["/assets/js/nav.js?v=17", "/assets/fonts/LM-regular.woff2?v=17", "/assets/img/og.png"]) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200, `${asset}: missing`);
    assertSecurity(response, false);
  }
  const missing = await fetch(base + "/definitely-missing");
  assert.equal(missing.status, 404);
  assertSecurity(missing, true);
  const missingVersioned = await fetch(base + "/definitely-missing.js?v=17");
  assert.equal(missingVersioned.status, 404);
  assert.notEqual(missingVersioned.headers.get("cache-control"), "public, max-age=31536000, immutable");
  for (const privatePath of ["/.wrangler/cache/cf.json", "/articles/_template/", "/CNAME"]) {
    assert.equal((await fetch(base + privatePath)).status, 404, `${privatePath} must not be a public asset`);
  }

  for (const legacy of ["/lab/course.html?m=ols", "/lab/course/?m=ols"]) {
    const response = await fetch(base + legacy, { redirect: "manual" });
    assert.equal(response.status, 308, `${legacy}: expected permanent canonical redirect`);
    assert.equal(response.headers.get("location"), base + "/lab/course?m=ols");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assertSecurity(response, false);
  }

  const topics = {
    ols: ["Ordinary Least Squares — Econometrics Lab", "The line of best fit, how it's computed, inference, and the assumptions behind it.", "og-ols.png", "Beginner"],
    iv2sls: ["Instrumental Variables & 2SLS — Econometrics Lab", "When OLS is biased by endogeneity, and how an instrument plus 2SLS rescues it.", "og-iv2sls.png", "Intermediate"],
    did: ["Difference-in-Differences — Econometrics Lab", "Treatment effects from before/after × treated/control, parallel trends, event studies.", "og-did.png", "Intermediate"],
    var: ["Vector Autoregression — Econometrics Lab", "Joint dynamics of several series: estimation, impulse responses, Granger causality.", "og-var.png", "Advanced"],
    panel: ["Panel: Fixed & Random Effects — Econometrics Lab", "Unobserved heterogeneity, pooled-OLS bias, the within estimator, FE vs RE.", "og-panel.png", "Advanced"],
    logit: ["Logit & Probit — Econometrics Lab", "Binary outcomes: the logistic model, odds ratios, marginal effects, classification.", "og-logit.png", "Intermediate"],
    gmm: ["Generalized Method of Moments — Econometrics Lab", "Moment conditions as a unifying estimator, IV-GMM, over-identification, efficiency.", "og-gmm.png", "Advanced"],
  };
  for (const [id, [title, description, image, level]] of Object.entries(topics)) {
    const response = await fetch(base + `/lab/course?m=${id}`, { headers: { Cookie: "cachefix=1" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(response.headers.get("etag"), null, `${id}: backing ETag leaked after rewrite`);
    assertSecurity(response, true);
    const html = await response.text();
    assert.equal(decode(html.match(/<title>([^<]+)<\/title>/)?.[1]), title, `${id}: title`);
    assert.equal(attr(html, 'name="description"'), description, `${id}: description`);
    assert.equal(attr(html, 'rel="canonical"', "href"), `${base}/lab/course?m=${id}`, `${id}: canonical`);
    assert.equal(attr(html, 'property="og:url"'), `${base}/lab/course?m=${id}`, `${id}: og:url`);
    assert.equal(attr(html, 'property="og:image"'), `${base}/assets/img/${image}`, `${id}: image`);
    const script = html.match(/<script id="courseStructuredData" type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert(script, `${id}: structured data missing`);
    const structured = JSON.parse(script);
    assert.deepEqual(structured["@graph"].map((entry) => entry["@type"]), ["Course", "BreadcrumbList"]);
    assert.equal(structured["@graph"][0].url, `${base}/lab/course?m=${id}`);
    assert.equal(structured["@graph"][0].educationalLevel, level, `${id}: education level`);
  }
  const generic = await fetch(base + "/lab/course?m=unknown");
  const genericEtag = generic.headers.get("etag");
  assert.match(await generic.text(), /<title>Course — Econometrics Lab<\/title>/);
  assert(genericEtag, "backing course ETag missing");
  const conditionalCourse = await fetch(base + "/lab/course?m=ols", { headers: { "If-None-Match": genericEtag, Cookie: "cachefix=1" } });
  assert.equal(conditionalCourse.status, 200, "rewritten metadata must not use the backing asset validator");
  assert.equal(conditionalCourse.headers.get("etag"), null);
  assert.match(await conditionalCourse.text(), /<title>Ordinary Least Squares — Econometrics Lab<\/title>/);

  assert.deepEqual(await json(await fetch(base + "/api/me", { headers: { Cookie: "session=%" } }), 200), { user: null });
  const method = await fetch(base + "/api/me", { method: "POST" });
  const methodBody = await json(method, 405);
  assert.equal(method.headers.get("allow"), "GET");
  assert.equal(methodBody.error.code, "method_not_allowed");
  assert.equal((await json(await fetch(base + "/api/progress"), 401)).error.code, "unauthorized");
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

  const session = await signSession({ sub: "g_test", email: "test@example.com", name: "Test", exp: Date.now() + 60000 }, SESSION_SECRET);
  const auth = { Cookie: `session=${session}`, "Content-Type": "application/json", Accept: "application/json" };
  const putProgress = (done) => fetch(base + "/api/progress", { method: "PUT", headers: auth, body: JSON.stringify({ model: "ols", done }) });
  for (const response of await Promise.all([putProgress([0, 2]), putProgress([1, 3])])) await json(response, 200);
  const progress = await json(await fetch(base + "/api/progress", { headers: { Cookie: `session=${session}` } }), 200);
  assert.deepEqual(progress.progress.ols.done, [0, 1, 2, 3], "concurrent snapshots must union");

  const badModel = await json(await fetch(base + "/api/progress", {
    method: "PUT", headers: auth, body: JSON.stringify({ model: "constructor", done: [0] }),
  }), 400);
  assert.equal(badModel.error.code, "invalid_progress");
  assert.equal((await json(await fetch(base + "/api/progress", {
    method: "PUT", headers: { Cookie: `session=${session}`, "Content-Type": "text/plain" }, body: "{}",
  }), 415)).error.code, "unsupported_media_type");
  assert.equal((await json(await fetch(base + "/api/progress", {
    method: "PUT", headers: { Cookie: `session=${session}`, "Content-Type": "text/application/json-evil" }, body: "{}",
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

  await server.d1("UPDATE stats SET points=999999 WHERE user_id='g_test'");
  const repairedPoints = await json(await fetch(base + "/api/stats", { headers: { Cookie: `session=${session}` } }), 200);
  assert.equal(repairedPoints.stats.points, 40, "legacy or forged stored points must be recomputed exactly");

  const streakSession = await signSession({ sub: "g_streak", exp: Date.now() + 60000 }, SESSION_SECRET);
  const streakAuth = { Cookie: `session=${streakSession}`, "Content-Type": "application/json", Accept: "application/json" };
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
  const isolated = await json(await fetch(base + "/api/progress", { headers: { Cookie: `session=${other}` } }), 200);
  assert.deepEqual(isolated.progress, {}, "users must be isolated");
  const expired = await signSession({ sub: "g_expired", exp: Date.now() - 1 }, SESSION_SECRET);
  assert.equal((await json(await fetch(base + "/api/progress", { headers: { Cookie: `session=${expired}` } }), 401)).error.code, "unauthorized");

  console.log("✓ worker: routing, metadata, headers, API validation, D1 union, derived points");
} finally {
  await server.stop();
}
