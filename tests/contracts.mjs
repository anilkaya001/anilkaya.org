import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { COURSE_STAGE_POINTS } from "../shared/course-points.js";
import { COURSE_TOPICS, SITE_ORIGIN } from "../shared/course-seo.js";
import { cookie, getCookie, signSession, verifySession } from "../shared/session.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

function filesUnder(directory, predicate = () => true) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(path.join(ROOT, current))) {
      const relative = path.join(current, name);
      const stat = statSync(path.join(ROOT, relative));
      if (stat.isDirectory()) walk(relative);
      else if (predicate(relative)) out.push(relative);
    }
  };
  walk(directory);
  return out;
}

const context = { window: {}, console };
vm.createContext(context);
for (const file of ["assets/js/course-catalog.js", "assets/js/curriculum.js", "assets/js/curriculum-data.js", "assets/js/curriculum-questions.js"]) {
  vm.runInContext(read(file), context, { filename: file });
}

const topicIds = ["ols", "iv2sls", "did", "var", "panel", "logit", "gmm"];
assert.deepEqual([...context.window.TOPIC_META.map((topic) => topic.id)], topicIds, "topic ids drifted");
assert.deepEqual(Object.keys(context.window.CURRICULUM), topicIds, "curriculum ids drifted");
assert.deepEqual(COURSE_TOPICS.map((topic) => topic.id), topicIds, "SEO course ids drifted");
assert.equal(new Set(COURSE_TOPICS.map((topic) => topic.slug)).size, topicIds.length, "course slugs must be unique");

const seoById = Object.fromEntries(COURSE_TOPICS.map((topic) => [topic.id, topic]));

const defaults = { read: 5, code: 10, interactive: 10, quiz: 15, truefalse: 10, fillblank: 15, numeric: 20, multi: 20 };
const knownTypes = new Set(Object.keys(defaults));

for (const meta of context.window.TOPIC_META) {
  const course = context.window.CURRICULUM[meta.id];
  const seo = seoById[meta.id];
  assert(seo, `${meta.id}: missing search metadata`);
  assert.equal(meta.slug, seo.slug, `${meta.id}: browser slug drifted`);
  assert.equal(meta.num, seo.number, `${meta.id}: browser course number drifted`);
  assert.equal(meta.title, seo.name, `${meta.id}: browser course name drifted`);
  assert.equal(meta.blurb, seo.description, `${meta.id}: browser course description drifted`);
  assert.equal(meta.level, seo.level, `${meta.id}: browser course level drifted`);
  assert.equal(course.title, seo.name, `${meta.id}: visible H1 and search name drifted`);
  assert.equal(seo.pageTitle, `${seo.name} — Econometrics Lab`, `${meta.id}: page title drifted`);
  assert.equal(course.modules.length, meta.modules, `${meta.id}: module count metadata drifted`);
  assert.deepEqual(
    JSON.parse(JSON.stringify(course.modules.map(({ title, summary }) => ({ title, summary })))),
    seo.modules.map(({ title, summary }) => ({ title, summary })),
    `${meta.id}: crawlable module outline drifted`,
  );
  const stages = course.modules.flatMap((module) => module.stages);
  assert.equal(stages.length, meta.stages, `${meta.id}: stage count metadata drifted`);

  const points = [];
  for (const [index, stage] of stages.entries()) {
    const label = `${meta.id} stage ${index}`;
    assert(knownTypes.has(stage.type), `${label}: unknown type ${stage.type}`);
    assert(typeof stage.title === "string" && stage.title.trim(), `${label}: missing title`);
    if (stage.points != null) assert(Number.isSafeInteger(stage.points) && stage.points >= 0, `${label}: invalid points`);
    points.push(stage.points ?? defaults[stage.type]);

    if (stage.type === "read") assert(typeof stage.html === "string" && stage.html.trim(), `${label}: read.html missing`);
    if (stage.type === "code") assert(typeof stage.code === "string" && stage.code.trim(), `${label}: code.code missing`);
    if (stage.type === "interactive") {
      assert(Array.isArray(stage.params) && stage.params.length, `${label}: interactive params missing`);
      assert.equal(typeof stage.template, "string", `${label}: interactive template missing`);
      for (const param of stage.params) {
        assert(typeof param.name === "string" && /^\w+$/.test(param.name), `${label}: param name invalid`);
        for (const field of ["min", "max", "step", "value"]) assert(Number.isFinite(param[field]), `${label}: param ${field} invalid`);
        assert(param.min < param.max && param.step > 0 && param.value >= param.min && param.value <= param.max, `${label}: param bounds invalid`);
        assert(stage.template.includes(`{{${param.name}}}`), `${label}: template omits ${param.name}`);
      }
    }
    if (["quiz", "truefalse", "multi", "numeric", "fillblank"].includes(stage.type)) {
      assert(typeof stage.prompt === "string" && stage.prompt.trim(), `${label}: question prompt missing`);
    }
    if (stage.type === "quiz") {
      assert(Array.isArray(stage.choices) && stage.choices.length >= 2, `${label}: choices missing`);
      assert(Number.isInteger(stage.answer) && stage.answer >= 0 && stage.answer < stage.choices.length, `${label}: answer invalid`);
    }
    if (stage.type === "truefalse") assert.equal(typeof stage.answer, "boolean", `${label}: boolean answer invalid`);
    if (stage.type === "multi") {
      assert(Array.isArray(stage.choices) && stage.choices.length >= 2, `${label}: choices missing`);
      assert(Array.isArray(stage.answers) && stage.answers.length, `${label}: answers missing`);
      assert.equal(new Set(stage.answers).size, stage.answers.length, `${label}: duplicate answer index`);
      assert(stage.answers.every((answer) => Number.isInteger(answer) && answer >= 0 && answer < stage.choices.length), `${label}: answer index invalid`);
    }
    if (stage.type === "numeric") {
      assert(Number.isFinite(stage.answer), `${label}: numeric answer invalid`);
      assert(Number.isFinite(stage.tol) || Number.isFinite(stage.rtol), `${label}: numeric tolerance missing`);
      if (stage.tol != null) assert(Number.isFinite(stage.tol) && stage.tol >= 0, `${label}: absolute tolerance invalid`);
      if (stage.rtol != null) assert(Number.isFinite(stage.rtol) && stage.rtol >= 0, `${label}: relative tolerance invalid`);
    }
    if (stage.type === "fillblank") {
      assert.equal((String(stage.prompt).match(/___/g) || []).length, 1, `${label}: prompt needs exactly one blank`);
      assert(Array.isArray(stage.accept) && stage.accept.length && stage.accept.every((answer) => typeof answer === "string" && answer.trim()), `${label}: accept list invalid`);
    }
  }
  assert.deepEqual(points, COURSE_STAGE_POINTS[meta.id], `${meta.id}: server scoring manifest drifted`);
  assert.deepEqual(points, Array.from(context.window.COURSE_STAGE_POINTS[meta.id]), `${meta.id}: browser scoring manifest drifted`);

  const payloadFile = `assets/data/courses/${meta.id}.json`;
  assert(existsSync(path.join(ROOT, payloadFile)), `${meta.id}: generated course payload missing`);
  const payloadSource = read(payloadFile);
  const payload = JSON.parse(payloadSource);
  assert.equal(payload.schemaVersion, 1, `${meta.id}: unsupported payload schema`);
  const expected = JSON.parse(JSON.stringify(course));
  expected.schemaVersion = 1;
  const stageIds = [];
  expected.modules.forEach((module) => {
    module.stages.forEach((stage, index) => {
      const id = `${module.id}-${String(index + 1).padStart(2, "0")}`;
      stage.id = id;
      stageIds.push(id);
    });
  });
  assert.deepEqual(payload, expected, `${meta.id}: generated payload drifted; run node scripts/generate-course-payloads.mjs`);
  assert.equal(new Set(stageIds).size, stageIds.length, `${meta.id}: stage ids must be unique`);
  assert(stageIds.every((id) => /^[a-z0-9-]+-\d{2}$/.test(id)), `${meta.id}: stage ids must be stable slugs`);
  assert(gzipSync(payloadSource).byteLength <= 14_000, `${meta.id}: generated payload exceeds 14 KB gzip budget`);
}

const sitemap = read("sitemap.xml");
const sitemapURLs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.deepEqual(sitemapURLs, [
  `${SITE_ORIGIN}/`,
  `${SITE_ORIGIN}/lab/`,
  ...COURSE_TOPICS.map((topic) => SITE_ORIGIN + topic.path),
], "sitemap must contain only final canonical pages");
assert(!/<(?:priority|changefreq)>/.test(sitemap), "sitemap must not contain ignored priority/changefreq hints");
assert.match(read("articles/index.html"), /<meta name="robots" content="noindex,follow">/, "empty articles page must stay noindex");
assert(!sitemap.includes("/articles/"), "empty articles page must not be in the sitemap");

const labIndex = read("lab/index.html");
const labCourse = read("lab/course.html");
const staticCourseLinks = [...labIndex.matchAll(/<a class="model-card" href="([^"]+)">/g)].map((match) => match[1]);
assert.deepEqual(staticCourseLinks, COURSE_TOPICS.map((topic) => topic.path), "static Lab links must exactly match canonical course paths");
for (const topic of COURSE_TOPICS) {
  assert(labIndex.includes(`href="${topic.path}"`), `${topic.id}: missing static crawlable Lab link`);
  assert(labIndex.includes(`"url": "${SITE_ORIGIN + topic.path}"`), `${topic.id}: Lab JSON-LD URL drifted`);
}
assert(!labIndex.includes("/lab/course?m="), "Lab must not advertise legacy query-string course URLs");
assert(labIndex.includes("/assets/js/course-catalog.js"), "Lab catalogue must load the lightweight course catalog");
assert(labCourse.includes("/assets/js/course-catalog.js"), "Course shell must load the lightweight course catalog");
for (const heavyweight of ["curriculum.js", "curriculum-data.js", "curriculum-questions.js"]) {
  assert(!labIndex.includes(`/assets/js/${heavyweight}`), `Lab catalogue must not load ${heavyweight}`);
  assert(!labCourse.includes(`/assets/js/${heavyweight}`), `Course shell must not load ${heavyweight}`);
}

for (const file of ["index.html", "articles/index.html", "lab/index.html", "lab/course.html"]) {
  assert(read(file).includes('<meta property="og:site_name" content="Anıl Kaya">'), `${file}: site name signal drifted`);
}
const homeGraphs = [...read("index.html").matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((match) => JSON.parse(match[1])["@graph"] || []);
const website = homeGraphs.find((entry) => entry["@type"] === "WebSite");
assert.equal(website?.name, "Anıl Kaya", "homepage WebSite name drifted");

const version = read("assets/version.txt").trim();
assert.match(version, /^\d+$/, "asset version must be an integer");
assert.equal(labCourse.match(/<html[^>]+data-asset-version="(\d+)"/)?.[1], version, "course payload version must match asset version");
const documents = [...filesUnder("articles", (file) => file.endsWith(".html")), ...filesUnder("lab", (file) => file.endsWith(".html")), "index.html", "404.html"];
const referenceFiles = [...documents, "assets/css/base.css"];
let referenceCount = 0;
for (const file of referenceFiles) {
  const source = read(file);
  const assetPattern = /["'(](\/assets\/[^"')?#]+\.(?:css|js|woff2))(?:\?v=(\d+))?/g;
  for (const match of source.matchAll(assetPattern)) {
    referenceCount++;
    assert.equal(match[2], version, `${file}: ${match[1]} must use ?v=${version}`);
    assert(existsSync(path.join(ROOT, match[1].slice(1))), `${file}: missing ${match[1]}`);
  }
}
assert(referenceCount >= 40, "too few versioned asset references were checked");

for (const file of filesUnder("assets/js", (name) => name.endsWith(".js"))) {
  if (file === "assets/js/storage.js") continue;
  assert(!read(file).includes("localStorage"), `${file}: access storage only through IEWTStorage`);
}

function clientHarness(seed = {}, fetchImpl = async () => { throw new Error("unexpected fetch"); }) {
  const values = new Map(Object.entries(seed));
  const listeners = new Map();
  const windowListeners = new Map();
  class ClientEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  class ClientCustomEvent extends ClientEvent {}
  const eventTarget = (registry) => ({
    addEventListener(type, listener) {
      if (!registry.has(type)) registry.set(type, []);
      registry.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of registry.get(event.type) || []) listener(event);
      return true;
    },
  });
  const documentEvents = eventTarget(listeners);
  const windowEvents = eventTarget(windowListeners);
  const document = {
    ...documentEvents,
    body: { appendChild() {} },
    createElement() {
      return {
        className: "", textContent: "", _t: null,
        classList: { add() {}, remove() {} },
        setAttribute() {},
      };
    },
    querySelectorAll() { return []; },
  };
  const window = {
    ...windowEvents,
    TOPIC_META: [{ id: "ols", stages: 4 }],
    CURRICULUM: {},
  };
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const sandbox = {
    window, document, localStorage,
    Event: ClientEvent, CustomEvent: ClientCustomEvent,
    fetch: fetchImpl, Response, Headers,
    location: { href: "" }, console,
    setTimeout, clearTimeout,
  };
  window.document = document;
  vm.createContext(sandbox);
  return { sandbox, window, document, values };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const runClient = (harness, file) => vm.runInContext(read(file), harness.sandbox, { filename: file });

// Legacy learning data migrates once into explicit owner envelopes. Account
// scopes remain isolated on a shared browser and a reset preserves guide width.
{
  const harness = clientHarness({
    "iewt:progress": JSON.stringify({ ols: { done: [0] } }),
    "iewt:gamify": JSON.stringify({ points: 5, streak: 1, last: "2026-07-13" }),
  });
  runClient(harness, "assets/js/storage.js");
  const storage = harness.window.IEWTStorage;
  assert.deepEqual(plain(storage.progress()), { ols: { done: [0] } }, "legacy anonymous progress must migrate");
  storage.bindOwner("g_account_a", { announce: true });
  assert.deepEqual(plain(storage.progress()), { ols: { done: [0] } }, "first account must claim pre-sign-in progress");
  storage.setProgress({ ols: { done: [0, 1] } });
  storage.setGamify({ points: 15, streak: 2, last: "2026-07-14" });
  storage.setSyncGeneration(3);
  storage.bindOwner(null, { claimAnonymous: false, announce: true });
  assert.deepEqual(plain(storage.progress()), {}, "signed-out scope must not expose account progress");
  storage.setProgress({ ols: { done: [2] } });
  storage.bindOwner("g_account_b", { announce: true });
  assert.deepEqual(plain(storage.progress()), { ols: { done: [2] } }, "second account must claim only current anonymous work");
  storage.bindOwner("g_account_a", { announce: true });
  assert.deepEqual(plain(storage.progress()), { ols: { done: [0, 1] } }, "returning account scope was contaminated");
  assert.equal(storage.syncGeneration(), 3, "returning account lost its reset generation");
  const envelope = JSON.parse(harness.values.get("iewt:progress:v2:user%3Ag_account_a"));
  assert.equal(envelope.owner, "user:g_account_a", "persisted progress must carry its explicit owner");
  assert(!harness.values.has("iewt:progress"), "account data must never remain in the unscoped legacy key");
  storage.setGuideWidth(57.5);
  storage.bindOwner("g_account_b", { announce: true });
  storage.setProgress({ ols: { done: [2, 3] } });
  storage.setGamify({ points: 25, streak: 3, last: "2026-07-14" });
  storage.resetLearning("g_account_a", { generation: 4, announce: false });
  assert.deepEqual(plain(storage.progress()), { ols: { done: [2, 3] } }, "resetting a captured owner cleared the active account");
  assert.equal(storage.syncGeneration(), 0, "owner generations must remain isolated");
  assert.equal(storage.syncGeneration("g_account_a"), 4, "captured owner generation was not advanced");
  storage.bindOwner("g_account_a", { announce: true });
  assert.deepEqual(plain(storage.progress()), {}, "owner reset must clear progress");
  assert.deepEqual(plain(storage.gamify()), { points: 0, streak: 0, last: null }, "owner reset must clear gamification");
  assert.equal(storage.guideWidth(), 57.5, "learning reset must preserve guide width");
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

// A signed-in reset is server-first and serialized behind any in-flight write.
// Failure leaves owner-scoped local state and the device-wide guide untouched.
{
  const requests = [];
  let holdProgressPut = false, progressPutResolve = null;
  let deleteResolve = null, failDelete = false;
  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  });
  const fetchImpl = (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://example.test");
    const method = options.method || "GET";
    requests.push({ path: url.pathname, method, headers: new Headers(options.headers) });
    if (url.pathname === "/api/me") return Promise.resolve(response({ user: { id: "g_reset", name: "Reset Learner", email: "" } }));
    if (url.pathname === "/api/progress" && method === "GET") return Promise.resolve(response({ progress: {}, generation: 0 }));
    if (url.pathname === "/api/stats" && method === "GET") return Promise.resolve(response({ stats: { points: 0, streak: 0, last: null }, generation: 0 }));
    if (url.pathname === "/api/stats" && method === "PUT") return Promise.resolve(response({ ok: true, stats: { points: 0, streak: 0, last: null }, generation: 0 }));
    if (url.pathname === "/api/progress" && method === "PUT" && holdProgressPut) {
      return new Promise((resolve) => { progressPutResolve = resolve; });
    }
    if (url.pathname === "/api/progress" && method === "PUT") return Promise.resolve(response({ ok: true, done: [0], generation: 0 }));
    if (url.pathname === "/api/progress" && method === "DELETE") {
      if (failDelete) return Promise.resolve(response({ error: { code: "temporary" } }, 503));
      return new Promise((resolve) => { deleteResolve = resolve; });
    }
    return Promise.resolve(response({ error: { code: "not_found" } }, 404));
  };

  const harness = clientHarness({}, fetchImpl);
  runClient(harness, "assets/js/storage.js");
  runClient(harness, "assets/js/gamify.js");
  runClient(harness, "assets/js/auth.js");
  const { IEWTStorage: storage, Gamify, Auth } = harness.window;
  await Auth.whenReady();
  assert.equal(storage.owner(), "g_reset", "authenticated storage owner was not bound");
  storage.setGuideWidth(61);
  storage.setProgress({ ols: { done: [0] } });
  Gamify.merge({ points: 100, streak: 2, last: "2026-07-13" }, { progressComplete: false });
  assert.equal(Gamify.get().points, 100, "test setup did not establish a remote point floor");

  holdProgressPut = true;
  const staleWrite = Auth.pushProgress("ols", [0]);
  await waitFor(() => !!progressPutResolve, "progress PUT did not enter the mutation lane");
  const reset = Auth.resetProgress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(plain(storage.progress()), { ols: { done: [0] } }, "reset cleared local progress before server success");
  progressPutResolve(response({ ok: true, done: [0], generation: 0 }));
  await staleWrite;
  await waitFor(() => !!deleteResolve, "DELETE did not wait behind the in-flight PUT");
  assert.deepEqual(plain(storage.progress()), { ols: { done: [0] } }, "pending DELETE cleared local progress early");
  const mutationRequests = requests.filter((request) => request.method !== "GET");
  assert.deepEqual(mutationRequests.map(({ method }) => method), ["PUT", "DELETE"], "reset mutation ordering drifted");
  assert(mutationRequests.every((request) => request.headers.get("x-iewt-owner") === "g_reset"), "mutations must declare their verified owner");
  assert.equal(mutationRequests[0].headers.get("x-iewt-generation"), "0", "progress PUT must carry its owner generation");
  assert.equal(mutationRequests[1].headers.get("x-iewt-generation"), null, "reset must not claim a stale generation");
  deleteResolve(response({ ok: true, progress: {}, stats: { points: 0, streak: 0, last: null }, generation: 1 }));
  await reset;
  assert.deepEqual(plain(storage.progress()), {}, "successful reset did not clear local progress");
  assert.deepEqual(plain(Gamify.get()), { points: 0, streak: 0, last: null }, "reset did not clear gamification closure state");
  assert.equal(storage.syncGeneration(), 1, "successful reset did not retain the server generation");
  assert.equal(storage.guideWidth(), 61, "signed-in reset removed guide width");

  storage.setProgress({ ols: { done: [1] } });
  storage.setGamify({ points: 15, streak: 1, last: "2026-07-14" });
  failDelete = true;
  await assert.rejects(Auth.resetProgress(), /Nothing was removed from this device/);
  assert.deepEqual(plain(storage.progress()), { ols: { done: [1] } }, "failed server reset cleared local progress");
  assert.equal(storage.gamify().streak, 1, "failed server reset cleared local gamification");
  assert.equal(storage.guideWidth(), 61, "failed reset removed guide width");
}

// A successful server reset clears the owner captured at confirmation time,
// even when another tab changes the active account before DELETE completes.
{
  let deleteResolve = null;
  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  });
  const fetchImpl = (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://example.test");
    const method = options.method || "GET";
    if (url.pathname === "/api/me") return Promise.resolve(response({ user: { id: "g_captured", name: "Captured Learner", email: "" } }));
    if (url.pathname === "/api/progress" && method === "GET") return Promise.resolve(response({ progress: {}, generation: 0 }));
    if (url.pathname === "/api/stats" && method === "GET") return Promise.resolve(response({ stats: { points: 0, streak: 0, last: null }, generation: 0 }));
    if (url.pathname === "/api/progress" && method === "DELETE") return new Promise((resolve) => { deleteResolve = resolve; });
    return Promise.resolve(response({ error: { code: "not_found" } }, 404));
  };

  const harness = clientHarness({}, fetchImpl);
  runClient(harness, "assets/js/storage.js");
  runClient(harness, "assets/js/gamify.js");
  runClient(harness, "assets/js/auth.js");
  const { IEWTStorage: storage, Auth } = harness.window;
  await Auth.whenReady();
  storage.setProgress({ ols: { done: [0, 1] } });
  storage.setGamify({ points: 15, streak: 2, last: "2026-07-14" });
  const reset = Auth.resetProgress();
  await waitFor(() => !!deleteResolve, "captured-owner DELETE did not start");

  harness.values.set(storage.KEYS.activeOwner, "user:g_other");
  const external = new harness.sandbox.Event("storage");
  external.key = storage.KEYS.activeOwner;
  external.newValue = "user:g_other";
  harness.window.dispatchEvent(external);
  storage.setProgress({ ols: { done: [3] } });
  storage.setGamify({ points: 20, streak: 1, last: "2026-07-14" });

  deleteResolve(response({ ok: true, progress: {}, stats: { points: 0, streak: 0, last: null }, generation: 1 }));
  const result = await reset;
  assert.equal(result.active, false, "owner-switch reset incorrectly treated the captured account as active");
  assert.equal(Auth.status(), "account-changed", "reset success overwrote the account-changed state");
  assert.deepEqual(plain(storage.progress()), { ols: { done: [3] } }, "captured-owner reset cleared the new active scope");
  assert.equal(storage.gamify().points, 20, "captured-owner reset repainted the active gamification state");
  storage.bindOwner("g_captured", { claimAnonymous: false, announce: false });
  assert.deepEqual(plain(storage.progress()), {}, "captured owner retained progress after confirmed reset");
  assert.deepEqual(plain(storage.gamify()), { points: 0, streak: 0, last: null }, "captured owner retained gamification after confirmed reset");
  assert.equal(storage.syncGeneration(), 1, "captured owner did not retain the reset generation");
}

// A newer server generation is a reset barrier: stale persisted data is
// discarded before merge, so signing back in cannot upload pre-reset state.
{
  const owner = "user:g_returning";
  const encoded = encodeURIComponent(owner);
  const seed = {
    [`iewt:progress:v2:${encoded}`]: JSON.stringify({ version: 2, owner, value: { ols: { done: [0, 1] } } }),
    [`iewt:gamify:v2:${encoded}`]: JSON.stringify({ version: 2, owner, value: { points: 15, streak: 2, last: "2026-07-13" } }),
    [`iewt:sync:v2:${encoded}`]: JSON.stringify({ version: 2, owner, generation: 0 }),
  };
  const mutations = [];
  const response = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetchImpl = (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://example.test");
    const method = options.method || "GET";
    if (method === "PUT") mutations.push({ path: url.pathname, generation: new Headers(options.headers).get("x-iewt-generation") });
    if (url.pathname === "/api/me") return Promise.resolve(response({ user: { id: "g_returning", name: "Returning Learner", email: "" } }));
    if (url.pathname === "/api/progress" && method === "GET") return Promise.resolve(response({ progress: {}, generation: 2 }));
    if (url.pathname === "/api/stats" && method === "GET") return Promise.resolve(response({ stats: { points: 0, streak: 0, last: null }, generation: 2 }));
    return Promise.resolve(response({ ok: true, generation: 2 }));
  };

  const harness = clientHarness(seed, fetchImpl);
  runClient(harness, "assets/js/storage.js");
  runClient(harness, "assets/js/gamify.js");
  runClient(harness, "assets/js/auth.js");
  await harness.window.Auth.whenReady();
  assert.deepEqual(plain(harness.window.IEWTStorage.progress()), {}, "newer generation merged stale progress");
  assert.deepEqual(plain(harness.window.Gamify.get()), { points: 0, streak: 0, last: null }, "newer generation merged stale rewards");
  assert.equal(harness.window.IEWTStorage.syncGeneration(), 2, "newer server generation was not persisted");
  assert.deepEqual(mutations, [], "pre-reset state was reuploaded after sign-in");
}

for (const file of ["lab/index.html", "lab/course.html", "assets/js/lab-ui.js", "assets/js/lesson-redirect.js", "sitemap.xml"]) {
  assert(!read(file).includes("/lab/course.html"), `${file}: use canonical /lab/course URLs`);
}
assert(read("wrangler.toml").includes("run_worker_first = true"), "Worker must run before assets");
assert(read("wrangler.toml").includes('html_handling = "auto-trailing-slash"'), "HTML handling must be explicit");
for (const file of ["assets/js/lab-ui.js", "assets/js/gamify.js"]) {
  assert(read(file).includes('document.readyState === "loading"'), `${file}: must initialize when DOMContentLoaded is delayed`);
}
assert.match(read("assets/js/lab-ui.js"), /\n  init\(\);\n\}\)\(\);/, "academy must initialize before delayed DOMContentLoaded");
assert.match(read("assets/js/gamify.js"), /\n  Gamify\.paint\(\);\n  \/\//, "gamification must paint before delayed DOMContentLoaded");

let diffBase = process.env.ASSET_DIFF_BASE || "";
if (!diffBase) {
  try { diffBase = execFileSync("git", ["rev-parse", "origin/main"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { /* non-git archive */ }
}
if (/^0+$/.test(diffBase)) {
  try { diffBase = execFileSync("git", ["rev-parse", "HEAD^"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { diffBase = ""; }
}

function assetVersionAt(revision) {
  try {
    return Number(execFileSync("git", ["show", `${revision}:assets/version.txt`], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim());
  } catch {
    try {
      const names = execFileSync("git", ["ls-tree", "-r", "--name-only", revision], { cwd: ROOT, encoding: "utf8" })
        .trim().split("\n").filter((name) => name.endsWith(".html") || name === "assets/css/base.css");
      const found = new Set();
      for (const name of names) {
        const source = execFileSync("git", ["show", `${revision}:${name}`], { cwd: ROOT, encoding: "utf8" });
        for (const match of source.matchAll(/\?v=(\d+)/g)) found.add(Number(match[1]));
      }
      return found.size === 1 ? [...found][0] : null;
    } catch { return null; }
  }
}

if (diffBase) {
  const tracked = execFileSync("git", ["diff", "--name-only", diffBase, "--"], { cwd: ROOT, encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
  const changed = [...new Set((tracked + untracked).trim().split("\n").filter(Boolean))];
  const browserAssetChanged = changed.some((file) => /^assets\/(?:css|js|fonts)\//.test(file));
  if (browserAssetChanged) {
    const previous = assetVersionAt(diffBase);
    assert(Number.isInteger(previous), `could not verify asset version at ${diffBase}`);
    assert(Number(version) > previous, `browser assets changed without increasing version ${previous}`);
  }
}

const assetIgnore = read(".assetsignore");
for (const entry of [
  ".*", ".wrangler/", "articles/_template/", ".dev.vars*", ".env*", "CNAME", "scripts/",
  "assets/js/curriculum.js", "assets/js/curriculum-data.js", "assets/js/curriculum-questions.js",
]) {
  assert(assetIgnore.split(/\r?\n/).includes(entry), `.assetsignore must exclude ${entry}`);
}

const secret = "contract-test-secret-abcdefghijklmnopqrstuvwxyz";
const token = await signSession({ sub: "g_contract", exp: Date.now() + 60000 }, secret);
assert.equal((await verifySession(token, secret)).sub, "g_contract", "valid session rejected");
assert.equal(await verifySession(token, "wrong-secret"), null, "wrong secret accepted");
assert.equal(await verifySession("a.b", secret), null, "malformed session accepted");
const expired = await signSession({ sub: "g_contract", exp: Date.now() - 1 }, secret);
assert.equal(await verifySession(expired, secret), null, "expired session accepted");
assert.equal(getCookie(new Request("https://example.test", { headers: { Cookie: "session=%" } }), "session"), null, "malformed cookie must fail closed");
assert(cookie("session", "a.b", { maxAge: 10 }).includes("Max-Age=10"), "cookie max-age missing");

console.log(`✓ contracts: ${topicIds.length} curricula, ${referenceCount} versioned assets, session hardening`);
