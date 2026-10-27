import { ABSENT_MARK, UNITS, metricById } from "../shared/ff-contract.js";
import { easternInstant, nextTradingDay, phaseAt, sessionOpen, sessionClose } from "../shared/flows-freshness.js";
import { when } from "../shared/flows-time.js";
import { API_VERSION, absent, cadenceText, present, timeView } from "./ff-records.js";
import { dueNightly } from "./ff-health.js";

export const PREVIEW = Object.freeze({ listMax: 25, nightlyRunMinutes: 17 * 60 + 30, firstTickAfterOpenMs: 5 * 60000, liveStepMs: 15 * 60000 });

const MINUS = "−";

const signed = (text, v) => (v < 0 ? MINUS + text.replace("-", "") : text);

export function valueText(unit, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return ABSENT_MARK;
  const a = Math.abs(v);
  switch (unit) {
    case "usd": {
      const body = a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(0) + "K" : a.toFixed(0);
      return (v < 0 ? MINUS : "") + "$" + body;
    }
    case "contracts": return signed(Math.round(v).toLocaleString("en-US"), v);
    case "sigma": return signed(v.toFixed(2), v) + "σ";
    case "vol_pt": return signed(v.toFixed(1), v) + " pts";
    case "pct": return signed(v.toFixed(1), v) + "%";
    case "pctile": return Math.round(v) + "th";
    case "ratio": return signed(v.toFixed(2), v);
    case "sessions": return Math.round(v) + (Math.round(v) === 1 ? " session" : " sessions");
    case "days": return Math.round(v) + (Math.round(v) === 1 ? " day" : " days");
    case "bool": return v ? "yes" : "no";
    default: return String(v);
  }
}

export function firstCheck({ cadence, now, effectiveSession, clockRow = null }) {
  if (cadence === "nightly") return { at: easternInstant(effectiveSession, PREVIEW.nightlyRunMinutes), scheduled: true };
  const open = sessionOpen(effectiveSession);
  const close = sessionClose(effectiveSession, clockRow);
  const first = open + PREVIEW.firstTickAfterOpenMs;
  const ph = phaseAt(now, clockRow);
  if (ph !== null && ph.phase === "rth" && ph.session === effectiveSession && now >= first) {
    const next = Math.ceil((now + 1) / PREVIEW.liveStepMs) * PREVIEW.liveStepMs;
    if (next < close) return { at: next, scheduled: true };
    const after = nextTradingDay(effectiveSession, clockRow);
    return { at: after ? sessionOpen(after) + PREVIEW.firstTickAfterOpenMs : first, scheduled: true };
  }
  return { at: first, scheduled: true };
}

const reasonTextOf = (reason) => (reason ? ABSENT_MARK + " " + String(reason).replace(/_/g, " ") : ABSENT_MARK);

export function previewView({ compiled, result, now, effectiveSession, clockRow = null, firstCheckAt = null }) {
  const v = compiled.version;
  const check = firstCheckAt || firstCheck({ cadence: v.cadence, now, effectiveSession, clockRow });
  const due = dueNightly(now, clockRow);
  const subjects = Array.isArray(result.subjects) ? result.subjects : [];
  const decided = subjects.filter((s) => s.verdict === "true" || s.verdict === "false");
  const wouldHit = subjects.filter((s) => s.verdict === "true");
  const unknown = subjects.filter((s) => s.verdict === "unknown");
  const reasons = new Map();
  for (const s of unknown) reasons.set(s.reason || "missing", (reasons.get(s.reason || "missing") || 0) + 1);
  const rowOf = (s) => ({
    symbol: s.symbol,
    subject: s.subject,
    verdict: s.verdict,
    wouldHit: s.verdict === "true" ? true : s.verdict === "false" ? false : null,
    reason: s.verdict === "unknown" ? s.reason || "missing" : null,
    reasonText: s.verdict === "unknown" ? reasonTextOf(s.reason || "missing") : null,
    clauses: (s.clauses || []).map((c) => {
      const m = metricById(c.m);
      const unit = m ? m.unit : "ratio";
      return {
        metric: c.m,
        label: m ? m.label : c.m,
        op: c.op,
        threshold: c.x,
        thresholdText: valueText(unit, c.x),
        value: c.value === undefined ? null : c.value,
        valueText: c.value === null || c.value === undefined ? ABSENT_MARK : valueText(unit, c.value),
        ok: c.ok === undefined ? null : c.ok,
        precision: m ? UNITS[unit].step : null,
      };
    }),
  });
  const listed = (v.scope_kind === "names" ? subjects : wouldHit).slice(0, PREVIEW.listMax).map(rowOf);
  const asOfMs = result.generatedAt ? Date.parse(result.generatedAt) : NaN;
  const stale = result.sessionDate && due ? result.sessionDate < due : false;
  return Object.freeze({
    v: API_VERSION,
    serverNow: now,
    status: result.status === "ok" ? "ok" : "unavailable",
    reason: result.status === "ok" ? null : result.reason || "missing",
    reasonText: result.status === "ok" ? null : reasonTextOf(result.reason || "missing"),
    sentence: v.sentence,
    template: v.template,
    cadence: v.cadence,
    control: v.control,
    expWeek: v.exp_week === null || v.exp_week === undefined ? absent("not_measured", "a fact wire has no statistical test") : present(v.exp_week, String(v.exp_week)),
    evaluator: Object.freeze({
      kind: v.cadence,
      text: v.cadence === "live" ? cadenceText("live") : "Evaluated once a night, after the close",
      firstCheck: Object.freeze({ ms: check.at, text: when(check.at, now), scheduled: check.scheduled, label: "first check " + when(check.at, now) + " (scheduled)" }),
      effectiveSession,
    }),
    freshness: Object.freeze({
      session: result.sessionDate || null,
      asOf: Number.isFinite(asOfMs) ? timeView(asOfMs, now) : absent("not_measured", "the stored snapshot carries no read time"),
      stale,
      expected: due,
    }),
    coverage: Object.freeze({
      subjects: subjects.length,
      evaluated: decided.length,
      wouldHit: wouldHit.length,
      unknown: unknown.length,
      reasons: Object.freeze(Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)))),
    }),
    subjects: listed,
    truncated: v.scope_kind === "names" ? false : wouldHit.length > PREVIEW.listMax,
    slots: Object.freeze({ history: absent("not_measured", "the history strip arrives in a later phase") }),
  });
}
