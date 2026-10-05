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
import { plan as bumpPlan, referenceFiles } from "../scripts/bump-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUMP = path.join(ROOT, "scripts/bump-assets.mjs");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const throwsLike = (fn, re, msg) => { assert.throws(fn, re, msg); checks++; };
const scratch = mkdtempSync(path.join(tmpdir(), "lib-contract-"));
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
  copyFileSync(path.join(ROOT, ".assetsignore"), path.join(repo, ".assetsignore"));
  for (const f of ["worker.js", "tests/x", "foo.md", "assets/x.css", "assets/data/a.json", "_headers", "docs/spec.yaml", "shared/m.js", "flows/index.html", "lab/index.html", ".github/w.yml", "deleted.txt"]) put(f);
  sh("add", "-f", ".");
  rmSync(path.join(repo, "deleted.txt"));
  put("assets/new.js");
  symlinkSync("assets/x.css", path.join(repo, "link.css"));
  const got = servedFiles({ root: repo });
  deep(got, ["assets/data/a.json", "assets/new.js", "assets/x.css", "docs/spec.yaml", "lab/index.html"],
    "served tree on a fixture repository with this .assetsignore: worker.js, tests/x, foo.md, _headers, shared/, flows/ and dot paths excluded; assets/x.css included; an untracked file counted, a deleted one and a symlink not");
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

const refsOf = (text) => [...text.matchAll(/(\/assets\/[^"'()\s?#]+)\?v=(\d+)|data-asset-version="(\d+)"|export const ASSET_VERSION = "(\d+)"/g)]
  .map((m) => (m[1] ? `${m[1]}?v=${m[2]}` : m[3] ? `data-asset-version=${m[3]}` : `ASSET_VERSION=${m[4]}`));
const keyOf = (ref) => ref.replace(/(?:\?v)?=\d+$/, "");

{
  const tree = path.join(scratch, "bump");
  const files = [...referenceFiles(ROOT), "shared/flows-pages.js", "assets/version.txt", "assets/fonts-version.txt", "assets/js/lab-suite.bundle.js", "assets/js/storage.js", "assets/js/auth.js"];
  for (const rel of files) { mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true }); copyFileSync(path.join(ROOT, rel), path.join(tree, rel)); }
  const v = Number(readFileSync(path.join(ROOT, "assets/version.txt"), "utf8").trim());
  const fv = Number(readFileSync(path.join(ROOT, "assets/fonts-version.txt"), "utf8").trim());
  const run = (...args) => spawnSync(process.execPath, [BUMP, "--root", tree, ...args], { encoding: "utf8" });
  const pre = run("--check");
  eq(pre.status, 0, "bump-assets --check: the committed tree is consistent: " + pre.stdout.trim());
  const snapshot = Object.fromEntries(files.map((rel) => [rel, readFileSync(path.join(tree, rel), "utf8")]));
  const out = run();
  eq(out.status, 0, "bump-assets: runs: " + out.stdout.split("\n")[0]);
  eq(readFileSync(path.join(tree, "assets/version.txt"), "utf8"), `${v + 1}\n`, `bump-assets: assets/version.txt goes from ${v} to ${v + 1}`);
  eq(readFileSync(path.join(tree, "assets/fonts-version.txt"), "utf8"), snapshot["assets/fonts-version.txt"], "bump-assets: the fonts token is untouched");
  eq(readFileSync(path.join(tree, "shared/flows-pages.js"), "utf8").split("\n")[0], `export const ASSET_VERSION = "${v + 1}";`, "bump-assets: ASSET_VERSION follows");
  let css = 0, fonts = 0, shells = 0;
  for (const rel of referenceFiles(tree)) {
    const text = readFileSync(path.join(tree, rel), "utf8");
    for (const m of text.matchAll(/["'(](\/assets\/[^"')?#]+\.(?:css|js|woff2))(?:\?v=(\d+))?/g)) {
      if (m[1].endsWith(".woff2")) { fonts++; eq(Number(m[2]), fv, `bump-assets: ${rel}: ${m[1]} stays at the fonts token ${fv}`); }
      else { css++; eq(Number(m[2]), v + 1, `bump-assets: ${rel}: ${m[1]} moves to ${v + 1}`); }
    }
    for (const m of text.matchAll(/data-asset-version="(\d+)"/g)) { shells++; eq(Number(m[1]), v + 1, `bump-assets: ${rel}: data-asset-version moves`); }
    const before = snapshot[rel].replace(/(\/assets\/[^"'()\s?#]+)\?v=\d+/g, "$1?v=").replace(/data-asset-version="\d+"/g, 'data-asset-version=""');
    const after = text.replace(/(\/assets\/[^"'()\s?#]+)\?v=\d+/g, "$1?v=").replace(/data-asset-version="\d+"/g, 'data-asset-version=""');
    eq(after, before, `bump-assets: ${rel} changes in its version tokens and nowhere else`);
  }
  ok(css >= 40 && fonts >= 16 && shells >= 3, `bump-assets: ${css} CSS and JavaScript references moved, ${fonts} font references held, ${shells} shells`);
  const placement = readFileSync(path.join(tree, "lab/placement/index.html"), "utf8");
  for (const js of ["storage.js", "auth.js"]) ok(placement.includes(`/assets/js/${js}?v=${v + 1}"`), `bump-assets: lab/placement loads ${js} on its own and it moves with the rest`);
  ok(readFileSync(path.join(tree, "lab/course.html"), "utf8").includes(`/assets/js/lab-suite.bundle.js?v=${v + 1}"`), "bump-assets: the Lab bundle's reference moves alike");
  eq(readFileSync(path.join(tree, "assets/js/lab-suite.bundle.js"), "utf8"), snapshot["assets/js/lab-suite.bundle.js"], "bump-assets: the bundle itself is not rebuilt: the course generator is not run");
  ok(!/generate-course-payloads\.mjs["'`]\s*[,)\]]|spawn|execFile|fork\(/.test(readFileSync(BUMP, "utf8")), "bump-assets: the tool starts no child process");
  const post = run("--check");
  eq(post.status, 0, "bump-assets --check: the bumped tree is consistent");
  const base = path.join(tree, "assets/css/base.css");
  writeFileSync(base, readFileSync(base, "utf8").replace(`Inter-latin.woff2?v=${fv}`, `Inter-latin.woff2?v=${v + 1}`));
  const lab = path.join(tree, "lab/index.html");
  writeFileSync(lab, readFileSync(lab, "utf8").replace(`/assets/js/nav.js?v=${v + 1}`, `/assets/js/nav.js?v=${v}`));
  const stale = run("--check");
  ok(stale.status === 1 && /Inter-latin\.woff2 at \d+, expected/.test(stale.stderr) && /nav\.js at \d+, expected/.test(stale.stderr), "bump-assets --check: a font moved by a blanket rewrite and a reference left behind both fail it: " + stale.stderr.trim().split("\n").join(" | "));
  const again = run();
  ok(again.status === 0 && /1 font reference\(s\) set back/.test(again.stdout), "bump-assets: the next bump sets the font back to its token and reports it");
  eq(run("--check").status, 0, "bump-assets: and leaves the tree consistent");
  ok(!readFileSync(base, "utf8").includes(`woff2?v=${v + 2}`), "bump-assets: no woff2 reference ever carries the asset version");
  const pages = path.join(tree, "shared/flows-pages.js");
  writeFileSync(pages, readFileSync(pages, "utf8") + `\nexport const ASSET_VERSION = "1";\n`);
  const twice = run();
  ok(twice.status === 1 && /exactly once/.test(twice.stderr), "bump-assets: a second ASSET_VERSION is refused, and nothing is written");
  eq(readFileSync(path.join(tree, "assets/version.txt"), "utf8"), `${v + 2}\n`, "bump-assets: the refused run left the version alone");
  const bad = run("--to", String(v));
  ok(bad.status === 1, "bump-assets: --to never goes backwards");
}

{
  const has = (rev) => spawnSync("git", ["cat-file", "-e", rev + "^{commit}"], { cwd: ROOT }).status === 0;
  const bumps = execFileSync("git", ["log", "--format=%H", "-6", "--first-parent", "HEAD", "--", "assets/version.txt"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  let replayed = 0, compared = 0;
  for (const rev of bumps) {
    if (!has(rev + "^")) continue;
    const show = (r, rel) => { try { return execFileSync("git", ["show", `${r}:${rel}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
    const from = Number(show(rev + "^", "assets/version.txt"));
    const to = Number(show(rev, "assets/version.txt"));
    if (!(to === from + 1) || show(rev + "^", "assets/fonts-version.txt") === null || show(rev + "^", "shared/flows-pages.js") === null) continue;
    const dir = path.join(scratch, "replay-" + rev.slice(0, 7));
    const names = execFileSync("git", ["ls-tree", "-r", "--name-only", rev + "^"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n")
      .filter((n) => (n.endsWith(".html") && !/^(tests|docs)\//.test(n) && !n.split("/").some((p) => p.startsWith(".") || p === "node_modules")) || /^assets\/css\/[^/]+\.css$/.test(n)
        || ["shared/flows-pages.js", "assets/version.txt", "assets/fonts-version.txt"].includes(n));
    for (const n of names) { mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); writeFileSync(path.join(dir, n), show(rev + "^", n)); }
    const res = spawnSync(process.execPath, [BUMP, "--root", dir], { encoding: "utf8" });
    eq(res.status, 0, `bump-assets replay of ${rev.slice(0, 7)}: runs`);
    for (const n of names) {
      const mine = readFileSync(path.join(dir, n), "utf8");
      const theirs = show(rev, n);
      if (theirs === null) continue;
      const keep = new Set(refsOf(show(rev + "^", n)).map(keyOf));
      const pick = (text) => refsOf(text).filter((r) => keep.has(keyOf(r))).sort();
      compared += pick(theirs).length;
      deep(pick(mine), pick(theirs), `bump-assets replay of ${rev.slice(0, 7)} (${from} -> ${to}): ${n} carries the tokens the hand bump gave it`);
    }
    replayed++;
  }
  if (replayed) {
    ok(compared >= 60 * replayed, `bump-assets: ${replayed} past hand bump(s) reproduced token for token (${compared} tokens compared)`);
    console.log(`  bump-assets: ${replayed} past hand bump(s) reproduced token for token, ${compared} tokens compared`);
  }
  else notes.push("bump-assets replay: no past bump reachable (shallow clone)");
}

rmSync(scratch, { recursive: true, force: true });
for (const n of notes) console.log("  note: " + n);
console.log(`✓ lib-contract: ${checks} checks — the browser launcher's PW_CHROMIUM_PATH, the served tree under gitignore semantics, the CPU budget's ratio, floor and interleaving, the counting D1 fake, and the asset-bump tool (fonts held, past bumps reproduced)`);
