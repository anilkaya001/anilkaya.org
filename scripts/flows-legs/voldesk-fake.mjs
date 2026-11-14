import { touch } from "./taint.mjs";
import { forwardDelta } from "../../shared/flows-quant-bs.js";
import { sliceFromSummary, sliceVolK } from "../../shared/flows-quant-read.js";
import { parseSymbol } from "../../shared/flows-quant-card.js";
import { addDays } from "../../shared/flows-cross.js";
import { CORR_TICKERS, chooseExpiry, gammaSpot } from "../../shared/flows-voldesk.js";

function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const unit = (key) => (hash(key) / 4294967295) * 2 - 1;
const f = (x, d = 6) => Number(x).toFixed(d);

export function makeVoldeskFake({ sessionDate, cardOf, chainOf }) {
  touch("makeVoldeskFake");
  const S = sessionDate;
  const calls = [];
  const SHAPES = {
    SPY: (d) => 0.15 + 0.00012 * d,
    QQQ: (d) => 0.24 - 0.00015 * d,
    IWM: (d) => 0.21,
    DIA: (d) => (d > 120 ? null : 0.16 + 0.00005 * d),
  };

  const engineFor = (ticker) => {
    const card = cardOf(ticker);
    const engine = card && card.engine && Array.isArray(card.engine.expiries) ? card.engine : null;
    const chosen = engine ? chooseExpiry(engine.expiries) : null;
    const slice = chosen ? sliceFromSummary(chosen) : null;
    return engine && chosen && slice ? { engine, chosen, slice } : null;
  };

  const audit = (ticker, tail) => {
    const e = engineFor(ticker);
    if (!e) throw new Error(`${tail} -> HTTP 404`);
    const { engine, chosen, slice } = e;
    const chain = chainOf(ticker);
    const F = chosen.forward.F;
    const D = chosen.forward.D;
    const T = chosen.T;
    const spot = engine.spot;
    const rows = chain ? chain.rows.filter((r) => r.expiry === chosen.expiry) : [];
    const strikes = [...new Set(rows.map((r) => r.K))].sort((a, b) => a - b);
    const off = hash(ticker) % 9 === 0 ? 0.06 : 0;
    if (tail === "greeks") {
      return { data: strikes.map((K) => {
        const sigma = sliceVolK(slice, Math.log(K / F));
        const cd = forwardDelta(F, K, sigma, T, "C");
        const g = gammaSpot(F, D, spot, K, sigma, T);
        return {
          strike: f(K, 2), expiry: chosen.expiry, date: S,
          call_delta: f(cd + off + 0.005 * unit(ticker + K + "cd")), put_delta: f(cd - 1 + off),
          call_gamma: f(g * (1 + 0.02 * unit(ticker + K + "g")), 8), put_gamma: f(g, 8),
          call_volatility: f(sigma + 0.003 * unit(ticker + K + "v")), put_volatility: f(sigma + 0.003 * unit(ticker + K + "w")),
        };
      }) };
    }
    if (tail === "option-chains") {
      return { data: rows.slice(0, 400).map((r) => ({ option_symbol: r.symbol, strike: f(r.K, 2), expires: r.expiry, option_type: r.type === "C" ? "call" : "put", open_interest: r.oi })) };
    }
    if (tail === "atm-chains") {
      return { data: rows.filter((r) => Math.abs(r.K - F) <= (strikes[1] ? strikes[1] - strikes[0] : 1) * 1.5).map((r) => ({
        option_symbol: r.symbol, expiry: r.expiry, strike: f(r.K, 2), option_type: r.type === "C" ? "call" : "put", open_interest: r.oi, stock_price: f(spot, 4), volume: 100,
      })) };
    }
    if (tail === "oi-per-expiry") {
      const by = new Map();
      for (const r of chain ? chain.rows : []) {
        const cur = by.get(r.expiry) || { call_oi: 0, put_oi: 0 };
        if (r.type === "C") cur.call_oi += r.oi; else cur.put_oi += r.oi;
        by.set(r.expiry, cur);
      }
      return { data: [...by.entries()].map(([expiry, v]) => ({ date: S, expiry, ...v })) };
    }
    if (tail === "option/volume-oi-expiry") {
      const by = new Map();
      for (const r of chain ? chain.rows : []) by.set(r.expiry, (by.get(r.expiry) || 0) + r.oi);
      return { data: [...by.entries()].map(([expires, oi]) => ({ expires, oi, volume: 50 })) };
    }
    if (tail === "greek-exposure/strike-expiry") {
      return { data: strikes.map((K) => {
        const sigma = sliceVolK(slice, Math.log(K / F));
        const cd = forwardDelta(F, K, sigma, T, "C");
        const co = rows.filter((r) => r.K === K && r.type === "C").reduce((s, r) => s + r.oi, 0);
        const po = rows.filter((r) => r.K === K && r.type === "P").reduce((s, r) => s + r.oi, 0);
        return { strike: f(K, 2), expiry: chosen.expiry, call_delta: f(cd * co * 100, 2), put_delta: f((cd - 1) * po * 100, 2), call_gex: "0", put_gex: "0" };
      }) };
    }
    if (tail === "greek-exposure/strike") {
      const by = new Map();
      for (const x of engine.expiries) {
        const sl = sliceFromSummary(x);
        if (!sl) continue;
        for (const r of chain ? chain.rows : []) {
          if (r.expiry !== x.expiry) continue;
          const sigma = sliceVolK(sl, Math.log(r.K / x.forward.F));
          const g = gammaSpot(x.forward.F, x.forward.D, spot, r.K, sigma, x.T);
          if (g !== null) by.set(r.K, (by.get(r.K) || 0) + g * r.oi * 100);
        }
      }
      return { data: [...by.entries()].map(([K, v]) => ({ strike: f(K, 2), call_gex: f(v / 2, 4), put_gex: f(v / 2, 4), call_delta: "0", put_delta: "0" })) };
    }
    if (tail === "option-stance") {
      return { data: rows.slice(0, 6).map((r, i) => ({
        option_symbol: r.symbol, pop: f(0.5 + 0.02 * i, 4), delta: f(0.3, 4), iv: f(sliceVolK(slice, Math.log(r.K / F)), 4), dte: [5, 9, 12, 14, 15, 20][i],
        fit_score: f(4 - 0.2 * i, 3), expires: r.expiry, option_type: r.type === "C" ? "call" : "put", strike: f(r.K, 2),
      })) };
    }
    throw new Error(`${tail} -> HTTP 404`);
  };

  const vendor = async (path, _params = {}, { envelope = false } = {}) => {
    calls.push(path);
    const body = (() => {
      let m = /^\/api\/stock\/([^/]+)\/volatility\/term-structure$/.exec(path);
      if (m) {
        const shape = SHAPES[m[1]];
        if (!shape) throw new Error(`${path} -> HTTP 404`);
        return { data: [7, 14, 30, 60, 90, 180, 365].flatMap((d) => (shape(d) === null ? [] : [{ date: S, dte: d, expiry: addDays(S, d), ticker: m[1], volatility: f(shape(d)), implied_move: "1.0", implied_move_perc: "0.01" }])) };
      }
      m = /^\/api\/stock\/([^/]+)\/volatility\/realized$/.exec(path);
      if (m) {
        return { data: Array.from({ length: 30 }, (_, i) => {
          const day = addDays(S, -(29 - i));
          return { date: day, implied_volatility: f(0.18 + 0.01 * unit(m[1] + i)), realized_volatility: f(0.14 + 0.01 * unit(m[1] + "r" + i)), price: f(500 + i, 2), unshifted_rv_date: day };
        }) };
      }
      m = /^\/api\/stock\/([^/]+)\/volatility\/stats$/.exec(path);
      if (m) return { data: { ticker: m[1], date: S, iv: "0.1850", iv_high: "0.3000", iv_low: "0.1000", rv: "0.1400", iv_rank: "42.5", rv_high: "0.4", rv_low: "0.05" } };
      if (path === "/api/volatility/vix-term-structure") {
        return { data: { latest: [20, 48, 76].map((d, i) => ({ expiry: addDays(S, d), price: f(17.5 + 0.55 * i, 3), vix: "16.8" })), history: [] } };
      }
      if (path === "/api/volatility/character/top") {
        return { data: ["SYX301", "SYX302", "SYX303"].map((t, i) => ({ ticker: t, character: i === 1 ? "persistent" : "mean-reverting", half_life_days: f(2 + i, 4), hurst_rv: f(0.4 + 0.1 * i, 4), date: S })) };
      }
      if (path === "/api/market/correlations") {
        const out = [];
        CORR_TICKERS.forEach((a, i) => CORR_TICKERS.forEach((b, j) => {
          if (i === j) return;
          const lo = Math.min(i, j);
          const hi = Math.max(i, j);
          out.push({ fst: a, snd: b, correlation: f(0.3 + 0.4 * (0.5 + 0.5 * unit("c" + lo + ":" + hi)), 4), rows: 63, min_date: addDays(S, -91), max_date: S });
        }));
        return { data: out };
      }
      m = /^\/api\/stock\/([^/]+)\/(greeks|option-chains|atm-chains|oi-per-expiry|option\/volume-oi-expiry|greek-exposure\/strike-expiry|greek-exposure\/strike|option-stance)$/.exec(path);
      if (m) return audit(m[1], m[2]);
      throw new Error(`${path} -> HTTP 404`);
    })();
    if (envelope) return body;
    return Array.isArray(body) ? body : (body && body.data) || [];
  };
  vendor.calls = calls;
  return vendor;
}
