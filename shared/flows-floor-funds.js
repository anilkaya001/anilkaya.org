export const FUNDS_VERSION = 1;

export const FLOOR_FUNDS = Object.freeze({
  funds: Object.freeze(["SPY", "QQQ", "IWM", "DIA"]),
  etf: Object.freeze(["XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLB", "XLU", "XLRE"]),
  other: Object.freeze({
    Bonds: Object.freeze(["TLT", "IEF", "SHY", "TLH", "HYG", "LQD", "AGG", "BND", "JNK", "TBT", "TMF"]),
    Commodities: Object.freeze(["GLD", "SLV", "USO", "UNG", "GDX", "GDXJ", "COPX", "DBC", "PDBC", "IAU", "PPLT", "CPER", "URA", "SIL"]),
    "Index options": Object.freeze(["SPX", "SPXW", "NDX", "NDXP", "RUT", "RUTW", "VIX", "VIXW", "XSP", "DJX", "MRUT"]),
    Volatility: Object.freeze(["VXX", "UVXY", "SVXY", "VIXY", "SVIX", "UVIX"]),
    Crypto: Object.freeze(["IBIT", "BITO", "ETHA", "FBTC", "GBTC", "ETHE", "ARKB", "BITX"]),
    International: Object.freeze(["EEM", "EFA", "FXI", "EWZ", "KWEB", "EWJ", "INDA", "EWY", "EWT", "VWO", "MCHI", "EWG"]),
  }),
});

export const ROOT_ALIAS = Object.freeze({ SPXW: "SPX", NDXP: "NDX", RUTW: "RUT", VIXW: "VIX", MRUT: "RUT" });

export const FUNDS_FALLBACK_MAX = 24;
export const FUNDS_INFO_ROTATE = 12;
export const FUNDS_META_MAX_AGE_DAYS = 14;
export const FUNDS_BLOCK_BYTES = 16 * 1024;
export const FUNDS_SWITCH = "FLOWS_FLOOR_FUNDS";

export const SOURCE_ORDER = Object.freeze(["screener", "sector-etfs", "options-volume"]);

export const FUND_WHY = Object.freeze({
  no_row: "The feed returned no row for this fund this session.",
  stale: "The feed's row is for an earlier session.",
  not_listed: "This ticker is not in the feed's directory.",
  over_cap: "Not read tonight: the fallback read cap was reached.",
  refused: "The feed refused this read.",
  failed: "The read failed; it will be tried again.",
  off: "Whole-session activity is switched off.",
});

export const FIELDS = Object.freeze({
  cp: "call_premium", pp: "put_premium", cv: "call_volume", pv: "put_volume", bu: "bullish_premium", be: "bearish_premium",
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function floorFundsMode(env = {}) {
  const raw = String((env && env[FUNDS_SWITCH]) ?? "").trim().toLowerCase();
  return raw === "on" || raw === "owner" ? raw : "off";
}

export function nightlyFundsOn(env = {}) {
  return String((env && env[FUNDS_SWITCH]) ?? "").trim().toLowerCase() !== "off";
}

export function allTickers() {
  return [...FLOOR_FUNDS.funds, ...FLOOR_FUNDS.etf, ...Object.values(FLOOR_FUNDS.other).flat()];
}

export function readList() {
  return allTickers().filter((t) => !Object.prototype.hasOwnProperty.call(ROOT_ALIAS, t));
}

export function classOf(ticker) {
  if (FLOOR_FUNDS.funds.includes(ticker)) return "funds";
  if (FLOOR_FUNDS.etf.includes(ticker)) return "etf";
  for (const [cls, list] of Object.entries(FLOOR_FUNDS.other)) if (list.includes(ticker)) return cls;
  return null;
}

function amount(v, integer) {
  if (v === null || v === undefined || v === "") return { v: null, bad: false };
  if (typeof v === "string" && !/^\s*-?\d+(\.\d+)?\s*$/.test(v)) return { v: null, bad: true };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return { v: null, bad: true };
  if (n < 0) return { v: null, bad: true };
  return { v: integer ? Math.round(n) : n, bad: false };
}

export function shapeFundRow(row, source) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const out = { src: source, d: typeof row.date === "string" && DAY_RE.test(row.date) ? row.date : null };
  const bad = [];
  for (const [k, field] of Object.entries(FIELDS)) {
    const a = amount(row[field], true);
    out[k] = a.v;
    if (a.bad) bad.push(k);
  }
  if (bad.length) out.bad = bad;
  return out;
}

export const hasFigures = (r) => Boolean(r) && Object.keys(FIELDS).some((k) => r[k] !== null && r[k] !== undefined);

export function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray(body.data)) return body.data;
  return [];
}

function indexRows(rows, keyOf) {
  const m = new Map();
  for (const r of rows) {
    const t = r && typeof r === "object" ? keyOf(r) : null;
    if (typeof t === "string" && t) m.set(t.toUpperCase(), r);
  }
  return m;
}

export function candidatesOf({ screener, sectorEtfs, volume }) {
  const sc = indexRows(rowsOf(screener && screener.rows), (r) => r.ticker || r.symbol);
  const se = indexRows(rowsOf(sectorEtfs && sectorEtfs.rows), (r) => r.ticker);
  const vol = volume instanceof Map ? volume : new Map();
  return (t) => {
    const out = [];
    const s1 = sc.get(t);
    if (s1) {
      const r = shapeFundRow(s1, "screener");
      if (r && hasFigures(r)) out.push({ ...r, d: r.d || (screener && screener.date) || null });
    }
    const s2 = se.get(t);
    if (s2) {
      const r = shapeFundRow(s2, "sector-etfs");
      if (r && hasFigures(r)) out.push({ ...r, d: r.d || (sectorEtfs && sectorEtfs.date) || null });
    }
    if (vol.has(t)) {
      const rows = rowsOf(vol.get(t)).filter((x) => x && typeof x === "object");
      const first = rows.slice().sort((a, b) => (String(b.date || "") < String(a.date || "") ? -1 : 1))[0];
      const r = shapeFundRow(first, "options-volume");
      if (r && hasFigures(r)) out.push(r);
    }
    return out;
  };
}

export function pick(cands, session) {
  const cur = cands.filter((c) => c.d === session);
  if (cur.length) return { row: cur[0], why: null };
  if (cands.length) return { row: null, why: "stale" };
  return { row: null, why: null };
}

export function missingAfter({ session, screener, sectorEtfs, tickers = readList() }) {
  const cands = candidatesOf({ screener, sectorEtfs, volume: new Map() });
  return tickers.filter((t) => !pick(cands(t), session).row);
}

export function planFallback(missing, cap = FUNDS_FALLBACK_MAX) {
  return { read: missing.slice(0, cap), overCap: missing.slice(cap) };
}

function figure(c, session) {
  return { src: c.src, ...(c.d !== session ? { d: c.d } : {}), cp: c.cp, pp: c.pp, cv: c.cv, pv: c.pv, bu: c.bu, be: c.be };
}

export function fundRows(cands, session, reasons = new Map()) {
  const rows = {};
  const counts = { listed: 0, read: 0, fromScreener: 0, fromSectorEtfs: 0, fromVolume: 0, missing: 0, alias: 0 };
  for (const t of allTickers()) {
    if (Object.prototype.hasOwnProperty.call(ROOT_ALIAS, t)) {
      rows[t] = { alias: ROOT_ALIAS[t] };
      counts.alias++;
      continue;
    }
    counts.listed++;
    const chosen = pick(cands(t), session);
    if (chosen.row) {
      rows[t] = figure(chosen.row, session);
      counts.read++;
      if (chosen.row.src === "screener") counts.fromScreener++;
      else if (chosen.row.src === "sector-etfs") counts.fromSectorEtfs++;
      else counts.fromVolume++;
    } else {
      const why = chosen.why || reasons.get(t) || "no_row";
      rows[t] = { why: Object.prototype.hasOwnProperty.call(FUND_WHY, why) ? why : "no_row" };
      counts.missing++;
    }
  }
  return { rows, counts };
}

export function fundActivity({ session, readAt, screener = null, sectorEtfs = null, volume = new Map(), reasons = new Map(), meta = new Map(), mode = "on" }) {
  if (mode === "off") return { v: FUNDS_VERSION, status: "off" };
  const { rows, counts } = fundRows(candidatesOf({ screener, sectorEtfs, volume }), session, reasons);
  const status = counts.read === 0 ? "unavailable" : counts.read < counts.listed * 0.9 ? "partial" : "ok";
  const outMeta = {};
  for (const [t, m] of meta) if (m && typeof m === "object") outMeta[t] = m;
  return {
    v: FUNDS_VERSION, status, session, readAt,
    units: { prem: "usd", vol: "contracts", net: "usd" },
    basis: "whole-session options activity per fund, as the feed reports it",
    counts, rows, meta: outMeta,
  };
}

export function liveRows(screenerRows, session) {
  const { rows } = fundRows(candidatesOf({ screener: { rows: screenerRows, date: session }, sectorEtfs: null, volume: new Map() }), session);
  return rows;
}

const bytesOf = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

export function fitFunds(block, maxBytes = FUNDS_BLOCK_BYTES) {
  if (!block || typeof block !== "object" || !block.meta || bytesOf(block) <= maxBytes) return block;
  const meta = { ...block.meta };
  const order = Object.keys(meta).sort((a, b) => (String(meta[a] && meta[a].at || "") < String(meta[b] && meta[b].at || "") ? -1 : 1));
  let shed = 0;
  for (const t of order) {
    delete meta[t];
    shed++;
    if (bytesOf({ ...block, meta }) <= maxBytes) return { ...block, meta, shed };
  }
  return { ...block, meta: {}, shed };
}

export function metaFrom({ at, info, weights, flow, prior }) {
  const m = { at };
  const body = (b) => (b && typeof b === "object" && b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : b);
  const i = body(info);
  if (i && typeof i === "object") {
    if (typeof i.name === "string" && i.name) m.name = i.name.slice(0, 80);
    if (typeof i.etf_company === "string" && i.etf_company) m.issuer = i.etf_company.slice(0, 40);
    const n = amount(i.holdings_count, true);
    if (n.v !== null) m.n = n.v;
  }
  const w = body(weights);
  const top = (list, key) => (Array.isArray(list)
    ? list.map((x) => [x && x[key], amount(x && x.weight, false).v]).filter((x) => typeof x[0] === "string" && x[0] && x[1] !== null && x[0] !== "Other")
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => [x[0].slice(0, 40), Math.round(x[1] * 10000) / 10000])
    : []);
  if (w && typeof w === "object") {
    const sec = top(w.sector, "sector"), ctry = top(w.country, "country");
    if (sec.length) m.sec = sec;
    if (ctry.length) m.ctry = ctry;
  }
  const flows = rowsOf(flow).filter((r) => r && typeof r.date === "string" && DAY_RE.test(r.date) && Number.isFinite(Number(r.change)));
  if (flows.length) {
    const last = flows.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    m.flow = { d: last.date, sh: Math.round(Number(last.change)) };
  }
  const base = prior && typeof prior === "object" ? prior : {};
  if (Object.keys(m).length === 1) return Object.keys(base).length ? base : null;
  return { ...base, ...m };
}

export function rotationPlan({ prior = {}, today, list = readList(), cap = FUNDS_INFO_ROTATE, maxAgeDays = FUNDS_META_MAX_AGE_DAYS }) {
  const dayN = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 86400000);
  const t0 = DAY_RE.test(String(today)) ? dayN(today) : null;
  const age = (t) => {
    const m = prior[t];
    const at = m && typeof m.at === "string" ? m.at.slice(0, 10) : null;
    if (!at || !DAY_RE.test(at) || t0 === null) return Infinity;
    return t0 - dayN(at);
  };
  const due = list.filter((t) => age(t) >= maxAgeDays - 1);
  due.sort((a, b) => (age(b) === age(a) ? (a < b ? -1 : 1) : age(b) > age(a) ? 1 : -1));
  return due.slice(0, cap);
}

export function carryMeta(prior, today, maxAgeDays = FUNDS_META_MAX_AGE_DAYS) {
  const out = new Map();
  const dayN = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 86400000);
  if (!prior || typeof prior !== "object" || !DAY_RE.test(String(today))) return out;
  for (const [t, m] of Object.entries(prior)) {
    const at = m && typeof m.at === "string" ? m.at.slice(0, 10) : null;
    if (at && DAY_RE.test(at) && dayN(today) - dayN(at) < maxAgeDays) out.set(t, m);
  }
  return out;
}
