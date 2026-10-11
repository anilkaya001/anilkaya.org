import { aiChain } from "./flows-ai.js";

export const AI_SURFACES = Object.freeze(["board", "neuron", "ask", "read"]);

export const AI_OUTCOMES = Object.freeze([
  "clean", "trimmed", "refused", "unparsable", "overlong", "empty", "length",
  "budget", "class", "user", "allowance", "capacity", "plan", "unreachable",
]);

const WORDING = new Set(["refused", "unparsable", "overlong", "empty", "length"]);
const NOT_REACHED = new Set(["budget", "class", "user"]);
const TRANSPORT = new Set(["budget", "allowance", "capacity", "plan", "unreachable"]);

export const AI_REJECT_SLOTS = 50;
export const AI_TOKEN_MAX = 40;
export const AI_REASON_MAX = 40;
export const AI_RETAIN_DAYS = 8;

export function chainFor(env, surface, only = null) {
  if (!AI_SURFACES.includes(surface)) throw new TypeError("broker: " + String(surface) + " is not a surface");
  if (typeof only === "string" && only) return [only];
  return aiChain(env);
}

export function transportOutcome(said) {
  if (!said || typeof said !== "object" || said.text) return null;
  const guard = typeof said.guard === "string" ? said.guard : "";
  if (guard === "unreachable:length") return { outcome: "length", reason: "" };
  if (guard === "unreachable:empty") return { outcome: "empty", reason: "" };
  const why = said.failure && typeof said.failure.why === "string" ? said.failure.why : guard.startsWith("unreachable:") ? guard.slice("unreachable:".length) : "";
  if (TRANSPORT.has(why)) return { outcome: why, reason: "" };
  return { outcome: "unreachable", reason: "" };
}

export function reasonOf(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\d+/g, "N").replace(/[^A-Za-z0-9:_ .-]/g, "").trim().slice(0, AI_REASON_MAX);
}

export function tokenOf(raw) {
  if (raw === null || raw === undefined) return "";
  const text = String(raw).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u2064\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, AI_TOKEN_MAX);
}

export function guardOutcome(verdict) {
  const v = verdict && typeof verdict === "object" ? verdict : {};
  const llm = v.llm === true;
  const guard = typeof v.guard === "string" ? v.guard : "";
  if (guard === "") return llm ? { outcome: "clean", reason: "" } : { outcome: "refused", reason: "" };
  if (guard.startsWith("unreachable:reparse:")) {
    const why = guard.slice("unreachable:reparse:".length);
    return { outcome: TRANSPORT.has(why) ? why : "unreachable", reason: "reparse" };
  }
  if (guard.startsWith("unreachable:")) {
    const t = transportOutcome({ text: null, guard });
    return { outcome: t.outcome, reason: "" };
  }
  if (/^ideas:\d+ refused$/.test(guard) || /^read:trimmed:\d+$/.test(guard)) return { outcome: "trimmed", reason: reasonOf(guard) };
  if (guard === "ideas:unparsable" || guard === "read:unparsable") return { outcome: "unparsable", reason: llm ? "prose-kept" : "" };
  if (guard === "read:overlong") return { outcome: "overlong", reason: "" };
  if (guard === "summary:empty") return { outcome: "empty", reason: "summary" };
  if (guard === "read:refused" || guard === "engine:refused") return { outcome: "refused", reason: reasonOf(guard) };
  if (["invented", "forecast", "mislabeled", "unsafe"].includes(guard)) return { outcome: "refused", reason: guard };
  return { outcome: llm ? "trimmed" : "refused", reason: reasonOf(guard) };
}

export function isWordingFailure(outcome) {
  return WORDING.has(outcome);
}

export function foldCounters(rows, ring, { days = 1, today = "" } = {}) {
  const bySurface = {};
  const byModel = {};
  const take = (map, key) => (map[key] ||= { calls: 0, outcomes: {}, msSum: 0, msMax: 0 });
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = Math.max(0, Number(r.n) || 0);
    if (!AI_OUTCOMES.includes(r.outcome)) continue;
    for (const [map, key] of [[bySurface, String(r.surface)], [byModel, String(r.model)]]) {
      const t = take(map, key);
      t.calls += n;
      t.outcomes[r.outcome] = (t.outcomes[r.outcome] || 0) + n;
      t.msSum += Math.max(0, Number(r.ms_sum) || 0);
      t.msMax = Math.max(t.msMax, Math.max(0, Number(r.ms_max) || 0));
    }
  }
  const finish = (map) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, t]) => {
    const reached = t.calls - Object.entries(t.outcomes).reduce((n, [o, c]) => n + (NOT_REACHED.has(o) ? c : 0), 0);
    const failed = Object.entries(t.outcomes).reduce((n, [o, c]) => n + (WORDING.has(o) ? c : 0), 0);
    return [key, {
      calls: t.calls, outcomes: t.outcomes, reached,
      refusalRate: reached > 0 ? Math.round((failed / reached) * 1000) / 1000 : null,
      msAvg: reached > 0 ? Math.round(t.msSum / reached) : null, msMax: t.msMax,
    }];
  }));
  return {
    days, today,
    surfaces: finish(bySurface),
    models: finish(byModel),
    recent: (Array.isArray(ring) ? ring : []).slice(0, AI_REJECT_SLOTS).map((r) => ({
      surface: String(r.surface), at: Number(r.at) || 0, model: String(r.model), reason: String(r.reason), culprit: tokenOf(r.culprit),
    })),
  };
}
