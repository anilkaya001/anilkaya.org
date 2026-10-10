import * as BS from "../shared/flows-quant-bs.js";
import * as SMILE from "../shared/flows-quant-smile.js";
import * as WORLD from "../shared/flows-quant-world.js";
import * as TIME from "../shared/flows-quant-time.js";
import * as QC from "../shared/flows-quant-card.js";
import * as QP from "../scripts/flows-quant-pipeline.mjs";
import { fitGarch, skewtConstants } from "../shared/flows-garch.js";
import { STATE_STRUCTURES } from "../shared/flows-neuron.js";

const SESSION = "2026-09-21", SPOT = 100, R = 0.04;
const AS_OF_MS = TIME.closeUtcMs(SESSION);
const SVI = { a: 0.006, b: 0.06, rho: -0.55, m: 0.02, sigma: 0.12 };
const code = (day) => day.slice(2).replace(/-/g, "");
const seeds = Number(process.argv[2]) || 12;
const paths = Number(process.argv[3]) || 8192;
const lengths = (process.argv[4] || "252,750").split(",").map(Number);

function chain() {
  const rng = WORLD.xoshiro128ss("eval");
  const rows = [];
  for (const expiry of ["2026-10-02", "2026-10-16", "2026-10-23", "2026-11-20", "2026-12-18"]) {
    const T = TIME.yearFraction(AS_OF_MS, expiry);
    const F = SPOT * Math.exp(R * T), D = Math.exp(-R * T);
    const scale = Math.sqrt(T / (32 / 365));
    for (let K = 70; K <= 130 + 1e-9; K += 2.5) {
      const k = Math.log(K / F);
      const svi = { ...SVI, a: SVI.a * scale * scale, b: SVI.b * scale * scale };
      const vol = Math.sqrt(SMILE.sviW(svi, k) / T);
      for (const type of ["C", "P"]) {
        const price = BS.black76(F, D, K, vol, T, type);
        const half = Math.max(0.01, 0.012 * price);
        const mid = price + (rng.uniform() - 0.5) * half;
        const bid = Math.max(0, Math.round((mid - half) * 100) / 100), ask = Math.round((mid + half) * 100) / 100 + 0.01;
        const otm = type === "C" ? K >= SPOT : K <= SPOT;
        const oi = Math.round((otm ? 5000 : 1800) * Math.exp(-Math.abs(k) / 0.1)) + 50;
        rows.push({ option_symbol: "SYN" + code(expiry) + type + String(Math.round(K * 1000)).padStart(8, "0"),
          nbbo_bid: String(bid), nbbo_ask: String(ask), implied_volatility: String(vol), open_interest: oi, volume: Math.round(oi / 7),
          last_tape_time: "2026-09-21T19:58:00Z" });
      }
    }
  }
  return rows;
}

function history(N, nu, seedKey) {
  let state = (seedKey * 7919 + 17) | 0;
  const u = () => { state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
  const gam = (a) => { if (a < 1) return gam(a + 1) * Math.pow(u(), 1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const w = u(); if (w < 1 - 0.0331 * x ** 4 || Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
  const lambda = -0.05, { a, b } = skewtConstants(nu, lambda);
  const draw = () => { const y = Math.abs(normal() / Math.sqrt(2 * gam(nu / 2) / nu)) * Math.sqrt((nu - 2) / nu); return u() < (1 - lambda) / 2 ? (-(1 - lambda) * y - a) / b : ((1 + lambda) * y - a) / b; };
  let s2 = 0.05 / 0.03;
  const px = [100], dates = ["2000-01-01"];
  for (let t = 0; t < N; t++) { const e = Math.sqrt(s2) * draw(); px.push(px[px.length - 1] * Math.exp(e / 100)); s2 = 0.05 + 0.08 * e * e + 0.89 * s2; dates.push(new Date(Date.UTC(2000, 0, 2 + t)).toISOString().slice(0, 10)); }
  return { px, dates };
}

const vchain = QC.chainRowsByExpiry(chain(), { ticker: "SYN", sessionDate: SESSION });
const slices = QC.buildSlices(vchain.expiries, { spot: SPOT, asOfMs: AS_OF_MS, rate: R });
const RATE = { r: R, method: "constant", n: 0 };
const levels = { callWall: 105, putWall: 95, magnet: 100, flip: 99, maxPain: 100, atr: 2 };
const STATES = ["pinned", "bull", "bear"].filter((s) => STATE_STRUCTURES[s]);

const quantile = (xs, q) => { const v = xs.slice().sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(q * v.length))]; };
const summary = (xs) => xs.length ? `n ${xs.length}, median ${quantile(xs, 0.5).toFixed(4)}, p5 ${quantile(xs, 0.05).toFixed(4)}, p95 ${quantile(xs, 0.95).toFixed(4)}` : "n 0";

function run(garch, closes, stateName, seedKey) {
  const law = QP.garchLaw({ garch, ticker: "SYN" + seedKey, sessionDate: SESSION, closes, rate: R, paths });
  const state = { state: stateName, direction: null, confidence: 2, ...STATE_STRUCTURES[stateName].rich };
  const block = QC.runCardEngine({ ticker: "SYN", asOfMs: AS_OF_MS, spot: SPOT, rate: RATE, expiries: slices.input, facts: [], state,
    pLaw: law, levels, atr: 2, publishLaw: false });
  return block;
}

for (const N of lengths) for (const nu of [3.5, 4, 5, 8]) {
  const dPop = [], dEv = [], dNu = [];
  let cards = 0, topChanged = 0, setChanged = 0, orderChanged = 0;
  for (let s = 0; s < seeds; s++) {
    const { px, dates } = history(N, nu, s + 1);
    const oldFit = fitGarch(px, dates, { winsorK: 6 });
    const newFit = fitGarch(px, dates);
    if (oldFit.status !== "ok" || newFit.status !== "ok") continue;
    dNu.push(newFit.nu - oldFit.nu);
    for (const st of STATES) {
      const a = run(oldFit, px, st, s), b = run(newFit, px, st, s);
      const byId = new Map(a.structures.map((x) => [x.id, x]));
      for (const x of b.structures) {
        const y = byId.get(x.id);
        if (!y || !x.prob || !y.prob || typeof x.prob.popP !== "number" || typeof y.prob.popP !== "number") continue;
        dPop.push(x.prob.popP - y.prob.popP);
        if (x.ev && y.ev && typeof x.ev.p === "number" && typeof y.ev.p === "number") dEv.push(x.ev.p - y.ev.p);
      }
      cards++;
      if (JSON.stringify(a.ideas) !== JSON.stringify(b.ideas)) orderChanged++;
      if (a.ideas[0] !== b.ideas[0]) topChanged++;
      if (JSON.stringify([...a.ideas].sort()) !== JSON.stringify([...b.ideas].sort())) setChanged++;
    }
  }
  console.log(`true nu ${nu}, ${N} returns: histories ${seeds}, engine runs ${cards}`);
  console.log(`  fitted nu, new minus old: ${summary(dNu)}`);
  console.log(`  dpopP (probability of profit, new minus old): ${summary(dPop)}`);
  console.log(`  devP (dollars per lot): ${summary(dEv)}`);
  console.log(`  ideas: order changed ${orderChanged}, first idea changed ${topChanged}, set of ideas changed ${setChanged}`);
}
