import assert from "node:assert/strict";
import { fitGarch, skewtDensity, skewtConstants, lnGamma, GARCH_MIN_RETURNS, SKEWT_NU_MIN, SKEWT_NU_MAX,
         GARCH_WINSOR_K, GARCH_PERSIST_CAP, GARCH_EWMA_LAMBDA }
  from "../shared/flows-garch.js";
import { repairCandles, CANDLE_BREAK_LOG, CANDLE_BREAK_VOLUME } from "../scripts/flows-pipeline.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); n++; };

near(lnGamma(5), Math.log(24), 1e-10, "lnGamma(5) = ln 4!");
near(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10, "lnGamma(1/2) = ln sqrt(pi)");
near(lnGamma(0.25), Math.log(3.6256099082219083), 1e-10, "lnGamma(1/4), through the reflection");

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
{
  let windows = 0, unidentified = 0;
  for (let w = 0; w + 251 <= px.length; w += 251) {
    const year = fitGarch(px.slice(w, w + 251), dates.slice(w, w + 251));
    windows++;
    ok(year.status === "ok" && year.dist === "skewt", `a one-year window fits (${w})`);
    const pinned = year.persistence > 0.998 || year.alpha < 1e-3;
    if (pinned) unidentified++;
    ok(!(pinned && year.converged),
       `a window whose persistence reached its cap or whose alpha fell to zero is never published as converged (${w})`);
    ok(year.longRunVol > 0,
       `and its long-run level is still published, because under variance targeting it is the window's own sample volatility and not a ratio of two edge values (${w})`);
    if (pinned) ok(/cap|not identified/.test(year.reason), `with the edge named in the reason (${year.reason})`);
  }
  ok(windows >= 10, `${windows} one-year windows were checked, ${unidentified} of them at an edge`);
}
{
  const flatPx = [100];
  for (let t = 0; t < 250; t++) flatPx.push(flatPx[flatPx.length - 1] * Math.exp(1.2 * skewtDraw(5, -0.2) / 100));
  const flat = fitGarch(flatPx);
  ok(flat.status === "ok", "a constant-variance year still fits");
  if (flat.alpha < 1e-3) {
    ok(flat.converged === false && /not identified/.test(flat.reason) && flat.longRunVol > 0,
       "and when the optimiser finds no ARCH effect the fit is published unsettled with beta unidentified, the long run still the sample volatility");
  } else {
    ok(flat.alpha >= 1e-3, `or it found a small ARCH effect (alpha ${flat.alpha}) and stands on its own`);
  }
}
const uniform = fitGarch(Array.from({ length: 300 }, (_, i) => 100 + (i % 2)));
ok(uniform.status === "ok" && uniform.converged === false && typeof uniform.reason === "string",
   "a series the model cannot describe is published with converged:false and a reason, not hidden");
{
  ok(/variance targeting/.test(fit.method) && fit.capped <= fit.n * 0.005,
     `a clean series names the method and caps at most one return in two hundred (${fit.capped} of ${fit.n}: ` +
     "a t with six degrees of freedom does reach six robust sd now and then)");
  near(fit.longRunVol, Math.sqrt(fit.returns.reduce((a, b) => a + b * b, 0) / fit.n) * Math.sqrt(252), 0.5,
       "under variance targeting the long-run level is the window's own sample volatility, annualised");
  ok(fit.ewma.length === fit.n && fit.ewma.every((v) => v > 0),
     "the EWMA reference path is one per return and positive");
  const last = fit.ewma[fit.ewma.length - 1];
  ok(last > fit.lastVol / 2 && last < fit.lastVol * 2,
     `the reference and the fitted path close the window within a factor of two of each other (${last} vs ${fit.lastVol})`);
  near(fit.cap, GARCH_WINSOR_K * fit.robustSd, 0.002, "the cap is six robust standard deviations");
  ok(fit.persistence <= GARCH_PERSIST_CAP, "persistence never exceeds the cap the parameterisation imposes");
  ok(GARCH_EWMA_LAMBDA === 0.94, "the reference decay is RiskMetrics' 0.94, the one every desk recognises");
}
{
  const jumpPx = px.slice(0, 261).map((v, i) => (i >= 130 ? v * 4 : v));
  const jf = fitGarch(jumpPx, dates.slice(0, 261));
  ok(jf.status === "ok" && jf.capped === 1 && jf.converged === true,
     `one 300% session inside a year is capped for the fit and the fit still settles (capped ${jf.capped}, ${jf.reason || "settled"})`);
  ok(Math.max(...jf.returns.map(Math.abs)) > jf.cap,
     "while the published returns keep the jump as it happened, so the chart draws the bar the fit refused");
  const cf = fitGarch(px.slice(0, 261), dates.slice(0, 261));
  {
    let worst = 0;
    for (let t = 0; t < jf.condVol.length; t++) {
      if (t >= 128 && t < 161) continue;
      worst = Math.max(worst, Math.abs(jf.condVol[t] / cf.condVol[t] - 1));
    }
    ok(worst < 0.15, `outside the thirty sessions after the jump the path is within 15% of the same window's clean fit (worst ${(worst * 100).toFixed(1)}%)`);
    ok(Math.sign(jf.lambda) === Math.sign(cf.lambda),
       `and the skew keeps the clean fit's sign, because the returns are centred on the median before the cap and on the capped mean after it (${jf.lambda} vs ${cf.lambda})`);
    near(jf.longRunVol, cf.longRunVol, cf.longRunVol * 0.12, "and the long run is within an eighth of the clean fit's");
    ok(jf.ewma[131] > cf.ewma[131] * 3,
       `while the EWMA reference, fed the returns as they happened, does spike after the bar the fit refused (${jf.ewma[131]} vs ${cf.ewma[131]})`);
  }
  ok(jf.alpha >= 1e-3 && jf.persistence <= 0.998 && jf.longRunVol !== null,
     `and the fit is identified with its long run published (alpha ${jf.alpha}, persistence ${jf.persistence})`);
  {
    const stale = [100];
    let k = 0;
    for (let t = 0; t < 300; t++) {
      k = (k * 1103515245 + 12345) % 2147483648;
      const move = t % 3 === 2 ? 2 * ((k / 2147483648) - 0.5) * 3.4 : 0;
      stale.push(stale[stale.length - 1] * Math.exp(move / 100));
    }
    const sf = fitGarch(stale);
    ok(sf.status === "ok" && sf.capped < sf.n * 0.1,
       `a name flat two sessions in three does not have its every real move capped: the robust scale is floored at half the ninetieth-percentile scale, which one outlier cannot inflate (${sf.capped} of ${sf.n} capped, cap ${sf.cap})`);
  }
}
{
  const day = (i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString();
  const rows = Array.from({ length: 300 }, (_, i) => ({
    start_time: day(i), open: 1, high: 1, low: 1, volume: i < 120 ? 1000 : 21000,
    close: i < 120 ? 1000 + i : 40 + i * 0.1,
  }));
  const rep = repairCandles(rows);
  ok(rep.breaks.length === 1 && rep.breaks[0].before === 120 && rep.breaks[0].date === day(120).slice(0, 10),
     `an unadjusted split is found once, dated by the first session after it, with the sessions before it counted (${JSON.stringify(rep.breaks)})`);
  near(rep.breaks[0].ratio, 52 / 1119, 1e-3, "and the break carries the close-to-close ratio");
  ok(rep.breaks[0].shape === "split" && rep.breaks[0].volumeRatio === 21,
     "with the volume scaling inversely to the price, which is what names it a split rather than a move");
  ok(rep.candles.length === 180 && rep.candles[0].close === 52,
     "the repaired series starts at the session after the break, so no price-derived figure spans it");
  const clean = repairCandles(rows.slice(120));
  ok(clean.breaks.length === 0 && clean.candles.length === 180, "a continuous series is returned whole with no break");
  ok(CANDLE_BREAK_LOG === 0.4 && CANDLE_BREAK_VOLUME === 4,
     "the lines are a 0.4 log step in price and a fourfold step in volume; a price step alone is not a break");
  const twice = repairCandles(rows.map((r, i) => ({ ...r, close: i < 60 ? 5000 : r.close, volume: i < 60 ? 200 : r.volume })));
  ok(twice.breaks.length === 2 && twice.candles.length === 180,
     "two breaks are both reported and the series is cut at the last one");
  const move = rows.slice(120).map((r, i) => ({ ...r, close: i >= 90 ? r.close * 1.55 : r.close, volume: i >= 90 && i < 100 ? 40000 : 21000 }));
  const kept = repairCandles(move);
  ok(kept.breaks.length === 0 && kept.candles.length === 180,
     "a genuine 55% session on twice the volume is a move, not a split, and the history before it is kept for the fit to winsorise");
  const remap = rows.slice(120).map((r, i) => ({ ...r, close: i >= 90 ? r.close * 13.6 : r.close, volume: i >= 90 ? 21000 * 72 : 21000 }));
  const rm = repairCandles(remap);
  ok(rm.breaks.length === 1 && rm.breaks[0].shape === "regime" && rm.candles.length === 90,
     `a series that steps thirteenfold in price and seventyfold in volume is a re-listed instrument, cut as a regime break (${JSON.stringify(rm.breaks)})`);
  const holed = rows.map((r, i) => (i === 120 ? { ...r, close: null } : r));
  const hd = repairCandles(holed);
  ok(hd.breaks.length === 1 && hd.breaks[0].before === 121 && hd.candles[0].close > 0,
     "a null close on the split session does not hide the split: the step is read against the last positive close");
  const blind = rows.map((r) => ({ ...r, volume: null }));
  const bd = repairCandles(blind);
  ok(bd.breaks.length === 1 && bd.breaks[0].shape === "unverified" && bd.breaks[0].volumeRatio === null,
     "without volume the price step alone is still cut, and the break says the volume could not be read");
}

console.log(`✓ flows-garch: ${n} assertions — Hansen's skewed t is a zero-mean unit-variance density that ` +
  "collapses to the Student t at zero skew, the simulator draws from it, the fit recovers simulated " +
  "parameters including the sign of the skew, the path is dated by the session it ends on, and the two " +
  "silences and the unconverged state each carry their reason");
