import { easternDay, isTradingDay, sessionOpen, sessionClose, nextTradingDay } from "./flows-freshness.js";

export const TRT_MS = 3 * 3600 * 1000;

export const LIVE_MAX_AGE_MS = 30 * 60 * 1000;

export const NOT_ARCHIVED = "Daily ledgers are not archived yet.";

const WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

const MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

const parts = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isFinite(d.getTime()) ? { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay() } : null;
};

export function dayLabel(day) {
  const p = parts(day);
  return p ? `${WEEKDAYS[p.w]} ${p.d} ${MONTHS[p.m]}` : null;
}

export function rangeLabel(from, to) {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return null;
  return a.m === b.m && a.y === b.y ? `${a.d}–${b.d} ${MONTHS[b.m]}` : `${a.d} ${MONTHS[a.m]}–${b.d} ${MONTHS[b.m]}`;
}

const pad = (n) => String(n).padStart(2, "0");

export function trtOf(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + TRT_MS);
  return { day: d.toISOString().slice(0, 10), clock: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, weekday: WEEKDAYS[d.getUTCDay()] };
}

export function trtStamp(ms, exchangeDay = null) {
  const t = trtOf(ms);
  if (t === null) return null;
  return `${t.clock} TRT${exchangeDay !== null && t.day !== exchangeDay ? " " + t.weekday : ""}`;
}

export function lastCompletedSession(at, clock = null) {
  if (!Number.isFinite(at)) return null;
  let d = easternDay(at);
  for (let i = 0; d && i < 14; i++) {
    if (isTradingDay(d, clock) && sessionClose(d, clock) <= at) return d;
    d = prevDayOf(d);
  }
  return null;
}

function prevDayOf(d) {
  const p = parts(d);
  if (!p) return null;
  const prev = new Date(Date.UTC(p.y, p.m, p.d - 1)).toISOString().slice(0, 10);
  return prev;
}

export function expectedFive(last, clock = null) {
  const out = [];
  let d = last;
  for (let i = 0; d && out.length < 5 && i < 40; i++) {
    if (isTradingDay(d, clock)) out.unshift(d);
    d = prevDayOf(d);
  }
  return out.length === 5 ? out : null;
}

const asMs = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function periodPlan({ at, live = null, nightly = null, clock = null }) {
  const now = asMs(at);
  const last = now === null ? null : lastCompletedSession(now, clock);
  const today = now === null ? null : easternDay(now);
  const open = now !== null && today !== null && isTradingDay(today, clock) && sessionOpen(today) <= now && now < sessionClose(today, clock);
  const liveAt = live ? asMs(live.readAt) : null;
  const intraday = { id: "intraday", ok: false, session: today, asOf: null, source: null, reason: null, label: null };
  if (!open) {
    const next = today === null ? null : (isTradingDay(today, clock) && now < sessionOpen(today) ? today : nextTradingDay(today, clock));
    const stamp = next ? `${dayLabel(next)} ${trtStamp(sessionOpen(next), next)}` : null;
    intraday.reason = stamp ? `No session open. Next opens ${stamp}.` : "No session open.";
  } else if (!live || live.session !== today) {
    intraday.reason = "No read yet for this session.";
  } else if (liveAt === null || now - liveAt > LIVE_MAX_AGE_MS) {
    intraday.reason = liveAt === null ? "No read yet for this session." : `No live read since ${trtStamp(liveAt, today)}.`;
  } else {
    intraday.ok = true;
    intraday.asOf = liveAt;
    intraday.source = "live";
    intraday.label = `Intraday · provisional · as of ${trtStamp(liveAt, today)}`;
  }
  const session = { id: "session", ok: false, session: last, asOf: null, source: null, status: null, reason: null, label: null };
  if (last === null) {
    session.reason = "No completed session is known.";
  } else if (nightly && nightly.session === last) {
    session.ok = true;
    session.source = "nightly";
    session.status = "complete";
    session.asOf = asMs(nightly.readAt);
    session.label = `Session of ${dayLabel(last)} · complete`;
  } else if (live && live.session === last && liveAt !== null) {
    session.ok = true;
    session.source = "live";
    session.asOf = liveAt;
    if (liveAt >= sessionClose(last, clock)) {
      session.status = "provisional";
      session.label = `Session of ${dayLabel(last)} · provisional until the nightly lands`;
    } else {
      session.status = "partial";
      session.label = `Session of ${dayLabel(last)} · partial to ${trtStamp(liveAt, last)}`;
    }
  } else {
    session.reason = `Session of ${dayLabel(last)} was not stored.`;
  }
  const expected = last === null ? null : expectedFive(last, clock);
  const five = {
    id: "five", ok: false, session: last, expected, reason: NOT_ARCHIVED,
    label: expected ? `5 sessions · ${rangeLabel(expected[0], expected[4])}` : null,
  };
  return { now, last, today, open, intraday, session, five };
}

const BLANK = (r, c) => {
  if (r <= 3) return c > 1;
  if (r <= 7) return c !== 2 && c !== 3;
  if (r <= 9) return c < 4;
  return false;
};

export function sumSessions({ expected, ledgers, archived = false, clock = null }) {
  if (!Array.isArray(expected) || expected.length !== 5) throw new TypeError("sumSessions: five expected sessions");
  for (let i = 0; i < 5; i++) {
    if (typeof expected[i] !== "string" || !parts(expected[i]) || !isTradingDay(expected[i], clock)) throw new TypeError("sumSessions: an expected session is not a trading day");
    if (i > 0 && !(expected[i] > expected[i - 1])) throw new TypeError("sumSessions: expected sessions ascend without duplicates");
  }
  const list = Array.isArray(ledgers) ? ledgers : [];
  const byDate = new Map();
  for (const l of list) {
    if (!l || typeof l.date !== "string" || !expected.includes(l.date)) throw new TypeError("sumSessions: a ledger is outside the expected sessions");
    if (byDate.has(l.date)) throw new TypeError("sumSessions: a ledger date repeats");
    if (!Array.isArray(l.matrix) || l.matrix.length !== 11) throw new TypeError("sumSessions: a ledger carries eleven rows");
    for (const row of l.matrix) {
      if (!Array.isArray(row) || row.length !== 6) throw new TypeError("sumSessions: a row carries six columns");
      for (const v of row) if (v !== null && !Number.isSafeInteger(v)) throw new TypeError("sumSessions: cents are safe integers");
    }
    byDate.set(l.date, l);
  }
  if (!archived) return { status: "absent", reason: NOT_ARCHIVED, missing: expected.slice() };
  const missing = expected.filter((d) => !byDate.has(d));
  if (missing.length) {
    return { status: "absent", reason: `${missing.length} of 5 sessions not stored, oldest ${dayLabel(missing[0])}.`, missing };
  }
  const cells = Array.from({ length: 11 }, () => Array(6).fill(null));
  const absentCells = [];
  for (let r = 0; r < 11; r++) for (let c = 0; c < 6; c++) {
    if (BLANK(r, c)) continue;
    let sum = 0;
    let gone = null;
    for (const d of expected) {
      const v = byDate.get(d).matrix[r][c];
      if (v === null) { gone = d; break; }
      sum += v;
      if (!Number.isSafeInteger(sum)) throw new RangeError("a five-session sum left the safe integers");
    }
    if (gone === null) cells[r][c] = sum;
    else absentCells.push({ r, c, reason: `Absent on ${dayLabel(gone)}.` });
  }
  const tilt = {};
  const columns = new Set(list.flatMap((l) => Object.keys(l.tilt || {})));
  let tiltSum = 0n;
  for (const col of columns) {
    let sum = 0n;
    let present = true;
    for (const d of expected) {
      const v = byDate.get(d).tilt ? byDate.get(d).tilt[col] : undefined;
      if (v === undefined || v === null) { present = false; break; }
      sum += BigInt(v);
    }
    tilt[col] = present ? sum : null;
    if (present) tiltSum += sum;
  }
  return { status: "ok", from: expected[0], to: expected[4], cells, absentCells, tilt, tiltSum };
}
