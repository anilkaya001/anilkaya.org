#!/usr/bin/env node
/* =============================================================
   flows-pipeline.mjs — the daily Flows board pipeline.

   Runs in GitHub Actions, never on Cloudflare. The Workers free
   plan allows 10 ms of CPU per invocation including cron, and this
   job is 500-900 Unusual Whales calls; chaining that through a
   1-minute-minimum cron would take hours and wedge on any stall.
   Here there is no CPU limit and no subrequest limit.

   The Worker's only job is to verify a session and hand back the
   stored string. Everything numeric happens in this file.

   Usage:
     node scripts/flows-pipeline.mjs              # live
     node scripts/flows-pipeline.mjs --dry-run    # synthetic, no network
     node scripts/flows-pipeline.mjs --dry-run --emit out.json

   Environment (live only):
     UW_API_KEY           Unusual Whales bearer token
     FLOWS_INGEST_URL     optional; defaults to https://anilkaya.org/api/flows/ingest
     FLOWS_INGEST_TOKEN   bearer token for that endpoint
   ============================================================= */

import {
  num, quantile, winsorize, robustZ, neutralize,
  flowPurity, aggressorGamma, bookDisplacement, pathSignature,
  gammaDecayCalendar, positioningQuality, effectiveBreadth,
  crossFamilyRedundancy, qualityGate, percentileRank, realizedVol,
  isLiveColumn, pearson, SCORE_SCALE, horizonMove, HORIZON_SESSIONS,
  boundedScore, conviction, applyHysteresis, callGammaLeg, putGammaLeg,
} from "../shared/flows-features.js";
import { buildCard, SURFACE_EXPIRIES } from "../shared/flows-card.js";
import { tradingCalendar, scoreSessions, icTable, RECORD_NOTES } from "../shared/flows-record.js";
import { makePermitQueue } from "../shared/flows-permits.js";
import { buildChainPanels, CHAIN_PAGE_SIZE, SKEW_MIN_DAYS, summariseSkewMisses }
  from "../shared/flows-chain.js";
import {
  rankUnusual, rankUnusualNames, describeOiBasis,
  UA_MIN_VOLUME, UA_MIN_OI, UNUSUAL_NOTES,
} from "../shared/flows-unusual.js";
import { buildEvents, EVENTS_NOTES } from "../shared/flows-events.js";
import { scoresRows, buildScoreTrack, boardsToScoreRows } from "../shared/flows-scores.js";
import { buildFlowAlerts, ALERT_ROWS, alertBand } from "../shared/flows-alerts.js";
import { buildPulse, PULSE_FEEDS, PULSE_CAPS } from "../shared/flows-pulse.js";
import {
  /* Aliased for what it DOES, not for where it happens to live. It shipped
     as `unwrapPolitical` and was then called from the flow-alerts leg to
     count wire rows — a generic {data:[...]} unwrapper wearing a domain name
     it had already outgrown. A reader meeting `unwrapVendorRows(raw)` beside
     an options feed has to go and check whether that is a mistake. */
  buildPolitical, POLITICAL_FEEDS, unwrapRows as unwrapVendorRows,
} from "../shared/flows-political.js";
import { parseOptionSymbol } from "../shared/flows-premium.js";
import { marketAggregate, MARKET_NOTES } from "../shared/flows-market.js";
import {
  capBands, selectCoverage, NDX_100, NDX_AS_OF, SELECTION_EPOCH, UNIVERSE_NOTES,
  PICK_SIZE, PICK_INDEX,
} from "../shared/flows-universe.js";

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has("--dry-run");
const EMIT = process.argv.includes("--emit")
  ? process.argv[process.argv.indexOf("--emit") + 1]
  : null;

const BASE = "https://api.unusualwhales.com";

/* The ingest endpoint is a PUBLIC URL, not a secret — the bearer token is what
   protects it. Requiring it as a repository secret added a configuration step
   and a place to typo, and getting it wrong is the failure that looks like
   success: the pipeline runs, every publish 401s or redirects, and the board
   silently keeps yesterday's data. It defaults to production and stays
   overridable for a staging Worker or a local test.

   Resolved per call rather than captured at import: a module-level constant
   freezes whatever the environment held when the file was first imported, so
   a test that sets FLOWS_INGEST_URL after importing would silently POST to
   PRODUCTION. The contract test caught exactly that. */
function ingestURL() {
  return process.env.FLOWS_INGEST_URL || "https://anilkaya.org/api/flows/ingest";
}

/* THE INGEST ROUTE IS BEHIND CLOUDFLARE AND JUDGES THE CALLER, NOT ONLY THE
   BEARER — so every request to it must look like the same client.

   ONE BUILDER BECAUSE THE COPIES DIVERGED AND IT COST THE TRACK RECORD.
   publish() and retire() each carried their own copy of this User-Agent, with
   publish()'s comment explaining exactly why it is needed: "Node's fetch sends
   no User-Agent, and an anonymous POST from a datacenter address is exactly
   the shape edge bot heuristics drop." The READ path never got a copy. So
   writes and deletes reached the Worker and every read was refused by the edge
   with 403 — measured, 8 of 8, on 2026-08-27, with a retry recovering none of
   them because a bot heuristic is deterministic and not a rate limit.

   The visible cost was the track record: collectDatedBoards read "0 retained
   session(s) of 180 dated key(s) probed" and the page called it "the ordinary
   first state of the record rather than a failure", when in fact no read had
   ever succeeded and the archive's contents were simply unknown. The silent
   cost was hysteresis, which uses the same read and had been quietly building
   every board with no incumbents since the day it was wired up.

   A third copy of a string three call sites must agree on is worse than the
   two that already disagreed, so there is now one. */
const INGEST_UA = "anilkaya-flows-pipeline/1 (+https://github.com/anilkaya001/anilkaya.org)";

function ingestHeaders({ json = false } = {}) {
  const headers = {
    Authorization: "Bearer " + process.env.FLOWS_INGEST_TOKEN,
    "User-Agent": INGEST_UA,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

/* ---------- universe gate --------------------------------------
   These thresholds are the difference between a live edge and a
   rounding error, not housekeeping. A genuine flow composite makes
   a gross 10-day decile spread of 30-80 bp; round-trip cost is
   15-30 bp above a $50M ADV floor and 40-100 bp below it. Names
   that fail these filters are exactly where dramatic-looking flow
   is uncapturable after costs. */
const UNIVERSE = {
  minPrice: 5,               // sub-$5 names have percentage spreads that eat the spread
  minMarketCap: 1e9,         // below this, options are too thin to exit
  // The $50M ADV floor the cost model depends on. It canNOT be applied here:
  // /api/screener/stocks returns options volume only and never absolute stock
  // volume, so there is no way to compute dollar ADV from the one universe
  // call. It is enforced after enrichment instead, from the ohlc/1d candles
  // that are fetched anyway for ATR. See dollarVolume in computeFeatures.
  minDollarVolume: 5e7,
  minOptionVolume: 1000,     // fewer contracts than this and per-name greeks are noise
  minOpenInterest: 5000,
  excludeIssueTypes: ["ETF", "Index", "ADR"],   // index flow is not single-name conviction

  /* THE BOARD IS HALF THE POOL, NOT A QUARTER OF IT. At a 100-name pool a
     board of 25 a side publishes every name that scored, which is the point:
     the reader asked to see the market, and a ranked list that stops at 25
     answers a different question than a ranked list of everything measured. */
  boardSize: 50,

  /* HOW MANY NAMES ARE ENRICHED, and therefore what the score is a
     cross-section OF. Five vendor calls each, so this number times five is the
     largest line in the call budget and the two must be changed together. */
  enrichCount: 100,
};

/* ---------- rate limiting --------------------------------------
   Unusual Whales documents no rate limit anywhere — not in the
   OpenAPI spec, not in the docs. Rather than assume a number, start
   conservative, obey Retry-After when offered, back off on 429, and
   record the achieved rate so the real ceiling can be discovered
   from the logs. */
export const RATE = {
  startDelayMs: 120, minDelayMs: 60, maxDelayMs: 5000, maxRetries: 4,
  maxRetryAfterMs: 30_000,   // the ceiling on a vendor-supplied Retry-After
  /* THE CEILING ON THE FLOOR, which is a different number from maxDelayMs and
     has to be, or the deadline is not survivable.

     `delayMs` may spike to maxDelayMs for ONE call after a 429; the floor is
     what every subsequent call pays for the rest of the run. A floor allowed
     to reach 5s would cost CALL_BUDGET x 5s = 79 minutes against a 36-minute
     deadline — the run would publish nothing at all, which is a strictly worse
     failure than being rate-limited. At 750ms the same budget costs
     950 x 0.75 = 713s, comfortably inside the window the chain leg reserves.
     rateFloorSurvivesBudget() below is the assertion, and it is tested — and
     it is the assertion, not this comment, that fails the build if the budget
     is raised past what the deadline can absorb (2,399 calls at this floor).

     THIS CEILING IS NOW BINDING, WHICH IS A FINDING AND NOT A SETTING. On
     2026-08-26 the floor sat pinned at 750ms for the whole run and 170 of
     1022 attempts still came back 429: the controller asked to go slower and
     this constant refused. Raising it is NOT obviously right — a 429 costs a
     Retry-After wait, so a higher floor trades a certain per-call tax against
     an uncertain saving, and the run has never been instrumented to say which
     is larger. Do not raise it on intuition; measure the 429 wait first. */
  floorCeilingMs: 750,
};

/* The call budget this pipeline is designed around, named so the floor ceiling
   can be checked against it rather than against a number in a comment:

     1  session-date probe (SPY candles)
   + 3  dating probes
   + 32 screener bands  (was 6; the ~50-row cap per band is what made the old
        ladder a 300-name ceiling on the entire investable universe)
   + 640 enrichment      (5 calls x 128 names: enrichCount = 100 by market cap
        PLUS the Nasdaq-100 members not already in that hundred. The pool is
        ADDITIVE by construction — see selectCoverage() — so this term is not
        5 x enrichCount and never was; the old comment said 500 while the run
        spent 640.)
   + 11 sector ETF candles
   + 1  chain truncation probe
   + 50 option chains    (top 50 board names by |score|)
   + 29 chain recoveries (the second single-expiry call, on names the first
        call truncated — spent on roughly 3 names in 5)
   + 300 cards           (6 per name x 50: max-pain, the gamma surface, and
        the wave-2 four — dark pool prints, contract OI deltas, the vol term
        structure and the IV-rank series; congress went market-wide and is
        the one call below)
   + 1  congress, market-wide
   + 1  flow alerts, market-wide
   + 7  market pulse     (tide, totals, oi-change, net impact, insiders,
        dark pool, seasonality — one market-wide call each)
   + 1  shorts probe     (the one wave-B scout still open: volume-and-ratio
        answered ok with ZERO rows on 2026-08-31, so it re-probes with a
        dated param until it shows a row shape or proves empty by design;
        the five confirmed probes retired into the sections they scouted)
   = 1076 modelled.

   MEASURED AGAINST IT: the 2026-08-26 18:04 run made 1022 attempts, of which
   170 were 429s that were then retried — so ~852 attempts carried a distinct
   request, against the 867 the model totalled BEFORE the pulse and probe
   terms were added. The model was within 2% of the meter that day, which is
   the only reason to keep writing it down; re-read the meter on the first
   run that carries the new terms. */
export const CALL_BUDGET = 1250;

/**
 * How near an earnings date has to be for a name to leave the board.
 *
 * NAMED BECAUSE TWO SURFACES NOW READ IT. It was a bare 12 inside the gate's
 * own filter, which was fine while the gate was the only thing that knew it.
 * /flows/events/ marks a row `gated` using the same rule, and a bare literal
 * in one file against a reference in another is how two surfaces come to
 * disagree about which names the board was allowed to score — silently, and
 * only for names sitting exactly on the boundary.
 */
export const EARNINGS_GATE_DAYS = 12;

/* The screener's undocumented page cap, measured: every band that has ever had
   more names than this returned exactly this many. Named so the saturation
   check compares against the same number the ladder is sized around. */
export const SCREENER_PAGE_ROWS = 50;

/**
 * How many board names get the per-name legs that cost vendor calls.
 *
 * The board itself is free: it is built from data already fetched, so widening
 * it from 11 names to 93 cost nothing. The CHAIN and the CARD are not free —
 * one and two calls a name respectively — so at 93 names they would spend 279
 * calls and turn a coverage win into a deadline risk.
 *
 * They are therefore capped, and capped by |score| rather than by side, so the
 * names that get the expensive treatment are the ones furthest from neutral
 * on either board rather than the top of an arbitrary one. Everything below
 * the cap still publishes a row, a score and a rank; it publishes no card, and
 * the row says so rather than linking to a page that will not load.
 */
export const DEEP_NAMES = 50;

/** The rule, in the words the board publishes it in. */
export const DEEP_RULE =
  "The " + 50 + " names furthest from neutral across both boards carry a chain " +
  "and a detail card. Every other row is scored and ranked from the same five " +
  "sources, and has no card: the card costs vendor calls the run cannot spend " +
  "on a hundred names.";

/**
 * The board names that earn a chain and a card, ranked by distance from
 * neutral across BOTH sides.
 *
 * Pure and exported because the alternative — slicing inside the leg — makes
 * the two legs able to disagree about which names are deep, and a card built
 * for a name whose chain was skipped renders four "unavailable" panels for a
 * reason that is about a budget rather than about the data.
 */
export function deepNames(published, limit = DEEP_NAMES) {
  const rows = [];
  for (const side of ["long", "short"]) {
    for (const row of (published && published[side]) || []) {
      const s = Number(row && row.s);
      if (row && row.t) rows.push({ t: row.t, side, mag: Number.isFinite(s) ? Math.abs(s) : -1 });
    }
  }
  rows.sort((a, b) => b.mag - a.mag || a.t.localeCompare(b.t));
  return rows.slice(0, Math.max(0, limit));
}

/**
 * Can a run at the floor ceiling still finish inside the deadline?
 *
 * PURE AND EXPORTED so the contract test asserts the relation rather than
 * re-stating the arithmetic in a comment that can rot. The chain reserve is
 * subtracted because the cards must still be buildable after the floor has
 * risen — a floor that fits the deadline but eats the card window has only
 * moved which surface goes missing.
 */
export function rateFloorSurvivesBudget(
  { floorCeilingMs, callBudget, deadlineMs, reserveMs } = {},
) {
  return floorCeilingMs * callBudget < deadlineMs - reserveMs;
}

/**
 * The new floor after a 429.
 *
 * MONOTONIC AND CAPPED. Multiplicative so a badly wrong starting guess is
 * corrected in a few observations rather than a few hundred, with a 150ms
 * opening step because doubling 60ms takes five 429s to reach a delay any
 * limiter would notice.
 *
 * Pure, because the defect this replaces was a comment claiming an invariant
 * the code did not implement, and the only durable fix for that is a function
 * whose invariant a test can hold.
 */
export function raiseRateFloor(floor, { minStepMs = 150, ceilingMs = RATE.floorCeilingMs } = {}) {
  return Math.min(Math.max(floor * 1.5, minStepMs), ceilingMs);
}

/**
 * The whole limiter, as one pure step.
 *
 * NO ARITHMETIC IS LEFT IN uw(). That is the point, and it is a direct
 * response to how the bug this replaces survived: the pieces were individually
 * defensible and the WIRING clamped the decay to an immutable constant instead
 * of to the floor it had just raised. A test can only hold an invariant over
 * code it can call, so the controller is code a test can call, and uw() does
 * nothing but hand it an outcome.
 *
 * `outcome` is one of:
 *   "ok"      a clean response — decay toward the floor, never through it
 *   "limited" a 429 — raise the floor, and lift the delay to at least it
 *   "error"   a transport failure or 5xx — back off, but learn nothing about
 *             the tier, because a 500 is not a rate limit and a floor raised
 *             on one would slow every later call for the wrong reason
 */
export function stepRateController({ delayMs, floorMs }, outcome, { maxDelayMs = RATE.maxDelayMs } = {}) {
  if (outcome === "limited") {
    const raised = raiseRateFloor(floorMs);
    return { floorMs: raised, delayMs: Math.min(Math.max(delayMs * 2, raised), maxDelayMs) };
  }
  if (outcome === "error") {
    return { floorMs, delayMs: Math.min(delayMs * 2, maxDelayMs) };
  }
  return { floorMs, delayMs: Math.max(floorMs, delayMs * 0.9) };
}

/* The wall-clock budget.
   GitHub kills the job at 45 minutes. The backoff above has no notion of that,
   so a sustained 429 regime just walks into the timeout — and because cards
   are built before the boards publish, a slow day would take the RANKING down
   with the cards. Boards publish first, and card building abandons at this
   deadline and reports how many it managed.

   MEASURED, NOT GUESSED, AND RAISED BECAUSE THE BOARD GREW UNDER IT. At 30
   minutes this budget was not spare capacity going unused — it was BINDING,
   and it bound on the wrong leg. The 2026-08-26 18:04 run finished the whole
   pipeline in 1502s (25.0 min) but the chain leg stopped at 34 of 50 names:
   its own cut-off is DEADLINE_MS − CHAIN_RESERVE_MS = 24 min, and enrichment
   alone had already spent 22.4 of them. Sixteen names lost their chain panels
   and the skew reading fell from 46 of 50 on the previous run to 27 — a
   VISIBLE regression on the board, produced entirely by a constant, not by
   anything the vendor did.

   The two levers are not equivalent. Cutting the enrichment pool would buy
   the time back by shrinking the board, which is the opposite of what the
   board is for; raising this budget costs only wall-clock on a machine that
   is idle anyway. 36 minutes gives the chain leg until minute 30 — six more
   than it had — and still leaves 9 minutes of headroom under the runner's
   45-minute kill, which is more slack than the entire chain leg consumes.

   THE COST CENTRE IS ENRICHMENT, NOT THIS NUMBER. 128 names at ~7.4 calls
   each is 950 of the run's 1022 calls, and the limiter is already SATURATED
   against them: 170 of those calls came back 429 and the learned floor sat
   pinned at its 750ms ceiling for the whole run, meaning the controller
   wanted to go slower and was not allowed to. Raising this budget buys the
   chain leg room; it does not make the pipeline faster, and if enrichment
   keeps growing the next thing to bind will be this constant again. */
export const DEADLINE_MS = 36 * 60 * 1000;

/* The tick row's field list is reported once per run, not once per name. */
let tickFieldsReported = false;
let greekFieldsReported = false;

/** The four fields this pipeline reads off a /net-prem-ticks row. */
const TICK_FIELDS_READ = Object.freeze([
  "tape_time", "net_delta", "net_call_premium", "net_put_premium",
]);

/**
 * The unread half of a tick row, as log lines.
 *
 * BOUNDED, and a pure function so it can be TESTED. A diagnostic that has
 * never executed is a diagnostic that throws on the first live run — which is
 * precisely the moment it exists for. The values are truncated because a tick
 * row is vendor data of unknown width and a log line is not a payload.
 */
function describeTickFields(ticker, row, { max = 12, valueChars = 40 } = {}) {
  const keys = Object.keys(row || {});
  if (!keys.length) return [`  tick fields (${ticker}): the first row carried no keys at all`];
  const unknown = keys.filter((k) => !TICK_FIELDS_READ.includes(k));
  const lines = [`  tick fields (${ticker}): ${keys.length} keys, ${unknown.length} unread`];
  if (unknown.length) {
    const sample = unknown.slice(0, max)
      .map((k) => `${k}=${String(JSON.stringify(row[k])).slice(0, valueChars)}`)
      .join(" ");
    lines.push(`    unread: ${sample}${unknown.length > max ? ` (+${unknown.length - max} more)` : ""}`);
  }
  return lines;
}

/* ---------- the truncated-chain probe ----------------------------

   THE FIRST LIVE RUN OF THE CHAIN LEG MEASURED ITS OWN CENTRAL ASSUMPTION AND
   FOUND IT BACKWARDS. buildChainPanels refuses to publish scalars from a
   response that filled the vendor's 500-row page, because every scalar's
   relation begins "on the nearest expiry" and nearest cannot be identified
   inside an arbitrarily-ordered subset of a book. That refusal is correct. It
   was designed as the edge case for the largest names, and on 2026-08-26 it
   fired on TEN OF ELEVEN board names: only PCG, small enough to fit in one
   page, produced a skew and an at-the-money level. The leg is spending a call
   per name to publish scalars for one name in eleven.

   The fix depends on one fact this repository does not have: whether
   /option-contracts accepts a filter narrowing the response to a single
   expiry. If it does, the whole problem dissolves — ask for the nearest
   expiry by name and "nearest" is identified by construction, one call, no
   ordering assumption. If it does not, the fallback is `page`, which the
   premium desk already uses on this endpoint, at several calls a name.

   GUESSING WHICH IS NOT AN OPTION. The vendor's documentation has been wrong
   about this API five times, twice in ways that published confident wrong
   numbers for days. So this run does not guess: it spends ONE call, on ONE
   name, asking the question, and prints what came back. That is the discipline
   that turned the call_gex mystery into an observation in a single run.

   The candidate expiry comes from /greek-exposure/expiry, which every enriched
   name has already been charged for — a COMPLETE enumeration of the name's
   listed expiries from a different endpoint, so it identifies "nearest"
   without reference to whatever the chain page happened to contain. */

/**
 * The nearest listed expiry at least `minDays` out, from the expiry rows the
 * enrichment already holds.
 *
 * Pure and exported for the contract test. Returns null rather than a guess
 * when nothing qualifies — a probe with no target is skipped, not aimed at
 * whatever sorts first.
 */
export function nearestProbeExpiry(expiryRows, { asOf, minDays = SKEW_MIN_DAYS } = {}) {
  const base = Date.parse(String(asOf) + "T00:00:00Z");
  if (!Number.isFinite(base)) return null;
  const dates = (Array.isArray(expiryRows) ? expiryRows : [])
    .map((r) => (r && r.expiry ? String(r.expiry).slice(0, 10) : null))
    .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => {
      const t = Date.parse(d + "T00:00:00Z");
      return Number.isFinite(t) && (t - base) / 86400000 >= minDays;
    })
    .sort();
  return dates.length ? dates[0] : null;
}

/**
 * How many orders of magnitude one name's per-strike dealer gamma spans.
 *
 * THIS EXISTS TO SETTLE AN ARGUMENT WITH EVIDENCE INSTEAD OF TASTE.
 *
 * The gamma ladder draws a SYMLOG axis and then spends three lines of its own
 * note telling the reader not to trust bar length: "a bar twice as long is
 * nowhere near twice the gamma… treat bar length as rank". A chart that
 * disclaims its primary channel in prose is worth re-examining, and the
 * obvious alternative — a linear axis with a declared cap and clip marks on
 * whatever exceeds it — is only better if the data is tame enough for a cap
 * to leave the wings readable.
 *
 * SYMLOG'S OWN JUSTIFICATION IS A MEASUREMENT NOBODY HAS TAKEN: "per-strike
 * dealer gamma spans four or five orders of magnitude within one name". If
 * that is true, a linear cap collapses every wing strike to a sliver and
 * symlog is right. If it is not, the note is apologising for a compression
 * the data never needed.
 *
 * The synthetic corpus CANNOT settle it and nearly produced the wrong answer:
 * capped-linear measured better there on every legibility statistic — fewer
 * sub-2px bars, longer median bar — but the fixture spans a median of 1.72
 * orders of magnitude, not four or five. It does not exhibit the problem
 * symlog exists to solve, so a result from it is a result about different
 * data. This prints the real number, once per run, from the rows the
 * enrichment already bought.
 *
 * Read it as: median at or above ~4 means symlog stays and the note is
 * honest; median near 2 means the cap is affordable and the axis should be
 * linear with the overflow marked.
 */
export function describeGammaRange(profiles) {
  const decades = [];
  for (const bars of profiles || []) {
    const mags = (Array.isArray(bars) ? bars : [])
      .map((b) => Math.abs(num(b && b.g, NaN)))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (mags.length < 5) continue;
    decades.push(Math.log10(Math.max(...mags) / Math.min(...mags)));
  }
  if (!decades.length) {
    return { names: 0, median: null, p90: null,
      line: "gamma range: no name carried five non-zero strikes, so the axis " +
        "question is not measurable on this run." };
  }
  decades.sort((a, b) => a - b);
  const at = (p) => decades[Math.min(decades.length - 1, Math.floor(p * decades.length))];
  const median = at(0.5), p90 = at(0.9);
  const verdict = median >= 3.5
    ? "SYMLOG IS EARNED — a linear cap would collapse the wings, and the axis " +
      "note is describing the data rather than apologising for a choice."
    : "SYMLOG MAY NOT BE EARNED at this range: a declared cap with clip marks " +
      "would leave the wings readable and let bar length mean magnitude again. " +
      "Worth re-measuring before changing anything.";
  return {
    names: decades.length, median: Number(median.toFixed(2)), p90: Number(p90.toFixed(2)),
    line: `gamma range: per-name dealer gamma spans ${median.toFixed(2)} orders of ` +
      `magnitude at the median and ${p90.toFixed(2)} at the 90th, over ` +
      `${decades.length} name(s). The symlog axis justifies itself on "four or five". ` +
      verdict,
  };
}

/**
 * What the probe response actually was, as log lines.
 *
 * BOUNDED AND PURE, for the reason describeTickFields states: a diagnostic
 * that has never executed is a diagnostic that throws on the first live run,
 * which is the one moment it exists for.
 *
 * The three outcomes this has to distinguish are the three that decide the
 * next design, so each gets its own sentence rather than a row count a reader
 * has to interpret:
 *   - every row carries the requested expiry, under the page cap -> the filter
 *     works and one call a name identifies "nearest" by construction;
 *   - several expiries came back -> the parameter was ignored, fall back to
 *     `page`;
 *   - nothing came back -> the filter is accepted and empty, which is a third
 *     thing again and must not be read as either of the other two.
 */
export function describeChainProbe(ticker, expiry, rows, { pageSize = CHAIN_PAGE_SIZE, maxList = 6 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  /* THE SHARED PARSER, not a local one. The first draft of this probe carried
     its own regex, which required a letters-only root and so returned NOTHING
     for the dry run's SYN308 — a diagnostic reporting "no expiries" for a
     response that had ten of them. Writing a second symbol parser is how the
     put/call blindness got in; there is one, and it is this. */
  const seen = [...new Set(list
    .map((r) => {
      const p = parseOptionSymbol(r && r.option_symbol);
      return p ? p.expiry : null;
    })
    .filter(Boolean))].sort();
  const head = `  chain probe (${ticker}, expiry=${expiry}): ${list.length} row(s)`;
  if (!list.length) {
    return [`${head} — the filter was accepted and returned NOTHING, which is` +
      " neither working nor ignored; do not read it as either"];
  }
  const shown = seen.slice(0, maxList).join(", ") + (seen.length > maxList ? ` (+${seen.length - maxList} more)` : "");
  if (seen.length === 1 && seen[0] === expiry) {
    return [`${head} over expiries: ${shown}`,
      list.length >= pageSize
        ? "    FILTER WORKS but this single expiry still fills the page, so the" +
          " strike set is itself a subset — narrowing further is still needed"
        : "    FILTER WORKS: one call identifies the nearest expiry by" +
          " construction. Drop the truncation refusal for scalars read off it."];
  }
  return [`${head} over expiries: ${shown}`,
    `    FILTER IGNORED — ${seen.length} distinct expiries came back for a` +
    " single-expiry request, so narrowing must use `page` instead."];
}

/* How much of the deadline the chain leg must leave for the cards.
   Fifty chain calls at the limiter's 5s ceiling are four minutes; the cards
   are three calls a name over up to fifty names and are the surface a reader
   actually opens. The leg stops early rather than spending the card window on
   panels that arrive after the cards were abandoned. */
const CHAIN_RESERVE_MS = 6 * 60 * 1000;

/** Delay between publishes, to stay under the edge's burst-rate challenge. */
const PUBLISH_SPACING_MS = 150;

/* THE THREE NUMBERS THIS FILE ASKED FOR AND NEVER HAD. The floorCeilingMs
   comment above says the binding 750ms ceiling "is NOT obviously right — a 429
   costs a Retry-After wait, so a higher floor trades a certain per-call tax
   against an uncertain saving, and the run has never been instrumented to say
   which is larger. Do not raise it on intuition; measure the 429 wait first."
   These are that measurement: what the run spent WAITING FOR ITS TURN, what it
   spent ON THE WIRE, and what it spent BEING REFUSED. */
const stats = {
  calls: 0, retries: 0, rateLimited: 0, failures: 0, startedAt: Date.now(),
  permitWaitMs: 0, networkMs: 0, rateLimitWaitMs: 0,
};
let delayMs = RATE.startDelayMs;

/* THE FLOOR IS A VARIABLE, and it was not one until 2026-08-26.

   The 429 branch below has always carried the comment "raise the floor
   permanently", and for as long as it has, the code underneath it raised only
   the CURRENT delay: the decay on a clean response clamped to RATE.minDelayMs,
   an immutable 60. Six clean responses after any 429 walked the delay straight
   back to the minimum that earned it. The first live run of the chain leg
   measured the consequence — 43 rate-limited calls out of 408, and a final
   inter-call delay of exactly 60ms, the controller having learned nothing
   across the whole run — and a 429 costs one of four retry attempts, so a
   sustained regime does not merely waste calls, it fails names. */
let delayFloorMs = RATE.minDelayMs;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- the permit queue -------------------------------------

   THE IMPLEMENTATION AND ITS ARGUMENT LIVE IN shared/flows-permits.js, which
   states at length why this is NOT the `Promise.all` the sector, card and
   pulse legs each refuse. The short version: requests still leave exactly
   delayMs apart — the vendor cannot tell the schemes apart — but the round
   trip no longer sits on the critical path in front of the next call's wait.

   `delayMs` is passed as a FUNCTION because the rate controller raises it
   mid-run on a 429; reading it at reservation time is what makes a raised
   floor govern every slot booked after it. */
const permits = makePermitQueue({
  delayMs: () => delayMs,
  now: () => Date.now(),
  sleep,
  maxInFlight: 6,
});


async function uw(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    /* ARRAYS GET ONE OCCURRENCE EACH. `set(k, String(["a","b"]))` yields the
       single parameter `a,b`, which expirations[] reads as one malformed date
       rather than as two good ones — a 422, or worse an empty 200 that looks
       like a name with no gamma. */
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined && item !== null && item !== "") url.searchParams.append(k, String(item));
      }
      continue;
    }
    url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; attempt <= RATE.maxRetries; attempt++) {
    /* A RETRY TAKES A FRESH PERMIT. It is a new request on the wire and the
       vendor counts it as one, so it queues like one. */
    stats.permitWaitMs += await permits.acquire();
    stats.calls++;
    let response;
    const wireStarted = Date.now();
    const landed = permits.enter();
    try {
      response = await fetch(url, {
        headers: {
          Authorization: "Bearer " + process.env.UW_API_KEY,
          Accept: "application/json",
        },
      });
    } catch (error) {
      stats.networkMs += Date.now() - wireStarted;
      landed();
      stats.retries++;
      ({ delayMs, floorMs: delayFloorMs } = stepRateController(
        { delayMs, floorMs: delayFloorMs }, "error"));
      if (attempt === RATE.maxRetries) throw error;
      continue;
    }
    stats.networkMs += Date.now() - wireStarted;
    landed();

    if (response.status === 429) {
      stats.rateLimited++;
      const retryAfter = Number(response.headers.get("Retry-After"));
      // CAPPED. Retry-After is a value the vendor controls, and honouring it
      // literally hands them a lever on this job's 45-minute budget: a single
      // `Retry-After: 3600` would sleep one hour inside one call and guarantee
      // a timeout with no board published. Above the cap, back off on our own
      // schedule and let the retry limit end it.
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, RATE.maxRetryAfterMs)
        : Math.min(delayMs * 4, RATE.maxDelayMs);
      /* Raise the floor, and this time actually raise the floor. Hitting 429
         once means the starting guess was wrong for this key's tier, and that
         fact does not expire six clean responses later. */
      ({ delayMs, floorMs: delayFloorMs } = stepRateController(
        { delayMs, floorMs: delayFloorMs }, "limited"));
      /* EVERYONE BACKS OFF, not just the caller that was refused. Serially
         that distinction did not exist — there was only ever one caller in
         flight. With permits outstanding, letting the others walk into the
         same wall is how one 429 becomes six. */
      permits.defer(wait);
      stats.rateLimitWaitMs += wait;
      await sleep(wait);
      continue;
    }

    if (response.status >= 500) {
      stats.retries++;
      ({ delayMs, floorMs: delayFloorMs } = stepRateController(
        { delayMs, floorMs: delayFloorMs }, "error"));
      if (attempt === RATE.maxRetries) throw new Error(`${path} -> HTTP ${response.status}`);
      continue;
    }

    if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);

    // A clean response earns a small speed-up, floored so we never
    // creep back into the rate limiter. THE FLOOR IS delayFloorMs, not
    // RATE.minDelayMs: the whole point of raising it on a 429 is that the
    // decay is not allowed to undo it.
    ({ delayMs, floorMs: delayFloorMs } = stepRateController(
      { delayMs, floorMs: delayFloorMs }, "ok"));
    const body = await response.json();
    return Array.isArray(body) ? body : (body && body.data) || [];
  }
  throw new Error(`${path} -> exhausted retries`);
}

/* ---------- universe -------------------------------------------- */

function eligible(row) {
  const price = num(row.close);
  const cap = num(row.marketcap);
  const callVol = num(row.call_volume);
  const putVol = num(row.put_volume);
  const oi = num(row.total_open_interest) ||
             (num(row.call_open_interest) + num(row.put_open_interest));

  if (row.is_index === true) return false;
  if (UNIVERSE.excludeIssueTypes.includes(row.issue_type)) return false;
  if (!(price >= UNIVERSE.minPrice)) return false;
  if (!(cap >= UNIVERSE.minMarketCap)) return false;
  if (!(callVol + putVol >= UNIVERSE.minOptionVolume)) return false;
  if (!(oi >= UNIVERSE.minOpenInterest)) return false;
  return true;
}

/**
 * The cheap universe-wide tilt: one screener call, no per-name fan-out.
 * This is the baseline every expensive measure has to beat, and it is
 * also what SELECTS which names get enriched — so its quality bounds
 * the whole board. Worth stating plainly rather than hiding.
 *
 * net_put_premium positive means put BUYING (ask side minus bid side),
 * which is bearish, so the composite subtracts it.
 */
function screenerTilt(row) {
  const bull = num(row.bullish_premium);
  const bear = num(row.bearish_premium);
  const netCall = num(row.net_call_premium);
  const netPut = num(row.net_put_premium);

  const gross = Math.abs(bull) + Math.abs(bear);
  const premiumTilt = gross > 0 ? (bull - bear) / gross : null;

  /* EVERY tilt is made unit-free here, against the name's own scale.
     robustZ normalises a column across the cross-section but cannot undo the
     fact that a mega-cap's ordinary session carries a hundred times the raw
     dollars of a mid-cap's event: z-scoring a dollar column ranks market caps
     with a flow-shaped wobble on top. neutralize() removes the LINEAR log-cap
     component from the blend afterwards, which is a much weaker instrument
     than never letting the size in. */
  const grossPremium = Math.abs(num(row.call_premium)) + Math.abs(num(row.put_premium));
  const netTilt = grossPremium > 0 ? (netCall - netPut) / grossPremium : null;

  /* Volume surprise relative to the name's own 30-day norm, so a
     mega-cap's ordinary Tuesday does not outrank a real event. A side with no
     norm is UNMEASURED, not average: the old fallback of 1 published a
     balanced surpriseTilt of exactly 0 for a name the vendor never averaged,
     and 0 is a real reading of this field ("as much call as put surprise"). */
  const callSurprise = num(row.avg_30_day_call_volume) > 0
    ? num(row.call_volume) / num(row.avg_30_day_call_volume) : null;
  const putSurprise = num(row.avg_30_day_put_volume) > 0
    ? num(row.put_volume) / num(row.avg_30_day_put_volume) : null;

  // Open-interest change: what actually stuck from yesterday, as a share of
  // the standing book rather than in raw contracts.
  const callOiChange = num(row.call_open_interest) - num(row.prev_call_oi);
  const putOiChange = num(row.put_open_interest) - num(row.prev_put_oi);
  const oiBase = num(row.total_open_interest) ||
    (num(row.call_open_interest) + num(row.put_open_interest));

  /* AGGRESSOR-SIDE VOLUME, in contracts. The premium tilts are size-weighted
     by option price, so one deep-ITM print can outweigh ten thousand cheap
     ones; the contract count is a genuinely different view of the same tape
     and the screener has been returning it, unread, all along. */
  const callVol = num(row.call_volume);
  const putVol = num(row.put_volume);
  const volBase = callVol + putVol;
  const volTilt = volBase > 0
    ? ((num(row.call_volume_ask_side) - num(row.call_volume_bid_side)) -
       (num(row.put_volume_ask_side) - num(row.put_volume_bid_side))) / volBase
    : null;

  const iv30 = num(row.iv30d, NaN);
  return {
    premiumTilt,
    netTilt,
    volTilt,
    surpriseTilt: (callSurprise === null || putSurprise === null)
      ? null : Math.log((callSurprise + 0.1) / (putSurprise + 0.1)),
    oiTilt: oiBase > 0 ? (callOiChange - putOiChange) / oiBase : null,

    /* The volatility surface, all of it already paid for by the one screener
       call and all of it previously computed and thrown away. */
    iv30: Number.isFinite(iv30) ? iv30 : null,
    ivMomentum: Number.isFinite(iv30) ? iv30 - num(row.iv30d_1w, NaN) : null,
    /* THE OTHER TWO POINTS OF THE SAME STRIP, on the wire since the first
       screener call and read by nothing. iv30d_1w was already used to make
       ivMomentum a difference; _1d and _1m turn the same field into a
       four-point history of this name's own 30-day implied vol — the cheapest
       volatility series in the product, at zero additional calls. */
    iv30d1d: num(row.iv30d_1d, NaN),
    iv30d1m: num(row.iv30d_1m, NaN),
    ivRank: ivRankFraction(row.iv_rank),
    impliedMovePerc: num(row.implied_move_perc, NaN),
    impliedMove: num(row.implied_move, NaN),
    atmVol: num(row.volatility, NaN),
    relVolume: num(row.relative_volume, NaN),
    putCallRatio: num(row.put_call_ratio, NaN),
    /* THE TWO SURPRISE RATIOS, RETURNED RATHER THAN RECOMPUTED. Both are
       computed above with the null-on-absent-average guard the comment there
       explains, and until now neither left this function — only the log-ratio
       built from them did. /flows/unusual/ needs the ratios themselves, and a
       second implementation of `call_volume / avg_30_day_call_volume` in
       another file would be a second chance to reintroduce the fallback-to-1
       bug this repo has already shipped once. Reused, not reimplemented. */
    callSurprise,
    putSurprise,
    week52High: num(row.week_52_high, NaN),
    week52Low: num(row.week_52_low, NaN),
  };
}

/**
 * iv_rank as a FRACTION, because the vendor publishes it as a percentile.
 *
 * The endpoint reference documents iv_rank as "The 30 day implied volatility
 * from 1 month ago", example 0.2136848270893097 — which is iv30d_1m's
 * description and iv30d_1m's example, not iv_rank's. The vendor's own OpenAPI
 * schema explains why: iv_rank is declared as `$ref: 'Stock IV 30d 1M'`, so
 * every generated doc inherits the wrong field's text.
 *
 * The screener's own EXAMPLE OBJECT is the only place the truth appears, and it
 * is unambiguous: `iv_rank: '13.52369891956068210400'` sits beside
 * `iv30d: '0.2038...'` in the same response. iv_rank is on 0..100.
 *
 * Read as a fraction it would have printed "1352% of its year" on the card.
 * The scoring was unharmed either way — percentileRank is scale-invariant —
 * which is exactly why only the display would have shown it.
 *
 * The <= 1 branch is not defensive clutter: a percentile of 0.5 is ambiguous
 * between the two conventions, and treating it as already-a-fraction is the
 * reading that cannot produce a nonsense number.
 */
function ivRankFraction(raw) {
  const v = num(raw, NaN);
  if (!Number.isFinite(v) || v < 0) return NaN;
  return v > 1 ? v / 100 : v;
}

/**
 * Calendar days until earnings, or null. Used to gate, never to predict.
 *
 * MEASURED FROM A DATE, NOT FROM AN INSTANT, and that is a fix rather than a
 * restatement. This took `Date.now()` and rounded
 * `(earnings_at_midnight − now) / a day`, which makes the answer a function of
 * THE MINUTE THE JOB HAPPENED TO FIRE: the same name, the same earnings date,
 * and a runner that started at 05:15 rather than 05:47 could land on either
 * side of the twelve-day gate. Nobody chose that; it fell out of rounding a
 * fractional day.
 *
 * IT ALSO MADE TWO PUBLISHED COUNTS ARITHMETICALLY IMPOSSIBLE. /flows/events/
 * publishes this number as `dte` beside `sdte`, the weekday count over the
 * same span, both measured from the run's Eastern date. With this reading
 * against an instant and that one against midnight — origins about 21 hours
 * apart — the WEEKDAY count overtook the CALENDAR count containing it on 8 of
 * 60 rows. A subset cannot be larger than its superset, so no design choice
 * licenses it; the contract suite refused to pass and was right to.
 *
 * THIS CHANGES WHICH NAMES THE BOARD SCORES, at the margin. A name whose
 * report sits exactly `EARNINGS_GATE_DAYS` away, measured from midnight
 * rather than from the firing minute, can now fall on the other side of the
 * gate. That is the correct behaviour — "reporting within twelve days" is a
 * statement about dates — and it is a behaviour change, not a refactor.
 *
 * @param {string} origin — an ISO date, `easternNow().date`. The gate belongs
 *   to the session's own calendar day, which is also the origin every day
 *   count on /flows/events/ is stated against.
 */
function daysToEarnings(row, origin) {
  if (!row.next_earnings_date) return null;
  const t = Date.parse(row.next_earnings_date + "T00:00:00Z");
  const from = Date.parse(String(origin || "") + "T00:00:00Z");
  if (!Number.isFinite(t) || !Number.isFinite(from)) return null;
  return Math.round((t - from) / 86400000);
}

/* ---------- per-name enrichment --------------------------------- */

/**
 * PROVE THE NEW PARAMETERS WORK BEFORE BETTING THE RUN ON THEM.
 *
 * Dating every per-name call is the fix for a board stamped with the wrong
 * session and a family that measured nothing — and it is also a way to lose
 * the whole run. A date the vendor will not accept, or a session it has no
 * data for, does not error: it returns an empty array. Every name then fails
 * the required-source gate, the 80% completeness gate throws, and nothing
 * publishes at all. The undated behaviour was wrong but it was not an outage.
 *
 * Two calls against SPY settle it. `date` is checked for USABLE output rather
 * than a 200, because the exact failure that started this was a 200 carrying
 * rows whose greeks were null. When a probe fails the run continues with that
 * parameter dropped, loudly, rather than publishing nothing.
 */
async function verifyDating(sessionDate) {
  if (!sessionDate || DRY_RUN) return { date: !!sessionDate, endDate: !!sessionDate };

  /* THROUGH THE SAME LEG READERS THE CARD USES. Asking a different question
     than the consumer asks is how a probe reports healthy against a panel that
     is empty: this one passed `date` while every card printed "no expiry
     gamma", because both sides read the documented names and the wire sends
     call_gex / put_gex. */
  const usable = (rows) => (rows || []).some(
    (r) => r && r.expiry && (num(callGammaLeg(r)) !== 0 || num(putGammaLeg(r)) !== 0));

  /* A SINGLE-NAME EQUITY, not SPY. The first version probed SPY because it is
     the most liquid thing listed — and got no usable expiry gamma from it
     either dated or undated, which says nothing about the `date` parameter and
     everything about that instrument on that endpoint. An ETF is exactly the
     wrong control for a question about single-name option chains. */
  const PROBE = "AAPL";

  const [dated, undated, capped] = await Promise.all([
    uw(`/api/stock/${PROBE}/greek-exposure/expiry`, { date: sessionDate }).catch(() => []),
    uw(`/api/stock/${PROBE}/greek-exposure/expiry`).catch(() => []),
    uw(`/api/stock/${PROBE}/ohlc/1d`, { timeframe: "1M", end_date: sessionDate }).catch(() => []),
  ]);

  /* ONLY DISTRUST `date` WHEN THE UNDATED CALL DEMONSTRABLY DOES BETTER.

     The first version dropped the parameter whenever the dated call came back
     unusable — including when the undated one was unusable too, which is the
     case where the probe has learned NOTHING. That fired on the first live run:
     both calls returned no usable gamma, so the guard concluded `date` was at
     fault and reverted the whole run to the undated behaviour it was written to
     replace. A probe that cannot distinguish the two hypotheses must not act. */
  const date = usable(dated) || !usable(undated);
  const endDate = Array.isArray(capped) && capped.length > 0;

  if (!usable(dated) && !usable(undated)) {
    console.warn(
      `NOTE: ${PROBE} /greek-exposure/expiry returns no usable gamma either dated ` +
      `(${sessionDate}) or undated, so this probe cannot tell whether \`date\` is at ` +
      "fault. Keeping `date` — the dated call is the one that is correct by " +
      "construction. The gamma roll-off panel will be unavailable on every card " +
      "until that endpoint returns greeks; see the shape report below.");
  } else if (!date) {
    console.warn(
      `WARNING: /greek-exposure/expiry?date=${sessionDate} returns no usable gamma for ` +
      `${PROBE} while the undated call does — dropping \`date\` for this run. The board ` +
      "will carry whatever session the vendor defaults to, which is the behaviour " +
      "that mislabelled it before.");
  }
  if (!endDate) {
    console.warn(
      `WARNING: /ohlc/1d?end_date=${sessionDate} returned no candles for ${PROBE} — ` +
      "dropping `end_date` for this run. Candles will include the session in progress.");
  }

  /* REPORT WHAT THE ENDPOINT ACTUALLY SENT, once, when it sent nothing usable.
     Every other defect in this pipeline was found by reading a real payload
     rather than reasoning about one; a source that quietly yields nothing
     deserves the same treatment. One row, keys and truncated values, so the
     next run turns a mystery into an observation. */
  if (!usable(dated) || !usable(undated)) {
    for (const [label, rows] of [["dated", dated], ["undated", undated]]) {
      const arr = Array.isArray(rows) ? rows : [];
      if (!arr.length) { console.warn(`  ${PROBE} expiry ${label}: 0 rows`); continue; }
      const shape = Object.entries(arr[0])
        .map(([k, v]) => `${k}=${v === null ? "null" : String(v).slice(0, 14)}`)
        .join(" ");
      console.warn(`  ${PROBE} expiry ${label}: ${arr.length} rows, first: ${shape}`);
    }
  }

  return { date, endDate };
}


async function enrich(ticker, spot, sessionDate, dating = { date: true, endDate: true }) {
  const band = spot > 0
    ? { min_strike: Math.round(spot * 0.7), max_strike: Math.round(spot * 1.3) }
    : {};

  /* ONE SESSION, named explicitly, for all five sources.
     Every call used to go out undated, and the five endpoints did not agree
     about which day that meant: /net-prem-ticks returned a complete prior
     session while /ohlc/1d returned a candle stamped for a day that had not
     opened, so the board was headed with the wrong date. Worse,
     /greek-exposure/expiry is an end-of-day open-interest aggregate — asked
     for a session that has not happened it returns rows with null greeks,
     which is exactly how family V came out identically zero on all thirty-four
     published names while coverage went on reporting five sources of five. */
  const dated = sessionDate && dating.date ? { date: sessionDate } : {};

  // Bounding the strike ladder is what makes per-name enrichment
  // affordable: an unbanded ladder is ~600 KB, a banded one a fraction.
  const [greekFlow, ticks, strikes, expiries, ohlc] = await Promise.all([
    uw(`/api/stock/${ticker}/greek-flow`, dated).catch(() => []),
    uw(`/api/stock/${ticker}/net-prem-ticks`, dated).catch(() => []),
    uw(`/api/stock/${ticker}/spot-exposures/strike`, { ...band, ...dated, limit: 500 }).catch(() => []),
    uw(`/api/stock/${ticker}/greek-exposure/expiry`, dated).catch(() => []),
    /* A YEAR of candles rather than two months, for no extra call: the
       sparkline, the 5/21/42-session returns, the 30-day realized vol behind
       the variance risk premium and the 52-week position all come out of this
       one response. end_date pins it to the same session as the rest. */
    uw(`/api/stock/${ticker}/ohlc/1d`, {
      timeframe: "1Y",
      ...(sessionDate && dating.endDate ? { end_date: sessionDate } : {}),
    }).catch(() => []),
  ]);

  /* A missing source is NOT a zero.
     Each call above is individually caught, so enrich() could not throw and
     the completeness gate — which counts only thrown exceptions — reported
     100% for a name that had lost four of its five sources. Worse, the zeros
     were not neutral: a missing greek-flow gives otmShare = 0 and vegaTilt = 0,
     which is the TOP of family O's winsorized column, so losing the data
     scored BETTER than having it. A name that cannot be measured must be
     dropped, not ranked.

     greek-flow carries families F and O, spot-exposures carries P, and the
     candles carry both the ATR that normalises every distance and the dollar
     volume the liquidity floor needs. Those three are required. Ticks (family
     D) and expiries (family V) degrade coverage instead, which conviction
     already discounts. */
  /* WHAT ELSE IS ON A TICK ROW. /net-prem-ticks documents thirteen fields per
     minute and this pipeline reads four of them; the other nine have never
     been looked at, and one of them may be the bid/mid/ask split that would
     let the session path separate a lifted tape from a hit one. PROBE ONLY —
     nothing here is published, because a field whose semantics are guessed is
     exactly how call_gex shipped wrong five times. One row, once per run. */
  if (!tickFieldsReported && ticks.length) {
    tickFieldsReported = true;
    for (const line of describeTickFields(ticker, ticks[0])) console.log(line);
  }

  /* THE SAME PROBE, ON THE ENDPOINT THAT HAS ALREADY LIED ONCE.

     /greek-exposure/expiry is where `call_gamma` turned out to be `call_gex`
     on the wire, and every gamma roll-off panel shipped "unavailable" for
     weeks as a result. The vanna, charm and delta readers added beside it are
     written from the SAME schema block that got gex right — which makes that
     block evidence rather than a claim, but not a measurement.

     So the first live run says which of the eight legs actually arrived,
     printed once, from the row this run already holds. If a leg is missing
     the term structures publish `absent` with a reason and nothing is drawn;
     this line is how that turns into a two-minute fix rather than a mystery. */
  if (!greekFieldsReported && expiries.length) {
    greekFieldsReported = true;
    const first = expiries[0] || {};
    const keys = Object.keys(first);
    const legs = ["call_gex", "put_gex", "call_delta", "put_delta",
      "call_charm", "put_charm", "call_vanna", "put_vanna"];
    const present = legs.filter((k) => first[k] !== null && first[k] !== undefined && first[k] !== "");
    const absent = legs.filter((k) => !present.includes(k));
    console.log(`  greek-exposure/expiry fields (${ticker}): ${keys.length} keys, ` +
      `${present.length} of ${legs.length} expected legs present`);
    if (absent.length) console.log(`    ABSENT legs: ${absent.join(", ")}`);
    const unread = keys.filter((k) => !legs.includes(k) && k !== "expiry" && k !== "date" && k !== "dte");
    if (unread.length) console.log(`    unread keys: ${unread.slice(0, 12).join(", ")}`);
    /* Signs, because the put leg's convention differs BY GREEK on this
       endpoint and that is the one thing a schema block cannot be trusted
       for — netting under the wrong convention inverts a whole Greek. */
    const sign = (v) => (v === null || v === undefined || v === "" ? "-" : (Number(v) < 0 ? "neg" : "pos"));
    console.log(`    signs: gex ${sign(first.call_gex)}/${sign(first.put_gex)} ` +
      `charm ${sign(first.call_charm)}/${sign(first.put_charm)} ` +
      `vanna ${sign(first.call_vanna)}/${sign(first.put_vanna)} ` +
      `delta ${sign(first.call_delta)}/${sign(first.put_delta)} (call/put)`);
  }

  const missing = [];
  if (!greekFlow.length) missing.push("greek-flow");
  if (!strikes.length) missing.push("spot-exposures/strike");
  if (!ohlc.length) missing.push("ohlc/1d");
  if (missing.length) throw new Error(`no data from ${missing.join(", ")}`);

  /* The raw arrays are RETAINED, not discarded.

     computeFeatures reduces four multi-hundred-row responses to twenty-odd
     scalars and the arrays were thrown away — so the card reader looked like
     it needed a twelve-call-per-name fan-out when in fact the gamma ladder,
     the tick tape, the expiry gamma and the candles are already paid for. The
     highest-value panels cost nothing extra; only max-pain and the congress
     filings are new. */
  return {
    features: computeFeatures({ ticker, spot, greekFlow, ticks, strikes, expiries, ohlc, sessionDate }),
    raw: { greekFlow, ticks, strikes, expiries, ohlc },
  };
}

/**
 * THE TRADING SESSION THE DATA DESCRIBES, resolved once and pinned.
 *
 * This used to be read back out of whatever the enrichment happened to
 * return — the newest parseable candle across every name — on the stated
 * premise that "every endpoint called without a date returns the most recent
 * COMPLETED session". That premise is false for /ohlc/1d, which returns a
 * candle stamped for the day in progress. The published INTC card proved it:
 * generated 08:01 Eastern, stamped sessionDate 2026-08-25, carrying a tick
 * tape of 390 minutes beginning 2026-08-24 09:30 — a complete prior session
 * under the wrong date.
 *
 * Resolve it FIRST, from one call, so the same date can be handed to every
 * per-name source; then all five describe one session by construction rather
 * than by hope. A candle stamped for today is a partial session until the
 * 16:00 Eastern close, so it is not eligible before then.
 */
async function resolveSessionDate() {
  const candles = await uw("/api/stock/SPY/ohlc/1d", { timeframe: "1M" }).catch(() => []);
  const dates = candlesAscending(candles)
    .map((c) => String(c.start_time || c.end_time || c.date || "").slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!dates.length) return null;

  const now = easternNow();
  const complete = dates.filter((d) => d < now.date || (d === now.date && now.minutes >= 16 * 60));
  if (complete.length) return complete[complete.length - 1];
  // Every candle we have is for a session still in progress. Step back one.
  return dates.length > 1 ? dates[dates.length - 2] : null;
}

/** Today's Eastern calendar date and minutes-since-midnight, DST included. */
function easternNow(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    // Some ICU builds render midnight as hour 24 under hour12:false.
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

/**
 * Median daily dollar volume over the candle window. Median rather than mean
 * so a single earnings-day volume spike cannot lift an otherwise illiquid
 * name over the floor.
 */
function medianDollarVolume(candles, { window = 60 } = {}) {
  /* THE RECENT WINDOW, not the whole series.

     This used to take the median over every candle it was handed, which was a
     two-month request. The candle window then went to a year — for the
     sparkline, the 52-week range and the realized-vol baseline, all free in the
     same call — and silently took the liquidity floor with it.

     That is the wrong direction for THIS measure. A year-old median is more
     robust statistically and less true operationally: the floor exists to say
     whether a name can be traded at these costs TODAY, and a name whose volume
     halved six months ago would still clear it on the strength of what it used
     to do. Sixty sessions is about a quarter — long enough that one event week
     cannot carry it, recent enough to describe the book a reader would actually
     be trading into.

     Median rather than mean for the same reason as before: a single
     halt-and-resume spike must not lift an illiquid name over the floor. */
  const values = candlesAscending(candles).slice(-window)
    .map((c) => num(c.close) * num(c.volume))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (!values.length) return 0;
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/**
 * Sort candles oldest-first.
 *
 * The vendor does not document the order /ohlc returns, and every consumer
 * here assumes oldest-first: atr14 runs Wilder's forward recursion and uses
 * each bar's PREVIOUS close, and both take the newest window off the end. If
 * the response is newest-first, `.slice(-40)` silently keeps the OLDEST bars
 * and the recursion runs backwards through time. Rather than depend on an
 * undocumented convention, sort explicitly — correct under either.
 */
function candlesAscending(candles) {
  const rows = (candles || []).map((c) => ({
    c,
    t: Date.parse(c.start_time || c.end_time || c.date || ""),
  }));
  // If no candle carries a parseable timestamp there is nothing to sort by;
  // fall back to the given order rather than discarding the whole series.
  if (!rows.some((r) => Number.isFinite(r.t))) return candles || [];
  return rows
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t)
    .map((r) => r.c);
}

/** Wilder's ATR(14) — the sigma unit for distance-to-spot. */
function atr14(candles) {
  const rows = candlesAscending(candles).slice(-40).map((c) => ({
    h: num(c.high), l: num(c.low), c: num(c.close),
  })).filter((r) => r.h > 0);
  if (rows.length < 15) return 0;
  let atr = 0;
  for (let i = 1; i < rows.length; i++) {
    const tr = Math.max(
      rows[i].h - rows[i].l,
      Math.abs(rows[i].h - rows[i - 1].c),
      Math.abs(rows[i].l - rows[i - 1].c),
    );
    atr = i === 1 ? tr : (13 * atr + tr) / 14;
  }
  return atr;
}

function computeFeatures({ ticker, spot, greekFlow, ticks, strikes, expiries, ohlc, sessionDate, tilt }) {
  const purity = flowPurity(greekFlow);
  const quality = positioningQuality(greekFlow);
  const gamma = aggressorGamma(strikes, { spot });
  const atr = atr14(ohlc);
  const displacement = bookDisplacement(strikes, atr);
  const path = pathSignature(ticks);
  const calendar = gammaDecayCalendar(expiries, { asOf: sessionDate });

  const dollarVolume = medianDollarVolume(ohlc);   // last 60 sessions, not the year

  const closes = candlesAscending(ohlc).map((c) => num(c.close));
  /* 21 SESSIONS, NOT 30, because the implied leg is a THIRTY-CALENDAR-DAY
     figure. Both are annualized, so the units already agree; what did not
     agree was the window — 30 trading sessions spans about 42 calendar days,
     so the premium was comparing six weeks of delivered volatility against
     four weeks of priced volatility. Twenty-one sessions is the usual count
     in thirty calendar days. */
  const rv30 = realizedVol(closes, { window: 21 });
  const iv30 = tilt && Number.isFinite(tilt.iv30) ? tilt.iv30 : null;

  const flipDist = gamma.flip && spot > 0 ? (gamma.flip - spot) / spot : null;

  /* COVERAGE counts USABLE OUTPUT, not array length.
     enrich()'s own docstring commits to "a missing source is NOT a zero"; a
     source that returns rows which every downstream filter then drops defeats
     that in exactly the same way, and did — the vendor returned expiry rows
     with null greeks, gammaDecayCalendar dropped all of them, family V was
     identically zero on all 34 published names, and coverage still reported
     5/5 so conviction paid full price for a source that produced nothing. */
  const usable = [
    greekFlow.length > 0,
    path.bars > 0,
    gamma.ladder.length > 0,
    calendar.schedule.length > 0,
    ohlc.length > 0,
  ];

  return {
    ticker,
    spot,
    atr,
    dollarVolume,
    sessionDate: sessionDate || null,

    // --- flow, unit-free ---
    purity: purity.purity,
    dirDelta: purity.dirDelta,
    dirShare: purity.dirShare,
    otmShare: quality.otmShare,
    vegaTilt: quality.vegaTilt,
    hasView: quality.hasDirectionalView,

    // --- dealer positioning ---
    netGamma: gamma.netGamma,
    gammaPeak: gamma.peak,
    gammaFlip: gamma.flip,
    flipSide: gamma.flipSide,
    flipCount: gamma.crossings.length,
    // The thinner of the two regimes the published flip divides, as a share of
    // the ladder's peak. A weak boundary is still a boundary; the card says so.
    flipSeparation: gamma.flipSeparation,
    spotGammaShare: gamma.spotGammaShare,
    bandMin: gamma.bandMin,
    bandMax: gamma.bandMax,
    flipDist,
    flipDistAtr: gamma.flip && atr > 0 ? (gamma.flip - spot) / atr : null,
    /* The regime AT SPOT, which is the question the netGamma sign was being
       asked to answer. netGamma is the whole band's total; what a hedger
       responds to is the gamma where the stock actually is. */
    gRegime: gamma.spotGammaShare === null
      ? (gamma.netGamma >= 0 ? "long" : "short")
      : (gamma.spotGammaShare >= 0 ? "long" : "short"),
    displacement: displacement.displacement,
    displacementWeight: displacement.weight,

    // --- path ---
    persistence: path.persistence,
    concentration: path.concentration,
    centroid: path.centroid,
    pathNet: path.net,
    pathBars: path.bars,

    // --- gamma term structure ---
    gammaHalfLife: calendar.halfLifeExpiry,
    gammaHalfLifeDays: calendar.halfLifeDays,
    gammaMeanLifeDays: calendar.meanLifeDays,
    gammaFrontLoad: calendar.frontLoad,

    // --- volatility, entirely from data already fetched ---
    iv30,
    rv30,
    /* THE VARIANCE RISK PREMIUM. iv30d is the 30-day implied vol the screener
       already returns; rv30 is close-to-close realized vol over the same 30
       sessions, from the candles fetched for ATR. Both are annualized vols of
       the same underlying over the same horizon, so the difference is
       identified with no free parameter and no extra API call: positive means
       the option market is charging more than the stock has been delivering. */
    vrp: iv30 !== null && rv30 !== null ? iv30 - rv30 : null,
    ivMomentum: tilt && tilt.ivMomentum !== null ? tilt.ivMomentum : null,
    ivRank: tilt && Number.isFinite(tilt.ivRank) ? tilt.ivRank : null,
    /* The vendor's own at-the-money vol, and this name's 30-day implied vol at
       four points of its own recent history. Both were parsed by screenerTilt
       and dropped here; neither costs a call. Ordered oldest first. */
    atmVol: tilt && Number.isFinite(tilt.atmVol) ? tilt.atmVol : null,
    ivStrip: tilt ? [
      { h: "−1m", v: Number.isFinite(tilt.iv30d1m) ? tilt.iv30d1m : null },
      { h: "−1w", v: Number.isFinite(tilt.iv30) && Number.isFinite(tilt.ivMomentum)
        ? Number((tilt.iv30 - tilt.ivMomentum).toFixed(4)) : null },
      { h: "−1d", v: Number.isFinite(tilt.iv30d1d) ? tilt.iv30d1d : null },
      { h: "now", v: Number.isFinite(tilt.iv30) ? tilt.iv30 : null },
    ] : null,
    impliedMovePerc: tilt && Number.isFinite(tilt.impliedMovePerc) ? tilt.impliedMovePerc : null,

    // The last 42 sessions of closes, retained so the deck's sparkline and
    // its 5/21/42-session returns cost nothing: these candles were already
    // fetched for ATR, the liquidity floor and the realized-vol baseline.
    closes: closes.slice(-42),
    /* THE DATES THOSE CLOSES BELONG TO, from the same slice of the same
       candles. Without them `closes` is a positional array and every reader
       is forced to treat INDEX as time — which is true only while no session
       is missing, and the card's own filter drops any that are. Nothing could
       put the daily-close score on the same axis as price because there was
       no key to join on. candleDate is already used three times in this file;
       this costs one more map over candles held in memory. */
    closeDates: candlesAscending(ohlc).slice(-42).map(candleDate),
    /* Computed from the FULL year, not from the 42 retained for the
       sparkline: a 42-session return needs 43 closes, so reading it back out
       of the 42-element slice resolved to null on every name. */
    r5: ret(closes, 5),
    r21: ret(closes, 21),
    r42: ret(closes, 42),
    week52Pos: week52Position(closes),

    coverage: usable.filter(Boolean).length / usable.length,
    sources: {
      greekFlow: greekFlow.length,
      ticks: path.bars,
      strikes: gamma.ladder.length,
      expiries: calendar.schedule.length,
      candles: ohlc.length,
    },
  };
}

/* ---------- scoring ---------------------------------------------
   THREE SIGNED AXES and TWO GAUGES, not five families of votes.

   The five-family blend that shipped had a structural fault that its own
   comment describes and does not fix. Three of its ten columns were unsigned
   magnitudes multiplied by sign(dirDelta) so they could be ADDED to a signed
   sum. Measured on the pipeline's own cross-section, those columns were 95%
   sign(dirDelta) by correlation, they carried the negative sign and a quarter
   of the weight, and the composite came out with corr(blend, dirDelta) =
   -0.07: the long board was ranking AGAINST its own directional flow signal.

   A magnitude that carries no direction of its own is a MODIFIER. Modifiers
   multiply. So:

     signed axes   F (flow), P (positioning), D (path)   -- added, z-scored
     gate          O (quality)                           -- multiplies
     context       V (vol regime)                        -- published, unscored

   V is published and not scored on purpose. There is no identified sign that
   turns "implied vol is rich" into "this name goes up", and the family that
   used to be called "vol" contained no volatility at all — its single column
   was the first expiry's share of gross dealer gamma. Rather than keep a
   directional claim nobody can defend, the volatility surface is measured
   properly (variance risk premium, IV rank, IV innovation) and shown as
   regime context beside the score.
*/

const FAMILIES = {
  F: "flow",          // SIGNED — directional flow, unit-free
  P: "positioning",   // SIGNED — where new dealer gamma is building
  D: "path",          // SIGNED — intraday accumulation shape
  V: "vol",           // GAUGE  — volatility regime, 0..100, no direction
  O: "quality",       // GAUGE  — the multiplicative gate, 0..100
};

/** The signed axes. Only these three enter the composite additively. */
const SIGNED = ["F", "P", "D"];

/**
 * The dead band, in published score points.
 *
 * partitionSides used to split at the MEDIAN, unconditionally, so exactly half
 * the pool was labelled long and half short whatever the day looked like: on
 * the live board GOOGL scored -2 and was published as a short candidate
 * because rank 18 of 34 fell on the short side of the median. A board with no
 * neutral state cannot report a quiet session.
 *
 * This is a PRESENTATION threshold, not an identification claim: a name whose
 * score is inside the band is not shown on either board. Published in the
 * payload so the reader can see the bar that was applied.
 *
 * TWENTY WAS CALIBRATED AGAINST A POOL THAT NO LONGER EXISTS. When the pool
 * was sixty tilt-EXTREMES, a score of 20 was an ordinary reading and a band
 * that wide still left most names outside it. Against a stated size cohort the
 * same threshold swallows the middle of the market: on the first dry run of
 * the expanded pool, 71 of 100 names fell inside it and the board published 29.
 * Widening the universe and keeping the band would have answered "show me more
 * names" by measuring more names and showing the same few.
 *
 * ONE, NOT ZERO. Zero would leave a score of exactly 0 — a real outcome, not a
 * rounding artefact — with no side to belong to, and it would have to be
 * assigned arbitrarily. At 1 the exact zero has an unambiguous home on the
 * watch board, and |s| >= 1 is a residual of about 0.018 sigma: a bar low
 * enough to be honest about being a formality, which is what it now is.
 */
const DEAD_BAND = 1;

/**
 * THE BOARD PAYLOAD'S SCHEMA VERSION, on the same rule as the card's: bump when
 * a field's MEANING changes. Version 2 is where fam.V and fam.O stopped being
 * signed votes and became unsigned gauges, and where `s` stopped being a rank
 * relabeling and became a fixed-unit score. A board published before this
 * renders its family glyph without those two, rather than drawing a gauge as
 * though it were a direction.
 */
const BOARD_SCHEMA_VERSION = 2;

function scoreBoard(features, tilts, sectors, caps) {
  const n = features.length;
  if (!n) return [];

  // A column is built from a per-name accessor that may return null for
  // "not measured". null becomes NaN, robustZ ignores it when finding the
  // median and the MAD, and emits 0 for it — the neutral vote, not the worst.
  const raw = (fn) => features.map((f, i) => {
    const v = fn(f, tilts[i], i);
    return v === null || v === undefined || !Number.isFinite(v) ? NaN : v;
  });
  const z = (fn) => robustZ(winsorize(raw(fn), 0.02));

  /* ---- F, flow. Every column is a RATIO, bounded and unit-free, so the
     cross-section compares flow rather than market capitalisation. ---- */
  const fDelta = z((f) => f.dirShare);          // net directional delta / gross delta
  const fTilt = z((f, t) => t.premiumTilt);     // bullish vs bearish premium
  const fNet = z((f, t) => t.netTilt);          // net premium / gross premium
  const fOi = z((f, t) => t.oiTilt);            // OI change / standing book
  const fVol = z((f, t) => t.volTilt);          // aggressor-side contract count

  /* ---- P, positioning. Displacement is already in ATR units and is the one
     genuinely SIGNED quantity in the gamma block: it says which way today's
     flow is moving the book relative to where the book already is. ---- */
  const pDisp = z((f) => (f.displacementWeight > 0 ? f.displacement : null));

  /* ---- D, path. Signed by the day's own net direction, discounted when all
     of it arrived in one spike. ---- */
  const dPath = z((f) =>
    (f.pathBars > 0 ? Math.sign(f.pathNet) * f.persistence * (1 - f.concentration) : null));

  const familyCols = {
    F: [fDelta, fTilt, fNet, fOi, fVol],
    P: [pDisp],
    D: [dPath],
  };

  /* ---- weights. Two levels of the same n_eff algebra.

     Within a family, effectiveBreadth discounts columns that restate each
     other — and now refuses to pay for a column with no dispersion at all,
     which is how a dead family drew a live family's weight.

     BETWEEN families, crossFamilyRedundancy does the same thing one level up.
     effectiveBreadth was only ever called with one family's own columns, so
     it was structurally incapable of seeing that the two most correlated
     columns on the board lived in different families. ---- */
  const familyScores = {};
  for (const [key, cols] of Object.entries(familyCols)) {
    const live = cols.filter(isLiveColumn);
    familyScores[key] = live.length
      ? features.map((_, i) => live.reduce((a, c) => a + c[i], 0) / live.length)
      : null;                                   // absent, not neutral
  }

  const liveKeys = SIGNED.filter((k) => familyScores[k] !== null);
  const redundancy = crossFamilyRedundancy(
    Object.fromEntries(liveKeys.map((k) => [k, familyScores[k]])));

  const weights = {};
  let weightTotal = 0;
  for (const key of liveKeys) {
    const w = effectiveBreadth(familyCols[key]) / redundancy[key];
    weights[key] = w;
    weightTotal += w;
  }

  const blended = features.map((_, i) =>
    (weightTotal > 0
      ? liveKeys.reduce((a, k) => a + (weights[k] / weightTotal) * familyScores[k][i], 0)
      : 0));

  /* ---- O, the quality gate. Each axis is ORIENTED so larger is more
     trustworthy, then reduced to its cross-sectional percentile, so no axis
     needs a unit or a hand-set coefficient and a near-constant axis
     contributes almost nothing. The gate is bounded in (0,2) with a mean of
     one by construction, so it reallocates conviction across the board
     without inventing a scale — and it cannot flip a sign. ---- */
  const gateAxes = [
    raw((f) => f.purity),                          // directional share of the tape
    raw((f) => (f.otmShare === null ? null : -f.otmShare)),      // lottery tickets discount
    raw((f) => (f.vegaTilt === null ? null : -f.vegaTilt)),      // trading vol, not direction
    raw((f) => (f.gammaFrontLoad === null ? null : -f.gammaFrontLoad)), // regime expires soon
    /* Dealers SHORT gamma at spot amplify whatever the flow is pushing; long
       gamma damps it. Measured at spot rather than summed over the whole band,
       and expressed as a share of the ladder's peak so it is comparable across
       names. This is the amplification mechanism family P's old comment
       described and the code never contained. */
    raw((f) => (f.spotGammaShare === null ? null : -f.spotGammaShare)),
  ];
  const gate = qualityGate(gateAxes);

  const composite = blended.map((b, i) => b * gate[i]);

  // Neutralize against sector and size: the board should rank names against
  // their peers, not rediscover "semis were strong today".
  const logCap = caps.map((c) => (c > 0 ? Math.log(c) : 0));
  const residual = neutralize(composite, { numeric: [logCap], groups: sectors });

  /* ---- V, the volatility regime gauge. Published, never scored. Three
     percentiles averaged: how rich options are against delivered vol, where
     30-day IV sits in its own year, and whether it is rising. ---- */
  const volAxes = [
    raw((f) => f.vrp),
    raw((f) => f.ivRank),
    raw((f) => f.ivMomentum),
  ].filter(isLiveColumn).map(percentileRank);

  const dispersion = quantile(residual.map(Math.abs), 0.95);

  return features.map((f, i) => {
    const subs = {};
    for (const k of SIGNED) {
      subs[k] = familyScores[k] === null ? null : boundedScore(familyScores[k][i], SCORE_SCALE);
    }
    // Both gauges are 0..100 and carry NO sign. The card must not draw them
    // on the same centre-origin axis as F, P and D.
    subs.O = Math.round(50 * Math.min(gate[i], 2));
    const vs = volAxes.map((c) => c[i]).filter((v) => v !== null);
    subs.V = vs.length ? Math.round(100 * (vs.reduce((a, b) => a + b, 0) / vs.length)) : null;

    const conv = conviction({
      familyScores: SIGNED.map((k) => subs[k]),
      coverage: f.coverage,
      persistence: f.persistence,
    });
    return {
      ...f,
      residual: residual[i],
      gate: gate[i],
      score: boundedScore(residual[i], SCORE_SCALE),
      fam: subs,
      conviction: conv.conviction,
      agreement: conv.agreement,
      agree: conv.agree,
      breadth: conv.breadth,
      /* THE CLAMPED TERMS, taken from the returned object rather than from
         `f`. The scored row already carries f.coverage and f.persistence as
         they were measured; these are what the weighted sum actually used
         after clamping to [0,1], and publishing the wrong one of the two is
         how a reader's reconstruction of the composite fails to close on a
         name whose coverage came in above 1. */
      convCoverage: conv.coverage,
      convPersistence: conv.persistence,
      dispersion,
      weights,
    };
  });
}

/* ---------- payload --------------------------------------------- */

/**
 * Split the scored pool into two DISJOINT halves before either board is
 * built. Taking the top N and the bottom N of one sorted list looks
 * equivalent and is not: once the pool drops below 2*boardSize the two
 * slices overlap and a name appears on BOTH boards at once, presented as
 * simultaneously a top long and a top short candidate.
 *
 * That is reachable in normal operation, not a pathological case. With
 * enrichPerSide 30 the pool is 60 and the completeness gate passes at 80%,
 * i.e. 48 survivors — which overlaps by 2. At 40 survivors it overlaps by 10.
 *
 * Partitioning at the median makes the boards disjoint by construction at
 * any pool size, and a shrunken pool then yields a SHORTER board rather than
 * an incoherent one.
 */
function partitionSides(scored, { deadBand = DEAD_BAND } = {}) {
  /* Order on the FULL-PRECISION residual, not the rounded score. Under the old
     rank ladder two names could never tie — a 34-name board had 34 distinct
     values by construction — so sorting on `score` was safe by accident. Under
     a fixed unit two names round to the same integer routinely, and sorting on
     the rounded value hands the tie to Array.prototype.sort's stability rather
     than to the data. `score` is for display; `residual` decides. */
  const sorted = scored.slice().sort((a, b) => b.residual - a.residual);
  /* A DEAD BAND, not a median split.

     Splitting at the median made the board's length a constant and its
     contents a formality: exactly half the pool was labelled long and half
     short whatever the session looked like. On the live board that published
     GOOGL at -2 — the median name of thirty-four — as a short candidate,
     while its own share class GOOG sat fourth on the long board.

     Filtering on the score instead makes the two slices disjoint by
     construction at any pool size (the old comment's requirement is met a
     fortiori), and a quiet session now yields a SHORT board rather than a
     full one made of noise. */
  /* THE DEAD BAND WAS A COUNT AND NOTHING ELSE.

     Roughly 48 of 60 fully scored names land inside +-20 on a normal session,
     and every one of them was thrown away here — after five API calls, the
     liquidity floor, the issuer collapse and a full pass through the scorer.
     The payload said "48 neutral" and could not say WHICH 48, so a name sitting
     at 19 the session before it breaks out was indistinguishable from one
     sitting at 1, and the near-misses that are the most informative part of a
     quiet session were the only part not published.

     `neutral` STAYS AN INTEGER. It is a wire field the live board already
     renders, and changing a published field's TYPE under a renderer that
     reads it is the same class of break as renaming it: the deck would print a
     count as an array. The list arrives beside it under a new name, and the
     count is derived FROM the list so the two can never disagree — the failure
     mode of publishing both is a payload that says 48 above a list of 40. */
  const neutralRows = sorted.filter((r) => Math.abs(r.score) < deadBand);
  return {
    long: sorted.filter((r) => r.score >= deadBand),
    short: sorted.filter((r) => r.score <= -deadBand).reverse(),   // most negative first
    neutralRows,
    neutral: neutralRows.length,
    deadBand,
  };
}

/**
 * Collapse share classes of one issuer to a single row BEFORE scoring.
 *
 * GOOG and GOOGL are one company's cash flows with different voting rights.
 * Nothing in the pipeline knew that: the screener union keys on the raw
 * ticker string, the earnings gate, the liquidity floor and the scorer all
 * key on ticker, and neutralize() cannot help — an OLS projection on sector
 * and log-cap removes what the two share, and PRESERVES in full exactly the
 * idiosyncratic difference that put them on opposite boards.
 *
 * Identification: two listings of one issuer have the same company market
 * capitalisation, sit in the same sector, and their daily log returns differ
 * only by the liquidity of the two lines. Both conditions must hold. The
 * survivor is the more liquid line, which is the one a reader can trade.
 */
function collapseShareClasses(records, { minCorr = 0.97 } = {}) {
  const key = (e) => {
    const cap = num(e.row.marketcap);
    if (!(cap > 0)) return null;
    return (e.row.sector || "") + "|" + cap.toPrecision(6);
  };
  const groups = new Map();
  for (const e of records) {
    const k = key(e);
    if (k === null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const dropped = [];
  const remove = new Set();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ranked = members.slice()
      .sort((a, b) => b.features.dollarVolume - a.features.dollarVolume);
    const keeper = ranked[0];
    for (const other of ranked.slice(1)) {
      const r = returnCorrelation(keeper.raw.ohlc, other.raw.ohlc);
      if (Number.isFinite(r) && r >= minCorr) {
        remove.add(other.features.ticker);
        dropped.push({ kept: keeper.features.ticker, dropped: other.features.ticker, corr: r });
      }
    }
  }
  return { kept: records.filter((e) => !remove.has(e.features.ticker)), dropped };
}

/** Pearson correlation of daily log returns over the overlapping dates. */
function returnCorrelation(a, b) {
  const series = (candles) => {
    const map = new Map();
    for (const c of candlesAscending(candles)) {
      const d = String(c.start_time || c.end_time || c.date || "").slice(0, 10);
      const close = num(c.close);
      if (d && close > 0) map.set(d, close);
    }
    return map;
  };
  const A = series(a), B = series(b);
  const dates = [...A.keys()].filter((d) => B.has(d)).sort();
  if (dates.length < 10) return NaN;
  const ra = [], rb = [];
  for (let i = 1; i < dates.length; i++) {
    ra.push(Math.log(A.get(dates[i]) / A.get(dates[i - 1])));
    rb.push(Math.log(B.get(dates[i]) / B.get(dates[i - 1])));
  }
  return pearson(ra, rb);
}

/**
 * The top n and bottom n of a ranked list, DEDUPLICATED by ticker.
 *
 * slice(0, n) and slice(-n) overlap whenever the list holds fewer than 2n
 * entries — a state this pipeline explicitly permits, since it only refuses a
 * universe below 50 against an enrich buffer of 30 per side. The same name was
 * then enriched twice (five wasted calls each), entered the scored pool twice,
 * and could land on the long AND the short board at once, presented as two
 * independent opinions. partitionSides guarantees its slices are INDEX-disjoint,
 * not TICKER-disjoint, so it does not cover this. At 55 survivors five names
 * duplicated; at 50, ten did.
 */
/* ---------- deck encoding ---------------------------------------- */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Forty-two sessions of closes as a base-64 string, two characters a session.
 *
 * Each close is quantised to twelve bits across the window's OWN min and max,
 * which is all a sparkline needs: the shape is scale-free and the levels are
 * published separately as px and pr. Eighty-four bytes a card, against a card
 * that already measures in kilobytes, and no API call that was not already
 * being made.
 */
function packSpark(closes, { window = 42 } = {}) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0).slice(-window);
  if (xs.length < 2) return null;
  let lo = Infinity, hi = -Infinity;
  for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;
  let out = "";
  for (const v of xs) {
    const q = span > 0 ? Math.round(4095 * ((v - lo) / span)) : 2048;
    out += B64[(q >> 6) & 63] + B64[q & 63];
  }
  return out;
}

/** Where the last close sits in its own 52-week range, 0 at the low, 1 at the high. */
function week52Position(closes) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0).slice(-252);
  if (xs.length < 20) return null;
  let lo = Infinity, hi = -Infinity;
  for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi > lo ? (xs[xs.length - 1] - lo) / (hi - lo) : 0.5;
}

/** Simple return over the last n sessions, or null when the window is short. */
function ret(closes, n) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0);
  if (xs.length < n + 1) return null;
  const a = xs[xs.length - 1 - n];
  return a > 0 ? xs[xs.length - 1] / a - 1 : null;
}

/**
 * The tickers on the currently published board, for hysteresis.
 *
 * Non-fatal by design: if this cannot be read, the board is simply built with
 * no incumbents, which is exactly what shipped before hysteresis was wired up.
 * A stale-board read must never stop today's board from publishing.
 */
async function fetchPublishedTickers(key) {
  const body = await fetchStoredPayload(key);
  return body && Array.isArray(body.rows) ? body.rows.map((r) => r.t).filter(Boolean) : [];
}

/**
 * One stored payload, read back through the same ingest route it was
 * written through. Null on every failure — a store read must never stop a
 * publish, and every caller treats "could not read" and "was never
 * written" identically: as an absent session.
 */
async function fetchStoredPayload(key) {
  return (await readStored(key)).payload;
}

/**
 * The same read, WITH ITS OUTCOME.
 *
 * THIS EXISTS BECAUSE THE COMMENT BELOW IT USED TO BE WRONG. collectDatedBoards
 * said of this function: "returns null for an absent key and null for a failed
 * read — the two are indistinguishable from here, and NO AMOUNT OF CARE AT THIS
 * CALL SITE CHANGES THAT." The first half was true and the second was a
 * surrender: the call site could not tell them apart only because this function
 * threw the status away before returning.
 *
 * It cost a real bug. The track record reported "0 retained session(s) of 180
 * dated key(s) probed" on a morning when board:long:2026-08-25 had demonstrably
 * been written the day before, and there was no way to tell a cold archive from
 * a store that refused every read — so the page said "nothing has been scored
 * yet", which is a claim about the SIGNAL, on evidence that was really a claim
 * about the STORE.
 *
 * The GET route answers an absent key with 200 and {status:"pending"}, so
 * "absent" is a positive answer and is reported as one. Anything else is a
 * failure and says so with its status.
 */
async function readStored(key) {
  if (DRY_RUN) return { payload: null, absent: true, status: 0 };
  try {
    const response = await fetch(
      ingestURL() + "?key=" + encodeURIComponent(key),
      {
        redirect: "error",   // same reasoning as publish(): never redirect a bearer
        headers: ingestHeaders(),
      },
    );
    if (!response.ok) return { payload: null, failed: true, status: response.status };
    const body = await response.json();
    /* The route's own word for "nothing stored under this key", which is a
       different fact from a read that did not complete. */
    if (body && body.status === "pending") {
      return { payload: null, absent: true, status: response.status };
    }
    return { payload: body, status: response.status };
  } catch (error) {
    return { payload: null, failed: true, status: 0, detail: error.message };
  }
}


/* ---------- the track record, scored from the archive -------------

   The `record` key has been accepted, served and rendered since the archive
   shipped, and NOTHING EVER WROTE IT — the page promised a record that was
   structurally impossible to fill. This leg is the writer.

   Worker reads only: it re-reads the dated boards this pipeline itself
   archived, joins forward closes from data already in memory, and publishes
   the result. No vendor call, so it sits outside the deadline calculus, and
   it runs after everything the reader already has is committed, so its
   failure can cost only itself. */

const RECORD_HORIZONS = [1, 5, 10, 21];
const RECORD_IC_MIN_N = 20;
const RECORD_MAX_SESSIONS = 30;

const candleDate = (c) => {
  const d = String((c && (c.start_time || c.end_time || c.date)) || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

/**
 * Every dated board still in the store, walked newest-first over the
 * retention window. ~180 sequential worker reads on a full archive
 * (126 days x 5/7 weekdays x 2 sides), documented in DEPLOY.md beside the
 * shared D1 budget. In a dry run there is no store, so the current boards
 * are replayed at prior candle dates — synthetic sessions over synthetic
 * closes, exercising every joint in the scorer with numbers a contract
 * test can recompute.
 */
/* HOW THE ARCHIVE WALK PACES ITSELF. Not tuning for its own sake: the store
   sits behind Cloudflare and this leg makes more requests to it than the whole
   rest of the run combined. */
const ARCHIVE_READ_PACE_MS = 40;
const ARCHIVE_READ_RETRY_MS = 600;
/* Enough refusals with nothing found to conclude the store is not answering,
   rather than that the archive is empty. */
const ARCHIVE_READ_GIVE_UP = 8;

async function collectDatedBoards(sessionDate, payloads, enriched) {
  const boards = [];
  if (DRY_RUN) {
    const calendar = tradingCalendar(
      enriched.map((e) => (e.raw.ohlc || []).map(candleDate)));
    for (const d of calendar.filter((day) => day < sessionDate).slice(-22)) {
      for (const side of ["long", "short"]) {
        boards.push({ d, side, rows: payloads[side].rows });
      }
    }
    /* No dated scores fixtures exist, so the dry-run track exercises the
       BACKFILL path over these synthetic boards plus the "scores" path via
       the current session's own pool — both branches, no fixture that could
       agree with the code by construction. */
    return { boards, scoreDays: [], probed: boards.length };
  }
  const base = Date.parse(sessionDate + "T00:00:00Z");
  if (!Number.isFinite(base)) {
    return { boards, scoreDays: [], probed: 0, absent: 0, failed: 0, statuses: [] };
  }
  const scoreDays = [];
  let probed = 0, absent = 0, failed = 0, recovered = 0;
  const statuses = new Set();
  let abandoned = false;

  outer:
  for (let back = 1; back <= ARCHIVE_RETENTION_DAYS; back++) {
    const t = new Date(base - back * 86400000);
    const dow = t.getUTCDay();
    if (dow === 0 || dow === 6) continue;      // a dated key is only ever written on a weekday
    const d = t.toISOString().slice(0, 10);
    for (const what of ["scores", "long", "short"]) {
      probed++;

      /* PACED. This walk is up to 180 reads against a route that sits behind
         Cloudflare, and the run has already seen it answer a WRITE with 403
         under burst. Unpaced it finished 180 requests in thirteen seconds —
         about fourteen a second, which is the shape a rate rule bites. The
         delay costs seconds on a leg that spends no vendor call and sits
         outside the deadline calculus, so it is the cheapest thing here. */
      if (probed > 1) await sleep(ARCHIVE_READ_PACE_MS);

      const key = what === "scores" ? `scores:${d}` : `board:${what}:${d}`;
      let read = await readStored(key);
      /* ONE RETRY, AND IT IS COUNTED. A refusal that clears on a second
         attempt is a rate limit; one that repeats is not, and the two want
         different fixes. Publishing `recovered` is what tells them apart
         next run instead of next month. */
      if (read.failed) {
        await sleep(ARCHIVE_READ_RETRY_MS);
        const again = await readStored(key);
        if (!again.failed) recovered++;
        read = again;
      }

      if (read.failed) {
        failed++;
        statuses.add(read.status || (read.detail ? "network" : 0));
        /* ABANDON RATHER THAN SPEND THREE MINUTES PROVING THE SAME REFUSAL,
           and never report the result as an empty archive. The same shape
           pruneArchive already uses for its DELETEs. */
        if (failed >= ARCHIVE_READ_GIVE_UP && !boards.length) { abandoned = true; break outer; }
        continue;
      }

      if (read.absent) { absent++; continue; }

      const stored = read.payload;
      if (stored && Array.isArray(stored.rows) && stored.rows.length) {
        if (what === "scores") scoreDays.push({ d, rows: stored.rows, source: "scores" });
        else boards.push({ d, side: what, rows: stored.rows });
      } else {
        /* A 200 carrying no rows is a key that exists and holds nothing,
           which is neither absent nor failed. Counted with absent because
           it contributes no session either way, and it cannot be confused
           with a refusal, which is the distinction that matters. */
        absent++;
      }
    }
  }

  if (failed) {
    console.warn(
      `  record archive: ${failed} of ${probed} read(s) FAILED` +
      (recovered ? `, ${recovered} more recovered on a retry` : "") +
      ` (status ${[...statuses].join(", ")})` +
      (abandoned
        ? " — ABANDONED. Every read refused, so this run can say NOTHING about" +
          " whether the archive holds sessions. It is not a cold archive."
        : ""));
  }
  /* HOW HARD IT LOOKED, published alongside what it found.

     fetchStoredPayload() returns null for an absent key and null for a failed
     read — the two are indistinguishable from here, and no amount of care at
     this call site changes that. What CAN be stated is the denominator: a
     `retained: 0` that probed 180 keys is a cold archive, and a `retained: 0`
     that probed 0 is a broken date. Without this the page can only say "zero",
     which is the one thing a reader already knows by looking at it. */
  return { boards, scoreDays, probed, absent, failed, recovered, statuses: [...statuses], abandoned };
}

/**
 * Dated closes from the three places this run already holds them, cheapest
 * claim first so the strongest overwrites: an archived row's published px
 * (the screener close the board was built at), today's screener close, and
 * finally the enriched names' own candle year, which is authoritative where
 * it exists. All three are the same close-to-close basis.
 */
function buildRecordCloses(enriched, universe, datedBoards, sessionDate) {
  const closes = new Map();
  const put = (t, d, c) => {
    const v = num(c);
    if (!t || !d || !(v > 0)) return;
    if (!closes.has(t)) closes.set(t, new Map());
    closes.get(t).set(d, v);
  };
  for (const b of datedBoards) {
    for (const row of b.rows || []) put(row.t, b.d, row && row.px);
  }
  for (const row of universe) put(row.ticker, sessionDate, row.close);
  for (const e of enriched) {
    for (const c of e.raw.ohlc || []) put(e.row.ticker, candleDate(c), c.close);
  }
  return closes;
}

function selectExtremes(ranked, n) {
  const picked = new Map();
  for (const p of [...ranked.slice(0, n), ...ranked.slice(-n)]) {
    if (!picked.has(p.row.ticker)) picked.set(p.row.ticker, p);
  }
  return [...picked.values()];
}

/** Round a horizon move for publication, or pass null straight through. */
const hz = (v) => (v === null ? null : Number(v.toFixed(4)));

/**
 * ONE ROW VOCABULARY, built in exactly one place.
 *
 * The board rows and the watch rows describe the same quantities about the
 * same names out of the same scored pool. Writing the object twice is how a
 * second vocabulary gets invented for one quantity — a `px` here and a `close`
 * there, a `s` here and a `score` there — and a downstream scorer that reads
 * both surfaces then has to know which surface it is holding. It is also how
 * the two drift: summarize() was written twice in this file and the copies
 * diverged badly enough to take a whole run down after the boards had already
 * committed. The row builder is shared for the same reason.
 */
function boardRow(r, s, rank) {
  const close = num(s.close);
  const prev = num(s.prev_close);
  return {
    t: r.ticker,
    r: rank,
    s: r.score,
    cnv: r.conviction,
    /* THE DOMINANT TERM OF `cnv`, so a ranked list can say what its own
       ranking key is made of.

       Conviction is 0.45·agreement + 0.35·coverage + 0.20·persistence, and
       agreement is agree-over-present across at most three signed axes — so
       it takes THREE values and carries the heaviest weight. A board sorted
       on `cnv` alone therefore orders by a number whose largest single input
       is a category the reader cannot see: two names ten points apart may
       differ by a whole axis or by nothing but coverage, and the composite
       does not say which. On the emitted corpus this is visible as three
       clusters — 60-66, 75-82, 90-96 — one per agreement level.

       Two small numbers against a 128KB cap: ~2.4% of a board payload. The
       full identity stays on the card, which is where a derivation belongs;
       what the board owes its reader is the category behind its own sort. */
    agr: r.agree === null || r.agree === undefined ? null : r.agree,
    bth: r.breadth === null || r.breadth === undefined ? null : r.breadth,
    px: close || r.spot,
    chg: prev > 0 ? (close - prev) / prev : null,
    purity: r.purity === null ? null : Number(r.purity.toFixed(3)),
    gRegime: r.gRegime,
    gFlipDist: r.flipDist === null ? null : Number(r.flipDist.toFixed(4)),
    /* NULL WHEN THE VENDOR QUOTED NEITHER LEG, not zero.

       num() answers 0 for a column that was never sent, so this published a
       flat $0 for a name with no premium on the wire — and the board renders
       that column with fmtMoney and a tone class, so the reader saw an
       explicit "$0" and a neutral tint where the truth was "not quoted". A
       confident zero the reader cannot distinguish from a measurement is the
       defect this codebase hunts hardest, and it was sitting on the board's
       own table the whole time.

       It survived because the argument for tolerating it was about RANKING:
       zero never reaches either tail, so a ranking of extremes is unaffected.
       That argument is sound and irrelevant — this is a displayed column, not
       just a sort key, and moverRow already reached the opposite conclusion
       on the same two fields. Two builders disagreeing about the degenerate
       case of one quantity is how a renderer ends up needing to know which
       surface produced its row. */
    netPrem: onWire(s.net_call_premium) || onWire(s.net_put_premium)
      ? num(s.net_call_premium) - num(s.net_put_premium)
      : null,
    fam: r.fam,
    // 42 sessions of closes, base-64 packed: two characters a session, so
    // the whole sparkline costs 84 bytes on a card that already measures in
    // kilobytes, and it needs no API call the pipeline was not making.
    spark: packSpark(r.closes),
    // Period returns in basis points, so the deck can rank without decoding
    // the sparkline.
    pr: [r.r5, r.r21, r.r42].map((x) => (x === null ? null : Math.round(x * 10000))),
    w52: r.week52Pos === null ? null : Number(r.week52Pos.toFixed(3)),
    vrp: r.vrp === null ? null : Number(r.vrp.toFixed(4)),
    ivr: r.ivRank === null ? null : Number(r.ivRank.toFixed(3)),
    /* im is the VENDOR'S quote, to this name's own next listed expiry — a
       different horizon for every row, so it is carried for the card and
       never set beside another name's. hm is the same volatility scaled to a
       FIXED number of sessions, which is what makes a column of them a
       cross-section rather than a list of unrelated numbers. */
    im: r.impliedMovePerc === null ? null : Number(r.impliedMovePerc.toFixed(4)),
    hm: hz(horizonMove(r.iv30)),
    hr: hz(horizonMove(r.rv30)),
  };
}

/**
 * Merge the chain scalars onto both boards and write each side twice.
 *
 * EXTRACTED SO THE ORDERING IS TESTABLE. "Dated first, then live" is the
 * invariant the archive rests on, and an invariant that only exists inside a
 * 3000-line main() is an invariant nothing can assert. `publishFn` is a
 * parameter for the same reason: a test hands it a recorder and reads back the
 * exact sequence of keys, and hands it a failing one to prove the live board
 * is not written when its own archive copy could not be.
 */
async function republishWithChain(payloads, chainByTicker, sessionDate, publishFn) {
  const lines = [];
  for (const side of ["long", "short"]) {
    const payload = payloads[side];
    if (!payload || !Array.isArray(payload.rows)) continue;
    let merged = 0;
    for (const row of payload.rows) {
      const c = chainByTicker.get(row.t);
      if (!c) continue;
      /* APPENDED, NEVER INSERTED. The board table binds its columns
         positionally, so a field added anywhere but the end shifts every
         column after it under headings that no longer describe them. */
      row.skew = c.scalars.skew;
      row.term = c.scalars.term;
      row.atmIv = c.scalars.atmIv;
      /* THE HORIZON THE SKEW WAS READ AT. "Nearest expiry past seven days" is
         eight days out on SPY and ninety on a thin name, so a column of skews
         is a column of different tenors unless the tenor rides along. This is
         the same fact `im` is carried for the card over — see boardRow — and
         the reason all four are excluded from the cross-sectional IC table. */
      row.skewDays = c.scalars.skewDays;
      merged++;
    }
    if (!merged) continue;
    try {
      /* THE DATED COPY GOES FIRST, and that order is the whole design. If the
         archive write fails, the live board is left as the store already had
         it — complete, consistent, and simply without the new columns — rather
         than gaining a field its own archive copy will never carry. The
         reverse order would publish a live board the history can never
         reproduce, which is the one state the archive exists to prevent. */
      const key = datedKey(side, sessionDate);
      if (key) await publishFn(key, payload);
      await publishFn("board:" + side, payload);
      lines.push(`  re-published board:${side} with chain columns on ${merged} row(s)`);
    } catch (error) {
      lines.push(`  re-publish ${side}: ${error.message} — the store keeps the pre-chain board`);
    }
  }
  return lines;
}

/**
 * One side's board rows, and the count of names it could not fit.
 *
 * THE NAMES THAT CLEARED THE BAND AND APPEAR NOWHERE. This product's stated
 * rule is that the dead band decides publication: a name outside it is a
 * signal, a name inside it goes on the watch list. Then `boardSize` truncates
 * each side and the overflow lands on NEITHER — not this board, and not the
 * watch list, which by construction holds only the names inside the band.
 *
 * Measured on the emitted corpus: 100 scored, 3 inside the band, 97 therefore
 * cleared it, 93 published across both sides. Four names were fully scored,
 * cleared the threshold the product says is the threshold, and reached no
 * surface at all — and no published number said so, so the arithmetic could
 * not be done by a reader either.
 *
 * The cap itself is defensible: a board is a ranked list and a ranked list
 * has a length. What was not defensible was the silence — so the payload now
 * publishes `cleared` and `shed`, derived where both lists are in scope
 * rather than counted here and carried, because a count that travels
 * separately from the rows it describes is a count that can disagree with
 * them. That is the failure the neutral-list comment above already names: a
 * payload saying 48 above a list of 40.
 */
function toRows(pool, screenerByTicker, previousIds) {
  const ids = applyHysteresis(
    pool.map((r) => r.ticker), previousIds,
    { entryRank: UNIVERSE.boardSize, exitRank: Math.round(UNIVERSE.boardSize * 1.4) },
  );
  const byTicker = new Map(pool.map((r) => [r.ticker, r]));
  return ids.map((ticker, i) =>
    boardRow(byTicker.get(ticker), screenerByTicker.get(ticker) || {}, i + 1));
}

/**
 * How many names the watch list publishes.
 *
 * The dead band holds ~48 of 60 scored names on a normal session, so 40 shows
 * essentially all of the interesting end of it and truncates from the QUIET
 * end: the rows are ranked by distance from neutral, so the names that fall
 * off the bottom are the ones furthest from ever leaving the band, which are
 * the ones with the least to say. It is a cap and not a target — a session
 * with twelve neutral names publishes twelve.
 *
 * The number is also a payload budget. The ingest route rejects anything over
 * 128KB (FLOWS_MAX_PAYLOAD_BYTES); a watch row measures ~440 bytes, most of it
 * the packed sparkline, so forty rows is ~18KB. That is seven times inside the
 * cap, which is where a payload whose row width may still grow should sit — a
 * surface that publishes right up to a hard limit fails on the day a column is
 * added, and it fails as a 413 from the Worker rather than here.
 */
/* AT A HUNDRED-NAME POOL, FORTY TRUNCATES INTO NOWHERE. The watch board is
   where a name inside the dead band is published; capped at 40 against a pool
   this size, a name could clear no board at all and appear on no surface,
   which is the one outcome the dead band exists to prevent. */
const WATCH_ROWS = 80;

/** A finite number rounded for publication, or null. Never 0 for "missing". */
const fixed = (v, digits) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null);

/**
 * The names inside the dead band, ranked by how close they are to leaving it.
 *
 * WHAT THE THREE EXTRA COLUMNS ARE DOING HERE. surpriseTilt is the log ratio
 * of call-side to put-side volume surprise, each side measured against the
 * name's OWN 30-day norm — the most conventional "unusual activity" measure in
 * this entire product, signed by which side is doing the surprising — and it
 * has never been displayed anywhere. It was computed in screenerTilt, used once as a pre-enrichment sort
 * key, and dropped. relative_volume and put_call_ratio were parsed out of the
 * same screener row and dropped in the same place. They belong on this surface
 * in particular: a name pinned near zero on a signed composite can still be
 * three times its own volume norm, and that is exactly the "why is this on the
 * watch list" a reader needs when the score itself says nothing.
 *
 * None of the three enters a score, and none of them is presented as one. They
 * are vendor observables republished at the precision the vendor states them
 * to, which is what keeps this list inside the identification bar: nothing
 * here needs a risk-free rate, a dividend yield, or any other parameter this
 * project has refused to invent.
 *
 * THE 52-WEEK POSITION IS ALREADY HERE, as `w52` on every board row, computed
 * from the 252 candles the pipeline fetches anyway. The screener also carries
 * week_52_high / week_52_low, and deriving a second 52-week position from them
 * would publish two numbers that mean the same thing, disagree in the third
 * decimal (a vendor window against our own), and carry different names. That
 * is the bug this file's shared row builder exists to prevent, so the screener
 * pair stays unread and w52 arrives with the rest of the board vocabulary.
 */
function toWatchRows(pool, screenerByTicker, tiltByTicker, { cap = WATCH_ROWS } = {}) {
  /* Order on the FULL-PRECISION residual, exactly as partitionSides does, and
     for the same reason: `score` is a rounded integer and inside a +-20 band
     ties are routine, so sorting on it hands the ranking to Array.prototype
     .sort's stability rather than to the data. boundedScore is odd and
     monotone in the residual, so |residual| descending IS |score| descending,
     with the ties broken by the number that actually has the precision. */
  const ranked = (pool || []).slice().sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
  const tilts = tiltByTicker || new Map();
  return ranked.slice(0, cap).map((r, i) => {
    const t = tilts.get(r.ticker) || {};
    return {
      ...boardRow(r, screenerByTicker.get(r.ticker) || {}, i + 1),
      /* PRECISION THE SOURCE ACTUALLY HAS. surpriseTilt is a log ratio of two
         volume ratios and is meaningful to about a thousandth; the vendor
         quotes relative_volume to two decimals and a put/call ratio past three
         is noise dressed as measurement. A name whose 30-day norm is missing
         gets null here, never 0 — zero is a real reading of this field and
         means "as much call as put surprise", which is the opposite of
         "unknown". */
      /* THE KEY THIS TABLE IS ORDERED BY, PUBLISHED.

         The sort above is on |residual| and says so; the rows then shipped
         carrying only `s`, a rounded integer on a +-100 scale. With DEAD_BAND
         narrowed to 1, every name inside the band prints 0, 1 or -1 — in
         practice a column of zeros — so the reader saw seven rows in a
         deliberate order under a heading promising "how close they are to
         leaving the band", ranked by a quantity the payload never carried.
         The column had no bits and the ordering had no visible cause.

         This is not a coerced zero: those zeros are real, and the refuted
         half of this finding claimed otherwise. It is a ROUNDING that
         destroys the ordering key at the last step, which is why publishing
         `resid` fixes it and re-checking for nulls would not.

         Four decimals because that is where this quantity stops being
         meaningful: the band edge sits at |residual| ~= 0.0055, so a
         thousandth would quantise the whole table onto six values. Costs no
         vendor call and no recomputation — the number is already on `r`. */
      resid: fixed(r.residual, 4),
      surpriseTilt: fixed(t.surpriseTilt, 3),
      relVolume: fixed(t.relVolume, 2),
      putCallRatio: fixed(t.putCallRatio, 3),
    };
  });
}

/* ---------- GICS sector momentum --------------------------------

   ELEVEN CALLS A RUN, AND THERE IS NO SECOND CALL ANYWHERE IN THIS SECTION.

   The rate limiter is the binding constraint on this entire pipeline, not the
   vendor's quota — there is no documented quota. The limiter starts at 120ms
   between calls, DOUBLES on any 429, decays 10% on a clean response, and a
   single 429 permanently raises the floor toward 5s. The last live run made
   367 calls in 122s with 36 of them already rate limited, and at the 5s
   ceiling the 30-minute card deadline allows only ~360 calls in total — fewer
   than a healthy run already makes. So a new surface is priced in calls before
   it is priced in anything else, and this one costs eleven: the eleven sector
   ETFs at one candle request each, reusing an endpoint the pipeline already
   calls for every enriched name.

   They are spent AFTER both boards are committed and BEFORE the cards, which
   is a deliberate trade and not an accident of ordering. On a degraded day
   these eleven calls come out of the CARD budget, so the run loses about
   eleven cards rather than losing the sector view — the same argument that
   puts the boards ahead of the cards, applied one level down. Cards are the
   decorative half; a cross-sectional read of the market is not. */

/**
 * THE VENDOR'S TICKERS FOR GICS SECTORS, WHICH IS NOT THE SAME THING AS GICS.
 *
 * These are the eleven SPDR Select Sector ETFs. They are what this vendor can
 * actually be asked about: /api/stock/{TICKER}/ohlc/1d takes a listed symbol,
 * and there is no endpoint on this key that returns a GICS index level. So
 * every row below is a statement about a TRADEABLE BASKET and has to be read
 * as one. XLK is roughly forty per cent two names; XLC carries two share
 * classes of a single issuer; XLRE has only existed since 2015 and XLC since
 * 2018. A basket's momentum is mostly its largest holdings' momentum, and a
 * row labelled only "Information Technology" invites a reader to believe the
 * number is something this product cannot compute.
 *
 * The GICS name is therefore carried BESIDE the ticker rather than instead of
 * it, so the card can print both and the claim stays checkable. Publishing the
 * sector name alone would assert an index reading nobody here measured;
 * publishing the ticker alone would be eleven rows a reader has to already
 * know by heart.
 */
const SECTOR_ETFS = [
  { sector: "Materials", etf: "XLB" },
  { sector: "Communication Services", etf: "XLC" },
  { sector: "Energy", etf: "XLE" },
  { sector: "Financials", etf: "XLF" },
  { sector: "Industrials", etf: "XLI" },
  { sector: "Information Technology", etf: "XLK" },
  { sector: "Consumer Staples", etf: "XLP" },
  { sector: "Real Estate", etf: "XLRE" },
  { sector: "Utilities", etf: "XLU" },
  { sector: "Health Care", etf: "XLV" },
  { sector: "Consumer Discretionary", etf: "XLY" },
];

/* THE SPAN IS A CHOICE AND IT IS PUBLISHED AS ONE.

   15 is the conventional TRIX length and nothing in the data picks it. A
   shorter span makes the oscillator chattier and a longer one makes it later;
   neither is more true. Under this project's identification bar a quantity is
   either recoverable from observables with no free parameters or labelled a
   choice, and this is the second kind — so `span` goes out in the payload
   beside every reading, which is what makes a published number reproducible by
   someone who does not have this file. */
const TRIX_SPAN = 15;

/* HOW MANY SESSIONS THE PUBLISHED LINE HOLDS. Thirty sessions is about six
   weeks: long enough that a trend line has a shape rather than a slope, short
   enough that the whole eleven-sector payload stays a couple of kilobytes
   against the ingest route's 128KB cap. */
const TRIX_SERIES = 30;

/* THE WARM-UP, MEASURED RATHER THAN GUESSED.

   Three cascaded EMAs seeded on the first observation take a long time to stop
   remembering that seed, and the reading during that stretch is not a small
   error — it is the wrong number. Against a constant 30 bp/session ramp, whose
   settled TRIX is exactly 30 bp by construction:

       46 candles -> 28.32 bp   (-5.6%)
       61 candles -> 29.63 bp   (-1.2%)
       76 candles -> 29.93 bp   (-0.25%)
      106 candles -> 30.00 bp

   Five spans is what puts the OLDEST point of the published line inside a
   quarter of one per cent of settled, not just the newest. Three spans would
   have left the old end of every trend line sagging toward the middle for no
   reason but arithmetic — a chart artefact that reads as "the trend is
   accelerating" on every sector simultaneously. */
const TRIX_WARMUP = 5 * TRIX_SPAN;

/** Candles needed before a sector can be measured at all: warm-up, plus the
    published window, plus the one extra bar the first difference consumes. */
const TRIX_MIN_CANDLES = TRIX_WARMUP + TRIX_SERIES + 1;

/**
 * The exponential moving average of a series, seeded on its first value.
 *
 * Seeded rather than started from a simple average of the first `span` bars,
 * which is the other common convention. The two disagree over the first few
 * multiples of the span and are indistinguishable after that, and the only
 * caller discards TRIX_WARMUP sessions before publishing anything — so the
 * region where the choice could matter is thrown away by construction. That is
 * what keeps the seeding convention from being a free parameter rather than
 * merely an undocumented one.
 */
function ema(values, span) {
  const alpha = 2 / (span + 1);
  const out = new Array(values.length);
  let prev = values.length ? values[0] : NaN;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : prev + alpha * (values[i] - prev);
    out[i] = prev;
  }
  return out;
}

/**
 * TRIX as a per-session LOG return in basis points, oldest first.
 *
 * ON THE LOG, AND WHY IT IS NOT THE TEXTBOOK FORM. TRIX is conventionally the
 * one-period rate of change of a triple-smoothed EMA of the plain close:
 * (e3[t] - e3[t-1]) / e3[t-1]. Smoothing the LOG close instead turns that
 * final division into a plain difference, and a difference of logs IS the log
 * return — so the published number is additive across sessions and exactly
 * antisymmetric between a move and its reverse. The percentage form is
 * neither: a sector that falls 9% and then rises 9.89% is back where it
 * started, and the two readings do not cancel. At the size this oscillator
 * actually takes — tens of basis points a session — the two forms agree to
 * about a part in a thousand, so this is not a claim that the textbook reading
 * is wrong. It is a claim that on the day the two disagree, the additive one
 * is the one whose sign and magnitude can be set beside another sector's.
 *
 * A NON-POSITIVE CLOSE HAS NO LOG, AND THAT IS THE POINT. The vendor's candle
 * for a halted session or a symbol's first day can come back with a zero
 * close. The percentage form would quietly turn that into a several-thousand-
 * per-cent rate of change and then smear it across the next seventy-five
 * sessions of the smoother, producing a confident, enormous, entirely
 * fictitious trend. Here it produces -Infinity, the caller's screen catches it
 * before this function is ever reached, and the sector reports unmeasured.
 */
function trixSeriesBp(closes, { span = TRIX_SPAN } = {}) {
  const e3 = ema(ema(ema(closes.map((c) => Math.log(c)), span), span), span);
  const out = [];
  for (let i = 1; i < e3.length; i++) out.push((e3[i] - e3[i - 1]) * 10000);
  return out;
}

/**
 * THE 0-100 SCALING IS A CHOICE, AND IT IS WHERE THIS SURFACE GOES WRONG.
 *
 * TRIX is an unbounded signed oscillator in basis points per session. Nothing
 * in its definition produces a 0-100 reading, so any such reading is an
 * editorial decision about what "100" is supposed to mean — and the three
 * available decisions make three DIFFERENT CLAIMS about the same session.
 *
 * REJECTED: CROSS-SECTIONAL MIN-MAX over today's eleven sectors. This is the
 * scaling everyone reaches for and it is unusable, because it is a RANK
 * dressed up as a LEVEL. By construction it emits exactly one 0 and exactly
 * one 100 every single day, whatever the market did. A session in which all
 * eleven sectors sat within two basis points of each other renders pixel-for-
 * pixel identically to one in which energy ripped and utilities collapsed. The
 * single question this panel exists to answer — is the market rotating today,
 * or is it flat — is the single thing that scaling destroys. It would also
 * make the published trend line a lie in a second way: yesterday's 80 and
 * today's 80 would be different basis points, so the line's slope would encode
 * changes in the OTHER ten sectors.
 *
 * REJECTED: A PERCENTILE OF EACH SECTOR'S OWN TRAILING HISTORY. This one at
 * least survives a flat day — every sector prints near its own median and the
 * row reads mid-range. What it does instead is silently rescale each sector by
 * its own volatility, so eleven numbers that share an axis on the page stop
 * sharing one in fact. Utilities moving 4 bp against its own quiet history
 * outranks energy moving 30 bp against its own violent one, and a reader
 * looking at eleven bars side by side has no way to see it. It also needs a
 * lookback window, which is a second free parameter bought with nothing.
 *
 * CHOSEN: A FIXED LINEAR CLAMP, 50 AT ZERO MOMENTUM. One axis for all eleven
 * sectors, and the SAME axis every day — a 62 last month and a 62 today are
 * the same basis points, which is the property that makes a small trend line
 * worth drawing at all. A flat day prints eleven numbers near 50 and looks
 * flat. A rotating day spreads across the range. That is the test, and this is
 * the only one of the three that passes it.
 *
 * WHAT IT COSTS, STATED RATHER THAN HIDDEN. The rails are real: past
 * +-TRIX_FULL_SCALE_BP the reading stops distinguishing, so a sector in a
 * historic trend and a sector in an unprecedented one both print 100. That is
 * why the raw basis points ride along on every row and why `clamped` is a
 * published field — a saturated reading has to announce itself rather than
 * pass for an ordinary extreme.
 *
 * WHERE 50 CAME FROM, confessed plainly, because it is the free parameter this
 * whole comment exists to declare. A sustained 50 bp per session is about +12%
 * a month compounded, held long enough for a triple EMA of span 15 to converge
 * on it. That is the top of what a GICS sector does, not a level any sector
 * holds. It is a judgement about the SCALE of the phenomenon, not a
 * measurement of it.
 *
 * This product has refused to publish assignment probability, expected value
 * and fair premium because each of them needs a risk-free rate and a dividend
 * yield that nobody here can observe. The difference is not that this
 * parameter is more defensible than those. It is that this one is DECLARED IN
 * THE PAYLOAD, next to the raw basis points it was applied to, so a reader who
 * thinks 50 is the wrong number can divide it back out and use their own. A
 * hidden parameter and a published one are different objects even when they
 * hold the same value.
 */
const TRIX_FULL_SCALE_BP = 50;

/** The published relation, in one place: scaled = 50 + 50*clamp(bp/full, -1, 1). */
function scaleTrix(bp) {
  if (!Number.isFinite(bp)) return null;
  return Number((50 + 50 * Math.max(-1, Math.min(1, bp / TRIX_FULL_SCALE_BP))).toFixed(1));
}

/**
 * One row per sector: measured, or explicitly unmeasured with a reason.
 *
 * NEVER A ZERO, AND NEVER SILENTLY ABSENT. A sector whose candles did not
 * arrive is not a sector with no momentum — on this scale "no momentum" is 50,
 * and a raw reading of 0 bp is a real, common, meaningful answer. Emitting 0
 * or dropping the row are the two ways this product has been burned before: a
 * confident number where the truth was "not measured", and a panel that
 * quietly shrank from eleven bars to nine so nobody noticed the vendor had
 * stopped answering. Both are prevented by keeping all eleven rows present,
 * every field explicitly null, and a `reason` string a renderer can print.
 *
 * THE CLEAN TAIL, NOT THE WHOLE SERIES. A single unusable candle from last
 * spring must not take out today's reading, and a single unusable candle from
 * last week must. So the longest contiguous run of positive closes ENDING AT
 * THE MOST RECENT BAR is what gets measured, and its length is what the
 * minimum is checked against. Dropping bad bars in place would have been the
 * other option and it is worse: it silently shortens the time axis, so a
 * sector that halted for three days would have its TRIX computed over a
 * calendar this payload never states.
 */
function sectorTrix(candlesByEtf, { span = TRIX_SPAN, series = TRIX_SERIES, warmup = TRIX_WARMUP } = {}) {
  const minCandles = warmup + series + 1;
  const get = (etf) => (candlesByEtf instanceof Map
    ? candlesByEtf.get(etf)
    : (candlesByEtf || {})[etf]) || [];

  return SECTOR_ETFS.map(({ sector, etf }) => {
    const unmeasured = (reason) => ({
      sector, etf,
      trix: null, trixBp: null, clamped: null, series: null, clampedPoints: null,
      reason,
    });

    const raw = get(etf);
    if (!raw.length) return unmeasured(`no candles returned for ${etf}`);

    const closes = candlesAscending(raw).map((c) => num(c.close, NaN));
    let start = closes.length;
    while (start > 0 && Number.isFinite(closes[start - 1]) && closes[start - 1] > 0) start--;
    const clean = closes.slice(start);

    if (clean.length < minCandles) {
      return unmeasured(
        `${clean.length} usable ${etf} closes of ${closes.length} returned; ` +
        `${minCandles} are needed for a settled TRIX(${span}) plus ${series} sessions`);
    }

    const settled = trixSeriesBp(clean, { span }).slice(warmup);
    const window = settled.slice(-series);
    if (!window.every((v) => Number.isFinite(v))) {
      return unmeasured(`${etf} produced a non-finite TRIX over the published window`);
    }

    /* SCALED FROM THE ROUNDED READING, NOT FROM THE FULL-PRECISION ONE.

       The raw basis points ride along on every row precisely so that the
       scaling stays reversible — a reader who disagrees with the full-scale
       band can recompute the whole panel from `trixBp` and their own. That
       promise is only kept if the two numbers on the row are exactly
       consistent, and scaling the unrounded value quietly breaks it: XLF's
       -23.6503 bp scales to 26.3 while the -23.65 that gets PUBLISHED scales
       to 26.4, and a reader checking the arithmetic finds the payload
       disagreeing with itself in the last decimal. Rounding first makes the
       published raw reading the source of truth for the published scaled one,
       so the relation in `scaling.relation` is exactly true of every row
       rather than nearly true. */
    const bp = window.map((v) => Number(v.toFixed(2)));
    const last = bp[bp.length - 1];
    return {
      sector, etf,
      trix: scaleTrix(last),
      trixBp: last,
      clamped: Math.abs(last) >= TRIX_FULL_SCALE_BP,
      series: bp.map((v) => scaleTrix(v)),
      /* How many points of the drawn line are sitting on a rail. A line that
         is flat because the sector was quiet and a line that is flat because
         it is pinned at 100 look the same; this is how a reader tells them
         apart without being handed the raw series as well. */
      clampedPoints: bp.filter((v) => Math.abs(v) >= TRIX_FULL_SCALE_BP).length,
      reason: null,
    };
  });
}

/* ---------- the rolling band: movers, and premium by name --------

   ZERO ADDITIONAL API CALLS, AND THAT IS THE WHOLE DESIGN.

   The six market-cap-band screener calls at step 1 already return every column
   these two surfaces need — close, prev_close, relative_volume, sector, and
   the net call and put premium — for every name in the universe, and the
   pipeline has been reading four of them for twenty-five board rows and
   throwing away the other two hundred-odd names' worth. Nothing below issues a
   request. buildMovers is synchronous for exactly that reason: a function that
   cannot await cannot quietly grow a fetch later, which is the way a
   zero-cost surface stops being one.

   RANKED OVER THE ELIGIBLE UNIVERSE, NOT THE SCORED POOL. Only ~60 names are
   ever enriched and scored; ranking movers over those would publish "the
   biggest movers among the sixty names our composite already liked", which is
   a different and much less interesting claim than the one the panel makes.
   The eligible universe is the right population: it is every name that cleared
   price, market cap, option volume and open interest, which is what keeps a
   $3 stock's three-cent tick out of a list of the day's largest moves.

   AND NOT EARNINGS-GATED. The gate at step 2 exists to keep event-driven noise
   out of a PREDICTIVE composite. This list is descriptive — it reports what
   the tape did — and a "biggest movers" list that silently omitted every name
   that moved because it reports next Tuesday would be lying about the day. */

/**
 * How many names each of the four lists holds.
 *
 * Fifteen, against a universe of two to four hundred: at that size the
 * fifteenth name is already inside the top five per cent of the cross-section,
 * and past there "largest mover" stops meaning anything a reader would act on.
 * It is also a payload budget — four lists of fifteen rows at ~110 bytes is
 * ~7KB against the ingest route's 128KB cap, comfortably inside the margin a
 * surface whose row width may still grow should keep.
 *
 * It is a CAP and not a target. A session on which only three names fell
 * publishes three fallers, for the same reason a thin board side publishes
 * thin rather than throwing the run away.
 */
const MOVER_ROWS = 15;

/** Did the vendor quote this column at all, as opposed to quoting it as zero? */
const onWire = (v) => v !== undefined && v !== null && v !== "";

/**
 * A mover row, in the SAME vocabulary the board rows use.
 *
 * `t`, `px`, `chg` and `netPrem` are boardRow's names for boardRow's
 * quantities, computed by boardRow's relations; `relVolume` and `surpriseTilt`
 * are toWatchRows' names for toWatchRows' quantities at toWatchRows'
 * precision. This file already carries the scar from inventing a second
 * vocabulary for one quantity — a `px` on one surface and a `close` on
 * another — and a downstream renderer then has to know which surface it is
 * holding. It is a separate builder only because it takes a screener row where
 * boardRow takes a scored record; every field name and unit is the same.
 *
 * `netPrem` USED TO BE THE ONE PLACE THESE TWO DISAGREED. boardRow computed
 * num(net_call) - num(net_put), and num() answers 0 for a column the vendor
 * never sent, so a name with no quoted premium published a flat $0. The
 * argument for tolerating it was that a ranking of extremes never sees a
 * zero — sound, and beside the point, because the board DISPLAYS that column.
 * boardRow now checks the same two fields for presence on the wire and
 * reports null exactly as this does, so a renderer no longer has to know
 * which surface produced the row it is holding. Reporting null is also what
 * keeps an unquoted name out of both premium lists rather than parking it in
 * the middle of them.
 */
function moverRow(row, tilt) {
  const close = num(row.close);
  const prev = num(row.prev_close);
  const hasPremium = onWire(row.net_call_premium) || onWire(row.net_put_premium);
  const t = tilt || {};
  return {
    t: row.ticker,
    px: close > 0 ? close : null,
    /* A FRACTION of the prior close, exactly as boardRow publishes it: 0.0412
       is +4.12%. No prior close means the move is UNKNOWN, not zero, so the
       row reports null and buildMovers keeps it out of the ranking entirely
       rather than seating it in the middle of a list of movers. */
    chg: prev > 0 && close > 0 ? Number(((close - prev) / prev).toFixed(5)) : null,
    // Signed US dollars. Positive is call premium bought over put premium
    // bought, which is a statement about the TAPE and not a forecast.
    netPrem: hasPremium
      ? Math.round(num(row.net_call_premium) - num(row.net_put_premium))
      : null,
    relVolume: fixed(t.relVolume, 2),
    surpriseTilt: fixed(t.surpriseTilt, 3),
    // The vendor's own sector string, passed through verbatim or null. It is
    // not mapped onto the eleven GICS names above: this vendor's spellings are
    // undocumented, and inventing a crosswalk would publish a sector
    // attribution nobody verified.
    sector: row.sector || null,
  };
}

/**
 * The day's largest risers, largest fallers, and largest net premium by name.
 *
 * STRICTLY SIGNED, WHICH IS WHAT MAKES THE FOUR LISTS DISJOINT AND HONEST. A
 * riser must have chg > 0 and a faller chg < 0, so on a day the whole market
 * rose the fallers list is short or empty rather than filled with names that
 * rose least — which is what a plain "bottom fifteen by change" would have
 * published, under a heading that says the opposite. It also removes by
 * construction the overlap bug this file has already been bitten by once: the
 * top-n / bottom-n slices of one sorted array collide whenever the array is
 * shorter than 2n, and selectExtremes carries a comment about the five names
 * that were enriched twice because of it. A name cannot be both above and
 * below zero, so no length of input can make these lists intersect.
 *
 * An unchanged name is in neither list, which is correct: flat is not a move.
 *
 * BY NAME, NOT BY CONTRACT. The premium lists rank the net premium the
 * screener reports for the whole SYMBOL. "The largest single trade of the day"
 * is a different question that needs a flow-alerts endpoint this key does not
 * reach, and the payload says `byName` so no renderer can quietly relabel it.
 */
function buildMovers(withTilt, { cap = MOVER_ROWS } = {}) {
  const rows = (withTilt || []).map(({ row, tilt }) => moverRow(row, tilt));

  const movable = rows.filter((r) => r.chg !== null);
  const byChange = movable.slice().sort((a, b) => b.chg - a.chg);
  const risers = byChange.filter((r) => r.chg > 0).slice(0, cap);
  // Descending order, so the fallers are the tail; reversed so the list leads
  // with the LARGEST decline rather than the smallest one.
  const fallers = byChange.filter((r) => r.chg < 0).slice(-cap).reverse();

  const priced = rows.filter((r) => r.netPrem !== null);
  const byPremium = priced.slice().sort((a, b) => b.netPrem - a.netPrem);
  const bullish = byPremium.filter((r) => r.netPrem > 0).slice(0, cap);
  const bearish = byPremium.filter((r) => r.netPrem < 0).slice(-cap).reverse();

  return {
    risers,
    fallers,
    premium: { basis: "byName", bullish, bearish },
    ranked: movable.length,
    priced: priced.length,
    /* HOW MANY NAMES COULD NOT BE RANKED, published rather than swallowed. If
       the vendor ever stops sending prev_close, every chg goes null, both
       lists go empty, and without these counters the panel would report a
       market in which nothing moved. */
    unrankedChange: rows.length - movable.length,
    unrankedPremium: rows.length - priced.length,
  };
}

/**
 * One description of a payload, used by BOTH publish branches.
 *
 * It was written twice, and the two copies diverged: the dry-run branch was
 * taught that cards and meta carry no `rows` while the live branch kept
 * reading `payload.rows.length` directly. Since --dry-run returns before ever
 * reaching the live branch, the harness could not see it — so a green dry run
 * certified a path that would throw on the first real card, fail all fifty
 * inside their per-card catch, and then take the whole job down on the
 * uncaught meta publish, AFTER the boards had already been committed.
 *
 * Sharing the function is the fix; the test below exercises the live branch
 * against a stub so the two can never silently disagree again.
 */
function summarize(payload) {
  return Array.isArray(payload.rows) ? `${payload.rows.length} rows` : "no rows";
}

/* ---------- the dated archive -----------------------------------

   THE STORE DESTROYED HISTORY. flows_payload is keyed `id TEXT PRIMARY KEY`
   and the ingest route upserts, so every morning `board:long` overwrote
   yesterday's `board:long`. Nothing in this product retained what a signal had
   said. That is why nobody can answer "what did this say about NVDA last
   week", and it is why the deck's footer can assert a 51-52% hit rate as PROSE
   with no series anywhere behind it. A forecast that is never written down
   cannot be shown to be wrong, which is the same statement as: it cannot be
   shown to be right.

   Each board is therefore ALSO written under an immutable dated key. The live
   keys `board:long` and `board:short` are untouched and still published FIRST
   — the board reads them, and breaking them takes the product down — and the
   dated copy is the same payload object, so the archive cannot describe the
   session differently from the board the reader actually saw.

   TWO EXTRA ROW WRITES A RUN, and that number is the design constraint, not a
   detail. D1's free tier allows 100,000 row writes a day and this database is
   SHARED WITH THE LIVE LEARNING APP — the reason flows_login_failures writes
   only on a failed login is the same budget. Two rows is nothing.

   THE ~50 PER-TICKER CARDS ARE DELIBERATELY NOT ARCHIVED. Dating them would be
   +50 rows a day, twenty-five times the cost, to retain the decorative half of
   the product. Everything needed to score a published signal later — the
   ticker, the side, the rank, the score, the conviction and the close it was
   published at — is already on the board row. A card's gamma ladder and
   congressional prints answer no question about whether the call was right,
   and they can be re-derived from the vendor for any name that turns out to
   matter. History is kept for the CLAIM, not for its illustrations. */

/* How long a dated board is kept: 126 calendar days, i.e. 90 trading sessions
   at five sessions a week.

   The unit that matters is SESSIONS, because the forecast horizon is
   HORIZON_SESSIONS = 10: a board published today cannot be scored until ten
   sessions have elapsed. A window has to hold many multiples of that or the
   archive is a buffer rather than a record; 90 sessions leaves ~80 cohorts
   that are both stored and resolved.

   Be honest about what 80 cohorts settle. At a hit rate near one half the
   standard error on 80 draws is about 5.6 points, so 51-52% is not
   distinguishable from a coin at this sample size — and the cohorts overlap on
   a ten-session horizon, so they are not even 80 independent draws. Retaining
   more would not fix that. The point of the window is to make the claim
   MEASURABLE and its uncertainty STATEABLE, not to ratify the footer.

   Steady-state cost: 90 x 2 = 180 rows, and two writes a day. The keys are
   dated by CALENDAR date, so the retention window is expressed in calendar
   days; this constant is the one place the two units meet. */
const ARCHIVE_RETENTION_DAYS = 126;

/* How far past the retention edge one run sweeps.

   THE PRUNE MUST BE BOUNDED AND PREDICTABLE. There is no
   `DELETE FROM flows_payload WHERE id LIKE 'board:%:%'` in this design and
   there must not be: the pipeline holds a route-scoped bearer rather than a
   Cloudflare API token — deliberately, because D1:Edit is ACCOUNT-scoped and
   would reach the live learning database — and a pattern delete is exactly the
   operation whose row count nobody can state before it runs. Instead this run
   NAMES the keys it wants gone, computed from the session date.

   A run sweeps the 30 calendar days that sit just past the retention edge, on
   both sides plus the dated scores pool: at most 90 named deletes, of which in steady state exactly two
   match anything. A delete that matches no row writes no row and costs nothing
   against the D1 budget. The 30-day skirt is what makes the sweep
   self-healing: a pipeline that does not run for three weeks still collects
   everything that expired while it was down. Past a month of silence, dated
   keys leak — that is a chosen, stated bound, and the log line reports the
   sweep every run so the leak would be visible rather than inferred. */
const ARCHIVE_PRUNE_LOOKBACK_DAYS = 30;

/** The one date shape a dated key may carry. Both sides of the archive use it. */
const ARCHIVE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The immutable key one board is archived under, or null.
 *
 * sessionDate is genuinely allowed to be null in this pipeline —
 * resolveSessionDate falls back to undated vendor calls and says so — so this
 * cannot assume it has a date. Returning null and skipping the archive is the
 * only safe answer: `board:long:null` would be a row that pruneKeys can never
 * name, and the entire retention story here is that every dated key is
 * recomputable from a date. One unprunable row a year is a slow leak; one a
 * day is the unbounded table this exists to prevent.
 */
function datedKey(side, sessionDate) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return null;
  return `board:${side}:${sessionDate}`;
}

/**
 * Exactly the keys this run should delete.
 *
 * Deterministic in the session date and bounded by construction at
 * 2 * lookbackDays entries — the two properties that make this a prune rather
 * than a liability. The oldest day RETAINED is exactly retentionDays behind
 * the session; the newest day deleted is retentionDays + 1. Off by one in that
 * boundary is the difference between a 90-session archive and an 89-session
 * one that silently drops the cohort a scorer is about to read.
 */
function pruneKeys(sessionDate, {
  retentionDays = ARCHIVE_RETENTION_DAYS,
  lookbackDays = ARCHIVE_PRUNE_LOOKBACK_DAYS,
} = {}) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return [];
  const t0 = Date.parse(sessionDate + "T00:00:00Z");
  if (!Number.isFinite(t0)) return [];
  const keys = [];
  for (let back = retentionDays + 1; back <= retentionDays + lookbackDays; back++) {
    const day = new Date(t0 - back * 86400000).toISOString().slice(0, 10);
    for (const side of ["long", "short"]) keys.push(`board:${side}:${day}`);
    keys.push(`scores:${day}`);
  }
  return keys;
}

/**
 * Delete one stored key, reporting the outcome rather than throwing.
 *
 * A retention sweep must never be able to fail a run that has already
 * published its boards — the same rule meta is under, and for a stronger
 * reason: meta is a diagnostic, while this is housekeeping for data that is
 * already safely written. The caller counts what came back and prints one
 * line.
 */
async function retire(key) {
  if (DRY_RUN) {
    console.log(`  [dry-run] retire ${key}`);
    return { ok: true, status: 0 };
  }
  try {
    const response = await fetch(
      ingestURL() + "?key=" + encodeURIComponent(key),
      {
        method: "DELETE",
        redirect: "error",   // same reasoning as publish(): never redirect a bearer
        headers: ingestHeaders(),
      },
    );
    await sleep(PUBLISH_SPACING_MS);
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, message: error.message };
  }
}

/**
 * Sweep the dated keys that have aged out of the retention window.
 *
 * ABANDON ON A ROUTE THAT REFUSES. If the ingest endpoint does not accept
 * DELETE at all, every one of the sixty attempts fails identically, and
 * sixty pointless authenticated requests spaced 150ms apart is nine seconds of
 * traffic a day plus sixty log lines that say the same thing. Three
 * consecutive refusals that are not a plain 404 is enough evidence that the
 * route, and not the key, is the problem; a 404 is the ordinary answer for a
 * day this pipeline never published and must not stop the sweep.
 */
async function pruneArchive(sessionDate, options = {}) {
  const stale = pruneKeys(sessionDate, options);
  if (!stale.length) {
    console.log("prune: no session date, so no dated key is computable — skipped");
    return { removed: 0, refused: 0, abandoned: false };
  }
  let removed = 0, refused = 0, streak = 0, lastStatus = 0, abandoned = false;
  for (const key of stale) {
    const result = await retire(key);
    if (result.ok) { removed++; streak = 0; continue; }
    if (result.status === 404) { streak = 0; continue; }
    refused++; streak++; lastStatus = result.status;
    if (streak >= 3) { abandoned = true; break; }
  }
  console.log(
    `prune: ${stale.length} dated keys past ${ARCHIVE_RETENTION_DAYS} days named` +
    `, ${removed} removed` +
    (refused ? `, ${refused} refused (last HTTP ${lastStatus})` : "") +
    (abandoned
      ? " — ABANDONED after three consecutive refusals. The ingest route is" +
        " rejecting DELETE, so dated boards will accumulate until it accepts it."
      : ""),
  );
  return { removed, refused, abandoned };
}

/**
 * How many times a publish is re-attempted when the EDGE, not the Worker,
 * refuses it.
 *
 * THE FIRST WIDE-BOARD RUN LOST TWO PAYLOADS THIS WAY. On 2026-08-26 the run
 * published 50 cards instead of 11 and Cloudflare answered two of the writes
 * with a 403 "Just a moment..." interstitial: `sector:trix` never landed, and
 * the re-publish of `board:long` failed, so the long board kept its pre-chain
 * copy while the short board got the new columns. Both are silent to a reader
 * — one page is simply a day stale and one board is missing four columns.
 *
 * A 403 from the edge is not a decision about the request; it is a decision
 * about the rate. It is therefore the one publish failure worth retrying, and
 * retrying it slowly is the whole remedy: the challenge is triggered by burst
 * shape, so the answer is to stop bursting rather than to give up.
 *
 * THIS IS A COUNT OF RETRIES, NOT OF ATTEMPTS: three retries is up to four
 * HTTP requests, and the log line says "retry N of 3" so the two can never be
 * read as the same number. The distinction matters because it is the
 * difference between 14 and 5 seconds of waiting per failing key, and
 * PUBLISH_RETRY_BUDGET_MS below is sized against the larger figure.
 */
const PUBLISH_RETRIES = 3;

/**
 * The TOTAL time this run may spend waiting on publish retries.
 *
 * Three retries is the right number for one unlucky write and the wrong
 * arithmetic for a bad afternoon: 1 + 4 + 9 is fourteen seconds per failing
 * key, and a run publishes two boards, two dated copies, a watch list, movers,
 * a record, a sector panel and fifty cards. If the edge is challenging
 * everything — which is precisely the state a burst-rate challenge produces —
 * the per-key policy alone would spend FOURTEEN MINUTES of a thirty-minute
 * deadline sleeping, and the cards at the end of the queue would be dropped to
 * pay for retries at the front.
 *
 * So the retries are bounded twice: per key, and per run. Once the run has
 * spent this much, later publishes fail fast and report it, which is the
 * honest outcome — a systemic challenge is not something more waiting fixes,
 * and losing one payload with a log line beats losing the twenty behind it in
 * silence.
 */
const PUBLISH_RETRY_BUDGET_MS = 90_000;
let publishRetrySpentMs = 0;

/** Statuses that mean "later", not "no". */
const PUBLISH_RETRYABLE = new Set([403, 408, 429, 500, 502, 503, 504]);

/**
 * How long to wait before re-attempting a publish, or null to stop.
 *
 * PURE AND EXPORTED, because the only defect this repository has shipped twice
 * is a retry policy whose comment and code disagreed. `spentMs` makes the
 * global budget part of the function's answer rather than a check somewhere
 * near it.
 *
 * Quadratic rather than doubling: an edge challenge clears on elapsed quiet
 * rather than on attempt count, so the second wait wants to be meaningfully
 * longer than the first without the third running away.
 */
export function publishRetryDelay(attempt, {
  retries = PUBLISH_RETRIES, budgetMs = PUBLISH_RETRY_BUDGET_MS, spentMs = 0,
} = {}) {
  if (!(attempt >= 0) || attempt >= retries) return null;
  const wait = 1000 * (attempt + 1) * (attempt + 1);
  return spentMs + wait > budgetMs ? null : wait;
}

async function publish(key, payload) {
  const body = JSON.stringify(payload);
  if (EMIT || DRY_RUN) {
    if (EMIT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(EMIT.replace(/\.json$/, "") + "-" + key.replace(":", "-") + ".json", body);
    }
    console.log(`  [dry-run] ${key}: ${summarize(payload)}, ${body.length} bytes`);
    return;
  }
  let response, lastDetail = "";
  for (let attempt = 0; ; attempt++) {
  response = await fetch(
    ingestURL() + "?key=" + encodeURIComponent(key),
    {
      method: "POST",
      // Never follow a redirect while carrying a bearer token. If
      // FLOWS_INGEST_URL is set to the apex when the site redirects to www, or
      // to http when the zone upgrades to https, the client would re-issue the
      // request — with the Authorization header — against whatever the
      // redirect named. Failing loudly on a misconfigured URL is the correct
      // outcome; silently handing the ingest token to another host is not.
      redirect: "error",
      // Identify the client honestly, through the one builder every call site
      // shares — see ingestHeaders(). Naming the caller is also what lets the
      // operator write a precise WAF skip rule instead of a broad one.
      headers: ingestHeaders({ json: true }),
      body,
    },
  );
  // Space the writes. 37 POSTs inside eleven seconds from one datacenter
  // address is what tripped Cloudflare's rate challenge on the first live run;
  // the boards and every card had already landed, so the challenge was purely
  // a function of burst rate. 150ms puts the whole publish phase near six
  // seconds and well under the threshold, against a job budgeted in minutes.
  await sleep(PUBLISH_SPACING_MS);

  /* THE EDGE SAYS "LATER", SO WAIT AND ASK AGAIN — up to three times, backing
     off hard. 1s, then 4s, then 9s: quadratic rather than doubling, because
     the challenge clears on elapsed quiet rather than on attempt count, and a
     job budgeted in minutes can afford fourteen seconds far more easily than
     it can afford a missing page. A status the Worker itself returns (400,
     401, 413) is a decision about the payload and is not retried. */
  const wait = PUBLISH_RETRYABLE.has(response.status)
    ? publishRetryDelay(attempt, { spentMs: publishRetrySpentMs })
    : null;
  if (!response.ok && wait !== null) {
    lastDetail = await response.text().catch(() => "");
    publishRetrySpentMs += wait;
    console.warn(
      `  ingest ${key}: HTTP ${response.status} from ` +
      `${response.headers.get("server") || "unknown"} — waiting ${wait}ms and retrying ` +
      `(retry ${attempt + 1} of ${PUBLISH_RETRIES}; ` +
      `${Math.round(publishRetrySpentMs / 1000)}s of the run's ` +
      `${PUBLISH_RETRY_BUDGET_MS / 1000}s retry budget spent)`);
    await sleep(wait);
    continue;
  }
  break;
  }

  if (!response.ok) {
    /* Report WHOSE rejection this is.
       The Worker's own failures are the project's JSON envelope; an edge
       rejection is an HTML block page with a cf-ray. Only the status was
       reported, so a 403 from Cloudflare's WAF — a status this Worker never
       returns on the ingest path — was indistinguishable from an application
       error, and there was nothing in the log to act on. */
    const detail = (await response.text().catch(() => "")) || lastDetail;
    const ray = response.headers.get("cf-ray") || "none";
    const server = response.headers.get("server") || "unknown";
    const failure = new Error(
      `ingest ${key} -> HTTP ${response.status}` +
      ` (server: ${server}, cf-ray: ${ray})` +
      (detail ? ` body: ${detail.slice(0, 300).replace(/\s+/g, " ")}` : " body: <empty>"),
    );
    /* THE STATUS, READABLE BY A CALLER. Every caller until now only had the
       message string, so telling one refusal from another meant matching
       prose — and the archive leg needs to tell a 409 (the dated key is
       already written and says something else, which is a finding) from a 500
       (the store is unwell, which is an outage). */
    failure.status = response.status;
    throw failure;
  }
  console.log(`  published ${key}: ${summarize(payload)}, ${body.length} bytes`);
}

/* ---------- synthetic fixtures for --dry-run --------------------
   Deterministic, shaped like the real responses, so the whole code
   path runs without a key. This is what makes the pipeline testable
   in CI and reviewable without vendor access. */

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SECTORS = ["Technology", "Healthcare", "Energy", "Financials", "Consumer Cyclical", "Industrials"];

function fakeScreener(count) {
  const rnd = mulberry(20260825);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const price = 8 + rnd() * 400;
    const callVol = Math.round(2000 + rnd() * 900000);
    const putVol = Math.round(1500 + rnd() * 700000);
    const bull = rnd() * 4e7;
    const bear = rnd() * 4e7;
    /* A FEW NAMES ARRIVE WITH NO PRIOR CLOSE, ON PURPOSE.

       The vendor does not promise prev_close on every screener row, and the
       movers band's whole discipline is that a name it cannot rank is counted
       rather than seated in the middle of the list at 0%. A fixture in which
       every row carries a prior close never executes that branch, so the
       payload's `ranked + unrankedChange == universe` invariant is satisfied
       trivially by both the correct implementation and a broken one that
       reports `universe` as whatever it managed to rank. Five rows in 420 make
       the two disagree, which is what turns the invariant into a test.

       Deterministic rather than random, so a failure is reproducible and the
       affected tickers can be named in a log. */
    const quoted = i % 97 !== 3;

    /* AND THE SAME DELIBERATE HOLES IN THE PREMIUM AND AGGRESSOR COLUMNS.

       The market aggregate's whole correctness argument is a PRESENCE rule:
       net premium is measured only where both legs were quoted, because
       treating an unquoted leg as a measured zero would publish a name as
       balanced when one side was never reported. Every one of the 420 rows
       here quoted both legs, so that branch had no way to execute and a fixture
       in which it cannot execute certifies an implementation the live wire will
       break — the fourth time this file has had to say so.

       Three separate holes, on three different moduli, so no single row carries
       all of them and each branch is reached independently:
         - one row in 61 quotes a call leg and no put leg
         - one row in 83 quotes neither
         - one row in 71 omits the aggressor split entirely
         - one row in 53 omits iv30d, so the volatility median must skip it */
    const putLeg = i % 61 !== 7;
    const anyPremium = i % 83 !== 11;
    const aggressorSplit = i % 71 !== 5;
    const hasIv = i % 53 !== 9;
    rows.push({
      ticker: "SYN" + String(i).padStart(3, "0"),
      close: price.toFixed(2),
      ...(quoted ? { prev_close: (price * (0.97 + rnd() * 0.06)).toFixed(2) } : {}),
      marketcap: String(Math.round(2e9 + rnd() * 9e11)),
      sector: SECTORS[Math.floor(rnd() * SECTORS.length)],
      issue_type: "Common Stock",
      is_index: false,
      call_volume: callVol,
      put_volume: putVol,
      call_open_interest: Math.round(20000 + rnd() * 3e6),
      put_open_interest: Math.round(18000 + rnd() * 2e6),
      prev_call_oi: Math.round(20000 + rnd() * 3e6),
      prev_put_oi: Math.round(18000 + rnd() * 2e6),
      total_open_interest: Math.round(50000 + rnd() * 5e6),
      avg_30_day_call_volume: String(Math.round(callVol * (0.5 + rnd()))),
      avg_30_day_put_volume: String(Math.round(putVol * (0.5 + rnd()))),
      bullish_premium: String(Math.round(bull)),
      bearish_premium: String(Math.round(bear)),
      ...(anyPremium ? { net_call_premium: String(Math.round((rnd() - 0.5) * 6e7)) } : {}),
      ...(anyPremium && putLeg ? { net_put_premium: String(Math.round((rnd() - 0.5) * 4e7)) } : {}),
      call_premium: String(Math.round(bull + rnd() * 2e7)),
      put_premium: String(Math.round(bear + rnd() * 2e7)),
      ...(aggressorSplit ? {
        call_volume_ask_side: Math.round(callVol * (0.3 + rnd() * 0.4)),
        call_volume_bid_side: Math.round(callVol * (0.3 + rnd() * 0.4)),
        put_volume_ask_side: Math.round(putVol * (0.3 + rnd() * 0.4)),
        put_volume_bid_side: Math.round(putVol * (0.3 + rnd() * 0.4)),
      } : {}),
      ...(hasIv ? { iv30d: (0.18 + rnd() * 0.5).toFixed(4) } : {}),
      iv30d_1w: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1d: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1m: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1d: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1m: (0.18 + rnd() * 0.5).toFixed(4),
      // 0..100, matching the screener's own example object rather than the
      // schema $ref that points at the wrong field.
      iv_rank: (rnd() * 100).toFixed(4),
      implied_move: (price * (0.02 + rnd() * 0.06)).toFixed(4),
      implied_move_perc: (0.02 + rnd() * 0.06).toFixed(6),
      volatility: (0.18 + rnd() * 0.5).toFixed(4),
      put_call_ratio: (putVol / callVol).toFixed(4),
      week_52_high: (price * (1.05 + rnd() * 0.6)).toFixed(2),
      week_52_low: (price * (0.4 + rnd() * 0.4)).toFixed(2),
      relative_volume: (0.5 + rnd() * 3).toFixed(2),
      next_earnings_date: rnd() > 0.85
        ? new Date(Date.now() + Math.floor(rnd() * 20) * 86400000).toISOString().slice(0, 10)
        : null,
    });
  }
  return rows;
}

/**
 * A YEAR OF SECTOR-ETF CANDLES, ONE FIXED DRIFT PER SECTOR, SO THE DRY RUN CAN
 * TELL A FLAT SECTOR FROM A TRENDING ONE.
 *
 * Three fixtures in this file have previously passed while proving nothing,
 * every time for the same reason: the fixture agreed with the code's guess
 * instead of with the market. A sector fixture drawing all eleven series from
 * one distribution would be that failure in a new place, and a particularly
 * complete one — an undifferentiated cross-section renders IDENTICALLY under
 * min-max, under an own-history percentile and under a fixed clamp, so such a
 * fixture cannot distinguish the scaling rule that shipped from the two that
 * were rejected. It would certify nothing at all.
 *
 * So the drift is fixed, different per sector, and deliberately spans the
 * clamp in both directions: (i - 5) * 12 bp per session across the eleven, so
 * XLK sits at exactly zero drift and must print ~50, both ends saturate and
 * must print 0 and 100 with `clamped` true, and the seven in between must land
 * where a reader can tell them apart.
 *
 * Every one of those readings is checkable by hand. Under a constant log drift
 * d per session the triple EMA converges on the same ramp and its first
 * difference IS d, so the settled TRIX of the k-th sector is (k - 5) * 12 bp
 * plus whatever wobble the +-0.3% noise leaves behind, which measures under
 * 5 bp on every one of the eleven. A
 * fixture whose right answer can be derived without running the code is the
 * only kind that is evidence.
 *
 * XLRE COMES BACK SHORT ON PURPOSE. The unmeasured path — null with a stated
 * reason rather than a confident zero — is the one this project has been
 * burned by most often, and a dry run in which all eleven sectors succeed
 * never executes it once. One deliberately truncated series means every dry
 * run prints a null and the sentence explaining it.
 */
function fakeSectorCandles(etf) {
  const i = SECTOR_ETFS.findIndex((s) => s.etf === etf);
  const driftBp = (i - 5) * 12;
  const sessions = etf === "XLRE" ? 20 : 252;
  /* TWO STREAMS, so the price path does not depend on how many other fields
     this fixture happens to draw. Sharing one generator with the volume column
     is how a fixture's answers move when someone adds a field years later, and
     the whole value of this one is that its answers are derivable by hand. */
  const rnd = mulberry(90000 + i * 17);
  const vol = mulberry(31337 + i);
  const day0 = Date.UTC(2025, 7, 25, 13, 30);
  let logPx = Math.log(60 + i * 7);
  return Array.from({ length: sessions }, (_, k) => {
    logPx += driftBp / 10000 + (rnd() - 0.5) * 0.006;
    const close = Math.exp(logPx);
    return {
      start_time: new Date(day0 + k * 86400000).toISOString(),
      open: close.toFixed(2),
      close: close.toFixed(2),
      high: (close * 1.006).toFixed(2),
      low: (close * 0.994).toFixed(2),
      volume: Math.round(4e6 + vol() * 3e7),
    };
  });
}

/** Does this row carry none of the four gamma legs buildSurface reads? */
function card0Unusable(row) {
  if (!row || typeof row !== "object") return true;
  return !["call_gamma_ask", "call_gamma_bid", "put_gamma_ask", "put_gamma_bid"]
    .some((k) => row[k] !== undefined && row[k] !== null && row[k] !== "");
}

/**
 * The strike x expiry gamma surface, in the shape /spot-exposures/expiry-strike
 * returns: one row per (strike, expiry) pair carrying the SAME aggressor-split
 * leg names the strike ladder uses.
 *
 * The names are the load-bearing part. A fixture that invents its own has now
 * hidden three separate live failures in this repository — call_gamma against
 * call_gamma_ask, a gamma ladder that could not change sign, and call_gamma
 * against the wire's call_gex — each of which passed every dry run while the
 * published panel was empty or wrong. These are the documented ones, and they
 * match what buildSurface reads.
 *
 * The shape is the textbook one and it is deliberately NOT separable: the
 * front expiry is concentrated near the money and the back expiries spread
 * out, so summing across expiries does not reproduce any single column. A
 * separable fixture would let an outer product of the two marginals pass for
 * the real joint, which is exactly the substitution this panel exists to
 * refuse.
 */
/**
 * A dry-run option chain with a real equity smile.
 *
 * The fixture must exercise every branch the live leg has: a levelled front
 * expiry, wings inside the skew tolerance, contracts that traded and contracts
 * that did not, an aggressor split present on most rows and absent on some,
 * and one no-bid line that the sale pricer must refuse while the volume tape
 * keeps it. A fixture where everything is well-formed tests only the path
 * nothing goes wrong on.
 *
 * `wide` IS THE COMMON CASE, NOT THE EDGE ONE, and this fixture said otherwise
 * for a whole release. The narrow book below is 137 rows, so every dry run
 * built a chain that comfortably fit the vendor's 500-row page and the
 * truncation branch — the branch that fired on ten of eleven names on the
 * first live morning — never executed once. A wide book overflows the page and
 * is then CUT the way a real page cap cuts: after a deterministic shuffle, so
 * the subset is arbitrary rather than conveniently sorted by expiry. Nothing
 * downstream is allowed to succeed by leaning on an order the vendor has never
 * documented.
 */
export function fakeChain(ticker, spot, seed, { wide = false, expiry = null } = {}) {
  const rnd = mulberry(seed);
  const rows = [];
  const ladder = wide
    ? [["260831", 7], ["260904", 11], ["260911", 18], ["260918", 25], ["260925", 32],
       ["261016", 53], ["261120", 88], ["261218", 116], ["270115", 144], ["270618", 298]]
    : [["260831", 7], ["260918", 25], ["261016", 53], ["261218", 116]];

  /* THE VENDOR HONOURS THE FILTER — verified live on 2026-08-26, when the
     probe asked PEP for one expiry and got 58 rows all carrying it. The
     fixture therefore honours it too, and returns ONLY that expiry: a fixture
     that quietly ignored the parameter would let the caller's
     identified-expiry check pass on a response that never proved anything,
     which is the fifth variant of this repository's oldest failure. */
  const expiries = expiry
    ? ladder.filter(([code]) => `20${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 6)}` === expiry)
    : ladder;
  for (const [code, dte] of expiries) {
    const halfWidth = wide ? 15 : 8;
    for (let i = -halfWidth; i <= halfWidth; i++) {
      const m = i * 0.035;
      const strike = Math.round(spot * Math.exp(m) * 100) / 100;
      const level = 0.34 - 0.03 * Math.log(dte / 7);
      /* BOTH A PUT AND A CALL AT EVERY STRIKE, which is what the vendor
         actually returns once `maybe_otm_only` is not passed — and the shape
         that broke this leg before the de-duplication landed. A fixture with
         one type per strike exercises none of it. The two types carry
         DIFFERENT vols so a builder that picks the wrong one is visible in the
         number rather than only in the code. */
      for (const cp of ["P", "C"]) {
        const isPut = cp === "P";
        const iv = level + 0.55 * m * m - 0.22 * m + (isPut ? 0.012 : -0.012);
        const intrinsic = isPut ? Math.max(0, strike - spot) : Math.max(0, spot - strike);
        const bid = intrinsic + spot * iv * Math.sqrt(dte / 365) * 0.4 * Math.exp(-2 * m * m);
        // One line in twelve never traded; one in nine has no aggressor split.
        const traded = rnd() > 0.08;
        const volume = traded ? Math.round(80 + 3000 * Math.exp(-7 * m * m) * rnd()) : 0;
        const row = {
          option_symbol: `${ticker}${code}${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
          // The far call: quoted with nobody bidding, and it still trades.
          nbbo_bid: (i === halfWidth && !isPut ? 0 : Math.max(0.05, bid)).toFixed(2),
          nbbo_ask: (Math.max(0.05, bid) * 1.02 + 0.03).toFixed(2),
          implied_volatility: iv.toFixed(6),
          open_interest: String(400 + Math.round(6000 * Math.exp(-6 * m * m))),
          prev_oi: String(380 + Math.round(5700 * Math.exp(-6 * m * m))),
        };
        /* One row in fourteen carries NO volume key at all — the shape that
           made the aggressor ladder publish "800 lifted, 0 traded". */
        if (rnd() > 0.07) row.volume = String(volume);
        if (rnd() > 0.11) {
          const lifted = Math.round(volume * (0.5 + 0.3 * Math.sign(m || 1)));
          row.ask_volume = String(Math.max(0, lifted));
          row.bid_volume = String(Math.max(0, volume - lifted));
        }
        rows.push(row);
      }
    }
  }
  /* ONE ADJUSTED-SERIES ROW, on the old strike scale and heavily traded, so
     the root filter has something to reject on every dry run. */
  rows.push({
    option_symbol: `${ticker}1260918C${String(Math.round(spot * 300)).padStart(8, "0")}`,
    nbbo_bid: "1.00", nbbo_ask: "1.10", implied_volatility: "0.400000",
    open_interest: "5000", prev_oi: "4800", volume: "99999",
    ask_volume: "90000", bid_volume: "9999",
  });
  /* A single-expiry response is complete by construction and is never cut. */
  if (expiry || !wide) return rows;

  /* THE PAGE CAP, SIMULATED THE WAY IT ACTUALLY BITES. A Fisher-Yates shuffle
     off the same seeded generator, then a cut at exactly CHAIN_PAGE_SIZE. The
     shuffle is the load-bearing half: cutting a list already sorted by expiry
     would leave the front expiry whole and complete, which is precisely the
     convenience the vendor does not promise and the refusal exists for. */
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows.slice(0, CHAIN_PAGE_SIZE);
}

function fakeSurface(ticker, spot, expiries) {
  if (!(spot > 0) || !expiries || !expiries.length) return [];
  const rnd = mulberry(ticker.length * 421 + Math.round(spot * 7));
  const rows = [];
  const pivot = spot * (0.97 + rnd() * 0.06);
  expiries.forEach((expiry, j) => {
    // Later expiries are wider and lighter: gamma concentrates in the front.
    const width = spot * (0.04 + j * 0.035);
    const weight = 1 / (j + 1);
    for (let i = 0; i < 25; i++) {
      const k = Math.round(spot * (0.78 + i * 0.018) * 100) / 100;
      const bell = Math.exp(-Math.pow((k - spot) / width, 2));
      if (bell < 0.01) continue;                    // real responses are sparse in the wings
      const lean = (k - pivot) / spot;
      const scale = bell * weight * 3.2e6 * (0.7 + rnd() * 0.6);
      const callLeg = scale * Math.max(0, lean) * 9;
      const putLeg = -scale * Math.max(0, -lean) * 9;
      rows.push({
        strike: k.toFixed(2),
        expiry,
        call_gamma_ask: String(callLeg * (0.4 + rnd() * 0.3)),
        call_gamma_bid: String(callLeg * (0.3 + rnd() * 0.3)),
        put_gamma_ask: String(putLeg * (0.4 + rnd() * 0.3)),
        put_gamma_bid: String(putLeg * (0.3 + rnd() * 0.3)),
      });
    }
  });
  return rows;
}

/** Max pain per expiry, nearest first — the shape /max-pain returns. */
function fakeMaxPain(ticker, spot) {
  const rnd = mulberry(ticker.length * 977 + Math.round(spot));
  return Array.from({ length: 5 }, (_, i) => ({
    expiry: new Date(Date.UTC(2026, 7, 28) + i * 7 * 86400000).toISOString().slice(0, 10),
    max_pain: (spot * (0.94 + rnd() * 0.12)).toFixed(0),
  }));
}

/* Wave-2 per-name fixtures, in the wire spellings the 2026-08-31 live
   probes observed. Sometimes-absent fields absent on purpose; one name in
   a few gets an EMPTY feed so the quiet branch is exercised on dry runs. */
function fakeStockDarkpool(ticker, spot) {
  const rnd = mulberry(ticker.length * 1289 + Math.round(spot));
  if (ticker.length % 7 === 3) return [];               // a quiet name
  return Array.from({ length: 20 }, (_, i) => {
    const px = spot * (0.985 + rnd() * 0.03);
    const size = Math.round(5e3 + rnd() * 4e5);
    const row = {
      ticker,
      executed_at: `2026-08-28T${String(13 + (i % 7))}:${String(10 + (i % 49))}:00Z`,
      price: px.toFixed(2), size,
      volume: Math.round(rnd() * 6e7),
      market_center: "L",
    };
    if (i % 5 !== 4) row.premium = String(Math.round(px * size));  // an unpriced print
    if (i % 3 !== 2) { row.nbbo_bid = (px - 0.03).toFixed(2); row.nbbo_ask = (px + 0.03).toFixed(2); }
    if (i % 9 === 8) row.canceled = false;
    return row;
  });
}

function fakeStockOiChange(ticker, spot) {
  const rnd = mulberry(ticker.length * 2039 + Math.round(spot));
  return Array.from({ length: 14 }, (_, i) => {
    const k = Math.max(1, Math.round(spot * (0.8 + rnd() * 0.4)));
    const row = {
      option_symbol: `${ticker}260918${rnd() > 0.5 ? "C" : "P"}${String(k * 1000).padStart(8, "0")}`,
      underlying_symbol: ticker,
      oi_change: String(Math.round((rnd() - 0.35) * 30000)),
      curr_oi: Math.round(rnd() * 80000),
      last_oi: Math.round(rnd() * 70000),
      volume: Math.round(rnd() * 40000),
      curr_date: "2026-08-28",
      last_date: "2026-08-27",
    };
    if (i % 4 !== 3) row.trades = Math.round(rnd() * 700);
    if (i % 5 !== 4) row.avg_price = (rnd() * 30).toFixed(2);
    if (i % 3 !== 2) row.percentage_of_total = (rnd() * 0.3).toFixed(4);
    if (i % 6 !== 5) row.days_of_oi_increases = Math.floor(rnd() * 9);
    if (i % 7 !== 6) row.days_of_vol_greater_than_oi = Math.floor(rnd() * 5);
    return row;
  });
}

function fakeTermStructure(ticker, spot) {
  const rnd = mulberry(ticker.length * 3167);
  return Array.from({ length: 12 }, (_, i) => {
    const dte = 3 + i * 12;
    const vol = 0.2 + rnd() * 0.3 + (i < 2 ? rnd() * 0.15 : 0);
    return {
      ticker, date: "2026-08-28",
      expiry: new Date(Date.UTC(2026, 7, 28) + dte * 86400000).toISOString().slice(0, 10),
      dte, volatility: vol.toFixed(4),
      implied_move: (spot * vol * Math.sqrt(dte / 365)).toFixed(2),
      implied_move_perc: (vol * Math.sqrt(dte / 365)).toFixed(4),
    };
  });
}

function fakeIvRank(ticker, spot) {
  const rnd = mulberry(ticker.length * 4271);
  return Array.from({ length: 70 }, (_, i) => {
    const row = {
      date: new Date(Date.UTC(2026, 7, 28) - i * 86400000).toISOString().slice(0, 10),
      updated_at: "2026-08-28T20:00:00Z",
      volatility: (0.18 + rnd() * 0.4).toFixed(4),
      close: (spot * (0.9 + rnd() * 0.2)).toFixed(2),
    };
    /* Observed 0..100; absent some days on purpose. */
    if (i % 8 !== 7) row.iv_rank_1y = (rnd() * 100).toFixed(2);
    return row;
  });
}

/** Disclosed congressional filings, including a deliberately late one. */
function fakeCongress(ticker) {
  const rnd = mulberry(ticker.length * 613);
  const n = Math.floor(rnd() * 5);
  return Array.from({ length: n }, (_, i) => {
    const txn = Date.UTC(2026, 6, 5 + i * 4);
    // Lags of 3 to 80 days, because that spread is the point of the panel.
    const lag = Math.round(3 + rnd() * 77);
    return {
      name: `Member ${String.fromCharCode(65 + i)}`,
      member_type: i % 2 ? "senate" : "house",
      issuer: i % 3 === 0 ? "spouse" : "self",
      txn_type: rnd() > 0.4 ? "Purchase" : "Sale",
      transaction_date: new Date(txn).toISOString().slice(0, 10),
      filed_at_date: new Date(txn + lag * 86400000).toISOString().slice(0, 10),
      amounts: ["$1,001 - $15,000", "$15,001 - $50,000", "$50,001 - $100,000"][i % 3],
      ticker,
    };
  });
}

/* THE OBSERVED KEY SET, NOT THE DOCUMENTED ONE. These are the fields the
   probe's first-row dumps carried on three live runs (2026-08-27 twice,
   2026-08-28); sometimes-absent fields are absent from SOME fixture rows on
   purpose, because the module's whole contract is that an absent flag is not
   a false one and an absent premium is not a zero. */
function fakeFlowAlerts(tickers) {
  const rnd = mulberry(4177);
  const names = (tickers && tickers.length ? tickers : ["SYN001"]).slice(0, 24);
  const rows = [];
  /* EXACTLY THE VENDOR'S CEILING, because that is what the live route
     returns. Four consecutive production reads came back with precisely 200
     rows — the documented maximum — which means the population above it is
     unknown on every real run. A fixture of 80 never exercised the
     saturation branch, so the one state this feed is ALWAYS in was the one
     state no dry run ever produced. */
  for (let i = 0; i < ALERT_VENDOR_LIMIT; i++) {
    const t = names[Math.floor(rnd() * names.length)];
    const call = rnd() > 0.45;
    const strike = Math.round(40 + rnd() * 200);
    const row = {
      ticker: t,
      alert_rule: ["RepeatedHits", "SteadyAccumulation", "LowHistoricVolume"][i % 3],
      rule_id: "r" + (i % 3),
      total_premium: Math.round(20000 + rnd() * 3000000),
      trade_count: 1 + Math.floor(rnd() * 40),
      total_ask_side_prem: Math.round(rnd() * 2000000),
      total_bid_side_prem: Math.round(rnd() * 900000),
      has_sweep: rnd() > 0.6,
      all_opening_trades: rnd() > 0.8,
      open_interest: Math.floor(rnd() * 20000),
      volume_oi_ratio: Number((rnd() * 8).toFixed(3)),
      underlying_price: Number((30 + rnd() * 400).toFixed(2)),
      start_time: "2026-08-24T14:" + String(10 + (i % 45)).padStart(2, "0") + ":00Z",
      end_time: "2026-08-24T14:" + String(12 + (i % 45)).padStart(2, "0") + ":30Z",
      expiry: "2026-09-18",
      sector: "Technology",
      marketcap: 1e10,
      er_time: "unknown",
      next_earnings_date: "2026-10-20",
      expiry_count: 1,
      has_singleleg: true,
    };
    /* The sometimes-absent fields, absent sometimes. */
    if (i % 4 !== 3) {
      row.option_chain = t + "260918" + (call ? "C" : "P") +
        String(strike * 1000).padStart(8, "0");
    }
    if (i % 5 !== 4) row.total_size = 10 + Math.floor(rnd() * 900);
    if (i % 6 !== 5) row.has_floor = rnd() > 0.85;
    if (i % 7 === 6) { row.iv_start = 0.3 + rnd() * 0.4; row.iv_end = 0.3 + rnd() * 0.4; }
    if (i % 11 === 10) delete row.total_premium;   // rankable only by size
    rows.push(row);
  }
  rows.push({ ticker: "", total_premium: 5 });     // unusable, counted
  return rows;
}

/* THE VENDOR'S OWN CEILING ON THIS ROUTE, named rather than inlined.

   docs/uw-openapi.yaml types flow-alerts' `limit` as "Default 100 Max 200
   Min 1". 200 is not a number this pipeline chose; it is the most the route
   will give, and asking for more is the mistake that already cost this
   product a morning of empty congress panels when a limit of 500 met a route
   capped lower and answered 422.

   It matters because four consecutive live reads have come back with exactly
   200 rows. A response whose length equals the requested limit is a
   TRUNCATION, not a count: the true population is unknown and at least this
   large. Publishing `seen: 200` without saying so reads as "the vendor
   flagged 200 windows today", which is a claim about the market made out of
   a claim about the request. */
const ALERT_VENDOR_LIMIT = 200;

/* Dry-run raws for the political leg. Built to exercise the traps rather
   than to look plausible: one open-ended band whose midpoint must stay
   absent, one "Receive" that is a gift and not a purchase, one large SELLER
   who must not top a list captioned about buying, one row in the SECOND wire
   spelling (transaction_type + the numeric triple), one row with no owner so
   the self-filed share has to come back unknown, and lag spread across the
   statutory 45 days and well past it. The holders feed arrives failed on
   every dry run, because enterprise-only is what it does on this key and the
   isolation is worth exercising on every run rather than on a bad day. */
function fakePoliticalRaws(tickers) {
  const rnd = mulberry(4471);
  const names = (tickers && tickers.length ? tickers : ["SYN001"]).slice(0, 12);
  const BANDS = ["$1,001 - $15,000", "$15,001 - $50,000", "$50,001 - $100,000",
    "$100,001 - $250,000", "$250,001 - $500,000", "$1,000,001 - $5,000,000"];
  const MEMBERS = ["Ada Reyes", "Ben Osei", "Cara Lindqvist", "Dev Patel",
    "Elena Moreau", "Frank Okafor", "Grace Tan", "Hugo Silva"];
  const filings = [];
  for (let i = 0; i < 140; i++) {
    const txnMs = Date.parse("2026-08-20T00:00:00Z") - Math.floor(rnd() * 75) * 86400000;
    const lag = 18 + Math.floor(rnd() * 95);
    const row = {
      name: MEMBERS[i % MEMBERS.length],
      politician_id: `pid-${i % MEMBERS.length}`,
      reporter: MEMBERS[i % MEMBERS.length].split(" ")[0] + " " + MEMBERS[i % MEMBERS.length][0] + ".",
      ticker: names[Math.floor(rnd() * names.length)],
      issuer: "Synthetic Holdings Inc",
      member_type: i % 3 === 0 ? "senate" : "house",
      txn_type: i % 7 === 6 ? "Sale (Partial)" : i % 11 === 10 ? "Receive" : "Purchase",
      amounts: i % 23 === 22 ? "Over $50,000,000" : BANDS[Math.floor(rnd() * BANDS.length)],
      transaction_date: new Date(txnMs).toISOString().slice(0, 10),
      filed_at_date: new Date(txnMs + lag * 86400000).toISOString().slice(0, 10),
    };
    if (i % 9 === 8) row.notes = "Subholding Of: Synthetic Brokerage Account stock";
    filings.push(row);
  }
  /* The seller who must stay off the buying ranking: more disclosed dollars
     than anyone, none of them a purchase. */
  for (let i = 0; i < 6; i++) {
    filings.push({
      name: "Ivor Blackwood", politician_id: "pid-sell", ticker: names[i % names.length],
      issuer: "Synthetic Holdings Inc", member_type: "house",
      txn_type: "Sale (Full)", amounts: "$1,000,001 - $5,000,000",
      transaction_date: "2026-07-02", filed_at_date: "2026-08-01",
    });
  }
  /* The second wire spelling, on rows that are otherwise ordinary. */
  for (let i = 0; i < 8; i++) {
    filings.push({
      name: "Jae Moon", politician_id: "pid-alt", ticker: names[i % names.length],
      asset: "Synthetic Corporation - Common Stock", asset_type: "stock",
      transaction_type: "Buy",
      low_value: "1000001", high_value: "5000000", mid_value: "3000000",
      transaction_date: "2026-06-20", filed_at_date: "2026-07-15",
    });
  }
  filings.push({ notes: "no filer and no ticker" });      // unusable, counted
  return {
    filings,
    /* The status the LIVE vendor returned on 2026-09-01, not the one the
       spec's "enterprise-only" note led this fixture to guess. 422 is
       Unprocessable Entity; an entitlement refusal would be 403. The fixture
       carries what was observed. */
    holders: { __failed: "HTTP 422 — the status the live vendor returned" },
  };
}

/* Dry-run raws for the pulse leg, one entry per feed, in the wire spelling
   the spec documents (docs/uw-openapi.yaml) — snake_case, numbers sometimes
   strings, envelopes sometimes {data:[...]}. Sometimes-absent fields are
   absent on purpose, and one feed arrives failed so the composite's
   isolation is exercised on every dry run, not just on a bad vendor day. */
function fakePulseRaws(tickers) {
  const rnd = mulberry(6229);
  const names = (tickers && tickers.length ? tickers : ["SYN001"]).slice(0, 20);
  const pick = () => names[Math.floor(rnd() * names.length)];
  const tide = Array.from({ length: 78 }, (_, i) => ({
    timestamp: `2026-08-24T${String(9 + Math.floor((30 + i * 5) / 60)).padStart(2, "0")}:${String((30 + i * 5) % 60).padStart(2, "0")}:00-04:00`,
    net_call_premium: String(Math.round((rnd() - 0.4) * 4e8)),
    net_put_premium: String(Math.round((rnd() - 0.5) * 3e8)),
    net_volume: Math.round((rnd() - 0.5) * 2e6),
  }));
  const totals = { data: Array.from({ length: 24 }, (_, i) => ({
    date: `2026-07-${String(1 + i).padStart(2, "0")}`,
    call_premium: String(Math.round(rnd() * 3e10)),
    call_volume: Math.round(rnd() * 3e7),
    put_premium: String(Math.round(rnd() * 2.5e10)),
    put_volume: Math.round(rnd() * 2.5e7),
  })) };
  const oiChange = { data: Array.from({ length: 40 }, (_, i) => {
    const t = pick();
    const row = {
      option_symbol: `${t}260918${rnd() > 0.5 ? "C" : "P"}${String(Math.round(40 + rnd() * 300) * 1000).padStart(8, "0")}`,
      underlying_symbol: t,
      oi_change: String(Math.round((rnd() - 0.3) * 40000)),
      curr_oi: Math.round(rnd() * 90000),
      last_oi: Math.round(rnd() * 80000),
      volume: Math.round(rnd() * 50000),
      rnk: i,
    };
    if (i % 4 !== 3) row.trades = Math.round(rnd() * 900);
    if (i % 5 !== 4) row.avg_price = (rnd() * 40).toFixed(2);
    if (i % 6 !== 5) row.percentage_of_total = (rnd() * 0.2).toFixed(4);
    return row;
  }) };
  const netImpact = Array.from({ length: 30 }, () => ({
    ticker: pick(), net_premium: Math.round((rnd() - 0.45) * 2e8),
  }));
  const insiders = { data: Array.from({ length: 15 }, (_, i) => ({
    filing_date: `2026-08-${String(1 + i).padStart(2, "0")}`,
    purchases: Math.round(rnd() * 300), sells: Math.round(rnd() * 500),
    purchases_notional: String(Math.round(rnd() * 4e8)),
    sells_notional: String(Math.round(rnd() * 9e8)),
  })) };
  const darkpool = { data: Array.from({ length: 45 }, (_, i) => {
    const px = 20 + rnd() * 400;
    const size = Math.round(1e4 + rnd() * 2e6);
    const row = {
      ticker: pick(),
      executed_at: `2026-08-24T${String(10 + (i % 6))}:0${i % 10}:00Z`,
      price: px.toFixed(2), size,
      premium: String(Math.round(px * size)),
      volume: Math.round(rnd() * 8e7),
    };
    if (i % 3 !== 2) { row.nbbo_bid = (px - 0.05).toFixed(2); row.nbbo_ask = (px + 0.05).toFixed(2); }
    if (i % 7 === 6) row.canceled = rnd() > 0.5;
    return row;
  }) };
  return {
    tide, totals, oiChange, netImpact, insiders, darkpool,
    /* One feed fails on every dry run so the isolation is always exercised. */
    seasonality: { __failed: "synthetic outage (dry-run fixture)" },
  };
}

/* THE SESSION EVERY DRY-RUN FIXTURE DESCRIBES.

   It was a literal in one place and five string prefixes elsewhere, and the
   candle generator anchored to a different day entirely — which is how the
   emitted corpus ended up carrying closes dated FIVE MONTHS AFTER the session
   they were supposed to describe. The pipeline reads /ohlc/1d with
   end_date=sessionDate, so a fixture whose last candle is in the future is
   not a fixture of anything this code path can receive. */
export const DRY_SESSION_DATE = "2026-08-24";

/**
 * `count` trading days ending at `endDate`, oldest first.
 *
 * STEPPING ONE CALENDAR DAY IS NOT A DAILY BAR SERIES. The candle fixture
 * stepped 86400000ms per bar, so its "252 sessions" ran 252 consecutive
 * calendar days — weekends included — and its 42-session window covered 42
 * calendar days where a real one covers about sixty. Anything joining these
 * dates to the board archive, which is weekday-only by construction, was
 * joining against a calendar no exchange keeps.
 */
function tradingDaysEndingAt(endDate, count) {
  const out = [];
  let t = Date.parse(endDate + "T13:30:00Z");
  if (!Number.isFinite(t)) return out;
  while (out.length < count) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(t);
    t -= 86400000;
  }
  return out.reverse();
}

function fakeEnrichment(ticker, spot, seed) {
  const rnd = mulberry(seed);
  const bias = rnd() - 0.5;

  const greekFlow = Array.from({ length: 60 }, () => {
    const total = (rnd() * 2 - 1) * 50000;
    return {
      dir_delta_flow: String(total * (0.2 + rnd() * 0.8) * Math.sign(bias || 1)),
      total_delta_flow: String(total),
      otm_dir_delta_flow: String(total * rnd() * 0.6),
      total_vega_flow: String(rnd() * 80000),
      otm_total_vega_flow: String(rnd() * 40000),
    };
  });

  /* PER-TICK increments, matching the vendor's own definition — every field
     on a /net-prem-ticks row is that tick's value, not a running total. This
     fixture used to accumulate before storing, which pinned the opposite
     convention and hid the fact that pathSignature was differencing its input. */
  const t0 = Date.UTC(2026, 7, 24, 13, 30);
  const ticks = Array.from({ length: 390 }, (_, i) => {
    const step = (rnd() - 0.5 + bias * 0.6) * 900;
    return {
      tape_time: new Date(t0 + i * 60000).toISOString(),
      net_delta: String(step),
      net_call_premium: String(step * 120 * (0.5 + rnd())),
      net_put_premium: String(-step * 80 * (0.5 + rnd())),
    };
  });

  /* A BOOK THAT CAN ACTUALLY FLIP.

     The previous fixture drew every rung from `w * 4e6 * (rnd() - 0.45)` and
     then summed four legs whose expectation was negative, so the cumulative
     was monotone by construction and no ladder it produced could ever change
     sign. gammaFlip therefore had NOTHING to exercise in the dry run — the
     same shape of blindness that let the call_gamma / call_gamma_ask field
     names ship: a fixture that avoids the input the function exists for.

     The realistic shape is the textbook one: put gamma dominates below spot
     and call gamma above, so the cumulative starts negative, crosses once near
     the money and ends positive. `tilt` moves the crossing off spot and, on
     roughly one name in six, pushes it out of the band entirely so the
     no-flip path is exercised too. */
  /* Pivot near the money and a wide envelope, which is what a real ladder
     looks like: measured on the live INTC book, the cumulative carries 5% of
     its peak by four strikes below spot. A narrow envelope starves the lower
     lobe and every name comes back with no flip — which is a property of the
     fixture, not of the market. One name in eight is drawn one-signed so the
     genuine no-flip path is exercised too. */
  const tilt = 0.94 + rnd() * 0.12;
  const oneSided = rnd() < 0.125;
  const strikes = Array.from({ length: 41 }, (_, i) => {
    const k = spot * (0.7 + i * 0.015);
    const w = Math.exp(-Math.pow((k - spot) / (spot * 0.3), 2));
    const lean = oneSided
      ? Math.abs((k - spot * tilt) / spot)
      : (k - spot * tilt) / spot;                   // negative below the pivot
    const scale = w * 4e6 * (0.6 + rnd() * 0.8);
    const callLeg = scale * Math.max(0, lean) * 8;
    const putLeg = -scale * Math.max(0, -lean) * 8;
    return {
      strike: k.toFixed(2),
      call_gamma_ask: String(callLeg * (0.4 + rnd() * 0.3)),
      call_gamma_bid: String(callLeg * (0.3 + rnd() * 0.3)),
      put_gamma_ask: String(putLeg * (0.4 + rnd() * 0.3)),
      put_gamma_bid: String(putLeg * (0.3 + rnd() * 0.3)),
      call_gamma_oi: String(Math.abs(callLeg) * 2 + scale * 0.2),
      put_gamma_oi: String(-Math.abs(putLeg) * 1.6 - scale * 0.2),
      call_gamma_vol: String(Math.abs(callLeg) * rnd() * 2),
      put_gamma_vol: String(-Math.abs(putLeg) * rnd() * 1.4),
    };
  });

  /* THE WIRE NAMES, call_gex / put_gex — not the documented call_gamma /
     put_gamma. This fixture emitted the documented pair, so every dry run
     built a healthy roll-off calendar while every live card printed
     "unavailable: no expiry gamma". Third time a fixture has agreed with the
     code's guess instead of with the vendor; a fixture that does that tests
     nothing. */
  /* THE OTHER SIX LEGS, IN THE VENDOR'S OWN SIGN CONVENTION.

     The same lesson as the gex fixture above, one level deeper: a fixture
     that carries only the legs the code reads cannot catch the code failing
     to read a leg. It also cannot catch the trap that makes these three
     dangerous, so the signs here are copied from the vendor's own example
     rows rather than invented — put_charm NEGATIVE against a positive
     call_charm (dealer-signed, like gex), and put_vanna POSITIVE against a
     positive call_vanna (NOT dealer-signed). A fixture that signed all three
     alike would agree with any netting rule and prove nothing.

     One expiry deliberately omits the vanna pair so every dry run exercises
     a half-present leg, which is where a confident zero would otherwise be
     invented for the missing half. */
  const expiries = Array.from({ length: 6 }, (_, i) => {
    const row = {
      expiry: new Date(Date.UTC(2026, 7, 28) + i * 7 * 86400000).toISOString().slice(0, 10),
      dte: i * 7 + 4,
      call_gex: String(9e6 / (i + 1) * (0.6 + rnd())),
      put_gex: String(-7e6 / (i + 1) * (0.6 + rnd())),
      call_delta: String(2.2e8 / (i + 1) * (0.6 + rnd())),
      put_delta: String(-1.9e8 / (i + 1) * (0.6 + rnd())),
      call_charm: String(1.0e8 / (i + 1) * (0.6 + rnd())),
      put_charm: String(-9.4e8 / (i + 1) * (0.6 + rnd())),
    };
    if (i !== 4) {
      row.call_vanna = String(1.5e11 / (i + 1) * (0.6 + rnd()));
      row.put_vanna = String(4.8e11 / (i + 1) * (0.6 + rnd()));
    }
    return row;
  });

  let px = spot;
  /* ENDING AT THE SESSION, NOT STARTING SOMEWHERE. The prices are unchanged —
     they come off `rnd()` and never off the clock — so only the dates move,
     and they move onto the days this pipeline actually asks the vendor for. */
  const days = tradingDaysEndingAt(DRY_SESSION_DATE, 252);
  const ohlc = Array.from({ length: 252 }, (_, i) => {
    const move = (rnd() - 0.5) * spot * 0.03;
    const open = px; px = Math.max(1, px + move);
    return {
      // A real candle carries a timestamp; without one the fixture would not
      // exercise either candlesAscending or the session-date derivation.
      start_time: new Date(days[i]).toISOString(),
      open: open.toFixed(2), close: px.toFixed(2),
      high: (Math.max(open, px) * 1.008).toFixed(2),
      low: (Math.min(open, px) * 0.992).toFixed(2),
      volume: Math.round((3e6 + rnd() * 2e7)),
    };
  });

  return { ticker, spot, greekFlow, ticks, strikes, expiries, ohlc };
}

/* ---------- main ------------------------------------------------- */

async function main() {
  /* THE GATE'S OWN CALENDAR DAY. Not Date.now(): see daysToEarnings. The
     same value is published as `gateOrigin` on /flows/events/, so the page's
     day counts and the gate's are the same arithmetic against the same
     origin rather than two readings that agree most hours. */
  const today = easternNow().date;
  console.log(DRY_RUN ? "Flows pipeline — DRY RUN (synthetic, no network)" : "Flows pipeline — live");

  if (!DRY_RUN) {
    /* Report EVERY missing variable at once. Throwing on the first one costs a
       round trip per secret: the operator sets UW_API_KEY, re-runs, waits, and
       only then learns FLOWS_INGEST_TOKEN is also unset. */
    const missing = ["UW_API_KEY", "FLOWS_INGEST_TOKEN"].filter((k) => !process.env[k]);
    if (missing.length) {
      throw new Error(
        `missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` +
        ` — set ${missing.length > 1 ? "them" : "it"} as repository secrets under` +
        ` Settings > Secrets and variables > Actions`,
      );
    }
    console.log(`publishing to ${ingestURL()}`);
  }

  /* 0. THE SESSION, resolved before anything else is fetched, so every
        per-name call can be pinned to it. */
  const sessionDate = DRY_RUN ? DRY_SESSION_DATE : await resolveSessionDate();
  console.log(`session date: ${sessionDate || "unresolved — falling back to undated calls"}`);
  const dating = await verifyDating(sessionDate);
  console.log(`dating: date=${dating.date} end_date=${dating.endDate}`);

  // 1. Universe, from a single screener call.
  /* THE UNIVERSE IS FETCHED IN MARKET-CAP BANDS, because one call cannot
     return enough names.

     /api/screener/stocks accepts no `limit`, no `page` and no `offset` — the
     full parameter list has sixty-odd filters and not one of them pages — and
     a live run proved what that means in practice: the endpoint returned
     exactly 50 rows against filters that thousands of US names satisfy. 50 is
     a fixed page cap. The original `limit: 500` was a silent no-op, so this
     pipeline could never have cleared its own 50-name universe floor; the
     failure only surfaced once real credentials let the call through.

     With no pagination parameter, the way to see more of the market is to ask
     narrower questions. Market cap is the right axis: the bands are disjoint
     so the pages cannot overlap, `min_marketcap` and `max_marketcap` are
     unambiguous numerics already proven to work in the live call, and no enum
     value has to be guessed — unlike `sectors[]`, whose accepted spellings are
     undocumented here and would silently return nothing if wrong.

     Six bands, up to 50 each, deduplicated by ticker. Sector diversity comes
     along for free, which matters because the score neutralises on sector: a
     universe drawn entirely from one industry makes that step meaningless. */
  /* THIRTY-TWO BANDS, NOT SIX, and generated rather than hand-picked.

     The vendor's ~50-row cap binds PER BAND, so the ladder is not a
     convenience — it is the only pagination this endpoint has, and its length
     is the ceiling on how much of the market can be seen at all. Six bands
     capped the entire investable universe at 300 names before one filter ran,
     and the first band ($1-3B, a 3x span) was saturated at 50 on every run:
     the small-cap end of the market was being truncated silently, because the
     log prints what each band RETURNED and a truncated band returns exactly
     the same 50 as a complete one.

     Equal ratio rather than equal width, because listed companies are roughly
     log-uniform in market cap: equal ratio puts roughly equal pressure on
     every band's cap instead of saturating the bottom and wasting the top. */
  const CAP_BANDS = capBands({ min: UNIVERSE.minMarketCap, max: 4e12, ratio: 1.3 });

  let screener;
  if (DRY_RUN) {
    screener = fakeScreener(420);
  } else {
    const byTicker = new Map();
    let saturated = 0;
    for (const [min, max] of CAP_BANDS) {
      const page = await uw("/api/screener/stocks", {
        min_underlying_price: UNIVERSE.minPrice,
        min_volume: UNIVERSE.minOptionVolume,
        min_oi: UNIVERSE.minOpenInterest,
        min_marketcap: min,
        ...(max === null ? {} : { max_marketcap: max }),
      }).catch(() => []);
      for (const row of page) if (row && row.ticker) byTicker.set(row.ticker, row);
      const label = max === null
        ? `>= $${(min / 1e9).toFixed(1)}B`
        : `$${(min / 1e9).toFixed(1)}-${(max / 1e9).toFixed(1)}B`;
      /* A BAND THAT RETURNED EXACTLY THE CAP IS A BAND THAT WAS TRUNCATED, and
         until this line said so the truncation was invisible: a full band and
         a complete band print the same count. Saturated bands are where the
         ladder needs to be finer, and this is the only evidence of it. */
      if (page.length >= SCREENER_PAGE_ROWS) saturated++;
      console.log(`  screener ${label.padEnd(14)} ${String(page.length).padStart(3)} rows` +
                  `${page.length >= SCREENER_PAGE_ROWS ? " CAP" : "   "}` +
                  `  (union ${byTicker.size})`);
    }
    screener = [...byTicker.values()];
    if (saturated) {
      console.warn(
        `  screener: ${saturated} of ${CAP_BANDS.length} bands returned the full ` +
        `${SCREENER_PAGE_ROWS}-row page, so those bands are TRUNCATED and the ` +
        `universe below them is incomplete. Narrow the ladder's ratio to see more.`);
    }
  }

  const universe = screener.filter(eligible);
  console.log(`universe: ${universe.length} eligible of ${screener.length} screened`);
  if (universe.length < 50) throw new Error(`universe too small (${universe.length}) — refusing to publish`);

  const screenerByTicker = new Map(universe.map((r) => [r.ticker, r]));

  // 2. Cheap tilt, and the earnings gate. Earnings inside the horizon is
  //    the single largest source of false options-flow signals, so those
  //    names are excluded rather than scored and hoped for.
  /* THE TILT FOR EVERY ELIGIBLE NAME, KEPT — not just for the ones that
     survive the earnings gate. It was always computed for all of them: this
     map ran over the whole universe and the filter then threw most of the
     results away. The movers band at step 7c is ranked over the FULL eligible
     universe rather than the gated subset, because the gate exists to keep
     event-driven noise out of a PREDICTIVE composite and a list of the day's
     largest moves is descriptive — one that silently dropped every name that
     moved because it reports next Tuesday would be misdescribing the tape. */
  const withTilt = universe.map((row) => ({ row, tilt: screenerTilt(row) }));
  const tilted = withTilt.filter(({ row }) => {
    const dte = daysToEarnings(row, today);
    return dte === null || dte < 0 || dte > EARNINGS_GATE_DAYS;
  });
  console.log(`after earnings gate: ${tilted.length}`);

  const composite = tilted.map(({ row, tilt }) => ({
    row, tilt,
    /* netTilt is now net premium divided by GROSS premium, a ratio in
       [-1,1]; it used to be raw dollars, which is why it was squashed through
       tanh(x / 2e7). Dividing a ratio by twenty million made the term
       identically zero, so the selection composite silently lost a third of
       itself the moment the column was made unit-free. */
    rough: (tilt.premiumTilt || 0) + (tilt.netTilt || 0) + (tilt.volTilt || 0) +
           Math.tanh(tilt.surpriseTilt || 0),
  })).sort((a, b) => b.rough - a.rough);

  /* 3. THE ENRICHMENT POOL — A STATED UNIVERSE, NOT THE TAILS OF A PRE-SCORE.

     Until 2026-08-26 this line was selectExtremes(composite, 30): the thirty
     most and least tilted names by a rough composite of the very screener
     columns family F is built from. Two things were wrong with it, and the
     second is worse than the first.

     It published eleven names. Sixty enriched, twenty-three past the liquidity
     floor, twelve inside the dead band, eleven left. Nobody would call that a
     market view, and the owner said so.

     And it selected the cross-section on the measurement. The score is a
     residual against the spread of the pool it is computed over; when the pool
     IS the tails of that same signal, the spread is not the market's, it is
     the selection's, and every z-score in the board inherits it. A pool chosen
     for extreme tilt makes tilt look ordinary.

     Market capitalisation fixes both. It is on the screener row already, it is
     stable session to session, and — the property that does the work — it is
     independent of the option flow being scored, so selecting on it cannot
     bias the cross-section the scorer normalises against.

     The Nasdaq-100 rides along as an ADDITIVE guarantee, never a filter, so
     the dated constant behind it can rot without ever producing a wrong
     number. See shared/flows-universe.js. */
  const tiltByPick = new Map(tilted.map(({ row, tilt }) => [row.ticker, tilt]));
  const coverage = selectCoverage(tilted.map(({ row }) => row), {
    count: UNIVERSE.enrichCount,
    guaranteed: NDX_100,
  });
  const picks = coverage.map(({ row, why }) => ({
    row, why, tilt: tiltByPick.get(row.ticker) || screenerTilt(row),
  }));
  const byIndex = picks.filter((p) => p.why === PICK_INDEX).length;
  console.log(
    `enriching ${picks.length} names: ${picks.length - byIndex} by market cap ` +
    `(the largest ${UNIVERSE.enrichCount} of ${tilted.length} gated), ` +
    `${byIndex} added by Nasdaq-100 membership (list dated ${NDX_AS_OF})`);

  const enriched = [];
  let failed = 0;
  for (const [i, pick] of picks.entries()) {
    const ticker = pick.row.ticker;
    const spot = num(pick.row.close);
    try {
      let features, raw;
      if (DRY_RUN) {
        const fake = fakeEnrichment(ticker, spot, 1000 + i);
        features = computeFeatures({ ...fake, sessionDate, tilt: pick.tilt });
        raw = fake;
      } else {
        ({ features, raw } = await enrich(ticker, spot, sessionDate, dating));
        features = computeFeatures({ ...raw, ticker, spot, sessionDate, tilt: pick.tilt });
      }
      enriched.push({ features, raw, tilt: pick.tilt, row: pick.row });
    } catch (error) {
      failed++;
      console.warn(`  ${ticker}: enrichment failed — ${error.message}`);
    }
  }

  // 4. THE COMPLETENESS GATE. A partially ingested day must never
  //    quietly produce a ranking that looks complete.
  const completeness = enriched.length / picks.length;
  console.log(`enrichment: ${enriched.length}/${picks.length} (${(completeness * 100).toFixed(1)}%), ${failed} failed`);
  if (completeness < 0.8) {
    throw new Error(
      `completeness ${(completeness * 100).toFixed(1)}% below the 80% gate — publishing nothing`,
    );
  }

  // A board thinner than this is not worth showing: the cross-section it was
  // ranked against is no longer meaningful.
  const MIN_ROWS = 10;

  // 5. THE LIQUIDITY FLOOR, applied here because the screener cannot supply it.
  //    Below ~$50M median daily dollar volume, round-trip cost is 40-100 bp
  //    against a gross 10-day decile spread of 30-80 bp — the edge is gone.
  //    A name with no usable candles reports 0 and is dropped rather than
  //    waved through, because an unknown liquidity is not a passing one.
  const liquid = enriched.filter((e) => e.features.dollarVolume >= UNIVERSE.minDollarVolume);
  const dropped = enriched.length - liquid.length;
  console.log(
    `liquidity floor: ${liquid.length}/${enriched.length} clear ` +
    `$${(UNIVERSE.minDollarVolume / 1e6).toFixed(0)}M median daily dollar volume` +
    (dropped ? ` (${dropped} dropped)` : ""),
  );
  if (liquid.length < 2 * MIN_ROWS) {
    throw new Error(
      `only ${liquid.length} names clear the liquidity floor — publishing nothing ` +
      `rather than a board of names that cannot be traded at these costs`,
    );
  }

  /* 5b. ONE ROW PER ISSUER, before scoring rather than after, so the
     cross-section the scorer normalises against is not double-counting a
     company and n is right. GOOG entered fourth on the long board while
     GOOGL — the same company — sat on the short side of the median. */
  const { kept: unique, dropped: shareClasses } = collapseShareClasses(liquid);
  for (const d of shareClasses) {
    console.log(
      `share class: kept ${d.kept}, dropped ${d.dropped} ` +
      `(same sector and market cap, return correlation ${d.corr.toFixed(3)})`);
  }

  /* The cheap screener tilt, kept addressable by ticker. It was computed for
     every universe name at step 2, used once to rank the enrichment picks, and
     then dropped — including surpriseTilt, the most conventional unusual-
     activity measure in the product, which no surface has ever displayed. The
     watch list is where it finally gets published. */
  const tiltByTicker = new Map(unique.map((e) => [e.features.ticker, e.tilt]));

  // 6. Score.
  const scored = scoreBoard(
    unique.map((e) => e.features),
    unique.map((e) => e.tilt),
    unique.map((e) => e.row.sector || ""),
    unique.map((e) => num(e.row.marketcap)),
  );

  // 7. Publish both sides.
  const generatedAt = new Date().toISOString();
  const sides = partitionSides(scored);
  console.log(
    `sides: ${sides.long.length} long, ${sides.short.length} short, ` +
    `${sides.neutral} inside the +-${sides.deadBand} dead band ` +
    `(dispersion ${(scored[0] && scored[0].dispersion || 0).toFixed(3)})`);

  /* A THIN side is information, not a failure. The old gate threw the whole
     run away when either side held fewer than MIN_ROWS — which, under a
     median split, could only ever mean the pool itself was tiny. Under a dead
     band a short side of four means four names cleared the bar, and refusing
     to publish that would misreport a quiet session as an outage. Both sides
     empty is still a failure: that is a scoring fault, not a quiet day. */
  if (!sides.long.length && !sides.short.length) {
    throw new Error(
      `no name on either side cleared the +-${sides.deadBand} dead band across ` +
      `${scored.length} scored names — publishing nothing rather than an empty board`,
    );
  }

  /* Hysteresis needs a yesterday. previousIds was a hardcoded [], so
     applyHysteresis had nothing to hold and the enrichPerSide buffer — 30 a
     side instead of 25, ten extra names of API cost every run — bought
     nothing. Read the currently published board and pass its tickers. One
     request per side, and a failure is non-fatal: no incumbents simply means
     the plain top-N, which is what shipped anyway. */
  const previous = {};
  for (const side of ["long", "short"]) {
    previous[side] = await fetchPublishedTickers("board:" + side);
  }

  const published = {};
  const payloads = {};
  const first = scored[0] || {};
  for (const side of ["long", "short"]) {
    published[side] = toRows(sides[side], screenerByTicker, previous[side]);
  }

  /* WHICH ROWS HAVE A CARD, STAMPED ONTO THE ROW ITSELF.

     The board is free and the card is not, so the board is 93 rows and only
     the 50 furthest from neutral get the two calls a card costs. Without this
     flag every row still LOOKS clickable and 43 of them would open a page that
     fetches a key the pipeline never wrote — a 404 rendered as a broken
     reader, for a reason that is about a call budget and that no reader could
     possibly infer.

     Stamped HERE, from the deep list, rather than later from whether a chain
     came back: the chain leg can be skipped wholesale on a slow morning while
     the cards are still built, and a flag derived from chain success would
     then hide fifty cards that exist. It is a statement about what this run
     INTENDED to build deeply, which is exactly what the reader needs. */
  const deepSet = new Set(deepNames(published).map((d) => d.t));
  for (const side of ["long", "short"]) {
    for (const row of published[side]) {
      if (deepSet.has(row.t)) row.dp = 1;
      /* THE FOUR CHAIN COLUMNS ARE DECLARED HERE, NULL, ON EVERY ROW.

         They used to be appended by the re-publish, which skipped any row
         without a chain — and until this run every board row HAD a chain,
         because the board was eleven names and every one of them was deep. At
         93 rows and a 50-name chain budget, 43 rows would have shipped without
         their last four keys at all. The board table binds columns
         POSITIONALLY, so a row missing its trailing keys does not render four
         blanks: it renders whatever the renderer finds at those offsets, or
         nothing, under headings that no longer describe it.

         Declared null rather than omitted, in this order, so every row has the
         same shape and the re-publish OVERWRITES rather than appends —
         assigning an existing key leaves JavaScript's insertion order intact,
         so the four stay last and stay in order for the rows that do get a
         chain. A null here means "no chain was fetched for this name", which
         `deepRule` on the payload explains. */
      row.skew = null;
      row.term = null;
      row.atmIv = null;
      row.skewDays = null;
    }
  }

  for (const side of ["long", "short"]) {
    const rows = published[side];
    payloads[side] = {
      v: BOARD_SCHEMA_VERSION,
      side, generatedAt, sessionDate, rows,
      universe: universe.length,
      enriched: enriched.length,
      /* WHAT THE SCORE MEANS, published beside it. The score is now a fixed
         unit — a residual two robust sigma from the cross-sectional median
         scores 80, at any pool size — so `scored` and `dispersion` are what
         let a reader tell a genuinely wide session from a flat one. Under the
         old rank ladder both printed the same +84. */
      scored: scored.length,
      dispersion: Number.isFinite(first.dispersion) ? Number(first.dispersion.toFixed(4)) : null,
      deadBand: sides.deadBand,
      neutral: sides.neutral,
      /* HOW MANY NAMES CLEARED THE BAND ON THIS SIDE, and how many of them
         this board could not hold.

         THE PRODUCT'S STATED RULE IS THAT THE DEAD BAND DECIDES, and until
         these two fields existed the rule was not quite true: `boardSize`
         truncates each side and the overflow reaches NEITHER surface — not
         this board, and not the watch list, which by construction holds only
         the names INSIDE the band. Measured on the emitted corpus: 100
         scored, 3 inside the band, so 97 cleared it and 93 published. Four
         names were fully scored, cleared the threshold this product says is
         the threshold, and appeared nowhere — with no published number from
         which a reader could even work out that they existed.

         Both derived here, from the two lists, in one place. `cleared` is the
         side's whole pool and `shed` is what did not fit, so they cannot
         drift from the rows beside them. */
      cleared: sides[side].length,
      shed: sides[side].length - rows.length,
      // The horizon every `hm` and `hr` on this board is stated in.
      horizonSessions: HORIZON_SESSIONS,
      weights: first.weights || null,
      shareClasses,
      /* HOW MANY NAMES GOT THE EXPENSIVE TREATMENT, and the rule that chose
         them, published rather than left for a reader to infer from which
         rows happen to be clickable. */
      deep: rows.filter((r) => r.dp).length,
      deepRule: DEEP_RULE,
      selection: UNIVERSE_NOTES.rule,
      selectionEpoch: SELECTION_EPOCH,
      status: rows.length ? "ok" : "thin",
    };
    await publish("board:" + side, payloads[side]);
  }

  /* 7b. THE ARCHIVE, THE WATCH LIST, AND THE PRUNE — every one of them AFTER
     both live boards are committed, and every one of them best-effort.

     The ordering is the same argument the cards are under, and it is stronger
     here because two of these three keys are NEW. A key the ingest route has
     never seen is rejected at the door with a 400, and a throw at this point
     would exit the job non-zero after both boards had already landed — a run
     that succeeded reported as a failure, which is the exact lie the meta
     publish told on the first live run. Each surface therefore reports its own
     failure and the run continues.

     They are also ordered among themselves by what a reader loses. The dated
     copies are the record and go first; the watch list is a new product
     surface and goes second; the prune is housekeeping for data already safely
     written and goes last. */
  for (const side of ["long", "short"]) {
    const key = datedKey(side, sessionDate);
    if (!key) {
      console.warn(`  archive: session date is ${sessionDate === null ? "unresolved" : `"${sessionDate}"`}` +
                   " — refusing to write a dated key no prune could ever name");
      break;
    }
    try {
      /* The SAME payload object the live board was published from, not a
         reconstruction of it. Two builders for one payload is how the archive
         comes to describe a session the reader never saw. */
      await publish(key, payloads[side]);
    } catch (error) {
      if (error && error.status === 409) {
        /* TWO RUNS ON ONE DAY THAT DISAGREE, which is a finding rather than a
           failure — and it is the finding the immutability guard was added to
           surface. The archive keeps what the FIRST run published, because
           that is what the reader saw and what the record scorer will grade;
           this run's board is live on the undated key either way.

           Loud, because the interesting question is why they differ. The
           crons fire twice for the two US timezones and have been observed
           running hours late, so the ordinary cause is a second run against a
           later tape — but a same-session disagreement is also exactly what a
           scoring bug looks like from outside. */
        console.warn(
          `  archive ${key}: ALREADY WRITTEN by an earlier run today, and this run's board ` +
          `differs from it — the archive is immutable and KEEPS THE FIRST, which is the ` +
          `board the reader saw and the one the record will be scored against. This run's ` +
          `board is live on board:${side} regardless. Two runs on one session disagreeing ` +
          `is worth understanding: usually a second run against a later tape, but it is ` +
          `also what a scoring change mid-session would look like from here.`);
      } else {
        console.warn(`  archive ${key}: ${error.message}`);
      }
    }
  }

  try {
    const watchRows = toWatchRows(sides.neutralRows, screenerByTicker, tiltByTicker);
    await publish("board:watch", {
      v: BOARD_SCHEMA_VERSION,
      side: "watch", generatedAt, sessionDate,
      rows: watchRows,
      universe: universe.length,
      enriched: enriched.length,
      scored: scored.length,
      dispersion: Number.isFinite(first.dispersion) ? Number(first.dispersion.toFixed(4)) : null,
      deadBand: sides.deadBand,
      /* `neutral` is the FULL count inside the band and rows.length is what fit
         under the cap. Publishing both is what lets a reader see that the list
         was truncated; publishing only the list would quietly redefine the
         board's own neutral count on this one surface. */
      neutral: sides.neutral,
      horizonSessions: HORIZON_SESSIONS,
      weights: first.weights || null,
      status: watchRows.length ? "ok" : "thin",
    });
  } catch (error) {
    console.warn(`  watch: ${error.message}`);
  }

  /* 7b-ter. THE SESSION'S WHOLE SCORED POOL, archived under a dated key.

     The boards archive fifty names a side; the DISTRIBUTION dies with the
     run. So "what did we say about this name yesterday" had an answer only
     for names that made a board, and the near-misses — the most informative
     part of a quiet session — were the one part with no history. This key is
     the whole pool, {t, s} and nothing else: the score is the subject, and
     every other column already lives on the boards beside it in the archive.

     Same immutability contract as the dated boards: written once per session
     (a re-run writes identical bytes — scoresRows sorts by ticker for exactly
     that), swept by the same prune, and read back by the scoretrack leg the
     way the record reads the boards. Best-effort AFTER the boards: history
     must never cost the reader today's ranking. */
  if (ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    try {
      const scoreRows = scoresRows(sides);
      await publish(`scores:${sessionDate}`, {
        v: BOARD_SCHEMA_VERSION, generatedAt, sessionDate,
        deadBand: sides.deadBand,
        selectionEpoch: SELECTION_EPOCH,
        rows: scoreRows,
        status: scoreRows.length ? "ok" : "empty",
      });
      console.log(`  scores: ${scoreRows.length} name(s) archived for ${sessionDate}`);
    } catch (error) {
      console.warn(`  scores: ${error.message}`);
    }
  } else {
    console.warn(
      "  scores: no session date, so the pool cannot be archived under a dated key this run");
  }

  /* 7c. THE ROLLING BAND — the day's largest movers, and the largest net
     option premium by name.

     FREE. Every column it publishes was already on the screener rows fetched
     at step 1 and was already being discarded for all but the twenty-five
     names that reached a board. It issues no request, and buildMovers is
     synchronous so it cannot grow one later without that being obvious in the
     diff.

     Best-effort and after the boards for the same reason as everything else in
     this stretch: `movers` is a key the ingest route has never seen, and an
     unrecognised key is refused at the door with a 400. A throw here would
     exit the job non-zero after both boards had already landed — a successful
     run reported as a failure, which is the exact lie the first live meta
     publish told. */
  /* 7c-bis. THE MARKET LEVEL — zero vendor calls, and the reading no other
     surface in this section is capable of giving.

     Every score here is a RESIDUAL: neutralize() divides sector and log-cap out
     of the composite before the ranking is taken, which is exactly what makes
     the board a comparison between names rather than a bet on the tape. The
     cost of that design is that a board reporting fifty bullish names cannot
     say whether the tape as a whole was bought — the level was removed on
     purpose, upstream of everything.

     This reads the level, from the same screener rows the universe was built
     from, already in memory. It spends nothing.

     The tilts are passed alongside the rows rather than re-read from them,
     because `iv_rank` arrives on 0..100 and screenerTilt().ivRank is a
     FRACTION — the vendor's schema misdeclares the field, and this repository
     has published "1352% of its year" once already. */
  try {
    await publish("market", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      ...marketAggregate(
        withTilt.map((w) => w.row),
        new Map(withTilt.map((w) => [w.row.ticker, w.tilt])),
        { screened: screener.length },
      ),
      notes: MARKET_NOTES,
      status: "ok",
    });
  } catch (error) {
    console.warn(`  market: ${error.message}`);
  }

  /* Held past this try so the flow-alerts leg can re-publish the movers with
     a per-contract band cut from the alerts. Null when movers never published,
     in which case the band is silently not owed. */
  let moversPayload = null;
  try {
    const movers = buildMovers(withTilt);
    moversPayload = {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      /* THE POPULATION THE LISTS WERE RANKED OVER, published beside them. "The
         fifteen largest risers" means nothing without it: fifteen of two
         hundred is a tail, fifteen of twenty is most of the market. */
      universe: universe.length,
      cap: MOVER_ROWS,
      ranked: movers.ranked,
      priced: movers.priced,
      unrankedChange: movers.unrankedChange,
      unrankedPremium: movers.unrankedPremium,
      risers: movers.risers,
      fallers: movers.fallers,
      premium: movers.premium,
      status: (movers.risers.length || movers.fallers.length) ? "ok" : "thin",
    };
    await publish("movers", moversPayload);
    console.log(
      `  movers: ${movers.risers.length} up, ${movers.fallers.length} down of ` +
      `${movers.ranked} ranked` +
      (movers.unrankedChange ? `, ${movers.unrankedChange} with no prior close` : "") +
      `; premium ${movers.premium.bullish.length}/${movers.premium.bearish.length} of ${movers.priced}` +
      (movers.unrankedPremium ? `, ${movers.unrankedPremium} unquoted` : ""));
  } catch (error) {
    console.warn(`  movers: ${error.message}`);
  }

  /* 7e. THE EVENTS CALENDAR — the names the gate removed, finally published.

     ZERO VENDOR CALLS. Every field is a screener field the run already holds:
     screenerTilt() is computed for every eligible name at step 3 and then
     thrown away for all but the enriched, and next_earnings_date is read once
     to filter and never published.

     THE FUNNEL STAGE IS THE COLUMN THIS PAGE EXISTS FOR. The gate removes the
     most event-exposed names in the universe BY CONSTRUCTION — it has to,
     because the composite is a predictive ranking and a scheduled binary event
     is not the process it prices — and until now those names reached the
     reader as one integer in a log line. `gated` says the board was FORBIDDEN
     from holding an opinion, which is a different fact from having none.

     THE ORIGIN IS THE RUN'S EASTERN DATE, NOT sessionDate. The gate itself
     counted from Date.now(); sessionDate is the last COMPLETED session, which
     at 05:15 Eastern is one to three days earlier. Counting from sessionDate
     would draw the window early and classify every name against a gate that
     never ran — and a fixture built the same way would agree with it. */
  try {
    const gateOrigin = easternNow().date;
    const stageByTicker = new Map();
    for (const { row } of withTilt) if (row && row.ticker) stageByTicker.set(row.ticker, "screened");
    for (const { row } of tilted) if (row && row.ticker) stageByTicker.set(row.ticker, "eligible");
    for (const p of picks) if (p && p.row && p.row.ticker) stageByTicker.set(p.row.ticker, "enriched");
    for (const e of liquid) if (e && e.row && e.row.ticker) stageByTicker.set(e.row.ticker, "liquid");
    for (const side of ["long", "short"]) {
      for (const r of (payloads[side] && payloads[side].rows) || []) {
        if (r && r.t) stageByTicker.set(r.t, side === "long" ? "board:long" : "board:short");
      }
    }
    /* GATED LAST, so it overwrites every earlier stage. A name the gate
       removed never reached enrichment, and labelling it by how far it got
       before the gate would bury the one fact this page is for. */
    /* NO PASSTHROUGH OF THE GATE'S COUNT, because there is nothing to pass:
       daysToEarnings and calendarDaysTo now measure from the same ISO date,
       so the page REPRODUCES the gate's number rather than being handed it.
       `today` here IS `gateOrigin` — the same easternNow().date. */
    for (const { row } of withTilt) {
      if (!row || !row.ticker) continue;
      const dte = daysToEarnings(row, today);
      if (dte !== null && dte >= 0 && dte <= EARNINGS_GATE_DAYS) {
        stageByTicker.set(row.ticker, "gated");
      }
    }

    const featuresByTicker = new Map();
    for (const e of enriched) {
      if (e && e.row && e.row.ticker) featuresByTicker.set(e.row.ticker, e.features);
    }
    const scoreByTicker = new Map();
    for (const side of ["long", "short"]) {
      for (const r of (payloads[side] && payloads[side].rows) || []) {
        if (r && r.t && Number.isFinite(r.s)) scoreByTicker.set(r.t, r.s);
      }
    }

    const events = buildEvents(withTilt, {
      gateOrigin,
      sessionDate,
      stageOf: (t) => stageByTicker.get(t) || null,
      featuresOf: (t) => featuresByTicker.get(t) || null,
      scoreOf: (t) => (scoreByTicker.has(t) ? scoreByTicker.get(t) : null),
    });

    await publish("events", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt,
      /* BOTH CLOCKS, AND WHICH QUANTITY USES WHICH. */
      sessionDate,
      gateOrigin,
      gateDays: EARNINGS_GATE_DAYS,
      status: events.shown ? "ok" : "quiet",
      /* The announce time is not on the screener and this page does not spend
         forty-four calls to find it. Stated, not half-filled. */
      announce: { status: "unavailable", reason: EVENTS_NOTES.announce },
      ...events,
      notes: EVENTS_NOTES,
    });
    const gatedShown = events.byStage.gated || 0;
    console.log(
      `  events: ${events.shown} of ${events.inWindow} names reporting within ` +
      `${events.windowDays} days, of ${events.universe} screened` +
      (events.undated ? ` (${events.undated} carry no earnings date)` : "") +
      `; ${gatedShown} of them the board was gated out of, ` +
      `${events.evMeasured} with a priced move, ${events.rvMeasured} with realized vol`);
  } catch (error) {
    console.warn(`  events: ${error.message}`);
  }

  try {
    await pruneArchive(sessionDate);
  } catch (error) {
    console.warn(`  prune: ${error.message}`);
  }

  /* 7c'. THE TRACK RECORD — the archive finally scored. Best-effort like
     everything in this stretch, and placed AFTER today's boards, archive and
     watch list are committed: a record that fails to score must never cost
     the reader today's session. */
  let archiveWalk = null;
  try {
    archiveWalk = await collectDatedBoards(sessionDate, payloads, enriched);
    const { boards: datedBoards, probed: archiveProbed, failed: archiveFailed = 0,
      absent: archiveAbsent = 0, recovered: archiveRecovered = 0,
      statuses: archiveStatuses = [], abandoned: archiveAbandoned = false } = archiveWalk;
    const recordCloses = buildRecordCloses(enriched, universe, datedBoards, sessionDate);
    const recordCalendar = tradingCalendar([
      ...enriched.map((e) => (e.raw.ohlc || []).map(candleDate)),
      datedBoards.map((b) => b.d),
      [sessionDate],
    ]);
    const rec = scoreSessions(datedBoards, recordCloses, recordCalendar, {
      horizons: RECORD_HORIZONS,
      statedK: HORIZON_SESSIONS,
      maxSessions: RECORD_MAX_SESSIONS,
      /* The date the pool changed. Without it the scorer averages boards drawn
         from two different selection rules into one hit rate. See
         shared/flows-universe.js. */
      epoch: SELECTION_EPOCH,
    });
    const features = icTable(datedBoards, recordCloses, recordCalendar, {
      k: HORIZON_SESSIONS, minN: RECORD_IC_MIN_N, pearson, percentileRank,
    });
    await publish("record", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      status: "ok",
      statedHorizon: HORIZON_SESSIONS,
      archiveProbed,
      /* WHAT THE PROBE ACTUALLY MET. `archiveProbed` alone could not tell a
         cold archive from a store that refused every read, and the page said
         "nothing has been scored yet" — a claim about the SIGNAL — on evidence
         that was really a claim about the STORE. These four make the two
         distinguishable to anyone holding the payload. */
      archiveFailed, archiveAbsent, archiveRecovered,
      archiveStatuses, archiveAbandoned,
      attrition: RECORD_NOTES.attrition,
      epochNote: RECORD_NOTES.epoch,
      ...rec,
      features: {
        k: features.k,
        minN: features.minN,
        method: RECORD_NOTES.method,
        selection: RECORD_NOTES.selection,
        overlap: RECORD_NOTES.overlap,
        calendar: RECORD_NOTES.calendar,
        cols: features.cols,
      },
    });
    const measuredCols = features.cols.filter((c) => c.ic !== null).length;
    console.log(
      `  record: ${rec.retained} retained session(s) of ${archiveProbed} dated key(s) probed` +
      (archiveFailed ? ` (${archiveFailed} READ FAILED, so "retained" is a floor` +
        `${archiveAbandoned ? " and the walk was abandoned" : ""})` : "") + ", " +
      `${rec.sessions.length} scored at k=${HORIZON_SESSIONS}; ` +
      `features ${measuredCols}/${features.cols.length} measured`);
    /* EVERY HORIZON, IN THE LOG. The line above reports only the stated
       horizon's count, so on the morning the archive first held two sessions
       — the morning k=1 produced the first scored number this product has
       ever had — the log could not say whether it did. The payload carried
       the answer, and this sandbox's proxy blocks the site, so the one place
       the number existed was the one place nothing could read. The check-in
       that was written to report that first number could not. A diagnostic
       that exists is a diagnostic in the log. */
    /* BOTH POPULATIONS, because printing only the current rule's mean lied
       on its first output: "22 scored at k=10" beside "k=10 unmeasured
       (n=0)". Both were true — every session predated the selection epoch,
       so all 22 scored under the PRIOR rule — but a line that shows one
       population under a heading that sounds like the whole is the exact
       misreading the epoch split exists to prevent. */
    if (rec.horizons && rec.horizons.length) {
      const leg = (ls, n) => ls === null || !n
        ? null : `${(ls * 10000).toFixed(1)}bp over ${n}`;
      console.log("  record horizons: " + rec.horizons.map((h) => {
        const cur = leg(h.ls, h.n), prior = leg(h.prior, h.priorN);
        if (!cur && !prior) return `k=${h.k} unmeasured`;
        return `k=${h.k} ` + [cur && `current ${cur}`, prior && `prior-rule ${prior}`]
          .filter(Boolean).join(", ");
      }).join("; "));
    }
  } catch (error) {
    console.warn(`  record: ${error.message}`);
  }

  /* The assembled track, held for the card loop below. null when the leg was
     skipped or threw, which every card then says in its own words rather than
     drawing an empty chart. */
  let scoreTrack = null;

  /* 7c-ter. THE SCORE TRACK — each name's daily score, traced.

     ZERO VENDOR CALLS, and a VIEW rather than a store: rebuilt from the
     dated archive every run, so it can never drift from the keys it is a
     reading of. Three sources compose one timeline, strongest first:

       - a dated scores key (the whole pool for that session),
       - failing that, the two archived boards (only the names that made a
         board — the payload marks these sessions board-only, because their
         sparseness is a fact about the ARCHIVE and must not read as a fact
         about the market),
       - plus the current session's own pool, which was published minutes
         ago in this same run and would otherwise wait a day to appear.

     After the record for the same reason the record is after the boards: a
     failure here may cost only itself. */
  try {
    const walked = archiveWalk || { boards: [], scoreDays: [] };
    const dayMap = new Map();
    for (const sd of walked.scoreDays || []) {
      dayMap.set(sd.d, { d: sd.d, rows: sd.rows, source: "scores" });
    }
    const boardsByDate = new Map();
    for (const b of walked.boards || []) {
      if (!boardsByDate.has(b.d)) boardsByDate.set(b.d, []);
      boardsByDate.get(b.d).push(b.rows);
    }
    for (const [d, lists] of boardsByDate) {
      if (!dayMap.has(d)) dayMap.set(d, { d, rows: boardsToScoreRows(lists), source: "boards" });
    }
    if (ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
      dayMap.set(sessionDate, { d: sessionDate, rows: scoresRows(sides), source: "scores" });
    }

    const track = buildScoreTrack([...dayMap.values()], {
      deadBand: sides.deadBand,
      epoch: SELECTION_EPOCH,
    });
    await publish("scoretrack", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      /* The same honesty the record carries: a reader must be able to tell a
         thin trace from a store that refused the walk. */
      archive: {
        probed: walked.probed || 0,
        failed: walked.failed || 0,
        abandoned: !!walked.abandoned,
      },
      ...track,
    });
    console.log(
      `  scoretrack: ${track.names.length} name(s) over ${track.sessions.length} session(s) ` +
      `(${track.sources.full} full, ${track.sources.boardsOnly} board-only)` +
      (track.namesShed ? `; ${track.namesShed} name(s) shed for the size cap` : ""));
    /* HELD FOR THE CARD LOOP. Every card gets its own name's score history
       laid over its price, and the join is by date — see
       shared/flows-overlay.js. Kept as the whole track rather than a
       per-ticker map because `sessions` is the calendar all of them are
       index-aligned to, and splitting the two apart is how they drift. */
    scoreTrack = track;
  } catch (error) {
    console.warn(`  scoretrack: ${error.message}`);
  }

  /* 7d. SECTOR MOMENTUM — eleven candle calls, the only new requests this
     pipeline makes, spent here: after everything free has been committed and
     before the cards, which are what they are traded against.

     THE DEADLINE GUARD IS NOT DEFENSIVE CLUTTER. At the limiter's 5s ceiling
     these eleven calls are 55 seconds, and if the run has already walked past
     the card deadline then spending them buys a sector panel that lands in the
     same minute GitHub kills the job. Worse, it would be eleven calls spent on
     the way to publishing nothing. Skipping leaves the previously stored
     payload in place with its own older `generatedAt`, which is a stale
     reading a reader can see is stale — strictly better than overwriting a
     good panel with eleven nulls. */
  if (Date.now() > stats.startedAt + DEADLINE_MS) {
    console.warn(
      `  sector:trix: past the ${DEADLINE_MS / 60000}min deadline — not spending ` +
      `${SECTOR_ETFS.length} calls on a surface that would land after the cards were abandoned`);
  } else {
    try {
      /* SEQUENTIALLY, not Promise.all. The five per-name enrichment calls are
         issued together because they are five; eleven fired at once is a burst
         that the adaptive limiter cannot damp — every one of them sleeps the
         SAME delayMs concurrently and then arrives together, which is exactly
         the shape that earns a 429 and permanently raises the floor for the
         rest of the run. Serialised, the whole sector fetch is eleven inter-
         call delays: about 1.3 seconds at the 120ms start rate, against a job
         budgeted in minutes. */
      const candlesByEtf = new Map();
      for (const { etf } of SECTOR_ETFS) {
        const candles = DRY_RUN
          ? fakeSectorCandles(etf)
          : await uw(`/api/stock/${etf}/ohlc/1d`, {
            // The same year of candles, and the same session pin, that every
            // enriched name already asks this endpoint for.
            timeframe: "1Y",
            ...(sessionDate && dating.endDate ? { end_date: sessionDate } : {}),
          }).catch(() => []);
        candlesByEtf.set(etf, candles);
      }

      const sectors = sectorTrix(candlesByEtf);
      const measured = sectors.filter((s) => s.trix !== null).length;
      await publish("sector:trix", {
        v: BOARD_SCHEMA_VERSION,
        generatedAt, sessionDate,
        /* THE WHOLE RELATION, IN THE PAYLOAD. A reader holding this blob and
           nothing else can reproduce every `trix` from its own `trixBp`, and
           can undo the scaling entirely if they disagree with it. `choice:
           true` is not decoration — it is the label this project's
           identification bar requires on any published quantity that is not
           recoverable from observables alone, and the full-scale band is
           exactly such a quantity. */
        span: TRIX_SPAN,
        price: "log",
        seriesSessions: TRIX_SERIES,
        warmupSessions: TRIX_WARMUP,
        scaling: {
          rule: "fixed-clamp",
          choice: true,
          neutral: 50,
          fullScaleBp: TRIX_FULL_SCALE_BP,
          relation: "trix = 50 + 50 * clamp(trixBp / fullScaleBp, -1, +1)",
          rejected: "cross-sectional min-max (one 0 and one 100 every day, so a " +
            "flat market renders as a violent rotation) and own-history percentile " +
            "(rescales each sector by its own volatility, so the eleven bars stop " +
            "sharing an axis)",
        },
        /* NOT GICS ITSELF. Eleven tradeable baskets standing in for eleven
           sectors, and the reader is told so on the payload rather than left
           to infer it from the tickers. */
        basis: "SPDR Select Sector ETFs, not GICS index levels",
        sectors,
        measured,
        status: measured ? "ok" : "unavailable",
      });
      console.log(`  sector:trix: ${measured}/${SECTOR_ETFS.length} sectors measured`);
      for (const s of sectors) {
        if (s.reason) console.warn(`    ${s.sector} (${s.etf}): not measured — ${s.reason}`);
      }
    } catch (error) {
      console.warn(`  sector:trix: ${error.message}`);
    }
  }

  /* The names the chain leg will ask about, and the spot each was scored at.
     Both boards, deduplicated: a name can only be on one side, but building
     the list from the payloads rather than from a side keeps it in step with
     what was actually published. */
  /* THE WHOLE LEG IS INSIDE ONE GUARD, including the bookkeeping around it.
     The per-name try/catch covers a failing chain; it does not cover building
     the ticker list, reducing the summary, or the re-publish call — and this
     stretch runs AFTER both boards have landed, where this file's own rule is
     that nothing may fail the run. */
  const chainByTicker = new Map();
  try {
  /* THE DEEP NAMES, not every board name. The board is 93 rows now and each
     chain is a vendor call; deepNames() ranks by distance from neutral across
     both sides so the expensive legs go to the names furthest from neutral,
     and the card leg below uses the SAME list so the two cannot disagree
     about who is deep. */
  const deep = deepNames({ long: payloads.long.rows, short: payloads.short.rows });
  const boardTickers = [...new Set(deep.map((d) => d.t))];
  const spotByTicker = new Map();
  for (const side of ["long", "short"]) {
    for (const row of payloads[side].rows) {
      const px = num(row.px);
      if (px > 0) spotByTicker.set(row.t, px);
    }
  }
  // The chain shape is reported once per run, not once per name.
  let chainReported = false;
  /* The truncation probe is spent once per run, on the first name that fills
     the page. One call, and it answers the question for all fifty. */
  let chainProbed = false;
  const expiriesByTicker = new Map(liquid.map((e) => [e.features.ticker, e.raw.expiries || []]));

  /* 7e. THE OPTION CHAIN, ONE CALL PER BOARD NAME.

     Fifty calls, and they are the last vendor spend of the run. Every other
     surface a reader already has is committed by this point: both boards, the
     dated archive, the watch list, the movers band, the record and the sector
     panel. The chain leg is therefore the FIRST thing a slow morning takes
     away, which is the correct degradation order — it feeds panels a reader
     can live without and a history that can be gappy and say so.

     SEQUENTIALLY, never Promise.all, for the reason the sector leg states at
     length: fifty concurrent calls all sleep the same delay and then arrive
     together, which is exactly the burst shape that earns a 429 and
     permanently raises the floor for the rest of the run.

     TWO GUARDS, NOT ONE. The leg-level check refuses to start past the
     deadline; the per-name check stops partway rather than eating the card
     window, because a run that spends its last four minutes on chains and then
     publishes no cards has traded a panel for a page. */
  if (Date.now() > stats.startedAt + DEADLINE_MS) {
    console.warn(
      `  chains: past the ${DEADLINE_MS / 60000}min deadline — not spending ` +
      `${boardTickers.length} calls on panels that would land after the cards were abandoned`);
  } else {
    const chainDeadline = stats.startedAt + DEADLINE_MS - CHAIN_RESERVE_MS;
    let chainOk = 0, chainFailed = 0, chainSkipped = 0, scalarsRecovered = 0;
    for (const ticker of boardTickers) {
      if (Date.now() > chainDeadline) {
        chainSkipped = boardTickers.length - chainOk - chainFailed;
        console.warn(
          `  chains: stopping after ${chainOk + chainFailed} names — within ` +
          `${CHAIN_RESERVE_MS / 60000}min of the deadline and the cards still need it`);
        break;
      }
      try {
        const rows = DRY_RUN
          /* THE FIRST TWO NAMES FILL THE PAGE, the rest fit. Both shapes are
             live — the 2026-08-26 run truncated on ten names of eleven — and a
             dry run that only ever sees one of them exercises the refusal or
             the happy path but never both in the same session, nor the
             re-publish that has to carry a mix of the two.

             TWO rather than one, because one cannot distinguish "the probe
             runs once per run" from "the probe runs once per truncated name",
             and the difference is nine wasted vendor calls on a live morning. */
          ? fakeChain(ticker, spotByTicker.get(ticker) || 100, 7000 + chainOk + chainFailed,
            { wide: chainOk + chainFailed < 2 })
          : await uw(`/api/stock/${ticker}/option-contracts`, {
            /* NOT maybe_otm_only. The desk filters to the sellable book because
               it is pricing a sale; this leg is measuring a SURFACE, and the
               at-the-money contract — the single most load-bearing input in
               ivSurface, since every skew cell in a column is measured against
               it — is exactly what that filter removes.

               exclude_zero_oi_chains stays: a listed contract nobody holds and
               nobody traded is a row of nulls, and at a 500-row page ceiling
               those rows are spent instead of real strikes. It is a stated
               selection, published on the panel. */
            exclude_zero_oi_chains: "true",
            limit: CHAIN_PAGE_SIZE,
          });

        /* THE VENDOR HAS BEEN WRONG FIVE TIMES. One bounded dump of the first
           row's actual keys, once per run, is what solved the call_gex mystery
           in a single run — and the aggressor split in particular is a field
           this leg publishes a whole panel from. */
        if (!chainReported && rows.length) {
          chainReported = true;
          const first = rows[0];
          const want = ["option_symbol", "nbbo_bid", "nbbo_ask", "implied_volatility",
                        "volume", "ask_volume", "bid_volume", "open_interest", "prev_oi"];
          const present = want.filter((k) => first[k] !== undefined);
          const missing = want.filter((k) => first[k] === undefined);
          console.log(`  chain fields (${ticker}, ${rows.length} rows): ${present.join(", ")}`);
          if (missing.length) {
            console.warn(`    NOTE: absent on the first row: ${missing.join(", ")}` +
              ` — keys actually present: ${Object.keys(first).slice(0, 24).join(", ")}`);
          }
        }

        let panels = buildChainPanels(rows, {
          spot: spotByTicker.get(ticker) || null,
          asOf: sessionDate,
          ticker,
        });

        /* THE SECOND CALL, AND THE MEASUREMENT THAT EARNED IT.

           A chain that fills the vendor's 500-row page publishes no scalars,
           because "the nearest expiry" cannot be identified inside an
           arbitrarily-ordered subset. On the first wide-board run that refusal
           fired on FORTY-FIVE OF FIFTY names: `chains: 50 built, 5 levelled`.
           The leg was spending fifty calls to publish a skew for five names.

           The probe built for exactly this question answered it in the same
           run — `FILTER WORKS: 58 row(s) over expiries: 2026-09-04` — so the
           endpoint does accept an expiry filter, and one more call buys a
           COMPLETE single expiry rather than a slice of the book.

           TWO CALLS, NOT ONE, and the split is not waste. The broad call is
           the only thing that can build a surface, a term line and an
           aggressor ladder across expiries; the narrow one is the only thing
           that can identify a nearest. Neither substitutes for the other, and
           this is the same name paying for two different questions.

           Spent only where the first call actually truncated, and inside the
           same deadline guard as the loop, so a slow morning drops it before
           it drops a card. */
        if (panels.status === "ok" && panels.truncated && Date.now() < chainDeadline) {
          const near = nearestProbeExpiry(expiriesByTicker.get(ticker), {
            asOf: sessionDate, minDays: SKEW_MIN_DAYS,
          });
          if (near) {
            try {
              const narrow = DRY_RUN
                /* `wide` because recovery only runs on a name whose broad call
                   truncated, and in this fixture that is exactly the wide book.
                   Asking the narrow ladder for an expiry it does not list would
                   return nothing and quietly exercise the failure path instead
                   of the one under test. */
                ? fakeChain(ticker, spotByTicker.get(ticker) || 100, 8000 + chainOk,
                  { wide: true, expiry: near })
                : await uw(`/api/stock/${ticker}/option-contracts`, {
                  expiry: near,
                  exclude_zero_oi_chains: "true",
                  limit: CHAIN_PAGE_SIZE,
                });
              const narrowPanels = buildChainPanels(narrow, {
                spot: spotByTicker.get(ticker) || null,
                asOf: sessionDate,
                ticker,
                requestedExpiry: near,
              });
              /* THE PANELS STAY BROAD; ONLY THE SCALARS COME FROM THE NARROW
                 READ. A surface drawn from one expiry is one column, which is
                 not a surface — and the scalars are the only thing the
                 truncation refusal ever withheld. */
              if (narrowPanels.status === "ok" && narrowPanels.identifiedExpiry) {
                panels = {
                  ...panels,
                  scalars: narrowPanels.scalars,
                  identifiedExpiry: narrowPanels.identifiedExpiry,
                  skewTerm: narrowPanels.skewTerm.status === "ok"
                    ? narrowPanels.skewTerm : panels.skewTerm,
                };
                scalarsRecovered++;
              }
            } catch (error) {
              console.warn(`  chain ${ticker}: single-expiry read failed — ${error.message}`);
            }
          }
        }

        chainByTicker.set(ticker, panels);
        if (panels.status === "ok") chainOk++; else chainFailed++;

        /* ONE CALL, ONCE, ON THE FIRST TRUNCATED NAME. Its own try/catch and
           its own flag: a diagnostic that can fail the leg it is diagnosing is
           worse than no diagnostic, and a probe that repeats is a second call
           per name for an answer that does not vary by name. */
        if (!chainProbed && panels.truncated) {
          const probeExpiry = nearestProbeExpiry(expiriesByTicker.get(ticker), {
            asOf: sessionDate, minDays: SKEW_MIN_DAYS,
          });
          if (probeExpiry) {
            chainProbed = true;
            try {
              const probeRows = DRY_RUN
                /* THE FIXTURE ANSWERS "IGNORED", NOT "WORKS". A fixture that
                   agrees with the code's hope is the failure mode this file
                   has hit three times — call_gamma, the aggressor split, the
                   put/call collision — so the dry run exercises the branch
                   that must not be mistaken for success. */
                ? fakeChain(ticker, spotByTicker.get(ticker) || 100, 9000).slice(0, 40)
                : await uw(`/api/stock/${ticker}/option-contracts`, {
                  expiry: probeExpiry,
                  exclude_zero_oi_chains: "true",
                  limit: CHAIN_PAGE_SIZE,
                });
              for (const line of describeChainProbe(ticker, probeExpiry, probeRows)) {
                console.log(line);
              }
            } catch (error) {
              console.warn(`  chain probe (${ticker}, expiry=${probeExpiry}): ${error.message}` +
                " — the parameter may be rejected outright, which is itself an answer");
            }
          }
        }
      } catch (error) {
        chainFailed++;
        console.warn(`  chain ${ticker}: ${error.message}`);
      }
    }
    const built = [...chainByTicker.entries()].filter(([, c]) => c.status === "ok");
    const levelled = built.filter(([, c]) => c.scalars.atmIv !== null).length;
    const skewed = built.filter(([, c]) => c.scalars.skew !== null).length;
    console.log(
      `  chains: ${chainOk} built, ${chainFailed} failed` +
      (chainSkipped ? `, ${chainSkipped} skipped for the deadline` : "") +
      `; ${levelled} levelled, ${skewed} with a skew reading` +
      (scalarsRecovered
        ? `, ${scalarsRecovered} of them recovered by a second single-expiry call`
        : ""));
    /* THE UNMEASURED NAMES BY NAME, the way the sector leg reports its own.
       "15 built, 2 with a skew" is a number nobody can act on; which two, and
       why, is the line that gets read on the morning something is wrong. */
    for (const [t, c] of built) {
      if (c.skewTerm.status !== "ok") continue;
      if (c.scalars.skew === null) console.warn(`    ${t}: no skew — ${c.skewTerm.skewReason}`);
      if (c.scalars.atmIv === null) console.warn(`    ${t}: no ATM level — ${c.skewTerm.atmReason}`);
      if (c.foreignRows) console.warn(`    ${t}: dropped ${c.foreignRows} adjusted-series row(s)`);
    }
    /* ---- WHY THE SKEW WINDOW MISSES, aggregated across the run ----

       THE PER-NAME LINES ABOVE CANNOT SETTLE A CONSTANT. Thirteen separate
       "no skew" warnings tell an operator that thirteen names missed; they do
       not say whether widening SKEW_TOLERANCE from 0.04 would have caught
       twelve of them or none, and that is the only question the number is
       there to answer.

       So the misses are pooled and reported as a distribution. A cluster of
       near-misses just outside the window is a ladder-spacing problem a wider
       tolerance fixes, at a stated cost in how good a stand-in the wing is. An
       unpriced wing is not — no tolerance reaches a contract with no implied
       volatility — and a side that is not listed at all is a third thing
       again. One run now distinguishes them.

       The tolerance is NOT changed here. Choosing it from a guess is what
       this diagnostic exists to replace. */
    const misses = [];
    for (const [, c] of built) {
      if (c.skewTerm.status !== "ok" || c.scalars.skew !== null) continue;
      if (c.skewTerm.skewMiss) misses.push(c.skewTerm.skewMiss);
    }
    if (misses.length) {
      /* THE ARITHMETIC LIVES IN shared/flows-chain.js so it can be tested.
         It decides whether SKEW_TOLERANCE moves, and it was the one part of
         this diagnostic nothing checked — a wrong count here produces a
         confident, wrong decision about a published constant. */
      const sum = summariseSkewMisses(misses);
      console.log(
        `  skew misses: ${sum.names} name(s) with no reading, ${sum.wings} wing(s) between ` +
        `them — ${sum.outside} listed and priced but outside the ${sum.tolerance} window, ` +
        `${sum.unpriced} listed with no implied volatility, ${sum.unlisted} not listed at all` +
        (sum.inside
          ? `, ${sum.inside} already inside the window (the OTHER wing is what failed on ` +
            `those names, so no widening helps them)`
          : "") +
        (sum.outside
          ? `. Nearest misses ${sum.gaps.slice(0, 5).map((g) => g.toFixed(4)).join(", ")}` +
            `; a window of 0.05 would reach ${sum.wouldCatch(0.05)} of those WINGS, ` +
            `0.06 ${sum.wouldCatch(0.06)}, 0.08 ${sum.wouldCatch(0.08)} — and a name needs ` +
            `BOTH wings, so wings caught is an upper bound on readings recovered, not a count ` +
            `of them`
          : "") +
        ". A wider window reaches only the outside group; the rest are coverage facts no " +
        "constant can fix.");
    }

    /* ZERO LEVELLED ACROSS THE WHOLE BOARD is not a thin day, it is a broken
       assumption — most plausibly that the vendor's `volume` is not today's
       session volume at the hour this job runs, which would mean no expiry
       anywhere can carry an at-the-money level. */
    if (built.length && !levelled) {
      console.warn(
        "  chains: NOT ONE name carried an at-the-money level. Every level requires a " +
        "contract that traded today, so this reads as `volume` being absent or zero " +
        "chain-wide at this hour rather than as a quiet session.");
    }
  }

  /* 7f. THE BOARDS, RE-PUBLISHED WITH WHAT THE CHAIN MEASURED.

     The three scalars have to reach the DATED row or their history never
     accumulates — a skew percentile exists only from the first session that
     archived a skew, and every run that publishes the board without one is a
     session that can never be recovered. But boards must publish BEFORE the
     chain leg spends fifty calls, so the fields cannot be there the first
     time. Hence a second write.

     DATED FIRST, THEN LIVE, PER SIDE. At final state the two are byte-
     identical, which is the invariant the archive rests on; if the dated write
     fails, the live board is left as it was rather than gaining a field its
     own archive copy will never have. A mid-leg failure therefore leaves the
     pre-chain boards standing — complete, consistent, and simply without the
     new columns.

     If the chain leg never ran, this is skipped entirely and the session's row
     is gappy. That is the honest outcome, and the IC table's per-column n
     reports it without anyone having to remember. */
  if (chainByTicker.size) {
    for (const line of await republishWithChain(payloads, chainByTicker, sessionDate, publish)) {
      console.log(line);
    }
  }

  /* 7f'. THE UNUSUAL-ACTIVITY FEED — every chain's contribution, pooled.

     ZERO MARGINAL VENDOR CALLS. Each chain already built its own rows inside
     buildChainPanels, where the implied-volatility divisor and the
     root-filtered rows live; this leg only pools, ranks and publishes them.
     The name panel below costs nothing either — it is the screener rows the
     run has held since step 2.

     AFTER THE BOARDS, LIKE EVERYTHING IN THIS STRETCH. A feed that fails to
     build must never cost the reader the session's ranking. */
  try {
    const pooled = [];
    const coverage = [];
    let namesTruncated = 0, foreign = 0;
    const divisors = new Set();
    for (const [ticker, c] of chainByTicker) {
      if (!c || c.status !== "ok" || !Array.isArray(c.unusualRows)) continue;
      pooled.push(...c.unusualRows);
      if (c.truncated) namesTruncated++;
      foreign += Number(c.foreignRows) || 0;
      if (Number.isFinite(c.ivDivisor)) divisors.add(c.ivDivisor);
      coverage.push({
        t: ticker,
        rows: Number(c.rowsSeen) || 0,
        p: c.truncated ? 1 : 0,
        ivDivisor: Number.isFinite(c.ivDivisor) ? c.ivDivisor : null,
        ivBasis: c.ivBasis || null,
      });
    }
    const namesSeen = coverage.length;
    const contracts = rankUnusual(pooled, { namesSeen });
    const names = rankUnusualNames(withTilt);

    await publish("unusual", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      /* WHEN THE CHAIN WAS READ, and it is deliberately NOT a claim about
         what the counter counts. The two are published side by side with the
         reason, because a single timestamp on this page would be read as the
         counter's date and there is no such thing. */
      readAt: generatedAt,
      volumeAsOf: null,
      volumeAsOfReason: "the endpoint accepts no date parameter and carries no as-of stamp",
      dteAnchor: "sessionDate",
      status: contracts.shown ? "ok" : (namesSeen ? "quiet" : "pending"),
      /* null, NOT false, when no chain contributed. "Incomplete" is a claim
         about coverage and there is no coverage to be incomplete about. */
      complete: namesSeen ? namesTruncated === 0 : null,
      namesSeen,
      namesTruncated,
      namesComplete: namesSeen - namesTruncated,
      foreign,
      ivConventionsSeen: divisors.size,
      coverage,
      contracts,
      names: { ...names, earningsGated: withTilt.length - tilted.length },
      basis: {
        unit: UNUSUAL_NOTES.unit,
        date: UNUSUAL_NOTES.date,
        rank: { key: "vor", choice: true, relation: "vor = volume / open_interest",
          reason: UNUSUAL_NOTES.rank },
        floors: { minVolume: UA_MIN_VOLUME, minOi: UA_MIN_OI, perName: contracts.perName,
          choice: true,
          reason: "A minimum volume keeps a 200-lot on a five-contract open interest " +
            "from dominating the ranking with a vor of forty; a minimum open interest " +
            "is the denominator, and is what makes vor finite by construction." },
        /* VERBATIM FROM THE BUILDER, taken off a chain that actually built
           one. Two spellings of one relation is how a page and its payload
           start disagreeing — and calling the builder with an empty array to
           harvest the string would get a dead panel with no relation on it,
           which is how the first attempt published `null` here. */
        aggr: (() => {
          for (const c of chainByTicker.values()) {
            const r = c && c.topContracts && c.topContracts.relation;
            if (typeof r === "string" && r) return r;
          }
          return null;
        })(),
        lift: UNUSUAL_NOTES.lift,
        notional: UNUSUAL_NOTES.notional,
        iv: UNUSUAL_NOTES.iv,
        oi: UNUSUAL_NOTES.oi,
        zeroOi: UNUSUAL_NOTES.zeroOi,
        names: UNUSUAL_NOTES.names,
        refusals: UNUSUAL_NOTES.refusals,
      },
    });
    console.log(
      `  unusual: ${contracts.shown} of ${contracts.eligible} contracts over ` +
      `${namesSeen} chain(s) (cap bound by ${contracts.capBound}, ${contracts.perName} per name); ` +
      `${names.shown} of ${names.ranked} names ranked of ${names.universe}` +
      (names.unranked ? `, ${names.unranked} unranked for want of a 30-day average` : "") +
      (divisors.size > 1 ? `; ${divisors.size} IV conventions in one table` : ""));

    /* THE OPEN-INTEREST BASIS DIAGNOSTIC. Costs nothing, run on the first
       chain that produced feed rows, and its zero branch reports itself as
       INCONCLUSIVE rather than as evidence — see describeOiBasis. */
    const firstChain = [...chainByTicker.values()].find(
      (c) => c && c.status === "ok" && c.oiBasis && c.oiBasis.seen > 0);
    if (firstChain) {
      console.log("  " + (DRY_RUN ? "[dry-run] " : "") + firstChain.oiBasis.line +
        (DRY_RUN
          ? " On synthetic rows this is two unrelated fixture formulas disagreeing," +
            " and is not evidence about the vendor."
          : ""));
    }
    /* 7f''. THE VENDOR'S FLOW ALERTS — the probe, grown into a feed.

       The probe this block replaces existed to settle an assertion: this
       file claimed in two places that the per-trade endpoint was
       unreachable on this key, with no status code ever recorded to back
       it. Five live runs answered REACHABLE (200, {data:[...]}), so the
       assertion is dead and the one call the probe spent now buys the
       feed itself. ONE call — the endpoint is market-wide, not per-name.

       The stage map is rebuilt here rather than shared with the events
       leg's: that one lives inside another try whose failure must not
       cost this feed, and gated is derived the cheap way (screened minus
       gate survivors) because for THIS surface the one load-bearing
       distinction is board / scored / gated / foreign. */
    try {
      const raw = DRY_RUN
        ? fakeFlowAlerts((payloads.long.rows || []).map((r) => r.t))
        : await uw("/api/option-trades/flow-alerts", { limit: ALERT_VENDOR_LIMIT });
      /* Measured on the WIRE rows, before any shaping drops anything: the
         question is what the vendor sent, not what survived our parser. */
      const alertRowCount = unwrapVendorRows(raw).length;

      const survivors = new Set((tilted || []).map((x) => x.row && x.row.ticker));
      const stage = new Map();
      for (const { row } of withTilt || []) {
        if (row && row.ticker) stage.set(row.ticker, survivors.has(row.ticker) ? "eligible" : "gated");
      }
      for (const e of liquid || []) if (e && e.row && e.row.ticker) stage.set(e.row.ticker, "scored");
      for (const side of ["long", "short"]) {
        for (const r of (payloads[side] && payloads[side].rows) || []) {
          if (r && r.t) stage.set(r.t, "board:" + side);
        }
      }

      const alerts = buildFlowAlerts(raw, { stageOf: (t) => stage.get(t) || null });
      await publish("flowalerts", {
        v: BOARD_SCHEMA_VERSION,
        generatedAt, sessionDate,
        /* The alerts carry their own vendor timestamps per row, but the READ
           is this run's: a reader must be able to see that a quiet feed may
           simply be a pre-open read of a feed that fills intraday. The worker
           cron re-reads this key during the session and flips `refreshed` to
           "intraday"; publishing the field here keeps one schema with two
           writers instead of a field that exists only sometimes. */
        readAt: new Date().toISOString(),
        refreshed: "nightly",
        ...alerts,
        /* WHOSE CEILING THE READ HIT. `shed` counts what OUR published cap
           removed from what we received; it says nothing about what the
           vendor withheld before we saw it. When the response length equals
           the requested limit the population above it is unknown, and a
           reader comparing today's count to yesterday's is comparing two
           ceilings rather than two markets. */
        vendorLimit: ALERT_VENDOR_LIMIT,
        vendorTruncated: alertRowCount >= ALERT_VENDOR_LIMIT,
      });
      console.log(
        `  flow-alerts: ${alerts.rows.length} alert(s) kept of ${alerts.seen}` +
        (alertRowCount >= ALERT_VENDOR_LIMIT
          ? ` — WHICH IS THE VENDOR'S MAXIMUM (${ALERT_VENDOR_LIMIT}), so the true ` +
            "population is unknown and at least that large; this route's limit " +
            "cannot be raised, and today's count is a ceiling rather than a measurement"
          : "") +
        (alerts.shed ? ` (${alerts.shed} shed by the ${ALERT_ROWS}-row cap)` : "") +
        (alerts.unusable ? `, ${alerts.unusable} unusable` : "") +
        `; ${alerts.coverage.sweeps} sweep-flagged, ${alerts.coverage.opening} all-opening, ` +
        `${alerts.coverage.calls}C/${alerts.coverage.puts}P of ${alerts.coverage.withContract} with a parsed contract`);

      /* THE MOVERS' PER-CONTRACT BAND, finally. The movers premium lists are
         byName because the screener reports whole-symbol premium, and the old
         comment said contract-level needed "a flow-alerts endpoint this key
         does not reach" — a sentence six live runs have since retired. The
         band is cut from the SHAPED alerts already in hand (zero calls) and
         the movers are re-published whole (one extra row write). Isolated on
         purpose: a failure here leaves the band-less movers already
         published, and the flowalerts key above is committed either way. */
      if (moversPayload) {
        try {
          moversPayload.premium = { ...moversPayload.premium, byContract: alertBand(alerts.rows) };
          await publish("movers", moversPayload);
          console.log(`  movers band: ${moversPayload.premium.byContract.rows.length} contract window(s) ` +
            `of ${moversPayload.premium.byContract.seen} priced alerts`);
        } catch (error) {
          console.warn(`  movers band: ${error.message} — movers stand as first published, without the band`);
        }
      }
    } catch (error) {
      console.warn(`  flow-alerts: ${error.message} — the counter feed above published before this leg ran`);
    }
  } catch (error) {
    console.warn(`  unusual: ${error.message}`);
  }

  } catch (error) {
    console.warn(`  chains: ${error.message} — the boards published before this leg ran ` +
      "and are unaffected");
  }

  /* 7g. THE MARKET PULSE — seven market-wide feeds, one call each, pooled
     under one key.

     WHY SEVEN SEQUENTIAL FETCHES AND NOT A Promise.all: the rate limiter is
     a shared instance whose whole design is one call in flight at a time —
     parallelizing here would race its delay accounting for a saving of
     seconds against a leg that costs seven calls.

     EVERY FEED FAILS ALONE. A fetch failure becomes {__failed: reason} and
     buildPulse publishes that feed as unavailable-with-reason while its six
     neighbours carry data. The leg as a whole failing (the publish itself)
     costs only this key — everything above committed first.

     FIELD SHAPES are the spec's (docs/uw-openapi.yaml) read defensively; the
     quiet-but-rows diagnostic below is the tripwire for the spec being wrong
     the sixth time: a feed that RETURNED rows but shaped to nothing dumps
     its first row's keys to this log, which is the output that has solved
     every prior shape mystery in one run. */
  try {
    const PULSE_FETCHES = {
      tide: ["/api/market/market-tide", { interval_5m: "true" }],
      totals: ["/api/market/total-options-volume", { limit: PULSE_CAPS.totals }],
      oiChange: ["/api/market/oi-change", { limit: 100 }],
      netImpact: ["/api/market/top-net-impact", { limit: PULSE_CAPS.netImpact }],
      insiders: ["/api/market/insider-buy-sells", { limit: PULSE_CAPS.insiders }],
      darkpool: ["/api/darkpool/recent", { limit: 100 }],
      seasonality: ["/api/seasonality/market", {}],
    };
    const raws = {};
    if (DRY_RUN) {
      Object.assign(raws, fakePulseRaws((payloads.long.rows || []).map((r) => r.t)));
    } else {
      for (const [feed, [path, params]] of Object.entries(PULSE_FETCHES)) {
        try {
          raws[feed] = await uw(path, params);
        } catch (error) {
          raws[feed] = { __failed: error && error.message ? error.message : String(error) };
        }
      }
    }
    const pulse = buildPulse(raws);
    for (const feed of PULSE_FEEDS) {
      const f = pulse[feed];
      if (f.status === "quiet") {
        const first = (Array.isArray(raws[feed]) ? raws[feed] : (raws[feed] && raws[feed].data) || [])[0];
        if (first && typeof first === "object") {
          console.log(`  pulse ${feed}: NOTE returned rows but none shaped — first-row keys: ` +
            Object.keys(first).slice(0, 24).join(", "));
        }
      }
    }
    await publish("pulse", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      /* The READ time, distinct from the vendor's own per-point stamps: the
         worker cron re-publishes this key intraday and a reader must be able
         to see which read they are looking at. */
      readAt: new Date().toISOString(),
      refreshed: "nightly",
      ...pulse,
    });
    const okCount = PULSE_FEEDS.filter((f) => pulse[f].status === "ok").length;
    console.log(`  pulse: ${okCount} of ${PULSE_FEEDS.length} feeds ok — ` +
      PULSE_FEEDS.map((f) => `${f}:${pulse[f].status}${pulse[f].rows ? ":" + pulse[f].rows.length : pulse[f].points ? ":" + pulse[f].points.length : ""}`).join(" "));
  } catch (error) {
    console.warn(`  pulse: ${error.message} — every key above published before this leg ran`);
  }

  /* 7i. THE POLITICAL SECTION — who disclosed the largest purchases.

     WHY congress-trader AND NOT recent-trades. A ranking needs a POPULATION,
     and recent-trades caps at 200 rows with no page parameter: the top of a
     ranking built on it would be "whoever filed most recently", dressed as
     "whoever bought most". congress-trader documents `page` (1-indexed),
     `date_from` and `date`, and its `name` filter is optional — so the same
     route paginates the whole chamber across a stated window. That makes the
     window, not the vendor's row budget, the thing the caption has to name.

     THE PAGE PARAMETER IS VERIFIED, NOT ASSUMED. If the vendor ignores
     `page` — this specification has been wrong five times — every page
     returns the same rows, and summing eight identical pages inflates every
     ranked total EIGHTFOLD while every internal check still passes: the sums
     are consistent, the ordering is stable, the page simply lies by a factor.
     So each page is fingerprinted and a repeat stops the walk, keeps the
     first page only, and says in the payload that pagination did not answer.
     A short page also stops it, which is the ordinary end.

     THE HOLDERS FEED IS ENTERPRISE-ONLY by the spec's own note, so it is
     expected to 403 on this key. It fails alone — the section publishes
     without it — and the first refusal ends the walk rather than spending one
     call per name to be told the same thing six times. */
  try {
    const POLITICAL_WINDOW_DAYS = 90;
    const POLITICAL_PAGE_LIMIT = 200;
    const POLITICAL_MAX_PAGES = 8;
    const POLITICAL_HOLDER_NAMES = 6;
    const from = new Date(Date.parse((sessionDate || new Date().toISOString().slice(0, 10)) +
      "T00:00:00Z") - POLITICAL_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

    const raws = {};
    let pagesRead = 0, paginated = null, fellBack = false;
    if (DRY_RUN) {
      Object.assign(raws, fakePoliticalRaws((payloads.long.rows || []).map((r) => r.t)));
      /* NULL, NOT ZERO. A fixture read no pages, and "0 pages, 154 filings"
         is a self-contradicting pair that a reader would have to guess at.
         The same distinction the payloads keep everywhere else. */
      pagesRead = null;
    } else {
      const filings = [];
      const seenRows = new Set();
      const identity = (r) => `${r && r.politician_id || r && r.name || ""}|` +
        `${r && r.ticker || ""}|${r && r.transaction_date || ""}|` +
        `${r && r.filed_at_date || ""}|${r && r.amounts || r && r.mid_value || ""}`;
      try {
        /* THE DATE LADDER, AND WHY IT REPLACED A PAGE WALK.

           The first live run measured this leg and the measurement said the
           design was wrong. congress-trader documents `page`, `date_from` and
           `date`, so it looked like the wider population — but its own
           description begins "Returns the recent reports by THE GIVEN
           CONGRESS MEMBER". `name` is optional in the parameter list and the
           route is per-member in fact: called without one over a 90-day
           window it returned SEVEN filings, and the buyers ranking published
           exactly one name. In the same run, the card leg's
           /congress/recent-trades returned 100.

           One route returned 100 and the other 7, same vendor, same session.
           Pagination bought a NARROWER population, not a wider one.

           recent-trades has no page parameter, but its `date` is documented
           as an upper bound on transaction date — which is a ladder. Walk it
           backwards: take a page, find the oldest transaction date in it, ask
           again with `date` set there. That is the same shape the universe
           walker uses against a route that also refuses to paginate, and for
           the same reason.

           TWO GUARDS, BOTH LOAD-BEARING. A ladder whose cursor does not
           advance repeats forever, so a rung that fails to move the date ends
           the walk. And because `date` is inclusive, consecutive rungs
           overlap on the boundary day by construction — so rows are deduped
           on identity, and a rung contributing nothing NEW ends the walk too.
           Without the dedupe every boundary day would be counted twice and
           the ranked totals would be quietly inflated. */
        let cursor = sessionDate || null;
        for (let rung = 1; rung <= POLITICAL_MAX_PAGES; rung++) {
          const rows = unwrapVendorRows(await uw("/api/congress/recent-trades", {
            limit: POLITICAL_PAGE_LIMIT, date: cursor || undefined,
          }));
          if (!rows.length) break;

          let added = 0;
          let oldest = null;
          for (const r of rows) {
            const d = r && typeof r.transaction_date === "string"
              ? r.transaction_date.slice(0, 10) : null;
            if (d && (oldest === null || d < oldest)) oldest = d;
            /* The window is applied HERE rather than by the vendor, because
               recent-trades takes only an upper bound. A row older than the
               floor is outside the stated window and is not counted. */
            if (d && d < from) continue;
            const key = identity(r);
            if (seenRows.has(key)) continue;
            seenRows.add(key);
            filings.push(r);
            added++;
          }
          pagesRead++;

          if (!added) {
            /* Every row on this rung was already held. Either the vendor
               ignored the cursor or the ladder has walked past the window;
               both mean the next rung would cost a call and add nothing. */
            paginated = pagesRead > 1;
            break;
          }
          if (rows.length < POLITICAL_PAGE_LIMIT) { paginated = pagesRead > 1 ? true : null; break; }
          if (!oldest || oldest < from) { paginated = pagesRead > 1; break; }
          if (oldest === cursor) {
            /* THE CURSOR DID NOT MOVE. A full page whose oldest transaction
               is the day we asked for means one date holds more filings than
               a page can carry, and the ladder cannot step past it without
               losing the remainder. Stopping is the honest end: the payload
               reports how far it actually reached. */
            console.warn(`  political: the ladder stalled at ${cursor} — a single ` +
              "date carries more filings than one page holds, so the window is " +
              "read only back to there");
            paginated = pagesRead > 1;
            break;
          }
          cursor = oldest;
          if (rung === POLITICAL_MAX_PAGES) paginated = true;
        }
      } catch (error) {
        /* A 422 on page 1 means the route refused the shape, not that there
           are no filings. recent-trades answers the same question over a
           smaller population, and the payload says which one it read. */
        if (!filings.length) {
          fellBack = true;
          console.warn(`  political: the recent-trades ladder refused on its first ` +
            `rung (${error.message}) — falling back to one unwindowed page`);
          try {
            filings.push(...unwrapVendorRows(await uw("/api/congress/recent-trades",
              { limit: POLITICAL_PAGE_LIMIT })));
            pagesRead = 1;
          } catch (inner) {
            raws.filings = { __failed: inner && inner.message ? inner.message : String(inner) };
          }
        } else {
          console.warn(`  political: page ${pagesRead + 1} failed (${error.message}) — ` +
            `ranking on the ${filings.length} filing(s) already read`);
        }
      }
      if (!raws.filings) raws.filings = filings;

      /* Holders, for the names the boards already care about. */
      const holderNames = deepNames(published, POLITICAL_HOLDER_NAMES).map((d) => d.t);
      const holders = [];
      for (const ticker of holderNames) {
        try {
          holders.push({ ticker, raw: await uw(`/api/politician-portfolios/holders/${ticker}`, {}) });
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          if (!holders.length) {
            raws.holders = { __failed: message };
            /* WHAT THE VENDOR ACTUALLY SAID, not what the spec led us to
               expect. The first live run returned HTTP 422 on this route, not
               the 403 an entitlement refusal would give — and the note here
               asserted "enterprise-only" as though the status had confirmed
               it. The spec does say enterprise-only; 422 is Unprocessable
               Entity, which is what this vendor also returns for a parameter
               it dislikes. Those are different diagnoses with different fixes,
               and the log should carry the status rather than the inference. */
            console.log(`  political holders: ${message} — the spec marks this route ` +
              "enterprise-only, but the status above is what the vendor actually " +
              "returned; one refusal ends the walk rather than buying five more");
            break;
          }
          console.warn(`  political holders ${ticker}: ${message} — the names already read stand`);
        }
      }
      if (!raws.holders) raws.holders = holders;
    }

    const political = buildPolitical(raws);
    /* The quiet-but-rows tripwire, the same one the pulse leg carries: a feed
       that RETURNED rows and shaped to nothing dumps its first row's keys,
       which is the output that has solved every prior shape mystery in one
       run. */
    if (political.buyers.status === "quiet") {
      const first = unwrapVendorRows(raws.filings)[0];
      if (first && typeof first === "object") {
        console.log("  political: NOTE filings returned rows but none ranked — first-row keys: " +
          Object.keys(first).slice(0, 24).join(", "));
      }
    }
    await publish("political", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      readAt: new Date().toISOString(),
      window: { from, to: sessionDate || null, days: POLITICAL_WINDOW_DAYS },
      /* HOW THE POPULATION WAS OBTAINED, published rather than logged. A
         ranking is only as wide as what was read, and a reader who cannot see
         that one page was read instead of eight cannot tell a thin week from
         a broken pagination. `paginated: false` is the vendor ignoring the
         parameter; null is one page having been enough to answer. */
      source: {
        route: DRY_RUN ? "dry-run fixture"
          : fellBack ? "recent-trades (single page, unwindowed)"
          : "recent-trades (date ladder)",
        pages: pagesRead, pageLimit: POLITICAL_PAGE_LIMIT, paginated,
        windowed: !fellBack,
      },
      ...political,
    });
    const okCount = POLITICAL_FEEDS.filter((f) => political[f].status === "ok").length;
    console.log(`  political: ${okCount} of ${POLITICAL_FEEDS.length} feeds ok — ` +
      `${political.filings ?? 0} filing(s) over ${pagesRead === null ? "no" : pagesRead} ` +
      `page(s) from ${from}, ` +
      POLITICAL_FEEDS.map((f) => `${f}:${political[f].status}` +
        `${political[f].rows ? ":" + political[f].rows.length : ""}`).join(" "));
  } catch (error) {
    console.warn(`  political: ${error.message} — every key above published before this leg ran`);
  }

  /* 7h. WAVE-B PROBES — six per-stock endpoints scouted on one liquid name.

     PROBES, NOT SECTIONS: the next wave builds per-name panels on these
     paths, and this repository does not build renderers on documented
     shapes — it builds them on observed ones. One call each, first-row keys
     to this log, results into meta for the record. Retired when the
     sections land. Skipped on dry runs: a probe of a fixture would measure
     the fixture. */
  const probeResults = [];
  if (!DRY_RUN) {
    /* Five of the six original scouts answered with rows on 2026-08-31 and
       retired into the wave-2 card panels. The shorts scout answered ok with
       ZERO rows undated, so it stays — now dated, since several vendor feeds
       fill per-session — until it shows a shape or proves empty by design.
       The per-ticker flow-alerts scout confirmed its shape (a superset of
       the market-wide feed, plus type/created_at/price/strike) and waits on
       a section, not on more scouting. */
    const PROBE_PATHS = [
      ["/api/shorts/AAPL/volume-and-ratio", sessionDate ? { date: sessionDate } : {}],
    ];
    for (const [path, params] of PROBE_PATHS) {
      try {
        const raw = await uw(path, params);
        const rows = Array.isArray(raw) ? raw : (raw && raw.data) || [];
        const first = rows[0];
        const keys = first && typeof first === "object" ? Object.keys(first).slice(0, 24) : [];
        probeResults.push({ path, status: "ok", rows: rows.length, keys });
        console.log(`  probe ${path}: ok — ${rows.length} row(s)` +
          (keys.length ? `, first-row keys: ${keys.join(", ")}` : ", no readable rows"));
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        probeResults.push({ path, status: "failed", error: message });
        console.log(`  probe ${path}: ${message}`);
      }
    }
  }

  /* 8. CARDS — after the boards are safely committed, and best-effort.

     Ordering is deliberate. Cards are the decorative half; the ranking is the
     product. Building them first would mean a slow vendor day takes the board
     down with the cards, turning a survivable degradation into a total
     outage. Published first, cards can fail freely.

     The deadline is what makes "best effort" true rather than aspirational.
     GitHub kills the job at 45 minutes and the backoff has no notion of that,
     so a sustained 429 regime would otherwise walk straight into the timeout.
     At the 5s ceiling this loop abandons at 30 minutes and reports how many
     it managed. */
  /* THE SAME DEEP LIST THE CHAIN LEG USED. Built from the same function over
     the same rows, so a card is never built for a name whose chain was skipped
     — which would render four panels as "unavailable" for a reason that is
     about the call budget rather than about the data. */
  const onBoard = new Map();
  for (const d of deepNames(published)) onBoard.set(d.t, d.side);
  const byTicker = new Map(liquid.map((e) => [e.features.ticker, e]));
  const scoredByTicker = new Map(scored.map((r) => [r.ticker, r]));

  /* CONGRESS, ONCE FOR THE WHOLE MARKET RATHER THAN ONCE PER NAME.

     /api/congress/recent-trades takes an OPTIONAL ticker. Passing it bought
     one name's disclosures per call; omitting it returns the recent tape
     across every name, which is the same data for fifty cards at one call
     instead of fifty. That is 49 calls saved — and, just as usefully, it
     shrinks the per-card fan-out from three concurrent requests to two, and a
     three-request burst repeated fifty times is precisely the arrival shape
     that earns the 429s this run cannot afford.

     Disclosures are filings, not quotes: they are weeks stale by construction,
     so a market-wide read carries exactly the same information per name as a
     targeted one. Bucketed by ticker here; a name with no disclosures gets an
     empty array and the panel says so, which is what it did before. */
  const congressByTicker = new Map();
  /* WHETHER THE READ HAPPENED AT ALL, which the run knows and used to keep to
     itself. The market-wide fetch can throw, and the per-name fallback is
     gated on a deadline that can cut it short — either way `congressByTicker`
     simply has no entry, exactly as it has none for a name that appeared in
     no filing. The comment thirty lines below already names the consequence:
     "fifty cards each publishing a panel that says, in effect, 'no member of
     Congress has traded this name', which is a confident claim about the
     filings rather than a report of a failed read". This flag is what lets
     the card tell the two apart. */
  let congressRead = "not attempted";
  if (onBoard.size) {
    let marketWide = 0;
    try {
      /* LIMIT 100, NOT 500, AND THAT NUMBER IS A MEASUREMENT.

         The first wide-board run asked for 500 and the endpoint answered
         422 — every card that morning published an empty congress panel, a
         regression against the per-name call this replaced, and one that
         renders as a legitimately empty section rather than as an error. The
         per-name call passed `limit: 50` and had never been refused, so the
         limit is the parameter that changed and 500 is over whatever this
         route accepts. 100 is inside the range the desk already uses
         elsewhere on this key.

         The 422 also proves the shape of the failure is worth designing for:
         a market-wide leg that silently degrades fifty panels is worse than
         fifty calls, so it FALLS BACK below rather than shrugging. */
      const recent = DRY_RUN
        ? [...onBoard.keys()].flatMap((t) => fakeCongress(t))
        : await uw("/api/congress/recent-trades", { limit: 100 });
      marketWide = recent.length;
      /* The read happened. Every board name is now either in the map or
         genuinely absent from the filings, and both are knowable facts. */
      congressRead = "ok";
      for (const row of recent) {
        const t = row && (row.ticker || row.symbol);
        if (!t || !onBoard.has(t)) continue;
        if (!congressByTicker.has(t)) congressByTicker.set(t, []);
        congressByTicker.get(t).push(row);
      }
      console.log(
        `  congress: ${recent.length} disclosure(s) market-wide, ` +
        `${congressByTicker.size} of ${onBoard.size} board name(s) matched`);
    } catch (error) {
      congressRead = "failed";
      console.warn(`  congress: market-wide read failed — ${error.message}`);
    }

    /* THE FALLBACK, AND WHY IT IS WORTH FIFTY CALLS.

       One market-wide call replacing fifty is the right trade only while it
       WORKS. When it does not, the alternative is not "one fewer call" — it is
       fifty cards each publishing a panel that says, in effect, "no member of
       Congress has traded this name", which is a confident claim about the
       filings rather than a report of a failed read. This project does not
       publish a confident zero, and an empty panel is exactly that.

       So a failed market-wide read pays the per-name price rather than passing
       the loss to the reader. It runs LAST, after every payload that matters
       has landed, and it is bounded by the same deadline as the cards. */
    if (!marketWide && !DRY_RUN && Date.now() < stats.startedAt + DEADLINE_MS) {
      let recovered = 0;
      for (const ticker of onBoard.keys()) {
        if (Date.now() > stats.startedAt + DEADLINE_MS) break;
        const rows = await uw("/api/congress/recent-trades", { ticker, limit: 50 })
          .catch(() => []);
        if (rows.length) { congressByTicker.set(ticker, rows); recovered++; }
      }
      console.warn(
        `  congress: fell back to ${onBoard.size} per-name calls; ${recovered} name(s) ` +
        `carry disclosures. A panel built from a failed read is a confident zero, ` +
        `which costs more than the calls do.`);
    }
  }

  let cardsBuilt = 0, cardsFailed = 0, cardsSkipped = 0;
  const gammaProfiles = [];
  // The surface shape is reported once per run, not once per card.
  let surfaceReported = false;
  const deadline = stats.startedAt + DEADLINE_MS;
  for (const ticker of onBoard.keys()) {
    if (Date.now() > deadline) { cardsSkipped++; continue; }
    const e = byTicker.get(ticker);
    if (!e) { cardsSkipped++; continue; }
    try {
      /* THE HORIZON FOR THE GAMMA SURFACE, taken from the expiry rows already
         in hand. /spot-exposures/expiry-strike requires expirations[] — it
         will not infer a window — so the near end of this name's own term
         structure is what gets asked for. Dated expiries that have already
         passed are dropped: the vendor's expiry window runs ahead of and
         behind the session, and asking for last Friday returns a column of
         zeros that reads as a book with no gamma rather than as a book that
         already expired. */
      const surfaceExpiries = (e.raw.expiries || [])
        .map((r) => (r && r.expiry ? String(r.expiry).slice(0, 10) : null))
        .filter((d) => d && (!sessionDate || d >= sessionDate))
        .sort()
        .slice(0, SURFACE_EXPIRIES);

      const spotPx = num(e.row.close);
      /* NULL FOR A READ THAT DID NOT HAPPEN, [] FOR ONE THAT FOUND NOTHING.
         `|| []` collapsed both into the same empty array, and buildCongress
         then published "Unavailable. no disclosed transactions" for each —
         an unavailability status carrying a measured-emptiness reason, on
         every card, whichever had actually occurred. */
      const congress = congressByTicker.get(ticker)
        || (congressRead === "ok" ? [] : null);
      const [maxPain, surface, dpRaw, oiRaw, termRaw, rankRaw] = DRY_RUN
        ? [fakeMaxPain(ticker, spotPx), fakeSurface(ticker, spotPx, surfaceExpiries),
           fakeStockDarkpool(ticker, spotPx), fakeStockOiChange(ticker, spotPx),
           fakeTermStructure(ticker, spotPx), fakeIvRank(ticker, spotPx)]
        : await Promise.all([
          // The one per-name source the dating commit left undated. The
          // endpoint takes a `date`, and its window spans 120 days of expiries.
          uw(`/api/stock/${ticker}/max-pain`, sessionDate ? { date: sessionDate } : {}).catch(() => []),
          /* ONE call for the whole strike x expiry joint, not one per expiry.
             expirations[] is an array parameter, so the horizon is a choice
             rather than a call count. Banded on strike for the same reason the
             ladder is: a surface running from $5 to $900 on a $180 name is
             mostly empty cells. */
          surfaceExpiries.length
            ? uw(`/api/stock/${ticker}/spot-exposures/expiry-strike`, {
              "expirations[]": surfaceExpiries,
              ...(sessionDate ? { date: sessionDate } : {}),
              /* min_strike / max_strike are documented as INTEGERS, so on a $3
                 name a +-25% band rounds to 2..4 and throws away most of the
                 chain — the band is narrower than the tick. Below $20 the
                 bounds are dropped and `limit` does the work instead; the
                 surface builder windows on strike again anyway. */
              ...(spotPx >= 20
                ? { min_strike: Math.floor(spotPx * 0.75), max_strike: Math.ceil(spotPx * 1.25) }
                : {}),
              limit: 500,
            }).catch(() => [])
            : Promise.resolve([]),
          /* THE WAVE-2 PER-NAME FEEDS, four calls a card. Shapes were read
             off the 2026-08-31 live probes, not the spec. `null` on failure
             (an unavailable panel with a reason), `[]` only when the vendor
             actually answered nothing (a quiet one) — the same three-silences
             boundary buildCard states. The shared limiter serializes these
             like every other call, so the width here costs order, not rate. */
          uw(`/api/darkpool/${ticker}`, { limit: 60 }).catch(() => null),
          uw(`/api/stock/${ticker}/oi-change`, { limit: 30 }).catch(() => null),
          uw(`/api/stock/${ticker}/volatility/term-structure`, {}).catch(() => null),
          uw(`/api/stock/${ticker}/iv-rank`, { limit: 70 }).catch(() => null),
        ]);

      /* SAY WHAT CAME BACK WHEN NOTHING USABLE DID.
      
         The roll-off calendar shipped "unavailable" on twelve consecutive
         cards because three readers asked for call_gamma and the wire sends
         call_gex. A `.catch(() => [])` cannot tell an endpoint that 404s from
         one that returns healthy rows under names nobody read, and both look
         identical on the card: an empty panel. That mystery was solved in one
         run by printing a row.

         Bounded to the FIRST card of the run and to one row's keys, so a
         systematic failure is reported once rather than twelve times, and a
         working run costs one line. */
      if (!surfaceReported && !DRY_RUN) {
        surfaceReported = true;
        const rows = Array.isArray(surface) ? surface : (surface && surface.data) || [];
        if (!rows.length) {
          console.warn(
            `  NOTE: ${ticker} /spot-exposures/expiry-strike returned no rows for ` +
            `${surfaceExpiries.length} expiries (${surfaceExpiries.slice(0, 3).join(", ")}...). ` +
            "The gamma surface will be unavailable on every card until it does.");
        } else if (card0Unusable(rows[0])) {
          console.warn(
            `  NOTE: ${ticker} /spot-exposures/expiry-strike returned ${rows.length} rows ` +
            "carrying no readable gamma leg. First row: " +
            Object.entries(rows[0]).slice(0, 12)
              .map(([k, v]) => `${k}=${String(v).slice(0, 18)}`).join(" "));
        } else {
          console.log(`  surface: ${ticker} ${rows.length} rows over ${surfaceExpiries.length} expiries`);
        }
      }

      const card = buildCard({
        ticker,
        row: e.row,
        features: { ...e.features, ...(scoredByTicker.get(ticker) || {}) },
        strikes: e.raw.strikes,
        ticks: e.raw.ticks,
        // The expiry gamma was fetched for the score and thrown away at the
        // card boundary; the roll-off staircase costs nothing to add.
        expiries: e.raw.expiries,
        surface,
        chain: chainByTicker.get(ticker) || null,
        /* THIS NAME'S ROW OUT OF THE TRACK, with the calendar it is aligned
           to. `scores` is undefined — not null, not [] — when the track was
           read and this name is not in it, which buildCard tells apart from
           the track never having been assembled. */
        scoreHistory: scoreTrack
          ? {
            sessions: scoreTrack.sessions,
            scores: (scoreTrack.names.find((n) => n && n.t === ticker) || {}).s,
            deadBand: scoreTrack.deadBand,
          }
          : null,
        weights: first.weights || null,
        maxPain, congress, generatedAt, sessionDate,
        darkpool: dpRaw, oiDeltas: oiRaw, termStructure: termRaw, ivRank: rankRaw,
      });

      /* A CARD THAT WILL NOT FIT SHEDS ITS CHEAPEST PANELS IN A STATED
         ORDER, and only then fails.

         The four chain panels add ~6KB to a card that measures ~15KB, so this
         is headroom rather than a live constraint today — but the order is
         written down before it is needed rather than discovered on the
         morning a wide chain pushes one name over the ingest cap and takes
         its whole card down. What goes first is what a reader loses least:
         the tape (reconstructible from the chain on the desk), then the
         aggressor ladder, then the surface's far columns. The gamma profile,
         the levels and the score derivation are never shed — they are the
         card. Every drop is REPLACED with a stated reason, never a silent
         absence, so a reader sees "dropped to fit" rather than a panel that
         looks like the vendor had nothing. */
      const shed = [
        ["topContracts", "dropped to fit the payload cap — the day's most-traded contracts " +
          "are on the premium desk for this symbol"],
        ["aggressor", "dropped to fit the payload cap"],
        ["ivSurface", "dropped to fit the payload cap"],
        ["skewTerm", "dropped to fit the payload cap"],
        /* The wave-2 panels shed after the chain four: they are auxiliary
           context, but unlike the tape they are reconstructible nowhere
           else on the site, so they go later rather than first. */
        ["darkpool", "dropped to fit the payload cap"],
        ["oiDeltas", "dropped to fit the payload cap"],
        ["volContext", "dropped to fit the payload cap"],
      ];
      let body = JSON.stringify(card);
      const dropped = [];
      for (const [key, reason] of shed) {
        if (body.length <= 100 * 1024) break;
        if (!card.panels[key] || card.panels[key].status !== "ok") continue;
        card.panels[key] = { status: "unavailable", reason };
        dropped.push(key);
        body = JSON.stringify(card);
      }
      if (dropped.length) {
        console.warn(`  card ${ticker}: shed ${dropped.join(", ")} to fit the cap`);
      }
      // Fail loudly at the source rather than as an opaque 413 from the
      // Worker, and never let one fat card abort the rest of the loop.
      if (body.length > 100 * 1024) {
        throw new Error(`card is ${(body.length / 1024).toFixed(0)}KB after shedding ` +
          `${dropped.length} panel(s), still over the ingest cap`);
      }
      await publish("card:" + ticker, card);
      cardsBuilt++;
      /* THE AXIS QUESTION'S ONE MEASUREMENT, collected free from a card that
         was being built anyway. See describeGammaRange. */
      if (card.panels && card.panels.gamma && card.panels.gamma.status === "ok") {
        gammaProfiles.push(card.panels.gamma.bars);
      }
    } catch (error) {
      cardsFailed++;
      console.warn(`  card ${ticker}: ${error.message}`);
    }
  }
  console.log(
    `cards: ${cardsBuilt}/${onBoard.size} built` +
    (cardsFailed ? `, ${cardsFailed} failed` : "") +
    (cardsSkipped ? `, ${cardsSkipped} skipped past the ${DEADLINE_MS / 60000}min deadline` : ""),
  );
  /* ONE LINE, ONCE PER RUN, AND IT DECIDES A DESIGN ARGUMENT. The gamma
     ladder's own note tells the reader to treat bar length as rank rather
     than magnitude — a chart disclaiming its primary channel — and the
     alternative is only better if the real data is tame enough for a cap. The
     synthetic corpus cannot answer that and nearly gave the wrong answer.
     This is the number that can. */
  console.log("  " + (DRY_RUN ? "[dry-run] " : "") + describeGammaRange(gammaProfiles).line +
    (DRY_RUN
      ? " ON SYNTHETIC ROWS THIS SETTLES NOTHING: the fixture spans about 1.7" +
        " orders of magnitude, so it does not exhibit the problem symlog exists" +
        " to solve. Only a live run answers this."
      : ""));

  /* meta is a DIAGNOSTIC, not the product, so its failure must not fail the
     run. The first live publish proved why: both boards and all 34 cards
     landed, and then this last write tripped a Cloudflare rate challenge — so
     a job that had successfully published 36 rows exited non-zero and reported
     failure. A scheduled run is judged by its exit code, and that one lied. */
  try {
    await publish("meta", {
      generatedAt, sessionDate,
      universe: universe.length,
      enriched: enriched.length,
      liquid: liquid.length,
      cardsBuilt, cardsFailed, cardsSkipped,
      apiCalls: stats.calls,
      /* Wave-B scouting results ride the diagnostic key so a later session
         can read the observed shapes without re-fetching the job log. */
      probes: probeResults,
    });
  } catch (error) {
    console.warn(`  meta: ${error.message}`);
  }

  const elapsed = (Date.now() - stats.startedAt) / 1000;
  console.log(
    `\ndone in ${elapsed.toFixed(1)}s — ${stats.calls} API calls` +
    `, ${stats.retries} retries, ${stats.rateLimited} rate-limited` +
    `, achieved ${(stats.calls / Math.max(elapsed, 1)).toFixed(2)} req/s` +
    ` (final inter-call delay ${Math.round(delayMs)}ms` +
    /* THE LEARNED FLOOR IS THE FINDING, not the final delay. The delay is
       wherever the last decay left it; the floor is what this run concluded
       about the key's tier, and it is the number to carry into RATE if it
       settles at the same place across several mornings. */
    `, learned floor ${Math.round(delayFloorMs)}ms` +
    (delayFloorMs > RATE.minDelayMs ? "" : ", never raised") + ")",
  );
  console.log("Record the achieved rate: the vendor documents no limit, so this is how the real one gets discovered.");

  /* ---- WHERE THE WALL CLOCK WENT, which this file has been asking for ----

     The floorCeilingMs comment states the open question outright: raising the
     750ms ceiling "trades a certain per-call tax against an uncertain saving,
     and the run has never been instrumented to say which is larger. Do not
     raise it on intuition; measure the 429 wait first." This is that meter.

     HOW TO READ IT. `queued` is time spent waiting for a turn — it is the tax
     the floor charges, and it is the number a lower floor would reduce. `wire`
     is time the vendor took to answer; under the old serial limiter that time
     was ADDED to `queued` on every call, and under the permit queue it
     overlaps, so `wire` is roughly what this change bought back. `refused` is
     what the 429s actually cost in backoff — the other side of the trade. If
     `refused` is small against `queued`, the floor is too conservative and can
     come down; if it rivals `queued`, the ceiling is doing its job and must
     not move. Those are numbers, not intuitions, which was the whole ask. */
  const pct = (ms) => `${(ms / 1000).toFixed(1)}s (${(100 * ms / Math.max(elapsed * 1000, 1)).toFixed(0)}% of the run)`;
  console.log(
    `wall clock: queued ${pct(stats.permitWaitMs)}` +
    ` | wire ${pct(stats.networkMs)}` +
    ` | refused ${pct(stats.rateLimitWaitMs)}` +
    ` | peak in flight ${permits.stats().peakInFlight}` +
    (stats.calls
      ? ` | per call: ${Math.round(stats.permitWaitMs / stats.calls)}ms queued, ` +
        `${Math.round(stats.networkMs / stats.calls)}ms wire`
      : ""));
  if (stats.networkMs > 0 && permits.stats().peakInFlight <= 1) {
    console.log(
      "  peak in flight was 1, so no round trip ever overlapped another: the vendor answers " +
      "faster than the floor issues permits. That is the expected shape at a high floor and it " +
      "means the saving here is the serial delay+network stacking, not concurrency.");
  }
}

export {
  partitionSides, screenerTilt, eligible, atr14, daysToEarnings, medianDollarVolume,
  candlesAscending, selectExtremes, scoreBoard, publish, summarize,
  collapseShareClasses, returnCorrelation, packSpark, ret, easternNow,
  computeFeatures, DEAD_BAND, BOARD_SCHEMA_VERSION,
  boardRow, toRows, toWatchRows, datedKey, pruneKeys, pruneArchive,
  WATCH_ROWS, ARCHIVE_RETENTION_DAYS, ARCHIVE_PRUNE_LOOKBACK_DAYS,
  SECTOR_ETFS, TRIX_SPAN, TRIX_SERIES, TRIX_WARMUP, TRIX_MIN_CANDLES,
  TRIX_FULL_SCALE_BP, ema, trixSeriesBp, scaleTrix, sectorTrix,
  MOVER_ROWS, moverRow, buildMovers,
  describeTickFields, TICK_FIELDS_READ, CHAIN_RESERVE_MS, republishWithChain,
};

// Only run when invoked directly. Without this guard, importing the module —
// which the contract tests do, to exercise partitionSides — would fire the
// whole pipeline as an import side effect.
const invokedDirectly = process.argv[1]
  && (await import("node:url")).fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((error) => {
    console.error("pipeline failed:", error.message);
    process.exit(1);
  });
}
