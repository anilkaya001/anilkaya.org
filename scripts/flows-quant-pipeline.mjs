import { fitGarch } from "../shared/flows-garch.js";
import { simulateGjr, binnedLawsFromSimulation, seedKey, ewmaVol, WORLD_LINES } from "../shared/flows-quant-world.js";
import { binnedFromLognormal } from "../shared/flows-quant-density.js";
import { openInterestGammaBook } from "../shared/flows-features.js";
import {
  chainRowsByExpiry, buildSlices, zeroGammaOf, parityRate, treasuryRate, chooseRate, bookLevels,
  engineFacts, engineLevels, engineEvent, eventJump, runCardEngine, QUANT_CARD_LINES,
} from "../shared/flows-quant-card.js";
import { skewMetrics } from "../shared/flows-quant-smile.js";
import { closeUtcMs, isSession, parseDay, isoDay } from "../shared/flows-quant-time.js";

export const PARITY_SYMBOLS = QUANT_CARD_LINES.PARITY_SYMBOLS;

export const QUANT_PIPELINE_LINES = Object.freeze({
  PATHS: WORLD_LINES.PATHS,
  HORIZONS: WORLD_LINES.HORIZONS,
  CONE_WINDOW: 21,
  HISTORY_MOVES: 12,
  INGEST_CAP: 128 * 1024,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const median = (xs) => {
  const s = xs.filter(fin).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function nextSession(day) {
  const p = parseDay(day);
  if (!p) return null;
  for (let i = 1; i <= 10; i++) {
    const d = new Date(p.t + i * 86400000);
    const iso = isoDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    if (isSession(iso)) return iso;
  }
  return null;
}

function impactSessions(date, time) {
  const t = String(time || "").toLowerCase();
  const next = nextSession(date);
  if (t === "premarket") return [isSession(date) ? date : next].filter(Boolean);
  if (t === "postmarket") return [next].filter(Boolean);
  return [isSession(date) ? date : null, next].filter(Boolean);
}

export function earningsFromVendor(raw, { sessionDate } = {}) {
  const rows = Array.isArray(raw) ? raw : raw && Array.isArray(raw.data) ? raw.data : [];
  const hist = [];
  let next = null;
  for (const r of rows) {
    const date = r && typeof r.report_date === "string" ? r.report_date.slice(0, 10) : null;
    if (!date || !parseDay(date)) continue;
    const time = r.report_time || null;
    const sessions = impactSessions(date, time);
    const move = num(r.post_earnings_move_1d);
    const expected = num(r.expected_move_perc);
    const impact = sessions[sessions.length - 1] || date;
    if (sessionDate && impact > sessionDate) {
      const first = sessions.find((d) => d > sessionDate) || impact;
      if (!next || first < next.date) {
        next = { date: first, latest: impact, report: date, time: time || "unknown", confirmed: r.source !== "estimation" && time !== "unknown" };
      }
      continue;
    }
    hist.push({ date, time, sessions, move, expected });
  }
  hist.sort((a, b) => (a.date < b.date ? 1 : -1));
  const withMove = hist.filter((h) => h.move !== null);
  const scaleDown = median(withMove.map((h) => Math.abs(h.move))) > 0.5;
  const expectedDown = median(hist.filter((h) => h.expected !== null && h.expected > 0).map((h) => h.expected)) > 0.5;
  const moves = withMove.slice(0, QUANT_PIPELINE_LINES.HISTORY_MOVES).map((h) => (scaleDown ? h.move / 100 : h.move));
  const ratios = withMove.filter((h) => h.expected !== null && h.expected > 0)
    .map((h) => Math.abs(scaleDown ? h.move / 100 : h.move) / (expectedDown ? h.expected / 100 : h.expected));
  const mask = [...new Set(hist.flatMap((h) => h.sessions))].sort();
  return {
    mask, moves, history: hist.length,
    realizedOverImplied: ratios.length >= QUANT_CARD_LINES.EVENT_MIN_MOVES ? median(ratios) : null,
    next: next ? { ...next, moves, realizedOverImplied: ratios.length >= QUANT_CARD_LINES.EVENT_MIN_MOVES ? median(ratios) : null } : null,
  };
}

export function refitGarch(features, mask) {
  const f = features || {};
  const candles = Array.isArray(f.candles) ? f.candles : [];
  if (!mask || !mask.length || candles.length < 61) return f.garch || null;
  const closes = candles.map((c) => num(c && c[4]));
  const dates = candles.map((c) => (c && typeof c[0] === "string" ? c[0].slice(0, 10) : null));
  const fit = fitGarch(closes, dates, { mask });
  return fit && fit.status === "ok" ? fit : f.garch || fit;
}

export function coneMedianVol(closes, window = QUANT_PIPELINE_LINES.CONE_WINDOW) {
  const px = (closes || []).filter((c) => fin(c) && c > 0);
  const r = [];
  for (let i = 1; i < px.length; i++) r.push(Math.log(px[i] / px[i - 1]));
  if (r.length < window + 5) return null;
  const vols = [];
  for (let i = window; i <= r.length; i++) {
    const seg = r.slice(i - window, i);
    const m = seg.reduce((a, b) => a + b, 0) / window;
    vols.push(Math.sqrt(seg.reduce((a, b) => a + (b - m) * (b - m), 0) / (window - 1) * 252));
  }
  return median(vols);
}

export function garchLaw({ garch, ticker, sessionDate, closes, rate = 0.04, paths = QUANT_PIPELINE_LINES.PATHS,
  horizons = QUANT_PIPELINE_LINES.HORIZONS } = {}) {
  const px = (closes || []).filter((c) => fin(c) && c > 0);
  const ewma = px.length > 21 ? ewmaVol(px) : null;
  const cone = coneMedianVol(px);
  const forwards = Object.fromEntries(horizons.map((h) => [h, Math.exp(rate * h / 252)]));
  const g = garch && garch.status === "ok" ? garch : null;
  const grade = g ? (fin(g.grade) ? g.grade : g.converged === false ? 1 : 2) : 0;
  if (!g || grade <= 1) {
    if (!fin(ewma) || !(ewma > 0)) return null;
    return {
      model: "ewma", grade: 1, why: ["model.ewma", ...(g && Array.isArray(g.why) ? g.why : [])],
      knots: horizons.map((h) => ({ h, ...binnedFromLognormal({ sigma: ewma, T: h / 252, forwardOverSpot: forwards[h] }) })),
      params: null, ewmaVol: ewma, coneMedianVol: cone, vol: ewma,
    };
  }
  const sigma2Next = fin(g.sigma2Next) ? g.sigma2Next : Math.pow(g.nextVol / 100, 2) / 252;
  const params = { omega: g.omega / 1e4, alpha: g.alpha, beta: g.beta, gamma: 0, nu: g.nu, lambda: g.lambda, sigma2Next };
  const sim = simulateGjr(params, { seed: seedKey(ticker, sessionDate), horizons, paths });
  const laws = binnedLawsFromSimulation(sim, forwards);
  return {
    model: "garch", grade, why: Array.isArray(g.why) ? g.why.slice() : [],
    knots: horizons.filter((h) => laws[h]).map((h) => ({ h, edges: laws[h].edges, means: laws[h].means })),
    params, ewmaVol: ewma, coneMedianVol: cone, vol: fin(g.avg21Vol) ? g.avg21Vol / 100 : null,
  };
}

export function rateFromRuns({ rowsByTicker, spotOf, sessionDate, treasuryRaw = null } = {}) {
  const asOfMs = closeUtcMs(sessionDate);
  for (const sym of QUANT_CARD_LINES.PARITY_SYMBOLS) {
    const rows = rowsByTicker && rowsByTicker.get(sym);
    const spot = spotOf ? spotOf(sym) : null;
    if (!rows || !(spot > 0)) continue;
    const chain = chainRowsByExpiry(rows, { ticker: sym, sessionDate });
    const p = parityRate(chain.expiries, { spot, asOfMs, symbol: sym });
    if (p) return chooseRate({ parity: p });
  }
  return chooseRate({ treasury: treasuryRate(treasuryRaw) });
}

export function preparePass({ rowsByTicker, sessionDate, rate, spotOf, atrOf, expiriesOf, eventOf = () => null } = {}) {
  const asOfMs = closeUtcMs(sessionDate);
  const preps = new Map();
  for (const ticker of [...rowsByTicker.keys()].sort()) {
    const spot = spotOf(ticker);
    if (!(spot > 0)) continue;
    const chain = chainRowsByExpiry(rowsByTicker.get(ticker), { ticker, sessionDate });
    if (!chain.expiries.length) continue;
    const event = eventOf(ticker);
    const { built, input } = buildSlices(chain.expiries, { spot, asOfMs, rate: rate.r, event });
    if (!built.length) continue;
    const book = openInterestGammaBook(expiriesOf(ticker) || [], { asOf: sessionDate });
    const zero = zeroGammaOf(built, { spot, atr: atrOf(ticker), vendorGross: book.gross });
    const near30 = built.slice().sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30) || a.T - b.T)[0];
    const sk = near30 && near30.slice.method !== "mixture" && near30.slice.method !== "flat" ? skewMetrics(near30.slice) : null;
    preps.set(ticker, { ticker, spot, asOfMs, chain, input, built, zero, rr25: sk ? sk.rr25 : null, contracts: chain.contracts });
  }
  const xs = crossSection(preps);
  return { preps, crossSection: xs };
}

export function crossSection(preps) {
  const vals = [...preps.values()].filter((p) => fin(p.rr25));
  const out = new Map();
  if (vals.length < QUANT_CARD_LINES.XS_MIN_NAMES) {
    for (const t of preps.keys()) out.set(t, { rr25Pct: null, why: "xs.too-few" });
    return out;
  }
  const sorted = vals.map((p) => p.rr25).sort((a, b) => a - b);
  for (const [t, p] of preps) {
    if (!fin(p.rr25)) { out.set(t, { rr25Pct: null, why: "skew.no-slice" }); continue; }
    let below = 0;
    for (const v of sorted) if (v <= p.rr25) below++;
    out.set(t, { rr25Pct: below / sorted.length, why: null, n: sorted.length });
  }
  return out;
}

export function engineBlock({ ticker, sessionDate, spot, atr, card, prep, rate, garch, law, event, state, strikes, crossSection: xs = null }) {
  if (!prep || !prep.built || !prep.built.length) return null;
  const asOfDay = sessionDate;
  const jump = eventJump(prep.built, event);
  const book = bookLevels(strikes, { spot });
  const facts = engineFacts({
    built: prep.built, spot, atr, card, garch, zero: prep.zero, book, event, jump, asOfDay,
    crossSection: xs || {},
  });
  const levels = engineLevels({ book, zero: prep.zero, card, atr });
  return runCardEngine({
    ticker, asOfMs: prep.asOfMs, spot, rate, expiries: prep.input, facts, state, pLaw: law, levels,
    event: engineEvent(event, jump, facts), zeroGamma: prep.zero ? { px: prep.zero.px, count: prep.zero.count, coverage: prep.zero.coverage, g: prep.zero.g } : null,
    atr, stale: false,
  });
}

const ENCODER = new TextEncoder();
export const bytesOf = (value) => ENCODER.encode(JSON.stringify(value)).length;

export function attachEngine(card, block, { cap = QUANT_PIPELINE_LINES.INGEST_CAP } = {}) {
  if (!block) return { card, extra: null, bytes: bytesOf(card), split: false };
  const whole = { ...card, engine: block };
  const bytes = bytesOf(whole);
  if (bytes <= cap) return { card: whole, extra: null, bytes, split: false };
  const extra = { ticker: card.ticker, sessionDate: card.sessionDate, generatedAt: card.generatedAt, engine: block };
  const pointer = { status: "split", key: "card-x:" + card.ticker, bytes: bytesOf(extra) };
  const slim = { ...card, engine: pointer };
  return { card: slim, extra, bytes: bytesOf(slim), split: true };
}
