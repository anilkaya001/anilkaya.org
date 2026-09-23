const ERF_A = [3.1611237438705656, 113.86415415105016, 377.485237685302, 3209.3775891384694, 0.18577770618460315];
const ERF_B = [23.601290952344122, 244.02463793444417, 1282.6165260773723, 2844.236833439171];
const ERF_C = [0.5641884969886701, 8.883149794388377, 66.11919063714163, 298.6351381974001, 881.952221241769,
  1712.0476126340707, 2051.0783778260716, 1230.3393547979972, 2.1531153547440383e-8];
const ERF_D = [15.744926110709835, 117.6939508913125, 537.1811018620099, 1621.3895745666903, 3290.7992357334597,
  4362.619090143247, 3439.3676741437216, 1230.3393548037495];
const ERF_P = [0.30532663496123236, 0.36034489994980445, 0.12578172611122926, 0.016083785148742275,
  0.0006587491615298378, 0.016315387137302097];
const ERF_Q = [2.568520192289822, 1.872952849923467, 0.5279051029514284, 0.06051834131244132, 0.0023352049762686918];
const INV_SQRT_PI = 0.5641895835477563;
const SQRT2 = Math.SQRT2;
const INV_SQRT_2PI = 0.3989422804014327;
const SQRT_2PI = 2.5066282746310002;
const THRESH = 0.46875;

export const QUANT_BS_VERSION = 1;

function erfSmall(y) {
  const ysq = y * y;
  let xnum = ERF_A[4] * ysq, xden = ysq;
  for (let i = 0; i < 3; i++) { xnum = (xnum + ERF_A[i]) * ysq; xden = (xden + ERF_B[i]) * ysq; }
  return y * (xnum + ERF_A[3]) / (xden + ERF_B[3]);
}

function erfcRational(y) {
  if (y <= 4) {
    let xnum = ERF_C[8] * y, xden = y;
    for (let i = 0; i < 7; i++) { xnum = (xnum + ERF_C[i]) * y; xden = (xden + ERF_D[i]) * y; }
    return (xnum + ERF_C[7]) / (xden + ERF_D[7]);
  }
  const ysq = 1 / (y * y);
  let xnum = ERF_P[5] * ysq, xden = ysq;
  for (let i = 0; i < 4; i++) { xnum = (xnum + ERF_P[i]) * ysq; xden = (xden + ERF_Q[i]) * ysq; }
  const r = ysq * (xnum + ERF_P[4]) / (xden + ERF_Q[4]);
  return (INV_SQRT_PI - r) / y;
}

function expNegSq(y) {
  const ys = Math.trunc(y * 16) / 16;
  return Math.exp(-ys * ys) * Math.exp(-(y - ys) * (y + ys));
}

function expNegHalfSq(x) {
  const ax = Math.abs(x);
  const xs = Math.trunc(ax * 16) / 16;
  return Math.exp(-xs * xs / 2) * Math.exp(-(ax - xs) * (ax + xs) / 2);
}

export function erfc(x) {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x);
  if (y <= THRESH) return 1 - erfSmall(x);
  if (y >= 26.6) return x < 0 ? 2 : 0;
  const r = expNegSq(y) * erfcRational(y);
  return x < 0 ? 2 - r : r;
}

export function erf(x) {
  const y = Math.abs(x);
  if (y <= THRESH) return erfSmall(x);
  return 1 - erfc(x);
}

export function normPdf(x) {
  if (!Number.isFinite(x)) return 0;
  return INV_SQRT_2PI * expNegHalfSq(x);
}

export function normCdf(x) {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const y = Math.abs(x) / SQRT2;
  if (y <= THRESH) return 0.5 + 0.5 * erfSmall(x / SQRT2);
  if (y >= 26.6) return x < 0 ? 0 : 1;
  const tail = 0.5 * expNegHalfSq(x) * erfcRational(y);
  return x < 0 ? tail : 1 - tail;
}

const ACK_A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const ACK_B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const ACK_C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const ACK_D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

export function normInv(p) {
  if (!(p > 0) || !(p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return NaN;
  }
  let x;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((ACK_C[0] * q + ACK_C[1]) * q + ACK_C[2]) * q + ACK_C[3]) * q + ACK_C[4]) * q + ACK_C[5]) /
      ((((ACK_D[0] * q + ACK_D[1]) * q + ACK_D[2]) * q + ACK_D[3]) * q + 1);
  } else if (p <= 0.97575) {
    const q = p - 0.5, r = q * q;
    x = (((((ACK_A[0] * r + ACK_A[1]) * r + ACK_A[2]) * r + ACK_A[3]) * r + ACK_A[4]) * r + ACK_A[5]) * q /
      (((((ACK_B[0] * r + ACK_B[1]) * r + ACK_B[2]) * r + ACK_B[3]) * r + ACK_B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log1p(-p));
    x = -(((((ACK_C[0] * q + ACK_C[1]) * q + ACK_C[2]) * q + ACK_C[3]) * q + ACK_C[4]) * q + ACK_C[5]) /
      ((((ACK_D[0] * q + ACK_D[1]) * q + ACK_D[2]) * q + ACK_D[3]) * q + 1);
  }
  const e = p < 0.5 ? normCdf(x) - p : (1 - p) - normCdf(-x);
  const pdf = normPdf(x);
  if (pdf > 0) {
    const u = e / pdf;
    x -= u / (1 + x * u / 2);
  }
  return x;
}

const fin = (v) => typeof v === "number" && Number.isFinite(v);

export function forwardOf(S, r, q, T) {
  return S * Math.exp((r - q) * T);
}

export function black76(F, D, K, sigma, T, type) {
  if (!(F > 0) || !(K > 0) || !(D > 0)) return null;
  const nu = sigma * Math.sqrt(Math.max(T, 0));
  if (!(nu > 0)) return D * Math.max(0, type === "P" ? K - F : F - K);
  const d1 = Math.log(F / K) / nu + nu / 2, d2 = d1 - nu;
  if (type === "P") return D * (K * normCdf(-d2) - F * normCdf(-d1));
  return D * (F * normCdf(d1) - K * normCdf(d2));
}

export function black76Price(input) {
  const { F, D = 1, K, sigma, T } = input || {};
  const call = black76(F, D, K, sigma, T, "C"), put = black76(F, D, K, sigma, T, "P");
  return { call, put };
}

export function bsmPrice(input) {
  const { S, K, r = 0, q = 0, sigma, T } = input || {};
  const F = forwardOf(S, r, q, T), D = Math.exp(-r * T);
  if (Array.isArray(input.strikes)) {
    return {
      rows: input.strikes.map((k) => {
        const call = black76(F, D, k, sigma, T, "C"), put = black76(F, D, k, sigma, T, "P");
        return { K: k, call, put, cMinusP: call - put, rhs: S * Math.exp(-q * T) - k * D };
      }),
    };
  }
  return { call: black76(F, D, K, sigma, T, "C"), put: black76(F, D, K, sigma, T, "P") };
}

export function bsmGreeks(input) {
  const { S, K, r = 0, q = 0, sigma, T, type = "C" } = input || {};
  if (!(S > 0) || !(K > 0) || !(sigma > 0) || !(T > 0)) return null;
  const sq = Math.sqrt(T), nu = sigma * sq;
  const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / nu, d2 = d1 - nu;
  const eq = Math.exp(-q * T), er = Math.exp(-r * T);
  const pd1 = normPdf(d1);
  const call = type !== "P";
  const Nd1 = normCdf(d1), Nmd1 = normCdf(-d1), Nd2 = normCdf(d2), Nmd2 = normCdf(-d2);
  const delta = call ? eq * Nd1 : -eq * Nmd1;
  const gamma = eq * pd1 / (S * nu);
  const vega = S * eq * pd1 * sq;
  const theta = call
    ? -S * eq * pd1 * sigma / (2 * sq) - r * K * er * Nd2 + q * S * eq * Nd1
    : -S * eq * pd1 * sigma / (2 * sq) + r * K * er * Nmd2 - q * S * eq * Nmd1;
  const vanna = -eq * pd1 * d2 / sigma;
  const volga = vega * d1 * d2 / sigma;
  const base = -eq * pd1 * (2 * (r - q) * T - d2 * nu) / (2 * T * nu);
  const charm = call ? q * eq * Nd1 + base : -q * eq * Nmd1 + base;
  const rho = call ? K * T * er * Nd2 : -K * T * er * Nmd2;
  const speed = -gamma / S * (d1 / nu + 1);
  return {
    delta, gamma, vega, theta, vanna, volga, charm, rho, speed, d1, d2,
    perUnit: {
      vegaPerVolPoint: vega / 100,
      thetaPerCalendarDay: theta / 365,
      charmPerCalendarDay: charm / 365,
      vannaPerVolPoint: vanna / 100,
      dollarGammaPer1pctPerContract: gamma * 100 * S * S * 0.01,
    },
  };
}

export function dollarGreeks(g, S) {
  if (!g) return null;
  return {
    delta$: g.delta * 100 * S,
    gamma$1pct: g.gamma * 100 * S * S * 0.01,
    vegaPt: g.vega * 100 * 0.01,
    thetaDay: g.theta * 100 / 365,
    vannaPt$: g.vanna * 0.01 * 100 * S,
    charmDay$: g.charm * 100 * S / 365,
  };
}

function normalisedOtmK(k, nu) {
  if (!(nu > 0)) return 0;
  const d1 = -k / nu + nu / 2, d2 = d1 - nu;
  if (k >= 0) return normCdf(d1) - Math.exp(k) * normCdf(d2);
  return Math.exp(k) * normCdf(-d2) - normCdf(-d1);
}

export function black76ImpliedVol(input) {
  const { F, D = 1, K, T, price, type = "C", seed } = input || {};
  return impliedVolB76(F, D, K, T, price, type, seed);
}

export function impliedVolB76(F, D, K, T, price, type, seedVol) {
  if (!fin(F) || !fin(K) || !fin(T) || !fin(price) || !fin(D) || !(F > 0) || !(K > 0) || !(T > 0) || !(D > 0)) return null;
  const k = Math.log(K / F);
  const intrinsic = D * Math.max(0, type === "P" ? K - F : F - K);
  const upper = type === "P" ? D * K : D * F;
  if (!(price > intrinsic) || !(price < upper)) return null;
  const target = (price - intrinsic) / (D * F);
  const cap = k >= 0 ? 1 : Math.exp(k);
  if (!(target > 0) || !(target < cap)) return null;
  const sqT = Math.sqrt(T);
  let nu = fin(seedVol) && seedVol > 0 ? seedVol * sqT : seedTotalVol(k, target);
  if (!(nu > 0) || !fin(nu)) nu = 0.2;
  let lo = 0, hi = Infinity;
  const useLog = target < 1e-6;
  const lt = Math.log(target);
  let converged = false;
  for (let it = 0; it < 100; it++) {
    const v = normalisedOtmK(k, nu);
    const diff = v - target;
    if (Math.abs(diff) <= 1e-13 * target) { converged = true; break; }
    if (diff > 0) hi = nu; else lo = nu;
    const vega = normPdf(-k / nu + nu / 2);
    let next = NaN;
    if (useLog) { if (v > 0 && vega > 0) next = nu - (Math.log(v) - lt) * v / vega; }
    else if (vega > 0) next = nu - diff / vega;
    if (hi === Infinity && next > 2 * nu) next = 2 * nu;
    if (!(next > lo && next < hi)) next = hi === Infinity ? Math.max(2 * nu, 0.05) : (lo + hi) / 2;
    if (Math.abs(next - nu) <= 1e-15 * nu) { nu = next; converged = true; break; }
    nu = next;
    if (nu > 1e3) return null;
  }
  if (!converged && !(hi - lo <= 1e-10 * hi)) return null;
  const sigma = nu / sqT;
  return fin(sigma) && sigma > 0 ? sigma : null;
}

function seedTotalVol(k, c) {
  const a = Math.abs(k);
  if (a < 1e-3) return SQRT_2PI * c;
  const call = k >= 0 ? c : c + 1 - Math.exp(k);
  const K = Math.exp(k);
  const half = call - (1 - K) / 2;
  const disc = half * half - (1 - K) * (1 - K) / Math.PI;
  const cm = SQRT_2PI / (1 + K) * (half + Math.sqrt(Math.max(disc, 0)));
  if (cm > 0 && fin(cm)) return cm;
  return Math.sqrt(2 * a);
}

export function impliedVol(input) {
  const { S, K, r = 0, q = 0, T, price, type = "C" } = input || {};
  if (!fin(S) || !fin(T) || !(S > 0) || !(T > 0)) return null;
  const F = forwardOf(S, r, q, T), D = Math.exp(-r * T);
  return black76ImpliedVol({ F, D, K, T, price, type });
}

export function strikeForDelta(input) {
  const { T, type = "C", delta } = input || {};
  const F = fin(input.F) ? input.F : forwardOf(input.S, input.r || 0, input.q || 0, T);
  const volAt = typeof input.vol === "function" ? input.vol : () => (fin(input.sigma) ? input.sigma : input.vol);
  if (!(F > 0) || !(T > 0) || !fin(delta)) return null;
  const target = type === "P" ? delta + 1 : delta;
  if (!(target > 0 && target < 1)) return null;
  const sq = Math.sqrt(T);
  const fd = (k) => {
    const s = volAt(F * Math.exp(k));
    if (!(s > 0)) return NaN;
    const nu = s * sq;
    return normCdf(-k / nu + nu / 2);
  };
  if (typeof input.vol !== "function") {
    const s = volAt(F), nu = s * sq;
    if (!(s > 0)) return null;
    const d1 = normInv(target);
    const k = -d1 * nu + nu * nu / 2;
    return { K: F * Math.exp(k), k, d1, vol: s, delta };
  }
  let lo = -1, hi = 1, guard = 0;
  while (fd(lo) < target && guard++ < 60) lo *= 2;
  guard = 0;
  while (fd(hi) > target && guard++ < 60) hi *= 2;
  if (!(fd(lo) >= target) || !(fd(hi) <= target)) return null;
  for (let it = 0; it < 200 && hi - lo > 1e-15; it++) {
    const mid = (lo + hi) / 2;
    if (fd(mid) > target) lo = mid; else hi = mid;
  }
  const k = (lo + hi) / 2;
  const s = volAt(F * Math.exp(k)), nu = s * sq;
  return { K: F * Math.exp(k), k, d1: -k / nu + nu / 2, vol: s, delta };
}

export function forwardDelta(F, K, sigma, T, type) {
  const nu = sigma * Math.sqrt(T);
  if (!(nu > 0)) return type === "P" ? (K > F ? -1 : 0) : (K < F ? 1 : 0);
  const d1 = Math.log(F / K) / nu + nu / 2;
  return type === "P" ? normCdf(d1) - 1 : normCdf(d1);
}

export function touchProbability(input) {
  const { S, level: H, vol: s, T, r = 0, q = 0 } = input || {};
  if (!(S > 0) || !(H > 0) || !(s > 0) || !(T > 0)) return null;
  const sq = s * Math.sqrt(T);
  const mu = r - q - s * s / 2;
  const up = H >= S;
  const b = Math.abs(Math.log(H / S));
  const nu = up ? mu : -mu;
  const touch = normCdf((-b + nu * T) / sq) + Math.exp(2 * nu * b / (s * s)) * normCdf((-b - nu * T) / sq);
  const d2 = (Math.log(S / H) + mu * T) / sq;
  const finishBeyond = up ? normCdf(d2) : normCdf(-d2);
  return { touch: Math.min(1, touch), finishBeyond, ratio: finishBeyond > 0 ? touch / finishBeyond : null };
}

export function smileDelta(input) {
  const { S, K, T, r = 0, q = 0, type = "C" } = input || {};
  const F = forwardOf(S, r, q, T);
  const slope = fin(input.skewSlope) ? input.skewSlope : fin(input.dSigmaDk) ? input.dSigmaDk : 0;
  const sigma = fin(input.sigma) ? input.sigma : input.sigmaAtm + slope * Math.log(K / F);
  const g = bsmGreeks({ S, K, r, q, sigma, T, type });
  if (!g) return null;
  const dSigmaDS = -slope / S;
  return { deltaBS: g.delta, vega: g.vega, dSigmaDS, deltaAdjusted: g.delta + g.vega * dSigmaDS, sigma };
}

export function parityForward(input) {
  const { S, T, chain } = input || {};
  if (!(S > 0) || !(T > 0) || !Array.isArray(chain)) return null;
  const seed = fin(input.sigmaSeed) ? input.sigmaSeed : null;
  const window = seed === null ? Infinity : 0.05 + 0.5 * seed * Math.sqrt(T);
  const pairs = chain
    .filter((p) => p && fin(p.K) && fin(p.call) && fin(p.put) && p.K > 0 && Math.abs(Math.log(p.K / S)) <= window)
    .slice().sort((a, b) => a.K - b.K);
  const wOf = (p) => {
    const sp = (fin(p.spreadCall) ? p.spreadCall : 0) + (fin(p.spreadPut) ? p.spreadPut : 0);
    return sp > 0 ? 1 / (sp * sp) : 1;
  };
  if (fin(input.D) && input.D > 0) {
    if (pairs.length < 1) return null;
    const D = input.D;
    let sw = 0, sf = 0;
    for (const p of pairs) { const w = wOf(p); sw += w; sf += w * (p.K + (p.call - p.put) / D); }
    const F = sf / sw, r = -Math.log(D) / T;
    return { F, D, r, q: r - Math.log(F / S) / T, pairs: pairs.length, method: "fixed-discount" };
  }
  if (pairs.length < 3) return null;
  let sw = 0, sx = 0, sy = 0;
  for (const p of pairs) { const w = wOf(p); sw += w; sx += w * p.K; sy += w * (p.call - p.put); }
  const mx = sx / sw, my = sy / sw;
  let sxx = 0, sxy = 0;
  for (const p of pairs) { const w = wOf(p); const dx = p.K - mx; sxx += w * dx * dx; sxy += w * dx * (p.call - p.put - my); }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const D = -slope;
  if (!(D > 0 && D <= 1.5)) return null;
  const intercept = my - slope * mx;
  const F = intercept / D;
  const r = -Math.log(D) / T;
  return { F, D, r, q: r - Math.log(F / S) / T, pairs: pairs.length, method: "regression" };
}

export function impliedCarry(input) {
  const { S, F, r = 0, T } = input || {};
  if (!(S > 0) || !(F > 0) || !(T > 0)) return null;
  return { q: r - Math.log(F / S) / T };
}
