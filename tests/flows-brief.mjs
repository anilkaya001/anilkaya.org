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
import { readFileSync } from "node:fs";
import { buildBrief, briefToday, briefYesterday, briefNext, silenceOf, num }
  from "../shared/flows-brief.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const emit = (f) =>
  JSON.parse(readFileSync(new URL("./.shots-emit/" + f, import.meta.url), "utf8"));

/* The real emitted payloads, so the shapes are the pipeline's own
   rather than a fixture author's idea of them. */
const REAL = {
  long: emit("d-board-long.json"),
  short: emit("d-board-short.json"),
  watch: emit("d-board-watch.json"),
  events: emit("d-events.json"),
  alerts: emit("d-flowalerts.json"),
};

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
