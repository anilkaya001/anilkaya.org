/* =============================================================
   flows-warnings.mjs — the warnings that read the payloads.

   A warning engine is the one surface in this product that is
   allowed to interrupt a reader, so it has to be right about two
   opposite things at once. It must fire when two published
   surfaces genuinely contradict each other, and it must stay
   ENTIRELY silent when a payload is merely absent — because a
   warning invented out of a missing key trains a reader to dismiss
   the ones that were measured, and a dismissed warning is worse
   than no warning at all.

   So every check below is exercised three ways: a crafted store
   where it must fire, a crafted store where it must not, and a
   store with nothing in it where it must neither fire nor throw.
   On top of that this suite pins the guarantees that make the
   sentences safe to print:

     - `checked` counts questions the store could ANSWER, so
       "nothing is wrong" is distinguishable from "nothing was
       asked";
     - a measured 0 is a reading and an absent count is not, and
       the two produce different `checked`;
     - every numeral in a warning's sentence is pinned in its own
       `n`, scanned across every warning the suite produces rather
       than per check;
     - severity is ordered blocking, caution, note, so the thing a
       reader must not act on is the first thing they meet.

   INLINE FIXTURES, LIKE tests/flows-brief.mjs AND FOR THE REASON
   THAT FILE RECORDS. Its first version read tests/.shots-emit/ and
   died with ENOENT in CI, because .gitignore hides dotted
   directories under tests/: a suite that cannot run reports green
   from the one machine that was never going to catch anything. The
   shapes below were read off the publisher — scripts/flows-pipeline.mjs
   and the shared/ builders it spreads — and publisher/renderer
   agreement remains tests/flows-payload-shape.mjs's job.
   ============================================================= */

import assert from "node:assert/strict";
import { assess, THRESHOLDS } from "../shared/flows-warnings.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

/* EVERY WARNING THIS SUITE EVER PRODUCES IS KEPT, because the two
   scans at the end — the numeral pinning and the forecast verbs —
   are properties of the module and not of any one check. Running
   them per case would leave a future check exempt from both simply
   by being written after them. */
const PRODUCED = [];
const run = (store) => {
  const out = assess(store);
  for (const w of out.warnings) PRODUCED.push(w);
  return out;
};
const ids = (out) => out.warnings.map((w) => w.id).slice().sort();
const byId = (out, id) => out.warnings.find((w) => w.id === id) || null;

/* ---------- the corpus, inline and self-consistent ---------------

   ONE COHERENT SESSION, from which every positive case below is a
   single deliberate mutation. That is the shape a warning suite has
   to have: a check that fires on a store assembled specially for it
   has proved only that it fires on something, while a check that
   fires on the clean corpus with ONE field changed has proved which
   field it reads.

   The numbers hold together the way partitionSides makes them hold
   together on a live run: 44 cleared bullish, 53 cleared bearish and
   3 inside the +-1 dead band is exactly the 100 that were scored.
   `sessionDate` is the last COMPLETED session and `gateOrigin` is
   the day the gate ran, which is why they differ by one — the
   board publishes both clocks for that reason and a check that
   confused them would fire on every healthy morning. */
const STAMP = "2026-09-04T09:15:02.000Z";
const SESSION = "2026-09-03";
const ORIGIN = "2026-09-04";
const PRIOR = "2026-09-02";

const CLEAN = {
  long: {
    status: "ok", side: "long", generatedAt: STAMP, sessionDate: SESSION,
    gateOrigin: ORIGIN, gateDays: 7,
    scored: 100, neutral: 3, deadBand: 1, cleared: 44, shed: 0,
    /* `named` is the PRIOR board's row count and is compared against
       rows.length, never against `cleared` — the population/page
       distinction the rail badge shipped without. */
    memory: { status: "ok", sessionDate: PRIOR, named: 3, incumbents: 1 },
    rows: [{ t: "SYN046" }, { t: "SYN351" }, { t: "SYN037" }],
  },
  short: {
    status: "ok", side: "short", generatedAt: STAMP, sessionDate: SESSION,
    gateOrigin: ORIGIN, gateDays: 7,
    scored: 100, neutral: 3, deadBand: 1, cleared: 53, shed: 2,
    memory: { status: "ok", sessionDate: PRIOR, named: 2, incumbents: 0 },
    rows: [{ t: "SYN192" }, { t: "SYN300" }],
  },
  watch: {
    status: "ok", side: "watch", generatedAt: STAMP, sessionDate: SESSION,
    scored: 100, neutral: 3, deadBand: 1,
    rows: [{ t: "SYN243", r: 1, s: 0, resid: -0.008 },
           { t: "SYN250", r: 2, s: 0, resid: -0.0058 },
           { t: "SYN200", r: 3, s: 0, resid: -0.0002 }],
  },
  events: {
    status: "ok", generatedAt: STAMP, sessionDate: SESSION,
    gateOrigin: ORIGIN, gateDays: 7, inWindow: 87, shown: 8, cap: 200,
    rows: [{ t: "SYN151", d: ORIGIN, dte: 0 }],
  },
  /* The one key that fills DURING a session: `record.date` is the
     Eastern day the Worker's cron accumulated into, and on the clean
     corpus it names the same session the boards rank. */
  alerts: {
    status: "ok", generatedAt: STAMP, sessionDate: SESSION,
    readAt: "2026-09-04T12:31:00.000Z", refreshed: "intraday",
    vendorLimit: 200, vendorTruncated: false, seen: 41,
    record: { date: SESSION, reads: 3, union: 41 },
    rows: [{ t: "SYN351" }, { t: "SYN231" }],
  },
  sectorPremium: {
    status: "ok", generatedAt: STAMP, sessionDate: SESSION,
    measured: 11, returned: 11, rows: [{ t: "XLK", lean: 0.12 }],
  },
  market: { status: "ok", generatedAt: STAMP, sessionDate: SESSION, screened: 412 },
  /* `premium.byContract` is cut from the shaped flow alerts by the
     re-publish, which is why a ceiling on that read reaches here. */
  movers: {
    status: "ok", generatedAt: STAMP, sessionDate: SESSION,
    premium: {
      byContract: { basis: "vendor-flagged windows", cap: 12, seen: 2, shed: 0,
                    rows: [{ t: "SYN351" }, { t: "SYN192" }] },
    },
  },
  news: {
    status: "ok", generatedAt: STAMP, sessionDate: SESSION,
    requested: 100, returned: 63, kept: 60, cap: 60, atVendorLimit: false, rows: [],
  },
  unusual: {
    status: "ok", generatedAt: STAMP, sessionDate: SESSION, readAt: STAMP,
    namesSeen: 47, namesTruncated: 0, namesComplete: 47, complete: true, rows: [],
  },
};

/* Every case mutates its own copy. Sharing one object between cases
   is how a suite ends up asserting the order it happens to run in. */
const clean = () => structuredClone(CLEAN);

/* The number of checks the clean corpus can answer, pinned rather
   than bounded. A new check that cannot run against a complete,
   healthy store is a check whose inputs nothing publishes, and the
   author should find that out here rather than in production. */
const CHECKS_ON_CLEAN = 13;

/* ---------- 1. the clean corpus warns about nothing --------------- */
{
  const out = run(clean());
  eq(out.warnings.length, 0,
     "a complete and self-consistent store produces no warning at all — an engine that " +
     "cannot be quiet is an engine a reader learns to scroll past");
  eq(out.checked, CHECKS_ON_CLEAN,
     "and every check the module carries could actually run against it, so the silence " +
     "above is measured rather than merely unasked");
}

{
  /* A NUMERATOR PRINTED ALONE READS AS THE WHOLE SET. Nothing in a bare
     `checked: 7` says whether seven is every question the module carries
     or seven of thirteen, so a store holding two keys would render the
     same clean bill of health as a complete one — the truncation that
     does not say it truncated, in the one place whose whole job is to say
     so. A caller keeping its own copy of the total is the drift this
     codebase keeps consolidating, so the module states it. */
  const full = run(clean());
  eq(full.questions, CHECKS_ON_CLEAN,
     "the module says how many questions it carries, not only how many it could ask");
  eq(full.checked, full.questions,
     "which on a complete and healthy store is the same number");
  const thin = run({ long: clean().long, short: clean().short });
  eq(thin.questions, CHECKS_ON_CLEAN,
     "a store holding two keys is measured against that same denominator");
  ok(thin.checked < thin.questions,
     "so a caller can say how much of the store went unasked rather than printing a count " +
     "with nothing to read it against");
}

/* ---------- 2. absence is a silence, never a contradiction -------- */
{
  for (const [label, store] of [
    ["nothing at all", undefined],
    ["null", null],
    ["a string", "board:long"],
    ["an array", []],
    ["an empty object", {}],
  ]) {
    const out = run(store);
    eq(out.warnings.length, 0,
       `a store that is ${label} yields no warning — a missing payload is a silence and a ` +
       "warning invented from one would be the confident zero this codebase exists to refuse");
    eq(out.checked, 0,
       `and reports 0 checks against ${label}, so a caller can tell "nothing is wrong" ` +
       'from "nothing was asked"');
  }
}
{
  /* THE THREE SILENCES, EACH ON ITS OWN. Pending is not published
     yet, null could not be read, and rows: [] was measured and holds
     nothing. None of the three is two surfaces disagreeing. */
  const slots = Object.keys(CLEAN);
  for (const [label, make] of [
    ["pending", () => ({ status: "pending", rows: [] })],
    ["unreadable", () => null],
    ["measured empty", () => ({ status: "ok", rows: [] })],
  ]) {
    const store = {};
    for (const slot of slots) store[slot] = make();
    const out = run(store);
    eq(out.warnings.length, 0,
       `a store in which every key is ${label} produces no warning — that is three kinds of ` +
       "silence and none of them is a contradiction");
    eq(out.checked, 0,
       `and no check claims to have run against a store of ${label} keys`);
  }
}

/* ---------- 3. a silent stamp, which is worse than a stale one ---- */
{
  for (const [label, value] of [["absent", undefined], ["unparseable", "yesterday"],
                                ["a bare month", "2026-09"], ["the epoch as a null", null]]) {
    const s = clean();
    if (value === undefined) delete s.market.generatedAt; else s.market.generatedAt = value;
    const out = run(s);
    assert.deepEqual(ids(out), ["stamp:silent:market"],
      `a generatedAt that is ${label} is reported, and only that`);
    checks++;
    const w = byId(out, "stamp:silent:market");
    eq(w.severity, "caution", "caution, not blocking: nothing it publishes is wrong, but no " +
       "page can compute its age and it sits beside stamped keys looking as current as they are");
    eq(w.n.comparable, 9, "and the sentence counts the surfaces that DID state a stamp");
    ok(w.sources.includes("market"), "naming the published key a reader can go and open");
  }
}
{
  /* `new Date(null)` is the epoch rather than an invalid date, so a
     module that parsed before it checked the shape would report this
     key as fifty-seven years stale instead of as unstamped. */
  const s = clean();
  s.market.generatedAt = null;
  const out = run(s);
  eq(byId(out, "stamp:drift"), null,
     "an unstamped key is never folded into the drift check as a gap of unknown size");
}
{
  const out = run({ market: { status: "ok" } });
  eq(out.warnings.length, 0,
     "a lone unstamped payload is not accused of anything: with no readable stamp anywhere " +
     "the store is a store-wide silence, not one surface out of step with the others");
  eq(out.checked, 0, "and the check reports that it could not run");
}

/* ---------- 4. two surfaces written by different runs ------------- */
{
  const cases = [
    ["2026-09-03T06:02:00.000Z", "blocking", 27,
     "past a full session apart the older surface describes a session that has since closed"],
    ["2026-09-04T02:15:02.000Z", "caution", 7,
     "hours apart is a leg that failed and left the previous run's copy standing"],
    ["2026-09-04T03:15:02.000Z", "caution", THRESHOLDS.driftCautionHours,
     "and the caution threshold is inclusive, so a gap exactly at it is reported"],
  ];
  for (const [stamp, severity, hours, why] of cases) {
    const s = clean();
    s.market.generatedAt = stamp;
    const out = run(s);
    const w = byId(out, "stamp:drift");
    ok(w !== null, `a ${hours}-hour spread between two generatedAt values is reported: ${why}`);
    eq(w.severity, severity, `and it is ${severity}`);
    eq(w.n.hours, hours, "with the gap measured between the two published stamps");
    eq(w.n.older, stamp, "the older stamp quoted as written");
    eq(w.n.newer, STAMP, "and the newer one too, so neither can be rephrased away");
    assert.deepEqual(w.sources.slice().sort(), ["board:long", "market"],
      "naming both surfaces, because a drift is a fact about a pair");
    checks++;
  }
}
{
  /* THE PRINTED INTERVAL AND THE SEVERITY MUST NAME THE SAME THRESHOLD.
     Twenty-three and a half hours is half an hour short of the boundary
     this module defines as a session having closed since, and a rounded
     interval printed it as the 24 that boundary IS — a sentence telling a
     reader the two keys are a whole session apart under a badge telling
     them they are not, with the module's own exported threshold as the
     thing they would check it against. Flooring is what stops a figure
     crossing a line the gap did not cross. */
  const s = clean();
  s.market.generatedAt = "2026-09-03T09:45:02.000Z";
  const w = byId(run(s), "stamp:drift");
  eq(w.severity, "caution",
     "twenty-three and a half hours has not closed a session, so it is not blocking");
  eq(w.n.hours, 23,
     "and the gap is floored rather than rounded, so it cannot report the " +
     `${THRESHOLDS.driftBlockingHours} that would mean it had`);
  ok(!new RegExp(`${THRESHOLDS.driftBlockingHours} hours apart`).test(w.say),
     "and the sentence a reader actually meets never states the blocking boundary underneath " +
     "a caution: a figure that rounds across a threshold has stopped being the measurement");
}
{
  const s = clean();
  s.market.generatedAt = "2026-09-04T06:15:02.000Z";
  const out = run(s);
  eq(byId(out, "stamp:drift"), null,
     "three hours apart is one run's own legs and is not reported — a threshold under the " +
     "observed lateness of the two daily crons would fire every morning");
  eq(out.checked, CHECKS_ON_CLEAN, "and the check still counts itself as having run");
}
{
  const out = run({ long: clean().long });
  eq(byId(out, "stamp:drift"), null,
     "one stamped surface cannot drift from anything, so the check reports nothing");
  ok(out.checked < CHECKS_ON_CLEAN,
     "and does not count itself, because a comparison needs two payloads to compare");
}

/* ---------- 5. two surfaces naming two sessions ------------------- */
{
  const s = clean();
  s.events.sessionDate = "2026-09-02";
  const out = run(s);
  assert.deepEqual(ids(out), ["session:split"],
    "a key describing a different session from the rest is reported, and only that");
  checks++;
  const w = byId(out, "session:split");
  eq(w.severity, "blocking",
     "blocking, because every day count on these pages is measured from a session and two " +
     "sessions put one name at two distances from one earnings date");
  eq(w.n.earlier, "2026-09-02", "the earlier session named");
  eq(w.n.later, SESSION, "and the later one, so the pair is checkable");
}
{
  /* THE SPLIT IS NOT THE DRIFT RESTATED, and this is the store that
     shows it: the stamp is unreadable, so the drift check skips the
     key entirely, and the session it names is still wrong. */
  const s = clean();
  s.events.generatedAt = "no stamp at all";
  s.events.sessionDate = "2026-09-02";
  const out = run(s);
  ok(byId(out, "session:split") !== null,
     "a key with an unreadable stamp still declares which session it is about, and a wrong " +
     "one is caught by the check that reads the subject rather than the write");
  eq(byId(out, "stamp:drift"), null,
     "while the drift check, which reads the write, has nothing to say about it");
}

/* ---------- 6. the day boundary ----------------------------------- */
{
  const s = clean();
  s.alerts.record.date = "2026-09-04";
  const out = run(s);
  assert.deepEqual(ids(out), ["session:boundary"], "the intraday record naming a later day is reported");
  checks++;
  const w = byId(out, "session:boundary");
  eq(w.severity, "note",
     "a note: the tape filling today beside the last completed session is the ordinary state " +
     "of the product, and it is still why a flagged-window count is not a board count");
  eq(w.n.recordDay, "2026-09-04", "the day the record covers");
  eq(w.n.session, SESSION, "and the session the boards rank");
}
{
  const s = clean();
  s.alerts.record.date = "2026-09-02";
  const out = run(s);
  const w = byId(out, "session:boundary");
  ok(w !== null, "and a record naming an EARLIER day is reported too");
  eq(w.severity, "caution",
     "as a caution rather than a note, because a record older than the ranked session never " +
     "reset at the boundary and nothing on the page distinguishes it from a live one");
}
{
  const s = clean();
  delete s.alerts.record;
  const out = run(s);
  eq(byId(out, "session:boundary"), null, "an alerts payload with no record says nothing about a day");
  eq(out.checked, CHECKS_ON_CLEAN - 1,
     "and the check does not count itself, because it had nothing to compare");
}
{
  /* A BOARD PUBLISHED AND SILENT ABOUT THE DAY MUST NOT SUPPRESS THE ONE
     BESIDE IT. Taking whichever side answered first and then reading the
     session off it drops the session the other side is still publishing,
     and the loss is invisible from outside: the same store with the quiet
     board REMOVED reports the contradiction. A finding that appears when a
     payload is deleted is a finding that depends on how much of the store
     the engine was handed rather than on what the payloads say. */
  const s = clean();
  s.long = { status: "ok", generatedAt: STAMP, rows: [] };
  s.alerts.record.date = "2026-09-01";
  const w = byId(run(s), "session:boundary");
  ok(w !== null,
     "board:short still names the session it ranks, so a record that never reset at the " +
     "boundary is reported rather than lost behind a board that published nothing about a day");
  eq(w.n.session, SESSION, "measured against the session the board that spoke actually names");
  assert.deepEqual(w.sources.slice().sort(), ["board:short", "flowalerts"],
    "and the sentence cites the board it read, not the one that was silent");
  checks++;
}

/* ---------- 7. a population that shrank --------------------------- */
{
  const s = clean();
  s.long.memory.named = 40;
  s.short.memory.named = 40;
  const out = run(s);
  assert.deepEqual(ids(out), ["population:shrank"], "a board that lost most of its names is reported");
  checks++;
  const w = byId(out, "population:shrank");
  eq(w.severity, "caution",
     "caution: the count is right and the inference a reader draws from a shorter list — a " +
     "quieter market — is the wrong one");
  eq(w.n.held, 5, "the rows the two boards hold now");
  eq(w.n.prior, 80, "against the rows the prior boards held, both counted as ROWS");
  eq(w.n.fellPct, 94, "and the fall stated as a percentage rather than left to the reader");

  /* THE MEMORY MUST BE A PREVIOUS SESSION, AND IT IS NOT ALWAYS ONE.
     A board re-run on the same day reads back its own earlier write and
     stamps the memory `same-session` — flows-pipeline.mjs says so in as
     many words: "it is this run's own output". Counting against that
     compares the run to itself and reports a collapse that is an
     artefact of having run twice, which is the confusion the
     pipeline's own memory guard exists to prevent, reintroduced one
     layer up. `named` survives on a refused memory (only `rows` is
     emptied), so nothing else here would have stopped it. */
  for (const status of ["same-session", "ahead", "undated", "quiet", "unavailable"]) {
    const t = clean();
    t.long.memory.named = 40; t.short.memory.named = 40;
    t.long.memory.status = status; t.short.memory.status = status;
    eq(byId(run(t), "population:shrank"), null,
       `a memory stamped ${status} is not a previous board, so no fall is claimed against it`);
  }

  /* AND THE ONE-SIDED CASE. A memory refused on one side only must not
     silently halve the comparand on the other: the side that still has
     a clean memory is compared, the refused side contributes neither a
     prior nor a held count, and the sentence names the side it read. */
  const oneSided = clean();
  oneSided.long.memory.named = 40;
  oneSided.short.memory.status = "same-session";
  oneSided.short.memory.named = 40;
  const ow = byId(run(oneSided), "population:shrank");
  ok(ow !== null, "one clean memory is still worth a comparison");
  ok(/bullish board/.test(ow.say),
     "and it says which side it read, rather than implying it counted both");
  eq(ow.n.prior, 40, "counting only the side whose memory was a previous session");
  eq(w.n.priorSession, PRIOR, "with the board it is measured against named");
  assert.deepEqual(w.sources.slice().sort(), ["board:long", "board:short"],
    "and both sides cited, because the comparison is across the pair");
  checks++;
}
{
  /* TWO PRIORS FROM TWO SESSIONS, AND THE SENTENCE NAMES NEITHER. `prior`
     is a sum across the sides, so a date taken from the first side that
     stated one is printed as the day the whole sum came from — and the
     store where the two sides disagree is the one this module exists for,
     because a leg that failed and left an older copy standing carries an
     older memory with it. */
  const s = clean();
  s.long.memory.named = 60;
  s.short.memory.named = 20;
  s.short.memory.sessionDate = "2026-08-28";
  const w = byId(run(s), "population:shrank");
  ok(w !== null, "a fall measured across two sides is still reported");
  eq(w.n.prior, 80, "with both priors summed, because both sides were counted");
  ok(!("priorSession" in w.n),
     "and no prior session named: 60 of those 80 were on the 2026-09-02 board and 20 on the " +
     "2026-08-28 one, so naming either dates the whole sum to a day most of it is not from");
  ok(/on the previous board/.test(w.say),
     'the sentence falling back to "the previous board", which is vaguer and true');

  const t = clean();
  t.long.memory.named = 40;
  t.short.memory.named = 40;
  delete t.short.memory.sessionDate;
  ok(!("priorSession" in byId(run(t), "population:shrank").n),
     "and a side that counted names without stating its session is the same fault: the sum " +
     "spans a board whose day nothing published, so no day can be put on the sum");
}
{
  const s = clean();
  s.long.memory.named = 5;
  s.short.memory.named = 5;
  const out = run(s);
  eq(byId(out, "population:shrank"), null,
     `a fall of exactly ${THRESHOLDS.shrinkFraction} is not more than half and is not reported`);
  s.long.memory.named = 6;
  s.short.memory.named = 6;
  ok(byId(run(s), "population:shrank") !== null, "while one name further down it is");
}
{
  const s = clean();
  delete s.short.memory;
  s.long.memory.named = 40;
  const out = run(s);
  const w = byId(out, "population:shrank");
  ok(w !== null, "one side with a readable prior count is enough to run the comparison");
  ok(/bullish board/.test(w.say),
     "and the sentence names that side rather than claiming to speak for two boards");
  assert.deepEqual(w.sources, ["board:long"], "citing only the payload it actually read");
  checks++;
}

{
  /* THE FALL IS MEASURED AND ITS CAUSE IS NOT. Both sides publish
     `cleared` — 44 and 53 of the 100 scored got PAST the dead band and the
     earnings gate on this store — and `shed`, which says our own row cap
     is what emptied the page. A sentence naming the band or the gate
     sends a reader to widen a threshold that removed nothing, which is a
     warning doing the exact damage it was written to undo. */
  const s = clean();
  s.long.memory.named = 40; s.short.memory.named = 40;
  s.long.rows = []; s.short.rows = [];
  s.long.shed = 44; s.short.shed = 53;
  const w = byId(run(s), "population:shrank");
  ok(w !== null, "a board that emptied against a prior of 80 is still reported");
  ok(!/which is the dead band or the earnings gate removing names/.test(w.say),
     "but the sentence does not assert a cause this check never measured: 97 names cleared " +
     "both thresholds on this store and the row cap is what shed them");
  ok(/cannot tell apart/.test(w.say),
     "it names both candidates and says these two row counts do not separate them, which is " +
     "what the check's own doc comment already said and the sentence had stopped saying");
}

/* ---------- 8. a measured zero is not an absent count ------------- */
{
  /* THE WHOLE HOUSE RULE IN ONE PAIR OF STORES. `named: 0` is a prior
     board that was read and held nothing; `named: null` is a prior
     board that could not be read at all. Number(null) is 0, so a
     module that coerced before it tested would treat the second as
     the first — and then divide by it. */
  const zero = clean();
  zero.long.memory.named = 0;
  zero.short.memory.named = 0;
  const zeroOut = run(zero);
  eq(byId(zeroOut, "population:shrank"), null,
     "a prior board that held nothing produces no shrink warning, because nothing can fall " +
     "from nothing and dividing by it would manufacture an infinite fall");
  eq(zeroOut.checked, CHECKS_ON_CLEAN,
     "and the check RAN: a measured zero is a reading, so the question was answered");

  const absent = clean();
  absent.long.memory.named = null;
  absent.short.memory.named = null;
  const absentOut = run(absent);
  eq(byId(absentOut, "population:shrank"), null, "an absent prior count produces no warning either");
  eq(absentOut.checked, CHECKS_ON_CLEAN - 1,
     "but the check did NOT run, and the two stores are distinguishable by `checked` alone — " +
     "which is the only place the difference between a zero and an absence can show");
}
{
  /* AND A WHOLE SESSION MEASURED AT ZERO WARNS ABOUT NOTHING. Every
     count below was taken and every one of them came back empty, which
     is a reading of an unusually quiet session and not a fault. */
  const q = clean();
  for (const side of ["long", "short"]) {
    q[side].rows = [];
    q[side].cleared = 0;
    q[side].neutral = 0;
    q[side].scored = 0;
    q[side].memory.named = 0;
  }
  q.watch.rows = [];
  q.watch.scored = 0;
  q.watch.neutral = 0;
  q.alerts.rows = [];
  q.alerts.seen = 0;
  q.news.returned = 0;
  q.news.kept = 0;
  q.unusual.namesSeen = 0;
  q.unusual.namesTruncated = 0;
  q.movers.premium.byContract.rows = [];
  const out = run(q);
  eq(out.warnings.length, 0,
     "a session in which every measurement came back 0 produces no warning — the readings " +
     "agree with each other and 0 + 0 + 0 is 0 scored");
  eq(out.checked, CHECKS_ON_CLEAN,
     "and every check ran, because a zero is something to check rather than something missing");
}

/* ---------- 9. a truncated list read as a population -------------- */
{
  const s = clean();
  s.alerts.vendorTruncated = true;
  const out = run(s);
  assert.deepEqual(ids(out), ["ceiling:alerts", "ceiling:inherited"],
    "a read that hit the vendor's limit is reported, and so is the second surface cut from it");
  checks++;
  const w = byId(out, "ceiling:alerts");
  eq(w.severity, "caution",
     "caution: the count is a true count of what we received and a false count of what exists");
  eq(w.n.limit, 200, "the ceiling quoted");
  ok(/at least 200/.test(w.say),
     "and the floor the sentence states is that limit — the same number shared/flows-ask.js " +
     "states for the same payload, so one fact does not reach a reader as two");
  ok(!("carried" in w.n),
     "while the page's own row count is NOT quoted as that floor: shared/flows-alerts.js caps " +
     "the published page at ALERT_ROWS and publishes `shed` beside it, so its length is a " +
     "ceiling whose size we KNOW, and printing it as the floor of a population we do not know " +
     "is the page/population confusion this warning exists to name, running backwards");
}
{
  /* THE CEILING IS STATED BY TWO FIELDS AND THE ROWS ARE NOT ONE OF THEM.
     Requiring a third field let an unreadable rows array take a fully
     measured claim down with it, while the inherited check — which reads
     the SAME flag — went on warning about the surface cut from it: the
     page then carried the derived caveat and not the one it derives from. */
  const s = clean();
  s.alerts.vendorTruncated = true;
  delete s.alerts.rows;
  const out = run(s);
  const w = byId(out, "ceiling:alerts");
  ok(w !== null,
     "an alerts payload whose rows arrived in a shape this module cannot read still gets its " +
     "ceiling named, because vendorLimit and vendorTruncated state it between them");
  eq(w.n.limit, 200, "from the two fields that actually carry the claim");
  ok(byId(out, "ceiling:inherited") !== null,
     "and the surface cut from that read is warned about beside it rather than instead of it");
}
{
  const s = clean();
  s.alerts.vendorTruncated = true;
  delete s.movers;
  const out = run(s);
  assert.deepEqual(ids(out), ["ceiling:alerts"],
    "with no movers payload the inherited ceiling cannot be observed and is not asserted");
  checks++;
  eq(out.checked, CHECKS_ON_CLEAN - 1, "and that check reports that it could not run");
}
{
  const s = clean();
  s.alerts.vendorTruncated = true;
  const w = byId(run(s), "ceiling:inherited");
  eq(w.n.limit, 200, "the movers band inherits the ceiling of the read it was cut from");
  eq(w.n.ranked, 2,
     "and how many windows it ranks, named as a ranking rather than as a floor: alertBand " +
     "caps the band and publishes `shed` beside it, so its length is a number we know exactly");
  ok(/largest of what arrived/.test(w.say),
     "because what the vendor's ceiling costs the band is not its length but its CLAIM — a " +
     "ranking cut from a truncated read is the largest of what arrived, and the panel above " +
     "it calls that the largest of the session");
  assert.deepEqual(w.sources.slice().sort(), ["flowalerts", "movers"],
    "this is the check that needs two payloads open at once and can be written in neither renderer");
  checks++;
}
{
  const s = clean();
  delete s.alerts.vendorTruncated;
  const out = run(s);
  eq(byId(out, "ceiling:alerts"), null,
     "an absent truncation flag is not read as false — a payload carrying no claim either way " +
     "stops the check rather than clearing it");
  eq(out.checked, CHECKS_ON_CLEAN - 2,
     "and it stops the inherited check with it, since that one reads the same flag");
}
{
  const s = clean();
  s.news.returned = 100;
  s.news.atVendorLimit = true;
  const out = run(s);
  assert.deepEqual(ids(out), ["ceiling:news"], "a response that ended at the vendor's own page size is reported");
  checks++;
  const w = byId(out, "ceiling:news");
  eq(w.n.returned, 100, "with what came back on the wire");
  eq(w.n.requested, 100, "and what was asked for, which is what makes it a ceiling");
}
{
  const s = clean();
  s.news.atVendorLimit = true;
  const out = run(s);
  eq(byId(out, "ceiling:news"), null,
     "a truncation flag set true beside a return well under the request is someone else's " +
     "defect, and this module re-reads the two counts rather than repeating it as a warning");
  eq(out.checked, CHECKS_ON_CLEAN - 1,
     "and the check DECLINES rather than clearing: returning \"asked, nothing wrong\" would " +
     "count the question among the ones the store answered, letting a caller print a clean " +
     "bill of health over a key that is published and holds no coherent reading — which is " +
     "the unreadable silence reported as the quiet one");
  const t = clean();
  delete t.news.requested;
  eq(run(t).checked, CHECKS_ON_CLEAN - 1, "and with no request count there is nothing to compare against");
}
{
  const s = clean();
  s.unusual.namesTruncated = 12;
  const out = run(s);
  assert.deepEqual(ids(out), ["ceiling:chains"], "chains that came back cut off are reported");
  checks++;
  const w = byId(out, "ceiling:chains");
  eq(w.n.chains, 47, "the chains read");
  eq(w.n.truncated, 12, "and how many of them were truncated, so the counts they feed are floors");
  eq(byId(run(clean()), "ceiling:chains"), null,
     "while a measured 0 truncated is the healthy answer and is not a warning");
  const t = clean();
  t.unusual.namesTruncated = null;
  eq(run(t).checked, CHECKS_ON_CLEAN - 1,
     "and a null coverage claim — which the publisher writes rather than false when no chain " +
     "contributed — stops the check instead of reading as zero");
}

/* ---------- 10. surfaces that measure one thing and disagree ------ */
{
  const s = clean();
  s.watch.scored = 87;
  const out = run(s);
  assert.deepEqual(ids(out), ["scored:disagree"], "two boards reporting two pool sizes is reported");
  checks++;
  const w = byId(out, "scored:disagree");
  eq(w.severity, "blocking",
     "blocking, because the briefing prints the tilt as a share of the pool and takes the " +
     "denominator from whichever board answered first");
  eq(w.n.higher, 100, "the larger count");
  eq(w.n.lower, 87, "and the smaller, with no tolerance between them: these are copies of one " +
     "integer and there is no width within which two copies may differ");
}
{
  const s = clean();
  s.watch.deadBand = 2;
  const out = run(s);
  assert.deepEqual(ids(out), ["band:disagree"], "two surfaces partitioning on two dead bands is reported");
  checks++;
  const w = byId(out, "band:disagree");
  eq(w.severity, "blocking",
     "blocking: the band is what decides which surface a name appears on, so two bands make " +
     "the product's stated rule false in the one way a reader cannot see");
  eq(w.n.wider, 2, "the wider band");
  eq(w.n.narrower, 1, "and the narrower one");
  ok(/dead band of ±2/.test(w.say),
     "and the sign travels with the number, because `deadBand` is the HALF-width " +
     "partitionSides compares |score| against: a bare 2 reads as a band spanning two points " +
     "when it spans four, and a reader checking this sentence against the boards by hand " +
     "would put a score of 1.5 outside a band that holds it");
  ok(/on ±1,/.test(w.say),
     "on both ends of the comparison rather than only the first, since it is the pair that " +
     "is being read");
}
{
  const s = clean();
  s.long.cleared = 50;
  const out = run(s);
  assert.deepEqual(ids(out), ["partition:impossible"],
    "sides that account for more names than were scored is reported");
  checks++;
  const w = byId(out, "partition:impossible");
  eq(w.severity, "blocking", "blocking, because any share printed from the pair is arithmetically wrong");
  eq(w.n.accounted, 106, "the total the two boards claim");
  eq(w.n.scored, 100, "against the pool they were cut from");
  ok(!("missing" in w.n), "with no missing count, because nothing is missing — there is a surplus");
}
{
  const s = clean();
  s.long.cleared = 30;
  const w = byId(run(s), "partition:impossible");
  ok(w !== null, "and the other direction is reported too");
  eq(w.n.accounted, 86, "with the shortfall's own arithmetic");
  eq(w.n.missing, 14,
     "and the number of names that cleared the threshold this product calls the threshold and " +
     "reach no surface a reader can open — a different sentence from the surplus above");
}
{
  /* `??` AND NOT `||`, AND THIS STORE IS THE DIFFERENCE. The bullish
     board publishes a measured 0 inside the band and the bearish one
     publishes 7; a module that fell through the zero would read 7,
     total 107 against 100 scored, and report a contradiction that
     does not exist. */
  const s = clean();
  s.long.neutral = 0;
  s.short.neutral = 7;
  s.long.cleared = 44;
  s.short.cleared = 56;
  const out = run(s);
  eq(byId(out, "partition:impossible"), null,
     "a measured 0 inside the dead band is read as the reading it is, not fallen through to " +
     "the other board's copy — 44 + 56 + 0 is the 100 that were scored");
  eq(out.checked, CHECKS_ON_CLEAN, "and the check ran rather than declining on a falsy count");
}
{
  const s = clean();
  s.long.neutral = null;
  s.short.neutral = null;
  const out = run(s);
  eq(byId(out, "partition:impossible"), null, "an absent neutral count produces no warning");
  eq(out.checked, CHECKS_ON_CLEAN - 1,
     "and the check declines instead, because a partition cannot be checked against a part " +
     "nobody published");
}

/* ---------- 11. the gate the board applied, and the calendar's ---- */
{
  const s = clean();
  s.events.gateDays = 10;
  const out = run(s);
  assert.deepEqual(ids(out), ["gate:window"], "two different gate widths are reported");
  checks++;
  const w = byId(out, "gate:window");
  eq(w.severity, "blocking", "blocking: the calendar marks names as gated that the board kept");
  eq(w.n.boardDays, 7, "the board's window");
  eq(w.n.eventsDays, 10, "and the calendar's");
}
{
  const s = clean();
  s.events.gateOrigin = "2026-09-03";
  const out = run(s);
  assert.deepEqual(ids(out), ["gate:origin"], "and two different origins are their own warning");
  checks++;
  const w = byId(out, "gate:origin");
  eq(w.n.boardOrigin, ORIGIN, "the day the board counted from");
  eq(w.n.eventsOrigin, "2026-09-03",
     "and the day the calendar counted from — a different fault from a different width, " +
     "needing a different repair, which is why they are two warnings and not one");
}
{
  const s = clean();
  s.events.gateDays = 10;
  s.events.gateOrigin = "2026-09-03";
  assert.deepEqual(ids(run(s)), ["gate:origin", "gate:window"],
    "both at once are reported as both, never merged into one sentence");
  checks++;
  const t = clean();
  delete t.events.gateDays;
  delete t.events.gateOrigin;
  eq(run(t).checked, CHECKS_ON_CLEAN - 1,
     "and a calendar publishing neither clock stops the check rather than agreeing by default");
}
{
  /* AND THE GATE IS RESOLVED THE SAME WAY THE DAY IS. A thin board:long
     standing in front of a board:short that still publishes both clocks
     must not cost the calendar its comparison — the contradiction is
     between what a board applied and what events published, and either
     board can be the one that says what was applied. */
  const s = clean();
  s.long = { status: "ok", generatedAt: STAMP, rows: [] };
  s.events.gateDays = 10;
  const w = byId(run(s), "gate:window");
  ok(w !== null,
     "board:short applies a 7-day gate beside a 10-day calendar, and a board:long that " +
     "states no window at all does not make that disagreement unobservable");
  eq(w.n.boardDays, 7, "with the window read from the board that actually stated one");
  assert.deepEqual(w.sources.slice().sort(), ["board:short", "events"],
    "and cited to that board, so a reader opening the pair opens the two that disagree");
  checks++;

  const gone = clean();
  gone.events.gateDays = 10;
  delete gone.long;
  ok(byId(run(gone), "gate:window") !== null,
     "which is the answer the same store gives with board:long absent rather than quiet: a " +
     "warning that appeared only once a payload was DELETED would be a warning about how " +
     "much of the store the engine was handed");
}

/* ---------- 12. severity is earned, and ordered ------------------- */
{
  const s = clean();
  s.watch.scored = 87;              // blocking
  s.unusual.namesTruncated = 12;    // caution
  s.alerts.record.date = "2026-09-04";  // note
  const out = run(s);
  eq(out.warnings.length, 3, "three findings of three severities");
  assert.deepEqual(out.warnings.map((w) => w.severity), ["blocking", "caution", "note"],
    "arrive blocking first, because the reading a reader must not act on is the one they " +
    "must meet before they act");
  checks++;
  const again = assess(s);
  assert.deepEqual(again.warnings.map((w) => w.id), out.warnings.map((w) => w.id),
    "and the order is stable, so one store always renders one page");
  checks++;
}

/* ---------- 13. the shape of every warning this suite produced ---- */
{
  const KEYS = new Set(["board:long", "board:short", "board:watch", "events", "flowalerts",
                        "sector:premium", "market", "movers", "news", "unusual"]);
  ok(PRODUCED.length >= 20,
     `the scans below have something to scan (${PRODUCED.length} warnings produced)`);
  for (const w of PRODUCED) {
    ok(typeof w.id === "string" && w.id.length > 0, "every warning carries an id");
    ok(["blocking", "caution", "note"].includes(w.severity),
       `severity is one of the three earned levels, not "${w.severity}"`);
    ok(typeof w.say === "string" && w.say.endsWith("."),
       `the sentence is a sentence: "${w.say.slice(0, 50)}"`);
    ok(!/\.\s/.test(w.say),
       "and it is ONE sentence — a warning that runs to two paragraphs is a warning nobody " +
       `finishes reading: "${w.say.slice(0, 50)}"`);
    ok(w.n && typeof w.n === "object" && !Array.isArray(w.n),
       "`n` is an object keyed by what each number IS, the same shape flows-brief facts use, " +
       "so the two compose in one context");
    ok(Array.isArray(w.sources) && w.sources.length > 0,
       `every warning cites the payloads it read: ${w.id}`);
    for (const src of w.sources) {
      ok(KEYS.has(src),
         `and cites them by PUBLISHED key, which a reader can go and open — "${src}" is not one`);
    }
  }
}

/* ---------- 14. no warning states what a session will do ---------- */
{
  /* THE SCAN IS THE POINT, and it is the same one tests/flows-brief.mjs
     runs over the briefing. A warning that started explaining what a
     truncated feed means for tomorrow would read naturally and pass
     every other assertion here; this one fails on the verb. */
  const FORECAST = /\b(will|should|expect(?:ed)?|likely|going to|forecast|predict)\b/i;
  for (const w of PRODUCED) {
    ok(!FORECAST.test(w.say),
       `a warning states what two payloads say about a session that has happened, never what ` +
       `a market is about to do: "${w.say.slice(0, 60)}"`);
  }
}

/* ---------- 15. every numeral in a warning is pinned in its n ----- */
{
  /* THE ANTI-TAMPER PROPERTY, SCANNED ACROSS EVERY WARNING THE SUITE
     PRODUCED rather than inside each case. Written per check, a new
     check added below this line would be exempt from it simply by
     being written later — and the whole reason `n` exists is that a
     rephrasing of `say` must be unable to change a figure.

     THE STRING VALUES ARE MASKED OUT BEFORE THE DIGITS ARE READ, for
     the reason tests/flows-brief.mjs records: a date or an ISO stamp
     carries digits inside a value that is itself pinned, and a naive
     digit scan would accuse the module of an unpinned "2026". Every
     string already quoted in `n` is removed first, and what remains
     is the sentence's own arithmetic. */
  let scanned = 0;
  for (const w of PRODUCED) {
    const quoted = new Set();
    for (const v of Object.values(w.n)) {
      if (typeof v === "number") quoted.add(String(v));
      else if (typeof v === "string") quoted.add(v);
      else if (Array.isArray(v)) for (const x of v) quoted.add(String(x));
    }
    let stripped = w.say;
    for (const v of quoted) {
      if (typeof v === "string" && /\D/.test(v)) stripped = stripped.split(v).join(" ");
    }
    for (const lit of stripped.match(/-?\d+(?:\.\d+)?/g) || []) {
      scanned++;
      ok(quoted.has(lit) || quoted.has(String(Number(lit))),
         `every figure in a warning is pinned in n — "${lit}" in "${w.say.slice(0, 55)}" must ` +
         "be quoted from a payload field, or a rewording could change it silently");
    }
  }
  ok(scanned >= 25,
     `the scan actually inspected numbers (${scanned}) rather than passing over empty prose`);
}

console.log(`flows-warnings: ${checks} checks passed — cross-payload warnings fire on a crafted
  contradiction and stay silent on a crafted agreement; absence is a silence and never a
  warning; a measured 0 is a reading and an absent count is not, and the two are told apart
  by \`checked\`; severity arrives blocking first; every numeral in a warning's sentence is
  pinned in its own \`n\`, and none of them states what a market is about to do.`);
