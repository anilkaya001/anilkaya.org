import { CARD_SCHEMA_VERSION } from "./flows-card.js";
import {
  CARD_DEPTHS, DAY_GRAMMAR, DEPTHS, SYNTHETIC_GRAMMAR, TICKER_GRAMMAR, VOLATILE, productOf, tickerOfKey,
} from "./flows-products.js";

export const CODES = Object.freeze({
  notObject: "not_object",
  nonFinite: "non_finite",
  badKey: "bad_key",
  tickerMismatch: "ticker_mismatch",
  synthetic: "synthetic_refused",
  schemaVersion: "schema_version",
  badSession: "bad_session",
  badStamp: "bad_stamp",
  missing: "missing_field",
  badShape: "bad_shape",
  keySession: "key_session_mismatch",
});

export const CARD_CORE_PANELS = Object.freeze(["gamma", "levels", "context", "pricedMove"]);

export const CARD_PANELS = Object.freeze([
  "gamma", "surface", "levels", "scoreOverlay", "premiumTrack", "ivSurface", "skewTerm", "topContracts", "aggressor", "path", "calendar",
  "vanna", "charm", "deltaExposure", "displacement", "pricedMove", "context", "congress", "marketRank", "darkpool", "oiDeltas", "volContext",
  "variation",
]);

export const PANEL_STATUSES = Object.freeze(["ok", "quiet", "unavailable", "pending", "stale"]);

export const ROSTER_DEPTHS = Object.freeze(DEPTHS.filter((d) => d !== "screen"));

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function isDay(v) {
  if (typeof v !== "string" || !DAY_GRAMMAR.test(v)) return false;
  const t = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export const isStamp = (v) => typeof v === "string" && STAMP.test(v) && Number.isFinite(Date.parse(v));

const MAX_DEPTH = 48;

function scan(root, { allowSynthetic }) {
  const found = { nonFinite: null, synthetic: null };
  const path = [];
  const here = () => path.join(".") || "$";
  const visit = (node, depth) => {
    if (found.nonFinite && (found.synthetic || allowSynthetic)) return;
    if (depth > MAX_DEPTH) return;
    if (typeof node === "number") {
      if (!Number.isFinite(node) && !found.nonFinite) found.nonFinite = here();
      return;
    }
    if (typeof node === "string") {
      if (!allowSynthetic && !found.synthetic && SYNTHETIC_GRAMMAR.test(node)) found.synthetic = here();
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        path.push(String(i));
        visit(node[i], depth + 1);
        path.pop();
        if (found.nonFinite && (found.synthetic || allowSynthetic)) return;
      }
      return;
    }
    for (const k of Object.keys(node)) {
      path.push(k);
      if (!allowSynthetic && !found.synthetic && SYNTHETIC_GRAMMAR.test(k)) found.synthetic = here();
      visit(node[k], depth + 1);
      path.pop();
      if (found.nonFinite && (found.synthetic || allowSynthetic)) return;
    }
  };
  visit(root, 0);
  return found;
}

function tickerList(list, path, out, label) {
  if (!Array.isArray(list)) {
    out.push({ code: CODES.badShape, path });
    return;
  }
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== "string" || !TICKER_GRAMMAR.test(list[i])) {
      out.push({ code: CODES.badShape, path: `${path}.${i}`, detail: label });
      return;
    }
  }
}

function sessionAndStamp(p, payload, structural, { stamp = true } = {}) {
  if (!isDay(payload.sessionDate)) structural.push({ code: CODES.badSession, path: "sessionDate" });
  if (stamp && payload.generatedAt !== undefined && !isStamp(payload.generatedAt)) structural.push({ code: CODES.badStamp, path: "generatedAt" });
  if (stamp && payload.generatedAt === undefined && p.required.includes("generatedAt")) structural.push({ code: CODES.missing, path: "generatedAt" });
}

function requireFields(p, payload, structural) {
  for (const f of p.required) if (payload[f] === undefined || payload[f] === null) structural.push({ code: CODES.missing, path: f });
}

function cardRules(key, payload, structural, flags, ctx) {
  const t = tickerOfKey(key);
  if (payload.ticker !== t) structural.push({ code: CODES.tickerMismatch, path: "ticker" });
  if (!Number.isInteger(payload.v) || payload.v < 2 || payload.v > CARD_SCHEMA_VERSION) structural.push({ code: CODES.schemaVersion, path: "v" });
  if (!CARD_DEPTHS.includes(payload.depth)) structural.push({ code: CODES.badShape, path: "depth" });
  if (!isObject(payload.panels)) {
    structural.push({ code: CODES.badShape, path: "panels" });
    return { baseOk: null, tier: 0 };
  }
  let good = 0;
  let total = 0;
  for (const [name, panel] of Object.entries(payload.panels)) {
    if (!isObject(panel) || !PANEL_STATUSES.includes(panel.status)) {
      structural.push({ code: CODES.badShape, path: `panels.${name}` });
      continue;
    }
    total++;
    if (panel.status === "ok") good++;
  }
  for (const name of CARD_CORE_PANELS) if (!Object.hasOwn(payload.panels, name)) structural.push({ code: CODES.missing, path: `panels.${name}` });
  for (const name of CARD_PANELS) if (!Object.hasOwn(payload.panels, name)) flags.push({ code: "panel_absent", path: `panels.${name}` });
  if (ctx.universe && !ctx.universe.has(t)) flags.push({ code: "not_in_universe", path: "ticker" });
  const engine = payload.engine || null;
  const tier = good === 0 ? 0 : !engine ? 1 : isObject(engine) && engine.state ? 3 : 2;
  return { baseOk: { ok: good, of: total }, tier };
}

function universeRules(payload, structural, flags) {
  const n = payload.n;
  if (!Number.isInteger(n) || n < 0) structural.push({ code: CODES.badShape, path: "n" });
  tickerList(payload.t, "t", structural, "universe name");
  if (Array.isArray(payload.t) && Number.isInteger(n) && payload.t.length !== n) structural.push({ code: CODES.badShape, path: "t.length" });
  if (!isObject(payload.cols)) {
    structural.push({ code: CODES.badShape, path: "cols" });
    return;
  }
  if (!isObject(payload.units)) structural.push({ code: CODES.badShape, path: "units" });
  for (const [k, col] of Object.entries(payload.cols)) {
    if (!Array.isArray(col) || (Number.isInteger(n) && col.length !== n)) structural.push({ code: CODES.badShape, path: `cols.${k}` });
    else if (isObject(payload.units) && !Array.isArray(payload.units[k])) structural.push({ code: CODES.badShape, path: `units.${k}` });
  }
  if (isObject(payload.pct)) {
    for (const [k, col] of Object.entries(payload.pct)) {
      if (!Array.isArray(col) || (Number.isInteger(n) && col.length !== n)) structural.push({ code: CODES.badShape, path: `pct.${k}` });
    }
  }
  const px = payload.cols.px;
  if (Array.isArray(px) && px.some((v) => typeof v === "number" && v <= 0)) flags.push({ code: "px_not_positive", path: "cols.px" });
  const chg = payload.cols.chg;
  const scale = Array.isArray(payload.units && payload.units.chg) ? Number(payload.units.chg[1]) : 0;
  if (Array.isArray(chg) && scale > 0 && chg.some((v) => typeof v === "number" && (v / scale < -0.95 || v / scale > 10))) {
    flags.push({ code: "chg_out_of_range", path: "cols.chg" });
  }
}

function rosterRules(payload, structural) {
  if (!isObject(payload.depth)) structural.push({ code: CODES.badShape, path: "depth" });
  else {
    for (const [t, d] of Object.entries(payload.depth)) {
      if (!TICKER_GRAMMAR.test(t) || !ROSTER_DEPTHS.includes(d)) {
        structural.push({ code: CODES.badShape, path: `depth.${t}` });
        break;
      }
    }
  }
  if (!isObject(payload.session)) structural.push({ code: CODES.badShape, path: "session" });
  else {
    for (const [t, d] of Object.entries(payload.session)) {
      if (!isDay(d)) {
        structural.push({ code: CODES.badSession, path: `session.${t}` });
        break;
      }
    }
  }
}

function boardRules(key, payload, structural) {
  const side = /^board:(long|short)/.exec(key);
  if (side && payload.side !== side[1]) structural.push({ code: CODES.badShape, path: "side" });
  if (!Array.isArray(payload.rows)) {
    structural.push({ code: CODES.badShape, path: "rows" });
    return;
  }
  for (let i = 0; i < payload.rows.length; i++) {
    const r = payload.rows[i];
    if (!isObject(r) || typeof r.t !== "string" || !TICKER_GRAMMAR.test(r.t)) {
      structural.push({ code: CODES.badShape, path: `rows.${i}.t` });
      return;
    }
  }
}

export function validate(key, payload, ctx = {}) {
  const p = productOf(key);
  const structural = [];
  const flags = [];
  const out = { key, product: p ? p.id : null, structural, flags, baseOk: null, tier: 0, ok: false };
  if (!p) {
    structural.push({ code: CODES.badKey, path: "key" });
    return out;
  }
  if (!isObject(payload)) {
    structural.push({ code: CODES.notObject, path: "$" });
    return out;
  }
  const allowSynthetic = ctx.allowSynthetic === true;
  const t = tickerOfKey(key);
  if (!allowSynthetic && (payload.fixture === true || (t !== null && SYNTHETIC_GRAMMAR.test(t)))) {
    structural.push({ code: CODES.synthetic, path: payload.fixture === true ? "fixture" : "key" });
  }
  const seen = scan(payload, { allowSynthetic });
  if (seen.nonFinite) structural.push({ code: CODES.nonFinite, path: seen.nonFinite });
  if (seen.synthetic && !structural.some((s) => s.code === CODES.synthetic)) structural.push({ code: CODES.synthetic, path: seen.synthetic });

  if (p.family === "live") {
    if (payload.key !== undefined && payload.key !== key) structural.push({ code: CODES.badKey, path: "key" });
  } else {
    requireFields(p, payload, structural);
    sessionAndStamp(p, payload, structural);
    if (p.family === "name") {
      if (payload.ticker !== t && p.id !== "card") structural.push({ code: CODES.tickerMismatch, path: "ticker" });
      if (p.id === "card") {
        const read = cardRules(key, payload, structural, flags, ctx);
        out.baseOk = read.baseOk;
        out.tier = read.tier;
      }
    } else if (p.id === "universe") universeRules(payload, structural, flags);
    else if (p.id === "roster") rosterRules(payload, structural);
    else if (p.id === "meta") {
      if (!Array.isArray(payload.stages)) structural.push({ code: CODES.badShape, path: "stages" });
    } else if (p.id.startsWith("board:") || p.id === "board:dated" || p.id === "scores:dated") boardRules(key, payload, structural);
    if (p.family === "dated") {
      const day = /(\d{4}-\d{2}-\d{2})/.exec(key);
      if (day && payload.sessionDate !== day[1] && !/^ideas/.test(key)) structural.push({ code: CODES.keySession, path: "sessionDate" });
    }
  }
  out.ok = structural.length === 0;
  return out;
}

export function checkPayload(key, payload, ctx = {}) {
  const v = validate(key, payload, ctx);
  return v.ok ? { ok: true } : { ok: false, code: v.structural[0].code, path: v.structural[0].path };
}

const sortKeys = (value, drop) => {
  if (Array.isArray(value)) return value.map((x) => sortKeys(x, drop));
  if (!isObject(value)) return value;
  const out = {};
  for (const k of Object.keys(value).sort()) if (!drop.has(k)) out[k] = sortKeys(value[k], drop);
  return out;
};

export function canonical(payload, product = null) {
  const drop = new Set(product && Array.isArray(product.volatile) ? product.volatile : VOLATILE);
  return JSON.stringify(sortKeys(payload, drop));
}

export async function canonicalHash(payload, product = null) {
  const bytes = new TextEncoder().encode(canonical(payload, product));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
