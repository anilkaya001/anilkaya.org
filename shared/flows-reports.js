import { impactSession, sessionsBetween, addSessions, covered } from "./flows-calendar.js";
import { RD_MAX } from "./flows-horizon.js";

export const RD_RECENT = 5;
export const SAME_REPORT = 10;
export const BACKFILL_MAX = 5;
export const LEDGER_V = 1;
export const UNSTATED_MAX = 5;
export const LIST_MAX = 40;
export const CALENDAR_LIMIT = 100;
export const CALENDAR_PAGES = 4;

const TIMINGS = Object.freeze({ premarket: "before-open", bmo: "before-open", postmarket: "after-close", amc: "after-close" });
const CODES = Object.freeze(["unknown", "before-open", "after-close"]);
const DAY_MS = 86400000;
const dayNum = (iso) => Date.parse(iso + "T00:00:00Z") / DAY_MS;
const isoOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const whole = (v) => Number.isInteger(v);

export function timingOf(raw) {
  return TIMINGS[typeof raw === "string" ? raw.trim().toLowerCase() : ""] || "unknown";
}

export function isReport(row) {
  if (!row || typeof row !== "object" || typeof row.report_date !== "string") return false;
  return row.source === "company" || (row.actual_eps !== null && row.actual_eps !== undefined) ||
    (row.post_earnings_move_1d !== null && row.post_earnings_move_1d !== undefined);
}

export function span(date, timing) {
  const first = impactSession(date, timing === "after-close" ? "postmarket" : "premarket");
  const last = impactSession(date, timing === "before-open" ? "premarket" : "postmarket");
  if (!first || !last) return null;
  return { early: first.day, late: last.day, certain: first.day === last.day };
}

function observe(date, timing, origin, fresh, asOf) {
  const s = span(date, timing);
  return s && s.early <= asOf ? { date, timing, origin, fresh, ...s } : null;
}

export function observeHistory(rows, asOf) {
  let best = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const o = isReport(row) ? observe(row.report_date, timingOf(row.report_time), "history", true, asOf) : null;
    if (o && (!best || o.date > best.date)) best = o;
  }
  return best;
}

export function observeCalendar(rows, route, date, asOf) {
  const timing = route === "premarket" ? "before-open" : "after-close";
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const t = row && typeof row === "object" ? row.symbol || row.ticker : null;
    if (typeof t !== "string" || !t) continue;
    const o = observe(typeof row.report_date === "string" ? row.report_date : date, timing, "calendar", true, asOf);
    if (o) out.set(t, o);
  }
  return out;
}

const rank = (o) => (o.timing === "unknown" ? 0 : 10) + (o.origin === "calendar" ? 2 : 0) + (o.fresh ? 1 : 0);

export function pick(a, b) {
  if (!a || !b) return a || b;
  const gap = sessionsBetween(a.early, b.early);
  if (gap === null) return b;
  if (Math.abs(gap) <= SAME_REPORT && rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b;
  return gap < 0 ? a : b;
}

export function rdOf(o, asOf) {
  if (!o) return { rd: null, why: "none" };
  const hi = sessionsBetween(o.early, asOf);
  if (hi === null) return { rd: null, why: "none" };
  if (!o.certain) return Math.max(hi - 1, 0) > RD_MAX ? { rd: null, why: "over" } : { rd: null, why: "timing", rdMax: hi };
  return hi > RD_MAX ? { rd: null, why: "over" } : { rd: hi, why: null };
}

export function mergeObservations(maps, log = []) {
  const out = new Map();
  for (const m of maps) {
    for (const [t, o] of m) {
      const had = out.get(t);
      const kept = had ? pick(had, o) : o;
      if (had && (had.date !== o.date || had.timing !== o.timing) && Math.abs(sessionsBetween(had.early, o.early)) <= SAME_REPORT) log.push({ t, kept: kept.date, dropped: (kept === had ? o : had).date });
      out.set(t, kept);
    }
  }
  return out;
}

export function mergeLedger(prior, fresh, { asOf, universe, next = new Map(), covered: coveredDays = new Set() }) {
  const before = prior && prior.rows instanceof Map ? prior : { asOf: null, rows: new Map() };
  const rows = new Map(), cells = new Map(), log = [];
  for (const t of universe) {
    const p = before.rows.get(t);
    const old = p && p.date ? observe(p.date, p.timing, p.origin, false, asOf) : null;
    const now = fresh.get(t) || null;
    let kept = pick(old, now);
    if (old && now && (old.date !== now.date || old.timing !== now.timing) && Math.abs(sessionsBetween(old.early, now.early)) <= SAME_REPORT) log.push({ t, kept: kept.date, dropped: (kept === old ? now : old).date });
    const due = p && p.next ? span(p.next, "unknown") : null;
    const gap = due && before.asOf && due.early > before.asOf && due.early <= asOf && !coveredDays.has(due.early);
    if (gap && !(kept && sessionsBetween(due.early, kept.early) > -SAME_REPORT)) {
      cells.set(t, { rd: null, why: "unconfirmed" });
      kept = null;
    } else cells.set(t, rdOf(kept, asOf));
    if (cells.get(t).why === "over") kept = null;
    const n = next.get(t) || null;
    if (kept || n) rows.set(t, { date: kept ? kept.date : null, timing: kept ? kept.timing : "unknown", origin: kept ? kept.origin : "history", next: n });
  }
  return { ledger: { asOf, rows }, cells, log };
}

export function basisOf(cells, { asOf, from = null, cutDays = [] }) {
  let known = 0, none = 0, over = 0;
  const unconfirmed = [], unstated = {};
  for (const [t, c] of cells) {
    if (c.rd !== null && c.rd !== undefined) known++;
    else if (c.why === "none") none++;
    else if (c.why === "over") over++;
    else if (c.why === "unconfirmed") unconfirmed.push(t);
    else if (c.why === "timing" && whole(c.rdMax) && c.rdMax >= 0 && c.rdMax <= UNSTATED_MAX) unstated[t] = c.rdMax;
  }
  const keys = Object.keys(unstated).sort();
  const cap = {};
  for (const k of keys.slice(0, LIST_MAX)) cap[k] = unstated[k];
  return {
    asOf, from, known, none, over,
    timing: [...cells.values()].filter((c) => c.why === "timing").length,
    unconfirmed: unconfirmed.sort().slice(0, LIST_MAX), unconfirmedN: unconfirmed.length,
    unstated: cap, unstatedN: keys.length,
    cut: [...cutDays].sort(),
  };
}

export function encodeLedger({ asOf, rows }) {
  const t = [...rows.keys()].sort();
  const base = dayNum(asOf);
  const r = (k) => rows.get(k);
  return {
    v: LEDGER_V, asOf, t,
    d: t.map((k) => (r(k).date ? base - dayNum(r(k).date) : null)),
    w: t.map((k) => (r(k).date ? CODES.indexOf(r(k).timing) + (r(k).origin === "calendar" ? 2 : 0) : null)),
    n: t.map((k) => (r(k).next ? dayNum(r(k).next) - base : null)),
  };
}

export function decodeLedger(raw) {
  const rows = new Map();
  if (!raw || typeof raw !== "object" || raw.v !== LEDGER_V || typeof raw.asOf !== "string" || !Number.isFinite(dayNum(raw.asOf)) || !Array.isArray(raw.t)) return { asOf: null, rows };
  const base = dayNum(raw.asOf);
  raw.t.forEach((k, i) => {
    if (typeof k !== "string" || !k) return;
    const d = raw.d && raw.d[i], w = raw.w && raw.w[i], n = raw.n && raw.n[i];
    const calendar = whole(w) && w > 2;
    const code = whole(w) ? (calendar ? w - 2 : w) : 0;
    rows.set(k, {
      date: whole(d) && d >= 0 ? isoOf(base - d) : null,
      timing: CODES[code] || "unknown",
      origin: calendar ? "calendar" : "history",
      next: whole(n) ? isoOf(base + n) : null,
    });
  });
  return { asOf: raw.asOf, rows };
}

export function reactionPlan(sessionDate, ledgerAsOf) {
  if (!covered(sessionDate)) return [];
  const raw = ledgerAsOf && covered(ledgerAsOf) ? sessionsBetween(ledgerAsOf, sessionDate) : 1;
  const gap = Math.min(Math.max(raw === null ? 1 : raw, 1), BACKFILL_MAX);
  const plan = [];
  for (let i = gap - 1; i >= 0; i -= 1) {
    const day = addSessions(sessionDate, -i);
    const before = day ? addSessions(day, -1) : null;
    if (!day || !before) continue;
    plan.push({ route: "premarket", date: day, role: "reaction", day }, { route: "afterhours", date: before, role: "reaction", day });
  }
  return plan;
}

export function coveredDays(steps) {
  const need = new Map();
  for (const s of steps) {
    if (s.role !== "reaction") continue;
    const e = need.get(s.day) || { n: 0, ok: 0 };
    e.n++;
    if (s.ok && !s.cut) e.ok++;
    need.set(s.day, e);
  }
  const days = new Set(), cut = new Set();
  for (const [day, e] of need) {
    if (e.n === 2 && e.ok === 2) days.add(day);
    else cut.add(day);
  }
  return { covered: days, cut: [...cut] };
}

export function cellOf(reports, ticker) {
  const c = reports && reports.cells instanceof Map ? reports.cells.get(ticker) : null;
  return c || { rd: null, why: "none" };
}
