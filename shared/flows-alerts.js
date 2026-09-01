/* =============================================================
   flows-alerts.js — the vendor's flow alerts, shaped and ranked.

   WHAT A ROW IS, precisely, because everything else here follows
   from it: one row is one ALERT — a window of activity in ONE
   contract that one of the vendor's own rules flagged. The vendor
   states the window (start_time..end_time), a trade count, a total
   size, a total premium and its ask-side/bid-side split, and a set
   of flags (sweep, floor, single-leg, all-opening). That is more
   than the chain counter has ever carried — a size, a span, a side
   — and it is still NOT the tape: a row aggregates trade_count
   executions, so it is never "a trade", and the page built on it
   may not call it one.

   THE SELECTION IS THE VENDOR'S, AND THAT IS THE HEADLINE CAVEAT.
   These rows exist because a rule named in `alert_rule` fired, and
   the rules' definitions are the vendor's own — not published, not
   observable, not reproducible from this payload. The population is
   therefore "what the vendor chose to flag", not "the most unusual
   activity in the market", and the notes say so in those words.
   Ranking INSIDE that population by its own published premium adds
   no new assumption; treating the population as complete would.

   FIELD PROVENANCE: the field set below was not taken from the
   vendor's documentation — documentation has been wrong five times
   in this repo — but from the probe's first-row key dumps on three
   separate live runs (2026-08-27 twice, 2026-08-28). Fields the
   probe saw only sometimes (strike, price, iv_start/iv_end,
   total_size, option_chain) are treated as optional everywhere.
   ============================================================= */

import { parseOptionSymbol } from "./flows-premium.js";

/* Absent in, absent out — Number(null) is 0 and a confident zero is the
   house defect. Same idiom as flows-scores.js, for the same reason. */
const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/* A flag the vendor did not send is NOT false. `has_sweep: false` says the
   vendor looked and found none; an absent key says nothing was asked. The
   two must stay distinguishable all the way to the page, where null renders
   as an em dash and false as a plain "no". */
const flag = (v) => (v === null || v === undefined ? null : Boolean(v));

/** Rows the pooled payload carries. A choice, published as `cap`. */
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
  refusals:
    "No intent and no identity: nothing here says who was active or why, " +
    "and no flag makes that observable. Rows are windows, not executions, " +
    "so no number here is an execution price either.",
});

/**
 * One vendor alert row, shaped for publication. Null on an unusable row
 * (no ticker, or nothing measurable on it at all).
 */
export function alertRow(raw, { stageOf } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const t = typeof raw.ticker === "string" && raw.ticker ? raw.ticker : null;
  if (!t) return null;

  const oc = typeof raw.option_chain === "string" && raw.option_chain
    ? raw.option_chain : null;
  const parsed = oc ? parseOptionSymbol(oc) : null;

  const prem = num(raw.total_premium);
  const size = num(raw.total_size);
  const trades = num(raw.trade_count);
  /* A row with no premium, no size and no count measures nothing this
     surface publishes; shaping it would print a row of dashes. */
  if (prem === null && size === null && trades === null) return null;

  return {
    t,
    oc,
    /* Derived from the option symbol by the same parser the premium desk
       uses — one spelling of one relation. Null when the vendor sent no
       symbol or an unparseable one, and the coverage counts say how often. */
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
    /* The vendor's own ratio, carried under the vendor's name. Recomputing
       it from oi here would create a second spelling of a quantity whose
       denominator's as-of the vendor does not state. */
    voi: num(raw.volume_oi_ratio),
    ivStart: num(raw.iv_start),
    ivEnd: num(raw.iv_end),
    px: num(raw.underlying_price),
    spanStart: typeof raw.start_time === "string" ? raw.start_time : null,
    spanEnd: typeof raw.end_time === "string" ? raw.end_time : null,
    rule: typeof raw.alert_rule === "string" && raw.alert_rule ? raw.alert_rule : null,
    /* Where the name stood in the board's own funnel, so a reader can see
       at a glance whether the flagged name is one the board scores at all. */
    st: typeof stageOf === "function" ? (stageOf(t) || "foreign") : null,
  };
}

/** Rows the movers band carries. A choice, published as `cap` beside it. */
export const ALERT_BAND_ROWS = 8;

/**
 * The per-contract band for the movers panel, cut from ALREADY-SHAPED alert
 * rows (buildFlowAlerts().rows — premium-ranked with a total tie-break, so
 * this function adds no ordering of its own and stays deterministic for free).
 *
 * WHY THIS EXISTS: the movers premium lists are `byName` because the screener
 * reports whole-symbol net premium, and for months a comment said contract-
 * level ranking "needs a flow-alerts endpoint this key does not reach". The
 * feed has since been proven reachable and is fetched every run — this band
 * is that stale sentence retired. It stays the VENDOR'S selection: the band
 * ranks inside what the alert rules flagged, never the whole tape, and the
 * basis string on the payload says so.
 */
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

/**
 * The published feed: shaped, ranked by the vendor's own premium inside the
 * vendor's own selection, capped with the shed counted.
 *
 * THE SHAPER OWNS THE ENVELOPE, AND IT LEARNED THAT THE EXPENSIVE WAY.
 * This function accepted only a bare array, so the two writers of the
 * `flowalerts` key had to agree, out of band, on who unwrapped. They did not.
 * The nightly pipeline's uw() returns `body.data` already unwrapped; the
 * worker's uwFetch() returns the parsed body verbatim. Handed
 * `{data:[...60 rows...]}`, the `Array.isArray` guard below iterated NOTHING
 * and returned a well-formed, entirely empty feed — and the cron's unguarded
 * spread wrote that over sixty real rows, every fifteen minutes, all session.
 * The Overview then reported "FLAGGED WINDOWS 0" over 569 screened names: a
 * confident claim about the market manufactured by a type check.
 *
 * The guard is now an UNWRAP rather than a filter, so a caller cannot get the
 * envelope wrong. Putting it here rather than at the two call sites is the
 * point: the shaper is the only place that knows what a row is, and one
 * spelling in one function removes the class of bug instead of this instance.
 */
export function buildFlowAlerts(rawRows, { stageOf, cap = ALERT_ROWS } = {}) {
  const shaped = [];
  let unusable = 0;
  const incoming = Array.isArray(rawRows)
    ? rawRows
    : (rawRows && typeof rawRows === "object" && Array.isArray(rawRows.data))
      ? rawRows.data
      : [];
  for (const raw of incoming) {
    const row = alertRow(raw, { stageOf });
    if (row) shaped.push(row);
    else unusable++;
  }

  /* Premium descending, rows without one after those with one (they are
     still alerts; they just cannot be ranked by a number they lack), ties
     broken totally so two runs over one response publish identical bytes. */
  const byName = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)
    || ((a.oc || "") < (b.oc || "") ? -1 : (a.oc || "") > (b.oc || "") ? 1 : 0);
  shaped.sort((a, b) => {
    if (a.prem === null && b.prem === null) {
      return ((b.size ?? -1) - (a.size ?? -1)) || byName(a, b);
    }
    if (a.prem === null) return 1;
    if (b.prem === null) return -1;
    return (b.prem - a.prem) || byName(a, b);
  });

  const seen = shaped.length;
  const rows = shaped.slice(0, cap);

  const count = (f) => rows.filter(f).length;
  return {
    rows,
    seen,
    unusable,
    shed: Math.max(0, seen - rows.length),
    cap,
    coverage: {
      withPremium: count((r) => r.prem !== null),
      withSpan: count((r) => r.spanStart !== null && r.spanEnd !== null),
      withContract: count((r) => r.cp !== null),
      sweeps: count((r) => r.sweep === true),
      opening: count((r) => r.opening === true),
      calls: count((r) => r.cp === "C"),
      puts: count((r) => r.cp === "P"),
    },
    status: rows.length ? "ok" : "quiet",
    notes: ALERTS_NOTES,
  };
}
