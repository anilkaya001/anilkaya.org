#!/usr/bin/env node

import { nextTradingDay } from "../shared/flows-freshness.js";
import { num } from "../shared/flows-features.js";
import { buildCard, SURFACE_EXPIRIES, indexMarketCross, CROSS_FEEDS } from "../shared/flows-card.js";
import { runFlowLeg } from "./flows-legs/flow.mjs";
import { makeFlowFakeVendor, makeFlowFakeStore } from "./flows-legs/flow-fake.mjs";
import { sessionPrints, sessionPrintParams } from "../shared/flows-positioning.js";
import { buildChainPanels, CHAIN_PAGE_SIZE } from "../shared/flows-chain.js";
import { describeOiBasis } from "../shared/flows-unusual.js";
import { regimeState } from "../shared/flows-neuron.js";
import { neuronCoverage, cardTier } from "../shared/flows-neuron-coverage.js";
import * as QP from "./flows-quant-pipeline.mjs";
import { NDX_100, NDX_AS_OF, PICK_SIZE } from "../shared/flows-universe.js";
import { FOCUS_FUNDS, focusTickers, focusGroups, focusCloses, FOCUS_BUDGET_BYTES } from "../shared/flows-focus.js";
import { buildFocusPayload } from "./flows-legs/focus.mjs";
import { runVolLeg, volNames, attachVol, publishVol, coneThinOf } from "./flows-legs/vol.mjs";
import { fakeVolVendor } from "./flows-legs/vol-fake.mjs";
import { INDEX_TICKERS, readFocusRows } from "./flows-legs/universe.mjs";
import { publishCardX } from "./flows-legs/card-x.mjs";
import { buildIndexDossiers, dossierRoster } from "./flows-legs/index-dossier.mjs";
import {
  runLive, runLiveLoop, chainDispatch, chainWithRetry, dryLiveTicks, readLiveClock, LIVE_READ_PACE_MS, passOutcome,
  liveRunVerdict,
} from "./flows-legs/live.mjs";
import { createWatch, witnessDrill } from "./flows-legs/watch.mjs";
import { dryLiveDay } from "./flows-legs/live-day.mjs";
import { runHealthGate, republishRepair } from "./flows-legs/health.mjs";
import { reportHealth } from "./flows-legs/witness.mjs";
import { stampNow, stampPinned } from "./flows-legs/stamp.mjs";
import { DRY_RUN, LIVE_MODE } from "./flows-nightly/flags.mjs";
import { createStageRunner, healthRecord } from "./flows-nightly/stages.mjs";
import {
  CALL_BUDGET, CALL_OVERRUN_MARGIN, DEADLINE_MS, IV_RANK_PARAMS, MARKET_CROSS_LIMIT, RATE, callModel,
} from "./flows-nightly/vendor-params.mjs";
import {
  delayFloorMs, delayMs, describeFloorVerdict, foldCardOutcomes, permits, poolWidth, raiseReadPace, runPooled, stats,
  uw, vendorTimeoutMs, wireProgress,
} from "./flows-nightly/vendor.mjs";
import {
  ARCHIVE_DATE_RE, LEDGER_LIST_KINDS, bindStages, edgeSnapshot, ingestURL, landedKeys, listStored,
  liveCredentialSource, probeStored, publish, publishedStore, readStored, readStoredOnce, resetPublishRetryBudget,
  sessionArchiveKeys,
} from "./flows-nightly/store.mjs";
import {
  PIPELINE_CADENCE, easternDayOf, easternNow, intradayRefusal, readDayOf, sessionBarOverdue,
} from "./flows-nightly/clock.mjs";
import {
  candlesAscending, computeFeatures, congressRows, enrich, ideasPayload, readPxOf, repairCandles, screenerTilt,
  sessionCandles, sessionRow, sessionRows, shapeNews, variationOptions,
} from "./flows-nightly/rank.mjs";
import {
  DRY_SESSION_DATE, dryRosterList, dryRosterProbe, dryRosterReader, fakeChain, fakeCongress, fakeEarnings,
  fakeEnrichment, fakeIvRank, fakeMaxPain, fakeStockDarkpool, fakeStockOiChange, fakeSurface, fakeTermStructure,
  tickerSeed,
} from "./flows-nightly/fixtures.mjs";
import {
  LEDGER_PROBE_RETRY_BUDGET_MS, ensureArchived, pickPriorRoster, plainRedispatchSaid, retireAndRoster,
  sameSessionGate,
} from "./flows-nightly/archive.mjs";
import { runBoards } from "./flows-nightly/sections/boards.mjs";
import { runMarket } from "./flows-nightly/sections/market.mjs";
import { runUniverse } from "./flows-nightly/sections/universe.mjs";
import { publishNews, publishPulse, publishSectorPremium, runAlerts } from "./flows-nightly/sections/alerts.mjs";
import { runChains } from "./flows-nightly/sections/chains.mjs";
import { runRecord } from "./flows-nightly/sections/record.mjs";

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

  const ctx = { stages, sessionDate, intraday, gateOrigin, gate };
  await runUniverse(ctx);
  const {
    dating, screener, screenerTruncated, screenerReadAt, screenerDate, vendor, membership, ndx, focusDeep,
    coverageNotes, ndxAge, guaranteed, universe, enriched, liquid, byCard, focusCarded, variationRun, scored,
    generatedAt,
  } = ctx;

  await runBoards(ctx);
  const { payloads, first, deepSet, sideOfRow, deepTickers, prunePromise, earlyRoster, scoresPayload } = ctx;

  await runMarket(ctx);
  const { cardX, marketLegs } = ctx;

  await runRecord(ctx);
  const { scoreTrack, scoreTrackPremium } = ctx;

  await runChains(ctx);
  const { chainByTicker, quantPass, quantRate, chainMiss } = ctx;

  await runAlerts(ctx);
  const { crossRaws, politicalFilings, POLITICAL_WINDOW_DAYS } = ctx;

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
  };

export { PULSE_TOTALS_HISTORY } from "./flows-nightly/sections/alerts.mjs";
export { describeChainProbe, nearestProbeExpiry, vannaProbeSample } from "./flows-nightly/sections/chains.mjs";

export {
  judgeEndDate, judgeScreenerDate, sweepScreenerBand, verifyDating,
} from "./flows-nightly/sections/universe.mjs";

export {
  LEDGER_PROBE_CHUNK, LEDGER_PROBE_FAIL_MAX, LEDGER_PROBE_MAX, LEDGER_PROBE_RETRY_BUDGET_MS, MEMORY_ARCHIVE_SESSIONS,
  archiveDatedBoards, bootstrapLedger, buildRecordCloses, ensureArchived, pickPriorRoster, plainRedispatchSaid,
  probeSaid, readBoardMemory, recordCalendar, republishWithChain, resolveBoardMemory, retireAndRoster,
  sameSessionGate,
} from "./flows-nightly/archive.mjs";

export {
  DRY_FOCUS_ROWS, DRY_PROBE_BYTES, DRY_SESSION_DATE, dryRosterList, dryRosterProbe, dryRosterReader, fakeChain,
  fakeEarnings, fakeIvRank, fakeLadderChain, fakeLadderGreeks, fakeNewsHeadlines, fakeOiLadder, fakePriorBoard,
  fakePriorUnusual, fakeSectorEtfs,
} from "./flows-nightly/fixtures.mjs";

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
