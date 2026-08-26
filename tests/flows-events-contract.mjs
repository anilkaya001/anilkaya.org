/* =============================================================
   flows-events-contract.mjs — the events calendar.

   THIS SUITE IS SCOPED TO THE PURE MODULE AND THE PAYLOAD. Both
   exist and are stable. assets/js/flows-events.js is being written
   in parallel; nothing here touches it, imports it, or assumes it
   exists.

   WHAT IS WORTH ASSERTING ABOUT THIS MODULE is not that it computes
   what it computes. shared/flows-events.js opens on a CORRECTION —
   sessionDate and the earnings gate DO NOT SHARE AN ORIGIN — and
   every expensive defect this page can ship is a quiet breach of it
   or of one of its four siblings: a day count measured from the
   wrong clock, a weekend counted as three sessions, a −1w point read
   off a field the wire has never carried, a null that becomes a
   zero, and a calendar quietly re-sorted into a leaderboard. Those
   are the assertions below.

   ON FIXTURES, and this is the house rule the repo has paid for five
   separate times: a fixture written from the same assumption as the
   code proves only that the assumption is self-consistent. The
   two-clock defect is the purest instance of it ever shipped here —
   a suite that computes its expected session count from sessionDate
   agrees with a broken module PERFECTLY, on every row, forever, and
   only the live drawing is wrong. So every expectation in §1 and §2
   is a hand-counted integer over a named weekday span, written down
   with the weekday of each end, and the WRONG answer is written down
   beside it. Where a state does not occur in the emitted corpus —
   a non-positive close, an invented iv30d_1w, a rv withheld on a
   known count — the fixture is an emitted row with ONE NAMED FIELD
   MUTATED, and the mutation is said to be the point at the site.

   ONE PLACE WHERE THIS SUITE DELIBERATELY DOES NOT ASSERT WHAT IT
   COULD, argued in full at the site rather than quietly softened:
   the gate label's reckoning over the emitted payload is checked
   against the run's own INSTANT (§10b), not against gateOrigin's
   midnight, because those are two different quantities and the
   pipeline is entitled to the one it used.
   ============================================================= */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  buildEvents, eventRow, sessionsToEarnings, ivPathOf,
  IV_PATH_LABELS, EVENT_ROWS, EVENT_WINDOW_DAYS, EVENTS_NOTES,
} from "../shared/flows-events.js";
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

/* ============================================================
   §0. THE TWO CLOCKS ARE BOTH PUBLISHED.
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
}

/* ============================================================
   §1. sdte IS COMPUTED FROM gateOrigin, NEVER FROM sessionDate.

   THE ASSERTION THIS FILE EXISTS FOR. Every expectation here is
   hand-counted over a named weekday span and the sessionDate answer
   is written down beside it as the specific wrong integer, because
   a suite that derived its expectation from sessionDate would agree
   with a broken module on every row of every corpus forever.
   ============================================================ */
{
  /* Friday 2026-08-28.
       from Wednesday 2026-08-26 (gateOrigin):  Thu 27, Fri 28          = 2
       from Monday    2026-08-24 (sessionDate): Tue 25, Wed 26, 27, 28  = 4
     Two different integers over the same row. The module must answer 2. */
  const row = eventRow(nameAt("CLK", "2026-08-28").row, tiltOf(), { gateOrigin: GATE_ORIGIN });
  eq(row.sdte, 2,
     "sdte counts sessions from gateOrigin: Wed 26 → Fri 28 is Thu and Fri, two sessions");
  ok(row.sdte !== 4,
     "and NOT from sessionDate, whose reckoning of the same row is 4 — the number a page " +
     "counting from the last completed session would draw, invisibly, on every row");
  eq(sessionsToEarnings("2026-08-28", SESSION_DATE), 4,
     "the wrong answer is written down here so the test cannot be satisfied by accident");

  /* THE SAME ROW THROUGH buildEvents, WHICH IS HANDED BOTH CLOCKS. A module
     that passed sessionDate down to eventRow would still publish gateOrigin in
     the header and look correct to a reader of the header alone. */
  const built = buildEvents([nameAt("CLK", "2026-08-28")],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
  eq(built.rows[0].sdte, 2,
     "buildEvents holds both clocks and still counts from gateOrigin");
  eq(built.gateOrigin, GATE_ORIGIN, "publishing the origin it counted from");
  eq(built.sessionDate, SESSION_DATE, "beside the session every PRICE describes");

  /* A DATE THAT SITS BETWEEN THE TWO CLOCKS, which is the sharpest form of the
     same test: Tuesday 2026-08-25 is one session AHEAD of sessionDate and one
     day BEHIND gateOrigin. The two clocks do not merely disagree on the count
     here — they disagree on whether the name is on this page at all. */
  const between = eventRow(nameAt("MID", "2026-08-25").row, tiltOf(), { gateOrigin: GATE_ORIGIN });
  eq(between.sdte, null,
     "a name reporting between the two clocks has ALREADY REPORTED as of gateOrigin — null");
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
   §2. SESSIONS ARE WEEKDAYS, AND null IS NOT ZERO.
   ============================================================ */
{
  /* Friday 2026-08-28 → Monday 2026-08-31. One session. The calendar-day
     answer is 3, and a horizon scaled by sqrt(3/252) instead of sqrt(1/252)
     is wrong by sqrt(3) at every weekend it crosses. */
  eq(sessionsToEarnings("2026-08-31", "2026-08-28"), 1,
     "Friday → Monday is ONE session, not the three calendar days between them");
  eq(sessionsToEarnings("2026-09-02", "2026-08-26"), 5,
     "Wednesday → the next Wednesday is five sessions: Thu, Fri, Mon, Tue, Wed");
  eq(sessionsToEarnings("2026-08-31", "2026-08-24"), 5,
     "and Monday → the next Monday is five as well, the weekend removed once");

  /* SAME DAY IS A READING, NOT AN ABSENCE. "Reports today, no sessions left to
     price" and "no date on the wire" are different facts and must not collapse
     into the same value. */
  eq(sessionsToEarnings("2026-08-26", "2026-08-26"), 0,
     "a name reporting on the origin itself is 0 sessions — a measurement");
  eq(sessionsToEarnings("2026-08-29", "2026-08-28"), 0,
     "and Friday → Saturday is also 0: a real count of the weekdays in between");
  ok(sessionsToEarnings("2026-08-26", "2026-08-26") !== null,
     "neither of which is null");

  /* THE PAST IS null, NOT 0 AND NOT NEGATIVE. A negative would sort ahead of
     every real row; a 0 would read as "reports today". */
  eq(sessionsToEarnings("2026-08-24", "2026-08-26"), null,
     "a date already past returns null — it is not this page's row");
  eq(sessionsToEarnings("2026-08-25", "2026-08-26"), null,
     "including yesterday, one day back");
  ok(!ROWS.some((r) => r.sdte < 0), "and no emitted row carries a negative session count");

  /* ABSENT OR MALFORMED IS null, over every shape the wire has produced. */
  for (const [bad, why] of [
    [null, "a null date"], [undefined, "an absent field"], ["", "an empty string"],
    ["2026-8-4", "an unpadded date"], ["not-a-date", "a non-date"],
    ["20260904", "an unseparated date"], ["2026-09-04T00:00:00Z", "a full timestamp"],
    ["2026-13-45", "a well-SHAPED date that is not a date"],
  ]) {
    eq(sessionsToEarnings(bad, GATE_ORIGIN), null, `${why} returns null, never 0`);
  }
  /* AND A MALFORMED ORIGIN IS THE SAME REFUSAL. A page that fell back to
     "today" here would count from a clock nobody published. */
  eq(sessionsToEarnings("2026-09-04", null), null, "a missing origin returns null");
  eq(sessionsToEarnings("2026-09-04", "2026-9-4"), null, "as does a malformed one");
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

  /* MUTATION IS THE POINT, and this is the mutation that matters most: a tilt
     carrying an INVENTED iv30d_1w and no ivMomentum. A module that read
     tilt.iv30d_1w would pass every other assertion in this file against a
     fixture like this one and then return null at index 1 on EVERY LIVE ROW,
     because screenerTilt has never once published that field. */
  const invented = ivPathOf({ iv30: 0.4, iv30d_1w: 0.35, iv30d1d: 0.38, iv30d1m: 0.30 });
  eq(invented[1], null,
     "an invented iv30d_1w with no ivMomentum yields null at −1w — the field is not read");
  eq(invented[3], 0.4, "while the points that ARE on the wire still land");
  eq(invented[0], 0.30, "at both ends");

  /* BOTH HALVES ARE REQUIRED. Either one alone withholds the point. */
  eq(ivPathOf({ ivMomentum: 0.01 })[1], null, "ivMomentum with no iv30 withholds −1w");
  eq(ivPathOf({ iv30: 0.4 })[1], null, "and iv30 with no ivMomentum withholds it too");

  /* OVER THE EMITTED PAYLOAD: the reconstruction genuinely fires. A module
     reading the absent field would publish null here 60 times out of 60. */
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
   left to price, no volatility to scale, no date to count to.
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

  /* WHERE IT IS MEASURED it is sqrt-of-time and nothing else. horizonMove and
     TRADING_YEAR are IMPORTED rather than retyped: a hardcoded 252 here would
     let the two definitions drift apart silently. */
  const m = eventRow({ ticker: "E", close: "50", next_earnings_date: "2026-09-04" },
    tiltOf({ iv30: 0.4000 }), args);
  eq(m.sdte, 7, "seven sessions to the report");
  near(m.ev, Number(horizonMove(0.4, { sessions: 7 }).toFixed(4)),
     "and ev is horizonMove of the name's own iv over those sessions", 1e-12);
  near(m.ev, 0.4 * Math.sqrt(7 / TRADING_YEAR),
     "which is the annualised vol scaled by the square root of sessions over the trading year",
     5e-5);

  /* OVER THE EMITTED PAYLOAD, both directions. */
  ok(!ROWS.some((r) => r.ev === 0),
     "no emitted row publishes a priced move of exactly 0 — unmeasured is null here");
  const unmeasured = ROWS.filter((r) => r.ev === null);
  ok(unmeasured.length > 0, `${unmeasured.length} emitted rows withhold a priced move`);
  ok(unmeasured.every((r) => r.sdte === 0 || r.iv === null),
     "and every one of them is unmeasured for a stated reason: no sessions left, or no iv");
  ok(unmeasured.some((r) => r.sdte === 0) && unmeasured.some((r) => r.iv === null),
     "with both reasons present in the corpus, so neither branch is untested");
  const measured = ROWS.filter((r) => r.ev !== null);
  ok(measured.length > 0, `${measured.length} emitted rows price a move`);
  for (const r of measured) {
    /* Tolerance covers the payload's own 4-dp rounding on BOTH ev and iv. */
    assert.ok(Math.abs(r.ev - horizonMove(r.iv, { sessions: r.sdte })) <= 2e-4,
      `${r.t}: ev ${r.ev} is iv ${r.iv} scaled over ${r.sdte} sessions`);
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
  const evOrder = [...ROWS].sort((a, b) => (b.ev ?? -1) - (a.ev ?? -1)).map((r) => r.t);
  ok(JSON.stringify(ROWS.map((r) => r.t)) !== JSON.stringify(evOrder),
     "and the emitted order differs from the ev ranking, so the corpus can tell them apart");
  ok(ROWS.some((r, i) => i > 0 && ROWS[i - 1].d === r.d),
     "the corpus contains at least one date shared by two names, so the tie-break runs");
}

/* ============================================================
   §8. THE WINDOW AND THE CAP.
   ============================================================ */
{
  eq(PAYLOAD.shown, ROWS.length, "shown is the published row count, not an intention");
  ok(PAYLOAD.shown <= PAYLOAD.cap, `shown (${PAYLOAD.shown}) is within the cap (${PAYLOAD.cap})`);
  ok(PAYLOAD.shown <= PAYLOAD.inWindow,
     `and within the in-window population (${PAYLOAD.inWindow})`);
  ok(PAYLOAD.inWindow > PAYLOAD.cap,
     `the cap BITES in this corpus — ${PAYLOAD.inWindow} names qualify for ${PAYLOAD.cap} ` +
     `seats, so 'shown <= cap' is a test rather than a tautology`);
  ok(!ROWS.some((r) => r.sdte > PAYLOAD.windowDays),
     `no published row reports beyond the ${PAYLOAD.windowDays}-session window`);
  ok(!ROWS.some((r) => r.sdte === null || r.sdte < 0),
     "and none carries a null or negative session count");

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

  /* THE WINDOW IS IN SESSIONS, and it excludes rather than truncates. */
  const narrow = buildEvents([nameAt("NEAR", "2026-08-27"), nameAt("FAR", "2026-09-04")],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE, windowDays: 3 });
  deep(narrow.rows.map((r) => r.t), ["NEAR"], "a 3-session window drops a 7-session name");
  eq(narrow.inWindow, 1, "which is not in the window count either");
  eq(narrow.windowDays, 3, "and the window is published so the reader knows what was cut");
}

/* ============================================================
   §9 + §10. byStage, AND THE GATE BOUNDARY.

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

  const ORIGIN_MS = Date.parse(GATE_ORIGIN + "T00:00:00Z");
  const atGate = plusDays(GATE_ORIGIN, EARNINGS_GATE_DAYS);
  const pastGate = plusDays(GATE_ORIGIN, EARNINGS_GATE_DAYS + 1);

  const dGate = daysToEarnings({ next_earnings_date: atGate }, ORIGIN_MS);
  const dPast = daysToEarnings({ next_earnings_date: pastGate }, ORIGIN_MS);
  eq(dGate, EARNINGS_GATE_DAYS, `${atGate} is exactly EARNINGS_GATE_DAYS from the origin`);
  eq(dPast, EARNINGS_GATE_DAYS + 1, `and ${pastGate} is one day past it`);

  ok(isGated(dGate), "a name at exactly EARNINGS_GATE_DAYS is GATED — the boundary is inclusive");
  ok(!survivesGate(dGate), "and the pipeline's own gate removed it before scoring");
  ok(!isGated(dPast), "a name one day further out is NOT gated");
  ok(survivesGate(dPast), "and the gate let it through to be scored");
  ok(isGated(dGate) !== survivesGate(dGate) && isGated(dPast) !== survivesGate(dPast),
     "the two predicates are exact complements ON BOTH SIDES of the boundary — this is why " +
     "EARNINGS_GATE_DAYS was named, and a literal in either site would let them drift");
  eq(PAYLOAD.gateDays, EARNINGS_GATE_DAYS,
     "and the payload publishes that same constant, so the page labels against the gate that ran");

  /* THE TWO NAMES THROUGH THE PAGE, labelled by the pipeline's own predicate.
     They must land on OPPOSITE sides of byStage. */
  const stageOf = (t) => {
    const d = t === "GATED" ? atGate : pastGate;
    return isGated(daysToEarnings({ next_earnings_date: d }, ORIGIN_MS)) ? "gated" : "eligible";
  };
  const built = buildEvents([nameAt("GATED", atGate), nameAt("CLEAR", pastGate)],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE, stageOf });
  eq(built.byStage.gated, 1, "exactly one of the pair is labelled gated on the page");
  eq(built.byStage.eligible, 1, "and exactly one is not");
  eq(built.rows.find((r) => r.t === "GATED").st, "gated",
     "the name at the boundary is the gated one");
  eq(built.rows.find((r) => r.t === "CLEAR").st, "eligible",
     "and the name one day past it is the clear one");

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

  /* §10b. THE LABEL OVER THE EMITTED PAYLOAD, checked against the run's own
     INSTANT rather than gateOrigin's midnight.

     THIS SUITE DELIBERATELY DOES NOT ASSERT THE STRICTER FORM, and the reason
     is not a weakening. daysToEarnings() rounds against a wall-clock INSTANT;
     gateOrigin is a calendar DATE. At the real run time — about 05:15 Eastern,
     09:15 UTC — those two reckonings agree, which is why the module's header
     names gateOrigin as the day count's origin. A dry run executed at some
     other hour rounds the same span differently by one day, and asserting the
     midnight form here would fail for a reason that has nothing to do with the
     module. generatedAt IS the run's instant, so it reproduces the gate the
     pipeline actually applied, exactly, on every row. */
  const runInstant = Date.parse(PAYLOAD.generatedAt);
  ok(Number.isFinite(runInstant), "the payload stamps the run's own instant");
  for (const r of ROWS) {
    assert.equal(r.st === "gated", isGated(daysToEarnings({ next_earnings_date: r.d }, runInstant)),
      `${r.t} (${r.d}): the gated label reproduces the pipeline's own gate predicate`);
  }
  checks++;
  ok(ROWS.some((r) => r.st !== "gated"),
     "and the corpus contains ungated rows too, so the label is discriminating rather than " +
     "applied to everything that reaches this page");
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
  const rebuilt = eventRow(screener, tiltOf(), { gateOrigin: PAYLOAD.gateOrigin });
  eq(rebuilt.px, em.px,
     "the reconstructed screener row reproduces the emitted px exactly, field for field");

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
    const mutated = eventRow({ ...screener, close }, tiltOf(), { gateOrigin: PAYLOAD.gateOrigin });
    assert.equal(mutated.px, null, `px is null for ${why}`);
    assert.notEqual(mutated.px, 0,
      `and specifically not 0 for ${why} — a zero price is a quote, not a silence`);
    checks += 2;
  }
  /* The row survives the mutation: an unpriceable name is still on the
     calendar, because the date is what puts it there. */
  const stillThere = eventRow({ ...screener, close: null }, tiltOf(),
    { gateOrigin: PAYLOAD.gateOrigin });
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
  ok(/charging/i.test(EVENTS_NOTES.priced),
     "and says what it IS: what the option market is CHARGING for that stretch");
  ok(/square root of time/i.test(EVENTS_NOTES.priced),
     "naming the construction, so the number can be checked rather than trusted");
  ok(/no rate, no dividend/i.test(EVENTS_NOTES.priced),
     "and stating that no free parameter entered it");

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

console.log(`✓ flows-events: ${checks} assertions — a session count measured from the run's ` +
  `own Eastern date and never from the last completed session, with the wrong integer ` +
  `written down beside every right one, a weekend that is one session and not three, a past ` +
  `date that is null and not zero, a −1w point reconstructed from a difference because the ` +
  `wire has never carried the level, a priced move withheld for three separately named ` +
  `reasons and never published as 0, an undated name excluded and counted rather than seated ` +
  `at the end of a calendar, an order that is date-then-name over a corpus where the price ` +
  `ranking is its reverse, a gate boundary built by arithmetic from the constant both sites ` +
  `share, coverage counters that move by exactly the number withheld from them, a price that ` +
  `refuses a zero close in six shapes, an announce column withheld whole with its reason ` +
  `published, and the four sentences that keep the page from claiming a forecast`);
