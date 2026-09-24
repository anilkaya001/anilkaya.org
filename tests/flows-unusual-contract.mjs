import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  UA_MIN_VOLUME, UA_MIN_OI, UA_ROWS, UA_NAMES, UA_PER_NAME_MIN, UA_PER_NAME_MAX,
  perNameCap, buildUnusualRows, rankUnusual,
  unusualNameRow, rankUnusualNames,
  describeFlowAlerts, describeOiBasis, UNUSUAL_NOTES, poolOiBasis, OI_BASIS_MIN_SEEN, UA_BANNED_CLAIMS,
} from "../shared/flows-unusual.js";
import { buildChainPanels, buildTopContracts, buildAggressor } from "../shared/flows-chain.js";
import { daysToExpiry, SHARES_PER_CONTRACT } from "../shared/flows-premium.js";
import { fakeChain, screenerTilt } from "../scripts/flows-pipeline.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

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

const SPOT = 100;
const CHAIN = fakeChain("SYN001", SPOT, 4242);
const OWN = CHAIN.filter((r) => /^SYN001\d{6}[PC]\d{8}$/.test(r.option_symbol));

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

{
  const base = one(SEED);
  ok(Number.isFinite(base.vor) && base.vor > 0,
     "the unmutated seed row carries a finite, positive vor");

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

  for (const [label, vol] of [["zero", 0], ["null", null], ["empty string", ""]]) {
    eq(build({ ...SEED, volume: vol }).length, 0,
       `volume ${label} is excluded rather than ranked at vor = 0`);
  }
  eq(build(drop(SEED, "volume")).length, 0, "and so is an absent volume key");

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

  const zeroed = one({ ...SEED, ask_volume: "0", bid_volume: "0" });
  eq(zeroed.lift, null,
     "both legs reported as 0 on a contract that traded: lift is NULL, because a share of " +
     "an empty classified population is undefined, not balanced");
  ok(zeroed.lift !== 0.5 && zeroed.lift !== 0,
     "and again not the two numbers that would read as a measurement");

  eq(zeroed.aggr, 0,
     "aggr on a reported 0/0 split is 0, matching buildTopContracts and buildAggressor. " +
     "PINNED, not endorsed — see the comment above: the brief asked for null here, and " +
     "moving this one call site alone would split one relation across two surfaces");

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

{

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

const REBUILDABLE = (r) => r.sc !== null && r.sp !== null && r.st !== null && r.chg !== null &&
  Math.abs(r.st - r.sc) > 0.001 && Math.abs(r.st - r.sp) > 0.001;

const rebuild = (em) => {

  const w = (em.st - em.sp) / (em.sc - em.sp);
  const callAvg = Math.round(w * 1000) * 1000;
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

{

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

  const inflated = candidates[0].oneSided;
  ok(inflated > em.st * 1.5,
     `the one-sided fallback would have published about ${inflated.toFixed(2)} against a ` +
     `true ${em.st} — the failure this null is refusing, and it is large enough to be a ` +
     "different reading rather than a rounding difference");
  ok(st(noCall) !== Number(inflated.toFixed(3)),
     "and it is not what the module publishes");

  eq(st({ ...row, avg_30_day_call_volume: "0" }), null,
     "an average PRESENT and equal to zero is not a usable denominator either, and the " +
     "row is unmeasured rather than infinite");
  eq(st({ ...row, avg_30_day_put_volume: "0" }), null, "on either side");
  eq(st({ ...row, avg_30_day_call_volume: "" }), null, "an empty average is missing");

  eq(st(drop(row, "call_volume")), null,
     "a missing volume on one side is a missing numerator, not a numerator of zero");
  eq(st({ ...row, call_volume: "0", put_volume: "0" }), 0,
     "while volumes REPORTED as zero against real averages are a genuine reading of 0 — " +
     "the name traded nothing against a norm that exists");
}

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

  const throttled = describeFlowAlerts({ status: 429, raw: "slow down" });
  eq(throttled.verdict, "throttled", "429 is throttled and nothing else");
  ok(throttled.verdict !== "refused", "and is emphatically not the refused verdict");

  ok(!/(?<!not )refused/i.test(throttled.line),
     "the 429 line contains no UN-NEGATED 'refused': it may say 'NOT REFUSED', which is " +
     "the point, but it may never claim the key was refused");
  ok(/\bNOT REFUSED\b/.test(throttled.line),
     "and it says so in as many words, so a maintainer reading the log cannot mistake a " +
     "rate limit for an answer");
  ok(/still\s+unanswered/i.test(throttled.line) && /must not be touched/i.test(throttled.line),
     "and it says the question is still unanswered and the pipeline's assertion must not " +
     "be edited on the strength of it");

  const dry = describeFlowAlerts({ dryRun: true });
  eq(dry.verdict, "not-probed", "a dry run is 'not-probed'");
  ok(/not probed/i.test(dry.line), "and its line says so in words");
  ok(!/\b(reachable|unreachable|refused|throttled|not found|empty)\b/i.test(dry.line),
     "and contains NO verdict word: nothing was asked, so nothing may be reported. A dry " +
     "run that read as 'unreachable' would be a fabricated answer to the only question " +
     "this probe exists to settle");
  ok(!/\b\d{3}\b/.test(dry.line), "and it quotes no status code, because there was none");

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

  eq(describeFlowAlerts({ status: 200, parsed: true, body: { data: [{ a: 1 }] } }).verdict, "reachable",
     "a 200 with {data:[rows]} is reachable, and uw() would have worked");
  eq(describeFlowAlerts({ status: 200, parsed: true, body: { data: [] } }).verdict, "empty",
     "a 200 with {data:[]} is accepted-and-empty, which is neither reachable-with-data nor refused");
  ok(/settles nothing/i.test(describeFlowAlerts({ status: -1, network: true, raw: "x" }).line),
     "and a request that never completed says it settles nothing, rather than counting as a refusal");
  ok(/provenance/i.test(describeFlowAlerts({ status: 401, raw: "no" }).line),
     "while a 401 is the one outcome that DOES give the standing assertion provenance, and says so");
}

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

  ok(/publishes these counts/.test(falsified.line),
     "and saying the card publishes these counts rather than leaving the falsification " +
     "in a log only a maintainer reads");
  ok(!/Both cannot be right/.test(falsified.line),
     "the old line named a contradiction with the ticker caption that no longer exists");

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

  const blind = describeOiBasis(OWN.map((r) => drop(r, "prev_oi")));
  eq(blind.verdict, "no-data", "with no previous open interest anywhere, the verdict is no-data");
  eq(blind.seen, 0, "nothing was seen");
  eq(blind.exceedShare, null,
     "and the share is NULL, not 0 — 'no contract could be checked' and 'no contract " +
     "failed' are different facts and only one of them is a measurement");
  ok(/nothing could be checked/.test(blind.line), "and the line says so");

  const tagged = describeOiBasis(OWN, { dryRun: true });
  ok(tagged.line.startsWith("[dry-run] "), "a dry run tags its own line");
  ok(/not evidence about the vendor/.test(tagged.line),
     "and says outright that a synthetic exceedance is not evidence about the vendor");
  ok(!describeOiBasis(OWN).line.startsWith("[dry-run] "),
     "while a live run carries no tag");

  const belowFloor = OWN.map((r) => ({ ...r, volume: "1", open_interest: "5000", prev_oi: "1" }));
  eq(describeOiBasis(belowFloor).verdict, "no-data",
     "contracts below the volume floor are not checked at all, so the diagnostic speaks " +
     "about the same population the feed ranks");
}

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

{
  const BAN = /\b(print|trade|block|sweep|order|bought|sold|paid|whale|smart money|institutional)\b/gi;
  const ALLOWED = [

    { path: "basis.aggr", word: "print", near: /counted each print against the side of the book/i },

    { path: "basis.unit", word: "trade", near: /counter, not a trade/i },
    { path: "basis.unit", word: "sweep", near: /no sweep flag/i },
    { path: "basis.refusals", word: "smart money", near: /No\s+[“"']?smart money/i },

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

      for (const [k, v] of Object.entries(value)) scan(v, `${at}.${k}`);
    }
  };
  scan(PAYLOAD.basis, "basis");
  scan(PAYLOAD.volumeAsOfReason, "volumeAsOfReason");
  for (const cvg of PAYLOAD.coverage) scan(cvg.ivBasis, "coverage.ivBasis");

  eq(used.size, ALLOWED.length,
     `all ${ALLOWED.length} named exceptions are still present in the emitted prose — a ` +
     "dead entry would be an allow-list quietly widening past what it was written for");

  ok(typeof PAYLOAD.basis.rank === "object" && typeof PAYLOAD.basis.rank.reason === "string" &&
     typeof PAYLOAD.basis.floors.reason === "string",
     "basis.rank and basis.floors carry their reasons as nested strings, which the scan " +
     "above descends into rather than skipping");
  ok(PAYLOAD.basis.aggr === null || typeof PAYLOAD.basis.aggr === "string",
     "basis.aggr is a string harvested from a chain that built one, or an honest null");
  ok(typeof PAYLOAD.basis.aggr === "string" && PAYLOAD.basis.aggr.length > 0,
     "and on this corpus it is the harvested string, not the null the first attempt shipped");

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

{
  const panel = buildChainPanels(CHAIN, { spot: SPOT, asOf: "2026-08-24", ticker: "SYN001" });
  eq(panel.status, "ok", "the emitted chain builds a panel");
  ok(Array.isArray(panel.unusualRows) && panel.unusualRows.length > 0,
     `buildChainPanels returns unusualRows (${panel.unusualRows.length} of them) — the feed ` +
     "is produced where the divisor and the root-filtered rows are, not by a caller");
  ok(Number.isFinite(panel.ivDivisor),
     "and it returns ivDivisor beside them, so the convention behind the iv column is " +
     "reachable rather than having to be re-derived");

  const pct = CHAIN.map((r) => ({ ...r, implied_volatility: (Number(r.implied_volatility) * 100).toFixed(6) }));
  const pctPanel = buildChainPanels(pct, { spot: SPOT, asOf: "2026-08-24", ticker: "SYN001" });
  eq(pctPanel.ivDivisor, 100,
     "a percent-quoted chain decides on a divisor of 100 from its own median");
  eq(panel.ivDivisor, 1, "while the fraction-quoted one decides on 1");

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

  deep(pctPanel.unusualRows, panel.unusualRows,
     "the percent-quoted chain and the fraction-quoted chain produce IDENTICAL feed rows, " +
     "field for field — the 100x ambiguity is removed once, per chain, at the only place " +
     "that knows the answer");

  ok(panel.oiBasis && typeof panel.oiBasis.verdict === "string",
     "the open-interest basis check rides along on the same root-filtered rows");
}

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

  reads = 0;
  buildUnusualRows(counted, { ticker: "SYN001", spot: SPOT, sessionDate: "2026-08-24" });
  const soloReads = reads;
  eq(soloReads, CHAIN.length,
     "one standalone consumer parses every row exactly once, which is the unit the " +
     "count above is expressed in");
  ok(panelReads < soloReads * 3,
     `and the whole panel now costs ${panelReads} reads where the five consumers alone ` +
     `would cost about ${soloReads * 5}`);

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

  ok(PAYLOAD.contracts.rows.every((r) => r.m === null || Math.abs(r.m) < 2),
     "no row in the emitted feed carries a log-moneyness beyond |2|, which is what an " +
     "adjusted series' pre-split strike would look like against a live spot");
}

{
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
      { t: "AAA", cp: "C", k: 100, exp: "2026-09-18", oc: "AAA260918C00100000",
        prem: 250000, askPrem: 200000, bidPrem: 50000, size: 800, trades: 12,
        sweep: true, floor: false, single: true, opening: null,
        spanStart: "2026-09-01T13:31:00Z", spanEnd: "2026-09-01T13:36:00Z",
        rule: "RepeatedHits", st: "long" },
      { t: "ZZZ", cp: "P", k: 20, exp: "2026-09-25", oc: "ZZZ260925P00020000",
        prem: 90000, askPrem: 10000, bidPrem: 80000, size: 300, trades: 4,
        sweep: false, floor: false, single: false, opening: false,
        spanStart: "2026-09-01T14:00:00Z", spanEnd: "2026-09-01T14:02:00Z",
        rule: "Sweep", st: "foreign" },
    ],
  });

  const browser = await chromium.launch();
  const newPage = async (options) => {
    const p = await browser.newPage(Object.assign({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }, options || {}));
    await p.context().addCookies([{ name: "flows_session", value: session, url: server.baseURL }]);
    return p;
  };
  const load = async (p) => {
    await p.goto(at("/flows/unusual/"), { waitUntil: "networkidle" });
    await p.waitForFunction(() => !/^Loading/.test(document.getElementById("uaStatus").textContent) &&
      !!document.getElementById("uaTimelineCard").dataset.state && !!document.getElementById("uaFeedCard").dataset.state);
  };
  const press = (p, label) => p.evaluate((l) => {
    const b = [...document.querySelectorAll("#uaFilters .ui-seg-i, #uaFilters .fu-toggle")].find((x) => x.textContent.trim() === l);
    b.click();
    return !!b;
  }, label);
  const disclose = (p, selector) => p.evaluate(async (sel) => {
    const b = document.querySelector(sel);
    if (!b) return null;
    b.click();
    await new Promise((r) => setTimeout(r, 30));
    const text = document.getElementById("fxPop") ? document.getElementById("fxPop").textContent : null;
    window.FlowsUI.closeInfo();
    return text;
  }, selector);
  const info = (p, card) => disclose(p, "#" + card + " .ui-mod-h > .ui-info");
  const why = (p, card) => disclose(p, "#" + card + " .ui-silent button");
  const lists = (p) => p.evaluate(() => ({
    feed: [...document.querySelectorAll("#uaFeed .fu-crow:not(.fu-head)")].map((r) => r.dataset.t),
    names: [...document.querySelectorAll("#uaNames .fu-nrow:not(.fu-head) .fu-tk b")].map((b) => b.textContent),
    on: [...document.querySelectorAll("#uaTimeline .fu-b:not(.is-off)")].length,
    bubbles: [...document.querySelectorAll("#uaTimeline .fu-b")].length,
    note: document.getElementById("uaFilterNote").textContent,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));

  try {
    const page = await newPage({ viewport: { width: 320, height: 900 } });
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e)));
    await load(page);

    const first = await page.evaluate(() => {
      const svg = document.querySelector("#uaTimeline svg");
      const bothRows = [...document.querySelectorAll('#uaFeed .fu-crow[data-both="1"]')];
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        feedBoth: bothRows.length,
        feedBothTitle: bothRows[0] ? bothRows[0].getAttribute("title") : "",
        feedBothMark: bothRows[0] ? !!bothRows[0].querySelector(".fu-both") : false,
        tabs: [...document.querySelectorAll("#uaFilters .ui-seg-i")].map((b) => b.textContent + ":" + b.getAttribute("aria-selected")),
        both: document.querySelector("#uaFilters .fu-toggle").getAttribute("aria-pressed"),
        stages: [...document.querySelectorAll("#uaFeed .fu-crow:not(.fu-head)")].map((r) => [r.dataset.stage || null, !!r.querySelector(".fu-side")]),
        vb: svg ? svg.viewBox.baseVal.width : null, rectW: svg ? svg.getBoundingClientRect().width : null,
        widthAttr: svg ? svg.getAttribute("width") : null,
        bubbles: document.querySelectorAll("#uaTimeline .fu-b").length,
      };
    });
    eq(first.overflow, 0, "nothing overflows at 320px with the filter group on the page");
    eq(thrown.length, 0, `the page threw nothing: ${thrown.join("; ")}`);

    eq(first.bubbles, 2, "the timeline draws one bubble per flagged window that states a time");
    eq(first.vb, first.rectW,
       `one viewBox unit is one CSS pixel on the timeline: viewBox ${first.vb} units drawn in ` +
       `${first.rectW}px. A stretched viewBox scales every label with it, and the chart goes on ` +
       "looking exactly like a chart");
    ok(first.widthAttr !== "100%", `and the width is a pixel count (${first.widthAttr}), never a per cent`);

    eq(first.feedBoth, 1,
       "exactly one counter-feed row is marked as also flagged by the vendor — a mark " +
       "that fired on every row, or on none, would pass a laxer assertion than this");
    ok(first.feedBothMark, "and the mark is drawn on the row, not only carried in its data");
    ok(/RepeatedHits/.test(first.feedBothTitle),
       "with the vendor's own rule named on the row rather than left to a legend");
    ok(/premium/.test(first.feedBothTitle),
       "and the window's premium beside it, so the mark carries the reading and not just " +
       "the fact of a match");
    deep(first.tabs, ["All:true", "Calls:false", "Puts:false"],
       "the side control starts unfiltered and says so on every tab, exactly one selected");
    eq(first.both, "false", "and the join toggle starts unpressed");

    deep(first.stages, [["long", true], [null, false]],
       "THE BOARD'S OWN VIEW REACHES THE COUNTER FEED'S ROW, and only where the payload " +
       "states one — a mark drawn unconditionally would look identical on the row that carries " +
       "a stage and would be a fabrication on the row that does not");

    await page.evaluate(() => { const c = document.querySelector("#uaTimeline .ui-chart"); c.focus(); c.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
    const readout = await page.evaluate(() => document.querySelector("#uaTimeline .ui-readout").textContent);
    ok(/AAA/.test(readout) && /9:31 AM/.test(readout),
       `the keyboard reaches the first window in time order and the readout names it and its Eastern time — got: ${readout}`);

    ok(await press(page, "Puts"), "the Puts tab is there to press");
    const puts = await lists(page);
    deep(puts.feed, ["BBB"], "filtering to puts narrows the counter feed");
    deep(puts.names, ["ZZZ"], "and the flagged names, from the same control");
    eq(puts.on, 1, "and the timeline dims the call bubble rather than deleting the session's shape");
    eq(puts.bubbles, 2, "both bubbles stay drawn, one of them held back");
    ok(/1 of 2 flagged windows are drawn/.test(puts.note) && /1 of 2 contracts are drawn/.test(puts.note),
       `and the note states both drawn counts against both published ones — got: ${puts.note}`);
    ok(/published and hidden, not absent from the read/.test(puts.note),
       "SO A NARROWED LIST IS NEVER MISTAKEN FOR A THIN MARKET, which is the whole " +
       "risk a filter introduces to a page that reports what a vendor did not send");
    eq(puts.overflow, 0, "and the filtered page still does not overflow at 320px");

    await press(page, "All");
    await press(page, "Both feeds");
    const both = await lists(page);
    deep(both.feed, ["AAA"], "the counter feed narrows to the one contract both selections agree on");
    deep(both.names, ["AAA"], "and so do the flagged names — two independent selections, one line");
    eq(both.on, 1, "and exactly one bubble stays lit on the timeline, the reciprocal mark of the same match");
    eq(await page.evaluate(() => document.querySelector("#uaFilters .fu-toggle").getAttribute("aria-pressed")), "true",
       "with the toggle announcing that it is pressed");
    await press(page, "Both feeds");
    const restored = await lists(page);
    eq(restored.on, 2, "releasing it restores every window");
    deep(await page.evaluate(() => [...document.querySelectorAll("#uaNames .fu-nrow:not(.fu-head) .fu-tk b")].map((b) => b.textContent)), ["AAA", "ZZZ"],
       "and the flagged names come back in the vendor's own premium order, largest first");
    const spoken = await page.evaluate(() => new Promise((resolve) => {
      const chart = document.querySelector("#uaTimeline .ui-chart");
      const live = document.getElementById("fxLive");
      let records = 0;
      const watch = new MutationObserver((m) => { records += m.length; });
      watch.observe(live, { childList: true, characterData: true, subtree: true });
      chart.focus();
      chart.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      setTimeout(() => { watch.disconnect(); resolve({ records, text: live.textContent }); }, 60);
    }));
    eq(spoken.records, 1,
       `ONE KEY PRESS IS ONE ANNOUNCEMENT, however many times the filters redrew the timeline (${spoken.records} ` +
       "writes to the live region). A scrub wired again on every repaint keeps every earlier drawing's handler " +
       "alive, and each of them reads its own detached readout aloud");
    ok(/AAA/.test(spoken.text) && /9:31 AM/.test(spoken.text),
       `and the one it makes reads the current drawing, which a redraw started again from its first window — got: ${spoken.text}`);
    eq(thrown.length, 0, `and nothing threw across the whole interaction: ${thrown.join("; ")}`);
    await page.close();

    await put("flowalerts", { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: null });
    const broken = await newPage({ viewport: { width: 320, height: 900 } });
    await load(broken);
    await press(broken, "Calls");
    const unread = await broken.evaluate(() => document.getElementById("uaFilterNote").textContent);
    ok(/flagged windows could not be read/.test(unread), `an unreadable alerts payload is SAID, not counted — got: ${unread}`);
    ok(!/of 0 flagged windows/.test(unread),
       "and specifically not reported as '0 of 0', which is a measurement of nothing printed as a measurement of the market");
    ok(/1 of 2 contracts are drawn/.test(unread),
       "while the feed that DID answer still states its own two counts — one silence does not swallow the other's measurement");
    await press(broken, "All");
    await press(broken, "Both feeds");
    const joinDead = await broken.evaluate(() => document.getElementById("uaFilterNote").textContent);
    ok(/cannot be resolved at all/.test(joinDead), `the join says it will never resolve rather than promising a load — got: ${joinDead}`);
    ok(!/until both payloads have loaded/.test(joinDead),
       "which is what it used to promise, indefinitely, about a payload that had already come back broken");
    await broken.close();

    const ceilingNote = async (alerts) => {
      await put("flowalerts", alerts);
      const p = await newPage();
      await load(p);
      const text = await p.evaluate(() => document.getElementById("uaFilterNote").textContent);
      const pop = await info(p, "uaTimelineCard");
      await p.close();
      return { text, pop };
    };
    const alertRow = { t: "AAPL", cp: "C", k: 200, exp: "2026-09-18", px: 1.2 };

    const capped = await ceilingNote({ v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: [alertRow], vendorLimit: 200, vendorTruncated: true });
    ok(/vendor's own ceiling/.test(capped.text), `a truncated read says whose ceiling it hit — got: ${capped.text}`);
    ok(/200/.test(capped.text), "and names the limit, because a ceiling without its height is not a measurement");
    ok(/ceiling rather than a market/.test(capped.text),
       "and says what that does to the count: comparing it with another session compares two ceilings");
    ok(/ceiling rather than a market/.test(capped.pop || ""), "and the timeline's own disclosure carries the same sentence");

    const fitted = await ceilingNote({ v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: [alertRow], vendorLimit: 200, vendorTruncated: false });
    ok(/under the vendor's ceiling/.test(fitted.text), `a read that fitted says so rather than staying silent — got: ${fitted.text}`);
    ok(!/ceiling rather than a market/.test(fitted.text), "and does NOT carry the truncation caveat, which would make every read look capped");

    const unstated = await ceilingNote({ v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: [alertRow] });
    ok(/was not recorded/.test(unstated.text), `a payload predating the fields says the ceiling was not recorded — got: ${unstated.text}`);
    ok(!/under the vendor's ceiling/.test(unstated.text),
       "and specifically does NOT claim the read came in under it: `!undefined` is true, so the naive test would have " +
       "stated a measurement this run never made");
    ok(/may be a ceiling rather than a market/.test(unstated.text),
       "it warns rather than reassures, because an unmeasured cap is closer to a cap than to a clean read");

    const read = async (unusual, alerts, options, pressLabel) => {
      if (unusual !== null) await put("unusual", unusual);
      if (alerts !== null) await put("flowalerts", alerts);
      const p = await newPage(options);
      await load(p);
      if (pressLabel) await press(p, pressLabel);
      const out = await p.evaluate(() => ({
        status: document.getElementById("uaStatus").textContent,
        statusMark: document.getElementById("uaStatus").getAttribute("data-empty"),
        feedMark: document.getElementById("uaFeedCard").dataset.state,
        nameMark: document.getElementById("uaSurpriseCard").dataset.state,
        alertMark: document.getElementById("uaTimelineCard").dataset.state,
        filterNote: document.getElementById("uaFilterNote").textContent,
      }));
      out.feedWhy = await why(p, "uaFeedCard");
      out.nameWhy = await why(p, "uaSurpriseCard");
      out.feedPop = await info(p, "uaFeedCard");
      out.namePop = await info(p, "uaSurpriseCard");
      out.alertsPop = await info(p, "uaTimelineCard");
      await p.close();
      return out;
    };

    const BASIS = { unit: "A contract counter, and not a trade.", date: "no date parameter, the span is unobserved" };
    const LIVE_ALERTS = {
      v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", refreshed: "nightly",
      seen: 4, shed: 0, cap: 50, rows: [{ t: "AAPL", cp: "C", k: 200, exp: "2026-09-18", prem: 1000, size: 5, trades: 1 }],
    };

    const noContracts = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 2,
      coverage: [{ t: "AAA", rows: 400 }],
      names: { rows: [], universe: 2, ranked: 2, unranked: 0, shown: 0 },
      basis: BASIS,
    }, LIVE_ALERTS);
    eq(noContracts.statusMark, "unavailable",
       "A PAYLOAD WITH NO `contracts` BLOCK IS THE UNAVAILABLE SILENCE on the status line");
    ok(!/\d/.test(noContracts.status),
       `AND IT CARRIES NO DIGIT. "0 contracts from 0 names" is three counts taken off a block that is not on the wire — got: ${noContracts.status}`);
    eq(noContracts.feedMark, "unavailable", "and the feed module wears the unavailable glyph rather than the quiet one");
    ok(!/floors/.test(String(noContracts.feedPop)),
       `with no disclosure counting a population that was never published — got: ${noContracts.feedPop}`);
    ok(!/Both tables show every row published/.test(noContracts.filterNote),
       `THE REASSURANCE MAY NOT OUTLIVE THE FEED IT REASSURES ABOUT — got: ${noContracts.filterNote}`);
    ok(/contracts are not on this payload/.test(noContracts.filterNote),
       `and the unpressed note names the silence in the same words the filtered one uses — got: ${noContracts.filterNote}`);

    const noContractsFiltered = await read(null, null, null, "Calls");
    ok(/contracts are not on this payload/.test(noContractsFiltered.filterNote),
       `and the filter note names the absence rather than reporting "0 of 0 contracts are drawn" — got: ${noContractsFiltered.filterNote}`);
    ok(!/of 0 contracts are drawn/.test(noContractsFiltered.filterNote), "which is the same displayed zero the alerts side already refuses");
    ok(!/could not be read/.test(noContractsFiltered.filterNote),
       "and it is NOT the broken-read sentence either: this payload arrived intact, and the two silences have to stay two");
    eq(noContractsFiltered.feedMark, "unavailable",
       "AND PRESSING A FILTER DOES NOT ERASE THE WITHHOLDING: the module still says why it is empty");

    const brokenContracts = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 2,
      contracts: { shown: 50, eligible: 5953, cap: 50, perName: 2, capBound: "rows", rows: null },
      coverage: [{ t: "AAA", rows: 400 }],
      names: { rows: [], universe: 2, ranked: 2, unranked: 0, shown: 0 },
      basis: BASIS,
    }, LIVE_ALERTS);
    eq(brokenContracts.statusMark, "unreadable",
       "A CONTRACTS BLOCK WITH NO ROWS ARRAY IS UNREADABLE, NOT UNAVAILABLE: published bytes this page could not parse");
    eq(brokenContracts.feedMark, "withheld",
       "and the module wears the withheld glyph rather than the unavailable one that says a field is missing");
    ok(brokenContracts.feedMark !== noContracts.feedMark && brokenContracts.statusMark !== noContracts.statusMark,
       "which is the whole point: the two shapes are two silences, on the status and on the module");
    ok(!/carries no contracts block/.test(brokenContracts.status),
       `AND THE STATUS STATES NO FALSEHOOD ABOUT THE WIRE — got: ${brokenContracts.status}`);
    ok(/no rows array/.test(brokenContracts.status), `it says what was read instead — got: ${brokenContracts.status}`);
    ok(/no rows array/.test(String(brokenContracts.feedWhy)), "and the module's Why says the same");
    ok(!/\d/.test(brokenContracts.status),
       `and still carries no digit: an unreadable list is not a licence to print the counts beside it — got: ${brokenContracts.status}`);
    const brokenFiltered = await read(null, null, null, "Calls");
    ok(/contracts could not be read/.test(brokenFiltered.filterNote),
       `and the filter note words it as the broken read it is — got: ${brokenFiltered.filterNote}`);
    ok(!/contracts are not on this payload/.test(brokenFiltered.filterNote), "and never as the absence");

    const noNames = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 1,
      contracts: { rows: [contract("AAA", "C", 100, "2026-09-18", 900, "long")], shown: 1, eligible: 1, cap: 60, perName: 30, capBound: "eligible" },
      coverage: [{ t: "AAA", rows: 400 }],
      basis: BASIS,
    }, LIVE_ALERTS);
    eq(noNames.nameMark, "unavailable", "A MISSING NAME PANEL IS UNAVAILABLE, NOT QUIET");
    ok(!/thirty-day average/.test(String(noNames.nameWhy)), `so the quiet sentence specifically does not appear — got: ${noNames.nameWhy}`);
    ok(!/Ranked/.test(String(noNames.namePop)), `and no disclosure ranks 0 of 0 names — got: ${noNames.namePop}`);
    eq(noNames.statusMark, null, "while the status line, whose contracts DID arrive, carries no mark at all");
    ok(/\b1 contracts? from 1 name\b/.test(noNames.status), `and still states its own count — got: ${noNames.status}`);
    ok(!/No name was ranked/.test(String(noNames.nameWhy)), `AND THE REPLACEMENT SENTENCE ASSERTS ONLY WHAT THE GUARD READ — got: ${noNames.nameWhy}`);
    ok(/Both tables show every row published/.test(noNames.filterNote),
       "while a page whose two feeds both answered keeps its reassurance");

    const brokenNames = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 1,
      contracts: { rows: [contract("AAA", "C", 100, "2026-09-18", 900, "long")], shown: 1, eligible: 1, cap: 60, perName: 30, capBound: "eligible" },
      coverage: [{ t: "AAA", rows: 400 }],
      names: { ranked: 40, universe: 420, unranked: 0, shown: 40, rows: null },
      basis: BASIS,
    }, LIVE_ALERTS);
    eq(brokenNames.nameMark, "withheld", "A NAME PANEL WHOSE ROWS COULD NOT BE READ IS WITHHELD, NOT UNAVAILABLE");
    ok(!/No name was ranked/.test(String(brokenNames.nameWhy)), `and specifically does not report the run — got: ${brokenNames.nameWhy}`);
    ok(/no rows array/.test(String(brokenNames.nameWhy)), `it names what could not be read instead — got: ${brokenNames.nameWhy}`);

    const quiet = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "quiet", namesSeen: 2,
      contracts: { rows: [], shown: 0, eligible: 0, cap: 60, perName: 30, capBound: "eligible" },
      coverage: [{ t: "AAA", rows: 400 }],
      names: { rows: [], universe: 2, ranked: 0, unranked: 2, shown: 0 },
      basis: BASIS,
    }, LIVE_ALERTS);
    eq(quiet.statusMark, "quiet", "A CHAIN THAT CLEARED NOTHING IS THE ONE SILENCE THAT IS A READING");
    eq(quiet.feedMark, "quiet", "and the feed module says so");
    eq(quiet.nameMark, "quiet", "and the name panel's, where every count IS measured and every one of them is zero");
    ok(/cleared both floors/.test(String(quiet.feedWhy)), `with the sentence that says whose chains those were — got: ${quiet.feedWhy}`);

    const unlabelled = await read({
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31",
      readAt: "2026-09-01T06:00:00Z", status: "ok", namesSeen: 2,
      contracts: { rows: [], shown: 0, eligible: 0, cap: 60, perName: 30, capBound: "eligible" },
      coverage: [{ t: "AAA", rows: 400 }],
      names: { rows: [], universe: 2, ranked: 0, unranked: 2, shown: 0 },
      basis: BASIS,
    }, LIVE_ALERTS);
    eq(unlabelled.statusMark, "quiet", "an empty rows array is the measured emptiness whether or not the payload also stamped itself quiet");
    eq(unlabelled.feedMark, "quiet", "and the module agrees with the status above it");
    ok(/did not report the read as quiet/.test(String(unlabelled.feedWhy)), `while the SENTENCE still separates the two — got: ${unlabelled.feedWhy}`);

    const alertsPending = await read(null, { v: 2, status: "pending" });
    eq(alertsPending.alertMark, "pending", "AN UNPUBLISHED KEY IS PENDING: the dotted ring, the one silence that says come back");
    const alertsBroken = await read(null, { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: null });
    eq(alertsBroken.alertMark, "withheld", "a payload that arrived and carries no rows array is WITHHELD — published bytes the page could not read");
    const alertsQuiet = await read(null, { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", refreshed: "nightly", seen: 0, shed: 0, cap: 50, rows: [] });
    eq(alertsQuiet.alertMark, "quiet", "and a read the vendor's rules flagged nothing in is QUIET, not broken");
    const alertsQuietFiltered = await read(null, null, null, "Calls");
    eq(alertsQuietFiltered.alertMark, "quiet", "AND PRESSING A FILTER DOES NOT ERASE THE ALERTS SIDE'S SILENCE EITHER");

    const unusualPending = await read({ v: 2, status: "pending" }, LIVE_ALERTS);
    eq(unusualPending.statusMark, "pending", "THE STORE'S ORDINARY FIRST STATE IS PENDING on this key exactly as on the alerts key");

    const dead = await newPage();
    await dead.route("**/api/flows/unusual", (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "no" }));
    await dead.route("**/api/flows/flowalerts", (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "no" }));
    await load(dead);
    const broke = await dead.evaluate(() => ({
      statusMark: document.getElementById("uaStatus").getAttribute("data-empty"),
      states: [...document.querySelectorAll(".fd-mod")].map((m) => m.id + ":" + m.dataset.state),
      filterNote: document.getElementById("uaFilterNote").textContent,
    }));
    const deadFeedPop = await info(dead, "uaFeedCard");
    await dead.close();
    eq(broke.statusMark, "unreadable", "the status wears the broken mark when the fetch died");
    deep(broke.states, ["uaTimelineCard:unavailable", "uaNamesCard:unavailable", "uaUrgencyCard:unavailable", "uaFeedCard:unavailable", "uaSurpriseCard:unavailable"],
       "and every module wears the unavailable glyph — not delivered — rather than any of them going quiet");
    ok(/could not be read either/.test(String(deadFeedPop)),
       "and the feed's method disclosure fails with it, rather than reading as though the method were withheld");
    ok(/flagged windows could not be read/.test(broke.filterNote) && /contracts could not be read/.test(broke.filterNote),
       `while the filter note counts neither — got: ${broke.filterNote}`);

    const NY = await read(null, LIVE_ALERTS, { timezoneId: "America/New_York" });
    ok(/Read2026-09-01 06:00 UTC/.test(String(NY.alertsPop)),
       `THE STAMP IS THE READ INSTANT IN UTC, the same for a New York reader — got: ${String(NY.alertsPop).slice(0, 120)}`);
    ok(!/\b02:00\b/.test(String(NY.alertsPop)), "and specifically not the local wall clock");
    eq((String(NY.alertsPop).match(/Read\d/g) || []).length, 1,
       "and it is stated ONCE: two Read lines on one panel invite the reading that they are two reads");
    ok(/vendor's own stated span/.test(String(NY.alertsPop)), "keeping the fact owed the reader, which is the unit those spans are in");

    const shedNone = await read(null, { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", seen: 4, shed: 0, cap: 50, rows: [{ t: "AAPL", cp: "C", k: 200, exp: "2026-09-18", prem: 1000 }] });
    const shedUnknown = await read(null, { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", seen: 4, cap: 50, rows: [{ t: "AAPL", cp: "C", k: 200, exp: "2026-09-18", prem: 1000 }] });
    ok(/Shed by the row capnot recorded on this payload/.test(String(shedUnknown.alertsPop)),
       `AN UNCOUNTED SHED SAYS SO rather than turning an absent count into a measured zero — got: ${shedUnknown.alertsPop}`);
    ok(/Shed by the row cap0/.test(String(shedNone.alertsPop)) && !/Shed by the row capnot recorded/.test(String(shedNone.alertsPop)),
       "while a read the cap genuinely did not touch states its measured zero");
    ok(shedNone.alertsPop !== shedUnknown.alertsPop, "which is the whole point: the two disclosures must differ");

    const atCeiling = await read(null, { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", seen: 200, shed: 199, cap: 50, vendorLimit: 200, vendorTruncated: true, rows: [{ t: "AAPL", cp: "C", k: 200, exp: "2026-09-18", prem: 1000 }] });
    ok(/of at least 200 flagged windows/.test(String(atCeiling.alertsPop)),
       `THE DENOMINATOR IS A FLOOR WHEN THE READ HIT THE VENDOR'S LIMIT — got: ${atCeiling.alertsPop}`);
    ok(!/of at least/.test(String(shedNone.alertsPop)), "while a read that did not hit the ceiling keeps its exact denominator");

    await put("flowalerts", { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", rows: [
      { t: "AAA", cp: "C", k: 100, exp: "2026-09-18", prem: 250000, askPrem: 250000, spanStart: "2026-09-01T13:31:00Z" },
      { t: "BBB", cp: "P", k: 50, exp: "2026-09-18", prem: 180000, spanStart: "2026-09-01T14:10:00Z" },
    ] });
    const askless = await newPage();
    await load(askless);
    const marks = await askless.evaluate(() => ({
      bubbles: [...document.querySelectorAll("#uaTimeline .fu-b")].map((b) => ({ fill: b.getAttribute("fill-opacity"), dash: b.getAttribute("stroke-dasharray") })),
      keys: [...document.querySelectorAll("#uaTimeline .ui-legend .ui-key")].map((k) => k.textContent),
    }));
    await askless.close();
    const solid = marks.bubbles.find((b) => !b.dash), open = marks.bubbles.find((b) => b.dash);
    ok(solid && Number(solid.fill) > 0.8, `a window the vendor put wholly at the ask is drawn solid (${JSON.stringify(marks.bubbles)})`);
    ok(open && Number(open.fill) === 0,
       "AND A WINDOW WITH NO ASK-SIDE PREMIUM ON IT IS NOT DRAWN AS A LOW ASK SHARE. The fill used to stand a null in " +
       "for a fifth of the premium, which is the ring the legend reads as dollars that were not at the ask — a reading " +
       "the vendor never sent — so it is an open dashed outline instead");
    ok(marks.keys.includes("Ask not stated"), `with a key of its own, only when such a window is drawn (${marks.keys.join(", ")})`);
    ok(!marks.keys.some((k) => /bid/i.test(k)),
       "and no key names the bid: a thin fill means the premium was not attributed to the ask, which is not a claim " +
       "that it was attributed to the bid");

    const urgent = { v: 2, status: "ok", readAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31", rows: [
      { t: "CCC", cp: "C", k: 40, exp: "2026-09-18", prem: 900000, askPrem: 900000, spanStart: "2026-09-01T13:40:00Z", st: "board:short" },
      { t: "AAA", cp: "C", k: 100, exp: "2026-09-18", prem: 250000, askPrem: 250000, spanStart: "2026-09-01T13:31:00Z", st: "board:long" },
    ] };
    await put("flowalerts", urgent);
    await put("unusual", {
      v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31", status: "ok",
      contracts: { rows: [contract("AAA", "C", 100, "2026-09-18", 900, "long")], shown: 1, eligible: 1, cap: 60, perName: 30, capBound: null },
      coverage: [{ t: "AAA", rows: 400 }], namesSeen: 1, dteAnchor: "sessionDate",
      names: { rows: [], universe: 1, ranked: 1, unranked: 0, shown: 0, earningsGated: 0 },
      basis: { unit: "A contract counter, and not a trade.", date: "no date parameter, the span is unobserved, readAt is when it was read" },
    });
    await put("card-x:AAA", { v: 1, ticker: "AAA", sessionDate: "2026-08-31", depth: "deep",
      alerts: { status: "ok", why: null, asOf: "2026-08-31", n: 4, complete: true, prem: 250000, sweepShare: 0.5, urgency: 0.02, dots: [] } });
    const deepOnly = await newPage();
    await load(deepOnly);
    await deepOnly.waitForFunction(() => document.querySelectorAll("#uaUrgency .fu-urow:not(.fu-head)").length > 0);
    const urg = await deepOnly.evaluate(() => ({
      names: [...document.querySelectorAll("#uaUrgency .fu-urow:not(.fu-head) .fu-tk b")].map((b) => b.textContent),
      marks: document.querySelectorAll('#uaUrgency [data-state="unavailable"]').length,
      card: document.getElementById("uaUrgencyCard").dataset.state,
    }));
    await deepOnly.close();
    deep(urg.names, ["AAA"],
      "urgency ranks only the board names the run went deep on — the counter feed's coverage — because only " +
      "they carry an alert tape; CCC out-premiums AAA but is a cross-section name, and six such rows used to " +
      "fill the module with a dash and the unavailable mark each");
    eq(urg.marks, 0, "so no row in it wears the unavailable mark");
    ok(urg.card !== "unavailable", `and the module is not marked unavailable (${urg.card})`);

    await put("flowalerts", { ...urgent, rows: urgent.rows.filter((r) => r.t === "CCC") });
    const noDeep = await newPage();
    await load(noDeep);
    await noDeep.waitForSelector("#uaUrgency .ui-silent");
    eq(await noDeep.$eval("#uaUrgency .ui-silent", (n) => n.dataset.state), "quiet",
      "and a session whose flagged board names are all cross-section reads as quiet, not as a wall of missing tapes");
    await noDeep.close();

    const urgencyOf = async () => {
      const pg = await newPage();
      await load(pg);
      await pg.waitForFunction(() => {
        const rows = document.querySelectorAll("#uaUrgency .fu-urow:not(.fu-head)");
        return rows.length > 0 && ![...rows].some((r) => /Pending/.test(r.textContent));
      });
      const out = await pg.evaluate(() => ({
        names: [...document.querySelectorAll("#uaUrgency .fu-urow:not(.fu-head) .fu-tk b")].map((b) => b.textContent),
        stale: document.querySelectorAll('#uaUrgency [data-state="stale"]').length,
        bad: document.querySelectorAll('#uaUrgency [data-state="unavailable"], #uaUrgency [data-state="pending"]').length,
        card: document.getElementById("uaUrgencyCard").dataset.state,
      }));
      await pg.close();
      return out;
    };
    await put("flowalerts", { ...urgent, sessionDate: "2026-09-01" });
    const liveDay = await urgencyOf();
    deep(liveDay.names, ["AAA"], "with the alerts read live a session ahead of the nightly, urgency still draws the deep name");
    eq(liveDay.stale, 0,
      "and does not mark its tape stale: card-x tapes are nightly, so a tape dated the nightly session is the newest " +
      "that can exist, and measuring it against the live alerts' date marked every row stale every trading day");
    eq(liveDay.card, "ok", "and the module header reads ok, not quiet");

    await put("card-x:AAA", { v: 1, ticker: "AAA", sessionDate: "2026-08-28", scope: "deep",
      alerts: { status: "ok", why: null, asOf: "2026-08-28", n: 4, complete: true, prem: 250000, sweepShare: 0.5, urgency: 0.02, dots: [] } });
    const oldTape = await urgencyOf();
    ok(oldTape.stale >= 1, `a tape older than the nightly session the page shows is marked stale (${oldTape.stale})`);
    eq(oldTape.card, "stale",
      "and the header says stale, not the quiet glyph with a staleness reason behind it, when every row has a value");

    await put("card-x:AAA", { v: 1, ticker: "AAA", sessionDate: "2026-08-31", scope: "deep",
      alerts: { status: "ok", why: null, asOf: "2026-08-31", n: 4, complete: true, prem: 250000, sweepShare: 0.5, urgency: 0.02, dots: [] } });
    await put("card-x:CCC", { v: 1, ticker: "CCC", sessionDate: "2026-08-31", scope: "carded" });
    await put("unusual", { v: 2, generatedAt: "2026-09-01T06:00:00Z", sessionDate: "2026-08-31", status: "ok" });
    const noCov = await urgencyOf();
    deep(noCov.names, ["AAA"],
      "without the counter feed's coverage, a candidate whose card-x says it is not deep and carries no tape is " +
      "dropped instead of drawn as a dash with the unavailable mark");
    eq(noCov.bad, 0, "so no row in it is unavailable or pending once the cards are read");
    eq(noCov.card, "ok", `and the header is ok (${noCov.card})`);
  } finally {
    await browser.close();
    await server.stop();
  }
}

{
  const two = poolOiBasis([{ seen: 2, exceeded: 2 }]);
  eq(two.verdict, "thin",
     "two contracts are not a sample: run 64 logged 2 of 2 NOT aligned and run 66 0 of 2 " +
     "INCONCLUSIVE off one chain each, and the verdict flipped with nothing but the hour");
  ok(/draws none/.test(two.line), `and the line says it draws no verdict (${two.line.slice(0, 80)})`);
  eq(poolOiBasis([]).verdict, "no-data", "nothing measured is no data, not a thin sample");

  const pooled = poolOiBasis([
    { seen: 2, exceeded: 2 }, { seen: 20, exceeded: 1 }, { seen: 18, exceeded: 0 }, null, { seen: 0 },
  ]);
  eq(pooled.chains, 3, "the check pools every chain that measured anything");
  eq(pooled.seen, 40, "their contracts together");
  eq(pooled.verdict, "falsified", `and over ${OI_BASIS_MIN_SEEN} of them one exceedance is a falsification`);
  eq(pooled.exceedShare, 0.075, "with the share across every chain published beside it");
  ok(/across 3 chains/.test(pooled.line) && /NOT aligned/.test(pooled.line), pooled.line.slice(0, 90));
  eq(poolOiBasis([{ seen: 40, exceeded: 0 }]).verdict, "inconclusive",
     "and none over the floor is inconclusive, never confirmation");
  for (const line of [two.line, pooled.line]) {
    UA_BANNED_CLAIMS.lastIndex = 0;
    ok(!UA_BANNED_CLAIMS.test(line), `the pooled line makes no banned claim (${line.slice(0, 50)})`);
  }

  const basis = PAYLOAD.basis.oiBasis;
  ok(basis && basis.chains > 0 && basis.seen >= basis.exceeded,
     "the unusual payload carries the pooled check, not one chain's pair");
  ok(["thin", "falsified", "inconclusive", "no-data"].includes(basis.verdict),
     `with one of its four verdicts (${basis.verdict})`);
  ok(PAYLOAD.coverage.every((x) => Number.isInteger(x.pages) && x.pages >= 1),
     "and every coverage entry says how many pages of its chain were read");
  ok(PAYLOAD.coverage.some((x) => x.pages > 1 && x.p === 0),
     "one of them read past its first full page to the end of the book, and is not flagged partial");
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
  `browser at 320px — two payloads joined on the four-tuple they share with a mark that fires on exactly the one contract both selections chose and a timeline that lights exactly its one window when the join is pressed, a filter group both feeds honour whose note keeps a narrowed list from reading as a thin market, a timeline drawn one viewBox unit to one CSS pixel whose keyboard reads the first window in time order, a filter note that says which feed could not be read rather than counting it as zero, and the silences kept apart: a payload with no contracts block marked unavailable and carrying no digit, rows that could not be read marked withheld and unreadable, a missing name panel that is not a quiet market, a chain that cleared nothing marked as the reading it is, the alerts key's pending, withheld and quiet states each with its own glyph, one read instant stated once in UTC, an uncounted row-cap shed that says so instead of printing a zero, a denominator that prints as a floor when the read hit the vendor's own ceiling, a reassurance that does not outlive the feed it reassures about, filters that never erase a module's silence, and a fetch that never answered marking every module unavailable rather than any of them going quiet`);
