#!/usr/bin/env node

import { nextTradingDay } from "../shared/flows-freshness.js";
import {
  runLive, runLiveLoop, chainDispatch, chainWithRetry, dryLiveTicks, readLiveClock, LIVE_READ_PACE_MS, passOutcome,
  liveRunVerdict,
} from "./flows-legs/live.mjs";
import { createWatch, witnessDrill } from "./flows-legs/watch.mjs";
import { dryLiveDay } from "./flows-legs/live-day.mjs";
import { republishRepair } from "./flows-legs/health.mjs";
import { stampNow, stampPinned } from "./flows-legs/stamp.mjs";
import { DRY_RUN, LIVE_MODE } from "./flows-nightly/flags.mjs";
import { createStageRunner } from "./flows-nightly/stages.mjs";
import { raiseReadPace, stats, uw, vendorTimeoutMs, wireProgress } from "./flows-nightly/vendor.mjs";
import {
  bindStages, ingestURL, liveCredentialSource, publish, publishedStore, readStored, readStoredOnce,
  resetPublishRetryBudget, sessionArchiveKeys,
} from "./flows-nightly/store.mjs";
import { easternNow, intradayRefusal, sessionBarOverdue } from "./flows-nightly/clock.mjs";
import { candlesAscending, shapeNews } from "./flows-nightly/rank.mjs";
import { DRY_SESSION_DATE } from "./flows-nightly/fixtures.mjs";
import { sameSessionGate } from "./flows-nightly/archive.mjs";
import { runBoards } from "./flows-nightly/sections/boards.mjs";
import { runMarket } from "./flows-nightly/sections/market.mjs";
import { runUniverse } from "./flows-nightly/sections/universe.mjs";
import { publishNews, publishPulse, publishSectorPremium, runAlerts } from "./flows-nightly/sections/alerts.mjs";
import { runChains } from "./flows-nightly/sections/chains.mjs";
import { runRecord } from "./flows-nightly/sections/record.mjs";
import { runCards } from "./flows-nightly/sections/cards.mjs";
import { runClose } from "./flows-nightly/sections/close.mjs";
import { runContext } from "./flows-nightly/sections/context.mjs";
import { runFocus } from "./flows-nightly/sections/focus.mjs";
import { processCpuMs, runCompute } from "./flows-nightly/sections/compute.mjs";

export {
  CALL_BUDGET, CALL_COST, CALL_OVERRUN_MARGIN, CHAIN_RESERVE_MS, DEADLINE_MS, DEEP_NAMES, DEEP_RULE,
  EARNINGS_GATE_DAYS, IV_RANK_PARAMS, LIVE_VENDOR, MARKET_CROSS_LIMIT, NEWS_VENDOR_LIMIT, NOMINAL_SHAPE, RATE,
  SCREENER_PAGE_ROWS, SCREENER_SPLIT_DEPTH, callModel, deepNames,
} from "./flows-nightly/vendor-params.mjs";
export {
  POOL_EVIDENCE_MIN, POOL_MAX_WIDTH, POOL_REFUSAL_EASE, POOL_REFUSAL_HALT, describeFloorVerdict, foldCardOutcomes,
  poolWidth, raiseRateFloor, rateFloorSurvivesBudget, runPooled, stepRateController, uw, wireProgress,
} from "./flows-nightly/vendor.mjs";
export {
  ARCHIVE_PRUNE_LOOKBACK_DAYS, ARCHIVE_RETENTION_DAYS, LEDGER_LIST_KINDS, LIVE_BEARER_MARGIN_MS, PUBLISH_RETRYABLE,
  PUBLISH_SPACING_MS, READ_RETRIES, datedKey, edgeRefusals, edgeSnapshot, listStored, liveCredential,
  liveCredentialSource, noteRefusal, probeStored, pruneArchive, pruneKeys, publish, publishRetryDelay, readStored,
  resetEdgeRefusals, resetPublishRetryBudget, retireSession, sessionArchiveKeys, summarize,
} from "./flows-nightly/store.mjs";
export {
  PIPELINE_CADENCE, SESSION_CLOSE_MINUTES, SESSION_OPEN_MINUTES, closedPriceWindow, easternNow, intradayRefusal,
  readDayOf, sessionBarOverdue,
} from "./flows-nightly/clock.mjs";
export {
  BOARD_SCHEMA_VERSION, CANDLE_BREAK_LOG, CANDLE_BREAK_VOLUME, DEAD_BAND, GATED_LIQUIDITY_MARGIN, HOLDERS_RETRY_DAYS,
  MOVER_ROWS, NEWS_ROWS, SECTOR_ETFS, TICK_FIELDS_READ, TRIX_FULL_SCALE_BP, TRIX_MIN_CANDLES, TRIX_SERIES, TRIX_SPAN,
  TRIX_WARMUP, WATCH_ROWS, atr14, boardRow, boardVariationMeta, buildMovers, candleCut, candlesAscending,
  collapseShareClasses, computeFeatures, congressRows, daysToEarnings, describeTickFields, eligible, ema,
  featuresVariationInput, gatedWorthEnriching, holdersRefusal, ideasPayload, ideasArchiveKey, archiveIdeas, archivePermanent,
  permanentArchiveKey, barsInHand, markNewContracts, measureVariationProbes,
  medianDollarVolume, moverRow, packSpark, partitionSides, priorNote, readPxOf, repairCandles, ret, returnCorrelation,
  scaleTrix, scoreBoard, screenerDollarVolume, screenerTilt, sectorLean, sectorTrix, selectExtremes, sessionCandles,
  sessionReference, sessionRow, sessionRows, shapeNews, toRows, toWatchRows, trixSeriesBp, unusualContractId,
  variationOptions, vendorNum,
} from "./flows-nightly/rank.mjs";
export {
  DRY_FOCUS_ROWS, DRY_PROBE_BYTES, DRY_SESSION_DATE, dryRosterList, dryRosterProbe, dryRosterReader, fakeChain,
  fakeEarnings, fakeIvRank, fakeLadderChain, fakeLadderGreeks, fakeNewsHeadlines, fakeOiLadder, fakePriorBoard,
  fakePriorUnusual, fakeSectorEtfs,
} from "./flows-nightly/fixtures.mjs";
export {
  LEDGER_PROBE_CHUNK, LEDGER_PROBE_FAIL_MAX, LEDGER_PROBE_MAX, LEDGER_PROBE_RETRY_BUDGET_MS, MEMORY_ARCHIVE_SESSIONS,
  archiveDatedBoards, bootstrapLedger, buildRecordCloses, ensureArchived, pickPriorRoster, plainRedispatchSaid,
  probeSaid, readBoardMemory, recordCalendar, republishWithChain, resolveBoardMemory, retireAndRoster,
  sameSessionGate,
} from "./flows-nightly/archive.mjs";
export { PULSE_TOTALS_HISTORY } from "./flows-nightly/sections/alerts.mjs";
export { CARD_SELF_CHECK_BYTES, CARD_SHED, fetchCloseBars, markGate, shedCardToCap } from "./flows-nightly/sections/cards.mjs";
export { describeChainProbe, nearestProbeExpiry, vannaProbeSample } from "./flows-nightly/sections/chains.mjs";
export { describeGammaRange } from "./flows-nightly/sections/close.mjs";
export {
  judgeEndDate, judgeScreenerDate, sweepScreenerBand, verifyDating,
} from "./flows-nightly/sections/universe.mjs";

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

  const stages = createStageRunner({
    clock: () => (stampPinned() ? 0 : Date.now()), calls: () => stats.calls, cpu: () => (stampPinned() ? 0 : processCpuMs()),
  });
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

  const ctx = { stages, sessionDate, intraday, gateOrigin, gate };
  await runUniverse(ctx);
  await runBoards(ctx);
  await runMarket(ctx);
  await runRecord(ctx);
  await runChains(ctx);
  await runAlerts(ctx);
  await runContext(ctx);
  await runCards(ctx);
  await runFocus(ctx);
  await runCompute(ctx);
  await runClose(ctx);
}

const invokedDirectly = process.argv[1]
  && (await import("node:url")).fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((error) => {
    console.error("pipeline failed:", error.message);
    process.exit(1);
  });
}
