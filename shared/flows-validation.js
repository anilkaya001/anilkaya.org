import { scoreSessionAt } from "./flows-record.js";

/** Rank missing outcome work from archived selections, never today's winners. */
export function missingOutcomePlan(boards, closes, calendar, horizons) {
  const index = new Map(calendar.map((d, i) => [d, i]));
  const missing = new Map();
  for (const b of boards) {
    const i = index.get(b.d);
    if (i === undefined) continue;
    for (const k of horizons) {
      const exit = calendar[i + k];
      if (!exit) continue;
      for (const r of b.rows || []) {
        if (!r?.t || !(r.px > 0)) continue;
        if (closes.get(r.t)?.get(exit) > 0) continue;
        if (!missing.has(r.t)) missing.set(r.t, new Set());
        missing.get(r.t).add(exit);
      }
    }
  }
  return [...missing].map(([ticker, dates]) => ({ticker, dates: [...dates].sort()}))
    .sort((a, b) => b.dates.length - a.dates.length || a.ticker.localeCompare(b.ticker));
}

export async function recoverOutcomes(plan, closes, fetchCandles, {
  cap = 30, allowNext = () => true,
} = {}) {
  const result = {needed: plan.length, attempted: 0, recoveredDates: 0, failed: 0, cap};
  for (const item of plan.slice(0, cap)) {
    if (!allowNext()) break;
    result.attempted++;
    try {
      const candles = await fetchCandles(item.ticker);
      if (!Array.isArray(candles)) throw new Error("Invalid candle response");
      for (const c of candles) {
        const d = String(c?.start_time || c?.end_time || c?.date || "").slice(0,10);
        const value = c?.close === null || c?.close === "" ? NaN : Number(c?.close);
        if (!item.dates.includes(d) || !Number.isFinite(value) || value <= 0) continue;
        if (!closes.has(item.ticker)) closes.set(item.ticker, new Map());
        if (!(closes.get(item.ticker).get(d) > 0)) result.recoveredDates++;
        closes.get(item.ticker).set(d, value);
      }
    } catch { result.failed++; }
  }
  return result;
}

/** Descriptive validation: no probability of success or significance claim.
 * Non-overlapping windows are selected on dates BEFORE observing returns.
 * Repeated names and common market shocks can still induce dependence.
 */
export function validateRecord(boards, closes, calendar, {horizons = [1,5,10,21], epoch = null} = {}) {
  const index = new Map(calendar.map((d, i) => [d, i]));
  const dated = new Map();
  for (const b of boards) {
    if (epoch && b.d < epoch) continue;
    if (!dated.has(b.d)) dated.set(b.d, {});
    dated.get(b.d)[b.side] = b.rows || [];
  }
  const dates = [...dated.keys()].sort();
  return {
    status: "research-only",
    basis: "Archived selections; reference-close price returns. Boards are published after their reference close, so these are not executable trade returns.",
    uncertainty: "Overlapping horizons and repeated names are dependent. Legacy standard errors assume independence and are not confidence intervals. Disjoint windows below remove holding-period overlap only.",
    costs: "No transaction costs, dividends, borrow costs or executable fills; corporate-action price adjustments have not been independently verified. No claim of net profitability or calibrated win probability.",
    horizons: horizons.map(k => {
      let names = 0, measured = 0, lost = 0, hits = 0, closed = 0;
      let nextStart = -1, windows = 0, disjointMeasured = 0, sum = 0;
      for (const d of dates) {
        const i = index.get(d);
        if (i === undefined || i + k >= calendar.length) continue;
        const s = scoreSessionAt(dated.get(d), closes, calendar, index, d, k);
        if (s.state !== "ok") continue;
        closed++; names += s.names; measured += s.measured; lost += s.lost; hits += s.hits;
        if (i >= nextStart) {
          nextStart = i + k; windows++;
          if (s.ls !== null) { sum += s.ls; disjointMeasured++; }
        }
      }
      return {k, closed, names, measured, lost,
        coverage: names ? measured / names : null,
        hitLower: names ? hits / names : null,
        hitUpper: names ? (hits + lost) / names : null,
        disjointWindows: windows, disjointMeasured,
        disjointSpread: disjointMeasured ? sum / disjointMeasured : null};
    }),
  };
}
