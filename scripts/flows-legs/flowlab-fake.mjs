import { touch } from "./taint.mjs";

function prng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export const FLOWLAB_FAKE_TICKERS = Object.freeze(["SYX101", "SYX202", "SYX303", "SYX404", "SYX505"]);

export const FLOWLAB_FAKE_REFUSED_GROUP = "uranium";

const money = (v) => v.toFixed(2);

const osi = (root, expiry, cp, strike) => root + expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10) + cp + String(Math.round(strike * 1000)).padStart(8, "0");

const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

function screenerBody(S, params) {
  const rnd = prng(hash("screen:" + (params.order || "") + (params.ticker_symbol || "")));
  const tickers = params.ticker_symbol ? [params.ticker_symbol] : FLOWLAB_FAKE_TICKERS;
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const t = tickers[i % tickers.length];
    const expiry = addDays(S, 7 + (i % 6) * 7);
    const cp = i % 3 === 0 ? "P" : "C";
    const strike = 40 + (i % 9) * 5;
    const vol = 200 + Math.floor(rnd() * 9000);
    const ask = Math.floor(vol * (0.25 + rnd() * 0.4));
    const bid = Math.floor(vol * rnd() * 0.3);
    const mid = Math.floor(vol * rnd() * 0.1);
    const none = Math.max(0, vol - ask - bid - mid);
    const avg = 0.4 + rnd() * 5;
    rows.push({
      ask_side_volume: ask, avg_price: money(avg), bid_side_volume: bid, chain_prev_close: money(avg * 0.9), close: money(avg), cross_volume: Math.floor(vol * 0.01),
      er_time: "premarket", expiry, floor_volume: Math.floor(vol * rnd() * 0.3), high: money(avg * 1.2), last_fill: S + "T19:41:12Z", low: money(avg * 0.8),
      mid_volume: mid, multileg_volume: Math.floor(vol * rnd() * 0.2), next_earnings_date: addDays(S, 12), no_side_volume: none, open: money(avg), open_interest: Math.floor(rnd() * vol * 2),
      option_symbol: osi(t, expiry, cp, strike), option_type: cp === "C" ? "call" : "put", premium: money(avg * vol * 100), sector: "Technology",
      stock_multi_leg_volume: Math.floor(vol * rnd() * 0.05), stock_price: money(strike + 3), strike: money(strike), sweep_volume: Math.floor(vol * rnd() * 0.7),
      ticker_vol: vol * 5, total_ask_changes: 1, total_bid_changes: 1, trades: Math.max(1, Math.floor(vol / 9)), volume: vol,
    });
  }
  return { data: rows };
}

function exchangeBody(params) {
  const rows = [];
  const codes = params.by_trade_code === "true" || params.by_trade_code === true;
  for (const t of FLOWLAB_FAKE_TICKERS) {
    const rnd = prng(hash("venue:" + t + (codes ? "c" : "x")));
    for (const label of codes ? ["auto", "isoi", "mlet", "late", "cbmo", "tlet", "mesl"] : ["XCBO", "XPHL", "XNAS", "XISX", "XBOX"]) {
      const trades = 50 + Math.floor(rnd() * 3000);
      rows.push({
        call_trades: Math.floor(trades / 2), contracts: trades * 3 + Math.floor(rnd() * 500), exchange: codes ? "" : label, premium: Math.round(trades * 3 * 100 * (1 + rnd()) * 100) / 100,
        put_trades: trades - Math.floor(trades / 2), trade_code: codes ? label : "", trade_count: trades, underlying_symbol: t,
      });
    }
  }
  return { data: rows };
}

function groupBody(S, params, group) {
  if (group === FLOWLAB_FAKE_REFUSED_GROUP) {
    throw new Error("/api/group-flow -> HTTP 403");
  }
  const rnd = prng(hash("group:" + group));
  const rows = [];
  const open = Date.parse(S + "T13:30:00Z");
  for (let i = 0; i < 39; i++) {
    const d = (rnd() - 0.4) * 80000;
    const v = (rnd() - 0.45) * 25000;
    rows.push({
      dir_delta_flow: d.toFixed(2), dir_vega_flow: v.toFixed(2), expiry: params.expiry || addDays(S, 28), flow_group: group, net_call_premium: money(rnd() * 90000 - 20000), net_call_volume: 100 + i,
      net_put_premium: money(rnd() * 60000 - 30000), net_put_volume: 80 + i, otm_dir_delta_flow: (d * 0.6).toFixed(2), otm_dir_vega_flow: (v * 0.6).toFixed(2),
      otm_total_delta_flow: Math.abs(d).toFixed(2), otm_total_vega_flow: Math.abs(v).toFixed(2), timestamp: new Date(open + i * 600000).toISOString(),
      total_delta_flow: (Math.abs(d) * 1.5).toFixed(2), total_vega_flow: (Math.abs(v) * 1.5).toFixed(2), transactions: 40 + i, volume: 900 + i * 11,
    });
  }
  return { data: rows };
}

function analyticsBody(params) {
  const symbols = String(params.symbols || "").split(",").filter(Boolean);
  const payload = {};
  for (const a of symbols) {
    payload[a] = {};
    for (const b of symbols) payload[a][b] = a === b ? 1 : Math.round(((hash(a < b ? a + b : b + a) % 1800) / 1000 - 0.9) * 1000) / 1000;
  }
  return { data: { meta: { symbols, calculations: ["correlation"] }, payload } };
}

export function flowlabHandlers(S) {
  touch("flowlabHandlers");
  return [
    [/^\/api\/screener\/option-contracts$/, (p) => screenerBody(S, p)],
    [/^\/api\/option-trades\/optionable-tickers$/, () => ({ data: [...FLOWLAB_FAKE_TICKERS, "SYX606"].sort() })],
    [/^\/api\/option-trades\/exchange-breakdown\/\d{4}-\d{2}-\d{2}$/, (p) => exchangeBody(p)],
    [/^\/api\/group-flow\/([^/]+)\/greek-flow\/\d{4}-\d{2}-\d{2}$/, (p, m) => groupBody(S, p, decodeURIComponent(m[1]))],
    [/^\/api\/analytics\/(window|sliding)$/, (p) => analyticsBody(p)],
  ];
}
