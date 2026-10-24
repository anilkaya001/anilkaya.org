import { spawn } from "node:child_process";
import { readFileSync, appendFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readQuarantine, recordedFor, todayUtc } from "./lib/quarantine.mjs";
import { SUITES_DIR, FIELD_ORDER, formatSuite, walkImports, entriesOf, LAUNCHER, ROOT as REPO_ROOT } from "./lib/suite-registry.mjs";
import { changedFiles, selectAffected, describeSelection, rootOf } from "./lib/affected.mjs";
export { SUITES_DIR, formatSuite };

export const DEFAULT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TIMEOUT_FLOOR_S = 300;
export const TIMEOUT_MEDIAN_FACTOR = 3;
export const SLOW_FACTOR = 2;
export const SLOW_MARGIN_S = 30;
export const KILL_GRACE_MS = 2000;
export const REPEAT_WINDOW_MS = 500;
export const MAX_TIMER_MS = 2 ** 31 - 1;
export const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
export const TAIL_LINES = 40;
export const TAIL_LINE_CHARS = 400;
export const SUMMARY_TAIL_BUDGET = 512 * 1024;
export const CHROMIUM_SETUP_S = 24;
export const MAX_SHARDS = 32;
export const CI_SHARDS = 12;
export const SHARD_BALANCE = 1.3;
const CLASSES = new Set(["N", "C", "W"]);
const GROUPS = new Set(["fast", "shard"]);

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, bail: false, only: null, timeoutScale: 1, shard: null, group: null, needsBrowser: false, repin: false, affected: null, affectedList: false };
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
    } else if (flag === "--shard") {
      const v = value();
      const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(v);
      if (!m || Number(m[1]) > Number(m[2]) || Number(m[2]) > MAX_SHARDS) throw new UsageError(`--shard needs i/n with 1 <= i <= n <= ${MAX_SHARDS}, not ${JSON.stringify(v)}`);
      opts.shard = { index: Number(m[1]), count: Number(m[2]) };
    } else if (flag === "--group") {
      const v = value();
      if (!GROUPS.has(v)) throw new UsageError(`--group is fast or shard, not ${JSON.stringify(v)}`);
      opts.group = v;
    } else if (flag === "--needs-browser") opts.needsBrowser = true;
    else if (flag === "--repin") opts.repin = true;
    else if (flag === "--affected") {
      const v = value();
      if (!v || v.startsWith("-")) throw new UsageError(`--affected needs a base ref, not ${JSON.stringify(v)}`);
      opts.affected = v;
    } else if (flag === "--affected-list") opts.affectedList = true;
    else throw new UsageError(`unknown argument ${raw}`);
  }
  if (opts.affectedList && !opts.affected) throw new UsageError("--affected-list needs --affected <base-ref>");
  if (opts.affected && (opts.only || opts.repin)) throw new UsageError("--affected selects suites itself, so it takes no --only and no --repin");
  if (opts.repin && (opts.only || opts.shard || opts.group || opts.needsBrowser)) throw new UsageError("--repin rewrites the pins and takes no other selection");
  if (opts.only && (opts.shard || opts.group)) throw new UsageError("--only names its suites itself, so it takes no --shard or --group");
  if (opts.shard && opts.group === "fast") throw new UsageError("--shard splits the shard group, so it cannot run with --group fast");
  return opts;
}

export function timeoutFor(suite, scale = 1) {
  const base = Number.isFinite(suite.timeoutS) && suite.timeoutS > 0
    ? suite.timeoutS
    : Math.max(TIMEOUT_FLOOR_S, Math.ceil(TIMEOUT_MEDIAN_FACTOR * (suite.medianS || 0)));
  return base * scale;
}

export function overMedian(suite, seconds) {
  const median = suite.medianS;
  return Number.isFinite(median) && median > 0 && Number.isFinite(seconds) && seconds > SLOW_FACTOR * median && seconds > median + SLOW_MARGIN_S;
}

export function timerDelayMs(limitS) {
  return Math.min(Math.max(0, limitS * 1000), MAX_TIMER_MS);
}

export function exitCodeFor(signal) {
  const n = constants.signals[signal];
  return Number.isInteger(n) ? 128 + n : 1;
}

export function readSuiteFiles(dir = DEFAULT_DIR) {
  const root = path.join(dir, SUITES_DIR);
  let names;
  try { names = readdirSync(root).filter((n) => n.endsWith(".json")).sort(); } catch { names = []; }
  const entries = [];
  const problems = [];
  for (const file of names) {
    let entry;
    try { entry = JSON.parse(readFileSync(path.join(root, file), "utf8")); } catch (err) { problems.push(`${SUITES_DIR}/${file}: not valid JSON (${err.message})`); continue; }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) { problems.push(`${SUITES_DIR}/${file}: not a suite object`); continue; }
    if (entry.name !== file.slice(0, -5)) { problems.push(`${SUITES_DIR}/${file}: holds suite ${JSON.stringify(entry.name)}, and a file is named for the one suite it registers`); continue; }
    entries.push({ file, entry });
  }
  return { entries, problems };
}

export function loadManifest(dir = DEFAULT_DIR) {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const scripts = pkg.scripts || {};
  const { entries, problems } = readSuiteFiles(dir);
  if (!entries.length && !problems.length) problems.push(`${SUITES_DIR}/ has no suites`);
  const suites = [];
  const seen = new Set();
  const rank = (s) => (s.group === "fast" ? 0 : 1);
  entries.sort((a, b) => rank(a.entry) - rank(b.entry) || (a.entry.name < b.entry.name ? -1 : a.entry.name > b.entry.name ? 1 : 0));
  for (const { entry: s } of entries) {
    if (typeof s.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(s.name)) { problems.push(`${SUITES_DIR}: bad suite name ${JSON.stringify(s.name)}`); continue; }
    seen.add(s.name);
    const hasScript = typeof scripts[`test:${s.name}`] === "string";
    const hasCommand = typeof s.command === "string" && s.command.trim() !== "";
    if (s.command !== undefined && !hasCommand) problems.push(`${SUITES_DIR}: ${s.name} has an empty command`);
    if (hasScript && s.command !== undefined) problems.push(`${SUITES_DIR}: ${s.name} has both a command and a test:${s.name} script in package.json, so it has two commands`);
    if (!hasScript && !hasCommand) problems.push(`${SUITES_DIR}: ${s.name} has neither a command nor a test:${s.name} script in package.json`);
    if (s.group !== undefined && !GROUPS.has(s.group)) problems.push(`${SUITES_DIR}: ${s.name} has group ${JSON.stringify(s.group)}, not fast or shard`);
    if (s.class !== undefined && !CLASSES.has(s.class)) problems.push(`${SUITES_DIR}: ${s.name} has class ${JSON.stringify(s.class)}, not N, C or W`);
    if (s.medianS !== undefined && s.medianS !== null && !(Number.isFinite(s.medianS) && s.medianS >= 0)) problems.push(`${SUITES_DIR}: ${s.name} has a bad medianS`);
    if (s.timeoutS !== undefined && !(Number.isFinite(s.timeoutS) && s.timeoutS > 0)) problems.push(`${SUITES_DIR}: ${s.name} has a bad timeoutS`);
    if (s.shard !== undefined && !(Number.isInteger(s.shard) && s.shard >= 1 && s.shard <= CI_SHARDS)) problems.push(`${SUITES_DIR}: ${s.name} pins shard ${JSON.stringify(s.shard)}, not an integer from 1 to ${CI_SHARDS}`);
    if (s.timing !== undefined && typeof s.timing !== "boolean") problems.push(`${SUITES_DIR}: ${s.name} has a timing flag that is not true or false`);
    if (s.timing === true && s.class !== "N") problems.push(`${SUITES_DIR}: ${s.name} is tagged timing but is class ${JSON.stringify(s.class)}; only Node suites are retried, never one that drives Chromium or workerd`);
    if (s.files !== undefined && !(Array.isArray(s.files) && s.files.length && s.files.every((f) => typeof f === "string" && f))) problems.push(`${SUITES_DIR}: ${s.name} has a bad files list`);
    if (s.covers !== undefined && !(Array.isArray(s.covers) && s.covers.every((c) => typeof c === "string" && c))) problems.push(`${SUITES_DIR}: ${s.name} has a bad covers list`);
    suites.push({ ...s, script: `test:${s.name}`, command: hasScript ? scripts[`test:${s.name}`] : s.command });
  }
  for (const key of Object.keys(scripts)) {
    if (key.startsWith("test:") && !seen.has(key.slice(5))) problems.push(`package.json: ${key} is not in ${SUITES_DIR}/, so the runner would never run it`);
  }
  if (problems.length) throw new UsageError(problems.join("\n"));
  return suites;
}

export function selectSuites(suites, only) {
  if (!only) return suites;
  if (!only.length) throw new UsageError("--only names no suite, and a run of no suite proves nothing");
  const names = new Set(suites.map((s) => s.name));
  const unknown = only.filter((n) => !names.has(n));
  if (unknown.length) throw new UsageError(`--only names unknown suites: ${unknown.join(", ")}`);
  const want = new Set(only);
  return suites.filter((s) => want.has(s.name));
}

export const groupOf = (suite) => suite.group || "shard";

export const retryAllowed = (suite, env = process.env) => env.CI === "true" && suite.timing === true && suite.class === "N";

const launchesBrowser = (s) => Array.isArray(s.files) && walkImports(REPO_ROOT, entriesOf(s.files)).files.has(LAUNCHER);

export const needsBrowser = (suites) => suites.some((s) => s.class !== "N" || launchesBrowser(s));

const suiteCost = (s) => s.medianS || 0;

export function packShards(suites, count, honourPins = count === CI_SHARDS) {
  const bins = Array.from({ length: count }, () => ({ load: 0, browser: false, names: new Set() }));
  const place = (s, b) => {
    b.load += suiteCost(s) + (!b.browser && s.class !== "N" ? CHROMIUM_SETUP_S : 0);
    b.browser = b.browser || s.class !== "N";
    b.names.add(s.name);
  };
  const isPinned = (s) => honourPins && groupOf(s) === "shard" && Number.isInteger(s.shard) && s.shard >= 1 && s.shard <= count;
  const free = [];
  suites.forEach((s, i) => {
    if (!isPinned(s)) free.push({ s, i, w: suiteCost(s) });
  });
  for (const s of suites.filter(isPinned)) place(s, bins[s.shard - 1]);
  free.sort((a, b) => b.w - a.w || a.i - b.i);
  for (const { s, w } of free) {
    const cost = (b) => b.load + w + (!b.browser && s.class !== "N" ? CHROMIUM_SETUP_S : 0);
    let best = 0;
    for (let k = 1; k < count; k++) if (cost(bins[k]) < cost(bins[best])) best = k;
    place(s, bins[best]);
  }
  return bins.map((b) => suites.filter((s) => b.names.has(s.name) && groupOf(s) === "shard"));
}

export function shardLoad(shard) {
  return shard.reduce((t, s) => t + suiteCost(s), 0) + (shard.some((s) => s.class !== "N") ? CHROMIUM_SETUP_S : 0);
}

export function shardBalance(shards, tolerance = SHARD_BALANCE) {
  const loads = shards.map(shardLoad);
  const heaviest = Math.max(...loads);
  const lightest = Math.min(...loads);
  return { loads, heaviest, lightest, ratio: lightest > 0 ? heaviest / lightest : Infinity, tolerance, within: heaviest <= lightest * tolerance };
}

export function repin(dir = DEFAULT_DIR) {
  const { entries, problems } = readSuiteFiles(dir);
  if (problems.length) throw new UsageError(problems.join("\n"));
  const suites = entries.map((e) => e.entry);
  const bins = packShards(suites, CI_SHARDS, false);
  const changed = [];
  bins.forEach((sh, i) => {
    for (const s of sh) {
      if (s.shard === i + 1) continue;
      writeFileSync(path.join(dir, SUITES_DIR, `${s.name}.json`), formatSuite({ ...s, shard: i + 1 }));
      changed.push(s.name);
    }
  });
  for (const e of entries) {
    if (groupOf(e.entry) !== "shard" && e.entry.shard !== undefined) {
      const { shard, ...rest } = e.entry;
      writeFileSync(path.join(dir, SUITES_DIR, e.file), formatSuite(rest));
      changed.push(e.entry.name);
    }
  }
  return changed;
}

export function chooseSuites(suites, opts, affected = null) {
  if (opts.only) return selectSuites(suites, opts.only);
  if (!opts.shard && !opts.group) return affected ? suites.filter((s) => affected.has(s.name)) : suites;
  const chosen = opts.shard
    ? packShards(suites, opts.shard.count)[opts.shard.index - 1]
    : suites.filter((s) => groupOf(s) === opts.group);
  if (affected) return chosen.filter((s) => affected.has(s.name));
  if (!chosen.length) throw new UsageError(`${opts.shard ? `shard ${opts.shard.index}/${opts.shard.count}` : `group ${opts.group}`} holds no suite, and a run of no suite proves nothing`);
  return chosen;
}

export function runLabel(opts) {
  if (opts.shard) return `shard ${opts.shard.index}/${opts.shard.count}`;
  return opts.group || null;
}

const COUNT_LINE = /^\s*(?:✓\s*)?[A-Za-z0-9][\w.-]*:\s*([\d,]+)\s+(?:assertions|checks)\b/gm;
const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;

export function countAssertions(text) {
  let total = 0;
  let found = false;
  for (const m of text.matchAll(COUNT_LINE)) {
    total += Number(m[1].replace(/,/g, ""));
    found = true;
  }
  return found ? total : null;
}

export function capLine(line) {
  return line.length > TAIL_LINE_CHARS ? line.slice(0, TAIL_LINE_CHARS) + "…" : line;
}

export function tailCollector() {
  const tail = [];
  const partial = { stdout: "", stderr: "" };
  let assertions = null;
  const keep = (line) => {
    const clean = capLine(line.replace(ANSI, ""));
    const n = countAssertions(clean);
    if (n != null) assertions = (assertions || 0) + n;
    tail.push(clean);
    if (tail.length > TAIL_LINES) tail.shift();
  };
  return {
    take(name, text) {
      const lines = (partial[name] + text).split("\n");
      partial[name] = lines.pop().slice(0, TAIL_LINE_CHARS + 1);
      for (const line of lines) keep(line);
    },
    note: keep,
    end() {
      for (const name of ["stdout", "stderr"]) if (partial[name]) keep(partial[name]);
      partial.stdout = partial.stderr = "";
    },
    pending: () => partial.stdout.length + partial.stderr.length,
    get tail() { return tail.slice(); },
    get assertions() { return assertions; },
  };
}

function killGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch {}
}

let current = null;
let interruptedBy = null;
let interruptedAt = 0;

export function interrupt(signal, now = Date.now()) {
  if (!interruptedBy) {
    interruptedBy = signal;
    interruptedAt = now;
    if (current) current.stop(signal, "interrupt");
    return "forward";
  }
  if (now - interruptedAt < REPEAT_WINDOW_MS) return "repeat";
  if (current) current.stop("SIGKILL", "interrupt");
  return "kill";
}

function runSuite(suite, dir, scale, out, extraEnv = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const env = { ...process.env, ...extraEnv, PATH: [path.join(dir, "node_modules", ".bin"), process.env.PATH || ""].join(path.delimiter) };
    const child = spawn("/bin/sh", ["-c", suite.command], { cwd: dir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const lines = tailCollector();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const take = (name, text) => {
      (name === "stdout" ? out.stdout : out.stderr).write(text);
      lines.take(name, text);
    };
    child.stdout.on("data", (c) => take("stdout", c));
    child.stderr.on("data", (c) => take("stderr", c));
    const limitS = timeoutFor(suite, scale);
    let stopping = null;
    let timedOut = false;
    let held = false;
    let exit = null;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const cutStreams = () => {
      if (exit) held = true;
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const stop = (signal, why) => {
      if (why === "interrupt" || !stopping) stopping = why;
      if (exit) { cutStreams(); return; }
      killGroup(child, signal);
      if (signal === "SIGKILL") { later(cutStreams, KILL_GRACE_MS); return; }
      later(() => {
        killGroup(child, "SIGKILL");
        later(cutStreams, KILL_GRACE_MS);
      }, KILL_GRACE_MS);
    };
    current = { stop };
    later(() => {
      if (stopping) return;
      timedOut = true;
      stop("SIGTERM", "timeout");
    }, timerDelayMs(limitS));
    child.on("error", (err) => { exit = exit || { code: null, signal: null, error: err.message }; });
    child.on("exit", (code, signal) => {
      exit = { code, signal };
      if (!stopping) killGroup(child, "SIGKILL");
    });
    child.on("close", (code, signal) => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      killGroup(child, "SIGKILL");
      current = null;
      lines.end();
      const e = exit || { code, signal };
      if (held) lines.note(`run.mjs: the suite had exited (${e.signal || `exit ${e.code}`}) but a process outside its group still held its output open, so the output was cut`);
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const interrupted = stopping === "interrupt" ? interruptedBy : null;
      const status = interrupted ? "fail" : timedOut ? "timeout" : e.code === 0 ? "pass" : "fail";
      resolve({
        name: suite.name,
        status,
        code: e.code,
        signal: e.signal,
        error: interrupted ? `interrupted by ${interrupted}` : e.error || null,
        seconds,
        limitS,
        assertions: lines.assertions,
        tail: status === "pass" ? [] : lines.tail,
      });
    });
    if (interruptedBy) stop(interruptedBy, "interrupt");
  });
}

function fmtSeconds(s) {
  return s == null ? "" : s.toFixed(1);
}

function resultWord(r) {
  if (r.status === "pass" && r.flaky) return "passed on retry (FLAKY)";
  if (r.status === "pass") return "passed";
  if (r.status === "timeout") return `timed out at ${r.limitS} s`;
  if (r.status === "skipped") return "not run";
  const twice = r.retried ? ", twice" : "";
  if (r.error) return `failed (${r.error}${twice})`;
  return r.signal ? `failed (${r.signal}${twice})` : `failed (exit ${r.code}${twice})`;
}

export function tally(results) {
  const t = { total: results.length, pass: 0, fail: 0, timeout: 0, skipped: 0, flaky: 0, assertions: 0 };
  for (const r of results) {
    t[r.status]++;
    if (r.flaky) t.flaky++;
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
    `${t.total} suites: ${t.pass} passed${t.flaky ? ` (${t.flaky} FLAKY)` : ""}, ${t.fail} failed, ${t.timeout} timed out, ${t.skipped} not run; ${t.assertions} assertions; ${fmtSeconds(wallS)} s`,
  ].join("\n");
}

function fence(lines) {
  const text = lines.join("\n");
  let n = 3;
  for (const m of text.matchAll(/`+/g)) n = Math.max(n, m[0].length + 1);
  const f = "`".repeat(n);
  return `${f}text\n${text}\n${f}`;
}

function budgetTail(lines, budget) {
  const kept = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const size = Buffer.byteLength(lines[i], "utf8") + 1;
    if (bytes + size > budget) break;
    kept.unshift(lines[i]);
    bytes += size;
  }
  return kept;
}

export function markdownSummary(results, wallS, { interrupted = null, label = null } = {}) {
  const t = tally(results);
  const icon = { pass: "✅", fail: "❌", timeout: "⏱️", skipped: "⏭️" };
  const mark = (r) => (r.status === "pass" && r.flaky ? "⚠️" : icon[r.status]);
  const out = [
    `### Regression suites${label ? `, ${label}` : ""}: ${t.fail + t.timeout ? `${t.fail + t.timeout} of ${t.total} failed` : `all ${t.pass} passed${t.flaky ? `, ${t.flaky} of them FLAKY` : ""}`}${interrupted ? ` (run interrupted by ${interrupted})` : ""}`,
    "",
    `${t.pass} passed${t.flaky ? ` (${t.flaky} FLAKY)` : ""}, ${t.fail} failed, ${t.timeout} timed out, ${t.skipped} not run; ${t.assertions} assertions; ${fmtSeconds(wallS)} s.`,
    "",
    "| # | Suite | Result | Seconds | Assertions |",
    "|---:|---|---|---:|---:|",
    ...results.map((r, i) => `| ${i + 1} | \`${r.name}\` | ${mark(r)} ${resultWord(r)} | ${fmtSeconds(r.seconds)} | ${r.assertions == null ? "" : r.assertions} |`),
  ];
  const failed = results.filter((r) => r.status === "fail" || r.status === "timeout");
  const flaky = results.filter((r) => r.flaky);
  const share = failed.length + flaky.length ? Math.floor(SUMMARY_TAIL_BUDGET / (failed.length + flaky.length)) : 0;
  for (const r of flaky) {
    const lines = budgetTail(r.flaky.first.tail.map(capLine), share);
    const status = r.flaky.recorded
      ? `recorded in tests/quarantine.json until ${r.flaky.recorded}`
      : "NOT RECORDED: add a tests/quarantine.json entry (suite, assertion, firstSeen, expires within 7 days, issue) or fix the test";
    out.push("", `<details><summary><code>${r.name}</code>: FLAKY, failed once and passed on retry; ${status}; first attempt, last ${lines.length} lines</summary>`, "", fence(lines), "", "</details>");
  }
  for (const r of failed) {
    const lines = budgetTail(r.tail.map(capLine), share);
    const cut = lines.length < r.tail.length ? ` (${r.tail.length - lines.length} earlier lines left out to keep the summary small)` : "";
    out.push("", `<details><summary><code>${r.name}</code>: ${resultWord(r)}, last ${lines.length} lines${cut}</summary>`, "", fence(lines), "", "</details>");
  }
  return out.join("\n") + "\n";
}

export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr }, env = process.env) {
  let opts;
  let suites;
  let quarantine = [];
  try {
    opts = parseArgs(argv);
    if (opts.repin) {
      const changed = repin(opts.dir);
      io.stdout.write(changed.length ? `repinned ${changed.length} suites to the ${CI_SHARDS}-shard packing: ${changed.join(", ")}\n` : `every pin already equals the ${CI_SHARDS}-shard packing\n`);
      return 0;
    }
    const all = loadManifest(opts.dir);
    let affected = null;
    if (opts.affected) {
      const sel = selectAffected({ root: rootOf(opts.dir), suites: all, changed: changedFiles(rootOf(opts.dir), opts.affected) });
      if (opts.affectedList) {
        io.stdout.write(describeSelection(sel, all).join("\n") + "\n");
        return 0;
      }
      (opts.needsBrowser ? io.stderr : io.stdout).write(`run.mjs: ${describeSelection(sel, all)[0]}\n`);
      affected = sel.full ? null : sel.names;
    }
    suites = chooseSuites(all, opts, affected);
    const q = readQuarantine(opts.dir);
    if (q.problems.length) throw new UsageError(q.problems.join("\n"));
    quarantine = q.entries;
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr.write(`run.mjs: ${err.message}\n`);
    return 2;
  }
  if (opts.needsBrowser) {
    io.stdout.write(`${needsBrowser(suites)}\n`);
    return 0;
  }
  const started = process.hrtime.bigint();
  const results = [];
  let stop = false;
  const emitDir = env.FLOWS_EMIT_DIR || path.join(tmpdir(), `flows-emit-run-${process.pid}-${Date.now()}`);
  const ownsEmit = !env.FLOWS_EMIT_DIR;
  try {
    for (const suite of suites) {
      if (stop || interruptedBy) {
        results.push({ name: suite.name, status: "skipped", seconds: null, assertions: null, tail: [] });
        continue;
      }
      io.stdout.write(`\n> ${suite.script}\n> ${suite.command}\n\n`);
      let r = await runSuite(suite, opts.dir, opts.timeoutScale, io, { FLOWS_EMIT_DIR: emitDir });
      if (r.status === "fail" && !interruptedBy && retryAllowed(suite, env)) {
        io.stderr.write(`\n↻ ${suite.script} failed after ${fmtSeconds(r.seconds)} s; it is tagged timing, so it runs once more (a second failure is a failure)\n`);
        io.stdout.write(`\n> ${suite.script} (retry)\n> ${suite.command}\n\n`);
        const first = r;
        r = await runSuite(suite, opts.dir, opts.timeoutScale, io, { FLOWS_EMIT_DIR: emitDir });
        if (r.status === "pass") {
          const hit = recordedFor(quarantine, suite.name, todayUtc());
          r = { ...r, flaky: { first: { seconds: first.seconds, code: first.code, signal: first.signal, tail: first.tail, assertions: first.assertions }, recorded: hit ? hit.expires : null } };
          io.stderr.write(`\n⚠ FLAKY ${suite.script}: failed once, passed on retry; ${hit ? `recorded in tests/quarantine.json until ${hit.expires}` : "NOT RECORDED in tests/quarantine.json (suite, assertion, firstSeen, expires within 7 days, issue)"}\n`);
          if (env.GITHUB_ACTIONS) io.stdout.write(`::warning title=FLAKY ${suite.name}::${suite.script} failed once and passed on retry; ${hit ? `recorded until ${hit.expires}` : "add a tests/quarantine.json entry or fix the test"}\n`);
        } else {
          r = { ...r, retried: true };
        }
      }
      results.push(r);
      if (r.status === "pass" && overMedian(suite, r.seconds)) {
        io.stderr.write(`\n⏱ ${suite.script} took ${fmtSeconds(r.seconds)} s against a medianS of ${suite.medianS}; refresh tests/suites/${suite.name}.json before the ${TIMEOUT_MEDIAN_FACTOR}x timeout catches it\n`);
        if (env.GITHUB_ACTIONS) io.stdout.write(`::warning title=SLOW ${suite.name}::${suite.script} took ${fmtSeconds(r.seconds)} s against a medianS of ${suite.medianS}; refresh tests/suites/${suite.name}.json\n`);
      }
      if (r.status !== "pass") {
        io.stderr.write(`\n✗ ${suite.script} ${resultWord(r)} after ${fmtSeconds(r.seconds)} s\n`);
        if (opts.bail) stop = true;
      }
    }
  } finally {
    if (ownsEmit) {
      try { rmSync(emitDir, { recursive: true, force: true }); } catch {}
    }
  }
  const wallS = Number(process.hrtime.bigint() - started) / 1e9;
  io.stdout.write(`\n${textTable(results, wallS)}\n`);
  if (interruptedBy) io.stderr.write(`run.mjs: interrupted by ${interruptedBy}; the suites after it were not run\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(env.GITHUB_STEP_SUMMARY, markdownSummary(results, wallS, { interrupted: interruptedBy, label: runLabel(opts) })); }
    catch (err) { io.stderr.write(`run.mjs: could not write the step summary: ${err.message}\n`); }
  }
  if (interruptedBy) return exitCodeFor(interruptedBy);
  const t = tally(results);
  return t.fail + t.timeout > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  for (const stream of [process.stdout, process.stderr]) stream.on("error", () => {});
  for (const sig of FORWARDED_SIGNALS) {
    process.on(sig, () => {
      const what = interrupt(sig);
      if (what === "forward") process.stderr.write(`\nrun.mjs: ${sig} received; passing it to the running suite, SIGKILL in ${KILL_GRACE_MS} ms if it has not closed (a signal more than ${REPEAT_WINDOW_MS} ms later kills it now)\n`);
      else if (what === "kill") process.stderr.write(`\nrun.mjs: ${sig} received again; killing the running suite now\n`);
    });
  }
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`run.mjs: ${err && err.stack || err}\n`);
    process.exitCode = 2;
  });
}
