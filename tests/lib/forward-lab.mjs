import { makeRng } from "../truth/rng.mjs";
import { black76, impliedVolB76, forwardDelta } from "../../shared/flows-quant-bs.js";
import * as FWD from "../../shared/flows-quant-forward.js";
import { bracketBook } from "../../shared/flows-quant-bracket.js";
import { americanCRR } from "./crr.mjs";

export const GATE_SPREAD = 0.15;
export const RATE = 0.04;
export const SPOT = 100;
export const CARD_YIELD = 0.015;
export const DTES = [
  { id: "0dte", T: 3 / (24 * 365), step: 0.25 },
  { id: "1d", T: 1 / 365, step: 0.5 },
  { id: "2d", T: 2 / 365, step: 0.5 },
  { id: "7d", T: 7 / 365, step: 1 },
  { id: "30d", T: 30 / 365, step: 2.5 },
];
export const LIQUIDITY = {
  liquid: { tick: 0.01, rel: 0.02, abs: 0.005, minTicks: 1, missing: 0 },
  illiquid: { tick: 0.05, rel: 0.08, abs: 0.02, minTicks: 1, missing: 0.25 },
};
export const REGIMES = ["normal", "hard-to-borrow", "special-dividend", "american-dividend"];

const BORROW = 0.30;
const SPECIAL = 0.02;
const ORDINARY = 0.01;

function worldOf(rng, dte, regime) {
  const T = dte.T;
  const sigma = 0.18 + rng.uniform() * 0.4;
  const skew = -(0.04 + 0.06 * rng.uniform());
  const curve = 0.005 + 0.01 * rng.uniform();
  let qTrue = CARD_YIELD, qCard = CARD_YIELD, div = null, borrow = 0, american = false;
  if (regime === "hard-to-borrow") borrow = BORROW;
  if (regime === "special-dividend") div = { t: 0.5 * T, amount: SPECIAL * SPOT };
  if (regime === "american-dividend") { div = { t: 0.6 * T, amount: ORDINARY * SPOT }; qTrue = 0; american = true; }
  const pv = div ? div.amount * Math.exp(-RATE * div.t) : 0;
  const F = (SPOT - pv) * Math.exp((RATE - qTrue - borrow) * T);
  const D = Math.exp(-RATE * T);
  const vol = (K) => {
    if (american) return sigma;
    const x = Math.log(K / F) / (sigma * Math.sqrt(T));
    const c = Math.max(-4, Math.min(4, x));
    return sigma * (1 + skew * c + curve * c * c);
  };
  return { T, D, F, sigma, vol, div, qCard, american };
}

export function quotesOf(rng, world, liq, steps) {
  const { T, D, F, vol, div, american } = world;
  const m = Math.max(0.03, 4 * world.sigma * Math.sqrt(T));
  const lo = Math.ceil(F * Math.exp(-m) / liq.step) * liq.step, hi = Math.floor(F * Math.exp(m) / liq.step) * liq.step;
  const price = (K, type) => {
    if (world.american) return americanCRR({ S: SPOT, K, r: RATE, sigma: world.sigma, T, type, div, steps, american: true });
    return black76(F, D, K, vol(K), T, type);
  };
  const quote = (P) => {
    const tick = liq.tick;
    const w = Math.max(liq.minTicks * tick, liq.rel * P + liq.abs);
    const u = rng.uniform();
    if (liq.missing > 0 && rng.uniform() < liq.missing) return { bid: 0, ask: Math.ceil((P + w * 2) / tick - 1e-9) * tick };
    const bid = Math.max(0, Math.floor((P - w * u) / tick + 1e-9) * tick);
    const ask = Math.max(bid + tick, Math.ceil((P + w * (1 - u)) / tick - 1e-9) * tick);
    return { bid: +bid.toFixed(4), ask: +ask.toFixed(4) };
  };
  const quotes = [];
  for (let K = lo; K <= hi + 1e-9; K += liq.step) {
    const c = quote(price(K, "C")), p = quote(price(K, "P"));
    quotes.push({ K: +K.toFixed(4), cb: c.bid, ca: c.ask, pb: p.bid, pa: p.ask, putRow: null });
  }
  return quotes;
}

const pct = (a, b) => (b === 0 ? null : a / b);

export function runCell({ dte, liquidity, regime, trials, seed, steps = 120, impl = FWD, onTrial = null }) {
  const liq = { ...LIQUIDITY[liquidity], step: dte.step };
  const acc = {
    dte: dte.id, liquidity, regime, trials, src: { carry: 0, blend: 0, parity: 0 }, vetoed: 0, covered: 0, coveredQualified: 0, qualified: 0,
    errChosen: [], errCarry: [], plain: { n: 0, ok: 0 }, pm: { n: 0, ok: 0 }, dash: 0, rows: 0, bracket: { n: 0, ok: 0, calls: { n: 0, ok: 0 }, puts: { n: 0, ok: 0 } },
    coveredCarry: 0, withPairs: { plain: { n: 0, ok: 0 }, pm: { n: 0, ok: 0 } }, trialsWithPairs: 0,
  };
  for (let t = 0; t < trials; t++) {
    const rng = makeRng(`forward-lab|${dte.id}|${liquidity}|${regime}|${seed}|${t}`);
    const world = worldOf(rng, dte, regime);
    const quotes = quotesOf(rng, world, liq, steps);
    const rec = impl.chooseForward({ quotes, S: SPOT, r: RATE, T: world.T, q: world.qCard });
    if (onTrial) onTrial(rec, world, quotes);
    if (rec.n >= FWD.FWD_LINES.MIN_PAIRS) acc.trialsWithPairs++;
    acc.src[rec.src]++;
    if (rec.veto) acc.vetoed++;
    const carry = impl.carryOf({ S: SPOT, r: RATE, T: world.T, q: world.qCard });
    const eC = Math.abs(carry.F - world.F), eF = Math.abs(rec.F - world.F);
    acc.errChosen.push(eF / world.F);
    acc.errCarry.push(eC / world.F);
    if (eF <= 1.96 * rec.se) acc.covered++;
    if (eC <= 1.96 * carry.se) acc.coveredCarry++;
    if (rec.src !== "carry") { acc.qualified++; if (eF <= 1.96 * rec.se) acc.coveredQualified++; }
    for (const q of quotes) {
      const held = q.K >= rec.F ? "C" : "P";
      const bid = held === "C" ? q.cb : q.pb, ask = held === "C" ? q.ca : q.pa;
      if (!(bid > 0) || !(ask >= bid) || (ask - bid) / ((ask + bid) / 2) > GATE_SPREAD) continue;
      const trueDelta = forwardDelta(world.F, q.K, world.vol(q.K), world.T, "C");
      if (!(trueDelta >= 0.05 && trueDelta <= 0.95)) continue;
      const iv = impliedVolB76(rec.F, world.D, q.K, world.T, (bid + ask) / 2, held, null);
      if (!(iv > 0)) continue;
      const delta = forwardDelta(rec.F, q.K, iv, world.T, "C");
      const band = impl.deltaBand({ F: rec.F, se: rec.se, K: q.K, sigma: iv, T: world.T, held, veto: rec.veto });
      const err = Math.abs(delta - trueDelta);
      acc.rows++;
      const solid = rec.n >= FWD.FWD_LINES.MIN_PAIRS;
      if (band.band === "plain") { acc.plain.n++; const hit = err <= 0.02 + 1e-12; if (hit) acc.plain.ok++; if (solid) { acc.withPairs.plain.n++; if (hit) acc.withPairs.plain.ok++; } }
      else if (band.band === "pm") { acc.pm.n++; const hit = err <= band.half + 1e-12; if (hit) acc.pm.ok++; if (solid) { acc.withPairs.pm.n++; if (hit) acc.withPairs.pm.ok++; } }
      else acc.dash++;
    }
    {
      const book = bracketBook(quotes, rec.F);
      const h = 1e-3;
      const callPrice = (K) => black76(world.F, world.D, K, world.vol(K), world.T, "C");
      const putPrice = (K) => black76(world.F, world.D, K, world.vol(K), world.T, "P");
      const s = world.sigma * Math.sqrt(world.T);
      for (const k of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
        const B = world.F * Math.exp(k * s);
        const got = book(B);
        if (!got) continue;
        let truth;
        if (got.side === "C") truth = -(callPrice(B * (1 + h)) - callPrice(B * (1 - h))) / (2 * B * h);
        else truth = (putPrice(B * (1 + h)) - putPrice(B * (1 - h))) / (2 * B * h);
        if (world.american) {
          const am = (type, K) => americanCRR({ S: SPOT, K, r: RATE, sigma: world.sigma, T: world.T, type, div: world.div, steps, american: false });
          truth = got.side === "C" ? -(am("C", B * (1 + h)) - am("C", B * (1 - h))) / (2 * B * h) : (am("P", B * (1 + h)) - am("P", B * (1 - h))) / (2 * B * h);
        }
        const inside = (got.lo === null || truth >= got.lo - 1e-9) && (got.hi === null || truth <= got.hi + 1e-9);
        acc.bracket.n++;
        if (inside) acc.bracket.ok++;
        const side = got.side === "C" ? acc.bracket.calls : acc.bracket.puts;
        side.n++;
        if (inside) side.ok++;
      }
    }
  }
  return acc;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(acc) {
  const n = acc.trials;
  return {
    cell: `${acc.dte}/${acc.liquidity}/${acc.regime}`,
    n,
    parity: pct(acc.src.parity + acc.src.blend, n),
    parityOnly: pct(acc.src.parity, n),
    vetoed: pct(acc.vetoed, n),
    coverage: pct(acc.covered, n),
    coverageQualified: pct(acc.coveredQualified, acc.qualified),
    coverageCarry: pct(acc.coveredCarry, n),
    medianErrBp: median(acc.errChosen) * 1e4,
    medianCarryErrBp: median(acc.errCarry) * 1e4,
    plain: pct(acc.plain.ok, acc.plain.n),
    plainN: acc.plain.n,
    pm: pct(acc.pm.ok, acc.pm.n),
    pmN: acc.pm.n,
    dashShare: pct(acc.dash, acc.rows),
    rows: acc.rows,
    bracket: pct(acc.bracket.ok, acc.bracket.n),
    bracketN: acc.bracket.n,
    plainWithPairs: pct(acc.withPairs.plain.ok, acc.withPairs.plain.n),
    plainWithPairsN: acc.withPairs.plain.n,
    pmWithPairs: pct(acc.withPairs.pm.ok, acc.withPairs.pm.n),
    pmWithPairsN: acc.withPairs.pm.n,
    trialsWithPairs: acc.trialsWithPairs,
    bracketCalls: pct(acc.bracket.calls.ok, acc.bracket.calls.n),
    bracketPuts: pct(acc.bracket.puts.ok, acc.bracket.puts.n),
  };
}
