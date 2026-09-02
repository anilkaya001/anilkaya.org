/* =============================================================
   flows-overlay-contract.mjs — the date join, on inputs a reader
   can check by hand.

   THE DEFECT THIS SUITE EXISTS TO MAKE IMPOSSIBLE has never
   shipped, and that is the only reason it is worth this much
   test. Two series arrive from two payloads. Both are about forty
   points. Both run oldest first. Zipping them by position produces
   a chart that is smooth, plausible, correctly shaped, and about
   two different sets of days — and it would look correct on every
   name, every session, until somebody read a date off it.

   There is no visual symptom to catch it. So the join is a named
   function and this file checks it against inputs small enough to
   verify with a finger on the screen, plus the emitted corpus for
   the shape it actually meets.
   ============================================================= */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { joinScoreToPrice, scoreRowFor, OVERLAY_NOTES } from "../shared/flows-overlay.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

/* ---------- 1. the join is by date, provably ---------------------- */
{
  /* THE FIXTURE IS BUILT SO THAT AN INDEX JOIN AND A DATE JOIN GIVE
     DIFFERENT ANSWERS, which is the only fixture shape that can tell them
     apart. The price window starts two sessions before the score window, so
     position 0 on one side is not position 0 on the other. A renderer zipping
     by index would pair 10.0 with 40 and pass every other assertion here. */
  const closes =     [10.0, 11.0, 12.0, 13.0, 14.0];
  const closeDates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
  const sessions = [
    { d: "2026-08-05" }, { d: "2026-08-06" }, { d: "2026-08-07" }, { d: "2026-08-10" },
  ];
  const scores = [40, 50, 60, 70];

  const j = joinScoreToPrice({ closes, closeDates, sessions, scores, deadBand: 1 });
  eq(j.status, "ok", "overlapping windows join");
  eq(j.overlap, 3, "three sessions are in both windows");
  deep(j.rows.map((r) => r.d), ["2026-08-05", "2026-08-06", "2026-08-07"],
       "and they are the shared dates, in order");
  deep(j.rows.map((r) => r.close), [12.0, 13.0, 14.0],
       "each row's close is the one published FOR ITS OWN DATE — an index join " +
       "would have produced 10, 11, 12 here and looked entirely reasonable");
  deep(j.rows.map((r) => r.score), [40, 50, 60], "and each row's score likewise");

  eq(j.priceOnly, 2, "two priced sessions predate the score window and are counted");
  eq(j.scoreOnly, 1, "one scored session postdates the price window and is counted");
  eq(j.priceSpan.sessions + 0, 5, "the price span reports its own length");
  eq(j.scoreSpan.from, "2026-08-05", "and each span reports its own ends");
  eq(j.scoreSpan.to, "2026-08-10", "including the end outside the overlap");
}

/* ---------- 2. order does not come from the inputs ---------------- */
{
  /* A PAYLOAD IS NOT A PROMISE ABOUT ORDER. Both sides are documented
     oldest-first, and both are today; a join that only works while that holds
     is a join with an undocumented precondition. Shuffled here so the
     ordering is the function's doing. */
  const j = joinScoreToPrice({
    closes: [14.0, 12.0, 13.0],
    closeDates: ["2026-08-07", "2026-08-05", "2026-08-06"],
    sessions: [{ d: "2026-08-06" }, { d: "2026-08-07" }, { d: "2026-08-05" }],
    scores: [50, 60, 40],
  });
  eq(j.status, "ok", "shuffled inputs still join");
  deep(j.rows.map((r) => r.d), ["2026-08-05", "2026-08-06", "2026-08-07"],
       "the output is ordered oldest first regardless of input order");
  deep(j.rows.map((r) => [r.close, r.score]), [[12, 40], [13, 50], [14, 60]],
       "and every pair still belongs to its own date");
}

/* ---------- 3. gaps survive as nulls ------------------------------ */
{
  /* A SESSION THE ARCHIVE NEVER SCORED IS A HOLE, and it has to reach the
     renderer as a hole. Dropping the row would silently shorten the x-axis
     and pull the neighbours together; substituting 0 would publish NEUTRAL,
     which is a reading this system means. */
  const j = joinScoreToPrice({
    closes: [10, 11, 12, 13],
    closeDates: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"],
    sessions: [{ d: "2026-08-03" }, { d: "2026-08-04" }, { d: "2026-08-05" }, { d: "2026-08-06" }],
    scores: [40, null, undefined, 70],
  });
  eq(j.overlap, 4, "every session is still a row — a hole does not shorten the axis");
  deep(j.rows.map((r) => r.score), [40, null, null, 70],
       "null and undefined both arrive as null, never as 0");
  eq(j.scored, 2, "the scored count excludes them");
  eq(j.gaps, 2, "and the gap count names them, so the panel can say 2 of 4");

  /* THE ZERO THAT IS REAL. A measured score of 0 is a name sitting exactly at
     neutral and must not be swept into the gap count with the holes — the
     defect this repository names "never a confident zero", running the other
     way. */
  const withZero = joinScoreToPrice({
    closes: [10, 11], closeDates: ["2026-08-03", "2026-08-04"],
    sessions: [{ d: "2026-08-03" }, { d: "2026-08-04" }], scores: [0, null],
  });
  deep(withZero.rows.map((r) => r.score), [0, null],
       "a measured zero stays a zero and is not confused with an absence");
  eq(withZero.scored, 1, "it counts as scored");
  eq(withZero.gaps, 1, "and only the real hole is a gap");
}

/* ---------- 4. the empty intersection is a reading ---------------- */
{
  /* NOT AN ERROR AND NOT AN ABSENCE. Two windows were read in full and they
     describe disjoint spans — ordinary for a name new to the board. The
     status has to be the third one, and both spans have to come with it, or
     the page can only say "nothing" where it could say which two windows
     failed to meet. */
  const j = joinScoreToPrice({
    closes: [10, 11],
    closeDates: ["2027-01-04", "2027-01-05"],
    sessions: [{ d: "2026-08-03" }, { d: "2026-08-04" }],
    scores: [40, 50],
  });
  eq(j.status, "quiet", "disjoint windows are QUIET — measured, and empty");
  eq(j.overlap, 0, "with an overlap of zero stated as a number");
  eq(j.priceSpan.from, "2027-01-04", "and the price span named");
  eq(j.scoreSpan.to, "2026-08-04", "and the score span named, so a reader sees why");
  ok(!("rows" in j), "no rows key at all, rather than an empty array a drawer might plot");
}

/* ---------- 5. the two absences are told apart -------------------- */
{
  const noPrice = joinScoreToPrice({
    closes: null, closeDates: null,
    sessions: [{ d: "2026-08-03" }], scores: [40],
  });
  eq(noPrice.status, "unavailable", "a card with no dated price window is unavailable");
  ok(/dated price history/.test(noPrice.reason),
     "and says which half is missing, not 'no data'");

  const noScores = joinScoreToPrice({
    closes: [10], closeDates: ["2026-08-03"], sessions: null, scores: null,
  });
  eq(noScores.status, "unavailable", "a card with no score history is unavailable");
  ok(/score track/.test(noScores.reason), "and names that half instead");
  ok(noPrice.reason !== noScores.reason,
     "the two reasons are different sentences: a reader must be able to tell which " +
     "leg to wait for");

  /* CLOSES WITHOUT DATES IS THE PRE-JOIN CARD, and it is the state every
     card published before the pairing shipped is in. It must not be a crash
     and must not be an empty chart. */
  const undated = joinScoreToPrice({
    closes: [10, 11], closeDates: [null, null],
    sessions: [{ d: "2026-08-03" }], scores: [40],
  });
  eq(undated.status, "unavailable", "closes with no dates cannot be placed on a date axis");
  eq(undated.rows, undefined, "and produce no rows to draw");
}

/* ---------- 6. malformed dates are dropped, not guessed ----------- */
{
  const j = joinScoreToPrice({
    closes: [10, 11, 12],
    closeDates: ["2026-08-03", "not-a-date", "2026-08-05"],
    sessions: [{ d: "2026-08-03" }, { d: 20260805 }, { d: "2026-08-05" }],
    scores: [40, 50, 60],
  });
  eq(j.overlap, 2, "a row whose date does not parse is dropped from both sides");
  eq(j.undatedCloses, 1, "and counted rather than silently lost");
  eq(j.undatedSessions, 1, "on the score side too — a number date is not a date string");
  deep(j.rows.map((r) => r.score), [40, 60],
       "the surviving rows keep their own scores: the dropped row does not shift them");

  /* A TIMESTAMP IS A DAY KEY WITH EXTRA ON THE END, and the vendor sends
     both forms across this codebase. Truncating is right; parsing is not
     needed and would introduce a timezone. */
  const stamped = joinScoreToPrice({
    closes: [10], closeDates: ["2026-08-03T13:30:00.000Z"],
    sessions: [{ d: "2026-08-03" }], scores: [40],
  });
  eq(stamped.overlap, 1, "an ISO timestamp joins against a plain day key");
}

/* ---------- 7. a non-positive close is not a price ---------------- */
{
  const j = joinScoreToPrice({
    closes: [10, 0, -3, 13],
    closeDates: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"],
    sessions: [{ d: "2026-08-03" }, { d: "2026-08-04" }, { d: "2026-08-05" }, { d: "2026-08-06" }],
    scores: [40, 50, 60, 70],
  });
  eq(j.overlap, 2, "a zero or negative close is not a price and its session is dropped");
  deep(j.rows.map((r) => r.d), ["2026-08-03", "2026-08-06"], "leaving the real ones");
}

/* ---------- 8. scoreRowFor is a lookup, not a join ---------------- */
{
  const track = { names: [{ t: "AAPL", s: [1, 2] }, { t: "msft", s: [3] }] };
  eq(scoreRowFor(track, "AAPL").s.length, 2, "an exact name is found");
  eq(scoreRowFor(track, "aapl").s.length, 2, "case does not decide membership");
  eq(scoreRowFor(track, "MSFT").s.length, 1, "in either direction");
  eq(scoreRowFor(track, "TSLA"), null, "a name not in the track is null");
  eq(scoreRowFor(null, "AAPL"), null, "and so is a track that was never read");
  ok(scoreRowFor(track, "TSLA") === scoreRowFor(null, "AAPL"),
     "SEPARATE FROM THE JOIN on purpose: 'not in the track' and 'no track' are " +
     "both null here, and the CALLER distinguishes them — a single function " +
     "answering both would force every caller to guess which it had");
}

/* ---------- 9. every note is real prose --------------------------- */
{
  for (const [k, v] of Object.entries(OVERLAY_NOTES)) {
    ok(typeof v === "string" && v.length > 60, `OVERLAY_NOTES.${k} is a real sentence`);
    ok(/[.]$/.test(v.trim()), `OVERLAY_NOTES.${k} ends as a sentence`);
  }
  ok(/not zipped by position|not.*index/i.test(OVERLAY_NOTES.join),
     "the join note states the thing that would otherwise be invisible");
  ok(/breaks/.test(OVERLAY_NOTES.gap) && /zero/i.test(OVERLAY_NOTES.gap),
     "the gap note says the line breaks and says why zero is not a substitute");
}

/* ---------- 10. against the corpus the pipeline actually emits ----- */
{
  /* THE FIXTURE ABOVE IS MINE AND AGREES WITH ME BY CONSTRUCTION. This reads
     what the pipeline really publishes — the rule this directory states as
     "the fixture crosses the wire boundary". It also pins the thing that made
     this panel possible: the emitted candles used to be dated five months
     AFTER the session they described, and every window join on this corpus
     was therefore empty. */
  const dir = path.join(ROOT, "tests", ".overlay-emit");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(process.execPath,
    [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", dir + "/"],
    { stdio: "ignore" });

  const cards = fs.readdirSync(dir).filter((f) => f.startsWith("-card-"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  ok(cards.length >= 5, `the emitter produced ${cards.length} cards`);

  const track = JSON.parse(fs.readFileSync(path.join(dir, "-scoretrack.json"), "utf8"));

  /* THE CANDLES END AT THE SESSION THEY DESCRIBE. The pipeline reads
     /ohlc/1d with end_date=sessionDate, so a fixture whose last close is in
     the future is not a fixture of anything this code can receive. */
  let joined = 0;
  for (const card of cards) {
    const ctx = card.panels.context;
    if (ctx.status !== "ok" || !Array.isArray(ctx.closeDates)) continue;
    const last = ctx.closeDates[ctx.closeDates.length - 1];
    ok(last <= card.sessionDate,
       `${card.ticker}: the newest close (${last}) is not after the session it describes ` +
       `(${card.sessionDate})`);
    /* AND THEY ARE WEEKDAYS. A daily bar series stepping one CALENDAR day
       covers weekends, which no exchange keeps and which the board archive —
       weekday-only by construction — can never join against. */
    for (const d of ctx.closeDates) {
      const dow = new Date(d + "T00:00:00Z").getUTCDay();
      ok(dow !== 0 && dow !== 6, `${card.ticker}: ${d} is a trading day, not a weekend`);
    }

    const panel = card.panels.scoreOverlay;
    ok(panel && typeof panel.status === "string",
       `${card.ticker}: the card carries a scoreOverlay panel`);
    if (panel.status !== "ok") continue;
    joined++;

    /* THE PUBLISHED ROWS AGREE WITH THE CARD'S OWN PRICE WINDOW. This is the
       assertion an index join fails: every row's close must be the close this
       same card publishes for that row's date. */
    const closeFor = new Map();
    for (let i = 0; i < ctx.closeDates.length; i++) closeFor.set(ctx.closeDates[i], ctx.closes[i]);
    for (const r of panel.rows) {
      eq(r.close, closeFor.get(r.d),
         `${card.ticker} ${r.d}: the row's close is the one this card publishes for that day`);
    }
    /* AND WITH THE TRACK'S OWN SCORES, from the other side. */
    const row = scoreRowFor(track, card.ticker);
    ok(row, `${card.ticker}: is in the score track it was joined against`);
    const scoreFor = new Map();
    for (let i = 0; i < track.sessions.length; i++) scoreFor.set(track.sessions[i].d, row.s[i]);
    for (const r of panel.rows) {
      eq(r.score, scoreFor.get(r.d) === undefined ? null : scoreFor.get(r.d),
         `${card.ticker} ${r.d}: the row's score is the track's score for that day`);
    }
    /* Ordered, and the counts add up. */
    const days = panel.rows.map((r) => r.d);
    deep(days, days.slice().sort(), `${card.ticker}: rows are ordered oldest first`);
    eq(panel.overlap, panel.rows.length, `${card.ticker}: overlap counts the rows it published`);
    eq(panel.scored + panel.gaps, panel.overlap,
       `${card.ticker}: scored and gaps partition the overlap`);
  }
  ok(joined > 0,
     `at least one emitted card actually joins (${joined} do) — a corpus where every ` +
     `join comes back empty cannot exercise this panel at all, which is the state ` +
     `the candle fixture was in before its dates were anchored to the session`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`✓ flows-overlay: ${checks} assertions — a join by date that a fixture built ` +
  `to break an index join actually catches, holes that survive as holes and never as ` +
  `neutral, an empty intersection published as a reading with both spans attached, the ` +
  `two absences told apart in two sentences, and the emitted corpus checked from both ` +
  `sides against the payloads it was joined from`);
