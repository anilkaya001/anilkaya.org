import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
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
for (const file of ["assets/js/curriculum.js", "assets/js/curriculum-data.js", "assets/js/curriculum-questions.js"]) {
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
  assert.equal(course.modules.length, 4, `${meta.id}: expected four modules`);
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
const staticCourseLinks = [...labIndex.matchAll(/<a class="model-card" href="([^"]+)">/g)].map((match) => match[1]);
assert.deepEqual(staticCourseLinks, COURSE_TOPICS.map((topic) => topic.path), "static Lab links must exactly match canonical course paths");
for (const topic of COURSE_TOPICS) {
  assert(labIndex.includes(`href="${topic.path}"`), `${topic.id}: missing static crawlable Lab link`);
  assert(labIndex.includes(`"url": "${SITE_ORIGIN + topic.path}"`), `${topic.id}: Lab JSON-LD URL drifted`);
}
assert(!labIndex.includes("/lab/course?m="), "Lab must not advertise legacy query-string course URLs");

for (const file of ["index.html", "articles/index.html", "lab/index.html", "lab/course.html"]) {
  assert(read(file).includes('<meta property="og:site_name" content="Anıl Kaya">'), `${file}: site name signal drifted`);
}
const homeGraphs = [...read("index.html").matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((match) => JSON.parse(match[1])["@graph"] || []);
const website = homeGraphs.find((entry) => entry["@type"] === "WebSite");
assert.equal(website?.name, "Anıl Kaya", "homepage WebSite name drifted");

const version = read("assets/version.txt").trim();
assert.match(version, /^\d+$/, "asset version must be an integer");
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

for (const file of ["lab/index.html", "lab/course.html", "assets/js/lab-ui.js", "assets/js/lesson-redirect.js", "sitemap.xml"]) {
  assert(!read(file).includes("/lab/course.html"), `${file}: use canonical /lab/course URLs`);
}
assert(read("wrangler.toml").includes("run_worker_first = true"), "Worker must run before assets");
assert(read("wrangler.toml").includes('html_handling = "auto-trailing-slash"'), "HTML handling must be explicit");

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
for (const entry of [".*", ".wrangler/", "articles/_template/", ".dev.vars*", ".env*", "CNAME"]) {
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
