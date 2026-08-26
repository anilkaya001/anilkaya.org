/* Contracts for WHICH NAMES THE BOARD IS ALLOWED TO SEE.

   This file exists because of one live measurement: on 2026-08-26 the board
   published ELEVEN names, and every stage that produced that number was
   individually defensible. The selection rule is now the thing that decides
   what the score is a cross-section OF, which makes it a correctness surface
   rather than a configuration detail. */

import assert from "node:assert/strict";
import {
  capBands, selectCoverage, NDX_100, NDX_AS_OF, SELECTION_EPOCH,
  PICK_SIZE, PICK_INDEX, UNIVERSE_NOTES,
} from "../shared/flows-universe.js";
import { deepNames, DEEP_NAMES, SCREENER_PAGE_ROWS } from "../scripts/flows-pipeline.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* ---------- the band ladder ------------------------------------- */
{
  const bands = capBands({ min: 1e9, max: 4e12, ratio: 1.3 });
  ok(bands.length > 25,
     `the ladder is ${bands.length} bands, not the six it replaces — and the band count IS ` +
     "the pagination, because the vendor caps every band at ~50 rows and offers no page parameter");

  /* DISJOINT AND GAPLESS. A gap loses names to nobody's band, and the loss is
     invisible in the run log, which prints only what each band returned. This
     is the assertion the hand-written six-band ladder never had. */
  for (let i = 1; i < bands.length; i++) {
    eq(bands[i][0], bands[i - 1][1],
       `band ${i} starts exactly where band ${i - 1} ends — no gap, no overlap`);
  }
  eq(bands[0][0], 1e9, "the ladder starts at the universe floor");
  eq(bands[bands.length - 1][1], null,
     "and the top band is UNBOUNDED, so the largest companies are never above the ladder");
  ok(bands.slice(0, -1).every(([lo, hi]) => hi > lo),
     "every bounded band is non-empty");

  /* EQUAL RATIO, NOT EQUAL WIDTH. Listed companies are roughly log-uniform in
     market cap, so equal ratio spreads the ~50-row cap's pressure evenly.
     Equal width would saturate the bottom band and waste the top ones — which
     is exactly what the old $1-3B band did on every single run. */
  for (let i = 1; i < bands.length - 1; i++) {
    const r = bands[i][1] / bands[i][0];
    ok(Math.abs(r - 1.3) < 1e-9, `band ${i} has the stated ratio, not an arbitrary width`);
  }

  eq(capBands({ min: 0 }).length, 0, "a nonsense floor yields no ladder rather than an infinite one");
  eq(capBands({ ratio: 1 }).length, 0, "and a ratio of 1 would never terminate, so it yields none");
  ok(SCREENER_PAGE_ROWS === 50,
     "the page cap the ladder is sized against is named, not repeated as a literal");
}

/* ---------- the enrichment pool --------------------------------- */
{
  const uni = [];
  for (let i = 0; i < 300; i++) {
    uni.push({ ticker: `T${String(i).padStart(3, "0")}`, marketcap: (300 - i) * 1e9 });
  }
  // Two index members deliberately placed far outside the size cohort.
  uni.push({ ticker: "SMALLNDX", marketcap: 1.1e9 });
  uni.push({ ticker: "TINYNDX", marketcap: 1.05e9 });

  const picked = selectCoverage(uni, { count: 100, guaranteed: ["SMALLNDX", "TINYNDX"] });
  eq(picked.length, 102, "the pool is the size cohort PLUS the guaranteed names, not capped at the count");

  const bySize = picked.filter((p) => p.why === PICK_SIZE);
  eq(bySize.length, 100, "exactly `count` names are chosen on size");
  eq(bySize[0].row.ticker, "T000", "the largest name is in");

  /* THE GUARANTEE IS ADDITIVE, AND THAT IS THE WHOLE REASON A DATED CONSTANT
     IS TOLERABLE. Guarantee-first with a cap would let a rotten index list
     push real large caps off the board — the one way a stale list could
     produce a wrong reading rather than a wasted call. */
  const added = picked.filter((p) => p.why === PICK_INDEX).map((p) => p.row.ticker).sort();
  assert.deepEqual(added, ["SMALLNDX", "TINYNDX"],
    "a guaranteed name far below the size cohort is ADDED"); checks++;
  ok(picked.some((p) => p.row.ticker === "T099"),
     "and no size-cohort name was displaced to make room for it");

  /* A GUARANTEED NAME THE SCREEN DID NOT RETURN CANNOT BE CONJURED. */
  const absent = selectCoverage(uni, { count: 5, guaranteed: ["NOT_LISTED_ANYWHERE"] });
  ok(!absent.some((p) => p.row.ticker === "NOT_LISTED_ANYWHERE"),
     "a guaranteed ticker absent from the universe is not invented — the pool is a SUBSET of what was screened");

  /* DETERMINISM. An unstable pool makes the archive incomparable session to
     session for a reason no reader could see. Ties on market cap break on
     ticker so two runs over the same response enrich the same names. */
  const tied = [
    { ticker: "BBB", marketcap: 5e9 }, { ticker: "AAA", marketcap: 5e9 },
    { ticker: "CCC", marketcap: 5e9 },
  ];
  const once = selectCoverage(tied, { count: 2, guaranteed: [] }).map((p) => p.row.ticker);
  const twice = selectCoverage([...tied].reverse(), { count: 2, guaranteed: [] }).map((p) => p.row.ticker);
  assert.deepEqual(once, ["AAA", "BBB"], "ties break on ticker, ascending"); checks++;
  assert.deepEqual(once, twice,
    "and the pool does not depend on the order the vendor happened to return rows in"); checks++;

  /* A MISSING MARKET CAP IS NOT A LARGE ONE. Sorting descending with NaN
     coerced to 0 would be survivable; coerced to undefined it would sort
     unpredictably and a name with no cap could lead the pool. */
  const noCap = selectCoverage(
    [{ ticker: "GOOD", marketcap: 2e9 }, { ticker: "NOCAP" }, { ticker: "JUNK", marketcap: "x" }],
    { count: 1, guaranteed: [] });
  eq(noCap[0].row.ticker, "GOOD",
     "a row with no usable market cap sorts BELOW a measured one rather than above it");

  /* UNMEASURED IS NOT MEASURED-ZERO, and against real data those two sort
     identically — every real market cap is positive, so an absent value
     coerced to 0 and one coerced to -1 pick the same hundred names forever.
     The distinction only becomes observable against a vendor row that reports
     a cap OF zero, so that is what this fixture supplies. Without it the
     sentinel is untestable and the comment above it is unfalsifiable — which
     is the exact shape of the "raise the floor permanently" defect this
     repository shipped for the whole life of a file. */
  const zeroVsAbsent = selectCoverage(
    [{ ticker: "ZERO", marketcap: 0 }, { ticker: "ABSENT" }],
    { count: 1, guaranteed: [] });
  eq(zeroVsAbsent.length, 1, "the cap is respected");
  eq(zeroVsAbsent[0].row.ticker, "ZERO",
     "a cap the vendor MEASURED as zero outranks one it never reported — absent is not a value");

  eq(selectCoverage(null).length, 0, "no universe yields no pool rather than a throw");
  ok(selectCoverage([{ marketcap: 1e9 }], { guaranteed: [] }).length === 0,
     "a row with no ticker is not a name");
}

/* ---------- the index constant ---------------------------------- */
{
  ok(NDX_100.length >= 100, `the guarantee list carries ${NDX_100.length} names`);
  eq(new Set(NDX_100).size, NDX_100.length, "with no duplicates");
  ok(NDX_100.every((t) => /^[A-Z.]{1,6}$/.test(t)), "every entry looks like a ticker");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(NDX_AS_OF),
     "and the list carries the DATE it was written, because index membership is a choice this key cannot measure");
  ok(NDX_100.includes("GOOG") && NDX_100.includes("GOOGL"),
     "both share classes are listed — collapseShareClasses is what resolves them, downstream and once");
  ok(UNIVERSE_NOTES.index.includes(NDX_AS_OF),
     "the published note names the same date the constant does, so the page cannot claim a freshness the code does not have");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(SELECTION_EPOCH), "the selection epoch is a date");
  ok(UNIVERSE_NOTES.rule.length > 80 && UNIVERSE_NOTES.epoch.includes(SELECTION_EPOCH),
     "and the rule and the epoch are published in words, not left for a reader to infer from the row count");
}

/* ---------- which names earn the expensive legs ----------------- */
{
  const published = {
    long: [{ t: "AA", s: 91 }, { t: "BB", s: 12 }, { t: "CC", s: 4 }],
    short: [{ t: "XX", s: -95 }, { t: "YY", s: -40 }, { t: "ZZ", s: -2 }],
  };
  const deep = deepNames(published, 3).map((d) => d.t);

  /* RANKED ACROSS BOTH SIDES BY DISTANCE FROM NEUTRAL, not top-N per side.
     Taking the head of each board would spend the same calls on a +4 long and
     skip a -40 short, which is backwards: the expensive legs exist for the
     names furthest from neutral, and neutrality has no side. */
  assert.deepEqual(deep, ["XX", "AA", "YY"],
    "the deep names are the strongest |score| across BOTH boards"); checks++;

  const sides = deepNames(published, 3).map((d) => d.side);
  assert.deepEqual(sides, ["short", "long", "short"],
    "and each carries the side it was published on, so the card leg does not have to look it up again"); checks++;

  eq(deepNames(published, 0).length, 0, "a zero budget spends nothing");
  eq(deepNames(published, 99).length, 6, "a budget larger than the board takes the whole board");
  eq(deepNames({}, 5).length, 0, "no board, no deep names");
  eq(deepNames({ long: [{ t: "NS" }] }, 5)[0].t, "NS",
     "a row with no score still resolves rather than throwing");
  ok(deepNames({ long: [{ t: "NS" }, { t: "HAS", s: 1 }] }, 1)[0].t === "HAS",
     "and it sorts BELOW a scored row — an unscored name is not the furthest from neutral");
  ok(DEEP_NAMES > 0 && DEEP_NAMES <= 60,
     `the deep budget (${DEEP_NAMES}) is bounded: it is multiplied by three vendor calls a name`);
}

console.log(`✓ flows-universe: ${checks} assertions — a gapless geometric band ladder that is the vendor's only pagination, a size cohort chosen independently of the flow it scores, an index guarantee that can only add names, a pool that does not depend on vendor row order, and the |score| ranking that decides which names are worth three more calls`);
