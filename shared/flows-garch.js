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

function unpack(p) {
  const sig = (v) => 1 / (1 + Math.exp(-v));
  const omega = Math.exp(p[0]);
  const persist = sig(p[1]) * 0.9999;
  const share = sig(p[2]);
  const alpha = persist * share;
  const beta = persist - alpha;
  const nu = SKEWT_NU_MIN + (SKEWT_NU_MAX - SKEWT_NU_MIN) * sig(p[3]);
  const lambda = SKEWT_LAMBDA_MAX * Math.tanh(p[4]);
  return { omega, alpha, beta, nu, lambda };
}

function negLogLik(p, e, s2init) {
  const { omega, alpha, beta, nu, lambda } = unpack(p);
  const k = skewtConstants(nu, lambda);
  if (!(k.b > 0) || !Number.isFinite(k.logC)) return Infinity;
  let s2 = s2init, ll = 0;
  for (let t = 0; t < e.length; t++) {
    if (t > 0) s2 = omega + alpha * e[t - 1] * e[t - 1] + beta * s2;
    if (!(s2 > 0) || !Number.isFinite(s2)) return Infinity;
    const s = Math.sqrt(s2);
    ll += skewtLogDensity(e[t] / s, nu, lambda, k) - Math.log(s);
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
        "five parameters on fewer say whatever the optimiser wants",
    };
  }
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const e = r.map((v) => v - mean);
  const v0 = e.reduce((a, b) => a + b * b, 0) / e.length;
  if (!(v0 > 0)) {
    return { status: "unavailable", reason: "every return in the window is identical, so there is no variance to model" };
  }

  const p0 = [
    Math.log(v0 * 0.02), Math.log(0.98 / 0.02), Math.log(0.08 / 0.90),
    Math.log((6 - SKEWT_NU_MIN) / (SKEWT_NU_MAX - 6)), 0,
  ];
  const fit = nelderMead((p) => negLogLik(p, e, v0), p0);
  const { omega, alpha, beta, nu, lambda } = unpack(fit.x);
  const persistence = alpha + beta;
  const s2 = new Array(e.length);
  s2[0] = v0;
  for (let t = 1; t < e.length; t++) s2[t] = omega + alpha * e[t - 1] * e[t - 1] + beta * s2[t - 1];
  const condVol = s2.map((v) => Number((Math.sqrt(v) * GARCH_ANNUALISE).toFixed(2)));
  const nextS2 = omega + alpha * e[e.length - 1] * e[e.length - 1] + beta * s2[e.length - 1];
  const edges = [];
  if (persistence > 0.998) {
    edges.push("persistence reached its cap, which a year of returns does for a fair share of stationary " +
      "series; the path reads as near-integrated");
  }
  if (alpha < 1e-3) edges.push("no ARCH effect was found in the window, so beta and persistence are not identified");
  if (nu < SKEWT_NU_MIN + 0.05) edges.push("the tail shape hit its floor");
  if (Math.abs(lambda) > SKEWT_LAMBDA_MAX - 0.02) edges.push("the skew hit its cap");
  const edge = edges.length > 0;
  const identified = persistence <= 0.998 && alpha >= 1e-3;
  return {
    status: "ok",
    dist: "skewt",
    n: e.length,
    mean: Number(mean.toFixed(4)),
    omega: Number(omega.toPrecision(4)),
    alpha: Number(alpha.toFixed(4)),
    beta: Number(beta.toFixed(4)),
    nu: Number(nu.toFixed(3)),
    lambda: Number(lambda.toFixed(3)),
    persistence: Number(persistence.toFixed(4)),

    longRunVol: identified
      ? Number((Math.sqrt(omega / (1 - persistence)) * GARCH_ANNUALISE).toFixed(2)) : null,
    lastVol: condVol[condVol.length - 1],
    nextVol: Number((Math.sqrt(nextS2) * GARCH_ANNUALISE).toFixed(2)),
    logLik: Number((-fit.f).toFixed(2)),
    converged: fit.converged && !edge,
    ...(fit.converged && !edge ? {} : {
      reason: !fit.converged
        ? "the optimiser hit its step limit before the likelihood settled"
        : edges.join("; "),
    }),
    returns: e.map((v) => Number(v.toFixed(3))),
    dates: rd,
    condVol,
  };
}
