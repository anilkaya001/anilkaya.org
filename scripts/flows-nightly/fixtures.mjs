import { nextTradingDay } from "../../shared/flows-freshness.js";
import { blackScholesGreeks } from "../../shared/flows-variation.js";
import { CHAIN_PAGE_SIZE } from "../../shared/flows-chain.js";
import { black76 } from "../../shared/flows-quant-bs.js";
import { ALERT_VENDOR_LIMIT, NEWS_VENDOR_LIMIT, UNIVERSE } from "./vendor-params.mjs";
import { BOARD_SCHEMA_VERSION, SECTOR_ETFS } from "./rank.mjs";

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SECTORS = ["Technology", "Healthcare", "Energy", "Financials", "Consumer Cyclical", "Industrials"];

export const DRY_FOCUS_ROWS = Object.freeze([
  ["NVDA", 186.2, 4.4e12, "Technology", "NVIDIA Corporation"],
  ["AAPL", 254.1, 3.8e12, "Technology", "Apple Inc."],
  ["MSFT", 509.9, 3.7e12, "Technology", "Microsoft Corporation"],
  ["AMZN", 221.4, 2.4e12, "Consumer Cyclical", "Amazon.com, Inc."],
  ["GOOGL", 342.48, 2.0e12, "Technology", "Alphabet Inc. Class A"],
  ["GOOG", 338.97, 1.88e12, "Technology", "Alphabet Inc. Class C"],
  ["META", 742.3, 1.85e12, "Technology", "Meta Platforms, Inc."],
  ["TSLA", 438.7, 1.4e12, "Consumer Cyclical", "Tesla, Inc."],
  ["AVGO", 339.5, 1.6e12, "Technology", "Broadcom Inc."],
  ["MU", 1076.6, 1.2e12, "Technology", "Micron Technology, Inc.", 5],
  ["COST", 931.2, 4.1e11, "Consumer Cyclical", "Costco Wholesale Corporation"],
  ["NFLX", 1210.4, 5.1e11, "Technology", "Netflix, Inc."],
  ["NEM", 121.285, 1.28e11, "Basic Materials", "Newmont Corporation"],
  ["AEM", 193.71, 9.69e10, "Basic Materials", "Agnico Eagle Mines Limited"],
  ["PAAS", 47.505, 5.05e8, "Basic Materials", "Pan American Silver Corp."],
  ["WPM", 143.99, 6.54e10, "Basic Materials", "Wheaton Precious Metals Corp."],
  ["FCX", 72.045, 1.03e11, "Basic Materials", "Freeport-McMoRan Inc."],
  ["SCCO", 201.39, 1.68e11, "Basic Materials", "Southern Copper Corporation"],
].map((r) => Object.freeze(r)));

export function fakeFocusRows() {
  const gateOrigin = nextTradingDay(DRY_SESSION_DATE, null);
  const rnd = mulberry(20260925);
  return DRY_FOCUS_ROWS.map(([ticker, price, cap, sector, name, earnIn]) => {
    const callVol = Math.round(20000 + rnd() * 900000);
    const putVol = Math.round(15000 + rnd() * 700000);
    const bull = rnd() * 6e7;
    const bear = rnd() * 6e7;
    const iv = 0.2 + rnd() * 0.35;
    return {
      ticker, full_name: name, close: price.toFixed(2), prev_close: (price * (0.97 + rnd() * 0.06)).toFixed(2),
      marketcap: String(Math.round(cap)), sector, issue_type: "Common Stock", is_index: false,
      call_volume: callVol, put_volume: putVol,
      call_open_interest: Math.round(200000 + rnd() * 3e6), put_open_interest: Math.round(180000 + rnd() * 2e6),
      prev_call_oi: Math.round(200000 + rnd() * 3e6), prev_put_oi: Math.round(180000 + rnd() * 2e6),
      total_open_interest: Math.round(500000 + rnd() * 5e6),
      avg_30_day_call_volume: String(Math.round(callVol * (0.5 + rnd()))),
      avg_30_day_put_volume: String(Math.round(putVol * (0.5 + rnd()))),
      bullish_premium: String(Math.round(bull)), bearish_premium: String(Math.round(bear)),
      net_call_premium: String(Math.round((rnd() - 0.5) * 6e7)), net_put_premium: String(Math.round((rnd() - 0.5) * 4e7)),
      call_premium: String(Math.round(bull + rnd() * 2e7)), put_premium: String(Math.round(bear + rnd() * 2e7)),
      call_volume_ask_side: Math.round(callVol * (0.3 + rnd() * 0.4)), call_volume_bid_side: Math.round(callVol * (0.3 + rnd() * 0.4)),
      put_volume_ask_side: Math.round(putVol * (0.3 + rnd() * 0.4)), put_volume_bid_side: Math.round(putVol * (0.3 + rnd() * 0.4)),
      iv30d: iv.toFixed(4), iv30d_1w: (iv * (0.9 + rnd() * 0.2)).toFixed(4), iv30d_1d: (iv * (0.95 + rnd() * 0.1)).toFixed(4),
      iv30d_1m: (iv * (0.85 + rnd() * 0.3)).toFixed(4), iv_rank: (rnd() * 100).toFixed(4),
      implied_move: (price * iv * 0.06).toFixed(4), implied_move_perc: (iv * 0.06).toFixed(6), volatility: iv.toFixed(4),
      put_call_ratio: (putVol / callVol).toFixed(4), week_52_high: (price * (1.05 + rnd() * 0.3)).toFixed(2),
      week_52_low: (price * (0.5 + rnd() * 0.3)).toFixed(2), relative_volume: (0.5 + rnd() * 2).toFixed(2),
      stock_volume: Math.round(5e6 + rnd() * 8e7),
      next_earnings_date: new Date(Date.parse(gateOrigin + "T00:00:00Z") + (earnIn || 20 + Math.floor(rnd() * 30)) * 86400000)
        .toISOString().slice(0, 10),
    };
  });
}

export function fakeScreener(count) {

  const gateOrigin = nextTradingDay(DRY_SESSION_DATE, null);
  const rnd = mulberry(20260825);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const price = 8 + rnd() * 400;
    const callVol = Math.round(2000 + rnd() * 900000);
    const putVol = Math.round(1500 + rnd() * 700000);
    const bull = rnd() * 4e7;
    const bear = rnd() * 4e7;

    const quoted = i % 97 !== 3;

    const putLeg = i % 61 !== 7;
    const anyPremium = i % 83 !== 11;
    const aggressorSplit = i % 71 !== 5;
    const hasIv = i % 53 !== 9;
    rows.push({
      ticker: "SYN" + String(i).padStart(3, "0"),
      close: price.toFixed(2),
      ...(quoted ? { prev_close: (price * (0.97 + rnd() * 0.06)).toFixed(2) } : {}),
      marketcap: String(Math.round(2e9 + rnd() * 9e11)),
      sector: SECTORS[Math.floor(rnd() * SECTORS.length)],
      issue_type: "Common Stock",
      is_index: false,
      call_volume: callVol,
      put_volume: putVol,
      call_open_interest: Math.round(20000 + rnd() * 3e6),
      put_open_interest: Math.round(18000 + rnd() * 2e6),
      prev_call_oi: Math.round(20000 + rnd() * 3e6),
      prev_put_oi: Math.round(18000 + rnd() * 2e6),
      total_open_interest: Math.round(50000 + rnd() * 5e6),
      avg_30_day_call_volume: String(Math.round(callVol * (0.5 + rnd()))),
      avg_30_day_put_volume: String(Math.round(putVol * (0.5 + rnd()))),
      bullish_premium: String(Math.round(bull)),
      bearish_premium: String(Math.round(bear)),
      ...(anyPremium ? { net_call_premium: String(Math.round((rnd() - 0.5) * 6e7)) } : {}),
      ...(anyPremium && putLeg ? { net_put_premium: String(Math.round((rnd() - 0.5) * 4e7)) } : {}),
      call_premium: String(Math.round(bull + rnd() * 2e7)),
      put_premium: String(Math.round(bear + rnd() * 2e7)),
      ...(aggressorSplit ? {
        call_volume_ask_side: Math.round(callVol * (0.3 + rnd() * 0.4)),
        call_volume_bid_side: Math.round(callVol * (0.3 + rnd() * 0.4)),
        put_volume_ask_side: Math.round(putVol * (0.3 + rnd() * 0.4)),
        put_volume_bid_side: Math.round(putVol * (0.3 + rnd() * 0.4)),
      } : {}),
      ...(hasIv ? { iv30d: (0.18 + rnd() * 0.5).toFixed(4) } : {}),
      iv30d_1w: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1d: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1m: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1d: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1m: (0.18 + rnd() * 0.5).toFixed(4),

      iv_rank: (rnd() * 100).toFixed(4),
      implied_move: (price * (0.02 + rnd() * 0.06)).toFixed(4),
      implied_move_perc: (0.02 + rnd() * 0.06).toFixed(6),
      volatility: (0.18 + rnd() * 0.5).toFixed(4),
      put_call_ratio: (putVol / callVol).toFixed(4),
      week_52_high: (price * (1.05 + rnd() * 0.6)).toFixed(2),
      week_52_low: (price * (0.4 + rnd() * 0.4)).toFixed(2),
      relative_volume: (0.5 + rnd() * 3).toFixed(2),

      next_earnings_date: rnd() > 0.5
        ? new Date(Date.parse(gateOrigin + "T00:00:00Z") + Math.floor(rnd() * 46) * 86400000)
          .toISOString().slice(0, 10)
        : null,
    });
  }
  return rows;
}

export function fakeSectorCandles(etf) {
  const i = SECTOR_ETFS.findIndex((s) => s.etf === etf);
  const driftBp = (i - 5) * 12;
  const sessions = etf === "XLRE" ? 20 : 252;

  const rnd = mulberry(90000 + i * 17);
  const vol = mulberry(31337 + i);
  const day0 = Date.UTC(2025, 7, 25, 13, 30);
  let logPx = Math.log(60 + i * 7);
  return Array.from({ length: sessions }, (_, k) => {
    logPx += driftBp / 10000 + (rnd() - 0.5) * 0.006;
    const close = Math.exp(logPx);
    return {
      start_time: new Date(day0 + k * 86400000).toISOString(),
      open: close.toFixed(2),
      close: close.toFixed(2),
      high: (close * 1.006).toFixed(2),
      low: (close * 0.994).toFixed(2),
      volume: Math.round(4e6 + vol() * 3e7),
    };
  });
}

export function fakeSectorEtfs() {
  const rnd = mulberry(4711);

  const BASKETS = [{ sector: "S&P 500 Index", etf: "SPY" }, ...SECTOR_ETFS];
  return { data: BASKETS.map(({ sector, etf }, i) => {
    const last = 40 + i * 9 + rnd() * 5;
    const prev = last * (1 + (rnd() - 0.5) * 0.02);

    const scale = etf === "SPY" ? 3e8 : 1e4 * Math.pow(10, (i % 4));
    const bullish = Math.round(scale * (0.4 + rnd()));
    const bearish = Math.round(scale * (0.4 + rnd()));
    const row = {
      ticker: etf,
      full_name: etf === "SPY" ? "S&P 500 Index" : sector,
      last: last.toFixed(2), prev_close: prev.toFixed(2),
      open: prev.toFixed(2), high: (last * 1.004).toFixed(2), low: (last * 0.996).toFixed(2),
      prev_date: "2026-08-21",
      marketcap: String(Math.round(5e9 + rnd() * 4e11)),
      volume: Math.round(1e6 + rnd() * 4e7),
      call_premium: String(Math.round(scale * 1.1)),
      put_premium: String(Math.round(scale * 0.9)),
      call_volume: Math.round(300 + rnd() * 2e6),
      put_volume: Math.round(300 + rnd() * 2e6),
      avg30_stock_volume: String(Math.round(2e6 + rnd() * 6e7)),
      week52_high: (last * 1.2).toFixed(2), week52_low: (last * 0.7).toFixed(2),
      bullish_premium: String(bullish),
      bearish_premium: String(bearish),
    };
    if (etf === "XLU") { row.bullish_premium = "0"; row.bearish_premium = "0"; }
    if (etf === "XLB") { delete row.bearish_premium; }
    if (etf === "XLRE") { row.bullish_premium = "   "; }
    return row;
  }) };
}

export function fakeNewsHeadlines(tickers) {
  const rnd = mulberry(8123);
  const names = (tickers && tickers.length ? tickers : ["SYN001"]).slice(0, 24);
  const SOURCES = ["BusinessWire", "MarketNews", "Reuters", "Bloomberg", "PRNewswire"];
  const SENTIMENT = ["positive", "negative", "neutral"];
  const TAGS = ["earnings", "guidance", "tech", "federal-reserve", "interest-rates", "m-and-a"];
  const rows = Array.from({ length: NEWS_VENDOR_LIMIT }, (_, i) => {

    const at = Date.UTC(2026, 7, 21, 20, 0, 0) - i * 7 * 60000;
    const withTickers = i % 3 !== 2;
    return {
      created_at: new Date(at).toISOString(),
      headline: `Synthetic headline ${i + 1} about ` +
        (withTickers ? names[Math.floor(rnd() * names.length)] : "the broader tape"),
      source: SOURCES[i % SOURCES.length],
      sentiment: SENTIMENT[i % SENTIMENT.length],
      is_major: i % 7 === 0,
      meta: {},
      tags: [TAGS[i % TAGS.length], TAGS[(i + 3) % TAGS.length]],
      tickers: withTickers
        ? [names[Math.floor(rnd() * names.length)], names[Math.floor(rnd() * names.length)]]
        : [],
    };
  });
  delete rows[5].created_at;
  rows[9].created_at = "not a timestamp";
  rows[12].headline = "";
  rows[17] = null;

  const shuffled = rows.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { data: shuffled };
}

export function fakeChain(ticker, spot, seed, { wide = false, expiry = null, page = 0 } = {}) {
  const rnd = mulberry(seed);
  const rows = [];
  const ladder = wide
    ? [["260831", 7], ["260904", 11], ["260911", 18], ["260918", 25], ["260925", 32],
       ["261016", 53], ["261120", 88], ["261218", 116], ["270115", 144], ["270618", 298]]
    : [["260831", 7], ["260918", 25], ["261016", 53], ["261218", 116]];

  const expiries = expiry
    ? ladder.filter(([code]) => `20${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 6)}` === expiry)
    : ladder;
  for (const [code, dte] of expiries) {
    const halfWidth = wide ? 15 : 8;
    for (let i = -halfWidth; i <= halfWidth; i++) {
      const m = i * 0.035;
      const strike = Math.round(spot * Math.exp(m) * 100) / 100;
      const level = 0.34 - 0.03 * Math.log(dte / 7);

      for (const cp of ["P", "C"]) {
        const isPut = cp === "P";
        const smileVol = level + 0.55 * m * m - 0.22 * m;
        const iv = smileVol + (isPut ? 0.012 : -0.012);
        const T = dte / 365;
        const F = spot * Math.exp(FAKE_RATE * T), D = Math.exp(-FAKE_RATE * T);
        const price = black76(F, D, strike, smileVol, T, cp);
        const half = Math.max(0.01, 0.015 * price);
        const bid = Math.max(0.01, Math.round((price - half) * 100) / 100);
        const ask = Math.max(bid + 0.01, Math.round((price + half) * 100) / 100);

        const traded = rnd() > 0.08;
        const volume = traded ? Math.round(80 + 3000 * Math.exp(-7 * m * m) * rnd()) : 0;
        const row = {
          option_symbol: `${ticker}${code}${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`,

          nbbo_bid: (i === halfWidth && !isPut ? 0 : bid).toFixed(2),
          nbbo_ask: ask.toFixed(2),
          implied_volatility: iv.toFixed(6),
          open_interest: String(400 + Math.round(6000 * Math.exp(-6 * m * m) * (isPut ? (m < 0 ? 1.5 : 0.5) : (m > 0 ? 1.5 : 0.5)))),
          prev_oi: String(380 + Math.round(5700 * Math.exp(-6 * m * m) * (isPut ? (m < 0 ? 1.5 : 0.5) : (m > 0 ? 1.5 : 0.5)))),
        };

        if (rnd() > 0.07) row.volume = String(volume);
        if (rnd() > 0.11) {
          const lifted = Math.round(volume * (0.5 + 0.3 * Math.sign(m || 1)));
          row.ask_volume = String(Math.max(0, lifted));
          row.bid_volume = String(Math.max(0, volume - lifted));
        }
        rows.push(row);
      }
    }
  }

  rows.push({
    option_symbol: `${ticker}1260918C${String(Math.round(spot * 300)).padStart(8, "0")}`,
    nbbo_bid: "1.00", nbbo_ask: "1.10", implied_volatility: "0.400000",
    open_interest: "5000", prev_oi: "4800", volume: "99999",
    ask_volume: "90000", bid_volume: "9999",
  });

  if (expiry || !wide) return page ? [] : rows;

  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows.slice(page * CHAIN_PAGE_SIZE, (page + 1) * CHAIN_PAGE_SIZE);
}

export function fakeTreasury(sessionDate) {
  return { data: { data: [{ value: 4.17, date: sessionDate || "2026-08-24" }, { value: 4.2, date: "2026-08-21" }], name: "3month", unit: "percent" } };
}

export function fakeEarnings(ticker, sessionDate) {
  const rnd = mulberry(ticker.length * 977 + ticker.charCodeAt(0));
  const rows = [];
  const base = Date.parse((sessionDate || "2026-08-24") + "T00:00:00Z");
  const upcoming = new Date(base + (20 + Math.floor(rnd() * 70)) * 86400000).toISOString().slice(0, 10);
  rows.push({ source: "estimation", report_date: upcoming, report_time: "unknown", expected_move_perc: null, post_earnings_move_1d: null });
  for (let q = 1; q <= 10; q++) {
    const d = new Date(base - (q * 91 - 30) * 86400000);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    const expected = 0.04 + 0.05 * rnd();
    const move = (rnd() > 0.5 ? 1 : -1) * expected * (0.4 + 1.2 * rnd());
    rows.push({ source: "company", report_date: d.toISOString().slice(0, 10), report_time: rnd() > 0.5 ? "postmarket" : "premarket",
      expected_move_perc: expected.toFixed(6), post_earnings_move_1d: move.toFixed(6) });
  }
  return { data: rows };
}

export function fakeSurface(ticker, spot, expiries) {
  if (!(spot > 0) || !expiries || !expiries.length) return [];
  const rnd = mulberry(ticker.length * 421 + Math.round(spot * 7));
  const rows = [];
  const pivot = spot * (0.97 + rnd() * 0.06);
  expiries.forEach((expiry, j) => {

    const width = spot * (0.04 + j * 0.035);
    const weight = 1 / (j + 1);
    for (let i = 0; i < 25; i++) {
      const k = Math.round(spot * (0.78 + i * 0.018) * 100) / 100;
      const bell = Math.exp(-Math.pow((k - spot) / width, 2));
      if (bell < 0.01) continue;
      const lean = (k - pivot) / spot;
      const scale = bell * weight * 3.2e6 * (0.7 + rnd() * 0.6);
      const callLeg = scale * Math.max(0, lean) * 9;
      const putLeg = -scale * Math.max(0, -lean) * 9;
      const callAsk = callLeg * (0.4 + rnd() * 0.3);
      const callBid = callLeg * (0.3 + rnd() * 0.3);
      const putAsk = putLeg * (0.4 + rnd() * 0.3);
      const putBid = putLeg * (0.3 + rnd() * 0.3);
      rows.push({
        strike: k.toFixed(2),
        expiry,
        call_gamma_ask: String(callAsk),
        call_gamma_bid: String(callBid),
        put_gamma_ask: String(putAsk),
        put_gamma_bid: String(putBid),
        call_gamma_oi: String(callLeg * 1.7),
        put_gamma_oi: String(putLeg * 1.7),
        call_charm_oi: String(callLeg * 0.21),
        put_charm_oi: String(putLeg * -0.18),
        call_vanna_oi: String(callLeg * -0.33),
        put_vanna_oi: String(putLeg * 0.27),
      });
    }
  });
  return rows;
}

export function fakeMaxPain(ticker, spot) {
  const rnd = mulberry(ticker.length * 977 + Math.round(spot));
  return Array.from({ length: 5 }, (_, i) => ({
    expiry: new Date(Date.UTC(2026, 7, 28) + i * 7 * 86400000).toISOString().slice(0, 10),
    max_pain: (spot * (0.94 + rnd() * 0.12)).toFixed(0),
  }));
}

export function fakeStockDarkpool(ticker, spot) {
  const rnd = mulberry(ticker.length * 1289 + Math.round(spot));
  if (ticker.length % 7 === 3) return [];
  const late = Array.from({ length: 4 }, (_, i) => ({
    ticker, executed_at: `${DRY_SESSION_DATE}T${20 + i}:${String(5 + i * 11).padStart(2, "0")}:00Z`,
    price: spot.toFixed(2), size: 900000 - i * 1000, premium: String(Math.round(spot * (900000 - i * 1000))),
    volume: Math.round(rnd() * 6e7), market_center: "L", ext_hour_sold_codes: "extended_hours_trade",
  }));
  return late.concat(Array.from({ length: 20 }, (_, i) => {
    const px = spot * (0.985 + rnd() * 0.03);
    const size = Math.round(5e3 + rnd() * 4e5);
    const row = {
      ticker,
      executed_at: `${DRY_SESSION_DATE}T${String(13 + (i % 7))}:${String(10 + (i % 49))}:00Z`,
      price: px.toFixed(2), size,
      volume: Math.round(rnd() * 6e7),
      market_center: "L",
    };
    if (i % 5 !== 4) row.premium = String(Math.round(px * size));
    if (i % 3 !== 2) { row.nbbo_bid = (px - 0.03).toFixed(2); row.nbbo_ask = (px + 0.03).toFixed(2); }
    if (i % 9 === 8) row.canceled = false;
    return row;
  }));
}

export function fakeStockOiChange(ticker, spot) {
  const rnd = mulberry(ticker.length * 2039 + Math.round(spot));
  return Array.from({ length: 14 }, (_, i) => {
    const k = Math.max(1, Math.round(spot * (0.8 + rnd() * 0.4)));
    const row = {
      option_symbol: `${ticker}260918${rnd() > 0.5 ? "C" : "P"}${String(k * 1000).padStart(8, "0")}`,
      underlying_symbol: ticker,
      ...(() => {

        const last = Math.max(1, Math.round(rnd() * 70000));
        const curr = Math.max(0, Math.round(last * (0.4 + rnd() * 1.6)));
        const row = {
          oi_change: String((curr - last) / last),
          curr_oi: curr,
          last_oi: last,
        };
        if (i % 9 !== 8) row.oi_diff_plain = curr - last;
        return row;
      })(),
      volume: Math.round(rnd() * 40000),
      curr_date: "2026-08-28",
      last_date: "2026-08-27",
    };
    if (i % 4 !== 3) row.trades = Math.round(rnd() * 700);
    if (i % 5 !== 4) row.avg_price = (rnd() * 30).toFixed(2);
    if (i % 3 !== 2) row.percentage_of_total = (rnd() * 0.3).toFixed(4);
    if (i % 6 !== 5) row.days_of_oi_increases = Math.floor(rnd() * 9);
    if (i % 7 !== 6) row.days_of_vol_greater_than_oi = Math.floor(rnd() * 5);
    return row;
  });
}

export function fakeTermStructure(ticker, spot, params = {}) {
  const rnd = mulberry(ticker.length * 3167);
  const anchor = params && typeof params.date === "string" ? params.date : "2026-08-28";
  const base = Date.parse(anchor + "T00:00:00Z");
  return Array.from({ length: 12 }, (_, i) => {
    const expiryMs = Date.UTC(2026, 7, 28) + (3 + i * 12) * 86400000;
    const dte = Math.round((expiryMs - base) / 86400000);
    const vol = 0.2 + rnd() * 0.3 + (i < 2 ? rnd() * 0.15 : 0);
    return {
      ticker, date: anchor,
      expiry: new Date(expiryMs).toISOString().slice(0, 10),
      dte, volatility: vol.toFixed(4),
      implied_move: (spot * vol * Math.sqrt(dte / 365)).toFixed(2),
      implied_move_perc: (vol * Math.sqrt(dte / 365)).toFixed(4),
    };
  });
}

const IV_RANK_VENDOR_DEFAULT_ROWS = 5;

export function fakeIvRank(ticker, spot, params = {}) {
  const rnd = mulberry(ticker.length * 4271);
  const count = params && params.timespan === "1y" ? 251 : params && params.timespan === "3m" ? 64
    : IV_RANK_VENDOR_DEFAULT_ROWS;
  const days = tradingDaysEndingAt("2026-08-28", count);
  let vol = 0.2 + rnd() * 0.3, px = spot * (0.9 + rnd() * 0.2);
  const rows = days.map((t) => {
    const shock = rnd() + rnd() + rnd() - 1.5;
    vol = Math.max(0.05, vol + shock * 0.012);
    px = px * Math.exp(-shock * 0.02 + (rnd() - 0.5) * 0.01);
    return { t, vol, px };
  });
  return rows.reverse().map((r, i) => {
    const row = {
      date: new Date(r.t).toISOString().slice(0, 10),
      updated_at: "2026-08-28T20:00:00Z",
      volatility: r.vol.toFixed(4),
      close: r.px.toFixed(2),
    };

    if (i % 8 !== 7) row.iv_rank_1y = (rnd() * 100).toFixed(2);
    return row;
  });
}

export function fakeCongress(ticker) {
  const rnd = mulberry(ticker.length * 613);
  const n = Math.floor(rnd() * 5);
  return Array.from({ length: n }, (_, i) => {
    const txn = Date.UTC(2026, 6, 5 + i * 4);

    const lag = Math.round(3 + rnd() * 77);
    return {
      name: `Member ${String.fromCharCode(65 + i)}`,
      member_type: i % 2 ? "senate" : "house",
      issuer: i % 3 === 0 ? "spouse" : "self",
      txn_type: rnd() > 0.4 ? "Purchase" : "Sale",
      transaction_date: new Date(txn).toISOString().slice(0, 10),
      filed_at_date: new Date(txn + lag * 86400000).toISOString().slice(0, 10),
      amounts: ["$1,001 - $15,000", "$15,001 - $50,000", "$50,001 - $100,000"][i % 3],
      ticker,
    };
  });
}

export function fakePriorUnusual(rows, sessionDate) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const kept = list.filter((_, i) => i % 3 !== 0).map((r) => ({
    t: r.t, k: r.k, expiry: r.expiry, cp: r.cp,
  }));

  for (let i = 0; i < 5 && i < list.length; i++) {
    const r = list[i];
    kept.push({ t: r.t, k: Number((Number(r.k) + 5).toFixed(2)), expiry: r.expiry, cp: r.cp === "C" ? "P" : "C" });
  }

  let prior = null;
  const base = Date.parse(String(sessionDate || "") + "T00:00:00Z");
  if (Number.isFinite(base)) {
    for (let back = 1; back <= 4; back++) {
      const d = new Date(base - back * 86400000);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      prior = d.toISOString().slice(0, 10);
      break;
    }
  }
  return {
    v: BOARD_SCHEMA_VERSION,
    sessionDate: prior,
    readAt: (prior || "2026-01-01") + "T09:20:00.000Z",
    contracts: { rows: kept, shown: kept.length },
  };
}

export function fakePriorBoard(side, pool, sessionDate) {
  const ranked = (Array.isArray(pool) ? pool : []).slice(0, UNIVERSE.boardSize);
  if (!ranked.length) return null;

  const rows = ranked.filter((_, i) => i % 3 !== 0)
    .map((r, i) => ({ t: r.ticker, r: i + 1 }));

  for (let i = 0; i < 3; i++) rows.push({ t: "GONE" + i, r: rows.length + 1 });

  let prior = null;
  const base = Date.parse(String(sessionDate || "") + "T00:00:00Z");
  if (Number.isFinite(base)) {
    for (let back = 1; back <= 4; back++) {
      const d = new Date(base - back * 86400000);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      prior = d.toISOString().slice(0, 10);
      break;
    }
  }
  return {
    v: BOARD_SCHEMA_VERSION,
    side,
    sessionDate: side === "short" ? sessionDate || null : prior,
    generatedAt: (prior || "2026-01-01") + "T09:20:00.000Z",
    rows,
  };
}

export function fakeFlowAlerts(tickers) {
  const rnd = mulberry(4177);
  const names = (tickers && tickers.length ? tickers : ["SYN001"]).slice(0, 24);
  const rows = [];

  for (let i = 0; i < ALERT_VENDOR_LIMIT; i++) {
    const t = names[Math.floor(rnd() * names.length)];
    const call = rnd() > 0.45;
    const strike = Math.round(40 + rnd() * 200);
    const row = {
      ticker: t,
      alert_rule: ["RepeatedHits", "SteadyAccumulation", "LowHistoricVolume"][i % 3],
      rule_id: "r" + (i % 3),
      total_premium: Math.round(20000 + rnd() * 3000000),
      trade_count: 1 + Math.floor(rnd() * 40),
      total_ask_side_prem: Math.round(rnd() * 2000000),
      total_bid_side_prem: Math.round(rnd() * 900000),
      has_sweep: rnd() > 0.6,
      all_opening_trades: rnd() > 0.8,
      open_interest: Math.floor(rnd() * 20000),
      volume_oi_ratio: Number((rnd() * 8).toFixed(3)),
      underlying_price: Number((30 + rnd() * 400).toFixed(2)),
      start_time: i % 2 === 0
        ? Date.UTC(2026, 7, 24, 14, 10 + (i % 45))
        : "2026-08-24T14:" + String(10 + (i % 45)).padStart(2, "0") + ":00Z",
      end_time: i % 2 === 0
        ? Date.UTC(2026, 7, 24, 14, 12 + (i % 45), 30)
        : "2026-08-24T14:" + String(12 + (i % 45)).padStart(2, "0") + ":30Z",
      expiry: "2026-09-18",
      sector: "Technology",
      marketcap: 1e10,
      er_time: "unknown",
      next_earnings_date: "2026-10-20",
      expiry_count: 1,
      has_singleleg: true,
    };

    if (i % 4 !== 3) {
      row.option_chain = t + "260918" + (call ? "C" : "P") +
        String(strike * 1000).padStart(8, "0");
    }
    if (i % 5 !== 4) row.total_size = 10 + Math.floor(rnd() * 900);
    if (i % 6 !== 5) row.has_floor = rnd() > 0.85;
    if (i % 7 === 6) { row.iv_start = 0.3 + rnd() * 0.4; row.iv_end = 0.3 + rnd() * 0.4; }
    if (i % 11 === 10) delete row.total_premium;
    rows.push(row);
  }
  rows.push({ ticker: "", total_premium: 5 });
  return rows;
}

export function fakePoliticalRaws(tickers) {
  const rnd = mulberry(4471);
  const names = (tickers && tickers.length ? tickers : ["SYN001"]).slice(0, 12);
  const BANDS = ["$1,001 - $15,000", "$15,001 - $50,000", "$50,001 - $100,000",
    "$100,001 - $250,000", "$250,001 - $500,000", "$1,000,001 - $5,000,000"];
  const MEMBERS = ["Ada Reyes", "Ben Osei", "Cara Lindqvist", "Dev Patel",
    "Elena Moreau", "Frank Okafor", "Grace Tan", "Hugo Silva"];
  const filings = [];
  for (let i = 0; i < 140; i++) {
    const txnMs = Date.parse("2026-08-20T00:00:00Z") - Math.floor(rnd() * 75) * 86400000;
    const lag = 18 + Math.floor(rnd() * 95);
    const row = {
      name: MEMBERS[i % MEMBERS.length],
      politician_id: `pid-${i % MEMBERS.length}`,
      reporter: MEMBERS[i % MEMBERS.length].split(" ")[0] + " " + MEMBERS[i % MEMBERS.length][0] + ".",
      ticker: names[Math.floor(rnd() * names.length)],
      issuer: "Synthetic Holdings Inc",
      member_type: i % 3 === 0 ? "senate" : "house",
      txn_type: i % 7 === 6 ? "Sale (Partial)" : i % 11 === 10 ? "Receive" : "Purchase",
      amounts: i % 23 === 22 ? "Over $50,000,000" : BANDS[Math.floor(rnd() * BANDS.length)],
      transaction_date: new Date(txnMs).toISOString().slice(0, 10),
      filed_at_date: new Date(txnMs + lag * 86400000).toISOString().slice(0, 10),
    };
    if (i % 9 === 8) row.notes = "Subholding Of: Synthetic Brokerage Account stock";
    filings.push(row);
  }

  for (let i = 0; i < 6; i++) {
    filings.push({
      name: "Ivor Blackwood", politician_id: "pid-sell", ticker: names[i % names.length],
      issuer: "Synthetic Holdings Inc", member_type: "house",
      txn_type: "Sale (Full)", amounts: "$1,000,001 - $5,000,000",
      transaction_date: "2026-07-02", filed_at_date: "2026-08-01",
    });
  }

  for (let i = 0; i < 8; i++) {
    filings.push({
      name: "Jae Moon", politician_id: "pid-alt", ticker: names[i % names.length],
      asset: "Synthetic Corporation - Common Stock", asset_type: "stock",
      transaction_type: "Buy",
      low_value: "1000001", high_value: "5000000", mid_value: "3000000",
      transaction_date: "2026-06-20", filed_at_date: "2026-07-15",
    });
  }
  filings.push({ notes: "no filer and no ticker" });
  return {
    filings,

    holders: { __failed: "HTTP 422 — the status the live vendor returned" },
  };
}

export function fakePulseRaws(tickers) {
  const rnd = mulberry(6229);
  const names = (tickers && tickers.length ? tickers : ["SYN001"]).slice(0, 20);
  const pick = () => names[Math.floor(rnd() * names.length)];
  const tide = Array.from({ length: 78 }, (_, i) => ({
    timestamp: `2026-08-24T${String(9 + Math.floor((30 + i * 5) / 60)).padStart(2, "0")}:${String((30 + i * 5) % 60).padStart(2, "0")}:00-04:00`,
    net_call_premium: String(Math.round((rnd() - 0.4) * 4e8)),
    net_put_premium: String(Math.round((rnd() - 0.5) * 3e8)),
    net_volume: Math.round((rnd() - 0.5) * 2e6),
  }));
  const totals = { data: Array.from({ length: 24 }, (_, i) => ({
    date: `2026-07-${String(1 + i).padStart(2, "0")}`,
    call_premium: String(Math.round(rnd() * 3e10)),
    call_volume: Math.round(rnd() * 3e7),
    put_premium: String(Math.round(rnd() * 2.5e10)),
    put_volume: Math.round(rnd() * 2.5e7),
  })) };

  const oiChange = { data: Array.from({ length: 40 }, (_, i) => {
    const t = pick();

    const lastOi = 20000 + Math.round(rnd() * 60000);
    const change = Math.round((rnd() - 0.3) * 40000);
    const row = {
      option_symbol: `${t}260918${rnd() > 0.5 ? "C" : "P"}${String(Math.round(40 + rnd() * 300) * 1000).padStart(8, "0")}`,
      underlying_symbol: t,
      oi_change: String(change),
      oi_diff_plain: change,
      curr_oi: lastOi + change,
      last_oi: lastOi,
      curr_date: "2026-08-21",
      last_date: "2026-08-20",
      volume: Math.round(rnd() * 50000),
      rnk: i,
    };
    if (i % 4 !== 3) row.trades = Math.round(rnd() * 900);
    if (i % 5 !== 4) row.avg_price = (rnd() * 40).toFixed(2);
    if (i % 6 !== 5) row.percentage_of_total = (rnd() * 0.2).toFixed(4);
    return row;
  }).sort((a, b) => Number(b.oi_change) - Number(a.oi_change)) };
  const netImpact = Array.from({ length: 30 }, () => ({
    ticker: pick(), net_premium: Math.round((rnd() - 0.45) * 2e8),
  }));
  const insiders = { data: Array.from({ length: 15 }, (_, i) => ({
    filing_date: `2026-08-${String(1 + i).padStart(2, "0")}`,
    purchases: Math.round(rnd() * 300), sells: Math.round(rnd() * 500),
    purchases_notional: String(Math.round(rnd() * 4e8)),
    sells_notional: String(Math.round(rnd() * 9e8)),
  })) };

  const afterHours = Array.from({ length: 8 }, (_, i) => {
    const px = 20 + rnd() * 400;
    const size = Math.round(3e6 + rnd() * 2e6);
    return {
      ticker: pick(),
      executed_at: `${DRY_SESSION_DATE}T23:${String(59 - i * 5).padStart(2, "0")}:00Z`,
      price: px.toFixed(2), size, premium: String(Math.round(px * size)),
      volume: Math.round(rnd() * 8e7), ext_hour_sold_codes: "extended_hours_trade",
    };
  });
  const darkpool = { data: afterHours.concat(Array.from({ length: 45 }, (_, i) => {
    const px = 20 + rnd() * 400;
    const size = Math.round(1e4 + rnd() * 2e6);
    const minute = 959 - i;
    const row = {
      ticker: pick(),
      executed_at: `${DRY_SESSION_DATE}T${String(Math.floor(minute / 60)).padStart(2, "0")}:` +
        `${String(minute % 60).padStart(2, "0")}:00Z`,
      price: px.toFixed(2), size,
      premium: String(Math.round(px * size)),
      volume: Math.round(rnd() * 8e7),
    };
    if (i % 3 !== 2) { row.nbbo_bid = (px - 0.05).toFixed(2); row.nbbo_ask = (px + 0.05).toFixed(2); }
    if (i % 7 === 6) row.canceled = rnd() > 0.5;
    return row;
  })) };
  return {
    tide, totals, oiChange, netImpact, insiders, darkpool,

    seasonality: { __failed: "synthetic outage (dry-run fixture)" },
  };
}

export const DRY_SESSION_DATE = "2026-08-24";

function tradingDaysEndingAt(endDate, count) {
  const out = [];
  let t = Date.parse(endDate + "T13:30:00Z");
  if (!Number.isFinite(t)) return out;
  while (out.length < count) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(t);
    t -= 86400000;
  }
  return out.reverse();
}

const FAKE_CHARM_SCALE = 50;

const FAKE_RATE = 0.04;

export const fakeLadders = new Map();

export function tickerSeed(ticker) {
  let h = 2166136261;
  for (const ch of String(ticker)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function fakeOiLadder(ticker, spot, iv) {
  const rnd = mulberry(tickerSeed(ticker));
  const vol = Number.isFinite(iv) && iv > 0.02 ? iv : 0.3;
  const strikes = Array.from({ length: 41 }, (_, j) => spot * (0.7 + j * 0.015));
  const expiries = Array.from({ length: 6 }, (_, i) => ({
    expiry: new Date(Date.UTC(2026, 7, 28) + i * 7 * 86400000).toISOString().slice(0, 10),
    days: i * 7 + 4,
  }));
  const oiCall = [], oiPut = [];
  for (let i = 0; i < expiries.length; i++) {
    const depth = 1 / (1 + i * 0.35);
    oiCall.push(strikes.map((k) => {
      const w = Math.exp(-Math.pow((k - spot * 1.05) / (spot * 0.12), 2));
      return Math.round(4000 * depth * w * (0.4 + rnd()));
    }));
    oiPut.push(strikes.map((k) => {
      const w = Math.exp(-Math.pow((k - spot * 0.94) / (spot * 0.12), 2));
      return Math.round(3500 * depth * w * (0.4 + rnd()));
    }));
  }
  const ladder = { ticker, spot, vol, strikes, expiries, oiCall, oiPut };
  fakeLadders.set(ticker, ladder);
  return ladder;
}

export function fakeLadderGreeks(ladder) {
  const { spot, vol, strikes, expiries, oiCall, oiPut } = ladder;
  const rows = expiries.map((e, i) => {
    const out = { expiry: e.expiry, dte: e.days, gc: 0, gp: 0, dc: 0, dp: 0, vc: 0, vp: 0, cc: 0, cp: 0 };
    strikes.forEach((k, j) => {
      const c = blackScholesGreeks({ spot, strike: k, days: e.days, vol, rate: FAKE_RATE, type: "C" });
      const p = blackScholesGreeks({ spot, strike: k, days: e.days, vol, rate: FAKE_RATE, type: "P" });
      const nc = oiCall[i][j] * 100, np = oiPut[i][j] * 100;
      out.gc += c.gamma * nc; out.gp += p.gamma * np;
      out.dc += c.delta * nc; out.dp += p.delta * np;
      out.vc += c.vanna * nc; out.vp += p.vanna * np;
      out.cc += FAKE_CHARM_SCALE * c.charmPerDay * nc; out.cp += FAKE_CHARM_SCALE * p.charmPerDay * np;
    });
    return out;
  });
  const byStrike = strikes.map((k, j) => {
    let gc = 0, gp = 0;
    expiries.forEach((e, i) => {
      const g = blackScholesGreeks({ spot, strike: k, days: e.days, vol, rate: FAKE_RATE, type: "C" }).gamma;
      gc += g * oiCall[i][j] * 100;
      gp += g * oiPut[i][j] * 100;
    });
    return { gc: gc * spot * spot / 100, gp: gp * spot * spot / 100 };
  });
  return { rows, byStrike };
}

export function fakeLadderChain(ladder, expiry) {
  const i = ladder.expiries.findIndex((e) => e.expiry === expiry);
  if (i < 0) return [];
  const yymmdd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  const out = [];
  ladder.strikes.forEach((k, j) => {
    for (const [cp, oi] of [["C", ladder.oiCall[i][j]], ["P", ladder.oiPut[i][j]]]) {
      if (!(oi > 0)) continue;
      out.push({
        option_symbol: `${ladder.ticker}${yymmdd}${cp}${String(Math.round(k * 1000)).padStart(8, "0")}`,
        implied_volatility: ladder.vol.toFixed(4),
        open_interest: oi,
      });
    }
  });
  return out;
}

export function fakeEnrichment(ticker, spot, seed, iv = null) {
  const rnd = mulberry(seed);
  const ladder = fakeOiLadder(ticker, spot, iv);
  const book = fakeLadderGreeks(ladder);
  const bias = rnd() - 0.5;

  const greekFlow = Array.from({ length: 60 }, () => {
    const total = (rnd() * 2 - 1) * 50000;
    return {
      dir_delta_flow: String(total * (0.2 + rnd() * 0.8) * Math.sign(bias || 1)),
      total_delta_flow: String(total),
      otm_dir_delta_flow: String(total * rnd() * 0.6),
      total_vega_flow: String(rnd() * 80000),
      otm_total_vega_flow: String(rnd() * 40000),
    };
  });

  const t0 = Date.UTC(2026, 7, 24, 13, 30);
  const ticks = Array.from({ length: 390 }, (_, i) => {
    const step = (rnd() - 0.5 + bias * 0.6) * 900;
    return {
      tape_time: new Date(t0 + i * 60000).toISOString(),
      net_delta: String(step),
      net_call_premium: String(step * 120 * (0.5 + rnd())),
      net_put_premium: String(-step * 80 * (0.5 + rnd())),
    };
  });

  const tilt = 0.94 + rnd() * 0.12;
  const oneSided = rnd() < 0.125;
  const strikes = Array.from({ length: 41 }, (_, i) => {
    const k = spot * (0.7 + i * 0.015);
    const w = Math.exp(-Math.pow((k - spot) / (spot * 0.3), 2));
    const lean = oneSided
      ? Math.abs((k - spot * tilt) / spot)
      : (k - spot * tilt) / spot;
    const scale = w * 4e6 * (0.6 + rnd() * 0.8);
    const callLeg = scale * Math.max(0, lean) * 8;
    const putLeg = -scale * Math.max(0, -lean) * 8;
    return {
      strike: k.toFixed(2),
      call_gamma_ask: String(callLeg * (0.4 + rnd() * 0.3)),
      call_gamma_bid: String(callLeg * (0.3 + rnd() * 0.3)),
      put_gamma_ask: String(putLeg * (0.4 + rnd() * 0.3)),
      put_gamma_bid: String(putLeg * (0.3 + rnd() * 0.3)),
      call_gamma_oi: String(book.byStrike[i].gc),
      put_gamma_oi: String(-book.byStrike[i].gp),
      call_gamma_vol: String(Math.abs(callLeg) * rnd() * 2),
      put_gamma_vol: String(-Math.abs(putLeg) * rnd() * 1.4),
    };
  });

  const expiries = book.rows.map((b, i) => {
    for (let draw = 0; draw < (i !== 4 ? 8 : 6); draw++) rnd();
    const row = {
      expiry: b.expiry,
      dte: b.dte,
      call_gex: String(b.gc),
      put_gex: String(-b.gp),
      call_delta: String(b.dc),
      put_delta: String(b.dp),
      call_charm: String(b.cc),
      put_charm: String(b.cp),
    };
    if (i !== 4) {
      row.call_vanna = String(b.vc);
      row.put_vanna = String(b.vp);
    }
    return row;
  });
  const lapsed = book.rows[0];
  expiries.unshift({
    expiry: DRY_SESSION_DATE, dte: 0,
    call_gex: String(lapsed.gc * 0.5), put_gex: String(-lapsed.gp * 0.5),
    call_delta: String(lapsed.dc * 0.5), put_delta: String(lapsed.dp * 0.5),
    call_charm: String(lapsed.cc * 0.5), put_charm: String(lapsed.cp * 0.5),
    call_vanna: String(lapsed.vc * 0.5), put_vanna: String(lapsed.vp * 0.5),
  });

  let px = spot;

  const days = tradingDaysEndingAt(DRY_SESSION_DATE, 252);
  let s2 = 1.6, lastMove = 0;
  const walk = Array.from({ length: 252 }, (_, i) => {
    s2 = 0.08 + 0.09 * lastMove * lastMove + 0.86 * s2;
    lastMove = Math.sqrt(s2) * (rnd() + rnd() + rnd() - 1.5) * 2;
    const move = px * lastMove / 100;
    const open = px; px = Math.max(1, px + move);
    return { at: days[i], open, close: px, volume: Math.round((3e6 + rnd() * 2e7)) };
  });

  const scale = spot > 0 && px > 0 ? spot / px : 1;
  const ohlc = walk.map((w) => {
    const open = w.open * scale, close = w.close * scale;
    return {
      start_time: new Date(w.at).toISOString(),
      open: open.toFixed(2), close: close.toFixed(2),
      high: (Math.max(open, close) * 1.008).toFixed(2),
      low: (Math.min(open, close) * 0.992).toFixed(2),
      volume: w.volume,
    };
  });

  return { ticker, spot, greekFlow, ticks, strikes, expiries, ohlc };
}

function dryPriorRoster(sessionDate) {
  const back = (n) => {
    let d = sessionDate;
    for (let i = 0; i < n;) {
      d = new Date(Date.parse(d + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      const wd = new Date(d + "T00:00:00Z").getUTCDay();
      if (wd !== 0 && wd !== 6) i++;
    }
    return d;
  };
  return {
    v: 1, sessionDate: back(1), generatedAt: back(1) + "T21:40:00.000Z", ledger: "bootstrap-partial",
    depth: { AAPL: "focus", GLD: "fund", SPY: "index" }, session: { AAPL: back(1), GLD: back(1), SPY: back(1) },
    x: { "card-x": ["AAPL"], hist: ["AAPL"] },
    held: { "card:ZZRET": back(5), "card-x:ZZRET": back(5), "hist:ZZRET": back(5), "card:ZZHLD": back(2),
      "card:NVDA": back(6), "card-x:ZZXON": back(4) },
  };
}

export function dryRosterReader(sessionDate) {
  const prior = dryPriorRoster(sessionDate);
  return async (key) => (key === "roster" ? { payload: prior, status: 200 } : { payload: null, absent: true, status: 0 });
}

export const DRY_PROBE_BYTES = Object.freeze({ card: 61440, "card-x": 20480, hist: 10240 });

export function dryRosterProbe(sessionDate) {
  const prior = dryPriorRoster(sessionDate);
  const stored = { ...prior.held, "hist:ZZHLD": prior.held["card:ZZHLD"] };
  return async (keys) => {
    const out = {};
    for (const key of keys) {
      const day = stored[key];
      out[key] = day
        ? { present: true, sessionDate: day, generatedAt: day + "T21:40:00.000Z", updatedAt: Date.parse(day + "T21:40:00Z"),
            bytes: DRY_PROBE_BYTES[key.split(":")[0]] }
        : { present: false };
    }
    return { keys: out, status: 200, bytes: JSON.stringify({ keys: out }).length };
  };
}

export function dryRosterList(sessionDate) {
  const prior = dryPriorRoster(sessionDate);
  const stored = { ...prior.held, "hist:ZZHLD": prior.held["card:ZZHLD"], "card:ZZORF": prior.held["card:ZZRET"] };
  return async () => {
    const keys = {};
    for (const [key, day] of Object.entries(stored)) {
      keys[key] = { present: true, sessionDate: day, generatedAt: day + "T21:40:00.000Z", updatedAt: Date.parse(day + "T21:40:00Z") };
    }
    return { keys, status: 200, bytes: JSON.stringify({ keys }).length, truncated: false };
  };
}
