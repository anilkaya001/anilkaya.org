import assert from "node:assert/strict";
import { fitGarch, skewtDensity, skewtConstants, lnGamma, GARCH_MIN_RETURNS, SKEWT_NU_MIN, SKEWT_NU_MAX }
  from "../shared/flows-garch.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); n++; };

near(lnGamma(5), Math.log(24), 1e-10, "lnGamma(5) = ln 4!");
near(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10, "lnGamma(1/2) = ln sqrt(pi), through the reflection");

for (const [nu, lambda] of [[3, 0], [4.5, -0.3], [6, 0.25], [12, -0.6], [30, 0]]) {
  let mass = 0, m1 = 0, m2 = 0;
  for (let z = -40; z <= 40; z += 0.002) {
    const d = skewtDensity(z, nu, lambda);
    mass += d * 0.002; m1 += z * d * 0.002; m2 += z * z * d * 0.002;
  }
  near(mass, 1, 3e-3, `skew-t(${nu}, ${lambda}) integrates to one`);
  near(m1, 0, 5e-3, `skew-t(${nu}, ${lambda}) has zero mean, which is what a is for`);
  if (nu >= 4.5) {
    near(m2, 1, 1.5e-2, `skew-t(${nu}, ${lambda}) has unit variance inside forty sd, which is what b is for`);
  } else {
    ok(m2 > 0.9 && m2 < 1, `skew-t(${nu}, ${lambda}) carries most of its unit variance inside forty sd, ` +
       `and the rest sits in tails a grid this wide cannot close (${m2.toFixed(3)})`);
  }
}
{
  const nu = 5;
  const k = skewtConstants(nu, 0);
  near(k.a, 0, 1e-12, "with no skew the location shift a is zero");
  near(k.b, 1, 1e-12, "and the scale b is one, so the density is the standardised Student t");
  const stdT = (z) => Math.exp(lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(Math.PI * (nu - 2)))
    * Math.pow(1 + (z * z) / (nu - 2), -(nu + 1) / 2);
  for (const z of [-3, -1, 0, 0.7, 2.5]) near(skewtDensity(z, nu, 0), stdT(z), 1e-12, `skew-t(5, 0) at ${z} is the unit-variance t`);
}
ok(skewtDensity(-3, 5, -0.3) > skewtDensity(3, 5, -0.3), "a negative lambda puts more mass in the left tail");
ok(skewtDensity(3, 5, 0.3) > skewtDensity(-3, 5, 0.3), "and a positive one in the right");
ok(skewtDensity(3, 3, 0) > skewtDensity(3, 20, 0), "a lower shape puts more mass three sd out: heavier tails");

let seed = 0x9E3779B9 ^ 11;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gammaDraw = (a) => {
  if (a < 1) return gammaDraw(a + 1) * Math.pow(rnd(), 1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = rnd(), u2 = rnd(); x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rnd();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
};
const normalDraw = () => {
  const u1 = rnd() || 1e-12, u2 = rnd();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
const skewtDraw = (nu, lambda) => {
  const { a, b } = skewtConstants(nu, lambda);
  const t = normalDraw() / Math.sqrt(2 * gammaDraw(nu / 2) / nu);
  const y = Math.abs(t) * Math.sqrt((nu - 2) / nu);
  return rnd() < (1 - lambda) / 2 ? (-(1 - lambda) * y - a) / b : ((1 + lambda) * y - a) / b;
};
{
  let m1 = 0, m2 = 0, left = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) { const z = skewtDraw(6, -0.25); m1 += z; m2 += z * z; if (z < -2) left++; }
  near(m1 / N, 0, 0.01, "the simulator's draws have zero mean");
  near(m2 / N, 1, 0.03, "and unit variance, so the fit is asked to recover what was generated");
  let mass = 0;
  for (let z = -40; z < -2; z += 0.002) mass += skewtDensity(z, 6, -0.25) * 0.002;
  near(left / N, mass, 0.004, "and the share below minus two sd matches the density's own left tail");
}

const TRUE = { omega: 0.05, alpha: 0.10, beta: 0.85, nu: 6, lambda: -0.25 };
let s2 = TRUE.omega / (1 - TRUE.alpha - TRUE.beta);
const px = [100], dates = ["2020-01-01"];
for (let t = 0; t < 4000; t++) {
  const e = Math.sqrt(s2) * skewtDraw(TRUE.nu, TRUE.lambda);
  px.push(px[px.length - 1] * Math.exp(e / 100));
  s2 = TRUE.omega + TRUE.alpha * e * e + TRUE.beta * s2;
  dates.push("2020-01-" + String(2 + (t % 27)).padStart(2, "0"));
}
const fit = fitGarch(px, dates);
ok(fit.status === "ok" && fit.converged, "a long clean GARCH series fits and converges");
ok(fit.dist === "skewt", "and the card says which innovation density was fitted");
near(fit.alpha, TRUE.alpha, 0.04, "alpha recovered");
near(fit.beta, TRUE.beta, 0.05, "beta recovered");
near(fit.nu, TRUE.nu, 1.5, "the tail shape nu recovered");
near(fit.lambda, TRUE.lambda, 0.08, "the skew lambda recovered, with its sign");
near(fit.persistence, TRUE.alpha + TRUE.beta, 0.05, "persistence recovered");
ok(fit.n === px.length - 1 && fit.condVol.length === fit.n && fit.returns.length === fit.n && fit.dates.length === fit.n,
   "path, returns and dates are one per return, parallel");
ok(fit.dates[0] === dates[1], "each return is dated by the session it ENDS on");
ok(fit.condVol.every((v) => v > 0), "the annualised path is positive everywhere");
const meanVol = fit.condVol.reduce((a, b) => a + b, 0) / fit.condVol.length;
near(meanVol, Math.sqrt(TRUE.omega / (1 - TRUE.alpha - TRUE.beta)) * Math.sqrt(252), 4,
     "the path's mean is near the true unconditional vol, annualised");
ok(fit.lastVol === fit.condVol[fit.condVol.length - 1], "lastVol is the path's final point, not a second computation");
ok(fit.nextVol > 0 && Math.abs(fit.nextVol - fit.lastVol) < fit.lastVol,
   "nextVol is the one-step recursion off the last shock, in the same units, and not a forecast of the return");
ok(!("z" in fit) && !("forecast" in fit) && !("bins" in fit) && !("density" in fit),
   "no standardised residuals, no forecast, no histogram and no density are published");
ok(fit.nu > SKEWT_NU_MIN && fit.nu < SKEWT_NU_MAX, "the shape sits inside the bounds the optimiser searches");
{
  let g2 = TRUE.omega / (1 - TRUE.alpha - TRUE.beta);
  const npx = [100];
  for (let t = 0; t < 1500; t++) {
    const e = Math.sqrt(g2) * normalDraw();
    npx.push(npx[npx.length - 1] * Math.exp(e / 100));
    g2 = TRUE.omega + TRUE.alpha * e * e + TRUE.beta * g2;
  }
  const normalFit = fitGarch(npx);
  ok(normalFit.status === "ok" && normalFit.converged === true && normalFit.nu > 20,
     "a series with the normal's tails fits with a large shape and still counts as converged: the skewed t " +
     `nests the normal at the top of its range, so resting there is a reading, not an edge (nu ${normalFit.nu})`);
}

const short = fitGarch(px.slice(0, GARCH_MIN_RETURNS), dates.slice(0, GARCH_MIN_RETURNS));
ok(short.status === "unavailable" && /needs at least 60/.test(short.reason), "fewer than sixty returns is unavailable with the count");
const flat = fitGarch(Array(200).fill(50));
ok(flat.status === "unavailable" && /identical/.test(flat.reason), "a flat series has no variance to model and says so");
const gappy = fitGarch([100, null, 0, 101, -3, 102, ...px.slice(0, 300)]);
ok(gappy.status === "ok" && gappy.n === 302, "null, zero and negative closes are skipped, not bridged into returns");
const uniform = fitGarch(Array.from({ length: 300 }, (_, i) => 100 + (i % 2)));
ok(uniform.status === "ok" && uniform.converged === false && typeof uniform.reason === "string",
   "a series the model cannot describe is published with converged:false and a reason, not hidden");

console.log(`✓ flows-garch: ${n} assertions — Hansen's skewed t is a zero-mean unit-variance density that ` +
  "collapses to the Student t at zero skew, the simulator draws from it, the fit recovers simulated " +
  "parameters including the sign of the skew, the path is dated by the session it ends on, and the two " +
  "silences and the unconverged state each carry their reason");
