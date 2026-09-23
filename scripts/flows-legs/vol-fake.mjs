import { addDays, dayDiff, eventDayOf } from "../../shared/flows-vol.js";

function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());

const isWeekday = (d) => { const w = new Date(d + "T00:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };

export function weekdaysEnding(end, count) {
  const out = [];
  let d = end;
  while (out.length < count && d) { if (isWeekday(d)) out.push(d); d = addDays(d, -1); }
  return out.reverse();
}

function weekdaysBetween(from, to) {
  const out = [];
  let d = from;
  while (d && d <= to) { if (isWeekday(d)) out.push(d); d = addDays(d, 1); }
  return out;
}

function addWeekdays(day, n) {
  let d = day, k = 0;
  while (k < n) { d = addDays(d, 1); if (isWeekday(d)) k++; }
  return d;
}

function thirdFriday(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (5 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + 14)).toISOString().slice(0, 10);
}

export function fakeListedExpiries(sessionDate, count = 16) {
  const set = new Set();
  let d = addDays(sessionDate, 1);
  while (set.size < 4) { if (new Date(d + "T00:00:00Z").getUTCDay() === 5) set.add(d); d = addDays(d, 1); }
  const s = new Date(sessionDate + "T00:00:00Z");
  for (let k = 0; set.size < count && k < 24; k++) {
    const tf = thirdFriday(s.getUTCFullYear(), s.getUTCMonth() + k);
    if (tf > sessionDate) set.add(tf);
  }
  return [...set].sort();
}

const str = (x, dp = 6) => (Number.isFinite(x) ? x.toFixed(dp) : null);

function distribution(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const q = (p) => {
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  };
  const last = values[values.length - 1];
  return {
    min: sorted[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: sorted[sorted.length - 1],
    percentile: values.filter((v) => v <= last).length / values.length, last,
  };
}

function profile(ticker) {
  const seed = seedOf(ticker);
  const r = rng(seed);
  return {
    seed, r,
    base: 0.18 + r() * 0.42,
    px: 20 + r() * 480,
    rrBase: 0.01 + r() * 0.05,
    flags: {
      anomalyRefused: seed % 29 === 3,
      sentimentUnreadable: seed % 31 === 5,
      rr10Failed: seed % 23 === 7,
      callSkew: seed % 19 === 2,
      shortVrp: seed % 17 === 4,
      lowSample: seed % 13 === 6,
    },
  };
}

function fakeCandles(ticker, sessionDate) {
  const p = profile(ticker);
  const r = rng(p.seed ^ 0x5bd1e995);
  const days = weekdaysEnding(sessionDate, 504);
  const daily = p.base / Math.sqrt(252);
  let s2 = daily * daily, close = p.px, shock = 0;
  const rows = [];
  for (const d of days) {
    s2 = daily * daily * 0.06 + 0.08 * shock * shock + 0.86 * s2;
    const sd = Math.sqrt(s2);
    const gap = gauss(r) * sd * 0.45;
    const intra = gauss(r) * sd * 0.85;
    const open = close * Math.exp(gap);
    const next = open * Math.exp(intra);
    const high = Math.max(open, next) * Math.exp(Math.abs(gauss(r)) * sd * 0.35);
    const low = Math.min(open, next) * Math.exp(-Math.abs(gauss(r)) * sd * 0.35);
    shock = Math.log(next / close);
    const volume = Math.round(2e6 + r() * 3e7);
    rows.push({ close: str(next, 2), high: str(high, 2), low: str(low, 2), open: str(open, 2), date: d,
      volume, total_volume: volume, market_time: "r" });
    const pre = Math.round(volume * 0.02);
    rows.push({ close: str(open * 1.001, 2), high: str(open * 1.003, 2), low: str(open * 0.997, 2), open: str(close, 2),
      date: d, volume: pre, total_volume: pre, market_time: "pr" });
    const post = Math.round(volume * 0.015);
    rows.push({ close: str(next * 0.999, 2), high: str(next * 1.002, 2), low: str(next * 0.996, 2), open: str(next, 2),
      date: d, volume: post, total_volume: post, market_time: "po" });
    close = next;
  }
  return rows.reverse();
}

function eventJump(ticker) {
  return 0.045 + rng(profile(ticker).seed ^ 0x165667b1)() * 0.05;
}

function fakeCone(ticker, sessionDate, earnings) {
  const p = profile(ticker);
  const r = rng(p.seed ^ 0x27d4eb2d);
  const mult = [1.08, 1.0, 0.98, 0.97, 0.95, 0.94];
  const samples = p.flags.lowSample ? 150 : 251;
  const eventDay = eventDayOf(earnings);
  const eventIn = eventDay && eventDay > sessionDate ? dayDiff(sessionDate, eventDay) : null;
  const jump = eventJump(ticker);
  return [7, 30, 60, 90, 180, 365].map((days, i) => {
    const mu = p.base * mult[i];
    const vals = [];
    let v = mu * (0.8 + r() * 0.4);
    for (let k = 0; k < samples; k++) {
      v = mu + 0.965 * (v - mu) + gauss(r) * mu * 0.035 * (i === 0 ? 1.6 : 1);
      vals.push(Math.max(0.05, v));
    }
    if (eventIn !== null && eventIn <= days) {
      const T = days / 365;
      vals[vals.length - 1] = Math.sqrt(vals[vals.length - 1] ** 2 + (jump * jump) / T);
    }
    const dist = distribution(vals);
    return {
      max: String(dist.max), min: String(dist.min), date: sessionDate, ticker, days,
      median: str(dist.median), percentile: str(dist.percentile, 4), volatility: str(dist.last, 3),
      samples, first_date: addDays(sessionDate, -(samples === 251 ? 364 : 217)),
      q1: str(dist.q1), q3: str(dist.q3),
    };
  });
}

function fakeTerm(ticker, sessionDate, earnings) {
  const p = profile(ticker);
  const r = rng(p.seed ^ 0x165667b1);
  const expiries = fakeListedExpiries(sessionDate, 16);
  const eventDay = eventDayOf(earnings);
  const jump = eventJump(ticker);
  r();
  const firstEvent = eventDay ? expiries.find((e) => e >= eventDay) : null;
  return expiries.map((expiry) => {
    const dte = dayDiff(sessionDate, expiry);
    const T = dte / 365;
    const baseVol = p.base * (0.95 + 0.12 * Math.exp(-T * 4)) * (1 + (r() - 0.5) * 0.02);
    const withEvent = eventDay && expiry >= eventDay;
    const vol = withEvent ? Math.sqrt(baseVol * baseVol + (jump * jump) / T) : baseVol;
    const monthly = /-(1[5-9]|2[01])$/.test(expiry) && new Date(expiry + "T00:00:00Z").getUTCDay() === 5;
    const samples = monthly ? Math.min(251, 60 + Math.floor(dte * 0.8) + 100) : Math.max(4, 25 - Math.floor(dte / 3));
    const pct = expiry === firstEvent ? 0.9 + r() * 0.08 : 0.3 + r() * 0.3;
    const spread = vol * 0.12;
    return {
      max: String(vol + spread * 1.8), min: String(vol - spread * 1.6), date: sessionDate, ticker,
      median: str(vol - spread * (pct - 0.5)), percentile: str(pct, 4), volatility: String(vol),
      expiry, samples, first_date: addDays(sessionDate, -Math.round(samples * 1.4)), dte,
      q1: str(vol - spread * (pct - 0.5) - spread * 0.5), q3: str(vol - spread * (pct - 0.5) + spread * 0.5),
    };
  });
}

function fakeVrp(ticker, sessionDate, days) {
  const p = profile(ticker);
  const r = rng(p.seed ^ 0x9e3779b1);
  const all = weekdaysEnding(sessionDate, 251);
  const rows = [];
  let iv = p.base;
  for (const d of all) {
    iv = Math.max(0.06, p.base + 0.95 * (iv - p.base) + gauss(r) * p.base * 0.03);
    const realizedDate = addWeekdays(d, 20);
    if (realizedDate > sessionDate) continue;
    const rv = Math.max(0.04, iv - (0.015 + gauss(r) * 0.035));
    rows.push({
      date: d, ticker, rank: String(r()), implied_volatility: str(iv),
      realized_volatility: str(rv), realized_volatility_days: Number(days) || 21, implied_volatility_days: 30,
      realized_date: realizedDate, risk_premium: str(iv - rv),
    });
  }
  return p.flags.shortVrp ? rows.slice(-40) : rows;
}

function fakeRr(ticker, sessionDate, expiry, delta) {
  const p = profile(ticker);
  const r = rng(p.seed ^ (delta === 10 ? 0x85ebca6b : 0xc2b2ae35));
  const listed = addDays(expiry, -240);
  const dates = weekdaysBetween(listed, sessionDate);
  let level = p.rrBase * (p.flags.callSkew ? -0.6 : 1);
  return dates.map((d) => {
    level = level + 0.08 * ((p.flags.callSkew ? -0.6 : 1) * p.rrBase - level) + gauss(r) * 0.0025;
    const rr = delta === 10 ? level * (2.6 + r() * 0.8) : level;
    return { date: d, ticker, delta, risk_reversal: String(rr) };
  });
}

function fakeComposite(kind, ticker, sessionDate) {
  const p = profile(ticker);
  const r = rng(p.seed ^ seedOf(kind));
  const updated = sessionDate + "T23:15:10.809504Z";
  if (kind === "anomaly") {
    const hist = weekdaysEnding(sessionDate, 68).map((d) => {
      const s = (r() - 0.5) * 140;
      return { date: d, direction: s > 20 ? "short_vol" : s < -20 ? "long_vol" : "neutral", score: String(s) };
    });
    const last = hist[hist.length - 1];
    return { data: { history: hist, latest: {
      date: sessionDate, ticker, direction: last.direction, updated_at: updated, score: last.score, sample_size: 5,
      components: {
        iv_percentile: { raw: Math.round(r() * 1000) / 10, value: r() * 2 - 1 },
        regime_score: { crash_probability: Math.round(r() * 100) / 100, raw: r() - 0.5, value: r() - 0.5 },
        skew_percentile: { percentile: Math.round(r() * 100) / 100, raw: r(), value: r() * 2 - 1 },
        vov_percentile: { raw: r() * 100, value: r() - 0.5 },
        vrp_z: r() < 0.2 ? null : { mean: 0.02, raw: r() * 2, std: 0.48, value: r() * 2 - 1 },
      } } } };
  }
  if (kind === "option-sentiment") {
    const hist = weekdaysEnding(sessionDate, 174).map((d) => {
      const s = (r() - 0.45) * 90;
      return { date: d, direction: s > 25 ? "bullish" : s < -25 ? "bearish" : "neutral", score: s.toFixed(2),
        vwks: str((r() - 0.5) * 0.08), avar: str((r() - 0.5) * 0.02, 5) };
    });
    const last = hist[hist.length - 1];
    return { data: { history: hist, latest: {
      date: sessionDate, ticker, direction: last.direction, updated_at: updated, score: last.score,
      vwks: last.vwks, avar: last.avar, sample_size: 12,
      components: { avar: { norm: Math.round(r() * 100) / 100, value: Number(last.avar) },
        vwks: { norm: Math.round(r() * 100) / 100, value: Number(last.vwks) } } } } };
  }
  const labels = ["mean-reverting", "moderate", "persistent"];
  const hist = weekdaysEnding(sessionDate, 67).map((d) => {
    const hl = 5 + r() * 50;
    return { date: d, character: hl < 12 ? labels[0] : hl > 38 ? labels[2] : labels[1],
      half_life_days: String(hl), hurst_rv: String(0.35 + r() * 0.35) };
  });
  const last = hist[hist.length - 1];
  return { data: { history: hist, latest: {
    date: sessionDate, character: last.character, ticker, updated_at: updated,
    half_life_days: last.half_life_days, hurst_rv: last.hurst_rv, entropy_negative: String(r()),
    sample_size: 250, ar1_b: String(0.9 + r() * 0.09), entropy_conditional: String(r() * 2), entropy_samples: 240 } } };
}

function fakeIvRank(ticker, sessionDate) {
  const p = profile(ticker);
  const r = rng(p.seed ^ 0x7feb352d);
  let iv = p.base, px = p.px;
  const rows = weekdaysEnding(sessionDate, 251).map((d) => {
    const e = gauss(r);
    iv = Math.max(0.05, p.base + 0.93 * (iv - p.base) + e * p.base * 0.04);
    px = px * Math.exp(-e * 0.012 + gauss(r) * 0.01);
    return { d, iv, px };
  });
  const lo = Math.min(...rows.map((x) => x.iv)), hi = Math.max(...rows.map((x) => x.iv));
  return rows.map((x) => ({
    close: str(x.px, 2), date: x.d, updated_at: x.d + "T22:35:04.325313Z", volatility: str(x.iv, 4),
    iv_rank_1y: str(hi > lo ? ((x.iv - lo) / (hi - lo)) * 100 : 50, 4),
  }));
}

const RADAR_NAMES = Object.freeze(["SYN001", "SYN004", "SYN009", "SYN016", "SYN025", "SYN036", "SPY", "SOXS", "ORBS", "XLE"]);

function fakeRadar(kind, direction, sessionDate) {
  const r = rng(seedOf(kind + direction));
  const n = kind === "anomaly" ? 4 + Math.floor(r() * 5) : 12;
  const rows = RADAR_NAMES.slice(0, n).map((t) => {
    if (kind === "anomaly") {
      const s = (direction === "short_vol" ? 1 : -1) * (30 + r() * 50);
      return { date: sessionDate, ticker: t, direction, updated_at: sessionDate + "T23:15:10.809504Z", score: String(s), sample_size: 5,
        components: {
          iv_percentile: { raw: r() * 100, value: r() * 2 - 1 },
          regime_score: { crash_probability: 0.5, raw: r() - 0.5, value: r() - 0.5 },
          skew_percentile: { percentile: r(), raw: r(), value: r() * 2 - 1 },
          vov_percentile: { raw: r() * 100, value: r() - 0.5 },
          vrp_z: { mean: 0.019, raw: r() * 2, std: 0.48, value: r() * 2 - 1 },
        } };
    }
    const s = (direction === "bullish" ? 1 : -1) * (40 + r() * 60);
    const vwks = (direction === "bullish" ? 1 : -1) * r() * 0.2;
    const avar = (direction === "bullish" ? 1 : -1) * r() * 0.4;
    return { date: sessionDate, ticker: t, direction, updated_at: sessionDate + "T23:20:01.005530Z", score: s.toFixed(1),
      vwks: str(vwks), avar: str(avar, 5), sample_size: 12,
      components: { avar: { norm: 1, value: avar }, vwks: { norm: 1, value: vwks } } };
  });
  return kind === "anomaly" ? { data: rows, date: sessionDate, direction } : { data: rows, date: sessionDate };
}

const refuse = (path, status) => { throw new Error(`${path} -> HTTP ${status}`); };

export function fakeVolVendor({ sessionDate, names = [] } = {}) {
  const earningsOf = new Map(names.map((n) => [n.ticker, n.earnings || null]));
  return async (path, params = {}) => {
    const day = params.date || params.end_date || sessionDate;
    let m;
    if ((m = /^\/api\/stock\/([^/]+)\/interpolated-iv\/distribution$/.exec(path))) {
      const t = decodeURIComponent(m[1]);
      return { data: fakeCone(t, day, earningsOf.get(t)) };
    }
    if ((m = /^\/api\/stock\/([^/]+)\/volatility\/term-structure\/distribution$/.exec(path))) {
      const t = decodeURIComponent(m[1]);
      return { data: fakeTerm(t, day, earningsOf.get(t)) };
    }
    if ((m = /^\/api\/stock\/([^/]+)\/volatility\/variance-risk-premium$/.exec(path))) {
      if (![1, 3, 5, 10, 21, 42, 63, 126, 251].includes(Number(params.days))) refuse(path, 422);
      return { data: fakeVrp(decodeURIComponent(m[1]), day, params.days) };
    }
    if ((m = /^\/api\/stock\/([^/]+)\/historical-risk-reversal-skew$/.exec(path))) {
      const t = decodeURIComponent(m[1]);
      if (!params.expiry || ![10, 25].includes(Number(params.delta))) refuse(path, 422);
      if (Number(params.delta) === 10 && profile(t).flags.rr10Failed) refuse(path, 500);
      return { data: fakeRr(t, day, params.expiry, Number(params.delta)) };
    }
    if ((m = /^\/api\/stock\/([^/]+)\/volatility\/(anomaly|option-sentiment|character)$/.exec(path))) {
      const t = decodeURIComponent(m[1]);
      const f = profile(t).flags;
      if (m[2] === "anomaly" && f.anomalyRefused) refuse(path, 403);
      if (m[2] === "option-sentiment" && f.sentimentUnreadable) return { data: "unexpected" };
      return fakeComposite(m[2], t, day);
    }
    if ((m = /^\/api\/stock\/([^/]+)\/iv-rank$/.exec(path))) {
      if (params.timespan !== "1y") refuse(path, 422);
      return { data: fakeIvRank(decodeURIComponent(m[1]), day) };
    }
    if ((m = /^\/api\/stock\/([^/]+)\/ohlc\/1d$/.exec(path))) {
      if (params.timeframe !== "2Y") refuse(path, 422);
      return { data: fakeCandles(decodeURIComponent(m[1]), day) };
    }
    if (path === "/api/volatility/anomaly/top") {
      if (!["short_vol", "long_vol"].includes(params.direction)) refuse(path, 422);
      return fakeRadar("anomaly", params.direction, day);
    }
    if (path === "/api/volatility/option-sentiment/top") {
      return fakeRadar("sentiment", params.direction || "neutral", day);
    }
    return refuse(path, 404);
  };
}
