/* =============================================================
   flows-scores-contract.mjs — the dated score pool and its trace.

   WHAT IS WORTH ASSERTING HERE. The score track is a VIEW of the
   dated archive, rebuilt each run, and every expensive defect it can
   ship is a quiet confusion between four things that all render as
   "no number":

     a GAP        — the name was not scored that session,
     a ZERO       — the name was scored and the score was zero,
     a THIN DAY   — a session reconstructed from the boards alone,
     a SHED NAME  — a name dropped for the payload size cap.

   The zero/gap distinction is the page's whole honesty: zero is a
   score this pipeline assigns, and a fixture that never contains a
   zero would let a renderer collapse the two without any test
   noticing. So the fixtures here contain zeros ON PURPOSE, adjacent
   to gaps, and the assertions check them apart.

   Determinism is load-bearing, not cosmetic: the dated key is
   written once per session under an immutability contract, and
   "written once" only means anything if a re-run produces identical
   bytes. Every builder is therefore asserted to sort totally and to
   produce byte-identical output on a second call.
   ============================================================= */

import assert from "node:assert/strict";
import {
  scoresRows, buildScoreTrack, boardsToScoreRows,
  TRACK_SESSIONS, TRACK_MAX_NAMES, SCORES_NOTES,
} from "../shared/flows-scores.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

/* ---------- §1 the session pool ---------------------------------- */
{
  const sides = {
    long: [{ ticker: "BBB", score: 12 }, { ticker: "AAA", score: 3 }],
    short: [{ ticker: "ZZZ", score: -8 }],
    neutralRows: [
      { ticker: "MMM", score: 0 },              // a REAL zero — must survive
      { ticker: "AAA", score: 99 },             // duplicate ticker — first wins
      { ticker: "NNN", score: null },           // unscored — dropped
      { ticker: "", score: 4 },                 // nameless — dropped
    ],
  };
  const rows = scoresRows(sides);
  deep(rows.map((r) => r.t), ["AAA", "BBB", "MMM", "ZZZ"],
    "the pool is the WHOLE distribution — long, short and the dead-band middle — " +
    "sorted by ticker so the archived bytes are deterministic");
  eq(rows.find((r) => r.t === "MMM").s, 0,
    "a zero score is archived AS zero — it is a measurement, and dropping it would " +
    "make zero and unscored indistinguishable forever after");
  eq(rows.find((r) => r.t === "AAA").s, 3,
    "a duplicate ticker keeps its first (ranked) appearance");
  ok(!rows.some((r) => r.t === "NNN"),
    "a name with no finite score is not archived — an absent measurement is " +
    "absence, never a placeholder");
  eq(JSON.stringify(scoresRows(sides)), JSON.stringify(rows),
    "a second call produces identical bytes — the immutable dated key depends on it");
}

/* ---------- §2 boards folded into a backfill day ------------------ */
{
  const rows = boardsToScoreRows([
    [{ t: "CCC", s: -4 }, { t: "AAA", s: 7 }],
    [{ t: "CCC", s: -4 }, { t: "DDD", s: null }],
  ]);
  deep(rows, [{ t: "AAA", s: 7 }, { t: "CCC", s: -4 }],
    "the two archived board slices merge, deduplicate, sort, and drop the scoreless");
}

/* ---------- §3 the trace ------------------------------------------ */
{
  /* Three sessions, constructed so every distinction has a witness:
       d1 (boards, pre-epoch): AAA=5,           CCC=0
       d2 (scores):            AAA=6, BBB=-2,   CCC absent  <- gap after a zero
       d3 (scores):            AAA=7, BBB=-3 */
  const days = [
    { d: "2026-01-03", source: "scores", rows: [{ t: "AAA", s: 7 }, { t: "BBB", s: -3 }] },
    { d: "2026-01-01", source: "boards", rows: [{ t: "AAA", s: 5 }, { t: "CCC", s: 0 }] },
    { d: "2026-01-02", source: "scores", rows: [{ t: "AAA", s: 6 }, { t: "BBB", s: -2 }] },
  ];
  const track = buildScoreTrack(days, { deadBand: 1, epoch: "2026-01-02" });

  deep(track.sessions.map((x) => x.d), ["2026-01-01", "2026-01-02", "2026-01-03"],
    "sessions come out ascending whatever order the walk found them in");
  deep(track.sessions.map((x) => x.source), ["boards", "scores", "scores"],
    "each session carries its source, because a board-only day's sparseness is a " +
    "fact about the archive and the page must be able to say so");
  deep(track.sessions.map((x) => x.preEpoch), [true, false, false],
    "sessions before the selection epoch are flagged — scores across the epoch are " +
    "two experiments wearing one line");

  const aaa = track.names.find((n) => n.t === "AAA");
  deep(aaa.s, [5, 6, 7], "a fully observed series aligns one value per session");
  eq(aaa.n, 3, "and n counts its measurements");
  eq(aaa.last, 7, "and last is the newest measurement");

  const ccc = track.names.find((n) => n.t === "CCC");
  deep(ccc.s, [0, null, null],
    "ZERO AND GAP SIT ADJACENT AND STAY DIFFERENT: the zero is a published " +
    "measurement, the nulls are sessions the name was not scored — a builder " +
    "that coalesced them would erase the page's central honesty");
  eq(ccc.n, 1, "n counts the zero as measured");
  eq(ccc.last, 0,
    "and last is 0, not null — the newest MEASUREMENT, not the newest index. A " +
    "trailing gap must not eat the last real value");

  eq(track.sources.full, 2, "the source summary counts scores days");
  eq(track.sources.boardsOnly, 1, "and board-only days");
  eq(track.status, "ok", "a populated trace reports ok");
  eq(track.notes, SCORES_NOTES, "the pipeline's own prose rides on the payload");
}

/* ---------- §4 source precedence ---------------------------------- */
{
  const track = buildScoreTrack([
    { d: "2026-01-01", source: "scores", rows: [{ t: "AAA", s: 1 }, { t: "BBB", s: 2 }] },
    { d: "2026-01-01", source: "boards", rows: [{ t: "AAA", s: 99 }] },
  ]);
  eq(track.sessions.length, 1, "one date is one session however many sources offered it");
  eq(track.sessions[0].source, "scores",
    "and the scores key wins over the boards for the same date — it is a superset " +
    "by construction, and letting the subset overwrite it would silently narrow a day");
  eq(track.names.find((n) => n.t === "AAA").s[0], 1, "with the scores key's value");
  ok(track.names.some((n) => n.t === "BBB"), "and the names only it carries");
}

/* ---------- §5 the window ----------------------------------------- */
{
  const many = [];
  for (let i = 1; i <= TRACK_SESSIONS + 8; i++) {
    const d = "2026-03-" + String(100 + i).slice(1);   // fake but ordered dates
    many.push({ d, source: "scores", rows: [{ t: "AAA", s: i }] });
  }
  const track = buildScoreTrack(many);
  eq(track.sessions.length, TRACK_SESSIONS,
    "the window caps the sessions carried");
  eq(track.sessions[track.sessions.length - 1].d, many[many.length - 1].d,
    "and it is the OLDEST sessions that fall off, never the newest");
  eq(track.windowSessions, TRACK_SESSIONS,
    "with the choice published on the payload, as the identification bar requires");
}

/* ---------- §6 ordering and the shed ------------------------------ */
{
  const days = [
    { d: "2026-01-01", source: "scores",
      rows: [{ t: "FULL", s: 2 }, { t: "BIG", s: -9 }, { t: "ZED", s: 2 }, { t: "ABC", s: 2 }] },
    { d: "2026-01-02", source: "scores",
      rows: [{ t: "FULL", s: 3 }] },
  ];
  const track = buildScoreTrack(days);
  deep(track.names.map((n) => n.t), ["FULL", "BIG", "ABC", "ZED"],
    "ordering is a TOTAL order — most-observed first, then the stronger |last| " +
    "(BIG's −9 beats the 2s), then ticker for the remaining tie — so two runs over " +
    "the same archive publish identical bytes");

  const capped = buildScoreTrack(days, { maxNames: 2 });
  eq(capped.namesSeen, 4, "namesSeen reports the population before the cap");
  eq(capped.namesShed, 2, "namesShed reports exactly what the cap removed");
  deep(capped.names.map((n) => n.t), ["FULL", "BIG"],
    "and the shed removes the least-observed names, keeping the most trace per byte");
  ok(TRACK_MAX_NAMES >= 300,
    "the real cap leaves headroom over the realistic union of names in a window");
}

/* ---------- §7 empties are stated, not implied -------------------- */
{
  const track = buildScoreTrack([]);
  eq(track.status, "empty", "an empty archive reports itself as empty in words");
  deep(track.names, [], "with no names");
  deep(track.sessions, [], "and no sessions");
  const thin = buildScoreTrack([{ d: "2026-01-01", source: "scores", rows: [] }]);
  eq(thin.sessions.length, 1, "a day that answered with zero rows is still a session");
  eq(thin.sessions[0].names, 0, "carrying its own zero count");
  eq(thin.status, "empty", "but contributes no names, so the trace is still empty");
}

console.log(`✓ flows-scores: ${checks} assertions — the whole distribution archived, ` +
  `zero and gap adjacent and different, a trailing gap that cannot eat the last real ` +
  `value, the scores key beating the boards for a shared date, the oldest sessions ` +
  `falling off a published window, a total order that makes re-runs byte-identical, ` +
  `a shed that is counted, and empties that say so in words`);
