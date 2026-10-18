import { TICKER_RE } from "./flows-live.js";
import { easternDay, isTradingDay, nextTradingDay } from "./flows-freshness.js";

export const DOOR_MODES = Object.freeze(["off", "warn"]);

export const doorMode = (env) => (env && env.FLOWS_DOOR_V2 === "warn" ? "warn" : "off");

export const DOOR_LIMITS = Object.freeze({
  batchItems: 100,
  batchBytes: 2 * 1024 * 1024,
  haveItems: 90,
  planNames: 2000,
  planBytes: 64 * 1024,
  ringSize: 200,
  ringBodies: 20,
  bodyMaxBytes: 64 * 1024,
  brakeAfter: 20,
  brakeWindow: 40,
  collapseFloor: 0.4,
  regressionDrop: 0.25,
  regressionMinPanels: 8,
  pathChars: 120,
  producerChars: 64,
  maxDepth: 64,
  rangeSample: 4000,
  statementsPerBatch: 16,
  bisectBudget: 40,
});

export const WOULD_ORDER = Object.freeze([
  "hash_mismatch", "invalid_shape", "not_object", "schema_version", "missing_key", "depth", "panel_shape", "ticker_grammar",
  "ticker_mismatch", "session_format", "instant_format", "non_finite", "too_deep", "column_length", "units_missing", "n_mismatch",
  "rows_type", "row_shape", "session_future", "size_collapse", "stale_producer", "regression", "superseded",
]);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA_HEADER = /^sha256-([0-9a-f]{64})$/;
const PRODUCER_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const PASS = new Set(["ok", "quiet", "none"]);
const PANEL_STATUS = new Set(["ok", "quiet", "unavailable", "pending", "none"]);
const DEPTHS = Object.freeze({ board: "engine", focus: "engine", deepened: "engine", index: 2, fund: 2, "cross-section": 1, breadth: 1 });
const VOLATILE = Object.freeze(["generatedAt", "readAt", "screenerReadAt", "refreshedAt", "producer", "fresh.readAt"]);
const CARD_PANELS = Object.freeze(["context", "pricedMove", "levels", "gamma", "calendar", "displacement", "variation", "vanna", "charm", "deltaExposure", "path", "congress", "marketRank"]);
const CARDX_SECTIONS = Object.freeze(["cone", "rv", "vrp", "gex", "short", "insiders", "volume", "earnings"]);
const HIST_SECTIONS = Object.freeze(["gex", "volume"]);
const CARD_VERSIONS = Object.freeze([2, 3]);

const product = (spec) => Object.freeze({ epoch: 1, shrinks: false, volatile: VOLATILE, ...spec });
const VIEW_REQUIRED = Object.freeze(["sessionDate", "generatedAt"]);

export const PRODUCTS = Object.freeze({
  card: product({ kind: "ticker", required: ["v", "ticker", "depth", "sessionDate", "generatedAt", "panels"] }),
  "card-x": product({ kind: "ticker", required: ["v", "ticker", "sessionDate", "generatedAt"] }),
  hist: product({ kind: "ticker", required: ["v", "ticker", "sessionDate", "generatedAt"] }),
  universe: product({ kind: "view", required: ["v", "sessionDate", "generatedAt", "n", "t", "cols", "units"] }),
  board: product({ kind: "view", required: ["v", "side", "sessionDate", "generatedAt", "rows"] }),
  roster: product({ kind: "view", required: ["v", "sessionDate", "generatedAt", "depth"] }),
  focus: product({ kind: "view", required: ["v", "sessionDate", "generatedAt", "rows"] }),
  meta: product({ kind: "view", required: ["sessionDate", "generatedAt", "stages"], shrinks: true }),
  view: product({ kind: "view", required: VIEW_REQUIRED, shrinks: true }),
});

export function productOf(key) {
  const text = String(key);
  const prefixed = /^(card-x|card|hist):/.exec(text);
  if (prefixed) return prefixed[1];
  if (text === "universe" || text === "roster" || text === "focus" || text === "meta") return text;
  if (text.startsWith("board:")) return "board";
  return "view";
}

export const tickerOfKey = (key) => {
  const prefixed = /^(?:card-x|card|hist):(.*)$/.exec(String(key));
  return prefixed ? prefixed[1] : null;
};

export const COLLAPSE_PRODUCTS = Object.freeze(Object.keys(PRODUCTS).filter((id) => !PRODUCTS[id].shrinks));

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isDay = (v) => typeof v === "string" && ISO_DAY.test(v) && Number.isFinite(Date.parse(v + "T00:00:00Z"));
const isInstant = (v) => typeof v === "string" && ISO_INSTANT.test(v) && Number.isFinite(Date.parse(v));

export function horizonSession(now) {
  const today = easternDay(now);
  if (!today) return null;
  return isTradingDay(today, null) ? today : nextTradingDay(today, null);
}

export async function sha256Hex(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseHashHeader(value) {
  if (value === null || value === undefined) return null;
  const found = SHA_HEADER.exec(String(value).trim().toLowerCase());
  return found ? { ok: true, hex: found[1] } : { ok: false, hex: null };
}

export function producerOf(raw, fallback) {
  const text = String(raw ?? "").trim();
  return PRODUCER_RE.test(text) ? text : String(fallback || "");
}

export function canonicalize(value, volatile = VOLATILE) {
  const drop = new Set(volatile);
  const out = { text: "", nonFinite: null, tooDeep: false };
  const parts = [];
  const walk = (v, depth, path) => {
    if (out.tooDeep) return;
    if (depth > DOOR_LIMITS.maxDepth) { out.tooDeep = true; return; }
    if (v === null) { parts.push("null"); return; }
    const type = typeof v;
    if (type === "number") {
      if (!Number.isFinite(v)) { if (out.nonFinite === null) out.nonFinite = path || "$"; parts.push("null"); return; }
      parts.push(JSON.stringify(v));
      return;
    }
    if (type === "string") { parts.push(JSON.stringify(v)); return; }
    if (type === "boolean") { parts.push(v ? "true" : "false"); return; }
    if (Array.isArray(v)) {
      parts.push("[");
      for (let i = 0; i < v.length; i++) {
        if (i) parts.push(",");
        walk(v[i], depth + 1, depth < 3 ? path + "[" + i + "]" : null);
      }
      parts.push("]");
      return;
    }
    if (type === "object") {
      const keys = Object.keys(v).sort();
      parts.push("{");
      let first = true;
      for (const k of keys) {
        const at = path === null ? null : depth === 0 ? k : path + "." + k;
        if (at !== null && drop.has(at)) continue;
        if (v[k] === undefined) continue;
        if (!first) parts.push(",");
        first = false;
        parts.push(JSON.stringify(k), ":");
        walk(v[k], depth + 1, depth < 3 ? at : null);
      }
      parts.push("}");
      return;
    }
    parts.push("null");
  };
  walk(value, 0, "");
  out.text = parts.join("");
  return out;
}

const statusPct = (status) => {
  if (status === undefined || status === null || status === "ok" || status === "quiet" || status === "thin" || status === "complete") return 63;
  if (status === "partial") return 32;
  return 0;
};

const decode = (units, k) => {
  const u = units && units[k];
  const scale = Array.isArray(u) ? Number(u[1]) : NaN;
  return Number.isFinite(scale) && scale !== 0 ? scale : null;
};

const RANGES = Object.freeze({
  px: (x) => x > 0,
  chg: (x) => x >= -0.95 && x <= 10,
  sig: (x) => x > 0 && x < 0.25,
  iv30: (x) => x >= 0.005 && x <= 8,
  iv30p: (x) => x >= 0.005 && x <= 8,
});

function universeChecks(obj, structural, flags) {
  const n = obj.n;
  if (!Number.isInteger(n) || n < 0) structural.push({ code: "n_mismatch", path: "n" });
  if (!Array.isArray(obj.t)) structural.push({ code: "invalid_shape", path: "t" });
  else if (Number.isInteger(n) && obj.t.length !== n) structural.push({ code: "n_mismatch", path: "t" });
  if (!isObj(obj.cols)) { structural.push({ code: "invalid_shape", path: "cols" }); return; }
  if (!isObj(obj.units)) { structural.push({ code: "invalid_shape", path: "units" }); return; }
  for (const k of Object.keys(obj.cols)) {
    if (!Array.isArray(obj.cols[k]) || (Number.isInteger(n) && obj.cols[k].length !== n)) structural.push({ code: "column_length", path: "cols." + k });
    if (!Array.isArray(obj.units[k])) structural.push({ code: "units_missing", path: "units." + k });
  }
  if (obj.pct !== undefined) {
    if (!isObj(obj.pct)) structural.push({ code: "invalid_shape", path: "pct" });
    else for (const k of Object.keys(obj.pct)) {
      if (!Array.isArray(obj.pct[k]) || (Number.isInteger(n) && obj.pct[k].length !== n)) structural.push({ code: "column_length", path: "pct." + k });
    }
  }
  if (structural.length) return;
  for (const [k, within] of Object.entries(RANGES)) {
    const col = obj.cols[k];
    const scale = decode(obj.units, k);
    if (!Array.isArray(col) || scale === null) continue;
    let bad = 0;
    const limit = Math.min(col.length, DOOR_LIMITS.rangeSample);
    for (let i = 0; i < limit; i++) {
      const cell = col[i];
      if (typeof cell !== "number" || !Number.isFinite(cell)) continue;
      if (!within(cell / scale)) bad++;
    }
    if (bad) flags.push({ code: "range", path: "cols." + k, n: bad });
  }
}

function cardChecks(obj, structural) {
  if (obj.v !== undefined && !CARD_VERSIONS.includes(obj.v)) structural.push({ code: "schema_version", path: "v" });
  if (obj.depth !== undefined && !Object.hasOwn(DEPTHS, obj.depth)) structural.push({ code: "depth", path: "depth" });
  if (!isObj(obj.panels)) { structural.push({ code: "missing_key", path: "panels" }); return; }
  for (const name of CARD_PANELS) {
    const panel = obj.panels[name];
    if (panel === undefined) continue;
    if (!isObj(panel) || !PANEL_STATUS.has(panel.status)) structural.push({ code: "panel_shape", path: "panels." + name });
  }
}

function boardChecks(obj, structural) {
  if (!Array.isArray(obj.rows)) { structural.push({ code: "rows_type", path: "rows" }); return; }
  const limit = Math.min(obj.rows.length, 200);
  for (let i = 0; i < limit; i++) {
    const row = obj.rows[i];
    if (!isObj(row) || typeof row.t !== "string") { structural.push({ code: "row_shape", path: "rows[" + i + "]" }); return; }
  }
}

function basePanels(id, obj) {
  if (id === "card") return { names: CARD_PANELS, ok: (n) => obj.panels && isObj(obj.panels) && isObj(obj.panels[n]) && PASS.has(obj.panels[n].status) };
  if (id === "card-x") return { names: CARDX_SECTIONS, ok: (n) => isObj(obj[n]) && PASS.has(obj[n].status) };
  if (id === "hist") return { names: HIST_SECTIONS, ok: (n) => isObj(obj[n]) && Object.keys(obj[n]).length > 0 };
  return null;
}

function tierOf(id, obj) {
  if (obj.status === "pending") return 0;
  if (id === "card" || id === "card-x") {
    const fixed = Object.hasOwn(DEPTHS, obj.depth) ? DEPTHS[obj.depth] : undefined;
    if (fixed === "engine") return id === "card" && isObj(obj.engine) ? 3 : 2;
    return fixed === undefined ? 1 : fixed;
  }
  if (id === "hist") return 1;
  return 3;
}

const minutesOf = (instant) => (isInstant(instant) ? Math.floor(Date.parse(instant) / 60000) : 0);

const dedupe = (items) => {
  const seen = new Set();
  return items.filter((x) => { const k = x.code + "|" + x.path; if (seen.has(k)) return false; seen.add(k); return true; });
};

export function inspect(key, text, { now = Date.now() } = {}) {
  const id = productOf(key);
  const spec = PRODUCTS[id];
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, product: id, code: "invalid_json" }; }
  const structural = [];
  const flags = [];
  const canon = canonicalize(obj, spec.volatile);
  if (canon.tooDeep) structural.push({ code: "too_deep", path: "$" });
  if (canon.nonFinite !== null) structural.push({ code: "non_finite", path: canon.nonFinite });
  const base = { ok: true, product: id, epoch: spec.epoch, canonical: canon.text, bytes: text.length };
  if (!isObj(obj)) {
    structural.push({ code: "not_object", path: "$" });
    return { ...base, structural, flags, session: null, asof: 0, tier: 0, pct: 0, quality: 0, baseOk: 0, baseTotal: 0, ticker: tickerOfKey(key) };
  }
  const pending = obj.status === "pending";
  const ticker = tickerOfKey(key);
  if (!pending && !canon.tooDeep) {
    for (const name of spec.required) if (obj[name] === undefined) structural.push({ code: "missing_key", path: name });
    if (spec.kind === "ticker") {
      if (typeof obj.ticker === "string" && !TICKER_RE.test(obj.ticker)) structural.push({ code: "ticker_grammar", path: "ticker" });
      else if (typeof obj.ticker === "string" && obj.ticker !== ticker) structural.push({ code: "ticker_mismatch", path: "ticker" });
    }
    if (obj.sessionDate !== undefined && !isDay(obj.sessionDate)) structural.push({ code: "session_format", path: "sessionDate" });
    if (obj.generatedAt !== undefined && !isInstant(obj.generatedAt)) structural.push({ code: "instant_format", path: "generatedAt" });
    if (id === "card") cardChecks(obj, structural);
    if (id === "card-x" && obj.v !== undefined && !(Number.isInteger(obj.v) && obj.v >= 1)) structural.push({ code: "schema_version", path: "v" });
    if (id === "hist" && obj.v !== undefined && !(Number.isInteger(obj.v) && obj.v >= 1)) structural.push({ code: "schema_version", path: "v" });
    if (id === "universe") universeChecks(obj, structural, flags);
    if (id === "board") boardChecks(obj, structural);
    if (id === "focus" && obj.rows !== undefined && !isObj(obj.rows)) structural.push({ code: "invalid_shape", path: "rows" });
    if (id === "roster" && obj.depth !== undefined && !isObj(obj.depth)) structural.push({ code: "invalid_shape", path: "depth" });
    if (id === "meta" && obj.stages !== undefined && !Array.isArray(obj.stages)) structural.push({ code: "invalid_shape", path: "stages" });
  }
  const session = isDay(obj.sessionDate) ? obj.sessionDate : null;
  if (session !== null) {
    const horizon = horizonSession(now);
    if (horizon !== null && session > horizon) structural.push({ code: "session_future", path: "sessionDate" });
  }
  const panels = pending ? null : basePanels(id, obj);
  let baseOk = 0;
  let baseTotal = 0;
  let pct;
  if (pending) pct = 0;
  else if (panels) {
    baseTotal = panels.names.length;
    for (const name of panels.names) if (panels.ok(name)) baseOk++;
    pct = Math.round(63 * baseOk / baseTotal);
  } else pct = statusPct(obj.status);
  pct = Math.max(0, pct - Math.min(8, flags.length));
  const tier = tierOf(id, obj);
  return {
    ...base, structural: dedupe(structural), flags, session, ticker,
    asof: minutesOf(obj.generatedAt), tier, pct, baseOk, baseTotal, quality: pct * 4 + tier,
  };
}

export const tupleOf = (m) => [
  Number(m && m.epoch) || 0, (m && typeof m.session === "string" && m.session) || "", Number(m && m.quality) || 0, Number(m && m.asof) || 0,
];

export function compareTuple(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

export function casVerdict(stored, incoming) {
  if (!stored) return "new";
  if (typeof stored.chash === "string" && stored.chash === incoming.chash) return "unchanged";
  return compareTuple(tupleOf(incoming), tupleOf(stored)) >= 0 ? "advance" : "superseded";
}

export function regressionOf(stored, incoming) {
  if (!stored || !incoming || incoming.baseTotal < DOOR_LIMITS.regressionMinPanels) return false;
  const was = Math.floor((Number(stored.quality) || 0) / 4);
  if (!(was > 0) || !(typeof stored.session === "string" && stored.session !== "" && incoming.session !== null && stored.session < incoming.session)) return false;
  return incoming.pct < was * (1 - DOOR_LIMITS.regressionDrop);
}

export function assess(incoming, stored, { producerEpoch = null, hashMismatch = false } = {}) {
  const would = [];
  if (hashMismatch) would.push({ code: "hash_mismatch", path: "header" });
  for (const item of incoming.structural) would.push(item);
  if (stored && COLLAPSE_PRODUCTS.includes(incoming.product) && Number(stored.bytes) > 0 && incoming.bytes < Number(stored.bytes) * DOOR_LIMITS.collapseFloor) {
    would.push({ code: "size_collapse", path: incoming.bytes + "/" + Number(stored.bytes) });
  }
  if (producerEpoch !== null && producerEpoch < incoming.epoch) would.push({ code: "stale_producer", path: String(producerEpoch) + "<" + incoming.epoch });
  if (regressionOf(stored, incoming)) would.push({ code: "regression", path: Math.floor((Number(stored.quality) || 0) / 4) + ">" + incoming.pct });
  const cas = casVerdict(stored, incoming);
  if (cas === "superseded") would.push({ code: "superseded", path: tupleOf(stored).join(",") + ">" + tupleOf(incoming).join(",") });
  const rank = (code) => WOULD_ORDER.indexOf(code);
  would.sort((a, b) => rank(a.code) - rank(b.code));
  return { cas, would: dedupe(would) };
}

export function membershipFlag(ticker, names) {
  if (ticker === null || !Array.isArray(names)) return null;
  return names.includes(ticker) ? null : { code: "not_in_universe", path: ticker };
}

export function planOf(body, now) {
  if (!isObj(body)) return { ok: false, code: "invalid_shape", path: "$" };
  if (!isDay(body.session)) return { ok: false, code: "session_format", path: "session" };
  const horizon = horizonSession(now);
  if (horizon !== null && body.session > horizon) return { ok: false, code: "session_future", path: "session" };
  if (!Array.isArray(body.names) || body.names.length > DOOR_LIMITS.planNames) return { ok: false, code: "invalid_shape", path: "names" };
  const names = new Set();
  for (const name of body.names) {
    if (typeof name !== "string" || !TICKER_RE.test(name)) return { ok: false, code: "ticker_grammar", path: "names" };
    names.add(name);
  }
  return { ok: true, session: body.session, names: [...names].sort() };
}
