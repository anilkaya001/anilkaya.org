import { read, rowsOf, silenceOf, pastDeadline } from "./common.mjs";
import {
  CALENDAR_SESSIONS, FDA_HORIZON_DAYS, earningsHistory, historyDigest, shapeEarningsCalendar,
  reactionGauge, shapeEconomicCalendar, shapeFdaCalendar,
} from "../../shared/flows-catalysts.js";
import { addDays, weekdaysAhead, priorWeekdayIso, vnum, compactNumbers, SILENCE } from "../../shared/flows-cross.js";

export const FDA_LIMIT = 200;

export function calendarPlan(sessionDate, { sessions = CALENDAR_SESSIONS } = {}) {
  if (!sessionDate) return [];
  const plan = [
    { route: "premarket", date: sessionDate, role: "reaction" },
    { route: "afterhours", date: priorWeekdayIso(sessionDate), role: "reaction" },
    { route: "afterhours", date: sessionDate, role: "upcoming" },
  ];
  for (const d of weekdaysAhead(sessionDate, sessions)) {
    plan.push({ route: "premarket", date: d, role: "upcoming" });
    plan.push({ route: "afterhours", date: d, role: "upcoming" });
  }
  return plan;
}

export async function readCatalysts(uw, {
  sessionDate = null, earningsTickers = [], deadline = null, pool = null, width = 1,
} = {}) {
  const raw = { calls: 0, calendar: [], earnings: new Map() };
  const get = async (path, params, opts) => {
    if (pastDeadline(deadline)) return { ok: false, body: null, status: null, error: "past the run deadline" };
    raw.calls++;
    return read(uw, path, params, opts);
  };
  raw.econ = await get("/api/market/economic-calendar", {});
  raw.fda = await get("/api/market/fda-calendar", {
    ...(sessionDate ? { target_date_min: sessionDate, target_date_max: addDays(sessionDate, FDA_HORIZON_DAYS) } : {}),
    limit: FDA_LIMIT,
  });
  for (const step of calendarPlan(sessionDate)) {
    const res = await get(`/api/earnings/${step.route}`, { date: step.date, limit: 100 });
    raw.calendar.push({ ...step, res });
  }
  const work = async (t) => {
    if (pastDeadline(deadline)) return;
    raw.calls++;
    raw.earnings.set(t, await read(uw, `/api/earnings/${t}`, {}));
  };
  const list = [...new Set(earningsTickers)];
  if (pool) await pool(list, work, { width, stopEarly: () => pastDeadline(deadline) });
  else for (const t of list) await work(t);
  return raw;
}

export function assembleCatalysts(raw, {
  sessionDate = null, carded = null, reportCatalysts = null, windowTickers = [], screenerByTicker = new Map(),
} = {}) {
  const r = raw || { calendar: [], earnings: new Map() };
  const macro = r.econ && r.econ.ok ? shapeEconomicCalendar(rowsOf(r.econ.body), { sessionDate })
    : silenceOf(r.econ || { ok: false, error: "not read" }, { what: "economic-calendar" });
  const fda = r.fda && r.fda.ok ? shapeFdaCalendar(rowsOf(r.fda.body), { sessionDate, carded })
    : silenceOf(r.fda || { ok: false, error: "not read" }, { what: "fda-calendar" });

  const sessions = new Map();
  const reactionRows = [];
  let tonight = null;
  let failed = 0;
  const impliedByTicker = new Map();
  for (const step of r.calendar || []) {
    if (!step.res.ok) { failed++; continue; }
    const shaped = shapeEarningsCalendar(rowsOf(step.res.body), { sessionDate });
    if (step.role === "reaction") { reactionRows.push(...shaped.rows); continue; }
    for (const row of shaped.rows) if (row.em !== null && !impliedByTicker.has(row.t)) impliedByTicker.set(row.t, { em: row.em, d: row.d, when: row.when });
    if (step.date === sessionDate && step.route === "afterhours") { tonight = shaped; continue; }
    if (!sessions.has(step.date)) sessions.set(step.date, { date: step.date, premarket: null, afterhours: null });
    sessions.get(step.date)[step.route] = shaped;
  }
  const calendar = {
    status: (r.calendar || []).some((s) => s.res.ok) ? "ok" : "unavailable",
    ...((r.calendar || []).length ? {} : { reason: SILENCE.unread }),
    tonight,
    sessions: [...sessions.values()],
    reaction: reactionGauge(reactionRows),
    failed,
    rule: "the two date-scoped routes read for the session's own reporters (reaction) and the next five sessions (upcoming)",
  };

  const earnings = new Map();
  for (const [t, res] of r.earnings || new Map()) {
    if (!res.ok) {
      earnings.set(t, { status: "unavailable", reason: res.gated ? SILENCE.gated : SILENCE.unreadable, http: res.status });
      continue;
    }
    const h = earningsHistory(rowsOf(res.body), { sessionDate });
    const implied = impliedByTicker.get(t) || null;
    const row = screenerByTicker.get(t);
    const vendorRatio = row ? vnum(row.rv_1d_last_12q) : null;
    earnings.set(t, {
      ...h,
      impliedNext: implied,
      ratioToday: implied && h.status === "ok" && h.medianAbsMove > 0 ? implied.em / h.medianAbsMove : null,
      vendorRatio,
    });
  }
  const history = {};
  for (const t of windowTickers) {
    const h = earnings.get(t);
    if (h) history[t] = historyDigest(h);
  }
  return {
    additions: compactNumbers({
      macro, fda, earningsCalendar: calendar,
      catalysts: reportCatalysts || { status: "unavailable", reason: SILENCE.unread },
      history,
      historyRule: "r = median |1d move| / expected move over the last reports; beat = share above 1; hit = share of long 1d straddles that paid; drift = median continuation",
    }),
    earnings,
  };
}
