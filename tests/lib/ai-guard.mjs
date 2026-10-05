import { closure, treeFiles, moduleSource, count, parseImports } from "./source-scan.mjs";

export const AI_HOME = "shared/flows-ai.js";

export function modelCallFiles() {
  return [...new Set([...closure("worker.js"), ...treeFiles("shared"), ...treeFiles("server")])].sort();
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

export function bindingReads(files = modelCallFiles(), read = moduleSource) {
  const reads = [];
  const tests = [];
  for (const file of files) {
    const text = read(file);
    const seen = [];
    const take = (list, m) => {
      seen.push([m.index, m.index + m[0].length]);
      list.push({ file, line: lineOf(text, m.index), text: m[0].trim() });
    };
    for (const m of text.matchAll(/(!\s*|Boolean\(\s*(?:[\w$]+\s*&&\s*)?)?[\w$\])]+\s*(?:\?\.|\.)\s*AI\b(\s*(?:\?\.|\.|\(|\[))?/g)) {
      take(m[1] && !m[2] ? tests : reads, m);
    }
    for (const m of text.matchAll(/\[\s*["'`]AI["'`]\s*\]|\{[^{}]*\bAI\b[^{}]*\}\s*=(?!=)/g)) take(reads, m);
    for (const m of text.matchAll(/(["'`])AI\1|(?<![\w$])AI(?![\w$])/g)) {
      if (m[1] || seen.some(([from, to]) => m.index >= from && m.index < to)) continue;
      const end = text.indexOf("\n", m.index);
      const from = text.lastIndexOf("\n", m.index) + 1;
      reads.push({ file, line: lineOf(text, m.index), text: text.slice(from, end < 0 ? text.length : end).trim() });
    }
  }
  return { reads, tests };
}

export function callArgs(text, open) {
  if (text[open] !== "(") throw new Error("ai-guard: callArgs needs the index of an opening parenthesis");
  const args = [];
  let depth = 0;
  let quote = null;
  let from = open + 1;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        const last = text.slice(from, i).trim();
        if (last || args.length) args.push(last);
        return { args, end: i + 1 };
      }
    } else if (ch === "," && depth === 1) {
      args.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  return { args: null, end: text.length };
}

const callsOf = (file, text, pattern) => [...text.matchAll(pattern)].map((m) => {
  const open = m.index + m[0].length - 1;
  return { file, line: lineOf(text, m.index), args: callArgs(text, open).args };
});

export function modelCallReport(files = modelCallFiles(), read = moduleSource) {
  const { reads, tests } = bindingReads(files, read);
  const runs = files.map((file) => ({ file, n: count(read(file), /\bai\.run\(/) })).filter((r) => r.n > 0);
  const askSites = [];
  const metered = [];
  const cappedDeps = [];
  const importErrors = [];
  for (const file of files) {
    const text = read(file);
    try { parseImports(text, file); } catch (error) { importErrors.push(error.message); }
    for (const c of callsOf(file, text, /(?<!function\s+)\baskModels\(/g)) {
      const first = c.args && c.args.length ? c.args[0] : null;
      askSites.push({ file, line: c.line, arg: first });
    }
    for (const c of callsOf(file, text, /\bconst meteredAi = \(env\) => cappedAi\(/g)) metered.push(c);
    for (const c of callsOf(file, text, /\bai: \(\) => cappedAi\(/g)) cappedDeps.push(c);
  }
  return { files: files.length, reads, tests, runs, askSites, metered, cappedDeps, importErrors };
}

const NO_READER = /^\(*\s*(?:null|undefined|void\b[\s\S]*|false|true|0|NaN|""|''|``|\(\s*\))\s*\)*$/;

export const spendReaderArg = (arg) => typeof arg === "string" && arg.length > 0 && !NO_READER.test(arg);

const twoArgs = (args) => Array.isArray(args) && args.length === 2 && Boolean(args[0]) && spendReaderArg(args[1]);

export function checkModelCalls(report = modelCallReport()) {
  const problems = [];
  for (const e of report.importErrors || []) problems.push(e);
  const home = report.reads.filter((r) => r.file === AI_HOME);
  const away = report.reads.filter((r) => r.file !== AI_HOME);
  if (home.length !== 1) problems.push(`${AI_HOME} must read the binding into a value exactly once (found ${home.length})`);
  for (const r of away) problems.push(`${r.file}:${r.line} reads the AI binding outside ${AI_HOME}: ${r.text}`);
  const homeRuns = report.runs.find((r) => r.file === AI_HOME);
  if (!homeRuns || homeRuns.n < 2) problems.push(`${AI_HOME} must hold both ai.run( sites, cappedAi's and askModels' (found ${homeRuns ? homeRuns.n : 0})`);
  for (const r of report.runs) if (r.file !== AI_HOME) problems.push(`${r.file} runs ai.run( outside ${AI_HOME}`);
  if (report.askSites.length < 1) problems.push("no askModels( call site was found, so the scan reads the wrong tree");
  if (report.metered.length !== 1) problems.push(`const meteredAi = (env) => cappedAi( must appear exactly once (found ${report.metered.length})`);
  for (const m of report.metered) if (!twoArgs(m.args)) problems.push(`${m.file}:${m.line} builds meteredAi with cappedAi(${(m.args || []).join(", ")}), not with env and a spend reader`);
  for (const d of report.cappedDeps) if (!twoArgs(d.args)) problems.push(`${d.file}:${d.line} builds deps.ai with cappedAi(${(d.args || []).join(", ")}), not with env and a spend reader`);
  for (const s of report.askSites) {
    const arg = s.arg || "";
    let ok = false;
    if (arg === "meteredAi(env)") ok = report.metered.length === 1;
    else if (arg === "deps.ai()") ok = report.cappedDeps.length >= 1;
    else if (/^cappedAi\(/.test(arg)) {
      const inner = callArgs(arg, "cappedAi".length);
      ok = inner.end === arg.length && twoArgs(inner.args);
    }
    if (!ok) problems.push(`${s.file}:${s.line} hands askModels an unmetered binding: ${arg || "(nothing)"}`);
  }
  if (report.askSites.some((s) => s.arg === "deps.ai()") && report.cappedDeps.length < 1) problems.push("a deps.ai() binding exists but no ai: () => cappedAi( builds it");
  return problems;
}

const violations = [];
let allowed = 0;
let homeSpan = null;

const callerFrame = (stack) => stack.split("\n").slice(2).find((l) => /^\s*at /.test(l)) || "";

export function cappedAiSpan(text = moduleSource(AI_HOME)) {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.startsWith("export function cappedAi("));
  if (first < 0) throw new Error("ai-guard: export function cappedAi( was not found in " + AI_HOME);
  const last = lines.findIndex((l, i) => i > first && l === "}");
  if (last < 0) throw new Error("ai-guard: cappedAi in " + AI_HOME + " has no closing line");
  return { from: first + 1, to: last + 1 };
}

export function insideCappedAi(frame, span = homeSpan || (homeSpan = cappedAiSpan())) {
  const m = /\/shared\/flows-ai\.js(?:\?[^:\s)]*)?:(\d+):\d+/.exec(frame);
  if (!m) return false;
  const line = Number(m[1]);
  return line >= span.from && line <= span.to;
}

export function guardAi(binding) {
  if (!binding || (typeof binding !== "object" && typeof binding !== "function")) return binding;
  return new Proxy(binding, {
    get(target, key) {
      if (key !== "run") return Reflect.get(target, key, target);
      const run = Reflect.get(target, key, target);
      if (typeof run !== "function") return run;
      return function guardedRun(...args) {
        const caller = callerFrame(String(new Error().stack || ""));
        if (!insideCappedAi(caller)) {
          violations.push(caller.trim() || "an unknown caller");
          throw new Error("ai-guard: the AI binding was run from outside cappedAi in " + AI_HOME + " (" + (caller.trim() || "unknown") + ")");
        }
        allowed++;
        return Reflect.apply(run, target, args);
      };
    },
  });
}

export const aiGuardStats = () => ({ allowed, refused: violations.length, violations: violations.slice() });

export function assertAiGuarded({ minAllowed = 0 } = {}) {
  if (violations.length) {
    throw new Error("ai-guard: " + violations.length + " model call(s) bypassed " + AI_HOME + ": " + violations.join("; "));
  }
  if (allowed < minAllowed) throw new Error("ai-guard: " + allowed + " guarded model call(s), expected at least " + minAllowed + ", so the guard saw nothing");
  return allowed;
}
