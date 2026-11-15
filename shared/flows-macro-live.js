import { unwrap } from "./flows-vendor-core.js";
import { instantOf } from "./flows-time.js";
import { fixtureNameIn } from "./flows-fixture-names.js";
import { num, int, dateOf, zonedInstant, largePrints, barsOf, FX_PAIRS, PRODUCTS } from "./flows-macro.js";

export const MACRO_LIVE_CALLS = Object.freeze({ board: 18, futures: 3, crypto: 4, fx: 1 });
export const MACRO_LIVE_TTL_S = 300;
export const BOARD_FUTURES = Object.freeze(["ES", "NQ", "RTY", "YM", "ZN", "CL", "GC"]);
export const BOARD_CRYPTO = Object.freeze(["BTC-USD", "ETH-USD", "SOL-USD"]);
export const LIVE_PARTS = Object.freeze(["board", "futures", "crypto", "fx"]);

const fail = (res) => ({ status: res && res.status ? res.status : "failed", ...(res && res.why ? { why: res.why } : {}) });

export function fxRate(res) {
  if (!res || res.status !== "ok") return fail(res);
  const b = unwrap(res.body);
  if (!b || typeof b !== "object") return { status: "withheld", why: "shape" };
  const rate = num(b.rate);
  if (rate === null) return { status: "withheld", why: "type:rate" };
  const z = zonedInstant(b.last_refreshed, typeof b.time_zone === "string" ? b.time_zone : null);
  return { status: "ok", rate, bid: num(b.bid), ask: num(b.ask), at: z.at, ...(z.why === "zone" ? { why: "zone" } : {}) };
}

export function cryptoState(res) {
  if (!res || res.status !== "ok") return fail(res);
  const b = unwrap(res.body);
  if (!b || typeof b !== "object") return { status: "withheld", why: "shape" };
  const close = num(b.close_24h);
  const open = num(b.open_24h);
  if (close === null) return { status: "withheld", why: "type:close_24h" };
  const t = instantOf(b.timestamp);
  return {
    status: "ok", close, open, high: num(b.high_24h), low: num(b.low_24h), volume: num(b.volume_24h),
    at: t === null ? null : new Date(t).toISOString(),
    chg24: open !== null && open !== 0 ? close / open - 1 : null,
  };
}

export function futuresStat(res, sym) {
  if (!res || res.status !== "ok") return { sym, ...fail(res) };
  const b = unwrap(res.body);
  if (!b || typeof b !== "object") return { sym, status: "withheld", why: "shape" };
  const settlement = num(b.settlement);
  if (settlement === null) return { sym, status: "withheld", why: "type:settlement" };
  return { sym, status: "ok", settlement, settlementDate: dateOf(b.settlement_date), oi: int(b.open_interest), volume: int(b.session_volume) };
}

export function candles5m(res) {
  if (!res || res.status !== "ok") return [];
  const rows = unwrap(res.body);
  const out = [];
  for (const c of Array.isArray(rows) ? rows : []) {
    if (!c) continue;
    const t = instantOf(c.end);
    const o = num(c.o); const h = num(c.h); const l = num(c.l); const cl = num(c.c);
    if (t === null || cl === null) continue;
    out.push([new Date(t).toISOString(), o, h, l, cl, int(c.v)]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out.slice(-96);
}

export function ohlc5m(res) {
  if (!res || res.status !== "ok") return [];
  const rows = unwrap(res.body);
  const out = [];
  for (const c of Array.isArray(rows) ? rows : []) {
    if (!c) continue;
    const t = instantOf(c.start_time || c.timestamp);
    const cl = num(c.close);
    if (t === null || cl === null) continue;
    out.push([new Date(t).toISOString(), cl]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out.slice(-288);
}

export function whalesOf(res) {
  if (!res || res.status !== "ok") return { status: res && res.status ? res.status : "failed", ...(res && res.why ? { why: res.why } : {}) };
  const rows = unwrap(res.body);
  const buy = [0, 0];
  const sell = [0, 0];
  const pairs = new Map();
  let from = null;
  let to = null;
  let nullValue = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const at = instantOf(r.whaled_at);
    const side = r.side === "buy" ? buy : r.side === "sell" ? sell : null;
    if (at === null || !side) continue;
    const iso = new Date(at).toISOString();
    if (from === null || iso < from) from = iso;
    if (to === null || iso > to) to = iso;
    const total = num(r.total);
    side[0]++;
    if (total === null) { nullValue++; continue; }
    side[1] += total;
    const p = typeof r.pair === "string" ? r.pair : "other";
    const slot = pairs.get(p) || [0, 0];
    if (side === buy) slot[0] += total; else slot[1] += total;
    pairs.set(p, slot);
  }
  return { status: "ok", window: from && to ? [from, to] : null, buy, sell, nullValue, byPair: [...pairs.entries()].map(([p, v]) => [p, v[0], v[1]]).sort((a, b) => b[1] + b[2] - a[1] - a[2]) };
}

export function transfersOf(res) {
  if (!res || res.status !== "ok") return { status: res && res.status ? res.status : "failed", ...(res && res.why ? { why: res.why } : {}) };
  const rows = unwrap(res.body);
  let n = 0;
  let usd = 0;
  let nullValue = 0;
  let from = null;
  let to = null;
  const types = new Map();
  const chains = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const at = instantOf(r.timestamp);
    if (at === null) continue;
    const iso = new Date(at).toISOString();
    if (from === null || iso < from) from = iso;
    if (to === null || iso > to) to = iso;
    n++;
    const v = num(r.usd_value);
    if (v === null) { nullValue++; continue; }
    usd += v;
    const bump = (m, k) => { const s = m.get(k) || [0, 0]; s[0]++; s[1] += v; m.set(k, s); };
    bump(types, typeof r.transaction_type === "string" ? r.transaction_type : "other");
    bump(chains, typeof r.blockchain === "string" ? r.blockchain : "other");
  }
  const fold = (m) => [...m.entries()].map(([k, v]) => [k, v[0], v[1]]).sort((a, b) => b[2] - a[2]);
  return { status: "ok", window: from && to ? [from, to] : null, n, usd, nullValue, byType: fold(types), byChain: fold(chains) };
}

export function intradayPoints(res) {
  if (!res || res.status !== "ok") return { status: res && res.status ? res.status : "failed", bars: [], timeZone: null };
  const b = barsOf(res.body);
  if (b.status !== "ok") return { status: "withheld", why: b.why, bars: [], timeZone: b.zone };
  const bars = b.timed.filter((t) => t[0]).map((t) => [t[0], t[2]]).slice(-60);
  return { status: bars.length ? "ok" : "withheld", ...(bars.length ? {} : { why: "zone" }), bars, timeZone: b.zone };
}

export function buildLive(part, raws, ctx) {
  const readAt = new Date(ctx.now).toISOString();
  let body;
  if (part === "board") {
    const fx = {};
    for (const p of FX_PAIRS) fx[p] = fxRate(raws.fx && raws.fx[p]);
    const crypto = {};
    for (const p of BOARD_CRYPTO) crypto[p] = cryptoState(raws.crypto && raws.crypto[p]);
    const futures = {};
    for (const p of BOARD_FUTURES) {
      const sym = ctx.symbols && ctx.symbols[p];
      futures[p] = sym ? futuresStat(raws.futures && raws.futures[p], sym) : { sym: null, status: "withheld", why: "no-symbols" };
    }
    body = { v: 1, part, readAt, fx, crypto, futures };
  } else if (part === "futures") {
    const flow = largePrints([raws.flow && raws.flow.status === "ok" ? raws.flow.body : null].filter(Boolean));
    const trades = raws.trades && raws.trades.status === "ok" ? largePrints([raws.trades.body]) : null;
    const es = trades && trades.byProduct ? { sym: ctx.symbols && ctx.symbols.ES, window: trades.window, ...(trades.byProduct.ES || { buy: [0, 0], sell: [0, 0], none: [0, 0], crossed: [0, 0] }) } : null;
    body = { v: 1, part, readAt, window: flow.window, byProduct: flow.byProduct, es, candles: candles5m(raws.candles) };
  } else if (part === "crypto") {
    const btc = ohlc5m(raws.ohlc);
    const digital = raws.digital && raws.digital.status === "ok" ? barsOf(raws.digital.body) : null;
    let check = { v: "nc", gap: null, at: null };
    if (digital && digital.status === "ok" && btc.length) {
      const lastD = digital.timed.filter((t) => t[0]).slice(-1)[0];
      if (lastD) check = { v: Math.abs(lastD[2] / btc[btc.length - 1][1] - 1) <= 0.005 ? "agree" : "differs", gap: Math.abs(lastD[2] / btc[btc.length - 1][1] - 1), at: lastD[0] };
    }
    body = { v: 1, part, readAt, btc5m: btc, intradayCheck: check, whales: whalesOf(raws.whales), transfers: transfersOf(raws.transfers) };
  } else if (part === "fx") {
    const s = intradayPoints(raws.intraday);
    body = { v: 1, part, readAt, pair: ctx.pair, ...s };
  } else {
    throw new Error("part " + String(part));
  }
  const bad = fixtureNameIn(JSON.stringify(body));
  if (bad && !ctx.test) throw new Error("fixture name " + bad);
  return body;
}

export { PRODUCTS };
