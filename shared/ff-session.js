import { HEALTH_RULES, sessionLabelText } from "./ff-contract.js";
import {
  easternDay, easternInstant, isTradingDay, nextTradingDay, prevTradingDay, priorTradingDays, sessionOpen, sessionClose, phaseAt,
} from "./flows-freshness.js";
import { boundaries, clock, instantOf } from "./flows-time.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE = 60000;
const MAX_WALK = 400;
const NIGHTLY_START_MIN = 17 * 60 + 30;
const LIVE_FIRST_MIN = 9 * 60 + 35;
const NIGHTLY_DEADLINE_MIN = 20 * 60 + 30;

export const isSession = (day) => typeof day === "string" && DAY_RE.test(day) && isTradingDay(day, null);

export const nextSession = (day) => (typeof day === "string" && DAY_RE.test(day) ? nextTradingDay(day, null) : null);

export const prevSession = (day) => (typeof day === "string" && DAY_RE.test(day) ? prevTradingDay(day, null) : null);

export function addSessions(day, n) {
  if (typeof day !== "string" || !DAY_RE.test(day) || !Number.isInteger(n) || Math.abs(n) > MAX_WALK) return null;
  let d = day;
  for (let i = 0; i < Math.abs(n) && d; i++) d = n > 0 ? nextTradingDay(d, null) : prevTradingDay(d, null);
  return d;
}

export function sessionsBetween(from, to) {
  if (typeof from !== "string" || typeof to !== "string" || !DAY_RE.test(from) || !DAY_RE.test(to)) return null;
  if (to === from) return 0;
  const forward = to > from;
  let d = from;
  let n = 0;
  for (let i = 0; i < MAX_WALK; i++) {
    const step = forward ? nextTradingDay(d, null) : prevTradingDay(d, null);
    if (!step) return null;
    if (forward ? step > to : step < to) break;
    d = step;
    n++;
    if (d === to) break;
  }
  return forward ? n : -n;
}

export const priorSessions = (day, count) => (isDay(day) ? priorTradingDays(day, count, null) : []);

const isDay = (day) => typeof day === "string" && DAY_RE.test(day);

export function sessionOf(at) {
  const ms = instantOf(at);
  if (ms === null) return null;
  const p = phaseAt(ms, null);
  if (!p) return null;
  return p.session || p.lastClosed || null;
}

export function marketPhase(at) {
  const ms = instantOf(at);
  if (ms === null) return null;
  const p = phaseAt(ms, null);
  return p && p.phase === "rth" ? "open" : "closed";
}

export function sessionLabel(day, asOf) {
  const ms = instantOf(asOf);
  const b = isDay(day) ? boundaries(day) : null;
  if (!b || ms === null) return null;
  if (ms < b.open.ms) return "pre-open";
  if (ms >= b.close.ms + MINUTE) return "post-close";
  if (ms >= b.close.ms) return "close";
  const m = Math.floor((ms - b.open.ms) / MINUTE);
  return m < 60 ? "open+" + m + "m" : "open+" + Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0") + "m";
}

export function timeLine(day, asOf) {
  const label = sessionLabel(day, asOf);
  const text = clock(asOf);
  if (label === null || text === null) return null;
  return Object.freeze({ clock: text, label, session: day, text: sessionLabelText(clock(asOf, false), label) });
}

export function healthState(input, rules = HEALTH_RULES) {
  const { phase, liveAgeS, nightlyLate, error } = input || {};
  const open = phase === "open";
  if (phase !== "open" && phase !== "closed") return "unknown";
  if (!Number.isFinite(nightlyLate) || (open && !Number.isFinite(liveAgeS))) return "unknown";
  if (nightlyLate >= rules.nightlyDownLateSessions || (open && liveAgeS > rules.degradedMaxAgeS)) return "down";
  if (nightlyLate >= rules.nightlyDegradedLateSessions || error === true || (open && liveAgeS > rules.liveMaxAgeFactor * rules.liveCadenceS)) return "degraded";
  return open ? "live" : "resting";
}

export function lateSessions(expected, lastOk) {
  if (!isDay(expected) || !isDay(lastOk)) return null;
  if (lastOk >= expected) return 0;
  return sessionsBetween(lastOk, expected);
}

export const nightlyAsOf = (session) => (isSession(session) ? sessionClose(session, null) : NaN);

export const effectiveSession = (cadence, now) => {
  const c = firstCheck(cadence, now);
  return c ? c.session : null;
};

export const nightlyDeadline = (session) => (isDay(session) ? easternInstant(session, NIGHTLY_DEADLINE_MIN) : NaN);

export const nightlyFinal = (session) => {
  const next = isDay(session) ? nextTradingDay(session, null) : null;
  return next ? sessionOpen(next) : NaN;
};

function nextTradingStart(ms, minutes) {
  const day = easternDay(ms);
  if (!day) return null;
  const today = isTradingDay(day, null) && ms < easternInstant(day, minutes) ? day : nextTradingDay(day, null);
  return today ? { day: today, at: easternInstant(today, minutes) } : null;
}

export function firstCheck(cadence, now, { periodMin = 5 } = {}) {
  const ms = instantOf(now);
  if (ms === null || (cadence !== "nightly" && cadence !== "live")) return null;
  if (cadence === "nightly") {
    const s = nextTradingStart(ms, NIGHTLY_START_MIN);
    return s && Object.freeze({ at: s.at, session: s.day, trt: clock(s.at), label: "scheduled" });
  }
  const period = Math.max(1, Math.floor(periodMin)) * MINUTE;
  const day = easternDay(ms);
  if (!day) return null;
  let d = isTradingDay(day, null) ? day : nextTradingDay(day, null);
  let cursor = ms;
  for (let i = 0; d && i < 4; i++) {
    const lo = easternInstant(d, LIVE_FIRST_MIN);
    const hi = sessionClose(d, null);
    const at = Math.ceil(Math.max(cursor, lo) / period) * period;
    if (at <= hi) return Object.freeze({ at, session: d, trt: clock(at), label: "scheduled" });
    d = nextTradingDay(d, null);
    cursor = 0;
  }
  return null;
}

export function expectedLooks(session, now, periodMin = 5) {
  const ms = instantOf(now);
  if (!isSession(session) || ms === null) return 0;
  const first = easternInstant(session, LIVE_FIRST_MIN);
  const last = Math.min(ms, sessionClose(session, null));
  if (last < first) return 0;
  const period = Math.max(1, Math.floor(periodMin)) * MINUTE;
  return Math.floor((last - first) / period) + 1;
}
