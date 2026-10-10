import {
  SMILE_LINES, sliceSvi, sliceTotalVariance, sviButterflyCheck, sviWingCheck, sliceChecks, fitSviRepaired, fitStats,
} from "./flows-quant-smile.js";

export const SURFACE_LINES = Object.freeze({
  GRID_POINTS: 401,
  CALENDAR_FLOOR: -1e-12,
  REFINE_BELOW: 1e-4,
  SWEEPS: 3,
  LAMBDAS: [1e4, 1e6, 1e8],
  LIFT_ROUNDS: 4,
  LIFT_MARGIN: 1e-7,
  MIN_POINTS: 5,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);

export function surfaceKind(slice) {
  if (!slice) return "none";
  if (slice.method === "flat") return "flat";
  if (slice.method === "mixture") return "mixture";
  return "smile";
}

export function sliceRange(slice) {
  if (!slice || !fin(slice.kMin) || !fin(slice.kMax)) return null;
  return [slice.kMin - SMILE_LINES.CHECK_PAD, slice.kMax + SMILE_LINES.CHECK_PAD];
}

export function pairDomain(lower, upper) {
  const a = sliceRange(lower), b = sliceRange(upper);
  if (!a || !b) return null;
  const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
  return lo < hi ? [lo, hi] : null;
}

function gridOf(domain) {
  const n = SURFACE_LINES.GRID_POINTS, [lo, hi] = domain;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = lo + (hi - lo) * i / (n - 1);
  return out;
}

function refineMin(f, a, b) {
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a), d = a + r * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < 60 && b - a > 1e-12; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = f(d); }
  }
  const x = (a + b) / 2;
  return { k: x, gap: f(x) };
}

function gapProfile(lower, upper) {
  const floor = SURFACE_LINES.CALENDAR_FLOOR;
  if (lower.kind === "flat" || upper.kind === "flat") return { gap: null, k: null, region: null, domain: null };
  const diff = (k) => {
    const a = sliceTotalVariance(lower.slice, k), b = sliceTotalVariance(upper.slice, k);
    return fin(a) && fin(b) ? b - a : Infinity;
  };
  const domain = pairDomain(lower.slice, upper.slice);
  if (!domain) return { gap: null, k: null, region: null, domain: null };
  const grid = gridOf(domain);
  const n = grid.length;
  const gaps = new Float64Array(n);
  let worst = Infinity, worstK = null, first = -1, last = -1;
  for (let i = 0; i < n; i++) {
    const g = diff(grid[i]);
    gaps[i] = g;
    if (g === Infinity) continue;
    if (g < worst) { worst = g; worstK = grid[i]; }
    if (g < floor) { if (first < 0) first = i; last = i; }
  }
  if (worst === Infinity) return { gap: null, k: null, region: null, domain };
  let lo = first >= 0 ? grid[first] : null, hi = first >= 0 ? grid[last] : null;
  for (let i = 1; i < n - 1; i++) {
    const g = gaps[i];
    if (!(g < SURFACE_LINES.REFINE_BELOW) || !(g <= gaps[i - 1]) || !(g <= gaps[i + 1])) continue;
    const m = refineMin(diff, grid[i - 1], grid[i + 1]);
    if (m.gap < worst) { worst = m.gap; worstK = m.k; }
    if (m.gap < floor) { lo = lo === null ? m.k : Math.min(lo, m.k); hi = hi === null ? m.k : Math.max(hi, m.k); }
  }
  return { gap: worst, k: worstK, region: lo === null ? null : [lo, hi], domain };
}

export function surfaceChecks(input) {
  const raw = Array.isArray(input) ? input : [];
  const items = raw.map((slice, index) => ({ slice, index, kind: surfaceKind(slice) })).filter((x) => x.kind !== "none")
    .sort((a, b) => a.slice.T - b.slice.T || a.index - b.index);
  const pairs = [];
  let worstGap = null, worstK = null, checked = 0;
  for (let j = 1; j < items.length; j++) {
    for (let i = 0; i < j; i++) {
      const lower = items[i], upper = items[j];
      if (!(upper.slice.T > lower.slice.T)) continue;
      const p = gapProfile(lower, upper);
      if (p.gap === null) continue;
      checked++;
      if (worstGap === null || p.gap < worstGap) { worstGap = p.gap; worstK = p.k; }
      if (p.region) pairs.push({ from: lower.index, to: upper.index, gap: p.gap, k: p.k, region: p.region, domain: p.domain });
    }
  }
  let butterfly = { ok: true, worstG: null, index: null, k: null };
  let lee = { ok: true, worst: null, index: null };
  for (const x of items) {
    if (x.kind !== "smile") continue;
    const p = sliceSvi(x.slice);
    const range = sliceRange(x.slice);
    if (!p || !range) continue;
    const b = sviButterflyCheck({ svi: p, kGrid: [range[0], range[1], (range[1] - range[0]) / (SMILE_LINES.CHECK_POINTS - 1)] });
    if (butterfly.worstG === null || b.minG < butterfly.worstG) butterfly = { ok: butterfly.ok, worstG: b.minG, index: x.index, k: b.kAtMinG };
    if (!b.ok) butterfly.ok = false;
    const l = sviWingCheck({ b: p.b, rho: p.rho });
    if (lee.worst === null || l.value > lee.worst) lee = { ok: lee.ok, worst: l.value, index: x.index };
    if (!l.ok) lee.ok = false;
  }
  const calendar = { ok: pairs.length === 0, worstGap, worstK, pairs, checked };
  return {
    ok: calendar.ok && butterfly.ok && lee.ok,
    calendar, butterfly, lee,
    flat: items.filter((x) => x.kind === "flat").map((x) => x.index),
    mixture: items.filter((x) => x.kind === "mixture").map((x) => x.index),
  };
}

function violation(checks) {
  let mass = 0;
  for (const p of checks.calendar.pairs) mass += -p.gap;
  if (!checks.butterfly.ok && checks.butterfly.worstG !== null) mass += -checks.butterfly.worstG;
  return mass;
}

function repairable(entry) {
  const s = entry && entry.slice;
  return surfaceKind(s) === "smile" && Array.isArray(entry.points) && entry.points.length >= SURFACE_LINES.MIN_POINTS &&
    fin(s.kMin) && fin(s.kMax);
}

function repairedSlice(s, params, stats, checks) {
  return {
    T: s.T, F: s.F, D: s.D, method: "svi-repaired", params, n: s.n, kMin: s.kMin, kMax: s.kMax,
    fitInSpread: stats.fitInSpread, rmseIvPts: stats.rmseIv === null ? null : stats.rmseIv * 100, checks, why: "surface.calendar",
  };
}

function withinFitDrop(s, stats) {
  const was = fin(s.fitInSpread) ? s.fitInSpread : null;
  return !(was !== null && fin(stats.fitInSpread) && stats.fitInSpread < was - SMILE_LINES.REPAIR_MAX_FIT_DROP);
}

function repairOne(entries, slices, j) {
  const entry = entries[j], s = slices[j];
  const lower = [], upper = [];
  for (let i = 0; i < slices.length; i++) {
    const kind = surfaceKind(slices[i]);
    if (i === j || kind === "none" || kind === "flat") continue;
    if (slices[i].T < s.T) lower.push(slices[i]); else if (slices[i].T > s.T) upper.push(slices[i]);
  }
  let rep = null, start = sliceSvi(s);
  for (const lambda of SURFACE_LINES.LAMBDAS) {
    rep = fitSviRepaired({ T: s.T, points: entry.points, prev: lower, next: upper, lambda }, start);
    start = rep.params;
  }
  const checks = sliceChecks(rep.params, s.T, s.kMin, s.kMax, null);
  if (!checks.ok || !withinFitDrop(entry.slice, rep)) return null;
  return repairedSlice(s, rep.params, rep, checks);
}

function liftPass(list, slices) {
  const out = slices.slice();
  const lifted = [];
  const order = out.map((s, i) => i).filter((i) => surfaceKind(out[i]) !== "none").sort((a, b) => out[a].T - out[b].T || a - b);
  const items = new Map(order.map((i) => [i, { slice: out[i], kind: surfaceKind(out[i]), index: i }]));
  for (let n = 1; n < order.length; n++) {
    const j = order[n];
    let cur = items.get(j);
    if (cur.kind !== "smile" || !repairable(list[j])) continue;
    const base = cur.slice;
    const p0 = sliceSvi(base);
    let delta = 0, done = false;
    for (let round = 0; round < SURFACE_LINES.LIFT_ROUNDS && !done; round++) {
      let need = 0;
      for (let m = 0; m < n; m++) {
        const lower = items.get(order[m]);
        if (!(base.T > lower.slice.T)) continue;
        const p = gapProfile(lower, cur);
        if (p.gap !== null && p.region) need = Math.max(need, -p.gap);
      }
      if (!(need > 0)) { done = true; break; }
      delta += need + SURFACE_LINES.LIFT_MARGIN;
      const slice = { T: base.T, F: base.F, D: base.D, method: "svi-repaired", kMin: base.kMin, kMax: base.kMax, params: { ...p0, a: p0.a + delta } };
      cur = { slice, kind: "smile", index: j };
    }
    if (delta === 0 || !done) continue;
    const params = { ...p0, a: p0.a + delta };
    const stats = fitStats(params, list[j].points, base.T);
    const checks = sliceChecks(params, base.T, base.kMin, base.kMax, null);
    if (!checks.ok || !withinFitDrop(list[j].slice, stats)) continue;
    const slice = repairedSlice(base, params, stats, checks);
    out[j] = slice;
    items.set(j, { slice, kind: "smile", index: j });
    lifted.push(j);
  }
  return { slices: out, lifted };
}

export function settleSurface(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let slices = list.map((e) => e.slice);
  const before = surfaceChecks(slices);
  if (before.ok) return { slices, checks: before, before, repaired: [], unrepaired: [], changed: false };
  const repaired = new Set();
  let current = before;
  for (let sweep = 0; sweep < SURFACE_LINES.SWEEPS && !current.ok; sweep++) {
    const touched = new Map();
    for (const p of current.calendar.pairs) {
      for (const id of [p.from, p.to]) touched.set(id, (touched.get(id) || 0) + 1);
    }
    if (!current.butterfly.ok && current.butterfly.index !== null) touched.set(current.butterfly.index, (touched.get(current.butterfly.index) || 0) + 1);
    const order = [...touched.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map((x) => x[0]).filter((j) => repairable(list[j]));
    let progressed = false;
    for (const j of order) {
      const cand = repairOne(list, slices, j);
      if (!cand) continue;
      const trial = slices.slice();
      trial[j] = cand;
      const after = surfaceChecks(trial);
      if (violation(after) < violation(current) - 1e-15) {
        slices = trial; current = after; repaired.add(j); progressed = true;
        if (current.ok) break;
      }
    }
    if (!progressed) break;
  }
  if (!current.ok) {
    const l = liftPass(list, slices);
    if (l.lifted.length) {
      slices = l.slices; current = surfaceChecks(slices);
      for (const j of l.lifted) repaired.add(j);
    }
  }
  const unrepaired = current.calendar.pairs.map((p) => ({ from: p.from, to: p.to, gap: p.gap, k: p.k, region: p.region, domain: p.domain }));
  return { slices, checks: current, before, repaired: [...repaired].sort((a, b) => a - b), unrepaired, changed: repaired.size > 0 };
}

const r6 = (v) => (fin(v) ? Number(v.toFixed(6)) : null);

export function surfaceSummary(result, labels) {
  const name = (i) => (labels && labels[i] !== undefined ? labels[i] : i);
  const c = result.checks;
  return {
    ok: c.ok,
    checked: c.calendar.checked,
    worstGap: r6(c.calendar.worstGap),
    minG: r6(c.butterfly.worstG),
    repaired: result.repaired.map(name),
    violations: result.unrepaired.map((u) => ({ from: name(u.from), to: name(u.to), gap: r6(u.gap), k: r6(u.k) })),
    flat: c.flat.map(name),
  };
}
