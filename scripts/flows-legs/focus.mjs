import { STRIP_FIELDS, stripValues } from "../../shared/flows-live.js";
import { FOCUS_FIELDS, FOCUS_BUDGET_BYTES, FOCUS_NAME_CHARS, focusGroups, focusTickers } from "../../shared/flows-focus.js";

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
  readAt = null, fresh = null, budgetBytes = FOCUS_BUDGET_BYTES, backfill = null, backfillFrom = "harvest",
  backfillReadAt = null,
} = {}) {
  const groups = focusGroups(ndx);
  const asked = focusTickers({ groups });
  const base = {
    v: 1, sessionDate, generatedAt, readAt,
    fresh: fresh || { v: 1, readAt, vendorAt: null, source: "nightly", cadenceS: 0, session: sessionDate, writer: "flows-pipeline" },
    fields: FOCUS_FIELDS.slice(),
    groups,
  };
  const primary = read && read.ok !== false && rows instanceof Map ? rows : new Map();
  const spare = backfill instanceof Map ? backfill : new Map();
  if (!asked.some((t) => primary.has(t) || spare.has(t))) {
    const reason = read && read.ok === false ? (read.gated ? "plan_gated" : "unreadable") : "empty";
    return { ...base, status: "unavailable", reason, detail: read && read.error ? String(read.error).slice(0, 200) : null,
      rows: {}, missing: asked.slice() };
  }
  const out = {};
  const closes = {};
  const missing = [];
  const filled = [];
  for (const t of asked) {
    const row = primary.get(t) || spare.get(t);
    if (!row) { missing.push(t); continue; }
    if (!primary.has(t)) filled.push(t);
    out[t] = focusRow(row);
    const c = closesOf(t);
    if (Array.isArray(c) && c.length) closes[t] = c;
  }
  const payload = { ...base, status: Object.keys(out).length ? "ok" : "unavailable", rows: out, closes, missing };
  if (filled.length) {
    payload.backfill = { from: backfillFrom, readAt: backfillReadAt, tickers: filled,
      why: read && read.ok === false ? (read.gated ? "plan_gated" : "unreadable") : "not_returned" };
  }
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
