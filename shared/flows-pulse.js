import { parseOptionSymbol } from "./flows-premium.js";
import { REFRESH_CADENCE_MINUTES } from "./flows-freshness.js";

const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const str = (v) => (typeof v === "string" && v ? v : null);

const flag = (v) => (v === null || v === undefined ? null : Boolean(v));

export const unwrapRows = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  return [];
};

export const PULSE_CAPS = Object.freeze({
  tide: 480,
  totals: 20,
  oiChange: 20,
  netImpact: 20,
  insiders: 12,
  darkpool: 30,
  seasonality: 12,
});

export const PULSE_NOTES = Object.freeze({
  tide:
    "The vendor's own net premium series, carried without cumulation, " +
    "differencing or smoothing. A rising line is premium flow, never a " +
    "forecast of price.",
  totals:
    "The call/put split is the vendor's attribution. No ratio here says " +
    "who initiated anything.",
  oiChange:
    "The vendor's selection and ordering, under a rule it does not " +
    "publish — so this ranks inside what the vendor chose to surface, not " +
    "the chain universe. Open-interest change compares two clearing " +
    "snapshots, so it is a day late by construction, never today's tape.",
  netImpact:
    "Sign is the vendor's attribution against the quote. Its definition " +
    "of impact is not reproducible from this payload.",
  insiders:
    "Filings arrive with statutory delay: the latest row is the most " +
    "recent FILING day, not the most recent trading day.",
  darkpool:
    "These ARE executions, unlike the option feeds' windows — but the tape " +
    "reports them with delay and attributes no side and no participant. " +
    "'Dark pool' here is the off-exchange reporting facility, not a venue.",
  seasonality:
    "Arithmetic over history. It carries no claim about the month ahead.",
  refusals:
    "No feed here supports intent or identity: nothing says who was " +
    "active or which side initiated. The tide and impact rankings use the " +
    "vendor's unpublished definitions, so absence from a list is not " +
    "evidence of quiet.",
});

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
  const kept = points.slice(-cap);
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

    const ratio = num(r.oi_change);
    const diff = num(r.oi_diff_plain);
    if (!t || (ratio === null && diff === null)) continue;
    rows.push({
      t, oc,
      cp: parsed ? parsed.type : null,
      k: parsed ? parsed.strike : null,
      exp: parsed ? parsed.expiry : null,
      ratio, diff,
      currOi: num(r.curr_oi), prevOi: num(r.last_oi),
      vol: num(r.volume), trades: num(r.trades),
      avgPx: num(r.avg_price),

      pctOfTotal: num(r.percentage_of_total),
    });
  }

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

      canceled: flag(r.canceled),
    });
  }
  rows.sort((a, b) => ((b.prem ?? -Infinity) - (a.prem ?? -Infinity))
    || ((a.at || "") < (b.at || "") ? -1 : (a.at || "") > (b.at || "") ? 1 : 0));
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length,
    rankedBy: "premium" };
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

  rows.sort((a, b) => a.month - b.month);
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

export const PULSE_FEEDS = Object.freeze([
  "tide", "totals", "oiChange", "netImpact", "insiders", "darkpool", "seasonality",
]);

const SHAPERS = {
  tide: shapeTide, totals: shapeTotals, oiChange: shapeOiChange,
  netImpact: shapeNetImpact, insiders: shapeInsiders,
  darkpool: shapeDarkpool, seasonality: shapeSeasonality,
};

export function buildPulse(raws = {}) {

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
