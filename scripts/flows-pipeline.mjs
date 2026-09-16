#!/usr/bin/env node

import {
  num, quantile, winsorize, robustZ, neutralize,
  flowPurity, aggressorGamma, bookDisplacement, pathSignature,
  gammaDecayCalendar, positioningQuality, effectiveBreadth,
  crossFamilyRedundancy, qualityGate, percentileRank, realizedVol,
  isLiveColumn, pearson, SCORE_SCALE, horizonMove, HORIZON_SESSIONS,
  boundedScore, conviction, applyHysteresis, callGammaLeg, putGammaLeg,
} from "../shared/flows-features.js";
import {
  buildCard, SURFACE_EXPIRIES, indexMarketCross, CROSS_FEEDS,
} from "../shared/flows-card.js";
import { tradingCalendar, scoreSessions, icTable, RECORD_NOTES } from "../shared/flows-record.js";
import { makePermitQueue } from "../shared/flows-permits.js";
import { fitGarch } from "../shared/flows-garch.js";
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

function ingestURL() {
  return process.env.FLOWS_INGEST_URL || "https://anilkaya.org/api/flows/ingest";
}

const INGEST_UA = "anilkaya-flows-pipeline/1 (+https://github.com/anilkaya001/anilkaya.org)";

function ingestHeaders({ json = false } = {}) {
  const headers = {
    Authorization: "Bearer " + process.env.FLOWS_INGEST_TOKEN,
    "User-Agent": INGEST_UA,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

const UNIVERSE = {
  minPrice: 5,
  minMarketCap: 1e9,

  minDollarVolume: 5e7,
  minOptionVolume: 1000,
  minOpenInterest: 5000,
  excludeIssueTypes: ["ETF", "Index", "ADR"],

  boardSize: 50,

  enrichCount: 100,
};

export const RATE = {
  startDelayMs: 120, minDelayMs: 60, maxDelayMs: 5000, maxRetries: 4,
  maxRetryAfterMs: 30_000,

  floorCeilingMs: 750,
};

export const CALL_BUDGET = 1250;

export const EARNINGS_GATE_DAYS = 12;

export const SCREENER_PAGE_ROWS = 50;

export const DEEP_NAMES = 50;

export const MARKET_CROSS_LIMIT = 100;

export const DEEP_RULE =
  "The " + 50 + " names furthest from neutral across both boards carry a chain " +
  "and a detail card. Every other row is scored and ranked from the same five " +
  "sources, and has no card: the card costs vendor calls the run cannot spend " +
  "on a hundred names.";

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

export function rateFloorSurvivesBudget(
  { floorCeilingMs, callBudget, deadlineMs, reserveMs } = {},
) {
  return floorCeilingMs * callBudget < deadlineMs - reserveMs;
}

export function raiseRateFloor(floor, { minStepMs = 150, ceilingMs = RATE.floorCeilingMs } = {}) {
  return Math.min(Math.max(floor * 1.5, minStepMs), ceilingMs);
}

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

export const DEADLINE_MS = 36 * 60 * 1000;

let tickFieldsReported = false;
let greekFieldsReported = false;

const TICK_FIELDS_READ = Object.freeze([
  "tape_time", "net_delta", "net_call_premium", "net_put_premium",
]);

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

export function describeChainProbe(ticker, expiry, rows, { pageSize = CHAIN_PAGE_SIZE, maxList = 6 } = {}) {
  const list = Array.isArray(rows) ? rows : [];

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

const CHAIN_RESERVE_MS = 6 * 60 * 1000;

const PUBLISH_SPACING_MS = 400;

const stats = {
  calls: 0, retries: 0, rateLimited: 0, failures: 0, startedAt: Date.now(),

  permitWaitMs: 0, networkMs: 0, rateLimitWaitMs: 0, rateLimitQueueMs: 0,
};
let delayMs = RATE.startDelayMs;

let delayFloorMs = RATE.minDelayMs;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const permits = makePermitQueue({
  delayMs: () => delayMs,
  now: () => Date.now(),
  sleep,
  maxInFlight: 6,
});

const ingestWrites = makePermitQueue({
  delayMs: () => PUBLISH_SPACING_MS,
  now: () => Date.now(),
  sleep,

  maxInFlight: 2,
});

const POOL_MAX_WIDTH = 4;

const POOL_EVIDENCE_MIN = 24;

const POOL_REFUSAL_HALT = 0.10;
const POOL_REFUSAL_EASE = 0.05;

const meterRead = (meter, key) => {
  if (!meter) return null;
  const v = meter[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function poolWidth(max = POOL_MAX_WIDTH, meter = stats) {
  const seen = meterRead(meter, "calls");
  const refused = meterRead(meter, "rateLimited");

  if (seen === null) {
    return { width: 1, rate: null, seen: null,
      why: "no call counter to read, so this run has measured no refusal rate" };
  }
  if (seen < POOL_EVIDENCE_MIN) {
    return { width: 1, rate: null, seen, why: `only ${seen} call(s) so far, which is not evidence` };
  }

  if (refused === null) {
    return { width: 1, rate: null, seen,
      why: `${seen} call(s) counted and no refusal counter beside them` };
  }
  const rate = refused / seen;
  if (rate > POOL_REFUSAL_HALT) {
    return { width: 1, rate, seen, why: `${(rate * 100).toFixed(1)}% of calls refused so far` };
  }
  if (rate > POOL_REFUSAL_EASE) {
    return { width: Math.min(2, max), rate, seen, why: `${(rate * 100).toFixed(1)}% refused` };
  }
  return { width: max, rate, seen, why: `${(rate * 100).toFixed(1)}% refused` };
}

async function runPooled(items, work, { width = 1, stopEarly = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length).fill(undefined);

  const attempted = new Array(list.length).fill(false);
  let next = 0;
  let stopped = false;

  const worker = async () => {
    for (;;) {
      if (stopped) return;
      if (stopEarly && stopEarly()) { stopped = true; return; }
      const i = next++;
      if (i >= list.length) return;
      attempted[i] = true;
      results[i] = await work(list[i], i);
    }
  };

  const lanes = Math.max(1, Math.min(Math.floor(width) || 1, list.length || 1));
  await Promise.all(Array.from({ length: lanes }, worker));
  return { results, attempted, stopped, done: attempted.filter(Boolean).length };
}

export function foldCardOutcomes(tickers, run) {
  const list = Array.isArray(tickers) ? tickers : [];
  const attempted = (run && run.attempted) || [];
  const results = (run && run.results) || [];
  const out = {
    built: 0, failed: 0, unenriched: 0, deadlineSkipped: 0, skipped: 0, gammaProfiles: [],

    garchConverged: 0, garchUnconverged: 0, garchUnavailable: 0,
    garchNu: [], garchPersistence: [],
  };
  list.forEach((ticker, i) => {
    if (!attempted[i]) { out.deadlineSkipped++; out.skipped++; return; }
    const outcome = results[i];

    if (!outcome || outcome.status === "failed") { out.failed++; return; }
    if (outcome.status === "unenriched") { out.unenriched++; out.skipped++; return; }
    out.built++;

    if (outcome.gamma) out.gammaProfiles.push(outcome.gamma);

    const g = outcome.garch;
    if (g && typeof g === "object") {
      if (g.status !== "ok") out.garchUnavailable++;
      else if (g.converged === false) out.garchUnconverged++;
      else {
        out.garchConverged++;
        if (Number.isFinite(g.nu)) out.garchNu.push(g.nu);
        if (Number.isFinite(g.persistence)) out.garchPersistence.push(g.persistence);
      }
    }
  });
  return out;
}

function describeFloorVerdict(meter) {
  const calls = meterRead(meter, "calls");

  if (!calls) return null;
  const refused = meterRead(meter, "rateLimited");

  if (refused === null) return null;
  const queuedMs = meterRead(meter, "permitWaitMs");
  const backoffMs = meterRead(meter, "rateLimitWaitMs");
  const rate = refused / calls;

  const timed = queuedMs !== null && backoffMs !== null;
  const share = timed && queuedMs > 0 ? backoffMs / queuedMs : null;

  const head =
    `floor verdict: ${refused} of ${calls} calls refused (${(rate * 100).toFixed(1)}%), ` +
    (!timed
      ? "and this run carries no wait meters, so what the floor charged and what the " +
        "refusals cost were not measured — read the rate alone. "
      : `backoff ${(backoffMs / 1000).toFixed(1)}s against ${(queuedMs / 1000).toFixed(1)}s of queueing` +
        (share === null
          ? " — nothing queued, so the floor was never the binding cost this run. "
          : ` (${(share * 100).toFixed(0)}% as large). `));
  if (rate > POOL_REFUSAL_HALT) {
    return head +
      "THE CEILING IS DOING ITS JOB and must not move up: the controller asked to go slower " +
      `than RATE.floorCeilingMs=${RATE.floorCeilingMs}ms and was refused anyway. Cut calls ` +
      "before touching the rate, and expect every pooled leg to have run one wide.";
  }
  if (rate > POOL_REFUSAL_EASE) {
    return head +
      "The floor is roughly where the vendor wants it. Neither raising nor lowering the " +
      "ceiling is supported by this run.";
  }
  return head +
    `The floor is CONSERVATIVE — refusals are under ${(POOL_REFUSAL_EASE * 100).toFixed(0)}% ` +
    "and the queueing above is what this run actually paid. RATE.floorCeilingMs can come " +
    "down one step at a time, re-reading this line each morning.";
}

async function uw(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;

    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined && item !== null && item !== "") url.searchParams.append(k, String(item));
      }
      continue;
    }
    url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; attempt <= RATE.maxRetries; attempt++) {

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

      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, RATE.maxRetryAfterMs)
        : Math.min(delayMs * 4, RATE.maxDelayMs);

      ({ delayMs, floorMs: delayFloorMs } = stepRateController(
        { delayMs, floorMs: delayFloorMs }, "limited"));

      stats.rateLimitQueueMs += permits.defer(wait);
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

    ({ delayMs, floorMs: delayFloorMs } = stepRateController(
      { delayMs, floorMs: delayFloorMs }, "ok"));
    const body = await response.json();
    return Array.isArray(body) ? body : (body && body.data) || [];
  }
  throw new Error(`${path} -> exhausted retries`);
}

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

function screenerTilt(row) {
  const bull = num(row.bullish_premium);
  const bear = num(row.bearish_premium);
  const netCall = num(row.net_call_premium);
  const netPut = num(row.net_put_premium);

  const gross = Math.abs(bull) + Math.abs(bear);
  const premiumTilt = gross > 0 ? (bull - bear) / gross : null;

  const grossPremium = Math.abs(num(row.call_premium)) + Math.abs(num(row.put_premium));
  const netTilt = grossPremium > 0 ? (netCall - netPut) / grossPremium : null;

  const callSurprise = num(row.avg_30_day_call_volume) > 0
    ? num(row.call_volume) / num(row.avg_30_day_call_volume) : null;
  const putSurprise = num(row.avg_30_day_put_volume) > 0
    ? num(row.put_volume) / num(row.avg_30_day_put_volume) : null;

  const callOiChange = num(row.call_open_interest) - num(row.prev_call_oi);
  const putOiChange = num(row.put_open_interest) - num(row.prev_put_oi);
  const oiBase = num(row.total_open_interest) ||
    (num(row.call_open_interest) + num(row.put_open_interest));

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

    iv30: Number.isFinite(iv30) ? iv30 : null,
    ivMomentum: Number.isFinite(iv30) ? iv30 - num(row.iv30d_1w, NaN) : null,

    iv30d1d: num(row.iv30d_1d, NaN),
    iv30d1m: num(row.iv30d_1m, NaN),
    ivRank: ivRankFraction(row.iv_rank),
    impliedMovePerc: num(row.implied_move_perc, NaN),
    impliedMove: num(row.implied_move, NaN),
    atmVol: num(row.volatility, NaN),
    relVolume: num(row.relative_volume, NaN),
    putCallRatio: num(row.put_call_ratio, NaN),

    callSurprise,
    putSurprise,
    week52High: num(row.week_52_high, NaN),
    week52Low: num(row.week_52_low, NaN),
  };
}

function ivRankFraction(raw) {
  const v = num(raw, NaN);
  if (!Number.isFinite(v) || v < 0) return NaN;
  return v > 1 ? v / 100 : v;
}

function daysToEarnings(row, origin) {
  if (!row.next_earnings_date) return null;
  const t = Date.parse(row.next_earnings_date + "T00:00:00Z");
  const from = Date.parse(String(origin || "") + "T00:00:00Z");
  if (!Number.isFinite(t) || !Number.isFinite(from)) return null;
  return Math.round((t - from) / 86400000);
}

async function verifyDating(sessionDate) {
  if (!sessionDate || DRY_RUN) return { date: !!sessionDate, endDate: !!sessionDate };

  const usable = (rows) => (rows || []).some(
    (r) => r && r.expiry && (num(callGammaLeg(r)) !== 0 || num(putGammaLeg(r)) !== 0));

  const PROBE = "AAPL";

  const [dated, undated, capped] = await Promise.all([
    uw(`/api/stock/${PROBE}/greek-exposure/expiry`, { date: sessionDate }).catch(() => []),
    uw(`/api/stock/${PROBE}/greek-exposure/expiry`).catch(() => []),
    uw(`/api/stock/${PROBE}/ohlc/1d`, { timeframe: "1M", end_date: sessionDate }).catch(() => []),
  ]);

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

  const dated = sessionDate && dating.date ? { date: sessionDate } : {};

  const [greekFlow, ticks, strikes, expiries, ohlc] = await Promise.all([
    uw(`/api/stock/${ticker}/greek-flow`, dated).catch(() => []),
    uw(`/api/stock/${ticker}/net-prem-ticks`, dated).catch(() => []),
    uw(`/api/stock/${ticker}/spot-exposures/strike`, { ...band, ...dated, limit: 500 }).catch(() => []),
    uw(`/api/stock/${ticker}/greek-exposure/expiry`, dated).catch(() => []),

    uw(`/api/stock/${ticker}/ohlc/1d`, {
      timeframe: "1Y",
      ...(sessionDate && dating.endDate ? { end_date: sessionDate } : {}),
    }).catch(() => []),
  ]);

  if (!tickFieldsReported && ticks.length) {
    tickFieldsReported = true;
    for (const line of describeTickFields(ticker, ticks[0])) console.log(line);
  }

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

  return {
    features: computeFeatures({ ticker, spot, greekFlow, ticks, strikes, expiries, ohlc, sessionDate }),
    raw: { greekFlow, ticks, strikes, expiries, ohlc },
  };
}

async function resolveSessionDate() {
  const candles = await uw("/api/stock/SPY/ohlc/1d", { timeframe: "1M" }).catch(() => []);
  const dates = candlesAscending(candles)
    .map((c) => String(c.start_time || c.end_time || c.date || "").slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!dates.length) return null;

  const now = easternNow();
  const complete = dates.filter((d) => d < now.date || (d === now.date && now.minutes >= 16 * 60));
  if (complete.length) return complete[complete.length - 1];

  return dates.length > 1 ? dates[dates.length - 2] : null;
}

function easternNow(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,

    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

function medianDollarVolume(candles, { window = 60 } = {}) {

  const values = candlesAscending(candles).slice(-window)
    .map((c) => num(c.close) * num(c.volume))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (!values.length) return 0;
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function candlesAscending(candles) {
  const rows = (candles || []).map((c) => ({
    c,
    t: Date.parse(c.start_time || c.end_time || c.date || ""),
    day: String((c && (c.start_time || c.end_time || c.date)) || "").slice(0, 10),
  }));

  if (!rows.some((r) => Number.isFinite(r.t))) return candles || [];

  const bySession = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r.t)) continue;
    const key = r.day.length === 10 ? r.day : String(r.t);
    const held = bySession.get(key);
    if (!held || num(r.c.volume, -1) >= num(held.c.volume, -1)) bySession.set(key, r);
  }
  return [...bySession.values()]
    .sort((a, b) => a.t - b.t)
    .map((r) => r.c);
}

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

  const dollarVolume = medianDollarVolume(ohlc);

  const closes = candlesAscending(ohlc).map((c) => num(c.close));

  const rv30 = realizedVol(closes, { window: 21 });
  const iv30 = tilt && Number.isFinite(tilt.iv30) ? tilt.iv30 : null;

  const flipDist = gamma.flip && spot > 0 ? (gamma.flip - spot) / spot : null;

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

    purity: purity.purity,
    dirDelta: purity.dirDelta,
    dirShare: purity.dirShare,
    otmShare: quality.otmShare,
    vegaTilt: quality.vegaTilt,
    hasView: quality.hasDirectionalView,

    netGamma: gamma.netGamma,
    gammaPeak: gamma.peak,
    gammaFlip: gamma.flip,
    flipSide: gamma.flipSide,
    flipCount: gamma.crossings.length,

    flipSeparation: gamma.flipSeparation,
    spotGammaShare: gamma.spotGammaShare,
    bandMin: gamma.bandMin,
    bandMax: gamma.bandMax,
    flipDist,
    flipDistAtr: gamma.flip && atr > 0 ? (gamma.flip - spot) / atr : null,

    gRegime: gamma.spotGammaShare === null
      ? (gamma.netGamma >= 0 ? "long" : "short")
      : (gamma.spotGammaShare >= 0 ? "long" : "short"),
    displacement: displacement.displacement,
    displacementWeight: displacement.weight,

    persistence: path.persistence,
    concentration: path.concentration,
    centroid: path.centroid,
    pathNet: path.net,
    pathBars: path.bars,

    gammaHalfLife: calendar.halfLifeExpiry,
    gammaHalfLifeDays: calendar.halfLifeDays,
    gammaMeanLifeDays: calendar.meanLifeDays,
    gammaFrontLoad: calendar.frontLoad,

    iv30,
    rv30,

    vrp: iv30 !== null && rv30 !== null ? iv30 - rv30 : null,
    ivMomentum: tilt && tilt.ivMomentum !== null ? tilt.ivMomentum : null,
    ivRank: tilt && Number.isFinite(tilt.ivRank) ? tilt.ivRank : null,

    atmVol: tilt && Number.isFinite(tilt.atmVol) ? tilt.atmVol : null,
    ivStrip: tilt ? [
      { h: "−1m", v: Number.isFinite(tilt.iv30d1m) ? tilt.iv30d1m : null },
      { h: "−1w", v: Number.isFinite(tilt.iv30) && Number.isFinite(tilt.ivMomentum)
        ? Number((tilt.iv30 - tilt.ivMomentum).toFixed(4)) : null },
      { h: "−1d", v: Number.isFinite(tilt.iv30d1d) ? tilt.iv30d1d : null },
      { h: "now", v: Number.isFinite(tilt.iv30) ? tilt.iv30 : null },
    ] : null,
    impliedMovePerc: tilt && Number.isFinite(tilt.impliedMovePerc) ? tilt.impliedMovePerc : null,

    closes: closes.slice(-42),

    closeDates: candlesAscending(ohlc).slice(-42).map(candleDate),

    candles: candlesAscending(ohlc).slice(-252).map((c) => [
      candleDate(c), num(c.open, null), num(c.high, null), num(c.low, null),
      num(c.close, null), num(c.volume, null),
    ]),

    garch: fitGarch(closes, candlesAscending(ohlc).map(candleDate)),

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

const FAMILIES = {
  F: "flow",
  P: "positioning",
  D: "path",
  V: "vol",
  O: "quality",
};

const SIGNED = ["F", "P", "D"];

const DEAD_BAND = 1;

const BOARD_SCHEMA_VERSION = 2;

function scoreBoard(features, tilts, sectors, caps) {
  const n = features.length;
  if (!n) return [];

  const raw = (fn) => features.map((f, i) => {
    const v = fn(f, tilts[i], i);
    return v === null || v === undefined || !Number.isFinite(v) ? NaN : v;
  });
  const z = (fn) => robustZ(winsorize(raw(fn), 0.02));

  const fDelta = z((f) => f.dirShare);
  const fTilt = z((f, t) => t.premiumTilt);
  const fNet = z((f, t) => t.netTilt);
  const fOi = z((f, t) => t.oiTilt);
  const fVol = z((f, t) => t.volTilt);

  const pDisp = z((f) => (f.displacementWeight > 0 ? f.displacement : null));

  const dPath = z((f) =>
    (f.pathBars > 0 ? Math.sign(f.pathNet) * f.persistence * (1 - f.concentration) : null));

  const familyCols = {
    F: [fDelta, fTilt, fNet, fOi, fVol],
    P: [pDisp],
    D: [dPath],
  };

  const familyScores = {};
  for (const [key, cols] of Object.entries(familyCols)) {
    const live = cols.filter(isLiveColumn);
    familyScores[key] = live.length
      ? features.map((_, i) => live.reduce((a, c) => a + c[i], 0) / live.length)
      : null;
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

  const gateAxes = [
    raw((f) => f.purity),
    raw((f) => (f.otmShare === null ? null : -f.otmShare)),
    raw((f) => (f.vegaTilt === null ? null : -f.vegaTilt)),
    raw((f) => (f.gammaFrontLoad === null ? null : -f.gammaFrontLoad)),

    raw((f) => (f.spotGammaShare === null ? null : -f.spotGammaShare)),
  ];
  const gate = qualityGate(gateAxes);

  const composite = blended.map((b, i) => b * gate[i]);

  const logCap = caps.map((c) => (c > 0 ? Math.log(c) : 0));
  const residual = neutralize(composite, { numeric: [logCap], groups: sectors });

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

      convCoverage: conv.coverage,
      convPersistence: conv.persistence,
      dispersion,
      weights,
    };
  });
}

function partitionSides(scored, { deadBand = DEAD_BAND } = {}) {

  const sorted = scored.slice().sort((a, b) => b.residual - a.residual);

  const neutralRows = sorted.filter((r) => Math.abs(r.score) < deadBand);
  return {
    long: sorted.filter((r) => r.score >= deadBand),
    short: sorted.filter((r) => r.score <= -deadBand).reverse(),
    neutralRows,
    neutral: neutralRows.length,
    deadBand,
  };
}

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

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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

function week52Position(closes) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0).slice(-252);
  if (xs.length < 20) return null;
  let lo = Infinity, hi = -Infinity;
  for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi > lo ? (xs[xs.length - 1] - lo) / (hi - lo) : 0.5;
}

function ret(closes, n) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0);
  if (xs.length < n + 1) return null;
  const a = xs[xs.length - 1 - n];
  return a > 0 ? xs[xs.length - 1] / a - 1 : null;
}

const nameCount = (n) => `${n} name${n === 1 ? "" : "s"}`;

export function readBoardMemory(read, runSessionDate) {
  const body = read && read.payload;

  const stamp = (v) => (typeof v === "string" && ARCHIVE_DATE_RE.test(v) ? v : null);
  const prior = stamp(body && body.sessionDate);
  const run = stamp(runSessionDate);

  const rows = body && Array.isArray(body.rows) ? body.rows.filter((r) => r && r.t) : null;
  const named = rows ? rows.length : null;
  const answer = (status, keep, note) => ({
    status,
    rows: keep ? rows : [],
    incumbents: keep ? rows.length : 0,
    named,
    sessionDate: prior,
    note,
  });

  if (!rows) {

    return answer("unavailable", false, read && read.absent
      ? "No board has ever been published under this key, so there is no earlier session to " +
        "compare against and this board is a cold start: no row claims to be new, no rank move " +
        "is drawn, and no name is held on incumbency. The comparison begins on the next run " +
        "that finds a board here."
      : "The published board could not be read on this run" +
        (read && read.status ? ` (the store answered ${read.status})` : " (the read did not complete)") +
        ", so this board is a cold start: no row claims to be new, no rank move is drawn, and " +
        "no name is held on incumbency. Yesterday's board may well exist — this run could not " +
        "see it, which is a fact about the store and not about the session.");
  }
  if (!rows.length) {
    return answer("quiet", false,
      "The published board was read and named no rows, so there was no membership to remember " +
      "and this board is a cold start: no row claims to be new and no name is held on " +
      "incumbency. A board that published nothing is a session that ranked nothing, which is " +
      "not the same as a board that could not be read.");
  }
  if (prior === null || run === null) {

    const which = prior === null && run === null
      ? "Neither the published board nor this run carries a session date"
      : prior === null
        ? "The published board carries no session date"
        : "This run could not resolve a session date";
    return answer("undated", true,
      `${which}, so this run could not check whether the board it read was its own output from ` +
      `an earlier run today. Its ${nameCount(rows.length)} were used as the memory anyway: ` +
      "discarding a real membership over a missing stamp would report a cold start on a session " +
      "that had one. Read the marks below as unverified rather than as a comparison against a " +
      "named session.");
  }
  if (prior === run) {
    return answer("same-session", false,
      `The published board this run read is stamped ${prior}, the same session this run is ` +
      `publishing, so it is this run's own output rather than a prior session. Its ` +
      `${nameCount(rows.length)} were discarded and this board is a cold start: hysteresis ` +
      "holds a name against YESTERDAY's board, and a second run against one session has no " +
      "yesterday to hold against. Every row here was ranked on this session alone. Keeping the " +
      "memory would have held the whole board in place and reported that as stability.");
  }
  if (prior > run) {

    return answer("ahead", false,
      `The published board this run read is stamped ${prior}, a LATER session than the ${run} ` +
      `this run is publishing, so it cannot be this run's yesterday. Its ${nameCount(rows.length)} ` +
      "were discarded and this board is a cold start. A run publishing an earlier session than " +
      "the board already live usually means a re-run against a stale tape, and that is worth " +
      "understanding before the marks here are read as a comparison.");
  }
  return answer("ok", true,
    `The published board this run read is stamped ${prior}, an earlier session than the ${run} ` +
    `this run is publishing, so its ${nameCount(rows.length)} are the incumbents today's ` +
    "ranking was held against.");
}

async function fetchStoredPayload(key) {
  return (await readStored(key)).payload;
}

async function readStored(key) {
  if (DRY_RUN) return { payload: null, absent: true, status: 0 };
  try {
    const response = await fetch(
      ingestURL() + "?key=" + encodeURIComponent(key),
      {
        redirect: "error",
        headers: ingestHeaders(),
      },
    );
    if (!response.ok) return { payload: null, failed: true, status: response.status };
    const body = await response.json();

    if (body && body.status === "pending") {
      return { payload: null, absent: true, status: response.status };
    }
    return { payload: body, status: response.status };
  } catch (error) {
    return { payload: null, failed: true, status: 0, detail: error.message };
  }
}

const RECORD_HORIZONS = [1, 5, 10, 21];
const RECORD_IC_MIN_N = 20;
const RECORD_MAX_SESSIONS = 30;

const candleDate = (c) => {
  const d = String((c && (c.start_time || c.end_time || c.date)) || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

const ARCHIVE_READ_PACE_MS = 40;
const ARCHIVE_READ_RETRY_MS = 600;

const ARCHIVE_READ_GIVE_UP = 8;

async function collectDatedBoards(sessionDate, payloads, enriched, inBandToday = null) {
  const boards = [];
  if (DRY_RUN) {
    const calendar = tradingCalendar(
      enriched.map((e) => (e.raw.ohlc || []).map(candleDate)));
    const days = calendar.filter((day) => day < sessionDate).slice(-22);

    const hash = (s) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0) / 4294967296;
    };
    const last = days.length - 1;

    const publishedBand = num(payloads.long && payloads.long.deadBand)
      ?? num(payloads.short && payloads.short.deadBand);

    const band = publishedBand ?? 1;
    if (publishedBand === null) {
      console.log("  NOTE: neither board published a dead band, so the synthetic history's " +
        "crossings were computed against a fallback of 1 rather than against the session's " +
        "own threshold");
    }

    const historic = (row, i, inBandToday) => {
      const s = num(row && row.s);
      if (s === null) return null;
      const t = String(row.t || "");
      const bucket = hash(t);
      const age = last - i;

      const absent = hash(t + "|gap");
      if (absent < 0.06 && age === 0) return null;
      if (absent >= 0.06 && absent < 0.10 && age <= 1) return null;
      if (absent >= 0.10 && absent < 0.20 && age >= 3 && age <= 6) return null;

      if (age === 0) {

        if (inBandToday) {

          return s >= 0 ? band + 6 : -(band + 6);
        }
        if (bucket < 0.10) return s > 0 ? 0 : 0;
        if (bucket < 0.16) return s > 0 ? -(band + 9) : band + 9;
      }

      const ramp = 0.55 + 0.45 * (1 - age / Math.max(1, days.length));
      const wobble = Math.round((bucket - 0.5) * 18 * Math.sin((age + 1) * (0.3 + bucket)));
      const v = Math.round(s * ramp) + wobble;
      return Math.max(-100, Math.min(100, v));
    };

    const shaped = (rows, inBandToday) => (rows || []).map((row) => {
      const s = num(row && row.s);
      return { row, s, inBandToday };
    }).filter((x) => x.s !== null);

    const pools = [
      ...shaped(payloads.long && payloads.long.rows, false),
      ...shaped(payloads.short && payloads.short.rows, false),

      ...shaped(inBandToday, true),
    ];

    days.forEach((d, i) => {
      const rows = [];
      for (const { row, inBandToday } of pools) {
        const v = historic(row, i, inBandToday);
        if (v === null) continue;

        rows.push({ ...row, s: v });
      }

      boards.push({ d, side: "long", rows });
    });

    const scoreDays = days.slice(-4).map((d, k) => ({
      d,
      source: "scores",
      rows: pools.map(({ row, inBandToday }) => {
        const v = historic(row, days.length - 4 + k, inBandToday);
        if (v === null) return null;

        const q = Math.round(SCORE_SCALE * Math.atanh(Math.max(-0.999, Math.min(0.999, v / 100))) * 1e4);
        return { t: row.t, s: v, q };
      }).filter(Boolean),
    }));

    return { boards, scoreDays, probed: boards.length + scoreDays.length };
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
    if (dow === 0 || dow === 6) continue;
    const d = t.toISOString().slice(0, 10);
    for (const what of ["scores", "long", "short"]) {
      probed++;

      if (probed > 1) await sleep(ARCHIVE_READ_PACE_MS);

      const key = what === "scores" ? `scores:${d}` : `board:${what}:${d}`;
      let read = await readStored(key);

      if (read.failed) {
        await sleep(ARCHIVE_READ_RETRY_MS);
        const again = await readStored(key);
        if (!again.failed) recovered++;
        read = again;
      }

      if (read.failed) {
        failed++;
        statuses.add(read.status || (read.detail ? "network" : 0));

        if (failed >= ARCHIVE_READ_GIVE_UP && !boards.length) { abandoned = true; break outer; }
        continue;
      }

      if (read.absent) { absent++; continue; }

      const stored = read.payload;
      if (stored && Array.isArray(stored.rows) && stored.rows.length) {
        if (what === "scores") scoreDays.push({ d, rows: stored.rows, source: "scores" });
        else boards.push({ d, side: what, rows: stored.rows });
      } else {

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

  return { boards, scoreDays, probed, absent, failed, recovered, statuses: [...statuses], abandoned };
}

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

const hz = (v) => (v === null ? null : Number(v.toFixed(4)));

function boardRow(r, s, rank, memory = null, origin = null) {
  const close = num(s.close);
  const prev = num(s.prev_close);

  const edte = daysToEarnings(s, origin);
  return {
    t: r.ticker,
    r: rank,
    s: r.score,
    cnv: r.conviction,

    agr: r.agree === null || r.agree === undefined ? null : r.agree,
    bth: r.breadth === null || r.breadth === undefined ? null : r.breadth,
    px: close || r.spot,
    chg: prev > 0 ? (close - prev) / prev : null,
    purity: r.purity === null ? null : Number(r.purity.toFixed(3)),
    gRegime: r.gRegime,
    gFlipDist: r.flipDist === null ? null : Number(r.flipDist.toFixed(4)),

    sector: s.sector || null,

    nm: typeof s.full_name === "string" && s.full_name.trim() ? s.full_name.trim() : null,
    netPrem: netPremiumOf(s),
    fam: r.fam,

    spark: packSpark(r.closes),

    pr: [r.r5, r.r21, r.r42].map((x) => (x === null ? null : Math.round(x * 10000))),
    w52: r.week52Pos === null ? null : Number(r.week52Pos.toFixed(3)),
    vrp: r.vrp === null ? null : Number(r.vrp.toFixed(4)),
    ivr: r.ivRank === null ? null : Number(r.ivRank.toFixed(3)),

    im: r.impliedMovePerc === null ? null : Number(r.impliedMovePerc.toFixed(4)),
    hm: hz(horizonMove(r.iv30)),
    hr: hz(horizonMove(r.rv30)),

    nw: memory ? memory.nw : null,
    hy: memory ? memory.hy : null,
    r0: memory ? memory.r0 : null,

    dr: memory && memory.r0 !== null ? memory.r0 - rank : null,

    ed: s.next_earnings_date || null,
    edte,
  };
}

async function archiveDatedBoards(payloads, sessionDate, publishFn) {
  const lines = [];
  for (const side of ["long", "short"]) {
    const key = datedKey(side, sessionDate);
    if (!key) {
      lines.push(`  archive: session date is ${sessionDate === null ? "unresolved" : `"${sessionDate}"`}` +
                 " — refusing to write a dated key no prune could ever name");

      break;
    }
    try {
      await publishFn(key, payloads[side]);
    } catch (error) {
      if (error && error.status === 409) {
        lines.push(
          `  archive ${key}: ALREADY WRITTEN by an earlier run today, and this run's board ` +
          `differs from it — the archive is immutable and KEEPS THE FIRST, which is the ` +
          `board the reader saw and the one the record will be scored against. This run's ` +
          `board is live on board:${side} regardless. Two runs on one session disagreeing ` +
          `is worth understanding: usually a second run against a later tape, but it is ` +
          `also what a scoring change mid-session would look like from here.`);
      } else {
        lines.push(`  archive ${key}: ${error.message}`);
      }
    }
  }
  return lines;
}

async function republishWithChain(payloads, chainByTicker, sessionDate, publishFn) {
  const lines = [];
  for (const side of ["long", "short"]) {
    const payload = payloads[side];
    if (!payload || !Array.isArray(payload.rows)) continue;
    let merged = 0;
    for (const row of payload.rows) {
      const c = chainByTicker.get(row.t);
      if (!c) continue;

      row.skew = c.scalars.skew;
      row.term = c.scalars.term;
      row.atmIv = c.scalars.atmIv;

      row.skewDays = c.scalars.skewDays;
      merged++;
    }
    if (!merged) continue;
    try {

      const key = datedKey(side, sessionDate);

      if (!key) {
        lines.push(`  re-publish board:${side}: SKIPPED — the session date ` +
          `${JSON.stringify(sessionDate)} is not an archive date, so the dated copy ` +
          `cannot be written and the live board is left as the store already has it, ` +
          `rather than gaining columns its own archive will never carry`);
        continue;
      }

      await publishFn(key, payload);
      await publishFn("board:" + side, payload);
      lines.push(`  re-published board:${side} with chain columns on ${merged} row(s)`);
    } catch (error) {
      lines.push(`  re-publish ${side}: ${error.message} — the store keeps the pre-chain board`);
    }
  }
  return lines;
}

function toRows(pool, screenerByTicker, previousRows, origin) {
  const prior = Array.isArray(previousRows) ? previousRows : [];
  const memo = applyHysteresis(
    pool.map((r) => r.ticker), prior.map((r) => r.t),
    { entryRank: UNIVERSE.boardSize, exitRank: Math.round(UNIVERSE.boardSize * 1.4) },
  );
  const byTicker = new Map(pool.map((r) => [r.ticker, r]));

  const rankBefore = new Map();
  for (const r of prior) {
    const v = num(r.r, null);
    if (v !== null) rankBefore.set(r.t, v);
  }
  const entered = new Set(memo.entered);
  const held = new Set(memo.held);

  return memo.ids.map((ticker, i) => boardRow(
    byTicker.get(ticker),
    screenerByTicker.get(ticker) || {},
    i + 1,

    memo.cold ? null : {
      nw: entered.has(ticker),
      hy: held.has(ticker),
      r0: rankBefore.has(ticker) ? rankBefore.get(ticker) : null,
    },
    origin,
  ));
}

const WATCH_ROWS = 80;

const fixed = (v, digits) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null);

function toWatchRows(pool, screenerByTicker, tiltByTicker, { cap = WATCH_ROWS } = {}) {

  const ranked = (pool || []).slice().sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
  const tilts = tiltByTicker || new Map();
  return ranked.slice(0, cap).map((r, i) => {
    const t = tilts.get(r.ticker) || {};
    return {
      ...boardRow(r, screenerByTicker.get(r.ticker) || {}, i + 1),

      resid: fixed(r.residual, 4),
      surpriseTilt: fixed(t.surpriseTilt, 3),
      relVolume: fixed(t.relVolume, 2),
      putCallRatio: fixed(t.putCallRatio, 3),
    };
  });
}

function unusualContractId(row) {
  if (!row) return null;
  const t = row.t;
  const k = row.k;
  const expiry = row.expiry;
  const cp = row.cp;
  if (typeof t !== "string" || !t) return null;
  if (!Number.isFinite(Number(k))) return null;
  if (typeof expiry !== "string" || !expiry) return null;
  if (cp !== "C" && cp !== "P") return null;
  return `${t}|${k}|${expiry}|${cp}`;
}

function markNewContracts(rows, priorBody, runSessionDate = null) {
  const list = Array.isArray(rows) ? rows : [];
  const priorRows = priorBody && priorBody.contracts && Array.isArray(priorBody.contracts.rows)
    ? priorBody.contracts.rows : null;
  const readAt = priorBody && typeof priorBody.readAt === "string" ? priorBody.readAt : null;
  const sessionDate = priorBody && typeof priorBody.sessionDate === "string"
    ? priorBody.sessionDate : null;

  const noComparison = (status, contracts) => {
    for (const row of list) row.nw = null;
    return { status, contracts, fresh: null, readAt, sessionDate };
  };

  if (!priorRows || !priorRows.length) {
    return noComparison(priorRows ? "quiet" : "unavailable", priorRows ? 0 : null);
  }

  const seen = new Set();
  for (const row of priorRows) {
    const id = unusualContractId(row);
    if (id) seen.add(id);
  }

  if (!seen.size) return noComparison("quiet", 0);

  const stamp = (v) => (typeof v === "string" && ARCHIVE_DATE_RE.test(v) ? v : null);
  const prior = stamp(sessionDate);
  const run = stamp(runSessionDate);
  if (prior !== null && run !== null) {
    if (prior === run) return noComparison("same-session", seen.size);

    if (prior > run) return noComparison("ahead", seen.size);
  }

  const status = prior === null || run === null ? "undated" : "ok";
  let fresh = 0;
  for (const row of list) {
    const id = unusualContractId(row);

    if (!id) { row.nw = null; continue; }
    const isNew = !seen.has(id);
    row.nw = isNew ? 1 : 0;
    if (isNew) fresh++;
  }
  return { status, contracts: seen.size, fresh, readAt, sessionDate };
}

function priorNote(mark, runSessionDate, shown) {
  const when = mark.readAt ? `read at ${mark.readAt}` : "with no read time on it";

  const named = mark.contracts === null || mark.contracts === undefined
    ? "no countable contracts"
    : `${mark.contracts} contract${mark.contracts === 1 ? "" : "s"}`;
  switch (mark.status) {
    case "ok":
      return `The counter feed published for ${mark.sessionDate}, ${when}, named ` +
        `${named} this run can identify. ${mark.fresh} of today's ${shown} were absent from ` +
        "it and are marked as first appearances; the rest were in it and are marked as " +
        "carried over. A first appearance is a statement about this ranked list, not about " +
        "the strike: a contract can be absent from the earlier feed because it was quiet, or " +
        "because it sat below that morning's per-name cap.";
    case "undated":
      return "The counter feed this run read carries no session date, or this run could not " +
        `resolve its own, so it could not be checked that the ${named} compared against came ` +
        "from an EARLIER session rather than from this run's own output. The comparison was " +
        "made anyway: discarding a real earlier session over a missing stamp would report a " +
        "cold feed on a morning that had a good yesterday. Read the marks as unverified " +
        "rather than as a comparison against a named session.";
    case "same-session":
      return `The counter feed this run read is stamped ${mark.sessionDate}, the same session ` +
        "this run is publishing, so it is this run's own output rather than an earlier " +
        `session. Its ${named} were discarded and no row here claims to be a first ` +
        "appearance. Comparing a feed against itself marks every line carried over, and " +
        "publishing that would report a session in which nothing was newly crowded when what " +
        "really happened is that this pipeline ran twice against one session.";
    case "ahead":
      return `The counter feed this run read is stamped ${mark.sessionDate}, a LATER session ` +
        `than the ${runSessionDate || "unresolved session"} this run is publishing, so it ` +
        `cannot be this run's yesterday. Its ${named} were discarded and no row here claims ` +
        "to be a first appearance. A run publishing an earlier session than the feed already " +
        "live usually means a re-run against a stale tape, and that is worth understanding " +
        "before these marks are read as a comparison.";
    case "quiet":
      return "The counter feed was read and named no contract this run can identify, so there " +
        "was no list to compare against and no row here claims to be a first appearance. A " +
        "feed that named nothing is not a session in which nothing was crowded — it is a " +
        "payload with nothing in it to match on, which is a fact about that payload.";
    default:
      return "No counter feed could be read on this run — either none has ever been published " +
        "under this key, or the read did not complete — so there is no earlier session to " +
        "compare against and no row here claims to be a first appearance. The comparison " +
        "begins on the next run that finds a feed to read.";
  }
}

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

const TRIX_SPAN = 15;

const TRIX_SERIES = 30;

const TRIX_WARMUP = 5 * TRIX_SPAN;

const TRIX_MIN_CANDLES = TRIX_WARMUP + TRIX_SERIES + 1;

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

function trixSeriesBp(closes, { span = TRIX_SPAN } = {}) {
  const e3 = ema(ema(ema(closes.map((c) => Math.log(c)), span), span), span);
  const out = [];
  for (let i = 1; i < e3.length; i++) out.push((e3[i] - e3[i - 1]) * 10000);
  return out;
}

const TRIX_FULL_SCALE_BP = 50;

function scaleTrix(bp) {
  if (!Number.isFinite(bp)) return null;
  return Number((50 + 50 * Math.max(-1, Math.min(1, bp / TRIX_FULL_SCALE_BP))).toFixed(1));
}

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

    const bp = window.map((v) => Number(v.toFixed(2)));
    const last = bp[bp.length - 1];
    return {
      sector, etf,
      trix: scaleTrix(last),
      trixBp: last,
      clamped: Math.abs(last) >= TRIX_FULL_SCALE_BP,
      series: bp.map((v) => scaleTrix(v)),

      clampedPoints: bp.filter((v) => Math.abs(v) >= TRIX_FULL_SCALE_BP).length,
      reason: null,
    };
  });
}

export function vendorNum(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : num(trimmed, null);
  }
  return num(value, null);
}

export function sectorLean(rows) {
  const byTicker = new Map();
  for (const row of unwrapVendorRows(rows)) {
    const ticker = row && typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";

    if (ticker && !byTicker.has(ticker)) byTicker.set(ticker, row);
  }

  return SECTOR_ETFS.map(({ sector, etf }) => {
    const base = {
      sector, etf,

      fullName: null,
      bullishPremiumUsd: null, bearishPremiumUsd: null,
      grossPremiumUsd: null, netPremiumUsd: null, leanRatio: null,
      callPremiumUsd: null, putPremiumUsd: null,
      callVolume: null, putVolume: null,
      lastUsd: null, prevCloseUsd: null, changeRatio: null,
      stockVolume: null,
      read: "unreadable", reason: null,
    };

    const row = byTicker.get(etf);
    if (!row || typeof row !== "object") {
      return { ...base, reason: `no ${etf} row in the sector-etfs response` };
    }

    const fullName = typeof row.full_name === "string" && row.full_name.trim()
      ? row.full_name.trim() : null;

    const last = vendorNum(row.last);
    const prevClose = vendorNum(row.prev_close);
    const context = {
      fullName,
      callPremiumUsd: vendorNum(row.call_premium),
      putPremiumUsd: vendorNum(row.put_premium),
      callVolume: vendorNum(row.call_volume),
      putVolume: vendorNum(row.put_volume),
      lastUsd: last, prevCloseUsd: prevClose,

      changeRatio: last !== null && prevClose !== null && prevClose !== 0
        ? Number(((last - prevClose) / prevClose).toFixed(6)) : null,
      stockVolume: vendorNum(row.volume),
    };

    const bullish = vendorNum(row.bullish_premium);
    const bearish = vendorNum(row.bearish_premium);

    if (bullish === null && bearish === null) {
      return { ...base, ...context,
        reason: `${etf} carried neither bullish_premium nor bearish_premium` };
    }
    if (bullish === null || bearish === null) {
      return { ...base, ...context,

        bullishPremiumUsd: bullish, bearishPremiumUsd: bearish,
        reason: `${etf} carried ${bullish === null ? "bearish_premium" : "bullish_premium"} ` +
          "but not the other side, and a lean needs both terms" };
    }

    const gross = bullish + bearish;
    const net = bullish - bearish;
    return { ...base, ...context,
      bullishPremiumUsd: bullish, bearishPremiumUsd: bearish,
      grossPremiumUsd: gross,
      netPremiumUsd: net,

      leanRatio: gross === 0 ? null : Number((net / gross).toFixed(6)),
      read: gross === 0 ? "quiet" : "ok",
      reason: gross === 0
        ? `${etf} was read and both premium sums were zero — measured and empty, ` +
          "not missing"
        : null,
    };
  });
}

export const NEWS_VENDOR_LIMIT = 100;

export const NEWS_ROWS = 60;

export function shapeNews(raw, { cap = NEWS_ROWS, requested = NEWS_VENDOR_LIMIT } = {}) {
  const wire = unwrapVendorRows(raw);

  let unusable = 0, undatedSeen = 0;
  const shaped = [];
  for (const row of wire) {
    if (!row || typeof row !== "object") { unusable++; continue; }
    const headline = typeof row.headline === "string" && row.headline.trim()
      ? row.headline.trim() : null;

    if (headline === null) { unusable++; continue; }

    const createdAt = typeof row.created_at === "string" && row.created_at.trim()
      ? row.created_at.trim() : null;
    const parsed = createdAt === null ? NaN : Date.parse(createdAt);
    const createdAtMs = Number.isFinite(parsed) ? parsed : null;
    if (createdAtMs === null) undatedSeen++;

    shaped.push({
      headline,
      source: typeof row.source === "string" && row.source.trim() ? row.source.trim() : null,
      createdAt, createdAtMs,

      major: row.is_major === null || row.is_major === undefined ? null : Boolean(row.is_major),

      sentiment: typeof row.sentiment === "string" && row.sentiment.trim()
        ? row.sentiment.trim() : null,

      tickers: Array.isArray(row.tickers)
        ? [...new Set(row.tickers.filter((t) => typeof t === "string" && t.trim())
          .map((t) => t.trim().toUpperCase()))]
        : [],
      tags: Array.isArray(row.tags)
        ? [...new Set(row.tags.filter((t) => typeof t === "string" && t.trim())
          .map((t) => t.trim()))]
        : [],
    });
  }

  shaped.sort((a, b) => {
    if (a.createdAtMs === null && b.createdAtMs === null) return 0;
    if (a.createdAtMs === null) return 1;
    if (b.createdAtMs === null) return -1;
    return b.createdAtMs - a.createdAtMs;
  });

  const rows = shaped.slice(0, cap);
  const dated = rows.map((r) => r.createdAtMs).filter((ms) => ms !== null);

  return {
    rows,

    requested, returned: wire.length, kept: rows.length,
    cap, capped: shaped.length > cap, shed: Math.max(0, shaped.length - cap),
    atVendorLimit: wire.length >= requested,
    unusable,

    undatedKept: rows.filter((r) => r.createdAtMs === null).length,
    undatedSeen,

    newest: dated.length ? new Date(Math.max(...dated)).toISOString() : null,
    oldest: dated.length ? new Date(Math.min(...dated)).toISOString() : null,
    ordered: true, orderedBy: "createdAt", orderedDesc: true,

    status: rows.length ? "ok" : (wire.length ? "unreadable" : "quiet"),
    reason: rows.length
      ? null
      : (wire.length
        ? `the headlines feed returned ${wire.length} row(s) and none carried a headline`
        : "the headlines feed was read and returned no rows"),
  };
}

const MOVER_ROWS = 15;

const onWire = (v) => v !== undefined && v !== null && v !== "";

function netPremiumOf(row) {
  if (!row) return null;
  if (!(onWire(row.net_call_premium) || onWire(row.net_put_premium))) return null;
  return Math.round(num(row.net_call_premium) - num(row.net_put_premium));
}

function moverRow(row, tilt) {
  const close = num(row.close);
  const prev = num(row.prev_close);
  const t = tilt || {};
  return {
    t: row.ticker,
    px: close > 0 ? close : null,

    chg: prev > 0 && close > 0 ? Number(((close - prev) / prev).toFixed(5)) : null,

    netPrem: netPremiumOf(row),
    relVolume: fixed(t.relVolume, 2),
    surpriseTilt: fixed(t.surpriseTilt, 3),

    sector: row.sector || null,
  };
}

function buildMovers(withTilt, { cap = MOVER_ROWS } = {}) {
  const rows = (withTilt || []).map(({ row, tilt }) => moverRow(row, tilt));

  const movable = rows.filter((r) => r.chg !== null);
  const byChange = movable.slice().sort((a, b) => b.chg - a.chg);
  const risers = byChange.filter((r) => r.chg > 0).slice(0, cap);

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

    unrankedChange: rows.length - movable.length,
    unrankedPremium: rows.length - priced.length,
  };
}

function summarize(payload) {
  if (Array.isArray(payload.rows)) return `${payload.rows.length} rows`;

  if (Array.isArray(payload.sectors)) return `${payload.sectors.length} sectors`;
  return "no rows";
}

const ARCHIVE_RETENTION_DAYS = 126;

const ARCHIVE_PRUNE_LOOKBACK_DAYS = 30;

const ARCHIVE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function datedKey(side, sessionDate) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return null;
  return `board:${side}:${sessionDate}`;
}

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

async function retire(key) {
  if (DRY_RUN) {
    console.log(`  [dry-run] retire ${key}`);
    return { ok: true, status: 0 };
  }
  try {

    await ingestWrites.acquire();
    const response = await fetch(
      ingestURL() + "?key=" + encodeURIComponent(key),
      {
        method: "DELETE",
        redirect: "error",
        headers: ingestHeaders(),
      },
    );
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, message: error.message };
  }
}

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

const PUBLISH_RETRIES = 3;

const PUBLISH_RETRY_BUDGET_MS = 90_000;
let publishRetrySpentMs = 0;

const PUBLISH_RETRYABLE = new Set([403, 408, 429, 500, 502, 503, 504]);

export function publishRetryDelay(attempt, {
  retries = PUBLISH_RETRIES, budgetMs = PUBLISH_RETRY_BUDGET_MS, spentMs = 0,
} = {}) {
  if (!(attempt >= 0) || attempt >= retries) return null;
  const wait = 1000 * (attempt + 1) * (attempt + 1);
  return spentMs + wait > budgetMs ? null : wait;
}

const publishedStore = Object.create(null);

async function publish(key, payload) {
  publishedStore[key] = payload;
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

  await ingestWrites.acquire();
  response = await fetch(
    ingestURL() + "?key=" + encodeURIComponent(key),
    {
      method: "POST",

      redirect: "error",

      headers: ingestHeaders({ json: true }),
      body,
    },
  );

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

    ingestWrites.defer(wait);
    await sleep(wait);
    continue;
  }
  break;
  }

  if (!response.ok) {

    const detail = (await response.text().catch(() => "")) || lastDetail;
    const ray = response.headers.get("cf-ray") || "none";
    const server = response.headers.get("server") || "unknown";
    const failure = new Error(
      `ingest ${key} -> HTTP ${response.status}` +
      ` (server: ${server}, cf-ray: ${ray})` +
      (detail ? ` body: ${detail.slice(0, 300).replace(/\s+/g, " ")}` : " body: <empty>"),
    );

    failure.status = response.status;
    throw failure;
  }
  console.log(`  published ${key}: ${summarize(payload)}, ${body.length} bytes`);
}

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

  const gateOrigin = easternNow().date;
  const rnd = mulberry(20260825);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const price = 8 + rnd() * 400;
    const callVol = Math.round(2000 + rnd() * 900000);
    const putVol = Math.round(1500 + rnd() * 700000);
    const bull = rnd() * 4e7;
    const bear = rnd() * 4e7;

    const quoted = i % 97 !== 3;

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

      iv_rank: (rnd() * 100).toFixed(4),
      implied_move: (price * (0.02 + rnd() * 0.06)).toFixed(4),
      implied_move_perc: (0.02 + rnd() * 0.06).toFixed(6),
      volatility: (0.18 + rnd() * 0.5).toFixed(4),
      put_call_ratio: (putVol / callVol).toFixed(4),
      week_52_high: (price * (1.05 + rnd() * 0.6)).toFixed(2),
      week_52_low: (price * (0.4 + rnd() * 0.4)).toFixed(2),
      relative_volume: (0.5 + rnd() * 3).toFixed(2),

      next_earnings_date: rnd() > 0.5
        ? new Date(Date.parse(gateOrigin + "T00:00:00Z") + Math.floor(rnd() * 46) * 86400000)
          .toISOString().slice(0, 10)
        : null,
    });
  }
  return rows;
}

function fakeSectorCandles(etf) {
  const i = SECTOR_ETFS.findIndex((s) => s.etf === etf);
  const driftBp = (i - 5) * 12;
  const sessions = etf === "XLRE" ? 20 : 252;

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

function fakeSectorEtfs() {
  const rnd = mulberry(4711);

  const BASKETS = [{ sector: "S&P 500 Index", etf: "SPY" }, ...SECTOR_ETFS];
  return { data: BASKETS.map(({ sector, etf }, i) => {
    const last = 40 + i * 9 + rnd() * 5;
    const prev = last * (1 + (rnd() - 0.5) * 0.02);

    const scale = etf === "SPY" ? 3e8 : 1e4 * Math.pow(10, (i % 4));
    const bullish = Math.round(scale * (0.4 + rnd()));
    const bearish = Math.round(scale * (0.4 + rnd()));
    const row = {
      ticker: etf,
      full_name: etf === "SPY" ? "S&P 500 Index" : sector,
      last: last.toFixed(2), prev_close: prev.toFixed(2),
      open: prev.toFixed(2), high: (last * 1.004).toFixed(2), low: (last * 0.996).toFixed(2),
      prev_date: "2026-08-21",
      marketcap: String(Math.round(5e9 + rnd() * 4e11)),
      volume: Math.round(1e6 + rnd() * 4e7),
      call_premium: String(Math.round(scale * 1.1)),
      put_premium: String(Math.round(scale * 0.9)),
      call_volume: Math.round(300 + rnd() * 2e6),
      put_volume: Math.round(300 + rnd() * 2e6),
      avg30_stock_volume: String(Math.round(2e6 + rnd() * 6e7)),
      week52_high: (last * 1.2).toFixed(2), week52_low: (last * 0.7).toFixed(2),
      bullish_premium: String(bullish),
      bearish_premium: String(bearish),
    };
    if (etf === "XLU") { row.bullish_premium = "0"; row.bearish_premium = "0"; }
    if (etf === "XLB") { delete row.bearish_premium; }
    if (etf === "XLRE") { row.bullish_premium = "   "; }
    return row;
  }) };
}

function fakeNewsHeadlines(tickers) {
  const rnd = mulberry(8123);
  const names = (tickers && tickers.length ? tickers : ["SYN001"]).slice(0, 24);
  const SOURCES = ["BusinessWire", "MarketNews", "Reuters", "Bloomberg", "PRNewswire"];
  const SENTIMENT = ["positive", "negative", "neutral"];
  const TAGS = ["earnings", "guidance", "tech", "federal-reserve", "interest-rates", "m-and-a"];
  const rows = Array.from({ length: NEWS_VENDOR_LIMIT }, (_, i) => {

    const at = Date.UTC(2026, 7, 21, 20, 0, 0) - i * 7 * 60000;
    const withTickers = i % 3 !== 2;
    return {
      created_at: new Date(at).toISOString(),
      headline: `Synthetic headline ${i + 1} about ` +
        (withTickers ? names[Math.floor(rnd() * names.length)] : "the broader tape"),
      source: SOURCES[i % SOURCES.length],
      sentiment: SENTIMENT[i % SENTIMENT.length],
      is_major: i % 7 === 0,
      meta: {},
      tags: [TAGS[i % TAGS.length], TAGS[(i + 3) % TAGS.length]],
      tickers: withTickers
        ? [names[Math.floor(rnd() * names.length)], names[Math.floor(rnd() * names.length)]]
        : [],
    };
  });
  delete rows[5].created_at;
  rows[9].created_at = "not a timestamp";
  rows[12].headline = "";
  rows[17] = null;

  const shuffled = rows.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { data: shuffled };
}

function card0Unusable(row) {
  if (!row || typeof row !== "object") return true;
  return !["call_gamma_ask", "call_gamma_bid", "put_gamma_ask", "put_gamma_bid"]
    .some((k) => row[k] !== undefined && row[k] !== null && row[k] !== "");
}

export function fakeChain(ticker, spot, seed, { wide = false, expiry = null } = {}) {
  const rnd = mulberry(seed);
  const rows = [];
  const ladder = wide
    ? [["260831", 7], ["260904", 11], ["260911", 18], ["260918", 25], ["260925", 32],
       ["261016", 53], ["261120", 88], ["261218", 116], ["270115", 144], ["270618", 298]]
    : [["260831", 7], ["260918", 25], ["261016", 53], ["261218", 116]];

  const expiries = expiry
    ? ladder.filter(([code]) => `20${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 6)}` === expiry)
    : ladder;
  for (const [code, dte] of expiries) {
    const halfWidth = wide ? 15 : 8;
    for (let i = -halfWidth; i <= halfWidth; i++) {
      const m = i * 0.035;
      const strike = Math.round(spot * Math.exp(m) * 100) / 100;
      const level = 0.34 - 0.03 * Math.log(dte / 7);

      for (const cp of ["P", "C"]) {
        const isPut = cp === "P";
        const iv = level + 0.55 * m * m - 0.22 * m + (isPut ? 0.012 : -0.012);
        const intrinsic = isPut ? Math.max(0, strike - spot) : Math.max(0, spot - strike);
        const bid = intrinsic + spot * iv * Math.sqrt(dte / 365) * 0.4 * Math.exp(-2 * m * m);

        const traded = rnd() > 0.08;
        const volume = traded ? Math.round(80 + 3000 * Math.exp(-7 * m * m) * rnd()) : 0;
        const row = {
          option_symbol: `${ticker}${code}${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`,

          nbbo_bid: (i === halfWidth && !isPut ? 0 : Math.max(0.05, bid)).toFixed(2),
          nbbo_ask: (Math.max(0.05, bid) * 1.02 + 0.03).toFixed(2),
          implied_volatility: iv.toFixed(6),
          open_interest: String(400 + Math.round(6000 * Math.exp(-6 * m * m))),
          prev_oi: String(380 + Math.round(5700 * Math.exp(-6 * m * m))),
        };

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

  rows.push({
    option_symbol: `${ticker}1260918C${String(Math.round(spot * 300)).padStart(8, "0")}`,
    nbbo_bid: "1.00", nbbo_ask: "1.10", implied_volatility: "0.400000",
    open_interest: "5000", prev_oi: "4800", volume: "99999",
    ask_volume: "90000", bid_volume: "9999",
  });

  if (expiry || !wide) return rows;

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

    const width = spot * (0.04 + j * 0.035);
    const weight = 1 / (j + 1);
    for (let i = 0; i < 25; i++) {
      const k = Math.round(spot * (0.78 + i * 0.018) * 100) / 100;
      const bell = Math.exp(-Math.pow((k - spot) / width, 2));
      if (bell < 0.01) continue;
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

function fakeMaxPain(ticker, spot) {
  const rnd = mulberry(ticker.length * 977 + Math.round(spot));
  return Array.from({ length: 5 }, (_, i) => ({
    expiry: new Date(Date.UTC(2026, 7, 28) + i * 7 * 86400000).toISOString().slice(0, 10),
    max_pain: (spot * (0.94 + rnd() * 0.12)).toFixed(0),
  }));
}

function fakeStockDarkpool(ticker, spot) {
  const rnd = mulberry(ticker.length * 1289 + Math.round(spot));
  if (ticker.length % 7 === 3) return [];
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
    if (i % 5 !== 4) row.premium = String(Math.round(px * size));
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
      ...(() => {

        const last = Math.max(1, Math.round(rnd() * 70000));
        const curr = Math.max(0, Math.round(last * (0.4 + rnd() * 1.6)));
        const row = {
          oi_change: String((curr - last) / last),
          curr_oi: curr,
          last_oi: last,
        };
        if (i % 9 !== 8) row.oi_diff_plain = curr - last;
        return row;
      })(),
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

    if (i % 8 !== 7) row.iv_rank_1y = (rnd() * 100).toFixed(2);
    return row;
  });
}

function fakeCongress(ticker) {
  const rnd = mulberry(ticker.length * 613);
  const n = Math.floor(rnd() * 5);
  return Array.from({ length: n }, (_, i) => {
    const txn = Date.UTC(2026, 6, 5 + i * 4);

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

function fakePriorUnusual(rows, sessionDate) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const kept = list.filter((_, i) => i % 3 !== 0).map((r) => ({
    t: r.t, k: r.k, expiry: r.expiry, cp: r.cp,
  }));

  for (let i = 0; i < 5 && i < list.length; i++) {
    const r = list[i];
    kept.push({ t: r.t, k: Number((Number(r.k) + 5).toFixed(2)), expiry: r.expiry, cp: r.cp === "C" ? "P" : "C" });
  }

  let prior = null;
  const base = Date.parse(String(sessionDate || "") + "T00:00:00Z");
  if (Number.isFinite(base)) {
    for (let back = 1; back <= 4; back++) {
      const d = new Date(base - back * 86400000);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      prior = d.toISOString().slice(0, 10);
      break;
    }
  }
  return {
    v: BOARD_SCHEMA_VERSION,
    sessionDate: prior,
    readAt: (prior || "2026-01-01") + "T09:20:00.000Z",
    contracts: { rows: kept, shown: kept.length },
  };
}

export function fakePriorBoard(side, pool, sessionDate) {
  const ranked = (Array.isArray(pool) ? pool : []).slice(0, UNIVERSE.boardSize);
  if (!ranked.length) return null;

  const rows = ranked.filter((_, i) => i % 3 !== 0)
    .map((r, i) => ({ t: r.ticker, r: i + 1 }));

  for (let i = 0; i < 3; i++) rows.push({ t: "GONE" + i, r: rows.length + 1 });

  let prior = null;
  const base = Date.parse(String(sessionDate || "") + "T00:00:00Z");
  if (Number.isFinite(base)) {
    for (let back = 1; back <= 4; back++) {
      const d = new Date(base - back * 86400000);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      prior = d.toISOString().slice(0, 10);
      break;
    }
  }
  return {
    v: BOARD_SCHEMA_VERSION,
    side,
    sessionDate: side === "short" ? sessionDate || null : prior,
    generatedAt: (prior || "2026-01-01") + "T09:20:00.000Z",
    rows,
  };
}

function fakeFlowAlerts(tickers) {
  const rnd = mulberry(4177);
  const names = (tickers && tickers.length ? tickers : ["SYN001"]).slice(0, 24);
  const rows = [];

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

    if (i % 4 !== 3) {
      row.option_chain = t + "260918" + (call ? "C" : "P") +
        String(strike * 1000).padStart(8, "0");
    }
    if (i % 5 !== 4) row.total_size = 10 + Math.floor(rnd() * 900);
    if (i % 6 !== 5) row.has_floor = rnd() > 0.85;
    if (i % 7 === 6) { row.iv_start = 0.3 + rnd() * 0.4; row.iv_end = 0.3 + rnd() * 0.4; }
    if (i % 11 === 10) delete row.total_premium;
    rows.push(row);
  }
  rows.push({ ticker: "", total_premium: 5 });
  return rows;
}

const ALERT_VENDOR_LIMIT = 200;

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

  for (let i = 0; i < 6; i++) {
    filings.push({
      name: "Ivor Blackwood", politician_id: "pid-sell", ticker: names[i % names.length],
      issuer: "Synthetic Holdings Inc", member_type: "house",
      txn_type: "Sale (Full)", amounts: "$1,000,001 - $5,000,000",
      transaction_date: "2026-07-02", filed_at_date: "2026-08-01",
    });
  }

  for (let i = 0; i < 8; i++) {
    filings.push({
      name: "Jae Moon", politician_id: "pid-alt", ticker: names[i % names.length],
      asset: "Synthetic Corporation - Common Stock", asset_type: "stock",
      transaction_type: "Buy",
      low_value: "1000001", high_value: "5000000", mid_value: "3000000",
      transaction_date: "2026-06-20", filed_at_date: "2026-07-15",
    });
  }
  filings.push({ notes: "no filer and no ticker" });
  return {
    filings,

    holders: { __failed: "HTTP 422 — the status the live vendor returned" },
  };
}

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

    const lastOi = 20000 + Math.round(rnd() * 60000);
    const change = Math.round((rnd() - 0.3) * 40000);
    const row = {
      option_symbol: `${t}260918${rnd() > 0.5 ? "C" : "P"}${String(Math.round(40 + rnd() * 300) * 1000).padStart(8, "0")}`,
      underlying_symbol: t,
      oi_change: String(change),
      oi_diff_plain: change,
      curr_oi: lastOi + change,
      last_oi: lastOi,
      curr_date: "2026-08-21",
      last_date: "2026-08-20",
      volume: Math.round(rnd() * 50000),
      rnk: i,
    };
    if (i % 4 !== 3) row.trades = Math.round(rnd() * 900);
    if (i % 5 !== 4) row.avg_price = (rnd() * 40).toFixed(2);
    if (i % 6 !== 5) row.percentage_of_total = (rnd() * 0.2).toFixed(4);
    return row;
  }).sort((a, b) => Number(b.oi_change) - Number(a.oi_change)) };
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
    const minute = 959 - i;
    const row = {
      ticker: pick(),
      executed_at: `2026-08-21T${String(Math.floor(minute / 60)).padStart(2, "0")}:` +
        `${String(minute % 60).padStart(2, "0")}:00Z`,
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

    seasonality: { __failed: "synthetic outage (dry-run fixture)" },
  };
}

export const DRY_SESSION_DATE = "2026-08-24";

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

  const tilt = 0.94 + rnd() * 0.12;
  const oneSided = rnd() < 0.125;
  const strikes = Array.from({ length: 41 }, (_, i) => {
    const k = spot * (0.7 + i * 0.015);
    const w = Math.exp(-Math.pow((k - spot) / (spot * 0.3), 2));
    const lean = oneSided
      ? Math.abs((k - spot * tilt) / spot)
      : (k - spot * tilt) / spot;
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

  const days = tradingDaysEndingAt(DRY_SESSION_DATE, 252);
  let s2 = 1.6, lastMove = 0;
  const ohlc = Array.from({ length: 252 }, (_, i) => {
    s2 = 0.08 + 0.09 * lastMove * lastMove + 0.86 * s2;
    lastMove = Math.sqrt(s2) * (rnd() + rnd() + rnd() - 1.5) * 2;
    const move = px * lastMove / 100;
    const open = px; px = Math.max(1, px + move);
    return {

      start_time: new Date(days[i]).toISOString(),
      open: open.toFixed(2), close: px.toFixed(2),
      high: (Math.max(open, px) * 1.008).toFixed(2),
      low: (Math.min(open, px) * 0.992).toFixed(2),
      volume: Math.round((3e6 + rnd() * 2e7)),
    };
  });

  return { ticker, spot, greekFlow, ticks, strikes, expiries, ohlc };
}

async function main() {

  const today = easternNow().date;
  console.log(DRY_RUN ? "Flows pipeline — DRY RUN (synthetic, no network)" : "Flows pipeline — live");

  if (!DRY_RUN) {

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

  const sessionDate = DRY_RUN ? DRY_SESSION_DATE : await resolveSessionDate();
  console.log(`session date: ${sessionDate || "unresolved — falling back to undated calls"}`);
  const dating = await verifyDating(sessionDate);
  console.log(`dating: date=${dating.date} end_date=${dating.endDate}`);

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

  const withTilt = universe.map((row) => ({ row, tilt: screenerTilt(row) }));
  const tilted = withTilt.filter(({ row }) => {
    const dte = daysToEarnings(row, today);
    return dte === null || dte < 0 || dte > EARNINGS_GATE_DAYS;
  });
  console.log(`after earnings gate: ${tilted.length}`);

  const composite = tilted.map(({ row, tilt }) => ({
    row, tilt,

    rough: (tilt.premiumTilt || 0) + (tilt.netTilt || 0) + (tilt.volTilt || 0) +
           Math.tanh(tilt.surpriseTilt || 0),
  })).sort((a, b) => b.rough - a.rough);

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
  {
    const lane = poolWidth(2);
    console.log(`  enrichment: ${lane.width} name(s) in flight — ${lane.why}`);

    const { results } = await runPooled(picks, async (pick, i) => {
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
        return { features, raw, tilt: pick.tilt, row: pick.row };
      } catch (error) {
        console.warn(`  ${ticker}: enrichment failed — ${error.message}`);
        return null;
      }
    }, { width: lane.width });
    for (const e of results) {
      if (e) enriched.push(e); else failed++;
    }
  }

  const completeness = enriched.length / picks.length;
  console.log(`enrichment: ${enriched.length}/${picks.length} (${(completeness * 100).toFixed(1)}%), ${failed} failed`);
  if (completeness < 0.8) {
    throw new Error(
      `completeness ${(completeness * 100).toFixed(1)}% below the 80% gate — publishing nothing`,
    );
  }

  const MIN_ROWS = 10;

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

  const { kept: unique, dropped: shareClasses } = collapseShareClasses(liquid);
  for (const d of shareClasses) {
    console.log(
      `share class: kept ${d.kept}, dropped ${d.dropped} ` +
      `(same sector and market cap, return correlation ${d.corr.toFixed(3)})`);
  }

  const tiltByTicker = new Map(unique.map((e) => [e.features.ticker, e.tilt]));

  const scored = scoreBoard(

    unique.map((e) => ({ ...e.features, netPrem: netPremiumOf(e.row) })),
    unique.map((e) => e.tilt),
    unique.map((e) => e.row.sector || ""),
    unique.map((e) => num(e.row.marketcap)),
  );

  const generatedAt = new Date().toISOString();
  const sides = partitionSides(scored);
  console.log(
    `sides: ${sides.long.length} long, ${sides.short.length} short, ` +
    `${sides.neutral} inside the +-${sides.deadBand} dead band ` +
    `(dispersion ${(scored[0] && scored[0].dispersion || 0).toFixed(3)})`);

  if (!sides.long.length && !sides.short.length) {
    throw new Error(
      `no name on either side cleared the +-${sides.deadBand} dead band across ` +
      `${scored.length} scored names — publishing nothing rather than an empty board`,
    );
  }

  const previous = {};
  const boardMemory = {};
  for (const side of ["long", "short"]) {

    let read;
    if (DRY_RUN) {
      const payload = fakePriorBoard(side, sides[side], sessionDate);

      read = { payload, absent: !payload, status: 0 };
    } else {
      read = await readStored("board:" + side);
    }
    boardMemory[side] = readBoardMemory(read, sessionDate);
    previous[side] = boardMemory[side].rows;
  }

  const published = {};
  const payloads = {};
  const first = scored[0] || {};
  for (const side of ["long", "short"]) {
    published[side] = toRows(sides[side], screenerByTicker, previous[side], today);
  }

  for (const side of ["long", "short"]) {
    const rows = published[side];
    const memory = boardMemory[side];
    console.log(
      `  board:${side} memory: ${memory.status} — ` + (memory.incumbents
        ? `${rows.filter((r) => r.nw).length} new, ` +
          `${rows.filter((r) => r.hy).length} held on incumbency, of ${rows.length} ` +
          `(${memory.incumbents} incumbent${memory.incumbents === 1 ? "" : "s"} from ` +
          `${memory.sessionDate || "a board carrying no session date"})`
        : memory.note));
  }

  const deepSet = new Set(deepNames(published).map((d) => d.t));
  for (const side of ["long", "short"]) {
    for (const row of published[side]) {
      if (deepSet.has(row.t)) row.dp = 1;

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

      gateOrigin: today,
      gateDays: EARNINGS_GATE_DAYS,

      memory: {
        status: boardMemory[side].status,
        sessionDate: boardMemory[side].sessionDate,
        named: boardMemory[side].named,
        incumbents: boardMemory[side].incumbents,
        note: boardMemory[side].note,
      },
      universe: universe.length,
      enriched: enriched.length,

      scored: scored.length,
      dispersion: Number.isFinite(first.dispersion) ? Number(first.dispersion.toFixed(4)) : null,
      deadBand: sides.deadBand,
      neutral: sides.neutral,

      cleared: sides[side].length,
      shed: sides[side].length - rows.length,

      horizonSessions: HORIZON_SESSIONS,
      weights: first.weights || null,
      shareClasses,

      deep: rows.filter((r) => r.dp).length,
      deepRule: DEEP_RULE,
      selection: UNIVERSE_NOTES.rule,
      selectionEpoch: SELECTION_EPOCH,
      status: rows.length ? "ok" : "thin",
    };
    await publish("board:" + side, payloads[side]);
  }

  const archiveWalkPromise = collectDatedBoards(sessionDate, payloads, enriched,

    (sides.neutralRows || []).map((r) => ({ t: r.ticker, s: r.score })))
    .catch((error) => {
      console.warn(`  record archive: the walk failed — ${error.message}`);
      return null;
    });
  const prunePromise = pruneArchive(sessionDate).catch((error) => {
    console.warn(`  prune: ${error.message}`);
    return null;
  });

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

      neutral: sides.neutral,
      horizonSessions: HORIZON_SESSIONS,
      weights: first.weights || null,
      status: watchRows.length ? "ok" : "thin",
    });
  } catch (error) {
    console.warn(`  watch: ${error.message}`);
  }

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

  let moversPayload = null;
  try {
    const movers = buildMovers(withTilt);
    moversPayload = {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

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

  try {

    const gateOrigin = today;
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

      sessionDate,
      gateOrigin,
      gateDays: EARNINGS_GATE_DAYS,
      status: events.shown ? "ok" : "quiet",

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

  let archiveWalk = null;
  try {
    archiveWalk = await archiveWalkPromise;
    if (!archiveWalk) throw new Error("the dated-archive walk returned nothing to score");
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

  let scoreTrack = null;

  let scoreTrackPremium = null;

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

    const { premium: premiumByName, ...track } = buildScoreTrack([...dayMap.values()], {
      deadBand: sides.deadBand,
      epoch: SELECTION_EPOCH,
    });
    await publish("scoretrack", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

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

    scoreTrack = track;
    scoreTrackPremium = premiumByName;
  } catch (error) {
    console.warn(`  scoretrack: ${error.message}`);
  }

  if (Date.now() > stats.startedAt + DEADLINE_MS) {
    console.warn(
      `  sector:trix: past the ${DEADLINE_MS / 60000}min deadline — not spending ` +
      `${SECTOR_ETFS.length} calls on a surface that would land after the cards were abandoned`);
  } else {
    try {

      const candlesByEtf = new Map();
      for (const { etf } of SECTOR_ETFS) {
        const candles = DRY_RUN
          ? fakeSectorCandles(etf)
          : await uw(`/api/stock/${etf}/ohlc/1d`, {

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

  const chainByTicker = new Map();
  try {

  const deep = deepNames({ long: payloads.long.rows, short: payloads.short.rows });
  const boardTickers = [...new Set(deep.map((d) => d.t))];
  const spotByTicker = new Map();
  for (const side of ["long", "short"]) {
    for (const row of payloads[side].rows) {
      const px = num(row.px);
      if (px > 0) spotByTicker.set(row.t, px);
    }
  }

  let chainReported = false;

  let chainProbed = false;
  const expiriesByTicker = new Map(liquid.map((e) => [e.features.ticker, e.raw.expiries || []]));

  if (Date.now() > stats.startedAt + DEADLINE_MS) {
    console.warn(
      `  chains: past the ${DEADLINE_MS / 60000}min deadline — not spending ` +
      `${boardTickers.length} calls on panels that would land after the cards were abandoned`);
  } else {
    const chainDeadline = stats.startedAt + DEADLINE_MS - CHAIN_RESERVE_MS;
    let scalarsRecovered = 0;

    const chainLane = poolWidth();
    console.log(`  chains: ${boardTickers.length} name(s), ${chainLane.width} in flight — ${chainLane.why}`);
    const chainRun = await runPooled(boardTickers, async (ticker, index) => {
      try {
        const rows = DRY_RUN

          ? fakeChain(ticker, spotByTicker.get(ticker) || 100, 7000 + index,
            { wide: index < 2 })
          : await uw(`/api/stock/${ticker}/option-contracts`, {

            exclude_zero_oi_chains: "true",
            limit: CHAIN_PAGE_SIZE,
          });

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

        if (panels.status === "ok" && panels.truncated && Date.now() < chainDeadline) {
          const near = nearestProbeExpiry(expiriesByTicker.get(ticker), {
            asOf: sessionDate, minDays: SKEW_MIN_DAYS,
          });
          if (near) {
            try {
              const narrow = DRY_RUN

                ? fakeChain(ticker, spotByTicker.get(ticker) || 100, 8000 + index,
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

        try {
        if (!chainProbed && panels.truncated) {
          const probeExpiry = nearestProbeExpiry(expiriesByTicker.get(ticker), {
            asOf: sessionDate, minDays: SKEW_MIN_DAYS,
          });
          if (probeExpiry) {
            chainProbed = true;
            try {
              const probeRows = DRY_RUN

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
          console.warn(`  chain probe (${ticker}): ${error.message} — the chain itself stands`);
        }
        return panels;
      } catch (error) {
        console.warn(`  chain ${ticker}: ${error.message}`);
        return null;
      }
    }, {
      width: chainLane.width,

      stopEarly: () => Date.now() > chainDeadline,
    });

    let chainOk = 0, chainFailed = 0, chainSkipped = 0;
    boardTickers.forEach((ticker, i) => {
      if (!chainRun.attempted[i]) { chainSkipped++; return; }
      const panels = chainRun.results[i];
      if (!panels) { chainFailed++; return; }
      chainByTicker.set(ticker, panels);
      if (panels.status === "ok") chainOk++; else chainFailed++;
    });
    if (chainSkipped) {
      console.warn(
        `  chains: stopped after ${chainOk + chainFailed} names, ${chainSkipped} not attempted ` +
        `— within ${CHAIN_RESERVE_MS / 60000}min of the deadline and the cards still need it`);
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

    for (const [t, c] of built) {
      if (c.skewTerm.status !== "ok") continue;
      if (c.scalars.skew === null) console.warn(`    ${t}: no skew — ${c.skewTerm.skewReason}`);
      if (c.scalars.atmIv === null) console.warn(`    ${t}: no ATM level — ${c.skewTerm.atmReason}`);
      if (c.foreignRows) console.warn(`    ${t}: dropped ${c.foreignRows} adjusted-series row(s)`);
    }

    const misses = [];
    for (const [, c] of built) {
      if (c.skewTerm.status !== "ok" || c.scalars.skew !== null) continue;
      if (c.skewTerm.skewMiss) misses.push(c.skewTerm.skewMiss);
    }
    if (misses.length) {

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

    if (built.length && !levelled) {
      console.warn(
        "  chains: NOT ONE name carried an at-the-money level. Every level requires a " +
        "contract that traded today, so this reads as `volume` being absent or zero " +
        "chain-wide at this hour rather than as a quiet session.");
    }
  }

  if (chainByTicker.size) {
    for (const line of await republishWithChain(payloads, chainByTicker, sessionDate, publish)) {
      console.log(line);
    }
  } else {

    for (const line of await archiveDatedBoards(payloads, sessionDate, publish)) {
      console.log(line);
    }
  }

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

    const priorUnusual = DRY_RUN
      ? fakePriorUnusual(contracts.rows, sessionDate)
      : await fetchStoredPayload("unusual");

    const priorMark = markNewContracts(contracts.rows, priorUnusual, sessionDate);

    await publish("unusual", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      readAt: generatedAt,
      volumeAsOf: null,
      volumeAsOfReason: "the endpoint accepts no date parameter and carries no as-of stamp",
      dteAnchor: "sessionDate",
      status: contracts.shown ? "ok" : (namesSeen ? "quiet" : "pending"),

      complete: namesSeen ? namesTruncated === 0 : null,
      namesSeen,
      namesTruncated,
      namesComplete: namesSeen - namesTruncated,
      foreign,
      ivConventionsSeen: divisors.size,

      prior: {
        status: priorMark.status,
        readAt: priorMark.readAt,
        sessionDate: priorMark.sessionDate,
        contracts: priorMark.contracts,
        fresh: priorMark.fresh,
        note: priorNote(priorMark, sessionDate, contracts.rows.length),
      },
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

        aggr: (() => {
          for (const c of chainByTicker.values()) {
            const r = c && c.topContracts && c.topContracts.relation;
            if (typeof r === "string" && r) return r;
          }
          return null;
        })(),

        new: "`nw` is 1 when this contract was absent from the previously published " +
          "counter feed, 0 when it was present in it, and null when NO comparison was " +
          "made — the earlier feed could not be read, or named nothing this run can " +
          "identify, or turned out to be this run's own output from a second run against " +
          "one session, which would have marked every line carried over. `prior.status` " +
          "says which of the six happened, `prior.note` says it in a sentence, and " +
          "`prior.sessionDate` and `prior.readAt` name the session and the read time the " +
          "comparison was made against. It is a statement about this list, not about the " +
          "strike: a contract can be absent from the earlier feed because it was quiet, or " +
          "because it sat below the per-name cap that morning.",
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

    console.log("  unusual memory: " + (DRY_RUN ? "[dry-run] " : "") + priorMark.status + " — " + (
      priorMark.status === "ok" || priorMark.status === "undated"
        ? `${priorMark.fresh} of ${contracts.rows.length} contract(s) absent from the ` +
          `${priorMark.contracts}-contract feed published for ` +
          `${priorMark.sessionDate || "an unstamped session"}` +
          (priorMark.status === "undated"
            ? " — which this run could NOT check was an earlier session than its own"
            : "")
        : priorMark.status === "same-session"
          ? `the prior feed is stamped ${priorMark.sessionDate}, the session this run is ` +
            `publishing, so it is this run's own output rather than a prior session: its ` +
            `${priorMark.contracts} contract(s) were discarded and no row claims to be new`
          : priorMark.status === "ahead"
            ? `the prior feed is stamped ${priorMark.sessionDate}, a LATER session than the ` +
              `${sessionDate} this run is publishing, so it cannot be this run's yesterday: ` +
              `its ${priorMark.contracts} contract(s) were discarded and no row claims to be new`
            : priorMark.status === "quiet"
              ? "the prior feed was read and named no contracts this run can identify, so no " +
                "row claims to be new"
              : "no prior feed could be read, so no row claims to be new"));

    const firstChain = [...chainByTicker.values()].find(
      (c) => c && c.status === "ok" && c.oiBasis && c.oiBasis.seen > 0);
    if (firstChain) {
      console.log("  " + (DRY_RUN ? "[dry-run] " : "") + firstChain.oiBasis.line +
        (DRY_RUN
          ? " On synthetic rows this is two unrelated fixture formulas disagreeing," +
            " and is not evidence about the vendor."
          : ""));
    }

    try {
      const raw = DRY_RUN
        ? fakeFlowAlerts((payloads.long.rows || []).map((r) => r.t))
        : await uw("/api/option-trades/flow-alerts", { limit: ALERT_VENDOR_LIMIT });

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

        readAt: new Date().toISOString(),
        refreshed: "nightly",
        ...alerts,

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

  let crossRaws = null;

  try {
    const PULSE_FETCHES = {
      tide: ["/api/market/market-tide", { interval_5m: "true" }],
      totals: ["/api/market/total-options-volume", { limit: PULSE_CAPS.totals }],
      oiChange: ["/api/market/oi-change", { limit: MARKET_CROSS_LIMIT }],
      netImpact: ["/api/market/top-net-impact", { limit: PULSE_CAPS.netImpact }],
      insiders: ["/api/market/insider-buy-sells", { limit: PULSE_CAPS.insiders }],
      darkpool: ["/api/darkpool/recent", { limit: MARKET_CROSS_LIMIT }],
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

    crossRaws = { oiChange: raws.oiChange, darkpool: raws.darkpool };
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

  let politicalFilings = null;

  const POLITICAL_WINDOW_DAYS = 90;

  try {
    const POLITICAL_PAGE_LIMIT = 200;
    const POLITICAL_MAX_PAGES = 8;
    const POLITICAL_HOLDER_NAMES = 6;
    const from = new Date(Date.parse((sessionDate || new Date().toISOString().slice(0, 10)) +
      "T00:00:00Z") - POLITICAL_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

    const raws = {};
    let pagesRead = 0, paginated = null, fellBack = false;
    if (DRY_RUN) {
      Object.assign(raws, fakePoliticalRaws((payloads.long.rows || []).map((r) => r.t)));

      if (Array.isArray(raws.filings) && raws.filings.length) politicalFilings = raws.filings;

      pagesRead = null;
    } else {
      const filings = [];
      const seenRows = new Set();
      const identity = (r) => `${r && r.politician_id || r && r.name || ""}|` +
        `${r && r.ticker || ""}|${r && r.transaction_date || ""}|` +
        `${r && r.filed_at_date || ""}|${r && r.amounts || r && r.mid_value || ""}`;
      try {

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

            if (d && d < from) continue;
            const key = identity(r);
            if (seenRows.has(key)) continue;
            seenRows.add(key);
            filings.push(r);
            added++;
          }
          pagesRead++;

          if (!added) {

            paginated = pagesRead > 1;
            break;
          }
          if (rows.length < POLITICAL_PAGE_LIMIT) { paginated = pagesRead > 1 ? true : null; break; }
          if (!oldest || oldest < from) { paginated = pagesRead > 1; break; }
          if (oldest === cursor) {

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

      if (Array.isArray(filings) && filings.length) politicalFilings = filings;

      const holderNames = deepNames(published, POLITICAL_HOLDER_NAMES).map((d) => d.t);
      const holders = [];
      for (const ticker of holderNames) {
        try {
          holders.push({ ticker, raw: await uw(`/api/politician-portfolios/holders/${ticker}`, {}) });
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          if (!holders.length) {
            raws.holders = { __failed: message };

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

      carded: [...deepSet].sort(),
      window: { from, to: sessionDate || null, days: POLITICAL_WINDOW_DAYS },

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

  try {
    const raw = DRY_RUN
      ? fakeSectorEtfs()
      : await uw("/api/market/sector-etfs", {});
    const wire = unwrapVendorRows(raw);
    const sectors = sectorLean(raw);
    const measured = sectors.filter((s) => s.read === "ok").length;
    const quiet = sectors.filter((s) => s.read === "quiet").length;

    if (wire.length && measured + quiet < SECTOR_ETFS.length / 2) {
      const first = wire[0];
      if (first && typeof first === "object") {
        console.log("  sector:premium: NOTE returned rows but few shaped — first-row keys: " +
          Object.keys(first).slice(0, 24).join(", "));
      }
    }

    await publish("sector:premium", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      readAt: new Date().toISOString(),
      refreshed: "nightly",
      vendorDated: false,
      basis: "SPDR Select Sector ETFs, not GICS index levels",

      units: {
        bullishPremiumUsd: "usd", bearishPremiumUsd: "usd",
        grossPremiumUsd: "usd", netPremiumUsd: "usd",
        leanRatio: "ratio", changeRatio: "ratio",
        callVolume: "contracts", putVolume: "contracts", stockVolume: "shares",
      },

      lean: {
        rank: "leanRatio",
        relation: "netPremiumUsd = bullishPremiumUsd - bearishPremiumUsd; " +
          "grossPremiumUsd = bullishPremiumUsd + bearishPremiumUsd; " +
          "leanRatio = netPremiumUsd / grossPremiumUsd",
        choice: true,
        rejected: "ranking the eleven on netPremiumUsd, which ranks them by " +
          "sector size: XLK clears three orders of magnitude more premium than " +
          "XLB on an ordinary day, so the dollar difference is dominated by the " +
          "basket rather than by the lean",
        undefinedAtZero: "leanRatio is null when grossPremiumUsd is 0 (0/0 is " +
          "undefined, not neutral); netPremiumUsd stays a visible measured 0",
      },

      notSameAs: "sector:trix — that key is TRIX on daily closes and contains " +
        "no option data; the two may disagree for weeks and neither is wrong",
      sectors,
      returned: wire.length,
      measured, quiet,
      unreadable: sectors.filter((s) => s.read === "unreadable").length,

      status: measured + quiet > 0 ? "ok" : (wire.length ? "unreadable" : "quiet"),
    });
    console.log(`  sector:premium: ${measured}/${SECTOR_ETFS.length} sectors leaned` +
      (quiet ? `, ${quiet} measured-and-empty` : "") +
      ` from ${wire.length} vendor row(s)`);
    for (const s of sectors) {
      if (s.reason) console.warn(`    ${s.sector} (${s.etf}): ${s.read} — ${s.reason}`);
    }
  } catch (error) {
    console.warn(`  sector:premium: ${error.message} — every key above published before this leg ran`);
  }

  try {
    const raw = DRY_RUN
      ? fakeNewsHeadlines((payloads.long.rows || []).map((r) => r.t))
      : await uw("/api/news/headlines", { limit: NEWS_VENDOR_LIMIT });
    const wire = unwrapVendorRows(raw);

    const news = shapeNews(raw, { requested: NEWS_VENDOR_LIMIT });

    if (news.status === "unreadable") {
      const first = wire[0];
      if (first && typeof first === "object") {
        console.log("  news: NOTE returned rows but none shaped — first-row keys: " +
          Object.keys(first).slice(0, 24).join(", "));
      }
    }

    await publish("news", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      readAt: new Date().toISOString(),
      refreshed: "nightly",

      cadence: "once per weekday morning at 05:15 America/New_York",
      staleBy: "the close",
      units: { returned: "rows", kept: "rows", shed: "rows", requested: "rows" },
      scope: "market-wide; `ticker` on this route is a filter on the same path, " +
        "so per-name news is a filter of `rows[].tickers` rather than a call",
      ...news,
    });
    console.log(`  news: ${news.kept} headline(s) kept of ${news.returned} returned` +
      (news.shed ? ` (${news.shed} shed by the ${NEWS_ROWS}-row cap)` : "") +
      (news.atVendorLimit
        ? ` — WHICH IS THE VENDOR'S MAXIMUM (${NEWS_VENDOR_LIMIT}), so the true ` +
          "population is unknown and at least that large"
        : "") +
      (news.unusable ? `, ${news.unusable} unusable` : "") +
      (news.undatedSeen
        ? `, ${news.undatedSeen} undated on the wire (${news.undatedKept} of them kept)`
        : "") +
      `; window ${news.oldest || "—"} .. ${news.newest || "—"}`);
  } catch (error) {
    console.warn(`  news: ${error.message} — every key above published before this leg ran`);
  }

  const probeResults = [];
  if (!DRY_RUN) {

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

  const onBoard = new Map();
  for (const d of deepNames(published)) onBoard.set(d.t, d.side);
  const byTicker = new Map(liquid.map((e) => [e.features.ticker, e]));
  const scoredByTicker = new Map(scored.map((r) => [r.ticker, r]));

  const congressByTicker = new Map();

  let congressRead = "not attempted";
  if (onBoard.size) {
    let marketWide = 0;
    try {

      const recent = DRY_RUN
        ? [...onBoard.keys()].flatMap((t) => fakeCongress(t))
        : await uw("/api/congress/recent-trades", { limit: 100 });

      const identity = (r) => `${(r && r.politician_id) || (r && r.name) || ""}|` +
        `${(r && r.ticker) || ""}|${(r && r.transaction_date) || ""}|` +
        `${(r && r.filed_at_date) || ""}|${(r && r.amounts) || ""}|${(r && r.mid_value) || ""}`;
      const merged = [];
      const seenFiling = new Set();
      for (const row of [...(politicalFilings || []), ...recent]) {
        const key = identity(row);
        if (seenFiling.has(key)) continue;
        seenFiling.add(key);
        merged.push(row);
      }
      marketWide = merged.length;

      congressRead = "ok";
      for (const row of merged) {
        const t = row && (row.ticker || row.symbol);
        if (!t || !onBoard.has(t)) continue;
        if (!congressByTicker.has(t)) congressByTicker.set(t, []);
        congressByTicker.get(t).push(row);
      }
      console.log(
        `  congress: ${merged.length} disclosure(s) market-wide ` +
        `(${recent.length} from this leg's own page` +
        (politicalFilings
          ? `, ${politicalFilings.length} joined from the political leg's ${POLITICAL_WINDOW_DAYS}-day ladder ` +
            `— the two windows are now one, so a card can no longer deny what /flows/political/ ranks`
          : `; the political ladder read nothing to join, so this card window is the shallow one`) +
        `), ${congressByTicker.size} of ${onBoard.size} board name(s) matched`);
    } catch (error) {
      congressRead = "failed";
      console.warn(`  congress: market-wide read failed — ${error.message}`);
    }

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

  const crossSectionTickers = [...byTicker.keys()].filter((t) => !onBoard.has(t));
  const cardedTickers = [...onBoard.keys()].concat(crossSectionTickers);

  const marketCross = indexMarketCross({
    oiChange: crossRaws ? crossRaws.oiChange : null,
    darkpool: crossRaws ? crossRaws.darkpool : null,
    limits: { oiChange: MARKET_CROSS_LIMIT, darkpool: MARKET_CROSS_LIMIT },
    tickers: cardedTickers,
    sessionDate,
  });
  for (const feed of CROSS_FEEDS) {
    const f = marketCross[feed];
    if (f.status !== "ok") {
      console.warn(`  cross ${feed}: ${f.status} — ${f.reason}`);
      continue;
    }
    console.log(
      `  cross ${feed}: ${f.coverage.in} of ${f.coverage.of} deep name(s) appear in ` +
      `${f.population} row(s) of ${f.requested} requested, covering ${f.names} name(s)` +

      (f.asOf
        ? `; the feed dates itself ${f.asOf}` +
          (f.sameSession === false ? ` — NOT this run's session (${sessionDate})` : "") +
          (f.asOfSessions > 1 ? ` and spans ${f.asOfSessions} sessions` : "")
        : "; the feed states no date of its own") +
      `; order ${f.ordered ? f.ordered + " by " + f.orderedBy : "not measurable from the rows"}`);
    if (f.coverage.of && f.coverage.in * 5 < f.coverage.of) {
      console.warn(
        `  cross ${feed}: this join reaches ${f.coverage.in} of ${f.coverage.of} deep names. ` +
        "The other cards will say they did not make a market-wide selection, which is true " +
        "of each of them and is not a finding about any of them.");
    }
  }

  let surfaceReported = false;
  const deadline = stats.startedAt + DEADLINE_MS;
  const cardTickers = [...onBoard.keys()];
  const cardLane = poolWidth(2);
  console.log(`  cards: ${cardTickers.length} name(s), ${cardLane.width} in flight — ${cardLane.why}`);
  const cardsRun = await runPooled(cardTickers, async (ticker, index) => {
    const e = byTicker.get(ticker);

    if (!e) return { status: "unenriched" };
    try {

      const surfaceExpiries = (e.raw.expiries || [])
        .map((r) => (r && r.expiry ? String(r.expiry).slice(0, 10) : null))
        .filter((d) => d && (!sessionDate || d >= sessionDate))
        .sort()
        .slice(0, SURFACE_EXPIRIES);

      const spotPx = num(e.row.close);

      const congress = congressByTicker.get(ticker)
        || (congressRead === "ok" ? [] : null);
      const [maxPain, surface, dpRaw, oiRaw, termRaw, rankRaw] = DRY_RUN
        ? [fakeMaxPain(ticker, spotPx), fakeSurface(ticker, spotPx, surfaceExpiries),
           fakeStockDarkpool(ticker, spotPx), fakeStockOiChange(ticker, spotPx),
           fakeTermStructure(ticker, spotPx), fakeIvRank(ticker, spotPx)]
        : await Promise.all([

          uw(`/api/stock/${ticker}/max-pain`, sessionDate ? { date: sessionDate } : {}).catch(() => []),

          surfaceExpiries.length
            ? uw(`/api/stock/${ticker}/spot-exposures/expiry-strike`, {
              "expirations[]": surfaceExpiries,
              ...(sessionDate ? { date: sessionDate } : {}),

              ...(spotPx >= 20
                ? { min_strike: Math.floor(spotPx * 0.75), max_strike: Math.ceil(spotPx * 1.25) }
                : {}),
              limit: 500,
            }).catch(() => [])
            : Promise.resolve([]),

          uw(`/api/darkpool/${ticker}`, { limit: 60 }).catch(() => null),
          uw(`/api/stock/${ticker}/oi-change`, { limit: 30 }).catch(() => null),
          uw(`/api/stock/${ticker}/volatility/term-structure`, {}).catch(() => null),
          uw(`/api/stock/${ticker}/iv-rank`, { limit: 70 }).catch(() => null),
        ]);

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
          console.log(`  surface: ${ticker} (board position ${index + 1}) ${rows.length} rows ` +
            `over ${surfaceExpiries.length} expiries`);
        }
      }

      const card = buildCard({
        ticker,
        row: e.row,
        features: { ...e.features, ...(scoredByTicker.get(ticker) || {}) },
        strikes: e.raw.strikes,
        ticks: e.raw.ticks,

        expiries: e.raw.expiries,
        surface,
        chain: chainByTicker.get(ticker) || null,

        scoreHistory: scoreTrack
          ? {
            sessions: scoreTrack.sessions,
            scores: (scoreTrack.names.find((n) => n && n.t === ticker) || {}).s,
            deadBand: scoreTrack.deadBand,

            premium: scoreTrackPremium ? scoreTrackPremium.get(ticker) : undefined,
          }
          : null,
        weights: first.weights || null,
        maxPain, congress, generatedAt, sessionDate,
        darkpool: dpRaw, oiDeltas: oiRaw, termStructure: termRaw, ivRank: rankRaw,

        marketCross,
      });

      const shed = [
        ["topContracts", "dropped to fit the payload cap — the day's most-traded contracts " +
          "are on the premium desk for this symbol"],
        ["aggressor", "dropped to fit the payload cap"],
        ["ivSurface", "dropped to fit the payload cap"],
        ["skewTerm", "dropped to fit the payload cap"],

        ["darkpool", "dropped to fit the payload cap"],
        ["oiDeltas", "dropped to fit the payload cap"],
        ["volContext", "dropped to fit the payload cap"],

        ["marketRank", "dropped to fit the payload cap — the market-wide feeds it joins are " +
          "published whole on the market pulse page"],
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

      if (body.length > 100 * 1024) {
        throw new Error(`card is ${(body.length / 1024).toFixed(0)}KB after shedding ` +
          `${dropped.length} panel(s), still over the ingest cap`);
      }
      await publish("card:" + ticker, card);

      return {
        status: "built",
        gamma: card.panels && card.panels.gamma && card.panels.gamma.status === "ok"
          ? card.panels.gamma.bars
          : null,

        garch: card.panels && card.panels.context && card.panels.context.status === "ok"
          && card.panels.context.garch
          ? card.panels.context.garch
          : null,
      };
    } catch (error) {

      console.warn(`  card ${ticker}: ${error.message}`);
      return { status: "failed" };
    }
  }, {
    width: cardLane.width,

    stopEarly: () => Date.now() > deadline,
  });

  const cards = foldCardOutcomes(cardTickers, cardsRun);
  const { built: cardsBuilt, failed: cardsFailed, skipped: cardsSkipped,
    unenriched, deadlineSkipped, gammaProfiles } = cards;

  const midOf = (xs) => {
    if (!xs.length) return null;
    const sorted = xs.slice().sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  };
  const fitTotal = cards.garchConverged + cards.garchUnconverged + cards.garchUnavailable;
  if (fitTotal > 0) {
    const nu = midOf(cards.garchNu);
    const per = midOf(cards.garchPersistence);
    console.log(
      "  " + (DRY_RUN ? "[dry-run] " : "") +
      `garch: ${cards.garchConverged} of ${fitTotal} fit(s) converged` +
      (cards.garchUnconverged
        ? `, ${cards.garchUnconverged} ran and did not settle` : "") +
      (cards.garchUnavailable
        ? `, ${cards.garchUnavailable} had too short a history to fit` : "") +
      (nu === null ? "" : `; median shape nu ${nu.toFixed(2)}` +
        ` (2 is the normal, equities sit below it)`) +
      (per === null ? "" : `, median persistence ${per.toFixed(3)}`) +

      (cards.garchConverged === 0 && fitTotal > 0
        ? " — NOT ONE FIT SETTLED, which is a fact about the model on this" +
          " cross-section and not about any one name"
        : ""),
    );
  }
  console.log(
    `cards: ${cardsBuilt}/${onBoard.size} built` +
    (cardsFailed ? `, ${cardsFailed} failed` : "") +

    (unenriched ? `, ${unenriched} with no enrichment row to build from` : "") +
    (deadlineSkipped
      ? `, ${deadlineSkipped} skipped past the ${DEADLINE_MS / 60000}min deadline`
      : ""),
  );

  let extraBuilt = 0, extraFailed = 0, extraSkipped = 0;
  {

    const extraTickers = crossSectionTickers;
    if (extraTickers.length) {
      const unfetched =
        "this name was measured in the run's cross-section but is not on today's board, " +
        "so the run did not spend the per-name vendor calls this panel needs — it was " +
        "never requested, rather than requested and refused, and reloading will not " +
        "produce it";
      const lane = poolWidth(2);
      console.log(`  cross-section cards: ${extraTickers.length} name(s) off the board, ` +
        `${lane.width} in flight — no vendor calls, the enrichment is already in hand`);
      const run = await runPooled(extraTickers, async (ticker) => {
        const e = byTicker.get(ticker);
        if (!e) return { status: "unenriched" };
        try {
          const card = buildCard({
            ticker,
            row: e.row,
            features: { ...e.features, ...(scoredByTicker.get(ticker) || {}) },
            strikes: e.raw.strikes,
            ticks: e.raw.ticks,
            expiries: e.raw.expiries,

            surface: null, chain: null, maxPain: null, congress: null,
            darkpool: null, oiDeltas: null, termStructure: null, ivRank: null,
            scoreHistory: scoreTrack
              ? {
                sessions: scoreTrack.sessions,
                scores: (scoreTrack.names.find((n) => n && n.t === ticker) || {}).s,
                deadBand: scoreTrack.deadBand,
                premium: scoreTrackPremium ? scoreTrackPremium.get(ticker) : undefined,
              }
              : null,
            weights: first.weights || null,
            generatedAt, sessionDate,
            marketCross,
            unfetched,
          });
          const body = JSON.stringify(card);

          if (body.length > 100 * 1024) {
            throw new Error(`cross-section card is ${(body.length / 1024).toFixed(0)}KB, over the ingest cap`);
          }
          await publish("card:" + ticker, card);
          return { status: "built" };
        } catch (error) {
          console.warn(`  cross-section card ${ticker}: ${error.message}`);
          return { status: "failed" };
        }
      }, {
        width: lane.width,
        stopEarly: () => Date.now() > deadline,
      });
      for (let i = 0; i < extraTickers.length; i++) {
        const r = run.results[i];
        if (!r) extraSkipped++;
        else if (r.status === "built") extraBuilt++;
        else if (r.status === "failed") extraFailed++;
        else extraSkipped++;
      }
      console.log(
        `  cross-section cards: ${extraBuilt}/${extraTickers.length} built` +
        (extraFailed ? `, ${extraFailed} failed` : "") +
        (extraSkipped ? `, ${extraSkipped} skipped past the deadline` : "") +
        ` — ${cardsBuilt + extraBuilt} name(s) now carry a card for this session`);
    }
  }

  console.log("  " + (DRY_RUN ? "[dry-run] " : "") + describeGammaRange(gammaProfiles).line +
    (DRY_RUN
      ? " ON SYNTHETIC ROWS THIS SETTLES NOTHING: the fixture spans about 1.7" +
        " orders of magnitude, so it does not exhibit the problem symlog exists" +
        " to solve. Only a live run answers this."
      : ""));

  const pruned = await prunePromise;
  if (pruned === null) console.warn("  prune: the sweep did not complete this run");

  try {
    await publish("meta", {
      generatedAt, sessionDate,
      universe: universe.length,
      enriched: enriched.length,
      liquid: liquid.length,
      cardsBuilt, cardsFailed, cardsSkipped,

      crossSectionCards: extraBuilt,
      cardsTotal: cardsBuilt + extraBuilt,
      apiCalls: stats.calls,

      probes: probeResults,
    });
  } catch (error) {
    console.warn(`  meta: ${error.message}`);
  }

  try {
    const { buildBrief, briefStoreFrom } = await import("../shared/flows-brief.js");
    const { buildFactIndex } = await import("../shared/flows-ask.js");
    const { assess, assessStoreFrom } = await import("../shared/flows-warnings.js");

    const index = buildFactIndex(publishedStore);

    const alarm = assess(assessStoreFrom(publishedStore));
    if (alarm.warnings.length) {
      console.log(`  warnings: ${alarm.warnings.length} raised from ${alarm.checked} checks that could run`);
      for (const w of alarm.warnings) console.log(`    [${w.severity}] ${w.say}`);
    } else {
      console.log(`  warnings: none, from ${alarm.checked} checks that could run`);
    }

    const BRIEF_BYTE_BUDGET = 120 * 1024;
    const { shedCardFacts } = await import("../shared/flows-ask.js");
    const base = {
      generatedAt, sessionDate,
      ...buildBrief(briefStoreFrom(publishedStore)),
      silences: index.silences,
      warnings: alarm.warnings,
      warningsChecked: alarm.checked,

      warningsQuestions: alarm.questions,
    };
    const over = (facts) => JSON.stringify({ ...base, facts }).length - BRIEF_BYTE_BUDGET;
    const shed = shedCardFacts(index.facts, index.cardNames || [], over);
    const cardCount = shed.facts.filter((f) => typeof f.source === "string" && f.source.startsWith("card:")).length;
    console.log(`  brief: ${shed.facts.length} facts, ${cardCount} of them per-name over ` +
      `${shed.namesIndexed.indexed} of ${shed.namesIndexed.of} carded names` +
      (shed.namesIndexed.shed ? ` (${shed.namesIndexed.shed} shed to stay under ${BRIEF_BYTE_BUDGET} bytes)` : ""));
    await publish("brief", { ...base, facts: shed.facts, namesIndexed: shed.namesIndexed });
  } catch (error) {
    console.warn(`  brief: ${error.message}`);
  }

  const elapsed = (Date.now() - stats.startedAt) / 1000;
  console.log(
    `\ndone in ${elapsed.toFixed(1)}s — ${stats.calls} API calls` +
    `, ${stats.retries} retries, ${stats.rateLimited} rate-limited` +
    `, achieved ${(stats.calls / Math.max(elapsed, 1)).toFixed(2)} req/s` +
    ` (final inter-call delay ${Math.round(delayMs)}ms` +

    `, learned floor ${Math.round(delayFloorMs)}ms` +
    (delayFloorMs > RATE.minDelayMs ? "" : ", never raised") + ")",
  );
  console.log("Record the achieved rate: the vendor documents no limit, so this is how the real one gets discovered.");

  if (stats.calls > CALL_BUDGET) {
    const over = stats.calls - CALL_BUDGET;
    console.warn(
      `BUDGET: ${stats.calls} attempts against a modelled budget of ${CALL_BUDGET} — ` +
      `${over} over (${((over / CALL_BUDGET) * 100).toFixed(1)}%). ` +
      `${stats.rateLimited} of those attempts were 429 retries rather than distinct calls. ` +
      "The budget is what DEADLINE_MS was sized against; a run that exceeds it is " +
      "spending time the chain and card legs were promised.",
    );
  }

  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  if (!stats.calls) {

    console.log(
      "wall clock: no vendor call was made, so queueing, wire time and backoff were not " +
      "measured this run — these are absent readings rather than zero ones, and nothing " +
      "about the floor can be concluded from them.");
  } else {
    console.log(
      `wall clock over ${secs(elapsed * 1000)} elapsed, summed per caller: ` +
      `queued ${secs(stats.permitWaitMs)}` +
      ` | wire ${secs(stats.networkMs)}` +
      ` | refused ${secs(stats.rateLimitWaitMs)}` +
      ` (the queue itself was pushed back ${secs(stats.rateLimitQueueMs)}, which is the ` +
      `run-seconds the refusals actually cost)` +
      ` | peak in flight ${permits.stats().peakInFlight}` +
      ` | per call: ${Math.round(stats.permitWaitMs / stats.calls)}ms queued, ` +
      `${Math.round(stats.networkMs / stats.calls)}ms wire`);
  }
  if (stats.networkMs > 0 && permits.stats().peakInFlight <= 1) {
    console.log(
      "  peak in flight was 1, so no round trip ever overlapped another: the vendor answers " +
      "faster than the floor issues permits. That is the expected shape at a high floor and it " +
      "means the saving here is the serial delay+network stacking, not concurrency.");
  }

  const verdict = describeFloorVerdict(stats);
  if (verdict) console.log("  " + verdict);
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

  fakeSectorEtfs, fakeNewsHeadlines,
  MOVER_ROWS, moverRow, buildMovers,
  describeTickFields, TICK_FIELDS_READ, CHAIN_RESERVE_MS, republishWithChain,
  archiveDatedBoards,

  PUBLISH_RETRYABLE,
  runPooled, poolWidth, describeFloorVerdict, POOL_MAX_WIDTH, POOL_EVIDENCE_MIN,
  POOL_REFUSAL_HALT, POOL_REFUSAL_EASE,
  unusualContractId, markNewContracts, priorNote, fakePriorUnusual,
  PUBLISH_SPACING_MS,
};

const invokedDirectly = process.argv[1]
  && (await import("node:url")).fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((error) => {
    console.error("pipeline failed:", error.message);
    process.exit(1);
  });
}
