/* Contracts for shared/flows-features.js.
   Runs with plain Node, no browser and no network: every fixture is
   synthetic, so the maths is provable without API access.

   Several cases exist specifically because an earlier draft of this
   system got them wrong:
     * put_gamma is pre-signed, so dealer gamma is a SUM (subtracting
       inverts every regime call);
     * an absolute conviction threshold made the top band unreachable
       and stranded every name at "no view";
     * a sparse signal collapses the MAD to zero and produced Infinity
       for the handful of names that actually fired. */

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
  SCORE_SCALE,
} from "../shared/flows-features.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deepEq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, tol, msg) => {
  assert.ok(Math.abs(a - b) <= tol, `${msg} — got ${a}, want ${b} ±${tol}`);
  checks++;
};

/* ---------- numeric hygiene ------------------------------------ */
{
  near(num("27723806.00"), 27723806, 1e-9, "parses UW numeric strings");
  near(num("-0.021"), -0.021, 1e-12, "parses negatives");
  near(num(null), 0, 0, "null falls back");
  near(num("abc"), 0, 0, "garbage falls back");
  near(num("abc", -1), -1, 0, "explicit fallback honoured");
  near(num(Infinity), 0, 0, "non-finite falls back");
  /* A BLANK IS ABSENT, NOT ZERO. Number(" ") is 0, so before the trim a
     whitespace-only field passed the empty test and reached NaN-fallback
     callers — ivRankFraction among them — as a measured zero. */
  near(num("   "), 0, 0, "whitespace falls back to the default 0");
  eq(Number.isNaN(num("   ", NaN)), true, "whitespace honours a NaN fallback: absent, not zero");
  eq(Number.isNaN(num("\t\n", NaN)), true, "so does a tab-and-newline blank");
  near(num("  5 "), 5, 0, "a padded number still parses");
}

/* ---------- robust statistics ---------------------------------- */
{
  near(median([3, 1, 2]), 2, 0, "odd median");
  near(median([4, 1, 2, 3]), 2.5, 0, "even median");
  near(quantile([1, 2, 3, 4, 5], 0.5), 3, 1e-12, "quantile midpoint");
  near(quantile([1, 2, 3, 4, 5], 0), 1, 1e-12, "quantile floor");
  near(quantile([1, 2, 3, 4, 5], 1), 5, 1e-12, "quantile ceiling");

  // MAD of a symmetric set: deviations are 2,1,0,1,2 -> median 1 -> 1.4826
  near(mad([1, 2, 3, 4, 5]), 1.4826, 1e-9, "MAD is sigma-consistent");

  const w = winsorize([-100, 1, 2, 3, 4, 5, 900], 0.25);
  ok(Math.max(...w) <= quantile([-100, 1, 2, 3, 4, 5, 900], 0.75) + 1e-9, "winsorize clips high tail");
  ok(Math.min(...w) >= quantile([-100, 1, 2, 3, 4, 5, 900], 0.25) - 1e-9, "winsorize clips low tail");
  ok(w.length === 7, "winsorize clips rather than drops");
}

/* ---------- the sparse-signal MAD trap -------------------------- */
{
  // 90 names at exactly zero, 10 that fired. median = 0 and MAD = 0,
  // so a naive median/MAD z is Infinity for every name that fired.
  const sparse = [...new Array(90).fill(0), 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const z = robustZ(sparse);
  ok(z.every(Number.isFinite), "sparse signal never yields Infinity");
  ok(z.every((v) => Math.abs(v) <= 3 + 1e-9), "robustZ respects the clamp");
  ok(Math.max(...z) > 0, "the names that fired still rank above the zeros");
  const zeroIdx = z.slice(0, 90);
  ok(new Set(zeroIdx.map((v) => v.toFixed(6))).size === 1, "all inactive names score identically");
}

/* ---------- inverse normal ------------------------------------- */
{
  near(invNorm(0.5), 0, 1e-9, "median of the normal is zero");
  near(invNorm(0.975), 1.959963985, 1e-6, "97.5th percentile is 1.96");
  near(invNorm(0.025), -1.959963985, 1e-6, "2.5th percentile is -1.96");
  near(invNorm(0.8413447461), 1.0, 1e-5, "one sigma");
  near(invNorm(0.001), -3.090232306, 1e-5, "deep tail stays accurate");
  ok(Number.isNaN(invNorm(0)), "invNorm rejects 0");
  ok(Number.isNaN(invNorm(1)), "invNorm rejects 1");
}

/* ---------- van der Waerden ------------------------------------ */
{
  const v = vanDerWaerden([10, 20, 30, 40, 50]);
  near(v.reduce((a, b) => a + b, 0), 0, 1e-9, "transform is centred");
  ok(v[0] < v[1] && v[1] < v[2] && v[2] < v[3] && v[3] < v[4], "monotone in rank");
  near(v[0], -v[4], 1e-9, "symmetric about the middle");

  const tied = vanDerWaerden([5, 5, 5, 9]);
  near(tied[0], tied[1], 1e-12, "ties share a score (0/1)");
  near(tied[1], tied[2], 1e-12, "ties share a score (1/2)");
  ok(tied[3] > tied[0], "the untied high value still ranks above");

  // scale invariance: the transform depends only on order
  const a = vanDerWaerden([1, 2, 3, 4]);
  const b = vanDerWaerden([100, 2000, 30000, 400000]);
  for (let i = 0; i < 4; i++) near(a[i], b[i], 1e-12, `rank-only, element ${i}`);
}

/* ---------- neutralization ------------------------------------- */
{
  // Inject a pure sector effect: tech +5, energy -5, plus a size tilt.
  const sectors = [];
  const size = [];
  const y = [];
  for (let i = 0; i < 60; i++) {
    const tech = i % 2 === 0;
    sectors.push(tech ? "tech" : "energy");
    const mcap = (i % 10) - 4.5;
    size.push(mcap);
    y.push((tech ? 5 : -5) + 0.8 * mcap);   // entirely explained by controls
  }
  const resid = neutralize(y, { numeric: [size], groups: sectors });
  const rms = Math.sqrt(resid.reduce((a, b) => a + b * b, 0) / resid.length);
  ok(rms < 1e-6, `neutralization removes an injected sector+size effect (rms ${rms})`);

  // A signal orthogonal to the controls must survive.
  const idio = y.map((v, i) => v + (i % 7 === 0 ? 10 : 0));
  const kept = neutralize(idio, { numeric: [size], groups: sectors });
  ok(Math.max(...kept.map(Math.abs)) > 5, "idiosyncratic signal survives neutralization");

  ok(neutralize([]).length === 0, "empty input is safe");
  ok(neutralize([1, 2], { groups: ["a", "b"] }).length === 2, "degenerate design returns input length");

  /* THE REGRESSION. Drop-first dummy coding gives a single-member level an
     indicator that is nonzero for exactly one row, so OLS has a free
     coefficient affecting only that row and drives its residual to zero --
     deleting the name's entire signal. The ridge does not restrain it: for a
     singleton column the XtX diagonal is 1, eight orders above a 1e-8 ridge.
     Measured before the fix: residual 5e-8 while the rest of the board reached
     0.85, so the strongest raw signal on the board ranked 22nd of 48. */
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

    // Pooling must not disturb sectors that are genuinely populated.
    const populated = Array.from({ length: n }, (_, i) => ["tech", "energy", "health"][i % 3]);
    const byGroup = Array.from({ length: n }, (_, i) => (i % 3) * 4 + Math.sin(i) * 0.1);
    const cleaned = neutralize(byGroup, { groups: populated });
    ok(Math.max(...cleaned.map(Math.abs)) < 0.5,
       "a real sector effect is still removed from well-populated groups");
  }
}

/* ---------- dealer gamma: the sign trap ------------------------- */
{
  // put_gamma arrives ALREADY negative. Total exposure is a SUM.
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

  // Analytic check: cum goes -180 -> +120 across 100..110.
  // Crossing sits 180/300 of the way: 100 + 10*0.6 = 106.
  near(g.flip, 106, 1e-9, "flip interpolation is exact");

  // A book that never changes sign must NOT invent a level.
  const oneSided = aggressorGamma([
    { strike: "10", call_gamma_ask: "5", call_gamma_bid: "0", put_gamma_ask: "0", put_gamma_bid: "0" },
    { strike: "20", call_gamma_ask: "5", call_gamma_bid: "0", put_gamma_ask: "0", put_gamma_bid: "0" },
  ]);
  ok(oneSided.flip === null, "no sign change means no fabricated flip");
  ok(gammaFlip([]) === null, "empty ladder has no flip");
}

/* ---------- book displacement ---------------------------------- */
{
  // Standing book centred at 100; today's volume centred at 110.
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

/* ---------- intraday path signature ----------------------------- */
{
  const t0 = Date.parse("2026-08-24T13:30:00Z");
  const minute = (i) => new Date(t0 + i * 60000).toISOString();

  /* Each row of /net-prem-ticks carries that TICK's own value, not a running
     total: the vendor defines net_call_premium as "(call premium ask side) -
     (call premium bid side)" for the tick and tape_time as "the start time of
     the tick". These fixtures are therefore per-minute increments.

     They were previously written as a cumulative ramp (0, 10, 20, ... 1000),
     which pinned the opposite convention and hid a real defect: the function
     differenced its input, so on true per-tick data it measured the SECOND
     difference and family D was noise. */

  // Same end-of-day net delta (1000), opposite shapes.
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

  /* THE REGRESSION. A buyer working a large order steadily all session: 390
     minutes at +900. Differencing the input returned (last tick - first tick)
     = 0, so Math.sign(net) was a coin flip and persistence was meaningless. */
  const worked = [];
  for (let i = 0; i < 390; i++) worked.push({ tape_time: minute(i), net_delta: "900" });
  const w = pathSignature(worked);
  near(w.net, 351000, 1e-9, "a worked order reports its true daily total, not ~0");
  ok(w.persistence > 0.99, "and reads as fully persistent rather than a coin flip");

  // A session that reverses nets out, and that is the honest reading.
  const reversal = [];
  for (let i = 0; i < 100; i++) reversal.push({ tape_time: minute(i), net_delta: i < 50 ? "500" : "-500" });
  near(pathSignature(reversal).net, 0, 1e-9, "flow that reverses within the day nets to zero");

  const thin = pathSignature([{ tape_time: minute(0), net_delta: "1" }]);
  near(thin.persistence, 0, 0, "too few bars degrades safely");
}

/* ---------- flow purity ---------------------------------------- */
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

  /* PURITY AND DIRECTION ARE DIFFERENT QUESTIONS, and conflating them is
     what produced purity 0.003-0.008 on a live board of names whose flow was
     overwhelmingly directional. A session that runs hard long and then hard
     short is 100% directional and 0% net — the old |SUM| / SUM|..| form
     reported it as unmeasurably impure. */
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

/* ---------- positioning quality --------------------------------- */
{
  const q = positioningQuality([
    { dir_delta_flow: "1000", otm_dir_delta_flow: "800", total_vega_flow: "200", total_delta_flow: "1000" },
  ]);
  near(q.otmShare, 0.8, 1e-9, "OTM share of directional flow");
  near(q.vegaTilt, 0.2, 1e-9, "vega per unit delta");
  ok(q.hasDirectionalView, "a real delta flow registers a view");

  // The trap: a vanishing denominator must read as "no view", not infinity.
  const none = positioningQuality([
    { dir_delta_flow: "0", otm_dir_delta_flow: "0", total_vega_flow: "9999", total_delta_flow: "0" },
  ]);
  ok(none.otmShare === null, "zero delta flow yields an UNMEASURED OTM share, not the best possible one");

  /* Gross over gross, so the ratio is bounded by construction rather than by
     the Math.min clamp. Two minutes whose directional flows cancel used to
     drive the denominator to zero and the ratio to its censored maximum. */
  const cancelled = positioningQuality([
    { dir_delta_flow: "1000", otm_dir_delta_flow: "100", total_vega_flow: "1", total_delta_flow: "1000" },
    { dir_delta_flow: "-1000", otm_dir_delta_flow: "-100", total_vega_flow: "1", total_delta_flow: "1000" },
  ]);
  near(cancelled.otmShare, 0.1, 1e-9,
       "a cancelling session reports its true OTM share, not the clamp");
  ok(none.vegaTilt === null, "zero delta flow yields an UNMEASURED vega tilt, not Infinity and not zero");
  ok(!none.hasDirectionalView, "zero delta flow reports no directional view");
}

/* ---------- one tape, one set of totals -------------------------- */
{
  /* WHAT THIS GUARDS. flowPurity used to accumulate a local called `tot` and
     positioningQuality a local called `delta`, in two separate loops over the
     same rows. They were the same quantity — Sigma|total_delta_flow| — under
     two names, so a change to one could not be seen from the other. Both now
     read one record, and these assertions are what would notice if they ever
     stopped: the two ratios must share a denominator BY CONSTRUCTION. */
  /* THE FOURTH ROW EARNS ITS PLACE: its total_delta_flow is NEGATIVE. Without a
     sign change in that column, Sigma|total| and |Sigma total| are the same
     number and nothing in this block can tell a gross accumulator from a net
     one — a version that dropped the Math.abs passed the first draft of these
     assertions. Every "gross" claim below is only checkable because this tape
     reverses. */
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

  /* AND THE COUNT ALONE CANNOT SAY WHICH SILENCE IT IS. Both lines above give
     rows === 0, and this file's law gives "measured and empty" and "never
     published" different prose and different data-empty tags. An earlier
     docstring called rows === 0 the absence marker; it is two absences sharing
     a number, so the record names which. */
  eq(greekFlowTotals([]).silence, "quiet",
     "an array that arrived with no prints in it is QUIET — measured, and empty");
  eq(greekFlowTotals(null).silence, "unavailable",
     "a tape that never arrived is UNAVAILABLE — a different sentence and a different tag");
  eq(greekFlowTotals(undefined).silence, "unavailable", "and so is an absent argument");
  /* AN ARRAY-LIKE THAT IS NOT AN ARRAY. The guard is `Array.isArray`, not a
     truthiness test, and this is the fixture that separates them: `{length: 3}`
     is truthy, so a truthy guard calls it published, hands it to `for...of` and
     throws TypeError on a shaper that is documented never to throw. The
     assertion below names the silence; the one above it names the refusal to
     crash, because those are two different promises. */
  ok(greekFlowTotals({ length: 3 }).rows === 0,
     "a non-array shape is refused rather than iterated — this shaper does not throw on a bad payload");
  eq(greekFlowTotals({ length: 3 }).silence, "unavailable",
     "and so is a shape that is not an array at all, rather than being iterated into a silent zero");
  eq(greekFlowTotals(TAPE).silence, null,
     "while a tape with prints in it is not silent, so the field is null and a renderer has nothing to say");
  ok(greekFlowTotals([]).silence !== greekFlowTotals(null).silence,
     "the two silences are distinguishable — which is the whole assertion, and it fails the moment they collapse");

  /* THE POINT OF THE REFACTOR, asserted rather than asserted-in-a-comment:
     flowPurity's published denominator IS positioningQuality's. */
  const purity = flowPurity(TAPE);
  near(purity.totalAbs, t.totalAbs, 0,
       "flowPurity divides by exactly the totals record's totalAbs, not its own copy");
  near(purity.dirDelta, t.dirNet, 0, "and publishes the same signed net");
  near(purity.dirAbs, t.dirAbs, 0, "and the same gross");
  near(positioningQuality(TAPE).vegaTilt, t.vegaAbs / t.totalAbs, 1e-12,
       "positioningQuality's vegaTilt divides by that same totalAbs");
  /* THE TWO RATIOS HAVE DIFFERENT DENOMINATORS ON PURPOSE, and the tape is
     built so they differ numerically (1100 against 2000). otmShare asks what
     fraction of the DIRECTIONAL flow was out of the money — bounded in [0,1]
     because |otm_dir| <= |dir| row by row — while vegaTilt asks about the whole
     tape. Dividing otmShare by totalAbs instead would still look plausible and
     would still be bounded; only this assertion says which is meant. */
  near(positioningQuality(TAPE).otmShare, t.otmAbs / t.dirAbs, 1e-12,
       "otmShare divides the gross OTM by the gross DIRECTIONAL, not by the tape's total");
  ok(t.dirAbs !== t.totalAbs,
     "and the two denominators really are different numbers here, so that assertion can fail");

  /* THREADING A PRECOMPUTED RECORD MUST CHANGE NOTHING. The pipeline calls both
     measures on one array back to back; handing them one record is a ~33%
     saving on that pair, and is worth nothing if it is also a different answer. */
  eq(JSON.stringify(flowPurity(TAPE, t)), JSON.stringify(flowPurity(TAPE)),
     "flowPurity is identical whether it builds the totals or is handed them");
  eq(JSON.stringify(positioningQuality(TAPE, { totals: t })), JSON.stringify(positioningQuality(TAPE)),
     "positioningQuality is identical whether it builds the totals or is handed them");
  eq(JSON.stringify(positioningQuality(TAPE, { floor: 1e5, totals: t })),
     JSON.stringify(positioningQuality(TAPE, { floor: 1e5 })),
     "and the floor still applies when a record is threaded — the option bag is not swallowed");

  /* THE TWO ENTRY POINTS TAKE THE RECORD DIFFERENTLY — flowPurity positionally,
     positioningQuality inside its option bag — and the pipeline calls them one
     line apart. So `flowPurity(rows, { totals: t })` is the mistake a reader
     makes after copying the line below it, and under a bare `totals || ...`
     truthiness test it did not throw: an option bag is an object, `.totalAbs`
     is undefined, `undefined <= 0` is false, the guard falls through and every
     ratio comes out NaN — which serialises to null, so the page prints
     "unmeasured" over a tape it measured perfectly. Absence coerced instead of
     tested, one level up, in a function argument instead of a vendor field.

     Both spellings are now accepted, and anything that is not a totals record
     is recomputed from the rows rather than trusted. */
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
  /* AND THE GUARD CAN FAIL: a genuinely valid record still short-circuits, so
     these assertions are not passing merely because everything recomputes. */
  const spy = { ...t, totalAbs: 4000 };
  near(flowPurity(TAPE, spy).totalAbs, 4000, 0,
       "a record carrying a finite totalAbs IS trusted — the recompute is a fallback, not the only path");
  ok(positioningQuality(TAPE, { floor: 1e5 }).otmShare === null,
     "a floor above the tape's own gross reports UNMEASURED — the branch the line above compares");

  /* THE ZERO-TAPE GUARD IS STILL THE OLD ONE. A tape whose every print carries
     no total delta is not "purity zero" — zero is a real reading here. */
  const dead = flowPurity([{ dir_delta_flow: "5", total_delta_flow: "0" }]);
  ok(dead.purity === null, "a tape with no total delta is UNMEASURED purity, not zero");
  near(dead.totalAbs, 0, 0, "and reports the zero denominator it actually measured");
}

/* ---------- gamma decay calendar -------------------------------- */
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

  /* THE REGRESSION. put_gamma arrives ALREADY dealer-signed, so taking the
     magnitude of the SUM cancels the two legs. Every fixture above passes
     put_gamma: "0", which is exactly why this went unnoticed. Here the front
     week carries 2.0e9 of GROSS gamma against September's 5e6 -- four hundred
     times more -- and the old code reported the front week as one sixth of the
     book and named September the half-life. */
  const signed = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gamma: "1e9", put_gamma: "-999000000" },
    { expiry: "2026-09-18", call_gamma: "5000000", put_gamma: "0" },
  ]);
  ok(signed.frontLoad > 0.99,
     `gross roll-off sums magnitudes: a 2.0e9 front week dominates (${signed.frontLoad})`);
  assert.equal(signed.halfLifeExpiry, "2026-08-28"); checks++;

  // A perfectly balanced expiry must not vanish from the schedule entirely.
  const balanced = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gamma: "1e9", put_gamma: "-1e9" },
    { expiry: "2026-09-18", call_gamma: "1e6", put_gamma: "0" },
  ]);
  ok(balanced.schedule.length === 2,
     "an expiry whose legs net to zero still carries gross gamma and stays on the schedule");

  /* THE WIRE NAMES. Every fixture above uses the DOCUMENTED call_gamma /
     put_gamma, which is why the roll-off panel could pass every test here and
     still report "unavailable: no expiry gamma" on all twelve live cards. A
     dated AAPL probe returned these values under call_gex / put_gex:

       date=2026-08-24 expiry=2026-08-24 call_gex=175414.5369 put_gex=-83920.3551

     Both names are read, wire first. This is the case the suite was missing. */
  const wire = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gex: "600", put_gex: "0" },
    { expiry: "2026-09-18", call_gex: "300", put_gex: "0" },
    { expiry: "2026-12-18", call_gex: "100", put_gex: "0" },
  ]);
  near(wire.schedule[0].share, 0.6, 1e-9, "call_gex is read as the call gamma leg");
  assert.equal(wire.halfLifeExpiry, "2026-08-28"); checks++;

  // put_gex is pre-signed on the wire exactly as put_gamma is: gross still sums.
  const wireSigned = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gex: "1e9", put_gex: "-999000000" },
    { expiry: "2026-09-18", call_gex: "5000000", put_gex: "0" },
  ]);
  ok(wireSigned.frontLoad > 0.99,
     `put_gex is dealer-signed too, so gross roll-off sums magnitudes (${wireSigned.frontLoad})`);

  /* The wire name WINS when a row carries both, so a vendor that starts
     sending the documented pair alongside the real one cannot silently swap
     which number the panel plots. */
  const bothNames = gammaDecayCalendar([
    { expiry: "2026-08-28", call_gex: "900", call_gamma: "100", put_gex: "0", put_gamma: "0" },
    { expiry: "2026-09-18", call_gex: "100", call_gamma: "900", put_gex: "0", put_gamma: "0" },
  ]);
  near(bothNames.frontLoad, 0.9, 1e-9, "call_gex takes precedence over call_gamma");
}

/* ---------- effective breadth ----------------------------------- */
{
  const base = Array.from({ length: 50 }, (_, i) => Math.sin(i));
  const dup = [base, base.slice(), base.slice()];      // three copies of one signal
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

/* ---------- calibration: the unreachable-ladder fix -------------- */
{
  // A realistic composite: mostly small, a few strong names.
  const zs = Array.from({ length: 500 }, (_, i) => invNorm((i + 0.5) / 500));
  const scale = calibrateScoreScale(zs, { refQuantile: 0.95, refScore: 80 });
  const scored = zs.map((z) => boundedScore(z, scale));

  const ref = quantile(zs.map(Math.abs), 0.95);
  near(Math.abs(boundedScore(ref, scale)), 80, 1, "the reference quantile lands on the reference score");

  ok(Math.max(...scored) >= 80, "the strong tail actually reaches the top band");
  ok(Math.min(...scored) <= -80, "the weak tail actually reaches the bottom band");
  ok(scored.every((s) => s >= -100 && s <= 100), "scores stay bounded");

  /* THE ASSERTION THAT BLESSED THE BUG.

     This block used to require that a cross-section compressed to a twentieth
     of its dispersion produce scores within three points of the loud day's,
     and called that property "calibration is dispersion-invariant". It is the
     defect stated as a requirement: a per-session scale makes the published
     number a function of rank and pool size alone, so a flat day and a violent
     one print the same +84. The requirement is now the opposite. */
  const quiet = zs.map((z) => z * 0.05);
  const loudFixed = zs.map((z) => boundedScore(z, SCORE_SCALE));
  const quietFixed = quiet.map((z) => boundedScore(z, SCORE_SCALE));
  ok(Math.max(...quietFixed) < Math.max(...loudFixed) - 20,
     `a compressed cross-section must score LOWER under the fixed unit ` +
     `(quiet ${Math.max(...quietFixed)} vs loud ${Math.max(...loudFixed)})`);

  // The unit itself, stated: two robust sigma is 80.
  near(boundedScore(2, SCORE_SCALE), 80, 1, "the fixed unit puts z = 2 at score 80");
  near(boundedScore(-2, SCORE_SCALE), -80, 1, "and is antisymmetric");
  ok(boundedScore(1, SCORE_SCALE) < boundedScore(2, SCORE_SCALE),
     "the fixed unit is monotone in the composite, not in the rank");

  /* THE COMPOSITION, which nothing tested: the score must not be recoverable
     from rank and pool size alone. Two 34-name cross-sections with the same
     ORDER and different SHAPES must publish different scores. */
  const shapeA = Array.from({ length: 34 }, (_, i) => (34 - i) * 0.01);
  const shapeB = Array.from({ length: 34 }, (_, i) => (34 - i) * 1.00);
  const a = shapeA.map((z) => boundedScore(z, SCORE_SCALE));
  const b = shapeB.map((z) => boundedScore(z, SCORE_SCALE));
  ok(JSON.stringify(a) !== JSON.stringify(b),
     "identical ranks with different dispersions must NOT produce the same ladder");

  // Degenerate input must not divide by zero.
  ok(calibrateScoreScale([0, 0, 0]) === 1, "a flat cross-section falls back to unit scale");
  ok(boundedScore(NaN, scale) === 0, "non-finite z scores zero");
  ok(boundedScore(1, 0) === boundedScore(1, 1), "a non-positive scale falls back to 1");
}

/* ---------- conviction is reachable ----------------------------- */
{
  // The exact failure found in review: every name stranded at "no view".
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

  /* ABSENT IS NOT NEUTRAL, and the old `s !== 0` presence filter conflated
     them in the direction that flattered the number: a family that produced
     nothing was silently dropped from the agreement denominator while the
     coverage term went on paying for it in full, so LOSING a family RAISED
     conviction. Presence is now a null test. */
  ok(conviction({ familyScores: [null, null], coverage: 0 }).conviction === 0,
     "families that are absent, with no coverage, mean no conviction");

  const neutralPair = conviction({ familyScores: [0, 0], coverage: 1, persistence: 0 });
  ok(neutralPair.agreement === 0,
     "two families measured and neutral agree with nothing");
  const oneDead = conviction({ familyScores: [40, 30, null], coverage: 1, persistence: 0 });
  const allLive = conviction({ familyScores: [40, 30, 20], coverage: 1, persistence: 0 });
  ok(oneDead.breadth === 2 && allLive.breadth === 3, "breadth counts only present families");
  ok(oneDead.conviction <= allLive.conviction, "losing a family must never RAISE conviction");

  // Every input in range must produce an in-range output.
  for (const cov of [0, 0.5, 1]) for (const per of [0, 0.5, 1]) {
    const c = conviction({ familyScores: [1, 1, -1], coverage: cov, persistence: per });
    ok(c.conviction >= 0 && c.conviction <= 100, "conviction stays within [0,100]");
  }
  // Out-of-range inputs are clamped rather than trusted.
  const wild = conviction({ familyScores: [1, 1], coverage: 99, persistence: -99 });
  ok(wild.conviction <= 100, "out-of-range coverage is clamped");

  /* ---------- the composite can be reconstructed from what it returns ----

     A COMPOSITE THAT CANNOT BE CHECKED IS AN OPAQUE NUMBER. This function
     returned two of the three terms it weights, so a consumer could describe
     conviction but not verify it, and the third term could move a published
     76 to a published 87 with nothing accounting for the difference. The card
     now publishes all three plus the weights, and that promise is only worth
     anything if the identity actually closes. */
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
  /* THE CLAMPED VALUES COME BACK, NOT THE ONES HANDED IN, or the identity
     closes for well-behaved inputs and silently fails for exactly the rows
     that needed checking. */
  eq(wild.coverage, 1, "coverage comes back as the arithmetic used it, clamped to 1");
  eq(wild.persistence, 0, "and persistence likewise, clamped up to 0");

  /* THE COUNT IS EXACT WHERE THE RATIO IS NOT. agree/present is a fraction of
     two small integers; 2/3 has no finite decimal, so a board rounding the
     ratio to three places publishes 0.667 and any consumer multiplying back
     to recover the count is doing arithmetic on a rounding error. */
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

  /* THE SHAPE THAT MAKES THE DECOMPOSITION WORTH PUBLISHING. Agreement is
     agree-over-present across at most three signed axes, so it takes three
     values and carries the heaviest weight — which is why two convictions a
     few points apart can differ by a whole axis. Pinned because it is the
     argument for every field added above: if agreement ever became continuous
     the case for the board carrying its count would need re-making. */
  /* THE FIRST DRAFT OF THIS ASSERTION WAS WRONG AND THE ERROR IS WORTH
     KEEPING. It offered [1,1,1], [1,1,-1] and [1,-1,-1] as three agreement
     levels and got two: `sign` is the sign of the SUM, so with three measured
     non-zero axes the majority always shares it and one-of-three cannot
     happen that way. It arrives only when an axis is measured NEUTRAL, or the
     signed sum is exactly zero — which is why the emitted corpus reaches it
     at all (13 rows of 96). The prose on the board and the card was rewritten
     from this: the count steps, and it runs 0..breadth, which is breadth+1
     values and not breadth. */
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

/* ---------- the scale estimator does not collapse on a signed column --- */
{
  /* THE FAILURE: a column that is BIMODAL BY SIGN — which is what every
     signed-magnitude column is — collapses the MAD. Once more than half the
     names share one sign, median(|x - median|) is taken over a set whose own
     median sits inside the majority cluster, so it measures the spread WITHIN
     that cluster and not the distance BETWEEN the two.

     Measured on the pipeline's own emitted board before the fix: eleven of
     twenty-four names printed family D as exactly 93 — the value of a z
     clamped at 3 — because every minority-sign name saturated. */
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

  /* The IQR alone is not enough: below a quarter of the board the quartiles
     themselves sit inside the majority, which is why a wider span is taken too. */
  const lopsided = robustZ(winsorize(bimodal(20, 4), 0.02));
  ok(Math.max(...lopsided.map(Math.abs)) < 3,
     "an 80/20 split is inside the clamp, not against it");

  /* A GENUINE OUTLIER MUST STILL CLAMP — the estimator is a floor on the
     scale, not an amnesty for extremes. */
  const outlier = robustZ([...Array.from({ length: 30 }, (_, i) => 1 + (i % 3) * 0.01), 500]);
  ok(Math.abs(outlier[30]) >= 2.999, "one wild value still clamps");

  /* AND A WELL-BEHAVED COLUMN IS UNCHANGED: all three estimators are
     consistent for Gaussian data, so the max of them agrees with the MAD. */
  const smooth = Array.from({ length: 60 }, (_, i) => Math.sin(i * 1.7) * 2 + i * 0.01);
  const zs = robustZ(smooth);
  ok(zs.filter((v) => Math.abs(v) >= 2.999).length === 0,
     "a smooth column has nothing at the clamp");
  ok(Math.max(...zs.map(Math.abs)) > 0.5,
     "and still has real dispersion — the floor shrinks z, it does not flatten it");
}

/* ---------- the fused hot path must be the SAME answer ----------- */
{
  /* THE DELIVERABLE OF THE FUSION IS THIS BLOCK, not the speedup.
     robustZ(winsorize(col, p)) issues EIGHT full sorts of one column — two in
     winsorize, one for the median, four across the two spans, one for the MAD's
     deviations — and scoreBoard asks for seven columns per board. robustZFused
     does it in two typed sorts. A faster answer that is a different answer is
     not an optimisation, it is a second spelling of the score, so every fixture
     below is checked ELEMENTWISE against the composed form.

     THE STATED TOLERANCE IS ZERO. Not "small": the absolute difference must be
     exactly 0 on every element of every fixture. The one representational
     difference that does occur is the SIGN OF A ZERO — a typed sort orders -0
     before +0 while a comparator sort leaves equal values where it found them,
     so an even-length median can come out -0 in one path and +0 in the other.
     -0 === 0 in JavaScript, every consumer of a z-score compares, scales or
     renders it, and none of those can tell the two apart. `agree` therefore
     requires exact numeric equality and tolerates only that. */
  const agree = (col, opts, label) => {
    const composed = robustZ(winsorize(col, opts.winsor ?? 0.02), { clamp: opts.clamp ?? 3 });
    const fused = robustZFused(col, opts);
    eq(fused.length, composed.length, `${label}: fused returns one z per input row`);
    ok(Array.isArray(fused), `${label}: and returns a plain Array, as robustZ does`);
    /* TYPE BEFORE VALUE, because `Math.abs(0 - null)` is 0 and this suite would
       otherwise have certified a version that returned an array of nulls as
       "identical". That is this repository's oldest scar wearing a test
       helper's clothes: absence must be checked BEFORE coercion, here as much
       as in the payload. Every z is a finite number or the comparison below
       means nothing. */
    ok(fused.every((v) => typeof v === "number" && Number.isFinite(v)),
       `${label}: every fused z is a finite NUMBER — never null, undefined or NaN`);
    let worst = 0;
    for (let i = 0; i < composed.length; i++) worst = Math.max(worst, Math.abs(composed[i] - fused[i]));
    ok(worst === 0, `${label}: fused equals robustZ(winsorize(...)) exactly (worst |diff| ${worst})`);
  };

  /* An ordinary board-shaped column: signed, with holes where a name was not
     measured. This is the case the pipeline actually runs. */
  const board = Array.from({ length: 128 }, (_, i) =>
    (i % 8 === 3 ? null : Math.sin(i * 2.399) * 1.7 + (i % 17 === 0 ? 9 : 0)));
  agree(board, { winsor: 0.02 }, "a 128-name board column with holes");

  /* THE DEGENERATE CASES. Each of these reaches a DIFFERENT branch, and the
     comment beside each says which — a fixture that cannot reach the branch it
     certifies is this repo's most repeated mistake. */

  // n = 0 finite: winsorize cannot form a quantile and returns the column
  // unclipped; robustZ then sees fewer than two finite entries.
  agree([], {}, "an empty column");
  agree([NaN, NaN, NaN, NaN], {}, "an ALL-NaN column — nothing was ever measured");
  agree([null, undefined, "", "abc"], {}, "a column of nulls, undefineds and unparseable strings");

  // n = 1 finite: winsorize clips a single value to itself; robustZ still
  // refuses to invent a scale from one point.
  agree([5], {}, "a single element");
  agree([null, 7, NaN], {}, "a single measured element among the silences");
  deepEq(robustZFused([null, 7, NaN], {}), [0, 0, 0],
     "a column too thin to score is the NEUTRAL VOTE for every row — literally 0, " +
     "not null and not undefined, because every caller does arithmetic on it");
  deepEq(robustZFused([], {}), [], "and an empty column is an empty array, not a row of anything");

  // n = 2: the smallest column that gets a real scale at all.
  agree([1, 2], {}, "n = 2, the smallest scored column");

  // MAD zero AND IQR zero AND stdev zero: every estimator collapses, and both
  // paths must fall all the way through to the all-zeros return.
  agree(new Array(40).fill(7), {}, "an ALL-EQUAL column — MAD, both spans and the stdev all collapse");
  const allEqual = robustZFused(new Array(40).fill(7), {});
  ok(allEqual.every((v) => v === 0),
     "and the all-equal column really does reach the final all-zeros exit, not merely agree by luck");

  /* MAD zero AND both spans zero, but the mean/stdev fallback DOES fire — a
     branch the all-equal fixture cannot reach, and one that is easy to write a
     fixture for and miss: 62 twos and a single 9 does NOT reach it, because
     winsorize at 0.02 clips the lone 9 back down to 2 and the column becomes
     all-equal after all. Two survivors are needed for the 0.98 quantile to
     land above the flat body. */
  const nearlyFlat = [...new Array(61).fill(2), 9, 9];
  agree(nearlyFlat, {}, "a near-constant column with two live values — the mean/stdev fallback");
  const flatZ = robustZFused(nearlyFlat, {});
  ok(flatZ.some((v) => v !== 0),
     "and that fallback really fires: the live values are not flattened to the neutral vote");
  /* THE FALLBACK ALSO MOVES THE CENTRE, from the median to the mean, so the
     flat body no longer sits at exactly zero. That is robustZ's own behaviour
     and the fused form reproduces it; the assertion is here so a future reader
     does not "fix" a body that is meant to be slightly off zero. */
  ok(new Set(flatZ.map((v) => v.toFixed(12))).size === 2,
     "two distinct z values: the flat body and the two live names");
  ok(flatZ[0] < 0 && flatZ[62] > 0,
     "and the body sits BELOW the mean while the live names sit above it — the centre moved");

  /* THE FALLBACK'S SUM IS ORDER-SENSITIVE, and the fused form folds it over the
     ORIGINAL row order because robustZ does. It would be natural to accumulate
     over the sorted buffer instead — it is right there, already built — and on
     ordinary data nobody would ever notice. This fixture notices. 101 entries:
     ten at -1e16, ten at +1e16, eighty-one at exactly 1, INTERLEAVED. Every
     decile lands inside the flat body so all three robust estimators collapse
     and the fallback runs; the extremes are large enough that adding 1 to them
     is a no-op, so the sum is 72 in the interleaved order and exactly 0 in
     sorted order. A different mean is a different z for every name.

     Without this case the suite passed a version that summed the sorted copy.
     It was found by mutation, not by reading. */
  const orderSensitive = [];
  for (let i = 0; i < 10; i++) orderSensitive.push(-1e16, 1e16, 1);
  while (orderSensitive.length < 101) orderSensitive.push(1);
  agree(orderSensitive, { winsor: 0.02 }, "an order-sensitive mean/stdev fallback");
  ok(orderSensitive.reduce((a, b) => a + b, 0) !==
     orderSensitive.slice().sort((a, b) => a - b).reduce((a, b) => a + b, 0),
     "and the fixture really is order-sensitive: its sum differs between row order and sorted order");
  ok(new Set(robustZFused(orderSensitive, { winsor: 0.02 }).map((v) => v.toFixed(12))).size === 3,
     "three distinct z values — the two extremes and the flat body, which is NOT at zero");

  /* Zero interquartile span with a LIVE 10-90 span: the third estimator is the
     only one carrying the scale, so this fixture is the only thing in the suite
     that would notice if the fused form dropped it. 15 low, 70 flat, 15 high:
     the quartiles both land inside the flat body and the deciles do not. */
  const wideOnly = [...new Array(15).fill(-5), ...new Array(70).fill(0), ...new Array(15).fill(5)];
  agree(wideOnly, {}, "a column whose interquartile span is zero but whose 10-90 span is not");
  const wideZ = robustZFused(wideOnly, {});
  near(wideZ[0], -5 / ((5 - -5) / 2.563), 1e-12,
       "the 10-90 estimator is what scaled it: z is the raw value over (span/2.563)");
  ok(Math.abs(wideZ[0]) < 3, "and nothing saturated the clamp, which is the whole point of the third span");
  ok(wideZ[20] === 0, "while the flat body sits at exactly the median");

  // The sparse-signal trap this file opens by naming.
  agree([...new Array(90).fill(0), 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], {}, "the sparse-signal MAD trap");

  // Bimodal by sign — the family-D failure the robustZ comment records.
  const bimodal2 = (pos, neg) => [
    ...Array.from({ length: pos }, (_, i) => 0.5 + (i % 5) * 0.01),
    ...Array.from({ length: neg }, (_, i) => -(0.5 + (i % 5) * 0.01)),
  ];
  for (const [a, b] of [[14, 10], [18, 6], [20, 4], [12, 12]]) {
    agree(bimodal2(a, b), { winsor: 0.02 }, `a ${a}/${b} sign split`);
  }

  /* THE SHORTCUT THIS FUNCTION REFUSES. It is tempting to skip the clip for
     every quantile except the MAD's, on the argument that winsorizing at 0.02
     only rewrites the sorted ends while 0.10..0.90 sits inside them. That is
     true at n = 128 and FALSE at n = 5, where the 0.02 quantile interpolates
     between the first two sorted entries and the 0.10 quantile reads those same
     two. This fixture is the one that would catch that shortcut. */
  agree([1, 2, 3, 4, 5], { winsor: 0.02 }, "n = 5, where the clip moves the 10th percentile");
  agree([-100, 1, 2, 3, 4, 5, 900], { winsor: 0.02 }, "n = 7 with both tails live");

  // A winsor wide enough to invert the bounds: lo > hi collapses the whole
  // column onto hi in the composed form, and the fused form must do the same
  // odd thing rather than the sensible thing.
  for (const p of [0, 0.01, 0.25, 0.49, 0.5, 0.6]) {
    agree([-100, 1, 2, 3, 4, 5, 900], { winsor: p }, `winsor = ${p}`);
  }
  for (const c of [0.5, 1, 3, 10]) agree([-100, 1, 2, 3, 4, 5, 900], { clamp: c }, `clamp = ${c}`);

  /* HUGE OPPOSITE-SIGNED EXTREMES. At n = 7 the 0.02 quantile still lands
     between two ordinary entries, so the bounds are finite and the clip happens
     normally — this fixture is NOT the overflow case, and saying so is the
     point: it was written believing it was. */
  agree([-1e308, 1e308, 0, 5, -5, 2, -2], { winsor: 0.02 }, "huge opposite-signed extremes, bounds still finite");

  /* THE ACTUAL OVERFLOW. At n = 2 the quantile interpolates directly between
     the two extremes, sorted[1] - sorted[0] overflows to Infinity, and the
     bound comes back non-finite. winsorize responds by returning the column
     UNCLIPPED, and the fused form has to refuse in the same place rather than
     clamping every name to Infinity. The same fixture then overflows the MAD
     (the even-length median sums the pair before halving it) and the stdev
     after it, so it also lands on the final all-zeros exit — the one reached
     when even the mean/stdev fallback cannot produce a usable scale. */
  const overflow = [-1e308, 1e308];
  agree(overflow, { winsor: 0.02 }, "bounds that overflow to Infinity — the clip is refused");
  ok(robustZFused(overflow, { winsor: 0.02 }).every((v) => v === 0),
     "and an unusable scale is the neutral vote for everyone, never Infinity and never NaN");
  agree([-1e308, -1e308, 1e308], { winsor: 0.02 }, "only the upper bound overflows");
  agree([-1e308, 1e308, 1e308], { winsor: 0.02 }, "only the lower bound overflows");

  /* THE COLUMN THAT CAUGHT THE FUSED FORM PUBLISHING HALF THE RIGHT ANSWER.
     Everything above overflows a winsor BOUND, which makes the clip refuse and
     lands both paths on the neutral vote — agreement by collapse. This column
     overflows nothing at the bound and one DEVIATION underneath it: the median
     is -1.7e308, the deviations are [9.7e306, 0, Infinity], and mad() hands
     them to median(), which opens with finite(). The composed form therefore
     takes the median of the two SURVIVORS (4.85e306) while a fused form that
     kept the Infinity takes the middle of three (9.7e306) — exactly double the
     scale, so exactly half the z, -0.674 against -1.349. Not an ulp, not the
     sign of a zero: the published number, halved.

     Every fixture above passed against that version. It was found by a
     differential search over extreme magnitudes, not by reading the code, and
     it is here so the next reader who is sure that "a median only sees the
     multiset" remembers that median() also decides what the multiset IS. */
  const madOverflow = [-1.797e308, -1.7e308, 1e307];
  agree(madOverflow, { winsor: 0.02 }, "a finite winsor bound over an OVERFLOWING MAD deviation");
  {
    /* PROVE THE FIXTURE REACHES THE BRANCH IT CERTIFIES rather than trusting
       the arithmetic above — a fixture that cannot reach its branch is this
       repo's most repeated mistake, and the four fixtures above are exactly
       that mistake for this defect. Three claims, each independently checkable:
       the clip really happens (both bounds finite), a deviation really
       overflows, and dropping it really changes the median. */
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

  /* EVERY DEVIATION OVERFLOWS, which is the `dn === 0` arm of the filter above
     and the only way the survivor count reaches zero. Two entries of 1.7e308:
     the winsor bounds are finite so the clip happens, but the even-length
     median sums the pair before halving it, so the CENTRE is Infinity and every
     |x - centre| overflows with it. median([]) is NaN in the composed form and
     mad() multiplies it into a NaN scale; the fused form must reach the same
     NaN from an empty survivor set. Both then fall to the mean/stdev branch,
     which also overflows, and both return the neutral vote.

     HONEST ABOUT WHAT THIS FIXTURE CAN AND CANNOT DO: it proves the STATE is
     reachable, not that the explicit `dn === 0` arm is load-bearing. Deleting
     that arm was mutated and the suite stayed green, because an out-of-range
     read on a typed array is undefined and `(undefined + undefined) / 2` is
     NaN already. Recorded here so the next reader does not go looking for the
     assertion that kills it — there is not one, and the implementation says so
     in the same words. */
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

  /* THE NON-FINITE-BOUND GUARD IS BEHAVIOURAL, and this is the column that
     says so. An earlier comment in both files claimed the guard was mere
     symmetry with winsorize — that a bound can only overflow on a column which
     also overflows the MAD and the stdev, so both paths return the neutral
     vote either way. The three fixtures above were offered as evidence and
     cannot see it: on each of them the finite bound sits at or below the
     smallest entry, so clipping and not clipping are the same operation.

     Here the LOWER bound is finite and strictly above the smallest entry while
     the UPPER one overflows. winsorize refuses the whole clip when either
     bound is non-finite, so the bottom name keeps its raw value; a version
     that clipped anyway would raise it to the finite floor and score it
     differently. Replacing the guard with `true` diverges on 92 of 7,228
     columns measured, and on this one. */
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

  /* ONE THING THIS SUITE DELIBERATELY DOES NOT ASSERT, and one that used to be
     on this list and should never have been.

     STILL NOT ASSERTED, because it is genuinely unobservable: reading the MAD's
     deviations out of the sorted buffer instead of the original-order one. A
     median only ever sees the multiset, and the finiteness filter is per
     element, so no fixture can distinguish the two. Measured rather than
     reasoned this time: that mutant agrees with the composed form on all 7,228
     extreme-magnitude columns of the search that produced the two fixtures
     above. No fixture here pretends to cover it.

     REMOVED FROM THIS LIST, because it was false: "dropping the non-finite
     bound guard is equivalent too". The argument was that a bound can only
     overflow on a column that also overflows the MAD and the stdev, so both
     paths return the neutral vote either way. A bound overflows when two
     ADJACENT sorted entries are more than MAX_VALUE apart, which constrains
     nothing about the other end of the column — and the guardCol fixture above
     is a column with a finite lower bound, an overflowing upper one, and a
     bottom entry that a guard-less clip would move. 92 of those 7,228 columns
     diverge. The claim was believed because the three overflow fixtures agreed
     under the mutant, and they agreed because on every one of them the finite
     bound sits at or below the smallest entry, so clipping is a no-op. A
     fixture that agrees under a mutant is not evidence of equivalence; it is a
     fixture that cannot see the branch.

     The same mistake, made with the same words ("a median only sees the
     multiset"), is what let the MAD's missing finiteness filter ship. Both are
     now assertions rather than paragraphs. Four other mutations of this kind —
     skipping the clip before the quantiles, taking the median through the
     quantile formula, folding the fallback's sum over the sorted copy, and
     dropping the deviation filter — are NOT equivalent, and the fixtures above
     kill all four. */

  /* AND A DIFFERENTIAL FUZZ, so the agreement is a property rather than a list
     of cases someone thought of. Deterministic seed: a failure is reproducible. */
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
      else if (r < 0.30) col.push(Math.round((rnd() - 0.5) * 4));       // ties, on purpose
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

  /* THE SORT CENSUS. The whole reason this function exists is the sort count,
     so assert it rather than trusting the comment: eight for the composed form,
     two for the fused one. If a future edit reintroduces a sort, this fails. */
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

/* ---------- rank hysteresis ------------------------------------- */
{
  const today = Array.from({ length: 60 }, (_, i) => "T" + (i + 1));

  /* THE SESSION'S BEST NAMES ARE ALWAYS ON THE BOARD. Two wrong versions came
     before this one. The first placed incumbents LAST, which made hysteresis a
     provable no-op — identical to slice(0, entryRank) for every input. Placing
     them first fixed that and overcorrected: incumbency came to beat rank
     absolutely, so with 25 incumbents at ranks 5..29 the board was exactly
     those 25 and the four strongest names in the session were not on it. */
  const slipped = applyHysteresis(today, today.slice(4, 29), { entryRank: 25, exitRank: 35 }).ids;
  for (const t of ["T1", "T2", "T3", "T4"]) {
    ok(slipped.includes(t), `${t} is one of the session's best and is on the board`);
  }
  ok(slipped.includes("T26") && slipped.includes("T29"),
     "and an incumbent that slipped past entryRank but is inside the exit band is held");
  ok(slipped.length > 25 && slipped.length <= 35,
     `the board grows rather than dropping the best (got ${slipped.length})`);

  // With no incumbents it is exactly today's top entryRank.
  const fresh = applyHysteresis(today, [], { entryRank: 25, exitRank: 35 }).ids;
  eq(fresh.length, 25, "no incumbents means exactly the top entryRank");
  eq(fresh[0], "T1", "ordered by today's rank");
  eq(fresh[24], "T25", "and cut at entryRank");

  // An incumbent past the exit band goes, which is the whole point of exitRank.
  const dropped = applyHysteresis(today, ["T36", "T50"], { entryRank: 25, exitRank: 35 }).ids;
  ok(!dropped.includes("T36") && !dropped.includes("T50"),
     "an incumbent beyond exitRank is not held");
  eq(dropped.length, 25, "so the board does not grow for it");

  // The board is always ordered by TODAY's rank, never by incumbency.
  const mixed = applyHysteresis(today, today.slice(25, 34), { entryRank: 25, exitRank: 35 }).ids;
  const positions = mixed.map((t) => today.indexOf(t));
  ok(positions.every((v, i) => i === 0 || v > positions[i - 1]),
     "the emitted board is in today's rank order");
  ok(new Set(mixed).size === mixed.length, "and holds no duplicates");

  // Degenerate inputs must not throw or invent names.
  eq(applyHysteresis([], ["T1"]).ids.length, 0, "an empty session yields an empty board");
  eq(applyHysteresis(null, null).ids.length, 0, "and null inputs are safe");
  const short = applyHysteresis(today.slice(0, 8), today.slice(0, 8), { entryRank: 25, exitRank: 35 }).ids;
  eq(short.length, 8, "a pool shorter than entryRank is kept whole, not padded");
}

/* ---------- the board's memory ----------------------------------
   applyHysteresis already knew which names were new, which returned, and
   which were here only on incumbency. It returned a flat list of tickers, so
   a board that had just decided all three published a page on which nothing
   was new. These are those three facts, and the fourth that keeps them
   honest: a cold memory is not a memory full of arrivals. */
{
  const today = Array.from({ length: 60 }, (_, i) => "T" + (i + 1));

  /* Yesterday held T5..T29. So T1..T4 are new by rank, T5..T25 return by
     rank, and T26..T29 are here ONLY because they were here yesterday. */
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

  /* THE COLD MEMORY. This is the case that makes the difference between a
     useful flag and a daily lie: the store read is non-fatal by design, so a
     week of failed reads would otherwise publish "everything is new" every
     morning and a reader would learn to ignore the flag entirely. */
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

  /* Order is the board's order in all three, so a renderer can zip them. */
  const order = new Map(m.ids.map((t, i) => [t, i]));
  for (const list of [m.entered, m.returning, m.held]) {
    ok(list.every((t, i) => i === 0 || order.get(t) > order.get(list[i - 1])),
       "every subset comes back in the board's own rank order");
  }
}

/* ---------- asset-version pinning -------------------------------
   shared/flows-pages.js emits its own <link>/<script> tags, so it is
   invisible to the HTML sweep in contracts.mjs. Pin it here instead,
   or a version bump silently leaves the gated pages on stale CSS. */
{
  const { readFileSync, existsSync } = await import("node:fs");
  const PAGES = await import("../shared/flows-pages.js");
  const { ASSET_VERSION } = PAGES;
  const onDisk = readFileSync(new URL("../assets/version.txt", import.meta.url), "utf8").trim();
  ok(ASSET_VERSION === onDisk,
     `flows-pages ASSET_VERSION (${ASSET_VERSION}) matches assets/version.txt (${onDisk})`);

  /* Every file shared/flows-pages.js emits a <script> or <link> tag for. A
     page that references an asset the bundle does not carry is a 404 the
     reader sees as a page that half works — and flows-panels.js in particular
     is a load-bearing dependency of two controllers, both of which fail
     closed with a console error rather than a visible one.

     FOUND RATHER THAN LISTED, and the previous version of this block is why.
     It carried that same sentence — "every file shared/flows-pages.js emits a
     tag for" — above a hand-written array of SEVEN paths, while the module
     emitted fourteen. flows-ui.js, flows-overview.js, flows-desk.js,
     flows-watch.js, flows-market.js, flows-track.js, flows-history.js,
     flows-political.js and nav.js were all outside it. The array was true when
     written and the comment stayed true-sounding afterwards, which is the
     failure this repository keeps paying for: a stale enumeration under a
     sentence claiming completeness is worse than no check, because it is the
     thing the next person reads INSTEAD of looking.

     So the list is derived from the HTML each page function actually emits.
     Adding a route, or a tag to a route, extends the coverage by itself. */
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

/* ---------- the two boards must be disjoint ---------------------
   Taking the top N and the bottom N of one sorted list looks equivalent
   to partitioning and is not. Once the pool falls below 2*boardSize the
   slices overlap and a name lands on BOTH boards — presented as
   simultaneously a top long and a top short candidate.

   This is reachable in normal operation: the pipeline enriches 30 per
   side (pool 60) and its completeness gate passes at 80%, i.e. 48
   survivors, which overlaps by 2. */
{
  const { partitionSides } = await import("../scripts/flows-pipeline.mjs");

  for (const n of [60, 50, 48, 40, 20, 3, 1, 0]) {
    const scored = Array.from({ length: n }, (_, i) => ({ ticker: "T" + i, score: 100 - i * 4 }));
    const { long, short } = partitionSides(scored);
    const overlap = long.filter((r) => short.some((s) => s.ticker === r.ticker));
    ok(overlap.length === 0, `pool of ${n} yields disjoint boards (overlap ${overlap.length})`);
    ok(long.length + short.length <= n, `pool of ${n} is not double-counted`);
  }

  /* The liquidity floor. It is declared in the pipeline's UNIVERSE block and
     was, for a while, declared and never applied — the screener returns
     options volume only and never absolute stock volume, so it cannot be
     enforced at universe-construction time. It is enforced after enrichment
     instead, from the ohlc candles fetched anyway for ATR. */
  {
    const { medianDollarVolume } = await import("../scripts/flows-pipeline.mjs");

    near(medianDollarVolume([{ close: "10", volume: 100 }]), 1000, 1e-9,
         "a single candle yields its own dollar volume");
    near(medianDollarVolume([
      { close: "10", volume: 100 }, { close: "10", volume: 300 },
    ]), 2000, 1e-9, "an even count averages the middle pair");

    // Median, not mean: one earnings-day spike must not lift an illiquid name.
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

  /* THE DEAD BAND. A median split made the board's length a constant and its
     contents a formality: rank 18 of 34 was published as a short candidate at
     a score of -2, while its own share class sat fourth on the long board. */
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

/* ---------- the gamma flip, on the failures that shipped -------- */
{
  /* 1. A DEAD TAIL IS NOT A LEVEL. The band floor sits ~30% below spot; rungs
     down there carry no aggressor volume, so the cumulative opens at exactly
     zero and the old `if (a.cum === 0) return a.strike` short-circuit
     published the bottom of the band as a measured gamma flip. Twelve of
     thirty-four live names sat within 4% of that floor. */
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

  // 2. AN ALL-ZERO LADDER HAS NO FLIP, and must not invent one.
  ok(aggressorGamma([zeroRung(10), zeroRung(20), zeroRung(30)], { spot: 20 }).flip === null,
     "a book with no measured gamma has no flip");

  /* 3. THE NEAREST CROSSING, not the first from the bottom. |cum| starts near
     zero and ends at |netGamma|, so scanning up and returning the first
     crossing is biased toward the bottom of the ladder by construction. */
  const twoCrossings = aggressorGamma([
    rung(50, -1e7), rung(60, 2e7), rung(70, -2e7), rung(80, -1e6),
    rung(90, 3e7), rung(100, 1e6), rung(110, 1e6),
  ], { spot: 88 });
  ok(twoCrossings.crossings.length >= 2, "every crossing is collected, not just the first");
  const nearest = twoCrossings.crossings.reduce(
    (a, b) => (Math.abs(b.strike - 88) < Math.abs(a.strike - 88) ? b : a));
  ok(twoCrossings.flip === nearest.strike, "the published flip is the crossing nearest spot");

  /* 4. MATERIALITY IS ASSERTED EITHER SIDE, not on the two adjacent rungs. A
     clean crossing passes through zero, so its immediate shoulders are SMALL
     by definition — testing them would reject exactly the good crossings. */
  const clean = [];
  let cum = 0;
  for (let k = 70; k <= 130; k++) { cum += (k - 95) * 1e5; clean.push({ strike: k, cum }); }
  const found = gammaCrossings(clean, { materiality: 0.1 });
  ok(found.length >= 1, "a textbook single-crossing book yields its crossing");

  // 5. THE SIDE IS DATA, not a hardcoded sentence.
  ok(deadTail.flipSide === "short_below",
     `a book short below and long above reports short_below (got ${deadTail.flipSide})`);
  const inverted = aggressorGamma([
    rung(50, 1e7), rung(60, 1e6), rung(70, -3e7), rung(80, -1e6), rung(90, -1e6),
  ], { spot: 75 });
  ok(inverted.flipSide === "long_below",
     `a book LONG below and short above reports long_below (got ${inverted.flipSide})`);

  /* 6. THE WOBBLE. A sign change inside a near-zero region between two large
     books passes any test built on running maxima over "everything below" and
     "everything above" — those windows are global, so every crossing in one
     book scores identically. With spot sitting inside the wobble, the published
     flip was the wobble and the regime sentence came out backwards, because the
     wobble's sides are the opposite way round from the book's.

     A crossing is the boundary between two RUNS of constant sign, and its
     strength is the thinner of the two runs it divides. That is a local
     quantity with a different answer per crossing. */
  const fromCum = (pairs) => {
    let prev = 0;
    return pairs.map(([k, cumM]) => {
      const cum = cumM * 1e6, g = cum - prev;
      prev = cum;
      return { strike: String(k), call_gamma_ask: String(g), call_gamma_bid: "0",
               put_gamma_ask: "0", put_gamma_bid: "0" };
    });
  };
  // -100, -60, -2, +1, -2, -50, +100, +120 : a +1M blip between two big books.
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

  /* 7. THE STRENGTH IS REPORTED, NOT THRESHOLDED. A crossing whose thinner side
     carries 5% of the book is a real boundary and a weak one; a binary gate
     would either hide it or dress it up. */
  const weak = aggressorGamma(fromCum([[90, 1], [95, 3], [100, -40], [110, -60]]), { spot: 97 });
  ok(weak.flip !== null, "a thin-but-real long side still publishes a flip");
  ok(weak.flipSeparation < 0.15,
     `and reports how thin it is (got ${(weak.flipSeparation * 100).toFixed(1)}%)`);
  const strong = aggressorGamma(fromCum([[90, 50], [95, 60], [100, -40], [110, -60]]), { spot: 97 });
  ok(strong.flipSeparation > weak.flipSeparation,
     "a boundary with real book on both sides reports a larger separation");

  // 8. A cumulative that touches zero and returns to its own sign is NOT a
  //    crossing. `(a.cum < 0) !== (b.cum < 0)` called zero positive and emitted
  //    two crossings at one strike, with opposite sides.
  const zeroTouch = aggressorGamma(fromCum([[100, -5], [110, 0], [120, -5]]), { spot: 110 });
  eq(zeroTouch.crossings.length, 0, "a zero touch without a sign change is not a crossing");
  eq(zeroTouch.flip, null, "and publishes no flip");

  /* 9. A ROW WITH NO MEASURED LEGS IS NOT A MEASURED ZERO. num() defaults to 0,
     so a strike carrying none of the four aggressor fields entered the ladder
     as a rung of exactly zero — while the card's buildGammaProfile dropped it,
     so one card carried two different bands. */
  const withEmpty = aggressorGamma(
    [{ strike: "80" }, { strike: "85" }, ...fromCum([[100, -5], [110, 5], [120, 6]])],
    { spot: 110 });
  eq(withEmpty.bandMin, 100, "a strike with no measured exposure is dropped, not banded in");
  eq(withEmpty.bandMax, 120, "and the top of the band is unaffected");

  // 6. Dealer gamma AT SPOT, unit-free and comparable across names.
  ok(deadTail.spotGammaShare < 0, "spot above a short_below flip is still short gamma here");
  ok(Math.abs(deadTail.spotGammaShare) <= 1, "spotGammaShare is bounded by construction");
  ok(aggressorGamma([], { spot: 100 }).spotGammaShare === null, "no ladder means no reading");

  /* NULL, NEVER AN EDGE VALUE, outside the measured band. Clamping to the edge
     rung returned a confident +-1 for a stock trading nowhere near the strikes
     on file — and the SIGN of that number is what the card prints as its
     "short Γ" / "long Γ" badge and what the quality gate reads as its
     amplification axis. */
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

/* ---------- weighting refuses to pay for dead columns ----------- */
{
  ok(isLiveColumn([1, 2, 3]), "a varying column is live");
  ok(!isLiveColumn([0, 0, 0, 0]), "an all-zero column is dead");
  ok(!isLiveColumn([7, 7, 7]), "a constant column is dead");
  ok(!isLiveColumn([5]), "a single value cannot have dispersion");

  /* The live board awarded family V — identically zero on all 34 names — the
     same unit of weight as a live family, because effectiveBreadth returned
     `n` without ever looking at a value. Two dead columns were worse: pearson
     returns NaN on zero variance, so rhoBar fell to 0 and the family drew its
     FULL raw count as if perfectly independent. */
  ok(effectiveBreadth([[0, 0, 0, 0]]) === 0, "one dead column earns no weight");
  ok(effectiveBreadth([[0, 0, 0, 0], [0, 0, 0, 0]]) === 0, "two dead columns earn no weight");
  ok(effectiveBreadth([[1, 2, 3, 4]]) === 1, "one live column earns one unit");
  ok(effectiveBreadth([[1, 2, 3, 4], [0, 0, 0, 0]]) === 1,
     "a dead column beside a live one adds nothing");

  const dup = [1, 2, 3, 4, 5];
  near(effectiveBreadth([dup, dup.slice()]), 1, 1e-6, "two identical columns are one signal");
  ok(effectiveBreadth([[1, 2, 3, 4, 5], [5, 1, 4, 2, 3]]) > 1.2,
     "two unrelated columns are more than one signal");

  /* BETWEEN families, which effectiveBreadth was structurally blind to: it was
     only ever called with one family's own columns. */
  const a = [1, 2, 3, 4, 5, 6];
  const red = crossFamilyRedundancy({ A: a, B: a.slice(), C: [3, 1, 4, 1, 5, 9] });
  ok(red.A > 1 && red.B > 1, "a family restated by another is discounted");
  ok(red.A > red.C, "the redundant pair is discounted harder than the independent one");
  const solo = crossFamilyRedundancy({ A: a });
  ok(solo.A === 1, "a lone family has nothing to be redundant with");
}

/* ---------- percentiles and the multiplicative gate ------------- */
{
  const pr = percentileRank([10, 20, 30, 40]);
  ok(pr.every((p) => p > 0 && p < 1), "percentiles live strictly inside (0,1)");
  ok(pr[0] < pr[3], "percentiles are monotone in the value");
  near(pr.reduce((x, y) => x + y, 0) / pr.length, 0.5, 1e-9, "their mean is one half by construction");

  const tied = percentileRank([5, 5, 5, 5]);
  ok(tied.every((p) => Math.abs(p - tied[0]) < 1e-12), "ties share one averaged rank");
  ok(percentileRank([1, NaN, 3])[1] === null, "an unmeasured entry casts no vote");

  /* THE GATE. Modifiers multiply, because adding an unsigned magnitude to a
     signed sum turns "this name's flow is clean" into "this name is bullish".
     The previous fix signed each magnitude by sign(dirDelta) and kept it
     additive, which reintroduced the inversion one level down: three of ten
     scoring columns became restatements of sign(dirDelta), carried the
     NEGATIVE sign and a quarter of the weight, and the composite came out
     with corr(blend, dirDelta) = -0.07. */
  const g = qualityGate([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]]);
  near(g.reduce((x, y) => x + y, 0) / g.length, 1, 1e-9, "the gate has a cross-sectional mean of one");
  ok(g.every((v) => v > 0 && v <= 2), "the gate is bounded in (0,2]");
  ok(g.every((v) => Math.abs(v - 1) < 1e-9), "two exactly opposed axes cancel to a neutral gate");

  const oneAxis = qualityGate([[1, 2, 3, 4, 5]]);
  ok(oneAxis[4] > oneAxis[0], "a better name gets a larger multiplier");
  ok(oneAxis.every((v) => v > 0), "no name is ever gated to zero");

  // A near-constant modifier must do almost nothing — the whole point.
  const flat = qualityGate([[1, 1, 1, 1, 1]]);
  ok(flat.every((v) => v === 1), "a modifier with no dispersion changes nothing");

  /* AND WHEN EVERY AXIS IS DEAD, the gate must still have ONE ENTRY PER NAME.
     Deriving the length from the surviving columns returned [] in that case, so
     the caller's `blended.map((b, i) => b * gate[i])` multiplied by undefined
     and every composite on the board became NaN. boundedScore turns each NaN
     into 0, so the symptom is not a visible NaN: it is a board where every
     score is zero, every name falls inside the dead band, and the run publishes
     nothing. Reachable — gammaFrontLoad was null on all 34 live names once. */
  const allDead = qualityGate([[null, null, null, null, null], [7, 7, 7, 7, 7]]);
  ok(allDead.length === 5, `a dead gate still has one entry per name (got ${allDead.length})`);
  ok(allDead.every((v) => v === 1), "and every entry is neutral, so the composite passes through");
  const blendedDark = [0.5, -0.3, 1.2, -0.9, 0.1];
  ok(blendedDark.map((b, i) => b * allDead[i]).every(Number.isFinite),
     "so no composite becomes NaN when the quality axes go dark");
  ok(qualityGate([]).length === 0, "no axes at all is still an empty cross-section");
  ok(qualityGate([[], []]).length === 0, "and so are empty columns");

  // And a gate can never flip a sign, which the additive form could.
  const signal = [-3, -1, 1, 3, 5];
  const gated = signal.map((v, i) => v * oneAxis[i]);
  ok(gated.every((v, i) => Math.sign(v) === Math.sign(signal[i])),
     "the gate scales conviction and never reverses it");
}

/* ---------- realized vol, the VRP denominator ------------------- */
{
  const flat = realizedVol(new Array(40).fill(100));
  near(flat, 0, 1e-9, "a flat series has no realized vol");

  // A deterministic +-1% alternation: |log return| = log(1.01) each step, so
  // the annualized figure is recoverable in closed form.
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

/* ---------- the six legs one vendor call already pays for ----------

   /greek-exposure/expiry returns call/put legs for gex, delta, charm AND
   vanna. This product read the gamma pair and dropped the other six, once per
   name, every run. The directive names Vanna and Charm explicitly.

   THE FIXTURE IS THE VENDOR'S OWN EXAMPLE, copied from the "Greek Exposure By
   Expiry" schema block in docs/uw-openapi.yaml — the same block that says
   `call_gex`, the wire name a different part of that document got wrong and
   which cost this product every gamma roll-off panel for weeks. Using their
   numbers rather than invented ones is what makes the sign assertion below a
   statement about the vendor rather than about this fixture. */
{
  const VENDOR = [
    { expiry: "2022-05-25", dte: 5,
      call_gex: "9356683.4241",   put_gex: "-12337386.0524",
      call_delta: "227549667.4651", put_delta: "-191893077.7193",
      call_charm: "102382359.5786", put_charm: "-943028472.4815",
      call_vanna: "152099632406.9564", put_vanna: "488921784213.1121" },
    { expiry: "2022-06-17", dte: 28,
      call_gex: "8456599.8505",   put_gex: "-12703877.0243",
      call_charm: "81465130.0002", put_charm: "-1054548432.6111",
      call_vanna: "161231587973.6811", put_vanna: "488921784213.1121" },
  ];

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
    { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg, asOf: "2022-05-20" });
  const charm = greekTermStructure(VENDOR,
    { name: "charm", callLeg: callCharmLeg, putLeg: putCharmLeg, asOf: "2022-05-20" });

  eq(vanna.status, "ok", "the vanna term structure builds");
  eq(vanna.rows.length, 2, "one row per expiry");
  eq(vanna.rows[0].expiry, "2022-05-25", "sorted onto the calendar");
  eq(vanna.rows[0].dte, 5, "carrying the vendor's own dte where it sent one");

  /* THE SIGN TRAP, ASSERTED AS A FACT ABOUT THE WIRE. */
  ok(charm.rows[0].call > 0 && charm.rows[0].put < 0,
    "charm arrives DEALER-SIGNED: the put leg is negative against a positive call leg");
  ok(vanna.rows[0].call > 0 && vanna.rows[0].put > 0,
    "VANNA DOES NOT. Both vanna legs are positive in the vendor's own example, " +
    "so the convention that holds for gamma and charm is false for vanna — a " +
    "reader that netted call+put under one rule would report the wrong " +
    "magnitude, and on a put-heavy name the wrong DIRECTION");
  ok(/never netted/.test(vanna.signConvention) && /differs BY GREEK/.test(vanna.signConvention),
    "so the convention rides on the payload as a field rather than living in a " +
    "comment the renderer never reads");
  eq(vanna.rows[0].call + vanna.rows[0].put > 0, true,
    "and the legs stay separate: nothing here produced a net");

  /* Units travel, because three of these are dollar quantities differing only
     by what they are PER. */
  ok(/VOL POINT/.test(vanna.unit), "the vanna unit names what it is per");
  ok(/per DAY/.test(charm.unit), "and the charm unit names a different one");
  ok(vanna.unit !== charm.unit && vanna.unit === GREEK_UNITS.vanna,
    "read without their units these are interchangeable large numbers, which " +
    "is exactly how '1352% of its year' happened");

  /* The three silences, at the one point they are still distinguishable. */
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

  /* THE CONFIDENT ZERO THIS FUNCTION SHIPPED WITH, AND THE FIXTURE THAT
     CAUGHT IT. The first draft read each leg through num(), whose contract is
     a number — so an expiry the vendor sent no vanna for came back as
     `call: 0, put: 0, dte: 0`, telling a reader the book measured empty at
     that expiry when the vendor had simply said nothing. In the one function
     written to abolish exactly that. These four assertions are why the
     dry-run fixture now carries a deliberately half-present expiry. */
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

console.log(`✓ flows-features: ${checks} assertions — robust stats, a fixed score unit, materiality-gated gamma flips, multiplicative quality gating, dead-column weighting, realized vol, reachable conviction, and the four second-order exposure legs one vendor call already pays for — with the put-leg sign convention that differs by Greek asserted from the vendor's own example, and the fused hot path proven ELEMENTWISE IDENTICAL to the eight-sort form it replaces across every degenerate column that reaches a different branch`);
