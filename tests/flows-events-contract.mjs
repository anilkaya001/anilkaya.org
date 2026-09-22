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
import { EARNINGS_GATE_DAYS, daysToEarnings, screenerTilt, nextWeekday } from "../scripts/flows-pipeline.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, msg, tol = 1e-9) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b})`);
  checks++;
};

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

const plusDays = (origin, n) =>
  new Date(Date.parse(origin + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

const gateDteFrom = (origin) => (date) =>
  daysToEarnings({ next_earnings_date: date }, origin);

{
  ok(/^\d{4}-\d{2}-\d{2}$/.test(PAYLOAD.sessionDate),
     `sessionDate is published as an ISO date (${PAYLOAD.sessionDate})`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(PAYLOAD.gateOrigin),
     `gateOrigin is published as an ISO date (${PAYLOAD.gateOrigin})`);

  ok(PAYLOAD.gateOrigin > PAYLOAD.sessionDate,
     `the gate's origin (${PAYLOAD.gateOrigin}), the next session, is strictly later than the last ` +
     `completed session (${PAYLOAD.sessionDate}) — the corpus can tell the two clocks apart`);
  eq(PAYLOAD.gateOrigin, nextWeekday(PAYLOAD.sessionDate),
     "and it is the first weekday after the session, not the wall-clock date the run happened " +
     "to fire on — after the close that would be the session itself, a day early");
  eq(PAYLOAD.sessionDate, SESSION_DATE,
     "and the dry run's sessionDate is the anchor every hand count below is written against");
  eq(PAYLOAD.gateDays, EARNINGS_GATE_DAYS,
     "the payload republishes the gate width from the pipeline's own constant");
  eq(PAYLOAD.cap, EVENT_ROWS, "and the cap from the module's");
  eq(PAYLOAD.windowDays, EVENT_WINDOW_DAYS, "and the window from the module's");

  ok(ROWS.every((r) => Number.isInteger(r.dte)),
     `all ${ROWS.length} rows carry an integer dte — CALENDAR days, the gate's unit`);
  ok(ROWS.every((r) => Number.isInteger(r.sdte)),
     "and an integer sdte — trading SESSIONS, the priced move's unit");
  ok(ROWS.every((r) => r.dte >= 0 && r.sdte >= 0),
     "neither of them ever negative");
}

{

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

  const built = buildEvents([nameAt("CLK", "2026-08-31")],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
  eq(built.rows[0].sdte, 3, "buildEvents holds both clocks and still counts from gateOrigin");
  eq(built.rows[0].dte, 5, "on both horizons");
  eq(built.gateOrigin, GATE_ORIGIN, "publishing the origin it counted from");
  eq(built.sessionDate, SESSION_DATE, "beside the session every PRICE describes");

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

  const agrees = ROWS.filter((r) => sessionsToEarnings(r.d, PAYLOAD.gateOrigin) === r.sdte).length;
  eq(agrees, ROWS.length,
     `all ${ROWS.length} emitted rows reproduce their published sdte from gateOrigin`);
  const differs = ROWS.filter((r) => sessionsToEarnings(r.d, PAYLOAD.sessionDate) !== r.sdte).length;
  eq(differs, ROWS.length,
     `and all ${ROWS.length} of them DISAGREE with the sessionDate reckoning — the corpus ` +
     `separates the two clocks on every single row, so agreeing with one is evidence`);
}

{

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

  let swept = 0, held = 0;
  for (let i = 0; i < 400; i++) {
    const d = plusDays("2026-01-01", i);
    const s = sessionsToEarnings(d, "2026-01-01"), c = calendarDaysTo(d, "2026-01-01");
    swept++; if (s <= c) held++;
  }
  eq(held, swept,
     `over ${swept} spans from one origin the session count never exceeds the calendar ` +
     `count — the two functions are individually coherent`);

  eq(sessionsToEarnings("2026-08-26", "2026-08-26"), 0,
     "a name reporting on the origin itself is 0 sessions — a measurement");
  eq(calendarDaysTo("2026-08-26", "2026-08-26"), 0, "and 0 calendar days");
  eq(sessionsToEarnings("2026-08-29", "2026-08-28"), 0,
     "and Friday → Saturday is 0 sessions: a real count of the weekdays in between");
  eq(calendarDaysTo("2026-08-29", "2026-08-28"), 1,
     "though one calendar day — the two units genuinely disagree here, which is the point");
  ok(sessionsToEarnings("2026-08-26", "2026-08-26") !== null, "neither of which is null");

  eq(sessionsToEarnings("2026-08-24", "2026-08-26"), null,
     "a date already past returns null sessions — it is not this page's row");
  eq(calendarDaysTo("2026-08-24", "2026-08-26"), null,
     "and null calendar days, rather than the negative the subtraction would give");
  eq(calendarDaysTo("2026-08-25", "2026-08-26"), null, "including yesterday, one day back");
  ok(!ROWS.some((r) => r.sdte < 0 || r.dte < 0),
     "and no emitted row carries a negative count on either horizon");

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

{

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

  const invented = ivPathOf({ iv30: 0.4, iv30d_1w: 0.35, iv30d1d: 0.38, iv30d1m: 0.30 });
  eq(invented[1], null,
     "an invented iv30d_1w with no ivMomentum yields null at −1w — the field is not read");
  eq(invented[3], 0.4, "while the points that ARE on the wire still land");
  eq(invented[0], 0.30, "at both ends");

  eq(ivPathOf({ ivMomentum: 0.01 })[1], null, "ivMomentum with no iv30 withholds −1w");
  eq(ivPathOf({ iv30: 0.4 })[1], null, "and iv30 with no ivMomentum withholds it too");

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

  deep(ivPathOf({ iv30: 0.44, ivMomentum: 0.04, iv30d1m: 0.36 }), [0.36, 0.40, null, 0.44],
     "a missing −1d stays a hole at index 2 rather than sliding the strip");

  deep(PAYLOAD.ivPath.labels, [...IV_PATH_LABELS],
     "the payload publishes the module's own labels");
  eq(PAYLOAD.ivPath.labels.length, 4, "four of them");
  ok(ROWS.every((r) => Array.isArray(r.ivPath) && r.ivPath.length === PAYLOAD.ivPath.labels.length),
     "and every emitted row's path is the same length as the label list it is read against — " +
     "the labels are stated once in the header, so a length drift would mislabel every row");
}

{
  const args = { gateOrigin: GATE_ORIGIN };

  const today = eventRow({ ticker: "A", close: "50", next_earnings_date: GATE_ORIGIN }, tiltOf(), args);
  eq(today.sdte, 0, "a name reporting on the origin has zero sessions left");
  eq(today.ev, null, "so its priced move is null — there is no horizon to scale to");
  ok(today.ev !== 0, "and specifically not 0, which would read as 'the market charges nothing'");
  eq(today.iv, 0.3, "while its volatility is still published, because that IS measured");

  const noIv = eventRow({ ticker: "B", close: "50", next_earnings_date: "2026-09-04" },
    tiltOf({ iv30: null }), args);
  eq(noIv.sdte, 7, "Wed 26 → Fri Sep 4 is seven sessions");
  eq(noIv.ev, null, "with no iv30 there is nothing to scale, so ev is null");
  ok(noIv.ev !== 0, "not 0");
  eq(noIv.iv, null, "and the volatility column says so too");

  const noDate = eventRow({ ticker: "C", close: "50", next_earnings_date: null }, tiltOf(), args);
  eq(noDate.sdte, null, "no date, no session count");
  eq(noDate.ev, null, "and no priced move");
  const past = eventRow({ ticker: "D", close: "50", next_earnings_date: "2026-08-20" }, tiltOf(), args);
  eq(past.sdte, null, "a date already past is null too");
  eq(past.ev, null, "and prices nothing");

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

    assert.ok(Math.abs(r.ev - horizonMove(r.iv, { sessions: r.sdte })) <= 2e-4,
      `${r.t}: ev ${r.ev} is iv ${r.iv} scaled over ${r.sdte} SESSIONS, not ${r.dte} days`);
  }
  checks++;
  ok(measured.every((r) => r.ev > 0 && r.sdte > 0 && r.iv > 0),
     "and every priced row has a positive vol, a positive horizon and a positive price");
}

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

{

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

{
  eq(PAYLOAD.shown, ROWS.length, "shown is the published row count, not an intention");
  ok(PAYLOAD.shown <= PAYLOAD.cap, `shown (${PAYLOAD.shown}) is within the cap (${PAYLOAD.cap})`);
  ok(PAYLOAD.shown <= PAYLOAD.inWindow,
     `and within the in-window population (${PAYLOAD.inWindow})`);

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

  const far = buildEvents([
    nameAt("D4", "2026-09-04"), nameAt("D1", "2026-08-27"),
    nameAt("D3", "2026-09-02"), nameAt("D2", "2026-08-31"),
  ], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE, cap: 2 });
  deep(far.rows.map((r) => r.t), ["D1", "D2"],
     "the cap keeps the two NEAREST reports, in date order, whatever order they arrived in");
  eq(far.shown, 2, "shown is the capped count");
  eq(far.inWindow, 4, "while inWindow is the uncapped population — the two are different facts");

  eq(far.capBound, true, "a cap that bound says so");
  eq(far.beyondCap, 2, "and counts the named rows inside the window it does not show");
  eq(far.lastShownDate, "2026-08-31",
     "and names the date the drawing stops at — which is NOT the window's edge, and is " +
     "the distinction the note used to get wrong");
  ok(far.lastShownDate < far.rows[0].d ? false : true,
     "lastShownDate is the newest drawn date, so it is at or after the first row's");

  const roomy = buildEvents([
    nameAt("D4", "2026-09-04"), nameAt("D1", "2026-08-27"),
  ], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE, cap: 10 });
  eq(roomy.capBound, false, "a cap with room to spare says that instead");
  eq(roomy.beyondCap, 0, "with nothing held back");
  eq(roomy.lastShownDate, "2026-09-04", "and the drawing reaches the farthest name it has");

  const none = buildEvents([], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
  eq(none.lastShownDate, null, "an empty table names no last date rather than inventing one");
  eq(none.capBound, false, "and a cap cannot bind on nothing");
}

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

{

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

  const built = buildEvents([nameAt("GATED", atGate), nameAt("CLEAR", pastGate)], {
    gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE,

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

  for (const r of ROWS) {
    assert.equal(r.dte, daysToEarnings({ next_earnings_date: r.d }, PAYLOAD.gateOrigin),
      `${r.t} (${r.d}): dte is the gate's own count, reproduced from the published gateOrigin`);
  }
  checks++;

  const local = eventRow(nameAt("PT", "2026-08-31").row, tiltOf(), { gateOrigin: GATE_ORIGIN });
  eq(local.dte, 5, "the module counts calendar days from gateOrigin itself");
  eq(local.dte, daysToEarnings({ next_earnings_date: "2026-08-31" }, GATE_ORIGIN),
     "and lands on exactly what the gate's own function returns for the same span — one " +
     "computation, not two that happen to agree");
  eq(eventRow({ ticker: "PT" }, tiltOf(), { gateOrigin: GATE_ORIGIN }).dte, null,
     "and a name with no date has no horizon, whatever any caller might wish to supply");

}

{
  const TEN = Array.from({ length: 10 }, (_, i) =>
    nameAt("N" + String(i).padStart(2, "0"), "2026-09-02"));
  const opts = { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE };

  const all = buildEvents(TEN, { ...opts, featuresOf: () => ({ rv30: 0.22 }) });
  eq(all.shown, 10, "ten names published");
  eq(all.rvMeasured, 10, "and ten realized-vol readings when every name carries one");

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

  const capped = buildEvents(TEN, {
    ...opts, cap: 5, featuresOf: (t) => (WITHHELD.has(t) ? null : { rv30: 0.22 }),
  });
  eq(capped.shown, 5, "five seats");
  eq(capped.inWindow, 10, "of ten qualifying names");
  eq(capped.rvMeasured, capped.rows.filter((r) => r.rv !== null).length,
     "and rvMeasured counts the PUBLISHED rows that carry one, not the qualifying ones");
  eq(capped.rvMeasured, 3, "which here is three of the five shown");

  const noVol = buildEvents(
    TEN.map((n, i) => (i < 3 ? { ...n, tilt: tiltOf({ iv30: null }) } : n)), opts);
  eq(noVol.shown, 10, "ten names again");
  eq(noVol.evMeasured, 7, "and seven priced moves — the three without an iv30 are not counted");
  eq(buildEvents(TEN, opts).evMeasured - noVol.evMeasured, 3,
     "the counter moved by exactly the three that lost their volatility");

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

{

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

  const stillThere = eventRow({ ...screener, close: null }, tiltOf(),
    { gateOrigin: PAYLOAD.gateOrigin, gateDte: em.dte });
  eq(stillThere.d, em.d, "a name with no close still carries its report date");
  eq(stillThere.t, em.t, "and its ticker");
  ok(!ROWS.some((r) => r.px === 0), "and no emitted row publishes a price of exactly 0");
}

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

{
  deep(PAYLOAD.notes, { ...EVENTS_NOTES },
     "the payload publishes the module's notes verbatim, not a paraphrase of them");

  ok(/not a forecast/i.test(EVENTS_NOTES.priced),
     "notes.priced states in words that the priced move is NOT A FORECAST");

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

  ok(/two clocks/i.test(EVENTS_NOTES.clocks), "notes.clocks says there are two clocks");
  ok(/do not share an origin/i.test(EVENTS_NOTES.clocks), "and that they do not share an origin");
  ok(/last completed session/i.test(EVENTS_NOTES.clocks),
     "it names the first origin — the last completed session, which every PRICE describes");
  ok(/next session after it/i.test(EVENTS_NOTES.clocks) && !/05:15/.test(EVENTS_NOTES.clocks),
     "and the second — the next session after it, which every DAY COUNT uses, and not the " +
     "run's own wall-clock date, which after the close is the session itself");
  ok(/gate/i.test(EVENTS_NOTES.clocks),
     "tying the second to the gate that actually ran, which is why it is the one that counts");

  ok(/weekdays/i.test(EVENTS_NOTES.sessions), "notes.sessions states that sessions are weekdays");
  ok(/holidays are not removed/i.test(EVENTS_NOTES.sessions),
     "and ADMITS that market holidays are not removed — the count is approximate and says so");
  ok(/no holiday calendar/i.test(EVENTS_NOTES.sessions),
     "giving the reason: this desk holds no holiday calendar and inventing one is a free parameter");

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

{

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

  const drifted = ROWS.filter(
    (r) => r.dte !== daysToEarnings({ next_earnings_date: r.d }, PAYLOAD.gateOrigin));
  eq(drifted.length, 0,
     "every published dte is reproducible from the gateOrigin the payload states — the page " +
     "does not hold a second opinion about the gate's own count, and a reader can check it");

  const undated = buildEvents([{ row: { ticker: "NODATE" }, tilt: {} }],
    { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE });
  eq(undated.inWindow, 0, "a name with no earnings date is not admitted to the calendar");
  eq(undated.rows.length, 0, "and appears in no row");
  eq(undated.undated, 1, "and is counted as undated, once");
  const nd = eventRow({ ticker: "NODATE" }, {}, { gateOrigin: GATE_ORIGIN });
  eq(nd.dte, null, "its calendar horizon is null");
  eq(nd.sdte, null, "and so is its session horizon — both are null together, always");
}

{

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

          headers: { get: () => String(Date.now()) },
          json: () => Promise.resolve(JSON.parse(JSON.stringify(pl))),
        });
      }, payload);
      await page.goto("https://x.test/flows/events/", { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ path: path.join(ROOT, "assets/js/flows-events.js") });

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

    const capped = buildEvents([
      nameAt("D4", "2026-09-04"), nameAt("D1", "2026-08-27"),
      nameAt("D3", "2026-09-02"), nameAt("D2", "2026-08-31"),
    ], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE, cap: 2 });
    eq(capped.shown, 2, "the fixture draws two rows");
    eq(capped.inWindow, 4,
       "out of a population of four — the two integers the badge has to tell apart");

    const cap = await render(capped);
    deep(cap.errors, [], `the calendar renders without throwing (${cap.errors[0] || "clean"})`);

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

    ok(/2 of 4 names reporting inside the/.test(cap.status),
       `the sentence beside it names the same four (${cap.status.slice(0, 60)}…)`);
    ok(/the cap holds the list to 2/.test(cap.status),
       "and says out loud that the two on the page are a choice this page made");

    const withheld = { ...capped };
    delete withheld.inWindow;
    const held = await render(withheld);
    eq(held.rows, 2, "a payload with no population still draws its rows");
    eq(held.text, "", "but the badge is left empty rather than filled from them");
    eq(held.hidden, true, "and stays hidden, which is the page declining to answer");

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

{
  const HTML = eventsPage({ username: "test" }).replace(/<script[^>]*><\/script>/g, "");
  const BUILT_AT = "2026-09-05T01:28:48.123Z";

  const STAGES = {
    LONG: "board:long", SHORT: "board:short", GATE: "gated",
    OPEN: "eligible", ZERO: "eligible", NOIV: "eligible", NOEV: "eligible",
  };
  const CAL = buildEvents([
    nameAt("LONG", plusDays(GATE_ORIGIN, 14)),
    nameAt("SHORT", plusDays(GATE_ORIGIN, 14)),
    nameAt("GATE", plusDays(GATE_ORIGIN, 3)),
    nameAt("OPEN", plusDays(GATE_ORIGIN, 17)),

    nameAt("ZERO", plusDays(GATE_ORIGIN, 0)),

    nameAt("NOIV", plusDays(GATE_ORIGIN, 10), { iv30: null }),
    nameAt("NOEV", plusDays(GATE_ORIGIN, 12)),
  ], {
    gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE,
    stageOf: (t) => STAGES[t] || "screened",
  });
  CAL.generatedAt = BUILT_AT;

  const byT = (t) => CAL.rows.find((r) => r.t === t);
  eq(byT("ZERO").sdte, 0, "the fixture has a name with zero sessions left to price");
  eq(byT("ZERO").ev, null, "and so no priced move — a horizon of nothing, not a zero move");
  eq(byT("NOIV").iv, null, "a second name carries no 30-day implied volatility");
  eq(byT("NOIV").ev, null, "and so no priced move either — a different absence, same blank");

  ok(byT("NOEV").ev !== null && byT("NOEV").iv !== null && byT("NOEV").sdte > 0,
     "the third row publishes both inputs and a priced move before the mutation");
  byT("NOEV").ev = null;

  const browser = await chromium.launch();
  try {

    const render = async (payload, opts = {}) => {
      const page = await browser.newPage({
        viewport: { width: opts.width || 1280, height: 900 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) =>
        route.fulfill({ contentType: "text/html", body: HTML }));
      await page.addInitScript(([pl, mode, updatedAt]) => {
        window.fetch = () => {
          if (mode === "http") {
            return Promise.resolve({
              ok: false, status: 503,
              headers: { get: () => null },
              json: () => Promise.resolve({}),
            });
          }
          return Promise.resolve({
            ok: true, status: 200,
            headers: { get: () => String(updatedAt) },
            json: () => (mode === "parse"
              ? Promise.reject(new SyntaxError("Unexpected end of JSON input"))
              : Promise.resolve(JSON.parse(JSON.stringify(pl)))),
          });
        };
      }, [payload, opts.mode || "", opts.updatedAt || Date.now()]);
      await page.goto("https://x.test/flows/events/", { waitUntil: "domcontentloaded" });

      if (opts.css) {
        for (const sheet of ["assets/css/base.css", "assets/css/flows.css"]) {
          await page.addStyleTag({ path: path.join(ROOT, sheet) });
        }
      }
      await page.addScriptTag({ path: path.join(ROOT, "assets/js/flows-events.js") });
      await page.waitForFunction(
        () => !/^Loading/.test(document.getElementById("evStatus").textContent),
        null, { timeout: 15000 });
      const read = await page.evaluate(() => {
        const mark = (n) => (n ? { text: n.textContent.trim(), kind: n.dataset.empty || null } : null);

        const drawn = (n) => {
          if (!n) return null;
          const cs = getComputedStyle(n), before = getComputedStyle(n, "::before");
          return {
            style: cs.borderLeftStyle, width: cs.borderLeftWidth,
            glyph: before.content, colour: cs.borderLeftColor,
          };
        };
        const svg = document.querySelector("#evWindow svg.ew");
        const priced = {};
        for (const tr of document.querySelectorAll("#evBody tr")) {
          const th = tr.querySelector("th"), td = tr.querySelector("td.ev-priced");
          if (th && td) priced[th.textContent.trim()] = { text: td.textContent.trim(), cls: td.className };
        }
        const marks = {};
        for (const m of document.querySelectorAll("path.ew-m")) {
          const c = m.getAttribute("class");
          marks[/is-long/.test(c) ? "long" : /is-short/.test(c) ? "short" : "board"] =
            m.getAttribute("d");
        }
        const stale = document.getElementById("evStale");
        return {
          status: mark(document.getElementById("evStatus")),
          window: mark(document.querySelector("#evWindow p.flows-empty")),
          body: mark(document.querySelector("#evBody td.flows-empty")),

          basis: mark(document.querySelector("#evBasis > p")),
          statusDrawn: drawn(document.getElementById("evStatus")),
          windowDrawn: drawn(document.querySelector("#evWindow p.flows-empty")),
          basisHidden: document.getElementById("evBasisPanel").hidden,
          stale: { hidden: stale.hidden, text: stale.textContent },
          foot: document.getElementById("evFoot").textContent,
          hostW: document.getElementById("evWindow").clientWidth,

          hostBox: document.getElementById("evWindow").getBoundingClientRect().width,
          vb: svg ? svg.viewBox.baseVal.width : null,

          rectW: svg ? svg.getBoundingClientRect().width : null,
          widthAttr: svg ? svg.getAttribute("width") : null,
          lanes: [...document.querySelectorAll("text.ew-lane")].map((t) => t.textContent),
          rows: document.querySelectorAll("#evBody tr").length,
          priced, marks,
        };
      });
      await page.close();
      return { ...read, errors };
    };

    for (const width of [2560, 1440, 390, 320]) {
      const r = await render(CAL, { width, css: true });
      deep(r.errors, [], `[${width}] the calendar renders without throwing`);
      eq(r.vb, r.rectW,
         `[${width}] one viewBox unit is one CSS pixel: viewBox ${r.vb} units drawn in ` +
         `${r.rectW}px. A stretched viewBox scales every 9.5px label with it, and the ` +
         `chart goes on looking exactly like a chart`);
      ok(r.vb <= r.hostBox && r.hostBox - r.vb < 1,
         `[${width}] and the drawing fills its host without exceeding it: ${r.vb} units ` +
         `in a ${r.hostBox}px box. A drawing WIDER than its box is squeezed back by ` +
         `max-width; one NARROWER by a pixel or more is a clamp that binds. Both are ` +
         `the wrong drawing, in opposite directions`);
      ok(r.widthAttr !== "100%",
         `[${width}] and the width is a pixel count (${r.widthAttr}), never a per cent: ` +
         `"100%" hands the browser permission to scale the number above`);
    }
    const wide = await render(CAL, { width: 2560, css: true });
    ok(wide.hostW > 1900,
       `the 2560 host is ${wide.hostW}px — wider than the 1900 the clamp used to stop ` +
       `at, which is what made this the width the defect was measured at`);

    ok(wide.marks.long && wide.marks.short,
       "the board lane draws both a long and a short mark");

    eq(wide.marks.long.split("L").length, 3,
       `the long mark is a three-vertex triangle (${wide.marks.long}), not the ` +
       `four-vertex diamond both sides used to share — a mark that differs by hue alone ` +
       `is one mark in greyscale, and the side the board took is the one fact this lane ` +
       `exists to carry`);
    eq(wide.marks.short.split("L").length, 3,
       `and the short mark is the other one (${wide.marks.short})`);
    const apexY = (d) => Number(d.match(/^M[\d.]+ ([\d.]+)/)[1]);
    const baseY = (d) => Number(d.match(/L[\d.]+ ([\d.]+)Z$/)[1]);
    ok(apexY(wide.marks.long) < baseY(wide.marks.long),
       "the long mark's apex is above its base (▲)");
    ok(apexY(wide.marks.short) > baseY(wide.marks.short),
       "and the short mark's apex is below its base (▼) — the same direction the table's " +
       "chip prints with ↑ and ↓, so the two surfaces agree");

    for (const label of wide.lanes) {
      ok(/ \d+ \/ 7$/.test(label),
         `the lane label states its denominator: "${label}". A bare "GATED · 57" is a ` +
         `count whose population sits 260px above it in the status strip`);
    }
    eq(wide.lanes.length, 3, "and there are three of them, one per lane");

    eq(wide.priced.ZERO.text, "0s",
       "a name with no sessions left prints 0s — a measured horizon of zero SESSIONS, " +
       "with its unit attached so it can never be read as a zero move");
    ok(/is-zero-horizon/.test(wide.priced.ZERO.cls),
       "and is classed for it, so the stylesheet can hold it at the ink of a withholding");
    eq(wide.priced.NOIV.text, "†",
       "a name with no implied volatility prints the dagger — published, and this field " +
       "is not on it, which is the mark this stylesheet already spends on that silence");
    ok(/is-unavailable/.test(wide.priced.NOIV.cls), "and is classed for it");
    eq(wide.priced.NOEV.text, "—",
       "and a row that published neither keeps the em dash, which now means one thing");
    ok(/is-none/.test(wide.priced.NOEV.cls), "and is classed for it");
    eq(new Set([wide.priced.ZERO.text, wide.priced.NOIV.text, wide.priced.NOEV.text]).size, 3,
       "three absences, three glyphs: the distinction the module makes and the file " +
       "argues at length is now on the page and not only in a hover title");
    eq(wide.priced.LONG.text, "5.98%",
       "and a row that has a priced move still prints it, in per cent");


    ok(/Built 2026-09-05 01:28 UTC/.test(wide.foot),
       `the built instant is ISO and names its zone: "${wide.foot}". toLocaleString ` +
       `printed "9/5/2026, 1:28:48 AM" under a table of ISO report dates and beside two ` +
       `ISO clocks — three notations for one kind of quantity on one screen, and the ` +
       `only one of the three whose month and day a reader outside the US would swap`);
    ok(!/\d+\/\d+\/\d{4}/.test(wide.foot),
       "and no slashed locale date survives anywhere in it");

    const pending = await render({ status: "pending" }, { css: true });
    const quiet = await render(
      buildEvents([], { gateOrigin: GATE_ORIGIN, sessionDate: SESSION_DATE }), { css: true });
    const unreadable = await render(CAL, { mode: "parse", css: true });
    const failed = await render(CAL, { mode: "http", css: true });

    const kinds = {
      pending: pending.window.kind, quiet: quiet.window.kind,
      unreadable: unreadable.window.kind, failed: failed.window.kind,
    };
    deep(kinds, { pending: "pending", quiet: "quiet", unreadable: "unreadable", failed: "failed" },
         `each silence names itself on data-empty (${JSON.stringify(kinds)}), so ` +
         `flows.css's dotted / hairline / × vocabulary fires and a reader can see which ` +
         `of the four they are in without reading the paragraph`);
    for (const [name, r] of [["pending", pending], ["quiet", quiet],
                             ["unreadable", unreadable], ["failed", failed]]) {
      eq(r.status.kind, kinds[name],
         `[${name}] the status strip carries the same kind as the region below it`);
      eq(r.body.kind, kinds[name],
         `[${name}] and so does the row that stands in for the table`);
    }
    eq(new Set(Object.values(kinds)).size, 4,
       "four states, four kinds — not one hairline for all of them");

    const strip = (r) =>
      `${r.statusDrawn.style} ${r.statusDrawn.width} ${r.statusDrawn.glyph}`;
    const region = (r) =>
      `${r.windowDrawn.style} ${r.windowDrawn.width} ${r.windowDrawn.glyph}`;
    for (const [name, r] of [["pending", pending], ["quiet", quiet],
                             ["unreadable", unreadable], ["failed", failed]]) {
      eq(strip(r), region(r),
         `[${name}] the strip and the region under it draw ONE mark (strip ${strip(r)}, ` +
         `region ${region(r)}) — a page whose two surfaces disagree about which silence ` +
         `it is in has told the reader nothing`);
    }
    eq(strip(failed), strip(unreadable),
       `a request that never came back wears the broken mark on the strip, the same one ` +
       `the parse failure wears (${strip(failed)} vs ${strip(unreadable)}): the two share ` +
       `a remedy, and neither is the quiet hairline`);
    ok(/×/.test(failed.statusDrawn.glyph),
       `and it carries the × (${failed.statusDrawn.glyph}) rather than the base rule's ` +
       `content: none — a bar with no glyph is a mark that says only "something"`);
    eq(failed.statusDrawn.width, "3px",
       `at the 3px this stylesheet spends on the one silence that is THIS PAGE'S fault ` +
       `(${failed.statusDrawn.width}), not the base rule's 2px`);
    const stripMarks = new Set([strip(pending), strip(quiet),
                                strip(unreadable), strip(failed)]);
    eq(stripMarks.size, 3,
       `and the four states resolve to three marks on the strip (${[...stripMarks].join("; ")}) ` +
       `— unreadable and failed are one silence and share one, pending and quiet keep ` +
       `their own, and nothing falls through to the unmarked base rule`);
    eq(new Set([pending.window.text, quiet.window.text,
                unreadable.window.text, failed.window.text]).size, 4,
       "and four different sentences under them");

    ok(/does not parse/.test(unreadable.window.text),
       `the unreadable state says the bytes do not parse: "${unreadable.window.text}"`);
    ok(!/[Rr]efresh/.test(unreadable.window.text),
       "and offers no refresh, because the bytes are in the store and a refresh fetches " +
       "the same ones — the remedy that exists is the next run, and it says so");
    ok(/Unexpected end of JSON input/.test(unreadable.window.text),
       "the parser's own words are still carried, for whoever has to fix the publish");
    ok(/Refresh to try again/.test(failed.window.text),
       `a request that never landed DOES keep the refresh: "${failed.window.text}"`);
    ok(/HTTP 503/.test(failed.window.text),
       "with the status the transport actually returned");
    ok(/did not parse/.test(unreadable.basis.text) && /could not be fetched/.test(failed.basis.text),
       "and the basis panel fails the same way the numbers did, in the same words");

    eq(pending.basisHidden, true,
       "a pending key leaves the basis panel hidden rather than describing the absence " +
       "of a run as a published payload with a hole in it");
    ok(/has not published this key yet/.test(pending.window.text),
       "and says what is actually true: the run has not happened");
    eq(quiet.basisHidden, false,
       "while a quiet payload — published, measured, empty — still explains itself");

    const noNotes = { ...CAL };
    delete noNotes.notes;
    const bare = await render(noNotes);
    eq(bare.basis.kind, "unavailable",
       "a payload that arrived and parsed without a notes block is the unavailable " +
       "silence — published, and this field is not on it — and wears the dagger");
    ok(!/unexplained/.test(bare.basis.text),
       `and no longer calls the readings above it unexplained (${bare.basis.text.slice(0, 48)}…): ` +
       `they were measured, and it is the method behind them that is missing`);

    const HOUR = 3600000;
    const old3 = await render(CAL, { updatedAt: Date.now() - 72 * HOUR });
    eq(old3.stale.hidden, false, "a calendar written three days ago raises the banner");
    ok(/last written 3 days ago/.test(old3.stale.text),
       `the banner counts in whole days: "${old3.stale.text.slice(0, 44)}…"`);
    ok(/3 days ago — these counts are that run's, not today's/.test(old3.status.text),
       `and the status strip carries the qualifier ON the day counts it qualifies ` +
       `("${old3.status.text.slice(-90)}"): the banner said every count below was that ` +
       `run's, and the sentence immediately under it then stated them flat`);

    const old1 = await render(CAL, { updatedAt: Date.now() - 34 * HOUR });
    ok(/last written 1 day ago/.test(old1.stale.text),
       `one day is "1 day", not "1 day(s)": "${old1.stale.text.slice(0, 40)}…" — this ` +
       `file has had plural() since it was written and every other count on the page ` +
       `uses it`);
    ok(!/day\(s\)/.test(old1.stale.text + old1.status.text),
       "and no parenthesised plural is left anywhere in the pair");
    eq(wide.stale.hidden, true,
       "while a fresh payload raises no banner and adds no qualifier");
    ok(!/that run's, not today's/.test(wide.status.text),
       "so the strip states its day counts flat only when they ARE today's");
  } finally {
    await browser.close();
  }
}

console.log(`✓ flows-events: ${checks} assertions — a session count measured from the ` +
  `next session and never from the last completed session, with the wrong integer ` +
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
  `population was published, and prints a measured zero — and, drawn at three widths, ` +
  `one viewBox unit that is one CSS pixel at every one of them, a board lane whose two ` +
  `sides are two shapes rather than two fills, lane counts that carry their ` +
  `denominator, three absences in the Priced column wearing three glyphs instead of one ` +
  `em dash and three hover titles, an ISO instant in the footer, and four silences that ` +
  `name themselves apart — on the attribute AND on the computed border and glyph a reader ` +
  `actually meets, since a fetch that never came back was falling through the status ` +
  `strip's rules to an unmarked 2px hairline while the region under it drew the × — the ` +
  `published-but-unparseable one no longer offering a ` +
  `refresh that would read the same broken bytes back, and the pending one no longer ` +
  `describing an empty store as a published payload missing its notes`);
