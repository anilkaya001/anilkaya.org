import { vnum, isoDay } from "./flows-cross.js";
import { cleanLabel, tms, isoOf, VENDOR_ROUTES, EXTRACT_VERSIONS } from "./flows-dossier.js";
import { unwrap, VENDOR_ENVELOPE } from "./flows-vendor-core.js";

export { unwrap };

export const RESPONSE_ENVELOPE = VENDOR_ENVELOPE;

export const ANALYST_ACTIONS = Object.freeze(["initiated", "reiterated", "downgraded", "upgraded", "maintained", "target raised", "target lowered"]);

export const ANALYST_RECS = Object.freeze(["buy", "hold", "sell"]);

export const SENTIMENTS = Object.freeze(["positive", "negative", "neutral"]);

export const VENDOR_OPS = VENDOR_ROUTES;

export const DOSSIER_READS = Object.freeze({
  [VENDOR_OPS.info]: ["full_name", "sector", "issue_type", "marketcap", "avg30_volume", "beta", "has_options", "has_dividend",
    "has_earnings_history", "next_earnings_date", "announce_time", "short_description"],
  [VENDOR_OPS.profile]: ["name", "sector", "industry", "exchange", "country", "currency", "description", "market_cap", "pe_ratio",
    "peg_ratio", "beta", "week_52_high", "week_52_low", "analyst_target_price", "shares_outstanding"],
  [VENDOR_OPS.financials]: ["income_statements", "balance_sheets", "cash_flows", "earnings", "fiscal_date_ending", "report_type",
    "total_revenue", "gross_profit", "operating_income", "net_income", "ebitda", "cash_and_short_term_investments",
    "short_long_term_debt_total", "total_shareholder_equity", "total_assets", "total_liabilities", "total_current_assets",
    "total_current_liabilities", "common_stock_shares_outstanding", "operating_cashflow", "capital_expenditures", "report_date",
    "reported_eps", "estimated_eps", "reported_currency"],
  [VENDOR_OPS.breakdown]: ["rev_breakdown", "report_date", "rev_group", "members", "value", "field"],
  [VENDOR_OPS.estimates]: ["estimates", "date", "horizon", "eps_estimate_average", "eps_estimate_high", "eps_estimate_low",
    "eps_estimate_analyst_count", "revenue_estimate_average", "revenue_estimate_analyst_count"],
  [VENDOR_OPS.analysts]: ["ticker", "timestamp", "firm", "action", "recommendation", "target"],
  [VENDOR_OPS.earnings]: ["report_date", "report_time", "source", "expected_move_perc", "post_earnings_move_1d", "post_earnings_move_1w",
    "pre_earnings_move_1w", "long_straddle_1d", "long_straddle_1w"],
  [VENDOR_OPS.ownership]: ["name", "short_name", "units", "units_changed", "units_change", "historical_units", "report_date", "shares_outstanding"],
  [VENDOR_OPS.short]: ["market_date", "short_interest", "total_float", "days_to_cover"],
  [VENDOR_OPS.insiders]: ["date", "buy_sell", "transactions", "uniq_insiders", "volume", "premium"],
  [VENDOR_OPS.news]: ["created_at", "headline", "source", "sentiment", "is_major", "tickers"],
  [VENDOR_OPS.levels]: ["date", "price", "dark_pool_volume", "regular_volume"],
});

export const WIRE_RENAMES = Object.freeze({
  [VENDOR_OPS.ownership]: Object.freeze({ units_change: "units_changed" }),
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, cap = 400) => (typeof v === "string" && v.trim() ? v.trim().slice(0, cap) : null);
const bool = (v) => (typeof v === "boolean" ? v : null);
const pick = (v, list) => (typeof v === "string" && list.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);
const fail = (reason) => ({ ok: false, reason });

function rowsOf(raw) {
  const d = unwrap(raw);
  if (Array.isArray(d)) return d.filter(isObj);
  return isObj(d) ? [d] : null;
}

const byDayDesc = (field) => (a, b) => (a[field] < b[field] ? 1 : a[field] > b[field] ? -1 : 0);

export function reduceInfo(raw) {
  const d = unwrap(raw);
  if (!isObj(d)) return fail("unshaped");
  const out = {
    ok: true,
    name: str(d.full_name, 120),
    sector: str(d.sector, 40),
    issueType: str(d.issue_type, 24),
    mcap: vnum(d.marketcap),
    adv30: vnum(d.avg30_volume),
    beta: vnum(d.beta),
    hasOptions: bool(d.has_options),
    hasDividend: bool(d.has_dividend),
    hasHistory: bool(d.has_earnings_history),
    next: isoDay(typeof d.next_earnings_date === "string" ? d.next_earnings_date : ""),
    announce: pick(d.announce_time, ["unknown", "afterhours", "premarket"]),
    desc: str(d.short_description, 700),
  };
  if (out.name === null && out.sector === null && out.mcap === null && out.desc === null) return fail("empty");
  return out;
}

export function reduceProfile(raw) {
  const d = unwrap(raw);
  if (!isObj(d)) return fail("unshaped");
  const out = {
    ok: true,
    name: str(d.name, 120),
    sector: str(d.sector, 40),
    industry: str(d.industry, 80),
    exchange: str(d.exchange, 24),
    country: str(d.country, 40),
    currency: str(d.currency, 8),
    desc: str(d.description, 900),
    mcap: vnum(d.market_cap),
    shares: vnum(d.shares_outstanding),
    pe: vnum(d.pe_ratio),
    peg: vnum(d.peg_ratio),
    beta: vnum(d.beta),
    hi52: vnum(d.week_52_high),
    lo52: vnum(d.week_52_low),
    target: vnum(d.analyst_target_price),
  };
  const any = Object.entries(out).some(([k, v]) => k !== "ok" && v !== null);
  return any ? out : fail("empty");
}

const QUARTERS = 8;
const ANNUALS = 2;

function statementRows(list, fields, kind, n) {
  const rows = arr(list).filter(isObj)
    .filter((r) => typeof r.fiscal_date_ending === "string" && isoDay(r.fiscal_date_ending) && (r.report_type === kind))
    .map((r) => {
      const o = { d: isoDay(r.fiscal_date_ending) };
      for (const [short, field] of fields) o[short] = vnum(r[field]);
      return o;
    })
    .sort(byDayDesc("d"));
  return rows.slice(0, n);
}

export function reduceFinancials(raw) {
  const d = unwrap(raw);
  if (!isObj(d)) return fail("unshaped");
  const inc = [["rev", "total_revenue"], ["gp", "gross_profit"], ["oi", "operating_income"], ["ni", "net_income"], ["ebitda", "ebitda"]];
  const bal = [["cash", "cash_and_short_term_investments"], ["debt", "short_long_term_debt_total"], ["eq", "total_shareholder_equity"],
    ["ta", "total_assets"], ["tl", "total_liabilities"], ["ca", "total_current_assets"], ["cl", "total_current_liabilities"],
    ["sh", "common_stock_shares_outstanding"]];
  const cf = [["ocf", "operating_cashflow"], ["capex", "capital_expenditures"]];
  const q = {
    inc: statementRows(d.income_statements, inc, "quarterly", QUARTERS),
    bal: statementRows(d.balance_sheets, bal, "quarterly", 4),
    cf: statementRows(d.cash_flows, cf, "quarterly", QUARTERS),
  };
  const a = {
    inc: statementRows(d.income_statements, inc, "annual", ANNUALS),
    bal: statementRows(d.balance_sheets, bal, "annual", 1),
    cf: statementRows(d.cash_flows, cf, "annual", ANNUALS),
  };
  const eps = arr(d.earnings).filter(isObj)
    .filter((r) => r.report_type === "quarterly" && isoDay(typeof r.fiscal_date_ending === "string" ? r.fiscal_date_ending : ""))
    .map((r) => ({
      d: isoDay(r.fiscal_date_ending),
      rd: isoDay(typeof r.report_date === "string" ? r.report_date : ""),
      rep: vnum(r.reported_eps),
      est: vnum(r.estimated_eps),
    }))
    .sort(byDayDesc("d"))
    .slice(0, QUARTERS);
  const currency = arr(d.income_statements).filter(isObj).map((r) => str(r.reported_currency, 8)).find(Boolean) || null;
  const newest = [q.inc[0], q.bal[0], q.cf[0], a.inc[0]].filter(Boolean).map((r) => r.d).sort().pop() || null;
  if (!q.inc.length && !a.inc.length && !q.bal.length && !a.bal.length && !q.cf.length && !eps.length) return fail("empty");
  return { ok: true, currency, newest, q, a, eps };
}

export function reduceBreakdown(raw) {
  const d = unwrap(raw);
  if (!isObj(d)) return fail("unshaped");
  const rows = arr(d.rev_breakdown).filter(isObj)
    .map((r) => ({
      date: isoDay(typeof r.report_date === "string" ? r.report_date : ""),
      group: pick(r.rev_group, ["revenue", "rewards", "locations", "memberships", "product"]),
      field: str(r.field, 120),
      member: arr(r.members).map((m) => cleanLabel(m, 40)).filter(Boolean).join(" / ") || null,
      value: vnum(r.value),
    }))
    .filter((r) => r.date && r.group && r.member && r.value !== null && r.value > 0);
  if (!rows.length) return fail(arr(d.rev_breakdown).length ? "unshaped" : "empty");
  const latest = rows.map((r) => r.date).sort().pop();
  const at = rows.filter((r) => r.date === latest);
  const groups = [];
  for (const g of [...new Set(at.map((r) => r.group))]) {
    const inGroup = at.filter((r) => r.group === g);
    const totals = new Map();
    for (const r of inGroup) totals.set(r.field, (totals.get(r.field) || 0) + r.value);
    const field = [...totals.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const kept = inGroup.filter((r) => r.field === field);
    const seen = new Map();
    for (const r of kept) seen.set(r.member, (seen.get(r.member) || 0) + r.value);
    const members = [...seen.entries()].map(([m, v]) => ({ m, v })).sort((x, y) => y.v - x.v);
    groups.push({ g, total: members.reduce((s, x) => s + x.v, 0), n: members.length, rows: members.slice(0, 6) });
  }
  groups.sort((x, y) => y.total - x.total);
  return { ok: true, date: latest, groups: groups.slice(0, 2) };
}

export function reduceEstimates(raw) {
  const d = unwrap(raw);
  if (!isObj(d)) return fail("unshaped");
  const rows = arr(d.estimates).filter(isObj)
    .map((r) => ({
      d: isoDay(typeof r.date === "string" ? r.date : ""),
      h: cleanLabel(r.horizon, 12),
      eps: vnum(r.eps_estimate_average),
      hi: vnum(r.eps_estimate_high),
      lo: vnum(r.eps_estimate_low),
      n: vnum(r.eps_estimate_analyst_count),
      rev: vnum(r.revenue_estimate_average),
      revN: vnum(r.revenue_estimate_analyst_count),
    }))
    .filter((r) => r.eps !== null || r.rev !== null);
  if (!rows.length) return fail(arr(d.estimates).length ? "unshaped" : "empty");
  rows.sort((a, b) => ((a.d || "9999") < (b.d || "9999") ? -1 : (a.d || "9999") > (b.d || "9999") ? 1 : 0));
  return { ok: true, rows: rows.slice(0, 6) };
}

export function reduceAnalysts(raw, ticker) {
  const list = rowsOf(raw);
  if (list === null) return fail("unshaped");
  if (!list.length) return fail("empty");
  const want = String(ticker || "").toUpperCase();
  const rows = list
    .filter((r) => typeof r.ticker === "string" && r.ticker.trim().toUpperCase() === want)
    .map((r) => ({
      ts: isoOf(tms(r.timestamp)),
      firm: cleanLabel(r.firm, 32),
      action: pick(r.action, ANALYST_ACTIONS),
      rec: pick(r.recommendation, ANALYST_RECS),
      target: (() => { const t = vnum(r.target); return t !== null && t > 0 ? t : null; })(),
    }))
    .filter((r) => r.ts && (r.rec || r.action || r.target !== null))
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, 30);
  if (!rows.length) return fail("empty");
  return { ok: true, newest: rows[0].ts, rows };
}

function unitsChange(r, u) {
  const hist = arr(r.historical_units);
  const prior = hist.length >= 2 && u !== null && vnum(hist[0]) === u ? vnum(hist[1]) : null;
  const derived = prior !== null ? u - prior : null;
  return vnum(r.units_changed) ?? vnum(r.units_change) ?? derived;
}

export function reduceOwnership(raw) {
  const list = rowsOf(raw);
  if (list === null) return fail("unshaped");
  if (!list.length) return fail("empty");
  const rows = list.map((r) => ({
    n: [r.short_name, r.name].map((x) => cleanLabel(x, 28)).find(Boolean) || null,
    u: vnum(r.units),
    dU: unitsChange(r, vnum(r.units)),
    rd: isoDay(typeof r.report_date === "string" ? r.report_date : ""),
    so: vnum(r.shares_outstanding),
  })).filter((r) => r.u !== null);
  if (!rows.length) return fail("unshaped");
  rows.sort((a, b) => b.u - a.u);
  const so = rows.map((r) => r.so).find((v) => v !== null && v > 0) ?? null;
  const dates = rows.map((r) => r.rd).filter(Boolean).sort();
  return {
    ok: true,
    rv: EXTRACT_VERSIONS.ownership,
    n: rows.length,
    so,
    reportDate: dates.length ? dates[dates.length - 1] : null,
    units: rows.reduce((s, r) => s + r.u, 0),
    change: rows.reduce((s, r) => s + (r.dU === null ? 0 : r.dU), 0),
    changeKnown: rows.filter((r) => r.dU !== null).length,
    up: rows.filter((r) => r.dU !== null && r.dU > 0).length,
    down: rows.filter((r) => r.dU !== null && r.dU < 0).length,
    top: rows.slice(0, 8).map((r) => ({ n: r.n, u: r.u, dU: r.dU })),
  };
}

export function reduceShort(raw) {
  const list = rowsOf(raw);
  if (list === null) return fail("unshaped");
  if (!list.length) return fail("empty");
  const rows = list.map((r) => ({
    d: isoDay(typeof r.market_date === "string" ? r.market_date : ""),
    si: vnum(r.short_interest),
    fl: vnum(r.total_float),
    dtc: vnum(r.days_to_cover),
  })).filter((r) => r.d).sort(byDayDesc("d"));
  if (!rows.length) return fail("unshaped");
  const top = rows[0];
  return { ok: true, date: top.d, shares: top.si, float: top.fl, dtc: top.dtc, prior: rows[1] ? { date: rows[1].d, shares: rows[1].si } : null };
}

export function reduceInsiderFlow(raw) {
  const list = rowsOf(raw);
  if (list === null) return fail("unshaped");
  if (!list.length) return fail("empty");
  const rows = list.map((r) => ({
    d: isoDay(typeof r.date === "string" ? r.date : ""),
    side: pick(r.buy_sell, ["buy", "sell"]),
    tx: vnum(r.transactions),
    ins: vnum(r.uniq_insiders),
    vol: vnum(r.volume),
    prem: vnum(r.premium),
  })).filter((r) => r.d && r.side).sort(byDayDesc("d")).slice(0, 60);
  if (!rows.length) return fail("unshaped");
  return { ok: true, newest: rows[0].d, rows };
}

export function reduceNews(raw, ticker) {
  const list = rowsOf(raw);
  if (list === null) return fail("unshaped");
  if (!list.length) return fail("empty");
  const want = String(ticker || "").toUpperCase();
  const rows = list
    .filter((r) => Array.isArray(r.tickers) && r.tickers.some((t) => typeof t === "string" && t.trim().toUpperCase() === want))
    .map((r) => ({
      at: isoOf(tms(r.created_at)),
      h: str(r.headline, 260),
      src: cleanLabel(r.source, 28),
      sent: pick(r.sentiment, SENTIMENTS),
      major: bool(r.is_major),
    }))
    .filter((r) => r.at && r.h)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 12);
  if (!rows.length) return fail("empty");
  return { ok: true, newest: rows[0].at, rows };
}

export function reducePriceLevels(raw) {
  const body = isObj(raw) ? raw : null;
  if (body === null) return fail("unshaped");
  const list = arr(body.data).filter(isObj);
  if (!list.length) return fail(Array.isArray(body.data) ? "empty" : "unshaped");
  const levels = list.map((r) => ({ px: vnum(r.price), dark: vnum(r.dark_pool_volume), reg: vnum(r.regular_volume) }))
    .filter((r) => r.px !== null && r.px > 0 && (r.dark !== null || r.reg !== null));
  if (!levels.length) return fail("unshaped");
  const dark = levels.reduce((s, r) => s + (r.dark || 0), 0);
  const reg = levels.reduce((s, r) => s + (r.reg || 0), 0);
  const top = levels.filter((r) => r.dark !== null && r.dark > 0).sort((a, b) => b.dark - a.dark).slice(0, 5)
    .map((r) => ({ px: r.px, dark: r.dark, reg: r.reg }));
  return { ok: true, date: isoDay(typeof body.date === "string" ? body.date : ""), dark, regular: reg, levels: levels.length, top };
}

export function quoteExtract(body) {
  if (!isObj(body)) return { ok: false, reason: "failed", transient: true };
  const price = vnum(body.price);
  if (body.status === "ok" && price !== null && price > 0) {
    return {
      ok: true,
      price,
      prev: vnum(body.prevClose),
      change: vnum(body.changePct),
      open: vnum(body.open),
      high: vnum(body.high),
      low: vnum(body.low),
      volume: vnum(body.volume),
      tapeTime: isoOf(tms(body.tapeTime)),
    };
  }
  if (body.why === "throttled") return { ok: false, reason: "limited", transient: true };
  if (body.status === "quiet") return { ok: false, reason: "empty", transient: true };
  return { ok: false, reason: "failed", transient: true };
}

export const REDUCERS = Object.freeze({
  info: reduceInfo, profile: reduceProfile, financials: reduceFinancials, breakdown: reduceBreakdown, estimates: reduceEstimates,
  analysts: reduceAnalysts, ownership: reduceOwnership, short: reduceShort, insiders: reduceInsiderFlow, news: reduceNews,
  levels: reducePriceLevels,
});
