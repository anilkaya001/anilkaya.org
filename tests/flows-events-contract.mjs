/* =============================================================
   flows-events-contract.mjs — the events calendar.

   THIS SUITE IS SCOPED TO THE PURE MODULE AND THE PAYLOAD, WITH
   ONE DELIBERATE EXCEPTION. Both the module and the payload exist
   and are stable, and §1 through §15 touch nothing else. §16 opens
   the rendered page in a browser, because the defect it pins lives
   between two published fields rather than inside either: the
   module has emitted `shown` and `inWindow` as two separate facts
   since §8, and the renderer filled the nav badge from the wrong
   one. No assertion over the payload can see that.

   WHAT IS WORTH ASSERTING ABOUT THIS MODULE is not that it computes
   what it computes. shared/flows-events.js rests on two corrections,
   and every expensive defect this page can ship is a quiet breach of
   one of them:

     THE TWO CLOCKS — sessionDate and the earnings gate do not share
     an origin, so a day count measured from the last completed
     session classifies every name against a gate that never ran.

     THE TWO HORIZONS — `dte` is CALENDAR days and is what the gate
     and the window mean; `sdte` is trading SESSIONS and is what the
     priced move needs. The first draft filtered `sdte > windowDays`,
     sessions against a constant named days, and put a fifth of the
     board on the wrong side of the band.

   Both failures are invisible from inside: a fixture built from the
   same assumption agrees with the broken code perfectly, on every
   row, forever, and only the live drawing is wrong. That is the
   house rule this repo has paid for five separate times, so every
   expectation in §1, §2 and §8 is a hand-counted integer over a
   NAMED WEEKDAY SPAN, written down with the weekday of each end, and
   the WRONG answer is written down beside it. Where a state does not
   occur in the emitted corpus — a non-positive close, an invented
   iv30d_1w, an rv withheld on a known count, a name whose sessions
   sit inside the window while its calendar days sit outside — the
   fixture is an emitted row with ONE NAMED FIELD MUTATED, or a span
   constructed to straddle the bound, and the mutation is said to be
   the point at the site.

   §15 FAILS, AND IT IS MEANT TO. Two assertions there are breaches
   of the module's own stated invariants, not of this suite's
   expectations. They are argued in full at the site and left
   failing rather than weakened.
   ============================================================= */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

import {
  buildEvents, eventRow, sessionsToEarnings, calendarDaysTo, ivPathOf,
  IV_PATH_LABELS, EVENT_ROWS, EVENT_WINDOW_DAYS, EVENTS_NOTES,
} from "../shared/flows-events.js";
import { eventsPage } from "../shared/flows-pages.js";
import { horizonMove, TRADING_YEAR } from "../shared/flows-features.js";
import { EARNINGS_GATE_DAYS, daysToEarnings, screenerTilt } from "../scripts/flows-pipeline.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, msg, tol = 1e-9) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b})`);
  checks++;
};

/* ---------- the corpus ------------------------------------------ */

/* THE PAYLOAD IS EMITTED HERE RATHER THAN COMMITTED. A committed fixture
   freezes the schema of the day it was captured, and this suite's whole claim
   is that it reads what the pipeline actually writes. 0.7s for a dry run. */
const EMIT_DIR = path.join(ROOT, "tests", ".events-emit");
fs.rmSync(EMIT_DIR, { recursive: true, force: true });
fs.mkdirSync(EMIT_DIR, { recursive: true });

let PAYLOAD;
try {
  execFileSync(process.execPath,
    [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", EMIT_DIR + "/"],
    { stdio: "ignore" });
  PAYLOAD = JSON.parse(fs.readFileSync(path.join(EMIT_DIR, "-events.json"), "utf8"));
} finally {
  fs.rmSync(EMIT_DIR, { recursive: true, force: true });
}

const ROWS = PAYLOAD.rows;
/* The run's own instant. daysToEarnings() rounds against Date.now(), so this
   is the origin the GATE actually used — as distinct from gateOrigin, which is
   the Eastern DATE. The distance between those two is the subject of §15. */

/* Two named calendar anchors, used by every unit fixture below. They are the
   dry run's own pair, and their WEEKDAYS are what every hand count turns on:

     2026-08-24  Monday     — the last COMPLETED session (sessionDate)
     2026-08-26  Wednesday  — the run's own Eastern date  (gateOrigin)

   Two calendar days and two SESSIONS apart, which is exactly the gap the
   module's header says a page counting from the wrong one will swallow. */
const SESSION_DATE = "2026-08-24";
const GATE_ORIGIN = "2026-08-26";

const tiltOf = (over = {}) => ({
  iv30: 0.3000, ivMomentum: 0.0100, iv30d1d: 0.2900, iv30d1m: 0.2800,
  ivRank: 0.5000, impliedMovePerc: 0.0500, relVolume: 1.50, ...over,
});
const nameAt = (ticker, date, over = {}) => ({
  row: { ticker, close: "100.00", next_earnings_date: date, sector: "Technology" },
  tilt: tiltOf(over),
});
/* A calendar date N days from an origin, built by arithmetic so a fixture
   anchored on a NAMED CONSTANT moves when the constant does. */
const plusDays = (origin, n) =>
  new Date(Date.parse(origin + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
/* The gate's own count for a date, measured from an origin's MIDNIGHT — which
   is what the pipeline would hand down on a run that fired at midnight, and
   the only form in which a hand-checked integer is unambiguous. */
/* daysToEarnings takes an ISO DATE, not a millisecond instant, and the change
   is the point rather than an inconvenience: measuring from an instant made
   the gate a function of the minute the runner fired, and made the published
   `dte` and `sdte` — one read against an instant, one against midnight —
   arithmetically impossible on 8 of 60 rows. This helper passes the origin
   through unchanged so the suite exercises the same arithmetic the pipeline
   does, rather than a timestamp the function would now reject. */
const gateDteFrom = (origin) => (date) =>
  daysToEarnings({ next_earnings_date: date }, origin);

/* ============================================================
   §0. BOTH CLOCKS AND BOTH HORIZONS ARE PUBLISHED.
   ============================================================ */
{
  ok(/^\d{4}-\d{2}-\d{2}$/.test(PAYLOAD.sessionDate),
     `sessionDate is published as an ISO date (${PAYLOAD.sessionDate})`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(PAYLOAD.gateOrigin),
     `gateOrigin is published as an ISO date (${PAYLOAD.gateOrigin})`);
  /* THE WHOLE PAGE TURNS ON THESE BEING DIFFERENT NUMBERS. The dry run pins
     sessionDate to 2026-08-24 and takes gateOrigin from the real Eastern
     clock, so the only way they coincide is a run on that very date — and a
     corpus where they coincided would certify a module that used either one. */
  ok(PAYLOAD.gateOrigin > PAYLOAD.sessionDate,
     `the run's Eastern date (${PAYLOAD.gateOrigin}) is strictly later than the last ` +
     `completed session (${PAYLOAD.sessionDate}) — the corpus can tell the two clocks apart`);
  eq(PAYLOAD.sessionDate, SESSION_DATE,
     "and the dry run's sessionDate is the anchor every hand count below is written against");
  eq(PAYLOAD.gateDays, EARNINGS_GATE_DAYS,
     "the payload republishes the gate width from the pipeline's own constant");
  eq(PAYLOAD.cap, EVENT_ROWS, "and the cap from the module's");
  eq(PAYLOAD.windowDays, EVENT_WINDOW_DAYS, "and the window from the module's");

  /* BOTH HORIZONS ON EVERY ROW. A page that published one of them would have
     no way to draw a gate band in the unit the gate counts. */
  ok(ROWS.every((r) => Number.isInteger(r.dte)),
     `all ${ROWS.length} rows carry an integer dte — CALENDAR days, the gate's unit`);
  ok(ROWS.every((r) => Number.isInteger(r.sdte)),
     "and an integer sdte — trading SESSIONS, the priced move's unit");
  ok(ROWS.every((r) => r.dte >= 0 && r.sdte >= 0),
     "neither of them ever negative");
}

/* ============================================================
   §1. THE DAY COUNTS ARE MEASURED FROM gateOrigin, NEVER FROM
   sessionDate.

   THE ASSERTION THIS FILE EXISTS FOR. Every expectation here is
   hand-counted over a named weekday span and the sessionDate answer
   is written down beside it as the specific wrong integer, because
   a suite that derived its expectation from sessionDate would agree
   with a broken module on every row of every corpus forever.
   ============================================================ */
{
  /* Monday 2026-08-31, read four ways. The span is chosen to cross a weekend,
     so all four readings are live:

       sessions from Wed 2026-08-26 (gateOrigin):  Thu 27, Fri 28, Mon 31   = 3
       calendar from Wed 2026-08-26 (gateOrigin):  27,28,29,30,31           = 5
       sessions from Mon 2026-08-24 (sessionDate): 25,26,27,28,31           = 5
       calendar from Mon 2026-08-24 (sessionDate): 25..31                   = 7

     NOTE THE COLLISION IN THE MIDDLE: counting sessions from the wrong clock
     and counting calendar days from the right one both answer 5. Two distinct
     mistakes landing on one number is exactly why each is tested separately
     rather than by checking that "the number looks about right". */
  const row = eventRow(nameAt("CLK", "2026-08-31").row, tiltOf(), { gateOrigin: GATE_ORIGIN });
  eq(row.sdte, 3,
     "sdte counts SESSIONS from gateOrigin: Wed 26 → Mon 31 is Thu, Fri, Mon");
  eq(row.dte, 5, "dte counts CALENDAR days over the same span, weekend included");
  eq(sessionsToEarnings("2026-08-31", SESSION_DATE), 5,
     "the sessionDate reckoning of the same row is 5 sessions — written down here so the " +
     "test cannot be satisfied by a module that used the last completed session");
  eq(calendarDaysTo("2026-08-31", SESSION_DATE), 7, "or 7 calendar days");
  ok(row.sdte !== 5 && row.dte !== 7,
     "and the module publishes neither of those, on either horizon");

  /* THE SAME ROW THROUGH buildEvents, WHICH IS HANDED BOTH CLOCKS. A module
     that passed sessionDate down to eventRow would still publish gateOrigin in
     the header and look correct to a reader of the header alone. */
  const built = buildEvents([nameAt("CLK", "2026-08-31")],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
  eq(built.rows[0].sdte, 3, "buildEvents holds both clocks and still counts from gateOrigin");
  eq(built.rows[0].dte, 5, "on both horizons");
  eq(built.gateOrigin, GATE_ORIGIN, "publishing the origin it counted from");
  eq(built.sessionDate, SESSION_DATE, "beside the session every PRICE describes");

  /* A DATE THAT SITS BETWEEN THE TWO CLOCKS, which is the sharpest form of the
     same test: Tuesday 2026-08-25 is one session AHEAD of sessionDate and one
     day BEHIND gateOrigin. The two clocks do not merely disagree on the count
     here — they disagree on whether the name is on this page at all. */
  const between = eventRow(nameAt("MID", "2026-08-25").row, tiltOf(), { gateOrigin: GATE_ORIGIN });
  eq(between.sdte, null,
     "a name reporting between the two clocks has ALREADY REPORTED as of gateOrigin — null");
  eq(between.dte, null, "on both horizons");
  eq(sessionsToEarnings("2026-08-25", SESSION_DATE), 1,
     "while the sessionDate reckoning calls it one session away, and would seat it at the " +
     "top of the calendar two days after it reported");
  const midBuilt = buildEvents([nameAt("MID", "2026-08-25")],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
  eq(midBuilt.rows.length, 0, "so it is not published at all");
  eq(midBuilt.inWindow, 0, "and not counted as in the window");

  /* AND OVER THE EMITTED PAYLOAD, where the corpus itself has to discriminate.
     If the sessionDate reckoning happened to agree with the published sdte on
     every row, this corpus would certify both implementations equally. */
  const agrees = ROWS.filter((r) => sessionsToEarnings(r.d, PAYLOAD.gateOrigin) === r.sdte).length;
  eq(agrees, ROWS.length,
     `all ${ROWS.length} emitted rows reproduce their published sdte from gateOrigin`);
  const differs = ROWS.filter((r) => sessionsToEarnings(r.d, PAYLOAD.sessionDate) !== r.sdte).length;
  eq(differs, ROWS.length,
     `and all ${ROWS.length} of them DISAGREE with the sessionDate reckoning — the corpus ` +
     `separates the two clocks on every single row, so agreeing with one is evidence`);
}

/* ============================================================
   §2. SESSIONS ARE WEEKDAYS, CALENDAR DAYS ARE CALENDAR DAYS,
   AND null IS NOT ZERO ON EITHER.
   ============================================================ */
{
  /* Friday 2026-08-28 → Monday 2026-08-31. One session, three calendar days.
     A horizon scaled by sqrt(3/252) instead of sqrt(1/252) is wrong by
     sqrt(3) — which is why the priced move may only ever see sdte. */
  eq(sessionsToEarnings("2026-08-31", "2026-08-28"), 1,
     "Friday → Monday is ONE session, not the three calendar days between them");
  eq(calendarDaysTo("2026-08-31", "2026-08-28"), 3,
     "and the calendar count over that same span is 3 — the gate's unit, and the window's");
  eq(sessionsToEarnings("2026-09-02", "2026-08-26"), 5,
     "Wednesday → the next Wednesday is five sessions: Thu, Fri, Mon, Tue, Wed");
  eq(calendarDaysTo("2026-09-02", "2026-08-26"), 7, "and seven calendar days");
  eq(sessionsToEarnings("2026-08-31", "2026-08-24"), 5,
     "Monday → the next Monday is five sessions, the weekend removed once");
  eq(calendarDaysTo("2026-08-31", "2026-08-24"), 7, "and seven days");

  /* THE UNIT RELATION, SWEPT. Weekdays are a subset of the days that contain
     them, so over any span from any origin the session count can never exceed
     the calendar count. This is arithmetic and holds by construction — it is
     asserted here so that §15's breach can be attributed to the ORIGINS being
     crossed rather than to either function being wrong. */
  let swept = 0, held = 0;
  for (let i = 0; i < 400; i++) {
    const d = plusDays("2026-01-01", i);
    const s = sessionsToEarnings(d, "2026-01-01"), c = calendarDaysTo(d, "2026-01-01");
    swept++; if (s <= c) held++;
  }
  eq(held, swept,
     `over ${swept} spans from one origin the session count never exceeds the calendar ` +
     `count — the two functions are individually coherent`);

  /* SAME DAY IS A READING, NOT AN ABSENCE. "Reports today, no sessions left to
     price" and "no date on the wire" are different facts and must not collapse
     into the same value. */
  eq(sessionsToEarnings("2026-08-26", "2026-08-26"), 0,
     "a name reporting on the origin itself is 0 sessions — a measurement");
  eq(calendarDaysTo("2026-08-26", "2026-08-26"), 0, "and 0 calendar days");
  eq(sessionsToEarnings("2026-08-29", "2026-08-28"), 0,
     "and Friday → Saturday is 0 sessions: a real count of the weekdays in between");
  eq(calendarDaysTo("2026-08-29", "2026-08-28"), 1,
     "though one calendar day — the two units genuinely disagree here, which is the point");
  ok(sessionsToEarnings("2026-08-26", "2026-08-26") !== null, "neither of which is null");

  /* THE PAST IS null ON BOTH HORIZONS, NOT 0 AND NOT NEGATIVE. A negative
     would sort ahead of every real row; a 0 would read as "reports today". */
  eq(sessionsToEarnings("2026-08-24", "2026-08-26"), null,
     "a date already past returns null sessions — it is not this page's row");
  eq(calendarDaysTo("2026-08-24", "2026-08-26"), null,
     "and null calendar days, rather than the negative the subtraction would give");
  eq(calendarDaysTo("2026-08-25", "2026-08-26"), null, "including yesterday, one day back");
  ok(!ROWS.some((r) => r.sdte < 0 || r.dte < 0),
     "and no emitted row carries a negative count on either horizon");

  /* ABSENT OR MALFORMED IS null, on both, over every shape the wire has
     produced. Both functions are tested, because a page that fell back to
     "today" on either would count from a clock nobody published. */
  for (const [bad, why] of [
    [null, "a null date"], [undefined, "an absent field"], ["", "an empty string"],
    ["2026-8-4", "an unpadded date"], ["not-a-date", "a non-date"],
    ["20260904", "an unseparated date"], ["2026-09-04T00:00:00Z", "a full timestamp"],
    ["2026-13-45", "a well-SHAPED date that is not a date"],
  ]) {
    eq(sessionsToEarnings(bad, GATE_ORIGIN), null, `${why} returns null sessions, never 0`);
    eq(calendarDaysTo(bad, GATE_ORIGIN), null, `${why} returns null days, never 0`);
  }
  eq(sessionsToEarnings("2026-09-04", null), null, "a missing origin returns null sessions");
  eq(calendarDaysTo("2026-09-04", null), null, "and null days");
  eq(sessionsToEarnings("2026-09-04", "2026-9-4"), null, "as does a malformed origin");
  eq(calendarDaysTo("2026-09-04", "2026-9-4"), null, "on both horizons");
}

/* ============================================================
   §3. THE −1w POINT IS RECONSTRUCTED, NOT READ.
   ============================================================ */
{
  /* The wire's own tilt, built by the pipeline's own screenerTilt over a
     screener row shaped like the ones the dry run emits. */
  const tilt = screenerTilt({
    ticker: "IVX", iv30d: "0.4000", iv30d_1w: "0.3500",
    iv30d_1d: "0.3800", iv30d_1m: "0.3000", iv_rank: "50",
  });
  ok(!("iv30d_1w" in tilt),
     "screenerTilt NEVER exposes iv30d_1w — the −1w point is not on the wire in this shape");
  ok(Number.isFinite(tilt.ivMomentum),
     "what it exposes is ivMomentum, the difference iv30 − iv30d_1w");
  near(tilt.ivMomentum, 0.4 - 0.35, "which is that difference and nothing else", 1e-12);

  const p = ivPathOf(tilt);
  near(p[1], Number((tilt.iv30 - tilt.ivMomentum).toFixed(4)),
     "so the path's −1w point is iv30 − ivMomentum, reconstructed", 1e-12);
  near(p[1], 0.35, "which recovers the 0.3500 the screener row actually carried", 1e-12);

  /* MUTATION IS THE POINT, and it is the point twice over: a tilt carrying an
     INVENTED iv30d_1w and no ivMomentum. A module that read tilt.iv30d_1w
     would pass every other assertion in this file against a fixture like this
     one and then return null at index 1 on EVERY LIVE ROW, because
     screenerTilt has never once published that field. */
  const invented = ivPathOf({ iv30: 0.4, iv30d_1w: 0.35, iv30d1d: 0.38, iv30d1m: 0.30 });
  eq(invented[1], null,
     "an invented iv30d_1w with no ivMomentum yields null at −1w — the field is not read");
  eq(invented[3], 0.4, "while the points that ARE on the wire still land");
  eq(invented[0], 0.30, "at both ends");

  /* BOTH HALVES ARE REQUIRED. Either one alone withholds the point. */
  eq(ivPathOf({ ivMomentum: 0.01 })[1], null, "ivMomentum with no iv30 withholds −1w");
  eq(ivPathOf({ iv30: 0.4 })[1], null, "and iv30 with no ivMomentum withholds it too");

  /* OVER THE EMITTED PAYLOAD: the reconstruction genuinely fires. A module
     reading the absent field would publish null here on every row. */
  const built = ROWS.filter((r) => r.ivPath[1] !== null).length;
  ok(built > 0 && built === ROWS.filter((r) => r.iv !== null).length,
     `${built} of ${ROWS.length} emitted rows carry a reconstructed −1w point, exactly the ` +
     `rows that carry an iv30 — a module reading tilt.iv30d_1w would publish zero of them`);
  ok(ROWS.filter((r) => r.ivPath[3] === null).every((r) => r.ivPath[1] === null),
     "and the reconstructed point never outlives the point it is reconstructed from");
  ok(ROWS.some((r) => r.ivPath[1] === null && r.ivPath[0] !== null && r.ivPath[2] !== null),
     "the withholding branch is exercised by the corpus: a row whose −1w is null while its " +
     "−1m and −1d are measured");
}

/* ============================================================
   §4. FOUR ELEMENTS, OLDEST FIRST, AND A NULL STAYS NULL.
   ============================================================ */
{
  eq(ivPathOf({}).length, 4, "an empty tilt still yields four points");
  deep(ivPathOf({}), [null, null, null, null], "all of them null, none of them zero");
  eq(ivPathOf(null).length, 4, "as does no tilt at all");
  eq(ivPathOf(undefined).length, 4, "and an undefined one");

  const p = ivPathOf({ iv30: 0.44, ivMomentum: 0.04, iv30d1d: 0.42, iv30d1m: 0.36 });
  deep(p, [0.36, 0.40, 0.42, 0.44],
     "OLDEST FIRST: −1m, −1w, −1d, now — a reversed strip reads as a collapse");
  eq(p[0], 0.36, "index 0 is the month-ago point");
  eq(p[3], 0.44, "and index 3 is now");

  /* One hole in the middle does not shift the others along. */
  deep(ivPathOf({ iv30: 0.44, ivMomentum: 0.04, iv30d1m: 0.36 }), [0.36, 0.40, null, 0.44],
     "a missing −1d stays a hole at index 2 rather than sliding the strip");

  deep(PAYLOAD.ivPath.labels, [...IV_PATH_LABELS],
     "the payload publishes the module's own labels");
  eq(PAYLOAD.ivPath.labels.length, 4, "four of them");
  ok(ROWS.every((r) => Array.isArray(r.ivPath) && r.ivPath.length === PAYLOAD.ivPath.labels.length),
     "and every emitted row's path is the same length as the label list it is read against — " +
     "the labels are stated once in the header, so a length drift would mislabel every row");
}

/* ============================================================
   §5. ev IS null WHERE IT CANNOT BE MEASURED, AND NEVER 0.

   Three different facts, deliberately not collapsed: no sessions
   left to price, no volatility to scale, no date to count to. And
   it is scaled by SESSIONS, never by the calendar days beside them.
   ============================================================ */
{
  const args = { gateOrigin: GATE_ORIGIN };

  /* (a) sdte === 0 — reports on the origin. There is no stretch to price. */
  const today = eventRow({ ticker: "A", close: "50", next_earnings_date: GATE_ORIGIN }, tiltOf(), args);
  eq(today.sdte, 0, "a name reporting on the origin has zero sessions left");
  eq(today.ev, null, "so its priced move is null — there is no horizon to scale to");
  ok(today.ev !== 0, "and specifically not 0, which would read as 'the market charges nothing'");
  eq(today.iv, 0.3, "while its volatility is still published, because that IS measured");

  /* (b) no iv — nothing to scale. */
  const noIv = eventRow({ ticker: "B", close: "50", next_earnings_date: "2026-09-04" },
    tiltOf({ iv30: null }), args);
  eq(noIv.sdte, 7, "Wed 26 → Fri Sep 4 is seven sessions");
  eq(noIv.ev, null, "with no iv30 there is nothing to scale, so ev is null");
  ok(noIv.ev !== 0, "not 0");
  eq(noIv.iv, null, "and the volatility column says so too");

  /* (c) sdte null — no date, or a date already past. */
  const noDate = eventRow({ ticker: "C", close: "50", next_earnings_date: null }, tiltOf(), args);
  eq(noDate.sdte, null, "no date, no session count");
  eq(noDate.ev, null, "and no priced move");
  const past = eventRow({ ticker: "D", close: "50", next_earnings_date: "2026-08-20" }, tiltOf(), args);
  eq(past.sdte, null, "a date already past is null too");
  eq(past.ev, null, "and prices nothing");

  /* WHERE IT IS MEASURED it is sqrt-of-time over SESSIONS and nothing else.
     horizonMove and TRADING_YEAR are IMPORTED rather than retyped: a hardcoded
     252 here would let the two definitions drift apart silently. */
  const m = eventRow({ ticker: "E", close: "50", next_earnings_date: "2026-09-04" },
    tiltOf({ iv30: 0.4000 }), args);
  eq(m.sdte, 7, "seven sessions to the report");
  eq(m.dte, 9, "over nine calendar days");
  near(m.ev, Number(horizonMove(0.4, { sessions: 7 }).toFixed(4)),
     "and ev is horizonMove of the name's own iv over the SESSIONS", 1e-12);
  near(m.ev, 0.4 * Math.sqrt(7 / TRADING_YEAR),
     "which is the annualised vol scaled by the square root of sessions over the trading year",
     5e-5);
  ok(Math.abs(m.ev - 0.4 * Math.sqrt(9 / TRADING_YEAR)) > 1e-3,
     "and NOT by the nine calendar days beside them — the calendar reading is a different " +
     "number and the assertion says so rather than trusting the field name");

  /* OVER THE EMITTED PAYLOAD, both directions. */
  ok(!ROWS.some((r) => r.ev === 0),
     "no emitted row publishes a priced move of exactly 0 — unmeasured is null here");
  const unmeasured = ROWS.filter((r) => r.ev === null);
  ok(unmeasured.length > 0, `${unmeasured.length} emitted rows withhold a priced move`);
  ok(unmeasured.every((r) => r.sdte === 0 || r.sdte === null || r.iv === null),
     "and every one of them is unmeasured for a stated reason: no sessions left, or no iv");
  ok(unmeasured.some((r) => r.iv === null),
     "the no-volatility branch is exercised by the corpus; the zero-session branch is not " +
     "reachable from it at this hour (§15 explains why) and is covered by (a) above");
  const measured = ROWS.filter((r) => r.ev !== null);
  ok(measured.length > 0, `${measured.length} emitted rows price a move`);
  for (const r of measured) {
    /* Tolerance covers the payload's own 4-dp rounding on BOTH ev and iv. */
    assert.ok(Math.abs(r.ev - horizonMove(r.iv, { sessions: r.sdte })) <= 2e-4,
      `${r.t}: ev ${r.ev} is iv ${r.iv} scaled over ${r.sdte} SESSIONS, not ${r.dte} days`);
  }
  checks++;
  ok(measured.every((r) => r.ev > 0 && r.sdte > 0 && r.iv > 0),
     "and every priced row has a positive vol, a positive horizon and a positive price");
}

/* ============================================================
   §6. A NAME WITH NO EARNINGS DATE IS EXCLUDED, NOT SEATED LAST.
   ============================================================ */
{
  const built = buildEvents([
    nameAt("INWIN", "2026-09-04"),
    nameAt("NODATE", null),
    nameAt("PAST", "2026-08-20"),
    { row: { ticker: "BADDATE", close: "10", next_earnings_date: "tbd" }, tilt: tiltOf() },
  ], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });

  deep(built.rows.map((r) => r.t), ["INWIN"],
     "only the dated, still-future name is published — an undated name is not a name " +
     "reporting far away, and seating it after one scheduled in three weeks reads as an order");
  eq(built.inWindow, 1, "the undated name is not counted in the window either");
  eq(built.shown, 1, "nor shown");
  eq(built.universe, 4, "the universe is every name handed in");
  eq(built.dated, 2, "two of them carry a well-formed date (INWIN and PAST)");
  eq(built.undated, 2, "and two do not: the null and the unparseable one");
  eq(built.dated + built.undated, built.universe,
     "dated + undated closes on the universe — no name is lost between the two counts");
  ok(!built.rows.some((r) => r.t === "NODATE"), "NODATE appears in no row");
  ok(!built.rows.some((r) => r.d === null), "and no published row carries a null date");

  /* OVER THE EMITTED PAYLOAD, where the undated population is large. */
  eq(PAYLOAD.dated + PAYLOAD.undated, PAYLOAD.universe,
     `the emitted payload closes the same way: ${PAYLOAD.dated} + ${PAYLOAD.undated} = ` +
     `${PAYLOAD.universe}`);
  ok(PAYLOAD.undated > 0,
     `${PAYLOAD.undated} emitted names carry no earnings date, so the exclusion branch runs`);
  ok(PAYLOAD.dated >= PAYLOAD.inWindow,
     "and the dated count is at least the in-window count — a dated name outside the window " +
     "is still dated");
  ok(ROWS.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.d)),
     "every published row carries an ISO date");
}

/* ============================================================
   §7. ORDERED BY DATE THEN TICKER, NEVER BY ev.
   ============================================================ */
{
  /* CONSTRUCTED SO THE TWO ORDERINGS CANNOT COINCIDE. ZZZ shares BBB's date
     and carries roughly five times its priced move; AAA reports a week later
     and carries the largest of all. Date order is BBB, ZZZ, AAA. ev order is
     its exact reverse. */
  const built = buildEvents([
    nameAt("AAA", "2026-09-04", { iv30: 0.90 }),
    nameAt("ZZZ", "2026-08-27", { iv30: 0.95 }),
    nameAt("BBB", "2026-08-27", { iv30: 0.20 }),
  ], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });

  deep(built.rows.map((r) => r.t), ["BBB", "ZZZ", "AAA"],
     "date first, then ticker — BBB leads its own date on name, not on price");
  const byEv = [...built.rows].sort((a, b) => (b.ev ?? -1) - (a.ev ?? -1)).map((r) => r.t);
  deep(byEv, ["AAA", "ZZZ", "BBB"],
     "ranking the same three by priced move gives the exact reverse");
  ok(JSON.stringify(built.rows.map((r) => r.t)) !== JSON.stringify(byEv),
     "so the published order is demonstrably NOT the ev order — this is a calendar, and a " +
     "calendar sorted by anything but time stops being one");
  ok(built.rows[0].ev < built.rows[1].ev,
     "the first row published is not the most expensive one");

  /* OVER THE EMITTED PAYLOAD. */
  let sorted = true;
  for (let i = 1; i < ROWS.length; i++) {
    const a = ROWS[i - 1], b = ROWS[i];
    if (a.d > b.d || (a.d === b.d && a.t > b.t)) sorted = false;
  }
  ok(sorted, "the emitted rows are non-decreasing in date, and in ticker within a date");
  ok(ROWS.every((r, i) => i === 0 || ROWS[i - 1].dte <= r.dte),
     "and non-decreasing in dte, which is what makes the row order readable as a calendar");
  const evOrder = [...ROWS].sort((a, b) => (b.ev ?? -1) - (a.ev ?? -1)).map((r) => r.t);
  ok(JSON.stringify(ROWS.map((r) => r.t)) !== JSON.stringify(evOrder),
     "while the emitted order differs from the ev ranking, so the corpus can tell them apart");
  ok(ROWS.some((r, i) => i > 0 && ROWS[i - 1].d === r.d),
     "the corpus contains at least one date shared by two names, so the tie-break runs");
}

/* ============================================================
   §8. THE WINDOW IS IN CALENDAR DAYS, AND THE CAP KEEPS THE
   NEAREST.

   THE UNIT IN THE BOUND IS THE WHOLE ASSERTION. Filtering
   `sdte > windowDays` compares sessions against a constant named
   days and admits a name a fifth further out than the window says.
   ============================================================ */
{
  eq(PAYLOAD.shown, ROWS.length, "shown is the published row count, not an intention");
  ok(PAYLOAD.shown <= PAYLOAD.cap, `shown (${PAYLOAD.shown}) is within the cap (${PAYLOAD.cap})`);
  ok(PAYLOAD.shown <= PAYLOAD.inWindow,
     `and within the in-window population (${PAYLOAD.inWindow})`);
  /* THE CAP NO LONGER BINDS ON AN ORDINARY WEEK, AND THE PAYLOAD SAYS SO.

     This used to assert the opposite — that the corpus REACHED the cap — which
     was true at 60 seats and was the defect rather than the certificate: the
     rows are date-ordered, so a bound cap does not thin the table, it ENDS it
     at a date earlier than the window, and the chart's empty right-hand half
     was being blamed on the window. At 200 seats an ordinary week publishes
     the whole in-window population, and `capBound` is the field that says
     which of the two limits stopped the table. The bound branch is exercised
     against a constructed cap below, where it can be reached deliberately
     rather than by waiting for an earnings season. */
  eq(PAYLOAD.capBound, PAYLOAD.inWindow > PAYLOAD.shown,
     `capBound states whether the cap bound (${PAYLOAD.inWindow} in window, ` +
     `${PAYLOAD.shown} shown of ${PAYLOAD.cap} seats)`);
  eq(PAYLOAD.beyondCap, PAYLOAD.inWindow - PAYLOAD.shown,
     "and beyondCap counts what it did not show — a measured zero when it showed everything");
  eq(PAYLOAD.lastShownDate, ROWS.length ? ROWS[ROWS.length - 1].d : null,
     "while lastShownDate is the newest date the drawing can speak for");
  ok(!ROWS.some((r) => r.dte > PAYLOAD.windowDays),
     `no published row reports beyond the ${PAYLOAD.windowDays}-CALENDAR-DAY window`);
  ok(!ROWS.some((r) => r.dte === null || r.sdte === null),
     "and none carries a null on either horizon");

  /* THE BOUND IS TESTED AGAINST dte, AND THE CASE THAT PROVES IT IS THE ONE
     WHERE THE TWO HORIZONS FALL ON OPPOSITE SIDES OF IT.

     Wed 2026-08-26 → Wed 2026-09-09 is 14 calendar days and 10 sessions. With
     a 10-day window: sdte (10) <= 10 < dte (14). The old filter admitted this
     name; the window says 10 DAYS and this name reports in 14. The mirror case
     — dte inside the bound while sdte is outside — cannot be constructed at
     all, because sessions are a subset of the days containing them, so this is
     the only direction in which the two filters can ever disagree. */
  const straddle = eventRow(nameAt("STRADDLE", "2026-09-09").row, tiltOf(),
    { gateOrigin: GATE_ORIGIN });
  eq(straddle.dte, 14, "Wed 26 → Wed Sep 9 is fourteen calendar days");
  eq(straddle.sdte, 10, "and ten trading sessions");
  const cut = buildEvents([nameAt("STRADDLE", "2026-09-09"), nameAt("INSIDE", "2026-09-02")],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE, windowDays: 10 });
  deep(cut.rows.map((r) => r.t), ["INSIDE"],
     "a 10-day window EXCLUDES a name 14 calendar days out whose ten SESSIONS would have " +
     "cleared a bound tested in the wrong unit");
  eq(cut.inWindow, 1, "and does not count it as in the window");
  eq(cut.rows[0].dte, 7, "while the name that is genuinely inside — seven days — is kept");
  eq(cut.rows[0].sdte, 5, "at five sessions");
  ok(cut.rows[0].sdte <= cut.windowDays && cut.rows[0].dte <= cut.windowDays,
     "the kept name is inside the bound on BOTH horizons, which is the only unambiguous case");

  /* THE CAP KEEPS THE NEAREST, NOT AN ARBITRARY SLICE. A cap applied before
     the sort would publish whichever names arrived first. */
  const far = buildEvents([
    nameAt("D4", "2026-09-04"), nameAt("D1", "2026-08-27"),
    nameAt("D3", "2026-09-02"), nameAt("D2", "2026-08-31"),
  ], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE, cap: 2 });
  deep(far.rows.map((r) => r.t), ["D1", "D2"],
     "the cap keeps the two NEAREST reports, in date order, whatever order they arrived in");
  eq(far.shown, 2, "shown is the capped count");
  eq(far.inWindow, 4, "while inWindow is the uncapped population — the two are different facts");

  /* THE BOUND CAP, SAID OUT LOUD. Two of four seated, so the drawing ends on
     2026-08-31 while the window runs three weeks past it. A page that read
     only `windowDays` here would tell the reader the calendar simply holds
     nothing after that date, which is false about two named companies. */
  eq(far.capBound, true, "a cap that bound says so");
  eq(far.beyondCap, 2, "and counts the named rows inside the window it does not show");
  eq(far.lastShownDate, "2026-08-31",
     "and names the date the drawing stops at — which is NOT the window's edge, and is " +
     "the distinction the note used to get wrong");
  ok(far.lastShownDate < far.rows[0].d ? false : true,
     "lastShownDate is the newest drawn date, so it is at or after the first row's");

  /* AND THE UNBOUND CASE IS THE OPPOSITE READING, not a quieter version of the
     same one: nothing is withheld, so beyondCap is a measured zero. */
  const roomy = buildEvents([
    nameAt("D4", "2026-09-04"), nameAt("D1", "2026-08-27"),
  ], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE, cap: 10 });
  eq(roomy.capBound, false, "a cap with room to spare says that instead");
  eq(roomy.beyondCap, 0, "with nothing held back");
  eq(roomy.lastShownDate, "2026-09-04", "and the drawing reaches the farthest name it has");

  /* AN EMPTY TABLE HAS NO LAST DATE. Publishing one would name a date the
     drawing cannot speak for at all. */
  const none = buildEvents([], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
  eq(none.lastShownDate, null, "an empty table names no last date rather than inventing one");
  eq(none.capBound, false, "and a cap cannot bind on nothing");
}

/* ============================================================
   §8b. THE FLOW GROUP, AND THE EVENT PREMIUM.

   A FLOW PRODUCT'S EVENT CALENDAR PUBLISHED NO FLOW. Every tilt
   below is computed by screenerTilt for every eligible name and was
   thrown away for all but the enriched; the only flow reading that
   reached this page did so inside a title attribute.
   ============================================================ */
{
  const tilt = tiltOf({
    premiumTilt: 0.4123456, netTilt: -0.2, volTilt: 0.05,
    surpriseTilt: 1.25, oiTilt: -0.011, putCallRatio: 0.7654,
  });
  const row = eventRow(nameAt("FLOW", "2026-09-04").row, tilt, { gateOrigin: GATE_ORIGIN });
  near(row.pt, 0.4123, "the premium tilt rides the row");
  near(row.nt, -0.2, "the net tilt with its sign");
  near(row.vt, 0.05, "the aggressed-contract tilt");
  near(row.sut, 1.25, "the volume-surprise log ratio");
  near(row.ot, -0.011, "the open-interest tilt");
  near(row.pcr, 0.77, "and the vendor's put/call ratio, rounded to two");

  /* ABSENT IN, ABSENT OUT. A tilt the screener could not compute is null on
     the row — never 0, which on a SIGNED share means "balanced", a reading
     this data did not make. */
  const quiet = eventRow(nameAt("QUIET", "2026-09-04").row,
    tiltOf({ premiumTilt: null, netTilt: undefined, volTilt: "", surpriseTilt: null,
             oiTilt: null, putCallRatio: null }),
    { gateOrigin: GATE_ORIGIN });
  for (const k of ["pt", "nt", "vt", "sut", "ot", "pcr"]) {
    eq(quiet[k], null, `${k} is null when the tilt was not measured, never a balanced 0`);
  }
  eq(eventRow(nameAt("ZERO", "2026-09-04").row, tiltOf({ premiumTilt: 0 }),
    { gateOrigin: GATE_ORIGIN }).pt, 0,
    "while a MEASURED zero tilt publishes as zero — the two are different facts");

  /* THE EVENT PREMIUM IS A RATIO, NOT AN AVERAGE. The vendor's quote brackets
     the report; the benchmark spreads a 30-day vol evenly over the sessions
     before it, which is the assumption a scheduled report breaks. The amount
     by which the first exceeds the second is the only number on the row that
     is about the EVENT. */
  const priced = eventRow(nameAt("PREM", "2026-09-04").row,
    tiltOf({ iv30: 0.40, impliedMovePerc: 0.09 }), { gateOrigin: GATE_ORIGIN });
  ok(priced.ev !== null && priced.im !== null, "both horizons are measured on this row");
  near(priced.evp, Number((priced.im / priced.ev).toFixed(2)),
    "the event premium is the vendor's quote over the benchmark, exactly");
  ok(priced.evp > 1,
     `and on a 40% name reporting in ${priced.sdte} sessions the vendor's quote is ` +
     `${priced.evp}x the constant-vol benchmark — which is the whole reason the ` +
     "benchmark may not be labelled a market quote");
  ok(Math.abs(priced.evp - (priced.im + priced.ev) / 2) > 0.01,
     "it is NOT the average of the two horizons, which EVENTS_NOTES.vendorMove refuses " +
     "because an average of two numbers quoted to two horizons is quoted to neither");

  eq(eventRow(nameAt("NOIM", "2026-09-04").row, tiltOf({ impliedMovePerc: null }),
    { gateOrigin: GATE_ORIGIN }).evp, null,
    "with no vendor quote there is no premium to state, and none is stated");
  eq(eventRow(nameAt("NOIV", "2026-09-04").row, tiltOf({ iv30: null }),
    { gateOrigin: GATE_ORIGIN }).evp, null,
    "and with no benchmark to divide by, likewise — never an infinity and never a 1.0");

  /* THE LEGEND IS STATED ONCE, which is what pays for the short keys. */
  const built = buildEvents([nameAt("FLOW", "2026-09-04")],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
  for (const k of ["pt", "nt", "vt", "sut", "ot", "pcr", "rvol"]) {
    ok(typeof built.flow.labels[k] === "string" && built.flow.labels[k].length > 10,
       `the header names the ${k} column rather than leaving a short key unexplained`);
  }
  ok(/unit-free/.test(built.flow.units),
     "and states that the group shares a unit, which is why it may share an axis");
  ok(/no vendor call/.test(EVENTS_NOTES.flow),
     "the flow note says what it cost");
  ok(/CONSTANT-VOL/.test(EVENTS_NOTES.priced) && /variance accrues/.test(EVENTS_NOTES.priced),
     "the priced note now names the assumption a scheduled report violates");
  ok(/below the vendor/.test(EVENTS_NOTES.priced),
     "and states which side of the vendor's quote the benchmark is expected to sit");
  ok(/ratio of two published numbers/.test(EVENTS_NOTES.eventPremium),
     "the event-premium note names its construction");
  ok(/ENDS/.test(EVENTS_NOTES.cap) && /never attributed to the window/.test(EVENTS_NOTES.cap),
     "and the cap note refuses the attribution the old drawing made");
}

/* ============================================================
   §9 + §10. byStage, THE GATE BOUNDARY, AND WHOSE NUMBER dte IS.

   THE BOUNDARY IS WHERE A BARE LITERAL AND A NAMED CONSTANT
   SILENTLY DISAGREE, so both dates below are built BY ARITHMETIC
   from the imported EARNINGS_GATE_DAYS. Change the constant and the
   fixture moves with it; leave a 12 behind in either predicate and
   this section fails.
   ============================================================ */
{
  /* The pipeline's two predicates, transcribed from their two sites:
       step 2  (the gate itself):   dte === null || dte < 0 || dte > EARNINGS_GATE_DAYS
       step 7e (the events label):  dte !== null && dte >= 0 && dte <= EARNINGS_GATE_DAYS
     They are written as complements and must BEHAVE as complements at the
     boundary, which is the one place a drifted literal shows up. */
  const survivesGate = (dte) => dte === null || dte < 0 || dte > EARNINGS_GATE_DAYS;
  const isGated = (dte) => dte !== null && dte >= 0 && dte <= EARNINGS_GATE_DAYS;

  const gateDte = gateDteFrom(GATE_ORIGIN);
  const atGate = plusDays(GATE_ORIGIN, EARNINGS_GATE_DAYS);
  const pastGate = plusDays(GATE_ORIGIN, EARNINGS_GATE_DAYS + 1);

  eq(gateDte(atGate), EARNINGS_GATE_DAYS, `${atGate} is exactly EARNINGS_GATE_DAYS from the origin`);
  eq(gateDte(pastGate), EARNINGS_GATE_DAYS + 1, `and ${pastGate} is one day past it`);

  ok(isGated(gateDte(atGate)),
     "a name at exactly EARNINGS_GATE_DAYS is GATED — the boundary is inclusive");
  ok(!survivesGate(gateDte(atGate)), "and the pipeline's own gate removed it before scoring");
  ok(!isGated(gateDte(pastGate)), "a name one day further out is NOT gated");
  ok(survivesGate(gateDte(pastGate)), "and the gate let it through to be scored");
  ok(isGated(gateDte(atGate)) !== survivesGate(gateDte(atGate)) &&
     isGated(gateDte(pastGate)) !== survivesGate(gateDte(pastGate)),
     "the two predicates are exact complements ON BOTH SIDES of the boundary — this is why " +
     "EARNINGS_GATE_DAYS was named, and a literal in either site would let them drift");
  eq(PAYLOAD.gateDays, EARNINGS_GATE_DAYS,
     "and the payload publishes that same constant, so the page labels against the gate that ran");

  /* THE TWO NAMES THROUGH THE PAGE, wired the way the pipeline wires them:
     the gate's own count handed down, and the label derived from it. They must
     land on OPPOSITE sides of byStage AND opposite sides of gateDays. */
  const built = buildEvents([nameAt("GATED", atGate), nameAt("CLEAR", pastGate)], {
    gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE,
    /* NO gateDteOf ANY MORE, and its absence is the assertion. The page used
       to be HANDED the gate's count because the two were measured from
       different origins; daysToEarnings now takes the same ISO date this page
       counts from, so the page reproduces the gate's number instead. If the
       two ever drift apart again, `g.dte === EARNINGS_GATE_DAYS` below is
       what fails. */
    stageOf: (t) => (isGated(gateDte(t === "GATED" ? atGate : pastGate)) ? "gated" : "eligible"),
  });
  eq(built.byStage.gated, 1, "exactly one of the pair is labelled gated on the page");
  eq(built.byStage.eligible, 1, "and exactly one is not");
  const g = built.rows.find((r) => r.t === "GATED"), c = built.rows.find((r) => r.t === "CLEAR");
  eq(g.st, "gated", "the name at the boundary is the gated one");
  eq(g.dte, EARNINGS_GATE_DAYS, "and its published dte IS the gate width, to the day");
  eq(c.st, "eligible", "the name one day past it is the clear one");
  eq(c.dte, EARNINGS_GATE_DAYS + 1, "and its published dte is one past the gate width");
  ok(g.dte <= PAYLOAD.gateDays && c.dte > PAYLOAD.gateDays,
     "so a reader can check the label against the number beside it and find them agreeing — " +
     "which is the whole reason dte is published in the gate's unit");

  /* byStage SUMS TO shown, INCLUDING THE UNLABELLED. */
  const mixed = buildEvents([
    nameAt("S1", "2026-08-27"), nameAt("S2", "2026-08-28"), nameAt("S3", "2026-08-31"),
  ], {
    gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE,
    stageOf: (t) => (t === "S1" ? "gated" : t === "S2" ? "board:long" : null),
  });
  eq(Object.values(mixed.byStage).reduce((a, b) => a + b, 0), mixed.shown,
     "byStage sums to shown");
  eq(mixed.byStage.unclassified, 1,
     "and a name the funnel never labelled is counted as UNCLASSIFIED rather than dropped — " +
     "a stage histogram that quietly loses a row misstates the funnel it exists to describe");

  /* §9 OVER THE EMITTED PAYLOAD. */
  eq(Object.values(PAYLOAD.byStage).reduce((a, b) => a + b, 0), PAYLOAD.shown,
     `the emitted byStage sums to shown (${PAYLOAD.shown})`);
  ok(Object.keys(PAYLOAD.byStage).length > 1,
     "over more than one stage, so the histogram is not a single bucket");
  ok((PAYLOAD.byStage.gated || 0) > 0,
     `${PAYLOAD.byStage.gated} emitted rows are labelled gated — the population this page ` +
     `exists to publish is non-empty`);
  for (const [k, n] of Object.entries(PAYLOAD.byStage)) {
    assert.equal(n, ROWS.filter((r) => (r.st || "unclassified") === k).length,
      `byStage.${k} is the actual count of rows carrying that stage`);
  }
  checks++;

  /* §10a. GATE CONSISTENCY, BOTH DIRECTIONS, over the emitted payload. Either
     direction alone is satisfiable by a broken labeller: label everything
     gated and the first holds; label nothing gated and the second does. */
  const gatedRows = ROWS.filter((r) => r.st === "gated");
  ok(gatedRows.length > 0 && gatedRows.every((r) => r.dte <= PAYLOAD.gateDays),
     `all ${gatedRows.length} gated rows report within gateDays (${PAYLOAD.gateDays}) — no row ` +
     `is labelled gated beside a number that says it is outside the gate`);
  const insideGate = ROWS.filter((r) => r.dte <= PAYLOAD.gateDays);
  ok(insideGate.length > 0 && insideGate.every((r) => r.st === "gated"),
     `and all ${insideGate.length} rows reporting within gateDays ARE labelled gated — no name ` +
     `inside the gate reaches the page under a stage that claims the board had an opinion`);
  ok(ROWS.some((r) => r.st !== "gated"),
     "while the corpus contains ungated rows too, so the label is discriminating rather than " +
     "applied to everything that reaches this page");
  eq(gatedRows.length, insideGate.length,
     "the two populations are the same population, counted two ways");

  /* §10b. dte IS THE GATE'S OWN NUMBER, PASSED THROUGH — NOT A SECOND OPINION.
     AND IT IS NOW REPRODUCIBLE FROM A PUBLISHED FIELD, which is a stronger
     property than the one this assertion originally had. daysToEarnings used
     to round against the run's INSTANT, so a reader holding the payload could
     not check the gate's arithmetic at all — only a test that happened to know
     generatedAt could, and only to the minute. It measures from gateOrigin
     now, which the payload states, so every published dte is checkable by
     anyone holding the payload and this loop is that check.

     The same change is what made dte and sdte consistent: both are counted
     from the one origin the payload names. */
  for (const r of ROWS) {
    assert.equal(r.dte, daysToEarnings({ next_earnings_date: r.d }, PAYLOAD.gateOrigin),
      `${r.t} (${r.d}): dte is the gate's own count, reproduced from the published gateOrigin`);
  }
  checks++;

  /* §10c. AND THERE IS NO PASSTHROUGH LEFT TO PREFER, which is the point.

     This asserted the opposite until the fix: a caller-supplied gateDte won
     over the local count, because the gate measured from an INSTANT and this
     page from MIDNIGHT and the two disagreed by a day at most hours. That
     passthrough bought agreement by trusting the caller, and the trust was
     what let an undated name onto the calendar (§15b).

     daysToEarnings takes an ISO date now, so both are the same arithmetic
     against the same origin and the page can simply compute it. What is
     asserted here is that it does, and that it agrees with the gate. */
  const local = eventRow(nameAt("PT", "2026-08-31").row, tiltOf(), { gateOrigin: GATE_ORIGIN });
  eq(local.dte, 5, "the module counts calendar days from gateOrigin itself");
  eq(local.dte, daysToEarnings({ next_earnings_date: "2026-08-31" }, GATE_ORIGIN),
     "and lands on exactly what the gate's own function returns for the same span — one " +
     "computation, not two that happen to agree");
  eq(eventRow({ ticker: "PT" }, tiltOf(), { gateOrigin: GATE_ORIGIN }).dte, null,
     "and a name with no date has no horizon, whatever any caller might wish to supply");

}

/* ============================================================
   §11. rvMeasured AND evMeasured ARE THE ACTUAL NON-NULL COUNTS.

   A counter that returned rows.length would pass on any corpus where
   every row happens to carry one. So the fixture withholds a KNOWN
   number and the counter has to move by exactly that many.
   ============================================================ */
{
  const TEN = Array.from({ length: 10 }, (_, i) =>
    nameAt("N" + String(i).padStart(2, "0"), "2026-09-02"));
  const opts = { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE };

  const all = buildEvents(TEN, { ...opts, featuresOf: () => ({ rv30: 0.22 }) });
  eq(all.shown, 10, "ten names published");
  eq(all.rvMeasured, 10, "and ten realized-vol readings when every name carries one");

  /* MUTATION IS THE POINT: rv is withheld on FOUR NAMED rows. A counter
     returning rows.length reports 10 here and the fixture above would never
     have caught it. */
  const WITHHELD = new Set(["N01", "N03", "N05", "N07"]);
  const some = buildEvents(TEN, {
    ...opts, featuresOf: (t) => (WITHHELD.has(t) ? null : { rv30: 0.22 }),
  });
  eq(some.shown, 10, "the same ten names are still published");
  eq(some.rvMeasured, 6,
     "but rvMeasured falls to 6 — it moved by exactly the four that were withheld");
  eq(all.rvMeasured - some.rvMeasured, WITHHELD.size,
     "the delta IS the withheld count, which a rows.length counter cannot reproduce");
  eq(some.rows.filter((r) => r.rv === null).length, 4,
     "and the four withheld rows publish a null rv rather than a zero one");
  ok(!some.rows.some((r) => r.rv === 0),
     "no row reports a realized vol of exactly 0, which is what a zero-fill would look like");

  /* THE COUNTER IS OVER shown, NOT OVER inWindow: a row the cap dropped is not
     a measurement the page can point at. */
  const capped = buildEvents(TEN, {
    ...opts, cap: 5, featuresOf: (t) => (WITHHELD.has(t) ? null : { rv30: 0.22 }),
  });
  eq(capped.shown, 5, "five seats");
  eq(capped.inWindow, 10, "of ten qualifying names");
  eq(capped.rvMeasured, capped.rows.filter((r) => r.rv !== null).length,
     "and rvMeasured counts the PUBLISHED rows that carry one, not the qualifying ones");
  eq(capped.rvMeasured, 3, "which here is three of the five shown");

  /* evMeasured, the same discipline: withhold the volatility on three. */
  const noVol = buildEvents(
    TEN.map((n, i) => (i < 3 ? { ...n, tilt: tiltOf({ iv30: null }) } : n)), opts);
  eq(noVol.shown, 10, "ten names again");
  eq(noVol.evMeasured, 7, "and seven priced moves — the three without an iv30 are not counted");
  eq(buildEvents(TEN, opts).evMeasured - noVol.evMeasured, 3,
     "the counter moved by exactly the three that lost their volatility");

  /* OVER THE EMITTED PAYLOAD, where both counters are strictly below the row
     count — which is what makes them worth publishing at all. */
  eq(PAYLOAD.rvMeasured, ROWS.filter((r) => r.rv !== null).length,
     `rvMeasured (${PAYLOAD.rvMeasured}) is the actual non-null count`);
  eq(PAYLOAD.evMeasured, ROWS.filter((r) => r.ev !== null).length,
     `evMeasured (${PAYLOAD.evMeasured}) is the actual non-null count`);
  ok(PAYLOAD.rvMeasured < PAYLOAD.shown,
     `and rvMeasured (${PAYLOAD.rvMeasured}) is strictly below shown (${PAYLOAD.shown}) — a ` +
     `counter that returned rows.length would fail on this corpus, not pass it`);
  ok(PAYLOAD.evMeasured < PAYLOAD.shown,
     `as is evMeasured (${PAYLOAD.evMeasured}) — realized vol is enriched-only and the ` +
     `coverage gap is published rather than left to be inferred from the em dashes`);
}

/* ============================================================
   §12. px IS null, NEVER 0, WHERE THE CLOSE IS ABSENT OR ABSURD.
   ============================================================ */
{
  /* THE FIXTURE IS AN EMITTED ROW, SOLVED BACK. The screener row is
     reconstructed from a row the pipeline actually published, and the
     reconstruction is CHECKED to reproduce that row's px before anything is
     mutated — which is what makes it an emitted fixture rather than an
     invented one. */
  const em = ROWS.find((r) => r.px !== null);
  ok(em && em.px > 0, `an emitted row carries a positive close to mutate (${em.t} at ${em.px})`);
  const screener = {
    ticker: em.t, close: em.px.toFixed(2), next_earnings_date: em.d, sector: em.sector,
  };
  const rebuilt = eventRow(screener, tiltOf(),
    { gateOrigin: PAYLOAD.gateOrigin, gateDte: em.dte });
  eq(rebuilt.px, em.px,
     "the reconstructed screener row reproduces the emitted px exactly, field for field");
  eq(rebuilt.dte, em.dte, "and its dte");
  eq(rebuilt.sdte, em.sdte, "and its sdte");

  /* MUTATION IS THE POINT: every emitted row in this corpus carries a
     well-formed positive close, so the refusal branch has no way to execute
     against the payload alone. Each mutation below changes ONE FIELD. */
  for (const [close, why] of [
    [0, "a numeric zero"],
    [null, "an absent close"],
    ["", "an empty string"],
    [-5, "a negative close"],
    ["0.00", "a zero that arrived as a string, which is how the wire sends it"],
    [undefined, "a missing key"],
  ]) {
    const mutated = eventRow({ ...screener, close }, tiltOf(),
      { gateOrigin: PAYLOAD.gateOrigin, gateDte: em.dte });
    assert.equal(mutated.px, null, `px is null for ${why}`);
    assert.notEqual(mutated.px, 0,
      `and specifically not 0 for ${why} — a zero price is a quote, not a silence`);
    checks += 2;
  }
  /* The row survives the mutation: an unpriceable name is still on the
     calendar, because the date is what puts it there. */
  const stillThere = eventRow({ ...screener, close: null }, tiltOf(),
    { gateOrigin: PAYLOAD.gateOrigin, gateDte: em.dte });
  eq(stillThere.d, em.d, "a name with no close still carries its report date");
  eq(stillThere.t, em.t, "and its ticker");
  ok(!ROWS.some((r) => r.px === 0), "and no emitted row publishes a price of exactly 0");
}

/* ============================================================
   §13. THE ANNOUNCE COLUMN IS WITHHELD WHOLE, WITH A REASON.
   ============================================================ */
{
  ok(PAYLOAD.announce && typeof PAYLOAD.announce === "object", "the payload carries an announce block");
  eq(PAYLOAD.announce.status, "unavailable",
     "whose status is 'unavailable' — the column is not attempted, it is declared absent");
  ok(typeof PAYLOAD.announce.reason === "string" && PAYLOAD.announce.reason.length > 0,
     "with a non-empty reason, so the blank column cannot be read as an absence of events");
  eq(PAYLOAD.announce.reason, EVENTS_NOTES.announce,
     "and the reason is the module's own published prose, not a second wording of it");
  ok(ROWS.every((r) => r.when === null),
     `all ${ROWS.length} rows publish a null 'when' — the column is withheld WHOLE rather ` +
     `than half-filled, because a column populated for the first fortnight and blank after ` +
     `invites exactly the wrong inference about the names in the blank half`);
  ok(!ROWS.some((r) => r.when === "" || r.when === "unknown" || r.when === "?"),
     "and none of them fills the hole with a placeholder that would sort or read as a value");
  eq(eventRow({ ticker: "X", close: "10", next_earnings_date: "2026-09-04" },
    tiltOf(), { gateOrigin: GATE_ORIGIN }).when, null,
     "the module itself publishes null there unconditionally — a future run that starts " +
     "populating this column has to change this test deliberately");
}

/* ============================================================
   §14. THE PROSE SAYS WHAT THE PAGE MAY NOT CLAIM.

   These sentences are the product. A silent rewording of any of them
   is a change in what this page claims, not a copy edit.
   ============================================================ */
{
  deep(PAYLOAD.notes, { ...EVENTS_NOTES },
     "the payload publishes the module's notes verbatim, not a paraphrase of them");

  /* THE PRICED MOVE IS NOT A FORECAST. The single sentence that separates
     'what the option market is charging' from 'what this desk thinks'. */
  ok(/not a forecast/i.test(EVENTS_NOTES.priced),
     "notes.priced states in words that the priced move is NOT A FORECAST");
  /* THE CLAIM THIS ASSERTION USED TO PIN HAS BEEN WITHDRAWN, DELIBERATELY.

     It required the note to say the priced move is "what the option market is
     CHARGING for that stretch". That sentence is the overclaim: the option
     market is not quoting iv30·sqrt(t) to anybody. It is this desk's
     constant-vol model of a quote, and it sat to the LEFT of the vendor's
     actual quote, which was labelled merely "Vendor" — so the modelled number
     wore the language of the observed one.

     The note now says what it IS in the only terms the arithmetic supports: a
     benchmark computed here, expected to sit below the vendor's own
     event-bracketing quote. The assertion moves with it. */
  ok(/BENCHMARK/.test(EVENTS_NOTES.priced),
     "and says what it IS: a constant-vol BENCHMARK computed by this desk, not a quote");
  ok(!/what the option market is CHARGING/.test(EVENTS_NOTES.priced),
     "and no longer claims to be what the option market is charging — square-root-of-time " +
     "is a model of a quote, not a quote, and a scheduled report is the case that breaks it");
  ok(/square root of time/i.test(EVENTS_NOTES.priced),
     "naming the construction, so the number can be checked rather than trusted");
  ok(/no rate, no dividend/i.test(EVENTS_NOTES.priced),
     "and stating that no free parameter entered it");
  ok(/sessions between the run and the report/i.test(EVENTS_NOTES.priced),
     "and naming the UNIT it scales over — sessions, not the calendar days beside them");

  /* THE TWO CLOCKS ARE NAMED, BOTH OF THEM. A note that named only one would
     leave a reader unable to tell which column was measured from where. */
  ok(/two clocks/i.test(EVENTS_NOTES.clocks), "notes.clocks says there are two clocks");
  ok(/do not share an origin/i.test(EVENTS_NOTES.clocks), "and that they do not share an origin");
  ok(/last completed session/i.test(EVENTS_NOTES.clocks),
     "it names the first origin — the last completed session, which every PRICE describes");
  ok(/Eastern date/i.test(EVENTS_NOTES.clocks),
     "and the second — the run's own Eastern date, which every DAY COUNT uses");
  ok(/gate/i.test(EVENTS_NOTES.clocks),
     "tying the second to the gate that actually ran, which is why it is the one that counts");

  /* HOLIDAYS ARE ADMITTED, NOT FIXED. */
  ok(/weekdays/i.test(EVENTS_NOTES.sessions), "notes.sessions states that sessions are weekdays");
  ok(/holidays are not removed/i.test(EVENTS_NOTES.sessions),
     "and ADMITS that market holidays are not removed — the count is approximate and says so");
  ok(/no holiday calendar/i.test(EVENTS_NOTES.sessions),
     "giving the reason: this desk holds no holiday calendar and inventing one is a free parameter");

  /* THE OTHER THREE REFUSALS THE PAGE RESTS ON. */
  ok(/FORBIDDEN/.test(EVENTS_NOTES.gate),
     "notes.gate says a gated name is one the board was FORBIDDEN from holding an opinion on, " +
     "which is a different fact from having none");
  ok(/[Nn]ever by the priced move/.test(EVENTS_NOTES.order),
     "notes.order states the sort is never by the priced move");
  ok(/quoted to neither/i.test(EVENTS_NOTES.vendorMove),
     "notes.vendorMove states why the two implied moves are not averaged: an average of two " +
     "numbers quoted to two horizons is quoted to neither");
  ok(/enriched/i.test(EVENTS_NOTES.coverage),
     "and notes.coverage states that realized vol is enriched-only, which is what rvMeasured counts");
}

/* ============================================================
   §15. THE INVARIANTS THE TWO BREACHES WERE FOUND BY.

   THIS SECTION USED TO FAIL ON PURPOSE. It carried two assertions
   that the module could not satisfy, left red rather than weakened:

     (a) `sdte <= dte` — a weekday count cannot exceed the calendar
         count containing it. It did, on 8 of 60 emitted rows,
         because `dte` was the gate's passthrough measured from
         Date.now() while `sdte` counted from gateOrigin's midnight:
         two origins about 21 hours apart. 60 of 60 published `dte`
         values disagreed with the calendar count from the very
         origin the payload named.

     (b) an undated name was seated on the calendar whenever the
         caller supplied a count for it, counted in `inWindow` and
         in `undated` at once.

   Both are fixed at the root rather than at the symptom.
   daysToEarnings measures from an ISO DATE now, not an instant, so
   the gate is a function of the session's calendar day rather than
   of the minute the runner fired — which also makes the gate's count
   and this page's the SAME arithmetic against the SAME origin. The
   passthrough that (b) rode in on is gone with it.

   The assertions stay, as invariants rather than as breaches. They
   are the ones that would catch the fix being undone.
   ============================================================ */
{
  /* (a) UNITS CANNOT CROSS. Deterministic, not corpus-dependent: this is the
     exact argument shape the pipeline passes, and it held at no hour before
     the fix. */
  for (const [d, why] of [
    ["2026-08-27", "one calendar day, one session"],
    ["2026-08-29", "a Saturday target — two sessions inside three calendar days"],
    ["2026-08-31", "across a weekend"],
    ["2026-09-09", "two weeks out"],
  ]) {
    const r = eventRow({ ticker: "U", next_earnings_date: d, close: 10 }, {},
      { gateOrigin: GATE_ORIGIN });
    ok(r.sdte <= r.dte,
       `${d}: sdte ${r.sdte} <= dte ${r.dte} — ${why}. A weekday count larger than the ` +
       `calendar count containing it is arithmetically impossible for one span, and is ` +
       `what two origins produce`);
  }
  const crossed = ROWS.filter((r) => r.sdte > r.dte);
  eq(crossed.length, 0,
     `and no emitted row crosses the units either (${crossed.length} of ${ROWS.length})`);

  /* AND THE GATE'S COUNT IS REPRODUCIBLE FROM THE PUBLISHED ORIGIN, which is
     the property that replaced the passthrough. */
  const drifted = ROWS.filter(
    (r) => r.dte !== daysToEarnings({ next_earnings_date: r.d }, PAYLOAD.gateOrigin));
  eq(drifted.length, 0,
     "every published dte is reproducible from the gateOrigin the payload states — the page " +
     "does not hold a second opinion about the gate's own count, and a reader can check it");

  /* (b) AN UNDATED NAME IS NEVER SEATED, and no caller convention is relied
     on for it: eventRow can see for itself that there is no date. */
  const undated = buildEvents([{ row: { ticker: "NODATE" }, tilt: {} }],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
  eq(undated.inWindow, 0, "a name with no earnings date is not admitted to the calendar");
  eq(undated.rows.length, 0, "and appears in no row");
  eq(undated.undated, 1, "and is counted as undated, once");
  const nd = eventRow({ ticker: "NODATE" }, {}, { gateOrigin: GATE_ORIGIN });
  eq(nd.dte, null, "its calendar horizon is null");
  eq(nd.sdte, null, "and so is its session horizon — both are null together, always");
}

/* ============================================================
   §16. THE RAIL BADGE IS THE POPULATION, NOT THE PAGE.

   THE ONE SECTION THAT OPENS THE RENDERER, and it is here because
   the two integers it has to tell apart are both published and are
   equal on the emitted corpus. §8 pins them as separate facts —
   `shown` is what the table draws, `inWindow` is how many names
   report inside the window — and on an ordinary week the cap does
   not bind, so 200 seats over sixty names makes them the same
   number. A suite that never rendered the page could therefore
   watch the badge fill from `shown` forever and stay green.

   IT DID. flows-events.js filled the badge from `shown`, which is
   POST-CAP, four lines below a status sentence that says "the cap
   holds the list to 200" in words: with 240 names reporting the
   rail said 200 while the sentence beside it said 240 existed. A
   number in the nav that silently means "as many as we chose to
   draw" is the truncation defect one element wide, and /flows/
   fills this same slot from this same payload — two routes wording
   one quantity differently is how a reader concludes there are two
   quantities.

   SO THE FIXTURE IS §8's `far` FIXTURE: four dated names into two
   seats, where the two integers are 4 and 2 and can be told apart
   by looking. The page is served from shared/flows-pages.js and its
   own fetch is stubbed with the payload, so no Worker, session or
   store is involved: what is under test is which published field
   reaches the DOM node, and nothing else.
   ============================================================ */
{
  /* The served shell without its two script tags. flows-events.js is
     injected below instead, so it runs against a stub that is already in
     place, and nav.js — which this section is not about — never runs. */
  const HTML = eventsPage({ username: "test" }).replace(/<script[^>]*><\/script>/g, "");
  const browser = await chromium.launch();
  try {
    const render = async (payload) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) =>
        route.fulfill({ contentType: "text/html", body: HTML }));
      await page.addInitScript((pl) => {
        window.fetch = () => Promise.resolve({
          ok: true, status: 200,
          /* A FRESH X-Payload-Updated, so the staleness banner stays down and
             the only thing under test is the badge. */
          headers: { get: () => String(Date.now()) },
          json: () => Promise.resolve(JSON.parse(JSON.stringify(pl))),
        });
      }, payload);
      await page.goto("https://x.test/flows/events/", { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ path: path.join(ROOT, "assets/js/flows-events.js") });
      /* WAITING ON THE STATUS STRIP WAITS ON THE EXACT FUNCTION UNDER TEST:
         renderStatus writes that sentence and then fills the badge, so a
         strip that has left "Loading the calendar…" means the badge line has
         run — including on the empty-calendar branch, which calls
         renderStatus deliberately and draws no row to wait for. */
      await page.waitForFunction(
        () => !/^Loading/.test(document.getElementById("evStatus").textContent),
        null, { timeout: 15000 });
      const read = await page.evaluate(() => {
        const slot = document.querySelector('[data-rail-count="events"]');
        return {
          present: !!slot,
          text: slot ? slot.textContent.trim() : null,
          hidden: slot ? slot.hidden : null,
          status: document.getElementById("evStatus").textContent,
          rows: document.querySelectorAll("#evBody tr").length,
        };
      });
      await page.close();
      return { ...read, errors };
    };

    /* (a) THE CAPPED CALENDAR. Four names inside the window, two seats. */
    const capped = buildEvents([
      nameAt("D4", "2026-09-04"), nameAt("D1", "2026-08-27"),
      nameAt("D3", "2026-09-02"), nameAt("D2", "2026-08-31"),
    ], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE, cap: 2 });
    eq(capped.shown, 2, "the fixture draws two rows");
    eq(capped.inWindow, 4,
       "out of a population of four — the two integers the badge has to tell apart");

    const cap = await render(capped);
    deep(cap.errors, [], `the calendar renders without throwing (${cap.errors[0] || "clean"})`);
    /* THE DEPENDENCY BEFORE THE SYMPTOM. The slot was queried by this file
       and emitted by nothing for as long as the badge existed, and a missing
       node makes every assertion below read as a wrong number rather than as
       an absent element. */
    ok(cap.present, "the events page emits the badge slot the renderer queries");
    eq(cap.rows, 2, "the table draws the two rows the cap left it");
    eq(cap.text, "4",
       "and the badge reads 4 — the names reporting inside the window, which is the " +
       "population the page was asked about and not the length of its own table");
    ok(cap.text !== String(capped.shown),
       `and never ${capped.shown}, the post-cap count it used to publish: a badge that ` +
       `means "as many as we chose to draw" is the truncation the cap already performed, ` +
       `restated in the nav as a fact about the market`);
    eq(cap.hidden, false, "and it is revealed, because a population did arrive");
    /* ONE QUANTITY, TWICE, ON ONE SCREEN. The strip and the badge are four
       lines apart in the same function; a reader who can see both must not
       be able to subtract them. */
    ok(/2 of 4 names reporting inside the/.test(cap.status),
       `the sentence beside it names the same four (${cap.status.slice(0, 60)}…)`);
    ok(/the cap holds the list to 2/.test(cap.status),
       "and says out loud that the two on the page are a choice this page made");

    /* (b) WHAT IS WITHHELD IS AN inWindow THAT NEVER ARRIVED. The rows are
       still there and still drawn, so the row count is available to fall back
       on — and it is exactly the number that must not be published. No
       population was measured, so none is claimed. */
    const withheld = { ...capped };
    delete withheld.inWindow;
    const held = await render(withheld);
    eq(held.rows, 2, "a payload with no population still draws its rows");
    eq(held.text, "", "but the badge is left empty rather than filled from them");
    eq(held.hidden, true, "and stays hidden, which is the page declining to answer");

    /* (c) A ZERO IS A MEASUREMENT AND IS PRINTED. renderStatus never runs on
       a pending payload — that branch returns before it — so the only zero
       that can reach this line is one a run measured, and the empty-calendar
       branch calls renderStatus deliberately, as "a measured emptiness". A
       badge guarded on truthiness withheld precisely that reading, and left
       the rail silent on the one session where an empty calendar is news. */
    const quiet = buildEvents([], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
    eq(quiet.inWindow, 0, "an empty universe measures a population of zero");
    const none = await render(quiet);
    eq(none.rows, 1, "the table says so in a row of its own rather than going blank");
    eq(none.text, "0",
       "and the badge prints the zero — 'no name reports this week' is a reading, and " +
       "withholding it is indistinguishable from a calendar that never published");
    eq(none.hidden, false, "so the slot is revealed to carry it");
  } finally {
    await browser.close();
  }
}

console.log(`✓ flows-events: ${checks} assertions — a session count measured from the run's ` +
  `own Eastern date and never from the last completed session, with the wrong integer ` +
  `written down beside every right one, a window bound tested in the unit its name carries ` +
  `over a span constructed to straddle it, a weekend that is one session and not three, a ` +
  `past date that is null and not zero on both horizons, a −1w point reconstructed from a ` +
  `difference because the wire has never carried the level, a priced move scaled by sessions ` +
  `and never by the calendar days beside them, an undated name excluded and counted rather ` +
  `than seated at the end of a calendar, an order that is date-then-name over a corpus where ` +
  `the price ranking is its reverse, a gate boundary built by arithmetic from the constant ` +
  `both sites share and agreeing in both directions over the payload, a dte that is the ` +
  `gate's own number rather than a second opinion about it, coverage counters that move by ` +
  `exactly the number withheld from them, a price that refuses a zero close in six shapes, ` +
  `an announce column withheld whole with its reason published, the sentences that keep ` +
  `the page from claiming a forecast, and a rail badge read off a rendered page that counts ` +
  `the names reporting rather than the rows the cap left on it, withholds where no ` +
  `population was published, and prints a measured zero`);
