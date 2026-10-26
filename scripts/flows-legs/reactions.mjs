import { read, rowsOf, pastDeadline } from "./common.mjs";
import { pathFor } from "../../shared/flows-vendor-ops.js";
import {
  reactionPlan, coveredDays, observeCalendar, mergeObservations, observeHistory, CALENDAR_LIMIT, CALENDAR_PAGES,
} from "../../shared/flows-reports.js";

export const reactionKey = (step) => `${step.route}|${step.date}`;

const first = (rows) => {
  const r = Array.isArray(rows) && rows.length ? rows[0] : null;
  return r && typeof r === "object" ? String(r.symbol || r.ticker || "") + "|" + String(r.report_date || "") : null;
};

export async function readCalendarDay(uw, route, date, { deadline = null, limit = CALENDAR_LIMIT, pages = CALENDAR_PAGES } = {}) {
  const path = pathFor(route === "premarket" ? "earnings-premarket" : "earnings-afterhours");
  const rows = [];
  let calls = 0, cut = false, failed = null, last = null;
  for (let page = 0; page < pages; page++) {
    if (pastDeadline(deadline)) { failed = failed || { ok: false, body: null, status: null, error: "past the run deadline", skipped: true }; break; }
    calls++;
    const res = await read(uw, path, { date, limit, ...(page ? { page } : {}) });
    if (!res.ok) { failed = res; break; }
    const got = rowsOf(res.body);
    if (got === null) { failed = { ok: false, body: null, status: 200, error: "the body carried no rows" }; break; }
    const head = first(got);
    if (page > 0 && head !== null && head === last) { cut = true; break; }
    last = head;
    rows.push(...got);
    if (got.length < limit) return { res: { ok: true, body: { data: rows }, status: 200, error: null }, calls, cut: false, pages: page + 1 };
    if (page === pages - 1) cut = true;
  }
  if (failed) return { res: failed, calls, cut: false, pages: 0 };
  return { res: { ok: true, body: { data: rows }, status: 200, error: null }, calls, cut, pages };
}

export async function readReactions(uw, { sessionDate = null, ledgerAsOf = null, deadline = null } = {}) {
  const plan = reactionPlan(sessionDate, ledgerAsOf);
  const steps = [];
  let calls = 0;
  for (const step of plan) {
    const got = await readCalendarDay(uw, step.route, step.date, { deadline });
    calls += got.calls;
    steps.push({ ...step, res: got.res, ok: got.res.ok === true, cut: got.cut, pages: got.pages });
  }
  const cov = coveredDays(steps);
  return { steps, calls, covered: cov.covered, cut: cov.cut, byKey: new Map(steps.map((s) => [reactionKey(s), s])) };
}

export function reactionObservations(steps, asOf) {
  const maps = [];
  for (const s of steps) {
    if (!s.ok) continue;
    maps.push(observeCalendar(rowsOf(s.res.body) || [], s.route, s.date, asOf));
  }
  return mergeObservations(maps);
}

export function historyObservations(earnings, asOf) {
  const out = new Map();
  for (const [t, res] of earnings instanceof Map ? earnings : []) {
    if (!res || !res.ok) continue;
    const o = observeHistory(rowsOf(res.body) || [], asOf);
    if (o) out.set(t, o);
  }
  return out;
}
