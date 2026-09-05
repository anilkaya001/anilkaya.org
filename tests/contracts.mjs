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
for (const file of ["assets/js/course-catalog.js", "assets/js/skill-catalog.js", "assets/js/curriculum.js", "assets/js/curriculum-data.js", "assets/js/curriculum-academy.js", "assets/js/curriculum-questions.js", "assets/js/stage-catalog.js"]) {
  vm.runInContext(read(file), context, { filename: file });
}

const legacyTopicIds = ["ols", "iv2sls", "did", "var", "panel", "logit", "gmm"];
const topicIds = [...legacyTopicIds, "foundations", "mle", "forecast", "coint", "financial"];
assert.deepEqual([...context.window.TOPIC_META.map((topic) => topic.id)], topicIds, "topic ids drifted");
assert.deepEqual(Object.keys(context.window.CURRICULUM), topicIds, "curriculum ids drifted");
assert.deepEqual(COURSE_TOPICS.map((topic) => topic.id), topicIds, "SEO course ids drifted");
assert.equal(new Set(COURSE_TOPICS.map((topic) => topic.slug)).size, topicIds.length, "course slugs must be unique");

const seoById = Object.fromEntries(COURSE_TOPICS.map((topic) => [topic.id, topic]));

const defaults = { read: 5, code: 10, interactive: 10, conceptlab: 10, codechallenge: 20, case: 15, match: 15, quiz: 15, truefalse: 10, fillblank: 15, numeric: 20, multi: 20 };
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
    if (stage.type === "conceptlab") {
      assert(stage.param && ["min", "max", "step", "value"].every((field) => Number.isFinite(stage.param[field])), `${label}: concept lab control missing`);
      assert(typeof stage.insight === "string" && stage.insight.trim(), `${label}: concept lab insight missing`);
    }
    if (stage.type === "codechallenge") {
      assert(typeof stage.starter === "string" && stage.starter.trim(), `${label}: starter code missing`);
      assert(typeof stage.tests === "string" && /assert\b/.test(stage.tests), `${label}: deterministic grader missing`);
      assert(Array.isArray(stage.hints) && stage.hints.length >= 2, `${label}: staged hints missing`);
    }
    if (stage.type === "case") assert(Array.isArray(stage.steps) && stage.steps.length >= 2, `${label}: case decisions missing`);
    if (stage.type === "match") assert(Array.isArray(stage.pairs) && stage.pairs.length >= 3, `${label}: match pairs missing`);
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
  assert.equal(payload.schemaVersion, 2, `${meta.id}: unsupported payload schema`);
  assert.equal(payload.id, meta.id);
  assert.equal(payload.modules.length, meta.modules);
  const payloadStages = payload.modules.flatMap((module) => module.stages);
  assert.equal(payloadStages.length, meta.stages);
  const stageIds = payloadStages.map((stage) => stage.id);
  assert.equal(new Set(stageIds).size, stageIds.length, `${meta.id}: stage ids must be unique`);
  assert(stageIds.every((id) => /^[a-z0-9][a-z0-9-]{2,127}$/.test(id)), `${meta.id}: stage ids must be stable slugs`);
  for (const stage of payloadStages) {
    assert(Array.isArray(stage.skillIds) && stage.skillIds.length, `${stage.id}: skill links missing`);
    assert(Number.isInteger(stage.estimatedMinutes) && stage.estimatedMinutes > 0, `${stage.id}: estimated minutes missing`);
    assert(["core", "applied", "advanced"].includes(stage.difficulty), `${stage.id}: difficulty missing`);
    assert(Array.isArray(stage.prerequisiteStageIds), `${stage.id}: prerequisites missing`);
  }
  const manifest = JSON.parse(read(`assets/data/courses/${meta.id}/manifest.json`));
  assert.equal(manifest.totalStages, meta.stages, `${meta.id}: module manifest stage count drifted`);
  for (const module of manifest.modules) {
    const moduleSource = read(`assets/data/courses/${meta.id}/${module.id}.json`);
    assert(gzipSync(moduleSource).byteLength <= 6_144, `${meta.id}/${module.id}: module exceeds 6 KB gzip budget`);
  }
}
assert.equal(context.window.TOPIC_META.reduce((sum, topic) => sum + topic.stages, 0), 365, "academy must contain 365 stages");
assert.equal(context.window.SKILL_CATALOG.length, 84, "academy must contain 84 durable skills");
assert.equal(new Set(context.window.SKILL_CATALOG.map((skill) => skill.id)).size, 84, "skill ids must be unique");
const stableMap = JSON.parse(read("assets/data/stage-id-map-v2.json"));
assert.equal(stableMap.frozenStageCount, 205, "legacy stage freeze must remain immutable at 205 stages");

const placementBank = JSON.parse(read("assets/data/placement-bank.json"));
assert.equal(placementBank.schemaVersion, 1, "placement bank schema version drifted");
assert.equal(placementBank.questions.length, 15, "placement diagnostic must contain exactly 15 questions");
assert.equal(new Set(placementBank.questions.map((item) => item.id)).size, 15, "placement question ids must be unique");
assert.deepEqual(
  Object.fromEntries([...new Set(placementBank.questions.map((item) => item.type))].sort().map((type) => [
    type, placementBank.questions.filter((item) => item.type === type).length,
  ])),
  { boolean: 3, choice: 3, fill: 3, multi: 3, numeric: 3 },
  "placement bank must balance all five question formats",
);
assert.deepEqual(
  Object.fromEntries([...new Set(placementBank.questions.map((item) => item.difficulty))].sort().map((difficulty) => [
    difficulty, placementBank.questions.filter((item) => item.difficulty === difficulty).length,
  ])),
  { advanced: 5, applied: 5, foundation: 5 },
  "placement bank must balance all three difficulty bands",
);
assert.deepEqual(
  [...new Set(placementBank.questions.map((item) => item.topic))].sort(),
  [...legacyTopicIds].sort(),
  "placement bank must cover every course topic",
);
for (const item of placementBank.questions) {
  const label = `placement ${item.id}`;
  assert.match(item.id, /^[a-z0-9-]+$/, `${label}: id must be a stable slug`);
  assert(typeof item.prompt === "string" && item.prompt.trim(), `${label}: prompt missing`);
  assert(typeof item.explanation === "string" && item.explanation.trim(), `${label}: explanation missing`);
  assert(typeof item.topicTitle === "string" && item.topicTitle.trim(), `${label}: topic title missing`);
  if (item.type === "choice") {
    assert(Array.isArray(item.choices) && item.choices.length >= 2, `${label}: choices missing`);
    assert(Number.isInteger(item.answer) && item.answer >= 0 && item.answer < item.choices.length, `${label}: answer invalid`);
  } else if (item.type === "boolean") {
    assert.equal(typeof item.answer, "boolean", `${label}: boolean answer invalid`);
  } else if (item.type === "multi") {
    assert(Array.isArray(item.choices) && item.choices.length >= 2, `${label}: choices missing`);
    assert(Array.isArray(item.answers) && item.answers.length > 0, `${label}: answers missing`);
    assert.equal(new Set(item.answers).size, item.answers.length, `${label}: duplicate answer index`);
    assert(item.answers.every((answer) => Number.isInteger(answer) && answer >= 0 && answer < item.choices.length), `${label}: answer index invalid`);
  } else if (item.type === "numeric") {
    assert(Number.isFinite(item.answer), `${label}: numeric answer invalid`);
    assert(Number.isFinite(item.tolerance) && item.tolerance >= 0, `${label}: numeric tolerance invalid`);
  } else if (item.type === "fill") {
    assert.equal((item.prompt.match(/___/g) || []).length, 1, `${label}: prompt needs exactly one blank`);
    assert(Array.isArray(item.accept) && item.accept.length > 0 && item.accept.every((answer) => typeof answer === "string" && answer.trim()), `${label}: accepted answers missing`);
    assert(typeof item.displayAnswer === "string" && item.displayAnswer.trim(), `${label}: display answer missing`);
  } else {
    assert.fail(`${label}: unknown type ${item.type}`);
  }
}

const sitemap = read("sitemap.xml");
const sitemapURLs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.deepEqual(sitemapURLs, [
  `${SITE_ORIGIN}/`,
  `${SITE_ORIGIN}/lab/`,
  ...COURSE_TOPICS.map((topic) => SITE_ORIGIN + topic.path),
  `${SITE_ORIGIN}/lab/projects/macro-forecasting-desk/`,
  `${SITE_ORIGIN}/lab/projects/fx-volatility-risk/`,
  `${SITE_ORIGIN}/lab/projects/factor-pricing-lab/`,
], "sitemap must contain only final canonical pages");
assert(!/<(?:priority|changefreq)>/.test(sitemap), "sitemap must not contain ignored priority/changefreq hints");
assert.match(read("articles/index.html"), /<meta name="robots" content="noindex,follow">/, "empty articles page must stay noindex");
assert(!sitemap.includes("/articles/"), "empty articles page must not be in the sitemap");

const labIndex = read("lab/index.html");
const labCourse = read("lab/course.html");
const labReview = read("lab/review/index.html");
const labPlacement = read("lab/placement/index.html");
const staticCourseLinks = [...labIndex.matchAll(/<a class="model-card" href="([^"]+)">/g)].map((match) => match[1]);
assert.deepEqual(staticCourseLinks, COURSE_TOPICS.map((topic) => topic.path), "static Lab links must exactly match canonical course paths");
for (const topic of COURSE_TOPICS) {
  assert(labIndex.includes(`href="${topic.path}"`), `${topic.id}: missing static crawlable Lab link`);
  assert(labIndex.includes(SITE_ORIGIN + topic.path), `${topic.id}: Lab JSON-LD URL drifted`);
}
assert(!labIndex.includes("/lab/course?m="), "Lab must not advertise legacy query-string course URLs");
// The shared lab logic ships as one generated bundle (fewer Worker invocations);
// the sources it concatenates must all be present, in order.
const labBundle = read("assets/js/lab-suite.bundle.js");
for (const source of ["course-catalog", "skill-catalog", "stage-catalog", "mastery", "skill-mastery", "storage", "gamify", "auth"]) {
  assert(labBundle.includes(`/* ---- ${source}.js ---- */`), `lab bundle must include ${source}.js`);
}
assert(labIndex.includes("/assets/js/lab-suite.bundle.js"), "Lab catalogue must load the shared lab bundle");
assert(labCourse.includes("/assets/js/lab-suite.bundle.js"), "Course shell must load the shared lab bundle");
for (const asset of ["lab-suite.bundle.js", "lab-review.js"]) {
  assert(labReview.includes(`/assets/js/${asset}`), `Daily review must load ${asset}`);
}
for (const heavyweight of ["lab-core.js", "pyodide.js", "curriculum.js", "curriculum-data.js", "curriculum-questions.js"]) {
  assert(!labReview.includes(`/assets/js/${heavyweight}`), `Daily review must not load ${heavyweight}`);
  assert(!labPlacement.includes(`/assets/js/${heavyweight}`), `Placement diagnostic must not load ${heavyweight}`);
}
for (const asset of ["storage.js", "auth.js", "placement.js"]) {
  assert(labPlacement.includes(`/assets/js/${asset}`), `Placement diagnostic must load ${asset}`);
}
assert(labPlacement.includes('href="https://anilkaya.org/lab/placement/"'), "Placement diagnostic canonical drifted");
assert(labPlacement.includes('href="/lab/"'), "Placement diagnostic must retain a crawlable Lab fallback");
for (const heavyweight of ["curriculum.js", "curriculum-data.js", "curriculum-questions.js"]) {
  assert(!labIndex.includes(`/assets/js/${heavyweight}`), `Lab catalogue must not load ${heavyweight}`);
  assert(!labCourse.includes(`/assets/js/${heavyweight}`), `Course shell must not load ${heavyweight}`);
}

for (const file of ["index.html", "articles/index.html", "lab/index.html", "lab/course.html", "lab/review/index.html", "lab/placement/index.html"]) {
  assert(read(file).includes('<meta property="og:site_name" content="Anıl Kaya">'), `${file}: site name signal drifted`);
}
const homeGraphs = [...read("index.html").matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((match) => JSON.parse(match[1])["@graph"] || []);
const website = homeGraphs.find((entry) => entry["@type"] === "WebSite");
assert.equal(website?.name, "Anıl Kaya", "homepage WebSite name drifted");

const version = read("assets/version.txt").trim();
assert.match(version, /^\d+$/, "asset version must be an integer");
assert.equal(labCourse.match(/<html[^>]+data-asset-version="(\d+)"/)?.[1], version, "course payload version must match asset version");
assert.equal(labReview.match(/<html[^>]+data-asset-version="(\d+)"/)?.[1], version, "review payload version must match asset version");
assert.equal(labPlacement.match(/<html[^>]+data-asset-version="(\d+)"/)?.[1], version, "placement payload version must match asset version");
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
  // storage.js is the sanctioned localStorage owner; the lab bundle is exempt
  // because it concatenates storage.js verbatim.
  if (file === "assets/js/storage.js" || file === "assets/js/lab-suite.bundle.js") continue;
  assert(!read(file).includes("localStorage"), `${file}: access storage only through IEWTStorage`);
}

// Share cards are 1200x630 and must stay palette PNGs (scripts/optimize-og-images.py):
// a truecolour re-export roughly doubles them for no visible gain. The IHDR chunk
// is fixed-offset — width/height at 16, bit depth 24, colour type 25 (3 = palette).
for (const file of filesUnder("assets/img", (name) => /^og.*\.png$/.test(name))) {
  const header = readFileSync(path.join(ROOT, file)).subarray(0, 26);
  assert.equal(header.readUInt32BE(16), 1200, `${file}: Open Graph width must be 1200`);
  assert.equal(header.readUInt32BE(20), 630, `${file}: Open Graph height must be 630`);
  assert.equal(header[25], 3, `${file}: run scripts/optimize-og-images.py — share cards must be palette PNGs`);
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
  storage.setMastery({
    "ols:ols-line-04": { level: 1, dueDay: "2026-07-14", attempts: 1, correct: 99, lastResult: true, lastAttemptId: "anon-1", updatedAt: 10 },
    "invalid item": { level: 99, dueDay: "never" },
  });
  storage.queueMasteryAttempt({ itemId: "ols:ols-line-04", attemptId: "anon-1", correct: true, hinted: false, day: "2026-07-13" });
  storage.setPlacement({
    band: "foundation", score: 3, total: 15, completedDay: "2026-07-13", recommendedTopic: "ols",
    responses: ["must-not-persist"],
  });
  storage.bindOwner("g_account_a", { announce: true });
  assert.deepEqual(plain(storage.progress()), { ols: { done: [0] } }, "first account must claim pre-sign-in progress");
  assert.equal(storage.mastery()["ols:ols-line-04"].level, 1, "first account must claim pre-sign-in mastery");
  assert.equal(storage.mastery()["ols:ols-line-04"].correct, 1, "mastery correctness cannot exceed attempts");
  assert.equal(storage.masteryOutbox().length, 1, "first account must claim queued review attempts");
  assert.deepEqual(plain(storage.placement()), {
    band: "foundation", score: 3, total: 15, completedDay: "2026-07-13", recommendedTopic: "ols",
  }, "first account must claim only the minimal sanitized placement result");
  storage.setProgress({ ols: { done: [0, 1] } });
  storage.setGamify({ points: 15, streak: 2, last: "2026-07-14" });
  storage.setSyncGeneration(3);
  storage.bindOwner(null, { claimAnonymous: false, announce: true });
  assert.deepEqual(plain(storage.progress()), {}, "signed-out scope must not expose account progress");
  assert.equal(storage.placement(), null, "signed-out scope must not expose account placement");
  storage.setProgress({ ols: { done: [2] } });
  storage.bindOwner("g_account_b", { announce: true });
  assert.deepEqual(plain(storage.progress()), { ols: { done: [2] } }, "second account must claim only current anonymous work");
  storage.bindOwner("g_account_a", { announce: true });
  assert.deepEqual(plain(storage.progress()), { ols: { done: [0, 1] } }, "returning account scope was contaminated");
  assert.equal(storage.mastery()["ols:ols-line-04"].lastAttemptId, "anon-1", "returning account mastery was contaminated");
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
  assert.deepEqual(plain(storage.mastery()), {}, "owner reset must clear mastery");
  assert.deepEqual(plain(storage.masteryOutbox()), [], "owner reset must clear queued review attempts");
  assert.equal(storage.placement(), null, "owner reset must clear the placement result");
  assert.equal(storage.guideWidth(), 57.5, "learning reset must preserve guide width");
}

// Streak persistence is capped at the shared Worker/storage maximum instead
// of wrapping a long-lived learner back to zero on the next activity day.
{
  const harness = clientHarness();
  runClient(harness, "assets/js/storage.js");
  runClient(harness, "assets/js/gamify.js");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  harness.window.IEWTStorage.setGamify({ points: 0, streak: 100000, last: day(yesterday) });
  assert.equal(harness.window.Gamify.touch().streak, 100000, "review activity overflowed the streak cap");
  harness.window.IEWTStorage.setGamify({ points: 0, streak: 100000, last: day(yesterday) });
  assert.equal(harness.window.Gamify.award(5).streak, 100000, "course activity overflowed the streak cap");
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

// A bootstrap snapshot is sufficient for the ordinary signed-in path. If this
// device contributes offline progress during that merge, auth performs exactly
// one follow-up stats read so server-derived points cannot lag the uploaded work.
{
  const calls = [];
  let progressSaved = false;
  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  });
  const fetchImpl = (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://example.test");
    const method = options.method || "GET";
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/v2/bootstrap" && method === "GET") return Promise.resolve(response({
      user: { id: "g_bootstrap_merge", name: "Bootstrap Learner", email: "" },
      progress: {}, stats: { points: 0, streak: 0, last: null }, mastery: {}, placement: null, generation: 0,
      stableProgress: {}, skillMastery: {}, preferences: {
        activePathId: "balanced", sessionMinutes: 20, weeklyGoalMinutes: 100,
      }, projects: {},
    }));
    if (url.pathname === "/api/progress" && method === "PUT") {
      progressSaved = true;
      return Promise.resolve(response({ ok: true, done: [0], generation: 0 }));
    }
    if (url.pathname === "/api/stats" && method === "GET" && progressSaved) {
      return Promise.resolve(response({ stats: { points: 5, streak: 0, last: null }, generation: 0 }));
    }
    if (url.pathname === "/api/v2/preferences" && method === "PUT") {
      return Promise.resolve(response({
        preferences: { activePathId: "balanced", sessionMinutes: 20, weeklyGoalMinutes: 100 },
        generation: 0,
      }));
    }
    return Promise.resolve(response({ error: { code: "not_found" } }, 404));
  };
  const harness = clientHarness({
    "iewt:progress": JSON.stringify({ ols: { done: [0] } }),
    "iewt:gamify": JSON.stringify({ points: 5, streak: 0, last: null }),
  }, fetchImpl);
  runClient(harness, "assets/js/course-catalog.js");
  runClient(harness, "assets/js/storage.js");
  runClient(harness, "assets/js/gamify.js");
  runClient(harness, "assets/js/auth.js");
  await harness.window.Auth.whenReady();
  assert.deepEqual(calls, [
    "GET /api/v2/bootstrap", "PUT /api/progress", "GET /api/stats", "PUT /api/v2/preferences",
  ], "bootstrap merge request shape drifted");
  assert.deepEqual(plain(harness.window.IEWTStorage.progress()), { ols: { done: [0] } }, "bootstrap merge lost offline progress");
  assert.equal(harness.window.Gamify.get().points, 5, "bootstrap merge left derived points stale");
}

// A returning owner's offline mastery attempt is replayed only into that
// owner, carries the reset generation, and is removed only after acceptance.
{
  const owner = "user:g_mastery";
  const encoded = encodeURIComponent(owner);
  const itemId = "ols:ols-line-04";
  const queued = { itemId, attemptId: "replay-1", correct: true, hinted: false, day: "2026-07-14" };
  const seed = {
    [`iewt:mastery:v2:${encoded}`]: JSON.stringify({
      version: 2,
      owner,
      value: { [itemId]: { level: 1, dueDay: "2026-07-15", attempts: 1, correct: 1, lastResult: true, lastAttemptId: "replay-1", updatedAt: 10 } },
    }),
    [`iewt:mastery-outbox:v2:${encoded}`]: JSON.stringify({ version: 2, owner, value: [queued] }),
    [`iewt:sync:v2:${encoded}`]: JSON.stringify({ version: 2, owner, generation: 0 }),
  };
  const masteryPuts = [];
  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  });
  const fetchImpl = (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://example.test");
    const method = options.method || "GET";
    if (url.pathname === "/api/me") return Promise.resolve(response({ user: { id: "g_mastery", name: "Mastery Learner", email: "" } }));
    if (url.pathname === "/api/progress" && method === "GET") return Promise.resolve(response({ progress: {}, generation: 0 }));
    if (url.pathname === "/api/stats" && method === "GET") return Promise.resolve(response({ stats: { points: 0, streak: 0, last: null }, generation: 0 }));
    if (url.pathname === "/api/mastery" && method === "GET") return Promise.resolve(response({ mastery: {}, generation: 0 }));
    if (url.pathname === "/api/mastery" && method === "PUT") {
      const event = JSON.parse(options.body);
      masteryPuts.push({ event, headers: new Headers(options.headers) });
      const second = event.attemptId === "live-2";
      return Promise.resolve(response({
        ok: true,
        record: {
          level: second ? 2 : 1,
          dueDay: second ? "2026-07-18" : "2026-07-15",
          attempts: second ? 2 : 1,
          correct: second ? 2 : 1,
          lastResult: true,
          lastAttemptId: event.attemptId,
          updatedAt: second ? 20 : 10,
        },
        duplicate: false,
        generation: 0,
      }));
    }
    return Promise.resolve(response({ error: { code: "not_found" } }, 404));
  };

  const harness = clientHarness(seed, fetchImpl);
  runClient(harness, "assets/js/mastery.js");
  runClient(harness, "assets/js/storage.js");
  runClient(harness, "assets/js/gamify.js");
  runClient(harness, "assets/js/auth.js");
  const { IEWTStorage: storage, Auth } = harness.window;
  await Auth.whenReady();
  assert.equal(storage.owner(), "g_mastery", "mastery replay escaped its captured owner");
  assert.deepEqual(plain(storage.masteryOutbox()), [], "accepted offline mastery attempt remained queued");
  assert.equal(storage.mastery()[itemId].lastAttemptId, "replay-1", "accepted replay did not replace local mastery");
  assert.equal(masteryPuts.length, 1, "offline mastery replay count drifted");
  assert.equal(masteryPuts[0].headers.get("x-iewt-owner"), "g_mastery", "mastery replay omitted its verified owner");
  assert.equal(masteryPuts[0].headers.get("x-iewt-generation"), "0", "mastery replay omitted its reset generation");

  const live = await Auth.recordMasteryAttempt(itemId, {
    correct: true,
    hinted: false,
    attemptId: "live-2",
    day: "2026-07-15",
  });
  assert.equal(live.synced, true, "live mastery attempt did not synchronize");
  assert.equal(live.record.level, 2, "live mastery response was not persisted");
  assert.deepEqual(plain(storage.masteryOutbox()), [], "accepted live mastery attempt remained queued");
  assert.deepEqual(masteryPuts.map(({ event }) => event.attemptId), ["replay-1", "live-2"]);
}

// Anonymous reset emits the same complete-area contract as an authenticated
// reset so every page can repaint mastery without special casing ownership.
{
  const response = (value) => new Response(JSON.stringify(value), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
  const harness = clientHarness({}, () => Promise.resolve(response({ user: null })));
  runClient(harness, "assets/js/storage.js");
  runClient(harness, "assets/js/gamify.js");
  runClient(harness, "assets/js/auth.js");
  await harness.window.Auth.whenReady();
  let resetSynced = null;
  harness.document.addEventListener("iewt:synced", (event) => {
    if (event.detail && event.detail.reset) resetSynced = event.detail;
  });
  await harness.window.Auth.resetProgress();
  assert.equal(resetSynced && resetSynced.masteryComplete, true, "anonymous reset sync event omitted mastery completion");
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
  let resetSynced = null;
  harness.document.addEventListener("iewt:synced", (event) => {
    if (event.detail && event.detail.reset) resetSynced = event.detail;
  });
  assert.equal(storage.owner(), "g_reset", "authenticated storage owner was not bound");
  storage.setGuideWidth(61);
  storage.setProgress({ ols: { done: [0] } });
  storage.setMastery({ "ols:ols-line-04": { level: 2, dueDay: "2026-07-17", attempts: 2, correct: 2, lastResult: true, lastAttemptId: "seed-2", updatedAt: 20 } });
  storage.setPlacement({ band: "foundation", score: 3, total: 15, completedDay: "2026-07-13", recommendedTopic: "ols" });
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
  assert.equal(resetSynced && resetSynced.masteryComplete, true, "reset sync event omitted mastery completion");
  assert.deepEqual(plain(storage.progress()), {}, "successful reset did not clear local progress");
  assert.deepEqual(plain(storage.mastery()), {}, "successful reset did not clear local mastery");
  assert.equal(storage.placement(), null, "successful reset did not clear local placement");
  assert.deepEqual(plain(Gamify.get()), { points: 0, streak: 0, last: null }, "reset did not clear gamification closure state");
  assert.equal(storage.syncGeneration(), 1, "successful reset did not retain the server generation");
  assert.equal(storage.guideWidth(), 61, "signed-in reset removed guide width");

  storage.setProgress({ ols: { done: [1] } });
  storage.setGamify({ points: 15, streak: 1, last: "2026-07-14" });
  storage.setMastery({ "ols:ols-line-04": { level: 1, dueDay: "2026-07-15", attempts: 1, correct: 1, lastResult: true, lastAttemptId: "preserve-1", updatedAt: 30 } });
  storage.setPlacement({ band: "applied", score: 9, total: 15, completedDay: "2026-07-14", recommendedTopic: "did" });
  failDelete = true;
  await assert.rejects(Auth.resetProgress(), /Nothing was removed from this device/);
  assert.deepEqual(plain(storage.progress()), { ols: { done: [1] } }, "failed server reset cleared local progress");
  assert.equal(storage.gamify().streak, 1, "failed server reset cleared local gamification");
  assert.equal(storage.mastery()["ols:ols-line-04"].lastAttemptId, "preserve-1", "failed server reset cleared local mastery");
  assert.equal(storage.placement().recommendedTopic, "did", "failed server reset cleared local placement");
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
    [`iewt:mastery:v2:${encoded}`]: JSON.stringify({ version: 2, owner, value: {
      "ols:ols-line-04": { level: 1, dueDay: "2026-07-14", attempts: 1, correct: 1, lastResult: true, lastAttemptId: "stale-review", updatedAt: 10 },
    } }),
    [`iewt:mastery-outbox:v2:${encoded}`]: JSON.stringify({ version: 2, owner, value: [
      { itemId: "ols:ols-line-04", attemptId: "stale-review", correct: true, hinted: false, day: "2026-07-13" },
    ] }),
    [`iewt:sync:v2:${encoded}`]: JSON.stringify({ version: 2, owner, generation: 0 }),
  };
  const mutations = [];
  const response = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetchImpl = (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://example.test");
    const method = options.method || "GET";
    if (method === "PUT") mutations.push({ path: url.pathname, generation: new Headers(options.headers).get("x-iewt-generation") });
    if (url.pathname === "/api/v2/bootstrap") return Promise.resolve(response({
      user: { id: "g_returning", name: "Returning Learner", email: "" },
      progress: {}, stats: { points: 0, streak: 0, last: null }, mastery: {}, placement: null, generation: 2,
      stableProgress: {}, skillMastery: {}, preferences: {
        activePathId: "balanced", sessionMinutes: 20, weeklyGoalMinutes: 100,
      }, projects: {},
    }));
    if (url.pathname === "/api/me") return Promise.resolve(response({ user: { id: "g_returning", name: "Returning Learner", email: "" } }));
    if (url.pathname === "/api/progress" && method === "GET") return Promise.resolve(response({ progress: {}, generation: 2 }));
    if (url.pathname === "/api/stats" && method === "GET") return Promise.resolve(response({ stats: { points: 0, streak: 0, last: null }, generation: 2 }));
    if (url.pathname === "/api/mastery" && method === "GET") return Promise.resolve(response({ mastery: {}, generation: 2 }));
    return Promise.resolve(response({ ok: true, generation: 2 }));
  };

  const harness = clientHarness(seed, fetchImpl);
  runClient(harness, "assets/js/storage.js");
  runClient(harness, "assets/js/gamify.js");
  runClient(harness, "assets/js/auth.js");
  let remoteResetSynced = null;
  harness.document.addEventListener("iewt:synced", (event) => {
    if (event.detail && event.detail.remote && event.detail.reset) remoteResetSynced = event.detail;
  });
  await harness.window.Auth.whenReady();
  assert.deepEqual(plain(harness.window.IEWTStorage.progress()), {}, "newer generation merged stale progress");
  assert.deepEqual(plain(harness.window.Gamify.get()), { points: 0, streak: 0, last: null }, "newer generation merged stale rewards");
  assert.deepEqual(plain(harness.window.IEWTStorage.mastery()), {}, "newer generation retained stale mastery");
  assert.deepEqual(plain(harness.window.IEWTStorage.masteryOutbox()), [], "newer generation replayed a stale mastery attempt");
  assert.equal(remoteResetSynced && remoteResetSynced.masteryComplete, true, "remote reset sync event omitted mastery completion");
  assert.equal(harness.window.IEWTStorage.syncGeneration(), 2, "newer server generation was not persisted");
  assert.deepEqual(mutations, [], "pre-reset state was reuploaded after sign-in");
}

for (const file of ["lab/index.html", "lab/course.html", "lab/placement/index.html", "assets/js/lab-ui.js", "assets/js/lesson-redirect.js", "sitemap.xml"]) {
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
  // Course payloads and the review/placement/challenge banks under assets/data/
  // are fetched with ?v=<version> and cached immutably for a year, so a content
  // fix there is only picked up by returning learners after a version bump.
  const browserAssetChanged = changed.some((file) => /^assets\/(?:css|js|fonts|data)\//.test(file));
  if (browserAssetChanged) {
    const previous = assetVersionAt(diffBase);
    assert(Number.isInteger(previous), `could not verify asset version at ${diffBase}`);
    assert(Number(version) > previous, `browser assets changed without increasing version ${previous}`);
  }
}

/* ---- the minus sign is in the font, or the discipline is a fiction ----

   Every negative number on this site is written with U+2212 MINUS SIGN rather
   than a hyphen, and the mono webfont is subset. A subset regenerated without
   that codepoint does not error: the browser silently falls back to the system
   font for exactly that one character, so a column of figures gets one glyph
   at a different width and a different weight, and nothing anywhere says so.

   The check reads the woff2's own character map rather than trusting the
   unicode-range in the CSS, which is a DECLARATION about the file and not a
   fact about it. woff2 is a compressed container, so the table directory is
   parsed from the header: the tags are plain ASCII in the first few hundred
   bytes, and `cmap` present plus a plausible size is what a font that can map
   characters at all looks like. The definitive test is the rendered width,
   which tests/flows-render asserts in a browser; this is the cheap tripwire
   that fires in the fast suite when someone swaps the file. */
{
  const fontPath = path.join(ROOT, "assets/fonts/JBM-latin.woff2");
  assert(existsSync(fontPath), "the mono webfont is committed");
  const buf = readFileSync(fontPath);
  assert.equal(buf.subarray(0, 4).toString("latin1"), "wOF2",
    "assets/fonts/JBM-latin.woff2 is a woff2 container");
  const header = buf.subarray(0, 512).toString("latin1");
  assert(header.includes("cmap") || buf.length > 8 * 1024,
    "the webfont carries a character map");
  /* The declared range in base.css must name U+2212 — the file above is what
     serves it, and this is what tells the browser to use the file FOR it. A
     range that omits 2212 makes the glyph unreachable even when it is there. */
  const base = read("assets/css/base.css");
  const jbmBlock = base.slice(base.indexOf("JBM-latin.woff2"));
  const range = jbmBlock.slice(0, jbmBlock.indexOf("}"));
  assert(/U\+2212/.test(range),
    "base.css must declare U+2212 in the mono webfont's unicode-range, or every " +
    "minus sign on the site falls back to the system font");
  assert(/JBM-greek\.woff2/.test(base),
    "and the greek subset ships too — Γ and σ are this section's own notation");
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

/* ---------- no tracked file carries a developer's absolute path ----------

   SCRATCH PROBES HAVE ESCAPED INTO THIS PUBLIC REPOSITORY FOUR TIMES.
   `tests/_d2.mjs` actually shipped in #18; `__chip_probe.html` was one
   `--amend` from shipping; `tests/zz-probe.mjs` appeared while the ignore
   rules were being widened for the previous one. Each author picked a new
   name, so each name-based rule caught the last case and missed the next —
   .gitignore has accumulated `*_tmp.mjs`, `probe-*`, `cardshot-*` and `_*`
   and is still losing.

   So this asserts on a PROPERTY instead of a name. Every one of those files
   hardcoded an absolute path to the machine that produced it, because that is
   what makes a throwaway script convenient; every real file here resolves
   paths relative to its own location, because that is what makes it portable.
   A name can be chosen freshly each time. This cannot be evaded by choosing a
   different name, only by writing a file that is actually portable — which is
   the thing being asked for.

   It also closes a small disclosure: this repository is public, and a
   committed absolute path names a directory layout that nothing here needs
   to publish. */
{
  const HOME_PATH = /\/home\/[a-z_][a-z0-9_-]*\/[A-Za-z0-9._-]+/;
  /* TRACKED FILES ONLY, from git rather than from the filesystem.

     A first version walked the directories and therefore failed on UNTRACKED
     scratch files too — which is stricter than this assertion's own claim and
     the wrong behaviour: a probe sitting in a working tree has escaped
     nothing, and breaking the suite over one would train whoever hits it to
     reach for --no-verify. What must never happen is that such a file gets
     COMMITTED, and the index is exactly the boundary that decides it. */
  const scanned = execFileSync("git", ["ls-files", "-z", "--", "*.js", "*.mjs"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 << 20 })
    .split("\0")
    .filter((f) => f && !f.includes("node_modules"));

  let checkedFiles = 0;
  for (const file of scanned) {
    if (!existsSync(path.join(ROOT, file))) continue;
    checkedFiles++;
    const hit = HOME_PATH.exec(read(file));
    assert(
      hit === null,
      `${file} hardcodes an absolute path (${hit && hit[0]}). Every scratch probe that ` +
      `has escaped into this public repo did exactly this. Resolve paths relative to the ` +
      `file — import.meta.url, or a ROOT computed from it — or do not commit the file.`,
    );
  }
  assert(checkedFiles > 40, `the absolute-path scan found only ${checkedFiles} files to read`);
}

/* THE DOCK'S "?" IS ONLY FREE IF NOTHING BESIDE IT TAKES A BARE PRINTABLE KEY.
   flows-dock.js binds "?" on `document` and its header says why that is safe.
   That sentence is a measurement, and a measurement left in a comment rots the
   day somebody adds a second listener — silently, because two handlers on one
   key both run and the reader sees whichever acted last. So it is measured
   here instead.

   THE RULE IS NOT "NO BARE PRINTABLE KEYS ANYWHERE". lab-ui.js binds "/" and
   is entitled to: /lab/ is a static page that loads no Flows asset and draws
   no dock. The rule is that a file which SHARES A DOCUMENT with the dock may
   not. Which files those are is read off the two things that actually emit
   script tags — the tracked .html pages, and shared/flows-pages.js, which is
   the shell every gated Flows route is served from and the file that puts the
   dock on them. Reading the emitter rather than a hand-kept list is the whole
   point: no Flows route is a .html file in this repo, so a scan of markup
   alone would have found no document carrying the dock at all and passed by
   measuring nothing. */
{
  const DOC_KEY = /document\.addEventListener\(\s*["'`]key(?:down|press|up)["'`]/;
  /* A one-character `key` comparison is a bare printable key. "Escape",
     "ArrowRight" and the rest are longer, so they do not match and are not
     contested: a named key is not something "?" can collide with. Both
     polarities, because a handler may guard with !== and return, or act
     on ===. */
  const BARE = /\.key\s*[!=]==\s*"([ -~])"/g;
  const jsFiles = execFileSync("git", ["ls-files", "-z", "--", "assets/js/*.js"],
    { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  const htmlFiles = execFileSync("git", ["ls-files", "-z", "--", "*.html"],
    { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  const SHELL = "shared/flows-pages.js";
  const shell = read(SHELL);
  assert(shell.includes("assets/js/flows-dock.js"),
    `${SHELL} no longer emits the dock. Either it moved, and this scan is now reading the ` +
    `wrong file, or the dock is gone and flows-dock.js's header should go with it.`);
  const documents = [
    { where: SHELL, loads: (file) => shell.includes(file) },
    ...htmlFiles
      .filter((page) => read(page).includes("assets/js/flows-dock.js"))
      .map((page) => ({ where: page, loads: (file) => read(page).includes(file) })),
  ];
  const listeners = jsFiles.filter((file) => DOC_KEY.test(read(file)));
  assert(listeners.includes("assets/js/flows-dock.js"),
    "the scan found no document-level key listener in flows-dock.js, so it is not reading " +
    "what that file's header claims to have surveyed and would pass by seeing nothing");
  const contested = [];
  for (const file of listeners) {
    if (file === "assets/js/flows-dock.js") continue;
    const keys = [...read(file).matchAll(BARE)].map((m) => m[1]);
    if (!keys.length) continue;
    const shared = documents.filter((doc) => doc.loads(file)).map((doc) => doc.where);
    if (shared.length) contested.push(`${file} binds ${keys.join(", ")} — shared with the dock by ${shared.join(", ")}`);
  }
  assert.deepEqual(contested, [],
    `a file sharing a document with the dock binds a bare printable key: ${contested.join("; ")}. ` +
    `flows-dock.js's header says "?" is free on the routes it mounts on; either that key is now ` +
    `contested — two handlers, one keystroke, no error — or the header must stop saying so.`);
}

console.log(`✓ contracts: ${topicIds.length} curricula, ${referenceCount} versioned assets, session hardening`);
