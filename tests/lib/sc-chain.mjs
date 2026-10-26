import { makeRng } from "../truth/rng.mjs";
import { black76 } from "../../shared/flows-quant-bs.js";
import { sviW } from "../../shared/flows-quant-smile.js";
import { closeUtcMs, isSession, shiftDay, etDayOf } from "../../shared/flows-quant-time.js";

export const SC_TICKER = "SYA101";

export function nextSessions(fromDay, count, maxDays = 400) {
  const out = [];
  let day = fromDay;
  for (let i = 0; i < maxDays && out.length < count; i++) {
    day = shiftDay(day, 1);
    if (isSession(day)) out.push(day);
  }
  return out;
}

export function symbolOf(ticker, expiry, type, strike) {
  return ticker + expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10) + type + String(Math.round(strike * 1000)).padStart(8, "0");
}

const tickOf = (price) => (price >= 3 ? 0.05 : 0.01);
const roundTo = (v, step) => Math.round(v / step + 1e-9) * step;

export function makeChain(seed, {
  ticker = SC_TICKER, spot = null, asOf = "2026-10-26", readMs = null, rate = 0.04, carry = null,
  rows = 4000, expiries = null, dense = 0.6, spreadRel = null, missingBid = 0.02, oiBase = 600, plant = false, shift = 0,
} = {}) {
  const rng = makeRng("sc-chain|" + seed);
  const S = spot === null ? Math.round((20 + rng.uniform() * 380) * 100) / 100 : spot;
  const q = carry === null ? Math.round(rng.uniform() * 0.03 * 1e4) / 1e4 : carry;
  const nExp = expiries ? expiries.length : Math.max(6, Math.min(90, Math.round(rows / 60)));
  let days = expiries;
  if (!days) {
    const all = nextSessions(asOf, 400);
    const picked = new Set();
    while (picked.size < nExp) picked.add(Math.min(all.length - 1, Math.floor(Math.pow(rng.uniform(), 1.7) * all.length)));
    days = Array.from(picked).sort((a, b) => a - b).map((i) => all[i]);
  }
  const t0 = readMs === null ? closeUtcMs(asOf) - 3.5 * 3600 * 1000 : readMs;
  const strikesPer = Math.max(4, Math.round(rows / (2 * days.length)));
  const step = S < 25 ? 0.5 : S < 100 ? 1 : S < 250 ? 2.5 : 5;
  const out = [];
  for (const expiry of days) {
    const T = (closeUtcMs(expiry) - t0) / (365 * 86400 * 1000);
    if (!(T > 0)) continue;
    const F = S * Math.exp((rate - q - shift) * T);
    const sigma0 = 0.18 + rng.uniform() * 0.5;
    const v0 = sigma0 * sigma0 * T;
    const svi = { a: v0 * 0.55, b: v0 * (0.45 / 0.6), rho: -0.65 + rng.uniform() * 0.5, m: 0, sigma: 0.08 + 0.5 * Math.sqrt(T) * 0.4 };
    const nDense = Math.round(strikesPer * dense);
    const strikes = new Set();
    const atm = Math.round(F / step) * step;
    for (let i = -Math.floor(nDense / 2); i <= Math.ceil(nDense / 2); i++) strikes.add(Math.round((atm + i * step) * 1000) / 1000);
    const sparse = strikesPer - nDense;
    for (let i = 1; i <= Math.ceil(sparse / 2); i++) {
      strikes.add(Math.round((atm + (Math.floor(nDense / 2) + i * 3) * step) * 1000) / 1000);
      strikes.add(Math.round((atm - (Math.floor(nDense / 2) + i * 3) * step) * 1000) / 1000);
    }
    for (const K of strikes) {
      if (!(K > 0)) continue;
      const k = Math.log(K / F);
      const w = sviW(svi, k);
      if (!(w > 0)) continue;
      const iv = Math.sqrt(w / T);
      for (const type of ["C", "P"]) {
        const price = black76(F, Math.exp(-rate * T), K, iv, T, type);
        const tick = tickOf(price);
        const rel = spreadRel === null ? 0.02 + rng.uniform() * 0.12 : spreadRel;
        const width = Math.max(tick, roundTo(price * rel, tick));
        let bid = Math.max(0, roundTo(price - width / 2, tick));
        if (rng.uniform() < missingBid) bid = 0;
        const ask = Math.max(bid + tick, roundTo(price + width / 2, tick));
        const oi = Math.max(0, Math.round(oiBase * Math.exp(-Math.abs(k) * 4) * (0.2 + rng.uniform() * 2)));
        out.push({
          option_symbol: symbolOf(ticker, expiry, type, K),
          nbbo_bid: bid.toFixed(2), nbbo_ask: ask.toFixed(2),
          implied_volatility: iv.toFixed(4), open_interest: String(oi), volume: String(Math.round(rng.uniform() * oi * 0.4)),
          prev_oi: String(Math.max(0, oi - Math.round(rng.uniform() * 40))),
        });
      }
    }
  }
  if (plant) {
    const rows0 = out.slice();
    const calls = rows0.filter((r) => /C\d{8}$/.test(r.option_symbol));
    const pick = () => calls[Math.floor(rng.uniform() * calls.length)];
    for (let i = 0; i < 6; i++) {
      const base = pick();
      if (!base) break;
      out.push({ ...base, nbbo_bid: (Number(base.nbbo_bid) * 0.9).toFixed(2), open_interest: String(Number(base.open_interest) + 3) });
    }
    out.push({ option_symbol: "JUNK", nbbo_bid: "1.00", nbbo_ask: "1.10", open_interest: "500" });
    out.push({ option_symbol: ticker + "1" + "261120C00100000", nbbo_bid: "1.00", nbbo_ask: "1.10", open_interest: "500" });
    out.push({ option_symbol: "ZZZ" + "261120C00100000", nbbo_bid: "1.00", nbbo_ask: "1.10", open_interest: "500" });
    for (let i = rng.int(out.length); i < out.length && rng.uniform() < 0.5; i++) out[i] = { ...out[i], nbbo_ask: "0.01" };
    for (let i = out.length - 1; i > 0; i--) { const j = rng.int(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  }
  return { ticker, spot: S, asOf, readMs: t0, rate, carry: q, rows: out, expiries: days };
}

export const dayOf = etDayOf;

export function regressionChain({ ticker = SC_TICKER, asOf = "2026-10-26", at = 1200 } = {}) {
  const S = 50, rate = 0.04;
  const readMs = closeUtcMs(asOf) - 3.5 * 3600 * 1000;
  const days = nextSessions(asOf, 400);
  const rows = [];
  const row = (expiry, type, K, bid, ask, oi) => ({
    option_symbol: symbolOf(ticker, expiry, type, K), nbbo_bid: bid.toFixed(2), nbbo_ask: ask.toFixed(2),
    implied_volatility: "0.7", open_interest: String(oi), volume: "10", prev_oi: String(oi),
  });
  for (let i = 0; i < 150; i++) {
    const expiry = days[Math.min(days.length - 1, 60 + i * 2)];
    const K = 50 + (i % 12);
    rows.push(row(expiry, "C", K, 1 + (i % 7) * 0.05, 1.05 + (i % 7) * 0.05, 300));
  }
  const filler = (n) => {
    for (let i = 0; i < n; i++) {
      const expiry = days[10 + (i % 40)];
      const K = 30 + (i % 41);
      rows.push(row(expiry, i % 2 ? "P" : "C", K, 0.5, 0.52, 10));
    }
  };
  filler(at - rows.length);
  rows.push(row("2026-10-30", "C", 54, 0.4, 0.44, 500));
  filler(200);
  return { ticker, spot: S, asOf, readMs, rate, carry: 0, rows, expiries: [], xSymbol: symbolOf(ticker, "2026-10-30", "C", 54) };
}

export function coherentRegression({ seed = 3, ticker = SC_TICKER, asOf = "2026-10-26", at = 1200, rows = 1500 } = {}) {
  const base = makeChain(seed, { ticker, spot: 50, asOf, rows, carry: 0.01 });
  const expiry = "2026-10-30";
  const x = {
    option_symbol: symbolOf(ticker, expiry, "C", 54), nbbo_bid: "0.40", nbbo_ask: "0.44",
    implied_volatility: "0.7", open_interest: "500", volume: "10", prev_oi: "500",
  };
  const list = base.rows.filter((r) => r.option_symbol !== x.option_symbol).slice(0, rows - 1);
  list.splice(at, 0, x);
  return { ...base, rows: list, xSymbol: x.option_symbol };
}
