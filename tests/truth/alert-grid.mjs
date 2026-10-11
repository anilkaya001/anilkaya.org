import { w9World, W9_OUT_OF_FAMILY } from "./intraday.mjs";
import { betaInc, studentCdf } from "./worlds.mjs";
import { makeRng, normalSurvival } from "./rng.mjs";
import { SCALE } from "./detectors.mjs";
import { mean, wilson } from "./stats.mjs";
import * as stock from "./alert-reference.mjs";

export const Q = 0.1;
export const FDR_BAR = 0.1;
export const EXACT_BAR = 0.02;
export const MIN_NULL_SESSIONS = 400;
export const EXACT_SESSIONS = 200;

export const POWER_CELLS = Object.freeze([
  Object.freeze({ J: 3, D: 1, weight: 0.25 }),
  Object.freeze({ J: 4, D: 15, weight: 0.25 }),
  Object.freeze({ J: 5, D: 15, weight: 0.1 }),
  Object.freeze({ J: 5, D: 60, weight: 0.25 }),
  Object.freeze({ J: 6, D: 1, weight: 0.15 }),
]);
export const REPORTED_CELLS = Object.freeze([
  Object.freeze({ J: 3, D: 60, weight: 0 }),
  Object.freeze({ J: 4, D: 60, weight: 0 }),
  Object.freeze({ J: 4, D: 1, weight: 0 }),
  Object.freeze({ J: 5, D: 1, weight: 0 }),
  Object.freeze({ J: 8, D: 1, weight: 0 }),
  Object.freeze({ J: 3, D: 15, weight: 0 }),
  Object.freeze({ J: 6, D: 15, weight: 0 }),
  Object.freeze({ J: 8, D: 15, weight: 0 }),
  Object.freeze({ J: 6, D: 60, weight: 0 }),
  Object.freeze({ J: 8, D: 60, weight: 0 }),
]);
export const ALL_CELLS = Object.freeze([...POWER_CELLS, ...REPORTED_CELLS]);
export const cellKey = (c) => `J${c.J}D${c.D}`;
export const POWER_WEIGHT_TOTAL = POWER_CELLS.reduce((a, c) => a + c.weight, 0);

export const NU_LADDER = Object.freeze([3, 4, 5, 8, Infinity]);
export const S_LADDER = Object.freeze([0.05, 0.1, 0.15, 0.2, 0.3, 0.45]);

export function lane() {
  const deep = SCALE.deep;
  return {
    deep,
    names: deep ? 670 : 100,
    nullSessions: MIN_NULL_SESSIONS,
    exactSessions: EXACT_SESSIONS,
    powerSessions: deep ? 200 : 100,
    calibrationSessions: 24,
    bankSims: deep ? 40000 : 8000,
    exactBankSims: deep ? 400000 : 200000,
    salt: SCALE.salt,
  };
}

const banks = new Map();

export function sharedBank(L) {
  const key = `${L.salt}|${L.bankSims}|${L.exactBankSims}`;
  if (!banks.has(key)) banks.set(key, stock.nullBank({ sims: L.bankSims, seed: `grid-bank|${L.salt}`, exactSims: L.exactBankSims }));
  return banks.get(key);
}

export function clopperUpper(k, n, alpha = 0.05) {
  if (k >= n) return 1;
  let lo = k / n, hi = 1;
  const cdf = (p) => 1 - betaInc(p, k + 1, n - k);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) > alpha) lo = mid; else hi = mid;
  }
  return hi;
}

export function fdrBound(fdps) {
  const n = fdps.length;
  const m = mean(fdps);
  let k = 0, ss = 0;
  for (const x of fdps) { if (x > 0) k++; ss += (x - m) * (x - m); }
  const se = Math.sqrt(ss / (n - 1) / n);
  const normal = m + 1.645 * se;
  const exact = clopperUpper(k, n);
  return { n, mean: m, se, anyShare: k / n, sessionsWithFalse: k, upper: k < 5 ? exact : Math.min(1, normal), method: k < 5 ? "exact" : "normal" };
}

function nextLighter(v, ladder) {
  const i = ladder.indexOf(v);
  return i < 0 || i === ladder.length - 1 ? v : ladder[i + 1];
}

function nextHeavier(v, ladder) {
  const i = ladder.indexOf(v);
  return i <= 0 ? v : ladder[i - 1];
}

export function effectiveNu(world) {
  const o = world.opts;
  return Float64Array.from(world.names, (nm) => (o.innovation === "t" ? Math.min(nm.nu, 5) : Infinity));
}

function studentQuantile(p, nu) {
  let lo = 0, hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (studentCdf(mid, nu) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const robustCache = new Map();

function robustTail(k, nu) {
  const key = `${k}|${nu}`;
  if (robustCache.has(key)) return robustCache.get(key);
  let v;
  if (!(nu < 1e6)) v = 2 * normalSurvival(k * 1.4826 * 0.6744897501960817);
  else v = 2 * (1 - studentCdf(k * 1.4826 * studentQuantile(0.75, nu), nu));
  robustCache.set(key, v);
  return v;
}

export function standardisedMoves(session, i, out) {
  const B = session.bars, sig = session.sigmaForecast[i];
  for (let b = 0; b < B; b++) out[b] = session.inc[i * B + b] / (sig * Math.sqrt(session.clockForecast[b]));
  return B;
}

export function measurePooled(world, sessions) {
  const N = world.names.length;
  const counts = [0, 1, 2].map(() => ({ total: 0, c3: 0, c4: 0, c5: 0 }));
  const err = [0, 1, 2].map(() => []);
  const buf = new Float64Array(sessions[0].bars);
  const abs = new Float64Array(sessions[0].bars);
  for (const s of sessions) {
    for (let i = 0; i < N; i++) {
      const b = world.names[i].bucket;
      const n = standardisedMoves(s, i, buf);
      for (let t = 0; t < n; t++) abs[t] = Math.abs(buf[t]);
      const sorted = abs.slice(0, n).sort();
      const scale = Math.max(1e-12, 1.4826 * sorted[n >> 1]);
      const c = counts[b];
      for (let t = 0; t < n; t++) { const a = abs[t] / scale; c.total++; if (a > 3) c.c3++; if (a > 4) c.c4++; if (a > 5) c.c5++; }
      err[b].push(Math.log(scale));
    }
  }
  return counts.map((c, b) => {
    const up = [c.c3, c.c4, c.c5].map((k) => wilson(k, c.total)[1]);
    let nu = 3;
    for (const cand of NU_LADDER) {
      if ([3, 4, 5].every((k, j) => robustTail(k, cand) >= up[j])) nu = cand;
    }
    const tierOffTail = ![3, 4, 5].every((k, j) => robustTail(k, 3) >= up[j]);
    const m = mean(err[b]);
    const sHat = Math.sqrt(err[b].reduce((a, x) => a + (x - m) * (x - m), 0) / (err[b].length - 1));
    return { bucket: b, nuHat: nu, sHat, tierOffTail, tails: { c3: c.c3, c4: c.c4, c5: c.c5, total: c.total }, upper: up };
  });
}

export function tierOn(m) {
  return !m.tierOffTail && m.nuHat >= 4 && m.sHat <= 0.3;
}

export function measuredPairs(spec, world, calibration) {
  const N = world.names.length;
  const nu = new Float64Array(N), s = new Float64Array(N);
  if (spec.measure === "oracle") {
    const eff = effectiveNu(world);
    for (let i = 0; i < N; i++) { nu[i] = eff[i]; s[i] = spec.truth.s; }
    return { nu, s, buckets: null };
  }
  const buckets = measurePooled(world, calibration);
  for (let i = 0; i < N; i++) { const b = buckets[world.names[i].bucket]; nu[i] = b.nuHat; s[i] = b.sHat; }
  return { nu, s, buckets };
}

function CONSTRUCTIONS_A_PARAMS(nuHat, sHat, exact) {
  if (exact) return { nu: nuHat, s: sHat };
  return { nu: stock.tableStep(stock.NU_GRID, nuHat - 1, "down"), s: stock.tableStep(stock.S_GRID, stock.OPERATING.scaleInflation * sHat, "up") };
}

export const CONSTRUCTIONS = Object.freeze({
  A: Object.freeze({
    id: "A",
    title: "calibrated session-maximum law",
    windows: stock.OPERATING.windows,
    params(nuHat, sHat, exact) { return CONSTRUCTIONS_A_PARAMS(nuHat, sHat, exact); },
    evaluate: (mod) => mod.evaluateA,
  }),
  A0: Object.freeze({
    id: "A0",
    title: "calibrated session-maximum law without the multi-scale windows",
    windows: Object.freeze([]),
    cfg: Object.freeze({ windows: Object.freeze([]) }),
    params(nuHat, sHat, exact) { return CONSTRUCTIONS_A_PARAMS(nuHat, sHat, exact); },
    evaluate: (mod) => mod.evaluateA,
  }),
  B: Object.freeze({
    id: "B",
    title: "per-increment transformed normal mixture",
    windows: stock.OPERATING.windows,
    params(nuHat, sHat) { return { nu: nuHat, s: sHat }; },
    evaluate: (mod) => mod.evaluateB,
  }),
});

export function hatsFor(construction, measured, step, spec) {
  const N = measured.nu.length;
  const nu = new Float64Array(N), s = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let nh = measured.nu[i], sh = measured.s[i];
    if (step === "light") { nh = nextLighter(nh, NU_LADDER); sh = S_LADDER[Math.max(0, S_LADDER.indexOf(closest(sh, S_LADDER)) - 1)]; }
    if (step === "heavy") { nh = nextHeavier(nh, NU_LADDER); sh = S_LADDER[Math.min(S_LADDER.length - 1, S_LADDER.indexOf(closest(sh, S_LADDER)) + 1)]; }
    const p = construction.params(nh, sh, spec.exactNull === true);
    nu[i] = p.nu; s[i] = p.s;
  }
  return { nu, s, gapNu: spec.gapNuHat || 0 };
}

function closest(v, ladder) {
  let best = ladder[0];
  for (const l of ladder) if (Math.abs(l - v) < Math.abs(best - v)) best = l;
  return best;
}

export function isNullName(session, i, planted) {
  if (planted && planted.has(i)) return false;
  return true;
}

export function scheduledMacro(session) {
  return session.labels && session.labels.factorJumps.some((f) => f.scheduled);
}

export function worldSpecs(L) {
  const salt = L.salt;
  const base = { names: L.names, innovation: "t", nuSet: [3, 4, 5, 8], sectorSigns: true, seasonalError: 0.1 };
  const het = (s) => ({
    id: `het-s${String(Math.round(s * 100)).padStart(2, "0")}`,
    title: `heterogeneous tails (nu 3, 4, 5, 8), scale error ${s}, sector rho 0.3 with random signs`,
    family: "calibration",
    opts: { ...base, sessions: L.nullSessions, seed: `grid|het${s}|${salt}`, scaleError: s },
    sessions: L.nullSessions,
    truth: { s, law: "normal" },
    measure: "oracle",
    steps: ["covered", "light"],
  });
  const specs = {
    exact: {
      id: "exact",
      title: "the exact world: Gaussian increments, correct scale, independent names, null law equal to the truth",
      family: "calibration",
      opts: { names: L.names, sessions: L.exactSessions, seed: `grid|exact-1|${salt}`, innovation: "gaussian", marketRho: 0, sectorRho: 0, seasonalError: 0, scaleError: 0 },
      sessions: L.exactSessions,
      truth: { s: 0, law: "normal" },
      measure: "oracle",
      exactNull: true,
      steps: ["covered"],
    },
    het01: het(0.1),
    het02: het(0.2),
    het03: het(0.3),
    gap: {
      id: "gap",
      title: "the overnight-gap world: t3 gaps carrying half the day's variance, heterogeneous tails, scale error 0.1",
      family: "calibration",
      opts: { ...base, sessions: L.nullSessions, seed: `grid|gap|${salt}`, scaleError: 0.1, gapNu: 3, gapShare: 0.5 },
      sessions: L.nullSessions,
      truth: { s: 0.1, law: "normal" },
      measure: "oracle",
      gapNuHat: 3,
      steps: ["covered"],
    },
  };
  const lightBounce = { half: 0.0002, every: 10 };
  for (const [vc, se, bounce, tag] of [[0.3, 0.1, lightBounce, ""], [0.5, 0.1, lightBounce, ""], [0.5, 0.2, W9_OUT_OF_FAMILY.bounce, "-preset"]]) {
    const id = `w9o-vc${String(Math.round(vc * 10)).padStart(2, "0")}-s${String(Math.round(se * 10)).padStart(2, "0")}${tag}`;
    specs[id.replace(/-/g, "")] = {
      id,
      title: `W9o: dependence at 5 to 60 minutes, log-volatility clustering sd ${vc}, bounce ${bounce.half} on every ${bounce.every}th name, FOMC, CPI and early-close days, t3 scale error ${se}, hot names`,
      family: "out-of-family",
      outOfFamily: true,
      reportOnly: tag === "-preset",
      opts: { ...W9_OUT_OF_FAMILY, scaleError: se, bounce, badTickRate: 0, staleByBucket: [0, 0, 0], volCluster: { sd: vc, halfLife: 30 }, names: L.names, sessions: L.nullSessions + L.calibrationSessions, seed: `grid|${id}|${salt}` },
      sessions: L.nullSessions,
      calibration: L.calibrationSessions,
      truth: { s: null, law: "t3" },
      measure: "pooled",
      steps: ["covered"],
    };
  }
  return specs;
}

export function maskFrames(frames, active) {
  for (const f of frames) for (let i = 0; i < active.length; i++) if (!active[i]) { f.running[i] = 1; f.current[i] = 1; }
}

export function checkMonotone(frames) {
  const N = frames[0].running.length;
  for (let f = 1; f < frames.length; f++) for (let i = 0; i < N; i++) if (frames[f].running[i] > frames[f - 1].running[i] + 1e-15) return false;
  return true;
}

export function comboKey(c) {
  return `${c[0]}:${c[1]}${c[2] && c[2] !== "BY" ? ":" + c[2] : ""}`;
}

export function runNullWorld(spec, L, { bank, mods, combos, onSession = null }) {
  const world = w9World(spec.opts);
  const cal = spec.calibration || 0;
  let calibration = null;
  if (spec.measure === "pooled") {
    calibration = [];
    for (let d = 0; d < cal; d++) calibration.push(world.session(d));
  }
  const measured = measuredPairs(spec, world, calibration);
  const residualMeasured = spec.measure === "oracle" && spec.opts.innovation === "t"
    ? { nu: Float64Array.from(world.names, (nm) => nm.nu), s: measured.s }
    : measured;
  const active = new Uint8Array(world.names.length).fill(1);
  if (measured.buckets) for (let i = 0; i < active.length; i++) active[i] = tierOn(measured.buckets[world.names[i].bucket]) ? 1 : 0;
  const nActive = active.reduce((a, b) => a + b, 0);
  const paused = nActive === 0;
  const hats = new Map();
  for (const c of combos) {
    const arm = c[2] || "BY";
    hats.set(comboKey(c), hatsFor(CONSTRUCTIONS[c[0]], arm === "BHres" || arm === "BYres" ? residualMeasured : measured, c[1], spec));
  }
  const out = new Map();
  for (const c of combos) out.set(comboKey(c), { fdps: [], alerts: 0, macro: 0, monotone: true, unionEqualsClose: true, checked: 0 });
  const mr = world.opts.marketRho, sr = world.opts.sectorRho;
  for (let d = 0; d < spec.sessions; d++) {
    const s = world.session(cal + d);
    const macro = scheduledMacro(s);
    let residual = null;
    for (const c of combos) {
      const key = comboKey(c);
      const arm = c[2] || "BY";
      const input = arm === "BHres" || arm === "BYres" ? (residual || (residual = residualise(s, world.names, { marketRho: mr, sectorRho: sr }))) : s;
      const frames = CONSTRUCTIONS[c[0]].evaluate(mods[c[0]])(input, hats.get(key), bank, CONSTRUCTIONS[c[0]].cfg || {});
      maskFrames(frames, active);
      const r = out.get(key);
      const useBh = arm === "BHraw" || arm === "BHres";
      const set = paused ? new Set() : useBh ? mods[c[0]].bhSessionAlertSet(frames, Q, nActive) : mods[c[0]].sessionAlertSet(frames, Q, nActive);
      if (d < 20 && !useBh) {
        r.checked++;
        if (!checkMonotone(frames)) r.monotone = false;
        const close = new Set(paused ? [] : mods[c[0]].byAlertSet(frames[frames.length - 1].running, Q, nActive));
        if (close.size !== set.size || [...set].some((i) => !close.has(i))) r.unionEqualsClose = false;
      }
      r.alerts += set.size;
      if (macro) r.macro++;
      r.fdps.push(macro || set.size === 0 ? 0 : 1);
      if (onSession) onSession(key, d, frames, set, s);
    }
  }
  const results = {};
  for (const [key, r] of out) results[key] = { ...r, bound: fdrBound(r.fdps) };
  return { id: spec.id, results, measured: measured.buckets, world, paused, active: nActive };
}

function medianOf(a, n) {
  const c = Array.from({ length: n }, (_, i) => a[i]).sort((x, y) => x - y);
  return n % 2 ? c[(n - 1) / 2] : 0.5 * (c[n / 2 - 1] + c[n / 2]);
}

export function residualise(session, names, { marketRho, sectorRho }) {
  const N = session.names, B = session.bars;
  const sectors = new Map();
  names.forEach((nm, i) => { if (!sectors.has(nm.sector)) sectors.set(nm.sector, []); sectors.get(nm.sector).push(i); });
  const beta = Float64Array.from(names, (nm) => nm.beta0);
  const keep = Float64Array.from(names, (nm) => {
    const norm2 = marketRho * nm.beta0 * nm.beta0 + 1 - marketRho;
    return 1 / Math.sqrt(1 - (marketRho * nm.beta0 * nm.beta0 + (1 - marketRho) * sectorRho) / norm2);
  });
  const inc = new Float64Array(N * B);
  const z = new Float64Array(N), ratio = new Float64Array(N);
  for (let b = 0; b < B; b++) {
    const root = Math.sqrt(session.clockForecast[b]);
    for (let i = 0; i < N; i++) { z[i] = session.inc[i * B + b] / (session.sigmaForecast[i] * root); ratio[i] = z[i] / beta[i]; }
    const f = medianOf(ratio, N);
    for (let i = 0; i < N; i++) z[i] -= beta[i] * f;
    for (const members of sectors.values()) {
      const g = medianOf(members.map((k) => names[k].sign * z[k]), members.length);
      for (const k of members) z[k] -= names[k].sign * g;
    }
    for (let i = 0; i < N; i++) inc[i * B + b] = z[i] * keep[i] * session.sigmaForecast[i] * root;
  }
  return { ...session, inc };
}

export function powerPlan(L, N, cells, d, seed, minutes = 390) {
  const rng = makeRng(`${seed}|plan|${d}`);
  const g = Math.max(1, Math.floor((0.05 * N) / cells.length));
  const order = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const out = [];
  let at = 0;
  cells.forEach((c, ci) => {
    for (let k = 0; k < g; k++) {
      out.push({ day: d, name: order[at++], start: 10 + rng.int(minutes - c.D - 20), spread: c.D, size: (rng.uniform() < 0.5 ? -1 : 1) * c.J, cell: ci });
    }
  });
  return { plan: out, group: g };
}

export function powerCells(L) {
  return L.deep ? ALL_CELLS : [...POWER_CELLS, ...REPORTED_CELLS.slice(0, 2)];
}

export function runPower(L, { bank, mods, ids = ["A", "B"], arms = false, sessions = L.powerSessions, scaleError = 0.2, seed = `grid|power|${L.salt}` }) {
  const cells = powerCells(L);
  const N = L.names;
  const base = { names: N, innovation: "t", nuSet: [3, 4, 5, 8], sectorSigns: true, seasonalError: 0.1, scaleError, sessions, seed };
  const plans = [];
  let group = 1;
  for (let d = 0; d < sessions; d++) { const p = powerPlan(L, N, cells, d, seed); group = p.group; plans.push(...p.plan); }
  const world = w9World({ ...base, plantJumps: plans });
  const spec = { measure: "oracle", truth: { s: scaleError }, exactNull: false };
  const measured = measuredPairs(spec, world, null);
  const armNames = arms ? ["BY", "BHraw", "BHres"] : ["BY"];
  const resMeasured = { nu: Float64Array.from(world.names, (nm) => nm.nu), s: measured.s };
  const hats = Object.fromEntries(ids.map((id) => [id, hatsFor(CONSTRUCTIONS[id], measured, "covered", spec)]));
  const resHats = arms ? hatsFor(CONSTRUCTIONS.A, resMeasured, "covered", spec) : null;
  const out = {};
  const ensure = (key) => { if (!out[key]) out[key] = { perSession: new Float64Array(sessions), detected: cells.map(() => 0), planted: cells.map(() => 0), falseAlerts: 0, alerts: 0, fdps: [] }; return out[key]; };
  for (let d = 0; d < sessions; d++) {
    const s = world.session(d);
    const mine = plans.filter((p) => p.day === d);
    const plantedBy = new Map(mine.map((p) => [p.name, p.cell]));
    const account = (key, set) => {
      const r = ensure(key);
      const det = cells.map(() => 0);
      let falseN = 0;
      for (const i of set) { if (plantedBy.has(i)) det[plantedBy.get(i)]++; else falseN++; }
      let w = 0;
      cells.forEach((c, ci) => { r.detected[ci] += det[ci]; r.planted[ci] += group; w += (c.weight * det[ci]) / group; });
      r.perSession[d] = w / POWER_WEIGHT_TOTAL;
      r.falseAlerts += falseN;
      r.alerts += set.size;
      r.fdps.push(set.size ? falseN / set.size : 0);
    };
    for (const id of ids) {
      const frames = CONSTRUCTIONS[id].evaluate(mods[id])(s, hats[id], bank, CONSTRUCTIONS[id].cfg || {});
      account(id, mods[id].sessionAlertSet(frames, Q, N));
    }
    if (arms) {
      const mod = mods.A;
      const rawFrames = CONSTRUCTIONS.A.evaluate(mod)(s, hats.A, bank, {});
      account("A:BHraw", mod.bhSessionAlertSet(rawFrames, Q, N));
      const res = residualise(s, world.names, { marketRho: world.opts.marketRho, sectorRho: world.opts.sectorRho });
      const resFrames = CONSTRUCTIONS.A.evaluate(mod)(res, resHats, bank, {});
      account("A:BHres", mod.bhSessionAlertSet(resFrames, Q, N));
      account("A:BYres", mod.sessionAlertSet(resFrames, Q, N));
    }
  }
  return { cells, group, sessions, N, results: out, world, armNames };
}

export function cellPower(r, cells) {
  const out = {};
  cells.forEach((c, ci) => { out[cellKey(c)] = { weight: c.weight, detected: r.detected[ci], planted: r.planted[ci], power: r.detected[ci] / r.planted[ci] }; });
  return out;
}

export function weightedMean(perCell) {
  let w = 0, t = 0;
  for (const c of POWER_CELLS) { const p = perCell[cellKey(c)]; w += c.weight * p.power; t += c.weight; }
  return w / t;
}

export function pairedDifference(a, b) {
  const n = a.length;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = a[i] - b[i];
  const m = mean(d);
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (d[i] - m) * (d[i] - m);
  return { mean: m, se: Math.sqrt(ss / (n - 1) / n), n };
}

export function qualifies(table) {
  return table.covered.length > 0 && table.covered.every((c) => c.upper <= FDR_BAR);
}

export function worstUpper(table) {
  return Math.max(...table.covered.map((c) => c.upper));
}

export function decide(tables, { pairs = {} } = {}) {
  const ids = Object.keys(tables);
  const qualified = ids.filter((id) => qualifies(tables[id]));
  const basis = { qualified, rejected: ids.filter((id) => !qualified.includes(id)).map((id) => ({ id, cell: tables[id].covered.filter((c) => c.upper > FDR_BAR).map((c) => `${c.id} ${c.upper.toFixed(3)}`).join(", ") || "no covered cell measured" })) };
  if (qualified.length === 0) return { choice: null, rule: "no construction qualifies", ...basis, margin: null };
  if (qualified.length === 1) {
    const id = qualified[0];
    return { choice: id, rule: "sole qualifier", ...basis, margin: { weightedPower: tables[id].weightedPower, runnerUp: null } };
  }
  const ranked = [...qualified].sort((a, b) => tables[b].weightedPower - tables[a].weightedPower || (a < b ? -1 : 1));
  const [top, second] = ranked;
  const diff = pairs[`${top}-${second}`] || (tables[top].perSession && tables[second].perSession ? pairedDifference(tables[top].perSession, tables[second].perSession) : null);
  if (diff && diff.mean > 2 * diff.se) {
    return { choice: top, rule: "higher weighted power by more than twice the paired standard error", ...basis, margin: { weightedPower: tables[top].weightedPower, runnerUp: second, difference: diff.mean, se: diff.se, ratio: diff.mean / diff.se } };
  }
  const byUpper = [...qualified].sort((a, b) => worstUpper(tables[a]) - worstUpper(tables[b]) || (a < b ? -1 : 1));
  const lo = byUpper[0], hi = byUpper[1];
  const tie = Math.abs(worstUpper(tables[lo]) - worstUpper(tables[hi])) < 1e-9;
  const choice = tie ? (qualified.includes("A") ? "A" : byUpper[0]) : lo;
  return { choice, rule: tie ? "power and covered-cell bound tie: A" : "power difference within twice the paired standard error: lower covered-cell bound", ...basis, margin: { weightedPower: tables[choice].weightedPower, runnerUp: choice === top ? second : top, difference: diff ? diff.mean : null, se: diff ? diff.se : null, upperChoice: worstUpper(tables[choice]), upperOther: worstUpper(tables[choice === lo ? hi : lo]) } };
}

export function availability(L, { sessions = 400, window = 20, scaleError = 0.2, seed = `grid|stress|${L.salt}`, threshold = 0.3 } = {}) {
  const dayTypes = ["normal", "normal", "fomc", "normal", "cpi", "normal", "earlyClose", "normal"];
  const world = w9World({ names: L.names, sessions: sessions + window, seed, innovation: "t", nuSet: [3, 4, 5, 8], sectorSigns: true, scaleError, regimeScale: true, dayTypes, paths: false });
  const hist = [];
  const rows = [];
  for (let d = 0; d < sessions + window; d++) {
    const s = world.session(d);
    if (d >= window) {
      const sHat = [0, 1, 2].map((b) => {
        const xs = [];
        for (const h of hist.slice(-window)) for (let i = 0; i < h.length; i++) if (world.names[i].bucket === b) xs.push(h[i]);
        const m = mean(xs);
        return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
      });
      rows.push({ type: s.type, stress: s.stress, on: sHat.every((v) => v <= threshold), sHat });
    }
    hist.push(s.scaleLogError);
  }
  const share = (f) => { const r = rows.filter(f); return r.length ? r.filter((x) => x.on).length / r.length : NaN; };
  return {
    sessions, window, threshold,
    on: share(() => true), onMacro: share((r) => r.type === "fomc" || r.type === "cpi"), onStress: share((r) => r.stress), onCalm: share((r) => !r.stress),
    macroSessions: rows.filter((r) => r.type === "fomc" || r.type === "cpi").length,
    stressSessions: rows.filter((r) => r.stress).length,
    target: 0.9,
  };
}

export function fedPair(measured, step) {
  const N = measured.nu.length;
  const nu = new Float64Array(N), s = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let nh = measured.nu[i], sh = measured.s[i];
    if (step === "light") { nh = nextLighter(nh, NU_LADDER); sh = S_LADDER[Math.max(0, S_LADDER.indexOf(closest(sh, S_LADDER)) - 1)]; }
    if (step === "heavy") { nh = nextHeavier(nh, NU_LADDER); sh = S_LADDER[Math.min(S_LADDER.length - 1, S_LADDER.indexOf(closest(sh, S_LADDER)) + 1)]; }
    nu[i] = nh; s[i] = sh;
  }
  return { nu, s };
}

export function isCovered(spec, world, measured, step) {
  if (spec.measure !== "oracle") return null;
  const eff = effectiveNu(world);
  const fed = fedPair(measured, step);
  for (let i = 0; i < eff.length; i++) {
    if (fed.nu[i] > eff[i]) return false;
    if (fed.s[i] < spec.truth.s - 1e-12) return false;
  }
  return true;
}
