export const ROTATION_VERSION = 1;

export const ROTATION_FUNDS = Object.freeze([
  Object.freeze({ t: "SPY", group: "Index funds" }),
  Object.freeze({ t: "QQQ", group: "Index funds" }),
  Object.freeze({ t: "IWM", group: "Index funds" }),
  Object.freeze({ t: "GLD", group: "Gold" }),
  Object.freeze({ t: "IAU", group: "Gold" }),
  Object.freeze({ t: "GDX", group: "Gold miners" }),
  Object.freeze({ t: "GDXJ", group: "Gold miners" }),
  Object.freeze({ t: "SLV", group: "Silver" }),
  Object.freeze({ t: "SIL", group: "Silver miners" }),
  Object.freeze({ t: "SILJ", group: "Silver miners" }),
  Object.freeze({ t: "CPER", group: "Copper" }),
  Object.freeze({ t: "COPX", group: "Copper miners" }),
]);

export const ROTATION_NORMS = Object.freeze([126, 63]);
export const ROTATION_VELS = Object.freeze([10, 5, 21]);
export const ROTATION_WARMUP = 126;
export const ROTATION_MIN_CLOSES = 200;
export const ROTATION_MIN_FUNDS = 3;
export const ROTATION_TAIL_WEEKS = 8;
export const ROTATION_WEEK = 5;
export const ROTATION_MAX_CLOSES = 260;

export const ROTATION_QUADRANTS = Object.freeze([
  "Above norm, gaining",
  "Above norm, losing",
  "Below norm, losing",
  "Below norm, gaining",
]);

export const ROTATION_WHY = Object.freeze({
  no_card: "No stored card for this fund.",
  no_closes: "The stored card holds no daily closes.",
  short: "Fewer than 200 stored closes.",
  gaps: "Its stored closes miss sessions the other funds have.",
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function conventions() {
  const out = [];
  for (const norm of ROTATION_NORMS) for (const vel of ROTATION_VELS) out.push({ norm, vel });
  return out;
}

export function closesOf(card) {
  const ctx = card && card.panels && card.panels.context;
  const rows = ctx && Array.isArray(ctx.candles) ? ctx.candles : null;
  const keys = ctx && Array.isArray(ctx.candleKeys) ? ctx.candleKeys : null;
  if (!rows || !keys) return null;
  const di = keys.indexOf("date"), ci = keys.indexOf("close");
  if (di < 0 || ci < 0) return null;
  const d = [], c = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const day = r[di], px = r[ci];
    if (typeof day !== "string" || !DAY_RE.test(day) || typeof px !== "number" || !Number.isFinite(px) || px <= 0) continue;
    if (d.length && day <= d[d.length - 1]) continue;
    d.push(day);
    c.push(px);
  }
  if (!d.length) return null;
  const from = Math.max(0, d.length - ROTATION_MAX_CLOSES);
  return { d: d.slice(from), c: c.slice(from) };
}

export function align(series) {
  const absent = {};
  const ok = [];
  for (const f of ROTATION_FUNDS) {
    const s = series ? series[f.t] : null;
    if (!s) { absent[f.t] = "no_card"; continue; }
    if (!Array.isArray(s.d) || !Array.isArray(s.c) || !s.d.length || s.d.length !== s.c.length) { absent[f.t] = "no_closes"; continue; }
    if (s.d.length < ROTATION_MIN_CLOSES) { absent[f.t] = "short"; continue; }
    ok.push(f.t);
  }
  if (ok.length < ROTATION_MIN_FUNDS) return { tickers: [], dates: [], closes: {}, absent };
  const count = new Map();
  for (const t of ok) for (const day of series[t].d) count.set(day, (count.get(day) || 0) + 1);
  const most = [...count.keys()].filter((day) => count.get(day) * 2 > ok.length).sort();
  const tickers = [];
  for (const t of ok) {
    const have = new Set(series[t].d);
    if (most.every((day) => have.has(day))) tickers.push(t);
    else absent[t] = "gaps";
  }
  if (tickers.length < ROTATION_MIN_FUNDS) return { tickers: [], dates: [], closes: {}, absent };
  const closes = {};
  for (const t of tickers) {
    const at = new Map(series[t].d.map((day, i) => [day, series[t].c[i]]));
    closes[t] = most.map((day) => at.get(day));
  }
  return { tickers, dates: most, closes, absent };
}

export function clr(aligned) {
  const { tickers, dates, closes } = aligned;
  const s = {};
  for (const t of tickers) s[t] = new Array(dates.length);
  for (let k = 0; k < dates.length; k++) {
    let m = 0;
    for (const t of tickers) m += Math.log(closes[t][k]);
    m /= tickers.length;
    for (const t of tickers) s[t][k] = Math.log(closes[t][k]) - m;
  }
  return s;
}

export const lambdaOf = (halfLife) => 1 - Math.pow(2, -1 / halfLife);

export function gapSeries(s, halfLife) {
  const lam = lambdaOf(halfLife);
  const out = new Array(s.length).fill(null);
  let num = 0, den = 0;
  for (let k = 1; k < s.length; k++) {
    num = (1 - lam) * num + lam * s[k - 1];
    den = (1 - lam) * den + lam;
    out[k] = 100 * (s[k] - num / den);
  }
  return out;
}

export function pointAt(gap, k, vel) {
  if (k < ROTATION_WARMUP || k - vel < 1 || gap[k] === null || gap[k - vel] === null) return null;
  return { x: gap[k], y: (gap[k] - gap[k - vel]) * (ROTATION_WEEK / vel) };
}

export const quadOf = (p) => (p.x >= 0 ? (p.y >= 0 ? 0 : 1) : (p.y >= 0 ? 3 : 2));

export function weekEnds(n) {
  const out = [];
  for (let k = n - 1; k >= ROTATION_WARMUP && out.length < ROTATION_TAIL_WEEKS; k -= ROTATION_WEEK) out.unshift(k);
  return out;
}

export function plane(series) {
  const aligned = align(series);
  const { tickers, dates, absent } = aligned;
  if (!tickers.length) return { v: ROTATION_VERSION, status: "unavailable", why: "too_few", absent, funds: [], dates: [], weeks: [] };
  if (dates.length <= ROTATION_WARMUP) return { v: ROTATION_VERSION, status: "unavailable", why: "short_history", absent, funds: [], dates, weeks: [] };
  const s = clr(aligned);
  const convs = conventions();
  const weeks = weekEnds(dates.length);
  const last = dates.length - 1;
  const funds = tickers.map((t) => {
    const by = {};
    const lastQuads = [];
    for (const c of convs) {
      const gap = gapSeries(s[t], c.norm);
      const tail = weeks.map((k) => pointAt(gap, k, c.vel));
      by[c.norm + "|" + c.vel] = tail;
      const p = pointAt(gap, last, c.vel);
      lastQuads.push(p ? quadOf(p) : null);
    }
    const held = lastQuads.filter((q) => q !== null && q === lastQuads[0]).length;
    const robust = lastQuads[0] !== null && held === convs.length;
    return { t, group: ROTATION_FUNDS.find((f) => f.t === t).group, close: aligned.closes[t][last], tails: by, quads: lastQuads, held, robust };
  });
  return {
    v: ROTATION_VERSION, status: "ok", asOf: dates[last], sessions: dates.length, from: dates[0],
    conventions: convs, weeks: weeks.map((k) => dates[k]), funds, absent,
  };
}
