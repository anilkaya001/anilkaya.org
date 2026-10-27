import { UNITS, LIMITS } from "./ff-contract.js";
import { median, benjaminiHochberg } from "./flows-stats.js";
import { fixedHalfUp } from "./flows-display-round.js";
import { priorSessions } from "./ff-session.js";

const finite = (x) => typeof x === "number" && Number.isFinite(x);

export const stepExp = (unit) => Math.round(Math.log10(UNITS[unit].step));

const POW10 = Object.freeze([1, 10, 100, 1000, 10000]);

export function scaledInt(v, unit) {
  if (!finite(v) || !UNITS[unit]) return null;
  const e = stepExp(unit);
  if (e <= 0 && -e < POW10.length) {
    const s = v * POW10[-e];
    const r = Math.round(s);
    if (Math.abs(s) < 1e9 && Math.abs(s - r) < 1e-6) return r === 0 ? 0 : r;
  }
  const n = Number(fixedHalfUp(Math.abs(v), 0, -e));
  return v < 0 && n !== 0 ? -n : n;
}

export const unscaled = (n, unit) => (Number.isInteger(n) ? Number(n + "e" + stepExp(unit)) : null);

export function quantize(v, unit) {
  const n = scaledInt(v, unit);
  return n === null ? null : unscaled(n, unit);
}

export const BAND_SCALE = 20;

export function band20(unit, xi, rule) {
  const r = rule || UNITS[unit].h;
  const ax = Math.abs(xi);
  let h = 0;
  if (r && finite(r.abs)) h = Math.max(h, Math.round((r.abs / UNITS[unit].step) * BAND_SCALE));
  if (r && finite(r.rel)) h = Math.max(h, Math.round(r.rel * BAND_SCALE) * ax);
  if (r && finite(r.mul)) h = Math.max(h, Math.round((1 - r.mul) * BAND_SCALE) * ax);
  return h;
}

export function holdsAt(op, vi, xi, h20) {
  if (op === ">=") return BAND_SCALE * vi >= BAND_SCALE * xi - h20;
  if (op === "<=") return BAND_SCALE * vi <= BAND_SCALE * xi + h20;
  return BAND_SCALE * Math.abs(vi - xi) <= h20;
}

export function holdsEntry(op, vi, xi) {
  if (op === ">=") return vi >= xi;
  if (op === "<=") return vi <= xi;
  return vi === xi;
}

const PHI_SERIES_MAX = 0.75;

function tailIntegral(phi) {
  if (phi > PHI_SERIES_MAX) return phi - (2 / 3) * Math.sin(2 * phi) + Math.sin(4 * phi) / 12;
  let sum = 0;
  let factorial = 24;
  let power = phi ** 5;
  const phi2 = phi * phi;
  for (let k = 2; k < 40; k++) {
    if (k > 2) {
      factorial *= (2 * k - 1) * (2 * k);
      power *= phi2;
    }
    const coefficient = ((k % 2 ? -1 : 1) * (4 ** (2 * k) - 4 * 2 ** (2 * k))) / (8 * factorial);
    const term = (coefficient * power) / (2 * k + 1);
    sum += term;
    if (Math.abs(term) < 1e-18 * Math.abs(sum)) break;
  }
  return sum * (8 / 3);
}

export function tUpper5(t) {
  if (typeof t !== "number" || Number.isNaN(t)) return null;
  if (t === Infinity) return 0;
  if (t === -Infinity) return 1;
  const phi = Math.atan2(Math.sqrt(5), Math.abs(t));
  const tail = tailIntegral(phi) / Math.PI;
  return t >= 0 ? tail : 1 - tail;
}

export const tLower5 = (t) => tUpper5(typeof t === "number" ? -t : t);

export function pValue(z, op) {
  if (!finite(z)) return null;
  if (op === ">=") return tUpper5(z);
  if (op === "<=") return tLower5(z);
  return null;
}

export function tCritical5(p) {
  if (!(p > 0 && p < 1)) return null;
  let lo = -1e6;
  let hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tUpper5(mid) > p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-13 * Math.max(1, Math.abs(mid))) break;
  }
  return (lo + hi) / 2;
}

export function maxP(ps) {
  let out = -Infinity;
  for (const p of ps) {
    if (!finite(p)) return null;
    if (p > out) out = p;
  }
  return out === -Infinity ? null : out;
}

export function bhFamily(ps, q = LIMITS.bhQ) {
  const r = benjaminiHochberg(ps, q);
  let k = 0;
  let pCut = null;
  for (let i = 0; i < ps.length; i++) {
    if (!r.reject[i]) continue;
    k++;
    if (pCut === null || ps[i] > pCut) pCut = ps[i];
  }
  return { reject: r.reject, adjusted: r.adjusted, m: r.m, k, pCut, q };
}

const E_MAX = 5000;

const critCache = new Map();

export function bhCritical(m, q = LIMITS.bhQ) {
  const key = m + "|" + q;
  let crit = critCache.get(key);
  if (crit) return crit;
  crit = new Int32Array(m + 2);
  for (let k = 1; k <= m; k++) {
    const target = (k * q) / m;
    let lo = 0;
    let hi = E_MAX + 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (mid <= E_MAX && tUpper5(mid / 100) <= target) hi = mid;
      else lo = mid + 1;
    }
    crit[k] = lo;
  }
  if (critCache.size > 64) critCache.clear();
  critCache.set(key, crit);
  return crit;
}

export function zKey(zq, op) {
  if (!Number.isFinite(zq)) return null;
  return op === ">=" ? zq : -zq;
}

export function bhCutoff(keys, q = LIMITS.bhQ) {
  const m = keys.length;
  if (m === 0) return { m: 0, k: 0, cutoff: null };
  const crit = bhCritical(m, q);
  const floor = crit[m];
  const cands = [];
  for (let i = 0; i < m; i++) if (keys[i] >= floor) cands.push(keys[i]);
  cands.sort((a, b) => b - a);
  let k = 0;
  for (let r = 1; r <= cands.length; r++) if (cands[r - 1] >= crit[r]) k = r;
  return { m, k, cutoff: k ? crit[k] : null };
}

export function baselineFor(series, session, window = LIMITS.baselineWindow) {
  const days = priorSessions(session, window);
  const get = series instanceof Map ? (d) => series.get(d) : (d) => (series ? series[d] : undefined);
  return days.map((d) => {
    const v = get(d);
    return finite(v) ? v : null;
  });
}

export function robustZ({ x, baseline, floor = null, zSpace = "linear", window = LIMITS.baselineWindow, min = LIMITS.baselineMin }) {
  const fail = (reason, extra = {}) => ({ z: null, zq: null, reason, n: 0, window, median: null, mad: null, scale: null, floored: false, ...extra });
  const log = zSpace === "log";
  if (!finite(x)) return fail("missing");
  const raw = Array.isArray(baseline) ? baseline.slice(0, window) : [];
  const vals = [];
  for (const v of raw) if (finite(v) && (!log || v > 0)) vals.push(log ? Math.log(v) : v);
  const n = vals.length;
  if (n < min) return fail("warming", { n, detail: "baseline " + n + "/" + window + " sessions" });
  if (log && !(x > 0)) return fail("out_of_range", { n });
  const xv = log ? Math.log(x) : x;
  const med = median(vals);
  const mad = median(vals.map((v) => Math.abs(v - med)));
  const spread = LIMITS.madScale * mad;
  const lower = floor ? Math.max(finite(floor.abs) ? floor.abs : 0, (finite(floor.rel) ? floor.rel : 0) * Math.abs(med)) : 0;
  const scale = Math.max(spread, lower);
  if (!(scale > 0)) return fail("thin", { n, median: med, mad });
  const z = (xv - med) / scale;
  return { z, zq: quantize(z, "sigma"), reason: null, n, window, median: med, mad, scale, floored: spread < lower };
}

const KMAX = 60;

function binomialPmf(n, p, upTo) {
  const out = new Float64Array(upTo + 1);
  if (n < 0) return out;
  if (!(p > 0)) {
    out[0] = 1;
    return out;
  }
  if (p >= 1) {
    if (n <= upTo) out[n] = 1;
    return out;
  }
  let v = Math.pow(1 - p, n);
  out[0] = v;
  const r = p / (1 - p);
  for (let i = 0; i < upTo && i < n; i++) {
    v = (v * (n - i) * r) / (i + 1);
    out[i + 1] = v;
  }
  return out;
}

export function rejectionOdds(m, q = LIMITS.bhQ) {
  const K = Math.min(m, KMAX);
  const a = (k) => (k * q) / m;
  const Q = new Float64Array(K + 2);
  Q[1] = 1;
  if (K < 2) return Q;
  const f = new Array(K + 2);
  f[K] = new Float64Array(K - 1).fill(1);
  for (let k = K - 1; k >= 2; k--) {
    const row = new Float64Array(k - 1);
    const pi = q / m / (1 - a(k));
    for (let c = 0; c <= k - 2; c++) {
      const pmf = binomialPmf(m - 1 - c, pi, k - 1 - c);
      let s = 0;
      for (let d = 0; d <= k - 1 - c; d++) s += pmf[d] * f[k + 1][c + d];
      row[c] = s;
    }
    f[k] = row;
  }
  for (let k0 = 2; k0 <= K; k0++) {
    const start = binomialPmf(m - 1, a(k0), k0 - 2);
    let s = 0;
    for (let c = 0; c <= k0 - 2; c++) s += start[c] * f[k0][c];
    Q[k0] = Math.max(0, 1 - s);
  }
  return Q;
}

export function expectedHitsPerNight(m, pThr, q = LIMITS.bhQ) {
  if (!Number.isInteger(m) || m < 1 || !(pThr > 0) || !(q > 0)) return 0;
  const Q = rejectionOdds(m, q);
  const K = Q.length - 2;
  const a1 = q / m;
  let sum = 0;
  for (let k0 = 1; k0 <= K; k0++) {
    const len = Math.min(pThr, k0 * a1) - (k0 - 1) * a1;
    if (len > 0) sum += len * Q[k0];
  }
  return m * sum;
}

export const SESSIONS_PER_WEEK = 5;

export function expectedFalseAlarmsPerWeek(m, tails, q = LIMITS.bhQ) {
  const thr = Array.isArray(tails) ? Math.max(...tails) : tails;
  return SESSIONS_PER_WEEK * expectedHitsPerNight(m, thr, q);
}

export function expWeekCents(m, tails, q = LIMITS.bhQ) {
  return Math.ceil(expectedFalseAlarmsPerWeek(m, tails, q) * 100 - 1e-9);
}

export const E_VALUE_KAPPA = 0.1;

export function eValue(u) {
  if (!finite(u) || u > 1) return null;
  return 0.5 + 0.05 * Math.pow(Math.max(u, 1e-300), -0.9);
}

export const srStep = (r, e) => (1 + r) * e;

export const srBar = (looks, budget) => (looks > 0 && budget > 0 ? looks / budget : null);

export const conservativeP = (rank, n) => (rank + 1) / (n + 1);

export function srRun(es, bar, refractory = 0) {
  const alarms = [];
  let r = 0;
  let quiet = 0;
  for (let i = 0; i < es.length; i++) {
    if (quiet > 0) {
      quiet--;
      continue;
    }
    r = srStep(r, es[i]);
    if (r >= bar) {
      alarms.push(i);
      r = 0;
      quiet = refractory;
    }
  }
  return alarms;
}

export function poissonUpperTail(k, mu) {
  if (!Number.isInteger(k) || !(mu >= 0)) return null;
  if (k <= 0) return 1;
  if (mu === 0) return 0;
  let term = Math.exp(-mu);
  let below = 0;
  for (let i = 0; i < k; i++) {
    below += term;
    term = (term * mu) / (i + 1);
  }
  if (below < 0.5) return 1 - below;
  let tail = 0;
  let t = term;
  for (let i = k; i < k + 2000; i++) {
    tail += t;
    t = (t * mu) / (i + 1);
    if (t < 1e-18 * tail) break;
  }
  return tail;
}

export function calibrationVerdict({ mu0, placebo }, alpha = 0.001) {
  const p = poissonUpperTail(placebo, mu0);
  return { p, suspended: p !== null && p < alpha };
}
