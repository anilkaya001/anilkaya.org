import { pastDeadline } from "./common.mjs";
import { carryRefusals, makeAsker } from "./positioning.mjs";
import { addDays, daysBetween } from "../../shared/flows-pos-13f.js";
import { filingRow } from "../../shared/flows-political.js";

export const LATE_PAGES = 3;

export const LATE_PAGE_LIMIT = 200;

export const TRADER_MAX = 6;

export const HELD_REFRESH_DAYS = 30;

export const MONEY_REFRESH_DAYS = 7;

export const MONEY_PAGES = 3;

export const CONTRIB_MAX = 12;

export const TICKERS_MAX = 60;

export const cycleOf = (sessionDate) => {
  const y = Number(String(sessionDate).slice(0, 4));
  return Number.isInteger(y) ? y + (y % 2) : null;
};

const fresh = (stamp, sessionDate, days) => {
  const age = typeof stamp === "string" ? daysBetween(stamp, sessionDate) : null;
  return age !== null && age >= 0 && age < days;
};

export function lateFilers(rows, n = TRADER_MAX) {
  const by = new Map();
  for (const raw of rows) {
    const r = filingRow(raw);
    if (!r || !r.who || !r.txnDate || !r.filedDate) continue;
    const lag = daysBetween(r.txnDate, r.filedDate);
    if (lag === null || lag <= 45) continue;
    const key = r.id || r.who;
    const e = by.get(key) || { id: r.id, name: r.who, n: 0 };
    e.n++;
    by.set(key, e);
  }
  return [...by.values()].sort((a, b) => (b.n - a.n) || (a.name < b.name ? -1 : 1)).slice(0, n);
}

export async function readPoliticalLayers({
  uw, sessionDate, tickers = [], prior = null, deadline = null, pool = null, width = 1, log = () => {},
} = {}) {
  const wasRefused = carryRefusals({ basis: { refused: prior && prior.plan } }, sessionDate);
  const refused = { ...wasRefused };
  const failed = {};
  const { ask, state } = makeAsker({ uw, sessionDate, deadline, refused, failed, wasRefused });
  const from90 = addDays(sessionDate, -90);
  const from365 = addDays(sessionDate, -365);
  const names = [...new Set(tickers)].sort().slice(0, TICKERS_MAX);
  const mark = (res) => (res.ok ? res.rows : { __failed: res.kind });
  const body = (res) => (res.ok ? res.body : { __failed: res.kind });
  const layers = { plan: {} };

  const [unusual, unusualTickers, stats, chart, politicians, disclosures, people, recent, trades, candidates] = await Promise.all([
    ask("cg-unusual", { limit: 200 }),
    names.length ? ask("cg-unusual-tickers", { tickers: names.join(","), date_from: from90, limit: 200 }) : Promise.resolve({ ok: false, kind: "failed", skipped: true }),
    ask("cg-unusual-stats"),
    ask("cg-unusual-chart", { date_from: from90 }),
    ask("cg-politicians", { last_traded_within_months: 6 }),
    ask("pp-disclosures", { latest_only: true }),
    ask("pp-people"),
    ask("pp-recent", { filter_late_reports: true, limit: LATE_PAGE_LIMIT }),
    ask("pol-trades", { filter_late_reports: true, limit: LATE_PAGE_LIMIT }),
    ask("fec-candidates", { limit: 100 }),
  ]);
  layers.unusual = mark(unusual);
  layers.unusualTickers = names.length ? mark(unusualTickers) : undefined;
  layers.stats = body(stats);
  layers.chart = body(chart);
  layers.disclosures = mark(disclosures);
  layers.people = mark(people);
  layers.ppRecent = mark(recent);
  layers.polTrades = mark(trades);
  layers.fecCandidates = body(candidates);
  layers.politicians = mark(politicians);

  const lateRows = [];
  let cursor = sessionDate;
  let lateFailed = null;
  for (let rung = 0; rung < LATE_PAGES; rung++) {
    const res = await ask("cg-late", { limit: LATE_PAGE_LIMIT, date: cursor });
    if (!res.ok) { lateFailed = lateFailed || res.kind; break; }
    if (!res.rows.length) break;
    lateRows.push(...res.rows);
    let oldest = null;
    for (const r of res.rows) {
      const d = r && typeof r.transaction_date === "string" ? r.transaction_date.slice(0, 10) : null;
      if (d && (oldest === null || d < oldest)) oldest = d;
    }
    if (res.rows.length < LATE_PAGE_LIMIT || !oldest || oldest >= cursor || oldest < from365) break;
    cursor = oldest;
  }
  layers.cgLate = lateRows.length || !lateFailed ? lateRows : { __failed: lateFailed };

  const traders = lateFilers(lateRows);
  layers.trader = [];
  const run = async (items, work) => {
    if (pool) await pool(items, work, { width, stopEarly: () => pastDeadline(deadline) });
    else for (const item of items) await work(item);
  };
  await run(traders, async (t) => {
    const res = await ask("cg-trader", { name: t.name, limit: 100, date_from: from365 });
    layers.trader.push({ id: t.id, name: t.name, rows: res.ok ? res.rows : { __failed: res.kind } });
  });

  const priorHeld = prior && prior.held && prior.held.status === "ok" && fresh(prior.held.asOf, sessionDate, HELD_REFRESH_DAYS) ? prior.held : null;
  if (priorHeld) layers.heldCarry = priorHeld;
  else {
    layers.portfolios = [];
    await run(traders.filter((t) => t.id), async (t) => {
      const res = await ask("pp-portfolio", {}, { politician_id: t.id });
      layers.portfolios.push(body(res));
    });
  }

  const priorMoney = prior && prior.money && prior.money.status === "ok" && fresh(prior.money.asOf, sessionDate, MONEY_REFRESH_DAYS) ? prior.money : null;
  layers.cycle = cycleOf(sessionDate);
  if (priorMoney) layers.moneyCarry = priorMoney;
  else {
    const companies = [];
    let moneyFailed = null;
    for (let page = 1; page <= MONEY_PAGES; page++) {
      const res = await ask("fec-companies", { cycle: layers.cycle, limit: 200, page });
      if (!res.ok) { moneyFailed = moneyFailed || res.kind; break; }
      companies.push(...res.rows);
      if (res.rows.length < 200) break;
    }
    layers.fecCompanies = companies.length || !moneyFailed ? companies : { __failed: moneyFailed };
    layers.fecContrib = {};
    const have = new Set(companies.map((c) => c && c.ticker));
    await run(names.filter((t) => have.has(t)).slice(0, CONTRIB_MAX), async (t) => {
      const res = await ask("fec-contributions", { aggregated: true, ticker: t });
      layers.fecContrib[t] = body(res);
    });
  }
  layers.plan = { ...refused };
  layers.refusedCount = Object.keys(refused).length;
  log(`  political layers: ${state.calls} call(s)` + (layers.refusedCount ? `, refused ${Object.keys(refused).join(" ")}` : "") +
    (Object.keys(failed).length ? `, failed ${Object.keys(failed).join(" ")}` : ""));
  return { layers, calls: state.calls, refused, failed };
}
