import { forwardClose } from "./flows-record.js";

export const CONVICTION = Object.freeze({
  v: 1,
  horizons: Object.freeze([5, 10]),
  stated: 10,
  minSessions: 60,
  minRows: 600,
  minBreadthRows: 200,
  minNamesPerSession: 5,
  effect: 0.05,
  powerZ: 2.8,
  maxIter: 60,
});

export const CONVICTION_LABELS = Object.freeze({
  keep: "Conviction",
  relabel: "Agreement index",
  pending: "Conviction",
});

export const CONVICTION_NOTES = Object.freeze({
  rule: "The question: do boards with a higher conviction print hit more often than boards with a lower one? " +
    "A name is a hit when it beat the session's equal-weight average board name by any amount in the direction " +
    "of its board, measured from the close the board was published at. The rule was fixed before the first " +
    "look: conviction is kept only when the slope of a logistic fit of hit on conviction has a 95% interval " +
    "above zero AND the hit rate rises across the low, middle and high terciles of conviction. Otherwise the " +
    "number is an agreement index and is not called conviction. Breadth is added to the reading only when its " +
    "own coefficient is significant.",
  market: "There is no index series in the archive, so the market is the equal-weight average forward return " +
    "of every measured name on that session's two boards. Selection puts the best-scored names on the long " +
    "board and the worst on the short board, so this average sits between the two tails and is not an index.",
  cluster: "Names published on one session share its market, so the standard errors group the rows by " +
    "session (a cluster-robust sandwich with the small-sample correction G/(G-1) and (n-1)/(n-k), and a " +
    "Student t interval on G-1 degrees of freedom). The Wilson intervals use the effective count, n divided " +
    "by the design effect the session clusters imply.",
  overlap: "Ten-session windows that start on consecutive sessions overlap by nine sessions, which session " +
    "clusters do not remove, so every interval here is optimistic. A verdict to keep conviction therefore " +
    "needs more than a clearing interval to be believed.",
  floor: "No verdict is drawn before " + CONVICTION.minSessions + " scored sessions and " + CONVICTION.minRows + " rows at the stated horizon.",
});

const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
  2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function tCrit975(df) {
  if (!(df >= 1)) return null;
  const d = Math.floor(df);
  if (d <= 30) return T975[d - 1];
  if (d <= 60) return 2.02;
  if (d <= 120) return 1.99;
  return 1.96;
}

export function wilson(p, n, z = 1.96) {
  if (!Number.isFinite(p) || !(n > 0)) return null;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const m = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d;
  return [Math.max(0, c - m), Math.min(1, c + m)];
}

export function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => row.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
  let scale = 0;
  for (const row of m) for (const v of row) scale = Math.max(scale, Math.abs(v));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (!(Math.abs(a[p][c]) > 1e-11 * scale)) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

const softplus = (z) => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));

export function logitFit(X, y, cluster, { maxIter = CONVICTION.maxIter } = {}) {
  const n = y.length;
  const K = n ? X[0].length : 0;
  if (n < K + 2) return null;
  const ones = y.reduce((a, v) => a + v, 0);
  if (ones === 0 || ones === n) return null;
  const dot = (row, b) => { let z = 0; for (let k = 0; k < K; k++) z += row[k] * b[k]; return z; };
  const loglik = (b) => { let s = 0; for (let i = 0; i < n; i++) { const z = dot(X[i], b); s += y[i] * z - softplus(z); } return s; };
  let beta = new Array(K).fill(0);
  beta[0] = Math.log(ones / (n - ones));
  let ll = loglik(beta);
  let converged = false;
  let hessInv = null;
  for (let iter = 0; iter < maxIter; iter++) {
    const grad = new Array(K).fill(0);
    const H = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let i = 0; i < n; i++) {
      const p = 1 / (1 + Math.exp(-dot(X[i], beta)));
      const w = p * (1 - p);
      const e = y[i] - p;
      for (let a = 0; a < K; a++) {
        grad[a] += e * X[i][a];
        for (let b = a; b < K; b++) H[a][b] += w * X[i][a] * X[i][b];
      }
    }
    for (let a = 0; a < K; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    hessInv = invert(H);
    if (!hessInv) return null;
    const step = hessInv.map((row) => row.reduce((s, v, j) => s + v * grad[j], 0));
    let t = 1;
    let next = beta;
    let nextLl = ll;
    for (let tries = 0; tries < 30; tries++) {
      next = beta.map((v, k) => v + t * step[k]);
      nextLl = loglik(next);
      if (nextLl >= ll - 1e-12) break;
      t /= 2;
    }
    const moved = Math.max(...step.map((v) => Math.abs(t * v)));
    beta = next;
    ll = nextLl;
    if (moved < 1e-10) { converged = true; break; }
  }
  if (!converged || beta.some((v) => !Number.isFinite(v) || Math.abs(v) > 30)) return null;

  const H = Array.from({ length: K }, () => new Array(K).fill(0));
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const p = 1 / (1 + Math.exp(-dot(X[i], beta)));
    const w = p * (1 - p);
    const e = y[i] - p;
    let s = groups.get(cluster[i]);
    if (!s) { s = new Array(K).fill(0); groups.set(cluster[i], s); }
    for (let a = 0; a < K; a++) {
      s[a] += e * X[i][a];
      for (let b = a; b < K; b++) H[a][b] += w * X[i][a] * X[i][b];
    }
  }
  for (let a = 0; a < K; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
  const bread = invert(H);
  if (!bread) return null;
  const G = groups.size;
  const meat = Array.from({ length: K }, () => new Array(K).fill(0));
  for (const s of groups.values()) for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) meat[a][b] += s[a] * s[b];
  const mid = bread.map((row) => meat[0].map((_, j) => row.reduce((acc, v, k) => acc + v * meat[k][j], 0)));
  const sandwich = mid.map((row) => bread[0].map((_, j) => row.reduce((acc, v, k) => acc + v * bread[k][j], 0)));
  const correction = G > 1 ? (G / (G - 1)) * ((n - 1) / Math.max(1, n - K)) : NaN;
  const se = sandwich.map((row, a) => Math.sqrt(Math.max(0, row[a] * correction)));
  const seNaive = bread.map((row, a) => Math.sqrt(Math.max(0, row[a])));
  return { beta, se, seNaive, n, G, ll };
}

function interval(est, se, G) {
  const t = tCrit975(G - 1);
  if (!Number.isFinite(est) || !Number.isFinite(se) || t === null) return null;
  return [est - t * se, est + t * se];
}

function averageRanks(values) {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = rank;
    i = j + 1;
  }
  return ranks;
}

export function spearman(xs, ys, cluster = null) {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const rx = averageRanks(xs), ry = averageRanks(ys);
  const sums = (idx) => {
    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0, m = 0;
    for (const i of idx) { sx += rx[i]; sy += ry[i]; sxy += rx[i] * ry[i]; sxx += rx[i] * rx[i]; syy += ry[i] * ry[i]; m++; }
    return { sx, sy, sxy, sxx, syy, m };
  };
  const corr = (s) => {
    const den = Math.sqrt((s.m * s.sxx - s.sx * s.sx) * (s.m * s.syy - s.sy * s.sy));
    return den > 0 ? (s.m * s.sxy - s.sx * s.sy) / den : NaN;
  };
  const all = sums(rx.keys());
  const rho = corr(all);
  if (!Number.isFinite(rho)) return null;
  let se = null;
  if (cluster) {
    const by = new Map();
    for (let i = 0; i < n; i++) {
      let s = by.get(cluster[i]);
      if (!s) { s = { sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0, m: 0 }; by.set(cluster[i], s); }
      s.sx += rx[i]; s.sy += ry[i]; s.sxy += rx[i] * ry[i]; s.sxx += rx[i] * rx[i]; s.syy += ry[i] * ry[i]; s.m++;
    }
    const G = by.size;
    if (G > 2) {
      const left = [];
      for (const s of by.values()) {
        const r = corr({ sx: all.sx - s.sx, sy: all.sy - s.sy, sxy: all.sxy - s.sxy, sxx: all.sxx - s.sxx, syy: all.syy - s.syy, m: all.m - s.m });
        if (Number.isFinite(r)) left.push(r);
      }
      if (left.length > 2) {
        const mean = left.reduce((a, v) => a + v, 0) / left.length;
        se = Math.sqrt(((left.length - 1) / left.length) * left.reduce((a, v) => a + (v - mean) * (v - mean), 0));
      }
    }
  }
  return { rho, se, n };
}

function groupStat(rows) {
  const n = rows.length;
  if (!n) return { n: 0, hits: 0, rate: null, deff: null, nEff: null, ci: null };
  const by = new Map();
  let hits = 0;
  for (const r of rows) {
    hits += r.hit;
    const s = by.get(r.g) || { n: 0, h: 0 };
    s.n++; s.h += r.hit;
    by.set(r.g, s);
  }
  const p = hits / n;
  const clusters = by.size;
  let deff = 1;
  if (clusters > 1 && p > 0 && p < 1) {
    let ss = 0;
    for (const s of by.values()) ss += (s.h - p * s.n) * (s.h - p * s.n);
    const varCluster = (clusters / (clusters - 1)) * ss / (n * n);
    const varBinom = p * (1 - p) / n;
    deff = Math.max(1, varCluster / varBinom);
  }
  const nEff = n / deff;
  const ci = wilson(p, nEff);
  return { n, hits, rate: p, deff, nEff, ci, by };
}

function tercileSplit(rows, G) {
  const sorted = rows.map((r) => r.x).sort((a, b) => a - b);
  const n = sorted.length;
  const c1 = sorted[Math.max(0, Math.ceil(n / 3) - 1)];
  const c2 = sorted[Math.max(0, Math.ceil(2 * n / 3) - 1)];
  const parts = [[], [], []];
  for (const r of rows) parts[r.x <= c1 ? 0 : r.x > c2 ? 2 : 1].push(r);
  const stats = parts.map((p) => groupStat(p));
  const lo = stats[0], hi = stats[2];
  let diff = null;
  if (lo.n && hi.n && lo.rate !== null && hi.rate !== null) {
    const zs = new Map();
    for (const [g, s] of hi.by) zs.set(g, (zs.get(g) || 0) + (s.h - hi.rate * s.n) / hi.n);
    for (const [g, s] of lo.by) zs.set(g, (zs.get(g) || 0) - (s.h - lo.rate * s.n) / lo.n);
    let ss = 0;
    for (const z of zs.values()) ss += z * z;
    const clusters = Math.max(1, G);
    const se = clusters > 1 ? Math.sqrt((clusters / (clusters - 1)) * ss) : null;
    const value = hi.rate - lo.rate;
    diff = { value, se, ci: se === null ? null : interval(value, se, clusters) };
  }
  return { cuts: [c1, c2], stats, diff };
}

function collect(datedBoards, closes, calendar, calendarIdx, h, { epoch, breaks, minNames }) {
  const byDate = new Map();
  for (const b of datedBoards || []) {
    if (!b || typeof b.d !== "string" || (b.side !== "long" && b.side !== "short")) continue;
    if (epoch && b.d < epoch) continue;
    if (!byDate.has(b.d)) byDate.set(b.d, []);
    const list = byDate.get(b.d);
    for (const row of Array.isArray(b.rows) ? b.rows : []) list.push({ side: b.side, row });
  }
  const dates = [...byDate.keys()].sort();
  const rows = [];
  let g = 0;
  const used = [];
  for (const d of dates) {
    const seen = new Set();
    const measured = [];
    for (const { side, row } of byDate.get(d)) {
      if (!row || typeof row.t !== "string" || seen.has(row.t)) continue;
      const entry = fin(row.px);
      if (entry === null || entry <= 0) continue;
      const fc = forwardClose(closes, calendar, calendarIdx, row.t, d, h, breaks);
      if (fc.state !== "ok") continue;
      seen.add(row.t);
      measured.push({ side, row, r: fc.exit / entry - 1 });
    }
    if (measured.length < minNames) continue;
    const market = measured.reduce((a, m) => a + m.r, 0) / measured.length;
    let any = false;
    for (const m of measured) {
      const cnv = fin(m.row.cnv);
      if (cnv === null) continue;
      const y = (m.side === "long" ? 1 : -1) * (m.r - market);
      rows.push({ g, x: cnv / 100, bth: fin(m.row.bth), hit: y > 0 ? 1 : 0, y });
      any = true;
    }
    if (any) { used.push(d); g++; }
  }
  return { rows, dates: used };
}

export function horizonReading(rows, G, h) {
  const n = rows.length;
  const hits = rows.reduce((a, r) => a + r.hit, 0);
  const out = { k: h, rows: n, sessions: G, hitRate: n ? round(hits / n, 4) : null };
  const fit = logitFit(rows.map((r) => [1, r.x]), rows.map((r) => r.hit), rows.map((r) => r.g));
  if (!fit) {
    out.slope = null;
    out.fitReason = "the logistic fit did not converge or one outcome never occurred";
  } else {
    const b = fit.beta[1], se = fit.se[1];
    const ci = interval(b, se, fit.G);
    out.slope = {
      b: round(b, 4), se: round(se, 4), seNaive: round(fit.seNaive[1], 4),
      lo: ci ? round(ci[0], 4) : null, hi: ci ? round(ci[1], 4) : null,
      or10: round(Math.exp(b / 10), 4),
      or10Lo: ci ? round(Math.exp(ci[0] / 10), 4) : null, or10Hi: ci ? round(Math.exp(ci[1] / 10), 4) : null,
    };
  }
  const split = tercileSplit(rows, G);
  out.terciles = split.stats.map((s, i) => ({
    n: s.n, hits: s.hits, rate: s.rate === null ? null : round(s.rate, 4),
    lo: s.ci ? round(s.ci[0], 4) : null, hi: s.ci ? round(s.ci[1], 4) : null,
    nEff: s.nEff === null ? null : round(s.nEff, 1), deff: s.deff === null ? null : round(s.deff, 2),
    from: i === 0 ? null : round(split.cuts[i - 1] * 100, 1), to: i === 2 ? null : round(split.cuts[i] * 100, 1),
  }));
  out.monotone = split.stats.every((s) => s.rate !== null) && split.stats[0].rate < split.stats[1].rate && split.stats[1].rate < split.stats[2].rate;
  if (split.diff) {
    const se = split.diff.se;
    const mde = se === null ? null : CONVICTION.powerZ * se;
    out.diff = {
      value: round(split.diff.value, 4), se: se === null ? null : round(se, 4),
      lo: split.diff.ci ? round(split.diff.ci[0], 4) : null, hi: split.diff.ci ? round(split.diff.ci[1], 4) : null,
    };
    out.power = {
      mde: mde === null ? null : round(mde, 4), effect: CONVICTION.effect,
      detectable: mde === null ? null : mde <= CONVICTION.effect,
    };
  } else {
    out.diff = null;
    out.power = null;
  }
  const rho = spearman(rows.map((r) => r.x), rows.map((r) => r.y), rows.map((r) => r.g));
  out.spearman = rho ? { rho: round(rho.rho, 4), se: rho.se === null ? null : round(rho.se, 4), n: rho.n } : null;

  const withB = rows.filter((r) => r.bth !== null);
  out.breadth = null;
  if (withB.length >= CONVICTION.minBreadthRows) {
    const mean = withB.reduce((a, r) => a + r.bth, 0) / withB.length;
    const j = logitFit(withB.map((r) => [1, r.x, r.bth - mean]), withB.map((r) => r.hit), withB.map((r) => r.g));
    if (j) {
      const c = j.beta[2], se = j.se[2];
      const ci = interval(c, se, j.G);
      out.breadth = {
        c: round(c, 4), se: round(se, 4), lo: ci ? round(ci[0], 4) : null, hi: ci ? round(ci[1], 4) : null,
        significant: !!(ci && (ci[0] > 0 || ci[1] < 0)), rows: withB.length,
      };
    }
  }
  return out;
}

export function decide(reading) {
  if (!reading || !reading.slope) return "pending";
  const s = reading.slope;
  return s.lo !== null && s.lo > 0 && reading.monotone === true ? "keep" : "relabel";
}

export function evaluateConviction(datedBoards, closesByTicker, calendar, {
  epoch = null, breaks = null, through = null, horizons = CONVICTION.horizons, stated = CONVICTION.stated,
  minSessions = CONVICTION.minSessions, minRows = CONVICTION.minRows,
} = {}) {
  const cal = typeof through === "string" && through ? calendar.filter((d) => d <= through) : calendar;
  const calendarIdx = new Map(cal.map((d, i) => [d, i]));
  const readings = [];
  let sample = null;
  for (const h of [...new Set([...horizons, stated])].sort((a, b) => a - b)) {
    const { rows, dates } = collect(datedBoards, closesByTicker, cal, calendarIdx, h, {
      epoch, breaks, minNames: CONVICTION.minNamesPerSession,
    });
    const reading = horizonReading(rows, dates.length, h);
    reading.firstSession = dates.length ? dates[0] : null;
    reading.lastSession = dates.length ? dates[dates.length - 1] : null;
    readings.push(reading);
    if (h === stated) sample = reading;
  }
  const out = {
    v: CONVICTION.v, horizon: stated, epoch: epoch || null,
    rule: { minSessions, minRows, confidence: 0.95, effect: CONVICTION.effect },
    horizons: readings, notes: CONVICTION_NOTES,
  };
  if (!sample || sample.sessions < minSessions || sample.rows < minRows) {
    return {
      ...out, status: "pending", verdict: "pending", label: CONVICTION_LABELS.pending, addBreadth: false,
      reason: `${sample ? sample.sessions : 0} scored session${sample && sample.sessions === 1 ? "" : "s"} and ` +
        `${sample ? sample.rows : 0} rows at the ${stated}-session horizon, against the ${minSessions} sessions and ` +
        `${minRows} rows a verdict needs`,
    };
  }
  const verdict = decide(sample);
  if (verdict === "pending") {
    return {
      ...out, status: "pending", verdict, label: CONVICTION_LABELS.pending, addBreadth: false,
      reason: sample.fitReason || "the fit could not be made",
    };
  }
  return {
    ...out, status: "ok", verdict, label: CONVICTION_LABELS[verdict],
    addBreadth: verdict === "keep" && !!(sample.breadth && sample.breadth.significant),
    reason: null,
  };
}
