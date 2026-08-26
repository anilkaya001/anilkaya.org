/* =============================================================
   flows-record-contract.mjs — the track-record scorer.

   Every fixture here is built so the CORRECT answer differs from the
   NAIVE one — a scorer that zero-fills attrition, walks calendar
   days instead of trading sessions, or publishes a Pearson where it
   claims a Spearman must fail a named assertion, not drift by a
   rounding.
   ============================================================= */
import assert from "node:assert/strict";
import {
  tradingCalendar, forwardClose, scoreSessionAt, scoreSessions,
  featureColumnsOf, icTable, RECORD_NOTES,
} from "../shared/flows-record.js";
import { pearson, percentileRank } from "../shared/flows-features.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const close = (a, b, msg, tol = 1e-9) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b})`);
  checks++;
};

const closesOf = (spec) => {
  const m = new Map();
  for (const [t, dated] of Object.entries(spec)) m.set(t, new Map(Object.entries(dated)));
  return m;
};
const idx = (cal) => new Map(cal.map((d, i) => [d, i]));

/* ---------- the calendar is observed, not assumed ----------------- */
{
  const cal = tradingCalendar([
    ["2026-08-07", "2026-08-06", "2026-08-06"],           // unordered, duplicated
    ["2026-08-10", "not-a-date", "2026-8-9"],             // malformed entries drop
    null,                                                  // a missing set is not an error
  ]);
  assert.deepEqual(cal, ["2026-08-06", "2026-08-07", "2026-08-10"],
    "the calendar is the sorted union of well-formed observed dates"); checks++;

  /* THE HOLIDAY GAP IS THE POINT. From Friday the 7th, one session later is
     Monday the 10th. Naive calendar-day arithmetic answers the 8th — a
     Saturday with no close — and a scorer built on it either loses every
     Friday session or, worse, scores it against the wrong day. */
  const closes = closesOf({ T: { "2026-08-10": 110 } });
  const fc = forwardClose(closes, cal, idx(cal), "T", "2026-08-07", 1);
  eq(fc.state, "ok", "one session after a Friday is the next OBSERVED date");
  eq(fc.date, "2026-08-10", "which is Monday, across the weekend gap");
  eq(fc.exit, 110, "with Monday's close");

  const beyond = forwardClose(closes, cal, idx(cal), "T", "2026-08-10", 1);
  eq(beyond.state, "unclosed",
     "a horizon past the calendar's end is UNCLOSED — a fact about time, not about the name");
  const gone = forwardClose(closes, cal, idx(cal), "T", "2026-08-06", 1);
  eq(gone.state, "lost",
     "while a missing close on an existing exit date is attrition");
}

/* ---------- attrition is excluded, never zero-filled -------------- */
{
  const cal = ["2026-08-03", "2026-08-04"];
  const rowsBySide = {
    long: [{ t: "A", px: 100 }, { t: "B", px: 50 }, { t: "GONE", px: 10 }],
    short: [{ t: "C", px: 200 }],
  };
  const closes = closesOf({
    A: { "2026-08-04": 104 },      // +4%
    B: { "2026-08-04": 51 },       // +2%
    C: { "2026-08-04": 196 },      // -2%
    /* GONE has no close on the exit date. Zero-filling it would report a
       long leg of (4 + 2 + 0) / 3 = 2%; the survivors' truth is 3%. The
       one-point gap IS the assertion. */
  });
  const s = scoreSessionAt(rowsBySide, closes, cal, idx(cal), "2026-08-03", 1);
  eq(s.state, "ok", "the session scores");
  close(s.long, 0.03, "THE MEAN IS OVER THE SURVIVORS: a departed name is excluded, not scored as 0%");
  close(s.short, -0.02, "the short leg is its own mean");
  close(s.ls, 0.05, "and the spread is long minus short");
  eq(s.lost, 1, "while the departed name is COUNTED — attrition is data quality, not noise");
  eq(s.names, 4, "over the full published name count");
  /* hit: A rose (+), B rose (+), C fell while shorted (+) => 3 of 3 measured. */
  close(s.hit, 1, "the hit rate is over measured names only");
}

/* ---------- a flat close is a miss, not a half-hit ---------------- */
{
  const cal = ["2026-08-03", "2026-08-04"];
  const closes = closesOf({ A: { "2026-08-04": 100 }, C: { "2026-08-04": 190 } });
  const s = scoreSessionAt(
    { long: [{ t: "A", px: 100 }], short: [{ t: "C", px: 200 }] },
    closes, cal, idx(cal), "2026-08-03", 1);
  close(s.hit, 0.5, "a name that closed exactly flat is a MISS: the board leaned and the price did not follow");
}

/* ---------- a one-legged spread is withheld ----------------------- */
{
  const cal = ["2026-08-03", "2026-08-04"];
  const closes = closesOf({ A: { "2026-08-04": 105 } });
  const s = scoreSessionAt(
    { long: [{ t: "A", px: 100 }], short: [{ t: "GONE", px: 50 }] },
    closes, cal, idx(cal), "2026-08-03", 1);
  close(s.long, 0.05, "the surviving leg still reports");
  eq(s.short, null, "the fully-attrited leg is null");
  eq(s.ls, null,
     "and the SPREAD is withheld: publishing one leg as long-minus-short would relabel " +
     "a one-sided return as a spread");
  close(s.hit, 1, "while hit still reports over the one measured name — a withheld spread does not withhold the tape");
}

/* ---------- scoreSessions: horizons count SESSIONS ---------------- */
{
  /* Calendar of six sessions; boards on the first three. At k=1 all three
     have closed; at k=5 ONLY the first has — the sixth calendar session is
     exactly five from it and beyond the other two. n must say so — a
     scorer that counts rows, or counts unclosed sessions, reports evidence
     it does not have. */
  const cal = ["d1", "d2", "d3", "d4", "d5", "d6"].map((_, i) => `2026-08-0${i + 1}`);
  const px = { A: 100, C: 200 };
  const mkBoards = (d) => ([
    { d, side: "long", rows: [{ t: "A", px: px.A }] },
    { d, side: "short", rows: [{ t: "C", px: px.C }] },
  ]);
  const boards = [...mkBoards("2026-08-01"), ...mkBoards("2026-08-02"), ...mkBoards("2026-08-03")];
  const closes = closesOf({
    A: { "2026-08-02": 102, "2026-08-03": 104, "2026-08-04": 106, "2026-08-05": 108, "2026-08-06": 110 },
    C: { "2026-08-02": 198, "2026-08-03": 196, "2026-08-04": 194, "2026-08-05": 192, "2026-08-06": 190 },
  });
  const rec = scoreSessions(boards, closes, cal, { horizons: [1, 5], statedK: 1, maxSessions: 30 });
  eq(rec.retained, 3, "three sessions retained");
  eq(rec.firstSession, "2026-08-01", "first stated");
  eq(rec.lastSession, "2026-08-03", "last stated");
  const h1 = rec.horizons.find((h) => h.k === 1);
  const h5 = rec.horizons.find((h) => h.k === 5);
  eq(h1.n, 3, "at one session every board has closed");
  eq(h5.n, 1, "at five sessions only the FIRST board has closed — n counts closed sessions");
  /* First board at k=5: A 100→110 (+10%), C 200→190 (−5%) → spread +15%. */
  close(h5.ls, 0.15, "and its mean is that one session's own spread, not diluted by unclosed ones", 1e-4);
  eq(rec.sessions.length, 3, "the table lists the sessions closed at the stated horizon");
  eq(rec.sessions[0].d, "2026-08-03", "newest first");
  /* A board published at d=2026-08-01: A 100->102 (+2%), C 200->198 (-1%). */
  close(rec.sessions[2].ls, 0.03, "and each row's spread is the arithmetic of its own closes", 1e-4);
}

/* ---------- featureColumnsOf: schema-driven, with two exclusions -- */
{
  const cols = featureColumnsOf({
    t: "A", r: 3, px: 101.5, s: 42, cnv: 70, chg: 0.01,
    gRegime: "short", spark: "abc",
    fam: { F: 10, P: -5, D: null, V: 0, O: 38 },
    pr: [120, null, -80],
    netPrem: 1e6,
  });
  eq(cols.r, undefined, "the published rank is excluded: it is the score's ordering restated");
  eq(cols.px, undefined, "the price level is excluded: across names it ranks share prices");
  eq(cols.s, 42, "numeric keys become columns");
  eq(cols["fam.F"], 10, "fam explodes to fam.*");
  eq(cols["fam.D"], undefined, "a null family value contributes nothing");
  eq(cols["pr.0"], 120, "pr explodes to pr.*");
  eq(cols["pr.1"], undefined, "with nulls dropped");
  eq(cols.gRegime, undefined, "strings have no number to contribute");
}

/* ---------- icTable: Spearman by construction --------------------- */
{
  /* Ten boards on one date each; feature x ranks the names 1..10 and the
     forward return agrees in RANK on every name — but one name's return is
     a 40% takeover print. Raw Pearson on these pairs is dominated by that
     outlier (it reads ~0.62); the rank correlation is exactly 1. The gap
     between those two numbers is what this fixture exists to measure. */
  const cal = ["2026-08-03", "2026-08-04"];
  const rows = [];
  const closesSpec = {};
  const returns = [-0.02, -0.01, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.40];
  returns.forEach((r, i) => {
    const t = "T" + i;
    rows.push({ t, px: 100, s: i + 1 });
    closesSpec[t] = { "2026-08-04": 100 * (1 + r) };
  });
  const boards = [{ d: "2026-08-03", side: "long", rows }];
  const table = icTable(boards, closesOf(closesSpec), cal,
    { k: 1, minN: 5, pearson, percentileRank });
  const sCol = table.cols.find((c) => c.key === "s");
  eq(sCol.n, 10, "all ten pairs measured");
  close(sCol.ic, 1, "a monotone relation scores IC exactly 1 — the takeover return moved nothing", 1e-9);
  const rawRho = pearson(rows.map((r) => r.s), returns);
  ok(rawRho < 0.9,
     `the fixture is doing its job: raw Pearson here is ${rawRho.toFixed(2)}, ` +
     "so swapping the rank step for raw correlation cannot survive the exact-1 assertion");
}

/* ---------- icTable: null with a reason, never zero --------------- */
{
  const cal = ["2026-08-03", "2026-08-04"];
  const rows = Array.from({ length: 8 }, (_, i) => ({
    t: "T" + i, px: 100, s: i, purity: 0.5,             // purity CONSTANT across the pool
  }));
  const closesSpec = {};
  rows.forEach((r, i) => { closesSpec[r.t] = { "2026-08-04": 100 + i }; });
  const table = icTable([{ d: "2026-08-03", side: "long", rows }], closesOf(closesSpec), cal,
    { k: 1, minN: 5, pearson, percentileRank });

  const purity = table.cols.find((c) => c.key === "purity");
  eq(purity.ic, null, "A CONSTANT COLUMN HAS NO RANKING TO CORRELATE — null, not NaN and not 0");
  ok(/no variation/.test(purity.reason), "and it says why");

  const starved = icTable([{ d: "2026-08-03", side: "long", rows: rows.slice(0, 3) }],
    closesOf(closesSpec), cal, { k: 1, minN: 20, pearson, percentileRank });
  const sCol = starved.cols.find((c) => c.key === "s");
  eq(sCol.ic, null, "below the floor the coefficient is withheld");
  eq(sCol.n, 3, "with the sample it would have been measured on stated");
  ok(/fewer than 20/.test(sCol.reason), "and the floor named");
}

/* ---------- attrition rows drop out of the IC pool ---------------- */
{
  const cal = ["2026-08-03", "2026-08-04"];
  const rows = [
    { t: "A", px: 100, s: 1 }, { t: "B", px: 100, s: 2 },
    { t: "C", px: 100, s: 3 }, { t: "GONE", px: 100, s: 99 },
  ];
  const closes = closesOf({
    A: { "2026-08-04": 101 }, B: { "2026-08-04": 102 }, C: { "2026-08-04": 103 },
  });
  const table = icTable([{ d: "2026-08-03", side: "long", rows }], closes, cal,
    { k: 1, minN: 3, pearson, percentileRank });
  const sCol = table.cols.find((c) => c.key === "s");
  eq(sCol.n, 3, "a name with no exit close contributes NO pair — n is the measured count");
  close(sCol.ic, 1, "and the measured pairs alone carry the coefficient");
}

/* ---------- the notes are pinned ---------------------------------- */
{
  ok(/spearman = pearson\(percentileRank/.test(RECORD_NOTES.method),
     "the method statement names the construction");
  ok(/conditional\s+on selection/.test(RECORD_NOTES.selection),
     "the selection caveat is stated");
  ok(/n\/10/.test(RECORD_NOTES.overlap), "the overlap deflation is stated");
  ok(/union of observed close dates/.test(RECORD_NOTES.calendar),
     "the calendar convention is stated");
  ok(/never scored as zero/.test(RECORD_NOTES.attrition),
     "the attrition rule is stated");
}

console.log(`✓ flows-record: ${checks} assertions — a calendar that skips what was never open, ` +
  `attrition excluded from every mean and counted beside it, a spread that refuses one leg, ` +
  `horizons that count sessions rather than rows, and an IC that is Spearman by construction ` +
  `with null-and-reason where there is nothing to measure`);
