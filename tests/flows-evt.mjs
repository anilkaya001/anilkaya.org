import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as E from "../shared/flows-evt.js";
import { makeRng } from "./truth/rng.mjs";
import { w1dWorld, w1mWorld, w2World, W1_PRODUCTION, WORLDS } from "./truth/worlds.mjs";
import * as M from "./lib/evt-measure.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANDS_PATH = path.join(HERE, "fixtures-moves-bands.json");
const DEEP = process.env.FLOWS_EVT_DEEP === "1";
const SEEDS_PUBLISHED = 400;
const SEEDS_CI = DEEP ? SEEDS_PUBLISHED : 100;

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tolerance ${tol})`); checks++; };
const throwsLike = (fn, pattern, m) => { assert.throws(fn, pattern, m); checks++; };
const log = (line) => console.log(`  ${line}`);

const read = (name) => JSON.parse(fs.readFileSync(path.join(HERE, name), "utf8"));

const roundTrip = (x) => JSON.parse(JSON.stringify(x));

export function measurePublished(seeds = SEEDS_PUBLISHED) {
  const rhos = M.COVERAGE_RHOS;
  return {
    provenance: {
      generator: "node tests/flows-evt.mjs --write-bands",
      seeds,
      salt: "fixed",
      world: { ...M.WORLD, quantile: M.QUANTILE },
      trueModel: { ...W1_PRODUCTION },
      note: "observed over predicted exceedances of k conditional standard deviations in the production-class GARCH world, per seed (750 sessions) and per ten pooled seeds; the same ratio for the 60 names of the dependent daily world against the centre of its own replicates; the profile-likelihood interval of the pooled shape, nominal 90%, covering the centre of the estimator in the same world (coverage) and the centre in the independent-names world (coverageVsIndependent).",
    },
    trueModel: { single: M.trueModelBands({ seeds, pool: 1 }), pooled10: M.trueModelBands({ seeds, pool: 10 }) },
    dependent: Object.fromEntries(rhos.map((rho) => [String(rho), M.dependentBands({ rho, seeds })])),
    coverage: Object.fromEntries(["unclustered", "sandwich", "jackknife"].map((name) => [name, rhos.map((rho) => ({ ...M.coverageStudy({ rho, seeds, intervals: [name] }), by: undefined }))])),
  };
}

if (process.argv.includes("--write-bands")) {
  const out = measurePublished();
  fs.writeFileSync(BANDS_PATH, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${BANDS_PATH}`);
  process.exit(0);
}

const gpdSample = (rng, n, xi, beta) => Float64Array.from({ length: n }, () => E.gpdIsf(rng.uniform(), xi, beta));

{
  const fx = read("fixtures-moves-gpd.json");
  const gen = fs.readFileSync(path.join(HERE, "gen-moves-fixtures.py"));
  eq(fx.provenance.generator, "tests/gen-moves-fixtures.py", "provenance: the fixture names its generator");
  eq(fx.provenance.generatorSha256, createHash("sha256").update(gen).digest("hex"), "provenance: and the generator's hash, so an edited generator without regenerated fixtures fails here");
  ok(/^1\.|^2\./.test(fx.provenance.numpy) && /^1\./.test(fx.provenance.scipy), "and the library versions that wrote it");

  for (const c of fx.gpd) {
    const y = Float64Array.from(c.y);
    const fit = E.fitGpd(y);
    near(fit.xi, c.fit.xi, 1e-3, `GPD MLE n ${c.n} xi ${c.trueXi}: the shape is within 1e-3 of the scipy-polished reference`);
    near(fit.beta, c.fit.beta, 1e-3 * Math.max(1, c.fit.beta), `GPD MLE n ${c.n} xi ${c.trueXi}: and so is the scale`);
    near(fit.xi, c.fit.scipyXi, 1e-3, `n ${c.n} xi ${c.trueXi}: and scipy's own fit`);
    near(fit.nll, c.fit.nll, 1e-6, `n ${c.n} xi ${c.trueXi}: the maximised negative log-likelihood`);
    const iv = E.profileInterval(y, fit, { level: 0.9 });
    near(iv.lo, c.interval90[0], 2e-4, `n ${c.n} xi ${c.trueXi}: the 90% profile interval's lower end`);
    near(iv.hi, c.interval90[1], 2e-4, `n ${c.n} xi ${c.trueXi}: and its upper end`);
    ok(iv.lo < fit.xi && fit.xi < iv.hi, "the interval holds the estimate");
  }
  for (const c of fx.pooled) {
    const groups = c.groups.map((g) => Float64Array.from(g));
    const fit = E.pooledShape(groups);
    near(fit.xi, c.xi, 1e-5, `pooled shape over ${c.groups.length} names equals the bounded minimisation of the concentrated likelihood`);
    near(fit.nll, c.nll, 1e-6, "and its likelihood");
    eq(fit.n, c.n, "over the same exceedance count");
    const iv = E.pooledInterval(groups, fit);
    near(iv.lo, c.interval90[0], 2e-4, "the pooled 90% interval's lower end");
    near(iv.hi, c.interval90[1], 2e-4, "and upper end");
  }
}

{
  eq(E.gpdSf(0, 0.2, 1), 1, "the survival at zero is one");
  near(E.gpdSf(2, 0, 1), Math.exp(-2), 1e-15, "xi zero is the exponential");
  near(E.gpdSf(2, 1e-9, 1), Math.exp(-2), 1e-8, "and xi near zero is continuous with it");
  near(E.gpdSf(2, -0.3, 1), Math.pow(1 - 0.6, 1 / 0.3), 1e-12, "a negative shape follows the closed form");
  eq(E.gpdSf(4, -0.3, 1), 0, "and has zero mass beyond its end point");
  for (const [xi, beta] of [[0.2, 1.5], [0, 2], [-0.2, 1], [0.5, 0.7]]) {
    for (const p of [0.5, 0.1, 0.01, 0.001]) near(E.gpdSf(E.gpdIsf(p, xi, beta), xi, beta), p, 1e-12, `isf and sf are inverses at xi ${xi}, p ${p}`);
  }
  eq(E.gpdIsf(0, 0.2, 1), null, "no quantile at probability zero");
  eq(E.gpdNegLogLik(Float64Array.from([1, 5]), -0.5, 1), Infinity, "a point beyond the support has no likelihood");
  eq(E.gpdNegLogLik(Float64Array.from([1]), 0.2, -1), Infinity, "and a non-positive scale none");
  near(E.gpdNegLogLik(Float64Array.from([1, 2, 3]), 0, 2), 3 * Math.log(2) + 3, 1e-12, "the exponential likelihood is n ln beta plus the mean excess");
  eq(E.fitGpd(Float64Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])), null, "a sample of identical excesses has no fit");
  eq(E.fitGpd(Float64Array.from([1, 2, 3])), null, "and one under 20 points none");
  eq(E.fitGpd([NaN, -1, 0, null]), null, "non-positive and non-finite points are dropped, not read as zeros");
  eq(E.pooledShape([]), null, "no groups, no pooled shape");
  eq(E.profileInterval([1, 2]), null, "no sample, no interval");
  throwsLike(() => E.profileInterval(Float64Array.from({ length: 30 }, (_, i) => 1 + i), null, { level: 0.8 }), /level/, "only the 90% and 95% levels are tabulated");
  const rng = makeRng("evt|brent");
  const r = E.brentMin((x) => (x - 0.3) ** 2 + 1, -2, 2);
  near(r.x, 0.3, 1e-8, "brentMin finds the minimum of a parabola");
  const ex = E.exceedances([1, -4, 2, 5, -3, 0.5, 6, 1.5, 2.5, 0.2], 0.7);
  eq(ex.threshold, 3, "the threshold is the sample quantile of the absolute values by the index rule the oracle uses");
  eq(Array.from(ex.y), [1, 2, 3], "and the excesses are what lies strictly above it");
  eq(Array.from(ex.index), [1, 3, 6], "with the position of each");
  eq(E.exceedances([NaN, null], 0.9).y.length, 0, "a series of non-numbers has no excess");
  eq(E.exceedanceGroups([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], []], { q: 0.5 }).length, 1, "an empty series makes no group");
  ok(rng.uniform() > 0, "the seeded generator draws");
}

{
  const n = 2000;
  const rng = makeRng("evt|profile-coverage");
  let covered = 0;
  let ran = 0;
  for (let r = 0; r < n; r++) {
    const y = gpdSample(rng, 200, 0.2, 1.5);
    const fit = E.fitGpd(y);
    const iv = E.profileInterval(y, fit);
    if (!fit || !iv || iv.open) continue;
    ran++;
    if (iv.lo <= 0.2 && 0.2 <= iv.hi) covered++;
  }
  const c = covered / ran;
  log(`one name, n 200, xi 0.2: the 90% profile interval covers ${(100 * c).toFixed(1)}% of ${ran} samples`);
  ok(c >= 0.88 && c <= 0.92, `PROFILE COVERAGE: ${(100 * c).toFixed(1)}% over ${ran} samples is inside 88 to 92`);
  const wald = (() => {
    const rng2 = makeRng("evt|profile-coverage|wald");
    let hit = 0;
    for (let r = 0; r < 600; r++) {
      const y = gpdSample(rng2, 200, 0.2, 1.5);
      const fit = E.fitGpd(y);
      if (Math.abs(fit.xi - 0.2) <= 1.645 * fit.se.xi) hit++;
    }
    return hit / 600;
  })();
  ok(wald > 0.8 && wald < 0.95, `the Wald interval from the same fit covers ${(100 * wald).toFixed(0)}%, a different and cruder interval`);
}

{
  const reps = 30;
  const rng = makeRng("evt|pooled-heterogeneous");
  let sum = 0;
  let sumIv = 0;
  let exceedCount = 0;
  const xis = [];
  const ivs = [];
  for (let r = 0; r < reps; r++) {
    const groups = M.heterogeneousGroups({ names: 32, per: 100, xi: 0.2, seed: `evt|het|${r}` });
    exceedCount = groups.reduce((a, g) => a + g.length, 0);
    const fit = E.pooledShape(groups);
    xis.push(fit.xi);
    sum += fit.xi;
    if (r < 12) {
      const iv = M.inverseVarianceShape(groups);
      ivs.push(iv);
      sumIv += iv;
    }
  }
  const mean = sum / reps;
  const meanIv = sumIv / ivs.length;
  eq(exceedCount, 3200, "3,200 pooled exceedances in 32 names");
  log(`3,200 pooled exceedances, scales spread by a log-normal of SD 0.7: pooled shape ${mean.toFixed(3)} over ${reps} runs against truth 0.2; an inverse-variance weighted mean of the per-name shapes ${meanIv.toFixed(3)}`);
  ok(Math.abs(mean - 0.2) <= 0.02, `POOLED SHAPE: ${mean.toFixed(4)} is within 0.02 of the truth 0.2`);
  ok(Math.abs(meanIv - 0.2) > 0.02, `INVERSE-VARIANCE WEIGHTS FAIL THE BAND: ${meanIv.toFixed(4)} is further than 0.02 from 0.2, because the weight of a name is larger when its shape estimate is smaller`);
  ok(meanIv < mean - 0.02, "and lower than the pooled shape");
  const profiled = E.pooledShape(M.heterogeneousGroups({ names: 32, per: 100, xi: 0.2, seed: "evt|het|0" }), { scale: "profile" });
  ok(profiled.xi > 0.1 && profiled.xi < 0.3, "the exact profile-scale variant is available and lands near the same value");
  const same = E.pooledShape(M.heterogeneousGroups({ names: 4, per: 60, xi: 0.2, seed: "evt|het|small" }));
  ok(same.names === 4 && same.n === 240, "the fit reports its names and exceedance count");
}

{
  const w = w1dWorld({ seed: "evt|w1d|default|0", names: 4, days: 50 });
  const again = w1dWorld({ seed: "evt|w1d|default|0", names: 4, days: 50 });
  eq(Array.from(w.r), Array.from(again.r), "the dependent world is a pure function of its seed");
  const sectors = w1dWorld({ seed: "evt|w1d|sectors", names: 40, days: 3000, rho: 0.2, sectors: 4, sectorRho: 0.3 });
  const corr = (i, j) => {
    let sxy = 0, sxx = 0, syy = 0;
    for (let t = 0; t < sectors.days; t++) { const x = sectors.r[i * sectors.days + t], y = sectors.r[j * sectors.days + t]; sxy += x * y; sxx += x * x; syy += y * y; }
    return sxy / Math.sqrt(sxx * syy);
  };
  near(corr(0, 4), 0.5, 0.05, "two names of one sector correlate at the market weight plus the sector weight");
  near(corr(0, 1), 0.2, 0.05, "and two names of different sectors at the market weight alone");
  const volatile = w1dWorld({ seed: "evt|w1d|shock", names: 30, days: 4000, rho: 0, volShock: 0.5 });
  const dayVar = Array.from({ length: volatile.days }, (_, t) => { let s = 0; for (let i = 0; i < volatile.names; i++) s += volatile.r[i * volatile.days + t] ** 2; return s / volatile.names; });
  const mean = dayVar.reduce((a, b) => a + b) / dayVar.length;
  const sd = Math.sqrt(dayVar.reduce((a, b) => a + (b - mean) ** 2, 0) / dayVar.length);
  ok(sd / mean > 0.5, `a common volatility shock makes the cross-sectional variance of a day move together (coefficient of variation ${(sd / mean).toFixed(2)})`);
  const scaled = w1dWorld({ seed: "evt|w1d|scale", names: 30, days: 200, scaleSd: 0.7 });
  ok(Math.max(...scaled.scale) / Math.min(...scaled.scale) > 3, "per-name scales are spread by a log-normal");
  eq(w1dWorld({ seed: "evt|w1d|x", names: 3, days: 20 }).scale.every((v) => v === 1), true, "and are one with the option off");
}

const published = read("fixtures-moves-bands.json");

{
  eq(published.provenance.seeds, SEEDS_PUBLISHED, "PUBLISHED: the committed bands are 400 seeds");
  eq(published.provenance.world, { ...M.WORLD, quantile: M.QUANTILE }, "of the 60-name, 500-day, nu 5 world at the 92.5% quantile");
  eq(published.provenance.trueModel, roundTrip({ ...W1_PRODUCTION }), "and the production-class true model");
  const single = M.trueModelBands({ seeds: SEEDS_PUBLISHED, pool: 1 });
  const pooled = M.trueModelBands({ seeds: SEEDS_PUBLISHED, pool: 10 });
  eq(roundTrip(single), published.trueModel.single, "the true model's single-seed bands are what the code measures now, to the digit");
  eq(roundTrip(pooled), published.trueModel.pooled10, "and so are its ten-seed bands");
  for (const k of ["3", "4", "5", "6"]) {
    const s = single[k];
    const p = pooled[k];
    ok(s.p05 <= 1 && 1 <= s.p95 || k === "6", `k ${k}: one seed's band holds 1 (${s.p05.toFixed(2)} to ${s.p95.toFixed(2)})`);
    ok(p.p95 - p.p05 < s.p95 - s.p05, `k ${k}: pooling ten seeds narrows the band (${(p.p95 - p.p05).toFixed(2)} against ${(s.p95 - s.p05).toFixed(2)})`);
    ok(Math.abs(p.p50 - 1) < 0.15, `k ${k}: the pooled median is near one (${p.p50.toFixed(2)})`);
    log(`true model k ${k}: predicted ${s.predicted.toExponential(2)}; one seed ${s.p05.toFixed(2)} to ${s.p95.toFixed(2)} (median ${s.p50.toFixed(2)}); ten seeds ${p.p05.toFixed(2)} to ${p.p95.toFixed(2)}`);
  }
  ok(single["6"].p95 - single["6"].p05 > single["3"].p95 - single["3"].p05, "a single seed's band is far wider at k 6 than at k 3");
  const width = (rho, k) => published.dependent[String(rho)][k].p95 - published.dependent[String(rho)][k].p05;
  ok(width(0.5, "4") > 1.5 * width(0, "4"), `DEPENDENCE WIDENS THE BAND: pooled over 60 names the k 4 band is ${width(0.5, "4").toFixed(2)} wide at rho 0.5 against ${width(0, "4").toFixed(2)} for independent names`);
  const fresh = M.dependentBands({ rho: 0.5, seeds: SEEDS_CI });
  near(fresh["4"].p50, published.dependent["0.5"]["4"].p50, 0.12, "a fresh run of the dependent bands agrees with the committed median");
}

{
  const cl = read("fixtures-moves-cluster.json");
  eq(cl.provenance.generatorSha256, createHash("sha256").update(fs.readFileSync(path.join(HERE, "gen-moves-fixtures.py"))).digest("hex"), "provenance: the cluster fixture was written by the committed generator");
  for (const c of cl.cluster) {
    const series = c.series.map((row) => Float64Array.from(row));
    const groups = E.exceedanceGroups(series, { q: c.q });
    const fit = E.pooledShape(groups);
    const sw = E.pooledClustered(groups, fit, { days: c.days });
    near(fit.xi, c.sandwich.xi, 1e-6, `${c.names} names: the pooled shape equals the reference`);
    near(fit.se, c.sandwich.modelSe, 1e-6, `${c.names} names: and its likelihood standard error`);
    near(sw.se, c.sandwich.se, 2e-5, `${c.names} names: the cluster-robust standard error equals the independent numpy one, written with numerical derivatives`);
    eq(sw.clusters, c.sandwich.clusters, `${c.names} names: over the same number of days with an exceedance`);
    const jk = E.pooledJackknife(series, { q: c.q, blocks: c.blocks });
    near(jk.se, c.jackknife.se, 1e-5, `${c.names} names: the delete-a-block jackknife standard error equals the reference`);
    eq(jk.estimates.length, c.blocks, "from one refit per block of days");
    jk.estimates.forEach((v, i) => near(v, c.jackknife.estimates[i], 1e-6, `block ${i} leave-out estimate`));
    ok(jk.lo < fit.xi && fit.xi < jk.hi, "the interval holds the estimate");
    near(jk.hi - jk.xi, E.tCritical95(c.blocks - 1) * jk.se, 1e-12, "and is the estimate plus or minus the t line on blocks - 1 degrees of freedom");
  }
  near(E.tCritical95(9), 1.8331129, 2e-4, "the t line at 9 degrees of freedom");
  near(E.tCritical95(19), 1.7291328, 1e-4, "and at 19");
  near(E.tCritical95(500), 1.6479, 1e-3, "and at 500");
  eq(E.tCritical95(0), null, "none below one");
  eq(E.pooledClustered([{ y: Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) }]), null, "groups with no date positions have no clustered variance");
  eq(E.pooledJackknife([Float64Array.from([1, 2, 3])], { blocks: 6 }), null, "a series shorter than twice the blocks has no jackknife");
  const shock = (u, xi, h = 1e-5) => {
    const y = u * (1 - xi);
    const l = (x) => -Math.log(1 - x) - (1 + 1 / x) * Math.log1p((x * y) / (1 - x));
    return (l(xi + h) - l(xi - h)) / (2 * h);
  };
  for (const [u, xi] of [[0.3, 0.2], [1.5, 0.1], [4, 0.35], [0.8, -0.1]]) near(E.shapeScore(u, xi), shock(u, xi), 5e-6, `the closed-form score matches the numerical derivative of the log density, the scale moving with the shape, at u ${u} xi ${xi}`);
  const boot = E.dateBootstrapShape(M.seriesOf(w1dWorld({ seed: "evt|boot", names: 20, days: 300, rho: 0.3 })), { reps: 30, seed: 5, block: 5 });
  ok(boot.reps === 30 && boot.se > 0 && boot.lo < boot.hi, "the date-block bootstrap resamples days in blocks and re-estimates every threshold");
  const again = E.dateBootstrapShape(M.seriesOf(w1dWorld({ seed: "evt|boot", names: 20, days: 300, rho: 0.3 })), { reps: 30, seed: 5, block: 5 });
  eq(again.estimates, boot.estimates, "and is a pure function of its seed");
  eq(E.dateBootstrapShape([], {}), null, "no series, no bootstrap");
}

{
  const t = published.coverage;
  const row = (kind, rho) => t[kind].find((r) => r.rho === rho);
  const fresh = new Map();
  for (const rho of [0, 0.3, 0.5]) {
    const names = rho === 0 ? ["unclustered"] : ["unclustered", "sandwich", "jackknife"];
    fresh.set(rho, M.coverageStudy({ rho, seeds: SEEDS_CI, intervals: names }));
  }
  for (const [rho, f] of fresh) {
    for (const [name, got] of Object.entries(f.by)) {
      const c = row(name, rho).coverage;
      const tol = 3 * Math.sqrt(c * (1 - c) * (1 / f.seeds + 1 / row(name, rho).seeds)) + 0.02;
      near(got.coverage, c, tol, `W1d rho ${rho} ${name}: a fresh ${f.seeds}-seed coverage agrees with the committed ${row(name, rho).seeds}-seed one`);
      log(`W1d rho ${rho}: ${name} 90% interval covers ${(100 * got.coverage).toFixed(0)}% (${(100 * c).toFixed(0)}% over ${row(name, rho).seeds}); against the independent-names centre ${(100 * got.coverageVsIndependent).toFixed(0)}%; width ${got.width.toFixed(3)}; shape ${f.xiMean.toFixed(3)} with SD ${f.xiSd.toFixed(3)}`);
    }
  }
  const u = (rho) => fresh.get(rho).by.unclustered.coverage;
  const j = (rho) => fresh.get(rho).by.jackknife.coverage;
  ok(u(0) >= 0.8 && u(0) <= 0.96, "independent names: the pooled likelihood interval is close to nominal");
  ok(u(0.3) < 0.8 && u(0.5) < 0.5, `NEGATIVE CONTROL: the unclustered likelihood interval covers ${(100 * u(0.3)).toFixed(0)}% at a market weight of 0.3 and ${(100 * u(0.5)).toFixed(0)}% at 0.5`);
  ok(j(0.3) >= 0.85 && j(0.3) <= 0.95, `DATE-CLUSTERED: at a market weight of 0.3 the jackknife interval covers ${(100 * j(0.3)).toFixed(0)}%, inside 85 to 95`);
  const jackknife05 = row("jackknife", 0.5).coverage;
  ok(j(0.5) >= 0.7 && jackknife05 >= 0.7, `at 0.5 it covers ${(100 * j(0.5)).toFixed(0)}% (${(100 * jackknife05).toFixed(0)}% over ${row("jackknife", 0.5).seeds}), below the 85 to 95 line: the shape's sampling distribution there is dominated by the few extreme market days of a 500-day sample and no variance estimate built from that sample sees the days it did not draw`);
  ok(j(0.5) > u(0.5) + 0.3, "but is more than 30 points above the unclustered interval");
  ok(fresh.get(0.5).by.sandwich.coverage > u(0.5) + 0.2, "and so is the cheaper score sandwich");
  ok(fresh.get(0.5).by.jackknife.design > fresh.get(0.3).by.jackknife.design && fresh.get(0.3).by.jackknife.design > 1, `the design effect grows with the factor (${fresh.get(0.3).by.jackknife.design.toFixed(1)} at 0.3, ${fresh.get(0.5).by.jackknife.design.toFixed(1)} at 0.5)`);
  ok(row("unclustered", 0.5).coverage < row("unclustered", 0.3).coverage && row("unclustered", 0.3).coverage < row("unclustered", 0).coverage, "the unclustered shortfall grows with the factor");
  ok(row("unclustered", 0.5).xiMean < row("unclustered", 0).xiMean - 0.02, "the pooled shape itself is biased down under dependence: a threshold that is a sample quantile absorbs the common events");
}

{
  const tf = read("fixtures-moves-tail.json");
  eq(tf.provenance.generatorSha256, createHash("sha256").update(fs.readFileSync(path.join(HERE, "gen-moves-fixtures.py"))).digest("hex"), "provenance: the tail fixture was written by the committed generator");
  const x = tf.hill.x;
  for (const r of tf.hill.rows) {
    const h = E.hill(x, r.k);
    near(h.xi, r.xi, 1e-10, `Hill at k ${r.k} equals numpy`);
    near(h.se, r.xi / Math.sqrt(r.k), 1e-12, "with the standard error xi over the root of k");
  }
  ok(tf.hill.rows.every((r) => r.xi > 0.1 && r.xi < 0.45), "on a Student t(4) sample (tail index 0.25) the Hill estimates are near it");
  eq(E.hill(x, 1), null, "Hill needs k of at least 2");
  eq(E.hill([1, 2, 3], 5), null, "and fewer points than k gives none");
  eq(E.hillCurve(x, [30, 100, 5000]).length, 2, "a curve drops the k it cannot compute");
  const us = tf.meanExcess.map((r) => r.u);
  E.meanExcess(x, us).forEach((r, i) => {
    near(r.e, tf.meanExcess[i].e, 1e-10, `mean excess over ${us[i].toFixed(2)}`);
    near(r.se, tf.meanExcess[i].se, 1e-10, "and its standard error");
    eq(r.n, tf.meanExcess[i].n, "over the same count");
  });
  eq(E.meanExcess([1, 2, 3], [5])[0], { u: 5, n: 0, e: null, se: null }, "a threshold with nothing above it has no mean excess, not a zero");
  const rng = makeRng("evt|mean-excess");
  const gp = gpdSample(rng, 20000, 0.25, 1);
  const rows = E.meanExcess(gp, [0.5, 1, 1.5, 2, 3, 4, 5]);
  const shape = E.meanExcessShape(rows);
  near(shape.xi, 0.25, 0.05, "the slope of the mean-excess line of a generalised Pareto sample is xi over 1 - xi");
  eq(E.meanExcessShape(rows.slice(0, 2)), null, "and two points have none");
  const series = tf.stability.series.map((row) => Float64Array.from(row));
  const st = E.thresholdStability(series, tf.stability.rows.map((r) => r.q));
  st.rows.forEach((r, i) => {
    near(r.xi, tf.stability.rows[i].xi, 1e-6, `threshold stability at q ${r.q}: the pooled shape`);
    near(r.se, tf.stability.rows[i].se, 1e-6, "and its standard error");
    eq(r.n, tf.stability.rows[i].n, "and its exceedance count");
  });
  ok(st.stableFrom !== null, "a stable region is named");
  const kinked = Array.from({ length: 24 }, (_, i) => {
    const r = makeRng(`evt|kink|${i}`);
    return Float64Array.from({ length: 1500 }, () => {
      const u = r.uniform();
      return u < 0.8 ? Math.abs(r.normal()) * 0.5 : 1.2 + E.gpdIsf(r.uniform(), 0.3, 0.6);
    });
  });
  const kink = E.thresholdStability(kinked, [0.5, 0.65, 0.8, 0.85, 0.9, 0.95], { scale: "profile" });
  ok(kink.stableFrom >= 0.8, `UNSTABLE BELOW THE JOIN: a body that is not Pareto below the 80th percentile is stable only from q ${kink.stableFrom}`);
  const flat = E.thresholdStability(Array.from({ length: 24 }, (_, i) => { const r = makeRng(`evt|flat|${i}`); return gpdSample(r, 1500, 0.3, 1); }), [0.5, 0.65, 0.8, 0.9, 0.95], { scale: "profile" });
  eq(flat.stableFrom, 0.5, "and an exactly Pareto world is stable from the lowest threshold");
}

{
  const tf = read("fixtures-moves-tail.json");
  const sample = tf.hill.x;
  for (const ref of tf.semiParametric) {
    const law = E.semiParametricLaw(sample, { tail: ref.tail, absolute: ref.absolute });
    const label = ref.absolute ? "absolute" : "signed";
    near(law.upper.xi, ref.upper.xi, 1e-3, `${label} law: the upper tail shape equals the reference`);
    near(law.upper.beta, ref.upper.beta, 1e-3, `${label} law: and scale`);
    eq(law.upper.n, ref.upper.n, `${label} law: over the same excesses`);
    if (!ref.absolute) near(law.lower.xi, ref.lower.xi, 1e-3, "and the lower tail shape");
    for (const r of ref.sf) near(law.sf(r.x), r.sf, 2e-5 + 1e-3 * r.sf, `${label} law: sf at ${r.x.toFixed(2)}`);
    for (const r of ref.isf) near(law.isf(r.p), r.x, 2e-3 * Math.max(1, Math.abs(r.x)), `${label} law: isf at ${r.p}`);
    const grid = [0.5, 0.2, 0.05, 0.01, 0.002];
    for (const p of grid) near(law.sf(law.isf(p)), p, 1e-9 + 0.01 * p, `${label} law: sf and isf are inverses at ${p}`);
    let last = 1;
    for (let k = 0; k <= 40; k++) {
      const v = law.sf(-5 + k * 0.5);
      ok(v <= last + 1e-12, `${label} law: the survival never rises (${k})`);
      last = v;
    }
    const max = Math.max(...sample.map(Math.abs));
    ok(law.sf(3 * max) > 0 && law.sf(3 * max) < law.upper.rate, `${label} law: a tail beyond the largest observation keeps mass where the empirical law has none`);
  }
  eq(E.semiParametricLaw([1, 2, 3], {}), null, "a short sample has no law");
  eq(E.semiParametricLaw(sample, { tail: 0.7 }), null, "and a tail beyond a half none");
  const empirical = (x) => sample.filter((v) => v > x).length / sample.length;
  const law = E.semiParametricLaw(sample, { tail: 0.075 });
  near(law.sf(0.3), empirical(0.3), 1e-12, "the body is the empirical law");
  ok(law.cdf(1) + law.sf(1) === 1 || Math.abs(law.cdf(1) + law.sf(1) - 1) < 1e-12, "cdf and sf add to one");
  near(law.quantile(0.9), law.isf(0.1), 1e-12, "quantile is isf of the complement");
  eq(law.isf(0), null, "no quantile at probability zero");
}

{
  const tf = read("fixtures-moves-tail.json");
  const c = tf.covariate;
  const fit = E.covariateGpd(c.y, c.X);
  near(fit.xi, c.xi, 1e-4, "COVARIATE GPD: the shape equals the scipy reference");
  c.gamma.forEach((g, k) => near(fit.gamma[k], g, 1e-4, `log-scale coefficient ${k}`));
  near(fit.nll, c.nll, 1e-6, "and the maximised likelihood");
  c.se.gamma.forEach((v, k) => near(fit.se.gamma[k], v, 2e-4 * Math.max(1, v) , `standard error of coefficient ${k}`));
  near(fit.se.xi, c.se.xi, 2e-4, "and of the shape");
  ok(c.gamma.every((g, k) => Math.abs(g - c.trueGamma[k]) < 4 * c.se.gamma[k]) && Math.abs(c.xi - c.trueXi) < 4 * c.se.xi, "and the reference recovers the truth within four standard errors");
  eq(fit.n, c.n, "over every point");
  const plain = E.fitGpd(c.y);
  const intercept = E.covariateGpd(c.y, c.y.map(() => [1]));
  near(intercept.xi, plain.xi, 1e-5, "with an intercept alone it is the plain generalised Pareto fit: the shape");
  near(Math.exp(intercept.gamma[0]), plain.beta, 1e-4 * plain.beta, "and the scale");
  ok(2 * (intercept.nll - fit.nll) > 20, `the covariates earn their place: a likelihood-ratio statistic of ${(2 * (intercept.nll - fit.nll)).toFixed(0)} against the intercept alone`);
  const reps = 40;
  const est = [];
  const ses = [];
  for (let r = 0; r < reps; r++) {
    const rg = makeRng(`evt|covariate|${r}`);
    const X = Array.from({ length: 400 }, () => [1, rg.normal()]);
    const y = Float64Array.from(X, (row) => E.gpdIsf(rg.uniform(), 0.2, Math.exp(0.1 + 0.6 * row[1])));
    const f = E.covariateGpd(y, X);
    est.push(f.gamma[1]);
    ses.push(f.se.gamma[1]);
  }
  const mean = est.reduce((a, b) => a + b, 0) / reps;
  const sd = Math.sqrt(est.reduce((a, b) => a + (b - mean) ** 2, 0) / (reps - 1));
  const seMean = ses.reduce((a, b) => a + b, 0) / reps;
  near(mean, 0.6, 0.03, "over 40 samples the slope is unbiased");
  near(seMean / sd, 1, 0.3, `and its reported standard error is its spread (${seMean.toFixed(3)} against ${sd.toFixed(3)})`);
  near(E.covariateGpdSf(fit, [1, 0, 0], 2), E.gpdSf(2, fit.xi, Math.exp(fit.gamma[0])), 1e-12, "the covariate survival is the Pareto survival at the fitted scale");
  eq(E.covariateGpd([1, 2], [[1], [1]]), null, "too few points have no fit");
  eq(E.covariateGpd(c.y, c.y.map(() => [0])), null, "a covariate matrix of zeros has no fit");
  eq(E.solveLinear([[1, 2], [2, 4]], [1, 2]), null, "a singular system has no solution");
  eq(E.invertMatrix([[2, 0], [0, 4]]), [[0.5, 0], [0, 0.25]], "and a diagonal one inverts");
}


{
  const w = w1mWorld({ seed: "evt|w1m|a", names: 40, days: 5000, sectors: 4, sectorRho: 0.15 });
  const again = w1mWorld({ seed: "evt|w1m|a", names: 40, days: 5000, sectors: 4, sectorRho: 0.15 });
  eq(Array.from(w.r.subarray(0, 500)), Array.from(again.r.subarray(0, 500)), "W1m is a pure function of its seed");
  ok(WORLDS.W1m && WORLDS.W2, "and W1m and W2 are registered worlds");
  let s2 = 0;
  for (const v of w.r) s2 += v * v;
  near(s2 / w.r.length, w.params.variance, 0.4, `W1m: the unconditional variance is its target ${w.params.variance} to within 10% (${(s2 / w.r.length).toFixed(2)}, persistence 0.97 and fat tails make the sample variance noisy)`);
  let afterNeg = 0, nNeg = 0, afterPos = 0, nPos = 0;
  for (let i = 0; i < w.names; i++) for (let d = 1; d < w.days; d++) {
    const k = i * w.days + d;
    if (w.r[k - 1] < 0) { afterNeg += w.r[k] ** 2; nNeg++; } else { afterPos += w.r[k] ** 2; nPos++; }
  }
  ok(afterNeg / nNeg > 1.05 * (afterPos / nPos), `W1m: a fall raises the next session's variance more than a rise does (${(afterNeg / nNeg).toFixed(2)} against ${(afterPos / nPos).toFixed(2)}): the leverage term of the GJR recursion`);
  let neg = 0;
  for (const v of w.z) if (v < 0) neg++;
  near(neg / w.z.length, w.dist.cdf(0), 0.01, "W1m: the skew of the Hansen innovation shows in the share of negative shocks");
  const corr = (i, j) => {
    let sxy = 0, sxx = 0, syy = 0;
    for (let t = 0; t < w.days; t++) { const x = w.z[i * w.days + t], y = w.z[j * w.days + t]; sxy += x * y; sxx += x * x; syy += y * y; }
    return sxy / Math.sqrt(sxx * syy);
  };
  near(corr(0, 4), 0.15, 0.04, "W1m: two names of one sector have innovations correlated at the sector weight");
  near(corr(0, 1), 0, 0.04, "and two names of different sectors are uncorrelated");
  const noisy = w1mWorld({ seed: "evt|w1m|scale", names: 600, days: 20, scaleErrorSd: 0.3 });
  const logs = Array.from(noisy.scaleError, Math.log);
  const mu = logs.reduce((a, b) => a + b) / logs.length;
  near(Math.sqrt(logs.reduce((a, b) => a + (b - mu) ** 2, 0) / logs.length), 0.3, 0.03, "W1m: the per-name log-scale error has the configured spread");
  eq(w1mWorld({ seed: "evt|w1m|none", names: 5, days: 30 }).scaleError.every((v) => v === 1), true, "and is exactly one when off");
  eq(w1mWorld({ seed: "evt|w1m|none", names: 5, days: 30 }).events.every((e) => e.length === 0), true, "W1m has no scheduled events, jumps or splits");

  const w2 = w2World({ seed: "evt|w2|a", names: 40, days: 3000, eventSd: 6 });
  const everyDay = w2.events.every((evs) => evs.every((d, k) => k === 0 || d - evs[k - 1] === 63));
  ok(everyDay && w2.events.every((evs) => Math.abs(evs.length - 3000 / 63) <= 1), "W2: each name reports every 63 sessions from its own phase");
  const jumpCount = w2.jumps.reduce((a, j) => a + j.length, 0);
  near(jumpCount / (40 * 3000), 0.004, 0.0008, "W2: jumps arrive at the Poisson rate");
  let eventSq = 0, eventN = 0, plainSq = 0, plainN = 0;
  for (let i = 0; i < w2.names; i++) {
    const evs = new Set(w2.events[i]);
    for (let d = 0; d < w2.days; d++) {
      const k = i * w2.days + d;
      const ratio = (w2.r[k] / w2.sigma[k]) ** 2;
      if (evs.has(d)) { eventSq += ratio; eventN++; } else { plainSq += ratio; plainN++; }
    }
  }
  near(eventSq / eventN, 1 + 36, 9, `W2: an earnings session moves ${(eventSq / eventN).toFixed(0)} times the variance of an ordinary one (1 + 6 squared)`);
  near(plainSq / plainN, 1, 0.1, "and the sessions around it are ordinary");
  ok(w2.splits.length > 30 && w2.splits.length < 120, `W2: ${w2.splits.length} splits across 40 names`);
  const sp = w2.splits[0];
  const n1 = w2.days + 1;
  const adjRatio = w2.closes[sp.name * n1 + sp.day] / w2.closes[sp.name * n1 + sp.day + 1];
  const rawRatio = w2.unadjusted[sp.name * n1 + sp.day] / w2.unadjusted[sp.name * n1 + sp.day + 1];
  near(rawRatio / adjRatio, sp.ratio, 1e-9, "W2: the unadjusted close falls by exactly the split ratio over the adjusted move across the split date");
  near(w2.unadjusted[sp.name * n1 + w2.days], w2.closes[sp.name * n1 + w2.days], 1e-9, "and the two agree after the last split");
  ok(w2.closes.every((v) => v > 0 && Number.isFinite(v)), "adjusted closes are positive and finite");
}

{
  const rng = makeRng("evt|ref-scale");
  const r = Float64Array.from({ length: 1000 }, () => rng.normal() * 2);
  const events = [10, 73, 136];
  for (const d of events) r[d] = 40;
  const clean = E.referenceScale(r, { events });
  const dirty = E.referenceScale(r, {});
  near(clean, 2, 0.15, "REFERENCE SCALE: the scale of ordinary sessions is 2");
  ok(dirty > 1.2 * clean, `and counting three earnings sessions would raise it to ${dirty.toFixed(2)}: the planted wrong build the kill matrix arms`);
  eq(E.referenceScale([1, 2, 3], {}), null, "too few sessions have no scale");
  eq(E.referenceScale([NaN, ...Array.from({ length: 30 }, () => 1)], {}), 1, "and a non-number is not a session");
  const series = M.seriesOf(w1dWorld({ seed: "evt|dj", names: 20, days: 300, rho: 0.2 }));
  const jk = E.dateJackknife(series, (g) => E.pooledShape(g).xi, { blocks: 6 });
  const jk2 = E.pooledJackknife(series, { blocks: 6 });
  near(jk.se, jk2.se, 1e-12, "the generic date jackknife of the pooled shape equals the dedicated one");
  eq(E.dateJackknife([], () => 1), null, "and an empty panel has none");
}

{
  eq(E.CHALLENGERS.map((c) => [c.id, c.role]), [["pooled-shape", "baseline"], ["hierarchical-shape", "challenger"], ["per-name-mle", "reference"]], "CHALLENGER: the registry holds the pooled shape as the one baseline and the hierarchical fit as a challenger");
  const world = (rng, names, per, mean, sd) => {
    const truth = [];
    const groups = [];
    for (let i = 0; i < names; i++) {
      const xi = Math.min(0.55, Math.max(0, mean + sd * rng.normal()));
      truth.push(xi);
      const beta = Math.exp(0.7 * rng.normal());
      groups.push(Float64Array.from({ length: per }, () => E.gpdIsf(rng.uniform(), xi, beta)));
    }
    return { truth, groups };
  };
  const score = (sd) => {
    const out = Object.fromEntries(E.CHALLENGERS.map((c) => [c.id, 0]));
    const reps = 16;
    for (let r = 0; r < reps; r++) {
      const w = world(makeRng(`evt|hier|${sd}|${r}`), 40, 60, 0.2, sd);
      for (const c of E.CHALLENGERS) {
        const est = c.estimate(w.groups);
        out[c.id] += Math.sqrt(est.reduce((a, v, i) => a + (v - w.truth[i]) ** 2, 0) / est.length) / reps;
      }
    }
    return out;
  };
  const same = score(0);
  const spread = score(0.15);
  log(`per-name shape error (RMSE over 40 names, 60 exceedances each): equal shapes ${Object.entries(same).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(", ")}; shapes spread by SD 0.15 ${Object.entries(spread).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(", ")}`);
  ok(same["pooled-shape"] <= 1.02 * same["hierarchical-shape"], "when every name has one shape the pooled fit is at least as good (the hierarchical fit estimates a spread that is not there): it stays the baseline");
  ok(spread["hierarchical-shape"] < 0.9 * spread["pooled-shape"], `when shapes differ by sector-like spread the hierarchical fit has ${(100 * (1 - spread["hierarchical-shape"] / spread["pooled-shape"])).toFixed(0)}% less error than pooling`);
  ok(spread["hierarchical-shape"] < 0.75 * spread["per-name-mle"] && same["hierarchical-shape"] < 0.3 * same["per-name-mle"], "and a fraction of the error of fitting each name alone");
  const w = world(makeRng("evt|hier|prior"), 40, 60, 0.2, 0.15);
  const h = E.hierarchicalShape(w.groups);
  near(h.m, 0.2, 0.08, "the fitted prior mean is near the truth");
  ok(h.tau > 0.05 && h.tau < 0.35, `and its spread (${h.tau.toFixed(3)}) is of the order of the 0.15 that was planted`);
  ok(h.xi.length === 40 && h.xi.every((v) => v > -0.2 && v < 0.8), "with a shrunken shape for every name");
  eq(E.hierarchicalShape(w.groups.slice(0, 2)), null, "two names are not a population");
  const pooled = E.pooledShape(w.groups, { scale: "profile" });
  near(E.hierarchicalShape(world(makeRng("evt|hier|flat"), 40, 60, 0.2, 0).groups).m, pooled.xi, 0.1, "with equal shapes its centre is the pooled shape");
}


console.log(`flows-evt: ${checks} checks passed`);
