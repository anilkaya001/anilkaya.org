/* =============================================================
   flows-pulse.js — the market-wide pulse: seven cheap vendor
   feeds, shaped into one pooled payload.

   WHY ONE KEY. Each feed here is a single market-wide call — the
   whole panel costs seven vendor calls a run, against a deadline
   budget measured in hundreds — and every feed is small once
   capped. Pooling them keeps the worker's key registry flat and
   gives the page one fetch. The price of pooling is that one
   feed's failure must not sink the six others, so every feed is
   shaped independently and carries its own status; the pipeline
   wraps a fetch failure as {status:"unavailable", reason} without
   touching its neighbours.

   FIELD PROVENANCE. Shapes follow docs/uw-openapi.yaml (the
   vendor's own spec, supplied 2026-08-31) — but this repository
   has caught the documentation wrong five times, and this very
   spec marks half the OI-change fields "ToBeDone". So every read
   is defensive (absent-in-absent-out), every feed carries a
   first-row key dump diagnostic in the pipeline, and nothing
   below trusts a documented field enough to invent a value where
   the wire is silent.

   VOCABULARY, PER FEED. The dark pool rows are reported EQUITY
   TRADES — executions, unlike the option feeds' aggregates — so
   "trade" is accurate there and the notes say so. What no feed
   here supports is intent or identity: nothing says who was
   active, which side initiated, or why, and the notes refuse
   those claims in words.
   ============================================================= */

import { parseOptionSymbol } from "./flows-premium.js";
import { REFRESH_CADENCE_MINUTES } from "./flows-freshness.js";

/* Absent in, absent out — Number(null) is 0 and a confident zero is
   the house defect. Same idiom as flows-scores.js and flows-alerts.js. */
const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const str = (v) => (typeof v === "string" && v ? v : null);

/* A flag the vendor did not send is NOT false — flows-alerts.js says why. */
const flag = (v) => (v === null || v === undefined ? null : Boolean(v));

/* The vendor's envelope is ambiguous in its own spec: some routes return a
   bare array, others nest it under `data`. Both are accepted; anything else
   is an empty read, not a throw. */
export const unwrapRows = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  return [];
};

/* Row caps. Choices, published as `cap` on each feed so a capped list can
   never be read as the population. */
export const PULSE_CAPS = Object.freeze({
  tide: 480,        // a 1-minute session is ~390 points; 5-minute is ~78
  totals: 20,       // sessions of market-wide volume context
  oiChange: 20,
  netImpact: 20,
  insiders: 12,     // filing days
  darkpool: 30,
  seasonality: 12,  // months — the natural population, capped only in form
});

export const PULSE_NOTES = Object.freeze({
  tide:
    "The tide is the vendor's own running net premium series for the whole " +
    "market: net call premium, net put premium and net volume per bucket, " +
    "carried exactly as published. This page adds no cumulation, no " +
    "differencing and no smoothing, and a rising line is a statement about " +
    "premium flow, never a forecast of price.",
  totals:
    "Total options volume and premium per session, split call/put, as the " +
    "vendor reports them. The split is the vendor's attribution; no ratio " +
    "here says who initiated anything.",
  oiChange:
    "The vendor's ranking of contracts by open-interest change. The " +
    "selection and the ordering are the vendor's own — its rule is not " +
    "published — so this list ranks inside what the vendor chose to " +
    "surface, not the whole chain universe. An open-interest change is a " +
    "settled fact a day late by construction: it compares two clearing " +
    "snapshots, never today's tape.",
  netImpact:
    "The vendor's ranking of names by net options premium impact. Sign " +
    "is the vendor's attribution against the quote; the definition of " +
    "impact is the vendor's and is not reproducible from this payload.",
  insiders:
    "Aggregate insider filings per filing day: purchase and sale counts " +
    "with their notionals, as disclosed in regulatory filings. Filings " +
    "arrive with statutory delay, so the latest row is the most recent " +
    "FILING day, not the most recent trading day.",
  darkpool:
    "Off-exchange equity trades reported to the tape, largest-premium " +
    "recent prints as the vendor surfaces them. These ARE executions — " +
    "unlike the option feeds' windows — but the tape reports them with " +
    "delay, attributes no side and no participant, and 'dark pool' here " +
    "means the off-exchange reporting facility, not a named venue.",
  seasonality:
    "Monthly market seasonality over the vendor's stated span of years: " +
    "average, median and extreme monthly changes with the share of " +
    "positive closes. A seasonal average is arithmetic over history and " +
    "carries no claim about the month ahead.",
  refusals:
    "No feed here supports intent or identity: nothing says who was " +
    "active or which side initiated. The tide and impact rankings use the " +
    "vendor's unpublished definitions, so absence from a list is not " +
    "evidence of quiet.",
});

/* ---------- per-feed shapers ------------------------------------ */

export function shapeTide(raw, { cap = PULSE_CAPS.tide } = {}) {
  const rows = unwrapRows(raw);
  const points = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const t = str(r.timestamp);
    const callPrem = num(r.net_call_premium);
    const putPrem = num(r.net_put_premium);
    const vol = num(r.net_volume);
    if (!t || (callPrem === null && putPrem === null && vol === null)) continue;
    points.push({ t, callPrem, putPrem, vol });
  }
  const seen = points.length;
  const kept = points.slice(-cap); // a series sheds its OLDEST buckets
  return {
    status: kept.length ? "ok" : "quiet",
    points: kept, seen, cap, shed: Math.max(0, seen - kept.length),
  };
}

export function shapeTotals(raw, { cap = PULSE_CAPS.totals } = {}) {
  const rows = [];
  for (const r of unwrapRows(raw)) {
    if (!r || typeof r !== "object") continue;
    const date = str(r.date);
    if (!date) continue;
    const row = {
      date,
      callPrem: num(r.call_premium), callVol: num(r.call_volume),
      putPrem: num(r.put_premium), putVol: num(r.put_volume),
    };
    if (row.callPrem === null && row.callVol === null &&
        row.putPrem === null && row.putVol === null) continue;
    rows.push(row);
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

export function shapeOiChange(raw, { cap = PULSE_CAPS.oiChange } = {}) {
  const rows = [];
  for (const r of unwrapRows(raw)) {
    if (!r || typeof r !== "object") continue;
    const oc = str(r.option_symbol);
    const parsed = oc ? parseOptionSymbol(oc) : null;
    const t = str(r.underlying_symbol) || (parsed ? parsed.ticker : null);
    const change = num(r.oi_change);
    if (!t || change === null) continue;
    rows.push({
      t, oc,
      cp: parsed ? parsed.type : null,
      k: parsed ? parsed.strike : null,
      exp: parsed ? parsed.expiry : null,
      change,
      currOi: num(r.curr_oi), prevOi: num(r.last_oi),
      vol: num(r.volume), trades: num(r.trades),
      avgPx: num(r.avg_price),
      /* The vendor's own share-of-total, carried under the vendor's name —
         recomputing it here would need a total the response does not state. */
      pctOfTotal: num(r.percentage_of_total),
    });
  }
  /* VENDOR ORDER PRESERVED: the ranking is the vendor's selection, exactly
     as the flow-alerts precedent — re-sorting would claim an ordering rule
     this payload cannot state. */
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

export function shapeNetImpact(raw, { cap = PULSE_CAPS.netImpact } = {}) {
  const rows = [];
  for (const r of unwrapRows(raw)) {
    if (!r || typeof r !== "object") continue;
    const t = str(r.ticker);
    const netPrem = num(r.net_premium);
    if (!t || netPrem === null) continue;
    rows.push({ t, netPrem });
  }
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

export function shapeInsiders(raw, { cap = PULSE_CAPS.insiders } = {}) {
  const rows = [];
  for (const r of unwrapRows(raw)) {
    if (!r || typeof r !== "object") continue;
    const date = str(r.filing_date);
    if (!date) continue;
    const row = {
      date,
      buys: num(r.purchases), sells: num(r.sells),
      buysNotional: num(r.purchases_notional), sellsNotional: num(r.sells_notional),
    };
    if (row.buys === null && row.sells === null &&
        row.buysNotional === null && row.sellsNotional === null) continue;
    rows.push(row);
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

export function shapeDarkpool(raw, { cap = PULSE_CAPS.darkpool } = {}) {
  const rows = [];
  for (const r of unwrapRows(raw)) {
    if (!r || typeof r !== "object") continue;
    const t = str(r.ticker);
    const px = num(r.price);
    const size = num(r.size);
    if (!t || (px === null && size === null)) continue;
    rows.push({
      t,
      at: str(r.executed_at),
      px, size,
      prem: num(r.premium),
      vol: num(r.volume),
      bid: num(r.nbbo_bid), ask: num(r.nbbo_ask),
      /* Cancelled is three-state on purpose: an absent field is not a "no". */
      canceled: flag(r.canceled),
    });
  }
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

export function shapeSeasonality(raw, { cap = PULSE_CAPS.seasonality } = {}) {
  const rows = [];
  for (const r of unwrapRows(raw)) {
    if (!r || typeof r !== "object") continue;
    const month = num(r.month);
    if (month === null || month < 1 || month > 12) continue;
    rows.push({
      month,
      avg: num(r.avg_change), median: num(r.median_change),
      min: num(r.min_change), max: num(r.max_change),
      positivePct: num(r.positive_months_perc),
      years: num(r.years),
    });
  }
  /* Months sort onto the calendar — the one list here with a natural total
     order this payload can state. */
  rows.sort((a, b) => a.month - b.month);
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

/* ---------- the composite --------------------------------------- */

export const PULSE_FEEDS = Object.freeze([
  "tide", "totals", "oiChange", "netImpact", "insiders", "darkpool", "seasonality",
]);

const SHAPERS = {
  tide: shapeTide, totals: shapeTotals, oiChange: shapeOiChange,
  netImpact: shapeNetImpact, insiders: shapeInsiders,
  darkpool: shapeDarkpool, seasonality: shapeSeasonality,
};

/**
 * Assemble the pooled payload from per-feed raw responses. `raws[feed]`
 * is either the vendor's response or {__failed: "<reason>"} — the caller
 * (pipeline or worker cron) decides what a failure is; this module only
 * makes sure a failed feed publishes a reason instead of vanishing, and
 * that its neighbours are untouched by it.
 */
export function buildPulse(raws = {}) {
  /* THE CADENCE RIDES ON THE PAYLOAD, so the browser stops keeping its own copy
     of it.

     assets/js/flows-market.js decides whether this feed's stamp is still worth
     believing — "one cadence plus one cadence of slack: a cron that fired late
     is not yet a cron that stopped firing" — and to do that it needs the number
     the Worker's cron is actually configured for. It could not import
     shared/flows-freshness.js, because shared/ is not served to the browser, so
     it declared its own `var REFRESH_CADENCE_MINUTES = 15` under a comment
     naming the problem: "this constant mirrors it and this comment is the only
     link between them. The right end state is the pulse payload carrying its
     own cadence, which would make this constant deletable."

     This is that end state. A constant duplicated across a boundary with a
     comment for a link is a constant that will eventually disagree with itself,
     and the failure is silent in the worst direction: raise the cron to thirty
     minutes and the page goes on calling a twenty-five-minute-old read stale,
     which trains a reader to ignore the one banner that tells them the data
     stopped moving.

     Imported rather than restated here for exactly the same reason — this file
     is not allowed to be the third copy. */
  const out = { notes: PULSE_NOTES, cadenceMinutes: REFRESH_CADENCE_MINUTES };
  for (const feed of PULSE_FEEDS) {
    const raw = raws[feed];
    if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.__failed) {
      out[feed] = { status: "unavailable", reason: String(raw.__failed) };
      continue;
    }
    if (raw === undefined) {
      out[feed] = { status: "unavailable", reason: "not fetched" };
      continue;
    }
    try {
      out[feed] = SHAPERS[feed](raw);
    } catch (error) {
      out[feed] = { status: "unavailable", reason: "unreadable: " + (error && error.message) };
    }
  }
  return out;
}
