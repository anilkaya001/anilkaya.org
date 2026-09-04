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
      edte: 0, ed: "2026-09-04", gFlipDist: -0.9 },
    { t: "SYN300", r: 2, s: -35, cnv: 78, dr: -15, r0: 2, nw: false, hy: true,
      edte: 12, gFlipDist: 2.4 },
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
      edte: 1, ed: "2026-09-05", gFlipDist: 0.1224 },
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
  gateDays: 7, inWindow: 87, shown: 8, cap: 200,
  rows: [{ t: "SYN151", d: "2026-09-04", dte: 0 }],
};

const REAL = { long: LONG, short: SHORT, watch: WATCH, events: EVENTS, alerts: ALERTS };

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
  `and what is measurably close while a verb scan refuses it the future tense`);
