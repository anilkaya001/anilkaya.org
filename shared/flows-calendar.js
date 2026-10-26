import { isSession as ruleSession } from "./flows-quant-time.js";
import { impactSession as leafImpact } from "./flows-targets.js";
import { HORIZON_SESSIONS, RD_MAX, AHEAD_SESSIONS, REACTION_BACK_SESSIONS, LIVE_ELAPSED_MAX, earningsState, earningsInside, horizonWords } from "./flows-horizon.js";

export { HORIZON_SESSIONS, RD_MAX, AHEAD_SESSIONS, REACTION_BACK_SESSIONS, LIVE_ELAPSED_MAX, earningsState, earningsInside, horizonWords };

export const CALENDAR_FIRST = "2024-01-01";
export const CALENDAR_LAST = "2027-12-31";
export const CALENDAR_LEAD_DAYS = 120;

const DAY_MS = 86400000;

const SESSIONS = [];
const FLOOR = new Map();
for (let ms = Date.parse(CALENDAR_FIRST + "T00:00:00Z"); ms <= Date.parse(CALENDAR_LAST + "T00:00:00Z"); ms += DAY_MS) {
  const day = new Date(ms).toISOString().slice(0, 10);
  if (ruleSession(day)) SESSIONS.push(day);
  FLOOR.set(day, SESSIONS.length - 1);
}
const INDEX = new Map(SESSIONS.map((day, i) => [day, i]));

export const SESSION_DAYS = Object.freeze(SESSIONS.slice());

export const covered = (day) => typeof day === "string" && FLOOR.has(day);

export const isSession = (day) => (covered(day) ? INDEX.has(day) : null);

export const sessionIndex = (day) => (INDEX.has(day) ? INDEX.get(day) : null);

export const sessionsBetween = (from, to) => (covered(from) && covered(to) ? FLOOR.get(to) - FLOOR.get(from) : null);

export function addSessions(day, n) {
  if (!covered(day) || !Number.isInteger(n)) return null;
  if (n === 0) return INDEX.has(day) ? day : null;
  const at = FLOOR.get(day) + n + (n < 0 && !INDEX.has(day) ? 1 : 0);
  return at >= 0 ? SESSIONS[at] ?? null : null;
}

export function nextSession(day) {
  return addSessions(day, 1);
}

export function previousSession(day) {
  return addSessions(day, -1);
}

export const horizonEnd = (asOf) => (INDEX.has(asOf) ? addSessions(asOf, HORIZON_SESSIONS) : null);

export function ahead(asOf) {
  if (!INDEX.has(asOf)) return null;
  const out = Array.from({ length: AHEAD_SESSIONS }, (_, i) => addSessions(asOf, i + 1));
  return out.every(Boolean) ? out : null;
}

export function impactSession(reportDate, reportTime) {
  if (!covered(reportDate)) return null;
  const r = leafImpact(reportDate, reportTime, SESSIONS);
  const days = r && Array.isArray(r.sessions) ? [...r.sessions].sort() : [];
  if (!days.length || !days.every((d) => INDEX.has(d))) return null;
  const early = days[0];
  const late = days[days.length - 1];
  return { early, late, day: early === late ? early : null, timing: r.timing, certain: early === late };
}

export function forward(reportDate, asOf, reportTime) {
  const imp = INDEX.has(asOf) ? impactSession(reportDate, reportTime) : null;
  if (!imp || sessionsBetween(asOf, imp.late) < 1) return null;
  return { ed: sessionsBetween(asOf, imp.early), certain: imp.certain };
}

export function backward(reportDate, asOf, reportTime) {
  const imp = INDEX.has(asOf) ? impactSession(reportDate, reportTime) : null;
  const rd = imp ? sessionsBetween(imp.late, asOf) : null;
  return rd === null || rd < 0 ? null : { rd, certain: imp.certain, rdMax: sessionsBetween(imp.early, asOf) };
}

export function withinHorizon(reportDate, asOf, reportTime) {
  const f = forward(reportDate, asOf, reportTime);
  return f ? f.ed <= HORIZON_SESSIONS : null;
}

export function coverage(nowMs = Date.now()) {
  const need = new Date(nowMs + CALENDAR_LEAD_DAYS * DAY_MS).toISOString().slice(0, 10);
  return { ok: need <= CALENDAR_LAST, need, through: CALENDAR_LAST };
}
