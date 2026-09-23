import { read, rowsOf, silenceOf, freshStamp, pastDeadline } from "./common.mjs";
import {
  REGIME_SCHEMA_VERSION, REGIME_BUDGET_BYTES, SECTOR_TIDES, ETF_TIDES, FUND_FLOW_ETFS,
  CORRELATION_ETFS, FLOW_GROUPS, GROUP_MEMBERS, buildZeroDte, tideSummary, greekFlowTotals,
  groupMembers, groupAlignment, fundFlowSummary, volCurveFromScreener, shapeDailyReport,
  shapeOptionsPulse, holdingsMembers,
} from "../../shared/flows-regime.js";
import { impliedCorrelation, netTilt, vnum, firstPositive, addDays, compactNumbers, SILENCE } from "../../shared/flows-cross.js";

export const NET_FLOW_READS = Object.freeze([
  ["zero", { expiration: "zero_dte", tide_type: "all", moneyness: "all" }],
  ["weekly", { expiration: "weekly", tide_type: "all", moneyness: "all" }],
  ["zeroEquity", { expiration: "zero_dte", tide_type: "equity_only", moneyness: "all" }],
  ["zeroIndex", { expiration: "zero_dte", tide_type: "index_only", moneyness: "all" }],
]);

export const VIX_PATH = "/api/volatility/vix-term-structure";

export const REGIME_CALLS = 1 + NET_FLOW_READS.length + 1 + SECTOR_TIDES.length + ETF_TIDES.length +
  FUND_FLOW_ETFS.length + CORRELATION_ETFS.length + FLOW_GROUPS.length + 1;

export async function readRegime(uw, { sessionDate = null, deadline = null } = {}) {
  const dated = sessionDate ? { date: sessionDate } : {};
  const raw = { calls: 0 };
  const get = async (path, params, opts) => {
    if (pastDeadline(deadline)) return { ok: false, body: null, status: null, error: "past the run deadline", skipped: true };
    raw.calls++;
    return read(uw, path, params, opts);
  };

  raw.vix = await get(VIX_PATH, { history_days: 90 }, { envelope: true });
  raw.netFlow = {};
  for (const [k, params] of NET_FLOW_READS) {
    raw.netFlow[k] = await get("/api/net-flow/expiry", { ...dated, ...params }, { envelope: true });
  }
  raw.daily = await get("/api/market/daily-report", { ...dated, limit: 25 }, { envelope: true });
  raw.sectors = {};
  for (const s of SECTOR_TIDES) {
    raw.sectors[s] = await get(`/api/market/${encodeURIComponent(s)}/sector-tide`, dated, { envelope: true });
  }
  raw.etfTide = {};
  for (const t of ETF_TIDES) raw.etfTide[t] = await get(`/api/market/${t}/etf-tide`, dated, { envelope: true });
  raw.flows = {};
  for (const t of FUND_FLOW_ETFS) {
    raw.flows[t] = await get(`/api/etfs/${t}/in-outflow`, {
      ...(sessionDate ? { start_date: addDays(sessionDate, -400), end_date: sessionDate } : {}),
    }, { envelope: true });
  }
  raw.holdings = {};
  for (const t of CORRELATION_ETFS) raw.holdings[t] = await get(`/api/etfs/${t}/holdings`, {}, { envelope: true });
  raw.groups = {};
  for (const g of FLOW_GROUPS) {
    raw.groups[g] = await get(`/api/group-flow/${encodeURIComponent(g)}/greek-flow`, dated, { envelope: true });
  }
  raw.pulse = await get("/api/options-pulse/total", dated, { envelope: true });
  return raw;
}

const statusOf = (res, what) => silenceOf(res, { what }) || null;

export function assembleRegime(raw, {
  sessionDate = null, generatedAt = null, readAt = null, indexRows = new Map(), harvestRows = [],
  universeRows = [], budgetBytes = REGIME_BUDGET_BYTES,
} = {}) {
  const r = raw || {};
  const out = {
    v: REGIME_SCHEMA_VERSION,
    generatedAt, sessionDate,
    fresh: freshStamp({ readAt, session: sessionDate }),
    status: "ok",
    calls: r.calls ?? null,
  };

  const vix = r.vix || { ok: false, error: "not read" };
  const vendorCurve = vix.ok
    ? { status: "unshaped", reason: "the vendor answered but its Volatility Result shape is undocumented and unprobed",
        keys: vix.body && typeof vix.body === "object" ? Object.keys(vix.body).slice(0, 12) : [] }
    : { status: "unavailable", reason: vix.gated ? SILENCE.gated : SILENCE.unreadable, http: vix.status ?? null,
        code: vix.gated && vix.status === 403 ? "volatility_scope_required" : null };
  const curves = {};
  for (const t of ETF_TIDES) curves[t] = volCurveFromScreener(indexRows.get(t));
  out.volCurve = {
    status: Object.values(curves).some((c) => c.status === "ok") ? "ok" : "unavailable",
    source: "screener fixed-tenor IV of the index ETFs (fallback for the VIX futures curve)",
    vendor: vendorCurve,
    byIndex: curves,
    rule: "ts = iv30/iv90 - 1 (negative is contango), fs = iv7/iv30 - 1, steep = volatility_180/volatility_30",
  };

  const nf = r.netFlow || {};
  const body = (k) => (nf[k] && nf[k].ok ? nf[k].body : null);
  out.zeroDte = nf.zero && !nf.zero.ok
    ? statusOf(nf.zero, "net-flow zero_dte")
    : buildZeroDte({
      zero: body("zero"), weekly: body("weekly"),
      zeroEquity: body("zeroEquity"), zeroIndex: body("zeroIndex"), sessionDate,
    });
  if (out.zeroDte && out.zeroDte.status === "ok") {
    out.zeroDte.rule = "np = net_call_premium - net_put_premium at the last minute (the series is cumulative); share = |np0| / (|np0| + |npw|)";
  }

  const sectors = [];
  for (const s of SECTOR_TIDES) {
    const res = r.sectors && r.sectors[s];
    if (!res || !res.ok) { sectors.push({ sector: s, ...(statusOf(res || { ok: false, error: "not read" }, "sector-tide") || {}) }); continue; }
    const summary = tideSummary(rowsOf(res.body), { sessionDate });
    sectors.push({ sector: s, envelopeDate: res.body && res.body.date || null, ...summary });
  }
  out.sectors = {
    status: sectors.some((s) => s.status === "ok") ? "ok" : "unavailable",
    rows: sectors,
    rule: "the tide is cumulative through the session, so the last row is the session value; net = ncp - npp, dir its sign",
  };

  const etfTide = {};
  for (const t of ETF_TIDES) {
    const res = r.etfTide && r.etfTide[t];
    const own = indexRows.get(t);
    const ownNet = own && vnum(own.net_call_premium) !== null && vnum(own.net_put_premium) !== null
      ? vnum(own.net_call_premium) - vnum(own.net_put_premium) : null;
    const ownTilt = own ? netTilt(own) : null;
    if (!res || !res.ok) { etfTide[t] = { ...(statusOf(res || { ok: false, error: "not read" }, "etf-tide") || {}), ownNet, ownTilt }; continue; }
    const summary = tideSummary(rowsOf(res.body), { sessionDate });
    etfTide[t] = {
      ...summary,
      ownNet,
      ownTilt,
      agree: summary.net === null || summary.net === undefined || ownNet === null || summary.net === 0 || ownNet === 0
        ? null : Math.sign(summary.net) === Math.sign(ownNet),
    };
  }
  out.etfTide = {
    status: Object.values(etfTide).some((e) => e.status === "ok") ? "ok" : "unavailable",
    byEtf: etfTide,
    rule: "net = constituents' tide ncp - npp at the last minute; ownNet = the ETF's own screener net call - net put premium; agree = same sign",
  };

  const flows = {};
  for (const t of FUND_FLOW_ETFS) {
    const res = r.flows && r.flows[t];
    flows[t] = !res || !res.ok ? statusOf(res || { ok: false, error: "not read" }, "in-outflow")
      : fundFlowSummary(rowsOf(res.body), { sessionDate });
  }
  out.fundFlows = {
    status: Object.values(flows).some((f) => f && f.status === "ok") ? "ok" : "unavailable",
    byEtf: flows,
    units: { changeShares: "shares", changeUsd: "usd", cum20Usd: "usd", z20: "z" },
  };

  const volByTicker = new Map();
  for (const row of harvestRows || []) {
    const v = row ? firstPositive(row.volatility_30, row.iv30d) : null;
    if (row && row.ticker && v !== null) volByTicker.set(row.ticker, v);
  }
  const corr = {};
  for (const t of CORRELATION_ETFS) {
    const res = r.holdings && r.holdings[t];
    const idx = indexRows.get(t);
    const sI = idx ? firstPositive(idx.volatility_30, idx.iv30d) : null;
    if (!res || !res.ok) { corr[t] = statusOf(res || { ok: false, error: "not read" }, "holdings"); continue; }
    const { members, asOf } = holdingsMembers(rowsOf(res.body));
    const withVol = members.map((m) => ({ w: m.w, vol: volByTicker.get(m.t) ?? null }));
    const ic = impliedCorrelation(sI, withVol);
    corr[t] = {
      status: ic.rho === null ? "unavailable" : "ok",
      ...ic,
      outOfRange: ic.rho === null ? null : ic.rho < -1 || ic.rho > 1,
      weightsAsOf: asOf,
    };
  }
  out.impliedCorrelation = {
    status: Object.values(corr).some((c) => c && c.status === "ok") ? "ok" : "unavailable",
    byIndex: corr,
    rule: "rho = (sI^2 - sum w^2 s^2) / sum_{i!=j} w_i w_j s_i s_j over the holdings with a 30-day IV, weights renormalised over them; silent below 80% weight coverage",
  };

  const groups = [];
  for (const g of FLOW_GROUPS) {
    const res = r.groups && r.groups[g];
    if (!res || !res.ok) { groups.push({ group: g, ...(statusOf(res || { ok: false, error: "not read" }, "group-flow") || {}) }); continue; }
    const rows = rowsOf(res.body);
    const totals = greekFlowTotals(rows);
    const members = groupMembers(g, universeRows);
    groups.push({
      group: g,
      status: totals.minutes ? "ok" : "quiet",
      ...totals,
      alignment: groupAlignment(totals.delta, members),
      membership: GROUP_MEMBERS[g].rule,
    });
  }
  out.groups = {
    status: groups.some((g) => g.status === "ok") ? "ok" : "unavailable",
    rows: groups,
    rule: "sums of the per-minute rows over the session; alignment = share of members whose screener cum_dir_delta has the group's sign",
  };

  out.optionsPulse = r.pulse && r.pulse.ok
    ? shapeOptionsPulse(r.pulse.body, { sessionDate })
    : statusOf(r.pulse || { ok: false, error: "not read" }, "options-pulse");

  const daily = r.daily && r.daily.ok ? shapeDailyReport(r.daily.body && r.daily.body.data, { sessionDate })
    : statusOf(r.daily || { ok: false, error: "not read" }, "daily-report");
  if (daily && daily.status === "ok") {
    const { catalysts, ...rest } = daily;
    out.dailyReport = rest;
    out.catalysts = catalysts;
  } else {
    out.dailyReport = daily;
    out.catalysts = null;
  }

  const catalysts = out.catalysts ? compactNumbers(out.catalysts) : null;
  delete out.catalysts;
  Object.assign(out, compactNumbers(out));
  let bytes = JSON.stringify(out).length;
  const shed = [];
  for (const [path, drop] of [
    ["sectors.path", () => { for (const s of out.sectors.rows) if (s.path) delete s.path; }],
    ["etfTide.path", () => { for (const e of Object.values(out.etfTide.byEtf)) if (e && e.path) delete e.path; }],
    ["zeroDte.weeklyPath", () => { if (out.zeroDte) delete out.zeroDte.weeklyPath; }],
  ]) {
    if (bytes <= budgetBytes) break;
    drop();
    shed.push(path);
    bytes = JSON.stringify(out).length;
  }
  out.shed = shed;
  out.bytes = JSON.stringify(out).length;
  const parts = ["volCurve", "zeroDte", "sectors", "etfTide", "fundFlows", "impliedCorrelation", "groups", "optionsPulse", "dailyReport"];
  out.status = parts.some((k) => out[k] && out[k].status === "ok") ? "ok" : "unavailable";
  return { regime: out, catalysts };
}
