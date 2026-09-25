import { STRIP_FIELDS, stripValues } from "./flows-live.js";

export const FOCUS_METALS = Object.freeze([
  Object.freeze({ id: "gold", label: "Gold", lead: "GLD", tickers: Object.freeze(["GLD", "GDX", "NEM", "AEM"]) }),
  Object.freeze({ id: "silver", label: "Silver", lead: "SLV", tickers: Object.freeze(["SLV", "SIL", "PAAS", "WPM"]) }),
  Object.freeze({ id: "copper", label: "Copper", lead: "CPER", tickers: Object.freeze(["CPER", "COPX", "FCX", "SCCO"]) }),
]);

export const MAG7 = Object.freeze(["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"]);

export const FOCUS_FUNDS = Object.freeze(["GLD", "IAU", "SLV", "CPER", "COPX", "GDX", "GDXJ", "SIL", "SILJ"]);

export const FOCUS_MINERS = Object.freeze(["NEM", "AEM", "PAAS", "WPM", "FCX", "SCCO"]);

export const NDX_TOP = 10;

export const NDX_MEMBERSHIP_MIN = 90;

export const SHARE_CLASS = Object.freeze({ GOOG: "GOOGL", FOX: "FOXA", NWS: "NWSA" });

export const FOCUS_FIELDS = Object.freeze([
  "px", "prev", "chg", "ncp", "npp", "net", "bull", "bear", "lean", "cv", "pv", "iv30", "ivRank", "im", "pcr", "rvol", "vol",
]);

export const FOCUS_CLOSES = 22;

export const FOCUS_BUDGET_BYTES = 24 * 1024;

export const FOCUS_NAME_CHARS = 40;

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const tickerOf = (v) => {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return TICKER_RE.test(s) ? s : null;
};

const numberOf = (v) => {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export const canonicalClass = (t) => (Object.hasOwn(SHARE_CLASS, t) ? SHARE_CLASS[t] : t);

export function holdingsStocks(rows) {
  const out = [];
  let asOf = null;
  let listed = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const t = tickerOf(r.ticker);
    if (!t) continue;
    const type = typeof r.type === "string" ? r.type.trim().toLowerCase() : null;
    if (type !== "stock") continue;
    listed++;
    const u = dayOf(r.updated);
    if (u && (!asOf || u > asOf)) asOf = u;
    const w = numberOf(r.weight);
    if (w === null || !(w > 0)) continue;
    out.push({ t, w });
  }
  return { stocks: out, listed, asOf };
}

function capRanker(universe) {
  if (universe && !Array.isArray(universe) && Array.isArray(universe.t)) {
    const rank = new Map();
    universe.t.forEach((t, i) => { if (typeof t === "string" && !rank.has(t)) rank.set(t, -i); });
    return (t) => (rank.has(t) ? rank.get(t) : null);
  }
  const caps = new Map();
  for (const r of Array.isArray(universe) ? universe : []) {
    const t = r && tickerOf(r.ticker);
    const c = r ? numberOf(r.marketcap) : null;
    if (t && c !== null && !caps.has(t)) caps.set(t, c);
  }
  return (t) => (caps.has(t) ? caps.get(t) : null);
}

function collapse(entries) {
  const best = new Map();
  for (const { t, w } of entries) {
    const key = canonicalClass(t);
    const prior = best.get(key);
    if (!prior || w > prior.w) best.set(key, { t: key, w });
  }
  return [...best.values()];
}

export function ndx10(holdingsRows, universe, { size = NDX_TOP, fallback = null } = {}) {
  const read = Array.isArray(holdingsRows);
  const { stocks, listed, asOf } = holdingsStocks(holdingsRows);
  const companies = collapse(stocks).sort((a, b) => b.w - a.w || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (read && companies.length >= size) {
    return {
      tickers: companies.slice(0, size).map((c) => c.t),
      source: "qqq-holdings:" + (asOf || "undated"),
      asOf,
      weights: companies.slice(0, size).map((c) => Math.round(c.w * 1e4) / 1e4),
    };
  }
  const why = !read ? "holdings-unread" : `holdings-weighted-${companies.length}`;
  const listedTickers = read ? (Array.isArray(holdingsRows) ? holdingsRows : [])
    .filter((r) => r && typeof r.type === "string" && r.type.trim().toLowerCase() === "stock")
    .map((r) => tickerOf(r.ticker)).filter(Boolean) : [];
  const useListed = listed >= NDX_MEMBERSHIP_MIN;
  const pool = useListed ? listedTickers : (Array.isArray(fallback) ? fallback : []);
  const capOf = capRanker(universe);
  const ranked = collapse(pool.map((t) => ({ t, w: capOf(t) })).filter((x) => x.w !== null))
    .sort((a, b) => b.w - a.w || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return {
    tickers: ranked.slice(0, size).map((c) => c.t),
    source: `fallback:${why}:${useListed ? "holdings-by-cap" : "constant-by-cap"}`,
    asOf: useListed ? asOf : null,
    weights: null,
  };
}

export function ndxMembership(holdingsRows, { fallback = [], min = NDX_MEMBERSHIP_MIN } = {}) {
  const read = Array.isArray(holdingsRows);
  const { stocks, asOf } = holdingsStocks(holdingsRows);
  const members = [...new Set(stocks.map((s) => s.t))];
  const constant = [...new Set(Array.isArray(fallback) ? fallback : [])];
  if (read && members.length >= min) {
    const held = new Set(members);
    const listed = new Set(constant);
    return {
      members, source: "qqq-holdings", asOf, fallback: null,
      added: members.filter((t) => !listed.has(t)).sort(),
      dropped: constant.filter((t) => !held.has(t)).sort(),
    };
  }
  const reason = !read ? "the QQQ holdings read failed" : `the QQQ holdings listed ${members.length} weighted stock(s), under ${min}`;
  return {
    members: [...new Set([...members, ...constant])], source: "fallback", asOf: read ? asOf : null, fallback: reason,
    added: [], dropped: [],
  };
}

export function focusDeepSet(ndx) {
  const list = Array.isArray(ndx) ? ndx : ndx && Array.isArray(ndx.tickers) ? ndx.tickers : [];
  return new Set([...MAG7, ...list, ...FOCUS_MINERS]);
}

export function focusGroups(ndx) {
  const tickers = ndx && Array.isArray(ndx.tickers) ? ndx.tickers.slice() : [];
  return [
    ...FOCUS_METALS.map((g) => ({ id: g.id, label: g.label, kind: "metal", lead: g.lead, tickers: g.tickers.slice() })),
    { id: "mag7", label: "Mag 7", kind: "equity", tickers: MAG7.slice() },
    { id: "ndx10", label: "NDX 10", kind: "equity", tickers, source: (ndx && ndx.source) || "fallback:unresolved" },
  ];
}

const DEFAULT_FOCUS = Object.freeze([...new Set([...FOCUS_METALS.flatMap((g) => g.tickers), ...MAG7])]);

export function focusTickers(focusPayload) {
  const groups = focusPayload && typeof focusPayload === "object" && Array.isArray(focusPayload.groups)
    ? focusPayload.groups : null;
  if (!groups) return DEFAULT_FOCUS.slice();
  const out = [];
  const seen = new Set();
  for (const g of groups) {
    for (const raw of g && Array.isArray(g.tickers) ? g.tickers : []) {
      const t = tickerOf(raw);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out.length ? out : DEFAULT_FOCUS.slice();
}

export function focusCloses(features, sessionDate, { count = FOCUS_CLOSES } = {}) {
  const closes = features && Array.isArray(features.closes) ? features.closes : null;
  const dates = features && Array.isArray(features.closeDates) ? features.closeDates : null;
  if (!closes || !dates || !closes.length || closes.length !== dates.length) return null;
  if (!sessionDate || dates[dates.length - 1] !== sessionDate) return null;
  const tail = closes.slice(-count).map((v) => {
    const n = numberOf(v);
    return n === null || !(n > 0) ? null : Math.round(n * 1e4) / 1e4;
  });
  return tail.some((v) => v !== null) ? tail : null;
}

const FIELD_INDEX = Object.freeze(Object.fromEntries(STRIP_FIELDS.map(([n], i) => [n, i])));

export function focusRow(row) {
  const values = stripValues(row || {});
  const out = {};
  for (const f of FOCUS_FIELDS) {
    const v = values[FIELD_INDEX[f]];
    out[f] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  const type = row && typeof row.issue_type === "string" && row.issue_type.trim() ? row.issue_type.trim() : null;
  const name = row && typeof row.full_name === "string" && row.full_name.trim()
    ? row.full_name.trim().slice(0, FOCUS_NAME_CHARS).trim() : null;
  if (type) out.type = type;
  if (name) out.name = name;
  return out;
}

export function buildFocusPayload({
  ndx = null, rows = null, read = null, closesOf = () => null, sessionDate = null, generatedAt = null,
  readAt = null, fresh = null, budgetBytes = FOCUS_BUDGET_BYTES,
} = {}) {
  const groups = focusGroups(ndx);
  const asked = focusTickers({ groups });
  const base = {
    v: 1, sessionDate, generatedAt, readAt,
    fresh: fresh || { v: 1, readAt, vendorAt: null, source: "nightly", cadenceS: 0, session: sessionDate, writer: "flows-pipeline" },
    fields: FOCUS_FIELDS.slice(),
    groups,
  };
  if (!read || read.ok === false || !(rows instanceof Map) || !rows.size) {
    const reason = read && read.ok === false ? (read.gated ? "plan_gated" : "unreadable") : "empty";
    return { ...base, status: "unavailable", reason, detail: read && read.error ? String(read.error).slice(0, 200) : null,
      rows: {}, missing: asked.slice() };
  }
  const out = {};
  const closes = {};
  const missing = [];
  for (const t of asked) {
    const row = rows.get(t);
    if (!row) { missing.push(t); continue; }
    out[t] = focusRow(row);
    const c = closesOf(t);
    if (Array.isArray(c) && c.length) closes[t] = c;
  }
  const payload = { ...base, status: Object.keys(out).length ? "ok" : "unavailable", rows: out, closes, missing };
  if (payload.status !== "ok") payload.reason = "empty";
  const size = () => new TextEncoder().encode(JSON.stringify(payload)).length;
  const shed = [];
  for (const t of Object.keys(closes).reverse()) {
    if (size() <= budgetBytes) break;
    delete payload.closes[t];
    shed.push(t);
  }
  if (shed.length) payload.shed = { closes: shed.reverse() };
  payload.bytes = size();
  return payload;
}
