import assert from "node:assert/strict";
import { unitFor, formatUnits, cellText, exactDollars, exactCents, moneyShort, roundGrid, caption, niceScale, scaleText, MINUS, DASH } from "../shared/flows-sfc-display.js";
import { workedExample } from "./lib/sfc-golden.mjs";
import { roundTable, footsRounded } from "../shared/flows-round.js";
import { dayLabel, rangeLabel, trtOf, trtStamp, lastCompletedSession, expectedFive, periodPlan, sumSessions, NOT_ARCHIVED, LIVE_MAX_AGE_MS } from "../shared/flows-sfc-time.js";
import { stockRecon, NO_OPEN_INTEREST, NET_CLOSING } from "../shared/flows-sfc-stock.js";
import { ledgerView, parseScope } from "../shared/flows-sfc-view.js";
import { SECTORS, COLUMNS } from "../shared/flows-sfc.js";
import * as COPY from "../shared/flows-sfc-copy.js";
import { mulberry32 } from "./lib/sfc-rng.mjs";
import { runProduction } from "./lib/sfc-run.mjs";
import { makeWorld } from "./lib/sfc-world.mjs";
import { storedInput, recordFor } from "./lib/sfc-stored.mjs";
import { viewsOf, cellsOf, fixtures } from "./lib/sfc-views.mjs";
import { loadVariant } from "./lib/sfc-variant.mjs";
import { lintText, lintSentence, stringLeaves, htmlToText, RULES, tape, unsided, sectorTransfer, flowLeaving, tooLong, modal } from "./lib/copy-lint.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const throws = (f, type, m) => { assert.throws(f, type, m); checks++; };

{
  const stepLabels = [0, 1, 2, 3, 4, 5, 6, 7].map((e) => unitFor(Number("1" + "0".repeat(e + 4)) * 100 / 10).stepLabel);
  eq(stepLabels, ["$1", "$10", "$100", "$1k", "$10k", "$100k", "$1M", "$10M"], "the step reads $1 up to $10M, one digit at a time");
  const u = (c) => unitFor(c);
  eq([u(99900).e, u(999999).e, u(1000000).e, u(99999999).e, u(100000000).e, u(2e14).e], [0, 0, 1, 2, 3, 7], "unit exponent follows the digits of the largest dollar figure");
  eq([u(100000000).scaleName, u(1000000000).scaleName, u(100000000000).scaleName, u(1e12).scaleName], ["USD thousands", "USD millions", "USD millions", "USD billions"], "scale names");
  eq(u(-1234567800), unitFor(1234567800), "the unit follows the absolute value");
  throws(() => unitFor(1.5), RangeError, "a figure that is not a safe integer is refused");
  eq([formatUnits(1234, unitFor(1234567800)), formatUnits(-5, unitFor(1234567800)), formatUnits(123456789, unitFor(1e11)), formatUnits(123456789, unitFor(1e12))], ["12.34", `${MINUS}0.05`, "123,456,789", "1,234,567.89"], "formatUnits pads the fraction and groups thousands");
  eq([cellText(0, 0, u(1e8)), cellText(40, 0, u(1e8)), cellText(40, 3, u(1e8)), cellText(-4000000, -4, u(1e8))], ["0", "~0", "3", `${MINUS}4`], "zero, rounds-to-zero and a figure");
  eq([exactDollars(0), exactDollars(5), exactDollars(-123456789), exactDollars(100000)], ["$0.00", "$0.05", `${MINUS}$1,234,567.89`, "$1,000.00"], "exact dollars carry cents and the typographic minus");
  eq([exactCents(-1234), exactCents(0)], [`${MINUS}1,234 ¢`, "0 ¢"], "exact cents");
  eq([moneyShort(0), moneyShort(99900), moneyShort(123400), moneyShort(-4500000), moneyShort(250000000), moneyShort(12000000000000)], ["$0", "$999", "$1.2k", `${MINUS}$45.0k`, "$2.50M", "$120.00B"], "short money");
  eq(caption(unitFor(5000)), "USD, to $1. Hover for exact.", "caption at dollar unit");
  eq(caption(unitFor(1e9), "delta"), "Delta-dollars, USD millions, to $10k. Hover for exact.", "caption for delta-dollars");
  eq([niceScale(0), niceScale(1), niceScale(99), niceScale(100), niceScale(101), niceScale(250), niceScale(500), niceScale(501), niceScale(4999999), niceScale(-1234567)], [100, 1, 100, 100, 200, 500, 500, 1000, 5000000, 2000000], "the tilt scale rounds up to 1, 2 or 5 times a power of ten, by the absolute value");
  throws(() => niceScale(1.5), RangeError, "a scale of a non-integer is refused");
  throws(() => niceScale(9e15), RangeError, "and one that would leave the safe integers");
  eq([scaleText(5000000000), scaleText(200000000), scaleText(50000), scaleText(500), scaleText(100), scaleText(2000000)], ["$50M", "$2M", "$500", "$5", "$1", "$20k"], "the scale is printed short: $50M, $2M, $500, $5");
  eq(DASH, "—", "the absent mark is an em dash");
  eq(roundGrid([], unitFor(0)), { cells: [], rowTotals: [], colTotals: [], total: 0 }, "an empty grid rounds to nothing");
}

{
  const rnd = mulberry32(2718);
  let worst = 0;
  for (let i = 0; i < 3000; i++) {
    const r = 2 + Math.floor(rnd() * 11), c = 2 + Math.floor(rnd() * 6);
    const grid = Array.from({ length: r }, () => Array.from({ length: c }, () => (rnd() < 0.2 ? 0 : Math.round((rnd() - 0.5) * 8e7))));
    for (let j = 0; j < c; j++) grid[r - 1][j] = -grid.slice(0, r - 1).reduce((a, row) => a + row[j], 0);
    const rowSum = grid.map((row) => row.reduce((a, v) => a + v, 0));
    for (let k = 0; k < r - 1; k++) grid[k][c - 1] -= rowSum[k];
    grid[r - 1][c - 1] -= grid[r - 1].reduce((a, v) => a + v, 0) - grid[r - 1][c - 1] + grid[r - 1][c - 1];
    const unit = unitFor(Math.max(...grid.flat().map(Math.abs)));
    const out = roundGrid(grid, unit);
    const flatRows = out.cells.map((row) => row.reduce((a, v) => a + v, 0));
    const exactRows = grid.map((row) => row.reduce((a, v) => a + v, 0));
    for (let k = 0; k < r; k++) if (exactRows[k] === 0 && flatRows[k] !== 0) worst++;
    for (let k = 0; k < r; k++) for (let j = 0; j < c; j++) if (Math.abs(out.cells[k][j] * unit.unitCents - grid[k][j]) >= unit.unitCents) worst++;
  }
  eq(worst, 0, "3000 random grids: a zero-sum row still rounds to zero, and no cell moves by a whole unit");
  const g = [[4, 4, -8], [4, 4, -8], [-8, -8, 16]];
  const direct = roundTable(g, 10);
  ok(footsRounded(direct), "the controlled rounding of the worked 4-4-8 grid foots");
  eq(roundGrid(g, { unitCents: 10, e: 0 }).cells, direct.cells, "and roundGrid is that table");
}

{
  eq(dayLabel("2025-11-03"), "Mon 3 Nov", "day label");
  eq(dayLabel("2026-02-30"), "Mon 2 Mar", "an impossible date rolls over as the calendar does, like the Date object");
  eq([dayLabel("garbage"), dayLabel(null), dayLabel("2025-1-3")], [null, null, null], "an unreadable day has no label");
  eq([rangeLabel("2025-10-27", "2025-10-31"), rangeLabel("2025-11-24", "2025-12-01"), rangeLabel("2024-12-30", "2025-01-03"), rangeLabel("x", "2025-01-03")], ["27–31 Oct", "24 Nov–1 Dec", "30 Dec–3 Jan", null], "range labels share a month or name both");
  eq(trtOf(Date.parse("2026-10-23T14:55:00Z")), { day: "2026-10-23", clock: "17:55", weekday: "Fri" }, "TRT is UTC plus three, always");
  eq(trtOf(Date.parse("2026-01-15T14:55:00Z")).clock, "17:55", "and has no daylight time in January either");
  eq(trtStamp(Date.parse("2025-11-03T21:00:00Z"), "2025-11-03"), "00:00 TRT Tue", "the winter close is midnight TRT of the next day and says so");
  eq(trtStamp(Date.parse("2026-10-23T20:00:00Z"), "2026-10-23"), "23:00 TRT", "the summer close is 23:00 TRT, same day");
  eq(trtStamp(Date.parse("2026-10-23T20:00:00Z")), "23:00 TRT", "no exchange day, no weekday");
  eq([trtOf(NaN), trtStamp(Infinity)], [null, null], "no instant, no stamp");
  const last = (iso) => lastCompletedSession(Date.parse(iso));
  eq(last("2025-11-03T07:00:00Z"), "2025-10-31", "Monday morning: the Friday before");
  eq([last("2025-11-03T20:59:59Z"), last("2025-11-03T21:00:00Z")], ["2025-10-31", "2025-11-03"], "the session is complete at 16:00 New York time (21:00 UTC after the clocks go back)");
  eq([last("2025-10-31T19:59:59Z"), last("2025-10-31T20:00:00Z")], ["2025-10-30", "2025-10-31"], "and at 20:00 UTC before they do");
  eq(last("2025-11-01T15:00:00Z"), "2025-10-31", "Saturday: Friday");
  eq(last("2025-11-02T12:00:00Z"), "2025-10-31", "Sunday of the change: Friday");
  eq([last("2025-11-28T17:59:00Z"), last("2025-11-28T18:00:00Z")], ["2025-11-26", "2025-11-28"], "the day after Thanksgiving closes early at 13:00 New York time, and Thursday is not a session");
  eq(lastCompletedSession(NaN), null, "no clock, no session");
  eq(expectedFive("2025-10-31"), ["2025-10-27", "2025-10-28", "2025-10-29", "2025-10-30", "2025-10-31"], "five sessions back from a Friday");
  eq(expectedFive("2025-12-01"), ["2025-11-24", "2025-11-25", "2025-11-26", "2025-11-28", "2025-12-01"], "five sessions back skip Thanksgiving");
  eq(expectedFive("2025-11-27"), ["2025-11-20", "2025-11-21", "2025-11-24", "2025-11-25", "2025-11-26"], "a holiday as the last day starts from the session before it");
}

{
  const at = (iso) => Date.parse(iso);
  const plan = (iso, live = null, nightly = null) => periodPlan({ at: at(iso), live, nightly });
  eq(plan("2025-11-04T01:00:00Z").intraday.reason, "No session open. Next opens Tue 4 Nov 17:30 TRT.", "after the close: the next open in TRT");
  eq(plan("2025-11-01T15:00:00Z").intraday.reason, "No session open. Next opens Mon 3 Nov 17:30 TRT.", "Saturday: Monday's open");
  eq(plan("2025-11-03T12:00:00Z").intraday.reason, "No session open. Next opens Mon 3 Nov 17:30 TRT.", "before the open the same day: today's open");
  eq(plan("2025-11-03T14:30:00Z", { session: "2025-11-03", readAt: at("2025-11-03T14:29:00Z") }).intraday.ok, true, "at the open a read a minute old is accepted");
  const live = (readAt, session = "2025-11-03") => ({ session, readAt: at(readAt) });
  const p = plan("2025-11-03T16:00:00Z", live("2025-11-03T15:50:00Z"));
  eq([p.intraday.ok, p.intraday.label, p.intraday.asOf], [true, "Intraday · provisional · as of 18:50 TRT", at("2025-11-03T15:50:00Z")], "intraday names its read in TRT");
  eq(plan("2025-11-03T16:00:00Z", live("2025-11-03T15:29:00Z")).intraday.reason, "No live read since 18:29 TRT.", "a read older than thirty minutes is named and refused");
  eq(plan("2025-11-03T16:00:00Z", live("2025-11-03T15:50:00Z", "2025-10-31")).intraday.reason, "No read yet for this session.", "a read of another session is no read");
  eq(plan("2025-11-03T16:00:00Z", { session: "2025-11-03", readAt: null }).intraday.reason, "No read yet for this session.", "no read time, no read");
  eq(plan("2025-11-03T16:00:00Z").intraday.reason, "No read yet for this session.", "nothing stored");
  ok(LIVE_MAX_AGE_MS === 1800000, "the live read may be thirty minutes old");
  const nightly = { session: "2025-10-31", readAt: at("2025-11-01T02:00:00Z") };
  const s = plan("2025-11-03T16:00:00Z", null, nightly).session;
  eq([s.ok, s.source, s.status, s.label], [true, "nightly", "complete", "Session of Fri 31 Oct · complete"], "the nightly of the last session is complete");
  const partial = plan("2025-11-03T16:00:00Z", live("2025-10-31T19:30:00Z", "2025-10-31")).session;
  eq([partial.ok, partial.status, partial.label], [true, "partial", "Session of Fri 31 Oct · partial to 22:30 TRT"], "a live read from before the close is partial and says to when");
  const prov = plan("2025-11-03T16:00:00Z", live("2025-10-31T20:05:00Z", "2025-10-31")).session;
  eq([prov.ok, prov.status, prov.label], [true, "provisional", "Session of Fri 31 Oct · provisional until the nightly lands"], "a live read from after the close is provisional");
  eq(plan("2025-11-03T16:00:00Z", live("2025-10-30T20:05:00Z", "2025-10-30")).session.reason, "Session of Fri 31 Oct was not stored.", "a read of an earlier session does not stand in");
  eq(plan("2025-11-03T16:00:00Z").five.label, "5 sessions · 27–31 Oct", "the five-session label");
  eq(plan("2025-11-03T16:00:00Z").five.reason, NOT_ARCHIVED, "and it is not offered: nothing is archived");
  eq(plan("2025-11-03T16:00:00Z").five.ok, false, "five is never ok in this wave");
  eq(periodPlan({ at: NaN }).last, null, "no clock, no plan");
}

{
  const exp = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
  const blank = (r, c) => (r <= 3 ? c > 1 : r <= 7 ? c !== 2 && c !== 3 : r <= 9 ? c < 4 : false);
  const mk = (d, k, patch = {}) => ({ date: d, matrix: Array.from({ length: 11 }, (_, r) => Array.from({ length: 6 }, (_, c) => (blank(r, c) ? null : (r + 1) * 100 + c * 10 + k))), tilt: { Energy: 5 + k, Technology: -5 - k }, ...patch });
  const all = exp.map((d, i) => mk(d, i));
  const sum = sumSessions({ expected: exp, ledgers: all, archived: true });
  eq(sum.status, "ok", "five stored sessions sum");
  eq([sum.from, sum.to], ["2026-10-19", "2026-10-23"], "and say from when to when");
  eq(sum.cells[0][0], 5 * 100 + 0 + (0 + 1 + 2 + 3 + 4), "a cell is the sum over the five sessions");
  eq(sum.cells[0][2], null, "a cell blank by construction stays blank");
  eq(sum.cells[10][5], 5 * 1100 + 5 * 50 + 10, "the balancing row sums too");
  eq([sum.tilt.Energy, sum.tilt.Technology, sum.tiltSum], [35n, -35n, 0n], "tilt sums exactly and stays zero");
  const holed = all.map((l, i) => (i === 2 ? { ...l, matrix: l.matrix.map((row, r) => row.map((v, c) => (r === 8 && c === 4 ? null : v))) } : l));
  const part = sumSessions({ expected: exp, ledgers: holed, archived: true });
  eq(part.cells[8][4], null, "a figure absent on one day is absent in the sum, not summed as zero");
  eq(part.absentCells, [{ r: 8, c: 4, reason: "Absent on Wed 21 Oct." }], "and names the day");
  const noTilt = all.map((l, i) => (i === 1 ? { ...l, tilt: { Energy: 6 } } : l));
  const pt = sumSessions({ expected: exp, ledgers: noTilt, archived: true });
  eq([pt.tilt.Technology, pt.tilt.Energy, pt.tiltSum], [null, 35n, 35n], "a sector missing on one day has no five-session tilt");
  eq(sumSessions({ expected: exp, ledgers: all, archived: false }), { status: "absent", reason: NOT_ARCHIVED, missing: exp }, "unarchived is absent with the reason");
  eq(sumSessions({ expected: exp, ledgers: all.slice(0, 4), archived: true }).reason, "1 of 5 sessions not stored, oldest Fri 23 Oct.", "four of five is absent, naming the gap");
  eq(sumSessions({ expected: exp, ledgers: [], archived: true }).reason, "5 of 5 sessions not stored, oldest Mon 19 Oct.", "none of five");
  throws(() => sumSessions({ expected: exp.slice(0, 4), ledgers: [], archived: true }), TypeError, "four expected sessions are refused");
  throws(() => sumSessions({ expected: ["2026-10-17", ...exp.slice(1)], ledgers: [], archived: true }), TypeError, "a Saturday among the expected sessions is refused");
  throws(() => sumSessions({ expected: [exp[1], exp[0], ...exp.slice(2)], ledgers: [], archived: true }), TypeError, "descending sessions are refused");
  throws(() => sumSessions({ expected: exp, ledgers: [mk("2026-10-26", 0)], archived: true }), TypeError, "a ledger outside the five is refused");
  throws(() => sumSessions({ expected: exp, ledgers: [mk(exp[0], 0), mk(exp[0], 1)], archived: true }), TypeError, "a repeated date is refused");
  throws(() => sumSessions({ expected: exp, ledgers: [{ ...mk(exp[0], 0), matrix: [[1]] }], archived: true }), TypeError, "a short matrix is refused");
  throws(() => sumSessions({ expected: exp, ledgers: [{ ...mk(exp[0], 0), matrix: mk(exp[0], 0).matrix.map((r) => r.slice(0, 5)) }], archived: true }), TypeError, "a narrow row is refused");
  throws(() => sumSessions({ expected: exp, ledgers: [{ ...mk(exp[0], 0), matrix: mk(exp[0], 0).matrix.map((r) => r.map((v) => (v === null ? null : v + 0.5))) }], archived: true }), TypeError, "cents that are not integers are refused");
  const huge = all.map((l) => ({ ...l, matrix: l.matrix.map((row) => row.map((v) => (v === null ? null : 2 ** 52))) }));
  throws(() => sumSessions({ expected: exp, ledgers: huge, archived: true }), RangeError, "a sum that leaves the safe integers throws instead of rounding");
}

{
  eq(stockRecon(null), { status: "absent", reason: NO_OPEN_INTEREST }, "no input, no reconciliation");
  eq(stockRecon({ prev: [], curr: [{}] }).status, "absent", "an empty side, no reconciliation");
  const c = (id, oi, mark, extra = {}) => ({ id, oi, mark, mult: 100, ...extra });
  const prev = [c("A", 100, 200), c("B", 50, 300, { expires: "2026-10-23" }), c("C", 10, 100), c("D", 70, 500, { expires: "2026-10-30" }), c("H", 5, 10, { expires: "2026-12-18" })];
  const curr = [c("A", 140, 250), c("C", 10, 100, { mult: 150 }), c("E", 20, 400), c("F", 5, 100, { from: "Z" }), c("G", 8, 120, { from: "D" })];
  const r = stockRecon({ prev, curr, prevDay: "2026-10-22", currDay: "2026-10-23", openingCents: 100000, sameSessionCents: 777 });
  eq(r.status, "ok", "a reconciliation");
  const value = (x) => x.mult * x.oi * x.mark;
  eq([r.before, r.after], [prev.reduce((a, x) => a + value(x), 0), curr.reduce((a, x) => a + value(x), 0)], "before and after are the sums of contract values");
  eq(r.identityDiff, 0, "opening stock plus every line equals closing stock exactly");
  eq(r.lines.added, 100 * 200 * 40, "added: previous mark times the change in open interest");
  eq(r.lines.reval, 100 * 140 * 50, "revalued: today's open interest times the change in mark");
  eq(r.lines.expired, -(100 * 50 * 300), "expired: B expired between the two dates");
  eq(r.lines.dropped, -(100 * 5 * 10), "dropped: H left before its expiry and nothing took its place");
  eq(r.lines.adjusted, (150 * 10 * 100 - 100 * 10 * 100) + (100 * 8 * 120 - 100 * 70 * 500), "adjusted: a changed multiplier, and G in D's place by name, in value");
  eq(r.lines.new, 100 * 20 * 400, "new: listed today");
  eq(r.lines.unmatched, 100 * 5 * 100, "unmatched: a successor whose predecessor is not there");
  eq(r.counts, { alive: 1, expired: 1, listed: 1, adjusted: 2, unmatched: 1, dropped: 1 }, "counts by kind");
  eq(r.memo, { sameSession: 777 }, "the same-session memo travels");
  eq(r.residual.status, "ok", "the residual is stated");
  eq([r.residual.added, r.residual.opening, r.residual.unexplained], [100 * 200 * 40, 100000, 100 * 200 * 40 - 100000], "added stock less opening premium is what the flagged windows do not explain");
  eq(stockRecon({ prev, curr, prevDay: "2026-10-22", currDay: "2026-10-23" }).residual, { status: "absent", reason: "opening premium is not available" }, "no opening premium, no residual");
  const shrink = stockRecon({ prev: [c("A", 100, 200)], curr: [c("A", 60, 200)], openingCents: 5 });
  eq(shrink.residual, { status: "absent", reason: NET_CLOSING }, "net closing is named, not forced");
  eq(stockRecon({ prev: [c("A", 100, 200)], curr: [c("A", 100, 210)], openingCents: 5 }).residual, { status: "absent", reason: "no position was added" }, "no addition, no residual");
  const dirty = stockRecon({ prev: [c("A", 1, 1), { id: "X", oi: -1, mark: 1, mult: 100 }, null], curr: [c("A", 1, 1), { id: "Y", oi: 1, mark: 0, mult: 100 }] });
  eq(dirty.excluded, { prev: 2, curr: 1, alive: 0 }, "unusable contracts are excluded and counted");
  eq(dirty.identityDiff, 0, "and the identity still closes on what remains");
  const rnd = mulberry32(99);
  let broken = 0;
  for (let i = 0; i < 400; i++) {
    const n = 2 + Math.floor(rnd() * 12);
    const p = Array.from({ length: n }, (_, k) => c("P" + k, Math.floor(rnd() * 500), 1 + Math.floor(rnd() * 900), { expires: rnd() < 0.3 ? "2026-10-23" : "2027-01-15", mult: rnd() < 0.1 ? 10 : 100 }));
    const q = p.filter(() => rnd() < 0.8).map((x) => c(x.id, Math.floor(rnd() * 500), 1 + Math.floor(rnd() * 900), { mult: rnd() < 0.05 ? 50 : x.mult }));
    for (let k = 0; k < 3; k++) q.push(c("N" + k, Math.floor(rnd() * 300), 1 + Math.floor(rnd() * 900), rnd() < 0.5 ? { from: p[Math.floor(rnd() * p.length)].id } : {}));
    if (stockRecon({ prev: p, curr: q, prevDay: "2026-10-22", currDay: "2026-10-23" }).identityDiff !== 0) broken++;
  }
  eq(broken, 0, "400 random books: the stock identity closes to the cent every time");
  throws(() => stockRecon({ prev: [c("A", 2 ** 40, 2 ** 20)], curr: [c("A", 1, 1)] }), RangeError, "a value beyond the safe integers throws instead of rounding");
}

{
  const sectors = [...SECTORS, "Index & ETF", "No sector"];
  eq(parseScope(undefined), { kind: "all", key: "all" }, "no scope is all");
  eq([parseScope(null), parseScope(""), parseScope("all")], [{ kind: "all", key: "all" }, { kind: "all", key: "all" }, { kind: "all", key: "all" }], "empty and all");
  for (const s of sectors) eq(parseScope("sector:" + s), { kind: "sector", sector: s, key: "sector:" + s }, "sector " + s);
  eq(parseScope("name:aapl"), { kind: "name", name: "AAPL", key: "name:AAPL" }, "a name is upper-cased");
  eq(parseScope("name: SYA101 "), { kind: "name", name: "SYA101", key: "name:SYA101" }, "and trimmed");
  eq(parseScope("name:BRK.B"), { kind: "name", name: "BRK.B", key: "name:BRK.B" }, "a dotted class share");
  for (const bad of ["sector:Bogus", "sector:", "sector:technology", "name:", "name:../x", "name:A B", "name:" + "A".repeat(11), "name:1ABC", "nonsense", "sector:Energy:x", "NAME:AAPL", "name:<b>", "name:A;DROP"]) eq(parseScope(bad), null, "refused scope " + JSON.stringify(bad));
}

{
  const views = viewsOf();
  const byId = new Map(views);
  const statuses = Object.fromEntries(views.map(([id, v]) => [id, v.status]));
  eq(statuses, {
    all: "ok", sector: "ok", funds: "ok", nosector: "ok", name: "ok", "missing-name": "quiet", shed: "ok", pathological: "ok", "no-tide": "ok", worked: "ok",
    saturday: "ok", "after-close": "ok", "stale-live": "unavailable", quiet: "quiet", failed: "failed", session: "ok", five: "unavailable",
  }, "each fixture reaches the state it is built for");
  eq(byId.get("saturday").period.id, "session", "a Saturday with a stored Friday read opens on the session");
  eq(byId.get("saturday").period.label.startsWith("Session of Fri 23 Oct"), true, "and names it");
  eq(byId.get("five").why, NOT_ARCHIVED, "five sessions say they are not archived");
  eq(byId.get("stale-live").why, "No live read since 17:15 TRT.", "a stale live read is named in TRT");
  eq(byId.get("failed").why, "The record has no readable windows.", "a record with no windows array fails with words");
  eq(byId.get("quiet").status, "quiet", "no windows is quiet, not an error");
  eq(byId.get("missing-name").why, "SYZ999 has no held windows in this period.", "a name with no windows says so");
  for (const [id, v] of views) {
    ok(Array.isArray(v.periods) && v.periods.length === 3 && v.periods.map((p) => p.id).join() === "intraday,session,five", `${id}: three periods in order`);
    ok(v.basis === "window" && v.v === 1, `${id}: window basis, version 1`);
    ok(v.scope && typeof v.scope.key === "string", `${id}: names its scope`);
    if (v.status !== "ok") { ok(typeof v.why === "string" && v.why.length > 0, `${id}: a state with no figures carries a reason`); ok(!("ledger" in v), `${id}: and no ledger`); }
  }
  const all = byId.get("all");
  eq(all.ledger.rows.length, 11, "eleven rows");
  eq(all.ledger.columns.map((c) => c.label), COPY.COLUMN_COPY.map((c) => c.label), "six columns, worded as the copy module words them");
  eq(all.ledger.rows.map((r) => r.label), COPY.ROW_COPY.map((r) => r.label), "rows, worded as the copy module words them");
  eq(all.checks.items.map((i) => i.id), ["rows", "columns", "sides", "sectors", "tilt", "session", "stock"], "seven checks in order");
  eq(all.checks.items.map((i) => i.state), ["pass", "pass", "pass", "pass", "pass", "pass", "absent"], "six pass and the stock identity is absent with its reason");
  eq(all.sectors.rows.map((r) => r.key), COLUMNS, "thirteen sector rows in column order");
  eq(all.stock.status, "absent", "the stock panel is not built");
  eq(all.withheld, null, "nothing withheld when the ledger closes");
  const notide = byId.get("no-tide");
  eq(notide.ledger.rows[8].cells.slice(4).map((c) => c.s), ["absent", "absent"], "without a tide, the outside cells of row nine are absent");
  eq(notide.ledger.rows[9].cells.slice(4).map((c) => c.s), ["absent", "absent"], "and of row ten");
  eq(notide.ledger.rows[10].cells.slice(4).map((c) => c.s), ["absent", "absent"], "and the balancing entries of the outside columns");
  eq(notide.ledger.rows[8].cells[4].r, "No sector tide in this scope.", "with the reason beside them");
  eq(notide.ledger.net.cells.slice(4).map((c) => c.s), ["absent", "absent"], "and the net-before-balancing cells of the outside columns");
  eq(notide.ledger.measured, 4, "four measured columns");
  eq(notide.checks.items.find((i) => i.id === "session").state, "absent", "and no session check");
  const worked = byId.get("worked");
  eq(worked.scope.shed, 4, "the worked fixture shed four windows");
  ok(worked.scope.line.includes("4 of 10 were shed and are not counted"), "and says the shed premium is not counted");
  ok(worked.reading.some((s) => s.includes("4 windows were shed")), "and the reading repeats it");
  const nm = byId.get("name");
  ok(nm.windows && nm.windows.rows.length > 0 && nm.windows.count > 0, "a name scope lists its windows");
  ok(!nm.names, "and no names table");
  const sec = byId.get("sector");
  ok(sec.names && sec.names.rows.length > 0, "a sector scope lists its names");
  ok(!sec.windows, "and no windows table");
  eq(sec.scope.crumbs.map((c) => c.key), ["all", sec.scope.key], "with a breadcrumb");
}

{
  const g = workedExample();
  const views = new Map(viewsOf());
  const v = views.get("worked");
  const m = g.expected.rows;
  eq(v.flow.arrows.map((a) => [a.id, a.from, a.to, a.cents]), [["callsAsk", "TK", "LP", m[0][1]], ["putsAsk", "TK", "LP", m[2][1]], ["callsBid", "LP", "TK", m[1][0]], ["putsBid", "LP", "TK", m[3][0]]], "the four held-window arrows carry the ledger's own cells, from payer to payee");
  const net = m[0][1] + m[2][1] - m[1][0] - m[3][0];
  eq([v.flow.net.cents, v.flow.net.line], [net, `Takers paid ${moneyShort(net)} net in held windows.`], "the net arrow says who paid");
  eq(v.flow.noside.reasons.map((r) => r.cents), [m[4][3], m[5][3], m[6][3], m[7][3]], "the no-side flow is the four reason rows");
  eq(v.flow.noside.cents, m[4][3] + m[5][3] + m[6][3] + m[7][3], "and their sum");
  eq([v.flow.outside.s, v.flow.outside.cents], ["ok", m[8][5] + m[9][5]], "the outside flow is the two outside rows");
  eq(views.get("no-tide").flow.outside, { s: "absent", cents: null, text: DASH, exact: null, line: COPY.FLOW_LINES.outsideAbsent }, "without a tide it is absent, not zero");
  const flip = (t) => (t === "0" || t === "~0" ? t : t.startsWith(MINUS) ? t.slice(1) : MINUS + t);
  for (const [id, view] of views) {
    if (view.status !== "ok") continue;
    view.ledger.net.cells.forEach((c, i) => {
      const bal = view.ledger.rows[10].cells[i];
      if (c.s === "absent") { eq([bal.s, c.r], ["absent", bal.r], `${id}: an absent net cell matches an absent balancing cell`); return; }
      eq([c.t, c.s], [flip(bal.t), bal.s], `${id}: net before balancing is the balancing entry reversed, column ${i + 1}`);
    });
    const tilts = new Map(view.tilt.rows.map((r) => [r.key, r]));
    for (const row of view.sectors.rows) {
      if (row.tilt.verdict === undefined) continue;
      eq([row.tilt.tiltC, row.tilt.bandC], [tilts.get(row.key).r, tilts.get(row.key).w], `${id}: ${row.key} carries the numbers its bar is drawn from`);
    }
  }
  const sec = views.get("sector");
  for (const row of sec.names.rows) if (row.tilt.s === "ok") ok(Number.isSafeInteger(row.tilt.tiltC), "a name's tilt cell carries its number");
  const single = views.get("sector");
  eq(single.checks.items.find((i) => i.id === "sectors"), { id: "sectors", label: "Sectors match", state: "absent", text: COPY.CHECKS.sectors.single, hover: COPY.CHECKS.sectors.hover }, "one scope has nothing to compare, so the check is not claimed");
  eq(views.get("all").checks.items.find((i) => i.id === "stock").text, "Not checked: open interest is not stored.", "the stock identity is neutral wording, not a pass");
  ok(/^Windows and tide are both from Fri 23 Oct\. Tide at \d\d:\d\d TRT, windows at \d\d:\d\d TRT\.$/.test(views.get("all").checks.items.find((i) => i.id === "session").text), "the session check names both stamps");
  ok(/^Rows foot over 11 rows, exactly and as displayed\.$/.test(views.get("all").checks.items[0].text), "rows foot exactly and as displayed");
  ok(/^Balancing entries close all 6 columns; the largest is \$[\d.,]+[kMB]?\.$/.test(views.get("all").checks.items[1].text), "the columns check names the largest balancing entry");
  ok(/^Balancing entries close 4 of 6 columns\. The outside columns are absent\.$/.test(views.get("no-tide").checks.items[1].text), "and says so when the outside columns are absent");
  ok(/^Bought \+ sold \+ no side = total premium, over \d+ windows\.$/.test(views.get("all").checks.items[2].text), "sides name the number of windows");
}

{
  const views = viewsOf();
  let cells = 0;
  const bad = [];
  const parse = (t, unit) => {
    if (t === "~0" || t === "0") return 0;
    const negative = t.startsWith(MINUS);
    const digits = t.replace(MINUS, "").replace(/[+,]/g, "").replace(".", "");
    return (negative ? -1 : 1) * Number(digits);
  };
  for (const [id, v] of views) {
    for (const cell of cellsOf(v)) {
      cells++;
      if (cell.s === "absent") {
        if (cell.t !== DASH || cell.x !== null || typeof cell.r !== "string" || !cell.r.length) bad.push(`${id}: absent cell ${JSON.stringify(cell)}`);
      } else if (cell.s === "zero") {
        if (cell.t !== "0" || !(cell.x === "$0.00" || cell.x === "0" || cell.x === "0%")) bad.push(`${id}: zero cell ${JSON.stringify(cell)}`);
      } else if (cell.s === "tiny") {
        if (cell.t !== "~0" || cell.x === "$0.00") bad.push(`${id}: tiny cell ${JSON.stringify(cell)}`);
      } else if (cell.s === "ok") {
        if (cell.t === DASH || cell.t === "~0" || cell.t === "" || typeof cell.x !== "string") bad.push(`${id}: ok cell ${JSON.stringify(cell)}`);
      } else if (cell.s !== "blank") bad.push(`${id}: unknown state ${cell.s}`);
      if (cell.s !== "absent" && "r" in cell && cell.r) bad.push(`${id}: a reason on a present cell`);
    }
    if (v.status === "ok") {
      const unit = v.ledger.unit;
      const grid = v.ledger.rows.map((r) => r.cells.map((c) => (c.s === "blank" || c.s === "absent" ? 0 : parse(c.t, unit))));
      grid.forEach((row, i) => { if (row.reduce((a, b) => a + b, 0) !== 0) bad.push(`${id}: displayed row ${i + 1} sums to ${row.reduce((a, b) => a + b, 0)}`); });
      for (let c = 0; c < 6; c++) { const s = grid.reduce((a, row) => a + row[c], 0); if (s !== 0) bad.push(`${id}: displayed column ${c + 1} sums to ${s}`); }
      v.ledger.rows.forEach((row, i) => row.cells.forEach((cell, c) => {
        if (cell.x === null) return;
        const exact = (cell.x.startsWith(MINUS) ? -1 : 1) * Number(cell.x.replace(/[^0-9]/g, ""));
        const shown = parse(cell.t, unit);
        if (Math.abs(shown * unit.unitCents - exact) >= unit.unitCents) bad.push(`${id}: r${i + 1}c${c + 1} shows ${cell.t} for ${cell.x}`);
      }));
    }
  }
  eq(bad.slice(0, 5), [], `T8: ${cells} cells across ${views.length} views: absent is a dash with a reason, zero is exact, ~0 is not zero, and the displayed ledger foots`);
}

const BALANCE = { file: "shared/flows-sfc.js", transforms: [["balancing[c] = s === 0n ? 0 : safe(-s);", "balancing[c] = s === 0n ? 0 : safe(-s) + 1;"]] };

const TILT_SUM = { file: "shared/flows-sfc.js", transforms: [["    sum += row.R;", "    sum += row.R + 1n;"]] };

const LEAKS = {
  ledger: { file: "shared/flows-sfc-view.js", transforms: [["checks: { items: checks.items, failed: checks.failed, notes: [] } };", "checks: { items: checks.items, failed: checks.failed, notes: [] }, ledger, sectors, lean } ;".replace("lean } ;", "lean: leanRead({ T: totals.T, A: totals.AC + totals.AP, B: totals.BC + totals.BP }) };")]] },
  tiltSectors: { file: "shared/flows-sfc-view.js", transforms: [["ledger, sectors: sectorsOut, lean:", "ledger, sectors, lean:"]] },
  tiltNames: { file: "shared/flows-sfc-view.js", transforms: [["tilt.unit : unitFor(0), tiltHold);", "tilt.unit : unitFor(0));"]] },
};

const failClosedLedger = (V, input) => {
  const bad = [];
  const view = V.view.ledgerView(input);
  if (view.status !== "failed") bad.push(`status ${view.status}`);
  if (!view.withheld || view.withheld.all !== true || !/^Ledger checks failed; figures withheld; logged as [0-9a-f]{8}\.$/.test(view.withheld.reason)) bad.push("no withheld reason with a hash");
  for (const key of ["ledger", "sectors", "flow", "tilt", "lean", "reading", "stock", "names", "windows"]) if (key in view) bad.push(`${key} is present`);
  if (!view.checks.items.some((i) => i.state === "fail")) bad.push("no failing check named");
  if (view.why !== (view.withheld && view.withheld.reason)) bad.push("why differs from the withheld reason");
  return bad;
};

const failClosedTilt = (V, input) => {
  const bad = [];
  const view = V.view.ledgerView(input);
  if (view.status !== "ok") bad.push(`status ${view.status}`);
  if (view.tilt.status !== "absent" || !/^Tilt did not sum to zero; tilt withheld; logged as [0-9a-f]{8}\.$/.test(view.tilt.reason)) bad.push("tilt not withheld with a hash");
  if (view.checks.items.find((i) => i.id === "tilt").state !== "fail") bad.push("tilt check does not fail");
  for (const r of view.sectors.rows) if (r.tilt.s !== "absent") bad.push(`${r.key} still shows a tilt`);
  if (view.names) for (const r of view.names.rows) if (r.tilt.s !== "absent") bad.push(`${r.label} still shows a tilt`);
  return bad;
};

{
  const w = makeWorld(777, { tickers: 24, perName: 18, pathologies: false });
  const input = storedInput(w);
  const sectorInput = { ...input, scope: { kind: "sector", sector: SECTORS.find((c) => runProduction(w).columns.has(c)), key: "x" } };
  sectorInput.scope.key = "sector:" + sectorInput.scope.sector;
  const closed = await loadVariant(BALANCE, "fail-closed");
  eq(failClosedLedger(closed, input), [], "when the ledger does not close, the page is failed with the logged hash and no figure at all");
  const tilted = await loadVariant(TILT_SUM, "tilt-closed");
  eq(failClosedTilt(tilted, input), [], "a tilt that does not sum to zero withholds the tilt everywhere and fails its check, leaving the ledger standing");
  eq(failClosedTilt(tilted, sectorInput), [], "including the names of a sector");
  eq(tilted.view.ledgerView(input).checks.items.filter((i) => i.state === "fail").map((i) => i.id), ["tilt"], "and only the tilt check fails");
  const leak = await loadVariant([BALANCE, LEAKS.ledger], "leak-ledger");
  ok(failClosedLedger(leak, input).length > 0, "planted: a failed ledger that still sends its figures is caught");
  const leakSectors = await loadVariant([TILT_SUM, LEAKS.tiltSectors], "leak-sectors");
  ok(failClosedTilt(leakSectors, input).length > 0, "planted: a withheld tilt that still shows in the sector table is caught");
  const leakNames = await loadVariant([TILT_SUM, LEAKS.tiltNames], "leak-names");
  ok(failClosedTilt(leakNames, sectorInput).length > 0, "planted: a withheld tilt that still shows in the names table is caught");
}

{
  const big = (cents, extra = {}) => ({
    t: "SYA101", oc: "SYA101261120C00100000", cp: "C", k: 100, exp: "2026-10-23", prem: cents / 100, askPrem: cents / 100, bidPrem: 0, size: 10, px: 5,
    ivStart: 0.4, ivEnd: 0.4, spanStart: "2026-10-23T14:00:00Z", spanEnd: "2026-10-23T14:05:00Z", floor: false, single: true, ...extra,
  });
  const world = makeWorld(1, { tickers: 1, perName: 0, pathologies: false });
  const inputOf = (rows) => {
    const i = storedInput(world);
    return { ...i, live: { ...i.live, payload: { ...i.live.payload, rows, record: { date: world.session, everEntered: rows.length } } }, universe: { t: ["SYA101"], sectors: ["Energy"], sec: [0], cols: { mcap: [5] }, units: { mcap: ["usd", 1e-8] } }, breadth: null };
  };
  const limit = Number.MAX_SAFE_INTEGER;
  const one = ledgerView(inputOf([big(limit)]));
  ok(one.status === "ok" || one.status === "failed", "one window at the safe limit never throws");
  if (one.status === "failed") eq(one.why, COPY.OVERFLOW, "and if it cannot be summed it says so in words");
  const two = ledgerView(inputOf([big(limit - 5), big(limit - 5, { oc: "SYA101261120C00200000" })]));
  eq([two.status, two.why], ["failed", COPY.OVERFLOW], "two windows whose sum leaves the safe integers fail in words, not with a thrown error");
  ok(!JSON.stringify(two).includes("Infinity"), "and no number is infinite");
  eq(JSON.parse(JSON.stringify(ledgerView(inputOf([big(1234567)])))).status, "ok", "an ordinary window builds and survives JSON");
}

{
  const flag = {
    sectorTransfer: [
      "Money moved from Technology into Energy.", "Premium flowed out of Utilities.", "Cash left Healthcare for Energy.", "Healthcare saw outflows.", "Capital rotated from Financials to Tech.",
      "$4M shifted out of Real Estate.", "Dollars moved into Materials.", "Technology inflows rose.", "Funds fled Consumer Cyclical.", "Premium switched from Energy to Utilities.",
    ],
    unsided: ["The unsided premium is large.", "Un-sided premium.", "UNSIDED", "premium un sided"],
    tape: ["Read from the tape.", "The Tape shows it.", "tapes"],
    flowLeaving: ["Flow left the building.", "Premium is leaving.", "Cash leaves the account."],
    modal: ["Energy will rise.", "Premium may fall.", "It could change.", "Takers expect more.", "This is likely.", "A forecast of flows.", "It suggests that sellers lead."],
    tooLong: ["One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen."],
  };
  const fine = [
    "Takers bought 63% of premium with a stated side; bounds 34–80%.", "Rows foot: largest row sum 0 ¢ over 11 rows.", "The ledger records no entries between sectors.",
    "Each sector closes on itself.", "Tilt is exposure, not cash.", "Held-window premium by sector, with the outside remainder.", "Net call premium +$451.9k; net put premium −$98.1k.",
    "Fri 23 May", "Sector tide for 11 of 13 groups.", "Columns on the left list the holders.", "Click the left column to sort.", "A table on the left side of the page.", "Window includes a floor trade",
    "Not a forecast.", "No forecast is made.", "Sector tide ends at 18:25 TRT, before the close.", "Index & ETF has no market-cap weight.", "Technology is above its share.",
    "Money is booked once as paid and once as received.", "Provider premium equals taker premium.", "The tape-free design.".replace("tape-free", "design"),
  ];
  for (const [rule, list] of Object.entries(flag)) for (const s of list) ok(RULES[rule](s) !== null, `${rule} flags ${JSON.stringify(s)}`);
  for (const s of fine) eq(lintSentence(s), [], `no rule flags ${JSON.stringify(s)}`);
  eq(lintSentence("It will rise."), [{ rule: "modal", match: "will" }], "a sentence reports its rule and match");
  eq(lintText("First short one. Second one will fail.\nThird one is fine.").map((h) => h.sentence), ["Second one will fail."], "lintText reports the sentence that failed");
  eq(htmlToText('<p title="Premium left Energy">One <b>two</b></p><script>var tape=1</script>').includes("Premium left Energy"), true, "attribute text is linted too");
  eq(htmlToText("<p>a</p><script>var tape=1</script><style>.tape{}</style><code>tape</code>").includes("tape"), false, "scripts, styles and code are not copy");
  eq(stringLeaves({ a: ["x", { b: "y" }], c: 3 }), ["x", "y"], "string leaves walk objects and arrays");
}

const lintAll = (V) => {
  const C = V.copy;
  const leaves = [];
  for (const [id, v] of viewsOf(V.view.ledgerView)) for (const s of stringLeaves(v)) leaves.push([id, s]);
  const copy = [
    ...stringLeaves(C.INFO), ...stringLeaves(C.NOT_BUILT), ...stringLeaves(C.DELTA_NOTES), ...stringLeaves(C.PANEL_LINES), ...stringLeaves(C.TILT_VERDICT),
    ...stringLeaves(C.COLUMN_COPY), ...stringLeaves(C.ROW_COPY), ...stringLeaves(C.SECTOR_HEADERS), ...stringLeaves(C.EMPTY), ...stringLeaves(C.CHECKS),
    ...stringLeaves(C.NOTES), C.BALANCING_DEFINITION, C.NOT_BUILT_LINE, C.OVERFLOW, C.TITLE,
    ...Object.values(C.TILT_LINES).flatMap((x) => (typeof x === "function" ? [x(1), x(3), x(5), x(79)] : [x])),
    C.CHECKS.rows.pass(11), C.CHECKS.rows.pass(9), C.CHECKS.rows.fail("Calls, ask side", 5), C.CHECKS.columns.pass(6, "$1.2M"), C.CHECKS.columns.pass(4, "$1.2M"), C.CHECKS.columns.fail(7), C.CHECKS.sides.pass(412), C.CHECKS.sides.fail(3), C.CHECKS.sectors.fail(2), C.CHECKS.sectors.pass,
    C.CHECKS.tilt.pass("0", 8), C.CHECKS.tilt.pass("0", 1), C.CHECKS.tilt.fail("+$1.00", 8), C.CHECKS.session.pass("Fri 23 Oct", "17:40 TRT", "17:55 TRT"), C.CHECKS.session.fail("Thu 22 Oct"),
    C.WITHHELD.ledger("deadbeef"), C.WITHHELD.tilt("deadbeef"), C.NOTES.held.text(5, null), C.NOTES.held.text(5, 9), C.NOTES.tide.text(11), C.NOTES.rounding.text("$1M"),
    C.EMPTY.page.pending("Intraday"), C.EMPTY.page.quiet("Intraday"), C.EMPTY.page.failed("17:55 TRT"), C.EMPTY.page.unavailable("Five sessions", "Daily ledgers are not archived yet."),
    C.SCOPE_LINE.all("$1.00M", 10, 2, 12), C.SCOPE_LINE.all("$1.00M", 10, null, null), C.SCOPE_LINE.sector("$1.00M", 4, "Energy", 3), C.SCOPE_LINE.name("$1.00M", 4, "SYA101", null),
    ...Object.values(C.FLOW_LINES).flatMap((x) => (typeof x === "function" ? [x("$8.67M")] : [x])), C.KEY_LINE, C.ZERO_LINE, C.centsText(-1234),
  ];
  const hits = [...leaves, ...copy.map((s) => ["copy", s])].flatMap(([id, s]) => lintText(s).map((h) => ({ id, rule: h.rule, match: h.match, sentence: h.sentence })));
  return { hits, count: leaves.length + copy.length };
};

{
  const base = lintAll(await loadVariant());
  eq(base.hits.map((h) => `${h.id}: ${h.rule} ${JSON.stringify(h.match)} :: ${h.sentence.slice(0, 120)}`), [], `T11: ${base.count} strings of the view and the copy pass every rule: no unsided, no tape, no sector transfer, nothing leaving, no forecast words, sentences of at most fourteen words`);
  ok(base.count > 2000, "and the view is large enough for that to mean something");
  const COPY_FILE = "shared/flows-sfc-copy.js";
  const planted = [
    ["unsided", COPY_FILE, [["This page is a closed ledger of option premium in held windows.", "This page is a closed ledger of unsided option premium in held windows."]]],
    ["sectorTransfer", COPY_FILE, [["Closes each column; defined, not observed.", "Premium moved from Technology to Energy; defined, not observed."]]],
    ["modal", COPY_FILE, [["Tilt compares each sector to its weight share, so tilts cancel.", "Tilt will compare each sector to its weight share, so tilts cancel."]]],
    ["tooLong", COPY_FILE, [["(total === null || shed === 0 ? `${money} traded in ${held} held windows.`", "(total === null || shed === 0 ? `${money} of option premium traded in ${held} held windows across every sector in the universe today.`"]]],
    ["tape", COPY_FILE, [["Held windows only: the other side of each taker trade.", "Held windows only: the other side of each taker trade on the tape."]]],
    ["flowLeaving", COPY_FILE, [["Outside rows are the sector tide less held windows.", "Premium left held windows as outside rows."]]],
  ];
  for (const [rule, file, transforms] of planted) {
    const V = await loadVariant({ file, transforms }, "lint-" + rule);
    ok(lintAll(V).hits.some((h) => h.rule === rule), `planted copy that breaks ${rule} is caught`);
  }
  const unitPlants = [
    ["a step label with decimals", "shared/flows-sfc-display.js", [["step >= 1e6 ? `$${step / 1e6}M`", "step >= 1e6 ? `$${(step / 1e6).toFixed(2)}M`"]], (V) => V.display.unitFor(1e11).stepLabel === "$1M"],
    ["a TRT that is two hours ahead", "shared/flows-sfc-time.js", [["export const TRT_MS = 3 * 3600 * 1000;", "export const TRT_MS = 2 * 3600 * 1000;"]], (V) => V.time.trtStamp(Date.parse("2026-10-23T14:55:00Z")) === "17:55 TRT"],
    ["an Eastern close taken as 20:00 UTC all year", "shared/flows-sfc-time.js", [["sessionClose(d, clock) <= at", "Date.parse(d + \"T20:00:00Z\") <= at"]], (V) => V.time.lastCompletedSession(Date.parse("2025-11-03T20:59:59Z")) === "2025-10-31"],
    ["a weekday label one day late", "shared/flows-sfc-time.js", [["return p ? `${WEEKDAYS[p.w]} ${p.d} ${MONTHS[p.m]}` : null;", "return p ? `${WEEKDAYS[(p.w + 1) % 7]} ${p.d} ${MONTHS[p.m]}` : null;"]], (V) => V.time.dayLabel("2025-11-03") === "Mon 3 Nov"],
    ["a five-session window of four", "shared/flows-sfc-time.js", [["out.length < 5 && i < 40", "out.length < 4 && i < 40"]], (V) => V.time.expectedFive("2025-10-31") !== null],
  ];
  for (const [title, file, transforms, holds] of unitPlants) {
    const original = await loadVariant();
    ok(holds(original), `${title}: the committed build holds`);
    const V = await loadVariant({ file, transforms }, "u-" + title);
    ok(!holds(V), `planted: ${title} is caught`);
  }
}

console.log(`✓ flows-sfc-view: ${checks} assertions`);
