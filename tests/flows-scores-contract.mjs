import assert from "node:assert/strict";
import {
  scoresRows, buildScoreTrack, boardsToScoreRows,
  TRACK_SESSIONS, TRACK_MAX_NAMES, TRACK_MAX_BYTES, SCORES_NOTES,
} from "../shared/flows-scores.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

{
  const sides = {
    long: [{ ticker: "BBB", score: 12 }, { ticker: "AAA", score: 3 }],
    short: [{ ticker: "ZZZ", score: -8 }],
    neutralRows: [
      { ticker: "MMM", score: 0 },
      { ticker: "AAA", score: 99 },
      { ticker: "NNN", score: null },
      { ticker: "", score: 4 },
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

{

  const rows = scoresRows({
    long: [
      { ticker: "DIR", score: 9, netPrem: 13072372.4 },
      { ticker: "LEG", score: 8, net_call_premium: 5_000_000, net_put_premium: 1_500_000 },
      { ticker: "PUT", score: 7, net_put_premium: 2_200_000 },
    ],
    short: [
      { ticker: "FLAT", score: -6, net_call_premium: 0, net_put_premium: 0 },
      { ticker: "NONE", score: -5 },
    ],
  });
  const p = (t) => rows.find((r) => r.t === t);

  eq(p("DIR").p, 13072372,
    "a row that already carries netPrem is archived from it, rounded to whole " +
    "dollars — the unit the boards publish in, so no reader has to be told a scale");
  eq(p("LEG").p, 3500000,
    "two legs are folded to ONE SIGNED number, calls minus puts: the sign is the " +
    "reading, and archiving the legs separately would double the bytes to say it");
  eq(p("PUT").p, -2200000,
    "a quoted put leg with no call leg is a NEGATIVE premium, not a missing one — " +
    "the absent side is zero dollars of flow, which is a measurement");
  eq(p("FLAT").p, 0,
    "both legs quoted at zero archives AS zero: the screener priced this name and " +
    "found it flat");
  ok(!("p" in p("NONE")),
    "NO LEG QUOTED ARCHIVES NO KEY AT ALL. This is the pair that matters: FLAT and " +
    "NONE both draw as a bar of no height, and once `p: 0` is written for a name " +
    "nobody priced, no later reader can ever recover which it was");
  eq(JSON.stringify(rows).includes('"p":null'), false,
    "and absence is never spelled as a null value — an omitted key survives the " +
    "size cap and a null does not");
}

{
  const rows = boardsToScoreRows([
    [{ t: "CCC", s: -4 }, { t: "AAA", s: 7 }],
    [{ t: "CCC", s: -4 }, { t: "DDD", s: null }],
  ]);
  deep(rows, [{ t: "AAA", s: 7 }, { t: "CCC", s: -4 }],
    "the two archived board slices merge, deduplicate, sort, and drop the scoreless");
}

{

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

{
  const many = [];
  for (let i = 1; i <= TRACK_SESSIONS + 8; i++) {
    const d = "2026-03-" + String(100 + i).slice(1);
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

{

  const days = [
    { d: "2026-06-01", source: "scores", rows: [
      { t: "AAA", s: 10, q: 100 }, { t: "BBB", s: 5, q: 55 },
      { t: "CCC", s: 0, q: 0 }, { t: "EEE", s: -4, q: -40 }] },
    { d: "2026-06-02", source: "scores", rows: [{ t: "AAA", s: 12, q: 120 }, { t: "CCC", s: 0, q: 0 }] },
    { d: "2026-06-03", source: "scores", rows: [{ t: "AAA", s: 14, q: 140 }] },
    { d: "2026-06-04", source: "scores", rows: [{ t: "AAA", s: 16, q: 160 }] },
    { d: "2026-06-05", source: "scores", rows: [
      { t: "AAA", s: 18, q: 180 }, { t: "CCC", s: 0, q: 0 }, { t: "EEE", s: -6, q: -60 }] },
    { d: "2026-06-06", source: "scores", rows: [
      { t: "AAA", s: 20, q: 205 }, { t: "BBB", s: 20, q: 250 },
      { t: "CCC", s: 0, q: 0 }, { t: "DDD", s: 30, q: 310 }] },
  ];
  const track = buildScoreTrack(days);
  const by = new Map(track.names.map((n) => [n.t, n]));

  eq(by.get("AAA").d1.v, 2, "AAA moved two points");
  eq(by.get("AAA").d1.gap, 1, "and it moved them overnight — the gap is one session");
  eq(by.get("BBB").d1.v, 15, "BBB moved fifteen points");
  eq(by.get("BBB").d1.gap, 5,
     "across FIVE sessions, four of which it was not scored at all. The renderer this " +
     "replaces would have printed +15 for BBB and +2 for AAA and ranked BBB first, which " +
     "is a ranking of how long a name was absent");

  eq(by.get("CCC").d1.v, 0, "a name that held its score has a change of zero");
  eq(by.get("CCC").d1.gap, 1, "measured across one session, so the zero is about last night");
  eq(by.get("DDD").d1, null,
     "while a name with no earlier observation has NO change — null, not zero. These are " +
     "the two readings this whole module exists to keep apart");

  deep(by.get("CCC").s, [0, 0, null, null, 0, 0],
     "the held name's measured values are all real zeros and its gaps are real gaps, " +
     "adjacent to each other, which is the whole confusion this module exists to prevent");

  eq(by.get("CCC").n, 4, "CCC was scored four times, every one of them zero");

  eq(by.get("AAA").d1.qv, 25, "the residual move rides alongside, unscaled by tanh");
  eq(by.get("BBB").d1.qv, 195, "for both names");
  ok(by.get("AAA").d1.qv / by.get("AAA").d1.v > 12,
     "AAA covered 12.5 residual units per score point — it is out where the score saturates");
  ok(by.get("BBB").d1.qv / by.get("BBB").d1.v < 14,
     "and the two ratios differ, which is the whole reason qv is published");

  const mixed = buildScoreTrack([
    { d: "2026-07-01", source: "boards", rows: [{ t: "FFF", s: 4 }] },
    { d: "2026-07-02", source: "scores", rows: [{ t: "FFF", s: 9, q: 90 }] },
  ]);
  const f = mixed.names.find((n) => n.t === "FFF");
  eq(f.d1.v, 5, "a move whose earlier end came from a board-only backfill still has a change");
  eq(f.d1.gap, 1, "and a gap");
  eq(f.d1.qv, undefined,
     "but NO residual change: the backfilled day carries no residual, and differencing " +
     "against an absent one would publish a number that is not the quantity it names");

  eq(track.change.session, "2026-06-06", "the change is INTO the latest session, named");
  eq(track.change.prior, "2026-06-05", "against the one before it, also named");
  eq(track.change.comparable, 4, "AAA, BBB, CCC and EEE each have two observations");
  eq(track.change.consecutive, 2,
     "but only AAA and CCC moved across ADJACENT sessions — BBB spanned five and EEE's " +
     "pair ended yesterday");
  eq(track.change.moved, 3, "three of the four changed");
  eq(track.change.held, 1, "and one held, which is a reading and not an absence");
  eq(track.change.moved + track.change.held, track.change.comparable,
     "moved and held partition comparable exactly — no name is counted twice or lost");
  eq(track.change.current, 4, "four names were scored in the latest session");
  eq(track.change.entered, 1, "one of them for the first time in the window (DDD)");
  eq(track.change.left, 1, "and one name scored yesterday was not scored today (EEE)");
  eq(track.change.status, "ok", "something moved, so the layer has something to say");

  eq(by.get("AAA").lastAt, 5, "AAA's last observation is the newest session");
  eq(by.get("EEE").lastAt, 4,
     "EEE's is yesterday's — so EEE HAS a change and it is not a change about today, " +
     "which a page leading on change must be able to tell");
  eq(track.sessions.length, 6, "and the index is into `sessions`, whose length is published");
}

{

  const cold = buildScoreTrack([
    { d: "2026-08-03", source: "scores", rows: [{ t: "AAA", s: 5 }, { t: "BBB", s: -5 }] },
  ]);
  eq(cold.change.status, "single-session",
     "one archived session reports SINGLE-SESSION — there is no prior to compare against, " +
     "which is a fact about the archive");
  eq(cold.change.comparable, 0, "so nothing is comparable");
  eq(cold.change.prior, null, "and there is no prior session to name");
  eq(cold.change.session, "2026-08-03", "though the session itself is still named");
  for (const n of cold.names) eq(n.d1, null, `${n.t} has no change on a single-session archive`);

  const flat = buildScoreTrack([
    { d: "2026-08-03", source: "scores", rows: [{ t: "AAA", s: 5 }, { t: "BBB", s: 0 }] },
    { d: "2026-08-04", source: "scores", rows: [{ t: "AAA", s: 5 }, { t: "BBB", s: 0 }] },
  ]);
  eq(flat.change.status, "flat",
     "two sessions in which every comparable name held is FLAT — a measured stillness, " +
     "not an empty archive, and the page owes those two different sentences");
  eq(flat.change.comparable, 2, "both names were compared");
  eq(flat.change.moved, 0, "and neither moved");
  eq(flat.change.held, 2, "so both held");

  const disjoint = buildScoreTrack([
    { d: "2026-08-03", source: "scores", rows: [{ t: "AAA", s: 5 }] },
    { d: "2026-08-04", source: "scores", rows: [{ t: "BBB", s: 7 }] },
  ]);
  eq(disjoint.change.status, "cold",
     "two sessions that share no name are COLD, not flat — nothing was compared, so " +
     "nothing can be said to have held");
  eq(disjoint.change.comparable, 0, "nothing comparable");
  eq(disjoint.change.entered, 1, "one arrival");
  eq(disjoint.change.left, 1, "one departure");
}

{
  const rowsFor = (n, base) => Array.from({ length: n }, (_, i) => ({ t: "T" + i, s: base + i % 7 }));
  const capped = buildScoreTrack([
    { d: "2026-08-03", source: "scores", rows: rowsFor(60, 0) },
    { d: "2026-08-04", source: "scores", rows: rowsFor(60, 1) },
  ], { maxNames: 10 });

  eq(capped.names.length, 10, "the payload carries ten names");
  eq(capped.namesShed, 50, "and says fifty were shed");
  eq(capped.change.comparable, 60,
     "but the change layer counted all SIXTY — a name dropped for payload budget was " +
     "still scored, and a count that shrank with the wire cap would be a fact about the " +
     "ingest route pretending to be a fact about the market");
  eq(capped.change.moved, 60, "all sixty moved by one");
  eq(capped.change.current, 60, "and all sixty were scored in the latest session");
}

{
  const days = [
    { d: "2026-08-03", source: "scores", rows: [{ t: "BBB", s: 3, q: 30 }, { t: "AAA", s: 1, q: 10 }] },
    { d: "2026-08-04", source: "scores", rows: [{ t: "AAA", s: 4, q: 44 }, { t: "BBB", s: 3, q: 31 }] },
  ];
  const a = JSON.stringify(buildScoreTrack(days));
  const b = JSON.stringify(buildScoreTrack(days.slice().reverse()));
  eq(a, b, "the same archive in either order builds byte-identical bytes, change layer included");
  eq(JSON.parse(a).change.moved, 1, "and the layer itself is right: only AAA moved");
  eq(JSON.parse(a).change.held, 1, "BBB held its score while its residual moved by one");
  const bbb = JSON.parse(a).names.find((n) => n.t === "BBB");
  eq(bbb.d1.v, 0, "which is exactly the case the score's rounding hides");
  eq(bbb.d1.qv, 1,
     "and the residual does not hide it: a score that held over a residual that moved is " +
     "a real state, and publishing only the score would call it stillness");
}

{
  const rows = scoresRows({
    long: [{ ticker: "AAA", score: 92, residual: 0.0221 }],
    short: [{ ticker: "ZZZ", score: -80, residual: -0.0184 }],
    neutralRows: [
      { ticker: "MMM", score: 0, residual: 0 },
      { ticker: "NNN", score: 4 },
    ],
  });
  const by = new Map(rows.map((r) => [r.t, r]));
  eq(by.get("AAA").q, 221, "the residual is archived scaled by 1e4 and rounded to an integer");
  eq(by.get("ZZZ").q, -184, "signed, so the short side is not folded onto the long");
  eq(by.get("MMM").q, 0,
     "a residual of exactly zero is archived AS zero — it means 'at the pool median', " +
     "which is a measurement");
  ok(!("q" in by.get("NNN")),
     "while a row that carried no residual gets no `q` key at all rather than a zero — " +
     "Number(undefined) is NaN and Number(null) is 0, and this file's oldest scar is the " +
     "second one");
  eq(by.get("NNN").s, 4, "and it keeps its score, which was never in doubt");
}

{
  const t = buildScoreTrack([
    { d: "2026-05-01", source: "scores", rows: [
      { t: "CLR", s: 0 },
      { t: "EDGE", s: 1 },
      { t: "FAD", s: 40 },
      { t: "FLP", s: 20 },
      { t: "DRIFT", s: 50 },
      { t: "STAY", s: 0 }] },
    { d: "2026-05-02", source: "scores", rows: [
      { t: "CLR", s: 30 },
      { t: "EDGE", s: 4 },
      { t: "FAD", s: 1 },
      { t: "FLP", s: -25 },
      { t: "DRIFT", s: 70 },
      { t: "STAY", s: 1 }] },
  ], { deadBand: 1 });
  const by = new Map(t.names.map((n) => [n.t, n]));

  eq(by.get("CLR").d1.cross, "cleared",
     "a name that was inside the dead band and is now outside it CLEARED — it became " +
     "actionable this session, which is the sentence an early-warning surface exists for");
  eq(by.get("FAD").d1.cross, "faded",
     "and the reverse FADED, which is the exit signal and is exactly as load-bearing " +
     "as the entry");
  eq(by.get("FLP").d1.cross, "flipped",
     "a name outside the band at both ends with opposite signs FLIPPED — it did not " +
     "weaken and re-strengthen, it changed its mind without resting in the middle");
  eq(by.get("DRIFT").d1.cross, undefined,
     "while a name that moved twenty points entirely outside the band has NO crossing: " +
     "it is a larger move than CLR's and a smaller event, and this is the whole point");
  ok(by.get("DRIFT").d1.v > by.get("CLR").d1.v - 11,
     "the drifting name's magnitude is comparable to the crossing name's, so magnitude " +
     "alone cannot be what separates them");
  eq(by.get("STAY").d1.cross, undefined,
     "and a name that moved from 0 to 1 stayed inside, so nothing happened");

  eq(by.get("EDGE").d1.cross, "cleared",
     "a name sitting exactly ON the band edge is INSIDE it, so moving off the edge is a " +
     "crossing — the comparison is |s| <= band, matching the partition that decides " +
     "which surface the name is actually published on");

  eq(t.change.crossings.cleared, 2, "two names cleared");
  eq(t.change.crossings.faded, 1, "one faded");
  eq(t.change.crossings.flipped, 1, "one flipped");
  eq(t.change.band, 1,
     "and the band travels with its own counts: a crossing count with no threshold " +
     "attached cannot be checked, and the alternative is a renderer restating the " +
     "constant in its own prose");

  const total = t.change.crossings.cleared + t.change.crossings.faded + t.change.crossings.flipped;
  ok(total <= t.change.comparable,
     "no name can cross twice — the three classes are mutually exclusive by construction");

  const noBand = buildScoreTrack([
    { d: "2026-05-01", source: "scores", rows: [{ t: "AAA", s: 0 }] },
    { d: "2026-05-02", source: "scores", rows: [{ t: "AAA", s: 9 }] },
  ], { deadBand: null });
  eq(noBand.names[0].d1.cross, undefined,
     "with no published band, no name is classified — 0 to 9 is a move and nothing is " +
     "known about whether it crossed anything");
  eq(noBand.names[0].d1.v, 9, "though the move itself is still reported");
  eq(noBand.change.band, null, "and the payload says the band was absent rather than zero");
  eq(noBand.change.crossings.cleared, 0, "so the counts are honestly empty");

  const slow = buildScoreTrack([
    { d: "2026-05-01", source: "scores", rows: [{ t: "SLOW", s: 0 }] },
    { d: "2026-05-02", source: "scores", rows: [] },
    { d: "2026-05-03", source: "scores", rows: [] },
    { d: "2026-05-04", source: "scores", rows: [{ t: "SLOW", s: 30 }] },
  ], { deadBand: 1 });
  eq(slow.names[0].d1.cross, "cleared", "a crossing that took three sessions is a crossing");
  eq(slow.names[0].d1.gap, 3,
     "and it says so — a name that cleared the band overnight and one that took three " +
     "weeks are the same event with very different urgency, and only the gap separates them");
}

{
  const mk = (d, rows) => ({ d, source: "scores", rows });
  const t = buildScoreTrack([
    mk("2026-04-01", [{ t: "HELD", s: 5 }, { t: "FLIP", s: -3 }, { t: "ZERO", s: 9 }]),
    mk("2026-04-02", [{ t: "HELD", s: 7 }, { t: "FLIP", s: -8 }]),
    mk("2026-04-03", [{ t: "HELD", s: 9 }, { t: "FLIP", s: 4 }, { t: "ZERO", s: 2 }]),
    mk("2026-04-06", [{ t: "HELD", s: 12 }, { t: "FLIP", s: 6 }, { t: "ZERO", s: 0 }]),
  ], { deadBand: 1 });
  const by = new Map(t.names.map((n) => [n.t, n]));

  eq(by.get("HELD").run, 4,
     "a name positive on all four scored sessions has a run of four — an OLD opinion, " +
     "which is the fact that separates a name worth opening from one that has been " +
     "saying the same thing for a month");
  eq(by.get("FLIP").run, 2,
     "a name that turned positive two sessions ago has a run of two, not four: the run " +
     "counts the CURRENT side only");
  eq(by.get("ZERO").run, 0,
     "and a name whose newest score is exactly zero has a run of zero — zero is the " +
     "centre of the dead band and belongs to neither side, so it ends a run rather " +
     "than extending one. Math.sign(0) is 0 and would have silently agreed with itself");

  const gapped = buildScoreTrack([
    mk("2026-04-01", [{ t: "GAP", s: 8 }]),
    mk("2026-04-02", []),
    mk("2026-04-03", [{ t: "GAP", s: 9 }]),
  ], { deadBand: 1 });
  eq(gapped.names[0].run, 2,
     "a run counts MEASURED sessions and is not broken by a gap — a name out of the " +
     "screener for a day did not change its mind, and the alternative reads absence " +
     "as a reversal");
  deep(gapped.names[0].s, [8, null, 9], "and the gap is genuinely there in the series");

  deep(by.get("HELD").ext, { hi: 12, hiAt: 3, lo: 5, loAt: 0 },
    "the window's high and low come with the session INDEX each happened on, so a " +
    "renderer can name the date from `sessions` rather than inventing one");
  eq(t.sessions[by.get("HELD").ext.hiAt].d, "2026-04-06",
     "and that index resolves against the published sessions array — HELD's window high " +
     "is today, which is the strongest thing this archive can say about a name");
  deep(by.get("FLIP").ext, { hi: 6, hiAt: 3, lo: -8, loAt: 1 },
    "the low is signed, so a short-side extreme is not folded onto the long side");
  eq(by.get("ZERO").ext.lo, 0,
     "and a low of exactly zero is a reading, published as zero rather than dropped");

  for (const n of t.names) {
    ok(n.ext !== null && n.ext.hiAt >= 0 && n.ext.loAt >= 0,
       `${n.t} reached the payload, so it has at least one measurement and real extremes`);
    ok(n.ext.hi >= n.ext.lo, `${n.t}'s high is not below its low`);
  }

  eq(by.get("FLIP").d1.v, 2, "FLIP moved two points overnight");
  eq(by.get("HELD").d1.v, 3, "HELD moved three, so it moved MORE");
  ok(by.get("FLIP").run < by.get("HELD").run,
     "and yet FLIP is the newer opinion — magnitude and age are orthogonal, which is " +
     "why both are published rather than one standing in for the other");
}

{
  const FLOWS_MAX_PAYLOAD_BYTES = 128 * 1024;
  ok(TRACK_MAX_BYTES < FLOWS_MAX_PAYLOAD_BYTES,
     "the body budget sits below the route's cap with room for the envelope, the sessions " +
     "array and the notes, none of which the names block knows about");

  const days = Array.from({ length: TRACK_SESSIONS }, (_, k) => ({
    d: "2026-01-" + String(k + 1).padStart(2, "0"),
    source: "scores",
    rows: Array.from({ length: 400 }, (_, i) => ({ t: "TICK" + i, s: k + (i % 40) - 20, q: (k + i) * 7 })),
  }));
  const big = buildScoreTrack(days, { deadBand: 1 });

  ok(big.namesSeen === 400, "four hundred names were seen");
  ok(big.names.length < 400, "and the payload carries fewer, because the bytes ran out");
  eq(big.shedBy, "bytes",
     "the payload names WHICH ceiling bound — a name cap that bound is a constant " +
     "somebody chose and can raise; a byte cap that bound is the row shape having " +
     "outgrown the route, and the two invite opposite reactions");
  ok(big.names.length < TRACK_MAX_NAMES,
     "the name cap did not bind: it would have allowed five hundred and the bytes " +
     "stopped it well short");
  ok(big.namesBytes <= TRACK_MAX_BYTES, `the names block is inside its budget (${big.namesBytes})`);
  ok(JSON.stringify(big).length < FLOWS_MAX_PAYLOAD_BYTES,
     `and the WHOLE payload clears the route's cap (${JSON.stringify(big).length} bytes) — ` +
     "which is the number that was going to fail, and it is asserted rather than argued");
  eq(big.namesShed, big.namesSeen - big.names.length,
     "the shed is counted against what was SEEN, so a reader is told how many names exist " +
     "that they are not being shown rather than which of two ceilings removed them");

  const capped = buildScoreTrack(days.slice(0, 3), { deadBand: 1, maxNames: 10 });
  eq(capped.names.length, 10, "a name cap below the byte budget still binds");
  eq(capped.shedBy, "names", "and says so, so the reader knows a constant is the constraint");
  eq(capped.namesShed, 390, "with the full shed counted");

  const easy = buildScoreTrack(days.slice(0, 2), { deadBand: 1 });
  eq(easy.namesShed, 0, "a small archive sheds nothing");
  eq(easy.shedBy, null,
     "and names no ceiling — null rather than a word, because 'nothing was shed' and " +
     "'something was shed by the name cap' must not share a rendering");

  eq(JSON.stringify(buildScoreTrack(days, { deadBand: 1 })), JSON.stringify(big),
     "the same archive builds byte-identical bytes through the byte shed too — a cumulative " +
     "measurement over a totally ordered list, so a re-run writes what the first run wrote");
}

console.log(`✓ flows-scores: ${checks} assertions — the whole distribution archived, ` +
  `zero and gap adjacent and different, a trailing gap that cannot eat the last real ` +
  `value, the scores key beating the boards for a shared date, the oldest sessions ` +
  `falling off a published window, a total order that makes re-runs byte-identical, ` +
  `a shed that is counted, empties that say so in words, and a change layer that never `+
  `leaves home without its denominator — the same fifteen points across one session and `+
  `across five, told apart — and the dead-band crossing, which is the one move on this `+
  `page that is an event rather than a degree, a run length that a gap cannot break, `+
  `window extremes that resolve to real sessions, and a size cap finally expressed in `+
  `the unit that actually binds`);
