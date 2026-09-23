import { normInv } from "./flows-quant-bs.js";
import { skewtConstants, skewtDensity, garchAverageVariance as garchAverageVarianceRaw, GARCH_EWMA_LAMBDA } from "./flows-garch.js";
import { integrate, binnedFromSamples, driftNeutralBinned, LAW_BINS } from "./flows-quant-density.js";

export const WORLD_LINES = Object.freeze({
  PATHS: 8192,
  HORIZONS: Object.freeze([5, 10, 21, 42, 63, 126]),
  ANNUAL_SESSIONS: 252,
  ENGINE_VERSION: "q1",
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);

export { skewtDensity };

export function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function splitmix32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function xoshiro128ss(seed) {
  const sm = splitmix32(typeof seed === "string" ? fnv1a32(seed) : seed);
  let a = sm(), b = sm(), c = sm(), d = sm();
  if ((a | b | c | d) === 0) a = 1;
  const next = () => {
    const r = Math.imul(((Math.imul(b, 5) << 7) | (Math.imul(b, 5) >>> 25)), 9) >>> 0;
    const t = (b << 9) >>> 0;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t;
    d = ((d << 11) | (d >>> 21)) >>> 0;
    a >>>= 0; b >>>= 0; c >>>= 0;
    return r;
  };
  return { next, uniform: () => (next() + 0.5) / 4294967296 };
}

export function seedKey(ticker, sessionDate, engineVersion = WORLD_LINES.ENGINE_VERSION) {
  return String(ticker) + "|" + String(sessionDate) + "|" + String(engineVersion);
}

export function normalDraw(rng) {
  return normInv(rng.uniform());
}

export function gammaDraw(rng, shape) {
  if (shape < 1) return gammaDraw(rng, shape + 1) * Math.pow(rng.uniform(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = normalDraw(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng.uniform();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function skewtDraw(rng, nu, lambda, k) {
  const { a, b } = k || skewtConstants(nu, lambda);
  const z = normalDraw(rng);
  const g = 2 * gammaDraw(rng, nu / 2);
  const t = z / Math.sqrt(g / nu);
  const y = Math.abs(t * Math.sqrt((nu - 2) / nu));
  return rng.uniform() < (1 - lambda) / 2 ? (-(1 - lambda) * y - a) / b : ((1 + lambda) * y - a) / b;
}

export function skewtMoments(input) {
  const nu = input.nu, lambda = fin(input.lambda) ? input.lambda : input.lambda_;
  const k = skewtConstants(nu, lambda);
  const cut = -k.a / k.b;
  const f = (z) => skewtDensity(z, nu, lambda);
  const left = (g) => integrate((u) => { const z = cut - u / (1 - u); return g(z) / ((1 - u) * (1 - u)); }, 0, 1 - 1e-12, 200, 32);
  const right = (g) => integrate((u) => { const z = cut + u / (1 - u); return g(z) / ((1 - u) * (1 - u)); }, 0, 1 - 1e-12, 200, 32);
  const m = (p) => left((z) => Math.pow(z, p) * f(z)) + right((z) => Math.pow(z, p) * f(z));
  const mass = m(0), mean = m(1), second = m(2), third = m(3);
  const variance = second - mean * mean;
  return {
    a: k.a, b: k.b, c: k.c, cutoff: cut, mass, mean, variance,
    skewness: (third - 3 * mean * second + 2 * mean * mean * mean) / Math.pow(variance, 1.5),
    leftMass: left(f),
  };
}

export function garchAverageVariance(input) {
  if (input && Array.isArray(input.cases)) {
    const values = input.cases.map((c) => garchAverageVariance(c));
    return { values, annualisedVolPct: values.map((v) => (v === null ? null : Math.sqrt(v * WORLD_LINES.ANNUAL_SESSIONS))) };
  }
  const { next, longRun, persistence, sessions } = input || {};
  return garchAverageVarianceRaw(next, longRun, persistence, sessions);
}

export function aggregatedSd(params, h) {
  const persistence = params.alpha + (params.gamma || 0) / 2 + params.beta;
  const longRun = persistence < 1 ? params.omega / (1 - persistence) : params.sigma2Next;
  const avg = garchAverageVarianceRaw(params.sigma2Next, longRun, persistence, h);
  return avg === null ? null : Math.sqrt(avg * h);
}

export function simulateGjr(params, opts = {}) {
  const n = opts.paths || WORLD_LINES.PATHS;
  const horizons = (opts.horizons || WORLD_LINES.HORIZONS).slice().sort((a, b) => a - b);
  const H = horizons[horizons.length - 1];
  const rng = xoshiro128ss(opts.seed === undefined ? 1 : opts.seed);
  const { omega, alpha, beta } = params;
  const gamma = params.gamma || 0;
  const nu = params.nu, lambda = params.lambda || 0;
  const normal = !(nu > 2);
  const k = normal ? null : skewtConstants(nu, lambda);
  const out = {};
  for (const h of horizons) out[h] = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    let s2 = params.sigma2Next, x = 0, hi = 0;
    for (let t = 1; t <= H; t++) {
      const z = normal ? normalDraw(rng) : skewtDraw(rng, nu, lambda, k);
      const e = Math.sqrt(s2) * z;
      x += e;
      if (t === horizons[hi]) { out[t][p] = x; hi++; }
      s2 = omega + (alpha + (e < 0 ? gamma : 0)) * e * e + beta * s2;
    }
  }
  return out;
}

export function binnedLawsFromSimulation(sim, forwards) {
  const laws = {};
  for (const h of Object.keys(sim).map(Number).sort((a, b) => a - b)) {
    const bins = binnedFromSamples({ logReturns: Array.from(sim[h]), bins: LAW_BINS });
    if (!bins) continue;
    const fwd = forwards && fin(forwards[h]) ? forwards[h] : 1;
    const dn = driftNeutralBinned(bins, fwd);
    laws[h] = { h, edges: dn.edges, means: dn.means };
  }
  return laws;
}

export function realizedVol(input) {
  const closes = (input.closes || []).filter((c) => fin(c) && c > 0);
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const A = WORLD_LINES.ANNUAL_SESSIONS;
  const out = { closeToClose: null, zeroMeanRms: null, parkinson: null, garmanKlass: null, yangZhang: null, n: r.length };
  if (r.length >= 2) {
    const mu = r.reduce((s, v) => s + v, 0) / r.length;
    out.closeToClose = Math.sqrt(r.reduce((s, v) => s + (v - mu) * (v - mu), 0) / (r.length - 1) * A);
    out.zeroMeanRms = Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length * A);
  }
  const hl = (input.highLow || []).filter((x) => Array.isArray(x) && x[0] > 0 && x[1] > 0);
  if (hl.length) out.parkinson = Math.sqrt(hl.reduce((s, [h, l]) => s + Math.log(h / l) ** 2, 0) / (4 * Math.log(2) * hl.length) * A);
  const ohlc = (input.ohlc || []).filter((x) => x && x.open > 0 && x.high > 0 && x.low > 0 && x.close > 0);
  if (ohlc.length >= 3) {
    const n = ohlc.length;
    let gk = 0, rs = 0;
    const o = [], c = [];
    for (let i = 0; i < n; i++) {
      const x = ohlc[i];
      const hl2 = Math.log(x.high / x.low) ** 2, co2 = Math.log(x.close / x.open) ** 2;
      gk += 0.5 * hl2 - (2 * Math.log(2) - 1) * co2;
      rs += Math.log(x.high / x.close) * Math.log(x.high / x.open) + Math.log(x.low / x.close) * Math.log(x.low / x.open);
      c.push(Math.log(x.close / x.open));
      if (i > 0) o.push(Math.log(x.open / ohlc[i - 1].close));
    }
    out.garmanKlass = Math.sqrt(Math.max(0, gk / n * A));
    const m = o.length;
    const mo = o.reduce((s, v) => s + v, 0) / m, mc = c.slice(1).reduce((s, v) => s + v, 0) / m;
    const so = o.reduce((s, v) => s + (v - mo) ** 2, 0) / (m - 1);
    const sc = c.slice(1).reduce((s, v) => s + (v - mc) ** 2, 0) / (m - 1);
    const srs = rs / n;
    const kk = 0.34 / (1.34 + (m + 1) / (m - 1));
    out.yangZhang = Math.sqrt(Math.max(0, (so + kk * sc + (1 - kk) * srs) * A));
  }
  return out;
}

export function ewmaVol(closes, lambda = GARCH_EWMA_LAMBDA) {
  const r = [];
  for (let i = 1; i < closes.length; i++) if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 20) return null;
  let v = r.slice(0, 20).reduce((s, x) => s + x * x, 0) / 20;
  for (let i = 20; i < r.length; i++) v = lambda * v + (1 - lambda) * r[i] * r[i];
  return Math.sqrt(v * WORLD_LINES.ANNUAL_SESSIONS);
}

export function ivRankPercentile(input) {
  const h = (input.history || []).filter(fin);
  const cur = input.current;
  if (!h.length || !fin(cur)) return { rank: null, percentile: null };
  const lo = Math.min(...h, cur), hi = Math.max(...h, cur);
  return {
    rank: hi > lo ? (cur - lo) / (hi - lo) : null,
    percentile: h.filter((v) => v <= cur).length / h.length,
  };
}

export function varianceRiskPremium(input) {
  const { iv, rvForecast } = input || {};
  if (!fin(iv) || !fin(rvForecast) || !(rvForecast > 0)) return null;
  return {
    volPoints: iv - rvForecast,
    variance: iv * iv - rvForecast * rvForecast,
    relativeToForecast: (iv - rvForecast) / rvForecast,
    ratioVar: (iv * iv) / (rvForecast * rvForecast),
  };
}
