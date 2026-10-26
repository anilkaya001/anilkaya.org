import {
  DEFAULT_GATES, SC_DEFAULTS, numOrNull, parseOptionSymbol, optionRoot, daysToExpiry, gateOf, impossibleQuote,
  shortCallLine, priceSale, attachMidIv, ivConvention, ivSurface,
} from "./flows-premium.js";
import { leanFrame, leanRead, leanDelta } from "./flows-quant-card.js";
import { cardCarry } from "./flows-quant-engine.js";
import { chooseForward, deltaBand, quotesByExpiry, forwardRecord, exFrame } from "./flows-quant-forward.js";
import { dividendOutlook } from "./flows-vendor-extras.js";
import { closeUtcMs } from "./flows-quant-time.js";
import { bracketBook } from "./flows-quant-bracket.js";
import { RANK_BUCKETS, bucketOf, lineCompare } from "./flows-quant-rank.js";

export const RANK_K = 25;
export const RANK_CAP = 480;
export const RANK_IN_CAP = 12000;
export const RANK_CONVENTIONS = Object.freeze([["shares", 1], ["delta", 2], ["regt", 4]]);
export const RANK_PK = Object.freeze({ shares: 1, delta: 2, regt: 4 });

const BR_DP = 1e6;
const round6 = (v) => (v === null || v === undefined ? null : Math.round(v * BR_DP) / BR_DP);
const fin = (v) => typeof v === "number" && Number.isFinite(v);

function better(a, b) {
  const na = (v) => (fin(v) ? v : -Infinity);
  if (na(a.bid) !== na(b.bid)) return na(a.bid) > na(b.bid);
  if (na(a.ask) !== na(b.ask)) return na(a.ask) > na(b.ask);
  if (na(a.oi) !== na(b.oi)) return na(a.oi) > na(b.oi);
  if (na(a.volume) !== na(b.volume)) return na(a.volume) > na(b.volume);
  return JSON.stringify(a.raw) < JSON.stringify(b.raw);
}

export function leanRows(raw, ticker) {
  const want = optionRoot(ticker) || null;
  const bySymbol = new Map();
  const shed = { parse: 0, root: 0 };
  let dups = 0;
  for (const r of Array.isArray(raw) ? raw : []) {
    const sym = r && typeof r.option_symbol === "string" ? r.option_symbol : null;
    const p = sym === null ? null : parseOptionSymbol(sym);
    if (p === null) { shed.parse++; continue; }
    if (want !== null && p.ticker !== want) { shed.root++; continue; }
    const lean = {
      symbol: sym, expiry: p.expiry, type: p.type, strike: p.strike,
      bid: numOrNull(r.nbbo_bid), ask: numOrNull(r.nbbo_ask), oi: numOrNull(r.open_interest), volume: numOrNull(r.volume), raw: r,
    };
    const held = bySymbol.get(sym);
    if (held === undefined) { bySymbol.set(sym, lean); continue; }
    dups++;
    if (better(lean, held)) bySymbol.set(sym, lean);
  }
  return { rows: Array.from(bySymbol.values()), shed, dups };
}

export function eligibleCall(c, g, { spot }) {
  if (c.type !== "C") return "strategy";
  if (!fin(c.bid) || !(c.bid > 0) || !fin(c.ask) || !(c.ask >= c.bid)) return "unpriceable";
  if (impossibleQuote("C", spot, c.strike, c.ask)) return "offMarket";
  const mid = (c.bid + c.ask) / 2;
  return gateOf({ days: c.days, premium: c.bid * 100, oi: c.oi, spread: mid > 0 ? (c.ask - c.bid) / mid : null }, g);
}

export function preRank({ raw, ticker, spot, readMs, asOfDay, rate, rateMethod = null, facts = [], terms, k = RANK_K, cap = RANK_CAP, gates = {}, dividends = null }) {
  const g = { ...DEFAULT_GATES, ...gates };
  const { rows, shed, dups } = leanRows(raw, ticker);
  const quotes = quotesByExpiry(rows);
  const q = cardCarry(facts);
  const days = new Map();
  const dayOf = (expiry) => {
    if (!days.has(expiry)) days.set(expiry, daysToExpiry(expiry, asOfDay));
    return days.get(expiry);
  };
  const gated = { unpriceable: 0, nonStandard: shed.root, offMarket: 0, spread: 0, openInterest: 0, premium: 0, expiry: 0, strategy: 0 };
  let nCalls = 0;
  const cands = [];
  for (const c of rows) {
    if (c.type === "P") { gated.strategy++; continue; }
    nCalls++;
    c.days = dayOf(c.expiry);
    const why = c.days === null ? "unpriceable" : eligibleCall(c, g, { spot });
    if (why !== null) { gated[why]++; continue; }
    c.bucket = bucketOf(c.days);
    cands.push(c);
  }
  gated.unpriceable += shed.parse;
  const exOf = (expiry) => {
    if (!dividends) return null;
    const outlook = dividendOutlook({ x: dividends.x, expiry, today: asOfDay, ageDays: dividends.ageDays });
    return exFrame(outlook, { readMs, expiryMs: closeUtcMs(expiry) });
  };
  const fwdBy = new Map();
  const frameBy = new Map();
  const needed = new Set(cands.map((c) => c.expiry));
  const frameInput = (expiry) => ({ expiry, asOfMs: readMs, spot, rate, rateMethod, facts });
  for (const expiry of Array.from(needed).sort()) {
    const input = frameInput(expiry);
    const base = leanFrame(input);
    if (base.bad) { frameBy.set(expiry, base); continue; }
    const rec = chooseForward({ quotes: quotes.get(expiry), S: spot, r: base.r, T: base.T, q, ex: exOf(expiry) });
    fwdBy.set(expiry, rec);
    frameBy.set(expiry, leanFrame({ ...input, fwd: rec }));
  }
  const keyed = [];
  const hit = { shares: 0, delta: 0, regt: 0 };
  const dShed = { noDelta: 0, dash: 0, exercise: 0 };
  const strikesQuote = new Map();
  for (const [expiry, list] of quotes) strikesQuote.set(expiry, new Map(list.map((x) => [x.K, x])));
  for (const c of cands) {
    const frame = frameBy.get(c.expiry);
    const line = { bid: c.bid, strike: c.strike };
    const base = { spot, days: c.days, haircut: terms.h, floor: terms.f };
    const keys = { shares: null, delta: null, regt: null };
    keys.shares = shortCallLine(line, { ...base, convention: "shares" }).annRatio;
    keys.regt = shortCallLine(line, { ...base, convention: "regt" }).annRatio;
    c.delta = null;
    c.band = null;
    if (frame && !frame.bad) {
      const qt = strikesQuote.get(c.expiry).get(c.strike);
      const opposite = qt && fin(qt.pb) && fin(qt.pa) ? { bid: qt.pb, ask: qt.pa } : null;
      const read = leanRead(frame, { K: c.strike, type: "C", bid: c.bid, ask: c.ask, ivSeed: null, opposite });
      if (read) {
        const rec = fwdBy.get(c.expiry);
        c.band = deltaBand({ F: frame.F, se: rec.se, K: c.strike, sigma: read.iv, T: frame.T, held: read.via === "own" ? "C" : "P", veto: rec.veto, capPm: rec.cap === true, exercise: fin(rec.exK) && c.strike <= rec.exK });
        if (c.band.band !== "dash") {
          c.delta = leanDelta(frame, c.strike, read.iv);
          keys.delta = shortCallLine(line, { ...base, convention: "delta", delta: c.delta }).annRatio;
        } else if (c.band.reason === "exercise") dShed.exercise++;
        else dShed.dash++;
      }
    }
    if (keys.delta === null && c.band === null) dShed.noDelta++;
    for (const [name] of RANK_CONVENTIONS) if (keys[name] !== null) hit[name]++;
    keyed.push({ c, keys });
  }
  const lists = [];
  for (const [name, bit] of RANK_CONVENTIONS) {
    for (let b = 0; b < RANK_BUCKETS.length; b++) {
      const list = [];
      for (const { c, keys } of keyed) if (c.bucket === b && keys[name] !== null) list.push({ key: keys[name], oi: c.oi, strike: c.strike, expiry: c.expiry, symbol: c.symbol, c });
      list.sort(lineCompare);
      lists.push({ bit, list });
    }
  }
  const pick = (kk) => {
    const out = new Map();
    for (const { bit, list } of lists) for (const e of list.slice(0, kk)) {
      const held = out.get(e.symbol);
      out.set(e.symbol, { c: e.c, pk: (held ? held.pk : 0) | bit });
    }
    return out;
  };
  let kEff = k;
  let chosen = pick(kEff);
  if (chosen.size > cap) {
    let lo = 0, hi = k;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pick(mid).size <= cap) lo = mid; else hi = mid - 1;
    }
    kEff = lo;
    chosen = pick(kEff);
  }
  const picks = Array.from(chosen.values()).sort((a, b) =>
    (a.c.expiry < b.c.expiry ? -1 : a.c.expiry > b.c.expiry ? 1 : 0) || a.c.strike - b.c.strike || (a.c.symbol < b.c.symbol ? -1 : 1));
  return {
    picks, rows, quotes, fwdBy, frameBy, gated, keyed,
    cut: {
      nRaw: rows.length, nCalls, nIn: cands.length, nOut: picks.length,
      nKeyed: hit, k: kEff, kReq: k, cap, buckets: RANK_BUCKETS.map((b) => [b[0], b[1]]),
      terms: { h: terms.h, f: terms.f }, spot, asOf: readMs, dups, noDelta: dShed.noDelta, dash: dShed.dash, exercise: dShed.exercise,
    },
  };
}

export function rankShortCalls(raw, { ticker, spot, readMs, asOfDay, rate, rateMethod = null, facts = [], terms = { h: SC_DEFAULTS.haircut, f: SC_DEFAULTS.floor }, k = RANK_K, gates = {}, pages = null, truncated = false, shed = [], dividends = null, vendor = null }) {
  const g = { ...DEFAULT_GATES, ...gates };
  const pre = preRank({ raw, ticker, spot, readMs, asOfDay, rate, rateMethod, facts, terms, k, gates, dividends });
  const books = new Map();
  const bookOf = (expiry) => {
    if (!books.has(expiry)) {
      const frame = pre.frameBy.get(expiry);
      books.set(expiry, frame && !frame.bad ? bracketBook(pre.quotes.get(expiry), frame.F) : null);
    }
    return books.get(expiry);
  };
  const kept = [];
  for (const { c, pk } of pre.picks) {
    const p = priceSale(c.raw, { spot, asOf: asOfDay, readMs, rate, midIv: false });
    if (p === null) continue;
    const frame = pre.frameBy.get(c.expiry);
    const qt = pre.quotes.get(c.expiry).find((x) => x.K === c.strike);
    if (qt && fin(qt.pb) && fin(qt.pa) && qt.pb > 0 && qt.pa >= qt.pb) p.opposite = { bid: qt.pb, ask: qt.pa };
    attachMidIv(p, { spot, readMs, rate, forward: frame && !frame.bad ? frame.F : null });
    p.pk = pk;
    const book = bookOf(c.expiry);
    const br = book ? book(c.strike + p.bid) : null;
    if (br) p.br = { s: br.side, lo: round6(br.lo), hi: round6(br.hi) };
    kept.push(p);
  }
  const fwd = Array.from(new Set(kept.map((p) => p.expiry))).sort().map((expiry) => forwardRecord(expiry, pre.fwdBy.get(expiry)));
  const forwards = fwd.map((f) => ({ expiry: f.expiry, method: f.method, pairs: f.pairs, F: f.F }));
  const { divisor, basis } = ivConvention(
    (Array.isArray(raw) ? raw : []).map((r) => r && r.implied_volatility),
    { pairs: kept.map((p) => [p.iv, p.ivMid]) });
  const standing = [];
  const ordered = pre.rows.slice().sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0) || a.strike - b.strike || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  for (const r of ordered) {
    if (!(r.bid > 0) || !(r.ask >= r.bid)) continue;
    const iv = numOrNull(r.raw.implied_volatility);
    const days = daysToExpiry(r.expiry, asOfDay);
    if (iv === null || !(iv > 0) || days === null || !(spot > 0)) continue;
    standing.push({
      iv: iv / divisor, moneyness: r.strike / spot - 1, expiry: r.expiry, days, ivTraded: fin(r.volume) ? r.volume > 0 : null,
      strike: r.strike, type: r.type, volume: r.volume, oi: r.oi,
    });
  }
  const cut = {
    ...pre.cut, pages, truncated,
    ...(vendor ? { vendor } : {}),
    shed: shedList(pre, shed),
  };
  return {
    rows: kept, gated: pre.gated, screened: Array.isArray(raw) ? raw.length : 0, priced: pre.cut.nIn, ivBasis: basis,
    rankedBy: "annualized", gates: g, forwards, fwd, ivSurface: ivSurface(standing, { ivBasis: basis }), cut,
  };
}

function shedList(pre, shed) {
  const out = [];
  for (const [why, n] of [["nonStandard", pre.gated.nonStandard], ["unpriceable", pre.gated.unpriceable], ["offMarket", pre.gated.offMarket], ["expiry", pre.gated.expiry], ["premium", pre.gated.premium], ["openInterest", pre.gated.openInterest], ["spread", pre.gated.spread]]) {
    if (n > 0) out.push({ why, n });
  }
  if (pre.cut.noDelta > 0) out.push({ why: "no fitted delta", n: pre.cut.noDelta });
  if (pre.cut.dash > 0) out.push({ why: "forward uncertain", n: pre.cut.dash });
  if (pre.cut.exercise > 0) out.push({ why: "exercise", n: pre.cut.exercise });
  const ranked = pre.cut.nIn - pre.cut.nOut;
  if (ranked > 0) out.push({ why: pre.cut.k < pre.cut.kReq ? "cap" : "rank", n: ranked });
  for (const x of shed) out.push(x);
  return out;
}
