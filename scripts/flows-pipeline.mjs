#!/usr/bin/env node

import { nextTradingDay, priorTradingDays } from "../shared/flows-freshness.js";
import {
  num, percentileRank, pearson, SCORE_SCALE, HORIZON_SESSIONS, callGammaLeg, putGammaLeg,
} from "../shared/flows-features.js";
import {
  vannaScale, chainCallVanna, blackScholesGreeks, variation, variationSummary,
} from "../shared/flows-variation.js";
import { buildCard, SURFACE_EXPIRIES, indexMarketCross, CROSS_FEEDS } from "../shared/flows-card.js";
import { tradingCalendar, scoreSessions, icTable, RECORD_NOTES } from "../shared/flows-record.js";
import { evaluateConviction, CONVICTION_LABELS } from "../shared/flows-conviction.js";
import { runFlowLeg } from "./flows-legs/flow.mjs";
import { makeFlowFakeVendor, makeFlowFakeStore } from "./flows-legs/flow-fake.mjs";
import { sessionPrints, sessionPrintParams } from "../shared/flows-positioning.js";
import { buildChainPanels, CHAIN_PAGE_SIZE, CHAIN_MAX_PAGES, mergeChainPages, SKEW_MIN_DAYS, summariseSkewMisses }
  from "../shared/flows-chain.js";
import {
  rankUnusual, rankUnusualNames, describeOiBasis, poolOiBasis,
  UA_MIN_VOLUME, UA_MIN_OI, UNUSUAL_NOTES,
} from "../shared/flows-unusual.js";
import { activityBasis } from "../shared/flows-activity.js";
import { readActivity, activityEnabled } from "./flows-legs/activity.mjs";
import { buildEvents, EVENTS_NOTES } from "../shared/flows-events.js";
import { scoresRows, buildScoreTrack, boardsToScoreRows } from "../shared/flows-scores.js";
import { buildFlowAlerts, ALERT_ROWS, alertBand, nightlyAlerts } from "../shared/flows-alerts.js";
import { buildPulse, PULSE_FEEDS, PULSE_CAPS } from "../shared/flows-pulse.js";
import {

  buildPolitical, POLITICAL_FEEDS, unwrapRows as unwrapVendorRows,
} from "../shared/flows-political.js";
import { parseOptionSymbol } from "../shared/flows-premium.js";
import { black76 } from "../shared/flows-quant-bs.js";
import { regimeState } from "../shared/flows-neuron.js";
import { neuronCoverage, cardTier } from "../shared/flows-neuron-coverage.js";
import * as QP from "./flows-quant-pipeline.mjs";
import { marketAggregate, MARKET_NOTES } from "../shared/flows-market.js";
import {
  capBands, selectCoverage, NDX_100, NDX_AS_OF, SELECTION_EPOCH, UNIVERSE_NOTES,
  PICK_SIZE, PICK_INDEX, ndxConstantAge, priorLedger, retirePlan, buildRoster, RETIRE_AFTER_SESSIONS,
  rosterKeyTicker,
} from "../shared/flows-universe.js";
import {
  MAG7 as FOCUS_MAG7, FOCUS_FUNDS, FOCUS_MINERS, ndx10, ndxMembership, focusDeepSet, focusTickers, focusGroups,
  focusCloses, FOCUS_BUDGET_BYTES,
} from "../shared/flows-focus.js";
import { buildFocusPayload } from "./flows-legs/focus.mjs";
import { runVolLeg, volNames, attachVol, publishVol, coneThinOf } from "./flows-legs/vol.mjs";
import { fakeVolVendor } from "./flows-legs/vol-fake.mjs";
import {
  harvestScreener, INDEX_TICKERS, readFocusRows, fetchMissingMembers, readHoldings, withPrefetched,
} from "./flows-legs/universe.mjs";
import { runMarketLegs, windowTickersOf, totalsHistory } from "./flows-legs/market.mjs";
import { makeFakeVendor } from "./flows-legs/fake-vendor.mjs";
import { makeCardXStore, publishCardX } from "./flows-legs/card-x.mjs";
import { buildIndexDossiers, dossierRoster } from "./flows-legs/index-dossier.mjs";
import {
  runLive, runLiveLoop, chainDispatch, chainWithRetry, dryLiveTicks, readHeldAlerts, readLiveClock, LIVE_READ_PACE_MS,
  passOutcome, liveRunVerdict,
} from "./flows-legs/live.mjs";
import { createWatch, witnessDrill } from "./flows-legs/watch.mjs";
import { dryLiveDay } from "./flows-legs/live-day.mjs";
import { runHealthGate, republishRepair } from "./flows-legs/health.mjs";
import { reportHealth } from "./flows-legs/witness.mjs";
import { stampNow, stampPinned } from "./flows-legs/stamp.mjs";
import { DRY_RUN, LIVE_MODE } from "./flows-nightly/flags.mjs";
import { createStageRunner, healthRecord } from "./flows-nightly/stages.mjs";
import {
  ALERT_VENDOR_LIMIT, CALL_BUDGET, CALL_OVERRUN_MARGIN, CHAIN_RESERVE_MS, DEADLINE_MS, DEEP_RULE, EARNINGS_GATE_DAYS,
  IV_RANK_PARAMS, MARKET_CROSS_LIMIT, NEWS_VENDOR_LIMIT, RATE, SCREENER_PAGE_ROWS, SCREENER_SPLIT_DEPTH, UNIVERSE,
  callModel, deepNames,
} from "./flows-nightly/vendor-params.mjs";
import {
  delayFloorMs, delayMs, describeFloorVerdict, foldCardOutcomes, permits, poolWidth, raiseReadPace, runPooled, sleep,
  stats, uw, vendorTimeoutMs, wireProgress,
} from "./flows-nightly/vendor.mjs";
import {
  ARCHIVE_DATE_RE, ARCHIVE_RETENTION_DAYS, LEDGER_LIST_KINDS, bindStages, datedKey, edgeSnapshot, ingestURL,
  landedKeys, listStored, liveCredentialSource, probeStored, pruneArchive, publish, publishedStore, readSaid,
  readStored, readStoredOnce, resetPublishRetryBudget, retire, retireSession, sessionArchiveKeys,
} from "./flows-nightly/store.mjs";
import {
  PIPELINE_CADENCE, closedPriceWindow, easternDayOf, easternNow, intradayRefusal, readDayOf, sessionBarOverdue,
} from "./flows-nightly/clock.mjs";
import {
  BOARD_SCHEMA_VERSION, GATED_LIQUIDITY_MARGIN, MOVER_ROWS, NEWS_ROWS, SECTOR_ETFS, TRIX_FULL_SCALE_BP, TRIX_SERIES,
  TRIX_SPAN, TRIX_WARMUP, boardVariationMeta, buildMovers, candleCut, candleDate, candlesAscending,
  collapseShareClasses, computeFeatures, congressRows, daysToEarnings, eligible, enrich, featuresVariationInput,
  gatedWorthEnriching, holdersRefusal, ideasPayload, markNewContracts, measureVariationProbes, netPremiumOf, onWire,
  partitionSides, priorNote, readPxOf, repairCandles, scoreBoard, screenerTilt, sectorLean, sectorTrix,
  sessionCandles, sessionRow, sessionRows, shapeNews, toRows, toWatchRows, variationOptions,
} from "./flows-nightly/rank.mjs";

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

export function judgeEndDate(rows, sessionDate) {
  const list = Array.isArray(rows) ? rows : [];
  const dates = list.map(candleDate).filter(Boolean).sort();
  const latest = dates.length ? dates[dates.length - 1] : null;
  const dated = ARCHIVE_DATE_RE.test(String(sessionDate || ""));
  return {
    send: list.length > 0,
    honoured: latest === null || !dated ? null : latest <= sessionDate,
    latest,
    past: dated ? dates.filter((d) => d > sessionDate).length : 0,
  };
}

const SCREENER_READ_KEYS = ["close", "marketcap", "call_volume", "put_volume"];

export function judgeScreenerDate(dated, undated) {
  const a = unwrapVendorRows(dated);
  const b = unwrapVendorRows(undated);
  if (!a.length) {
    return b.length
      ? { date: false, reason: `the dated probe returned no rows while the undated one returned ${b.length}` }
      : { date: true, reason: "neither probe returned rows, so the dated read is kept as the one correct by construction" };
  }
  const first = a[0] && typeof a[0] === "object" ? a[0] : {};
  const missing = SCREENER_READ_KEYS.filter((k) => !onWire(first[k]));
  if (missing.length) {
    return { date: false, reason: `the dated probe's first row carries no ${missing.join(", ")}` };
  }
  return { date: true, reason: `the dated probe returned ${a.length} readable row(s)` };
}

export async function sweepScreenerBand([min, max], readBand, {
  depth = SCREENER_SPLIT_DEPTH, pageRows = SCREENER_PAGE_ROWS,
} = {}) {
  const byTicker = new Map();
  const unnamed = [];
  const keep = (list) => {
    for (const row of list) {
      if (row && row.ticker) byTicker.set(row.ticker, row);
      else unnamed.push(row);
    }
  };
  const leaves = [];
  let reads = 0;
  const walk = async (lo, hi, level) => {
    reads++;
    const page = await readBand(lo, hi);
    const list = Array.isArray(page) ? page : [];
    const full = list.length >= pageRows;
    keep(list);
    if (!full || level >= depth) {
      leaves.push({ min: lo, max: hi, rows: list.length, truncated: full, level });
      return;
    }
    const mid = hi === null ? lo * 2 : Math.sqrt(lo * hi);
    await walk(lo, mid, level + 1);
    await walk(mid, hi, level + 1);
  };
  await walk(min, max, 0);
  return { rows: [...byTicker.values(), ...unnamed], leaves, reads,
    truncated: leaves.filter((l) => l.truncated).length, split: reads > 1 };
}

const SCREENER_PROBE = Object.freeze({
  min_underlying_price: 5, min_volume: 1000, min_oi: 5000, min_marketcap: 5e11,
});

export async function verifyDating(sessionDate, { read = uw } = {}) {
  if (!sessionDate || DRY_RUN) {
    return { date: !!sessionDate, endDate: !!sessionDate, endDateHonoured: null,
      endDateLatest: null, screenerDate: !!sessionDate, screenerReason: null };
  }

  const usable = (rows) => (rows || []).some(
    (r) => r && r.expiry && (num(callGammaLeg(r)) !== 0 || num(putGammaLeg(r)) !== 0));

  const PROBE = "AAPL";

  const [dated, undated, capped, screenDated, screenUndated] = await Promise.all([
    read(`/api/stock/${PROBE}/greek-exposure/expiry`, { date: sessionDate }).catch(() => []),
    read(`/api/stock/${PROBE}/greek-exposure/expiry`).catch(() => []),
    read(`/api/stock/${PROBE}/ohlc/1d`, { timeframe: "1M", end_date: sessionDate }).catch(() => []),
    read("/api/screener/stocks", { ...SCREENER_PROBE, date: sessionDate }).catch(() => []),
    read("/api/screener/stocks", SCREENER_PROBE).catch(() => []),
  ]);

  const date = usable(dated) || !usable(undated);
  const cap = judgeEndDate(capped, sessionDate);
  const endDate = cap.send;
  const screener = judgeScreenerDate(screenDated, screenUndated);

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
      "dropping `end_date` for this run. Every candle series is still cut at " +
      `${sessionDate} locally before any feature reads it.`);
  } else if (cap.honoured === false) {
    console.warn(
      `WARNING: /ohlc/1d?end_date=${sessionDate} returned ${cap.past} bar(s) dated after ` +
      `the session for ${PROBE} (latest ${cap.latest}) — the vendor does NOT honour ` +
      "end_date on this read. The parameter is kept, since it costs nothing, and every " +
      `candle series is cut at ${sessionDate} locally before any feature reads it.`);
  }
  if (!screener.date) {
    console.warn(
      `WARNING: /screener/stocks?date=${sessionDate} is not usable — ${screener.reason}. ` +
      "Dropping `date` from the screener for this run, so its volumes and prices are " +
      "whatever the vendor holds at read time.");
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

  return { date, endDate, endDateHonoured: cap.honoured, endDateLatest: cap.latest,
    screenerDate: screener.date, screenerReason: screener.reason };
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

export function vannaProbeSample(ticker, { rows, expiry, sessionDate, expiries, spot }) {
  const exp = expiry || nearestProbeExpiry(expiries, { asOf: sessionDate, minDays: SKEW_MIN_DAYS });
  if (!exp || !sessionDate) return null;
  const chainRows = DRY_RUN
    ? (fakeLadders.has(ticker) ? fakeLadderChain(fakeLadders.get(ticker), exp) : null)
    : rows;
  if (!Array.isArray(chainRows) || !chainRows.length) return null;
  const vendorRow = (expiries || []).find((r) => r && String(r.expiry || "").slice(0, 10) === exp);
  const vendor = vendorRow ? num(vendorRow.call_vanna ?? vendorRow.call_vex, NaN) : NaN;
  if (!Number.isFinite(vendor)) return null;
  const parsed = [];
  for (const r of chainRows) {
    const p = r ? parseOptionSymbol(r.option_symbol) : null;
    if (!p) continue;
    parsed.push({ type: p.type, strike: p.strike, expiry: p.expiry,
      iv: num(r.implied_volatility, NaN), oi: num(r.open_interest, NaN) });
  }
  const model = chainCallVanna(parsed, { spot, asOf: sessionDate, expiry: exp });
  if (!model) return null;
  return { ticker, expiry: exp, vendor, model: model.value, contracts: model.contracts, spot: num(spot, null) };
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

export const MEMORY_ARCHIVE_SESSIONS = 10;

const MEMORY_FALLS_BACK = new Set(["unavailable", "same-session", "ahead"]);

export async function resolveBoardMemory(side, sessionDate, {
  reader = readStored, sessions = MEMORY_ARCHIVE_SESSIONS,
} = {}) {
  const read = await reader("board:" + side);
  const memory = readBoardMemory(read, sessionDate);
  if (!MEMORY_FALLS_BACK.has(memory.status) || !ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    return { ...memory, source: "live", key: "board:" + side };
  }
  const why = memory.status === "same-session"
    ? `the live board:${side} is this session's own earlier output`
    : memory.status === "ahead"
      ? `the live board:${side} is stamped a later session (${memory.sessionDate})`
      : read && read.absent
        ? `no board is published under board:${side}`
        : `the live board:${side} could not be read` +
          (read && read.status ? ` (the store answered ${read.status})` : "");
  let failures = 0;
  for (const day of priorTradingDays(sessionDate, sessions, null)) {
    const key = `board:${side}:${day}`;
    const stored = await reader(key);
    if (stored && stored.failed) { failures++; continue; }
    if (!stored || stored.absent || !stored.payload) continue;
    const archived = readBoardMemory(stored, sessionDate);
    if (archived.status !== "ok" && archived.status !== "quiet") continue;
    return {
      ...archived, source: "archive", key,
      note: `${archived.note} It was read from the dated archive (${key}) because ${why}.`,
    };
  }
  return {
    ...memory, source: "live", key: "board:" + side,
    note: `${memory.note} The dated archive was searched back ${sessions} sessions for an ` +
      `earlier board:${side} as well, and ` +
      (failures
        ? `${failures} of those reads failed, so an earlier board may exist that this run could not see.`
        : "held none."),
  };
}

export function sameSessionGate({ sessionDate, archive = null, republish = false } = {}) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    return { mode: "fresh", skip: false, generatedAt: null,
      note: "no session date, so there is no dated archive to check against" };
  }
  const keys = sessionArchiveKeys(sessionDate);
  const readOf = (key) => (archive && archive[key]) || null;
  const isHeld = (r) => Boolean(r && !r.failed && !r.absent && r.payload);
  const held = keys.filter((k) => isHeld(readOf(k)));
  const failed = keys.filter((k) => readOf(k) && readOf(k).failed);
  const absent = keys.filter((k) => !held.includes(k) && !failed.includes(k));
  const scores = readOf(`scores:${sessionDate}`);
  const at = isHeld(scores) && typeof scores.payload.generatedAt === "string"
    ? scores.payload.generatedAt : null;
  const list = (ks) => ks.join(", ");
  const are = (ks) => (ks.length === 1 ? "is" : "are");
  const unread = failed.length
    ? `${list(failed)} could not be read (the store answered ` +
      `${failed.map((k) => readOf(k).status || "nothing").join(", ")})`
    : "";
  if (republish) {
    return { mode: "republish", skip: false, generatedAt: at,
      note: (held.length
        ? `${list(held)} ${are(held)} archived` + (at ? ` (scores written ${at})` : "")
        : `scores:${sessionDate} ` + (failed.includes(`scores:${sessionDate}`)
          ? "could not be read" + (scores.status ? ` (the store answered ${scores.status})` : "")
          : "is not archived")) +
        ", and republish_session is set, so this run deletes whatever dated key the session " +
        "holds before it rewrites all three together with the live boards, scores, record and " +
        "cards — a board left behind by an earlier run whose scores write was lost would " +
        "otherwise refuse the rewrite and split the archive from the live board again" };
  }
  if (held.length && absent.length) {
    return { mode: "partial", skip: true, generatedAt: at,
      note: `${list(held)} ${are(held)} archived but ${list(absent)} ${are(absent)} not, so an ` +
        "earlier run of this session ranked it and part of its archive was lost. A plain run " +
        "cannot repair that: the dated keys are immutable, so a second ranking would go live " +
        "while the archive kept part of the first. The ranked leg is skipped and the run " +
        "exits non-zero. Dispatch with republish_session to rewrite the session's three keys " +
        "together." };
  }
  if (held.length) {
    return { mode: "archived", skip: true, generatedAt: at,
      note: (failed.length
        ? `${list(held)} ${are(held)} archived and ${unread}, so the archive may be incomplete`
        : `scores:${sessionDate} is already archived (written ${at || "at an unstamped time"}) ` +
          "with both dated boards") +
        ", so this run is a second run against one session. The ranked leg — boards, scores, " +
        "score track, record, brief and cards — is skipped: a second ranking would go live " +
        "while the archive kept the first, and the record would grade a board no reader " +
        "saw. Only the unranked market feeds are refreshed. Dispatch with " +
        "republish_session to rewrite the session instead." };
  }
  if (failed.length) {
    return { mode: "unverified", skip: false, generatedAt: null,
      note: `${unread}, so whether this session is already archived is unknown. Proceeding: a ` +
        "refused dated write is reported below, and a missed session cannot be recovered later" };
  }
  return { mode: "fresh", skip: false, generatedAt: null,
    note: `none of ${list(keys)} is archived, so this is the session's first run` };
}

async function fetchStoredPayload(key) {
  return (await readStored(key)).payload;
}

const RECORD_HORIZONS = [1, 5, 10, 21];
const RECORD_IC_MIN_N = 20;
const RECORD_MAX_SESSIONS = 30;

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
      let read = await readStored(key, { retries: 0 });

      if (read.failed) {
        await sleep(ARCHIVE_READ_RETRY_MS);
        const again = await readStored(key, { retries: 0 });
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
        else {
          boards.push({ d, side: what, rows: stored.rows,
            generatedAt: typeof stored.generatedAt === "string" ? stored.generatedAt : null });
        }
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

export function buildRecordCloses(enriched, datedBoards, sessionDate) {
  const closes = new Map();
  const bounded = ARCHIVE_DATE_RE.test(String(sessionDate || ""));
  const put = (t, d, c) => {
    const v = num(c);
    if (!t || !d || !(v > 0)) return;
    if (bounded && d > sessionDate) return;
    if (!closes.has(t)) closes.set(t, new Map());
    closes.get(t).set(d, v);
  };
  let boardPx = 0, boardPxRefused = 0;
  for (const b of datedBoards) {
    if (!closedPriceWindow(b.generatedAt, b.d)) {
      boardPxRefused += (b.rows || []).length;
      continue;
    }
    for (const row of b.rows || []) { put(row.t, b.d, row && row.px); boardPx++; }
  }
  for (const e of enriched) {
    for (const c of sessionCandles(e.raw.ohlc, sessionDate)) put(e.row.ticker, candleDate(c), c.close);
  }
  Object.defineProperty(closes, "sources", {
    value: { boardPx, boardPxRefused }, enumerable: false,
  });
  return closes;
}

export function recordCalendar(enriched, datedBoards, sessionDate) {
  return tradingCalendar([
    ...enriched.map((e) => sessionCandles(e.raw.ohlc, sessionDate).map(candleDate)),
    datedBoards.map((b) => b.d),
    ARCHIVE_DATE_RE.test(String(sessionDate || "")) ? [sessionDate] : [],
  ]).filter((d) => !ARCHIVE_DATE_RE.test(String(sessionDate || "")) || d <= sessionDate);
}

function buildRecordBreaks(enriched) {
  const breaks = new Map();
  for (const e of enriched) {
    const dates = ((e.features && e.features.priceBreaks) || [])
      .map((b) => b && b.date).filter((d) => typeof d === "string" && d.length === 10);
    if (dates.length) breaks.set(e.row.ticker, dates);
  }
  return breaks;
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

async function republishWithChain(payloads, chainByTicker, sessionDate, publishFn, refresh = null,
  meta = undefined) {
  const lines = [];
  for (const side of ["long", "short"]) {
    const payload = payloads[side];
    if (!payload || !Array.isArray(payload.rows)) continue;
    const metaBefore = JSON.stringify(payload.variation ?? null);
    if (meta !== undefined) payload.variation = meta;
    const metaMoved = JSON.stringify(payload.variation ?? null) !== metaBefore;
    let merged = 0, refreshed = 0;
    for (const row of payload.rows) {
      if (typeof refresh === "function") {
        const before = JSON.stringify(row.variation ?? null);
        if (refresh(row) && JSON.stringify(row.variation ?? null) !== before) refreshed++;
      }
      const c = chainByTicker.get(row.t);
      if (!c) continue;

      row.skew = c.scalars.skew;
      row.term = c.scalars.term;
      row.atmIv = c.scalars.atmIv;

      row.skewDays = c.scalars.skewDays;
      merged++;
    }
    if (!merged && !refreshed && !metaMoved) continue;

    const key = datedKey(side, sessionDate);

    if (!key) {
      lines.push(`  re-publish board:${side}: SKIPPED — the session date ` +
        `${JSON.stringify(sessionDate)} is not an archive date, so the dated copy ` +
        `cannot be written and the live board is left as the store already has it, ` +
        `rather than gaining columns its own archive will never carry`);
      continue;
    }

    try {
      await publishFn(key, payload);
    } catch (error) {
      lines.push(error && error.status === 409
        ? `  archive ${key}: ALREADY HOLDS this session (409) — an earlier run wrote it and ` +
          "the archive keeps the first. This run's board still goes live below; dispatch " +
          "with republish_session to rewrite both together"
        : `  archive ${key}: NOT WRITTEN — ${error.message}. The end-of-run check writes it ` +
          "again from this same payload; if that fails too the run says the archive is lost");
    }

    try {
      await publishFn("board:" + side, payload);
      lines.push(`  re-published board:${side} with chain columns on ${merged} row(s)` +
        (refreshed ? `, variation re-measured on ${refreshed}` : "") +
        (metaMoved ? ", and the board's measured variation block" : ""));
    } catch (error) {
      lines.push(`  re-publish ${side}: ${error.message} — the store keeps the pre-chain board`);
    }
  }
  return lines;
}

export function plainRedispatchSaid(report) {
  return (report || []).some((a) => a && a.state !== "lost")
    ? "a plain re-dispatch finds the session partly archived and skips it"
    : "this run confirmed none of the session's keys, so a plain re-dispatch ranks it " +
      "again unless the store holds one this run could not read";
}

export async function ensureArchived(payloadsByKey, { landed, reader = readStored, write }) {
  const report = [];
  for (const [key, payload] of Object.entries(payloadsByKey)) {
    if (!payload) continue;
    if (landed.has(key)) { report.push({ key, state: "written" }); continue; }
    const read = await reader(key);
    if (read && !read.failed && !read.absent && read.payload) {
      report.push({ key, state: "held" });
      continue;
    }
    try {
      await write(key, payload);
      report.push({ key, state: "repaired" });
    } catch (error) {
      report.push({ key, state: error && error.status === 409 ? "held" : "lost",
        detail: error && error.message ? error.message : String(error) });
    }
  }
  return report;
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

export const DRY_FOCUS_ROWS = Object.freeze([
  ["NVDA", 186.2, 4.4e12, "Technology", "NVIDIA Corporation"],
  ["AAPL", 254.1, 3.8e12, "Technology", "Apple Inc."],
  ["MSFT", 509.9, 3.7e12, "Technology", "Microsoft Corporation"],
  ["AMZN", 221.4, 2.4e12, "Consumer Cyclical", "Amazon.com, Inc."],
  ["GOOGL", 342.48, 2.0e12, "Technology", "Alphabet Inc. Class A"],
  ["GOOG", 338.97, 1.88e12, "Technology", "Alphabet Inc. Class C"],
  ["META", 742.3, 1.85e12, "Technology", "Meta Platforms, Inc."],
  ["TSLA", 438.7, 1.4e12, "Consumer Cyclical", "Tesla, Inc."],
  ["AVGO", 339.5, 1.6e12, "Technology", "Broadcom Inc."],
  ["MU", 1076.6, 1.2e12, "Technology", "Micron Technology, Inc.", 5],
  ["COST", 931.2, 4.1e11, "Consumer Cyclical", "Costco Wholesale Corporation"],
  ["NFLX", 1210.4, 5.1e11, "Technology", "Netflix, Inc."],
  ["NEM", 121.285, 1.28e11, "Basic Materials", "Newmont Corporation"],
  ["AEM", 193.71, 9.69e10, "Basic Materials", "Agnico Eagle Mines Limited"],
  ["PAAS", 47.505, 5.05e8, "Basic Materials", "Pan American Silver Corp."],
  ["WPM", 143.99, 6.54e10, "Basic Materials", "Wheaton Precious Metals Corp."],
  ["FCX", 72.045, 1.03e11, "Basic Materials", "Freeport-McMoRan Inc."],
  ["SCCO", 201.39, 1.68e11, "Basic Materials", "Southern Copper Corporation"],
].map((r) => Object.freeze(r)));

function fakeFocusRows() {
  const gateOrigin = nextTradingDay(DRY_SESSION_DATE, null);
  const rnd = mulberry(20260925);
  return DRY_FOCUS_ROWS.map(([ticker, price, cap, sector, name, earnIn]) => {
    const callVol = Math.round(20000 + rnd() * 900000);
    const putVol = Math.round(15000 + rnd() * 700000);
    const bull = rnd() * 6e7;
    const bear = rnd() * 6e7;
    const iv = 0.2 + rnd() * 0.35;
    return {
      ticker, full_name: name, close: price.toFixed(2), prev_close: (price * (0.97 + rnd() * 0.06)).toFixed(2),
      marketcap: String(Math.round(cap)), sector, issue_type: "Common Stock", is_index: false,
      call_volume: callVol, put_volume: putVol,
      call_open_interest: Math.round(200000 + rnd() * 3e6), put_open_interest: Math.round(180000 + rnd() * 2e6),
      prev_call_oi: Math.round(200000 + rnd() * 3e6), prev_put_oi: Math.round(180000 + rnd() * 2e6),
      total_open_interest: Math.round(500000 + rnd() * 5e6),
      avg_30_day_call_volume: String(Math.round(callVol * (0.5 + rnd()))),
      avg_30_day_put_volume: String(Math.round(putVol * (0.5 + rnd()))),
      bullish_premium: String(Math.round(bull)), bearish_premium: String(Math.round(bear)),
      net_call_premium: String(Math.round((rnd() - 0.5) * 6e7)), net_put_premium: String(Math.round((rnd() - 0.5) * 4e7)),
      call_premium: String(Math.round(bull + rnd() * 2e7)), put_premium: String(Math.round(bear + rnd() * 2e7)),
      call_volume_ask_side: Math.round(callVol * (0.3 + rnd() * 0.4)), call_volume_bid_side: Math.round(callVol * (0.3 + rnd() * 0.4)),
      put_volume_ask_side: Math.round(putVol * (0.3 + rnd() * 0.4)), put_volume_bid_side: Math.round(putVol * (0.3 + rnd() * 0.4)),
      iv30d: iv.toFixed(4), iv30d_1w: (iv * (0.9 + rnd() * 0.2)).toFixed(4), iv30d_1d: (iv * (0.95 + rnd() * 0.1)).toFixed(4),
      iv30d_1m: (iv * (0.85 + rnd() * 0.3)).toFixed(4), iv_rank: (rnd() * 100).toFixed(4),
      implied_move: (price * iv * 0.06).toFixed(4), implied_move_perc: (iv * 0.06).toFixed(6), volatility: iv.toFixed(4),
      put_call_ratio: (putVol / callVol).toFixed(4), week_52_high: (price * (1.05 + rnd() * 0.3)).toFixed(2),
      week_52_low: (price * (0.5 + rnd() * 0.3)).toFixed(2), relative_volume: (0.5 + rnd() * 2).toFixed(2),
      stock_volume: Math.round(5e6 + rnd() * 8e7),
      next_earnings_date: new Date(Date.parse(gateOrigin + "T00:00:00Z") + (earnIn || 20 + Math.floor(rnd() * 30)) * 86400000)
        .toISOString().slice(0, 10),
    };
  });
}

function fakeScreener(count) {

  const gateOrigin = nextTradingDay(DRY_SESSION_DATE, null);
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

export function markGate(card, e) {
  if (!card || !e || !e.gate) return card;
  card.score = null;
  card.conviction = null;
  card.gate = { earnings: e.gate.earnings, dte: e.gate.dte };
  return card;
}

function card0Unusable(row) {
  if (!row || typeof row !== "object") return true;
  return !["call_gamma_ask", "call_gamma_bid", "put_gamma_ask", "put_gamma_bid"]
    .some((k) => row[k] !== undefined && row[k] !== null && row[k] !== "");
}

export function fakeChain(ticker, spot, seed, { wide = false, expiry = null, page = 0 } = {}) {
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
        const smileVol = level + 0.55 * m * m - 0.22 * m;
        const iv = smileVol + (isPut ? 0.012 : -0.012);
        const T = dte / 365;
        const F = spot * Math.exp(FAKE_RATE * T), D = Math.exp(-FAKE_RATE * T);
        const price = black76(F, D, strike, smileVol, T, cp);
        const half = Math.max(0.01, 0.015 * price);
        const bid = Math.max(0.01, Math.round((price - half) * 100) / 100);
        const ask = Math.max(bid + 0.01, Math.round((price + half) * 100) / 100);

        const traded = rnd() > 0.08;
        const volume = traded ? Math.round(80 + 3000 * Math.exp(-7 * m * m) * rnd()) : 0;
        const row = {
          option_symbol: `${ticker}${code}${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`,

          nbbo_bid: (i === halfWidth && !isPut ? 0 : bid).toFixed(2),
          nbbo_ask: ask.toFixed(2),
          implied_volatility: iv.toFixed(6),
          open_interest: String(400 + Math.round(6000 * Math.exp(-6 * m * m) * (isPut ? (m < 0 ? 1.5 : 0.5) : (m > 0 ? 1.5 : 0.5)))),
          prev_oi: String(380 + Math.round(5700 * Math.exp(-6 * m * m) * (isPut ? (m < 0 ? 1.5 : 0.5) : (m > 0 ? 1.5 : 0.5)))),
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

  if (expiry || !wide) return page ? [] : rows;

  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows.slice(page * CHAIN_PAGE_SIZE, (page + 1) * CHAIN_PAGE_SIZE);
}

function fakeTreasury(sessionDate) {
  return { data: { data: [{ value: 4.17, date: sessionDate || "2026-08-24" }, { value: 4.2, date: "2026-08-21" }], name: "3month", unit: "percent" } };
}

export function fakeEarnings(ticker, sessionDate) {
  const rnd = mulberry(ticker.length * 977 + ticker.charCodeAt(0));
  const rows = [];
  const base = Date.parse((sessionDate || "2026-08-24") + "T00:00:00Z");
  const upcoming = new Date(base + (20 + Math.floor(rnd() * 70)) * 86400000).toISOString().slice(0, 10);
  rows.push({ source: "estimation", report_date: upcoming, report_time: "unknown", expected_move_perc: null, post_earnings_move_1d: null });
  for (let q = 1; q <= 10; q++) {
    const d = new Date(base - (q * 91 - 30) * 86400000);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    const expected = 0.04 + 0.05 * rnd();
    const move = (rnd() > 0.5 ? 1 : -1) * expected * (0.4 + 1.2 * rnd());
    rows.push({ source: "company", report_date: d.toISOString().slice(0, 10), report_time: rnd() > 0.5 ? "postmarket" : "premarket",
      expected_move_perc: expected.toFixed(6), post_earnings_move_1d: move.toFixed(6) });
  }
  return { data: rows };
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
      const callAsk = callLeg * (0.4 + rnd() * 0.3);
      const callBid = callLeg * (0.3 + rnd() * 0.3);
      const putAsk = putLeg * (0.4 + rnd() * 0.3);
      const putBid = putLeg * (0.3 + rnd() * 0.3);
      rows.push({
        strike: k.toFixed(2),
        expiry,
        call_gamma_ask: String(callAsk),
        call_gamma_bid: String(callBid),
        put_gamma_ask: String(putAsk),
        put_gamma_bid: String(putBid),
        call_gamma_oi: String(callLeg * 1.7),
        put_gamma_oi: String(putLeg * 1.7),
        call_charm_oi: String(callLeg * 0.21),
        put_charm_oi: String(putLeg * -0.18),
        call_vanna_oi: String(callLeg * -0.33),
        put_vanna_oi: String(putLeg * 0.27),
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
  const late = Array.from({ length: 4 }, (_, i) => ({
    ticker, executed_at: `${DRY_SESSION_DATE}T${20 + i}:${String(5 + i * 11).padStart(2, "0")}:00Z`,
    price: spot.toFixed(2), size: 900000 - i * 1000, premium: String(Math.round(spot * (900000 - i * 1000))),
    volume: Math.round(rnd() * 6e7), market_center: "L", ext_hour_sold_codes: "extended_hours_trade",
  }));
  return late.concat(Array.from({ length: 20 }, (_, i) => {
    const px = spot * (0.985 + rnd() * 0.03);
    const size = Math.round(5e3 + rnd() * 4e5);
    const row = {
      ticker,
      executed_at: `${DRY_SESSION_DATE}T${String(13 + (i % 7))}:${String(10 + (i % 49))}:00Z`,
      price: px.toFixed(2), size,
      volume: Math.round(rnd() * 6e7),
      market_center: "L",
    };
    if (i % 5 !== 4) row.premium = String(Math.round(px * size));
    if (i % 3 !== 2) { row.nbbo_bid = (px - 0.03).toFixed(2); row.nbbo_ask = (px + 0.03).toFixed(2); }
    if (i % 9 === 8) row.canceled = false;
    return row;
  }));
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

function fakeTermStructure(ticker, spot, params = {}) {
  const rnd = mulberry(ticker.length * 3167);
  const anchor = params && typeof params.date === "string" ? params.date : "2026-08-28";
  const base = Date.parse(anchor + "T00:00:00Z");
  return Array.from({ length: 12 }, (_, i) => {
    const expiryMs = Date.UTC(2026, 7, 28) + (3 + i * 12) * 86400000;
    const dte = Math.round((expiryMs - base) / 86400000);
    const vol = 0.2 + rnd() * 0.3 + (i < 2 ? rnd() * 0.15 : 0);
    return {
      ticker, date: anchor,
      expiry: new Date(expiryMs).toISOString().slice(0, 10),
      dte, volatility: vol.toFixed(4),
      implied_move: (spot * vol * Math.sqrt(dte / 365)).toFixed(2),
      implied_move_perc: (vol * Math.sqrt(dte / 365)).toFixed(4),
    };
  });
}

const IV_RANK_VENDOR_DEFAULT_ROWS = 5;

export function fakeIvRank(ticker, spot, params = {}) {
  const rnd = mulberry(ticker.length * 4271);
  const count = params && params.timespan === "1y" ? 251 : params && params.timespan === "3m" ? 64
    : IV_RANK_VENDOR_DEFAULT_ROWS;
  const days = tradingDaysEndingAt("2026-08-28", count);
  let vol = 0.2 + rnd() * 0.3, px = spot * (0.9 + rnd() * 0.2);
  const rows = days.map((t) => {
    const shock = rnd() + rnd() + rnd() - 1.5;
    vol = Math.max(0.05, vol + shock * 0.012);
    px = px * Math.exp(-shock * 0.02 + (rnd() - 0.5) * 0.01);
    return { t, vol, px };
  });
  return rows.reverse().map((r, i) => {
    const row = {
      date: new Date(r.t).toISOString().slice(0, 10),
      updated_at: "2026-08-28T20:00:00Z",
      volatility: r.vol.toFixed(4),
      close: r.px.toFixed(2),
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
      start_time: i % 2 === 0
        ? Date.UTC(2026, 7, 24, 14, 10 + (i % 45))
        : "2026-08-24T14:" + String(10 + (i % 45)).padStart(2, "0") + ":00Z",
      end_time: i % 2 === 0
        ? Date.UTC(2026, 7, 24, 14, 12 + (i % 45), 30)
        : "2026-08-24T14:" + String(12 + (i % 45)).padStart(2, "0") + ":30Z",
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

  const afterHours = Array.from({ length: 8 }, (_, i) => {
    const px = 20 + rnd() * 400;
    const size = Math.round(3e6 + rnd() * 2e6);
    return {
      ticker: pick(),
      executed_at: `${DRY_SESSION_DATE}T23:${String(59 - i * 5).padStart(2, "0")}:00Z`,
      price: px.toFixed(2), size, premium: String(Math.round(px * size)),
      volume: Math.round(rnd() * 8e7), ext_hour_sold_codes: "extended_hours_trade",
    };
  });
  const darkpool = { data: afterHours.concat(Array.from({ length: 45 }, (_, i) => {
    const px = 20 + rnd() * 400;
    const size = Math.round(1e4 + rnd() * 2e6);
    const minute = 959 - i;
    const row = {
      ticker: pick(),
      executed_at: `${DRY_SESSION_DATE}T${String(Math.floor(minute / 60)).padStart(2, "0")}:` +
        `${String(minute % 60).padStart(2, "0")}:00Z`,
      price: px.toFixed(2), size,
      premium: String(Math.round(px * size)),
      volume: Math.round(rnd() * 8e7),
    };
    if (i % 3 !== 2) { row.nbbo_bid = (px - 0.05).toFixed(2); row.nbbo_ask = (px + 0.05).toFixed(2); }
    if (i % 7 === 6) row.canceled = rnd() > 0.5;
    return row;
  })) };
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

const FAKE_CHARM_SCALE = 50;
const FAKE_RATE = 0.04;
const fakeLadders = new Map();

function tickerSeed(ticker) {
  let h = 2166136261;
  for (const ch of String(ticker)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function fakeOiLadder(ticker, spot, iv) {
  const rnd = mulberry(tickerSeed(ticker));
  const vol = Number.isFinite(iv) && iv > 0.02 ? iv : 0.3;
  const strikes = Array.from({ length: 41 }, (_, j) => spot * (0.7 + j * 0.015));
  const expiries = Array.from({ length: 6 }, (_, i) => ({
    expiry: new Date(Date.UTC(2026, 7, 28) + i * 7 * 86400000).toISOString().slice(0, 10),
    days: i * 7 + 4,
  }));
  const oiCall = [], oiPut = [];
  for (let i = 0; i < expiries.length; i++) {
    const depth = 1 / (1 + i * 0.35);
    oiCall.push(strikes.map((k) => {
      const w = Math.exp(-Math.pow((k - spot * 1.05) / (spot * 0.12), 2));
      return Math.round(4000 * depth * w * (0.4 + rnd()));
    }));
    oiPut.push(strikes.map((k) => {
      const w = Math.exp(-Math.pow((k - spot * 0.94) / (spot * 0.12), 2));
      return Math.round(3500 * depth * w * (0.4 + rnd()));
    }));
  }
  const ladder = { ticker, spot, vol, strikes, expiries, oiCall, oiPut };
  fakeLadders.set(ticker, ladder);
  return ladder;
}

export function fakeLadderGreeks(ladder) {
  const { spot, vol, strikes, expiries, oiCall, oiPut } = ladder;
  const rows = expiries.map((e, i) => {
    const out = { expiry: e.expiry, dte: e.days, gc: 0, gp: 0, dc: 0, dp: 0, vc: 0, vp: 0, cc: 0, cp: 0 };
    strikes.forEach((k, j) => {
      const c = blackScholesGreeks({ spot, strike: k, days: e.days, vol, rate: FAKE_RATE, type: "C" });
      const p = blackScholesGreeks({ spot, strike: k, days: e.days, vol, rate: FAKE_RATE, type: "P" });
      const nc = oiCall[i][j] * 100, np = oiPut[i][j] * 100;
      out.gc += c.gamma * nc; out.gp += p.gamma * np;
      out.dc += c.delta * nc; out.dp += p.delta * np;
      out.vc += c.vanna * nc; out.vp += p.vanna * np;
      out.cc += FAKE_CHARM_SCALE * c.charmPerDay * nc; out.cp += FAKE_CHARM_SCALE * p.charmPerDay * np;
    });
    return out;
  });
  const byStrike = strikes.map((k, j) => {
    let gc = 0, gp = 0;
    expiries.forEach((e, i) => {
      const g = blackScholesGreeks({ spot, strike: k, days: e.days, vol, rate: FAKE_RATE, type: "C" }).gamma;
      gc += g * oiCall[i][j] * 100;
      gp += g * oiPut[i][j] * 100;
    });
    return { gc: gc * spot * spot / 100, gp: gp * spot * spot / 100 };
  });
  return { rows, byStrike };
}

export function fakeLadderChain(ladder, expiry) {
  const i = ladder.expiries.findIndex((e) => e.expiry === expiry);
  if (i < 0) return [];
  const yymmdd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  const out = [];
  ladder.strikes.forEach((k, j) => {
    for (const [cp, oi] of [["C", ladder.oiCall[i][j]], ["P", ladder.oiPut[i][j]]]) {
      if (!(oi > 0)) continue;
      out.push({
        option_symbol: `${ladder.ticker}${yymmdd}${cp}${String(Math.round(k * 1000)).padStart(8, "0")}`,
        implied_volatility: ladder.vol.toFixed(4),
        open_interest: oi,
      });
    }
  });
  return out;
}

function fakeEnrichment(ticker, spot, seed, iv = null) {
  const rnd = mulberry(seed);
  const ladder = fakeOiLadder(ticker, spot, iv);
  const book = fakeLadderGreeks(ladder);
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
      call_gamma_oi: String(book.byStrike[i].gc),
      put_gamma_oi: String(-book.byStrike[i].gp),
      call_gamma_vol: String(Math.abs(callLeg) * rnd() * 2),
      put_gamma_vol: String(-Math.abs(putLeg) * rnd() * 1.4),
    };
  });

  const expiries = book.rows.map((b, i) => {
    for (let draw = 0; draw < (i !== 4 ? 8 : 6); draw++) rnd();
    const row = {
      expiry: b.expiry,
      dte: b.dte,
      call_gex: String(b.gc),
      put_gex: String(-b.gp),
      call_delta: String(b.dc),
      put_delta: String(b.dp),
      call_charm: String(b.cc),
      put_charm: String(b.cp),
    };
    if (i !== 4) {
      row.call_vanna = String(b.vc);
      row.put_vanna = String(b.vp);
    }
    return row;
  });
  const lapsed = book.rows[0];
  expiries.unshift({
    expiry: DRY_SESSION_DATE, dte: 0,
    call_gex: String(lapsed.gc * 0.5), put_gex: String(-lapsed.gp * 0.5),
    call_delta: String(lapsed.dc * 0.5), put_delta: String(lapsed.dp * 0.5),
    call_charm: String(lapsed.cc * 0.5), put_charm: String(lapsed.cp * 0.5),
    call_vanna: String(lapsed.vc * 0.5), put_vanna: String(lapsed.vp * 0.5),
  });

  let px = spot;

  const days = tradingDaysEndingAt(DRY_SESSION_DATE, 252);
  let s2 = 1.6, lastMove = 0;
  const walk = Array.from({ length: 252 }, (_, i) => {
    s2 = 0.08 + 0.09 * lastMove * lastMove + 0.86 * s2;
    lastMove = Math.sqrt(s2) * (rnd() + rnd() + rnd() - 1.5) * 2;
    const move = px * lastMove / 100;
    const open = px; px = Math.max(1, px + move);
    return { at: days[i], open, close: px, volume: Math.round((3e6 + rnd() * 2e7)) };
  });

  const scale = spot > 0 && px > 0 ? spot / px : 1;
  const ohlc = walk.map((w) => {
    const open = w.open * scale, close = w.close * scale;
    return {
      start_time: new Date(w.at).toISOString(),
      open: open.toFixed(2), close: close.toFixed(2),
      high: (Math.max(open, close) * 1.008).toFixed(2),
      low: (Math.min(open, close) * 0.992).toFixed(2),
      volume: w.volume,
    };
  });

  return { ticker, spot, greekFlow, ticks, strikes, expiries, ohlc };
}

export const PULSE_TOTALS_HISTORY = 252;

async function publishPulse({ sessionDate, generatedAt, tickers = [] }) {
  let crossRaws = null;

  try {
    const PULSE_FETCHES = {
      tide: ["/api/market/market-tide", { interval_5m: "true" }],
      totals: ["/api/market/total-options-volume", { limit: PULSE_TOTALS_HISTORY }],
      oiChange: ["/api/market/oi-change", { limit: MARKET_CROSS_LIMIT }],
      netImpact: ["/api/market/top-net-impact", { limit: PULSE_CAPS.netImpact }],
      insiders: ["/api/market/insider-buy-sells", { limit: PULSE_CAPS.insiders }],
      darkpool: ["/api/darkpool/recent", { limit: MARKET_CROSS_LIMIT,
        ...sessionPrintParams(sessionDate, { windowed: false }) }],
      seasonality: ["/api/seasonality/market", {}],
    };
    const raws = {};
    if (DRY_RUN) {
      Object.assign(raws, fakePulseRaws(tickers));
    } else {
      for (const [feed, [path, params]] of Object.entries(PULSE_FETCHES)) {
        try {
          raws[feed] = await uw(path, params);
        } catch (error) {
          raws[feed] = { __failed: error && error.message ? error.message : String(error) };
        }
      }
    }
    const readAt = stampNow();

    raws.darkpool = sessionPrints(raws.darkpool, sessionDate, { limit: MARKET_CROSS_LIMIT });
    crossRaws = { oiChange: raws.oiChange, darkpool: raws.darkpool, readAt };
    const pulse = buildPulse(raws);
    if (pulse.darkpool && raws.darkpool && raws.darkpool.session) pulse.darkpool.session = raws.darkpool.session;
    pulse.totalsHistory = totalsHistory(unwrapVendorRows(DRY_RUN
      ? await makeFakeVendor({ sessionDate })("/api/market/total-options-volume", { limit: PULSE_TOTALS_HISTORY })
      : raws.totals), { sessionDate });
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

      readAt,
      readDay: readDayOf(readAt),
      refreshed: "nightly",
      ...pulse,
    });
    const okCount = PULSE_FEEDS.filter((f) => pulse[f].status === "ok").length;
    console.log(`  pulse: ${okCount} of ${PULSE_FEEDS.length} feeds ok — ` +
      PULSE_FEEDS.map((f) => `${f}:${pulse[f].status}${pulse[f].rows ? ":" + pulse[f].rows.length : pulse[f].points ? ":" + pulse[f].points.length : ""}`).join(" "));
  } catch (error) {
    console.warn(`  pulse: ${error.message} — every key above published before this leg ran`);
  }
  return crossRaws;
}

async function publishSectorPremium({ sessionDate, generatedAt }) {
  try {
    const raw = DRY_RUN
      ? fakeSectorEtfs()
      : await uw("/api/market/sector-etfs", {});
    const readAt = stampNow();
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

      readAt,
      readDay: readDayOf(readAt),
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
}

async function publishNews({ sessionDate, generatedAt, tickers = [] }) {
  try {
    const raw = DRY_RUN
      ? fakeNewsHeadlines(tickers)
      : await uw("/api/news/headlines", { limit: NEWS_VENDOR_LIMIT });
    const readAt = stampNow();
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

      readAt,
      readDay: readDayOf(readAt),
      refreshed: "nightly",

      cadence: PIPELINE_CADENCE,
      staleBy: "the next weekday's close",
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
}

export const CARD_SELF_CHECK_BYTES = 100 * 1024;

export const CARD_SHED = Object.freeze([
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
]);

export function shedCardToCap(card, cap = CARD_SELF_CHECK_BYTES) {
  let body = JSON.stringify(card);
  const dropped = [];
  const surface = card.panels && card.panels.surface;
  if (body.length > cap && surface && surface.status === "ok" && surface.oi) {
    surface.oi = null;
    dropped.push("surface.oi");
    body = JSON.stringify(card);
  }
  for (const [key, reason] of CARD_SHED) {
    if (body.length <= cap) break;
    if (!card.panels[key] || card.panels[key].status !== "ok") continue;
    card.panels[key] = { status: "unavailable", reason };
    dropped.push(key);
    body = JSON.stringify(card);
  }
  return { body, dropped };
}

function indexDossierDeps({ sessionDate, dating, generatedAt, screenerReadAt, congressState, marketCross, variationRun, volLeg = null }) {
  const onSession = ARCHIVE_DATE_RE.test(String(sessionDate || "")) ? { date: sessionDate } : {};
  return {
    enrich: async (ticker, spot, row) => {
      if (!DRY_RUN) return (await enrich(ticker, spot, sessionDate, dating)).raw;
      const fake = fakeEnrichment(ticker, spot, 9000 + tickerSeed(ticker), num(row.iv30d) || null);
      return { ...fake, ohlc: sessionCandles(fake.ohlc, sessionDate) };
    },
    features: (raw, ticker, spot, row) =>
      computeFeatures({ ...raw, ticker, spot, sessionDate, tilt: screenerTilt(row) }),
    perName: async (ticker, spot, raw) => {
      const expiries = (raw.expiries || [])
        .map((r) => (r && r.expiry ? String(r.expiry).slice(0, 10) : null))
        .filter((d) => d && (!sessionDate || d > sessionDate)).sort().slice(0, SURFACE_EXPIRIES);
      const [maxPain, surface, dpRaw, oiRaw, termRaw, rankRaw] = DRY_RUN
        ? [fakeMaxPain(ticker, spot), fakeSurface(ticker, spot, expiries), fakeStockDarkpool(ticker, spot),
          fakeStockOiChange(ticker, spot), fakeTermStructure(ticker, spot, onSession), fakeIvRank(ticker, spot, IV_RANK_PARAMS)]
        : await Promise.all([
          uw(`/api/stock/${ticker}/max-pain`, onSession).catch(() => []),
          expiries.length
            ? uw(`/api/stock/${ticker}/spot-exposures/expiry-strike`, {
              "expirations[]": expiries, ...onSession,
              min_strike: Math.floor(spot * 0.9), max_strike: Math.ceil(spot * 1.1), limit: 500,
            }).catch(() => [])
            : Promise.resolve([]),
          uw(`/api/darkpool/${ticker}`, { limit: 60, ...onSession }).catch(() => null),
          uw(`/api/stock/${ticker}/oi-change`, { limit: 30, ...onSession }).catch(() => null),
          uw(`/api/stock/${ticker}/volatility/term-structure`, { ...onSession }).catch(() => null),
          uw(`/api/stock/${ticker}/iv-rank`, { ...IV_RANK_PARAMS, ...onSession }).catch(() => null),
        ]);
      return {
        maxPain, surface,
        darkpool: sessionRows(dpRaw, (r) => easternDayOf(r && r.executed_at), sessionDate).raw,
        oiDeltas: oiRaw, termStructure: termRaw,
        ivRank: sessionRows(rankRaw, (r) => easternDayOf(r && r.date), sessionDate, { through: true }).raw,
      };
    },
    chain: async (ticker, spot) => {
      const rows = DRY_RUN
        ? fakeChain(ticker, spot, 9500 + tickerSeed(ticker))
        : await uw(`/api/stock/${ticker}/option-contracts`, {
          exclude_zero_oi_chains: "true", limit: CHAIN_PAGE_SIZE,
        }).catch(() => []);
      if (!Array.isArray(rows) || !rows.length) return null;
      return buildChainPanels(rows, { spot, asOf: sessionDate, ticker, complete: false, pages: 1 });
    },
    card: ({ ticker, row, raw, features, reads, chain, depth = "index" }) => {
      const card = buildCard({
        ticker, row: { ...sessionRow(row, features), nm: typeof row.full_name === "string" && row.full_name.trim() ? row.full_name.trim().slice(0, 60) : null }, features,
        strikes: raw.strikes, ticks: raw.ticks, expiries: raw.expiries,
        surface: reads.surface, chain,
        chainMissing: chain ? null : `the ${depth === "fund" ? "fund" : "index"} chain page could not be read this run`,
        scoreHistory: null, weights: null,
        maxPain: reads.maxPain, congress: congressRows(ticker, congressState), generatedAt, sessionDate,
        darkpool: reads.darkpool, oiDeltas: reads.oiDeltas, termStructure: reads.termStructure, ivRank: reads.ivRank,
        marketCross, variation: variationOptions(variationRun),
      });
      card.readPx = readPxOf({ row, features }, screenerReadAt);
      attachVol(card, volLeg, ticker);
      return card;
    },
  };
}

export function pickPriorRoster(late, early, { log = () => {} } = {}) {
  if (!late || !late.failed) return late;
  if (!early || early.failed) return late;
  log(`  roster: the prior roster could not be read now (HTTP ${late.status}); using the copy read at the start of ` +
    "this run, which only this run could have changed");
  return early;
}

export const LEDGER_PROBE_MAX = 2400;

export const LEDGER_PROBE_FAIL_MAX = 25;

export const LEDGER_PROBE_RETRY_BUDGET_MS = 20_000;

export const LEDGER_PROBE_CHUNK = 96;

const probeDayOf = (p) => {
  const d = p && typeof p === "object" ? (p.sessionDate || String(p.generatedAt || "").slice(0, 10)) : null;
  return ARCHIVE_DATE_RE.test(String(d || "")) ? d : null;
};

const probeFound = (card, x) => card === "present" || x === "present" || card === "landed" || x === "landed";

async function probeLedgerMetadata({ list, landed, probeMany, past, limit, failLimit, chunk }) {
  const asked = [];
  const chargeOf = (keys) => keys.filter((k) => !k.startsWith("hist:")).length;
  let capped = false, budget = 0;
  for (const t of list) {
    const keys = ["card:" + t, "card-x:" + t, "hist:" + t].filter((k) => !landed.has(k));
    if (budget + chargeOf(keys) > limit) { capped = true; break; }
    budget += chargeOf(keys);
    asked.push(...keys);
  }
  const answers = new Map();
  let reads = 0, charged = 0, failed = 0, requests = 0, metaBytes = 0;
  for (let i = 0; i < asked.length; i += chunk) {
    if (failed >= failLimit || past()) { capped = true; break; }
    const batch = asked.slice(i, i + chunk);
    requests++;
    reads += batch.length;
    charged += chargeOf(batch);
    const r = await probeMany(batch);
    const shaped = !!r && !r.failed && r.status === 200 && !!r.keys && typeof r.keys === "object";
    if (!shaped) {
      if (requests === 1) {
        return { fallback: { status: r && r.status ? r.status : 0, said: r ? readSaid(r) : "no answer",
          code: r && typeof r.code === "string" ? r.code : null } };
      }
      failed += batch.length;
      continue;
    }
    metaBytes += Number(r.bytes) || 0;
    for (const key of batch) {
      const a = r.keys[key];
      if (!a || typeof a !== "object") { failed++; continue; }
      answers.set(key, a.present === true ? a : null);
    }
  }
  const known = new Map();
  let avoided = 0;
  const state = (key) => (landed.has(key) ? "landed" : !answers.has(key) ? "unknown" : answers.get(key) ? "present" : "absent");
  const take = (key) => {
    const a = answers.get(key);
    if (!a) return;
    known.set(key, probeDayOf(a));
    avoided += Number(a.bytes) || 0;
  };
  for (const t of list) {
    const card = state("card:" + t), x = state("card-x:" + t);
    take("card:" + t);
    take("card-x:" + t);
    if (probeFound(card, x) && !landed.has("hist:" + t)) take("hist:" + t);
  }
  return { known, reads, charged, failed, capped, path: "metadata", requests, metaBytes, avoided, fallback: null };
}

export async function bootstrapLedger({ tickers = [], landed = new Set(), reader, probeMany = null, pool = runPooled, width = 4,
  deadline = null, limit = LEDGER_PROBE_MAX, failLimit = LEDGER_PROBE_FAIL_MAX, chunk = LEDGER_PROBE_CHUNK } = {}) {
  const list = [...new Set(tickers)].filter((t) => rosterKeyTicker("card:" + t)).sort();
  const past = () => Number.isFinite(deadline) && Date.now() > deadline;
  let fallback = null;
  if (probeMany) {
    const meta = await probeLedgerMetadata({ list, landed, probeMany, past, limit, failLimit, chunk });
    if (!meta.fallback) return meta;
    fallback = meta.fallback;
  }
  const known = new Map();
  let reads = 0, failed = 0, capped = false;
  const probe = async (key) => {
    if (reads >= limit || failed >= failLimit || past()) {
      capped = true;
      return "skipped";
    }
    reads++;
    const r = await reader(key);
    if (!r || r.failed) { failed++; return "failed"; }
    if (r.absent || !r.payload || r.payload.status === "pending") return "absent";
    known.set(key, probeDayOf(r.payload));
    return "present";
  };
  await pool(list, async (t) => {
    const card = landed.has("card:" + t) ? "landed" : await probe("card:" + t);
    const x = landed.has("card-x:" + t) ? "landed" : await probe("card-x:" + t);
    if (probeFound(card, x) && !landed.has("hist:" + t)) {
      await probe("hist:" + t);
    }
  }, { width });
  return { known, reads, charged: reads, failed, capped, path: "per-key", requests: reads, metaBytes: 0, avoided: 0, fallback };
}

export function probeSaid(p) {
  const tail = `${p.known.size} older key(s) found` +
    (p.failed ? `, ${p.failed} ${p.path === "metadata" ? "key(s) unanswered" : "read(s) failed"}` : "") +
    (p.capped ? " — the probe stopped at its cap, its failure limit or the deadline" : "");
  if (p.path === "metadata") {
    return `${p.reads} key(s) asked over ${p.requests} metadata request(s) of ${p.metaBytes} bytes, ` +
      `${p.charged} card and card-x key(s) counted against the cap, ${p.avoided} bytes of stored payload left undownloaded, ${tail}`;
  }
  const why = p.fallback
    ? ` (the metadata form answered ${p.fallback.said}${p.fallback.code ? " " + p.fallback.code : ""}, so ` +
      (p.fallback.code === "too_many_keys" ? "the chunk is above this Worker's cap, not an older Worker" : "an older Worker is assumed") + ")"
    : "";
  return `${p.reads} read(s) key by key${why}, ${tail}`;
}

export async function retireAndRoster({
  sessionDate, generatedAt, depth = new Map(), exempt = new Set(), candidates = [], reader, probeMany = null, lister = null,
  prior = null, landed = landedKeys, deadline = null, remove = retire, write = publish, log = (line) => console.log(line),
} = {}) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    log("  roster: no session date, so no card can be aged — nothing retired, no roster written");
    return null;
  }
  const priorPayload = prior && prior.payload ? prior.payload : null;
  let { known, complete, why } = priorLedger(priorPayload, { sessionDate });
  let ledger = "carried";
  if (prior && prior.failed) {
    ledger = "unread";
    known = new Map();
    log(`  roster: the prior roster could not be read (HTTP ${prior.status}) — nothing is retired tonight, and the next run probes the store to rebuild the ledger`);
  } else if (!complete) {
    const probed = await bootstrapLedger({ tickers: [...new Set([...candidates, ...known.keys()].map((k) => rosterKeyTicker(k) || k))],
      landed, reader, probeMany, deadline });
    for (const [k, v] of probed.known) if (!known.has(k) || v) known.set(k, v);
    ledger = probed.capped || probed.failed ? "bootstrap-partial" : "bootstrap";
    log(`  roster: the prior ledger is not complete (${why}), so the store was probed — ${probeSaid(probed)}`);
  }
  if (lister && !(prior && prior.failed)) {
    const listed = await lister().catch((error) => ({ failed: true, status: 0, detail: error.message }));
    if (listed && !listed.failed && listed.keys && typeof listed.keys === "object") {
      let seen = 0, unknown = 0;
      for (const [key, a] of Object.entries(listed.keys)) {
        if (!rosterKeyTicker(key) || !a || a.present !== true) continue;
        seen++;
        if (known.has(key) || landed.has(key)) continue;
        known.set(key, probeDayOf(a));
        unknown++;
      }
      log(`  roster: the store lists ${seen} card, card-x and hist key(s), ${unknown} the ledger did not know` +
        (unknown ? " — aged with the rest, so any older than " + RETIRE_AFTER_SESSIONS + " sessions is retired tonight" : "") +
        (listed.truncated ? " (the listing was cut at its cap)" : ""));
    } else {
      log(`  roster: the store's key listing could not be read (${listed && listed.status ? "HTTP " + listed.status : "no answer"}` +
        `${listed && listed.detail ? ", " + listed.detail : ""}) — the ledger is used as it stands`);
    }
  }
  const plan = retirePlan({ sessionDate, known, landed, exempt });
  let removed = 0, absent = 0, refused = 0, streak = 0, lastStatus = 0;
  const gone = [];
  const held = { ...plan.held };
  for (const key of plan.retire) {
    if (streak >= 3) { held[key] = known.get(key); refused++; continue; }
    const r = await remove(key);
    if (r && r.ok) { removed++; streak = 0; gone.push(key); continue; }
    if (r && r.status === 404) { absent++; streak = 0; gone.push(key); continue; }
    refused++; streak++; lastStatus = r ? r.status : 0;
    held[key] = known.get(key);
  }
  log(`  retire: ${plan.retire.length} card/card-x/hist key(s) older than ${RETIRE_AFTER_SESSIONS} sessions and not ` +
    `rebuilt tonight — ${removed} removed` + (absent ? `, ${absent} already absent` : "") +
    (refused ? `, ${refused} refused (last HTTP ${lastStatus}), kept for the next run` : "") +
    `; ${Object.keys(held).length} older key(s) held (${plan.kept.young} within the window, ${plan.kept.exempt} exempt` +
    (plan.kept.undated ? `, ${plan.kept.undated} undated` : "") + ")");
  const built = buildRoster({ sessionDate, generatedAt, depth, landed, held, retired: gone, ledger });
  let written = true;
  try {
    if (!built.fits) {
      log(`  roster: ${built.bytes} bytes, over the cap — the held ledger is dropped so the roster still publishes`);
      const slim = buildRoster({ sessionDate, generatedAt, depth, landed, held: {}, retired: [], ledger: "dropped" });
      await write("roster", slim.payload);
    } else {
      await write("roster", built.payload);
    }
  } catch (error) {
    written = false;
    log(`  roster: NOT written (${error.message}) after ${removed} key(s) were removed` +
      (absent ? ` and ${absent} found already absent` : "") +
      ` — the stored roster stays at its older session, so the next run finds the gap and probes the store`);
  }
  const counts = built.payload.counts;
  if (written) {
    log(`  roster: ${Object.keys(built.payload.depth).length} carded name(s) — ` +
      Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ") + `, ${built.bytes} bytes (ledger ${ledger})`);
  }
  return { retired: removed, absent, refused, held: Object.keys(held).length, heldKeys: held, ledger, bytes: built.bytes, written,
    rostered: Object.keys(built.payload.depth).length };
}

function dryPriorRoster(sessionDate) {
  const back = (n) => {
    let d = sessionDate;
    for (let i = 0; i < n;) {
      d = new Date(Date.parse(d + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      const wd = new Date(d + "T00:00:00Z").getUTCDay();
      if (wd !== 0 && wd !== 6) i++;
    }
    return d;
  };
  return {
    v: 1, sessionDate: back(1), generatedAt: back(1) + "T21:40:00.000Z", ledger: "bootstrap-partial",
    depth: { AAPL: "focus", GLD: "fund", SPY: "index" }, session: { AAPL: back(1), GLD: back(1), SPY: back(1) },
    x: { "card-x": ["AAPL"], hist: ["AAPL"] },
    held: { "card:ZZRET": back(5), "card-x:ZZRET": back(5), "hist:ZZRET": back(5), "card:ZZHLD": back(2),
      "card:NVDA": back(6), "card-x:ZZXON": back(4) },
  };
}

export function dryRosterReader(sessionDate) {
  const prior = dryPriorRoster(sessionDate);
  return async (key) => (key === "roster" ? { payload: prior, status: 200 } : { payload: null, absent: true, status: 0 });
}

export const DRY_PROBE_BYTES = Object.freeze({ card: 61440, "card-x": 20480, hist: 10240 });

export function dryRosterProbe(sessionDate) {
  const prior = dryPriorRoster(sessionDate);
  const stored = { ...prior.held, "hist:ZZHLD": prior.held["card:ZZHLD"] };
  return async (keys) => {
    const out = {};
    for (const key of keys) {
      const day = stored[key];
      out[key] = day
        ? { present: true, sessionDate: day, generatedAt: day + "T21:40:00.000Z", updatedAt: Date.parse(day + "T21:40:00Z"),
            bytes: DRY_PROBE_BYTES[key.split(":")[0]] }
        : { present: false };
    }
    return { keys: out, status: 200, bytes: JSON.stringify({ keys: out }).length };
  };
}

async function runWitnessDrill() {
  console.log("Flows live layer — witness drill (opens one issue and closes it, nothing else)");
  const drilled = await witnessDrill({ env: process.env });
  if (drilled.ok) console.log(`witness drill: issue #${drilled.number} opened and closed — the alert channel works`);
  else {
    console.warn(`witness drill: FAILED — ${drilled.why}`);
    process.exitCode = 1;
  }
  return drilled;
}

export function dryRosterList(sessionDate) {
  const prior = dryPriorRoster(sessionDate);
  const stored = { ...prior.held, "hist:ZZHLD": prior.held["card:ZZHLD"], "card:ZZORF": prior.held["card:ZZRET"] };
  return async () => {
    const keys = {};
    for (const [key, day] of Object.entries(stored)) {
      keys[key] = { present: true, sessionDate: day, generatedAt: day + "T21:40:00.000Z", updatedAt: Date.parse(day + "T21:40:00Z") };
    }
    return { keys, status: 200, bytes: JSON.stringify({ keys }).length, truncated: false };
  };
}

async function runLiveMode() {
  if (process.env.FLOWS_LIVE_DRILL === "1" && !DRY_RUN) return runWitnessDrill();
  console.log(DRY_RUN ? "Flows live layer — DRY RUN (synthetic, no network)" : "Flows live layer — live");
  if (!DRY_RUN) {
    const missing = ["UW_API_KEY"].filter((k) => !process.env[k]);
    const source = liveCredentialSource();
    if (!source) missing.push("FLOWS_LIVE_TOKEN (or a GitHub Actions job with id-token: write)");
    if (missing.length) {
      throw new Error(`missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` +
        " — the live mode refuses the nightly FLOWS_INGEST_TOKEN on purpose");
    }
    console.log(`publishing to ${ingestURL()} as ${source}`);
  }
  raiseReadPace(LIVE_READ_PACE_MS);
  if (DRY_RUN) {
    const ticks = await dryLiveTicks({ publish, store: publishedStore, shapeNews });
    const day = await dryLiveDay({});
    if (day.problems.length) {
      console.warn(`live day (dry run): FAILED — ${day.problems.length} problem(s)`);
      process.exitCode = 1;
    }
    return ticks;
  }
  const origin = process.env.FLOWS_LIVE_ORIGIN || null;
  const force = process.env.FLOWS_LIVE_FORCE === "1";
  const reportErrors = (result) => {
    const errors = result && result.run ? result.run.errors : [];
    if (errors.length) console.warn(`live: ${errors.length} key(s) not published — ${errors.join("; ")}`);
    return passOutcome(result);
  };
  let clockBody = null;
  const readClock = () => readLiveClock(readStoredOnce, { seen: (body) => { clockBody = body; } });
  const settle = (loop) => {
    const verdict = liveRunVerdict(loop);
    if (loop && loop.watch) {
      console.log(`live: witness — confirmed lapses: ${loop.watch.breached.join(", ") || "none"}; issues still open: ` +
        `${loop.watch.open.join(", ") || "none"}`);
    }
    if (verdict.failed) {
      console.warn(`live: FAILED — ${verdict.why}`);
      process.exitCode = 1;
    }
    return loop;
  };
  if (force || process.env.FLOWS_LIVE_LOOP !== "1") {
    const clock = force ? null : await readClock();
    const result = await runLive({ uw, publish, readStored, shapeNews, origin, force, clock });
    settle({ passes: [reportErrors(result)] });
    return result;
  }
  const keep = process.env.FLOWS_LIVE_KEEP === "1";
  const watch = keep
    ? createWatch({ readOnce: readStoredOnce, latestClock: () => clockBody, env: process.env })
    : null;
  let timedOutAtPass = stats.timedOut;
  const loop = await runLiveLoop({
    readClock, watch, progress: wireProgress.lastAt,
    onHung: ({ why }) => {
      if (why === "tick-deadline") return;
      console.warn(`live: ${stats.timedOut - timedOutAtPass} vendor request(s) timed out after ${vendorTimeoutMs() / 1000} s ` +
        "in the abandoned pass before it was given up");
    },
    pass: async ({ first, clock }) => {
      resetPublishRetryBudget();
      const timedOutBefore = stats.timedOut;
      timedOutAtPass = timedOutBefore;
      const result = await runLive({ uw, publish, readStored, shapeNews, origin, skipRecent: first, clock });
      const outcome = reportErrors(result);
      const timedOut = stats.timedOut - timedOutBefore;
      if (timedOut) console.warn(`live: ${timedOut} vendor request(s) timed out after ${vendorTimeoutMs() / 1000} s`);
      return timedOut ? { ...outcome, timedOut } : outcome;
    },
    chain: ({ at }) => (keep
      ? chainWithRetry(() => chainDispatch({ env: process.env, at }))
      : chainDispatch({ env: process.env, at })),
  });
  settle(loop);
  if (loop.exit === "hung") process.exit(process.exitCode || 1);
  return loop;
}

async function main() {

  if (LIVE_MODE) return runLiveMode();

  const stages = createStageRunner({ clock: () => (stampPinned() ? 0 : Date.now()), calls: () => stats.calls });
  bindStages(stages);
  stages.step("session");

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

  const intraday = DRY_RUN
    ? null
    : intradayRefusal(sessionDate, { allow: process.env.FLOWS_ALLOW_INTRADAY === "1" });
  if (intraday && intraday.refuse) throw new Error(intraday.message);
  if (intraday && intraday.allowed) console.warn(`WARNING: ${intraday.message}`);

  const gateOrigin = nextTradingDay(sessionDate, null) || today;

  const archive = {};
  if (!DRY_RUN) for (const key of sessionArchiveKeys(sessionDate)) archive[key] = await readStored(key);
  const gate = sameSessionGate({
    sessionDate,
    archive,
    republish: process.env.FLOWS_REPUBLISH_SESSION === "1",
  });
  console.log(`session gate: ${gate.mode} — ${gate.note}`);
  const wall = easternNow();
  if (gate.skip && sessionBarOverdue(sessionDate, wall)) {
    console.warn(
      `NOTE: the vendor's SPY series carries no bar for ${wall.date}, a trading day, so the newest ` +
      `closed session is ${sessionDate}, which is already archived. The vendor has not published ` +
      "its bar yet and the workflow should be dispatched again once it has.");
  }
  if (gate.skip) {
    const refreshedAt = stampNow();
    await publishPulse({ sessionDate, generatedAt: refreshedAt });
    await publishSectorPremium({ sessionDate, generatedAt: refreshedAt });
    await publishNews({ sessionDate, generatedAt: refreshedAt });
    console.log(
      `unranked refresh done: pulse, sector:premium and news were re-read for ${sessionDate}; ` +
      "board:long, board:short, board:watch, scores, scoretrack, record, events, movers, " +
      "market, unusual, flowalerts, cards, brief and meta are left as the store holds them, " +
      `written by the run that archived this session (${gate.generatedAt || "unstamped"}) as far ` +
      `as that run got. ${stats.calls} API call(s).`);
    if (gate.mode === "partial") {
      console.warn(`  ARCHIVE INCOMPLETE: ${gate.note}`);
      console.warn(`  ${republishRepair(sessionDate)}`);
      process.exitCode = 1;
    }
    return;
  }

  stages.step("universe");
  const dating = await verifyDating(sessionDate);
  console.log(`dating: date=${dating.date} end_date=${dating.endDate ? "sent" : "dropped"}` +
    (dating.endDateHonoured === null ? ""
      : dating.endDateHonoured ? " (honoured by the vendor)"
        : ` (NOT honoured: the probe returned ${dating.endDateLatest}; candles are cut locally)`) +
    ` screener date=${dating.screenerDate}`);

  const CAP_BANDS = capBands({ min: UNIVERSE.minMarketCap, max: 4e12, ratio: 1.3 });

  let screener;
  let screenerTruncated = 0;
  let screenerReadAt = null;
  const screenerFilters = {
    min_underlying_price: UNIVERSE.minPrice, min_volume: UNIVERSE.minOptionVolume,
    min_oi: UNIVERSE.minOpenInterest, min_marketcap: UNIVERSE.minMarketCap,
  };
  const screenerDate = sessionDate && dating.screenerDate ? sessionDate : null;
  let harvest = null;
  let universeSource = null;
  if (!DRY_RUN) {
    const read = await harvestScreener(uw, { filters: screenerFilters, date: screenerDate });
    console.log(`  screener harvest: ${read.rows.length} row(s) in ${read.pages} page(s) of ${read.limit}` +
      (read.truncated ? " — TRUNCATED at the page cap" : "") + (read.repeated ? " — a page repeated" : "") +
      (read.errors.length ? ` — ${read.errors.join("; ")}` : ""));
    if (read.rows.length && !read.truncated && !read.repeated && !read.errors.length) harvest = read;
    else console.warn("  screener harvest: not usable, so the cap-band sweep reads the universe instead");
  }
  const dryScreener = DRY_RUN ? [...fakeScreener(420), ...fakeFocusRows()] : null;
  const vendor = DRY_RUN ? makeFakeVendor({ sessionDate, screenerRows: dryScreener }) : uw;
  if (DRY_RUN) {
    screener = dryScreener.filter((r) => num(r.marketcap) >= UNIVERSE.minMarketCap);
    screenerReadAt = stampNow();
  } else if (harvest) {
    screener = harvest.rows;
    screenerReadAt = stampNow();
  } else {
    const byTicker = new Map();
    const sweepStartedAt = stampNow();
    let saturated = 0, split = 0, sweepReads = 0;
    const readBand = (min, max) => uw("/api/screener/stocks", {
      min_underlying_price: UNIVERSE.minPrice,
      min_volume: UNIVERSE.minOptionVolume,
      min_oi: UNIVERSE.minOpenInterest,
      min_marketcap: min,
      ...(max === null ? {} : { max_marketcap: max }),
      ...(sessionDate && dating.screenerDate ? { date: sessionDate } : {}),
    }).catch(() => []);
    for (const band of CAP_BANDS) {
      const [min, max] = band;
      const swept = await sweepScreenerBand(band, readBand);
      sweepReads += swept.reads || 0;
      for (const row of swept.rows) if (row && row.ticker) byTicker.set(row.ticker, row);
      const label = max === null
        ? `>= $${(min / 1e9).toFixed(1)}B`
        : `$${(min / 1e9).toFixed(1)}-${(max / 1e9).toFixed(1)}B`;

      if (swept.split) split++;
      saturated += swept.truncated;
      console.log(`  screener ${label.padEnd(14)} ${String(swept.rows.length).padStart(3)} rows` +
                  `${swept.truncated ? " CAP" : "   "}` +
                  `  (union ${byTicker.size})` +
                  (swept.split
                    ? ` — the first page was full, so the band was split into ` +
                      `${swept.leaves.length} and read ${swept.reads} time(s)`
                    : ""));
    }
    screener = [...byTicker.values()];
    screenerReadAt = stampNow();
    screenerTruncated = saturated;
    universeSource = {
      rows: screener, calls: sweepReads, pages: sweepReads, limit: SCREENER_PAGE_ROWS,
      truncated: saturated > 0, repeated: false, errors: [], dated: !!screenerDate, source: "sweep",
      readAt: sweepStartedAt,
    };
    if (saturated) {
      console.warn(
        `  screener: ${saturated} band leaf/leaves still returned the full ` +
        `${SCREENER_PAGE_ROWS}-row page after splitting ${SCREENER_SPLIT_DEPTH} level(s) ` +
        `deep, so those leaves are TRUNCATED and the universe inside them is incomplete.`);
    } else if (split) {
      console.log(`  screener: ${split} full band(s) were split and every leaf read whole`);
    }
  }

  const holdings = await readHoldings(vendor);
  const membership = ndxMembership(holdings.rows, { fallback: NDX_100 });
  const ndx = ndx10(holdings.rows, screener, { fallback: NDX_100 });
  const focusDeep = focusDeepSet(ndx);
  const coverageNotes = [];
  console.log(`  nasdaq-100: ${membership.members.length} member(s) from ` +
    (membership.fallback
      ? `the ${NDX_AS_OF} constant plus the read — FALLBACK: ${membership.fallback}`
      : `the vendor's QQQ holdings dated ${membership.asOf || "undated"}`) +
    (membership.added.length ? `; ${membership.added.length} not in the constant (${membership.added.slice(0, 12).join(", ")})` : "") +
    (membership.dropped.length ? `; ${membership.dropped.length} in the constant and no longer held (${membership.dropped.slice(0, 12).join(", ")})` : ""));
  console.log(`  NDX 10: ${ndx.tickers.join(", ") || "none"} (${ndx.source})`);
  if (membership.fallback) coverageNotes.push(`Nasdaq-100 membership fell back to the ${NDX_AS_OF} constant: ${membership.fallback}.`);
  if (ndx.source.startsWith("fallback")) coverageNotes.push(`The NDX 10 was ranked by market cap (${ndx.source}).`);
  const ndxAge = ndxConstantAge(sessionDate);
  if (ndxAge.stale) {
    coverageNotes.push(`The Nasdaq-100 fallback constant is ${ndxAge.days} days old (dated ${NDX_AS_OF}); refresh it from the QQQ holdings.`);
    console.warn(`  nasdaq-100: the fallback constant is ${ndxAge.days} days old (dated ${NDX_AS_OF})`);
  }
  const guaranteed = [...new Set([...membership.members, ...FOCUS_MAG7, ...FOCUS_MINERS, ...ndx.tickers])];
  {
    const fetched = await fetchMissingMembers(vendor, guaranteed, new Set(screener.map((r) => r && r.ticker)),
      { date: screenerDate });
    if (fetched.rows.length) screener = screener.concat(fetched.rows);
    console.log(`  guaranteed names: ${guaranteed.length}; ${fetched.asked.length} absent from the harvest` +
      (fetched.calls ? `, read by ticker in ${fetched.calls} call(s): ${fetched.rows.length} returned` +
        (fetched.missing.length ? `, ${fetched.missing.length} unknown to the screener (${fetched.missing.slice(0, 12).join(", ")})` : "") +
        (fetched.ok ? "" : ` — the read FAILED (${fetched.error})`) : ""));
  }

  const eligibleFor = (row) => eligible(row) || (!!row && focusDeep.has(row.ticker) && eligible(row, { skipCap: true }));
  const universe = screener.filter(eligibleFor);
  console.log(`universe: ${universe.length} eligible of ${screener.length} screened`);
  if (universe.length < 50) throw new Error(`universe too small (${universe.length}) — refusing to publish`);

  const screenerByTicker = new Map(universe.map((r) => [r.ticker, r]));

  const withTilt = universe.map((row) => ({ row, tilt: screenerTilt(row) }));
  const gateOf = (row) => {
    const dte = daysToEarnings(row, gateOrigin);
    return dte === null || dte < 0 || dte > EARNINGS_GATE_DAYS ? null
      : { earnings: String(row.next_earnings_date).slice(0, 10), dte };
  };
  const tilted = withTilt.filter(({ row }) => !gateOf(row));
  const gatedTickers = new Set(withTilt.filter(({ row }) => gateOf(row)).map(({ row }) => row.ticker));
  console.log(`after earnings gate: ${tilted.length}`);

  const tiltByPick = new Map(withTilt.map(({ row, tilt }) => [row.ticker, tilt]));
  const scoredCoverage = selectCoverage(tilted.map(({ row }) => row), {
    count: UNIVERSE.enrichCount,
    guaranteed,
  });
  const scoredPicked = new Set(scoredCoverage.map(({ row }) => row.ticker));
  const gatedPool = selectCoverage(withTilt.map(({ row }) => row), {
    count: UNIVERSE.enrichCount,
    guaranteed,
  }).filter(({ row }) => !scoredPicked.has(row.ticker) && gatedTickers.has(row.ticker));
  const gatedCoverage = gatedPool.filter(({ row }) => gatedWorthEnriching(row, { focus: focusDeep }));
  const gatedThin = gatedPool.filter(({ row }) => !gatedWorthEnriching(row, { focus: focusDeep })).map(({ row }) => row.ticker);
  const picks = scoredCoverage.concat(gatedCoverage).map(({ row, why }) => ({
    row, why, tilt: tiltByPick.get(row.ticker) || screenerTilt(row), gate: gateOf(row),
  }));
  const byIndex = scoredCoverage.filter((p) => p.why === PICK_INDEX).length;
  const focusMissing = [...focusDeep].filter((t) => !picks.some((p) => p.row.ticker === t));
  console.log(
    `enriching ${picks.length} names: ${scoredCoverage.length - byIndex} by market cap ` +
    `(the largest ${UNIVERSE.enrichCount} of ${tilted.length} gated), ` +
    `${byIndex} added by Nasdaq-100 membership, the Mag 7 and the miners ` +
    `(${membership.fallback ? `constant dated ${NDX_AS_OF}` : `QQQ holdings ${membership.asOf || "undated"}`}), ` +
    `${gatedCoverage.length} inside the ${EARNINGS_GATE_DAYS}-day earnings gate carded without a score` +
    (gatedThin.length ? ` (${gatedThin.length} more gated name(s) skipped before enrichment: their 30-day average ` +
      `dollar volume is under ${Math.round(GATED_LIQUIDITY_MARGIN * 100)}% of the ` +
      `$${(UNIVERSE.minDollarVolume / 1e6).toFixed(0)}M card floor — ${gatedThin.slice(0, 12).join(", ")})` : "") + "; " +
    `${focusDeep.size - focusMissing.length} of ${focusDeep.size} focus name(s) among them` +
    (focusMissing.length ? ` (not screened or not eligible: ${focusMissing.join(", ")})` : ""));

  stages.step("enrich");
  const enriched = [];
  let failed = 0;
  let pastNames = 0, pastBars = 0, pastLatest = null;
  {
    const lane = poolWidth(2);
    console.log(`  enrichment: ${lane.width} name(s) in flight — ${lane.why}`);

    const { results } = await runPooled(picks, async (pick, i) => {
      const ticker = pick.row.ticker;
      const spot = num(pick.row.close);
      try {
        let raw;
        if (DRY_RUN) {
          const fake = fakeEnrichment(ticker, spot, 1000 + i, pick.tilt ? pick.tilt.iv30 : null);
          const past = candleCut(fake.ohlc, sessionDate);
          raw = { ...fake, ohlc: sessionCandles(fake.ohlc, sessionDate) };
          if (past.past) { pastNames++; pastBars += past.past; }
        } else {
          const read = await enrich(ticker, spot, sessionDate, dating);
          raw = read.raw;
          if (read.pastSession) {
            pastNames++;
            pastBars += read.pastSession;
            if (!pastLatest || read.pastLatest > pastLatest) pastLatest = read.pastLatest;
          }
        }
        const features = computeFeatures({ ...raw, ticker, spot, sessionDate, tilt: pick.tilt });
        return { features, raw, tilt: pick.tilt, row: pick.row, gate: pick.gate || null };
      } catch (error) {
        console.warn(`  ${ticker}: enrichment failed — ${error.message}`);
        return null;
      }
    }, { width: lane.width });
    for (const e of results) {
      if (e) enriched.push(e); else failed++;
    }
  }
  console.log(pastNames
    ? `  candles: ${pastNames} name(s) came back with ${pastBars} bar(s) dated after ` +
      `${sessionDate}${pastLatest ? ` (latest ${pastLatest})` : ""} — cut before any feature ` +
      "read them, so no partial session reaches ATR, realized vol, GARCH, returns or the record"
    : `  candles: no name returned a bar dated after ${sessionDate || "the session"}`);
  {
    const onRead = enriched.filter((e) => e.features.spotBasis !== "session-close").length;
    console.log(`  reference price: ${enriched.length - onRead} of ${enriched.length} name(s) ` +
      `priced from the ${sessionDate || "session"} daily close` +
      (onRead ? `; ${onRead} carried no bar for the session and use the screener's read price` : ""));
  }

  const completeness = enriched.length / picks.length;
  console.log(`enrichment: ${enriched.length}/${picks.length} (${(completeness * 100).toFixed(1)}%), ${failed} failed`);
  if (completeness < 0.8) {
    throw new Error(
      `completeness ${(completeness * 100).toFixed(1)}% below the 80% gate — publishing nothing`,
    );
  }

  stages.step("score");
  const MIN_ROWS = 10;

  const scorable = enriched.filter((e) => !e.gate);
  const liquid = scorable.filter((e) => e.features.dollarVolume >= UNIVERSE.minDollarVolume);
  const dropped = scorable.length - liquid.length;
  console.log(
    `liquidity floor: ${liquid.length}/${scorable.length} clear ` +
    `$${(UNIVERSE.minDollarVolume / 1e6).toFixed(0)}M median daily dollar volume` +
    (dropped ? ` (${dropped} dropped)` : ""),
  );
  const byCard = new Map(liquid.map((e) => [e.features.ticker, e]));
  for (const e of enriched) {
    const t = e.features.ticker;
    if (byCard.has(t)) continue;
    if (focusDeep.has(t) || (e.gate && e.features.dollarVolume >= UNIVERSE.minDollarVolume)) byCard.set(t, e);
  }
  const focusCarded = [...focusDeep].filter((t) => byCard.has(t));
  console.log(`  cards planned: ${byCard.size} name(s) — ${liquid.length} scored, ` +
    `${[...byCard.values()].filter((e) => e.gate).length} gated, ` +
    `${focusCarded.length} focus name(s) built deep whatever their board rank`);
  if (liquid.length < 2 * MIN_ROWS) {
    throw new Error(
      `only ${liquid.length} names clear the liquidity floor — publishing nothing ` +
      `rather than a board of names that cannot be traded at these costs`,
    );
  }

  const variationRun = measureVariationProbes(scorable, sessionDate);
  for (const line of variationRun.lines) console.log(line);

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

  const generatedAt = stampNow();
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

  stages.step("boards");
  const previous = {};
  const boardMemory = {};
  for (const side of ["long", "short"]) {
    const live = DRY_RUN ? fakePriorBoard(side, sides[side], sessionDate) : null;
    boardMemory[side] = await resolveBoardMemory(side, sessionDate, DRY_RUN
      ? { reader: async (key) => (key === "board:" + side
        ? { payload: live, absent: !live, status: 0 }
        : { payload: null, absent: true, status: 0 }) }
      : {});
    previous[side] = boardMemory[side].rows;
  }

  const sessionRowByTicker = new Map(screenerByTicker);
  for (const e of unique) sessionRowByTicker.set(e.row.ticker, sessionRow(e.row, e.features));

  if (gate.mode === "republish") {
    const retired = await retireSession(sessionDate);
    console.log(`  republish: ${retired.removed.length} archive key(s) deleted` +
      (retired.removed.length ? ` (${retired.removed.join(", ")})` : "") +
      (retired.absent.length ? `, ${retired.absent.length} already absent` : ""));
    if (retired.refused.length) {
      throw new Error(
        `republish_session: the store refused to delete ${retired.refused.map((r) =>
          `${r.key} (HTTP ${r.status})`).join(", ")}` +
        (retired.kept.length ? ` and left ${retired.kept.join(", ")} standing` : "") +
        " — publishing nothing ranked, so the live boards cannot diverge from an archive " +
        "this run was unable to replace. scores is always deleted last, so the session still " +
        "reads as archived, or as partly archived, and a later plain run skips it; dispatch " +
        "with republish_session again to finish the rewrite");
    }
  }

  const published = {};
  const payloads = {};
  const first = scored[0] || {};
  for (const side of ["long", "short"]) {
    published[side] = toRows(sides[side], sessionRowByTicker, previous[side], gateOrigin);
  }

  for (const side of ["long", "short"]) {
    const rows = published[side];
    const memory = boardMemory[side];
    console.log(
      `  board:${side} memory: ${memory.status} — ` + (memory.incumbents
        ? `${rows.filter((r) => r.nw).length} new, ` +
          `${rows.filter((r) => r.hy).length} held on incumbency, of ${rows.length} ` +
          `(${memory.incumbents} incumbent${memory.incumbents === 1 ? "" : "s"} from ` +
          `${memory.sessionDate || "a board carrying no session date"})` +
          (memory.source === "archive" ? ` — read from ${memory.key}` : "")
        : memory.note));
  }

  const deepSet = new Set(deepNames(published).map((d) => d.t));
  const sideOfRow = new Map();
  for (const side of ["long", "short"]) for (const r of published[side] || []) if (r && r.t) sideOfRow.set(r.t, side);
  const deepTickers = [...deepSet, ...focusCarded.filter((t) => !deepSet.has(t))];
  const deepCarded = new Set(deepTickers);
  const uniqueByTicker = new Map(unique.map((e) => [e.features.ticker, e]));
  const boardVariation = (ticker) => {
    const e = uniqueByTicker.get(ticker);
    if (!e) return null;
    try {
      return variationSummary(variation(featuresVariationInput(e, sessionDate),
        variationOptions(variationRun)));
    } catch (error) {
      console.warn(`  variation ${ticker}: ${error.message}`);
      return null;
    }
  };
  for (const side of ["long", "short"]) {
    for (const row of published[side]) {
      if (deepCarded.has(row.t)) row.dp = 1;
      row.variation = boardVariation(row.t);

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

      gateOrigin,
      gateDays: EARNINGS_GATE_DAYS,

      memory: {
        status: boardMemory[side].status,
        sessionDate: boardMemory[side].sessionDate,
        named: boardMemory[side].named,
        incumbents: boardMemory[side].incumbents,
        source: boardMemory[side].source,
        note: boardMemory[side].note,
      },
      universe: universe.length,
      enriched: scorable.length,

      scored: scored.length,
      dispersion: Number.isFinite(first.dispersion) ? Number(first.dispersion.toFixed(4)) : null,
      deadBand: sides.deadBand,
      neutral: sides.neutral,

      cleared: sides[side].length,
      shed: sides[side].length - rows.length,

      horizonSessions: HORIZON_SESSIONS,
      weights: first.weights || null,
      scoreVariance: first.scoreVariance || null,
      variation: boardVariationMeta(variationRun),
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
  const earlyRoster = DRY_RUN ? Promise.resolve(null)
    : readStored("roster", { budget: { spentMs: 0, budgetMs: 5_000 } }).catch(() => null);

  await stages.run("watch", async () => {
    const watchRows = toWatchRows(sides.neutralRows, sessionRowByTicker, tiltByTicker);
    await publish("board:watch", {
      v: BOARD_SCHEMA_VERSION,
      side: "watch", generatedAt, sessionDate,
      rows: watchRows,
      universe: universe.length,
      enriched: scorable.length,
      scored: scored.length,
      dispersion: Number.isFinite(first.dispersion) ? Number(first.dispersion.toFixed(4)) : null,
      deadBand: sides.deadBand,

      neutral: sides.neutral,
      horizonSessions: HORIZON_SESSIONS,
      weights: first.weights || null,
      status: watchRows.length ? "ok" : "thin",
    });
  }, (error) => {
    console.warn(`  watch: ${error.message}`);
  });

  let scoresPayload = null;
  if (ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    await stages.run("scores", async () => {
      const scoreRows = scoresRows(sides);
      scoresPayload = {
        v: BOARD_SCHEMA_VERSION, generatedAt, sessionDate,
        deadBand: sides.deadBand,
        selectionEpoch: SELECTION_EPOCH,
        rows: scoreRows,
        status: scoreRows.length ? "ok" : "empty",
      };
      await publish(`scores:${sessionDate}`, scoresPayload);
      console.log(`  scores: ${scoreRows.length} name(s) archived for ${sessionDate}`);
    }, (error) => {
      console.warn(`  scores: ${error.message}`);
    });
  } else {
    console.warn(
      "  scores: no session date, so the pool cannot be archived under a dated key this run");
    stages.skip("scores", "no session date");
  }

  await stages.run("market", async () => {
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
  }, (error) => {
    console.warn(`  market: ${error.message}`);
  });

  let moversPayload = null;
  await stages.run("movers", async () => {
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
  }, (error) => {
    console.warn(`  movers: ${error.message}`);
  });

  const cardX = makeCardXStore();
  let marketLegs = null;
  await stages.run("market-legs", async () => {
    marketLegs = await runMarketLegs({
      uw: withPrefetched(vendor, new Map([[holdings.path, holdings]])),
      sessionDate, screenerDate, generatedAt, harvest: harvest || universeSource, filters: screenerFilters, eligible: eligibleFor,
      cardedTickers: [...byCard.keys()],
      deepTickers,
      windowTickers: windowTickersOf(withTilt.map((w) => w.row), { origin: sessionDate || gateOrigin }),
      deadline: stats.startedAt + DEADLINE_MS, pool: runPooled, width: poolWidth(2).width, stats,
      log: (line) => console.log(line),
    });
    for (const [t, part] of marketLegs.ownership) {
      cardX.add(t, "short", part.short);
      cardX.add(t, "insiders", part.insiders);
    }
    for (const [t, e] of marketLegs.earnings) cardX.add(t, "earnings", e);
    console.log(`  market legs: ${marketLegs.calls ?? 0} vendor call(s)`);
  }, (error) => {
    console.warn(`  market legs: ${error.message} — universe, regime and card-x were not built this run`);
  });
  if (marketLegs) {
    await stages.run("market-universe", () => publish("universe", marketLegs.universe), (error) => {
      console.warn(`  universe: ${error.message} — the other market keys are published regardless`);
    });
    await stages.run("market-regime", () => publish("regime", marketLegs.regime), (error) => {
      console.warn(`  regime: ${error.message} — the other market keys are published regardless`);
    });
  } else {
    stages.skip("market-universe", "the market legs did not run");
    stages.skip("market-regime", "the market legs did not run");
  }

  await stages.run("events", async () => {

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
      const dte = daysToEarnings(row, gateOrigin);
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
      ...(marketLegs ? marketLegs.eventsAdditions : {}),
      notes: EVENTS_NOTES,
    });
    const gatedShown = events.byStage.gated || 0;
    console.log(
      `  events: ${events.shown} of ${events.inWindow} names reporting within ` +
      `${events.windowDays} days, of ${events.universe} screened` +
      (events.undated ? ` (${events.undated} carry no earnings date)` : "") +
      `; ${gatedShown} of them the board was gated out of, ` +
      `${events.evMeasured} with a priced move, ${events.rvMeasured} with realized vol`);
  }, (error) => {
    console.warn(`  events: ${error.message}`);
  });

  let archiveWalk = null;
  await stages.run("record", async () => {
    archiveWalk = await archiveWalkPromise;
    if (!archiveWalk) throw new Error("the dated-archive walk returned nothing to score");
    const { boards: datedBoards, probed: archiveProbed, failed: archiveFailed = 0,
      absent: archiveAbsent = 0, recovered: archiveRecovered = 0,
      statuses: archiveStatuses = [], abandoned: archiveAbandoned = false } = archiveWalk;
    const recordCloses = buildRecordCloses(enriched, datedBoards, sessionDate);
    const recordBreaks = buildRecordBreaks(enriched);
    const calendar = recordCalendar(enriched, datedBoards, sessionDate);
    const closeSources = recordCloses.sources || { boardPx: 0, boardPxRefused: 0 };
    console.log(`  record closes: ${recordCloses.size} name(s) from candles cut at ` +
      `${sessionDate}; ${closeSources.boardPx} archived board price(s) used as closes, ` +
      `${closeSources.boardPxRefused} refused because their archive was not written ` +
      "between that session's close and the next open");
    const rec = scoreSessions(datedBoards, recordCloses, calendar, {
      horizons: RECORD_HORIZONS,
      statedK: HORIZON_SESSIONS,
      maxSessions: RECORD_MAX_SESSIONS,

      epoch: SELECTION_EPOCH,
      breaks: recordBreaks,
    });
    const features = icTable(datedBoards, recordCloses, calendar, {
      k: HORIZON_SESSIONS, minN: RECORD_IC_MIN_N, pearson, percentileRank,
      breaks: recordBreaks,
      through: sessionDate,
      hrSessions: HORIZON_SESSIONS,
    });
    let conviction;
    try {
      conviction = evaluateConviction(datedBoards, recordCloses, calendar, {
        epoch: SELECTION_EPOCH, breaks: recordBreaks, through: sessionDate,
      });
    } catch (error) {
      console.warn(`  conviction: ${error.message} — the record publishes without a verdict`);
      conviction = {
        v: 1, status: "unavailable", verdict: "pending", label: CONVICTION_LABELS.pending, addBreadth: false,
        reason: "the evaluation failed on this run", horizons: [],
      };
    }
    await publish("record", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      status: "ok",
      statedHorizon: HORIZON_SESSIONS,
      conviction,
      archiveProbed,

      archiveFailed, archiveAbsent, archiveRecovered,
      archiveStatuses, archiveAbandoned,
      attrition: RECORD_NOTES.attrition,
      epochNote: RECORD_NOTES.epoch,
      closeBasis: {
        candlesThrough: sessionDate,
        boardPx: closeSources.boardPx,
        boardPxRefused: closeSources.boardPxRefused,
        rule: "Forward returns are scored from daily closes cut at this session, never " +
          "from a bar still trading. An archived board's price is used as a close only " +
          "when that archive was written between its session's close and the next " +
          "open; a price read while a later session traded is refused, and a name " +
          "with no other close for that date is counted lost rather than scored on it.",
      },
      ...rec,
      features: {
        k: features.k,
        minN: features.minN,
        sessionMinN: features.sessionMinN,
        rankedFrom: features.rankedFrom,
        ranked: features.ranked,
        through: features.through || null,
        method: RECORD_NOTES.method,
        perSession: RECORD_NOTES.perSession,
        ranking: RECORD_NOTES.ranking,
        selection: RECORD_NOTES.selection,
        overlap: RECORD_NOTES.overlap,
        calendar: RECORD_NOTES.calendar,
        cols: features.cols,
      },
    });
    {
      const stated = (conviction.horizons || []).find((h) => h.k === conviction.horizon);
      console.log(`  conviction: ${conviction.verdict} (${conviction.label})` +
        (stated ? `, ${stated.rows} rows over ${stated.sessions} session(s) at k=${stated.k}` +
          (stated.slope ? `, slope ${stated.slope.b} (${stated.slope.lo} to ${stated.slope.hi})` : "") : "") +
        (conviction.reason ? `; ${conviction.reason}` : ""));
    }
    const measuredCols = features.cols.filter((c) => c.ic !== null).length;
    const sessionCols = features.cols.filter((c) => c.icMean !== null);
    console.log(
      `  record: ${rec.retained} retained session(s) of ${archiveProbed} dated key(s) probed` +
      (archiveFailed ? ` (${archiveFailed} READ FAILED, so "retained" is a floor` +
        `${archiveAbandoned ? " and the walk was abandoned" : ""})` : "") + ", " +
      `${rec.sessions.length} scored at k=${HORIZON_SESSIONS}; ` +
      `features ${measuredCols}/${features.cols.length} measured pooled, ` +
      `${sessionCols.length} per session over ` +
      `${sessionCols.length ? Math.max(...sessionCols.map((c) => c.icSessions)) : 0} session(s), ` +
      `${features.ranked} ranked (a rank needs ${features.rankedFrom} sessions)` +
      (features.unscaled ? `; ${features.unscaled} row(s) had no entry volatility to scale by` : ""));

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
  }, (error) => {
    console.warn(`  record: ${error.message}`);
  });

  let scoreTrack = null;

  let scoreTrackPremium = null;

  await stages.run("scoretrack", async () => {
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
  }, (error) => {
    console.warn(`  scoretrack: ${error.message}`);
  });

  if (Date.now() > stats.startedAt + DEADLINE_MS) {
    console.warn(
      `  sector:trix: past the ${DEADLINE_MS / 60000}min deadline — not spending ` +
      `${SECTOR_ETFS.length} calls on a surface that would land after the cards were abandoned`);
    stages.skip("sector-trix", "past the deadline");
  } else {
    await stages.run("sector-trix", async () => {

      const candlesByEtf = new Map();
      for (const { etf } of SECTOR_ETFS) {
        const candles = DRY_RUN
          ? fakeSectorCandles(etf)
          : await uw(`/api/stock/${etf}/ohlc/1d`, {

            timeframe: "1Y",
            ...(sessionDate && dating.endDate ? { end_date: sessionDate } : {}),
          }).catch(() => []);
        candlesByEtf.set(etf, sessionCandles(candles, sessionDate));
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
    }, (error) => {
      console.warn(`  sector:trix: ${error.message}`);
    });
  }

  const chainByTicker = new Map();
  const quantRows = new Map();
  let quantPass = { preps: new Map(), crossSection: new Map() };
  let quantRate = null;
  const vannaSamples = [];
  const chainMiss = new Map();
  await stages.run("chains", async () => {

  const boardTickers = deepTickers.slice();
  const spotByTicker = new Map();
  for (const t of focusCarded) {
    const px = num(byCard.get(t).features.spot) || num(byCard.get(t).row.close);
    if (px > 0) spotByTicker.set(t, px);
  }
  for (const side of ["long", "short"]) {
    for (const row of payloads[side].rows) {
      const px = num(row.px);
      if (px > 0) spotByTicker.set(row.t, px);
    }
  }

  let chainReported = false;

  let chainProbed = false;
  const expiriesByTicker = new Map([...byCard.values()].map((e) => [e.features.ticker, e.raw.expiries || []]));
  const spotOfLiquid = new Map([...byCard.values()].map((e) => [e.features.ticker, e.features.spot]));

  if (Date.now() > stats.startedAt + DEADLINE_MS) {
    console.warn(
      `  chains: past the ${DEADLINE_MS / 60000}min deadline — not spending ` +
      `${boardTickers.length} calls on panels that would land after the cards were abandoned`);
  } else {
    const chainDeadline = stats.startedAt + DEADLINE_MS - CHAIN_RESERVE_MS;
    let scalarsRecovered = 0;

    const paging = { names: 0, extra: 0, completed: 0, stillFull: 0, ignored: 0, oneBased: 0 };

    const chainLane = poolWidth();
    console.log(`  chains: ${boardTickers.length} name(s), ${chainLane.width} in flight — ${chainLane.why}`);
    const chainRun = await runPooled(boardTickers, async (ticker, index) => {
      try {
        const readPage = async (page) => (DRY_RUN

          ? fakeChain(ticker, spotByTicker.get(ticker) || 100, 7000 + index,
            { wide: index < 4, page: index === 0 ? page : index === 2 ? Math.max(0, page - 1) : 0 })
          : await uw(`/api/stock/${ticker}/option-contracts`, {

            exclude_zero_oi_chains: "true",
            limit: CHAIN_PAGE_SIZE,
            ...(page ? { page } : {}),
          }));
        const firstPage = await readPage(0);
        const pages = [firstPage];
        let nextPage = 1, countedFromOne = false;
        while (pages[pages.length - 1].length >= CHAIN_PAGE_SIZE && pages.length < CHAIN_MAX_PAGES &&
               Date.now() < chainDeadline) {
          let next;
          try { next = await readPage(nextPage); } catch (error) {
            console.warn(`  chain ${ticker}: page ${nextPage} failed — ${error.message}`);
            break;
          }
          next = Array.isArray(next) ? next : [];
          nextPage++;
          if (nextPage === 2 && next.length &&
              mergeChainPages([firstPage, next]).duplicates === next.length) {
            countedFromOne = true;
            continue;
          }
          pages.push(next);
          if (mergeChainPages(pages).duplicates) break;
        }
        const merged = mergeChainPages(pages);
        const rows = merged.rows;
        quantRows.set(ticker, rows.slice());
        if (nextPage > 1) {
          paging.names++;
          paging.extra += nextPage - 1;
          if (merged.complete) paging.completed++;
          else if (merged.duplicates || (countedFromOne && pages.length === 1)) paging.ignored++;
          else paging.stillFull++;
          if (countedFromOne && !merged.duplicates && pages.length > 1) paging.oneBased++;
        }

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
          ...(pages.length > 1 ? { complete: merged.complete, pages: pages.length } : {}),
        });
        let vannaRows = panels.status === "ok" && !panels.truncated ? rows : null;
        let vannaExpiry = null;

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
              if (Array.isArray(narrow) && narrow.length && narrow.length < CHAIN_PAGE_SIZE) {
                vannaRows = narrow;
                vannaExpiry = near;
              }
              if (Array.isArray(narrow) && narrow.length) quantRows.set(ticker, narrow.concat(quantRows.get(ticker) || []));
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
        try {
          const sample = vannaProbeSample(ticker, {
            rows: vannaRows, expiry: vannaExpiry, sessionDate,
            expiries: expiriesByTicker.get(ticker),
            spot: spotOfLiquid.get(ticker) || spotByTicker.get(ticker) || null,
          });
          if (sample) vannaSamples.push(sample);
        } catch (error) {
          console.warn(`  vanna check (${ticker}): ${error.message}`);
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
      if (!panels) {
        chainFailed++;
        chainMiss.set(ticker, "the option-chain read for this name failed this session, so " +
          "no contract-level panel could be built from it — the failure is named in the run " +
          "log, and the next run reads the chain again");
        return;
      }
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
    if (paging.names) {
      console.log(
        `  chains: ${paging.names} full first page(s) read on with ${paging.extra} further ` +
        `page call(s) (up to ${CHAIN_MAX_PAGES} pages a name): ${paging.completed} now complete, ` +
        `${paging.stillFull} still full at the last page` +
        (paging.ignored
          ? `, ${paging.ignored} where a later page repeated contracts already read — ` +
            "PAGE IGNORED or the order is unstable, so those stay truncated rather than claimed whole"
          : "") +
        (paging.oneBased
          ? `; on ${paging.oneBased} name(s) page=1 returned the first page again, so the ` +
            "vendor was read as counting pages from one there (the spec says zero)"
          : ""));
    }
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

  try {
    const atrOfLiquid = new Map([...byCard.values()].map((e) => [e.features.ticker, e.features.atr]));
    const spotOfQuant = (t) => spotOfLiquid.get(t) || spotByTicker.get(t) || null;
    const needTreasury = !QP.PARITY_SYMBOLS.some((sym) => quantRows.has(sym) && spotOfQuant(sym) > 0);
    const treasuryRaw = !needTreasury ? null : DRY_RUN ? fakeTreasury(sessionDate)
      : await uw("/api/economy/treasury-yield", { interval: "daily", maturity: "3month" }).catch(() => null);
    quantRate = QP.rateFromRuns({ rowsByTicker: quantRows, spotOf: spotOfQuant, sessionDate, treasuryRaw });
    const t0 = Date.now();
    quantPass = QP.preparePass({
      rowsByTicker: quantRows, sessionDate, rate: quantRate, spotOf: spotOfQuant,
      atrOf: (t) => atrOfLiquid.get(t) || null, expiriesOf: (t) => expiriesByTicker.get(t) || [],
      gammaUnit: variationRun.unit.used,
    });
    const zeros = [...quantPass.preps.values()].filter((p) => p.zero && p.zero.px !== null).length;
    const slices = [...quantPass.preps.values()].reduce((a, p) => a + p.built.length, 0);
    console.log(`  quant: rate ${quantRate.r} (${quantRate.method}); ${quantPass.preps.size} name(s) fitted from NBBO quotes, ` +
      `${slices} expiry smile(s), ${zeros} with a zero-gamma level, in ${Date.now() - t0}ms`);
  } catch (error) {
    console.warn(`  quant: the smile pre-pass failed — ${error.message}; cards publish without an engine block`);
  }

  variationRun.vannaScale = vannaScale(vannaSamples, { prior: variationRun.unit.used });
  console.log(`  variation: vanna scale ${variationRun.vannaScale.status}` +
    (variationRun.vannaScale.ratio === null ? "" : `, vendor over Black-Scholes ${variationRun.vannaScale.ratio}`) +
    ` across ${variationRun.vannaScale.n} name(s) with a complete single-expiry chain` +
    `, read in ${variationRun.vannaScale.used === "pct$" ? "dollars per 1% move" : "shares"} (unit ${variationRun.vannaScale.family}: ` +
    `${variationRun.vannaScale.votes.share} share, ${variationRun.vannaScale.votes.pct} dollars-per-1% among names priced far enough from $100 to tell them apart; ` +
    `mean log error ${variationRun.vannaScale.evidence.errorShare} in shares against ${variationRun.vannaScale.evidence.errorPct} in dollars per 1%, ` +
    `log10 likelihood ratio ${variationRun.vannaScale.evidence.log10Ratio} with 2 needed)` +
    (variationRun.vannaScale.reason ? ` — ${variationRun.vannaScale.reason}` : ""));
  const refreshVariation = variationRun.vannaScale.status === "unmeasured" ? null : (row) => {
    const next = boardVariation(row.t);
    if (!next) return false;
    row.variation = next;
    return true;
  };

  for (const line of await republishWithChain(payloads, chainByTicker, sessionDate, publish,
    refreshVariation, boardVariationMeta(variationRun))) {
    console.log(line);
  }
  if (!chainByTicker.size) {
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
        pages: Number(c.pagesRead) || 1,
        p: c.truncated ? 1 : 0,
        ivDivisor: Number.isFinite(c.ivDivisor) ? c.ivDivisor : null,
        ivBasis: c.ivBasis || null,
      });
    }
    const namesSeen = coverage.length;
    const contracts = rankUnusual(pooled, { namesSeen });
    const pooledOiBasis = poolOiBasis(
      [...chainByTicker.values()].filter((c) => c && c.status === "ok").map((c) => c.oiBasis),
      { dryRun: DRY_RUN });
    const names = rankUnusualNames(withTilt);

    const priorUnusual = DRY_RUN
      ? fakePriorUnusual(contracts.rows, sessionDate)
      : await fetchStoredPayload("unusual");

    const priorMark = markNewContracts(contracts.rows, priorUnusual, sessionDate);

    const dated = await readActivity({
      uw, sessionDate, contractRows: contracts.rows, enabled: activityEnabled(), dryRun: DRY_RUN,
    });
    const activity = dated.block;

    await publish("unusual", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      readAt: generatedAt,
      volumeAsOf: null,
      volumeAsOfReason: "the chain endpoint accepts no date parameter and carries no as-of stamp",
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
      activity,
      names: { ...names, earningsGated: withTilt.length - tilted.length },
      basis: {
        unit: UNUSUAL_NOTES.unit,
        date: UNUSUAL_NOTES.date,
        rank: { key: "vor", choice: true, relation: "vor = volume / open_interest",
          reason: UNUSUAL_NOTES.rank },
        oiBasis: {
          chains: pooledOiBasis.chains, seen: pooledOiBasis.seen,
          exceeded: pooledOiBasis.exceeded, exceedShare: pooledOiBasis.exceedShare,
          minSeen: pooledOiBasis.minSeen, verdict: pooledOiBasis.verdict,
        },
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
          "because it sat below the per-name cap on that run.",
        lift: UNUSUAL_NOTES.lift,
        activity: activityBasis(),
        notional: UNUSUAL_NOTES.notional,
        iv: UNUSUAL_NOTES.iv,
        oi: UNUSUAL_NOTES.oi,
        zeroOi: UNUSUAL_NOTES.zeroOi,
        names: UNUSUAL_NOTES.names,
        refusals: UNUSUAL_NOTES.refusals,
      },
    });
    console.log(`  unusual dated classes: ${activity.status}` + (activity.code ? ` (${activity.code})` : "") +
      (activity.status === "ok" || activity.status === "quiet"
        ? `; ${activity.returned} row(s) read for ${activity.asOf}, ${activity.kept} kept, ${activity.offDate} off-session dropped, ` +
          `${activity.matched} of ${activity.of} ranked contract(s) carry classes, ${dated.calls} call(s)` : ""));
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

    console.log("  " + pooledOiBasis.line +
      (DRY_RUN
        ? " On synthetic rows this is two unrelated fixture formulas disagreeing," +
          " and is not evidence about the vendor."
        : ""));

    try {
      const raw = DRY_RUN
        ? fakeFlowAlerts((payloads.long.rows || []).map((r) => r.t))
        : await uw("/api/option-trades/flow-alerts", { limit: ALERT_VENDOR_LIMIT });
      const alertsReadAt = stampNow();

      const vendorRows = unwrapVendorRows(raw);
      const alertRowCount = vendorRows.length;

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
      const night = nightlyAlerts(alerts, await readHeldAlerts(readStored, sessionDate),
        { sessionDate, at: alertsReadAt, stageOf: (t) => stage.get(t) || null });
      let liveAlerts = night.held;
      if (night.alerts) {
        liveAlerts = {
          v: BOARD_SCHEMA_VERSION,
          generatedAt, sessionDate,

          readAt: alertsReadAt,
          readDay: readDayOf(alertsReadAt),
          refreshed: "nightly",
          ...night.alerts,

          vendorLimit: ALERT_VENDOR_LIMIT,
          vendorTruncated: alertRowCount >= ALERT_VENDOR_LIMIT,
          readLimit: night.readLimit,
          readTruncated: night.readTruncated,
        };
        await publish("flowalerts", liveAlerts);
      } else if (night.held) {
        publishedStore.flowalerts = night.held;
      }
      const nightSaid = {
        merged: () => `merged into the ${sessionDate} intraday record, now ${night.alerts.record.reads} ` +
          `read(s) holding ${night.alerts.rows.length} of ${night.alerts.seen} window(s) ` +
          `(${night.alerts.record.entered} new, ${night.alerts.record.again} seen again)`,
        kept: () => `NOT WRITTEN — the store holds the ${sessionDate} intraday record and this read ` +
          "shaped no rows, so the record stands rather than being replaced by an empty read",
        newer: () => `NOT WRITTEN — the store holds the ${night.day} intraday record, a later session ` +
          `than ${sessionDate}, and a read published under ${sessionDate} would replace it`,
        unverified: () => "NOT WRITTEN — the stored feed could not be read, so whether it is this " +
          "session's intraday record is unknown and a single read would replace it; the brief " +
          "states no alert count",
        snapshot: () => `published as a single read — the store holds no intraday record for ${sessionDate}`,
      };
      console.log("  flow-alerts: " + nightSaid[night.mode]());
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
      const first = vendorRows.find((r) => r && typeof r === "object") || null;
      console.log(`  flow-alerts: time fields on the first row — start_time ${first ? typeof first.start_time : "absent"}, ` +
        `end_time ${first ? typeof first.end_time : "absent"}, created_at ${first ? typeof first.created_at : "absent"}; ` +
        `${alerts.coverage.withSpan} of ${alerts.rows.length} kept rows carry a window` +
        (alerts.coverage.spanFromCreated ? `, ${alerts.coverage.spanFromCreated} of them dated only by created_at` : ""));
      if (alerts.rows.length && alerts.coverage.withSpan < alerts.rows.length / 2) {
        console.warn(`  flow-alerts: NOTE only ${alerts.coverage.withSpan} of ${alerts.rows.length} kept rows carry a ` +
          "time window, so the Window column is mostly a dash and repeated windows on one contract " +
          "collapse into one row of the day's record — first-row sample: " +
          JSON.stringify(first ? { start_time: first.start_time ?? null, end_time: first.end_time ?? null,
            created_at: first.created_at ?? null } : null));
      }

      if (moversPayload) {
        try {
          moversPayload.premium = { ...moversPayload.premium,
            byContract: alertBand(liveAlerts && Array.isArray(liveAlerts.rows) ? liveAlerts.rows : alerts.rows) };
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

  }, (error) => {
    console.warn(`  chains: ${error.message} — the boards published before this leg ran ` +
      "and are unaffected");
  });

  stages.step("pulse");
  const crossRaws = await publishPulse({
    sessionDate, generatedAt, tickers: (payloads.long.rows || []).map((r) => r.t),
  });

  let politicalFilings = null;

  const POLITICAL_WINDOW_DAYS = 90;

  await stages.run("political", async () => {
    const POLITICAL_PAGE_LIMIT = 200;
    const POLITICAL_MAX_PAGES = 8;
    const POLITICAL_HOLDER_NAMES = 6;
    const from = new Date(Date.parse((sessionDate || stampNow().slice(0, 10)) +
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
      const refusal = holdersRefusal(await fetchStoredPayload("political"), sessionDate);
      if (refusal) {
        raws.holders = { __failed: refusal.reason };
        console.log(`  political holders: ${refusal.reason}`);
      }
      for (const ticker of refusal ? [] : holderNames) {
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
      readAt: stampNow(),

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
  }, (error) => {
    console.warn(`  political: ${error.message} — every key above published before this leg ran`);
  });

  stages.step("sector-news");
  await publishSectorPremium({ sessionDate, generatedAt });

  await publishNews({
    sessionDate, generatedAt, tickers: (payloads.long.rows || []).map((r) => r.t),
  });

  stages.step("congress");
  const onBoard = new Map();
  for (const t of deepTickers) onBoard.set(t, sideOfRow.get(t) || null);
  const byTicker = byCard;
  const scoredByTicker = new Map(scored.map((r) => [r.ticker, r]));

  const crossSectionTickers = [...byTicker.keys()].filter((t) => !onBoard.has(t));
  const cardedTickers = [...onBoard.keys()].concat(crossSectionTickers);
  const carded = new Set(cardedTickers);

  const congressByTicker = new Map();

  let congressRead = "not attempted";
  let congressTapeRows = 0;
  const congressNamesRead = new Set();
  if (onBoard.size) {
    let marketWide = 0;
    try {

      const recent = DRY_RUN
        ? [...onBoard.keys(), ...crossSectionTickers.filter((_, i) => i % 2 === 0)]
          .flatMap((t) => fakeCongress(t))
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
      congressTapeRows = merged.length;

      congressRead = "ok";
      for (const row of merged) {
        const t = row && (row.ticker || row.symbol);
        if (!t || !carded.has(t)) continue;
        if (!congressByTicker.has(t)) congressByTicker.set(t, []);
        congressByTicker.get(t).push(row);
      }
      const boardMatched = [...congressByTicker.keys()].filter((t) => onBoard.has(t)).length;
      console.log(
        `  congress: ${merged.length} disclosure(s) market-wide ` +
        `(${recent.length} from this leg's own page` +
        (politicalFilings
          ? `, ${politicalFilings.length} joined from the political leg's ${POLITICAL_WINDOW_DAYS}-day ladder ` +
            `— the two windows are now one, so a card can no longer deny what /flows/political/ ranks`
          : `; the political ladder read nothing to join, so this card window is the shallow one`) +
        `), ${boardMatched} of ${onBoard.size} board name(s) matched` +
        (crossSectionTickers.length
          ? `, and ${congressByTicker.size - boardMatched} of ${crossSectionTickers.length} ` +
            "cross-section name(s) from the same tape, at no further call"
          : ""));
    } catch (error) {
      congressRead = "failed";
      console.warn(`  congress: market-wide read failed — ${error.message}`);
    }

    if (!marketWide && !DRY_RUN && Date.now() < stats.startedAt + DEADLINE_MS) {
      let recovered = 0;
      for (const ticker of onBoard.keys()) {
        if (Date.now() > stats.startedAt + DEADLINE_MS) break;
        const rows = await uw("/api/congress/recent-trades", { ticker, limit: 50 })
          .then((read) => { congressNamesRead.add(ticker); return read; })
          .catch(() => []);
        if (rows.length) { congressByTicker.set(ticker, rows); recovered++; }
      }
      console.warn(
        `  congress: fell back to ${onBoard.size} per-name calls; ${recovered} name(s) ` +
        `carry disclosures. A panel built from a failed read is a confident zero, ` +
        `which costs more than the calls do.`);
    }
  }
  const congressState = { byTicker: congressByTicker, read: congressRead,
    tapeRows: congressTapeRows, namesRead: congressNamesRead };

  const marketCross = indexMarketCross({
    oiChange: crossRaws ? crossRaws.oiChange : null,
    darkpool: crossRaws ? crossRaws.darkpool : null,
    limits: { oiChange: MARKET_CROSS_LIMIT, darkpool: MARKET_CROSS_LIMIT },
    tickers: cardedTickers.concat(marketLegs ? INDEX_TICKERS.filter((t) => marketLegs.indexRows.has(t)) : [], FOCUS_FUNDS),
    sessionDate,
  });
  const crossReadDay = crossRaws && crossRaws.readAt ? readDayOf(crossRaws.readAt) : null;
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
      (crossReadDay ? `; read on ${crossReadDay} Eastern` : "") +
      `; order ${f.ordered ? f.ordered + " by " + f.orderedBy : "not measurable from the rows"}`);
    if (f.coverage.of && f.coverage.in * 5 < f.coverage.of) {
      console.warn(
        `  cross ${feed}: this join reaches ${f.coverage.in} of ${f.coverage.of} deep names. ` +
        "The other cards will say they did not make a market-wide selection, which is true " +
        "of each of them and is not a finding about any of them.");
    }
  }

  let volLeg = null;
  await stages.run("vol-leg", async () => {
    const volRoster = volNames({ deep: [...onBoard.entries()], crossSection: crossSectionTickers, byTicker,
      funds: FOCUS_FUNDS.filter((t) => !INDEX_TICKERS.includes(t)) });
    volLeg = await runVolLeg({
      uw: DRY_RUN ? fakeVolVendor({ sessionDate, names: volRoster }) : uw,
      names: volRoster, sessionDate, repair: repairCandles,
      pool: (items, work) => runPooled(items, work, {
        width: poolWidth(4).width, stopEarly: () => Date.now() > stats.startedAt + DEADLINE_MS }),
    });
  }, (error) => {
    console.warn(`  vol: the leg failed (${error.message}); every card carries x.vol as unavailable and no card-x is written`);
  });

  stages.step("cards");
  let surfaceReported = false;
  const onSession = ARCHIVE_DATE_RE.test(String(sessionDate || "")) ? { date: sessionDate } : {};
  const perNameCut = { names: 0, darkpool: 0, ivRank: 0 };
  const deadline = stats.startedAt + DEADLINE_MS;
  const cardTickers = [...onBoard.keys()];
  const quantStats = { built: 0, withIdeas: 0, split: 0, failed: 0, bytes: [] };
  const neuronTiers = new Map();
  const cardLane = poolWidth(2);
  const ideaByTicker = new Map();
  console.log(`  cards: ${cardTickers.length} name(s), ${cardLane.width} in flight — ${cardLane.why}`);
  const cardsRun = await runPooled(cardTickers, async (ticker, index) => {
    const e = byTicker.get(ticker);

    if (!e) return { status: "unenriched" };
    try {

      const surfaceExpiries = (e.raw.expiries || [])
        .map((r) => (r && r.expiry ? String(r.expiry).slice(0, 10) : null))
        .filter((d) => d && (!sessionDate || d > sessionDate))
        .sort()
        .slice(0, SURFACE_EXPIRIES);

      const spotPx = num(e.features.spot) || num(e.row.close);

      const congress = congressRows(ticker, congressState);
      const quantPrep = quantPass.preps.get(ticker) || null;
      const [maxPain, surface, dpRaw, oiRaw, termRaw, rankRaw, earnRaw] = DRY_RUN
        ? [fakeMaxPain(ticker, spotPx), fakeSurface(ticker, spotPx, surfaceExpiries),
           fakeStockDarkpool(ticker, spotPx), fakeStockOiChange(ticker, spotPx),
           fakeTermStructure(ticker, spotPx, sessionDate ? { date: sessionDate } : {}),
           fakeIvRank(ticker, spotPx, IV_RANK_PARAMS), quantPrep ? fakeEarnings(ticker, sessionDate) : null]
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

          uw(`/api/darkpool/${ticker}`, { limit: 500, ...onSession, ...sessionPrintParams(sessionDate) })
            .catch(() => null),
          uw(`/api/stock/${ticker}/oi-change`, { limit: 30, ...onSession }).catch(() => null),
          uw(`/api/stock/${ticker}/volatility/term-structure`, { ...onSession }).catch(() => null),
          uw(`/api/stock/${ticker}/iv-rank`, { ...IV_RANK_PARAMS, ...onSession }).catch(() => null),

          quantPrep ? uw(`/api/earnings/${ticker}`, {}).catch(() => null) : Promise.resolve(null),
        ]);
      const darkpoolCut = sessionRows(dpRaw, (r) => easternDayOf(r && r.executed_at), sessionDate);
      const darkpoolRth = sessionPrints(dpRaw, sessionDate, { limit: 500 });
      const rankCut = sessionRows(rankRaw, (r) => easternDayOf(r && r.date), sessionDate,
        { through: true });
      if (darkpoolCut.cut || rankCut.cut) {
        perNameCut.names++;
        perNameCut.darkpool += darkpoolCut.cut;
        perNameCut.ivRank += rankCut.cut;
      }

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

      const earnings = quantPrep ? QP.earningsFromVendor(earnRaw, { sessionDate }) : null;
      const garch = earnings ? QP.refitGarch(e.features, earnings.mask) : e.features.garch;
      const card = buildCard({
        ticker,
        row: sessionRow(e.row, e.features),
        features: { ...e.features, ...(scoredByTicker.get(ticker) || {}), garch },
        strikes: e.raw.strikes,
        ticks: e.raw.ticks,
        quant: quantPrep ? { zeroGamma: quantPrep.zero } : null,

        expiries: e.raw.expiries,
        surface,
        chain: chainByTicker.get(ticker) || null,
        chainMissing: chainMiss.get(ticker) || null,

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
        darkpool: darkpoolRth, oiDeltas: oiRaw, termStructure: termRaw, ivRank: rankCut.raw,

        marketCross,
        variation: variationOptions(variationRun),
      });
      card.readPx = readPxOf(e, screenerReadAt);
      if (!deepSet.has(ticker)) card.depth = "focus";
      markGate(card, e);
      attachVol(card, volLeg, ticker, { ivRank: rankCut.raw });
      if (card.panels.darkpool && darkpoolRth && darkpoolRth.session) card.panels.darkpool.session = darkpoolRth.session;

      const { body, dropped } = shedCardToCap(card);
      if (dropped.length) {
        console.warn(`  card ${ticker}: shed ${dropped.join(", ")} to fit the cap`);
      }

      if (body.length > CARD_SELF_CHECK_BYTES) {
        throw new Error(`card is ${(body.length / 1024).toFixed(0)}KB after shedding ` +
          `${dropped.length} panel(s), still over the ingest cap`);
      }
      let engineOut = { card, extra: null, split: false };
      let engineBlock = null;
      if (quantPrep) {
        try {
          const closes = Array.isArray(e.features.candles) ? e.features.candles.map((c) => c && c[4]) : e.features.closes;
          const law = QP.garchLaw({ garch, ticker, sessionDate, closes, rate: quantRate ? quantRate.r : undefined });
          const state = regimeState(card, {});
          const block = QP.engineBlock({
            ticker, sessionDate, spot: spotPx, atr: e.features.atr, card, prep: quantPrep, rate: quantRate,
            garch, law, event: earnings ? earnings.next : null, state, strikes: e.raw.strikes,
            crossSection: quantPass.crossSection.get(ticker) || null, coneThin: coneThinOf(volLeg, ticker),
          });
          engineOut = QP.attachEngine(card, block);
          engineBlock = block;
          const idea = QP.leadIdea(block);
          if (idea) ideaByTicker.set(ticker, idea);
          quantStats.built++;
          if (block && block.ideas.length) quantStats.withIdeas++;
          if (engineOut.split) quantStats.split++;
          quantStats.bytes.push(engineOut.bytes);
        } catch (error) {
          quantStats.failed++;
          console.warn(`  engine ${ticker}: ${error.message} — the card publishes without it`);
        }
      }
      if (engineOut.extra) await publish("card-x:" + ticker, engineOut.extra);
      await publish("card:" + ticker, engineOut.card);
      neuronTiers.set(ticker, cardTier(engineBlock ? { ...card, engine: engineBlock } : card));

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
  if (quantStats.built || quantStats.failed) {
    const big = quantStats.bytes.length ? Math.max(...quantStats.bytes) : 0;
    console.log(`  engine: ${quantStats.built} card(s) carry an engine block, ${quantStats.withIdeas} with ranked ideas, ` +
      `${quantStats.split} split to card-x for the ${QP.QUANT_PIPELINE_LINES.INGEST_CAP / 1024}KB ingest cap` +
      (quantStats.failed ? `, ${quantStats.failed} failed` : "") + `; largest card ${(big / 1024).toFixed(1)}KB`);
  }
  if (quantStats.built) {
    await stages.run("ideas", async () => {
      await publish("ideas", ideasPayload(ideaByTicker, { sessionDate, generatedAt, built: quantStats.built }));
      console.log(`  ideas: the engine's lead structure for ${ideaByTicker.size} of ${quantStats.built} engine card(s)`);
    }, (error) => {
      console.warn(`  ideas: ${error.message} — the boards draw no idea column this session`);
    });
  } else {
    stages.skip("ideas", "no card carries an engine block");
  }
  if (perNameCut.names) {
    console.log(`  per-name feeds: ${perNameCut.names} card(s) carried rows from outside ` +
      `${sessionDate} — ${perNameCut.darkpool} dark-pool print(s) not on the session and ` +
      `${perNameCut.ivRank} IV-rank row(s) dated after it were cut before the card was built`);
  }
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
    const lam = midOf(cards.garchLambda);
    const per = midOf(cards.garchPersistence);
    console.log(
      "  " + (DRY_RUN ? "[dry-run] " : "") +
      `garch: ${cards.garchConverged} of ${fitTotal} fit(s) converged` +
      (cards.garchUnconverged
        ? `, ${cards.garchUnconverged} ran and did not settle` : "") +
      (cards.garchUnavailable
        ? `, ${cards.garchUnavailable} had too short a history to fit` : "") +
      (nu === null ? "" : `; median tail shape nu ${nu.toFixed(2)}` +
        ` (lower is heavier-tailed; near 30 the tails are the normal's)`) +
      (lam === null ? "" : `, median skew lambda ${lam.toFixed(3)}` +
        ` (negative is a heavier left tail, which is where equities sit)`) +
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

  stages.step("cross-cards");
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
            row: sessionRow(e.row, e.features),
            features: { ...e.features, ...(scoredByTicker.get(ticker) || {}) },
            strikes: e.raw.strikes,
            ticks: e.raw.ticks,
            expiries: e.raw.expiries,

            surface: null, chain: null, maxPain: null,

            congress: congressRows(ticker, congressState),
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
            variation: variationOptions(variationRun),
          });
          card.readPx = readPxOf(e, screenerReadAt);
          markGate(card, e);
          attachVol(card, volLeg, ticker);
          const body = JSON.stringify(card);

          if (body.length > 100 * 1024) {
            throw new Error(`cross-section card is ${(body.length / 1024).toFixed(0)}KB, over the ingest cap`);
          }
          await publish("card:" + ticker, card);
          neuronTiers.set(ticker, cardTier(card));
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

  stages.step("vol-flow");
  await publishVol(volLeg, {
    publish, stored: (key) => publishedStore[key] || null, sessionDate, generatedAt, log: (line) => console.log(line) });
  await runFlowLeg({
    uw: DRY_RUN
      ? makeFlowFakeVendor({ sessionDate, spotOf: (t) => byTicker.get(t) && byTicker.get(t).features.spot })
      : uw,
    readStored: DRY_RUN ? makeFlowFakeStore({ sessionDate }) : readStored,
    publish, stored: (key) => publishedStore[key] || null, runPooled,
    deadline, sessionDate, generatedAt,
    deep: cardTickers.filter((t) => byTicker.has(t)), cross: crossSectionTickers,
    featuresOf: (t) => (byTicker.get(t) || {}).features, strikesOf: (t) => ((byTicker.get(t) || {}).raw || {}).strikes,
    cardOf: (t) => publishedStore["card:" + t] || null, variation: variationRun,
    width: poolWidth(3).width, log: (line) => console.log(line),
  });
  stages.step("dossiers");
  const focusAsk = focusTickers({ groups: focusGroups(ndx) });
  const focusRead = await readFocusRows(vendor, [...new Set([...focusAsk, ...FOCUS_FUNDS])], { date: screenerDate });
  console.log(`  focus read: ${focusRead.rows.size} of ${focusAsk.length + FOCUS_FUNDS.filter((t) => !focusAsk.includes(t)).length} ` +
    `row(s) in ${focusRead.calls} call(s)` + (focusRead.missing.length ? `, missing ${focusRead.missing.join(", ")}` : "") +
    (focusRead.ok ? "" : ` — FAILED (${focusRead.error})`));
  const fundRows = new Map();
  for (const t of FOCUS_FUNDS) {
    const row = focusRead.rows.get(t) || (marketLegs && marketLegs.indexRows.get(t));
    if (row) fundRows.set(t, row);
  }
  {
    const lost = FOCUS_FUNDS.filter((t) => !fundRows.has(t));
    if (lost.length && Date.now() < deadline) {
      const again = await readFocusRows(vendor, lost, { date: screenerDate });
      for (const [t, row] of again.rows) fundRows.set(t, row);
      console.log(`  fund rows: ${lost.length} not in the focus read (${lost.join(", ")}), read again in ${again.calls} call(s): ` +
        `${again.rows.size} returned` + (again.ok ? "" : ` — FAILED (${again.error})`));
    }
  }
  const dossierFeatures = new Map();
  const dossierBuilt = new Map();
  {
    const roster = dossierRoster({ index: INDEX_TICKERS, funds: FOCUS_FUNDS });
    const rows = new Map(marketLegs ? marketLegs.indexRows : []);
    for (const [t, row] of fundRows) if (!rows.has(t)) rows.set(t, row);
    const deps = indexDossierDeps({ sessionDate, dating, generatedAt, screenerReadAt, congressState, marketCross, variationRun, volLeg });
    const dossiers = await buildIndexDossiers({
      tickers: roster.tickers, depthOf: (t) => roster.depth.get(t), indexRows: rows, deadline,
      ...deps,
      features: (raw, ticker, spot, row) => {
        const f = deps.features(raw, ticker, spot, row);
        dossierFeatures.set(ticker, f);
        return f;
      },
      publish, log: (line) => console.warn(line),
    });
    for (const [t, d] of Object.entries(dossiers.depth)) dossierBuilt.set(t, d);
    const say = (depth) => {
      const want = roster.tickers.filter((t) => roster.depth.get(t) === depth);
      const built = want.filter((t) => dossiers.built.includes(t));
      const failed = want.filter((t) => dossiers.failed.includes(t));
      const skipped = want.filter((t) => dossiers.skipped.includes(t));
      return `${built.length} of ${want.length} ${depth} built` + (built.length ? ` (${built.join(", ")})` : "") +
        (failed.length ? `, failed ${failed.join(", ")}` : "") + (skipped.length ? `, skipped ${skipped.join(", ")}` : "");
    };
    console.log(`  dossiers: ${say("index")}; ${say("fund")}` +
      Object.entries(dossiers.shed).map(([t, keys]) => `; ${t} shed ${keys.join(", ")}`).join(""));
  }
  {
    const featuresFor = new Map(enriched.map((e) => [e.features.ticker, e.features]));
    for (const [t, f] of dossierFeatures) featuresFor.set(t, f);
    await stages.run("focus", async () => {
      const askSet = new Set(focusAsk);
      const held = new Map(fundRows);
      for (const r of screener) if (r && askSet.has(r.ticker) && !held.has(r.ticker)) held.set(r.ticker, r);
      const focusPayload = buildFocusPayload({
        ndx, rows: focusRead.rows, read: focusRead, sessionDate, generatedAt, readAt: focusRead.readAt,
        closesOf: (t) => focusCloses(featuresFor.get(t), sessionDate),
        backfill: held, backfillFrom: "harvest", backfillReadAt: screenerReadAt,
      });
      await publish("focus", focusPayload);
      console.log(`  focus: ${focusPayload.status}, ${Object.keys(focusPayload.rows).length} row(s) over ` +
        `${focusPayload.groups.length} group(s), ${Object.keys(focusPayload.closes || {}).length} with closes` +
        (focusPayload.missing.length ? `, missing ${focusPayload.missing.join(", ")}` : "") +
        (focusPayload.backfill ? `, ${focusPayload.backfill.tickers.length} filled from the run's own harvest (${focusPayload.backfill.why})` : "") +
        `, ${focusPayload.bytes || JSON.stringify(focusPayload).length} bytes of ${FOCUS_BUDGET_BYTES}`);
    }, (error) => {
      console.warn(`  focus: ${error.message}`);
    });
  }
  {
    stages.step("card-x");
    const cx = await publishCardX(cardX, publish, {
      generatedAt, sessionDate, readAt: marketLegs ? marketLegs.readAt : null,
      stored: (key) => publishedStore[key] || null, log: (line) => console.warn(line),
    });
    console.log(`  card-x: ${cx.written} written` + (cx.failed ? `, ${cx.failed} failed` : "") +
      (cx.over ? `, ${cx.over} over the cap` : "") + `, largest ${cx.largest} bytes`);
  }

  let rosterSummary = null;
  let rosterThrew = false;
  const probeBudget = { spentMs: 0, budgetMs: LEDGER_PROBE_RETRY_BUDGET_MS };
  await stages.run("roster", async () => {
    rosterSummary = await retireAndRoster({
      sessionDate, generatedAt,
      depth: new Map([
        ...crossSectionTickers.map((t) => [t, "cross"]),
        ...[...onBoard.keys()].map((t) => [t, deepSet.has(t) ? "board" : "focus"]),
        ...dossierBuilt,
      ]),
      exempt: new Set([...INDEX_TICKERS, ...FOCUS_FUNDS, ...focusDeep]),
      candidates: [...new Set([...screener.map((r) => r && r.ticker).filter(Boolean), ...guaranteed, ...FOCUS_FUNDS,
        ...INDEX_TICKERS, ...NDX_100])],
      reader: DRY_RUN ? dryRosterReader(sessionDate)
        : (key) => readStored(key, { budget: probeBudget }),
      probeMany: DRY_RUN ? dryRosterProbe(sessionDate)
        : (keys) => probeStored(keys, { budget: probeBudget }),
      lister: DRY_RUN ? dryRosterList(sessionDate)
        : () => listStored(LEDGER_LIST_KINDS, { budget: probeBudget }),
      prior: DRY_RUN ? await dryRosterReader(sessionDate)("roster")
        : pickPriorRoster(await readStored("roster", { budget: probeBudget }), await earlyRoster,
          { log: (line) => console.warn(line) }),
      deadline,
    });
  }, (error) => {
    rosterThrew = true;
    console.warn(`  roster: ${error.message} — the retire step stopped before the roster was written; the stored ` +
      "roster stays at its older session, so the next run finds the gap and probes the store");
  });

  console.log("  " + (DRY_RUN ? "[dry-run] " : "") + describeGammaRange(gammaProfiles).line +
    (DRY_RUN
      ? " ON SYNTHETIC ROWS THIS SETTLES NOTHING: the fixture spans about 1.7" +
        " orders of magnitude, so it does not exhibit the problem symlog exists" +
        " to solve. Only a live run answers this."
      : ""));

  stages.step("archive-check");
  const pruned = await prunePromise;
  if (pruned === null) console.warn("  prune: the sweep did not complete this run");

  if (ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    const archive = await ensureArchived({
      [`scores:${sessionDate}`]: scoresPayload,
      [`board:long:${sessionDate}`]: payloads.long,
      [`board:short:${sessionDate}`]: payloads.short,
    }, { landed: landedKeys, write: publish });
    const lost = archive.filter((a) => a.state === "lost");
    const repaired = archive.filter((a) => a.state === "repaired");
    const held = archive.filter((a) => a.state === "held");
    if (repaired.length) {
      console.log(`  archive check: ${repaired.map((a) => a.key).join(", ")} was missing and ` +
        "has now been written from this run's payload");
    }
    if (held.length) {
      console.warn(`  archive check: ${held.map((a) => a.key).join(", ")} already held an ` +
        "earlier run's payload for this session, which the archive keeps");
    }
    if (lost.length) {
      console.warn(`  ARCHIVE LOST: ${lost.map((a) => `${a.key} (${a.detail})`).join("; ")} — ` +
        `the record has no copy of what this run published for ${sessionDate}. Dispatch the ` +
        "workflow with republish_session to rewrite scores, board:long and board:short " +
        "together; " + plainRedispatchSaid(archive) + ". The run finishes publishing and " +
        "then exits non-zero, so the loss turns the workflow red instead of scrolling past in " +
        "a green log.");
      console.warn(`  ${republishRepair(sessionDate)}`);
      process.exitCode = 1;
    } else if (!repaired.length && !held.length) {
      console.log(`  archive check: scores, board:long and board:short are all written for ${sessionDate}`);
    }
  }

  let neuronLedger = null;
  await stages.run("neuron-ledger", async () => {
    neuronLedger = neuronCoverage({ universe: marketLegs ? marketLegs.universe : null, eligible: universe.length, cards: neuronTiers,
      held: rosterSummary ? rosterSummary.heldKeys : {}, sessionDate });
    const L = neuronLedger;
    console.log(`  neuron coverage: ${L.universe} universe name(s) — priced ${L.priced}, stand-aside ${L.standAside}, family ${L.family}, screen ${L.screen}` +
      `, unpriceable ${L.unpriceable}, expired ${L.expired}, stale ${L.stale}, missing ${L.missing}; screen ideas: ${L.screenIdeas.family} family, ${L.screenIdeas.none} No position` +
      `; engine ${L.engine.built} of ${L.engine.expected} deep card(s)` + (L.absentInputs.length ? `; inputs absent from the payload: ${L.absentInputs.join(", ")}` : ""));
  }, (error) => {
    console.warn(`  neuron coverage: ${error.message} — the ledger is not published this run`);
  });

  let metaBody = null;
  try {
    metaBody = {
      generatedAt, sessionDate,
      universe: universe.length,
      enriched: enriched.length,
      liquid: liquid.length,
      cardsBuilt, cardsFailed, cardsSkipped,
      ...(neuronLedger ? { neuron: neuronLedger } : {}),

      crossSectionCards: extraBuilt,
      cardsTotal: cardsBuilt + extraBuilt,
      apiCalls: stats.calls,
      coverage: {
        membership: { source: membership.source, asOf: membership.asOf, members: membership.members.length,
          fallback: membership.fallback, constantAsOf: NDX_AS_OF, constantAgeDays: ndxAge.days },
        ndx10: { tickers: ndx.tickers, source: ndx.source },
        focusDeep: focusCarded.length,
        gatedCarded: [...byCard.values()].filter((e) => e.gate).length,
        dossiers: Object.fromEntries(["index", "fund"].map((d) => [d, [...dossierBuilt.values()].filter((v) => v === d).length])),
        retired: rosterSummary ? rosterSummary.retired : null,
        held: rosterSummary ? rosterSummary.held : null,
      },
      warnings: coverageNotes,

      schedule: {
        cadence: PIPELINE_CADENCE,
        gate: gate.mode,
        intraday: intraday ? intraday.allowed : false,
        screenerReadAt,
        screenerTruncatedBands: screenerTruncated,
        endDateHonoured: dating.endDateHonoured,
      },
      variation: {
        convention: variationRun.probe,
        kc: variationRun.kc,
        unit: variationRun.unit,
        vannaScale: variationRun.vannaScale,
        strikeBook: variationRun.strikeSign,
        next: variationRun.next,
        votes: false,
      },
    };
    publishedStore.meta = metaBody;
  } catch (error) {
    console.warn(`  meta: ${error.message}`);
  }

  await stages.run("brief", async () => {
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
    const { shedCardFacts, CARD_CORE_FACTS } = await import("../shared/flows-ask.js");
    const base = {
      generatedAt, sessionDate,
      ...buildBrief(briefStoreFrom(publishedStore)),
      silences: index.silences,
      warnings: alarm.warnings,
      warningsChecked: alarm.checked,

      warningsQuestions: alarm.questions,
    };
    const over = (facts) => JSON.stringify({ ...base, facts }).length - BRIEF_BYTE_BUDGET;
    const indexed = index.cardNames || [];
    const priority = [...focusCarded, ...deepTickers.filter((t) => !focusDeep.has(t))];
    const briefOrder = [...priority.filter((t) => indexed.includes(t)), ...indexed.filter((t) => !priority.includes(t))];
    const shed = shedCardFacts(index.facts, briefOrder, over, { lean: CARD_CORE_FACTS });
    const cardCount = shed.facts.filter((f) => typeof f.source === "string" && f.source.startsWith("card:")).length;
    console.log(`  brief: ${shed.facts.length} facts, ${cardCount} of them per-name over ` +
      `${shed.namesIndexed.indexed} of ${shed.namesIndexed.of} carded names` +
      (shed.leaned.length ? `; ${shed.leaned.length} lean (${CARD_CORE_FACTS.join(", ")} only, to stay under ` +
        `${BRIEF_BYTE_BUDGET} bytes: the weakest ${shed.leaned.join(", ")}; focus names are leaned last)` : "") +
      (shed.namesIndexed.shed ? ` (${shed.namesIndexed.shed} shed to stay under ${BRIEF_BYTE_BUDGET} bytes: ` +
        `the weakest board name(s) ${briefOrder.slice(briefOrder.length - shed.namesIndexed.shed).join(", ")}; ` +
        "focus names are kept first)" : ""));
    await publish("brief", { ...base, facts: shed.facts, namesIndexed: shed.namesIndexed });
  }, (error) => {
    console.warn(`  brief: ${error.message}`);
  });

  if (DRY_RUN) {
    stages.step("live-dry");
    console.log("live layer (dry run of the --live mode: two synthetic Tier 2 ticks; a real nightly never writes live:*)");
    await dryLiveTicks({ publish, store: publishedStore, shapeNews });
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

  {
    const shape = {
      enriched: enriched.length, deep: onBoard.size, cross: crossSectionTickers.length,
      dossiers: dossierBuilt.size, earnings: marketLegs && marketLegs.earnings ? marketLegs.earnings.size : 0,
    };
    const model = callModel(shape);
    console.log(`calls: modelled ${model.total} for this run's shape (${Object.entries(shape).map(([k, v]) => `${k} ${v}`).join(", ")}) — ` +
      Object.entries(model.legs).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ") +
      `; nominal budget ${CALL_BUDGET}` + (DRY_RUN ? `; the dry-run fixtures answered ${vendor.calls.length} market, coverage and focus read(s)` : ""));
    const ceiling = Math.max(CALL_BUDGET, Math.ceil(model.total * (1 + CALL_OVERRUN_MARGIN)));
    if (stats.calls > ceiling) {
      const over = stats.calls - model.total;
      console.warn(
        `BUDGET: ${stats.calls} attempts against ${model.total} modelled for this run's shape — ` +
        `${over} over (${((over / model.total) * 100).toFixed(1)}%). ` +
        `${stats.rateLimited} of those attempts were 429 retries rather than distinct calls. ` +
        "The budget is what DEADLINE_MS was sized against; a run that exceeds it is " +
        "spending time the chain and card legs were promised.",
      );
    }
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

  stages.step("gate");
  const health = await runHealthGate({ sessionDate, read: readStored, dry: DRY_RUN, edge: edgeSnapshot,
    annotate: process.env.GITHUB_ACTIONS === "true",
    night: {
      cardsFailed: cardsFailed + extraFailed, deadlineSkipped: deadlineSkipped + extraSkipped,
      planned: byCard.size + dossierBuilt.size, rostered: rosterSummary ? rosterSummary.rostered : null,
      rosterWritten: rosterSummary ? rosterSummary.written : (rosterThrew ? false : undefined), enriched: enriched.length,
      neuron: neuronLedger,
    } });
  stages.finish();
  bindStages(null);
  if (health.failures.length) process.exitCode = 1;

  if (metaBody) {
    const outside = stages.outside();
    try {
      await publish("meta", {
        ...metaBody,
        stages: stages.records(),
        ...(outside.length ? { stagesOutside: outside.slice(0, 5) } : {}),
        health: healthRecord(health),
      });
    } catch (error) {
      console.warn(`  meta: ${error.message}`);
    }
  }
  await reportHealth({ failures: health.failures, applies: health.applies, dry: DRY_RUN, env: process.env });
}

export {
  fakeSectorEtfs, fakeNewsHeadlines,
  republishWithChain,
  archiveDatedBoards,

  fakePriorUnusual,
  };

export {
  PIPELINE_CADENCE, SESSION_CLOSE_MINUTES, SESSION_OPEN_MINUTES, closedPriceWindow, easternNow, intradayRefusal,
  readDayOf, sessionBarOverdue,
} from "./flows-nightly/clock.mjs";
export {
  BOARD_SCHEMA_VERSION, CANDLE_BREAK_LOG, CANDLE_BREAK_VOLUME, DEAD_BAND, GATED_LIQUIDITY_MARGIN, HOLDERS_RETRY_DAYS,
  MOVER_ROWS, NEWS_ROWS, SECTOR_ETFS, TICK_FIELDS_READ, TRIX_FULL_SCALE_BP, TRIX_MIN_CANDLES, TRIX_SERIES, TRIX_SPAN,
  TRIX_WARMUP, WATCH_ROWS, atr14, boardRow, boardVariationMeta, buildMovers, candleCut, candlesAscending,
  collapseShareClasses, computeFeatures, congressRows, daysToEarnings, describeTickFields, eligible, ema,
  featuresVariationInput, gatedWorthEnriching, holdersRefusal, ideasPayload, markNewContracts, measureVariationProbes,
  medianDollarVolume, moverRow, packSpark, partitionSides, priorNote, readPxOf, repairCandles, ret, returnCorrelation,
  scaleTrix, scoreBoard, screenerDollarVolume, screenerTilt, sectorLean, sectorTrix, selectExtremes, sessionCandles,
  sessionReference, sessionRow, sessionRows, shapeNews, toRows, toWatchRows, trixSeriesBp, unusualContractId,
  variationOptions, vendorNum,
} from "./flows-nightly/rank.mjs";

export {
  ARCHIVE_PRUNE_LOOKBACK_DAYS, ARCHIVE_RETENTION_DAYS, LEDGER_LIST_KINDS, LIVE_BEARER_MARGIN_MS, PUBLISH_RETRYABLE,
  PUBLISH_SPACING_MS, READ_RETRIES, datedKey, edgeRefusals, edgeSnapshot, listStored, liveCredential,
  liveCredentialSource, noteRefusal, probeStored, pruneArchive, pruneKeys, publish, publishRetryDelay, readStored,
  resetEdgeRefusals, resetPublishRetryBudget, retireSession, sessionArchiveKeys, summarize,
} from "./flows-nightly/store.mjs";

export {
  CALL_BUDGET, CALL_COST, CALL_OVERRUN_MARGIN, CHAIN_RESERVE_MS, DEADLINE_MS, DEEP_NAMES, DEEP_RULE,
  EARNINGS_GATE_DAYS, IV_RANK_PARAMS, LIVE_VENDOR, MARKET_CROSS_LIMIT, NEWS_VENDOR_LIMIT, NOMINAL_SHAPE, RATE,
  SCREENER_PAGE_ROWS, SCREENER_SPLIT_DEPTH, callModel, deepNames,
} from "./flows-nightly/vendor-params.mjs";
export {
  POOL_EVIDENCE_MIN, POOL_MAX_WIDTH, POOL_REFUSAL_EASE, POOL_REFUSAL_HALT, describeFloorVerdict, foldCardOutcomes,
  poolWidth, raiseRateFloor, rateFloorSurvivesBudget, runPooled, stepRateController, uw, wireProgress,
} from "./flows-nightly/vendor.mjs";

const invokedDirectly = process.argv[1]
  && (await import("node:url")).fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((error) => {
    console.error("pipeline failed:", error.message);
    process.exit(1);
  });
}
