import { readFileSync } from "node:fs";
import { buildUniverse } from "../shared/flows-cross.js";
import { shapeStrips, shapeMarketLive, mergeLiveAlerts, shapeTickerTape } from "../shared/flows-live.js";
import { latestShortInterest, borrowSummary, shortVolumeSummary, insiderSummary } from "../shared/flows-ownership.js";
import { earningsHistory } from "../shared/flows-catalysts.js";
import { eventRow } from "../shared/flows-events.js";

export const NOW_ISO = "2026-10-02T14:30:00.000Z";
export const NOW = Date.parse(NOW_ISO);
export const TODAY = "2026-10-02";
export const SESSION = "2026-10-01";
export const GENERATED = "2026-10-02T00:10:00.000Z";
export const T = "EXMP";

export const VENDOR = JSON.parse(readFileSync(new URL("./fixtures-dossier-vendor.json", import.meta.url), "utf8"));

const leg = (type, k, side, qty = 1) => ({ type, k, side, qty });
const st = (id, family, risk, dir, legs, grade, rules, prob, ev, maxProfit, maxLoss) => ({
  id, family, risk, dir, expiry: "2026-10-16", dte: 14, sessions: 10, legs, grade, gradeWhy: grade < 3 ? ["fit.in-spread"] : [],
  rules, prob: { popQ: prob[0], popP: prob[1] }, ev: { q: ev[0], p: ev[1], edge: ev[1] - ev[0] }, maxProfit, maxLoss,
  profitUnbounded: false, lossUnbounded: risk === "undefined", score: grade / 10,
});

export const ENGINE = {
  v: 1, engine: "q1", asOf: "2026-10-01T20:00:00.000Z", spot: 127.4, atr: 3.1,
  facts: [
    { id: "iv.cm.30", v: 0.41, u: "vol", g: 3 },
    { id: "iv.pct.30", v: 0.82, u: "frac", g: 2 },
    { id: "iv.pctile.30.1y", v: 0.82, u: "frac", g: 2 },
    { id: "vrp.rel.21", v: 0.18, u: "frac", g: 3 },
    { id: "term.slope.30_90.exEvent", v: 0.05, u: "frac", g: 2 },
    { id: "level.putWall", v: 120, u: "px", g: 3, atr: -2.4 },
    { id: "level.callWall", v: 135, u: "px", g: 3, atr: 2.4 },
    { id: "level.flip", v: 124, u: "px", g: 3, atr: -1.1 },
    { id: "gex.book", v: 1.2e6, u: "usdPer1pct", g: 3 },
    { id: "move.event.ratio", v: null, u: "ratio", g: 0, why: "event.none" },
  ],
  state: { state: "pinned", direction: null, confidence: 2, premium: "rich",
    preferred: ["iron condor", "put credit spread"], avoid: ["long straddle", "long call"] },
  levels: { callWall: 135, putWall: 120, magnet: 128, flip: 124, maxPain: 126 },
  structures: [
    st("S1", "put-credit-spread", "defined", "bull", [leg("P", 120, -1), leg("P", 115, 1)], 3, ["state.pinned", "vrp.rich"], [0.72, 0.78], [-3, 21], 140, -360),
    st("S2", "iron-condor", "defined", "neutral", [leg("P", 120, -1), leg("P", 115, 1), leg("C", 135, -1), leg("C", 140, 1)], 2, ["state.pinned"], [0.55, 0.61], [-6, 18], 210, -290),
  ],
  ideas: ["S1", "S2"], noTrade: null, priced: 24, families: [],
};

export function closesFor(n = 260, last = 127.4) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Number((last * (0.62 + 0.38 * (i / (n - 1))) * (1 + 0.01 * Math.sin(i / 5))).toFixed(2)));
  out[n - 1] = last;
  return out;
}

export function card(ticker = T, o = {}) {
  const closes = closesFor();
  return {
    ticker, nm: "Example Technologies", sector: "Technology", sessionDate: o.sessionDate || SESSION,
    generatedAt: GENERATED, depth: "board", score: 61, conviction: 78,
    conv: { agreement: 1, breadth: 3, coverage: 0.9, persistence: 0.6, gate: 1.4 },
    quality: { otmShare: 0.6, vegaTilt: 0.2 },
    regime: { label: "long", labelFrom: "book", labelValue: 1.2e6, crossings: 1, flowGamma: 2.1e5, flowLabel: "long", bookGammaRaw: 1.2e6, bookShare: 0.4 },
    strikeSumCrossing: 124, zeroGamma: 124.2, atr: 3.1,
    fam: { F: 59, P: 32, D: 58, V: 51, O: 71 },
    engine: o.engine === false ? undefined : { status: "split", key: "card-x:" + ticker, bytes: 4000 },
    panels: {
      gamma: { status: "ok", spot: 127.4, flowPeakLong: 130, flowPeakShort: 122, strikes: 40,
        lead: { say: "Dealer gamma for " + ticker + " is long at spot 127.40; the call wall is at 135.00 and the put wall at 120.00." } },
      levels: { status: "ok", spot: 127.4, atr: 3.1,
        levels: [{ kind: "put_wall", label: "Put wall", px: 120, distPct: -0.058, distAtr: -2.4 }, { kind: "call_wall", label: "Call wall", px: 135, distPct: 0.06, distAtr: 2.4 }],
        lead: { say: "Nearest: put wall at 120.00, 5.8% below spot 127.40." } },
      pricedMove: { status: "ok", impliedMove: 0.052, impliedLow: 120.8, impliedHigh: 134, sessions: 10,
        lead: { say: "Options price a +/-5.2% move over 10 sessions: 120.80 to 134.00." } },
      path: { status: "ok", minutes: 390, persistence: 0.7, netPremium: 3100000, lead: { say: "Net buying over 390 minutes." } },
      congress: { status: "ok", total: 3, buys: 1, sells: 2, medianLagDays: 21, lead: { say: "Congress disclosed 3 trades in this name." } },
      darkpool: { status: "ok", seen: 3, cap: 12, shed: 0, unpriced: 0, rows: [
        { at: "2026-10-01T15:02:00Z", px: 126.5, size: 410000, prem: 51865000, bid: 126.4, ask: 126.6, canceled: false },
        { at: "2026-10-01T17:40:00Z", px: 127.1, size: 220000, prem: 27962000, bid: 127, ask: 127.2, canceled: false },
        { at: "2026-10-01T19:10:00Z", px: 125.9, size: 180000, prem: 22662000, bid: 125.8, ask: 126, canceled: false },
      ] },
      context: { status: "ok", r5: 0.021, r21: 0.063, r42: 0.11, week52Pos: 0.84, changePct: 0.0127, closes, sessions: 260,
        lead: { say: "Sitting at 84% of its 52-week range, up 6.3% over 21 sessions." },
        garch: { status: "ok", dist: "skewt", converged: true, lastVol: 31.2, nextVol: 30.6, longRunVol: 29.5, nu: 6.1, lambda: -0.2, persistence: 0.98, n: 251 } },
    },
  };
}

const row = (t, i, o = {}) => ({
  ticker: t, full_name: t + " Corp", sector: i % 2 ? "Healthcare" : "Technology", close: String(120 + i), prev_close: String(119 + i),
  marketcap: String(8.4e10 - i * 1.1e10), volatility_30: "0.41", iv30d: "0.41", volatility_90: "0.39", volatility_7: "0.44", iv_percentile_1y: "71",
  realized_volatility: "0.30", rv_1d_last_12q: "1.1", variance_risk_premium: "0.04", gex_gamma_per_one_percent_move_oi: String(2.1e6),
  gex_delta_per_one_percent_move_oi: String(8e6), gex_vanna_per_one_percent_move_oi: String(5e5), gex_charm_per_one_percent_move_oi: String(1e5),
  avg30_volume: "5400000", cum_dir_delta: "120000", short_int: "0.021", insider_buy_volume_3m: "10000", insider_sell_volume_3m: "30000",
  shares_outstanding: "512000000", next_earnings_date: "2026-10-22", er_time: "postmarket", rsi_14: "58", adx_14: "27", bb_20_2_lower: "118",
  bb_20_2_upper: "132", atr_14: "3.1", sma_50: "121", relative_volume: "1.3", net_call_premium: "4000000", net_put_premium: "1000000",
  bullish_premium: "5000000", bearish_premium: "2000000", call_volume: "30000", put_volume: "20000", call_volume_ask_side: "16000",
  put_volume_ask_side: "9000", implied_move_perc_5: "0.021", implied_move_perc_30: "0.052", gex_ratio: "0.8", ...o,
});

export const UNIVERSE_TICKERS = Object.freeze(["BIGG", T, "A", "AA", "BRK.B", "PLAIN", "SMALL"]);

export function universe(tickers = UNIVERSE_TICKERS) {
  const rows = tickers.map((t, i) => row(t, i, t === "SMALL" ? { marketcap: "9e8", sector: "Energy" } : t === T || t === "BIGG" ? { sector: "Technology" } : {}));
  return buildUniverse(rows, { sessionDate: SESSION, generatedAt: GENERATED });
}

export function cardX(ticker = T, o = {}) {
  const sessionDate = o.sessionDate || SESSION;
  const si = latestShortInterest([{ symbol: ticker, market_date: "2026-09-15", si_float: "0.021", days_to_cover: "2.4", short_interest: 9800000, total_float: 466000000 }],
    { sessionDate }).byTicker.get(ticker);
  const borrow = borrowSummary([{ timestamp: "2026-10-01T18:00:00Z", fee_rate: "0.31", rebate_rate: "4.1", short_shares_available: 10000000 }], { sessionDate });
  const volume = shortVolumeSummary(Array.from({ length: 50 }, (_, i) => ({ market_date: new Date(Date.parse("2026-10-01T12:00:00Z") - i * 86400000).toISOString().slice(0, 10),
    short_volume_ratio: String(0.44 + 0.01 * Math.sin(i)) })).filter((r) => ![0, 6].includes(new Date(r.market_date + "T12:00:00Z").getUTCDay())), { sessionDate });
  const insiders = insiderSummary([
    { id: "a", transaction_date: "2026-09-12", filing_date: "2026-09-14", transaction_code: "S", amount: "-4000", price: "130", reporter_cik: "1", is_officer: true },
    { id: "b", transaction_date: "2026-08-20", filing_date: "2026-08-22", transaction_code: "P", amount: "2500", price: "118", reporter_cik: "2", is_director: true },
  ], { sessionDate });
  const earnings = earningsHistory(VENDOR.bodies.earnings.data, { sessionDate });
  return { v: 1, ticker, generatedAt: GENERATED, sessionDate, engine: o.engine === false ? undefined : ENGINE, short: { status: "ok", interest: si, borrow, volume }, insiders, earnings };
}

export function regime() {
  const tide = (net) => ({ status: "ok", date: SESSION, sameSession: true, ncp: net > 0 ? net : 0, npp: 0, net, dir: Math.sign(net), points: 80 });
  return {
    v: 1, generatedAt: GENERATED, sessionDate: SESSION, status: "ok",
    etfTide: { status: "ok", byEtf: { SPY: tide(2.4e8), QQQ: tide(-1.1e8), IWM: tide(3e7) } },
    zeroDte: { status: "ok", date: SESSION, share: 0.38 },
    volCurve: { status: "ok", byIndex: { SPY: { status: "ok", ts: -0.06, fs: -0.02, shape: "contango" }, QQQ: { status: "ok" } } },
    impliedCorrelation: { status: "ok", byIndex: { SPY: { status: "ok", rho: 0.41 }, QQQ: { status: "ok", rho: 0.5 } } },
  };
}

export function events(tickers = [T, "OTHR"]) {
  const rows = tickers.map((t, i) => eventRow({ ticker: t, next_earnings_date: i ? "2026-10-27" : "2026-10-22", close: 127.4, sector: "Technology" },
    { iv30: 0.41, impliedMovePerc: 0.07, ivRank: 71 }, { gateOrigin: SESSION, stage: i ? "gated" : "board:long", score: 61 }));
  return {
    v: 1, generatedAt: GENERATED, sessionDate: SESSION, rows,
    macro: { status: "ok", rows: [
      { at: "2026-10-02T12:30:00.000Z", day: "2026-10-02", sd: 1, event: "Nonfarm Payrolls", type: "report", tag: "jobs", prev: 150, forecast: 140, period: "Sep" },
      { at: "2026-10-07T18:00:00.000Z", day: "2026-10-07", sd: 4, event: "FOMC Minutes", type: "report", tag: "fed", prev: null, forecast: null, period: null },
      { at: "2026-10-14T12:30:00.000Z", day: "2026-10-14", sd: 9, event: "CPI", type: "report", tag: "inflation", prev: 2.9, forecast: 2.8, period: "Sep" },
    ], seen: 3, past: 0 },
  };
}

export const roster = () => ({ v: 1, sessionDate: SESSION, depth: { [T]: "board", PLAIN: "cross", PEND: "cross" } });

export function stripsPayload(ticker = T, o = {}) {
  const at = Date.parse(o.at || "2026-10-02T14:25:00.000Z");
  const raw = { data: [{ ticker, close: "127.40", prev_close: "125.80", net_call_premium: "6200000", net_put_premium: "1800000", bullish_premium: "7000000",
    bearish_premium: "2500000", call_volume: 41000, put_volume: 23000, call_volume_ask_side: 22000, put_volume_ask_side: 9000, iv30d: "0.41", iv_rank: "71",
    implied_move_perc: "0.052", gex_gamma_per_one_percent_move_oi: "2100000", put_call_ratio: "0.56", relative_volume: "1.4", stock_volume: 2150000,
    quote_time: new Date(at - 20000).toISOString(), date: TODAY }] };
  return shapeStrips(raw, { at, session: TODAY, names: [ticker], writer: "actions" });
}

export function marketPayload() {
  const at = Date.parse("2026-10-02T14:27:00.000Z");
  const tide = { data: [
    { timestamp: "2026-10-02T13:35:00Z", net_call_premium: "40000000", net_put_premium: "10000000", net_volume: 120000, date: TODAY },
    { timestamp: "2026-10-02T14:25:00Z", net_call_premium: "95000000", net_put_premium: "30000000", net_volume: 260000, date: TODAY },
  ] };
  const sectors = { data: [{ ticker: "XLK", last: "232.1", prev_close: "229.9", bullish_premium: "9000000", bearish_premium: "4000000", call_premium: "1", put_premium: "1", call_volume: 1, put_volume: 1, volume: 2 }] };
  return shapeMarketLive({ tide, sectors }, { at, session: TODAY, writer: "worker" });
}

export function alertsPayload(ticker = T) {
  const at = Date.parse("2026-10-02T14:20:00.000Z");
  const mk = (id, oc, prem, ask, sweep) => ({ ticker, option_chain: oc, total_premium: String(prem), total_ask_side_prem: String(ask), total_bid_side_prem: "1000", total_size: 400, trade_count: 6,
    open_interest: 1200, volume_oi_ratio: "2.1", underlying_price: "127.4", has_sweep: sweep, has_floor: false, has_singleleg: true, all_opening_trades: true,
    start_time: "2026-10-02T13:50:00Z", end_time: "2026-10-02T13:52:00Z", created_at: "2026-10-02T13:52:30Z", iv_start: "0.4", iv_end: "0.41", alert_rule: "RepeatedHits" + id });
  const other = { ...mk(9, "OTHR261016C00050000", 800000, 500000, false), ticker: "OTHR" };
  const pages = [{ body: { data: [mk(1, "EXMP261016C00135000", 2100000, 1700000, true), mk(2, "EXMP261016P00120000", 640000, 100000, false), other] }, full: false }];
  return mergeLiveAlerts(null, pages, { at, session: TODAY, writer: "actions" }).write;
}

export function tapePayload(ticker = T) {
  const at = Date.parse("2026-10-02T14:28:00.000Z");
  const ticks = { data: [
    { tape_time: "2026-10-02T13:40:00Z", net_call_premium: "900000", net_put_premium: "100000", net_delta: "1200", call_volume: 500, put_volume: 100, call_volume_ask_side: 300, call_volume_bid_side: 100, put_volume_ask_side: 40, put_volume_bid_side: 30 },
    { tape_time: "2026-10-02T14:20:00Z", net_call_premium: "1100000", net_put_premium: "150000", net_delta: "1900", call_volume: 700, put_volume: 150, call_volume_ask_side: 400, call_volume_bid_side: 120, put_volume_ask_side: 60, put_volume_bid_side: 40 },
  ] };
  return shapeTickerTape({ ticks, alerts: { data: [] }, spot: { data: [] } }, { at, session: TODAY, ticker, now: at });
}

export function liveNewsPayload(ticker = T) {
  return {
    v: 2, status: "ok", sessionDate: TODAY, rows: [
      { headline: ticker + " wins a multi-year cloud contract", source: "Reuters", createdAt: "2026-10-02T13:10:00.000Z", createdAtMs: Date.parse("2026-10-02T13:10:00.000Z"), major: false, sentiment: "positive", tickers: [ticker], tags: [] },
      { headline: "Unrelated market wrap", source: "Reuters", createdAt: "2026-10-02T13:00:00.000Z", createdAtMs: Date.parse("2026-10-02T13:00:00.000Z"), major: false, sentiment: "neutral", tickers: ["OTHR"], tags: [] },
    ],
  };
}

export function seed(f, o = {}) {
  const at = 1790900000000;
  f.put("universe", universe(o.tickers), at);
  f.put("card:" + T, card(T), at);
  f.put("card-x:" + T, cardX(T), at);
  f.put("regime", regime(), at);
  f.put("events", events(), at);
  f.put("roster", roster(), at);
  f.put("news", { v: 1, status: "ok", sessionDate: SESSION, rows: [] }, at);
  if (o.live !== false) {
    const strips = stripsPayload();
    const market = marketPayload();
    const alerts = alertsPayload();
    f.live("live:strips", strips, Date.parse("2026-10-02T14:25:00.000Z"), TODAY);
    f.live("live:market", market, Date.parse("2026-10-02T14:27:00.000Z"), TODAY);
    f.live("live:alerts", alerts, Date.parse("2026-10-02T14:20:00.000Z"), TODAY);
    f.live("live:news", liveNewsPayload(), Date.parse("2026-10-02T14:15:00.000Z"), TODAY);
    if (f.tape) f.tape(T, tapePayload(), Date.parse("2026-10-02T14:28:00.000Z"), TODAY);
  }
}

export function vendorBody(key) {
  return JSON.parse(JSON.stringify(VENDOR.bodies[key]));
}
