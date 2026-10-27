import { mulberry32 } from "../../shared/flows-stats.js";

export function exactScaled(v, exp) {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(Math.abs(v).toString());
  if (!m) throw new Error("exactScaled: " + v);
  const digits = BigInt(m[1] + (m[2] || ""));
  const k = (m[3] ? Number(m[3]) : 0) - (m[2] ? m[2].length : 0) - exp;
  let r;
  if (k >= 0) r = digits * 10n ** BigInt(k);
  else {
    const d = 10n ** BigInt(-k);
    r = (digits * 2n + d) / (2n * d);
  }
  return v < 0 && r !== 0n ? -Number(r) : Number(r);
}

export const STEP_EXP = Object.freeze({ usd: 3, contracts: 0, sigma: -2, vol_pt: -1, pct: -1, pctile: 0, ratio: -2, sessions: 0, days: 0, bool: 0 });

function glRule(n) {
  const nodes = [];
  const weights = [];
  for (let i = 0; i < n; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let dp = 1;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-16) break;
    }
    nodes.push(x);
    weights.push(2 / ((1 - x * x) * dp * dp));
  }
  return { nodes, weights };
}

const GL = glRule(24);

export function integrate(f, a, b, panels = 12) {
  let total = 0;
  const h = (b - a) / panels;
  for (let p = 0; p < panels; p++) {
    const lo = a + p * h;
    const mid = lo + h / 2;
    let s = 0;
    for (let i = 0; i < GL.nodes.length; i++) s += GL.weights[i] * f(mid + (h / 2) * GL.nodes[i]);
    total += (s * h) / 2;
  }
  return total;
}

const T5C = 8 / (3 * Math.sqrt(5) * Math.PI);

export function t5UpperRef(t) {
  if (t < 0) return 1 - t5UpperRef(-t);
  if (t < 0.5) return 0.5 - integrate((x) => T5C * Math.pow(1 + (x * x) / 5, -3), 0, t);
  return integrate((s) => (T5C * 125 * s ** 4) / (5 * s * s + 1) ** 3, 0, 1 / t);
}

export function medianRef(xs) {
  const a = xs.slice().sort((p, q) => p - q);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export function robustZRef({ x, baseline, floor, log = false, min = 15, window = 20 }) {
  const vals = baseline.slice(0, window).filter((v) => typeof v === "number" && Number.isFinite(v) && (!log || v > 0)).map((v) => (log ? Math.log(v) : v));
  if (vals.length < min) return { z: null, reason: "warming", n: vals.length };
  const med = medianRef(vals);
  const mad = medianRef(vals.map((v) => Math.abs(v - med)));
  const raw = 1.4826 * mad;
  const fl = Math.max(floor ? floor.abs || 0 : 0, (floor ? floor.rel || 0 : 0) * Math.abs(med));
  const scale = Math.max(raw, fl);
  const xv = log ? Math.log(x) : x;
  return { z: (xv - med) / scale, floored: raw < fl, n: vals.length, scale };
}

export function bhRef(ps, q) {
  const idx = ps.map((p, i) => i).filter((i) => Number.isFinite(ps[i])).sort((a, b) => ps[a] - ps[b]);
  const m = idx.length;
  let k = 0;
  for (let r = 1; r <= m; r++) if (ps[idx[r - 1]] <= (r * q) / m) k = r;
  const reject = ps.map(() => false);
  for (let r = 0; r < k; r++) reject[idx[r]] = true;
  return { reject, k, m };
}

export function mcExpectedHits({ m, pThr, q = 0.05, trials, seed }) {
  const rng = mulberry32(seed);
  let total = 0;
  let sq = 0;
  for (let t = 0; t < trials; t++) {
    let p = 0;
    const ps = [];
    for (let j = 0; j < m; j++) {
      const u = rng();
      p += (1 - p) * (1 - Math.pow(u, 1 / (m - j)));
      if (p > q) break;
      ps.push(p);
    }
    let R = 0;
    for (let k = 1; k <= ps.length; k++) if (ps[k - 1] <= (k * q) / m) R = k;
    let hits = 0;
    for (let j = 0; j < R; j++) if (ps[j] <= pThr) hits++;
    total += hits;
    sq += hits * hits;
  }
  const mean = total / trials;
  return { mean, se: Math.sqrt(Math.max(0, sq / trials - mean * mean) / trials) };
}

export function exactSmallM(m, pThr, q) {
  if (m === 1) return Math.min(pThr, q);
  if (m === 2) {
    const a = q / 2;
    return 2 * (Math.min(pThr, a) + Math.max(0, Math.min(pThr, q) - a) * q);
  }
  return null;
}

export function refEdge(v, flaw = null) {
  const hits = [];
  let phase = "armed";
  let count = 0;
  let sawFalse = false;
  let coolUntil = -Infinity;
  const cool = flaw === "no-cooldown" ? 0 : (v.cooldown || 0) + (flaw === "cooldown-off-by-one" ? 1 : 0);
  const truth = (x) => (v.op === ">=" ? x >= v.x : x <= v.x);
  const holds = (x) => (v.op === ">=" ? x >= v.x - v.h : x <= v.x + v.h);
  v.looks.forEach((x, i) => {
    if (x === null) return;
    const session = v.sessions ? v.sessions[i] : i;
    if (flaw === "level") {
      if (truth(x)) hits.push(i);
      return;
    }
    if (phase === "firing") {
      if (!holds(x)) {
        phase = "armed";
        count = 0;
        sawFalse = true;
      }
      return;
    }
    if (!truth(x)) {
      count = 0;
      sawFalse = true;
      return;
    }
    if (session < coolUntil) return;
    count += 1;
    if (count < v.persist) return;
    if (v.edge === "state" && !sawFalse) return;
    hits.push(i);
    phase = "firing";
    count = 0;
    coolUntil = session + cool;
  });
  return hits;
}

export function liveOracle({ persist, looks }) {
  const hits = [];
  const bySession = new Map();
  looks.forEach((l, i) => {
    if (l.t === null) return;
    const s = bySession.get(l.session) || { count: 0, fired: false };
    bySession.set(l.session, s);
    if (s.fired) return;
    if (l.t === false) {
      s.count = 0;
      return;
    }
    s.count += 1;
    if (s.count >= persist) {
      s.fired = true;
      hits.push(i);
    }
  });
  return hits;
}
