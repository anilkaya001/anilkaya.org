import { read, pastDeadline } from "./common.mjs";
import { pathFor } from "../../shared/flows-vendor-ops.js";
import {
  MATURITIES, INDICATORS, QUARTERLY, DAILY_COMMODITIES, MONTHLY_COMMODITIES, FX_PAIRS, CRYPTO, PRODUCTS, FLOW_GROUPS, LARGE,
  CURVE_PRODUCTS, SEASON_FUNDS, SEASON_CHECK, MACRO_NIGHTLY_CALLS, frontOf, nearest, candidates, matchOdds, topHolderIds,
} from "../../shared/flows-macro.js";
import { unwrap } from "../../shared/flows-vendor-core.js";

const PATH = {
  "futures-contracts": (p) => pathFor("futures-contracts", p),
  "economy": (p) => pathFor("economy", p),
  "commodity": (p) => pathFor("commodity", p),
  "fx-history": (p) => pathFor("fx-history", p),
  "digital-history": (p) => pathFor("digital-history", p),
  "crypto-ohlc": (p) => pathFor("crypto-ohlc", p),
  "futures-stats": (p) => pathFor("futures-stats", p),
  "futures-candles": (p) => pathFor("futures-candles", p),
  "futures-flow": (p) => pathFor("futures-flow", p),
  "market-movers": (p) => pathFor("market-movers", p),
  "seasonality-year-month": (p) => pathFor("seasonality-year-month", p),
  "seasonality-monthly": (p) => pathFor("seasonality-monthly", p),
  "seasonality-performers": (p) => pathFor("seasonality-performers", p),
  "pred-unusual": (p) => pathFor("pred-unusual", p),
  "pred-smart-money": (p) => pathFor("pred-smart-money", p),
  "pred-whales": (p) => pathFor("pred-whales", p),
  "pred-insiders": (p) => pathFor("pred-insiders", p),
  "pred-market": (p) => pathFor("pred-market", p),
  "pred-liquidity": (p) => pathFor("pred-liquidity", p),
  "pred-positions": (p) => pathFor("pred-positions", p),
  "pred-user": (p) => pathFor("pred-user", p),
};

export const MACRO_BUILD_SWITCH = "FLOWS_MACRO_BUILD";

export const macroBuildOn = (env = process.env) => String(env[MACRO_BUILD_SWITCH] ?? "").trim().toLowerCase() !== "off";

export function failureOf(status) {
  if (status === 429) return "limited";
  if ([401, 402, 403, 404, 422].includes(status)) return "plan";
  return "failed";
}

export async function runMacro({ uw, session, generatedAt, calendar = [], deadline = null, pool = null, width = 2, cap = MACRO_NIGHTLY_CALLS, log = () => {} } = {}) {
  let calls = 0;
  const tally = {};
  const get = async (op, pathParams, params) => {
    if (calls >= cap) return { status: "failed", why: "cap" };
    if (pastDeadline(deadline)) return { status: "failed", why: "deadline" };
    calls++;
    const res = await read(uw, PATH[op](pathParams || {}), params || {}, { envelope: true });
    const slot = tally[op] || (tally[op] = { n: 0, bad: 0 });
    slot.n++;
    if (res.ok) return { status: "ok", body: res.body };
    slot.bad++;
    return { status: failureOf(res.status), why: String(res.status === null ? "network" : res.status) };
  };
  const each = async (jobs) => {
    const work = async (j) => { j.out(await get(j.op, j.path, j.params)); };
    if (pool) await pool(jobs, work, { width, stopEarly: () => pastDeadline(deadline) });
    else for (const j of jobs) await work(j);
  };

  const input = {
    session, generatedAt, treasury: {}, economy: {}, commodities: {}, fx: {}, digital: {}, cryptoOhlc: {},
    futuresContracts: null, futuresStats: {}, futuresCandles: {}, futuresFlow: [], movers: null,
    seasonYearMonth: {}, seasonMonthly: {}, performersThis: null, performersNext: null, predictions: {}, calendar,
  };
  const sm = Number(session.slice(5, 7));
  const nextM = sm === 12 ? 1 : sm + 1;

  await each([{ op: "futures-contracts", params: { days: 3 }, out: (r) => { input.futuresContracts = r; } }]);
  const rows = input.futuresContracts && input.futuresContracts.status === "ok" ? unwrap(input.futuresContracts.body) : [];
  const list = Array.isArray(rows) ? rows : [];

  const jobs = [];
  for (const m of MATURITIES) jobs.push({ op: "economy", path: { indicator: "treasury-yield" }, params: { interval: "daily", maturity: m }, out: (r) => { input.treasury[m] = r; } });
  jobs.push({ op: "economy", path: { indicator: "fed-funds" }, params: { interval: "daily" }, out: (r) => { input.treasury["fed-funds"] = r; } });
  for (const ind of INDICATORS) jobs.push({ op: "economy", path: { indicator: ind }, params: { interval: QUARTERLY.includes(ind) ? "quarterly" : "monthly" }, out: (r) => { input.economy[ind] = r; } });
  for (const name of [...DAILY_COMMODITIES, ...MONTHLY_COMMODITIES]) jobs.push({ op: "commodity", path: { name }, params: { interval: DAILY_COMMODITIES.includes(name) ? "daily" : "monthly" }, out: (r) => { input.commodities[name] = r; } });
  for (const pair of FX_PAIRS) jobs.push({ op: "fx-history", params: { from: pair.slice(0, 3), to: pair.slice(3), interval: "daily" }, out: (r) => { input.fx[pair] = r; } });
  for (const sym of CRYPTO) {
    jobs.push({ op: "digital-history", params: { symbol: sym, market: "USD", interval: "daily" }, out: (r) => { input.digital[sym] = r; } });
    jobs.push({ op: "crypto-ohlc", path: { pair: sym + "-USD", candle_size: "1d" }, params: { limit: 90 }, out: (r) => { input.cryptoOhlc[sym] = r; } });
  }
  for (const p of CURVE_PRODUCTS) {
    for (const c of nearest(list, p, session)) jobs.push({ op: "futures-stats", path: { contract: c.sym }, out: (r) => { input.futuresStats[c.sym] = r; } });
  }
  for (const p of Object.keys(PRODUCTS)) {
    const front = frontOf(list, p, session);
    if (front) jobs.push({ op: "futures-candles", path: { contract: front.sym }, params: { interval: "1d", range: "3m" }, out: (r) => { input.futuresCandles[p] = { sym: front.sym, res: r }; } });
  }
  for (const g of FLOW_GROUPS) {
    jobs.push({ op: "futures-flow", params: { limit: 500, include_spreads: "false", products: g.join(","), min_size: Math.min(...g.map((p) => LARGE[p])) }, out: (r) => { input.futuresFlow.push(r); } });
  }
  jobs.push({ op: "market-movers", out: (r) => { input.movers = r; } });
  for (const t of SEASON_FUNDS) jobs.push({ op: "seasonality-year-month", path: { ticker: t }, out: (r) => { input.seasonYearMonth[t] = r; } });
  for (const t of SEASON_CHECK) jobs.push({ op: "seasonality-monthly", path: { ticker: t }, out: (r) => { input.seasonMonthly[t] = r; } });
  const perf = { min_years: 10, s_p_500_nasdaq_only: "true", limit: 50 };
  jobs.push({ op: "seasonality-performers", path: { month: sm }, params: perf, out: (r) => { input.performersThis = r; } });
  jobs.push({ op: "seasonality-performers", path: { month: nextM }, params: perf, out: (r) => { input.performersNext = r; } });
  const preds = input.predictions;
  jobs.push({ op: "pred-unusual", params: { categories: "Finance", limit: 100 }, out: (r) => { preds.unusual = r; } });
  jobs.push({ op: "pred-smart-money", params: { categories: "Finance" }, out: (r) => { preds.smart = r; } });
  jobs.push({ op: "pred-whales", out: (r) => { preds.whales = r; } });
  jobs.push({ op: "pred-insiders", out: (r) => { preds.insiders = r; } });
  await each(jobs);

  const body = (r) => (r && r.status === "ok" ? r.body : null);
  const cands = candidates({ unusual: body(preds.unusual), smart: body(preds.smart), whales: body(preds.whales), insiders: body(preds.insiders) });
  const matched = matchOdds(calendar, cands);
  preds.details = {};
  const ids = matched.events.flatMap((e) => e.markets.map((m) => m.id));
  for (const id of ids) {
    const d = (preds.details[id] = { holders: [] });
    await each([
      { op: "pred-market", path: { asset_id: id }, out: (r) => { d.market = r; } },
      { op: "pred-liquidity", path: { asset_id: id }, out: (r) => { d.liquidity = r; } },
      { op: "pred-positions", path: { asset_id: id }, out: (r) => { d.positions = r; } },
    ]);
    const holders = topHolderIds(body(d.positions));
    await each(holders.map((h) => ({ op: "pred-user", path: { user_id: h }, out: (r) => { d.holders.push(r); } })));
  }
  log(`  macro: ${calls} call(s) of ${cap}`);
  return { input, calls, tally };
}
