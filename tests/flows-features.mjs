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
  pathSignature, gammaDecayCalendar, positioningQuality,
  effectiveBreadth, pearson, calibrateScoreScale, boundedScore,
  conviction, applyHysteresis, gammaCrossings, isLiveColumn,
  crossFamilyRedundancy, qualityGate, percentileRank, realizedVol,
  SCORE_SCALE,
} from "../shared/flows-features.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
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

/* ---------- rank hysteresis ------------------------------------- */
{
  const today = Array.from({ length: 60 }, (_, i) => "T" + (i + 1));

  /* THE SESSION'S BEST NAMES ARE ALWAYS ON THE BOARD. Two wrong versions came
     before this one. The first placed incumbents LAST, which made hysteresis a
     provable no-op — identical to slice(0, entryRank) for every input. Placing
     them first fixed that and overcorrected: incumbency came to beat rank
     absolutely, so with 25 incumbents at ranks 5..29 the board was exactly
     those 25 and the four strongest names in the session were not on it. */
  const slipped = applyHysteresis(today, today.slice(4, 29), { entryRank: 25, exitRank: 35 });
  for (const t of ["T1", "T2", "T3", "T4"]) {
    ok(slipped.includes(t), `${t} is one of the session's best and is on the board`);
  }
  ok(slipped.includes("T26") && slipped.includes("T29"),
     "and an incumbent that slipped past entryRank but is inside the exit band is held");
  ok(slipped.length > 25 && slipped.length <= 35,
     `the board grows rather than dropping the best (got ${slipped.length})`);

  // With no incumbents it is exactly today's top entryRank.
  const fresh = applyHysteresis(today, [], { entryRank: 25, exitRank: 35 });
  eq(fresh.length, 25, "no incumbents means exactly the top entryRank");
  eq(fresh[0], "T1", "ordered by today's rank");
  eq(fresh[24], "T25", "and cut at entryRank");

  // An incumbent past the exit band goes, which is the whole point of exitRank.
  const dropped = applyHysteresis(today, ["T36", "T50"], { entryRank: 25, exitRank: 35 });
  ok(!dropped.includes("T36") && !dropped.includes("T50"),
     "an incumbent beyond exitRank is not held");
  eq(dropped.length, 25, "so the board does not grow for it");

  // The board is always ordered by TODAY's rank, never by incumbency.
  const mixed = applyHysteresis(today, today.slice(25, 34), { entryRank: 25, exitRank: 35 });
  const positions = mixed.map((t) => today.indexOf(t));
  ok(positions.every((v, i) => i === 0 || v > positions[i - 1]),
     "the emitted board is in today's rank order");
  ok(new Set(mixed).size === mixed.length, "and holds no duplicates");

  // Degenerate inputs must not throw or invent names.
  eq(applyHysteresis([], ["T1"]).length, 0, "an empty session yields an empty board");
  eq(applyHysteresis(null, null).length, 0, "and null inputs are safe");
  const short = applyHysteresis(today.slice(0, 8), today.slice(0, 8), { entryRank: 25, exitRank: 35 });
  eq(short.length, 8, "a pool shorter than entryRank is kept whole, not padded");
}

/* ---------- asset-version pinning -------------------------------
   shared/flows-pages.js emits its own <link>/<script> tags, so it is
   invisible to the HTML sweep in contracts.mjs. Pin it here instead,
   or a version bump silently leaves the gated pages on stale CSS. */
{
  const { readFileSync, existsSync } = await import("node:fs");
  const { ASSET_VERSION } = await import("../shared/flows-pages.js");
  const onDisk = readFileSync(new URL("../assets/version.txt", import.meta.url), "utf8").trim();
  ok(ASSET_VERSION === onDisk,
     `flows-pages ASSET_VERSION (${ASSET_VERSION}) matches assets/version.txt (${onDisk})`);

  for (const asset of ["../assets/css/flows.css", "../assets/js/flows-board.js"]) {
    ok(existsSync(new URL(asset, import.meta.url)), `${asset} exists`);
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

console.log(`✓ flows-features: ${checks} assertions — robust stats, a fixed score unit, materiality-gated gamma flips, multiplicative quality gating, dead-column weighting, realized vol, reachable conviction`);
