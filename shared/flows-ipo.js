import { vstr, isoDay, addDays, SILENCE } from "./flows-cross.js";
import { cleanLabel } from "./flows-dossier.js";

export const IPO_HORIZON_DAYS = 92;

export const IPO_ROWS = 40;

export const IPO_NAME_CAP = 60;

const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

const CURRENCY = /^[A-Z]{3}$/;

const dayMs = (d) => Date.parse(d + "T00:00:00Z");

export function ipoTicker(v) {
  const t = vstr(v);
  if (t === null) return null;
  const u = t.trim().toUpperCase();
  return TICKER.test(u) ? u : null;
}

export function ipoCurrency(v) {
  const c = vstr(v);
  if (c === null) return null;
  const u = c.trim().toUpperCase();
  return CURRENCY.test(u) ? u : null;
}

const price = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function ipoRange(row) {
  const lo = price(row && row.price_range_low);
  const hi = price(row && row.price_range_high);
  const cur = ipoCurrency(row && row.currency);
  if (lo === null && hi === null) return { lo: null, hi: null, cur, why: "unpriced" };
  if (lo === null || hi === null || lo > hi) return { lo: null, hi: null, cur, why: "range" };
  if (cur === null) return { lo: null, hi: null, cur: null, why: "currency" };
  return { lo, hi, cur, why: null };
}

export function shapeIpoCalendar(body, { sessionDate = null, horizonDays = IPO_HORIZON_DAYS, cap = IPO_ROWS } = {}) {
  const data = body && typeof body === "object" && !Array.isArray(body) ? body.data : null;
  const list = data && typeof data === "object" && Array.isArray(data.ipos) ? data.ipos : null;
  if (list === null) return { status: "unavailable", reason: SILENCE.unreadable, why: "unshaped" };
  const start = isoDay(sessionDate) ? sessionDate : null;
  const end = start ? addDays(start, horizonDays) : null;
  const out = [];
  const seen = new Set();
  const counts = { undated: 0, past: 0, outside: 0, unnamed: 0, duplicate: 0, unpriced: 0, range: 0, currency: 0 };
  for (const r of list) {
    if (!r || typeof r !== "object") { counts.unnamed++; continue; }
    const d = isoDay(r.ipo_date);
    if (d === null) { counts.undated++; continue; }
    if (start && d < start) { counts.past++; continue; }
    if (end && d > end) { counts.outside++; continue; }
    const t = ipoTicker(r.ticker);
    const name = cleanLabel(r.name, IPO_NAME_CAP);
    if (t === null && name === null) { counts.unnamed++; continue; }
    const key = `${t || ""}|${name || ""}|${d}`;
    if (seen.has(key)) { counts.duplicate++; continue; }
    seen.add(key);
    const range = ipoRange(r);
    if (range.why) counts[range.why]++;
    out.push({
      t, name, ex: cleanLabel(r.exchange, 24), d,
      dd: start ? (dayMs(d) - dayMs(start)) / 864e5 : null,
      lo: range.lo, hi: range.hi, cur: range.cur, why: range.why,
    });
  }
  out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : String(a.t || a.name).localeCompare(String(b.t || b.name))));
  return {
    status: out.length ? "ok" : "quiet",
    ...(out.length ? {} : { reason: SILENCE.absent }),
    rows: out.slice(0, cap),
    kept: Math.min(out.length, cap), inWindow: out.length, read: list.length,
    ...counts,
    horizonDays,
    rule: "listings the feed dates on or after the session and within the horizon; a price range is kept only when both ends are positive, ordered, and the row states its currency",
  };
}
