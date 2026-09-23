import assert from "node:assert/strict";
import {
  num, median, quantile, mad, winsorize, robustZ, invNorm, vanDerWaerden,
  neutralize, flowPurity, aggressorGamma, gammaFlip, bookDisplacement,
  robustZFused, greekFlowTotals,
  pathSignature, gammaDecayCalendar, positioningQuality,
  greekTermStructure, legPresent, GREEK_UNITS,
  callVannaLeg, putVannaLeg, callCharmLeg, putCharmLeg, callDeltaLeg, putDeltaLeg,
  effectiveBreadth, pearson, calibrateScoreScale, boundedScore,
  conviction, CONVICTION_WEIGHTS, applyHysteresis, gammaCrossings, isLiveColumn,
  crossFamilyRedundancy, qualityGate, percentileRank, realizedVol,
  SCORE_SCALE, SIGN_CONVENTION, GREEK_DEALER_SIGN, openInterestGammaBook,
} from "../shared/flows-features.js";
import { blackScholesGreeks, variation, variationSummary } from "../shared/flows-variation.js";
import { computeFeatures, featuresVariationInput } from "../scripts/flows-pipeline.mjs";
import { buildCard } from "../shared/flows-card.js";
import { gammaReading } from "../shared/flows-neuron.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deepEq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, tol, msg) => {
  assert.ok(Math.abs(a - b) <= tol, `${msg} — got ${a}, want ${b} ±${tol}`);
  checks++;
};

{
  near(num("27723806.00"), 27723806, 1e-9, "parses UW numeric strings");
  near(num("-0.021"), -0.021, 1e-12, "parses negatives");
  near(num(null), 0, 0, "null falls back");
  near(num("abc"), 0, 0, "garbage falls back");
  near(num("abc", -1), -1, 0, "explicit fallback honoured");
  near(num(Infinity), 0, 0, "non-finite falls back");

  near(num("   "), 0, 0, "whitespace falls back to the default 0");
  eq(Number.isNaN(num("   ", NaN)), true, "whitespace honours a NaN fallback: absent, not zero");
  eq(Number.isNaN(num("\t\n", NaN)), true, "so does a tab-and-newline blank");
  near(num("  5 "), 5, 0, "a padded number still parses");
}

{
  near(median([3, 1, 2]), 2, 0, "odd median");
  near(median([4, 1, 2, 3]), 2.5, 0, "even median");
  near(quantile([1, 2, 3, 4, 5], 0.5), 3, 1e-12, "quantile midpoint");
  near(quantile([1, 2, 3, 4, 5], 0), 1, 1e-12, "quantile floor");
  near(quantile([1, 2, 3, 4, 5], 1), 5, 1e-12, "quantile ceiling");

  near(mad([1, 2, 3, 4, 5]), 1.4826, 1e-9, "MAD is sigma-consistent");

  const w = winsorize([-100, 1, 2, 3, 4, 5, 900], 0.25);
  ok(Math.max(...w) <= quantile([-100, 1, 2, 3, 4, 5, 900], 0.75) + 1e-9, "winsorize clips high tail");
  ok(Math.min(...w) >= quantile([-100, 1, 2, 3, 4, 5, 900], 0.25) - 1e-9, "winsorize clips low tail");
  ok(w.length === 7, "winsorize clips rather than drops");
}

{

  const sparse = [...new Array(90).fill(0), 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const z = robustZ(sparse);
  ok(z.every(Number.isFinite), "sparse signal never yields Infinity");
  ok(z.every((v) => Math.abs(v) <= 3 + 1e-9), "robustZ respects the clamp");
  ok(Math.max(...z) > 0, "the names that fired still rank above the zeros");
  const zeroIdx = z.slice(0, 90);
  ok(new Set(zeroIdx.map((v) => v.toFixed(6))).size === 1, "all inactive names score identically");
}

{
  near(invNorm(0.5), 0, 1e-9, "median of the normal is zero");
  near(invNorm(0.975), 1.959963985, 1e-6, "97.5th percentile is 1.96");
  near(invNorm(0.025), -1.959963985, 1e-6, "2.5th percentile is -1.96");
  near(invNorm(0.8413447461), 1.0, 1e-5, "one sigma");
  near(invNorm(0.001), -3.090232306, 1e-5, "deep tail stays accurate");
  ok(Number.isNaN(invNorm(0)), "invNorm rejects 0");
  ok(Number.isNaN(invNorm(1)), "invNorm rejects 1");
}

{
  const v = vanDerWaerden([10, 20, 30, 40, 50]);
  near(v.reduce((a, b) => a + b, 0), 0, 1e-9, "transform is centred");
  ok(v[0] < v[1] && v[1] < v[2] && v[2] < v[3] && v[3] < v[4], "monotone in rank");
  near(v[0], -v[4], 1e-9, "symmetric about the middle");

  const tied = vanDerWaerden([5, 5, 5, 9]);
  near(tied[0], tied[1], 1e-12, "ties share a score (0/1)");
  near(tied[1], tied[2], 1e-12, "ties share a score (1/2)");
  ok(tied[3] > tied[0], "the untied high value still ranks above");

  const a = vanDerWaerden([1, 2, 3, 4]);
  const b = vanDerWaerden([100, 2000, 30000, 400000]);
  for (let i = 0; i < 4; i++) near(a[i], b[i], 1e-12, `rank-only, element ${i}`);
}

{

  const sectors = [];
  const size = [];
  const y = [];
  for (let i = 0; i < 60; i++) {
    const tech = i % 2 === 0;
    sectors.push(tech ? "tech" : "energy");
    const mcap = (i % 10) - 4.5;
    size.push(mcap);
    y.push((tech ? 5 : -5) + 0.8 * mcap);
  }
  const resid = neutralize(y, { numeric: [size], groups: sectors });
  const rms = Math.sqrt(resid.reduce((a, b) => a + b * b, 0) / resid.length);
  ok(rms < 1e-6, `neutralization removes an injected sector+size effect (rms ${rms})`);

  const idio = y.map((v, i) => v + (i % 7 === 0 ? 10 : 0));
  const kept = neutralize(idio, { numeric: [size], groups: sectors });
  ok(Math.max(...kept.map(Math.abs)) > 5, "idiosyncratic signal survives neutralization");

  ok(neutralize([]).length === 0, "empty input is safe");
  ok(neutralize([1, 2], { groups: ["a", "b"] }).length === 2, "degenerate design returns input length");

  {
    const n = 48;
    const lonely = Array.from({ length: n }, (_, i) =>
      i === n - 1 ? "utilities" : ["tech", "energy", "health", "fins"][i % 4]);
    const caps = Array.from({ length: n }, (_, i) => Math.log(1e9 + i * 1e8));
    const signal = Array.from({ length: n }, (_, i) => (i === n - 1 ? 5.0 : Math.sin(i) * 0.8));
    const out = neutralize(signal, { numeric: [caps], groups: lonely });
    ok(Math.abs(out[n - 1]) > 1,
       `a name alone in its sector keeps its signal (${out[n - 1].toFixed(3)}, was 5e-8)`);
    ok(Math.abs(out[n - 1]) > Math.max(...out.slice(0, n - 1).map(Math.abs)),
       "and it is still the strongest name on the board, as the raw data said");

    const populated = Array.from({ length: n }, (_, i) => ["tech", "energy", "health"][i % 3]);
    const byGroup = Array.from({ length: n }, (_, i) => (i % 3) * 4 + Math.sin(i) * 0.1);
    const cleaned = neutralize(byGroup, { groups: populated });
    ok(Math.max(...cleaned.map(Math.abs)) < 0.5,
       "a real sector effect is still removed from well-populated groups");
  }
}

{

  const rows = [
    { strike: "90",  call_gamma_ask: "-100", call_gamma_bid: "0", put_gamma_ask: "-50", put_gamma_bid: "0" },
    { strike: "100", call_gamma_ask: "-40",  call_gamma_bid: "0", put_gamma_ask: "10",  put_gamma_bid: "0" },
    { strike: "110", call_gamma_ask: "300",  call_gamma_bid: "0", put_gamma_ask: "0",   put_gamma_bid: "0" },
  ];
  const g = aggressorGamma(rows);
  near(g.ladder[0].gamma, -150, 1e-9, "strike gamma sums the four aggressor components");
  near(g.ladder[0].cum, -150, 1e-9, "cumulative starts at the first strike");
  near(g.ladder[1].cum, -180, 1e-9, "cumulative accumulates");
  near(g.netGamma, 120, 1e-9, "net gamma is the final cumulative");
  ok(g.flip !== null, "a book that changes sign has a flip");
  ok(g.flip > 100 && g.flip < 110, `flip interpolates into the crossing interval (${g.flip})`);

  near(g.flip, 106, 1e-9, "flip interpolation is exact");

  const oneSided = aggressorGamma([
    { strike: "10", call_gamma_ask: "5", call_gamma_bid: "0", put_gamma_ask: "0", put_gamma_bid: "0" },
    { strike: "20", call_gamma_ask: "5", call_gamma_bid: "0", put_gamma_ask: "0", put_gamma_bid: "0" },
  ]);
  ok(oneSided.flip === null, "no sign change means no fabricated flip");
  ok(gammaFlip([]) === null, "empty ladder has no flip");
}

{

  const rows = [
    { strike: "100", call_gamma_oi: "1000", put_gamma_oi: "0", call_gamma_vol: "0",   put_gamma_vol: "0" },
    { strike: "110", call_gamma_oi: "0",    put_gamma_oi: "0", call_gamma_vol: "500", put_gamma_vol: "0" },
  ];
  const d = bookDisplacement(rows, 5);
  near(d.oiCentroid, 100, 1e-9, "OI centroid");
  near(d.volCentroid, 110, 1e-9, "volume centroid");
  near(d.displacement, 2, 1e-9, "displacement is centroid gap in ATR units");
  ok(d.displacement > 0, "positive means new gamma is building above the book");
  ok(d.weight > 0, "weight is exposed so a thin tape can be gated out");

  const flipped = bookDisplacement([
    { strike: "100", call_gamma_oi: "1000", put_gamma_oi: "0", call_gamma_vol: "0",   put_gamma_vol: "0" },
    { strike: "90",  call_gamma_oi: "0",    put_gamma_oi: "0", call_gamma_vol: "500", put_gamma_vol: "0" },
  ], 5);
  ok(flipped.displacement < 0, "negative means new gamma is building below the book");

  near(bookDisplacement(rows, 0).displacement, 0, 0, "zero ATR cannot divide");
  near(bookDisplacement([], 5).displacement, 0, 0, "empty ladder is safe");
}

{
  const t0 = Date.parse("2026-08-24T13:30:00Z");
  const minute = (i) => new Date(t0 + i * 60000).toISOString();

  const steady = [];
  for (let i = 0; i < 100; i++) steady.push({ tape_time: minute(i), net_delta: "10" });

  const spike = [];
  for (let i = 0; i < 100; i++) spike.push({ tape_time: minute(i), net_delta: i === 50 ? "1000" : "0" });

  const s = pathSignature(steady);
  const k = pathSignature(spike);

  near(s.net, 1000, 1e-9, "steady path net delta is the SUM of the ticks");
  near(k.net, 1000, 1e-9, "spike path net delta");
  ok(Math.abs(s.net - k.net) < 1e-9, "the two paths have IDENTICAL daily totals");

  ok(s.persistence > 0.95, `steady accumulation is persistent (${s.persistence})`);
  ok(k.persistence < 0.05, `a single spike is not persistent (${k.persistence})`);
  ok(s.concentration < 0.2, `steady flow is not concentrated (${s.concentration})`);
  ok(k.concentration > 0.95, `spike flow is concentrated (${k.concentration})`);
  ok(k.centroid > 0.4, "spike centroid sits at the spike");

  const late = [];
  for (let i = 0; i < 100; i++) late.push({ tape_time: minute(i), net_delta: i < 80 ? "0" : "50" });
  ok(pathSignature(late).centroid > 0.75, "late accumulation reports a late centroid");

  const worked = [];
  for (let i = 0; i < 390; i++) worked.push({ tape_time: minute(i), net_delta: "900" });
  const w = pathSignature(worked);
  near(w.net, 351000, 1e-9, "a worked order reports its true daily total, not ~0");
  ok(w.persistence > 0.99, "and reads as fully persistent rather than a coin flip");

  const reversal = [];
  for (let i = 0; i < 100; i++) reversal.push({ tape_time: minute(i), net_delta: i < 50 ? "500" : "-500" });
  near(pathSignature(reversal).net, 0, 1e-9, "flow that reverses within the day nets to zero");

  const thin = pathSignature([{ tape_time: minute(0), net_delta: "1" }]);
  near(thin.persistence, 0, 0, "too few bars degrades safely");
}

{
  const clean = flowPurity([{ dir_delta_flow: "1000", total_delta_flow: "1000" }]);
  near(clean.purity, 1, 1e-9, "wholly directional flow is pure");

  const hedged = flowPurity([{ dir_delta_flow: "0", total_delta_flow: "1000" }]);
  near(hedged.purity, 0, 1e-9, "wholly hedged flow has zero purity");

  const mixed = flowPurity([
    { dir_delta_flow: "300", total_delta_flow: "500" },
    { dir_delta_flow: "200", total_delta_flow: "500" },
  ]);
  near(mixed.purity, 0.5, 1e-9, "purity aggregates across minutes");

  const cancelling = flowPurity([
    { dir_delta_flow: "1000", total_delta_flow: "1000" },
    { dir_delta_flow: "-1000", total_delta_flow: "1000" },
  ]);
  near(cancelling.purity, 1, 1e-9, "a reversing session is still WHOLLY directional flow");
  near(cancelling.dirShare, 0, 1e-9, "...and its NET direction is zero");
  near(cancelling.dirDelta, 0, 1e-9, "dirDelta stays the net, for the signed column");

  const oneWay = flowPurity([
    { dir_delta_flow: "1000", total_delta_flow: "1000" },
    { dir_delta_flow: "1000", total_delta_flow: "1000" },
  ]);
  near(oneWay.dirShare, 1, 1e-9, "a one-way session has dirShare 1");
  ok(oneWay.purity === cancelling.purity,
     "purity cannot distinguish the two — that is pathSignature's job, not its own");

  ok(flowPurity([]).purity === null, "an empty flow is UNMEASURED, not zero");
  ok(flowPurity([{ dir_delta_flow: "5", total_delta_flow: "1" }]).purity <= 1, "purity is bounded at 1");
  ok(Math.abs(flowPurity([{ dir_delta_flow: "-5", total_delta_flow: "1" }]).dirShare) <= 1,
     "dirShare is bounded in [-1, 1]");
}

{
  const q = positioningQuality([
    { dir_delta_flow: "1000", otm_dir_delta_flow: "800", total_vega_flow: "200", total_delta_flow: "1000" },
  ]);
  near(q.otmShare, 0.8, 1e-9, "OTM share of directional flow");
  near(q.vegaTilt, 0.2, 1e-9, "vega per unit delta");
  ok(q.hasDirectionalView, "a real delta flow registers a view");

  const none = positioningQuality([
    { dir_delta_flow: "0", otm_dir_delta_flow: "0", total_vega_flow: "9999", total_delta_flow: "0" },
  ]);
  ok(none.otmShare === null, "zero delta flow yields an UNMEASURED OTM share, not the best possible one");

  const cancelled = positioningQuality([
    { dir_delta_flow: "1000", otm_dir_delta_flow: "100", total_vega_flow: "1", total_delta_flow: "1000" },
    { dir_delta_flow: "-1000", otm_dir_delta_flow: "-100", total_vega_flow: "1", total_delta_flow: "1000" },
  ]);
  near(cancelled.otmShare, 0.1, 1e-9,
       "a cancelling session reports its true OTM share, not the clamp");
  ok(none.vegaTilt === null, "zero delta flow yields an UNMEASURED vega tilt, not Infinity and not zero");
  ok(!none.hasDirectionalView, "zero delta flow reports no directional view");
}

{

  const TAPE = [
    { dir_delta_flow: "600", otm_dir_delta_flow: "150", total_vega_flow: "40", total_delta_flow: "1000" },
    { dir_delta_flow: "-200", otm_dir_delta_flow: "-50", total_vega_flow: "10", total_delta_flow: "400" },
    { dir_delta_flow: "0", otm_dir_delta_flow: "0", total_vega_flow: "5", total_delta_flow: "100" },
    { dir_delta_flow: "-300", otm_dir_delta_flow: "-90", total_vega_flow: "-20", total_delta_flow: "-500" },
  ];
  const t = greekFlowTotals(TAPE);
  near(t.dirNet, 100, 1e-9, "dirNet is the one SIGNED accumulator — it answers which way");
  near(t.dirAbs, 1100, 1e-9, "dirAbs is gross, so cancelling prints still count as flow");
  near(t.otmAbs, 290, 1e-9, "otmAbs is gross too");
  near(t.vegaAbs, 75, 1e-9, "vegaAbs is gross — a negative vega print is vol traded, not vol undone");
  near(t.totalAbs, 2000, 1e-9, "totalAbs is Sigma|total_delta_flow| — the ONE denominator");
  ok(t.totalAbs !== 1000, "and it is GROSS: the reversing row adds 500, it does not subtract it");
  eq(t.rows, 4, "rows is a COUNT of measured prints, not a ratio");

  eq(greekFlowTotals([]).rows, 0, "an empty tape measured zero rows");
  eq(greekFlowTotals(null).rows, 0, "and a missing tape is the same zero rows, never a throw");
  near(greekFlowTotals(null).totalAbs, 0, 0, "with every sum at its identity");

  eq(greekFlowTotals([]).silence, "quiet",
     "an array that arrived with no prints in it is QUIET — measured, and empty");
  eq(greekFlowTotals(null).silence, "unavailable",
     "a tape that never arrived is UNAVAILABLE — a different sentence and a different tag");
  eq(greekFlowTotals(undefined).silence, "unavailable", "and so is an absent argument");

  ok(greekFlowTotals({ length: 3 }).rows === 0,
     "a non-array shape is refused rather than iterated — this shaper does not throw on a bad payload");
  eq(greekFlowTotals({ length: 3 }).silence, "unavailable",
     "and so is a shape that is not an array at all, rather than being iterated into a silent zero");
  eq(greekFlowTotals(TAPE).silence, null,
     "while a tape with prints in it is not silent, so the field is null and a renderer has nothing to say");
  ok(greekFlowTotals([]).silence !== greekFlowTotals(null).silence,
     "the two silences are distinguishable — which is the whole assertion, and it fails the moment they collapse");

  const purity = flowPurity(TAPE);
  near(purity.totalAbs, t.totalAbs, 0,
       "flowPurity divides by exactly the totals record's totalAbs, not its own copy");
  near(purity.dirDelta, t.dirNet, 0, "and publishes the same signed net");
  near(purity.dirAbs, t.dirAbs, 0, "and the same gross");
  near(positioningQuality(TAPE).vegaTilt, t.vegaAbs / t.totalAbs, 1e-12,
       "positioningQuality's vegaTilt divides by that same totalAbs");

  near(positioningQuality(TAPE).otmShare, t.otmAbs / t.dirAbs, 1e-12,
       "otmShare divides the gross OTM by the gross DIRECTIONAL, not by the tape's total");
  ok(t.dirAbs !== t.totalAbs,
     "and the two denominators really are different numbers here, so that assertion can fail");

  eq(JSON.stringify(flowPurity(TAPE, t)), JSON.stringify(flowPurity(TAPE)),
     "flowPurity is identical whether it builds the totals or is handed them");
  eq(JSON.stringify(positioningQuality(TAPE, { totals: t })), JSON.stringify(positioningQuality(TAPE)),
     "positioningQuality is identical whether it builds the totals or is handed them");
  eq(JSON.stringify(positioningQuality(TAPE, { floor: 1e5, totals: t })),
     JSON.stringify(positioningQuality(TAPE, { floor: 1e5 })),
     "and the floor still applies when a record is threaded — the option bag is not swallowed");

  eq(JSON.stringify(flowPurity(TAPE, { totals: t })), JSON.stringify(flowPurity(TAPE)),
     "flowPurity accepts its sibling's { totals } spelling too — the pipeline writes both, one line apart");
  for (const [bad, label] of [[{}, "an empty option bag"], [{ floor: 1e5 }, "an option bag with no totals in it"],
                              [{ totalAbs: null }, "a record whose denominator is null"],
                              [true, "a stray boolean"]]) {
    const got = flowPurity(TAPE, bad);
    near(got.totalAbs, 2000, 1e-9, `flowPurity RECOMPUTES from the rows when handed ${label}`);
    ok(Number.isFinite(got.purity), `and publishes a measured purity, never the NaN a truthiness test produced (${label})`);
    const pq = positioningQuality(TAPE, { totals: bad === true ? undefined : bad });
    ok(Number.isFinite(pq.vegaTilt), `positioningQuality does the same with ${label}`);
  }

  const spy = { ...t, totalAbs: 4000 };
  near(flowPurity(TAPE, spy).totalAbs, 4000, 0,
       "a record carrying a finite totalAbs IS trusted — the recompute is a fallback, not the only path");
  ok(positioningQuality(TAPE, { floor: 1e5 }).otmShare === null,
     "a floor above the tape's own gross reports UNMEASURED — the branch the line above compares");

  const dead = flowPurity([{ dir_delta_flow: "5", total_delta_flow: "0" }]);
  ok(dead.purity === null, "a tape with no total delta is UNMEASURED purity, not zero");
  near(dead.totalAbs, 0, 0, "and reports the zero denominator it actually measured");
}

{
  const cal = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gamma: "600", put_gamma: "0" },
    { expiry: "2026-09-18", call_gamma: "300", put_gamma: "0" },
    { expiry: "2026-12-18", call_gamma: "100", put_gamma: "0" },
  ]);
  near(cal.schedule[0].share, 0.6, 1e-9, "front expiry carries 60% of the book");
  near(cal.schedule[1].cumShare, 0.9, 1e-9, "cumulative roll-off accumulates");
  assert.equal(cal.halfLifeExpiry, "2026-08-28"); checks++;
  near(cal.frontLoad, 0.6, 1e-9, "front load is the nearest expiry's share");

  const flat = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gamma: "100", put_gamma: "0" },
    { expiry: "2026-09-18", call_gamma: "100", put_gamma: "0" },
    { expiry: "2026-10-16", call_gamma: "100", put_gamma: "0" },
  ]);
  assert.equal(flat.halfLifeExpiry, "2026-09-18"); checks++;
  ok(gammaDecayCalendar([]).halfLifeExpiry === null, "empty calendar has no half-life");

  const signed = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gamma: "1e9", put_gamma: "-999000000" },
    { expiry: "2026-09-18", call_gamma: "5000000", put_gamma: "0" },
  ]);
  ok(signed.frontLoad > 0.99,
     `gross roll-off sums magnitudes: a 2.0e9 front week dominates (${signed.frontLoad})`);
  assert.equal(signed.halfLifeExpiry, "2026-08-28"); checks++;

  const balanced = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gamma: "1e9", put_gamma: "-1e9" },
    { expiry: "2026-09-18", call_gamma: "1e6", put_gamma: "0" },
  ]);
  ok(balanced.schedule.length === 2,
     "an expiry whose legs net to zero still carries gross gamma and stays on the schedule");

  const wire = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gex: "600", put_gex: "0" },
    { expiry: "2026-09-18", call_gex: "300", put_gex: "0" },
    { expiry: "2026-12-18", call_gex: "100", put_gex: "0" },
  ]);
  near(wire.schedule[0].share, 0.6, 1e-9, "call_gex is read as the call gamma leg");
  assert.equal(wire.halfLifeExpiry, "2026-08-28"); checks++;

  const wireSigned = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gex: "1e9", put_gex: "-999000000" },
    { expiry: "2026-09-18", call_gex: "5000000", put_gex: "0" },
  ]);
  ok(wireSigned.frontLoad > 0.99,
     `put_gex is dealer-signed too, so gross roll-off sums magnitudes (${wireSigned.frontLoad})`);

  const bothNames = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gex: "900", call_gamma: "100", put_gex: "0", put_gamma: "0" },
    { expiry: "2026-09-18", call_gex: "100", call_gamma: "900", put_gex: "0", put_gamma: "0" },
  ]);
  near(bothNames.frontLoad, 0.9, 1e-9, "call_gex takes precedence over call_gamma");
}

{
  const base = Array.from({ length: 50 }, (_, i) => Math.sin(i));
  const dup = [base, base.slice(), base.slice()];
  const nEffDup = effectiveBreadth(dup);
  ok(nEffDup < 1.05, `three identical signals count as ~1 (${nEffDup})`);

  const indep = [
    Array.from({ length: 50 }, (_, i) => Math.sin(i)),
    Array.from({ length: 50 }, (_, i) => Math.cos(i * 3.1)),
    Array.from({ length: 50 }, (_, i) => ((i * 7919) % 101) / 101 - 0.5),
  ];
  ok(effectiveBreadth(indep) > 2, "three near-independent signals count as more than two");
  ok(effectiveBreadth([base]) === 1, "a single column has breadth 1");

  near(pearson(base, base), 1, 1e-9, "self-correlation is 1");
  near(pearson(base, base.map((v) => -v)), -1, 1e-9, "anti-correlation is -1");
  ok(Number.isNaN(pearson([1, 1, 1], [1, 2, 3])), "a constant column has no correlation");
}

{

  const zs = Array.from({ length: 500 }, (_, i) => invNorm((i + 0.5) / 500));
  const scale = calibrateScoreScale(zs, { refQuantile: 0.95, refScore: 80 });
  const scored = zs.map((z) => boundedScore(z, scale));

  const ref = quantile(zs.map(Math.abs), 0.95);
  near(Math.abs(boundedScore(ref, scale)), 80, 1, "the reference quantile lands on the reference score");

  ok(Math.max(...scored) >= 80, "the strong tail actually reaches the top band");
  ok(Math.min(...scored) <= -80, "the weak tail actually reaches the bottom band");
  ok(scored.every((s) => s >= -100 && s <= 100), "scores stay bounded");

  const quiet = zs.map((z) => z * 0.05);
  const loudFixed = zs.map((z) => boundedScore(z, SCORE_SCALE));
  const quietFixed = quiet.map((z) => boundedScore(z, SCORE_SCALE));
  ok(Math.max(...quietFixed) < Math.max(...loudFixed) - 20,
     `a compressed cross-section must score LOWER under the fixed unit ` +
     `(quiet ${Math.max(...quietFixed)} vs loud ${Math.max(...loudFixed)})`);

  near(boundedScore(2, SCORE_SCALE), 80, 1, "the fixed unit puts z = 2 at score 80");
  near(boundedScore(-2, SCORE_SCALE), -80, 1, "and is antisymmetric");
  ok(boundedScore(1, SCORE_SCALE) < boundedScore(2, SCORE_SCALE),
     "the fixed unit is monotone in the composite, not in the rank");

  const shapeA = Array.from({ length: 34 }, (_, i) => (34 - i) * 0.01);
  const shapeB = Array.from({ length: 34 }, (_, i) => (34 - i) * 1.00);
  const a = shapeA.map((z) => boundedScore(z, SCORE_SCALE));
  const b = shapeB.map((z) => boundedScore(z, SCORE_SCALE));
  ok(JSON.stringify(a) !== JSON.stringify(b),
     "identical ranks with different dispersions must NOT produce the same ladder");

  ok(calibrateScoreScale([0, 0, 0]) === 1, "a flat cross-section falls back to unit scale");
  ok(boundedScore(NaN, scale) === 0, "non-finite z scores zero");
  ok(boundedScore(1, 0) === boundedScore(1, 1), "a non-positive scale falls back to 1");
}

{

  const strong = conviction({ familyScores: [40, 30, 25, 20, 15], coverage: 1, persistence: 1 });
  ok(strong.conviction === 100, `unanimous full-coverage name reaches 100 (got ${strong.conviction})`);
  near(strong.agreement, 1, 1e-9, "unanimous agreement");
  ok(strong.breadth === 5, "breadth counts contributing families");

  const split = conviction({ familyScores: [40, -30, 25, -20, 15], coverage: 1, persistence: 0 });
  ok(split.conviction < strong.conviction, "disagreement scores below unanimity");
  ok(split.conviction > 0, "a split name is not stranded at zero");

  const thin = conviction({ familyScores: [90], coverage: 0.2, persistence: 0 });
  const broad = conviction({ familyScores: [12, 11, 10, 9, 8], coverage: 1, persistence: 0.8 });
  ok(broad.conviction > thin.conviction,
     `broad weak agreement outranks one loud family (${broad.conviction} vs ${thin.conviction})`);

  ok(conviction({ familyScores: [] }).conviction === 0, "no data means no conviction");

  ok(conviction({ familyScores: [null, null], coverage: 0 }).conviction === 0,
     "families that are absent, with no coverage, mean no conviction");

  const neutralPair = conviction({ familyScores: [0, 0], coverage: 1, persistence: 0 });
  ok(neutralPair.agreement === 0,
     "two families measured and neutral agree with nothing");
  const oneDead = conviction({ familyScores: [40, 30, null], coverage: 1, persistence: 0 });
  const allLive = conviction({ familyScores: [40, 30, 20], coverage: 1, persistence: 0 });
  ok(oneDead.breadth === 2 && allLive.breadth === 3, "breadth counts only present families");
  ok(oneDead.conviction <= allLive.conviction, "losing a family must never RAISE conviction");

  for (const cov of [0, 0.5, 1]) for (const per of [0, 0.5, 1]) {
    const c = conviction({ familyScores: [1, 1, -1], coverage: cov, persistence: per });
    ok(c.conviction >= 0 && c.conviction <= 100, "conviction stays within [0,100]");
  }

  const wild = conviction({ familyScores: [1, 1], coverage: 99, persistence: -99 });
  ok(wild.conviction <= 100, "out-of-range coverage is clamped");

  for (const cov of [0, 0.37, 1]) for (const per of [0, 0.55, 1]) {
    for (const fs of [[1, 1, 1], [1, 1, -1], [1, -1, -1], [40, 30, null]]) {
      const c = conviction({ familyScores: fs, coverage: cov, persistence: per });
      const recon = Math.round(100 * (
        CONVICTION_WEIGHTS.agreement * c.agreement +
        CONVICTION_WEIGHTS.coverage * c.coverage +
        CONVICTION_WEIGHTS.persistence * c.persistence));
      eq(recon, c.conviction,
         `the three returned terms and the published weights reconstruct the composite ` +
         `(cov ${cov}, per ${per}, families ${JSON.stringify(fs)})`);
    }
  }

  eq(wild.coverage, 1, "coverage comes back as the arithmetic used it, clamped to 1");
  eq(wild.persistence, 0, "and persistence likewise, clamped up to 0");

  const twoOfThree = conviction({ familyScores: [1, 1, -1], coverage: 1, persistence: 0 });
  eq(twoOfThree.agree, 2, "the agreeing count is published as an integer");
  eq(twoOfThree.breadth, 3, "beside the present count");
  ok(Number(twoOfThree.agreement.toFixed(3)) * 3 !== 2,
     "and the rounded ratio really does not recover it, which is why the count ships");
  for (const fs of [[1, 1, 1], [1, 1, -1], [1, -1, -1], [0, 0], [40, 30, null], []]) {
    const c = conviction({ familyScores: fs, coverage: 1, persistence: 0 });
    ok(Number.isInteger(c.agree) && Number.isInteger(c.breadth) &&
       c.agree >= 0 && c.agree <= c.breadth,
       `0 <= agree <= breadth, both integers (${JSON.stringify(fs)})`);
  }

  const byMajority = new Set([[1, 1, 1], [1, 1, -1], [1, -1, -1]].map(
    (fs) => conviction({ familyScores: fs, coverage: 1, persistence: 1 }).agree));
  assert.deepEqual([...byMajority].sort(), [2, 3],
    "three measured non-zero axes reach only two-of-three and three-of-three: the " +
    "majority always shares the sign of the sum"); checks++;
  eq(conviction({ familyScores: [1, -1, 0], coverage: 1, persistence: 1 }).agree, 1,
     "one-of-three needs a measured-neutral axis, which is how the corpus reaches it");
  const levels = new Set();
  for (const fs of [[1, 1, 1], [1, 1, -1], [1, -1, 0], [0, 0, 0]]) {
    levels.add(conviction({ familyScores: fs, coverage: 1, persistence: 1 }).agree);
  }
  assert.deepEqual([...levels].sort(), [0, 1, 2, 3],
    "and the count runs 0..breadth — four values at breadth 3, not three"); checks++;
  ok(CONVICTION_WEIGHTS.agreement > CONVICTION_WEIGHTS.coverage &&
     CONVICTION_WEIGHTS.agreement > CONVICTION_WEIGHTS.persistence,
     "and it is the heaviest of the three terms, so the coarsest input dominates");
  eq(Number((CONVICTION_WEIGHTS.agreement + CONVICTION_WEIGHTS.coverage +
     CONVICTION_WEIGHTS.persistence).toFixed(10)), 1,
     "the weights sum to one, so the whole [0,100] range is reachable");
}

{

  const bimodal = (pos, neg) => [
    ...Array.from({ length: pos }, (_, i) => 0.50 + (i % 5) * 0.01),
    ...Array.from({ length: neg }, (_, i) => -(0.50 + (i % 5) * 0.01)),
  ];
  for (const [pos, neg] of [[14, 10], [18, 6], [20, 4], [12, 12]]) {
    const z = robustZ(winsorize(bimodal(pos, neg), 0.02));
    const clamped = z.filter((v) => Math.abs(v) >= 2.999).length;
    ok(clamped === 0,
       `a ${pos}/${neg} sign split must not saturate the clamp (got ${clamped} of ${z.length})`);
    ok(z.some((v) => v < 0) && z.some((v) => v >= 0),
       `and both signs survive the ${pos}/${neg} split`);
  }

  const lopsided = robustZ(winsorize(bimodal(20, 4), 0.02));
  ok(Math.max(...lopsided.map(Math.abs)) < 3,
     "an 80/20 split is inside the clamp, not against it");

  const outlier = robustZ([...Array.from({ length: 30 }, (_, i) => 1 + (i % 3) * 0.01), 500]);
  ok(Math.abs(outlier[30]) >= 2.999, "one wild value still clamps");

  const smooth = Array.from({ length: 60 }, (_, i) => Math.sin(i * 1.7) * 2 + i * 0.01);
  const zs = robustZ(smooth);
  ok(zs.filter((v) => Math.abs(v) >= 2.999).length === 0,
     "a smooth column has nothing at the clamp");
  ok(Math.max(...zs.map(Math.abs)) > 0.5,
     "and still has real dispersion — the floor shrinks z, it does not flatten it");
}

{

  const agree = (col, opts, label) => {
    const composed = robustZ(winsorize(col, opts.winsor ?? 0.02), { clamp: opts.clamp ?? 3 });
    const fused = robustZFused(col, opts);
    eq(fused.length, composed.length, `${label}: fused returns one z per input row`);
    ok(Array.isArray(fused), `${label}: and returns a plain Array, as robustZ does`);

    ok(fused.every((v) => typeof v === "number" && Number.isFinite(v)),
       `${label}: every fused z is a finite NUMBER — never null, undefined or NaN`);
    let worst = 0;
    for (let i = 0; i < composed.length; i++) worst = Math.max(worst, Math.abs(composed[i] - fused[i]));
    ok(worst === 0, `${label}: fused equals robustZ(winsorize(...)) exactly (worst |diff| ${worst})`);
  };

  const board = Array.from({ length: 128 }, (_, i) =>
    (i % 8 === 3 ? null : Math.sin(i * 2.399) * 1.7 + (i % 17 === 0 ? 9 : 0)));
  agree(board, { winsor: 0.02 }, "a 128-name board column with holes");

  agree([], {}, "an empty column");
  agree([NaN, NaN, NaN, NaN], {}, "an ALL-NaN column — nothing was ever measured");
  agree([null, undefined, "", "abc"], {}, "a column of nulls, undefineds and unparseable strings");

  agree([5], {}, "a single element");
  agree([null, 7, NaN], {}, "a single measured element among the silences");
  deepEq(robustZFused([null, 7, NaN], {}), [0, 0, 0],
     "a column too thin to score is the NEUTRAL VOTE for every row — literally 0, " +
     "not null and not undefined, because every caller does arithmetic on it");
  deepEq(robustZFused([], {}), [], "and an empty column is an empty array, not a row of anything");

  agree([1, 2], {}, "n = 2, the smallest scored column");

  agree(new Array(40).fill(7), {}, "an ALL-EQUAL column — MAD, both spans and the stdev all collapse");
  const allEqual = robustZFused(new Array(40).fill(7), {});
  ok(allEqual.every((v) => v === 0),
     "and the all-equal column really does reach the final all-zeros exit, not merely agree by luck");

  const nearlyFlat = [...new Array(61).fill(2), 9, 9];
  agree(nearlyFlat, {}, "a near-constant column with two live values — the mean/stdev fallback");
  const flatZ = robustZFused(nearlyFlat, {});
  ok(flatZ.some((v) => v !== 0),
     "and that fallback really fires: the live values are not flattened to the neutral vote");

  ok(new Set(flatZ.map((v) => v.toFixed(12))).size === 2,
     "two distinct z values: the flat body and the two live names");
  ok(flatZ[0] < 0 && flatZ[62] > 0,
     "and the body sits BELOW the mean while the live names sit above it — the centre moved");

  const orderSensitive = [];
  for (let i = 0; i < 10; i++) orderSensitive.push(-1e16, 1e16, 1);
  while (orderSensitive.length < 101) orderSensitive.push(1);
  agree(orderSensitive, { winsor: 0.02 }, "an order-sensitive mean/stdev fallback");
  ok(orderSensitive.reduce((a, b) => a + b, 0) !==
     orderSensitive.slice().sort((a, b) => a - b).reduce((a, b) => a + b, 0),
     "and the fixture really is order-sensitive: its sum differs between row order and sorted order");
  ok(new Set(robustZFused(orderSensitive, { winsor: 0.02 }).map((v) => v.toFixed(12))).size === 3,
     "three distinct z values — the two extremes and the flat body, which is NOT at zero");

  const wideOnly = [...new Array(15).fill(-5), ...new Array(70).fill(0), ...new Array(15).fill(5)];
  agree(wideOnly, {}, "a column whose interquartile span is zero but whose 10-90 span is not");
  const wideZ = robustZFused(wideOnly, {});
  near(wideZ[0], -5 / ((5 - -5) / 2.563), 1e-12,
       "the 10-90 estimator is what scaled it: z is the raw value over (span/2.563)");
  ok(Math.abs(wideZ[0]) < 3, "and nothing saturated the clamp, which is the whole point of the third span");
  ok(wideZ[20] === 0, "while the flat body sits at exactly the median");

  agree([...new Array(90).fill(0), 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], {}, "the sparse-signal MAD trap");

  const bimodal2 = (pos, neg) => [
    ...Array.from({ length: pos }, (_, i) => 0.5 + (i % 5) * 0.01),
    ...Array.from({ length: neg }, (_, i) => -(0.5 + (i % 5) * 0.01)),
  ];
  for (const [a, b] of [[14, 10], [18, 6], [20, 4], [12, 12]]) {
    agree(bimodal2(a, b), { winsor: 0.02 }, `a ${a}/${b} sign split`);
  }

  agree([1, 2, 3, 4, 5], { winsor: 0.02 }, "n = 5, where the clip moves the 10th percentile");
  agree([-100, 1, 2, 3, 4, 5, 900], { winsor: 0.02 }, "n = 7 with both tails live");

  for (const p of [0, 0.01, 0.25, 0.49, 0.5, 0.6]) {
    agree([-100, 1, 2, 3, 4, 5, 900], { winsor: p }, `winsor = ${p}`);
  }
  for (const c of [0.5, 1, 3, 10]) agree([-100, 1, 2, 3, 4, 5, 900], { clamp: c }, `clamp = ${c}`);

  agree([-1e308, 1e308, 0, 5, -5, 2, -2], { winsor: 0.02 }, "huge opposite-signed extremes, bounds still finite");

  const overflow = [-1e308, 1e308];
  agree(overflow, { winsor: 0.02 }, "bounds that overflow to Infinity — the clip is refused");
  ok(robustZFused(overflow, { winsor: 0.02 }).every((v) => v === 0),
     "and an unusable scale is the neutral vote for everyone, never Infinity and never NaN");
  agree([-1e308, -1e308, 1e308], { winsor: 0.02 }, "only the upper bound overflows");
  agree([-1e308, 1e308, 1e308], { winsor: 0.02 }, "only the lower bound overflows");

  const madOverflow = [-1.797e308, -1.7e308, 1e307];
  agree(madOverflow, { winsor: 0.02 }, "a finite winsor bound over an OVERFLOWING MAD deviation");
  {

    const w = winsorize(madOverflow, 0.02);
    ok(w.every((x) => Number.isFinite(x)),
       "the clip is NOT refused here: both winsor bounds are finite, unlike every overflow fixture above");
    const m = median(w);
    const devs = w.map((x) => Math.abs(x - m));
    eq(devs.filter((d) => !Number.isFinite(d)).length, 1,
       "and exactly one deviation overflows to Infinity — the branch this fixture exists for");
    ok(median(devs) * 2 === devs.slice().sort((a, b) => a - b)[1],
       "and dropping it HALVES the scale: the filtered median is half the unfiltered middle entry");
    ok(Math.abs(robustZFused(madOverflow, { winsor: 0.02 })[0]) > 1,
       "so the fused z is the full -1.349 and not the -0.674 the unfiltered version published");
  }

  const allDevOverflow = [1.7e308, 1.7e308];
  agree(allDevOverflow, { winsor: 0.02 }, "a column whose centre overflows, so EVERY deviation does");
  {
    const m = median(winsorize(allDevOverflow, 0.02));
    ok(!Number.isFinite(m),
       "the centre really is non-finite here — this is the fixture for the empty-survivor arm, not a near miss");
    ok(winsorize(allDevOverflow, 0.02).every((x) => !Number.isFinite(Math.abs(x - m))),
       "and not one deviation survives the finiteness filter, so the survivor count is zero");
    ok(robustZFused(allDevOverflow, { winsor: 0.02 }).every((v) => v === 0),
       "which is the neutral vote for everyone — never NaN, never undefined out of an empty buffer");
  }

  const guardCol = [-Number.MAX_VALUE, -1.7e308, 1e308];
  agree(guardCol, { winsor: 0.02 }, "a finite lower bound and an overflowing upper one — the clip is refused whole");
  {
    ok(!Number.isFinite(quantile(guardCol, 0.98)),
       "the upper winsor bound really does overflow, which is what makes winsorize refuse");
    const loBound = quantile(guardCol, 0.02);
    ok(Number.isFinite(loBound) && loBound > Math.min(...guardCol),
       "while the lower bound is finite AND strictly above the smallest entry — so clipping is observable here, " +
       "which is precisely what the three fixtures above could not do");
    deepEq(winsorize(guardCol, 0.02), guardCol,
       "and winsorize returns the column untouched, which the fused form must reproduce rather than clip to the floor");
  }

  let seed = 20260904;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let worstFuzz = 0, elements = 0;
  for (let trial = 0; trial < 600; trial++) {
    const n = 1 + Math.floor(rnd() * 60);
    const col = [];
    for (let i = 0; i < n; i++) {
      const r = rnd();
      if (r < 0.12) col.push(null);
      else if (r < 0.18) col.push(NaN);
      else if (r < 0.22) col.push(undefined);
      else if (r < 0.30) col.push(Math.round((rnd() - 0.5) * 4));
      else col.push((rnd() - 0.5) * Math.pow(10, Math.floor(rnd() * 8) - 2));
    }
    const opts = { winsor: [0, 0.01, 0.02, 0.1, 0.3][Math.floor(rnd() * 5)],
                   clamp: [1, 3, 5][Math.floor(rnd() * 3)] };
    const composed = robustZ(winsorize(col, opts.winsor), { clamp: opts.clamp });
    const fused = robustZFused(col, opts);
    for (let i = 0; i < composed.length; i++) {
      elements++;
      worstFuzz = Math.max(worstFuzz, Math.abs(composed[i] - fused[i]));
    }
  }
  ok(elements > 15000, `the fuzz actually exercised the paths (${elements} elements compared)`);
  ok(worstFuzz === 0,
     `600 random columns agree exactly, ties and silences included (worst |diff| ${worstFuzz})`);

  const countSorts = (fn) => {
    let sorts = 0;
    const realArray = Array.prototype.sort, realTyped = Float64Array.prototype.sort;
    Array.prototype.sort = function (...a) { sorts++; return realArray.apply(this, a); };
    Float64Array.prototype.sort = function (...a) { sorts++; return realTyped.apply(this, a); };
    try { fn(); } finally { Array.prototype.sort = realArray; Float64Array.prototype.sort = realTyped; }
    return sorts;
  };
  eq(countSorts(() => robustZ(winsorize(board, 0.02))), 8,
     "the composed form issues eight full sorts of one column — the defect being fixed");
  eq(countSorts(() => robustZFused(board, { winsor: 0.02 })), 2,
     "the fused form issues two: one for the column, one for the MAD's deviations");
}

{
  const today = Array.from({ length: 60 }, (_, i) => "T" + (i + 1));

  const slipped = applyHysteresis(today, today.slice(4, 29), { entryRank: 25, exitRank: 35 }).ids;
  for (const t of ["T1", "T2", "T3", "T4"]) {
    ok(slipped.includes(t), `${t} is one of the session's best and is on the board`);
  }
  ok(slipped.includes("T26") && slipped.includes("T29"),
     "and an incumbent that slipped past entryRank but is inside the exit band is held");
  ok(slipped.length > 25 && slipped.length <= 35,
     `the board grows rather than dropping the best (got ${slipped.length})`);

  const fresh = applyHysteresis(today, [], { entryRank: 25, exitRank: 35 }).ids;
  eq(fresh.length, 25, "no incumbents means exactly the top entryRank");
  eq(fresh[0], "T1", "ordered by today's rank");
  eq(fresh[24], "T25", "and cut at entryRank");

  const dropped = applyHysteresis(today, ["T36", "T50"], { entryRank: 25, exitRank: 35 }).ids;
  ok(!dropped.includes("T36") && !dropped.includes("T50"),
     "an incumbent beyond exitRank is not held");
  eq(dropped.length, 25, "so the board does not grow for it");

  const mixed = applyHysteresis(today, today.slice(25, 34), { entryRank: 25, exitRank: 35 }).ids;
  const positions = mixed.map((t) => today.indexOf(t));
  ok(positions.every((v, i) => i === 0 || v > positions[i - 1]),
     "the emitted board is in today's rank order");
  ok(new Set(mixed).size === mixed.length, "and holds no duplicates");

  eq(applyHysteresis([], ["T1"]).ids.length, 0, "an empty session yields an empty board");
  eq(applyHysteresis(null, null).ids.length, 0, "and null inputs are safe");
  const short = applyHysteresis(today.slice(0, 8), today.slice(0, 8), { entryRank: 25, exitRank: 35 }).ids;
  eq(short.length, 8, "a pool shorter than entryRank is kept whole, not padded");
}

{
  const today = Array.from({ length: 60 }, (_, i) => "T" + (i + 1));

  const m = applyHysteresis(today, today.slice(4, 29), { entryRank: 25, exitRank: 35 });

  deepEq(m.entered, ["T1", "T2", "T3", "T4"],
    "the four names that entered the top 25 overnight are named, in rank order — the " +
    "single sentence a ranked list most owes a reader who was not looking yesterday");
  deepEq(m.held, ["T26", "T27", "T28", "T29"],
    "and the names here on incumbency rather than on rank are named separately: this is " +
    "the fact no downstream set difference can recover, because it is a statement about " +
    "WHY a name is on the board");
  ok(m.returning.length === m.ids.length - m.entered.length,
    "entered and returning partition the board exactly — no name is both and none is neither");
  for (const id of m.held) ok(m.returning.includes(id),
    `${id} is held, so it is by construction also returning`);
  for (const id of m.entered) ok(!m.held.includes(id),
    `${id} entered today, so it cannot be here on incumbency`);
  for (const id of m.entered) ok(m.ids.includes(id), `${id} is on the board it entered`);

  const cold = applyHysteresis(today, [], { entryRank: 25, exitRank: 35 });
  ok(cold.cold, "an empty incumbent list is reported as a COLD memory, not as a full board of arrivals");
  eq(cold.entered.length, 0,
     "so nothing claims to be new — 25 names would each be technically correct and the " +
     "page would be wrong");
  eq(cold.returning.length, 0, "and nothing claims to be returning either");
  eq(cold.ids.length, 25, "while the board itself is unaffected: the memory is a separate question");
  eq(cold.held.length, 0, "and no name can be held by an incumbency that does not exist");

  const warm = applyHysteresis(today, ["T1"], { entryRank: 25, exitRank: 35 });
  ok(!warm.cold, "one incumbent is a memory");
  eq(warm.entered.length, 24, "and 24 of the 25 are then genuinely new");
  deepEq(warm.returning, ["T1"], "with the one that was here named");

  const order = new Map(m.ids.map((t, i) => [t, i]));
  for (const list of [m.entered, m.returning, m.held]) {
    ok(list.every((t, i) => i === 0 || order.get(t) > order.get(list[i - 1])),
       "every subset comes back in the board's own rank order");
  }
}

{
  const { readFileSync, existsSync } = await import("node:fs");
  const PAGES = await import("../shared/flows-pages.js");
  const { ASSET_VERSION } = PAGES;
  const onDisk = readFileSync(new URL("../assets/version.txt", import.meta.url), "utf8").trim();
  ok(ASSET_VERSION === onDisk,
     `flows-pages ASSET_VERSION (${ASSET_VERSION}) matches assets/version.txt (${onDisk})`);

  const emitted = new Set();
  for (const [name, fn] of Object.entries(PAGES)) {
    if (typeof fn !== "function" || !/Page$/.test(name)) continue;
    let html;
    try { html = String(fn({ username: "tester", ticker: "AAPL" })); }
    catch (error) { assert.fail(`${name} threw while rendering: ${error && error.message}`); }
    for (const m of html.matchAll(/<(?:script[^>]+src|link[^>]+href)="([^"]+)"/g)) {
      const href = m[1].split("?")[0];
      if (href.startsWith("/assets/")) emitted.add(href);
    }
  }

  ok(emitted.size >= 10,
     `the emitted-asset set is discovered from the page functions rather than listed ` +
     `(${emitted.size} found across the section) — a tag added to a route is covered here ` +
     `without anyone remembering to add it`);

  for (const href of [...emitted].sort()) {
    ok(existsSync(new URL(".." + href, import.meta.url)),
       `${href} is emitted by a Flows page and exists on disk — a deferred script or a ` +
       `stylesheet that 404s fails silently, leaving a document that renders and a route ` +
       `that never draws`);
  }
}

{
  const { partitionSides } = await import("../scripts/flows-pipeline.mjs");

  for (const n of [60, 50, 48, 40, 20, 3, 1, 0]) {
    const scored = Array.from({ length: n }, (_, i) => ({ ticker: "T" + i, score: 100 - i * 4 }));
    const { long, short } = partitionSides(scored);
    const overlap = long.filter((r) => short.some((s) => s.ticker === r.ticker));
    ok(overlap.length === 0, `pool of ${n} yields disjoint boards (overlap ${overlap.length})`);
    ok(long.length + short.length <= n, `pool of ${n} is not double-counted`);
  }

  {
    const { medianDollarVolume } = await import("../scripts/flows-pipeline.mjs");

    near(medianDollarVolume([{ close: "10", volume: 100 }]), 1000, 1e-9,
         "a single candle yields its own dollar volume");
    near(medianDollarVolume([
      { close: "10", volume: 100 }, { close: "10", volume: 300 },
    ]), 2000, 1e-9, "an even count averages the middle pair");

    const spiky = [
      ...Array.from({ length: 20 }, () => ({ close: "10", volume: 1000 })),
      { close: "10", volume: 100000000 },
    ];
    near(medianDollarVolume(spiky), 10000, 1e-9,
         "a single volume spike cannot drag the median over the floor");

    near(medianDollarVolume([]), 0, 0, "no candles reports zero, not a pass");
    near(medianDollarVolume([{ close: "0", volume: 0 }]), 0, 0, "zero volume reports zero");
    near(medianDollarVolume(null), 0, 0, "null candles are safe");
  }

  const scored = Array.from({ length: 60 }, (_, i) =>
    ({ ticker: "T" + i, score: 100 - i * 4, residual: (100 - i * 4) / 50 }));
  const { long, short, neutral, deadBand } = partitionSides(scored);
  ok(long[0].score > long[long.length - 1].score, "the long side is ordered best-first");
  ok(short[0].score < short[short.length - 1].score, "the short side is ordered most-negative-first");
  ok(long[0].score === 100, "the long side starts at the highest score");
  ok(short[0].score === 100 - 59 * 4, "the short side starts at the lowest score");

  ok(long.every((r) => r.score >= deadBand), "no long-board name is inside the dead band");
  ok(short.every((r) => r.score <= -deadBand), "no short-board name is inside the dead band");
  ok(long.length + short.length + neutral === scored.length, "every name is accounted for");
  const tickers = new Set([...long, ...short].map((r) => r.ticker));
  ok(tickers.size === long.length + short.length, "the two sides are ticker-disjoint");

  const flatDay = Array.from({ length: 40 }, (_, i) => ({ ticker: "F" + i, score: i - 20, residual: (i - 20) / 50 }));
  const flat = partitionSides(flatDay);
  ok(flat.long.length + flat.short.length < flatDay.length,
     "a quiet session yields a SHORTER board, not a full one made of noise");
}

{

  const zeroRung = (k) => ({ strike: String(k), call_gamma_ask: "0", call_gamma_bid: "0",
                             put_gamma_ask: "0", put_gamma_bid: "0" });
  const rung = (k, g) => ({ strike: String(k), call_gamma_ask: String(g), call_gamma_bid: "0",
                            put_gamma_ask: "0", put_gamma_bid: "0" });

  const deadTail = aggressorGamma([
    zeroRung(61), zeroRung(62), zeroRung(63), zeroRung(64),
    rung(70, -5e6), rung(80, -5e6), rung(90, 6e6), rung(100, 6e6), rung(110, 1e6),
  ], { spot: 88 });
  ok(deadTail.flip !== 61 && deadTail.flip !== 62,
     `a rung with no measured gamma is not a flip (got ${deadTail.flip})`);
  ok(deadTail.flip > 80 && deadTail.flip < 100,
     `the flip is the real crossing in the middle of the book (got ${deadTail.flip})`);

  ok(aggressorGamma([zeroRung(10), zeroRung(20), zeroRung(30)], { spot: 20 }).flip === null,
     "a book with no measured gamma has no flip");

  const twoCrossings = aggressorGamma([
    rung(50, -1e7), rung(60, 2e7), rung(70, -2e7), rung(80, -1e6),
    rung(90, 3e7), rung(100, 1e6), rung(110, 1e6),
  ], { spot: 88 });
  ok(twoCrossings.crossings.length >= 2, "every crossing is collected, not just the first");
  const nearest = twoCrossings.crossings.reduce(
    (a, b) => (Math.abs(b.strike - 88) < Math.abs(a.strike - 88) ? b : a));
  ok(twoCrossings.flip === nearest.strike, "the published flip is the crossing nearest spot");

  const clean = [];
  let cum = 0;
  for (let k = 70; k <= 130; k++) { cum += (k - 95) * 1e5; clean.push({ strike: k, cum }); }
  const found = gammaCrossings(clean, { materiality: 0.1 });
  ok(found.length >= 1, "a textbook single-crossing book yields its crossing");

  ok(deadTail.flipSide === "short_below",
     `a book short below and long above reports short_below (got ${deadTail.flipSide})`);
  const inverted = aggressorGamma([
    rung(50, 1e7), rung(60, 1e6), rung(70, -3e7), rung(80, -1e6), rung(90, -1e6),
  ], { spot: 75 });
  ok(inverted.flipSide === "long_below",
     `a book LONG below and short above reports long_below (got ${inverted.flipSide})`);

  const fromCum = (pairs) => {
    let prev = 0;
    return pairs.map(([k, cumM]) => {
      const cum = cumM * 1e6, g = cum - prev;
      prev = cum;
      return { strike: String(k), call_gamma_ask: String(g), call_gamma_bid: "0",
               put_gamma_ask: "0", put_gamma_bid: "0" };
    });
  };

  const wobbly = aggressorGamma(
    fromCum([[90, -100], [95, -60], [99, -2], [100, 1], [101, -2], [103, -50], [105, 100], [110, 120]]),
    { spot: 100.5 });
  ok(wobbly.flip > 103 && wobbly.flip < 105,
     `the flip is the boundary between the -50M and +100M books, not the blip at spot ` +
     `(got ${wobbly.flip})`);
  eq(wobbly.flipSide, "short_below",
     "and the side is read from the book below it, which is short");
  ok(wobbly.flipSeparation > 0.3,
     `a boundary dividing 50M from 120M is strong (got ${(wobbly.flipSeparation * 100).toFixed(1)}%)`);
  ok(wobbly.crossings.every((c) => Math.abs(c.strike - 100.33) > 0.5),
     "and the sub-1% blip does not survive the noise floor at all");

  const weak = aggressorGamma(fromCum([[90, 1], [95, 3], [100, -40], [110, -60]]), { spot: 97 });
  ok(weak.flip !== null, "a thin-but-real long side still publishes a flip");
  ok(weak.flipSeparation < 0.15,
     `and reports how thin it is (got ${(weak.flipSeparation * 100).toFixed(1)}%)`);
  const strong = aggressorGamma(fromCum([[90, 50], [95, 60], [100, -40], [110, -60]]), { spot: 97 });
  ok(strong.flipSeparation > weak.flipSeparation,
     "a boundary with real book on both sides reports a larger separation");

  const zeroTouch = aggressorGamma(fromCum([[100, -5], [110, 0], [120, -5]]), { spot: 110 });
  eq(zeroTouch.crossings.length, 0, "a zero touch without a sign change is not a crossing");
  eq(zeroTouch.flip, null, "and publishes no flip");

  const withEmpty = aggressorGamma(
    [{ strike: "80" }, { strike: "85" }, ...fromCum([[100, -5], [110, 5], [120, 6]])],
    { spot: 110 });
  eq(withEmpty.bandMin, 100, "a strike with no measured exposure is dropped, not banded in");
  eq(withEmpty.bandMax, 120, "and the top of the band is unaffected");

  ok(deadTail.spotGammaShare < 0, "spot above a short_below flip is still short gamma here");
  ok(Math.abs(deadTail.spotGammaShare) <= 1, "spotGammaShare is bounded by construction");
  ok(aggressorGamma([], { spot: 100 }).spotGammaShare === null, "no ladder means no reading");

  const banded = fromCum([[100, -5], [110, 5], [120, 6]]);
  eq(aggressorGamma(banded, { spot: 1000 }).spotGammaShare, null,
     "spot far above the band has no reading, rather than a confident +1");
  eq(aggressorGamma(banded, { spot: 10 }).spotGammaShare, null,
     "and neither does spot far below it");
  ok(aggressorGamma(banded, { spot: 110 }).spotGammaShare !== null,
     "while spot inside the band does");
  eq(aggressorGamma([{ strike: "100", call_gamma_ask: "-5e6", call_gamma_bid: "0",
                       put_gamma_ask: "0", put_gamma_bid: "0" }], { spot: 100 }).spotGammaShare, null,
     "a one-rung ladder cannot be interpolated across, so it reports nothing");
}

{
  ok(isLiveColumn([1, 2, 3]), "a varying column is live");
  ok(!isLiveColumn([0, 0, 0, 0]), "an all-zero column is dead");
  ok(!isLiveColumn([7, 7, 7]), "a constant column is dead");
  ok(!isLiveColumn([5]), "a single value cannot have dispersion");

  ok(effectiveBreadth([[0, 0, 0, 0]]) === 0, "one dead column earns no weight");
  ok(effectiveBreadth([[0, 0, 0, 0], [0, 0, 0, 0]]) === 0, "two dead columns earn no weight");
  ok(effectiveBreadth([[1, 2, 3, 4]]) === 1, "one live column earns one unit");
  ok(effectiveBreadth([[1, 2, 3, 4], [0, 0, 0, 0]]) === 1,
     "a dead column beside a live one adds nothing");

  const dup = [1, 2, 3, 4, 5];
  near(effectiveBreadth([dup, dup.slice()]), 1, 1e-6, "two identical columns are one signal");
  ok(effectiveBreadth([[1, 2, 3, 4, 5], [5, 1, 4, 2, 3]]) > 1.2,
     "two unrelated columns are more than one signal");

  const a = [1, 2, 3, 4, 5, 6];
  const red = crossFamilyRedundancy({ A: a, B: a.slice(), C: [3, 1, 4, 1, 5, 9] });
  ok(red.A > 1 && red.B > 1, "a family restated by another is discounted");
  ok(red.A > red.C, "the redundant pair is discounted harder than the independent one");
  const solo = crossFamilyRedundancy({ A: a });
  ok(solo.A === 1, "a lone family has nothing to be redundant with");
}

{
  const pr = percentileRank([10, 20, 30, 40]);
  ok(pr.every((p) => p > 0 && p < 1), "percentiles live strictly inside (0,1)");
  ok(pr[0] < pr[3], "percentiles are monotone in the value");
  near(pr.reduce((x, y) => x + y, 0) / pr.length, 0.5, 1e-9, "their mean is one half by construction");

  const tied = percentileRank([5, 5, 5, 5]);
  ok(tied.every((p) => Math.abs(p - tied[0]) < 1e-12), "ties share one averaged rank");
  ok(percentileRank([1, NaN, 3])[1] === null, "an unmeasured entry casts no vote");

  const g = qualityGate([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]]);
  near(g.reduce((x, y) => x + y, 0) / g.length, 1, 1e-9, "the gate has a cross-sectional mean of one");
  ok(g.every((v) => v > 0 && v <= 2), "the gate is bounded in (0,2]");
  ok(g.every((v) => Math.abs(v - 1) < 1e-9), "two exactly opposed axes cancel to a neutral gate");

  const oneAxis = qualityGate([[1, 2, 3, 4, 5]]);
  ok(oneAxis[4] > oneAxis[0], "a better name gets a larger multiplier");
  ok(oneAxis.every((v) => v > 0), "no name is ever gated to zero");

  const flat = qualityGate([[1, 1, 1, 1, 1]]);
  ok(flat.every((v) => v === 1), "a modifier with no dispersion changes nothing");

  const allDead = qualityGate([[null, null, null, null, null], [7, 7, 7, 7, 7]]);
  ok(allDead.length === 5, `a dead gate still has one entry per name (got ${allDead.length})`);
  ok(allDead.every((v) => v === 1), "and every entry is neutral, so the composite passes through");
  const blendedDark = [0.5, -0.3, 1.2, -0.9, 0.1];
  ok(blendedDark.map((b, i) => b * allDead[i]).every(Number.isFinite),
     "so no composite becomes NaN when the quality axes go dark");
  ok(qualityGate([]).length === 0, "no axes at all is still an empty cross-section");
  ok(qualityGate([[], []]).length === 0, "and so are empty columns");

  const signal = [-3, -1, 1, 3, 5];
  const gated = signal.map((v, i) => v * oneAxis[i]);
  ok(gated.every((v, i) => Math.sign(v) === Math.sign(signal[i])),
     "the gate scales conviction and never reverses it");
}

{
  const flat = realizedVol(new Array(40).fill(100));
  near(flat, 0, 1e-9, "a flat series has no realized vol");

  const alt = [100];
  for (let i = 0; i < 40; i++) alt.push(alt[alt.length - 1] * (i % 2 ? 1 / 1.01 : 1.01));
  const rv = realizedVol(alt, { window: 30 });
  ok(rv > 0.1 && rv < 0.5, `an alternating 1% series annualizes into a plausible band (got ${rv.toFixed(3)})`);

  ok(realizedVol([100]) === null, "one close cannot have a vol");
  ok(realizedVol(null) === null, "a null series is safe");
  ok(realizedVol([100, 0, -5, 110]) === null,
     "dropping non-positive closes can leave too few returns — null, never NaN");
  ok(realizedVol([100, 0, 101, -5, 99, 102, 98]) !== null,
     "a bad print in the middle does not destroy the series");
}

{
  const AS_OF = "2022-05-20";
  const bsRow = (expiry, days, { spot = 100, vol = 0.45, rate = 0.04 } = {}) => {
    const legs = { gc: 0, gp: 0, dc: 0, dp: 0, vc: 0, vp: 0, cc: 0, cp: 0 };
    [80, 90, 95, 100, 105, 110, 125].forEach((k, j) => {
      const oc = 2000 + 700 * j, op = 5200 - 600 * j;
      const c = blackScholesGreeks({ spot, strike: k, days, vol, rate, type: "C" });
      const pu = blackScholesGreeks({ spot, strike: k, days, vol, rate, type: "P" });
      legs.gc += c.gamma * oc * 100; legs.gp += pu.gamma * op * 100;
      legs.dc += c.delta * oc * 100; legs.dp += pu.delta * op * 100;
      legs.vc += c.vanna * oc * 100; legs.vp += pu.vanna * op * 100;
      legs.cc += 50 * c.charmPerDay * oc * 100; legs.cp += 50 * pu.charmPerDay * op * 100;
    });
    return {
      expiry, dte: days,
      call_gex: String(legs.gc), put_gex: String(-legs.gp),
      call_delta: String(legs.dc), put_delta: String(legs.dp),
      call_charm: String(legs.cc), put_charm: String(legs.cp),
      call_vanna: String(legs.vc), put_vanna: String(legs.vp),
    };
  };
  const VENDOR = [bsRow("2022-05-25", 5), bsRow("2022-06-17", 28)];

  ok(legPresent(VENDOR, callVannaLeg) && legPresent(VENDOR, putVannaLeg),
    "both vanna legs are found under their wire names");
  ok(legPresent(VENDOR, callCharmLeg) && legPresent(VENDOR, putCharmLeg),
    "and both charm legs");
  ok(legPresent(VENDOR, callDeltaLeg), "and the call delta leg");
  ok(!legPresent(VENDOR, (r) => r.call_theta),
    "while a leg the endpoint does not carry is absent — the presence test is " +
    "not vacuously true");
  ok(!legPresent([{ call_vanna: null }, { call_vanna: "" }], callVannaLeg),
    "AND NULL IS NOT PRESENCE. A vendor that stopped publishing a leg sends " +
    "nulls, and a leg read as present-but-zero would draw a flat line that a " +
    "reader takes for a measured empty book");

  const vanna = greekTermStructure(VENDOR,
    { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg, asOf: AS_OF });
  const charm = greekTermStructure(VENDOR,
    { name: "charm", callLeg: callCharmLeg, putLeg: putCharmLeg, asOf: AS_OF });
  const delta = greekTermStructure(VENDOR,
    { name: "delta", callLeg: callDeltaLeg, putLeg: putDeltaLeg, asOf: AS_OF });

  eq(vanna.status, "ok", "the vanna term structure builds");
  eq(vanna.rows.length, 2, "one row per expiry");
  eq(vanna.rows[0].expiry, "2022-05-25", "sorted onto the calendar");
  eq(vanna.rows[0].dte, 5, "counting days from the session it was asked for");

  ok(Number(VENDOR[0].put_gex) < 0,
    "put gamma arrives DEALER-SIGNED: rows generated from Black-Scholes under the vendor's " +
    "convention carry it negated");
  ok(delta.rows.every((r) => r.put < 0),
    "put delta arrives with the HOLDER's sign, negative on every expiry, as it is on 1,940 of " +
    "1,940 live rows");
  const holder = blackScholesGreeks({ spot: 100, strike: 110, days: 5, vol: 0.45, rate: 0.04, type: "P" });
  const callSame = blackScholesGreeks({ spot: 100, strike: 110, days: 5, vol: 0.45, rate: 0.04, type: "C" });
  ok(holder.vanna === callSame.vanna && holder.charmPerDay === callSame.charmPerDay,
    "a holder's put carries the call's own vanna and charm, so a put leg in the (+,\u2212) quadrant " +
    "is raw, and one in (+,+) would be the negated charm the old note claimed");
  ok(Math.sign(charm.rows[0].put) !== Math.sign(vanna.rows[0].put),
    "on these rows the put leg's vanna and charm are opposite-signed: charm is NOT dealer-signed");
  eq(vanna.signConvention, SIGN_CONVENTION,
    "so the convention on the payload names put gamma as the only dealer-signed leg");
  ok(/call \u2212 put for delta, vanna and charm/.test(SIGN_CONVENTION) && /call \+ put for gamma/.test(SIGN_CONVENTION),
    "and states the dealer net for each greek");
  for (const [built, name] of [[vanna, "vanna"], [charm, "charm"], [delta, "delta"]]) {
    for (const r of built.rows) {
      if (r.call === null || r.put === null) continue;
      near(r.dealer, r.call + GREEK_DEALER_SIGN[name] * r.put, 1e-6 * Math.abs(r.call),
        `each ${name} row carries its dealer net, call \u2212 put (${r.expiry})`);
    }
  }
  eq(delta.dealerRule, "call \u2212 put", "and names the rule it applied");

  ok(/share-delta/.test(GREEK_UNITS.delta) && /holder-signed/.test(GREEK_UNITS.delta),
    "delta is share-delta, holder-signed, as the vendor defines it — not dollar-delta");
  ok(!/per DAY/.test(charm.unit) && !/VOL POINT/.test(vanna.unit),
    "and no per-day or per-vol-point unit is claimed until the scale is measured each run");
  ok(vanna.unit !== charm.unit && vanna.unit === GREEK_UNITS.vanna,
    "read without their units these are interchangeable large numbers, which " +
    "is exactly how '1352% of its year' happened");

  const lapsed = greekTermStructure([{ ...VENDOR[0], expiry: AS_OF }, VENDOR[0]],
    { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg, asOf: AS_OF });
  eq(lapsed.rows.length, 1, "an expiry dated on the session expired at its close and is not a row");
  eq(lapsed.expired, 1, "and the drop is counted");

  const absent = greekTermStructure(VENDOR,
    { name: "vanna", callLeg: () => undefined, putLeg: () => undefined });
  eq(absent.status, "absent",
    "A LEG THE VENDOR NEVER SENT IS ABSENT, not an empty book. Drawing zero " +
    "here would tell a reader this name carries no vanna, which is a claim " +
    "about the market made out of a claim about the response");
  ok(/published no vanna leg/.test(absent.reason), "with the reason in words");
  eq(greekTermStructure([{ expiry: "2026-01-16", call_vanna: "5" }],
    { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg }).status, "ok",
    "while ONE readable leg is half a reading and still a reading");
  eq(greekTermStructure([{ expiry: "2026-01-16", call_vanna: "5" }],
    { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg }).rows[0].put, null,
    "with the missing half NULL rather than zero — zeroing it would invent a " +
    "put book that is not there");

  const halfPresent = greekTermStructure([
    { expiry: "2026-01-16", call_vanna: "5", put_vanna: "7", dte: 3 },
    { expiry: "2026-02-20" },
    { expiry: "2026-03-20", call_vanna: "9" },
  ], { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg });
  eq(halfPresent.rows.length, 2,
    "AN EXPIRY CARRYING NEITHER LEG IS DROPPED, not published at zero — the " +
    "vendor said nothing about it and a zero row is a claim that it measured empty");
  eq(halfPresent.rows[1].expiry, "2026-03-20", "and the drop is of the right row");
  eq(halfPresent.rows[1].put, null,
    "the surviving half-present row keeps its real leg and nulls the other");
  eq(halfPresent.rows[1].dte, null,
    "AND AN UNSENT dte IS NULL, not 0. Coerced, it read 'expires today' — the " +
    "most consequential possible wrong answer on a term structure, since the " +
    "front expiry is the one a reader acts on");
  eq(halfPresent.rows[0].dte, 3, "while a dte the vendor did send is carried");
  eq(greekTermStructure([], { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg }).status,
    "absent", "an empty response has no legs at all");

  eq(JSON.stringify(greekTermStructure(VENDOR, { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg })),
     JSON.stringify(greekTermStructure(VENDOR, { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg })),
    "two builds over one response are byte-identical");
}

{
  const strikes = [];
  for (let k = 80; k <= 120; k += 5) {
    const g = k < 100 ? -40 : k === 100 ? 30 : 60;
    strikes.push({ strike: String(k), call_gamma_ask: String(g / 2), call_gamma_bid: String(g / 2),
      put_gamma_ask: "0", put_gamma_bid: "0" });
  }
  const ohlc = Array.from({ length: 30 }, (_, i) => ({
    start_time: new Date(Date.UTC(2026, 7, 1) + i * 86400000).toISOString(),
    open: 100, high: 101, low: 99, close: 100 + (i % 2), volume: 1e6,
  }));
  const base = { ticker: "T", spot: 107, greekFlow: [{ dir_delta_flow: "1", total_delta_flow: "2" }],
    ticks: [], strikes, ohlc, sessionDate: "2026-08-31" };
  const flowOnly = computeFeatures({ ...base, expiries: [] });
  ok(flowOnly.netGamma > 0, `the flow ladder's total is long (${flowOnly.netGamma})`);
  ok(flowOnly.spotGammaShare < 0, `while its running sum below spot is short (${flowOnly.spotGammaShare})`);
  eq(flowOnly.gRegime, "long",
    "and the label follows the net, not the running sum below spot — with no book on the card it " +
    "falls back to the gamma dealers added today");
  eq(flowOnly.gRegimeFrom, "flow", "and says that is where it came from");
  const withBook = computeFeatures({ ...base, expiries: [
    { expiry: "2026-09-04", call_gex: "10", put_gex: "-25" },
    { expiry: "2026-08-31", call_gex: "900", put_gex: "-1" },
  ] });
  eq(withBook.gRegime, "short",
    "with the open-interest book present, the label is the book's net: 10 + (\u221225) is short, " +
    "whatever the flow ladder says");
  eq(withBook.gRegimeFrom, "book", "read from the book");
  eq(withBook.gammaBookRaw, -15, "an expiry dated on the session is not in the book");
  near(withBook.gammaBookShare, -15 / 35, 1e-12, "and the book's net is published as a share of its gross");
  eq(openInterestGammaBook([{ expiry: "2026-09-04", call_gex: null, put_gex: "" }], { asOf: "2026-08-31" }).net, null,
    "a book with no readable leg is absent, not zero");

  eq(aggressorGamma([], { spot: 100 }).netGamma, null, "an empty ladder has no net gamma, not a net of zero");
  const legless = strikes.map((r) => ({ strike: r.strike }));
  const noLadder = computeFeatures({ ...base, strikes: legless, expiries: [] });
  eq(noLadder.netGamma, null, "a strike response whose rows carry no gamma leg is no flow ladder: its net is absent, not $0");
  eq(noLadder.gRegime, null, "so no regime label is read off it, where null >= 0 would have read long");
  eq(noLadder.gRegimeFrom, null, "and no source is claimed for one");
  const opts = { probe: { call: "raw", put: "raw" }, kc: { status: "ok", value: 50 },
    vannaScale: { status: "agree", ratio: 1, n: 5 } };
  const boardV = variation(featuresVariationInput({ features: noLadder, raw: { expiries: [] } }, base.sessionDate), opts);
  eq(boardV.status, "unavailable", "with no book either, the board row's hedging model has no gamma channel to publish");
  eq(boardV.silences[0].code, "no-gamma", "and says so in the code the table spells out");
  eq(variationSummary(boardV).why.all, "no-gamma", "so the row carries no gammaPerSigmaPctAdv of 0");
  const card = buildCard({ ticker: "T", row: { close: "107" }, features: noLadder, strikes: legless, ticks: [], expiries: [],
    generatedAt: "2026-08-31T21:00:00Z", sessionDate: base.sessionDate, variation: opts });
  eq(card.panels.gamma.status, "unavailable", "the card's gamma panel reads no strike ladder");
  eq(card.regime.flowGamma, null, "its regime carries no flow gamma");
  eq(card.panels.variation.status, "unavailable",
    "and its hedging panel agrees, rather than leading with today's trading adding $0.00 of hedging");
  eq(gammaReading(card).from, null, "Neuron reads no gamma label, where it read a long '+$0 per 1% move'");
}

console.log(`✓ flows-features: ${checks} assertions — robust stats, a fixed score unit, materiality-gated gamma flips, multiplicative quality gating, dead-column weighting, realized vol, reachable conviction, and the four second-order exposure legs one vendor call already pays for — with the put-leg conventions generated from Black-Scholes rather than read off the vendor's placeholder (put gamma dealer-signed, put delta, vanna and charm holder-signed, every expiry's dealer net published), the gamma label read from the book's net rather than the running sum below spot, and the fused hot path proven ELEMENTWISE IDENTICAL to the eight-sort form it replaces across every degenerate column that reaches a different branch`);
