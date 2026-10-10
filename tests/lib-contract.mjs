import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions, launch, CHROMIUM_PATH_VAR } from "./lib/browser.mjs";
import { servedFiles, assetsIgnorePatterns, WRANGLER_DEFAULT_IGNORES } from "./lib/served-tree.mjs";
import * as CPU from "./lib/cpu-budget.mjs";
import { fakeD1 } from "./lib/d1-fake.mjs";
import zlib from "node:zlib";
import { createWireReader, summariseWire } from "./lib/ws-wire.mjs";
import { nightlyEmit, emitFiles, emitRead, sourceFingerprint, EMIT_MARK, DRY_NOW } from "./lib/nightly-emit.mjs";
import { nightlyFiles, nightlySource, nightlySlice, nightlyExecution, treeFiles, NIGHTLY_ENTRY, NIGHTLY_DIR } from "./lib/source-scan.mjs";
import { utimesSync, readdirSync as listDir } from "node:fs";
import { plan as bumpPlan, referenceFiles } from "../scripts/bump-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUMP = path.join(ROOT, "scripts/bump-assets.mjs");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const throwsLike = (fn, re, msg) => { assert.throws(fn, re, msg); checks++; };
const scratch = mkdtempSync(path.join(tmpdir(), "lib-contract-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const said = (r) => ((r.stderr || "").trim() || (r.stdout || "").trim()).split("\n").join(" | ");
const notes = [];

{
  const exe = path.join(scratch, "fake-chromium");
  writeFileSync(exe, "");
  deep(launchOptions({}, {}), {}, "browser: with PW_CHROMIUM_PATH unset, launch() passes Playwright exactly what the caller passed, so CI is unchanged");
  deep(launchOptions({ headless: true, args: ["--x"] }, {}), { headless: true, args: ["--x"] }, "browser: the caller's options pass through untouched");
  deep(launchOptions({}, { [CHROMIUM_PATH_VAR]: exe }), { executablePath: exe }, "browser: PW_CHROMIUM_PATH becomes executablePath");
  deep(launchOptions({ executablePath: "/caller/own" }, { [CHROMIUM_PATH_VAR]: exe }), { executablePath: "/caller/own" }, "browser: an explicit executablePath wins over the variable");
  const input = { headless: true };
  launchOptions(input, { [CHROMIUM_PATH_VAR]: exe });
  deep(input, { headless: true }, "browser: the caller's object is not mutated");
  throwsLike(() => launchOptions({}, { [CHROMIUM_PATH_VAR]: path.join(scratch, "absent") }), /PW_CHROMIUM_PATH=.*is not a file/, "browser: a variable that names no file fails loudly instead of falling back");
  throwsLike(() => launchOptions({}, { [CHROMIUM_PATH_VAR]: scratch }), /is not a file/, "browser: a directory is refused too");
  deep(launchOptions({}, { [CHROMIUM_PATH_VAR]: "" }), {}, "browser: an empty variable is the same as unset");
  if (process.env[CHROMIUM_PATH_VAR]) {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      eq(await page.evaluate(() => 6 * 7), 42, `browser: launch() starts the Chromium at ${process.env[CHROMIUM_PATH_VAR]} and runs a page`);
      console.log(`  browser: launched ${process.env[CHROMIUM_PATH_VAR]} (Chromium ${browser.version()})`);
    } finally { await browser.close(); }
  } else notes.push("browser: PW_CHROMIUM_PATH unset, real launch not exercised");
}

{
  const served = servedFiles();
  const set = new Set(served);
  for (const f of ["worker.js", "wrangler.toml", "schema.sql", "AGENTS.md", "tests/contracts.mjs", "tests/lib/served-tree.mjs", "shared/flows-pages.js", "scripts/bump-assets.mjs", ".assetsignore", ".gitignore", "_headers", "CNAME", "articles/_template/index.html", "assets/js/curriculum.js"]) {
    ok(!set.has(f), `served tree: ${f} is not served`);
  }
  for (const f of ["index.html", "404.html", "assets/css/base.css", "assets/js/nav.js", "assets/version.txt", "assets/fonts-version.txt", "lab/course.html", "robots.txt"]) {
    ok(set.has(f), `served tree: ${f} is served`);
  }
  ok(!served.some((f) => f.endsWith(".md")), "served tree: no Markdown file is served");
  ok(!served.some((f) => f.startsWith("tests/") || f.startsWith("shared/") || f.startsWith("scripts/") || f.startsWith("migrations/") || f.startsWith(".")), "served tree: no test, shared, script, migration or dot path is served");
  deep(served, served.slice().sort(), "served tree: the list is sorted");
  const raw = servedFiles({ defaults: false });
  deep(raw.filter((f) => !set.has(f)), ["_headers"], "served tree: without wrangler's three defaults the only addition is _headers (no .assetsignore line removes it)");
  deep(assetsIgnorePatterns().slice(0, 3), [...WRANGLER_DEFAULT_IGNORES], "served tree: wrangler's defaults lead the pattern list");
  console.log(`  served tree: ${served.length} files served, ${raw.length} before wrangler's defaults`);
}

{
  const repo = path.join(scratch, "repo");
  mkdirSync(repo);
  const put = (rel, text = rel) => { mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); writeFileSync(path.join(repo, rel), text); };
  const sh = (...args) => execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  sh("init", "-q");
  writeFileSync(path.join(repo, ".assetsignore"), ".*\ntests/\nshared/\nflows/\nworker.js\n*.md\n");
  for (const f of ["worker.js", "tests/x", "foo.md", "assets/x.css", "assets/data/a.json", "_headers", "docs/spec.yaml", "shared/m.js", "flows/index.html", "lab/index.html", ".github/w.yml", "deleted.txt"]) put(f);
  sh("add", "-f", ".");
  rmSync(path.join(repo, "deleted.txt"));
  put("assets/new.js");
  symlinkSync("assets/x.css", path.join(repo, "link.css"));
  symlinkSync("assets", path.join(repo, "dirlink"));
  symlinkSync("absent.css", path.join(repo, "dangling.css"));
  throwsLike(() => servedFiles({ root: repo }), /dangling\.css is a symbolic link to nothing outside \.assetsignore; wrangler stats every unignored entry and a dangling link fails the whole asset upload/, "served tree: an unignored untracked symlink to nothing throws, because wrangler's fs.stat of it rejects and fails the upload, so it cannot be reported as not served");
  rmSync(path.join(repo, "dangling.css"));
  symlinkSync("absent.js", path.join(repo, "gone.js"));
  sh("add", "-f", "gone.js");
  throwsLike(() => servedFiles({ root: repo }), /gone\.js is a symbolic link to nothing/, "served tree: a tracked one throws too");
  sh("rm", "-q", "--cached", "gone.js");
  rmSync(path.join(repo, "gone.js"));
  symlinkSync("absent.md", path.join(repo, "gone.md"));
  symlinkSync("absent", path.join(repo, "tests/gone"));
  const got = servedFiles({ root: repo });
  deep(got, ["assets/data/a.json", "assets/new.js", "assets/x.css", "docs/spec.yaml", "lab/index.html", "link.css"],
    "served tree on a fixture repository with a frozen .assetsignore (.*, tests/, shared/, flows/, worker.js, *.md; docs/ deliberately not listed, so the result depends on servedFiles() alone and not on the live file): worker.js, tests/x, foo.md, _headers, shared/, flows/ and dot paths excluded; assets/x.css included; an untracked file counted and a deleted one not; a symlink to a file served under its own name, as wrangler's stat-following walk uploads it, a symlink to a directory not served, and a symlink to nothing that .assetsignore covers (gone.md, tests/gone) skipped without an error, since wrangler never stats an ignored entry");
  rmSync(path.join(repo, "gone.md"));
  rmSync(path.join(repo, "tests/gone"));
  writeFileSync(path.join(repo, ".assetsignore"), "*.css\n!keep.css\n/top.txt\nbuild/\n");
  put("keep.css"); put("deep/keep.css"); put("a.css"); put("top.txt"); put("deep/top.txt"); put("build/out.js"); put("deep/build/out.js");
  sh("add", "-f", ".");
  const got2 = servedFiles({ root: repo });
  for (const f of ["keep.css", "deep/keep.css", "deep/top.txt", "worker.js", "tests/x"]) ok(got2.includes(f), `served tree, gitignore semantics: ${f} is served`);
  for (const f of ["a.css", "assets/x.css", "top.txt", "build/out.js", "deep/build/out.js", ".assetsignore", "_headers"]) ok(!got2.includes(f), `served tree, gitignore semantics: ${f} is not served`);
  rmSync(path.join(repo, ".assetsignore"));
  const got3 = servedFiles({ root: repo });
  ok(got3.includes("worker.js") && !got3.includes("_headers"), "served tree: with no .assetsignore only wrangler's defaults apply");
  ok(servedFiles({ root: repo, defaults: false }).includes("_headers"), "served tree: and with neither, every regular file is served");
}

{
  const tick = (step) => { let t = 0; return { now: () => (t += step), get t() { return t; } }; };
  const c = tick(1);
  const stats = CPU.measure(() => {}, { windows: 4, perWindow: 5, warmup: 0, now: c.now });
  deep(stats.windows, [0.2, 0.2, 0.2, 0.2], "cpu-budget: a window is the clock's advance over its runs, divided by the runs");
  throwsLike(() => CPU.summarize([1, 2, 3]), /even/, "cpu-budget: an odd number of windows is refused, so the median is always the mean of the middle pair");
  const s = CPU.summarize([4, 1, 3, 2, 8, 6, 5, 7]);
  deep([s.min, s.median, s.mean, s.p95, s.max], [1, 4.5, 4.5, 8, 8], "cpu-budget: min, median, mean, costliest window and max of eight windows");
  let clock = 0;
  const now = () => clock;
  const cost = (ms) => () => { clock += ms; };
  const r = CPU.compare(cost(3), { reference: cost(2), windows: 8, perWindow: 5, warmup: 2, now, resolutionMs: 1 });
  eq(r.ratio.median, 1.5, "cpu-budget: a subject that costs 3 against a reference of 2 is 1.5x");
  eq(r.floorMs, 0.2, "cpu-budget: the floor is the clock's resolution spread over the runs of a window");
  ok(CPU.checkBudget(r, { median: 1.5, worst: 1.5 }).ok, "cpu-budget: a ratio at its limit passes");
  const over = CPU.checkBudget(r, { median: 1.4 });
  ok(!over.ok && /1\.50x the reference/.test(over.failures[0]), "cpu-budget: a ratio over its limit fails and says by how much: " + over.failures[0]);
  throwsLike(() => CPU.assertBudget(r, { median: 1.2, worst: 1.2 }, "fixture"), /fixture on the injected clock: median .*costliest window/, "cpu-budget: assertBudget names the label, the clock and each line it broke");
  const cheap = CPU.compare(cost(0.1), { reference: cost(2), windows: 8, perWindow: 5, warmup: 0, now, resolutionMs: 1 });
  ok(CPU.checkBudget(cheap, { median: 0.01, worst: 0.01 }).ok, "cpu-budget: a subject below the clock's floor passes any ratio, because the clock cannot tell it from zero");
  throwsLike(() => CPU.compare(cost(1), { reference: cost(0.3), windows: 8, perWindow: 5, warmup: 0, now, resolutionMs: 1 }), /within twice the clock's floor/, "cpu-budget: a reference the clock cannot resolve is refused rather than divided by");
  const order = [];
  let o = 0;
  CPU.compare(() => { order.push("s"); }, { reference: () => { order.push("r"); }, windows: 4, perWindow: 1, warmup: 0, now: () => (o += 10), resolutionMs: 1 });
  eq(order.join(""), "srrssrrs", "cpu-budget: subject and reference windows are interleaved and alternate which goes first, so drift and load fall on both");
  eq(CPU.clockResolution({ now: tick(4).now, samples: 3 }), 4, "cpu-budget: the resolution is the smallest step the clock is seen to take");
  ok(["thread-cpu", "wall"].includes(CPU.CPU_CLOCK) && CPU.cpuClock().clock === CPU.CPU_CLOCK && typeof CPU.cpuClock().cpu() === "number", "cpu-budget: cpuClock() keeps the { clock, cpu } shape the live harness used");
  const real = CPU.compare(CPU.referenceKernel, { windows: 8, perWindow: 5, warmup: 5 });
  ok(real.resolutionMs > 0 && real.reference.median > 0, `cpu-budget: on the ${real.clock} clock the resolution is ${real.resolutionMs.toFixed(3)} ms and the reference ${real.reference.median.toFixed(2)} ms a run`);
  ok(real.ratio.median > 0.33 && real.ratio.median < 3, `cpu-budget: the reference against itself reads ${real.ratio.median.toFixed(2)}x (loose bounds: a sanity check, not a timing gate)`);
}

{
  const f = fakeD1();
  f.put("p1", { a: 1 });
  f.put("p2", "raw");
  const row = await f.D1.prepare("SELECT payload FROM flows_payload WHERE id = ?").bind("p1").first();
  deep(JSON.parse(row.payload), { a: 1 }, "d1-fake: a row put is read back through prepare().bind().first()");
  eq(f.trips.length, 1, "d1-fake: one first() is one trip");
  eq(f.trips[0].rows, 1, "d1-fake: a primary-key search reads the rows it returns");
  await f.D1.prepare("SELECT id FROM flows_payload").all();
  eq(f.rowsRead(1), 2, "d1-fake: a scan reads the whole table");
  const before = f.trips.length;
  const results = await f.D1.batch([
    f.D1.prepare("SELECT id FROM flows_payload WHERE id = ?").bind("p2"),
    f.D1.prepare("INSERT OR REPLACE INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?)").bind("p3", "{}", 1),
  ]);
  eq(f.trips.length - before, 1, "d1-fake: a batch is one trip whatever it holds");
  eq(results[0].results[0].id, "p2", "d1-fake: and answers each statement in order");
  eq(f.written(before), 1, "d1-fake: the rows a write changed are counted");
  eq(f.count(/INSERT OR REPLACE/, before), 1, "d1-fake: count() finds trips by statement");
  ok(f.clock.sqlMs >= 0, "d1-fake: the time spent in SQLite is accumulated");
  f.live("live:x", { v: 1 }, 1000, "2026-09-25");
  deep({ ...f.db.prepare("SELECT cadence_s, source, writer FROM flows_live WHERE id = 'live:x'").get() }, { cadence_s: 300, source: "worker", writer: "worker@rth" }, "d1-fake: live() defaults to the Worker's own writer");
  f.live("live:y", { v: 1 }, 1000, "2026-09-25", { cadenceS: 900, source: "actions", writer: "flows-live" });
  deep({ ...f.db.prepare("SELECT cadence_s, source, writer FROM flows_live WHERE id = 'live:y'").get() }, { cadence_s: 900, source: "actions", writer: "flows-live" }, "d1-fake: and takes another writer's cadence, source and name");
  f.tape("NVDA", { t: 1 }, 2000, "2026-09-25");
  eq(f.db.prepare("SELECT legs FROM flows_tape WHERE ticker = 'NVDA'").get().legs, 3, "d1-fake: tape() writes a three-leg row");
  f.fail(/FROM flows_payload/);
  await assert.rejects(f.D1.prepare("SELECT * FROM flows_payload").all(), /fake D1 refused/); checks++;
  f.fail(null);
  f.throwSync(/FROM flows_tape/);
  throwsLike(() => f.D1.batch([f.D1.prepare("SELECT * FROM flows_tape")]), /threw before suspending/, "d1-fake: throwSync makes batch() throw before it returns a promise");
  f.throwSync(null);
  f.hangOnce(/FROM flows_live/);
  const hung = await Promise.race([f.D1.batch([f.D1.prepare("SELECT * FROM flows_live")]).then(() => "settled"), new Promise((r) => setTimeout(() => r("hung"), 50))]);
  eq(hung, "hung", "d1-fake: hangOnce leaves a batch pending");
  const next = await f.D1.batch([f.D1.prepare("SELECT id FROM flows_live")]);
  eq(next[0].results.length, 2, "d1-fake: once only");
  f.slowOnce(/FROM flows_live/, 80);
  const t0 = Date.now();
  await f.D1.batch([f.D1.prepare("SELECT id FROM flows_live")]);
  ok(Date.now() - t0 >= 70, "d1-fake: slowOnce delays one batch");
  f.latency(0);
  eq(f.since(0).length, f.trips.length, "d1-fake: since(0) is every trip");
  const bare = fakeD1({ schema: "CREATE TABLE t (id TEXT PRIMARY KEY)" });
  eq((await bare.D1.prepare("SELECT count(*) AS n FROM t").first()).n, 0, "d1-fake: another schema can be supplied");
}

{
  const tree = path.join(scratch, "bump");
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const pagesAndSheets = [...new Set(listed.filter((n) => existsSync(path.join(ROOT, n)) && ((n.endsWith(".html") && !/^(tests|docs)\//.test(n) && !n.split("/").some((p) => p.startsWith(".") || p === "node_modules")) || /^assets\/css\/[^/]+\.css$/.test(n))))].sort();
  const walked = new Set(referenceFiles(ROOT));
  deep(pagesAndSheets.filter((n) => !walked.has(n)), [], `bump-assets: the tool walks every one of the ${pagesAndSheets.length} pages and sheets Git sees (HTML outside tests/ and docs/, plus assets/css/*.css), listed here without the tool`);
  const files = [...pagesAndSheets, "shared/flows-pages.js", "assets/version.txt", "assets/fonts-version.txt", "assets/js/lab-suite.bundle.js", "assets/js/storage.js", "assets/js/auth.js"];
  for (const rel of files) { mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true }); copyFileSync(path.join(ROOT, rel), path.join(tree, rel)); }
  const v = Number(readFileSync(path.join(ROOT, "assets/version.txt"), "utf8").trim());
  const fv = Number(readFileSync(path.join(ROOT, "assets/fonts-version.txt"), "utf8").trim());
  const run = (...args) => spawnSync(process.execPath, [BUMP, "--root", tree, ...args], { encoding: "utf8" });
  const pre = run("--check");
  eq(pre.status, 0, "bump-assets --check: the committed tree is consistent: " + said(pre));
  const snapshot = Object.fromEntries(files.map((rel) => [rel, readFileSync(path.join(tree, rel), "utf8")]));
  const out = run();
  eq(out.status, 0, "bump-assets: runs: " + out.stdout.split("\n")[0]);
  eq(readFileSync(path.join(tree, "assets/version.txt"), "utf8"), `${v + 1}\n`, `bump-assets: assets/version.txt goes from ${v} to ${v + 1}`);
  eq(readFileSync(path.join(tree, "assets/fonts-version.txt"), "utf8"), snapshot["assets/fonts-version.txt"], "bump-assets: the fonts token is untouched");
  eq(readFileSync(path.join(tree, "shared/flows-pages.js"), "utf8").split("\n")[0], `export const ASSET_VERSION = "${v + 1}";`, "bump-assets: ASSET_VERSION follows");
  let css = 0, fonts = 0, shells = 0, other = 0, img = 0;
  for (const rel of pagesAndSheets) {
    const text = readFileSync(path.join(tree, rel), "utf8");
    for (const m of text.matchAll(/["'(](\/assets\/[^"')?#]+\.(?:css|js|woff2))(?:\?v=(\d+))?/g)) {
      if (m[1].endsWith(".woff2")) { fonts++; eq(Number(m[2]), fv, `bump-assets: ${rel}: ${m[1]} stays at the fonts token ${fv}`); }
      else { css++; eq(Number(m[2]), v + 1, `bump-assets: ${rel}: ${m[1]} moves to ${v + 1}`); }
    }
    for (const m of text.matchAll(/(\/assets\/[^"'()\s?#]+)\?v=(\d+)/g)) {
      if (m[1].endsWith(".woff2") || /\.(?:css|js)$/.test(m[1])) continue;
      other++;
      if (m[1].startsWith("/assets/img/")) img++;
      eq(Number(m[2]), v + 1, `bump-assets: ${rel}: ${m[1]} (neither CSS, JavaScript nor a font) moves to ${v + 1}`);
    }
    for (const m of text.matchAll(/data-asset-version="(\d+)"/g)) { shells++; eq(Number(m[1]), v + 1, `bump-assets: ${rel}: data-asset-version moves`); }
    const before = snapshot[rel].replace(/(\/assets\/[^"'()\s?#]+)\?v=\d+/g, "$1?v=").replace(/data-asset-version="\d+"/g, 'data-asset-version=""');
    const after = text.replace(/(\/assets\/[^"'()\s?#]+)\?v=\d+/g, "$1?v=").replace(/data-asset-version="\d+"/g, 'data-asset-version=""');
    eq(after, before, `bump-assets: ${rel} changes in its version tokens and nowhere else`);
  }
  ok(css >= 40 && fonts >= 16 && shells >= 3, `bump-assets: ${css} CSS and JavaScript references moved, ${fonts} font references held, ${shells} shells`);
  ok(img >= 1, `bump-assets: ${other} other /assets/ references moved, ${img} of them under /assets/img/ (at least one, so the check above is not vacuous)`);
  for (const [rel, asset] of [["lab/placement/index.html", "storage.js"], ["lab/placement/index.html", "auth.js"], ["lab/course.html", "lab-suite.bundle.js"]]) {
    if (!(snapshot[rel] ?? "").includes(`/assets/js/${asset}?v=`)) { notes.push(`bump-assets: ${rel} no longer loads ${asset}; its spot check is skipped`); continue; }
    ok(readFileSync(path.join(tree, rel), "utf8").includes(`/assets/js/${asset}?v=${v + 1}"`), `bump-assets: ${rel} loads ${asset} and it moves with the rest`);
  }
  eq(readFileSync(path.join(tree, "assets/js/lab-suite.bundle.js"), "utf8"), snapshot["assets/js/lab-suite.bundle.js"], "bump-assets: the bundle itself is not rebuilt: the course generator is not run");
  ok(!/generate-course-payloads\.mjs["'`]\s*[,)\]]|spawn|execFile|fork\(/.test(readFileSync(BUMP, "utf8")), "bump-assets: the tool starts no child process");
  const post = run("--check");
  eq(post.status, 0, "bump-assets --check: the bumped tree is consistent: " + said(post));
  const base = path.join(tree, "assets/css/base.css");
  writeFileSync(base, readFileSync(base, "utf8").replace(`Inter-latin.woff2?v=${fv}`, `Inter-latin.woff2?v=${v + 1}`));
  const lab = path.join(tree, "lab/index.html");
  writeFileSync(lab, readFileSync(lab, "utf8").replace(`/assets/js/nav.js?v=${v + 1}`, `/assets/js/nav.js?v=${v}`));
  const stale = run("--check");
  ok(stale.status === 1 && /Inter-latin\.woff2 at \d+, expected/.test(stale.stderr) && /nav\.js at \d+, expected/.test(stale.stderr), "bump-assets --check: a font moved by a blanket rewrite and a reference left behind both fail it: " + stale.stderr.trim().split("\n").join(" | "));
  const again = run();
  ok(again.status === 0 && /1 font reference\(s\) set back/.test(again.stdout), "bump-assets: the next bump sets the font back to its token and reports it");
  const settled = run("--check");
  eq(settled.status, 0, "bump-assets: and leaves the tree consistent: " + said(settled));
  ok(!readFileSync(base, "utf8").includes(`woff2?v=${v + 2}`), "bump-assets: no woff2 reference ever carries the asset version");
  const home = path.join(tree, "index.html");
  const homeText = readFileSync(home, "utf8");
  const bare = homeText.match(/["'(](\/assets\/[^"')?#]+\.(?:css|js))\?v=\d+/)[1];
  writeFileSync(home, homeText.replace(`${bare}?v=${v + 2}`, bare));
  const missing = run("--check");
  ok(missing.status === 1 && new RegExp(`index\\.html: ${bare.replace(/[.]/g, "\\.")} has no \\?v=, expected ${v + 2}`).test(missing.stderr), "bump-assets --check: a reference with no ?v= at all fails it, as it fails contracts.mjs: " + missing.stderr.trim());
  const added = run();
  ok(added.status === 0 && /token added/.test(added.stdout) && readFileSync(home, "utf8").includes(`${bare}?v=${v + 3}`), `bump-assets: the next bump gives ${bare} the token`);
  const again2 = run("--check");
  eq(again2.status, 0, "bump-assets: and the tree is consistent again: " + said(again2));
  const unclosed = readFileSync(home, "utf8");
  writeFileSync(home, unclosed.replace("</body>", `<script src="/assets/js/nav.json"></script></body>`));
  const odd = run();
  ok(odd.status === 1 && /nav\.js matches the contract's reference pattern with no \?v=/.test(odd.stderr), "bump-assets: a reference the contract's pattern reads as an unversioned .js but that runs on past it is refused rather than rewritten: " + odd.stderr.trim());
  eq(readFileSync(path.join(tree, "assets/version.txt"), "utf8"), `${v + 3}\n`, "bump-assets: and nothing was written");
  writeFileSync(home, unclosed);
  const pages = path.join(tree, "shared/flows-pages.js");
  writeFileSync(pages, readFileSync(pages, "utf8") + `\nexport const ASSET_VERSION = "1";\n`);
  const twice = run();
  ok(twice.status === 1 && /exactly once/.test(twice.stderr), "bump-assets: a second ASSET_VERSION is refused, and nothing is written: " + said(twice));
  eq(readFileSync(path.join(tree, "assets/version.txt"), "utf8"), `${v + 3}\n`, "bump-assets: the refused run left the version alone");
  writeFileSync(pages, readFileSync(pages, "utf8").replace(`\nexport const ASSET_VERSION = "1";\n`, ""));
  const clean = run("--check");
  eq(clean.status, 0, "bump-assets: with the second ASSET_VERSION taken out the tree is consistent again, so the refusals below are each tool's own: " + said(clean));
  const bad = run("--to", String(v));
  ok(bad.status === 1 && /the new asset version \d+ must be an integer no lower than \d+/.test(bad.stderr), "bump-assets: --to never goes backwards, and says so: " + said(bad));
  eq(readFileSync(path.join(tree, "assets/version.txt"), "utf8"), `${v + 3}\n`, "bump-assets: the backwards run wrote nothing");
  const same = run("--to", String(v + 3));
  ok(same.status === 0, "bump-assets: --to the current version is allowed (a re-sync, not a step back): " + said(same));
  const fontsFile = path.join(tree, "assets/fonts-version.txt");
  const fontsText = readFileSync(fontsFile, "utf8");
  const beforeAhead = Object.fromEntries(pagesAndSheets.map((rel) => [rel, readFileSync(path.join(tree, rel), "utf8")]));
  writeFileSync(fontsFile, `${v + 5}\n`);
  const ahead = run();
  ok(ahead.status === 1 && /assets\/fonts-version\.txt \(\d+\) runs ahead of the asset version \d+/.test(ahead.stderr), "bump-assets: a fonts token ahead of the new asset version is refused: " + said(ahead));
  eq(readFileSync(path.join(tree, "assets/version.txt"), "utf8"), `${v + 3}\n`, "bump-assets: the refused run left the asset version alone");
  deep(pagesAndSheets.filter((rel) => readFileSync(path.join(tree, rel), "utf8") !== beforeAhead[rel]), [], "bump-assets: and wrote no page or sheet");
  writeFileSync(fontsFile, `${v + 4}\n`);
  const level = run();
  ok(level.status === 0 && readFileSync(path.join(tree, "assets/version.txt"), "utf8") === `${v + 4}\n`, "bump-assets: a fonts token equal to the new asset version is allowed, as after a font change: " + said(level));
  writeFileSync(fontsFile, fontsText);
  const back = run();
  ok(back.status === 0 && /font reference\(s\) set back/.test(back.stdout) && run("--check").status === 0, "bump-assets: with the fonts token restored the next bump sets the fonts back to it and the tree is consistent: " + said(back));
}

{
  const frame = (payload, { opcode = 1, fin = true, rsv1 = false } = {}) => {
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0, n]) : n < 65536 ? Buffer.from([0, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
    head[0] = (fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0) | opcode;
    return Buffer.concat([head, payload]);
  };
  const small = frame(Buffer.from(JSON.stringify({ k: "mk", rows: [] })));
  const medium = frame(Buffer.from(JSON.stringify({ k: "px", rows: "x".repeat(300) })));
  const large = frame(Buffer.from(JSON.stringify({ k: "fl", rows: "y".repeat(70000) })));
  const reader = createWireReader();
  await reader.push(Buffer.concat([small, medium.subarray(0, 5)]));
  eq(reader.messages.length, 1, "ws-wire: a frame split across reads waits for its remainder");
  await reader.push(Buffer.concat([medium.subarray(5), large]));
  deep(reader.messages.map((m) => [m.wire, m.plain]), [[small.length, small.length - 2], [medium.length, medium.length - 4], [large.length, large.length - 10]], "ws-wire: 7-bit, 16-bit and 64-bit lengths are read, wire counting the header and plain the payload");
  const ping = frame(Buffer.from("hi"), { opcode: 9 });
  const first = frame(Buffer.from('{"k":"nw",'), { fin: false });
  const rest = frame(Buffer.from('"rows":[]}'), { opcode: 0 });
  const folded = createWireReader();
  await folded.push(Buffer.concat([ping, first, ping, rest]));
  eq(folded.messages.filter((m) => m.control).length, 2, "ws-wire: control frames are reported apart from data");
  const joined = folded.messages.filter((m) => !m.control);
  deep([joined.length, joined[0].wire, JSON.parse(joined[0].body.toString()).k], [1, first.length + rest.length, "nw"], "ws-wire: a fragmented message is one message whose wire bytes are the sum of its frames");
  await assert.rejects(createWireReader().push(Buffer.from([0x81, 0x82, 0, 0, 0, 0, 1, 2])), /must not be masked/, "ws-wire: a masked server frame is refused");
  checks++;

  const deflater = zlib.createDeflateRaw();
  const deflated = (text) => new Promise((resolve) => {
    const chunks = [];
    const take = (d) => chunks.push(d);
    deflater.on("data", take);
    deflater.write(text);
    deflater.flush(zlib.constants.Z_SYNC_FLUSH, () => {
      deflater.off("data", take);
      const out = Buffer.concat(chunks);
      resolve(out.subarray(0, out.length - 4));
    });
  });
  const rows = JSON.stringify({ k: "px", rows: Array.from({ length: 40 }, (_, i) => ["NVDA", 100 + i, "0.5", "1.25"]) });
  const again = rows.replace("100", "101");
  const a = frame(await deflated(rows), { rsv1: true });
  const b = frame(await deflated(again), { rsv1: true });
  const packed = createWireReader({ compressed: true });
  await packed.push(Buffer.concat([a, b]));
  deep(packed.messages.map((m) => m.body.toString()), [rows, again], "ws-wire: permessage-deflate messages are inflated with the context the connection keeps from one message to the next");
  const sum = summariseWire(packed.messages);
  deep([sum.messages, sum.deflated, sum.plain, sum.wire === a.length + b.length, sum.wire < sum.plain, sum.kinds.px.n], [2, 2, rows.length + again.length, true, true, 2], "ws-wire: the summary counts wire against plain bytes per message kind");
  const mixed = summariseWire([...reader.messages, ...packed.messages]);
  deep(Object.keys(mixed.kinds).sort(), ["fl", "mk", "px"], "ws-wire: kinds are read from the envelope's k");
}

{
  const root = path.join(scratch, "emit-root");
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, "shared"), { recursive: true });
  const stub = path.join(root, "scripts/flows-pipeline.mjs");
  const runs = path.join(scratch, "emit-runs.txt");
  writeFileSync(path.join(root, "shared/leaf.js"), "export const x = 1;\n");
  writeFileSync(stub, `import { appendFileSync, writeFileSync } from "node:fs";
const dir = process.argv[process.argv.indexOf("--emit") + 1];
appendFileSync(${JSON.stringify(runs)}, (process.env.FLOWS_DRY_NOW || "unset") + " " + process.argv.includes("--dry-run") + "\\n");
writeFileSync(dir + "-meta.json", JSON.stringify({ generatedAt: process.env.FLOWS_DRY_NOW }));
`);
  const emitDir = path.join(scratch, "emit-out");
  const first = nightlyEmit({ root, dir: emitDir });
  eq(first, emitDir, "nightly-emit: an explicit directory is the one returned");
  deep(emitFiles(first), ["-meta.json"], "nightly-emit: the emit's files are listed without the completeness mark");
  ok(existsSync(path.join(first, EMIT_MARK)), "nightly-emit: the mark is written after the build");
  deep(emitRead(first, "meta"), { generatedAt: DRY_NOW }, "nightly-emit: the child is handed FLOWS_DRY_NOW and reads back by key");
  eq(emitRead(first, "absent"), null, "nightly-emit: a key that was not emitted reads null, not a throw");
  eq(readFileSync(runs, "utf8"), `${DRY_NOW} true\n`, "nightly-emit: the child ran once, with --dry-run and the pinned clock");
  eq(nightlyEmit({ root, dir: emitDir }), emitDir, "nightly-emit: a second call returns the same directory");
  eq(readFileSync(runs, "utf8"), `${DRY_NOW} true\n`, "nightly-emit: and builds nothing, within a process");
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { nightlyEmit } from ${JSON.stringify(new URL("./lib/nightly-emit.mjs", import.meta.url).href)}; console.log(nightlyEmit({ root: ${JSON.stringify(root)}, dir: ${JSON.stringify(emitDir)} }));`], { encoding: "utf8" });
  ok(probe.status === 0 && probe.stdout.trim() === emitDir, "nightly-emit: another process reuses the finished directory: " + said(probe));
  eq(readFileSync(runs, "utf8"), `${DRY_NOW} true\n`, "nightly-emit: and builds nothing there either");
  const before = sourceFingerprint(root);
  eq(sourceFingerprint(root), before, "nightly-emit: the source fingerprint is stable while the tree is");
  const later = new Date(Date.now() + 120000);
  utimesSync(path.join(root, "shared/leaf.js"), later, later);
  ok(sourceFingerprint(root) !== before, "nightly-emit: touching a source file moves the fingerprint");
  const probe2 = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { nightlyEmit } from ${JSON.stringify(new URL("./lib/nightly-emit.mjs", import.meta.url).href)}; console.log(nightlyEmit({ root: ${JSON.stringify(root)}, dir: ${JSON.stringify(emitDir)} }));`], { encoding: "utf8" });
  ok(probe2.status === 0, "nightly-emit: a changed tree rebuilds: " + said(probe2));
  eq(readFileSync(runs, "utf8").split("\n").filter(Boolean).length, 2, "nightly-emit: the stale directory was rebuilt once");
  const other = nightlyEmit({ root, dir: path.join(scratch, "emit-out-2"), now: "2026-08-25T09:00:00Z" });
  deep(emitRead(other, "meta"), { generatedAt: "2026-08-25T09:00:00Z" }, "nightly-emit: another clock is another build");
  const own = nightlyEmit({ root, dir: null });
  ok(own.startsWith(tmpdir()) && existsSync(path.join(own, EMIT_MARK)), "nightly-emit: with no directory given the emit goes to a temporary one");
  ok(listDir(own).includes("-meta.json"), "nightly-emit: and holds the payload");
}

{
  const files = nightlyFiles();
  eq(files[0], NIGHTLY_ENTRY, "nightly-source: the entry comes first");
  ok(files.length > 1 && files.slice(1).every((f) => f.startsWith(NIGHTLY_DIR + "/") && f.endsWith(".mjs")), "nightly-source: then every module under the nightly directory, at any depth");
  deep(files.slice(1), [...files.slice(1)].sort(), "nightly-source: in a fixed order");
  deep(files.slice(1), treeFiles(NIGHTLY_DIR), "nightly-source: and exactly the tree the comment scan walks");
  const src = nightlySource();
  ok(src.indexOf("@@ source " + NIGHTLY_ENTRY + " @@") < src.indexOf("@@ source " + files[1] + " @@"), "nightly-source: the concatenation marks each module's boundary");
  ok(nightlySlice("export const ISOLATION", "export const WHY_CAP").includes("fatal"), "nightly-source: a slice inside one module is returned");
  throwsLike(() => nightlySlice("this marker is nowhere in the nightly"), /marker not found/, "nightly-source: a slice whose start marker is missing throws instead of passing on nothing");
  throwsLike(() => nightlySlice("export const ISOLATION", "this end marker is nowhere"), /marker not found/, "nightly-source: and so does one whose end marker is missing");
  throwsLike(() => nightlySlice("const ARGS", "export const ISOLATION"), /crosses a module boundary/, "nightly-source: a slice across two modules throws, so a moved scan must name the module that now holds its code");
  const exec = nightlyExecution();
  ok(!/await run[A-Z]\w*\(ctx\);/.test(exec), "nightly-source: the execution text has every section call replaced by that section's body");
  ok(exec.indexOf('stages.step("session")') >= 0 && exec.indexOf('stages.step("session")') < exec.indexOf('stages.step("universe")'), "nightly-source: and reads in the order the run executes");
}

for (const n of notes) console.log("  note: " + n);
console.log(`✓ lib-contract: ${checks} checks — the browser launcher's PW_CHROMIUM_PATH, the served tree under gitignore semantics, the CPU budget's ratio, floor and interleaving, the counting D1 fake, the WebSocket wire reader (lengths, fragments, permessage-deflate with context takeover), and the asset-bump tool (fonts held, every page and sheet moved, unversioned references caught)`);
