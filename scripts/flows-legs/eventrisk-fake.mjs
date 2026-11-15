import { addDays } from "../../shared/flows-cross.js";
import { touch } from "./taint.mjs";

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
};

const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SECTORS = ["Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities"];

const GRAMMAR = {
  flow_alert: { total_premium: "number", volume_oi_ratio: "number", dte: "integer" },
  option_trade: { premium: "number" },
  option_contract: { oi_change: "integer" },
  ticker_interval_flow: { net_premium: "number" },
  news: { headline: "string" },
  trading_state: { state: "string", reason: "string" },
  multi_leg_trade: { legs: "integer" },
};

export function eventRiskHandlers({ sessionDate, tickers = [] }) {
  touch("eventRiskHandlers");
  const S = sessionDate;
  const utc = (day, hh, mm) => `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`;
  const list = tickers.length ? tickers : ["SYN101", "SYN102", "SYN103"];

  return [
    [/^\/api\/calendar\/ipo$/, () => {
      const rnd = prng(hash("ipo:" + S));
      const ipos = Array.from({ length: 18 }, (_, i) => {
        const lo = Math.round((8 + rnd() * 30) * 100) / 100;
        return {
          ticker: `SYE${200 + i}`, name: `Invented Issuer ${i} Holdings`, exchange: i % 3 === 0 ? "NYSE" : "NASDAQ",
          ipo_date: addDays(S, 1 + Math.floor(rnd() * 80)), price_range_low: lo, price_range_high: Math.round((lo + rnd() * 4) * 100) / 100, currency: "USD",
        };
      });
      ipos.push({ ticker: "SYE299", name: "Invented Range Issuer", exchange: null, ipo_date: addDays(S, 9), price_range_low: 20, price_range_high: 18, currency: "USD" });
      ipos.push({ ticker: "SYE298", name: "Invented Unpriced Issuer", exchange: "NYSE", ipo_date: addDays(S, 11), price_range_low: null, price_range_high: null, currency: null });
      return { data: { ipos } };
    }],
    [/^\/api\/companies\/listings$/, (p) => {
      if (p.status === "delisted") {
        const day = p.date || S;
        const rnd = prng(hash("del:" + day));
        const rows = Array.from({ length: 4 }, (_, i) => ({
          ticker: `SYE${400 + i + Math.floor(rnd() * 5) * 10}`, name: `Invented Delisted ${i} Inc`, exchange: "NYSE", asset_type: "Stock",
          ipo_date: "2016-03-01", delisting_date: day, status: "delisted",
        }));
        if (list.length) rows.push({ ticker: list[0], name: "Invented Universe Name", exchange: "NASDAQ", asset_type: "Stock", ipo_date: "2016-03-01", delisting_date: day, status: "delisted" });
        return { data: { status: "delisted", date: day, listings: rows } };
      }
      const rnd = prng(hash("act:" + S));
      const listings = Array.from({ length: 40 }, (_, i) => ({
        ticker: `SYE${300 + i}`, name: `Invented Listing ${i} Corp`, exchange: i % 2 ? "NYSE" : "NASDAQ", asset_type: i % 7 === 0 ? "ETF" : "Stock",
        ipo_date: addDays(S, -Math.floor(rnd() * 120)), delisting_date: null, status: "active",
      }));
      return { data: { status: "active", date: null, listings } };
    }],
    [/^\/api\/potus\/schedule$/, (p) => {
      const day = p.date || S;
      const rnd = prng(hash("pot:" + day));
      const rows = [];
      if (rnd() > 0.15) rows.push({ type: "event", date: day, time: utc(day, 15, 0), details: "Invented meeting on trade terms", location: "Invented Hall", coverage: "Pool spray", url: null, video_url: null });
      if (rnd() > 0.4) rows.push({ type: "travel", date: day, time: null, details: "Departs for an invented city", location: "Invented Field", coverage: null, url: null, video_url: null });
      if (rnd() > 0.6) rows.push({ type: "event", date: day, time: utc(day, 22, 30), details: "Invented evening reception", location: "Invented Room", coverage: "Closed", url: null, video_url: null });
      return rows;
    }],
    [/^\/api\/potus\/posts$/, () => {
      const base = Date.parse(utc(S, 14, 30));
      const rnd = prng(hash("post:" + S));
      const tag = list[Math.floor(rnd() * list.length)];
      return Array.from({ length: 24 }, (_, i) => ({
        timestamp: base - i * 5 * 3600000,
        post: `Invented note ${i} on tariff talks and energy supply. $${tag} noted.`,
      }));
    }],
    [/^\/api\/stock\/([A-Z0-9.]+)\/earnings$/, (p, m) => {
      const rnd = prng(hash("eps:" + m[1]));
      const rows = [];
      for (let i = 0; i < 14; i++) {
        const rd = addDays(S, -(20 + i * 91));
        const fe = addDays(rd, -35);
        const est = Math.round((0.5 + rnd() * 3) * 100) / 100;
        const rep = Math.round((est * (0.8 + rnd() * 0.5)) * 100) / 100;
        const sp = est ? ((rep - est) / Math.abs(est)) * 100 : null;
        rows.push({
          ticker: m[1], report_type: i === 3 ? "annual" : "quarterly", fiscal_date_ending: fe,
          report_date: rd, report_time: rnd() > 0.5 ? "premarket" : "postmarket",
          reported_eps: String(rep), estimated_eps: String(est), surprise: String(Math.round((rep - est) * 100) / 100),
          surprise_percentage: sp === null ? null : sp.toFixed(4),
        });
      }
      return { data: rows };
    }],
    [/^\/api\/stock\/([A-Z0-9.]+)\/(income-statements|balance-sheets|cash-flows)$/, (p, m) => {
      const rnd = prng(hash("fin:" + m[1]));
      const rows = [];
      for (let i = 0; i < 10; i++) {
        const base = Math.round(1e9 + rnd() * 9e9);
        const row = { report_type: "quarterly", fiscal_date_ending: addDays(S, -30 - i * 91), reported_currency: "USD" };
        if (m[2] === "income-statements") Object.assign(row, { total_revenue: String(base), gross_profit: String(Math.round(base / 3)), operating_income: String(Math.round(base / 8)), net_income: String(Math.round(base / 11)) });
        else if (m[2] === "balance-sheets") Object.assign(row, { cash_and_short_term_investments: String(Math.round(base / 2)), short_long_term_debt_total: String(base), total_shareholder_equity: String(base * 2) });
        else Object.assign(row, { operating_cashflow: String(Math.round(base / 7)), capital_expenditures: String(Math.round(base / 30)), net_income: String(Math.round(base / 11)) });
        rows.push(row);
      }
      return { data: rows };
    }],
    [/^\/api\/stock\/([A-Z0-9.]+)\/technical-indicator\/NATR$/, (p, m) => {
      const rnd = prng(hash("natr:" + m[1]));
      return { data: [{ ticker: m[1], indicator: "NATR", interval: "daily", time_period: 14, series_type: "close", date: addDays(S, 0), values: { NATR: (1 + rnd() * 5).toFixed(4) } }] };
    }],
    [/^\/api\/stock\/([A-Z0-9.]+)\/options-pulse$/, (p, m) => {
      const rnd = prng(hash("pulse:" + m[1]));
      const calls = 3 + Math.floor(rnd() * 30);
      const puts = 3 + Math.floor(rnd() * 30);
      return { data: { latest: { trd_dt: p.date || S, hr_min: "1000", call_txn: calls, put_txn: puts }, intraday: [{ trd_dt: p.date || S, hr_min: "1000", call_txn: calls, put_txn: puts }] } };
    }],
    [/^\/api\/stock\/([^/]+)\/tickers$/, (p, m) => {
      const sector = decodeURIComponent(m[1]);
      const at = SECTORS.indexOf(sector);
      return { data: list.filter((t) => hash(t) % SECTORS.length === at) };
    }],
    [/^\/api\/alerts$/, () => {
      const rnd = prng(hash("alerts:" + S));
      const rows = Array.from({ length: 8 }, (_, i) => {
        const at = new Date(Date.parse(utc(S, 15, 0)) - (i * 31 + Math.floor(rnd() * 20)) * 3600000).toISOString();
        return {
          id: "a" + i, created_at: at, noti_type: "trading_state", symbol: `SYH${String(1 + (i % 5)).padStart(3, "0")}`, user_noti_config_id: "c1", name: "Invented",
          meta: { state: i % 2 ? "resumed" : "halted", reason: i % 3 ? "T1" : "LUDP", time: at },
        };
      });
      return { data: rows };
    }],
    [/^\/api\/alerts\/configuration$/, () => ({
      data: [
        { id: "c1", noti_type: "trading_state", status: "active", name: "Halts on my names", created_at: addDays(S, -30) + "T10:00:00Z", config: { symbols: ["SYH001"] } },
        { id: "c2", noti_type: "earnings", status: "paused", name: "Earnings watch", created_at: addDays(S, -29) + "T10:00:00Z", config: { days: 3 } },
      ],
    })],
    [/^\/api\/alerts\/filters$/, () => ({
      data: { trading_state: ["state", "reason"], flow_alerts: ["total_premium", "volume_oi_ratio", "dte"], chain_oi_change: ["oi_change"], earnings: [], economic_release: [], fda: [] },
      access: { trading_state: true, flow_alerts: true, chain_oi_change: true, earnings: true, economic_release: true, fda: true },
      noti_type_descriptions: { trading_state: "Trading halts and resumptions", flow_alerts: "Large flagged option windows", chain_oi_change: "Open interest change", earnings: "Earnings reports", economic_release: "Economic releases", fda: "FDA dates" },
      filter_descriptions: {}, rate_limits: { trading_state: 50, flow_alerts: 20, chain_oi_change: 20, earnings: 10, economic_release: 10, fda: 10 },
    })],
    [/^\/api\/alerts\/query\/grammar$/, (p) => {
      if (!p.target) return { targets: Object.keys(GRAMMAR) };
      const fields = GRAMMAR[p.target];
      if (!fields) throw new Error("/api/alerts/query/grammar -> HTTP 422");
      return { fields: Object.fromEntries(Object.entries(fields).map(([k, type]) => [k, { type }])) };
    }],
  ];
}
