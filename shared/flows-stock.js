import { parseOptionSymbol } from "./flows-premium.js";

const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v) => (typeof v === "string" && v ? v : null);
const flag = (v) => (v === null || v === undefined ? null : Boolean(v));

const unwrap = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.data)) return raw.data;
  return null;
};

const notAList = (raw, cap) => (raw === null || raw === undefined
  ? { status: "unavailable", reason: "the feed could not be read this run",
      rows: [], seen: 0, cap, shed: 0 }
  : { status: "unreadable",
      reason: "the feed answered with a body this shaper could not read as a list of rows, " +
        "which is a fault on this side rather than a quiet feed",
      rows: [], seen: 0, cap, shed: 0 });

export const STOCK_CAPS = Object.freeze({
  darkpool: 12,
  oiDeltas: 10,
  term: 16,
  ivRank: 60,
});

export const STOCK_NOTES = Object.freeze({
  darkpool:
    "Off-exchange equity trades in this name, reported to the tape and " +
    "ranked here by their own dollar size. These are executions — but the " +
    "tape reports them with delay, attributes no side and no participant, " +
    "and 'dark pool' names the off-exchange reporting facility, not a " +
    "venue. A large print says size moved; it does not say which way " +
    "anyone was positioned.",
  oiDeltas:
    "The vendor's largest contract-level open-interest changes in this " +
    "name. An open-interest change compares two clearing snapshots, so it " +
    "is a settled fact a day late by construction — never today's tape — " +
    "and the vendor's selection rule for which contracts surface here is " +
    "not published.",
  volContext:
    "The implied-volatility term structure is read from this name's own " +
    "listed expiries, with the vendor's implied move beside each; the rank " +
    "series places today's implied volatility against its own past year. " +
    "All of it is derived from quotes, and none of it is a forecast: an " +
    "implied move is what the chain charges, not what will happen.",
  refusals:
    "No feed here says who was active, which side initiated, or why. " +
    "Selections labelled the vendor's use unpublished rules, so absence " +
    "from a list is not evidence of quiet.",
});

export function shapeStockDarkpool(raw, { cap = STOCK_CAPS.darkpool } = {}) {
  const list = unwrap(raw);
  if (list === null) return { ...notAList(raw, cap), unpriced: 0 };
  const rows = [];
  let unpriced = 0;
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const px = num(r.price);
    const size = num(r.size);
    const prem = num(r.premium);
    if (px === null && size === null) continue;
    if (prem === null) { unpriced++; continue; }
    rows.push({
      at: str(r.executed_at),
      px, size, prem,
      bid: num(r.nbbo_bid), ask: num(r.nbbo_ask),
      canceled: flag(r.canceled),
    });
  }
  rows.sort((a, b) => (b.prem - a.prem)
    || ((a.at || "") < (b.at || "") ? -1 : (a.at || "") > (b.at || "") ? 1 : 0)
    || ((b.size ?? -1) - (a.size ?? -1)));
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return {
    status: kept.length ? "ok" : "quiet",
    rows: kept, seen, cap,
    shed: seen - kept.length,
    unpriced,
  };
}

export function shapeStockOiChange(raw, { cap = STOCK_CAPS.oiDeltas } = {}) {
  const list = unwrap(raw);
  if (list === null) return notAList(raw, cap);
  const rows = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const oc = str(r.option_symbol);
    const parsed = oc ? parseOptionSymbol(oc) : null;

    const ratio = num(r.oi_change);
    const diff = num(r.oi_diff_plain);
    if (!parsed || (ratio === null && diff === null)) continue;
    rows.push({
      oc,
      cp: parsed.type, k: parsed.strike, exp: parsed.expiry,
      ratio, diff,
      currOi: num(r.curr_oi), prevOi: num(r.last_oi),
      vol: num(r.volume), trades: num(r.trades),
      avgPx: num(r.avg_price),
      pctOfTotal: num(r.percentage_of_total),

      oiUpDays: num(r.days_of_oi_increases),
      volGtOiDays: num(r.days_of_vol_greater_than_oi),
    });
  }

  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

const dayDiff = (from, to) => {
  const a = Date.parse(String(from || "").slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(String(to || "").slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
};

export function shapeTermStructure(raw, { cap = STOCK_CAPS.term, sessionDate = null } = {}) {
  const list = unwrap(raw);
  if (list === null) return notAList(raw, cap);
  const rows = [];
  let expired = 0;
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const expiry = str(r.expiry);
    const vol = num(r.volatility);
    if (!expiry || vol === null) continue;
    const counted = sessionDate ? dayDiff(sessionDate, expiry) : null;
    if (counted !== null && counted <= 0) { expired++; continue; }
    rows.push({
      expiry,
      dte: counted !== null ? counted : num(r.dte),
      vol,
      impliedMove: num(r.implied_move),
      impliedMovePerc: num(r.implied_move_perc),
    });
  }

  rows.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length,
    ...(sessionDate ? { dteFrom: sessionDate } : {}), ...(expired ? { expired } : {}) };
}

export function shapeIvRank(raw, { cap = STOCK_CAPS.ivRank, sessionDate = null } = {}) {
  const list = unwrap(raw);
  if (list === null) return notAList(raw, cap);
  const rows = [];
  let after = 0;
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const date = str(r.date);
    if (!date) continue;
    if (sessionDate && date.slice(0, 10) > sessionDate) { after++; continue; }
    const row = {
      date,
      vol: num(r.volatility),

      rank1y: num(r.iv_rank_1y),
      close: num(r.close),
    };
    if (row.vol === null && row.rank1y === null) continue;
    rows.push(row);
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return {
    status: kept.length ? "ok" : "quiet",
    rows: kept, seen, cap,
    shed: seen - kept.length,
    rankUnit: "percent 0-100, as published",
    ...(after ? { afterSession: after } : {}),
  };
}

export function buildVolContext(termRaw, ivRankRaw, { sessionDate = null } = {}) {
  const term = shapeTermStructure(termRaw, { sessionDate });
  const ivRank = shapeIvRank(ivRankRaw, { sessionDate });
  if (term.status === "ok" || ivRank.status === "ok") return { status: "ok", term, ivRank };
  const HALF = { unreadable: "answered with a body this side could not read",
    unavailable: "could not be read this run", quiet: "was read and holds nothing" };
  const status = term.status === "unreadable" || ivRank.status === "unreadable" ? "unreadable"
    : term.status === "unavailable" || ivRank.status === "unavailable" ? "unavailable"
    : "quiet";
  const reason = status === "quiet" ? undefined
    : "the term structure " + HALF[term.status] + "; the IV rank history " + HALF[ivRank.status];
  return reason === undefined ? { status, term, ivRank } : { status, reason, term, ivRank };
}
