import { makeRng } from "./rng.mjs";
import { hansen, w1Closes, w1Garch, closesFromReturns, businessDays, w4Bait, w7Calibration, w8Errors } from "./worlds.mjs";
import { mean, median, quantile } from "./stats.mjs";

export const W1_BANDS = Object.freeze({
  nu: [5.2, 5.8],
  persistence: [0.955, 0.978],
  tailRatio: [0.75, 0.95],
});

export const SCALE = (() => {
  const deep = process.env.FLOWS_TRUTH_DEEP === "1";
  return { deep, factor: deep ? 10 : 1, salt: process.env.FLOWS_TRUTH_SALT || (deep ? String(Date.now()) : "fixed") };
})();

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
