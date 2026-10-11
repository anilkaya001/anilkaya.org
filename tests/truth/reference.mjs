import { mean, variance } from "./stats.mjs";
import { normalCdf, normalQuantile } from "./rng.mjs";
import { nextBusinessDay } from "./worlds.mjs";

export class LookAheadError extends Error {}

export function readAsOf(rows, asOf) {
  const out = [];
  for (const row of rows) {
    if (row.knownAt > asOf) throw new LookAheadError(`record known at ${row.knownAt} read as of ${asOf}`);
    out.push(row.value);
  }
  return out;
}

export function crpsEnsemble(ens, y) {
  const m = ens.length;
  let a = 0, b = 0;
  for (let i = 0; i < m; i++) {
    a += Math.abs(ens[i] - y);
    for (let j = 0; j < m; j++) b += Math.abs(ens[i] - ens[j]);
  }
  return a / m - b / (2 * m * (m - 1));
}

export function pavFit(p, y) {
  const idx = Array.from(p, (_, i) => i).sort((i, j) => p[i] - p[j] || i - j);
  const blocks = [];
  let i = 0;
  while (i < idx.length) {
    let j = i, sum = 0;
    while (j < idx.length && p[idx[j]] === p[idx[i]]) { sum += y[idx[j]]; j++; }
    blocks.push({ sum, w: j - i, members: idx.slice(i, j) });
    i = j;
  }
  const stack = [];
  for (const b of blocks) {
    stack.push({ ...b, members: b.members.slice() });
    while (stack.length > 1) {
      const top = stack[stack.length - 1], below = stack[stack.length - 2];
      if (below.sum / below.w <= top.sum / top.w) break;
      stack.pop();
      below.sum += top.sum;
      below.w += top.w;
      below.members.push(...top.members);
    }
  }
  const fitted = new Float64Array(p.length);
  for (const b of stack) for (const k of b.members) fitted[k] = b.sum / b.w;
  return fitted;
}

export function dayIncrements(day, delta) {
  let sp = 0, sy = 0;
  for (let i = 0; i < day.p.length; i++) { sp += day.p[i]; sy += day.y[i]; }
  const n = day.p.length, pbar = sp / n, m = sy / n - pbar;
  return [{ m, pbar }];
}

export function betCap(pbar, delta) {
  return { up: 0.5 / (pbar * (1 + delta)), down: 0.5 / (1 - pbar + delta * pbar) };
}

function agrapa(moments) {
  if (moments.n < 2) return 0;
  const mu = moments.s / moments.n;
  const v = Math.max(moments.q / moments.n - mu * mu, 1e-12);
  return mu / (v + mu * mu);
}

function push(moments, x) { moments.n += 1; moments.s += x; moments.q += x * x; }

export function calibrationEProcess(days, { delta = 0.1 } = {}) {
  let up = 1, down = 1;
  const mu = { n: 0, s: 0, q: 0 }, md = { n: 0, s: 0, q: 0 };
  const path = new Float64Array(days.length);
  for (let d = 0; d < days.length; d++) {
    for (const { m, pbar } of dayIncrements(days[d], delta)) {
      const cap = betCap(pbar, delta);
      const xu = m - delta * pbar, xd = m + delta * pbar;
      const lu = Math.min(cap.up, Math.max(0, agrapa(mu)));
      const ld = Math.min(cap.down, Math.max(0, agrapa(md)));
      up *= 1 + lu * xu;
      down *= 1 - ld * xd;
      push(mu, xu);
      push(md, -xd);
    }
    path[d] = (up + down) / 2;
  }
  return path;
}

export function dmStatistic(d, h) {
  const n = d.length;
  const mu = mean(d);
  let lrv = 0;
  for (let t = 0; t < n; t++) lrv += (d[t] - mu) * (d[t] - mu);
  lrv /= n;
  for (let k = 1; k < h; k++) {
    let gk = 0;
    for (let t = k; t < n; t++) gk += (d[t] - mu) * (d[t - k] - mu);
    lrv += (2 * (1 - k / h) * gk) / n;
  }
  const hln = Math.sqrt((n + 1 - 2 * h + (h * (h - 1)) / n) / n);
  return (hln * mu) / Math.sqrt(lrv / n);
}

export const sessionClose = (day) => `${day}T21:00:00Z`;

export const oiPublishedAt = (day) => `${nextBusinessDay(day)}T10:30:00Z`;

export const issueInstant = (day) => sessionClose(day);

export function latestKnown(records, asOf) {
  let best = null;
  for (const rec of records) if (rec.knownAt <= asOf && (best === null || rec.describes > best.describes)) best = rec;
  return best;
}

export function oiRecords(dates, oi, names, i) {
  const out = [];
  for (let d = 0; d < dates.length; d++) out.push({ describes: d, knownAt: oiPublishedAt(dates[d]), value: oi[d * names + i] });
  return out;
}

export function issueView(rows, day) {
  const at = issueInstant(day);
  return rows.filter((r) => r.knownAt <= at).map((r) => r.value);
}

const EULER = 0.5772156649015329;

export function sharpe(x) {
  const m = mean(x);
  return m / Math.sqrt(variance(x));
}

export function sharpeMoments(x) {
  const n = x.length, m = mean(x);
  let s2 = 0, s3 = 0, s4 = 0;
  for (let i = 0; i < n; i++) { const d = x[i] - m; s2 += d * d; s3 += d * d * d; s4 += d * d * d * d; }
  s2 /= n;
  return { skew: s3 / n / Math.pow(s2, 1.5), kurt: s4 / n / (s2 * s2) };
}

export function expectedMaxSharpe(trials, srVariance) {
  if (!(trials > 1)) return 0;
  return Math.sqrt(srVariance) * ((1 - EULER) * normalQuantile(1 - 1 / trials) + EULER * normalQuantile(1 - 1 / (trials * Math.E)));
}

export class TrialRegistry {
  constructor() { this.n = 0; }
  register(count = 1) { this.n += count; return this.n; }
  count() { return Math.max(1, this.n); }
}

export function deflatedSharpe(x, { trials, srVariance }) {
  const sr = sharpe(x);
  const { skew, kurt } = sharpeMoments(x);
  const sr0 = expectedMaxSharpe(trials, srVariance);
  const denom = Math.sqrt(1 - skew * sr + ((kurt - 1) / 4) * sr * sr);
  return normalCdf(((sr - sr0) * Math.sqrt(x.length - 1)) / denom);
}

export function selectAndTest(matrix, registry) {
  const srs = matrix.map(sharpe);
  let best = 0;
  for (let j = 1; j < srs.length; j++) if (srs[j] > srs[best]) best = j;
  const dsr = deflatedSharpe(matrix[best], { trials: registry.count(), srVariance: variance(srs) });
  return { best, sharpe: srs[best], dsr };
}

export function pbo(matrix, partitions = 8) {
  const T = matrix[0].length, N = matrix.length;
  const size = Math.floor(T / partitions);
  const blocks = Array.from({ length: partitions }, (_, b) => [b * size, (b + 1) * size]);
  const sr = (j, chosen) => {
    const vals = [];
    for (const b of chosen) for (let t = blocks[b][0]; t < blocks[b][1]; t++) vals.push(matrix[j][t]);
    return sharpe(vals);
  };
  const combos = [];
  const pick = (start, acc) => {
    if (acc.length === partitions / 2) { combos.push(acc.slice()); return; }
    for (let b = start; b < partitions; b++) { acc.push(b); pick(b + 1, acc); acc.pop(); }
  };
  pick(0, []);
  let below = 0;
  for (const train of combos) {
    const test = Array.from({ length: partitions }, (_, b) => b).filter((b) => !train.includes(b));
    let best = 0, bestSr = -Infinity;
    for (let j = 0; j < N; j++) { const s = sr(j, train); if (s > bestSr) { bestSr = s; best = j; } }
    const oos = [];
    for (let j = 0; j < N; j++) oos.push(sr(j, test));
    const rank = oos.filter((v) => v < oos[best]).length + 0.5 * (oos.filter((v) => v === oos[best]).length - 1);
    const omega = (rank + 1) / (N + 1);
    if (Math.log(omega / (1 - omega)) <= 0) below++;
  }
  return below / combos.length;
}

export function hawkesResiduals(times, marks, { mu, beta, branching }) {
  const out = new Float64Array(times.length);
  let s = 0, prev = 0;
  for (let i = 0; i < times.length; i++) {
    const dt = times[i] - prev;
    const decay = Math.exp(-beta * dt);
    out[i] = mu * dt + s * (1 - decay);
    s = s * decay + branching * marks[i];
    prev = times[i];
  }
  return out;
}

export const ALERT = Object.freeze({ mPrime: 1200, alpha: 0.1, thetas: Object.freeze([1.5, 2, 3, 5, 8]) });

let harmonicCache = null;
export function alertLine() {
  if (harmonicCache === null) {
    let h = 0;
    for (let k = 1; k <= ALERT.mPrime; k++) h += 1 / k;
    harmonicCache = (ALERT.mPrime * h) / ALERT.alpha;
  }
  return harmonicCache;
}

const nbTerm = (x, mu, r) => r * Math.log(r / (r + mu)) + x * Math.log(mu / (r + mu));

export function fixedEProcess(counts, { lambda, r }) {
  const thetas = ALERT.thetas;
  const acc = new Float64Array(thetas.length);
  const k = new Float64Array(counts.length);
  for (let j = 0; j < counts.length; j++) {
    const l0 = nbTerm(counts[j], lambda, r);
    let sum = 0;
    for (let t = 0; t < thetas.length; t++) {
      acc[t] = Math.min(acc[t] + nbTerm(counts[j], thetas[t] * lambda, r) - l0, 700);
      sum += Math.exp(acc[t]);
    }
    k[j] = sum / thetas.length;
  }
  return k;
}

const logSumExp = (a, off) => {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i] + off[i]; if (v > m) m = v; }
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.exp(a[i] + off[i] - m);
  return m + Math.log(s);
};

export function hierEProcess(counts, { lambda, r, sdDay, grid = 25, thetas = [2, 3, 5], spacing = 30 }) {
  const G = Array.from({ length: grid }, (_, i) => -1.6 + (3.2 * i) / (grid - 1));
  const prior = G.map((g) => -0.5 * ((g + (sdDay * sdDay) / 2) / sdDay) ** 2);
  const norm = logSumExp(prior, new Float64Array(grid));
  let post = Float64Array.from(prior, (v) => v - norm);
  const mu0 = G.map((g) => lambda * Math.exp(g));
  const a0 = mu0.map((m) => r * Math.log(r / (r + m))), b0 = mu0.map((m) => Math.log(m / (r + m)));
  const alt = thetas.map((th) => {
    const mu = mu0.map((m) => th * m);
    return { a: mu.map((m) => r * Math.log(r / (r + m))), b: mu.map((m) => Math.log(m / (r + m))) };
  });
  const taus = [];
  for (let t = 0; t < counts.length; t += spacing) taus.push(t);
  const frozen = taus.map(() => null);
  const logK = thetas.map(() => new Float64Array(taus.length));
  const out = new Float64Array(counts.length);
  const ll = new Float64Array(grid), llt = new Float64Array(grid);
  for (let j = 0; j < counts.length; j++) {
    const x = counts[j];
    for (let ti = 0; ti < taus.length; ti++) if (taus[ti] === j) frozen[ti] = Float64Array.from(post);
    for (let g = 0; g < grid; g++) ll[g] = a0[g] + x * b0[g];
    const lpNull = logSumExp(post, ll);
    for (let k = 0; k < thetas.length; k++) {
      for (let g = 0; g < grid; g++) llt[g] = alt[k].a[g] + x * alt[k].b[g];
      for (let ti = 0; ti < taus.length; ti++) if (frozen[ti] !== null) logK[k][ti] += logSumExp(frozen[ti], llt) - lpNull;
    }
    for (let g = 0; g < grid; g++) post[g] += ll[g];
    const z = logSumExp(post, new Float64Array(grid));
    for (let g = 0; g < grid; g++) post[g] -= z;
    let m = 0;
    for (let k = 0; k < thetas.length; k++) for (let ti = 0; ti < taus.length; ti++) if (logK[k][ti] > m) m = logK[k][ti];
    let s = 0;
    for (let k = 0; k < thetas.length; k++) for (let ti = 0; ti < taus.length; ti++) s += Math.exp(logK[k][ti] - m);
    out[j] = Math.exp(m + Math.log(s / (thetas.length * taus.length)));
  }
  return out;
}

export function alertTier(counts, { lambda, r, sdDay }) {
  const withDayEffect = true;
  return withDayEffect ? hierEProcess(counts, { lambda, r, sdDay }) : fixedEProcess(counts, { lambda, r });
}
