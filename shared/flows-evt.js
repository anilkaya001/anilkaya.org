const fin = (x) => typeof x === "number" && Number.isFinite(x);

export const CHI2_90 = 2.705543454095404;
export const CHI2_95 = 3.841458820694124;
export const XI_LOW = -0.4;
export const XI_HIGH = 0.95;
export const MIN_EXCEEDANCES = 20;

const SMALL_XI = 1e-6;
const PHI = (Math.sqrt(5) - 1) / 2;

const clean = (ys) => {
  const out = [];
  for (const y of ys || []) if (fin(y) && y > 0) out.push(y);
  return Float64Array.from(out);
};

const sumOf = (xs) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s;
};

export function brentMin(f, lo, hi, { tol = 1e-10, maxIter = 200 } = {}) {
  let a = lo;
  let b = hi;
  let x = a + (1 - PHI) * (b - a);
  let w = x;
  let v = x;
  let fx = f(x);
  let fw = fx;
  let fv = fx;
  let d = 0;
  let e = 0;
  for (let i = 0; i < maxIter; i++) {
    const m = 0.5 * (a + b);
    const t1 = tol * Math.abs(x) + 1e-12;
    const t2 = 2 * t1;
    if (Math.abs(x - m) <= t2 - 0.5 * (b - a)) break;
    let useGolden = true;
    if (Math.abs(e) > t1) {
      const r = (x - w) * (fx - fv);
      let q = (x - v) * (fx - fw);
      let p = (x - v) * q - (x - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p;
      q = Math.abs(q);
      const eTemp = e;
      e = d;
      if (!(Math.abs(p) >= Math.abs(0.5 * q * eTemp) || p <= q * (a - x) || p >= q * (b - x))) {
        d = p / q;
        const u = x + d;
        if (u - a < t2 || b - u < t2) d = x < m ? t1 : -t1;
        useGolden = false;
      }
    }
    if (useGolden) {
      e = x >= m ? a - x : b - x;
      d = (1 - PHI) * e;
    }
    const u = Math.abs(d) >= t1 ? x + d : x + (d > 0 ? t1 : -t1);
    const fu = f(u);
    if (fu <= fx) {
      if (u >= x) a = x; else b = x;
      v = w; fv = fw; w = x; fw = fx; x = u; fx = fu;
    } else {
      if (u < x) a = u; else b = u;
      if (fu <= fw || w === x) { v = w; fv = fw; w = u; fw = fu; } else if (fu <= fv || v === x || v === w) { v = u; fv = fu; }
    }
  }
  return { x, fx };
}

export function gpdTerm(u, xi) {
  const z = xi * u;
  if (!(1 + z > 0)) return Infinity;
  const lg = Math.log1p(z);
  return lg + (Math.abs(xi) < SMALL_XI ? u * (1 - z / 2 + (z * z) / 3) : lg / xi);
}

export function gpdNegLogLik(ys, xi, beta) {
  if (!(beta > 0) || !fin(xi)) return Infinity;
  let s = 0;
  for (let i = 0; i < ys.length; i++) {
    const t = gpdTerm(ys[i] / beta, xi);
    if (t === Infinity) return Infinity;
    s += t;
  }
  return ys.length * Math.log(beta) + s;
}

export function gpdSf(y, xi, beta) {
  if (!(y > 0)) return 1;
  const z = xi * y / beta;
  if (!(1 + z > 0)) return 0;
  return Math.abs(xi) < SMALL_XI ? Math.exp(-y / beta) : Math.exp(-Math.log1p(z) / xi);
}

export function gpdIsf(p, xi, beta) {
  if (!(p > 0 && p <= 1)) return null;
  return Math.abs(xi) < SMALL_XI ? -beta * Math.log(p) : (beta / xi) * (Math.pow(p, -xi) - 1);
}

export function betaHat(ys, xi, start = null) {
  const n = ys.length;
  let ymax = 0;
  for (let i = 0; i < n; i++) if (ys[i] > ymax) ymax = ys[i];
  const floor = xi < 0 ? -xi * ymax : 0;
  const target = n / (1 + xi);
  let lo = floor;
  let hi = Infinity;
  let b = start !== null && start > floor ? start : floor + sumOf(ys) / n;
  for (let it = 0; it < 100; it++) {
    let s = 0;
    let d = 0;
    for (let i = 0; i < n; i++) {
      const den = b + xi * ys[i];
      if (!(den > 0)) { s = Infinity; break; }
      s += ys[i] / den;
      d += ys[i] / (den * den);
    }
    if (s === Infinity) { lo = Math.max(lo, b); b = hi === Infinity ? b * 2 : (lo + hi) / 2; continue; }
    const f = s - target;
    if (Math.abs(f) <= 1e-13 * n) return b;
    if (f > 0) lo = b; else hi = b;
    let next = d > 0 ? b + f / d : NaN;
    if (!(next > lo) || next >= hi) next = hi === Infinity ? Math.max(b * 2, lo + 1e-12) : (lo + hi) / 2;
    if (Math.abs(next - b) <= 1e-15 * Math.abs(b)) return next;
    b = next;
  }
  return b;
}

export function profileNegLogLik(ys, xi, start = null) {
  const beta = betaHat(ys, xi, start);
  return { value: gpdNegLogLik(ys, xi, beta), beta };
}

const hessian2 = (f, x, h = [1e-4, 1e-4]) => {
  const f0 = f(x);
  const fa = (da, db) => f([x[0] + da, x[1] + db]);
  const a = (fa(h[0], 0) - 2 * f0 + fa(-h[0], 0)) / (h[0] * h[0]);
  const d = (fa(0, h[1]) - 2 * f0 + fa(0, -h[1])) / (h[1] * h[1]);
  const b = (fa(h[0], h[1]) - fa(h[0], -h[1]) - fa(-h[0], h[1]) + fa(-h[0], -h[1])) / (4 * h[0] * h[1]);
  return [[a, b], [b, d]];
};

export function fitGpd(ys, { minN = MIN_EXCEEDANCES, lo = -0.5, hi = 1.5 } = {}) {
  const y = clean(ys);
  const n = y.length;
  if (n < minN) return null;
  let first = y[0];
  let same = true;
  for (let i = 1; i < n; i++) if (y[i] !== first) { same = false; break; }
  if (same) return null;
  let carry = null;
  const f = (xi) => {
    const p = profileNegLogLik(y, xi, carry);
    carry = p.beta;
    return p.value;
  };
  const coarse = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const xi = lo + ((hi - lo) * i) / steps;
    coarse.push([xi, f(xi)]);
  }
  let best = 0;
  for (let i = 1; i < coarse.length; i++) if (coarse[i][1] < coarse[best][1]) best = i;
  const left = coarse[Math.max(0, best - 1)][0];
  const right = coarse[Math.min(steps, best + 1)][0];
  const refined = brentMin(f, left, right, { tol: 1e-11 });
  const xi = refined.x;
  const beta = betaHat(y, xi);
  const nll = gpdNegLogLik(y, xi, beta);
  const boundary = xi - lo < 1e-6 || hi - xi < 1e-6;
  const h = 1e-4;
  const curvature = (f(xi + h) - 2 * f(xi) + f(xi - h)) / (h * h);
  let seXi = curvature > 0 ? 1 / Math.sqrt(curvature) : null;
  let seLnBeta = null;
  const H = hessian2((p) => gpdNegLogLik(y, p[1], Math.exp(p[0])), [Math.log(beta), xi]);
  const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
  if (det > 0 && H[0][0] > 0) seLnBeta = Math.sqrt(H[1][1] / det);
  return { xi, beta, nll, n, se: { xi: seXi, lnBeta: seLnBeta }, boundary };
}

export function profileInterval(ys, fit = null, { level = 0.9, lo = -0.9, hi = 3 } = {}) {
  const y = clean(ys);
  const mle = fit || fitGpd(y);
  if (!mle) return null;
  const crit = level === 0.9 ? CHI2_90 : level === 0.95 ? CHI2_95 : null;
  if (crit === null) throw new Error("flows-evt: the level is 0.9 or 0.95");
  let carry = mle.beta;
  const excess = (xi) => {
    const p = profileNegLogLik(y, xi, carry);
    if (Number.isFinite(p.value)) carry = p.beta;
    return 2 * (p.value - mle.nll) - crit;
  };
  const root = (a, b) => {
    let fa = excess(a);
    const fb = excess(b);
    if (!(fa * fb < 0)) return null;
    for (let i = 0; i < 80; i++) {
      const m = 0.5 * (a + b);
      const fm = excess(m);
      if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      if (Math.abs(b - a) < 1e-10) break;
    }
    return 0.5 * (a + b);
  };
  const lower = root(lo, mle.xi);
  const upper = root(mle.xi, hi);
  return { level, lo: lower, hi: upper, xi: mle.xi, open: lower === null || upper === null };
}

export function exceedances(values, q = 0.925) {
  const abs = Float64Array.from(values || [], (v) => (fin(v) ? Math.abs(v) : NaN)).filter((v) => !Number.isNaN(v));
  if (abs.length < 2) return { y: new Float64Array(0), index: new Int32Array(0), threshold: null };
  const sorted = Float64Array.from(abs).sort();
  const u = sorted[Math.floor(q * (sorted.length - 1))];
  const y = [];
  const index = [];
  let k = 0;
  for (let i = 0; i < (values || []).length; i++) {
    const v = values[i];
    if (!fin(v)) continue;
    const a = Math.abs(v);
    if (a > u) { y.push(a - u); index.push(i); }
    k++;
  }
  return { y: Float64Array.from(y), index: Int32Array.from(index), threshold: u };
}

export function exceedanceGroups(series, { q = 0.925 } = {}) {
  return series.map((values) => exceedances(values, q)).filter((g) => g.y.length > 0);
}

const yOf = (g) => (g && g.y ? g.y : g);

export function pooledNegLogLik(groups, xi, { scale = "mean" } = {}) {
  if (!(xi < 1)) return Infinity;
  let total = 0;
  for (const g of groups) {
    const y = yOf(g);
    const n = y.length;
    if (!n) continue;
    const beta = scale === "profile" ? betaHat(y, xi) : (sumOf(y) / n) * (1 - xi);
    if (!(beta > 0)) return Infinity;
    let s = 0;
    for (let k = 0; k < n; k++) {
      const t = gpdTerm(y[k] / beta, xi);
      if (t === Infinity) return Infinity;
      s += t;
    }
    total += n * Math.log(beta) + s;
  }
  return total;
}

export function pooledShape(groups, { lo = XI_LOW, hi = XI_HIGH, scale = "mean" } = {}) {
  const live = groups.filter((g) => yOf(g).length > 0);
  const count = live.reduce((a, g) => a + yOf(g).length, 0);
  if (!live.length || count < MIN_EXCEEDANCES) return null;
  const f = (xi) => pooledNegLogLik(live, xi, { scale });
  const grid = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const xi = lo + ((hi - lo) * i) / steps;
    grid.push([xi, f(xi)]);
  }
  let best = 0;
  for (let i = 1; i < grid.length; i++) if (grid[i][1] < grid[best][1]) best = i;
  const a = grid[Math.max(0, best - 1)][0];
  const b = grid[Math.min(steps, best + 1)][0];
  const { x: xi } = brentMin(f, a, b, { tol: 1e-11 });
  const h = 1e-3;
  const d2 = (f(xi + h) - 2 * f(xi) + f(xi - h)) / (h * h);
  return {
    xi, se: d2 > 0 ? 1 / Math.sqrt(d2) : null, n: count, names: live.length, nll: f(xi),
    boundary: xi - lo < 1e-6 || hi - xi < 1e-6,
  };
}

export function pooledInterval(groups, fit = null, { level = 0.9, lo = XI_LOW, hi = XI_HIGH, scale = "mean", inflate = 1 } = {}) {
  const mle = fit || pooledShape(groups, { lo, hi, scale });
  if (!mle) return null;
  const base = level === 0.9 ? CHI2_90 : level === 0.95 ? CHI2_95 : null;
  if (base === null) throw new Error("flows-evt: the level is 0.9 or 0.95");
  const crit = base * inflate;
  const live = groups.filter((g) => yOf(g).length > 0);
  const excess = (xi) => 2 * (pooledNegLogLik(live, xi, { scale }) - mle.nll) - crit;
  const root = (a, b) => {
    let fa = excess(a);
    const fb = excess(b);
    if (!(fa * fb < 0)) return null;
    for (let i = 0; i < 80; i++) {
      const m = 0.5 * (a + b);
      const fm = excess(m);
      if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      if (Math.abs(b - a) < 1e-10) break;
    }
    return 0.5 * (a + b);
  };
  const lower = root(lo, mle.xi);
  const upper = root(mle.xi, hi);
  return { level, lo: lower, hi: upper, xi: mle.xi, open: lower === null || upper === null };
}

export const Z90 = 1.6448536269514722;
export const Z95 = 1.959963984540054;

export function shapeScore(u, xi) {
  if (Math.abs(xi) < 1e-3) {
    const h = 1e-4;
    const l = (x) => -Math.log(1) - (1 + 1 / x) * Math.log1p(x * u) - Math.log(1 - x);
    return (l(xi + h) - l(xi - h)) / (2 * h);
  }
  return 1 / (1 - xi) + Math.log1p(xi * u) / (xi * xi) - ((1 + xi) / xi) * (u / ((1 - xi) * (1 + xi * u)));
}

export function shapeScoreMean(u, xi, m) {
  const t = 1 + xi * u;
  const du = 1 / (xi * t) - ((1 + xi) / (xi * (1 - xi))) / (t * t);
  return Math.abs(xi) < 1e-3 ? 0 : (-u / m) * du;
}

export function pooledClustered(groups, fit = null, { level = 0.9, days = null, scale = "mean" } = {}) {
  const mle = fit || pooledShape(groups, { scale });
  if (!mle || !(mle.se > 0)) return null;
  const z = level === 0.9 ? Z90 : level === 0.95 ? Z95 : null;
  if (z === null) throw new Error("flows-evt: the level is 0.9 or 0.95");
  const clusters = new Map();
  const xi = mle.xi;
  for (const g of groups) {
    const y = yOf(g);
    const index = g && g.index;
    const n = y.length;
    if (!n) continue;
    if (!index || index.length !== n) return null;
    const m = sumOf(y) / n;
    let correction = 0;
    const u = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      u[j] = y[j] / (m * (1 - xi));
      correction += shapeScoreMean(u[j], xi, m);
    }
    correction /= n;
    for (let j = 0; j < n; j++) {
      const s = shapeScore(u[j], xi) + correction * (y[j] - m);
      clusters.set(index[j], (clusters.get(index[j]) || 0) + s);
    }
  }
  const total = days && days > clusters.size ? days : clusters.size;
  let sumSq = 0;
  for (const v of clusters.values()) sumSq += v * v;
  const information = 1 / (mle.se * mle.se);
  const factor = total > 1 ? total / (total - 1) : 1;
  const variance = (sumSq / (information * information)) * factor;
  const se = Math.sqrt(variance);
  return {
    xi, se, modelSe: mle.se, design: variance / (mle.se * mle.se), clusters: clusters.size, level,
    lo: xi - z * se, hi: xi + z * se,
  };
}

export function pooledClusteredInterval(groups, fit = null, { level = 0.9, days = null, scale = "mean" } = {}) {
  const mle = fit || pooledShape(groups, { scale });
  const cl = mle ? pooledClustered(groups, mle, { level, days, scale }) : null;
  if (!cl) return null;
  const iv = pooledInterval(groups, mle, { level, scale, inflate: Math.max(1, cl.design) });
  return iv ? { ...iv, se: cl.se, design: cl.design, clusters: cl.clusters } : null;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dateBootstrapShape(series, { q = 0.925, reps = 200, block = 1, seed = 1, scale = "mean" } = {}) {
  const names = series.length;
  const days = names ? series[0].length : 0;
  if (!names || days < 2 * Math.max(1, block)) return null;
  const rand = mulberry(seed);
  const estimates = [];
  const picked = new Int32Array(days);
  for (let b = 0; b < reps; b++) {
    for (let t = 0; t < days; t += block) {
      const start = Math.floor(rand() * days);
      for (let k = 0; k < block && t + k < days; k++) picked[t + k] = (start + k) % days;
    }
    const resampled = series.map((row) => Float64Array.from(picked, (d) => row[d]));
    const fit = pooledShape(exceedanceGroups(resampled, { q }), { scale });
    if (fit) estimates.push(fit.xi);
  }
  if (estimates.length < 2) return null;
  const mean = estimates.reduce((a, c) => a + c, 0) / estimates.length;
  const sd = Math.sqrt(estimates.reduce((a, c) => a + (c - mean) ** 2, 0) / (estimates.length - 1));
  const sorted = Float64Array.from(estimates).sort();
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  return { se: sd, mean, reps: estimates.length, lo: at(0.05), hi: at(0.95), estimates };
}

export function tCritical95(df) {
  if (!(df >= 1)) return null;
  const z = Z90;
  const z2 = z * z;
  const z3 = z2 * z;
  const z5 = z3 * z2;
  const z7 = z5 * z2;
  const exact = { 1: 6.313751514675043, 2: 2.919985580353725, 3: 2.353363435735641, 4: 2.131846786326649, 5: 2.015048372669157 };
  if (Object.hasOwn(exact, df)) return exact[df];
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df) + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df * df * df);
}

export function dropDates(series, from, to) {
  return series.map((row) => {
    const out = new Float64Array(row.length - (to - from));
    let k = 0;
    for (let t = 0; t < row.length; t++) if (t < from || t >= to) out[k++] = row[t];
    return out;
  });
}

export function pooledJackknife(series, { q = 0.925, blocks = 6, scale = "mean", level = 0.9 } = {}) {
  const names = series.length;
  const days = names ? series[0].length : 0;
  if (!names || blocks < 2 || days < 2 * blocks) return null;
  const full = pooledShape(exceedanceGroups(series, { q }), { scale });
  if (!full) return null;
  const size = Math.floor(days / blocks);
  const estimates = [];
  for (let g = 0; g < blocks; g++) {
    const from = g * size;
    const to = g === blocks - 1 ? days : (g + 1) * size;
    const fit = pooledShape(exceedanceGroups(dropDates(series, from, to), { q }), { scale });
    if (fit) estimates.push(fit.xi);
  }
  if (estimates.length < 2) return null;
  const g = estimates.length;
  const mu = estimates.reduce((a, b) => a + b, 0) / g;
  const variance = ((g - 1) / g) * estimates.reduce((a, b) => a + (b - mu) ** 2, 0);
  const se = Math.sqrt(variance);
  const crit = level === 0.9 ? tCritical95(g - 1) : level === 0.95 ? null : null;
  if (crit === null) throw new Error("flows-evt: the jackknife interval is at level 0.9");
  return {
    xi: full.xi, se, modelSe: full.se, design: variance / (full.se * full.se), blocks: g, level,
    lo: full.xi - crit * se, hi: full.xi + crit * se, biasCorrected: g * full.xi - (g - 1) * mu, estimates,
  };
}

const sortedAbs = (values) => Float64Array.from((values || []).filter((v) => fin(v)), Math.abs).sort();

export function hill(values, k) {
  const a = sortedAbs(values).filter((v) => v > 0);
  const n = a.length;
  if (!(k >= 2) || k >= n) return null;
  const ref = a[n - 1 - k];
  let s = 0;
  for (let i = 0; i < k; i++) s += Math.log(a[n - 1 - i] / ref);
  const xi = s / k;
  return { xi, se: xi / Math.sqrt(k), k, n };
}

export function hillCurve(values, ks) {
  return ks.map((k) => hill(values, k)).filter(Boolean);
}

export function meanExcess(values, thresholds) {
  const a = sortedAbs(values);
  return thresholds.map((u) => {
    let n = 0;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] > u) { const e = a[i] - u; n++; s += e; s2 += e * e; }
    }
    if (n < 2) return { u, n, e: n ? s : null, se: null };
    const e = s / n;
    return { u, n, e, se: Math.sqrt(Math.max(0, (s2 - n * e * e) / (n - 1)) / n) };
  });
}

export function meanExcessShape(rows) {
  const live = rows.filter((r) => r.e !== null && r.se !== null && r.se > 0 && r.n >= 10);
  if (live.length < 3) return null;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const r of live) {
    const w = 1 / (r.se * r.se);
    sw += w; sx += w * r.u; sy += w * r.e; sxx += w * r.u * r.u; sxy += w * r.u * r.e;
  }
  const slope = (sw * sxy - sx * sy) / (sw * sxx - sx * sx);
  return { slope, xi: slope / (1 + slope), points: live.length };
}

export function thresholdStability(series, qs, { scale = "mean", level = 0.9 } = {}) {
  const z = level === 0.9 ? Z90 : Z95;
  const rows = [];
  for (const q of qs) {
    const fit = pooledShape(exceedanceGroups(series, { q }), { scale });
    if (fit) rows.push({ q, xi: fit.xi, se: fit.se, n: fit.n });
  }
  let stableFrom = null;
  for (let i = 0; i < rows.length && stableFrom === null; i++) {
    let ok = true;
    for (let j = i + 1; j < rows.length; j++) {
      const spread = Math.sqrt(Math.max(rows[j].se * rows[j].se - rows[i].se * rows[i].se, 0));
      if (Math.abs(rows[j].xi - rows[i].xi) > z * spread) { ok = false; break; }
    }
    if (ok) stableFrom = rows[i].q;
  }
  return { rows, stableFrom };
}

export function semiParametricLaw(values, { tail = 0.075, absolute = false, minTail = MIN_EXCEEDANCES } = {}) {
  const xs = Float64Array.from((values || []).filter((v) => fin(v)), (v) => (absolute ? Math.abs(v) : v)).sort();
  const n = xs.length;
  if (n < 2 * minTail || !(tail > 0 && tail < 0.5)) return null;
  const side = (sign) => {
    const k = Math.floor(tail * n);
    const edge = sign > 0 ? xs[n - 1 - k] : xs[k];
    const ex = [];
    for (let i = 0; i < n; i++) {
      const e = sign > 0 ? xs[i] - edge : edge - xs[i];
      if (e > 0) ex.push(e);
    }
    const fit = fitGpd(Float64Array.from(ex), { minN: minTail });
    return fit ? { u: edge, xi: fit.xi, beta: fit.beta, n: ex.length, rate: ex.length / n } : null;
  };
  const upper = side(1);
  const lower = absolute ? null : side(-1);
  if (!upper || (!absolute && !lower)) return null;
  const countAbove = (x) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid + 1; }
    return n - lo;
  };
  const sf = (x) => {
    if (x > upper.u) return upper.rate * gpdSf(x - upper.u, upper.xi, upper.beta);
    if (!absolute && x < lower.u) return 1 - lower.rate * gpdSf(lower.u - x, lower.xi, lower.beta);
    return countAbove(x) / n;
  };
  const cdf = (x) => 1 - sf(x);
  const isf = (p) => {
    if (!(p > 0 && p < 1)) return null;
    if (p < upper.rate) return upper.u + gpdIsf(p / upper.rate, upper.xi, upper.beta);
    if (!absolute && 1 - p < lower.rate) return lower.u - gpdIsf((1 - p) / lower.rate, lower.xi, lower.beta);
    return quantileSortedAt(xs, 1 - p);
  };
  return { sf, cdf, isf, quantile: (p) => isf(1 - p), upper, lower, n, absolute };
}

const quantileSortedAt = (sorted, p) => {
  const h = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
};

export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function invertMatrix(A) {
  const n = A.length;
  const cols = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    const col = solveLinear(A, e);
    if (!col) return null;
    cols.push(col);
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
}

function covariateNll(y, X, gamma, xi) {
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    let eta = 0;
    for (let k = 0; k < gamma.length; k++) eta += X[i][k] * gamma[k];
    const t = gpdTerm(y[i] * Math.exp(-eta), xi);
    if (t === Infinity) return Infinity;
    s += eta + t;
  }
  return s;
}

function covariateGamma(y, X, xi, start) {
  const n = y.length;
  const p = X[0].length;
  let gamma = start.slice();
  let value = covariateNll(y, X, gamma, xi);
  for (let it = 0; it < 60; it++) {
    const g = new Array(p).fill(0);
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      let eta = 0;
      for (let k = 0; k < p; k++) eta += X[i][k] * gamma[k];
      const w = y[i] * Math.exp(-eta);
      const d = 1 + xi * w;
      const gi = 1 - ((1 + xi) * w) / d;
      const hi = ((1 + xi) * w) / (d * d);
      for (let k = 0; k < p; k++) {
        g[k] += X[i][k] * gi;
        for (let l = 0; l <= k; l++) H[k][l] += X[i][k] * X[i][l] * hi;
      }
    }
    for (let k = 0; k < p; k++) for (let l = k + 1; l < p; l++) H[k][l] = H[l][k];
    for (let k = 0; k < p; k++) H[k][k] += 1e-12;
    const step = solveLinear(H, g);
    if (!step) break;
    let t = 1;
    let next = null;
    let nextValue = Infinity;
    for (let h = 0; h < 40; h++) {
      const cand = gamma.map((v, k) => v - t * step[k]);
      const val = covariateNll(y, X, cand, xi);
      if (val < value || (val === value && h === 0)) { next = cand; nextValue = val; break; }
      t /= 2;
    }
    if (!next) break;
    const move = Math.max(...next.map((v, k) => Math.abs(v - gamma[k])));
    gamma = next;
    value = nextValue;
    if (move < 1e-11) break;
  }
  return { gamma, value };
}

export function covariateGpd(ys, X, { lo = -0.5, hi = 1.5, minN = MIN_EXCEEDANCES } = {}) {
  const keep = [];
  for (let i = 0; i < ys.length; i++) if (fin(ys[i]) && ys[i] > 0 && X[i] && X[i].every(fin)) keep.push(i);
  const n = keep.length;
  if (n < minN) return null;
  const y = keep.map((i) => ys[i]);
  const M = keep.map((i) => Array.from(X[i]));
  const p = M[0].length;
  if (n < minN + p) return null;
  const XtX = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => M.reduce((s, row) => s + row[a] * row[b], 0)));
  const Xty = Array.from({ length: p }, (_, a) => M.reduce((s, row, i) => s + row[a] * Math.log(y[i]), 0));
  const start = solveLinear(XtX, Xty);
  if (!start) return null;
  let carry = start;
  const inner = (xi) => {
    const r = covariateGamma(y, M, xi, carry);
    if (Number.isFinite(r.value)) carry = r.gamma;
    return r;
  };
  const f = (xi) => inner(xi).value;
  const steps = 16;
  const grid = [];
  for (let i = 0; i <= steps; i++) {
    const xi = lo + ((hi - lo) * i) / steps;
    grid.push([xi, f(xi)]);
  }
  let best = 0;
  for (let i = 1; i < grid.length; i++) if (grid[i][1] < grid[best][1]) best = i;
  const refined = brentMin(f, grid[Math.max(0, best - 1)][0], grid[Math.min(steps, best + 1)][0], { tol: 1e-10 });
  const fit = inner(refined.x);
  const theta = [...fit.gamma, refined.x];
  const nll = (t) => covariateNll(y, M, t.slice(0, p), t[p]);
  const q = p + 1;
  const H = Array.from({ length: q }, () => new Array(q).fill(0));
  const h = theta.map((v) => 1e-4 * Math.max(1, Math.abs(v)));
  const f0 = nll(theta);
  const shifted = (da, ia, db, ib) => {
    const t = theta.slice();
    t[ia] += da;
    if (ib !== null) t[ib] += db;
    return nll(t);
  };
  for (let a = 0; a < q; a++) {
    H[a][a] = (shifted(h[a], a, 0, null) - 2 * f0 + shifted(-h[a], a, 0, null)) / (h[a] * h[a]);
    for (let b = 0; b < a; b++) {
      H[a][b] = H[b][a] = (shifted(h[a], a, h[b], b) - shifted(h[a], a, -h[b], b) - shifted(-h[a], a, h[b], b) + shifted(-h[a], a, -h[b], b)) / (4 * h[a] * h[b]);
    }
  }
  const inv = invertMatrix(H);
  const se = inv ? inv.map((row, i) => (row[i] > 0 ? Math.sqrt(row[i]) : null)) : null;
  return {
    gamma: fit.gamma, xi: refined.x, nll: fit.value, n, p, boundary: refined.x - lo < 1e-6 || hi - refined.x < 1e-6,
    se: se ? { gamma: se.slice(0, p), xi: se[p] } : null,
  };
}

export function covariateGpdSf(model, x, y) {
  let eta = 0;
  for (let k = 0; k < model.gamma.length; k++) eta += x[k] * model.gamma[k];
  return gpdSf(y, model.xi, Math.exp(eta));
}

export function referenceScale(returns, { events = [] } = {}) {
  const skip = new Set(events);
  let s = 0;
  let n = 0;
  for (let i = 0; i < returns.length; i++) {
    const v = returns[i];
    if (fin(v) && !skip.has(i)) { s += v * v; n++; }
  }
  return n >= 20 ? Math.sqrt(s / n) : null;
}

export function dateJackknife(series, statistic, { q = 0.925, blocks = 6 } = {}) {
  const names = series.length;
  const days = names ? series[0].length : 0;
  if (!names || blocks < 2 || days < 2 * blocks) return null;
  const full = statistic(exceedanceGroups(series, { q }));
  if (!fin(full)) return null;
  const size = Math.floor(days / blocks);
  const estimates = [];
  for (let g = 0; g < blocks; g++) {
    const v = statistic(exceedanceGroups(dropDates(series, g * size, g === blocks - 1 ? days : (g + 1) * size), { q }));
    if (fin(v)) estimates.push(v);
  }
  if (estimates.length < 2) return null;
  const k = estimates.length;
  const mu = estimates.reduce((a, b) => a + b, 0) / k;
  const se = Math.sqrt(((k - 1) / k) * estimates.reduce((a, b) => a + (b - mu) ** 2, 0));
  return { value: full, se, blocks: k, estimates };
}

export function hierarchicalShape(groups, { grid = 41, lo = -0.2, hi = 0.8, minPerName = 10 } = {}) {
  const live = groups.map(yOf).filter((y) => y.length >= minPerName);
  if (live.length < 3) return null;
  const xs = Array.from({ length: grid }, (_, k) => lo + ((hi - lo) * k) / (grid - 1));
  const step = (hi - lo) / (grid - 1);
  const L = live.map((y) => xs.map((xi) => -profileNegLogLik(y, xi).value));
  const peak = L.map((row) => Math.max(...row.filter(Number.isFinite)));
  const kernel = (m, tau) => xs.map((x) => Math.exp(-0.5 * ((x - m) / tau) ** 2));
  const marginal = (m, tau) => {
    const w = kernel(m, tau);
    const wsum = w.reduce((a, b) => a + b, 0);
    if (!(wsum > 0)) return -Infinity;
    let total = 0;
    for (let i = 0; i < live.length; i++) {
      let num = 0;
      for (let k = 0; k < grid; k++) if (Number.isFinite(L[i][k])) num += w[k] * Math.exp(L[i][k] - peak[i]);
      total += peak[i] + Math.log(num / wsum);
    }
    return total;
  };
  const tauLow = 0.5 * step;
  const tauHigh = 0.6;
  const atTau = (tau) => brentMin((m) => -marginal(m, tau), lo, hi, { tol: 1e-8 });
  const taus = Array.from({ length: 14 }, (_, k) => tauLow * Math.pow(tauHigh / tauLow, k / 13));
  let best = null;
  for (const tau of taus) {
    const r = atTau(tau);
    if (best === null || r.fx < best.fx) best = { tau, m: r.x, fx: r.fx };
  }
  const i = taus.indexOf(best.tau);
  const refined = brentMin((lt) => atTau(Math.exp(lt)).fx, Math.log(taus[Math.max(0, i - 1)]), Math.log(taus[Math.min(taus.length - 1, i + 1)]), { tol: 1e-6 });
  const tau = Math.exp(refined.x);
  const m = atTau(tau).x;
  const w = kernel(m, tau);
  const posterior = live.map((_, idx) => {
    let num = 0;
    let den = 0;
    for (let k = 0; k < grid; k++) {
      if (!Number.isFinite(L[idx][k])) continue;
      const v = w[k] * Math.exp(L[idx][k] - peak[idx]);
      num += v * xs[k];
      den += v;
    }
    return num / den;
  });
  return { m, tau, xi: posterior, names: live.length, logMarginal: -refined.fx };
}

export const CHALLENGERS = Object.freeze([
  Object.freeze({ id: "pooled-shape", role: "baseline", estimate: (groups) => { const f = pooledShape(groups); return f ? groups.map(() => f.xi) : null; } }),
  Object.freeze({ id: "hierarchical-shape", role: "challenger", estimate: (groups) => { const f = hierarchicalShape(groups); return f ? f.xi : null; } }),
  Object.freeze({ id: "per-name-mle", role: "reference", estimate: (groups) => { const out = groups.map((g) => { const f = fitGpd(yOf(g)); return f ? f.xi : null; }); return out.every((v) => v !== null) ? out : null; } }),
]);
