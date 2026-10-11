import assert from "node:assert/strict";
import crypto from "node:crypto";
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

{
  const source = fs.readFileSync(path.join(ROOT, "tests/gen-quant-audit.py"), "utf8");
  const sha = crypto.createHash("sha256").update(source).digest("hex");
  eq(REF.generator.path, "tests/gen-quant-audit.py", "THE REFERENCE FIXTURE NAMES ITS GENERATOR");
  eq(REF.generator.sha256, sha, "and the generator on disk is the one that wrote it: if this fails, run python3 tests/gen-quant-audit.py (scipy and numpy of the versions the fixture records) and read the diff, or python3 tests/gen-quant-audit.py --check to see which numbers moved");
  const seed = /^SEED = (\d+)$/m.exec(source), paths = /^PATHS = ([\d_]+)$/m.exec(source);
  ok(seed && paths, "the generator states its seed and path count as plain constants");
  const drawn = Number(paths[1].replace(/_/g, ""));
  for (const text of [REF.lawRef.provenance, REF.intraday.provenance]) {
    ok(text.includes(`scipy ${REF.generator.scipy} numpy ${REF.generator.numpy}`), "each provenance string names the library versions the generator recorded");
    ok(text.includes(`seed ${seed[1]}`) || text.includes("seed " + seed[1]), "and the seed the generator uses");
    ok(text.includes(drawn.toLocaleString("en-US") + "-path"), "and its path count");
  }
  ok(!/^\s*#/m.test(source), "the generator carries no comments, like every other source file");
}

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
  near(TIME.remainingSessions(et("2026-03-06T15:00:00Z"), "2026-03-09"), 1 + 6 / 6.5, 1e-12, "10:00 EST on the Friday before the spring change: the session ends at 21:00 UTC, six of six and a half hours left, then Monday");
  near(TIME.remainingSessions(et("2026-03-09T14:00:00Z"), "2026-03-09"), 6 / 6.5, 1e-12, "and on the Monday after it 14:00 UTC is 10:00 EDT, with 6 of 6.5 hours left");
  near(TIME.remainingSessions(et("2026-11-02T15:00:00Z"), "2026-11-02"), 6 / 6.5, 1e-12, "as is 15:00 UTC on the Monday after the autumn change (EST again)");
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
  for (let i = 0; i < 10; i++) {
    for (let j = i + 1; j < 10; j++) {
      const cells = new Map();
      for (let p = 0; p < 4096; p++) {
        const key = Math.floor(V[p * 10 + i] * 64) * 64 + Math.floor(V[p * 10 + j] * 64);
        cells.set(key, (cells.get(key) || 0) + 1);
      }
      ok(Math.max(...cells.values()) <= 2 && cells.size >= 2048, `dimensions ${i + 1} and ${j + 1} put 4,096 points on the 64 x 64 grid with at most two to a cell (${cells.size} cells used)`);
    }
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
    { id: "iv.pctile.30.1y", v: 0.82, u: "frac", g: 3 }, { id: "vrp.rel.21", v: 0.16, u: "frac", g: 3 },
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


const b76 = (F, D, K, sig, T, type) => {
  const v = sig * Math.sqrt(T), d1 = (Math.log(F / K) + v * v / 2) / v, d2 = d1 - v;
  const N = (x) => BS.normCdf(x);
  return type === "C" ? D * (F * N(d1) - K * N(d2)) : D * (K * N(-d2) - F * N(-d1));
};

{
  const S = 100, r = 0.04, T = 30 / 365, sigma = 0.3, K = 105;
  for (const q of [0.01, 0.03, 0.05]) {
    const legs = [{ type: "S", side: "long", qty: 1 }, { type: "C", K, side: "short", qty: 1 }];
    const withDiv = ENGINE.structureMetrics({ S, r, q, T, flatVol: sigma, legs });
    near(withDiv.evQ, 0, 1e-8, `q ${q}: a covered call bought at model value has EV_Q = 0 once the stock leg collects its dividends`);
    const bare = ENGINE.structureMetrics({ S, r, q, T, flatVol: sigma, legs: [{ type: "S", side: "long", qty: 1, div: 0 }, legs[1]] });
    near(bare.evQ, -100 * S * (1 - Math.exp(-q * T)), 1e-8, `q ${q}: without them the same trade shows EV_Q = -100 S (1 - e^{-qT}) = ${(-100 * S * (1 - Math.exp(-q * T))).toFixed(2)}, the audit's number`);
    const F = S * Math.exp((r - q) * T), D = Math.exp(-r * T);
    const div = S * Math.exp(r * T) - F;
    let integral = 0;
    const N = 40000, lo = -9, hi = 9, dz = (hi - lo) / N;
    for (let i = 0; i < N; i++) {
      const z = lo + (i + 0.5) * dz;
      const ST = F * Math.exp(-sigma * sigma * T / 2 + sigma * Math.sqrt(T) * z);
      integral += (ST + div - Math.max(0, ST - K)) * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * dz;
    }
    const cost = S - b76(F, D, K, sigma, T, "C");
    near(D * integral - cost, 0, 1e-4, `q ${q}: and a brute-force quadrature of the payoff under the lognormal agrees that the trade is fair`);
    const collar = ENGINE.structureMetrics({ S, r, q, T, flatVol: sigma, legs: [{ type: "S", side: "long", qty: 1 }, { type: "P", K: 95, side: "long", qty: 1 }, legs[1]] });
    near(collar.evQ, 0, 1e-8, `q ${q}: and so does a collar`);
    near(withDiv.breakevens[0], cost - div, 1e-9, `q ${q}: the covered call's breakeven is its cost less the dividends it collects (${(cost - div).toFixed(4)})`);
  }
}


{
  const q = 0.03, r = 0.04;
  const closeMs = TIME.closeUtcMs("2026-09-30");
  const shape = { atm: 0.3, rho: -0.3, b: 0.02, sigma: 0.15, q, r, spreadRel: 0.01, floor: 0.01 };
  const expiries = ["2026-10-16", "2026-11-20"].map((expiry) => ({ expiry, rows: skewedRows({ ...shape, asOfMs: closeMs, expiry }).rows }));
  const { built } = QC.buildSlices(expiries, { spot: S0, asOfMs: closeMs, rate: r });
  ok(built.length === 2 && built.every((e) => e.hSessions === e.sessions && Number.isInteger(e.sessions)), "a chain struck at the close carries whole-session horizons, so the nightly card is priced exactly as it was");
  const facts = QC.engineFacts({ built, spot: S0, asOfDay: "2026-09-30" });
  const carry = facts.find((f) => f.id === "carry.implied");
  near(carry.v, q, 0.002, `the card measures the chain's dividend yield from parity: ${carry.v} against the ${q} the chain was priced with`);
  const tape = "2026-10-01T15:00:00Z", asOfMs = Date.parse(tape);
  const expiry = "2026-10-16";
  const T = TIME.yearFraction(asOfMs, expiry);
  const trueF = S0 * Math.exp((r - q) * T), D = Math.exp(-r * T);
  const K = 225;
  const truth = skewedRows({ ...shape, asOfMs, expiry, types: ["P", "C"] });
  const put = truth.rows.find((x) => x.K === K && x.type === "P");
  const call = truth.rows.find((x) => x.K === 240 && x.type === "C");
  const fitQ = QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, rateMethod: "parity:SPX", facts, row: put });
  const fit0 = QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: put });
  near(fitQ.forward.F / trueF, 1, 2e-5, `the desk's forward is the card's carry-implied forward (${fitQ.forward.F.toFixed(4)} against ${trueF.toFixed(4)})`);
  near(fit0.forward.F / trueF - 1, Math.exp(q * T) - 1, 2e-5, `and without the card's carry it sits ${(100 * (fit0.forward.F / trueF - 1)).toFixed(3)}% high, which is e^{qT} - 1 for a ${q} yield over ${(T * 365).toFixed(1)} days`);
  eq([fitQ.forward.rateMethod, fitQ.forward.carry, fit0.forward.carry], ["parity:SPX", "card", "none"], "the fit says where its rate and its carry came from");
  eq(QC.contractFit({ expiry, asOfMs, spot: S0, row: put }).forward.rateMethod, "fallback", "and says so when it fell back to the constant rate");
  eq(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: put }).forward.rateMethod, "given", "and when the caller supplied one");
  const setupOf = (fit, row) => QC.labSetup({ asOfMs, spot: S0, facts: [], state: null, pLaw: null, event: null, stale: false, books: [{ fit, rows: [row] }], lawCache: new Map() });
  const ivAt = (F, row) => {
    const mid = (row.bid + row.ask) / 2;
    let lo = 0.01, hi = 4;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (b76(F, D, row.K, m, T, row.type) < mid) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const truthPop = (F, row) => {
    const iv = ivAt(F, row), be = row.K - row.bid;
    const d2 = (Math.log(F / be) - iv * iv * T / 2) / (iv * Math.sqrt(T));
    return BS.normCdf(d2);
  };
  const shortPut = (fit) => ENGINE.priceStructure(setupOf(fit, put), { family: "short-put", expiry, legs: [{ type: "P", K, side: -1, qty: 1 }], basis: "natural" });
  const withCarry = shortPut(fitQ), without = shortPut(fit0);
  near(withCarry.prob.popQ, truthPop(trueF, put), 2e-4, `the desk's risk-neutral POP with the card's carry (${withCarry.prob.popQ}) is the flat-lognormal one at the true forward (${truthPop(trueF, put).toFixed(4)})`);
  ok(Math.abs(without.prob.popQ - truthPop(trueF, put)) > 1.5e-3, `while with q = 0 it is off by ${(100 * Math.abs(without.prob.popQ - truthPop(trueF, put))).toFixed(2)}pp`);
  eq([withCarry.carry.rateMethod, withCarry.carry.forward, without.carry.rateMethod], ["parity:SPX", "rate-only", "given"], "and every structure reports the rate and forward it was priced on");
  near(withCarry.carry.q, q, 0.002, "with the yield");
  eq(withCarry.world, { drift: "forward", premium: 0, exercise: "european", why: "model.none" }, "and states that its real-world figures are a forward-drifted law with no equity premium on European exercise, and why it has none when the card publishes no law");
  {
    const pLaw = QC.compactLaw(QP.garchLaw({ garch: GARCH, ticker: "SYN", sessionDate: "2026-09-30", closes: CLOSES, rate: r }));
    eq(pLaw.drift, "forward", "the published law carries the same statement");
    const setup = QC.labSetup({ asOfMs, spot: S0, facts: [], state: null, pLaw, event: null, stale: false, books: [{ fit: QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, facts, row: call }), rows: [call] }], lawCache: new Map() });
    const cc = ENGINE.priceStructure(setup, { family: "covered-call", expiry, legs: [{ type: "S", side: 1, qty: 1 }, { type: "C", K: 240, side: -1, qty: 1 }], basis: "mid" });
    near(cc.ev.q, 0, 0.02, `a covered call bought at the contract's own mid has EV_Q = ${cc.ev.q}: the stock leg collects the ${cc.carry.dividend} a share the forward already takes out of it`);
    near(cc.carry.dividend, S0 * Math.exp(r * T) - trueF, 5e-4, "the dividend credited is S e^{rT} - F");
    const ccBare = ENGINE.priceStructure(QC.labSetup({ asOfMs, spot: S0, facts: [], state: null, pLaw, event: null, stale: false, books: [{ fit: QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, facts, row: call }), rows: [call] }], lawCache: new Map() }),
      { family: "covered-call", expiry, legs: [{ type: "S", side: 1, qty: 1, div: 0 }, { type: "C", K: 240, side: -1, qty: 1 }], basis: "mid" });
    ok(ccBare.ev.q === 0 || Math.abs(ccBare.ev.q) < 0.02, "a leg that states its own zero dividend is left alone by the engine (the override is the caller's)");
  }
}

{
  const S = 100, r = 0.05, q = 0.03, days = 91, T = days / 365;
  const F = S * Math.exp((r - q) * T), D = Math.exp(-r * T), sigma = 0.32;
  const puts = [80, 85, 90, 95].map((K) => {
    const px = b76(F, D, K, sigma, T, "P");
    return { strike: K, type: "P", bid: Math.round((px - 0.02) * 100) / 100, ask: Math.round((px + 0.02) * 100) / 100, iv: sigma, expiry: "2027-01-01", days };
  });
  const good = QC.quoteImpliedVols(puts, { spot: S, rate: r, q });
  const stale = QC.quoteImpliedVols(puts, { spot: S });
  for (const row of good) near(row.iv, sigma, 0.004, `K ${row.strike}: with the rate and carry the chain was priced with, the quote inverts to ${row.iv} (truth ${sigma})`);
  ok(stale.every((row, i) => Math.abs(row.iv - sigma) > Math.abs(good[i].iv - sigma)), "and the constant-4%, zero-yield default is further out on every strike");
  eq([good[0].ivRate, stale[0].ivRate], [{ r, method: "given" }, { r: ENGINE.ENGINE_LINES.RATE_FALLBACK, method: "fallback" }], "each row says which rate it was inverted on");
}


{
  const r = 0.04, expiry = "2026-10-01";
  const pLaw = QC.compactLaw(QP.garchLaw({ garch: GARCH, ticker: "NVDA", sessionDate: "2026-09-29", closes: CLOSES, rate: r }));
  const asOfMs = Date.parse("2026-09-30T19:59:00Z");
  const shape = { atm: 0.42, rho: -0.3, b: 0.0055, sigma: 0.03, lo: 200, hi: 260, spreadRel: 0.02, floor: 0.005, r };
  const lab = skewedRows({ ...shape, asOfMs, expiry });
  const nightlyMs = TIME.closeUtcMs("2026-09-29");
  const nightly = skewedRows({ ...shape, asOfMs: nightlyMs, expiry, atm: 0.4 });
  const card = QC.runCardEngine({ ticker: "NVDA", asOfMs: nightlyMs, spot: 229.5, rate: { r, method: "parity:SPX", n: 3 }, expiries: [{ expiry, rows: nightly.rows }], facts: [], state: null, pLaw });
  ok(card.expiries.length === 1 && card.expiries[0].smile.method === "svi", "the nightly card fits a raw SVI smile to the chain a day earlier, at another level and another spot");
  const labExpiry = ENGINE.buildExpiry({ expiry, rows: lab.rows, spot: S0, asOfMs, rate: r, prev: null });
  const labSetup = ENGINE.setupEngine({ asOf: asOfMs, spot: S0, pLaw, facts: {}, state: null, levels: null, event: null, stale: false }, [labExpiry]);
  const deskSetup = (fit, row) => QC.labSetup({ asOfMs, spot: S0, facts: [], state: null, pLaw, event: null, stale: false, books: [{ fit, rows: [row] }], lawCache: new Map() });
  const T = TIME.yearFraction(asOfMs, expiry), F = S0 * Math.exp(r * T), D = Math.exp(-r * T);
  const truthSlice = { method: "svi", T, F, D, params: lab.svi };
  let worstFlat = 0, worstShaped = 0, worstFar = 0, worstEv = 0;
  const cases = [[215, "P"], [220, "P"], [225, "P"], [227.5, "P"], [235, "C"], [237.5, "C"], [240, "C"]];
  for (const [K, type] of cases) {
    const row = lab.rows.find((x) => x.K === K && x.type === type);
    const legs = type === "P" ? [{ type: "P", K, side: -1, qty: 1 }] : [{ type: "S", side: 1, qty: 1 }, { type: "C", K, side: -1, qty: 1 }];
    const family = type === "P" ? "short-put" : "covered-call";
    const labSt = ENGINE.priceStructure(labSetup, { family, expiry, legs, basis: "natural" });
    const flat = QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row });
    const shaped = QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row, expiries: card.expiries });
    const relabelled = QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row, expiries: card.expiries.map((e) => ({ ...e, expiry: "2026-10-02" })) });
    const deskFlat = ENGINE.priceStructure(deskSetup(flat, row), { family, expiry, legs, basis: "natural" });
    const deskShaped = ENGINE.priceStructure(deskSetup(shaped, row), { family, expiry, legs, basis: "natural" });
    const deskFar = ENGINE.priceStructure(deskSetup(relabelled, row), { family, expiry, legs, basis: "natural" });
    const be = deskShaped.breakevens[0];
    const cdf = DENSITY.riskNeutralCdf(truthSlice, be);
    const truth = 1 - cdf;
    near(deskShaped.prob.popQ, truth, 0.0045, `${K}${type}: the desk's risk-neutral POP on the card's smile shape (${deskShaped.prob.popQ}) is the Breeden-Litzenberger probability of the generating smile (${truth.toFixed(4)})`);
    worstFlat = Math.max(worstFlat, Math.abs(deskFlat.prob.popQ - truth));
    worstShaped = Math.max(worstShaped, Math.abs(deskShaped.prob.popQ - labSt.prob.popQ));
    worstFar = Math.max(worstFar, Math.abs(deskFar.prob.popQ - labSt.prob.popQ));
    worstEv = Math.max(worstEv, Math.abs(deskShaped.ev.q - labSt.ev.q));
    eq([shaped.slice.origin, shaped.slice.why, flat.slice.origin], ["card-shape", "fit.card-shape", "contract"], `${K}${type}: the fit names where its smile came from`);
    ok(shaped.slice.scale >= 0.25 && shaped.slice.scale <= 4, `${K}${type}: the shape is carried over by a bounded scale (${shaped.slice.scale.toFixed(3)})`);
  }
  ok(worstFlat > 0.02, `a flat lognormal at the contract's own IV misses the smile's probability by up to ${(100 * worstFlat).toFixed(2)}pp on this chain, which is what the desk showed`);
  ok(worstShaped < 0.005, `the shaped desk agrees with the full-chain lab to ${(100 * worstShaped).toFixed(2)}pp on every line`);
  ok(worstFar < 0.006, `and a card that lists a neighbouring expiry instead still does to ${(100 * worstFar).toFixed(2)}pp, the shape carried over in standardised moneyness`);
  ok(worstEv < 1.5, `with risk-neutral EV within $${worstEv.toFixed(2)} a contract of the lab's`);
  const row225 = lab.rows.find((x) => x.K === 225 && x.type === "P");
  const slim = card.expiries.map((e) => ({ expiry: e.expiry, T: e.T, smile: { method: e.smile.method, params: e.smile.params } }));
  eq(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: row225, expiries: slim }).slice.params, QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: row225, expiries: card.expiries }).slice.params,
    `the desk needs only {expiry, T, smile: {method, params}} from the card (${JSON.stringify(slim).length} bytes for this expiry), not the whole expiry summary`);
  eq(ENGINE.fitGrade(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: row225, expiries: card.expiries }).slice, true), { g: 2, why: "fit.card-shape" }, "a line on the card's shape with a tight quote grades 2");
  eq(ENGINE.fitGrade(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: { ...row225, bid: 0.3, ask: 0.9 }, expiries: card.expiries }).slice, true), { g: 1, why: "fit.contract-iv.wide" }, "and with a wide one grades 1, because the volatility the shape is levelled to is uncertain");
  eq(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: row225, expiries: card.expiries.map((e) => ({ ...e, expiry: "2026-10-02", T: e.T * 10 })) }).slice.origin, "contract", "a card whose nearest expiry is ten times further out gives no shape to carry, so the line falls back to the flat fit");
  eq(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: row225, expiries: card.expiries.map((e) => ({ ...e, smile: { ...e.smile, method: "mixture" } })) }).slice.origin, "contract", "and so does one whose smile is an event mixture");
}


{
  const r = 0.04, expiry = "2026-10-02", tape = "2026-09-29T19:00:00Z", asOfMs = Date.parse(tape);
  const T = TIME.yearFraction(asOfMs, expiry), D = Math.exp(-r * T), F = S0 / D;
  near(T * 365, 3.0417, 1e-3, "the probe expiry is 3.04 days out");
  near(S0 - 227.5 * D, 3.5958, 5e-4, "and the 227.5 call's discounted intrinsic floor is $3.5958, the audit's number");
  const floor = D * (F - 227.5);
  const call = (bid, ask, extra = {}) => ({ K: 227.5, type: "C", bid, ask, oi: 900, volume: 120, sym: "x", ivSeed: 0.3, ...extra });
  const table = [[3.50, 3.60, "iv.below-intrinsic"], [3.55, 3.65, "iv.below-intrinsic"], [3.60, 3.70, "iv.unbounded-below"], [3.65, 3.75, null], [3.70, 3.80, null]];
  for (const [bid, ask, code] of table) {
    const input = { expiry, asOfMs, spot: S0, rate: r, row: call(bid, ask) };
    const d = QC.contractDiagnosis(input);
    const fit = QC.contractFit(input);
    eq(d.code, code, `bid ${bid} / ask ${ask} against a floor of ${floor.toFixed(4)}: ${code || "an identified volatility"}`);
    if (code) {
      ok(fit === null && typeof d.text === "string" && d.text.includes("$" + floor.toFixed(2)) && d.text.length > 40, `the line is refused and says why in words: ${d.text}`);
      ok(QC.codeText(code) !== null && QC.QUANT_CODE_TEXT[code] === QC.codeText(code), "and the code has a glossary entry");
    } else {
      ok(fit !== null, "a bid clear of the floor gives a fit");
      ok(fit.slice.contract.ivWidth > 0.15 * fit.slice.contract.iv, `but a bid this close to the floor reads a volatility of ${(100 * fit.slice.params.sigma).toFixed(1)}% good to only ${(100 * fit.slice.contract.ivWidth).toFixed(1)} vol points, over a seventh of itself`);
      const g = ENGINE.fitGrade(fit.slice, true);
      eq([g.g, g.why], [1, "fit.contract-iv.wide"], "which the fit grade says: grade 1, wide");
    }
  }
  near(QC.contractDiagnosis({ expiry, asOfMs, spot: S0, rate: r, row: call(3.65, 3.75) }).floor, floor, 1e-9, "the diagnosis reports the floor it used");
  eq(QC.contractDiagnosis({ expiry, asOfMs, spot: S0, rate: r, row: call(0, 0.1) }).code, "quote.one-sided", "a zero bid has no volatility either");
  eq(QC.contractDiagnosis({ expiry: "2026-09-01", asOfMs, spot: S0, rate: r, row: call(1, 1.1) }).code, "expired", "and an expired contract says so");
  eq(QC.contractDiagnosis({ expiry, asOfMs, spot: 0, rate: r, row: call(1, 1.1) }).code, "spot.missing", "as does a missing spot");
  {
    const sigma = 0.25, K = 225;
    const tv = b76(F, D, K, sigma, T, "P");
    const putQuote = { bid: Math.round((tv - 0.01) * 100) / 100, ask: Math.round((tv + 0.01) * 100) / 100 };
    const c = tv + D * (F - K);
    const row = { K, type: "C", bid: Math.round((c - 0.3) * 100) / 100, ask: Math.round((c + 0.3) * 100) / 100, oi: 900, volume: 120, sym: "x", ivSeed: 0.3 };
    ok(row.bid - D * (F - K) < 0.025, `an in-the-money call whose ${(row.ask - row.bid).toFixed(2)} spread is wider than its ${tv.toFixed(2)} of time value has a bid ${(row.bid - D * (F - K)).toFixed(3)} over its floor`);
    eq(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row }), null, "so its own quote gives no volatility");
    const via = QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: { ...row, opposite: putQuote } });
    near(via.slice.params.sigma, sigma, 0.004, `but the out-of-the-money put at the same strike does: ${via.slice.params.sigma.toFixed(4)} against the ${sigma} the chain was priced with`);
    eq(via.slice.contract.via, "opposite", "and the fit says it read the other side");
    const otm = QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: { K: 235, type: "C", bid: 0.4, ask: 0.5, oi: 1, volume: 1, sym: "x", ivSeed: 0.3, opposite: { bid: 3, ask: 3.2 } } });
    eq(otm.slice.contract.via, "own", "an out-of-the-money line keeps reading its own quote even when the other side is handed over");
    const underIntrinsic = { ...row, bid: 5.95, ask: 6.25, opposite: putQuote };
    const setup = QC.labSetup({ asOfMs, spot: S0, facts: [], state: null, pLaw: null, event: null, stale: false, books: [{ fit: QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: underIntrinsic }), rows: [underIntrinsic] }], lawCache: new Map() });
    const cc = ENGINE.priceStructure(setup, { family: "covered-call", expiry, legs: [{ type: "S", side: 1, qty: 1 }, { type: "C", K, side: -1, qty: 1 }], basis: "natural" });
    const leg = cc.legs.find((l) => l.type === "C");
    near(leg.intrinsic, S0 - K, 1e-4, "a covered call reports the intrinsic value of its short call");
    ok(leg.timeValue < 0, `and the time value of a bid of 5.95 against ${leg.intrinsic.toFixed(2)} of intrinsic is negative (${leg.timeValue}), so the premium holds no time value and the page must not say it includes intrinsic value`);
  }
}

{
  const S = S0, r = 0.04, expiry = "2026-10-30", asOfMs = TIME.closeUtcMs("2026-09-30");
  const T = TIME.yearFraction(asOfMs, expiry), F = S * Math.exp(r * T), D = Math.exp(-r * T);
  const sessions = TIME.sessionsBetween("2026-09-30", expiry);
  const vol = 0.34, K = 210;
  const knots = [1, 2, 3, 5, 10, 21, 42, 63, 126].map((h) => ({ h, ...DENSITY.binnedFromLognormal({ sigma: vol, T: h / 252, forwardOverSpot: 1 }) }));
  const pLaw = { model: "ewma", grade: 1, why: ["model.ewma"], knots, params: null, ewmaVol: vol, coneMedianVol: null, vol };
  const px = b76(F, D, K, 0.53, T, "P");
  const row = { K, type: "P", bid: Math.round((px - 0.05) * 100) / 100, ask: Math.round((px + 0.05) * 100) / 100, oi: 4000, volume: 800, sym: "x", ivSeed: 0.5 };
  const fit = QC.contractFit({ expiry, asOfMs, spot: S, rate: r, row });
  const moves = [0.08, -0.11, 0.05, -0.06, 0.13, -0.09, 0.07, -0.04, 0.1, -0.12, 0.06, -0.08];
  const event = { date: "2026-10-15", confirmed: true, moves, jq: 0.07, realizedOverImplied: 1 };
  const price = (extra) => ENGINE.priceStructure(QC.labSetup({ asOfMs, spot: S, facts: [], state: null, pLaw, event: extra.event || null, stale: false, books: [{ fit, rows: [row] }], lawCache: new Map(), crossesEarnings: extra.crosses }),
    { family: "short-put", expiry, legs: [{ type: "P", K, side: -1, qty: 1 }], basis: "natural" });
  const plain = price({ crosses: false }), unknown = price({ crosses: null }), flagged = price({ crosses: true }), withEvent = price({ crosses: true, event });
  ok(plain.prob.popP > 0.8 && plain.ev.p > 0, `without a report the real-world figures read ${plain.prob.popP} and $${plain.ev.p}`);
  eq([unknown.prob.popP, unknown.ev.p], [plain.prob.popP, plain.ev.p], "a flag that is unknown (an ETF, an ambiguous report day) leaves them alone");
  eq([flagged.prob.popP, flagged.ev.p, flagged.ev.edge, flagged.grade, flagged.world.why], [null, null, null, 0, "world.event-missing"], "a row flagged as crossing earnings with no report in the card publishes no real-world figure, grade 0, and the code");
  ok(flagged.gradeWhy.includes("world.event-missing") && QC.codeText("world.event-missing").length > 40, "the code is in the grade's reasons and has its sentence");
  eq(flagged.prob.popQ, plain.prob.popQ, "the risk-neutral side is untouched");
  ok(withEvent.prob.popP !== null && withEvent.grade >= 1, "with the report in the card the same row prices again");
  const mulberry = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rng = mulberry(20260930);
  const N = 1500000, sd = vol * Math.sqrt(sessions / 252), jumps = moves.flatMap((m) => [Math.log(1 + Math.abs(m)), -Math.log(1 + Math.abs(m))]);
  const xs = new Float64Array(N);
  let sumExp = 0;
  for (let i = 0; i < N; i++) {
    const u1 = rng() || 1e-12, u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const x = sd * z + jumps[Math.floor(rng() * jumps.length)];
    xs[i] = x; sumExp += Math.exp(x);
  }
  const shift = Math.log(F / S) - Math.log(sumExp / N);
  let payoff = 0, win = 0;
  const be = K - row.bid;
  for (let i = 0; i < N; i++) { const ST = S * Math.exp(xs[i] + shift); payoff += Math.max(0, K - ST); if (ST > be) win++; }
  const evRef = 100 * (row.bid - D * payoff / N), popRef = win / N;
  near(withEvent.ev.p, evRef, 2.5, `with the report, real-world EV $${withEvent.ev.p} is an independent ${N / 1e6}M-draw simulation's $${evRef.toFixed(2)} (lognormal at ${vol} plus the ${jumps.length} signed historical jumps, drift-neutral)`);
  near(withEvent.prob.popP, popRef, 0.004, `and POP ${withEvent.prob.popP} is its ${popRef.toFixed(4)}`);
  ok(plain.ev.p > 1.3 * withEvent.ev.p, `the report costs the short put ${(100 * (1 - withEvent.ev.p / plain.ev.p)).toFixed(0)}% of the EV a report-free law shows ($${plain.ev.p} against $${withEvent.ev.p})`);
}

{
  eq(ENGINE.eventGrade(null, "svi", 0), { g: 3, why: null }, "no event inside the life: nothing to grade");
  eq(ENGINE.eventGrade({ inside: true }, "mixture", 12), { g: 3, why: null }, "twelve moves and a slice that prices the event: full marks");
  eq(ENGINE.eventGrade({ inside: true }, "svi", 12), { g: 2, why: "event.smooth-slice" }, "twelve moves on a smooth slice are graded 2 for the slice, not blamed on a shortage of moves");
  eq(ENGINE.eventGrade({ inside: true }, "svi", 6), { g: 2, why: "event.smooth-slice" }, "and the boundary of six is the same");
  eq(ENGINE.eventGrade({ inside: true }, "mixture", 4), { g: 2, why: "event.few-moves" }, "four moves are few");
  eq(ENGINE.eventGrade({ inside: true }, "mixture", 1), { g: 1, why: "event.q-equals-p" }, "one move leaves P equal to Q");
  const rows = [[225, "P"], [227.5, "P"], [235, "C"], [237.5, "C"], [240, "C"], [215, "P"]];
  const r = 0.04, expiry = "2026-10-01", asOfMs = Date.parse("2026-09-30T19:59:00Z");
  const chain = skewedRows({ atm: 0.42, rho: -0.3, b: 0.0055, sigma: 0.03, lo: 200, hi: 260, spreadRel: 0.02, floor: 0.005, r, asOfMs, expiry });
  const grades = rows.map(([K, type]) => {
    const row = chain.rows.find((x) => x.K === K && x.type === type);
    return { K, ...ENGINE.fitGrade(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row }).slice, true) };
  });
  eq(new Set(grades.map((g) => g.g)).size, 2, `the desk's fit grade is not the constant 1 it was: ${grades.map((g) => g.K + "->" + g.g + " " + g.why).join(", ")}`);
  const wide = { ...chain.rows.find((x) => x.K === 225 && x.type === "P"), bid: 0.3, ask: 0.9 };
  eq(ENGINE.fitGrade(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: wide }).slice, true).why, "fit.contract-iv.wide", "a wide quote grades 1 for its width");
  const tight = chain.rows.find((x) => x.K === 235 && x.type === "C");
  eq(ENGINE.fitGrade(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: tight }).slice, true), { g: 2, why: "fit.contract-iv" }, "a tight quote near the money grades 2");
  eq(ENGINE.fitGrade(QC.contractFit({ expiry, asOfMs, spot: S0, rate: r, row: chain.rows.find((x) => x.K === 222.5 && x.type === "P") }).slice, true).why, "fit.contract-iv.far", "and a tight one far out grades 1 for its distance");
}

{
  const S = 100, r = 0.03, sigma = 0.4;
  const asOfMs = Date.parse("2026-09-30T14:00:00Z");
  const expiry = "2026-10-01";
  const T = TIME.yearFraction(asOfMs, expiry);
  near(T * 365, (Date.parse("2026-10-01T20:00:00Z") - asOfMs) / 86400000, 1e-9, "10:00 New York the day before an expiry, the option has 1.25 days left, not 1");
  const F = S * Math.exp(r * T), D = Math.exp(-r * T);
  const puts = [98, 99, 100].map((K) => {
    const px = b76(F, D, K, sigma, T, "P");
    return { strike: K, type: "P", bid: Math.round((px - 0.01) * 100) / 100, ask: Math.round((px + 0.01) * 100) / 100, iv: sigma, expiry, days: 1 };
  });
  const exact = QC.quoteImpliedVols(puts, { spot: S, rate: r, asOfMs });
  const whole = QC.quoteImpliedVols(puts, { spot: S, rate: r });
  for (let i = 0; i < puts.length; i++) {
    near(exact[i].iv, sigma, 0.01, `K ${puts[i].strike}: with the clock the quote inverts to ${exact[i].iv} (truth ${sigma})`);
    ok(Math.abs(whole[i].iv - sigma) > 0.04, `and on whole days it reads ${whole[i].iv}, ${(100 * Math.abs(whole[i].iv - sigma)).toFixed(1)} vol points off`);
  }
  ok(!TIME.isSession("2025-01-09") && TIME.sessionsBetween("2025-01-08", "2025-01-10") === 1, "9 January 2025, the national day of mourning, is a closed day");
  for (const day of ["2001-09-11", "2001-09-14", "2004-06-11", "2007-01-02", "2012-10-29", "2012-10-30", "2018-12-05"]) ok(!TIME.isSession(day), `${day} was an unscheduled NYSE closure`);
  ok(TIME.isSession("2025-01-10") && TIME.isSession("2018-12-06"), "and the day after each is a session");
  const sources = fs.readdirSync(path.join(ROOT, "shared")).filter((f) => f.startsWith("flows-quant-")).map((f) => fs.readFileSync(path.join(ROOT, "shared", f), "utf8"));
  eq(sources.filter((t) => /function aggregatedSd\w*\(/.test(t)).length, 0, "no quant module carries its own copy of the aggregate sd");
  ok(WORLD.aggregatedSd === DENSITY.garchAggregatedSd, "the world module re-exports the one in the density module");
  const block = QC.runCardEngine({ ticker: "SYN", asOfMs, spot: S, rate: { r, method: "constant", n: 0 }, expiries: [{ expiry, rows: skewedRows({ S, r, asOfMs, expiry, atm: 0.4, lo: 80, hi: 120, step: 1 }).rows }], facts: [], state: null });
  eq(block.assumptions, { exercise: "european", carry: "continuous", drift: "forward", equityPremium: 0, intraday: "time-uniform" }, "the card block states its modelling assumptions as data: European exercise, continuous carry, a forward-drifted real-world law with no equity premium, and variance spread evenly over the session for the part of today still to come");
}

console.log(`✓ flows-quant-audit: ${n} assertions`);
