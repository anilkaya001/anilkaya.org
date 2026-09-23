import { parityForward, black76, bsmGreeks, impliedVolB76, normPdf } from "./flows-quant-bs.js";
import { asSlice, sliceVolK, sliceTotalVariance, skewMetrics, eventVariance } from "./flows-quant-smile.js";
import { impliedMove, lawFromSlice, lawBinned, interpolateBinned, driftNeutralBinned } from "./flows-quant-density.js";
import {
  runEngine, buildExpiry, ENGINE_VERSION, ENGINE_LINES, expiryProfile, normaliseLeg, lawIntervalsProb, lawExpect,
  expiryFromFit, setupEngine,
} from "./flows-quant-engine.js";
import { gammaProfile } from "./flows-quant-structures.js";
import { etDayOf, calendarDays, yearFraction, sessionsBetween, isMonthly } from "./flows-quant-time.js";

export const QUANT_CARD_VERSION = 1;
export const QUANT_CARD_LINES = Object.freeze({
  MAX_EXPIRIES: 10, MAX_DTE: 200, MIN_ROWS: 3, SIG: 5,
  COVER_GOOD: 0.85, COVER_FAIR: 0.5, FLIP_NEAR_ATR: 2, PROFILE_STRIDE: 3,
  PUBLISH_STRUCTURES: 5, RATE_MIN_DAYS: 20, RATE_MAX_DAYS: 200, RATE_LO: -0.01, RATE_HI: 0.15,
  XS_MIN_NAMES: 10, IV_PERCENT_LINE: 5, EVENT_MIN_MOVES: 3, EVENT_MIN_JUMP: 1e-4,
  PARITY_SYMBOLS: Object.freeze(["SPX", "SPXW", "SPY"]),
});
export const FACT_UNITS = Object.freeze([
  "vol", "volpt", "frac", "px", "usd", "usdPer1pct", "usdPerVolPt", "usdPerDay", "days", "sessions", "count", "ratio", "var",
]);

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const sig = (v, d = QUANT_CARD_LINES.SIG) => (fin(v) ? (v === 0 ? 0 : Number(v.toPrecision(d))) : null);
const dp = (v, d) => {
  if (!fin(v)) return null;
  const f = Math.pow(10, d);
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
function median(xs) {
  const s = xs.filter(fin).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const OPTION_SYMBOL_RE = /^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([PC])(\d{8})$/;

export function parseSymbol(symbol) {
  if (typeof symbol !== "string") return null;
  const m = OPTION_SYMBOL_RE.exec(symbol.trim().toUpperCase());
  if (!m) return null;
  const month = Number(m[3]), day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const strike = Number(m[6]) / 1000;
  if (!(strike > 0)) return null;
  return { ticker: m[1], expiry: "20" + m[2] + "-" + m[3] + "-" + m[4], type: m[5], strike };
}

export function chainRowsByExpiry(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const ivs = [];
  for (const r of list) { const v = num(r && r.implied_volatility); if (v !== null && v > 0) ivs.push(v); }
  const m = median(ivs);
  const divisor = m !== null && m > QUANT_CARD_LINES.IV_PERCENT_LINE ? 100 : 1;
  const by = new Map();
  const seen = new Set();
  let foreign = 0, expired = 0;
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const p = parseSymbol(r.option_symbol);
    if (!p) continue;
    if (opts.ticker && p.ticker !== opts.ticker) { foreign++; continue; }
    if (opts.sessionDate && !(p.expiry > opts.sessionDate)) { expired++; continue; }
    const sym = r.option_symbol.trim().toUpperCase();
    if (seen.has(sym)) continue;
    seen.add(sym);
    const iv = num(r.implied_volatility);
    const volume = num(r.volume);
    const tape = typeof r.last_tape_time === "string" ? Date.parse(r.last_tape_time) : NaN;
    const untraded = Number.isFinite(tape) && opts.sessionDate ? etDayOf(tape) < opts.sessionDate
      : volume !== null ? !(volume > 0) : false;
    if (!by.has(p.expiry)) by.set(p.expiry, []);
    by.get(p.expiry).push({
      K: p.strike, type: p.type, bid: num(r.nbbo_bid), ask: num(r.nbbo_ask), oi: num(r.open_interest),
      volume, sym, ivSeed: iv !== null && iv > 0 ? iv / divisor : null, untraded,
    });
  }
  const expiries = [...by.keys()].sort().map((expiry) => ({
    expiry, rows: by.get(expiry).sort((a, b) => a.K - b.K || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)),
  }));
  return { expiries, divisor, foreign, expired, contracts: seen.size };
}

function pairsOf(rows) {
  const calls = new Map(), puts = new Map();
  for (const r of rows) {
    if (!fin(r.bid) || !fin(r.ask) || !(r.bid > 0) || !(r.ask >= r.bid)) continue;
    (r.type === "C" ? calls : puts).set(r.K, r);
  }
  const out = [];
  for (const K of [...calls.keys()].sort((a, b) => a - b)) {
    const c = calls.get(K), p = puts.get(K);
    if (!p) continue;
    out.push({ K, call: (c.bid + c.ask) / 2, put: (p.bid + p.ask) / 2, spreadCall: c.ask - c.bid, spreadPut: p.ask - p.bid });
  }
  return out;
}

function seedNear(rows, S) {
  let best = null, d = Infinity;
  for (const r of rows) if (fin(r.ivSeed) && r.ivSeed > 0 && Math.abs(r.K - S) < d) { d = Math.abs(r.K - S); best = r.ivSeed; }
  return best;
}

export const QUOTE_IV_BASIS = "NBBO mid inverted on Black-76 against a put-call parity forward; the vendor's own IV only seeds the solver and is never the reading";

export function quoteImpliedVols(priced, { spot, rate = ENGINE_LINES.RATE_FALLBACK } = {}) {
  const list = Array.isArray(priced) ? priced : [];
  if (!(spot > 0)) return list.map((p) => ({ ...p, ivVendor: p.iv, iv: null, ivQuote: "no-spot" }));
  const TICK = 0.05;
  const byExpiry = new Map();
  for (const p of list) {
    if (!p || typeof p.expiry !== "string") continue;
    if (!byExpiry.has(p.expiry)) byExpiry.set(p.expiry, []);
    byExpiry.get(p.expiry).push(p);
  }
  const out = new Map();
  for (const [expiry, group] of [...byExpiry.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const days = group.find((p) => fin(p.days)) ? group.find((p) => fin(p.days)).days : null;
    const T = fin(days) ? days / 365 : null;
    if (!(T > 0)) { for (const p of group) out.set(p, { iv: null, why: "expired" }); continue; }
    const D = Math.exp(-rate * T);
    const rows = group.map((p) => ({ K: p.strike, type: p.type, bid: p.bid, ask: p.ask, ivSeed: p.iv }));
    const f = parityForward({ S: spot, T, chain: pairsOf(rows), sigmaSeed: seedNear(rows, spot), D });
    const F = f ? f.F : spot / D;
    let atmSeed = null, best = Infinity;
    for (const r of rows) if (fin(r.ivSeed) && r.ivSeed > 0 && Math.abs(Math.log(r.K / F)) < best) { best = Math.abs(Math.log(r.K / F)); atmSeed = r.ivSeed; }
    const sq = Math.sqrt(T);
    const atmVega = atmSeed === null ? null : normPdf(atmSeed * sq / 2);
    for (const p of group) {
      const bid = p.bid, ask = p.ask;
      if (!fin(bid) || !(bid > 0) || !fin(ask) || !(ask >= bid)) { out.set(p, { iv: null, why: "one-sided" }); continue; }
      const mid = (bid + ask) / 2;
      const intrinsic = D * Math.max(0, p.type === "P" ? p.strike - F : F - p.strike);
      if (!(mid >= TICK - 1e-12) || !(mid - intrinsic >= 0.5 * TICK - 1e-12)) { out.set(p, { iv: null, why: "tick" }); continue; }
      if (!((ask - bid) / mid <= 0.6)) { out.set(p, { iv: null, why: "spread" }); continue; }
      const iv = impliedVolB76(F, D, p.strike, T, mid, p.type, fin(p.iv) && p.iv > 0 ? p.iv : null);
      if (iv === null) { out.set(p, { iv: null, why: "bounds" }); continue; }
      if (atmVega !== null) {
        const k = Math.log(p.strike / F), nu = iv * sq;
        if (!(normPdf(-k / nu + nu / 2) >= 0.01 * atmVega)) { out.set(p, { iv: null, why: "vega" }); continue; }
      }
      out.set(p, { iv, why: null, F });
    }
  }
  return list.map((p) => {
    const q = out.get(p) || { iv: null, why: "unparsed" };
    return { ...p, ivVendor: p.iv, iv: q.iv, ivQuote: q.why };
  });
}

export function parityRate(expiries, { spot, asOfMs, symbol = null } = {}) {
  if (!(spot > 0) || !fin(asOfMs)) return null;
  const L = QUANT_CARD_LINES;
  const points = [];
  for (const e of expiries || []) {
    const T = yearFraction(asOfMs, e.expiry);
    if (!(T >= L.RATE_MIN_DAYS / 365 && T <= L.RATE_MAX_DAYS / 365)) continue;
    const f = parityForward({ S: spot, T, chain: pairsOf(e.rows), sigmaSeed: seedNear(e.rows, spot) });
    if (!f || f.method !== "regression" || !(f.r >= L.RATE_LO && f.r <= L.RATE_HI)) continue;
    points.push({ expiry: e.expiry, T: dp(T, 4), r: dp(f.r, 5), pairs: f.pairs });
  }
  if (!points.length) return null;
  return { r: dp(median(points.map((p) => p.r)), 5), method: "parity:" + (symbol || "index"), n: points.length, points };
}

export function treasuryRate(raw) {
  let rows = raw;
  for (let i = 0; i < 3 && rows && !Array.isArray(rows) && typeof rows === "object"; i++) rows = rows.data;
  if (!Array.isArray(rows)) return null;
  let best = null;
  for (const r of rows) {
    const v = num(r && r.value), d = r && typeof r.date === "string" ? r.date.slice(0, 10) : null;
    if (v === null || !d || !(v > -5 && v < 30)) continue;
    if (!best || d > best.date) best = { date: d, value: v };
  }
  if (!best) return null;
  return { r: dp(Math.log(1 + best.value / 100), 5), method: "treasury:3month", yield: best.value, date: best.date, n: 1 };
}

export function chooseRate({ parity = null, treasury = null } = {}) {
  if (parity && fin(parity.r)) return parity;
  if (treasury && fin(treasury.r)) return treasury;
  return { r: ENGINE_LINES.RATE_FALLBACK, method: "constant", n: 0 };
}

export function buildSlices(expiries, { spot, asOfMs, rate, event = null } = {}) {
  const L = QUANT_CARD_LINES;
  const asOfDay = etDayOf(asOfMs);
  const eligible = (expiries || [])
    .filter((e) => e && typeof e.expiry === "string" && e.expiry > asOfDay && calendarDays(asOfDay, e.expiry) <= L.MAX_DTE)
    .filter((e) => e.rows.filter((r) => fin(r.bid) && r.bid > 0).length >= L.MIN_ROWS)
    .slice().sort((a, b) => (a.expiry < b.expiry ? -1 : 1))
    .slice(0, L.MAX_EXPIRIES);
  const firstAfter = event && event.date ? (eligible.find((e) => e.expiry >= event.date) || null) : null;
  const built = [];
  let prev = null;
  for (const e of eligible) {
    const ex = buildExpiry({
      expiry: e.expiry, rows: e.rows, spot, asOfMs, rate, prev,
      event: firstAfter && firstAfter.expiry === e.expiry ? { firstAfter: true, sigmaD: null } : null,
    });
    if (!ex) continue;
    built.push(ex);
    prev = ex.slice;
  }
  return { built, input: eligible };
}

const atmVolOf = (ex) => sliceVolK(ex.slice, 0);

export function constantMaturity(built, days) {
  const pts = built.map((e) => ({ days: e.T * 365, w: sliceTotalVariance(e.slice, 0), e })).filter((p) => fin(p.w) && p.w > 0);
  if (!pts.length) return null;
  pts.sort((a, b) => a.days - b.days);
  let lo = null, hi = null;
  for (const p of pts) { if (p.days <= days) lo = p; if (p.days >= days && !hi) hi = p; }
  if (lo && hi && lo !== hi) {
    const t = (days - lo.days) / (hi.days - lo.days);
    const w = lo.w + t * (hi.w - lo.w);
    return { vol: Math.sqrt(Math.max(w, 0) / (days / 365)), w, lo: lo.e, hi: hi.e, extrapolated: false };
  }
  const only = lo || hi;
  if (!only) return null;
  if (Math.abs(only.days - days) > Math.max(5, days * 0.5)) return null;
  return { vol: Math.sqrt(only.w / (only.days / 365)), w: only.w * days / only.days, lo: only.e, hi: only.e, extrapolated: true };
}

function fitGradeOf(slice) {
  if (!slice) return 0;
  if (slice.method === "flat") return 1;
  if (fin(slice.fitInSpread) && slice.fitInSpread < ENGINE_LINES.FIT_FAIR_IN_SPREAD) return 1;
  if (slice.method === "svi" && !slice.why && (slice.fitInSpread === null || slice.fitInSpread >= ENGINE_LINES.FIT_CLEAN_IN_SPREAD)) return 3;
  return 2;
}

export function eventJump(built, event) {
  if (!event || !event.date) return null;
  const after = built.filter((e) => e.expiry >= event.date);
  if (after.length < 2) return { J: null, why: "event.slices" };
  const front = after[0], back = after[1];
  const v = eventVariance({ front: { T: front.T, vol: atmVolOf(front) }, back: { T: back.T, vol: atmVolOf(back) } });
  const priced = fin(v.eventSd) && v.eventSd >= QUANT_CARD_LINES.EVENT_MIN_JUMP;
  return {
    J: priced ? v.eventSd : null, meanAbs: priced ? v.eventMeanAbs : null, diffusiveVol: v.diffusiveVol,
    why: priced ? v.why : v.why || "event.no-premium", front: front.expiry, back: back.expiry,
  };
}

export function bookLevels(strikeRows, { spot } = {}) {
  if (!(spot > 0)) return null;
  const rows = [];
  let pos = 0, neg = 0;
  for (const r of strikeRows || []) {
    const k = num(r && (r.strike ?? r.price));
    const c = num(r && r.call_gamma_oi), p = num(r && r.put_gamma_oi);
    if (k === null || !(k > 0) || (c === null && p === null)) continue;
    if (p !== null && p > 0) pos++;
    if (p !== null && p < 0) neg++;
    rows.push({ k, c: c === null ? 0 : c, p: p === null ? 0 : p });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.k - b.k);
  const sign = neg >= pos ? 1 : -1;
  const mixed = pos > 0 && neg > 0 && Math.min(pos, neg) / (pos + neg) > 0.05;
  let callWall = null, putWall = null, magnet = null, cBest = 0, pBest = 0, mBest = 0, gex = 0;
  for (const r of rows) {
    const put = sign * r.p;
    if (r.k >= spot && r.c > cBest) { cBest = r.c; callWall = r.k; }
    if (r.k <= spot && Math.abs(r.p) > pBest) { pBest = Math.abs(r.p); putWall = r.k; }
    const book = r.c + put;
    gex += book;
    if (Math.abs(book) > mBest) { mBest = Math.abs(book); magnet = r.k; }
  }
  return {
    callWall, putWall, magnet: mixed ? null : magnet, gex: mixed ? null : gex, strikes: rows.length,
    putSign: mixed ? "mixed" : sign === 1 ? "dealer" : "holder", bandMin: rows[0].k, bandMax: rows[rows.length - 1].k,
  };
}

export function zeroGammaOf(built, { spot, atr = null, vendorGross = null } = {}) {
  if (!(spot > 0) || !built || !built.length) return null;
  const contracts = [];
  for (const e of built) {
    for (const row of e.rows) {
      if (!fin(row.oi) || !(row.oi > 0) || !fin(row.K)) continue;
      const vol = sliceVolK(e.slice, Math.log(row.K / e.slice.F));
      if (!fin(vol) || !(vol > 0)) continue;
      contracts.push({ K: row.K, T: e.T, sigma: vol, type: row.type, oi: row.oi });
    }
  }
  if (!contracts.length) return null;
  const near = built.slice().sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30) || a.T - b.T)[0];
  const prof = gammaProfile({ spot, contracts, r: near.r, q: near.qImpl });
  const mid = prof.grid.length >> 1;
  let gross = 0;
  for (const c of contracts) {
    const gr = bsmGreeks({ S: spot, K: c.K, r: near.r, q: near.qImpl, sigma: c.sigma, T: c.T, type: c.type });
    if (gr) gross += c.oi * 100 * gr.gamma * spot * spot * 0.01;
  }
  const coverage = fin(vendorGross) && vendorGross > 0 ? gross / vendorGross : null;
  const L = QUANT_CARD_LINES;
  const nearby = prof.flips.filter((x) => !(fin(atr) && atr > 0) || Math.abs(x - spot) <= L.FLIP_NEAR_ATR * atr);
  const g = coverage === null ? 2 : coverage >= L.COVER_GOOD ? 3 : coverage >= L.COVER_FAIR ? 2 : 1;
  const why = coverage === null ? "flip.coverage-unmeasured" : coverage < L.COVER_GOOD ? "flip.coverage" : null;
  const stride = L.PROFILE_STRIDE;
  const px = [], gx = [];
  for (let i = 0; i < prof.grid.length; i += stride) { px.push(dp(prof.grid[i], 4)); gx.push(sig(prof.gex[i])); }
  return {
    px: prof.flip === null ? null : dp(prof.flip, 4), count: prof.flips.length,
    nearby: nearby.map((x) => dp(x, 4)), atSpot: sig(prof.gex[mid]), coverage: coverage === null ? null : dp(coverage, 4),
    contracts: contracts.length, expiries: built.length, g, why, profile: { x: px, g: gx },
  };
}

function atrOf(px, spot, atr) {
  return fin(px) && fin(spot) && fin(atr) && atr > 0 ? dp((px - spot) / atr, 3) : null;
}

export function factMap(facts) {
  const out = {};
  for (const f of facts || []) if (f && typeof f.id === "string") out[f.id] = { v: fin(f.v) ? f.v : null, g: fin(f.g) ? f.g : 0 };
  return out;
}

function factRow(id, v, u, g, extra = {}) {
  const value = fin(v) ? v : null;
  const out = { id, v: value, u, g: value === null ? 0 : Math.max(0, Math.min(3, g)) };
  if (value === null) out.why = extra.why || "absent";
  else if (extra.why) out.why = extra.why;
  if (fin(extra.atr)) out.atr = extra.atr;
  if (extra.x) out.x = true;
  if (fin(extra.q)) out.q = extra.q;
  return out;
}

export function engineFacts(input) {
  const { built = [], spot, atr = null, card = null, garch = null, zero = null, book = null, event = null, jump = null } = input;
  const xs = input.crossSection || {};
  const facts = [];
  const add = (...a) => { facts.push(factRow(...a)); };
  const panels = card && card.panels && typeof card.panels === "object" ? card.panels : {};
  const ok = (p) => p && typeof p === "object" && p.status === "ok";
  const cm = {};
  for (const d of [7, 30, 90]) {
    const c = constantMaturity(built, d);
    cm[d] = c;
    const g = c ? Math.min(fitGradeOf(c.lo.slice), fitGradeOf(c.hi.slice), c.extrapolated ? 2 : 3) : 0;
    add("iv.cm." + d, c ? dp(c.vol, 4) : null, "vol", g, c ? {} : { why: "iv.no-slice" });
  }
  const pm = ok(panels.pricedMove) ? panels.pricedMove : null;
  const rank = pm && fin(pm.ivRank) && pm.ivRank >= 0 && pm.ivRank <= 1 ? pm.ivRank : null;
  add("iv.rank.1y", rank === null ? null : dp(rank, 4), "frac", 2, rank === null ? { why: "iv.rank-absent" } : {});
  add("iv.pct.30", rank === null ? null : dp(rank, 4), "frac", 2, { why: rank === null ? "iv.rank-absent" : "iv.rank-as-pct" });
  const iv30 = cm[30] ? cm[30].vol : null, iv7 = cm[7] ? cm[7].vol : null, iv90 = cm[90] ? cm[90].vol : null;
  const gOf = (id) => { const f = facts.find((x) => x.id === id); return f ? f.g : 0; };
  const slope = iv30 !== null && iv90 !== null && iv90 > 0 ? iv30 / iv90 - 1 : null;
  add("term.slope.30_90", slope === null ? null : dp(slope, 4), "frac", Math.min(gOf("iv.cm.30"), gOf("iv.cm.90")));
  add("term.front.7_30", iv7 !== null && iv30 !== null && iv30 > 0 ? dp(iv7 / iv30 - 1, 4) : null, "frac", Math.min(gOf("iv.cm.7"), gOf("iv.cm.30")));
  let slopeEx = slope, exWhy = null;
  const evDays = event && event.date && input.asOfDay ? calendarDays(input.asOfDay, event.date) : null;
  if (slope !== null && evDays !== null && evDays > 0 && evDays <= 90) {
    if (jump && fin(jump.J)) {
      const exOf = (d) => (cm[d] ? Math.sqrt(Math.max(0, cm[d].w - (evDays <= d ? jump.J * jump.J : 0)) / (d / 365)) : null);
      const e30 = exOf(30), e90 = exOf(90);
      slopeEx = e30 !== null && e90 !== null && e90 > 0 ? e30 / e90 - 1 : null;
    } else {
      exWhy = "event.unremoved";
    }
  }
  add("term.slope.30_90.exEvent", slopeEx === null ? null : dp(slopeEx, 4), "frac",
    Math.min(gOf("term.slope.30_90"), exWhy ? 1 : 3), exWhy ? { why: exWhy } : {});
  const near30 = built.slice().sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30) || a.T - b.T)[0] || null;
  const sk = near30 && near30.slice.method !== "mixture" ? skewMetrics(near30.slice) : null;
  const skG = near30 ? Math.min(fitGradeOf(near30.slice), near30.slice.method === "flat" ? 0 : 3) : 0;
  add("skew.rr25.30", sk ? dp(sk.rr25, 4) : null, "vol", skG, sk ? {} : { why: "skew.no-slice" });
  add("skew.bf25.30", sk ? dp(sk.bf25, 4) : null, "vol", skG, sk ? {} : { why: "skew.no-slice" });
  add("skew.rr25.30.pct", fin(xs.rr25Pct) ? dp(xs.rr25Pct, 4) : null, "frac", 2, fin(xs.rr25Pct) ? { x: true } : { why: xs.why || "xs.absent" });
  if (near30) {
    const mv = impliedMove(near30.slice);
    add("move.mad." + near30.expiry, mv ? dp(mv.fraction, 4) : null, "frac", fitGradeOf(near30.slice));
  }
  const carryEx = built.filter((e) => e.dte >= 45 && e.dte <= 120).sort((a, b) => Math.abs(a.dte - 75) - Math.abs(b.dte - 75))[0] || near30;
  add("carry.implied", carryEx && fin(carryEx.qImpl) ? dp(carryEx.qImpl, 4) : null, "frac",
    carryEx && carryEx.forward && carryEx.forward.method === "rate-only" ? 0 : carryEx && carryEx.forward && carryEx.forward.pairs >= 3 ? 3 : 2);
  const gg = garch && garch.status === "ok" ? garch : null;
  const gGrade = gg && fin(gg.grade) ? gg.grade : gg ? (gg.converged === false ? 1 : 2) : 0;
  const gWhy = gg && Array.isArray(gg.why) && gg.why.length ? gg.why[0] : gg ? null : "garch.absent";
  const avg = gg && fin(gg.avg21Vol) ? gg.avg21Vol / 100 : null;
  add("garch.avg.21", avg === null ? null : dp(avg, 4), "vol", gGrade, gWhy ? { why: gWhy } : {});
  const hl = gg && fin(gg.persistence) && gg.persistence > 0 && gg.persistence < 1 ? Math.log(0.5) / Math.log(gg.persistence) : null;
  add("garch.halfLife", hl === null ? null : dp(hl, 2), "sessions", gGrade, gWhy ? { why: gWhy } : {});
  add("garch.grade", gg ? gGrade : null, "count", gg ? 3 : 0, gWhy ? { why: gWhy } : {});
  let ivEx = iv30, vrpWhy = null;
  if (iv30 !== null && evDays !== null && evDays > 0 && evDays <= 30) {
    if (jump && fin(jump.J)) ivEx = Math.sqrt(Math.max(0, cm[30].w - jump.J * jump.J) / (30 / 365));
    else vrpWhy = "vrp.event-inside";
  }
  const vrpG = Math.min(gOf("iv.cm.30"), gGrade, vrpWhy ? 1 : 3);
  const vVol = ivEx !== null && avg !== null ? ivEx - avg : null;
  add("vrp.var.21", ivEx !== null && avg !== null ? dp(ivEx * ivEx - avg * avg, 5) : null, "var", vrpG, vrpWhy ? { why: vrpWhy } : gWhy ? { why: gWhy } : {});
  add("vrp.vol.21", vVol === null ? null : dp(vVol, 4), "vol", vrpG, vrpWhy ? { why: vrpWhy } : gWhy ? { why: gWhy } : {});
  add("vrp.rel.21", vVol !== null && avg > 0 ? dp(vVol / avg, 4) : null, "frac", vrpG, vrpWhy ? { why: vrpWhy } : gWhy ? { why: gWhy } : {});
  const rv = pm && fin(pm.rv30) ? pm.rv30 : null;
  add("rv.cc.21", rv === null ? null : dp(rv, 4), "vol", 2);
  add("vrp.trailing.21", iv30 !== null && rv !== null ? dp(iv30 - rv, 4) : null, "vol", 1, { why: "vrp.trailing-rv" });
  const lvl = (id, px, g, why) => add(id, fin(px) ? dp(px, 4) : null, "px", g, { atr: atrOf(px, spot, atr), ...(why ? { why } : {}) });
  lvl("level.callWall", book ? book.callWall : null, book ? 3 : 0, book ? null : "book.absent");
  lvl("level.putWall", book ? book.putWall : null, book ? 3 : 0, book ? null : "book.absent");
  lvl("level.magnet", book ? book.magnet : null, book && book.putSign !== "mixed" ? 3 : 0, book ? (book.putSign === "mixed" ? "book.put-sign" : null) : "book.absent");
  lvl("level.flip", zero ? zero.px : null, zero ? zero.g : 0, zero ? zero.why : "flip.no-chain");
  add("level.flip.count", zero ? zero.count : null, "count", zero ? zero.g : 0, zero ? {} : { why: "flip.no-chain" });
  const cross = card && fin(card.strikeSumCrossing) ? card.strikeSumCrossing : null;
  lvl("level.strikeSumCrossing", cross, 2, cross === null ? "crossing.none" : null);
  const lv = ok(panels.levels) && Array.isArray(panels.levels.levels) ? panels.levels.levels : [];
  const pain = lv.find((x) => x && x.kind === "max_pain") || null;
  lvl("level.maxPain", pain ? pain.px : null, pain ? 2 : 0, pain ? null : "pain.absent");
  const gp = ok(panels.gamma) ? panels.gamma : null;
  lvl("level.flowPeakLong", gp ? gp.flowPeakLong : null, gp ? 1 : 0, gp ? null : "flow.absent");
  lvl("level.flowPeakShort", gp ? gp.flowPeakShort : null, gp ? 1 : 0, gp ? null : "flow.absent");
  const reg = card && card.regime && typeof card.regime === "object" ? card.regime : {};
  add("gex.book", fin(reg.bookGamma) ? sig(reg.bookGamma) : fin(reg.bookGammaRaw) ? sig(reg.bookGammaRaw) : null, "usdPer1pct", 3,
    fin(reg.bookGamma) || fin(reg.bookGammaRaw) ? {} : { why: "book.absent" });
  add("gex.flow", fin(reg.flowGamma) ? sig(reg.flowGamma) : null, "usdPer1pct", 1, fin(reg.flowGamma) ? {} : { why: "flow.absent" });
  add("event.days", evDays !== null && evDays >= 0 ? evDays : null, "days", event ? (event.confirmed ? 3 : 2) : 0,
    event ? (event.confirmed ? {} : { why: "event.estimated" }) : { why: "event.none-listed" });
  add("event.confirmed", event ? (event.confirmed ? 1 : 0) : null, "count", event ? 3 : 0, event ? {} : { why: "event.none-listed" });
  const hist = event && Array.isArray(event.moves) ? event.moves.filter(fin).map(Math.abs) : [];
  const histMed = hist.length >= QUANT_CARD_LINES.EVENT_MIN_MOVES ? median(hist) : null;
  add("move.event.hist.medianAbs", histMed === null ? null : dp(histMed, 4), "frac", hist.length >= 6 ? 3 : 2,
    histMed === null ? { why: event ? "event.few-moves" : "event.none-listed" } : {});
  const jMad = jump && fin(jump.meanAbs) ? jump.meanAbs : null;
  add("move.event", jMad === null ? null : dp(jMad, 4), "frac", jMad === null ? 0 : 2, jMad === null ? { why: jump ? jump.why || "event.no-jump" : event ? "event.slices" : "event.none-listed" } : {});
  add("move.event.ratio", jMad !== null && histMed > 0 ? dp(jMad / histMed, 4) : null, "ratio", hist.length >= 6 ? 2 : 1,
    jMad !== null && histMed > 0 ? {} : { why: jMad === null ? "event.no-jump" : "event.few-moves" });
  return facts;
}

export function engineLevels({ book = null, zero = null, card = null, atr = null } = {}) {
  const panels = card && card.panels ? card.panels : {};
  const lv = panels.levels && panels.levels.status === "ok" && Array.isArray(panels.levels.levels) ? panels.levels.levels : [];
  const pain = lv.find((x) => x && x.kind === "max_pain") || null;
  return {
    callWall: book ? book.callWall : null, putWall: book ? book.putWall : null, magnet: book ? book.magnet : null,
    flip: zero ? zero.px : null, maxPain: pain ? pain.px : null, atr: fin(atr) ? atr : null,
  };
}

export function engineState(state) {
  const s = state && typeof state === "object" ? state : null;
  if (!s) return { state: "undetermined", direction: null, confidence: 0, preferred: ["no position"], avoid: [] };
  return {
    state: typeof s.state === "string" ? s.state : "undetermined",
    direction: s.direction === "bullish" || s.direction === "bearish" ? s.direction : null,
    confidence: fin(s.confidence) ? s.confidence : 0,
    premium: typeof s.premium === "string" ? s.premium : null,
    preferred: Array.isArray(s.preferred) ? s.preferred.slice() : ["no position"],
    avoid: Array.isArray(s.avoid) ? s.avoid.slice() : [],
  };
}

export function engineEvent(event, jump, facts) {
  if (!event || !event.date) return null;
  const fm = factMap(facts);
  const ratio = fm["move.event.ratio"] ? fm["move.event.ratio"].v : null;
  return {
    date: event.date, confirmed: !!event.confirmed, moves: (event.moves || []).filter(fin).map((m) => dp(m, 4)),
    jq: jump && fin(jump.J) ? dp(jump.J, 5) : null, realizedOverImplied: fin(event.realizedOverImplied) ? dp(event.realizedOverImplied, 4) : null,
    ratio,
  };
}

export function compactLaw(law) {
  if (!law) return null;
  return {
    model: law.model || null, grade: fin(law.grade) ? law.grade : null, why: Array.isArray(law.why) ? law.why.slice() : [],
    knots: (law.knots || []).map((k) => ({ h: k.h, edges: k.edges.map((e) => (e === null ? null : sig(e))), means: k.means.map((m) => sig(m)) })),
    params: law.params ? Object.fromEntries(Object.keys(law.params).sort().map((key) => [key, sig(law.params[key], 8)])) : null,
    ewmaVol: sig(law.ewmaVol, 4), coneMedianVol: sig(law.coneMedianVol, 4), vol: sig(law.vol, 4),
  };
}

export function compactEngine(out, extra = {}) {
  const L = QUANT_CARD_LINES;
  const byId = new Map(out.structures.map((s) => [s.id, s]));
  const keep = [];
  const push = (id) => { if (id && byId.has(id) && !keep.includes(id)) keep.push(id); };
  for (const id of out.ideas) push(id);
  if (out.noTrade && out.noTrade.closest) push(out.noTrade.closest);
  const rest = out.structures.filter((s) => fin(s.score)).slice().sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  for (const s of rest) { if (keep.length >= L.PUBLISH_STRUCTURES) break; push(s.id); }
  const structures = keep.map((id) => byId.get(id));
  return {
    v: QUANT_CARD_VERSION, engine: ENGINE_VERSION, asOf: out.asOf, spot: out.spot,
    atr: fin(extra.atr) ? dp(extra.atr, 4) : null,
    rate: extra.rate ? { r: extra.rate.r, method: extra.rate.method, n: extra.rate.n || 0 } : null,
    liquidity: out.liquidity, expiries: out.expiries,
    facts: extra.facts || [], state: extra.state || null, levels: extra.levels || null, event: extra.event || null,
    zeroGamma: extra.zeroGamma || null, pLaw: extra.pLaw || null,
    structures, ideas: out.ideas.slice(), noTrade: out.noTrade,
    priced: out.structures.length,
    families: out.families.filter((f) => f.score > 0 || f.veto.length).slice(0, 8).map((f) => ({ family: f.family, score: f.score, veto: f.veto })),
  };
}

export function engineStale({ cardSession = null, blockAsOf = null, expectedSession = null } = {}) {
  const day = (v) => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);
  const card = day(cardSession), block = day(blockAsOf), expected = day(expectedSession);
  if (card && expected && card < expected) return true;
  return !!(card && block && block < card);
}

export function runCardEngine(input) {
  const asOfMs = fin(input.asOfMs) ? input.asOfMs : Date.parse(input.asOf);
  const out = runEngine({
    ticker: input.ticker || null, asOf: asOfMs, spot: input.spot, rate: input.rate ? input.rate.r : ENGINE_LINES.RATE_FALLBACK,
    expiries: input.expiries, facts: factMap(input.facts), state: engineState(input.state), pLaw: input.pLaw || null,
    levels: input.levels || null, event: input.event || null, stale: !!input.stale, curves: false,
    topFamilies: input.topFamilies, fits: !!input.fits,
  });
  const block = compactEngine(out, {
    atr: input.atr, rate: input.rate, facts: input.facts, state: engineState(input.state), levels: input.levels,
    event: input.event, zeroGamma: input.zeroGamma, pLaw: input.publishLaw === false ? null : compactLaw(input.pLaw),
  });
  if (input.fits) Object.assign(block, { asOfMs, stale: !!input.stale, fits: out.fits });
  return block;
}

export function bookRows(calls, puts, ticker) {
  const want = typeof ticker === "string" && ticker ? ticker.trim().toUpperCase() : null;
  const seen = new Set();
  const out = [];
  const add = (r, type) => {
    if (!r || typeof r.sym !== "string") return;
    const p = parseSymbol(r.sym);
    if (!p || p.type !== type || (want && p.ticker !== want)) return;
    const sym = r.sym.trim().toUpperCase();
    if (seen.has(sym)) return;
    seen.add(sym);
    const iv = num(r.iv), volume = num(r.vol);
    out.push({
      K: p.strike, type, bid: num(r.bid), ask: num(r.ask), oi: num(r.oi), volume, sym,
      ivSeed: iv !== null && iv > 0 ? iv : null, untraded: volume !== null ? !(volume > 0) : false,
    });
  };
  for (const r of Array.isArray(calls) ? calls : []) add(r, "C");
  for (const r of Array.isArray(puts) ? puts : []) add(r, "P");
  return out.sort((a, b) => a.K - b.K || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

export function contractFit(input) {
  const { expiry, asOfMs, spot: S, row } = input;
  const r = fin(input.rate) ? input.rate : ENGINE_LINES.RATE_FALLBACK;
  const T = yearFraction(asOfMs, expiry);
  if (!(T > 0) || !(S > 0) || !row || !fin(row.K)) return null;
  const F = S * Math.exp(r * T), D = Math.exp(-r * T);
  const mid = fin(row.bid) && fin(row.ask) && row.bid > 0 && row.ask >= row.bid ? (row.bid + row.ask) / 2 : null;
  const iv = mid === null ? null : impliedVolB76(F, D, row.K, T, mid, row.type, fin(row.ivSeed) && row.ivSeed > 0 ? row.ivSeed : null);
  if (!fin(iv) || !(iv > 0)) return null;
  const day = etDayOf(asOfMs);
  return {
    expiry, T, dte: calendarDays(day, expiry), sessions: sessionsBetween(day, expiry), monthly: isMonthly(expiry),
    forward: { F, D, r, q: 0, pairs: 0, method: "rate-only" },
    slice: { method: "flat", T, F, D, params: { sigma: iv }, n: 1, fitInSpread: null, rmseIvPts: null, why: "fit.contract-iv" },
    points: 1,
  };
}

export function labSetup(input) {
  const list = (Array.isArray(input.books) ? input.books : [])
    .filter((b) => b && b.fit && b.fit.slice && b.fit.forward)
    .map((b) => expiryFromFit({ ...b.fit, rows: b.rows }))
    .sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  return setupEngine({
    asOf: input.asOfMs, spot: input.spot, facts: factMap(input.facts), state: engineState(input.state), pLaw: input.pLaw || null,
    levels: input.levels || null, event: input.event || null, stale: !!input.stale, lawCache: input.lawCache,
  }, list);
}

export function sliceFromSummary(e) {
  if (!e || !e.forward || !e.smile) return null;
  const params = e.smile.params || {};
  return asSlice({ method: e.smile.method, T: e.T, F: e.forward.F, D: e.forward.D, params });
}

function aggregatedSd(params, h) {
  if (!params || !fin(params.sigma2Next)) return Math.sqrt(h);
  const persistence = (params.alpha || 0) + (params.gamma || 0) / 2 + (params.beta || 0);
  const longRun = persistence < 1 && fin(params.omega) ? params.omega / (1 - persistence) : params.sigma2Next;
  const avg = Math.abs(1 - persistence) < 1e-9 ? params.sigma2Next
    : longRun + (params.sigma2Next - longRun) * (1 - Math.pow(persistence, h)) / (h * (1 - persistence));
  return Math.sqrt(Math.max(avg, 0) * h);
}

export function lawAtSessions(pLaw, { sessions, forwardOverSpot = 1, S }) {
  if (!pLaw || !Array.isArray(pLaw.knots) || !pLaw.knots.length || !(S > 0)) return null;
  const h = Math.max(1, sessions || 1);
  const ks = pLaw.knots.slice().sort((a, b) => a.h - b.h);
  let lower = ks[0], upper = ks[ks.length - 1];
  for (const k of ks) { if (k.h <= h) lower = k; }
  for (let i = ks.length - 1; i >= 0; i--) { if (ks[i].h >= h) upper = ks[i]; }
  if (h <= ks[0].h) { lower = ks[0]; upper = ks[0]; }
  if (h >= ks[ks.length - 1].h) { lower = ks[ks.length - 1]; upper = lower; }
  const sd = (x) => aggregatedSd(pLaw.params, x);
  let bins;
  if (lower.h === upper.h) {
    const scale = sd(h) / sd(lower.h);
    const re = (v) => (v === null ? null : v === 0 ? 0 : Math.exp(Math.log(v) * scale));
    bins = driftNeutralBinned({ edges: lower.edges.map(re), means: lower.means.map(re) }, forwardOverSpot);
  } else {
    bins = interpolateBinned({ lower, upper, h, sd, forwardOverSpot });
  }
  return bins ? lawBinned({ S, edges: bins.edges, means: bins.means }) : null;
}

export function repriceStructure(input) {
  const block = input.engine;
  const legsIn = Array.isArray(input.legs) ? input.legs : [];
  if (!block || !Array.isArray(block.expiries) || !legsIn.length) return null;
  const exp = block.expiries.find((e) => e.expiry === (input.expiry || legsIn[0].expiry)) || null;
  const slice = sliceFromSummary(exp);
  if (!slice) return null;
  const S = fin(input.spot) ? input.spot : block.spot;
  const legs = legsIn.map((l) => normaliseLeg({ type: l.type, K: fin(l.K) ? l.K : l.k, side: l.side, qty: l.qty }));
  const priced = legs.map((l) => {
    if (l.type === "S") return { ...l, model: S, iv: null };
    const iv = sliceVolK(slice, Math.log(l.K / slice.F));
    return { ...l, iv, model: iv === null ? null : black76(slice.F, slice.D, l.K, iv, slice.T, l.type) };
  });
  if (priced.some((l) => l.model === null)) return null;
  const model = priced.reduce((s, l) => s + l.side * l.qty * l.model, 0);
  const cost = fin(input.cost) ? input.cost : model;
  const prof = expiryProfile(priced, cost);
  const qLaw = lawFromSlice(slice);
  const eq = lawExpect(qLaw, prof.pieces);
  const pLaw = lawAtSessions(block.pLaw, { sessions: exp.sessions, forwardOverSpot: slice.F / S, S });
  const ep = pLaw ? lawExpect(pLaw, prof.pieces) : null;
  const lot = 100;
  return {
    legs: priced.map((l) => ({ type: l.type, k: l.type === "S" ? null : l.K, side: l.side, qty: l.qty, iv: dp(l.iv, 4), model: dp(l.model, 4) })),
    model: dp(model, 4), cost: dp(cost, 4),
    maxProfit: prof.maxProfit === null ? null : dp(prof.maxProfit * lot, 2), maxLoss: prof.maxLoss === null ? null : dp(prof.maxLoss * lot, 2),
    profitUnbounded: prof.profitUnbounded, lossUnbounded: prof.lossUnbounded,
    breakevens: prof.breakevens.map((b) => dp(b, 4)),
    popQ: dp(lawIntervalsProb(qLaw, prof.profitIntervals), 4), popP: pLaw ? dp(lawIntervalsProb(pLaw, prof.profitIntervals), 4) : null,
    evQ: dp((slice.D * eq - cost) * lot, 2), evP: ep === null ? null : dp((slice.D * ep - cost) * lot, 2),
    edge: ep === null ? null : dp(slice.D * (ep - eq) * lot, 2),
  };
}

export function structureLegsText(s) {
  return (s.legs || []).map((l) => (l.side > 0 ? "+" : "−") + (l.qty > 1 ? l.qty : "") + l.type + (l.k === null ? "" : String(l.k))).join(" ");
}

