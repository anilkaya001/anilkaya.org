import assert from "node:assert/strict";
import { fitGarch, gedDensity, gedLambda, lnGamma, GARCH_MIN_RETURNS } from "../shared/flows-garch.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); n++; };

near(lnGamma(5), Math.log(24), 1e-10, "lnGamma(5) = ln 4!");
near(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10, "lnGamma(1/2) = ln sqrt(pi), through the reflection");
for (const nu of [0.8, 1.3, 2, 3.5]) {
  let mass = 0, v = 0;
  for (let z = -14; z <= 14; z += 0.002) { const d = gedDensity(z, nu); mass += d * 0.002; v += z * z * d * 0.002; }
  near(mass, 1, 2e-3, `GED(${nu}) integrates to one`);
  near(v, 1, 5e-3, `GED(${nu}) has unit variance, which is what lambda is for`);
}
near(gedDensity(0, 2), 1 / Math.sqrt(2 * Math.PI), 1e-9, "GED(2) at zero is the standard normal at zero");
ok(gedDensity(3, 1.2) > gedDensity(3, 2), "a shape under 2 puts more mass three sd out: heavier tails");

let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
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
const gedDraw = (nu) => { const mag = gedLambda(nu) * Math.pow(2 * gammaDraw(1 / nu), 1 / nu); return rnd() < 0.5 ? -mag : mag; };
const TRUE = { omega: 0.05, alpha: 0.10, beta: 0.85, nu: 1.5 };
let s2 = TRUE.omega / (1 - TRUE.alpha - TRUE.beta);
const px = [100], dates = ["2020-01-01"];
for (let t = 0; t < 4000; t++) {
  const e = Math.sqrt(s2) * gedDraw(TRUE.nu);
  px.push(px[px.length - 1] * Math.exp(e / 100));
  s2 = TRUE.omega + TRUE.alpha * e * e + TRUE.beta * s2;
  dates.push("2020-01-" + String(2 + (t % 27)).padStart(2, "0"));
}
const fit = fitGarch(px, dates);
ok(fit.status === "ok" && fit.converged, "a long clean GARCH series fits and converges");
near(fit.alpha, TRUE.alpha, 0.04, "alpha recovered");
near(fit.beta, TRUE.beta, 0.05, "beta recovered");
near(fit.nu, TRUE.nu, 0.3, "the GED shape recovered");
near(fit.persistence, TRUE.alpha + TRUE.beta, 0.05, "persistence recovered");
ok(fit.n === px.length - 1 && fit.condVol.length === fit.n && fit.returns.length === fit.n && fit.dates.length === fit.n,
   "path, returns and dates are one per return, parallel");
ok(fit.dates[0] === dates[1], "each return is dated by the session it ENDS on");
ok(fit.condVol.every((v) => v > 0), "the annualised path is positive everywhere");
const meanVol = fit.condVol.reduce((a, b) => a + b, 0) / fit.condVol.length;
near(meanVol, Math.sqrt(TRUE.omega / (1 - TRUE.alpha - TRUE.beta)) * Math.sqrt(252), 4,
     "the path's mean is near the true unconditional vol, annualised");
ok(!("z" in fit) && !("forecast" in fit), "no standardised residuals and no forecast are published");

const short = fitGarch(px.slice(0, GARCH_MIN_RETURNS), dates.slice(0, GARCH_MIN_RETURNS));
ok(short.status === "unavailable" && /needs at least 60/.test(short.reason), "fewer than sixty returns is unavailable with the count");
const flat = fitGarch(Array(200).fill(50));
ok(flat.status === "unavailable" && /identical/.test(flat.reason), "a flat series has no variance to model and says so");
const gappy = fitGarch([100, null, 0, 101, -3, 102, ...px.slice(0, 300)]);
ok(gappy.status === "ok" && gappy.n === 302, "null, zero and negative closes are skipped, not bridged into returns");
const uniform = fitGarch(Array.from({ length: 300 }, (_, i) => 100 + (i % 2)));
ok(uniform.status === "ok" && uniform.converged === false && typeof uniform.reason === "string",
   "a series the model cannot describe is published with converged:false and a reason, not hidden");

console.log(`✓ flows-garch: ${n} assertions — the GED is a unit-variance density, the fit recovers ` +
  "simulated parameters, the path is dated by the session it ends on, and the two silences and the " +
  "unconverged state each carry their reason");
