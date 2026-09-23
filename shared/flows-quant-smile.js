import { normCdf, normPdf, black76, black76ImpliedVol, impliedVolB76 } from "./flows-quant-bs.js";

export const SMILE_LINES = Object.freeze({
  TICK: 0.05,
  MIN_TICKS_OVER_INTRINSIC: 0.5,
  VEGA_FLOOR_OF_ATM: 0.01,
  FIT_MAX_REL_SPREAD: 0.6,
  BOTH_SIDES_BAND: 0.02,
  WEIGHT_SPREAD_FLOOR: 0.005,
  WEIGHT_CAP_OF_MEDIAN: 25,
  NULL_BID_SPREAD_OF_MEDIAN: 2,
  CLEAN_MIN_QUOTES: 5,
  CLEAN_FIT_IN_SPREAD: 0.6,
  REPAIR_MAX_FIT_DROP: 0.1,
  MIXTURE_FIT_IN_SPREAD: 0.7,
  REPAIR_LAMBDA: 1e4,
  G_FLOOR: -1e-9,
  LEE_BOUND: 4,
  CHECK_POINTS: 601,
  CHECK_PAD: 0.5,
  SIGMA_FLOOR: 0.005,
  SSVI_ETA_BOUND: 2,
  SSVI_GAMMA_MAX: 0.5,
  SSVI_RHO_MAX: 0.999,
  IN_SPREAD_PASSES: 6,
  IN_SPREAD_ITERATIONS: 60,
  IN_SPREAD_MARGIN: 0.1,
  IN_SPREAD_BOOST: 16,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);

export function sviW(p, k) {
  const x = k - p.m;
  return p.a + p.b * (p.rho * x + Math.sqrt(x * x + p.sigma * p.sigma));
}

export function sviW1(p, k) {
  const x = k - p.m;
  return p.b * (p.rho + x / Math.sqrt(x * x + p.sigma * p.sigma));
}

export function sviW2(p, k) {
  const x = k - p.m, s2 = p.sigma * p.sigma, r = x * x + s2;
  return p.b * s2 / (r * Math.sqrt(r));
}

export function gatheralG(k, w, w1, w2) {
  const t = 1 - k * w1 / (2 * w);
  return t * t - w1 * w1 / 4 * (1 / w + 0.25) + w2 / 2;
}

export function sviG(p, k) {
  return gatheralG(k, sviW(p, k), sviW1(p, k), sviW2(p, k));
}

export function ssviPhi(theta, eta, gamma) {
  return eta * Math.pow(theta, -gamma) * Math.pow(1 + theta, gamma - 1);
}

export function ssviToSvi(q) {
  const phi = ssviPhi(q.theta, q.eta, q.gamma);
  const r = q.rho, s = Math.sqrt(Math.max(0, 1 - r * r));
  return { a: q.theta / 2 * (1 - r * r), b: q.theta * phi / 2, rho: r, m: -r / phi, sigma: s > 0 ? s / phi : 1e-12 };
}

export function ssviTotalVariance(q, k) {
  const phi = ssviPhi(q.theta, q.eta, q.gamma);
  const u = phi * k + q.rho;
  return q.theta / 2 * (1 + q.rho * phi * k + Math.sqrt(u * u + 1 - q.rho * q.rho));
}

export function ssviW(input) {
  const { theta, rho, eta, gamma } = input || {};
  const phi = ssviPhi(theta, eta, gamma);
  const ks = Array.isArray(input.k) ? input.k : [input.k];
  const w = {};
  for (const k of ks) w[String(k)] = ssviTotalVariance({ theta, rho, eta, gamma }, k);
  return { phi, w };
}

const trimNum = (v) => String(Number(v.toFixed(6)));

export function ssviCheck(input) {
  const { eta, rho, gamma } = input || {};
  const thetas = Array.isArray(input.thetas) ? input.thetas : [];
  if (!(gamma > 0 && gamma <= SMILE_LINES.SSVI_GAMMA_MAX)) {
    return { ok: false, code: "ssvi.gamma", why: "gamma: outside (0, 0.5] at " + trimNum(gamma) };
  }
  const bound = eta * (1 + Math.abs(rho));
  if (!(bound <= SMILE_LINES.SSVI_ETA_BOUND + 1e-12)) {
    return { ok: false, code: "ssvi.butterfly", why: "butterfly: eta(1+|rho|) = " + trimNum(bound) };
  }
  for (let i = 1; i < thetas.length; i++) {
    if (thetas[i] < thetas[i - 1]) {
      return { ok: false, code: "ssvi.calendar", why: "calendar: theta decreases between slices " + i + " and " + (i + 1) };
    }
  }
  return { ok: true, code: "ok", why: "ok" };
}

export function sviWingCheck(input) {
  if (Array.isArray(input && input.cases)) {
    const rows = input.cases.map((c) => sviWingCheck(c));
    return { ok: rows.map((r) => r.ok), value: rows.map((r) => r.value) };
  }
  const value = input.b * (1 + Math.abs(input.rho));
  return { ok: value <= SMILE_LINES.LEE_BOUND + 1e-12, value };
}

function gridOf(kGrid) {
  const [lo, hi, step] = kGrid;
  const n = Math.round((hi - lo) / step);
  const out = new Array(n + 1);
  for (let i = 0; i <= n; i++) out[i] = lo + i * step;
  return out;
}

function bisectRoot(f, a, b) {
  let fa = f(a);
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2, fm = f(m);
    if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
    if (b - a <= 1e-15 * Math.max(1, Math.abs(a))) break;
  }
  return (a + b) / 2;
}

function goldenMin(f, a, b) {
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a), d = a + r * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < 120 && b - a > 1e-13; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = f(d); }
  }
  const x = (a + b) / 2;
  return { x, fx: f(x) };
}

function scanNegative(f, grid, floor) {
  let minV = Infinity, minI = -1, first = -1, last = -1;
  const vals = grid.map((k) => f(k));
  for (let i = 0; i < grid.length; i++) {
    const v = vals[i];
    if (v < minV) { minV = v; minI = i; }
    if (v < floor) { if (first < 0) first = i; last = i; }
  }
  const lo = Math.max(0, minI - 1), hi = Math.min(grid.length - 1, minI + 1);
  const g = lo < hi ? goldenMin(f, grid[lo], grid[hi]) : { x: grid[minI], fx: minV };
  const refinedMin = g.fx < minV ? g : { x: grid[minI], fx: minV };
  let region = null;
  if (first >= 0) {
    const shifted = (k) => f(k) - floor;
    const a = first > 0 ? bisectRoot(shifted, grid[first - 1], grid[first]) : grid[first];
    const b = last < grid.length - 1 ? bisectRoot(shifted, grid[last], grid[last + 1]) : grid[last];
    region = [a, b];
  }
  return { min: refinedMin.fx, at: refinedMin.x, region };
}

export function sviButterflyCheck(input) {
  const p = input.svi;
  const grid = gridOf(input.kGrid || [-3, 3, 0.01]);
  const s = scanNegative((k) => sviG(p, k), grid, SMILE_LINES.G_FLOOR);
  let wMin = Infinity;
  for (const k of grid) wMin = Math.min(wMin, sviW(p, k));
  return { ok: s.region === null && wMin > 0, minG: s.min, kAtMinG: s.at, negativeRegion: s.region, minW: wMin };
}

export function calendarCheck(input) {
  const slices = (input.slices || []).slice().sort((a, b) => a.T - b.T);
  const grid = gridOf(input.kGrid || [-1, 1, 0.001]);
  let worstGap = Infinity, worstK = null, envelope = null;
  const pairs = [];
  for (let j = 1; j < slices.length; j++) {
    const f = (k) => sliceTotalVariance(slices[j], k) - sliceTotalVariance(slices[j - 1], k);
    const s = scanNegative(f, grid, -1e-12);
    pairs.push({ from: j - 1, to: j, worstGap: s.min, worstK: s.at, violation: s.region });
    if (s.min < worstGap) { worstGap = s.min; worstK = s.at; }
    if (s.region) envelope = envelope ? [Math.min(envelope[0], s.region[0]), Math.max(envelope[1], s.region[1])] : s.region;
  }
  return { ok: envelope === null, violation: envelope, worstK, worstGap: worstGap === Infinity ? null : worstGap, pairs };
}

const FLAT_CACHE = new WeakMap();

export function sliceSvi(slice) {
  if (!slice) return null;
  if (slice.method === "flat") {
    let p = FLAT_CACHE.get(slice);
    if (!p) { p = { a: slice.params.sigma * slice.params.sigma * slice.T, b: 0, rho: 0, m: 0, sigma: 1 }; FLAT_CACHE.set(slice, p); }
    return p;
  }
  if (slice.method === "ssvi") return slice.raw || ssviToSvi(slice.params);
  if (slice.method === "mixture") return null;
  return slice.params || slice.svi || null;
}

function asSlice(input) {
  if (input && input.method) return input;
  if (input && input.svi) return { method: "svi", T: input.T, F: input.F, D: fin(input.D) ? input.D : 1, params: input.svi };
  if (input && fin(input.flatVol)) return { method: "flat", T: input.T, F: input.F, D: fin(input.D) ? input.D : 1, params: { sigma: input.flatVol } };
  return null;
}

export { asSlice };

export function mixtureComponents(slice) {
  const p = slice.params;
  if (Array.isArray(p.components)) return p.components;
  const J = p.J, c = Math.log(Math.cosh(J));
  const w = Array.isArray(p.weights) ? p.weights : [0.5, 0.5];
  return [{ f: Math.exp(J - c), w: w[0] }, { f: Math.exp(-J - c), w: w[1] }];
}

export function sliceCallU(slice, K) {
  const s = asSlice(slice);
  if (s.method === "mixture") {
    let v = 0;
    for (const c of mixtureComponents(s)) v += c.w * black76(s.F * c.f, 1, K, s.params.sigmaD, s.T, "C");
    return v;
  }
  const k = Math.log(K / s.F);
  const w = sviW(sliceSvi(s), k);
  return black76(s.F, 1, K, Math.sqrt(Math.max(w, 0) / s.T), s.T, "C");
}

export function slicePutU(slice, K) {
  const s = asSlice(slice);
  if (s.method === "mixture") {
    let v = 0;
    for (const c of mixtureComponents(s)) v += c.w * black76(s.F * c.f, 1, K, s.params.sigmaD, s.T, "P");
    return v;
  }
  const k = Math.log(K / s.F);
  const w = sviW(sliceSvi(s), k);
  return black76(s.F, 1, K, Math.sqrt(Math.max(w, 0) / s.T), s.T, "P");
}

export function sliceTotalVariance(slice, k) {
  const s = asSlice(slice);
  if (s.method === "mixture") {
    const K = s.F * Math.exp(k);
    const price = k >= 0 ? sliceCallU(s, K) : slicePutU(s, K);
    const iv = black76ImpliedVol({ F: s.F, D: 1, K, T: s.T, price, type: k >= 0 ? "C" : "P" });
    return iv === null ? null : iv * iv * s.T;
  }
  return sviW(sliceSvi(s), k);
}

export function sliceVol(slice, K) {
  const s = asSlice(slice);
  const w = sliceTotalVariance(s, Math.log(K / s.F));
  return w === null || !(w > 0) ? null : Math.sqrt(w / s.T);
}

export function sliceVolK(slice, k) {
  const s = asSlice(slice);
  const w = sliceTotalVariance(s, k);
  return w === null || !(w > 0) ? null : Math.sqrt(w / s.T);
}

export function sliceSkewSlope(slice, k) {
  const s = asSlice(slice);
  const p = sliceSvi(s);
  if (p) {
    const w = sviW(p, k), w1 = sviW1(p, k);
    return w1 / (2 * Math.sqrt(w * s.T));
  }
  const h = 1e-4;
  const a = sliceVolK(s, k - h), b = sliceVolK(s, k + h);
  return a === null || b === null ? 0 : (b - a) / (2 * h);
}

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function prepareQuotes(input) {
  const { F, D = 1, T } = input || {};
  const tick = fin(input.tick) ? input.tick : SMILE_LINES.TICK;
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const reasons = { row: 0, bid: 0, crossed: 0, tick: 0, intrinsic: 0, spread: 0, itm: 0, iv: 0, vega: 0 };
  if (!(F > 0) || !(T > 0)) return { points: [], rejected: rows.length, reasons };
  const reject = (code) => { reasons[code]++; };
  const sq = Math.sqrt(T);
  const cand = [];
  for (const r of rows) {
    if (!r || !fin(r.K) || !(r.K > 0) || (r.type !== "C" && r.type !== "P")) { reject("row"); continue; }
    const bid = r.bid, ask = r.ask;
    if (!fin(bid) || !(bid > 0)) { reject("bid"); continue; }
    if (!fin(ask) || !(ask >= bid)) { reject("crossed"); continue; }
    const mid = (bid + ask) / 2;
    if (!(mid >= tick - 1e-12)) { reject("tick"); continue; }
    const intrinsic = D * Math.max(0, r.type === "P" ? r.K - F : F - r.K);
    if (!(mid - intrinsic >= SMILE_LINES.MIN_TICKS_OVER_INTRINSIC * tick - 1e-12)) { reject("intrinsic"); continue; }
    if (!((ask - bid) / mid <= SMILE_LINES.FIT_MAX_REL_SPREAD)) { reject("spread"); continue; }
    const k = Math.log(r.K / F);
    const otm = r.type === "P" ? k < 0 : k >= 0;
    if (!otm && Math.abs(k) > SMILE_LINES.BOTH_SIDES_BAND) { reject("itm"); continue; }
    const ivMid = impliedVolB76(F, D, r.K, T, mid, r.type, fin(r.ivSeed) && r.ivSeed > 0 ? r.ivSeed : null);
    if (ivMid === null) { reject("iv"); continue; }
    const ivBid = impliedVolB76(F, D, r.K, T, bid, r.type, ivMid);
    const ivAsk = impliedVolB76(F, D, r.K, T, ask, r.type, ivMid);
    const seed = fin(r.ivSeed) && r.ivSeed > 0 ? r.ivSeed : ivMid;
    const nu = seed * sq;
    const vegaRel = normPdf(-k / nu + nu / 2);
    cand.push({ K: r.K, k, type: r.type, bid, ask, mid, ivMid, ivBid, ivAsk, vegaRel, seed, untraded: !!r.untraded,
      oi: fin(r.oi) ? r.oi : null, sym: r.sym || null });
  }
  let atmSeed = null, best = Infinity;
  for (const c of cand) if (Math.abs(c.k) < best) { best = Math.abs(c.k); atmSeed = c.seed; }
  const atmVega = atmSeed === null ? 0 : normPdf(atmSeed * sq / 2);
  const kept = [];
  for (const c of cand) {
    if (!(c.vegaRel >= SMILE_LINES.VEGA_FLOOR_OF_ATM * atmVega)) { reject("vega"); continue; }
    kept.push(c);
  }
  kept.sort((a, b) => a.K - b.K || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  const byK = [];
  for (const c of kept) {
    const last = byK[byK.length - 1];
    if (last && last.K === c.K) last.rows.push(c); else byK.push({ K: c.K, k: c.k, rows: [c] });
  }
  const points = [];
  for (const g of byK) {
    const rs = g.rows;
    const avg = (f) => {
      const v = rs.map(f);
      if (v.some((x) => x === null)) return null;
      return v.reduce((s, x) => s + x, 0) / v.length;
    };
    points.push({
      K: g.K, k: g.k, iv: avg((r) => r.ivMid), ivBid: avg((r) => r.ivBid), ivAsk: avg((r) => r.ivAsk),
      types: rs.map((r) => r.type).join(""), untraded: rs.every((r) => r.untraded), weight: 0,
    });
  }
  const spreads = points.filter((p) => p.ivBid !== null && p.ivAsk !== null).map((p) => p.ivAsk - p.ivBid);
  const medSpread = median(spreads);
  for (const p of points) {
    const sp = p.ivBid !== null && p.ivAsk !== null ? p.ivAsk - p.ivBid
      : (medSpread === null ? 0.05 : SMILE_LINES.NULL_BID_SPREAD_OF_MEDIAN * medSpread);
    p.weight = 1 / Math.pow(sp + SMILE_LINES.WEIGHT_SPREAD_FLOOR, 2);
    if (p.untraded) p.weight *= 0.5;
  }
  const medW = median(points.map((p) => p.weight));
  if (medW !== null) for (const p of points) p.weight = Math.min(p.weight, SMILE_LINES.WEIGHT_CAP_OF_MEDIAN * medW);
  return { points, rejected: rows.length - kept.length, reasons };
}

const SUBSETS = (() => {
  const out = [];
  for (let a = 0; a < 6; a++) {
    out.push([a]);
    for (let b = a + 1; b < 6; b++) {
      out.push([a, b]);
      for (let c = b + 1; c < 6; c++) out.push([a, b, c]);
    }
  }
  return out.sort((x, y) => x.length - y.length || x[0] - y[0] || (x[1] || 0) - (y[1] || 0) || (x[2] || 0) - (y[2] || 0));
})();
const CN = [1, 0, 0, -1, 0, 0, 0, -1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1];
const CB = new Float64Array(6);
const KKT = new Float64Array(6 * 7);
const SOL = new Float64Array(6);
export const INNER_X = new Float64Array(3);

function solveKkt(d) {
  const w = d + 1;
  for (let c = 0; c < d; c++) {
    let p = c, best = Math.abs(KKT[c * w + c]);
    for (let r = c + 1; r < d; r++) { const v = Math.abs(KKT[r * w + c]); if (v > best) { best = v; p = r; } }
    if (!(best > 1e-300)) return false;
    if (p !== c) for (let j = 0; j < w; j++) { const t = KKT[p * w + j]; KKT[p * w + j] = KKT[c * w + j]; KKT[c * w + j] = t; }
    const piv = KKT[c * w + c];
    for (let r = c + 1; r < d; r++) {
      const f = KKT[r * w + c] / piv;
      if (f === 0) continue;
      for (let j = c; j < w; j++) KKT[r * w + j] -= f * KKT[c * w + j];
    }
  }
  for (let r = d - 1; r >= 0; r--) {
    let v = KKT[r * w + d];
    for (let j = r + 1; j < d; j++) v -= KKT[r * w + j] * SOL[j];
    SOL[r] = v / KKT[r * w + r];
    if (!Number.isFinite(SOL[r])) return false;
  }
  return true;
}

const HBUF = new Float64Array(9);
const GBUF = new Float64Array(3);

function feasibleAdc(a, d, c, tol) {
  for (let j = 0; j < 6; j++) if (CN[3 * j] * a + CN[3 * j + 1] * d + CN[3 * j + 2] * c < CB[j] - tol) return false;
  return true;
}

function quadObj(a, d, c, h00, h01, h02, h11, h12, h22, g0, g1, g2, Sww) {
  return a * (h00 * a + 2 * h01 * d + 2 * h02 * c) + d * (h11 * d + 2 * h12 * c) + h22 * c * c
    - 2 * (g0 * a + g1 * d + g2 * c) + Sww;
}

function innerSolve(ks, ws, W, m, s, aMax) {
  let S0 = 0, Sy = 0, Sz = 0, Syy = 0, Syz = 0, Szz = 0, Sw = 0, Syw = 0, Szw = 0, Sww = 0;
  const n = ks.length, inv = 1 / s;
  for (let i = 0; i < n; i++) {
    const y = (ks[i] - m) * inv, z = Math.sqrt(y * y + 1), wi = W[i], v = ws[i];
    const wy = wi * y, wz = wi * z;
    S0 += wi; Sy += wy; Sz += wz; Syy += wy * y; Syz += wy * z; Szz += wz * z;
    Sw += wi * v; Syw += wy * v; Szw += wz * v; Sww += wi * v * v;
  }
  const h00 = S0, h01 = Sy, h02 = Sz, h11 = Syy, h12 = Syz, h22 = Szz, g0 = Sw, g1 = Syw, g2 = Szw;
  CB[0] = 0; CB[1] = -aMax; CB[2] = 0; CB[3] = 0; CB[4] = -4 * s; CB[5] = -4 * s;
  const tol = 1e-12 * Math.max(1, aMax, 4 * s);
  const c00 = h11 * h22 - h12 * h12, c01 = h02 * h12 - h01 * h22, c02 = h01 * h12 - h02 * h11;
  const det = h00 * c00 + h01 * c01 + h02 * c02;
  if (Math.abs(det) > 1e-300) {
    const c11 = h00 * h22 - h02 * h02, c12 = h01 * h02 - h00 * h12, c22 = h00 * h11 - h01 * h01;
    const a = (c00 * g0 + c01 * g1 + c02 * g2) / det;
    const d = (c01 * g0 + c11 * g1 + c12 * g2) / det;
    const c = (c02 * g0 + c12 * g1 + c22 * g2) / det;
    if (Number.isFinite(a) && Number.isFinite(d) && Number.isFinite(c) && feasibleAdc(a, d, c, tol)) {
      INNER_X[0] = a; INNER_X[1] = d; INNER_X[2] = c;
      return quadObj(a, d, c, h00, h01, h02, h11, h12, h22, g0, g1, g2, Sww);
    }
  }
  const H = HBUF, G = GBUF;
  H[0] = h00; H[1] = h01; H[2] = h02; H[3] = h01; H[4] = h11; H[5] = h12; H[6] = h02; H[7] = h12; H[8] = h22;
  G[0] = g0; G[1] = g1; G[2] = g2;
  let best = NaN, ba = 0, bd = 0, bc = 0;
  for (const S of SUBSETS) {
    const mrows = S.length, dim = 3 + mrows, w = dim + 1;
    KKT.fill(0, 0, dim * w);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) KKT[i * w + j] = 2 * H[3 * i + j];
      for (let t = 0; t < mrows; t++) KKT[i * w + 3 + t] = -CN[3 * S[t] + i];
      KKT[i * w + dim] = 2 * G[i];
    }
    for (let t = 0; t < mrows; t++) {
      const r = 3 + t;
      for (let j = 0; j < 3; j++) KKT[r * w + j] = CN[3 * S[t] + j];
      KKT[r * w + dim] = CB[S[t]];
    }
    if (!solveKkt(dim)) continue;
    const a = SOL[0], d = SOL[1], c = SOL[2];
    if (!feasibleAdc(a, d, c, tol)) continue;
    const f = quadObj(a, d, c, h00, h01, h02, h11, h12, h22, g0, g1, g2, Sww);
    let kkt = true;
    for (let t = 0; t < mrows; t++) if (SOL[3 + t] < -1e-9 * Math.max(1, Math.abs(f))) { kkt = false; break; }
    if (Number.isNaN(best) || f < best) { best = f; ba = a; bd = d; bc = c; }
    if (kkt) break;
  }
  if (Number.isNaN(best)) return NaN;
  INNER_X[0] = ba; INNER_X[1] = bd; INNER_X[2] = bc;
  return best;
}

export function nelderMead(f, x0, steps, opts = {}) {
  const n = x0.length;
  const maxIt = opts.maxIt || 400, ftol = opts.ftol || 1e-15, xtol = opts.xtol || 1e-10, fabs = opts.fabs || 0;
  const pts = [];
  const vals = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const p = Float64Array.from(x0);
    if (i > 0) p[i - 1] += steps[i - 1];
    pts.push(p);
    vals[i] = f(p);
  }
  let evals = n + 1, it = 0;
  const c = new Float64Array(n), xr = new Float64Array(n), xe = new Float64Array(n), xc = new Float64Array(n);
  const order = () => {
    for (let i = 1; i <= n; i++) {
      const pv = vals[i], pp = pts[i];
      let j = i - 1;
      while (j >= 0 && vals[j] > pv) { vals[j + 1] = vals[j]; pts[j + 1] = pts[j]; j--; }
      vals[j + 1] = pv; pts[j + 1] = pp;
    }
  };
  order();
  for (; it < maxIt; it++) {
    const spreadF = Math.abs(vals[n] - vals[0]);
    let spreadX = 0;
    for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) { const d = Math.abs(pts[i][j] - pts[0][j]); if (d > spreadX) spreadX = d; }
    if (spreadX <= xtol || spreadF <= ftol * Math.abs(vals[0]) + fabs) break;
    c.fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const worst = pts[n];
    for (let j = 0; j < n; j++) xr[j] = c[j] + (c[j] - worst[j]);
    const fr = f(xr); evals++;
    if (fr < vals[0]) {
      for (let j = 0; j < n; j++) xe[j] = c[j] + 2 * (c[j] - worst[j]);
      const fe = f(xe); evals++;
      if (fe < fr) { worst.set(xe); vals[n] = fe; } else { worst.set(xr); vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      worst.set(xr); vals[n] = fr;
    } else {
      const outside = fr < vals[n];
      for (let j = 0; j < n; j++) xc[j] = outside ? c[j] + 0.5 * (xr[j] - c[j]) : c[j] + 0.5 * (worst[j] - c[j]);
      const fc = f(xc); evals++;
      if (fc < (outside ? fr : vals[n])) { worst.set(xc); vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) {
          for (let j = 0; j < n; j++) pts[i][j] = pts[0][j] + 0.5 * (pts[i][j] - pts[0][j]);
          vals[i] = f(pts[i]); evals++;
        }
      }
    }
    order();
  }
  return { x: Array.from(pts[0]), f: vals[0], evals, iterations: it };
}

function pointsToArrays(points, T, space) {
  const ks = [], ws = [], W = [];
  for (const p of points) {
    const w = fin(p.w) ? p.w : p.iv * p.iv * T;
    const base = fin(p.weight) ? p.weight : 1;
    ks.push(p.k); ws.push(w);
    if (space === "iv") {
      const iv = fin(p.iv) ? p.iv : Math.sqrt(w / T);
      const d = 2 * iv * T;
      W.push(base / (d * d));
    } else W.push(base);
  }
  return { ks, ws, W };
}

function paramsFrom(x, m, s) {
  const [a, d, c] = x;
  return { a, b: c / s, rho: c > 0 ? Math.max(-1, Math.min(1, d / c)) : 0, m, sigma: s };
}

export function fitSvi(input) {
  const T = input.T;
  const points = (input.points || []).filter((p) => p && fin(p.k) && (fin(p.w) || fin(p.iv))).slice().sort((a, b) => a.k - b.k);
  if (points.length < 3 || !(T > 0)) return null;
  const space = input.space || (points.every((p) => fin(p.w)) ? "w" : "iv");
  const { ks, ws, W } = pointsToArrays(points, T, space);
  const kMin = ks[0], kMax = ks[ks.length - 1];
  const aMax = Math.max(...ws);
  let wAtm = ws[0], bestAbs = Infinity;
  for (let i = 0; i < ks.length; i++) if (Math.abs(ks[i]) < bestAbs) { bestAbs = Math.abs(ks[i]); wAtm = ws[i]; }
  const sAtm = Math.sqrt(Math.max(wAtm, 1e-8));
  const mLo = Math.min(2 * kMin, -1e-3), mHi = Math.max(2 * kMax, 1e-3);
  const lnSLo = Math.log(SMILE_LINES.SIGMA_FLOOR), lnSHi = Math.log(Math.max(10, 4 * (kMax - kMin)));
  const outer = (v) => {
    const m = Math.min(mHi, Math.max(mLo, v[0]));
    const ls = Math.min(lnSHi, Math.max(lnSLo, v[1]));
    const pen = Math.abs(m - v[0]) + Math.abs(ls - v[1]);
    const f0 = innerSolve(ks, ws, W, m, Math.exp(ls), aMax);
    if (Number.isNaN(f0)) return 1e300;
    const f = Math.max(f0, 0);
    return pen > 0 ? f + pen * (1 + f) * 1e3 : f;
  };
  const starts = [];
  for (const m0 of [kMin / 2, 0, kMax / 2]) for (const f0 of [0.5, 2]) starts.push([m0, Math.log(Math.max(SMILE_LINES.SIGMA_FLOOR, f0 * sAtm))]);
  const scale = Math.max(kMax - kMin, 0.01);
  const quick = starts.map((x0) => nelderMead(outer, x0, [0.1 * scale, 0.5], { maxIt: 30, xtol: 1e-4, ftol: 1e-6 }));
  const order = quick.map((r, i) => i).sort((a, b) => quick[a].f - quick[b].f || a - b);
  const xtol = fin(input.xtol) ? input.xtol : 1e-10;
  let best = nelderMead(outer, quick[order[0]].x, [0.02 * scale, 0.1], { maxIt: 400, xtol, ftol: 1e-14 });
  if (quick[order[1]].f < 1.5 * quick[order[0]].f + 1e-300 && Math.abs(quick[order[1]].x[0] - quick[order[0]].x[0]) > 0.05 * scale) {
    const alt = nelderMead(outer, quick[order[1]].x, [0.02 * scale, 0.1], { maxIt: 400, xtol, ftol: 1e-14 });
    if (alt.f < best.f) best = alt;
  }
  let m = Math.min(mHi, Math.max(mLo, best.x[0]));
  let s = Math.exp(Math.min(lnSHi, Math.max(lnSLo, best.x[1])));
  const objective = innerSolve(ks, ws, W, m, s, aMax);
  if (Number.isNaN(objective)) return null;
  let params = paramsFrom([INNER_X[0], INNER_X[1], INNER_X[2]], m, s);
  let stats = fitStats(params, points, T);
  const spreads = space === "iv" && input.inSpread !== false && points.some((p) => fin(p.ivBid) || fin(p.ivAsk));
  const spreadStep = (boost, marginShare) => {
    const Wt = W.slice();
    const wt = ks.map((k, i) => {
      const p = points[i];
      const ivFit = Math.sqrt(Math.max(sviW(params, k), 0) / T);
      const lo = fin(p.ivBid) ? p.ivBid : 0, hi = fin(p.ivAsk) ? p.ivAsk : Infinity;
      if (ivFit >= lo && ivFit <= hi) return ivFit * ivFit * T;
      const margin = Number.isFinite(hi - lo) ? marginShare * (hi - lo) : 0;
      const t = ivFit < lo ? lo + margin : hi - margin;
      Wt[i] = W[i] * boost;
      return t * t * T;
    });
    const aMaxT = Math.max(aMax, ...wt);
    const outerT = (v) => {
      const mm = Math.min(mHi, Math.max(mLo, v[0]));
      const ls = Math.min(lnSHi, Math.max(lnSLo, v[1]));
      const pen = Math.abs(mm - v[0]) + Math.abs(ls - v[1]);
      const f0 = innerSolve(ks, wt, Wt, mm, Math.exp(ls), aMaxT);
      if (Number.isNaN(f0)) return 1e300;
      const f = Math.max(f0, 0);
      return pen > 0 ? f + pen * (1 + f) * 1e3 : f;
    };
    const r = nelderMead(outerT, [m, Math.log(s)], [0.01 * scale, 0.05], { maxIt: SMILE_LINES.IN_SPREAD_ITERATIONS, xtol: 1e-7, ftol: 1e-12 });
    const m2 = Math.min(mHi, Math.max(mLo, r.x[0]));
    const s2 = Math.exp(Math.min(lnSHi, Math.max(lnSLo, r.x[1])));
    if (Number.isNaN(innerSolve(ks, wt, Wt, m2, s2, aMaxT))) return null;
    const p2 = paramsFrom([INNER_X[0], INNER_X[1], INNER_X[2]], m2, s2);
    const st2 = fitStats(p2, points, T);
    const better = st2.fitInSpread > stats.fitInSpread + 1e-12 ||
      (st2.fitInSpread >= stats.fitInSpread - 1e-12 && outsideSpread(p2, points, T) < outsideSpread(params, points, T) * (1 - 1e-6));
    return better ? { p2, st2, m2, s2 } : null;
  };
  for (let pass = 0; spreads && stats.fitInSpread !== null && stats.fitInSpread < 1 && pass < SMILE_LINES.IN_SPREAD_PASSES; pass++) {
    const step = spreadStep(SMILE_LINES.IN_SPREAD_BOOST, SMILE_LINES.IN_SPREAD_MARGIN) || spreadStep(1, 0);
    if (!step) break;
    params = step.p2; stats = step.st2; m = step.m2; s = step.s2;
  }
  return { params, ...stats, space, objective };
}

function outsideSpread(params, points, T) {
  let v = 0;
  for (const p of points) {
    const iv = Math.sqrt(Math.max(sviW(params, p.k), 0) / T);
    const lo = fin(p.ivBid) ? p.ivBid : 0, hi = fin(p.ivAsk) ? p.ivAsk : Infinity;
    const d = iv < lo ? lo - iv : iv > hi ? iv - hi : 0;
    v += (fin(p.weight) ? p.weight : 1) * d * d;
  }
  return v;
}

export function fitStats(params, points, T) {
  let sw = 0, sw2 = 0, siv = 0, n = 0, inSpread = 0, wsum = 0;
  for (const p of points) {
    const w = sviW(params, p.k);
    const target = fin(p.w) ? p.w : p.iv * p.iv * T;
    sw2 += (w - target) * (w - target); n++;
    const ivFit = w > 0 ? Math.sqrt(w / T) : 0;
    const ivQ = fin(p.iv) ? p.iv : Math.sqrt(Math.max(target, 0) / T);
    const wt = fin(p.weight) ? p.weight : 1;
    siv += wt * (ivFit - ivQ) * (ivFit - ivQ); wsum += wt;
    const lo = fin(p.ivBid) ? p.ivBid : 0, hi = fin(p.ivAsk) ? p.ivAsk : Infinity;
    if (fin(p.ivBid) || fin(p.ivAsk)) { if (ivFit >= lo - 1e-12 && ivFit <= hi + 1e-12) inSpread++; sw++; }
  }
  return {
    n, rmseW: n ? Math.sqrt(sw2 / n) : null, rmseIv: wsum > 0 ? Math.sqrt(siv / wsum) : null,
    fitInSpread: sw ? inSpread / sw : null,
  };
}

export function sliceChecks(params, T, kMin, kMax, prev) {
  const lo = kMin - SMILE_LINES.CHECK_PAD, hi = kMax + SMILE_LINES.CHECK_PAD;
  const step = (hi - lo) / (SMILE_LINES.CHECK_POINTS - 1);
  const butterfly = sviButterflyCheck({ svi: params, T, kGrid: [lo, hi, step] });
  const lee = sviWingCheck({ b: params.b, rho: params.rho });
  const minVarValue = params.a + params.b * params.sigma * Math.sqrt(Math.max(0, 1 - params.rho * params.rho));
  const minVar = { ok: minVarValue >= 0, value: minVarValue };
  let calendar = null;
  if (prev) {
    const cal = calendarCheck({ slices: [prev, { method: "svi", T, params }], kGrid: [lo, hi, step] });
    calendar = { ok: cal.ok, worstGap: cal.worstGap, violation: cal.violation };
  }
  return {
    ok: butterfly.ok && lee.ok && minVar.ok && (!calendar || calendar.ok),
    butterfly: { ok: butterfly.ok, minG: butterfly.minG, region: butterfly.negativeRegion },
    lee, minVar, calendar,
  };
}

function penaltyGrid(kMin, kMax, n) {
  const lo = kMin - SMILE_LINES.CHECK_PAD, hi = kMax + SMILE_LINES.CHECK_PAD;
  const out = [];
  for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * i / (n - 1));
  return out;
}

export function fitSviRepaired(input, start) {
  const T = input.T;
  const points = input.points.slice().sort((a, b) => a.k - b.k);
  const { ks, ws, W } = pointsToArrays(points, T, "iv");
  const kMin = ks[0], kMax = ks[ks.length - 1];
  const grid = penaltyGrid(kMin, kMax, 121);
  const prev = input.prev || null;
  const prevW = prev ? grid.map((k) => sliceTotalVariance(prev, k)) : null;
  const lam = SMILE_LINES.REPAIR_LAMBDA;
  const unpack = (v) => ({ a: v[0], b: Math.exp(v[1]), rho: Math.tanh(v[2]), m: v[3], sigma: Math.exp(v[4]) });
  const f = (v) => {
    const p = unpack(v);
    let sse = 0;
    for (let i = 0; i < ks.length; i++) { const r = sviW(p, ks[i]) - ws[i]; sse += W[i] * r * r; }
    let pen = 0;
    for (let j = 0; j < grid.length; j++) {
      const k = grid[j];
      const w = sviW(p, k);
      if (!(w > 0)) { pen += 1 + w * w; continue; }
      const g = gatheralG(k, w, sviW1(p, k), sviW2(p, k));
      if (g < 0) pen += g * g;
      if (prevW && prevW[j] !== null && prevW[j] > w) pen += (prevW[j] - w) * (prevW[j] - w);
    }
    const lee = p.b * (1 + Math.abs(p.rho)) - SMILE_LINES.LEE_BOUND;
    if (lee > 0) pen += lee * lee;
    const mv = p.a + p.b * p.sigma * Math.sqrt(1 - p.rho * p.rho);
    if (mv < 0) pen += mv * mv;
    return sse + lam * pen * Math.max(1, sse);
  };
  const s0 = start || { a: Math.min(...ws) * 0.9, b: 0.1, rho: 0, m: 0, sigma: 0.1 };
  const x0 = [s0.a, Math.log(Math.max(s0.b, 1e-6)), Math.atanh(Math.max(-0.999, Math.min(0.999, s0.rho))), s0.m, Math.log(Math.max(s0.sigma, SMILE_LINES.SIGMA_FLOOR))];
  let r = nelderMead(f, x0, [Math.max(1e-4, Math.abs(s0.a) * 0.2), 0.3, 0.3, 0.05, 0.3], { maxIt: 1500, ftol: 1e-13, xtol: 1e-10 });
  r = nelderMead(f, r.x, [Math.max(1e-5, Math.abs(r.x[0]) * 0.05), 0.1, 0.1, 0.01, 0.1], { maxIt: 1500, ftol: 1e-14, xtol: 1e-11 });
  const params = unpack(r.x);
  return { params, ...fitStats(params, points, T) };
}

function pava(values, weights) {
  const blocks = [];
  for (let i = 0; i < values.length; i++) {
    blocks.push({ v: values[i], w: weights[i], n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const b = blocks.pop(), a = blocks.pop();
      const w = a.w + b.w;
      blocks.push({ v: (a.v * a.w + b.v * b.w) / w, w, n: a.n + b.n });
    }
  }
  const out = [];
  for (const b of blocks) for (let i = 0; i < b.n; i++) out.push(b.v);
  return out;
}

export { pava };

function atmTotalVariance(points, T) {
  const pts = points.slice().sort((a, b) => a.k - b.k);
  const wOf = (p) => (fin(p.w) ? p.w : p.iv * p.iv * T);
  let below = null, above = null;
  for (const p of pts) { if (p.k <= 0) below = p; if (p.k >= 0 && !above) above = p; }
  if (below && above && above.k !== below.k) {
    const t = (0 - below.k) / (above.k - below.k);
    return wOf(below) + t * (wOf(above) - wOf(below));
  }
  const near = below || above;
  return near ? wOf(near) : null;
}

export function fitSsvi(input) {
  const slices = (input.slices || []).map((s) => ({ ...s, points: s.points.slice().sort((a, b) => a.k - b.k) }))
    .sort((a, b) => a.T - b.T);
  if (!slices.length) return null;
  const raw = slices.map((s) => atmTotalVariance(s.points, s.T));
  if (raw.some((v) => !(v > 0))) return null;
  const thetas = pava(raw, slices.map((s) => s.points.length));
  const data = slices.map((s, j) => {
    const arr = pointsToArrays(s.points, s.T, "iv");
    return { ...arr, theta: thetas[j] };
  });
  const unpack = (v) => {
    const rho = SMILE_LINES.SSVI_RHO_MAX * Math.tanh(v[0]);
    const gamma = SMILE_LINES.SSVI_GAMMA_MAX / (1 + Math.exp(-v[2]));
    const etaMax = SMILE_LINES.SSVI_ETA_BOUND / (1 + Math.abs(rho));
    const eta = etaMax / (1 + Math.exp(-v[1]));
    return { rho, eta, gamma };
  };
  const f = (v) => {
    const q = unpack(v);
    let sse = 0;
    for (const d of data) {
      const qq = { theta: d.theta, ...q };
      for (let i = 0; i < d.ks.length; i++) { const r = ssviTotalVariance(qq, d.ks[i]) - d.ws[i]; sse += d.W[i] * r * r; }
    }
    return sse;
  };
  let best = null;
  for (const r0 of [-0.5, 0]) for (const e0 of [0, 1.5]) {
    const r = nelderMead(f, [Math.atanh(r0), e0, 0], [0.4, 0.8, 0.8], { maxIt: 600, ftol: 1e-14, xtol: 1e-10 });
    if (!best || r.f < best.f) best = r;
  }
  const q = unpack(best.x);
  const out = slices.map((s, j) => {
    const params = { theta: thetas[j], ...q };
    const raw2 = ssviToSvi(params);
    return { T: s.T, params, raw: raw2, ...fitStats(raw2, s.points, s.T) };
  });
  return { rho: q.rho, eta: q.eta, gamma: q.gamma, thetas, slices: out, check: ssviCheck({ ...q, thetas }) };
}

export function mixturePrice(input) {
  const { F, T, diffusiveVol } = input || {};
  const up = fin(input.up) ? input.up : null, down = fin(input.down) ? input.down : null;
  const weights = Array.isArray(input.weights) ? input.weights : [0.5, 0.5];
  const components = up !== null && down !== null
    ? [{ f: up, w: weights[0] }, { f: down, w: weights[1] }]
    : mixtureComponents({ params: { J: input.J, weights } });
  const slice = { method: "mixture", T, F, D: 1, params: { components, sigmaD: diffusiveVol } };
  const forward = components.reduce((s, c) => s + c.w * c.f * F, 0);
  const sliceF = { ...slice, F: forward, params: { components: components.map((c) => ({ f: c.f * F / forward, w: c.w })), sigmaD: diffusiveVol } };
  const strikes = Array.isArray(input.strikes) ? input.strikes : [0.92, 0.96, 1, 1.04, 1.08].map((x) => x * F);
  const impliedVols = {};
  for (const K of strikes) impliedVols[String(K)] = sliceVol(sliceF, K);
  const h = 0.02;
  const a = sliceVolK(sliceF, -h), b = sliceVolK(sliceF, 0), c = sliceVolK(sliceF, h);
  return { forward, impliedVols, concaveAtAtm: a !== null && b !== null && c !== null && a + c - 2 * b < 0, slice: sliceF };
}

export function fitMixture(input) {
  const { F, T } = input;
  const points = input.points.slice().sort((a, b) => a.k - b.k);
  if (points.length < 3) return null;
  const fixedSd = fin(input.sigmaD) && input.sigmaD > 0 ? input.sigmaD : null;
  const sq = Math.sqrt(T);
  const data = points.map((p) => {
    const K = F * Math.exp(p.k), type = p.k >= 0 ? "C" : "P";
    const nu = p.iv * sq;
    const price = black76(F, 1, K, p.iv, T, type);
    const vega = F * normPdf(-p.k / nu + nu / 2) * sq;
    return { K, type, price, vega: Math.max(vega, 1e-12), wt: fin(p.weight) ? p.weight : 1 };
  });
  let atmIv = points[0].iv, best0 = Infinity;
  for (const p of points) if (Math.abs(p.k) < best0) { best0 = Math.abs(p.k); atmIv = p.iv; }
  const unpack = (v) => ({ J: Math.exp(v[0]), sigmaD: fixedSd !== null ? fixedSd : Math.exp(v[1]) });
  const f = (v) => {
    const q = unpack(v);
    const slice = { method: "mixture", T, F, params: { J: q.J, sigmaD: q.sigmaD } };
    let sse = 0;
    for (const d of data) {
      const m = d.type === "C" ? sliceCallU(slice, d.K) : slicePutU(slice, d.K);
      const r = (m - d.price) / d.vega;
      sse += d.wt * r * r;
    }
    return sse;
  };
  const j0 = Math.log(Math.max(0.01, atmIv * sq * 0.6));
  const sd0 = Math.log(Math.max(0.05, atmIv * 0.6));
  const r = nelderMead(f, [j0, sd0], [0.5, 0.3], { maxIt: 400, ftol: 1e-13, xtol: 1e-9 });
  const q = unpack(r.x);
  const slice = { method: "mixture", T, F, D: fin(input.D) ? input.D : 1, params: { J: q.J, sigmaD: q.sigmaD } };
  let inSpread = 0, n = 0, siv = 0, wsum = 0;
  for (const p of points) {
    const iv = sliceVolK(slice, p.k);
    if (iv === null) continue;
    const wt = fin(p.weight) ? p.weight : 1;
    siv += wt * (iv - p.iv) * (iv - p.iv); wsum += wt;
    if (fin(p.ivBid) || fin(p.ivAsk)) { n++; if (iv >= (fin(p.ivBid) ? p.ivBid : 0) - 1e-12 && iv <= (fin(p.ivAsk) ? p.ivAsk : Infinity) + 1e-12) inSpread++; }
  }
  return { params: slice.params, fitInSpread: n ? inSpread / n : null, rmseIv: wsum ? Math.sqrt(siv / wsum) : null, n: points.length };
}

function atmConcave(points) {
  const pts = points.slice().sort((a, b) => a.k - b.k);
  let i0 = 0, best = Infinity;
  for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i].k) < best) { best = Math.abs(pts[i].k); i0 = i; }
  if (i0 === 0 || i0 === pts.length - 1) return false;
  const a = pts[i0 - 1], b = pts[i0], c = pts[i0 + 1];
  const slope1 = (b.iv - a.iv) / (b.k - a.k), slope2 = (c.iv - b.iv) / (c.k - b.k);
  return slope2 - slope1 < 0;
}

function flatSlice(F, D, T, points, why) {
  let iv = null, best = Infinity;
  for (const p of points) if (Math.abs(p.k) < best && fin(p.iv)) { best = Math.abs(p.k); iv = p.iv; }
  if (iv === null) return null;
  return { method: "flat", T, F, D, params: { sigma: iv }, n: points.length, fitInSpread: null, rmseIvPts: null, why };
}

export function fitSlice(input) {
  const { F, T } = input;
  const D = fin(input.D) ? input.D : 1;
  const points = (input.points || []).filter((p) => p && fin(p.k) && fin(p.iv)).slice().sort((a, b) => a.k - b.k);
  const prev = input.prev || null;
  const event = input.event || null;
  const base = { T, F, D };
  if (!points.length) return null;
  if (points.length <= 2) return flatSlice(F, D, T, points, "fit.few-quotes");
  const kMin = points[0].k, kMax = points[points.length - 1].k;
  const finish = (method, params, stats, checks, extra) => ({
    ...base, method, params, n: points.length, kMin, kMax,
    fitInSpread: stats.fitInSpread, rmseIvPts: stats.rmseIv === null ? null : stats.rmseIv * 100,
    checks, ...extra,
  });
  const trySsvi = () => {
    const s = fitSsvi({ slices: [{ T, points }] });
    if (!s) return null;
    const sl = s.slices[0];
    const checks = sliceChecks(sl.raw, T, kMin, kMax, prev);
    if (!checks.ok || !s.check.ok) return null;
    return finish("ssvi", sl.params, sl, checks, { raw: sl.raw });
  };
  if (points.length < SMILE_LINES.CLEAN_MIN_QUOTES) return trySsvi() || flatSlice(F, D, T, points, "fit.ssvi-failed");
  const svi = fitSvi({ T, points, space: "iv", xtol: 1e-8 });
  const spansBoth = kMin < 0 && kMax > 0;
  let candidate = null;
  if (svi) {
    const checks = sliceChecks(svi.params, T, kMin, kMax, prev);
    candidate = { svi, checks };
    if (event && event.firstAfter && ((svi.fitInSpread !== null && svi.fitInSpread < SMILE_LINES.MIXTURE_FIT_IN_SPREAD) || atmConcave(points))) {
      const mix = fitMixture({ F, T, D, points, sigmaD: event.sigmaD });
      if (mix && (mix.fitInSpread || 0) >= (svi.fitInSpread || 0)) {
        return { ...base, method: "mixture", params: mix.params, n: points.length, kMin, kMax, fitInSpread: mix.fitInSpread,
          rmseIvPts: mix.rmseIv === null ? null : mix.rmseIv * 100, checks: { ok: true } };
      }
    }
    if (checks.ok && spansBoth && (svi.fitInSpread === null || svi.fitInSpread >= SMILE_LINES.CLEAN_FIT_IN_SPREAD)) {
      return finish("svi", svi.params, svi, checks);
    }
    if (!checks.ok) {
      const rep = fitSviRepaired({ T, points, prev }, svi.params);
      const rchecks = sliceChecks(rep.params, T, kMin, kMax, prev);
      if (rchecks.ok && (rep.fitInSpread === null || svi.fitInSpread === null ||
          rep.fitInSpread >= svi.fitInSpread - SMILE_LINES.REPAIR_MAX_FIT_DROP)) {
        return finish("svi-repaired", rep.params, rep, rchecks);
      }
    }
  }
  const ss = trySsvi();
  const sviOk = !!(candidate && candidate.checks.ok);
  const sviFis = sviOk ? candidate.svi.fitInSpread : null;
  if (ss && (!sviOk || ss.fitInSpread === null || sviFis === null || ss.fitInSpread >= sviFis - 1e-12)) return ss;
  if (sviOk) {
    return finish("svi", candidate.svi.params, candidate.svi, candidate.checks, { why: spansBoth ? "fit.out-of-spread" : "fit.one-sided" });
  }
  return flatSlice(F, D, T, points, "fit.unrepairable");
}

function solveInK(f, target, lo, hi) {
  let a = lo, b = hi, fa = f(a) - target;
  for (let g = 0; g < 60 && fa < 0; g++) { a -= (b - a); fa = f(a) - target; }
  let fb = f(b) - target;
  for (let g = 0; g < 60 && fb > 0; g++) { b += (b - a); fb = f(b) - target; }
  if (!(fa >= 0 && fb <= 0)) return null;
  for (let i = 0; i < 200 && b - a > 1e-13; i++) {
    const m = (a + b) / 2, fm = f(m) - target;
    if (fm > 0) a = m; else b = m;
  }
  return (a + b) / 2;
}

export function sliceDeltaStrike(slice, delta, type) {
  const s = asSlice(slice);
  const d1 = (k) => {
    const w = sliceTotalVariance(s, k);
    const nu = Math.sqrt(Math.max(w, 1e-300));
    return -k / nu + nu / 2;
  };
  const target = type === "P" ? delta + 1 : delta;
  const cdf = (k) => normCdf(d1(k));
  const k = solveInK(cdf, target, -0.5, 0.5);
  if (k === null) return null;
  const vol = sliceVolK(s, k);
  return { k, K: s.F * Math.exp(k), vol, delta };
}

export function sliceDnsStrike(slice) {
  const s = asSlice(slice);
  const h = (k) => -(k - sliceTotalVariance(s, k) / 2);
  const k = solveInK(h, 0, -0.5, 0.5);
  if (k === null) return null;
  return { k, K: s.F * Math.exp(k), vol: sliceVolK(s, k) };
}

export function skewMetrics(input) {
  const s = asSlice(input);
  if (!s) return null;
  const p25 = sliceDeltaStrike(s, -0.25, "P"), c25 = sliceDeltaStrike(s, 0.25, "C");
  const p10 = sliceDeltaStrike(s, -0.10, "P"), c10 = sliceDeltaStrike(s, 0.10, "C");
  const atm = sliceDnsStrike(s);
  if (!p25 || !c25 || !p10 || !c10 || !atm) return null;
  return {
    strikes: { put25: p25.K, call25: c25.K, put10: p10.K, call10: c10.K, atmDns: atm.K },
    vols: { put25: p25.vol, call25: c25.vol, put10: p10.vol, call10: c10.vol, atm: atm.vol },
    rr25: p25.vol - c25.vol, bf25: (p25.vol + c25.vol) / 2 - atm.vol,
    rr10: p10.vol - c10.vol, bf10: (p10.vol + c10.vol) / 2 - atm.vol,
    psi: sliceSvi(s) ? sviW1(sliceSvi(s), 0) / (2 * Math.sqrt(sviW(sliceSvi(s), 0))) : null,
  };
}

export function fixedTenorVol(input) {
  const { near, far, days } = input || {};
  if (!near || !far || !(near.days > 0) || !(far.days > near.days)) return null;
  if (days <= near.days) return { vol: near.vol, extrapolated: days < near.days };
  if (days >= far.days) return { vol: far.vol, extrapolated: days > far.days };
  const w1 = near.vol * near.vol * near.days, w2 = far.vol * far.vol * far.days;
  const t = (days - near.days) / (far.days - near.days);
  const w = w1 + t * (w2 - w1);
  return { vol: Math.sqrt(w / days), extrapolated: false };
}

export function eventVariance(input) {
  const { front, back } = input || {};
  if (!front || !back || !(back.T > front.T) || !(front.T > 0)) return { diffusiveVol: null, eventSd: null, eventMeanAbs: null, why: "event.slices" };
  const sd2 = (back.vol * back.vol * back.T - front.vol * front.vol * front.T) / (back.T - front.T);
  if (!(sd2 > 0)) return { diffusiveVol: null, eventSd: null, eventMeanAbs: null, why: "event.inverted" };
  const J2 = front.vol * front.vol * front.T - sd2 * front.T;
  if (!(J2 > 0)) return { diffusiveVol: Math.sqrt(sd2), eventSd: null, eventMeanAbs: null, why: "event.no-premium" };
  const J = Math.sqrt(J2);
  return { diffusiveVol: Math.sqrt(sd2), eventSd: J, eventMeanAbs: J * Math.sqrt(2 / Math.PI), why: null };
}

export function forwardVol(w1, T1, w2, T2) {
  if (!(T2 > T1)) return null;
  const d = w2 - w1;
  if (!(d > 0)) return { vol: null, why: "calendar.inverted" };
  return { vol: Math.sqrt(d / (T2 - T1)), why: null };
}
