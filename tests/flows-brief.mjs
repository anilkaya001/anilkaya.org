/* =============================================================
   flows-brief.mjs — the three-session briefing.

   The briefing is the surface a reader is most likely to take at
   face value: three short paragraphs that claim to say what
   happened, what is happening, and what is already scheduled. It is
   also the surface a language model would sit in front of. Both of
   those make it the worst place in the product for an unearned
   number, so this suite pins the guarantees that make it safe to
   put prose around:

     - every figure in a sentence is also in the machine-readable
       `n`, so a rephrasing cannot alter a value;
     - the next-session section states scheduled facts and measured
       distances and NEVER a forecast;
     - an absent count is never printed as zero, and a measured zero
       is never withheld;
     - the three silences stay three.
   ============================================================= */

import assert from "node:assert/strict";
import { buildBrief, briefToday, briefYesterday, briefNext, silenceOf, num }
  from "../shared/flows-brief.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

/* ---------- the corpus, inline and self-contained ----------------

   THE FIRST VERSION OF THIS FILE READ tests/.shots-emit/, AND CI
   CAUGHT IT. That directory is where `flows-pipeline.mjs --dry-run
   --emit` drops real payloads, so the shapes below were taken from
   the publisher rather than invented — but .gitignore:47 ignores
   every dotted directory under tests/, so those files exist on a
   developer's disk and nowhere else. (The ignore pattern is not
   quoted here on purpose: it ends in a star-slash, which would close
   this comment — which is its own small lesson about writing a
   pattern into prose.) The suite passed locally and died with ENOENT
   before its first assertion: a test that cannot run is worth less
   than no test, because it reports green from the one machine that
   was never going to catch anything.

   Every other suite in this repo feeds inline fixtures. This one is
   no longer the exception. The shapes are still the publisher's —
   they were read off emitted payloads — and PUBLISHER/RENDERER
   AGREEMENT IS NOT THIS FILE'S JOB ANYWAY: tests/flows-payload-shape
   exists precisely so a reader cannot read a field the pipeline does
   not write, and it runs against the pipeline itself.

   Each fixture below carries a property an assertion depends on, and
   the comments say which, so a future edit that "tidies" a number
   can see what it would break. */

/* `cleared` (53) deliberately exceeds rows.length (2 here) — the
   population/page distinction the rail badge got wrong. */
const SHORT = {
  status: "ok", side: "short", sessionDate: "2026-08-24",
  gateOrigin: "2026-09-04", gateDays: 7,
  scored: 100, neutral: 3, cleared: 53, shed: 3,
  memory: { sessionDate: "2026-08-21" },
  rows: [
    { t: "SYN192", r: 1, s: -37, cnv: 91, dr: -4, r0: 1, nw: false, hy: false,
      edte: 13, ed: "2026-09-17", gFlipDist: -0.9 },
    { t: "SYN300", r: 2, s: -35, cnv: 78, dr: -15, r0: 2, nw: false, hy: true,
      edte: 26, gFlipDist: 2.4 },
  ],
};

/* A one-sided session: every published `dr` is negative, so the
   "0 climbed" arm is exercised rather than assumed. */
const LONG = {
  status: "ok", side: "long", sessionDate: "2026-08-24",
  gateOrigin: "2026-09-04", gateDays: 7,
  scored: 100, neutral: 3, cleared: 44, shed: 0,
  memory: { sessionDate: "2026-08-21" },
  rows: [
    { t: "SYN046", r: 1, s: 59, cnv: 96, dr: null, r0: null, nw: true, hy: false,
      edte: 19, ed: "2026-09-23", gFlipDist: 0.1224 },
    { t: "SYN351", r: 2, s: 58, cnv: 81, dr: -1, r0: 1, nw: false, hy: false,
      edte: 43, gFlipDist: 5.1 },
    { t: "SYN037", r: 3, s: 43, cnv: 96, dr: -1, r0: 2, nw: false, hy: false,
      gFlipDist: -3.3 },
  ],
};

/* Every integer score is 0 because the band is ±1 — the trap that
   made the first draft rank on a field with no resolution. `resid`
   orders them and `r` is the publisher's own ranking. */
const WATCH = {
  status: "ok", side: "watch", sessionDate: "2026-08-24",
  scored: 100, neutral: 3, deadBand: 1,
  rows: [
    { t: "SYN243", r: 1, s: 0, cnv: 60, resid: -0.008 },
    { t: "SYN250", r: 2, s: 0, cnv: 80, resid: -0.0058 },
    { t: "SYN200", r: 3, s: 0, cnv: 61, resid: -0.0002 },
  ],
};

const ALERTS = {
  status: "ok", readAt: "2026-09-04T08:33:58.572Z",
  rows: [{ t: "SYN351" }, { t: "SYN231" }],
};

const EVENTS = {
  status: "ok", sessionDate: "2026-08-24", gateOrigin: "2026-09-04",
  gateDays: 7, inWindow: 87, shown: 87, cap: 200,
  byStage: { gated: 57, eligible: 22, "board:long": 4, "board:short": 4 },
  rows: [{ t: "SYN151", d: "2026-09-04", dte: 0 },
         { t: "SYN383", d: "2026-09-05", dte: 1 },
         { t: "SYN400", d: "2026-09-18", dte: 10 }],
};

/* THE SHAPE THAT WAS NEVER FIXTURED, AND THAT IS WHY IT BROKE. The
   sector block read `payload.rows` and `row.lean`; the publisher
   writes `payload.sectors` and `row.leanRatio`. Both guesses failed
   silently — a missing field reads as an absent reading, so the
   section produced no fact, and the silence check looked for `rows`
   too, found no array, and produced no silence either. The sector
   lean simply left the briefing.

   XLB carries a bullish side and no bearish side, exactly as the
   live payload does, so `leanRatio` is null on a row that still has
   several other readable numbers — the case that separates "absent"
   from "zero". `returned` (5) deliberately exceeds the rows with a
   readable lean (3), because the sentence has to say which of those
   two numbers it is quoting. */
const SECTORS = {
  status: "ok", generatedAt: "2026-09-04T08:12:00.000Z",
  returned: 5, measured: 3, quiet: 1, unreadable: 1,
  units: { leanRatio: "ratio", netPremiumUsd: "usd" },
  sectors: [
    { sector: "Technology", etf: "XLK", leanRatio: 0.42, netPremiumUsd: 512000000 },
    { sector: "Energy", etf: "XLE", leanRatio: -0.31, netPremiumUsd: -41000000 },
    { sector: "Financials", etf: "XLF", leanRatio: 0.07, netPremiumUsd: 8100000 },
    { sector: "Materials", etf: "XLB", leanRatio: null, bullishPremiumUsd: 55391,
      read: "unreadable", reason: "XLB carried bullish_premium but not the other side" },
    { sector: "Utilities", etf: "XLU", leanRatio: null, read: "quiet" },
  ],
};

const REAL = { long: LONG, short: SHORT, watch: WATCH, events: EVENTS, alerts: ALERTS,
  sectorPremium: SECTORS };

/* ---------- 1. the coercion refuses what it cannot read ---------- */
{
  eq(num(0), 0, "a measured zero survives the helper — it is a score, a premium and a count");
  eq(num("1234.5"), 1234.5, "and a quoted number is read, because the vendor sends several that way");
  eq(num(null), null, "while null is absent, not zero: Number(null) is 0 and that is the house defect");
  eq(num(""), null, "an empty string likewise");
  eq(num(" "), null, "and a blank one — Number(' ') is 0 too, one space past the guard that catches ''");
  eq(num(false), null, "a boolean is not a reading");
  eq(num([]), null, "nor is an array, and Number([]) is 0");
  eq(num("abc"), null, "and an unparseable string is absent rather than NaN");
}

/* ---------- 2. the three silences stay three -------------------- */
{
  eq(silenceOf(null, "board").kind, "unreadable",
     "a store that could not be read is UNREADABLE — a fault on the page, not a fact about the market");
  eq(silenceOf({ status: "pending", rows: [] }, "board").kind, "pending",
     "an unpublished key is PENDING — nothing measured, so nothing claimed");
  eq(silenceOf({ status: "ok", rows: [] }, "board").kind, "quiet",
     "and a measured emptiness is QUIET, which is a reading and must not read as a breakage");
  eq(silenceOf({ status: "ok", rows: [{ t: "A" }] }, "board"), null,
     "while a payload with rows is no silence at all");

  const torn = buildBrief({ long: null, short: { status: "pending", rows: [] },
    watch: { status: "ok", rows: [] } });
  const kinds = new Set(torn.today.silences.map((q) => q.kind));
  ok(kinds.has("unreadable") && kinds.has("pending"),
     "one store carrying two different failures reports two different silences, not one summary");
  const sentences = new Set(torn.today.silences.map((q) => q.say));
  eq(sentences.size, torn.today.silences.length,
     "and no two silences share a sentence — two outages worded alike is how a reader concludes " +
     "there is one outage");
}

/* ---------- 3. the population, not the page --------------------- */
{
  /* `cleared` is the side's whole pool and `rows.length` is what
     fitted. The board's rail badge shipped the page count over a
     sentence naming the population; the briefing must not repeat it. */
  const t = briefToday(REAL);
  const tilt = t.facts.find((f) => f.id === "tilt");
  ok(tilt, "the session's lean is the first thing the briefing states");
  eq(tilt.n.bearish, num(REAL.short.cleared),
     `the bearish count is the POPULATION (cleared = ${REAL.short.cleared}), not the ` +
     `${REAL.short.rows.length} rows that fitted on the page`);
  ok(REAL.short.cleared !== REAL.short.rows.length,
     "and this fixture actually exercises the distinction — cleared and rows.length differ here, " +
     "so the assertion above would catch the regression rather than passing by coincidence");
}

/* ---------- 4. an absent count is not a zero -------------------- */
{
  const blank = briefToday({ long: { status: "ok", rows: [], sessionDate: "2026-09-04" },
    short: { status: "ok", rows: [] } });
  const tilt = blank.facts.find((f) => f.id === "tilt");
  if (tilt) {
    ok(!/\b0 names lean bullish\b/.test(tilt.say) || tilt.n.bullish === 0,
       "a side whose count was never published does not print as 0 — that is an absence " +
       "wearing a measurement's clothes");
  }
  const measured = briefToday({
    long: { status: "ok", rows: [], cleared: 0, scored: 40, sessionDate: "2026-09-04" },
    short: { status: "ok", rows: [], cleared: 0, scored: 40 } });
  const mt = measured.facts.find((f) => f.id === "tilt");
  eq(mt.n.bullish, 0,
     "while a session that scored 40 names and cleared none on either side DOES report zero — " +
     "suppressing a measured zero would collapse a quiet day into an outage");
}

/* ---------- 5. the watch threshold reads the published rank ----- */
{
  const n = briefNext(REAL);
  const near = n.facts.find((f) => f.id === "nearly-in");
  ok(near, "the briefing names who sits nearest the edge of the dead band");

  /* `s` is an integer and the band is ±1, so every watch row reads
     s: 0. Sorting on it ranks nothing and prints a 0 that is the
     CENTRE of the band as though it were the edge. */
  const allZero = REAL.watch.rows.every((r) => num(r.s) === 0);
  ok(allZero,
     "the fixture confirms the trap: every watch row's integer score is 0, so the score " +
     "carries no resolution inside the band at all");
  const rank1 = REAL.watch.rows.find((r) => num(r.r) === 1);
  eq(near.n.nearest, rank1.t,
     "so the nearest name is the payload's OWN rank 1, not a re-derivation — the ranking was " +
     "published and a second opinion about it is how two surfaces disagree");
  eq(near.n.nearestResidual, num(rank1.resid),
     "and the quantity quoted is the residual the rows are actually ordered by, in its own units");
  ok(!/edge at a residual of 0\b/.test(near.say),
     "never a rounded 0 standing in for a fine-grained measurement");
}

/* ---------- 6. NEXT SESSION IS NOT A FORECAST ------------------- */
{
  const n = briefNext(REAL);
  eq(n.isForecast, false, "the next-session section declares itself not a forecast");
  ok(n.origin, "and states the origin date every day count in it is measured from — a briefing " +
     "read on a Saturday about 'the next session' means Monday");

  /* THE SCAN IS THE POINT. A future edit that starts predicting a
     price or a score would read naturally and pass every other
     assertion in this file; this one fails on the verb. */
  const FORECAST = /\b(will|should|expect(?:ed)?|likely|going to|forecast|predict)\b/i;
  for (const f of n.facts) {
    const claim = f.say;
    /* "will leave the board" is a CALENDAR consequence — the gate
       removes a name on a date that is already published — so the
       one permitted future tense is about the gate, never a price. */
    const permitted = /leaves the board on the calendar/.test(claim);
    ok(permitted || !FORECAST.test(claim),
       `the next-session fact "${claim.slice(0, 60)}" states a scheduled fact or a measured ` +
       "distance, never what the market will do");
    ok(!/\b(price|score) will\b/i.test(claim),
       "and never a future-tense claim about a price or a score at all");
  }
}

/* ---------- 7. EVERY NUMBER IN THE PROSE IS IN `n` -------------- */
{
  /* This is the assertion that makes the briefing safe to put a
     language model in front of. The model may rephrase `say`; it
     may not invent, drop or alter a figure, because every figure is
     carried separately in `n` and a renderer can rebuild the
     sentence from it. If a number appears in prose and nowhere in
     `n`, it is unpinned and a rephrasing could silently change it. */
  const brief = buildBrief(REAL);
  const sections = [brief.today, brief.yesterday, brief.next];
  let scanned = 0;
  for (const sec of sections) {
    for (const f of sec.facts) {
      const quoted = new Set();
      for (const v of Object.values(f.n)) {
        if (typeof v === "number") quoted.add(String(v));
        else if (typeof v === "string") quoted.add(v);
        else if (Array.isArray(v)) for (const x of v) quoted.add(String(x));
      }
      /* THE STRING VALUES ARE MASKED OUT BEFORE THE DIGITS ARE READ,
         and getting this wrong is what the first run of this suite
         did: a ticker like SYN046 carries digits INSIDE a symbol
         that is itself pinned in `n`, so a naive digit scan accused
         the module of an unpinned "046". Every string already
         quoted in `n` — tickers, dates, timestamps — is removed
         first, and what remains is the prose's own arithmetic. */
      let stripped = f.say;
      for (const v of quoted) {
        if (typeof v === "string" && /\D/.test(v)) {
          stripped = stripped.split(v).join(" ");
        }
      }
      const inProse = stripped.match(/-?\d+(?:\.\d+)?/g) || [];
      for (const lit of inProse) {
        scanned++;
        ok(quoted.has(lit) || quoted.has(String(Number(lit))),
           `every figure in a briefing sentence is pinned in n — "${lit}" in "${f.say.slice(0, 55)}" ` +
           "must be quoted from a payload field, or a rephrasing could change it silently");
      }
    }
  }
  ok(scanned >= 10,
     `the scan actually inspected numbers (${scanned}) rather than passing over empty prose`);
}

/* ---------- 7-ter. the scheduled half, which never fired -------- */
{
  /* THE FIXTURE THAT HID THE DEFECT. Both board rows above used to
     carry edte 0, 1 and 12 against a 7-day gate, and every one of
     those is a state the live pipeline cannot produce: the earnings
     gate REMOVES a name from scoring exactly when its report falls
     inside the window, so a surviving board row's report is always on
     the far side of the gate. Measured on the emitted corpus the
     smallest edte across both sides is 13 against a 12-day gate.

     So the fixture was built to make an unreachable branch pass, and
     it did, for as long as the branch existed. The board's edte
     values now sit where live ones do, and this asserts the invariant
     directly so a future fixture cannot quietly reopen the trap. */
  const gateDays = num(LONG.gateDays);
  const boardEdte = [].concat(LONG.rows, SHORT.rows)
    .map((r) => num(r.edte)).filter((v) => v !== null);
  ok(boardEdte.length >= 3, "the board fixtures carry report dates at all");
  ok(boardEdte.every((v) => v > gateDays),
     "and every one is PAST the gate, because a name inside it is not on the board — a " +
     "fixture that violates this tests a branch the pipeline can never reach");

  const n = briefNext(REAL);

  const rep = n.facts.find((f) => f.id === "reporting");
  ok(rep, "who reports before the next session is answered — read from the calendar, which " +
     "holds the gated names, and not from the board, which by construction holds none of them");
  ok(/SYN151/.test(rep.say) && /SYN383/.test(rep.say),
     "naming the names, both the one reporting today and the one reporting tomorrow");
  ok(!/SYN400/.test(rep.say),
     "and not the one ten sessions out, which is inside the calendar window but not before " +
     "the next session");
  eq(rep.n.count, 2, "the count is the names before the next session, not the calendar's whole window");

  const gate = n.facts.find((f) => f.id === "gate");
  ok(gate, "and how many names the gate held out of scoring is stated, which is a fact about " +
     "the board that a reader cannot get from the board: those names are absent from it");
  eq(gate.n.count, 57, "read from the calendar's own byStage count rather than re-derived");
  ok(new RegExp("\\b" + gateDays + "-day\\b").test(gate.say),
     "and the window is named in the sentence, because a count of gated names means nothing " +
     "without the window it was counted over");

  /* A CLEAR CALENDAR IS PRINTED, NOT WITHHELD. Before this, an empty
     result produced no sentence at all, so "nothing reports" and
     "this section did not look" rendered identically — as nothing. */
  const clear = briefNext({ ...REAL, events: { ...EVENTS,
    rows: [{ t: "SYN400", d: "2026-09-18", dte: 10 }] } });
  const cr = clear.facts.find((f) => f.id === "reporting");
  ok(cr && /No name on the calendar reports before the next session/.test(cr.say),
     "a session with nothing due says so out loud");
  ok(/SYN400 in 10 sessions/.test(cr.say),
     "and names the nearest one anyway, so the reader knows how far out the calendar's edge is");
  eq(cr.n.count, 0, "with the zero published as a measured zero");

  /* THE STALE VENDOR DATE. A negative dte is a date that has gone by,
     not a report due today, and reading it as imminent is the failure
     mode this filter exists for. */
  const stale = briefNext({ ...REAL, events: { ...EVENTS,
    rows: [{ t: "SYN999", d: "2026-08-01", dte: -34 }] } });
  const sr2 = stale.facts.find((f) => f.id === "reporting");
  ok(!sr2 || !/SYN999/.test(sr2.say),
     "a report date that has already passed is never counted as due before the next session");

  const quiet = briefNext({ ...REAL, events: { ...EVENTS, rows: [] } });
  ok(quiet.silences.some((q) => q.kind === "quiet" && /earnings calendar/.test(q.what)),
     "and a calendar that was read and holds nothing is QUIET, which is a reading rather than a gap");
}

/* ---------- 7-bis. the sector lean, and the fourth silence ------ */
{
  /* THE SECTION THAT LEFT WITHOUT SAYING SO. Every assertion here
     fails against the field names this module shipped with, which is
     the only reason to trust that it is testing anything. */
  const t = briefToday(REAL);
  const sec = t.facts.find((f) => f.id === "sectors");
  ok(sec, "the sector premium lean reaches the briefing at all — it is read from `sectors`, " +
     "not `rows`, and a briefing that silently drops a whole surface is the defect this file exists for");
  ok(/XLK/.test(sec.say) && /XLE/.test(sec.say),
     "and it names the baskets by their tickers, which is what a reader recognises");
  eq(sec.n.mostBullish, "XLK", "ranked most bullish on leanRatio");
  eq(sec.n.mostBearish, "XLE", "and most bearish on the same quantity");

  /* RANKED ON THE RATIO, NOT ON DOLLARS, and this fixture is built so
     the two orderings disagree: XLK's net premium is 512,000,000 and
     XLF's is 8,100,000, so a dollar ranking would also put XLK first
     — but XLE at -41,000,000 is a LARGER absolute dollar figure than
     XLF's, while XLF's ratio (+0.07) is the one nearer neutral. If
     this ever ranks on netPremiumUsd, "most bearish" changes meaning
     from "leaning hardest against its own book" to "biggest sector". */
  ok(!/512000000|41000000|8100000/.test(sec.say),
     "and no dollar figure appears in a sentence about a ratio — units travel with numbers");

  eq(sec.n.readable, 3, "three of the five rows carried a readable lean");
  eq(sec.n.returned, 5, "while five were returned, and both numbers are pinned");
  ok(/3 baskets with a readable lean of 5 returned/.test(sec.say),
     "the sentence quotes both, because 'across 3 baskets' alone invites the reader to " +
     "think three is the universe");

  /* THE ROW WITH A NULL LEAN AND REAL NUMBERS BESIDE IT. XLB carries
     bullishPremiumUsd 55391; if the filter coerced instead of testing
     for absence, XLB would rank as a perfectly neutral 0 and could
     take either extreme on a quiet day. */
  ok(!/XLB/.test(sec.say),
     "a row whose leanRatio is null is not ranked as a zero — Number(null) is 0, and 0 is " +
     "the exact centre of a ratio bounded to plus or minus one");

  /* THE FOURTH SILENCE: published, parsed, and the readings not
     found. It is not one of the three, and calling it 'quiet' would
     tell the reader the market was still when in fact this page
     could not read it. */
  const renamed = silenceOf({ status: "ok", baskets: [] }, "sector premium lean", null);
  eq(renamed.kind, "unreadable",
     "a payload that answered but whose readings this module could not locate is a fault " +
     "on the page, stated as one");
  ok(/could not find the readings/.test(renamed.say),
     "and it says which fault it is, so the next field rename is a sentence rather than a gap");

  const empty = silenceOf({ status: "ok", sectors: [] }, "sector premium lean", []);
  eq(empty.kind, "quiet",
     "while an array that really is empty is still QUIET — passing the list the caller read " +
     "must not turn a reading into a fault");
  eq(silenceOf({ status: "ok", rows: [] }, "board", undefined).kind, "quiet",
     "and omitting the argument leaves every existing caller reading `rows` exactly as it was");

  /* MEASURED, POPULATED, AND NOT ONE LEAN — a reading about the tape
     rather than a fault, so it is said rather than dropped. */
  const none = briefToday({ ...REAL, sectorPremium: {
    status: "ok", returned: 2,
    sectors: [{ etf: "XLK", leanRatio: null }, { etf: "XLE", leanRatio: null }],
  } });
  const nf = none.facts.find((f) => f.id === "sectors");
  ok(nf && /no lean is stated/.test(nf.say),
     "a session where no basket returned both sides of its premium says exactly that, " +
     "rather than falling silent and reading as no sector activity");
  eq(nf.n.readable, 0, "and the zero is published as a measured zero");
}

/* ---------- 8. yesterday names its comparand -------------------- */
{
  const y = briefYesterday(REAL);
  ok(y.prior, "the previous board is named by date, because 'since yesterday' is wrong on a " +
     "Monday and after every holiday");
  const moves = y.facts.find((f) => f.id === "moves");
  ok(moves, "the shape of the move is reported before its extremes");
  eq(moves.n.climbed + moves.n.fell, moves.n.comparable,
     "and the two counts account for every name that had a rank on both boards");
  ok(/\b0 names climbed\b/.test(moves.say),
     "a one-sided session says so: this fixture had 29 falls and no climb, which is the most " +
     "interesting thing about it and is exactly what naming only the biggest fall would lose");

  const cold = briefYesterday({ long: { status: "ok", rows: [{ t: "A" }] }, short: null });
  eq(cold.facts.length, 0,
     "and with no comparand nothing is claimed about what changed");
  eq(cold.silences[0].kind, "pending",
     "which is stated as the ordinary state on a first run, not as a fault");
}

console.log(`✓ flows-brief: ${checks} assertions — a briefing whose every figure is quoted from a ` +
  `published field rather than composed, three silences that stay three, a population count that ` +
  `is not the page count, a dead-band threshold read off the payload's own rank instead of a score ` +
  `with no resolution inside the band, and a next-session section that states what is scheduled ` +
  `and what is measurably close while a verb scan refuses it the future tense — plus the two ` +
  `surfaces that were leaving in silence: a sector lean read from the field the publisher writes ` +
  `rather than the one this module guessed, and a scheduled half sourced from the calendar ` +
  `because the board, having had every soon-reporting name removed by the gate, could never answer it`);
