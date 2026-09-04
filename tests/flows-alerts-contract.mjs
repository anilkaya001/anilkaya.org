/* =============================================================
   flows-alerts-contract.mjs — the vendor's flow alerts, shaped.

   WHAT IS WORTH ASSERTING. This module sits between a vendor feed
   whose field set was established by probe (three live runs, not
   documentation) and a page whose predecessor panel is BUILT on the
   refusal to say "trade". The expensive defects are all quiet
   category confusions:

     - an absent vendor flag read as FALSE (the vendor not asking is
       not the vendor answering no);
     - a row with nothing measurable shaped into a row of dashes;
     - the vendor's selection presented as the market's ranking;
     - prose that drifts into claims the data cannot support.

   The tie-break fixture below exists because the FIRST draft of the
   sort had `x || y < z ? -1 : 1` — precedence made the whole chain a
   truthiness test — and only a fixture with two null-premium rows of
   different sizes can see that class of bug at all.
   ============================================================= */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  alertRow, buildFlowAlerts, ALERT_ROWS, ALERTS_NOTES,
  alertBand, ALERT_BAND_ROWS,
  alertKey, mergeAlerts, MERGED_ALERT_ROWS, MERGED_ALERT_BYTES,
} from "../shared/flows-alerts.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const stageOf = (t) => (t === "AAA" ? "deep" : t === "BBB" ? "gated" : null);

/* ---------- §1 one row, shaped ------------------------------------ */
{
  const row = alertRow({
    ticker: "AAA",
    option_chain: "AAA260918C00150000",
    total_premium: "125000.5",
    total_size: 400,
    trade_count: 7,
    total_ask_side_prem: 100000,
    total_bid_side_prem: 20000,
    has_sweep: true,
    has_floor: false,
    open_interest: 1200,
    volume_oi_ratio: 2.5,
    iv_start: 0.41, iv_end: 0.44,
    underlying_price: 148.2,
    start_time: "2026-08-28T14:31:02Z", end_time: "2026-08-28T14:33:40Z",
    alert_rule: "RepeatedHits",
  }, { stageOf });

  eq(row.cp, "C", "call/put comes off the option symbol, through the same parser " +
    "the premium desk uses — one spelling of one relation");
  eq(row.k, 150, "and so does the strike");
  eq(row.exp, "2026-09-18", "and the expiry");
  eq(row.prem, 125000.5, "the vendor's premium survives as a number");
  eq(row.sweep, true, "a sent flag is carried");
  eq(row.floor, false, "false is carried AS false — the vendor looked and found none");
  eq(row.single, null,
    "AND AN ABSENT FLAG IS NULL, NOT FALSE — the vendor not carrying the field " +
    "is a different fact from the vendor answering no, and collapsing them " +
    "would print a confident “no” nobody measured");
  eq(row.st, "deep", "the board-funnel stage rides on the row");
  eq(alertRow({ ticker: "ZZZ", total_premium: 1 }, { stageOf }).st, "foreign",
    "a name the funnel never saw is foreign, not a dash");
}

/* ---------- §2 unusable rows are counted, not dashed -------------- */
{
  eq(alertRow({ option_chain: "AAA260918C00150000", total_premium: 5 }), null,
    "no ticker, no row");
  eq(alertRow({ ticker: "AAA", alert_rule: "X", has_sweep: true }), null,
    "a row with no premium, no size and no count measures nothing this surface " +
    "publishes — shaped, it would be a row of dashes wearing a sweep flag");
  const zero = alertRow({ ticker: "AAA", total_premium: 0 });
  ok(zero && zero.prem === 0,
    "but a MEASURED zero premium is a measurement and the row survives");
}

/* ---------- §3 ranking inside the vendor's selection -------------- */
{
  const built = buildFlowAlerts([
    { ticker: "CCC", total_premium: 50 },
    { ticker: "AAA", total_premium: 900 },
    { ticker: "DDD", trade_count: 3, total_size: 10 },      // no premium
    { ticker: "BBB", total_premium: 900 },                   // tie with AAA
    { ticker: "EEE", trade_count: 2, total_size: 90 },       // no premium, bigger
    { ticker: null, total_premium: 5 },                      // unusable
  ], { stageOf });

  deep(built.rows.map((r) => r.t), ["AAA", "BBB", "CCC", "EEE", "DDD"],
    "premium descending with a TOTAL tie-break; rows the vendor sent without a " +
    "premium rank after every row that has one, by size then name — the first " +
    "draft's precedence bug made this exact ordering random, which is why the " +
    "fixture holds two null-premium rows of different sizes");
  eq(built.seen, 5, "seen counts the usable rows");
  eq(built.unusable, 1, "and the unusable one is counted, not vanished");
  eq(built.coverage.withPremium, 3, "coverage says how many rows the ranking " +
    "actually ranked");
  eq(built.status, "ok", "rows present is ok");
  eq(JSON.stringify(buildFlowAlerts([
    { ticker: "CCC", total_premium: 50 },
    { ticker: "AAA", total_premium: 900 },
    { ticker: "DDD", trade_count: 3, total_size: 10 },
    { ticker: "BBB", total_premium: 900 },
    { ticker: "EEE", trade_count: 2, total_size: 90 },
    { ticker: null, total_premium: 5 },
  ], { stageOf })), JSON.stringify(built),
    "two builds over one response publish identical bytes");
}

/* ---------- §4 the cap and its shed ------------------------------- */
{
  const many = [];
  for (let i = 0; i < ALERT_ROWS + 7; i++) {
    many.push({ ticker: "T" + String(100 + i), total_premium: 1000 - i });
  }
  const built = buildFlowAlerts(many);
  eq(built.rows.length, ALERT_ROWS, "the cap holds");
  eq(built.shed, 7, "and what it removed is counted beside what it kept");
  eq(built.cap, ALERT_ROWS, "with the cap itself published — a capped list that " +
    "does not say so invites reading the cap as the population");
  eq(built.rows[0].prem, 1000, "the shed takes the smallest premiums, never the largest");
}

/* ---------- §5 flags in coverage count ONLY the affirmative ------- */
{
  const built = buildFlowAlerts([
    { ticker: "AAA", total_premium: 3, has_sweep: true },
    { ticker: "BBB", total_premium: 2, has_sweep: false },
    { ticker: "CCC", total_premium: 1 },                     // flag absent
  ]);
  eq(built.coverage.sweeps, 1,
    "the sweep count counts true and only true — counting an absent flag either " +
    "way would manufacture a measurement the vendor never sent");
}

/* ---------- §6 empty is quiet, said in a word --------------------- */
{
  const built = buildFlowAlerts([]);
  eq(built.status, "quiet", "an empty response reports quiet");
  deep(built.rows, [], "with no rows");
  eq(built.notes, ALERTS_NOTES, "and the notes still ride, because the page's " +
    "basis panel must explain the surface even when it is empty");
}

/* ---------- §6b the movers band cut from the same rows ------------
   The band exists because the movers' premium lists are byName and a
   stale comment said contract-level needed an endpoint "this key does
   not reach". It is cut from ALREADY-RANKED rows, so its one honest
   job is subsetting without re-ordering and without inventing rank
   for rows the ranking could not place. */
{
  const built = buildFlowAlerts([
    { ticker: "AAA", option_chain: "AAA260918C00150000", total_premium: 900, has_sweep: true },
    { ticker: "BBB", total_premium: 500 },
    { ticker: "CCC", trade_count: 3, total_size: 10 },        // no premium
  ]);
  const band = alertBand(built.rows, { cap: 2 });
  deep(band.rows.map((r) => r.t), ["AAA", "BBB"],
    "the band keeps the ranking's own order and only rows the ranking could place " +
    "— a row without a premium cannot appear in a premium band");
  eq(band.seen, 2, "seen counts the priced rows, not the whole feed");
  eq(band.shed, 0, "nothing shed at this cap");
  eq(band.basis, "vendor-flagged windows",
    "and the basis names the vendor's selection so no renderer can relabel it " +
    "as the market's largest");
  eq(band.rows[0].sweep, true, "the sweep flag rides");
  eq(band.rows[0].k, 150, "with the parsed contract");
  ok(!("askPrem" in band.rows[0]),
    "the band is a subset of fields on purpose — it is a caption panel, not a " +
    "second copy of the feed");
  eq(alertBand(built.rows).cap, ALERT_BAND_ROWS, "the default cap is the published constant");
  deep(alertBand(null).rows, [], "and junk input is an empty band, not a throw");
}

/* ---------- §7 the vocabulary holds in the payload's own prose ----
   The unusual page's ban exists because its counter cannot support the
   claims; THIS surface supports more (a size, a span, a side) and still
   not these. The notes are scanned with NO allow-list: the prose was
   written to need no exception, and an edit that introduces one should
   have to come here and argue for it. */
{
  const BAN = /\b(print|trade|block|bought|sold|paid|whale|smart money|institutional|fill)\b/gi;
  const scan = (value, at) => {
    if (typeof value === "string") {
      BAN.lastIndex = 0;
      const m = BAN.exec(value);
      ok(!m, `${at} says "${m && m[1]}" — a claim this feed cannot support: rows are ` +
        "vendor-flagged windows, not executions, and carry no identity");
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) scan(v, `${at}.${k}`);
    }
  };
  scan(ALERTS_NOTES, "notes");
  ok(/vendor's rules chose to flag/.test(ALERTS_NOTES.selection),
    "and the selection caveat — the population is the vendor's choice, not the " +
    "market's ranking — is stated in those words, because it is the headline " +
    "fact about this feed");
}

/* ---------- the envelope both writers must survive -----------------
   THE DEFECT THIS SECTION EXISTS FOR. Two writers publish the `flowalerts`
   key: the nightly pipeline, whose uw() unwraps `body.data` before calling;
   and the worker's fifteen-minute cron, whose uwFetch() returns the parsed
   body verbatim. This suite only ever fed the shaper a bare array — the one
   shape the CRON NEVER SENDS — so the shaper's `Array.isArray` guard silently
   iterated nothing on every intraday refresh, and the unguarded write put a
   well-formed empty feed over sixty real rows. The Overview then reported
   "FLAGGED WINDOWS 0" across 569 screened names: a confident claim about the
   market, manufactured by a type check, wearing the provenance "refreshed
   intraday". Both envelopes are now fed to the one shaper here. */
{
  const rows = [
    { ticker: "AAA", option_chain: "AAA260918C00100000", total_premium: "900000",
      rule_name: "RepeatedHits", strike: "100", expiry: "2026-09-18", type: "call" },
    { ticker: "BBB", option_chain: "BBB260918P00050000", total_premium: "400000",
      rule_name: "SteadyAccumulation", strike: "50", expiry: "2026-09-18", type: "put" },
  ];

  const bare = buildFlowAlerts(rows, { stageOf: () => "board:long" });
  const wrapped = buildFlowAlerts({ data: rows }, { stageOf: () => "board:long" });

  eq(wrapped.rows.length, bare.rows.length,
    "THE VENDOR ENVELOPE SHAPES IDENTICALLY TO A BARE ARRAY. The cron hands this " +
    "shaper {data:[...]} and the pipeline hands it the unwrapped array; a shaper " +
    "that reads only one of them turns the other writer into a zeroing machine");
  eq(JSON.stringify(wrapped), JSON.stringify(bare),
    "byte-identical, so which writer ran cannot be inferred from the payload — " +
    "and cannot change it either");
  eq(wrapped.status, "ok", "and the wrapped read is ok rather than quiet");
  eq(wrapped.seen, 2, "with every row counted");

  eq(buildFlowAlerts({ data: [] }, { stageOf: () => null }).status, "quiet",
    "a genuinely empty envelope is still QUIET — the unwrap must not manufacture " +
    "rows, only stop discarding them");
  eq(buildFlowAlerts(null, { stageOf: () => null }).status, "quiet",
    "and junk is quiet rather than a throw");
  eq(buildFlowAlerts({ data: "nope" }, { stageOf: () => null }).status, "quiet",
    "as is an envelope whose data is not a list");

  /* The write guard's own condition, asserted where the shaper can see it:
     the cron writes only on `status === "ok" && rows.length`, so these two
     readings are exactly what must keep a stale-but-real feed in place. */
  ok(buildFlowAlerts({ data: [] }, { stageOf: () => null }).rows.length === 0,
    "an empty read publishes no rows, which is the condition the cron's write " +
    "guard tests — better a stale feed with an honest readAt than an empty fresh one");
}

/* ---------- §8 THE SESSION'S RECORD, not the vendor's window ------
   THE DEFECT THIS SECTION EXISTS FOR, and it is a different one from
   §7's. The cron's write was fixed to stop publishing an EMPTY feed
   over a real one; it still published a REPLACEMENT one. The vendor's
   flow-alerts list is a rolling window of its newest flags, so
   `{...prev, ...alerts}` every fifteen minutes meant a name flagged at
   09:31 was gone from the page at 09:46 — not because anything changed
   about the name, but because the vendor's window had rolled past it.
   The page carried a heading a reader reads as "what was flagged
   today" over a body that meant "what was flagged in the last few
   minutes".

   Every assertion below is about a fact a single read cannot state:
   that a window was flagged EARLY, that it was flagged AGAIN, and that
   the record covers one named day and not a smear of two. */

const T1 = "2026-08-28T13:31:00.000Z";   // 09:31 ET
const T2 = "2026-08-28T13:46:00.000Z";   // 09:46 ET, the next cron firing
const T3 = "2026-08-31T13:31:00.000Z";   // the NEXT session
const T4 = "2026-08-28T14:01:00.000Z";   // 10:01 ET, still the same session
const D28 = "2026-08-28", D31 = "2026-08-31";

const win = (t, oc, start, prem, extra = {}) => ({
  ticker: t, option_chain: oc, total_premium: prem,
  start_time: start, end_time: start.replace(":00.000Z", ":40.000Z"),
  alert_rule: "RepeatedHits", ...extra,
});

/* The nightly publish: an envelope with rows and NO record, because the
   pipeline writes one read of a session that has already closed. */
const nightly = {
  v: 1, generatedAt: "2026-08-27T22:04:00.000Z", sessionDate: "2026-08-27",
  readAt: "2026-08-27T22:04:00.000Z", refreshed: "nightly",
  ...buildFlowAlerts([win("OLD", "OLD260918C00100000", "2026-08-27T18:00:00.000Z", 5e6)]),
};

/* ---- the first intraday read of a new day ---- */
const read1 = buildFlowAlerts([
  win("AAA", "AAA260918C00150000", T1, 900000),
  win("BBB", "BBB260918P00050000", T1, 500000),
]);
const merge1 = mergeAlerts(nightly, read1, { at: T1, sessionDate: D28 });
const state1 = { ...nightly, ...merge1, readAt: T1, refreshed: "intraday" };

eq(merge1.record.reset, "cold",
  "the nightly's payload carries no record, so the first intraday read starts one " +
  "rather than adding to rows that describe a session which has already closed");
deep(merge1.rows.map((r) => r.t), ["AAA", "BBB"],
  "AND YESTERDAY'S ROW IS NOT IN IT. A record that silently carries the previous " +
  "session's flags into today publishes them under today's readAt — a fact the day " +
  "never produced, wearing the day's timestamp");
eq(merge1.record.date, D28, "the record names the Eastern day it covers, so the next " +
  "read can tell whether it is the same day at all");
eq(merge1.record.reads, 1, "one read in it");
eq(merge1.rows[0].firstAt, T1, "every row's first sighting is this read");
eq(merge1.rows[0].reads, 1, "seen once");

/* ---- the second read: the window has rolled past AAA ---- */
const read2 = buildFlowAlerts([
  win("BBB", "BBB260918P00050000", T1, 650000),   // same window, restated larger
  win("CCC", "CCC260918C00075000", T2, 300000),   // new this read
]);
const merge2 = mergeAlerts(state1, read2, { at: T2, sessionDate: D28 });
const state2 = { ...state1, ...merge2, readAt: T2 };
const byT = (m) => new Map(m.rows.map((r) => [r.t, r]));
const rows2 = byT(merge2);

ok(rows2.has("AAA"),
  "A NAME FLAGGED AT 09:31 AND ABSENT FROM THE 09:46 WINDOW SURVIVES. This is the " +
  "whole point: the vendor's list rolls, the session's record does not, and the old " +
  "wholesale spread deleted this row every fifteen minutes");
eq(rows2.get("AAA").lastAt, T1,
  "and it survives WITH ITS OWN TIMES — a carried row's last sighting stays the read " +
  "that actually carried it, because advancing it would make the envelope's readAt " +
  "into a per-row claim that no read supports");
eq(rows2.get("AAA").reads, 1, "and its sighting count does not move either");

eq(rows2.get("BBB").firstAt, T1,
  "FIRST-SEEN DOES NOT ADVANCE. “Flagged at 09:31 and again at 09:46” and “flagged " +
  "at 09:46” are different facts and the first is the one an early-warning page is for");
eq(rows2.get("BBB").lastAt, T2, "while last-seen does");
eq(rows2.get("BBB").reads, 2, "and the sighting count increments");
eq(rows2.get("BBB").prem, 650000,
  "the vendor's own numbers come from the LATEST read — an open window restates its " +
  "premium — so only the record's three fields are held back");
eq(rows2.get("CCC").reads, 1, "a window new to this read enters at one sighting");

eq(merge2.record.carried, 1, "one window carried that this read did not contain");
eq(merge2.record.again, 1, "one seen again");
eq(merge2.record.entered, 1, "one new");
eq(merge2.record.reads, 2, "two reads in the record");
eq(merge2.record.firstReadAt, T1, "whose first read is still the 09:31 one");
eq(merge2.record.reset, null, "and nothing was reset — same day, same record");
deep(merge2.rows.map((r) => r.t), ["AAA", "BBB", "CCC"],
  "the union is re-ranked by the SAME premium comparator the nightly build uses, so " +
  "the list cannot reshuffle at 09:15 for a reason no reader could name");
eq(merge2.seen, 3, "and `seen` counts the session's windows, not this read's two — the " +
  "page prints “N of seen flagged windows” and that denominator is now the day's");

/* ---- the session boundary ---- */
{
  const read3 = buildFlowAlerts([win("DDD", "DDD260918C00020000", T3, 100000)]);
  const merge3 = mergeAlerts(state2, read3, { at: T3, sessionDate: D31 });
  eq(merge3.record.reset, "session-boundary",
    "a read from a different Eastern day starts a NEW record rather than adding to " +
    "the old one — the reset is the session boundary and nothing else, because an " +
    "age-based expiry would leave a record that is part today and part yesterday " +
    "with no way to say which rows are which");
  deep(merge3.rows.map((r) => r.t), ["DDD"], "so yesterday's three windows are gone");
  eq(merge3.record.reads, 1, "and the read count starts again");
  eq(merge3.record.firstReadAt, T3, "as does the first-read instant");
  eq(merge3.record.carried, 0, "with nothing carried across the boundary");

  const undated = mergeAlerts(state2, read3, { at: T3, sessionDate: null });
  eq(undated.record.reset, "undated",
    "AND A READ THAT CANNOT NAME ITS DAY ALSO STARTS OVER. A record whose date is " +
    "unknown cannot be compared with the next read's date, so accumulating into it " +
    "would be accumulating into an unnameable day");
  deep(undated.rows.map((r) => r.t), ["DDD"], "so it carries nothing either");
  eq(undated.record.date, null, "and the date it publishes is null, not a guess");
}

/* ---- the ceiling, and which one bit ---- */
{
  const wide = [];
  for (let i = 0; i < 12; i++) {
    wide.push(win("W" + String(100 + i), "W" + (100 + i) + "260918C00010000", T1, 1000 - i));
  }
  const capped = mergeAlerts(null, buildFlowAlerts(wide), { at: T1, sessionDate: D28, cap: 5 });
  eq(capped.rows.length, 5, "the row ceiling holds");
  eq(capped.record.shed, 7, "and what it removed is counted beside what it kept");
  eq(capped.shed, 7, "on the envelope too, where the page's caption reads it");
  eq(capped.record.shedBy, "rows", "WITH THE ORDERING NAMED — a shed whose ordering is " +
    "unstated is a ceiling a reader has to guess at");
  eq(capped.rows[0].prem, 1000, "the shed takes the smallest premiums, never the largest, " +
    "which is the same order the list is ranked in — a cap that shed by a different " +
    "ordering than it displays would hide rows above the fold");
  eq(capped.seen, 12, "and `seen` still names the population the ceiling cut from");
  eq(capped.record.everEntered, 12, "as does the day's running entry count");

  /* THE CEILING COMPOUNDS, which is the reason `everEntered` exists at all:
     the next read merges into the rows this one KEPT, so `union` can never
     exceed cap + one read again however busy the session gets. A reader
     watching `union` alone would see the day's population stop growing at the
     exact moment it started overflowing. */
  const more = [];
  for (let i = 0; i < 4; i++) {
    more.push(win("X" + i, "X" + i + "260918C00010000", T2, 2000 + i));
  }
  const compounded = mergeAlerts(
    { ...capped, record: capped.record }, buildFlowAlerts(more),
    { at: T2, sessionDate: D28, cap: 5 });
  eq(compounded.record.union, 9,
    "the second read unions against the five rows that SURVIVED the first cut, " +
    "never against the twelve the vendor actually flagged");
  eq(compounded.record.kept, 5, "and the ceiling holds again");
  eq(compounded.record.everEntered, 16,
    "BUT THE RUNNING ENTRY COUNT KEEPS MOVING — twelve windows plus four — so the " +
    "day's population is still readable after the ceiling has started shedding");
  eq(compounded.rows[0].t, "X3",
    "with the new read's larger premiums at the top, because the union is re-ranked " +
    "whole rather than appended to");

  const tight = mergeAlerts(null, buildFlowAlerts(wide),
    { at: T1, sessionDate: D28, cap: 500, byteCap: 900 });
  ok(tight.rows.length > 0 && tight.rows.length < 12,
    "the BYTE ceiling is reachable too — the fixture is sized to cross it, because a " +
    "ceiling no fixture can reach certifies nothing");
  eq(tight.record.shedBy, "bytes", "and it says which ceiling bit, since the two shed " +
    "different rows for different reasons");
  ok(tight.record.bytes <= 900, "staying under the ceiling it publishes");
  eq(MERGED_ALERT_ROWS > ALERT_ROWS, true,
    "the record's ceiling is larger than one read's, or a union could never hold more " +
    "than the read that built it");
}

/* ---- identity across reads ---- */
{
  eq(alertKey({ t: null, oc: "X", spanStart: T1 }), null,
    "a row with no ticker has no identity — it can never be found again, so it cannot " +
    "be held");
  ok(alertKey({ t: "AAA", oc: "O", spanStart: T1 }) !== alertKey({ t: "AAA", oc: "O", spanStart: T2 }),
    "TWO WINDOWS ON ONE CONTRACT ARE TWO ALERTS. Keying on (name, contract) alone would " +
    "fuse them and lose the earlier one's first-seen time — the fact the record exists " +
    "to keep");
  eq(alertKey({ t: "AAA", oc: "O", spanStart: T1, prem: 1 }),
     alertKey({ t: "AAA", oc: "O", spanStart: T1, prem: 999 }),
    "while one window restated with new numbers is still that window");

  /* A vendor row with no start_time: nothing is left to identify it by, so those
     collapse per (name, contract, rule) rather than re-entering on every read. */
  const spanless = (rule) => ({ ticker: "SSS", option_chain: "S1", total_premium: 10, alert_rule: rule });
  const s1 = mergeAlerts(null, buildFlowAlerts([spanless("RuleA")]), { at: T1, sessionDate: D28 });
  const s2 = mergeAlerts(s1, buildFlowAlerts([spanless("RuleA")]),
    { at: T2, sessionDate: D28 });
  eq(s2.rows.length, 1, "a spanless row seen twice is ONE row, not two — a row that can " +
    "never be recognised again would re-enter on every read all session and the ceiling " +
    "would eventually shed the rows that are real");
  eq(s2.rows[0].reads, 2, "counted as two sightings");
  const s3 = mergeAlerts(s1, buildFlowAlerts([spanless("RuleB")]),
    { at: T2, sessionDate: D28 });
  eq(s3.rows.length, 2, "but a different rule on the same contract is a different alert");

  /* One read that lists a window twice is one sighting: `reads` is a claim about
     the session, not about the vendor's response shape. */
  const twice = mergeAlerts(null, buildFlowAlerts([
    win("DUP", "DUP260918C00010000", T1, 90),
    win("DUP", "DUP260918C00010000", T1, 90),
  ]), { at: T1, sessionDate: D28 });
  eq(twice.rows.length, 1, "one window listed twice in one read is one row");
  eq(twice.rows[0].reads, 1, "and ONE sighting — counting the vendor's repetition as the " +
    "session's would inflate the number the page leads on");
}

/* ---- a row carried out of an older payload ---- */
{
  /* `undefined !== null` is true, so a stored row missing `prem` would sail past
     the comparator's null test and land in `b.prem - a.prem` as NaN, silently
     randomising the whole ranking. This fixture is the only kind that can see it. */
  const stale = {
    record: { date: D28, reads: 4, firstReadAt: T1 },
    rows: [{ t: "OLD", oc: "OLD1", spanStart: T1, st: "foreign" }],   // no prem, no record fields
  };
  const merged = mergeAlerts(stale, buildFlowAlerts([win("NEW", "NEW1", T2, 42)]),
    { at: T2, sessionDate: D28 });
  deep(merged.rows.map((r) => r.t), ["NEW", "OLD"],
    "a row carried out of a payload written by an older build ranks after every priced " +
    "row instead of poisoning the sort with NaN");
  eq(merged.rows[1].prem, null, "its absent premium normalises to null on the way in — " +
    "absent in, absent out, across a round trip through JSON as well as off the wire");
  eq(merged.rows[1].firstAt, null,
    "and its unknown first sighting is NULL rather than a missing key: an absent key " +
    "and a null are different silences and only the null one can be drawn as “not known”");
  eq(merged.record.reads, 5, "the read count continues from the stored record");
}

/* ---- an empty read never reaches the store ---------------------
   THE GUARD IS AT THE CALL SITE and merging must not weaken it. Two
   assertions, because they certify two different halves: the shaper
   half (an empty read still produces no rows, so the condition the
   cron tests is still reachable) and the WORKER half (that condition
   is still the only path to the write). The second reads worker.js as
   source because that is the only place the guard exists — asserting
   a copy of it here would certify the copy. */
{
  const emptyRead = buildFlowAlerts({ data: [] }, { stageOf: () => null });
  eq(emptyRead.rows.length, 0, "an empty vendor read still shapes to no rows");
  eq(emptyRead.status, "quiet", "and reports quiet");

  const wouldBe = mergeAlerts(state2, emptyRead, { at: T4, sessionDate: D28 });
  eq(wouldBe.rows.length, 3,
    "merging one into the record would no longer DESTROY anything — which is exactly " +
    "why the guard has to be argued for again rather than assumed obsolete");
  eq(wouldBe.record.entered, 0, "nothing entered");
  eq(wouldBe.record.carried, 3, "and everything was carried");

  const worker = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const body = worker.slice(
    worker.indexOf("async function refreshFlowsIntraday"),
    worker.indexOf("async function readFlowsPayload"));
  ok(body.length > 500, "the refresh handler was located in worker.js");
  ok(/alerts\.status === "ok" && alerts\.rows\.length/.test(body),
    "AND THE EMPTY-READ GUARD STILL STANDS. Its absence cost the product its entire " +
    "alerts feed every session once already; the merge is not a reason to drop it, " +
    "because an empty read written into the record would still advance readAt — the " +
    "page's claim about how fresh the rows are — over rows nothing confirmed");
  eq((body.match(/upsert\("flowalerts"/g) || []).length, 1,
    "with exactly one write to the key in the handler, so the guard cannot be routed around");
  /* Positional rather than adjacent: the guard and the write are allowed to have
     the handler's reasoning between them, but the write must be INSIDE the
     branch the guard opens and before the else that logs the refusal. */
  const guardAt = body.indexOf("if (merged && merged.rows.length) {");
  const writeAt = body.indexOf("await upsert(\"flowalerts\"");
  const elseAt = body.indexOf("} else {", guardAt);
  ok(guardAt > 0 && writeAt > guardAt && elseAt > writeAt,
    "and that write sits INSIDE the merge's own emptiness check as well — a ceiling " +
    "that somehow kept nothing must not be able to blank the key either");
  ok(/mergeAlerts\(prev, alerts/.test(body),
    "the handler merges into the STORED payload rather than spreading over it: " +
    "`{...prev, ...alerts}` is the exact expression that deleted the morning's flags");
}

/* ---------- §9 THE MAP THAT COULD NOT ANSWER, AND THE RECORD THAT
   LOST ITS OWN COUNTERS ---------------------------------------------
   Four defects with one shape between them: a value published where the
   truthful answer was "not known". `st` said "foreign" — which the page
   spells out as "the screener never returned this name" — because a map
   that never held the name missed it. The record's own counters rebuilt
   themselves as 0 and as this read's instant when a stored payload
   arrived without them. Each is a fact manufactured out of an absence,
   which is the same defect Number(null) === 0 is. */
{
  /* ---- the partial stage map ---- */
  const one = (t) => ({ ticker: t, option_chain: t + "260918C00100000",
    total_premium: 1e6, start_time: T1, end_time: T2, alert_rule: "RepeatedHits" });

  const whole = buildFlowAlerts([one("ZZZ")], { stageOf: () => null });
  eq(whole.rows[0].st, "foreign",
    "A CALLER WHOSE MAP COVERS THE WHOLE SCREENED UNIVERSE still publishes " +
    "“foreign” on a miss, because for that caller a miss IS the finding — the " +
    "nightly pipeline builds its map from every screened name and the page " +
    "renders the word as “the screener never returned this name”");

  const partial = buildFlowAlerts([one("ZZZ")], { stageOf: () => null, stageComplete: false });
  eq(partial.rows[0].st, null,
    "A CALLER WHOSE MAP IS PARTIAL GETS NULL INSTEAD. The cron rebuilds its map " +
    "from the stages the stored payload already carried, so a name flagged at " +
    "09:31 that was not in last night's sixty rows misses it for a reason that " +
    "has nothing to do with the screener — and publishing “foreign” there is a " +
    "claim about the screener that this read never made");
  eq(partial.rows[0].st === "foreign", false,
    "which is the whole difference: a dash the page draws as “not placed” rather " +
    "than a sentence about a screener nobody consulted");

  const remembered = buildFlowAlerts([one("ZZZ")],
    { stageOf: (t) => (t === "ZZZ" ? "board:long" : null), stageComplete: false });
  eq(remembered.rows[0].st, "board:long",
    "and a partial map that DOES hold the name still carries its stage forward — " +
    "the flag suppresses the invented answer, not the remembered one");

  /* THE STICKINESS the record introduced, which is why this could not stay a
     transient per-read blemish: a stage is read back out of the row the last
     read wrote, so a wrong one is written once and then re-derived all day. */
  const readA = buildFlowAlerts([one("ZZZ")], { stageOf: () => null, stageComplete: false });
  const mA = mergeAlerts(null, readA, { at: T1, sessionDate: D28 });
  const lastStage = new Map(mA.rows.map((r) => [r.t, r.st]));
  const readB = buildFlowAlerts([one("ZZZ")],
    { stageOf: (t) => lastStage.get(t) || null, stageComplete: false });
  eq(readB.rows[0].st, null,
    "a carried-forward unknown stays unknown across the merge rather than curdling " +
    "into “foreign” — under the old default the first read stamped the word and " +
    "every read after it read that stamp back out and re-published it");

  /* The cron is the caller that must pass it, and worker.js is the only place
     that call exists, so assert the source rather than a copy of it here. */
  const worker = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const handler = worker.slice(
    worker.indexOf("async function refreshFlowsIntraday"),
    worker.indexOf("async function readFlowsPayload"));
  /* THE CALL, NOT THE HANDLER. The first draft of this assertion scanned the
     whole handler for the literal — and the handler's own comment SPELLS the
     literal while explaining it, so deleting the argument left the assertion
     green. A source scan that its own prose can satisfy certifies nothing;
     this one reads the argument list of the call it is about. */
  const callAt = handler.indexOf("buildFlowAlerts(raw");
  const call = handler.slice(callAt, handler.indexOf("});", callAt) + 3);
  ok(callAt > 0 && /stageComplete:\s*false/.test(call),
    "AND THE CRON DECLARES ITS MAP PARTIAL, in the call rather than beside it. The " +
    "default is complete because the pipeline's map is; a caller that forgets to say " +
    "otherwise is back to publishing the falsehood, so the declaration is asserted " +
    "where it is made");

  /* ---- a stored record that never named its day ---- */
  {
    const dateless = {
      record: { date: null, reads: 3, firstReadAt: T1, everEntered: 3 },
      rows: [{ t: "OLD", oc: "OLD1", spanStart: T1, prem: 10, st: null,
               firstAt: T1, lastAt: T1, reads: 1 }],
    };
    const m = mergeAlerts(dateless, buildFlowAlerts([one("NEW")]),
      { at: T2, sessionDate: D28 });
    eq(m.record.reset, "undated",
      "A STORED RECORD WITH NO DATE OF ITS OWN IS “undated”, NOT A BOUNDARY. Both " +
      "sides of the comparison have to name a day for a day to have changed; " +
      "calling a dateless record a session boundary names a boundary nothing " +
      "crossed, and `reset` is published prose a page reads out loud");
    deep(m.rows.map((r) => r.t), ["NEW"],
      "and it still starts over, because a record whose day is unknown cannot be " +
      "compared with this read's day at all");
  }

  /* ---- a stored record that lost its counters ----
     Reachable for exactly as long as a deploy takes, and this key is rewritten
     every fifteen minutes while that is true. The fixture is a record with rows
     and no counts — the shape a build older than the counters wrote. */
  {
    const lost = {
      record: { date: D28 },                       // no reads, no everEntered, no firstReadAt
      rows: [
        { t: "AAA", oc: "A1", spanStart: T1, prem: 900, st: "board:long",
          firstAt: T1, lastAt: T1, reads: 2 },
        { t: "BBB", oc: "B1", spanStart: T1, prem: 800, st: "gated",
          firstAt: T1, lastAt: T1, reads: 1 },
      ],
    };
    const m = mergeAlerts(lost, buildFlowAlerts([one("CCC")]), { at: T4, sessionDate: D28 });
    eq(m.record.reset, null, "same day, so the rows carry and the counters have to cope");
    eq(m.record.union, 3, "two carried and one new");
    eq(m.record.reads, 2,
      "THE READ COUNT DOES NOT RESTART AT ONE. Rows are in the record, so at least " +
      "one read put them there; rebuilding the count as 0 publishes “this is the " +
      "first read of the day” over rows that plainly arrived earlier");
    eq(m.record.everEntered, 3,
      "AND THE DAY'S ENTRY COUNT MAY NOT FALL BELOW THE UNION — they are published " +
      "as an upper and a lower bound on the same quantity, and a rebuilt 0 made the " +
      "upper one smaller than the lower, which is not a bound in either direction");
    ok(m.record.everEntered >= m.record.union,
      "the bound stated as the relation it is, so a future counter cannot break it " +
      "quietly");
    eq(m.record.firstReadAt, null,
      "and the instant the record began is NULL rather than this read's clock: the " +
      "rows carried in were flagged before now, so stamping 10:01 here would " +
      "publish “N reads since 10:01” over a row whose own firstAt reads 09:31");

    /* The same choice one level down, on the field the whole layer exists for. */
    const lostRow = {
      record: { date: D28, reads: 2, firstReadAt: T1, everEntered: 2 },
      rows: [{ t: "AAA", oc: "AAA260918C00100000", spanStart: T1, prem: 900, st: null,
               lastAt: T1, reads: 1 }],                       // held, but no firstAt
    };
    const reseen = mergeAlerts(lostRow, buildFlowAlerts([{
      ticker: "AAA", option_chain: "AAA260918C00100000", total_premium: 950,
      start_time: T1, end_time: T2, alert_rule: "RepeatedHits" }]),
      { at: T4, sessionDate: D28 });
    eq(reseen.rows.length, 1, "the held row and the fresh one are the same window");
    eq(reseen.rows[0].firstAt, null,
      "A RE-SIGHTING MAY NOT INVENT A FIRST SIGHTING. A row reached this merge out of " +
      "the STORE, so some earlier read put it there; stamping 10:01 on it would " +
      "publish “first flagged 10:01” on a window the record has been holding since " +
      "09:31 — the exact fact the record exists to keep, overwritten by the read that " +
      "found it again");
    eq(reseen.rows[0].lastAt, T4, "while last-seen is this read, which IS a measurement");
    eq(reseen.rows[0].reads, 2, "and the sighting count still climbs from the minimum " +
      "certainly true");

    /* The same fields on a record that is genuinely STARTING are measurements,
       not silences — the fixture that keeps the fallback from swallowing them. */
    const fresh = mergeAlerts(null, buildFlowAlerts([one("CCC")]), { at: T4, sessionDate: D28 });
    eq(fresh.record.reads, 1, "a record that is starting has had exactly one read");
    eq(fresh.record.everEntered, 1, "one window has entered it");
    eq(fresh.record.firstReadAt, T4,
      "and its first read IS this instant — a measured zero-point, which is why the " +
      "null above cannot simply be “null whenever we are unsure”");
  }

  /* ---- a merge handed something that is not a shaped read ---- */
  {
    const junk = mergeAlerts(
      { record: { date: D28, reads: 1, firstReadAt: T1, everEntered: 1 },
        rows: [{ t: "AAA", oc: "A1", spanStart: T1, prem: 900, firstAt: T1, lastAt: T1, reads: 1 }] },
      null, { at: T2, sessionDate: D28 });
    eq(junk.unusable, null,
      "`unusable` IS NULL, NOT ZERO, when there was no shaped read to count it from. " +
      "A published 0 must mean “counted, and there were none”; handed nothing, this " +
      "function counted nothing, and Number(null) === 0 is the scar that makes the " +
      "difference worth one null");
    eq(junk.rows.length, 1, "while the record itself is left standing");
    eq(junk.record.entered, 0,
      "with a measured zero where one belongs — nothing entered, and that WAS counted");
  }

  /* ---- the ceilings against the size the other writer is held to ----
     A ceiling justified only in a comment is a ceiling nobody re-derives when
     the row shape grows a field. This builds the widest row the shaper can
     emit, fills the record to both published ceilings, and measures the whole
     stored payload against worker.js's own constant. */
  {
    const wide = (i) => ({
      ticker: "ABCD", option_chain: `ABCD260918C00${String(100000 + i).slice(0, 6)}`,
      total_premium: 12345678.9, total_size: 98765, trade_count: 4321,
      total_ask_side_prem: 9876543.21, total_bid_side_prem: 2468013.57,
      has_sweep: true, has_floor: false, has_singleleg: true, all_opening_trades: false,
      open_interest: 123456, volume_oi_ratio: 1.2345678,
      iv_start: 0.4567891, iv_end: 0.5678912, underlying_price: 123.456789,
      start_time: `2026-08-28T13:${String(31 + (i % 25)).padStart(2, "0")}:00.000Z`,
      end_time: "2026-08-28T13:59:45.000Z",
      alert_rule: "RepeatedHitsAscendingFillAllOpeningSweeps",
    });
    const rowsIn = [];
    for (let i = 0; i < MERGED_ALERT_ROWS + 40; i++) rowsIn.push(wide(i));
    const full = mergeAlerts(null, buildFlowAlerts(rowsIn, { stageOf: () => "board:long", cap: 400 }),
      { at: T1, sessionDate: D28 });
    eq(full.rows.length, MERGED_ALERT_ROWS, "the record fills to the published row ceiling");
    ok(full.record.bytes <= MERGED_ALERT_BYTES,
      "inside the published byte ceiling at the same time");

    /* AND THE OTHER CEILING, WHICH THE FIXTURE ABOVE CANNOT REACH. At 180 rows
       the ROW ceiling bites first, so that measurement holds however wrong
       MERGED_ALERT_BYTES is — it was raised eightfold in a mutation run and
       nothing here noticed. A record whose row cap is out of the way is the
       only fixture that puts the byte ceiling under load. */
    const byBytes = mergeAlerts(null, buildFlowAlerts(rowsIn, { stageOf: () => "board:long", cap: 400 }),
      { at: T1, sessionDate: D28, cap: 4000 });
    eq(byBytes.record.shedBy, "bytes", "with the row ceiling out of the way the BYTE " +
      "ceiling is the one that bites, which is the state this fixture exists to measure");
    ok(byBytes.rows.length > MERGED_ALERT_ROWS,
      "and it holds more rows than the row ceiling would have, so the two are genuinely " +
      "different ceilings rather than one wearing two names");

    const envelope = (m) => JSON.stringify({
      v: 1, generatedAt: T1, sessionDate: D28, vendorLimit: 60, vendorTruncated: false,
      ...m, readAt: T1, refreshed: "intraday",
    }).length;
    const cap = Number(/FLOWS_MAX_PAYLOAD_BYTES = (\d+) \* 1024/.exec(worker)[1]) * 1024;
    eq(cap, 128 * 1024, "worker.js still holds this key's other writer to 128KB");
    for (const [label, sized] of [["the row ceiling", full], ["the byte ceiling", byBytes]]) {
      const stored = envelope(sized);
      ok(stored < cap,
        `a FULL record under ${label}, built from the widest rows the shaper can emit, ` +
        `is ${stored} bytes against the ${cap} the ingest route allows — one key with ` +
        "two writers may not have two sizes, and the cron writes to D1 directly where " +
        "nothing else would catch it");
      ok(stored > cap * 0.5,
        `and that fixture (${label}) is genuinely near the bound rather than trivially ` +
        "under it — a bound no fixture can approach certifies nothing about the bound");
    }
    deep([full.record.shedBy, byBytes.record.shedBy], ["rows", "bytes"],
      "and the pair the loop measured is genuinely two STATES rather than one fixture " +
      "counted twice — one record shed by the row ceiling, one by the byte ceiling, " +
      "which is what makes the two bounds above two measurements");
  }
}

console.log(`✓ flows-alerts: ${checks} assertions — a vendor flag that is absent staying ` +
  `null rather than becoming a confident no, a row measuring nothing dropped and counted, ` +
  `premium ranking inside the vendor's own selection with a total tie-break the first ` +
  `draft's precedence bug would fail, a published cap with its shed, affirmative-only ` +
  `flag counts, a quiet empty, both wire envelopes shaping byte-identically so the ` +
  `second writer cannot zero the key, notes that need no allow-list, and a SESSION ` +
  `RECORD in which a name flagged at 09:31 outlives the vendor's rolling window: ` +
  `first-seen that never advances beside a last-seen that does, sightings counted once ` +
  `per read, a reset at the session boundary and at no other age, both ceilings ` +
  `reachable by a fixture and naming which one shed, both of them measured against ` +
  `worker.js's own 128KB so a ceiling justified in a comment cannot outlive the row ` +
  `shape it was measured on, a partial stage map that publishes null rather than the ` +
  `word the page spells out as a claim about the screener, a dateless record told ` +
  `apart from a session boundary, counters that fall back to the minimum certainly ` +
  `true instead of to zero, and the empty-read write guard still standing in worker.js ` +
  `where the merge could not weaken it`);
