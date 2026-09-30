import { normInv } from "./flows-quant-bs.js";
import { skewtConstants, skewtDensity, lnGamma, garchAverageVariance as garchAverageVarianceRaw, GARCH_EWMA_LAMBDA } from "./flows-garch.js";
import { integrate, binnedFromSamples, driftNeutralBinned, garchAggregatedSd, lawBinned, lawQuantile, LAW_BINS } from "./flows-quant-density.js";

export const WORLD_LINES = Object.freeze({
  PATHS: 32768,
  MC_PATHS: 8192,
  HORIZONS: Object.freeze([1, 2, 3, 5, 10, 21, 42, 63, 126]),
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

export const aggregatedSd = garchAggregatedSd;

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

function betaContinuedFraction(a, b, x) {
  const TINY = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

export function regIncBeta(x, a, b) {
  if (!(x > 0)) return 0;
  if (!(x < 1)) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return front * betaContinuedFraction(a, b, x) / a;
  return 1 - front * betaContinuedFraction(b, a, 1 - x) / b;
}

export function studentCdf(t, nu) {
  const tail = 0.5 * regIncBeta(nu / (nu + t * t), nu / 2, 0.5);
  return t < 0 ? tail : 1 - tail;
}

function studentPdf(t, nu) {
  return Math.exp(lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - (nu + 1) / 2 * Math.log1p(t * t / nu));
}

export function studentLowerQuantile(p, nu) {
  if (!(p > 0)) return -Infinity;
  if (p >= 0.5) return 0;
  let hi = 0, lo = -1;
  for (let g = 0; g < 400 && studentCdf(lo, nu) > p; g++) { hi = lo; lo *= 2; }
  let t = normInv(p) * (1 + 1 / nu);
  if (!(t > lo && t < hi)) t = (lo + hi) / 2;
  for (let it = 0; it < 200; it++) {
    const f = studentCdf(t, nu) - p;
    if (f > 0) hi = t; else lo = t;
    const d = studentPdf(t, nu);
    let next = d > 0 ? t - f / d : NaN;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    const done = Math.abs(next - t) <= 1e-15 * Math.max(1, Math.abs(t)) || hi - lo <= 1e-15 * Math.max(1, Math.abs(lo));
    t = next;
    if (done) break;
  }
  return t;
}

export function skewtQuantile(u, nu, lambda, k) {
  const { a, b } = k || skewtConstants(nu, lambda);
  if (!(u > 0)) return -Infinity;
  if (!(u < 1)) return Infinity;
  const unit = Math.sqrt((nu - 2) / nu);
  const cut = (1 - lambda) / 2;
  if (u < cut) return ((1 - lambda) * unit * studentLowerQuantile(u / (1 - lambda), nu) - a) / b;
  const right = (1 - u) / (1 + lambda);
  return ((1 + lambda) * unit * -studentLowerQuantile(right, nu) - a) / b;
}

export function skewtQuantiler(nu, lambda, levels) {
  const k = skewtConstants(nu, lambda);
  const table = new Float64Array(levels);
  for (let i = 0; i < levels; i++) table[i] = skewtQuantile((i + 0.5) / levels, nu, lambda, k);
  return (u) => {
    const x = u * levels - 0.5;
    if (x <= 0 || x >= levels - 1) return skewtQuantile(u, nu, lambda, k);
    const i = Math.floor(x);
    return table[i] + (table[i + 1] - table[i]) * (x - i);
  };
}

const SOBOL_DIRECTIONS = Object.freeze([
  { s: 0, a: 0, m: [] },
  { s: 1, a: 0, m: [1] },
  { s: 2, a: 1, m: [1, 3] },
  { s: 3, a: 1, m: [1, 3, 1] },
  { s: 3, a: 2, m: [1, 1, 1] },
  { s: 4, a: 1, m: [1, 1, 3, 3] },
  { s: 4, a: 4, m: [1, 3, 5, 13] },
  { s: 5, a: 2, m: [1, 1, 5, 5, 17] },
  { s: 5, a: 4, m: [1, 1, 5, 5, 5] },
  { s: 5, a: 7, m: [1, 1, 7, 11, 19] },
]);

function sobolDirections(dim) {
  const V = new Uint32Array(32);
  const spec = SOBOL_DIRECTIONS[dim];
  if (spec.s === 0) {
    for (let i = 0; i < 32; i++) V[i] = (0x80000000 >>> i) >>> 0;
    return V;
  }
  const { s, a, m } = spec;
  for (let i = 0; i < s; i++) V[i] = (m[i] << (31 - i)) >>> 0;
  for (let i = s; i < 32; i++) {
    let v = V[i - s] ^ (V[i - s] >>> s);
    for (let j = 1; j < s; j++) if ((a >>> (s - 1 - j)) & 1) v ^= V[i - j];
    V[i] = v >>> 0;
  }
  return V;
}

export const SOBOL_MAX_DIM = SOBOL_DIRECTIONS.length;

export function sobolScrambled(n, dims, seed) {
  if (!(dims >= 1 && dims <= SOBOL_MAX_DIM) || !(n >= 1) || (n & (n - 1)) !== 0) throw new RangeError("sobolScrambled: n must be a power of two and dims within " + SOBOL_MAX_DIM);
  const rng = xoshiro128ss(seed);
  const V = [];
  const state = new Uint32Array(dims);
  for (let j = 0; j < dims; j++) { V.push(sobolDirections(j)); state[j] = rng.next() >>> 0; }
  const out = new Float64Array(n * dims);
  const x = new Uint32Array(dims);
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const c = 31 - Math.clz32(i & -i);
      for (let j = 0; j < dims; j++) x[j] = (x[j] ^ V[j][c]) >>> 0;
    }
    for (let j = 0; j < dims; j++) out[i * dims + j] = ((x[j] ^ state[j]) >>> 0) / 4294967296 + 1 / 8589934592;
  }
  return out;
}

export function simulateGjrQmc(params, opts = {}) {
  const n = opts.paths || WORLD_LINES.PATHS;
  const horizons = (opts.horizons || WORLD_LINES.HORIZONS).slice().sort((a, b) => a - b);
  const H = horizons[horizons.length - 1];
  const dims = Math.min(H, SOBOL_MAX_DIM);
  const seed = opts.seed === undefined ? 1 : opts.seed;
  const u = sobolScrambled(n, dims, seed);
  const rng = xoshiro128ss(typeof seed === "string" ? seed + "|tail" : seed + 1);
  const { omega, alpha, beta } = params;
  const gamma = params.gamma || 0;
  const nu = params.nu, lambda = params.lambda || 0;
  const normal = !(nu > 2);
  const quantile = normal ? normInv : skewtQuantiler(nu, lambda, n);
  const out = {};
  for (const h of horizons) out[h] = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    let s2 = params.sigma2Next, x = 0, hi = 0;
    for (let t = 1; t <= H; t++) {
      const z = quantile(t <= dims ? u[p * dims + (t - 1)] : rng.uniform());
      const e = Math.sqrt(s2) * z;
      x += e;
      if (t === horizons[hi]) { out[t][p] = x; hi++; }
      s2 = omega + (alpha + (e < 0 ? gamma : 0)) * e * e + beta * s2;
    }
  }
  return out;
}

export function lawLogSd(bins, perBin = 256) {
  const law = lawBinned({ S: 1, edges: bins.edges, means: bins.means });
  const M = law.n * perBin;
  let s = 0, s2 = 0;
  for (let i = 0; i < M; i++) {
    const x = Math.log(lawQuantile(law, (i + 0.5) / M));
    s += x; s2 += x * x;
  }
  const m = s / M;
  return Math.sqrt(Math.max(0, s2 / M - m * m));
}

export function binnedLawsFromSimulation(sim, forwards, opts = {}) {
  const laws = {};
  for (const h of Object.keys(sim).map(Number).sort((a, b) => a - b)) {
    const target = typeof opts.sd === "function" ? opts.sd(h) : null;
    const sorted = Float64Array.from(sim[h]).sort();
    const N = sorted.length;
    let m = 0;
    for (let i = 0; i < N; i++) m += sorted[i];
    m /= N;
    let v = 0;
    for (let i = 0; i < N; i++) v += (sorted[i] - m) * (sorted[i] - m);
    const sd = Math.sqrt(v / N);
    const matching = typeof target === "number" && Number.isFinite(target) && target > 0 && sd > 0;
    let c = matching ? target / sd : 1;
    const scaled = new Float64Array(N);
    const build = () => {
      for (let i = 0; i < N; i++) scaled[i] = matching ? (sorted[i] - m) * c : sorted[i];
      return binnedFromSamples({ logReturns: scaled, presorted: true, bins: LAW_BINS });
    };
    let bins = build();
    for (let it = 0; matching && bins && it < 4; it++) {
      const ratio = target / lawLogSd(bins);
      if (Math.abs(ratio - 1) < 2e-4) break;
      c *= ratio;
      bins = build();
    }
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
