import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as garch from "../shared/flows-garch.js";
import { makeRng, seedWords, normalQuantile, normalSurvival, normalCdf } from "./truth/rng.mjs";
import { hansen, w1Garch, w4Bait, w5OiLag, w6Null, w7Calibration, indicatorCorrelation, w8Overlap, w8Errors, nextBusinessDay, probitMean, WORLDS } from "./truth/worlds.mjs";
import { mean, variance, sd, autocorrelation, ksUniform } from "./truth/stats.mjs";
import { MODES, NotJudged, NoJudgementList, cell, accept, judge, formatRow } from "./truth/runner.mjs";
import { MUTANTS, runKillMatrix, loadMutated } from "./truth/mutants.mjs";
import * as reference from "./truth/reference.mjs";
import { SCALE, W1_BANDS, measureW1Bands, tailLawCell, logScore, leakBound, oiLag, trialCount } from "./truth/detectors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(path.join(HERE, "fixtures-truth.json"), "utf8"));

let n = 0;
const flags = [];
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); n++; };
const rel = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${m}: ${a} vs ${b} (relative tol ${tol})`); n++; };
const log = (line) => console.log("  " + line);

async function section(name, fn) {
  const before = n;
  try {
    await fn();
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
  baseBands = measureW1Bands(garch, { reps: 120 * SCALE.factor });
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

await section("w5", () => {
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
  const verdict = oiLag(reference);
  ok(verdict.ok, "the as-of reader passes the open-interest bait: " + verdict.note);
  log("W5: " + verdict.note);
});

await section("w6", () => {
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
  const verdict = trialCount(reference);
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
  eq(Object.keys(WORLDS).sort(), ["W1", "W4", "W5", "W6", "W7", "W8"], "the worlds registered so far");
  const a = w1Garch({ seed: "det", n: 100 }), b = w1Garch({ seed: "det", n: 100 });
  eq(Array.from(a.r), Array.from(b.r), "a world is a pure function of its seed");
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
  ok(rows.filter((r) => r.armed).length >= 12, "twelve mutants are armed by the second pull request");
  eq(new Set(MUTANTS.map((m) => m.id)).size, MUTANTS.length, "every mutant has its own id");
  let notApplied = false;
  try { await loadMutated("tests/truth/reference.mjs", [["this text is nowhere in the module", "x"]]); } catch (e) { notApplied = /did not apply/.test(e.message); }
  ok(notApplied, "a mutant whose text does not match exactly once fails loudly instead of passing as a no-op");
});

if (flags.length) console.log(`deep lane flagged ${flags.length} section(s): ${flags.join(" | ")}`);
console.log(`✓ flows-truth: ${n} assertions — one seeded generator whose streams, tail laws and exact scores equal independent scipy references, ` +
  "W1 characterised against the measured bias table of today's GARCH (and today's clip in the filter judged outside the oracle band in an out-of-family world), " +
  "W4 look-ahead bait power, W5 open-interest lag, W6 overfitting null, W7 calibration and W8 overlap worlds, a runner that cannot accept a well-specified result or run without an out-of-family judgement world, " +
  "and a kill matrix in which every planted wrong build is caught while the correct build passes");
