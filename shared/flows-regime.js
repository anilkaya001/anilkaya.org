import {
  vnum, vstr, isoDay, mean, sampleSd, medianOf, pctOf, ownZ, termSlope, frontStress, SILENCE,
} from "./flows-cross.js";

export const REGIME_SCHEMA_VERSION = 1;

export const REGIME_BUDGET_BYTES = 60 * 1024;

export const CURVE_TENORS = Object.freeze([1, 5, 7, 14, 30, 60, 90, 180, 365]);

export const SECTOR_TIDES = Object.freeze([
  "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive",
  "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology",
  "Utilities",
]);

export const ETF_TIDES = Object.freeze(["SPY", "QQQ", "IWM"]);

export const FUND_FLOW_ETFS = Object.freeze(["SPY", "QQQ", "IWM"]);

export const CORRELATION_ETFS = Object.freeze(["SPY", "QQQ"]);

export const FLOW_GROUPS = Object.freeze([
  "mag7", "semi", "bank", "technology", "energy", "healthcare", "financial services",
  "consumer cyclical",
]);

export const MAG7 = Object.freeze(["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"]);

export const GROUP_MEMBERS = Object.freeze({
  mag7: { rule: "fixed list", tickers: MAG7 },
  semi: { rule: "industry_type matches /semiconductor/i", industry: /semiconductor/i },
  bank: { rule: "industry_type matches /bank/i", industry: /bank/i },
  technology: { rule: "sector Technology", sector: "Technology" },
  energy: { rule: "sector Energy", sector: "Energy" },
  healthcare: { rule: "sector Healthcare", sector: "Healthcare" },
  "financial services": { rule: "sector Financial Services", sector: "Financial Services" },
  "consumer cyclical": { rule: "sector Consumer Cyclical", sector: "Consumer Cyclical" },
});

export const FUND_FLOW_WINDOW = 20;

export const OWN_HISTORY_MIN = 60;

const byTime = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);

export function seriesPoints(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const t = vstr(r.timestamp);
    const ms = t ? Date.parse(t) : NaN;
    if (!Number.isFinite(ms)) continue;
    const ncp = vnum(r.net_call_premium);
    const npp = vnum(r.net_put_premium);
    if (ncp === null && npp === null) continue;
    out.push({ t: new Date(ms).toISOString(), ms, ncp, npp, vol: vnum(r.net_volume), px: vnum(r.underlying_price) });
  }
  out.sort(byTime);
  return out;
}

export function directional(p) {
  if (!p || p.ncp === null || p.npp === null) return null;
  return p.ncp - p.npp;
}

export function downsample(points, { stepMinutes = 5 } = {}) {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) return { t0: null, step: stepMinutes, pts: [] };
  const t0 = list[0].ms;
  const pts = [];
  let lastBucket = -1;
  list.forEach((p, i) => {
    const off = Math.round((p.ms - t0) / 60000);
    const bucket = Math.floor(off / stepMinutes);
    if (bucket !== lastBucket || i === list.length - 1) {
      if (bucket === lastBucket && pts.length) pts.pop();
      const net = directional(p);
      pts.push([off, net === null ? null : Math.round(net), p.px === null ? null : Number(p.px.toFixed(2))]);
      lastBucket = bucket;
    }
  });
  return { t0: list[0].t, step: stepMinutes, pts };
}

export function tideSummary(rows, { stepMinutes = 15, sessionDate = null } = {}) {
  const points = seriesPoints(rows);
  if (!points.length) return { status: "quiet", reason: SILENCE.absent, points: 0 };
  const last = points[points.length - 1];
  const date = isoDay(rows && rows[0] && rows[0].date) || null;
  return {
    status: "ok",
    date,
    sameSession: sessionDate && date ? date === sessionDate : null,
    ncp: last.ncp, npp: last.npp,
    net: directional(last),
    dir: directional(last) === null ? null : Math.sign(directional(last)),
    vol: last.vol,
    points: points.length,
    first: points[0].t, last: last.t,
    path: downsample(points, { stepMinutes }),
  };
}

export function parseNetFlow(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const echo = (k) => (Array.isArray(b[k]) ? b[k].map(String) : vstr(b[k]) ? [b[k]] : []);
  const series = [];
  for (const s of Array.isArray(b.data) ? b.data : []) {
    if (!s || typeof s !== "object") continue;
    series.push({
      moneyness: vstr(s.moneyness), tideType: vstr(s.tide_type),
      points: seriesPoints(s.data),
    });
  }
  return {
    date: isoDay(b.date),
    expiration: echo("expiration"), moneyness: echo("moneyness"), tideType: echo("tide_type"),
    series,
  };
}

export function sessionNet(parsed) {
  const s = parsed && parsed.series && parsed.series[0];
  if (!s || !s.points.length) return null;
  return directional(s.points[s.points.length - 1]);
}

export function zeroDteShare(np0, npw) {
  const a = vnum(np0), b = vnum(npw);
  if (a === null || b === null) return null;
  const d = Math.abs(a) + Math.abs(b);
  return d > 0 ? Math.abs(a) / d : null;
}

export function buildZeroDte({ zero, weekly, zeroEquity = null, zeroIndex = null, sessionDate = null } = {}) {
  const z = zero ? parseNetFlow(zero) : null;
  const w = weekly ? parseNetFlow(weekly) : null;
  if (!z || !z.series.length || !z.series[0].points.length) {
    return { status: "unavailable", reason: z ? SILENCE.absent : SILENCE.unread };
  }
  const np0 = sessionNet(z);
  const npw = w ? sessionNet(w) : null;
  const eq = zeroEquity ? sessionNet(parseNetFlow(zeroEquity)) : null;
  const ix = zeroIndex ? sessionNet(parseNetFlow(zeroIndex)) : null;
  const last = z.series[0].points[z.series[0].points.length - 1];
  return {
    status: "ok",
    date: z.date,
    sameSession: sessionDate && z.date ? z.date === sessionDate : null,
    echo: { expiration: z.expiration, moneyness: z.moneyness, tideType: z.tideType },
    np0, npw,
    share: zeroDteShare(np0, npw),
    ncp0: last.ncp, npp0: last.npp,
    equity: eq, index: ix,
    equityShare: zeroDteShare(eq, ix),
    path: downsample(z.series[0].points, { stepMinutes: 5 }),
    weeklyPath: w && w.series.length ? downsample(w.series[0].points, { stepMinutes: 15 }) : null,
  };
}

export const GREEK_FLOW_SUMS = Object.freeze([
  ["dir_delta_flow", "delta"], ["dir_vega_flow", "vega"],
  ["otm_dir_delta_flow", "otmDelta"], ["otm_dir_vega_flow", "otmVega"],
  ["total_delta_flow", "totalDelta"], ["total_vega_flow", "totalVega"],
  ["net_call_premium", "ncp"], ["net_put_premium", "npp"],
  ["net_call_volume", "ncv"], ["net_put_volume", "npv"],
]);

export function greekFlowTotals(rows) {
  const out = { minutes: 0 };
  for (const [, k] of GREEK_FLOW_SUMS) out[k] = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    let any = false;
    for (const [src, k] of GREEK_FLOW_SUMS) {
      const v = vnum(r[src]);
      if (v === null) continue;
      out[k] = (out[k] ?? 0) + v;
      any = true;
    }
    if (any) out.minutes++;
  }
  out.purity = out.delta !== null && out.totalDelta !== null && Math.abs(out.totalDelta) > 0
    ? Math.abs(out.delta) / Math.abs(out.totalDelta) : null;
  out.net = out.ncp !== null && out.npp !== null ? out.ncp - out.npp : null;
  return out;
}

export function groupMembers(group, universeRows) {
  const spec = GROUP_MEMBERS[group];
  if (!spec) return [];
  const rows = Array.isArray(universeRows) ? universeRows : [];
  if (spec.tickers) {
    const want = new Set(spec.tickers);
    return rows.filter((r) => r && want.has(r.ticker));
  }
  if (spec.industry) return rows.filter((r) => r && spec.industry.test(String(r.industry_type || "")));
  if (spec.sector) return rows.filter((r) => r && r.sector === spec.sector);
  return [];
}

export function groupAlignment(groupDelta, members) {
  const g = vnum(groupDelta);
  const signs = (Array.isArray(members) ? members : [])
    .map((r) => vnum(r && r.cum_dir_delta))
    .filter((v) => v !== null && v !== 0);
  if (g === null || g === 0) return { members: signs.length, agree: null, share: null, reason: SILENCE.absent };
  if (!signs.length) return { members: 0, agree: null, share: null, reason: SILENCE.few };
  const agree = signs.filter((v) => Math.sign(v) === Math.sign(g)).length;
  return { members: signs.length, agree, share: agree / signs.length, reason: null };
}

export function fundFlowSummary(rows, { sessionDate = null, window = FUND_FLOW_WINDOW, min = OWN_HISTORY_MIN } = {}) {
  const list = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = isoDay(r && r.date);
    if (!d || (sessionDate && d > sessionDate)) continue;
    list.push({ d, usd: vnum(r.change_prem), shares: vnum(r.change), close: vnum(r.close), fomc: r.is_fomc === true, cycle: vstr(r.expiration_cycle) });
  }
  list.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  if (!list.length) return { status: "quiet", reason: SILENCE.absent };
  const sums = [];
  for (let i = window - 1; i < list.length; i++) {
    let s = 0, ok = true;
    for (let j = i - window + 1; j <= i; j++) {
      if (list[j].usd === null) { ok = false; break; }
      s += list[j].usd;
    }
    sums.push(ok ? s : null);
  }
  const latest = list[list.length - 1];
  const cum = sums.length ? sums[sums.length - 1] : null;
  const z = ownZ(sums.slice(0, -1), cum, { min });
  return {
    status: "ok",
    date: latest.d,
    sameSession: sessionDate ? latest.d === sessionDate : null,
    changeShares: latest.shares, changeUsd: latest.usd, fomc: latest.fomc,
    cum20Usd: cum, z20: z.z, n: z.n, reason: z.reason,
    window,
    rule: "z of the latest 20-session sum of change_prem against the earlier 20-session sums in the returned year",
  };
}

export function putCallHistory(rows, { sessionDate = null, min = OWN_HISTORY_MIN } = {}) {
  const list = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = isoDay(r && r.date);
    if (!d || (sessionDate && d > sessionDate)) continue;
    const cv = vnum(r.call_volume), pv = vnum(r.put_volume);
    const cp = vnum(r.call_premium), pp = vnum(r.put_premium);
    list.push({
      d,
      pcVol: cv !== null && pv !== null && cv > 0 ? pv / cv : null,
      pcPrem: cp !== null && pp !== null && cp > 0 ? pp / cp : null,
      vol: cv !== null && pv !== null ? cv + pv : null,
    });
  }
  list.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  if (!list.length) return { status: "quiet", reason: SILENCE.absent, n: 0 };
  const latest = list[list.length - 1];
  const prior = list.slice(0, -1);
  const vz = ownZ(prior.map((x) => x.pcVol), latest.pcVol, { min });
  const pz = ownZ(prior.map((x) => x.pcPrem), latest.pcPrem, { min });
  return {
    status: "ok",
    date: latest.d,
    sameSession: sessionDate ? latest.d === sessionDate : null,
    n: list.length, from: list[0].d, to: latest.d,
    pcVolume: { now: latest.pcVol, mean: vz.mean, sd: vz.sd, z: vz.z, reason: vz.reason },
    pcPremium: { now: latest.pcPrem, mean: pz.mean, sd: pz.sd, z: pz.z, reason: pz.reason },
    volume: { now: latest.vol, pct: pctOf(list.map((x) => x.vol), latest.vol) },
    rule: "z against the earlier sessions of the same read (sample sd, today excluded); volume pct over every session read, today included",
  };
}

export function volCurveFromScreener(row) {
  if (!row || typeof row !== "object") return { status: "unavailable", reason: SILENCE.absent };
  const iv = CURVE_TENORS.map((d) => {
    const v = vnum(row["volatility_" + d]);
    return v !== null && v > 0 ? v : null;
  });
  if (!iv.some((v) => v !== null)) return { status: "unavailable", reason: SILENCE.absent };
  const at = (d) => iv[CURVE_TENORS.indexOf(d)];
  const ts = termSlope(at(30), at(90));
  const fs = frontStress(at(7), at(30));
  const ivp = vnum(row.iv_percentile_1y);
  return {
    status: "ok",
    date: isoDay(row.date),
    tenors: CURVE_TENORS.slice(),
    iv,
    ts, fs,
    steep: vnum(row.steepness_180_30),
    shape: ts === null ? null : ts < 0 ? "contango" : ts > 0 ? "backwardation" : "flat",
    frontInverted: fs === null ? null : fs > 0,
    ivp: ivp !== null && ivp >= 0 && ivp <= 100 ? ivp : null,
    rv20: vnum(row.realized_volatility),
    close: vnum(row.close),
  };
}

const anomalyRow = (r) => {
  if (!r || typeof r !== "object") return null;
  const t = vstr(r.ticker);
  if (!t) return null;
  const c = r.components && typeof r.components === "object" ? r.components : {};
  const pair = (k, extra) => {
    const o = c[k];
    if (!o || typeof o !== "object") return null;
    const out = [vnum(o.raw), vnum(o.value)];
    if (extra) out.push(vnum(o[extra]));
    return out;
  };
  return {
    t,
    score: vnum(r.score),
    dir: vstr(r.direction),
    n: vnum(r.sample_size),
    c: {
      ivp: pair("iv_percentile"), regime: pair("regime_score", "crash_probability"),
      skew: pair("skew_percentile", "percentile"), vov: pair("vov_percentile"), vrpz: pair("vrp_z"),
    },
  };
};

const flowRow = (r) => {
  const t = vstr(r && r.ticker);
  const np = vnum(r && r.net_premium);
  return t && np !== null ? { t, np } : null;
};

export function shapeCatalyst(r) {
  if (!r || typeof r !== "object") return null;
  const title = vstr(r.title);
  const type = vstr(r.type);
  if (!title && !type) return null;
  return {
    type,
    date: isoDay(r.date),
    at: vstr(r.datetime),
    t: vstr(r.ticker),
    title: title ? title.slice(0, 96) : null,
    impact: vstr(r.impact),
    mcap: vnum(r.marketcap),
    opt: typeof r.has_options === "boolean" ? r.has_options : null,
  };
}

export function shapeDailyReport(data, { sessionDate = null, cap = 25, catalystCap = 40 } = {}) {
  const d = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  if (!d) return { status: "unavailable", reason: SILENCE.unreadable };
  const list = (v, f, n) => (Array.isArray(v) ? v.map(f).filter(Boolean).slice(0, n) : []);
  const vol = d.vol && typeof d.vol === "object" ? d.vol : {};
  const flow = d.flow && typeof d.flow === "object" ? d.flow : {};
  const cat = d.catalysts && typeof d.catalysts === "object" ? d.catalysts : {};
  const date = isoDay(d.date);
  return {
    status: "ok",
    date,
    sameSession: sessionDate && date ? date === sessionDate : null,
    vol: { richest: list(vol.richest, anomalyRow, cap), cheapest: list(vol.cheapest, anomalyRow, cap) },
    skew: list(d.skew, anomalyRow, cap),
    flow: { bullish: list(flow.bullish, flowRow, cap), bearish: list(flow.bearish, flowRow, cap) },
    catalysts: {
      status: Array.isArray(cat.data) && cat.data.length ? "ok" : "quiet",
      rows: list(cat.data, shapeCatalyst, catalystCap),
      counts: cat.counts_by_type && typeof cat.counts_by_type === "object" ? cat.counts_by_type : null,
      from: isoDay(cat.date_min), to: isoDay(cat.date_max),
      seen: Array.isArray(cat.data) ? cat.data.length : 0,
    },
    unshaped: {
      stock_movers: Array.isArray(d.stock_movers) ? d.stock_movers.length : null,
      unusual_options: Array.isArray(d.unusual_options) ? d.unusual_options.length : null,
      tide: d.tide && Array.isArray(d.tide.data) ? d.tide.data.length : null,
      why: "the probe did not print one row of these groups, so no field name is trusted yet",
    },
    scoreSign: "score carries the direction: negative with long_vol, positive with short_vol (inferred from two probe rows)",
  };
}

export function shapeOptionsPulse(body, { sessionDate = null } = {}) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const data = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : null;
  if (!data) return { status: "unavailable", reason: SILENCE.unreadable };
  const row = (r) => (r && typeof r === "object" ? {
    at: vstr(r.hr_min), day: isoDay(r.trd_dt),
    callTxn: vnum(r.call_txn), putTxn: vnum(r.put_txn),
    sntm: vnum(r.sntm_score), intvl: vnum(r.intvl_sntm_score), mkt: vnum(r.mkt_sntm),
  } : null);
  const latest = row(data.latest);
  const intraday = (Array.isArray(data.intraday) ? data.intraday : []).map(row).filter(Boolean)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (!latest && !intraday.length) return { status: "quiet", reason: SILENCE.absent };
  const date = isoDay(b.date) || (latest && latest.day) || null;
  return {
    status: "ok",
    date,
    sameSession: sessionDate && date ? date === sessionDate : null,
    latest,
    pcTxn: latest && latest.callTxn > 0 && latest.putTxn !== null ? latest.putTxn / latest.callTxn : null,
    intraday: intraday.map((r) => [r.at, r.sntm, r.intvl]),
    meaning: "unverified: sntm_score reads 0-1, mkt_sntm has no documented scale",
  };
}

export function holdingsMembers(rows) {
  const out = [];
  let asOf = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const t = vstr(r.ticker);
    const w = vnum(r.weight);
    if (!t || w === null || !(w > 0)) continue;
    const u = isoDay(r.updated);
    if (u && (!asOf || u > asOf)) asOf = u;
    out.push({ t, w: w / 100, type: vstr(r.type) });
  }
  return { members: out, asOf };
}

export function vendorGate(error) {
  const m = /HTTP (\d{3})/.exec(String(error && error.message || error || ""));
  const status = m ? Number(m[1]) : null;
  return {
    status,
    gated: status === 403 || status === 422,
  };
}

export function regimeSize(payload) {
  return JSON.stringify(payload).length;
}

export { mean, sampleSd, medianOf };
