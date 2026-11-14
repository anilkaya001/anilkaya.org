import { impactSession, sessionsBetween, addSessions, isSession } from "./flows-calendar.js";
import { boundaries, instantOf } from "./flows-time.js";
import { rowsOf } from "./flows-rows.js";
import { isoDay, addDays, easternDayOfInstant } from "./flows-cross.js";
import { cleanLabel } from "./flows-dossier.js";
import { centsOf } from "./flows-sides.js";

export const IPO_ROWS = 60;
export const LISTED_DAYS = 30;
export const LISTED_ROWS = 60;
export const DELISTED_ROWS = 60;

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;

const isoOf = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

export function impactInstant(d, when) {
  if (when !== "pre" && when !== "post") return null;
  const day = isoDay(d);
  if (!day || isSession(day) === null) return null;
  if (when === "post") {
    if (isSession(day) !== true) return null;
    const b = boundaries(day);
    return b ? isoOf(b.close.ms) : null;
  }
  const imp = impactSession(day, "premarket");
  if (!imp || !imp.day) return null;
  const b = boundaries(imp.day);
  return b ? isoOf(b.open.ms) : null;
}

export function phaseOf(instant) {
  const ms = instantOf(instant);
  if (ms === null) return null;
  const day = easternDayOfInstant(new Date(ms).toISOString());
  const b = day ? boundaries(day) : null;
  if (!b) return "closed";
  if (ms >= b.pre.ms && ms < b.open.ms) return "pre";
  if (ms >= b.open.ms && ms < b.close.ms) return "rth";
  if (ms >= b.close.ms && ms < b.post.ms) return "post";
  return "closed";
}

const tickerOf = (v) => {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase();
  return SYMBOL.test(t) ? t : null;
};

const cmpDT = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.t < b.t ? -1 : a.t > b.t ? 1 : 0);

const priceCents = (v) => {
  if (v === null || v === undefined) return null;
  const c = centsOf(typeof v === "number" ? String(v) : v);
  return c && Number.isSafeInteger(c.cents) ? c.cents : null;
};

export function ipoRows(raw, sessionDate) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) && raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
    ? raw.data.ipos : raw && raw.ipos;
  const list = Array.isArray(src) ? src : Array.isArray(raw) ? raw : [];
  const out = [];
  let dropped = 0;
  for (const r of list) {
    if (!r || typeof r !== "object") { dropped++; continue; }
    const d = isoDay(typeof r.ipo_date === "string" ? r.ipo_date : "");
    const t = tickerOf(r.ticker);
    if (!d || !t || d < sessionDate) { dropped++; continue; }
    const lo = priceCents(r.price_range_low);
    const hi = priceCents(r.price_range_high);
    const cur = typeof r.currency === "string" && /^[A-Za-z]{3}$/.test(r.currency.trim()) ? r.currency.trim().toUpperCase() : null;
    const row = { t, name: cleanLabel(r.name, 60), ex: cleanLabel(r.exchange, 12), d, lo, hi, cur, s: sessionsBetween(sessionDate, d) };
    if (lo !== null && hi !== null && lo > hi) row.badRange = 1;
    out.push(row);
  }
  out.sort(cmpDT);
  return { rows: out.slice(0, IPO_ROWS), total: out.length, dropped };
}

const kindOf = (v) => (typeof v === "string" && /^[A-Za-z][A-Za-z _-]{0,23}$/.test(v.trim()) ? v.trim().toLowerCase() : null);

export function listedRows(active, sessionDate) {
  const list = rowsOf(active && active.data !== undefined && !Array.isArray(active.data) ? active.data : active, "listings");
  const from = addDays(sessionDate, -LISTED_DAYS);
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const d = isoDay(typeof r.ipo_date === "string" ? r.ipo_date : "");
    const t = tickerOf(r.ticker);
    if (!d || !t || d > sessionDate || d <= from) continue;
    out.push({ t, name: cleanLabel(r.name, 60), ex: cleanLabel(r.exchange, 12), kind: kindOf(r.asset_type), d });
  }
  out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return { rows: out.slice(0, LISTED_ROWS), total: out.length };
}

export function delistedRows(reads, universe) {
  const known = universe instanceof Set ? universe : new Set(Array.isArray(universe) ? universe : []);
  const seen = new Set();
  const out = [];
  const days = [];
  for (const read of Array.isArray(reads) ? reads : []) {
    if (!read || !isoDay(read.date)) continue;
    days.push(read.date);
    const body = read.body && read.body.data !== undefined && !Array.isArray(read.body.data) ? read.body.data : read.body;
    for (const r of rowsOf(body, "listings")) {
      if (!r || typeof r !== "object") continue;
      const t = tickerOf(r.ticker);
      const d = isoDay(typeof r.delisting_date === "string" ? r.delisting_date : "") || read.date;
      if (!t) continue;
      const key = t + "|" + d;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ t, name: cleanLabel(r.name, 60), ex: cleanLabel(r.exchange, 12), kind: kindOf(r.asset_type), d, u: known.has(t) ? 1 : 0 });
    }
  }
  out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return { days: [...new Set(days)].sort(), rows: out.slice(0, DELISTED_ROWS), total: out.length };
}

export function sessionFloor(sessionDate, back) {
  const day = addSessions(sessionDate, -back);
  const b = day ? boundaries(day) : null;
  return b ? b.open.ms : null;
}
