import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "../shared/flows-calendar.js";
import * as H from "../shared/flows-horizon.js";
import { nyseEarlyCloses, nyseHolidays, sessionsBetween as quantBetween } from "../shared/flows-quant-time.js";
import { sessionsBetween as crossBetween } from "../shared/flows-cross.js";
import { easternDay } from "../shared/flows-freshness.js";
import { impactSession as leafImpact } from "../shared/flows-targets.js";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures-calendar.json"), "utf8"));
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const allDays = [];
for (let ms = Date.parse(C.CALENDAR_FIRST + "T00:00:00Z"); ms <= Date.parse(C.CALENDAR_LAST + "T00:00:00Z"); ms += 86400000) allDays.push(day(ms));

{
  const p = FIX.provenance;
  deep([p.calendar, p.generator], ["XNYS", "tests/gen-calendar-fixtures.py"], "the oracle names its calendar and its generator");
  ok(/^\d+\.\d+/.test(p.exchange_calendars) && p.script_sha256.length === 64, "and records the package version and the generator's own sha256");
  ok(p.first <= C.CALENDAR_FIRST && p.last >= C.CALENDAR_LAST, `the fixture covers the whole table, ${p.first} to ${p.last}, so a table that outgrows its oracle fails here`);
  const gen = fs.readFileSync(path.join(HERE, "gen-calendar-fixtures.py"), "utf8");
  eq(createHash("sha256").update(gen).digest("hex"), p.script_sha256, "the committed fixture is the output of the committed generator");
  ok(/start="2019-06-01", end="2028-12-31"/.test(gen), "the generator passes both bounds to exchange_calendars, whose default end is about a year ahead and would cut 2027 short without a word");
  eq(createHash("sha256").update(C.SESSION_DAYS.join("\n")).digest("hex"), p.sessionsSha256, `the module's ${C.SESSION_DAYS.length} sessions hash to the exchange calendar's list`);
  eq(C.SESSION_DAYS.length, p.sessions, "same count");
}

{
  const holidays = new Set(FIX.holidays);
  let weekdays = 0;
  for (const d of allDays) {
    const w = new Date(d + "T00:00:00Z").getUTCDay();
    const weekend = w === 0 || w === 6;
    if (!weekend) weekdays++;
    eq(C.isSession(d), !weekend && !holidays.has(d), `${d} is a session exactly when it is a weekday the exchange did not close`);
  }
  eq(weekdays - holidays.size, C.SESSION_DAYS.length, "weekdays less exchange holidays is the session count");
  for (let y = 2020; y <= 2027; y++) {
    const mine = [...nyseEarlyCloses(y)].sort();
    const theirs = FIX.earlyCloses.filter((e) => e.d.startsWith(String(y))).map((e) => e.d).sort();
    deep(mine, theirs, `the early closes of ${y} are the exchange's: ${theirs.join(", ")}`);
    const rule = [...nyseHolidays(y)].filter((d) => new Date(d + "T00:00:00Z").getUTCDay() % 6 !== 0).sort();
    deep(rule, FIX.holidays.filter((d) => d.startsWith(String(y))), `the weekday holidays of ${y} are the exchange's`);
  }
  for (const e of FIX.earlyCloses) eq(e.close, "13:00", `${e.d} closes at 13:00 New York time`);
  eq(C.isSession("2027-06-18"), false, "Juneteenth 2027 falls on a Saturday and is observed on Friday 18 June, which is closed");
  eq(C.isSession("2026-04-03"), false, "Good Friday 2026 is closed");
  eq(C.isSession("2026-11-27"), true, "the day after Thanksgiving is a session, an early close");
  eq(C.isSession("2019-12-31"), null, "a day before the table is not guessed at");
  eq(C.isSession("2028-01-03"), null, "nor one after it");
}

{
  for (const r of FIX.distance) eq(C.sessionsBetween(r.from, r.to), r.n, `sessionsBetween(${r.from}, ${r.to}) is ${r.n}, the exchange calendar's count`);
  for (const r of FIX.offset.filter((x) => x.n < 0 && x.to >= C.CALENDAR_FIRST)) eq(C.sessionsBetween(r.to, r.day), -r.n, `${-r.n} sessions before ${r.day} is ${r.to}`);
  for (const r of FIX.offset.filter((x) => x.n > 0 && x.to <= C.CALENDAR_LAST)) eq(C.addSessions(r.day, r.n), r.to, `${r.n} sessions after ${r.day} is ${r.to}`);
  for (const r of FIX.offset.filter((x) => x.n > 0 && x.to > C.CALENDAR_LAST)) eq(C.addSessions(r.day, r.n), null, `${r.n} sessions after ${r.day} is past the table and is null, not a guess`);
  for (const r of FIX.index) eq(C.sessionIndex(r.day), r.index, `the index of ${r.day} is ${r.index}`);
  eq(C.sessionIndex("2026-04-03"), null, "a closed day has no index");
  eq(C.sessionsBetween("2026-04-06", "2026-04-02"), -1, "the count is signed");
  eq(C.sessionsBetween("2026-04-02", "2026-04-02"), 0, "and zero for one day");
  eq(C.sessionsBetween("2026-04-02", "2026-04-04"), 0, "a closed day adds nothing");
  eq(C.sessionsBetween("nope", "2026-04-04"), null, "an invalid day is null");
  eq(C.sessionsBetween("2019-01-03", "2026-04-04"), null, "and so is one outside the table");
  for (const d of C.SESSION_DAYS) {
    for (const n of [1, 2, 5, 21, 30]) {
      const to = C.addSessions(d, n);
      if (to === null) { ok(C.SESSION_DAYS.indexOf(d) + n >= C.SESSION_DAYS.length, `${d} + ${n} is null only past the table`); continue; }
      eq(C.sessionsBetween(d, to), n, `sessionsBetween(${d}, addSessions(${d}, ${n})) is ${n}`);
    }
  }
  eq(C.addSessions("2026-04-03", 1), "2026-04-06", "from a closed day the next session is the first one after it");
  eq(C.addSessions("2026-04-03", 0), null, "zero from a closed day is not a session");
  eq(C.addSessions("2026-04-02", -1), "2026-04-01", "one session back from a session");
  eq(C.addSessions("2026-04-06", -1), "2026-04-02", "and over Good Friday");
  eq(C.addSessions("2026-04-04", -1), "2026-04-02", "and from a closed Saturday the first session before it is the Thursday");
  eq(C.addSessions("2026-04-04", -2), "2026-04-01", "the second before it the Wednesday");
  eq(C.addSessions("2026-04-04", 0), null, "zero from a closed day is not a session");
  for (const d of C.SESSION_DAYS.slice(40)) {
    for (const n of [1, 3, 21]) {
      const back = C.addSessions(d, -n);
      eq(C.sessionsBetween(back, d), n, `${n} sessions before ${d} is ${n} sessions from it`);
    }
  }
  eq(C.previousSession("2026-04-06"), "2026-04-02", "the session before the Monday after Good Friday is the Thursday");
  eq(C.previousSession("2026-04-04"), "2026-04-02", "and before the Saturday as well");
  eq(C.previousSession("2020-01-02"), null, "nothing before the table");
  eq(C.nextSession("2026-11-25"), "2026-11-27", "the session after the day before Thanksgiving skips the holiday");
}

{
  let pairs = 0;
  for (let i = 0; i < allDays.length; i += 3) {
    const a = allDays[i];
    for (let k = 0; k <= 45; k += 1) {
      const b = allDays[i + k];
      if (!b) break;
      const mine = C.sessionsBetween(a, b);
      if (crossBetween(a, b) !== mine) assert.fail(`flows-cross disagrees on ${a} to ${b}: ${crossBetween(a, b)} against ${mine}`);
      if (k > 0 && quantBetween(a, b) !== mine) assert.fail(`flows-quant-time disagrees on ${a} to ${b}: ${quantBetween(a, b)} against ${mine}`);
      pairs++;
    }
  }
  ok(pairs > 15000, `${pairs} day pairs: the three session counters in the tree give one answer wherever they are all defined`);
  eq(crossBetween("2026-04-06", "2026-04-02"), null, "flows-cross keeps its null for a backwards pair, which is why it is not the calendar");
  eq(quantBetween("2026-04-06", "2026-04-02"), 0, "and flows-quant-time keeps its zero");
}

{
  const imp = (d, t) => C.impactSession(d, t);
  for (const r of FIX.impact) {
    const pre = imp(r.date, "premarket");
    const post = imp(r.date, "postmarket");
    const unk = imp(r.date, "unknown");
    eq(pre.day, r["before-open"], `${r.date} before the open lands on ${r["before-open"]}`);
    eq(post.day, r["after-close"], `${r.date} after the close lands on ${r["after-close"]}`);
    deep([unk.early, unk.late], [r.unknown[0], r.unknown[r.unknown.length - 1]], `${r.date} with no stated time is the interval ${r.unknown.join(" to ")}`);
    eq(unk.certain, r.unknown.length === 1, "and certain only when one session is possible");
    eq(imp(r.date, "bmo").day, pre.day, "bmo is a premarket report");
    eq(imp(r.date, "amc").day, post.day, "amc is an after-close report");
    eq(imp(r.date, null).certain, r.unknown.length === 1, "a missing time is unknown");
    eq(imp(r.date, "intraday").certain, r.unknown.length === 1, "so is a word the feed does not use");
  }
  eq(imp("2025-11-26", "postmarket").day, "2025-11-28", "a report after the close on the Wednesday before Thanksgiving lands on the Friday, an early close that is still a session");
  eq(imp("2026-04-02", "postmarket").day, "2026-04-06", "a report after the close on the Thursday before Good Friday lands on the Monday");
  eq(imp("2026-03-07", "premarket").day, "2026-03-09", "a report dated on a Saturday lands on the Monday, whatever its time");
  eq(imp("2026-02-16", "premarket").day, "2026-02-17", "so does one dated on Presidents Day");
  eq(imp("2026-03-06", "postmarket").day, "2026-03-09", "after the close on a Friday is the Monday");
  eq(imp("2026-03-02", "premarket").day, "2026-03-02", "before the open on a Monday is that Monday");
  eq(imp("2019-12-31", "premarket"), null, "outside the table nothing is guessed");
  eq(imp("2027-12-31", "postmarket"), null, "and an impact past its end is not invented");
  eq(imp("garbage", "premarket"), null, "garbage is null");
  const grid = [];
  for (const d of C.SESSION_DAYS.slice(0, 300)) {
    for (const t of ["premarket", "postmarket", "unknown"]) {
      const mine = C.impactSession(d, t);
      const leaf = leafImpact(d, t, C.SESSION_DAYS);
      deep(mine && [mine.early, mine.late], leaf.sessions.length ? [leaf.sessions[0], leaf.sessions[leaf.sessions.length - 1]] : null, `${d} ${t}: the calendar wraps the one definition in flows-targets`);
      grid.push(mine);
    }
  }
  ok(grid.length === 900, "the grid is complete");
}

const row = (asOf, report, time) => ({ f: C.forward(report, asOf, time), b: C.backward(report, asOf, time) });
const cells = (asOf, report, time) => {
  const { f, b } = row(asOf, report, time);
  return { ed: f ? f.ed : null, rd: b && b.certain ? b.rd : null, rdMax: b && !b.certain ? b.rdMax : null };
};
const state = (asOf, report, time, j = 0, hz = C.HORIZON_SESSIONS) => H.earningsState(cells(asOf, report, time), hz, j);
const edOf = (asOf, report, time) => { const f = C.forward(report, asOf, time); return f ? f.ed : null; };
const rdOf = (asOf, report, time) => { const b = C.backward(report, asOf, time); return b ? b.rd : null; };

{
  const A = "2026-03-02";
  eq(C.horizonEnd(A), "2026-03-31", "the horizon from Monday 2 March 2026 ends on 31 March, 21 sessions after it");
  deep([rdOf(A, "2026-03-02", "premarket"), state(A, "2026-03-02", "premarket")], [0, "reaction"], "a report before the open on the session itself is rd 0, a reaction");
  deep([edOf(A, "2026-03-02", "postmarket"), state(A, "2026-03-02", "postmarket")], [1, "ahead"], "after the close on the session itself lands on the next session: ed 1");
  deep([edOf(A, "2026-03-02", "unknown"), state(A, "2026-03-02", "unknown")], [0, "unstated"], "with no stated time a report dated today is ed 0 and may have reacted this session or be due after the close, so the state is unstated, never a reaction");
  deep([edOf(A, "2026-03-31", "premarket"), state(A, "2026-03-31", "premarket")], [21, "ahead"], "21 sessions out before the open is the last day inside");
  deep([edOf(A, "2026-03-30", "postmarket"), state(A, "2026-03-30", "postmarket")], [21, "ahead"], "20 sessions out after the close lands on the 21st");
  deep([edOf(A, "2026-03-31", "unknown"), state(A, "2026-03-31", "unknown")], [21, "ahead"], "an unknown time at the edge counts through its earlier session");
  deep([edOf(A, "2026-03-31", "postmarket"), state(A, "2026-03-31", "postmarket")], [22, "clear"], "after the close on the 21st lands on the 22nd: outside, the one row that differs from the old rule");
  deep([edOf(A, "2026-04-01", "premarket"), state(A, "2026-04-01", "premarket")], [22, "clear"], "the day after is outside");

  const T = "2026-04-02";
  eq(C.horizonEnd(T), "2026-05-04", "from the Thursday before Good Friday the horizon ends on 4 May");
  deep([edOf(T, "2026-04-02", "postmarket"), C.impactSession("2026-04-02", "postmarket").day], [1, "2026-04-06"], "after the close that Thursday lands on Monday 6 April, past Good Friday");
  deep([edOf(T, "2026-04-03", "premarket"), C.impactSession("2026-04-03", "premarket").day], [1, "2026-04-06"], "a report dated on Good Friday lands on Monday 6 April");
  eq(state(T, "2026-04-02", "unknown"), "unstated", "an unknown time that Thursday is unstated, because the next session could be the one that reacts");
  deep([edOf(T, "2026-05-01", "postmarket"), state(T, "2026-05-01", "postmarket")], [21, "ahead"], "after the close on 1 May lands on 4 May: inside");
  deep([edOf(T, "2026-05-04", "premarket"), state(T, "2026-05-04", "premarket")], [21, "ahead"], "before the open on 4 May: inside");
  deep([edOf(T, "2026-05-04", "unknown"), state(T, "2026-05-04", "unknown")], [21, "ahead"], "an unknown time on 4 May: inside through its earlier session");
  deep([edOf(T, "2026-05-04", "postmarket"), state(T, "2026-05-04", "postmarket")], [22, "clear"], "after the close on 4 May: outside");
  const M = "2026-04-06";
  deep([rdOf(M, "2026-04-02", "postmarket"), state(M, "2026-04-02", "postmarket")], [0, "reaction"], "looking back from Monday 6 April, the Thursday after-close report is rd 0");
  eq(row(M, "2026-04-02", "unknown").b.certain, false, "with no stated time the same report is rd 0 but flagged as not certain");
  deep(cells(M, "2026-04-02", "unknown"), { ed: null, rd: null, rdMax: 1 }, "and it publishes no rd, only that it is at most 1 session old");
  deep([rdOf(M, "2026-04-02", "unknown"), state(M, "2026-04-02", "unknown")], [0, "unstated"], "and it is unstated, not a reaction: it reacted on Monday or on the Thursday before, and the page cannot say which");
  deep([rdOf(M, "2026-04-02", "premarket"), state(M, "2026-04-02", "premarket")], [1, "after"], "before the open that Thursday is rd 1: the day after the event, inside the one-session window");
  eq(state(M, "2026-04-01", "premarket"), "undated", "two sessions after, with no later report dated, it is undated");
  eq(H.earningsState({ ed: 40, rd: 2 }, 21, 0), "clear", "and with a later report far off it is clear");

  const W = "2026-11-25";
  eq(C.horizonEnd(W), "2026-12-28", "from the Wednesday before Thanksgiving the horizon ends on 28 December");
  deep([edOf(W, "2026-11-25", "postmarket"), C.impactSession("2026-11-25", "postmarket").day, state(W, "2026-11-25", "postmarket")], [1, "2026-11-27", "ahead"], "after the close that Wednesday lands on the Friday, past Thanksgiving");
  deep([edOf(W, "2026-11-26", "premarket"), C.impactSession("2026-11-26", "premarket").day], [1, "2026-11-27"], "a report dated on Thanksgiving lands on the Friday");
  eq(state(W, "2026-11-25", "unknown"), "unstated", "unknown that Wednesday is unstated: the Friday after Thanksgiving could be its reaction session");
  deep([edOf(W, "2026-12-24", "postmarket"), C.impactSession("2026-12-24", "postmarket").day, state(W, "2026-12-24", "postmarket")], [21, "2026-12-28", "ahead"], "after the close on the Christmas Eve early close lands on 28 December, the 21st");
  deep([edOf(W, "2026-12-28", "premarket"), state(W, "2026-12-28", "premarket")], [21, "ahead"], "28 December before the open: inside");
  deep([edOf(W, "2026-12-28", "unknown"), state(W, "2026-12-28", "unknown")], [21, "ahead"], "28 December unknown: inside");
  deep([edOf(W, "2026-12-28", "postmarket"), state(W, "2026-12-28", "postmarket")], [22, "clear"], "28 December after the close: outside");
  deep([edOf(W, "2026-12-29", "premarket"), state(W, "2026-12-29", "premarket")], [22, "clear"], "29 December: outside");
  eq(C.withinHorizon("2026-03-31", A, "premarket"), true, "withinHorizon is the same predicate: inside at the edge");
  eq(C.withinHorizon("2026-03-31", A, "postmarket"), false, "and outside past it");
  eq(C.withinHorizon("2026-03-02", A, "premarket"), null, "a report already behind the session is not forward at all");

  eq(H.earningsState({ ed: 1, rd: null }, 21, 1), "reaction", "the live adjustment: a report that lands on the next session is a reaction while that session trades");
  eq(H.earningsState({ ed: 1, rd: null }, 21, 2), "after", "the session after it is the day after");
  eq(H.earningsState({ ed: 1, rd: null }, 21, 3), "clear", "and two sessions later it is behind");
  eq(H.earningsState({ ed: 22, rd: null }, 21, 1), "ahead", "a report 22 sessions out is inside once a session has passed");
  eq(H.earningsState({ ed: null, rd: null }, 21, 0), "undated", "no report date is undated");
  eq(H.earningsState({ ed: 5, rd: 0 }, 21, 0), "reaction", "a name that just reacted is a reaction whatever comes next");
  eq(H.earningsState({ ed: 5, rd: 0 }, 21, 1), "after", "the next session it is the day after");
  eq(H.earningsState({ ed: 5, rd: 0 }, 21, 2), "ahead", "and past that the report ahead is what counts");
  eq(H.earningsState({ ed: 5, rd: null, rdMax: 1 }, 21, 0), "unstated", "a report with no stated time that is 0 or 1 sessions old is unstated: one candidate is a reaction, the other the day after");
  eq(H.earningsState({ ed: 5, rd: null, rdMax: 2 }, 21, 0), "unstated", "one that is 1 or 2 sessions old is unstated too: one candidate is inside the one-session window and the other outside it");
  eq(H.earningsState({ ed: 5, rd: null, rdMax: 3 }, 21, 0), "ahead", "and one that is 2 or 3 sessions old is behind it on both candidates, so the report ahead is what counts");
  eq(H.earningsState({ ed: 5, rd: null, rdMax: 1 }, 21, 1), "unstated", "a session later the same report is 1 or 2 old and still cannot be placed");
  eq(H.earningsState({ ed: 5, rd: null, rdMax: 2 }, 21, 1), "ahead", "and a session after that it is clear on both candidates");
  eq(H.earningsState({ ed: 0 }, 21, 0), "unstated", "ed 0 is a report dated today with no stated time: unstated while today trades");
  eq(H.earningsState({ ed: 0 }, 21, 1), "unstated", "and unstated the next session, when it is the day after on one candidate and a reaction on the other");
  eq(H.earningsState({ ed: 0 }, 21, 2), "unstated", "and the session after, when one candidate is still the day after");
  eq(H.earningsState({ ed: 0 }, 21, 3), "clear", "and clear once both candidates are behind");
  eq(H.earningsState({ ed: 3, edMax: 4 }, 21, 2), "ahead", "a forward report of unstated time is ahead until its earlier candidate session");
  eq(H.earningsState({ ed: 3, edMax: 4 }, 21, 3), "unstated", "and unstated from then, because the earlier candidate reacts and the later is still ahead");
  eq(H.earningsState({ ed: 3, edMax: 4 }, 21, 4), "unstated", "when the later candidate reacts the earlier is the day after");
  eq(H.earningsState({ ed: 3, edMax: 4 }, 21, 5), "unstated", "and one session on the later is the day after while the earlier is behind");
  eq(H.earningsState({ ed: 3, edMax: 4 }, 21, 6), "clear", "until both are behind");
  eq(H.earningsState({ ed: 5, rd: 1 }, 21, 0, 0), "ahead", "with a window of zero the day after is not inside");
  eq(H.earningsInside({ ed: 5, rd: 1 }, 21, 0), true, "earningsInside is true for a state that is not clear or undated");
  eq(H.earningsInside({ ed: 40, rd: 30 }, 21, 0), false, "and false for a clear name");
  eq(H.earningsInside({ ed: null, rd: null }, 21, 0), false, "and for an undated one");
  eq(H.earningsInside({ ed: 5 }, null, 0), null, "and null with no horizon");
  eq(H.earningsState({ ed: null, rd: 0 }, 21, 0), "reaction", "a name with only a past report is a reaction on its day");
  eq(H.earningsState({ ed: 3, rd: null }, 21, 0.5), null, "a live offset that is not a whole number is no state");
  eq(H.earningsState({ ed: 5 }, null, 0), null, "no horizon in the payload is no state, never a default");
  eq(H.earningsState({ ed: 5 }, 0, 0), null, "a horizon of zero is no state");
  eq(H.earningsState(null, 21, 0), null, "no row is no state");
  eq(H.RD_MAX, 99, "rd is read up to 99 sessions");
}

{
  const zone = "2026-11-17T01:30:00+03:00";
  eq(easternDay(Date.parse(zone)), "2026-11-16", "a nightly started at 01:30 TRT in winter belongs to the New York session of the day before");
  eq(easternDay(Date.parse("2026-07-14T23:30:00+03:00")), "2026-07-14", "and one at 23:30 TRT in summer to the same New York day");
  const now = C.coverage(Date.parse("2026-10-26T12:00:00Z"));
  eq(now.ok, true, "today plus 120 days is inside the table");
  eq(C.coverage(Date.parse("2027-09-05T00:00:00Z")).ok, false, "from 5 September 2027 the table is within 120 days of its end and the build must fail");
  eq(C.coverage(Date.parse("2027-09-02T00:00:00Z")).ok, true, "and 3 days earlier it still holds, so the lead is exactly 120 days");
  eq(C.coverage(Date.parse("2027-09-05T00:00:00Z")).need > C.CALENDAR_LAST, true, "because what it needs lies past the last day");
  eq(C.CALENDAR_LEAD_DAYS, Math.ceil((C.HORIZON_SESSIONS * 7) / 5) + 90, "the lead is the horizon in calendar days, rounded up, and a quarter more: it follows the one horizon");
  eq(C.CALENDAR_LEAD_DAYS, 120, "which is 120 days at 21 sessions");
  eq(C.coverage(Date.parse("2026-12-31T12:00:00Z")).warn, false, "a year before the table's end there is no warning");
  eq(C.coverage(Date.parse("2027-01-02T12:00:00Z")).warn, true, "and from a year before it the coverage says so, eight months before the build fails");
  eq(C.coverage(Date.parse("2027-01-02T12:00:00Z")).ok, true, "while the build still passes");
  const live = C.coverage();
  if (live.warn) console.warn("  WARNING: the calendar table ends " + C.CALENDAR_LAST + ", less than a year away; regenerate tests/fixtures-calendar.json and extend the table");
  ok(live.ok, `THE CALENDAR TABLE ENDS ${C.CALENDAR_LAST}, which is ${Math.round((Date.parse(C.CALENDAR_LAST) - Date.now()) / 86400000)} days from now; at ${C.CALENDAR_LEAD_DAYS} days or fewer this fails, and the fix is to regenerate tests/fixtures-calendar.json with a later LAST and raise CALENDAR_LAST`);
}

{
  ok(FIX.holidays.includes("2025-01-09"), "the independent source lists 9 January 2025, the closure for the national day of mourning for President Carter, among the holidays");
  eq(C.isSession("2025-01-09"), false, "and the table agrees, although no holiday rule would close that Thursday");
  eq(C.isSession("2025-01-08") && C.isSession("2025-01-10"), true, "the days around it trade");
  eq(C.sessionsBetween("2025-01-08", "2025-01-10"), 1, "so the closure is one session fewer, not an extra one");
  eq(C.addSessions("2025-01-08", 1), "2025-01-10", "and counting forward from the 8th lands on the 10th");
}

{
  const asOf = "2026-08-24";
  const list = C.ahead(asOf);
  deep(list, ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31"], "the five sessions after the universe's session, the dates a page counts a live session against");
  eq(C.ahead("2026-08-22"), null, "a closed day has none");
  eq(C.horizonEnd("2026-08-22"), null, "and no horizon");
}

const mutate = async (transforms, salt) => loadMutated("shared/flows-calendar.js", transforms, { salt });
const fixtureAgrees = (m) => {
  try { return fixtureAgreesRaw(m); } catch { return false; }
};
const invariants = (m) => {
  const KINDS = ["premarket", "postmarket", "unknown"];
  const bad = [];
  let zeros = 0, straddles = 0, seen = 0;
  for (const asOf of C.SESSION_DAYS.slice(40, 340)) {
    const t0 = Date.parse(asOf + "T00:00:00Z");
    for (let off = -12; off <= 30; off++) {
      const report = new Date(t0 + off * 86400000).toISOString().slice(0, 10);
      for (const time of KINDS) {
        const f = m.forward(report, asOf, time), b = m.backward(report, asOf, time);
        if (m.impactSession(report, time) === null) continue;
        seen++;
        if ((f === null) === (b === null)) bad.push(`${asOf} ${report} ${time}: ${f === null ? "neither" : "both"} a forward and a backward place`);
        if (f && f.ed === 0) {
          zeros++;
          if (f.certain || time !== "unknown" || report !== asOf) bad.push(`${asOf} ${report} ${time}: ed 0 is certain or is not an unstated report dated on the session`);
        }
        if (f && f.certain && f.ed < 1) bad.push(`${asOf} ${report} ${time}: a certain forward report at ed ${f.ed}`);
        if (b) {
          if (b.certain && b.rdMax !== b.rd) bad.push(`${asOf} ${report} ${time}: a certain report with rdMax ${b.rdMax} and rd ${b.rd}`);
          if (!b.certain) { straddles++; if (b.rdMax !== b.rd + 1) bad.push(`${asOf} ${report} ${time}: an uncertain report with rdMax ${b.rdMax} and rd ${b.rd}`); }
        }
        const c = { ed: f ? f.ed : null, rd: b && b.certain ? b.rd : null, rdMax: b && !b.certain ? b.rdMax : null };
        if (c.rd !== null && c.rdMax !== null) bad.push(`${asOf} ${report} ${time}: a report with both rd and rdMax`);
        if (c.ed !== null && (c.rd !== null || c.rdMax !== null)) bad.push(`${asOf} ${report} ${time}: a report both ahead and behind`);
      }
    }
  }
  if (zeros <= 200 || straddles <= 400 || seen <= 30000) bad.push(`the sweep does not reach the cases: ${zeros} at ed 0, ${straddles} uncertain past reports, ${seen} cells`);
  return { bad: bad.slice(0, 5), zeros, straddles, seen };
};
const fixtureAgreesRaw = (m) => {
  const holidays = new Set(FIX.holidays);
  for (const d of allDays) {
    const w = new Date(d + "T00:00:00Z").getUTCDay();
    if (m.isSession(d) !== (w !== 0 && w !== 6 && !holidays.has(d))) return false;
  }
  for (const r of FIX.distance) if (m.sessionsBetween(r.from, r.to) !== r.n) return false;
  for (const r of FIX.offset.filter((x) => x.n > 0 && x.to <= C.CALENDAR_LAST)) if (m.addSessions(r.day, r.n) !== r.to) return false;
  for (const r of FIX.impact) {
    if (m.impactSession(r.date, "premarket").day !== r["before-open"] || m.impactSession(r.date, "postmarket").day !== r["after-close"]) return false;
  }
  if (m.horizonEnd("2026-03-02") !== "2026-03-31") return false;
  if (m.forward("2026-03-31", "2026-03-02", "postmarket") === null || m.forward("2026-03-31", "2026-03-02", "postmarket").ed !== 22) return false;
  const u = m.forward("2026-03-02", "2026-03-02", "unknown");
  if (!u || u.ed !== 0 || u.certain !== false) return false;
  const e = m.forward("2026-03-31", "2026-03-02", "unknown");
  if (!e || e.ed !== 21) return false;
  const q = m.backward("2026-04-02", "2026-04-06", "unknown");
  if (!q || q.rd !== 0 || q.certain !== false) return false;
  if (m.forward("2026-03-02", "2026-03-02", "premarket") !== null) return false;
  const b = m.backward("2026-04-02", "2026-04-06", "postmarket");
  return !!b && b.rd === 0;
};
{
  const real = await mutate([], 1);
  ok(fixtureAgrees(real), "the unmutated copy passes the same battery the wrong builds are held to");
  const inv = invariants(real);
  deep(inv.bad, [], "THE INVARIANTS THE READERS RELY ON HOLD OVER 300 SESSIONS, 43 REPORT DATES AND THREE TIMES: every report is ahead of the session or behind it and never both, ed 0 is only an unstated report dated on the session, a certain report has rdMax equal to rd, an uncertain one is one session older at most, and rd and rdMax are never both published");
  ok(inv.zeros > 200 && inv.straddles > 400 && inv.seen > 30000, `and the sweep reaches them: ${inv.zeros} reports at ed 0, ${inv.straddles} uncertain past reports, ${inv.seen} cells`);
  const invBuilds = [
    ["an uncertain past report aged by its later candidate", [["rdMax: sessionsBetween(imp.early, asOf) };", "rdMax: sessionsBetween(imp.late, asOf) };"]]],
    ["every forward report called certain", [["return { ed: sessionsBetween(asOf, imp.early), certain: imp.certain };", "return { ed: sessionsBetween(asOf, imp.early), certain: true };"]]],
    ["a report that reacted today also placed ahead", [["if (!imp || sessionsBetween(asOf, imp.late) < 1) return null;", "if (!imp || sessionsBetween(asOf, imp.late) < 0) return null;"]]],
    ["a report dated on the session pushed one session on", [["return { ed: sessionsBetween(asOf, imp.early), certain: imp.certain };", "return { ed: Math.max(1, sessionsBetween(asOf, imp.early)), certain: imp.certain };"]]],
    ["a certain past report with the later candidate as its maximum", [["rdMax: sessionsBetween(imp.early, asOf) };", "rdMax: sessionsBetween(imp.early, asOf) + 1 };"]]],
  ];
  let invSalt = 40;
  for (const [title, transforms] of invBuilds) {
    const bad = await mutate(transforms, invSalt++);
    ok(invariants(bad).bad.length > 0, `PLANTED WRONG BUILD, ${title}: the invariants fail it`);
  }
  const builds = [
    ["weekends only, no holidays", [["if (ruleSession(day)) SESSIONS.push(day);", "if (new Date(day + \"T00:00:00Z\").getUTCDay() % 6 !== 0) SESSIONS.push(day);"]]],
    ["Juneteenth 2027 dropped from the closed days", [["if (ruleSession(day)) SESSIONS.push(day);", "if (ruleSession(day) || day === \"2027-06-18\") SESSIONS.push(day);"]]],
    ["a session counted when the day itself is a closed one", [["FLOOR.set(day, SESSIONS.length - 1);", "FLOOR.set(day, SESSIONS.length);"]]],
    ["the horizon ends one session early", [["addSessions(asOf, HORIZON_SESSIONS) : null);", "addSessions(asOf, HORIZON_SESSIONS - 1) : null);"]]],
    ["the horizon ends one session late", [["addSessions(asOf, HORIZON_SESSIONS) : null);", "addSessions(asOf, HORIZON_SESSIONS + 1) : null);"]]],
    ["the nth session after reads one too few", [["const at = FLOOR.get(day) + n + (n < 0 && !INDEX.has(day) ? 1 : 0);", "const at = FLOOR.get(day) + n - 1 + (n < 0 && !INDEX.has(day) ? 1 : 0);"]]],
    ["the later impact candidate is taken for the forward count", [["return { ed: sessionsBetween(asOf, imp.early), certain: imp.certain };", "return { ed: sessionsBetween(asOf, imp.late), certain: imp.certain };"]]],
    ["backward looks at the earlier candidate", [["const rd = imp ? sessionsBetween(imp.late, asOf) : null;", "const rd = imp ? sessionsBetween(imp.early, asOf) : null;"]]],
    ["a report already behind the session counted as ahead", [["if (!imp || sessionsBetween(asOf, imp.late) < 1) return null;", "if (!imp) return null;"]]],
    ["the leaf is handed no session list, so its weekday-only mode returns", [["leafImpact(reportDate, reportTime, SESSIONS)", "leafImpact(reportDate, reportTime, null)"]]],
    ["the table end moved earlier than the fixture", [["export const CALENDAR_LAST = \"2027-12-31\";", "export const CALENDAR_LAST = \"2027-06-30\";"]]],
  ];
  let salt = 2;
  for (const [title, transforms] of builds) {
    const bad = await mutate(transforms, salt++);
    ok(!fixtureAgrees(bad), `PLANTED WRONG BUILD, ${title}: the battery fails it`);
  }
}

console.log(`✓ flows-calendar: ${checks} assertions — every day of 2020 to 2027 is a session exactly when the exchange_calendars oracle says so, the early closes and holidays agree with the rule tables, sessionsBetween and addSessions agree with the oracle and with each other, the three session counters in the tree agree wherever they are all defined, the impact session of every report date and time (Thanksgiving, Good Friday, Presidents Day, weekends, the 2027 Juneteenth) agrees with the oracle, the boundary tables of the horizon at the Monday, the Thursday before Good Friday and the Wednesday before Thanksgiving give the stated ed, rd and state, the live adjustment is exact, the table is checked against the clock with a 120 day lead, the invariants the readers rely on (ed 0 only for an unstated report dated on the session, a report is ahead or behind and never both, rdMax equal to rd for a certain one and one older for an uncertain one) over 300 sessions, and ${16} planted wrong builds are each refused`);
