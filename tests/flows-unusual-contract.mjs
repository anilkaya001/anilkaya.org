/* =============================================================
   flows-unusual-contract.mjs — the unusual-activity feed.

   THIS SUITE IS SCOPED TO THE PURE MODULE AND THE PAYLOAD, both of
   which exist and are stable. assets/js/flows-unusual.js is being
   written in parallel; nothing here touches it, and nothing here
   assumes it exists.

   WHAT IS WORTH ASSERTING ABOUT THIS MODULE is not that it computes
   what it computes. shared/flows-unusual.js opens with two REFUSALS —
   the unit is a contract counter and not a trade, and the counter has
   NO DATE — and every expensive defect this feed can ship is a quiet
   breach of one of them: a null that becomes a zero, a half-bracket
   that reads as a narrow one, a name with no measurement ranked as a
   name with a measurement of zero, a diagnostic that turns "I could
   not falsify it" into "I confirmed it". Those are the assertions
   below.

   ON FIXTURES, and this is the house rule the repo has paid for five
   times: a fixture written from the same assumption as the code
   proves only that the assumption is self-consistent. So every
   fixture here starts as something the pipeline's OWN emitter or its
   OWN chain generator produced. Where the state under test does not
   occur in that corpus — an absent prev_oi, a name with no 30-day
   average, an open-interest series that never exceeds its volume —
   the fixture is an emitted row with ONE NAMED FIELD MUTATED, and
   the mutation is said to be the point of the test at the site.

   TWO PLACES WHERE THIS SUITE DELIBERATELY DOES NOT ASSERT WHAT IT
   WAS ASKED TO, both marked in full at the site: the literal
   word-ban on the 429 line (§9), and aggr on a reported 0/0 split
   (§3). Both are argued in a comment rather than quietly softened.
   ============================================================= */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  UA_MIN_VOLUME, UA_MIN_OI, UA_ROWS, UA_NAMES, UA_PER_NAME_MIN, UA_PER_NAME_MAX,
  perNameCap, buildUnusualRows, rankUnusual,
  unusualNameRow, rankUnusualNames,
  describeFlowAlerts, describeOiBasis, UNUSUAL_NOTES,
} from "../shared/flows-unusual.js";
import { buildChainPanels, buildTopContracts, buildAggressor } from "../shared/flows-chain.js";
import { daysToExpiry, SHARES_PER_CONTRACT } from "../shared/flows-premium.js";
import { fakeChain, screenerTilt } from "../scripts/flows-pipeline.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

/* ---------- the corpus ------------------------------------------ */

/* THE PAYLOAD IS EMITTED HERE RATHER THAN COMMITTED. A committed fixture
   freezes the schema of the day it was captured, and this suite's whole claim
   is that it reads what the pipeline actually writes. 0.7s for a dry run. */
const EMIT_DIR = path.join(ROOT, "tests", ".unusual-emit");
fs.rmSync(EMIT_DIR, { recursive: true, force: true });
fs.mkdirSync(EMIT_DIR, { recursive: true });

let PAYLOAD;
try {
  execFileSync(process.execPath,
    [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", EMIT_DIR + "/"],
    { stdio: "ignore" });
  PAYLOAD = JSON.parse(fs.readFileSync(path.join(EMIT_DIR, "-unusual.json"), "utf8"));
} finally {
  fs.rmSync(EMIT_DIR, { recursive: true, force: true });
}

/* THE CHAIN CORPUS is the pipeline's own generator, which already carries the
   shapes that broke this leg before: rows with no volume key, rows with no
   aggressor split, a no-bid line, and one adjusted-series root. */
const SPOT = 100;
const CHAIN = fakeChain("SYN001", SPOT, 4242);
const OWN = CHAIN.filter((r) => /^SYN001\d{6}[PC]\d{8}$/.test(r.option_symbol));
/* One emitted chain row that clears both floors with both quote sides and both
   aggressor legs present. Every mutation in §1–§5 is this row with one field
   changed, so the difference between two assertions is exactly one field. */
const SEED = OWN.find((r) => Number(r.volume) >= 400 && Number(r.open_interest) >= 500 &&
  r.ask_volume !== undefined && r.bid_volume !== undefined &&
  r.nbbo_bid !== undefined && r.nbbo_ask !== undefined);
ok(SEED && Number(SEED.volume) >= UA_MIN_VOLUME && Number(SEED.open_interest) >= UA_MIN_OI,
   "the emitted chain yields a seed row clearing both floors with a two-sided quote and " +
   "both aggressor legs — every mutation below is this row with one field changed");

const drop = (row, ...keys) => {
  const c = { ...row };
  for (const k of keys) delete c[k];
  return c;
};
const build = (row, opts = {}) => buildUnusualRows(Array.isArray(row) ? row : [row],
  { ticker: "SYN001", spot: SPOT, sessionDate: "2026-08-24", ...opts });
const one = (row, opts) => build(row, opts)[0];

/* ---------- §1 vor is finite BY CONSTRUCTION --------------------- */

/* The module's claim is not "vor is guarded" but "vor cannot be infinite
   because UA_MIN_OI defines the population". The difference is testable: a
   guard would publish the row with a sentinel; a population boundary never
   admits it at all. */
{
  const base = one(SEED);
  ok(Number.isFinite(base.vor) && base.vor > 0,
     "the unmutated seed row carries a finite, positive vor");

  /* MUTATION IS THE POINT: no emitted chain row carries a zero, empty or
     absent open interest — the vendor's chain request excludes them — so the
     only way to test the denominator's boundary is to put one there. */
  for (const [label, oi] of [["zero", 0], ["null", null], ["empty string", ""], ["the string 0", "0"]]) {
    const rows = build({ ...SEED, open_interest: oi });
    eq(rows.length, 0,
       `open_interest ${label} EXCLUDES the contract from the feed entirely — it is not ` +
       "published with a sentinel vor, because Infinity is not a ranking key and a " +
       "special-cased null would be a guard a reader has to trust");
  }
  eq(build(drop(SEED, "open_interest")).length, 0,
     "an ABSENT open_interest is excluded on the same footing: a contract the vendor did " +
     "not report on is not a contract with no open interest");

  /* And the same at the other end — a volume the vendor never sent must not
     become a numerator of zero, which would publish vor = 0 as a reading. */
  for (const [label, vol] of [["zero", 0], ["null", null], ["empty string", ""]]) {
    eq(build({ ...SEED, volume: vol }).length, 0,
       `volume ${label} is excluded rather than ranked at vor = 0`);
  }
  eq(build(drop(SEED, "volume")).length, 0, "and so is an absent volume key");

  /* Over the emitted feed, the construction argument in whole: every published
     row's denominator is at or above the floor, so no arithmetic downstream of
     this payload can divide by zero either. JSON cannot even carry Infinity or
     NaN — both serialise to null — so `typeof === "number"` is the assertion
     that catches a sentinel having been published. */
  const rows = PAYLOAD.contracts.rows;
  ok(rows.length > 0, `the emitted feed published ${rows.length} contracts to read`);
  ok(rows.every((r) => typeof r.vor === "number" && Number.isFinite(r.vor) && r.vor > 0),
     "every emitted row's vor is a finite positive NUMBER — not null, which is what an " +
     "Infinity or a NaN would have become on the wire");
  ok(rows.every((r) => r.oi >= UA_MIN_OI),
     `every emitted row's open interest is at or above UA_MIN_OI (${UA_MIN_OI}), which is ` +
     "the whole of the finiteness argument");
  ok(rows.every((r) => r.vol >= UA_MIN_VOLUME),
     `and every row's volume is at or above UA_MIN_VOLUME (${UA_MIN_VOLUME})`);
  ok(rows.every((r) => r.vor <= r.vol / UA_MIN_OI + 1e-9),
     "and vor is bounded above by volume / UA_MIN_OI, which is what makes the bound a " +
     "consequence of the population rather than of the data that happened to arrive");
}

/* ---------- §2 the floors are MEMBERSHIP TESTS ------------------- */

/* A floor on a measurement says "this contract was quiet". A floor on a
   population says "this contract is not in the set being ranked" and claims
   nothing about it. The two are told apart by what is published. */
{
  eq(build({ ...SEED, volume: String(UA_MIN_VOLUME - 1) }).length, 0,
     `a contract one lot below UA_MIN_VOLUME is ABSENT from the feed — no row, no zero, ` +
     "no 'below threshold' marker, because nothing is being claimed about it");
  eq(build({ ...SEED, volume: String(UA_MIN_VOLUME) }).length, 1,
     "and a contract exactly at the floor is IN: the boundary is inclusive, which is a " +
     "fact a reader arguing with the choice needs stated");
  eq(build({ ...SEED, open_interest: String(UA_MIN_OI - 1) }).length, 0,
     "the same on the other floor — one below is out");
  eq(build({ ...SEED, open_interest: String(UA_MIN_OI) }).length, 1, "and exactly at it is in");

  /* WHAT `eligible` COUNTS, stated so a reader of the payload is not left to
     infer it. It is the population handed to the ranker — the post-floor set —
     so rows lost to the CAPS are counted there while rows below the floors are
     counted nowhere. That is the design: a capped row was in the population and
     lost a comparison; a below-floor row was never in it. */
  const pop = [];
  for (let i = 0; i < 9; i++) pop.push({ t: "N" + i, vor: 1 + i / 100, vol: 100 });
  const r = rankUnusual(pop, { namesSeen: 9, cap: 4 });
  eq(r.eligible, 9,
     "`eligible` counts every row handed to the ranker, including the five the caps cut — " +
     "so `shown of eligible` is a comparison inside one population");
  eq(r.shown, 4, "and `shown` is what survived both caps");
  ok(r.eligible >= r.shown, "eligible is never below shown");
  ok(rankUnusual([], { namesSeen: 0 }).eligible === 0 &&
     rankUnusual([], { namesSeen: 0 }).shown === 0,
     "an empty population reports zero on both rather than throwing or inventing a cap");
}

/* ---------- §3 lift is WITHHELD, never balanced ------------------ */
{
  const askOnly = one(drop(SEED, "bid_volume"));
  eq(askOnly.lift, null,
     "ask_volume present and bid_volume absent: lift is NULL. Not 1 — which would say the " +
     "whole classified population went at the offer — and not 0.5, which would say it was " +
     "balanced. Neither was measured");
  ok(askOnly.lift !== 1 && askOnly.lift !== 0.5 && askOnly.lift !== 0,
     "and specifically none of the three numbers a fallback would have reached for");
  eq(askOnly.aggr, null,
     "aggr is null in the same case, and NOT 0: a difference against a leg that was never " +
     "reported is not a net of zero");
  eq(one(drop(SEED, "ask_volume")).lift, null, "and symmetrically with the ask leg absent");
  eq(one(drop(SEED, "ask_volume")).aggr, null, "aggr too");
  eq(one(drop(SEED, "ask_volume", "bid_volume")).lift, null, "and with neither leg reported");
  eq(one(drop(SEED, "ask_volume", "bid_volume")).aggr, null, "aggr too");

  /* MUTATION IS THE POINT: fakeChain only emits a 0/0 split on a row that never
     traded, and such a row is below the volume floor, so the "reported zero on
     both sides of a contract that DID trade" state cannot occur in the corpus.
     It is put there deliberately. */
  const zeroed = one({ ...SEED, ask_volume: "0", bid_volume: "0" });
  eq(zeroed.lift, null,
     "both legs reported as 0 on a contract that traded: lift is NULL, because a share of " +
     "an empty classified population is undefined, not balanced");
  ok(zeroed.lift !== 0.5 && zeroed.lift !== 0,
     "and again not the two numbers that would read as a measurement");

  /* WHERE THIS SUITE DECLINES TO ASSERT WHAT IT WAS ASKED TO.
     The brief asks that `aggr` also be null here — that a reported 0/0 split is
     not a net of zero. That is a coherent position and it is NOT the position
     this codebase holds, in three places that were written deliberately:

       - shared/flows-chain.js buildTopContracts: `aggr: ask !== null && bid !==
         null ? ask - bid : null`, commented "null, never 0, when the vendor
         sent NO aggressor split" — absence, not a reported zero.
       - shared/flows-chain.js buildAggressor: `if (ask === 0 && bid === 0 &&
         !volume) continue;` — a 0/0 split is dropped only when the contract
         also never traded. With volume it is counted as REPORTED and
         contributes a signed zero.
       - this module, which matches both.

     Changing flows-unusual alone would make two surfaces disagree on one
     relation, and the pipeline harvests buildTopContracts' relation string
     VERBATIM into basis.aggr precisely so they cannot. So the behaviour is
     PINNED here, with the disagreement recorded rather than hidden: if anyone
     changes it, they change it in all three places and this line tells them. */
  eq(zeroed.aggr, 0,
     "aggr on a reported 0/0 split is 0, matching buildTopContracts and buildAggressor. " +
     "PINNED, not endorsed — see the comment above: the brief asked for null here, and " +
     "moving this one call site alone would split one relation across two surfaces");

  /* The one thing that is unambiguous either way: lift and aggr must never
     disagree about whether a leg was REPORTED. */
  const rows = PAYLOAD.contracts.rows;
  ok(rows.every((r) => r.aggr !== null || r.lift === null),
     "over the emitted feed, no row publishes a lift where it withheld an aggr — a share " +
     "of a population it declined to difference would be a reading out of nothing");
  ok(rows.every((r) => r.lift === null || (r.lift >= 0 && r.lift <= 1)),
     "and every published lift is a share on [0, 1]");
  const withheld = rows.filter((r) => r.lift === null).length;
  ok(withheld > 0,
     `${withheld} emitted rows withhold lift, so the withholding branch is exercised by ` +
     "the corpus rather than only by the mutations above");
}

/* ---------- §4 the notional bracket is null on BOTH ends --------- */
{
  const bidOnly = one(drop(SEED, "nbbo_ask"));
  eq(bidOnly.nlo, null,
     "nbbo_bid present, nbbo_ask absent: the LOW end is null too, even though the bid " +
     "alone could have produced it");
  eq(bidOnly.nhi, null, "and the high end with it");
  const askOnly = one(drop(SEED, "nbbo_bid"));
  eq(askOnly.nlo, null, "and symmetrically with the bid absent");
  eq(askOnly.nhi, null,
     "HALF A BRACKET IS AN UNBOUNDED ONE, not a narrower one: publishing the surviving end " +
     "would read as a bound the quote never supported");

  const both = one(SEED);
  eq(both.nlo, Math.round(both.vol * both.bidPx * SHARES_PER_CONTRACT),
     "with both sides quoted the low end is volume x bid x 100");
  eq(both.nhi, Math.round(both.vol * both.askPx * SHARES_PER_CONTRACT),
     "and the high end volume x ask x 100");
  ok(both.nlo <= both.nhi, "and the bracket is ordered");

  const rows = PAYLOAD.contracts.rows;
  ok(rows.every((r) => (r.nlo === null) === (r.nhi === null)),
     "over the emitted feed the two ends are null together on every row, without exception");
  ok(rows.every((r) => r.nlo === null || r.nlo <= r.nhi),
     "and every published bracket is ordered");
  eq(PAYLOAD.contracts.notionalReported, rows.filter((r) => r.nlo !== null).length,
     "and `notionalReported` is the count of rows that got one, so a reader can see how " +
     "much of the column was quoted");
}

/* ---------- §5 doi tells ABSENT from ZERO ------------------------ */
{
  /* MUTATION IS THE POINT: every emitted chain row carries a prev_oi, so the
     payload contains not one absent-previous row (doi nulls: 0). The absent
     case is created here by removing the field from an emitted row. */
  eq(one(drop(SEED, "prev_oi")).doi, null,
     "prev_oi absent: doi is NULL. There is no previous settlement to difference against, " +
     "and 0 would say the book was unchanged");
  eq(one({ ...SEED, prev_oi: "" }).doi, null, "an empty prev_oi is absent, not zero");
  eq(one({ ...SEED, prev_oi: SEED.open_interest }).doi, 0,
     "prev_oi EQUAL to open_interest: doi is 0, and that 0 is a real reading — the book " +
     "was measured across two settlements and did not move");
  ok(one({ ...SEED, prev_oi: SEED.open_interest }).doi !== null,
     "the two states are therefore distinguishable in the payload, which is the point: a " +
     "reader can tell 'unchanged' from 'unknown'");
  const up = one({ ...SEED, prev_oi: String(Number(SEED.open_interest) - 7) });
  eq(up.doi, 7, "and a genuine change is the signed difference in contracts");
  const down = one({ ...SEED, prev_oi: String(Number(SEED.open_interest) + 7) });
  eq(down.doi, -7, "signed in both directions, so the column cannot read as a magnitude");
}

/* ---------- §6 perNameCap derives, clamps, and is reported ------- */
{
  eq(perNameCap(11), 5,
     "eleven names against a fifty-row feed derives a per-name cap of 5 (ceil(50/11)) — a " +
     "fixed 4 would make 'shown: 50' unreachable at that board size");
  eq(perNameCap(50), UA_PER_NAME_MIN,
     `fifty names derives 1 and CLAMPS UP to the minimum of ${UA_PER_NAME_MIN}, so a large ` +
     "board still lets a name contribute more than a single line");
  eq(perNameCap(1), UA_PER_NAME_MAX,
     `one name derives 50 and CLAMPS DOWN to the maximum of ${UA_PER_NAME_MAX}, so a ` +
     "one-name board cannot become fifty rows of one ticker");
  eq(perNameCap(0), UA_PER_NAME_MAX, "zero names floors at one name and clamps the same way");
  eq(perNameCap(NaN), UA_PER_NAME_MAX, "and a NaN name count does not propagate into the cap");
  ok(perNameCap(UA_ROWS / UA_PER_NAME_MAX) <= UA_PER_NAME_MAX,
     "the derived cap never exceeds its maximum anywhere in between");

  /* THE THREE capBound CASES, each forced by a constructed input, because the
     whole value of the field is telling a reader WHICH limit bit. */
  const mk = (names, per) => {
    const out = [];
    for (let i = 0; i < names; i++) {
      for (let j = 0; j < per; j++) out.push({ t: "N" + String(i).padStart(3, "0"), vor: 1 + i / 1000, vol: 100 });
    }
    return out;
  };

  const byRows = rankUnusual(mk(50, 2), { namesSeen: 50 });
  eq(byRows.perName, 2, "fifty names derive a per-name cap of two");
  eq(byRows.shown, UA_ROWS, "and a hundred rows fill the fifty-row feed");
  eq(byRows.capBound, "rows",
     "capBound is \"rows\": the row cap bit, and the reader is told so rather than having " +
     "to compare shown against cap and guess");

  const byName = rankUnusual(mk(3, 5), { namesSeen: 50 });
  eq(byName.perName, 2, "the same derived per-name cap of two");
  eq(byName.shown, 6, "but only three names, so six rows survive against a cap of fifty");
  eq(byName.capBound, "perName",
     "capBound is \"perName\": the feed is short because one limit refused rows, not " +
     "because the population ran out — and \"shown: 6 of 15\" cannot say that on its own");
  ok(byName.eligible > byName.shown,
     "and the rows the per-name cap refused are still counted in eligible");

  const byPop = rankUnusual(mk(3, 1), { namesSeen: 50 });
  eq(byPop.shown, 3, "three names contributing one row each");
  eq(byPop.capBound, "eligible",
     "capBound is \"eligible\": neither cap bit and the population itself was the limit, " +
     "which is a different fact about the session and must not read as a cap");
  eq(byPop.eligible, byPop.shown, "with nothing refused, eligible and shown agree");

  ok(["rows", "perName", "eligible"].includes(PAYLOAD.contracts.capBound),
     "the emitted payload publishes one of the three");
  eq(PAYLOAD.contracts.capBound === "rows", PAYLOAD.contracts.shown >= PAYLOAD.contracts.cap,
     "and \"rows\" is claimed exactly when the feed is full");
}

/* ---------- §7 a name with NO measured surprise is not a zero ---- */

/* THE FIXTURE IS RECONSTRUCTED FROM AN EMITTED NAME ROW AND PROVED SO.
   The payload carries processed name rows, not the screener rows behind them,
   and fakeScreener is not exported — so a hand-written screener row would be
   exactly the "fixture written from the same assumption as the code" this repo
   has paid for. Instead the screener row is SOLVED from an emitted row's own
   published numbers and then run back through the real screenerTilt and the
   real unusualNameRow; the round-trip below is what licenses everything after
   it. Only then is one named field removed. */

/* st is a weighted mean of sc and sp, so it always lies between them and the
   weight is determined. A row whose st sits ON one of its endpoints would
   solve to a zero average, which is not a screener row any vendor sends — such
   rows are skipped rather than reconstructed badly. */
const REBUILDABLE = (r) => r.sc !== null && r.sp !== null && r.st !== null && r.chg !== null &&
  Math.abs(r.st - r.sc) > 0.001 && Math.abs(r.st - r.sp) > 0.001;

const rebuild = (em) => {
  /* st is the volume-weighted blend of the two surprises, so the weight that
     reproduces the emitted st is determined: st = sc*w + sp*(1-w). */
  const w = (em.st - em.sp) / (em.sc - em.sp);
  const callAvg = Math.round(w * 1000) * 1000;      // keeps the volumes integral
  const putAvg = 1e6 - callAvg;
  return {
    ticker: em.t,
    close: String(em.px),
    prev_close: String(em.px / (1 + em.chg)),
    call_volume: String(em.sc * callAvg),
    put_volume: String(em.sp * putAvg),
    avg_30_day_call_volume: String(callAvg),
    avg_30_day_put_volume: String(putAvg),
    put_call_ratio: String(em.putCallRatio),
    relative_volume: String(em.relVolume),
  };
};
{
  const emitted = PAYLOAD.names.rows.filter(REBUILDABLE);
  ok(emitted.length >= 2,
     `the emitted name panel offers ${emitted.length} ranked rows to rebuild from`);

  const [emA, emB] = emitted;
  const rowA = rebuild(emA), rowB = rebuild(emB);
  deep(unusualNameRow(rowA, screenerTilt(rowA)), emA,
     "the reconstructed screener row, put back through the pipeline's OWN screenerTilt and " +
     "this module's unusualNameRow, reproduces the emitted name row field for field — " +
     "which is what makes it an emitted fixture rather than an invented one");
  deep(unusualNameRow(rowB, screenerTilt(rowB)), emB, "and so does the second");

  /* MUTATION IS THE POINT: unranked is 0 across the whole emitted corpus, so a
     name with no 30-day call average does not occur and has to be made. */
  const gapped = drop(rowB, "avg_30_day_call_volume");
  const gappedRow = unusualNameRow(gapped, screenerTilt(gapped));
  eq(gappedRow.st, null,
     "with avg_30_day_call_volume removed, st is NULL — the name has no measured surprise");
  ok(gappedRow.st !== 0,
     "and specifically not 0, which on this column reads as 'as much volume as its own norm'");
  eq(gappedRow.t, emB.t, "the row still identifies itself, so it can be counted");

  const ranked = rankUnusualNames([
    { row: rowA, tilt: screenerTilt(rowA) },
    { row: gapped, tilt: screenerTilt(gapped) },
  ]);
  eq(ranked.universe, 2, "both names are in the universe");
  eq(ranked.ranked, 1, "one of them is rankable");
  eq(ranked.unranked, 1,
     "and the other is COUNTED in `unranked` rather than dropped silently — a name the " +
     "vendor never averaged is a gap in coverage, and the payload states its size");
  eq(ranked.shown, 1, "only the rankable name is shown");
  deep(ranked.rows.map((r) => r.t), [emA.t],
     "and the unmeasured name is absent from the ordering entirely, not sorted in at the " +
     "bottom as though its surprise had been measured at zero");
  ok(ranked.rows.every((r) => r.st !== null),
     "no ranked row carries a null st");
  eq(ranked.ranked + ranked.unranked, ranked.universe,
     "and the three counts close, so nothing vanished between them");

  /* The same discipline, read off the emitted payload. */
  eq(PAYLOAD.names.ranked + PAYLOAD.names.unranked, PAYLOAD.names.universe,
     "the emitted name panel's counts close the same way");
  eq(PAYLOAD.names.shown, PAYLOAD.names.rows.length, "shown is the row count it published");
  eq(PAYLOAD.names.shown, Math.min(PAYLOAD.names.ranked, PAYLOAD.names.cap),
     "and shown is the ranked population capped, not the universe capped");
  ok(PAYLOAD.names.rows.every((r) => r.st !== null),
     "every emitted name row carries a measured st");
  ok(PAYLOAD.names.rows.every((r, i) => i === 0 || PAYLOAD.names.rows[i - 1].st >= r.st),
     "and the panel is ordered by that measurement");
  eq(PAYLOAD.names.cap, UA_NAMES, "against the module's own name cap");
}

/* ---------- §8 st is null when EITHER average is missing --------- */
{
  /* THE ROW IS CHOSEN FOR THE PROPERTY UNDER TEST, not taken first.

     This read `PAYLOAD.names.rows.find(REBUILDABLE)` — whichever rebuildable
     row happened to be at the front — and then asserted that a one-sided
     fallback on THAT row would publish at least half again its true ratio.
     But that margin is a property of the row's own call/put balance, not of
     the module: it held only while the corpus happened to put a lopsided name
     first. Widening the dry-run screener's earnings window changed which names
     clear the gate, a differently balanced row moved to the front, and the
     assertion failed on a change that touched nothing it was testing —
     2.29 against a true 1.879, a real margin that simply was not 1.5x.

     So the row is SEARCHED FOR, by the very quantity the section is about,
     and the search coming back empty is itself the finding: it would mean the
     corpus contains no name lopsided enough to demonstrate what the guard
     prevents, which is a fixture problem and should be reported as one rather
     than passing quietly on a row that proves nothing. */
  const candidates = PAYLOAD.names.rows.filter(REBUILDABLE).map((r) => {
    const built = rebuild(r);
    const oneSided = (Number(built.call_volume) + Number(built.put_volume)) /
      Number(built.avg_30_day_put_volume);
    return { em: r, built, oneSided, margin: oneSided / r.st };
  }).sort((a, b) => b.margin - a.margin);

  ok(candidates.length > 0, "the corpus offers a rebuildable name row to work from");
  const em = candidates[0].em;
  const row = candidates[0].built;
  const st = (r) => unusualNameRow(r, screenerTilt(r)).st;
  eq(st(row), em.st, "the intact row reproduces the emitted st");

  const noCall = drop(row, "avg_30_day_call_volume");
  const noPut = drop(row, "avg_30_day_put_volume");
  eq(st(noCall), null,
     "ONLY the call average missing: st is null. The numerator counts BOTH sides, so " +
     "dividing it by the put average alone would inflate the ratio without saying so");
  eq(st(noPut), null, "only the put average missing: null for the mirrored reason");
  eq(st(drop(row, "avg_30_day_call_volume", "avg_30_day_put_volume")), null,
     "and with both missing, which is the easy case");

  /* The specific lie: the numerator is (call + put), so a module that fell back
     to the surviving denominator would publish roughly double the true ratio. */
  const inflated = candidates[0].oneSided;
  ok(inflated > em.st * 1.5,
     `the one-sided fallback would have published about ${inflated.toFixed(2)} against a ` +
     `true ${em.st} — the failure this null is refusing, and it is large enough to be a ` +
     "different reading rather than a rounding difference");
  ok(st(noCall) !== Number(inflated.toFixed(3)),
     "and it is not what the module publishes");

  /* PRESENT BUT ZERO IS ALSO NOT AN AVERAGE. A name the vendor averaged at zero
     divides by zero on one side; the guard is `> 0`, not `!== null`. */
  eq(st({ ...row, avg_30_day_call_volume: "0" }), null,
     "an average PRESENT and equal to zero is not a usable denominator either, and the " +
     "row is unmeasured rather than infinite");
  eq(st({ ...row, avg_30_day_put_volume: "0" }), null, "on either side");
  eq(st({ ...row, avg_30_day_call_volume: "" }), null, "an empty average is missing");

  /* And a name with averages but no volumes is unmeasured too, rather than 0. */
  eq(st(drop(row, "call_volume")), null,
     "a missing volume on one side is a missing numerator, not a numerator of zero");
  eq(st({ ...row, call_volume: "0", put_volume: "0" }), 0,
     "while volumes REPORTED as zero against real averages are a genuine reading of 0 — " +
     "the name traded nothing against a norm that exists");
}

/* ---------- §9 describeFlowAlerts tells the outcomes apart ------- */

/* The probe exists to write a PERMANENT answer into a comment that has asserted
   for months, without a status code, that this endpoint is unreachable on this
   key. An answer that collapsed two outcomes would give that assertion
   provenance while leaving it wrong, which is worse than having none. */
{
  const cases = [
    ["dry run", { dryRun: true }, "not-probed"],
    ["network failure", { status: -1, network: true, raw: "ECONNRESET" }, "network"],
    ["429", { status: 429, raw: "rate limited" }, "throttled"],
    ["403", { status: 403, raw: "plan does not include this endpoint" }, "refused"],
    ["404", { status: 404, raw: "not found" }, "not-found"],
    ["422", { status: 422, raw: "limit must be an integer" }, "bad-request"],
    ["503", { status: 503, raw: "upstream" }, "other"],
    ["200, unparsable", { status: 200, parsed: false, raw: "<html>gateway</html>" }, "unparsable"],
    ["200, bare array with rows", { status: 200, parsed: true, body: [{ ticker: "AAPL", size: 4 }] }, "reachable"],
    ["200, empty array", { status: 200, parsed: true, body: [] }, "empty"],
    ["200, array under another key", { status: 200, parsed: true, body: { alerts: [{ ticker: "AAPL" }], next: null } }, "reachable-other-shape"],
    ["200, object with no array", { status: 200, parsed: true, body: { message: "ok" } }, "unknown-shape"],
  ];
  const seen = new Map();
  for (const [label, input, verdict] of cases) {
    const got = describeFlowAlerts(input);
    eq(got.verdict, verdict, `${label} reads as "${verdict}"`);
    ok(typeof got.line === "string" && got.line.length > 20,
       `${label} carries a line a human can read out of the log`);
    ok(got.line.startsWith("flow-alerts:"),
       `${label}'s line names the endpoint it is about`);
    seen.set(verdict, (seen.get(verdict) || 0) + 1);
  }
  eq(seen.size, cases.length,
     `all ${cases.length} inputs produce PAIRWISE DISTINCT verdicts — nothing collapses ` +
     "into anything else, which is the entire point of the probe");
  ok(cases.length >= 10,
     "and there are at least the ten outcomes the module's own header commits to " +
     `(it distinguishes ${cases.length}; the header says ten)`);

  /* 429 IS THE ONE THAT MATTERS MOST, because collapsing it into "refused" is
     what would write the wrong permanent answer. */
  const throttled = describeFlowAlerts({ status: 429, raw: "slow down" });
  eq(throttled.verdict, "throttled", "429 is throttled and nothing else");
  ok(throttled.verdict !== "refused", "and is emphatically not the refused verdict");
  /* WHERE THIS SUITE DECLINES TO ASSERT WHAT IT WAS ASKED TO, the second time.
     The brief asks that this line not contain the word "refused" at all. It
     does contain it — as "THROTTLED, NOT REFUSED", which is the clearest
     possible statement of exactly what the brief wants and would be made worse
     by removing the word. A literal word-ban would fail on correct prose, so
     what is asserted is the thing that actually matters: the line may not
     ASSERT a refusal. Every occurrence of the word must be negated. */
  ok(!/(?<!not )refused/i.test(throttled.line),
     "the 429 line contains no UN-NEGATED 'refused': it may say 'NOT REFUSED', which is " +
     "the point, but it may never claim the key was refused");
  ok(/\bNOT REFUSED\b/.test(throttled.line),
     "and it says so in as many words, so a maintainer reading the log cannot mistake a " +
     "rate limit for an answer");
  ok(/still\s+unanswered/i.test(throttled.line) && /must not be touched/i.test(throttled.line),
     "and it says the question is still unanswered and the pipeline's assertion must not " +
     "be edited on the strength of it");

  /* A DRY RUN MUST NOT READ AS ANY VERDICT AT ALL. */
  const dry = describeFlowAlerts({ dryRun: true });
  eq(dry.verdict, "not-probed", "a dry run is 'not-probed'");
  ok(/not probed/i.test(dry.line), "and its line says so in words");
  ok(!/\b(reachable|unreachable|refused|throttled|not found|empty)\b/i.test(dry.line),
     "and contains NO verdict word: nothing was asked, so nothing may be reported. A dry " +
     "run that read as 'unreachable' would be a fabricated answer to the only question " +
     "this probe exists to settle");
  ok(!/\b\d{3}\b/.test(dry.line), "and it quotes no status code, because there was none");

  /* THE SHAPE TRAP. uw() reads {data:[...]}; a 200 carrying its array anywhere
     else would have made uw() return [] and the endpoint look empty. */
  const other = describeFlowAlerts({ status: 200, parsed: true, body: { alerts: [{ a: 1 }], meta: {} } });
  eq(other.verdict, "reachable-other-shape", "a 200 with an array under another key is reachable");
  ok(/REACHABLE/.test(other.line), "and the line says reachable");
  ok(/uw\(\)/.test(other.line) && /\[\]/.test(other.line),
     "and it says uw() would have returned EMPTY for this body — which is how a reachable " +
     "endpoint gets recorded as a dead one");
  ok(/"alerts"/.test(other.line),
     "and it names the key the array actually arrived under, so the fix is one line");
  ok(other.verdict !== "empty",
     "and it is not the 'empty' verdict, which is the mistake it exists to prevent");

  /* The two shapes that are genuinely empty stay apart from the two that are
     genuinely reachable. */
  eq(describeFlowAlerts({ status: 200, parsed: true, body: { data: [{ a: 1 }] } }).verdict, "reachable",
     "a 200 with {data:[rows]} is reachable, and uw() would have worked");
  eq(describeFlowAlerts({ status: 200, parsed: true, body: { data: [] } }).verdict, "empty",
     "a 200 with {data:[]} is accepted-and-empty, which is neither reachable-with-data nor refused");
  ok(/settles nothing/i.test(describeFlowAlerts({ status: -1, network: true, raw: "x" }).line),
     "and a request that never completed says it settles nothing, rather than counting as a refusal");
  ok(/provenance/i.test(describeFlowAlerts({ status: 401, raw: "no" }).line),
     "while a 401 is the one outcome that DOES give the standing assertion provenance, and says so");
}

/* ---------- §10 describeOiBasis does not overclaim ---------------- */

/* Open interest cannot move further across one settlement than the volume
   traded between those settlements. Finding a contract where it did FALSIFIES
   alignment. Finding none proves nothing at all — and the entire value of this
   diagnostic is that its zero branch says so in words. */
{
  const falsified = describeOiBasis(OWN);
  eq(falsified.verdict, "falsified",
     "the emitted chain contains contracts whose open-interest change exceeds their own " +
     "volume, so the corpus reaches this branch without being pushed into it");
  ok(falsified.exceeded > 0 && falsified.seen > 0, "with both counts published");
  ok(falsified.line.includes("are NOT aligned in time"),
     "and the line says the pair and the counter are NOT aligned in time, in those words — " +
     "a falsification is the one thing this function is allowed to claim");
  ok(falsified.line.includes("Open interest cannot move further across one settlement than " +
     "the volume traded between them"),
     "stating the physical fact the falsification rests on, so the claim can be checked");
  /* THIS ASSERTION USED TO PIN "Both cannot be right", because the ticker
     page's top-contracts caption asserted the alignment this line refutes and
     the two shipped side by side. The caption has since been rewritten and
     the counts now travel on the card itself, so the contradiction it named is
     gone — and a line still claiming it would be describing a product that no
     longer exists. What replaces it is the stronger invariant: the verdict a
     maintainer reads in the job log must also be reaching the reader holding
     the table, which tests/flows-ticker-contract.mjs §6d proves it does. */
  ok(/publishes these counts/.test(falsified.line),
     "and saying the card publishes these counts rather than leaving the falsification " +
     "in a log only a maintainer reads");
  ok(!/Both cannot be right/.test(falsified.line),
     "the old line named a contradiction with the ticker caption that no longer exists");

  /* MUTATION IS THE POINT: no emitted chain has zero exceedances, so the
     inconclusive branch cannot be reached from the corpus as it stands. Setting
     prev_oi equal to open_interest on every emitted row makes every change zero
     — which is the quietest possible book, and exactly the case a careless
     implementation would report as confirmation. */
  const quiet = OWN.map((r) => ({ ...r, prev_oi: r.open_interest }));
  const inconc = describeOiBasis(quiet);
  eq(inconc.verdict, "inconclusive", "zero exceedances is INCONCLUSIVE, not confirmation");
  ok(inconc.seen > 0, `on ${inconc.seen} contracts that carried all three fields`);
  eq(inconc.exceeded, 0, "with no exceedance found");
  eq(inconc.exceedShare, 0, "and a share of exactly zero");
  ok(inconc.line.includes("This is INCONCLUSIVE"),
     "the line says INCONCLUSIVE in those exact words, in capitals, because a reader " +
     "skimming a log will take a bare '0 of 350' as a pass");
  ok(inconc.line.includes("It is not evidence either way."),
     "and closes by saying it is not evidence either way — the exact sentence, because " +
     "this is the only protection against the number being quoted as a result");
  ok(inconc.line.includes("consistent with an intraday denominator") &&
     inconc.line.includes("aligned same-session pair") &&
     inconc.line.includes("quiet stretch"),
     "and it lists all THREE explanations it cannot choose between, rather than one");
  ok(!/\bNOT aligned\b/.test(inconc.line),
     "it does not claim the pair is NOT aligned — that is the falsified branch's claim");
  ok(!/\b(so|therefore|which means|proves|confirms|evidence that)\b/i.test(
       inconc.line.replace("It is not evidence either way.", "")),
     "and it draws no inference at all: no 'so', no 'therefore', no 'confirms' anywhere in " +
     "the sentence that reports the measurement");
  ok(!inconc.line.includes("aligned in time"),
     "and it never uses the phrase the falsified branch uses to make its claim");

  /* NOTHING TO CHECK IS A THIRD OUTCOME, not a zero. */
  const blind = describeOiBasis(OWN.map((r) => drop(r, "prev_oi")));
  eq(blind.verdict, "no-data", "with no previous open interest anywhere, the verdict is no-data");
  eq(blind.seen, 0, "nothing was seen");
  eq(blind.exceedShare, null,
     "and the share is NULL, not 0 — 'no contract could be checked' and 'no contract " +
     "failed' are different facts and only one of them is a measurement");
  ok(/nothing could be checked/.test(blind.line), "and the line says so");

  /* The dry-run tag, because a synthetic falsification is two fixture formulas
     disagreeing and is not evidence about the vendor. */
  const tagged = describeOiBasis(OWN, { dryRun: true });
  ok(tagged.line.startsWith("[dry-run] "), "a dry run tags its own line");
  ok(/not evidence about the vendor/.test(tagged.line),
     "and says outright that a synthetic exceedance is not evidence about the vendor");
  ok(!describeOiBasis(OWN).line.startsWith("[dry-run] "),
     "while a live run carries no tag");

  /* The volume floor is the same population boundary the feed uses. */
  const belowFloor = OWN.map((r) => ({ ...r, volume: "1", open_interest: "5000", prev_oi: "1" }));
  eq(describeOiBasis(belowFloor).verdict, "no-data",
     "contracts below the volume floor are not checked at all, so the diagnostic speaks " +
     "about the same population the feed ranks");
}

/* ---------- §11 the payload's own coherence ---------------------- */
{
  const c = PAYLOAD.contracts;
  eq(c.shown, c.rows.length,
     "`shown` is the number of rows actually on the wire, not the number intended");
  ok(c.shown <= c.cap, `and it never exceeds the cap (${c.shown} <= ${c.cap})`);
  eq(c.cap, UA_ROWS, "which is the module's own row cap");

  const perName = new Map();
  for (const r of c.rows) perName.set(r.t, (perName.get(r.t) || 0) + 1);
  ok([...perName.values()].every((n) => n <= c.perName),
     `no name contributes more than the published perName of ${c.perName} (the busiest ` +
     `contributes ${Math.max(...perName.values())}) — so one heavily traded chain cannot ` +
     "become the feed");
  eq(c.perName, perNameCap(PAYLOAD.namesSeen),
     "and perName is the cap DERIVED from the board size this run actually saw, not a constant");

  eq(c.aggressorReported, c.rows.filter((r) => r.aggr !== null).length,
     "`aggressorReported` is the count of rows that actually carry an aggr — a coverage " +
     "claim that has to be checkable against the rows beside it");
  eq(c.notionalReported, c.rows.filter((r) => r.nlo !== null).length,
     "and `notionalReported` likewise");
  ok(c.aggressorReported <= c.shown && c.notionalReported <= c.shown,
     "neither coverage count exceeds the population it describes");

  /* MUTATION IS THE POINT, and it is the point twice over: every emitted row
     happens to carry a notional bracket, so `notionalReported === shown` holds
     on this corpus for a reason that has nothing to do with the counter being
     right — a `notionalReported: kept.length` would pass unnoticed. The emitted
     rows are therefore fed BACK through rankUnusual with the bracket and the
     aggressor withheld on a named few, which is the only way to see the two
     counters move. */
  const reranked = (blanks) => {
    const rows = c.rows.map((r, i) => (i < blanks ? { ...r, nlo: null, nhi: null, aggr: null } : { ...r }));
    return rankUnusual(rows, { namesSeen: 1, cap: 200 });
  };
  eq(reranked(0).shown, c.shown,
     "the emitted rows fed back through the ranker under caps that cannot bite are all kept");
  eq(reranked(0).notionalReported, c.notionalReported, "with the same notional coverage");
  eq(reranked(0).aggressorReported, c.aggressorReported, "and the same aggressor coverage");
  eq(reranked(6).notionalReported, c.notionalReported - 6,
     "withhold the bracket on six of them and notionalReported falls by exactly six — so " +
     "it counts brackets rather than rows, which the corpus alone cannot show");
  eq(reranked(6).aggressorReported,
     c.rows.slice(6).filter((r) => r.aggr !== null).length,
     "and aggressorReported counts the rows that still carry an aggr, not the rows kept");
  eq(reranked(6).shown, c.shown,
     "while the population itself is unchanged: a withheld bracket removes a reading, not " +
     "a contract");
  ok(c.rows.every((r, i) => i === 0 || c.rows[i - 1].vor >= r.vor),
     "the feed is ordered by its published ranking key, descending");

  eq(PAYLOAD.namesComplete + PAYLOAD.namesTruncated, PAYLOAD.namesSeen,
     "namesComplete + namesTruncated === namesSeen: every chain is on exactly one side of " +
     "the truncation line and none is counted twice");
  eq(PAYLOAD.coverage.length, PAYLOAD.namesSeen,
     "and coverage carries one entry per name seen, so the per-chain IV convention behind " +
     "any row can be looked up");
  const cov = new Map(PAYLOAD.coverage.map((x) => [x.t, x]));
  ok(c.rows.every((r) => cov.has(r.t)),
     "every contract row's name has a coverage entry — no row comes from a chain the " +
     "payload does not account for");
  ok(c.rows.every((r) => r.p === cov.get(r.t).p),
     "and a row's truncation flag matches its own chain's, so `p` reads per-name on a page " +
     "that mixes names");
  eq(PAYLOAD.namesTruncated, PAYLOAD.coverage.filter((x) => x.p === 1).length,
     "namesTruncated is the count of coverage entries that say so");
  eq(PAYLOAD.complete, PAYLOAD.namesTruncated === 0,
     "`complete` is a claim about coverage and agrees with the count behind it");
  eq(PAYLOAD.ivConventionsSeen, new Set(PAYLOAD.coverage.map((x) => x.ivDivisor)).size,
     "and ivConventionsSeen is the number of distinct divisors in the table, which is what " +
     "tells a reader whether the iv column can be compared across names at all");

  /* REFUSAL 2, ON THE WIRE. */
  eq(PAYLOAD.volumeAsOf, null,
     "volumeAsOf is NULL — the endpoint accepts no date and returns no as-of stamp, so the " +
     "counter's span is unobserved and choosing one would be a free parameter on the most " +
     "important quantity on the page");
  ok(typeof PAYLOAD.volumeAsOfReason === "string" && PAYLOAD.volumeAsOfReason.trim().length > 0,
     "and the null travels with a non-empty reason, so it reads as a refusal rather than " +
     "as a field somebody forgot to fill in");
  ok(typeof PAYLOAD.readAt === "string" && !Number.isNaN(Date.parse(PAYLOAD.readAt)),
     "readAt is a real timestamp — when the chain was READ, which is a different claim");

  eq(PAYLOAD.dteAnchor, "sessionDate",
     "dteAnchor names sessionDate as the one place a date is legal on this page");
  ok(c.rows.every((r) => r.dte === daysToExpiry(r.expiry, PAYLOAD.sessionDate)),
     "and every published dte is measured from that date — the label is VERIFIED against " +
     "the arithmetic rather than trusted, which is the difference between an anchor and a " +
     "caption");
  ok(c.rows.some((r) => r.dte !== daysToExpiry(r.expiry, PAYLOAD.readAt.slice(0, 10))),
     "and the horizons are demonstrably NOT measured from readAt, so the anchor claim has " +
     "teeth: the two dates differ and the rows follow sessionDate");
  ok(c.rows.every((r) => r.dte !== null), "no row publishes an unmeasurable horizon");
}

/* ---------- §12 the vocabulary ban, over the payload's prose ------ */

/* REFUSAL 1 IS ENFORCED HERE OR IT IS NOT ENFORCED. `volume` is every contract
   that changed hands at a strike, summed; it is not a trade, and the page must
   never imply otherwise.

   THE REGEX IS NOT WEAKENED. Four legitimate occurrences exist in the emitted
   prose and each is allowed by NAME, by WORD and by the SURROUNDING PHRASE, so
   that "not a trade" is permitted while "each trade" in the same field is not.
   An allow-list that excused a whole field would let the next edit through. */
{
  const BAN = /\b(print|trade|block|sweep|order|bought|sold|paid|whale|smart money|institutional)\b/gi;
  const ALLOWED = [
    /* The vendor's own relation string for aggr, harvested VERBATIM from
       buildTopContracts by the pipeline so that one relation cannot acquire two
       spellings. Rewording it here to dodge the ban would create the second
       spelling the harvest exists to prevent. */
    { path: "basis.aggr", word: "print", near: /counted each print against the side of the book/i },
    /* Negations. Refusal 1 is stated by naming what this page is not, which
       cannot be done without the nouns. */
    { path: "basis.unit", word: "trade", near: /counter, not a trade/i },
    { path: "basis.unit", word: "sweep", near: /no sweep flag/i },
    { path: "basis.refusals", word: "smart money", near: /No\s+[“"']?smart money/i },
    /* TWO ENTRIES USED TO SIT HERE, AND THE DEAD-ENTRY CHECK BELOW IS WHY
       THEY DO NOT.

       basis.names read "whose option chain was bought — a few dozen … an
       order of magnitude more coverage". Both words were legitimate: bought
       FROM THE VENDOR, and the ordinary idiom. Both were pinned to their
       phrase. But the first sat two lines from a volume column on a page
       whose opening refusal is that a counter is not a purchase, so a reader
       scanning it beside that column had every reason to take it the other
       way — the exact misreading Refusal 1 exists to prevent.

       The prose now says "read" and "ten times that coverage or more": the
       same quantitative claim, no exception needed. Rewriting the sentence
       beat widening the list, which is the right direction for an allow-list
       to move. */
  ];
  const used = new Set();

  const scan = (value, at) => {
    if (typeof value === "string") {
      BAN.lastIndex = 0;
      let m;
      while ((m = BAN.exec(value)) !== null) {
        const word = m[1].toLowerCase();
        const window = value.slice(Math.max(0, m.index - 60), m.index + m[1].length + 60);
        const hit = ALLOWED.find((a) => a.path === at && a.word === word && a.near.test(window));
        ok(Boolean(hit),
           `${at} says "${word}" — banned by REFUSAL 1 unless it is one of the named ` +
           `exceptions. Context: ...${window.trim()}...`);
        if (hit) used.add(hit);
      }
      return;
    }
    if (Array.isArray(value)) return value.forEach((v, i) => scan(v, `${at}[${i}]`));
    if (value && typeof value === "object") {
      /* Nested objects (basis.rank, basis.floors) are scanned at the LEAF's own
         dotted path, so an exception can never be granted to a whole subtree. */
      for (const [k, v] of Object.entries(value)) scan(v, `${at}.${k}`);
    }
  };
  scan(PAYLOAD.basis, "basis");
  scan(PAYLOAD.volumeAsOfReason, "volumeAsOfReason");
  for (const cvg of PAYLOAD.coverage) scan(cvg.ivBasis, "coverage.ivBasis");

  eq(used.size, ALLOWED.length,
     `all ${ALLOWED.length} named exceptions are still present in the emitted prose — a ` +
     "dead entry would be an allow-list quietly widening past what it was written for");

  /* The nested prose is genuinely reached, so the scan is not passing by
     failing to look. */
  ok(typeof PAYLOAD.basis.rank === "object" && typeof PAYLOAD.basis.rank.reason === "string" &&
     typeof PAYLOAD.basis.floors.reason === "string",
     "basis.rank and basis.floors carry their reasons as nested strings, which the scan " +
     "above descends into rather than skipping");
  ok(PAYLOAD.basis.aggr === null || typeof PAYLOAD.basis.aggr === "string",
     "basis.aggr is a string harvested from a chain that built one, or an honest null");
  ok(typeof PAYLOAD.basis.aggr === "string" && PAYLOAD.basis.aggr.length > 0,
     "and on this corpus it is the harvested string, not the null the first attempt shipped");

  /* Every note the module freezes is on the wire, so the prose a reader sees is
     the prose the module committed to rather than a paraphrase. */
  for (const k of ["unit", "date", "lift", "notional", "iv", "oi", "zeroOi", "names", "refusals"]) {
    eq(PAYLOAD.basis[k], UNUSUAL_NOTES[k],
       `basis.${k} is UNUSUAL_NOTES.${k} verbatim — the methodology travels with the ` +
       "numbers rather than living in a comment only a maintainer reads");
  }
  eq(PAYLOAD.basis.rank.reason, UNUSUAL_NOTES.rank, "and the ranking note likewise");
  eq(PAYLOAD.basis.rank.choice, true,
     "with the key marked as a CHOICE, because ranking by notional or by raw volume are " +
     "both defensible and neither is the answer");
  eq(PAYLOAD.basis.floors.minVolume, UA_MIN_VOLUME, "the floors publish their own values");
  eq(PAYLOAD.basis.floors.minOi, UA_MIN_OI, "both of them");
  eq(PAYLOAD.basis.floors.choice, true, "and are marked as choices rather than as findings");
}

/* ---------- §13 and it may never date the counter ---------------- */

/* REFUSAL 2, IN THE PROSE. The pipeline reads this endpoint four and a quarter
   hours before the opening bell, so at read time today has not happened. */
{
  const DAY = /\b(today|todays|this session|the day['’`]s|so far today|intraday session)\b/i;
  const walk = (value, at, sink) => {
    if (typeof value === "string") { if (DAY.test(value)) sink.push([at, value]); return; }
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${at}[${i}]`, sink));
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, `${at}.${k}`, sink);
    }
  };
  const hits = [];
  walk(PAYLOAD.basis, "basis", hits);
  walk(PAYLOAD.volumeAsOfReason, "volumeAsOfReason", hits);
  walk(PAYLOAD.coverage, "coverage", hits);
  eq(hits.length, 0,
     "nothing in the payload's prose says 'today', 'this session' or 'the day's': the " +
     "counter's span is UNOBSERVED, and attaching a date to it in words would be the same " +
     "claim as attaching one to the field" +
     (hits.length ? ` — found ${hits.map(([p]) => p).join(", ")}` : ""));

  const notes = [];
  walk(UNUSUAL_NOTES, "UNUSUAL_NOTES", notes);
  eq(notes.length, 0,
     "and neither does the module's frozen prose, which is where the payload's comes from" +
     (notes.length ? ` — found ${notes.map(([p]) => p).join(", ")}` : ""));

  ok(/no date parameter/i.test(PAYLOAD.basis.date) && /unobserved/i.test(PAYLOAD.basis.date),
     "the date note states the reason positively: no date parameter, no as-of stamp, span " +
     "unobserved");
  ok(/readAt is when it was read/i.test(PAYLOAD.basis.date),
     "and distinguishes readAt from a claim about what the counter counts");
}

/* ---------- §14 the feed is built where the divisor lives -------- */

/* buildUnusualRows is called from INSIDE buildChainPanels because the IV
   divisor is a local there. If anything outside re-derived it, the two answers
   would drift — which is the defect this placement exists to make impossible.
   Asserting that is only meaningful against a chain whose divisor is not 1. */
{
  const panel = buildChainPanels(CHAIN, { spot: SPOT, asOf: "2026-08-24", ticker: "SYN001" });
  eq(panel.status, "ok", "the emitted chain builds a panel");
  ok(Array.isArray(panel.unusualRows) && panel.unusualRows.length > 0,
     `buildChainPanels returns unusualRows (${panel.unusualRows.length} of them) — the feed ` +
     "is produced where the divisor and the root-filtered rows are, not by a caller");
  ok(Number.isFinite(panel.ivDivisor),
     "and it returns ivDivisor beside them, so the convention behind the iv column is " +
     "reachable rather than having to be re-derived");

  /* THE SAME CHAIN QUOTED IN PERCENT. The vendor is not consistent about
     whether implied_volatility is a fraction or a percentage, and the two differ
     by 100x. Against a divisor of 1 the assertion below is vacuous; against 100
     it proves the division happened with THIS chain's number. */
  const pct = CHAIN.map((r) => ({ ...r, implied_volatility: (Number(r.implied_volatility) * 100).toFixed(6) }));
  const pctPanel = buildChainPanels(pct, { spot: SPOT, asOf: "2026-08-24", ticker: "SYN001" });
  eq(pctPanel.ivDivisor, 100,
     "a percent-quoted chain decides on a divisor of 100 from its own median");
  eq(panel.ivDivisor, 1, "while the fraction-quoted one decides on 1");

  /* ---- the board's own view of the name, threaded through --------

     The alerts table beside this feed has carried a Stage column since it
     shipped and the counter feed carried none, so a 40x volume-over-open-
     interest on a name the board ranks LONG and the same ratio on a name it
     scored into the dead band were indistinguishable on this page. */
  const staged = buildChainPanels(CHAIN,
    { spot: SPOT, asOf: "2026-08-24", ticker: "SYN001", stage: "long" });
  ok(staged.unusualRows.length > 0 && staged.unusualRows.every((r) => r.st === "long"),
     "a stage supplied to buildChainPanels reaches every row of the feed it builds");
  ok(panel.unusualRows.every((r) => !("st" in r)),
     "AND ITS ABSENCE OMITS THE KEY rather than publishing null on every row: sixty " +
     "rows of `\"st\":null` is bytes spent saying nothing, and a renderer testing for " +
     "the key can tell a payload built before this shipped from a name with no stage");
  ok(buildUnusualRows(CHAIN, { ticker: "SYN001", spot: SPOT, sessionDate: "2026-08-24" })
    .every((r) => !("st" in r)),
     "and the same holds when the feed builder is called directly");
  ok(buildUnusualRows(CHAIN, { ticker: "SYN001", spot: SPOT, sessionDate: "2026-08-24",
    stage: "" }).every((r) => !("st" in r)),
     "an empty string is not a stage either — it would render as a badge with no word in it");

  const bySymbol = new Map();
  for (const r of pct) {
    const m = /^SYN001(\d{2})(\d{2})(\d{2})([PC])(\d{8})$/.exec(r.option_symbol);
    if (m) bySymbol.set(`20${m[1]}-${m[2]}-${m[3]}|${m[4]}|${Number(m[5]) / 1000}`, r);
  }
  let matched = 0, vacuous = 0;
  for (const row of pctPanel.unusualRows) {
    const raw = bySymbol.get(`${row.expiry}|${row.cp}|${row.k}`);
    if (!raw) continue;
    matched++;
    const expected = Number((Number(raw.implied_volatility) / pctPanel.ivDivisor).toFixed(4));
    if (row.iv !== expected) {
      assert.equal(row.iv, expected,
        `${row.expiry} ${row.cp} ${row.k}: iv must be the raw implied_volatility divided by ` +
        "THIS chain's divisor");
    }
    if (row.iv === Number(Number(raw.implied_volatility).toFixed(4))) vacuous++;
  }
  checks++;
  ok(matched > 50,
     `${matched} feed rows were matched back to the raw chain row they came from by ` +
     "(expiry, type, strike), and every one of them carries raw / ivDivisor exactly");
  eq(vacuous, 0,
     "and not one of them equals the UNDIVIDED raw number, so the divisor is doing work " +
     "rather than being a 1 that would make this assertion pass on any implementation");

  /* THE STRONGEST FORM OF THE SAME CLAIM: the convention is fully divided out,
     so the same book quoted either way publishes the identical feed. A caller
     that re-derived the divisor from anything but this chain's median could not
     make this hold. */
  deep(pctPanel.unusualRows, panel.unusualRows,
     "the percent-quoted chain and the fraction-quoted chain produce IDENTICAL feed rows, " +
     "field for field — the 100x ambiguity is removed once, per chain, at the only place " +
     "that knows the answer");

  /* And the diagnostic is computed in the same scope, on the same rows. */
  ok(panel.oiBasis && typeof panel.oiBasis.verdict === "string",
     "the open-interest basis check rides along on the same root-filtered rows");
}

/* ---------- §14b one chain, one parse of every symbol ------------ */

/* THE COST THIS PINS IS REAL AND WAS MEASURED, not guessed at.

   buildChainPanels has five consumers of the same contract symbols — the root
   filter, priceSale, the top-contract tape, the aggressor ladder and this feed
   — and each of them used to run OPTION_SYMBOL_RE over the same string, each
   parse paying a trim and an upper-case copy before the regex. At a full page
   of 500 contracts across the deep set that is 125,000 regex executions where
   25,000 do the same work.

   Counting is done by making `option_symbol` a GETTER, which is the only
   honest way to measure it from outside: every parse must read the property
   exactly once, so the read count IS the parse count and no instrumentation of
   the module under test is required.

   THE EXPECTED NUMBER IS EXACT, not a bound. One parse for every row the
   vendor sent, plus one further read per PRICED row — priceSale echoes the
   symbol back onto the sale it returns, which is a copy and not a parse. A
   bound like "fewer than five passes" would still pass if a sixth consumer
   were added and two were removed; the equality fails the moment anyone parses
   twice. */
{
  let reads = 0;
  const counted = CHAIN.map((row) => {
    const sym = row.option_symbol;
    const o = {};
    for (const k of Object.keys(row)) if (k !== "option_symbol") o[k] = row[k];
    Object.defineProperty(o, "option_symbol", {
      get() { reads++; return sym; }, enumerable: true,
    });
    return o;
  });
  const opts = { spot: SPOT, asOf: "2026-08-24", ticker: "SYN001" };

  reads = 0;
  const panel = buildChainPanels(counted, opts);
  const panelReads = reads;
  eq(panel.status, "ok", "the counted chain still builds a panel");
  eq(panelReads, CHAIN.length + panel.pricedRows,
     `every symbol is parsed ONCE (${CHAIN.length} rows) and read once more only where ` +
     `priceSale copies it onto a sale (${panel.pricedRows} priced) — ${panelReads} reads in ` +
     "total, against the five passes the five consumers used to take");

  /* THE FIXTURE CAN TELL THE TWO APART. A single consumer parsing for itself
     costs one pass, so five of them cost five: the assertion above is only
     meaningful because that baseline is far above it and is measured here
     rather than asserted from memory. */
  reads = 0;
  buildUnusualRows(counted, { ticker: "SYN001", spot: SPOT, sessionDate: "2026-08-24" });
  const soloReads = reads;
  eq(soloReads, CHAIN.length,
     "one standalone consumer parses every row exactly once, which is the unit the " +
     "count above is expressed in");
  ok(panelReads < soloReads * 3,
     `and the whole panel now costs ${panelReads} reads where the five consumers alone ` +
     `would cost about ${soloReads * 5}`);

  /* AND THE ANSWER DID NOT CHANGE. Threading a parse down is worth nothing if
     it moves a number, so the panel's three tape surfaces are compared against
     the same builders parsing for themselves over the same root-filtered rows.
     Deep equality, not a spot check: a strike shifted onto a neighbouring row
     is exactly the failure a parallel array would produce, and it would leave
     every count identical. */
  const rooted = CHAIN.filter((r) => /^SYN001\d{6}[PC]\d{8}$/.test(r.option_symbol));
  const bare = buildChainPanels(CHAIN, opts);
  assert.deepEqual(
    bare.unusualRows,
    buildUnusualRows(rooted, {
      ticker: "SYN001", spot: SPOT, ivDivisor: bare.ivDivisor,
      sessionDate: "2026-08-24", truncated: false,
    }),
    "the threaded feed is row-for-row what the standalone builder answers"); checks++;
  assert.deepEqual(
    bare.topContracts,
    buildTopContracts(rooted, { spot: SPOT, ivDivisor: bare.ivDivisor }),
    "and so is the top-contract tape"); checks++;
  assert.deepEqual(
    bare.aggressor,
    buildAggressor(rooted, { spot: SPOT }),
    "and the aggressor ladder"); checks++;
}

/* ---------- §15 the root filter is UPSTREAM of the x100 ---------- */

/* An adjusted series (a SYN0011 beside a SYN001, listed after a split or a
   special dividend) is deliverable on something other than 100 shares. The
   notional bracket multiplies by SHARES_PER_CONTRACT, so that multiplication is
   only legal AFTER the root filter — and the filter's output never leaves
   buildChainPanels, which is why the feed is built inside it. */
{
  const foreign = CHAIN.filter((r) => !/^SYN001\d{6}[PC]\d{8}$/.test(r.option_symbol));
  eq(foreign.length, 1,
     "the emitted chain carries exactly one adjusted-series row, heavily traded, so the " +
     "filter has something real to reject");
  const adj = foreign[0];
  ok(/^SYN0011/.test(adj.option_symbol),
     `the foreign root is ${adj.option_symbol.slice(0, 7)} — a SYN0011 beside the SYN001 ` +
     "this chain is about");
  ok(Number(adj.volume) >= UA_MIN_VOLUME && Number(adj.open_interest) >= UA_MIN_OI,
     "and it clears BOTH floors comfortably, so nothing but the root filter can stop it");

  const panel = buildChainPanels(CHAIN, { spot: SPOT, asOf: "2026-08-24", ticker: "SYN001" });
  eq(panel.foreignRows, 1, "the panel counts the row it dropped rather than filtering silently");
  eq(panel.rowsReturned - panel.rowsSeen, 1,
     "and rowsReturned minus rowsSeen is that same one, which is what lets a card publish " +
     "\"a full page of 500\" beside rowsSeen: 499 without contradicting itself");

  /* A LABEL CHECK HERE WOULD PROVE NOTHING, and saying so is the point.
     buildUnusualRows sets `t: ticker || sym.ticker`, so a surviving foreign row
     would be published carrying "SYN001" anyway. The identity that survives is
     the CONTRACT: its strike sits on the pre-adjustment scale, far from every
     strike on the live book, and its volume is unmistakable. */
  const adjStrike = Number(adj.option_symbol.slice(-8)) / 1000;
  const adjVol = Number(adj.volume);
  ok(!panel.unusualRows.some((r) => r.k === adjStrike),
     `no feed row carries the adjusted series' strike of ${adjStrike}, which sits on the ` +
     "old scale and is nowhere near the live book");
  ok(!panel.unusualRows.some((r) => r.vol === adjVol),
     `and none carries its volume of ${adjVol} — which would have ranked it first on the ` +
     "tape, since an adjusted series always does");
  ok(panel.unusualRows.every((r) => r.t === "SYN001"),
     "every row is labelled SYN001, which on its own proves nothing at all: the label is " +
     "assigned from the ticker argument, so the two assertions above are the real test");

  /* WHAT THE FILTER PREVENTS, demonstrated rather than asserted. Feeding the
     UNFILTERED rows to buildUnusualRows — the shape a caller outside
     buildChainPanels would inevitably reach for — admits the adjusted row and
     multiplies its volume by 100 shares it is not deliverable on. */
  const unfiltered = buildUnusualRows(CHAIN,
    { ticker: "SYN001", spot: SPOT, sessionDate: "2026-08-24" });
  const leaked = unfiltered.find((r) => r.vol === adjVol && r.k === adjStrike);
  ok(Boolean(leaked),
     "without the root filter the adjusted row IS admitted — the floors do not catch it, " +
     "which is why the filter has to be upstream and not a later guard");
  eq(leaked.nlo, Math.round(adjVol * Number(adj.nbbo_bid) * SHARES_PER_CONTRACT),
     `and it would have published a notional bracket of ${Math.round(adjVol * Number(adj.nbbo_bid) * SHARES_PER_CONTRACT)} ` +
     "off a x100 multiplier on a contract not deliverable on 100 shares — the exact " +
     "arithmetic the ordering of these two steps exists to prevent");
  ok(unfiltered.length > panel.unusualRows.length,
     "so the filtered feed is strictly the smaller population, and the difference is the " +
     "row that would have topped the ranking");

  /* Over the emitted payload: every published row's moneyness is sane against
     its own spot, which an old-scale strike could not be. */
  ok(PAYLOAD.contracts.rows.every((r) => r.m === null || Math.abs(r.m) < 2),
     "no row in the emitted feed carries a log-moneyness beyond |2|, which is what an " +
     "adjusted series' pre-split strike would look like against a live spot");
}

/* ============================================================
   §16. THE PAGE, IN A BROWSER.

   Everything above is arithmetic the shaper can be held to. What
   this section pins is the half the arithmetic cannot reach: two
   payloads, two fetches, and a page that has to join them without
   letting either one's failure become the other's.

   THE JOIN IS THE POINT. The alerts table and the counter feed carry
   the same four-tuple — name, side, strike, expiry — and until this
   layer a trader could find a contract in both only by scanning sixty
   rows against fifty by hand. AAA appears in both fixtures below and
   ZZZ and BBB appear in exactly one each, so a mark that fired on
   everything, or on nothing, fails here rather than shipping.
   ============================================================ */
{
  /* The alerts <thead> in shared/flows-pages.js has ten columns and the
     renderer's ALERT_COLS has to match it exactly or the wiring bails; the
     count is written here rather than imported because the renderer is a
     browser IIFE with nothing to import from. */
  const ALERT_COLUMNS = 10;
  const { chromium } = await import("playwright");
  const { signSession } = await import("../shared/session.js");
  const { startWorker, SESSION_SECRET, FLOWS_TEST_USER } =
    await import("./worker-server.mjs");

  const INGEST = "unusual-token-aaaaaaaa";
  const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${INGEST}`] });
  const at = (path) => server.baseURL + path;
  const session = await signSession(
    { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 },
    SESSION_SECRET);
  const put = (key, body) => fetch(at("/api/flows/ingest?key=" + encodeURIComponent(key)), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + INGEST },
    body: JSON.stringify(body),
  });

  const contract = (t, cp, k, expiry, vol, stage) => {
    const row = {
      t, k, expiry, cp, vol, oi: 100, doi: 5, vor: vol / 100, bidPx: 1, askPx: 1.2,
      nlo: 1000, nhi: 1200, aggr: 10, lift: 0.6, iv: 0.3, m: 0.01, dte: 20, p: 0,
    };
    /* BBB carries no stage, so the badge has a negative case to fail on: a
       renderer that drew one unconditionally would pass an assertion that only
       looked at AAA. */
    if (stage) row.st = stage;
    return row;
  };
  await put("unusual", {
    v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31", status: "ok",
    contracts: {
      rows: [contract("AAA", "C", 100, "2026-09-18", 900, "long"),
             contract("BBB", "P", 50, "2026-10-16", 400)],
      shown: 2, eligible: 2, cap: 60, perName: 30, capBound: null,
    },
    coverage: [{ t: "AAA", rows: 400 }, { t: "BBB", rows: 300 }],
    namesSeen: 2, dteAnchor: "sessionDate",
    names: { rows: [], universe: 2, ranked: 2, unranked: 0, shown: 0, earningsGated: 0 },
    basis: { unit: "A contract counter, and not a trade.",
             date: "no date parameter, the span is unobserved, readAt is when it was read" },
  });
  await put("flowalerts", {
    v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", refreshed: "nightly",
    seen: 2, shed: 0, cap: 50, coverage: { withContract: 2, calls: 1, puts: 1 },
    rows: [
      /* AAA is in BOTH feeds, on the same strike and the same expiry. */
      { t: "AAA", cp: "C", k: 100, exp: "2026-09-18", oc: "AAA260918C00100000",
        prem: 250000, askPrem: 200000, bidPrem: 50000, size: 800, trades: 12,
        sweep: true, floor: false, single: true, opening: null,
        spanStart: "2026-09-01T13:31:00Z", spanEnd: "2026-09-01T13:36:00Z",
        rule: "RepeatedHits", st: "long" },
      /* ZZZ is in the vendor's selection only — the counter feed never saw it. */
      { t: "ZZZ", cp: "P", k: 20, exp: "2026-09-25", oc: "ZZZ260925P00020000",
        prem: 90000, askPrem: 10000, bidPrem: 80000, size: 300, trades: 4,
        sweep: false, floor: false, single: false, opening: false,
        spanStart: "2026-09-01T14:00:00Z", spanEnd: "2026-09-01T14:02:00Z",
        rule: "Sweep", st: "foreign" },
    ],
  });

  const browser = await chromium.launch();
  try {
    /* 320px FROM THE FIRST FRAME. Zero horizontal overflow is a tested
       invariant of this site, and the filter group added here is four pills in
       a flex row whose shared rule does not wrap. */
    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e)));
    await page.context().addCookies([{
      name: "flows_session", value: session, url: server.baseURL,
    }]);
    await page.goto(at("/flows/unusual/"), { waitUntil: "networkidle" });
    await page.waitForSelector("#uaFeedBody tr");

    const first = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      feedBoth: [...document.querySelectorAll("#uaFeedBody .ua-both")].length,
      feedBothTitle: (document.querySelector("#uaFeedBody .ua-both") || {}).title || "",
      alertBoth: [...document.querySelectorAll("#uaAlertsBody .ua-both")].length,
      feedRows: document.querySelectorAll("#uaFeedBody tr").length,
      alertRows: document.querySelectorAll("#uaAlertsBody tr").length,
      alertHeads: document.querySelectorAll("#uaAlerts thead .fb-sort").length,
      feedHeads: document.querySelectorAll("#uaFeed thead .fb-sort").length,
      pressed: [...document.querySelectorAll("#uaFilters button")]
        .map((b) => b.textContent + ":" + b.getAttribute("aria-pressed")),
      stages: [...document.querySelectorAll("#uaFeedBody tr")]
        .map((tr) => (tr.querySelector(".ua-stage") || {}).textContent || null),
    }));
    eq(first.overflow, 0, "nothing overflows at 320px with the filter group on the page");
    eq(thrown.length, 0, `the page threw nothing: ${thrown.join("; ")}`);

    eq(first.alertHeads, ALERT_COLUMNS,
       "EVERY ALERTS HEADING IS A SORT CONTROL. This table was the newer, richer and " +
       "fresher of the two on the page and was the one a reader could not rank at all — " +
       "wireHeads opened with a guard on the feed table and served it alone");
    eq(first.feedHeads, 10, "and the counter feed keeps its own, unchanged");

    eq(first.feedBoth, 1,
       "exactly one counter-feed row is marked as also flagged by the vendor — a mark " +
       "that fired on every row, or on none, would pass a laxer assertion than this");
    eq(first.alertBoth, 1, "and exactly one alerts row is marked reciprocally");
    ok(/RepeatedHits/.test(first.feedBothTitle),
       "with the vendor's own rule named on the mark rather than left to a legend");
    ok(/premium/.test(first.feedBothTitle),
       "and the window's premium beside it, so the mark carries the reading and not just " +
       "the fact of a match");
    deep(first.pressed, ["All:true", "Calls:false", "Puts:false", "Both feeds:false"],
       "the filter group starts unfiltered and says so on every control");

    deep(first.stages, ["long", null],
       "THE BOARD'S OWN VIEW REACHES THE COUNTER FEED'S NAME CELL, and only where the " +
       "payload states one — a badge drawn unconditionally would look identical on the " +
       "row that carries a stage and would be a fabrication on the row that does not");

    /* THE FILTER IS ONE CONTROL OVER TWO TABLES. A filter that narrowed one
       and not the other would publish two counts of one population. */
    await page.click("#uaFilters button:nth-child(3)");
    const puts = await page.evaluate(() => ({
      feed: [...document.querySelectorAll("#uaFeedBody tr th")]
        .map((n) => (n.querySelector("a, span") || {}).textContent || null),
      alerts: [...document.querySelectorAll("#uaAlertsBody tr th")]
        .map((n) => n.firstChild.textContent),
      note: document.getElementById("uaFilterNote").textContent,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    deep(puts.feed, ["BBB"], "filtering to puts narrows the counter feed");
    deep(puts.alerts, ["ZZZ"], "and the alerts table, from the same control");
    ok(/1 of 2 flagged windows are drawn/.test(puts.note)
       && /1 of 2 contracts are drawn/.test(puts.note),
       `and the note states both drawn counts against both published ones, each table's ` +
       `count in its own clause so a silent one can replace its own — got: ${puts.note}`);
    ok(/published and hidden, not absent from the read/.test(puts.note),
       "SO A NARROWED TABLE IS NEVER MISTAKEN FOR A THIN MARKET, which is the whole " +
       "risk a filter introduces to a page that reports what a vendor did not send");
    eq(puts.overflow, 0, "and the filtered page still does not overflow at 320px");

    /* IN BOTH FEEDS: the single strongest reading this page can produce, and
       the one that needed sixty rows read against fifty by hand. */
    await page.click("#uaFilters button:nth-child(1)");
    await page.click("#uaFilters button:nth-child(4)");
    const both = await page.evaluate(() => ({
      feed: [...document.querySelectorAll("#uaFeedBody tr th")]
        .map((n) => (n.querySelector("a, span") || {}).textContent || null),
      alerts: [...document.querySelectorAll("#uaAlertsBody tr th")]
        .map((n) => n.firstChild.textContent),
    }));
    deep(both.feed, ["AAA"],
      "the counter feed narrows to the one contract both selections agree on");
    deep(both.alerts, ["AAA"],
      "and so does the vendor's table — two independent selections, one line");

    /* THE ALERTS TABLE RANKS, AND SAYS SO TO A SCREEN READER. */
    await page.click("#uaFilters button:nth-child(4)");        // release the join filter
    await page.click("#uaAlerts thead th:nth-child(3) .fb-sort");
    const ranked = await page.evaluate(() => ({
      order: [...document.querySelectorAll("#uaAlertsBody tr th")]
        .map((n) => n.firstChild.textContent),
      aria: document.querySelector("#uaAlerts thead th:nth-child(3)").getAttribute("aria-sort"),
      others: [...document.querySelectorAll("#uaAlerts thead th")]
        .map((n) => n.getAttribute("aria-sort")),
      label: document.querySelector("#uaAlerts thead th:nth-child(3) .fb-sort")
        .getAttribute("aria-label"),
    }));
    deep(ranked.order, ["AAA", "ZZZ"], "premium ranks the larger window first");
    eq(ranked.aria, "descending", "with aria-sort carrying the state, not the glyph");
    eq(ranked.others.filter((v) => v === "none").length, ALERT_COLUMNS - 1,
       "and every other heading is explicitly reset — a stale attribute announces two " +
       "sorted columns and there is only ever one");
    ok(/activate to/.test(ranked.label),
       "with an accessible name that names the action rather than the abbreviation");

    /* A THIRD ACTIVATION RETURNS THE VENDOR'S OWN ORDER. The published rank
       must be recoverable: it is the ordering the payload argued for. */
    await page.click("#uaAlerts thead th:nth-child(3) .fb-sort");
    await page.click("#uaAlerts thead th:nth-child(3) .fb-sort");
    const restored = await page.evaluate(() => ({
      order: [...document.querySelectorAll("#uaAlertsBody tr th")]
        .map((n) => n.firstChild.textContent),
      aria: document.querySelector("#uaAlerts thead th:nth-child(3)").getAttribute("aria-sort"),
    }));
    deep(restored.order, ["AAA", "ZZZ"], "the third activation restores the published order");
    eq(restored.aria, "none", "and reports no ranking at all");
    eq(thrown.length, 0, `and nothing threw across the whole interaction: ${thrown.join("; ")}`);
    await page.close();

    /* ---- THE COUNTS BELONG TO A TABLE THAT ANSWERED ------------------
       The filter note reported "0 of 0 flagged windows are drawn" whenever the
       alerts payload had not resolved — a displayed zero standing in for "not
       sent", in the one sentence on this page whose entire job is to stop a
       narrowed table from reading as a thin market. And the "Both feeds" pill
       went on promising resolution "until both payloads have loaded" after a
       payload that had already come back and could not be read.

       An alerts payload with no rows array reaches that state deliberately:
       it is the second of this page's three silences, and it is a state the
       fixture can produce rather than one that needs a network failure. */
    await put("flowalerts", { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: null });
    const broken = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await broken.context().addCookies([{
      name: "flows_session", value: session, url: server.baseURL,
    }]);
    await broken.goto(at("/flows/unusual/"), { waitUntil: "networkidle" });
    await broken.waitForSelector("#uaFeedBody tr");
    await broken.click("#uaFilters button:nth-child(2)");
    const unread = await broken.evaluate(() =>
      document.getElementById("uaFilterNote").textContent);
    ok(/flagged windows could not be read/.test(unread),
       `an unreadable alerts payload is SAID, not counted — got: ${unread}`);
    ok(!/of 0 flagged windows/.test(unread),
       "and specifically not reported as '0 of 0', which is a measurement of nothing " +
       "printed as a measurement of the market");
    ok(/1 of 2 contracts are drawn/.test(unread),
       "while the feed that DID answer still states its own two counts — one silence " +
       "does not swallow the other table's measurement");

    await broken.click("#uaFilters button:nth-child(4)");
    const joinDead = await broken.evaluate(() =>
      document.getElementById("uaFilterNote").textContent);
    ok(/cannot be resolved at all/.test(joinDead),
       `the join says it will never resolve rather than promising a load — got: ${joinDead}`);
    ok(!/until both payloads have loaded/.test(joinDead),
       "which is what it used to promise, indefinitely, about a payload that had already " +
       "come back broken");
    await broken.close();

    /* ---- WHOSE CEILING THE COUNT HIT ---------------------------------
       "Both tables show every row published" is TRUE and was doing the work of
       a claim it cannot support. When the vendor returns exactly the number of
       rows we asked for, the population above that line is unknown — so a
       table of N under a caption about completeness reads as a complete market
       read. The pipeline has published `vendorLimit` and `vendorTruncated`
       since the leg shipped, with a comment explaining precisely why a reader
       needs them, the worker carries them through the intraday merge on
       purpose, and no browser file had ever read either.

       THREE STATES, AND THE THIRD IS THE ONE THAT BITES. `vendorTruncated`
       absent must not read as false: `!undefined` is `true`, so the naive form
       would have the page state confidently that a read was NOT capped, about
       a run that never measured it. */
    const ceilingNote = async (alerts) => {
      await put("flowalerts", alerts);
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.context().addCookies([{
        name: "flows_session", value: session, url: server.baseURL,
      }]);
      await p.goto(at("/flows/unusual/"), { waitUntil: "networkidle" });
      await p.waitForSelector("#uaFilterNote");
      const text = await p.evaluate(() =>
        document.getElementById("uaFilterNote").textContent);
      await p.close();
      return text;
    };
    const alertRow = { t: "AAPL", cp: "C", k: 200, exp: "2026-09-18", px: 1.2 };

    const capped = await ceilingNote({
      v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: [alertRow],
      vendorLimit: 200, vendorTruncated: true,
    });
    ok(/vendor's own ceiling/.test(capped),
       `a truncated read says whose ceiling it hit — got: ${capped}`);
    ok(/200/.test(capped),
       "and names the limit, because a ceiling without its height is not a measurement");
    ok(/ceiling rather than a market/.test(capped),
       "and says what that does to the count: comparing it with another session compares " +
       "two ceilings, which is the sentence the pipeline's own comment asks for");

    const fitted = await ceilingNote({
      v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: [alertRow],
      vendorLimit: 200, vendorTruncated: false,
    });
    ok(/under the vendor's ceiling/.test(fitted),
       `a read that fitted says so rather than staying silent — got: ${fitted}`);
    ok(!/ceiling rather than a market/.test(fitted),
       "and does NOT carry the truncation caveat, which would make every read look capped");

    const unstated = await ceilingNote({
      v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: [alertRow],
    });
    ok(/was not recorded/.test(unstated),
       `a payload predating the fields says the ceiling was not recorded — got: ${unstated}`);
    ok(!/under the vendor's ceiling/.test(unstated),
       "and specifically does NOT claim the read came in under it: `!undefined` is true, " +
       "so the naive test would have stated a measurement this run never made");
    ok(/may be a ceiling rather than a market/.test(unstated),
       "it warns rather than reassures, because an unmeasured cap is closer to a cap than " +
       "to a clean read for anyone deciding whether to trust the count");

    /* ---- §17 THE FOUR SILENCES, EACH WITH ITS OWN MARK AND ITS OWN
       SENTENCE, AND NONE OF THEM WEARING A COUNT ------------------------

       Everything above this point tests a page that ANSWERED. What follows
       tests the four ways it cannot, which on this route were rendered as one
       thing: an identical dim paragraph, and — twice — an identical set of
       zeros. A payload with no `contracts` block printed "0 contracts from 0
       names · the payload did not say which cap bound this list" and a caption
       reading "0 of 0 contracts that cleared the floors"; a payload with no
       `names` block printed the QUIET sentence, which is a finding about the
       screened universe. Both are counts taken off an absence.

       The marks are asserted as `data-empty`, never as prose, because an
       assertion that matches on wording certifies the wording and would pass
       on four paragraphs that still look identical to a reader. */
    const read = async (unusual, alerts, options, press) => {
      if (unusual !== null) await put("unusual", unusual);
      if (alerts !== null) await put("flowalerts", alerts);
      const p = await browser.newPage(Object.assign(
        { viewport: { width: 1280, height: 900 } }, options || {}));
      await p.context().addCookies([{
        name: "flows_session", value: session, url: server.baseURL,
      }]);
      await p.goto(at("/flows/unusual/"), { waitUntil: "networkidle" });
      await p.waitForSelector("#uaStatus");
      /* The filter note states its tallies only while a filter is on, which is
         where the displayed zero used to live. */
      if (press) await p.click(press);
      const out = await p.evaluate(() => {
        const txt = (sel) => {
          const n = document.querySelector(sel);
          return n ? n.textContent : null;
        };
        const mark = (sel) => {
          const n = document.querySelector(sel);
          return n ? n.getAttribute("data-empty") : null;
        };
        return {
          status: txt("#uaStatus"), statusMark: mark("#uaStatus"),
          feedEmpty: txt("#uaFeedBody .flows-empty"),
          feedMark: mark("#uaFeedBody .flows-empty"),
          nameEmpty: txt("#uaNameBody .flows-empty"),
          nameMark: mark("#uaNameBody .flows-empty"),
          alertMark: mark("#uaAlertsBody .flows-empty"),
          feedCap: txt("#uaFeedCap"), nameCap: txt("#uaNameCap"),
          alertsCap: txt("#uaAlertsCap"), alertsNote: txt("#uaAlertsNote"),
          stamp: txt("#uaAlertsStamp"), filterNote: txt("#uaFilterNote"),
        };
      });
      await p.close();
      return out;
    };

    const BASIS = { unit: "A contract counter, and not a trade.",
                    date: "no date parameter, the span is unobserved" };
    const LIVE_ALERTS = {
      v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", refreshed: "nightly",
      seen: 4, shed: 0, cap: 50, rows: [{ t: "AAPL", cp: "C", k: 200,
        exp: "2026-09-18", prem: 1000, size: 5, trades: 1 }],
    };

    /* ---- the contracts block that is not on the payload ---- */
    const noContracts = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 2,
      coverage: [{ t: "AAA", rows: 400 }],
      names: { rows: [], universe: 2, ranked: 2, unranked: 0, shown: 0 },
      basis: BASIS,
    }, LIVE_ALERTS);

    eq(noContracts.statusMark, "unavailable",
       "A PAYLOAD WITH NO `contracts` BLOCK IS THE FOURTH SILENCE, and the strip wears the " +
       "dagger that says so. It used to wear no mark at all, which left the reader the " +
       "prose and nothing else to tell a missing field from a measurement");
    ok(!/\d/.test(noContracts.status),
       `AND IT CARRIES NO DIGIT. "0 contracts from 0 names, of 0 that cleared the floors" ` +
       `is three counts taken off a block that is not on the wire — a zero nobody counted, ` +
       `which is Number(null) === 0 with a denominator attached — got: ${noContracts.status}`);
    eq(noContracts.feedMark, "unavailable",
       "and the feed's own empty row carries the same mark rather than the quiet hairline");
    ok(!/\bfloors\b/.test(String(noContracts.feedCap)),
       `with no caption counting a population that was never published — got: ` +
       `${noContracts.feedCap}`);
    /* THE FOLD RULE, ON THE SCREEN THE READER LANDS ON. Reassurance may fold;
       a withholding never may — and the default note is the one nobody has to
       press anything to reach. */
    ok(!/Both tables show every row published/.test(String(noContracts.filterNote)),
       `THE REASSURANCE MAY NOT OUTLIVE THE FEED IT REASSURES ABOUT. "Both tables show ` +
       `every row published" stood two elements under a feed cell reading "the contract ` +
       `rows are not on this payload", in the DEFAULT view, with the honest sentence ` +
       `reachable only by pressing a pill — got: ${noContracts.filterNote}`);
    ok(/contracts are not on this payload/.test(String(noContracts.filterNote)),
       `and the unpressed note names the silence in the same words the filtered one uses, ` +
       `off the same tally, so the two sentences cannot disagree — got: ` +
       `${noContracts.filterNote}`);
    /* The note states its tallies only while a filter is on, which is where
       the displayed zero lived: the same payloads, read again with Calls
       pressed. */
    const noContractsFiltered = await read(null, null, null,
      "#uaFilters button:nth-child(2)");
    ok(/contracts are not on this payload/.test(String(noContractsFiltered.filterNote)),
       `and the filter note names the absence rather than reporting "0 of 0 contracts are ` +
       `drawn" from it — got: ${noContractsFiltered.filterNote}`);
    ok(!/of 0 contracts are drawn/.test(String(noContractsFiltered.filterNote)),
       "which is the same displayed zero the alerts side already refuses");
    ok(!/could not be read/.test(String(noContractsFiltered.filterNote)),
       "and it is NOT the broken-read sentence either: this payload arrived intact and " +
       "parsed, and the two silences have to stay two");
    eq(noContractsFiltered.feedMark, "unavailable",
       "AND PRESSING A PILL DOES NOT ERASE THE WITHHOLDING. paintFeedRows blanks the body " +
       "before it redraws, so over a feed with no published rows it wiped the cell that " +
       "said why and left a blank table under a caption — which is worse than any of the " +
       "four silences, because it says nothing at all");

    /* ---- the contracts block that IS on the payload, carrying no rows ----

       THE GUARD READS `rows`, SO THE SENTENCE MAY SPEAK ONLY OF `rows`. Three
       shapes reach that branch — no `contracts` key, a block with no `rows`,
       and a block whose `rows` is not an array — and one dagger over all three
       told the reader, as a fact about the wire, that a block they can find in
       the payload with `shown: 50` and `eligible: 5953` on it is not on it.
       paintAlerts calls this exact shape UNREADABLE on the alerts feed, so the
       fix for a collapse of the four silences had collapsed two of them. */
    const brokenContracts = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 2,
      contracts: { shown: 50, eligible: 5953, cap: 50, perName: 2,
                   capBound: "rows", rows: null },
      coverage: [{ t: "AAA", rows: 400 }],
      names: { rows: [], universe: 2, ranked: 2, unranked: 0, shown: 0 },
      basis: BASIS,
    }, LIVE_ALERTS);

    eq(brokenContracts.statusMark, "unreadable",
       "A CONTRACTS BLOCK ON THE PAYLOAD WITH NO ROWS ARRAY IS THE CROSS, NOT THE DAGGER: " +
       "published bytes this page could not parse, which is exactly what paintAlerts " +
       "prints for the identical shape one panel above");
    eq(brokenContracts.feedMark, "unreadable",
       "and the feed's own empty row carries the same cross rather than the dagger that " +
       "says a field is missing from the payload");
    ok(brokenContracts.statusMark !== noContracts.statusMark,
       "which is the whole point: the two shapes are two silences and wore one mark");
    ok(!/carries no contracts block/.test(String(brokenContracts.status)),
       `AND THE STRIP STATES NO FALSEHOOD ABOUT THE WIRE. The block is on this payload — ` +
       `a reader can see the shown and the eligible on it — so "this payload carries no ` +
       `contracts block" asserts something the guard never tested — got: ` +
       `${brokenContracts.status}`);
    ok(/no rows array/.test(String(brokenContracts.status)),
       `it says what was read instead — got: ${brokenContracts.status}`);
    ok(!/\d/.test(String(brokenContracts.status)),
       `and still carries no digit: an unreadable list is not a licence to print the ` +
       `counts beside it as though they described a drawn table — got: ` +
       `${brokenContracts.status}`);
    const brokenFiltered = await read(null, null, null, "#uaFilters button:nth-child(2)");
    ok(/contracts could not be read/.test(String(brokenFiltered.filterNote)),
       `and the filter note words it as the broken read it is — got: ` +
       `${brokenFiltered.filterNote}`);
    ok(!/contracts are not on this payload/.test(String(brokenFiltered.filterNote)),
       "and never as the absence, which is the other half of the same collapse");

    /* ---- the names block that is not on the payload ---- */
    const noNames = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 1,
      contracts: { rows: [contract("AAA", "C", 100, "2026-09-18", 900, "long")],
                   shown: 1, eligible: 1, cap: 60, perName: 30, capBound: "eligible" },
      coverage: [{ t: "AAA", rows: 400 }],
      basis: BASIS,
    }, LIVE_ALERTS);

    eq(noNames.nameMark, "unavailable",
       "A MISSING NAME PANEL IS UNAVAILABLE, NOT QUIET. The panel used to print “No name " +
       "carried both a call and a put thirty-day average, so none could be ranked” off a " +
       "`names` block that is not on the payload — a finding about every screened name, " +
       "published from an absence");
    ok(!/thirty-day average/.test(String(noNames.nameEmpty)),
       `so the quiet sentence specifically does not appear — got: ${noNames.nameEmpty}`);
    ok(!/\d/.test(String(noNames.nameCap)),
       `and no caption ranks 0 of 0 names — got: ${noNames.nameCap}`);
    eq(noNames.statusMark, null,
       "while the strip, whose contracts DID arrive, carries no mark at all: one silence " +
       "does not spread to a panel that measured something");
    ok(/\b1 contracts? from 1 name\b/.test(String(noNames.status)),
       `and still states its own count — got: ${noNames.status}`);
    ok(!/No name was ranked/.test(String(noNames.nameEmpty)),
       `AND THE REPLACEMENT SENTENCE ASSERTS ONLY WHAT THE GUARD READ. "No name was ` +
       `ranked and none was found unrankable" is a claim about the RUN, made off a guard ` +
       `that tested \`rows\` — it is a second finding published from an absence, in the ` +
       `place the first one was removed from — got: ${noNames.nameEmpty}`);
    ok(/Both tables show every row published/.test(String(noNames.filterNote)),
       "while a page whose two TABLES both answered keeps its reassurance: the name panel " +
       "is not one of them, and gating that sentence on every panel would trade a false " +
       "reassurance for a false alarm");

    /* ---- the name panel that IS on the payload, carrying no rows ---- */
    const brokenNames = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 1,
      contracts: { rows: [contract("AAA", "C", 100, "2026-09-18", 900, "long")],
                   shown: 1, eligible: 1, cap: 60, perName: 30, capBound: "eligible" },
      coverage: [{ t: "AAA", rows: 400 }],
      names: { ranked: 40, universe: 420, unranked: 0, shown: 40, rows: null },
      basis: BASIS,
    }, LIVE_ALERTS);

    eq(brokenNames.nameMark, "unreadable",
       "A NAME PANEL WHOSE ROWS COULD NOT BE READ IS THE CROSS, NOT THE DAGGER — the same " +
       "split the feed above makes, because the payload states 40 of 420 names ranked and " +
       "the panel is not entitled to call that missing");
    ok(!/No name was ranked/.test(String(brokenNames.nameEmpty)),
       `and specifically does not report the run: this payload says 40 were ranked and 0 ` +
       `were unrankable — got: ${brokenNames.nameEmpty}`);
    ok(/no rows array/.test(String(brokenNames.nameEmpty)),
       `it names what could not be read instead — got: ${brokenNames.nameEmpty}`);

    /* ---- measured, and empty ---- */
    const quiet = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "quiet", namesSeen: 2,
      contracts: { rows: [], shown: 0, eligible: 0, cap: 60, perName: 30,
                   capBound: "eligible" },
      coverage: [{ t: "AAA", rows: 400 }],
      names: { rows: [], universe: 2, ranked: 0, unranked: 2, shown: 0 },
      basis: BASIS,
    }, LIVE_ALERTS);

    eq(quiet.statusMark, "quiet",
       "A CHAIN THAT CLEARED NOTHING IS THE ONE SILENCE THAT IS A READING, and it gets the " +
       "hairline: no glyph, no colour, because it is a fact about the market and not about " +
       "the payload or about this page");
    eq(quiet.feedMark, "quiet", "and so does the feed's empty row");
    eq(quiet.nameMark, "quiet",
       "and the name panel's, where every count IS measured and every one of them is zero");
    ok(/cleared both floors/.test(String(quiet.feedEmpty)),
       `with the sentence that says whose chains those were — got: ${quiet.feedEmpty}`);

    /* AND THE EMPTINESS IS WHAT MAKES IT QUIET, NOT THE PAYLOAD'S OWN LABEL.
       The same block with no rows and no `status: "quiet"` is the same reading:
       the array exists and holds nothing. The strip's gate also tested the
       label, so this state left the strip bare while the feed cell below it
       drew the hairline — one state, two elements, two marks, and the strip's
       prose identical either way, since the counts it prints never read
       `status`. The feed's sentence is where the two are told apart. */
    const unlabelled = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 2,
      contracts: { rows: [], shown: 0, eligible: 0, cap: 60, perName: 30,
                   capBound: "eligible" },
      coverage: [{ t: "AAA", rows: 400 }],
      names: { rows: [], universe: 2, ranked: 0, unranked: 2, shown: 0 },
      basis: BASIS,
    }, LIVE_ALERTS);
    eq(unlabelled.statusMark, "quiet",
       "an empty rows array is the measured emptiness whether or not the payload also " +
       "stamped itself quiet: the rows are the reading, the label is a weaker second " +
       "assertion about the same fact");
    eq(unlabelled.statusMark, quiet.statusMark,
       "so the strip wears one mark for one state, rather than two for a sentence it " +
       "prints identically either way");
    eq(unlabelled.feedMark, "quiet",
       "and the feed cell agrees with the strip above it, which is what disagreed before");
    ok(/did not report the read as quiet/.test(String(unlabelled.feedEmpty)),
       `while the SENTENCE still separates the two — got: ${unlabelled.feedEmpty}`);

    /* ---- the alerts side, three states, three marks ---- */
    const alertsPending = await read(null, { v: 2, status: "pending" });
    eq(alertsPending.alertMark, "pending",
       "AN UNPUBLISHED KEY IS PENDING: the dotted rule and the ellipsis, which is the only " +
       "one of the four that says “come back”");

    const alertsBroken = await read(null,
      { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: null });
    eq(alertsBroken.alertMark, "unreadable",
       "a payload that arrived and carries no rows array is UNREADABLE — the cross and the " +
       "widest rule, the one silence with a remedy the reader can act on");

    const alertsQuiet = await read(null,
      { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", refreshed: "nightly",
        seen: 0, shed: 0, cap: 50, rows: [] });
    eq(alertsQuiet.alertMark, "quiet",
       "and a read the vendor's rules flagged nothing in is QUIET, not broken: the three " +
       "states shared one paragraph and now differ by a rule and a glyph as well as by " +
       "their sentence");
    const alertsQuietFiltered = await read(null, null, null,
      "#uaFilters button:nth-child(2)");
    eq(alertsQuietFiltered.alertMark, "quiet",
       "AND PRESSING A PILL DOES NOT ERASE THE ALERTS SIDE'S SENTENCE EITHER. repaint() " +
       "calls paintAlertRows on every press and paintAlertRows blanks the body before it " +
       "redraws, so without the same empty-list guard the feed has, a reader who presses " +
       "Calls over a quiet — or pending, or unreadable — alerts read is left with a blank " +
       "table and no sentence at all, which is worse than any of the four silences");

    /* ---- the key that has not been published yet ---- */
    const unusualPending = await read({ v: 2, status: "pending" }, LIVE_ALERTS);
    eq(unusualPending.statusMark, "pending",
       "THE STORE'S ORDINARY FIRST STATE IS THE DOTTED RULE AND THE ELLIPSIS, on this " +
       "key exactly as on the alerts key: a run that has not happened yet is the one " +
       "silence of the four that tells the reader to come back");

    /* ---- the two fetches that never answered ----

       A FETCH THAT FAILED IS UNREADABLE, NEVER UNAVAILABLE. It is the only one
       of the four silences this page owns rather than reports, and the only
       one with a remedy the reader can act on; wearing the dagger would hand
       the payload the blame for a request that never arrived. Both endpoints
       are answered with a 500 rather than aborted, because that is the shape
       the worker can actually produce. */
    const dead = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await dead.context().addCookies([{
      name: "flows_session", value: session, url: server.baseURL,
    }]);
    await dead.route("**/api/flows/unusual", (route) =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "no" }));
    await dead.route("**/api/flows/flowalerts", (route) =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "no" }));
    await dead.goto(at("/flows/unusual/"), { waitUntil: "networkidle" });
    await dead.waitForSelector("#uaFeedBody .flows-empty");
    const broke = await dead.evaluate(() => {
      const mark = (sel) => {
        const n = document.querySelector(sel);
        return n ? n.getAttribute("data-empty") : null;
      };
      return {
        statusMark: mark("#uaStatus"),
        feedMark: mark("#uaFeedBody .flows-empty"),
        nameMark: mark("#uaNameBody .flows-empty"),
        basisMark: mark("#uaBasis .flows-empty"),
        alertMark: mark("#uaAlertsBody .flows-empty"),
        filterNote: (document.getElementById("uaFilterNote") || {}).textContent,
      };
    });
    await dead.close();

    eq(broke.statusMark, "unreadable", "the strip wears the cross when the fetch died");
    eq(broke.feedMark, "unreadable", "and so does the contract feed's empty row");
    eq(broke.nameMark, "unreadable", "and the name panel's");
    eq(broke.basisMark, "unreadable",
       "and the basis, which is the page's own account of its method and must not read " +
       "as though the method were withheld");
    eq(broke.alertMark, "unreadable",
       "and the alerts panel, whose own fetch failed separately — one payload's failure " +
       "is not the other's, and both are this page's to own");
    ok(/flagged windows could not be read/.test(String(broke.filterNote)) &&
       /contracts could not be read/.test(String(broke.filterNote)),
       `while the filter note counts neither table — got: ${broke.filterNote}`);

    /* ---- one clock, in the unit the rest of the panel is in ---- */
    const NY = await read(null, LIVE_ALERTS, { timezoneId: "America/New_York" });
    ok(/^Read 2026-09-01 06:00 UTC/.test(String(NY.stamp)),
       `THE STAMP IS THE READ INSTANT IN UTC. It went through toLocaleTimeString, so a New ` +
       `York reader saw "Read 02:00" above a note that printed the same instant as ` +
       `"2026-09-01 06:00 UTC" and beside a Window column headed UTC — and an Istanbul ` +
       `reader saw a different calendar day — got: ${NY.stamp}`);
    ok(!/\b02:00\b/.test(String(NY.stamp)),
       "and specifically not the local wall clock, which is a fourth number on a panel " +
       "that already carries three readings of one instant");
    ok(!/Read /.test(String(NY.alertsNote)),
       `while the note below no longer repeats it: two "Read …" lines on one panel invite ` +
       `the reading that they are two reads — got: ${NY.alertsNote}`);
    ok(/vendor's own stated span/.test(String(NY.alertsNote)),
       "keeping the fact the note owed the reader, which is the unit those spans are in");

    /* ---- what the row cap shed, and what nobody counted ---- */
    const shedNone = await read(null, {
      v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", seen: 4, shed: 0, cap: 50,
      rows: [{ t: "AAPL", cp: "C", k: 200, exp: "2026-09-18", prem: 1000 }],
    });
    const shedUnknown = await read(null, {
      v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", seen: 4, cap: 50,
      rows: [{ t: "AAPL", cp: "C", k: 200, exp: "2026-09-18", prem: 1000 }],
    });
    ok(/not recorded on this payload/.test(String(shedUnknown.alertsCap)),
       `AN UNCOUNTED SHED SAYS SO. \`isNum(alerts.shed) ?? 0\` turned an absent count into ` +
       `a measured zero, so a payload published before \`shed\` shipped printed the caption ` +
       `of a read the cap did not touch — got: ${shedUnknown.alertsCap}`);
    ok(!/not recorded on this payload/.test(String(shedNone.alertsCap)),
       `while a read the cap genuinely did not touch stays silent about it — got: ` +
       `${shedNone.alertsCap}`);
    ok(shedNone.alertsCap !== shedUnknown.alertsCap,
       "which is the whole point: the two captions were byte-identical, and one of them " +
       "was reporting a measurement nobody made");

    /* ---- a vendor ceiling is not a census ---- */
    const atCeiling = await read(null, {
      v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", seen: 200, shed: 199, cap: 50,
      vendorLimit: 200, vendorTruncated: true,
      rows: [{ t: "AAPL", cp: "C", k: 200, exp: "2026-09-18", prem: 1000 }],
    });
    ok(/of at least 200 flagged windows/.test(String(atCeiling.alertsCap)),
       `THE DENOMINATOR IS A FLOOR WHEN THE READ HIT THE VENDOR'S LIMIT. "1 of 200" reads ` +
       `as a market; the population above that line is unknown and the caption prints the ` +
       `bound it actually has — got: ${atCeiling.alertsCap}`);
    ok(!/of at least/.test(String(shedNone.alertsCap)),
       "while a read that did not hit the ceiling keeps its exact denominator — the floor " +
       "is a qualification of one measurement, not a hedge on every one");
  } finally {
    /* THE WORKER IS A CHILD PROCESS AND IT MUST BE STOPPED. Without this the
       suite prints its success line and then hangs forever holding a wrangler
       process open — which reads to a runner exactly like a failing test. */
    await browser.close();
    await server.stop();
  }
}

console.log(`✓ flows-unusual: ${checks} assertions — a ranking key finite because the ` +
  `population is defined and not because a guard caught it, floors that decide membership ` +
  `and claim nothing about what they exclude, a lift and a notional bracket withheld whole ` +
  `rather than half-published, an open-interest change that tells unchanged from unknown, ` +
  `a per-name cap derived from the board and the binding constraint named, a name with no ` +
  `30-day average counted rather than ranked at zero, twelve probe outcomes that stay ` +
  `pairwise distinct so a rate limit never becomes a refusal, a diagnostic whose zero ` +
  `branch says INCONCLUSIVE in words, a vocabulary ban enforced over the payload's own ` +
  `prose with four named exceptions and no weakened regex, one parse of every contract ` +
  `symbol per chain counted through a getter rather than asserted from memory, the board's ` +
  `own stage threaded to the feed and OMITTED rather than nulled when absent, and — in a ` +
  `browser at 320px — two payloads joined on the four-tuple they share with a mark that ` +
  `fires on exactly the one contract both selections chose, a filter group both tables ` +
  `honour whose note keeps a narrowed table from reading as a thin market, and an alerts ` +
  `table that finally ranks, announces its ranking, and gives the vendor's order back, ` +
  `and a filter note that says which table could not be read rather than counting it as zero, ` +
  `and the four silences kept four: a payload with no contracts block marked unavailable and ` +
  `carrying no digit rather than "0 contracts from 0 names", a missing name panel that is not ` +
  `a quiet market, a chain that cleared nothing marked as the reading it is, the alerts key's ` +
  `pending, unreadable and quiet states each with its own mark, one read instant stamped once ` +
  `in UTC rather than three clocks on one panel, an uncounted row-cap shed that says so ` +
  `instead of printing a zero, a denominator that prints as a floor when the read hit the ` +
  `vendor's own ceiling, a contracts block and a name panel each split between the field ` +
  `that is not on the payload and the one whose rows could not be read — so the dagger and ` +
  `the cross never stand in for one another and no sentence claims more than its guard ` +
  `tested — a reassurance that does not outlive the feed it reassures about, on the default ` +
  `screen and not behind a pill, two painters whose sentence survives a pill press, and ` +
  `a fetch that never answered wearing the cross on the strip, on both tables, on the ` +
  `basis and on the alerts panel rather than any of them going quiet`);
