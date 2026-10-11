import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DIR, TIMEOUT_FLOOR_S, KILL_GRACE_MS, TAIL_LINES, TAIL_LINE_CHARS, REPEAT_WINDOW_MS, MAX_TIMER_MS,
  loadManifest, timeoutFor, timerDelayMs, exitCodeFor, interrupt, countAssertions, parseArgs, selectSuites, UsageError, tailCollector,
  packShards, chooseSuites, needsBrowser, groupOf, CHROMIUM_SETUP_S, MAX_SHARDS,
} from "./run.mjs";
import { checkQuarantine, readQuarantine, recordedFor, dayMs, MAX_QUARANTINE_DAYS } from "./lib/quarantine.mjs";
import { retryAllowed } from "./run.mjs";
import { checkRegistry, syncRegistry, serialize, globMatches, scanSuite, trackedFiles, scriptFiles, ROOT as REPO } from "./lib/suite-registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, "run.mjs");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const throwsLike = (fn, re, msg) => { assert.throws(fn, re, msg); checks++; };
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "run-contract-")));
process.on("exit", () => {
  const dir = path.join(scratch, "marks");
  for (const name of existsSync(dir) ? readdirSync(dir).filter((n) => /\.pids?$/.test(n)) : []) {
    const text = readFileSync(path.join(dir, name), "utf8");
    for (const pid of /^\d+$/.test(text) ? [Number(text)] : Object.values(JSON.parse(text))) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }
  rmSync(scratch, { recursive: true, force: true });
});

{
  eq(DEFAULT_DIR, HERE, "the runner's default directory is tests/, wherever it is invoked from");
  const pkg = JSON.parse(readFileSync(path.join(HERE, "package.json"), "utf8"));
  eq(pkg.scripts.test, "node run.mjs", "npm test is the fail-late runner, not an && chain that stops at the first failure");
  const suites = loadManifest();
  const scriptNames = Object.keys(pkg.scripts).filter((k) => k.startsWith("test:")).sort();
  deep(suites.map((s) => s.script).sort(), scriptNames, "suites.json lists every test:* script of package.json exactly once, and no other");
  eq(new Set(suites.map((s) => s.name)).size, suites.length, "no suite is listed twice");
  ok(suites.length >= 78, `the 77 suites of the old chain plus this contract are all registered (${suites.length})`);
  eq(suites[0].name, "contracts", "the asset and curriculum contracts still run first");
  ok(suites.some((s) => s.name === "run" && s.command === "node run-contract.mjs"), "this contract is itself a registered suite");
  for (const s of suites) {
    ok(typeof s.command === "string" && s.command.trim().length > 0, `${s.name}: has a command`);
    ok(["N", "C", "W"].includes(s.class), `${s.name}: is classed N, C or W`);
    const t = timeoutFor(s);
    ok(t >= TIMEOUT_FLOOR_S && t >= 3 * (s.medianS || 0), `${s.name}: its timeout (${t} s) is at least the floor and three medians`);
  }
}

{
  const manifestText = readFileSync(path.join(HERE, "suites.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  const pkg = JSON.parse(readFileSync(path.join(HERE, "package.json"), "utf8"));
  const tracked = trackedFiles(REPO);
  deep(checkRegistry({ root: REPO, manifest, pkg, tracked }), [], "the committed suites.json agrees with the tree: every suite's files, class, group, timing flag and covers, and every helper registered and reached");
  eq(serialize(syncRegistry({ root: REPO, manifest, pkg, tracked })), manifestText, "syncing the committed registry changes nothing, so adding a suite is one entry with a name and a sync");
  eq(manifest.version, 2, "the registry is version 2");
  deep(manifest.suites.filter((s) => s.timing).map((s) => s.name), ["flows-ws-probe", "flows-rt", "flows-live", "flows-reads", "flows-verdict", "flows-dossier-reads", "flows-reading-worker", "flows-quant"].sort((a, b) => manifest.suites.findIndex((x) => x.name === a) - manifest.suites.findIndex((x) => x.name === b)), "the eight suites with in-process CPU or wall-clock gates carry the timing flag");
  ok(manifest.suites.every((s) => ["fast", "shard"].includes(s.group)), "every suite names its group");
  deep(manifest.suites.filter((s) => s.group === "fast").map((s) => s.name), ["contracts", "run"], "only contracts and run are fast");
  const classes = manifest.suites.reduce((n, s) => ({ ...n, [s.class]: (n[s.class] || 0) + 1 }), {});
  ok(classes.N > 40 && classes.C > 10 && classes.W > 10, `the scan finds all three classes (${JSON.stringify(classes)})`);
  const flowsRt = manifest.suites.find((s) => s.name === "flows-rt");
  deep(scriptFiles(pkg.scripts["test:flows-rt"]), flowsRt.files, "the files of a suite are the files its script runs, flags skipped");
  deep(scriptFiles("node ../scripts/flows-pipeline.mjs --dry-run && node flows-pipeline-contract.mjs"), ["../scripts/flows-pipeline.mjs", "flows-pipeline-contract.mjs"], "and a chain of commands lists each");
  ok(globMatches("a/*.js", "a/b.js") && !globMatches("a/*.js", "a/c/b.js") && globMatches("a/**/*.js", "a/c/d/b.js") && globMatches("a/**/*.js", "a/b.js") && !globMatches("a/*.js", "a/b.mjs"), "covers globs: * stays in a directory, ** crosses them");
}

{
  const root = path.join(scratch, "reg");
  const put = (rel, body) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), body); };
  put("tests/package.json", "{}");
  put("tests/alpha.mjs", `import { x } from "./helper.mjs";\nimport { readFileSync } from "node:fs";\nreadFileSync("../data/base.json");\nconsole.log(x);\n`);
  put("tests/helper.mjs", `export const x = 1;\nconst later = async (n) => import(n);\n`);
  put("tests/beta.mjs", `import { startWorker } from "./worker-server.mjs";\nawait startWorker();\n`);
  put("tests/worker-server.mjs", `import http from "node:http";\nexport const startWorker = () => http;\n`);
  put("tests/gamma.mjs", `import { chromium } from "playwright";\nimport { readFileSync } from "node:fs";\nreadFileSync("../assets/page.html");\nvoid chromium;\n`);
  put("tests/delta.mjs", `import { launch } from "./lib/browser.mjs";\nvoid launch;\n`);
  put("tests/lib/browser.mjs", `import { chromium } from "playwright";\nexport const launch = () => chromium;\n`);
  put("data/base.json", "{}");
  put("assets/page.html", "<p></p>");
  const pkg = { scripts: { "test:alpha": "node alpha.mjs", "test:beta": "node --disable-warning=ExperimentalWarning beta.mjs", "test:gamma": "node gamma.mjs", "test:delta": "node delta.mjs" } };
  const tracked = ["data/base.json", "assets/page.html", "tests/alpha.mjs", "tests/helper.mjs", "tests/beta.mjs", "tests/worker-server.mjs", "tests/gamma.mjs", "tests/delta.mjs", "tests/lib/browser.mjs"];
  const seed = { version: 1, suites: ["alpha", "beta", "gamma", "delta"].map((name) => ({ name, medianS: 1 })) };
  const good = syncRegistry({ root, manifest: seed, pkg, tracked });
  deep(good.suites.map((x) => [x.name, x.class]), [["alpha", "N"], ["beta", "W"], ["gamma", "C"], ["delta", "N"]], "scan: a worker-server import is W, a playwright import is C, neither is N, and the shared launcher is not counted as a playwright import");
  deep(good.suites.find((x) => x.name === "alpha").covers, ["data/base.json"], "scan: a literal path read outside the import closure becomes a covers entry");
  deep(good.suites.find((x) => x.name === "gamma").covers, ["assets/page.html"], "scan: and so does an HTML page read relative to tests/");
  deep(good.support, ["helper.mjs", "worker-server.mjs", "lib/browser.mjs"], "scan: every file no suite runs is support");
  deep(checkRegistry({ root, manifest: good, pkg, tracked }), [], "a registry made by sync passes the check");
  const mutate = (fn, extra = {}) => {
    const m = JSON.parse(JSON.stringify(good));
    fn(m);
    return checkRegistry({ root, manifest: m, pkg: extra.pkg || pkg, tracked: extra.tracked || tracked });
  };
  const has = (problems, re, msg) => ok(problems.some((p) => re.test(p)), `${msg}: ${JSON.stringify(problems.slice(0, 3))}`);

  put("tests/zz-dummy.mjs", `console.log("a suite nobody registered");\n`);
  has(checkRegistry({ root, manifest: good, pkg, tracked }), /tests\/zz-dummy\.mjs is in no suite's files and not in the support list/, "mutation: an unregistered test file fails the check");
  rmSync(path.join(root, "tests/zz-dummy.mjs"));
  put("tests/lib/zz-helper.mjs", `export const z = 1;\n`);
  has(checkRegistry({ root, manifest: good, pkg, tracked }), /tests\/lib\/zz-helper\.mjs is in no suite's files/, "mutation: an unregistered helper under lib fails too");
  rmSync(path.join(root, "tests/lib/zz-helper.mjs"));
  deep(checkRegistry({ root, manifest: good, pkg, tracked }), [], "and removing them restores a clean check");

  has(mutate((m) => { m.suites[0].class = "W"; }), /alpha is class W, but its import closure makes it N/, "mutation: a pure-Node suite classed W fails");
  has(mutate((m) => { m.suites[1].class = "N"; }), /beta is class N, but its import closure makes it W \(it imports tests\/worker-server\.mjs\)/, "mutation: a server suite classed N fails");
  has(mutate((m) => { m.suites[2].class = "N"; }), /gamma is class N, but its import closure makes it C/, "mutation: a browser suite classed N fails");
  has(mutate((m) => { m.suites[3].class = "C"; }), /delta is class C, but its import closure makes it N/, "mutation: the optional launcher does not make a suite C");
  has(mutate((m) => { m.suites[0].class = "X"; }), /class "X", not N, C or W/, "mutation: an unknown class fails");
  has(mutate((m) => { m.suites[0].files = ["other.mjs"]; }), /alpha lists files \["other\.mjs"\], but its script runs \["alpha\.mjs"\]/, "mutation: a files list that differs from the script fails");
  has(mutate((m) => { delete m.suites[0].files; }), /alpha lists files/, "mutation: a missing files list fails");
  has(mutate(() => {}, { pkg: { scripts: { ...pkg.scripts, "test:alpha": "node alpha.mjs && node helper.mjs" } } }), /alpha lists files/, "mutation: a script that grew a command fails until the registry follows");
  has(mutate(() => {}, { pkg: { scripts: { ...pkg.scripts, "test:alpha": "node missing.mjs" } } }), /alpha runs missing\.mjs, which does not exist/, "mutation: a script naming a file that is not there fails");
  has(mutate((m) => { m.suites[0].group = "slow"; }), /alpha has group "slow"/, "mutation: an unknown group fails");
  has(mutate((m) => { delete m.suites[1].group; }), /beta has group undefined/, "mutation: a missing group fails");
  has(mutate((m) => { m.suites[0].timing = "yes"; }), /alpha has no boolean timing flag/, "mutation: a timing flag that is not boolean fails");
  has(mutate((m) => { m.suites[0].covers = []; }), /alpha reads data\/base\.json outside its import closure, and no covers entry names it/, "mutation: a read the covers do not name fails");
  has(mutate((m) => { m.suites[0].covers.push("gone/*.json"); }), /alpha covers gone\/\*\.json, which matches no file/, "mutation: a covers glob that matches nothing fails");
  deep(mutate((m) => { m.suites[0].covers = ["data/*.json"]; }), [], "a covers glob that matches the read is enough");
  has(mutate((m) => { m.support.push("lonely.mjs"); }), /support lists lonely\.mjs, which does not exist/, "mutation: a support file that is not there fails");
  put("tests/lonely.mjs", `console.log("nothing imports me");\n`);
  has(mutate((m) => { m.support.push("lonely.mjs"); }, { tracked: [...tracked, "tests/lonely.mjs"] }), /support lists tests\/lonely\.mjs, which no suite's import closure reaches/, "mutation: a support file nothing reaches is an orphan and fails");
  rmSync(path.join(root, "tests/lonely.mjs"));
  has(mutate((m) => { m.support = m.support.filter((f) => f !== "helper.mjs"); }), /tests\/helper\.mjs is in no suite's files and not in the support list/, "mutation: a helper dropped from support fails");
  has(mutate((m) => { m.support.push("alpha.mjs"); }), /alpha\.mjs is both a suite file and in support/, "mutation: a file both run and listed as support fails");
  has(mutate((m) => { delete m.support; }), /no support array/, "mutation: a manifest without support fails");

  const lm = path.join(scratch, "reg-lm");
  mkdirSync(lm);
  writeFileSync(path.join(lm, "package.json"), JSON.stringify({ scripts: { "test:alpha": "node a.mjs" } }));
  const load = (suite, extra = {}) => { writeFileSync(path.join(lm, "suites.json"), JSON.stringify({ suites: [suite], ...extra })); return () => loadManifest(lm); };
  deep(load({ name: "alpha", class: "N", group: "shard", timing: true, files: ["a.mjs"], covers: ["x/*.js"] })().map((x) => x.timing), [true], "the runner reads the new fields without changing what it runs");
  throwsLike(load({ name: "alpha", timing: "yes" }), /timing flag/, "the runner refuses a timing flag that is not boolean");
  throwsLike(load({ name: "alpha", files: [] }), /bad files list/, "the runner refuses an empty files list");
  throwsLike(load({ name: "alpha", covers: [3] }), /bad covers list/, "the runner refuses a covers list of non-strings");
  throwsLike(load({ name: "alpha" }, { support: "x" }), /support is not a list/, "the runner refuses a support that is not a list");
  deep(load({ name: "alpha", class: "N" })().map((x) => x.name), ["alpha"], "and a bare entry, as the fixtures use, still loads");
  void scanSuite;
}

{
  eq(timeoutFor({ medianS: 374.9 }), 1125, "the default timeout is three medians, rounded up");
  eq(timeoutFor({ medianS: 0.1 }), TIMEOUT_FLOOR_S, "a sub-second suite still gets the floor");
  eq(timeoutFor({ medianS: null }), TIMEOUT_FLOOR_S, "an unmeasured suite gets the floor");
  eq(timeoutFor({ medianS: 374.9, timeoutS: 30 }), 30, "an explicit timeoutS wins over the median");
  eq(timeoutFor({ medianS: 100 }, 2), 600, "--timeout-scale multiplies the timeout");
  eq(timerDelayMs(1125), 1125000, "a timeout is armed in milliseconds");
  eq(timerDelayMs(1125 * 100000), MAX_TIMER_MS, "a timeout past setTimeout's 2^31-1 ms is capped there, never wrapped to 1 ms by Node");
  eq(timerDelayMs(120 * 17900), MAX_TIMER_MS, "the cap holds for a floor suite at a scale of 17,900 too");
  deep(["SIGINT", "SIGTERM", "SIGHUP"].map(exitCodeFor), [130, 143, 129], "an interrupted run exits 128 plus the signal's number");
  deep([interrupt("SIGINT", 1000), interrupt("SIGINT", 1005), interrupt("SIGTERM", 1000 + REPEAT_WINDOW_MS - 1), interrupt("SIGINT", 1000 + REPEAT_WINDOW_MS + 100)], ["forward", "repeat", "repeat", "kill"],
    "the first signal is forwarded, a repeat inside the window (one Ctrl-C delivered by the terminal and by npm) is not an escalation, a later one is");
  eq(countAssertions("✓ flows-x: 1,204 assertions — a\nnoise\n✓ flows-y: 3 assertions\n"), 1207, "assertion counts of every ✓ line are summed, thousands separators read");
  eq(countAssertions("flows-reads-contract: 40 checks passed\nflows-reading: 2 checks\n"), 42, "the suites that print \"N checks\" are counted too");
  eq(countAssertions("a sentence that mentions 3 assertions: 4 checks\n"), null, "a count only counts at the head of a line");
  eq(countAssertions("✓ contracts: 7 curricula\n"), null, "a suite that prints no count has none, not zero");
  deep(parseArgs(["--bail", "--only", "a,b", "--timeout-scale=3"]).only, ["a", "b"], "--only takes a comma list");
  eq(parseArgs(["--bail"]).bail, true, "--bail is parsed");
  eq(parseArgs([]).bail, false, "fail-late is the default");
  throwsLike(() => parseArgs(["--shardz"]), UsageError, "an unknown flag is a usage error");
  throwsLike(() => parseArgs(["--timeout-scale", "0"]), UsageError, "a zero timeout scale is refused");
  throwsLike(() => selectSuites([{ name: "a" }], ["b"]), /unknown suites: b/, "--only of an unknown suite is refused");
  throwsLike(() => selectSuites([{ name: "a" }], []), UsageError, "an --only that names no suite is refused, not run as an empty green run");
  eq(TAIL_LINES, 40, "a failure carries 40 lines of tail, as W09-P2 and the row require");
  eq(TAIL_LINE_CHARS, 400, "each tail line is capped at 400 characters");
  const c = tailCollector();
  for (let i = 0; i < 48; i++) c.take("stdout", "y".repeat(65536));
  ok(c.pending() <= TAIL_LINE_CHARS + 1, `3 MiB written with no newline holds at most one capped line in memory (${c.pending()} characters)`);
  c.take("stderr", "\u001b[31m✓ late-line: 7 assertions\u001b[0m");
  c.take("stdout", "z\n✓ head: 2 checks\n");
  c.end();
  deep(c.tail, ["y".repeat(TAIL_LINE_CHARS) + "…", "✓ head: 2 checks", "✓ late-line: 7 assertions"], "every line, the unterminated last ones too, is capped and stripped of colour");
  eq(c.assertions, 9, "and counted");
  eq(c.pending(), 0, "nothing is left pending after the end");
}

const fx = path.join(scratch, "fx");
mkdirSync(fx);
const marks = path.join(scratch, "marks");
mkdirSync(marks);
const file = (name, body) => writeFileSync(path.join(fx, name), body);
file("pass.mjs", `console.log("✓ pass: 3 assertions — fine"); console.log("✓ pass-two: 1,204 assertions");\n`);
file("fail.mjs", `for (let i = 1; i <= 50; i++) console.log("fail line " + i); console.error("boom: the deliberate failure"); process.exitCode = 1;\n`);
file("hang.mjs", `import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
const g = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(path.join(marks, "hang.pids"))}, JSON.stringify({ self: process.pid, grandchild: g.pid }));
process.on("SIGTERM", () => console.log("hang: ignoring SIGTERM"));
console.log("hang: started"); setInterval(() => {}, 1000);\n`);
file("flaky.mjs", `import { existsSync, writeFileSync } from "node:fs";
const m = ${JSON.stringify(path.join(marks, "flaky.once"))};
if (!existsSync(m)) { writeFileSync(m, "1"); console.error("flaky: failed the first time"); process.exit(1); }
console.log("✓ flaky: 2 assertions");\n`);
file("late.mjs", `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(path.join(marks, "late.json"))}, JSON.stringify({ cwd: process.cwd(), path: process.env.PATH, diff: process.env.ASSET_DIFF_BASE || null }));
console.log("✓ late: 5 assertions");\n`);
const fixturePkg = {
  name: "fixture", private: true, type: "module",
  scripts: {
    test: "node run.mjs",
    "test:pass": "node pass.mjs",
    "test:fail": "node fail.mjs",
    "test:hang": "node hang.mjs",
    "test:flaky": "node flaky.mjs",
    "test:late": "node late.mjs && node pass.mjs",
  },
};
const fixtureSuites = {
  version: 1,
  suites: [
    { name: "pass", class: "N", medianS: 0.1 },
    { name: "fail", class: "N", medianS: 0.1 },
    { name: "hang", class: "N", medianS: 0.1, timeoutS: 1 },
    { name: "flaky", class: "N", medianS: 0.1 },
    { name: "late", class: "N", medianS: 0.1 },
  ],
};
const writeFixture = (pkg = fixturePkg, suites = fixtureSuites) => {
  file("package.json", JSON.stringify(pkg, null, 2));
  file("suites.json", JSON.stringify(suites, null, 2));
};
writeFixture();

const run = (args, { summary = null, env = {}, dir = fx } = {}) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [RUN, "--dir", dir, ...args], {
    cwd: scratch,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GITHUB_STEP_SUMMARY: summary || "", ...env },
  });
  return { ...r, ms: Date.now() - t0 };
};
const exitedOrZombie = (pid) => {
  if (existsSync("/proc/self/stat")) {
    try { return /^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return true; }
  }
  const ps = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  if (ps.error) return false;
  return ps.status !== 0 || /^\s*Z/.test(ps.stdout);
};
const alive = (pid) => { try { process.kill(pid, 0); } catch { return false; } return !exitedOrZombie(pid); };
const goneSoon = async (pid, ms = 1500) => {
  const until = Date.now() + ms;
  while (alive(pid)) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
  return true;
};
const tableRows = (md) => md.split("\n").filter((l) => /^\| \d+ \| `/.test(l));

{
  const summary = path.join(scratch, "summary-full.md");
  writeFileSync(summary, "previous step's summary\n");
  const r = run([], { summary, env: { ASSET_DIFF_BASE: "abc123" } });
  eq(r.status, 1, `a run with failures exits 1 (got ${r.status}; ${r.stderr.slice(-400)})`);
  const order = ["test:pass", "test:fail", "test:hang", "test:flaky", "test:late"].map((s) => r.stdout.indexOf(`> ${s}\n`));
  ok(order.every((i) => i >= 0), "every suite was attempted, the ones after a failure and after a hang included");
  deep([...order].sort((a, b) => a - b), order, "suites run in manifest order");
  ok(existsSync(path.join(marks, "late.json")), "the suite after the failures really ran");
  const late = JSON.parse(readFileSync(path.join(marks, "late.json"), "utf8"));
  eq(late.cwd, fx, "every suite is spawned with the manifest's directory (tests/) as its cwd");
  ok(late.path.split(path.delimiter)[0] === path.join(fx, "node_modules", ".bin"), "node_modules/.bin leads PATH, as under npm run");
  eq(late.diff, "abc123", "the environment (ASSET_DIFF_BASE) reaches the suites");

  const pids = JSON.parse(readFileSync(path.join(marks, "hang.pids"), "utf8"));
  ok(await goneSoon(pids.self), "the hung suite was killed although it ignores SIGTERM");
  ok(await goneSoon(pids.grandchild), "the hung suite's own child process was killed with it (the whole process group)");
  ok(r.ms < 1000 + KILL_GRACE_MS + 8000, `the hang cost its timeout and the kill grace, not the caller's limit (${r.ms} ms)`);

  const md = readFileSync(summary, "utf8");
  ok(md.startsWith("previous step's summary\n"), "the step summary is appended to, never overwritten");
  const rows = tableRows(md);
  eq(rows.length, 5, "the summary has one row per suite");
  ok(/`pass` \| ✅ passed \| [\d.]+ \| 1207 \|/.test(rows[0]), `the passing suite's assertions are counted: ${rows[0]}`);
  ok(/`fail` \| ❌ failed \(exit 1\)/.test(rows[1]), `the failure is reported with its exit code: ${rows[1]}`);
  ok(/`hang` \| ⏱️ timed out at 1 s/.test(rows[2]), `the hang is reported as a timeout: ${rows[2]}`);
  ok(/`flaky` \| ❌ failed \(exit 1\)/.test(rows[3]), `a flaky failure is reported, not retried away: ${rows[3]}`);
  ok(/`late` \| ✅ passed \| [\d.]+ \| 1212 \|/.test(rows[4]), `a suite of two commands sums both counts: ${rows[4]}`);
  ok(/### Regression suites: 3 of 5 failed/.test(md), "the heading counts the failures");
  ok(/2 passed, 2 failed, 1 timed out, 0 not run; 2419 assertions/.test(md), "the totals line adds every column");
  const failBlock = md.split("<code>fail</code>")[1].split("</details>")[0];
  const fenced = failBlock.split("```text\n")[1].split("\n```")[0].split("\n");
  eq(fenced.length, 40, "a failure carries its last 40 lines");
  ok(fenced.includes("fail line 50") && fenced.some((l) => l.startsWith("boom")), "the tail holds the end of stdout and the stderr");
  ok(!fenced.includes("fail line 1") && !fenced.includes("fail line 10"), "and not the head of the output");
  ok(md.includes("<code>hang</code>: timed out at 1 s") && md.includes("hang: started"), "the hang's tail is reported too");
  ok(!md.includes("<code>pass</code>"), "a passing suite has no tail");
  ok(/^\s*5\s+late\s+passed\s+[\d.]+\s+1212$/m.test(r.stdout), "the same table is printed to stdout");
  ok(r.stdout.includes("5 suites: 2 passed, 2 failed, 1 timed out, 0 not run"), "with its totals");
}

{
  rmSync(path.join(marks, "late.json"), { force: true });
  rmSync(path.join(marks, "hang.pids"), { force: true });
  const summary = path.join(scratch, "summary-bail.md");
  const r = run(["--bail"], { summary });
  eq(r.status, 1, "--bail still exits 1");
  ok(!r.stdout.includes("> test:hang"), "--bail stops at the first failure");
  ok(!existsSync(path.join(marks, "hang.pids")) && !existsSync(path.join(marks, "late.json")), "no later suite starts under --bail");
  const rows = tableRows(readFileSync(summary, "utf8"));
  eq(rows.length, 5, "the suites --bail never started are still listed");
  ok(rows.slice(2).every((l) => l.includes("⏭️ not run")), "as not run");
}

{
  const summary = path.join(scratch, "summary-green.md");
  const r = run(["--only", "pass,late"], { summary });
  eq(r.status, 0, "a run with no failure exits 0");
  ok(!r.stdout.includes("> test:fail"), "--only runs the named suites alone");
  ok(readFileSync(summary, "utf8").includes("### Regression suites: all 2 passed"), "a green summary says so");
  const again = run(["--only", "flaky"]);
  eq(again.status, 0, "the flaky fixture passes on its second call (its first was reported, never hidden)");
  const quiet = run(["--only", "pass"]);
  eq(quiet.status, 0, "with GITHUB_STEP_SUMMARY empty the run writes no summary and still succeeds");
  const onlyTimeout = run(["--only", "pass,hang"]);
  eq(onlyTimeout.status, 1, "a run whose only problem is a timeout exits 1");
  ok(onlyTimeout.stdout.includes("2 suites: 1 passed, 0 failed, 1 timed out"), "and reports the timeout");
}

{
  writeFixture({ ...fixturePkg, scripts: { ...fixturePkg.scripts, "test:orphan": "node pass.mjs" } });
  const r = run([]);
  eq(r.status, 2, "a test:* script missing from suites.json stops the runner before any suite (exit 2)");
  ok(r.stderr.includes("test:orphan is not in suites.json"), "naming the script");
  ok(!r.stdout.includes("> test:pass"), "and nothing ran");
  writeFixture(fixturePkg, { version: 1, suites: [...fixtureSuites.suites, { name: "ghost", class: "N", medianS: 1 }] });
  const g = run([]);
  eq(g.status, 2, "a suite with no script is refused");
  ok(g.stderr.includes("ghost has no test:ghost script"), "naming the suite");
  writeFixture(fixturePkg, { version: 1, suites: [...fixtureSuites.suites, fixtureSuites.suites[0]] });
  ok(run([]).stderr.includes("pass is listed twice"), "a duplicate suite is refused");
  writeFixture();
  const u = run(["--only", "nope"]);
  eq(u.status, 2, "--only of an unknown suite exits 2");
  eq(run(["--frobnicate"]).status, 2, "an unknown flag exits 2");
  for (const empty of [["--only="], ["--only", ","], ["--only", " , "]]) {
    const e = run(empty);
    eq(e.status, 2, `${empty.join(" ")} selects no suite and exits 2, never a green run of nothing`);
    ok(e.stderr.includes("names no suite") && !e.stdout.includes("> test:"), "naming the problem, with nothing run");
  }
}

const fx2 = path.join(scratch, "fx2");
mkdirSync(fx2);
const file2 = (name, body) => writeFileSync(path.join(fx2, name), body);
const mark = (name) => path.join(marks, name);
file2("pass.mjs", `console.log("✓ pass: 3 assertions");\n`);
file2("after.mjs", `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(mark("after.ran"))}, "1"); console.log("✓ after: 1 assertions");\n`);
file2("sweeper.mjs", `import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
g.unref();
let got = 0;
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => {
  console.log("sweeper: " + sig + " received, sweeping");
  if (got++) return;
  setTimeout(() => {
    try { process.kill(-g.pid, "SIGKILL"); } catch {}
    writeFileSync(${JSON.stringify(mark("sweeper.swept"))}, sig);
    process.exit(sig === "SIGINT" ? 130 : 143);
  }, 400);
});
writeFileSync(${JSON.stringify(mark("sweeper.pids"))}, JSON.stringify({ self: process.pid, escapee: g.pid }));
console.log("sweeper: started"); setInterval(() => {}, 1000);\n`);
file2("stubborn.mjs", `import { writeFileSync } from "node:fs";
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => console.log("stubborn: ignoring " + sig));
writeFileSync(${JSON.stringify(mark("stubborn.pid"))}, String(process.pid));
console.log("stubborn: started"); setInterval(() => {}, 1000);\n`);
file2("escapee.mjs", `import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { detached: true, stdio: "inherit" });
g.unref();
writeFileSync(${JSON.stringify(mark("escapee.pid"))}, String(g.pid));
console.log("✓ escapee: 1 assertions");\n`);
file2("split.mjs", `const bytes = Buffer.from("a".repeat(65534) + "\\n✓ split: 5 assertions\\n✓ split-two: 7 assertions\\n", "utf8");
process.stdout.write(bytes.subarray(0, 65536));
setTimeout(() => { process.stdout.write(bytes.subarray(65536)); process.exitCode = 1; }, 300);\n`);
file2("lingerer.mjs", `import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "inherit" });
writeFileSync(${JSON.stringify(mark("lingerer.pid"))}, String(g.pid));
console.log("✓ lingerer: 1 assertions");
process.exit(0);\n`);
file2("quitter.mjs", `import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
const g = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setTimeout(() => {}, 30000)"], { stdio: ["ignore", "pipe", "ignore"] });
g.stdout.once("data", () => {
  g.stdout.destroy();
  writeFileSync(${JSON.stringify(mark("quitter.pid"))}, String(g.pid));
  console.log("quitter: started");
});
process.on("SIGTERM", () => process.exit(143));
setInterval(() => {}, 1000);\n`);
file2("loud.mjs", `process.stdout.write("x".repeat(3 * 1024 * 1024)); process.exitCode = 1;\n`);
file2("wide.sh", `line=$(printf '%01000d' 0); i=0; while [ $i -lt 40 ]; do echo "$i $line"; i=$((i+1)); done; exit 1\n`);
const WIDE = 80;
const wideNames = Array.from({ length: WIDE }, (_, i) => `wide-${i + 1}`);
writeFileSync(path.join(fx2, "package.json"), JSON.stringify({
  name: "fixture2", private: true, type: "module",
  scripts: {
    test: "node run.mjs",
    "test:pass": "node pass.mjs",
    "test:after": "node after.mjs",
    "test:sweeper": "node sweeper.mjs",
    "test:stubborn": "node stubborn.mjs",
    "test:escapee": "node escapee.mjs",
    "test:loud": "node loud.mjs",
    "test:split": "node split.mjs",
    "test:lingerer": "node lingerer.mjs",
    "test:quitter": "node quitter.mjs",
    ...Object.fromEntries(wideNames.map((n) => [`test:${n}`, "sh wide.sh"])),
  },
}, null, 2));
writeFileSync(path.join(fx2, "suites.json"), JSON.stringify({
  version: 1,
  suites: [
    { name: "escapee", class: "N", medianS: 0.1, timeoutS: 2 },
    ...["pass", "sweeper", "stubborn", "after", "loud", "split"].map((name) => ({ name, class: "N", medianS: 0.1 })),
    { name: "lingerer", class: "N", medianS: 0.1, timeoutS: 10 },
    { name: "quitter", class: "N", medianS: 0.1, timeoutS: 1 },
    ...wideNames.map((name) => ({ name, class: "N", medianS: 0.1 })),
  ],
}, null, 2));

const waitFor = async (cond, ms, what) => {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const signalled = async (args, { ready, signals, summary }) => {
  const child = spawn(process.execPath, [RUN, "--dir", fx2, ...args], {
    cwd: scratch,
    env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => { stdout += c; });
  child.stderr.on("data", (c) => { stderr += c; });
  const closed = new Promise((resolve) => child.on("close", (code, sig) => resolve({ code, sig })));
  await waitFor(() => existsSync(ready), 20000, ready);
  await new Promise((r) => setTimeout(r, 200));
  const t0 = Date.now();
  for (const [signal, atMs] of signals) {
    const wait = t0 + atMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    child.kill(signal);
  }
  let guard;
  const end = await Promise.race([closed, new Promise((r) => { guard = setTimeout(() => r({ code: "hung" }), 20000); })]);
  clearTimeout(guard);
  if (end.code === "hung") child.kill("SIGKILL");
  return { ...end, stdout, stderr, ms: Date.now() - t0 };
};

{
  const summary = path.join(scratch, "summary-sigterm.md");
  writeFileSync(summary, "previous\n");
  const r = await signalled(["--only", "pass,sweeper,after"], { ready: mark("sweeper.pids"), signals: [["SIGTERM", 0]], summary });
  eq(r.code, 143, `SIGTERM to the runner exits 143 (got ${r.code}; ${r.stderr.slice(-300)})`);
  const pids = JSON.parse(readFileSync(mark("sweeper.pids"), "utf8"));
  ok(existsSync(mark("sweeper.swept")), "the running suite got the SIGTERM itself and its own cleanup ran (not an immediate SIGKILL)");
  eq(readFileSync(mark("sweeper.swept"), "utf8"), "SIGTERM", "the runner passed on the signal it received");
  ok(await goneSoon(pids.self), "the interrupted suite is gone");
  ok(await goneSoon(pids.escapee), "and so is the detached process it swept on SIGTERM, which a SIGKILL of the group would have leaked");
  ok(!existsSync(mark("after.ran")), "no suite starts after an interrupt");
  const md = readFileSync(summary, "utf8");
  ok(md.startsWith("previous\n"), "the partial summary is appended");
  const rows = tableRows(md);
  eq(rows.length, 3, "an interrupted run still writes one row per selected suite");
  ok(/`pass` \| ✅ passed/.test(rows[0]), `the suites that finished keep their result: ${rows[0]}`);
  ok(/`sweeper` \| ❌ failed \(interrupted by SIGTERM\)/.test(rows[1]), `the interrupted suite is a failure, interrupted: ${rows[1]}`);
  ok(/`after` \| ⏭️ not run/.test(rows[2]), `the suites after it are not run: ${rows[2]}`);
  ok(md.includes("(run interrupted by SIGTERM)") && md.includes("sweeper: SIGTERM received, sweeping"), "the heading says the run was interrupted, and the suite's tail is kept");
  ok(r.stdout.includes("3 suites: 1 passed, 1 failed, 0 timed out, 1 not run"), "the table is printed to stdout too");
}

{
  const summary = path.join(scratch, "summary-sigint.md");
  const r = await signalled(["--only", "stubborn,after", "--timeout-scale", "100"], { ready: mark("stubborn.pid"), signals: [["SIGINT", 0]], summary });
  eq(r.code, 130, `SIGINT to the runner exits 130 (got ${r.code})`);
  ok(await goneSoon(Number(readFileSync(mark("stubborn.pid"), "utf8"))), "a suite that ignores the signal is SIGKILLed after the grace");
  ok(r.ms >= KILL_GRACE_MS - 100 && r.ms < KILL_GRACE_MS + 6000, `after the grace, not at once and not at its timeout (${r.ms} ms)`);
  ok(/`stubborn` \| ❌ failed \(interrupted by SIGINT\)/.test(readFileSync(summary, "utf8")), "and is recorded as interrupted");
}

const clearMarks = (...names) => { for (const n of names) rmSync(mark(n), { force: true }); };

{
  clearMarks("sweeper.pids", "sweeper.swept", "after.ran");
  const summary = path.join(scratch, "summary-double.md");
  const r = await signalled(["--only", "sweeper,after"], { ready: mark("sweeper.pids"), signals: [["SIGINT", 0], ["SIGINT", 5]], summary });
  eq(r.code, 130, `two SIGINTs 5 ms apart (one Ctrl-C, from the terminal and from npm) exit 130 (got ${r.code}; ${r.stderr.slice(-300)})`);
  const pids = JSON.parse(readFileSync(mark("sweeper.pids"), "utf8"));
  ok(existsSync(mark("sweeper.swept")), "the repeat inside the window did not escalate: the suite's own sweep ran");
  ok(await goneSoon(pids.escapee), "and the detached process it swept is gone");
  ok(await goneSoon(pids.self), "the suite is gone");
  ok(!r.stderr.includes("received again"), "the repeat was not taken as a second, escalating signal");
  ok(/`sweeper` \| ❌ failed \(interrupted by SIGINT\)/.test(readFileSync(summary, "utf8")), "the suite is recorded as interrupted by SIGINT");
}

{
  clearMarks("sweeper.pids", "sweeper.swept", "after.ran");
  const summary = path.join(scratch, "summary-sighup.md");
  const r = await signalled(["--only", "sweeper,after"], { ready: mark("sweeper.pids"), signals: [["SIGHUP", 0]], summary });
  eq(r.code, 129, `SIGHUP (the terminal closed) exits 129 (got ${r.code}; ${r.stderr.slice(-300)})`);
  const pids = JSON.parse(readFileSync(mark("sweeper.pids"), "utf8"));
  eq(existsSync(mark("sweeper.swept")) && readFileSync(mark("sweeper.swept"), "utf8"), "SIGHUP", "the SIGHUP was passed to the suite in its own session, and its sweep ran");
  ok(await goneSoon(pids.escapee) && await goneSoon(pids.self), "the suite and its swept escapee are gone");
  ok(!existsSync(mark("after.ran")), "no suite starts after the hang-up");
  ok(/run interrupted by SIGHUP/.test(readFileSync(summary, "utf8")), "the summary is still written");
}

{
  clearMarks("stubborn.pid", "after.ran");
  const summary = path.join(scratch, "summary-escalate.md");
  const r = await signalled(["--only", "stubborn,after", "--timeout-scale", "100"], { ready: mark("stubborn.pid"), signals: [["SIGINT", 0], ["SIGINT", REPEAT_WINDOW_MS + 300]], summary });
  eq(r.code, 130, `a second SIGINT after the window still exits 130 (got ${r.code})`);
  ok(await goneSoon(Number(readFileSync(mark("stubborn.pid"), "utf8"))), "the suite that ignores signals is gone");
  ok(r.ms >= REPEAT_WINDOW_MS + 200 && r.ms < KILL_GRACE_MS - 300, `a second signal after the window SIGKILLs at once, before the grace runs out (${r.ms} ms)`);
  ok(r.stderr.includes("received again"), "and says so");
}

{
  const summary = path.join(scratch, "summary-split.md");
  const r = run(["--only", "split"], { dir: fx2, summary });
  eq(r.status, 1, "the split fixture fails, so its tail is reported");
  const md = readFileSync(summary, "utf8");
  ok(/`split` \| ❌ failed \(exit 1\) \| [\d.]+ \| 12 \|/.test(tableRows(md)[0]), `a ✓ split across the 64 KiB pipe chunk is still counted: ${tableRows(md)[0]}`);
  ok(r.stdout.includes("✓ split: 5 assertions") && !r.stdout.includes("\uFFFD"), "the echoed log holds the ✓, not U+FFFD");
  ok(md.includes("✓ split: 5 assertions") && !md.includes("\uFFFD"), "and so does the failure's tail");
}

{
  clearMarks("lingerer.pid");
  const summary = path.join(scratch, "summary-lingerer.md");
  const r = run(["--only", "lingerer,pass"], { dir: fx2, summary });
  const pid = Number(readFileSync(mark("lingerer.pid"), "utf8"));
  const left = !(await goneSoon(pid));
  try { process.kill(pid, "SIGKILL"); } catch {}
  eq(r.status, 0, `a suite that exits 0 with a child of its own group still holding its output passes (got ${r.status}; ${r.stderr.slice(-300)})`);
  ok(!left, "the child left in the suite's group is killed when the suite exits");
  ok(r.ms < 6000, `and the run does not wait for the suite's 10 s timeout (${r.ms} ms)`);
  const rows = tableRows(readFileSync(summary, "utf8"));
  ok(rows.length === 2 && rows.some((l) => /`lingerer` \| ✅ passed/.test(l)) && rows.some((l) => /`pass` \| ✅ passed/.test(l)), `both are reported as passed: ${rows.join(" / ")}`);
}

{
  clearMarks("quitter.pid");
  const summary = path.join(scratch, "summary-quitter.md");
  const r = run(["--only", "quitter,pass"], { dir: fx2, summary });
  const pid = Number(readFileSync(mark("quitter.pid"), "utf8"));
  const left = !(await goneSoon(pid));
  try { process.kill(pid, "SIGKILL"); } catch {}
  ok(!left, "a child in the suite's group that ignores SIGTERM is SIGKILLed when the timed-out suite closes, though the suite itself left on SIGTERM");
  eq(r.status, 1, "the timeout fails the run");
  ok(tableRows(readFileSync(summary, "utf8")).some((l) => /`quitter` \| ⏱️ timed out at 1 s/.test(l)), "and is reported as a timeout");
}

{
  const r = run(["--only", "pass", "--timeout-scale=100000"], { dir: fx2 });
  eq(r.status, 0, `a scale that would overflow setTimeout does not kill every suite at once (got ${r.status}; ${r.stdout.slice(-300)})`);
  ok(r.stdout.includes("1 suites: 1 passed, 0 failed, 0 timed out") && !r.stdout.includes("timed out at"), "the suite is reported as passed, not timed out");
}

{
  const summary = path.join(scratch, "summary-escapee.md");
  const r = run(["--only", "escapee,pass"], { dir: fx2, summary });
  const escapee = Number(readFileSync(mark("escapee.pid"), "utf8"));
  const stillThere = alive(escapee);
  try { process.kill(escapee, "SIGKILL"); } catch {}
  ok(stillThere, "the fixture really left a detached process holding the suite's output");
  eq(r.status, 1, "a suite whose output is held open past its timeout fails the run");
  ok(r.ms < 2000 + 8000, `it ends at its 2 s timeout, not when the 15 s escapee lets go (${r.ms} ms)`);
  const md = readFileSync(summary, "utf8");
  const rows = tableRows(md);
  ok(/`escapee` \| ⏱️ timed out at 2 s/.test(rows[0]), `it is reported as a timeout: ${rows[0]}`);
  ok(/`pass` \| ✅ passed/.test(rows[1]), "and the next suite still runs");
  ok(md.includes("still held its output open"), "the tail says why");
}

{
  const summary = path.join(scratch, "summary-loud.md");
  const r = run(["--only", "loud"], { dir: fx2, summary });
  eq(r.status, 1, "the loud fixture fails");
  const md = readFileSync(summary, "utf8");
  ok(Buffer.byteLength(md) < 4096, `3 MiB on one unterminated line leaves a small summary (${Buffer.byteLength(md)} bytes)`);
  const fenced = md.split("```text\n")[1].split("\n```")[0];
  eq(fenced, "x".repeat(TAIL_LINE_CHARS) + "…", "the unterminated last line is capped like any other line");
}

{
  const summary = path.join(scratch, "summary-wide.md");
  const r = run(["--only", wideNames.join(",")], { dir: fx2, summary });
  eq(r.status, 1, "every wide fixture fails");
  const md = readFileSync(summary, "utf8");
  const bytes = Buffer.byteLength(md);
  ok(bytes < 768 * 1024, `${WIDE} failures with 40 full-width lines each stay well under GitHub's 1 MiB step-summary limit (${bytes} bytes)`);
  eq(tableRows(md).length, WIDE, "every row is still there");
  eq((md.match(/<details>/g) || []).length, WIDE, "and every failure keeps a tail");
  ok(md.includes("earlier lines left out to keep the summary small") && md.includes("39 0000000000"), "shortened from the head, so each keeps its last line, and says so");
}

const PUBLISHED_SHARDS = [
  ["flows-worker", "flows-sections", "flows-alerts", "flows-freshness", "flows-readers", "flows-stock",
    "flows-quant-audit", "flows-reading-render", "server-desk", "flows-stats"],
  ["flows", "flows-universe", "flows-chain-panels", "worker", "flows-ticker", "flows-legacy", "flows-motion",
    "flows-overlay", "flows-board-render", "flows-strategy", "flows-brief", "flows-variation", "flows-dossier",
    "flows-reading-worker", "architecture", "server-ai"],
  ["pipeline", "flows-probe", "flows-legs", "flows-record", "flows-desk-client", "flows-desk-wiring",
    "flows-unusual", "flows-payload-shape", "flows-rt", "flows-starts", "flows-reads", "flows-political",
    "flows-ask", "flows-neuron", "flows-conviction"],
  ["markets", "academy", "flows-rt-client", "flows-chain", "flows-basis", "flows-market", "flows-events",
    "flows-permits", "flows-watch-render", "flows-net-render", "flows-sign", "flows-garch", "flows-quant",
    "route-matrix", "server-kernel", "server-router"],
  ["flows-ws-probe", "placement", "flows-rt-server", "flows-desk", "flows-scores", "flows-pulse",
    "flows-readers-render", "flows-export", "flows-ledger", "flows-verdict", "flows-political-render", "flows-strip",
    "flows-track-render", "flows-warnings", "flows-quant-card", "flows-reading", "docs"],
  ["market-ticker", "landing-motion", "mastery", "flows-overview", "flows-render", "browser", "flows-mint",
    "flows-live", "flows-weight", "flows-ask-render", "flows-vol", "flows-positioning", "flows-neuron-screen",
    "flows-dossier-reads", "server-ingest", "flows-ai-broker", "flows-conviction-render"],
];
const CI_SHARDS = 6;

{
  const suites = loadManifest();
  const names = (list) => list.map((s) => s.name);
  const sorted = (list) => [...list].sort();
  const fast = suites.filter((s) => groupOf(s) === "fast");
  deep(names(fast), ["contracts", "run"], "the fast job runs the asset and curriculum contracts (the one suite that needs fetch-depth 0 and ASSET_DIFF_BASE) and this contract, neither of which needs Chromium or workerd");
  const shards = packShards(suites, CI_SHARDS);
  const packed = shards.map((sh) => sorted(names(sh)));
  const same = JSON.stringify(packed) === JSON.stringify(PUBLISHED_SHARDS.map(sorted));
  deep(packed, PUBLISHED_SHARDS.map(sorted),
    "THE SIX-SHARD ASSIGNMENT EQUALS THE PUBLISHED TABLE (W09-P3 and its measured medians, contracts moved to the fast job): a median refresh or a new suite that moves a suite between shards fails here until the table is republished with it" +
      (same ? "" : `; republish PUBLISHED_SHARDS as the packing computed now: ${JSON.stringify(shards.map(names))}`));
  for (let n = 1; n <= 8; n++) {
    const a = packShards(suites, n);
    deep(packShards(suites, n), a, `${n} shards: the packing is deterministic`);
    ok(a.every((sh) => sh.length > 0), `${n} shards: no shard is empty`);
    const all = [...names(fast), ...a.flatMap(names)];
    deep(sorted(all), sorted(names(suites)), `${n} shards: the fast job and the shards together run every registered suite exactly once (${all.length} of ${suites.length})`);
    for (const sh of a) deep(names(sh), names(suites.filter((s) => sh.includes(s))), `${n} shards: a shard runs its suites in manifest order`);
    deep(a.map((sh, i) => names(chooseSuites(suites, { shard: { index: i + 1, count: n } }))), a.map(names), `${n} shards: --shard i/${n} selects exactly the packed shard`);
  }
  deep(names(chooseSuites(suites, { group: "shard" })).length + fast.length, suites.length, "--group shard is everything but the fast job");
  const unfasted = suites.map((s) => (s.name === "contracts" ? { ...s, group: undefined } : s));
  const home = packShards(unfasted, CI_SHARDS).findIndex((sh) => sh.some((s) => s.name === "contracts"));
  ok(home >= 0, "contracts, weighed as a shard suite, lands in exactly one shard");
  deep(packShards(unfasted, CI_SHARDS).map(names), shards.map((sh, i) => names(suites.filter((s) => sh.includes(s) || (i === home && s.name === "contracts")))),
    "the packing weighs the whole chain, fast suites included, so moving contracts into or out of the fast job changes no other suite's shard");
  ok(shards.every(needsBrowser), "every one of the six shards holds a browser or workerd suite, so each installs Chromium");
  ok(!needsBrowser(fast), "the fast job holds none and installs no Chromium");
  ok(fast.every((s) => s.class === "N"), "every fast suite is a Node suite");

  const wf = readFileSync(path.join(HERE, "..", ".github", "workflows", "regression.yml"), "utf8");
  const shardJob = (/\n {2}shard:\n((?: {4}.*\n|\s*\n)+)/.exec(wf) || [])[1] || "";
  const cap = Number((/^ {4}timeout-minutes: (\d+)$/m.exec(shardJob) || [])[1]);
  const hangS = (sh) => {
    const sum = sh.reduce((t, s) => t + (s.medianS || 0), 0);
    return Math.max(...sh.map((s) => sum - (s.medianS || 0) + timeoutFor(s)));
  };
  shards.forEach((sh, i) => {
    const worst = hangS(sh);
    ok(cap * 60 >= worst + 300, `shard ${i + 1}/${CI_SHARDS}: the job's cap (${cap} min) holds the worst hang (${Math.round(worst)} s: one suite run to its own timeout and every other suite in the shard at its median) and five minutes of setup, so a hung suite is killed by run.mjs and reported in the summary before the job is cancelled`);
  });
  ok(hangS([{ medianS: 390, timeoutS: 780 }, { medianS: 110 }]) === 890 && hangS([{ medianS: 110, timeoutS: 900 }, { medianS: 390 }]) === 1290,
    "worked by hand: the worst hang is the shard's medians with one suite's median replaced by its timeout, maximised over the suites (a 500 s shard holding a 110 s suite whose timeout is 900 s hangs for 1,290 s, which the slowest timeout plus setup alone would have read as 900)");
  deep([...shardJob.matchAll(/node run\.mjs --shard \$\{\{ matrix\.shard \}\}\/(\d+)/g)].map((m) => Number(m[1])), [CI_SHARDS, CI_SHARDS],
    `the workflow's needs-browser step and its run step both split the chain into the ${CI_SHARDS} shards this table holds`);
}

{
  eq(CHROMIUM_SETUP_S, 24, "a shard that holds its first browser or workerd suite is charged the measured 24 s of Chromium install");
  const w = (name, cls, medianS, group) => ({ name, class: cls, medianS, ...(group ? { group } : {}) });
  const tiny = [w("f", "N", 0.1, "fast"), w("c", "N", 30), w("b", "C", 10), w("d", "W", 2), w("a", "N", 5), w("u", "N", null)];
  deep(packShards(tiny, 2).map((sh) => sh.map((s) => s.name)), [["c", "a", "u"], ["b", "d"]],
    "worked by hand: longest first into the cheapest shard, a browser suite charged the install only in a shard without one (b to the empty shard at 34 rather than 64, a beside c at 35 rather than 39, d beside b at 36 rather than 61), the fast suite weighed and left out, the unmeasured suite at weight 0");
  deep(packShards(tiny, 1).map((sh) => sh.map((s) => s.name)), [["c", "b", "d", "a", "u"]], "one shard is the whole shard group in manifest order");
  const parsed = parseArgs(["--shard", "2/6", "--needs-browser"]);
  deep([parsed.shard, parsed.needsBrowser], [{ index: 2, count: 6 }, true], "--shard i/n and --needs-browser are parsed");
  eq(parseArgs(["--group=fast"]).group, "fast", "--group is parsed");
  for (const bad of ["0/6", "7/6", "1/0", "x/6", "1/6/2", "-1/6", "1.5/6", `1/${MAX_SHARDS + 1}`, "01/6"]) {
    throwsLike(() => parseArgs(["--shard", bad]), UsageError, `--shard ${bad} is refused`);
  }
  throwsLike(() => parseArgs(["--group", "slow"]), UsageError, "an unknown group is refused");
  throwsLike(() => parseArgs(["--only", "a", "--shard", "1/2"]), UsageError, "--only with --shard is refused");
  throwsLike(() => parseArgs(["--group", "fast", "--shard", "1/2"]), UsageError, "--shard with --group fast is refused");
  throwsLike(() => chooseSuites(tiny, { shard: { index: 8, count: 8 } }), /holds no suite/, "an empty shard is refused, never a green run of nothing");
  throwsLike(() => chooseSuites([w("a", "N", 1)], { group: "fast" }), /group fast holds no suite/, "and so is an empty group");
}

const fx3 = path.join(scratch, "fx3");
mkdirSync(fx3);
writeFileSync(path.join(fx3, "s.mjs"), `import { writeFileSync } from "node:fs";
const n = process.argv[2];
writeFileSync(${JSON.stringify(marks)} + "/ran-" + n, "1");
console.log("✓ " + n + ": 1 assertions");
if (n === "d") process.exitCode = 1;\n`);
const fx3Names = ["f", "c", "b", "d", "a", "u"];
writeFileSync(path.join(fx3, "package.json"), JSON.stringify({
  name: "fixture3", private: true, type: "module",
  scripts: { test: "node run.mjs", ...Object.fromEntries(fx3Names.map((n) => [`test:${n}`, `node s.mjs ${n}`])) },
}, null, 2));
const fx3Suites = [
  { name: "f", class: "N", group: "fast", medianS: 0.1 },
  { name: "c", class: "N", medianS: 30 },
  { name: "b", class: "C", medianS: 10 },
  { name: "d", class: "W", medianS: 2 },
  { name: "a", class: "N", medianS: 5 },
  { name: "u", class: "N", medianS: null },
];
writeFileSync(path.join(fx3, "suites.json"), JSON.stringify({ version: 1, suites: fx3Suites }, null, 2));
const ran = () => fx3Names.filter((n) => existsSync(mark(`ran-${n}`)));
const clearRan = () => { for (const n of fx3Names) rmSync(mark(`ran-${n}`), { force: true }); };

{
  clearRan();
  const nb = [run(["--shard", "1/2", "--needs-browser"], { dir: fx3 }), run(["--shard", "2/2", "--needs-browser"], { dir: fx3 }), run(["--group", "fast", "--needs-browser"], { dir: fx3 })];
  deep(nb.map((r) => [r.status, r.stdout]), [[0, "false\n"], [0, "true\n"], [0, "false\n"]], "--needs-browser prints true or false for the selection alone, exits 0, for the workflow to write to $GITHUB_OUTPUT");
  deep(ran(), [], "and runs nothing");
  const summary = path.join(scratch, "summary-shard.md");
  const one = run(["--shard", "1/2"], { dir: fx3, summary });
  eq(one.status, 0, `shard 1/2 passes (${one.stderr.slice(-300)})`);
  deep(ran(), ["c", "a", "u"], "shard 1/2 ran its three suites and no other");
  ok(readFileSync(summary, "utf8").startsWith("### Regression suites, shard 1/2: all 3 passed"), "its step summary names the shard");
  clearRan();
  const two = run(["--shard", "2/2"], { dir: fx3, summary });
  eq(two.status, 1, "shard 2/2 holds the failing suite and exits 1");
  deep(ran(), ["b", "d"], "shard 2/2 ran its two suites");
  ok(readFileSync(summary, "utf8").includes("### Regression suites, shard 2/2: 1 of 2 failed"), "and its summary is appended after shard 1's, named");
  clearRan();
  const fast = run(["--group", "fast"], { dir: fx3, summary });
  eq(fast.status, 0, "the fast group passes");
  deep(ran(), ["f"], "the fast group ran the fast suite alone");
  ok(readFileSync(summary, "utf8").includes("### Regression suites, fast: all 1 passed"), "under its own heading");
  clearRan();
  const whole = run([], { dir: fx3 });
  eq(whole.status, 1, "a run with no shard or group is the whole chain, as npm test runs it locally");
  deep(ran(), fx3Names.slice().sort((x, y) => fx3Names.indexOf(x) - fx3Names.indexOf(y)), "every suite, the fast one included");
  for (const [args, re] of [[["--shard", "8/8"], /holds no suite/], [["--shard", "0/2"], /--shard needs i\/n/], [["--group", "slow"], /fast or shard/], [["--only", "c", "--shard", "1/2"], /takes no --shard/]]) {
    clearRan();
    const r = run(args, { dir: fx3 });
    eq(r.status, 2, `${args.join(" ")} exits 2`);
    ok(re.test(r.stderr) && !ran().length, `${args.join(" ")} names the problem and runs nothing`);
  }
  writeFileSync(path.join(fx3, "suites.json"), JSON.stringify({ version: 1, suites: [...fx3Suites.slice(0, -1), { ...fx3Suites.at(-1), group: "slow" }] }, null, 2));
  const g = run(["--shard", "1/2"], { dir: fx3 });
  ok(g.status === 2 && g.stderr.includes("u has group \"slow\", not fast or shard"), "a suite in an unknown group is refused before anything runs");
}

{
  const suites = loadManifest();
  const live = readQuarantine(HERE);
  deep(live.problems, [], "tests/quarantine.json is a version 1 file with an entries list");
  deep(checkQuarantine(live.entries, { suites }), [], `the committed quarantine has no malformed, unregistered or expired entry (${live.entries.length} entries, checked against today's UTC date)`);
  const timing = suites.filter((s) => s.timing === true);
  ok(timing.length === 8 && timing.every((s) => s.class === "N"), "the eight timing suites are all Node suites");
  ok(timing.every((s) => retryAllowed(s, { CI: "true" })) && !timing.some((s) => retryAllowed(s, {})) && !timing.some((s) => retryAllowed(s, { CI: "false" })), "a timing suite is retryable in CI and only there");
  ok(!suites.filter((s) => s.timing !== true).some((s) => retryAllowed(s, { CI: "true" })), "and no other suite is retryable anywhere");
  ok(!retryAllowed({ name: "x", timing: true, class: "C" }, { CI: "true" }) && !retryAllowed({ name: "x", timing: true, class: "W" }, { CI: "true" }), "a Chromium or workerd suite is never retried, even if it were tagged");

  const base = { suite: "flows-rt", assertion: "rt cpu per poll under 6 ms", firstSeen: "2025-03-10", expires: "2025-03-17", issue: "https://github.com/anilkaya/anilkaya.org/issues/1" };
  const check = (entries, today = "2025-03-12") => checkQuarantine(entries, { suites, today });
  deep(check([base]), [], "quarantine: an entry inside its seven days passes");
  deep(check([{ ...base, expires: "2025-03-12" }]), [], "quarantine: on its last day it still passes");
  const has = (problems, re, msg) => ok(problems.some((p) => re.test(p)), `${msg}: ${JSON.stringify(problems.slice(0, 2))}`);
  has(check([base], "2025-03-18"), /expired on 2025-03-17: fix the flake in flows-rt/, "MUTATION: an entry whose expires is yesterday fails");
  has(check([{ ...base, expires: "2025-03-18" }]), /more than 7 days after 2025-03-10/, "MUTATION: an expiry eight days out fails");
  has(check([{ ...base, expires: "2025-03-09" }]), /before it was first seen/, "MUTATION: an expiry before the first sighting fails");
  has(check([{ ...base, suite: "flows-nope" }]), /not registered/, "MUTATION: an unregistered suite fails");
  has(check([{ ...base, suite: "flows-weight" }]), /not tagged timing/, "MUTATION: a suite that is not tagged timing fails, since it is never retried");
  has(check([{ ...base, issue: "" }]), /names no issue/, "MUTATION: an entry with no issue fails");
  has(check([{ ...base, assertion: " " }]), /names no assertion/, "MUTATION: an entry with no assertion fails");
  has(check([{ ...base, firstSeen: "2025-02-30" }]), /firstSeen "2025-02-30", not a UTC date/, "MUTATION: an impossible date fails");
  has(check([{ ...base, expires: 20261017 }]), /expires 20261017, not a UTC date/, "MUTATION: a non-string date fails");
  has(check([{ suite: "flows-rt" }]), /has keys/, "MUTATION: a missing field fails");
  has(check([{ ...base, extra: 1 }]), /has keys/, "MUTATION: an extra field fails");
  has(check([base, base]), /repeats flows-rt/, "MUTATION: a duplicate entry fails");
  has(check(["x"]), /is not an object/, "MUTATION: a non-object entry fails");
  eq(MAX_QUARANTINE_DAYS, 7, "the window is seven days");
  eq(dayMs("2025-03-17") - dayMs("2025-03-10"), 7 * 86400000, "and the date arithmetic is whole UTC days");
  eq(recordedFor([base], "flows-rt", "2025-03-12").expires, "2025-03-17", "a live entry answers a FLAKY outcome of its suite");
  eq(recordedFor([base], "flows-rt", "2025-03-18"), null, "an expired one does not");
  eq(recordedFor([base], "flows-live", "2025-03-12"), null, "and an entry for another suite does not");

  const q = path.join(scratch, "fxq");
  mkdirSync(q);
  const put = (name, body) => writeFileSync(path.join(q, name), body);
  put("count.mjs", `import { appendFileSync } from "node:fs";
const [name, fails] = process.argv.slice(2);
const f = ${JSON.stringify(path.join(marks, "count-"))} + name;
appendFileSync(f, "x");
const n = (await import("node:fs")).readFileSync(f, "utf8").length;
if (n <= Number(fails)) { console.error("count " + name + ": failed attempt " + n); process.exit(1); }
console.log("✓ count-" + name + ": 4 assertions");\n`);
  put("slow.mjs", `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(path.join(marks, "count-"))} + "slow", "x");
setInterval(() => {}, 1000);\n`);
  const names = { once: 1, twice: 99, plain: 1, flaky2: 1 };
  put("package.json", JSON.stringify({
    name: "fixture", private: true, type: "module",
    scripts: {
      "test:once": "node count.mjs once 1", "test:twice": "node count.mjs twice 99", "test:plain": "node count.mjs plain 1",
      "test:slow": "node slow.mjs", "test:steady": "node count.mjs steady 0",
    },
  }));
  const suitesOf = (over = {}) => ({
    version: 2,
    suites: [
      { name: "once", class: "N", timing: true, medianS: 0.1 },
      { name: "twice", class: "N", timing: true, medianS: 0.1 },
      { name: "plain", class: "N", timing: false, medianS: 0.1 },
      { name: "slow", class: "N", timing: true, medianS: 0.1, timeoutS: 1 },
      { name: "steady", class: "N", timing: true, medianS: 0.1 },
    ].map((x) => ({ ...x, ...(over[x.name] || {}) })),
  });
  put("suites.json", JSON.stringify(suitesOf()));
  const countOf = (name) => (existsSync(path.join(marks, "count-" + name)) ? readFileSync(path.join(marks, "count-" + name), "utf8").length : 0);
  const reset = () => { for (const n of [...Object.keys(names), "slow", "steady"]) rmSync(path.join(marks, "count-" + n), { force: true }); };

  reset();
  const summary = path.join(scratch, "summary-flaky.md");
  writeFileSync(summary, "");
  const ci = run(["--only", "once,steady"], { dir: q, summary, env: { CI: "true", GITHUB_ACTIONS: "true" } });
  eq(ci.status, 0, `a timing suite that fails once and passes on retry is green in CI (${ci.stderr.slice(-300)})`);
  deep([countOf("once"), countOf("steady")], [2, 1], "it ran twice, and a suite that passed ran once");
  ok(/once\s+passed on retry \(FLAKY\)/.test(ci.stdout), "the table says FLAKY in the suite's row");
  ok(/2 suites: 2 passed \(1 FLAKY\), 0 failed/.test(ci.stdout), "and the tally counts it");
  ok(ci.stderr.includes("FLAKY test:once: failed once, passed on retry; NOT RECORDED in tests/quarantine.json"), "an unrecorded flake says so on stderr");
  ok(ci.stdout.includes("::warning title=FLAKY once::"), "and raises an annotation under GitHub Actions");
  const md = readFileSync(summary, "utf8");
  ok(md.startsWith("### Regression suites: all 2 passed, 1 of them FLAKY"), "the step summary heading counts it");
  ok(/\| 1 \| `once` \| ⚠️ passed on retry \(FLAKY\) \|/.test(md), "its row carries the warning mark");
  ok(md.includes("count once: failed attempt 1") && md.includes("NOT RECORDED: add a tests/quarantine.json entry"), "and the first attempt's tail and the missing record are in a details block");

  reset();
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  put("quarantine.json", JSON.stringify({ version: 1, entries: [{ suite: "once", assertion: "the timing gate", firstSeen: today, expires: soon, issue: "#1" }] }));
  const rec = run(["--only", "once"], { dir: q, summary: path.join(scratch, "summary-rec.md"), env: { CI: "true" } });
  eq(rec.status, 0, "a recorded flake is green too");
  ok(rec.stderr.includes(`recorded in tests/quarantine.json until ${soon}`), "and names its entry's expiry");
  rmSync(path.join(q, "quarantine.json"));

  reset();
  const never = run(["--only", "once"], { dir: q, env: { CI: "" } });
  eq(never.status, 1, "outside CI a timing suite is not retried: the first failure is the result");
  eq(countOf("once"), 1, "it ran once");
  reset();
  const falseCi = run(["--only", "once"], { dir: q, env: { CI: "false" } });
  eq(falseCi.status, 1, "CI=false is not CI");

  reset();
  const plain = run(["--only", "plain"], { dir: q, env: { CI: "true" } });
  eq(plain.status, 1, "a suite not tagged timing is red in CI on its first failure");
  eq(countOf("plain"), 1, "and ran once");

  reset();
  const twice = run(["--only", "twice"], { dir: q, summary: path.join(scratch, "summary-twice.md"), env: { CI: "true" } });
  eq(twice.status, 1, "a timing suite that fails the retry too is red");
  eq(countOf("twice"), 2, "after exactly one retry, never more");
  ok(/failed \(exit 1, twice\)/.test(twice.stdout), "and its row says it failed twice");

  reset();
  const hang = run(["--only", "slow"], { dir: q, env: { CI: "true" } });
  eq(hang.status, 1, "a timing suite that times out is red");
  eq(countOf("slow"), 1, "and a timeout is not retried: a hang is not a flake");

  reset();
  const quiet = run(["--only", "once,steady"], { dir: q, env: { CI: "true", GITHUB_ACTIONS: "" } });
  eq(quiet.status, 0, "the annotation is for GitHub Actions only");
  ok(!quiet.stdout.includes("::warning"), "no annotation without it");

  put("suites.json", JSON.stringify(suitesOf({ plain: { timing: true, class: "C" } })));
  const refused = run(["--only", "once"], { dir: q, env: { CI: "true" } });
  eq(refused.status, 2, "a manifest that tags a Chromium suite timing is refused before anything runs");
  ok(/plain is tagged timing but is class "C"/.test(refused.stderr), "naming the suite and the rule");
  put("suites.json", JSON.stringify(suitesOf()));
  put("quarantine.json", "{ not json");
  const broken = run(["--only", "steady"], { dir: q, env: { CI: "true" } });
  ok(broken.status === 2 && /quarantine\.json is not valid JSON/.test(broken.stderr), "a quarantine file that does not parse stops the run instead of being ignored");
  rmSync(path.join(q, "quarantine.json"));
}

console.log(`✓ run: ${checks} assertions — every registered suite attempted after a failure and after a hang, the hang and its children killed at the manifest's timeout, exit 1 on any failure and 0 only when all pass, one summary row per suite appended to the step summary with the last 40 lines of each failure inside a bounded summary, --bail and --only, an empty selection and a test:* script left out of suites.json refused before anything runs, a suite whose output outlives it ended at its timeout, a child left in a suite's group killed when the suite exits or closes, a character split across a pipe chunk decoded whole, a timeout past setTimeout's range capped rather than fired at once, the six CI shards equal to the published table and, with the fast job, every suite exactly once for one to eight shards, --shard, --group and --needs-browser on a hand-worked fixture, and SIGINT, SIGTERM or SIGHUP passed to the running suite with a partial summary written, a repeat within ${REPEAT_WINDOW_MS} ms not escalated and a later one escalated to SIGKILL`);
