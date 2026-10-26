import assert from "node:assert/strict";
import { bootUI } from "./lib/ui-boot.mjs";
import { earningsState, earningsInside, horizonWords, HORIZON_SESSIONS, REACTION_BACK_SESSIONS, AHEAD_SESSIONS, LIVE_ELAPSED_MAX } from "../shared/flows-horizon.js";
import { ahead as aheadOf, addSessions, sessionsBetween, isSession, previousSession } from "../shared/flows-calendar.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const EDS = [undefined, null, -1, 0, 1, 2, 3, 5, 12, 20, 21, 22, 40, 1.5, "3", NaN, Infinity];
const RDS = [undefined, null, -1, 0, 1, 2, 3, 98, 99, 1.5, "1"];
const RDMAXS = [undefined, null, -1, 0, 1, 2, 3, 5, 2.5];
const HZS = [1, 2, 5, 20, 21, 22, 30, 0, -1, 1.5, null, undefined, "21"];
const JS = [0, 1, 2, 3, 5, 8, -1, 1.5, undefined, null];
const ROWS = [null, undefined, 5, "x", []];

function grid(F) {
  const bad = [];
  const note = (m) => { if (bad.length < 8) bad.push(m); };
  for (const ed of EDS) for (const rd of RDS) for (const rdMax of RDMAXS) {
    const row = { ed, rd, rdMax };
    for (const hz of HZS) for (const j of JS) {
      const want = earningsState(row, hz, j === undefined ? undefined : j);
      const got = F.earn(row, hz, j);
      if (want !== got) note(`earn ${JSON.stringify([ed, rd, rdMax, hz, j])}: ${got} not ${want}`);
      const wantIn = earningsInside(row, hz, j);
      if (F.earnIn(row, hz, j) !== wantIn) note(`earnIn ${JSON.stringify([ed, rd, rdMax, hz, j])}`);
    }
  }
  for (const row of ROWS) for (const hz of HZS) {
    if (F.earn(row, hz, 0) !== earningsState(row, hz, 0)) note(`earn of a ${JSON.stringify(row)} row`);
  }
  for (const hz of [...HZS, 3, 7, 40, 99]) {
    const full = horizonWords(hz);
    const want = full === null ? null : { n: full.n, apart: full.apart };
    const got = F.horizon(hz);
    if (JSON.stringify(want) !== JSON.stringify(got)) note(`horizon ${hz}: ${JSON.stringify(got)} not ${JSON.stringify(want)}`);
  }
  return bad;
}

const lastSessionOnOrBefore = (day) => (isSession(day) ? day : previousSession(day));

function elapsedGrid(F) {
  const bad = [];
  for (const asOf of ["2026-08-24", "2026-08-21", "2026-11-24", "2026-11-25", "2026-12-23", "2026-12-24", "2027-04-01", "2026-06-30", "2026-07-02", "2026-04-02"]) {
    const list = aheadOf(asOf);
    const last = list[list.length - 1];
    for (let k = -4; k <= 24; k++) {
      const d = new Date(Date.parse(asOf + "T00:00:00Z") + k * 86400000).toISOString().slice(0, 10);
      const n = d <= asOf ? 0 : d > last ? null : sessionsBetween(asOf, lastSessionOnOrBefore(d));
      const want = n !== null && n <= LIVE_ELAPSED_MAX ? n : null;
      const got = F.elapsed(asOf, list, d);
      if (got !== want) bad.push(`elapsed ${asOf} ${d}: ${got} not ${want}`);
    }
    if (F.elapsed(asOf, [], addSessions(asOf, 1)) !== null) bad.push("an empty calendar answers null");
    if (F.elapsed(asOf, null, asOf) !== null) bad.push("no calendar answers null");
    if (F.elapsed("x", list, asOf) !== null || F.elapsed(asOf, list, "") !== null) bad.push("a bad day answers null");
  }
  return bad;
}

const real = bootUI();
eq(grid(real.F), [], "the page kernel's earnings state, inside test and sentences equal the leaf over the whole grid");
eq(elapsedGrid(real.F), [], "and its elapsed-sessions count equals the calendar's own count of sessions");
ok(EDS.length * RDS.length * RDMAXS.length * HZS.length * JS.length > 100000, "the grid is large");
eq(real.F.earn({ ed: 3, rd: null }, HORIZON_SESSIONS, 0), "ahead", "the kernel reads the horizon from its caller and has none of its own");
eq(real.F.horizon(HORIZON_SESSIONS).apart, horizonWords(HORIZON_SESSIONS).apart, "and prints the leaf's sentence for the horizon");
eq(aheadOf("2026-08-24").length, AHEAD_SESSIONS, "the payload carries the five session days after the nightly's");
eq(REACTION_BACK_SESSIONS, 1, "the reaction window looks back one session");
eq(LIVE_ELAPSED_MAX, 2, "and a nightly more than two sessions old places no earnings state");

const BUILDS = [
  ["the reaction window is zero sessions", [["if (age !== null && age <= 1) return age === 0", "if (age !== null && age <= 0) return age === 0"]]],
  ["the reaction window is two sessions", [["if (age !== null && age <= 1) return age === 0", "if (age !== null && age <= 2) return age === 0"]]],
  ["a null rd is an age", [["if (w(r.rd) && r.rd >= 0) a.push(r.rd + j);", "if (r.rd >= 0) a.push(r.rd + j);"]]],
  ["the elapsed sessions are not added to rd", [["a.push(r.rd + j);", "a.push(r.rd);"]]],
  ["a report that landed in the elapsed sessions is not seen", [["if (w(r.ed) && r.ed >= 0 && r.ed <= j) a.push(j - r.ed);", ""]]],
  ["an unstated time counted at its later age", [["a.push(Math.max(r.rdMax - 1, 0) + j);", "a.push(r.rdMax + j);"]]],
  ["the horizon is not moved by the elapsed sessions", [["return r.ed - j >= 1 && r.ed - j <= hz ?", "return r.ed >= 1 && r.ed <= hz ?"]]],
  ["the horizon is one session short", [["r.ed - j >= 1 && r.ed - j <= hz ?", "r.ed - j >= 1 && r.ed - j < hz ?"]]],
  ["a horizon of zero accepted", [["!w(hz) || hz < 1 ||", "!w(hz) ||"]]],
  ["an undated name called clear", [["if (!w(r.ed) || r.ed < 0) return \"undated\";", "if (!w(r.ed) || r.ed < 0) return \"clear\";"]]],
  ["elapsed counts the day itself short", [["ahead.filter((d) => d <= day).length : null", "ahead.filter((d) => d < day).length : null"]]],
  ["elapsed answers a stale nightly with its count", [["return n !== null && n <= 2 ? n : null;", "return n;"]]],
  ["elapsed refuses one session too early", [["return n !== null && n <= 2 ? n : null;", "return n !== null && n <= 1 ? n : null;"]]],
  ["a sentence with the number hard-coded", [["apart: \"Earnings within \" + hz + \" sessions: event not separated.\"", "apart: \"Earnings within 21 sessions: event not separated.\""]]],
  ["the count dropped", [["return { n: hz, apart:", "return { n: hz + 1, apart:"]]],
];

for (const [name, patches] of BUILDS) {
  const mutant = bootUI(patches);
  const bad = [...grid(mutant.F), ...elapsedGrid(mutant.F)];
  ok(bad.length > 0, `PLANTED WRONG BUILD, ${name}: the grid fails it (${bad[0]})`);
}

console.log(`✓ flows-horizon: ${checks} assertions, no server, no vendor data: the page kernel's earnings state, inside test, elapsed-session count and sentences held equal to shared/flows-horizon.js and the calendar over ${EDS.length * RDS.length * RDMAXS.length * HZS.length * JS.length} cells, and ${BUILDS.length} planted wrong builds`);
