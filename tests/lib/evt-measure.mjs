import { makeRng, normalCdf } from "../truth/rng.mjs";
import { hansen, w1Garch, w1dWorld, W1_PRODUCTION } from "../truth/worlds.mjs";
import * as E from "../../shared/flows-evt.js";

export const BAND_KS = Object.freeze([3, 4, 5, 6]);
export const COVERAGE_RHOS = Object.freeze([0, 0.2, 0.3, 0.5]);
export const QUANTILE = 0.925;
export const WORLD = Object.freeze({ names: 60, days: 500, nu: 5 });

export const seriesOf = (w) => Array.from({ length: w.names }, (_, i) => w.r.subarray(i * w.days, (i + 1) * w.days));

export function pooledOnWorld(w, options = {}) {
  const groups = E.exceedanceGroups(seriesOf(w), { q: options.q ?? QUANTILE });
  return { groups, fit: E.pooledShape(groups) };
}

const centreCache = new Map();

export function worldCentre({ rho, seeds, salt, world }) {
  const key = `${rho}|${seeds}|${salt}|${JSON.stringify(world)}`;
  if (centreCache.has(key)) return centreCache.get(key);
  let sum = 0;
  let n = 0;
  for (let r = 0; r < seeds; r++) {
    const w = w1dWorld({ ...world, seed: `evt|centre|${salt}|${rho}|${r}`, rho });
    const fit = pooledOnWorld(w).fit;
    if (fit) { sum += fit.xi; n++; }
  }
  const value = sum / n;
  centreCache.set(key, value);
  return value;
}

export const INTERVALS = Object.freeze({
  unclustered: (groups, fit) => E.pooledInterval(groups, fit),
  sandwich: (groups, fit, w) => E.pooledClustered(groups, fit, { days: w.days }),
  jackknife: (groups, fit, w) => E.pooledJackknife(seriesOf(w), { q: QUANTILE }),
});

export function coverageStudy({ rho, seeds, salt = "fixed", world = {}, intervals = ["unclustered"], options = {} }) {
  const params = { ...WORLD, ...world };
  const centre = worldCentre({ rho, seeds, salt, world: params });
  const independent = worldCentre({ rho: 0, seeds, salt, world: params });
  const tally = Object.fromEntries(intervals.map((name) => [name, { covered: 0, coveredIndependent: 0, width: 0, open: 0, design: 0, counted: 0 }]));
  const xis = [];
  for (let r = 0; r < seeds; r++) {
    const w = w1dWorld({ ...params, seed: `evt|w1d|${salt}|${rho}|${r}`, rho });
    const { groups, fit } = pooledOnWorld(w, options);
    if (!fit) continue;
    xis.push(fit.xi);
    for (const name of intervals) {
      const iv = INTERVALS[name](groups, fit, w);
      if (!iv) continue;
      const t = tally[name];
      const lo = iv.lo === null ? -Infinity : iv.lo;
      const hi = iv.hi === null ? Infinity : iv.hi;
      if (iv.lo === null || iv.hi === null) t.open++;
      else t.width += hi - lo;
      if (Number.isFinite(iv.design)) t.design += iv.design;
      t.counted++;
      if (lo <= centre && centre <= hi) t.covered++;
      if (lo <= independent && independent <= hi) t.coveredIndependent++;
    }
  }
  const n = xis.length;
  const mean = xis.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xis.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const by = Object.fromEntries(intervals.map((name) => {
    const t = tally[name];
    return [name, { coverage: t.covered / t.counted, coverageVsIndependent: t.coveredIndependent / t.counted, width: t.width / Math.max(1, t.counted - t.open), design: t.design / t.counted, open: t.open }];
  }));
  return { rho, seeds: n, centre, independentCentre: independent, xiMean: mean, xiSd: sd, ...by[intervals[0]], by };
}

const quantileOf = (sorted, p) => {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
};

const bandOf = (ratios) => {
  const sorted = Float64Array.from(ratios).sort();
  return { p05: quantileOf(sorted, 0.05), p50: quantileOf(sorted, 0.5), p95: quantileOf(sorted, 0.95) };
};

export function trueModelBands({ seeds, pool, n = W1_PRODUCTION.n, salt = "fixed", ks = BAND_KS }) {
  const dist = hansen(W1_PRODUCTION.nu, W1_PRODUCTION.lambda);
  const predicted = ks.map((k) => dist.sf2(k));
  const counts = ks.map(() => []);
  const groups = Math.floor(seeds / pool) * pool;
  for (let g = 0; g < groups / pool; g++) {
    const c = ks.map(() => 0);
    for (let p = 0; p < pool; p++) {
      const w = w1Garch({ seed: `evt|true|${salt}|${g * pool + p}`, n });
      for (let t = 0; t < n; t++) ks.forEach((k, j) => { if (Math.abs(w.z[t]) > k) c[j]++; });
    }
    ks.forEach((k, j) => counts[j].push(c[j] / (pool * n * predicted[j])));
  }
  return Object.fromEntries(ks.map((k, j) => [String(k), { predicted: predicted[j], ...bandOf(counts[j]), reps: counts[j].length }]));
}

export function dependentBands({ rho, seeds, salt = "fixed", names = WORLD.names, days = WORLD.days, nu = WORLD.nu, ks = BAND_KS }) {
  const counts = ks.map(() => []);
  for (let r = 0; r < seeds; r++) {
    const w = w1dWorld({ seed: `evt|bands|${salt}|${rho}|${r}`, names, days, nu, rho });
    const c = ks.map(() => 0);
    for (let i = 0; i < w.r.length; i++) ks.forEach((k, j) => { if (Math.abs(w.r[i]) > k) c[j]++; });
    ks.forEach((k, j) => counts[j].push(c[j] / (names * days)));
  }
  return Object.fromEntries(ks.map((k, j) => {
    const centre = counts[j].reduce((a, b) => a + b, 0) / counts[j].length;
    return [String(k), { predicted: centre, ...bandOf(counts[j].map((c) => c / centre)), reps: counts[j].length }];
  }));
}

export const heterogeneousGroups = ({ names, per, xi, scaleSd = 0.7, seed }) => {
  const rng = makeRng(seed);
  return Array.from({ length: names }, () => {
    const beta = Math.exp(scaleSd * rng.normal());
    return Float64Array.from({ length: per }, () => E.gpdIsf(rng.uniform(), xi, beta));
  });
};

export const inverseVarianceShape = (groups) => {
  let sw = 0;
  let sx = 0;
  for (const g of groups) {
    const f = E.fitGpd(g);
    if (!f || !f.se.xi) continue;
    const w = 1 / (f.se.xi * f.se.xi);
    sw += w;
    sx += w * f.xi;
  }
  return sw > 0 ? sx / sw : null;
};

export { normalCdf };
