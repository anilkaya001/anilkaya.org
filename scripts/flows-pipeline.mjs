#!/usr/bin/env node

import { nextTradingDay } from "../shared/flows-freshness.js";
import { num, percentileRank, pearson, HORIZON_SESSIONS } from "../shared/flows-features.js";
import { vannaScale, chainCallVanna } from "../shared/flows-variation.js";
import { buildCard, SURFACE_EXPIRIES, indexMarketCross, CROSS_FEEDS } from "../shared/flows-card.js";
import { scoreSessions, icTable, RECORD_NOTES } from "../shared/flows-record.js";
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
import { scoresRows, buildScoreTrack, boardsToScoreRows } from "../shared/flows-scores.js";
import { buildFlowAlerts, ALERT_ROWS, alertBand, nightlyAlerts } from "../shared/flows-alerts.js";
import { buildPulse, PULSE_FEEDS, PULSE_CAPS } from "../shared/flows-pulse.js";
import {

  buildPolitical, POLITICAL_FEEDS, unwrapRows as unwrapVendorRows,
} from "../shared/flows-political.js";
import { parseOptionSymbol } from "../shared/flows-premium.js";
import { regimeState } from "../shared/flows-neuron.js";
import { neuronCoverage, cardTier } from "../shared/flows-neuron-coverage.js";
import * as QP from "./flows-quant-pipeline.mjs";
import { NDX_100, NDX_AS_OF, SELECTION_EPOCH, PICK_SIZE } from "../shared/flows-universe.js";
import { FOCUS_FUNDS, focusTickers, focusGroups, focusCloses, FOCUS_BUDGET_BYTES } from "../shared/flows-focus.js";
import { buildFocusPayload } from "./flows-legs/focus.mjs";
import { runVolLeg, volNames, attachVol, publishVol, coneThinOf } from "./flows-legs/vol.mjs";
import { fakeVolVendor } from "./flows-legs/vol-fake.mjs";
import { INDEX_TICKERS, readFocusRows } from "./flows-legs/universe.mjs";
import { totalsHistory } from "./flows-legs/market.mjs";
import { makeFakeVendor } from "./flows-legs/fake-vendor.mjs";
import { publishCardX } from "./flows-legs/card-x.mjs";
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
  ALERT_VENDOR_LIMIT, CALL_BUDGET, CALL_OVERRUN_MARGIN, CHAIN_RESERVE_MS, DEADLINE_MS, IV_RANK_PARAMS,
  MARKET_CROSS_LIMIT, NEWS_VENDOR_LIMIT, RATE, callModel, deepNames,
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
  BOARD_SCHEMA_VERSION, NEWS_ROWS, SECTOR_ETFS, TRIX_FULL_SCALE_BP, TRIX_SERIES, TRIX_SPAN, TRIX_WARMUP,
  boardVariationMeta, candlesAscending, computeFeatures, congressRows, enrich, holdersRefusal, ideasPayload,
  markNewContracts, priorNote, readPxOf, repairCandles, screenerTilt, sectorLean, sectorTrix, sessionCandles,
  sessionRow, sessionRows, shapeNews, variationOptions,
} from "./flows-nightly/rank.mjs";
import {
  DRY_SESSION_DATE, dryRosterList, dryRosterProbe, dryRosterReader, fakeChain, fakeCongress, fakeEarnings,
  fakeEnrichment, fakeFlowAlerts, fakeIvRank, fakeLadderChain, fakeLadders, fakeMaxPain, fakeNewsHeadlines,
  fakePoliticalRaws, fakePriorUnusual, fakePulseRaws, fakeSectorCandles, fakeSectorEtfs, fakeStockDarkpool,
  fakeStockOiChange, fakeSurface, fakeTermStructure, fakeTreasury, tickerSeed,
} from "./flows-nightly/fixtures.mjs";
import {
  LEDGER_PROBE_RETRY_BUDGET_MS, archiveDatedBoards, buildRecordBreaks, buildRecordCloses, ensureArchived,
  fetchStoredPayload, pickPriorRoster, plainRedispatchSaid, recordCalendar, republishWithChain, retireAndRoster,
  sameSessionGate,
} from "./flows-nightly/archive.mjs";
import { runBoards } from "./flows-nightly/sections/boards.mjs";
import { runMarket } from "./flows-nightly/sections/market.mjs";
import { runUniverse } from "./flows-nightly/sections/universe.mjs";

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


const RECORD_HORIZONS = [1, 5, 10, 21];
const RECORD_IC_MIN_N = 20;
const RECORD_MAX_SESSIONS = 30;

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
    coverageNotes, ndxAge, guaranteed, universe, withTilt, tilted, enriched, liquid, byCard, focusCarded,
    variationRun, scored, generatedAt, sides,
  } = ctx;

  await runBoards(ctx);
  const {
    published, payloads, first, deepSet, sideOfRow, deepTickers, boardVariation, archiveWalkPromise, prunePromise,
    earlyRoster, scoresPayload,
  } = ctx;

  await runMarket(ctx);
  const { moversPayload, cardX, marketLegs } = ctx;

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
  };

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
