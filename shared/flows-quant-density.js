import { normCdf, normPdf, normInv, black76 } from "./flows-quant-bs.js";
import { asSlice, sliceSvi, sviW, sviW1, sviW2, gatheralG, mixtureComponents, sliceCallU, slicePutU, sliceVol } from "./flows-quant-smile.js";

export const LAW_BINS = 64;
export const ONE_SIGMA_LOW = normCdf(-1);
export const ONE_SIGMA_HIGH = normCdf(1);

const fin = (v) => typeof v === "number" && Number.isFinite(v);

function legendre(n) {
  const x = new Array(n), w = new Array(n);
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-16) break;
    }
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  return { x, w };
}

const GL = new Map();
export function gaussLegendre(n) {
  if (!GL.has(n)) GL.set(n, legendre(n));
  return GL.get(n);
}

export function integrate(f, a, b, panels = 16, nodes = 16) {
  const { x, w } = gaussLegendre(nodes);
  const h = (b - a) / panels;
  let s = 0;
  for (let p = 0; p < panels; p++) {
    const lo = a + p * h, c = lo + h / 2;
    for (let i = 0; i < nodes; i++) s += w[i] * f(c + x[i] * h / 2);
  }
  return s * h / 2;
}

export function riskNeutralCdf(input, K) {
  const s = asSlice(input);
  if (!(K > 0)) return 0;
  if (!fin(K)) return 1;
  if (s.method === "mixture") {
    const sd = s.params.sigmaD * Math.sqrt(s.T);
    let v = 0;
    for (const c of mixtureComponents(s)) v += c.w * normCdf((Math.log(K / (s.F * c.f)) + sd * sd / 2) / sd);
    return v;
  }
  const k = Math.log(K / s.F);
  const p = sliceSvi(s);
  const w = sviW(p, k), w1 = sviW1(p, k);
  if (!(w > 0)) return k < 0 ? 0 : 1;
  const sq = Math.sqrt(w);
  const dm = -k / sq - sq / 2;
  return Math.min(1, Math.max(0, normCdf(-dm) + normPdf(dm) * w1 / (2 * sq)));
}

export function riskNeutralDensityK(input, k) {
  const s = asSlice(input);
  if (s.method === "mixture") return riskNeutralPdf(s, s.F * Math.exp(k)) * s.F * Math.exp(k);
  const p = sliceSvi(s);
  const w = sviW(p, k), w1 = sviW1(p, k), w2 = sviW2(p, k);
  if (!(w > 0)) return 0;
  const sq = Math.sqrt(w);
  const dm = -k / sq - sq / 2;
  return gatheralG(k, w, w1, w2) * normPdf(dm) / sq;
}

export function riskNeutralPdf(input, K) {
  const s = asSlice(input);
  if (!(K > 0) || !fin(K)) return 0;
  if (s.method === "mixture") {
    const sd = s.params.sigmaD * Math.sqrt(s.T);
    let v = 0;
    for (const c of mixtureComponents(s)) {
      const z = (Math.log(K / (s.F * c.f)) + sd * sd / 2) / sd;
      v += c.w * normPdf(z) / (K * sd);
    }
    return v;
  }
  return riskNeutralDensityK(s, Math.log(K / s.F)) / K;
}

function atmSd(s) {
  if (s.method === "mixture") return Math.sqrt(s.params.sigmaD * s.params.sigmaD * s.T + Math.pow(s.params.J || 0, 2));
  const w = sviW(sliceSvi(s), 0);
  return Math.sqrt(Math.max(w, 1e-8));
}

export function riskNeutralQuantile(input, u) {
  const s = asSlice(input);
  if (!(u > 0)) return 0;
  if (!(u < 1)) return Infinity;
  const sd = atmSd(s);
  let lo = -2 * sd, hi = 2 * sd;
  const cdf = (k) => riskNeutralCdf(s, s.F * Math.exp(k));
  for (let g = 0; g < 200 && cdf(lo) > u; g++) lo -= sd;
  for (let g = 0; g < 200 && cdf(hi) < u; g++) hi += sd;
  for (let i = 0; i < 100 && hi - lo > 1e-14; i++) {
    const m = (lo + hi) / 2;
    if (cdf(m) < u) lo = m; else hi = m;
  }
  return s.F * Math.exp((lo + hi) / 2);
}

export function rndMoments(input) {
  const s = asSlice(input);
  const kLo = Math.log(riskNeutralQuantile(s, 1e-13) / s.F), kHi = Math.log(riskNeutralQuantile(s, 1 - 1e-13) / s.F);
  const sd = atmSd(s);
  const panels = Math.max(16, Math.min(200, Math.ceil((kHi - kLo) / sd)));
  const p = (k) => riskNeutralDensityK(s, k);
  const mass = integrate(p, kLo, kHi, panels, 64);
  const m1 = integrate((k) => k * p(k), kLo, kHi, panels, 64) / mass;
  const c2 = integrate((k) => (k - m1) ** 2 * p(k), kLo, kHi, panels, 64) / mass;
  const c3 = integrate((k) => (k - m1) ** 3 * p(k), kLo, kHi, panels, 64) / mass;
  const c4 = integrate((k) => (k - m1) ** 4 * p(k), kLo, kHi, panels, 64) / mass;
  const meanS = s.F * integrate((k) => Math.exp(k) * p(k), kLo, kHi, panels, 64);
  return {
    mass, mean: meanS, meanLog: m1, varianceLog: c2,
    skewness: c2 > 0 ? c3 / Math.pow(c2, 1.5) : null, kurtosis: c2 > 0 ? c4 / (c2 * c2) - 3 : null,
    range: [kLo, kHi],
  };
}

export function modelFreeVariance(input) {
  const s = asSlice(input);
  if (!s) return null;
  const sd = atmSd(s);
  const lo = -6 * sd, hi = 6 * sd;
  const f = (k) => {
    const K = s.F * Math.exp(k);
    const otm = k < 0 ? slicePutU(s, K) : sliceCallU(s, K);
    return otm * Math.exp(-k) / s.F;
  };
  const left = integrate(f, lo, 0, 12, 32), right = integrate(f, 0, hi, 12, 32);
  const variance = 2 / s.T * (left + right);
  const truncatedMass = riskNeutralCdf(s, s.F * Math.exp(lo)) + 1 - riskNeutralCdf(s, s.F * Math.exp(hi));
  return { variance, vol: Math.sqrt(Math.max(variance, 0)), truncatedMass, range: [lo, hi] };
}

export function impliedMove(input) {
  const s = asSlice(input);
  if (!s) return null;
  const call = sliceCallU(s, s.F), put = slicePutU(s, s.F);
  const straddle = call + put;
  const atmVol = sliceVol(s, s.F);
  return {
    straddle, meanAbsMove: straddle, atmfCall: call,
    ratioToSigmaSqrtT: atmVol ? straddle / (s.F * atmVol * Math.sqrt(s.T)) : null,
    fraction: straddle / s.F,
    oneSigmaBand: [riskNeutralQuantile(s, ONE_SIGMA_LOW), riskNeutralQuantile(s, ONE_SIGMA_HIGH)],
  };
}

export function lawFromSlice(slice) {
  return { kind: "q", slice: asSlice(slice) };
}

export function lawLognormal(input) {
  const { F, sigma, T } = input;
  const s = fin(input.s) ? input.s : sigma * Math.sqrt(T);
  return { kind: "lognormal", F, s };
}

function binShape(a, b, m) {
  if (b === null || !fin(b)) {
    const lambda = m > a ? Math.max(1 + 1e-9, m / (m - a)) : 1e9;
    return { a, b: Infinity, mode: "pareto", lambda };
  }
  if (a === 0 && b > 0 && m > 0 && m < b) return { a: 0, b, mode: "pow", lambda: m / (b - m) };
  const w = b - a, c = (a + b) / 2;
  if (!(w > 0)) return { a, b, mode: "pt", e: a, theta: 1, beta: 0, c, w: 0 };
  const off = m - c;
  if (Math.abs(off) <= w / 6) return { a, b, mode: "lin", beta: 12 * off / (w * w), c, w, theta: 0 };
  const lean = off > 0 ? 1 : -1;
  const triMean = c + lean * w / 6;
  const e = lean > 0 ? b : a;
  const theta = Math.min(1, Math.max(0, (m - triMean) / (e - triMean)));
  return { a, b, mode: "tri", beta: lean * 2 / w, c, w, theta, e };
}

function linCdf(sh, x) {
  if (x <= sh.a) return 0;
  if (x >= sh.b) return 1;
  const u = x - sh.a;
  return u / sh.w + sh.beta / (2 * sh.w) * ((x - sh.c) * (x - sh.c) - sh.w * sh.w / 4);
}

function linHinge(sh, K) {
  if (K <= sh.a) return sh.c + sh.beta * sh.w * sh.w / 12 - K;
  if (K >= sh.b) return 0;
  const L = sh.b - K;
  return (1 / sh.w) * ((1 + sh.beta * (K - sh.c)) * L * L / 2 + sh.beta * L * L * L / 3);
}

function linPartial(sh, lo, hi) {
  const a = Math.max(lo, sh.a), b = Math.min(hi, sh.b);
  if (!(b > a)) return 0;
  const F = (x) => (1 - sh.beta * sh.c) * x * x / 2 + sh.beta * x * x * x / 3;
  return (F(b) - F(a)) / sh.w;
}

const powRatio = (x, e, l) => Math.exp(l * Math.log(x / e));

function shapeCdf(sh, x) {
  if (sh.mode === "pareto") return x <= sh.a ? 0 : 1 - powRatio(sh.a, x, sh.lambda);
  if (sh.mode === "pow") return x <= 0 ? 0 : x >= sh.b ? 1 : powRatio(x, sh.b, sh.lambda);
  if (sh.mode === "pt") return x >= sh.e ? 1 : 0;
  if (sh.mode === "lin") return linCdf(sh, x);
  return (1 - sh.theta) * linCdf(sh, x) + (x >= sh.e ? sh.theta : 0);
}

function shapeHinge(sh, K) {
  if (sh.mode === "pareto") {
    const m = sh.a * sh.lambda / (sh.lambda - 1);
    return K <= sh.a ? m - K : powRatio(sh.a, K, sh.lambda) * K / (sh.lambda - 1);
  }
  if (sh.mode === "pow") {
    const l = sh.lambda, e = sh.b, m = e * l / (l + 1);
    if (K <= 0) return m - K;
    if (K >= e) return 0;
    const r = powRatio(K, e, l);
    return l / (l + 1) * (e - K * r) - K * (1 - r);
  }
  if (sh.mode === "pt") return Math.max(0, sh.e - K);
  if (sh.mode === "lin") return linHinge(sh, K);
  return (1 - sh.theta) * linHinge(sh, K) + sh.theta * Math.max(0, sh.e - K);
}

function shapePartial(sh, lo, hi) {
  if (sh.mode === "pareto") {
    const a = Math.max(lo, sh.a), b = hi;
    if (!(b > a)) return 0;
    const l = sh.lambda;
    const G = (x) => (x === Infinity ? 0 : -l / (l - 1) * sh.a * powRatio(sh.a, x, l - 1));
    return G(b) - G(a);
  }
  if (sh.mode === "pow") {
    const a = Math.max(lo, 0), b = Math.min(hi, sh.b);
    if (!(b > a)) return 0;
    const l = sh.lambda;
    const G = (x) => (x <= 0 ? 0 : l / (l + 1) * x * powRatio(x, sh.b, l));
    return G(b) - G(a);
  }
  if (sh.mode === "pt") return sh.e > lo && sh.e <= hi ? sh.e : 0;
  if (sh.mode === "lin") return linPartial(sh, lo, hi);
  return (1 - sh.theta) * linPartial(sh, lo, hi) + (sh.e > lo && sh.e <= hi ? sh.theta * sh.e : 0);
}

function shapePdf(sh, x) {
  if (sh.mode === "pareto") return x < sh.a ? 0 : sh.lambda / x * powRatio(sh.a, x, sh.lambda);
  if (sh.mode === "pow") return x <= 0 || x > sh.b ? 0 : sh.lambda / x * powRatio(x, sh.b, sh.lambda);
  if (sh.mode === "pt") return 0;
  if (x < sh.a || x > sh.b) return 0;
  const lin = (1 + sh.beta * (x - sh.c)) / sh.w;
  return sh.mode === "lin" ? lin : (1 - sh.theta) * lin;
}

function linQuantile(sh, t) {
  const C = sh.w - sh.beta * sh.w * sh.w / 4 - 2 * sh.w * t;
  const y = -C / (1 + Math.sqrt(Math.max(0, 1 - sh.beta * C)));
  return Math.min(sh.b, Math.max(sh.a, sh.c + y));
}

function shapeQuantile(sh, v) {
  if (sh.mode === "pareto") return sh.a * Math.exp(-Math.log(Math.max(1e-300, 1 - v)) / sh.lambda);
  if (sh.mode === "pow") return sh.b * Math.exp(Math.log(Math.max(1e-300, v)) / sh.lambda);
  if (sh.mode === "pt") return sh.e;
  if (sh.mode === "lin") return linQuantile(sh, v);
  if (sh.e === sh.a) return v <= sh.theta ? sh.a : linQuantile(sh, (v - sh.theta) / (1 - sh.theta));
  const contMass = 1 - sh.theta;
  return v >= contMass ? sh.b : linQuantile(sh, v / contMass);
}

export function lawBinned(input) {
  const S = input.S;
  const edges = input.edges.map((e) => (e === null ? Infinity : e));
  const means = input.means.slice();
  const n = means.length;
  const shapes = [];
  for (let i = 0; i < n; i++) shapes.push(binShape(edges[i] * S, edges[i + 1] === Infinity ? null : edges[i + 1] * S, means[i] * S));
  return { kind: "binned", S, n, edges, means, shapes, p: 1 / n };
}

export function lawMean(law) {
  if (law.kind === "q") return law.slice.F;
  if (law.kind === "lognormal") return law.F;
  let s = 0;
  for (const m of law.means) s += m;
  return s * law.S / law.n;
}

function binIndex(law, x) {
  let lo = 0, hi = law.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (law.shapes[mid].a <= x) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function lawCdf(law, x) {
  if (x === Infinity || x === null) return 1;
  if (!(x > 0)) return 0;
  if (law.kind === "q") return riskNeutralCdf(law.slice, x);
  if (law.kind === "lognormal") return normCdf((Math.log(x / law.F) + law.s * law.s / 2) / law.s);
  const i = binIndex(law, x);
  return (i + shapeCdf(law.shapes[i], x)) * law.p;
}

export function lawPdf(law, x) {
  if (!(x > 0) || !fin(x)) return 0;
  if (law.kind === "q") return riskNeutralPdf(law.slice, x);
  if (law.kind === "lognormal") return normPdf((Math.log(x / law.F) + law.s * law.s / 2) / law.s) / (x * law.s);
  const i = binIndex(law, x);
  return shapePdf(law.shapes[i], x) * law.p;
}

export function lawHinge(law, K) {
  if (!(K > 0)) return lawMean(law) - Math.max(K, 0);
  if (law.kind === "q") return sliceCallU(law.slice, K);
  if (law.kind === "lognormal") return black76(law.F, 1, K, law.s, 1, "C");
  let v = 0;
  const i0 = binIndex(law, K);
  for (let i = i0; i < law.n; i++) v += shapeHinge(law.shapes[i], K);
  return v * law.p;
}

export function lawPartialMean(law, lo, hi) {
  const a = Math.max(0, lo), b = hi === null ? Infinity : hi;
  if (!(b > a)) return 0;
  if (law.kind === "lognormal") {
    const z = (x) => (x === Infinity ? Infinity : (Math.log(x / law.F) - law.s * law.s / 2) / law.s);
    return law.F * (normCdf(z(b)) - (a > 0 ? normCdf(z(a)) : 0));
  }
  if (law.kind === "q") {
    const hin = (x) => (x === Infinity ? 0 : lawHinge(law, x));
    const tail = (x) => hin(x) + x * (1 - lawCdf(law, x));
    return (a > 0 ? tail(a) : law.slice.F) - (b === Infinity ? 0 : tail(b));
  }
  let v = 0;
  for (let i = 0; i < law.n; i++) {
    const sh = law.shapes[i];
    if (sh.b <= a || sh.a >= b) continue;
    v += shapePartial(sh, a, b);
  }
  return v * law.p;
}

export function lawQuantile(law, u) {
  if (!(u > 0)) return 0;
  if (!(u < 1)) return Infinity;
  if (law.kind === "q") return riskNeutralQuantile(law.slice, u);
  if (law.kind === "lognormal") return law.F * Math.exp(-law.s * law.s / 2 + law.s * normInv(u));
  const t = u * law.n;
  const i = Math.min(law.n - 1, Math.floor(t));
  return shapeQuantile(law.shapes[i], t - i);
}

export function lawProb(law, lo, hi) {
  const b = hi === null ? Infinity : hi;
  return Math.max(0, lawCdf(law, b) - lawCdf(law, Math.max(0, lo)));
}

export function binnedFromLognormal(input) {
  const { sigma, T } = input;
  const s = fin(input.s) ? input.s : sigma * Math.sqrt(T);
  const fwd = fin(input.forwardOverSpot) ? input.forwardOverSpot : 1;
  const n = input.bins || LAW_BINS;
  const edges = [0], means = [];
  const zs = [];
  for (let i = 0; i <= n; i++) zs.push(i === 0 ? -Infinity : i === n ? Infinity : normInv(i / n));
  for (let i = 1; i < n; i++) edges.push(fwd * Math.exp(-s * s / 2 + s * zs[i]));
  edges.push(null);
  for (let i = 0; i < n; i++) means.push(n * fwd * (normCdf(zs[i + 1] - s) - normCdf(zs[i] - s)));
  return { edges, means };
}

export function binnedFromSamples(input) {
  const n = input.bins || LAW_BINS;
  const xs = input.logReturns.slice().sort((a, b) => a - b);
  const N = xs.length;
  if (N < n * 2 || N % n) return null;
  const per = N / n;
  const r = xs.map(Math.exp);
  const edges = [0], means = [];
  for (let i = 1; i < n; i++) edges.push((r[i * per - 1] + r[i * per]) / 2);
  edges.push(null);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * per; j < (i + 1) * per; j++) s += r[j];
    means.push(s / per);
  }
  return { edges, means };
}

export function driftNeutralBinned(bins, forwardOverSpot) {
  const m = bins.means.reduce((s, v) => s + v, 0) / bins.means.length;
  const c = forwardOverSpot / m;
  return { edges: bins.edges.map((e) => (e === null ? null : e * c)), means: bins.means.map((v) => v * c), shift: Math.log(c) };
}

export function driftNeutralShift(input) {
  const xs = input.logReturns;
  const fwd = fin(input.forwardOverSpot) ? input.forwardOverSpot : 1;
  let mx = -Infinity;
  for (const x of xs) mx = Math.max(mx, x);
  let s = 0;
  for (const x of xs) s += Math.exp(x - mx);
  const lme = mx + Math.log(s / xs.length);
  return { shift: Math.log(fwd) - lme };
}

export function expectUnderSamples(input) {
  const { S, sigma, T, K } = input;
  const N = input.N || 4096;
  const sd = sigma * Math.sqrt(T), mu = -sigma * sigma * T / 2;
  let pay = 0, itm = 0, fwd = 0;
  for (let i = 0; i < N; i++) {
    const x = mu + sd * normInv((i + 0.5) / N);
    const ST = S * Math.exp(x);
    pay += Math.max(0, ST - K); fwd += ST;
    if (ST > K) itm++;
  }
  const d2 = (Math.log(S / K) - sigma * sigma * T / 2) / sd;
  return {
    callSampleMean: pay / N, pItmSample: itm / N, forwardSampleMean: fwd / N,
    callClosedForm: black76(S, 1, K, sigma, T, "C"), pItmClosedForm: normCdf(d2),
  };
}

export function interpolateBinned(input) {
  const { lower, upper, h, sd } = input;
  const fwd = fin(input.forwardOverSpot) ? input.forwardOverSpot : 1;
  if (!lower || !upper) return null;
  if (lower.h === upper.h || h === lower.h) return driftNeutralBinned(lower, fwd);
  if (h === upper.h) return driftNeutralBinned(upper, fwd);
  const t = (Math.log(h) - Math.log(lower.h)) / (Math.log(upper.h) - Math.log(lower.h));
  const sL = sd(lower.h), sU = sd(upper.h), sT = sd(h);
  const mix = (a, b) => {
    if (a === null || b === null) return null;
    if (a === 0 || b === 0) return 0;
    const u = (1 - t) * Math.log(a) / sL + t * Math.log(b) / sU;
    return Math.exp(u * sT);
  };
  const edges = lower.edges.map((e, i) => mix(e, upper.edges[i]));
  const means = lower.means.map((m, i) => mix(m, upper.means[i]));
  return driftNeutralBinned({ edges, means }, fwd);
}

export function overlayJumps(input) {
  const { bins, jumps } = input;
  const n = input.n || LAW_BINS;
  const fwd = fin(input.forwardOverSpot) ? input.forwardOverSpot : 1;
  const base = lawBinned({ S: 1, edges: bins.edges, means: bins.means });
  const G = (x) => {
    let v = 0;
    for (const j of jumps) v += j.p * lawCdf(base, x * Math.exp(-j.x));
    return v;
  };
  const partial = (lo, hi) => {
    let v = 0;
    for (const j of jumps) {
      const e = Math.exp(j.x);
      v += j.p * e * lawPartialMean(base, lo / e, hi === Infinity ? Infinity : hi / e);
    }
    return v;
  };
  let hiAll = 1;
  while (G(hiAll) < 1 - 1e-12 && hiAll < 1e6) hiAll *= 2;
  const edges = [0];
  for (let i = 1; i < n; i++) {
    const u = i / n;
    let lo = edges[i - 1], hi = hiAll;
    for (let it = 0; it < 100 && hi - lo > 1e-14 * hi; it++) { const m = (lo + hi) / 2; if (G(m) < u) lo = m; else hi = m; }
    edges.push((lo + hi) / 2);
  }
  edges.push(null);
  const means = [];
  for (let i = 0; i < n; i++) means.push(partial(edges[i], edges[i + 1] === null ? Infinity : edges[i + 1]) * n);
  return driftNeutralBinned({ edges, means }, fwd);
}
