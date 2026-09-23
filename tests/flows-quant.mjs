import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as BS from "../shared/flows-quant-bs.js";
import * as SMILE from "../shared/flows-quant-smile.js";
import * as DENSITY from "../shared/flows-quant-density.js";
import * as WORLD from "../shared/flows-quant-world.js";
import * as STRUCT from "../shared/flows-quant-structures.js";
import * as ENGINE from "../shared/flows-quant-engine.js";
import * as TIME from "../shared/flows-quant-time.js";
import * as QC from "../shared/flows-quant-card.js";
import { STATE_STRUCTURES } from "../shared/flows-neuron.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = { ...BS, ...SMILE, ...DENSITY, ...WORLD, ...STRUCT, ...ENGINE, ...TIME };
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-quant-cases.json"), "utf8"));
const CASES = FIX.cases;
const BY_ID = Object.fromEntries(CASES.map((c) => [c.id, c]));
const BUDGET_ONLY = process.env.FLOWS_QUANT_BUDGET === "1";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const near = (a, b, tol, m) => {
  assert.ok(typeof a === "number" && Number.isFinite(a), `${m}: engine gave ${a}`);
  assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (|diff| ${Math.abs(a - b)} > ${tol})`);
  n++;
};
const nearRel = (a, b, rel, m) => near(a, b, rel * Math.max(Math.abs(b), 1e-300), m);

function compare(actual, expect, tol, where) {
  if (expect === null) { eq(actual, null, `${where} is null`); return; }
  if (typeof expect === "boolean" || typeof expect === "string") { eq(actual, expect, where); return; }
  if (typeof expect === "number") {
    if (tol.exact) { eq(actual, expect, where); return; }
    if (tol.rel !== undefined && tol.abs === undefined) nearRel(actual, expect, tol.rel, where);
    else near(actual, expect, tol.abs, where);
    return;
  }
  if (Array.isArray(expect)) {
    assert.ok(Array.isArray(actual), `${where}: engine gave ${JSON.stringify(actual)}, not an array`);
    eq(actual.length, expect.length, `${where} has ${expect.length} entries`);
    expect.forEach((e, i) => compare(actual[i], e, tol, `${where}[${i}]`));
    return;
  }
  for (const k of Object.keys(expect)) compare(actual === null || actual === undefined ? undefined : actual[k], expect[k], tol, `${where}.${k}`);
}

const scalarAt = (intervals) => {
  assert.ok(Array.isArray(intervals) && intervals.length === 1 && intervals[0][0] === intervals[0][1],
    `a single point was expected, the engine gave ${JSON.stringify(intervals)}`);
  return intervals[0][0];
};

const ERRATA = Object.freeze({
  "move.atmf-straddle-is-mad": {
    field: "meanAbsMove",
    reading: "atmfCall",
    reason: "the fixture's meanAbsMove is F(2N(sigma sqrt T/2) - 1), the undiscounted at-the-forward CALL alone; " +
      "E|S_T - F| = C_u(F) + P_u(F) is the whole straddle, which is what the case title, its own ratioToSigmaSqrtT " +
      "and spec A4 say, so the engine's meanAbsMove equals the straddle and the fixture number is checked as the call",
  },
});

const RUN = {
  "bsm.hull-call-put": (c) => BS.bsmPrice(c.inputs),
  "bsm.haug-put-yield": (c) => BS.bsmPrice(c.inputs),
  "bsm.put-call-parity": (c) => {
    const r = BS.bsmPrice(c.inputs);
    for (const row of r.rows) ok(Math.abs(row.cMinusP - row.rhs) <= 1e-12 * c.inputs.S, `parity holds to 1e-12 S at K=${row.K}`);
    return { rows: r.rows };
  },
  "black76.forward-equivalence": (c) => BS.black76Price(c.inputs),
  "greeks.fd-call": (c) => greekCase(c),
  "greeks.fd-put": (c) => greekCase(c),
  "iv.round-trip": (c) => {
    for (const x of c.inputs.cases) near(BS.impliedVol(x), x.sigma, c.tol.abs, `impliedVol recovers ${x.sigma} (${x.type} K=${x.K} T=${x.T})`);
    return null;
  },
  "iv.out-of-bounds": (c) => ({ sigma: c.inputs.cases.map((x) => BS.impliedVol(x)) }),
  "forward.parity-regression": (c) => BS.parityForward(c.inputs),
  "strike.from-delta-flat": (c) => {
    const call = BS.strikeForDelta({ ...c.inputs, ...c.inputs.targets[0] });
    const put = BS.strikeForDelta({ ...c.inputs, ...c.inputs.targets[1] });
    const smile = BS.strikeForDelta({ ...c.inputs, ...c.inputs.targets[0], vol: () => c.inputs.sigma });
    near(smile.K, call.K, 1e-9, "the bisection-on-a-smile path lands on the closed-form strike for a flat smile");
    return { callStrike: call.K, putStrike: put.K, d1Call: call.d1 };
  },
  "rnd.flat-is-lognormal": (c) => rndCase(c, { massMeanTol: 1e-6 }),
  "rnd.svi-closed-form": (c) => rndCase(c, { massMeanTol: c.tol.abs }),
  "pop.short-strangle-flat": (c) => {
    const r = ENGINE.structureMetrics(c.inputs);
    return { ...r, putPrice: r.legPrices[0], callPrice: r.legPrices[1] };
  },
  "ev.risk-neutral-zero-at-model": (c) => ENGINE.structureMetrics(c.inputs),
  "move.atmf-straddle-is-mad": (c) => {
    const r = DENSITY.impliedMove(c.inputs);
    const slice = SMILE.asSlice(c.inputs);
    const mad = ENGINE.lawIntegrate(DENSITY.lawFromSlice(slice), (x) => Math.abs(x - c.inputs.F), [c.inputs.F]);
    near(mad, r.straddle, 1e-7, "E|S_T - F| by quadrature over the RND equals the undiscounted ATMF straddle");
    near(r.meanAbsMove, r.straddle, 0, "the engine's mean absolute move is the straddle (spec A4)");
    ok(Math.abs(mad - c.expect.meanAbsMove) > 1, "and it is not the fixture's meanAbsMove, which is the call alone (see ERRATA)");
    return { ...r, meanAbsMove: r[ERRATA[c.id].reading] };
  },
  "svi.butterfly-arbitrage-vogt": (c) => SMILE.sviButterflyCheck(c.inputs),
  "svi.butterfly-clean": (c) => SMILE.sviButterflyCheck(c.inputs),
  "svi.calendar-arbitrage": (c) => SMILE.calendarCheck({ ...c.inputs, slices: c.inputs.slices.map((s) => ({ method: "svi", T: s.T, params: s.svi })) }),
  "svi.lee-wing-bound": (c) => SMILE.sviWingCheck(c.inputs),
  "ssvi.power-law-condition": (c) => {
    const rows = c.inputs.cases.map((x) => SMILE.ssviCheck(x));
    return { ok: rows.map((r) => r.ok), why: rows.map((r) => r.why) };
  },
  "svi.fit-recovers-parameters": (c) => {
    const r = SMILE.fitSvi(c.inputs);
    ok(r.rmseW <= c.tol.rmse, `the recovered slice fits the noise-free total variances to rmse ${r.rmseW} <= ${c.tol.rmse}`);
    return { params: r.params, rmseW: r.rmseW };
  },
  "term.fixed-tenor-variance-interp": (c) => SMILE.fixedTenorVol(c.inputs),
  "event.earnings-jump-from-term": (c) => SMILE.eventVariance(c.inputs),
  "event.no-premium": (c) => SMILE.eventVariance(c.inputs),
  "vrp.variance-and-vol-units": (c) => WORLD.varianceRiskPremium(c.inputs),
  "garch.average-variance": (c) => WORLD.garchAverageVariance(c.inputs),
  "skewt.hansen-moments": (c) => {
    const { nu, lambda_: lambda } = c.inputs;
    const own = (p, lo, hi) => DENSITY.integrate((z) => Math.pow(z, p) * WORLD.skewtDensity(z, nu, lambda), lo, hi, 400, 32);
    const r = WORLD.skewtMoments(c.inputs);
    near(own(0, -60, 60), 1, 1e-4, "skewtDensity itself integrates to one on [-60, 60] (the t5 tails beyond hold the rest)");
    near(own(0, -60, r.cutoff), r.leftMass, 1e-4, "and its left branch carries the moment routine's left mass");
    return r;
  },
  "gex.dollar-gamma-per-1pct": (c) => STRUCT.dollarGammaPer1pct(c.inputs),
  "levels.max-pain": (c) => STRUCT.maxPain(c.inputs),
  "structure.iron-condor-exact": (c) => ENGINE.structureMetrics(c.inputs),
  "structure.jade-lizard": (c) => {
    const r = ENGINE.structureMetrics(c.inputs);
    return { ...r, maxLossAt: scalarAt(r.maxLossAt) };
  },
  "structure.call-broken-wing-butterfly": (c) => {
    const r = ENGINE.structureMetrics(c.inputs);
    return { ...r, maxProfitAt: scalarAt(r.maxProfitAt) };
  },
  "structure.ratio-call-spread": (c) => {
    const r = ENGINE.structureMetrics(c.inputs);
    return { ...r, maxProfitAt: scalarAt(r.maxProfitAt) };
  },
  "structure.calendar-at-front-expiry": (c) => ENGINE.structureMetrics(c.inputs),
  "skew.rr-bf-from-smile": (c) => SMILE.skewMetrics(c.inputs),
  "skew.flat-is-zero": (c) => SMILE.skewMetrics(c.inputs),
  "rv.estimators": (c) => WORLD.realizedVol(c.inputs),
  "iv.rank-vs-percentile": (c) => WORLD.ivRankPercentile(c.inputs),
  "edge.p-equals-q-is-zero": (c) => {
    const base = BY_ID[c.inputs.ref];
    const r = ENGINE.structureMetrics({ ...base.inputs, realWorld: c.inputs.realWorld });
    near(r.popP, r.popQ, c.tol.abs, "with P = Q the real-world POP equals the risk-neutral POP");
    near(r.evP, r.evQ, c.tol.abs, "and the real-world EV equals the risk-neutral EV");
    return { edge: r.edge };
  },
  "realworld.drift-neutral-shift": (c) => DENSITY.driftNeutralShift(c.inputs),
  "event.mixture-frown": (c) => SMILE.mixturePrice({ ...c.inputs, strikes: Object.keys(c.expect.impliedVols).map(Number) }),
  "delta.sticky-moneyness-adjusted": (c) => BS.smileDelta(c.inputs),
  "pop.touch-probability": (c) => BS.touchProbability(c.inputs),
  "vix.model-free-variance-flat": (c) => {
    const r = DENSITY.modelFreeVariance(c.inputs);
    ok(r.truncatedMass < 1e-8, `integrating within six ATM sd leaves ${r.truncatedMass} of the mass outside`);
    return { ...r, exactVariance: c.inputs.flatVol * c.inputs.flatVol };
  },
  "realworld.sample-grid-integration": (c) => {
    const r = DENSITY.expectUnderSamples(c.inputs);
    near(r.callSampleMean, c.expect.callSampleMean, 1e-9, "the engine reproduces the 4096-sample call mean to 1e-9");
    near(r.pItmSample, c.expect.pItmSample, 1e-12, "and the sample ITM share exactly");
    near(r.forwardSampleMean, c.expect.forwardSampleMean, 1e-9, "and the sample forward to 1e-9");
    near(r.callSampleMean, r.callClosedForm, c.tol.abs, "the sample-mean call sits within the stated error of the closed form");
    near(r.pItmSample, r.pItmClosedForm, c.tol.abs, "and so does the ITM probability");
    return r;
  },
  "ssvi.slice-values": (c) => SMILE.ssviW(c.inputs),
  "forward.implied-carry": (c) => BS.impliedCarry(c.inputs),
  "pop.put-credit-spread-svi": (c) => {
    const r = ENGINE.structureMetrics(c.inputs);
    ok(r.breakevens.length === 1, "a put vertical has one breakeven");
    const atm = SMILE.sliceVol(SMILE.asSlice(c.inputs), c.inputs.F);
    const flat = { F: c.inputs.F, T: c.inputs.T, flatVol: atm };
    return { ...r, breakeven: r.breakevens[0], popIfFlatAtAtmVol: 1 - DENSITY.riskNeutralCdf(flat, r.breakevens[0]) };
  },
};

function greekCase(c) {
  const g = BS.bsmGreeks(c.inputs);
  for (const k of Object.keys(c.expect.closedForm)) nearRel(g[k], c.expect.closedForm[k], 1e-9, `${c.id}: closed-form ${k} to 1e-9 relative`);
  for (const k of Object.keys(c.expect.finiteDifference)) nearRel(g[k], c.expect.finiteDifference[k], c.tol.rel, `${c.id}: ${k} against central differences to ${c.tol.rel} relative`);
  for (const k of Object.keys(c.expect.perUnit)) nearRel(g.perUnit[k], c.expect.perUnit[k], 1e-9, `${c.id}: ${k}`);
  const S = c.inputs.S, h = 1e-3 * S;
  const px = (dS) => BS.bsmPrice({ ...c.inputs, S: S + dS })[c.inputs.type === "C" ? "call" : "put"];
  nearRel(g.speed, (px(2 * h) - 2 * px(h) + 2 * px(-h) - px(-2 * h)) / (2 * h * h * h), 1e-4, `${c.id}: speed against a centred third difference`);
  return null;
}

function rndCase(c, { massMeanTol }) {
  const e = c.expect, out = { cdf: {}, pdf: {} };
  for (const K of Object.keys(e.cdf)) out.cdf[K] = DENSITY.riskNeutralCdf(c.inputs, +K);
  if (e.pdf) for (const K of Object.keys(e.pdf)) out.pdf[K] = DENSITY.riskNeutralPdf(c.inputs, +K);
  if (e.blCdf) for (const K of Object.keys(e.blCdf)) near(out.cdf[K], e.blCdf[K], c.tol.abs, `${c.id}: closed-form CDF equals Breeden-Litzenberger at ${K}`);
  if (fin(e.blCdfAt110)) near(DENSITY.riskNeutralCdf(c.inputs, 110), e.blCdfAt110, c.tol.abs, `${c.id}: CDF equals Breeden-Litzenberger at 110`);
  if (fin(e.blPdfAt100)) near(DENSITY.riskNeutralPdf(c.inputs, 100), e.blPdfAt100, c.tol.abs, `${c.id}: density equals the second difference at 100`);
  const m = DENSITY.rndMoments(c.inputs);
  near(m.mass, e.mass, massMeanTol, `${c.id}: the density integrates to one`);
  near(m.mean, e.mean, massMeanTol, `${c.id}: with mean F`);
  if (fin(e.minG)) near(SMILE.sviButterflyCheck({ svi: c.inputs.svi, T: c.inputs.T, kGrid: [-3, 3, 0.01] }).minG, e.minG, c.tol.abs, `${c.id}: min g`);
  if (fin(e.atmVol)) near(SMILE.sliceVol(SMILE.asSlice(c.inputs), c.inputs.F), e.atmVol, c.tol.abs, `${c.id}: ATM vol`);
  return { cdf: out.cdf, pdf: e.pdf ? out.pdf : undefined };
}

const fin = (v) => typeof v === "number" && Number.isFinite(v);

if (!BUDGET_ONLY) {
  const seen = new Set();
  for (const c of CASES) {
    for (const fn of c.fn.split("/")) ok(typeof API[fn] === "function", `${c.id}: the engine exports ${fn}`);
    const run = RUN[c.id];
    ok(typeof run === "function", `${c.id} has a runner, so no case is skipped`);
    const actual = run(c);
    if (actual) {
      const expect = { ...c.expect };
      delete expect.property;
      if (c.id === "edge.p-equals-q-is-zero") delete expect.popP;
      if (c.id.startsWith("greeks.")) continue;
      if (c.id === "rnd.flat-is-lognormal" || c.id === "rnd.svi-closed-form") {
        compare(actual, { cdf: expect.cdf, ...(expect.pdf ? { pdf: expect.pdf } : {}) }, c.tol, c.id);
      } else compare(actual, expect, c.tol, c.id);
    }
    seen.add(c.id);
  }
  eq(seen.size, CASES.length, "every known-answer case ran");
  eq(CASES.length, 48, "the fixture holds the 48 cases the spec names");
}

let seed = WORLD.xoshiro128ss("flows-quant-properties");
const U = () => seed.uniform();
const between = (a, b) => a + (b - a) * U();

if (!BUDGET_ONLY) {
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const S = between(5, 500), K = S * Math.exp(between(-0.6, 0.6)), r = between(-0.01, 0.08), q = between(0, 0.06);
    const sigma = between(0.03, 2), T = between(1 / 365, 3);
    const p = BS.bsmPrice({ S, K, r, q, sigma, T });
    const e = Math.abs(p.call - p.put - (S * Math.exp(-q * T) - K * Math.exp(-r * T))) / S;
    if (e > worst) worst = e;
  }
  ok(worst <= 1e-12, `put-call parity holds for 2,000 random (S, K, r, q, sigma, T) to ${worst.toExponential(1)} S`);
}

if (!BUDGET_ONLY) {
  let worstOtm = 0, worstItmPrice = 0, nulls = 0;
  for (let i = 0; i < 2000; i++) {
    const sigma = between(0.03, 3), T = between(1 / 365, 3), F = 100, nu = sigma * Math.sqrt(T);
    const k = between(-4, 4) * nu, K = F * Math.exp(k), D = Math.exp(-between(0, 0.06) * T);
    const otm = k >= 0 ? "C" : "P", itm = otm === "C" ? "P" : "C";
    const p = BS.black76(F, D, K, sigma, T, otm);
    const iv = BS.black76ImpliedVol({ F, D, K, T, price: p, type: otm });
    if (iv === null) { nulls++; continue; }
    worstOtm = Math.max(worstOtm, Math.abs(iv - sigma));
    const pi = BS.black76(F, D, K, sigma, T, itm);
    const ivi = BS.black76ImpliedVol({ F, D, K, T, price: pi, type: itm });
    if (ivi === null) { nulls++; continue; }
    worstItmPrice = Math.max(worstItmPrice, Math.abs(BS.black76(F, D, K, ivi, T, itm) - pi) / Math.max(pi, 1));
  }
  eq(nulls, 0, "every in-bounds price over sigma in [0.03, 3], T in [1/365, 3], |k| <= 4 sigma sqrt T has an implied vol");
  ok(worstOtm <= 1e-7, `the OTM round trip recovers sigma to ${worstOtm.toExponential(1)} (tolerance 1e-7)`);
  ok(worstItmPrice <= 1e-10, `an ITM price, whose time value double precision may not carry, is reproduced by its vol to ${worstItmPrice.toExponential(1)}`);
}

function randomSsviSlice() {
  const T = between(7, 365) / 365;
  const atm = between(0.15, 0.8);
  const rho = between(-0.8, 0.2), gamma = between(0.2, 0.5);
  const eta = between(0.3, 1.9) / (1 + Math.abs(rho));
  return { T, params: SMILE.ssviToSvi({ theta: atm * atm * T, rho, eta, gamma }) };
}

const acceptedSlices = [];
const fitReport = { mean: null, below: null, draws: null, worst: null };
if (!BUDGET_ONLY) {
  let worstFis = 1, sumFis = 0, draws = 0, rmseWorst = 0, below = 0;
  for (let i = 0; i < 2000; i++) {
    const { T, params } = randomSsviSlice();
    const sd = Math.sqrt(SMILE.sviW(params, 0));
    const points = [];
    for (let j = 0; j < 21; j++) {
      const k = sd * (-2.5 + 4.5 * j / 20);
      const iv = Math.sqrt(SMILE.sviW(params, k) / T);
      const spread = 0.004 + 0.006 * Math.abs(k) / sd + 0.004 * U();
      const mid = iv + (U() - 0.5) * spread;
      points.push({ k, iv: mid, ivBid: mid - spread / 2, ivAsk: mid + spread / 2, weight: 1 / Math.pow(spread + 0.005, 2) });
    }
    const fit = SMILE.fitSvi({ T, points, space: "iv", xtol: 1e-8 });
    worstFis = Math.min(worstFis, fit.fitInSpread);
    if (fit.fitInSpread < 0.95) below++;
    sumFis += fit.fitInSpread; draws++;
    rmseWorst = Math.max(rmseWorst, fit.rmseIv);
    if (i < 400) {
      const slice = SMILE.fitSlice({ F: 100, D: 1, T, points: points.map((p) => ({ ...p })) });
      if (slice && slice.method !== "flat") acceptedSlices.push(slice);
    }
  }
  Object.assign(fitReport, { mean: sumFis / draws, below, draws, worst: worstFis });
  ok(sumFis / draws >= 0.95, `2,000 noisy synthetic smiles are fitted with ${(100 * sumFis / draws).toFixed(2)}% of their quotes inside the spread`);
  ok(below <= draws / 100, `and ${draws - below} of ${draws} individually reach >= 95% (worst ${worstFis.toFixed(4)}: least squares against noise up to the spread edge cannot promise every draw)`);
  ok(rmseWorst < 0.01, `and the weighted IV rmse never exceeds a vol point (worst ${(rmseWorst * 100).toFixed(3)} pts)`);
}

if (!BUDGET_ONLY) {
  ok(acceptedSlices.length >= 350, `the fallback ladder accepted ${acceptedSlices.length} of 400 noisy slices as SVI or SSVI`);
  let worstG = Infinity, cdfBad = 0;
  for (const s of acceptedSlices) {
    const p = SMILE.sliceSvi(s);
    for (let i = 0; i <= 600; i++) {
      const k = s.kMin - 0.5 + (s.kMax - s.kMin + 1) * i / 600;
      worstG = Math.min(worstG, SMILE.sviG(p, k));
    }
    let prev = -1;
    for (let i = 0; i <= 400; i++) {
      const K = s.F * Math.exp(s.kMin - 0.5 + (s.kMax - s.kMin + 1) * i / 400);
      const v = DENSITY.riskNeutralCdf(s, K);
      if (!(v >= 0 && v <= 1) || v < prev - 1e-12) cdfBad++;
      prev = v;
    }
  }
  ok(worstG >= -1e-9, `every accepted slice has g >= 0 on its check grid (worst ${worstG})`);
  eq(cdfBad, 0, "and its closed-form CDF is monotone inside [0, 1]");
}

function bruteProfile(legs, cost) {
  const Kmax = Math.max(...legs.map((l) => l.K || 0));
  const hi = 3 * Kmax, N = 10001, step = hi / (N - 1);
  const xs = [], v = [];
  for (let i = 0; i < N; i++) { const x = i * step; xs.push(x); v.push(ENGINE.payoffValue(legs, x) - cost); }
  const roots = [];
  for (let i = 0; i + 1 < N; i++) if ((v[i] < 0 && v[i + 1] > 0) || (v[i] > 0 && v[i + 1] < 0)) roots.push((xs[i] + xs[i + 1]) / 2);
  const tailSlope = (v[N - 1] - v[N - 2]) / step;
  return { max: Math.max(...v), min: Math.min(...v), roots, step, tailSlope };
}

function randomLegs() {
  const m = 1 + Math.floor(U() * 4);
  const legs = [];
  for (let i = 0; i < m; i++) {
    const K = 70 + 5 * Math.floor(U() * 13);
    const type = U() < 0.08 ? "S" : U() < 0.5 ? "C" : "P";
    const side = U() < 0.5 ? 1 : -1, qty = U() < 0.8 ? 1 : 2;
    legs.push({ type, K: type === "S" ? 100 : K, side, qty, price: type === "S" ? 100 : between(0.05, 12) });
  }
  return legs;
}

function checkAgainstBrute(legs, cost, label) {
  const e = ENGINE.expiryProfile(legs, cost);
  const b = bruteProfile(legs, cost);
  const maxSlope = legs.reduce((s, l) => s + l.qty, 0);
  const slack = maxSlope * b.step + 1e-9;
  if (e.profitUnbounded) ok(b.tailSlope > 0, `${label}: unbounded profit has a rising tail`);
  else ok(e.maxProfit >= b.max - 1e-9 && e.maxProfit <= b.max + slack, `${label}: max profit ${e.maxProfit} against grid ${b.max}`);
  if (e.lossUnbounded) ok(b.tailSlope < 0, `${label}: unbounded loss has a falling tail`);
  else ok(e.maxLoss <= b.min + 1e-9 && e.maxLoss >= b.min - slack, `${label}: max loss ${e.maxLoss} against grid ${b.min}`);
  const matched = b.roots.every((r) => e.breakevens.some((x) => Math.abs(x - r) <= b.step));
  ok(matched && e.breakevens.length === b.roots.length,
    `${label}: breakevens ${JSON.stringify(e.breakevens.map((x) => +x.toFixed(4)))} against grid ${JSON.stringify(b.roots.map((x) => +x.toFixed(2)))}`);
}

if (!BUDGET_ONLY) {
  for (let i = 0; i < 2000; i++) {
    const legs = randomLegs().map(ENGINE.normaliseLeg);
    const cost = legs.reduce((s, l) => s + l.side * l.qty * l.price, 0);
    checkAgainstBrute(legs, cost, `random structure ${i}`);
  }
}

if (!BUDGET_ONLY) {
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const { T, params } = randomSsviSlice();
    const F = between(20, 400), r = between(0, 0.06);
    const legs = randomLegs().filter((l) => l.type !== "S").map((l) => ({ ...l, K: F * l.K / 100 }));
    if (!legs.length) continue;
    const inp = { F, S: F * Math.exp(-r * T), r, q: 0, T, svi: params, legs: legs.map(({ price, ...l }) => ({ ...l, side: l.side > 0 ? "long" : "short" })), priceAt: "model" };
    const S0 = F * Math.exp(-r * T);
    const res = ENGINE.structureMetrics({ ...inp, S: S0 });
    worst = Math.max(worst, Math.abs(res.evQ / ENGINE.LOT) / S0);
  }
  ok(worst <= 1e-8, `a structure bought at its model value on a random SVI slice has EV_Q = 0 to ${worst.toExponential(1)} S`);
}

if (!BUDGET_ONLY) {
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const sigma = between(0.1, 1), T = between(5, 200) / 365;
    const legs = randomLegs().filter((l) => l.type !== "S").map(({ price, ...l }) => ({ ...l, side: l.side > 0 ? "long" : "short" }));
    if (!legs.length) continue;
    const r = ENGINE.structureMetrics({ S: 100, r: 0.03, q: 0.01, T, flatVol: sigma, legs, priceAt: "model", realWorld: { kind: "lognormal", vol: sigma, driftNeutral: true } });
    worst = Math.max(worst, Math.abs(r.edge), Math.abs(r.popP - r.popQ));
  }
  ok(worst <= 1e-9, `P = Q gives zero edge and equal POP on 300 random structures (worst ${worst.toExponential(1)})`);
}

if (!BUDGET_ONLY) {
  let worstCentral = 0, worstAll = 0;
  for (const [sigma, T] of [[0.3, 30 / 365], [0.6, 60 / 365], [0.2, 7 / 365], [0.9, 0.5]]) {
    const law = DENSITY.lawBinned({ S: 100, ...DENSITY.binnedFromLognormal({ sigma, T, forwardOverSpot: 1 }) });
    const ln = DENSITY.lawLognormal({ F: 100, sigma, T });
    const lo = DENSITY.lawQuantile(ln, 0.02), hi = DENSITY.lawQuantile(ln, 0.98);
    for (let K = 40; K <= 260; K += 0.25) {
      const e = Math.abs(DENSITY.lawHinge(law, K) - DENSITY.lawHinge(ln, K)) / 100;
      worstAll = Math.max(worstAll, e);
      if (K >= lo && K <= hi) worstCentral = Math.max(worstCentral, e);
    }
    near(DENSITY.lawMean(law), 100, 1e-9, `the 64-bin law of a lognormal (${sigma}, ${(T * 365).toFixed(0)}d) keeps its mean`);
  }
  ok(worstCentral <= 1e-5, `inside the central 96% a vanilla on the 64-bin law is within ${worstCentral.toExponential(2)} S of the lognormal`);
  ok(worstAll <= 1e-4, `and in the open tail bins within ${worstAll.toExponential(2)} S`);
}

const GJR = Object.freeze({ omega: 0.0000045, alpha: 0.05, gamma: 0.08, beta: 0.88, sigma2Next: 0.00046, nu: 6, lambda: -0.15 });
const SIM = WORLD.simulateGjr(GJR, { seed: WORLD.seedKey("SYN", "2026-09-21"), horizons: [5, 10, 21, 42], paths: 8192 });
const SIM_FWD = { 5: 1.0006, 10: 1.0011, 21: 1.0024, 42: 1.0048 };
const SIM_LAWS = WORLD.binnedLawsFromSimulation(SIM, SIM_FWD);
if (!BUDGET_ONLY) {
  const again = WORLD.simulateGjr(GJR, { seed: WORLD.seedKey("SYN", "2026-09-21"), horizons: [5, 10, 21, 42], paths: 8192 });
  ok(Array.from(again[21]).every((x, i) => x === SIM[21][i]), "the seeded simulation reproduces itself path for path");
  const other = WORLD.simulateGjr(GJR, { seed: WORLD.seedKey("SYN", "2026-09-22"), horizons: [21], paths: 64 });
  ok(Array.from(other[21]).some((x, i) => x !== SIM[21][i]), "and another session date draws another sample");
  for (const h of [5, 10, 21, 42]) {
    const law = DENSITY.lawBinned({ S: 100, ...SIM_LAWS[h] });
    near(DENSITY.lawMean(law) / 100, SIM_FWD[h], 1e-6, `the binned P law at ${h} sessions is drift-neutral: E[S_T] = F`);
    ok(SIM_LAWS[h].edges.length === 65 && SIM_LAWS[h].means.length === 64, `and stores 65 edges and 64 means at ${h} sessions`);
  }
  const sd = (h) => WORLD.aggregatedSd(GJR, h);
  const mid = DENSITY.interpolateBinned({ lower: SIM_LAWS[21], upper: SIM_LAWS[42], h: 30, sd, forwardOverSpot: 1.0034 });
  near(DENSITY.lawMean(DENSITY.lawBinned({ S: 100, ...mid })) / 100, 1.0034, 1e-6, "an interpolated horizon is re-shifted to its own forward");
  const jumped = DENSITY.overlayJumps({ bins: SIM_LAWS[21], jumps: [{ x: 0.06, p: 0.5 }, { x: -0.06, p: 0.5 }], forwardOverSpot: 1.0024 });
  const jl = DENSITY.lawBinned({ S: 100, ...jumped });
  near(DENSITY.lawMean(jl) / 100, 1.0024, 1e-6, "an event overlay keeps the law drift-neutral");
  const base = DENSITY.lawBinned({ S: 100, ...SIM_LAWS[21] });
  ok(DENSITY.lawHinge(jl, 110) > DENSITY.lawHinge(base, 110), "and a symmetric jump fattens the tail a 10% OTM call reads");
  let sum = 0, sum2 = 0, left = 0;
  const rng = WORLD.xoshiro128ss(7);
  const cutoff = WORLD.skewtMoments({ nu: 5, lambda_: -0.2 }).cutoff;
  for (let i = 0; i < 20000; i++) {
    const z = WORLD.skewtDraw(rng, 5, -0.2);
    sum += z; sum2 += z * z;
    if (z < cutoff) left++;
  }
  near(sum / 20000, 0, 0.03, "Hansen skew-t draws have zero mean");
  near(sum2 / 20000, 1, 0.08, "and unit variance");
  near(left / 20000, 0.6, 0.015, "and put (1 - lambda)/2 of the mass on the left branch");
}

const SVI_TRUE = Object.freeze({ a: 0.006, b: 0.06, rho: -0.55, m: 0.02, sigma: 0.12 });
const AS_OF = "2026-09-21T20:30:00Z";

function synthChain({ S = 100, r = 0.04, q = 0.01, expiry = "2026-10-23", svi = SVI_TRUE, lo = 50, hi = 149.5, step = 0.5, key = "chain" } = {}) {
  const T = TIME.yearFraction(Date.parse(AS_OF), expiry);
  const F = S * Math.exp((r - q) * T), D = Math.exp(-r * T);
  const rng = WORLD.xoshiro128ss(key + expiry);
  const rows = [];
  for (let K = lo; K <= hi + 1e-9; K = Math.round((K + step) * 100) / 100) {
    const k = Math.log(K / F), vol = Math.sqrt(SMILE.sviW(svi, k) / T);
    for (const type of ["C", "P"]) {
      const price = BS.black76(F, D, K, vol, T, type);
      const hs = Math.max(0.02, 0.015 * price);
      const mid = price + (rng.uniform() - 0.5) * hs;
      const bid = Math.max(0, Math.floor((mid - hs) * 100) / 100), ask = Math.ceil((mid + hs) * 100) / 100;
      const oi = Math.round(6000 * Math.exp(-Math.abs(k) / 0.12)) + 40;
      rows.push({ K, type, bid, ask, oi, volume: Math.round(oi / 5), ivSeed: vol * (1 + (rng.uniform() - 0.5) * 0.04),
        sym: "SYN" + expiry.replace(/-/g, "").slice(2) + type + String(Math.round(K * 1000)).padStart(8, "0") });
    }
  }
  return { rows, F, D, T, vol: (K) => Math.sqrt(SMILE.sviW(svi, Math.log(K / F)) / T) };
}

function synthInput(over = {}) {
  const expiries = (over.expiryList || ["2026-10-23"]).map((e, i) => ({ expiry: e, rows: synthChain({ expiry: e, svi: over.sviFor ? over.sviFor(i) : SVI_TRUE }).rows }));
  return {
    ticker: "SYN", asOf: AS_OF, spot: 100, rate: 0.04, expiries,
    pLaw: {
      model: "gjr", grade: 3, knots: [5, 10, 21, 42].map((h) => ({ h, ...SIM_LAWS[h] })),
      ewmaVol: 0.36, coneMedianVol: 0.31, params: GJR,
    },
    facts: {
      "iv.pct.30": { v: 0.82, g: 3 }, "vrp.rel.21": { v: 0.16, g: 3 }, "term.slope.30_90.exEvent": { v: -0.02, g: 2 },
      "skew.rr25.30.pct": { v: 0.62, g: 2 },
    },
    state: { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich },
    levels: { callWall: 106, putWall: 94, magnet: 100, flip: 97, atr: 2.1, maxPain: 100 },
    ...over,
  };
}

const CPU_CLOCK = typeof process.threadCpuUsage === "function" ? "thread-cpu" : "wall";
const WINDOWS = 16, PER_WINDOW = 5;
const clockNow = () => {
  if (CPU_CLOCK === "thread-cpu") { const c = process.threadCpuUsage(); return (c.user + c.system) / 1000; }
  return Number(process.hrtime.bigint()) / 1e6;
};
function measure(f) {
  for (let i = 0; i < 40; i++) f();
  const windows = [];
  for (let w = 0; w < WINDOWS; w++) {
    const t0 = clockNow();
    for (let i = 0; i < PER_WINDOW; i++) f();
    windows.push((clockNow() - t0) / PER_WINDOW);
  }
  const sorted = windows.slice().sort((a, b) => a - b);
  return {
    mean: windows.reduce((a, b) => a + b, 0) / windows.length,
    median: (sorted[WINDOWS / 2 - 1] + sorted[WINDOWS / 2]) / 2,
    p95: sorted[Math.min(WINDOWS - 1, Math.floor(0.95 * WINDOWS))], min: sorted[0],
  };
}

function budget() {
  const timeIt = (input) => ({ structures: ENGINE.runEngine(input).structures.length, ...measure(() => ENGINE.runEngine(input)) });
  const rich = { state: "premium-rich", direction: null, confidence: 2, ...STATE_STRUCTURES["premium-rich"] };
  const facts = { ...synthInput().facts, "skew.rr25.30.pct": { v: 0.85, g: 3 } };
  const worst = synthInput({ topFamilies: 12, facts, state: rich });
  const normal = synthInput({ facts, state: rich });
  const vendor = normal.expiries[0].rows.map((r) => ({
    option_symbol: r.sym, nbbo_bid: String(r.bid), nbbo_ask: String(r.ask), implied_volatility: String(r.ivSeed),
    open_interest: r.oi, volume: r.volume, last_tape_time: "2026-09-21T19:58:00Z",
  }));
  const card = JSON.parse(JSON.stringify({
    facts: Object.entries(facts).map(([id, f]) => ({ id, v: f.v, u: "frac", g: f.g })),
    state: rich, pLaw: normal.pLaw, levels: normal.levels, rate: { r: 0.04, method: "constant", n: 0 }, atr: 2.1,
  }));
  const route = () => QC.runCardEngine({
    ticker: "SYN", asOfMs: Date.parse(AS_OF), spot: 100, expiries: QC.chainRowsByExpiry(vendor, { ticker: "SYN" }).expiries,
    rate: card.rate, facts: card.facts, state: card.state, pLaw: card.pLaw, levels: card.levels, atr: card.atr,
  });
  const probe = route();
  return {
    clock: CPU_CLOCK, window: PER_WINDOW, rows: worst.expiries[0].rows.length, worst: timeIt(worst), normal: timeIt(normal),
    route: { rows: vendor.length, structures: probe.priced, ...measure(route) },
  };
}

if (BUDGET_ONLY) {
  console.log(JSON.stringify(budget()));
  process.exit(0);
}

const BASE = synthInput();
const OUT = ENGINE.runEngine(BASE);
{
  const ex = OUT.expiries[0];
  const truth = synthChain();
  eq(ex.smile.method, "svi", "a clean 400-quote chain is fitted by raw SVI");
  near(ex.smile.atmIv, truth.vol(ex.forward.F), 0.02, "the chain's ATM IV sits within 2 vol points of the generating smile (defect 1)");
  near(ex.forward.F, truth.F, 0.02, "the parity forward recovers the generating forward to two cents");
  ok(ex.smile.checks.ok && ex.smile.checks.minG >= 0, "the fitted slice passes the butterfly, Lee and minimum-variance checks");
  ok(OUT.structures.length >= 5 && OUT.structures.length <= 24, `the engine prices ${OUT.structures.length} candidates, within the 24 the Worker allows`);
  const avoid = BASE.state.avoid;
  for (const s of OUT.structures) {
    const fam = STRUCT.STRUCTURE_BY_ID[s.family];
    ok(![fam.neuron, ...fam.kin].some((x) => avoid.includes(x)), `${s.id} ${s.family} is not on the state's avoid list`);
    if (fam.risk === "undefined") {
      ok(s.grade <= 2 && s.capital.kind === "reg-t", `${s.id} is undefined-risk: grade at most 2 on a Reg-T capital`);
      eq(s.gradeWhy.includes("risk.undefined"), Math.min(...Object.values(s.gradeParts)) > 2, `${s.id}: the cap is named exactly when it binds`);
    }
    ok(s.grade === Math.min(...Object.values(s.gradeParts), fam.risk === "undefined" ? 2 : 3), `${s.id}: the grade is the weakest component`);
    near(s.ev.edge, (s.ev.p === null ? NaN : s.ev.p) - s.ev.q, 0.011, `${s.id}: edge = EV_P - EV_Q`);
    const legs = s.legs.map((l) => ({ type: l.type, K: l.k, side: l.side, qty: l.qty }));
    if (new Set(s.legs.map((l) => l.expiry)).size === 1) {
      const e = ENGINE.expiryProfile(legs.map(ENGINE.normaliseLeg), s.price.fill);
      near(s.maxProfit === null ? 0 : s.maxProfit, e.maxProfit === null ? 0 : Math.round(e.maxProfit * 100 * 100) / 100, 0.011, `${s.id}: max profit restates`);
      checkAgainstBrute(legs.map(ENGINE.normaliseLeg), s.price.fill, `${s.id} ${s.family}`);
      ok(s.price.fill === Math.round((s.price.mid + 0.25 * (s.price.natural - s.price.mid)) * 1e4) / 1e4 ||
        Math.abs(s.price.fill - (s.price.mid + 0.25 * (s.price.natural - s.price.mid))) <= 1e-4, `${s.id}: fill is a quarter of the way from mid to natural`);
    }
  }
  ok(OUT.ideas.length >= 1 && OUT.ideas.length <= 3, `the engine publishes ${OUT.ideas.length} ideas`);
  const first = OUT.structures.find((s) => s.id === OUT.ideas[0]);
  eq(first.risk, "defined", "the first idea is defined-risk");
  ok(BASE.state.preferred.includes(STRUCT.STRUCTURE_BY_ID[first.family].neuron), `and in the pinned state's preferred list (${first.family})`);
  eq(new Set(OUT.ideas.map((id) => OUT.structures.find((s) => s.id === id).family)).size, OUT.ideas.length, "the ideas are distinct families");
  for (const id of OUT.ideas) {
    const s = OUT.structures.find((x) => x.id === id);
    ok(s.grade >= 1 && s.ev.p > 0, `${id} has grade >= 1 and a positive EV_P at the fill`);
    ok(s.grid && s.grid.pnl.length >= 7 && s.grid.vol.length === 3 && s.grid.days.length === 4, `${id} carries its scenario grid`);
    const zi = s.grid.spot.indexOf(Math.round(100 * 1e4) / 1e4);
    ok(zi >= 0, `${id}: the grid has a row at spot`);
    near(s.grid.pnl[zi][1][0], (s.price.model - s.price.fill) * 100, 0.02, `${id}: the grid centre equals the T+0 value at spot`);
  }
  const scores = OUT.ideas.slice(1).map((id) => OUT.structures.find((s) => s.id === id).score);
  ok(scores.every((v, i) => i === 0 || scores[i - 1] >= v), "ideas after the first are ordered by EV per unit of capital");
}

{
  const shuffled = synthInput();
  const rng = WORLD.xoshiro128ss("shuffle");
  for (const e of shuffled.expiries) {
    const rows = e.rows.slice();
    for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rng.uniform() * (i + 1)); const t = rows[i]; rows[i] = rows[j]; rows[j] = t; }
    e.rows = rows;
  }
  const a = JSON.stringify(ENGINE.runEngine(BASE)), b = JSON.stringify(ENGINE.runEngine(BASE)), c = JSON.stringify(ENGINE.runEngine(shuffled));
  eq(a, b, "the same inputs give byte-identical output");
  eq(a, c, "and shuffling the chain's row order changes nothing");
  const two = synthInput({ expiryList: ["2026-10-16", "2026-11-20"] });
  const twoRev = { ...two, expiries: two.expiries.slice().reverse() };
  eq(JSON.stringify(ENGINE.runEngine(two)), JSON.stringify(ENGINE.runEngine(twoRev)), "nor does the order the expiries arrive in");
  ok(!/NaN|Infinity|"-?inf"/.test(a), "no NaN or Infinity reaches the JSON, as a number or as a string");
}

{
  const cal = synthInput({
    expiryList: ["2026-10-16", "2026-11-20"],
    facts: { ...BASE.facts, "term.slope.30_90.exEvent": { v: 0.09, g: 3 }, "iv.pct.30": { v: 0.3, g: 3 }, "vrp.rel.21": { v: 0, g: 3 } },
    state: { state: "premium-cheap", direction: null, confidence: 2, ...STATE_STRUCTURES["premium-cheap"] },
    sviFor: (i) => (i === 0 ? { ...SVI_TRUE, a: 0.009 } : { ...SVI_TRUE, a: 0.02 }),
    topFamilies: 8,
  });
  const out = ENGINE.runEngine(cal);
  const c = out.structures.find((s) => s.family === "long-calendar");
  ok(c && new Set(c.legs.map((l) => l.expiry)).size === 2, "a steep front builds a two-expiry long calendar");
  ok(c.maxLoss < 0 && c.maxProfit > 0 && !c.lossUnbounded, "whose front-expiry profile is numeric and bounded");
  near(c.ev.q, (c.price.model - c.price.fill) * 100, 0.02,
    "on a skewed smile the calendar bought at its fill has EV_Q equal to model minus fill: the back leg revalued at the front expiry reprices");
  const all = ENGINE.runEngine({ ...cal, grids: "all" }).structures.find((s) => s.family === "long-calendar");
  const zi = all.grid.spot.indexOf(100);
  near(all.grid.pnl[zi][1][0], (all.price.model - all.price.fill) * 100, 0.02, "and its scenario grid's centre is the same model value");
  const at = (expiry, svi) => {
    const T = TIME.yearFraction(Date.parse(AS_OF), expiry);
    return { method: "svi", T, F: 100 * Math.exp(0.03 * T), D: Math.exp(-0.04 * T), params: svi };
  };
  let worstBias = 0;
  for (const [fp, bp] of [[{ ...SVI_TRUE, a: 0.009 }, { ...SVI_TRUE, a: 0.02 }], [{ ...SVI_TRUE, rho: 0 }, { ...SVI_TRUE, rho: 0, a: 0.02 }], [{ ...SVI_TRUE, rho: -0.8, b: 0.1 }, { ...SVI_TRUE, rho: -0.7, b: 0.08, a: 0.03 }]]) {
    const front = at("2026-10-16", fp), back = at("2026-11-20", bp);
    const vctx = { sliceOf: (l) => (l.T > front.T ? back : front), frontT: front.T, frontSlice: front, r: 0.04, q: 0.01, spot: 100 };
    const qLaw = DENSITY.lawFromSlice(front);
    for (const K of [85, 95, 100, 105, 115]) for (const type of ["C", "P"]) {
      const legs = ENGINE.calibrateBackLegs([{ type, K, side: 1, qty: 1, T: back.T }], vctx, qLaw, 100);
      const e = ENGINE.lawIntegrate(qLaw, (x) => ENGINE.structureValue(legs, vctx, x, front.T, 0), [K]);
      worstBias = Math.max(worstBias, Math.abs(front.D * e - ENGINE.structureValue(legs, vctx, 100, 0, 0)));
    }
  }
  ok(worstBias <= 1e-8 * 100, `a back leg revalued on the forward smile at the front expiry keeps its price under Q to ${worstBias.toExponential(1)} (1e-8 S)`);
}

{
  const vetoed = (over) => ENGINE.runEngine(synthInput(over));
  const tierC = vetoed({ expiries: [{ expiry: "2026-10-23", rows: synthChain().rows.map((r) => ({ ...r, ask: Math.round((r.ask + Math.max(0.3, 0.3 * r.ask)) * 100) / 100 })) }] });
  eq(tierC.liquidity.tier, "C", "a chain with wide spreads is liquidity tier C");
  ok(tierC.structures.every((s) => STRUCT.STRUCTURE_BY_ID[s.family].n < 11 || STRUCT.STRUCTURE_BY_ID[s.family].n > 22), "and tier C prices only verticals and long options");
  const und = vetoed({ state: { state: "undetermined", confidence: 0, preferred: ["no position"], avoid: [] } });
  eq(und.structures.length, 0, "an undetermined state with fair VRP prices nothing");
  eq(und.noTrade && und.noTrade.code, "candidates.none", "and stands aside with a reason code");
  const undCheap = vetoed({ state: { state: "undetermined", confidence: 0, preferred: ["no position"], avoid: [] }, facts: { ...BASE.facts, "vrp.rel.21": { v: -0.2, g: 3 } } });
  ok(undCheap.structures.length > 0 && undCheap.structures.every((s) => s.family === "long-straddle" || s.family === "long-strangle"),
    "with VRP cheap it allows only the long straddle and strangle");
  const ev = vetoed({ event: { date: "2026-10-20", moves: [] } });
  ok(ev.structures.every((s) => { const f = STRUCT.STRUCTURE_BY_ID[s.family]; return !(f.vol === "short" || f.premium === "credit"); }),
    "an earnings date inside the expiry vetoes every short-premium family");
  ok(ev.families.some((f) => f.veto.includes("event.inside")), "and says so with event.inside");
  const stale = vetoed({ stale: true });
  ok(stale.structures.length > 0 && stale.structures.every((s) => s.grade <= 1), "a stale card caps every grade at 1");
  ok(stale.structures.every((s) => s.gradeWhy.includes("card.stale") === Math.min(...Object.values(s.gradeParts)) > 1), "and names the cap exactly when it binds");
  const degenerate = vetoed({ pLaw: { ...BASE.pLaw, grade: 2, why: ["garch.alpha-degenerate"] } });
  ok(degenerate.structures.every((s) => s.grade <= 2), "a degenerate GARCH (alpha < 0.01) grades every structure at most 2 (defect 6)");
  ok(degenerate.structures.some((s) => s.gradeWhy.includes("garch.alpha-degenerate")), "and names the reason");
  const noP = vetoed({ pLaw: null });
  ok(noP.structures.every((s) => s.ev.p === null && s.grade === 0), "with no P law there is no EV_P and every grade is withheld");
  eq(noP.noTrade && noP.noTrade.code, "model.none", "and the engine stands aside for want of a model");
  const lone = ENGINE.rankStructures([{ id: "S1", family: "short-strangle", risk: "undefined", grade: 2, ev: { p: 5 }, score: 0.1, prob: { popP: 0.8 } }], { preferred: [] });
  ok(lone.ideas.length === 0 && lone.noTrade.code === "risk.undefined-only" && lone.noTrade.closest === "S1",
    "when only undefined-risk structures qualify the engine stands aside and says so, rather than blaming the grades");
  const desk = vetoed({ desk: true, topFamilies: 12 });
  const cc = desk.structures.filter((s) => s.family === "covered-call");
  ok(cc.length > 0 && cc.every((s) => Math.abs(s.greeks.deltaAdj$ - s.greeks.delta$) < 0.1 * 100 * 100),
    "a covered call's smile-adjusted delta carries its hundred shares, as its Black-Scholes delta does");
  ok(noP.noTrade.closest !== undefined, "showing the closest candidate slot");
  const cheapP = vetoed({ pLaw: { ...BASE.pLaw, knots: [5, 10, 21, 42].map((h) => ({ h, ...DENSITY.binnedFromLognormal({ sigma: 0.9, T: h / 252, forwardOverSpot: 1 }) })), ewmaVol: 0.9, coneMedianVol: 0.9 } });
  ok(cheapP.ideas.length === 0 && cheapP.noTrade && cheapP.noTrade.code === "ev.none-positive" && cheapP.noTrade.closest,
    "when the real world is far wilder than the smile no short-premium idea has positive EV, and the closest is shown greyed");
  const bull = vetoed({ state: { state: "squeeze", direction: "bullish", confidence: 3, ...STATE_STRUCTURES.bull.cheap }, facts: { ...BASE.facts, "iv.pct.30": { v: 0.2, g: 3 }, "vrp.rel.21": { v: -0.15, g: 3 } } });
  ok(bull.structures.every((s) => !["bear"].includes(s.dir)), "a bullish squeeze prices no bearish structure");
  ok(bull.structures.some((s) => s.family === "long-call" || s.family === "call-debit-spread"), "and reaches for calls when vol is cheap");
}

{
  const rich = { state: "premium-rich", direction: null, confidence: 2, ...STATE_STRUCTURES["premium-rich"] };
  const facts = { ...BASE.facts, "skew.rr25.30.pct": { v: 0.85, g: 3 } };
  const lizards = (rows) => ENGINE.runEngine(synthInput({ topFamilies: 20, facts, state: rich, ...(rows ? { expiries: [{ expiry: "2026-10-23", rows }] } : {}) }))
    .structures.filter((s) => s.family === "jade-lizard");
  const upside = (s) => ENGINE.expiryProfile(s.legs.map((l) => ENGINE.normaliseLeg({ type: l.type, K: l.k, side: l.side, qty: l.qty })), s.price.fill);
  const fine = lizards(null);
  ok(fine.length > 0 && fine.every((s) => s.legs[2].k - s.legs[1].k <= -s.price.fill + 1e-9 && upside(s).valueRight >= 0),
    `on half-dollar strikes the jade lizard's credit covers its call width, so it has no upside risk (${fine.length} priced)`);
  const coarse = lizards(synthChain({ step: 5, lo: 50, hi: 150 }).rows);
  ok(coarse.every((s) => upside(s).valueRight >= 0),
    "on five-dollar strikes a lizard whose credit cannot cover the call width is not priced as one: no jade lizard carries upside risk");
}

{
  const wing = synthChain();
  const garbage = wing.rows.map((r) => (r.K >= 140 || r.K <= 55 ? { ...r, bid: 0.01, ask: 0.05 } : r));
  const prep = SMILE.prepareQuotes({ F: wing.F, D: wing.D, T: wing.T, rows: garbage });
  ok(prep.points.every((p) => p.K > 55 && p.K < 140), "minimum-tick wing quotes never reach the fit (defect 2)");
  ok(prep.points.every((p) => p.iv < 3 * Math.sqrt(SMILE.sviW(SVI_TRUE, 0) / wing.T)), "so no surface cell exceeds three times the ATM IV");
  const few = SMILE.fitSlice({ F: 100, D: 1, T: 0.1, points: [{ k: 0, iv: 0.3, ivBid: 0.29, ivAsk: 0.31 }, { k: 0.05, iv: 0.29, ivBid: 0.28, ivAsk: 0.3 }] });
  eq(few.method, "flat", "one or two quotes fall back to a flat slice");
  const four = SMILE.fitSlice({ F: 100, D: 1, T: 0.1, points: [-0.1, -0.03, 0.02, 0.08].map((k) => ({ k, iv: 0.3 - 0.2 * k, ivBid: 0.29 - 0.2 * k, ivAsk: 0.31 - 0.2 * k })) });
  eq(four.method, "ssvi", "three or four quotes are fitted by SSVI");
  const mix = SMILE.mixturePrice({ F: 100, T: 10 / 365, diffusiveVol: 0.25, up: 1.08, down: 0.92, weights: [0.5, 0.5] });
  const frown = [-0.12, -0.08, -0.05, -0.03, -0.01, 0, 0.01, 0.03, 0.05, 0.08, 0.12].map((k) => {
    const iv = SMILE.sliceVolK(mix.slice, k);
    return { k, iv, ivBid: iv - 0.004, ivAsk: iv + 0.004 };
  });
  for (const [days, J] of [[25, 0.07], [36, 0.07], [60, 0.07], [25, 0.04]]) {
    const T = days / 365;
    const m = SMILE.mixturePrice({ F: 100, T, diffusiveVol: 0.3, J });
    const pts = [];
    for (let K = 60; K <= 140; K += 1) {
      const iv = SMILE.sliceVol(m.slice, K), price = BS.black76(100, 1, K, iv, T, K >= 100 ? "C" : "P");
      const hs = Math.max(0.02, 0.015 * price);
      const ivOf = (p) => BS.black76ImpliedVol({ F: 100, D: 1, K, T, price: p, type: K >= 100 ? "C" : "P" });
      const bid = Math.floor((price - hs) * 100) / 100, ask = Math.ceil((price + hs) * 100) / 100;
      if (!(bid > 0.05)) continue;
      pts.push({ k: Math.log(K / 100), iv, ivBid: ivOf(bid), ivAsk: ivOf(ask), weight: 1 / Math.pow(ivOf(ask) - ivOf(bid) + 0.005, 2) });
    }
    const chosen = SMILE.fitSlice({ F: 100, D: 1, T, points: pts });
    const svi = SMILE.fitSvi({ T, points: pts, space: "iv", xtol: 1e-8 });
    const sviIn = SMILE.sliceChecks(svi.params, T, pts[0].k, pts[pts.length - 1].k, null).ok;
    const ss = SMILE.fitSsvi({ slices: [{ T, points: pts }] });
    ok(Math.abs(ss.rho) <= SMILE.SMILE_LINES.SSVI_RHO_MAX, `a one-slice SSVI keeps |rho| off 1 (${ss.rho}), so its raw form keeps a positive sigma`);
    const best = Math.max(sviIn ? svi.fitInSpread : 0, ss.check.ok ? ss.slices[0].fitInSpread : 0);
    ok(chosen.fitInSpread >= best - 1e-12,
      `an event frown ${days} days out: the ladder keeps the better of an in-bounds SVI (${svi.fitInSpread.toFixed(3)}) and SSVI ` +
      `(${ss.slices[0].fitInSpread.toFixed(3)}), not SSVI by default (${chosen.method} ${chosen.fitInSpread.toFixed(3)})`);
    const g = ENGINE.fitGrade(chosen, true);
    ok(chosen.fitInSpread >= 0.6 ? g.g >= 2 : g.g === 1 && g.why === "fit.out-of-spread",
      `and a slice with ${(100 * chosen.fitInSpread).toFixed(0)}% of its quotes in spread grades ${g.g}, whatever method drew it`);
  }
  {
    const onDay = "2026-10-09", T = TIME.yearFraction(Date.parse(AS_OF), onDay), F = 100 * Math.exp(0.03 * T), D = Math.exp(-0.04 * T);
    const m = SMILE.mixturePrice({ F, T, diffusiveVol: 0.3, J: 0.07 });
    const rows = [];
    for (let K = 60; K <= 140; K += 1) {
      const vol = SMILE.sliceVol(m.slice, K);
      for (const type of ["C", "P"]) {
        const price = BS.black76(F, D, K, vol, T, type), hs = Math.max(0.02, 0.015 * price);
        rows.push({ K, type, bid: Math.max(0, Math.floor((price - hs) * 100) / 100), ask: Math.ceil((price + hs) * 100) / 100, oi: 3000, volume: 100, ivSeed: vol });
      }
    }
    const spanning = ENGINE.runEngine(synthInput({ expiries: [{ expiry: onDay, rows }], event: { date: onDay, moves: [] } }));
    const built = QC.buildSlices([{ expiry: onDay, rows }], { spot: 100, asOfMs: Date.parse(AS_OF), rate: 0.04, event: { date: onDay } });
    eq([spanning.expiries[0].smile.method, built.built[0].slice.method], ["mixture", "mixture"],
      "an earnings impact session on the expiry date itself is inside that expiry, so the engine and the card's pre-pass both fit it as the first post-event slice");
  }
  const evSlice = SMILE.fitSlice({ F: 100, D: 1, T: 10 / 365, points: frown, event: { firstAfter: true } });
  eq(evSlice.method, "mixture", "the first post-earnings expiry with an ATM frown falls back to the two-lognormal mixture");
  near(evSlice.params.J, Math.log(1.08 / Math.sqrt(1.08 * 0.92)), 0.01, "and recovers the jump that made the frown");
  const vogtish = [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2].map((k) => {
    const w = SMILE.sviW({ a: -0.041, b: 0.1331, rho: 0.306, m: 0.3586, sigma: 0.4153 }, k);
    const iv = Math.sqrt(w);
    return { k, iv, ivBid: iv - 0.002, ivAsk: iv + 0.002 };
  });
  const rep = SMILE.fitSlice({ F: 100, D: 1, T: 1, points: vogtish });
  ok(rep.method !== "svi", `quotes read off Vogt's arbitrageable slice are not accepted as clean SVI (${rep.method})`);
  ok(rep.method === "flat" || (rep.checks && rep.checks.ok), "whatever the ladder settles on passes the butterfly check");
}

{
  const w = STRUCT.wallsFromBook({ spot: 43.23, rows: [
    { strike: 40, callGammaOi: 1e5, putGammaOi: -9e5 }, { strike: 42.5, callGammaOi: 3e5, putGammaOi: -4e5 },
    { strike: 45, callGammaOi: 8e5, putGammaOi: -1e5 }, { strike: 48, callGammaOi: 2e5, putGammaOi: -2e6 },
  ] });
  ok(w.putWall <= 43.23 && 43.23 <= w.callWall, `the put wall ${w.putWall} <= spot <= the call wall ${w.callWall} even when the largest put gamma sits above spot (defect 4)`);
  const prof = STRUCT.gammaProfile({ spot: 100, contracts: [
    { K: 95, T: 0.08, sigma: 0.3, type: "P", oi: 5000 }, { K: 105, T: 0.08, sigma: 0.28, type: "C", oi: 3000 },
  ] });
  ok(prof.flip !== null && prof.flip > 95 && prof.flip < 105, `the zero-gamma level between a put book and a call book is found at ${prof.flip.toFixed(2)}`);
}

{
  eq([...TIME.nyseHolidays(2026)].sort(), ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"],
    "the NYSE holiday rule reproduces the 2026 calendar, Good Friday and the observed Fourth included");
  eq(TIME.sessionsBetween("2026-09-21", "2026-10-16"), 19, "nineteen sessions from Monday 21 September to Friday 16 October");
  eq(TIME.sessionsBetween("2026-12-24", "2027-01-04"), 5, "a holiday week counts only its sessions");
  eq(TIME.closeUtcMs("2026-10-16") - Date.UTC(2026, 9, 16), 20 * 3600000, "16:00 New York is 20:00 UTC in October");
  eq(TIME.closeUtcMs("2026-12-18") - Date.UTC(2026, 11, 18), 21 * 3600000, "and 21:00 UTC in December");
  ok(TIME.isMonthly("2026-10-16") && !TIME.isMonthly("2026-10-23"), "the third Friday is the monthly");
  eq(TIME.etDayOf(Date.parse("2026-09-22T01:30:00Z")), "2026-09-21", "half past nine in New York is still that day's session");
}

{
  for (const f of fs.readdirSync(path.join(ROOT, "shared")).filter((x) => x.startsWith("flows-quant-"))) {
    const src = fs.readFileSync(path.join(ROOT, "shared", f), "utf8");
    const norm = (t) => t.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n");
    eq(norm(stripComments(src)), norm(src), `shared/${f} carries no comments`);
    ok(!/Date\.now|new Date\(\)|Math\.random|fetch\(|performance\.now/.test(src), `shared/${f} reads no clock, no randomness and no network`);
  }
}

const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, FLOWS_QUANT_BUDGET: "1" }, encoding: "utf8" });
eq(run.status, 0, `the CPU budget child ran cleanly (${(run.stderr || "").slice(0, 400)})`);
const cpu = JSON.parse(run.stdout.trim().split("\n").pop());
eq(cpu.rows, 400, "the budget chain is one expiry of 400 quotes");
eq(cpu.worst.structures, 24, "and the worst case prices the Worker's maximum of 24 structures on it");
ok(cpu.worst.median < 6, `warmed, the Worker path (parity forward, IV inversion, SVI fit and checks, 24 structures) takes ${cpu.worst.median.toFixed(2)} ms ` +
  `median on the ${cpu.clock} clock, over windows of ${cpu.window} runs, under the 10 ms Free-tier CPU limit`);
ok(cpu.worst.p95 < 10, `and the costliest window, garbage collection included, averages ${cpu.worst.p95.toFixed(2)} ms a run, still inside the limit`);
ok(cpu.normal.mean <= cpu.worst.mean + 0.5, `the default five families (${cpu.normal.structures} structures) take ${cpu.normal.mean.toFixed(2)} ms a run`);
ok(cpu.route.rows === 400 && cpu.route.structures > 0, `the Worker's /api/flows/strategy engine path reads ${cpu.route.rows} vendor rows and prices ${cpu.route.structures} structures`);
ok(cpu.route.median < 6, `from vendor strings to the card-shaped block (row shaping, parity, inversion, fit, pricing, compaction) in ${cpu.route.median.toFixed(2)} ms median, inside the Free-tier budget beside the chain's own JSON.parse`);
ok(cpu.route.p95 < 10, `and ${cpu.route.p95.toFixed(2)} ms in its costliest window`);

console.log(`✓ flows-quant: ${n} assertions — all ${CASES.length} known-answer cases at their stated tolerances ` +
  `(one fixture erratum read as what it is: ${Object.keys(ERRATA).join(", ")}), 2,000-draw properties for parity, ` +
  `IV round trips, noisy SVI fits (${(100 * fitReport.mean).toFixed(2)}% of quotes in spread, ${fitReport.draws - fitReport.below} of ${fitReport.draws} draws at >= 95%, worst ${fitReport.worst.toFixed(3)}), arbitrage-free densities, ` +
  "exact P/L against a 10,001-point grid, EV_Q = 0 at model and P = Q " +
  "edge, a drift-neutral 64-bin P law, byte-identical reruns under shuffled rows and expiries, the selection vetoes, and the " +
  `Worker CPU budget on the ${cpu.clock} clock: fit + 24 structures median ${cpu.worst.median.toFixed(2)} ms, p95 ${cpu.worst.p95.toFixed(2)} ms, ` +
  `min ${cpu.worst.min.toFixed(2)} ms; the default ${cpu.normal.structures} structures median ${cpu.normal.median.toFixed(2)} ms, p95 ${cpu.normal.p95.toFixed(2)} ms; ` +
  `the strategy route's engine path from ${cpu.route.rows} vendor rows median ${cpu.route.median.toFixed(2)} ms, p95 ${cpu.route.p95.toFixed(2)} ms`);
