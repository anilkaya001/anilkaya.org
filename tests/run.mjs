import { spawn } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TIMEOUT_FLOOR_S = 120;
export const TIMEOUT_MEDIAN_FACTOR = 3;
export const KILL_GRACE_MS = 2000;
export const TAIL_LINES = 40;
const TAIL_LINE_CHARS = 400;
const CLASSES = new Set(["N", "C", "W"]);

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, bail: false, only: null, timeoutScale: 1 };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eqAt = raw.indexOf("=");
    const flag = eqAt > 0 ? raw.slice(0, eqAt) : raw;
    const value = () => {
      if (eqAt > 0) return raw.slice(eqAt + 1);
      if (i + 1 >= argv.length) throw new UsageError(`${flag} needs a value`);
      return argv[++i];
    };
    if (flag === "--bail") opts.bail = true;
    else if (flag === "--dir") opts.dir = path.resolve(value());
    else if (flag === "--only") opts.only = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (flag === "--timeout-scale") {
      const n = Number(value());
      if (!Number.isFinite(n) || n <= 0) throw new UsageError("--timeout-scale needs a positive number");
      opts.timeoutScale = n;
    } else throw new UsageError(`unknown argument ${raw}`);
  }
  return opts;
}

export function timeoutFor(suite, scale = 1) {
  const base = Number.isFinite(suite.timeoutS) && suite.timeoutS > 0
    ? suite.timeoutS
    : Math.max(TIMEOUT_FLOOR_S, Math.ceil(TIMEOUT_MEDIAN_FACTOR * (suite.medianS || 0)));
  return base * scale;
}

export function loadManifest(dir = DEFAULT_DIR) {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(path.join(dir, "suites.json"), "utf8"));
  const scripts = pkg.scripts || {};
  const problems = [];
  if (!Array.isArray(manifest.suites) || !manifest.suites.length) problems.push("suites.json has no suites");
  const suites = Array.isArray(manifest.suites) ? manifest.suites : [];
  const seen = new Set();
  for (const s of suites) {
    if (!s || typeof s.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(s.name)) { problems.push(`suites.json: bad suite name ${JSON.stringify(s && s.name)}`); continue; }
    if (seen.has(s.name)) problems.push(`suites.json: ${s.name} is listed twice`);
    seen.add(s.name);
    if (typeof scripts[`test:${s.name}`] !== "string") problems.push(`suites.json: ${s.name} has no test:${s.name} script in package.json`);
    if (s.class !== undefined && !CLASSES.has(s.class)) problems.push(`suites.json: ${s.name} has class ${JSON.stringify(s.class)}, not N, C or W`);
    if (s.medianS !== undefined && s.medianS !== null && !(Number.isFinite(s.medianS) && s.medianS >= 0)) problems.push(`suites.json: ${s.name} has a bad medianS`);
    if (s.timeoutS !== undefined && !(Number.isFinite(s.timeoutS) && s.timeoutS > 0)) problems.push(`suites.json: ${s.name} has a bad timeoutS`);
  }
  for (const key of Object.keys(scripts)) {
    if (key.startsWith("test:") && !seen.has(key.slice(5))) problems.push(`package.json: ${key} is not in suites.json, so the runner would never run it`);
  }
  if (problems.length) throw new UsageError(problems.join("\n"));
  return suites.map((s) => ({ ...s, script: `test:${s.name}`, command: scripts[`test:${s.name}`] }));
}

export function selectSuites(suites, only) {
  if (!only) return suites;
  const names = new Set(suites.map((s) => s.name));
  const unknown = only.filter((n) => !names.has(n));
  if (unknown.length) throw new UsageError(`--only names unknown suites: ${unknown.join(", ")}`);
  const want = new Set(only);
  return suites.filter((s) => want.has(s.name));
}

const COUNT_WORD = /assertions|checks/;
const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;

export function countAssertions(text) {
  let total = 0;
  let found = false;
  for (const m of text.matchAll(/^\s*(?:✓\s*)?[A-Za-z0-9][\w.-]*:\s*([\d,]+)\s+(?:assertions|checks)\b/gm)) {
    total += Number(m[1].replace(/,/g, ""));
    found = true;
  }
  return found ? total : null;
}

function killGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch {}
}

let current = null;

function runSuite(suite, dir, scale, out) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const env = { ...process.env, PATH: [path.join(dir, "node_modules", ".bin"), process.env.PATH || ""].join(path.delimiter) };
    const child = spawn("/bin/sh", ["-c", suite.command], { cwd: dir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    current = child;
    const tail = [];
    let partial = { stdout: "", stderr: "" };
    let assertionText = "";
    const take = (name, chunk) => {
      const text = chunk.toString("utf8");
      (name === "stdout" ? out.stdout : out.stderr).write(text);
      const joined = partial[name] + text;
      const lines = joined.split("\n");
      partial[name] = lines.pop();
      for (const line of lines) {
        const clean = line.replace(ANSI, "");
        if (COUNT_WORD.test(clean)) assertionText += clean + "\n";
        tail.push(clean.length > TAIL_LINE_CHARS ? clean.slice(0, TAIL_LINE_CHARS) + "…" : clean);
        if (tail.length > TAIL_LINES) tail.shift();
      }
    };
    child.stdout.on("data", (c) => take("stdout", c));
    child.stderr.on("data", (c) => take("stderr", c));
    const limitS = timeoutFor(suite, scale);
    let timedOut = false;
    let graceTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, "SIGTERM");
      graceTimer = setTimeout(() => killGroup(child, "SIGKILL"), KILL_GRACE_MS);
    }, limitS * 1000);
    let exit = null;
    child.on("error", (err) => { exit = exit || { code: null, signal: null, error: err.message }; });
    child.on("exit", (code, signal) => {
      exit = { code, signal };
      clearTimeout(timer);
      if (!timedOut) killGroup(child, "SIGKILL");
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (graceTimer) { clearTimeout(graceTimer); killGroup(child, "SIGKILL"); }
      current = null;
      for (const name of ["stdout", "stderr"]) {
        if (partial[name]) {
          const clean = partial[name].replace(ANSI, "");
          if (COUNT_WORD.test(clean)) assertionText += clean + "\n";
          tail.push(clean);
          if (tail.length > TAIL_LINES) tail.shift();
        }
      }
      const e = exit || { code, signal };
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const status = timedOut ? "timeout" : e.code === 0 ? "pass" : "fail";
      resolve({
        name: suite.name,
        status,
        code: e.code,
        signal: e.signal,
        error: e.error || null,
        seconds,
        limitS,
        assertions: countAssertions(assertionText),
        tail: status === "pass" ? [] : tail.slice(),
      });
    });
  });
}

function fmtSeconds(s) {
  return s == null ? "" : s.toFixed(1);
}

function resultWord(r) {
  if (r.status === "pass") return "passed";
  if (r.status === "timeout") return `timed out at ${r.limitS} s`;
  if (r.status === "skipped") return "not run";
  if (r.error) return `failed (${r.error})`;
  return r.signal ? `failed (${r.signal})` : `failed (exit ${r.code})`;
}

export function tally(results) {
  const t = { total: results.length, pass: 0, fail: 0, timeout: 0, skipped: 0, assertions: 0 };
  for (const r of results) {
    t[r.status]++;
    if (r.assertions) t.assertions += r.assertions;
  }
  return t;
}

export function textTable(results, wallS) {
  const rows = results.map((r, i) => [String(i + 1), r.name, resultWord(r), fmtSeconds(r.seconds), r.assertions == null ? "" : String(r.assertions)]);
  const head = ["#", "suite", "result", "seconds", "assertions"];
  const widths = head.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
  const line = (cells) => cells.map((v, c) => (c === 0 || c >= 3 ? v.padStart(widths[c]) : v.padEnd(widths[c]))).join("  ").trimEnd();
  const t = tally(results);
  return [
    line(head),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
    "",
    `${t.total} suites: ${t.pass} passed, ${t.fail} failed, ${t.timeout} timed out, ${t.skipped} not run; ${t.assertions} assertions; ${fmtSeconds(wallS)} s`,
  ].join("\n");
}

function fence(lines) {
  const text = lines.join("\n");
  let n = 3;
  for (const m of text.matchAll(/`+/g)) n = Math.max(n, m[0].length + 1);
  const f = "`".repeat(n);
  return `${f}text\n${text}\n${f}`;
}

export function markdownSummary(results, wallS) {
  const t = tally(results);
  const icon = { pass: "✅", fail: "❌", timeout: "⏱️", skipped: "⏭️" };
  const out = [
    `### Regression suites: ${t.fail + t.timeout ? `${t.fail + t.timeout} of ${t.total} failed` : `all ${t.pass} passed`}`,
    "",
    `${t.pass} passed, ${t.fail} failed, ${t.timeout} timed out, ${t.skipped} not run; ${t.assertions} assertions; ${fmtSeconds(wallS)} s.`,
    "",
    "| # | Suite | Result | Seconds | Assertions |",
    "|---:|---|---|---:|---:|",
    ...results.map((r, i) => `| ${i + 1} | \`${r.name}\` | ${icon[r.status]} ${resultWord(r)} | ${fmtSeconds(r.seconds)} | ${r.assertions == null ? "" : r.assertions} |`),
  ];
  for (const r of results) {
    if (r.status !== "fail" && r.status !== "timeout") continue;
    out.push("", `<details><summary><code>${r.name}</code>: ${resultWord(r)}, last ${r.tail.length} lines</summary>`, "", fence(r.tail), "", "</details>");
  }
  return out.join("\n") + "\n";
}

export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr }, env = process.env) {
  let opts;
  let suites;
  try {
    opts = parseArgs(argv);
    suites = selectSuites(loadManifest(opts.dir), opts.only);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr.write(`run.mjs: ${err.message}\n`);
    return 2;
  }
  const started = process.hrtime.bigint();
  const results = [];
  let stop = false;
  for (const suite of suites) {
    if (stop) {
      results.push({ name: suite.name, status: "skipped", seconds: null, assertions: null, tail: [] });
      continue;
    }
    io.stdout.write(`\n> ${suite.script}\n> ${suite.command}\n\n`);
    const r = await runSuite(suite, opts.dir, opts.timeoutScale, io);
    results.push(r);
    if (r.status !== "pass") {
      io.stderr.write(`\n✗ ${suite.script} ${resultWord(r)} after ${fmtSeconds(r.seconds)} s\n`);
      if (opts.bail) stop = true;
    }
  }
  const wallS = Number(process.hrtime.bigint() - started) / 1e9;
  io.stdout.write(`\n${textTable(results, wallS)}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(env.GITHUB_STEP_SUMMARY, markdownSummary(results, wallS)); }
    catch (err) { io.stderr.write(`run.mjs: could not write the step summary: ${err.message}\n`); }
  }
  const t = tally(results);
  return t.fail + t.timeout > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (current) killGroup(current, "SIGKILL");
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`run.mjs: ${err && err.stack || err}\n`);
    process.exitCode = 2;
  });
}
