export function lnGamma(x) {
  if (!(x > 0)) return NaN;
  if (x < 0.5) {

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

export const SKEWT_NU_MIN = 2.05;
export const SKEWT_NU_MAX = 30;
export const SKEWT_LAMBDA_MAX = 0.95;

export function skewtConstants(nu, lambda) {
  const logC = lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(Math.PI * (nu - 2));
  const c = Math.exp(logC);
  const a = 4 * lambda * c * (nu - 2) / (nu - 1);
  const b = Math.sqrt(1 + 3 * lambda * lambda - a * a);
  return { a, b, c, logC };
}

export function skewtLogDensity(z, nu, lambda, k) {
  const { a, b, logC } = k || skewtConstants(nu, lambda);
  const side = z < -a / b ? 1 - lambda : 1 + lambda;
  const u = (b * z + a) / side;
  return Math.log(b) + logC - ((nu + 1) / 2) * Math.log(1 + (u * u) / (nu - 2));
}

export function skewtDensity(z, nu, lambda) {
  return Math.exp(skewtLogDensity(z, nu, lambda));
}

export const GARCH_PERSIST_CAP = 0.999;
export const GARCH_PRIOR = Object.freeze({
  persistence: 0.95, persistenceSd: 1.0, share: 0.1, shareSd: 0.7,
});
export const GARCH_WINSOR_K = 6;
export const GARCH_EWMA_LAMBDA = 0.94;

const logit = (q) => Math.log(q / (1 - q));

function unpack(p, v0) {
  const sig = (v) => 1 / (1 + Math.exp(-v));
  const persist = sig(p[0]) * GARCH_PERSIST_CAP;
  const share = sig(p[1]);
  const alpha = persist * share;
  const beta = persist - alpha;
  const omega = v0 * (1 - persist);
  const nu = SKEWT_NU_MIN + (SKEWT_NU_MAX - SKEWT_NU_MIN) * sig(p[2]);
  const lambda = SKEWT_LAMBDA_MAX * Math.tanh(p[3]);
  return { omega, alpha, beta, nu, lambda };
}

function negLogLik(p, e, v0, penalised) {
  const { omega, alpha, beta, nu, lambda } = unpack(p, v0);
  const k = skewtConstants(nu, lambda);
  if (!(k.b > 0) || !Number.isFinite(k.logC)) return Infinity;
  let s2 = v0, ll = 0;
  for (let t = 0; t < e.length; t++) {
    if (t > 0) s2 = omega + alpha * e[t - 1] * e[t - 1] + beta * s2;
    if (!(s2 > 0) || !Number.isFinite(s2)) return Infinity;
    const s = Math.sqrt(s2);
    ll += skewtLogDensity(e[t] / s, nu, lambda, k) - Math.log(s);
  }
  if (penalised) {
    ll -= 0.5 * ((p[0] - logit(GARCH_PRIOR.persistence)) / GARCH_PRIOR.persistenceSd) ** 2;
    ll -= 0.5 * ((p[1] - logit(GARCH_PRIOR.share)) / GARCH_PRIOR.shareSd) ** 2;
  }
  return -ll;
}

function nelderMead(f, x0, { iters = 1400, step = 0.5, tol = 1e-8 } = {}) {
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
  const sorted = r.slice().sort((a, b) => a - b);
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const dev = r.map((v) => v - med);
  const absSorted = dev.map(Math.abs).sort((a, b) => a - b);
  const mad = absSorted[Math.floor(absSorted.length / 2)] * 1.4826;
  const q90 = absSorted[Math.min(absSorted.length - 1, Math.floor(absSorted.length * 0.9))] / 1.645;
  const robustSd = Math.max(mad, q90 / 2);
  if (!(robustSd > 0)) {
    return { status: "unavailable", reason: "every return in the window is identical, so there is no variance to model" };
  }
  const cap = GARCH_WINSOR_K * robustSd;
  let capped = 0;
  const clipped = dev.map((v) => { if (Math.abs(v) > cap) { capped++; return Math.sign(v) * cap; } return v; });
  const shift = clipped.reduce((a, b) => a + b, 0) / clipped.length;
  const mean = med + shift;
  const e = clipped.map((v) => v - shift);
  const raw = r.map((v) => v - mean);
  const v0 = e.reduce((a, b) => a + b * b, 0) / e.length;
  if (!(v0 > 0)) {
    return { status: "unavailable", reason: "every return in the window is identical, so there is no variance to model" };
  }

  const nu0 = Math.log((6 - SKEWT_NU_MIN) / (SKEWT_NU_MAX - 6));
  const starts = [
    [logit(0.95), logit(0.1), nu0, 0],
    [logit(0.98), logit(0.05), nu0, 0],
    [logit(0.85), logit(0.25), nu0, 0],
  ];
  let fit = null;
  for (const p0 of starts) {
    const cand = nelderMead((p) => negLogLik(p, e, v0, true), p0);
    if (fit === null || cand.f < fit.f) fit = cand;
  }
  const logLik = -negLogLik(fit.x, e, v0, false);
  const { omega, alpha, beta, nu, lambda } = unpack(fit.x, v0);
  const persistence = alpha + beta;
  const s2 = new Array(e.length);
  s2[0] = v0;
  for (let t = 1; t < e.length; t++) s2[t] = omega + alpha * e[t - 1] * e[t - 1] + beta * s2[t - 1];
  const condVol = s2.map((v) => Number((Math.sqrt(v) * GARCH_ANNUALISE).toFixed(2)));
  const ewma = new Array(e.length);
  let w = v0;
  for (let t = 0; t < raw.length; t++) {
    if (t > 0) w = GARCH_EWMA_LAMBDA * w + (1 - GARCH_EWMA_LAMBDA) * raw[t - 1] * raw[t - 1];
    ewma[t] = Number((Math.sqrt(w) * GARCH_ANNUALISE).toFixed(2));
  }
  const nextS2 = omega + alpha * e[e.length - 1] * e[e.length - 1] + beta * s2[e.length - 1];
  const edges = [];
  if (persistence > 0.998) {
    edges.push("persistence reached its cap despite a prior pulling it toward " + GARCH_PRIOR.persistence +
      "; the path reads as near-integrated");
  }
  if (alpha < 1e-3) edges.push("no ARCH effect was found in the window, so beta and persistence are not identified");
  if (nu < SKEWT_NU_MIN + 0.05) edges.push("the tail shape hit its floor");
  if (Math.abs(lambda) > SKEWT_LAMBDA_MAX - 0.02) edges.push("the skew hit its cap");
  const edge = edges.length > 0;
  return {
    status: "ok",
    dist: "skewt",
    method: "penalised maximum likelihood with variance targeting",
    n: e.length,
    mean: Number(mean.toFixed(4)),
    robustSd: Number(robustSd.toFixed(4)),
    cap: Number(cap.toFixed(3)),
    capped,
    omega: Number(omega.toPrecision(4)),
    alpha: Number(alpha.toFixed(4)),
    beta: Number(beta.toFixed(4)),
    nu: Number(nu.toFixed(3)),
    lambda: Number(lambda.toFixed(3)),
    persistence: Number(persistence.toFixed(4)),
    longRunVol: Number((Math.sqrt(v0) * GARCH_ANNUALISE).toFixed(2)),
    lastVol: condVol[condVol.length - 1],
    nextVol: Number((Math.sqrt(nextS2) * GARCH_ANNUALISE).toFixed(2)),
    logLik: Number(logLik.toFixed(2)),
    converged: fit.converged && !edge,
    ...(fit.converged && !edge ? {} : {
      reason: !fit.converged
        ? "the optimiser hit its step limit before the likelihood settled"
        : edges.join("; "),
    }),
    returns: raw.map((v) => Number(v.toFixed(3))),
    dates: rd,
    condVol,
    ewma,
  };
}
