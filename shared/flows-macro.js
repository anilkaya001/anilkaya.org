import { unwrap } from "./flows-vendor-core.js";
import { sampleSd, wilson, meanCi, median, benjaminiHochberg } from "./flows-stats.js";
import { previousSession } from "./flows-calendar.js";
import { instantOf } from "./flows-time.js";
import { fixtureNameIn } from "./flows-fixture-names.js";
import { sanitizeText } from "./flows-dossier.js";
import { COPY } from "./flows-macro-copy.js";

export const RATE_FLAT_BP = 5;
export const MATURITIES = Object.freeze(["3month", "2year", "5year", "7year", "10year", "30year"]);
export const INDICATORS = Object.freeze(["cpi", "inflation", "unemployment", "payrolls", "retail-sales", "durables", "gdp", "gdp-per-capita"]);
export const QUARTERLY = Object.freeze(["gdp", "gdp-per-capita"]);
export const DAILY_COMMODITIES = Object.freeze(["wti", "brent", "natural-gas"]);
export const MONTHLY_COMMODITIES = Object.freeze(["copper", "aluminum", "wheat", "corn", "cotton", "sugar", "coffee", "all-commodities"]);
export const FX_PAIRS = Object.freeze(["EURUSD", "USDJPY", "GBPUSD", "USDCHF", "AUDUSD", "USDCAD", "USDCNY", "USDTRY"]);
export const CRYPTO = Object.freeze(["BTC", "ETH", "SOL"]);
export const PRODUCTS = Object.freeze({
  ES: "S&P 500", NQ: "Nasdaq-100", RTY: "Russell 2000", YM: "Dow",
  ZT: "2-year note", ZN: "10-year note", ZB: "Bond",
  CL: "Crude oil", NG: "Natural gas", GC: "Gold", SI: "Silver", HG: "Copper",
  "6E": "Euro", "6J": "Yen",
});
export const PRODUCT_GROUPS = Object.freeze([
  ["Equity", ["ES", "NQ", "RTY", "YM"]],
  ["Rates", ["ZT", "ZN", "ZB"]],
  ["Energy and metals", ["CL", "NG", "GC", "SI", "HG"]],
  ["Currencies", ["6E", "6J"]],
]);
export const FLOW_GROUPS = Object.freeze([["ES", "NQ", "RTY", "YM"], ["ZT", "ZN", "ZB"], ["CL", "NG"], ["GC", "SI", "HG"], ["6E", "6J"]]);
export const LARGE = Object.freeze({ ES: 100, NQ: 50, RTY: 50, YM: 50, ZN: 500, ZB: 200, ZT: 500, CL: 50, NG: 50, GC: 25, SI: 25, HG: 25, "6E": 100, "6J": 100 });
export const CURVE_PRODUCTS = Object.freeze(["ES", "CL", "ZN"]);
export const MONTH_CODES = "FGHJKMNQUVXZ";
export const MONTH_NAMES = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
export const SEASON_FUNDS = Object.freeze(["SPY", "QQQ", "IWM", "DIA", "XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLB", "XLU", "XLRE"]);
export const SEASON_CHECK = Object.freeze(["SPY", "QQQ", "IWM", "DIA"]);
export const SEASON_MIN_YEARS = 8;
export const MACRO_CAP_BYTES = 96 * 1024;
export const ODDS_TAGS = Object.freeze({
  fomc: /\b(fed|fomc|federal reserve|interest rates?|rate (cut|hike)|basis points?|bps)\b/i,
  cpi: /\b(cpi|inflation)\b/i,
  nfp: /\b(non-?farm|payrolls?|jobs report|unemployment rate)\b/i,
  gdp: /\b(gdp|recession)\b/i,
  pce: /\bpce\b/i,
  ppi: /\bppi\b/i,
});
export const ODDS_WINDOW = Object.freeze({ beforeMs: 864e5, afterMs: 7 * 864e5 });
export const ODDS_THIN = Object.freeze({ liquidityUsd: 50000, spread: 0.05 });
export const ODDS_MAX_PER_ROW = 2;
export const ODDS_MAX_TOTAL = 8;
export const ODDS_MAX_UNMATCHED = 6;
export const MACRO_NIGHTLY_CALLS = 152;

const NUM_RE = /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ADDRESS_KEYS = Object.freeze(["user_address", "from_address", "to_address", "maker_address", "taker_address", "transaction_hash", "user_name", "address"]);

export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && NUM_RE.test(v.trim())) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function int(v) {
  const n = num(v);
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function dateOf(v) {
  if (typeof v !== "string") return null;
  const s = v.length >= 10 ? v.slice(0, 10) : v;
  if (!DAY_RE.test(s)) return null;
  const ms = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? s : null;
}

export function zonedInstant(ts, zone) {
  if (typeof ts !== "string") return { at: null, why: "type:timestamp" };
  if (DAY_RE.test(ts)) return dateOf(ts) ? { at: null, why: null, date: ts } : { at: null, why: "type:timestamp" };
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(ts)) {
    const at = instantOf(ts);
    return at === null ? { at: null, why: "type:timestamp" } : { at: new Date(at).toISOString(), why: null };
  }
  if (zone === "UTC") {
    const at = instantOf(ts.replace(" ", "T") + "Z");
    return at === null ? { at: null, why: "type:timestamp" } : { at: new Date(at).toISOString(), why: null };
  }
  return { at: null, why: "zone", date: dateOf(ts) };
}

const text = (v, cap) => {
  const s = sanitizeText(v, { cap });
  return s && typeof s.text === "string" && s.text ? s.text : null;
};

export function seriesOf(raw) {
  const body = unwrap(raw);
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: "withheld", why: "shape", unit: null, interval: null, name: null, points: [], nulls: 0 };
  const rows = Array.isArray(body.data) ? body.data : null;
  if (!rows) return { status: "withheld", why: "shape", unit: null, interval: null, name: null, points: [], nulls: 0 };
  const byDate = new Map();
  let nulls = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const d = dateOf(r.date);
    if (d === null) continue;
    const v = num(r.value);
    if (v === null) { nulls++; continue; }
    byDate.set(d, v);
  }
  const points = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const unit = typeof body.unit === "string" && body.unit.trim() ? text(body.unit, 40) : null;
  const interval = typeof body.interval === "string" ? body.interval : null;
  const name = typeof body.name === "string" ? text(body.name, 40) : null;
  if (!points.length) return { status: "withheld", why: "empty", unit, interval, name, points, nulls };
  if (unit === null) return { status: "withheld", why: "unit", unit, interval, name, points, nulls };
  return { status: "ok", unit, interval, name, points, nulls };
}

export function barsOf(raw, zoneHint) {
  const body = unwrap(raw);
  if (!body || typeof body !== "object" || !Array.isArray(body.bars)) return { status: "withheld", why: "shape", points: [], zone: null, timed: [] };
  const zone = typeof body.time_zone === "string" ? body.time_zone : zoneHint || null;
  const byDate = new Map();
  const timed = [];
  for (const b of body.bars) {
    if (!b || typeof b !== "object") continue;
    const close = num(b.close);
    const z = zonedInstant(b.timestamp, zone);
    const d = z.at ? z.at.slice(0, 10) : z.date || dateOf(b.timestamp);
    if (close === null || d === null) continue;
    byDate.set(d, close);
    timed.push([z.at, d, close, z.why]);
  }
  const points = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!points.length) return { status: "withheld", why: "empty", points, zone, timed };
  timed.sort((a, b) => ((a[1] + (a[0] || "")) < (b[1] + (b[0] || "")) ? -1 : 1));
  return { status: "ok", points, zone, timed };
}

export function dailyStats(points, { year = 252 } = {}) {
  const n = Array.isArray(points) ? points.length : 0;
  if (!n) return { last: null, prev: null, chg1: null, chg21: null, rv21: null, why: "empty" };
  const last = points[n - 1];
  const prev = n >= 2 ? points[n - 2] : null;
  const chg1 = prev && prev[1] !== 0 ? last[1] / prev[1] - 1 : null;
  const back = n >= 22 ? points[n - 22] : null;
  const chg21 = back && back[1] !== 0 ? last[1] / back[1] - 1 : null;
  let rv21 = null;
  if (n >= 22) {
    const win = points.slice(n - 22).map((p) => p[1]);
    if (win.every((v) => v > 0)) {
      const r = [];
      for (let i = 1; i < win.length; i++) r.push(Math.log(win[i] / win[i - 1]));
      const sd = sampleSd(r);
      rv21 = sd === null ? null : sd * Math.sqrt(year);
    }
  }
  return { last, prev, chg1, chg21, rv21, ...(chg21 === null || rv21 === null ? { short: n < 22 } : {}) };
}

export function periodic(sr, { daily }) {
  if (sr.status !== "ok") return { status: "withheld", why: sr.why, unit: sr.unit, interval: sr.interval };
  const p = sr.points;
  const n = p.length;
  const last = p[n - 1];
  const prev = n >= 2 ? p[n - 2] : null;
  const change = prev && prev[1] !== 0 ? last[1] / prev[1] - 1 : null;
  const base = { status: "ok", unit: sr.unit, interval: sr.interval, last, prev };
  if (daily && sr.interval === "daily") return { ...base, chg1: change, spark: p.slice(-63) };
  return { ...base, chgPrev: change, spark: p.slice(-24) };
}

export function curve(seriesByMaturity) {
  const rows = [];
  let unitBad = false;
  for (const m of MATURITIES) {
    const sr = seriesByMaturity[m];
    if (!sr || sr.status === "withheld" && sr.why === "unit") { if (sr && sr.why === "unit") unitBad = true; continue; }
    if (sr.status !== "ok") continue;
    if (!/percent/i.test(sr.unit || "")) { unitBad = true; continue; }
    const p = sr.points;
    const at = (back) => (p.length > back ? p[p.length - 1 - back] : null);
    const last = p[p.length - 1];
    const m1 = at(21);
    const y1 = at(252);
    rows.push([m, last[1], last[0], m1 ? m1[1] : null, m1 ? m1[0] : null, y1 ? y1[1] : null, y1 ? y1[0] : null]);
  }
  if (unitBad) return { status: "withheld", why: "unit", unit: null, curve: [], spreads: { s2s10: null, s3m10: null, state: null } };
  if (!rows.length) return { status: "withheld", why: "empty", unit: "percent", curve: [], spreads: { s2s10: null, s3m10: null, state: null } };
  const by = Object.fromEntries(rows.map((r) => [r[0], r]));
  const spread = (a, b) => (by[a] && by[b] && by[a][2] === by[b][2] ? (by[b][1] - by[a][1]) * 100 : null);
  const s2s10 = spread("2year", "10year");
  const s3m10 = spread("3month", "10year");
  const state = s2s10 === null ? null : s2s10 < -RATE_FLAT_BP ? "inverted" : s2s10 > RATE_FLAT_BP ? "normal" : "flat";
  return { status: "ok", unit: "percent", curve: rows, spreads: { s2s10, s3m10, state } };
}

export function brentWti(wti, brent) {
  if (!wti || !brent || wti.status !== "ok" || brent.status !== "ok") return null;
  const w = new Map(wti.points);
  for (let i = brent.points.length - 1; i >= 0; i--) {
    const [d, v] = brent.points[i];
    if (w.has(d)) return { date: d, value: v - w.get(d), unit: brent.unit };
  }
  return null;
}

export function dollarBreadth(stats) {
  let up = 0;
  let n = 0;
  for (const p of FX_PAIRS) {
    if (p === "USDTRY") continue;
    const s = stats[p];
    if (!s || s.chg1 === null || s.chg1 === undefined) continue;
    n++;
    const dollarUp = p.startsWith("USD") ? s.chg1 > 0 : s.chg1 < 0;
    if (dollarUp) up++;
  }
  return n >= 5 ? { up, n } : null;
}

export function parseContract(sym, product, session) {
  if (typeof sym !== "string" || typeof product !== "string") return null;
  const m = new RegExp("^(" + product.replace(/[^A-Z0-9]/g, "") + ")([" + MONTH_CODES + "])(\\d{1,2})$").exec(sym);
  if (!m || !Object.hasOwn(PRODUCTS, product)) return null;
  const sy = +String(session).slice(0, 4);
  const sm = +String(session).slice(5, 7);
  const mi = MONTH_CODES.indexOf(m[2]);
  let y;
  if (m[3].length === 2) y = 2000 + +m[3];
  else {
    const d = +m[3];
    y = null;
    for (let c = sy; c <= sy + 9; c++) if (c % 10 === d) { y = c; break; }
  }
  if (y === null) return null;
  if (y < sy || (y === sy && mi + 1 < sm)) return null;
  return { sym, product, y, m: mi + 1, label: MONTH_NAMES[mi] + " " + String(y).slice(2) };
}

export function frontOf(contracts, product, session) {
  let best = null;
  for (const c of Array.isArray(contracts) ? contracts : []) {
    if (!c || c.product !== product || c.is_spread !== false) continue;
    const p = parseContract(c.name, product, session);
    if (!p) continue;
    const volume = int(c.volume);
    if (volume === null) continue;
    if (!best || volume > best.volume || (volume === best.volume && p.y * 12 + p.m < best.y * 12 + best.m)) best = { ...p, volume, trades: int(c.trades) };
  }
  return best;
}

export function nearest(contracts, product, session, count = 6) {
  const out = [];
  for (const c of Array.isArray(contracts) ? contracts : []) {
    if (!c || c.product !== product || c.is_spread !== false) continue;
    const p = parseContract(c.name, product, session);
    if (p) out.push(p);
  }
  out.sort((a, b) => a.y * 12 + a.m - (b.y * 12 + b.m));
  const seen = new Set();
  return out.filter((p) => (seen.has(p.sym) ? false : (seen.add(p.sym), true))).slice(0, count);
}

export function curveOf(contracts, statsBySym, product, session) {
  const prevDay = previousSession(session);
  const points = [];
  for (const c of contracts) {
    const raw = statsBySym[c.sym];
    const s = raw ? unwrap(raw) : null;
    if (!s || typeof s !== "object") continue;
    const settlement = num(s.settlement);
    const settleDate = dateOf(s.settlement_date);
    if (settlement === null || settleDate === null) continue;
    const stale = settleDate !== session && settleDate !== prevDay;
    points.push([c.sym, c.label, settlement, settleDate, int(s.open_interest), int(s.session_volume), stale]);
  }
  if (points.length < 2) return { status: points.length ? "ok" : "withheld", ...(points.length ? {} : { why: "empty" }), points, spread12: null, state: null, ...(points.length ? { why: "few" } : {}) };
  const first = points[0];
  const second = points[1];
  const spread12 = first[3] === second[3] && first[2] !== 0 ? second[2] / first[2] - 1 : null;
  const state = spread12 === null ? null : spread12 > 0 ? "contango" : spread12 < 0 ? "backwardation" : "flat";
  return { status: "ok", points, spread12, ...(spread12 === null ? { dates: [first[3], second[3]] } : {}), state };
}

export function largePrints(rowsList) {
  const byProduct = {};
  const top = [];
  let from = null;
  let to = null;
  for (const raw of rowsList) {
    const rows = unwrap(raw);
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || typeof r !== "object") continue;
      const p = r.product;
      if (!Object.hasOwn(LARGE, p)) continue;
      const size = int(r.size);
      const price = num(r.price);
      const at = instantOf(r.executed_at);
      if (size === null || size < LARGE[p] || price === null || at === null) continue;
      const slot = byProduct[p] || (byProduct[p] = { buy: [0, 0], sell: [0, 0], none: [0, 0], crossed: [0, 0] });
      const iso = new Date(at).toISOString();
      if (from === null || iso < from) from = iso;
      if (to === null || iso > to) to = iso;
      const key = r.crossed === true ? "crossed" : r.side === "buy" ? "buy" : r.side === "sell" ? "sell" : "none";
      slot[key][0]++;
      slot[key][1] += size;
      top.push([iso, p, typeof r.sym === "string" ? r.sym : null, key === "crossed" ? "none" : key, size, price]);
    }
  }
  top.sort((a, b) => b[4] - a[4] || (a[0] < b[0] ? 1 : -1));
  return { window: from && to ? [from, to] : null, byProduct, top: top.slice(0, 20) };
}

export function cryptoCheck(digital, ohlc) {
  if (!digital || !ohlc || digital.status !== "ok") return { v: "nc", gap: null, date: null };
  const rows = unwrap(ohlc);
  const m = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const t = instantOf(r.start_time || r.timestamp);
    const c = num(r.close);
    if (t === null || c === null) continue;
    m.set(new Date(t).toISOString().slice(0, 10), c);
  }
  for (let i = digital.points.length - 1; i >= 0; i--) {
    const [d, v] = digital.points[i];
    if (m.has(d) && m.get(d) !== 0) {
      const gap = Math.abs(v / m.get(d) - 1);
      return { v: gap <= 0.005 ? "agree" : "differs", gap, date: d };
    }
  }
  return { v: "nc", gap: null, date: null };
}

export function percentUnit(rows) {
  let frac = 0;
  let pct = 0;
  let n = 0;
  for (const r of rows) {
    const change = num(r.change);
    const price = num(r.price);
    const cp = num(r.change_percent);
    if (change === null || price === null || cp === null || price - change === 0) continue;
    const ratio = change / (price - change);
    n++;
    if (Math.abs(cp - ratio) <= 1e-3) frac++;
    if (Math.abs(cp / 100 - ratio) <= 1e-3) pct++;
  }
  if (n < 3) return null;
  if (frac === n) return "fraction";
  if (pct === n) return "percent";
  return null;
}

export function moversOf(raw) {
  const body = unwrap(raw);
  if (!body || typeof body !== "object") return { status: "withheld", why: "shape" };
  const lists = { gainers: body.top_gainers, losers: body.top_losers, active: body.most_active };
  const all = [].concat(...Object.values(lists).map((l) => (Array.isArray(l) ? l : [])));
  if (!all.length) return { status: "withheld", why: "empty" };
  const unit = percentUnit(all);
  const asOfRaw = typeof body.last_updated === "string" ? body.last_updated : null;
  const asOf = asOfRaw ? zonedInstant(asOfRaw, null).at : null;
  const shape = (l) => (Array.isArray(l) ? l : []).slice(0, 5).map((r) => {
    const t = typeof r.ticker === "string" ? r.ticker : null;
    const cp = num(r.change_percent);
    const pct = unit === null || cp === null ? null : unit === "fraction" ? cp : cp / 100;
    return [t, num(r.price), pct, int(r.volume)];
  }).filter((r) => r[0]);
  return { status: "ok", asOf, unit: unit || "unknown", ...(unit === null ? { why: "unit" } : {}), gainers: shape(lists.gainers), losers: shape(lists.losers), active: shape(lists.active) };
}

export function monthRows(yearMonthRaw, month, sessionYear) {
  const rows = unwrap(yearMonthRaw);
  const out = [];
  let fraction = 0;
  let percent = 0;
  let tested = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const m = int(r.month);
    const y = int(r.year);
    if (m !== month || y === null || y >= sessionYear) continue;
    const open = num(r.open);
    const close = num(r.close);
    if (open === null || close === null || open <= 0) continue;
    const change = close / open - 1;
    out.push(change);
    const fc = num(r.change);
    if (fc !== null) {
      tested++;
      if (Math.abs(fc - change) <= 1e-3) fraction++;
      if (Math.abs(fc / 100 - change) <= 1e-3) percent++;
    }
  }
  const unit = !tested ? "none" : fraction === tested ? "fraction" : percent === tested ? "percent" : "mixed";
  return { changes: out, unit };
}

export function seasonCell(changes) {
  const n = changes.length;
  if (n < SEASON_MIN_YEARS) return { few: true, n };
  const k = changes.filter((c) => c > 0).length;
  const share = k / n;
  const w = wilson(share, n);
  const ci = meanCi(changes);
  if (!w || !ci) return { few: true, n };
  return { n, k, share, lo: w[0], hi: w[1], mean: ci.mean, meanLo: ci.lo, meanHi: ci.hi, median: median(changes), coin: w[0] <= 0.5 && 0.5 <= w[1], zero: ci.lo <= 0 && 0 <= ci.hi };
}

function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i);
  return s;
}

export function binomialUpper(k, n) {
  let p = 0;
  for (let j = k; j <= n; j++) p += Math.exp(logChoose(n, j) - n * Math.LN2);
  return Math.min(1, p);
}

export function performersTable(raw, keep = 10) {
  const body = unwrap(raw);
  const rows = Array.isArray(body) ? body : [];
  const items = [];
  for (const r of rows) {
    if (!r || typeof r.ticker !== "string") continue;
    const n = int(r.years);
    const k = int(r.positive_closes);
    if (n === null || k === null || k > n || n === 0) continue;
    const w = wilson(k / n, n);
    if (!w) continue;
    items.push({ t: r.ticker, sector: typeof r.sector === "string" ? text(r.sector, 40) : null, n, k, lo: w[0], hi: w[1], p: binomialUpper(k, n) });
  }
  if (!items.length) return { tested: 0, survive: 0, rows: [] };
  const bh = benjaminiHochberg(items.map((i) => i.p), 0.1);
  items.forEach((it, i) => { it.q = bh.adjusted[i]; it.ok = bh.reject[i]; });
  const survive = items.filter((i) => i.ok).length;
  items.sort((a, b) => b.lo - a.lo || (a.t < b.t ? -1 : 1));
  return { tested: items.length, survive, rows: items.slice(0, keep).map((i) => [i.t, i.sector, i.n, i.k, i.lo, i.hi, i.q]) };
}

export function candidates({ unusual, smart, whales, insiders }) {
  const map = new Map();
  const add = (id, question, outcome, resolves, price, volume, finance) => {
    if (typeof id !== "string" || !id || !finance) return;
    const q = text(question, 140);
    const at = instantOf(resolves);
    const p = num(price);
    if (!q || at === null || p === null) return;
    if (p < 0 || p > 1) return;
    if (!map.has(id)) map.set(id, { id, question: q, outcome: typeof outcome === "string" ? text(outcome, 40) : null, resolves: new Date(at).toISOString(), price: p, volume: num(volume) });
  };
  const inner = (raw) => { const b = unwrap(raw); return b && !Array.isArray(b) && Array.isArray(b.data) ? b.data : Array.isArray(b) ? b : []; };
  for (const r of inner(unusual)) add(r && r.asset_id, r && r.market, r && r.outcome, r && r.resolves, r && r.current, r && r.volume, true);
  for (const r of inner(smart)) {
    if (!r) continue;
    for (const o of Array.isArray(r.outcomes) ? r.outcomes : []) add(o && o.asset_id, r.title, o && o.label, r.resolves, o && o.price, null, true);
  }
  for (const r of inner(whales)) add(r && r.asset_id, r && r.question, r && r.outcome, r && r.resolves, r && r.current_price, null, r && r.category === "Finance");
  for (const r of inner(insiders)) add(r && r.asset_id, r && r.question, r && r.outcome, r && r.resolves, r && r.current_price, null, r && r.category === "Finance");
  return [...map.values()];
}

export function matchOdds(calendarRows, cands) {
  const taken = new Set();
  const rows = (Array.isArray(calendarRows) ? calendarRows : []).filter((r) => r && r.tag && ODDS_TAGS[r.tag]);
  const claim = new Map();
  for (const c of cands) {
    let best = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const at = instantOf(r.at);
      const rs = instantOf(c.resolves);
      if (at === null || rs === null || !ODDS_TAGS[r.tag].test(c.question)) continue;
      if (rs < at - ODDS_WINDOW.beforeMs || rs > at + ODDS_WINDOW.afterMs) continue;
      const d = Math.abs(rs - at);
      if (!best || d < best.d) best = { i, d };
    }
    if (best) {
      const list = claim.get(best.i) || [];
      list.push(c);
      claim.set(best.i, list);
      taken.add(c.id);
    }
  }
  const events = [];
  let total = 0;
  rows.forEach((r, i) => {
    const list = (claim.get(i) || []).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, ODDS_MAX_PER_ROW);
    const room = ODDS_MAX_TOTAL - total;
    const use = list.slice(0, Math.max(0, room));
    total += use.length;
    events.push({ at: r.at, event: r.event, tag: r.tag, markets: use });
  });
  const kept = new Set(events.flatMap((e) => e.markets.map((m) => m.id)));
  const unmatched = cands.filter((c) => !taken.has(c.id) && Object.entries(ODDS_TAGS).some(([, re]) => re.test(c.question))).slice(0, ODDS_MAX_UNMATCHED).map((c) => ({ id: c.id, question: c.question, outcome: c.outcome, price: c.price, resolves: c.resolves, tag: Object.entries(ODDS_TAGS).find(([, re]) => re.test(c.question))[0] }));
  return { events, unmatched, kept };
}

export function topHolderIds(positionsRaw, count = 3) {
  const rows = unwrap(positionsRaw);
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({ a: r && r.user_address, v: num(r && r.invested_usd) })).filter((r) => typeof r.a === "string" && r.v !== null);
  list.sort((a, b) => b.v - a.v);
  return list.slice(0, count).map((r) => r.a);
}

export function oddsMarket(candidate, detail, liquidity, positions, holders) {
  const d = unwrap(detail);
  const liq = unwrap(liquidity);
  const closed = !!d && (d.closed === true || d.active === false);
  const asset = d && Array.isArray(d.outcome_assets) ? d.outcome_assets.find((a) => a && a.asset_id === candidate.id) : null;
  const prices = asset && Array.isArray(asset.prices) ? asset.prices.map((p) => [dateOf(p && p.date), num(p && p.price)]).filter((p) => p[0] && p[1] !== null) : [];
  const bid = liq ? num(liq.best_bid) : null;
  const ask = liq ? num(liq.best_ask) : null;
  const mid = liq ? num(liq.mid_price) : null;
  const spread = liq ? num(liq.spread) : null;
  const liquidityUsd = liq ? num(liq.total_liquidity) : null;
  const twoSided = bid !== null && ask !== null && mid !== null && spread !== null && spread <= ODDS_THIN.spread;
  const lastPrice = prices.length ? prices[prices.length - 1][1] : candidate.price;
  const price = twoSided && !closed ? mid : lastPrice;
  const basis = twoSided && !closed ? "mid" : "last";
  const thin = liquidityUsd === null || liquidityUsd < ODDS_THIN.liquidityUsd || spread === null || spread > ODDS_THIN.spread;
  const pos = (() => {
    const rows = unwrap(positions);
    const list = (Array.isArray(rows) ? rows : []).map((r) => ({ v: num(r && r.invested_usd), bot: Array.isArray(r && r.tags) && r.tags.includes("bot") })).filter((r) => r.v !== null && r.v > 0);
    if (list.length < 10) return { top5Share: null, botShare: null, few: true };
    const sum = list.reduce((a, r) => a + r.v, 0);
    const sorted = list.slice().sort((a, b) => b.v - a.v);
    const top5 = sorted.slice(0, 5).reduce((a, r) => a + r.v, 0);
    const bots = list.filter((r) => r.bot).reduce((a, r) => a + r.v, 0);
    return { top5Share: sum ? top5 / sum : null, botShare: sum ? bots / sum : null, few: false };
  })();
  const category = d && typeof d.category === "string" ? d.category : "Finance";
  const wins = [];
  for (const h of Array.isArray(holders) ? holders : []) {
    const body = unwrap(h);
    const row = body && Array.isArray(body.category_scores) ? body.category_scores.find((c) => c && c.category === category) : null;
    const w = row ? num(row.win_rate) : null;
    if (w !== null) wins.push(w);
  }
  return {
    id: candidate.id,
    question: candidate.question,
    outcome: asset && typeof asset.label === "string" ? text(asset.label, 40) : candidate.outcome,
    price,
    basis,
    bid,
    ask,
    spread,
    liquidity: liquidityUsd,
    volume: d ? num(d.volume) : candidate.volume,
    thin,
    resolved: closed,
    resolves: candidate.resolves,
    top5Share: pos.top5Share,
    botShare: pos.botShare,
    holders: wins.length ? { median: median(wins), n: wins.length } : null,
    history: prices.slice(-30).map((p) => [p[0], p[1]]),
  };
}

const spark = (points, n = 63) => points.slice(-n);

export function buildMacro(input, { test = false } = {}) {
  const session = input.session;
  const ops = {};
  const note = (op, status, n, why) => { const o = ops[op] || (ops[op] = { status: "ok", n: 0 }); o.n += n || 0; if (status !== "ok") { o.status = status; if (why) o.why = why; } };
  const lost = (res) => ({ status: res && res.status && res.status !== "ok" ? res.status : "failed", why: res && res.why ? res.why : "failed" });
  const filed = (op, res) => {
    if (!res) { note(op, "failed", 0, "missing"); return null; }
    if (res.status && res.status !== "ok") { note(op, res.status, 0, res.why); return null; }
    note(op, "ok", 1);
    return res.body;
  };

  const treasury = {};
  for (const m of MATURITIES) {
    const body = filed("economy", input.treasury && input.treasury[m]);
    treasury[m] = body ? seriesOf(body) : { ...lost(input.treasury && input.treasury[m]), points: [] };
  }
  const rates = curve(treasury);
  const ff = (() => {
    const body = filed("economy", input.treasury && input.treasury["fed-funds"]);
    const s = body ? seriesOf(body) : null;
    return s && s.status === "ok" ? [s.points[s.points.length - 1][1], s.points[s.points.length - 1][0]] : null;
  })();
  rates.fedFunds = ff;

  const economy = {};
  for (const ind of INDICATORS) {
    const body = filed("economy", input.economy && input.economy[ind]);
    if (!body) { economy[ind] = lost(input.economy && input.economy[ind]); continue; }
    const s = seriesOf(body);
    const p = periodic(s, { daily: false });
    if (p.status === "ok") {
      const ageDays = Math.round((Date.parse(session + "T00:00:00Z") - Date.parse(p.last[0] + "T00:00:00Z")) / 864e5);
      economy[ind] = { ...p, ageDays };
    } else economy[ind] = p;
  }

  const commodities = {};
  const cseries = {};
  for (const name of [...DAILY_COMMODITIES, ...MONTHLY_COMMODITIES]) {
    const body = filed("commodity", input.commodities && input.commodities[name]);
    if (!body) { commodities[name] = lost(input.commodities && input.commodities[name]); continue; }
    const s = seriesOf(body);
    cseries[name] = s;
    commodities[name] = periodic(s, { daily: DAILY_COMMODITIES.includes(name) });
  }
  commodities.brentWti = brentWti(cseries.wti, cseries.brent);

  const fxStats = {};
  const pairs = {};
  for (const pair of FX_PAIRS) {
    const body = filed("fx-history", input.fx && input.fx[pair]);
    if (!body) { pairs[pair] = lost(input.fx && input.fx[pair]); continue; }
    const b = barsOf(body);
    if (b.status !== "ok") { pairs[pair] = { status: "withheld", why: b.why }; continue; }
    const st = dailyStats(b.points, { year: 252 });
    fxStats[pair] = st;
    pairs[pair] = { status: "ok", last: st.last, chg1: st.chg1, chg21: st.chg21, rv21: st.rv21, spark: spark(b.points), ...(b.zone && b.zone !== "UTC" && b.timed.some((t) => t[3] === "zone") ? { zone: "withheld" } : {}) };
  }
  const breadth = dollarBreadth(fxStats);
  const fx = { pairs, breadth, ...(breadth ? {} : { breadthWhy: "few" }) };

  const crypto = {};
  for (const sym of CRYPTO) {
    const hist = filed("digital-history", input.digital && input.digital[sym]);
    const ohlc = filed("crypto-ohlc", input.cryptoOhlc && input.cryptoOhlc[sym]);
    if (!hist) { crypto[sym] = lost(input.digital && input.digital[sym]); continue; }
    const b = barsOf(hist);
    if (b.status !== "ok") { crypto[sym] = { status: "withheld", why: b.why }; continue; }
    const st = dailyStats(b.points, { year: 365 });
    crypto[sym] = { status: "ok", last: st.last, chg1: st.chg1, chg21: st.chg21, rv21: st.rv21, spark: spark(b.points), check: cryptoCheck(b, ohlc) };
  }

  const contractsBody = filed("futures-contracts", input.futuresContracts);
  const contractRows = Array.isArray(unwrap(contractsBody)) ? unwrap(contractsBody) : [];
  const products = {};
  for (const p of Object.keys(PRODUCTS)) {
    const front = contractsBody ? frontOf(contractRows, p, session) : null;
    if (!front) { products[p] = { status: contractsBody ? "withheld" : "failed", why: contractsBody ? "symbol" : "failed" }; continue; }
    const candles = input.futuresCandles && input.futuresCandles[p];
    const body = filed("futures-candles", candles && candles.res);
    const pts = body && Array.isArray(unwrap(body)) ? unwrap(body).map((c) => [dateOf(c && c.date), num(c && c.c)]).filter((c) => c[0] && c[1] !== null).sort((a, b) => (a[0] < b[0] ? -1 : 1)) : [];
    const st = pts.length ? dailyStats(pts, { year: 252 }) : null;
    products[p] = { status: st ? "ok" : "withheld", ...(st ? {} : { why: "empty" }), sym: front.sym, label: front.label, volume: front.volume, trades: front.trades, last: st ? st.last : null, chg1: st ? st.chg1 : null, rv21: st ? st.rv21 : null, spark: spark(pts) };
  }
  const curves = {};
  for (const p of CURVE_PRODUCTS) {
    const list = contractsBody ? nearest(contractRows, p, session) : [];
    const stats = {};
    for (const c of list) {
      const body = filed("futures-stats", input.futuresStats && input.futuresStats[c.sym]);
      if (body) stats[c.sym] = body;
    }
    curves[p] = list.length ? curveOf(list, stats, p, session) : { status: "withheld", why: "symbol", points: [], spread12: null, state: null };
  }
  const flowBodies = (input.futuresFlow || []).map((r, i) => filed("futures-flow", r)).filter(Boolean);
  const large = largePrints(flowBodies);
  const futures = { asOf: session, products, curves, large };

  const movers = (() => {
    const body = filed("market-movers", input.movers);
    return body ? moversOf(body) : lost(input.movers);
  })();

  const sy = +session.slice(0, 4);
  const sm = +session.slice(5, 7);
  const nextM = sm === 12 ? 1 : sm + 1;
  const season = { month: sm, next: nextM, funds: { this: [], next: [] }, performers: { this: { tested: 0, survive: 0, rows: [] }, next: { tested: 0, survive: 0, rows: [] } }, checks: {} };
  for (const t of SEASON_FUNDS) {
    const body = filed("seasonality-year-month", input.seasonYearMonth && input.seasonYearMonth[t]);
    if (!body) continue;
    for (const [slot, month] of [["this", sm], ["next", nextM]]) {
      const { changes } = monthRows(body, month, sy);
      const c = seasonCell(changes);
      season.funds[slot].push(c.few ? [t, c.n, null, null, null, null, null, null, null] : [t, c.n, c.k, c.lo, c.hi, c.mean, c.meanLo, c.meanHi, c.median]);
    }
  }
  for (const t of SEASON_CHECK) {
    const monthly = filed("seasonality-monthly", input.seasonMonthly && input.seasonMonthly[t]);
    const ym = input.seasonYearMonth && input.seasonYearMonth[t] && input.seasonYearMonth[t].body;
    if (!monthly || !ym) continue;
    const row = (Array.isArray(unwrap(monthly)) ? unwrap(monthly) : []).find((r) => r && int(r.month) === sm);
    const mine = monthRows(ym, sm, sy);
    if (row) season.checks[t] = { feedYears: int(row.years), years: mine.changes.length, feedPositive: int(row.positive_closes), positive: mine.changes.filter((c) => c > 0).length, unit: mine.unit };
  }
  for (const [slot, key] of [["this", "performersThis"], ["next", "performersNext"]]) {
    const body = filed("seasonality-performers", input[key]);
    if (body) season.performers[slot] = performersTable(body);
  }

  const cal = Array.isArray(input.calendar) ? input.calendar : [];
  const preds = input.predictions || {};
  const un = filed("pred-unusual", preds.unusual);
  const sm2 = filed("pred-smart-money", preds.smart);
  const wh = filed("pred-whales", preds.whales);
  const ins = filed("pred-insiders", preds.insiders);
  const cands = candidates({ unusual: un, smart: sm2, whales: wh, insiders: ins });
  const matched = matchOdds(cal, cands);
  const details = preds.details || {};
  const events = matched.events.map((e) => ({
    at: e.at, event: e.event, tag: e.tag,
    markets: e.markets.map((c) => {
      const d = details[c.id] || {};
      const detail = filed("pred-market", d.market);
      const liq = filed("pred-liquidity", d.liquidity);
      const pos = filed("pred-positions", d.positions);
      const holders = (d.holders || []).map((h) => filed("pred-user", h)).filter(Boolean);
      return oddsMarket(c, detail, liq, pos, holders);
    }),
  }));
  const oddsOk = un || sm2 || wh || ins;
  const odds = {
    status: oddsOk ? "ok" : "failed", ...(oddsOk ? {} : { why: "failed" }),
    events,
    unmatched: matched.unmatched,
    counts: { candidates: cands.length, finance: cands.length, matched: matched.kept.size, thin: events.reduce((a, e) => a + e.markets.filter((m) => m.thin).length, 0) },
  };

  const payload = {
    v: 1, session, generatedAt: input.generatedAt || new Date().toISOString(),
    ...(test ? { fixture: true } : {}),
    rates, economy, commodities, fx, crypto, futures, movers,
    seasonality: season, odds,
    basis: { ops, calls: Object.values(ops).reduce((a, o) => a + o.n, 0) },
  };
  const bad = fixtureNameIn(JSON.stringify(payload));
  if (bad && !test) throw new Error("fixture name " + bad);
  return payload;
}

const bytes = (o) => new TextEncoder().encode(JSON.stringify(o)).length;

export function fitMacro(payload, cap = MACRO_CAP_BYTES) {
  const p = JSON.parse(JSON.stringify(payload));
  const shed = [];
  const steps = [
    ["futures.large", (x) => { if (x.futures && x.futures.large) { x.futures.large.top = []; x.futures.large.byProduct = {}; } }],
    ["odds.unmatched", (x) => { if (x.odds) x.odds.unmatched = []; }],
    ["seasonality.performers.next", (x) => { if (x.seasonality) x.seasonality.performers.next = { tested: 0, survive: 0, rows: [] }; }],
    ["spark", (x) => {
      const cut = (o) => { if (o && Array.isArray(o.spark)) o.spark = o.spark.slice(-21); };
      Object.values(x.economy || {}).forEach(cut);
      Object.values(x.commodities || {}).forEach(cut);
      Object.values((x.fx || {}).pairs || {}).forEach(cut);
      Object.values(x.crypto || {}).forEach(cut);
      Object.values((x.futures || {}).products || {}).forEach(cut);
    }],
    ["odds.history", (x) => { for (const e of (x.odds && x.odds.events) || []) for (const m of e.markets) m.history = []; }],
  ];
  for (const [name, fn] of steps) {
    if (bytes(p) <= cap) break;
    fn(p);
    shed.push(name);
  }
  return { payload: p, shed, bytes: bytes(p), fits: bytes(p) <= cap };
}

export function addressFree(value) {
  const s = JSON.stringify(value);
  if (/0x[0-9a-fA-F]{40}/.test(s) || /\b[0-9a-fA-F]{64}\b/.test(s)) return false;
  for (const k of ADDRESS_KEYS) if (s.includes('"' + k + '"')) return false;
  return true;
}

export { COPY };
