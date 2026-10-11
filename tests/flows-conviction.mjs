import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONVICTION, CONVICTION_LABELS, CONVICTION_NOTES, decide, evaluateConviction, horizonReading, invert, logitFit,
  spearman, tCrit975, wilson,
} from "../shared/flows-conviction.js";
import { cpuClock, compare, assertBudget } from "./lib/cpu-budget.mjs";
import { simulate, weekdays, logistic } from "./conviction-sim.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const close = (a, b, tol, msg) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b}, tolerance ${tol})`);
  checks++;
};

const FIX = JSON.parse(readFileSync(new URL("./fixtures-conviction.json", import.meta.url), "utf8"));

const run = (sim, opts = {}) => evaluateConviction(sim.boards, sim.closes, sim.cal, opts);
const reading = (out, k = 10) => out.horizons.find((h) => h.k === k);

{
  eq(FIX.rows.length, 500, "reference: 500 rows in 25 sessions of 20, from numpy and scipy");
  for (const [df, want] of Object.entries(FIX.tTable)) {
    close(tCrit975(Number(df)), want, 5e-3, `t table: the 97.5% point at ${df} degrees of freedom`);
  }
  close(tCrit975(45), 2.014, 0.01, "t table: 45 degrees of freedom is covered by the 2.02 step");
  ok(tCrit975(45) >= 2.0141, "and the step is on the conservative side of the true point");
  ok(tCrit975(100) >= 1.984 && tCrit975(500) === 1.96, "and so are 100 and the normal limit");
  eq(tCrit975(0), null, "no degrees of freedom, no critical value");

  for (const w of FIX.wilson) {
    const got = wilson(w.p, w.n);
    close(got[0], w.lo, 1e-12, `Wilson lower bound at p ${w.p}, n ${w.n}`);
    close(got[1], w.hi, 1e-12, `Wilson upper bound at p ${w.p}, n ${w.n}`);
  }
  eq(wilson(null, 10), null, "Wilson of a missing rate is missing");
  eq(wilson(0.5, 0), null, "and of no observations");

  const y = FIX.rows.map((r) => r.hit);
  const g = FIX.rows.map((r) => r.g);
  const m1 = logitFit(FIX.rows.map((r) => [1, r.x]), y, g);
  for (let k = 0; k < 2; k++) {
    close(m1.beta[k], FIX.model1.beta[k], 1e-7, `reference: coefficient ${k} of hit on conviction`);
    close(m1.se[k], FIX.model1.se[k], 1e-7, `reference: its session-clustered standard error ${k}`);
    close(m1.seNaive[k], FIX.model1.seNaive[k], 1e-7, `reference: and the naive one ${k}`);
  }
  eq(m1.G, FIX.clusters, "reference: 25 clusters");
  const m2 = logitFit(FIX.rows.map((r) => [1, r.x, r.bth - FIX.model2.bthMean]), y, g);
  for (let k = 0; k < 3; k++) {
    close(m2.beta[k], FIX.model2.beta[k], 1e-7, `reference: coefficient ${k} with breadth`);
    close(m2.se[k], FIX.model2.se[k], 1e-7, `reference: its clustered standard error ${k}`);
  }
  const r = horizonReading(FIX.rows, FIX.clusters, 10);
  close(r.slope.b, FIX.model1.beta[1], 5e-5, "reading: the slope is the fit's");
  close(r.slope.lo, FIX.model1.beta[1] - FIX.tCrit * FIX.model1.se[1], 1e-4, "reading: its lower bound uses t on G-1 degrees of freedom");
  close(r.slope.hi, FIX.model1.beta[1] + FIX.tCrit * FIX.model1.se[1], 1e-4, "reading: and its upper bound");
  close(r.slope.or10, Math.exp(FIX.model1.beta[1] / 10), 5e-5, "reading: the odds ratio per ten points of conviction");
  close(r.breadth.c, FIX.model2.beta[2], 5e-5, "reading: the breadth coefficient is the joint fit's");
  FIX.terciles.groups.forEach((want, i) => {
    const got = r.terciles[i];
    eq(got.n, want.n, `reference: tercile ${i + 1} holds ${want.n} rows`);
    eq(got.hits, want.hits, `reference: and ${want.hits} hits`);
    close(got.rate, want.rate, 5e-5, `reference: its hit rate ${i + 1}`);
    close(got.nEff, want.nEff, 0.06, `reference: its effective count ${i + 1}`);
    close(got.deff, want.deff, 0.006, `reference: its design effect ${i + 1}`);
    close(got.lo, want.lo, 5e-5, `reference: its Wilson lower bound ${i + 1}`);
    close(got.hi, want.hi, 5e-5, `reference: and upper bound ${i + 1}`);
  });
  close(r.diff.value, FIX.terciles.diff, 5e-5, "reference: top minus bottom tercile");
  close(r.diff.se, FIX.terciles.diffSe, 5e-5, "reference: and its clustered standard error");
  close(r.power.mde, 2.8 * FIX.terciles.diffSe, 2e-4, "reference: the smallest effect that could be told from none is 2.8 standard errors");
  const sp = spearman(FIX.rows.map((x) => x.x), FIX.rows.map((x) => x.y), g);
  close(sp.rho, FIX.spearman.rho, 1e-12, "reference: Spearman equals the rank-based Pearson");
  close(sp.rho, FIX.spearman.scipy, 1e-12, "reference: and scipy's");
  close(sp.se, FIX.spearman.se, 1e-9, "reference: and its leave-one-session-out jackknife standard error");
}

{
  deep(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]).rho, 0.8, "Spearman of a hand-worked pair is 0.8");
  close(spearman([1, 2, 2, 3], [1, 2, 3, 4]).rho, 0.9486832980505138, 1e-12, "Spearman averages tied ranks");
  eq(spearman([1, 1, 1, 1], [1, 2, 3, 4]), null, "a constant column has no rank correlation");
  eq(spearman([1, 2], [1, 2]), null, "two points are not enough");

  const m = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
  const inv = invert(m);
  m.forEach((row, i) => row.forEach((_, j) => {
    const cell = row.reduce((s, _v, k) => s + m[i][k] * inv[k][j], 0);
    close(cell, i === j ? 1 : 0, 1e-12, `invert: M times its inverse, cell ${i}${j}`);
  }));
  eq(invert([[1, 2], [2, 4]]), null, "a singular matrix has no inverse");

  const n0 = 200, h0 = 80, n1 = 300, h1 = 210;
  const X = [], y = [], c = [];
  for (let i = 0; i < n0; i++) { X.push([1, 0]); y.push(i < h0 ? 1 : 0); c.push(i % 10); }
  for (let i = 0; i < n1; i++) { X.push([1, 1]); y.push(i < h1 ? 1 : 0); c.push(i % 10); }
  const fit = logitFit(X, y, c);
  const logit = (p) => Math.log(p / (1 - p));
  close(fit.beta[0], logit(h0 / n0), 1e-8, "a binary regressor: the intercept is the log odds of the base group");
  close(fit.beta[1], logit(h1 / n1) - logit(h0 / n0), 1e-8, "and the slope the log odds ratio");
  close(fit.seNaive[1], Math.sqrt(1 / h0 + 1 / (n0 - h0) + 1 / h1 + 1 / (n1 - h1)), 1e-8, "and the naive standard error the textbook sum of reciprocals");
  ok(fit.se[1] > 0 && Number.isFinite(fit.se[1]), "the clustered one is finite and positive");

  eq(logitFit([[1, 0], [1, 1], [1, 0]], [1, 1, 1], [0, 1, 2]), null, "an outcome that never varies cannot be fitted");
  eq(logitFit(X.slice(0, 2), y.slice(0, 2), c.slice(0, 2)), null, "and neither can two rows");
  const sep = [], sy = [], sc = [];
  for (let i = 0; i < 40; i++) { sep.push([1, i < 20 ? 0 : 1]); sy.push(i < 20 ? 0 : 1); sc.push(i); }
  eq(logitFit(sep, sy, sc), null, "complete separation does not converge and is refused rather than reported as a huge slope");
}

{
  const sim = simulate({ sessions: 100, b: 1.5, seed: 7 });
  const out = run(sim);
  const r = reading(out);
  eq(out.status, "ok", "simulation: a book whose hit rate rises with conviction gets a verdict");
  ok(r.rows > 9000, `with ${r.rows} rows over ${r.sessions} sessions at ten sessions`);
  ok(r.slope.lo <= 1.5 && 1.5 <= r.slope.hi, `simulation: the 95% interval (${r.slope.lo}, ${r.slope.hi}) holds the true slope 1.5`);
  close(r.slope.b, 1.5, 3 * r.slope.se, "simulation: and the estimate is within three standard errors of it");
  eq(out.verdict, "keep", "simulation: conviction is kept");
  eq(out.label, CONVICTION_LABELS.keep, "under its own name");
  ok(r.monotone && r.terciles[0].rate < r.terciles[1].rate && r.terciles[1].rate < r.terciles[2].rate, "simulation: the terciles rise");
  ok(r.spearman.rho > 0 && r.spearman.rho - 3 * r.spearman.se > 0, "simulation: and so does the rank correlation, clear of its jackknife error");
  ok(r.diff.lo > 0, "simulation: the top-minus-bottom interval is above zero");
  eq(out.addBreadth, false, "simulation: breadth carried no effect and is not added");
  const k5 = reading(out, 5);
  ok(k5.rows >= r.rows && k5.slope, "simulation: the five-session horizon is read as well");
  ok(k5.sessions >= r.sessions, "and it has at least as many scored sessions, because its exits close sooner");
  ok(JSON.stringify(out).length < 6200, `simulation: the published verdict is ${JSON.stringify(out).length} bytes`);
}

{
  const flat = run(simulate({ sessions: 100, b: 0, seed: 11 }));
  eq(flat.status, "ok", "null: a book where conviction does nothing still gets a verdict");
  eq(flat.verdict, "relabel", "null: and it is relabelled");
  eq(flat.label, CONVICTION_LABELS.relabel, "as an agreement index");
  eq(CONVICTION_LABELS.relabel, "Agreement index", "the name the rule gives it");
  const r = reading(flat);
  ok(r.slope.lo < 0 && r.slope.hi > 0, `null: the interval (${r.slope.lo}, ${r.slope.hi}) straddles zero`);

  let falseKeeps = 0, covered = 0;
  const N = 40;
  for (let s = 0; s < N; s++) {
    const out = run(simulate({ sessions: 70, b: 0, seed: 100 + s, sessionSd: 0.3 }));
    const rd = reading(out);
    if (out.verdict === "keep") falseKeeps++;
    if (rd.slope && rd.slope.lo <= 0 && rd.slope.hi >= 0) covered++;
  }
  ok(falseKeeps <= 3, `null: ${falseKeeps} false keeps in ${N} books with no effect and a session effect (the rule allows about one in forty)`);
  ok(covered >= 35, `null: the interval holds the truth in ${covered} of ${N}`);

  const inverse = run(simulate({ sessions: 100, b: -1.5, seed: 5 }));
  eq(inverse.verdict, "relabel", "inverse: conviction that orders outcomes the wrong way is not kept");
  ok(reading(inverse).slope.hi < 0, "inverse: its interval is wholly below zero");

  const breadth = run(simulate({ sessions: 100, b: 1.5, bthEffect: 0.4, seed: 9 }));
  eq(breadth.verdict, "keep", "breadth: a book with both effects keeps conviction");
  eq(breadth.addBreadth, true, "breadth: and adds breadth, whose coefficient is significant");
  ok(reading(breadth).breadth.c > 0.2 && reading(breadth).breadth.lo > 0, "breadth: with a positive coefficient and an interval above zero");
}

{
  const sim = simulate({ sessions: 90, b: 0.8, sessionSd: 0.8, drift: 18, seed: 21 });
  const r = reading(run(sim));
  ok(r.slope.se > 1.15 * r.slope.seNaive, `clustering: a session effect that moves conviction and outcomes together makes the clustered error ${r.slope.se} larger than the naive ${r.slope.seNaive}`);
  ok(r.terciles.every((t) => t.deff > 1.5 && t.nEff < t.n / 1.5), `clustering: every tercile has a design effect above 1.5 (${r.terciles.map((t) => t.deff).join(", ")}) and an effective count to match`);
  ok(r.terciles.every((t) => t.hi - t.lo > 0), "clustering: and a Wilson interval wider than the count would give");
  const iid = run(simulate({ sessions: 90, b: 0.8, sessionSd: 0, seed: 21 }));
  ok(reading(iid).terciles.every((t) => t.deff < 1.6), `clustering: with no session effect the design effect stays near one (${reading(iid).terciles.map((t) => t.deff).join(", ")})`);
}

{
  const sim = simulate({ sessions: 100, b: 1.5, seed: 3 });
  const a = run(sim), b = run(sim);
  deep(a, b, "the evaluation is deterministic");
  const short = run(simulate({ sessions: 30, b: 1.5, seed: 3 }));
  eq(short.status, "pending", "a short archive is pending");
  eq(short.verdict, "pending", "with no verdict");
  eq(short.label, CONVICTION_LABELS.pending, "and the number keeps the name it has until there is evidence");
  eq(CONVICTION_LABELS.pending, "Conviction", "which is Conviction");
  ok(/against the 60 sessions and 600 rows a verdict needs/.test(short.reason), `and the reason names the floor: ${short.reason}`);
  ok(short.horizons.length === 2 && reading(short).slope, "yet its estimates are still published, so a reader sees how thin they are");
  eq(short.addBreadth, false, "pending adds nothing");
  deep(Object.keys(CONVICTION_NOTES), ["rule", "market", "cluster", "overlap", "floor"], "the notes travel with the verdict");
  ok(CONVICTION_NOTES.floor.includes("60") && CONVICTION_NOTES.floor.includes("600"), "and the floor note carries the numbers in force");
  const empty = run({ boards: [], closes: new Map(), cal: weekdays(5) });
  eq(empty.status, "pending", "no boards at all is pending, not a fault");
  ok(/0 scored sessions and 0 rows/.test(empty.reason), "saying so");

  const forward = simulate({ sessions: 100, b: 1.5, seed: 3 });
  const cut = forward.cal[99 + 10 - 8];
  const limited = run(forward, { through: cut });
  ok(reading(limited).sessions < reading(a).sessions - 5, `look-ahead: cutting the calendar at ${cut} drops the sessions whose exit is after it (${reading(limited).sessions} against ${reading(a).sessions})`);
  const lastMeasured = reading(limited).lastSession;
  const idx = forward.cal.indexOf(lastMeasured);
  ok(forward.cal[idx + 10] <= cut, "look-ahead: and the last scored session's ten-session exit is on or before the cut");

  const epochSim = simulate({ sessions: 100, b: 1.5, seed: 3 });
  const epoch = epochSim.cal[40];
  const after = run(epochSim, { epoch });
  eq(reading(after).firstSession, epoch, "epoch: sessions before the selection epoch are left out, not averaged in");
  eq(after.epoch, epoch, "epoch: and the verdict names it");
}

{
  const cal = weekdays(40);
  const closes = new Map();
  const long = [0.12, 0.11, 0.06].map((r, i) => ({ t: "L" + i, px: 100, cnv: 40 + i * 10, bth: 4 }));
  const short = [0.12, 0.11, 0.06].map((r, i) => ({ t: "S" + i, px: 100, cnv: 40 + i * 10, bth: 4 }));
  [0.12, 0.11, 0.06].forEach((r, i) => {
    closes.set("L" + i, new Map([[cal[10], 100 * (1 + r)]]));
    closes.set("S" + i, new Map([[cal[10], 100 * (1 + r)]]));
  });
  const out = evaluateConviction([{ d: cal[0], side: "long", rows: long }, { d: cal[0], side: "short", rows: short }], closes, cal, {
    horizons: [10], stated: 10, minSessions: 1, minRows: 1,
  });
  const r = reading(out);
  eq(r.rows, 6, "market-relative: six measured names");
  close(r.hitRate, 3 / 6, 1e-4, "market-relative: the session mean is 9.67%, a long is a hit above it and a short below it, so the two longs at 12% and 11% and the short at 6% are hits, three of six");
  const lifted = new Map();
  for (const [t, m] of closes) lifted.set(t, new Map([[cal[10], [...m.values()][0] * 1.5 + 50]]));
  close(reading(evaluateConviction([{ d: cal[0], side: "long", rows: long }, { d: cal[0], side: "short", rows: short }], lifted, cal, {
    horizons: [10], stated: 10, minSessions: 1, minRows: 1,
  })).hitRate, 3 / 6, 1e-4, "market-relative: and a rise of the whole market changes nothing");
  const few = evaluateConviction([{ d: cal[0], side: "long", rows: long.slice(0, 2) }], closes, cal, { horizons: [10], stated: 10, minSessions: 1, minRows: 1 });
  eq(reading(few).rows, 0, "a session with fewer than five measured names has no market to be relative to and is skipped");
  const dup = evaluateConviction([{ d: cal[0], side: "long", rows: long.concat(long) }, { d: cal[0], side: "short", rows: short }], closes, cal, {
    horizons: [10], stated: 10, minSessions: 1, minRows: 1,
  });
  eq(reading(dup).rows, 6, "a ticker on the session twice is counted once");
  const nocnv = evaluateConviction([{ d: cal[0], side: "long", rows: long.map((r) => ({ ...r, cnv: null })) }, { d: cal[0], side: "short", rows: short }], closes, cal, {
    horizons: [10], stated: 10, minSessions: 1, minRows: 1,
  });
  eq(reading(nocnv).rows, 3, "a row with no conviction still counts toward the market and is not scored");
}

{
  const mk = (slope, monotone) => ({ slope, monotone });
  eq(decide(null), "pending", "decide: nothing to decide on");
  eq(decide({ slope: null, monotone: false }), "pending", "decide: no fit");
  eq(decide(mk({ lo: 0.2, hi: 1 }, true)), "keep", "decide: an interval above zero and rising terciles keep it");
  eq(decide(mk({ lo: 0.2, hi: 1 }, false)), "relabel", "decide: an interval above zero without rising terciles does not");
  eq(decide(mk({ lo: 0, hi: 1 }, true)), "relabel", "decide: an interval that touches zero does not");
  eq(decide(mk({ lo: -0.4, hi: -0.1 }, true)), "relabel", "decide: a significant negative slope does not");
  eq(decide(mk({ lo: null, hi: null }, true)), "relabel", "decide: an interval that could not be formed does not");
}

{
  const sim = simulate({ sessions: 87, b: 0.4, seed: 17 });
  const subject = () => evaluateConviction(sim.boards, sim.closes, sim.cal, { epoch: null, through: sim.cal[86 + 10] });
  const result = compare(subject, { windows: 8, perWindow: 4, warmup: 3 });
  const r = result.subject.median;
  console.log(`conviction: ${r.toFixed(1)} ms of ${result.clock} for 87 sessions of 100 names at two horizons (${(result.ratio.median).toFixed(2)}x the reference)`);
  assertBudget(result, { median: 16, worst: 30 }, "the nightly conviction evaluation");
  ok(r < 150, `the evaluation costs ${r.toFixed(1)} ms`);
  ok(cpuClock().clock.length > 0, "on a named clock");
}

{
  const text = readFileSync(new URL("../shared/flows-conviction.js", import.meta.url), "utf8");
  ok(!/^\s*\/\//m.test(text) && !/\/\*/.test(text), "the module carries no comments");
  ok(!/\b(fetch|console|process|Date\.now|Math\.random)\b/.test(text), "and no I/O, clock or randomness: it is a pure leaf");
  deep(Array.from(text.matchAll(/^import .* from "(.*)";$/gm), (m) => m[1]), ["./flows-record.js"], "whose one import is the record's forward-close rule");
  ok(CONVICTION.horizons.includes(CONVICTION.stated), "the stated horizon is one of the measured ones");
}

console.log(`✓ flows-conviction: ${checks} assertions — the logistic fit, the session-clustered sandwich, the Wilson interval on the effective count, the tercile contrast and its clustered error, and the rank correlation with a leave-one-session-out jackknife, each held to numpy and scipy on 500 reference rows; boards simulated with a known slope recover it inside the interval and keep conviction, boards with no effect are relabelled an agreement index (false keeps counted over forty seeds), an inverse slope is not kept, breadth is added only when its own coefficient clears, and a short archive is pending under the old name`);
