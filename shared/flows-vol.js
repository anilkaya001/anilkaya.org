export const VOL_SCHEMA_VERSION = 1;

export const TRADING_YEAR = 252;
export const CALENDAR_YEAR = 365;
export const CONE_TENORS = Object.freeze([7, 30, 60, 90, 180, 365]);
export const RICH_CHEAP_WEIGHTS = Object.freeze({ 30: 0.4, 60: 0.3, 90: 0.2, 180: 0.1 });
export const RICH_CHEAP_BAND = 0.15;
export const RV_WINDOWS = Object.freeze([5, 10, 21, 63, 126, 252]);
export const YZ_WINDOWS = Object.freeze([5, 10, 21, 63]);
export const GAP_WINDOWS = Object.freeze([63, 252]);
export const RV_IV_TENOR = Object.freeze({ 5: 7, 21: 30, 63: 90, 126: 180, 252: 365 });
export const RV_SPAN = 504;
export const MIN_HISTORY = 60;
export const CONE_MIN_SAMPLES = 200;
export const TERM_MIN_SAMPLES = 60;
export const EVENT_KINK = 0.3;
export const SKEW_ROLL_DTE = 10;
export const SKEW_WINDOW = 252;
export const SKEW_MOMENTUM_SESSIONS = 5;
export const RR_FLOOR = 0.002;
export const VOV_WINDOW = 60;
export const MIN_IV_CHANGES = 20;
export const HALF_LIFE_BANDS = Object.freeze({ meanReverting: 10, persistent: 40 });
export const VRP_WINDOW = 252;
export const VRP_REALIZED_SESSIONS = 21;
export const IV_BOUNDS = Object.freeze([0.005, 5]);
export const SERIES_KEEP = 60;
export const VRP_SERIES_KEEP = 252;
export const SENTIMENT_SERIES_KEEP = 60;
export const RADAR_KEEP = 20;
export const XSECTION_MIN = 10;

export const VOL_WHY = Object.freeze({
  "read-failed": "the vendor call failed after its retries",
  refused: "the vendor refused the call",
  "unreadable-body": "the vendor answered with a body that could not be read as rows",
  "no-rows": "the vendor answered with no rows",
  "after-session": "every row the vendor sent is dated after this session and was cut",
  "not-read": "this read is not made for names at this depth",
  deadline: "the run passed its deadline before this name was read",
  "short-history": "fewer observations than this statistic needs",
  "input-absent": "an input this value is computed from is absent",
  degenerate: "the inputs have no spread, so the ratio is undefined",
  "few-samples": "the vendor's own sample count is under the trust floor",
  "no-event": "no upcoming earnings date falls inside the listed expiries",
  "no-premium": "the event expiry is not elevated over the one after it, so there is no event variance",
  "calendar-arbitrage": "total variance falls from one expiry to the next",
  "single-expiry": "there is no later expiry to pair with",
  "not-mean-reverting": "the AR(1) coefficient is at or above one",
  oscillating: "the AR(1) coefficient is at or below zero",
  "sign-mismatch": "the 25-delta risk reversal is not positive, so the 10/25 ratio has no crash reading",
  "no-counterpart": "this side has no reading to compare the vendor's with",
  implausible: "the value is outside the plausible range and was dropped",
  "no-monthly": "no standard monthly expiry at least ten days out was found",
  "garch-unfit": "the GARCH fit is unavailable or did not settle",
  "no-neighbours": "no neighbouring expiry has enough samples to compare with",
});

export function vnum(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function round(value, dp) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const n = Number(value.toFixed(dp));
  return Object.is(n, -0) ? 0 : n;
}

export function isoDay(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1] : null;
}

const DAY_MS = 86400000;
const dayMs = (d) => Date.parse(d + "T00:00:00Z");

export function dayDiff(from, to) {
  const a = dayMs(from);
  const b = dayMs(to);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : null;
}

export function addDays(day, n) {
  const t = dayMs(day);
  return Number.isFinite(t) ? new Date(t + n * DAY_MS).toISOString().slice(0, 10) : null;
}

const finite = (xs) => xs.filter((x) => typeof x === "number" && Number.isFinite(x));

export function mean(xs) {
  const v = finite(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function sampleVar(xs) {
  const v = finite(xs);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1);
}

export function sampleSd(xs) {
  const v = sampleVar(xs);
  return v === null ? null : Math.sqrt(Math.max(v, 0));
}

export function median(xs) {
  const v = finite(xs).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function quantileSorted(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function shareAtOrBelow(x, xs) {
  const v = finite(xs);
  if (!v.length || x === null || !Number.isFinite(x)) return null;
  let k = 0;
  for (const y of v) if (y <= x) k++;
  return k / v.length;
}

export function zAgainst(x, xs, { min = MIN_HISTORY } = {}) {
  const v = finite(xs);
  if (x === null || !Number.isFinite(x)) return { z: null, n: v.length, code: "input-absent" };
  if (v.length < min) return { z: null, n: v.length, code: "short-history" };
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = sampleSd(v);
  if (!(sd > 0)) return { z: null, n: v.length, mean: m, sd, code: "degenerate" };
  return { z: (x - m) / sd, n: v.length, mean: m, sd, code: null };
}

export function ols(xs, ys) {
  const pts = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pts.push([xs[i], ys[i]]);
  }
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) * (x - mx); sxy += (x - mx) * (y - my); }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (const [x, y] of pts) { const e = y - intercept - slope * x; sse += e * e; }
  return { slope, intercept, n, se: Math.sqrt(sse / (n - 2)) };
}

export function pearson(xs, ys) {
  const pts = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pts.push([xs[i], ys[i]]);
  }
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function rvEstimators({ closes = [], highLow = [] } = {}) {
  const c = closes.map(vnum).filter((x) => x !== null && x > 0);
  const r = [];
  for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const sd = sampleSd(r);
  const closeToClose = sd === null ? null : sd * Math.sqrt(TRADING_YEAR);
  const zeroMeanRms = r.length ? Math.sqrt((r.reduce((a, b) => a + b * b, 0) / r.length) * TRADING_YEAR) : null;
  const hl = highLow.map(([h, l]) => [vnum(h), vnum(l)]).filter(([h, l]) => h > 0 && l > 0 && h >= l);
  const parkinson = hl.length
    ? Math.sqrt((hl.reduce((a, [h, l]) => a + Math.log(h / l) ** 2, 0) / (4 * hl.length * Math.LN2)) * TRADING_YEAR)
    : null;
  return { closeToClose, zeroMeanRms, parkinson };
}

export function ivRankPercentile(history, current) {
  const h = finite((history || []).map(vnum));
  const x = vnum(current);
  if (!h.length || x === null) return { rank: null, percentile: null };
  const lo = Math.min(...h);
  const hi = Math.max(...h);
  return {
    rank: hi > lo ? (x - lo) / (hi - lo) : null,
    percentile: shareAtOrBelow(x, h),
  };
}

export function varianceRiskPremium(iv, rvForecast) {
  const a = vnum(iv);
  const b = vnum(rvForecast);
  if (a === null || b === null || !(b > 0) || !(a > 0)) {
    return { volPoints: null, variance: null, relativeToForecast: null, ratioVar: null };
  }
  return {
    volPoints: a - b,
    variance: a * a - b * b,
    relativeToForecast: (a - b) / b,
    ratioVar: (a * a) / (b * b),
  };
}

export function eventVariance(front, back) {
  const s1 = vnum(front && front.vol), t1 = vnum(front && front.T);
  const s2 = vnum(back && back.vol), t2 = vnum(back && back.T);
  const none = { diffusiveVol: null, eventSd: null, eventMeanAbs: null };
  if (s1 === null || s2 === null || !(t1 > 0) || !(t2 > t1)) return { ...none, code: "input-absent" };
  const sd2 = (s2 * s2 * t2 - s1 * s1 * t1) / (t2 - t1);
  if (!(sd2 > 0)) return { ...none, code: "calendar-arbitrage" };
  const j2 = s1 * s1 * t1 - sd2 * t1;
  if (!(j2 > 0)) return { ...none, diffusiveVol: Math.sqrt(sd2), code: "no-premium" };
  const j = Math.sqrt(j2);
  return { diffusiveVol: Math.sqrt(sd2), eventSd: j, eventMeanAbs: j * Math.sqrt(2 / Math.PI), code: null };
}

export function forwardVol(near, far) {
  const s1 = vnum(near && near.vol), t1 = vnum(near && near.T);
  const s2 = vnum(far && far.vol), t2 = vnum(far && far.T);
  if (s1 === null || s2 === null || !(t1 > 0) || !(t2 > t1)) return { vol: null, code: "input-absent" };
  const w = s2 * s2 * t2 - s1 * s1 * t1;
  if (!(w > 0)) return { vol: null, code: "calendar-arbitrage" };
  return { vol: Math.sqrt(w / (t2 - t1)), code: null };
}

const OFF_HOURS = new Set(["pr", "po", "pre", "post", "premarket", "postmarket", "afterhours", "after-hours",
  "after_hours", "extended"]);

export function candleDay(row) {
  if (!row || typeof row !== "object") return null;
  return isoDay(row.date) || isoDay(row.start_time) || isoDay(row.end_time);
}

export function isOffHours(row) {
  const m = row && typeof row.market_time === "string" ? row.market_time.trim().toLowerCase() : "";
  return OFF_HOURS.has(m);
}

export function regularSessionRows(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  return list.filter((r) => !isOffHours(r));
}

export function toBars(rows, { sessionDate = null } = {}) {
  const byDay = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = candleDay(r);
    if (!d || (sessionDate && d > sessionDate)) continue;
    const c = vnum(r.close);
    if (!(c > 0)) continue;
    const bar = { d, o: vnum(r.open), h: vnum(r.high), l: vnum(r.low), c, v: vnum(r.volume) };
    const held = byDay.get(d);
    if (!held || (bar.v ?? -1) >= (held.v ?? -1)) byDay.set(d, bar);
  }
  return [...byDay.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

function logReturns(bars) {
  const out = [];
  for (let i = 1; i < bars.length; i++) out.push({ d: bars[i].d, r: Math.log(bars[i].c / bars[i - 1].c) });
  return out;
}

export function rollingVol(returns, n) {
  const out = [];
  if (!(n >= 2) || returns.length < n) return out;
  let s = 0, s2 = 0;
  for (let i = 0; i < returns.length; i++) {
    s += returns[i]; s2 += returns[i] * returns[i];
    if (i >= n) { s -= returns[i - n]; s2 -= returns[i - n] * returns[i - n]; }
    if (i >= n - 1) {
      const v = (s2 - (s * s) / n) / (n - 1);
      out.push({ i, vol: Math.sqrt(Math.max(v, 0) * TRADING_YEAR) });
    }
  }
  return out;
}

export function closeToCloseVol(bars, n) {
  if (!Array.isArray(bars) || bars.length < n + 1) return null;
  const r = logReturns(bars.slice(-(n + 1))).map((x) => x.r);
  const sd = sampleSd(r);
  return sd === null ? null : sd * Math.sqrt(TRADING_YEAR);
}

const ohlcOk = (b) => b && b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0 && b.h >= b.l;

export function yangZhang(bars, n) {
  if (!Array.isArray(bars) || !(n >= 2) || bars.length < n + 1) return { vol: null, code: "short-history" };
  const w = bars.slice(-n);
  const prev = bars.slice(-(n + 1), -1);
  if (!w.every(ohlcOk) || !prev.every((b) => b && b.c > 0)) return { vol: null, code: "input-absent" };
  const o = w.map((b, i) => Math.log(b.o / prev[i].c));
  const c = w.map((b) => Math.log(b.c / b.o));
  const rs = w.map((b) => Math.log(b.h / b.c) * Math.log(b.h / b.o) + Math.log(b.l / b.c) * Math.log(b.l / b.o));
  const k = 0.34 / (1.34 + (n + 1) / (n - 1));
  const s2 = sampleVar(o) + k * sampleVar(c) + (1 - k) * (rs.reduce((a, b) => a + b, 0) / n);
  return { vol: Math.sqrt(Math.max(s2, 0) * TRADING_YEAR), code: null };
}

export function parkinsonVol(bars, n) {
  if (!Array.isArray(bars) || bars.length < n) return { vol: null, code: "short-history" };
  const w = bars.slice(-n);
  if (!w.every(ohlcOk)) return { vol: null, code: "input-absent" };
  const s = w.reduce((a, b) => a + Math.log(b.h / b.l) ** 2, 0);
  return { vol: Math.sqrt((s / (4 * n * Math.LN2)) * TRADING_YEAR), code: null };
}

export function gapShare(bars, n) {
  if (!Array.isArray(bars) || !(n >= 2) || bars.length < n + 1) return { share: null, code: "short-history" };
  const w = bars.slice(-n);
  const prev = bars.slice(-(n + 1), -1);
  if (!w.every((b) => b.o > 0 && b.c > 0) || !prev.every((b) => b.c > 0)) return { share: null, code: "input-absent" };
  const o = w.map((b, i) => Math.log(b.o / prev[i].c));
  const cc = w.map((b, i) => Math.log(b.c / prev[i].c));
  const vo = sampleVar(o);
  const vc = sampleVar(cc);
  if (!(vc > 0)) return { share: null, code: "degenerate" };
  return { share: vo / vc, code: null };
}

export function buildRvPanel(bars, { sessionDate = null, breaks = null } = {}) {
  const b = (bars || []).filter((x) => x && x.c > 0 && (!sessionDate || x.d <= sessionDate));
  if (b.length < 3) {
    return { panel: { status: "unavailable", code: "short-history", reason: VOL_WHY["short-history"], asOf: null }, rolling: new Map() };
  }
  const rets = logReturns(b);
  const r = rets.map((x) => x.r);
  const firstEnd = Math.max(0, r.length - RV_SPAN);
  const rolling = new Map();
  const silent = {};
  const cone = RV_WINDOWS.map((n) => {
    const all = rollingVol(r, n).filter((x) => x.i >= firstEnd + n - 1);
    const values = all.map((x) => x.vol);
    const now = values.length ? values[values.length - 1] : null;
    const sorted = values.slice().sort((a, b2) => a - b2);
    rolling.set(n, sorted);
    const row = { n, ivDays: RV_IV_TENOR[n] || null, now: round(now, 4), count: values.length };
    const enough = values.length >= MIN_HISTORY;
    for (const [key, p] of [["min", 0], ["p10", 0.1], ["p25", 0.25], ["p50", 0.5], ["p75", 0.75], ["p90", 0.9], ["max", 1]]) {
      row[key] = enough ? round(quantileSorted(sorted, p), 4) : null;
    }
    row.pct = enough ? round(shareAtOrBelow(now, values), 4) : null;
    if (now === null) silent["cone." + n + ".now"] = "short-history";
    if (!enough) silent["cone." + n + ".pct"] = "short-history";
    return row;
  });
  const yz = YZ_WINDOWS.map((n) => {
    const v = yangZhang(b, n);
    if (v.vol === null) silent["yz." + n] = v.code;
    return { n, vol: round(v.vol, 4) };
  });
  const gap = GAP_WINDOWS.map((n) => {
    const g = gapShare(b, n);
    if (g.share === null) silent["gap." + n] = g.code;
    return { n, share: round(g.share, 4) };
  });
  const pk = parkinsonVol(b, 21);
  if (pk.vol === null) silent.pk21 = pk.code;
  const panel = {
    status: "ok",
    asOf: b[b.length - 1].d,
    sameSession: sessionDate ? b[b.length - 1].d === sessionDate : null,
    bars: b.length,
    from: b[0].d,
    estimator: "close-to-close sample sd x sqrt(252)",
    cone,
    yz,
    pk21: round(pk.vol, 4),
    cc21: round(closeToCloseVol(b, 21), 4),
    gap,
    breaks: Array.isArray(breaks) ? breaks.length : null,
    units: { vol: "annualised decimal", share: "fraction", count: "rolling windows" },
    silent,
  };
  return { panel, rolling, bars: b };
}

const parsePct = (v) => {
  const x = vnum(v);
  if (x === null) return { pct: null, outOfRange: false };
  if (x >= 0 && x <= 1) return { pct: x, outOfRange: false };
  return { pct: null, outOfRange: true };
};

const plausibleIv = (v) => v !== null && v >= IV_BOUNDS[0] && v <= IV_BOUNDS[1];

export function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray(body.data)) return body.data;
  return null;
}

export function compositeOf(body) {
  const data = body && typeof body === "object" && !Array.isArray(body) ? body.data : null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const history = Array.isArray(data.history) ? data.history : null;
  const latest = data.latest && typeof data.latest === "object" && !Array.isArray(data.latest) ? data.latest : null;
  if (!history && !latest) return null;
  return { history: history || [], latest };
}

export function silentPanel(status, code, extra = {}) {
  return { status, code, reason: VOL_WHY[code] || code, asOf: null, ...extra };
}

export function bodyPanel(body, { rows = rowsOf } = {}) {
  if (body === null || body === undefined) return silentPanel("unavailable", "read-failed");
  const list = rows(body);
  if (list === null) return silentPanel("unreadable", "unreadable-body");
  if (!list.length) return silentPanel("quiet", "no-rows");
  return null;
}

export function buildConePanel(body, { sessionDate = null, rolling = null } = {}) {
  const silentBody = bodyPanel(body);
  if (silentBody) return silentBody;
  const tenors = [];
  let cutAfter = 0, outOfRange = 0, dropped = 0;
  let asOf = null;
  for (const r of rowsOf(body)) {
    if (!r || typeof r !== "object") continue;
    const days = vnum(r.days);
    const d = isoDay(r.date);
    if (d && sessionDate && d > sessionDate) { cutAfter++; continue; }
    const iv = vnum(r.volatility);
    if (!(days > 0) || !plausibleIv(iv)) { dropped++; continue; }
    const p = parsePct(r.percentile);
    if (p.outOfRange) outOfRange++;
    const min = vnum(r.min), q1 = vnum(r.q1), med = vnum(r.median), q3 = vnum(r.q3), max = vnum(r.max);
    const samples = vnum(r.samples);
    if (d && (!asOf || d > asOf)) asOf = d;
    const row = {
      days, iv: round(iv, 4), min: round(min, 4), q1: round(q1, 4), median: round(med, 4), q3: round(q3, 4),
      max: round(max, 4), pct: round(p.pct, 4), samples, firstDate: isoDay(r.first_date),
      iqrPos: q1 !== null && q3 !== null && q3 > q1 ? round((iv - q1) / (q3 - q1), 4) : null,
      rangePos: min !== null && max !== null && max > min ? round((iv - min) / (max - min), 4) : null,
      lowSample: samples === null ? null : samples < CONE_MIN_SAMPLES,
      rvWindow: null, rvPct: null,
    };
    const win = Object.keys(RV_IV_TENOR).map(Number).find((n) => RV_IV_TENOR[n] === days);
    if (win) {
      row.rvWindow = win;
      const sorted = rolling && rolling.get(win);
      row.rvPct = sorted && sorted.length >= MIN_HISTORY ? round(shareAtOrBelow(iv, sorted), 4) : null;
    }
    tenors.push(row);
  }
  if (!tenors.length) {
    return cutAfter ? silentPanel("quiet", "after-session", { cutAfter }) : silentPanel("quiet", "no-rows", { dropped });
  }
  tenors.sort((a, b) => a.days - b.days);
  const at = (days) => tenors.find((t) => t.days === days) || null;
  const silent = {};
  const pctOf = (days) => (at(days) ? at(days).pct : null);
  const ivOf = (days) => (at(days) ? at(days).iv : null);
  const shape = pctOf(7) !== null && pctOf(365) !== null ? pctOf(7) - pctOf(365) : null;
  if (shape === null) silent.coneShape = "input-absent";
  const missing = Object.keys(RICH_CHEAP_WEIGHTS).map(Number).filter((d) => pctOf(d) === null);
  let richCheap = null;
  if (!missing.length) {
    let num = 0, den = 0;
    for (const [d, w] of Object.entries(RICH_CHEAP_WEIGHTS)) { num += w * (pctOf(Number(d)) - 0.5); den += w; }
    richCheap = num / den;
  } else silent.richCheap = "input-absent";
  const slope = ivOf(30) !== null && ivOf(90) > 0 ? ivOf(30) / ivOf(90) - 1 : null;
  const front = ivOf(7) !== null && ivOf(30) > 0 ? ivOf(7) / ivOf(30) - 1 : null;
  if (slope === null) silent.slope30_90 = "input-absent";
  if (front === null) silent.front7_30 = "input-absent";
  for (const t of tenors) {
    if (t.iqrPos === null) silent["tenor." + t.days + ".iqrPos"] = "degenerate";
    if (t.rvWindow && t.rvPct === null) silent["tenor." + t.days + ".rvPct"] = "short-history";
  }
  return {
    status: "ok",
    asOf,
    sameSession: sessionDate && asOf ? asOf === sessionDate : null,
    tenors,
    iv30: ivOf(30),
    pct30: pctOf(30),
    coneShape: round(shape, 4),
    richCheap: round(richCheap, 4),
    view: viewOfRichCheap(richCheap),
    slope30_90: round(slope, 4),
    front7_30: round(front, 4),
    slope30_90ExEvent: null,
    xPct: { slope30_90: null, richCheap: null },
    weights: RICH_CHEAP_WEIGHTS,
    ...(cutAfter ? { cutAfter } : {}),
    ...(outOfRange ? { pctOutOfRange: outOfRange } : {}),
    ...(dropped ? { dropped } : {}),
    units: { iv: "annualised decimal", pct: "fraction 0-1 of the vendor's 1y daily values at or below today",
      iqrPos: "(iv-q1)/(q3-q1), may leave 0-1", richCheap: "weighted mean of (pct-0.5), -0.5..0.5",
      slope: "ratio minus one" },
    silent,
  };
}

export function viewOfRichCheap(x, band = RICH_CHEAP_BAND) {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  return x >= band ? "rich" : x <= -band ? "cheap" : "neutral";
}

export function eventDayOf(earnings) {
  const d = earnings && isoDay(earnings.date);
  if (!d) return null;
  const t = String((earnings && earnings.time) || "").toLowerCase();
  const after = /post|after|amc/.test(t);
  return after ? nextWeekdayOf(d) : d;
}

function nextWeekdayOf(day) {
  let d = addDays(day, 1);
  for (let i = 0; i < 4 && d; i++) {
    const w = new Date(dayMs(d)).getUTCDay();
    if (w !== 0 && w !== 6) return d;
    d = addDays(d, 1);
  }
  return d;
}

export function buildTermPanel(body, { sessionDate = null, earnings = null } = {}) {
  const silentBody = bodyPanel(body);
  if (silentBody) return silentBody;
  const rows = [];
  let expired = 0, cutAfter = 0, dropped = 0;
  let asOf = null;
  for (const r of rowsOf(body)) {
    if (!r || typeof r !== "object") continue;
    const expiry = isoDay(r.expiry);
    const d = isoDay(r.date);
    if (d && sessionDate && d > sessionDate) { cutAfter++; continue; }
    if (!expiry) { dropped++; continue; }
    if (sessionDate && expiry <= sessionDate) { expired++; continue; }
    const iv = vnum(r.volatility);
    if (!plausibleIv(iv)) { dropped++; continue; }
    const dte = sessionDate ? dayDiff(sessionDate, expiry) : vnum(r.dte);
    if (!(dte > 0)) { dropped++; continue; }
    if (d && (!asOf || d > asOf)) asOf = d;
    const q1 = vnum(r.q1), q3 = vnum(r.q3), med = vnum(r.median);
    const samples = vnum(r.samples);
    const p = parsePct(r.percentile);
    rows.push({
      expiry, dte, T: dte / CALENDAR_YEAR, iv,
      min: vnum(r.min), q1, median: med, q3, max: vnum(r.max),
      pct: p.pct, samples, firstDate: isoDay(r.first_date),
      pctOk: samples !== null && samples >= TERM_MIN_SAMPLES,
      zShape: q1 !== null && q3 !== null && med !== null && q3 > q1 ? (iv - med) / (q3 - q1) : null,
    });
  }
  if (!rows.length) {
    return cutAfter ? silentPanel("quiet", "after-session", { cutAfter }) : silentPanel("quiet", "no-rows", { expired, dropped });
  }
  rows.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  const eventDay = eventDayOf(earnings);
  const upcoming = eventDay && (!sessionDate || eventDay > sessionDate) ? eventDay : null;
  const contains = (row) => !!upcoming && upcoming <= row.expiry;
  const eventIndex = upcoming ? rows.findIndex(contains) : -1;
  const silent = {};
  const out = rows.map((row, i) => {
    const fwd = i > 0
      ? forwardVol({ vol: rows[i - 1].iv, T: rows[i - 1].T }, { vol: row.iv, T: row.T })
      : { vol: null, code: "single-expiry" };
    let premium = null;
    if (row.pctOk && row.pct !== null) {
      let prev = null, next = null;
      for (let j = i - 1; j >= 0; j--) if (rows[j].pctOk && rows[j].pct !== null) { prev = rows[j]; break; }
      for (let j = i + 1; j < rows.length; j++) if (rows[j].pctOk && rows[j].pct !== null) { next = rows[j]; break; }
      const nb = [prev, next].filter(Boolean).map((x) => x.pct);
      premium = nb.length ? row.pct - median(nb) : null;
      if (premium === null) silent["expiry." + row.expiry + ".premium"] = "no-neighbours";
    } else silent["expiry." + row.expiry + ".pct"] = "few-samples";
    if (i > 0 && fwd.vol === null) silent["expiry." + row.expiry + ".fwd"] = fwd.code;
    const kink = premium !== null && premium > EVENT_KINK;
    return {
      expiry: row.expiry, dte: row.dte, iv: round(row.iv, 4),
      min: round(row.min, 4), q1: round(row.q1, 4), median: round(row.median, 4), q3: round(row.q3, 4), max: round(row.max, 4),
      pct: row.pctOk ? round(row.pct, 4) : null, pctRaw: round(row.pct, 4), samples: row.samples, firstDate: row.firstDate,
      zShape: round(row.zShape, 4), fwd: round(fwd.vol, 4), premium: round(premium, 4), kink,
      event: contains(row), eventFirst: i === eventIndex,
    };
  });
  const noMove = (code) => ({ diffusiveVol: null, eventSd: null, eventMeanAbs: null, code });
  const eventExpiry = eventIndex >= 0 ? rows[eventIndex].expiry : null;
  const move = eventIndex < 0 ? noMove("no-event")
    : eventIndex + 1 >= rows.length ? noMove("single-expiry")
      : eventVariance({ vol: rows[eventIndex].iv, T: rows[eventIndex].T },
        { vol: rows[eventIndex + 1].iv, T: rows[eventIndex + 1].T });
  if (move.eventSd === null) silent.eventMove = move.code || "input-absent";
  const eventRead = out.find((r) => r.event && r.pct !== null) || null;
  const eventKink = eventRead && eventRead.kink ? eventRead : null;
  return {
    status: "ok",
    asOf,
    sameSession: sessionDate && asOf ? asOf === sessionDate : null,
    expiries: out,
    earnings: upcoming ? { date: isoDay(earnings.date), time: earnings.time || null, eventDay: upcoming } : null,
    eventExpiry,
    eventKink: eventKink ? { expiry: eventKink.expiry, premium: eventKink.premium } : null,
    eventMove: {
      sd: round(move.eventSd, 4), meanAbs: round(move.eventMeanAbs, 4), diffusiveVol: round(move.diffusiveVol, 4),
      front: eventIndex >= 0 ? rows[eventIndex].expiry : null,
      back: eventIndex >= 0 && eventIndex + 1 < rows.length ? rows[eventIndex + 1].expiry : null,
    },
    minSamples: TERM_MIN_SAMPLES,
    kinkThreshold: EVENT_KINK,
    ...(expired ? { expired } : {}),
    ...(cutAfter ? { cutAfter } : {}),
    ...(dropped ? { dropped } : {}),
    units: { iv: "annualised decimal", pct: "fraction 0-1 over the expiry's own listed life, null under the sample floor",
      fwd: "annualised decimal from the previous expiry", premium: "pct minus the median of neighbouring pcts",
      eventMove: "fraction of spot, one sd (sd) and mean absolute (meanAbs)", dte: "calendar days from the session" },
    silent,
  };
}

function thirdFriday(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (5 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + 14)).toISOString().slice(0, 10);
}

export function isStandardMonthly(day, listed = null) {
  const t = dayMs(day);
  if (!Number.isFinite(t)) return false;
  const dt = new Date(t);
  const tf = thirdFriday(dt.getUTCFullYear(), dt.getUTCMonth());
  if (day === tf) return true;
  return day === addDays(tf, -1) && !!listed && !listed.has(tf);
}

export function pickMonthlyExpiry(listed, sessionDate, { rollDte = SKEW_ROLL_DTE } = {}) {
  if (!sessionDate) return { expiry: null, dte: null, rolled: false, source: null, code: "input-absent" };
  const set = new Set((listed || []).map(isoDay).filter((d) => d && d > sessionDate));
  const sorted = [...set].sort();
  let rolled = false;
  for (const d of sorted) {
    if (!isStandardMonthly(d, set)) continue;
    const dte = dayDiff(sessionDate, d);
    if (dte < rollDte) { rolled = true; continue; }
    return { expiry: d, dte, rolled, source: "listed", code: null };
  }
  if (sorted.length) return { expiry: null, dte: null, rolled, source: "listed", code: "no-monthly" };
  const s = new Date(dayMs(sessionDate));
  let skipped = false;
  for (let k = 0; k < 3; k++) {
    const tf = thirdFriday(s.getUTCFullYear(), s.getUTCMonth() + k);
    const dte = dayDiff(sessionDate, tf);
    if (!(dte > 0)) continue;
    if (dte < rollDte) { skipped = true; continue; }
    return { expiry: tf, dte, rolled: skipped, source: "calendar", code: null };
  }
  return { expiry: null, dte: null, rolled: skipped, source: null, code: "no-monthly" };
}

function rrRows(body, delta, sessionDate) {
  const list = rowsOf(body) || [];
  const out = new Map();
  let wrongDelta = 0, cutAfter = 0;
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const d = isoDay(r.date);
    if (!d) continue;
    if (sessionDate && d > sessionDate) { cutAfter++; continue; }
    const dl = vnum(r.delta);
    if (dl !== null && dl !== delta && Math.round(dl * 100) !== delta) { wrongDelta++; continue; }
    const rr = vnum(r.risk_reversal);
    if (rr === null || Math.abs(rr) > 2) continue;
    out.set(d, rr);
  }
  return { map: out, wrongDelta, cutAfter };
}

function skewZ(values, dtes, x, dteNow) {
  const raw = zAgainst(x, values);
  let adj = { z: null, code: raw.code || null, slope: null };
  if (raw.z !== null) {
    const fit = ols(dtes.map((t) => (t > 0 ? Math.log(t) : NaN)), values);
    if (fit && fit.se > 0 && dteNow > 0) {
      adj = { z: (x - (fit.intercept + fit.slope * Math.log(dteNow))) / fit.se, code: null, slope: fit.slope };
    } else adj = { z: null, code: "degenerate", slope: null };
  }
  return { raw, adj };
}

export function buildSkewPanel(body25, body10, { sessionDate = null, expiry = null } = {}) {
  const silentBody = bodyPanel(body25);
  if (silentBody) return { ...silentBody, expiry };
  if (!expiry) return silentPanel("unavailable", "no-monthly");
  const a = rrRows(body25, 25, sessionDate);
  const b = body10 === null || body10 === undefined || rowsOf(body10) === null ? null : rrRows(body10, 10, sessionDate);
  const dates = [...a.map.keys()].sort();
  if (!dates.length) {
    return silentPanel("quiet", a.cutAfter ? "after-session" : "no-rows", { expiry, wrongDelta: a.wrongDelta });
  }
  const series = dates.map((d) => ({
    d, dte: dayDiff(d, expiry), rr25: a.map.get(d), rr10: b ? (b.map.has(d) ? b.map.get(d) : null) : null,
  }));
  const last = series[series.length - 1];
  const hist = series.slice(Math.max(0, series.length - 1 - SKEW_WINDOW), series.length - 1);
  const silent = {};
  const z25 = skewZ(hist.map((s) => s.rr25), hist.map((s) => s.dte), last.rr25, last.dte);
  const h10 = hist.filter((s) => s.rr10 !== null);
  const z10 = last.rr10 !== null
    ? skewZ(h10.map((s) => s.rr10), h10.map((s) => s.dte), last.rr10, last.dte)
    : { raw: { z: null, n: h10.length, code: b ? "input-absent" : "read-failed" }, adj: { z: null, code: "input-absent" } };
  if (z25.raw.z === null) silent.zRaw = z25.raw.code;
  if (z25.adj.z === null) silent.z = z25.adj.code || z25.raw.code;
  if (z10.raw.z === null) silent.z10 = z10.raw.code;
  const back = series.length > SKEW_MOMENTUM_SESSIONS ? series[series.length - 1 - SKEW_MOMENTUM_SESSIONS] : null;
  const mom5 = back ? last.rr25 - back.rr25 : null;
  if (mom5 === null) silent.mom5 = "short-history";
  let crash = null;
  if (last.rr10 === null) silent.crash = "input-absent";
  else if (!(last.rr25 > RR_FLOOR) || !(last.rr10 > 0)) silent.crash = "sign-mismatch";
  else crash = last.rr10 / last.rr25;
  const crashHist = hist.filter((s) => s.rr10 !== null && s.rr25 > RR_FLOOR && s.rr10 > 0).map((s) => s.rr10 / s.rr25);
  const keep = series.slice(-SERIES_KEEP);
  return {
    status: "ok",
    asOf: last.d,
    sameSession: sessionDate ? last.d === sessionDate : null,
    expiry,
    dte: last.dte,
    dteFirst: hist.length ? hist[0].dte : null,
    rr25: round(last.rr25, 5),
    rr10: round(last.rr10, 5),
    tail: last.rr10 !== null ? round(last.rr10 - last.rr25, 5) : null,
    z: round(z25.adj.z !== null ? z25.adj.z : null, 3),
    zBasis: z25.adj.z !== null ? "maturity-adjusted" : null,
    zRaw: round(z25.raw.z, 3),
    z10: round(z10.adj.z !== null ? z10.adj.z : null, 3),
    z10Raw: round(z10.raw.z, 3),
    maturitySlope: round(z25.adj.slope, 5),
    n: z25.raw.n,
    mom5: round(mom5, 5),
    crash: round(crash, 3),
    crashMedian: round(median(crashHist), 3),
    xPct: { rr25: null },
    series: { d: keep.map((s) => s.d), rr25: keep.map((s) => round(s.rr25, 5)), rr10: keep.map((s) => round(s.rr10, 5)) },
    ...(a.wrongDelta ? { wrongDelta: a.wrongDelta } : {}),
    ...(a.cutAfter ? { cutAfter: a.cutAfter } : {}),
    units: { rr: "annualised decimal vol, put iv minus call iv (positive = puts bid)", z: "sd",
      crash: "rr10/rr25 ratio", mom5: "change over five sessions, decimal vol", dte: "calendar days to the fixed expiry" },
    silent,
  };
}

export function buildIvDynamics(body, { sessionDate = null } = {}) {
  const silentBody = bodyPanel(body);
  if (silentBody) return silentBody;
  const pts = [];
  for (const r of rowsOf(body)) {
    if (!r || typeof r !== "object") continue;
    const d = isoDay(r.date);
    if (!d || (sessionDate && d > sessionDate)) continue;
    const iv = vnum(r.volatility);
    if (!plausibleIv(iv)) continue;
    const rank = vnum(r.iv_rank_1y);
    pts.push({ d, iv, rank: rank !== null && rank >= 0 && rank <= 100 ? rank / 100 : null, close: vnum(r.close) });
  }
  if (!pts.length) return silentPanel("quiet", "no-rows");
  pts.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const uniq = [];
  for (const p of pts) if (!uniq.length || uniq[uniq.length - 1].d !== p.d) uniq.push(p); else uniq[uniq.length - 1] = p;
  const last = uniq[uniq.length - 1];
  const silent = {};
  const tail = uniq.slice(-(VOV_WINDOW + 1));
  const dIv = [], dLnIv = [], dLnS = [];
  for (let i = 1; i < tail.length; i++) {
    dIv.push(tail[i].iv - tail[i - 1].iv);
    dLnIv.push(Math.log(tail[i].iv / tail[i - 1].iv));
    dLnS.push(tail[i].close > 0 && tail[i - 1].close > 0 ? Math.log(tail[i].close / tail[i - 1].close) : NaN);
  }
  const enough = dIv.length >= MIN_IV_CHANGES;
  const vov = enough ? sampleSd(dIv) : null;
  const vovRel = enough ? sampleSd(dLnIv) * Math.sqrt(TRADING_YEAR) : null;
  const corr = enough ? pearson(dLnS, dIv) : null;
  if (!enough) { silent.volOfVol = "short-history"; silent.spotVolCorr = "short-history"; }
  let ar = null, halfLife = null;
  if (uniq.length >= MIN_HISTORY) {
    ar = ols(uniq.slice(0, -1).map((p) => p.iv), uniq.slice(1).map((p) => p.iv));
    if (!ar) silent.halfLife = "degenerate";
    else if (ar.slope >= 1) silent.halfLife = "not-mean-reverting";
    else if (ar.slope <= 0) silent.halfLife = "oscillating";
    else {
      const h = -Math.LN2 / Math.log(ar.slope);
      if (h > uniq.length) silent.halfLife = "not-mean-reverting";
      else halfLife = h;
    }
  } else silent.halfLife = "short-history";
  const rp = ivRankPercentile(uniq.map((p) => p.iv), last.iv);
  return {
    status: "ok",
    asOf: last.d,
    sameSession: sessionDate ? last.d === sessionDate : null,
    n: uniq.length,
    iv: round(last.iv, 4),
    volOfVol: round(vov, 5),
    volOfVolRel: round(vovRel, 4),
    changes: dIv.length,
    halfLife: round(halfLife, 2),
    phi: ar ? round(ar.slope, 4) : null,
    longRun: ar && ar.slope < 1 ? round(ar.intercept / (1 - ar.slope), 4) : null,
    spotVolCorr: round(corr, 3),
    rank: round(rp.rank, 4),
    pct: round(rp.percentile, 4),
    vendorRank: round(last.rank, 4),
    view: halfLifeClass(halfLife),
    units: { volOfVol: "sd of daily iv change, decimal vol", volOfVolRel: "sd of daily log iv change x sqrt(252)",
      halfLife: "sessions, from AR(1) on daily iv", rank: "fraction 0-1", pct: "fraction 0-1, today included" },
    silent,
  };
}

export function halfLifeClass(h, bands = HALF_LIFE_BANDS) {
  if (h === null || h === undefined || !Number.isFinite(h)) return null;
  return h < bands.meanReverting ? "mean-reverting" : h > bands.persistent ? "persistent" : "moderate";
}

export function buildVrpPanel(body, { sessionDate = null, iv30 = null, bars = null, garch = null } = {}) {
  const silentBody = bodyPanel(body);
  if (silentBody) return silentBody;
  const rows = [];
  let cutAfter = 0, lookAhead = 0, mismatch = 0, outOfRange = 0;
  for (const r of rowsOf(body)) {
    if (!r || typeof r !== "object") continue;
    const d = isoDay(r.date);
    if (!d) continue;
    if (sessionDate && d > sessionDate) { cutAfter++; continue; }
    const iv = vnum(r.implied_volatility);
    const rv = vnum(r.realized_volatility);
    const realizedDate = isoDay(r.realized_date);
    let rp = vnum(r.risk_premium);
    if (iv !== null && rv !== null) {
      if (rp === null) rp = iv - rv;
      else if (Math.abs(rp - (iv - rv)) > 5e-4) mismatch++;
    }
    const rk = parsePct(r.rank);
    if (rk.outOfRange) outOfRange++;
    const completed = realizedDate !== null && rv !== null && iv !== null && (!sessionDate || realizedDate <= sessionDate);
    if (realizedDate && sessionDate && realizedDate > sessionDate) lookAhead++;
    rows.push({ d, iv, rv: completed ? rv : null, rp: completed ? rp : null, rank: completed ? rk.pct : null, realizedDate, completed });
  }
  if (!rows.length) return silentPanel("quiet", cutAfter ? "after-session" : "no-rows");
  rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const done = rows.filter((r) => r.completed);
  const win = done.slice(-VRP_WINDOW);
  const latest = done.length ? done[done.length - 1] : null;
  const silent = {};
  const enough = win.length >= MIN_HISTORY;
  const hit = enough ? win.filter((r) => r.rp > 0).length / win.length : null;
  if (!enough) { silent.hitRate = "short-history"; silent.meanRp = "short-history"; }
  if (!latest) silent.latest = "input-absent";
  const b = Array.isArray(bars) ? bars.filter((x) => !sessionDate || x.d <= sessionDate) : [];
  const rvByDay = new Map();
  if (b.length > VRP_REALIZED_SESSIONS) {
    const rets = logReturns(b).map((x) => x.r);
    for (const { i, vol } of rollingVol(rets, VRP_REALIZED_SESSIONS)) rvByDay.set(b[i + 1].d, vol);
  }
  const rvAsOf = b.length && rvByDay.has(b[b.length - 1].d) ? b[b.length - 1].d : null;
  const rvNow = rvAsOf ? rvByDay.get(rvAsOf) : null;
  const ivNow = vnum(iv30);
  const exAnte = ivNow !== null && rvNow !== null ? ivNow - rvNow : null;
  if (exAnte === null) silent.exAnte = "input-absent";
  const histX = [];
  for (const r of rows) {
    if (r.iv === null || (sessionDate && r.d >= sessionDate)) continue;
    const rv = rvByDay.get(r.d);
    if (rv !== undefined) histX.push({ d: r.d, x: r.iv - rv });
  }
  const xWin = histX.slice(-VRP_WINDOW);
  const zx = zAgainst(exAnte, xWin.map((h) => h.x));
  if (zx.z === null) silent.exAnteZ = zx.code;
  let g = null;
  if (garch && garch.status === "ok" && vnum(garch.avg21Vol) > 0 && ivNow !== null) {
    const v = varianceRiskPremium(ivNow, vnum(garch.avg21Vol) / 100);
    g = {
      forecast: round(vnum(garch.avg21Vol) / 100, 4),
      volPoints: round(v.volPoints, 5), variance: round(v.variance, 6),
      relative: round(v.relativeToForecast, 4), ratioVar: round(v.ratioVar, 4),
      weak: !garch.converged || !(vnum(garch.alpha) >= 0.01),
    };
  } else silent.garch = ivNow === null ? "input-absent" : "garch-unfit";
  const xByDay = new Map(histX.map((h) => [h.d, h.x]));
  const keep = rows.slice(-VRP_SERIES_KEEP);
  return {
    status: "ok",
    asOf: rows[rows.length - 1].d,
    latest: latest ? {
      date: latest.d, realizedDate: latest.realizedDate, iv: round(latest.iv, 4), rv: round(latest.rv, 4),
      rp: round(latest.rp, 5), variance: round(latest.iv * latest.iv - latest.rv * latest.rv, 6), rank: round(latest.rank, 4),
      lagDays: sessionDate ? dayDiff(latest.d, sessionDate) : null,
    } : null,
    n: win.length,
    hitRate: round(hit, 4),
    meanRp: enough ? round(mean(win.map((r) => r.rp)), 5) : null,
    medianRp: enough ? round(median(win.map((r) => r.rp)), 5) : null,
    rankOwn: latest && enough ? round(shareAtOrBelow(latest.rp, win.map((r) => r.rp)), 4) : null,
    meanVariance: enough ? round(mean(win.map((r) => r.iv * r.iv - r.rv * r.rv)), 6) : null,
    exAnte: {
      iv30: round(ivNow, 4), rv21: round(rvNow, 4), rvAsOf, vrp: round(exAnte, 5),
      z: round(zx.z, 3), n: zx.n, mean: round(zx.mean ?? null, 5), sd: round(zx.sd ?? null, 5),
      xPct: null,
      ivSource: "interpolated-iv/distribution days=30", histIvSource: "variance-risk-premium implied_volatility (30d)",
      rvSource: "close-to-close sample sd of the trailing 21 session returns x sqrt(252)",
    },
    garch: g,
    series: {
      d: keep.map((r) => r.d),
      rp: keep.map((r) => round(r.rp, 5)),
      x: keep.map((r) => round(xByDay.has(r.d) ? xByDay.get(r.d) : null, 5)),
    },
    realizedSessions: VRP_REALIZED_SESSIONS,
    ...(cutAfter ? { cutAfter } : {}),
    ...(lookAhead ? { lookAhead } : {}),
    ...(mismatch ? { rpMismatch: mismatch } : {}),
    ...(outOfRange ? { rankOutOfRange: outOfRange } : {}),
    units: { rp: "iv minus the realized vol that followed, annualised decimal", variance: "iv^2 - rv^2",
      hitRate: "fraction of completed windows with rp > 0", exAnte: "iv30 today minus trailing rv21, annualised decimal",
      z: "sd against the reconstructed ex-ante history" },
    silent,
  };
}

const dirOf = (s) => (typeof s === "string" ? s.trim().toLowerCase() : null);

function latestOnOrBefore(comp, sessionDate) {
  const latest = comp.latest;
  const ld = latest ? isoDay(latest.date) : null;
  if (latest && (!sessionDate || !ld || ld <= sessionDate)) return { row: latest, from: "latest", date: ld };
  const hist = comp.history.filter((h) => h && isoDay(h.date) && (!sessionDate || isoDay(h.date) <= sessionDate))
    .sort((a, b) => (isoDay(a.date) < isoDay(b.date) ? -1 : 1));
  const h = hist[hist.length - 1];
  return h ? { row: h, from: "history", date: isoDay(h.date) } : null;
}

const compNum = (c, key) => (c && typeof c === "object" ? round(vnum(c[key]), 4) : null);

export function volVote(ours, vendor) {
  if (!ours || !vendor) return null;
  if (ours === "neutral" || vendor === "neutral" || ours === "moderate" || vendor === "moderate") return 0;
  return ours === vendor ? 1 : -1;
}

export function buildAnomalyPanel(body, { sessionDate = null, ours = null } = {}) {
  if (body === null || body === undefined) return silentPanel("unavailable", "read-failed");
  const comp = compositeOf(body);
  if (!comp) return silentPanel("unreadable", "unreadable-body");
  const pick = latestOnOrBefore(comp, sessionDate);
  if (!pick) return silentPanel("quiet", comp.history.length || comp.latest ? "after-session" : "no-rows");
  const L = pick.row;
  const dir = dirOf(L.direction);
  const vendor = dir === "short_vol" ? "rich" : dir === "long_vol" ? "cheap" : dir ? "neutral" : null;
  const c = pick.from === "latest" && L.components && typeof L.components === "object" ? L.components : null;
  const hist = comp.history.filter((h) => h && isoDay(h.date) && (!sessionDate || isoDay(h.date) <= sessionDate))
    .map((h) => ({ d: isoDay(h.date), s: vnum(h.score), dir: dirOf(h.direction) }))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  const signed = hist.filter((h) => h.s !== null && (h.dir === "short_vol" || h.dir === "long_vol"));
  const consistent = signed.filter((h) => (h.dir === "short_vol") === (h.s > 0)).length;
  const vote = volVote(ours, vendor);
  return {
    status: "ok",
    asOf: pick.date,
    sameSession: sessionDate && pick.date ? pick.date === sessionDate : null,
    from: pick.from,
    score: round(vnum(L.score), 3),
    direction: dir,
    view: vendor,
    sampleSize: vnum(L.sample_size),
    components: c ? {
      ivPct: c.iv_percentile ? { raw: compNum(c.iv_percentile, "raw"), value: compNum(c.iv_percentile, "value") } : null,
      regime: c.regime_score ? { raw: compNum(c.regime_score, "raw"), value: compNum(c.regime_score, "value"),
        crashProbability: compNum(c.regime_score, "crash_probability") } : null,
      skewPct: c.skew_percentile ? { raw: compNum(c.skew_percentile, "raw"), value: compNum(c.skew_percentile, "value"),
        percentile: compNum(c.skew_percentile, "percentile") } : null,
      vovPct: c.vov_percentile ? { raw: compNum(c.vov_percentile, "raw"), value: compNum(c.vov_percentile, "value") } : null,
      vrpZ: c.vrp_z ? { raw: compNum(c.vrp_z, "raw"), value: compNum(c.vrp_z, "value"),
        mean: compNum(c.vrp_z, "mean"), std: compNum(c.vrp_z, "std") } : null,
    } : null,
    signConsistency: signed.length ? round(consistent / signed.length, 3) : null,
    ours,
    vote,
    history: { d: hist.map((h) => h.d), s: hist.map((h) => round(h.s, 2)) },
    units: { score: "vendor composite, positive with short_vol (rich), negative with long_vol (cheap)",
      vote: "+1 agree, 0 either side neutral, -1 disagree, null either side absent" },
    silent: vote === null ? { vote: ours ? "input-absent" : "no-counterpart" } : {},
  };
}

export function buildSentimentPanel(body, { sessionDate = null, lean = null } = {}) {
  if (body === null || body === undefined) return silentPanel("unavailable", "read-failed");
  const comp = compositeOf(body);
  if (!comp) return silentPanel("unreadable", "unreadable-body");
  const pick = latestOnOrBefore(comp, sessionDate);
  if (!pick) return silentPanel("quiet", comp.history.length || comp.latest ? "after-session" : "no-rows");
  const L = pick.row;
  const dir = dirOf(L.direction);
  const vendorLean = dir === "bullish" ? 1 : dir === "bearish" ? -1 : dir ? 0 : null;
  const hist = comp.history.filter((h) => h && isoDay(h.date) && (!sessionDate || isoDay(h.date) <= sessionDate))
    .map((h) => ({ d: isoDay(h.date), s: vnum(h.score), vwks: vnum(h.vwks), avar: vnum(h.avar), dir: dirOf(h.direction) }))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  const prior = hist.filter((h) => h.d !== pick.date).map((h) => h.s);
  const score = vnum(L.score);
  const z = zAgainst(score, prior, { min: MIN_IV_CHANGES });
  const ourLean = lean === 1 || lean === -1 ? lean : null;
  const vote = ourLean === null || vendorLean === null ? null : vendorLean === 0 ? 0 : vendorLean === ourLean ? 1 : -1;
  const c = pick.from === "latest" && L.components && typeof L.components === "object" ? L.components : null;
  const keep = hist.slice(-SENTIMENT_SERIES_KEEP);
  const silent = {};
  if (z.z === null) silent.z = z.code;
  if (vote === null) silent.vote = ourLean === null ? "no-counterpart" : "input-absent";
  return {
    status: "ok",
    asOf: pick.date,
    sameSession: sessionDate && pick.date ? pick.date === sessionDate : null,
    from: pick.from,
    score: round(score, 3),
    direction: dir,
    lean: vendorLean,
    vwks: round(vnum(L.vwks), 5),
    avar: round(vnum(L.avar), 5),
    components: c ? {
      vwks: c.vwks ? { norm: compNum(c.vwks, "norm"), value: compNum(c.vwks, "value") } : null,
      avar: c.avar ? { norm: compNum(c.avar, "norm"), value: compNum(c.avar, "value") } : null,
    } : null,
    sampleSize: vnum(L.sample_size),
    z: round(z.z, 3),
    n: z.n,
    ours: ourLean,
    vote,
    history: { d: keep.map((h) => h.d), s: keep.map((h) => round(h.s, 2)) },
    units: { score: "vendor blend, positive bullish", vwks: "volume-weighted (K-S)/S", avar: "call vs put iv asymmetry",
      z: "sd against the vendor's own returned history", vote: "+1 agree with the board side, 0 vendor neutral, -1 disagree" },
    silent,
  };
}

export function buildCharacterPanel(body, { sessionDate = null, ivHalfLife = null } = {}) {
  if (body === null || body === undefined) return silentPanel("unavailable", "read-failed");
  const comp = compositeOf(body);
  if (!comp) return silentPanel("unreadable", "unreadable-body");
  const pick = latestOnOrBefore(comp, sessionDate);
  if (!pick) return silentPanel("quiet", comp.history.length || comp.latest ? "after-session" : "no-rows");
  const L = pick.row;
  const label = typeof L.character === "string" ? L.character.trim().toLowerCase().replace(/[\s_]+/g, "-") : null;
  const vendor = label === "mean-reverting" || label === "persistent" || label === "moderate" ? label : label ? "other" : null;
  const hist = comp.history.filter((h) => h && isoDay(h.date) && (!sessionDate || isoDay(h.date) <= sessionDate))
    .map((h) => ({ d: isoDay(h.date), hl: vnum(h.half_life_days), h: vnum(h.hurst_rv), c: typeof h.character === "string" ? h.character : null }))
    .sort((a, b) => (a.d < b.d ? -1 : 1))
    .slice(-SERIES_KEEP);
  const panel = {
    status: "ok",
    asOf: pick.date,
    sameSession: sessionDate && pick.date ? pick.date === sessionDate : null,
    from: pick.from,
    character: label,
    halfLifeDays: round(vnum(L.half_life_days), 2),
    hurst: round(vnum(L.hurst_rv), 4),
    ar1B: round(vnum(L.ar1_b), 4),
    entropyNegative: round(vnum(L.entropy_negative), 4),
    entropyConditional: round(vnum(L.entropy_conditional), 4),
    entropySamples: vnum(L.entropy_samples),
    sampleSize: vnum(L.sample_size),
    view: vendor === "other" ? null : vendor,
    ours: null,
    vote: null,
    history: { d: hist.map((x) => x.d), hl: hist.map((x) => round(x.hl, 2)), h: hist.map((x) => round(x.h, 4)) },
    units: { halfLifeDays: "vendor, days", hurst: "vendor Hurst exponent of realized vol",
      vote: "+1 same class as our iv half-life class, 0 either moderate, -1 opposite" },
    silent: {},
  };
  return characterVote(panel, ivHalfLife);
}

export function characterVote(panel, ivHalfLife) {
  if (!panel || panel.status !== "ok") return panel;
  const ours = halfLifeClass(ivHalfLife);
  const vote = volVote(ours, panel.view);
  const silent = { ...(panel.silent || {}) };
  delete silent.vote;
  if (vote === null) silent.vote = ours ? "input-absent" : "no-counterpart";
  return { ...panel, ours, vote, silent };
}

function radarRows(body, kind, carded) {
  const list = rowsOf(body);
  if (list === null) return null;
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== "object" || typeof r.ticker !== "string") continue;
    const c = r.components && typeof r.components === "object" ? r.components : {};
    const base = { t: r.ticker, score: round(vnum(r.score), 3), n: vnum(r.sample_size), carded: carded.has(r.ticker) };
    if (kind === "anomaly") {
      out.push({ ...base,
        iv: compNum(c.iv_percentile, "value"), skew: compNum(c.skew_percentile, "value"),
        vov: compNum(c.vov_percentile, "value"), vrpZ: compNum(c.vrp_z, "value"),
        regime: compNum(c.regime_score, "value"), crash: compNum(c.regime_score, "crash_probability") });
    } else {
      out.push({ ...base, vwks: round(vnum(r.vwks), 5), avar: round(vnum(r.avar), 5) });
    }
  }
  out.sort((a, b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0));
  return out;
}

export function buildVolRadar(bodies, { sessionDate = null, carded = [] } = {}) {
  const set = new Set(carded);
  const side = (body, kind) => {
    if (body === null || body === undefined) return { status: "unavailable", code: "read-failed", rows: [], seen: 0 };
    const rows = radarRows(body, kind, set);
    if (rows === null) return { status: "unreadable", code: "unreadable-body", rows: [], seen: 0 };
    const asOf = isoDay(body && body.date);
    return {
      status: rows.length ? "ok" : "quiet", code: rows.length ? null : "no-rows",
      asOf, sameSession: sessionDate && asOf ? asOf === sessionDate : null,
      seen: rows.length, rows: rows.slice(0, RADAR_KEEP),
    };
  };
  const rich = side(bodies.rich, "anomaly");
  const cheap = side(bodies.cheap, "anomaly");
  const bullish = side(bodies.bullish, "sentiment");
  const bearish = side(bodies.bearish, "sentiment");
  const all = [rich, cheap, bullish, bearish];
  const overlap = new Set();
  for (const s of all) for (const r of s.rows) if (r.carded) overlap.add(r.t);
  const okCount = all.filter((s) => s.status === "ok").length;
  return {
    status: okCount ? "ok" : all.some((s) => s.status === "unreadable") ? "unreadable" : all.every((s) => s.status === "quiet") ? "quiet" : "unavailable",
    asOf: [rich, cheap, bullish, bearish].map((s) => s.asOf).filter(Boolean).sort().pop() || null,
    rich, cheap, bullish, bearish,
    carded: [...overlap].sort(),
    keep: RADAR_KEEP,
    units: { score: "vendor composite; rich = short_vol, cheap = long_vol", iv: "vendor component value", vwks: "volume-weighted (K-S)/S" },
  };
}

export function exEventVol(iv, days, term, sessionDate) {
  const v = vnum(iv);
  if (v === null || !(days > 0) || !sessionDate) return { value: null, code: "input-absent" };
  if (!term || term.status !== "ok") return { value: null, code: "input-absent" };
  const eventDay = term.earnings && term.earnings.eventDay;
  if (!eventDay) return { value: v, code: null };
  const until = dayDiff(sessionDate, eventDay);
  if (!(until > 0) || until > days) return { value: v, code: null };
  const j = term.eventMove && term.eventMove.sd;
  if (!(j > 0)) {
    const code = term.silent && term.silent.eventMove;
    return code === "no-premium" ? { value: v, code: null } : { value: null, code: code || "input-absent" };
  }
  const T = days / CALENDAR_YEAR;
  const w = v * v * T - j * j;
  return w > 0 ? { value: Math.sqrt(w / T), code: null } : { value: null, code: "calendar-arbitrage" };
}

export function exEventSlope(cone, term, sessionDate) {
  if (!cone || cone.status !== "ok") return { value: null, code: "input-absent" };
  const at = (d) => cone.tenors.find((t) => t.days === d) || null;
  const t30 = at(30), t90 = at(90);
  if (!t30 || !t90 || !(t90.iv > 0) || !sessionDate) return { value: null, code: "input-absent" };
  const a = exEventVol(t30.iv, 30, term, sessionDate);
  const b = exEventVol(t90.iv, 90, term, sessionDate);
  if (a.value === null || !(b.value > 0)) return { value: null, code: a.code || b.code || "input-absent" };
  return { value: round(a.value / b.value - 1, 4), code: null };
}

export function crossSectionPercentiles(entries, pickers, { min = XSECTION_MIN } = {}) {
  const out = new Map();
  for (const [name, get] of Object.entries(pickers)) {
    const vals = [];
    for (const e of entries) { const v = get(e); if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(v); }
    for (const e of entries) {
      const v = get(e);
      const pct = vals.length >= min && v !== null && v !== undefined && Number.isFinite(v) ? round(shareAtOrBelow(v, vals), 4) : null;
      if (!out.has(e)) out.set(e, {});
      out.get(e)[name] = pct;
    }
  }
  return out;
}

const pick = (panel, fn) => (panel && panel.status === "ok" ? fn(panel) : null);

export function volSummary(panels, { asOf = null } = {}) {
  const p = panels || {};
  const statusOf = (x) => (x ? x.status : "unavailable");
  return {
    v: VOL_SCHEMA_VERSION,
    asOf,
    iv30: pick(p.cone, (c) => c.iv30),
    iv30Pct: pick(p.cone, (c) => c.pct30),
    richCheap: pick(p.cone, (c) => c.richCheap),
    view: pick(p.cone, (c) => c.view),
    coneShape: pick(p.cone, (c) => c.coneShape),
    slope30_90: pick(p.cone, (c) => c.slope30_90),
    rv21: pick(p.rv, (r) => (r.cone.find((x) => x.n === 21) || {}).now ?? null),
    rv21Pct: pick(p.rv, (r) => (r.cone.find((x) => x.n === 21) || {}).pct ?? null),
    yz21: pick(p.rv, (r) => (r.yz.find((x) => x.n === 21) || {}).vol ?? null),
    gap63: pick(p.rv, (r) => (r.gap.find((x) => x.n === 63) || {}).share ?? null),
    vrp: {
      exAnte: pick(p.vrp, (v) => v.exAnte.vrp),
      exAnteExEvent: pick(p.vrp, (v) => (v.exAnte.vrpExEvent === undefined ? null : v.exAnte.vrpExEvent)),
      exAnteZ: pick(p.vrp, (v) => v.exAnte.z),
      hitRate: pick(p.vrp, (v) => v.hitRate),
      rank: pick(p.vrp, (v) => (v.latest ? v.latest.rank : null)),
      lastExPost: pick(p.vrp, (v) => (v.latest ? v.latest.rp : null)),
    },
    skew: {
      rr25: pick(p.skew, (s) => s.rr25),
      z: pick(p.skew, (s) => s.z),
      zRaw: pick(p.skew, (s) => s.zRaw),
      mom5: pick(p.skew, (s) => s.mom5),
      crash: pick(p.skew, (s) => s.crash),
    },
    term: {
      eventExpiry: pick(p.term, (t) => t.eventExpiry),
      eventMove: pick(p.term, (t) => t.eventMove.sd),
      kink: pick(p.term, (t) => (t.eventKink ? t.eventKink.expiry : null)),
    },
    ivDyn: {
      halfLife: pick(p.ivDyn, (d) => d.halfLife),
      volOfVol: pick(p.ivDyn, (d) => d.volOfVol),
    },
    votes: {
      anomaly: pick(p.anomaly, (a) => a.vote),
      sentiment: pick(p.sentiment, (s) => s.vote),
      character: pick(p.character, (c) => c.vote),
    },
    status: Object.fromEntries(["cone", "rv", "vrp", "term", "skew", "ivDyn", "anomaly", "sentiment", "character"]
      .map((k) => [k, statusOf(p[k])])),
  };
}
