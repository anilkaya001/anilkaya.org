/* =============================================================
   flows-garch.js — a GARCH(1,1) with generalised-error innovations,
   fitted once, in the pipeline, from the year of closes the card
   already paid for.

   WHY THE FIT LIVES HERE AND NOT IN A RENDERER.

   The ticker page draws a conditional-volatility path and a fitted
   return distribution beside the price chart. A renderer that fitted
   the model itself would be deriving a reading on the client — four
   parameters and a 252-point path — from a series another panel owns,
   and two derivations of one series is how a header and the panel
   under it come to disagree. The pipeline fits it once, publishes the
   parameters and the path, and the page DRAWS what was published.

   WHAT IS FITTED. Daily log returns in percent, demeaned once, and

       s2[t] = omega + alpha * e[t-1]^2 + beta * s2[t-1]

   with e[t] / s[t] distributed GED(nu). The likelihood is maximised by
   Nelder-Mead over an unconstrained reparameterisation, so omega stays
   positive, alpha and beta stay non-negative with alpha + beta < 1, and
   nu stays in (0.5, 6). The GED collapses to the normal at nu = 2 and is
   heavier-tailed below it, which is the point of fitting the shape
   rather than assuming it: a nu near 1.3 is an ordinary equity, and the
   histogram the page draws over the fitted density is what lets a reader
   see whether the tails are the model's or the name's.

   WHAT IS PUBLISHED AND WHAT IS NOT. Parameters, the persistence
   alpha + beta, the unconditional volatility they imply, the
   conditional-volatility path (annualised, percent) with its dates, and
   the returns it was fitted to. Standardised residuals are NOT published
   — they are the returns divided by the path, which the page can do
   while binning a histogram; publishing them would be the same number
   twice. No forecast is published either: a one-step-ahead figure is a
   claim about tomorrow, and this module is a description of the year.

   THE SILENCES. Fewer than sixty usable returns is `unavailable` with
   the count in the reason — a fit on a month of data says whatever the
   optimiser wants. A fit that fails to converge or lands on the edge of
   the parameter space is published with `converged: false` and the
   reason, because a drawn path from an unconverged fit is still the
   path the likelihood found; the page says so under it. */

/** log Gamma by the Lanczos approximation, good to ~1e-13 for x > 0. */
export function lnGamma(x) {
  if (!(x > 0)) return NaN;
  if (x < 0.5) {
    // Reflection, so small nu (whose 1/nu and 3/nu are large) stays exact
    // and arguments under a half do not lose digits.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The GED scale lambda for shape nu, so that the density has unit variance. */
export function gedLambda(nu) {
  return Math.sqrt(Math.pow(2, -2 / nu) * Math.exp(lnGamma(1 / nu) - lnGamma(3 / nu)));
}

/** Unit-variance GED density at z, shape nu. nu = 2 is the standard normal. */
export function gedDensity(z, nu) {
  const lam = gedLambda(nu);
  const logC = Math.log(nu) - Math.log(lam) - (1 + 1 / nu) * Math.LN2 - lnGamma(1 / nu);
  return Math.exp(logC - 0.5 * Math.pow(Math.abs(z / lam), nu));
}

/* Unconstrained -> model space. The optimiser walks R^4; this is the map
   that keeps every point it visits a legal GARCH. */
function unpack(p) {
  const sig = (v) => 1 / (1 + Math.exp(-v));
  const omega = Math.exp(p[0]);
  const persist = sig(p[1]) * 0.9999;      // alpha + beta, strictly under one
  const share = sig(p[2]);                 // alpha's share of the persistence
  const alpha = persist * share;
  const beta = persist - alpha;
  const nu = 0.5 + 5.5 * sig(p[3]);        // (0.5, 6)
  return { omega, alpha, beta, nu };
}

function negLogLik(p, e, s2init) {
  const { omega, alpha, beta, nu } = unpack(p);
  const lam = gedLambda(nu);
  const logC = Math.log(nu) - Math.log(lam) - (1 + 1 / nu) * Math.LN2 - lnGamma(1 / nu);
  let s2 = s2init, ll = 0;
  for (let t = 0; t < e.length; t++) {
    if (t > 0) s2 = omega + alpha * e[t - 1] * e[t - 1] + beta * s2;
    if (!(s2 > 0) || !Number.isFinite(s2)) return Infinity;
    const s = Math.sqrt(s2);
    ll += logC - 0.5 * Math.pow(Math.abs(e[t] / (s * lam)), nu) - Math.log(s);
  }
  return -ll;
}

/* Nelder-Mead, plain. Four parameters and ~250 observations is small
   enough that a few hundred simplex steps cost less than one vendor call. */
function nelderMead(f, x0, { iters = 900, step = 0.5, tol = 1e-8 } = {}) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; simplex.push(x); }
  let vals = simplex.map(f);
  let evals = simplex.length;
  const centroid = (excl) => {
    const c = new Array(n).fill(0);
    for (let i = 0; i < simplex.length; i++) {
      if (i === excl) continue;
      for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    }
    return c;
  };
  const lerp = (a, b, t) => a.map((v, j) => v + t * (b[j] - v));
  let it = 0;
  for (; it < iters; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]); vals = order.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol * (1 + Math.abs(vals[0]))) break;
    const c = centroid(n);
    const xr = lerp(c, simplex[n], -1); const fr = f(xr); evals++;
    if (fr < vals[0]) {
      const xe = lerp(c, simplex[n], -2); const fe = f(xe); evals++;
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      simplex[n] = xr; vals[n] = fr;
    } else {
      const outside = fr < vals[n];
      const xc = lerp(c, outside ? xr : simplex[n], 0.5); const fc = f(xc); evals++;
      if (fc < (outside ? fr : vals[n])) { simplex[n] = xc; vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { simplex[i] = lerp(simplex[0], simplex[i], 0.5); vals[i] = f(simplex[i]); evals++; }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], f: vals[best], iters: it, evals, converged: it < iters };
}

export const GARCH_MIN_RETURNS = 60;
export const GARCH_ANNUALISE = Math.sqrt(252);

/**
 * Fit GARCH(1,1)-GED to a dated series of closes.
 *
 * `closes` and `dates` are parallel, oldest first; a null or non-positive
 * close ends one return and starts the next at the following usable
 * close, and the returned `dates` name the session each return ENDS on.
 */
export function fitGarch(closes, dates = [], { minReturns = GARCH_MIN_RETURNS } = {}) {
  const px = [], when = [];
  for (let i = 0; i < (closes || []).length; i++) {
    const c = Number(closes[i]);
    if (!(c > 0) || !Number.isFinite(c)) continue;
    px.push(c); when.push(dates && typeof dates[i] === "string" ? dates[i].slice(0, 10) : null);
  }
  const r = [], rd = [];
  for (let i = 1; i < px.length; i++) { r.push(100 * Math.log(px[i] / px[i - 1])); rd.push(when[i]); }
  if (r.length < minReturns) {
    return {
      status: "unavailable",
      reason: `${r.length} usable daily returns, and a GARCH fit needs at least ${minReturns} — ` +
        "four parameters on fewer say whatever the optimiser wants",
    };
  }
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const e = r.map((v) => v - mean);
  const v0 = e.reduce((a, b) => a + b * b, 0) / e.length;
  if (!(v0 > 0)) {
    return { status: "unavailable", reason: "every return in the window is identical, so there is no variance to model" };
  }
  /* Started at the textbook equity fit — alpha 0.08, beta 0.9, nu 1.5 —
     with omega sized so the unconditional variance equals the sample's. */
  const p0 = [Math.log(v0 * 0.02), Math.log(0.98 / 0.02), Math.log(0.08 / 0.90), Math.log((1.5 - 0.5) / (6 - 1.5))];
  const fit = nelderMead((p) => negLogLik(p, e, v0), p0);
  const { omega, alpha, beta, nu } = unpack(fit.x);
  const persistence = alpha + beta;
  const s2 = new Array(e.length);
  s2[0] = v0;
  for (let t = 1; t < e.length; t++) s2[t] = omega + alpha * e[t - 1] * e[t - 1] + beta * s2[t - 1];
  const condVol = s2.map((v) => Number((Math.sqrt(v) * GARCH_ANNUALISE).toFixed(2)));
  const edge = persistence > 0.998 || nu < 0.55 || nu > 5.9;
  return {
    status: "ok",
    n: e.length,
    mean: Number(mean.toFixed(4)),
    omega: Number(omega.toPrecision(4)),
    alpha: Number(alpha.toFixed(4)),
    beta: Number(beta.toFixed(4)),
    nu: Number(nu.toFixed(3)),
    persistence: Number(persistence.toFixed(4)),
    /* Annualised percent, like condVol, so the two are one unit. */
    longRunVol: persistence < 1
      ? Number((Math.sqrt(omega / (1 - persistence)) * GARCH_ANNUALISE).toFixed(2)) : null,
    logLik: Number((-fit.f).toFixed(2)),
    converged: fit.converged && !edge,
    ...(fit.converged && !edge ? {} : {
      reason: !fit.converged
        ? "the optimiser hit its step limit before the likelihood settled"
        : "the fit sits on the edge of the parameter space, which is what a series with a " +
          "structural break or too few extreme days looks like to this model",
    }),
    returns: e.map((v) => Number(v.toFixed(3))),
    dates: rd,
    condVol,
  };
}
