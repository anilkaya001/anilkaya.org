import { makeRng } from "./rng.mjs";
import { hansen, w1dWorld, w1Closes, w1Garch, closesFromReturns, businessDays, w3Hawkes, w3bSession, w4Bait, w5OiLag, w6Null, w7Calibration, w8Errors } from "./worlds.mjs";
import { mean, median, quantile, variance, ksUniform } from "./stats.mjs";
import { w9World } from "./intraday.mjs";
import { normalCdf } from "./rng.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURES = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures-truth.json", import.meta.url)), "utf8"));

export const W1_BANDS = Object.freeze({
  nu: [5.2, 5.8],
  persistence: [0.955, 0.978],
  tailRatio: [0.75, 0.95],
});

export const SCALE = (() => {
  const deep = process.env.FLOWS_TRUTH_DEEP === "1";
  return { deep, factor: deep ? 10 : 1, salt: process.env.FLOWS_TRUTH_SALT || (deep ? String(Date.now()) : "fixed") };
})();

export const logScore = (p, y) => -Math.log(Math.min(1 - 1e-4, Math.max(1e-4, y ? p : 1 - p)));

export function leakBound(diffs) {
  let sum = 0, sq = 0;
  for (const d of diffs) { sum += d; sq += d * d; }
  const n = diffs.length, mu = sum / n;
  const se = Math.sqrt(Math.max(0, sq / n - mu * mu) / n);
  return { mu, se, fires: se > 0 ? mu < -4 * se : mu < 0, z: se > 0 ? mu / se : 0 };
}

const inBand = (v, [lo, hi]) => v >= lo && v <= hi;

function tailProbability(c, variance, nu, lambda) {
  const h = hansen(nu, lambda);
  const s = Math.sqrt(variance);
  return h.cdf(-c / s) + 1 - h.cdf(c / s);
}

export function measureW1Bands(garchMod, { reps = 120, nu = 5, salt = SCALE.salt } = {}) {
  const nus = [], pers = [], ratios = [];
  let failed = 0;
  for (let i = 0; i < reps; i++) {
    const w = w1Closes({ seed: `w1-band|${salt}|${i}`, nu, n: 750 });
    const f = garchMod.fitGarch(w.closes, w.dates);
    if (f.status !== "ok") { failed++; continue; }
    nus.push(f.nu);
    pers.push(f.persistence);
    const c = 3 * Math.sqrt(w.params.variance);
    ratios.push(tailProbability(c, f.sigma2Next * 1e4, f.nu, f.lambda) / tailProbability(c, w.nextVariance, nu, w.params.lambda));
  }
  return { nu: median(nus), persistence: median(pers), tailRatio: median(ratios), n: nus.length, failed };
}

export function garchRecovery(garchMod) {
  const m = measureW1Bands(garchMod, { reps: 120 * SCALE.factor });
  const ok = inBand(m.nu, W1_BANDS.nu) && inBand(m.persistence, W1_BANDS.persistence) && inBand(m.tailRatio, W1_BANDS.tailRatio) && m.failed === 0;
  return { ok, note: `nu ${m.nu.toFixed(2)} persistence ${m.persistence.toFixed(3)} tail ratio ${m.tailRatio.toFixed(3)}`, measured: m };
}

export function generatorTail(worldsMod) {
  const reps = 4 * SCALE.factor;
  const ks = [3, 4, 5];
  const hit = ks.map(() => 0);
  let total = 0;
  for (let i = 0; i < reps; i++) {
    const w = worldsMod.w1Garch({ seed: `w1-tail|${SCALE.salt}|${i}`, nu: 5, lambda: -0.15, n: 100000 });
    for (let t = 0; t < w.r.length; t++) {
      const z = w.r[t] / w.sigma[t];
      for (let j = 0; j < ks.length; j++) if (Math.abs(z) > ks[j]) hit[j]++;
    }
    total += w.r.length;
  }
  const h = worldsMod.hansen(5, -0.15);
  let worst = 0;
  const cells = ks.map((k, j) => {
    const p = h.sf2(k);
    const se = Math.sqrt((p * (1 - p)) / total);
    const zs = (hit[j] / total - p) / se;
    worst = Math.max(worst, Math.abs(zs));
    return `k=${k}: ${(hit[j] / total).toFixed(5)} vs ${p.toFixed(5)} (${zs.toFixed(1)} SE)`;
  });
  return { ok: worst < 4.2, note: cells.join("; ") };
}

export function firewall(refMod) {
  const bait = w4Bait({ seed: "w4-firewall", rows: 2000, corr: 0.5, leakFrac: 1 });
  const asOf = "2026-01-02T21:00:00Z";
  const clean = Array.from({ length: 50 }, (_, i) => ({ knownAt: "2026-01-02T20:00:00Z", value: bait.pLeak[i] }));
  const tainted = clean.concat([{ knownAt: "2026-01-03T09:00:00Z", value: bait.pLeak[50] }]);
  let threw = false;
  try { refMod.readAsOf(tainted, asOf); } catch (e) { threw = e instanceof refMod.LookAheadError; }
  const passed = refMod.readAsOf(clean, asOf).length === clean.length;
  return { ok: threw && passed, note: threw ? "a record known after the as-of instant throws" : "a record known after the as-of instant was read without a throw" };
}

export function crpsFair(refMod) {
  const rng = makeRng(`crps|${SCALE.salt}`);
  const target = 1 / Math.sqrt(Math.PI);
  const N = 20000 * SCALE.factor;
  const cells = [];
  let ok = true;
  for (const m of [2, 4, 16]) {
    let s = 0;
    for (let i = 0; i < N; i++) {
      const ens = new Float64Array(m);
      for (let j = 0; j < m; j++) ens[j] = rng.normal();
      s += refMod.crpsEnsemble(ens, rng.normal());
    }
    const v = s / N;
    if (Math.abs(v - target) > 0.012 / Math.sqrt(SCALE.factor)) ok = false;
    cells.push(`m=${m}: ${v.toFixed(4)}`);
  }
  return { ok, note: `${cells.join("  ")} against ${target.toFixed(4)}` };
}

export function pavTies(refMod) {
  const rng = makeRng("pav-ties");
  const levels = [0.02, 0.05, 0.1, 0.2];
  const n = 3000;
  const p = new Float64Array(n), y = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = levels[rng.int(levels.length)];
    p[i] = l;
    y[i] = rng.uniform() < l * (l > 0.1 ? 0.5 : 1.4) ? 1 : 0;
  }
  const fitted = refMod.pavFit(p, y);
  let tiesEqual = true, monotone = true;
  const byLevel = new Map();
  for (let i = 0; i < n; i++) {
    if (!byLevel.has(p[i])) byLevel.set(p[i], fitted[i]);
    else if (byLevel.get(p[i]) !== fitted[i]) tiesEqual = false;
  }
  const order = [...byLevel.keys()].sort((a, b) => a - b);
  for (let i = 1; i < order.length; i++) if (byLevel.get(order[i]) < byLevel.get(order[i - 1]) - 1e-12) monotone = false;
  const meanPreserved = Math.abs(mean(fitted) - mean(y)) < 1e-9;
  return { ok: tiesEqual && monotone && meanPreserved, note: `tied rows ${tiesEqual ? "share" : "do not share"} one fitted value; monotone ${monotone}; mean preserved ${meanPreserved}` };
}

function eProcessRun(refMod, { sessions, names, scale, seed, latentRho }) {
  const w = w7Calibration({ seed, sessions, names, latentRho });
  const f = w.forecast(scale);
  const days = [];
  for (let t = 0; t < sessions; t++) days.push({ p: f.subarray(t * names, (t + 1) * names), y: w.y.subarray(t * names, (t + 1) * names) });
  return refMod.calibrationEProcess(days, { delta: 0.1 });
}

export function eProcessSize(refMod) {
  const reps = 120 * SCALE.factor;
  let crossed = 0;
  for (let i = 0; i < reps; i++) {
    const path = eProcessRun(refMod, { sessions: 300, names: 100, scale: 1, seed: `eproc-size|${SCALE.salt}|${i}`, latentRho: 0.15 });
    let max = 0;
    for (const v of path) if (v > max) max = v;
    if (max >= 20) crossed++;
  }
  const share = crossed / reps;
  return { ok: share <= 0.05, note: `${crossed} of ${reps} calibrated replications cross 20 (${(100 * share).toFixed(1)}%), the bound is 5%` };
}

export function eProcessPower(refMod) {
  const reps = 50 * SCALE.factor;
  let crossed = 0;
  for (let i = 0; i < reps; i++) {
    const path = eProcessRun(refMod, { sessions: 300, names: 100, scale: 0.7, seed: `eproc-power|${SCALE.salt}|${i}`, latentRho: 0.15 });
    let max = 0;
    for (const v of path) if (v > max) max = v;
    if (max >= 20) crossed++;
  }
  const share = crossed / reps;
  return { ok: share >= 0.8, note: `${crossed} of ${reps} replications with a 30% under-forecast cross 20 within 300 sessions (${(100 * share).toFixed(0)}%), the line is 80%` };
}

export function dmSize(refMod) {
  const reps = 400 * SCALE.factor;
  let rej = 0;
  for (let i = 0; i < reps; i++) {
    const w = w8Errors({ seed: `dm|${SCALE.salt}|${i}`, n: 500, h: 5 });
    if (Math.abs(refMod.dmStatistic(w.d, 5)) > 1.96) rej++;
  }
  const rate = rej / reps;
  return { ok: rate <= 0.085, note: `nominal 5% test rejects ${(100 * rate).toFixed(1)}% of equal-accuracy h = 5 replications` };
}

export function runnerRefusesWellSpecified(runnerMod) {
  let refused = false;
  try { runnerMod.accept({ id: "probe", mode: runnerMod.MODES.WELL, pass: true }); } catch (e) { refused = e instanceof runnerMod.NotJudged; }
  const accepted = runnerMod.accept({ id: "probe", mode: runnerMod.MODES.MIS, pass: true }) === true;
  return { ok: refused && accepted, note: refused ? "a well-specified result is refused" : "a well-specified result was accepted" };
}


const GRID = (() => {
  const n = 240, lo = -7, hi = 7, x = [], w = [];
  for (let i = 0; i < n; i++) {
    const u = lo + ((hi - lo) * (i + 0.5)) / n;
    x.push(u);
    w.push((Math.exp((-u * u) / 2) / Math.sqrt(2 * Math.PI)) * ((hi - lo) / n));
  }
  return { x, w };
})();

export function truthSf2(h, k, jumpRate, jumpSd) {
  if (!jumpRate) return h.sf2(k);
  let s = 0;
  for (let i = 0; i < GRID.x.length; i++) s += GRID.w[i] * (1 - h.cdf(k - jumpSd * GRID.x[i]) + h.cdf(-k - jumpSd * GRID.x[i]));
  return (1 - jumpRate) * h.sf2(k) + jumpRate * s;
}

export const TAIL_CELL = Object.freeze({ train: 750, test: 500, ks: Object.freeze([3, 4, 5]), lambda: -0.05, nus: Object.freeze([4, 5, 8]) });

export function tailLawCell(garchMod, { seeds = 4, names = 30, jumpRate = 0, jumpSd = 4, salt = SCALE.salt, clip = true } = {}) {
  const { train, test, ks, lambda, nus } = TAIL_CELL;
  const prod = [], oracle = [];
  const expected = ks.map(() => 0);
  for (let s = 0; s < seeds; s++) {
    const po = ks.map(() => 0), pp = ks.map(() => 0), oo = ks.map(() => 0), op = ks.map(() => 0);
    for (let i = 0; i < names; i++) {
      const nu = nus[i % nus.length];
      const w = w1Garch({ seed: `tail|${salt}|${s}|${i}`, n: train + test, nu, lambda, variance: 1 + (11 * ((i * 7919) % 100)) / 100, jumpRate, jumpSd });
      const closes = closesFromReturns(w.r.subarray(0, train));
      const f = garchMod.fitGarch(closes, businessDays(closes.length));
      if (f.status !== "ok") continue;
      const fitted = hansen(f.nu, f.lambda), truth = hansen(nu, lambda);
      const predFit = ks.map((k) => fitted.sf2(k)), predTrue = ks.map((k) => truthSf2(truth, k, jumpRate, jumpSd));
      const cap2 = f.cap * f.cap;
      let v = (f.longRunVol * f.longRunVol) / 252;
      for (let t = 0; t < train + test; t++) {
        const e = w.r[t] - f.mean;
        if (t >= train) {
          for (let j = 0; j < ks.length; j++) {
            if (Math.abs(e) > ks[j] * Math.sqrt(v)) po[j]++;
            pp[j] += predFit[j];
            if (Math.abs(w.r[t]) > ks[j] * w.sigma[t]) oo[j]++;
            op[j] += predTrue[j];
          }
        }
        v = f.omega + f.alpha * (clip ? Math.min(e * e, cap2) : e * e) + f.beta * v;
      }
    }
    prod.push(ks.map((_, j) => po[j] / pp[j]));
    oracle.push(ks.map((_, j) => oo[j] / op[j]));
    ks.forEach((_, j) => { expected[j] += op[j]; });
  }
  const rng = makeRng(`tail-band|${salt}`);
  const draws = 4000;
  const band = (events) => {
    const out = [];
    for (let b = 0; b < draws; b++) out.push(rng.poisson(events) / events);
    return [quantile(out, 0.01), quantile(out, 0.99)];
  };
  const pooledBand = expected.map((e) => band(e));
  const seedBand = expected.map((e) => band(e / seeds));
  const pool = (rows) => ks.map((_, j) => mean(rows.map((r) => r[j])));
  return { ks, seeds, prod, oracle, pooledProd: pool(prod), pooledOracle: pool(oracle), pooledBand, seedBand, expected };
}

export function oiLag(refMod) {
  const w = w5OiLag({ seed: `w5|${SCALE.salt}`, days: 400, names: 150 });
  const diffs = [];
  for (let i = 0; i < w.names; i++) {
    const recs = refMod.oiRecords(w.dates, w.oi, w.names, i);
    for (let d = 2; d < w.days; d++) {
      const asOf = refMod.sessionClose(w.dates[d]);
      const rec = refMod.latestKnown(recs.slice(Math.max(0, d - 2), d + 1), asOf);
      const y = w.y[d * w.names + i];
      const pPipe = w.forecast(d - rec.describes, rec.value);
      const pTrue = w.forecast(1, w.oi[(d - 1) * w.names + i]);
      diffs.push(logScore(pPipe, y) - logScore(pTrue, y));
    }
  }
  const b = leakBound(diffs);
  return { ok: !b.fires, note: `forecast from the open interest the as-of reader returns scores ${b.mu.toExponential(2)} against the lag-correct truth (${b.z.toFixed(1)} SE)`, bound: b };
}

export function afterHours(refMod) {
  const rows = 60000;
  const bait = w4Bait({ seed: `w4-after-hours|${SCALE.salt}`, rows, corr: 0.6, leakFrac: 0.5 });
  const day = "2026-03-02";
  const diffs = [];
  for (let i = 0; i < rows; i++) {
    const row = { knownAt: bait.leaked[i] ? `${day}T22:30:00Z` : `${day}T15:00:00Z`, value: bait.pLeak[i] };
    const view = refMod.issueView([row], day);
    const p = view.length ? view[0] : bait.pStar;
    diffs.push(logScore(p, bait.y[i]) - logScore(bait.pStar, bait.y[i]));
  }
  const b = leakBound(diffs);
  return { ok: !b.fires, note: `a feature known 90 minutes after the close ${b.fires ? "reaches" : "does not reach"} the forecast issued at the close (${b.z.toFixed(1)} SE)`, bound: b };
}

export function trialCount(refMod) {
  const reps = 150 * SCALE.factor;
  let passed = 0;
  for (let i = 0; i < reps; i++) {
    const w = w6Null({ seed: `w6|${SCALE.salt}|${i}`, trials: 100, periods: 250 });
    const registry = new refMod.TrialRegistry();
    registry.register(w.trials);
    if (refMod.selectAndTest(w.returns, registry).dsr > 0.95) passed++;
  }
  const rate = passed / reps;
  return { ok: rate <= 0.08, note: `the best of 100 null strategies clears a deflated Sharpe of 0.95 in ${(100 * rate).toFixed(1)}% of ${reps} runs`, rate };
}

export const HAWKES = Object.freeze({ mu: 0.5, beta: 1, branching: 0.6 });

export function hawkesCompensator(refMod) {
  const sessions = 30 * SCALE.factor;
  const res = [];
  for (let s = 0; s < sessions; s++) {
    const w = w3Hawkes({ seed: `w3|${SCALE.salt}|${s}`, ...HAWKES });
    for (const v of refMod.hawkesResiduals(w.times, w.marks, HAWKES)) res.push(v);
  }
  const m = mean(res), v = variance(res);
  const u = res.map((x) => 1 - Math.exp(-x));
  const ks = ksUniform(u);
  const bound = 2.2 / Math.sqrt(res.length);
  const ok = Math.abs(m - 1) < 0.05 && Math.abs(v - 1) < 0.1 && ks < bound;
  return { ok, note: `compensator increments: mean ${m.toFixed(3)}, variance ${v.toFixed(3)}, KS ${ks.toFixed(4)} against ${bound.toFixed(4)} (${res.length} events)` };
}

export function flowNullDayEffect(refMod) {
  const sessions = 200 * SCALE.factor;
  const p = { lambda: 20000 / 390 / 3, r: 2, sdDay: 0.25 };
  const line = refMod.alertLine();
  const w = w3bSession({ seed: `w3b|${SCALE.salt}`, names: sessions, sdDay: p.sdDay, lambda: p.lambda, dispersion: p.r });
  let cross = 0, over20 = 0;
  for (const nm of w.names) {
    const k = refMod.alertTier(nm.counts, p);
    let mx = 0;
    for (const v of k) if (v > mx) mx = v;
    if (mx >= line) cross++;
    if (mx >= 20) over20++;
  }
  const rate = cross / sessions, r20 = over20 / sessions;
  return { ok: rate <= 0.02 && r20 <= 0.07, note: `at a day effect of 0.25, ${(100 * rate).toFixed(1)}% of ordinary names cross the Alert line and ${(100 * r20).toFixed(1)}% reach E = 20 (${sessions} names)`, rate, r20 };
}

const sessionCache = new Map();

export function w9Sessions(opts, from, to) {
  const key = JSON.stringify(opts);
  if (!sessionCache.has(key)) sessionCache.set(key, { world: w9World(opts), sessions: new Map() });
  const entry = sessionCache.get(key);
  const out = [];
  for (let d = from; d < to; d++) {
    if (!entry.sessions.has(d)) entry.sessions.set(d, entry.world.session(d));
    out.push(entry.sessions.get(d));
  }
  return { world: entry.world, sessions: out };
}

export const JUMP_NULL_WORLD = Object.freeze({ names: 150, sessions: 40, seed: "w9-jump-null", innovation: "t", scaleError: 0.2 });

export function jumpFlagNull(refMod) {
  const f = SCALE.factor;
  const opts = { ...JUMP_NULL_WORLD, sessions: 40 * f, seed: `${JUMP_NULL_WORLD.seed}|${SCALE.salt}` };
  const cal = w9Sessions(opts, 0, 20 * f);
  const placebo = [[], [], []];
  for (const s of cal.sessions) for (let i = 0; i < s.names; i++) placebo[cal.world.names[i].bucket].push(refMod.standardisedMax(s, i));
  const lines = refMod.jumpLines(placebo);
  const test = w9Sessions(opts, 20 * f, 40 * f);
  let flagged = 0, total = 0;
  const bySigma = [[0, 0], [0, 0], [0, 0]];
  for (const s of test.sessions) {
    const flags = refMod.flagJumps(s, lines, (i) => cal.world.names[i].bucket);
    const order = Array.from(s.sigmaForecast, (v, i) => i).sort((a, b) => s.sigmaForecast[a] - s.sigmaForecast[b]);
    order.forEach((i, rank) => {
      const tercile = Math.min(2, Math.floor((3 * rank) / order.length));
      bySigma[tercile][0] += flags[i];
      bySigma[tercile][1] += 1;
      flagged += flags[i];
      total += 1;
    });
  }
  const rates = bySigma.map(([k, n]) => k / n);
  const spread = Math.max(...rates) / Math.max(1 / (3 * total), Math.min(...rates));
  const share = flagged / total;
  return { ok: share <= 0.03 && spread <= 3, note: `${(100 * share).toFixed(1)}% of ordinary name-days flagged (nominal 1%), highest to lowest volatility tercile ${spread.toFixed(1)}x (${rates.map((r) => (100 * r).toFixed(1) + "%").join(", ")})`, share, spread, lines };
}

export function bhCompleteNull(refMod, fixture = FIXTURES.multiplicity) {
  const reps = 600 * SCALE.factor;
  const rng = makeRng(`bh-null|${SCALE.salt}`);
  let any = 0;
  for (let r = 0; r < reps; r++) {
    const p = new Float64Array(fixture.m);
    for (let i = 0; i < p.length; i++) p[i] = rng.uniform();
    if (refMod.bhReject(p, fixture.alpha).length > 0) any++;
  }
  const rate = any / reps;
  const se = Math.sqrt((fixture.bhCompleteNull * (1 - fixture.bhCompleteNull)) / reps);
  return { ok: Math.abs(rate - fixture.bhCompleteNull) <= 4 * se, note: `BH at ${fixture.alpha} on ${fixture.m} true nulls rejects something in ${(100 * rate).toFixed(1)}% of ${reps} runs (exact ${(100 * fixture.bhCompleteNull).toFixed(2)}%)` };
}

export function byCompleteNull(refMod, fixture = FIXTURES.multiplicity) {
  const reps = 600 * SCALE.factor;
  const rng = makeRng(`by-null|${SCALE.salt}`);
  let any = 0;
  for (let r = 0; r < reps; r++) {
    const p = new Float64Array(fixture.m);
    for (let i = 0; i < p.length; i++) p[i] = rng.uniform();
    if (refMod.byReject(p, fixture.alpha).length > 0) any++;
  }
  const rate = any / reps;
  const se = Math.sqrt((fixture.byCompleteNull * (1 - fixture.byCompleteNull)) / reps);
  return { ok: Math.abs(rate - fixture.byCompleteNull) <= 4 * se + 0.003, note: `BY at ${fixture.alpha} on ${fixture.m} true nulls rejects something in ${(100 * rate).toFixed(1)}% of ${reps} runs (exact ${(100 * fixture.byCompleteNull).toFixed(2)}%)` };
}

export const SESSION_FDR_WORLD = Object.freeze({ names: 200, sessions: 100, seed: "w9-session-fdr", innovation: "gaussian", marketRho: 0, sectorRho: 0, seasonalError: 0, scaleError: 0 });

export function runningPFrames(s, frameEvery = 5, minutesFixed = 390) {
  const frames = [];
  const best = new Float64Array(s.names), walk = new Float64Array(s.names);
  for (let b = 0; b < s.bars; b++) {
    for (let i = 0; i < s.names; i++) {
      const z = s.inc[i * s.bars + b] / (s.sigmaForecast[i] * Math.sqrt(s.clockForecast[b]));
      walk[i] += z;
      if (Math.abs(z) > best[i]) best[i] = Math.abs(z);
    }
    if ((b + 1) % frameEvery === 0) {
      frames.push({
        running: Float64Array.from(best, (l) => 1 - Math.pow(2 * normalCdf(l) - 1, minutesFixed)),
        snapshot: Float64Array.from(walk, (w) => 2 * normalCdf(-Math.abs(w) / Math.sqrt(b + 1))),
      });
    }
  }
  return frames;
}

export function sessionFdr(refMod) {
  const sessions = 100 * SCALE.factor;
  const alpha = 0.1;
  const { sessions: list } = w9Sessions({ ...SESSION_FDR_WORLD, sessions, seed: `${SESSION_FDR_WORLD.seed}|${SCALE.salt}` }, 0, sessions);
  let any = 0;
  for (const s of list) if (refMod.sessionAlerts(runningPFrames(s), alpha).length > 0) any++;
  const share = any / sessions;
  return { ok: share <= alpha, note: `on sessions with nothing to find, ${(100 * share).toFixed(0)}% raise at least one alert (stated 10%)`, share };
}

const E_LINE = 200;

function eProcessCell(refMod, worldOpts, params) {
  const f = SCALE.factor;
  const sessions = 6 * f;
  const { sessions: list } = w9Sessions({ names: 300, sessions, innovation: "t", marketRho: 0, sectorRho: 0, seasonalError: 0, ...worldOpts }, 0, sessions);
  let cross = 0, total = 0;
  for (const s of list) for (let i = 0; i < s.names; i++) { if (refMod.eProcessMax(s, i, params) >= E_LINE) cross++; total++; }
  return { cross, total, rate: cross / total };
}

export function eProcessRepair(refMod) {
  const r = eProcessCell(refMod, { nuRange: [4, 4], scaleError: 0, seed: `w9-eproc-t|${SCALE.salt}` }, { nuHat: 4, sHat: 0, c: 0 });
  return { ok: r.rate <= 0.005, note: `on Student t increments with 4 degrees of freedom, ${(100 * r.rate).toFixed(2)}% of ordinary name-days reach E = ${E_LINE} (Ville allows 0.5%; ${r.cross} of ${r.total})`, rate: r.rate };
}

export function eProcessInflation(refMod) {
  const r = eProcessCell(refMod, { nuRange: [5, 5], scaleError: 0.3, seed: `w9-eproc-s|${SCALE.salt}` }, { nuHat: 5, sHat: 0.3, c: 2 });
  return { ok: r.rate <= 0.005, note: `with a scale error of 0.3, ${(100 * r.rate).toFixed(2)}% of ordinary name-days reach E = ${E_LINE} (Ville allows 0.5%; ${r.cross} of ${r.total})`, rate: r.rate };
}

function goldenMin(f, lo, hi, iters = 60) {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < iters; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

export function pooledShape(world, q = 0.925) {
  const ys = [];
  for (let i = 0; i < world.names; i++) {
    const abs = Float64Array.from(world.r.subarray(i * world.days, (i + 1) * world.days), Math.abs).sort();
    const u = abs[Math.floor(q * (abs.length - 1))];
    ys.push(Float64Array.from(abs.filter((v) => v > u), (v) => v - u));
  }
  const means = ys.map((y) => mean(y));
  const nll = (xi) => {
    if (xi <= 1e-4 || xi >= 0.99) return 1e12;
    let s = 0;
    ys.forEach((y, i) => {
      const be = means[i] * (1 - xi);
      s += y.length * Math.log(be);
      let acc = 0;
      for (let k = 0; k < y.length; k++) acc += Math.log1p((xi * y[k]) / be);
      s += (1 + 1 / xi) * acc;
    });
    return s;
  };
  const xi = goldenMin(nll, 0.01, 0.95);
  const h = 1e-3;
  const d2 = (nll(xi + h) - 2 * nll(xi) + nll(xi - h)) / (h * h);
  return { xi, se: d2 > 0 ? 1 / Math.sqrt(d2) : NaN, n: ys.reduce((a, y) => a + y.length, 0) };
}

export function pooledShapeCoverage(worldsMod, { rho, reps, nu = 5, names = 60, days = 500, salt = SCALE.salt }) {
  const xis = [], ses = [];
  for (let r = 0; r < reps; r++) {
    const w = worldsMod.w1dWorld({ seed: `w1d|${salt}|${rho}|${r}`, names, days, nu, rho });
    const fit = pooledShape(w);
    xis.push(fit.xi);
    ses.push(fit.se);
  }
  const sdXi = Math.sqrt(variance(xis)), seMean = mean(ses.filter(Number.isFinite));
  return { sdXi, seMean, ratio: sdXi / seMean, coverage: 2 * normalCdf((1.645 * seMean) / sdXi) - 1, reps };
}

export function dependentWorldCoverage(worldsMod) {
  const c = pooledShapeCoverage(worldsMod, { rho: 0.3, reps: 120 * SCALE.factor });
  return { ok: c.coverage <= 0.7, note: `a nominal 90% interval for the pooled shape covers ${(100 * c.coverage).toFixed(0)}% of runs on the dependent daily world (SD over model SE ${c.ratio.toFixed(2)})`, measured: c };
}

export function jumpFlagTransfer(refMod, { lines, world }) {
  const f = SCALE.factor;
  const test = w9Sessions({ ...world, sessions: 20 * f, seed: `${world.seed}|${SCALE.salt}` }, 0, 20 * f);
  let flagged = 0, total = 0;
  for (const s of test.sessions) {
    const flags = refMod.flagJumps(s, lines, (i) => test.world.names[i].bucket);
    for (let i = 0; i < s.names; i++) { flagged += flags[i]; total += 1; }
  }
  return { share: flagged / total, total };
}
