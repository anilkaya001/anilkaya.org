import { pathFor } from "./flows-vendor-ops.js";
import { rowsOf } from "./flows-rows.js";
import { instantOf } from "./flows-time.js";
import { cleanLabel } from "./flows-dossier.js";
import { sha256Hex } from "./flows-targets.js";

export const NOTI_TYPES = Object.freeze(["stock", "news", "earnings", "dividends", "splits", "option_contract", "price_target", "analyst_rating", "option_contract_interval", "insider_trades", "trading_state", "fda", "economic_release", "politician_trades", "market_tide", "sec_filings", "flow_alerts", "chain_oi_change", "gex"]);

export const GRAMMAR_TARGETS = Object.freeze(["flow_alert", "option_trade", "option_contract", "ticker_interval_flow", "news", "trading_state", "multi_leg_trade"]);

export const TYPE_TARGETS = Object.freeze({ trading_state: "trading_state", flow_alerts: "flow_alert", chain_oi_change: "option_contract" });

export const FIELDS_PER_TYPE = 24;
export const FIELDS_PER_TARGET = 80;
export const HALT_ROWS = 120;
export const CONFIG_KEYS = 12;

const NAME = /^[a-z][a-z0-9_]{0,40}$/;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function fieldNames(node) {
  if (Array.isArray(node)) {
    return node.map((x) => (typeof x === "string" ? x : isObj(x) && typeof x.name === "string" ? x.name : null)).filter((x) => x && NAME.test(x));
  }
  if (isObj(node)) return Object.keys(node).filter((k) => NAME.test(k));
  return [];
}

const perDayOf = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : typeof v === "string" && /^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : null);

export function reduceFilters(raw) {
  const d = raw;
  if (!isObj(d)) return { fail: "unshaped" };
  const desc = isObj(d.noti_type_descriptions) ? d.noti_type_descriptions : {};
  const data = isObj(d.data) ? d.data : {};
  const access = isObj(d.access) ? d.access : {};
  const limits = isObj(d.rate_limits) ? d.rate_limits : {};
  const keys = new Set([...Object.keys(desc), ...Object.keys(data)]);
  let unknownTypes = 0;
  const types = [];
  for (const id of NOTI_TYPES) {
    if (!keys.has(id)) continue;
    const dv = desc[id];
    const label = cleanLabel(typeof dv === "string" ? dv : isObj(dv) && typeof dv.description === "string" ? dv.description : id, 60);
    types.push({
      id, label,
      can: access[id] === true ? true : access[id] === false ? false : null,
      perDay: perDayOf(limits[id]),
      fields: [...new Set(fieldNames(data[id]))].slice(0, FIELDS_PER_TYPE),
      target: TYPE_TARGETS[id] || null,
    });
  }
  for (const k of keys) if (!NOTI_TYPES.includes(k)) unknownTypes++;
  if (!types.length) return { fail: keys.size ? "unshaped" : "empty" };
  return { ok: true, types, unknownTypes };
}

const TYPENAME = /^[a-z][a-z0-9_]{0,30}$/;

function walk(node, out, depth) {
  if (depth > 8 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const x of node) walk(x, out, depth + 1); return; }
  if (typeof node.name === "string" && typeof node.type === "string" && NAME.test(node.name) && TYPENAME.test(node.type)) out.set(node.name, node.type);
  for (const [k, v] of Object.entries(node)) {
    if (isObj(v) && typeof v.type === "string" && NAME.test(k) && TYPENAME.test(v.type) && typeof v.name !== "string") out.set(k, v.type);
    walk(v, out, depth + 1);
  }
}

export function reduceGrammar(overview, perTarget) {
  const per = isObj(perTarget) ? perTarget : {};
  const targets = [];
  for (const id of GRAMMAR_TARGETS) {
    const body = per[id];
    if (body === undefined || body === null || (isObj(body) && typeof body.fail === "string")) {
      targets.push({ id, fields: null, why: isObj(body) && typeof body.fail === "string" ? body.fail : "unread" });
      continue;
    }
    const found = new Map();
    walk(body, found, 0);
    targets.push({ id, fields: [...found.entries()].slice(0, FIELDS_PER_TARGET) });
  }
  return { ok: true, targets, overview: isObj(overview) ? 1 : 0 };
}

export function reduceConfigs(raw) {
  const rows = rowsOf(raw, "data");
  if (!Array.isArray(raw) && !(isObj(raw) && Array.isArray(raw.data))) return { fail: "unshaped" };
  const configs = [];
  for (const r of rows) {
    if (!isObj(r) || (typeof r.id !== "string" && !Number.isFinite(r.id))) continue;
    const type = NOTI_TYPES.includes(r.noti_type) ? r.noti_type : null;
    if (!type) continue;
    configs.push({
      k: sha256Hex(String(r.id)).slice(0, 12),
      type,
      status: r.status === "active" || r.status === "rate_limit" || r.status === "paused" ? r.status : null,
      label: cleanLabel(r.name, 40),
      keys: isObj(r.config) ? Object.keys(r.config).filter((k) => NAME.test(k)).sort().slice(0, CONFIG_KEYS) : [],
    });
  }
  return { ok: true, configs };
}

export function reduceFired(raw, from) {
  const floor = typeof from === "number" ? from : instantOf(from);
  const rows = rowsOf(raw, "data");
  const out = [];
  const fired = {};
  let dropped = 0;
  for (const r of rows) {
    if (!isObj(r)) { dropped++; continue; }
    const type = NOTI_TYPES.includes(r.noti_type) ? r.noti_type : null;
    const created = instantOf(typeof r.created_at === "string" ? r.created_at : null);
    if (!type || created === null) { dropped++; continue; }
    if (floor !== null && created < floor) continue;
    fired[type] = (fired[type] || 0) + 1;
    if (type !== "trading_state") continue;
    const meta = isObj(r.meta) ? r.meta : {};
    const t = typeof r.symbol === "string" && SYMBOL.test(r.symbol.trim()) ? r.symbol.trim() : null;
    if (!t) { dropped++; continue; }
    const state = typeof meta.state === "string" && /^[a-z_]{1,20}$/.test(meta.state) ? meta.state : null;
    const reason = typeof meta.reason === "string" && /^[A-Z0-9]{0,6}$/.test(meta.reason) ? meta.reason : null;
    const metaAt = typeof meta.time === "string" ? instantOf(meta.time) : null;
    out.push({ t, at: new Date(metaAt === null ? created : metaAt).toISOString(), state, reason });
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return { rows: out, fired, dropped };
}

export function halts14(fired, configs) {
  const rows = (fired && Array.isArray(fired.rows) ? fired.rows : []).slice(0, HALT_ROWS);
  const configured = Array.isArray(configs) ? configs.some((c) => c && c.type === "trading_state") : null;
  return { configured, rows };
}

export const HALT_CHANNEL = pathFor("socket-halts", {});
