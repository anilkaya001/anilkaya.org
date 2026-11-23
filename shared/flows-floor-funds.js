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
export const FUNDS_BLOCK_BYTES = 32 * 1024;
export const FUNDS_ROTATE_SKIP = Object.freeze(["Index options"]);
export const FUNDS_BACKOFF_MAX_DAYS = 28;
export const FUNDS_BACKOFF_MAX_MISSES = 99;
export const DESC_READS = Object.freeze(["info", "weights", "flow"]);
export const DESC_OUTCOMES = Object.freeze(["ok", "empty", "refused", "limited", "failed"]);
export const BACKOFF_WHY = Object.freeze({
  empty: "The feed's description reads for this fund gave nothing usable.",
  refused: "The feed refused every description read for this fund.",
  limited: "The feed's rate limit stopped this fund's description reads.",
  failed: "This fund's description reads failed.",
});
export const FUNDS_SWITCH = "FLOWS_FLOOR_FUNDS";

export const SOURCE_ORDER = Object.freeze(["screener", "sector-etfs", "options-volume"]);

export const FUND_WHY = Object.freeze({
  no_row: "The feed returned no row for this fund this session.",
  stale: "The feed's row is for an earlier session.",
  not_listed: "This ticker is not in the feed's directory.",
  over_cap: "Not read tonight: the fallback read cap was reached.",
  refused: "The feed refused this read.",
  failed: "The read failed; it will be tried again.",
  limited: "Not read yet: the site's read limit was reached; it will be tried again.",
  not_read: "Not read this session.",
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

const SHED_STEPS = Object.freeze([["ctry"], ["sec"], ["name", "issuer", "n", "flow"]]);

export function fitFunds(block, maxBytes = FUNDS_BLOCK_BYTES) {
  if (!block || typeof block !== "object" || !block.meta || bytesOf(block) <= maxBytes) return block;
  const meta = {};
  for (const [t, m] of Object.entries(block.meta)) meta[t] = m && typeof m === "object" ? { ...m } : m;
  const atOf = (t) => String(meta[t] && meta[t].at || "");
  const order = Object.keys(meta).sort((a, b) => (atOf(a) === atOf(b) ? (a < b ? -1 : 1) : atOf(a) < atOf(b) ? -1 : 1));
  let shed = 0;
  for (const keys of SHED_STEPS) {
    for (const t of order) {
      const m = meta[t];
      if (!m || typeof m !== "object" || !keys.some((k) => k in m)) continue;
      for (const k of keys) delete m[k];
      shed++;
      if (bytesOf({ ...block, meta }) <= maxBytes) return { ...block, meta, shed };
    }
  }
  for (const t of order) {
    delete meta[t];
    shed++;
    if (bytesOf({ ...block, meta }) <= maxBytes) return { ...block, meta, shed };
  }
  return { ...block, meta: {}, shed };
}

const bodyOf = (b) => (b && typeof b === "object" && b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : b);

export function infoMeta(info) {
  const m = {};
  const i = bodyOf(info);
  if (i && typeof i === "object") {
    if (typeof i.name === "string" && i.name) m.name = i.name.slice(0, 80);
    if (typeof i.etf_company === "string" && i.etf_company) m.issuer = i.etf_company.slice(0, 40);
    const n = amount(i.holdings_count, true);
    if (n.v !== null) m.n = n.v;
  }
  return m;
}

export function weightsMeta(weights) {
  const m = {};
  const w = bodyOf(weights);
  const top = (list, key) => (Array.isArray(list)
    ? list.map((x) => [x && x[key], amount(x && x.weight, false).v]).filter((x) => typeof x[0] === "string" && x[0] && x[1] !== null && x[0] !== "Other")
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => [x[0].slice(0, 40), Math.round(x[1] * 10000) / 10000])
    : []);
  if (w && typeof w === "object") {
    const sec = top(w.sector, "sector"), ctry = top(w.country, "country");
    if (sec.length) m.sec = sec;
    if (ctry.length) m.ctry = ctry;
  }
  return m;
}

export function flowMeta(flow) {
  const flows = rowsOf(flow).filter((r) => r && typeof r.date === "string" && DAY_RE.test(r.date) && Number.isFinite(Number(r.change)));
  if (!flows.length) return {};
  const last = flows.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return { flow: { d: last.date, sh: Math.round(Number(last.change)) } };
}

export function metaFrom({ at, info, weights, flow, prior }) {
  const m = { at, ...infoMeta(info), ...weightsMeta(weights), ...flowMeta(flow) };
  const base = prior && typeof prior === "object" ? prior : {};
  if (Object.keys(m).length === 1) return Object.keys(base).length ? base : null;
  return { ...base, ...m };
}

const dayNum = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 86400000);
const dayStr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

export function rotationCandidates({ list = readList(), absent = [] } = {}) {
  const skip = new Set(FUNDS_ROTATE_SKIP.flatMap((c) => FLOOR_FUNDS.other[c] || []));
  const gone = new Set(Array.isArray(absent) ? absent : []);
  const root = list.filter((t) => skip.has(t));
  const unlisted = list.filter((t) => !skip.has(t) && gone.has(t));
  return { list: list.filter((t) => !skip.has(t) && !gone.has(t)), root, unlisted };
}

export const backoffDays = (k) => Math.min(FUNDS_BACKOFF_MAX_DAYS, 2 ** (Math.max(1, k) - 1));

export const heldBy = (entry, today) => Boolean(entry && typeof entry.next === "string" && DAY_RE.test(entry.next) && entry.next > today);

export function noteMiss(prev, today, why) {
  const k = why === "failed" || why === "limited" ? 1 : Math.min(FUNDS_BACKOFF_MAX_MISSES, ((prev && Number.isInteger(prev.k) && prev.k > 0) ? prev.k : 0) + 1);
  return { k, next: dayStr(dayNum(today) + backoffDays(k)), why };
}

export function carryBackoff(prior, list = readList()) {
  const out = {};
  if (!prior || typeof prior !== "object") return out;
  for (const t of list) {
    const e = prior[t];
    if (e && typeof e === "object" && Number.isInteger(e.k) && e.k > 0 && e.k <= FUNDS_BACKOFF_MAX_MISSES
      && typeof e.next === "string" && DAY_RE.test(e.next) && Object.prototype.hasOwnProperty.call(BACKOFF_WHY, e.why)) out[t] = { k: e.k, next: e.next, why: e.why };
  }
  return out;
}

export function readOutcome(result, usable) {
  if (result && result.ok) return usable ? "ok" : "empty";
  const s = result && result.status;
  if (s === 429) return "limited";
  if (s === 400 || s === 401 || s === 402 || s === 403 || s === 404 || s === 422) return "refused";
  return "failed";
}

export function missOf(outcomes) {
  const list = Object.values(outcomes || {});
  if (list.includes("ok")) return null;
  for (const w of ["failed", "limited", "empty"]) if (list.includes(w)) return w;
  return "refused";
}

export function tallyOutcomes(perFund) {
  const out = {};
  for (const r of DESC_READS) out[r] = Object.fromEntries(DESC_OUTCOMES.map((o) => [o, 0]));
  for (const outcomes of perFund) for (const r of DESC_READS) if (outcomes && outcomes[r] && out[r][outcomes[r]] !== undefined) out[r][outcomes[r]]++;
  return out;
}

export function rotationPlan({ prior = {}, today, list = rotationCandidates().list, backoff = {}, cap = FUNDS_INFO_ROTATE, maxAgeDays = FUNDS_META_MAX_AGE_DAYS }) {
  const dayN = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 86400000);
  const t0 = DAY_RE.test(String(today)) ? dayN(today) : null;
  const age = (t) => {
    const m = prior[t];
    const at = m && typeof m.at === "string" ? m.at.slice(0, 10) : null;
    if (!at || !DAY_RE.test(at) || t0 === null) return Infinity;
    return t0 - dayN(at);
  };
  const due = list.filter((t) => age(t) >= maxAgeDays - 1 && !heldBy(backoff[t], today));
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
