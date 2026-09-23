import { sessionOpen, easternInstant, PHASE_MINUTES } from "../../shared/flows-freshness.js";
import { SECTOR_TIDES, INDEX_NAMES } from "../../shared/flows-live.js";

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (s) => {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

const money = (v) => v.toFixed(2);
const money4 = (v) => v.toFixed(4);
const isoZ = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z";
const isoMicro = (ms) => new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
const isoEt = (ms) => {
  const d = new Date(ms - 4 * 3600000);
  return d.toISOString().slice(0, 19) + "-04:00";
};

function minutesUpTo(session, nowMs, stepMin) {
  const open = sessionOpen(session);
  const close = easternInstant(session, PHASE_MINUTES.close);
  const end = Math.min(close, nowMs);
  const out = [];
  for (let t = open; t <= end - stepMin * 60000 + 1; t += stepMin * 60000) out.push(t);
  if (!out.length && end >= open) out.push(open);
  return out;
}

function cumulativeWalk(rand, n, { drift = 0, step = 1, start = 0 } = {}) {
  const out = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    v += drift + (rand() - 0.5) * 2 * step;
    out.push(v);
  }
  return out;
}

export function fakeTide({ session, now, seed = "tide", interval5m = true, withPx = false, pxBase = 500,
  scale = 4e6, etOffset = false, netVolumeString = false } = {}) {
  const rand = mulberry(seedOf(seed + session));
  const mins = minutesUpTo(session, now, interval5m ? 5 : 1);
  const calls = cumulativeWalk(rand, mins.length, { drift: scale * 0.05, step: scale });
  const puts = cumulativeWalk(rand, mins.length, { drift: -scale * 0.02, step: scale * 0.8 });
  const vols = cumulativeWalk(rand, mins.length, { drift: scale / 200, step: scale / 800 }).map((v) => Math.max(0, Math.round(Math.abs(v))));
  let px = pxBase;
  const data = mins.map((t, i) => {
    px *= 1 + (rand() - 0.5) * 0.001;
    const row = {
      timestamp: etOffset ? isoEt(t) : isoZ(t), date: session,
      net_call_premium: money4(calls[i]), net_put_premium: money4(puts[i]),
    };
    if (withPx) row.underlying_price = money(px);
    row.net_volume = netVolumeString ? String(vols[i]) : vols[i];
    return row;
  });
  return { data, date: session };
}

export function fakeNetFlow({ session, now, expiration = "zero_dte" } = {}) {
  const tide = fakeTide({ session, now, seed: "nf-" + expiration, interval5m: false, withPx: true, pxBase: 774,
    scale: expiration === "zero_dte" ? 3e5 : 6e5, netVolumeString: true });
  return { data: [{ moneyness: "all", tide_type: "all", data: tide.data }], date: session,
    expiration: [expiration], moneyness: ["all"], tide_type: ["all"] };
}

export function fakeEtfTide(ticker, { session, now } = {}) {
  const base = { SPY: 774, QQQ: 612, IWM: 241, DIA: 468 }[ticker] || 300;
  return fakeTide({ session, now, seed: "etf-" + ticker, interval5m: false, withPx: true, pxBase: base,
    scale: 6e5, netVolumeString: true });
}

export function fakeSectorTide(sector, { session, now } = {}) {
  return fakeTide({ session, now, seed: "sector-" + sector, interval5m: false, scale: 1.5e6 });
}

export function fakeMarketTide({ session, now } = {}) {
  return fakeTide({ session, now, seed: "market", interval5m: true, scale: 3e7, etOffset: true });
}

export function fakeSectorEtfs({ session } = {}) {
  const rand = mulberry(seedOf("sector-etfs" + session));
  const names = [
    ["XLB", "Materials Select Sector SPDR"], ["XLC", "Communication Services Select Sector SPDR"],
    ["XLE", "Energy Select Sector SPDR"], ["XLF", "Financial Select Sector SPDR"],
    ["XLI", "Industrial Select Sector SPDR"], ["XLK", "Technology Select Sector SPDR"],
    ["XLP", "Consumer Staples Select Sector SPDR"], ["XLRE", "Real Estate Select Sector SPDR"],
    ["XLU", "Utilities Select Sector SPDR"], ["XLV", "Health Care Select Sector SPDR"],
    ["XLY", "Consumer Discretionary Select Sector SPDR"], ["SPY", "S&P 500 Index"],
  ];
  return { data: names.map(([ticker, full_name]) => {
    const prev = 40 + rand() * 200;
    const last = prev * (1 + (rand() - 0.5) * 0.02);
    const bull = rand() * 5e7;
    const bear = rand() * 5e7;
    return {
      high: money(last * 1.004), low: money(last * 0.996), open: money(prev), last: money(last), ticker, full_name,
      volume: Math.round(rand() * 3e7), call_volume: Math.round(rand() * 5e5), put_volume: Math.round(rand() * 5e5),
      marketcap: String(Math.round(rand() * 8e11)), put_premium: money4(rand() * 1e8), call_premium: money4(rand() * 1e8),
      prev_date: session, in_out_flow: [{ date: session, change: Math.round((rand() - 0.5) * 1e7) }],
      avg30_call_volume: money4(rand() * 5e5), avg_30_day_call_volume: money4(rand() * 5e5),
      avg30_put_volume: money4(rand() * 5e5), avg_30_day_put_volume: money4(rand() * 5e5),
      week52_high: money(prev * 1.2), week52_low: money(prev * 0.8), avg30_stock_volume: money4(rand() * 3e7),
      avg_7_day_call_volume: money4(rand() * 5e5), avg_7_day_put_volume: money4(rand() * 5e5),
      bearish_premium: money4(bear), bullish_premium: money4(bull), prev_close: money(prev),
    };
  }) };
}

export function fakeScreenerRows(tickers, { session, dated = false } = {}) {
  return { data: tickers.map((ticker) => {
    const rand = mulberry(seedOf("scr-" + ticker + session));
    const prev = 20 + rand() * 400;
    const close = prev * (1 + (rand() - 0.5) * 0.06);
    const v30 = 0.15 + rand() * 0.5;
    const row = {
      ticker, date: session, close: money(close), prev_close: money(prev), open: money(prev),
      high: money(close * 1.01), low: money(close * 0.99),
      net_call_premium: money(rand() * 4e7 - 1e7), net_put_premium: money(rand() * 3e7 - 1.5e7),
      bullish_premium: money(rand() * 6e7), bearish_premium: money(rand() * 6e7),
      call_premium: money(rand() * 9e7), put_premium: money(rand() * 7e7),
      call_volume: Math.round(rand() * 4e5), put_volume: Math.round(rand() * 3e5),
      call_volume_ask_side: Math.round(rand() * 2e5), put_volume_ask_side: Math.round(rand() * 1.5e5),
      call_volume_bid_side: Math.round(rand() * 2e5), put_volume_bid_side: Math.round(rand() * 1.5e5),
      iv30d: v30.toFixed(3), iv_rank: (rand() * 100).toFixed(2), implied_move_perc: (v30 / 16).toFixed(3),
      volatility_1: (v30 * (0.9 + rand() * 0.3)).toFixed(3), volatility_5: (v30 * 1.02).toFixed(3),
      volatility_7: (v30 * (0.9 + rand() * 0.25)).toFixed(3), volatility_14: (v30 * 1.01).toFixed(3),
      volatility_30: v30.toFixed(3), volatility_60: (v30 * 1.03).toFixed(3),
      volatility_90: (v30 * (0.95 + rand() * 0.15)).toFixed(3), volatility_180: (v30 * 1.06).toFixed(3),
      volatility_365: (v30 * 1.08).toFixed(3), steepness_180_30: (1.06 * (0.95 + rand() * 0.1)).toFixed(4),
      realized_volatility: (v30 * 0.85).toFixed(4), variance_risk_premium: (rand() * 0.04 - 0.01).toFixed(6),
      gex_gamma_per_one_percent_move_oi: money4((rand() - 0.4) * 5e8),
      gex_gamma_per_one_percent_move_vol: money4((rand() - 0.5) * 1e8),
      gex_gamma_per_one_percent_move_dir: money4((rand() - 0.5) * 5e7),
      put_call_ratio: (0.4 + rand()).toFixed(4), relative_volume: (0.5 + rand() * 2).toFixed(4),
      stock_volume: Math.round(rand() * 5e7), iv_percentile_1y: (rand() * 100).toFixed(2),
      bid: null, ask: null, bid_quantity: null, ask_quantity: null, quote_time: null, full_name: null,
      etf_share_flow: null, is_index: INDEX_NAMES.includes(ticker), has_options: true,
      cum_dir_delta: (rand() - 0.5) * 1e6, cum_dir_gamma: (rand() - 0.5) * 1e4, cum_dir_vega: (rand() - 0.5) * 1e6,
    };
    if (!dated) row.intraday_change = money(close - prev);
    return row;
  }) };
}

export function fakeFlowAlerts({ session, now, tickers = [], count = 60, seed = "fa", newerThan = null } = {}) {
  const rand = mulberry(seedOf(seed + session + String(newerThan)));
  const open = sessionOpen(session);
  const since = newerThan && /T/.test(newerThan) ? Date.parse(newerThan) : open;
  const from = Math.max(open, since + 1000);
  const to = Math.max(from + 60000, now);
  const names = tickers.length ? tickers : ["NVDA", "AAPL", "TSLA", "SPXW"];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const t = names[Math.floor(rand() * names.length)];
    const at = Math.round(from + rand() * (to - from));
    const k = Math.round(50 + rand() * 400);
    const cp = rand() > 0.5 ? "C" : "P";
    const exp = session.replace(/-/g, "").slice(2);
    const prem = Math.round(25000 + rand() * 3e6);
    rows.push({
      iv_end: String(0.2 + rand() * 0.6), option_chain: `${t}${exp}${cp}${String(k * 1000).padStart(8, "0")}`,
      gamma: null, underlying_price: money(k * (0.9 + rand() * 0.2)), has_multileg: rand() > 0.8, delta: null,
      end_time: at + 500, total_ask_side_prem: String(Math.round(prem * rand())), issue_type: "Common Stock",
      rule_id: "rule-" + Math.floor(rand() * 1e6), volume_oi_ratio: String(rand() * 12), start_time: at,
      iv_start: String(0.2 + rand() * 0.6), total_premium: String(prem), trade_count: 1 + Math.floor(rand() * 20),
      all_opening_trades: rand() > 0.7, total_bid_side_prem: String(Math.round(prem * rand())),
      price: money(1 + rand() * 20), has_floor: rand() > 0.9, rho: null, total_size: Math.round(10 + rand() * 900),
      sector: "Technology", next_earnings_date: null, er_time: null, expiry: session, bid: money(1), expiry_count: 1,
      theta: null, created_at: isoMicro(at + 900), ask: money(1.1), has_singleleg: true, id: `fa-${seed}-${i}-${at}`,
      marketcap: "1000000000000", strike: money(k), vega: null, has_sweep: rand() > 0.6, iv: null, ticker: t,
      open_interest: Math.round(rand() * 5e4), type: cp === "C" ? "call" : "put", theo: null,
      volume: Math.round(rand() * 5e4), alert_rule: rand() > 0.5 ? "RepeatedHits" : "FloorTradeLargeCap",
    });
  }
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { data: rows, newer_than: newerThan || session, older_than: rows.length ? rows[rows.length - 1].created_at : null };
}

export function fakeSpotExposures(ticker, { session, now } = {}) {
  const rand = mulberry(seedOf("spot-" + ticker + session));
  const start = easternInstant(session, 6 * 60 + 30);
  const end = Math.min(easternInstant(session, PHASE_MINUTES.close), now);
  const open = sessionOpen(session);
  let px = 100 + rand() * 300;
  let g = (rand() - 0.4) * 2e8;
  const data = [];
  for (let t = start; t <= end; t += 60000) {
    px *= 1 + (rand() - 0.5) * 0.0015;
    g += (rand() - 0.5) * 2e6;
    const rth = t >= open;
    data.push({
      time: new Date(t + 30795).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z"), ticker,
      start_time: isoMicro(t), price: px.toFixed(4), ticker_id: 6274,
      charm_per_one_percent_move_dir: rth ? money((rand() - 0.5) * 1e8) : "0",
      charm_per_one_percent_move_oi: money((rand() - 0.5) * 3e9),
      charm_per_one_percent_move_vol: rth ? money((rand() - 0.5) * 4e8) : "0",
      gamma_per_one_percent_move_dir: rth ? money(g * 0.1) : "0",
      gamma_per_one_percent_move_oi: money(g),
      gamma_per_one_percent_move_vol: rth ? money(g * 0.3) : "0",
      vanna_per_one_percent_move_dir: rth ? money((rand() - 0.5) * 1e7) : "0",
      vanna_per_one_percent_move_oi: money((rand() - 0.5) * 2e7),
      vanna_per_one_percent_move_vol: rth ? money((rand() - 0.5) * 5e6) : "0",
    });
  }
  return { data };
}

export function fakeNetPremTicks(ticker, { session, now } = {}) {
  const rand = mulberry(seedOf("npt-" + ticker + session));
  const data = minutesUpTo(session, now, 1).map((t) => {
    const cva = Math.round(rand() * 14000), cvb = Math.round(rand() * 7000);
    const pva = Math.round(rand() * 2000), pvb = Math.round(rand() * 2000);
    return {
      date: session, call_volume: cva + cvb + Math.round(rand() * 800), put_volume: pva + pvb + Math.round(rand() * 300),
      call_volume_ask_side: cva, call_volume_bid_side: cvb, put_volume_ask_side: pva, put_volume_bid_side: pvb,
      net_call_premium: money((cva - cvb) * (80 + rand() * 60)), net_call_volume: cva - cvb,
      net_put_premium: money((pva - pvb) * (80 + rand() * 60)), net_put_volume: pva - pvb,
      tape_time: isoMicro(t), net_delta: ((cva - cvb) * 22 - (pva - pvb) * 18 + rand()).toFixed(18),
    };
  });
  return { data };
}

export function fakeTotalOptionsVolume({ session } = {}) {
  const rand = mulberry(seedOf("tov" + session));
  const day = (d) => ({ date: d, call_volume: Math.round(3e7 + rand() * 1e7), put_volume: Math.round(2e7 + rand() * 1e7),
    put_premium: money(1.4e10 + rand() * 2e9), call_premium: money(3.2e10 + rand() * 4e9) });
  const prior = new Date(Date.parse(session + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
  return { data: [day(session), day(prior)] };
}

export function fakeTopNetImpact({ session, tickers = [] } = {}) {
  const rand = mulberry(seedOf("tni" + session));
  const names = tickers.length ? tickers.slice(0, 20) : ["MU", "INTC", "NVDA", "TSLA"];
  return { data: names.map((ticker) => ({ ticker, net_premium: Math.round((rand() - 0.3) * 1.5e8 * 10) / 10 })) };
}

export function fakeDarkpoolRecent({ session, now, tickers = [] } = {}) {
  const rand = mulberry(seedOf("dp" + session));
  const names = tickers.length ? tickers : ["MSFT", "AAPL", "MRVL"];
  const open = sessionOpen(session);
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const ext = i < 12;
    const at = ext ? easternInstant(session, 19 * 60 + 50) + i * 1000 : open + Math.round(rand() * Math.max(60000, now - open));
    const size = Math.round(100 + rand() * 50000);
    const px = 50 + rand() * 450;
    rows.push({
      size, ticker: names[i % names.length], price: px.toFixed(4), volume: Math.round(rand() * 3e7),
      executed_at: isoZ(at), canceled: i === 20, premium: (size * px).toFixed(4), sale_cond_codes: null,
      nbbo_ask: (px + 0.02).toFixed(2), nbbo_bid: (px - 0.02).toFixed(2),
      ext_hour_sold_codes: ext ? "extended_hours_trade" : "regular_hours", market_center: "L",
      nbbo_ask_quantity: 100, nbbo_bid_quantity: 100, tracking_id: 30786411976718 + i, trade_code: null,
      trade_settlement: "regular", trf_executed_at: isoZ(at),
    });
  }
  rows.sort((a, b) => (a.executed_at < b.executed_at ? 1 : -1));
  return { data: rows };
}

export function fakeNews({ session, now, tickers = [] } = {}) {
  const rand = mulberry(seedOf("news" + session));
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const t = tickers.length ? [tickers[i % tickers.length]] : [];
    rows.push({ meta: {}, source: i % 3 ? "Business Wire" : "Benzinga", created_at: isoZ(now - i * 90000),
      tags: [], tickers: t, headline: `Synthetic headline ${i + 1}${t.length ? " for " + t[0] : ""}`,
      is_major: rand() > 0.9, sentiment: ["neutral", "positive", "negative"][Math.floor(rand() * 3)] });
  }
  return { data: rows };
}

export function fakeBoards({ n = 40 } = {}) {
  const make = (prefix, sign) => Array.from({ length: n }, (_, i) => ({
    t: `${prefix}${String(i + 1).padStart(3, "0")}`, s: sign * (95 - i),
  }));
  return {
    long: { rows: make("SYL", 1) },
    short: { rows: make("SYS", -1) },
    watch: { rows: Array.from({ length: 12 }, (_, i) => ({ t: `SYW${String(i + 1).padStart(3, "0")}`, s: 10 - i })) },
  };
}

export function fakeLiveVendor({ now, session }) {
  const calls = [];
  const clock = typeof now === "function" ? now : () => now;
  async function fakeUw(path, params = {}, { envelope = false } = {}) {
    calls.push({ path, params });
    const at = clock();
    let body;
    let m;
    if (path === "/api/market/market-tide") body = fakeMarketTide({ session, now: at });
    else if (path === "/api/net-flow/expiry") body = fakeNetFlow({ session, now: at, expiration: params.expiration || "zero_dte" });
    else if ((m = /^\/api\/market\/([^/]+)\/etf-tide$/.exec(path))) body = fakeEtfTide(decodeURIComponent(m[1]), { session, now: at });
    else if ((m = /^\/api\/market\/([^/]+)\/sector-tide$/.exec(path))) body = fakeSectorTide(decodeURIComponent(m[1]), { session, now: at });
    else if (path === "/api/market/sector-etfs") body = fakeSectorEtfs({ session });
    else if (path === "/api/screener/stocks") {
      const list = String(params.ticker || "").split(",").filter(Boolean);
      body = fakeScreenerRows(list.filter((t) => !/^SYW012$/.test(t)), { session, dated: !!params.date });
    } else if (path === "/api/option-trades/flow-alerts") {
      const tickers = params.ticker_symbol ? String(params.ticker_symbol).split(",") : [];
      const count = params.older_than ? 40 : Math.min(Number(params.limit) || 200, tickers.length ? 30 : 200);
      body = fakeFlowAlerts({ session, now: at, tickers, count, seed: "fa" + (params.older_than || ""),
        newerThan: params.newer_than || null });
    } else if ((m = /^\/api\/stock\/([^/]+)\/spot-exposures$/.exec(path))) body = fakeSpotExposures(decodeURIComponent(m[1]), { session, now: at });
    else if ((m = /^\/api\/stock\/([^/]+)\/net-prem-ticks$/.exec(path))) body = fakeNetPremTicks(decodeURIComponent(m[1]), { session, now: at });
    else if (path === "/api/market/total-options-volume") body = fakeTotalOptionsVolume({ session });
    else if (path === "/api/market/top-net-impact") body = fakeTopNetImpact({ session });
    else if (path === "/api/darkpool/recent") body = fakeDarkpoolRecent({ session, now: at });
    else if (path === "/api/news/headlines") body = fakeNews({ session, now: at });
    else throw new Error(`${path} -> HTTP 404 (no fake for this route)`);
    return envelope ? body : (Array.isArray(body) ? body : body.data || []);
  }
  fakeUw.calls = calls;
  return fakeUw;
}

export const FAKE_SECTORS = SECTOR_TIDES.map((s) => s.sector);
