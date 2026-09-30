import {
  numOrNull, parseOptionSymbol, intrinsic, impossibleQuote, optionRoot, PRICING_RATE,
} from "./flows-premium.js";
import { impliedVolB76, black76, normPdf } from "./flows-quant-bs.js";
import { closeUtcMs, etDayOf, nyseEarlyCloses, parseDay, yearFraction } from "./flows-quant-time.js";
import { regularSessionRows, candleDay } from "./flows-vol.js";

export { intrinsic };

export const BASIS_TOLERANCE = 0.0025;
export const FIT_MIN_QUOTES = 6;
export const FIT_MIN_EXPIRIES = 3;
export const FIT_FILL_QUOTES = 9;
export const FIT_MAX_EXPIRIES = 5;
export const FIT_PER_EXPIRY = 10;
export const FIT_WINDOW = 0.05;
export const FIT_GRID_STEP = 0.02;
export const FIT_TOLERANCE = 2e-4;
export const FIT_MAX_REL_RMS = 0.1;
export const FIT_MIN_GAIN = 3;
export const SMILE_MIN_QUOTES = 8;
export const SMILE_MIN_VALID = 5;
export const EVIDENCE_OFF_MARKET = 2;

const REGULAR = new Set(["r", "regular"]);

export function isRegularSession(marketTime) {
  return typeof marketTime === "string" && REGULAR.has(marketTime.trim().toLowerCase());
}

export function stateOf(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const d = s.data;
  return d && typeof d === "object" && !Array.isArray(d) ? d : s;
}

function tapeMs(tape) {
  if (typeof tape !== "string" || !tape.trim()) return NaN;
  return Date.parse(tape.trim().replace(" ", "T"));
}

function closeClock(day) {
  const p = parseDay(day);
  return p && nyseEarlyCloses(p.y).has(day) ? "1:00 pm ET" : "4:00 pm ET";
}

export function printOf({ state, bars, readMs = null } = {}) {
  const live = stateOf(state);
  const liveClose = numOrNull(live && live.close);
  const marketTime = live && live.market_time ? String(live.market_time) : null;
  const tapeTime = live && live.tape_time ? String(live.tape_time) : null;

  if (liveClose !== null && liveClose > 0 && isRegularSession(marketTime)) {
    const t = tapeMs(tapeTime);
    const sessionDate = Number.isFinite(t) ? etDayOf(t) : Number.isFinite(readMs) ? etDayOf(readMs) : null;
    return {
      spot: liveClose, source: "stock-state", note: "live print, regular session",
      sessionDate, marketTime, tapeTime,
    };
  }

  let best = null;
  for (const b of regularSessionRows(Array.isArray(bars) ? bars : [])) {
    const close = numOrNull(b.close ?? b.c);
    const day = candleDay(b) || (typeof b.timestamp === "string" ? b.timestamp.slice(0, 10) : null);
    if (close === null || !(close > 0) || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const explicit = isRegularSession(b.market_time);
    if (best === null || day > best.day || (day === best.day && explicit && !best.explicit)) {
      best = { close, day, explicit };
    }
  }
  if (best === null) return null;

  const readDay = Number.isFinite(readMs) ? etDayOf(readMs) : null;
  const finished = readDay === null || best.day < readDay || (best.day === readDay && readMs >= closeUtcMs(best.day));
  if (best.explicit && finished) {
    const clock = closeClock(best.day);
    return {
      spot: best.close, source: "regular-close",
      note: readDay === best.day ? `regular close ${clock}` : `regular close ${clock} on ${best.day}`,
      sessionDate: best.day, marketTime, tapeTime,
    };
  }
  return {
    spot: best.close, source: "daily-bar",
    note: best.explicit ? `regular-session bar of ${best.day}, session still trading` : `daily bar of ${best.day}, session not stated`,
    sessionDate: best.day, marketTime, tapeTime,
  };
}

function standingQuotes(rows, ticker) {
  const want = optionRoot(ticker) || null;
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = parseOptionSymbol(r && r.option_symbol);
    if (!p || (want !== null && p.ticker !== want)) continue;
    const bid = numOrNull(r.nbbo_bid), ask = numOrNull(r.nbbo_ask);
    out.push({ ...p, symbol: String(r.option_symbol), bid, ask });
  }
  return out;
}

function impossibleAt(quotes, S) {
  if (!(S > 0)) return [];
  return quotes
    .filter((q) => q.ask !== null && impossibleQuote(q.type, S, q.strike, q.ask))
    .map((q) => q.symbol);
}

export function offMarket(rows, S, ticker = null) {
  return impossibleAt(standingQuotes(rows, ticker), S);
}

function strikeStep(strikes, near) {
  const distinct = Array.from(new Set(strikes)).sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < distinct.length; i++) {
    const gap = distinct[i] - distinct[i - 1];
    if (gap > 1e-9 && Math.abs(distinct[i] - near) <= near * 0.05 && gap < step) step = gap;
  }
  return Number.isFinite(step) ? step : near * 0.005;
}

export function bracket(rows, S, ticker = null) {
  return bracketOf(standingQuotes(rows, ticker), S);
}

function bracketOf(quotes, S) {
  const puts = quotes.filter((q) => q.type === "P").map((q) => q.strike);
  const calls = quotes.filter((q) => q.type === "C").map((q) => q.strike);
  const itm = quotes.filter((q) => intrinsic(q.type, S, q.strike) > 0).length;
  if (!puts.length || !calls.length || !(S > 0)) {
    return { bracketed: false, low: null, high: null, step: null, outside: 0, itm, flagged: false };
  }
  const low = Math.max(...puts), high = Math.min(...calls);
  if (low > high) return { bracketed: false, low, high, step: null, outside: 0, itm, flagged: false };
  const step = strikeStep(quotes.map((q) => q.strike), (low + high) / 2);
  const outside = S < low ? low - S : S > high ? S - high : 0;
  return { bracketed: true, low, high, step, outside, itm, flagged: outside > step + 1e-9 };
}

function fitQuotes(quotes, { readMs, near }) {
  const byExpiry = new Map();
  const today = etDayOf(readMs);
  for (const q of quotes) {
    if (q.bid === null || q.ask === null || !(q.bid > 0) || !(q.ask >= q.bid)) continue;
    if (!(q.expiry > today)) continue;
    const years = yearFraction(readMs, q.expiry);
    if (!(years > 0)) continue;
    let g = byExpiry.get(q.expiry);
    if (!g) { g = { expiry: q.expiry, years, quotes: [] }; byExpiry.set(q.expiry, g); }
    g.quotes.push({ K: q.strike, type: q.type, mid: (q.bid + q.ask) / 2, years, symbol: q.symbol, seed: null });
  }
  const groups = Array.from(byExpiry.values()).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  const chosen = [];
  let count = 0;
  for (const g of groups) {
    if (!(chosen.length < FIT_MIN_EXPIRIES || (count < FIT_FILL_QUOTES && chosen.length < FIT_MAX_EXPIRIES))) break;
    const closer = (a, b) => Math.abs(Math.log(a.K / near)) - Math.abs(Math.log(b.K / near));
    const half = FIT_PER_EXPIRY / 2;
    g.quotes = [
      ...g.quotes.filter((q) => q.type === "P").sort(closer).slice(0, half),
      ...g.quotes.filter((q) => q.type === "C").sort(closer).slice(0, half),
    ];
    g.xs = new Array(g.quotes.length); g.ys = new Array(g.quotes.length);
    g.ws = new Array(g.quotes.length); g.ivs = new Array(g.quotes.length);
    chosen.push(g);
    count += g.quotes.length;
  }
  return chosen;
}

function smileCoefficients(xs, ys, ws, count, quadratic) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < count; i++) {
    const x = xs[i], w = ws[i], y = ys[i], wx = w * x, wxx = wx * x;
    s0 += w; s1 += wx; s2 += wxx; s3 += wxx * x; s4 += wxx * x * x;
    t0 += w * y; t1 += wx * y; t2 += wxx * y;
  }
  if (!(s0 > 0)) return null;
  if (quadratic) {
    const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
    if (Math.abs(det) > 1e-18 * s0 * s2 * s4) {
      const a = (t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - s3 * t2) + s2 * (t1 * s3 - s2 * t2)) / det;
      const b = (s0 * (t1 * s4 - s3 * t2) - t0 * (s1 * s4 - s3 * s2) + s2 * (s1 * t2 - t1 * s2)) / det;
      const c = (s0 * (s2 * t2 - t1 * s3) - s1 * (s1 * t2 - t1 * s2) + t0 * (s1 * s3 - s2 * s2)) / det;
      if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) return [a, b, c];
    }
  }
  return [t0 / s0, 0, 0];
}

function residuals(groups, S, rate) {
  let sum = 0, n = 0, mids = 0, cannot = 0;
  for (const g of groups) {
    const F = S * Math.exp(rate * g.years), D = Math.exp(-rate * g.years), root = Math.sqrt(g.years);
    const quotes = g.quotes, count = quotes.length;
    const xs = g.xs, ys = g.ys, ws = g.ws, ivs = g.ivs;
    let valid = 0, top = 0;
    for (let i = 0; i < count; i++) {
      const q = quotes[i];
      const iv = impliedVolB76(F, D, q.K, q.years, q.mid, q.type, q.seed);
      ivs[i] = iv;
      if (iv === null) { cannot += 1; continue; }
      q.seed = iv;
      const nu = iv * root;
      const vega = D * F * normPdf(Math.log(F / q.K) / nu + nu / 2) * root;
      xs[valid] = Math.log(q.K / F); ys[valid] = iv; ws[valid] = vega * vega;
      if (ws[valid] > top) top = ws[valid];
      valid += 1;
    }
    let coef = null;
    if (valid) {
      for (let i = 0; i < valid; i++) ws[i] /= top;
      coef = smileCoefficients(xs, ys, ws, valid, count >= SMILE_MIN_QUOTES && valid >= SMILE_MIN_VALID);
    }
    for (let i = 0; i < count; i++) {
      const q = quotes[i];
      const x = Math.log(q.K / F);
      const fitted = coef === null ? 0.2 : coef[0] + x * (coef[1] + x * coef[2]);
      const model = black76(F, D, q.K, fitted < 0.01 ? 0.01 : fitted > 5 ? 5 : fitted, q.years, q.type);
      const gap = model === null ? 0 : model - q.mid;
      sum += gap * gap;
      mids += q.mid;
    }
    n += count;
  }
  return { sum, n, mids, cannot };
}

export function fitUnderlying({ rows, spot, readMs, rate = PRICING_RATE, ticker = null } = {}) {
  return fitQuotesAt(standingQuotes(rows, ticker), { spot, readMs, rate });
}

function fitQuotesAt(all, { spot, readMs, rate = PRICING_RATE }) {
  const none = (reason, extra = {}) => ({
    ok: false, reason, spot: null, quotes: 0, expiries: 0, puts: 0, calls: 0, rms: null, relRms: null, ...extra,
  });
  if (!(spot > 0) || !Number.isFinite(readMs)) return none("no spot or read time to fit against");
  const groups = fitQuotes(all, { readMs, near: spot });
  const quotes = groups.reduce((n, g) => n + g.quotes.length, 0);
  const puts = groups.reduce((n, g) => n + g.quotes.filter((q) => q.type === "P").length, 0);
  const calls = quotes - puts;
  const counts = { quotes, expiries: groups.length, puts, calls };
  if (quotes < FIT_MIN_QUOTES) return none(`only ${quotes} two-sided quotes on the nearest expiries`, counts);
  if (!puts || !calls) return none(`the fitted quotes are all ${puts ? "puts" : "calls"}, so one wing cannot place the underlying`, counts);

  const lo = spot * (1 - FIT_WINDOW), hi = spot * (1 + FIT_WINDOW);
  const step = spot * FIT_GRID_STEP;
  let bestS = lo, bestSum = Infinity, index = 0, bestIndex = 0;
  for (let S = lo; S <= hi + 1e-9; S += step, index++) {
    const r = residuals(groups, S, rate);
    if (r.sum < bestSum) { bestSum = r.sum; bestS = S; bestIndex = index; }
  }
  const last = index - 1;
  if (bestIndex === 0 || bestIndex === last) return none("the best-fitting underlying sits on the edge of the search window", counts);

  let a = bestS - step, b = bestS + step;
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a), d = a + phi * (b - a);
  let fc = residuals(groups, c, rate).sum, fd = residuals(groups, d, rate).sum;
  for (let i = 0; i < 40 && b - a > spot * FIT_TOLERANCE; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = residuals(groups, c, rate).sum; }
    else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = residuals(groups, d, rate).sum; }
  }
  const S = (a + b) / 2;
  const r = residuals(groups, S, rate);
  const rms = Math.sqrt(r.sum / r.n);
  const relRms = rms / (r.mids / r.n);
  if (!(relRms <= FIT_MAX_REL_RMS)) {
    return none(`no single underlying reproduces these quotes (typical miss ${(relRms * 100).toFixed(0)}% of the price)`, { ...counts, rms, relRms });
  }
  const atPrint = residuals(groups, spot, rate).sum;
  return { ok: true, reason: null, spot: S, ...counts, rms, relRms, impossible: r.cannot, gain: r.sum > 0 ? atPrint / r.sum : Infinity };
}

const to4 = (x) => Math.round(x * 1e4) / 1e4;

export function coherence({
  rows, spot, asOf = null, printSource = null, readMs = null, rate = PRICING_RATE, ticker = null,
} = {}) {
  const at = Number.isFinite(readMs) ? readMs : asOf ? closeUtcMs(String(asOf).slice(0, 10)) : null;
  const quotes = standingQuotes(rows, ticker);
  const off = impossibleAt(quotes, spot);
  const br = bracketOf(quotes, spot);
  const fit = fitQuotesAt(quotes, { spot, readMs: at, rate });
  const evidence = br.flagged || off.length >= EVIDENCE_OFF_MARKET;

  let status = "ok", used = spot;
  if (fit.ok) {
    if (Math.abs(fit.spot / spot - 1) > BASIS_TOLERANCE && fit.gain >= FIT_MIN_GAIN) { status = "rebased"; used = to4(fit.spot); }
  } else if (evidence) {
    status = "mismatch";
  }
  return {
    status, spot: used, printSpot: spot, printSource,
    impliedSpot: fit.ok ? to4(fit.spot) : null,
    offMarket: off, bracket: br,
    fit: { ok: fit.ok, reason: fit.reason, quotes: fit.quotes, expiries: fit.expiries, puts: fit.puts, calls: fit.calls, rms: fit.rms, relRms: fit.relRms, gain: fit.gain ?? null },
  };
}
