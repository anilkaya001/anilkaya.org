import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import * as S from "../shared/flows-stats.js";
import * as VOL from "../shared/flows-vol.js";
import { moduleSource, expect, absent } from "./lib/source-scan.mjs";

const FX = JSON.parse(fs.readFileSync(new URL("./fixtures-stats.json", import.meta.url), "utf8"));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${m}: got ${a}, want ${b}`); checks++; };

for (const r of FX.location) {
  near(S.median(r.x), r.median, 1e-12, `median n=${r.x.length}`);
  near(S.mean(r.x), r.mean, 1e-12, `mean n=${r.x.length}`);
  if (r.sd !== null) near(S.sampleSd(r.x), r.sd, 1e-12, `sd n=${r.x.length}`);
  for (const [p, want] of Object.entries(r.q)) near(S.quantile(r.x, Number(p)), want, 1e-12, `quantile ${p} n=${r.x.length}`);
}
near(S.median(FX.dirty.x), FX.dirty.median, 1e-12, "median skips non-numbers");
near(S.mean(FX.dirty.x), FX.dirty.mean, 1e-12, "mean skips non-numbers");
near(S.sampleSd(FX.dirty.x), FX.dirty.sd, 1e-12, "sd skips non-numbers");
near(S.quantile(FX.dirty.x, 0.8), FX.dirty.q80, 1e-12, "quantile skips non-numbers");
for (const r of FX.rank) {
  const got = S.percentileRank(r.x);
  got.forEach((v, i) => near(v, r.pct[i], 1e-12, "percentileRank average-rank / (m+1)"));
}
for (const r of FX.correlation) {
  near(S.pearson(r.x, r.y), r.pearson, 1e-10, `pearson n=${r.x.length}`);
  near(S.spearman(r.x, r.y), r.spearman, 1e-10, `spearman n=${r.x.length}`);
}
for (const w of FX.wilson) {
  const ci = S.wilson(w.p, w.n, { z: FX.z975 });
  near(ci[0], w.lo, 1e-10, `wilson lo ${w.k}/${w.n}`);
  near(ci[1], w.hi, 1e-10, `wilson hi ${w.k}/${w.n}`);
}
for (const [df, want] of Object.entries(FX.t975)) near(S.tCritical975(Number(df)), want, Number(df) <= 30 ? 1e-12 : 2e-5, `t975 df=${df}`);
for (const r of FX.meanCi) {
  const ci = S.meanCi(r.x);
  near(ci.mean, r.mean, 1e-12, "meanCi mean"); near(ci.se, r.se, 1e-12, "meanCi se");
  near(ci.lo, r.lo, 1e-4, `meanCi lo n=${r.x.length}`); near(ci.hi, r.hi, 1e-4, `meanCi hi n=${r.x.length}`);
}
for (const r of FX.newey) {
  for (const [L, want] of Object.entries(r.bylag)) near(S.neweyWestSe(r.x, { lags: Number(L) }), want, 1e-10, `neweyWest L=${L} n=${r.x.length}`);
  eq(S.neweyWestLags(r.x.length), r.rule.lags, `lag rule n=${r.x.length}`);
  near(S.neweyWestSe(r.x), r.rule.se, 1e-10, `neweyWest default lags n=${r.x.length}`);
}
for (const b of FX.bootstrap) {
  const got = S.stationaryBootstrap(b.x, { reps: b.reps, meanBlock: b.meanBlock, seed: b.seed });
  got.forEach((v, i) => near(v, b.means[i], 1e-12, `bootstrap replicate ${i} seed ${b.seed}`));
}
for (const s of FX.score) {
  near(S.brier(s.p, s.y), s.brier, 1e-12, "brier");
  near(S.logScore(s.p, s.y), s.logScore, 1e-12, "logScore");
  const r = S.reliability(s.p, s.y, { bins: s.bins });
  near(r.reliability, s.reliability, 1e-12, "reliability"); near(r.resolution, s.resolution, 1e-12, "resolution");
  near(r.uncertainty, s.uncertainty, 1e-12, "uncertainty"); near(r.withinBin, s.withinBin, 1e-12, "withinBin");
  near(r.withinCovariance, s.withinCovariance, 1e-12, "withinCovariance");
  near(r.brier, r.reliability - r.resolution + r.uncertainty + r.withinBin - 2 * r.withinCovariance, 1e-12, "the Brier score is reliability - resolution + uncertainty plus the two within-bin terms");
  r.bins.forEach((c, i) => { eq(c.n, s.cells[i].n, "bin count"); if (c.n) { near(c.p, s.cells[i].p, 1e-12, "bin p"); near(c.y, s.cells[i].y, 1e-12, "bin y"); } });
}
for (const b of FX.bh) {
  const got = S.benjaminiHochberg(b.p, 0.05);
  got.adjusted.forEach((v, i) => near(v, b.adjusted[i], 1e-12, "BH adjusted"));
  deep(got.reject, b.reject05, "BH q=0.05 rejections");
  deep(S.benjaminiHochberg(b.p, 0.2).reject, b.reject20, "BH q=0.2 rejections");
}
for (const e of FX.effectiveN) near(S.effectiveN(e), e.want, 1e-12, "effectiveN");

{
  const gen = fs.readFileSync(new URL("./gen-stats-fixtures.py", import.meta.url));
  eq(FX.provenance.generator, "tests/gen-stats-fixtures.py", "provenance: the fixture names the generator that wrote it");
  eq(FX.provenance.generatorSha256, createHash("sha256").update(gen).digest("hex"), "provenance: and the generator's hash, so an edited generator without a regenerated fixture fails here");
  ok(/^1\.\d+/.test(FX.provenance.scipy) && FX.provenance.statsmodels && FX.provenance.numpy, "provenance: the library versions are recorded");
  ok(!/^\s*#/m.test(gen.toString()), "the generator carries no comments");
}

{
  const leaf = moduleSource("shared/flows-stats.js");
  absent(leaf, /^import\s/m, { anchor: "export function median", why: "the leaf imports nothing, so the Worker, the pipeline and a bundle can all take it" });
  absent(leaf, /Date\.now|Math\.random|new Date\(\)/, { anchor: "export function median", why: "every function of the leaf is a pure function of its arguments" });
  absent(leaf, /\/\/|\/\*/, { anchor: "export function median", why: "source files carry no comments" });
  for (const name of ["mean", "sampleVar", "sampleSd", "median", "quantileSorted", "quantile", "shareAtOrBelow", "percentileRank", "pearson", "spearman",
    "wilson", "effectiveN", "tCritical975", "meanCi", "neweyWestLags", "neweyWestSe", "mulberry32", "stationaryBootstrap", "bootstrapInterval",
    "brier", "logScore", "reliability", "benjaminiHochberg"]) {
    eq(typeof S[name], "function", `the leaf exports ${name}`);
  }
}

{
  eq(S.median([]), null, "median of nothing is null, not NaN");
  eq(S.median([NaN, "3", null, undefined, Infinity]), null, "and of nothing numeric is null too");
  eq(S.mean([]), null, "mean of nothing is null");
  eq(S.sampleSd([5]), null, "a standard deviation needs two numbers");
  eq(S.quantile([], 0.5), null, "quantile of nothing is null");
  eq(S.quantile([7], 0.9), 7, "a single value is every quantile");
  eq(S.quantileSorted([1, 2, 3], -5), 1, "a probability below zero is the minimum");
  eq(S.quantileSorted([1, 2, 3], 9), 3, "and above one the maximum");
  eq(S.shareAtOrBelow(null, [1, 2]), null, "no share for an absent value");
  eq(S.pearson([1, 2], [2, 4]), null, "pearson needs three pairs by default");
  near(S.pearson([1, 2, 3], [2, 4, 6]), 1, 1e-15, "a straight line correlates at one");
  eq(S.pearson([1, 1, 1], [1, 2, 3]), null, "a constant has no correlation");
  near(S.pearson([1, 2], [2, 4], { min: 2 }), 1, 1e-15, "the floor is a parameter");
  eq(S.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1, "spearman of a reversed order is minus one");
  eq(S.wilson(0.5, 0), null, "wilson with no trials is null");
  eq(S.wilson(1.5, 10), null, "and with an impossible proportion");
  ok(S.wilson(0, 5)[0] === 0 && S.wilson(1, 5)[1] === 1, "the interval is clamped to the unit interval");
  eq(S.effectiveN({ n: 0 }), null, "no observations, no effective n");
  eq(S.neweyWestSe([1]), null, "a standard error needs two observations");
  eq(S.stationaryBootstrap([1], { reps: 5 }), null, "a bootstrap needs two observations");
  const a = S.stationaryBootstrap([1, 2, 3, 4, 5, 6], { reps: 10, meanBlock: 2, seed: 3 });
  deep(S.stationaryBootstrap([1, 2, 3, 4, 5, 6], { reps: 10, meanBlock: 2, seed: 3 }), a, "the same seed draws the same replicates");
  ok(JSON.stringify(S.stationaryBootstrap([1, 2, 3, 4, 5, 6], { reps: 10, meanBlock: 2, seed: 4 })) !== JSON.stringify(a), "and another seed draws others");
  const iv = S.bootstrapInterval([0.1, 0.4, -0.2, 0.3, 0.0, 0.5, -0.1, 0.2], { reps: 400, meanBlock: 2, seed: 9, level: 0.8 });
  ok(iv.lo < iv.hi && iv.n === 8 && iv.reps === 400, "the bootstrap interval is ordered and says its n and its replicates");
  eq(S.brier([0.5], [2]), null, "an outcome that is not 0 or 1 is dropped");
  eq(S.reliability([], [], {}), null, "no forecasts, no reliability table");
  deep(S.benjaminiHochberg([]).reject, [], "no p-values, no rejections");
  deep(S.benjaminiHochberg([0.5, "x", null]).adjusted.slice(1), [null, null], "a p-value that is not a number is not adjusted");
}

{
  for (const name of ["mean", "sampleVar", "sampleSd", "median", "quantileSorted", "shareAtOrBelow", "pearson"]) {
    eq(VOL[name], S[name], `flows-vol serves its ${name} from the leaf`);
  }
  const vol = moduleSource("shared/flows-vol.js");
  expect(vol, /from "\.\/flows-stats\.js"/, { min: 1, max: 2, why: "flows-vol takes its statistics from the leaf" });
  for (const name of ["mean", "sampleVar", "sampleSd", "median", "quantileSorted", "shareAtOrBelow", "pearson"]) {
    absent(vol, new RegExp("^(?:export )?function " + name + "\\b", "m"), { anchor: "from \"./flows-stats.js\"", why: "flows-vol no longer declares " + name });
  }
}

{
  const FEATURES = await import("../shared/flows-features.js");
  eq(FEATURES.percentileRank, S.percentileRank, "flows-features serves percentileRank from the leaf");
  const feat = moduleSource("shared/flows-features.js");
  expect(feat, /from "\.\/flows-stats\.js"/, { min: 1, max: 1, why: "flows-features takes its statistics from the leaf" });
  for (const name of ["median", "quantile", "pearson", "percentileRank"]) {
    absent(feat, new RegExp("^function " + name + "\\b|^export function " + name + "\\(.*\\) \\{\\n  (?:const xs|const n|const idx)", "m"), { anchor: "from \"./flows-stats.js\"", why: "flows-features keeps no copy of " + name });
  }
  ok(Number.isNaN(FEATURES.median([])) && Number.isNaN(FEATURES.median([NaN, null])), "flows-features keeps its NaN contract for an empty median");
  ok(Number.isNaN(FEATURES.quantile([], 0.5)) && FEATURES.quantile([4], 0.2) === 4, "and for an empty quantile");
  ok(Number.isNaN(FEATURES.pearson([1], [2])) && Number.isNaN(FEATURES.pearson([1, 1], [1, 2])), "and for a correlation of fewer than two pairs or of a constant");
  near(FEATURES.pearson([1, 2], [2, 4]), 1, 1e-15, "a two-pair correlation is still computed there (the floor is two)");
  for (const r of FX.location) {
    near(FEATURES.median(r.x), r.median, 1e-12, "flows-features median");
    for (const [p, want] of Object.entries(r.q)) near(FEATURES.quantile(r.x, Number(p)), want, 1e-12, `flows-features quantile ${p}`);
  }
  for (const r of FX.correlation) near(FEATURES.pearson(r.x, r.y), r.pearson, 1e-10, "flows-features pearson");
  for (const r of FX.rank) FEATURES.percentileRank(r.x).forEach((v, i) => near(v, r.pct[i], 1e-12, "flows-features percentileRank"));
}

{
  const CROSS = await import("../shared/flows-cross.js");
  eq(CROSS.mean, S.mean, "flows-cross serves its mean from the leaf");
  eq(CROSS.sampleSd, S.sampleSd, "and its sampleSd");
  eq(CROSS.medianOf, S.median, "and its medianOf, which is the leaf's median");
  const cross = moduleSource("shared/flows-cross.js");
  expect(cross, /from "\.\/flows-stats\.js"/, { min: 1, max: 1, why: "flows-cross takes its statistics from the leaf" });
  for (const name of ["mean", "sampleSd", "medianOf"]) {
    absent(cross, new RegExp("^export function " + name + "\\b", "m"), { anchor: "from \"./flows-stats.js\"", why: "flows-cross keeps no copy of " + name });
  }
}

console.log(`✓ flows-stats: ${checks} assertions — the statistics leaf against scipy, numpy and statsmodels references (median and quantiles, average ranks, Pearson and Spearman, Wilson, the t quantile and mean interval, Newey-West, a seeded stationary bootstrap reproduced in Python, Brier, log score and the Murphy decomposition, Benjamini-Hochberg), its edge cases, and the consumers that take their statistics from it`);
