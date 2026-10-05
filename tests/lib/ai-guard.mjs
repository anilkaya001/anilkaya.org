import { closure, treeFiles, moduleSource, count } from "./source-scan.mjs";

export const AI_HOME = "shared/flows-ai.js";
const HOME_FRAME = "/" + AI_HOME;

export function modelCallFiles() {
  return [...new Set([...closure("worker.js"), ...treeFiles("shared"), ...treeFiles("server")])].sort();
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

export function bindingReads(files = modelCallFiles(), read = moduleSource) {
  const reads = [];
  const tests = [];
  for (const file of files) {
    const text = read(file);
    for (const m of text.matchAll(/(!\s*|Boolean\(\s*(?:[\w$]+\s*&&\s*)?)?[\w$\])]+\s*(?:\?\.|\.)\s*AI\b(\s*(?:\?\.|\.|\(|\[))?/g)) {
      (m[1] && !m[2] ? tests : reads).push({ file, line: lineOf(text, m.index), text: m[0].trim() });
    }
    for (const m of text.matchAll(/\[\s*["'`]AI["'`]\s*\]|\{[^{}]*\bAI\b[^{}]*\}\s*=(?!=)/g)) {
      reads.push({ file, line: lineOf(text, m.index), text: m[0].trim() });
    }
  }
  return { reads, tests };
}

export function modelCallReport(files = modelCallFiles(), read = moduleSource) {
  const { reads, tests } = bindingReads(files, read);
  const runs = files.map((file) => ({ file, n: count(read(file), /\bai\.run\(/) })).filter((r) => r.n > 0);
  const askSites = [];
  for (const file of files) {
    const text = read(file);
    for (const m of text.matchAll(/(?<!function\s+)\baskModels\(([^,]*\)?),/g)) {
      askSites.push({ file, line: lineOf(text, m.index), arg: m[1].trim() });
    }
  }
  const cappedDeps = files.reduce((n, file) => n + count(read(file), /\bai: \(\) => cappedAi\(/), 0);
  return { files: files.length, reads, tests, runs, askSites, cappedDeps };
}

export function checkModelCalls(report = modelCallReport()) {
  const problems = [];
  const home = report.reads.filter((r) => r.file === AI_HOME);
  const away = report.reads.filter((r) => r.file !== AI_HOME);
  if (home.length !== 1) problems.push(`${AI_HOME} must read the binding into a value exactly once (found ${home.length})`);
  for (const r of away) problems.push(`${r.file}:${r.line} reads the AI binding outside ${AI_HOME}: ${r.text}`);
  const homeRuns = report.runs.find((r) => r.file === AI_HOME);
  if (!homeRuns || homeRuns.n < 2) problems.push(`${AI_HOME} must hold both ai.run( sites, cappedAi's and askModels' (found ${homeRuns ? homeRuns.n : 0})`);
  for (const r of report.runs) if (r.file !== AI_HOME) problems.push(`${r.file} runs ai.run( outside ${AI_HOME}`);
  if (report.askSites.length < 1) problems.push("no askModels( call site was found, so the scan reads the wrong tree");
  for (const s of report.askSites) {
    if (!/^(?:meteredAi\(env\)|cappedAi\(.*\)|deps\.ai\(\))$/.test(s.arg)) problems.push(`${s.file}:${s.line} hands askModels an unmetered binding: ${s.arg}`);
  }
  if (report.askSites.some((s) => s.arg === "deps.ai()") && report.cappedDeps < 1) problems.push("a deps.ai() binding exists but no ai: () => cappedAi( builds it");
  return problems;
}

const violations = [];
let allowed = 0;

const callerFrame = (stack) => stack.split("\n").slice(2).find((l) => /^\s*at /.test(l)) || "";

export function guardAi(binding) {
  if (!binding || (typeof binding !== "object" && typeof binding !== "function")) return binding;
  return new Proxy(binding, {
    get(target, key) {
      if (key !== "run") return Reflect.get(target, key, target);
      const run = Reflect.get(target, key, target);
      if (typeof run !== "function") return run;
      return function guardedRun(...args) {
        const caller = callerFrame(String(new Error().stack || ""));
        if (!caller.includes(HOME_FRAME + ":")) {
          violations.push(caller.trim() || "an unknown caller");
          throw new Error("ai-guard: the AI binding was run from outside " + AI_HOME + " (" + (caller.trim() || "unknown") + ")");
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
