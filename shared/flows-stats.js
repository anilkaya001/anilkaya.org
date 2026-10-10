const fin = (x) => typeof x === "number" && Number.isFinite(x);

const finite = (xs) => (Array.isArray(xs) ? xs.filter(fin) : []);

export const Z975 = 1.959963984540054;

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

export function quantile(xs, p) {
  return quantileSorted(finite(xs).sort((a, b) => a - b), p);
}

export function shareAtOrBelow(x, xs) {
  const v = finite(xs);
  if (!v.length || x === null || !Number.isFinite(x)) return null;
  let k = 0;
  for (const y of v) if (y <= x) k++;
  return k / v.length;
}

export function percentileRank(values) {
  const xs = values || [];
  const idx = [];
  for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i])) idx.push(i);
  const m = idx.length;
  const out = xs.map(() => null);
  if (!m) return out;
  if (m === 1) { out[idx[0]] = 0.5; return out; }

  idx.sort((a, b) => xs[a] - xs[b]);
  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]] = avgRank / (m + 1);
    i = j + 1;
  }
  return out;
}

function pairs(xs, ys) {
  const out = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) out.push([xs[i], ys[i]]);
  return out;
}

export function pearson(xs, ys, { min = 3 } = {}) {
  const pts = pairs(xs, ys);
  const n = pts.length;
  if (n < min) return null;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

function ranks(values) {
  const n = values.length;
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(n);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
    for (let q = i; q <= j; q++) out[order[q][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export function spearman(xs, ys, { min = 3 } = {}) {
  const pts = pairs(xs, ys);
  if (pts.length < min) return null;
  return pearson(ranks(pts.map((p) => p[0])), ranks(pts.map((p) => p[1])), { min });
}

export function wilson(p, n, { z = 1.96 } = {}) {
  if (!fin(p) || !(n > 0) || p < 0 || p > 1) return null;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const m = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d;
  return [Math.max(0, c - m), Math.min(1, c + m)];
}

export function effectiveN({ n, k = null, clusterSize = null, icc = 0 } = {}) {
  if (!fin(n) || !(n > 0)) return null;
  const size = fin(clusterSize) ? clusterSize : fin(k) && k > 0 ? n / k : 1;
  const rho = fin(icc) ? Math.min(Math.max(icc, 0), 1) : 0;
  const deff = 1 + (Math.max(size, 1) - 1) * rho;
  return n / deff;
}

const T975 = [NaN, 12.706204736174694, 4.302652729749462, 3.1824463052837078, 2.7764451051977934, 2.5705818356363146,
  2.4469118511449786, 2.364624251592784, 2.306004135204166, 2.262157162798205, 2.228138851986274, 2.200985160091639,
  2.1788128296672284, 2.1603686564627913, 2.144786687917804, 2.131449545559776, 2.1199052992212546,
  2.1098155778333156, 2.1009220402410382, 2.0930240544083087, 2.085963447265864, 2.0796138447276795,
  2.0738730679040254, 2.0686576104190486, 2.0638985616280245, 2.0595385527532972, 2.0555294386428735,
  2.0518305164802846, 2.0484071417952454, 2.045229642132703, 2.0422724563012378];

export function tCritical975(df) {
  if (!fin(df) || df < 1) return null;
  if (df <= 30) {
    const lo = Math.floor(df);
    const hi = Math.ceil(df);
    return lo === hi ? T975[lo] : T975[lo] + (df - lo) * (T975[hi] - T975[lo]);
  }
  const z = Z975;
  const z2 = z * z;
  const z3 = z2 * z;
  const z5 = z3 * z2;
  const z7 = z5 * z2;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df) +
    (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df * df * df);
}

export function meanCi(xs) {
  const v = finite(xs);
  const n = v.length;
  if (n < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / n;
  const sd = sampleSd(v);
  const half = tCritical975(n - 1) * sd / Math.sqrt(n);
  return { mean: m, n, se: sd / Math.sqrt(n), lo: m - half, hi: m + half };
}

export function neweyWestLags(n) {
  return Math.max(0, Math.floor(4 * Math.pow(n / 100, 2 / 9)));
}

export function neweyWestSe(xs, { lags = null } = {}) {
  const v = finite(xs);
  const n = v.length;
  if (n < 2) return null;
  const L = Math.min(fin(lags) ? Math.max(0, Math.floor(lags)) : neweyWestLags(n), n - 1);
  const m = v.reduce((a, b) => a + b, 0) / n;
  const d = v.map((x) => x - m);
  let s = 0;
  for (let t = 0; t < n; t++) s += d[t] * d[t];
  let long = s / n;
  for (let l = 1; l <= L; l++) {
    let g = 0;
    for (let t = l; t < n; t++) g += d[t] * d[t - l];
    long += 2 * (1 - l / (L + 1)) * (g / n);
  }
  return Math.sqrt(Math.max(long, 0) / n);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stationaryBootstrap(xs, { reps = 1000, meanBlock = 5, seed = 1, stat = mean } = {}) {
  const v = finite(xs);
  const n = v.length;
  if (n < 2 || !(reps >= 1)) return null;
  const rand = mulberry32(seed);
  const keep = 1 / Math.max(1, meanBlock);
  const out = new Array(Math.floor(reps));
  for (let r = 0; r < out.length; r++) {
    const sample = new Array(n);
    let at = Math.floor(rand() * n);
    sample[0] = v[at];
    for (let i = 1; i < n; i++) {
      if (rand() < keep) at = Math.floor(rand() * n);
      else at = (at + 1) % n;
      sample[i] = v[at];
    }
    out[r] = stat(sample);
  }
  return out;
}

export function bootstrapInterval(xs, { level = 0.8, ...options } = {}) {
  const reps = stationaryBootstrap(xs, options);
  if (!reps) return null;
  const sorted = reps.filter(fin).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const tail = (1 - level) / 2;
  return { lo: quantileSorted(sorted, tail), hi: quantileSorted(sorted, 1 - tail), reps: sorted.length, n: finite(xs).length };
}

export function brier(ps, ys) {
  const pts = pairs(ps, ys).filter(([p, y]) => p >= 0 && p <= 1 && (y === 0 || y === 1));
  if (!pts.length) return null;
  let s = 0;
  for (const [p, y] of pts) s += (p - y) * (p - y);
  return s / pts.length;
}

export function logScore(ps, ys, { eps = 1e-12 } = {}) {
  const pts = pairs(ps, ys).filter(([p, y]) => p >= 0 && p <= 1 && (y === 0 || y === 1));
  if (!pts.length) return null;
  let s = 0;
  for (const [p, y] of pts) {
    const q = Math.min(Math.max(p, eps), 1 - eps);
    s -= y === 1 ? Math.log(q) : Math.log(1 - q);
  }
  return s / pts.length;
}

export function reliability(ps, ys, { bins = 10 } = {}) {
  const pts = pairs(ps, ys).filter(([p, y]) => p >= 0 && p <= 1 && (y === 0 || y === 1));
  const N = pts.length;
  if (!N || !(bins >= 1)) return null;
  const k = Math.floor(bins);
  const cells = Array.from({ length: k }, (_, i) => ({ lo: i / k, hi: (i + 1) / k, n: 0, sumP: 0, sumY: 0, sumPP: 0, sumPY: 0 }));
  let sumY = 0;
  for (const [p, y] of pts) {
    const c = cells[Math.min(k - 1, Math.floor(p * k))];
    c.n++; c.sumP += p; c.sumY += y; c.sumPP += p * p; c.sumPY += p * y;
    sumY += y;
  }
  const base = sumY / N;
  let rel = 0, res = 0, within = 0, cov = 0;
  const out = [];
  for (const c of cells) {
    if (!c.n) { out.push({ lo: c.lo, hi: c.hi, n: 0, p: null, y: null }); continue; }
    const pBar = c.sumP / c.n;
    const yBar = c.sumY / c.n;
    rel += c.n * (pBar - yBar) * (pBar - yBar);
    res += c.n * (yBar - base) * (yBar - base);
    within += c.sumPP - c.n * pBar * pBar;
    cov += c.sumPY - pBar * c.sumY;
    out.push({ lo: c.lo, hi: c.hi, n: c.n, p: pBar, y: yBar });
  }
  return {
    n: N, base, bins: out,
    reliability: rel / N, resolution: res / N, uncertainty: base * (1 - base), withinBin: within / N, withinCovariance: cov / N,
    brier: brier(ps, ys),
  };
}

export function benjaminiHochberg(ps, q = 0.05) {
  const n = ps.length;
  const idx = [];
  for (let i = 0; i < n; i++) if (fin(ps[i]) && ps[i] >= 0 && ps[i] <= 1) idx.push(i);
  const m = idx.length;
  const adjusted = ps.map(() => null);
  const reject = ps.map(() => false);
  if (!m) return { adjusted, reject, m: 0, q };
  idx.sort((a, b) => ps[a] - ps[b]);
  let prev = 1;
  for (let r = m - 1; r >= 0; r--) {
    prev = Math.min(prev, ps[idx[r]] * m / (r + 1));
    adjusted[idx[r]] = prev;
  }
  for (const i of idx) reject[i] = adjusted[i] <= q;
  return { adjusted, reject, m, q };
}
