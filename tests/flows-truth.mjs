import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as garch from "../shared/flows-garch.js";
import { makeRng, seedWords, normalQuantile, normalSurvival, normalCdf } from "./truth/rng.mjs";
import { hansen, w1Garch, w1dWorld, w1Independent, w3Hawkes, w3bSession, w4Bait, w5OiLag, w6Null, w7Calibration, indicatorCorrelation, w8Overlap, w8Errors, nextBusinessDay, probitMean, WORLDS } from "./truth/worlds.mjs";
import { mean, variance, sd, autocorrelation, ksUniform } from "./truth/stats.mjs";
import { MODES, NotJudged, NoJudgementList, cell, accept, judge, formatRow } from "./truth/runner.mjs";
import { MUTANTS, LAUNCH_MUTANTS, PLANTED_WRONG_DETECTORS, runKillMatrix, loadMutated, baselineResult } from "./truth/mutants.mjs";
import * as reference from "./truth/reference.mjs";
import { w9World, w9OutOfFamily, W9_WORLDS, W9_OUT_OF_FAMILY, FOMC_MINUTE, clockShape } from "./truth/intraday.mjs";
import { SCALE, W1_BANDS, HAWKES, measureW1Bands, tailLawCell, logScore, leakBound, oiLag, trialCount, hawkesCompensator, flowNullDayEffect, JUMP_NULL_WORLD, jumpFlagNull, jumpFlagTransfer, pooledShapeCoverage, bhCompleteNull, byCompleteNull, sessionFdr, eProcessRepair, eProcessInflation } from "./truth/detectors.mjs";
import * as worldsModule from "./truth/worlds.mjs";
import { createMarketSim } from "./rt-market-sim.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(path.join(HERE, "fixtures-truth.json"), "utf8"));

let n = 0;
const flags = [];
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); n++; };
const rel = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${m}: ${a} vs ${b} (relative tol ${tol})`); n++; };
const log = (line) => console.log("  " + line);

const TIMING = process.env.FLOWS_TRUTH_TIMING === "1";

async function section(name, fn) {
  const before = n;
  const t0 = Date.now();
  try {
    await fn();
    if (TIMING) console.log(`  [${name}: ${Date.now() - t0} ms]`);
  } catch (e) {
    if (!SCALE.deep) throw e;
    flags.push(`${name}: ${e.message.split("\n")[0]}`);
    console.log(`FLAG ${name}: ${e.message.split("\n")[0]}`);
    n = before;
  }
}

await section("fixtures", () => {
  const script = readFileSync(path.join(HERE, "gen-truth-fixtures.py"));
  eq(fixtures.provenance.generatorSha256, createHash("sha256").update(script).digest("hex"),
    "fixtures-truth.json was written by the current gen-truth-fixtures.py (rerun it after any change to the script)");
  ok(fixtures.provenance.scipy && fixtures.provenance.numpy, "the fixture records the versions that wrote it");
});

await section("rng", () => {
  for (const [seed, ref] of Object.entries(fixtures.rng)) {
    const words = makeRng(seed);
    eq(Array.from({ length: ref.words.length }, () => words.next()), ref.words, `${seed}: the sfc32 words equal the independent Python implementation`);
    const u = makeRng(seed);
    eq(Array.from({ length: ref.uniforms.length }, () => u.uniform()), ref.uniforms, `${seed}: the uniforms equal it exactly`);
  }
  eq(seedWords("selftest|a").length, 4, "a seed expands to four 32-bit words");
  const a = makeRng("same"), b = makeRng("same"), c = makeRng("other");
  eq([a.next(), a.next()], [b.next(), b.next()], "one seed, one stream");
  ok(a.next() !== c.next() || a.next() !== c.next(), "two seeds, two streams");
  const r = makeRng("moments");
  const N = 400000;
  let s = 0, q = 0, g = 0, t = 0, pz = 0, pb = 0, nb = 0;
  for (let i = 0; i < N; i++) {
    const x = r.normal(); s += x; q += x * x;
    g += r.gamma(2.5);
    const u = r.studentUnit(5); t += u * u;
    pz += r.poisson(3); pb += r.poisson(120);
    nb += r.negBin(40, 8);
  }
  near(s / N, 0, 4 / Math.sqrt(N), "normal mean");
  near(q / N, 1, 4 * Math.sqrt(2 / N), "normal variance");
  near(g / N, 2.5, 4 * Math.sqrt(2.5 / N), "gamma(2.5) mean");
  near(t / N, 1, 0.03, "the unit Student t has unit variance");
  near(pz / N, 3, 4 * Math.sqrt(3 / N), "poisson(3) mean");
  near(pb / N, 120, 4 * Math.sqrt(120 / N), "poisson(120) mean through the rejection branch");
  near(nb / N, 40, 4 * Math.sqrt((40 + 40 * 40 / 8) / N), "negative binomial mean");
  for (const { p, q: ref } of fixtures.normal.quantiles) rel(normalQuantile(p), ref, 1e-8, `normal quantile at ${p}`);
  for (const { x, sf } of fixtures.normal.survival) rel(normalSurvival(x), sf, 1e-10, `normal survival at ${x}`);
  near(normalCdf(0), 0.5, 1e-15, "normal cdf at zero");
});

await section("hansen", () => {
  for (const row of fixtures.hansen) {
    const h = hansen(row.nu, row.lambda);
    rel(h.a, row.a, 1e-12, `a(${row.nu}, ${row.lambda})`);
    rel(h.b, row.b, 1e-12, `b(${row.nu}, ${row.lambda})`);
    rel(h.c, row.c, 1e-12, `c(${row.nu}, ${row.lambda})`);
    near(row.mass, 1, 1e-9, `the density of (${row.nu}, ${row.lambda}) integrates to one`);
    row.ks.forEach((k, i) => rel(h.sf2(k), row.sf2[i], 1e-9, `two-sided tail of (${row.nu}, ${row.lambda}) at ${k}`));
  }
  const h = hansen(5, -0.15);
  const rng = makeRng("hansen-mc");
  const N = 1000000;
  const ks = [2, 3, 4];
  const hit = ks.map(() => 0);
  let m1 = 0, m2 = 0;
  for (let i = 0; i < N; i++) {
    const z = h.draw(rng);
    m1 += z; m2 += z * z;
    ks.forEach((k, j) => { if (Math.abs(z) > k) hit[j]++; });
  }
  near(m1 / N, 0, 4 * Math.sqrt(1 / N), "the sampler has zero mean");
  near(m2 / N, 1, 0.03, "and unit variance");
  ks.forEach((k, j) => {
    const p = h.sf2(k);
    near(hit[j] / N, p, 4 * Math.sqrt((p * (1 - p)) / N), `the sampler's exceedance at ${k} sd matches the analytic tail`);
  });
});

let baseBands = null;
await section("w1-bands", async () => {
  baseBands = (await baselineResult("garchRecovery", "shared/flows-garch.js")).measured;
  log(`W1 at N 750, nu 5: median nu-hat ${baseBands.nu.toFixed(2)}, persistence ${baseBands.persistence.toFixed(3)}, fitted over true 3-SD tail probability ${baseBands.tailRatio.toFixed(3)} (${baseBands.n} fits, ${baseBands.failed} failed)`);
  ok(baseBands.failed === 0, "every W1 path fits");
  ok(baseBands.nu >= W1_BANDS.nu[0] && baseBands.nu <= W1_BANDS.nu[1], `median nu-hat ${baseBands.nu} lies in [${W1_BANDS.nu}]`);
  ok(baseBands.persistence >= W1_BANDS.persistence[0] && baseBands.persistence <= W1_BANDS.persistence[1], `median persistence ${baseBands.persistence} lies in [${W1_BANDS.persistence}]`);
  ok(baseBands.tailRatio >= W1_BANDS.tailRatio[0] && baseBands.tailRatio <= W1_BANDS.tailRatio[1], `median fitted over true tail probability ${baseBands.tailRatio} lies in [${W1_BANDS.tailRatio}]`);
  const k10 = await loadMutated("shared/flows-garch.js", [["export const GARCH_WINSOR_K = 6;", "export const GARCH_WINSOR_K = 10;"]]);
  const moved = measureW1Bands(k10, { reps: 120 * SCALE.factor });
  log(`winsorising K 6 to 10 moves the tail ratio ${baseBands.tailRatio.toFixed(3)} to ${moved.tailRatio.toFixed(3)} (up) and nu-hat ${baseBands.nu.toFixed(2)} to ${moved.nu.toFixed(2)}`);
  ok(moved.tailRatio > baseBands.tailRatio + 0.02, "raising the winsorising limit from 6 to 10 moves the tail ratio up, as the band table records");
});

await section("w1-judgement", () => {
  const salt = SCALE.salt;
  const k4 = 1, k5 = 2;
  const clean = tailLawCell(garch, { seeds: 4 * SCALE.factor, names: 30, jumpRate: 0, salt });
  const contaminated = tailLawCell(garch, { seeds: 4 * SCALE.factor, names: 30, jumpRate: 3 / 252, salt });
  const fmt = (c) => c.ks.map((k, j) => `k=${k}: production ${c.pooledProd[j].toFixed(2)} oracle ${c.pooledOracle[j].toFixed(2)} band ${c.pooledBand[j][0].toFixed(2)}-${c.pooledBand[j][1].toFixed(2)}`).join("; ");
  log("W1 clean, pooled: " + fmt(clean));
  log("W1 with jumps (out of the calibration family), pooled: " + fmt(contaminated));
  const cells = [
    cell({ id: "w1-clean-production", world: "W1", mode: MODES.WELL, run: () => ({ pass: false, note: "production's own bias, reported and never judged" }) }),
    cell({
      id: "w1-jumps-oracle", world: "W1", mode: MODES.MIS, outOfFamily: true,
      run: () => ({ pass: [k4, k5].every((j) => contaminated.pooledOracle[j] >= contaminated.pooledBand[j][0] && contaminated.pooledOracle[j] <= contaminated.pooledBand[j][1]), note: "the oracle with the true sigma and the true mixture lies in its band" }),
    }),
    cell({
      id: "w1-jumps-production-clip-in-filter", world: "W1", mode: MODES.MIS, outOfFamily: true,
      run: () => ({ pass: [k4, k5].every((j) => contaminated.prod.every((row) => row[j] <= contaminated.seedBand[j][1])), note: "production, per seed" }),
    }),
  ];
  const verdict = judge(cells);
  verdict.rows.forEach((r) => log(formatRow(r)));
  eq(verdict.rows.find((r) => r.id === "w1-jumps-oracle").accepted, true, "the measurement can accept: the oracle lies in its band");
  eq(verdict.rows.find((r) => r.id === "w1-jumps-production-clip-in-filter").accepted, false,
    "today's GARCH with the clip in the filter lies outside the W1 band at k = 4 and 5 on every seed");
  eq(verdict.rows.find((r) => r.id === "w1-clean-production").accepted, null, "the well-specified cell is a reference and judges nothing");
  for (const j of [k4, k5]) {
    ok(contaminated.prod.every((row) => row[j] > contaminated.seedBand[j][1]), `every seed's production ratio at k = ${contaminated.ks[j]} is above the oracle's 99th percentile`);
    ok(contaminated.pooledProd[j] > contaminated.pooledBand[j][1], `the pooled production ratio at k = ${contaminated.ks[j]} is above the pooled oracle band, clean world and jump world alike`);
    ok(clean.pooledProd[j] > clean.pooledBand[j][1], `in the clean W1 world too, pooled, at k = ${clean.ks[j]}`);
    ok(clean.pooledOracle[j] >= clean.pooledBand[j][0] && clean.pooledOracle[j] <= clean.pooledBand[j][1], "and the clean oracle lies in its band");
  }
});

await section("w4", () => {
  const cells = [
    { corr: 0.243, frac: 1, mustCatch: true },
    { corr: 0.447, frac: 0.1, mustCatch: true },
    { corr: 0.447, frac: 0.01, mustCatch: false },
  ];
  const pStar = fixtures.bait.pStar;
  rel(pStar, 2 * normalSurvival(2), 1e-12, "the base rate of a two-sigma event");
  const log1 = (p, y) => -Math.log(Math.min(1 - 1e-4, Math.max(1e-4, y ? p : 1 - p)));
  for (const c of cells) {
    const bait = w4Bait({ seed: `w4|${c.corr}|${c.frac}|${SCALE.salt}`, rows: 100000, corr: c.corr, leakFrac: c.frac });
    const ref = fixtures.bait.cells.find((x) => x.corr === c.corr);
    let sum = 0, sq = 0;
    for (let i = 0; i < bait.rows; i++) {
      const d = log1(bait.pLeak[i], bait.y[i]) - log1(bait.pStar, bait.y[i]);
      sum += d; sq += d * d;
    }
    const mu = sum / bait.rows, sd = Math.sqrt(sq / bait.rows - mu * mu);
    const exact = ref.meanDLog * c.frac;
    near(mu, exact, 4.5 * sd / Math.sqrt(bait.rows), `corr ${c.corr}, ${c.frac * 100}% of rows: the sampled mean score difference equals the exact quadrature value`);
    const power = normalCdf((Math.sqrt(bait.rows) * Math.abs(exact)) / sd - 4);
    log(`leak on ${c.frac * 100}% of 100,000 rows at correlation ${c.corr}: exact mean log-score difference ${exact.toExponential(2)}, power of the 4 SE bound ${power.toFixed(2)}`);
    if (c.mustCatch) ok(power >= 0.9, `a leak of correlation ${c.corr} on ${c.frac * 100}% of rows is caught with at least 90% power`);
    else ok(power < 0.9, "a 1% leak is not reliably caught by the oracle bound, which is why the firewall throws");
  }
  const clean = w4Bait({ seed: "w4-clean", rows: 100000, corr: 0.9, leakFrac: 0 });
  let d = 0;
  for (let i = 0; i < clean.rows; i++) d += log1(clean.pLeak[i], clean.y[i]) - log1(clean.pStar, clean.y[i]);
  eq(d, 0, "a forecaster with no leaked rows scores exactly the truth");
  const bait = w4Bait({ seed: "w4-throw", rows: 4000, corr: 0.894, leakFrac: 1 });
  const asOf = "2026-03-02T21:00:00Z";
  const rows = Array.from({ length: bait.rows }, (_, i) => ({ knownAt: "2026-03-03T09:30:00Z", value: bait.pLeak[i] }));
  let threw = false;
  try { reference.readAsOf(rows, asOf); } catch (e) { threw = e instanceof reference.LookAheadError; }
  ok(threw, "with the firewall's throw in place the bait never reaches a forecaster");
  return loadMutated("tests/truth/reference.mjs", [["throw new LookAheadError(`record known at ${row.knownAt} read as of ${asOf}`);", "void 0;"]]).then((open) => {
    const leaked = open.readAsOf(rows, asOf);
    let sum = 0, sq = 0;
    for (let i = 0; i < leaked.length; i++) {
      const dd = log1(leaked[i], bait.y[i]) - log1(bait.pStar, bait.y[i]);
      sum += dd; sq += dd * dd;
    }
    const mu = sum / leaked.length, se = Math.sqrt(sq / leaked.length - mu * mu) / Math.sqrt(leaked.length);
    ok(mu < -4 * se, `with the throw removed the bait beats the truth (${(mu / se).toFixed(1)} SE) and the oracle bound fires`);
  });
});

await section("w7", () => {
  const rhoFx = fixtures.w7.find((r) => r.latentRho === 0.12);
  const flat = w7Calibration({ seed: "w7-flat", sessions: 4000, names: 100, pEvent: 0.05, latentRho: 0.12, spread: 0 });
  near(indicatorCorrelation(flat), rhoFx.indicatorCorrelation, 0.006, "the indicator correlation of the calibration world equals the bivariate-normal value");
  log(`W7 latent correlation 0.12 gives an indicator correlation of ${indicatorCorrelation(flat).toFixed(4)} (exact ${rhoFx.indicatorCorrelation.toFixed(4)})`);
  const w = w7Calibration({ seed: "w7-main", sessions: 3000, names: 200, pEvent: 0.05, latentRho: 0.12 });
  const rho = indicatorCorrelation(w);
  ok(rho > 0.015 && rho < 0.05, `the indicator correlation of the monitoring worlds lies in 0.02-0.05 (${rho.toFixed(4)})`);
  const exact = fixtures.w7.find((r) => r.latentRho === 0.05).indicatorCorrelation;
  const flat05 = w7Calibration({ seed: "w7-w3", sessions: 4000, names: 100, pEvent: 0.05, latentRho: 0.05, spread: 0 });
  near(indicatorCorrelation(flat05), exact, 0.006, "the latent 0.05 world matches its exact indicator correlation");
  const f1 = w.forecast(1), f07 = w.forecast(0.7);
  let y = 0, a = 0, b = 0;
  const perSession = new Float64Array(w.sessions);
  for (let t = 0; t < w.sessions; t++) for (let i = 0; i < w.names; i++) {
    const k = t * w.names + i;
    y += w.y[k]; a += f1[k]; b += f07[k];
    perSession[t] += (w.y[k] - f1[k]) / w.names;
  }
  const se = Math.sqrt(variance(perSession) / w.sessions);
  ok(Math.abs(mean(perSession)) < 4 * se, "calibrated forecasts have a session-mean residual of zero within four clustered standard errors");
  near(y / b, 1 / 0.7, 0.05, "the 30% under-forecast world is short by the factor 1/0.7 in the mean");
  near(y / a, 1, 0.04, "and the calibrated one by 1");
});

await section("w8", () => {
  const w = w8Overlap({ seed: "w8-main", n: 20000, h: 5 });
  const ksD = ksUniform(w.pit);
  ok(ksD < 3 / Math.sqrt(w.n / 5), `the overlapping PIT is uniform (KS ${ksD.toFixed(4)})`);
  for (let j = 1; j <= 7; j++) {
    const th = w.acfTheory(j);
    near(autocorrelation(w.z, j), th, 0.06, `the lag-${j} autocorrelation of the PIT scores is ${th.toFixed(2)}`);
  }
  const fx = fixtures.dm.find((r) => r.h === 5);
  let rej = 0;
  const reps = 600;
  for (let i = 0; i < reps; i++) {
    const e = w8Errors({ seed: `w8-dm|${i}`, n: 500, h: 5 });
    const mu = mean(e.d), v = variance(e.d);
    if (Math.abs(mu) / Math.sqrt(v / e.n) > 1.96) rej++;
  }
  near(rej / reps, fx.naiveRejection, 4 * Math.sqrt((fx.naiveRejection * (1 - fx.naiveRejection)) / reps), "a test that ignores the overlap rejects at the rate the Bartlett variance factor predicts");
  log(`h = 5 overlap: the naive 5% test rejects ${(100 * rej / reps).toFixed(1)}% (predicted ${(100 * fx.naiveRejection).toFixed(1)}%)`);
});

await section("w5", async () => {
  eq(nextBusinessDay("2026-03-06"), "2026-03-09", "open interest published on a Friday is next published on the Monday");
  eq(nextBusinessDay("2026-03-03"), "2026-03-04", "and on a Tuesday the next morning");
  eq(reference.oiPublishedAt("2026-03-06"), "2026-03-09T10:30:00Z", "the publication stamp is the next business morning");
  const fx = fixtures.probit;
  const w = w5OiLag({ seed: "w5-main", days: 600, names: 100 });
  eq([w.slope, w.noise, w.rho, w.base], [fx.slope, fx.noise, fx.rho, fx.base], "the world runs at the parameters of the reference table");
  near(w.c, fx.c, 1e-12, "the probit intercept");
  for (const r of fx.rows) rel(w.forecast(r.lag, r.oi), r.p, 1e-7, `the posterior forecast at open interest ${r.oi}, lag ${r.lag} equals the quadrature value`);
  let a = 0, b = 0, q = 0, base = 0, voi = 0;
  const m = 100 * 600;
  for (let i = 0; i < 100; i++) for (let d = 1; d < 600; d++) {
    const x1 = w.x[(d - 1) * 100 + i], x2 = w.x[d * 100 + i];
    a += x1 * x2; b += x1 * x1; q += x2 * x2;
  }
  near(a / Math.sqrt(b * q), w.rho, 0.03, "the latent state has the lag-1 autocorrelation of the world");
  for (let k = 0; k < m; k++) { base += w.y[k]; voi += w.oi[k] * w.oi[k]; }
  near(base / m, w.base, 4 * Math.sqrt((w.base * (1 - w.base)) / m), "the event base rate");
  near(voi / m, 1 + w.noise * w.noise, 0.04, "open interest is the state plus noise");
  let d1 = 0, d0 = 0, n1 = 0;
  const diffsLeak = [];
  let res1 = 0, res0 = 0;
  const recs = reference.oiRecords(w.dates, w.oi, w.names, 0);
  for (let i = 0; i < 100; i++) for (let d = 2; d < 600; d++) {
    const y = w.y[d * 100 + i];
    const pLag = w.forecast(1, w.oi[(d - 1) * 100 + i]);
    const pLeak = w.forecast(0, w.oi[d * 100 + i]);
    res1 += y - pLag; res0 += y - pLeak; n1++;
    d1 += logScore(pLag, y); d0 += logScore(pLeak, y);
    diffsLeak.push(logScore(pLeak, y) - logScore(pLag, y));
  }
  near(res1 / n1, 0, 4 * Math.sqrt(w.base / n1), "the lag-correct forecast is calibrated in the mean");
  near(res0 / n1, 0, 4 * Math.sqrt(w.base / n1), "and so is the forecast from same-day open interest");
  ok(d0 < d1, "same-day open interest carries information the published one does not");
  const stamped = recs.slice(5, 20);
  for (const rec of stamped) {
    const asOf = reference.sessionClose(w.dates[rec.describes + 1]);
    ok(reference.latestKnown(recs, asOf).describes === rec.describes, "at the next session's close the newest known open interest describes the previous session");
  }
  const b2 = leakBound(diffsLeak);
  ok(b2.fires, `the oracle bound fires on a forecaster that reads open interest early (${b2.z.toFixed(1)} SE)`);
  const verdict = await baselineResult("oiLag", "tests/truth/reference.mjs");
  ok(verdict.ok, "the as-of reader passes the open-interest bait: " + verdict.note);
  log("W5: " + verdict.note);
});

await section("w6", async () => {
  const T = 250;
  const w = w6Null({ seed: "w6-main", trials: 400, periods: T });
  const srs = w.returns.map(reference.sharpe);
  near(mean(srs), 0, 4 * (1 / Math.sqrt(T)) / Math.sqrt(w.trials), "the per-period Sharpe ratios of null strategies centre on zero");
  near(sd(srs), 1 / Math.sqrt(T), 0.1 / Math.sqrt(T), "with standard deviation one over root T");
  for (const r of fixtures.maxNormal) {
    rel(reference.expectedMaxSharpe(r.n, 1), r.expectedMax, 0.03, `the expected maximum of ${r.n} null Sharpe ratios is the exact normal maximum within 3%`);
  }
  eq(reference.expectedMaxSharpe(1, 1), 0, "one trial deflates nothing");
  const reg = new reference.TrialRegistry();
  eq(reg.count(), 1, "an empty registry counts one trial");
  reg.register(100); reg.register(5);
  eq(reg.count(), 105, "the registry counts every trial registered");
  const verdict = await baselineResult("trialCount", "tests/truth/reference.mjs");
  ok(verdict.ok, "the best of 100 null strategies is not declared significant: " + verdict.note);
  log("W6: " + verdict.note);
  const reps = 60 * SCALE.factor;
  let found = 0, pboNull = 0, pboEdge = 0, pboReps = 0;
  for (let i = 0; i < reps; i++) {
    const e = w6Null({ seed: `w6-edge|${SCALE.salt}|${i}`, trials: 100, periods: T, edge: 0.4 });
    const registry = new reference.TrialRegistry();
    registry.register(e.trials);
    const r = reference.selectAndTest(e.returns, registry);
    if (r.best === 0 && r.dsr > 0.95) found++;
  }
  ok(found / reps >= 0.9, `a planted edge of 0.4 a period is found and certified in ${found} of ${reps} runs`);
  for (let i = 0; i < 12; i++) {
    pboNull += reference.pbo(w6Null({ seed: `w6-pbo|${SCALE.salt}|${i}`, trials: 30, periods: 240 }).returns, 8);
    pboEdge += reference.pbo(w6Null({ seed: `w6-pbo-edge|${SCALE.salt}|${i}`, trials: 30, periods: 240, edge: 0.4 }).returns, 8);
    pboReps++;
  }
  near(pboNull / pboReps, 0.5, 0.12, "the probability of backtest overfitting on pure noise is one half");
  ok(pboEdge / pboReps < 0.15, "and falls to nearly zero when one strategy has a real edge");
  log(`PBO on noise ${(pboNull / pboReps).toFixed(2)}, with a planted edge ${(pboEdge / pboReps).toFixed(2)}`);
});

await section("w3", async () => {
  const sessions = 80;
  const counts = [], marks = [];
  for (let s = 0; s < sessions; s++) {
    const w = w3Hawkes({ seed: `w3-main|${s}`, ...HAWKES });
    counts.push(w.times.length);
    for (const m of w.marks) marks.push(m);
    ok(w.times.every((t, i) => i === 0 || t >= w.times[i - 1]) && w.times.every((t) => t >= 0 && t < 390), "event times are sorted inside the session");
  }
  const expected = (HAWKES.mu / (1 - HAWKES.branching)) * 390;
  const fano = variance(counts) / mean(counts);
  near(mean(counts), expected, 4 * Math.sqrt((expected / (1 - HAWKES.branching) ** 2) / sessions), "the mean event count is the stationary rate times the session");
  near(fano, 1 / (1 - HAWKES.branching) ** 2, 2.2, "the count dispersion is the Hawkes value 1 over (1 - n) squared");
  near(mean(marks), 1, 0.05, "marks have unit mean");
  const detector = await baselineResult("hawkesCompensator", "tests/truth/reference.mjs");
  ok(detector.ok, "the compensator makes the residuals unit exponential: " + detector.note);
  log("W3: " + detector.note);
  const w = w3Hawkes({ seed: "w3-marks", ...HAWKES });
  const blind = reference.hawkesResiduals(w.times, new Float64Array(w.marks.length).fill(1), HAWKES);
  const aware = reference.hawkesResiduals(w.times, w.marks, HAWKES);
  ok(Math.abs(variance(blind) - 1) > Math.abs(variance(aware) - 1) || Math.abs(mean(blind) - 1) > Math.abs(mean(aware) - 1), "a compensator that ignores the marks fits worse than one that uses them");
});

await section("w3b", async () => {
  const fx = fixtures.f1Fixed;
  const line = reference.alertLine();
  rel(line, fx.line, 1e-9, "the Alert line m' H(m') over alpha equals the reference");
  for (const row of fx.rows) {
    const sessions = 1000;
    const w = w3bSession({ seed: `w3b-fixed|${row.sdDay}`, names: sessions, sdDay: row.sdDay, lambda: fx.lambda, dispersion: fx.r });
    let cross = 0, o20 = 0;
    for (const nm of w.names) {
      let mx = 0;
      for (const v of reference.fixedEProcess(nm.counts, { lambda: fx.lambda, r: fx.r })) if (v > mx) mx = v;
      if (mx >= line) cross++;
      if (mx >= 20) o20++;
    }
    const tol = (p) => 4 * Math.sqrt((p * (1 - p)) / sessions + (p * (1 - p)) / row.sessions) + 0.003;
    near(cross / sessions, row.crossLine, tol(row.crossLine), `F1 as designed, day effect ${row.sdDay}: the share of names crossing the Alert line equals the independent numpy simulation`);
    near(o20 / sessions, row.maxAtLeast20, tol(row.maxAtLeast20), `and the share reaching E = 20`);
    log(`fixed-level null, day effect ${row.sdDay}: ${(100 * cross / sessions).toFixed(1)}% cross the line (numpy ${(100 * row.crossLine).toFixed(1)}%), ${(100 * o20 / sessions).toFixed(1)}% reach 20 (numpy ${(100 * row.maxAtLeast20).toFixed(1)}%)`);
  }
  const detector = await baselineResult("flowNullDayEffect", "tests/truth/reference.mjs");
  ok(detector.ok, "a flow null that contains the day effect keeps ordinary names under the line: " + detector.note);
  log("W3b: " + detector.note);
  const day = w3bSession({ seed: "w3b-day", names: 3000, sdDay: 0.25 });
  const totals = day.names.map((nm) => nm.counts.reduce((a, b) => a + b, 0));
  const m = day.params.lambda * 390;
  const theory = m * m * (Math.exp(0.0625) - 1) + m + (390 * day.params.lambda ** 2 * Math.exp(0.0625)) / day.params.dispersion;
  near(mean(totals) / m, 1, 0.02, "session totals average the base level");
  near(variance(totals) / theory, 1, 0.12, "and carry the day effect's variance plus the negative-binomial noise");
  const surge = w3bSession({ seed: "w3b-surge", names: 300, sdDay: 0, surgeMultiplier: 3, surgeStart: 60 });
  let before = 0, after = 0;
  for (const nm of surge.names) { for (let j = 0; j < 60; j++) before += nm.counts[j]; for (let j = 60; j < 390; j++) after += nm.counts[j]; }
  near((after / 330) / (before / 60), 3, 0.2, "a 3x surge from minute 60 triples the rate");
  const wx = w3bSession({ seed: "w3b-weather", names: 400, sdDay: 0, sdWeather: 0.3, memory: 20 });
  const base = w3bSession({ seed: "w3b-noweather", names: 400, sdDay: 0 });
  const lag1 = (nms) => { let a = 0, b = 0, n = 0; for (const nm of nms) { const mu = nm.counts.reduce((x, y) => x + y, 0) / 390; for (let j = 1; j < 390; j++) { a += (nm.counts[j] - mu) * (nm.counts[j - 1] - mu); } for (let j = 0; j < 390; j++) b += (nm.counts[j] - mu) ** 2; n++; } return a / b; };
  ok(lag1(wx.names) > lag1(base.names) + 0.05, "intraday weather puts memory into the counts that independent noise lacks");
  const mean390 = (sess) => Float64Array.from({ length: 390 }, (_, j) => mean(sess.names.map((nm) => nm.counts[j])));
  const mk = w3bSession({ seed: "w3b-market", names: 200, sdDay: 0, marketWeatherSd: 0.4, memory: 20 });
  const flat = w3bSession({ seed: "w3b-flat", names: 200, sdDay: 0 });
  const withFactor = autocorrelation(mean390(mk), 1), without = autocorrelation(mean390(flat), 1);
  ok(withFactor > 0.5 && Math.abs(without) < 0.15, `a market factor makes the cross-sectional mean persist from minute to minute (${withFactor.toFixed(2)} against ${without.toFixed(2)})`);
  const lotted = w3bSession({ seed: "w3b-lots", names: 20, sdDay: 0.25, withLots: true });
  ok(lotted.names.every((nm) => nm.lots.every((l, j) => l >= nm.counts[j])), "every trade carries at least one lot");
  ok(lotted.names.every((nm) => nm.lots.some((l, j) => l > nm.counts[j])), "and many carry more");
});

await section("w9", () => {
  const a = w9World({ names: 40, sessions: 12, seed: "w9-det" }), b = w9World({ names: 40, sessions: 12, seed: "w9-det" });
  const s5 = a.session(5);
  b.session(2);
  eq(Array.from(b.session(5).inc), Array.from(s5.inc), "a session is a pure function of the seed and its index, whatever was drawn before");
  const big = w9World({ names: 670, sessions: 2, seed: "w9-big" });
  const t0 = Date.now();
  const bs = big.session(0);
  eq([big.names.length, new Set(big.names.map((x) => x.sector)).size, bs.bars], [670, 11, 390], "the full market is 670 names in 11 sectors over 390 one-minute bars");
  log(`a 670-name session is generated in ${Date.now() - t0} ms`);
  eq([0, 1, 2].map((k) => big.names.filter((x) => x.bucket === k).length >= 200), [true, true, true], "the three liquidity buckets are populated alike");

  const gW = w9World({ names: 120, sessions: 40, seed: "w9-var", innovation: "gaussian", keepTruth: true });
  let dv = 0, dn = 0, gapv = 0, sig2 = 0, first = 0, mid = 0, expFirst = 0, expMid = 0;
  const shape = clockShape(390, 30, 2.2);
  for (let d = 0; d < 40; d++) {
    const s = gW.session(d);
    for (let i = 0; i < 120; i++) {
      let tot = s.gap[i];
      for (let m = 0; m < 390; m++) {
        const x = s.trueInc[i * 390 + m];
        tot += x;
        if (m < 30) first += x * x; else if (m >= 180 && m < 210) mid += x * x;
      }
      dv += (tot / s.sigmaTrue[i]) ** 2; dn++; gapv += (s.gap[i] / s.sigmaTrue[i]) ** 2; sig2 += 1;
      expFirst += s.sigmaTrue[i] ** 2; expMid += s.sigmaTrue[i] ** 2;
    }
  }
  const sh30 = shape.slice(0, 30).reduce((x, y) => x + y, 0) * 0.75, shMid = shape.slice(180, 210).reduce((x, y) => x + y, 0) * 0.75;
  near(dv / dn, 1, 0.06, "the daily return has the day scale as its standard deviation");
  near(gapv / sig2, 0.25, 0.03, "the overnight gap carries its configured share of the day's variance");
  near(first / expFirst, sh30, 0.15 * sh30, "the first half hour carries the U-shaped clock's share");
  near(mid / expMid, shMid, 0.15 * shMid, "and the middle of the day its much smaller one");
  ok(first / expFirst > 1.5 * mid / expMid, "the open is at least half as busy again as the middle of the day");

  for (const row of fixtures.jumpGaussian.filter((r) => r.nu !== null)) {
    const w = w9World({ names: 120, sessions: 40, seed: `w9-tail|${row.nu}`, innovation: "t", nuRange: [row.nu, row.nu], marketRho: 0, sectorRho: 0, keepTruth: true });
    let flagged = 0, total = 0;
    for (let d = 0; d < 40; d++) {
      const s = w.session(d);
      for (let i = 0; i < 120; i++) {
        let hit = false;
        for (let m = 0; m < 390 && !hit; m++) if (Math.abs(s.trueInc[i * 390 + m] / (s.sigmaTrue[i] * Math.sqrt(s.clockTrue[m]))) > row.threshold) hit = true;
        if (hit) flagged++;
        total++;
      }
    }
    const p = row.perNameDay;
    near(flagged / total, p, 4 * Math.sqrt((p * (1 - p)) / total) + 0.002, `a Gaussian ${row.threshold} threshold flags ${(100 * p).toFixed(1)}% of ordinary name-days when increments are Student t with ${row.nu} degrees of freedom, as the exact calculation says`);
    log(`nu ${row.nu}: ${(100 * flagged / total).toFixed(1)}% of name-days flagged (exact ${(100 * p).toFixed(1)}%)`);
  }

  const sectorW = w9World({ names: 66, sessions: 40, seed: "w9-sector", innovation: "gaussian", betaDrift: 0, sectorRho: 0.3, marketRho: 0.15, keepTruth: true });
  const pair = (same) => {
    let num = 0, cnt = 0;
    const bars = 78;
    const rows = [];
    for (let d = 0; d < 40; d++) {
      const s = sectorW.session(d);
      const r = Array.from({ length: 66 }, (_, i) => { const out = []; for (let k = 0; k < bars; k++) { let acc = 0; for (let m = k * 5; m < k * 5 + 5; m++) acc += s.trueInc[i * 390 + m] / (s.sigmaTrue[i] * Math.sqrt(s.clockTrue[m])); out.push(acc / Math.sqrt(5)); } return out; });
      rows.push(r);
    }
    for (let i = 0; i < 66; i++) for (let j = i + 1; j < 66; j++) {
      if ((sectorW.names[i].sector === sectorW.names[j].sector) !== same) continue;
      let sxy = 0, sxx = 0, syy = 0;
      for (const r of rows) for (let k = 0; k < bars; k++) { sxy += r[i][k] * r[j][k]; sxx += r[i][k] ** 2; syy += r[j][k] ** 2; }
      num += sxy / Math.sqrt(sxx * syy); cnt++;
    }
    return num / cnt;
  };
  const theory = (same) => {
    let acc = 0, cnt = 0;
    for (let i = 0; i < 66; i++) for (let j = i + 1; j < 66; j++) {
      if ((sectorW.names[i].sector === sectorW.names[j].sector) !== same) continue;
      const bi = sectorW.names[i].beta0, bj = sectorW.names[j].beta0;
      const num = 0.15 * bi * bj + (same ? 0.85 * 0.3 : 0);
      acc += num / (Math.sqrt(0.15 * bi * bi + 0.85) * Math.sqrt(0.15 * bj * bj + 0.85)); cnt++;
    }
    return acc / cnt;
  };
  near(pair(true), theory(true), 0.02, "names in one sector share the market and sector factors at the configured weights");
  near(pair(false), theory(false), 0.02, "names in different sectors share the market factor alone");
  log(`sector structure: same-sector correlation ${pair(true).toFixed(3)} (design ${theory(true).toFixed(3)}), different-sector ${pair(false).toFixed(3)} (design ${theory(false).toFixed(3)})`);
});

await section("w9-errors", () => {
  const sdOf = (kind, extra = {}) => {
    const w = w9World({ names: 200, sessions: 60, seed: `w9-err|${kind}`, scaleError: 0.2, scaleErrorLaw: kind, paths: false, ...extra });
    const e = [], stress = [], calm = [], hot = [];
    for (let d = 0; d < 60; d++) {
      const s = w.session(d);
      for (let i = 0; i < 200; i++) { e.push(s.scaleLogError[i]); (s.stress ? stress : calm).push(s.scaleLogError[i]); hot.push(s.hot[i]); }
    }
    return { sd: sd(e), kurt: e.reduce((a, v) => a + (v - mean(e)) ** 4, 0) / e.length / variance(e) ** 2, stress, calm, hot, e };
  };
  const normal = sdOf("normal"), t3 = sdOf("t3"), cont = sdOf("contaminated");
  near(normal.sd, 0.2, 0.01, "the normal scale error has the configured standard deviation");
  near(t3.sd, 0.2, 0.02, "the t3 law keeps that standard deviation");
  near(cont.sd, 0.2, 0.012, "and so does the contaminated one");
  ok(normal.kurt < 3.3 && t3.kurt > 5 && cont.kurt > 4.5, `at one standard deviation the laws differ in the tail (kurtosis ${normal.kurt.toFixed(1)}, ${t3.kurt.toFixed(1)}, ${cont.kurt.toFixed(1)})`);
  const regime = sdOf("normal", { regimeScale: true });
  const ratio = sd(regime.stress) / sd(regime.calm);
  ok(regime.stress.length > 500 && Math.abs(ratio - 1.9 / 0.8) < 0.35, `the scale error is larger in stress sessions (${ratio.toFixed(2)} times, designed ${(1.9 / 0.8).toFixed(2)})`);
  const hot = sdOf("normal", { hotRate: 0.03 });
  const share = hot.hot.reduce((a, v) => a + v, 0) / hot.hot.length;
  near(share, 0.03, 4 * Math.sqrt(0.03 * 0.97 / hot.hot.length), "3% of name-days run hot");
  const hotE = hot.e.filter((_, k) => hot.hot[k]);
  near(mean(hotE), Math.log(2.2), 0.06, "and a hot name-day's realised scale is 2.2 times its forecast");
});

await section("w9-corruption", () => {
  const w = w9World({ names: 150, sessions: 30, seed: "w9-bad", innovation: "gaussian", badTickRate: 0.5, keepTruth: true });
  const ws = w9World({ names: 150, sessions: 30, seed: "w9-stale-rate", innovation: "gaussian", keepTruth: true, staleByBucket: [0, 0.1, 0.4] });
  let ticks = 0, revert = 0, sizeOk = 0;
  const staleN = [0, 0, 0], staleD = [0, 0, 0];
  for (let d = 0; d < 30; d++) {
    const s = w.session(d);
    for (const t of s.labels.badTicks) {
      ticks++;
      const local = s.sigmaTrue[t.name] * Math.sqrt(s.clockTrue[t.minute]);
      const i = t.name * 390;
      if (Math.abs(s.observed[i + t.minute] - s.trueInc[i + t.minute] - t.localSds * local) < 1e-9 && Math.abs(s.observed[i + t.minute + 1] + t.localSds * local - s.trueInc[i + t.minute + 1]) < 1e-9 + 0.0 * local) revert++;
      if (Math.abs(t.localSds) >= 5 && Math.abs(t.localSds) <= 20) sizeOk++;
    }
  }
  for (let d = 0; d < 30; d++) {
    const s = ws.session(d);
    for (let i = 0; i < 150; i++) {
      const k = ws.names[i].bucket;
      for (let m = 0; m < 389; m++) { staleD[k]++; if (s.observed[i * 390 + m] === 0) staleN[k]++; }
    }
  }
  ok(ticks > 1500 && ticks < 2300, `bad ticks arrive at the configured rate (${ticks})`);
  eq([revert, sizeOk], [ticks, ticks], "every bad tick is a single print of 5 to 20 local standard deviations that reverts the next minute");
  [0, 0.1, 0.4].forEach((p, k) => near(staleN[k] / staleD[k], p, 4 * Math.sqrt((p * (1 - p)) / staleD[k]) + 0.002, `stale minutes in liquidity bucket ${k} occur ${p * 100}% of the time`));
  const clean = w9World({ names: 40, sessions: 5, seed: "w9-stale", staleByBucket: [0.2, 0.2, 0.2], keepTruth: true });
  const s = clean.session(2);
  let worst = 0;
  for (let i = 0; i < 40; i++) { let a = 0, b = 0; for (let m = 0; m < 390; m++) { a += s.observed[i * 390 + m]; b += s.trueInc[i * 390 + m]; } worst = Math.max(worst, Math.abs(a - b)); }
  ok(worst < 1e-12, "a stale name catches up on the next fresh print, so the session's price path ends where the true one does");
  const bw = w9World({ names: 50, sessions: 40, seed: "w9-bounce", innovation: "gaussian", clockPeak: 1, gapShare: 0, bounce: { half: 0.003, every: 5 }, keepTruth: true });
  let c1 = 0, v0 = 0, c1n = 0, v0n = 0, sv = 0, sc = 0;
  for (let d = 0; d < 40; d++) {
    const s2 = bw.session(d);
    for (let i = 0; i < 50; i++) {
      const bounce = bw.names[i].bounceName;
      for (let m = 1; m < 390; m++) {
        const x = s2.observed[i * 390 + m], y = s2.observed[i * 390 + m - 1];
        if (bounce) { c1 += x * y; v0 += x * x; } else { c1n += x * y; v0n += x * x; }
      }
      if (bounce) { sv += (s2.sigmaTrue[i] ** 2) / 390; sc++; }
    }
  }
  const design = -(0.003 ** 2) / (sv / sc + 2 * 0.003 ** 2);
  near(c1 / v0, design, 0.05, "bid-ask bounce gives low-priced names the negative lag-1 autocorrelation of its design");
  ok(Math.abs(c1n / v0n) < 0.04, "and other names none");
  log(`bounce: lag-1 autocorrelation ${(c1 / v0).toFixed(3)} on bounce names (design ${design.toFixed(3)}), ${(c1n / v0n).toFixed(3)} on the rest`);
});

await section("w9-labels", () => {
  const base = w9World({ names: 60, sessions: 6, seed: "w9-jump", keepTruth: true });
  const jumpy = w9World({ names: 60, sessions: 6, seed: "w9-jump", jumpRate: 0.5, keepTruth: true });
  const s0 = base.session(3), s1 = jumpy.session(3);
  ok(s1.labels.jumps.length > 15, `jumps are planted at the configured rate (${s1.labels.jumps.length})`);
  const diff = Float64Array.from(s1.trueInc, (v, k) => v - s0.trueInc[k]);
  let worst = 0;
  const expect = new Float64Array(diff.length);
  for (const j of s1.labels.jumps) for (let m = j.start; m < j.start + j.spread; m++) expect[j.name * 390 + m] += (j.size * s1.sigmaTrue[j.name]) / j.spread;
  for (let k = 0; k < diff.length; k++) worst = Math.max(worst, Math.abs(diff[k] - expect[k]) / (s1.sigmaTrue[Math.floor(k / 390)] + 1e-12));
  ok(worst < 1e-12 && s1.labels.jumps.every((j) => [1, 15, 60].includes(j.spread) && [3, 4, 6, 8].includes(Math.abs(j.size))), "the base path is unchanged by the jumps and the difference is exactly the labelled jumps");
  const planted = w9World({ names: 60, sessions: 6, seed: "w9-jump", keepTruth: true, plantJumps: [{ name: 3, start: 100, spread: 15, size: 6 }] }).session(3);
  let got = 0;
  for (let m = 100; m < 115; m++) got += planted.trueInc[3 * 390 + m] - s0.trueInc[3 * 390 + m];
  near(got / planted.sigmaTrue[3], 6, 1e-9, "a planted jump of six daily standard deviations over 15 minutes is exactly that");
  const hw = w9World({ names: 150, sessions: 20, seed: "w9-head", jumpRate: 0.1, headlineRate: 0.4, headlineCausedProbability: 0.5, keepTruth: true });
  let indep = 0, indepRet = 0, tied = 0, jumpsN = 0, caused = 0, causedOk = 0;
  const countArr = [], retArr = [];
  for (let d = 0; d < 20; d++) {
    const s = hw.session(d);
    jumpsN += s.labels.jumps.length;
    const per = new Float64Array(150);
    for (const h of s.labels.headlines) {
      if (h.kind === "independent") { per[h.name]++; indep++; }
      if (h.kind === "tied") { tied++; ok([-15, 0, 10].includes(h.lead), "a tied headline sits at one of the configured leads"); }
      if (h.kind === "caused") {
        caused++;
        let acc = 0;
        for (let m = Math.max(0, h.minute - 16); m < h.minute; m++) acc = Math.max(acc, Math.abs(s.trueInc.slice(h.name * 390 + Math.max(0, m - 5), h.name * 390 + m + 1).reduce((x, y) => x + y, 0)));
        if (acc > 0.3 * s.sigmaTrue[h.name]) causedOk++;
      }
    }
    for (let i = 0; i < 150; i++) { let tot = s.gap[i]; for (let m = 0; m < 390; m++) tot += s.trueInc[i * 390 + m]; countArr.push(per[i]); retArr.push(Math.abs(tot) / s.sigmaTrue[i]); }
  }
  const mc = mean(countArr), mr = mean(retArr);
  let cov = 0;
  for (let k = 0; k < countArr.length; k++) cov += (countArr[k] - mc) * (retArr[k] - mr);
  const corr = cov / (countArr.length - 1) / Math.sqrt(variance(countArr) * variance(retArr));
  ok(Math.abs(corr) < 4 / Math.sqrt(countArr.length), `independent headlines carry no information about the day's move (correlation ${corr.toFixed(3)})`);
  near(indep / countArr.length, 0.4 * (1 + 1 / 3), 0.05, "their rate is the configured one, doubled for the most liquid third");
  near(tied / jumpsN, 0.7, 0.07, "70% of planted jumps carry a headline at a known lead");
  ok(caused > 20 && causedOk / caused > 0.9, `headlines caused by moves follow them (${causedOk} of ${caused})`);
  void indepRet;
  const fa = w9World({ names: 40, sessions: 4, seed: "w9-flow", flowAnomalies: 5 }).session(1);
  eq(fa.labels.flowAnomalies.length, 5, "planted flow anomalies are labelled with their start");
  const an = fa.labels.flowAnomalies[0];
  let pre = 0, post = 0, runs = 0;
  for (let k = 0; k < 20; k++) {
    const w2 = w9World({ names: 40, sessions: 4, seed: `w9-flow|${k}`, flowAnomalies: 5 }).session(1);
    const f = w2.labels.flowAnomalies[0];
    const counts = w2.flowCounts(f.name);
    for (let j = 0; j < f.start; j++) pre += counts[j];
    for (let j = f.start; j < 390; j++) post += counts[j];
    runs += f.multiplier * 0 + (post / (390 - f.start)) / (pre / f.start) / f.multiplier;
    pre = 0; post = 0;
  }
  near(runs / 20, 1, 0.25, "a planted flow surge multiplies the name's counts by its labelled factor from its labelled start");
  ok(an.start >= 30, "and starts after the first half hour");
});

await section("w9-axes", () => {
  const vr = (kappa, extra = {}) => {
    const w = w9World({ names: 100, sessions: 30, seed: `w9-serial|${kappa}`, innovation: "gaussian", clockPeak: 1, gapShare: 0, marketRho: 0, sectorRho: 0, serial: { kappa, memory: 20 }, keepTruth: true, ...extra });
    let s1 = 0, sN = 0, n = 0;
    for (let d = 0; d < 30; d++) {
      const s = w.session(d);
      for (let i = 0; i < 100; i++) {
        let acc = 0;
        for (let m = 0; m < 390; m++) {
          const z = s.trueInc[i * 390 + m] / (s.sigmaTrue[i] * Math.sqrt(s.clockTrue[m]));
          s1 += z * z; acc += z;
          if ((m + 1) % 30 === 0) { sN += acc * acc; acc = 0; n++; }
        }
      }
    }
    return sN / n / 30 / (s1 / (n * 30));
  };
  const up = vr(0.02), flat = vr(0), down = vr(-0.02);
  near(flat, 1, 0.05, "with no serial dependence the 30-minute variance ratio is one");
  ok(up > flat + 0.1 && down < flat - 0.1, `momentum and reversal move the 30-minute variance ratio either side of one (${down.toFixed(2)}, ${flat.toFixed(2)}, ${up.toFixed(2)})`);
  const rvAcf = (sdv) => {
    const w = w9World({ names: 100, sessions: 20, seed: `w9-vol|${sdv}`, innovation: "gaussian", clockPeak: 1, gapShare: 0, marketRho: 0, sectorRho: 0, volCluster: { sd: sdv, halfLife: 30 }, keepTruth: true });
    const blocks = [];
    for (let d = 0; d < 20; d++) {
      const s = w.session(d);
      for (let i = 0; i < 100; i++) {
        const row = [];
        for (let k = 0; k < 39; k++) { let acc = 0; for (let m = k * 10; m < k * 10 + 10; m++) acc += (s.trueInc[i * 390 + m] / (s.sigmaTrue[i] * Math.sqrt(s.clockTrue[m]))) ** 2; row.push(acc); }
        blocks.push(row);
      }
    }
    const lagCorr = (lag) => { let num = 0, den = 0; for (const r of blocks) { const m = mean(r); for (let k = 0; k < r.length; k++) { den += (r[k] - m) ** 2; if (k >= lag) num += (r[k] - m) * (r[k - lag] - m); } } return num / den; };
    return { l1: lagCorr(1), l3: lagCorr(3) };
  };
  const c0 = rvAcf(0), c3 = rvAcf(0.3), c5 = rvAcf(0.5);
  ok(Math.abs(c0.l1) < 0.05 && c3.l1 > 0.1 && c5.l1 > c3.l1 + 0.05 && c5.l3 > 0.1, `log-volatility clustering shows in 10-minute realised variance and grows with its standard deviation (${c0.l1.toFixed(2)}, ${c3.l1.toFixed(2)}, ${c5.l1.toFixed(2)})`);
  const fomc = w9World({ names: 100, sessions: 4, seed: "w9-day", dayTypes: ["fomc"], keepTruth: true }).session(1);
  const spike = (m) => mean(Array.from({ length: 100 }, (_, i) => Math.abs(fomc.trueInc[i * 390 + m]) / fomc.sigmaTrue[i]));
  ok(spike(FOMC_MINUTE) > 4 * spike(FOMC_MINUTE - 20), "a market-wide jump hits at 14:00 on an FOMC day");
  ok(fomc.labels.factorJumps.some((f) => f.minute === FOMC_MINUTE && f.scheduled), "and is labelled as scheduled");
  const cpi = w9World({ names: 150, sessions: 6, seed: "w9-cpi", dayTypes: ["cpi"] }).session(2);
  let g2 = 0, s2 = 0;
  for (let i = 0; i < 150; i++) { g2 += cpi.gap[i] ** 2; s2 += cpi.sigmaTrue[i] ** 2; }
  near(g2 / s2, 0.5, 0.1, "a CPI morning doubles the overnight share of the day's variance");
  const early = w9World({ names: 30, sessions: 4, seed: "w9-early", dayTypes: ["earlyClose"] }).session(1);
  eq([early.minutes, early.bars], [210, 210], "an early close has 210 one-minute bars");
  const one = w9World({ names: 30, sessions: 3, seed: "w9-cad", staleByBucket: [0.1, 0.1, 0.1], badTickRate: 0.3, keepTruth: true }).session(1);
  const five = w9World({ names: 30, sessions: 3, seed: "w9-cad", cadence: 5, staleByBucket: [0.1, 0.1, 0.1], badTickRate: 0.3 }).session(1);
  let worst = 0;
  for (let i = 0; i < 30; i++) for (let k = 0; k < 78; k++) { let acc = 0; for (let m = k * 5; m < k * 5 + 5; m++) acc += one.observed[i * 390 + m]; worst = Math.max(worst, Math.abs(acc - five.inc[i * 78 + k])); }
  ok(five.bars === 78 && worst < 1e-15, "the five-minute cadence is the sum of the same session's one-minute bars");
  const ev = w9World({ names: 200, sessions: 3, seed: "w9-event", eventRate: 0.05 }).session(1);
  ok(ev.labels.events.length > 3 && ev.labels.events.every((e) => e.minute === 0 && Math.abs(e.size) >= 2.1), "scheduled events are labelled with their time and size");
  const ooF = w9OutOfFamily({ names: 100, sessions: 16, seed: "w9o" });
  const types = Array.from({ length: 8 }, (_, d) => ooF.session(d).type);
  eq([...new Set(types)].sort(), ["cpi", "earlyClose", "fomc", "normal"], "the out-of-family world cycles through every day type");
  eq([W9_OUT_OF_FAMILY.scaleErrorLaw, W9_OUT_OF_FAMILY.regimeScale, W9_OUT_OF_FAMILY.hotRate, W9_OUT_OF_FAMILY.volCluster.sd, W9_OUT_OF_FAMILY.bounce.half > 0, W9_OUT_OF_FAMILY.innovation], ["t3", true, 0.03, 0.5, true, "garch"], "W9o is built from the axes the calibration family has no dimension for");
  eq([W9_WORLDS.W9.family, W9_WORLDS.W9o.family], ["calibration", "out-of-family"], "W9o is registered as out-of-family");
});

await section("runner", () => {
  let refused = false;
  try { accept({ id: "x", mode: MODES.WELL, pass: true }); } catch (e) { refused = e instanceof NotJudged; }
  ok(refused, "the runner refuses to accept a result from a well-specified cell");
  const inFamily = cell({ id: "in", world: "W1", mode: MODES.MIS, run: () => ({ pass: true }) });
  const well = cell({ id: "well", world: "W1", mode: MODES.WELL, run: () => ({ pass: true }) });
  const outFamily = cell({ id: "out", world: "W1", mode: MODES.MIS, outOfFamily: true, run: () => ({ pass: true }) });
  let none = false;
  try { judge([inFamily, well]); } catch (e) { none = e instanceof NoJudgementList; }
  ok(none, "a harness run whose judgement worlds include none marked out-of-family fails");
  let noMis = false;
  try { judge([well]); } catch (e) { noMis = e instanceof NoJudgementList; }
  ok(noMis, "a harness run with no mis-specified cell fails");
  const v = judge([inFamily, well, outFamily]);
  eq(v.rows.map((r) => r.accepted), [true, null, true], "a well-specified cell is reported as a reference and never accepted");
  eq(v.judged, 2, "two cells judged");
  eq(Object.keys({ ...WORLDS, ...W9_WORLDS }).sort(), ["W1", "W1d", "W3", "W3b", "W4", "W5", "W6", "W7", "W8", "W9", "W9o"], "the worlds registered");
  const a = w1Garch({ seed: "det", n: 100 }), b = w1Garch({ seed: "det", n: 100 });
  eq(Array.from(a.r), Array.from(b.r), "a world is a pure function of its seed");
});

await section("w1d", async () => {
  const fx = fixtures.w1d;
  const measured = new Map();
  const coverageOf = (ratio) => 2 * normalCdf(1.645 / ratio) - 1;
  for (const row of fx.rows) {
    const reps = row.reps * SCALE.factor;
    const c = pooledShapeCoverage(worldsModule, { rho: row.rho, reps, names: fx.names, days: fx.days, nu: fx.nu });
    measured.set(row.rho, c);
    const seRel = Math.sqrt(((c.kurtosis - 1) / 4) * (1 / c.reps + 1 / row.reps));
    const tolRatio = Math.min(3.5 * seRel * row.ratio, 0.25 * row.ratio);
    const tolCoverage = Math.max(Math.abs(coverageOf(row.ratio - tolRatio) - row.coverage), Math.abs(coverageOf(row.ratio + tolRatio) - row.coverage));
    log(`W1d rho ${row.rho}: the pooled shape's SD is ${c.ratio.toFixed(2)} times its model standard error, so a nominal 90% interval covers ${(100 * c.coverage).toFixed(0)}% (numpy ${row.ratio.toFixed(2)}, ${(100 * row.coverage).toFixed(0)}%; ${c.reps} and ${row.reps} runs, kurtosis ${c.kurtosis.toFixed(1)}, so the tolerance, 3.5 standard errors of the difference and never more than 25%, is ${tolRatio.toFixed(2)} in the ratio and ${tolCoverage.toFixed(3)} in the coverage it implies)`);
    near(c.ratio, row.ratio, tolRatio, `W1d rho ${row.rho}: the ratio of the pooled shape's spread to its standard error equals the independent numpy simulation within the tolerance`);
    near(c.coverage, row.coverage, tolCoverage, `W1d rho ${row.rho}: so does the implied coverage of a nominal 90% interval`);
  }
  const indep = measured.get(0), dep = measured.get(0.3);
  ok(indep.coverage > 0.78 && dep.coverage < 0.7, `an independent-names generator cannot produce the shortfall (${(100 * indep.coverage).toFixed(0)}% against ${(100 * dep.coverage).toFixed(0)}%)`);
  const viaHelper = pooledShapeCoverage({ w1dWorld: (o) => w1Independent(o) }, { rho: 0.3, reps: 40, names: 60, days: 500 });
  ok(viaHelper.coverage > 0.78, "the independent generator holds nominal coverage whatever correlation is asked of it");
  const w = w1dWorld({ seed: "w1d-corr", names: 60, days: 4000, rho: 0.3, nu: 5 });
  let sxy = 0, sxx = 0, syy = 0;
  for (let t = 0; t < w.days; t++) { const x = w.r[t], y = w.r[w.days + t]; sxy += x * y; sxx += x * x; syy += y * y; }
  near(sxy / Math.sqrt(sxx * syy), 0.3, 0.04, "two names of the dependent world correlate at the configured weight");
});

await section("judgement", async () => {
  const f = SCALE.factor;
  const calOpts = { ...JUMP_NULL_WORLD, sessions: 40 * f, seed: `${JUMP_NULL_WORLD.seed}|${SCALE.salt}` };
  const null0 = await baselineResult("jumpFlagNull", "tests/truth/reference.mjs");
  ok(null0.ok, "the calibrated jump flag holds its rate in the family it was calibrated on: " + null0.note);
  log("W9: " + null0.note);
  const ooFamily = { names: 150, seed: "w9o-judge", sessions: 20, ...W9_OUT_OF_FAMILY, badTickRate: 0, staleByBucket: [0, 0, 0], hotRate: 0.03 };
  const transfer = jumpFlagTransfer(reference, { lines: null0.lines, world: ooFamily });
  const gaussian = jumpFlagTransfer(reference, { lines: [5.47, 5.47, 5.47], world: ooFamily });
  const gaussianIn = jumpFlagTransfer(reference, { lines: [5.47, 5.47, 5.47], world: { ...calOpts, sessions: 20 } });
  const gaussianT4 = jumpFlagTransfer(reference, { lines: [5.47, 5.47, 5.47], world: { ...calOpts, sessions: 20, nuRange: [4, 4], scaleError: 0, seed: "w9-g4" } });
  log(`jump flag calibrated in W9: ${(100 * transfer.share).toFixed(1)}% of ordinary name-days flagged in W9o (3% of them run 2.2 times hot); a Gaussian 5.47 threshold flags ${(100 * gaussianIn.share).toFixed(0)}% in W9, ${(100 * gaussian.share).toFixed(0)}% in W9o and ${(100 * gaussianT4.share).toFixed(0)}% at nu 4`);
  const cells = [
    cell({ id: "w9-jump-flag-in-family", world: "W9", mode: MODES.WELL, run: () => ({ pass: null0.ok, note: null0.note }) }),
    cell({ id: "w9o-jump-flag-transfer", world: "W9o", mode: MODES.MIS, outOfFamily: true, run: () => ({ pass: transfer.share <= 0.03, note: `${(100 * transfer.share).toFixed(1)}% flagged against a nominal 1%` }) }),
    cell({ id: "w9o-gaussian-threshold", world: "W9o", mode: MODES.MIS, outOfFamily: true, run: () => ({ pass: gaussian.share <= 0.03, note: `${(100 * gaussian.share).toFixed(0)}% flagged` }) }),
  ];
  const verdict = judge(cells);
  verdict.rows.forEach((r) => log(formatRow(r)));
  eq(verdict.rows.map((r) => r.accepted), [null, false, false], "the Gaussian 5.47 threshold and the calibrated flag are both rejected in the out-of-family world: the calibrated lines were fitted in W9 and flag about 18% of ordinary name-days in W9o against a nominal 1%");
  ok(gaussian.share > 0.15 && gaussianIn.share > 0.15 && gaussianT4.share > 0.15, "a Gaussian 5.47 threshold flags more than one ordinary name-day in seven in every heavy-tailed world");
  ok(transfer.share > null0.share, "the jump flag calibrated in the family flags more name-days in the world the family did not generate");
  let none = false;
  try { judge([cells[0], cell({ id: "in", world: "W9", mode: MODES.MIS, run: () => ({ pass: true }) })]); } catch (e) { none = e instanceof NoJudgementList; }
  ok(none, "a harness run whose judgement worlds include none marked out-of-family fails");
  const bh = await baselineResult("bhCompleteNull", "tests/truth/reference.mjs"), by = await baselineResult("byCompleteNull", "tests/truth/reference.mjs");
  ok(bh.ok && by.ok, "the multiplicity code reproduces the exact complete-null rejection probabilities: " + bh.note + "; " + by.note);
  log(bh.note);
  log(by.note);
  const fdr = await baselineResult("sessionFdr", "tests/truth/reference.mjs");
  ok(fdr.ok, "the session alert set keeps the error rate: " + fdr.note);
  log("W9: " + fdr.note);
  const e1 = await baselineResult("eProcessRepair", "tests/truth/reference.mjs"), e2 = await baselineResult("eProcessInflation", "tests/truth/reference.mjs");
  ok(e1.ok && e2.ok, "the e-process with the per-increment transform and the inflated scale holds its line: " + e1.note + "; " + e2.note);
  log(e1.note);
  log(e2.note);
});

await section("rt-sim", async () => {
  const a = createMarketSim({ seed: "sim-a", names: 24 }), b = createMarketSim({ seed: "sim-a", names: 24 }), c = createMarketSim({ seed: "sim-b", names: 24 });
  eq(a.digest(), b.digest(), "one seed gives one event log");
  ok(a.digest() !== c.digest(), "another seed gives another");
  ok(a.log.every((e, i) => i === 0 || e.at >= a.log[i - 1].at), "the log is in time order");
  eq(a.log.filter((e) => e.ch === "px").length, 24 * 390, "every name prints every minute");
  eq(a.log.filter((e) => e.ch === "periscope").length, 390 * 3, "the index book arrives as three frames a minute");
  eq(a.news.length, a.world.labels.headlines.length, "the headlines are the world's labelled headlines");
  ok(a.alerts.length > 200 && a.alerts.every((e, i) => i === 0 || e.at >= a.alerts[i - 1].at), "flow alerts are a Hawkes stream per active name, in time order");
  ok(a.pxBy[3].every((e) => e.at > e.quoteTime), "every price reaches the vendor after its own quote time");

  a.advanceTo(a.open + 30 * 60000);
  const scr = await a.rest("/api/screener/stocks", { ticker: "SPY,NVDA,UNKNOWN" });
  eq(scr.status, 200, "the screener answers");
  const spy = scr.body.data.find((r) => r.ticker === "SPY");
  const lastSpy = a.pxBy[0].filter((e) => e.at + 0 <= a.clock.now()).pop();
  eq(spy.close, lastSpy.price.toFixed(4), "the screener close is the last price the log has delivered");
  eq(spy.quote_time, lastSpy.quoteTime, "with its own quote time");
  ok(spy.quote_time <= a.clock.now(), "which is never in the future");
  const first = await a.rest("/api/option-trades/flow-alerts", { limit: "200" });
  const newest = first.body.data[0].created_at;
  a.advance(5 * 60000);
  const second = await a.rest("/api/option-trades/flow-alerts", { limit: "200", newer_than: newest });
  ok(second.body.data.length > 0 && second.body.data.every((r) => Date.parse(r.created_at) > Date.parse(newest)), "a cursor returns only newer alerts");
  ok(first.body.data.length <= 200 && first.body.data.every((r, i) => i === 0 || Date.parse(r.created_at) <= Date.parse(first.body.data[i - 1].created_at)), "newest first, at most 200");
  const nw = await a.rest("/api/news/headlines", { limit: "100" });
  ok(nw.body.data.length > 0 && nw.body.data.every((h) => /^Synthetic /.test(h.headline)), "headlines are served");

  const t0 = a.clock.now();
  a.chaos.rest429 = [{ from: t0 + 1000, to: t0 + 40000, retryAfterS: 12 }];
  a.advance(2000);
  const limited = await a.rest("/api/news/headlines", {});
  eq([limited.status, limited.headers["Retry-After"]], [429, "12"], "a rate-limit window answers 429 with Retry-After");
  a.advance(60000);
  eq((await a.rest("/api/news/headlines", {})).status, 200, "and ends");
  a.chaos.restFault = "garbage";
  const bad = await a.fetch("http://sim.test/api/news/headlines");
  let parsed = true;
  try { await bad.json(); } catch { parsed = false; }
  ok(!parsed, "a malformed REST body does not parse");
  a.chaos.restFault = null;
  a.advance(61000);
  a.chaos.restPerMinute = 3;
  const st = [];
  for (let k = 0; k < 5; k++) st.push((await a.rest("/api/news/headlines", {})).status);
  ok(st.slice(0, 3).every((x) => x === 200) && st.slice(3).every((x) => x === 429), "a per-minute call budget turns the calls over it into 429s");
  a.chaos.restPerMinute = Infinity;
  const rest500 = createMarketSim({ seed: "sim-a", names: 24, chaos: { restFault: "500" } });
  eq((await rest500.rest("/api/news/headlines", {})).status, 500, "a vendor outage answers 500");

  const s1 = createMarketSim({ seed: "sock", names: 12 });
  const c1 = s1.connect({});
  const got = [];
  c1.onMessage((t) => got.push(t));
  c1.send(JSON.stringify({ channel: "price:SPY", msg_type: "join" }));
  c1.send(JSON.stringify({ channel: "stock_screener", msg_type: "join" }));
  c1.send(JSON.stringify({ channel: "flow-alerts", msg_type: "join" }));
  c1.send(JSON.stringify({ channel: "periscope:SPX", msg_type: "join" }));
  c1.send(JSON.stringify({ channel: "news", msg_type: "join" }));
  c1.send(JSON.stringify({ channel: "market_tide", msg_type: "join" }));
  eq(got.slice(0, 6).map((t) => JSON.parse(t)[1].status), ["ok", "error", "ok", "ok", "ok", "ok"], "joins are acknowledged and a refused channel is an error ack");
  s1.advance(10 * 60000);
  const msgs = got.slice(6).map((t) => JSON.parse(t));
  const px = msgs.filter(([ch]) => ch === "price:SPY").map(([, p]) => p);
  ok(px.length === 10 && px.every((p, i) => i === 0 || p.time > px[i - 1].time), "ten minutes of SPY prices arrive in quote-time order");
  ok(msgs.some(([ch]) => ch === "flow-alerts") && msgs.some(([ch]) => ch === "market_tide"), "alerts and the tide arrive on their channels");
  const snaps = new Map();
  for (const [ch, p] of msgs) if (ch === "periscope:SPX") snaps.set(p.snapshot, (snaps.get(p.snapshot) || 0) + 1);
  ok([...snaps.values()].every((n) => n === 3) && snaps.size >= 9, "every index-book snapshot is complete");
  const price = JSON.parse(got.find((t) => t.startsWith('["price:SPY"') && !t.includes("status")))[1];
  eq(price.ticker, "SPY", "payloads carry the ticker");

  const caps = createMarketSim({ seed: "caps", names: 12, chaos: { maxJoinsPerConnection: 2, maxConnections: 2 } });
  const k1 = caps.connect({}), k2 = caps.connect({});
  const acks = [];
  k1.onMessage((t) => acks.push(JSON.parse(t)[1].status));
  for (const ch of ["price:SPY", "price:QQQ", "price:IWM"]) k1.send(JSON.stringify({ channel: ch, msg_type: "join" }));
  eq(acks, ["ok", "ok", "error"], "joins past the per-connection cap are refused");
  eq(caps.connect({}).error.status, 429, "connections past the cap are refused");
  k2.close();
  ok(!caps.connect({}).error, "and a closed one frees its place");

  const silent = createMarketSim({ seed: "silent", names: 12, chaos: { silentChannels: ["news"] } });
  const sc = silent.connect({});
  const sgot = [];
  sc.onMessage((t) => sgot.push(JSON.parse(t)));
  sc.send(JSON.stringify({ channel: "news", msg_type: "join" }));
  sc.send(JSON.stringify({ channel: "market_tide", msg_type: "join" }));
  silent.advance(30 * 60000);
  eq([sgot[0][1].status, sgot.filter(([ch]) => ch === "news" && !("status" in sgot[0][1] && sgot[0][0] === ch && false)).length], ["ok", 1], "a channel that acks and never delivers sends only its ack");
  ok(sgot.filter(([ch]) => ch === "market_tide").length > 20, "while another channel on the same connection flows");

  const missing = createMarketSim({ seed: "missing", names: 12, chaos: { dropPeriscopeFrame: { snapshot: 4, frame: 1 } } });
  const mc = missing.connect({});
  const mgot = [];
  mc.onMessage((t) => mgot.push(JSON.parse(t)));
  mc.send(JSON.stringify({ channel: "periscope:SPX", msg_type: "join" }));
  missing.advance(10 * 60000);
  const per = new Map();
  for (const [ch, p] of mgot) if (ch === "periscope:SPX") per.set(p.snapshot, (per.get(p.snapshot) || 0) + 1);
  eq([per.get(4), per.get(3), per.get(5)], [2, 3, 3], "a dropped periscope frame leaves exactly one snapshot incomplete");

  const SIM_OPEN = createMarketSim({ seed: "open", names: 2 }).open;
  const messy = createMarketSim({ seed: "messy", names: 12, chaos: { duplicateRate: 0.2, reorderWithinMs: 500, malformedRate: 0.05, lagSpikes: [{ from: SIM_OPEN + 5 * 60000, to: SIM_OPEN + 6 * 60000, extraMs: 30000 }] } });
  const xc = messy.connect({});
  const xgot = [];
  xc.onMessage((t) => xgot.push({ t, at: messy.clock.now() }));
  xc.send(JSON.stringify({ channel: "price", msg_type: "join" }));
  messy.advance(20 * 60000);
  let unparsable = 0, dup = 0, inversions = 0, maxLate = 0;
  const seen = new Set();
  let prev = -Infinity;
  for (const m of xgot.slice(1)) {
    let parsed;
    try { parsed = JSON.parse(m.t); } catch { unparsable++; continue; }
    const key = parsed[0] + parsed[1].ticker + parsed[1].time;
    if (seen.has(key)) dup++; else seen.add(key);
    if (parsed[1].time < prev) inversions++;
    prev = Math.max(prev, parsed[1].time);
  }
  ok(unparsable > 5 && dup > 20 && inversions > 20, `malformed frames (${unparsable}), duplicates (${dup}) and reorders (${inversions}) are injected`);
  void maxLate;
  const clean = createMarketSim({ seed: "messy", names: 12 });
  const cc = clean.connect({});
  const cgot = [];
  cc.onMessage((t) => cgot.push(JSON.parse(t)));
  cc.send(JSON.stringify({ channel: "price", msg_type: "join" }));
  clean.advance(10 * 60000);
  const times = cgot.slice(1).map(([, p]) => p.time);
  ok(times.every((t, i) => i === 0 || t >= times[i - 1] - 5000), "without chaos the stream is ordered to within the vendor's own jitter");

  const lagged = createMarketSim({ seed: "lag", names: 12 });
  lagged.chaos.lagSpikes = [{ from: lagged.open + 2 * 60000, to: lagged.open + 3 * 60000, extraMs: 20000 }];
  const lc = lagged.connect({});
  const lgot = [];
  lc.onMessage((t) => lgot.push({ at: lagged.clock.now(), msg: JSON.parse(t) }));
  lc.send(JSON.stringify({ channel: "price:SPY", msg_type: "join" }));
  for (let k = 0; k < 20 * 12; k++) lagged.advance(5000);
  const delays = lgot.slice(1).map((m) => m.at - m.msg[1].time);
  ok(Math.max(...delays) > 20000 && Math.min(...delays) < 6000, "a lag spike delays the frames it covers by its extra and the rest are on time");

  const skewed = createMarketSim({ seed: "skew", names: 12, chaos: { clockSkewMs: 7000 } });
  const plain = createMarketSim({ seed: "skew", names: 12 });
  skewed.advance(5 * 60000); plain.advance(5 * 60000);
  const sa = (await skewed.rest("/api/screener/stocks", { ticker: "SPY" })).body.data[0], pa = (await plain.rest("/api/screener/stocks", { ticker: "SPY" })).body.data[0];
  eq(sa.quote_time - pa.quote_time, 7000, "clock skew shifts the vendor's stamps and nothing else");
  eq(sa.close, pa.close, "and not the price");

  const dropper = createMarketSim({ seed: "drop", names: 12, chaos: { drops: [{ conn: 0, at: 0 }], stalls: [{ conn: 1, from: 0, to: 0 }] } });
  const d0 = dropper.connect({});
  let closed = null, dgot = 0;
  d0.onClose((e) => { closed = e; });
  d0.onMessage(() => { dgot++; });
  d0.send(JSON.stringify({ channel: "price:SPY", msg_type: "join" }));
  dropper.chaos.drops = [{ conn: 0, at: dropper.open + 3 * 60000 }];
  dropper.advance(10 * 60000);
  ok(closed && closed.code === 1006 && dgot >= 3 && dgot <= 6, `a dropped connection closes with 1006 and no close frame after ${dgot} messages`);
  const staller = createMarketSim({ seed: "stall", names: 12 });
  const s0 = staller.connect({});
  const stalled = [];
  s0.onMessage((t) => stalled.push({ at: staller.clock.now(), t }));
  s0.send(JSON.stringify({ channel: "price:SPY", msg_type: "join" }));
  staller.chaos.stalls = [{ conn: 0, from: staller.open, to: staller.open + 4 * 60000 }];
  for (let k = 0; k < 6; k++) staller.advance(60000);
  const burst = stalled.slice(1);
  ok(burst.length >= 5 && burst.slice(0, 4).every((m) => m.at >= staller.open + 4 * 60000), "a stalled connection delivers nothing until the stall ends, then a burst");

  const a2 = createMarketSim({ seed: "det", names: 12, chaos: { duplicateRate: 0.2, reorderWithinMs: 400 } }), b2 = createMarketSim({ seed: "det", names: 12, chaos: { duplicateRate: 0.2, reorderWithinMs: 400 } });
  const run = (s) => { const out = []; const k = s.connect({}); k.onMessage((t) => out.push(t)); k.send(JSON.stringify({ channel: "price", msg_type: "join" })); s.advance(5 * 60000); return out; };
  eq(run(a2), run(b2), "the same seed and the same chaos deliver the same bytes");

  const live = createMarketSim({ seed: "live", names: 12 });
  const server = await live.listen();
  try {
    const ws = new WebSocket(server.url + "?token=x");
    const frames = [];
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = (e) => frames.push(JSON.parse(e.data));
    ws.send(JSON.stringify({ channel: "price:SPY", msg_type: "join" }));
    await new Promise((r) => setTimeout(r, 50));
    live.advance(3 * 60000);
    await new Promise((r) => setTimeout(r, 80));
    ws.close();
    eq(frames[0][1].status, "ok", "a real WebSocket joins the simulated vendor");
    ok(frames.filter(([ch, p]) => ch === "price:SPY" && p.ticker === "SPY").length === 3, "and receives its prices over the wire");
    const res = await fetch(server.httpUrl + "/api/news/headlines");
    eq(res.status, 200, "the same server answers the REST routes");
  } finally { server.close(); }
});

await section("kill-matrix", async () => {
  const rows = await runKillMatrix();
  const width = Math.max(...rows.map((r) => r.id.length));
  for (const r of rows) {
    log(r.armed
      ? `${r.id.padEnd(width)}  baseline ${r.baselineOk ? "passes" : "FAILS"}  planted wrong build ${r.killed ? "KILLED" : "SURVIVED"}  [${r.mutatedNote}]`
      : `${r.id.padEnd(width)}  pending: ${r.why}`);
  }
  for (const r of rows.filter((x) => x.armed)) {
    ok(r.baselineOk, `${r.id}: the detector passes the correct build (${r.baselineNote})`);
    ok(r.killed, `${r.id}: a planted wrong build is killed (${r.mutatedNote})`);
  }
  const armed = rows.filter((r) => r.armed);
  ok(armed.length >= 22, `${armed.length} mutants are armed`);
  ok(rows.length >= 24, `${rows.length} mutants are registered, ${rows.length - armed.length} waiting for their targets`);
  for (const id of LAUNCH_MUTANTS) ok(rows.some((r) => r.id === id), `the launch mutant ${id} is registered`);
  eq(LAUNCH_MUTANTS.length, 18, "eighteen mutants at launch");
  for (const id of PLANTED_WRONG_DETECTORS) {
    const r = rows.find((x) => x.id === id);
    ok(r && r.armed && r.killed, `the planted wrong detector ${id} is killed`);
  }
  for (const r of rows.filter((x) => !x.armed)) log(`${r.id}: ${r.why}`);
  eq(new Set(MUTANTS.map((m) => m.id)).size, MUTANTS.length, "every mutant has its own id");
  let notApplied = false;
  try { await loadMutated("tests/truth/reference.mjs", [["this text is nowhere in the module", "x"]]); } catch (e) { notApplied = /did not apply/.test(e.message); }
  ok(notApplied, "a mutant whose text does not match exactly once fails loudly instead of passing as a no-op");
});

if (flags.length) console.log(`deep lane flagged ${flags.length} section(s): ${flags.join(" | ")}`);
console.log(`✓ flows-truth: ${n} assertions — one seeded generator whose streams, tail laws and exact scores equal independent scipy references, ` +
  "W1 characterised against the measured bias table of today's GARCH (and today's clip in the filter judged outside the oracle band in an out-of-family world), " +
  "W4 look-ahead bait power, W3 marked Hawkes flow and W3b flow counts (whose fixed-level null reproduces the independent numpy crossing rates), W5 open-interest lag, W6 overfitting null, W7 calibration and W8 overlap worlds, a runner that cannot accept a well-specified result or run without an out-of-family judgement world, " +
  "and a kill matrix in which every planted wrong build is caught while the correct build passes");
