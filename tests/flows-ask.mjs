/* =============================================================
   flows-ask.mjs — the textbot's retrieval and safety core.

   A briefing a reader can check is one thing; a bot that answers in
   sentences is another, because prose invites trust that a table
   does not. Everything this suite pins exists to make that trust
   earned rather than assumed:

     - a measured 0 is a reading and is carried into the answer,
       while an absent field drops its whole sentence instead of
       printing a zero it never received;
     - the three silences arrive as three, so "not published yet"
       can never be served as "nothing happened";
     - an answer carrying a figure nobody published is REFUSED, and
       so is one that claims the future;
     - and the deterministic answer that ships when the guard fires
       passes the same guard, because a fallback that violates its
       own rule is not a fallback at all.

   INLINE FIXTURES, AND THAT IS NOT A PREFERENCE. tests/.shots-emit
   holds real emitted payloads on a developer's disk and nowhere
   else — .gitignore drops every dotted directory under tests/ — so
   a suite that read one would report green from the one machine
   that was never going to catch anything. The shapes below were
   read off the publisher (scripts/flows-pipeline.mjs) and the
   shapers it spreads; publisher/renderer agreement is
   tests/flows-payload-shape.mjs's job and not this file's.
   ============================================================= */

import assert from "node:assert/strict";
import { buildFactIndex, selectFacts, numeralsIn, guardAnswer, renderFactsPlain, promptFor }
  from "../shared/flows-ask.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

/* ---------- the corpus ------------------------------------------- */

const STAMP = "2026-09-04T08:10:00.000Z";
const NEWEST = "2026-09-04T09:31:00.000Z";

/* The two boards are here for what they feed the BRIEFING, which
   this index imports rather than restating. `cleared` (44 and 53)
   deliberately exceeds rows.length on both sides — the population
   against the page — and `dr` agrees with `r0` and `r` on every row,
   so the yesterday section's counts and its two extremes describe
   the same session rather than a fixture that was tidied. Tickers
   are five characters because a symbol is what a question names, and
   the selection reads a bare uppercase token of one to five. */
const LONG = {
  status: "ok", side: "long", sessionDate: "2026-09-04", generatedAt: STAMP,
  gateOrigin: "2026-09-04", gateDays: 7,
  scored: 118, neutral: 3, cleared: 44, shed: 0,
  memory: { sessionDate: "2026-09-03" },
  rows: [
    { t: "SYN46", r: 1, s: 59, cnv: 96, dr: 2, r0: 3, nw: false, hy: false,
      edte: 1, ed: "2026-09-05", gFlipDist: 0.1224 },
    { t: "SYN35", r: 2, s: 58, cnv: 81, dr: -1, r0: 1, nw: false, hy: false,
      edte: 43, gFlipDist: 5.1 },
  ],
};

const SHORT = {
  status: "ok", side: "short", sessionDate: "2026-09-04", generatedAt: STAMP,
  gateOrigin: "2026-09-04", gateDays: 7,
  scored: 118, neutral: 3, cleared: 53, shed: 3,
  memory: { sessionDate: "2026-09-03" },
  rows: [
    { t: "SYN19", r: 5, s: -37, cnv: 91, dr: -4, r0: 1, nw: false, hy: false,
      edte: 0, ed: "2026-09-04", gFlipDist: -0.9 },
  ],
};

/* Every watch row scores 0 because the dead band is ±1 and `s` is an
   integer, which is why the briefing reads `resid` and the payload's
   own rank instead. Kept here so the index carries a fact built on
   that reading rather than on the score with no resolution. */
const WATCH = {
  status: "ok", side: "watch", sessionDate: "2026-09-04", generatedAt: STAMP,
  scored: 118, neutral: 3, deadBand: 1,
  rows: [{ t: "SYN24", r: 1, s: 0, cnv: 60, resid: -0.008 }],
};

const EVENTS = {
  status: "ok", sessionDate: "2026-09-04", generatedAt: STAMP,
  gateOrigin: "2026-09-04", gateDays: 7, inWindow: 87, shown: 8, cap: 200,
  rows: [{ t: "SYN15", d: "2026-09-04", dte: 0 }],
};

/* The published sector-premium shape: eleven baskets under `sectors`
   with `leanRatio`, never `rows` with `lean`. XLU is measured and
   empty, which is a reading and not a gap. */
const SECTOR_PREMIUM = {
  status: "ok", generatedAt: STAMP, returned: 4, measured: 3, quiet: 1, unreadable: 0,
  units: { leanRatio: "ratio", netPremiumUsd: "usd" },
  sectors: [
    { sector: "Technology", etf: "XLK", leanRatio: 0.42, netPremiumUsd: 512000000, read: "ok" },
    { sector: "Energy", etf: "XLE", leanRatio: -0.31, netPremiumUsd: -41000000, read: "ok" },
    { sector: "Financials", etf: "XLF", leanRatio: 0.07, netPremiumUsd: 8100000, read: "ok" },
    { sector: "Utilities", etf: "XLU", leanRatio: null, read: "quiet" },
  ],
};

/* `flat: 0` and `cardsFailed: 0` further down are the fixture's
   whole point in one place: Number(null) is 0, so a module that
   coerced before testing for absence would publish these two
   measured zeros and an absent field in exactly the same words. */
const MARKET = {
  status: "ok", generatedAt: STAMP, sessionDate: "2026-09-04",
  n: 118, screened: 140,
  premium: { netPositive: 900000000, netNegative: 812000000, net: 88000000,
    priced: 112, oneLegged: 6, tilt: 0.0513, topShare: 0.4212 },
  breadth: { bull: 61, bear: 57, flat: 0, unpriced: 6, tilt: 0.0345 },
  pcr: { volume: 0.83, premium: 0.91, quotedVolume: 118, quotedPremium: 117 },
  aggressor: { callAsk: 41, callBid: 35, putAsk: 22, putBid: 24,
    callLift: 0.54, putLift: 0.48, quoted: 104 },
  vol: { iv30dMedian: 0.4127, iv30dQuoted: 116, ivRankMedian: 0.31, ivRankQuoted: 114 },
};

const MOVERS = {
  status: "ok", generatedAt: STAMP, sessionDate: "2026-09-04",
  universe: 140, cap: 15, ranked: 131, priced: 112,
  unrankedChange: 9, unrankedPremium: 28,
  risers: [{ t: "SYN46", px: 41.2, chg: 0.0412, netPrem: 1200000 }],
  fallers: [{ t: "SYN19", px: 18.4, chg: -0.0377, netPrem: -400000 }],
  premium: { basis: "byName",
    bullish: [{ t: "SYN35", netPrem: 41000000 }],
    bearish: [{ t: "SYN30", netPrem: -18000000 }] },
};

/* `eligible` (5953) is the population after the volume and open
   interest floors, and `shown` is what the two caps left. A list
   that printed only `shown` would read as a market. */
const UNUSUAL = {
  status: "ok", generatedAt: STAMP, sessionDate: "2026-09-04",
  namesSeen: 34, namesTruncated: 2, namesComplete: 32,
  contracts: { rows: [], shown: 50, eligible: 5953, cap: 50, perName: 3, capBound: "rows",
    aggressorReported: 44, notionalReported: 50 },
  names: { rows: [], shown: 25, ranked: 96, universe: 140, unranked: 44, cap: 25 },
};

/* `atVendorLimit: true` is the fact that separates "we capped it"
   from "they capped it": our cap leaves the population known, theirs
   leaves it unknown and at least as large as what arrived. */
const NEWS = {
  status: "ok", generatedAt: NEWEST, sessionDate: "2026-09-04",
  rows: [{ headline: "SYN46 files an 8-K" }],
  requested: 100, returned: 100, kept: 60, cap: 60, capped: true, shed: 40,
  atVendorLimit: true, unusable: 0, undatedKept: 0, undatedSeen: 2,
  newest: "2026-09-04T02:14:00.000Z", oldest: "2026-09-03T13:02:00.000Z",
  ordered: true, orderedBy: "createdAt", orderedDesc: true,
};

const ALERTS = {
  status: "ok", generatedAt: STAMP, readAt: "2026-09-04T08:33:58.572Z",
  refreshed: "nightly",
  rows: [{ t: "SYN35" }, { t: "SYN23" }],
  seen: 2, unusable: 0, shed: 0, cap: 200,
  vendorLimit: 200, vendorTruncated: false,
};

const TRIX = {
  status: "ok", generatedAt: STAMP, span: 15, price: "log",
  basis: "SPDR Select Sector ETFs, not GICS index levels",
  measured: 3,
  sectors: [
    { sector: "Technology", etf: "XLK", trix: 61 },
    { sector: "Energy", etf: "XLE", trix: 44 },
    { sector: "Financials", etf: "XLF", trix: 52 },
    { sector: "Utilities", etf: "XLU", trix: null, reason: "no candles" },
  ],
};

const RECORD = {
  status: "ok", generatedAt: STAMP,
  retained: 21, firstSession: "2026-08-03", lastSession: "2026-09-03",
  horizons: [], sessions: [], epoch: null,
};

const SCORETRACK = {
  status: "ok", generatedAt: STAMP,
  windowSessions: 21, deadBand: 1,
  names: [{ t: "SYN46" }, { t: "SYN35" }],
  namesSeen: 130, namesShed: 128, shedBy: "bytes", namesBytes: 24000,
};

/* Four blocks carrying a status, two of them silent in two different
   ways — the census counts what answered, the silences name what did
   not, and neither number is allowed to stand for the other. */
const POLITICAL = {
  generatedAt: STAMP, readAt: "2026-09-04T07:02:00.000Z",
  window: { from: "2026-06-06", to: "2026-09-04", days: 90 },
  source: { route: "congress/recent-trades", pages: 3, pageLimit: 100 },
  filings: 25, unusable: 3, latestFiled: "2026-09-02", freshFilings: 4,
  buyers: { status: "ok", rows: [{ who: "A" }] },
  assets: { status: "ok", rows: [{ t: "SYN46" }] },
  recent: { status: "quiet", rows: [] },
  holders: { status: "unavailable", reason: "not fetched" },
};

const PULSE = {
  generatedAt: STAMP, cadenceMinutes: 15, notes: { refused: "no forecast" },
  tide: { status: "ok", rows: [{ m: 1 }] },
  totals: { status: "ok", rows: [{ m: 2 }] },
  darkpool: { status: "quiet", rows: [] },
  insiders: { status: "unavailable", reason: "not fetched" },
};

const META = {
  generatedAt: STAMP, sessionDate: "2026-09-04",
  universe: 140, enriched: 128, liquid: 96,
  cardsBuilt: 34, cardsFailed: 0, cardsSkipped: 2,
  apiCalls: 812, probes: {},
};

const STORE = {
  "board:long": LONG, "board:short": SHORT, "board:watch": WATCH,
  events: EVENTS, flowalerts: ALERTS, "sector:premium": SECTOR_PREMIUM,
  market: MARKET, movers: MOVERS, unusual: UNUSUAL, news: NEWS,
  "sector:trix": TRIX, pulse: PULSE, political: POLITICAL,
  scoretrack: SCORETRACK, record: RECORD, meta: META,
};

const INDEX = buildFactIndex(STORE);
const byId = (id) => INDEX.facts.find((f) => f.id === id);

/* ---------- 1. the numeral scanner ------------------------------- */
{
  same(numeralsIn("1,234 contracts changed hands"), ["1,234"],
     "a grouped figure is one token, kept exactly as written — 1,234 and 1234 are two " +
     "different strings and only one of them can have been quoted");
  same(numeralsIn("$1.2M of premium"), ["1.2"],
     "the currency mark and the magnitude letter are UNITS, not part of the number, so a " +
     "model that rewrites a published 1200000 as $1.2M has written a numeral nobody " +
     "published and is caught");
  same(numeralsIn("-3.4% against 0.5 over 12 sessions"), ["-3.4", "0.5", "12"],
     "a signed percentage, a decimal and a bare integer all read as their numeral");
  same(numeralsIn("nothing measurable here"), [],
     "prose with no figures yields no tokens rather than an empty string");
  same(numeralsIn(null), [],
     "and a non-string is absent rather than coerced — the house rule the whole file " +
     "is organised around");
}

/* ---------- 2. a measured zero is a reading ---------------------- */
{
  const breadth = byId("market/breadth");
  ok(breadth, "the market-wide breadth reading reaches the index");
  eq(breadth.n.flatNames, 0,
     "a session in which exactly 0 names were balanced reports that 0 — Number(null) is " +
     "also 0, which is why absence is tested before coercion and never after");
  ok(/\b0 were exactly balanced\b/.test(breadth.say),
     "and the zero is in the SENTENCE too, not only in the machine-readable pin: " +
     "withholding it would turn a measured balance into a hole a reader fills in");

  const run = byId("meta/run");
  ok(/\b0 failed\b/.test(run.say),
     "the same on the run summary — 0 cards failed is the good outcome and is stated " +
     "rather than suppressed as uninteresting");

  /* THE OTHER HALF OF THE RULE. An absent reading drops the whole
     sentence rather than printing a zero it never received, and the
     surface's other sentences are unaffected. */
  const thin = buildFactIndex({ market: { ...MARKET,
    premium: { ...MARKET.premium, net: null } } });
  ok(!thin.facts.find((f) => f.id === "market/premium"),
     "a net premium that was never published produces NO sentence about net premium");
  ok(thin.facts.find((f) => f.id === "market/breadth"),
     "while the readings that did arrive on the same key are still stated — one absent " +
     "field silences its own sentence and not the surface");
  for (const f of INDEX.facts.concat(thin.facts)) {
    ok(!/\b(null|undefined|NaN)\b/.test(f.say),
       `no fact ever prints an absence as a word — "${f.say.slice(0, 50)}"`);
  }
}

/* ---------- 3. the three silences arrive as three ---------------- */
{
  /* Three failures of three different kinds in one store: a key the
     reader does not have, a key published and measured empty, and a
     key that arrived in a shape nothing can read.

     THE FIRST ONE IS ABSENT, NOT NULL, AND THE DIFFERENCE IS REAL.
     This fixture used to write `political: null` under a comment
     calling it "a key the reader does not have" — but null is what
     readFlowsPayload returns when the READ ITSELF failed, which is a
     fault on our side, while an absent key was simply never written.
     Collapsing them merges two of the three silences at the one place
     they enter this module, and the merged answer is the wrong one in
     both directions: it would tell a reader a job had not run when a
     read had failed. Both are asserted below, separately. */
  const tornStore = {
    ...STORE,
    news: { status: "quiet", generatedAt: STAMP, rows: [], returned: 0, kept: 0 },
    market: "not an object at all",
  };
  delete tornStore.political;
  const torn = buildFactIndex(tornStore);

  const pending = torn.silences.pending.find((q) => q.source === "political");
  const quiet = torn.silences.quiet.find((q) => q.source === "news");
  const unreadable = torn.silences.unreadable.find((q) => q.source === "market");

  ok(pending, "a key the reader does not hold is PENDING — the pipeline has not published " +
     "it for this session, so nothing was measured and nothing is claimed");
  ok(quiet, "a key published with nothing in it is QUIET, which is a reading");
  ok(unreadable, "and a key that arrived unparseable is UNREADABLE — a fault on this page " +
     "rather than a fact about the session");

  ok(!torn.silences.unreadable.some((q) => q.source === "political"),
     "an absent key is never reported as unreadable: 'could not be read' says a fault " +
     "happened here, and nothing failed when a key was simply never written");

  /* AND THE OTHER HALF OF THE SPLIT. An explicit null is what
     readFlowsPayload returns when the read FAILED — the key may well
     have been published. Reporting that as "not published yet" would
     blame the pipeline for a fault on the serving side, and a reader
     told a job has not run waits for it rather than reloading. */
  const nulledRead = buildFactIndex({ ...STORE, political: null });
  ok(nulledRead.silences.unreadable.some((q) => q.source === "political"),
     "a key whose read returned null is UNREADABLE — published or not, what failed was " +
     "the reading of it, and that is a fault on this side");
  ok(!nulledRead.silences.pending.some((q) => q.source === "political"),
     "and it is never also called pending, because a failed read is not an unwritten key");

  const sentences = new Set([pending.say, quiet.say, unreadable.say]);
  eq(sentences.size, 3,
     "the three carry three different sentences — two outages worded alike is how a " +
     "reader concludes there was one outage, or worse, that the market was quiet");

  const kinds = ["pending", "unreadable", "quiet"];
  for (const kind of kinds) {
    for (const q of torn.silences[kind]) {
      eq(q.kind, kind, `every entry filed under ${kind} says so on itself, so a caller ` +
        "cannot lose the distinction by flattening the three lists");
    }
  }

  /* THE SPLIT HOLDS ON BOTH HALVES OF THE INDEX, and that is the
     assertion, not the classification of any one key. The briefing's
     six surfaces are filled in by their own module and everything else
     by this one, so a store carrying one null of each kind is answered
     twice — and a reader should not have to know which half they are
     reading to know whether a board that is not there is a fault or a
     job that has not run.

     It read both ways once. A null board was called "not published for
     this session yet" while a null market on the same store was called
     a fault on this page: one store, one index, two opposite
     diagnoses, and the sentence a reader got decided whether they
     waited for the pipeline or went looking for the breakage. */
  const nulled = buildFactIndex({ "board:long": null, "board:short": null, market: null });
  ok(nulled.silences.unreadable.some((q) => q.what === "bullish board"),
     "a board whose read returned null is UNREADABLE — null is what readFlowsPayload " +
     "hands back when the read itself failed, and that is a fault on this side");
  ok(!nulled.silences.pending.some((q) => q.what === "bullish board"),
     "and never pending: a reader told the job has not run waits for a job that already " +
     "ran");
  ok(nulled.silences.unreadable.some((q) => q.source === "market"),
     "and the other half of the index says the same thing about the same kind of null");

  /* AND undefined IS THE OTHER DIRECTION, on both halves too. A store
     built by spreading a parse writes every key it did not find as
     undefined, and there is nothing in that a page could have failed
     to read. */
  const blank = buildFactIndex({ "board:long": undefined, market: undefined });
  ok(blank.silences.pending.some((q) => q.what === "bullish board"),
     "a board key written as undefined is PENDING — nothing was measured and nothing " +
     "is claimed");
  ok(blank.silences.pending.some((q) => q.source === "market"),
     "and a surface key written as undefined is pending as well, rather than a fault " +
     "reported on a surface nothing had tried to publish");
  eq(blank.silences.unreadable.length, 0,
     "with no fault claimed anywhere on that store: an absent key is not a failed read " +
     "on either half of this index");

  /* A STORE WITH NOTHING IN IT is the ordinary state before the
     morning run, and NONE of it is a fault. Two of the briefing's
     silences are decided from the absence of rows rather than from
     the state of the key — "neither board could be read" and a next
     session called "a measured emptiness" — and both of those are
     wrong about a key that was never written. */
  const cold = buildFactIndex({});
  eq(cold.facts.length, 0, "an empty store yields no facts, which is not the same as no news");
  eq(cold.silences.unreadable.length, 0,
     "and reports NO fault at all: telling a reader something could not be read, on a " +
     "morning when the job has simply not run, sends them looking for a breakage that " +
     "does not exist");
  eq(cold.silences.quiet.length, 0,
     "and claims no measured emptiness either — nothing was measured, so 'nothing is " +
     "scheduled' is not a reading anybody took");
  ok(cold.silences.pending.length > 10,
     "every surface is pending instead, each saying so in its own sentence");
  ok(cold.silences.pending.some((q) => /neither board has been published/i.test(q.say)),
     "including the comparison against yesterday, which is unavailable rather than broken");

  /* The feeds inside a compound key own their own silence: one dead
     block does not make the key dead, and the census counts only
     what answered. */
  const feeds = INDEX.silences.quiet.filter((q) => q.source === "pulse");
  const dead = INDEX.silences.unreadable.filter((q) => q.source === "pulse");
  eq(feeds.length, 1, "a pulse feed that was measured and empty is one quiet silence");
  eq(dead.length, 1, "and a feed that never fetched is unreadable, separately");
  eq(dead[0].reason, "not fetched",
     "carrying the publisher's own reason as data beside the sentence rather than " +
     "inside it");
  eq(byId("pulse/coverage").n.answeredFeeds, 2,
     "while the fact counts the feeds that ANSWERED — a census is a reading and the two " +
     "silences above are not folded into it");
}

/* ---------- 4. the numeral guard -------------------------------- */
{
  const { picked } = selectFacts(INDEX, "how did the tape lean on premium");
  const breadth = byId("market/breadth");

  const faithful = guardAnswer(
    "Of the 118 names read, 61 leaned bullish and 57 leaned bearish.", [breadth]);
  ok(faithful.ok,
     "an answer that only restates figures from the facts it was given is ACCEPTED — a " +
     "guard that fired on a faithful restatement would be the defect");
  eq(faithful.rejected.length, 0, "with nothing refused");

  const invented = guardAnswer(
    "Of the 118 names read, 61 leaned bullish, which is 52 percent of the tape.",
    [breadth]);
  eq(invented.ok, false,
     "a figure the model DERIVED is refused even though every input to it was quoted: " +
     "52 appears in no fact, so it was computed, and computation is where a briefing " +
     "starts inventing");
  ok(invented.rejected.includes("52"),
     "and the refused token is named, so a caller can log what was caught");
  ok(!/\d/.test(invented.reason),
     "while the REASON carries no figures of its own — printing it under a " +
     "deterministic answer must not put an unquoted number back on the page in the " +
     "sentence explaining why an unquoted number was refused");

  const reformatted = guardAnswer("Net premium was $88M.", [byId("market/premium")]);
  eq(reformatted.ok, false,
     "and a rewrite of 88000000 into $88M is arithmetic too — the published figure is " +
     "the one that was measured, in the units it was measured in");

  const dated = guardAnswer("The 2026 session was read on the 4th.", [breadth]);
  ok(dated.ok,
     "a four-digit year and a small ordinal pass unquoted, because dates and ordinals " +
     "are how sentences are written and a guard nobody can satisfy gets switched off");

  const zero = guardAnswer("Nothing cleared: 0 names.",
    [{ id: "x", say: "Two names cleared the band.", n: {} }]);
  eq(zero.ok, false,
     "but ZERO is not whitelisted with the other small integers — it is the one figure " +
     "this product refuses to let anything except a measurement produce");
  ok(zero.rejected.includes("0"), "and it is named as the reason");

  /* AND THE SPELLED-OUT ZERO IS THE SAME FIGURE. The scan reads
     numerals, so the line above was caught and this one was not —
     while the word is how a model actually writes a count, which left
     the one integer this file refuses reachable by spelling it. */
  const worded = guardAnswer("Nothing cleared: zero names.",
    [{ id: "x", say: "Two names cleared the band.", n: {} }]);
  eq(worded.ok, false,
     "a zero written as a word is refused exactly as the digit is — a fabricated zero " +
     "is the defect whichever way it is spelled");
  ok(worded.rejected.includes("zero"), "and the word is named among the refused tokens");
  eq(worded.invented, true,
     "and it is filed as an invented figure rather than as a claim about the future, " +
     "because a caller branches on which of the two failures it was");

  /* THE OTHER HALF OF THAT RULE, AND IT IS WHY THE TEST IS THE WORD
     RATHER THAN A BAN. market/vol says the IV rank is on a
     "zero-to-one scale" and carries no bare 0, so a model restating
     it writes the word from the text it was handed. */
  const scale = guardAnswer("The median IV rank sits on a zero-to-one scale.",
    [byId("market/vol")]);
  ok(scale.ok,
     "a zero the facts themselves put in front of the model passes, because the guard " +
     "asks whether a figure was handed over and not whether it is a zero");

  const empty = guardAnswer("   ", picked);
  eq(empty.ok, false,
     "an empty answer is refused rather than shown: there is nothing to check and " +
     "nothing to read");
  ok(!/\d/.test(empty.reason), "and that reason is figure-free as well");
}

/* ---------- 5. the forecast scan -------------------------------- */
{
  const picked = [byId("market/breadth")];
  const willed = guardAnswer("The board will lean bullish tomorrow.", picked);
  eq(willed.ok, false,
     "'will' is refused wherever it appears in an answer — tests/flows-brief.mjs runs " +
     "this same scan over the next-session facts, and a guarantee that held for the " +
     "module and evaporated in the prose would be no guarantee");
  ok(willed.rejected.includes("will"), "and the verb is named");

  eq(guardAnswer("A reversal is expected into the close.", picked).ok, false,
     "so is 'expected'");
  eq(guardAnswer("Premium should keep rising.", picked).ok, false, "and 'should'");
  eq(guardAnswer("It is likely to continue.", picked).ok, false, "and 'likely'");
  eq(guardAnswer("The tape is going to turn.", picked).ok, false, "and 'going to'");

  /* THE INVARIANT THAT MAKES THE FALLBACK POSSIBLE. If any fact in
     the index carried one of these verbs, the deterministic answer
     built from that fact would fail the guard it exists to satisfy. */
  const FORECAST = /\b(will|should|expect(?:ed)?|likely|going to|forecast|predict)\b/i;
  for (const f of INDEX.facts) {
    ok(!FORECAST.test(f.say),
       `no fact in the index claims the future — "${f.say.slice(0, 55)}"`);
  }
}

/* ---------- 6. selection is deterministic and truthful ---------- */
{
  const capped = selectFacts(INDEX, "", { max: 3 });
  eq(capped.picked.length, 3, "the cap is obeyed");
  eq(capped.capped, true, "and reported as true when facts were left out");
  ok(/\bof \d+ facts\b/.test(capped.why),
     "with the POPULATION stated: the cap here is ours, so the total is exactly " +
     "reportable and a list that truncates silently would read as the whole index");

  const roomy = selectFacts(INDEX, "", { max: INDEX.facts.length + 5 });
  eq(roomy.capped, false, "and false when everything fitted — capped is a fact, not a mood");

  const nonsense = selectFacts(INDEX, "zqx wibble frobnicate");
  ok(nonsense.picked.length > 0,
     "a question that matches nothing still returns the session's headline readings: an " +
     "empty answer while the index holds facts is a worse answer than the wrong ones");
  ok(/matched/i.test(nonsense.why),
     "and the selection SAYS it matched nothing, so the caller can lead with that " +
     "rather than implying the facts were chosen for the question");

  const named = selectFacts(INDEX, "what is going on with SYN46 in the news");
  ok(named.picked[0].topic.includes("syn46"),
     "a ticker named in the question outranks a topic word, because a question naming a " +
     "symbol is asking about that symbol");

  const empty = selectFacts({ facts: [] }, "anything");
  eq(empty.picked.length, 0, "an empty index selects nothing");
  eq(empty.capped, false, "and does not claim to have capped anything");

  /* A SHOUTED QUESTION IS NOT A LIST OF TICKERS. "IS SYN46 A MARKET
     NAME" has four bare uppercase tokens and one ticker; without the
     lowercase test every word in it would be weighted as a symbol. */
  const two = { facts: [
    { id: "a", topic: ["market", "breadth"], say: "A.", n: {}, source: "market", at: null },
    { id: "b", topic: ["syn46", "movers"], say: "B.", n: {}, source: "movers", at: null },
  ] };
  eq(selectFacts(two, "is SYN46 a market name?").picked[0].id, "b",
     "with lowercase in the question, SYN46 is read as a ticker and wins outright");
  eq(selectFacts(two, "IS SYN46 A MARKET NAME?").picked[0].id, "a",
     "shouted, no token is treated as a ticker, both facts match one word each, and the " +
     "tie falls to the fixed source order rather than to whichever fact was indexed first");
}

/* ---------- 7. THE FALLBACK PASSES ITS OWN GUARD ---------------- */
{
  /* THIS IS THE ASSERTION THAT MATTERS MOST. renderFactsPlain is
     what ships when the guard fires, when the day's free model
     allowance is spent, and when no model was reachable. If it
     carried a figure or a verb the guard refuses, the product's
     last honest answer would be one the product itself rejects. */
  for (const question of ["what happened today", "SYN46", "zqx", ""]) {
    const { picked } = selectFacts(INDEX, question);
    const plain = renderFactsPlain(picked, question);
    const verdict = guardAnswer(plain, picked);
    ok(verdict.ok,
       `the deterministic answer to "${question}" passes the guard it exists to satisfy` +
       (verdict.ok ? "" : " — refused: " + verdict.rejected.join(", ")));
  }

  /* Fact by fact, so a single sentence that broke the rule cannot
     hide inside a long answer that happens to pass. */
  for (const f of INDEX.facts) {
    const verdict = guardAnswer(renderFactsPlain([f], "x"), [f]);
    ok(verdict.ok, `and one fact alone renders to an answer that passes: "${f.id}"` +
       (verdict.ok ? "" : " — refused: " + verdict.rejected.join(", ")));
  }

  const nothing = renderFactsPlain([], "what happened");
  ok(guardAnswer(nothing, []).ok,
     "even with nothing to say, the sentence that says so carries no figure and no verb " +
     "the guard would refuse");
  ok(!/error|failed|sorry/i.test(nothing),
     "and it reads as an answer rather than as a breakage: the facts were always " +
     "deterministic, so a reader who lands here has lost the phrasing and nothing else");

  const answered = renderFactsPlain(selectFacts(INDEX, "premium").picked, "premium");
  ok(!/premium\?/.test(answered),
     "the question is never quoted back, because a reader's own figures would then ride " +
     "into an answer that is supposed to contain only published ones");
}

/* ---------- 8. every figure in a fact is pinned in `n` ---------- */
{
  /* The same scan tests/flows-brief.mjs runs, over the whole index.
     `n` is not the guard's input — the guard reads the prose — but
     it is the anti-tamper record that lets a reader confirm each
     sentence was BUILT from measured fields rather than composed. */
  let scanned = 0;
  for (const f of INDEX.facts) {
    const quoted = new Set();
    for (const v of Object.values(f.n)) {
      if (typeof v === "number") quoted.add(String(v));
      else if (typeof v === "string") quoted.add(v);
      else if (Array.isArray(v)) for (const x of v) quoted.add(String(x));
    }
    /* String values are masked out before the digits are read: a
       ticker like SYN46 carries digits inside a symbol that is
       itself pinned, and a naive scan would accuse the module of an
       unpinned "046". */
    let stripped = f.say;
    for (const v of quoted) {
      if (typeof v === "string" && /\D/.test(v)) stripped = stripped.split(v).join(" ");
    }
    for (const lit of stripped.match(/-?\d+(?:\.\d+)?/g) || []) {
      scanned++;
      ok(quoted.has(lit) || quoted.has(String(Number(lit))),
         `every figure in a fact is pinned in n — "${lit}" in "${f.say.slice(0, 55)}"`);
    }
  }
  ok(scanned >= 30,
     `the scan inspected real numbers (${scanned}) rather than passing over empty prose`);
}

/* ---------- 9. the index composes rather than duplicates -------- */
{
  const brief = INDEX.facts.filter((f) => f.source === "brief");
  ok(brief.length >= 3,
     "the three-session briefing reaches the index through shared/flows-brief.js rather " +
     "than being written a second time — two derivations of 'what moved' is how two " +
     "surfaces end up disagreeing about one session");
  ok(brief.some((f) => f.id.startsWith("brief:today/")),
     "today's section is there");
  ok(brief.some((f) => f.id.startsWith("brief:next/")),
     "and the next-session section, which is the one the forecast scan above protects");

  eq(INDEX.generatedAt, NEWEST,
     "the index is stamped with the NEWEST reading it was built from, which is a " +
     "measurement — Date.now() here would be impure and would stamp it with the " +
     "reader's clock instead of the run that produced the numbers");

  for (const f of INDEX.facts) {
    ok(Array.isArray(f.topic) && f.topic.length > 0, `every fact carries keywords: ${f.id}`);
    ok(typeof f.source === "string" && f.source, `and names the key it came from: ${f.id}`);
    ok(f.n && typeof f.n === "object" && !Array.isArray(f.n),
       `and pins its numbers in an OBJECT keyed by what each number is, so the units ` +
       `travel with the value: ${f.id}`);
  }

  /* Two surfaces the briefing reads and this index deliberately does
     not restate, against one it owns outright. */
  ok(!INDEX.facts.some((f) => f.source === "sector:premium"),
     "the sector premium lean belongs to the briefing, which already reads that key");
  ok(byId("sector:trix/coverage"),
     "while sector momentum is this index's own — a different quantity from the premium " +
     "lean, and the two may disagree for weeks with neither being wrong");
}

/* ---------- 10. the prompt states the rules it is held to ------- */
{
  const { picked } = selectFacts(INDEX, "how did the market lean", { max: 4 });
  const { system, user } = promptFor(picked, "how did the market lean");

  ok(/arithmetic/i.test(system), "the system prompt forbids arithmetic in as many words");
  ok(/never write a number/i.test(system),
     "and forbids any number that is not already in the supplied facts");
  for (const word of ["PENDING", "UNREADABLE", "QUIET"]) {
    ok(system.includes(word),
       `the three silences are named in the prompt too, ${word} among them — a model that ` +
       "merged them would answer 'nothing happened' for a job that has not run");
  }
  ok(/units travel with numbers/i.test(system),
     "and units are required to travel with the numbers they belong to");

  ok(user.includes("how did the market lean"), "the question reaches the model");
  for (const f of picked) {
    ok(user.includes(f.say), `and every selected fact is handed over verbatim: ${f.id}`);
  }
  ok(!/^\s*1\./m.test(user),
     "the facts are listed UNNUMBERED: a model asked to cite 'fact 15' writes a 15 that " +
     "no payload published, and its own answer would then be refused for a numeral this " +
     "prompt handed it");
}

console.log(`✓ flows-ask: ${checks} assertions — an index whose every figure is quoted from a ` +
  `published payload, three silences that stay three from the store all the way into the ` +
  `answer, deterministic selection that caps truthfully and never returns nothing while it ` +
  `holds something, a guard that refuses an invented figure and a claim about the future, ` +
  `and a fallback answer that passes the guard it exists to satisfy`);
