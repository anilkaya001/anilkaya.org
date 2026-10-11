import { makeRng, normalQuantile, normalSurvival } from "./rng.mjs";
import { betaInc } from "./worlds.mjs";
import { harmonic } from "./reference.mjs";
import { clockShape } from "./intraday.mjs";

export const OPERATING = Object.freeze({ q: 0.1, mixture: 8, windows: Object.freeze([1, 5, 15, 60]), frameEvery: 5, scaleInflation: 1.5 });

export const NU_GRID = Object.freeze([3, 4, 5, 8]);
export const S_GRID = Object.freeze([0.1, 0.15, 0.2, 0.3, 0.45]);

const runningMaximum = true;
const perIncrement = true;

export function stepUpSet(p, line, top) {
  const cap = line(top);
  const cand = [];
  for (let i = 0; i < p.length; i++) if (p[i] <= cap) cand.push(i);
  cand.sort((a, b) => p[a] - p[b]);
  let cut = 0;
  for (let k = 1; k <= cand.length; k++) if (p[cand[k - 1]] <= line(k)) cut = k;
  return cand.slice(0, cut);
}

export function byAlertSet(p, q, n = p.length) {
  return stepUpSet(p, (k) => (k * q) / (n * harmonic(n)), n);
}

export function bhAlertSet(p, q, n = p.length) {
  return stepUpSet(p, (k) => (k * q) / n, n);
}

export function sessionAlertSet(frames, q, n) {
  const out = new Set();
  for (const f of frames) for (const i of byAlertSet(f.running, q, n)) out.add(i);
  return out;
}

export function screenSets(frames, q, n) {
  return frames.map((f) => new Set(byAlertSet(f.current, q, n)));
}

const clockCache = new WeakMap();

export function clockOf(session, windows = OPERATING.windows) {
  const hit = clockCache.get(session);
  if (hit && hit.windows === windows) return hit;
  const B = session.bars;
  const v = new Float64Array(B + 1);
  v[0] = session.gapShare;
  for (let b = 0; b < B; b++) v[b + 1] = session.clockForecast[b];
  return clockFrom(v, windows, session);
}

function clockFrom(v, windows, key) {
  const n = v.length;
  const V = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) V[k + 1] = V[k] + v[k];
  const a = OPERATING.mixture;
  const coef = new Float64Array(n), lcoef = new Float64Array(n);
  for (let j = 0; j < n; j++) { coef[j] = a / (2 * (1 + a * V[j + 1])); lcoef[j] = 0.5 * Math.log(1 + a * V[j + 1]); }
  const rw = windows.map((w) => {
    const r = new Float64Array(n), start = new Int32Array(n);
    for (let j = 0; j < n; j++) { const s = Math.max(0, j + 1 - w); start[j] = s; r[j] = 1 / Math.sqrt(V[j + 1] - V[s]); }
    return { w, r, start };
  });
  const out = { n, v, V, coef, lcoef, rw, windows };
  if (key && typeof key === "object") clockCache.set(key, out);
  return out;
}

export function nominalClock(minutes, gapShare, windows = OPERATING.windows, decay = 30, peak = 2.2) {
  const intraday = 1 - gapShare;
  const shape = clockShape(minutes, decay, peak);
  const v = new Float64Array(minutes + 1);
  v[0] = gapShare;
  for (let m = 0; m < minutes; m++) v[m + 1] = intraday * shape[m];
  return clockFrom(v, windows, null);
}

function gpdFit(exc) {
  const m = exc.reduce((a, b) => a + b, 0) / exc.length;
  const m2 = exc.reduce((a, b) => a + b * b, 0) / exc.length;
  const xi0 = Math.min(0.6, Math.max(-0.4, 0.5 * (1 - (m * m) / (m2 - m * m))));
  const nll = (lb, xi) => {
    const be = Math.exp(lb);
    let s = exc.length * lb;
    for (const y of exc) {
      const t = 1 + (xi * y) / be;
      if (t <= 0) return 1e12;
      s += (Math.abs(xi) < 1e-9 ? y / be : (1 + 1 / xi) * Math.log(t));
    }
    return s;
  };
  let best = [Math.log(m), xi0], bestV = nll(best[0], best[1]);
  let step = [0.3, 0.2];
  for (let it = 0; it < 120; it++) {
    let moved = false;
    for (const [d0, d1] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const c = [best[0] + d0 * step[0], best[1] + d1 * step[1]];
      const f = nll(c[0], c[1]);
      if (f < bestV) { best = c; bestV = f; moved = true; }
    }
    if (!moved) { step = [step[0] / 2, step[1] / 2]; if (step[0] < 1e-6) break; }
  }
  return { beta: Math.exp(best[0]), xi: best[1] };
}

export function tailTable(values, quantile = 0.98) {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  const ui = Math.floor(n * quantile);
  const u = sorted[ui];
  const exc = [];
  for (let i = ui + 1; i < n; i++) exc.push(sorted[i] - u);
  const g = gpdFit(exc);
  const pu = exc.length / n;
  const sf = (x) => {
    if (x > u) return pu * Math.pow(Math.max(1e-300, 1 + (g.xi * (x - u)) / g.beta), -1 / g.xi);
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
    return Math.max(1 / n, (n - lo) / n);
  };
  return { sf, u, xi: g.xi, beta: g.beta, n };
}

export function buildNullTable({ nu, s, clock, sims, seed, stats = null }) {
  const rng = makeRng(seed);
  const n = clock.n, K = 1 + clock.rw.length;
  const maxima = Array.from({ length: K }, () => new Float64Array(sims));
  const C = new Float64Array(n + 1);
  const best = new Float64Array(K);
  const w = new Float64Array(n);
  for (let k = 0; k < n; k++) w[k] = Math.sqrt(clock.v[k]);
  const gauss = !(nu < 1e6);
  for (let d = 0; d < sims; d++) {
    const inv = Math.exp(-s * rng.normal());
    best.fill(-Infinity);
    for (let j = 0; j < n; j++) {
      const x = gauss ? rng.normal() : rng.studentUnit(nu);
      C[j + 1] = C[j] + w[j] * x * inv;
      const c = C[j + 1];
      const le = c * c * clock.coef[j] - clock.lcoef[j];
      if (le > best[0]) best[0] = le;
      for (let q = 0; q < K - 1; q++) {
        const r = clock.rw[q];
        const m = Math.abs(c - C[r.start[j]]) * r.r[j];
        if (m > best[q + 1]) best[q + 1] = m;
      }
    }
    for (let q = 0; q < K; q++) maxima[q][d] = q === 0 ? best[0] : Math.log(Math.max(1e-300, best[q]));
  }
  return maxima.map((m) => tailTable(m));
}

export function nullBank({ sims, seed, exactSims = sims }) {
  const cache = new Map();
  const get = (nu, s, minutes, gapShare, windows) => {
    const key = `${nu}|${s}|${minutes}|${gapShare}|${windows.join(",")}`;
    if (!cache.has(key)) {
      const clock = nominalClock(minutes, gapShare, windows);
      cache.set(key, buildNullTable({ nu, s, clock, sims: nu < 1e6 ? sims : exactSims, seed: `${seed}|${key}` }));
    }
    return cache.get(key);
  };
  return { get, size: () => cache.size, keys: () => [...cache.keys()] };
}

const transformCache = new Map();

export function transformFor(nu) {
  if (!(nu < 1e6)) return (x) => x;
  if (transformCache.has(nu)) return transformCache.get(nu);
  const unit = Math.sqrt(nu / (nu - 2));
  const exact = (x) => {
    const t = Math.abs(x) * unit;
    const sf = 0.5 * betaInc(nu / (nu + t * t), nu / 2, 0.5);
    const v = -normalQuantile(Math.max(1e-300, sf));
    return x < 0 ? -v : v;
  };
  const step = 64, limit = 8;
  const knots = new Float64Array(limit * step + 2);
  for (let m = 0; m < knots.length; m++) knots[m] = exact(m / step);
  const fn = (x) => {
    const a = Math.abs(x);
    if (a >= limit) return exact(x);
    const f = a * step, m = Math.floor(f);
    const v = knots[m] + (knots[m + 1] - knots[m]) * (f - m);
    return x < 0 ? -v : v;
  };
  transformCache.set(nu, fn);
  return fn;
}

export const C_TABLE = Object.freeze([[0.05, 0], [0.1, 1], [0.2, 1.5], [0.3, 2]]);

export function cOf(s) {
  if (s <= C_TABLE[0][0]) return 0;
  for (let k = 1; k < C_TABLE.length; k++) {
    const [s1, c1] = C_TABLE[k];
    if (s <= s1) { const [s0, c0] = C_TABLE[k - 1]; return c0 + ((c1 - c0) * (s - s0)) / (s1 - s0); }
  }
  return C_TABLE[C_TABLE.length - 1][1];
}

export function tableStep(grid, value, direction) {
  if (direction === "up") { for (const g of grid) if (g >= value - 1e-12) return g; return grid[grid.length - 1]; }
  let out = grid[0];
  for (const g of grid) if (g <= value + 1e-12) out = g;
  return out;
}

export function framePlan(n) {
  const marks = [];
  for (let j = OPERATING.frameEvery - 1; j < n; j += OPERATING.frameEvery) marks.push(j);
  if (marks[marks.length - 1] !== n - 1) marks.push(n - 1);
  return marks;
}

function pOfTables(tables, stats, K, useLog) {
  let pm = 1;
  for (let k = 0; k < K; k++) {
    const x = k === 0 || !useLog ? stats[k] : Math.log(Math.max(1e-300, stats[k]));
    const p = tables[k].sf(x);
    if (p < pm) pm = p;
  }
  return Math.min(1, K * pm);
}

function emptyFrames(marks, N) {
  return marks.map((j) => ({ bar: j, running: new Float64Array(N).fill(1), current: new Float64Array(N).fill(1), snapshot: new Float64Array(N).fill(1) }));
}

export function evaluateA(session, hats, bank, cfg = {}) {
  const windows = cfg.windows || OPERATING.windows;
  const clock = clockOf(session, windows);
  const N = session.names, B = session.bars, n = B + 1, K = 1 + windows.length;
  const marks = framePlan(n);
  const frames = emptyFrames(marks, N);
  const Cx = new Float64Array(n + 1);
  const best = new Float64Array(K), cur = new Float64Array(K);
  const bestAt = new Float64Array(marks.length * K), curAt = new Float64Array(marks.length * K), zAt = new Float64Array(marks.length);
  for (let i = 0; i < N; i++) {
    const tables = bank.get(hats.nu[i], hats.s[i], session.minutes, session.gapShare, windows);
    const inv = 1 / session.sigmaForecast[i];
    best.fill(-Infinity);
    let f = 0;
    for (let j = 0; j < n; j++) {
      const x = (j === 0 ? session.gap[i] : session.inc[i * B + j - 1]) * inv;
      const c = Cx[j] + x;
      Cx[j + 1] = c;
      const le = c * c * clock.coef[j] - clock.lcoef[j];
      cur[0] = le;
      if (le > best[0]) best[0] = le;
      for (let q = 0; q < windows.length; q++) {
        const r = clock.rw[q];
        const m = Math.abs(c - Cx[r.start[j]]) * r.r[j];
        cur[q + 1] = m;
        if (m > best[q + 1]) best[q + 1] = m;
      }
      if (marks[f] === j) {
        for (let k = 0; k < K; k++) { bestAt[f * K + k] = best[k]; curAt[f * K + k] = cur[k]; }
        zAt[f] = Math.abs(c) / Math.sqrt(clock.V[j + 1]);
        f++;
      }
    }
    for (let g = 0; g < marks.length; g++) {
      const held = runningMaximum ? bestAt.subarray(g * K, (g + 1) * K) : curAt.subarray(g * K, (g + 1) * K);
      frames[g].running[i] = pOfTables(tables, held, K, true);
      frames[g].current[i] = pOfTables(tables, curAt.subarray(g * K, (g + 1) * K), K, true);
      frames[g].snapshot[i] = 2 * normalSurvival(zAt[g]);
    }
  }
  return frames;
}

export function evaluateB(session, hats, bank, cfg = {}) {
  const windows = cfg.windows || OPERATING.windows;
  const clock = clockOf(session, windows);
  const N = session.names, B = session.bars, n = B + 1, K = 1 + windows.length;
  const marks = framePlan(n);
  const frames = emptyFrames(marks, N);
  const tables = bank.get(Infinity, 0, session.minutes, session.gapShare, windows);
  const gapTransform = transformFor(hats.gapNu || Infinity);
  const w = new Float64Array(n);
  for (let k = 0; k < n; k++) w[k] = Math.sqrt(clock.v[k]);
  const invClock = new Float64Array(n);
  for (let k = 0; k < n; k++) invClock[k] = 1 / w[k];
  const S = new Float64Array(n + 1), Raw = new Float64Array(n + 1);
  const best = new Float64Array(K), cur = new Float64Array(K);
  const bestAt = new Float64Array(marks.length * K), curAt = new Float64Array(marks.length * K), zAt = new Float64Array(marks.length);
  for (let i = 0; i < N; i++) {
    const tr = transformFor(hats.nu[i]);
    const sHat = hats.s[i];
    const kappa = Math.exp(cOf(sHat) * sHat);
    const inv = 1 / (session.sigmaForecast[i] * kappa);
    best.fill(-Infinity);
    let f = 0;
    for (let j = 0; j < n; j++) {
      const raw = (j === 0 ? session.gap[i] : session.inc[i * B + j - 1]) * inv;
      const z = raw * invClock[j];
      Raw[j + 1] = Raw[j] + raw;
      let s;
      if (perIncrement) {
        S[j + 1] = S[j] + w[j] * (j === 0 ? gapTransform(z) : tr(z));
        s = S[j + 1];
      } else {
        const rt = Math.sqrt(clock.V[j + 1]);
        S[j + 1] = rt * tr(Raw[j + 1] / rt);
        s = S[j + 1];
      }
      const le = s * s * clock.coef[j] - clock.lcoef[j];
      cur[0] = le;
      if (le > best[0]) best[0] = le;
      for (let q = 0; q < windows.length; q++) {
        const r = clock.rw[q];
        const m = Math.abs(s - S[r.start[j]]) * r.r[j];
        cur[q + 1] = m;
        if (m > best[q + 1]) best[q + 1] = m;
      }
      if (marks[f] === j) {
        for (let k = 0; k < K; k++) { bestAt[f * K + k] = best[k]; curAt[f * K + k] = cur[k]; }
        zAt[f] = Math.abs(s) / Math.sqrt(clock.V[j + 1]);
        f++;
      }
    }
    for (let g = 0; g < marks.length; g++) {
      const heldAll = runningMaximum ? bestAt.subarray(g * K, (g + 1) * K) : curAt.subarray(g * K, (g + 1) * K);
      const nowAll = curAt.subarray(g * K, (g + 1) * K);
      frames[g].running[i] = pOfMixture(tables, heldAll, K);
      frames[g].current[i] = pOfMixture(tables, nowAll, K);
      frames[g].snapshot[i] = 2 * normalSurvival(zAt[g]);
    }
  }
  return frames;
}

function pOfMixture(tables, stats, K) {
  let pm = Math.min(1, Math.exp(-stats[0]));
  for (let k = 1; k < K; k++) {
    const p = tables[k].sf(Math.log(Math.max(1e-300, stats[k])));
    if (p < pm) pm = p;
  }
  return Math.min(1, K * pm);
}

