/* =============================================================
   flows-stock.js — the per-name deep feeds: off-exchange prints,
   contract-level open-interest deltas, and the volatility context
   (term structure + IV rank history), shaped for the card.

   FIELD PROVENANCE — OBSERVED, NOT DOCUMENTED. Every field below
   was read off the 2026-08-31 15:35 UTC live probes' first-row key
   dumps (see meta.probes of that run), which is this repository's
   standard for building a renderer's diet: the vendor's spec marks
   half the OI-change fields "ToBeDone" and has been wrong five
   times. Fields the probe did not show are not read.

   VOCABULARY, PER PANEL. The dark pool rows are reported EQUITY
   EXECUTIONS — "print" and "trade" are accurate and allowed HERE,
   with the same refusals as everywhere: no side attribution, no
   identity, no intent. The OI panel's headline caveat is time: an
   open-interest change compares two clearing snapshots and is a
   settled fact A DAY LATE by construction, never today's tape.
   The volatility panels are derived from quotes and state no
   forecast.
   ============================================================= */

import { parseOptionSymbol } from "./flows-premium.js";

/* Absent in, absent out — the house idiom, for the house reason. */
const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v) => (typeof v === "string" && v ? v : null);
const flag = (v) => (v === null || v === undefined ? null : Boolean(v));

const unwrap = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  return [];
};

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

/* ---------- off-exchange prints --------------------------------- */

/**
 * Largest recent off-exchange prints by premium. The ordering is OURS to
 * claim (premium is on every kept row, the tie-break is total), unlike the
 * vendor-ranked feeds — and rows without a premium cannot be ranked by one,
 * so they are counted and dropped rather than seated arbitrarily.
 */
export function shapeStockDarkpool(raw, { cap = STOCK_CAPS.darkpool } = {}) {
  const rows = [];
  let unpriced = 0;
  for (const r of unwrap(raw)) {
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

/* ---------- contract-level OI deltas ---------------------------- */

export function shapeStockOiChange(raw, { cap = STOCK_CAPS.oiDeltas } = {}) {
  const rows = [];
  for (const r of unwrap(raw)) {
    if (!r || typeof r !== "object") continue;
    const oc = str(r.option_symbol);
    const parsed = oc ? parseOptionSymbol(oc) : null;
    /* TWO READINGS, TWO NAMES, BECAUSE THE VENDOR'S ONE NAME IS NOT WHAT IT
       LOOKS LIKE. `oi_change` reads like a difference and is a RATIO. The
       vendor's own example settles it twice over (docs/uw-openapi.yaml):

         curr_oi 35207, last_oi 2119  -> oi_change 15.6149..., oi_diff_plain 33088
         curr_oi 33253, last_oi 27361 -> oi_change  0.2153..., oi_diff_plain  5892

       (35207-2119)/2119 = 15.6149 and (33253-27361)/27361 = 0.2153, so
       oi_change is (curr-last)/last and oi_diff_plain is the difference in
       contracts.

       This shaper published oi_change as `change`, and both renderers drew it
       as a signed integer under a contracts header. A contract whose open
       interest went 2119 to 35207 printed "+16"; one that grew 21.5% printed
       "+0" — a measured rise rendered as no change at all.

       THE COUNT IS NOT DERIVED WHEN THE VENDOR OMITS IT. curr-last would give
       the same number, but then one field would carry two provenances, which
       is exactly the confusion being fixed. Absent stays absent and the column
       says so. */
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
      /* Two fields the market-wide feed does not carry — observed on the
         per-name probe only. Streaks are the vendor's own counters. */
      oiUpDays: num(r.days_of_oi_increases),
      volGtOiDays: num(r.days_of_vol_greater_than_oi),
    });
  }
  /* VENDOR ORDER PRESERVED — the selection and ranking are the vendor's. */
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

/* ---------- volatility context: term structure + IV rank -------- */

export function shapeTermStructure(raw, { cap = STOCK_CAPS.term } = {}) {
  const rows = [];
  for (const r of unwrap(raw)) {
    if (!r || typeof r !== "object") continue;
    const expiry = str(r.expiry);
    const vol = num(r.volatility);
    if (!expiry || vol === null) continue;
    rows.push({
      expiry,
      dte: num(r.dte),
      vol,
      impliedMove: num(r.implied_move),
      impliedMovePerc: num(r.implied_move_perc),
    });
  }
  /* Expiry ascending — the calendar is ours to claim. A null dte sorts by
     expiry string, which agrees with it whenever both exist. */
  rows.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

export function shapeIvRank(raw, { cap = STOCK_CAPS.ivRank } = {}) {
  const rows = [];
  for (const r of unwrap(raw)) {
    if (!r || typeof r !== "object") continue;
    const date = str(r.date);
    if (!date) continue;
    const row = {
      date,
      vol: num(r.volatility),
      /* iv_rank_1y observed 0..100 on the live probe (57.5-style values).
         Published as observed under a name that says so — NOT rescaled:
         this vendor's rank fields have burned a "1352% of its year" once
         already, so the unit travels with the number to the renderer. */
      rank1y: num(r.iv_rank_1y),
      close: num(r.close),
    };
    if (row.vol === null && row.rank1y === null) continue;
    rows.push(row);
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return {
    status: kept.length ? "ok" : "quiet",
    rows: kept, seen, cap,
    shed: seen - kept.length,
    rankUnit: "percent 0-100, as published",
  };
}

/**
 * The card's volatility-context panel: one term curve and one rank series,
 * each surviving the other's absence — a name with a curve but no rank
 * history is half a panel, not an unavailable one.
 */
export function buildVolContext(termRaw, ivRankRaw) {
  const term = shapeTermStructure(termRaw);
  const ivRank = shapeIvRank(ivRankRaw);
  const status = term.status === "ok" || ivRank.status === "ok" ? "ok" : "quiet";
  return { status, term, ivRank };
}
