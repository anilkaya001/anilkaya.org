/* =============================================================
   flows-features.js — feature engineering and calibration for the
   Flows options-flow board.

   Pure functions, no I/O, no dependencies. The same module runs in
   the GitHub Actions pipeline (which does all the real compute) and
   in Node under tests/flows-features.mjs. It never runs on the
   request path: the Worker streams a precomputed payload and does
   no arithmetic at all.

   Two conventions from the Unusual Whales schema are load-bearing
   and easy to get backwards. Both are asserted by the tests:

     1. put_gamma is reported ALREADY dealer-signed (negative against
        a positive call_gamma). Total exposure is a SUM, never the
        textbook difference. Subtracting double-negates and inverts
        every regime call.
     2. risk_reversal is IV(put) - IV(call). NEGATIVE is bullish,
        the opposite of the usual "call IV minus put IV" convention.

   Calibration note. An earlier draft of this system set conviction
   thresholds as absolute constants and they turned out to be
   unreachable — every name scored "no view" forever. Everything
   here is calibrated FROM the observed cross-section instead, so a
   band is reachable by construction rather than by luck.
   ============================================================= */

/* ---------- numeric hygiene ------------------------------------ */

/** UW returns numbers as JSON strings. Parse defensively; never NaN out. */
export function num(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string" || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const finite = (xs) => xs.filter((x) => Number.isFinite(x));

/* ---------- robust statistics ---------------------------------- */

export function median(values) {
  const xs = finite(values).slice().sort((a, b) => a - b);
  if (!xs.length) return NaN;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function quantile(values, p) {
  const xs = finite(values).slice().sort((a, b) => a - b);
  if (!xs.length) return NaN;
  if (xs.length === 1) return xs[0];
  const h = (xs.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return xs[lo] + (h - lo) * (xs[hi] - xs[lo]);
}

/**
 * Median absolute deviation, scaled to be a consistent estimator of
 * sigma for Gaussian data (1 / Phi^-1(0.75) = 1.4826).
 * Options data is fat-tailed enough that mean/stdev is dominated by
 * whichever name printed the largest sweep that session.
 */
export function mad(values, center) {
  const xs = finite(values);
  if (!xs.length) return NaN;
  const m = Number.isFinite(center) ? center : median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

/** Clip to the [p, 1-p] quantile band. Clips, never drops. */
export function winsorize(values, p = 0.01) {
  const lo = quantile(values, p);
  const hi = quantile(values, 1 - p);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return values.slice();
  return values.map((x) => (Number.isFinite(x) ? Math.min(Math.max(x, lo), hi) : x));
}

/**
 * Robust z via median/MAD. Falls back to a mean/stdev z when the MAD
 * collapses to zero — which happens whenever more than half the
 * cross-section shares one value (a sparse signal where most names
 * are legitimately 0). Without the fallback those signals silently
 * produce Infinity for the few names that do fire.
 */
export function robustZ(values, { clamp = 3 } = {}) {
  const xs = values.map((v) => (Number.isFinite(v) ? v : NaN));
  const ok = finite(xs);
  if (ok.length < 2) return xs.map(() => 0);

  const m = median(ok);
  /* TWO ROBUST SCALE ESTIMATORS, and the LARGER of them.
     
     The MAD collapses on a column that is BIMODAL BY SIGN — which is exactly
     what a signed-magnitude column is. Once more than half the names share one
     sign, median(|x - median|) is taken over a set whose own median sits inside
     the majority cluster, so the estimate measures the spread WITHIN that
     cluster and not the distance BETWEEN the two. Measured on a column of
     +-0.5 split 18/6: MAD = 0.0222 against a true spread near 1.0, so every
     minority name z-scored past the clamp and eleven of twenty-four names on
     the emitted board printed exactly 93 for family D.

     The interquartile range straddles both clusters and does not collapse.
     Both are consistent estimators of sigma for Gaussian data — MAD scaled by
     1.4826, the IQR by 1.349 — so on a well-behaved column they agree and the
     max changes nothing. On a bimodal one the IQR is the estimate that is
     still measuring the right thing. Taking the larger can only SHRINK a z,
     never inflate one, which is the conservative direction.

     The interquartile range straddles both clusters and does not collapse —
     until the minority falls below a quarter of the board, at which point the
     quartiles themselves sit inside the majority and it collapses too. An 80/20
     split still clamped every minority name. So a third, wider span is taken as
     well: the 10-to-90 range, which straddles any split down to a tenth. All
     three are consistent estimators of sigma for Gaussian data (MAD scaled by
     1.4826, the IQR by 1.349, the 10-90 range by 2.563), so on a well-behaved
     column they agree and the max changes nothing. The extreme tenth on each
     side is already handled by winsorize before this is called. */
  const span = (lo, hi, c) => {
    const v = (quantile(ok, hi) - quantile(ok, lo)) / c;
    return Number.isFinite(v) ? v : 0;
  };
  let scale = Math.max(mad(ok, m), span(0.25, 0.75, 1.349), span(0.10, 0.90, 2.563));

  if (!Number.isFinite(scale) || scale <= 1e-12) {
    const mean = ok.reduce((a, b) => a + b, 0) / ok.length;
    const varr = ok.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, ok.length - 1);
    scale = Math.sqrt(varr);
    if (!Number.isFinite(scale) || scale <= 1e-12) return xs.map(() => 0);
    return xs.map((x) => (Number.isFinite(x) ? clampTo((x - mean) / scale, clamp) : 0));
  }
  return xs.map((x) => (Number.isFinite(x) ? clampTo((x - m) / scale, clamp) : 0));
}

function clampTo(x, c) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(Math.max(x, -c), c);
}

/* ---------- rank → inverse normal ------------------------------ */

/**
 * Acklam's rational approximation of the standard normal quantile.
 * Absolute relative error < 1.15e-9 across (0,1).
 */
export function invNorm(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Van der Waerden transform: rank, then map to the normal quantile.
 * Makes heterogeneous families commensurable without assuming any of
 * them is remotely Gaussian. Ties take their average rank so that a
 * block of identical values cannot be ordered by array position.
 */
export function vanDerWaerden(values) {
  const n = values.length;
  if (!n) return [];
  const idx = values.map((v, i) => [Number.isFinite(v) ? v : NaN, i])
                    .filter(([v]) => Number.isFinite(v))
                    .sort((p, q) => p[0] - q[0]);
  const out = new Array(n).fill(0);
  const m = idx.length;
  if (m < 2) return out;

  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;            // 1-based, ties averaged
    const z = invNorm(avgRank / (m + 1));
    for (let k = i; k <= j; k++) out[idx[k][1]] = z;
    i = j + 1;
  }
  return out;
}

/* ---------- cross-sectional neutralization --------------------- */

/**
 * Residualize y against an intercept, a set of numeric controls, and
 * sector dummies, by ordinary least squares solved with Gaussian
 * elimination on the normal equations. Deliberately lowers raw IC:
 * it removes a genuine but untradeable sector-momentum effect so the
 * board ranks names against their own peer group rather than
 * rediscovering "semis were strong today" eleven times.
 *
 * Ridge term keeps a rank-deficient design (a sector with one member,
 * a constant control) from blowing up.
 */
export function neutralize(y, { numeric = [], groups = [], ridge = 1e-8, minGroup = 3 } = {}) {
  const n = y.length;
  if (!n) return [];

  const cols = [new Array(n).fill(1)];
  for (const c of numeric) {
    if (c.length !== n) throw new Error("neutralize: control length mismatch");
    cols.push(c.map((v) => (Number.isFinite(v) ? v : 0)));
  }
  if (groups.length === n) {
    /* Levels below minGroup members are pooled into the reference bucket
       rather than given their own dummy.

       Drop-first coding hands a single-member level an indicator that is
       nonzero for exactly one observation, and OLS then has a free coefficient
       affecting only that row -- so it drives that row's residual to zero and
       deletes the name's entire signal, whatever it was. The ridge does not
       restrain this: for a singleton column the XtX diagonal is 1, which is
       eight orders of magnitude above a 1e-8 ridge. Measured before the fix: a
       lone-sector name carrying the strongest raw signal on a 48-name board
       (y = 5.0 against everyone else inside [-1, 1]) came out with a residual
       of 5e-8 while the rest reached 0.85, and ranked 22nd of 48.

       Pooling is the conservative choice: a name in a thin sector is compared
       against the board's baseline instead of against itself. */
    const counts = new Map();
    for (const g of groups) {
      if (g == null || g === "") continue;
      counts.set(g, (counts.get(g) || 0) + 1);
    }
    const levels = [...counts.keys()].filter((lv) => counts.get(lv) >= minGroup).sort();
    // drop-first coding: the intercept absorbs the reference level
    for (const lv of levels.slice(1)) cols.push(groups.map((g) => (g === lv ? 1 : 0)));
  }

  const p = cols.length;
  const target = y.map((v) => (Number.isFinite(v) ? v : 0));
  if (p >= n) return target.slice();          // nothing left to estimate

  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += cols[a][i] * cols[b][i];
      XtX[a][b] = XtX[b][a] = s;
    }
    XtX[a][a] += ridge;
    let s = 0;
    for (let i = 0; i < n; i++) s += cols[a][i] * target[i];
    Xty[a] = s;
  }

  const beta = solveSymmetric(XtX, Xty);
  if (!beta) return target.slice();

  return target.map((v, i) => {
    let fit = 0;
    for (let a = 0; a < p; a++) fit += beta[a] * cols[a][i];
    return v - fit;
  });
}

function solveSymmetric(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/* =============================================================
   The six measures. Each takes raw UW response shapes and returns
   a plain number (or a small record), with no cross-sectional
   context — normalization happens later, over the whole universe.
   ============================================================= */

/**
 * Pi — Flow Purity.  |dir_delta_flow| / |total_delta_flow|
 *
 * The single hardest problem in options flow is that most large
 * prints are spreads, collars and delta-hedged packages wearing a
 * directional costume. The conventional fix clusters same-millisecond
 * prints and guesses at the structure. UW already separates the
 * directional component, so this measures what others estimate.
 *
 * 1 = clean directional conviction. 0 = the premium headline is hedging.
 */
export function flowPurity(greekFlowRows) {
  let dirNet = 0, dirAbs = 0, tot = 0;
  for (const r of greekFlowRows || []) {
    const d = num(r.dir_delta_flow);
    dirNet += d;
    dirAbs += Math.abs(d);
    tot += Math.abs(num(r.total_delta_flow));
  }
  if (tot <= 0) {
    return { purity: null, dirDelta: 0, dirAbs: 0, dirShare: null, totalAbs: 0 };
  }
  /* GROSS over GROSS. The old form was |SUM dir| / SUM |total|: a net divided
     by a gross, so two different cancellations fought each other and the
     result measured sign-persistence as much as directionality. On the live
     board that produced 0.003-0.008 on names whose flow was overwhelmingly
     directional — the numerator had cancelled, not the signal.

     |dir_delta_flow| <= |total_delta_flow| holds row by row, so SUM|dir| /
     SUM|total| is bounded in [0,1] BY CONSTRUCTION and Math.min is a guard
     against float error rather than the operative clamp. Sign-persistence is
     measured separately and honestly by pathSignature. */
  return {
    purity: Math.min(1, dirAbs / tot),
    dirDelta: dirNet,
    dirAbs,
    // Signed, unit-free directional share. This — not the raw dollar delta —
    // is what a cross-section can compare: the raw figure scales with the
    // name's size, so z-scoring it ranks market caps.
    dirShare: Math.max(-1, Math.min(1, dirNet / tot)),
    totalAbs: tot,
  };
}

/**
 * Gamma_a — Aggressor-Conditioned Dealer Gamma, per strike.
 *
 * Public GEX assumes a fixed customer posture (long calls, short puts)
 * and infers dealer positioning from open interest. The *_ask/*_bid
 * fields are dealer-signed AND split by who initiated, so this
 * measures the posture instead of assuming it.
 *
 * Returns the strike ladder with cumulative dealer gamma, plus the
 * interpolated zero crossing: a measured gamma flip.
 */
export function aggressorGamma(strikeRows, { spot = null, materiality = 0.02 } = {}) {
  const ladder = (strikeRows || [])
    .map((r) => {
      /* A ROW WITH NO MEASURED LEGS IS NOT A MEASURED ZERO. num() defaults to
         0, so a strike carrying none of the four aggressor fields used to enter
         the ladder as a rung of exactly zero gamma — and the card's
         buildGammaProfile, which applies this same present-legs test, dropped
         it. One card therefore carried two different bands: the chart's, and
         the sentence underneath it quoting the features'. */
      const legs = [r.call_gamma_ask, r.call_gamma_bid, r.put_gamma_ask, r.put_gamma_bid];
      const present = legs.some((v) => v !== null && v !== undefined && v !== "");
      return {
        strike: num(r.strike),
        gamma: present ? legs.reduce((a, v) => a + num(v), 0) : null,
      };
    })
    .filter((r) => Number.isFinite(r.strike) && r.strike > 0 && r.gamma !== null)
    .sort((a, b) => a.strike - b.strike);

  let cum = 0, peak = 0;
  for (const row of ladder) {
    cum += row.gamma;
    row.cum = cum;
    peak = Math.max(peak, Math.abs(cum));
  }

  const crossings = gammaCrossings(ladder, { materiality });
  const chosen = pickCrossing(crossings, spot);

  return {
    ladder,
    netGamma: cum,
    peak,
    crossings,
    flip: chosen ? chosen.strike : null,
    /* Which side of the flip the dealers are SHORT on, read from the DOMINANT
       BOOK below the crossing rather than from the sign of the one rung beside
       it. The card renders this as a statement about everything below the
       level — "dealers are short gamma below X" — and on the pipeline's own
       emitted ladders the adjacent rung disagreed with the book it stood in
       front of on two of the published crossings. */
    flipSide: chosen ? chosen.side : null,
    /* HOW MUCH BOOK THE CHOSEN CROSSING ACTUALLY SEPARATES, as a share of the
       ladder's peak |cumulative|. This is the number that says whether a flip
       is a regime boundary or a technicality: on the live INTC ladder the sign
       genuinely changes at 86.10, but the long-gamma side carries under 5% of
       the book, and a reader told only "the flip is 86.10" would size against a
       boundary that is barely there. Published so the card can qualify it. */
    flipSeparation: chosen ? chosen.separation : null,
    /* Dealer gamma AT SPOT as a share of the ladder's largest |cumulative|.
       Unit-free, so it is comparable across a $35 name and a $900 one, and it
       answers the question the flip was being used as a proxy for: are dealers
       short gamma where the stock is actually trading? Negative = short =
       hedging amplifies moves. */
    spotGammaShare: spotGammaShare(ladder, spot, peak),
    bandMin: ladder.length ? ladder[0].strike : null,
    bandMax: ladder.length ? ladder[ladder.length - 1].strike : null,
  };
}

/**
 * EVERY zero crossing of the cumulative dealer gamma that separates a material
 * book of EACH SIGN, scored by how much book it separates.
 *
 * Four things made the naive "first sign change scanning up from the bottom"
 * wrong, and the first three were live on the published board:
 *
 *   1. `cum` opens at the first rung's OWN gamma, so a rung with no measured
 *      aggressor gamma has cum === 0 exactly, and an `if (a.cum === 0) return
 *      a.strike` short-circuit published the bottom of the band — roughly
 *      -30% from spot — as a measured gamma flip.
 *   2. Scanning upward and returning the FIRST crossing is biased by
 *      construction: |cum| starts near zero and ends at |netGamma|, so a sign
 *      change is nearly free at the bottom of the ladder and costs a whole
 *      book at the top. Twelve of thirty-four live names sat within 4% of the
 *      band floor.
 *   3. A crossing between two rungs that each carry a negligible share of the
 *      book is float noise, not a regime boundary.
 *   4. And the fix for (3) has its own trap. Asserting materiality on the two
 *      rungs ADJACENT to the crossing is exactly backwards — a clean crossing
 *      passes through zero, so its immediate shoulders are small by definition
 *      — but asserting it on running maxima that still INCLUDE those shoulders
 *      is not the documented rule either, and on the real INTC ladder the sole
 *      surviving crossing cleared a 10% floor on the strength of its own
 *      shoulder while the book it separated carried 4.8%.
 *
 * So the windows are STRICTLY outside the crossing, and the test is not on
 * magnitude alone: the dominant book below and the dominant book above must
 * carry OPPOSITE SIGNS, which is what "the regime changes here" means. A
 * crossing between two same-signed books is a wobble, however large the
 * numbers on either side of it.
 *
 * `separation` is min(|dominant below|, |dominant above|) over peak: the
 * thinner of the two regimes the crossing divides. `materiality` is a NOISE
 * FLOOR on that quantity and nothing more — the strength of a boundary is
 * reported rather than thresholded, because a 5% side is a real but weak
 * boundary and a binary gate would either hide it or dress it up.
 */
export function gammaCrossings(ladder, { materiality = 0.02 } = {}) {
  const rows = ladder || [];
  const n = rows.length;
  if (n < 3) return [];
  let peak = 0;
  for (const r of rows) peak = Math.max(peak, Math.abs(r.cum));
  if (!(peak > 0)) return [];

  /* THE LADDER IS A SEQUENCE OF RUNS — maximal stretches over which the
     cumulative holds one sign — and a crossing is the boundary between two
     adjacent runs. That framing is what makes "how much book does this
     crossing separate" a LOCAL question with a different answer per crossing.
     A running maximum over everything below and everything above is global, so
     it hands every crossing in one book the same score and cannot tell a
     regime boundary from a wobble sitting between two large books.

     Measured on the case that motivated this: a cumulative of
     -100, -60, -2, +1, -2, -50, +100, +120 (millions) has three crossings. All
     three score identically under global windows. Under runs, the two around
     the +1 blip score 0.8% and the real boundary between -50 and +100 scores
     41.7%. With spot inside the blip, the global version published the blip —
     and inverted the regime sentence with it, because the blip's sides are the
     opposite way round from the book's. */
  const runs = [];
  let sign = 0, extreme = 0, startIdx = 0;
  for (let i = 0; i < n; i++) {
    const c = rows[i].cum;
    const sgn = Math.sign(c);
    // A cumulative that touches exactly zero and returns to its own sign is
    // not a crossing; a zero rung belongs to whatever run surrounds it.
    if (sgn === 0) { extreme = Math.abs(c) > Math.abs(extreme) ? c : extreme; continue; }
    if (sign === 0) { sign = sgn; extreme = c; startIdx = i; continue; }
    if (sgn === sign) { if (Math.abs(c) > Math.abs(extreme)) extreme = c; continue; }
    runs.push({ sign, extreme, from: startIdx, to: i - 1 });
    sign = sgn; extreme = c; startIdx = i;
  }
  if (sign !== 0) runs.push({ sign, extreme, from: startIdx, to: n - 1 });
  if (runs.length < 2) return [];

  const floor = peak * materiality;
  const out = [];
  for (let k = 1; k < runs.length; k++) {
    const lo = runs[k - 1], hi = runs[k];
    /* `separation` is the THINNER of the two regimes the crossing divides.
       materiality is a NOISE FLOOR on it and nothing more: the strength of a
       boundary is reported rather than thresholded, because a 5% side is a
       real but weak boundary — the live INTC book is exactly that — and a
       binary gate would either hide it or dress it up as a strong one. */
    const separation = Math.min(Math.abs(lo.extreme), Math.abs(hi.extreme));
    if (!(separation >= floor)) continue;

    // The crossing sits between the last rung of the low run and the first of
    // the high run; interpolate across whatever lies between them.
    const a = rows[lo.to], b = rows[hi.from];
    const span = Math.abs(a.cum) + Math.abs(b.cum);
    const strike = span > 0
      ? a.strike + (b.strike - a.strike) * (Math.abs(a.cum) / span)
      : a.strike;
    out.push({
      strike,
      // The side is a statement about the RUN below, which is what the card's
      // sentence is about — not about the sign of the single rung beside it.
      side: lo.sign < 0 ? "short_below" : "long_below",
      separation: separation / peak,
    });
  }
  return out;
}

/**
 * The crossing that separates the most book — that is the gamma flip.
 *
 * Distance to spot only breaks ties. Ranking by proximity instead was its own
 * failure: because the windows are non-local, a sign change inside a near-zero
 * region between two large books passes the materiality test, and when spot
 * sits inside that region the published flip is the wobble rather than the
 * boundary four points away — with the regime sentence inverted, because the
 * wobble's sides are the opposite way round from the book's.
 */
function pickCrossing(crossings, spot) {
  if (!crossings || !crossings.length) return null;
  let best = crossings[0];
  for (const c of crossings) {
    if (c.separation > best.separation) { best = c; continue; }
    if (c.separation === best.separation && spot > 0 &&
        Math.abs(c.strike - spot) < Math.abs(best.strike - spot)) best = c;
  }
  return best;
}

/**
 * Cumulative dealer gamma interpolated at spot, as a share of peak |cum|.
 *
 * null — never an edge value — when spot lies outside the measured band or the
 * ladder is too short to interpolate across. Clamping to the edge rung returned
 * a confident +-1 for a stock trading nowhere near the strikes on file, and the
 * SIGN of that number is what the card prints as its "short Γ" / "long Γ" badge
 * and what the quality gate reads as the amplification axis.
 */
function spotGammaShare(ladder, spot, peak) {
  if (ladder.length < 3 || !(spot > 0) || !(peak > 0)) return null;
  const first = ladder[0], last = ladder[ladder.length - 1];
  if (spot < first.strike || spot > last.strike) return null;
  for (let i = 1; i < ladder.length; i++) {
    const a = ladder[i - 1], b = ladder[i];
    if (spot <= b.strike) {
      const span = b.strike - a.strike;
      const w = span > 0 ? (spot - a.strike) / span : 0;
      return (a.cum + w * (b.cum - a.cum)) / peak;
    }
  }
  return last.cum / peak;
}

/**
 * Backwards-compatible single-value flip. Prefer aggressorGamma(), which
 * returns the crossing set, the side, the separation and the spot-relative
 * regime together.
 */
export function gammaFlip(ladder, { spot = null, ...opts } = {}) {
  const chosen = pickCrossing(gammaCrossings(ladder, opts), spot);
  return chosen ? chosen.strike : null;
}

/**
 * D — Dealer Book Displacement.
 *
 * *_oi is the standing book; *_vol is what traded today. Compared as
 * DISTRIBUTIONS rather than totals: the gap between their gamma
 * centroids, in ATR units. Large |D| means today's flow is building
 * gamma where the book is not, so the hedging profile is about to
 * change shape. Conventional GEX describes the regime you are in;
 * this says the regime is moving, and which way.
 *
 * Sign: positive = new gamma is accumulating ABOVE the standing book.
 */
export function bookDisplacement(strikeRows, atr) {
  const centroid = (pick) => {
    let wsum = 0, wx = 0;
    for (const r of strikeRows || []) {
      const k = num(r.strike);
      const w = Math.abs(num(r[pick.call])) + Math.abs(num(r[pick.put]));
      if (!(k > 0) || !(w > 0)) continue;
      wsum += w; wx += k * w;
    }
    return wsum > 0 ? { c: wx / wsum, w: wsum } : null;
  };

  const oi = centroid({ call: "call_gamma_oi", put: "put_gamma_oi" });
  const vol = centroid({ call: "call_gamma_vol", put: "put_gamma_vol" });
  if (!oi || !vol || !(atr > 0)) return { displacement: 0, oiCentroid: null, volCentroid: null, weight: 0 };

  return {
    displacement: (vol.c - oi.c) / atr,
    oiCentroid: oi.c,
    volCentroid: vol.c,
    weight: vol.w,                 // gate on this: a thin tape makes the centroid a one-print artefact
  };
}

/**
 * Psi — Intraday Delta Path Signature, from net-prem-ticks minute bars.
 *
 * Two names with the same end-of-day net delta and different paths
 * mean opposite things. Steady accumulation against the tape is
 * someone working a large order; one spike is a news reaction already
 * in the price. Most feeds publish only the daily total, so the shape
 * is unused information.
 *
 *   persistence   share of minutes moving with the day's net direction
 *   concentration share of absolute movement from the busiest 5% of minutes
 *   centroid      volume-weighted mean minute, 0..1 across the session
 */
export function pathSignature(tickRows) {
  const rows = (tickRows || [])
    .map((r) => ({ t: Date.parse(r.tape_time), d: num(r.net_delta) }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  if (rows.length < 3) return { persistence: 0, concentration: 0, centroid: 0.5, net: 0, bars: rows.length };

  /* Each row of /net-prem-ticks is that TICK's own value, not a running total.
     The vendor defines every sibling field per-tick — net_call_premium is
     "(call premium ask side) - (call premium bid side)" for the tick, and
     tape_time is "the start time of the tick" — so net_delta is the minute's
     net delta, and the increments ARE the rows.

     Differencing them, as this did, measured the second difference of the true
     signal. A buyer working a steady order at +900 per minute for 390 minutes
     has net +351,000 and persistence 1.0; differencing gave net = (last minute
     - first minute) ~ 0, so the direction was a coin flip and every downstream
     path measure was noise. */
  const steps = rows.map((r) => r.d);
  const net = steps.reduce((a, b) => a + b, 0);
  const dir = Math.sign(net) || 1;

  const withDir = steps.filter((s) => Math.sign(s) === dir).length;
  const persistence = withDir / steps.length;

  const abs = steps.map(Math.abs).sort((a, b) => b - a);
  const total = abs.reduce((a, b) => a + b, 0);
  const topN = Math.max(1, Math.ceil(abs.length * 0.05));
  const concentration = total > 0 ? abs.slice(0, topN).reduce((a, b) => a + b, 0) / total : 0;

  const span = rows[rows.length - 1].t - rows[0].t;
  let wsum = 0, wt = 0;
  for (let i = 0; i < rows.length; i++) {
    const w = Math.abs(steps[i]);
    if (w <= 0) continue;
    wsum += w;
    wt += w * (span > 0 ? (rows[i].t - rows[0].t) / span : 0.5);
  }
  const centroid = wsum > 0 ? wt / wsum : 0.5;

  return { persistence, concentration, centroid, net, bars: rows.length };
}

/* THE EXPIRY GAMMA LEGS ARE NAMED `call_gex` / `put_gex` ON THE WIRE.
 *
 * The vendor's field list for /greek-exposure/expiry documents `call_gamma`
 * and `put_gamma`. A dated probe against AAPL returned neither -- it returned
 * 23 rows carrying `call_gex=175414.5369  put_gex=-83920.3551`. Every card
 * shipped with the gamma roll-off panel reading "unavailable: no expiry gamma"
 * because the readers asked for the documented names and got undefined.
 *
 * Both are accepted, wire name first: the live response is evidence and the
 * field list is a claim, but a vendor that renamed once can rename back, and
 * falling back costs one `??`.
 *
 * The put leg arrives ALREADY dealer-signed under either name -- put_gex is
 * negative against a positive call_gex above -- so callers still SUM the
 * magnitudes for a gross figure. */
export function callGammaLeg(row) {
  return row ? (row.call_gex ?? row.call_gamma) : undefined;
}
export function putGammaLeg(row) {
  return row ? (row.put_gex ?? row.put_gamma) : undefined;
}

/* ---------- the second-order legs on the same response ----------
 *
 * ONE VENDOR CALL ALREADY BUYS SIX MORE LEGS THAN THIS PRODUCT READ.
 * /greek-exposure/expiry returns call/put legs for gex, delta, charm AND
 * vanna per expiry. Until now only the gamma pair was read; delta, charm and
 * vanna were parsed by JSON and dropped on the floor, once per name, every
 * run. The directive names Vanna and Charm explicitly, and they are the two
 * that explain what a gamma ladder cannot: charm is why pinning accelerates
 * into a Friday close, vanna is why a vol crush forces mechanical delta
 * buying at unchanged spot.
 *
 * WIRE NAME FIRST, same discipline the gamma pair earned the hard way, and
 * for the same reason: the schema block that documents these four is the one
 * that also says `call_gex` — the name a different part of the same document
 * got wrong and which cost this product every gamma roll-off panel for weeks.
 * That block is therefore evidence rather than a claim, but a `??` fallback
 * costs nothing and a rename costs a panel.
 *
 * THE SIGN CONVENTION IS NOT SHARED ACROSS LEGS, AND THAT IS THE TRAP.
 * In the vendor's own example rows: put_gex is NEGATIVE against a positive
 * call_gex, put_charm is NEGATIVE against a positive call_charm — both
 * dealer-signed — but put_vanna is POSITIVE against a positive call_vanna.
 * A reader that assumed one convention and netted call+put would report a
 * vanna book of the wrong magnitude and, on a put-heavy name, the wrong
 * direction entirely. So nothing here nets the two legs. Each is published
 * beside the other with the vendor's sign untouched, and the convention is
 * published as a field rather than assumed in a comment nobody reads. */

export function callVannaLeg(row) { return row ? (row.call_vanna ?? row.call_vex) : undefined; }
export function putVannaLeg(row)  { return row ? (row.put_vanna  ?? row.put_vex)  : undefined; }
export function callCharmLeg(row) { return row ? (row.call_charm ?? row.call_cex) : undefined; }
export function putCharmLeg(row)  { return row ? (row.put_charm  ?? row.put_cex)  : undefined; }
export function callDeltaLeg(row) { return row ? (row.call_delta ?? row.call_dex) : undefined; }
export function putDeltaLeg(row)  { return row ? (row.put_delta  ?? row.put_dex)  : undefined; }

/**
 * The units, published beside every number that carries them.
 *
 * This repository has one scar named after a missing unit ("1352% of its
 * year"), and exposure Greeks are the easiest place in the product to repeat
 * it: three of these are dollar quantities differing only by what they are
 * per, and read without their unit they are interchangeable large numbers.
 */
export const GREEK_UNITS = Object.freeze({
  gamma: "dollar-gamma: the change in dealer dollar-delta per 1% move in spot",
  delta: "dollar-delta: the signed directional exposure dealers are carrying",
  charm: "dollar-delta per DAY: how fast that exposure decays with time alone, spot unchanged",
  vanna: "dollar-delta per VOL POINT: how much that exposure moves on a 1-point change in implied volatility, spot unchanged",
});

/**
 * Is a leg actually on the wire, or merely absent?
 *
 * ABSENT IS NOT ZERO. A vendor that stopped publishing a leg, and a book that
 * genuinely measures zero at every expiry, produce the same sum. This tests
 * PRESENCE across the rows before any arithmetic runs, so a panel can say
 * "the vendor published no vanna leg on this response" rather than drawing a
 * flat line at zero and letting a reader conclude the name has no vanna.
 */
export function legPresent(rows, reader) {
  for (const r of (rows || [])) {
    const v = reader(r);
    if (v !== null && v !== undefined && v !== "") return true;
  }
  return false;
}

/**
 * A dated term structure for ONE Greek, both legs, unnetted.
 *
 * Shares gammaDecayCalendar's grammar — sorted onto the calendar, dated, with
 * a share of the book at each expiry — so a reader who has learned to read the
 * gamma roll-off can read these without learning a second vocabulary. What it
 * does NOT share is the netting: gammaDecayCalendar sums magnitudes because
 * the gamma legs arrive dealer-signed, and that assumption is false for vanna.
 *
 * Returns status "absent" when the vendor sent no such leg, "quiet" when the
 * leg was present but nothing survived shaping, and "ok" otherwise — the three
 * silences, kept apart at the point where they are still distinguishable.
 */
export function greekTermStructure(expiryRows, { name, callLeg, putLeg, asOf = null, cap = 12 } = {}) {
  const src = Array.isArray(expiryRows) ? expiryRows : [];
  const hasCall = legPresent(src, callLeg);
  const hasPut = legPresent(src, putLeg);
  if (!hasCall && !hasPut) {
    return {
      status: "absent",
      reason: `the vendor published no ${name} leg on this response`,
      unit: GREEK_UNITS[name] || null,
      rows: [], legs: { call: false, put: false },
    };
  }

  const base = asOf ? Date.parse(String(asOf).slice(0, 10) + "T00:00:00Z") : NaN;
  /* ABSENT-TESTED BEFORE COERCION, and the first draft of this function was
     not. It read each leg through num(), whose contract is a NUMBER — so an
     expiry the vendor sent no vanna for came back 0 and published `call: 0,
     put: 0, dte: 0`: a confident zero, in the function written to abolish
     them, telling a reader the book measured empty at that expiry when the
     vendor had simply said nothing. The dry-run fixture's one deliberately
     half-present expiry is what surfaced it. */
  const numOrNull = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const rows = [];
  for (const r of src) {
    if (!r || !r.expiry) continue;
    const c = hasCall ? numOrNull(callLeg(r)) : null;
    const p = hasPut ? numOrNull(putLeg(r)) : null;
    /* A row where BOTH legs are unreadable measured nothing and is dropped.
       A row where one leg is readable keeps it and nulls the other — half a
       reading is still a reading, and zeroing the missing half would invent
       a book that is not there. */
    if (c === null && p === null) continue;
    const ms = Date.parse(String(r.expiry).slice(0, 10) + "T00:00:00Z");
    const sentDte = numOrNull(r.dte);
    rows.push({
      expiry: String(r.expiry).slice(0, 10),
      call: c,
      put: p,
      /* The vendor's own dte where it sent one, ours where it did not, and
         null rather than a guess when we have no asOf to measure from. Read
         through numOrNull for the same reason as the legs: num() turned an
         unsent dte into "expires today". */
      dte: sentDte !== null ? sentDte
        : (Number.isFinite(base) && Number.isFinite(ms) ? Math.round((ms - base) / 86400000) : null),
    });
  }
  rows.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  const kept = rows.slice(0, cap);

  /* GROSS, NOT NET, and the field name says so. Summing |call| + |put| is a
     size, never a direction: it answers "how much of this Greek is on the
     book" without asserting which way it points, which is the only question
     the sign conventions above let this function answer for every leg. */
  const gross = kept.reduce((a, r) => a + Math.abs(r.call ?? 0) + Math.abs(r.put ?? 0), 0);

  return {
    status: kept.length ? "ok" : "quiet",
    reason: kept.length ? null : `the ${name} leg was present but no expiry carried a readable value`,
    unit: GREEK_UNITS[name] || null,
    /* Published rather than assumed: a reader (or a later renderer) must be
       able to see that the two legs were NOT combined and why. */
    signConvention:
      "the vendor's own sign on each leg, untouched. The put leg's convention " +
      "differs BY GREEK on this endpoint — put gamma and put charm arrive " +
      "dealer-signed against their call legs while put vanna does not — so the " +
      "two legs are never netted here and the total below is a gross size, not " +
      "a direction.",
    rows: kept,
    grossAbs: gross,
    legs: { call: hasCall, put: hasPut },
    seen: rows.length, cap, shed: Math.max(0, rows.length - kept.length),
  };
}

/**
 * TGamma — Gamma Expiry Decay Calendar, from greek-exposure/expiry.
 *
 * Gamma exposure is almost always reported as a scalar. It has a term
 * structure. "62% of this name's dealer gamma expires Friday" turns a
 * vague "it's pinned" into a dated statement with a regime change on
 * the other side of it.
 *
 * halfLifeExpiry is the first expiry at which cumulative roll-off
 * passes 50% of the total book.
 */
export function gammaDecayCalendar(expiryRows, { asOf = null } = {}) {
  const rows = (expiryRows || [])
    .map((r) => ({
      expiry: r.expiry,
      /* GROSS gamma rolling off, so magnitudes are summed rather than the sum
         taken in magnitude. The put leg arrives ALREADY dealer-signed (negative
         against a positive call leg), the convention this module's header
         calls load-bearing, so |call + put| cancels the two legs and reports
         the net residual. A front-week book of 1e9 call against -999e6 put --
         2.0e9 of gross gamma about to expire -- reported as 1e6 and lost the
         roll-off schedule entirely. */
      gamma: Math.abs(num(callGammaLeg(r))) + Math.abs(num(putGammaLeg(r))),
    }))
    .filter((r) => r.expiry && r.gamma > 0)
    .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));

  const total = rows.reduce((a, r) => a + r.gamma, 0);
  if (!(total > 0)) {
    return {
      schedule: [], halfLifeExpiry: null, halfLifeDays: null,
      meanLifeDays: null, frontLoad: null,
    };
  }

  const base = asOf ? Date.parse(String(asOf).slice(0, 10) + "T00:00:00Z") : NaN;
  const daysTo = (expiry) => {
    if (!Number.isFinite(base)) return null;
    const t = Date.parse(String(expiry).slice(0, 10) + "T00:00:00Z");
    return Number.isFinite(t) ? Math.round((t - base) / 86400000) : null;
  };

  let cum = 0, halfLifeExpiry = null, halfLifeDays = null;
  let lifeWeighted = 0, lifeWeight = 0;
  const schedule = rows.map((r) => {
    cum += r.gamma;
    const share = r.gamma / total;
    const cumShare = cum / total;
    const days = daysTo(r.expiry);
    if (halfLifeExpiry === null && cumShare >= 0.5) {
      halfLifeExpiry = r.expiry;
      halfLifeDays = days;
    }
    if (days !== null) { lifeWeighted += days * r.gamma; lifeWeight += r.gamma; }
    return { expiry: r.expiry, share, cumShare, days };
  });

  /* frontLoad — schedule[0].share — is PARTITION-DEPENDENT: it measures the
     first listed expiry's share, so a name with weeklies and a name with
     monthlies are not comparable, and adding one expiry to the chain changes
     it without anything about the book changing. The gamma-weighted mean life
     IS identified: it is E[days to expiry] under the gross-gamma measure, a
     quantity with a unit (days) that survives any repartition of the chain.
     frontLoad is kept for the card, which shows the schedule beside it. */
  return {
    schedule,
    halfLifeExpiry,
    halfLifeDays,
    meanLifeDays: lifeWeight > 0 ? lifeWeighted / lifeWeight : null,
    frontLoad: schedule.length ? schedule[0].share : null,
  };
}

/**
 * Omega — Positioning Quality pair, from greek-flow.
 *
 *   otmShare  OTM share of DIRECTIONAL delta flow. High = lottery
 *             tickets; low = considered near-money conviction.
 *   vegaTilt  vega flow per unit of delta flow. High means the
 *             participant is trading volatility, not direction —
 *             the cleanest possible reason to SUPPRESS a directional
 *             read rather than misinterpret it as a view.
 *
 * Both denominators are bounded away from zero: a vanishing delta
 * flow is "no directional view", never infinite vol conviction.
 */
export function positioningQuality(greekFlowRows, { floor = 1e-6 } = {}) {
  let dirNet = 0, dirAbs = 0, otmAbs = 0, vega = 0, delta = 0;
  for (const r of greekFlowRows || []) {
    const d = num(r.dir_delta_flow);
    dirNet += d;
    dirAbs += Math.abs(d);
    otmAbs += Math.abs(num(r.otm_dir_delta_flow));
    vega += Math.abs(num(r.total_vega_flow));
    delta += Math.abs(num(r.total_delta_flow));
  }
  /* GROSS over GROSS, for the same reason as flowPurity. The old form divided
     SUM(otm_dir) by |SUM(dir)| — two different cancellations — so the ratio
     had no bounded distribution and Math.min(1, ...) was the operative clamp
     rather than a guard: the column was censored at 1 on exactly the names
     where the denominator had cancelled hardest. |otm_dir| <= |dir| holds row
     by row, so the gross ratio lives in [0,1] by construction.

     null, not 0, when there is nothing to measure. Zero is the TOP of this
     column once it is oriented, so imputing it rewarded a name for having no
     data — the same failure the enrich() docstring already argues against. */
  return {
    otmShare: dirAbs > floor ? Math.min(1, otmAbs / dirAbs) : null,
    vegaTilt: delta > floor ? vega / delta : null,
    hasDirectionalView: Math.abs(dirNet) > floor,
  };
}

/* =============================================================
   Composite and calibration
   ============================================================= */

/**
 * Correlation-clustered family weighting.
 *
 * Naive equal weighting silently overweights whichever family has the
 * most members: seven restatements of the same ask-minus-bid tape
 * outvote one genuinely independent measure. Weight each family by
 * its effective number of independent signals rather than its raw
 * count, using the average pairwise |correlation| within the family.
 *
 *   n_eff = n / (1 + (n - 1) * rhoBar)
 */
export function effectiveBreadth(columns) {
  /* A column with no cross-sectional dispersion carries no information and
     must not be paid for. The old form never looked at the values: a single
     all-zero column hit `if (n <= 1) return n` and was awarded a full unit of
     weight, which is exactly how a dead family V drew the same weight as a
     live one on the published board. Two or more dead columns were worse —
     pearson returns NaN when a column has zero variance, so rhoBar fell to 0
     and the family was awarded its FULL raw count as if perfectly
     independent. */
  const live = (columns || []).filter(isLiveColumn);
  const n = live.length;
  if (n === 0) return 0;
  if (n === 1) return 1;
  let sum = 0, pairs = 0;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const r = pearson(live[a], live[b]);
      if (Number.isFinite(r)) { sum += Math.abs(r); pairs++; }
    }
  }
  const rhoBar = pairs ? sum / pairs : 0;
  return n / (1 + (n - 1) * rhoBar);
}

/** A column is live when at least two finite entries differ. */
export function isLiveColumn(column) {
  const xs = (column || []).filter(Number.isFinite);
  if (xs.length < 2) return false;
  const first = xs[0];
  return xs.some((v) => v !== first);
}

/**
 * The same n_eff algebra applied one level up: how much of a family is
 * already said by the OTHER families.
 *
 * effectiveBreadth was only ever called with one family's own columns, so it
 * could see redundancy INSIDE a family and was structurally incapable of
 * seeing it BETWEEN them — which is where the most redundant pair on the
 * board actually lived. Returns a divisor >= 1 per key.
 */
export function crossFamilyRedundancy(familyColumns) {
  const keys = Object.keys(familyColumns);
  const k = keys.length;
  const out = {};
  for (const key of keys) out[key] = 1;
  if (k <= 1) return out;
  for (const key of keys) {
    let sum = 0, pairs = 0;
    for (const other of keys) {
      if (other === key) continue;
      const r = pearson(familyColumns[key], familyColumns[other]);
      if (Number.isFinite(r)) { sum += Math.abs(r); pairs++; }
    }
    const rhoBar = pairs ? sum / pairs : 0;
    out[key] = 1 + (k - 1) * rhoBar;
  }
  return out;
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let sa = 0, sb = 0, m = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    sa += a[i]; sb += b[i]; m++;
  }
  if (m < 2) return NaN;
  const ma = sa / m, mb = sb / m;
  let num_ = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const x = a[i] - ma, y = b[i] - mb;
    num_ += x * y; da += x * x; db += y * y;
  }
  if (da <= 0 || db <= 0) return NaN;
  return num_ / Math.sqrt(da * db);
}

/**
 * Map a composite z to a bounded [-100, 100] score.
 *
 * The scale is calibrated FROM THE CROSS-SECTION, not hardcoded: it
 * is chosen so the given reference quantile of |z| lands on
 * `refScore`. That is the fix for the failure mode where absolute
 * thresholds made the top band mathematically unreachable and every
 * name displayed "no view" forever. With this, the reference
 * quantile always maps to refScore by construction, whatever the
 * day's dispersion.
 */
export function calibrateScoreScale(zs, { refQuantile = 0.95, refScore = 80 } = {}) {
  const ref = quantile(zs.map(Math.abs), refQuantile);
  const target = Math.min(Math.max(refScore, 1), 99) / 100;
  if (!Number.isFinite(ref) || ref <= 1e-9) return 1;
  return Math.atanh(target) / ref;
}

/**
 * THE PUBLISHED SCORE'S UNIT, fixed once and for all.
 *
 * The score used to be `boundedScore(vanDerWaerden(residual)[i], scale)` with
 * `scale` calibrated from that same rank ladder. Both halves of that discard
 * magnitude: van der Waerden maps rank -> normal quantile by construction, and
 * calibrateScoreScale then normalised by the 0.95 quantile of |those rank
 * scores|. The composition is therefore a deterministic function of RANK and
 * POOL SIZE only. Measured: a 34-name board always printed exactly
 * 84 77 71 65 60 55 50 45 40 35 30 26 21 16 12 7 2 and its mirror, whatever
 * the data — residuals scaled by 1e-9 and by 1e9 produced byte-identical
 * ladders — and a name's score moved by 15 points when the pool grew from 30
 * names to 48 with its own data held fixed.
 *
 * A FIXED scale makes the number mean something: a residual two robust sigma
 * from the cross-sectional median scores 80, on every session and at every
 * pool size. A flat day then prints flat scores, which is the information the
 * rank ladder was destroying. Ordering is unaffected — tanh is monotone — so
 * this changes what the magnitude claims, not who is ranked where.
 */
export const SCORE_SCALE = Math.atanh(0.80) / 2.0;

/**
 * Cross-sectional percentile in (0,1), ties averaged.
 *
 * The same avgRank / (m + 1) plotting position van der Waerden uses, without
 * the normal quantile step: bounded, unit-free, and with a mean of exactly
 * 1/2 by construction, which is what makes a product of them a gate with a
 * mean of one. Non-finite entries are returned as null and simply do not
 * participate — an unmeasured axis casts no vote instead of the worst one.
 */
export function percentileRank(values) {
  const xs = values || [];
  const idx = [];
  for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i])) idx.push(i);
  const m = idx.length;
  const out = xs.map(() => null);
  if (!m) return out;
  if (m === 1) { out[idx[0]] = 0.5; return out; }

  idx.sort((a, b) => xs[a] - xs[b]);
  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avgRank = (i + j) / 2 + 1;          // 1-based, ties averaged
    for (let k = i; k <= j; k++) out[idx[k]] = avgRank / (m + 1);
    i = j + 1;
  }
  return out;
}

/**
 * THE QUALITY GATE — a multiplier, never a vote.
 *
 * A magnitude that carries no direction of its own cannot be ADDED to a
 * signed composite: doing so turns "this name's flow is high quality" into
 * "this name is bullish". The previous fix for that signed each magnitude by
 * sign(dirDelta) and kept it additive, which reintroduced the same inversion
 * one level down — three of the ten scoring columns became restatements of
 * sign(dirDelta), they carried the NEGATIVE sign and a quarter of the weight,
 * and the measured result was corr(composite, dirDelta) = -0.07: the board was
 * net SHORT its own directional flow signal.
 *
 * Modifiers multiply. Each axis is reduced to its cross-sectional percentile,
 * so no axis needs a unit or a hand-set coefficient and a near-constant axis
 * contributes almost nothing; the mean of the percentiles is then doubled, so
 * the gate is bounded in (0,2) with a cross-sectional mean of one by
 * construction. A near-constant modifier therefore does nothing, and no
 * modifier can flip the sign of the signal it modifies.
 *
 * `axes` is an array of equal-length columns, each ORIENTED so that larger is
 * more trustworthy. Returns one multiplier per name.
 */
export function qualityGate(axes, { floor = 0.2 } = {}) {
  const cols = axes || [];
  /* THE CROSS-SECTION'S SIZE COMES FROM THE INPUT, never from the survivors.
     Deriving it from the live columns meant that when EVERY axis was dead there
     was nothing left to measure the length against, so this returned a
     zero-length array — and the caller's `blended.map((b, i) => b * gate[i])`
     then multiplied by undefined and produced NaN for every name on the board.
     boundedScore's own guard turns each NaN into 0, so the symptom is not a
     visible NaN but a board where every score is zero, every name falls inside
     the dead band, and the run refuses to publish anything at all.

     Every axis dead is reachable: gammaFrontLoad was null on all thirty-four
     live names for exactly one such reason, and a thin cross-section can make
     the rest constant. A neutral gate of one is the right answer there — the
     composite passes through unmodified — but only if it has one entry per
     name. */
  const n = cols.reduce((m, c) => Math.max(m, (c || []).length), 0);
  const live = cols.filter(isLiveColumn);
  if (!live.length) return new Array(n).fill(1);

  const ranks = live.map(percentileRank);
  const out = [];
  for (let i = 0; i < n; i++) {
    let sum = 0, k = 0;
    for (const r of ranks) {
      if (r[i] === null) continue;
      sum += r[i]; k++;
    }
    out.push(k ? Math.max(floor, 2 * (sum / k)) : 1);
  }
  return out;
}

/**
 * Annualized close-to-close realized volatility over the last `window`
 * returns. The denominator of the variance risk premium, computed from
 * candles this pipeline has already paid for.
 */
export function realizedVol(closes, { window = 30, periodsPerYear = 252 } = {}) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0);
  if (xs.length < 3) return null;
  const rets = [];
  for (let i = Math.max(1, xs.length - window); i < xs.length; i++) {
    rets.push(Math.log(xs[i] / xs[i - 1]));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
  return Math.sqrt(Math.max(varr, 0) * periodsPerYear);
}

/**
 * THE FORECAST HORIZON, in trading sessions, and the year it is scaled against.
 *
 * Ten sessions is two calendar weeks of trading. It is a CHOICE — the data does
 * not pick it — so it is named once here and published beside every number
 * derived from it, rather than left implicit in an arithmetic constant.
 */
export const HORIZON_SESSIONS = 10;
export const TRADING_YEAR = 252;

/**
 * A one-sigma move over `sessions`, from an ANNUALIZED volatility.
 *
 * sigma_h = sigma_annual * sqrt(h / 252)
 *
 * This is the square-root-of-time rule. It is exact under exactly one
 * assumption, and it is worth stating the WEAKEST one that suffices rather than
 * the familiar stronger one: variance must accumulate linearly in time, which
 * needs only UNCORRELATED increments. Independent and identically distributed
 * returns give that, but are far more than is required — returns may be
 * heteroskedastic and non-normal and the rule still holds, provided successive
 * increments are uncorrelated.
 *
 * The assumption is still false in detail: volatility clusters, and a term
 * structure in implied vol is the option market saying so in its own prices.
 * But it introduces no fitted parameter, every input is observable, and the
 * alternative — reading a vol off a different maturity for each name — is the
 * incomparability this function exists to remove.
 *
 * WHY THIS EXISTS BESIDE THE VENDOR'S OWN implied_move_perc. That figure is
 * quoted to each name's NEXT LISTED EXPIRY, which is a different horizon for
 * every name: a name expiring tomorrow and one expiring in a month print bands
 * that are not comparable, and putting them side by side on a board is a
 * category error. A fixed horizon is what makes a cross-section a cross-section.
 * Both are published; only this one is comparable.
 */
export function horizonMove(annualVol, { sessions = HORIZON_SESSIONS, periodsPerYear = TRADING_YEAR } = {}) {
  if (!Number.isFinite(annualVol) || annualVol <= 0) return null;
  if (!(sessions > 0) || !(periodsPerYear > 0)) return null;
  return annualVol * Math.sqrt(sessions / periodsPerYear);
}

export function boundedScore(z, scale) {
  if (!Number.isFinite(z)) return 0;
  return Math.round(100 * Math.tanh(z * (Number.isFinite(scale) && scale > 0 ? scale : 1)));
}

/**
 * Conviction separates signal STRENGTH from signal AGREEMENT.
 *
 * A name where every family agrees weakly deserves to outrank one
 * where a single family screams while three disagree. Every term is
 * a ratio in [0,1], so the whole range is reachable by construction —
 * no absolute threshold can strand it at zero.
 */
export function conviction({ familyScores = [], coverage = 1, persistence = 0 }) {
  /* `s !== 0` used to do double duty: it dropped a genuinely ABSENT family
     from the agreement denominator, which is right, and it also dropped a
     family that was measured and landed neutral, which is wrong — and the
     coverage term went on paying full price for the absent one either way, so
     losing a family RAISED conviction. Absent is now null at the source, so
     presence is a null test and a measured 0 counts as a family that agrees
     with nothing. */
  const present = familyScores.filter((s) => Number.isFinite(s));
  if (!present.length) return { conviction: 0, agreement: 0, breadth: 0 };

  const sign = Math.sign(present.reduce((a, b) => a + b, 0)) || 1;
  const agree = present.filter((s) => Math.sign(s) === sign).length;
  const agreement = agree / present.length;

  const cov = Math.min(Math.max(coverage, 0), 1);
  const per = Math.min(Math.max(persistence, 0), 1);
  const value = 0.45 * agreement + 0.35 * cov + 0.20 * per;

  return {
    conviction: Math.round(100 * Math.min(Math.max(value, 0), 1)),
    agreement,
    breadth: present.length,
  };
}

/**
 * Rank hysteresis. A board that churns completely every session is unusable
 * and expensive, so a name already on it is given room to slip before it goes.
 *
 * THE RULE, and it took two wrong versions to get here:
 *
 *   - Every name in today's top `entryRank` is on the board. Unconditionally.
 *   - An incumbent still inside `exitRank` is ALSO kept.
 *   - The board is the union, in today's rank order, so it runs between
 *     `entryRank` and `exitRank` rows.
 *
 * The first version placed incumbents last, which made the whole thing a
 * provable no-op — identical to slice(0, entryRank) for every input. Placing
 * them first fixed that and overcorrected into something worse: incumbency
 * came to beat rank absolutely. With 25 incumbents sitting at ranks 5 to 29,
 * the emitted board was exactly those 25 and the session's four strongest
 * names were not on it at all.
 *
 * A variable-length board is the price, and it is the right price: the
 * alternative is a fixed length that can only be held by excluding the very
 * names the board exists to surface. The dead band already makes length vary.
 */
export function applyHysteresis(todayRanked, yesterdayIds, { entryRank = 25, exitRank = 35 } = {}) {
  const ranked = todayRanked || [];
  const held = new Set(yesterdayIds || []);
  const taken = new Set();
  const keep = [];

  // Today's top `entryRank`, always. Nothing outranks being one of the best
  // names in the session.
  for (let i = 0; i < ranked.length && keep.length < entryRank; i++) {
    keep.push(ranked[i]);
    taken.add(ranked[i]);
  }

  // Then incumbents that have slipped past entryRank but are still inside the
  // exit band. This is the hysteresis, and it can only ADD.
  for (let i = entryRank; i < ranked.length && i < exitRank; i++) {
    const id = ranked[i];
    if (held.has(id) && !taken.has(id)) { keep.push(id); taken.add(id); }
  }

  const rankOf = new Map(ranked.map((id, i) => [id, i]));
  return keep.sort((a, b) => rankOf.get(a) - rankOf.get(b));
}

