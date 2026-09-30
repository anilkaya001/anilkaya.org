import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as BS from "../shared/flows-quant-bs.js";
import * as SMILE from "../shared/flows-quant-smile.js";
import * as DENSITY from "../shared/flows-quant-density.js";
import * as WORLD from "../shared/flows-quant-world.js";
import * as ENGINE from "../shared/flows-quant-engine.js";
import * as TIME from "../shared/flows-quant-time.js";
import * as QC from "../shared/flows-quant-card.js";
import * as QP from "../scripts/flows-quant-pipeline.mjs";
import { skewtConstants } from "../shared/flows-garch.js";
import { STATE_STRUCTURES } from "../shared/flows-neuron.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-quant-audit.json"), "utf8"));

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const near = (a, b, tol, m) => {
  assert.ok(typeof a === "number" && Number.isFinite(a), `${m}: got ${a}`);
  assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (|diff| ${Math.abs(a - b)} > ${tol})`);
  n++;
};

const G = REF.garch;
const GARCH = Object.freeze({ status: "ok", omega: G.omega, alpha: G.alpha, beta: G.beta, nu: G.nu, lambda: G.lambda, sigma2Next: G.sigma2Next,
  avg21Vol: 34, nextVol: 37, persistence: G.alpha + G.beta, grade: 3, why: [], converged: true });
const PARAMS = Object.freeze({ omega: G.omega / 1e4, alpha: G.alpha, beta: G.beta, gamma: 0, nu: G.nu, lambda: G.lambda, sigma2Next: G.sigma2Next });
const CLOSES = (() => { const c = [100]; const rng = WORLD.xoshiro128ss("closes"); for (let i = 0; i < 150; i++) c.push(c[c.length - 1] * Math.exp(0.02 * WORLD.normalDraw(rng))); return c; })();
const S0 = 231.02;

function logSd(bins, S = 1) {
  const law = DENSITY.lawBinned({ S, edges: bins.edges, means: bins.means });
  const M = 200000;
  let s = 0, s2 = 0;
  for (let i = 0; i < M; i++) { const x = Math.log(DENSITY.lawQuantile(law, (i + 0.5) / M) / S); s += x; s2 += x * x; }
  const m = s / M;
  return Math.sqrt(s2 / M - m * m);
}

function skewedRows({ S = S0, r = 0.04, q = 0, asOfMs, expiry, atm = 0.42, rho = -0.3, b = 0.0055, sigma = 0.03, m = 0, lo, hi, step = 0.5, spreadRel = 0.02, floor = 0.005, types = ["C", "P"] }) {
  const T = TIME.yearFraction(asOfMs, expiry);
  const F = S * Math.exp((r - q) * T), D = Math.exp(-r * T);
  const svi = { b, rho, m, sigma };
  svi.a = atm * atm * T - b * (rho * (0 - m) + Math.sqrt(m * m + sigma * sigma));
  const rows = [];
  const from = lo === undefined ? Math.ceil(F * 0.86 / step) * step : lo, to = hi === undefined ? Math.floor(F * 1.14 / step) * step : hi;
  for (let K = from; K <= to + 1e-9; K = Math.round((K + step) * 1e6) / 1e6) {
    const vol = Math.sqrt(SMILE.sviW(svi, Math.log(K / F)) / T);
    for (const type of types) {
      const px = BS.black76(F, D, K, vol, T, type), hs = Math.max(floor, spreadRel * px);
      rows.push({ K, type, bid: Math.max(0.01, Math.round((px - hs) * 100) / 100), ask: Math.round((px + hs) * 100) / 100, oi: 3000, volume: 500,
        sym: "NVDA" + expiry.replace(/-/g, "").slice(2) + type + String(Math.round(K * 1000)).padStart(8, "0"), ivSeed: vol });
    }
  }
  return { rows, svi, T, F, D, vol: (K) => Math.sqrt(SMILE.sviW(svi, Math.log(K / F)) / T) };
}

{
  const et = (iso) => Date.parse(iso);
  near(TIME.remainingSessions(et("2026-09-30T13:35:00Z"), "2026-10-01"), 1 + 385 / 390, 1e-12, "09:35 ET the day before a Thursday expiry: 385 of 390 minutes of today plus the expiry session");
  near(TIME.remainingSessions(et("2026-09-30T13:30:00Z"), "2026-10-01"), 2, 1e-12, "at the 09:30 ET open the whole of today is still ahead");
  near(TIME.remainingSessions(et("2026-09-30T12:00:00Z"), "2026-10-01"), 2, 1e-12, "and before the open too");
  near(TIME.remainingSessions(et("2026-09-30T19:59:00Z"), "2026-10-01"), 1 + 1 / 390, 1e-12, "one minute before the close");
  eq(TIME.remainingSessions(et("2026-09-30T20:00:00Z"), "2026-10-01"), 1, "at the close exactly it is the integer session count");
  eq(TIME.remainingSessions(et("2026-09-30T23:00:00Z"), "2026-10-01"), 1, "after the close too");
  near(TIME.remainingSessions(et("2026-10-01T19:30:00Z"), "2026-10-01"), 30 / 390, 1e-12, "half an hour before the expiring close");
  near(TIME.remainingSessions(et("2025-11-28T17:00:00Z"), "2025-11-28"), 60 / 210, 1e-12, "on the 13:00 early close the session is 210 minutes long, so noon leaves 60 of 210");
  eq(TIME.remainingSessions(et("2026-10-03T15:00:00Z"), "2026-10-05"), 1, "on a Saturday nothing of today is left and Monday is one session");
  eq(TIME.remainingSessions(et("2026-09-07T15:00:00Z"), "2026-09-08"), 1, "on the Labor Day holiday likewise");
  eq(TIME.remainingSessions(et("2026-09-30T13:35:00Z"), "2026-09-29"), 0, "an expiry already gone has none");
  for (const day of ["2026-09-21", "2026-11-25", "2027-01-15"]) {
    const close = TIME.closeUtcMs(day);
    for (const exp of ["2026-12-18", "2027-03-19"]) {
      eq(TIME.remainingSessions(close, exp), TIME.sessionsBetween(day, exp), `a card struck at the ${day} close counts exactly the integer sessions to ${exp}`);
    }
  }
}

const analyticSd = (h) => {
  const phi = PARAMS.alpha + PARAMS.beta, L = PARAMS.omega / (1 - phi);
  return Math.sqrt((L + (PARAMS.sigma2Next - L) * (1 - Math.pow(phi, h)) / (h * (1 - phi))) * h);
};

{
  for (const h of [1, 2, 3, 5, 10, 21]) {
    const r = REF.lawRef.horizons[String(h)];
    near(analyticSd(h), r.sdSample, 0.003 * r.sdSample, `the closed-form GARCH aggregate sd at ${h} sessions equals the 2M-path scipy simulation's (${analyticSd(h).toFixed(5)} vs ${r.sdSample})`);
  }
  for (const c of REF.studentCdf) near(WORLD.studentCdf(c.t, c.nu), c.p, 1e-9, `Student t cdf(${c.t}; ${c.nu}) against scipy`);
  for (const c of REF.studentPpf) near(WORLD.studentLowerQuantile(c.p, c.nu) / c.q, 1, 1e-9, `Student t quantile(${c.p}; ${c.nu}) against scipy`);
  for (const c of REF.skewtPpf) near(WORLD.skewtQuantile(c.u, c.nu, c.lambda), c.z, 1e-8 * Math.max(1, Math.abs(c.z)), `Hansen skew-t quantile(${c.u}; ${c.nu}, ${c.lambda}) against the scipy construction`);
  for (const [nu, lambda] of [[5, -0.05], [8, 0.3], [3.5, -0.4]]) {
    const k = skewtConstants(nu, lambda);
    let worst = 0;
    for (const u of [0.001, 0.01, 0.1, 0.3, 0.5, 0.8, 0.99, 0.999]) {
      const z = WORLD.skewtQuantile(u, nu, lambda, k);
      let cdf = 0;
      const cut = -k.a / k.b;
      const f = (x) => WORLD.skewtDensity(x, nu, lambda);
      const lo = -60;
      const up = Math.min(z, cut);
      cdf += DENSITY.integrate(f, lo, up, 400, 16);
      if (z > cut) cdf += DENSITY.integrate(f, cut, z, 200, 16);
      worst = Math.max(worst, Math.abs(cdf - u));
    }
    ok(worst < 2e-4, `the skew-t quantile inverts the skew-t density's own cdf (nu ${nu}, lambda ${lambda}): worst gap ${worst.toExponential(2)}`);
  }
}

{
  const U = WORLD.sobolScrambled(1024, 2, "stratify");
  for (const [a, b] of [[10, 0], [5, 5], [3, 7], [7, 3], [0, 10]]) {
    const cells = new Map();
    for (let i = 0; i < 1024; i++) {
      const key = Math.floor(U[2 * i] * (1 << a)) + "," + Math.floor(U[2 * i + 1] * (1 << b));
      cells.set(key, (cells.get(key) || 0) + 1);
    }
    ok(cells.size === 1024 && [...cells.values()].every((v) => v === 1), `1,024 scrambled Sobol points fill every 2^${a} x 2^${b} box of the first two dimensions exactly once`);
  }
  const V = WORLD.sobolScrambled(4096, 10, "ten");
  for (let d = 0; d < 10; d++) {
    const seen = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) seen[Math.floor(V[i * 10 + d] * 4096)]++;
    ok(seen.every((v) => v === 1), `dimension ${d + 1} puts exactly one of 4,096 points in every stratum`);
  }
  let raised = false;
  try { WORLD.sobolScrambled(1000, 2, "x"); } catch { raised = true; }
  ok(raised, "and a count that is not a power of two is refused rather than silently unbalanced");
  const a = WORLD.simulateGjrQmc(PARAMS, { seed: "SYN|2026-09-29|q1", horizons: [1, 3, 10, 21], paths: 4096 });
  const b = WORLD.simulateGjrQmc(PARAMS, { seed: "SYN|2026-09-29|q1", horizons: [1, 3, 10, 21], paths: 4096 });
  const c = WORLD.simulateGjrQmc(PARAMS, { seed: "SYN|2026-09-30|q1", horizons: [1, 3, 10, 21], paths: 4096 });
  ok(Array.from(a[21]).every((x, i) => x === b[21][i]), "the low-discrepancy simulation reproduces itself path for path");
  ok(Array.from(c[21]).some((x, i) => x !== a[21][i]), "and another session draws another sample");
  const m1 = a[1].reduce((s, v) => s + v, 0) / a[1].length;
  const sd1 = Math.sqrt(a[1].reduce((s, v) => s + (v - m1) * (v - m1), 0) / a[1].length);
  near(sd1 / Math.sqrt(PARAMS.sigma2Next), 1, 0.003, "one session of stratified draws has the next-session sd to 0.3% at 4,096 paths");
  near(m1 / sd1, 0, 0.005, "and zero mean");
}

{
  const tickers = ["NVDA", "AAPL", "TSLA"];
  const tol = { 1: 0.003, 2: 0.003, 3: 0.003, 4: 0.003, 5: 0.003, 7: 0.005, 10: 0.005, 15: 0.005, 21: 0.005 };
  const worstSeen = {};
  for (const ticker of tickers) {
    const law = QP.garchLaw({ garch: GARCH, ticker, sessionDate: "2026-09-29", closes: CLOSES, rate: 0 });
    eq(law.knots.map((k) => k.h), [1, 2, 3, 5, 10, 21, 42, 63, 126], `${ticker}: the card law carries a knot at 1, 2 and 3 sessions as well as the long ones`);
    for (const k of law.knots) {
      near(logSd(k) / analyticSd(k.h), 1, 0.003, `${ticker}: the ${k.h}-session law's log-return sd matches the analytic GARCH aggregate to 0.3%`);
    }
    for (const h of Object.keys(tol).map(Number)) {
      const L = QC.lawAtSessions(law, { sessions: h, forwardOverSpot: 1, S: S0 });
      const r = REF.lawRef.horizons[String(h)];
      let worstCdf = 0, worstCall = 0;
      r.z.forEach((z, i) => {
        const k = z * r.sdAnalytic;
        worstCdf = Math.max(worstCdf, Math.abs(DENSITY.lawCdf(L, S0 * Math.exp(k)) - r.cdf[i]));
        worstCall = Math.max(worstCall, Math.abs(DENSITY.lawHinge(L, S0 * Math.exp(k)) / S0 - r.callOverSpot[i]));
      });
      worstSeen[h] = Math.max(worstSeen[h] || 0, worstCdf);
      ok(worstCdf <= tol[h], `${ticker}: the real-world cdf at ${h} sessions is within ${(100 * tol[h]).toFixed(1)}pp of the 2M-path scipy simulation over +-3 sd (worst ${(100 * worstCdf).toFixed(2)}pp)`);
      ok(worstCall <= 5e-4, `${ticker}: and a call on it is within 5bp of S (worst ${(1e4 * worstCall).toFixed(2)}bp)`);
    }
  }
  const noShort = QP.garchLaw({ garch: GARCH, ticker: "NVDA", sessionDate: "2026-09-29", closes: CLOSES, rate: 0, horizons: [5, 10, 21, 42, 63, 126] });
  const r1 = REF.lawRef.horizons["1"];
  let worstOld = 0;
  r1.z.forEach((z, i) => {
    const L = QC.lawAtSessions(noShort, { sessions: 1, forwardOverSpot: 1, S: S0 });
    worstOld = Math.max(worstOld, Math.abs(DENSITY.lawCdf(L, S0 * Math.exp(z * r1.sdAnalytic)) - r1.cdf[i]));
  });
  ok(worstOld > 0.008, `without knots at 1-3 sessions the one-session law is a power-scaled copy of the 5-session one and misses the reference by ${(100 * worstOld).toFixed(2)}pp`);
}

{
  const pLaw = QC.compactLaw(QP.garchLaw({ garch: GARCH, ticker: "NVDA", sessionDate: "2026-09-29", closes: CLOSES, rate: 0.04 }));
  const expiry = "2026-10-01";
  const put = { K: 225, type: "P", bid: 0.68, ask: 0.72, oi: 5000, volume: 900, sym: "NVDA261001P00225000", ivSeed: 0.5 };
  const price = (tape, row = put, exp = expiry, extra = {}) => {
    const asOfMs = Date.parse(tape);
    const fit = QC.contractFit({ expiry: exp, asOfMs, spot: S0, rate: 0.04, row });
    const setup = QC.labSetup({ asOfMs, spot: S0, facts: [], state: null, pLaw, event: null, stale: false, books: [{ fit, rows: [row] }], lawCache: new Map(), ...extra });
    const st = ENGINE.priceStructure(setup, { family: "short-put", expiry: exp, legs: [{ type: "P", K: row.K, side: -1, qty: 1 }], basis: "natural" });
    return { fit, setup, st };
  };
  const series = REF.intraday.cases.map((c) => ({ c, ...price(c.tape) }));
  for (const { c, fit, st } of series) {
    near(fit.hSessions, c.hEff, 1e-12, `${c.label} ET: the horizon is ${c.hEff.toFixed(4)} sessions (the part of today left plus the expiry session)`);
    near(st.prob.popP, c.popP, 0.003, `${c.label} ET: real-world POP ${st.prob.popP} against the 2M-path simulation's ${c.popP.toFixed(4)}`);
    near(st.ev.p, c.evP, 0.8, `${c.label} ET: real-world EV ${st.ev.p} against the simulation's ${c.evP.toFixed(2)} per contract`);
    eq(st.sessions, 1, `${c.label} ET: the integer session count is still 1`);
    near(st.hSessions, c.hEff, 1e-4, `${c.label} ET: and the structure reports its horizon`);
  }
  for (let i = 1; i < series.length; i++) {
    ok(series[i].st.prob.popP >= series[i - 1].st.prob.popP - 1e-9, `at a fixed quote the real-world POP does not fall as the session runs: ${series[i - 1].c.label} ${series[i - 1].st.prob.popP} -> ${series[i].c.label} ${series[i].st.prob.popP}`);
  }
  ok(series[0].st.prob.popP < series[series.length - 1].st.prob.popP - 0.05, "and the morning figure is at least five points below the evening one, which the old fixed one-session law could not show");
  for (const { c, setup } of series) {
    const front = setup.expiries.get(expiry);
    const main = setup.ctx.lawsOf(front, S0).main;
    const bins = { edges: main.edges.map((e) => (e === Infinity ? null : e)), means: main.means };
    near(logSd(bins) / analyticSd(c.hEff), 1, 0.01, `${c.label} ET: the real-world law's log-return sd is the analytic GARCH aggregate of ${c.hEff.toFixed(3)} sessions to 1%`);
  }
  for (const z of REF.intraday.zdte) {
    const row = { K: z.K, type: "P", bid: z.bid, ask: z.bid + 0.04, oi: 5000, volume: 900, sym: "NVDA261001P00226000", ivSeed: 0.5 };
    const r = price(z.tape, row);
    near(r.fit.hSessions, z.hEff, 1e-12, `0DTE at ${z.label}: ${z.hEff.toFixed(4)} of a session left`);
    near(r.st.prob.popP, z.popP, 0.004, `0DTE at ${z.label}: real-world POP ${r.st.prob.popP} against the simulation's ${z.popP.toFixed(4)}`);
    near(r.st.ev.p, z.evP, 0.8, `0DTE at ${z.label}: real-world EV ${r.st.ev.p} against ${z.evP.toFixed(2)}`);
  }
  const late = REF.intraday.zdte.find((z) => z.label === "zdte-15:30");
  ok(price(late.tape, { K: late.K, type: "P", bid: late.bid, ask: late.bid + 0.04, oi: 5000, volume: 900, sym: "x", ivSeed: 0.5 }).st.prob.popP >= 0.99, "an expiring put 2.2% out of the money with half an hour left holds at 99% or better, not the 85% of a full-session law");

  const day = "2026-09-30";
  for (const exp of ["2026-10-02", "2026-10-16", "2026-11-20"]) {
    const asOfMs = TIME.closeUtcMs(day);
    const fit = QC.contractFit({ expiry: exp, asOfMs, spot: S0, rate: 0.04, row: { ...put, K: 220, bid: 1.1, ask: 1.2 } });
    eq(fit.hSessions, fit.sessions, `a card struck at the close: the horizon to ${exp} is the integer ${fit.sessions}, so the nightly path is the one it was`);
  }
}

{
  const pLaw = QC.compactLaw(QP.garchLaw({ garch: GARCH, ticker: "NVDA", sessionDate: "2026-09-29", closes: CLOSES, rate: 0.04 }));
  const asOfMs = Date.parse("2026-09-30T15:30:00Z");
  const expiry = "2026-10-02";
  const chain = skewedRows({ asOfMs, expiry });
  const input = { ticker: "NVDA", asOfMs, spot: S0, rate: { r: 0.04, method: "constant", n: 0 }, expiries: [{ expiry, rows: chain.rows }], facts: [
    { id: "iv.pct.30", v: 0.82, u: "frac", g: 3 }, { id: "vrp.rel.21", v: 0.16, u: "frac", g: 3 },
    { id: "term.slope.30_90.exEvent", v: -0.02, u: "frac", g: 2 }, { id: "skew.rr25.30.pct", v: 0.62, u: "frac", g: 2 },
  ], state: { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich }, levels: { callWall: 240, putWall: 222, magnet: 231, flip: 228, atr: 5, maxPain: 231 }, pLaw, fits: true };
  const block = QC.runCardEngine(input);
  near(block.expiries[0].hSessions, 0.6923 + 2, 1e-4, "the card block carries the horizon beside the integer session count");
  eq(block.expiries[0].sessions, 2, "which stays an integer");
  near(block.fits[0].hSessions, 2 + 270 / 390, 1e-12, "and the fit the strategy page hands its client carries it at full precision");
  const setup = QC.labSetup({ asOfMs, spot: S0, facts: [], state: null, pLaw, books: [{ fit: block.fits[0], rows: chain.rows }], lawCache: new Map() });
  const idea = ENGINE.priceStructure(setup, { family: "short-put", expiry, legs: [{ type: "P", K: 225, side: -1, qty: 1 }], basis: "natural" });
  near(idea.hSessions, 2.6923, 1e-4, "every structure reports the horizon its real-world law was drawn at");
  const re = QC.repriceStructure({ engine: block, legs: idea.legs.map((l) => ({ type: l.type, K: l.k, side: l.side, qty: l.qty })), expiry: idea.expiry, cost: idea.price.fill });
  near(re.popP, idea.prob.popP, 2e-3, "the browser re-pricer reads the block's horizon, so its real-world POP is the engine's");
  const asSessions = QC.repriceStructure({ engine: { ...block, expiries: block.expiries.map((e) => ({ ...e, hSessions: undefined })) }, legs: idea.legs.map((l) => ({ type: l.type, K: l.k, side: l.side, qty: l.qty })), expiry: idea.expiry, cost: idea.price.fill });
  ok(asSessions.popP !== null && Math.abs(asSessions.popP - re.popP) > 1e-4, "while a block from before the horizon existed falls back to whole sessions and reads differently");
  const half = QC.lawAtSessions(pLaw, { sessions: 3, hSessions: 0.5, forwardOverSpot: 1, S: S0 });
  const half5 = QC.lawAtSessions(pLaw, { sessions: 3, forwardOverSpot: 1, S: S0 });
  ok(DENSITY.lawQuantile(half, 0.05) > DENSITY.lawQuantile(half5, 0.05), "half a session is a tighter law than the whole-session count it replaces");
  const bins = { edges: half.edges.map((e) => (e === Infinity ? null : e)), means: half.means };
  near(logSd(bins) / analyticSd(0.5), 1, 0.01, "with the analytic aggregate sd of half a session");
}

console.log(`✓ flows-quant-audit: ${n} assertions`);
