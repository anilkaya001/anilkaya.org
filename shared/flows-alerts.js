import { parseOptionSymbol } from "./flows-premium.js";

const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const flag = (v) => (v === null || v === undefined ? null : Boolean(v));

const fromEpoch = (n) => {
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n > 1e12 ? n : n * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

export function alertStamp(v) {
  if (typeof v === "number") return fromEpoch(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{9,13}(\.\d+)?$/.test(s)) return fromEpoch(Number(s));
  return /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s)) ? s : null;
}

export const ALERT_ROWS = 60;

export const ALERTS_NOTES = Object.freeze({
  unit:
    "One row is one alert: a window of activity in one contract that one of " +
    "the vendor's own rules flagged, carrying the vendor's stated span, its " +
    "count of executions, a total size and a total premium with its " +
    "ask-side/bid-side split. A row aggregates that whole window, so it is " +
    "never a single transaction and this page does not present it as one.",
  selection:
    "The population is what the vendor's rules chose to flag. The rules are " +
    "named per row but their definitions are the vendor's own — not " +
    "published, not reproducible from this payload — so absence from this " +
    "list is not evidence of quiet, and presence is not a ranking of the " +
    "whole market. The premium ordering below ranks only within what was " +
    "flagged.",
  sides:
    "Ask-side and bid-side premium are the vendor's attribution of the " +
    "window's dollars against the quote. The split is carried as published; " +
    "this page adds no inference about who initiated, and the two need not " +
    "sum to the total where the vendor left dollars between the quotes.",
  flags:
    "Sweep, floor, single-leg and all-opening are the vendor's flags, " +
    "reported as sent. A dash means the vendor did not carry the flag on " +
    "that row — which is not the same fact as the flag being off.",
  record:
    "During the session this feed is a RECORD, not a snapshot. The vendor's " +
    "list is a rolling window \u2014 a name flagged at 09:31 has usually " +
    "fallen off it by midday \u2014 so each fifteen-minute read is merged " +
    "into the day's record rather than replacing it. Every row says when the " +
    "record first held it, when a read last carried it, and how many reads " +
    "carried it; the first of those is the early fact and it never advances. " +
    "The record covers one Eastern session, names that date, and starts " +
    "empty at the next one \u2014 yesterday's flags under today's timestamp " +
    "would be a claim about a day that never made it. When the union outgrows " +
    "its ceiling the smallest premiums are shed first, in the same order the " +
    "list is ranked, and both the ceiling and what it removed are published " +
    "beside it \u2014 with a running count of everything that has entered the " +
    "record today, because the ceiling compounds and the count of what the " +
    "record still holds would otherwise stop growing at the moment it began " +
    "to overflow.",
  refusals:
    "No intent and no identity: nothing here says who was active or why, " +
    "and no flag makes that observable. Rows are windows, not executions, " +
    "so no number here is an execution price either.",
});

export function alertRow(raw, { stageOf, stageComplete = true } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const t = typeof raw.ticker === "string" && raw.ticker ? raw.ticker : null;
  if (!t) return null;

  const oc = typeof raw.option_chain === "string" && raw.option_chain
    ? raw.option_chain : null;
  const parsed = oc ? parseOptionSymbol(oc) : null;

  const prem = num(raw.total_premium);
  const size = num(raw.total_size);
  const trades = num(raw.trade_count);

  if (prem === null && size === null && trades === null) return null;

  const start = alertStamp(raw.start_time);
  const created = start === null ? alertStamp(raw.created_at) : null;
  const spanStart = start ?? created;

  return {
    t,
    oc,

    cp: parsed ? parsed.type : null,
    k: parsed ? parsed.strike : num(raw.strike),
    exp: parsed ? parsed.expiry : (typeof raw.expiry === "string" ? raw.expiry.slice(0, 10) : null),
    prem, size, trades,
    askPrem: num(raw.total_ask_side_prem),
    bidPrem: num(raw.total_bid_side_prem),
    sweep: flag(raw.has_sweep),
    floor: flag(raw.has_floor),
    single: flag(raw.has_singleleg),
    opening: flag(raw.all_opening_trades),
    oi: num(raw.open_interest),

    voi: num(raw.volume_oi_ratio),
    ivStart: num(raw.iv_start),
    ivEnd: num(raw.iv_end),
    px: num(raw.underlying_price),
    spanStart,
    spanEnd: alertStamp(raw.end_time) ?? spanStart,
    ...(created !== null ? { spanFrom: "created_at" } : {}),
    rule: typeof raw.alert_rule === "string" && raw.alert_rule ? raw.alert_rule : null,

    st: typeof stageOf === "function"
      ? (stageOf(t) || (stageComplete ? "foreign" : null))
      : null,
  };
}

export const ALERT_BAND_ROWS = 8;

export function alertBand(shapedRows, { cap = ALERT_BAND_ROWS } = {}) {
  const usable = (Array.isArray(shapedRows) ? shapedRows : [])
    .filter((r) => r && r.prem !== null && typeof r.t === "string");
  const rows = usable.slice(0, cap).map((r) => ({
    t: r.t, oc: r.oc, cp: r.cp, k: r.k, exp: r.exp,
    prem: r.prem, sweep: r.sweep, rule: r.rule,
  }));
  return {
    basis: "vendor-flagged windows",
    rows,
    seen: usable.length,
    cap,
    shed: Math.max(0, usable.length - rows.length),
  };
}

const byName = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)
  || ((a.oc || "") < (b.oc || "") ? -1 : (a.oc || "") > (b.oc || "") ? 1 : 0);

function byPremium(a, b) {
  if (a.prem === null && b.prem === null) {
    return ((b.size ?? -1) - (a.size ?? -1)) || byName(a, b);
  }
  if (a.prem === null) return 1;
  if (b.prem === null) return -1;
  return (b.prem - a.prem) || byName(a, b);
}

function coverageOf(rows) {
  const count = (f) => rows.filter(f).length;
  return {
    withPremium: count((r) => r.prem !== null),
    withSpan: count((r) => r.spanStart !== null && r.spanEnd !== null),
    spanFromCreated: count((r) => r.spanFrom === "created_at"),
    withContract: count((r) => r.cp !== null),
    sweeps: count((r) => r.sweep === true),
    opening: count((r) => r.opening === true),
    calls: count((r) => r.cp === "C"),
    puts: count((r) => r.cp === "P"),
  };
}

export function buildFlowAlerts(rawRows, { stageOf, stageComplete = true, cap = ALERT_ROWS } = {}) {
  const shaped = [];
  let unusable = 0;
  const incoming = Array.isArray(rawRows)
    ? rawRows
    : (rawRows && typeof rawRows === "object" && Array.isArray(rawRows.data))
      ? rawRows.data
      : [];
  for (const raw of incoming) {
    const row = alertRow(raw, { stageOf, stageComplete });
    if (row) shaped.push(row);
    else unusable++;
  }

  shaped.sort(byPremium);

  const seen = shaped.length;
  const rows = shaped.slice(0, cap);

  return {
    rows,
    seen,
    unusable,
    shed: Math.max(0, seen - rows.length),
    cap,
    coverage: coverageOf(rows),
    status: rows.length ? "ok" : "quiet",
    notes: ALERTS_NOTES,
  };
}

export function alertKey(row) {
  if (!row || typeof row !== "object") return null;
  const t = typeof row.t === "string" && row.t ? row.t : null;
  if (!t) return null;
  const oc = typeof row.oc === "string" ? row.oc : "";

  const SEP = "\u0000";
  return typeof row.spanStart === "string" && row.spanStart
    ? "w" + SEP + t + SEP + oc + SEP + row.spanStart
    : "u" + SEP + t + SEP + oc + SEP + (typeof row.rule === "string" ? row.rule : "");
}

export const MERGED_ALERT_ROWS = 180;
export const MERGED_ALERT_BYTES = 96 * 1024;

function carriedRow(row) {
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = (v) => (typeof v === "string" && v ? v : null);
  return {
    ...row,
    prem: n(row.prem), size: n(row.size), trades: n(row.trades),
    cp: s(row.cp), spanStart: s(row.spanStart), spanEnd: s(row.spanEnd),

    firstAt: s(row.firstAt), lastAt: s(row.lastAt), reads: n(row.reads),
  };
}

export function mergeAlerts(prev, next, {
  at = null,
  sessionDate = null,
  cap = MERGED_ALERT_ROWS,
  byteCap = MERGED_ALERT_BYTES,
} = {}) {
  const readAt = typeof at === "string" && at ? at : null;
  const date = typeof sessionDate === "string" && sessionDate ? sessionDate : null;
  const fresh = next && Array.isArray(next.rows) ? next.rows : [];
  const held = prev && typeof prev === "object" ? prev : null;
  const heldRecord = held && held.record && typeof held.record === "object" ? held.record : null;
  const heldRows = held && Array.isArray(held.rows) ? held.rows : [];

  const heldDate = heldRecord && typeof heldRecord.date === "string" && heldRecord.date
    ? heldRecord.date : null;
  let reset = null;
  if (!heldRecord) reset = "cold";
  else if (!date || !heldDate) reset = "undated";
  else if (heldDate !== date) reset = "session-boundary";

  const byKey = new Map();
  if (!reset) {
    for (const row of heldRows) {
      const k = alertKey(row);
      if (!k || byKey.has(k)) continue;
      byKey.set(k, carriedRow(row));
    }
  }
  const carriedIn = byKey.size;

  let again = 0;
  let entered = 0;
  const thisRead = new Set();
  for (const row of fresh) {
    const k = alertKey(row);
    if (!k) continue;

    if (thisRead.has(k)) continue;
    thisRead.add(k);
    let prior = byKey.get(k);
    if (!prior && typeof row.spanStart === "string" && row.spanStart) {
      const unspanned = alertKey({ ...row, spanStart: null });
      const held = unspanned ? byKey.get(unspanned) : undefined;
      if (held && !held.spanStart && !thisRead.has(unspanned)) {
        prior = held;
        byKey.delete(unspanned);
      }
    }
    if (prior) {
      again++;
      byKey.set(k, {

        ...row,

        firstAt: typeof prior.firstAt === "string" && prior.firstAt ? prior.firstAt : null,
        lastAt: readAt,
        reads: (Number.isFinite(prior.reads) ? prior.reads : 1) + 1,
      });
    } else {
      entered++;
      byKey.set(k, { ...row, firstAt: readAt, lastAt: readAt, reads: 1 });
    }
  }

  const union = Array.from(byKey.values()).sort(byPremium);

  const rows = [];
  let bytes = 0;
  let shedBy = null;
  for (const row of union) {
    if (rows.length >= cap) { shedBy = "rows"; break; }

    const width = JSON.stringify(row).length + 1;
    if (bytes + width > byteCap) { shedBy = "bytes"; break; }
    rows.push(row);
    bytes += width;
  }

  const shed = union.length - rows.length;

  const priorReads = !reset && heldRecord && Number.isFinite(heldRecord.reads)
    ? heldRecord.reads

    : (carriedIn ? 1 : 0);

  const priorEver = Math.max(
    !reset && heldRecord && Number.isFinite(heldRecord.everEntered)
      ? heldRecord.everEntered : 0,
    carriedIn);

  return {
    rows,

    seen: union.length,

    unusable: next && Number.isFinite(next.unusable) ? next.unusable : null,
    shed,
    cap,
    coverage: coverageOf(rows),
    status: rows.length ? "ok" : "quiet",
    notes: ALERTS_NOTES,
    record: {
      date,
      reads: priorReads + 1,

      firstReadAt: reset
        ? readAt
        : (heldRecord && typeof heldRecord.firstReadAt === "string" && heldRecord.firstReadAt
            ? heldRecord.firstReadAt : null),
      lastReadAt: readAt,
      union: union.length,
      kept: rows.length,

      entered,
      again,
      carried: carriedIn - again,

      everEntered: priorEver + entered,
      shed,
      shedBy,
      byteCap,
      bytes,
      reset,
    },
  };
}
