import { nyseHolidays, nyseEarlyCloses } from "./flows-quant-time.js";

export const FRESH_CLASSES = Object.freeze({
  quote: Object.freeze({ cadenceS: 5, liveS: 20, staleS: 90, source: "ondemand" }),
  tape: Object.freeze({ cadenceS: 60, liveS: 150, staleS: 600, source: "ondemand" }),
  market: Object.freeze({ cadenceS: 300, liveS: 660, staleS: 1500, source: "worker" }),
  breadth: Object.freeze({ cadenceS: 900, liveS: 1200, staleS: 2700, source: "actions" }),
  nightly: Object.freeze({ cadenceS: 0, liveS: null, staleS: null, source: "nightly", graceS: 5 * 3600 }),
});

export const REFRESH_CADENCE_MINUTES = FRESH_CLASSES.market.cadenceS / 60;

export const PHASE_MINUTES = Object.freeze({
  preOpen: 4 * 60,
  open: 9 * 60 + 30,
  close: 16 * 60,
  earlyClose: 13 * 60,
  postEnd: 20 * 60,
  nightlyAfter: 17 * 60 + 15,
  nightlyRetry: 18 * 60 + 15,
  sessionProbe: 9 * 60 + 45,
});

export const LIVE_CLOCK = Object.freeze({
  tier1AfterCloseMin: 10,
  dispatchAfterCloseMin: 16,
  runAfterCloseMin: 25,
  dispatchEveryMin: 15,
  dispatchMinute: 1,
  inFlightMs: 10 * 60 * 1000,
  watchdogMs: 45 * 60 * 1000,
  earlyCloseQuietMs: 30 * 60 * 1000,
  holidayProbeMin: 10,
});

const OPEN_MINUTES = 9 * 60 + 15;
const CLOSE_MINUTES = 16 * 60 + 15;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}

export function easternOffsetMinutes(ms) {
  if (!Number.isFinite(ms)) return NaN;
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7);
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6);
  return ms >= start && ms < end ? -240 : -300;
}

const instantOf = (at) => {
  if (at instanceof Date) return at.getTime();
  if (typeof at === "number") return at;
  return new Date(at).getTime();
};

export function easternDay(at) {

  const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
  const usable = at instanceof Date || (typeof at === "number" && Number.isFinite(at) && at > 0) ||
    (typeof at === "string" && INSTANT.test(at.trim()));
  if (!usable) return null;
  const ms = instantOf(at);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + easternOffsetMinutes(ms) * 60000).toISOString().slice(0, 10);
}

export function easternClock(date) {
  const ms = instantOf(date);
  if (!Number.isFinite(ms)) return null;
  const local = new Date(ms + easternOffsetMinutes(ms) * 60000);

  return { weekday: WEEKDAYS[local.getUTCDay()], minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export function isRefreshWindow(date) {
  const clock = easternClock(date);
  if (!clock) return false;
  if (clock.weekday === "Sat" || clock.weekday === "Sun") return false;
  return clock.minutes >= OPEN_MINUTES && clock.minutes <= CLOSE_MINUTES;
}

export function lastCompletedSession(date, clock = null) {
  const ms = toMs(date);
  if (!Number.isFinite(ms)) return null;
  const today = easternDay(ms);
  const wall = easternClock(ms);
  if (!today || !wall) return null;
  if (isTradingDay(today, clock) && wall.minutes > closeMinutes(today, clock) + CLOSE_MINUTES - PHASE_MINUTES.close) {
    return today;
  }
  return prevTradingDay(today, clock);
}

const toMs = (v) => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && v.trim()) return Date.parse(v);
  return NaN;
};

const dayParts = (day) => {
  if (typeof day !== "string" || !DAY_RE.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
};

export function dayWeekday(day) {
  const p = dayParts(day);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

export function isWeekdayDay(day) {
  const w = dayWeekday(day);
  return w !== null && w >= 1 && w <= 5;
}

export function shiftDay(day, n) {
  const p = dayParts(day);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
}

export function nextWeekdayDay(day) {
  let d = shiftDay(day, 1);
  for (let i = 0; d && i < 7 && !isWeekdayDay(d); i++) d = shiftDay(d, 1);
  return d;
}

export function prevWeekdayDay(day) {
  let d = shiftDay(day, -1);
  for (let i = 0; d && i < 7 && !isWeekdayDay(d); i++) d = shiftDay(d, -1);
  return d;
}

export function easternInstant(day, minutes) {
  const p = dayParts(day);
  if (!p || !Number.isFinite(minutes)) return NaN;
  const wall = Date.UTC(p.y, p.m - 1, p.d, 0, 0) + minutes * 60000;
  const guess = wall + 300 * 60000;
  const off = easternOffsetMinutes(guess);
  const ms = wall - off * 60000;
  const again = easternOffsetMinutes(ms);
  return again === off ? ms : wall - again * 60000;
}

const clockFor = (clock, day) =>
  clock && typeof clock === "object" && clock.day === day ? clock : null;

export function clockClosed(flag) {
  return flag === 0 || flag === "0";
}

const clockOpen = (flag) => flag === 1 || flag === "1";

const closedDaysOf = (clock) =>
  clock && typeof clock === "object" && Array.isArray(clock.closedDays) ? clock.closedDays : null;

export function isHoliday(day) {
  const p = dayParts(day);
  return !!p && nyseHolidays(p.y).has(day);
}

export function isEarlyCloseDay(day) {
  const p = dayParts(day);
  return !!p && nyseEarlyCloses(p.y).has(day);
}

export function isTradingDay(day, clock) {
  if (!isWeekdayDay(day)) return false;
  const c = clockFor(clock, day);
  if (c && clockClosed(c.trading)) return false;
  if (c && clockOpen(c.trading)) return true;
  if (isHoliday(day)) return false;
  const closed = closedDaysOf(clock);
  return !(closed && closed.includes(day));
}

export function closeMinutes(day, clock) {
  const c = clockFor(clock, day);
  if (c && Number(c.earlyClose ?? c.early_close) === 1) return PHASE_MINUTES.earlyClose;
  return isEarlyCloseDay(day) ? PHASE_MINUTES.earlyClose : PHASE_MINUTES.close;
}

export function sessionClose(day, clock) {
  return easternInstant(day, closeMinutes(day, clock));
}

export function sessionOpen(day) {
  return easternInstant(day, PHASE_MINUTES.open);
}

export function prevTradingDay(day, clock) {
  let d = prevWeekdayDay(day);
  for (let i = 0; d && i < 10 && !isTradingDay(d, clock); i++) d = prevWeekdayDay(d);
  return d;
}

export function nextTradingDay(day, clock) {
  let d = nextWeekdayDay(day);
  for (let i = 0; d && i < 10 && !isTradingDay(d, clock); i++) d = nextWeekdayDay(d);
  return d;
}

export function phaseAt(at, clock = null) {
  const ms = toMs(at);
  if (!Number.isFinite(ms)) return null;
  const today = easternDay(ms);
  const wall = easternClock(ms);
  if (!today || !wall) return null;
  const m = wall.minutes;
  const trading = isTradingDay(today, clock);
  const closeMin = closeMinutes(today, clock);
  const base = { day: today, minutes: m, trading, earlyClose: closeMin !== PHASE_MINUTES.close };

  if (!trading) {
    const next = nextTradingDay(today, clock);
    return { ...base, phase: "closed", session: null,
      lastClosed: prevTradingDay(today, clock),
      open: null, close: null,
      nextOpen: next ? sessionOpen(next) : NaN,
      endsAt: next ? easternInstant(next, PHASE_MINUTES.preOpen) : NaN };
  }
  const open = sessionOpen(today);
  const close = easternInstant(today, closeMin);
  const next = nextTradingDay(today, clock);
  const nextOpen = next ? sessionOpen(next) : NaN;
  if (m < PHASE_MINUTES.preOpen) {
    return { ...base, phase: "closed", session: prevTradingDay(today, clock),
      lastClosed: prevTradingDay(today, clock), open, close, nextOpen: open,
      endsAt: easternInstant(today, PHASE_MINUTES.preOpen) };
  }
  if (m < PHASE_MINUTES.open) {
    return { ...base, phase: "pre", session: today, lastClosed: prevTradingDay(today, clock),
      open, close, nextOpen: open, endsAt: open };
  }
  if (m < closeMin) {
    return { ...base, phase: "rth", session: today, lastClosed: prevTradingDay(today, clock),
      open, close, nextOpen, endsAt: close };
  }
  if (m < PHASE_MINUTES.postEnd) {
    return { ...base, phase: "post", session: today, lastClosed: today, open, close, nextOpen,
      endsAt: easternInstant(today, PHASE_MINUTES.postEnd) };
  }
  return { ...base, phase: "closed", session: today, lastClosed: today, open, close, nextOpen,
    endsAt: next ? easternInstant(next, PHASE_MINUTES.preOpen) : NaN };
}

export function expectedNightlySession(at, clock = null) {
  const ms = toMs(at);
  if (!Number.isFinite(ms)) return null;
  const grace = FRESH_CLASSES.nightly.graceS * 1000;
  let d = easternDay(ms);
  for (let i = 0; d && i < 14; i++) {
    if (isTradingDay(d, clock) && easternInstant(d, PHASE_MINUTES.close) + grace <= ms) return d;
    d = shiftDay(d, -1);
  }
  return null;
}

export function classOf(meta) {
  if (meta && typeof meta.klass === "string" && Object.hasOwn(FRESH_CLASSES, meta.klass)) return meta.klass;
  const c = Number(meta && meta.cadenceS);
  if (!Number.isFinite(c) || c <= 0) return "nightly";
  for (const [name, spec] of Object.entries(FRESH_CLASSES)) if (spec.cadenceS === c) return name;
  return c <= 5 ? "quote" : c <= 60 ? "tape" : c <= 300 ? "market" : "breadth";
}

export function freshnessState(meta, at, clock = null) {
  const now = toMs(at);
  const phase = phaseAt(now, clock);
  const klass = classOf(meta);
  const spec = FRESH_CLASSES[klass];
  const readAt = toMs(meta && meta.readAt);
  const out = {
    klass, cadenceS: spec.cadenceS, phase: phase ? phase.phase : null,
    readAt: Number.isFinite(readAt) ? readAt : null,
    session: meta && typeof meta.session === "string" && DAY_RE.test(meta.session) ? meta.session : null,
    liveUntil: null, staleAt: null,
    phaseEndsAt: phase && Number.isFinite(phase.endsAt) ? phase.endsAt : null,
    state: "stale", reason: null,
  };
  if (!phase) return { ...out, reason: "no-clock" };
  if (!Number.isFinite(readAt)) return { ...out, reason: "unstamped" };

  if (klass === "nightly") {
    const expected = expectedNightlySession(now, clock);
    out.expected = expected;
    if (!out.session) return { ...out, reason: "unsessioned" };
    if (expected && out.session < expected) return { ...out, reason: "behind" };
    const following = nextTradingDay(out.session, clock);
    out.staleAt = following ? easternInstant(following, PHASE_MINUTES.close) + spec.graceS * 1000 : null;
    return { ...out, state: "fresh", reason: "session" };
  }

  const liveMs = spec.liveS * 1000;
  const staleMs = spec.staleS * 1000;
  if (phase.phase === "rth") {
    if (readAt < phase.open) {
      out.staleAt = phase.open + liveMs;
      return now < out.staleAt
        ? { ...out, state: "closed", reason: "awaiting-first-read" }
        : { ...out, reason: "missed-open" };
    }
    out.liveUntil = readAt + liveMs;
    out.staleAt = readAt + staleMs;
    if (now - readAt <= liveMs) return { ...out, state: "live", reason: "cadence" };
    if (now - readAt <= staleMs) return { ...out, state: "fresh", reason: "cadence" };
    return { ...out, reason: "behind" };
  }
  const lastClosed = phase.lastClosed;
  const lastClose = lastClosed ? sessionClose(lastClosed, clock) : NaN;
  const covers = Number.isFinite(lastClose) && readAt >= lastClose - spec.cadenceS * 1000;
  out.staleAt = Number.isFinite(phase.nextOpen) ? phase.nextOpen + liveMs : null;
  if (covers) return { ...out, state: "closed", reason: "session-final" };
  return { ...out, staleAt: null, reason: "missed-close" };
}

export function freshHeaders(meta, at, clock = null) {
  const now = toMs(at);
  const f = freshnessState(meta, now, clock);
  const iso = (v) => (Number.isFinite(v) && v !== null ? new Date(v).toISOString() : "");
  const h = {
    "X-Fresh-State": f.state,
    "X-Fresh-Reason": f.reason || "",
    "X-Fresh-Class": f.klass,
    "X-Fresh-Read-At": iso(f.readAt),
    "X-Fresh-Source": meta && typeof meta.source === "string" ? meta.source : FRESH_CLASSES[f.klass].source,
    "X-Fresh-Cadence": String(f.cadenceS),
    "X-Fresh-Session": f.session || "",
    "X-Fresh-Live-Until": iso(f.liveUntil),
    "X-Fresh-Stale-At": iso(f.staleAt),
    "X-Fresh-Phase": f.phase || "",
    "X-Fresh-Phase-Ends": iso(f.phaseEndsAt),
    "X-Server-Now": String(now),
  };
  return { headers: h, fresh: f };
}

export function pendingHeaders(klass, at, clock = null) {
  const now = toMs(at);
  const phase = phaseAt(now, clock);
  return {
    "X-Fresh-State": "pending",
    "X-Fresh-Reason": "unpublished",
    "X-Fresh-Class": klass,
    "X-Fresh-Read-At": "",
    "X-Fresh-Source": FRESH_CLASSES[klass] ? FRESH_CLASSES[klass].source : "",
    "X-Fresh-Cadence": String(FRESH_CLASSES[klass] ? FRESH_CLASSES[klass].cadenceS : 0),
    "X-Fresh-Session": "",
    "X-Fresh-Live-Until": "",
    "X-Fresh-Stale-At": "",
    "X-Fresh-Phase": phase ? phase.phase : "",
    "X-Fresh-Phase-Ends": phase && Number.isFinite(phase.endsAt) ? new Date(phase.endsAt).toISOString() : "",
    "X-Server-Now": String(now),
  };
}

function holidayProbeDue(p, clock) {
  if (!isWeekdayDay(p.day) || !isHoliday(p.day)) return false;
  const c = clockFor(clock, p.day);
  if (c && (clockClosed(c.trading) || clockOpen(c.trading))) return false;
  const closed = closedDaysOf(clock);
  if (closed && closed.includes(p.day)) return false;
  return p.minutes >= PHASE_MINUTES.sessionProbe &&
    p.minutes <= PHASE_MINUTES.sessionProbe + LIVE_CLOCK.holidayProbeMin;
}

export function tier1Due(at, clock = null) {
  const p = phaseAt(at, clock);
  if (!p) return false;
  if (!p.trading) return holidayProbeDue(p, clock);
  const closeMin = closeMinutes(p.day, clock);
  return p.minutes >= PHASE_MINUTES.open && p.minutes <= closeMin + LIVE_CLOCK.tier1AfterCloseMin;
}

export function liveDispatchDue(at, clock = null) {
  const ms = toMs(at);
  const p = phaseAt(ms, clock);
  if (!p || !p.trading) return { due: false, why: "not-trading" };
  const closeMin = closeMinutes(p.day, clock);
  if (p.minutes < PHASE_MINUTES.open || p.minutes > closeMin + LIVE_CLOCK.dispatchAfterCloseMin) {
    return { due: false, why: "outside-window" };
  }
  if (p.minutes % LIVE_CLOCK.dispatchEveryMin !== LIVE_CLOCK.dispatchMinute) return { due: false, why: "off-tick" };
  const sent = Number(clock && (clock.liveDispatchedAt ?? clock.live_dispatched_at));
  const done = Number(clock && (clock.liveDoneAt ?? clock.live_done_at));
  if (Number.isFinite(sent) && sent > 0 && ms - sent < LIVE_CLOCK.inFlightMs &&
      !(Number.isFinite(done) && done >= sent)) {
    return { due: false, why: "in-flight" };
  }
  return { due: true, why: "tick" };
}

export function liveStalled(at, breadthReadAt, clock = null) {
  const ms = toMs(at);
  const p = phaseAt(ms, clock);
  if (!p || p.phase !== "rth") return false;
  if (ms - p.open < LIVE_CLOCK.watchdogMs) return false;
  const read = toMs(breadthReadAt);
  return !Number.isFinite(read) || ms - read > LIVE_CLOCK.watchdogMs;
}

export function nightlyDispatchDue(at, clock = null, metaSession = null) {
  const ms = toMs(at);
  const p = phaseAt(ms, clock);
  if (!p) return { due: false, why: "no-clock" };
  if (!isTradingDay(p.day, clock)) return { due: false, why: "not-trading" };
  if (p.minutes < PHASE_MINUTES.nightlyAfter) return { due: false, why: "before-window" };
  if (typeof metaSession === "string" && metaSession >= p.day) return { due: false, why: "landed" };
  const dispatchedDay = clock && (clock.nightlyDay ?? clock.nightly_day);
  if (dispatchedDay !== p.day) return { due: true, redispatch: false, why: "window" };
  const again = Number(clock && (clock.nightlyRedispatchedAt ?? clock.nightly_redispatched_at));
  if (p.minutes >= PHASE_MINUTES.nightlyRetry && !(Number.isFinite(again) && again > 0)) {
    return { due: true, redispatch: true, why: "retry" };
  }
  return { due: false, why: "dispatched" };
}
