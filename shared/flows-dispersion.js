import { sampleVar } from "./flows-stats.js";

export const DISPERSION_VERSION = 1;
export const IV_DAYS = 30;
export const WINDOWS = Object.freeze([21, 63]);
export const TRADING_DAYS = 252;
export const MIN_MEMBERS = 20;
export const MIN_WEIGHT_COVERED = 0.6;
export const PARTIAL_WEIGHT_COVERED = 0.85;
export const IMPLIED_OK_WEIGHT_COVERED = 0.9;
export const IV_MIN = 0.02;
export const IV_MAX = 3;
export const CALENDAR_WEIGHT = 0.8;

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const round = (x, d) => (fin(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

export function indexWeights(stocks) {
  const sum = new Map();
  for (const s of Array.isArray(stocks) ? stocks : []) {
    if (s && typeof s.t === "string" && fin(s.w) && s.w > 0) sum.set(s.t, (sum.get(s.t) || 0) + s.w);
  }
  const total = [...sum.values()].reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [];
  return [...sum].map(([t, w]) => ({ t, w: w / total })).sort((a, b) => b.w - a.w || (a.t < b.t ? -1 : 1));
}

export const ivUsable = (iv) => fin(iv) && iv >= IV_MIN && iv <= IV_MAX;

export function impliedCorrelation({ indexIv, members, days = IV_DAYS }) {
  const list = Array.isArray(members) ? members : [];
  const base = { days, indexIv: ivUsable(indexIv) ? round(indexIv, 4) : null, members: list.length };
  const excluded = { event: 0, noIv: 0 };
  let covered = 0, wCovered = 0, wExcluded = 0, s1 = 0, s2 = 0, a1 = 0;
  for (const m of list) {
    if (m.event) { excluded.event += 1; wExcluded += m.w; continue; }
    if (!ivUsable(m.iv)) { excluded.noIv += 1; wExcluded += m.w; continue; }
    covered += 1; wCovered += m.w;
    a1 += m.w * m.iv;
  }
  const avgIv = wCovered > 0 ? a1 / wCovered : null;
  const cover = { covered, weightCovered: round(wCovered, 4), weightExcluded: round(wExcluded, 4), excluded };
  const out = { ...base, ...cover, rho: null, raw: null, clamped: false, avgIv: round(avgIv, 4), ratio: null, why: null, imputed: 0 };
  if (!ivUsable(indexIv)) return { ...out, why: "index-iv" };
  if (covered < MIN_MEMBERS || wCovered < MIN_WEIGHT_COVERED) return { ...out, why: "coverage" };
  let imputed = 0;
  for (const m of list) {
    const skip = m.event || !ivUsable(m.iv);
    const iv = skip ? avgIv : m.iv;
    if (skip) imputed += 1;
    s1 += m.w * iv;
    s2 += m.w * m.w * iv * iv;
  }
  const den = s1 * s1 - s2;
  if (!(den > 0)) return { ...out, imputed, why: "degenerate" };
  const raw = (indexIv * indexIv - s2) / den;
  const rho = Math.min(1, Math.max(-1, raw));
  return { ...out, imputed, rho: round(rho, 4), raw: round(raw, 4), clamped: rho !== raw, ratio: avgIv ? round(indexIv / avgIv, 4) : null };
}

export function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1], b = closes[i];
    out.push(fin(a) && fin(b) && a > 0 && b > 0 ? Math.log(b / a) : null);
  }
  return out;
}

export function realisedCorrelation({ members, window }) {
  const list = Array.isArray(members) ? members : [];
  const excluded = { noBars: 0, flat: 0, break: 0 };
  const used = [];
  let wExcluded = 0;
  for (const m of list) {
    if (m.broken) { excluded.break += 1; wExcluded += m.w; continue; }
    const r = Array.isArray(m.r) ? m.r.slice(-window) : [];
    if (r.length < window || r.some((x) => !fin(x))) { excluded.noBars += 1; wExcluded += m.w; continue; }
    const v = sampleVar(r);
    if (!(v > 0)) { excluded.flat += 1; wExcluded += m.w; continue; }
    used.push({ w: m.w, r, v, sd: Math.sqrt(v) });
  }
  const wCovered = used.reduce((a, m) => a + m.w, 0);
  const out = {
    window, members: list.length, covered: used.length, weightCovered: round(wCovered, 4), weightExcluded: round(wExcluded, 4), excluded,
    rho: null, avgVol: null, why: null,
  };
  if (used.length < MIN_MEMBERS || wCovered < MIN_WEIGHT_COVERED) return { ...out, why: "coverage" };
  const portfolio = [];
  for (let t = 0; t < window; t++) {
    let p = 0;
    for (const m of used) p += m.w * m.r[t];
    portfolio.push(p);
  }
  const s1 = used.reduce((a, m) => a + m.w * m.sd, 0);
  const s2 = used.reduce((a, m) => a + m.w * m.w * m.v, 0);
  const den = s1 * s1 - s2;
  if (!(den > 0)) return { ...out, why: "degenerate" };
  const rho = (sampleVar(portfolio) - s2) / den;
  return { ...out, rho: round(Math.min(1, Math.max(-1, rho)), 4), avgVol: round((s1 / wCovered) * Math.sqrt(TRADING_DAYS), 4) };
}

export function commonCalendar(seriesByTicker, weights, need) {
  const total = new Map();
  let all = 0;
  for (const [t, w] of weights) {
    const s = seriesByTicker.get(t);
    if (!s || !s.length) continue;
    all += w;
    for (const [d] of s) total.set(d, (total.get(d) || 0) + w);
  }
  const dates = [...total].filter(([, w]) => w >= CALENDAR_WEIGHT * all).map(([d]) => d).sort();
  return dates.slice(-need);
}

export function alignReturns(seriesByTicker, calendar) {
  const out = new Map();
  for (const [t, s] of seriesByTicker) {
    const at = new Map(s);
    out.set(t, logReturns(calendar.map((d) => (at.has(d) ? at.get(d) : null))));
  }
  return out;
}

const breakIn = (breaks, t, after, through) => {
  const list = breaks && typeof breaks.get === "function" ? breaks.get(t) : null;
  return Array.isArray(list) && list.some((d) => typeof d === "string" && d > after && d <= through);
};

export function buildDispersion({ sessionDate, generatedAt, source, indexIv, members, series, breaks = null }) {
  const need = Math.max(...WINDOWS) + 1;
  const weights = new Map(members.map((m) => [m.t, m.w]));
  const calendar = commonCalendar(series, weights, need);
  const returns = alignReturns(series, calendar);
  const withReturns = members.map((m) => ({ ...m, r: returns.get(m.t) || null }));
  const implied = impliedCorrelation({ indexIv, members });
  const realised = {};
  const crp = {};
  for (const window of WINDOWS) {
    const start = calendar.length > window ? calendar[calendar.length - window - 1] : null;
    const flagged = withReturns.map((m) => ({ ...m, broken: Boolean(start && breakIn(breaks, m.t, start, calendar[calendar.length - 1])) }));
    realised[window] = realisedCorrelation({ members: flagged, window });
    crp[window] = fin(implied.rho) && fin(realised[window].rho) ? round(implied.rho - realised[window].rho, 4) : null;
  }
  const impliedOk = fin(implied.rho);
  const realisedOk = WINDOWS.some((w) => fin(realised[w].rho));
  const partial = (impliedOk && implied.weightCovered < IMPLIED_OK_WEIGHT_COVERED) || WINDOWS.some((w) => fin(realised[w].rho) && realised[w].weightCovered < PARTIAL_WEIGHT_COVERED);
  return {
    v: DISPERSION_VERSION,
    status: impliedOk && realisedOk ? (partial ? "partial" : "ok") : impliedOk || realisedOk ? "partial" : "withheld",
    sessionDate, generatedAt, source,
    asOf: calendar.length ? calendar[calendar.length - 1] : null,
    sessions: calendar.length,
    implied, realised, crp,
    units: { rho: "weighted average pairwise correlation, -1 to 1", iv: "annualised fraction", vol: "annualised fraction", crp: "implied minus realised, correlation points as a fraction" },
    notes: {
      implied: "Implied correlation is the weighted average pairwise correlation that reproduces the index's 30-day implied variance from the members' own 30-day implied variances. A member reporting inside the 30 days carries an earnings jump in its implied variance, and a member with no usable implied volatility has none to give, so each is counted in coverage and stands in the members' side at the covered members' weighted average implied volatility, which keeps the members' side on the index's full weight. What remains is the excluded member's own earnings variance, which stays in the index, and the gap between its volatility and that average: a few correlation points when the excluded weight is a few percent to a third (about four points at most in the planted worlds tested), and the status is partial once more than a tenth of the weight is excluded.",
      realised: "Realised correlation is the weighted average pairwise correlation of the members' daily log returns over the window, the same quantity on realised variances. A member with a missing or flat day in the window, or a price break (a split or a change of share class) dated inside it, is left out and counted.",
      crp: "The correlation risk premium here is implied minus realised on matching or longer windows. It is a description of the options market's price of correlation, not a forecast or a recommendation.",
    },
  };
}
