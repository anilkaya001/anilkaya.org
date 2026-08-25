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
  let scale = mad(ok, m);

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
export function neutralize(y, { numeric = [], groups = [], ridge = 1e-8 } = {}) {
  const n = y.length;
  if (!n) return [];

  const cols = [new Array(n).fill(1)];
  for (const c of numeric) {
    if (c.length !== n) throw new Error("neutralize: control length mismatch");
    cols.push(c.map((v) => (Number.isFinite(v) ? v : 0)));
  }
  if (groups.length === n) {
    const levels = [...new Set(groups.filter((g) => g != null && g !== ""))].sort();
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
  let dir = 0, tot = 0;
  for (const r of greekFlowRows || []) {
    dir += num(r.dir_delta_flow);
    tot += Math.abs(num(r.total_delta_flow));
  }
  if (tot <= 0) return { purity: 0, dirDelta: 0, totalAbs: 0 };
  return { purity: Math.min(1, Math.abs(dir) / tot), dirDelta: dir, totalAbs: tot };
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
export function aggressorGamma(strikeRows) {
  const ladder = (strikeRows || [])
    .map((r) => ({
      strike: num(r.strike),
      gamma: num(r.call_gamma_ask) + num(r.call_gamma_bid) +
             num(r.put_gamma_ask) + num(r.put_gamma_bid),
    }))
    .filter((r) => Number.isFinite(r.strike) && r.strike > 0)
    .sort((a, b) => a.strike - b.strike);

  let cum = 0;
  for (const row of ladder) { cum += row.gamma; row.cum = cum; }

  return { ladder, netGamma: cum, flip: gammaFlip(ladder) };
}

/**
 * Linear interpolation of the strike at which cumulative dealer gamma
 * crosses zero. Returns null when the book never changes sign — a
 * name that is long-gamma or short-gamma across its whole ladder has
 * no flip, and inventing one would be a fabricated level.
 */
export function gammaFlip(ladder) {
  for (let i = 1; i < ladder.length; i++) {
    const a = ladder[i - 1], b = ladder[i];
    if (a.cum === 0) return a.strike;
    if ((a.cum < 0) !== (b.cum < 0)) {
      const span = Math.abs(a.cum) + Math.abs(b.cum);
      if (span <= 0) return a.strike;
      return a.strike + (b.strike - a.strike) * (Math.abs(a.cum) / span);
    }
  }
  return null;
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

  const steps = [];
  for (let i = 1; i < rows.length; i++) steps.push(rows[i].d - rows[i - 1].d);
  const net = rows[rows.length - 1].d - rows[0].d;
  const dir = Math.sign(net) || 1;

  const withDir = steps.filter((s) => Math.sign(s) === dir).length;
  const persistence = withDir / steps.length;

  const abs = steps.map(Math.abs).sort((a, b) => b - a);
  const total = abs.reduce((a, b) => a + b, 0);
  const topN = Math.max(1, Math.ceil(abs.length * 0.05));
  const concentration = total > 0 ? abs.slice(0, topN).reduce((a, b) => a + b, 0) / total : 0;

  const span = rows[rows.length - 1].t - rows[0].t;
  let wsum = 0, wt = 0;
  for (let i = 1; i < rows.length; i++) {
    const w = Math.abs(steps[i - 1]);
    if (w <= 0) continue;
    wsum += w;
    wt += w * (span > 0 ? (rows[i].t - rows[0].t) / span : 0.5);
  }
  const centroid = wsum > 0 ? wt / wsum : 0.5;

  return { persistence, concentration, centroid, net, bars: rows.length };
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
export function gammaDecayCalendar(expiryRows) {
  const rows = (expiryRows || [])
    .map((r) => ({
      expiry: r.expiry,
      gamma: Math.abs(num(r.call_gamma) + num(r.put_gamma)),
    }))
    .filter((r) => r.expiry && r.gamma > 0)
    .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));

  const total = rows.reduce((a, r) => a + r.gamma, 0);
  if (!(total > 0)) return { schedule: [], halfLifeExpiry: null, frontLoad: 0 };

  let cum = 0, halfLifeExpiry = null;
  const schedule = rows.map((r) => {
    cum += r.gamma;
    const share = r.gamma / total;
    const cumShare = cum / total;
    if (halfLifeExpiry === null && cumShare >= 0.5) halfLifeExpiry = r.expiry;
    return { expiry: r.expiry, share, cumShare };
  });

  return { schedule, halfLifeExpiry, frontLoad: schedule.length ? schedule[0].share : 0 };
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
  let dir = 0, otmDir = 0, vega = 0, delta = 0;
  for (const r of greekFlowRows || []) {
    dir += num(r.dir_delta_flow);
    otmDir += num(r.otm_dir_delta_flow);
    vega += Math.abs(num(r.total_vega_flow));
    delta += Math.abs(num(r.total_delta_flow));
  }
  const dirAbs = Math.abs(dir);
  return {
    otmShare: dirAbs > floor ? Math.min(1, Math.abs(otmDir) / dirAbs) : 0,
    vegaTilt: delta > floor ? vega / delta : 0,
    hasDirectionalView: dirAbs > floor,
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
  const n = columns.length;
  if (n <= 1) return n;
  let sum = 0, pairs = 0;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const r = pearson(columns[a], columns[b]);
      if (Number.isFinite(r)) { sum += Math.abs(r); pairs++; }
    }
  }
  const rhoBar = pairs ? sum / pairs : 0;
  return n / (1 + (n - 1) * rhoBar);
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
  const present = familyScores.filter((s) => Number.isFinite(s) && s !== 0);
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
 * Rank hysteresis. A board that churns completely every session is
 * unusable and expensive. A name already on the board stays until it
 * falls out of `exitRank`; a new name must beat `entryRank` to
 * displace one. Asymmetric by design.
 */
export function applyHysteresis(todayRanked, yesterdayIds, { entryRank = 25, exitRank = 35 } = {}) {
  const held = new Set(yesterdayIds || []);
  const keep = [];
  for (let i = 0; i < todayRanked.length; i++) {
    const id = todayRanked[i];
    const rank = i + 1;
    if (rank <= entryRank) keep.push(id);
    else if (held.has(id) && rank <= exitRank) keep.push(id);
    if (keep.length >= entryRank) break;
  }
  return keep;
}
