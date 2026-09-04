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
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
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
/* A measured zero must survive the read that checks it: `x || 0` would turn a
   null into the same 0 this assertion is trying to tell apart. */
const one0 = (v) => (v === null || v === undefined ? NaN : v);

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

/* ---------- the selection epoch: two experiments, never one mean --- */
{
  /* THE DEFECT THIS PINS IS A CONSEQUENCE OF WIDENING THE BOARD.

     A session's long-minus-short return is the return of whatever names that
     board published, and which names it published is decided by a selection
     rule. On 2026-08-26 that rule changed — from the extremes of a rough tilt
     composite to a stated market-cap cohort — so boards on either side of the
     date score two different populations. Same headings, same units, and a
     mean across them that is finite, plausible, and answers no question.

     The scorer reports them separately. That is the entire mitigation, and it
     is worth more than a schema bump would be: bumping the version would zero
     126 days of retained archive to say a sentence that fits in a footnote. */
  const cal = Array.from({ length: 8 }, (_, i) => `2026-08-0${i + 1}`);
  const mk = (d, aPx) => ([
    { d, side: "long", rows: [{ t: "A", px: aPx }] },
    { d, side: "short", rows: [{ t: "C", px: 200 }] },
  ]);
  // Two sessions before the epoch, two on or after it.
  const boards = [
    ...mk("2026-08-01", 100), ...mk("2026-08-02", 100),
    ...mk("2026-08-05", 100), ...mk("2026-08-06", 100),
  ];
  const closes = closesOf({
    A: { "2026-08-02": 110, "2026-08-03": 110, "2026-08-05": 110,
         "2026-08-06": 101, "2026-08-07": 101, "2026-08-08": 101 },
    C: { "2026-08-02": 200, "2026-08-03": 200, "2026-08-05": 200,
         "2026-08-06": 200, "2026-08-07": 200, "2026-08-08": 200 },
  });
  const epoch = "2026-08-05";
  const rec = scoreSessions(boards, closes, cal, { horizons: [1], statedK: 1, epoch });

  eq(rec.epoch, epoch, "the epoch rides along with the numbers it partitions");
  eq(rec.retained, 4, "every retained session is still counted — nothing is discarded");
  eq(rec.epochRetained, 2, "two sessions under the current rule");
  eq(rec.priorRetained, 2, "and two before it");

  const h = rec.horizons.find((x) => x.k === 1);
  eq(h.n, 2, "the headline mean counts ONLY sessions under the current rule");
  eq(h.priorN, 2, "the earlier sessions are reported beside it, under their own count");

  /* The two halves were built to differ by an order of magnitude: +10% before
     the epoch, +1% after. A pooled mean would land near +5.5% — a number
     belonging to neither population and visibly wrong here by construction. */
  close(h.ls, 0.01, "the current mean is the current population's, undiluted", 1e-9);
  close(h.prior, 0.10, "and the prior mean is the prior population's", 1e-9);
  ok(Math.abs(h.ls - 0.055) > 0.01,
     "neither is the pooled average of the two — which is the number this partition exists to never publish");

  /* NO EPOCH, NO SECOND SERIES. A `prior` key that is always present but
     usually null invites a renderer to draw an empty second line forever. */
  const flat = scoreSessions(boards, closes, cal, { horizons: [1], statedK: 1 });
  ok(!("prior" in flat.horizons[0]) && !("priorN" in flat.horizons[0]),
     "with no epoch the horizon row carries no prior keys at all");
  eq(flat.epoch, null, "and reports no epoch");
  eq(flat.horizons[0].n, 4, "pooling all four sessions, which is the pre-existing behaviour unchanged");

  const allAfter = scoreSessions(boards, closes, cal, { horizons: [1], statedK: 1, epoch: "2020-01-01" });
  ok(!("prior" in allAfter.horizons[0]),
     "an epoch with nothing before it also draws no second series — the key appears only when it has something to say");
  eq(allAfter.priorRetained, 0, "though the count is still published, so the page can say 'none'");

  ok(RECORD_NOTES.epoch.includes("different population"),
     "and the reason is published in words beside the numbers");
}

/* ---------- a mean without its dispersion is not a reading -------- */
{
  /* THREE SESSIONS BUILT SO THE SPREAD IS THE ASSERTION. The means below are
     +2%, +4% and +9%: a mean of +5% that a page could print as "+500bp over 3
     scored sessions" and, until this layer, print with nothing beside it. The
     sample sd of those three is 3.61pp — most of the mean — and that is the
     number that decides whether the mean is a finding or a coin. */
  const cal = Array.from({ length: 5 }, (_, i) => `2026-08-0${i + 1}`);
  const mk = (d) => ([
    { d, side: "long", rows: [{ t: "A", px: 100 }] },
    { d, side: "short", rows: [{ t: "C", px: 200 }] },
  ]);
  const boards = [...mk("2026-08-01"), ...mk("2026-08-02"), ...mk("2026-08-03")];
  const closes = closesOf({
    A: { "2026-08-02": 102, "2026-08-03": 104, "2026-08-04": 109 },
    C: { "2026-08-02": 200, "2026-08-03": 200, "2026-08-04": 200 },
  });
  const rec = scoreSessions(boards, closes, cal, { horizons: [1], statedK: 1 });
  const h = rec.horizons[0];
  eq(h.n, 3, "three sessions in the mean");
  close(h.ls, 0.05, "whose mean spread is +5%", 1e-9);
  close(h.sd, 0.0361, "and whose SAMPLE standard deviation is published beside it", 1e-4);
  /* THE DIVISOR IS n-1 AND THE FIXTURE CAN TELL. The population form (÷n)
     answers 0.0294 on these same three numbers, so a scorer that used it
     fails this assertion by 0.0067 rather than drifting by a rounding. */
  ok(Math.abs(h.sd - 0.0294) > 0.005,
     "computed with the sample divisor, not the population one — the two differ here by " +
     "more than a rounding, which is what makes the choice testable");
  close(h.se, 0.0208, "and the standard error is sd over the root of the session count", 1e-4);
  ok(h.se < h.sd, "the standard error of a mean is narrower than the spread it came from");

  /* ONE SESSION HAS NO MEASURED DISPERSION, and it reports none. A published
     0 here would read as a mean known exactly — the confident zero this
     repository is named for, wearing a statistic's clothes. */
  const one = scoreSessions(mk("2026-08-01"), closes, cal, { horizons: [1], statedK: 1 });
  eq(one.horizons[0].n, 1, "one scored session");
  eq(one.horizons[0].sd, null, "A SINGLE SESSION HAS NO SAMPLE DISPERSION: null, never 0");
  eq(one.horizons[0].se, null, "and no standard error either");
  ok(one.horizons[0].ls !== null, "while the mean itself is still published");
}

/* ---------- the pooled hit rate, over names and not sessions ------ */
{
  /* THE NUMBER THE PRODUCT IS NAMED FOR, AND THE UNIT ERROR BESIDE IT.

     Two sessions of very different width: one measured 2 names and got both,
     one measured 5 and got 2. The mean of the two RATES is 70%. The rate over
     the names is 4 of 7, 57.1%. Only the second is a hit rate; the first is a
     mean of ratios, and it flatters whichever session happened to be thin. */
  const cal = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const boards = [
    { d: "2026-08-01", side: "long", rows: [{ t: "A", px: 100 }] },
    { d: "2026-08-01", side: "short", rows: [{ t: "Z", px: 200 }] },
    { d: "2026-08-02", side: "long", rows: [
      { t: "B1", px: 100 }, { t: "B2", px: 100 }, { t: "B3", px: 100 }, { t: "B4", px: 100 }] },
    { d: "2026-08-02", side: "short", rows: [{ t: "Z", px: 200 }] },
  ];
  const closes = closesOf({
    A: { "2026-08-02": 110 },
    Z: { "2026-08-02": 190, "2026-08-03": 190 },
    B1: { "2026-08-03": 110 }, B2: { "2026-08-03": 90 },
    B3: { "2026-08-03": 90 }, B4: { "2026-08-03": 90 },
  });
  const rec = scoreSessions(boards, closes, cal, { horizons: [1], statedK: 1 });
  const h = rec.horizons[0];
  close(h.hit, 0.5714, "the hit rate is POOLED OVER NAMES: 4 of the 7 measured", 1e-4);
  ok(Math.abs(h.hit - 0.7) > 0.05,
     "and is not the mean of the two sessions' own rates, which is 70% here — a mean of " +
     "ratios weights a session that measured two names like one that measured five");
  eq(h.hitN, 7, "hitN counts NAMES");
  eq(h.hitSessions, 2, "over the sessions that contributed them");
  eq(h.n, 2, "while n counts SESSIONS, and the two denominators are different quantities");
  ok(h.hitN !== h.n, "which this fixture makes visible rather than leaving to a reader");

  /* A WITHHELD SPREAD DOES NOT WITHHOLD THE NAMES. One leg fully attrited, so
     the session has no long-minus-short at all — but a name that was measured
     was measured, and dropping it would turn the hit rate into a statement
     about board completeness. */
  const oneLegged = scoreSessions([
    { d: "2026-08-01", side: "long", rows: [{ t: "A", px: 100 }] },
    { d: "2026-08-01", side: "short", rows: [{ t: "GONE", px: 50 }] },
  ], closesOf({ A: { "2026-08-02": 105 } }), ["2026-08-01", "2026-08-02"],
  { horizons: [1], statedK: 1 });
  const g = oneLegged.horizons[0];
  eq(g.n, 0, "no session carries a spread");
  eq(g.ls, null, "so the mean is withheld");
  eq(g.sd, null, "and so is its dispersion");
  close(g.hit, 1, "while the one measured name is still counted in the hit rate", 1e-9);
  eq(g.hitN, 1, "with its own denominator");
}

/* ---------- two populations, two hit rates, never their average --- */
{
  /* THE SPECIFIC MISTAKE THIS PARTITION EXISTS TO NEVER MAKE. The prior
     population hit everything and the current one hit nothing. Pooling them
     answers 50% — a figure belonging to neither experiment, and precisely the
     kind of number the product asserted for months without measuring. */
  const cal = Array.from({ length: 8 }, (_, i) => `2026-08-0${i + 1}`);
  const mk = (d) => ([
    { d, side: "long", rows: [{ t: "A", px: 100 }] },
    { d, side: "short", rows: [{ t: "C", px: 200 }] },
  ]);
  const boards = [
    ...mk("2026-08-01"), ...mk("2026-08-02"),      // prior
    ...mk("2026-08-05"), ...mk("2026-08-06"),      // current
  ];
  const closes = closesOf({
    A: { "2026-08-02": 110, "2026-08-03": 110, "2026-08-06": 90, "2026-08-07": 90 },
    C: { "2026-08-02": 190, "2026-08-03": 190, "2026-08-06": 210, "2026-08-07": 210 },
  });
  const epoch = "2026-08-05";
  const rec = scoreSessions(boards, closes, cal, { horizons: [1], statedK: 1, epoch });
  const h = rec.horizons[0];
  close(h.hit, 0, "the current population hit none of its four measured names", 1e-9);
  eq(h.hitN, 4, "over four names");
  close(h.priorHit, 1, "and the prior population hit all four of its own", 1e-9);
  eq(h.priorHitN, 4, "under its own denominator");
  for (const row of rec.horizons) {
    for (const key of Object.keys(row)) {
      ok(row[key] !== 0.5 || key === "k",
         `no key on the horizon row publishes the pooled 0.5 (${key})`);
    }
  }
  /* A MEASURED ZERO DISPERSION IS NOT AN ABSENT ONE. Both current sessions
     span exactly −15%, so their sd really is 0 — and it is published as 0,
     which is the opposite branch from the single-session null above. */
  eq(h.sd, 0, "two identical session spreads have a MEASURED dispersion of zero");
  ok(one0(h.se) === 0, "and a standard error of zero, which is a reading and not an absence");

  /* WHICH EXPERIMENT EACH DRAWN ROW BELONGS TO. */
  eq(rec.sessions.length, 4, "all four sessions scored");
  eq(rec.sessions.filter((r) => r.pre === true).length, 2, "two of them are pre-epoch");
  eq(rec.sessions.filter((r) => r.pre === false).length, 2, "and two are not");
  eq(rec.preShown, 2, "and the count rides the payload rather than being recounted");
  eq(rec.sessions[0].measured + rec.sessions[0].lost, rec.sessions[0].names,
     "every row's measured and lost partition its own published names");

  /* THE CAP IS WHY preShown EXISTS. Newest-first and capped at two, the drawn
     table is entirely post-epoch: the prior experiment then lives in the
     horizon means and nowhere a reader can see it, which is the state the
     page has to be able to describe. */
  const capped = scoreSessions(boards, closes, cal,
    { horizons: [1], statedK: 1, epoch, maxSessions: 2 });
  eq(capped.sessions.length, 2, "two rows drawn");
  eq(capped.preShown, 0, "none of them from the prior population");
  eq(capped.horizons[0].priorN, 2, "while its mean is still reported, over its own sessions");

  /* NO EPOCH, NO FLAG. `pre: false` on every row of an unpartitioned archive
     would assert a partition nobody stated. */
  const flat = scoreSessions(boards, closes, cal, { horizons: [1], statedK: 1 });
  ok(flat.sessions.every((r) => !("pre" in r)),
     "with no epoch no session row carries a pre flag at all");
  eq(flat.preShown, null, "and the count is null rather than 0 — nothing was partitioned");
}

/* ---------- the IC table splits at the epoch too ------------------ */
{
  /* THE MIRROR OF THE RETURN SCORER'S EPOCH CASE, against the evidence table.

     The feature ranks the names exactly backwards before the epoch and exactly
     forwards after it. Partitioned, that is −1 and +1: two experiments, both
     legible. Pooled, it is approximately nothing, and a reader would drop the
     strongest feature on the page as noise. */
  const cal = Array.from({ length: 6 }, (_, i) => `2026-08-0${i + 1}`);
  const closesSpec = {};
  const preRows = [], curRows = [];
  for (let i = 0; i < 6; i++) {
    preRows.push({ t: "P" + i, px: 100, s: i });
    curRows.push({ t: "Q" + i, px: 100, s: i });
    closesSpec["P" + i] = { "2026-08-02": 100 * (1 + (5 - i) * 0.01) };   // s up, return down
    closesSpec["Q" + i] = { "2026-08-05": 100 * (1 + i * 0.01) };         // s up, return up
  }
  const boards = [
    { d: "2026-08-01", side: "long", rows: preRows },
    { d: "2026-08-04", side: "long", rows: curRows },
  ];
  const closes = closesOf(closesSpec);
  const opts = { k: 1, minN: 5, pearson, percentileRank };

  const split = icTable(boards, closes, cal, { ...opts, epoch: "2026-08-04" });
  const sSplit = split.cols.find((c) => c.key === "s");
  close(sSplit.ic, 1, "the current population's coefficient is its own", 1e-9);
  eq(sSplit.n, 6, "over its own six pairs");
  close(sSplit.priorIc, -1, "and the prior population's is reported beside it, not into it", 1e-9);
  eq(sSplit.priorN, 6, "under its own count");
  eq(split.epoch, "2026-08-04", "and the partition date rides the table");

  const pooled = icTable(boards, closes, cal, opts);
  const sPooled = pooled.cols.find((c) => c.key === "s");
  ok(Math.abs(sPooled.ic) < 0.5,
     `pooling the two answers ${sPooled.ic} — the strongest feature on this fixture read ` +
     "as noise, which is the reading the partition exists to never publish");
  eq(sPooled.n, 12, "because it measured both experiments as one");
  ok(!("priorIc" in sPooled), "and with no epoch no prior column is drawn at all");

  /* AN EPOCH WITH NOTHING BEFORE IT DRAWS NO SECOND COLUMN, under the same
     rule the horizon rows keep. */
  const allAfter = icTable(boards, closes, cal, { ...opts, epoch: "2020-01-01" });
  const sAfter = allAfter.cols.find((c) => c.key === "s");
  ok(!("priorIc" in sAfter),
     "the prior column appears only when the prior population has something in it");
}

/* ---------- IC across horizons, and ordered by evidence ----------- */
{
  /* THE DECAY CURVE, over two features built to disagree about horizon.

       aligned — tracks the ONE-session move exactly and is merely good at two.
       lagging — is merely good at one session and perfect at two.

     The stated horizon is one session, so `lagging` is the weaker column there
     and its peak is somewhere else. A peak that simply echoed `k` would be
     undetectable on a fixture where the two coincide; this one is built so
     they do not. */
  const cal = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const closesSpec = {};
  const rows = [];
  const oneDay = [1, 2, 4, 3, 5, 6];        // one adjacent swap against the index
  const twoDay = [1, 2, 3, 4, 5, 6];        // monotone in the index
  for (let i = 0; i < 6; i++) {
    rows.push({
      t: "T" + i, px: 100,
      lagging: i,                                    // ranks 1..6
      aligned: [10, 20, 40, 30, 50, 60][i],          // ranks 1,2,4,3,5,6
      flat: 0.5,                                     // no variation to rank
    });
    closesSpec["T" + i] = {
      "2026-08-02": 100 * (1 + oneDay[i] / 100),
      "2026-08-03": 100 * (1 + twoDay[i] / 100),
    };
  }
  const table = icTable([{ d: "2026-08-01", side: "long", rows }], closesOf(closesSpec), cal,
    { k: 1, minN: 5, pearson, percentileRank, horizons: [1, 2] });

  const lagging = table.cols.find((c) => c.key === "lagging");
  close(lagging.ic, 0.943, "the STATED horizon reports the stated horizon's coefficient", 1e-3);
  eq(lagging.curve.length, 2, "with a point per measured horizon beside it");
  eq(lagging.curve[0].k, 1, "ordered by horizon");
  eq(lagging.curve[1].k, 2, "shortest first");
  close(lagging.curve[1].ic, 1, "and the two-session relation is the perfect one", 1e-9);
  eq(lagging.icPeakK, 2,
     "SO THE PEAK IS NOT THE STATED HORIZON — which is the whole reading a decay curve " +
     "carries, and is invisible on a table measured at one horizon");
  close(lagging.icPeak, 1, "and the peak carries its own coefficient", 1e-9);
  eq(lagging.curve[0].n, 6, "every point states the pairs it was measured on");
  deep(table.horizons, [1, 2], "the horizon set rides the table");

  const aligned = table.cols.find((c) => c.key === "aligned");
  close(aligned.ic, 1, "the other column peaks at the stated horizon instead", 1e-9);
  eq(aligned.icPeakK, 1, "and says so");

  /* ORDERED BY |IC|, WITH THE UNMEASURED LAST. Alphabetically these are
     aligned, flat, lagging — so an alphabetical table seats the one column
     that has nothing to say in the middle of the two that do, and the reader
     scanning from the top meets it before the weaker measurement. */
  const keys = table.cols.map((c) => c.key);
  deep(keys, ["aligned", "lagging", "flat"],
    "ordered by the strength of the evidence, not by the spelling of the key");
  eq(table.cols[2].ic, null, "and the unmeasured column sorts last rather than being dropped");
  ok(/no variation/.test(table.cols[2].reason), "still carrying its reason");

  /* THE SIGN IS THE RELATION AND THE MAGNITUDE IS THE EVIDENCE. A column that
     predicts reliably downward must outrank a weak positive, or the table
     hides every short-side finding it has. */
  const flipped = rows.map((r, i) => ({ ...r, bear: -[10, 20, 40, 30, 50, 60][i], meek: [1, 6, 2, 5, 3, 4][i] }));
  const signed = icTable([{ d: "2026-08-01", side: "long", rows: flipped }],
    closesOf(closesSpec), cal, { k: 1, minN: 5, pearson, percentileRank });
  const order = signed.cols.map((c) => c.key);
  ok(order.indexOf("bear") < order.indexOf("meek"),
     "a strong negative coefficient outranks a weak positive one — the table ranks by " +
     "|IC| because a feature that predicts downward is evidence, not the absence of it");

  /* ONE HORIZON, NO CURVE. A curve of one point is not a curve, and a key
     that is always present teaches a renderer to draw an empty sparkline. */
  const single = icTable([{ d: "2026-08-01", side: "long", rows }], closesOf(closesSpec), cal,
    { k: 1, minN: 5, pearson, percentileRank });
  ok(!("curve" in single.cols[0]) && !("icPeak" in single.cols[0]),
     "a single-horizon table carries no curve and no peak");
  ok(!("horizons" in single), "nor a horizon set");
}

/* ---------- featureColumnsOf: schema-driven, with two exclusions -- */
{
  const cols = featureColumnsOf({
    t: "A", r: 3, px: 101.5, s: 42, cnv: 70, chg: 0.01,
    gRegime: "short", spark: "abc",
    fam: { F: 10, P: -5, D: null, V: 0, O: 38 },
    pr: [120, null, -80],
    netPrem: 1e6,
    skew: 0.04, term: -0.02, atmIv: 0.31, skewDays: 25,
  });
  eq(cols.r, undefined, "the published rank is excluded: it is the score's ordering restated");
  eq(cols.px, undefined, "the price level is excluded: across names it ranks share prices");
  eq(cols.s, 42, "numeric keys become columns");
  eq(cols["fam.F"], 10, "fam explodes to fam.*");
  eq(cols["fam.D"], undefined, "a null family value contributes nothing");
  eq(cols["pr.0"], 120, "pr explodes to pr.*");
  eq(cols["pr.1"], undefined, "with nulls dropped");
  eq(cols.gRegime, undefined, "strings have no number to contribute");

  /* THE CHAIN SCALARS ARE ARCHIVED BUT NOT POOLED, and the reason is the one
     boardRow already states for `im`: each is read at that name's own nearest
     listed expiry past a floor, which is eight days out on SPY and ninety on a
     thin name. Pooled across names the coefficient would be a correlation
     between tenors as much as between skews.

     A name against its OWN history is like-for-like, which is what they are on
     the board row for. Only the cross-section is refused. */
  for (const key of ["skew", "term", "atmIv", "skewDays"]) {
    eq(cols[key], undefined,
       `${key} is excluded from the cross-sectional table: it is a per-name-horizon quantity`);
  }
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
  ok(/sd \/ sqrt\(n\)/.test(RECORD_NOTES.dispersion),
     "the dispersion note names the construction of the standard error");
  ok(/not a test/.test(RECORD_NOTES.dispersion) && /p-value/.test(RECORD_NOTES.dispersion),
     "and refuses the test the overlapping windows would not support");
  ok(/over NAMES/.test(RECORD_NOTES.pooled) && /n beside it counts sessions/.test(RECORD_NOTES.pooled),
     "the pooled note keeps the two denominators apart in words as well as in fields");
  ok(/belong to neither/.test(RECORD_NOTES.pooled),
     "and says why the two populations are not averaged into one figure");
}

console.log(`✓ flows-record: ${checks} assertions — a calendar that skips what was never open, ` +
  `attrition excluded from every mean and counted beside it, a spread that refuses one leg, ` +
  `horizons that count sessions rather than rows, and an IC that is Spearman by construction ` +
  `with null-and-reason where there is nothing to measure, a selection epoch that reports two ` +
  `populations separately rather than averaging them into one hit rate — on the returns AND on ` +
  `the evidence table, over a fixture where pooling reads the strongest feature as noise — a ` +
  `sample dispersion whose divisor the fixture can tell apart from the population one and which ` +
  `is null at n=1 and a measured 0 at n=2, a hit rate pooled over names rather than averaged ` +
  `over session rates, and an IC measured at four horizons and ordered by evidence rather than ` +
  `by the alphabet`);
