import assert from "node:assert/strict";
import { makeWorld } from "./sfc-world.mjs";
import { oracleRun } from "./sfc-compare.mjs";
import { workedExample, tiltGolden, GOLDEN_SESSION, win } from "./sfc-golden.mjs";
import { storedInput, NOW_INTRADAY } from "./sfc-stored.mjs";

const eq = (a, b, m) => assert.deepEqual(a, b, m);

const bookAll = (M, rows, universe, extra = {}) => {
  const uni = M.sfc.readUniverse(universe);
  const out = M.sfc.bookWindows(rows, { column: uni.columnOf, session: GOLDEN_SESSION, ...extra });
  const columns = new Map();
  for (const c of M.sfc.COLUMNS) { const t = M.sfc.sumBooks(out.books, (b) => b.column === c); if (t.n > 0) columns.set(c, t); }
  return { uni, ...out, columns, all: M.sfc.sumBooks(out.books) };
};

const oneUniverse = { t: ["SYA101", "SYB102"], sectors: ["Energy"], sec: [0, 0], cols: { mcap: [1000, 500] }, units: { mcap: ["usd", 1e-8] } };

export const CHECKS = {
  "ingest.strings": (M) => {
    const c = (v) => (M.sides.centsOf(v) || {}).cents;
    eq([c("0.57"), c("2.665"), c("1.125"), c("1.015"), c("0.005"), c("2.675"), c("12.355"), c(1234.57), c("0.07")], [57, 266, 112, 102, 0, 268, 1236, 123457, 7], "ingest strings, half-even on the decimal digits");
    eq([c("1.115"), c("1.105")], [112, 110], "ties go to the even cent");
  },
  "ingest.sum-exact": (M) => {
    const rows = Array.from({ length: 200000 }, (_, i) => win("SYA101", "C", 1234.57, 1000, 200, { tag: "r" + i, minute: 600 + (i % 300) }));
    const { totals } = M.sides.tally(rows.map(M.sides.windowEntry));
    eq(totals.T, 200000 * 123457, "two hundred thousand premiums of $1,234.57 add up to the cent");
    const g = bookAll(M, rows, oneUniverse);
    eq(g.all.T, 200000 * 123457, "and through the books");
  },
  "sides.windows": (M) => {
    const e = (p, a, b, x = {}) => M.sides.windowEntry({ prem: p, askPrem: a, bidPrem: b, ...x });
    eq([e(1000, 600, 400).ok, e(1000, 600, 400).U, e(1000, 600, 400).reason], [true, 0, null], "sides equal to the premium are valid and leave nothing");
    eq(e(1000, 600, 400.01).ok, false, "a cent over is invalid and excluded");
    eq(e(1000, 600, 400.01).why, "sides", "named sides");
    const ns = e(1000, 600, null);
    eq([ns.A, ns.B, ns.U, ns.reason], [0, 0, 100000, "ns"], "an absent side books the whole premium to ns");
    eq(e(1000, 600, 300, { single: false, floor: true }).reason, "leg", "multi-leg outranks floor");
    eq(e(1000, 600, 300, { floor: true }).reason, "cross", "floor");
    eq(e(1000, 600, 300).reason, "btw", "the rest");
    const pro = e(100, 30, 10);
    eq([pro.A, pro.B, pro.U], [3000, 1000, 6000], "premium with no side is not split pro rata: T=100, A=30, B=10 leaves 60 aside");
  },
  "lean.read": (M) => {
    const r = M.sides.leanRead({ T: 145000000, A: 90000000, B: 30000000 });
    eq([r.pct.lo, r.pct.hi, r.pct.share, r.pct.coverage, r.side], [62, 80, 75, 83, "buyers"], "the worked lean");
    const sim = M.sides.leanRead({ T: 110000000, A: 29000000, B: 81000000 });
    eq([sim.side, sim.pct.share], ["sellers", 26], "pooled, not the mean of window shares (Simpson)");
    eq(M.sides.leanRead({ T: 100000000, A: 30000000, B: 10000000 }).why, null, "exactly 40% stated passes the coverage gate");
    eq(M.sides.leanRead({ T: 100000000, A: 30000000, B: 9999999 }).why, "lowCoverage", "a cent under is gated");
    eq(M.sides.leanRead({ T: 100000000, A: 30000000, B: 10000000 }).pct.share, 75, "exactly at the line it passes");
    eq(M.sides.leanRead({ T: 1000000, A: 500000, B: 500000 }).why, "smallClassified", "under $250k stated is gated");
    eq(M.sides.leanRead({ T: 50000000, A: 25000000, B: 0 }).side, "undetermined", "exactly half the total is not buyers");
    eq(M.sides.leanRead({ T: 50000000, A: 25000001, B: 0 }).side, "buyers", "a cent over is");
  },
  "golden.worked": (M) => {
    const g = workedExample();
    const b = bookAll(M, g.rows, g.universe);
    const outside = M.sfc.outsideAll(b.columns, new Map([["Energy", g.tide.Energy]]));
    const m = M.sfc.buildMatrix(b.all, outside);
    eq(m.rows, g.expected.rows, "the worked example matrix");
    eq(M.sfc.matrixSums(m), { rowSums: Array(11).fill(0), colSums: Array(6).fill(0) }, "every row and column sums to zero");
  },
  "golden.no-tide": (M) => {
    const g = workedExample();
    const b = bookAll(M, g.rows, g.universe);
    const outside = M.sfc.outsideAll(b.columns, new Map());
    eq(outside, null, "no tide, no outside figure");
    const m = M.sfc.buildMatrix(b.all, outside);
    eq([m.rows[8], m.rows[9], m.absentOutside], [[null, null, null, null, null, null], [null, null, null, null, null, null], true], "rows 9 and 10 are absent, not zero");
    eq([m.rows[10][4], m.rows[10][5]], [null, null], "and the balancing entries of the outside columns are absent too");
    eq(m.rows[10].slice(0, 4), [60000000, -60000000, 25000000, -25000000], "the balancing row closes the four measured columns");
  },
  "golden.fund-no-tide": (M) => {
    const g = workedExample();
    const rows = [...g.rows, win("SPY", "C", 5000, 3000, 1000, { tag: "fund" })];
    const b = bookAll(M, rows, g.universe);
    const outside = M.sfc.outsideAll(b.columns, new Map([["Energy", g.tide.Energy]]));
    eq([outside.calls, outside.puts], [50000000, -5000000], "held flow in Index & ETF with no tide leaves the outside rows on the tide sectors only");
  },
  "golden.tilt": (M) => {
    const g = tiltGolden();
    const b = bookAll(M, g.rows, g.universe, { deltaMicro: (r) => r.d });
    const t = M.sfc.tiltOf(b.columns, b.uni.weights);
    eq(t.total, g.expected.total, "tilt total over weighted columns");
    for (const c of t.weighted) {
      const r = t.rows.get(c);
      eq([r.a, r.R, r.W, r.verdict], [g.expected.a[c], g.expected.R[c], g.expected.W[c], g.expected.verdict[c]], "tilt of " + c);
    }
    eq(t.sum, 0n, "sums to zero");
  },
  "golden.no-delta-band": (M) => {
    const g = tiltGolden();
    const b = bookAll(M, g.rows, g.universe, { deltaMicro: (r) => r.d });
    eq(b.columns.get("Energy").Ub, 52000000n, "a window without a delta widens the band by its whole possible exposure");
  },
  "golden.apportion": (M) => {
    const exact = (x, w) => {
      const sum = w.reduce((a, b) => a + BigInt(b), 0n);
      const out = w.map((v) => (x * BigInt(v)) / sum);
      let left = x - out.reduce((a, b) => a + b, 0n);
      const rem = w.map((v) => (x * BigInt(v)) % sum);
      while (left > 0n) { let best = 0; rem.forEach((r, i) => { if (r > rem[best]) best = i; }); out[best] += 1n; rem[best] = -1n; left -= 1n; }
      return out;
    };
    const big = 123456789012345678901n;
    eq(M.sfc.apportion(big, [3, 5, 7]), exact(big, [3, 5, 7]), "a total of 1.2e20 over weights 3, 5, 7 is exact");
    eq(M.sfc.apportion(2, [1, 1, 1]), [1n, 1n, 0n], "ties by column order");
    eq(M.sfc.apportion(-2, [1, 1, 1]), [-1n, -1n, 0n], "sign symmetric");
    eq(M.sfc.apportion(9007199254740993n, [1, 1]), [4503599627370497n, 4503599627370496n], "exact beyond 2^53");
  },
  "golden.delta-sign": (M) => {
    const row = { t: "SYA101", cp: "P", k: 100, exp: "2026-11-20", px: 100, ivEnd: 0.4, spanStart: "2026-10-23T14:00:00Z", spanEnd: "2026-10-23T14:05:00Z" };
    const p = M.sfc.deltaMicroOf(row);
    ok(p < 0 && p > -1000000, "a put has a negative delta");
    const rows = [{ ...win("SYA101", "P", 10000, 8000, 1000, { tag: "p" }), size: 100, px: 100, ivEnd: 0.4, exp: "2026-11-20" }];
    const b = bookAll(M, rows, oneUniverse, { deltaMicro: M.sfc.deltaMicroOf });
    ok(b.all.X < 0n, "puts bought on initiative are short delta");
  },
  "golden.session-key": (M) => {
    const rows = [
      { ...win("SYA101", "C", 1000, 600, 200, { tag: "s1" }), spanStart: "2025-11-03T21:10:00Z", spanEnd: "2025-11-03T21:15:00Z" },
      { ...win("SYA101", "C", 1000, 600, 200, { tag: "s2" }), spanStart: "2025-10-31T21:10:00Z", spanEnd: "2025-10-31T21:15:00Z" },
      { ...win("SYA101", "C", 1000, 600, 200, { tag: "s3" }), spanStart: "2025-11-03T15:00:00Z", spanEnd: "2025-11-03T15:05:00Z" },
    ];
    const uni = M.sfc.readUniverse(oneUniverse);
    const { counts } = M.sfc.bookWindows(rows, { column: uni.columnOf, session: "2025-11-03" });
    eq([counts.booked, counts.offSession], [2, 1], "a winter window after 16:00 New York time (00:10 TRT next day) belongs to the New York trade date");
  },
  "golden.repoll": (M) => {
    const g = workedExample();
    const once = bookAll(M, g.rows, g.universe).all;
    const twice = bookAll(M, [...g.rows, ...g.rows.map((r) => ({ ...r, lastAt: "2026-10-23T15:10:00Z", reads: 2 })), ...g.rows], g.universe);
    eq(twice.all.T, once.T, "a re-polled window counts once");
    eq(twice.counts.duplicate, 12, "and the re-polls are counted");
  },
  "golden.change-in-order": (M) => {
    const a = win("SYA101", "C", 1000, 600, 200, { tag: "x", lastAt: "2026-10-23T15:00:00Z" });
    const b = { ...a, prem: 2000, askPrem: 1500, bidPrem: 100, lastAt: "2026-10-23T15:15:00Z" };
    const t1 = bookAll(M, [a, b], oneUniverse).all.T;
    const t2 = bookAll(M, [b, a], oneUniverse).all.T;
    eq([t1, t2], [200000, 200000], "a re-poll that changes a value: the later read wins whatever the order");
  },
  "golden.mean-of-ratios": (M) => {
    const rows = [win("SYA101", "C", 1000000, 200000, 800000, { tag: "m1" }), win("SYB102", "C", 100000, 90000, 10000, { tag: "m2" })];
    const input = storedInput(makeWorld(1, { tickers: 1, perName: 0, pathologies: false }));
    const live = { ...input.live, payload: { ...input.live.payload, rows, record: { date: "2026-10-23", everEntered: 2 } } };
    const view = M.view.ledgerView({ ...input, live, breadth: null, universe: oneUniverse });
    eq([view.lean.side, view.lean.pct.share], ["sellers", 26], "the all-scope lean is the pooled ratio");
  },
  "period.close": (M) => {
    const live = { session: "2025-11-03", readAt: Date.parse("2025-11-04T00:55:00Z") };
    const plan = M.time.periodPlan({ at: Date.parse("2025-11-04T01:00:00Z"), live, nightly: null });
    eq(plan.intraday.ok, false, "after the 16:00 close (00:00 TRT) Intraday is not offered");
    const open = M.time.periodPlan({ at: Date.parse("2025-11-03T20:59:59Z"), live: { session: "2025-11-03", readAt: Date.parse("2025-11-03T20:58:00Z") }, nightly: null });
    eq(open.intraday.ok, true, "one second before the close it is");
  },
  "period.age": (M) => {
    const at = Date.parse("2026-10-23T15:00:00Z");
    eq(M.time.periodPlan({ at, live: { session: "2026-10-23", readAt: at - 1800000 }, nightly: null }).intraday.ok, true, "a live read exactly thirty minutes old is shown");
    eq(M.time.periodPlan({ at, live: { session: "2026-10-23", readAt: at - 1800001 }, nightly: null }).intraday.ok, false, "a millisecond older is not");
  },
  "period.session": (M) => {
    const plan = M.time.periodPlan({ at: Date.parse("2025-11-03T07:00:00Z"), live: null, nightly: { session: "2025-10-30", readAt: Date.parse("2025-10-31T02:00:00Z") } });
    eq(plan.last, "2025-10-31", "the last completed session is Friday 31 October");
    eq(plan.session.ok, false, "a nightly row of Thursday 30 October is not the session of Friday 31 October");
    const early = M.time.periodPlan({ at: Date.parse("2025-11-03T21:30:00Z"), live: null, nightly: { session: "2025-10-31", readAt: Date.parse("2025-11-01T02:00:00Z") } });
    eq([early.last, early.session.ok], ["2025-11-03", false], "just after the close, before the nightly: not the session before");
  },
  "period.five": (M) => {
    const exp = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
    const mk = (d) => ({ date: d, matrix: Array.from({ length: 11 }, () => [1, 1, 1, 1, 1, 1]), tilt: { Energy: 5 } });
    eq(M.time.sumSessions({ expected: exp, ledgers: exp.slice(0, 4).map(mk), archived: true }).status, "absent", "four ledgers do not make five sessions");
    eq(M.time.sumSessions({ expected: exp, ledgers: exp.slice(0, 4).map(mk), archived: true }).reason, "1 of 5 sessions not stored, oldest Fri 23 Oct.", "the reason names the count and the oldest date");
    eq(M.time.sumSessions({ expected: exp, ledgers: exp.map(mk), archived: true }).status, "ok", "five do");
  },
  "display.unit": (M) => {
    const u = (c) => M.display.unitFor(c).e;
    eq([u(99900), u(100000), u(1000000), u(5679000000), u(2e14)], [0, 0, 1, 4, 7], "unit exponent by the digits of the largest cell: $999 and $1,000 are $1, $10,000 is $10, $56.79M is $10k, $2T clamps");
    eq(M.display.unitFor(-1234567800).e, M.display.unitFor(1234567800).e, "the unit follows the absolute value");
  },
  "display.tiny": (M) => {
    const unit = M.display.unitFor(1000000);
    eq([M.display.cellText(0, 0, unit), M.display.cellText(30, 0, unit), M.display.cellText(30, 1, unit), M.display.cellText(-123400, -123, unit)], ["0", "~0", "0.01", "−1.23"], "an exact zero is 0, a nonzero that rounds to zero is ~0");
  },
  "display.round-foots": (M) => {
    const unit = { unitCents: 10, e: 0 };
    const r = M.display.roundGrid([[4, 4, -8], [4, 4, -8], [-8, -8, 16]], unit);
    for (const row of r.cells) eq(row.reduce((a, b) => a + b, 0), 0, "a rounded row sums to zero");
    for (let j = 0; j < 3; j++) eq(r.cells.reduce((a, row) => a + row[j], 0), 0, "a rounded column sums to zero");
  },
  "display.view-unit": (M) => {
    const g = workedExample();
    const world = makeWorld(5, { tickers: 1, perName: 0, pathologies: false });
    world.tide = { Energy: { calls: -9000000000, puts: 0 } };
    const input = storedInput(world);
    input.live = { ...input.live, payload: { ...input.live.payload, rows: g.rows, record: { date: world.session, everEntered: g.rows.length } } };
    input.universe = g.universe;
    const view = M.view.ledgerView(input);
    eq(view.status, "ok", "the view builds");
    eq(view.sectors.unit.e, 4, "a table whose largest cell is a large negative outside figure takes its unit from the absolute value");
  },
  "shed.count": (M) => {
    const w = makeWorld(3, { tickers: 4, perName: 5, pathologies: false });
    const input = storedInput(w, { shed: 0 });
    input.live.payload.record = { date: w.session, everEntered: input.live.payload.rows.length + 7, shed: 1 };
    const view = M.view.ledgerView(input);
    eq(view.scope.shed, 7, "shed is everEntered less the rows held");
  },
  "tilt.gate": (M) => {
    const mk = (covered) => {
      const columns = new Map([["Energy", { ...M.sfc.emptyTotals(), n: 1, sided: 100, covered, X: 0n, Ub: 0n }]]);
      return M.sfc.tiltCoverage(columns, new Map([["Energy", 5]])).passes;
    };
    eq([mk(80), mk(79)], [true, false], "delta coverage exactly 80% passes, 79% does not");
  },
  "world.oracle": (M) => {
    for (let seed = 1; seed <= 120; seed++) {
      const w = makeWorld(seed, { tight: seed % 4 === 0 });
      const mod = { ...M.sfc, leanRead: M.sides.leanRead };
      const bad = (compareWorld(w, mod));
      assert.deepEqual(bad, [], `seed ${seed}`);
    }
  },
};

import { compareWorld } from "./sfc-compare.mjs";

function ok(c, m) { assert.ok(c, m); }

export async function runBattery(M, only = null) {
  const failed = [];
  for (const [id, check] of Object.entries(CHECKS)) {
    if (only && !only.includes(id)) continue;
    try { await check(M); } catch (error) { failed.push({ id, error: String(error && error.message ? error.message : error).slice(0, 160), thrown: !(error instanceof assert.AssertionError) }); }
  }
  return failed;
}

export { oracleRun, NOW_INTRADAY };
