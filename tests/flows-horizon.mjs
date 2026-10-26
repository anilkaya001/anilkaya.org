import assert from "node:assert/strict";
import { bootUI } from "./lib/ui-boot.mjs";
import { earningsState, earningsInside, horizonWords, EVENT_STATES, HORIZON_SESSIONS, REACTION_BACK_SESSIONS, AHEAD_SESSIONS, LIVE_ELAPSED_MAX } from "../shared/flows-horizon.js";
import { ahead as aheadOf, addSessions, sessionsBetween, isSession, forward, backward, impactSession } from "../shared/flows-calendar.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const EDS = [undefined, null, -1, 0, 1, 2, 3, 5, 12, 20, 21, 22, 40, 1.5, "3", NaN, Infinity];
const RDS = [undefined, null, -1, 0, 1, 2, 3, 98, 99, 1.5, "1"];
const RDMAXS = [undefined, null, -1, 0, 1, 2, 3, 5, 2.5];
const EDMAXS = [undefined, null, 0, 1, 2, 3, 6, 1.5, "2", -1];
const HZS = [1, 2, 5, 20, 21, 22, 30, 0, -1, 1.5, null, undefined, "21"];
const JS = [0, 1, 2, 3, 5, 8, -1, 1.5, undefined, null];
const BACKS = [undefined, 0, 1, 2, 3, -1, 1.5, null, "1"];
const ROWS = [null, undefined, 5, "x", []];

class Stop extends Error {}

function grid(F, first = false) {
  const bad = [];
  const note = (m) => { if (bad.length < 8) bad.push(m); if (first) throw new Stop(); };
  try {
    return gridRun(F, bad, note);
  } catch (e) {
    if (e instanceof Stop) return bad;
    throw e;
  }
}

function gridRun(F, bad, note) {
  for (const ed of EDS) for (const rd of RDS) for (const rdMax of RDMAXS) {
    const row = { ed, rd, rdMax };
    for (const hz of HZS) for (const j of JS) {
      const want = earningsState(row, hz, j);
      const got = F.earn(row, hz, j);
      if (want !== got) note(`earn ${JSON.stringify([ed, rd, rdMax, hz, j])}: ${got} not ${want}`);
      const wantIn = earningsInside(row, hz, j);
      if (F.earnIn(row, hz, j) !== wantIn) note(`earnIn ${JSON.stringify([ed, rd, rdMax, hz, j])}`);
    }
    for (const hz of [1, 2, 21]) for (const j of [0, 1, 2, 3]) for (const back of BACKS) {
      const want = earningsState(row, hz, j, back);
      const got = F.earn(row, hz, j, back);
      if (want !== got) note(`earn back ${JSON.stringify([ed, rd, rdMax, hz, j, back])}: ${got} not ${want}`);
      if (F.earnIn(row, hz, j, back) !== earningsInside(row, hz, j, back)) note(`earnIn back ${JSON.stringify([ed, rd, rdMax, hz, j, back])}`);
    }
  }
  for (const ed of EDS) for (const edMax of EDMAXS) for (const rd of [undefined, null, 0, 1, 2]) for (const rdMax of [undefined, 1, 2]) {
    const row = { ed, edMax, rd, rdMax };
    for (const hz of [1, 21, null]) for (const j of [0, 1, 2, 3, 5, undefined, 1.5]) for (const back of [undefined, 0, 2]) {
      const want = earningsState(row, hz, j, back);
      const got = F.earn(row, hz, j, back);
      if (want !== got) note(`earn edMax ${JSON.stringify([ed, edMax, rd, rdMax, hz, j, back])}: ${got} not ${want}`);
      if (F.earnIn(row, hz, j, back) !== earningsInside(row, hz, j, back)) note(`earnIn edMax ${JSON.stringify([ed, edMax, rd, rdMax, hz, j, back])}`);
    }
  }
  for (const row of ROWS) for (const hz of HZS) {
    if (F.earn(row, hz, 0) !== earningsState(row, hz, 0)) note(`earn of a ${JSON.stringify(row)} row`);
  }
  if (F.earn({ ed: 3 }, 21) !== null || earningsState({ ed: 3 }, 21) !== null) note("a missing j is no state in either copy");
  for (const hz of [...HZS, 3, 7, 40, 99]) {
    const full = horizonWords(hz);
    const want = full === null ? null : { n: full.n, apart: full.apart };
    const got = F.horizon(hz);
    if (JSON.stringify(want) !== JSON.stringify(got)) note(`horizon ${hz}: ${JSON.stringify(got)} not ${JSON.stringify(want)}`);
  }
  return bad;
}

function elapsedGrid(F) {
  const bad = [];
  for (const asOf of ["2026-08-24", "2026-08-21", "2026-11-24", "2026-11-25", "2026-12-23", "2026-12-24", "2027-04-01", "2026-06-30", "2026-07-02", "2026-04-02"]) {
    const list = aheadOf(asOf);
    const last = list[list.length - 1];
    for (let k = -4; k <= 24; k++) {
      const d = new Date(Date.parse(asOf + "T00:00:00Z") + k * 86400000).toISOString().slice(0, 10);
      const n = d === asOf ? 0 : d < asOf || d > last || !isSession(d) ? null : sessionsBetween(asOf, d);
      for (const jmax of [undefined, 0, 1, 2, 3, 5]) {
        const cap = jmax === undefined ? LIVE_ELAPSED_MAX : jmax;
        const want = n !== null && n <= cap ? n : null;
        const got = F.elapsed(asOf, list, d, jmax);
        if (got !== want) bad.push(`elapsed ${asOf} ${d} jmax ${jmax}: ${got} not ${want}`);
      }
    }
    if (F.elapsed(asOf, [], addSessions(asOf, 1)) !== null) bad.push("an empty calendar answers null");
    if (F.elapsed(asOf, [], asOf) !== 0) bad.push("the session itself needs no calendar");
    if (F.elapsed(asOf, null, asOf) !== null) bad.push("no calendar answers null");
    if (F.elapsed("x", list, asOf) !== null || F.elapsed(asOf, list, "") !== null) bad.push("a bad day answers null");
    if (F.elapsed(asOf, list, addSessions(asOf, 1), 1.5) !== null) bad.push("a fractional cap answers null");
  }
  return bad;
}

const SESSIONS_AS_OF = ["2026-08-24", "2026-08-25", "2026-08-28", "2026-11-24", "2026-11-25", "2026-11-27", "2026-12-24", "2026-12-28", "2027-01-04", "2026-04-02", "2026-07-02", "2026-03-06"];
const TIMES = ["premarket", "postmarket", "unconfirmed", undefined];
const day = (iso, k) => new Date(Date.parse(iso + "T00:00:00Z") + k * 86400000).toISOString().slice(0, 10);

function columnsOf(date, time, asOf) {
  const f = forward(date, asOf, time);
  if (f) return f.certain ? { ed: f.ed } : { ed: f.ed, edMax: f.ed + 1 };
  const b = backward(date, asOf, time);
  if (b) return b.certain ? { rd: b.rd } : { rdMax: b.rdMax };
  return null;
}

function truthOf(date, time, asOf, j, hz, back) {
  const imp = impactSession(date, time);
  const here = addSessions(asOf, j);
  const states = new Set([imp.early, imp.late].map((s) => {
    const d = sessionsBetween(here, s);
    return d > 0 ? (d <= hz ? "ahead" : "clear") : d === 0 ? "reaction" : -d <= back ? "after" : "clear";
  }));
  if (states.size === 1) return [...states][0];
  if ([...states].every((s) => s === "ahead" || s === "clear")) return "ahead";
  return "unstated";
}

function worlds(F, first = false) {
  const bad = [];
  let cells = 0;
  const seen = new Set();
  for (const asOf of SESSIONS_AS_OF) {
    for (let k = -30; k <= 45; k++) {
      const date = day(asOf, k);
      for (const time of TIMES) {
        const cols = columnsOf(date, time, asOf);
        if (!cols) continue;
        for (const j of [0, 1, 2, 3, 4, 5]) for (const hz of [3, 21]) for (const back of [0, 1, 2]) {
          const want = truthOf(date, time, asOf, j, hz, back);
          const raw = F.earn(cols, hz, j, back);
          const got = raw === "undated" ? "clear" : raw;
          cells++;
          seen.add(got);
          if (got !== want && bad.length < 8) bad.push(`${asOf} report ${date} ${time} j ${j} hz ${hz} back ${back} columns ${JSON.stringify(cols)}: ${got} not ${want}`);
          if (F.earnIn(cols, hz, j, back) !== EVENT_STATES[want] && bad.length < 8) bad.push(`earnIn ${asOf} ${date} ${time} j ${j}`);
          if (first && bad.length) return { bad, cells, seen };
        }
      }
    }
  }
  return { bad, cells, seen };
}

const real = bootUI();
eq(grid(real.F), [], "the page kernel's earnings state, inside test and sentences equal the leaf over the whole grid");
eq(elapsedGrid(real.F), [], "and its elapsed-sessions count equals the calendar's own count of sessions");
{
  const leaf = worlds({ earn: earningsState, earnIn: earningsInside });
  eq(leaf.bad, [], "THE STATE THE NIGHTLY'S COLUMNS GIVE EQUALS THE STATE READ STRAIGHT OFF THE CALENDAR: for every report date, report time, session and elapsed count, the leaf run on the columns (ed, edMax, rd, rdMax) agrees with the reaction session each candidate maps to");
  const kernel = worlds(real.F);
  eq(kernel.bad, [], "and so does the page kernel");
  ok(leaf.cells > 100000, `over ${leaf.cells} cells`);
  eq([...leaf.seen].sort(), ["after", "ahead", "clear", "reaction", "unstated"], "which reach every state a report can be in");
}
ok(EDS.length * RDS.length * RDMAXS.length * HZS.length * JS.length > 100000, "the grid is large");
eq(real.F.earn({ ed: 3, rd: null }, HORIZON_SESSIONS, 0), "ahead", "the kernel reads the horizon from its caller and has none of its own");
eq(real.F.horizon(HORIZON_SESSIONS).apart, horizonWords(HORIZON_SESSIONS).apart, "and prints the leaf's sentence for the horizon");
eq(aheadOf("2026-08-24").length, AHEAD_SESSIONS, "the payload carries the five session days after the nightly's");
eq(REACTION_BACK_SESSIONS, 1, "the reaction window looks back one session");
eq(LIVE_ELAPSED_MAX, 2, "and a nightly more than two sessions old places no earnings state");

const CASES = [
  [{ ed: 0 }, 0, "unstated", "a report of unstated time dated on the nightly's session (ed 0) is either on it or the evening after: not a reaction"],
  [{ ed: 0 }, 1, "unstated", "one session on it is a reaction today or yesterday"],
  [{ ed: 0 }, 2, "unstated", "two sessions on it is yesterday or the day before"],
  [{ ed: 0 }, 3, "clear", "and at three it is behind either way"],
  [{ ed: 1 }, 0, "ahead", "a report of known time one session ahead is ahead of the nightly's session"],
  [{ ed: 1 }, 1, "reaction", "and its reaction on the next"],
  [{ ed: 1 }, 2, "after", "and the day after on the one beyond"],
  [{ ed: 1, edMax: 2 }, 0, "ahead", "the same report with an unstated time is ahead of the nightly's session whichever evening"],
  [{ ed: 1, edMax: 2 }, 1, "unstated", "ON THE DAY IT MAY REPORT, THE SESSION IS NOT SAID TO BE ITS REACTION: after the close it is still to come"],
  [{ ed: 1, edMax: 2 }, 2, "unstated", "a session on it is the reaction or the day after"],
  [{ ed: 1, edMax: 2 }, 3, "unstated", "and then the day after or the one beyond"],
  [{ ed: 1, edMax: 2 }, 4, "clear", "and then behind either way"],
  [{ ed: 21, edMax: 22 }, 0, "ahead", "at the edge of the window the nearer candidate decides: inside"],
  [{ ed: 22, edMax: 23 }, 0, "clear", "and one past it, outside"],
  [{ rd: 0 }, 0, "reaction", "a report with a known time that reacted on the session"],
  [{ rd: 1 }, 0, "after", "and one that reacted the session before"],
  [{ rd: 2 }, 0, "undated", "and two before is behind, with no date ahead to place"],
  [{ rdMax: 1 }, 0, "unstated", "a past report of unstated time that is one session old at most is reaction or after"],
  [{ rdMax: 2 }, 0, "unstated", "two at most is after or clear, and an event if it was after"],
  [{ rdMax: 3 }, 0, "undated", "three at most is behind either way, with no date ahead to place"],
  [{ rdMax: 0 }, 0, "reaction", "an unstated report that cannot be older than the session reacted on it"],
  [{ rd: 1, ed: 0 }, 0, "unstated", "two reports: the one that is not certain outranks the day after"],
  [{ rd: 0, ed: 0 }, 0, "reaction", "and a certain reaction outranks the one that is not"],
  [{ ed: null, rd: 1 }, 0, "after", "a name with a past report only"],
  [{ ed: null }, 0, "undated", "a name with no date at all"],
  [{ ed: 5 }, 0, "ahead", "a report five sessions out"],
  [{ ed: 40 }, 0, "clear", "and forty"],
];
for (const [row, j, want, why] of CASES) {
  eq(real.F.earn(row, 21, j), want, `the kernel, ${JSON.stringify(row)} at ${j}: ${why}`);
  eq(earningsState(row, 21, j), want, `and the leaf`);
}
eq(real.F.earn({ ed: null, rd: 1 }, 21, 0, 0), "undated", "a window of zero leaves a name that reacted a session ago out of the events");
eq(real.F.earn({ ed: null, rd: 1 }, 21, 0, 2), "after", "while a window of two keeps it an after day");
eq(real.F.earn({ ed: null, rd: 2 }, 21, 0, 2), "after", "up to the second session");
eq(real.F.earn({ ed: 3 }, 21), null, "a missing elapsed count is no state: j is data, and it has no default");
eq(real.F.earn({ ed: 3 }, 21, 1.5), null, "nor is a fractional one");
eq(real.F.earnIn({ ed: 1, edMax: 2 }, 21, 1), true, "an unstated state is an event");
eq(real.F.earnIn({ ed: 40 }, 21, 1), false, "and a clear one is not");
eq(real.F.earnIn({ ed: 40 }, 21), null, "an unplaced one is neither");
eq(EVENT_STATES.unstated, true, "the leaf says so too");

const BUILDS = [
  ["the reaction window is zero sessions", [["age <= back ? \"after\"", "age <= 0 ? \"after\""]]],
  ["the reaction window is two sessions", [["age <= back ? \"after\"", "age <= 2 ? \"after\""]]],
  ["the reaction window is fixed in the kernel", [["age <= back ? \"after\"", "age <= 1 ? \"after\""]]],
  ["a negative window accepted", [[" || !w(back) || back < 0) return null;", ") return null;"]]],
  ["a null rd is an age", [["if (w(r.rd) && r.rd >= 0) s.push(at(r.rd + j));", "if (r.rd >= 0) s.push(at(r.rd + j));"]]],
  ["the elapsed sessions are not added to rd", [["s.push(at(r.rd + j));", "s.push(at(r.rd));"]]],
  ["a report that landed in the elapsed sessions is not seen", [["s.push(late === null ? first : two(first, late <= j ? at(j - late) : \"ahead\"));", ""]]],
  ["a report of unstated time dated on the session aged as if its time were known", [["r.edMax : r.ed === 0 ? 1 : null;", "r.edMax : null;"]]],
  ["the later candidate of a report ahead ignored", [["const late = w(r.edMax) && r.edMax > r.ed ? r.edMax : r.ed === 0 ? 1 : null;", "const late = r.ed === 0 ? 1 : null;"]]],
  ["the later candidate that has not happened counted as the same state", [["late <= j ? at(j - late) : \"ahead\"", "late <= j ? at(j - late) : first"]]],
  ["two candidates that disagree resolved to the first", [["const two = (x, y) => (x === y ? x : \"unstated\");", "const two = (x, y) => x;"]]],
  ["two candidates that disagree resolved to the younger", [["const two = (x, y) => (x === y ? x : \"unstated\");", "const two = (x, y) => y;"]]],
  ["an unstated past report read at its younger age only", [["s.push(two(at(r.rdMax + j), at(Math.max(r.rdMax - 1, 0) + j)));", "s.push(at(Math.max(r.rdMax - 1, 0) + j));"]]],
  ["an unstated past report read at its older age only", [["s.push(two(at(r.rdMax + j), at(Math.max(r.rdMax - 1, 0) + j)));", "s.push(at(r.rdMax + j));"]]],
  ["the day after outranking an unstated state", [["for (const k of [\"reaction\", \"unstated\", \"after\"])", "for (const k of [\"reaction\", \"after\", \"unstated\"])"]]],
  ["an unstated state outranking a reaction", [["for (const k of [\"reaction\", \"unstated\", \"after\"])", "for (const k of [\"unstated\", \"reaction\", \"after\"])"]]],
  ["a missing elapsed count read as none", [["|| !w(j) || j < 0 ||", "|| j < 0 ||"]]],
  ["an unstated state not an event", [["e !== \"clear\" && e !== \"undated\"", "e === \"reaction\" || e === \"after\" || e === \"ahead\""]]],
  ["the horizon is not moved by the elapsed sessions", [["return r.ed - j >= 1 && r.ed - j <= hz ?", "return r.ed >= 1 && r.ed <= hz ?"]]],
  ["the horizon is one session short", [["r.ed - j >= 1 && r.ed - j <= hz ?", "r.ed - j >= 1 && r.ed - j < hz ?"]]],
  ["a horizon of zero accepted", [["!w(hz) || hz < 1 ||", "!w(hz) ||"]]],
  ["an undated name called clear", [["if (!w(r.ed) || r.ed < 0) return \"undated\";", "if (!w(r.ed) || r.ed < 0) return \"clear\";"]]],
  ["elapsed counts the day itself short", [["const n = day < asOf ? 0 : ahead.indexOf(day) + 1;", "const n = day < asOf ? 0 : ahead.indexOf(day);"]]],
  ["elapsed answers a stale nightly with its count", [["return n > 0 && n <= jmax ? n : null;", "return n > 0 ? n : null;"]]],
  ["elapsed refuses one session too early", [["return n > 0 && n <= jmax ? n : null;", "return n > 0 && n < jmax ? n : null;"]]],
  ["elapsed ages data older than the nightly", [["const n = day < asOf ? 0 : ahead.indexOf(day) + 1;", "const n = day < asOf ? 1 : ahead.indexOf(day) + 1;"]]],
  ["elapsed counts a day that is no session", [["const n = day < asOf ? 0 : ahead.indexOf(day) + 1;", "const n = day < asOf ? 0 : ahead.filter((d) => d <= day).length;"]]],
  ["elapsed ignores the cap it is given", [["n <= jmax ? n : null;", "n <= 2 ? n : null;"]]],
  ["a sentence with the number hard-coded", [["apart: \"Earnings within \" + hz + \" sessions: event not separated.\"", "apart: \"Earnings within 21 sessions: event not separated.\""]]],
  ["the count dropped", [["return { n: hz, apart:", "return { n: hz + 1, apart:"]]],
];

for (const [name, patches] of BUILDS) {
  const mutant = bootUI(patches);
  let bad = grid(mutant.F, true);
  if (!bad.length) bad = elapsedGrid(mutant.F);
  if (!bad.length) bad = worlds(mutant.F, true).bad;
  ok(bad.length > 0, `PLANTED WRONG BUILD, ${name}: the grid fails it (${bad[0]})`);
}

console.log(`✓ flows-horizon: ${checks} assertions, no server, no vendor data: the page kernel's earnings state, inside test, elapsed-session count and sentences held equal to shared/flows-horizon.js over ${EDS.length * RDS.length * RDMAXS.length * HZS.length * JS.length} cells and the calendar's own reaction sessions over 12 sessions, 76 report dates, four report times, six elapsed counts and three windows, and ${BUILDS.length} planted wrong builds`);
