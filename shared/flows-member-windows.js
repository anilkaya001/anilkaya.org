import { windowEntry, tally, leanRead } from "./flows-sides.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

export const tickerOf = (v) => (typeof v === "string" && TICKER.test(v) ? v : null);

export const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function dedupeWindows(rows) {
  const best = new Map();
  const order = [];
  rows.forEach((r, i) => {
    const oc = typeof r.oc === "string" && r.oc ? r.oc : null;
    const start = typeof r.spanStart === "string" && r.spanStart ? r.spanStart : null;
    const key = oc !== null && start !== null ? r.t + "\u0000" + oc + "\u0000" + start + "\u0000" + (typeof r.spanEnd === "string" ? r.spanEnd : "") : "row" + i;
    const kept = best.get(key);
    if (kept === undefined) {
      best.set(key, r);
      order.push(key);
      return;
    }
    const a = num(r.prem);
    const b = num(kept.prem);
    if (a !== null && (b === null || a > b)) best.set(key, r);
  });
  return order.map((k) => best.get(k));
}

export function windowsByTicker(flow, keep = () => true) {
  const by = new Map();
  if (!isObj(flow) || !Array.isArray(flow.rows)) return by;
  for (const r of flow.rows) {
    const t = tickerOf(r && r.t);
    if (t === null || !keep(r)) continue;
    if (!by.has(t)) by.set(t, []);
    by.get(t).push(r);
  }
  for (const [t, list] of by) by.set(t, dedupeWindows(list));
  return by;
}

export const flowSession = (flow) => (isObj(flow) ? dayOf(isObj(flow.record) ? flow.record.date : null) || dayOf(flow.sessionDate) : null);

export function shedOf(flow) {
  const top = num(flow && flow.shed);
  const rec = isObj(flow && flow.record) ? num(flow.record.shed) : null;
  return top === null && rec === null ? null : Math.max(top === null ? 0 : top, rec === null ? 0 : rec);
}

export function capped(flow) {
  const shed = shedOf(flow);
  return shed === null || shed > 0;
}

export function pooled(rows) {
  const entries = rows.map(windowEntry);
  const { totals } = tally(entries);
  let floorT = 0;
  let sweepT = 0;
  let floorMissing = false;
  let sweepMissing = false;
  entries.forEach((entry, i) => {
    if (!entry.ok || entry.T === 0) return;
    const f = rows[i].floor;
    const s = rows[i].sweep;
    if (f === true) floorT += entry.T; else if (f !== false) floorMissing = true;
    if (s === true) sweepT += entry.T; else if (s !== false) sweepMissing = true;
  });
  return { totals, read: leanRead(totals), floorT, sweepT, floorMissing, sweepMissing };
}
