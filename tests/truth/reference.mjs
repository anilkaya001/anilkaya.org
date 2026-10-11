import { mean } from "./stats.mjs";

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
