import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DIR, TIMEOUT_FLOOR_S, KILL_GRACE_MS, TAIL_LINES, TAIL_LINE_CHARS,
  loadManifest, timeoutFor, countAssertions, parseArgs, selectSuites, UsageError, tailCollector,
} from "./run.mjs";

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
  eq(timeoutFor({ medianS: 374.9 }), 1125, "the default timeout is three medians, rounded up");
  eq(timeoutFor({ medianS: 0.1 }), TIMEOUT_FLOOR_S, "a sub-second suite still gets the floor");
  eq(timeoutFor({ medianS: null }), TIMEOUT_FLOOR_S, "an unmeasured suite gets the floor");
  eq(timeoutFor({ medianS: 374.9, timeoutS: 30 }), 30, "an explicit timeoutS wins over the median");
  eq(timeoutFor({ medianS: 100 }, 2), 600, "--timeout-scale multiplies the timeout");
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
const alive = (pid) => { try { process.kill(pid, 0); } catch { return false; } try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return false; } };
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
  ok(!alive(pids.self), "the hung suite was killed although it ignores SIGTERM");
  ok(!alive(pids.grandchild), "the hung suite's own child process was killed with it (the whole process group)");
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
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
  console.log("sweeper: " + sig + " received, sweeping");
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
    ...Object.fromEntries(wideNames.map((n) => [`test:${n}`, "sh wide.sh"])),
  },
}, null, 2));
writeFileSync(path.join(fx2, "suites.json"), JSON.stringify({
  version: 1,
  suites: [
    { name: "escapee", class: "N", medianS: 0.1, timeoutS: 2 },
    ...["pass", "sweeper", "stubborn", "after", "loud"].map((name) => ({ name, class: "N", medianS: 0.1 })),
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
const signalled = async (args, { ready, signal, summary }) => {
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
  child.kill(signal);
  let guard;
  const end = await Promise.race([closed, new Promise((r) => { guard = setTimeout(() => r({ code: "hung" }), 20000); })]);
  clearTimeout(guard);
  if (end.code === "hung") child.kill("SIGKILL");
  return { ...end, stdout, stderr, ms: Date.now() - t0 };
};

{
  const summary = path.join(scratch, "summary-sigterm.md");
  writeFileSync(summary, "previous\n");
  const r = await signalled(["--only", "pass,sweeper,after"], { ready: mark("sweeper.pids"), signal: "SIGTERM", summary });
  eq(r.code, 143, `SIGTERM to the runner exits 143 (got ${r.code}; ${r.stderr.slice(-300)})`);
  const pids = JSON.parse(readFileSync(mark("sweeper.pids"), "utf8"));
  ok(existsSync(mark("sweeper.swept")), "the running suite got the SIGTERM itself and its own cleanup ran (not an immediate SIGKILL)");
  eq(readFileSync(mark("sweeper.swept"), "utf8"), "SIGTERM", "the runner passed on the signal it received");
  ok(!alive(pids.self), "the interrupted suite is gone");
  ok(!alive(pids.escapee), "and so is the detached process it swept on SIGTERM, which a SIGKILL of the group would have leaked");
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
  const r = await signalled(["--only", "stubborn,after", "--timeout-scale", "100"], { ready: mark("stubborn.pid"), signal: "SIGINT", summary });
  eq(r.code, 130, `SIGINT to the runner exits 130 (got ${r.code})`);
  ok(!alive(Number(readFileSync(mark("stubborn.pid"), "utf8"))), "a suite that ignores the signal is SIGKILLed after the grace");
  ok(r.ms >= KILL_GRACE_MS - 100 && r.ms < KILL_GRACE_MS + 6000, `after the grace, not at once and not at its timeout (${r.ms} ms)`);
  ok(/`stubborn` \| ❌ failed \(interrupted by SIGINT\)/.test(readFileSync(summary, "utf8")), "and is recorded as interrupted");
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

console.log(`✓ run: ${checks} assertions — every registered suite attempted after a failure and after a hang, the hang and its children killed at the manifest's timeout, exit 1 on any failure and 0 only when all pass, one summary row per suite appended to the step summary with the last 40 lines of each failure inside a bounded summary, --bail and --only, an empty selection and a test:* script left out of suites.json refused before anything runs, a suite whose output outlives it ended at its timeout, and SIGINT or SIGTERM passed to the running suite with a partial summary written`);
