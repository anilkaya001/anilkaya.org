import { COPY_BANNED, LIMITS, ABSENT_MARK, absentLine, metricById } from "./ff-contract.js";
import { formatFixed, formatScaled, compactDp } from "./flows-display-round.js";
import { timeLine } from "./ff-session.js";
import { clock } from "./flows-time.js";

const OP_TEXT = Object.freeze({ ">=": "≥", "<=": "≤", "==": "=" });

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + "th";
  return n + (["th", "st", "nd", "rd"][n % 10] || "th");
};

export function formatValue(v, unit) {
  if (typeof v !== "number" || !Number.isFinite(v)) return ABSENT_MARK;
  switch (unit) {
    case "usd": return formatScaled(v, compactDp, "$");
    case "contracts": return formatFixed(v, { dp: 0, group: true });
    case "sigma": return formatFixed(v, { dp: 2, suffix: "σ" });
    case "vol_pt": return formatFixed(v, { dp: 1, suffix: " pts" });
    case "pct": return formatFixed(v, { dp: 1, suffix: "%" });
    case "pctile": return ordinal(Math.round(v));
    case "ratio": return formatFixed(v, { dp: 2 });
    case "sessions": return plural(Math.round(v), "session", "sessions");
    case "days": return plural(Math.round(v), "day", "days");
    case "bool": return v ? "yes" : "no";
    default: return ABSENT_MARK;
  }
}

export function clauseText(m, op, x) {
  const metric = typeof m === "string" ? metricById(m) : m;
  if (!metric) return null;
  if (metric.unit === "bool" && op === "==") return (x ? "" : "not ") + metric.label;
  return metric.label + " " + (OP_TEXT[op] || op) + " " + formatValue(x, metric.unit);
}

export function scopeText(scope, subjectKind = "n") {
  const noun = subjectKind === "s" ? "sector" : subjectKind === "c" ? "flagged option window" : "name";
  if (scope.kind === "universe") return subjectKind === "c" ? "on any flagged option window in the universe" : "on any " + noun + " in the universe";
  if (scope.kind === "sector") return subjectKind === "s" ? "in the " + scope.sector + " sector" : "on any " + noun + " in the " + scope.sector + " sector";
  const s = scope.symbols;
  return "on " + (s.length <= 4 ? s.join(", ") : s.slice(0, 3).join(", ") + " and " + (s.length - 3) + " more names");
}

export function wireSentence(body, subjectKind = "n") {
  const parts = body.all.map((c) => clauseText(c.m, c.op, c.x));
  const hold = body.persist > 1 ? ", held for " + body.persist + (body.cadence === "live" ? " looks" : " nights") : "";
  const quiet = body.cooldown.n === 1 && body.cadence === "live" ? "quiet for the rest of the session" : "quiet for " + plural(body.cooldown.n, "session", "sessions");
  const tail = ", checked " + (body.cadence === "live" ? "on every live tick" : "nightly") + hold + ", then " + quiet;
  const head = "When " + parts.join(" and ") + ", " + scopeText(body.scope, subjectKind);
  return (head + tail + ".").slice(0, LIMITS.sentenceChars);
}

export function shortScope(scope, subjectKind = "n") {
  if (scope.kind === "universe") return subjectKind === "s" ? "all sectors" : "universe";
  if (scope.kind === "sector") return scope.sector;
  const s = scope.symbols;
  return s.length <= 3 ? s.join(", ") : s.slice(0, 2).join(", ") + " +" + (s.length - 2);
}

export function titleOf(body, subjectKind = "n") {
  const first = clauseText(body.all[0].m, body.all[0].op, body.all[0].x);
  const more = body.all.length > 1 ? " +" + (body.all.length - 1) : "";
  return (first + more + " · " + shortScope(body.scope, subjectKind)).slice(0, LIMITS.titleChars);
}

export function verbFor(clause, persist = 1) {
  if (clause.subject === "window") return "appeared";
  if (clause.op === "==") return "entered";
  if (persist > 1) return "reached";
  return clause.op === ">=" ? "crossed above" : "crossed below";
}

export function hitSentence(e) {
  const lead = e.clauses[e.lead];
  const who = e.occ ? e.symbol + " " + e.occ : e.sector && !e.symbol ? e.sector : e.symbol;
  const verb = verbFor({ subject: lead.subject, op: lead.op }, e.persist);
  const t = timeLine(e.session, e.asOf);
  const when = t ? t.text : (clock(e.asOf) || ABSENT_MARK);
  const flagged = lead.subject === "window" ? " · flagged by the data feed" : "";
  const value = lead.unit === "bool" ? formatValue(lead.value, "bool") : formatValue(lead.value, lead.unit);
  return who + " " + lead.label + " " + verb + " " + value + " (" + (OP_TEXT[lead.op] || lead.op) + " " + formatValue(lead.x, lead.unit) + ")" + flagged + " · " + when;
}

export function evidenceRows(e) {
  return e.clauses.map((c) => ({
    m: c.m,
    label: c.label,
    value: formatValue(c.value, c.unit),
    op: OP_TEXT[c.op] || c.op,
    threshold: formatValue(c.x, c.unit),
    ok: c.ok !== false,
    floored: c.floored === true,
    baseline: Number.isInteger(c.n) ? c.n + "/" + (c.window || LIMITS.baselineWindow) + " sessions" : null,
  }));
}

export function renderHit(e) {
  const t = timeLine(e.session, e.asOf);
  const fired = clock(e.firedAt);
  return Object.freeze({
    sentence: hitSentence(e),
    wireSentence: e.wireSentence,
    session: e.session,
    clock: t ? t.clock : null,
    label: t ? t.label : null,
    firedClock: fired,
    latencyS: Number.isFinite(e.firedAt) && Number.isFinite(e.asOf) ? Math.max(0, Math.round((e.firedAt - e.asOf) / 1000)) : null,
    rows: evidenceRows(e),
  });
}

export const unknownText = (reason, detail = "") => absentLine(reason, detail);

export function baselineText(n, window = LIMITS.baselineWindow) {
  return absentLine("warming", "baseline " + n + "/" + window + " sessions");
}

export function receiptText(r) {
  if (r.status === "evaluated") {
    const base = plural(r.namesEvaluated, "name", "names") + " evaluated";
    const lost = r.namesAbsent ? ", " + r.namesAbsent + " without data" : "";
    return base + lost + (r.reason === "record_truncated" ? ", record truncated" : "");
  }
  return ABSENT_MARK + " not evaluated: " + String(r.reason).replace(/_/g, " ");
}

const WORD = (s, w) => new RegExp("(^|[^a-z])" + w + "([^a-z]|$)", "i").test(s);

export const bannedIn = (text) => COPY_BANNED.filter((w) => WORD(text, w));

