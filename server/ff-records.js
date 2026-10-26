import { ABSENT_MARK, HOUSE_STREAM, LIMITS, sessionLabelText } from "../shared/ff-contract.js";
import { FRESH_CLASSES } from "../shared/flows-freshness.js";
import { clock, when } from "../shared/flows-time.js";

export const API_VERSION = 1;

export const REASON_TEXT = Object.freeze({
  no_record: "no record yet",
  no_firings: "no firings yet",
  no_hits: "no hits yet",
  no_sentence: "the stored hit carries no sentence",
  no_key: "the stored hit carries no key figure",
  short_history: "under 20 sessions of history",
  not_measured: "not measured",
  unobservable: "unobservable",
  pending: "pending",
  no_time: "no time stored",
});

export const absent = (reason, text) => Object.freeze({ v: null, text: ABSENT_MARK, reason, reasonText: text || REASON_TEXT[reason] || reason });

export const present = (v, text) => Object.freeze({ v, text });

export const timeView = (ms, now) => (Number.isFinite(ms) && ms > 0 ? Object.freeze({ ms, text: when(ms, now) }) : absent("no_time"));

export function durationText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return "under 1 s";
  if (ms < 60000) return Math.round(ms / 1000) + " s";
  if (ms < 3600000) return Math.round(ms / 60000) + " min";
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms - h * 3600000) / 60000);
  return m === 0 ? h + " h" : h + " h " + m + " min";
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const scopeOf = (astJson) => {
  const body = parse(astJson);
  const scope = body && typeof body === "object" ? body.scope : null;
  if (!scope || typeof scope !== "object") return { kind: "universe" };
  if (scope.kind === "names") return { kind: "names", symbols: Array.isArray(scope.symbols) ? scope.symbols : [] };
  if (scope.kind === "sector") return { kind: "sector", sector: String(scope.sector || "") };
  return { kind: "universe" };
};

export const scopeText = (scope) => (scope.kind === "names" ? scope.symbols.join(", ") : scope.kind === "sector" ? scope.sector + " sector" : "Every name in the universe");

export const cadenceText = (cadence) =>
  cadence === "live"
    ? "Checked every " + FRESH_CLASSES.breadth.cadenceS / 60 + " min in the session (Tier 2)"
    : "Checked once a night, after the close";

export const clientBody = (astJson) => {
  const body = parse(astJson);
  if (body === null || typeof body !== "object") return null;
  const { d, ...rest } = body;
  return rest;
};

export function wireView(row, { now, detail = false } = {}) {
  const scope = scopeOf(row.ast_json);
  const view = {
    id: row.id,
    layer: row.layer,
    title: row.title,
    status: row.status,
    statusAt: timeView(row.status_at, now),
    version: row.current_version,
    template: row.template,
    cadence: row.cadence,
    cadenceText: cadenceText(row.cadence),
    scope,
    scopeText: scopeText(scope),
    control: row.control,
    expWeek: row.exp_week === null || row.exp_week === undefined ? absent("not_measured", "no expected false alarms: a fact wire has no statistical test") : present(row.exp_week, String(row.exp_week)),
    sentence: row.sentence,
    origin: row.origin || null,
    effectiveSession: row.effective_session,
    effectiveText: "Takes effect from the " + row.effective_session + " session",
    createdAt: timeView(row.created_at, now),
    versionAt: timeView(row.version_at, now),
  };
  if (detail) view.ast = clientBody(row.ast_json);
  return Object.freeze(view);
}

export function limitsFrom(rows, budgetB) {
  let armed = 0;
  let universe = 0;
  let live = 0;
  let milli = 0;
  for (const r of rows) {
    if (r.status !== "armed") continue;
    armed += 1;
    if (r.scope_kind === "universe") universe += 1;
    if (r.cadence === "live") live += 1;
    if (r.control === "bh" && typeof r.exp_week === "number") milli += Math.round(r.exp_week * 1000);
  }
  return limitsView({ armed, universe, live, milli }, budgetB);
}

export const limitsView = (c, budgetB) =>
  Object.freeze({
    armed: Object.freeze({ used: Number(c.armed) || 0, max: LIMITS.armedMemberWires }),
    universe: Object.freeze({ used: Number(c.universe) || 0, max: LIMITS.universeMemberWires }),
    live: Object.freeze({ used: Number(c.live) || 0, max: LIMITS.liveMemberWires }),
    budget: Object.freeze({ used: (Number(c.milli) || 0) / 1000, max: budgetB, choices: LIMITS.budgetChoices }),
  });

export function versionView(row, now) {
  return Object.freeze({
    version: row.version,
    template: row.template,
    cadence: row.cadence,
    scopeKind: row.scope_kind,
    control: row.control,
    sentence: row.sentence,
    effectiveSession: row.effective_session,
    createdAt: timeView(row.created_at, now),
  });
}

export function hitRowView(row, { memberId, readSeq, houseReadSeq, now }) {
  const house = row.stream === HOUSE_STREAM;
  const latencyMs = row.fired_at - row.data_as_of;
  const withdrawn = row.withdrawn_at ? Object.freeze({ at: timeView(row.withdrawn_at, now), reason: row.withdrawn_reason }) : null;
  return Object.freeze({
    id: row.hit_id,
    kind: house ? "house" : "yours",
    unread: row.seq > (house ? houseReadSeq : readSeq),
    wire: Object.freeze({ id: row.wire_id, title: row.title, version: row.wire_version }),
    symbol: row.symbol,
    subject: row.subject,
    sector: row.sector,
    session: row.session,
    sessionLabel: row.session_label,
    at: Object.freeze({ ms: row.data_as_of, text: sessionLabelText(clock(row.data_as_of, false), row.session_label) }),
    firedAt: timeView(row.fired_at, now),
    latency: latencyMs >= 0 ? present(Math.round(latencyMs / 1000), durationText(latencyMs)) : absent("no_time"),
    evaluator: row.evaluator,
    sentence: typeof row.sentence === "string" && row.sentence ? row.sentence : absent("no_sentence"),
    key: typeof row.key_text === "string" && row.key_text ? row.key_text : absent("no_key"),
    withdrawn,
    mark: row.mark || null,
    feedback: row.feedback || null,
    mine: !house && row.member_id === memberId,
  });
}

export function hitDetailView(row, { memberId, readSeq, houseReadSeq, now }) {
  const base = hitRowView({ ...row, sentence: row.version_sentence }, { memberId, readSeq, houseReadSeq, now });
  const evidence = parse(row.evidence_json);
  return Object.freeze({
    ...base,
    sentence: row.version_sentence || base.sentence,
    wire: Object.freeze({
      id: row.wire_id, title: row.title, version: row.wire_version, currentVersion: row.current_version, isCurrent: row.wire_version === row.current_version,
      status: row.wire_status, template: row.template || null,
    }),
    evaluatorVersion: row.evaluator_version,
    evidence: evidence === null ? absent("not_measured", "the stored evidence could not be read") : evidence,
  });
}

export function recordView(row, now) {
  if (!row) return absent("no_record");
  const reasons = parse(row.null_reasons || "null") || {};
  const fig = (field, format) => {
    const v = row[field];
    if (v === null || v === undefined) return absent(typeof reasons[field] === "string" ? reasons[field] : "no_record", typeof reasons[field] === "string" ? REASON_TEXT[reasons[field]] : undefined);
    return present(v, format(v));
  };
  const pct = (x) => Math.round(x * 100) + "%";
  const secs = (s) => durationText(s * 1000);
  return Object.freeze({
    period: row.period,
    firings: present(row.firings, String(row.firings)),
    sessions: present(row.sessions, String(row.sessions)),
    calibration: Object.freeze({ budget: fig("budget", String), placebo: fig("placebo", String), placeboN: row.placebo_n === null ? absent("no_record") : present(row.placebo_n, String(row.placebo_n)) }),
    confirmation: Object.freeze({ share: fig("confirmation", pct), n: row.confirm_n === null ? absent("no_record") : present(row.confirm_n, String(row.confirm_n)) }),
    latency: Object.freeze({ p50: fig("lat_p50_s", secs), p95: fig("lat_p95_s", secs) }),
    coverage: fig("coverage", pct),
    updatedAt: timeView(row.updated_at, now),
  });
}

export const rarityOf = (record) => {
  if (!record || !(record.sessions >= 20)) return absent("short_history");
  if (!(record.firings >= 1)) return absent("no_firings");
  const n = Math.max(1, Math.round(record.sessions / record.firings));
  return present(n, "1 in " + n + " sessions");
};

export function receiptView(row, now) {
  return Object.freeze({
    wire: row.wire_id,
    version: row.version,
    session: row.session,
    status: row.status,
    reason: row.status === "evaluated" ? null : row.reason,
    looks: row.looks,
    namesEvaluated: row.names_evaluated,
    namesAbsent: row.names_absent,
    absent: parse(row.absent_json || "null"),
    hits: row.hits,
    hitsCapped: row.hits_capped,
    late: row.late === 1,
    evaluatedAt: timeView(row.evaluated_at, now),
    upgradedAt: row.upgraded_at ? timeView(row.upgraded_at, now) : null,
    line: row.status === "evaluated" ? "evaluated" : ABSENT_MARK + " not evaluated: " + row.reason,
  });
}

export function houseView(row, record, now) {
  const base = wireView(row, { now });
  return Object.freeze({ ...base, following: !row.off, record: recordView(record, now), rarity: rarityOf(record) });
}

export function symbolView(found, symbol, now, today) {
  const wires = found.wires.map((w) => {
    const hitToday = found.lastHit !== null && found.lastHit.session === today;
    let state = w.status === "paused" ? "paused" : "armed";
    if (w.status === "armed" && w.phase === "cooling" && w.cool_until) state = "quiet";
    if (w.status === "armed" && hitToday && w.phase === "firing") state = "hit";
    return Object.freeze({
      id: w.id, title: w.title, version: w.current_version, status: w.status, state, cadence: w.cadence, cadenceText: cadenceText(w.cadence), sentence: w.sentence,
      quietUntil: state === "quiet" ? w.cool_until : null,
    });
  });
  const armed = wires.filter((w) => w.status === "armed").length;
  const last = found.lastHit;
  return Object.freeze({
    symbol,
    wires,
    armed,
    lastHit: last
      ? Object.freeze({ session: last.session, at: Object.freeze({ ms: last.fired_at, text: when(last.fired_at, now) }) })
      : absent("no_hits"),
    muted: found.muted,
    line: armed === 0 ? "No armed wire names " + symbol : armed + " armed",
  });
}
