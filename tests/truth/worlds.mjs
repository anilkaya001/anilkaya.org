import { makeRng, lgamma, normalCdf, normalSurvival, normalQuantile } from "./rng.mjs";

function betaContinuedFraction(a, b, x) {
  const tiny = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

export function betaInc(x, a, b) {
  if (!(x > 0)) return 0;
  if (!(x < 1)) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function studentCdf(t, nu) {
  const tail = 0.5 * betaInc(nu / (nu + t * t), nu / 2, 0.5);
  return t < 0 ? tail : 1 - tail;
}

export function hansen(nu, lambda) {
  const c = Math.exp(lgamma((nu + 1) / 2) - lgamma(nu / 2)) / Math.sqrt(Math.PI * (nu - 2));
  const a = (4 * lambda * c * (nu - 2)) / (nu - 1);
  const b = Math.sqrt(1 + 3 * lambda * lambda - a * a);
  const unit = Math.sqrt(nu / (nu - 2));
  const cdf = (z) => {
    const left = z < -a / b;
    const u = (b * z + a) / (left ? 1 - lambda : 1 + lambda);
    const t = studentCdf(u * unit, nu);
    return left ? (1 - lambda) * t : (1 - lambda) / 2 + (1 + lambda) * (t - 0.5);
  };
  const draw = (rng) => {
    const y = Math.abs(rng.studentUnit(nu));
    return rng.uniform() < (1 - lambda) / 2 ? (-(1 - lambda) * y - a) / b : ((1 + lambda) * y - a) / b;
  };
  return { nu, lambda, a, b, c, cdf, draw, sf: (k) => 1 - cdf(k), sf2: (k) => 1 - cdf(k) + cdf(-k) };
}

export const W1_PRODUCTION = Object.freeze({ alpha: 0.06, beta: 0.92, variance: 4, nu: 5, lambda: -0.15, n: 750, jumpRate: 0, jumpSd: 4 });

export function w1Garch(opts = {}) {
  const p = { ...W1_PRODUCTION, ...opts };
  const rng = p.rng || makeRng(p.seed ?? "w1");
  const dist = hansen(p.nu, p.lambda);
  const omega = p.variance * (1 - p.alpha - p.beta);
  const burn = p.burn ?? 500;
  const total = p.n + burn;
  const r = new Float64Array(p.n), sigma = new Float64Array(p.n), z = new Float64Array(p.n);
  let s2 = p.variance;
  for (let t = 0; t < total; t++) {
    const s = Math.sqrt(s2);
    const zt = dist.draw(rng);
    let e = s * zt;
    if (p.jumpRate && rng.uniform() < p.jumpRate) e += p.jumpSd * s * rng.normal();
    if (t >= burn) { r[t - burn] = e; sigma[t - burn] = s; z[t - burn] = zt; }
    s2 = omega + p.alpha * e * e + p.beta * s2;
  }
  return { r, sigma, z, nextVariance: s2, params: { ...p, omega }, dist, persistence: p.alpha + p.beta };
}

export function businessDays(n, start = "2020-01-02") {
  const out = [];
  const d = new Date(start + "T00:00:00Z");
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function closesFromReturns(r, start = 100) {
  const px = [start];
  for (let i = 0; i < r.length; i++) px.push(px[px.length - 1] * Math.exp(r[i] / 100));
  return px;
}

export function w1Closes(opts = {}) {
  const w = w1Garch(opts);
  const closes = closesFromReturns(w.r);
  return { ...w, closes, dates: businessDays(closes.length) };
}

export const W4_DEFAULTS = Object.freeze({ rows: 100000, threshold: 2, leakFrac: 1, corr: 0.5 });

export function w4Bait(opts = {}) {
  const p = { ...W4_DEFAULTS, ...opts };
  const rng = p.rng || makeRng(p.seed ?? "w4");
  const pStar = 2 * normalSurvival(p.threshold);
  const s = Math.sqrt(1 / (p.corr * p.corr) - 1);
  const tau2 = (s * s) / (1 + s * s);
  const tau = Math.sqrt(tau2);
  const y = new Uint8Array(p.rows), leaked = new Uint8Array(p.rows);
  const pLeak = new Float64Array(p.rows), x = new Float64Array(p.rows);
  for (let i = 0; i < p.rows; i++) {
    const r = rng.normal();
    y[i] = Math.abs(r) >= p.threshold ? 1 : 0;
    const leak = rng.uniform() < p.leakFrac;
    leaked[i] = leak ? 1 : 0;
    if (leak) {
      const xi = r + s * rng.normal();
      x[i] = xi;
      const mu = xi / (1 + s * s);
      pLeak[i] = normalCdf((-p.threshold - mu) / tau) + 1 - normalCdf((p.threshold - mu) / tau);
    } else {
      x[i] = NaN;
      pLeak[i] = pStar;
    }
  }
  return { y, leaked, pStar, pLeak, x, rows: p.rows, corr: p.corr, leakFrac: p.leakFrac, params: p };
}

export const W7_DEFAULTS = Object.freeze({ sessions: 400, names: 200, pEvent: 0.05, latentRho: 0.12, spread: 0.5 });

export function w7Calibration(opts = {}) {
  const p = { ...W7_DEFAULTS, ...opts };
  const rng = p.rng || makeRng(p.seed ?? "w7");
  const pTrue = new Float64Array(p.names);
  for (let i = 0; i < p.names; i++) pTrue[i] = Math.min(0.5, Math.max(0.002, p.pEvent * Math.exp(p.spread * rng.normal() - 0.5 * p.spread * p.spread)));
  const thresholds = Array.from(pTrue, (q) => normalQuantile(1 - q));
  const y = new Uint8Array(p.sessions * p.names);
  const factor = new Float64Array(p.sessions);
  const a = Math.sqrt(p.latentRho), b = Math.sqrt(1 - p.latentRho);
  for (let t = 0; t < p.sessions; t++) {
    const g = rng.normal();
    factor[t] = g;
    for (let i = 0; i < p.names; i++) y[t * p.names + i] = a * g + b * rng.normal() > thresholds[i] ? 1 : 0;
  }
  const forecast = (scale) => {
    const f = new Float64Array(p.sessions * p.names);
    for (let t = 0; t < p.sessions; t++) for (let i = 0; i < p.names; i++) f[t * p.names + i] = Math.min(0.999, pTrue[i] * scale);
    return f;
  };
  return { sessions: p.sessions, names: p.names, y, pTrue, factor, forecast, params: p, latentRho: p.latentRho };
}

export function indicatorCorrelation(world) {
  const { sessions, names, y, pTrue } = world;
  let num = 0, den = 0;
  for (let t = 0; t < sessions; t++) {
    let sum = 0, sq = 0;
    for (let i = 0; i < names; i++) {
      const d = y[t * names + i] - pTrue[i];
      sum += d; sq += d * d;
    }
    num += sum * sum - sq;
    den += names * (names - 1);
  }
  let v = 0;
  for (let i = 0; i < names; i++) v += pTrue[i] * (1 - pTrue[i]);
  return num / den / (v / names);
}

export function w8Overlap(opts = {}) {
  const p = { n: 4000, h: 5, seed: "w8", ...opts };
  const rng = p.rng || makeRng(p.seed);
  const total = p.n + p.h;
  const r = new Float64Array(total);
  for (let t = 0; t < total; t++) r[t] = rng.normal();
  const prefix = new Float64Array(total + 1);
  for (let t = 0; t < total; t++) prefix[t + 1] = prefix[t] + r[t];
  const R = new Float64Array(p.n), pit = new Float64Array(p.n), z = new Float64Array(p.n);
  const sd = Math.sqrt(p.h);
  for (let t = 0; t < p.n; t++) {
    R[t] = prefix[t + p.h] - prefix[t];
    pit[t] = normalCdf(R[t] / sd);
    z[t] = normalQuantile(Math.min(1 - 1e-12, Math.max(1e-12, pit[t])));
  }
  return { R, pit, z, r, h: p.h, n: p.n, sd, acfTheory: (j) => (j < p.h ? (p.h - j) / p.h : 0), params: p };
}

export function w8Errors(opts = {}) {
  const p = { n: 500, h: 5, seed: "w8e", ...opts };
  const rng = p.rng || makeRng(p.seed);
  const total = p.n + p.h - 1;
  const u1 = new Float64Array(total), u2 = new Float64Array(total);
  for (let t = 0; t < total; t++) { u1[t] = rng.normal(); u2[t] = rng.normal(); }
  const e1 = new Float64Array(p.n), e2 = new Float64Array(p.n), d = new Float64Array(p.n);
  const scale = 1 / Math.sqrt(p.h);
  for (let t = 0; t < p.n; t++) {
    let a = 0, b = 0;
    for (let j = 0; j < p.h; j++) { a += u1[t + j]; b += u2[t + j]; }
    e1[t] = a * scale; e2[t] = b * scale;
    d[t] = e1[t] * e1[t] - e2[t] * e2[t];
  }
  return { e1, e2, d, h: p.h, n: p.n };
}

export const WORLDS = Object.freeze({
  W1: Object.freeze({ id: "W1", title: "GARCH(1,1)-skew-t, the production class", family: "calibration" }),
  W4: Object.freeze({ id: "W4", title: "look-ahead bait", family: "calibration" }),
  W7: Object.freeze({ id: "W7", title: "calibration worlds", family: "calibration" }),
  W8: Object.freeze({ id: "W8", title: "overlapping horizons", family: "calibration" }),
});
