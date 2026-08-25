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
  conviction, applyHysteresis,
} from "../shared/flows-features.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
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

  // Directional flow that cancels across the session is NOT conviction.
  const cancelling = flowPurity([
    { dir_delta_flow: "1000", total_delta_flow: "1000" },
    { dir_delta_flow: "-1000", total_delta_flow: "1000" },
  ]);
  near(cancelling.purity, 0, 1e-9, "flow that reverses within the day nets to no conviction");

  ok(flowPurity([]).purity === 0, "empty flow is safe");
  ok(flowPurity([{ dir_delta_flow: "5", total_delta_flow: "1" }]).purity <= 1, "purity is bounded at 1");
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
  ok(Number.isFinite(none.otmShare) && none.otmShare === 0, "zero delta flow yields no OTM share, not NaN");
  ok(Number.isFinite(none.vegaTilt) && none.vegaTilt === 0, "zero delta flow yields no vega tilt, not Infinity");
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

  // The failure this replaces: a compressed cross-section must STILL
  // fill the range, because the scale adapts to the day's dispersion.
  const quiet = zs.map((z) => z * 0.05);
  const quietScale = calibrateScoreScale(quiet, { refQuantile: 0.95, refScore: 80 });
  const quietScores = quiet.map((z) => boundedScore(z, quietScale));
  ok(Math.max(...quietScores) >= 80, "a quiet session still reaches the top band");
  ok(Math.abs(Math.max(...quietScores) - Math.max(...scored)) <= 3, "calibration is dispersion-invariant");

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
  ok(conviction({ familyScores: [0, 0] }).conviction === 0, "all-zero families mean no conviction");

  // Every input in range must produce an in-range output.
  for (const cov of [0, 0.5, 1]) for (const per of [0, 0.5, 1]) {
    const c = conviction({ familyScores: [1, 1, -1], coverage: cov, persistence: per });
    ok(c.conviction >= 0 && c.conviction <= 100, "conviction stays within [0,100]");
  }
  // Out-of-range inputs are clamped rather than trusted.
  const wild = conviction({ familyScores: [1, 1], coverage: 99, persistence: -99 });
  ok(wild.conviction <= 100, "out-of-range coverage is clamped");
}

/* ---------- rank hysteresis ------------------------------------- */
{
  const today = Array.from({ length: 60 }, (_, i) => "T" + (i + 1));
  // T40 held yesterday sits at rank 40 today -> beyond the exit band, drops.
  const kept = applyHysteresis(today, ["T40"], { entryRank: 25, exitRank: 35 });
  ok(kept.length === 25, "the board stays at 25 names");
  ok(!kept.includes("T40"), "an incumbent past the exit band still drops");

  /* THE REGRESSION. This function was provably a no-op: it pushed every name
     ranked <= entryRank and broke the moment it had entryRank of them, which
     happens on the first entryRank iterations, so the incumbent branch beneath
     was unreachable. Verified exhaustively before the fix -- for every
     single-incumbent set over 60 names, and for "every name held", the output
     was byte-identical to slice(0, entryRank). The old test asserted only the
     board's LENGTH, which a no-op satisfies, so nothing caught it. */
  const ranking = [...Array.from({ length: 25 }, (_, i) => "N" + i), "A"];
  const withIncumbent = applyHysteresis(ranking, ["A"], { entryRank: 25, exitRank: 35 });
  ok(withIncumbent.length === 25, "buffer does not overfill the board");
  ok(withIncumbent.includes("A"),
     "THE MECHANISM: an incumbent at rank 26, inside the exit band, keeps its slot");
  ok(!withIncumbent.includes("N24"),
     "and displaces the newcomer that would otherwise have taken it");

  // It must not be a no-op for the plain case either.
  const plain = today.slice(0, 25);
  const held30 = applyHysteresis(today, ["T30"], { entryRank: 25, exitRank: 35 });
  ok(JSON.stringify(held30) !== JSON.stringify(plain),
     "holding a name inside the exit band changes the board (it is not slice(0,25))");
  ok(held30.includes("T30"), "the incumbent at rank 30 is retained");
  ok(held30.length === 25, "and the board is still 25 names");

  // Output is in rank order, not incumbents-first: the board displays a ranking.
  const order = held30.map((id) => today.indexOf(id));
  ok(order.every((v, i) => i === 0 || v > order[i - 1]), "the result stays in rank order");

  // With nothing held, it degrades to the plain top-N.
  ok(JSON.stringify(applyHysteresis(today, [], { entryRank: 25, exitRank: 35 })) === JSON.stringify(plain),
     "with no incumbents it is exactly the top 25");

  const none = applyHysteresis([], [], {});
  ok(none.length === 0, "an empty ranking is safe");
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

  const scored = Array.from({ length: 60 }, (_, i) => ({ ticker: "T" + i, score: 100 - i * 4 }));
  const { long, short } = partitionSides(scored);
  ok(long[0].score > long[long.length - 1].score, "the long side is ordered best-first");
  ok(short[0].score < short[short.length - 1].score, "the short side is ordered most-negative-first");
  ok(long[0].score === 100, "the long side starts at the highest score");
  ok(short[0].score === 100 - 59 * 4, "the short side starts at the lowest score");
}

console.log(`✓ flows-features: ${checks} assertions — robust stats, rank-normal transform, neutralization, dealer-gamma sign, path signature, dispersion-invariant calibration, reachable conviction`);
