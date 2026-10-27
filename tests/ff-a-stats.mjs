import { readFileSync } from "node:fs";
import { benjaminiHochberg, mulberry32 } from "../shared/flows-stats.js";
import { holdsAndPlants } from "./lib/ff-a-kit.mjs";
import {
  exactScaled, STEP_EXP, t5UpperRef, robustZRef, bhRef, mcExpectedHits, exactSmallM, medianRef, integrate,
} from "./lib/ff-a-oracle.mjs";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures-ff-contract.json", import.meta.url), "utf8"));

const UNITS = Object.keys(STEP_EXP);
const rngFor = (seed) => mulberry32(seed);

function roundingVectors(S, R) {
  const V = [
    [1.005, "ratio", 101], [-2.5, "days", -3], [2.5, "days", 3], [0.285, "vol_pt", 3], [2499500, "usd", 2500], [2.99946, "sigma", 300],
    [2.99406, "sigma", 299], [-2.995, "sigma", -300], [0.075, "ratio", 8], [-0.075, "ratio", -8], [0.5, "contracts", 1], [-0.5, "contracts", -1],
    [0.4999999, "contracts", 0], [1500, "usd", 2], [-1500, "usd", -2], [1499.999, "usd", 1], [1e21, "usd", 1e18], [1e-9, "sigma", 0],
    [-1e-9, "sigma", 0], [12.345, "pct", 123], [0.05, "vol_pt", 1], [0.15, "vol_pt", 2], [0.25, "vol_pt", 3], [1.1, "pctile", 1], [999950, "usd", 1000],
  ];
  for (const [v, u, want] of V) R.eq(S.scaledInt(v, u), want, `scaledInt(${v}, ${u})`);
  R.eq(Object.is(S.scaledInt(-1e-9, "sigma"), -0), false, "no minus zero");
  R.eq(S.scaledInt(NaN, "usd"), null, "NaN is not a number of steps");
  R.eq(S.scaledInt(Infinity, "usd"), null, "infinity is not a number of steps");
  R.eq(S.unscaled(299, "sigma"), 2.99, "unscaled 299 is 2.99 exactly");
  R.eq(S.unscaled(2500, "usd"), 2500000, "unscaled 2500 usd");
  R.eq(S.quantize(2.99946, "sigma"), 3, "quantize to the displayed 3.00");
  const rng = rngFor(11);
  for (let i = 0; i < (R.heavy ? 6000 : 800); i++) {
    const unit = UNITS[i % UNITS.length];
    const e = STEP_EXP[unit];
    const mag = 10 ** (Math.floor(rng() * 9) - 2);
    const kind = i % 3;
    let v;
    if (kind === 0) v = (rng() - 0.5) * 2 * mag * 10 ** e * 1000;
    else if (kind === 1) v = Number(((Math.floor(rng() * 20000) - 10000) + 0.5).toString() + "e" + e);
    else v = Number(((Math.floor(rng() * 2000) - 1000) / 8 + "e" + e));
    const want = exactScaled(v, e);
    R.eq(S.scaledInt(v, unit), want, `scaledInt against exact decimal ${v} ${unit}`);
    if (R.fails.length > 40) break;
  }
}

function tailVectors(S, R) {
  for (const t of fixtures.t5) R.near(S.tUpper5(t.t), t.upper, 1e-4, "fixture tail " + t.t);
  for (let t = -60; t <= 60; t += R.heavy ? 0.5 : 3.5) {
    const want = t5UpperRef(t);
    R.rel(S.tUpper5(t), want, 1e-9, "t5 upper tail at " + t);
    R.rel(S.tLower5(t), t5UpperRef(-t), 1e-9, "t5 lower tail at " + t);
  }
  for (const t of [0.001, 0.01, 0.123, 1.7, 2.01, 2.99, 4.2, 7.5, 12.1, 33.3]) R.rel(S.tUpper5(t), t5UpperRef(t), 1e-9, "t5 tail at " + t);
  R.near(S.tUpper5(3) + S.tUpper5(-3), 1, 1e-15, "the two tails add to one");
  R.eq(S.tUpper5(0), 0.5, "the tail at zero is a half");
  R.eq(S.tUpper5(Infinity), 0, "the tail at infinity is zero");
  R.eq(S.tUpper5(NaN), null, "NaN has no tail");
  let prev = 1;
  for (let t = -8; t <= 8; t += 0.01) {
    const p = S.tUpper5(t);
    R.ok(p <= prev + 1e-16, "the upper tail never rises with t");
    prev = p;
  }
  R.eq(S.pValue(3, ">="), S.tUpper5(3), "p of a >= clause is the upper tail");
  R.eq(S.pValue(-3, "<="), S.tUpper5(3), "p of a <= clause at minus z is the same tail");
  R.eq(S.pValue(3, "=="), null, "an equality clause has no p");
  R.near(S.tUpper5(S.tCritical5(0.0150)), 0.0150, 1e-12, "the critical value inverts the tail");
}

function robustVectors(S, R) {
  const base = [...Array(10).fill(9e5), ...Array(10).fill(1.1e6)];
  const f = { abs: 1e5, rel: 0 };
  const hit = S.robustZ({ x: 1444700, baseline: base, floor: f });
  R.near(hit.z, 2.99946, 5e-6, "H1 z at 1.4447M");
  R.eq(hit.zq, 3, "H1 displayed 3.00");
  R.eq(hit.floored, false, "H1 not floored");
  R.eq(hit.median, 1e6, "H1 median");
  R.eq(hit.mad, 1e5, "H1 mad");
  const quiet = S.robustZ({ x: 1443900, baseline: base, floor: f });
  R.near(quiet.z, 2.99406, 5e-6, "H1 z at 1.4439M");
  R.eq(quiet.zq, 2.99, "H1 displayed 2.99");
  R.ok(hit.zq >= 3 && !(quiet.zq >= 3), "H1 the displayed values decide");
  R.ok(!(hit.z >= 3), "H1 the raw z would have been silent");
  const flat = Array(20).fill(0);
  const zero = S.robustZ({ x: 0, baseline: flat, floor: f });
  R.eq([zero.z, zero.zq, zero.floored], [0, 0, true], "H2 x = 0 on a flat baseline");
  const five = S.robustZ({ x: 5e6, baseline: flat, floor: f });
  R.eq([five.z, five.zq, five.floored], [50, 50, true], "H2 x = 5M on a flat baseline is 50 and floored");
  R.ok(Number.isFinite(five.z) && Number.isFinite(zero.z), "H2 never infinite or NaN");
  R.eq(S.robustZ({ x: 5e6, baseline: flat, floor: null }).reason, "thin", "no floor and a flat baseline is unknown, never infinite");
  const warm = S.robustZ({ x: 5e6, baseline: [...Array(11).fill(1e6), ...Array(9).fill(null)], floor: f });
  R.eq([warm.z, warm.reason, warm.n, warm.detail], [null, "warming", 11, "baseline 11/20 sessions"], "H3 11 of 20 sessions");
  const fourteen = S.robustZ({ x: 5e6, baseline: [...Array(14).fill(1e6), ...Array(6).fill(null)], floor: f });
  R.eq([fourteen.z, fourteen.reason, fourteen.n], [null, "warming", 14], "H3 14 of 20 is still unknown");
  const fifteen = S.robustZ({ x: 5e6, baseline: [...Array(15).fill(1e6), ...Array(5).fill(null)], floor: f });
  R.ok(fifteen.z !== null && fifteen.n === 15, "H3 15 of 20 is enough");
  R.eq(S.robustZ({ x: NaN, baseline: base, floor: f }).reason, "missing", "a missing value is unknown");
  const rng = rngFor(5);
  for (let i = 0; i < 400; i++) {
    const n = 15 + Math.floor(rng() * 6);
    const b = Array.from({ length: 20 }, (_, k) => (k < n ? Math.round(rng() * 4e6) / 4 : null));
    const x = Math.round((rng() - 0.3) * 8e6);
    const fl = { abs: 1e5 * rng(), rel: rng() < 0.5 ? 0.1 * rng() : 0 };
    const got = S.robustZ({ x, baseline: b, floor: fl });
    const want = robustZRef({ x, baseline: b, floor: fl });
    R.rel(got.z, want.z, 1e-12, "robust z against the reference " + i);
    R.eq(got.floored, want.floored, "floored against the reference " + i);
  }
  const lbase = Array.from({ length: 20 }, (_, i) => 0.8 + i * 0.02);
  const lg = S.robustZ({ x: 1.3, baseline: lbase, floor: { abs: 0.1, rel: 0 }, zSpace: "log" });
  const wl = robustZRef({ x: 1.3, baseline: lbase, floor: { abs: 0.1, rel: 0 }, log: true });
  R.rel(lg.z, wl.z, 1e-12, "log-space z");
  R.eq(S.robustZ({ x: 0, baseline: lbase, floor: { abs: 0.1, rel: 0 }, zSpace: "log" }).reason, "out_of_range", "a zero ratio has no log");
  const withZeros = S.robustZ({ x: 1.3, baseline: [...Array(10).fill(0), ...Array(10).fill(1)], floor: { abs: 0.1, rel: 0 }, zSpace: "log" });
  R.eq(withZeros.reason, "warming", "log space counts only positive baseline values");
  R.eq(medianRef([3, 1, 2]), 2, "oracle median");
}

function baselineVectors(S, R) {
  const session = "2026-03-30";
  const prior = [];
  let d = session;
  while (prior.length < 22) {
    d = new Date(Date.parse(d + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    const wd = new Date(d + "T00:00:00Z").getUTCDay();
    if (wd !== 0 && wd !== 6) prior.push(d);
  }
  const series = {};
  prior.slice(0, 20).forEach((day, i) => { if (i % 4 !== 3) series[day] = 100 + i; });
  const b = S.baselineFor(series, session);
  R.eq(b.length, 20, "a baseline is 20 sessions long");
  R.eq(b.filter((v) => v !== null).length, 15, "a missed night shows as a null in the window");
  R.eq(b[0], 100, "the newest prior session comes first");
  R.eq(b[3], null, "the fourth prior session is the missed one");
  const seven = {};
  prior.slice(0, 14).forEach((day, i) => { seven[day] = 1; });
  const short = S.baselineFor(seven, session);
  R.eq(short.filter((v) => v !== null).length, 14, "H3 a missed night leaves a count of 14");
  R.eq(S.robustZ({ x: 5, baseline: short, floor: { abs: 1, rel: 0 } }).reason, "warming", "H3 14 sessions is unknown");
  const withCurrent = { ...seven, [session]: 999 };
  R.ok(!S.baselineFor(withCurrent, session).includes(999), "the baseline excludes the current session");
}

function bhVectors(S, R) {
  const q = 0.05;
  const rng = rngFor(23);
  for (let trial = 0; trial < (R.heavy ? 300 : 36); trial++) {
    const m = [1, 2, 3, 5, 10, 25, 60, 200, 850][trial % 9];
    const keys = [];
    const scale = [150, 250, 400][trial % 3];
    for (let i = 0; i < m; i++) {
      const u = rng();
      const spike = rng() < 0.08 ? 150 + Math.floor(rng() * 500) : 0;
      keys.push(Math.round((u - 0.5) * 2 * scale) + spike);
    }
    const ps = keys.map((k) => t5UpperRef(k / 100));
    const ref = bhRef(ps, q);
    const got = S.bhCutoff(keys, q);
    const mine = keys.map((k) => got.cutoff !== null && k >= got.cutoff);
    R.eq(got.k, ref.k, `BH rejection count against the step-up reference m=${m} trial ${trial}`);
    R.eq(mine, ref.reject, `BH rejected set against the step-up reference m=${m} trial ${trial}`);
    const fam = S.bhFamily(ps, q);
    R.eq(fam.reject, ref.reject, "bhFamily against the reference");
    R.eq(fam.reject, benjaminiHochberg(ps, q).reject, "bhFamily is the repository BH");
    if (R.fails.length > 30) break;
  }
  R.eq(S.bhCutoff([], q), { m: 0, k: 0, cutoff: null }, "an empty family rejects nothing");
  const tie = S.bhCutoff([700, 700, 700, 100], q);
  R.eq([tie.k, tie.cutoff <= 700], [3, true], "names tied at the cutoff are all rejected");
  const crit = S.bhCritical(850, q);
  for (let k = 2; k <= 850; k++) R.ok(crit[k] <= crit[k - 1], "the critical key never rises with rank " + k);
  R.ok(crit[1] > crit[850], "the first critical key is the strictest");
  R.near(S.tUpper5(crit[1] / 100), q / 850, q / 850 * 0.05, "crit[1] sits at the first BH line");
  R.ok(S.tUpper5((crit[1] - 1) / 100) > q / 850, "one step below crit[1] is above the first line");
  R.eq(S.zKey(3.2, ">="), 3.2, "a >= clause keys on z");
  R.eq(S.zKey(3.2, "<="), -3.2, "a <= clause keys on minus z");
  R.eq(S.maxP([0.01, 0.2, 0.05]), 0.2, "the wire p is the maximum clause p");
  R.eq(S.maxP([0.01, null]), null, "an unknown clause p makes the wire p unknown");
  const fixedTen = S.bhCutoff([310, 305, 300, 100, 50, 0, -50, -100, 20, 30], q);
  const refTen = bhRef([310, 305, 300, 100, 50, 0, -50, -100, 20, 30].map((k) => t5UpperRef(k / 100)), q);
  R.eq(fixedTen.k, refTen.k, "a fixed ten-name family");
}

function budgetVectors(S, R) {
  R.near(S.expectedHitsPerNight(1, 0.5), 0.05, 1e-15, "m = 1 expects q hits");
  R.near(S.expectedHitsPerNight(1, 0.01), 0.01, 1e-15, "m = 1 below q expects p");
  for (const [m, p] of [[2, 0.5], [2, 0.03], [2, 0.01], [1, 0.0301]]) R.near(S.expectedHitsPerNight(m, p), exactSmallM(m, p, 0.05), 1e-13, `closed form m=${m} p=${p}`);
  R.near(S.expectedHitsPerNight(2, 1), 0.05 + 0.0025, 1e-13, "m = 2 expects q + q squared");
  R.eq(S.expectedHitsPerNight(0, 0.01), 0, "no names expect nothing");
  R.eq(S.expectedHitsPerNight(5, 0), 0, "a zero p threshold expects nothing");
  const p3 = S.tUpper5(3);
  let prev = 0;
  let falls = 0;
  const ms = R.heavy ? [...Array.from({ length: 120 }, (_, i) => i + 1), ...Array.from({ length: 146 }, (_, i) => 125 + i * 5)] : [1, 2, 3, 4, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 850];
  for (const m of ms) {
    const e = S.expectedHitsPerNight(m, p3);
    if (e < prev - 1e-12) falls++;
    prev = e;
  }
  R.eq(falls, 0, "expected hits never fall as the scope grows");
  R.ok(prev < 0.0560, "expected hits at m=850 stay in band");
  R.near(S.expectedHitsPerNight(850, p3), 0.05539426, 1e-7, "m = 850 at z = 3 expects 0.0554 hits a night");
  R.eq(S.expWeekCents(850, p3), 28, "0.277 a week is charged 0.28");
  R.eq(S.expWeekCents(2, 1), 27, "0.2625 a week rounds up to 0.27");
  R.eq(S.expWeekCents(1, 0.5), 25, "0.25 a week is exactly 0.25");
  R.near(S.expectedFalseAlarmsPerWeek(850, [p3, S.tUpper5(2)]), 5 * S.expectedHitsPerNight(850, S.tUpper5(2)), 1e-15, "several clauses charge the loosest tail");
  const runs = [[1, 0.03, 21], [2, 0.04, 22], [5, p3, 23], [25, p3, 24], [850, p3, 25]];
  const hard = [[3, 0.4, 0.5, 31], [5, 0.3, 0.3, 32], [10, 0.2, 0.4, 33], [2, 0.25, 0.9, 34]];
  for (const [m, p, q, seed] of hard) {
    const mc = mcExpectedHits({ m, pThr: p, q, trials: 500000, seed });
    const exact = S.expectedHitsPerNight(m, p, q);
    R.ok(Math.abs(mc.mean - exact) <= 3.5 * mc.se + 1e-12, `Monte Carlo agrees at m=${m}, q=${q}: ${mc.mean.toFixed(5)} against ${exact.toFixed(5)}`);
  }
  for (const [m, p, seed] of R.heavy ? runs : []) {
    const trials = m === 850 ? 200000 : 300000;
    const mc = mcExpectedHits({ m, pThr: p, trials, seed });
    const exact = S.expectedHitsPerNight(m, p);
    R.ok(Math.abs(mc.mean - exact) <= 3 * mc.se + 1e-12, `Monte Carlo agrees at m=${m}: ${mc.mean.toFixed(5)} against ${exact.toFixed(5)} (se ${mc.se.toExponential(2)})`);
  }
}

function eValueVectors(S, R) {
  R.near(S.eValue(0.5), 0.59, 0.005, "e(0.5)");
  R.near(S.eValue(1e-2), 3.655, 0.01, "e(1e-2)");
  R.near(S.eValue(1e-4), 200, 0.5, "e(1e-4)");
  R.near(S.eValue(1e-6), 12560, 1, "e(1e-6)");
  R.eq(S.eValue(2), null, "a p above one has no e-value");
  const total = integrate((v) => S.eValue(v ** 10) * 10 * v ** 9, 0, 1, 20);
  R.near(total, 1, 1e-9, "the e-value integrates to one over a uniform null");
  const bar = S.srBar(132600, 1);
  R.eq(bar, 132600, "A = L over B");
  R.eq(S.srBar(132600, 2), 66300, "a budget of two false alarms halves the bar");
  R.eq(S.srBar(0, 1), null, "no looks, no bar");
  let lo = 1e-12;
  let hi = 1e-3;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (S.eValue(mid) >= bar) lo = mid;
    else hi = mid;
  }
  R.ok(lo > 7.2e-8 && lo < 7.4e-8, "a single block fires at u of about 7.3e-8");
  R.eq(S.srRun([S.eValue(lo * 0.999)], bar), [0], "one block at the critical p fires");
  R.eq(S.srRun([S.eValue(lo * 1.2)], bar), [], "one block above the critical p does not");
  const two = S.srRun([S.eValue(1e-5), S.eValue(1e-5)], bar);
  R.eq(two, [1], "two consecutive blocks at 1e-5 fire on the second");
  R.rel(S.srStep(S.srStep(0, S.eValue(1e-5)), S.eValue(1e-5)), 2.5e6, 0.01, "R is about 2.5e6 after two blocks");
  const e3 = S.eValue(1e-4);
  R.rel(S.srStep(S.srStep(S.srStep(0, e3), e3), e3), 8e6, 0.01, "R is about 8e6 after three blocks");
  R.eq(S.srRun([S.eValue(1e-4), S.eValue(1e-4), S.eValue(1e-4)], bar), [2], "three consecutive blocks at 1e-4 fire on the third");
  R.eq(S.srRun([S.eValue(1e-2), S.eValue(1e-2), S.eValue(1e-2)], bar), [], "three blocks at 1e-2 do not");
  R.eq(S.srRun([1e9, 1e9, 1e9, 1e9], bar, 1), [0, 2], "a refractory period skips looks after an alarm");
  const rng = rngFor(99);
  const looks = 132600;
  let alarms = 0;
  const sessions = R.heavy ? 200 : 0;
  for (let s = 0; s < sessions; s++) {
    let r = 0;
    for (let i = 0; i < looks; i++) {
      r = (1 + r) * S.eValue(Math.max(rng(), 1e-300));
      if (r >= bar) {
        alarms++;
        r = 0;
      }
    }
  }
  if (R.heavy) R.ok(alarms / sessions <= 1.0, "H35 the mean false alarms a session is at most one: " + (alarms / sessions));
  R.eq(S.conservativeP(0, 59), 1 / 60, "a conservative rank p");
}

function poissonVectors(S, R) {
  R.near(S.poissonUpperTail(3, 0.5), 0.0143876, 1e-6, "Poisson tail at 3, 0.5");
  R.eq(S.poissonUpperTail(0, 2), 1, "the tail at zero is one");
  R.eq(S.poissonUpperTail(5, 0), 0, "no events expected, none to see");
  const direct = (k, mu) => {
    let term = Math.exp(-mu);
    let sum = 0;
    for (let i = 0; i < k; i++) {
      sum += term;
      term *= mu / (i + 1);
    }
    return 1 - sum;
  };
  for (const [k, mu] of [[1, 0.1], [2, 0.3], [4, 1.5], [7, 3], [12, 9]]) R.near(S.poissonUpperTail(k, mu), direct(k, mu), 1e-12, `Poisson tail ${k},${mu}`);
  R.eq(S.calibrationVerdict({ mu0: 0.5, placebo: 8 }).suspended, true, "a placebo count far above budget suspends the wire");
  R.eq(S.calibrationVerdict({ mu0: 2, placebo: 3 }).suspended, false, "a placebo count near budget does not");
}

function bandVectors(S, R) {
  R.eq(S.band20("ratio", 150, { mul: 0.95 }), 150, "ratio 1.50 relaxes by 7.5 steps");
  R.eq(S.band20("usd", 1000, { rel: 0.1, abs: 50000 }), 2000, "usd $1M relaxes by $100k");
  R.eq(S.band20("usd", 100, { rel: 0.1, abs: 50000 }), 1000, "usd $100k relaxes by the $50k floor");
  R.eq(S.band20("sigma", 300, { abs: 0.5 }), 1000, "sigma relaxes by 0.50");
  R.eq(S.band20("vol_pt", 30, { abs: 0.5 }), 100, "vol points relax by 0.5");
  R.eq(S.band20("contracts", 5000, { rel: 0.1, abs: 100 }), 10000, "contracts relax by ten per cent");
  R.eq(S.band20("bool", 1, { abs: 0 }), 0, "bool has no band");
  R.eq(S.holdsAt(">=", 142, 150, 150), false, "T07: 1.42 exits (re-arm below 1.425)");
  R.eq(S.holdsAt(">=", 143, 150, 150), true, "T07: 1.43 holds");
  R.eq(S.band20("ratio", 50, { mul: 0.95 }), 50, "ratio 0.50 relaxes by 2.5 steps");
  R.eq(S.holdsAt("<=", 53, 50, 50), false, "mirror: 0.53 exits (0.50 x 1.05 = 0.525)");
  R.eq(S.holdsAt("<=", 52, 50, 50), true, "mirror: 0.52 holds");
  R.eq(S.holdsAt(">=", 250, 300, 1000), true, "sigma 2.50 holds a 3.00 wire");
  R.eq(S.holdsAt(">=", 249, 300, 1000), false, "sigma 2.49 exits");
  R.eq(S.holdsAt("==", 1, 1, 0), true, "equality holds at equality");
  R.eq(S.holdsAt("==", 0, 1, 0), false, "equality exits off equality");
  R.eq(S.holdsEntry(">=", 300, 300), true, "entry is inclusive");
  R.eq(S.holdsEntry("<=", 301, 300), false, "entry <= excludes");
}

async function battery(M, R) {
  const S = M.stats;
  roundingVectors(S, R);
  tailVectors(S, R);
  robustVectors(S, R);
  baselineVectors(S, R);
  bhVectors(S, R);
  budgetVectors(S, R);
  eValueVectors(S, R);
  poissonVectors(S, R);
  bandVectors(S, R);
}

const T = "ff-stats";
const plants = [
  { name: "rounding by Math.round of the quotient", target: T, transforms: [["const n = Number(fixedHalfUp(Math.abs(v), 0, -e));", "const n = Math.round(Math.abs(v) / UNITS[unit].step);"], ["if (Math.abs(s) < 1e9 && Math.abs(s - r) < 1e-6) return r === 0 ? 0 : r;", "if (false) return r;"]] },
  { name: "rounding half toward plus infinity", target: T, transforms: [["return v < 0 && n !== 0 ? -n : n;\n}\n\nexport const unscaled", "return v < 0 ? -Math.ceil(Math.abs(v) * 10 ** -e - 0.5) : n;\n}\n\nexport const unscaled"]] },
  { name: "the fast path accepts a half", target: T, transforms: [["Math.abs(s - r) < 1e-6", "Math.abs(s - r) <= 0.5"]] },
  { name: "a tail with four degrees of freedom", target: T, transforms: [["const phi = Math.atan2(Math.sqrt(5), Math.abs(t));", "const phi = Math.atan2(Math.sqrt(4), Math.abs(t));"]] },
  { name: "a lower tail that is the upper tail", target: T, transforms: [["export const tLower5 = (t) => tUpper5(typeof t === \"number\" ? -t : t);", "export const tLower5 = (t) => tUpper5(t);"]] },
  { name: "a series that stops early", target: T, transforms: [["for (let k = 2; k < 40; k++) {", "for (let k = 2; k < 4; k++) {"]] },
  { name: "no floor under the robust scale", target: T, transforms: [["const scale = Math.max(spread, lower);", "const scale = spread;"]] },
  { name: "a baseline padded with zeros", target: T, transforms: [["for (const v of raw) if (finite(v) && (!log || v > 0)) vals.push(log ? Math.log(v) : v);", "for (const v of raw) vals.push(finite(v) ? (log ? Math.log(v) : v) : 0);"]] },
  { name: "a minimum baseline of ten sessions", target: T, transforms: [["window = LIMITS.baselineWindow, min = LIMITS.baselineMin }) {", "window = LIMITS.baselineWindow, min = 10 }) {"]] },
  { name: "a MAD that is not scaled", target: T, transforms: [["const spread = LIMITS.madScale * mad;", "const spread = mad;"]] },
  { name: "a z that divides by the spread alone when floored", target: T, transforms: [["floored: spread < lower };", "floored: false };"]] },
  { name: "a baseline that includes the current session", target: T, transforms: [["const days = priorSessions(session, window);", "const days = [session, ...priorSessions(session, window - 1)];"]] },
  { name: "a BH line over m plus one", target: T, transforms: [["const target = (k * q) / m;", "const target = (k * q) / (m + 1);"]] },
  { name: "Bonferroni in place of BH", target: T, transforms: [["const target = (k * q) / m;", "const target = q / m;"]] },
  { name: "the smallest passing rank in place of the largest", target: T, transforms: [["if (cands[r - 1] >= crit[r]) k = r;", "if (cands[r - 1] >= crit[r] && k === 0) k = r;"]] },
  { name: "a cutoff that drops ties", target: T, transforms: [["return { m, k, cutoff: k ? crit[k] : null };", "return { m, k, cutoff: k ? cands[k - 1] + 1 : null };"]] },
  { name: "a z key with the wrong sign for <=", target: T, transforms: [["return op === \">=\" ? zq : -zq;", "return zq;"]] },
  { name: "a wire p that is the minimum", target: T, transforms: [["if (p > out) out = p;", "if (out === -Infinity || p < out) out = p;"]] },
  { name: "no transition factor in the rejection odds", heavy: true, target: T, transforms: [["const pi = q / m / (1 - a(k));", "const pi = q / m;"]] },
  { name: "a first rank that is never certain", heavy: true, target: T, transforms: [["Q[1] = 1;", "Q[1] = 0.5;"]] },
  { name: "a budget rounded to nearest", target: T, transforms: [["return Math.ceil(expectedFalseAlarmsPerWeek(m, tails, q) * 100 - 1e-9);", "return Math.round(expectedFalseAlarmsPerWeek(m, tails, q) * 100);"]] },
  { name: "a four-night week", target: T, transforms: [["export const SESSIONS_PER_WEEK = 5;", "export const SESSIONS_PER_WEEK = 4;"]] },
  { name: "an e-value with the wrong exponent", heavy: true, target: T, transforms: [["return 0.5 + 0.05 * Math.pow(Math.max(u, 1e-300), -0.9);", "return 0.5 + 0.05 * Math.pow(Math.max(u, 1e-300), -0.8);"]] },
  { name: "an SR step that forgets the carried statistic", heavy: true, target: T, transforms: [["export const srStep = (r, e) => (1 + r) * e;", "export const srStep = (r, e) => r * e;"]] },
  { name: "an SR bar that is looks times budget", target: T, transforms: [["(looks > 0 && budget > 0 ? looks / budget : null)", "(looks > 0 && budget > 0 ? looks * budget : null)"]] },
  { name: "a Poisson tail one term short", target: T, transforms: [["for (let i = 0; i < k; i++) {\n    below += term;", "for (let i = 0; i < k + 1; i++) {\n    below += term;"]] },
  { name: "a ratio band of 95 per cent", target: T, transforms: [["Math.round((1 - r.mul) * BAND_SCALE) * ax", "Math.round(r.mul * BAND_SCALE) * ax"]] },
  { name: "a mirrored band on <=", target: T, transforms: [["return BAND_SCALE * vi <= BAND_SCALE * xi + h20;", "return BAND_SCALE * vi <= BAND_SCALE * xi - h20;"]] },
  { name: "an exclusive entry compare", target: T, transforms: [["if (op === \">=\") return vi >= xi;\n  if (op === \"<=\") return vi <= xi;\n  return vi === xi;", "if (op === \">=\") return vi > xi;\n  if (op === \"<=\") return vi < xi;\n  return vi === xi;"]] },
];

const out = await holdsAndPlants("ff-a-stats", battery, plants);
console.log(`ff-a-stats: ${out.checks} checks passed`);
