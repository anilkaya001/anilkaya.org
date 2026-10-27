import { unwrap } from "./flows-vendor-core.js";
import { forwardDelta, normPdf } from "./flows-quant-bs.js";
import { median } from "./flows-stats.js";
import { sessionsBetween } from "./flows-calendar.js";
import { fixtureNameIn } from "./flows-fixture-names.js";
import { opById } from "./flows-vendor-ops.js";
import { sliceFromSummary, sliceVolK } from "./flows-quant-read.js";

export const VOLDESK_VERSION = 1;

export const TERM_FLAT_PTS = 0.5;

export const VOLDESK_CAP = 65536;

export const STANCE_CAP = 98304;

export const VA_CAP = 2048;

export const STANCE_RING = 14;

export const STANCE_DTE = 14;

export const STANCE_TOP = 3;

export const CHARACTER_LIMIT = 50;

export const MOVER_RATIO = 1.3;

export const MOVER_CAP = 12;

export const SECTOR_PAIRS_MIN = 40;

export const AUDIT_STRIKES = 5;

export const AUDIT_MIN_STRIKES = 3;

export const AUDIT_TARGET_DTE = 30;

export const AUDIT_MIN_DTE = 7;

export const AUDIT_KEEP_SESSIONS = 5;

export const VOLAUDIT_CAP = 36;

export const VOLAUDIT_CAP_MAX = 120;

export const AUDIT_CALLS_PER_NAME = 8;

export const MARKET_CALLS = 17;

export const FUND_TICKERS = Object.freeze(["SPY", "QQQ", "IWM", "DIA"]);

export const CORR_TICKERS = Object.freeze(["SPY", "QQQ", "IWM", "DIA", "XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLB", "XLU", "XLRE"]);

export const CORR_WINDOWS = Object.freeze(["3M", "1Y"]);

export const XCHECK_TOL = Object.freeze({
  delta: 0.03, ivPts: 1.5, gammaRel: 0.15, gammaFloor: 1e-4,
  oiRel: 0.01, dexRel: 0.05, gexRel: 0.10, spotRel: 0.0025, unitBand: 1.15,
});

export const EXPOSURE_SIGN_KNOWN = false;

export const ROW_IDS = Object.freeze(["spot", "delta", "iv", "gamma", "oiExpiry", "oiAll", "dexExpiry", "gexAll", "chainSelf"]);

export const ROW_OPS = Object.freeze({
  spot: "atm-chains", delta: "greeks", iv: "greeks", gamma: "greeks", oiExpiry: "oi-per-expiry", oiAll: "volume-oi-expiry",
  dexExpiry: "greek-exposure-strike-expiry", gexAll: "greek-exposure-strike", chainSelf: "option-chains",
});

export const NC_REASONS = Object.freeze(["engine", "strikes", "date", "partial chain", "units", "absent", "failed", "plan", "limited", "few"]);

export const WITHHELD = Object.freeze([
  Object.freeze({ field: "greeks.*_theta, *_vega, *_rho, *_charm, *_vanna", reason: "The feed does not state the unit." }),
  Object.freeze({ field: "greeks.call_gamma, put_gamma", reason: "The feed does not state gamma's unit." }),
  Object.freeze({ field: "greek-exposure.call_gex, put_gex", reason: "The feed does not state gamma's unit." }),
  Object.freeze({ field: "greek-exposure.*_charm, *_vanna", reason: "The feed does not state the unit." }),
  Object.freeze({ field: "vol-stats.iv_rank", reason: "The feed does not say whether this is a fraction or a percent." }),
  Object.freeze({ field: "vol-stats.rv_high, rv_low", reason: "The feed describes this as an implied volatility." }),
]);

export const NEVER_READ = Object.freeze({
  greeks: Object.freeze(["call_rho", "put_rho", "call_theta", "put_theta", "call_vega", "put_vega", "call_charm", "put_charm", "call_vanna", "put_vanna"]),
  exposure: Object.freeze(["call_charm", "put_charm", "call_vanna", "put_vanna"]),
  stats: Object.freeze(["iv_rank", "rv_high", "rv_low"]),
  stance: Object.freeze(["components", "explanation", "roc", "premium", "avg_price", "rank_metric", "disclaimer"]),
});

export const SHAPE = Object.freeze({
  "vix-term": Object.freeze({ root: "object", latest: "data.latest", history: "data.history[]", rows: "data.latest[]" }),
  "vol-character-top": Object.freeze({ root: "array", rows: "data[]" }),
});

const VIX_PATH = opById("vix-term").op;
const CHAR_PATH = opById("vol-character-top").op;

const VIX_KEYS = Object.freeze({
  maturity: Object.freeze(["expiry", "expiration", "settle_date", "date"]),
  price: Object.freeze(["price", "close", "settle", "last"]),
  spot: Object.freeze(["vix", "spot", "index"]),
});

const CHAR_KEYS = Object.freeze(["ticker", "character", "half_life_days", "hurst_rv", "date"]);

const NUM_RE = /^-?\d+(\.\d+)?(e-?\d+)?$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fin = (v) => typeof v === "number" && Number.isFinite(v);

const r2 = (x) => Math.round(x * 1e2) / 1e2;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const keep = (x, f) => (fin(x) ? f(x) : null);
const sig5 = (x) => (x === 0 ? 0 : Number(x.toExponential(4)));

export function numOf(value, field) {
  if (value === null || value === undefined) return { v: null, why: "absent" };
  if (typeof value === "number") return Number.isFinite(value) ? { v: value } : { v: null, why: `type:${field}` };
  if (typeof value === "string" && NUM_RE.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? { v: n } : { v: null, why: `type:${field}` };
  }
  return { v: null, why: `type:${field}` };
}

export function intOf(value, field) {
  const got = numOf(value, field);
  if (got.v === null) return got;
  if (!Number.isSafeInteger(got.v) || got.v < 0) return { v: null, why: `type:${field}` };
  return got;
}

export function rangedOf(value, field, lo, hi, loOpen = false) {
  const got = numOf(value, field);
  if (got.v === null) return got;
  if (got.v > hi || got.v < lo || (loOpen && got.v === lo)) return { v: null, why: `range:${field}` };
  return got;
}

const deltaOf = (value) => rangedOf(value, "delta", -1, 1);
const volOf = (value, field = "iv") => rangedOf(value, field, 0, 5, true);

export function rowsOfBody(raw) {
  const body = unwrap(raw);
  return Array.isArray(body) ? body : null;
}

function feedRows(input) {
  if (Array.isArray(input)) return { rows: input };
  if (input && typeof input === "object" && typeof input.why === "string") return { rows: null, why: input.why };
  if (input === null || input === undefined) return { rows: null, why: "absent" };
  const rows = rowsOfBody(input);
  return rows ? { rows } : { rows: null, why: "absent" };
}

export function shapeKnown(opId, shapes) {
  const spec = SHAPE[opId];
  if (!spec) return { ok: false, keys: [], why: "op" };
  const ops = shapes && isObj(shapes.ops) ? shapes.ops : null;
  const path = opId === "vix-term" ? VIX_PATH : CHAR_PATH;
  const entry = ops && ops[path];
  if (!entry || !isObj(entry.sets)) return { ok: false, keys: [], why: "unseen" };
  const set = entry.sets[spec.rows];
  if (!isObj(set)) return { ok: false, keys: [], why: "keys" };
  return { ok: true, keys: Object.keys(set), set, why: null };
}

function pickKey(set, names, types) {
  for (const name of names) if (Object.hasOwn(set, name) && types.includes(set[name])) return name;
  return null;
}

const dayOf = (v) => (typeof v === "string" && DAY_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

function dayNumber(day) {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function futuresCurve(raw, shapes, session = null) {
  const blank = { points: [], spot: null, front: null, second: null, roll30: null };
  const known = shapeKnown("vix-term", shapes);
  if (!known.ok) return { status: "unshaped", why: known.why === "unseen" ? "unseen" : "keys", ...blank };
  const matKey = pickKey(known.set, VIX_KEYS.maturity, ["str", "str#", "num"]);
  const priceKey = pickKey(known.set, VIX_KEYS.price, ["str#", "num"]);
  if (!matKey || !priceKey) return { status: "unshaped", why: "keys", ...blank };
  const spotKey = pickKey(known.set, VIX_KEYS.spot, ["str#", "num"]);
  const body = unwrap(raw);
  const latest = isObj(body) ? body.latest : null;
  const rows = Array.isArray(latest) ? latest : null;
  if (!rows) return { status: "unshaped", why: "keys", ...blank };
  if (!session || !DAY_RE.test(session)) return { status: "failed", why: "session", ...blank };
  const origin = dayNumber(session);
  const byExpiry = new Map();
  let spot = null;
  let bad = null;
  for (const row of rows) {
    if (!isObj(row)) continue;
    const day = dayOf(row[matKey]);
    const price = numOf(row[priceKey], priceKey);
    if (!day) { bad = bad || `type:${matKey}`; continue; }
    if (price.v === null) { bad = bad || price.why; continue; }
    if (!(price.v > 0)) { bad = bad || `range:${priceKey}`; continue; }
    byExpiry.set(day, { expiry: day, days: dayNumber(day) - origin, price: price.v });
    if (spotKey && spot === null) {
      const s = numOf(row[spotKey], spotKey);
      if (s.v !== null && s.v > 0) spot = s.v;
    }
  }
  const points = [...byExpiry.values()].filter((p) => p.days >= 0).sort((a, b) => a.days - b.days);
  if (!points.length) return { status: "failed", why: bad || "empty", ...blank };
  const front = points[0];
  const second = points[1] || null;
  let roll30 = null;
  let rollWhy = null;
  if (!second) rollWhy = "one point";
  else if (!(second.days > front.days)) rollWhy = "equal days";
  else roll30 = (second.price / front.price - 1) * 30 / (second.days - front.days);
  return { status: "ok", points, spot, front, second, roll30, ...(rollWhy ? { rollWhy } : {}), ...(bad ? { partial: bad } : {}) };
}

export function interpolateIv(points, d) {
  const sorted = points.filter((p) => fin(p.dte) && fin(p.iv) && p.iv > 0 && p.dte > 0).sort((a, b) => a.dte - b.dte);
  if (sorted.length < 2) return null;
  if (d < sorted[0].dte || d > sorted[sorted.length - 1].dte) return null;
  let lo = sorted[0];
  let hi = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (d >= sorted[i].dte && d <= sorted[i + 1].dte) { lo = sorted[i]; hi = sorted[i + 1]; break; }
  }
  const wLo = lo.iv * lo.iv * lo.dte / 365;
  const wHi = hi.iv * hi.iv * hi.dte / 365;
  const w = hi.dte === lo.dte ? wLo : wLo + (wHi - wLo) * (d - lo.dte) / (hi.dte - lo.dte);
  return Math.sqrt(w / (d / 365));
}

export function termState(points) {
  const list = Array.isArray(points) ? points : [];
  const iv30 = interpolateIv(list, 30);
  const iv90 = interpolateIv(list, 90);
  if (iv30 === null || iv90 === null) return { iv30, iv90, slope: null, state: null, why: "edge" };
  const slope = Math.round((iv90 - iv30) * 100 * 1e9) / 1e9;
  const state = slope >= TERM_FLAT_PTS ? "contango" : slope <= -TERM_FLAT_PTS ? "backwardation" : "flat";
  return { iv30, iv90, slope, state, why: null };
}

export function termFund(rows, { session = null } = {}) {
  const feed = feedRows(rows);
  if (!feed.rows) return { status: feed.why === "plan" || feed.why === "failed" || feed.why === "limited" ? feed.why : "absent", why: feed.why, points: [], iv30: null, iv90: null, slope: null, state: null, asOf: null };
  const points = [];
  let asOf = null;
  let bad = null;
  for (const row of feed.rows) {
    if (!isObj(row)) continue;
    const dte = intOf(row.dte, "dte");
    const iv = volOf(row.volatility, "volatility");
    if (dte.v === null || iv.v === null) { bad = bad || dte.why || iv.why; continue; }
    if (dte.v < 1) continue;
    points.push({ dte: dte.v, iv: iv.v });
    const d = dayOf(row.date);
    if (d && (!asOf || d > asOf)) asOf = d;
  }
  const dedup = new Map(points.map((p) => [p.dte, p]));
  const clean = [...dedup.values()].sort((a, b) => a.dte - b.dte);
  if (clean.length < 2) return { status: "failed", why: bad || "few", points: [], iv30: null, iv90: null, slope: null, state: null, asOf };
  const t = termState(clean);
  return {
    status: t.state ? "ok" : "partial", ...(t.why ? { why: t.why } : {}),
    points: clean.map((p) => [p.dte, r6(p.iv)]),
    iv30: keep(t.iv30, r6), iv90: keep(t.iv90, r6), slope: keep(t.slope, r4), state: t.state, asOf: asOf || session,
  };
}

export function realizedRow(rows, session) {
  const feed = feedRows(rows);
  if (!feed.rows) return { status: feed.why === "plan" || feed.why === "failed" || feed.why === "limited" ? feed.why : "absent", why: feed.why };
  let best = null;
  let exact = null;
  for (const row of feed.rows) {
    if (!isObj(row)) continue;
    const d = dayOf(row.date);
    if (!d) continue;
    if (d === session) exact = row;
    if (d <= session && (!best || d > dayOf(best.date))) best = row;
  }
  const row = exact || best;
  if (!row) return { status: "absent", why: "date" };
  const d = dayOf(row.date);
  const iv = volOf(row.implied_volatility, "implied_volatility");
  const rv = volOf(row.realized_volatility, "realized_volatility");
  if (iv.v === null || rv.v === null) return { status: "failed", why: iv.why || rv.why };
  const gap = d === session ? 0 : sessionsBetween(d, session);
  const stale = gap === null ? true : gap > 1;
  return {
    status: "ok", iv: iv.v, rv: rv.v, spread: (iv.v - rv.v) * 100, asOf: d, stale,
  };
}

export function statsRow(raw) {
  const feed = feedRows(raw);
  const body = feed.rows ? feed.rows : (() => { const u = unwrap(raw); return isObj(u) ? [u] : null; })();
  if (!body || !body.length) return { status: feed.why === "plan" || feed.why === "failed" || feed.why === "limited" ? feed.why : "absent", why: feed.why || "absent" };
  const row = body[0];
  if (!isObj(row)) return { status: "failed", why: "type:row" };
  const iv = volOf(row.iv, "iv");
  const hi = volOf(row.iv_high, "iv_high");
  const lo = volOf(row.iv_low, "iv_low");
  const rv = volOf(row.rv, "rv");
  if (iv.v === null) return { status: "failed", why: iv.why };
  const place = hi.v !== null && lo.v !== null && hi.v > lo.v ? (iv.v - lo.v) / (hi.v - lo.v) : null;
  return { status: "ok", iv: iv.v, ivHigh: hi.v, ivLow: lo.v, rv: rv.v, ivPlace: place };
}

export function ivrvFund(realizedRaw, statsRaw, session) {
  const real = realizedRow(realizedRaw, session);
  const stats = statsRow(statsRaw);
  const out = { status: real.status, ...(real.why ? { why: real.why } : {}) };
  if (real.status === "ok") {
    Object.assign(out, { iv: r6(real.iv), rv: r6(real.rv), spread: r4(real.spread), asOf: real.asOf, stale: real.stale });
  } else Object.assign(out, { iv: null, rv: null, spread: null, asOf: null, stale: false });
  out.stats = stats.status === "ok"
    ? { iv: r6(stats.iv), ivHigh: keep(stats.ivHigh, r6), ivLow: keep(stats.ivLow, r6), rv: keep(stats.rv, r6), ivPlace: keep(stats.ivPlace, r4) }
    : { status: stats.status, why: stats.why || null };
  return out;
}

const SECTORS = CORR_TICKERS.slice(4);

export function corrMatrix(rows, tickers = CORR_TICKERS) {
  const feed = feedRows(rows);
  const n = tickers.length;
  const cells = [];
  const empty = { status: feed.rows ? "ok" : (feed.why === "plan" || feed.why === "failed" || feed.why === "limited" ? feed.why : "absent"), cells, minDate: null, maxDate: null, sectorAvg: null, sectorN: 0 };
  if (!feed.rows) return { ...empty, why: feed.why };
  const index = new Map(tickers.map((t, i) => [t, i]));
  const seen = new Map();
  const spans = new Map();
  for (const row of feed.rows) {
    if (!isObj(row)) continue;
    const a = index.get(row.fst);
    const b = index.get(row.snd);
    if (a === undefined || b === undefined || a === b) continue;
    const r = rangedOf(row.correlation, "correlation", -1, 1);
    const rows_ = intOf(row.rows, "rows");
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push({ r, rows: rows_, min: dayOf(row.min_date), max: dayOf(row.max_date) });
  }
  for (const entries of seen.values()) {
    const e = entries.find((x) => x.min && x.max);
    if (e) {
      const k = `${e.min}|${e.max}`;
      spans.set(k, (spans.get(k) || 0) + 1);
    }
  }
  let span = null;
  const ranked = [...spans.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  if (ranked.length) span = ranked[0][0];
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const entries = seen.get(`${i}:${j}`);
      let cell;
      if (!entries) cell = [null, null, "absent"];
      else {
        const good = entries.filter((x) => x.r.v !== null);
        if (!good.length) cell = [null, null, entries[0].r.why];
        else if (good.length > 1 && Math.abs(good[0].r.v - good[1].r.v) > 1e-9) cell = [null, null, "asym"];
        else cell = [r4(good[0].r.v), good[0].rows.v, ...(good[0].rows.v === null ? [good[0].rows.why] : [])];
      }
      cells.push(cell);
      grid.set(`${i}:${j}`, cell);
    }
  }
  const sec = [];
  for (let i = 4; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (!SECTORS.includes(tickers[i]) || !SECTORS.includes(tickers[j])) continue;
    const c = grid.get(`${i}:${j}`);
    if (c && c[0] !== null) sec.push(c[0]);
  }
  const sectorN = sec.length;
  const [minDate, maxDate] = span ? span.split("|") : [null, null];
  return {
    status: "ok", cells, minDate, maxDate,
    sectorAvg: sectorN >= SECTOR_PAIRS_MIN ? r4(sec.reduce((s, x) => s + x, 0) / sectorN) : null,
    sectorN, ...(sectorN >= SECTOR_PAIRS_MIN ? {} : { sectorWhy: "few" }),
  };
}

export function pairIndex(i, j, n) {
  const a = Math.min(i, j);
  const b = Math.max(i, j);
  return a * n - (a * (a + 1)) / 2 + (b - a - 1);
}

export function reduceCharacterTop(raw, shapes) {
  const known = shapeKnown("vol-character-top", shapes);
  if (!known.ok) return { status: "unshaped", why: known.why === "unseen" ? "unseen" : "keys", rows: [] };
  if (!CHAR_KEYS.every((k) => Object.hasOwn(known.set, k))) return { status: "unshaped", why: "keys", rows: [] };
  const body = unwrap(raw);
  const list = Array.isArray(body) ? body : null;
  if (!list) return { status: "unshaped", why: "keys", rows: [] };
  const rows = [];
  let bad = null;
  for (const row of list) {
    if (!isObj(row)) continue;
    const t = typeof row.ticker === "string" ? row.ticker : null;
    const label = typeof row.character === "string" ? row.character : null;
    const hl = numOf(row.half_life_days, "half_life_days");
    const hu = numOf(row.hurst_rv, "hurst_rv");
    if (!t || !label || hl.v === null || hu.v === null) { bad = bad || (hl.why !== "absent" && hl.why) || (hu.why !== "absent" && hu.why) || "type:row"; continue; }
    if (!(hl.v > 0)) { bad = bad || "range:half_life_days"; continue; }
    rows.push([t, label, r4(hl.v), r4(hu.v)]);
  }
  if (!rows.length) return { status: "failed", why: bad || "empty", rows: [] };
  return { status: "ok", rows, ...(bad ? { partial: bad } : {}) };
}

export function characterMovers(today, prev) {
  if (!prev || !isObj(prev)) return { movers: null, why: "first", fresh: 0 };
  const merge = (p) => {
    const m = new Map();
    for (const list of [p && p.meanRev, p && p.persistent]) for (const r of Array.isArray(list) ? list : []) if (!m.has(r[0])) m.set(r[0], r);
    return m;
  };
  const now = merge(today);
  const before = merge(prev);
  const movers = [];
  let fresh = 0;
  const threshold = Math.log(MOVER_RATIO) - 1e-12;
  for (const [t, row] of now) {
    const old = before.get(t);
    if (!old) { fresh++; continue; }
    const labelChanged = row[1] !== old[1];
    const ratio = row[2] > 0 && old[2] > 0 ? Math.abs(Math.log(row[2] / old[2])) : 0;
    if (labelChanged || ratio >= threshold) movers.push({ row: [t, row[1], old[1], row[2], old[2], labelChanged ? "label" : "ratio"], label: labelChanged, ratio });
  }
  movers.sort((a, b) => (a.label === b.label ? b.ratio - a.ratio || (a.row[0] < b.row[0] ? -1 : 1) : a.label ? -1 : 1));
  return { movers: movers.slice(0, MOVER_CAP).map((m) => m.row), why: null, fresh };
}

export function characterSection(meanRev, persistent, prev) {
  const a = meanRev || { status: "absent", rows: [] };
  const b = persistent || { status: "absent", rows: [] };
  const ok = a.status === "ok" || b.status === "ok";
  const status = ok ? "ok" : a.status === "unshaped" || b.status === "unshaped" ? "unshaped" : (a.status !== "absent" ? a.status : b.status);
  const why = ok ? null : a.why || b.why || null;
  const today = { meanRev: a.rows || [], persistent: b.rows || [] };
  const moved = ok ? characterMovers(today, prev) : { movers: null, why: "first" };
  return {
    status, ...(why ? { why } : {}), ...today,
    movers: moved.movers, ...(moved.movers === null ? { moversWhy: moved.why } : {}),
    prev: today,
  };
}

export function stanceExtract(raw, ticker) {
  const body = unwrap(raw);
  const list = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.data) ? body.data : null;
  if (!list) return { ticker, rows: [] };
  const rows = [];
  for (const row of list) {
    if (!isObj(row)) continue;
    const dte = numOf(row.dte, "dte");
    const fit = numOf(row.fit_score, "fit_score");
    if (dte.v === null || fit.v === null || dte.v > STANCE_DTE) continue;
    const pop = numOf(row.pop, "pop");
    const delta = numOf(row.delta, "delta");
    const iv = numOf(row.iv, "iv");
    if (typeof row.option_symbol !== "string") continue;
    rows.push([row.option_symbol, keep(pop.v, r4), keep(delta.v, r4), keep(iv.v, r4), dte.v, r4(fit.v)]);
  }
  rows.sort((a, b) => b[5] - a[5] || (a[0] < b[0] ? -1 : 1));
  return { ticker, rows: rows.slice(0, STANCE_TOP) };
}

export function chooseExpiry(engineExpiries) {
  const list = (Array.isArray(engineExpiries) ? engineExpiries : []).filter((e) => e && fin(e.dte) && e.dte >= AUDIT_MIN_DTE);
  if (!list.length) return null;
  let best = null;
  for (const e of list) {
    const d = Math.abs(e.dte - AUDIT_TARGET_DTE);
    if (!best || d < best.d || (d === best.d && e.expiry < best.e.expiry)) best = { d, e };
  }
  return best.e;
}

export function gammaSpot(F, D, S, K, sigma, T) {
  const nu = sigma * Math.sqrt(T);
  if (!(nu > 0) || !(S > 0)) return null;
  const d1 = Math.log(F / K) / nu + nu / 2;
  return (D * F / S) * normPdf(d1) / (S * nu);
}

const relGap = (e, f, floor = 0) => {
  const m = Math.max(Math.abs(e), Math.abs(f), floor);
  return m === 0 ? 0 : Math.abs(e - f) / m;
};

function judge(id, e, f, gap, tol) {
  if (!fin(e) || !fin(f) || !fin(gap)) return [id, fin(e) ? e : null, fin(f) ? f : null, null, tol, "nc", "absent"];
  return [id, e, f, r6(gap), tol, Math.abs(gap) <= tol + 1e-12 ? "agree" : "differs"];
}

const nc = (id, why, tol = null) => [id, null, null, null, tol, "nc", why];

export function auditName({ card, chain, greeks, chains, atm, oiExpiry, volOi, exStrike, exStrikeExpiry, session, exposureSign = EXPOSURE_SIGN_KNOWN }) {
  const engine = card && card.engine && Array.isArray(card.engine.expiries) ? card.engine : null;
  const chosen = engine ? chooseExpiry(engine.expiries) : null;
  const rows = [];
  const out = (extra = {}) => finishAudit(rows, extra);
  if (!chosen) {
    for (const id of ROW_IDS) rows.push(nc(id, "engine"));
    return out({ expiry: null, dte: null, F: null, unit: null, strikes: [] });
  }
  const slice = sliceFromSummary(chosen);
  if (!slice) {
    for (const id of ROW_IDS) rows.push(nc(id, "engine"));
    return out({ expiry: chosen.expiry, dte: chosen.dte, F: null, unit: null, strikes: [] });
  }
  const F = chosen.forward.F;
  const D = chosen.forward.D;
  const T = chosen.T;
  const S = fin(engine.spot) ? engine.spot : fin(card.spot) ? card.spot : null;
  const volAt = (K) => sliceVolK(slice, Math.log(K / F));
  const head = { expiry: chosen.expiry, dte: chosen.dte, F: r4(F) };

  const atmFeed = feedRows(atm);
  let spotRow;
  if (!atmFeed.rows) spotRow = nc("spot", atmFeed.why, XCHECK_TOL.spotRel);
  else {
    const hit = atmFeed.rows.find((r) => isObj(r) && r.expiry === chosen.expiry) || null;
    const px = hit ? rangedOf(hit.stock_price, "stock_price", 0, Infinity, true) : { v: null, why: "absent" };
    spotRow = px.v === null || !fin(S) ? nc("spot", px.why || "engine", XCHECK_TOL.spotRel) : judge("spot", S, px.v, relGap(S, px.v), XCHECK_TOL.spotRel);
  }

  const grFeed = feedRows(greeks);
  const strikes = [];
  let dateOff = false;
  let unit = null;
  let deltaRow;
  let ivRow;
  let gammaRow;
  if (!grFeed.rows) {
    deltaRow = nc("delta", grFeed.why, XCHECK_TOL.delta);
    ivRow = nc("iv", grFeed.why, XCHECK_TOL.ivPts);
    gammaRow = nc("gamma", grFeed.why, XCHECK_TOL.gammaRel);
  } else {
    const usable = [];
    for (const r of grFeed.rows) {
      if (!isObj(r) || r.expiry !== chosen.expiry) continue;
      if (typeof r.date === "string" && r.date.slice(0, 10) !== session) { dateOff = true; continue; }
      const K = numOf(r.strike, "strike").v;
      const cd = deltaOf(r.call_delta);
      const pd = deltaOf(r.put_delta);
      if (K === null || cd.v === null || pd.v === null || !(K > 0)) continue;
      usable.push({ K, r, cd: cd.v });
    }
    if (dateOff && !usable.length) {
      deltaRow = nc("delta", "date", XCHECK_TOL.delta);
      ivRow = nc("iv", "date", XCHECK_TOL.ivPts);
      gammaRow = nc("gamma", "date", XCHECK_TOL.gammaRel);
    } else {
      usable.sort((a, b) => Math.abs(a.K - F) - Math.abs(b.K - F) || a.K - b.K);
      const picked = usable.slice(0, AUDIT_STRIKES).sort((a, b) => a.K - b.K);
      if (picked.length < AUDIT_MIN_STRIKES) {
        deltaRow = nc("delta", "strikes", XCHECK_TOL.delta);
        ivRow = nc("iv", "strikes", XCHECK_TOL.ivPts);
        gammaRow = nc("gamma", "strikes", XCHECK_TOL.gammaRel);
      } else {
        const eD = [];
        const fD = [];
        const eV = [];
        const fV = [];
        const eG = [];
        const fG = [];
        const ratios = [];
        let ivBad = null;
        for (const p of picked) {
          const sigma = volAt(p.K);
          const ed = sigma > 0 ? forwardDelta(F, p.K, sigma, T, "C") : null;
          const eg = sigma > 0 && fin(S) ? gammaSpot(F, D, S, p.K, sigma, T) : null;
          const fv = p.K >= F ? volOf(p.r.call_volatility, "call_volatility") : volOf(p.r.put_volatility, "put_volatility");
          const fg = numOf(p.r.call_gamma, "call_gamma");
          if (fv.v === null) ivBad = ivBad || fv.why;
          strikes.push([p.K, keep(ed, r4), r4(p.cd), keep(sigma, r4), keep(fv.v, r4), keep(eg, sig5), keep(fg.v, sig5)]);
          if (ed !== null) { eD.push(ed); fD.push(p.cd); }
          if (sigma > 0 && fv.v !== null) { eV.push(sigma); fV.push(fv.v); }
          if (eg !== null && fg.v !== null && fg.v > 0 && eg > 0) { eG.push(eg); fG.push(fg.v); ratios.push(fg.v / eg); }
        }
        const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
        deltaRow = eD.length >= AUDIT_MIN_STRIKES
          ? judge("delta", r4(avg(eD)), r4(avg(fD)), avg(fD) - avg(eD), XCHECK_TOL.delta)
          : nc("delta", "engine", XCHECK_TOL.delta);
        ivRow = eV.length >= AUDIT_MIN_STRIKES
          ? judge("iv", r4(avg(eV) * 100), r4(avg(fV) * 100), (avg(fV) - avg(eV)) * 100, XCHECK_TOL.ivPts)
          : nc("iv", ivBad || "engine", XCHECK_TOL.ivPts);
        if (ratios.length >= AUDIT_MIN_STRIKES) {
          const r = median(ratios);
          const band = XCHECK_TOL.unitBand;
          if (r >= 1 / band && r <= band) unit = "per$";
          else if (fin(S) && r >= (S / 100) / band && r <= (S / 100) * band) unit = "per1%";
          if (unit === "per$") {
            const eg = avg(eG);
            const fg = avg(fG);
            const gap = relGap(eg, fg, XCHECK_TOL.gammaFloor);
            gammaRow = judge("gamma", sig5(eg), sig5(fg), gap, XCHECK_TOL.gammaRel);
          } else gammaRow = nc("gamma", "units", XCHECK_TOL.gammaRel);
        } else gammaRow = nc("gamma", "absent", XCHECK_TOL.gammaRel);
      }
    }
  }

  const chainOk = chain && Array.isArray(chain.rows) && !chain.truncated;
  const chainWhy = chain && Array.isArray(chain.rows) ? "partial chain" : "absent";
  const oiRows = chainOk ? chain.rows.filter((r) => r && r.expiry === chosen.expiry) : [];
  const engineOi = oiRows.reduce((s, r) => s + (fin(r.oi) ? r.oi : 0), 0);
  let oiExpiryRow;
  const oiFeed = feedRows(oiExpiry);
  if (!chainOk) oiExpiryRow = nc("oiExpiry", chainWhy, XCHECK_TOL.oiRel);
  else if (!oiFeed.rows) oiExpiryRow = nc("oiExpiry", oiFeed.why, XCHECK_TOL.oiRel);
  else {
    const hit = oiFeed.rows.find((r) => isObj(r) && r.expiry === chosen.expiry);
    if (hit && typeof hit.date === "string" && hit.date.slice(0, 10) !== session) oiExpiryRow = nc("oiExpiry", "date", XCHECK_TOL.oiRel);
    else {
      const c = hit ? intOf(hit.call_oi, "call_oi") : { v: null, why: "absent" };
      const p = hit ? intOf(hit.put_oi, "put_oi") : { v: null, why: "absent" };
      oiExpiryRow = c.v === null || p.v === null ? nc("oiExpiry", c.why || p.why, XCHECK_TOL.oiRel) : judge("oiExpiry", engineOi, c.v + p.v, relGap(engineOi, c.v + p.v), XCHECK_TOL.oiRel);
    }
  }

  let oiAllRow;
  const voFeed = feedRows(volOi);
  if (!chainOk) oiAllRow = nc("oiAll", chainWhy, XCHECK_TOL.oiRel);
  else if (!voFeed.rows) oiAllRow = nc("oiAll", voFeed.why, XCHECK_TOL.oiRel);
  else {
    const expiries = new Set(chain.rows.map((r) => r.expiry));
    const eAll = chain.rows.reduce((s, r) => s + (fin(r.oi) ? r.oi : 0), 0);
    let fAll = 0;
    let bad = null;
    for (const r of voFeed.rows) {
      if (!isObj(r) || !expiries.has(r.expires)) continue;
      const o = intOf(r.oi, "oi");
      if (o.v === null) { bad = bad || o.why; continue; }
      fAll += o.v;
    }
    oiAllRow = bad ? nc("oiAll", bad, XCHECK_TOL.oiRel) : judge("oiAll", eAll, fAll, relGap(eAll, fAll), XCHECK_TOL.oiRel);
  }

  let dexRow;
  const seFeed = feedRows(exStrikeExpiry);
  if (!exposureSign) dexRow = nc("dexExpiry", "sign", XCHECK_TOL.dexRel);
  else if (!chainOk) dexRow = nc("dexExpiry", chainWhy, XCHECK_TOL.dexRel);
  else if (!seFeed.rows) dexRow = nc("dexExpiry", seFeed.why, XCHECK_TOL.dexRel);
  else {
    let eDex = 0;
    let gross = 0;
    for (const r of oiRows) {
      const sigma = volAt(r.K);
      if (!(sigma > 0) || !fin(r.oi)) continue;
      const d = forwardDelta(F, r.K, sigma, T, r.type === "P" ? "P" : "C") * r.oi * 100;
      eDex += d;
      gross += Math.abs(d);
    }
    let fDex = 0;
    let bad = null;
    let any = false;
    for (const r of seFeed.rows) {
      if (!isObj(r) || r.expiry !== chosen.expiry) continue;
      const c = numOf(r.call_delta, "call_delta");
      const p = numOf(r.put_delta, "put_delta");
      if (c.v === null || p.v === null) { bad = bad || c.why || p.why; continue; }
      fDex += c.v + p.v;
      any = true;
    }
    dexRow = !any ? nc("dexExpiry", bad || "absent", XCHECK_TOL.dexRel)
      : judge("dexExpiry", Math.round(eDex), Math.round(fDex), Math.abs(eDex - fDex) / Math.max(gross, 1), XCHECK_TOL.dexRel);
  }

  let gexRow;
  const sFeed = feedRows(exStrike);
  if (!exposureSign) gexRow = nc("gexAll", "sign", XCHECK_TOL.gexRel);
  else if (!chainOk) gexRow = nc("gexAll", chainWhy, XCHECK_TOL.gexRel);
  else if (!sFeed.rows) gexRow = nc("gexAll", sFeed.why, XCHECK_TOL.gexRel);
  else if (unit !== "per$") gexRow = nc("gexAll", "units", XCHECK_TOL.gexRel);
  else if (!fin(S)) gexRow = nc("gexAll", "engine", XCHECK_TOL.gexRel);
  else {
    const byExpiry = new Map(engine.expiries.map((e) => [e.expiry, e]));
    let missing = false;
    let eGex = 0;
    for (const r of chain.rows) {
      const e = byExpiry.get(r.expiry);
      const sl = e ? sliceFromSummary(e) : null;
      if (!sl) { missing = true; break; }
      const sigma = sliceVolK(sl, Math.log(r.K / e.forward.F));
      const g = sigma > 0 ? gammaSpot(e.forward.F, e.forward.D, S, r.K, sigma, e.T) : null;
      if (g === null || !fin(r.oi)) continue;
      eGex += g * r.oi * 100 * S * S / 100;
    }
    if (missing) gexRow = nc("gexAll", "engine", XCHECK_TOL.gexRel);
    else {
      let fGex = 0;
      let bad = null;
      let any = false;
      for (const r of sFeed.rows) {
        if (!isObj(r)) continue;
        const c = numOf(r.call_gex, "call_gex");
        const p = numOf(r.put_gex, "put_gex");
        if (c.v === null || p.v === null) { bad = bad || c.why || p.why; continue; }
        fGex += (c.v + p.v) * S * S / 100;
        any = true;
      }
      gexRow = !any ? nc("gexAll", bad || "absent", XCHECK_TOL.gexRel)
        : judge("gexAll", Math.round(eGex), Math.round(fGex), relGap(eGex, fGex), XCHECK_TOL.gexRel);
    }
  }

  let selfRow;
  const cFeed = feedRows(chains);
  if (!cFeed.rows) selfRow = nc("chainSelf", cFeed.why, 0);
  else if (!atmFeed.rows) selfRow = nc("chainSelf", atmFeed.why, 0);
  else {
    const bySymbol = new Map();
    for (const r of cFeed.rows) if (isObj(r) && typeof r.option_symbol === "string") bySymbol.set(r.option_symbol, intOf(r.open_interest, "open_interest").v);
    let matched = 0;
    let differ = 0;
    for (const r of atmFeed.rows) {
      if (!isObj(r) || typeof r.option_symbol !== "string" || !bySymbol.has(r.option_symbol)) continue;
      const a = intOf(r.open_interest, "open_interest").v;
      const b = bySymbol.get(r.option_symbol);
      if (a === null || b === null) continue;
      matched++;
      if (a !== b) differ++;
    }
    selfRow = matched ? [ "chainSelf", matched, differ, differ, 0, differ === 0 ? "agree" : "differs" ] : nc("chainSelf", "absent", 0);
  }

  rows.push(spotRow, deltaRow, ivRow, gammaRow, oiExpiryRow, oiAllRow, dexRow, gexRow, selfRow);
  return out({ ...head, unit, strikes });
}

function finishAudit(rows, extra) {
  const n = { agree: 0, differs: 0, nc: 0 };
  for (const r of rows) if (r[0] !== "chainSelf") n[r[5]]++;
  const compared = n.agree + n.differs;
  const v = n.differs > 0 ? "differs" : compared >= 3 ? "agree" : "nc";
  return { ...extra, v, ...(v === "nc" ? { why: "few" } : {}), n, rows };
}

const bytesOf = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

export function fitVa(va, cap = VA_CAP) {
  let out = va;
  if (bytesOf(out) > cap && Array.isArray(out.strikes)) out = { ...out, strikes: out.strikes.slice(0, AUDIT_MIN_STRIKES) };
  if (bytesOf(out) > cap) out = { ...out, strikes: [] };
  if (bytesOf(out) > cap) out = { ...out, rows: out.rows.map((r) => r.slice(0, 6)) };
  return out;
}

export function buildVa(audit, { at, session }) {
  const va = { at, rv: 1, session, ...audit };
  return fitVa(va);
}

export function carryVa(prior, session) {
  if (!prior || !prior.session) return null;
  const gap = sessionsBetween(prior.session, session);
  if (gap === null || gap > AUDIT_KEEP_SESSIONS || gap < 0) return null;
  return prior;
}

export function auditSummary(vas) {
  const out = { names: 0, compared: 0, agree: 0, differs: 0, nc: 0, worst: [] };
  const worst = [];
  for (const [t, va] of vas) {
    out.names++;
    for (const r of va.rows) {
      out[r[5]]++;
      if (r[5] === "differs" && fin(r[3])) worst.push([t, r[0], r[3], Math.abs(r[4] > 0 ? r[3] / r[4] : r[3])]);
    }
  }
  out.compared = out.agree + out.differs;
  worst.sort((a, b) => b[3] - a[3] || (a[0] < b[0] ? -1 : 1));
  out.worst = worst.slice(0, 8).map((w) => [w[0], w[1], w[2]]);
  return out;
}

export function siteDispersion(dispersion) {
  if (!isObj(dispersion)) return null;
  const rho = (x) => (isObj(x) && fin(x.rho) ? r4(x.rho) : null);
  const site = {
    implied: rho(dispersion.implied),
    realized21: rho(dispersion.realised && dispersion.realised[21]),
    realized63: rho(dispersion.realised && dispersion.realised[63]),
    asOf: typeof dispersion.asOf === "string" ? dispersion.asOf : null,
  };
  return site.implied === null && site.realized21 === null && site.realized63 === null ? null : site;
}

function leak(payload, test) {
  if (test) return;
  const hit = fixtureNameIn(JSON.stringify(payload));
  if (hit) throw new Error(`voldesk: a fixture name (${hit}) cannot be published`);
}

export function fitVoldesk(payload, cap = VOLDESK_CAP) {
  let out = payload;
  const shed = [];
  const steps = [
    ["character.prev", (p) => ({ ...p, character: { ...p.character, prev: { meanRev: [], persistent: [] } } })],
    ["matrix.1Y", (p) => ({ ...p, matrix: { ...p.matrix, "1Y": { status: "shed", why: "size", cells: [], minDate: null, maxDate: null, sectorAvg: null, sectorN: 0 } } })],
    ["futures.history", (p) => ({ ...p, term: { ...p.term, futures: { ...p.term.futures, points: p.term.futures.points.slice(0, 4) } } })],
    ["character.movers", (p) => ({ ...p, character: { ...p.character, movers: Array.isArray(p.character.movers) ? p.character.movers.slice(0, 5) : p.character.movers } })],
  ];
  for (const [name, fn] of steps) {
    if (bytesOf(out) <= cap) break;
    out = fn(out);
    shed.push(name);
  }
  if (bytesOf(out) > cap) throw new Error("voldesk payload over its size cap");
  return shed.length ? { ...out, shed } : out;
}

export function buildVoldesk(parts, { session, generatedAt, test = false } = {}) {
  const payload = {
    v: VOLDESK_VERSION, session, generatedAt,
    term: parts.term, ivrv: parts.ivrv, matrix: parts.matrix, site: parts.site || null,
    character: parts.character, audit: parts.audit, basis: { ops: parts.ops || {} },
  };
  if (test) payload.fixture = true;
  leak(payload, test);
  return fitVoldesk(payload);
}

export function fitStance(ring, cap = STANCE_CAP) {
  let out = ring.slice(0, STANCE_RING);
  while (out.length > 1 && bytesOf({ v: VOLDESK_VERSION, ring: out }) > cap) out = out.slice(0, -1);
  return out;
}

export function buildStance(priorRing, today, { session, test = false } = {}) {
  const rows = {};
  for (const [t, ex] of today) if (ex.rows.length) rows[t] = ex.rows;
  const prior = (Array.isArray(priorRing) ? priorRing : []).filter((e) => e && e.session !== session);
  const ring = fitStance([{ session, rows }, ...prior]);
  const payload = { v: VOLDESK_VERSION, ring, ...(test ? { fixture: true } : {}) };
  leak(payload, test);
  return payload;
}

export function marketCalls(cap) {
  const c = Number.isFinite(cap) ? Math.max(0, Math.min(VOLAUDIT_CAP_MAX, Math.trunc(cap))) : VOLAUDIT_CAP;
  return { cap: c, perName: AUDIT_CALLS_PER_NAME, market: MARKET_CALLS, max: (FUND_TICKERS.length + c) * AUDIT_CALLS_PER_NAME + MARKET_CALLS };
}

export function auditCap(env) {
  const raw = env && env.FLOWS_VOLAUDIT_CAP;
  if (raw === undefined || raw === null || String(raw).trim() === "") return VOLAUDIT_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n)) return VOLAUDIT_CAP;
  return Math.max(0, Math.min(VOLAUDIT_CAP_MAX, Math.trunc(n)));
}

export const voldeskBuildOn = (env) => String((env && env.FLOWS_VOLDESK_BUILD) || "").trim().toLowerCase() !== "off";
