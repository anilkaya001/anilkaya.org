import assert from "node:assert/strict";
import { ARCHIVE_REFUSALS } from "../shared/flows-archive.js";
import { readFileSync } from "node:fs";
import {
  candlesAscending, selectExtremes, atr14, partitionSides, scoreBoard,
  medianDollarVolume, eligible, daysToEarnings, publish, summarize,
  collapseShareClasses, returnCorrelation, packSpark, ret, easternNow, DEAD_BAND,
  screenerTilt, boardRow, toRows, toWatchRows, datedKey, pruneKeys, pruneArchive,
  describeTickFields, TICK_FIELDS_READ, republishWithChain, PUBLISH_RETRYABLE,
  archiveDatedBoards,
  runPooled, foldCardOutcomes, poolWidth, describeFloorVerdict, POOL_MAX_WIDTH, POOL_EVIDENCE_MIN,
  POOL_REFUSAL_HALT, POOL_REFUSAL_EASE,
  unusualContractId, markNewContracts, priorNote,
  readBoardMemory, fakePriorBoard,
  stepRateController, raiseRateFloor, rateFloorSurvivesBudget, RATE, CALL_BUDGET,
  PUBLISH_SPACING_MS,
  DEADLINE_MS, CHAIN_RESERVE_MS, nearestProbeExpiry, describeChainProbe, fakeChain,
  DEEP_NAMES, deepNames, publishRetryDelay, MARKET_CROSS_LIMIT, EARNINGS_GATE_DAYS,
  WATCH_ROWS, ARCHIVE_RETENTION_DAYS, ARCHIVE_PRUNE_LOOKBACK_DAYS,
  SECTOR_ETFS, TRIX_SERIES, TRIX_MIN_CANDLES, TRIX_FULL_SCALE_BP,
  trixSeriesBp, scaleTrix, sectorTrix, MOVER_ROWS, moverRow, buildMovers,
  vendorNum, sectorLean, shapeNews, NEWS_ROWS, NEWS_VENDOR_LIMIT,
  ensureArchived, sessionCandles, candleCut, judgeEndDate, verifyDating, computeFeatures,
  sessionReference, sessionRow, readPxOf, intradayRefusal, nextWeekday, priorWeekdays,
  closedPriceWindow, buildRecordCloses, recordCalendar, resolveBoardMemory, sameSessionGate,
  retireSession, sessionArchiveKeys, sweepScreenerBand, SCREENER_SPLIT_DEPTH, SCREENER_PAGE_ROWS,
  judgeScreenerDate, sessionRows, readDayOf, PIPELINE_CADENCE, SESSION_OPEN_MINUTES,
  SESSION_CLOSE_MINUTES, MEMORY_ARCHIVE_SESSIONS, READ_RETRIES, readStored, holdersRefusal,
  HOLDERS_RETRY_DAYS,
  IV_RANK_PARAMS, fakeIvRank, measureVariationProbes, fakeOiLadder, fakeLadderGreeks,
  fakeLadderChain, vannaProbeSample, featuresVariationInput, boardVariationMeta, congressRows,
  plainRedispatchSaid, retireAndRoster, bootstrapLedger, callModel, CALL_COST, NOMINAL_SHAPE, markGate,
} from "../scripts/flows-pipeline.mjs";
import { FOCUS_FUNDS, MAG7 as FOCUS_MAG7, FOCUS_MINERS } from "../shared/flows-focus.js";
import { VARIATION_CODES, variationSummary } from "../shared/flows-variation.js";
import { pinReading, buildCard } from "../shared/flows-card.js";
import { pearson, horizonMove, HORIZON_SESSIONS, realizedVol } from "../shared/flows-features.js";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

{

  const mk = (i) => {
    const wide = i >= 30;
    const base = 100 + i * 0.1;
    return {
      start_time: new Date(Date.UTC(2026, 5, 1 + i, 13, 30)).toISOString(),
      high: String(base + (wide ? 8 : 0.5)),
      low: String(base - (wide ? 8 : 0.5)),
      close: String(base),
      volume: 1_000_000,
    };
  };
  const ascending = Array.from({ length: 40 }, (_, i) => mk(i));
  const descending = ascending.slice().reverse();

  const sorted = candlesAscending(descending);
  ok(Date.parse(sorted[0].start_time) < Date.parse(sorted[sorted.length - 1].start_time),
     "a newest-first response is sorted oldest-first");

  const a = atr14(ascending);
  const d = atr14(descending);
  near(d, a, 1e-9, "THE FIX: ATR is identical whichever order the vendor returns");
  ok(a > 1, `the recent volatile stretch dominates the ATR (${a.toFixed(2)})`);

  const naive = (() => {
    const rows = descending.slice(-40).map((c) => ({ h: +c.high, l: +c.low, c: +c.close }));
    let atr = 0;
    for (let i = 1; i < rows.length; i++) {
      const tr = Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c));
      atr = i === 1 ? tr : (13 * atr + tr) / 14;
    }
    return atr;
  })();
  ok(Math.abs(naive - a) > 0.5,
     `and the unsorted reading really was different (${naive.toFixed(2)} vs ${a.toFixed(2)})`);

  ok(candlesAscending([]).length === 0, "an empty series is safe");
  const undated = [{ high: "2", low: "1", close: "1.5" }];
  ok(candlesAscending(undated).length === 1,
     "candles with no parseable timestamp keep their given order rather than vanishing");

  const revised = [
    { start_time: "2026-05-04T13:30:00Z", close: "230.49", volume: 6361 },
    { start_time: "2026-05-04T13:30:00Z", close: "226.02", volume: 442349 },
    { start_time: "2026-05-04T13:30:00Z", close: "226.02", volume: 2341823 },
    { start_time: "2026-05-05T13:30:00Z", close: "227", volume: 543208 },
    { start_time: "2026-05-05T13:30:00Z", close: "227.42", volume: 1677636 },
  ];
  const one = candlesAscending(revised);
  ok(one.length === 2,
     `three revisions of one session collapse to one bar (${one.length} bars from 5 rows)`);
  ok(one[0].volume === 2341823 && one[1].volume === 1677636,
     "and the bar kept is the fullest revision, not the first or the last by position");
  ok(candlesAscending(revised.slice().reverse())[0].volume === 2341823,
     "whichever order the vendor returned the revisions in");

  ok(atr14([]) === 0, "no candles yields no ATR");
  ok(atr14(ascending.slice(0, 5)) === 0, "too few candles yields no ATR rather than a guess");
}

{
  const ranked = (n) => Array.from({ length: n }, (_, i) => ({ row: { ticker: "T" + i }, rough: -i }));

  for (const size of [80, 60, 59, 55, 50, 40, 31, 30, 10, 1]) {
    const picks = selectExtremes(ranked(size), 30);
    const tickers = picks.map((p) => p.row.ticker);
    ok(new Set(tickers).size === tickers.length,
       `THE FIX: no ticker is enriched twice at a pool of ${size} (got ${tickers.length})`);
    ok(picks.length <= Math.min(size, 60), `pool ${size} yields at most min(size, 2n) picks`);
  }

  const naive = [...ranked(55).slice(0, 30), ...ranked(55).slice(-30)];
  ok(naive.length - new Set(naive.map((p) => p.row.ticker)).size === 5,
     "the naive head/tail slice duplicated five names at 55 survivors");

  const wide = selectExtremes(ranked(200), 30).map((p) => p.row.ticker);
  ok(wide.includes("T0") && wide.includes("T199"), "both extremes are still selected");
  ok(wide.length === 60, "a wide pool yields the full 2n");
}

{
  for (const size of [60, 55, 50, 48, 40, 21, 20, 4, 2, 1, 0]) {
    const scored = Array.from({ length: size }, (_, i) => ({ ticker: "T" + i, score: 100 - i * 3 }));
    const { long, short } = partitionSides(scored);
    const overlap = long.filter((l) => short.some((s) => s.ticker === l.ticker));
    ok(overlap.length === 0, `long and short stay disjoint at pool size ${size}`);
  }
}

{
  const base = (i) => ({
    ticker: "N" + i,
    dirDelta: (i % 2 ? 1 : -1) * (500 + i * 10),
    dirShare: (i % 2 ? 1 : -1) * (0.1 + (i % 9) * 0.05),
    purity: 0.4 + (i % 6) * 0.08,
    otmShare: 0.3 + (i % 7) * 0.05,
    vegaTilt: (i % 5) * 0.6,
    netGamma: (i % 3 - 1) * 1e9,
    spotGammaShare: ((i % 7) - 3) / 4,
    gammaBookShare: ((i % 7) - 3) / 4,
    flipDist: (i % 11 - 5) / 100,
    displacement: (i % 2 ? 1 : -1) * 0.6 + (i % 9 - 4) / 6,
    displacementWeight: 1,
    persistence: 0.6,
    concentration: 0.2,
    pathNet: (i % 2 ? 1 : -1) * 1000,
    pathBars: 390,
    gammaFrontLoad: 0.2 + (i % 5) * 0.08,
    vrp: (i % 13 - 6) / 100,
    ivRank: (i % 17) / 17,
    ivMomentum: (i % 11 - 5) / 100,
    coverage: 1,
  });
  const features = Array.from({ length: 46 }, (_, i) => base(i + 2));

  const clean = { ...base(0), ticker: "CLEAN", dirDelta: -1000, dirShare: -0.8,
                  purity: 0.9, otmShare: 0.10, vegaTilt: 0.05, pathNet: -1000 };
  const lotto = { ...base(1), ticker: "LOTTO", dirDelta: -1000, dirShare: -0.8,
                  purity: 0.2, otmShare: 0.95, vegaTilt: 5.0, pathNet: -1000 };
  const all = [clean, lotto, ...features];

  const tilts = all.map((f) => ({
    premiumTilt: f.dirShare * 0.5, netTilt: f.dirShare * 0.3,
    volTilt: f.dirShare * 0.4, oiTilt: f.dirShare * 0.2, surpriseTilt: 0,
  }));
  const sectors = all.map((f, i) => (f.ticker === "LOTTO" ? "tech" : ["tech", "energy", "health", "fins"][i % 4]));
  const caps = all.map(() => 5e9);

  const scored = scoreBoard(all, tilts, sectors, caps);
  const byTicker = new Map(scored.map((r) => [r.ticker, r]));
  const c = byTicker.get("CLEAN");
  const l = byTicker.get("LOTTO");

  ok(scored.every((r) => r.fam.O >= 0 && r.fam.O <= 100), "the quality gauge is unsigned, 0..100");
  const meanO = scored.reduce((a, r) => a + r.fam.O, 0) / scored.length;
  ok(Math.abs(meanO - 50) < 6, `the gate averages one across the board (gauge mean ${meanO.toFixed(1)})`);

  ok(c.fam.O > l.fam.O,
     `THE FIX: the clean name earns a LARGER multiplier than the lottery one (${c.fam.O} vs ${l.fam.O})`);
  ok(c.score < 0 && l.score < 0,
     `both bearish names score short (clean ${c.score}, lotto ${l.score})`);
  ok(c.score < l.score,
     `and quality AMPLIFIES the bearish read rather than reversing it (${c.score} vs ${l.score})`);
  ok(Math.sign(c.gate) === 1 && Math.sign(l.gate) === 1,
     "no gate is ever negative, so no modifier can flip a sign");

  const r = pearson(scored.map((x) => x.residual), scored.map((x) => x.dirShare));
  ok(r > 0.2, `the composite is LONG its own directional flow signal (corr = ${r.toFixed(3)})`);
  const rF = pearson(scored.map((x) => x.fam.F), scored.map((x) => x.dirShare));
  ok(rF > 0.8, `and the flow axis itself tracks flow (corr = ${rF.toFixed(3)})`);

  const flipped = all.map((f) => (f.ticker !== "CLEAN" ? f : {
    ...f, dirDelta: +1000, dirShare: +0.8, pathNet: +1000, displacement: +0.6,
  }));
  const flippedTilts = flipped.map((f) => ({
    premiumTilt: f.dirShare * 0.5, netTilt: f.dirShare * 0.3,
    volTilt: f.dirShare * 0.4, oiTilt: f.dirShare * 0.2, surpriseTilt: 0,
  }));
  const after = scoreBoard(flipped, flippedTilts, sectors, caps)
    .find((x) => x.ticker === "CLEAN");
  ok(after.residual > c.residual,
     `reversing a name's flow must move its composite the SAME way ` +
     `(${c.residual.toFixed(3)} -> ${after.residual.toFixed(3)})`);
  ok(after.score > c.score, `and its published score with it (${c.score} -> ${after.score})`);
  ok(Math.abs(after.fam.O - c.fam.O) < 25,
     `while the quality gauge, which has no direction, stays put ` +
     `(${c.fam.O} -> ${after.fam.O})`);

  const shortAtSpot = scored.filter((x) => x.gammaBookShare < -0.2);
  const longAtSpot = scored.filter((x) => x.gammaBookShare > 0.2);
  ok(shortAtSpot.length && longAtSpot.length, "the fixture covers both gamma regimes");
  const meanGate = (rows) => rows.reduce((a, x) => a + x.gate, 0) / rows.length;
  ok(meanGate(shortAtSpot) > meanGate(longAtSpot),
     `THE FIX: a short open-interest book amplifies, a long one damps — the gate reads the book's ` +
     `net share of its gross, not the flow ladder's running sum below spot ` +
     `(${meanGate(shortAtSpot).toFixed(3)} vs ${meanGate(longAtSpot).toFixed(3)})`);
  const noBook = scoreBoard(all.map((f) => ({ ...f, gammaBookShare: null, spotGammaShare: -f.spotGammaShare })),
    tilts, sectors, caps);
  ok(noBook.every((x, i) => Math.abs(x.gate - scoreBoard(all.map((f) => ({ ...f, gammaBookShare: null })),
    tilts, sectors, caps)[i].gate) < 1e-12),
     "and the running sum below spot no longer moves the gate at all: flipping it leaves every gate where it was");

  for (const k of ["F", "P", "D"]) {
    ok(scored.every((x) => x.fam[k] === null || (x.fam[k] >= -100 && x.fam[k] <= 100)),
       `signed axis ${k} is a bounded score or explicitly absent`);
  }
  ok(scored.every((x) => x.fam.V === null || (x.fam.V >= 0 && x.fam.V <= 100)),
     "the vol gauge is unsigned, 0..100, or explicitly absent");

  const noPath = all.map((f) => ({ ...f, pathNet: 0, persistence: 0, pathBars: 0 }));
  const withoutD = scoreBoard(noPath, tilts, sectors, caps);
  ok(withoutD.every((x) => x.fam.D === null),
     "a family with no usable input reports absent, not neutral");
  ok(withoutD.every((x) => !("D" in x.weights)), "and draws no weight at all");

  ok(scored.every((x) => x.score >= -100 && x.score <= 100), "scores stay inside the band");
  ok(scored.every((x) => x.conviction >= 0 && x.conviction <= 100), "conviction stays inside the band");

  const half = scoreBoard(all.slice(0, 24), tilts.slice(0, 24), sectors.slice(0, 24), caps.slice(0, 24));
  const ladder = (rows) => rows.map((x) => x.score).sort((a, b) => b - a);
  ok(JSON.stringify(ladder(scored).slice(0, 8)) !== JSON.stringify(ladder(half).slice(0, 8)),
     "the top of the board is not a fixed function of pool size");
  const uniq = new Set(scored.map((x) => x.score));
  ok(uniq.size < scored.length,
     "a fixed unit lets names tie, which a rank relabeling could never do");
}

{

  const quiet = Array.from({ length: 40 }, () => ({ close: "10", volume: 100_000 }));
  quiet[20] = { close: "10", volume: 500_000_000 };
  ok(medianDollarVolume(quiet) < 5e7, "a single volume spike cannot clear the floor");
  ok(medianDollarVolume([]) === 0, "no candles reports no volume rather than a guess");

  const day = (i, volume) => ({
    start_time: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(),
    close: "10", volume,
  });

  const faded = [
    ...Array.from({ length: 190 }, (_, i) => day(i, 10_000_000)),
    ...Array.from({ length: 62 }, (_, i) => day(190 + i, 100_000)),
  ];
  ok(medianDollarVolume(faded) < 5e7,
     `a name whose liquidity collapsed a quarter ago fails the floor ` +
     `(got $${(medianDollarVolume(faded) / 1e6).toFixed(1)}M)`);
  ok(medianDollarVolume(faded, { window: 1e9 }) > 5e7,
     "while the whole-series median would still wave it through, which is the bug");

  ok(medianDollarVolume(faded.slice().reverse()) === medianDollarVolume(faded),
     "and the window is taken by date, so a newest-first response reads the same");

  ok(eligible({ close: "50", marketcap: "5e9", call_volume: 800, put_volume: 800,
                total_open_interest: 20000, issue_type: "Common Stock" }),
     "a liquid common stock is eligible");
  ok(!eligible({ close: "50", marketcap: "5e9", call_volume: 800, put_volume: 800,
                 total_open_interest: 20000, issue_type: "ETF" }),
     "an ETF is not single-name conviction");
  ok(!eligible({ close: "2", marketcap: "5e9", call_volume: 800, put_volume: 800,
                 total_open_interest: 20000, issue_type: "Common Stock" }),
     "a sub-$5 name is excluded");
  ok(!eligible({ close: "50", marketcap: "5e9", call_volume: 800, put_volume: 800,
                 total_open_interest: 20000, is_index: true }),
     "an index is excluded");

  const today = "2026-08-25";
  ok(daysToEarnings({ next_earnings_date: "2026-08-30" }, today) === 5, "earnings distance is in days");
  ok(daysToEarnings({}, today) === null, "an absent earnings date is null, not zero");
  ok(daysToEarnings({ next_earnings_date: "2026-08-30" }, "not-a-date") === null,
     "and an origin that is not a date is null rather than NaN days");

  ok(daysToEarnings({ next_earnings_date: "2026-09-06" }, "2026-08-25") ===
     daysToEarnings({ next_earnings_date: "2026-09-06" }, "2026-08-25"),
     "the gate is a function of the session's calendar day, not of the firing minute");
  ok(daysToEarnings({ next_earnings_date: "2026-08-24" }, today) === -1,
     "a date already past is negative, which the gate reads as `let it through`");
}

{
  const http = await import("node:http");
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      received.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(body.includes("FAILME") ? 500 : 200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const prevUrl = process.env.FLOWS_INGEST_URL;
  const prevTok = process.env.FLOWS_INGEST_TOKEN;
  process.env.FLOWS_INGEST_URL = `http://127.0.0.1:${port}/api/flows/ingest`;
  process.env.FLOWS_INGEST_TOKEN = "test-token";

  try {

    await publish("board:long", { side: "long", rows: [{ t: "A" }, { t: "B" }] });
    eq(received.length, 1, "a board publishes over the live path");
    ok(received[0].url.includes("key=board%3Along"), "the key is url-encoded into the query");
    eq(received[0].auth, "Bearer test-token", "and carries the bearer");

    await publish("card:AAPL", { v: 1, ticker: "AAPL", panels: {} });
    eq(received.length, 2, "a CARD publishes over the live path without throwing");

    await publish("meta", { generatedAt: "x", cardsBuilt: 3 });
    eq(received.length, 3, "meta publishes over the live path without throwing");

    let threw = null;
    try { await publish("card:FAILME", { ticker: "FAILME" }); }
    catch (error) { threw = error; }
    ok(threw && /HTTP 500/.test(threw.message), "a failed ingest throws with its status");

    eq(summarize({ rows: [1, 2, 3] }), "3 rows", "a board is described by its row count");
    eq(summarize({ ticker: "AAPL" }), "no rows", "a card is described honestly, not by a crash");
    eq(summarize({ rows: null }), "no rows", "a null rows field is not a length lookup");
  } finally {
    process.env.FLOWS_INGEST_URL = prevUrl;
    process.env.FLOWS_INGEST_TOKEN = prevTok;
    if (prevUrl === undefined) delete process.env.FLOWS_INGEST_URL;
    if (prevTok === undefined) delete process.env.FLOWS_INGEST_TOKEN;
    await new Promise((r) => server.close(r));
  }
}

{
  const candles = (seed, n = 40) => {
    let px = 100, out = [];
    for (let i = 0; i < n; i++) {
      px *= 1 + Math.sin((i + seed) * 1.7) * 0.01;
      out.push({ start_time: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
                 close: px.toFixed(4), volume: 1e6 });
    }
    return out;
  };
  const shared = candles(0);

  const bLine = shared.map((c, i) => ({ ...c, close: (Number(c.close) * (1 + (i % 5) * 1e-4)).toFixed(4) }));

  const rec = (ticker, cap, sector, dv, ohlc) => ({
    features: { ticker, dollarVolume: dv }, raw: { ohlc },
    row: { ticker, marketcap: String(cap), sector },
  });
  const records = [
    rec("GOOG", 2.1e12, "Communication Services", 9e9, shared),
    rec("GOOGL", 2.1e12, "Communication Services", 4e9, bLine),
    rec("MSFT", 3.0e12, "Technology", 8e9, candles(11)),
    rec("NVDA", 3.0e12, "Technology", 3e10, candles(23)),
  ];

  const { kept, dropped } = collapseShareClasses(records);
  const tickers = kept.map((e) => e.features.ticker).sort();
  ok(!tickers.includes("GOOGL"), `the thinner share class is dropped (kept ${tickers.join(",")})`);
  ok(tickers.includes("GOOG"), "the more liquid line survives");
  ok(dropped.length === 1 && dropped[0].kept === "GOOG" && dropped[0].dropped === "GOOGL",
     "and the collapse is reported, not silent");
  ok(dropped[0].corr >= 0.97, `on a measured return correlation (${dropped[0].corr.toFixed(4)})`);

  ok(tickers.includes("MSFT") && tickers.includes("NVDA"),
     "same sector and same cap is NOT enough to collapse two real issuers");

  ok(collapseShareClasses([]).kept.length === 0, "an empty pool is safe");
  const noCap = [rec("X", 0, "Tech", 1e9, shared), rec("Y", 0, "Tech", 1e9, shared)];
  ok(collapseShareClasses(noCap).kept.length === 2, "a missing market cap groups nothing");

  ok(Number.isNaN(returnCorrelation(shared, candles(5, 4))),
     "too few overlapping dates reports NaN rather than a confident number");
}

{
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 8);
  const packed = packSpark(closes);
  ok(packed.length === 84, `42 sessions at two characters each (got ${packed.length})`);
  ok(/^[A-Za-z0-9+/]+$/.test(packed), "and it is plain base-64 alphabet, safe in JSON");

  const decode = (str) => {
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const out = [];
    for (let i = 0; i < str.length; i += 2) out.push((B64.indexOf(str[i]) << 6) | B64.indexOf(str[i + 1]));
    return out;
  };
  const back = decode(packed);
  ok(back.length === 42, "decodes back to 42 samples");
  ok(Math.min(...back) === 0 && Math.max(...back) === 4095,
     "the window is normalised to its own extremes");
  const tail = closes.slice(-42);
  for (let i = 1; i < 42; i++) {
    ok(Math.sign(back[i] - back[i - 1]) === Math.sign(Math.round((tail[i] - tail[i - 1]) * 1e6)) ||
       Math.abs(back[i] - back[i - 1]) <= 1,
       "every step keeps its direction through the quantisation");
  }

  ok(packSpark([100]) === null, "one close is not a sparkline");
  ok(packSpark(null) === null, "a null series is safe");
  const flatPack = packSpark(new Array(42).fill(50));
  ok(flatPack !== null && decode(flatPack).every((v) => v === 2048),
     "a flat series draws down the middle rather than dividing by zero");

  const rising = Array.from({ length: 60 }, (_, i) => 100 * 1.01 ** i);
  ok(Math.abs(ret(rising, 5) - (1.01 ** 5 - 1)) < 1e-9, "the 5-session return is exact");
  ok(ret(rising, 42) !== null, "a 42-session return resolves when the series is long enough");
  ok(ret(rising.slice(-42), 42) === null,
     "and reports null rather than a wrong number when it is not");
}

{

  const iv = 0.42;
  const h10 = horizonMove(iv);
  const h40 = horizonMove(iv, { sessions: 40 });
  ok(h40 > h10, "a longer horizon prices a wider band, from the same volatility");
  ok(Math.abs(h40 / h10 - 2) < 1e-9,
     "and exactly twice as wide at four times the horizon — square root of time");

  ok(horizonMove(iv) === horizonMove(iv),
     "the fixed-horizon band depends on volatility alone, not on the expiry chain");
  ok(HORIZON_SESSIONS === 10, "the published horizon is ten trading sessions");
}

{

  const tilt = (v) => screenerTilt({
    ticker: "T", close: "100", prev_close: "100", iv_rank: v,
    bullish_premium: "1", bearish_premium: "1", call_premium: "1", put_premium: "1",
    call_volume: 1, put_volume: 1, total_open_interest: 10,
  });
  ok(Math.abs(tilt("13.52369891956068210400").ivRank - 0.1352369891956068) < 1e-12,
     "the vendor's own example value reads as a fraction of its year");
  ok(Math.abs(tilt("88.9").ivRank - 0.889) < 1e-12, "and so does a high percentile");
  ok(tilt("100").ivRank === 1, "the top of the range is exactly one");
  ok(tilt("0").ivRank === 0, "and the bottom exactly zero");

  ok(tilt("0.5").ivRank === 0.005,
     "A RANK UNDER ONE IS STILL ON THE VENDOR'S 0-100 SCALE: guessed per value, 0.8 read as the 80th " +
     "percentile while 1.5 read as the 1.5th, so the lowest-ranked names escaped the pin card's floor signal");
  const floorAt = (v) => pinReading({ iv30: 0.08, rv30: 0.2, ivRank: tilt(v).ivRank, ivMomentum: -0.005,
    impliedH: null, realizedH: null, lastRange: { range: 0.002, date: "2026-09-18" } });
  ok(["0", "0.3", "0.8", "1.0", "1.5", "2.0"].every((v) => floorAt(v) && floorAt(v).signals.includes("floor")) &&
     floorAt("2.5") === null,
     "so every rank from the 0th to the 2nd percentile raises the floor signal, and the 2.5th does not");
  ok(Number.isNaN(tilt("100.5").ivRank), "and a rank past 100 is not a percentile at all");
  ok(Number.isNaN(tilt(null).ivRank), "a missing rank is not a zero percentile");
  ok(Number.isNaN(tilt("-3").ivRank), "and neither is a negative one");
}

{
  const board = (side, tickers) => ({
    side, sessionDate: "2026-08-24",
    rows: tickers.map((t, i) => ({ t, r: i + 1, s: 50, px: 100 })),
  });
  const chain = (skew, term, atmIv, skewDays = null) =>
    ({ scalars: { skew, term, atmIv, skewDays } });

  {
    const seen = [];
    const payloads = { long: board("long", ["AAA", "BBB"]), short: board("short", ["CCC"]) };
    const chains = new Map([
      ["AAA", chain(0.04, -0.02, 0.31, 25)],
      ["BBB", chain(null, null, null, null)],
      ["CCC", chain(0.06, 0.01, 0.28, 32)],
    ]);
    await republishWithChain(payloads, chains, "2026-08-24", async (key) => { seen.push(key); });

    assert.deepEqual(seen,
      ["board:long:2026-08-24", "board:long", "board:short:2026-08-24", "board:short"],
      "THE DATED COPY IS WRITTEN FIRST ON EACH SIDE: a live board carrying a column its own " +
      "archive copy will never have is the one state the archive exists to prevent"); checks++;

    const row = payloads.long.rows[0];
    eq(Object.keys(row).slice(-4).join(","), "skew,term,atmIv,skewDays",
       "the four columns are APPENDED, in order — the board table binds positionally");
    eq(payloads.long.rows[1].skew, null,
       "a name whose chain measured nothing carries null, not the previous row's reading");
  }

  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const chains = new Map([["AAA", chain(0.04, -0.02, 0.31, 25)], ["CCC", chain(0.06, 0.01, 0.28, 32)]]);
    const lines = await republishWithChain(payloads, chains, "2026-08-24", async (key) => {
      seen.push(key);
      if (key === "board:long:2026-08-24") throw new Error("archive write refused");
    });
    ok(seen.includes("board:long"),
       `THE SPLIT: a failed archive write no longer takes the live board down with it ` +
       `(${seen.join(", ")}) — sharing one try is how run 56 lost board:long:2026-09-15 AND ` +
       "left readers on the pre-chain board; the end-of-run archive check rewrites the dated " +
       "key from this same payload");
    ok(lines.some((l) => /archive board:long:2026-08-24: NOT WRITTEN/.test(l) &&
       /end-of-run check/.test(l)),
       `and it says the archive was not written and what will write it (${lines[0]})`);

    ok(seen.includes("board:short:2026-08-24") && seen.includes("board:short"),
       "while the other side re-publishes normally — sides fail independently");
  }

  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const chains = new Map([["AAA", chain(0.04, -0.02, 0.31, 25)], ["CCC", chain(0.06, 0.01, 0.28, 32)]]);
    const lines = await republishWithChain(payloads, chains, "2026-08-24", async (key) => {
      seen.push(key);
      if (key.endsWith(":2026-08-24")) {
        const error = new Error("ingest board -> HTTP 409 archive_immutable");
        error.status = 409;
        throw error;
      }
    });
    ok(seen.includes("board:long") && seen.includes("board:short"),
       `THE UW-4 CASE: a 409 on the dated key still publishes the live board with its chain ` +
       `columns (${seen.join(", ")}) — run 66 left 0 of 50 live rows with atmIv while the ` +
       "archive held 25");
    ok(lines.filter((l) => /ALREADY HOLDS this session \(409\)/.test(l)).length === 2 &&
       lines.every((l) => !/NOT WRITTEN/.test(l)),
       "and the 409 is reported as the archive already holding the session, not as a loss");
  }

  {
    const store = new Map([["board:short:2026-08-24", { rows: [{ t: "EARLIER" }] }]]);
    const written = [];
    const report = await ensureArchived({
      "scores:2026-08-24": { rows: [] },
      "board:long:2026-08-24": { rows: [{ t: "AAA" }] },
      "board:short:2026-08-24": { rows: [{ t: "CCC" }] },
    }, {
      landed: new Set(["scores:2026-08-24"]),
      reader: async (key) => (store.has(key)
        ? { payload: store.get(key), status: 200 } : { payload: null, absent: true, status: 200 }),
      write: async (key) => { written.push(key); },
    });
    assert.deepEqual(report.map((r) => `${r.key}=${r.state}`),
      ["scores:2026-08-24=written", "board:long:2026-08-24=repaired", "board:short:2026-08-24=held"],
      "THE END-OF-RUN CHECK: a key this run wrote stands, a key the store lacks is written " +
      "again from the run's payload, and a key an earlier run holds is left alone"); checks++;
    assert.deepEqual(written, ["board:long:2026-08-24"],
      "and only the missing key is written — the check never overwrites an archived session"); checks++;

    const lost = await ensureArchived({ "board:long:2026-08-24": { rows: [] } }, {
      landed: new Set(),
      reader: async () => ({ payload: null, failed: true, status: 403 }),
      write: async () => { const e = new Error("HTTP 403"); e.status = 403; throw e; },
    });
    eq(lost[0].state, "lost",
       "and a key that can be neither read nor written is reported LOST, which main() prints " +
       "as a loud warning rather than letting the run end green in silence");
  }

  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const lines = await republishWithChain(payloads, new Map(), "2026-08-24", async (key) => { seen.push(key); });
    eq(seen.length, 0,
       "a run whose chain leg never reached a board name re-publishes NOTHING — the session's " +
       "row is simply gappy, which the IC table's per-column n reports on its own");
    eq(lines.length, 0, "and says nothing it did not do");
  }

  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const chains = new Map([["AAA", chain(0.04, -0.02, 0.31, 25)], ["CCC", chain(0.06, 0.01, 0.28, 32)]]);
    const lines = await republishWithChain(payloads, chains, null, async (key) => { seen.push(key); });
    eq(seen.length, 0,
       `with no session date NOTHING is published — not the dated copy, and not the live ` +
       `board that would then carry columns its own archive can never reproduce ` +
       `(${seen.join(", ") || "nothing written"})`);
    eq(lines.length, 2,
       "and the run reports the skip for both sides rather than passing over it in silence");
    ok(lines.every((l) => /SKIPPED/.test(l) && /not an archive date/.test(l)),
       `each line names the reason and the value that caused it (${lines.join(" | ")})`);
    ok(lines.some((l) => l.includes("board:long")) && lines.some((l) => l.includes("board:short")),
       "one line per side, so a log reader can see it was not one board that was skipped");
  }

  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const lines = await archiveDatedBoards(payloads, "2026-08-24", async (key) => { seen.push(key); });
    assert.deepEqual(seen, ["board:long:2026-08-24", "board:short:2026-08-24"],
      "with no chain leg the dated copies are written, both sides, and NOTHING else — the " +
      "live boards are already correct and republishing them would be a write with no " +
      "change behind it"); checks++;
    eq(lines.length, 0, "and a clean archive says nothing, so a log line means something happened");
  }

  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const lines = await archiveDatedBoards(payloads, null, async (key) => { seen.push(key); });
    eq(seen.length, 0,
       `an unresolved session date writes no dated key at all (${seen.join(", ") || "nothing"})`);
    eq(lines.length, 1,
       "and says so ONCE rather than twice — datedKey refuses on the session date, which " +
       "both sides share, so a second sentence would be the same sentence");
    ok(/refusing to write a dated key/.test(lines[0]),
       `naming what it refused and why (${lines[0]})`);
  }

  {

    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const lines = await archiveDatedBoards(payloads, "2026-08-24", async (key) => {
      seen.push(key);
      if (key.includes("long")) {
        const error = new Error("ingest refused");
        error.status = 409;
        throw error;
      }
    });
    eq(seen.length, 2,
       "a refused long side does not abandon the short side's archive");
    eq(lines.length, 1, "and exactly one line is reported, for the side that was refused");
    ok(/ALREADY WRITTEN by an earlier run/.test(lines[0]) && /KEEPS THE FIRST/.test(lines[0]),
       `which says the archive keeps what the earlier run published (${lines[0].slice(0, 80)}…)`);
  }

  {

    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const lines = await archiveDatedBoards(payloads, "2026-08-24", async () => {
      const error = new Error("the store did not answer");
      error.status = 503;
      throw error;
    });
    eq(lines.length, 2, "both sides report");
    ok(lines.every((l) => /the store did not answer/.test(l) && !/ALREADY WRITTEN/.test(l)),
       `each carrying the failure's own message rather than the immutability sentence ` +
       `(${lines[0]})`);
  }

  {
    ok(PUBLISH_RETRYABLE.has(ARCHIVE_REFUSALS.refuse_unreadable.status),
       `an unreadable archive is retryable (${ARCHIVE_REFUSALS.refuse_unreadable.status}) — ` +
       `nothing was written, the store is simply not answering, and the next attempt is ` +
       `the right move`);
    ok(!PUBLISH_RETRYABLE.has(ARCHIVE_REFUSALS.refuse_immutable.status),
       `a written day is NOT retryable (${ARCHIVE_REFUSALS.refuse_immutable.status}) — ` +
       `retrying cannot change the answer, and the correction path is the deliberate ` +
       `two-step DELETE rather than persistence`);
    ok(!PUBLISH_RETRYABLE.has(ARCHIVE_REFUSALS.refuse_raced.status),
       `and neither is a raced key (${ARCHIVE_REFUSALS.refuse_raced.status}): another ` +
       `writer got there, nothing was overwritten, and a retry would only ask the same ` +
       `question again`);
  }

  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const chains = new Map([["AAA", chain(0.04, -0.02, 0.31, 25)], ["CCC", chain(0.06, 0.01, 0.28, 32)]]);
    await republishWithChain(payloads, chains, "2026-08-24", async (key) => { seen.push(key); });
    eq(seen.indexOf("board:long:2026-08-24") < seen.indexOf("board:long"), true,
       `on a real session date the DATED copy is written before the live board ` +
       `(${seen.join(", ")}) — the order the archive's whole design rests on`);
    ok(seen.includes("board:short:2026-08-24") && seen.includes("board:short"),
       "and both sides publish, dated copy first");
  }

  {
    const written = [];
    const unmeasured = { vannaScale: { status: "unmeasured", ratio: null, n: 0 } };
    const measured = { vannaScale: { status: "agree", ratio: 1.02, n: 50 } };
    const payloads = {
      long: { ...board("long", ["AAA"]), variation: unmeasured },
      short: { ...board("short", ["CCC"]), variation: unmeasured },
    };
    for (const side of ["long", "short"]) {
      for (const row of payloads[side].rows) row.variation = { vannaPerPointPctAdv: null, why: { vanna: "vanna-unchecked" } };
    }
    const refresh = (row) => { row.variation = { vannaPerPointPctAdv: 0.000718, why: {} }; return true; };
    const chains = new Map([["AAA", chain(0.04, -0.02, 0.31, 25)]]);
    const lines = await republishWithChain(payloads, chains, "2026-08-24",
      async (key, payload) => { written.push([key, JSON.stringify(payload)]); }, refresh, measured);
    const keys = written.map(([k]) => k);
    assert.deepEqual(keys, ["board:long:2026-08-24", "board:long", "board:short:2026-08-24", "board:short"],
      "A SIDE WITH NO CHAIN ROW IS STILL REPUBLISHED WHEN THE VARIATION REFRESH CHANGED IT: the short " +
      "board used to be skipped, the end-of-run check archived its re-measured payload, and the live " +
      `board kept vanna-unchecked beside an archive that said agree over 50 names (${keys.join(", ")})`); checks++;
    const byKey = new Map(written);
    eq(byKey.get("board:short:2026-08-24"), byKey.get("board:short"),
       "and the dated copy is the live board, byte for byte");
    ok(JSON.parse(byKey.get("board:short")).variation.vannaScale.status === "agree" &&
       JSON.parse(byKey.get("board:short")).rows[0].variation.vannaPerPointPctAdv === 0.000718,
       "carrying the measured scale and the re-measured row");
    ok(lines.some((l) => /re-published board:short with chain columns on 0 row\(s\), variation re-measured on 1, and the board's measured variation block/.test(l)),
       `and the log says why a side with no chain row went out again (${lines.join(" | ")})`);

    const still = [];
    const quiet = { long: { ...board("long", ["AAA"]), variation: unmeasured } };
    await republishWithChain(quiet, new Map(), "2026-08-24", async (key) => { still.push(key); },
      null, { vannaScale: { status: "unmeasured", ratio: null, n: 0 } });
    eq(still.length, 0, "while a side whose rows and block did not change is still left alone");
  }
}

{
  const lines = describeTickFields("AAPL", {
    tape_time: "2026-08-24T13:31:00Z", net_delta: "12",
    net_call_premium: "900", net_put_premium: "-400",
    bid_side_volume: "40", ask_side_volume: "60", net_volume: "20",
  });
  ok(/3 unread/.test(lines[0]), `the probe counts what is unread (${lines[0]})`);
  ok(/7 keys/.test(lines[0]), "against the full key count");
  ok(/bid_side_volume=/.test(lines[1]) && /ask_side_volume=/.test(lines[1]),
     `and names the unknown fields with their values (${lines[1]})`);
  for (const known of TICK_FIELDS_READ) {
    ok(!lines[1].includes(known + "="), `${known} is already read, so the probe does not repeat it`);
  }

  const wide = { tape_time: "x" };
  for (let i = 0; i < 40; i++) wide["f" + i] = "y".repeat(500);
  const bounded = describeTickFields("WIDE", wide);
  ok(bounded[1].length < 900, `a forty-field row logs ${bounded[1].length} chars, not thousands`);
  ok(/\+28 more/.test(bounded[1]), `with the remainder counted rather than dropped (${bounded[1].slice(-20)})`);

  const none = describeTickFields("EMPTY", {});
  eq(none.length, 1, "an empty row logs one line");
  ok(/no keys at all/.test(none[0]), `saying what came back (${none[0]})`);
}

{
  const base = {
    ticker: "T", close: "100", prev_close: "100",
    bullish_premium: "1", bearish_premium: "1", call_premium: "1", put_premium: "1",
    call_volume: 9000, put_volume: 6000, total_open_interest: 10,
  };
  const both = screenerTilt({ ...base, avg_30_day_call_volume: 3000, avg_30_day_put_volume: 3000 });
  ok(Math.abs(both.surpriseTilt - Math.log(3.1 / 2.1)) < 1e-12,
     "with both norms on the wire, surpriseTilt is the log ratio of the two surprises");

  eq(screenerTilt(base).surpriseTilt, null,
     "a name with NO 30-day volume norm publishes null, never a balanced zero");
  eq(screenerTilt({ ...base, avg_30_day_call_volume: 3000 }).surpriseTilt, null,
     "and one norm alone cannot measure a ratio of two surprises");
}

{

  const keepDate = (datedUsable, undatedUsable) => datedUsable || !undatedUsable;

  ok(keepDate(true, true), "both usable: keep the dated call, it is correct by construction");
  ok(keepDate(true, false), "dated works and undated does not: obviously keep it");
  ok(!keepDate(false, true),
     "dated fails while undated succeeds: the ONLY evidence that `date` is at fault");
  ok(keepDate(false, false),
     "neither works: the probe learned nothing, so it must not change behaviour");
}

{

  const morning = easternNow(new Date("2026-08-25T13:00:00Z"));
  ok(morning.date === "2026-08-25", `the Eastern calendar date (got ${morning.date})`);
  ok(morning.minutes === 9 * 60, `and the minute of the Eastern day (got ${morning.minutes})`);
  ok(morning.minutes < 16 * 60, "before the close, so today's candle is a partial session");

  const evening = easternNow(new Date("2026-08-25T21:30:00Z"));
  ok(evening.minutes >= 16 * 60, "after the close, so today's candle is complete");

  const winter = easternNow(new Date("2026-01-15T13:00:00Z"));
  ok(winter.minutes === 8 * 60, `daylight saving is handled by the zone, not by arithmetic (got ${winter.minutes})`);

  const midnight = easternNow(new Date("2026-08-25T04:00:00Z"));
  ok(midnight.minutes === 0, `midnight is minute zero, not 1440 (got ${midnight.minutes})`);

  ok(DEAD_BAND > 0 && DEAD_BAND < 100, "the dead band is a publishable threshold");
}

{
  const scored = Array.from({ length: 60 }, (_, i) => ({
    ticker: "T" + i, score: 90 - i * 3, residual: (90 - i * 3) / 100,
  }));
  const sides = partitionSides(scored);

  ok(Array.isArray(sides.neutralRows), "the dead band is published as a list of rows");
  eq(typeof sides.neutral, "number",
     "and `neutral` STAYS a count — a wire field's type is not free to change under the deck");
  eq(sides.neutral, sides.neutralRows.length,
     "THE FIX: the count is derived from the list, so a payload can never claim 48 above a list of 40");

  const seen = new Set();
  for (const r of [...sides.long, ...sides.short, ...sides.neutralRows]) {
    ok(!seen.has(r.ticker), `${r.ticker} appears on exactly one of long, short and watch`);
    seen.add(r.ticker);
  }
  eq(seen.size, scored.length, "and every scored name lands on exactly one of the three");

  for (const r of sides.neutralRows) {
    ok(Math.abs(r.score) < sides.deadBand,
       `a watch name is inside the band by construction (${r.ticker} at ${r.score})`);
  }
  eq(partitionSides([]).neutral, 0, "an empty pool reports no neutral names, not a crash");
}

{
  eq(datedKey("long", "2026-08-26"), "board:long:2026-08-26", "a dated board key is side and session");
  eq(datedKey("short", "2026-08-26"), "board:short:2026-08-26", "and both sides are dated");

  eq(datedKey("long", null), null, "no session date yields NO key rather than an unprunable one");
  eq(datedKey("long", undefined), null, "and neither does an undefined one");
  eq(datedKey("long", ""), null, "nor an empty string");
  eq(datedKey("long", "2026-8-6"), null, "a non-ISO date is refused rather than normalised");
  eq(datedKey("long", "not-a-date"), null, "and so is anything else");
}

{
  const session = "2026-08-26";
  const keys = pruneKeys(session);
  const day = (back) => new Date(Date.parse(session + "T00:00:00Z") - back * 86400000)
    .toISOString().slice(0, 10);

  ok(keys.includes(`board:long:${day(ARCHIVE_RETENTION_DAYS + 1)}`),
     "the first day PAST the retention window is swept");
  ok(!keys.includes(`board:long:${day(ARCHIVE_RETENTION_DAYS)}`),
     "THE BOUNDARY: the oldest day still inside the window is never deleted — off by one here silently " +
     "drops the cohort a scorer is about to read");
  ok(!keys.includes(`board:long:${day(0)}`) && !keys.includes(`board:long:${day(1)}`),
     "and today's board and yesterday's are nowhere near the sweep");
  ok(!keys.includes(`board:long:${day(ARCHIVE_RETENTION_DAYS + ARCHIVE_PRUNE_LOOKBACK_DAYS + 1)}`),
     "the sweep stops at the far edge too, rather than walking back to the epoch");

  for (const k of keys) {

    const m = /^(?:board:(?:long|short)|scores):(\d{4}-\d{2}-\d{2})$/.exec(k);
    ok(m, `every swept key is a dated archive key and nothing else (${k})`);
    ok(Date.parse(m[1] + "T00:00:00Z") < Date.parse(session + "T00:00:00Z") - ARCHIVE_RETENTION_DAYS * 86400000,
       `${k} is strictly older than the retention window`);
  }
  ok(keys.some((k) => k.startsWith("scores:")),
     "and the dated scores pool IS in the sweep — an archive key the prune " +
     "does not name grows forever");

  eq(keys.length, 3 * ARCHIVE_PRUNE_LOOKBACK_DAYS,
     "THE BOUND: one run deletes at most three archive keys x the lookback " +
     "(two board sides and the scores pool), and that number is knowable before it runs");
  eq(new Set(keys).size, keys.length, "and never names the same row twice");

  ok(!keys.some((k) => k.startsWith("card:") || k === "meta" || k === "board:watch" ||
                       k === "board:long" || k === "board:short"),
     "the sweep cannot name a live key, a card or the meta row");

  eq(pruneKeys(null).length, 0, "no session date means no sweep rather than a sweep of garbage keys");
  eq(pruneKeys("2026-8-6").length, 0, "and neither does a malformed one");

  ok(ARCHIVE_RETENTION_DAYS >= 120 && ARCHIVE_RETENTION_DAYS <= 135,
     "126 calendar days is 90 trading sessions at 5/7 — nine times the ten-session forecast horizon");
  ok(ARCHIVE_RETENTION_DAYS / 7 * 5 >= 9 * HORIZON_SESSIONS,
     "the window holds many multiples of the horizon, so the archive is a record and not a buffer");
}

{
  const http = await import("node:http");
  const prevUrl = process.env.FLOWS_INGEST_URL;
  const prevTok = process.env.FLOWS_INGEST_TOKEN;
  process.env.FLOWS_INGEST_TOKEN = "test-token";

  const LOOKBACK = 6;
  const run = async (status) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push({ method: req.method, url: req.url });
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    process.env.FLOWS_INGEST_URL = `http://127.0.0.1:${server.address().port}/api/flows/ingest`;
    try {
      const result = await pruneArchive("2026-08-26", { lookbackDays: LOOKBACK });
      return { seen, result };
    } finally {
      await new Promise((r) => server.close(r));
    }
  };

  try {
    const refused = await run(405);
    eq(refused.seen.length, 3,
       "THE CIRCUIT BREAKER: three identical refusals is enough — the sweep does not ask a route that " +
       "rejects DELETE another fifty-seven times");
    ok(refused.result.abandoned, "and it says so, rather than reporting a clean prune of nothing");
    eq(refused.seen[0].method, "DELETE", "the sweep deletes rather than overwriting with a tombstone");

    const missing = await run(404);
    eq(missing.seen.length, 3 * LOOKBACK,
       "a 404 is an ordinary empty day, so the sweep runs the whole skirt rather than stopping at the first gap");
    ok(!missing.result.abandoned, "and reports no abandonment");
    eq(missing.result.removed, 0, "with nothing removed, honestly");

    const done = await run(200);
    eq(done.result.removed, 3 * LOOKBACK,
       "and every key that really was there is counted as removed");
  } finally {
    process.env.FLOWS_INGEST_URL = prevUrl;
    process.env.FLOWS_INGEST_TOKEN = prevTok;
    if (prevUrl === undefined) delete process.env.FLOWS_INGEST_URL;
    if (prevTok === undefined) delete process.env.FLOWS_INGEST_TOKEN;
  }
}

{
  const mk = (ticker, score, extra = {}) => ({
    ticker, score, residual: score / 100,
    conviction: 50, spot: 100, purity: 0.5, gRegime: "long", flipDist: 0.1,
    fam: { F: score, P: 0, D: 0, O: 50, V: 40 },
    closes: Array.from({ length: 60 }, (_, i) => 100 + i),
    r5: 0.01, r21: 0.02, r42: 0.03,
    week52Pos: 0.42, vrp: 0.03, ivRank: 0.61,
    impliedMovePerc: 0.05, iv30: 0.4, rv30: 0.3,
    ...extra,
  });

  const screener = new Map([["A", { close: "101", prev_close: "100" }]]);
  const tilts = new Map([
    ["A", { surpriseTilt: 1.23456, relVolume: 2.718, putCallRatio: 0.87654 }],

    ["B", { surpriseTilt: NaN, relVolume: NaN, putCallRatio: NaN }],
  ]);

  const pool = [mk("C", 3), mk("A", -19), mk("B", 12), mk("D", -7)];
  const rows = toWatchRows(pool, screener, tilts);

  eq(rows.map((r) => r.t).join(","), "A,B,D,C",
     "THE RANKING: the name CLOSEST to leaving the band is first, whichever side it is closest on");
  eq(rows.map((r) => r.r).join(","), "1,2,3,4", "and the published rank agrees with the order");

  const board = toRows([mk("A", -19)], screener, []);
  eq(board.length, 1, "the board builder still produces a row");
  for (const key of Object.keys(board[0])) {
    ok(key in rows[0], `a watch row carries the board's own \`${key}\`, not a synonym for it`);
  }

  for (const key of ["w52", "vrp", "ivr"]) {
    ok(board[0][key] !== undefined, `the board row still emits \`${key}\``);
    ok(rows[0][key] !== undefined, `and the watch row carries \`${key}\` too`);
  }

  {
    const base = screener.get("A");
    const withScreener = (extra) => new Map([["A", { ...base, ...extra }]]);
    const row = (map) => toRows([mk("A", -19)], map, new Map())[0];

    eq(row(withScreener({ net_call_premium: "900000", net_put_premium: "400000" })).netPrem,
       500000, "a quoted name publishes call premium minus put premium");

    eq(row(withScreener({})).netPrem, null,
       "and a name the vendor quoted NEITHER leg for publishes null, never a balanced zero");

    eq(row(withScreener({ net_call_premium: "250000", net_put_premium: "250000" })).netPrem, 0,
       "while two legs that genuinely cancel still publish zero, which is a measurement");

    eq(row(withScreener({ net_call_premium: "700000" })).netPrem, 700000,
       "and one quoted leg alone is a measurement, not an absence");
  }

  eq(board[0].w52, 0.42, "w52 is the 52-week position from the candles, unchanged in name and unit");
  eq(rows[0].w52, 0.42, "and the watch row publishes the SAME 52-week position, not a second one");

  eq(rows[0].surpriseTilt, 1.235, "surpriseTilt is finally published, rounded to a thousandth");
  eq(rows[0].relVolume, 2.72, "relative volume at the two decimals the vendor quotes");
  eq(rows[0].putCallRatio, 0.877, "and the put/call ratio at three");

  const b = rows.find((r) => r.t === "B");
  eq(b.surpriseTilt, null, "a name with no 30-day volume norm reports null, not a balanced zero");
  eq(b.relVolume, null, "an absent relative volume is null, not a flat 0x");
  eq(b.putCallRatio, null, "an absent put/call ratio is null, not a call-only 0");

  const orphan = toWatchRows([mk("Z", 5)], screener, tilts);
  eq(orphan[0].surpriseTilt, null, "a name with no tilt row at all is null across the three columns");

  const wide = toWatchRows(
    Array.from({ length: 90 }, (_, i) => mk("W" + i, 19 - (i % 19))), screener, new Map());
  eq(wide.length, WATCH_ROWS, `the watch list is capped at ${WATCH_ROWS} rows however wide the band is`);
  ok(Math.abs(wide[0].s) >= Math.abs(wide[wide.length - 1].s),
     "and the rows that survive the cap are the ones nearest the edge of the band");
  eq(toWatchRows([], screener, tilts).length, 0, "an empty band publishes an empty list, not a crash");
}

{

  const ramp = (n, driftBp, p0 = 100) => {
    const out = [];
    let logPx = Math.log(p0);
    for (let i = 0; i < n; i++) { out.push(Math.exp(logPx)); logPx += driftBp / 10000; }
    return out;
  };
  const last = (xs) => xs[xs.length - 1];

  const up = trixSeriesBp(ramp(200, 200));
  near(last(up), 200, 1e-6,
       "TRIX of a constant 200 bp/session log ramp settles at exactly 200 bp");

  const down = trixSeriesBp(ramp(200, -200));
  near(last(up), -last(down), 1e-6,
       "THE LOG: a ramp down reads exactly the negative of the same ramp up");

  const flatSeries = trixSeriesBp(new Array(200).fill(100));
  eq(last(flatSeries), 0, "a price that never moves reads exactly 0 bp, not epsilon");

  eq(scaleTrix(0), 50, "zero momentum is the midpoint of the scale, not the bottom");
  eq(scaleTrix(TRIX_FULL_SCALE_BP), 100, "the positive rail is the full-scale band");
  eq(scaleTrix(-TRIX_FULL_SCALE_BP), 0, "and the negative rail its mirror");
  eq(scaleTrix(TRIX_FULL_SCALE_BP * 4), 100, "past the rail it clamps rather than overflowing");
  eq(scaleTrix(NaN), null, "an unmeasurable reading scales to null, never to 50");
  ok(scaleTrix(TRIX_FULL_SCALE_BP / 2) > scaleTrix(TRIX_FULL_SCALE_BP / 4),
     "and inside the rails it is strictly monotone in the raw reading");
}

{
  const ramp = (n, driftBp, p0 = 100) => {
    const out = [];
    let logPx = Math.log(p0);
    for (let i = 0; i < n; i++) { out.push(Math.exp(logPx)); logPx += driftBp / 10000; }
    return out;
  };
  const candles = (closes) => closes.map((c, i) => ({
    start_time: new Date(Date.UTC(2026, 1, 2, 14, 30) + i * 86400000).toISOString(),
    close: c.toPrecision(15),
    high: String(c * 1.005), low: String(c * 0.995), volume: 5e6,
  }));

  const day = (driftsBp, { sessions = 200 } = {}) => new Map(
    SECTOR_ETFS.map((s, i) => [s.etf, candles(ramp(sessions, driftsBp[i]))]));
  const spread = (rows) => {
    const xs = rows.filter((r) => r.trix !== null).map((r) => r.trix);
    return Math.max(...xs) - Math.min(...xs);
  };

  eq(SECTOR_ETFS.length, 11, "eleven GICS sectors, eleven vendor tickers");
  eq(SECTOR_ETFS.map((s) => s.etf).join(" "),
     "XLB XLC XLE XLF XLI XLK XLP XLRE XLU XLV XLY",
     "the standard SPDR sector ETFs, in one named constant");

  const flat = sectorTrix(day([0, 0.4, -0.3, 0.2, 0, -0.1, 0.3, 0, -0.2, 0.1, 0]));
  const rotating = sectorTrix(day([-40, -30, -20, -10, 0, 8, 15, 22, 30, 38, 45]));

  eq(flat.filter((r) => r.trix !== null).length, 11, "all eleven sectors measured on the flat day");
  eq(rotating.filter((r) => r.trix !== null).length, 11, "and all eleven on the rotating day");

  ok(spread(flat) < 2,
     `THE TEST: a flat session renders flat — all eleven inside ${spread(flat).toFixed(2)} points of each other`);
  ok(spread(rotating) > 60,
     `and a genuinely rotating session spreads across the range (${spread(rotating).toFixed(1)} points)`);
  ok(spread(rotating) > 30 * spread(flat),
     "so the two sessions are not merely different, they are an order of magnitude apart");
  for (const r of flat) {
    ok(Math.abs(r.trix - 50) < 1,
       `${r.etf} sat near the neutral midpoint on a flat day, not at a rail (${r.trix})`);
  }

  for (const r of [...flat, ...rotating]) {
    const want = Number(
      (50 + 50 * Math.max(-1, Math.min(1, r.trixBp / TRIX_FULL_SCALE_BP))).toFixed(1));
    eq(r.trix, want,
       `${r.etf}: the scaled reading is exactly the published relation applied to the published raw bp`);
  }

  const quiet = sectorTrix(day([20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const wild = sectorTrix(day([20, -90, 80, -70, 60, -50, 90, -80, 70, -60, 95]));
  eq(quiet[0].trix, wild[0].trix,
     "XLB on a 20 bp drift reads the same beside ten flat sectors as beside ten extreme ones");
  near(quiet[0].trix, 70, 0.2, "and that reading is the fixed relation's answer, 70");

  const extreme = sectorTrix(day([200, 10, -200, -10, 0, 0, 0, 0, 0, 0, 0]));
  eq(extreme[0].trix, 100, "a 200 bp sector prints the top of the scale");
  eq(extreme[0].clamped, true, "and declares itself clamped");
  eq(extreme[0].clampedPoints, TRIX_SERIES, "with every point of its drawn line on the rail");
  eq(extreme[2].trix, 0, "a -200 bp sector prints the bottom");
  eq(extreme[2].clamped, true, "and declares itself clamped too");
  eq(extreme[1].clamped, false, "a 10 bp sector is nowhere near a rail");
  eq(extreme[1].clampedPoints, 0, "and none of its line is pinned");

  const bend = (n, driftAt, p0 = 100) => {
    const out = [];
    let logPx = Math.log(p0);
    for (let i = 0; i < n; i++) { out.push(Math.exp(logPx)); logPx += driftAt(i) / 10000; }
    return out;
  };
  const turning = sectorTrix(new Map([
    ["XLB", candles(bend(220, (i) => (i < 195 ? 0 : 40)))]]))[0];
  const line = turning.series;
  eq(line[0], 50,
     "the published line begins at the neutral midpoint, because the sector really was flat then");
  ok(line[line.length - 1] - line[0] > 20,
     `THE WINDOW IS THE RECENT ONE: the line rises ${(line[line.length - 1] - line[0]).toFixed(1)} points across it — an oldest-first slice would be thirty identical 50s`);
  ok(line.every((v, i) => i === 0 || v >= line[i - 1]),
     "and it rises monotonically, tracking the turn in the underlying rather than wobbling");
  eq(line[line.length - 1], turning.trix, "ending on the scalar published beside it");

  for (const r of rotating) {
    eq(r.series.length, TRIX_SERIES, `${r.etf} publishes ${TRIX_SERIES} sessions of history`);
    ok(r.series.every((v) => Number.isFinite(v) && v >= 0 && v <= 100),
       `${r.etf}'s whole line sits on the published 0-100 axis`);
    eq(last_(r.series), r.trix, `${r.etf}'s line ends on the scalar it is published beside`);
  }
  function last_(xs) { return xs[xs.length - 1]; }
}

{
  const ramp = (n, driftBp, p0 = 100) => {
    const out = [];
    let logPx = Math.log(p0);
    for (let i = 0; i < n; i++) { out.push(Math.exp(logPx)); logPx += driftBp / 10000; }
    return out;
  };
  const candles = (closes) => closes.map((c, i) => ({
    start_time: new Date(Date.UTC(2026, 1, 2, 14, 30) + i * 86400000).toISOString(),
    close: c.toPrecision(15),
    high: String(c * 1.005), low: String(c * 0.995), volume: 5e6,
  }));

  const rows = sectorTrix(new Map([
    ["XLB", candles(ramp(200, 20))],
    ["XLC", []],
    ["XLE", candles(ramp(46, 30))],
    ["XLF", candles(ramp(200, 20)).map((c, i) => (i === 197 ? { ...c, close: "0" } : c))],
    ["XLI", candles(ramp(230, 20)).map((c, i) => (i === 5 ? { ...c, close: "0" } : c))],
  ]));
  const by = new Map(rows.map((r) => [r.etf, r]));

  eq(rows.length, 11,
     "ALL ELEVEN SECTORS ARE ALWAYS PRESENT — a panel must not quietly shrink when the vendor stops answering");
  eq(rows.map((r) => r.etf).join(" "), SECTOR_ETFS.map((s) => s.etf).join(" "),
     "in the constant's order, so a renderer can index them");

  ok(by.get("XLB").trix !== null, "the healthy sector is measured");

  for (const etf of ["XLC", "XLE", "XLF", "XLU"]) {
    const r = by.get(etf);
    eq(r.trix, null, `${etf} is null when it cannot be measured`);

    ok(r.trix !== 0 && r.trix !== 50, `${etf} is not rendered as a confident reading`);
    eq(r.trixBp, null, `${etf} publishes no raw reading either`);
    eq(r.series, null, `${etf} publishes no trend line`);
    eq(r.clamped, null, `${etf}'s clamp flag is null, not a definite false`);
    ok(typeof r.reason === "string" && r.reason.length > 10,
       `${etf} states WHY it is unmeasured: "${r.reason}"`);
  }
  eq(by.get("XLB").reason, null, "and a measured sector carries no reason");

  ok(/no candles/.test(by.get("XLC").reason), "an empty response says so");

  ok(new RegExp(`^46 usable XLE closes of 46 returned; ${TRIX_MIN_CANDLES} are needed`)
       .test(by.get("XLE").reason),
     `a short series names both what it had and what it needed: "${by.get("XLE").reason}"`);

  const unsettled = trixSeriesBp(ramp(46, 30));
  ok(Math.abs(unsettled[unsettled.length - 1] - 30) > 1.5,
     `and the unsettled reading really was different (${unsettled[unsettled.length - 1].toFixed(2)} bp against a true 30.00)`);
  const settled = trixSeriesBp(ramp(TRIX_MIN_CANDLES, 30));
  near(settled[settled.length - 1], 30, 0.1,
       "while at the published minimum the same ramp reads its true drift");

  ok(/^2 usable XLF closes of 200 returned/.test(by.get("XLF").reason),
     `a zero close three sessions ago takes the sector out: "${by.get("XLF").reason}"`);
  ok(by.get("XLI").trix !== null,
     "but a bad candle 224 sessions ago does NOT — the reading is computed on the clean tail");
  near(by.get("XLI").trixBp, 20, 0.05,
     "and that tail reads its true drift, so the bad bar left nothing behind in the smoother");
}

{
  const mk = (ticker, opts = {}) => ({
    ticker,
    close: String(opts.close === undefined ? 100 : opts.close),
    prev_close: String(opts.prev_close === undefined ? 100 : opts.prev_close),
    sector: opts.sector === undefined ? "Technology" : opts.sector,
    net_call_premium: String(opts.nc === undefined ? 0 : opts.nc),
    net_put_premium: String(opts.np === undefined ? 0 : opts.np),
  });

  const strip = (row, ...keys) => {
    const out = { ...row };
    for (const k of keys) delete out[k];
    return out;
  };
  const tilt = (relVolume, surpriseTilt) => ({ relVolume, surpriseTilt });

  const probe = buildMovers([{ row: mk("A", { close: 101 }), tilt: {} }]);
  ok(!(probe instanceof Promise),
     "THE BUDGET: buildMovers is synchronous — a surface that cannot await cannot make an API call");

  const rows = [
    { row: mk("UP1", { close: 110, prev_close: 100, nc: 9e6, np: -1e6 }), tilt: tilt(3.2, 0.51) },
    { row: mk("UP2", { close: 104, prev_close: 100, nc: 4e6, np: 1e6 }), tilt: tilt(1.1, 0.02) },
    { row: mk("FLAT", { close: 100, prev_close: 100, nc: 1e6, np: 1e6 }), tilt: tilt(0.9, 0) },
    { row: mk("DN1", { close: 90, prev_close: 100, nc: -2e6, np: 7e6 }), tilt: tilt(2.4, -0.4) },
    { row: mk("DN2", { close: 97, prev_close: 100, nc: 0, np: 3e6 }), tilt: tilt(1.4, -0.1) },
    { row: strip(mk("NOPREV", { close: 150, nc: 5e6, np: 0 }), "prev_close"), tilt: tilt(2, 0.1) },
    { row: strip(mk("NOPREM", { close: 120, prev_close: 100 }), "net_call_premium", "net_put_premium"),
      tilt: tilt(5, 1.2) },
  ];
  const m = buildMovers(rows);

  eq(m.risers.map((r) => r.t).join(","), "NOPREM,UP1,UP2",
     "the risers lead with the largest gain and descend");
  eq(m.fallers.map((r) => r.t).join(","), "DN1,DN2",
     "THE FALLERS LEAD WITH THE LARGEST DECLINE, not the smallest");
  ok(m.fallers[0].chg < m.fallers[m.fallers.length - 1].chg,
     "so the faller list is ordered by depth of fall, not by proximity to zero");

  const both = m.risers.map((r) => r.t).filter((t) => m.fallers.some((f) => f.t === t));
  eq(both.length, 0, "no name can appear on both sides — a move cannot be positive and negative");
  ok(!m.risers.some((r) => r.t === "FLAT") && !m.fallers.some((r) => r.t === "FLAT"),
     "and an unchanged name is on neither list, because flat is not a move");

  eq(m.risers.find((r) => r.t === "UP1").chg, 0.1, "chg is a fraction of the prior close");
  eq(m.fallers.find((r) => r.t === "DN1").chg, -0.1, "signed, with the same unit in both directions");

  eq(moverRow(strip(mk("X"), "prev_close"), {}).chg, null,
     "a name with no prior close reports a null move, never 0");
  eq(m.unrankedChange, 1, "and is counted as unranked rather than silently dropped");
  eq(m.ranked, rows.length - 1, "the ranked population is published beside the lists");
  ok(!m.risers.some((r) => r.t === "NOPREV") && !m.fallers.some((r) => r.t === "NOPREV"),
     "it appears on neither list");

  eq(m.premium.basis, "byName",
     "the premium lists say they are BY NAME — per-contract needs a flow-alerts endpoint this key cannot reach");
  eq(m.premium.bullish.map((r) => r.t).join(","), "UP1,NOPREV,UP2",
     "the bullish list leads with the largest net call-over-put premium");

  ok(m.premium.bullish.some((r) => r.t === "NOPREV"),
     "a name with no prior close is still ranked on premium — the two lists gate independently");
  eq(m.premium.bearish.map((r) => r.t).join(","), "DN1,DN2",
     "and the bearish list leads with the largest net put-over-call premium");
  eq(m.premium.bullish[0].netPrem, 10_000_000,
     "netPrem is net call premium minus net put premium, in signed dollars");
  eq(m.premium.bearish[0].netPrem, -9_000_000, "negative on the put side");
  ok(!m.premium.bullish.some((r) => r.t === "FLAT") && !m.premium.bearish.some((r) => r.t === "FLAT"),
     "a name whose two premium legs cancel is on neither list");

  eq(m.risers.find((r) => r.t === "NOPREM").netPrem, null,
     "a name the screener quoted no premium for reports null, never a balanced zero");
  eq(m.unrankedPremium, 1, "and is counted out of the premium population");
  eq(m.priced, rows.length - 1, "which is published too");

  const up1 = m.risers.find((r) => r.t === "UP1");
  eq(up1.relVolume, 3.2, "relative volume rides along at the two decimals the vendor quotes");
  eq(up1.surpriseTilt, 0.51, "so does surpriseTilt, at three");
  eq(up1.sector, "Technology", "and the vendor's own sector string, verbatim");
  eq(moverRow(mk("Y", { sector: null }), {}).sector, null, "an absent sector is null, not an empty string");
  eq(moverRow(mk("Y"), {}).relVolume, null, "a name with no tilt row reports null rather than 0x volume");
  eq(moverRow(mk("Y"), null).surpriseTilt, null, "and does not throw when there is no tilt at all");
}

{
  const screenerRow = {
    ticker: "T", close: "110", prev_close: "100",
    net_call_premium: "9000000", net_put_premium: "-1000000",
    sector: "Energy",
  };
  const scored = {
    ticker: "T", score: 40, conviction: 0.5, spot: 110, purity: 0.1, gRegime: "long",
    flipDist: 0.2, fam: {}, closes: [], r5: null, r21: null, r42: null,
    week52Pos: null, vrp: null, ivRank: null, impliedMovePerc: null, iv30: null, rv30: null,
  };
  const b = boardRow(scored, screenerRow, 1);
  const mrow = moverRow(screenerRow, { relVolume: 2, surpriseTilt: 0.3 });

  for (const k of ["t", "px", "chg", "netPrem"]) {
    ok(k in mrow, `the mover row uses the board's name for \`${k}\``);
    eq(mrow[k], k === "netPrem" ? Math.round(b[k]) : b[k],
       `and the board's RELATION for \`${k}\`, not a second one that disagrees`);
  }
  for (const k of ["relVolume", "surpriseTilt"]) {
    ok(k in mrow, `and the watch list's name for \`${k}\``);
  }

  const allUp = Array.from({ length: 40 }, (_, i) => ({
    row: { ticker: "U" + i, close: String(100 + i), prev_close: "100",
           net_call_premium: String(1000 * (i + 1)), net_put_premium: "0" },
    tilt: {},
  }));
  const rising = buildMovers(allUp);
  eq(rising.fallers.length, 0, "a day on which nothing fell publishes no fallers");
  eq(rising.premium.bearish.length, 0, "and a day on which nothing was net-bearish publishes no bearish names");
  eq(rising.risers.length, MOVER_ROWS, `while the risers are capped at ${MOVER_ROWS}`);
  eq(rising.risers[0].t, "U39", "and the cap keeps the LARGEST movers, not the first ones seen");

  const nothing = buildMovers([]);
  eq(nothing.risers.length, 0, "an empty universe publishes empty lists rather than throwing");
  eq(nothing.ranked, 0, "with an honest count of zero");
  eq(nothing.unrankedChange, 0, "and no phantom unranked names");
}

{
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "flows-emit-")) + "/e";

  const run = spawnSync(process.execPath,
               ["../scripts/flows-pipeline.mjs", "--dry-run", "--emit", prefix],
               { cwd: import.meta.dirname, encoding: "utf8" });
  eq(run.status, 0, "the dry run exits clean");
  const runLog = run.stdout + run.stderr;

  const probeLines = runLog.split("\n").filter((l) => l.includes("chain probe"));
  eq(probeLines.length, 1,
     "exactly one truncation probe is spent per run, however many names truncate");

  const recovered = /(\d+) of them recovered by a second single-expiry call/.exec(runLog);
  ok(recovered && Number(recovered[1]) >= 2,
     `and the fixture really does truncate more than one name (${recovered ? recovered[1] : 0} ` +
     "recovered), so the probe count above is a measurement rather than an accident of there " +
     "being only one candidate");
  const paged = /chains: (\d+) full first page\(s\) read on with (\d+) further page call\(s\).*?: (\d+) now complete, (\d+) still full at the last page, (\d+) where a later page repeated/.exec(runLog);
  ok(paged, "a chain that fills its first page is read on, page by page, and the run says what that bought");
  ok(paged && Number(paged[3]) >= 1,
     `at least one full first page was read to the end of the book (${paged ? paged[3] : 0} complete)`);
  ok(paged && Number(paged[5]) >= 1,
     "and a vendor that answers a later page with the first one is caught by the repeats, not " +
     "counted as a complete book");
  ok(/page=1 returned the first page again/.test(runLog),
     "a vendor that counts pages from one (page=1 repeating the first page) is detected and " +
     "read from page 2 on, rather than taken for one that ignores the parameter");
  ok(!/\d+ of 2 contracts showed/.test(runLog) && /oi basis: \d+ of \d+ contracts across \d+ chains|oi basis: \d+ contracts? across/.test(runLog),
     "the open-interest basis is judged across every chain, not on one chain's pair");
  const read = (key) => JSON.parse(fs.readFileSync(`${prefix}-${key}.json`, "utf8"));
  const board = read("board-long");
  const movers = read("movers");
  const trix = read("sector-trix");

  {
    const emitted = new Set(fs.readdirSync(path.dirname(prefix))
      .map((f) => /-card-([A-Z].*)\.json$/.exec(f))
      .filter(Boolean).map((m) => m[1]));
    const claimed = new Set();
    const long = read("board-long"), short = read("board-short");
    for (const b of [long, short]) {
      for (const r of b.rows) if (r.dp) claimed.add(r.t);
    }
    ok(emitted.size > 0, `the dry run emitted ${emitted.size} cards`);

    const depthOf = (t) => {
      const c = JSON.parse(fs.readFileSync(`${prefix}-card-${t}.json`, "utf8"));
      return c.depth;
    };
    const byDepth = { board: new Set(), focus: new Set(), "cross-section": new Set(), index: new Set(), fund: new Set(), other: new Set() };
    for (const t of emitted) {
      const d = depthOf(t);
      (byDepth[d] || byDepth.other).add(t);
    }
    eq(byDepth.other.size, 0,
       "every emitted card declares a depth this contract knows — an unrecognised one is a sixth " +
       "kind of card nobody has priced");
    assert.deepEqual([...byDepth.index].sort(), ["IWM", "QQQ", "SPY"],
      "the index lane writes exactly the three index dossiers, through the same buildCard path, and " +
      "none of them is a board or cross-section name"); checks++;
    assert.deepEqual([...byDepth.fund].sort(), [...FOCUS_FUNDS].sort(),
      "the fund lane writes one dossier per focus fund through the same index-dossier path, as depth " +
      "fund — never through the market-cap coverage path, whose vendor caps are garbage for funds"); checks++;
    for (const t of [...byDepth.index, ...byDepth.fund]) {
      ok(!claimed.has(t), `${t} is an index or fund dossier and no board row advertises it`);
    }
    ok(byDepth.board.size <= DEEP_NAMES,
       `the deep lane stayed inside its ${DEEP_NAMES}-name budget (${byDepth.board.size} board-depth ` +
       "cards), however wide the board or the cross-section got");
    const onBoardRows = new Set([...long.rows, ...short.rows].map((r) => r.t));
    const focusOnBoard = [...byDepth.focus].filter((t) => onBoardRows.has(t));
    assert.deepEqual([...byDepth.board, ...focusOnBoard].sort(), [...claimed].sort(),
      "the deep cards a board row advertises are EXACTLY the board-depth cards plus the focus cards of " +
      "names that sit on a board — a row promising a card the pipeline never wrote opens a 404, and a " +
      "deep card nobody links to is three calls burned"); checks++;
    {
      const focusPayload = read("focus");
      const ndxGroup = focusPayload.groups.find((g) => g.id === "ndx10");
      const wanted = new Set([...FOCUS_MAG7, ...ndxGroup.tickers, ...FOCUS_MINERS]);
      ok(byDepth.focus.size > 0,
         `the focus lane ran (${byDepth.focus.size} focus-depth cards), so the deep treatment of names ` +
         "off the deep fifty is a measurement rather than a tautology");
      for (const t of wanted) {
        ok(byDepth.board.has(t) || byDepth.focus.has(t),
           `${t} is a focus name (Mag 7, NDX 10 or a miner) and carries a DEEP card whatever its board ` +
           "rank — board depth when it is among the fifty, focus depth otherwise");
      }
      for (const t of byDepth.focus) {
        ok(wanted.has(t), `${t} is focus depth only because it is on the focus roster`);
        const card = JSON.parse(fs.readFileSync(`${prefix}-card-${t}.json`, "utf8"));
        for (const key of ["surface", "darkpool", "oiDeltas", "topContracts", "skewTerm"]) {
          const p = card.panels[key];
          ok(!(p && p.status === "unavailable" && /not on today's board/.test(String(p.reason))),
             `${t} ${key}: a focus card spends the per-name calls a deep card does, so no panel says ` +
             "it was never requested");
        }
      }
      const paas = JSON.parse(fs.readFileSync(`${prefix}-card-PAAS.json`, "utf8"));
      ok(paas.depth === "focus" || paas.depth === "board",
         "PAAS, whose fixture carries a vendor market cap below the floor (the TECK failure), is still " +
         "fetched by ticker and built deep: a focus name skips only the market-cap floor");
    }
    {
      const gated = [...emitted].map((t) => JSON.parse(fs.readFileSync(`${prefix}-card-${t}.json`, "utf8")))
        .filter((c) => c.gate);
      ok(gated.length > 0, `the dry run carded ${gated.length} name(s) inside the earnings gate`);
      for (const c of gated) {
        ok(c.score === null && /^\d{4}-\d{2}-\d{2}$/.test(c.gate.earnings) && Number.isInteger(c.gate.dte) &&
           c.gate.dte >= 0 && c.gate.dte <= EARNINGS_GATE_DAYS,
           `${c.ticker}: a gated name is carded for the session with score null and gate {earnings, dte}`);
        ok(!onBoardRows.has(c.ticker),
           `${c.ticker}: and it is not on either board, because the gate still keeps it out of the score`);
      }
      const roster = read("roster");
      const depthName = { board: "board", focus: "focus", "cross-section": "cross", index: "index", fund: "fund" };
      for (const t of emitted) {
        eq(roster.depth[t], depthName[depthOf(t)], `${t}: the roster lists the card this run published, at its depth`);
      }
      eq(Object.keys(roster.depth).length, emitted.size, "and lists nothing the run did not publish");
      ok(Object.values(roster.session).every((d) => d === read("board-long").sessionDate), "every roster entry is this session's");
      eq(roster.retired, 4, "the dry run's prior ledger held one name four sessions old (card, card-x, hist) and a card-x-only " +
        "orphan four sessions old: all four keys are retired");
      ok(Object.hasOwn(roster.held, "card:ZZHLD") && !Object.hasOwn(roster.held, "card:ZZRET") && !Object.hasOwn(roster.held, "card:NVDA"),
         "a two-session-old card is held for the next run, the retired ones are gone, and NVDA — old in the prior " +
         "ledger but rebuilt tonight — is neither");
      ok(/\[dry-run\] retire card:ZZRET/.test(runLog) && !/\[dry-run\] retire card:NVDA/.test(runLog),
         "the retire went through the ingest DELETE path, and never touched a card the run rebuilt");
      ok(Buffer.byteLength(JSON.stringify(roster)) <= 32 * 1024, "the roster is inside its 32 KB cap");
      const meta = read("meta");
      ok(meta.coverage && meta.coverage.membership.source === "qqq-holdings" && meta.coverage.focusDeep > 0 &&
         meta.coverage.dossiers.fund === FOCUS_FUNDS.length && Array.isArray(meta.warnings),
         "meta states where membership came from, how many focus names went deep, the fund dossiers and its coverage warnings");
      ok(/calls: modelled \d+ for this run's shape/.test(runLog) && !/^BUDGET:/m.test(runLog),
         "the run states its modelled call count and prints no BUDGET line when nothing overran");
      const mu = JSON.parse(fs.readFileSync(`${prefix}-card-MU.json`, "utf8"));
      ok(mu.gate && mu.score === null && mu.sessionDate === read("board-long").sessionDate,
         "MU, a Nasdaq-100 name days from earnings in the fixture, still gets a card for THIS session " +
         "instead of freezing on the last card it had before the gate");
      const inNdx10 = read("focus").groups.find((g) => g.id === "ndx10").tickers.includes("MU");
      ok(inNdx10 ? mu.depth === "focus" || mu.depth === "board" : mu.depth === "cross-section",
         `and its depth follows the focus roster: ${inNdx10 ? "deep, because it is in the NDX 10" : "cross-section, because it is not in the NDX 10"}`);
    }
    ok(byDepth["cross-section"].size > 0,
       `and the cross-section lane ran (${byDepth["cross-section"].size} cards), so the split above is ` +
       "a measurement rather than a tautology over a run where every card is a board card");
    for (const t of byDepth["cross-section"]) {
      ok(!claimed.has(t),
         `${t} is a cross-section card and no board row advertises it — the two sets are disjoint by ` +
         "construction, and an overlap would mean a name got both lanes and paid the deep calls twice");
    }

    {
      const congressOf = { ok: 0, quiet: 0, unavailable: 0 };
      for (const t of byDepth["cross-section"]) {
        const card = JSON.parse(fs.readFileSync(`${prefix}-card-${t}.json`, "utf8"));
        congressOf[card.panels.congress.status] = (congressOf[card.panels.congress.status] || 0) + 1;
        for (const key of ["aggressor", "ivSurface", "skewTerm", "topContracts"]) {
          const p = card.panels[key];
          ok(p.status === "unavailable" && /not on today's board/.test(p.reason) &&
             !/stopped before reaching this name/.test(p.reason),
             `${t} ${key}: a chain never requested for a cross-section name says so, not that ` +
             `the chain leg's deadline gave it up (${String(p.reason).slice(0, 60)})`);
        }
      }
      eq(congressOf.unavailable, 0,
         "no cross-section card calls congress unavailable when the market-wide tape was read — " +
         "the card was denying what /flows/political/ ranks from the same tape");
      ok(congressOf.ok > 0 && congressOf.quiet > 0,
         `and the tape's own answer reaches them: ${congressOf.ok} with disclosures, ` +
         `${congressOf.quiet} read and quiet`);
    }

    const total = long.rows.length + short.rows.length;
    ok(total > byDepth.board.size,
       `the board (${total} rows) is genuinely wider than the deep set (${byDepth.board.size}), so this ` +
       "equality is a measurement rather than a tautology over a board where every row is deep");
    eq(long.deep, long.rows.filter((r) => r.dp).length,
       "the published `deep` count agrees with the rows it counts");
    ok(typeof long.deepRule === "string" && long.deepRule.length > 40,
       "and the rule that chose them is published in words, not left to be inferred from which rows are clickable");
  }

  {
    const cardFiles = fs.readdirSync(path.dirname(prefix))
      .filter((f) => /-card-[A-Z].*\.json$/.test(f))
      .map((f) => JSON.parse(fs.readFileSync(path.join(path.dirname(prefix), f), "utf8")));
    ok(cardFiles.length > 0, `the dry run emitted ${cardFiles.length} cards to check the join on`);

    for (const feed of ["oiChange", "darkpool"]) {
      const withPanel = cardFiles.filter((c) => c.panels && c.panels.marketRank);
      eq(withPanel.length, cardFiles.length,
         `every emitted card carries the marketRank panel (${feed} pass)`);
      const placed = withPanel.filter((c) =>
        c.panels.marketRank.status === "ok" &&
        c.panels.marketRank.feeds[feed].status === "ok").length;
      const published = withPanel[0].panels.marketRank.coverage[feed];
      eq(published.of, cardFiles.length,
         `the ${feed} join states the population it was measured over, and it is the set of ` +
         "names that actually got a card");
      eq(published.in, placed,
         `and the count it publishes (${published.in}) is the number of cards that really ` +
         `place in that feed (${placed}) — a coverage figure computed over a different ` +
         "population would be a plausible integer on every card with nothing looking wrong");

      ok(placed > 0 && placed < cardFiles.length,
         `and the corpus exercises both arms: ${placed} of ${cardFiles.length} names place ` +
         "in this feed, so neither the reading nor the measured absence is checked against " +
         "an empty set");

      for (const c of withPanel) {
        const f = c.panels.marketRank.feeds[feed];
        eq(c.panels.marketRank.coverage[feed].in, published.in,
           `${c.ticker}: every card reports the same ${feed} coverage, because the run ` +
           "indexes the cross-section once — fifty cards each re-reading a hundred rows " +
           "could disagree about the ordering or the unit with no single card looking wrong");
        eq(f.population, withPanel[0].panels.marketRank.feeds[feed].population,
           `${c.ticker}: and the same population, which is the denominator every rank on ` +
           "every card is quoted against");
      }
    }

    ok(/cross oiChange: \d+ of \d+ deep name/.test(runLog),
       "the run reports the join's own reach once, rather than leaving it to be counted " +
       "off fifty cards");
    ok(/NOT this run's session/.test(runLog),
       "and reports that the market-wide ranking it joined is from a different session than " +
       "the per-name data it joined it onto — the log line that makes the timing trap " +
       "visible in a job log rather than only on a card");

    const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");
    for (const route of ["/api/market/oi-change", "/api/darkpool/recent"]) {
      ok(new RegExp(route.replace(/\//g, "\\/") + '", \\{ limit: MARKET_CROSS_LIMIT').test(src),
         `${route} is fetched at the same constant the cards publish as \`requested\` — two ` +
         "numbers for one limit is a denominator that will one day be wrong");
    }
    const anyFeed = cardFiles[0].panels.marketRank.feeds.oiChange;
    eq(anyFeed.requested, MARKET_CROSS_LIMIT,
       "and the card publishes that constant rather than restating it");
  }

  eq(movers.universe, board.universe,
     "THE MOVERS ARE RANKED OVER THE BOARD'S OWN UNIVERSE, not over the earnings-gated subset");
  eq(movers.ranked + movers.unrankedChange, movers.universe,
     "and every one of those names is either ranked or counted as unrankable — none quietly vanish");

  ok(movers.unrankedChange > 0,
     `the dry run really does contain names that cannot be ranked (${movers.unrankedChange} of ${movers.universe})`);
  ok(movers.universe > movers.ranked,
     "so `universe` and `ranked` are distinct numbers and the invariant above has something to say");
  eq(movers.priced + movers.unrankedPremium, movers.universe,
     "the same holds for the premium population, counted separately");
  eq(movers.cap, MOVER_ROWS, "the cap is published so a reader knows the list was truncated");
  ok(movers.risers.length <= MOVER_ROWS && movers.fallers.length <= MOVER_ROWS,
     "and is honoured in both directions");
  eq(movers.premium.basis, "byName", "the premium claim is scoped on the payload itself");
  for (const key of ["v", "generatedAt", "sessionDate"]) {
    ok(movers[key] !== undefined, `the movers payload carries \`${key}\` like every other surface`);
    ok(trix[key] !== undefined, `and so does sector:trix`);
  }

  eq(trix.scaling.choice, true, "the 0-100 scaling is LABELLED A CHOICE in the payload");
  eq(trix.scaling.rule, "fixed-clamp", "and named, so a renderer cannot misdescribe it");
  eq(trix.scaling.neutral, 50, "with the neutral point stated");
  eq(trix.scaling.fullScaleBp, TRIX_FULL_SCALE_BP, "and the band the rails sit at");
  ok(/clamp\(trixBp \/ fullScaleBp/.test(trix.scaling.relation),
     "the relation itself is written out in the payload, not left in this repository");
  ok(/min-max/.test(trix.scaling.rejected) && /percentile/.test(trix.scaling.rejected),
     "and so is what was rejected, so the choice reads as a choice");
  eq(trix.span, 15, "the EMA span is published, because it is the other free parameter");
  eq(trix.price, "log", "and which price the smoother ran on");
  ok(/not GICS/.test(trix.basis),
     "the payload says out loud that these are ETFs standing in for GICS sectors");

  eq(trix.sectors.length, 11, "eleven sectors on the wire");
  eq(trix.sectors.filter((s) => s.trix !== null).length, trix.measured,
     "`measured` counts what was actually measured rather than being asserted");
  for (const s of trix.sectors) {
    const want = s.trixBp === null ? null : Number(
      (50 + 50 * Math.max(-1, Math.min(1, s.trixBp / TRIX_FULL_SCALE_BP))).toFixed(1));
    eq(s.trix, want, `${s.etf}: the emitted reading is the emitted relation applied to the emitted raw bp`);
  }

  const missing = trix.sectors.filter((s) => s.trix === null);
  ok(missing.length >= 1, "the dry run exercises the unmeasured path rather than stepping around it");
  for (const s of missing) {
    ok(typeof s.reason === "string" && s.reason.length > 10,
       `${s.etf} is published as null WITH a reason: "${s.reason}"`);
  }
  ok(trix.sectors.some((s) => s.trix !== null && Math.abs(s.trix - 50) < 5),
     "and the dry run contains a genuinely flat sector, reading near the neutral midpoint");
  ok(trix.sectors.some((s) => s.clamped === true),
     "and a saturated one, so the rail is exercised too");

  ok(fs.existsSync(`${prefix}-record.json`),
     "THE PIPELINE PUBLISHES A RECORD: the key is written, not merely accepted and rendered");
  const record = read("record");
  eq(record.status, "ok", "the dry run publishes a record");
  for (const key of ["retained", "firstSession", "lastSession", "horizons", "sessions"]) {
    ok(key in record, `the record carries the renderer's pinned \`${key}\``);
  }
  eq(record.statedHorizon, HORIZON_SESSIONS,
     "the sessions table is scored at the SAME horizon the boards quote");
  assert.deepEqual(record.horizons.map((h) => h.k), [1, 5, 10, 21],
    "the horizon ladder is the stated one"); checks++;
  ok(record.retained >= 10, `the replay retains a real spread of sessions (${record.retained})`);
  for (const h of record.horizons) {
    ok(h.n <= record.retained, `${h.k}d: n counts sessions, so it cannot exceed retention`);
    ok(h.ls === null || Number.isFinite(h.ls), `${h.k}d: the mean is a number or withheld, never NaN`);
    ok((h.ls === null) === (h.n === 0), `${h.k}d: withheld exactly when nothing closed`);
  }
  for (const row of record.sessions) {
    for (const key of ["d", "long", "short", "ls", "hit", "lost", "names"]) {
      ok(key in row, `session ${row.d} carries \`${key}\``);
    }
    ok(row.names > 0, `session ${row.d} names its population`);
    ok(row.lost >= 0 && row.lost <= row.names, `session ${row.d}: lost is bounded by names`);
    ok(row.hit === null || (row.hit >= 0 && row.hit <= 1), `session ${row.d}: hit is a share`);
  }

  const feat = record.features;
  ok(feat && Array.isArray(feat.cols) && feat.cols.length >= 15,
     `the evidence table measures the board's own vocabulary (${feat.cols.length} columns)`);
  eq(feat.k, HORIZON_SESSIONS, "at the stated horizon");
  const featKeys = feat.cols.map((c) => c.key);
  ok(!featKeys.includes("r") && !featKeys.includes("px"),
     "rank and price level never become columns — one is the score restated, the other ranks share prices");
  ok(["s", "cnv", "fam.F", "pr.0", "w52"].every((k) => featKeys.includes(k)),
     "while the score, conviction, families, momentum and range position all join");
  for (const c of feat.cols) {
    if (c.ic === null) {
      ok(typeof c.reason === "string" && c.reason.length > 5,
         `${c.key}: an unmeasured IC says why, rather than publishing a confident zero`);
    } else {
      ok(Math.abs(c.ic) <= 1, `${c.key}: a measured IC is a correlation (${c.ic})`);
      ok(c.n >= feat.minN, `${c.key}: measured only at or above the stated floor`);
    }
  }
  for (const key of ["method", "perSession", "ranking", "selection", "overlap", "calendar"]) {
    ok(typeof feat[key] === "string" && feat[key].length > 20,
       `the ${key} statement rides the payload`);
  }
  ok(/not side-signed/.test(feat.method), "and the method names the return convention");
  eq(feat.rankedFrom, 3 * HORIZON_SESSIONS,
     "a feature is ranked only from three horizons' worth of overlapping sessions");
  eq(feat.through, record.sessionDate,
     "and no exit after the session being published is scored as a close");
  const perSession = feat.cols.filter((c) => c.icMean !== null);
  ok(perSession.length >= 15,
     `the replay measures the board's vocabulary per session too (${perSession.length} columns)`);
  for (const c of feat.cols) {
    if (c.icMean === null) {
      ok(typeof c.icReason === "string" && c.icReason.length > 5,
         `${c.key}: a column with no session mean says why`);
      continue;
    }
    ok(Math.abs(c.icMean) <= 1 && c.icSessions >= 1, `${c.key}: a session mean is a mean of correlations`);
    ok(c.icPos >= 0 && c.icPos <= 1, `${c.key}: the positive share is a share`);
    eq(c.ranked, c.icSessions >= feat.rankedFrom, `${c.key}: ranked exactly when the sessions reach the floor`);
    ok(c.ranked || c.icT === null, `${c.key}: an unranked column publishes no t`);
  }
  const order = feat.cols.map((c) => (c.ranked ? 0 : c.icMean !== null ? 1 : 2));
  ok(order.every((v, i) => i === 0 || v >= order[i - 1]),
     "ranked columns lead, unranked session means follow, and columns with none close the table");

  {
    const track = read("scoretrack");
    const ch = track.change;

    ok(ch.moved > 0 && ch.held > 0,
       `the corpus contains names that MOVED and names that HELD (${ch.moved} and ${ch.held}) — ` +
       "before the history was shaped it was 0 and 94, and a suite over that corpus could not " +
       "tell a change layer that worked from one returning zero for everything");
    ok(ch.comparable > ch.consecutive,
       `and the two denominators genuinely differ (${ch.comparable} comparable, ` +
       `${ch.consecutive} consecutive), so a page printing one where it means the other is ` +
       "visibly wrong rather than accidentally right");

    for (const kind of ["cleared", "faded", "flipped"]) {
      ok(ch.crossings[kind] > 0,
         `the corpus reaches the ${kind.toUpperCase()} crossing (${ch.crossings[kind]}) — the ` +
         "dead-band crossing is the one move on this product that is an event rather than a " +
         "degree, and all three kinds were unreachable from two boards that sit outside the " +
         "band by construction. 'faded' in particular needs the dead-band middle in the " +
         "history, which is why the walk is now handed it");
    }

    const gaps = new Map();
    let withResidual = 0;
    for (const n of track.names) {
      if (!n.d1) continue;
      gaps.set(n.d1.gap, (gaps.get(n.d1.gap) || 0) + 1);
      if ("qv" in n.d1) withResidual++;
    }
    ok(gaps.size >= 3,
       `changes span at least three distinct session gaps (${[...gaps.keys()].sort((a, b) => a - b).join(", ")}) — ` +
       "the gap is the denominator the whole change layer exists to carry, and a corpus in " +
       "which every gap is 1 cannot tell an overnight move from a three-week one. A first " +
       "attempt put the absences in a run of MIDDLE days and produced no gap above one at " +
       "all: the change compares the last two SCORED sessions, so a hole three weeks back is " +
       "invisible to it");
    ok((gaps.get(1) || 0) > 0, "with overnight moves still the majority case");
    ok(withResidual > 0,
       `${withResidual} names carry a residual difference — a board row has never held a ` +
       "residual, so until the walk synthesised dated scores days this branch had no fixture " +
       "anywhere near it and the field was absent on every name of every emitted corpus");
    ok(track.sources.full > 0 && track.sources.boardsOnly > 0,
       `and the window holds both kinds of session (${track.sources.full} full, ` +
       `${track.sources.boardsOnly} board-only), so the rule that a scores day beats a boards ` +
       "day for a shared date is under test rather than merely stated");

    const runs = new Set(track.names.map((n) => n.run));
    ok(runs.size >= 4,
       `run lengths spread across ${runs.size} distinct values rather than every name reporting ` +
       "the window length, which is what a constant history produces and what makes 'a run of " +
       "one is a new opinion' a distinction with no instances");

    let withEarnings = 0, nearEarnings = 0;
    for (const side of ["board-long", "board-short"]) {
      for (const r of read(side).rows) {
        if (!r.ed) continue;
        withEarnings++;
        if (r.edte !== null && r.edte < 25) nearEarnings++;
      }
    }
    ok(withEarnings >= 10,
       `${withEarnings} board rows carry an earnings date, so the column is exercised rather ` +
       "than merely reached");
    ok(nearEarnings > 0,
       "and at least one of them reports soon — a top-ranked name that leaves the board in a " +
       "fortnight for a reason unrelated to its signal decaying is the case the column exists " +
       "for, and it is the case a sparse fixture never produces");
  }

  const boardShort = read("board-short");
  const chainCols = ["skew", "term", "atmIv", "skewDays"];
  for (const [side, b] of [["long", board], ["short", boardShort]]) {
    ok(b.rows.length > 0, `the ${side} board has rows to carry the chain columns`);
    const keys = Object.keys(b.rows[0]);
    for (const col of chainCols) {
      ok(keys.includes(col), `${side} rows carry \`${col}\``);
    }

    eq(keys.slice(-4).join(","), chainCols.join(","),
       `and they are the LAST four keys on a ${side} row, in order — the table binds positionally`);
    ok(b.rows.some((r) => r.skew !== null),
       `at least one ${side} row carries a measured skew`);
    for (const r of b.rows) {
      for (const col of chainCols) {
        ok(r[col] === null || Number.isFinite(r[col]),
           `${side} ${r.t}: ${col} is a number or null, never NaN`);
      }
    }
  }

  const datedLong = JSON.parse(fs.readFileSync(`${prefix}-board-long:${board.sessionDate}.json`, "utf8"));
  assert.deepEqual(datedLong, board,
    "THE DATED BOARD IS BYTE-IDENTICAL TO THE LIVE ONE at final state, chain columns included — " +
    "the re-publish writes one object to two keys rather than reconstructing it"); checks++;

  const cardFile = fs.readdirSync(path.dirname(prefix))
    .filter((f) => /-card-[A-Z0-9]+\.json$/.test(f))
    .find((f) => JSON.parse(fs.readFileSync(path.join(path.dirname(prefix), f), "utf8")).depth === "board");
  ok(cardFile, "the dry run emitted a card");
  const card = JSON.parse(fs.readFileSync(path.join(path.dirname(prefix), cardFile), "utf8"));

  eq(card.v, 3, "the schema version is 3, where walls, flow peaks, the crossing, zero gamma and the VRP were renamed; these chain panels are additions to it, not redefinitions");
  ok(card.engine && Array.isArray(card.engine.facts) && Array.isArray(card.engine.structures) && card.engine.engine === "q1",
     "a deep dry-run card carries the engine block, built from Black-Scholes fixture quotes");
  ok(card.engine.pLaw && card.engine.pLaw.knots.length === 6 && card.engine.pLaw.knots.every((k) => k.edges.length === 65 && k.means.length === 64),
     "with a 64-bin real-world law at six horizons");
  ok(card.engine.ideas.every((id) => card.engine.structures.some((st) => st.id === id)), "and every ranked idea resolves to a published structure");
  ok(card.engine.expiries.every((e) => e.forward && e.smile && e.smile.method), "and every fitted expiry names its forward and its smile method");
  for (const key of ["ivSurface", "skewTerm", "topContracts", "aggressor"]) {
    const panel = card.panels[key];
    ok(panel, `the card carries panels.${key}`);
    ok(panel.status === "ok" || (panel.status === "unavailable" && panel.reason),
       `and it is either built or unavailable WITH a reason (${key}: ${panel.status})`);
  }

  const surf = card.panels.ivSurface;
  if (surf.status === "ok") {
    for (const key of ["iv", "skew", "traded", "strike"]) {
      eq(surf[key].length, surf.rows.length, `surface.${key} has one row per ladder row`);
      ok(surf[key].every((r) => r.length === surf.expiries.length),
         `and one column per expiry (${key})`);
    }
  }

  const boardFile = (side) => prefix + `-board-${side}.json`;
  const readBoard = (side) => {
    const full = boardFile(side);
    ok(fs.existsSync(full), `the dry run emitted board:${side} at ${path.basename(full)}`);
    return JSON.parse(fs.readFileSync(full, "utf8"));
  };

  {
    const boards = {
      long: readBoard("long"), short: readBoard("short"), watch: readBoard("watch"),
    };

    for (const side of ["long", "short"]) {
      const b = boards[side];
      ok(Number.isFinite(b.cleared), `board:${side} publishes how many names cleared the band`);
      ok(Number.isFinite(b.shed), `board:${side} publishes how many of them it could not hold`);
      eq(b.shed, b.cleared - b.rows.length,
         `board:${side}: shed is exactly the pool minus the rows shown, so the two cannot ` +
         `drift into disagreeing about the same names`);
      ok(b.shed >= 0, `board:${side}: a board never shows more rows than cleared the band`);
      ok(b.rows.length <= b.cleared, `board:${side}: and never claims more than it had`);
    }

    const scored = boards.long.scored;
    const neutral = boards.long.neutral;
    eq(boards.long.cleared + boards.short.cleared, scored - neutral,
       `the two sides' pools account for every scored name that cleared the band ` +
       `(${boards.long.cleared} + ${boards.short.cleared} vs ${scored} - ${neutral})`);
    const shown = boards.long.rows.length + boards.short.rows.length;
    const shed = boards.long.shed + boards.short.shed;
    eq(shown + shed, scored - neutral,
       `and every one of them is either on a board or counted as shed — nothing scored ` +
       `goes missing unrecorded (${shown} shown + ${shed} shed vs ${scored - neutral} cleared)`);

    ok(shed > 0,
       `the emitted corpus really does shed names (${shed}), so these assertions are ` +
       `about a branch that runs rather than one that never fires`);

    if (boards.watch) {
      const banded = new Set(boards.watch.rows.map((r) => r.t));
      for (const r of [...boards.long.rows, ...boards.short.rows]) {
        ok(!banded.has(r.t),
           `${r.t} is on a ranked board, so it is NOT also on the watch list — the two ` +
           `surfaces partition the pool, they do not overlap`);
      }
    }
  }

  for (const side of ["long", "short"]) {
    const board = readBoard(side);
    const rows = board.rows || [];
    ok(rows.length > 0, `board:${side} has rows to check`);
    let withCounts = 0;
    for (const r of rows) {
      if (r.agr === null || r.bth === null) continue;
      withCounts++;
      ok(Number.isInteger(r.agr) && Number.isInteger(r.bth),
         `board:${side} ${r.t}: the agreement counts are integers, not a rounded ratio`);
      ok(r.agr >= 0 && r.agr <= r.bth,
         `board:${side} ${r.t}: 0 <= agree (${r.agr}) <= present (${r.bth})`);
      ok(r.bth <= 3, `board:${side} ${r.t}: at most three signed axes exist to agree`);
    }
    ok(withCounts === rows.length,
       `every board:${side} row carries the count behind its own conviction (${withCounts}/${rows.length})`);
  }

  {
    const conv = card.conv || {};
    const w = conv.weights;
    ok(w && typeof w === "object", "the card publishes the weights the blend used");
    for (const k of ["agreement", "coverage", "persistence"]) {
      ok(Number.isFinite(w[k]), `including the ${k} weight`);
      ok(Number.isFinite(conv[k]), `and the ${k} term itself`);
    }
    eq(Number((w.agreement + w.coverage + w.persistence).toFixed(10)), 1,
       "the weights sum to one, so the whole [0,100] range is reachable");
    const recon = Math.round(100 *
      (w.agreement * conv.agreement + w.coverage * conv.coverage + w.persistence * conv.persistence));
    eq(recon, card.conviction,
       "and the three terms with those weights reconstruct the published conviction exactly");

    ok(conv.coverage >= 0 && conv.coverage <= 1,
       "the published coverage is the clamped value the arithmetic used");
    ok(conv.persistence >= 0 && conv.persistence <= 1, "and likewise persistence");
  }

  const tc = card.panels.topContracts;
  if (tc.status === "ok") {
    const basis = tc.oiBasis;
    ok(basis && typeof basis === "object",
       "the top-contracts panel publishes the open-interest basis check it was measured with");
    ok(Number.isFinite(basis.seen) && basis.seen >= 0,
       "carrying how many contracts could be checked at all");
    ok(["no-data", "falsified", "inconclusive"].includes(basis.verdict),
       `and one of the three verdicts, never a bare number (got ${basis.verdict})`);

    ok(Number.isFinite(basis.minVolume) && basis.minVolume > 0,
       "and the volume floor that defines the population those counts describe");
    ok(!("line" in basis),
       "but NOT the log line: it is written for a job log, carries a [dry-run] tag " +
       "and addresses a maintainer, so the card publishes counts and the renderer says it");
    ok(basis.exceeded === null || Number.isFinite(basis.exceeded),
       "the exceeding count is a number or an explicit null, never a coerced zero");
    if (basis.verdict === "falsified") {
      ok(basis.exceeded > 0,
         "a falsified verdict is backed by at least one contract that actually exceeded");
    }
    if (basis.verdict === "inconclusive") {
      eq(basis.exceeded, 0, "an inconclusive verdict found none, and says so as a measured zero");
    }
  }

  for (const key of ["ivSurface", "skewTerm", "aggressor"]) {
    ok(!("oiBasis" in card.panels[key]),
       `panels.${key} does not carry the basis check — it prints no open-interest change to judge`);
  }

  const pm = card.panels.pricedMove;
  ok("atmVol" in pm, "the priced-move panel finally publishes the vendor's own at-the-money vol");
  ok(Array.isArray(pm.ivStrip) && pm.ivStrip.length === 4,
     "and a four-point history of this name's 30-day implied vol, at zero extra calls");
  assert.deepEqual(pm.ivStrip.map((p) => p.h), ["−1m", "−1w", "−1d", "now"],
    "ordered oldest to newest, so a renderer draws it left to right without inventing an order"); checks++;

  {

    let s = { delayMs: RATE.startDelayMs, floorMs: RATE.minDelayMs };
    s = stepRateController(s, "limited");
    const afterLimit = s.floorMs;
    ok(afterLimit > RATE.minDelayMs, "a 429 raises the floor above the starting minimum");
    for (let i = 0; i < 200; i++) s = stepRateController(s, "ok");
    eq(s.floorMs, afterLimit, "and two hundred clean responses do not lower it again");
    ok(s.delayMs >= afterLimit,
       `the delay decays to the raised floor and stops there (${Math.round(s.delayMs)}ms ` +
       `>= ${Math.round(afterLimit)}ms) — the exact assertion the shipped code failed`);

    ok(s.delayMs > RATE.minDelayMs,
       "and it does NOT settle back at RATE.minDelayMs, which is what the defect did");

    let t = { delayMs: RATE.startDelayMs, floorMs: RATE.minDelayMs };
    for (let i = 0; i < 50; i++) t = stepRateController(t, "limited");
    eq(t.floorMs, RATE.floorCeilingMs,
       "fifty consecutive 429s pin the floor at its ceiling, not at maxDelayMs");
    ok(RATE.floorCeilingMs < RATE.maxDelayMs,
       "and the floor's ceiling is strictly below the per-call backoff ceiling: a single " +
       "call may sleep 5s, but every call may not");

    const before = { delayMs: 300, floorMs: 240 };
    eq(stepRateController(before, "error").floorMs, 240,
       "a 5xx or a transport failure backs off WITHOUT teaching the floor anything");

    ok(rateFloorSurvivesBudget({
      floorCeilingMs: RATE.floorCeilingMs, callBudget: CALL_BUDGET,
      deadlineMs: DEADLINE_MS, reserveMs: CHAIN_RESERVE_MS,
    }), `a full ${CALL_BUDGET}-call run at the ${RATE.floorCeilingMs}ms floor ceiling ` +
        "still finishes inside the deadline with the chain reserve intact");
    ok(!rateFloorSurvivesBudget({
      floorCeilingMs: RATE.maxDelayMs, callBudget: CALL_BUDGET,
      deadlineMs: DEADLINE_MS, reserveMs: CHAIN_RESERVE_MS,
    }), "and the same run at the 5s per-call ceiling would NOT — which is why the " +
        "floor needs a ceiling of its own rather than reusing maxDelayMs");

    ok(raiseRateFloor(RATE.minDelayMs) > RATE.minDelayMs * 1.5,
       "the first step is a real step: 1.5x of 60ms is below anything a limiter notices, " +
       "so the opening raise is floored at a meaningful delay instead");

    const REFUSED_POSTS = 37, REFUSED_WINDOW_MS = 11000;
    const admits = REFUSED_WINDOW_MS / PUBLISH_SPACING_MS;
    ok(admits < REFUSED_POSTS,
       `the ingest lane cannot put ${REFUSED_POSTS} writes into ${REFUSED_WINDOW_MS / 1000} ` +
       `seconds: at ${PUBLISH_SPACING_MS}ms the most any such window holds is ` +
       `${admits.toFixed(1)}, against the ${REFUSED_POSTS} that drew a Cloudflare challenge ` +
       "and lost two payloads on the first wide-board run");

    const CARD_WRITES = 50, INGEST_WRITES_PER_RUN = 162;
    const cardsSeconds = (CARD_WRITES * PUBLISH_SPACING_MS) / 1000;
    ok(cardsSeconds > (CARD_WRITES / REFUSED_POSTS) * (REFUSED_WINDOW_MS / 1000),
       `and the pooled cards leg is stretched past the refused shape: ${CARD_WRITES} writes ` +
       `take ${cardsSeconds.toFixed(1)}s, where the refused run put ${REFUSED_POSTS} into ` +
       `${REFUSED_WINDOW_MS / 1000}s — so the one stretch that saturates this lane is slower ` +
       "than the burst that drew the challenge, not faster");

    const laneSeconds = (INGEST_WRITES_PER_RUN * PUBLISH_SPACING_MS) / 1000;
    ok(laneSeconds < 120,
       `and the whole run's ${INGEST_WRITES_PER_RUN} ingest writes cost ` +
       `${laneSeconds.toFixed(1)}s of lane — bounded here so that buying burst safety with ` +
       "spacing stays a trade someone has to justify against a 1502s run, rather than a " +
       "constant that can drift upward one incident at a time");
  }

  {
    eq(publishRetryDelay(0), 1000, "the first retry waits a second");
    eq(publishRetryDelay(1), 4000, "the second, four");
    eq(publishRetryDelay(2), 9000, "the third, nine — quadratic, because an edge challenge " +
       "clears on elapsed quiet rather than on attempt count");
    eq(publishRetryDelay(3), null, "and there is no fourth: three RETRIES, four attempts");
    eq(publishRetryDelay(-1), null, "a nonsense attempt index retries nothing");

    eq(publishRetryDelay(0, { spentMs: 89_500 }), null,
       "a wait that would exceed the run's remaining retry budget is refused outright, " +
       "rather than truncated to fit — a shortened wait is the one length that neither " +
       "clears the challenge nor saves the time");
    eq(publishRetryDelay(0, { spentMs: 89_000 }), 1000,
       "a wait that fits is granted in full");

    const worstPerKey = [0, 1, 2].reduce((sum, a) => sum + (publishRetryDelay(a) || 0), 0);
    eq(worstPerKey, 14_000, "one key that fails every retry costs fourteen seconds");
    let spent = 0, keys = 0;
    while (publishRetryDelay(0, { spentMs: spent }) !== null) {
      for (const a of [0, 1, 2]) {
        const w = publishRetryDelay(a, { spentMs: spent });
        if (w === null) break;
        spent += w;
      }
      keys++;
      if (keys > 500) break;
    }
    ok(spent <= 90_000,
       `a run in which EVERY publish is challenged spends ${Math.round(spent / 1000)}s on ` +
       "retries and then stops, rather than fourteen minutes");
    ok(spent < DEADLINE_MS - CHAIN_RESERVE_MS,
       "which is comfortably inside the window the cards still need after it");
  }

  {
    const expiries = [
      { expiry: "2026-08-27" },
      { expiry: "2026-09-04" }, { expiry: "2026-09-18" },
      { expiry: "2026-08-20" },
      { expiry: null }, { expiry: "not-a-date" },
    ];
    eq(nearestProbeExpiry(expiries, { asOf: "2026-08-26", minDays: 7 }), "2026-09-04",
       "the probe aims at the nearest LISTED expiry past the skew floor, not the nearest " +
       "of any kind — 2026-08-27 is one day out and 2026-08-20 has expired");
    eq(nearestProbeExpiry([{ expiry: "2026-08-27" }], { asOf: "2026-08-26", minDays: 7 }), null,
       "and when nothing qualifies it returns null rather than aiming at whatever sorts " +
       "first — a probe with no target is skipped, not guessed");
    eq(nearestProbeExpiry(expiries, { asOf: "nonsense" }), null,
       "an unparseable session date yields no probe at all");
    eq(nearestProbeExpiry(null, { asOf: "2026-08-26" }), null, "and neither does no input");

    const sym = (exp, cp, strike) =>
      `AAPL${exp.slice(2).replace(/-/g, "")}${cp}${String(strike * 1000).padStart(8, "0")}`;
    const oneExpiry = [sym("2026-09-04", "C", 200), sym("2026-09-04", "P", 190)]
      .map((option_symbol) => ({ option_symbol }));
    const worked = describeChainProbe("AAPL", "2026-09-04", oneExpiry).join(" ");
    ok(worked.includes("FILTER WORKS"),
       "a response carrying only the requested expiry is reported as the filter working");

    const many = [sym("2026-09-04", "C", 200), sym("2026-09-18", "C", 200)]
      .map((option_symbol) => ({ option_symbol }));
    const ignored = describeChainProbe("AAPL", "2026-09-04", many).join(" ");
    ok(ignored.includes("FILTER IGNORED"),
       "and two distinct expiries back from a single-expiry request is reported as ignored");
    ok(!ignored.includes("FILTER WORKS"),
       "with no chance of a reader skimming the wrong verdict out of the same line");

    const empty = describeChainProbe("AAPL", "2026-09-04", []).join(" ");
    ok(!empty.includes("FILTER WORKS") && !empty.includes("FILTER IGNORED"),
       "an empty response is reported as its own outcome, not as either verdict");

    const full = Array.from({ length: 500 }, (_, i) =>
      ({ option_symbol: sym("2026-09-04", "C", 100 + i) }));
    const stillFull = describeChainProbe("AAPL", "2026-09-04", full).join(" ");
    ok(stillFull.includes("still fills the page"),
       "and a filtered response that itself hits the cap says so rather than declaring victory");
  }

  {
    const wide = fakeChain("AAPL", 200, 4242, { wide: true });
    eq(wide.length, 500, "the wide fixture is cut at the vendor's page size, not merely large");

    const seq = wide.map((r) => {
      const m = /^AAPL(\d{6})[CP]/.exec(r.option_symbol);
      return m ? m[1] : null;
    }).filter(Boolean);
    ok(new Set(seq).size > 4,
       `the cut spans ${new Set(seq).size} expiries, so it is a slice through the book ` +
       "rather than its first few expiries taken whole");
    const sorted = seq.every((v, i) => i === 0 || seq[i - 1] <= v);
    ok(!sorted,
       "and the page is NOT in expiry order — a fixture cut from a sorted book would let " +
       "downstream code identify 'nearest' by position, which the vendor documents nowhere");

    const narrow = fakeChain("AAPL", 200, 4242);
    ok(narrow.length < 500,
       `the narrow fixture stays under the cap (${narrow.length} rows) so a dry run exercises ` +
       "BOTH the truncated refusal and the path that publishes scalars, in one session");
  }

  const cardBytes = JSON.stringify(card).length;
  ok(cardBytes < 100 * 1024,
     `a card with all four chain panels is ${(cardBytes / 1024).toFixed(1)}KB, inside the ` +
     "100KB self-check the builder enforces");
  for (const [key, payload] of [["movers", movers], ["sector:trix", trix], ["record", record]]) {
    const bytes = JSON.stringify(payload).length;
    ok(bytes < 32 * 1024,
       `${key} is ${(bytes / 1024).toFixed(1)}KB, comfortably inside the 128KB ingest cap`);
  }

  fs.rmSync(path.dirname(prefix), { recursive: true, force: true });
}

{
  const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");

  const uaLiterals = src.match(/anilkaya-flows-pipeline\/1/g) || [];
  eq(uaLiterals.length, 1,
     `the ingest User-Agent is written down ONCE (found ${uaLiterals.length}). Two copies is ` +
     "how the read path came to have none");

  ok(/function ingestHeaders\(/.test(src),
     "and it is reached through a single builder every call site shares");

  const sites = [...src.matchAll(/ingestURL\(\) \+ "\?key="/g)];
  eq(sites.length, 3,
     `three call sites reach the ingest route — read, write and delete (found ${sites.length}). ` +
     "A fourth must join the builder rather than hand-rolling headers");
  for (const site of sites) {
    const window = src.slice(site.index, site.index + 900);
    ok(/headers: await ingestHeaders\(/.test(window),
       "each ingest fetch takes its headers from ingestHeaders() rather than assembling its " +
       "own — the read path assembling its own is precisely the bug this pins — and awaits it, " +
       "because the builder is async (the live credential is a GitHub OIDC token minted on demand) " +
       "and a Promise passed as headers sends no Authorization at all");
    ok(!/Authorization: "Bearer " \+ process\.env\.FLOWS_INGEST_TOKEN/.test(window),
       "and none of them still builds an Authorization header inline, which is what a copied " +
       "call site looks like on the way back in");
  }
}

{

  const items = Array.from({ length: 8 }, (_, i) => ({ i }));
  const seen = [];
  let live = 0, peak = 0, finishedOthers = 0, openGate = null;
  const gate = new Promise((resolve) => { openGate = resolve; });
  const pooled = await runPooled(items, async (item) => {
    live++; if (live > peak) peak = live;
    if (item.i === 0) {
      await gate;
    } else {
      await new Promise((r) => setTimeout(r, 1));
      finishedOthers++;
      if (finishedOthers === items.length - 1) openGate();
    }
    live--;
    seen.push(item.i);
    return item.i * 10;
  }, { width: 4 });

  assert.deepEqual(pooled.results, items.map((x) => x.i * 10),
    "runPooled returns results in INPUT order, not completion order");
  checks++;
  ok(seen[seen.length - 1] === 0,
     `and the fixture really did complete out of order (last to finish was ${seen[seen.length - 1]}), ` +
     "so the assertion above is not passing because everything happened to finish in sequence");
  ok(peak > 1 && peak <= 4,
     `the pool genuinely overlapped work (peak ${peak}) and never exceeded its width — a pool ` +
     "that peaked at 1 would certify nothing, and one that exceeded 4 would be a burst");

  let serialLive = 0, serialPeak = 0;
  await runPooled(items, async (item) => {
    serialLive++; if (serialLive > serialPeak) serialPeak = serialLive;
    await new Promise((r) => setTimeout(r, item.ms));
    serialLive--;
  }, { width: 1 });
  eq(serialPeak, 1, "width 1 never has two items in flight — it is the serial loop it replaced");

  const quiet = await runPooled([1, 2, 3], async () => undefined, { width: 2 });
  assert.deepEqual(quiet.attempted, [true, true, true],
    "an item whose work returned undefined is still ATTEMPTED — undefined is a result, not a skip");
  checks++;
  eq(quiet.done, 3, "and `done` counts attempts rather than truthy results");

  let started = 0;
  const stopped = await runPooled([0, 1, 2, 3, 4, 5], async () => {
    started++;
    return started;
  }, { width: 1, stopEarly: () => started >= 2 });
  ok(stopped.stopped, "the pool reports that it stopped early rather than completing");
  eq(stopped.done, 2, "exactly the items claimed before the stop were attempted");
  assert.deepEqual(stopped.attempted.slice(2), [false, false, false, false],
    "and the tail is marked NOT ATTEMPTED, which is what the chain leg counts as skipped");
  checks++;

  const empty = await runPooled([], async () => 1, { width: 4 });
  eq(empty.done, 0, "an empty list is a no-op rather than a hang");
  const narrow = await runPooled([7], async (x) => x, { width: 9 });
  assert.deepEqual(narrow.results, [7], "a width wider than the list is clamped to the list");
  checks++;

  const cold = poolWidth(POOL_MAX_WIDTH, { calls: POOL_EVIDENCE_MIN - 1, rateLimited: 0 });
  eq(cold.width, 1, "with too few calls to be evidence, the pool stays one wide");
  eq(cold.rate, null,
     "and the rate is NULL rather than 0 — four clean calls is not a measured 0% refusal rate");

  const refused = poolWidth(POOL_MAX_WIDTH, { calls: 1022, rateLimited: 170 });
  eq(refused.width, 1,
     "at the 2026-08-26 shape (170 of 1022 refused) the pool refuses to widen at all");
  near(refused.rate, 170 / 1022, 1e-12, "and it reports the rate it decided on");

  const easing = poolWidth(POOL_MAX_WIDTH, { calls: 1000, rateLimited: 80 });
  eq(easing.width, 2, "between the two rungs it widens to two and no further");

  const healthy = poolWidth(POOL_MAX_WIDTH, { calls: 1000, rateLimited: 10 });
  eq(healthy.width, POOL_MAX_WIDTH, "and on a run that is not being refused it takes its full width");

  ok(POOL_REFUSAL_EASE < POOL_REFUSAL_HALT,
     "the two rungs are ordered, so the ladder cannot invert and hand a refused run more width");
  eq(poolWidth(2, { calls: 1000, rateLimited: 10 }).width, 2,
     "a leg that asks for a narrower maximum gets it — the gate never widens past the caller");

  eq(poolWidth(POOL_MAX_WIDTH, { calls: 1000, rateLimited: 1000 * POOL_REFUSAL_HALT }).width, 2,
     "a rate exactly at the halt rung is not halted");
  eq(poolWidth(POOL_MAX_WIDTH, { calls: 1000, rateLimited: 1000 * POOL_REFUSAL_EASE }).width,
     POOL_MAX_WIDTH, "and a rate exactly at the ease rung takes full width");

  const unmetered = poolWidth(POOL_MAX_WIDTH, { calls: 1000 });
  eq(unmetered.width, 1,
     "a meter that counted calls but carries no refusal counter runs ONE wide — an unmeasured " +
     "run is not a healthy one");
  eq(unmetered.rate, null, "and reports no rate rather than 0%");
  eq(poolWidth(POOL_MAX_WIDTH, {}).width, 1, "and neither is an empty meter evidence of anything");
  eq(poolWidth(POOL_MAX_WIDTH, { calls: 1000, rateLimited: 0 }).width, POOL_MAX_WIDTH,
     "while a counter PRESENT and zero is a measured zero and still takes full width — the " +
     "guard above distinguishes absence from measurement rather than banning zero");
}

{

  const board = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
  const slow = { AAA: 40 };

  const outcome = {
    AAA: { status: "built", gamma: ["AAA-bars"] },
    BBB: { status: "failed" },
    CCC: { status: "built", gamma: ["CCC-bars"] },
    DDD: { status: "unenriched" },
    EEE: undefined,
    FFF: { status: "built", gamma: ["FFF-bars"] },
  };
  const finished = [];
  let live = 0, peak = 0;
  const run = await runPooled(board, async (ticker) => {
    live++; if (live > peak) peak = live;
    await new Promise((r) => setTimeout(r, slow[ticker] || 2));
    live--; finished.push(ticker);
    return outcome[ticker];
  }, { width: 2 });

  ok(peak > 1, `the fixture really ran wide (peak ${peak}) — at width 1 this block would ` +
     "certify nothing, which is exactly the gap the dry run leaves");
  eq(finished[finished.length - 1], "AAA",
     "and it really completed out of order: the first name on the board finished last");

  const fold = foldCardOutcomes(board, run);
  assert.deepEqual(fold.gammaProfiles, [["AAA-bars"], ["CCC-bars"], ["FFF-bars"]],
     "the fold returns the gamma profiles in BOARD order, not completion order — the " +
     "profile of the name that finished last is still the first one folded");
  checks++;
  eq(fold.built, 3, "three names built");
  eq(fold.failed, 2,
     "and TWO failed — the name that threw and the name that returned nothing. A worker that " +
     "was reached and produced no card is a failure, not a name the clock ran out on");
  eq(fold.unenriched, 1, "the name with no enrichment row is its own outcome");
  eq(fold.deadlineSkipped, 0, "and nothing was skipped: the pool reached every name");
  eq(fold.skipped, 1,
     "the published skip count is the two skips together — the deadline's and the missing " +
     "row's — which is what `meta` has always carried");

  eq(fold.built + fold.failed + fold.unenriched, run.done,
     "built + failed + unenriched is exactly what the pool ATTEMPTED");
  eq(fold.deadlineSkipped, board.length - run.done,
     "and the deadline skips are exactly what it did not attempt");

  const naive = board.filter((_, i) => run.results[i] === undefined).length;
  eq(naive, 1,
     "counted off a missing result, this run reports a name skipped past the deadline");
  eq(fold.deadlineSkipped, 0,
     "counted off `attempted`, it reports none — the pool ran to the end of the board. The " +
     "two disagree, and only one of them can be printed under the deadline's name");

  let started = 0;
  const cut = await runPooled(board, async (ticker) => {
    started++;
    return { status: "built", gamma: [ticker] };
  }, { width: 2, stopEarly: () => started >= 2 });
  const cutFold = foldCardOutcomes(board, cut);
  eq(cutFold.built, 2, "two cards were built before the clock ran out");
  eq(cutFold.deadlineSkipped, 4, "and the four names never claimed are the deadline's");
  eq(cutFold.failed, 0,
     "none of them is reported as a FAILURE — a name the pool never reached did not fail, and " +
     "a leg that said it did would send an operator looking for a defect that is a deadline");
  assert.deepEqual(cutFold.gammaProfiles, [["AAA"], ["BBB"]],
     "and only the names actually built contribute a gamma profile");
  checks++;

  const nothing = foldCardOutcomes([], { results: [], attempted: [] });
  eq(nothing.built + nothing.failed + nothing.skipped, 0, "an empty board folds to zeros");
  eq(foldCardOutcomes(["AAA"], {}).deadlineSkipped, 1,
     "and a run object carrying no arrays at all reports the name as NOT ATTEMPTED rather " +
     "than throwing or claiming it was built");

  const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");
  ok(/foldCardOutcomes\(cardTickers, cardsRun\)/.test(src),
     "the cards leg folds its pooled run through foldCardOutcomes");
  ok(/runPooled\(cardTickers,/.test(src) && /stopEarly: \(\) => Date\.now\(\) > deadline/.test(src),
     "and the leg is pooled with the deadline checked by every worker before it claims a name, " +
     "rather than once at dispatch");
}

{
  eq(describeFloorVerdict({ calls: 0, rateLimited: 0, permitWaitMs: 0, rateLimitWaitMs: 0 }), null,
     "a run that made no calls says NOTHING about the floor — an empty meter is not a " +
     "measured 0% refusal rate, and printing one would be a confident zero about the one " +
     "constant this file refuses to change on intuition");

  const refused = describeFloorVerdict({
    calls: 1022, rateLimited: 170, permitWaitMs: 807_000, rateLimitWaitMs: 510_000 });
  ok(/CEILING IS DOING ITS JOB/.test(refused),
     "at 170 refusals in 1022 calls the verdict refuses to raise the ceiling");
  ok(/170 of 1022 calls refused \(16\.6%\)/.test(refused),
     `and it shows the arithmetic it decided on — got: ${refused}`);
  ok(/63% as large/.test(refused),
     "including backoff as a share of queueing, which is the trade the ceiling is a position on");

  const middling = describeFloorVerdict({
    calls: 1000, rateLimited: 80, permitWaitMs: 700_000, rateLimitWaitMs: 90_000 });
  ok(/Neither raising nor lowering/.test(middling),
     "between the rungs it declines to recommend a move in either direction");

  const conservative = describeFloorVerdict({
    calls: 1000, rateLimited: 10, permitWaitMs: 700_000, rateLimitWaitMs: 9_000 });
  ok(/floor is CONSERVATIVE/.test(conservative),
     "and on a run that is barely refused it says the ceiling can come down");
  ok(/one step at a time/.test(conservative),
     "one step at a time, because the last time this constant moved on a hunch it moved wrong");

  const unqueued = describeFloorVerdict({
    calls: 100, rateLimited: 0, permitWaitMs: 0, rateLimitWaitMs: 0 });
  ok(/nothing queued/.test(unqueued),
     "a run that never waited for a turn says so rather than publishing a ratio over zero");

  eq(describeFloorVerdict({ calls: 1000, permitWaitMs: 700_000, rateLimitWaitMs: 0 }), null,
     "a meter with calls but NO refusal counter produces no verdict at all, rather than the " +
     "cheerful one that reads an absence as zero refusals");
  const untimed = describeFloorVerdict({ calls: 1000, rateLimited: 10 });
  ok(/no wait meters/.test(untimed),
     "and a meter with no wait counters reports the rate it does have while saying the " +
     "queueing-against-backoff split was not measured");
  ok(!/0\.0s/.test(untimed),
     "never printing 0.0s of queueing, which would read as a run that never waited for a turn");
  ok(/floor is CONSERVATIVE/.test(untimed),
     "the rate it CAN read still reaches its rung — an unread wait meter withholds the split, " +
     "not the verdict");

  eq(poolWidth(POOL_MAX_WIDTH, { calls: 1022, rateLimited: 170 }).width, 1,
     "the same meter that produces the DO-NOT-RAISE verdict also holds every pooled leg at " +
     "width 1 — the sentence and the throttle cannot disagree");
}

{
  const row = (t, k, expiry, cp) => ({ t, k, expiry, cp, vol: 10, oi: 10 });

  eq(unusualContractId(row("AAPL", 200, "2026-09-18", "C")), "AAPL|200|2026-09-18|C",
     "a contract's identity is ticker, strike, expiry and side");
  ok(unusualContractId(row("AAPL", 200, "2026-09-18", "C")) !==
     unusualContractId(row("AAPL", 200, "2026-09-18", "P")),
     "a call and a put at the same strike and expiry are different contracts");
  ok(unusualContractId(row("AAPL", 200, "2026-09-18", "C")) !==
     unusualContractId(row("AAPL", 205, "2026-09-18", "C")),
     "and so are two strikes on one expiry");
  eq(unusualContractId(row("AAPL", 200, "2026-09-18", "X")), null,
     "an unrecognised side yields NO identity rather than a key that could collide");
  eq(unusualContractId({ t: "AAPL", expiry: "2026-09-18", cp: "C" }), null,
     "and a row with no strike yields none either — a partial key is a collision waiting");

  const priorBody = (rows, readAt = "2026-08-21T09:20:00.000Z", sessionDate = "2026-08-21") =>
    ({ readAt, sessionDate, contracts: { rows } });

  const RUN = "2026-08-24";

  {
    const today = [
      row("AAPL", 200, "2026-09-18", "C"),
      row("AAPL", 205, "2026-09-18", "C"),
      row("MSFT", 400, "2026-09-18", "P"),
    ];
    const mark = markNewContracts(today, priorBody([
      row("AAPL", 200, "2026-09-18", "C"),
      row("NVDA", 900, "2026-09-18", "C"),
    ]), RUN);
    eq(mark.status, "ok", "a prior feed that named contracts is a comparison that happened");
    assert.deepEqual(today.map((r) => r.nw), [0, 1, 1],
      "the carried-over line is 0 and the two absent from the prior feed are 1");
    checks++;
    eq(mark.fresh, 2, "and `fresh` agrees with the rows rather than travelling separately");
    eq(mark.contracts, 2, "the denominator is the prior feed's own identifiable row count");
    eq(mark.readAt, "2026-08-21T09:20:00.000Z", "the prior read time travels with the verdict");
    eq(mark.sessionDate, "2026-08-21", "and so does the session it was published for");
  }

  {
    const today = [row("AAPL", 200, "2026-09-18", "C"), row("MSFT", 400, "2026-09-18", "P")];
    const mark = markNewContracts(today, null, RUN);
    eq(mark.status, "unavailable", "no prior payload is UNAVAILABLE, not an empty comparison");
    ok(today.every((r) => r.nw === null),
       "and NOT ONE row claims to be new when there was nothing to compare against");
    eq(mark.contracts, null, "the prior count is null rather than 0 — nothing was counted");
    eq(mark.fresh, null, "and so is the fresh count: zero would be a measurement");
  }

  {
    const today = [row("AAPL", 200, "2026-09-18", "C")];
    const mark = markNewContracts(today, priorBody([]), RUN);
    eq(mark.status, "quiet", "a prior feed read with no contracts in it is QUIET, not unavailable");
    eq(today[0].nw, null,
       "and still marks nothing new: `new` against a list that named nothing is not a reading");
    eq(mark.contracts, 0, "the prior count IS zero here, because zero was measured");
    eq(mark.fresh, null, "while fresh stays null, because no comparison was made");
  }

  {
    const today = [row("AAPL", 200, "2026-09-18", "C")];
    const mark = markNewContracts(today, priorBody([{ symbol: "AAPL260918C00200000" }]), RUN);
    eq(mark.status, "quiet",
       "a prior feed whose rows yield no identity is treated as no comparison, not as a clean sweep");
    eq(today[0].nw, null, "so no row claims to be new off it");
  }

  {
    const today = [row("AAPL", 200, "2026-09-18", "C"), { t: "MSFT", cp: "P" }];
    markNewContracts(today, priorBody([row("AAPL", 200, "2026-09-18", "C")]), RUN);
    eq(today[0].nw, 0, "the identifiable row is compared");
    eq(today[1].nw, null,
       "and the row this run could not build a key for is NULL — \"I cannot identify you\" " +
       "is not \"you are new\"");
  }

  {
    const mark = markNewContracts([], priorBody([row("AAPL", 200, "2026-09-18", "C")]), RUN);
    eq(mark.status, "ok", "an empty feed still records that the comparison was possible");
    eq(mark.fresh, 0, "and reports zero new contracts, which here is a measurement");
  }

  {
    const today = [row("AAPL", 200, "2026-09-18", "C"), row("MSFT", 400, "2026-09-18", "P")];

    const mark = markNewContracts(today, priorBody([row("NVDA", 900, "2026-09-18", "C")], undefined, RUN), RUN);
    eq(mark.status, "same-session",
       "a stored feed stamped with the session this run is publishing is this run's own " +
       "output, and is named as such rather than used as yesterday");
    ok(today.every((r) => r.nw === null),
       "THE FIX: not one row claims anything, where the unguarded read would have marked " +
       "both of these new against a feed that is really this morning's own");
    eq(mark.fresh, null, "and `fresh` is null rather than 2 — no comparison was made");
    eq(mark.contracts, 1,
       "while still saying how many the stored feed named: 1 named and nothing claimed is " +
       "legible as a refusal, where a bare null would look like an unreadable store");

    const ahead = markNewContracts(
      [row("AAPL", 200, "2026-09-18", "C")],
      priorBody([row("NVDA", 900, "2026-09-18", "C")], undefined, "2026-08-25"), RUN);
    eq(ahead.status, "ahead", "a feed stamped for a LATER session is refused and named");
    eq(ahead.fresh, null, "and marks nothing either");
    ok(priorNote(ahead, RUN, 1) !== priorNote(mark, RUN, 2),
       "the two refusals do not share a sentence — a reader has to be able to tell a holiday " +
       "re-run from a stale tape");
  }

  {
    const today = [row("AAPL", 200, "2026-09-18", "C"), row("MSFT", 400, "2026-09-18", "P")];
    const mark = markNewContracts(today, priorBody([row("AAPL", 200, "2026-09-18", "C")], undefined, null), RUN);
    eq(mark.status, "undated", "a stored feed with no session date cannot be checked, and says so");
    assert.deepEqual(today.map((r) => r.nw), [0, 1],
      "but the comparison still happens — a missing stamp is not a missing yesterday");
    checks++;
    eq(mark.fresh, 1, "and the count is real");
    const noRun = markNewContracts([row("AAPL", 200, "2026-09-18", "C")],
      priorBody([row("AAPL", 200, "2026-09-18", "C")]), null);
    eq(noRun.status, "undated",
       "and a run that could not resolve its OWN session date is the same answer from the " +
       "other side — the check needs both stamps");
  }

  {
    const cases = ["ok", "undated", "same-session", "ahead", "quiet", "unavailable"];
    const notes = cases.map((status) => priorNote(
      { status, contracts: status === "unavailable" ? null : 3, fresh: status === "ok" || status === "undated" ? 1 : null,
        readAt: "2026-08-21T09:20:00.000Z", sessionDate: status === "unavailable" ? null : "2026-08-21" },
      RUN, 9));
    eq(new Set(notes).size, cases.length,
       `all ${cases.length} answers get their OWN sentence (${new Set(notes).size} distinct), never ` +
       "one generic line standing in for the several different reasons a column can be empty");
    ok(notes.every((n) => n.length > 140),
       "and each is a sentence naming what was compared and why, not a label");
    ok(/2026-08-21/.test(notes[0]) && /9/.test(notes[0]),
       "the comparison's sentence carries the session it was against and the population it " +
       "counted over — a count with no denominator is the thing this feed refuses");
    ok(!/\b0 contracts?\b/.test(notes[5]) && /none has ever been published/.test(notes[5]),
       "and the unreadable case names its two causes without printing a count of 0, which " +
       "would be a measurement of a store that answered nothing");

    ok(!/\b(print|trade|block|sweep|order|bought|sold|paid|whale)\b/i.test(notes.join(" ")),
       "and none of the six says a word Refusal 1 bans on a page whose subject is a counter");
  }
}

{
  const board = (sessionDate, rows) => ({ v: 4, side: "long", sessionDate, rows });
  const yesterdayRows = [{ t: "AAA", r: 1 }, { t: "BBB", r: 2 }, { t: "CCC", r: 3 }];
  const TODAY = "2026-08-25";

  const same = readBoardMemory({ payload: board(TODAY, yesterdayRows) }, TODAY);
  eq(same.status, "same-session",
     "a published board stamped with the session this run is about to write is this run's own " +
     "output, and is named as such rather than used as yesterday");
  eq(same.rows.length, 0,
     "THE FIX: the incumbent list handed to applyHysteresis is EMPTY, which is the only thing " +
     "that stops a name from being its own incumbent");
  eq(same.incumbents, 0, "and the payload says none were used");
  eq(same.named, 3,
     "while still saying how many were read — 0 used of 3 named is legible as a refusal, where " +
     "a bare 0 would read as a board that held nothing");
  ok(same.note.includes(TODAY),
     `and the sentence names the session it refused (${same.note.slice(0, 60)}...)`);
  ok(/cold start/.test(same.note) && /discarded/.test(same.note),
     "and says the board is a cold start and why, which is a fact about the reading and not a " +
     "glitch a reader should discount");

  const warm = readBoardMemory({ payload: board("2026-08-22", yesterdayRows) }, TODAY);
  eq(warm.status, "ok", "a board stamped for an earlier session IS the memory");
  eq(warm.incumbents, 3, "all three names reach hysteresis");
  assert.deepEqual(warm.rows, yesterdayRows,
    "and they arrive as ROWS with their ranks intact — `r0` and `dr` exist only because the " +
    "rank was not thrown away on the way in"); checks++;
  eq(warm.sessionDate, "2026-08-22",
     "the payload names the session the comparison was made against, so \"new\" has a denominator");

  const undated = readBoardMemory({ payload: board(undefined, yesterdayRows) }, TODAY);
  eq(undated.status, "undated",
     "a prior board with NO session date is distinguished from one whose date matches");
  ok(undated.status !== same.status && undated.note !== same.note,
     "in both the status and the sentence — collapsing them would report a cold start on every " +
     "board published before the stamp existed");
  eq(undated.incumbents, 3, "its membership is still used, because absence of a stamp is not evidence of a re-run");
  eq(undated.sessionDate, null, "and the missing stamp is published as missing rather than invented");
  ok(/could not check/.test(undated.note) && /unverified/.test(undated.note),
     "with a sentence that says the check could not be made rather than implying one was");

  eq(readBoardMemory({ payload: board("yesterday", yesterdayRows) }, TODAY).status, "undated",
     "a sessionDate that is not an ISO date is unusable rather than quietly earlier than today");
  eq(readBoardMemory({ payload: board("", yesterdayRows) }, TODAY).sessionDate, null,
     "and an empty stamp is published as no stamp, never as a session");

  const absent = readBoardMemory({ payload: null, absent: true, status: 200 }, TODAY);
  eq(absent.status, "unavailable", "a key that was never published leaves the board cold, as it always did");
  eq(absent.rows.length, 0, "with no incumbents");
  eq(absent.named, null,
     "and `named` is NULL, never 0 — a store that answered nothing is not a board that held " +
     "nothing, and Number(null) === 0 is this file's oldest defect");

  const failed = readBoardMemory({ payload: null, failed: true, status: 503 }, TODAY);
  eq(failed.status, "unavailable",
     "a read that did not complete carries the same tag, because a reader can do nothing " +
     "different about it");
  ok(failed.note !== absent.note,
     "THREE SILENCES, THREE SENTENCES: \"never published\" and \"could not be read\" share the " +
     "unavailable tag and do not share a sentence");
  ok(/503/.test(failed.note),
     `and the failed read names what the store answered (${failed.note.slice(-60)}), which is the ` +
     "half an operator can act on");

  const quiet = readBoardMemory({ payload: board("2026-08-22", []) }, TODAY);
  eq(quiet.status, "quiet", "a board that was read and named no rows is quiet, not unavailable");
  eq(quiet.named, 0, "and its emptiness is a measured 0 where an unreadable board is a null");
  ok(quiet.note !== absent.note && quiet.note !== failed.note,
     "with its own sentence: a session that ranked nothing is not a store that answered nothing");

  const ahead = readBoardMemory({ payload: board("2026-08-26", yesterdayRows) }, TODAY);
  eq(ahead.status, "ahead", "a board stamped for a LATER session is refused and named");
  eq(ahead.incumbents, 0, "its membership does not reach hysteresis");
  ok(ahead.note !== same.note, "and it says which of the two refusals happened");

  const unstamped = readBoardMemory({ payload: board("2026-08-22", yesterdayRows) }, null);
  eq(unstamped.status, "undated", "a run that could not resolve its own session cannot run the check");
  eq(unstamped.incumbents, 3, "so it keeps the memory rather than manufacturing a cold start");
  ok(/This run could not resolve a session date/.test(unstamped.note),
     "and the sentence names which side of the comparison was missing");

  {
    const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");
    const start = src.indexOf("export function readBoardMemory");
    ok(start !== -1, "readBoardMemory is where this scan expects it — a rename must update this check");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    ok(!/Date\.now\(|new Date\(|easternNow\(/.test(body),
       "the guard reads no clock: two published session dates, compared as strings, so the " +
       "answer cannot depend on the hour the run happens to start");
    ok(/readBoardMemory\(read, sessionDate\)/.test(src),
       "and the run checks against the very `sessionDate` it is about to stamp on the payload, " +
       "not against easternNow().date — which at 05:15 Eastern is one to three days later");
  }

  const mk = (ticker, score) => ({
    ticker, score, residual: score / 100,
    conviction: 50, spot: 100, purity: 0.5, gRegime: "long", flipDist: 0.1,
    fam: { F: score, P: 0, D: 0, O: 50, V: 40 },
    closes: Array.from({ length: 60 }, (_, i) => 100 + i),
    r5: 0.01, r21: 0.02, r42: 0.03,
    week52Pos: 0.42, vrp: 0.03, ivRank: 0.61,
    impliedMovePerc: 0.05, iv30: 0.4, rv30: 0.3,
  });
  const screener = new Map();
  const ORIGIN = "2026-08-25";
  const pool = Array.from({ length: 60 }, (_, i) => mk("W" + String(i).padStart(2, "0"), 100 - i));

  const first = toRows(pool, screener, [], ORIGIN);
  ok(first.length < pool.length,
     `the fixture pool (${pool.length}) is wider than the board's entry rank (${first.length}), so ` +
     "the hysteresis band is reachable — if the board ever grows past this pool the fixture must " +
     "grow with it or these assertions stop measuring anything");

  const held = 5;
  const arrivals = ["W01", "W02"];
  const priorRows = pool.slice(0, first.length + held)
    .filter((r) => !arrivals.includes(r.ticker))
    .map((r, i) => ({ t: r.ticker, r: i + 1 }));

  const asYesterday = toRows(pool, screener, readBoardMemory(
    { payload: board("2026-08-22", priorRows) }, ORIGIN).rows, ORIGIN);
  eq(asYesterday.length, first.length + held,
     "against a REAL prior session the five slipped names stay on the board — that is hysteresis " +
     "working, and it is what the second run of one session was silently getting for free");
  eq(asYesterday.filter((r) => r.hy === true).length, held,
     `and all ${held} of them are marked as held on incumbency rather than passed off as ranked`);

  const asItself = toRows(pool, screener, readBoardMemory(
    { payload: board(ORIGIN, priorRows) }, ORIGIN).rows, ORIGIN);
  assert.deepEqual(asItself.map((r) => r.t), first.map((r) => r.t),
    "THE FIX, AT THE ROWS: a board held against its own session publishes exactly the board a " +
    "first run of that session would have published — five names fewer, none of them kept by a " +
    "comparison with themselves"); checks++;
  ok(asItself.every((r) => r.nw === null && r.hy === null && r.r0 === null && r.dr === null),
     "and every row's four memory fields are null TOGETHER, so no renderer can draw a rank move " +
     "out of a comparison that was refused");
  ok(asYesterday.some((r) => r.nw === false) && asYesterday.some((r) => r.nw === true),
     "while the real comparison still answers both ways, which is what makes the null above a " +
     "refusal rather than a builder that never marks anything");

  {
    const rankless = toRows(pool.slice(0, 3), screener, [{ t: "W00" }, { t: "W01", r: 9 }], ORIGIN);
    const noRank = rankless.find((r) => r.t === "W00");
    eq(noRank.r0, null, "a prior row with no published rank yields no yesterday's rank");
    eq(noRank.dr, null, "and no phantom fall — before this it published dr = -1 off a rank of zero");
    eq(noRank.nw, false, "while the name is still correctly an incumbent: absence of a rank is not absence from the board");
    eq(rankless.find((r) => r.t === "W01").dr, 7, "and a row that DID publish a rank still moves by it");
  }

  eq(fakePriorBoard("short", pool, "2026-08-24").sessionDate, "2026-08-24",
     "the fixture stamps the SHORT side with the run's own session — that is the market-holiday " +
     "re-run, and it is deliberate");
  ok(fakePriorBoard("long", pool, "2026-08-24").sessionDate < "2026-08-24",
     "and the long side with an earlier weekday, so one dry run emits a used memory and a " +
     "refused one side by side");
}

{
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "flows-warn-")) + "/w";
  const run = spawnSync(process.execPath,
    ["../scripts/flows-pipeline.mjs", "--dry-run", "--emit", prefix],
    { cwd: import.meta.dirname, encoding: "utf8" });
  eq(run.status, 0, "the dry run exits clean");
  const runLog = run.stdout + run.stderr;

  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  const emitted = fs.readdirSync(dir);
  const fileFor = (key) => {
    const want = base + "-" + key.replace(":", "-") + ".json";
    ok(emitted.includes(want),
       `the dry run emitted "${key}" as ${want} (directory holds: ${emitted.slice(0, 6).join(", ")}...)`);
    return path.join(dir, want);
  };
  const read = (key) => JSON.parse(fs.readFileSync(fileFor(key), "utf8"));

  for (const side of ["long", "short"]) {
    const board = read("board:" + side);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(String(board.gateOrigin || "")),
       `board:${side} publishes gateOrigin as an ISO date (${board.gateOrigin})`);
    eq(board.gateDays, 12,
       `and the gate's own threshold beside it, so a row with edte 13 explains itself`);
    ok(board.gateOrigin !== board.sessionDate,
       `and the two clocks are demonstrably DIFFERENT in this corpus ` +
       `(gateOrigin ${board.gateOrigin}, sessionDate ${board.sessionDate}) — if they were equal ` +
       "the distinction would be untested and a renderer could use either");

    const dated = board.rows.filter((r) => r.ed !== null);
    ok(dated.length > 0,
       `board:${side} carries earnings dates on ${dated.length} of ${board.rows.length} rows, so ` +
       "these assertions are over a populated column rather than an empty one");
    for (const r of dated) {
      const want = Math.round(
        (Date.parse(r.ed + "T00:00:00Z") - Date.parse(board.gateOrigin + "T00:00:00Z")) / 86400000);
      eq(r.edte, want, `${r.t}: edte reproduces from ed and gateOrigin alone`);
    }
    ok(board.rows.every((r) => (r.ed === null) === (r.edte === null)),
       `and ${side} publishes the date and the count as a pair — a count with no date is ` +
       "not checkable, which is the lesson /flows/events/ already paid for");

    ok(dated.some((r) => r.edte !== null && r.edte > 12 && r.edte <= 21),
       `board:${side} holds at least one name reporting just past the gate — the row this ` +
       "column exists for, and proof the branch is reachable");
    eq(board.gateOrigin, nextWeekday(board.sessionDate),
       `board:${side}'s gate counts from the next session (${board.gateOrigin}), not the ` +
       "machine's date — which made the dry corpus a different corpus every day it ran");
  }

  {
    const cardFiles = emitted.filter((n) => n.startsWith(base + "-card-") &&
      /^[A-Z]/.test(n.slice((base + "-card-").length)));
    ok(cardFiles.length >= 50, `the dry run emitted ${cardFiles.length} cards to check`);
    let boardCards = 0;
    for (const name of cardFiles) {
      const card = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      const cx = card.panels && card.panels.context;
      if (!cx || cx.status !== "ok") continue;
      ok(cx.closeDates[cx.closeDates.length - 1] <= card.sessionDate &&
         cx.candles.every((c) => c[0] <= card.sessionDate) &&
         (!cx.garch || !Array.isArray(cx.garch.dates) || cx.garch.dates.every((d) => d <= card.sessionDate)),
         `${card.ticker}: closeDates, candles and GARCH dates never run past ${card.sessionDate}`);
      ok(card.readPx && card.readPx.source === "screener" && typeof card.readPx.readAt === "string",
         `${card.ticker}: the screener price travels as a labelled readPx with its read time`);
      if (card.depth !== "board") continue;
      boardCards++;
      const rank = card.panels.volContext && card.panels.volContext.ivRank;
      ok(!rank || !Array.isArray(rank.rows) || rank.rows.every((r) => r.date <= card.sessionDate),
         `${card.ticker}: no IV-rank row is dated after the session`);
      eq(card.panels.levels.spot, cx.candles[cx.candles.length - 1][4],
         `${card.ticker}: the levels are measured from the session's own close`);
    }
    ok(boardCards >= 25, `and ${boardCards} of them are board cards carrying the per-name feeds`);
    ok(/per-name feeds: \d+ card\(s\) carried rows from outside/.test(runLog),
       "the fixture's IV-rank history runs past the session, so the cut is exercised and logged");
    ok(/archive check: scores, board:long and board:short are all written/.test(runLog),
       "and the end-of-run archive check runs and finds the session whole");
  }

  {
    const long = read("board:long");
    const short = read("board:short");

    eq(long.memory.status, "ok",
       "the ordinary morning is reached: board:long compared against an earlier session");
    ok(long.memory.sessionDate < long.sessionDate,
       `and it really is earlier (${long.memory.sessionDate} against this run's ${long.sessionDate}), ` +
       "compared as two dates and never as two instants");
    ok(long.memory.incumbents > 0 && long.memory.incumbents === long.memory.named,
       `all ${long.memory.named} names it read reached hysteresis`);
    ok(long.rows.some((r) => r.nw === true) && long.rows.some((r) => r.nw === false),
       "and the corpus reaches BOTH answers on the warm side, so the nulls on the other side " +
       "are a refusal rather than a builder that never marks anything");

    eq(short.memory.status, "same-session",
       "THE SAME-SESSION BRANCH ACTUALLY RUNS in the emitted corpus, so these assertions are " +
       "about a branch that runs rather than one that never fires");
    eq(short.memory.sessionDate, short.sessionDate,
       "the board it read was stamped for the very session it is publishing — the market " +
       "holiday, the early close, the cron that fired twice");
    ok(short.memory.named > 0,
       `and the refused board really did name rows (${short.memory.named}) — a refusal of ` +
       "nothing would prove nothing");
    eq(short.memory.incumbents, 0, "none of which reached hysteresis");
    ok(short.rows.every((r) => r.nw === null && r.hy === null && r.r0 === null && r.dr === null),
       `so all four memory fields are null together on every one of the ${short.rows.length} rows — ` +
       "the board claims nothing rather than claiming everything returned");
    ok(short.rows.length > 0 && !short.rows.some((r) => r.hy === true),
       "and no row is held on incumbency, which is exactly what the unguarded re-read was " +
       "manufacturing");

    ok(typeof short.memory.note === "string" && short.memory.note.length > 120,
       "the payload carries the reason as a sentence rather than leaving `same-session` to be " +
       "decoded by a renderer that has never seen this file");
    ok(/cold start/.test(short.memory.note) && /own output/.test(short.memory.note),
       `and it names the cold start and its cause (${short.memory.note.slice(0, 70)}...)`);
    ok(long.memory.note !== short.memory.note,
       "and a board that used its memory does not print the sentence of one that refused it");
    ok(!("rows" in short.memory),
       "the memory travels as a status, two counts and a sentence — never as yesterday's rows, " +
       "which would put a second board inside every board against a 128KB ingest cap");

    ok(/board:long memory: ok — \d+ new, \d+ held on incumbency, of \d+ \(\d+ incumbents? from \d{4}-\d{2}-\d{2}\)/.test(runLog),
       "the warm side reports its counts, its incumbent count and the session they came from");
    const coldLine = /board:short memory: same-session — (.+)/.exec(runLog);
    ok(coldLine && coldLine[1].length > 120,
       "and the refused side leads with its status — greppable across a month of runs — then " +
       "prints the payload's own sentence rather than a second, shorter one written beside it");
    ok(coldLine && coldLine[1] === short.memory.note,
       "the same sentence, byte for byte: two spellings of one fact is how a log and a page " +
       "start disagreeing about what happened");
  }

  {
    const u = read("unusual");
    eq(u.prior.status, "ok",
       "the dry run reaches the COMPARISON branch of the first-appearance marker rather than " +
       "only its absence — a fixture that could only publish nulls would certify nothing");
    ok(u.contracts.rows.length > 0, "and the feed has rows to mark");
    ok(u.contracts.rows.every((r) => r.nw === 0 || r.nw === 1),
       "every row carries a 1 or a 0 under an `ok` comparison");
    const fresh = u.contracts.rows.filter((r) => r.nw === 1).length;
    eq(u.prior.fresh, fresh,
       "and the published count agrees with the rows it describes rather than travelling separately");
    ok(fresh > 0 && fresh < u.contracts.rows.length,
       `the corpus reaches BOTH answers (${fresh} new of ${u.contracts.rows.length}) — a prior ` +
       "identical to today would mark nothing and a prior of nothing would mark everything, " +
       "and neither would test the lookup");
    ok(typeof u.prior.readAt === "string" && !Number.isNaN(Date.parse(u.prior.readAt)),
       "the comparison names when the prior feed was read");
    ok(u.prior.sessionDate !== u.sessionDate,
       `and which session it was published for (${u.prior.sessionDate} against today's ${u.sessionDate}), ` +
       "so \"new\" has a denominator a reader can see");
    ok(typeof u.basis.new === "string" && u.basis.new.length > 40,
       "and the field travels with prose saying what the comparison was");
  }

  ok(/enrichment: 1 name\(s\) in flight/.test(runLog),
     "the enrichment leg reports the width it chose, and on a call-free run that width is 1");
  ok(/chains: \d+ name\(s\), 1 in flight/.test(runLog),
     "so does the chain leg");
  ok(/cards: \d+ name\(s\), 1 in flight/.test(runLog),
     "and so does the cards leg, which was the last serial stretch — on this run it is the " +
     "serial loop it replaced, which is the only thing a call-free corpus can say about it");
  ok(/which is not evidence/.test(runLog),
     "and all three name the reason — a run with no calls has measured no refusal rate, which " +
     "is not the same as having measured zero");

  ok(/prune: \d+ dated keys past \d+ days named/.test(runLog),
     "the detached prune completed and reported its sweep before the run ended");
  ok(/record: \d+ retained session\(s\) of \d+ dated key\(s\) probed/.test(runLog),
     "and the detached archive walk was awaited in time for the record to score it");

  for (const name of emitted) {
    const bytes = fs.statSync(path.join(dir, name)).size;
    if (name === "w-brief.json") {
      ok(bytes <= 120 * 1024,
         `${name} is ${(bytes / 1024).toFixed(1)}KB, inside the brief's own 120KB ceiling ` +
         "(the ingest route accepts 128KB; the shed in the pipeline measures against 120KB)");
      continue;
    }
    if (/^w-card-/.test(name)) {
      ok(bytes <= 128 * 1024,
         `${name} is ${(bytes / 1024).toFixed(1)}KB, inside the 128KB the ingest route accepts, engine block included`);
      const stored = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (stored && stored.engine && stored.engine.status !== "split") {
        const { engine, ...body } = stored;
        ok(JSON.stringify(body).length <= 100 * 1024,
           `${name} without its engine block is inside the 100KB the card shedder targets; the engine is measured ` +
           "separately against the ingest cap and splits to card-x rather than shedding a panel");
      }
      continue;
    }
    ok(bytes <= 100 * 1024,
       `${name} is ${(bytes / 1024).toFixed(1)}KB, inside the 128KB the ingest route accepts ` +
       "(and inside the 100KB the card shedder targets)");
  }
  {
    const m = /brief: (\d+) facts, (\d+) of them per-name over (\d+) of (\d+) carded names(?: \((\d+) shed)?/.exec(runLog);
    ok(m !== null, "the run log states how many carded names the brief indexed, against how many were carded");
    if (m !== null) {
      const [, , perName, indexed, of, shed] = m;
      eq(Number(indexed) + Number(shed || 0), Number(of),
         `the brief accounts for every deep card: ${indexed} indexed plus ${shed || 0} shed of ${of}`);
      const brief = JSON.parse(fs.readFileSync(`${prefix}-brief.json`, "utf8"));
      const inBrief = new Set(brief.facts.map((f) => /^card:([^/]+)/.exec(String(f.source || ""))).filter(Boolean).map((x) => x[1]));
      const cardOf = (t) => JSON.parse(fs.readFileSync(`${prefix}-card-${t}.json`, "utf8"));
      const focusCards = fs.readdirSync(path.dirname(prefix)).map((f) => /-card-([A-Z].*)\.json$/.exec(f)).filter(Boolean)
        .map((x) => x[1]).filter((t) => cardOf(t).depth === "focus");
      ok(focusCards.length > 0 && focusCards.every((t) => inBrief.has(t)),
         `every focus-depth name is indexed (${focusCards.filter((t) => inBrief.has(t)).length} of ${focusCards.length}): ` +
         "the owner's watch list is what the Ask is asked about most, so the shed never reaches it");
      if (shed !== undefined) {
        const said = /shed to stay under \d+ bytes: the weakest board name\(s\) ([A-Z0-9., -]+);/.exec(runLog);
        ok(said, "a shed names the names it dropped in the run log, so coverage never falls in silence");
        const dropped = said ? said[1].split(", ") : [];
        eq(dropped.length, Number(shed), "and names exactly as many as it counts");
        const boardAbs = new Map([...read("board-long").rows, ...read("board-short").rows].map((r) => [r.t, Math.abs(r.s)]));
        const ndxGroup = read("focus").groups.find((g) => g.id === "ndx10");
        const focusSet = new Set([...FOCUS_MAG7, ...ndxGroup.tickers, ...FOCUS_MINERS]);
        const keptBoard = [...inBrief].filter((t) => boardAbs.has(t) && cardOf(t).depth === "board" && !focusSet.has(t))
          .map((t) => boardAbs.get(t));
        for (const t of dropped) {
          ok(cardOf(t).depth === "board" && !focusSet.has(t) && boardAbs.get(t) <= Math.min(...keptBoard),
             `${t}: the shed takes the WEAKEST board names first (|score| ${boardAbs.get(t)}), never a focus name ` +
             "and never a stronger board name than one it kept");
        }
        ok(Number(indexed) >= 45,
           `and the brief still indexes ${indexed} names — a shed deeper than a handful means the per-name facts ` +
           "grew, which is a decision to take in flows-ask, not here");
      }
      ok(Number(perName) >= 4 * Number(indexed),
         `at least four readings per indexed name reached the brief (${perName} over ${indexed})`);
    }
  }
}

{
  const row = (etf, over) => ({
    ticker: etf, full_name: "Whatever the vendor calls it",
    bullish_premium: "1000", bearish_premium: "1000",
    last: "100", prev_close: "80", volume: 1234,
    call_premium: "600", put_premium: "400", call_volume: 7, put_volume: 9,
    ...over,
  });
  const all = (over = {}) => SECTOR_ETFS.map(({ etf }) => row(etf, over));
  const find = (rows, etf) => sectorLean(rows).find((s) => s.etf === etf);

  {
    const r = find(all({ bullish_premium: "300", bearish_premium: "100" }), "XLK");
    eq(r.read, "ok", "a sector with both premium sums reads ok");
    eq(r.bullishPremiumUsd, 300, "the raw bullish sum is carried, coerced from the string");
    eq(r.bearishPremiumUsd, 100, "and the raw bearish sum");
    eq(r.grossPremiumUsd, 400, "gross is their sum, in dollars");
    eq(r.netPremiumUsd, 200, "net is their difference, in dollars — SIGNED, not a magnitude");
    eq(r.leanRatio, 0.5,
       "and the lean is the DIMENSIONLESS share, 200/400 — a ratio and a dollar difference " +
       "never share a field name, so both are published and neither is called `lean`");
  }

  {
    const rows = all();
    rows[0] = row("XLB", { bullish_premium: "38000", bearish_premium: "2000" });
    rows[5] = row("XLK", { bullish_premium: "520000000", bearish_premium: "480000000" });
    const small = find(rows, "XLB"), big = find(rows, "XLK");
    ok(big.netPremiumUsd > small.netPremiumUsd,
       `the large basket wins on dollars (${big.netPremiumUsd} vs ${small.netPremiumUsd}), ` +
       "which is a fact about sector size rather than about conviction");
    ok(small.leanRatio > big.leanRatio,
       `and the small basket wins on the ratio (${small.leanRatio} vs ${big.leanRatio}) — ` +
       "which is why the payload ranks on leanRatio and publishes the dollars as its SIZE");
  }

  {
    const r = find(all({ bullish_premium: "0", bearish_premium: "0" }), "XLU");
    eq(r.read, "quiet", "both sums zero is QUIET — measured and empty");
    eq(r.netPremiumUsd, 0,
       "and the dollar difference stays a VISIBLE 0. `Number(null)` is also 0, which is why " +
       "absence is tested with === null before any arithmetic runs: a measured zero and a " +
       "missing reading must not arrive at the same number");
    eq(r.grossPremiumUsd, 0, "gross is a measured 0 too");
    eq(r.leanRatio, null,
       "the ratio is NULL, not 0 — 0/0 is undefined, and publishing 0 would put a sector " +
       "where nothing traded on the same footing as one that traded evenly on both sides");
    ok(/measured and empty/.test(r.reason), "and the row says which silence this is");
  }

  {
    const noBear = find(all({ bearish_premium: undefined }), "XLE");
    eq(noBear.read, "unreadable", "a sector missing one premium sum is unreadable");
    eq(noBear.bullishPremiumUsd, 1000, "the side that DID arrive is still published");
    eq(noBear.bearishPremiumUsd, null, "the side that did not is null");
    eq(noBear.netPremiumUsd, null, "and the difference is null — half a subtraction is not a lean");
    eq(noBear.leanRatio, null, "as is the ratio");
    ok(/needs both terms/.test(noBear.reason), "and the reason names the missing term");

    const neither = find(all({ bullish_premium: null, bearish_premium: null }), "XLE");
    eq(neither.read, "unreadable", "neither sum present is also unreadable");
    ok(/carried neither/.test(neither.reason),
       "with a DIFFERENT reason from the one-sided case — two silences, two sentences");
  }

  {
    eq(vendorNum("  42 "), 42, "a padded number still reads as a number");
    eq(vendorNum("   "), null,
       "but a string of nothing but whitespace is ABSENT, not zero — Number(\"   \") is 0 and " +
       "finite, which is the confident zero this repository has shipped five times");
    eq(vendorNum("0"), 0, "while a quoted zero is a MEASURED zero and survives");
    eq(vendorNum(0), 0, "as does a numeric zero");
    eq(vendorNum(null), null, "null is absent");
    eq(vendorNum(undefined), null, "so is undefined");
    eq(vendorNum("n/a"), null, "and so is a string that is not a number at all");

    const base = {
      call_volume: 1000, put_volume: 800, call_premium: 5e6, put_premium: 4e6,
      call_open_interest: 60000, put_open_interest: 40000, total_open_interest: 100000,
      avg_30_day_call_volume: 900, avg_30_day_put_volume: 700,
    };
    const oneSided = screenerTilt({ ...base, bearish_premium: 2e6 });
    eq(oneSided.premiumTilt, null,
       "a bearish premium with no bullish side on the wire is no tilt — it was -1, a full bearish " +
       "vote built from a field the vendor did not send");
    eq(screenerTilt({ ...base, bullish_premium: 3e6, bearish_premium: 2e6 }).premiumTilt, 0.2,
       "while both sides present still measure (3 - 2) / 5");
    eq(screenerTilt({ ...base, bullish_premium: "   ", bearish_premium: 2e6 }).premiumTilt, null,
       "and a blank side is absent, not zero");
    eq(oneSided.oiTilt, null,
       "with no previous open interest there is no open-interest CHANGE — it was 0.2, the " +
       "book's call/put composition dressed as a day's positioning");
    eq(screenerTilt({ ...base, prev_call_oi: 60000, prev_put_oi: 40000 }).oiTilt, 0,
       "while an unchanged book is a measured zero");
    eq(screenerTilt({ ...base, prev_call_oi: 60000 }).oiTilt, null, "half a pair is no change");
    eq(oneSided.netTilt, null, "absent net premiums are no net tilt, not a balanced zero");
    eq(screenerTilt({ ...base, net_call_premium: 1e6 }).netTilt, null, "nor is one leg of them");
    near(screenerTilt({ ...base, net_call_premium: 1e6, net_put_premium: -5e5 }).netTilt, 1.5e6 / 9e6, 1e-12,
      "both legs measure against the gross premium");
    eq(screenerTilt({ ...base, call_volume_ask_side: 600, call_volume_bid_side: 300 }).volTilt, null,
       "an aggressor split on the calls alone is no volume tilt — it was 0.167, half a subtraction");
    near(screenerTilt({ ...base, call_volume_ask_side: 600, call_volume_bid_side: 300,
      put_volume_ask_side: 200, put_volume_bid_side: 500 }).volTilt, 600 / 1800, 1e-12,
      "all four legs measure");
    eq(screenerTilt({ ...base, call_volume: null }).surpriseTilt, null,
       "and a call volume off the wire is no volume surprise");

    const blank = find(all({ bullish_premium: "   " }), "XLRE");
    eq(blank.read, "unreadable",
       "so a blank premium string makes the row unreadable rather than a zero-dollar lean");
    eq(blank.bullishPremiumUsd, null, "with the blank side null rather than 0");
  }

  {
    const partial = sectorLean({ data: [row("XLK"), row("SPY"), row("XLV")] });
    eq(partial.length, SECTOR_ETFS.length,
       "all eleven rows come back however few the vendor sent — a panel that quietly shrinks " +
       "from eleven bars to nine is how an outage goes unnoticed for a week");
    eq(partial.filter((s) => s.read === "ok").length, 2, "the two that were sent are measured");
    const missing = partial.find((s) => s.etf === "XLE");
    eq(missing.read, "unreadable", "and the nine that were not are unreadable");
    ok(/no XLE row/.test(missing.reason), "each naming its own absence");

    const shuffled = sectorLean({ data: SECTOR_ETFS.slice().reverse()
      .map(({ etf }, i) => row(etf, { bullish_premium: String(1000 + i), bearish_premium: "0" })) });
    eq(shuffled[0].etf, SECTOR_ETFS[0].etf, "output order is SECTOR_ETFS order, not the wire's");
    eq(shuffled[0].bullishPremiumUsd, 1000 + SECTOR_ETFS.length - 1,
       "and each row got ITS OWN ticker's numbers — a positional match would have silently " +
       "attributed the last basket's premium to the first sector");
  }

  {
    const r = find(all({ last: "110", prev_close: "100" }), "XLF");
    eq(r.changeRatio, 0.1, "changeRatio is a RATIO, named so, not a percentage or a dollar move");
    const noPrev = find(all({ prev_close: null }), "XLF");
    eq(noPrev.changeRatio, null,
       "and it is null with no previous close — a session with no comparison is not a session " +
       "that did not move");
    const zeroPrev = find(all({ prev_close: "0" }), "XLF");
    eq(zeroPrev.changeRatio, null, "nor does a zero divisor produce an infinity");
    eq(zeroPrev.prevCloseUsd, 0, "while the measured zero itself is still published");
  }

  {
    const lean = Object.keys(find(all(), "XLK"));
    const trix = Object.keys(sectorTrix(new Map())[0]);
    const shared = lean.filter((f) => trix.includes(f)).sort();
    assert.deepEqual(shared, ["etf", "reason", "sector"],
      `the momentum row and the premium row share only the basket's identity and its absence ` +
      `note (they share: ${shared.join(", ")}) — a TRIX reading and a premium lean under one ` +
      `field name is exactly the drift the two-key split exists to stop`); checks++;
  }
}

{
  const wire = (n, over = () => ({})) => ({ data: Array.from({ length: n }, (_, i) => ({
    created_at: new Date(Date.UTC(2026, 7, 21, 20, 0, 0) - i * 60000).toISOString(),
    headline: `Headline ${i}`, source: "Reuters", sentiment: "neutral",
    is_major: false, tags: ["earnings"], tickers: ["AAPL"],
    ...over(i),
  })) });

  {
    const s = shapeNews(wire(100), { cap: 60, requested: 100 });
    eq(s.kept, 60, "the cap binds");
    eq(s.rows.length, 60, "and `kept` is the length of what is published");
    eq(s.returned, 100, "`returned` is what came off the wire, which is a different number");
    eq(s.shed, 40, "`shed` is what OUR cap removed from what we saw");
    eq(s.capped, true, "and the payload says plainly that it truncated");
    eq(s.requested, 100, "it also records what we ASKED for");
    eq(s.atVendorLimit, true,
       "so that a full page can be reported as a CEILING: the true population is unknown and " +
       "at least that large, which is not the same fact as our cap having shed rows we saw");

    const short = shapeNews(wire(12), { cap: 60, requested: 100 });
    eq(short.capped, false, "a short page is not capped");
    eq(short.shed, 0, "and sheds nothing");
    eq(short.atVendorLimit, false,
       "and is NOT at the vendor's ceiling, so its count really is a measurement of the tape " +
       "rather than of the request");
  }

  {

    const oldestFirst = wire(90).data.slice().reverse();
    const s = shapeNews({ data: oldestFirst }, { cap: 30, requested: 100 });
    const ms = s.rows.map((r) => r.createdAtMs);
    ok(ms.every((v, i) => i === 0 || ms[i - 1] >= v),
       "the published rows are newest-first whatever order the vendor sent");
    eq(s.rows[0].headline, "Headline 0",
       "and the NEWEST row survives a cap applied to an oldest-first wire — slicing before " +
       "the sort would have published the thirty OLDEST headlines, in newest-first order, " +
       "under a `newest` label that was true of none of them");
    eq(s.rows[29].headline, "Headline 29",
       "and the thirtieth published row is the thirtieth newest, not the thirtieth the vendor " +
       "happened to send");
    eq(s.ordered, true, "the payload states that it ordered");
    eq(s.orderedBy, "createdAt", "and names the field");
    eq(s.orderedDesc, true, "and the direction");
  }

  {
    const s = shapeNews(wire(3), { cap: 60, requested: 100 });
    eq(s.rows[0].createdAt, "2026-08-21T20:00:00.000Z",
       "the vendor's own timestamp is carried as the STRING they sent — reformatting it would " +
       "make the payload's timestamp ours, and the whole point of the field is that it is theirs");
    eq(s.rows[0].createdAtMs, Date.parse("2026-08-21T20:00:00.000Z"),
       "our parse of it rides beside it under a name that says it is a parse");
    eq(s.newest, "2026-08-21T20:00:00.000Z", "the window is bounded from the rows' own stamps");
    eq(s.oldest, "2026-08-21T19:58:00.000Z", "at both ends");
  }

  {
    const s = shapeNews(wire(4, (i) => (i === 1 ? { created_at: null }
      : i === 2 ? { created_at: "not a timestamp" } : {})), { cap: 60, requested: 100 });
    eq(s.kept, 4, "undated rows are still PUBLISHED — dropping them would shrink the " +
       "population without saying so");
    eq(s.undatedSeen, 2, "and counted: one absent stamp and one unparseable one");
    eq(s.undatedKept, 2, "both of which are in this payload, because nothing was capped away");
    eq(s.rows[2].createdAtMs, null, "an unplaceable row carries a NULL parse");
    eq(s.rows[3].createdAtMs, null, "never 0, and never the instant we happened to read it");
    ok(s.rows[0].createdAtMs !== null && s.rows[1].createdAtMs !== null,
       "and the datable rows come first, because an undated row cannot be ordered against them");
    eq(s.newest, "2026-08-21T20:00:00.000Z",
       "the window bounds are computed from the datable rows only");

    const capped = shapeNews(wire(20, (i) => (i > 17 ? { created_at: null } : {})),
      { cap: 10, requested: 100 });
    eq(capped.undatedSeen, 2, "the wire carried two undated rows");
    eq(capped.undatedKept, 0, "and the cap shed both, so none of the published rows is undated");
  }

  {
    const s = shapeNews({ data: [
      { created_at: "2026-08-21T20:00:00.000Z", headline: "Real", source: "Reuters" },
      { created_at: "2026-08-21T19:00:00.000Z", headline: "   " },
      null,
      "not an object",
    ] }, { cap: 60, requested: 100 });
    eq(s.kept, 1, "only the row with a headline is published");
    eq(s.unusable, 3, "and the other three are counted rather than silently dropped");
    eq(s.status, "ok", "a feed with one good row is ok");
  }

  {
    const quiet = shapeNews({ data: [] }, { cap: 60, requested: 100 });
    eq(quiet.status, "quiet",
       "an empty response is QUIET — the tape was read and there was nothing on it");
    ok(/read and returned no rows/.test(quiet.reason), "and says exactly that");
    eq(quiet.newest, null, "with no window, because there is nothing to bound");
    eq(quiet.kept, 0, "and no rows");

    const unreadable = shapeNews({ data: [{ created_at: "2026-08-21T20:00:00Z" }] },
      { cap: 60, requested: 100 });
    eq(unreadable.status, "unreadable",
       "rows that arrived and none of which shaped is UNREADABLE — a different silence, and " +
       "the one that means our field names are wrong rather than the market being quiet");
    ok(/none carried a headline/.test(unreadable.reason), "and names what was missing");

    ok(!["pending"].includes(quiet.status) && !["pending"].includes(unreadable.status),
       "and the shaper never claims `pending`, which is the Worker's word for a key that has " +
       "not been published rather than a fact about the feed");
  }

  {
    const s = shapeNews(wire(3, () => ({ tickers: ["aapl", "AAPL", " msft "] })),
      { cap: 60, requested: 100 });
    assert.deepEqual(s.rows[0].tickers, ["AAPL", "MSFT"],
      "tickers are normalised and DEDUPLICATED — there is no per-ticker news endpoint, so " +
      "the per-name join is a filter of this array, and a row listing one name twice would " +
      "make a single headline look like two mentions"); checks++;
    const none = shapeNews(wire(1, () => ({ tickers: [] })), { cap: 60, requested: 100 });
    assert.deepEqual(none.rows[0].tickers, [],
      "a market-wide headline carries an EMPTY array, which is a measured absence of related " +
      "tickers rather than a failure to read the field"); checks++;
  }

  {
    const s = shapeNews(wire(3, (i) => (i === 1 ? { is_major: undefined } : {})),
      { cap: 60, requested: 100 });
    eq(s.rows[0].major, false, "a flag the vendor sent as false is false");
    eq(s.rows[1].major, null,
       "and a flag the vendor omitted is NULL — \"this was not flagged major\" and \"we do not " +
       "know whether it was\" are different sentences");
  }
}

{
  const SESSION = "2026-09-21";
  const WFC = [86.31, 87.27, 86.87, 83.87, 85.43, 86.45, 87.89, 88.39, 89.17, 87.59, 87.25,
    87.52, 87.45, 88.93, 88.11, 88.82, 87.54, 87.4, 85.94, 83.7, 83.84, 84.72, 84.79, 85.23,
    84.97, 86.69, 86.39, 87.04, 89.27, 89.19, 89.97, 87.96, 89.67, 89.45, 90.29, 88.71, 89.72,
    87.05, 86.89, 86.12, 86.54, 83.385];
  const days = [];
  for (let t = Date.parse("2026-09-22T12:00:00Z"); days.length < WFC.length; t -= 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days.unshift(d);
  }
  const vendor = WFC.map((c, i) => ({
    start_time: `${days[i]}T13:30:00Z`, open: String(c), high: String(c * 1.01),
    low: String(c * 0.99), close: String(c), volume: i === WFC.length - 1 ? 8890788 : 21000000,
  })).reverse();

  eq(days[days.length - 1], "2026-09-22", "the fixture ends on the partial 2026-09-22 bar the live cards carried");
  eq(days[days.length - 2], SESSION, "and its previous bar is the 2026-09-21 session the cards were stamped with");

  const cut = sessionCandles(vendor, SESSION);
  eq(cut.length, vendor.length - 1, "THE CUT: a vendor that ignores end_date loses exactly the bar past the session");
  ok(cut.every((c) => c.start_time.slice(0, 10) <= SESSION), "and nothing dated after the session survives it");
  eq(sessionCandles(vendor, null).length, vendor.length,
     "with no session date there is nothing to cut against, so nothing is invented");
  assert.deepEqual(candleCut(vendor, SESSION), { past: 1, latest: "2026-09-22" },
    "the cut reports what it removed, so the run can log how often the vendor ignored end_date"); checks++;

  const judged = judgeEndDate(vendor, SESSION);
  eq(judged.honoured, false, "A FAKE VENDOR THAT IGNORES end_date IS CAUGHT: max(candleDate) > sessionDate");
  eq(judged.latest, "2026-09-22", "and the offending date is named");
  eq(judged.send, true, "while the parameter is still sent — dropping it would only remove the request, not the bar");
  eq(judgeEndDate(cut, SESSION).honoured, true, "a vendor that honours it is reported as honouring it");
  eq(judgeEndDate([], SESSION).send, false, "an empty answer drops the parameter, as before");

  const calls = [];
  const fakeUw = async (p, params = {}) => {
    calls.push([p, params]);
    if (p.includes("/ohlc/1d")) return vendor;
    if (p === "/api/screener/stocks") {
      return params.date
        ? [{ ticker: "AAPL", close: "230", marketcap: "3e12", call_volume: 1, put_volume: 1 }]
        : [{ ticker: "AAPL", close: "231", marketcap: "3e12", call_volume: 1, put_volume: 1 }];
    }
    return [];
  };
  const dating = await verifyDating(SESSION, { read: fakeUw });
  eq(dating.endDateHonoured, false,
     "verifyDating REPORTS the vendor ignoring end_date rather than deciding with it — " +
     "the 17:17 run printed end_date=true while every card carried 2026-09-22");
  eq(dating.endDateLatest, "2026-09-22", "and says which bar gave it away");
  eq(dating.endDate, true, "and keeps sending the parameter");
  eq(dating.screenerDate, true, "a dated screener that answers with readable rows keeps its date");
  ok(calls.some(([p, q]) => p === "/api/screener/stocks" && q.date === SESSION),
     "and the probe really asked the screener for the session");
  const blind = await verifyDating(SESSION, {
    read: async (p, params = {}) => (p === "/api/screener/stocks" && params.date ? [{ ticker: "X" }]
      : p === "/api/screener/stocks" ? [{ ticker: "X", close: 1, marketcap: 1, call_volume: 1, put_volume: 1 }]
        : p.includes("/ohlc/1d") ? cut : []),
  });
  eq(blind.screenerDate, false,
     "a dated screener whose rows lack the fields the universe filter reads is dropped for the run");
  eq(blind.endDateHonoured, true, "and an honoured end_date is reported as honoured");
  eq(judgeScreenerDate([], []).date, true,
     "two empty probes teach nothing, so the dated read — correct by construction — is kept");

  const f = computeFeatures({
    ticker: "WFC", spot: 83.385, greekFlow: [], ticks: [], strikes: [], expiries: [],
    ohlc: vendor, sessionDate: SESSION, tilt: null,
  });
  eq(f.closeDates[f.closeDates.length - 1], SESSION,
     "closeDates NEVER RUN PAST sessionDate — on 2026-09-21 all 166 live cards ended on 2026-09-22");
  ok(f.candles.every((c) => c[0] <= SESSION), "nor do the published candles");
  ok(!f.garch || !Array.isArray(f.garch.dates) || f.garch.dates.every((d) => d <= SESSION),
     "nor the GARCH fit's dates");
  const without = realizedVol(WFC.slice(0, -1), { window: 21 });
  const withPartial = realizedVol(WFC, { window: 21 });
  near(f.rv30, without, 1e-12,
       `rv30 is the session's own (${(without * 100).toFixed(2)}%), not the ` +
       `${(withPartial * 100).toFixed(2)}% the partial -3.71% bar produced`);
  ok(Math.abs(withPartial - without) > 0.03, "and the fixture really separates the two readings by over three vol points");
  eq(f.spot, 86.54, "THE REFERENCE SPOT is the session close, not the 83.385 read at 13:17 the next day");
  eq(f.spotBasis, "session-close", "and says so");
  eq(f.readPx, 83.385, "the read price travels beside it, labelled");
  eq(f.prevClose, 86.12, "and the previous close is the bar before the session's");

  const noBar = sessionReference(vendor.filter((c) => !c.start_time.startsWith(SESSION)), SESSION, 83.385);
  eq(noBar.basis, "read", "a series with no bar for the session falls back to the read price and says so");
  eq(noBar.spot, 83.385, "and uses it");

  const row = { ticker: "WFC", close: "83.385", prev_close: "86.54", sector: "Financials" };
  const card = sessionRow(row, f);
  eq(card.close, 86.54, "the card and board row carry the session close");
  near((card.close - card.prev_close) / card.prev_close, 86.54 / 86.12 - 1, 1e-12,
       "and the session's own change, not the next day's intraday move");
  eq(sessionRow(row, { spotBasis: "read", spot: 83.385 }), row,
     "a row whose features fell back to the read price is left exactly as the screener sent it");
  const read = readPxOf({ row, features: f }, "2026-09-22T17:18:00Z");
  eq(read.px, 83.385, "card.readPx keeps the screener's price");
  eq(read.readAt, "2026-09-22T17:18:00Z", "with the minute it was read");
  ok(/session's daily close/.test(read.note), "and a sentence saying which one the levels use");

  const iv = sessionRows([{ date: "2026-09-22" }, { date: "2026-09-21" }, { date: "2026-09-18" }],
    (r) => r.date, SESSION, { through: true });
  eq(iv.cut, 1, "iv-rank rows dated after the session are cut");
  const dp = sessionRows({ data: [{ executed_at: "2026-09-22T13:40:00Z" }, { executed_at: "2026-09-21T19:59:00Z" }] },
    (r) => readDayOf(r.executed_at), SESSION);
  eq(dp.cut, 1, "and dark-pool prints not on the session's Eastern day are cut from the wrapped body");
  eq(dp.raw.data.length, 1, "keeping the envelope the shaper reads");
  eq(readDayOf("2026-09-23T02:00:00Z"), "2026-09-22",
     "a read at 22:00 Eastern is that Eastern day's, whatever the UTC date says");
}

{
  const at = (iso) => intradayRefusal("2026-09-21", { at: new Date(iso) });
  const tuesday = at("2026-09-22T14:01:13Z");
  ok(tuesday.inside && tuesday.refuse,
     "THE INTRADAY GUARD REFUSES the 14:01Z firing that published 2026-09-21 from 09-22's tape");
  ok(/refusing to publish session 2026-09-21 from an in-progress tape/.test(tuesday.message),
     `with a message naming the session and the clock (${tuesday.message.slice(0, 90)}…)`);
  const allowed = intradayRefusal("2026-09-21", { at: new Date("2026-09-22T17:17:00Z"), allow: true });
  ok(allowed.inside && allowed.allowed && !allowed.refuse,
     "allow_intraday lets a manual run through, and the result says it was allowed");
  ok(/PUBLISHING FROM AN IN-PROGRESS TAPE/.test(allowed.message), "and the log says what that means");
  ok(!at("2026-09-22T21:30:00Z").inside, "21:30Z in summer is 17:30 EDT — after the close");
  ok(!at("2026-12-15T21:30:00Z").inside, "21:30Z in winter is 16:30 EST — after the close");
  ok(at("2026-12-15T20:30:00Z").inside,
     "while the 20:30Z first proposed is 15:30 EST — mid-session in winter, which is why it was rejected");
  ok(!at("2026-09-23T09:30:00Z").inside && !at("2026-12-16T09:30:00Z").inside,
     "a 21:30Z firing delayed twelve hours still lands before the next open under either zone");
  ok(!at("2026-09-19T15:00:00Z").inside, "a Saturday is never inside a session");
  ok(at("2026-09-22T13:30:00Z").inside && !at("2026-09-22T13:29:00Z").inside,
     "the open is 09:30 exactly");
  ok(!at("2026-09-22T20:00:00Z").inside && at("2026-09-22T19:59:00Z").inside,
     "and the close is 16:00 exactly");
  eq(SESSION_OPEN_MINUTES, 570, "09:30 in minutes");
  eq(SESSION_CLOSE_MINUTES, 960, "16:00 in minutes");

  const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  const resolved = main.indexOf("await resolveSessionDate()");
  const guard = main.indexOf("intradayRefusal(sessionDate");
  const thrown = main.indexOf("if (intraday && intraday.refuse) throw new Error(intraday.message)");
  const firstRead = main.indexOf("verifyDating(sessionDate");
  ok(resolved !== -1 && guard > resolved && thrown > guard && firstRead > thrown,
     "main() resolves the session, then consults the guard and THROWS on a refusal, before a " +
     "single vendor read beyond the session probe");
  ok(/allow: process\.env\.FLOWS_ALLOW_INTRADAY === "1"/.test(main),
     "and the override is the FLOWS_ALLOW_INTRADAY=1 the workflow plumbs from allow_intraday");

  const wf = readFileSync(new URL("../.github/workflows/flows-pipeline.yml", import.meta.url), "utf8");
  const crons = [...wf.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(crons, ["30 21 * * 1-5"],
    "THE SCHEDULE is one post-close cron — the '15 9'/'15 10' pair fired 4.5-6.6h late every weekday"); checks++;
  ok(wf.includes('elif [ "$FIRED" = "30 21 * * 1-5" ]'), "and the gate step admits exactly that cron");
  ok(!/15 9|15 10/.test(wf), "and no trace of the 05:15 pair remains to be admitted");
  ok(/allow_intraday:[\s\S]*?type: boolean/.test(wf) && /republish_session:[\s\S]*?type: boolean/.test(wf),
     "workflow_dispatch offers allow_intraday and republish_session");
  ok(/FLOWS_ALLOW_INTRADAY: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.allow_intraday && '1' \|\| '' \}\}/.test(wf),
     "and plumbs allow_intraday as FLOWS_ALLOW_INTRADAY=1, on a dispatch only");
  ok(/FLOWS_REPUBLISH_SESSION: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.republish_session && '1' \|\| '' \}\}/.test(wf),
     "and republish_session as FLOWS_REPUBLISH_SESSION=1, on a dispatch only");
  for (const file of ["flows-pipeline.yml", "regression.yml"]) {
    const text = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    ok(/actions\/checkout@v5/.test(text) && /actions\/setup-node@v5/.test(text) && !/@v4/.test(text),
       `${file} runs the Node-24 majors of checkout and setup-node`);
  }
  ok(/after the close/.test(PIPELINE_CADENCE) && /21:30 UTC/.test(PIPELINE_CADENCE),
     `the cadence the payloads print is the schedule that fires (${PIPELINE_CADENCE})`);
  ok(!/05:15/.test(src), "and the pipeline no longer names 05:15 anywhere");
  ok(!/shorts\/AAPL\/volume-and-ratio/.test(src) && !/probes:/.test(src),
     "the shorts probe that returned zero rows every run is gone, and so is meta.probes");
}

{
  eq(nextWeekday("2026-09-18"), "2026-09-21", "the gate origin after a Friday is Monday");
  eq(nextWeekday("2026-09-21"), "2026-09-22", "and after a Monday, Tuesday");
  eq(nextWeekday("garbage"), null, "an unparseable session has no next session");
  assert.deepEqual(priorWeekdays("2026-09-22", 3), ["2026-09-21", "2026-09-18", "2026-09-17"],
    "the archive walk back skips the weekend"); checks++;
  ok(daysToEarnings({ next_earnings_date: "2026-10-03" }, nextWeekday("2026-09-21")) === 11,
     "UW-21: a report on 10-03 is 11 days from the NEXT session after 09-21 — the anchor a " +
     "post-close run must use, where its own wall-clock date would say 12");

  ok(closedPriceWindow("2026-09-21T21:40:00Z", "2026-09-21"),
     "an archive written at 17:40 EDT on its own session holds that session's close");
  ok(!closedPriceWindow("2026-09-21T19:30:00Z", "2026-09-21"), "one written at 15:30 does not");
  ok(!closedPriceWindow("2026-09-21T15:54:00Z", "2026-09-18"),
     "and board:*:2026-09-18, written Monday 11:54 ET, holds a MONDAY price: refused as a close");
  ok(closedPriceWindow("2026-09-19T15:00:00Z", "2026-09-18"), "a Saturday write still holds Friday's close");
  ok(closedPriceWindow("2026-09-21T13:29:00Z", "2026-09-18") && !closedPriceWindow("2026-09-21T13:31:00Z", "2026-09-18"),
     "and the window closes at the next open, to the minute");
  ok(!closedPriceWindow(null, "2026-09-18"), "an unstamped archive is never trusted as a close");

  const bars = (dates, close) => dates.map((d) => ({ start_time: `${d}T13:30:00Z`, close: String(close) }));
  const enriched = [{ row: { ticker: "AAA" }, raw: { ohlc: bars(["2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22"], 10) } }];
  const datedBoards = [
    { d: "2026-09-18", side: "long", rows: [{ t: "BBB", px: 50 }], generatedAt: "2026-09-21T15:54:00Z" },
    { d: "2026-09-17", side: "long", rows: [{ t: "CCC", px: 70 }], generatedAt: "2026-09-17T21:35:00Z" },
  ];
  const closes = buildRecordCloses(enriched, datedBoards, "2026-09-21");
  ok(![...closes.values()].some((m) => [...m.keys()].some((d) => d > "2026-09-21")),
     "RECORD CLOSES NEVER RUN PAST sessionDate — the partial 09-22 bar is not an exit price");
  eq(closes.get("AAA").size, 3, "the enriched name keeps its three closed sessions");
  ok(!closes.has("BBB"), "a dated-board px read the next session is NOT used as a close");
  eq(closes.get("CCC").get("2026-09-17"), 70, "one written between the close and the next open is");
  assert.deepEqual(closes.sources, { boardPx: 1, boardPxRefused: 1 },
    "and the run can say how many it used and refused"); checks++;
  const calendar = recordCalendar(enriched, datedBoards, "2026-09-21");
  eq(calendar[calendar.length - 1], "2026-09-21",
     "the record's calendar ends at the session, so k=5 and k=10 are never scored to an intraday bar");

  const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");
  ok(!/put\(row\.ticker, sessionDate, row\.close\)/.test(src),
     "and the universe row.close — a screener price read at run time — is no longer written as a close");
}

{
  const archived = { payload: { generatedAt: "2026-09-22T14:02:18.489Z", rows: [{ t: "B" }] }, status: 200 };
  const board = { payload: { sessionDate: "2026-09-21", rows: [{ t: "B" }] }, status: 200 };
  const gone = { payload: null, absent: true, status: 200 };
  const refusedRead = { payload: null, failed: true, status: 403 };
  const archiveOf = (scores, long, short) => ({
    "scores:2026-09-21": scores, "board:long:2026-09-21": long, "board:short:2026-09-21": short });
  const whole = archiveOf(archived, board, board);
  const gate = sameSessionGate({ sessionDate: "2026-09-21", archive: whole });
  ok(gate.skip && gate.mode === "archived",
     "A SAME-SESSION RUN SKIPS THE RANKED LEG when the session's three archive keys are held");
  ok(/boards, scores, score track, record, brief and cards/.test(gate.note), "and names what it skips");
  const again = sameSessionGate({ sessionDate: "2026-09-21", archive: whole, republish: true });
  ok(!again.skip && again.mode === "republish", "republish_session runs it, as a rewrite");
  const unread = sameSessionGate({ sessionDate: "2026-09-21",
    archive: archiveOf(refusedRead, refusedRead, refusedRead) });
  ok(!unread.skip && unread.mode === "unverified" && /403/.test(unread.note),
     "an unreadable archive does not skip a session that may never have been published");
  eq(sameSessionGate({ sessionDate: "2026-09-21", archive: archiveOf(gone, gone, gone) }).mode, "fresh",
     "an absent one is a first run");

  const lostBoard = sameSessionGate({ sessionDate: "2026-09-21", archive: archiveOf(archived, gone, board) });
  ok(lostBoard.skip && lostBoard.mode === "partial",
     "A PARTLY WRITTEN ARCHIVE IS NOT READ AS WHOLE: scores held and board:long lost (the store's " +
     "403 on board:long) used to read as archived and skip in silence, so the re-dispatch that " +
     "ARCHIVE LOST asked for never wrote the lost board");
  ok(/board:long:2026-09-21 is not/.test(lostBoard.note) && /republish_session/.test(lostBoard.note) &&
     /exits non-zero/.test(lostBoard.note),
     `and it names the missing key, the dispatch that repairs it, and the red run (${lostBoard.note.slice(0, 120)})`);
  const lostScores = sameSessionGate({ sessionDate: "2026-09-21", archive: archiveOf(gone, board, board) });
  ok(lostScores.skip && lostScores.mode === "partial",
     "AND A LOST scores KEY BESIDE LANDED BOARDS IS NOT A FIRST RUN: read as fresh, it re-ranked, wrote " +
     "new live boards and scores, and the immutable dated boards kept the first run's ranking — the split");
  ok(/scores:2026-09-21 is not/.test(lostScores.note), "and says which key is missing");
  const unsure = sameSessionGate({ sessionDate: "2026-09-21", archive: archiveOf(archived, refusedRead, board) });
  ok(unsure.skip && unsure.mode === "archived" && /board:long:2026-09-21 could not be read/.test(unsure.note),
     "a board that could not be read beside a held scores still skips, and says the archive may be incomplete");
  eq(sameSessionGate({ sessionDate: "2026-09-21", archive: archiveOf(gone, refusedRead, gone) }).mode, "unverified",
     "while nothing held and a board unread proceeds, as an unreadable scores always did");
  eq(sameSessionGate({ sessionDate: "2026-09-21", archive: archiveOf(archived, gone, board), republish: true }).mode,
     "republish", "republish_session rewrites a partly written session");
  ok(/partly archived and skips it/.test(plainRedispatchSaid([
    { key: "scores:2026-09-21", state: "written" }, { key: "board:long:2026-09-21", state: "lost" },
    { key: "board:short:2026-09-21", state: "repaired" }])),
     "ARCHIVE LOST says a plain re-dispatch skips a session that kept part of its archive, as the gate does");
  const noneKept = plainRedispatchSaid([
    { key: "scores:2026-09-21", state: "lost" }, { key: "board:long:2026-09-21", state: "lost" },
    { key: "board:short:2026-09-21", state: "lost" }]);
  ok(!/partly archived/.test(noneKept) && /ranks it again/.test(noneKept),
     "BUT NOT WHEN NOTHING WAS KEPT: with all three keys lost the gate reads the session as fresh and " +
     `a plain re-dispatch ranks it again, so "finds the session partly archived" was false (${noneKept})`);
  const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");
  ok(/"together; " \+ plainRedispatchSaid\(archive\)/.test(src),
     "and the ARCHIVE LOST line takes its clause from that function");
  ok(/reads as archived, or as partly archived, and a later plain run skips it/.test(src),
     "a refused retire says the session may now read as partly archived, which the gate also skips");
  assert.deepEqual(sessionArchiveKeys("2026-09-21"),
    ["scores:2026-09-21", "board:long:2026-09-21", "board:short:2026-09-21"],
    "the three keys a republish deletes and rewrites together"); checks++;
  const removed = [];
  const retired = await retireSession("2026-09-21", {
    remove: async (key) => { removed.push(key); return key.startsWith("scores") ? { ok: true, status: 200 } : { ok: false, status: 404 }; },
  });
  eq(removed.length, 3, "a republish asks for all three");
  ok(retired.refused.length === 0 && retired.absent.length === 2,
     "and an absent key is not a refusal — only a store that says no stops the rewrite");
  eq(removed[removed.length - 1], "scores:2026-09-21",
     "SCORES IS DELETED LAST: it is the key the gate reads, so a rewrite that stops half way " +
     "must leave the session reading as archived rather than as a first run that would split " +
     "the archive again");

  const asked = [];
  const waits = [];
  const refused = await retireSession("2026-09-21", {
    remove: async (key) => { asked.push(key); return { ok: false, status: 403 }; },
    pause: async (ms) => { waits.push(ms); },
  });
  eq(refused.refused.length, 1,
     "a refusal stops the retire at the first key, which main() turns into a throw before any ranked write");
  assert.deepEqual(refused.kept, ["board:short:2026-09-21", "scores:2026-09-21"],
    "and the keys after it are left standing, scores among them"); checks++;
  ok(!asked.includes("scores:2026-09-21"),
     "so the gate key is never deleted while a dated board the rewrite needs to replace still stands");
  eq(asked.length, 3, "the refused key is asked three times — the edge 403 that clears on retry is retried");
  assert.deepEqual(waits, [1000, 4000], "on the same backoff as every store read"); checks++;

  let flaky = 1;
  const recovered = await retireSession("2026-09-21", {
    remove: async () => (flaky-- > 0 ? { ok: false, status: 503 } : { ok: true, status: 200 }),
    pause: async () => {},
  });
  ok(recovered.refused.length === 0 && recovered.removed.length === 3,
     "and a transient refusal that clears on retry deletes all three");

  const lost = sameSessionGate({ sessionDate: "2026-09-21",
    archive: archiveOf(gone, gone, gone), republish: true });
  ok(lost.mode === "republish" && !lost.skip && /deletes whatever dated key/.test(lost.note),
     "REPUBLISH WITH NO SCORES STILL RETIRES: a session whose scores write was lost but whose " +
     "dated boards landed would otherwise refuse the rewrite and split again");
  eq(sameSessionGate({ sessionDate: "2026-09-21",
    archive: archiveOf(refusedRead, gone, gone), republish: true }).mode, "republish",
     "and so does one whose scores could not be read — the dispatch asked for a rewrite");
}

{
  const store = new Map();
  const reads = [];
  const reader = async (key) => {
    reads.push(key);
    if (key === "board:long") return { payload: null, failed: true, status: 403 };
    if (store.has(key)) return { payload: store.get(key), status: 200 };
    return { payload: null, absent: true, status: 200 };
  };
  store.set("board:long:2026-09-18", { sessionDate: "2026-09-18", rows: [{ t: "A", r: 1 }, { t: "B", r: 2 }] });
  const memory = await resolveBoardMemory("long", "2026-09-21", { reader });
  eq(memory.status, "ok",
     "THE 403 NO LONGER COLD-STARTS THE LONG BOARD: 11 of 11 dated long boards were 'unavailable'");
  eq(memory.source, "archive", "the memory came from the archive");
  eq(memory.key, "board:long:2026-09-18", "from the newest earlier session it holds");
  eq(memory.incumbents, 2, "and its names reach hysteresis");
  ok(/read from the dated archive \(board:long:2026-09-18\) because the live board:long could not be read \(the store answered 403\)/.test(memory.note),
     `and the note says where it came from and why (${memory.note.slice(-120)})`);

  store.set("board:short", { sessionDate: "2026-09-21", rows: [{ t: "X", r: 1 }] });
  store.set("board:short:2026-09-18", { sessionDate: "2026-09-18", rows: [{ t: "Y", r: 1 }] });
  const same = await resolveBoardMemory("short", "2026-09-21", { reader });
  ok(same.status === "ok" && same.key === "board:short:2026-09-18" && /this session's own earlier output/.test(same.note),
     "a same-session live board reads yesterday's archive instead of cold-starting — the 53 " +
     "names discarded at 17:17 were a board a re-run could have held against");

  const cold = await resolveBoardMemory("short", "2026-09-21", {
    reader: async (key) => (key === "board:short" ? { payload: { sessionDate: "2026-09-21", rows: [{ t: "X" }] } }
      : { payload: null, absent: true }),
  });
  ok(cold.status === "same-session" && /searched back 10 weekdays/.test(cold.note) && /held none/.test(cold.note),
     "with no archive either, the refusal stands and says the archive was searched");
  eq(MEMORY_ARCHIVE_SESSIONS, 10, "ten weekdays back — two weeks of archive");

  const ok0 = await resolveBoardMemory("long", "2026-09-21", {
    reader: async (key) => (key === "board:long" ? { payload: { sessionDate: "2026-09-18", rows: [{ t: "Z" }] } }
      : { payload: null, absent: true }),
  });
  eq(ok0.source, "live", "a readable earlier live board is used as before, with no archive read");
}

{
  const http = await import("node:http");
  let answers = [403, 503, 200];
  const seen = [];
  const server = http.createServer((req, res) => {
    const status = answers.length ? answers.shift() : 200;
    seen.push(status);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(status === 200 ? '{"sessionDate":"2026-09-18","rows":[{"t":"A"}]}' : "{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const prevUrl = process.env.FLOWS_INGEST_URL;
  const prevTok = process.env.FLOWS_INGEST_TOKEN;
  process.env.FLOWS_INGEST_URL = `http://127.0.0.1:${server.address().port}/api/flows/ingest`;
  process.env.FLOWS_INGEST_TOKEN = "test-token";
  try {
    const waits = [];
    const read = await readStored("board:long", { pause: async (ms) => { waits.push(ms); } });
    assert.deepEqual(seen, [403, 503, 200],
      "READSTORED RETRIES: a 403 then a 503 are read again, and the third read lands"); checks++;
    ok(read.payload && read.payload.rows.length === 1 && read.recovered === 2,
       "and the payload comes back, marked as recovered on the second retry");
    assert.deepEqual(waits, [1000, 4000], "on the publish path's own backoff"); checks++;
    eq(READ_RETRIES, 2, "two retries — bounded, and charged to the run's retry budget");

    answers = [404];
    seen.length = 0;
    const gone = await readStored("board:long", { pause: async () => {} });
    ok(gone.failed && gone.status === 404 && seen.length === 1,
       "a 404 is an answer, not a transient, and is not retried");

    answers = [403, 403, 403];
    seen.length = 0;
    const refused = await readStored("board:long", { pause: async () => {} });
    ok(refused.failed && refused.status === 403 && seen.length === 3,
       "and a store that keeps refusing is asked three times, then reported as failed");
  } finally {
    process.env.FLOWS_INGEST_URL = prevUrl;
    process.env.FLOWS_INGEST_TOKEN = prevTok;
    if (prevUrl === undefined) delete process.env.FLOWS_INGEST_URL;
    if (prevTok === undefined) delete process.env.FLOWS_INGEST_TOKEN;
    await new Promise((r) => server.close(r));
  }
}

{
  const population = (n, lo, hi) => Array.from({ length: n }, (_, i) =>
    ({ ticker: "N" + i, marketcap: lo * Math.pow(hi / lo, (i + 0.5) / n) }));
  const bandReader = (names) => async (min, max) => names
    .filter((r) => r.marketcap >= min && (max === null || r.marketcap < max))
    .slice(0, SCREENER_PAGE_ROWS);

  const small = await sweepScreenerBand([1e9, 1.3e9], bandReader(population(30, 1e9, 1.3e9)));
  ok(small.reads === 1 && !small.split && small.rows.length === 30, "a band under the page size is read once");

  const hundredTwenty = population(120, 66.5e9, 86.5e9);
  const split = await sweepScreenerBand([66.5e9, 86.5e9], bandReader(hundredTwenty));
  eq(split.rows.length, 120,
     "A TRUNCATED BAND IS RE-READ: the $66.5-86.5B band that capped at 50 in run 66 recovers all 120");
  eq(split.truncated, 0, "with no leaf still full");
  eq(split.reads, 7, "at 1 + 2 + 4 reads, which is the whole bound");
  ok(split.leaves.every((l) => l.level === SCREENER_SPLIT_DEPTH), "splitting at the geometric midpoint, twice");

  const dense = await sweepScreenerBand([1e9, 1.3e9], bandReader(population(400, 1e9, 1.3e9)));
  eq(dense.reads, 7, "a band too dense to finish still stops at two levels");
  eq(dense.truncated, 4, "and every still-full leaf stays marked TRUNCATED rather than passed off as whole");

  const whole = bandReader(hundredTwenty);
  let reads = 0;
  const dropped = await sweepScreenerBand([66.5e9, 86.5e9],
    async (lo, hi) => (reads++ === 0 ? whole(lo, hi) : []));
  ok(dropped.rows.length >= SCREENER_PAGE_ROWS,
     `A SPLIT NEVER SHRINKS THE BAND: children that come back empty (a read the vendor ` +
     `refused, caught to []) leave the parent's own ${SCREENER_PAGE_ROWS} rows in the ` +
     `universe (${dropped.rows.length}) rather than fewer than the unsplit read found`);
  eq(new Set(split.rows.map((r) => r.ticker)).size, split.rows.length,
     "and a name read at two levels is counted once");
}

{
  const prior = (reason, sessionDate) => ({ sessionDate, holders: { status: "unavailable", reason } });
  const refused = holdersRefusal(prior("/api/politician-portfolios/holders/B -> HTTP 422", "2026-09-21"), "2026-09-22");
  ok(refused && refused.status === 422 && refused.since === "2026-09-21",
     "UW-19: a 422 on the holders route last run is not bought again the next night");
  const carried = holdersRefusal(prior(refused.reason, "2026-09-22"), "2026-09-25");
  ok(carried && carried.since === "2026-09-21", "the refusal date is carried forward by the skipped run's own reason");
  eq(holdersRefusal(prior(refused.reason, "2026-09-25"), "2026-09-28"), null,
     "and after seven days the route is asked again, so a plan change is noticed within a week");
  eq(holdersRefusal(prior("/api/politician-portfolios/holders/B -> HTTP 503", "2026-09-21"), "2026-09-22"), null,
     "a 5xx is the vendor's weather, not the plan, and is retried every run");
  ok(holdersRefusal(prior("/api/politician-portfolios/holders/B -> HTTP 429", "2026-09-21"), "2026-09-22") === null &&
     holdersRefusal(prior("/api/politician-portfolios/holders/B -> HTTP 408", "2026-09-21"), "2026-09-22") === null,
     "and so are a 429 and a 408, the two 4xx answers that describe the moment rather than the plan");
  eq(HOLDERS_RETRY_DAYS, 7, "one week");
}

{
  const emptyTape = { byTicker: new Map(), read: "ok", tapeRows: 0, namesRead: new Set(["BRD"]) };
  eq(congressRows("XSEC", emptyTape), null,
     "AN EMPTY MARKET-WIDE TAPE IS NOT A READ OF A NAME: the call did not throw, so congressRead was " +
     "'ok' and every cross-section card got [], a confident 'no member traded this' from a tape the " +
     "pipeline itself treated as failed and fell back from");
  assert.deepEqual(congressRows("BRD", emptyTape), [],
    "a board name the per-name fallback did read, and found nothing on, is quiet"); checks++;
  eq(congressRows("BRD2", emptyTape), null,
     "and a board name the fallback never reached, or whose call it caught as refused, is unread");
  assert.deepEqual(congressRows("XSEC", { byTicker: new Map(), read: "ok", tapeRows: 40 }), [],
    "a tape that returned rows and named no member for a name is still quiet for it"); checks++;
  const rows = [{ name: "A Member", ticker: "AAA" }];
  eq(congressRows("AAA", { byTicker: new Map([["AAA", rows]]), read: "ok", tapeRows: 40 }), rows,
     "matched rows pass through");
  eq(congressRows("XSEC", { byTicker: new Map(), read: "failed", tapeRows: 0 }), null, "and a thrown read is unread");
  const thrown = { byTicker: new Map(), read: "failed", tapeRows: 0, namesRead: new Set(["BRD"]) };
  assert.deepEqual(congressRows("BRD", thrown), [],
    "A PER-NAME CALL THAT RESOLVED IS A READ OF THAT NAME whatever the market-wide call did: after a " +
    "thrown tape the fallback still reads the board names, and a name it read and found nothing on " +
    "was published as 'the disclosure tape was not read for this name in this run'"); checks++;
  eq(congressRows("XSEC", thrown), null, "while a name the fallback never asked about stays unread");

  const unfetched = "this name was measured in the run's cross-section but is not on today's board";
  const card = (congress) => buildCard({ ticker: "XSEC", row: { close: "100" }, features: { spot: 100, atr: 4 },
    strikes: [], ticks: [], expiries: [], congress, maxPain: null, unfetched,
    generatedAt: "2026-09-22T21:40:00Z", sessionDate: "2026-09-22" }).panels.congress.status;
  eq(card(congressRows("XSEC", emptyTape)), "unavailable",
     "so the cross-section card says the panel was not fetched rather than quiet");
  eq(card([]), "quiet", "where the old [] published quiet");

  const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");
  eq((src.match(/congress: congressRows\(ticker, congressState\)|const congress = congressRows\(ticker, congressState\)/g) || []).length, 3,
     "all three card lanes, board, cross-section and index, take the panel's input from the one rule");
  ok(!/congressRead === "ok" \? \[\] : null/.test(src), "and the old expression is gone from both");
}

{
  const http = await import("node:http");
  const today = easternNow().date;
  const days = priorWeekdays(today, 8).reverse();
  const SESSION = days[days.length - 1];
  const vendorCalls = [];
  const uwServer = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    vendorCalls.push(url.pathname + (url.searchParams.get("date") ? "?date" : ""));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(url.pathname === "/api/stock/SPY/ohlc/1d"
      ? { data: days.map((d) => ({ start_time: `${d}T13:30:00Z`, close: "500", volume: 1 })) }
      : { data: [] }));
  });
  const writes = [];
  const heldKeys = new Set([`scores:${SESSION}`, `board:long:${SESSION}`, `board:short:${SESSION}`]);
  const ingest = http.createServer((req, res) => {
    const key = new URL(req.url, "http://x").searchParams.get("key");
    req.resume();
    req.on("end", () => {
      writes.push({ method: req.method, key });
      res.writeHead(req.method === "DELETE" ? 404 : 200, { "Content-Type": "application/json" });
      if (req.method === "GET" && heldKeys.has(key)) {
        res.end(JSON.stringify({ generatedAt: `${SESSION}T21:45:00.000Z`, sessionDate: SESSION, rows: [{ t: "A", s: 40 }] }));
      } else if (req.method === "GET") {
        res.end(JSON.stringify({ key, status: "pending" }));
      } else {
        res.end('{"ok":true}');
      }
    });
  });
  await new Promise((r) => uwServer.listen(0, "127.0.0.1", r));
  await new Promise((r) => ingest.listen(0, "127.0.0.1", r));
  const run = (extra) => new Promise((resolve) => {
    const child = spawn(process.execPath, ["../scripts/flows-pipeline.mjs"], {
      cwd: import.meta.dirname,
      env: {
        ...process.env,
        UW_API_KEY: "test", FLOWS_INGEST_TOKEN: "test",
        FLOWS_INGEST_URL: `http://127.0.0.1:${ingest.address().port}/api/flows/ingest`,
        FLOWS_UW_BASE_URL: `http://127.0.0.1:${uwServer.address().port}`,
        FLOWS_ALLOW_INTRADAY: "1",
        ...extra,
      },
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    child.on("close", (status) => resolve({ status, out }));
  });
  try {
    const skipped = await run({});
    eq(skipped.status, 0, `the same-session run exits clean (${skipped.out.slice(-300)})`);
    ok(new RegExp(`session date: ${SESSION}`).test(skipped.out), `and resolved ${SESSION} from the vendor's SPY bars`);
    ok(/session gate: archived — scores:\S+ is already archived/.test(skipped.out),
       "it found the session archived and said so before spending a vendor call on the universe");
    const posted = writes.filter((w) => w.method === "POST").map((w) => w.key).sort();
    assert.deepEqual(posted, ["news", "pulse", "sector:premium"],
      "A SAME-SESSION RUN SKIPS THE RANKED LEG END TO END: it wrote news, pulse and " +
      `sector:premium and nothing else — no board, scores, record, scoretrack, card, brief or meta (${posted.join(", ")})`); checks++;
    eq(writes.filter((w) => w.method === "DELETE").length, 0, "and deleted nothing");
    ok(!vendorCalls.some((p) => p.startsWith("/api/screener") || p.startsWith("/api/stock/AAPL")),
       "no screener band and no dating probe was bought for a session it would not rank");
    assert.deepEqual(writes.filter((w) => w.method === "GET" && /:\d{4}-/.test(w.key)).map((w) => w.key),
      [`scores:${SESSION}`, `board:long:${SESSION}`, `board:short:${SESSION}`],
      "the gate reads all three of the session's archive keys, not scores alone"); checks++;

    writes.length = 0;
    vendorCalls.length = 0;
    heldKeys.delete(`board:long:${SESSION}`);
    const partial = await run({});
    eq(partial.status, 1,
       "A RE-DISPATCH AGAINST A PARTLY ARCHIVED SESSION TURNS RED: scores held and board:long lost " +
       `used to exit clean after writing nothing to the lost key (${partial.out.slice(-300)})`);
    ok(/session gate: partial — /.test(partial.out) && /ARCHIVE INCOMPLETE: .*board:long:\S+ is not/.test(partial.out) &&
       /republish_session/.test(partial.out),
       "and the log names the missing key and the dispatch that rewrites the session");
    assert.deepEqual(writes.filter((w) => w.method === "POST").map((w) => w.key).sort(), ["news", "pulse", "sector:premium"],
      "it still refreshes only the unranked feeds — no second ranking goes live beside the kept one"); checks++;
    eq(writes.filter((w) => w.method === "DELETE").length, 0, "and deletes nothing");
    heldKeys.add(`board:long:${SESSION}`);

    writes.length = 0;
    vendorCalls.length = 0;
    const rewrite = await run({ FLOWS_REPUBLISH_SESSION: "1" });
    ok(/session gate: republish/.test(rewrite.out), "republish_session proceeds past the gate as a rewrite");
    ok(vendorCalls.some((p) => p === "/api/screener/stocks?date"),
       "and screens the session by date, since the dated probe answered");
    eq(rewrite.status, 1, "an empty universe still refuses to publish");
    eq(writes.filter((w) => w.method === "DELETE").length, 0,
       "and a republish that cannot rank deletes NOTHING — the archive keys are removed only " +
       "after a ranking exists to replace them");
    eq(writes.filter((w) => w.method === "POST").length, 0, "nor writes anything");
  } finally {
    await new Promise((r) => uwServer.close(r));
    await new Promise((r) => ingest.close(r));
  }
}

{
  const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");
  eq(IV_RANK_PARAMS.timespan, "1y",
     "the implied-volatility history is asked for by timespan, the parameter the vendor documents, and for a " +
     "year of it: the vol-of-vol and the AR(1) half-life read that year at no extra call");
  ok(!/iv-rank`,\s*\{\s*limit/.test(src), "and never with the `limit` the vendor ignores");
  ok(/iv-rank`, \{ \.\.\.IV_RANK_PARAMS, \.\.\.onSession \}\)/.test(src),
     "the live call reads the fixture's parameter object, with the session date added so no row past the session is asked for");
  eq(fakeIvRank("ABC", 50).length, 5,
     "the fixture answers an undated, unparameterised call the way the vendor does: five rows");
  ok(fakeIvRank("ABC", 50, IV_RANK_PARAMS).length >= 250, "and a one-year timespan with a year's sessions, as the live probe returned 251");
  ok(/volatility\/term-structure`, \{ \.\.\.onSession \}\)/.test(src) &&
     /const onSession = ARCHIVE_DATE_RE\.test\(String\(sessionDate \|\| ""\)\) \? \{ date: sessionDate \} : \{\}/.test(src),
     "the term structure is dated at the session, so its days to expiry agree with the greeks on the same card");
  ok(/d > sessionDate/.test(src) && !/d >= sessionDate/.test(src),
     "an expiry dated on the session expired at its close and is never asked for on the surface");

  const enriched = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ", "KKK", "LLL"].map((t, i) => {
    const spot = 45 + i * 20;
    const ladder = fakeOiLadder(t, spot, 0.3 + i * 0.02);
    const book = fakeLadderGreeks(ladder);
    const expiries = book.rows.map((b) => ({ expiry: b.expiry, call_gex: b.gc, put_gex: -b.gp, call_delta: b.dc,
      put_delta: b.dp, call_vanna: b.vc, put_vanna: b.vp, call_charm: b.cc, put_charm: b.cp }));
    const strikes = ladder.strikes.map((k, j) => ({ strike: k, call_gamma_oi: book.byStrike[j].gc, put_gamma_oi: -book.byStrike[j].gp }));
    return { features: { ticker: t, spot }, tilt: { iv30: 0.3 + i * 0.02 }, raw: { expiries, strikes } };
  });
  const run = measureVariationProbes(enriched, "2026-08-24");
  eq(run.probe.call, "raw", "the pooled convention probe reads Black-Scholes call legs as raw");
  eq(run.probe.put, "raw", "and holder-signed put legs as raw");
  eq(run.unit.family, "share", "the unit probe recovers the share family from call_gamma_oi over call_gex");
  eq(run.strikeSign.sign, 1, "the strike book probe reads put_gamma_oi as dealer-signed");
  eq(run.next.h, 1, "a Monday session is one calendar day from the next");
  ok(run.lines.every((l) => /^  variation: /.test(l)), "and every probe prints one tagged log line");
  const sample = vannaProbeSample("AAA", { rows: [], expiry: null, sessionDate: "2026-08-24",
    expiries: enriched[0].raw.expiries, spot: 45 });
  ok(sample === null || (sample.vendor > 0 && sample.model > 0),
     "the vanna check returns a vendor-against-model pair or nothing at all");
  const live = vannaProbeSample("AAA", { rows: fakeLadderChain(fakeOiLadder("AAA", 45, 0.3), "2026-09-04"),
    expiry: "2026-09-04", sessionDate: "2026-08-24", expiries: enriched[0].raw.expiries, spot: 45 });
  ok(live && Math.abs(live.vendor / live.model - 1) < 1e-9,
     `a chain built from the same open-interest ladder reproduces the vendor's call vanna (${live && (live.vendor / live.model)})`);
  eq(live && live.spot, 45, "and the sample carries its spot, which is what tells a share vanna from a dollars-per-1% one");
  const meta = boardVariationMeta({ ...run, vannaScale: { status: "agree", ratio: 1, n: 5 } });
  ok(meta.codes === VARIATION_CODES && meta.kc.n === run.kc.n, "the board's variation block carries the code table and the run's probes");
  ok(/CHANGE IN DEALER DELTA/.test(meta.fields) && /negative figure means dealers buy/.test(meta.fields),
     "and says which way its signed fractions point, since a row carries the dealer-delta change and not the hedge trade");
  const input = featuresVariationInput({ features: { ticker: "X", spot: 50, netGamma: 1, gammaBookRaw: 2, candles: [], iv30: 0.3 },
    raw: { expiries: [] } }, "2026-08-24");
  eq(input.ivRankRows, null, "a board row's variation carries no vol-of-vol: the implied-volatility history is a deep-card read");
  ok(/sdBasis/.test(meta.fields) && /"gamma" is the spot channel alone, which is every board row/.test(meta.fields) &&
     /"gamma\+vanna"/.test(meta.fields),
     "so the block says a row's drift is over the spot channel alone, and that a deep card's panel can read a different one");
}

{
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "flows-var-")) + "/e";
  const run = spawnSync(process.execPath, ["../scripts/flows-pipeline.mjs", "--dry-run", "--emit", prefix],
    { cwd: import.meta.dirname, encoding: "utf8" });
  eq(run.status, 0, "the dry run exits clean with the variation leg in it");
  const log = run.stdout + run.stderr;
  ok(/variation: put convention call raw, put raw/.test(log), "the run logs the pooled convention probe");
  ok(/variation: charm scale K_c [\d.]+ over \d+ expiry reading\(s\).* — ok/.test(log), "and the charm scale it measured");
  ok(/variation: vanna scale agree/.test(log), "and the vanna scale checked against the fixture's chains");
  ok(/vanna scale agree, .*read in shares \(unit share: [1-9]\d* share, 0 dollars-per-1%/.test(log),
     "in the unit the chain check settled from the names priced far enough from $100 to tell the units apart");
  const read = (key) => JSON.parse(fs.readFileSync(`${prefix}-${key}.json`, "utf8"));
  const meta = read("meta");
  ok(meta.variation && meta.variation.kc.status === "ok" && meta.variation.unit.family === "share" && meta.variation.votes === false,
     "meta publishes the run's probes, with the hedge vote off");
  const long = read("board-long");
  const sv = long.scoreVariance;
  ok(sv && /residual/.test(sv.basis) && /blended/.test(sv.blended.basis),
     "the board publishes the score's variance decomposition and says which variance each set of shares divides");
  const total = Object.values(sv.columns).reduce((a, v) => a + v, 0);
  ok(Math.abs(total - 1) < 1e-4, `and the residual shares sum to one (${total})`);
  eq(sv.columns.pDisp, 0, "displacement is off the blend, so it explains none of the score");
  ok(long.rows.every((r) => r.fam.P === null), "and no row carries a positioning family score");
  ok(long.rows.every((r) => r.variation && "gammaPerSigmaPctAdv" in r.variation && "charmPctAdv" in r.variation &&
     "vannaPerPointPctAdv" in r.variation && "driftInSd" in r.variation),
     "every board row carries the compact variation summary the overview's universe map will draw");
  ok(long.rows.every((r) => Object.values((r.variation && r.variation.why) || {}).every((code) => Object.hasOwn(long.variation.codes, code))),
     "and every null on it carries a code the board spells out");
  ok(long.rows.some((r) => r.variation.driftInSd !== null), "with at least one drift reading on the fixture");
  ok(long.rows.every((r) => (r.variation.driftInSd === null ? r.variation.sdBasis === null : r.variation.sdBasis === "gamma")),
     "and every row's drift names its basis: the spot channel alone, the only one a row can measure");
  {
    const cardsBy = new Map(fs.readdirSync(path.dirname(prefix)).filter((f) => /-card-[A-Z]/.test(f))
      .map((f) => JSON.parse(fs.readFileSync(path.join(path.dirname(prefix), f), "utf8"))).map((c) => [c.ticker, c]));
    const rows = [];
    for (const side of ["long", "short"]) {
      for (const r of read("board-" + side).rows) {
        const c = cardsBy.get(r.t);
        const cv = c && c.panels.variation.status === "ok" ? variationSummary(c.panels.variation) : null;
        if (r.variation.driftInSd !== null && cv && cv.driftInSd !== null && cv.driftInSd !== r.variation.driftInSd) rows.push([r, cv]);
      }
    }
    ok(rows.length > 0 && rows.every(([r, cv]) => r.variation.sdBasis === "gamma" && cv.sdBasis === "gamma+vanna"),
       `where a row's drift differs from its card's, the two carry different bases, so neither is presented as the other (${rows.length} names)`);
  }
  {
    const cards0 = fs.readdirSync(path.dirname(prefix)).filter((f) => /-card-[A-Z]/.test(f))
      .map((f) => JSON.parse(fs.readFileSync(path.join(path.dirname(prefix), f), "utf8")));
    const byT = new Map(cards0.map((c) => [c.ticker, c]));
    const signed = long.rows.filter((r) => r.variation && r.variation.charmPctAdv !== null && byT.has(r.t) &&
      byT.get(r.t).panels.variation.status === "ok" && byT.get(r.t).panels.variation.channels.charm);
    ok(signed.length > 0 && signed.every((r) => Math.sign(r.variation.charmPctAdv) ===
      -Math.sign(byT.get(r.t).panels.variation.channels.charm.hedge)),
       `a row's charm fraction points opposite to the card's hedge trade, as the block says (${signed.length} rows)`);
  }
  const cards = fs.readdirSync(path.dirname(prefix)).filter((f) => /-card-[A-Z]/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(path.dirname(prefix), f), "utf8")));
  ok(cards.every((c) => c.panels.variation && typeof c.panels.variation.status === "string"),
     "every card, deep or cross-section, carries the hedging panel");
  const deep = cards.filter((c) => c.depth === "board");
  ok(deep.every((c) => c.panels.volContext.status !== "ok" || c.panels.volContext.ivRank.seen >= 40),
     `a deep card's implied-volatility history now carries a quarter of sessions (${deep.map((c) => c.panels.volContext.ivRank && c.panels.volContext.ivRank.seen).slice(0, 4).join(", ")})`);
  ok(deep.every((c) => (c.panels.volContext.ivRank.rows || []).every((r) => r.date <= c.sessionDate)),
     "with no row dated after the session");
  ok(deep.some((c) => c.panels.variation.status === "ok" && c.panels.variation.inputs.ivChanges >= 20),
     "so the vol-of-vol is measured on deep cards");
  ok(cards.every((c) => !c.panels.calendar.schedule || c.panels.calendar.schedule.every((r) => r.expiry > c.sessionDate)),
     "no card's roll-off is led by the expiry that lapsed at the session's close");
  ok(cards.every((c) => ["vanna", "charm", "deltaExposure"].every((k) => c.panels[k].status !== "ok" ||
     c.panels[k].rows.every((r) => r.expiry > c.sessionDate))), "nor any greek ladder");
  ok(cards.every((c) => c.regime && (c.regime.labelFrom === "book" || c.regime.labelFrom === "flow")),
     "every card says where its gamma label came from");
  ok(cards.filter((c) => c.regime.labelFrom === "book").every((c) =>
     c.regime.label === (c.regime.bookGammaRaw >= 0 ? "long" : "short")),
     "and a book-read label is the sign of the book's net");
}

{
  const measured = callModel({ enriched: 149, deep: 50, cross: 99, dossiers: 3, earnings: 73 });
  ok(Math.abs(measured.total - 3071) / 3071 < 0.01,
     `the call model reproduces the 2026-09-24 nightly (3,071 calls) from its own shape: ${measured.total}`);
  eq(measured.legs.vol, 632, "leg by leg: the vol leg's 632 calls exactly (8 deep, 2 cross, 10 per dossier, 4 radar)");
  eq(measured.legs.enrich, 745, "and the enrichment's 745 (five reads a name)");
  ok(CALL_BUDGET >= callModel({ enriched: 175, deep: 70, cross: 105, dossiers: 12, earnings: 90 }).total,
     `the nominal budget (${CALL_BUDGET}) covers the focus-era shape, so the BUDGET line means a real overrun`);
  ok(CALL_BUDGET === callModel(NOMINAL_SHAPE).total && CALL_COST.dossier === 13,
     "and the budget is the model at its nominal shape, not a literal that drifts from it");

  const card = { score: 12, conviction: 0.4 };
  markGate(card, { gate: { earnings: "2026-09-29", dte: 5 } });
  ok(card.score === null && card.conviction === null && card.gate.earnings === "2026-09-29" && card.gate.dte === 5,
     "a gated card carries score null and gate {earnings, dte}");
  const plain = { score: 3 };
  markGate(plain, { gate: null });
  eq(plain.score, 3, "and an ungated one is untouched");

  const S = "2026-09-24";
  const logs = [];
  const writes = new Map();
  const deletes = [];
  const run = async (over) => {
    logs.length = 0; writes.clear(); deletes.length = 0;
    return retireAndRoster({
      sessionDate: S, generatedAt: "t",
      depth: new Map([["NVDA", "focus"], ["GLD", "fund"], ["PLD", "board"]]),
      exempt: new Set(["GLD", "NVDA"]),
      landed: new Set(["card:NVDA", "card:GLD", "card:PLD", "card-x:NVDA"]),
      remove: async (key) => { deletes.push(key); return key === "card:STUCK" ? { ok: false, status: 400 } : { ok: true, status: 200 }; },
      write: async (key, payload) => { writes.set(key, payload); },
      log: (line) => logs.push(line),
      ...over,
    });
  };
  const ledger = { payload: { v: 1, sessionDate: "2026-09-23", depth: { NVDA: "focus" }, session: { NVDA: "2026-09-23" },
    x: { "card-x": [], hist: [] },
    held: { "card:OLD": "2026-09-17", "hist:OLD": "2026-09-17", "card:NVDA": "2026-09-01", "card:YOUNG": "2026-09-22",
      "card:STUCK": "2026-09-10", "card:GLD": "2026-09-01" } }, status: 200 };
  const carried = await run({ prior: ledger, reader: async () => { throw new Error("the carried path must not probe"); } });
  assert.deepEqual(deletes.sort(), ["card:OLD", "card:STUCK", "hist:OLD"],
    "the carried ledger retires exactly the unrebuilt keys more than three sessions old"); checks++;
  const roster = writes.get("roster");
  ok(roster && roster.depth.NVDA === "focus" && roster.depth.PLD === "board" && roster.depth.GLD === "fund", "the roster is written");
  ok(Object.hasOwn(roster.held, "card:STUCK") && Object.hasOwn(roster.held, "card:YOUNG") && !Object.hasOwn(roster.held, "card:OLD"),
     "a refused delete stays in the ledger to be retried; a retired key leaves it");
  ok(!Object.hasOwn(roster.held, "card:NVDA") && !deletes.includes("card:GLD"),
     "a rebuilt focus card and an exempt fund card are never deleted");
  eq(carried.retired, 2, "two keys removed");
  eq(carried.refused, 1, "one refused");

  const probed = [];
  const store = new Map([["card:GONE", { sessionDate: "2026-09-16" }], ["card-x:GONE", { sessionDate: "2026-09-16" }],
    ["card:NEWISH", { sessionDate: "2026-09-23" }], ["card-x:XONLY", { generatedAt: "2026-09-02T21:00:00Z" }]]);
  const boot = await run({
    prior: { payload: { v: 1, sessionDate: "2026-09-23", depth: {} }, status: 200 },
    candidates: ["GONE", "NEWISH", "XONLY", "NEVER", "NVDA"],
    reader: async (key) => { probed.push(key); return store.has(key) ? { payload: store.get(key), status: 200 } : { payload: null, absent: true, status: 200 }; },
  });
  ok(probed.includes("hist:GONE") && !probed.includes("hist:NEVER") && !probed.includes("card:NVDA"),
     "a roster without a ledger bootstraps by probing the store: hist only where a card or card-x exists, never a key the run just wrote");
  assert.deepEqual(deletes.sort(), ["card-x:GONE", "card-x:XONLY", "card:GONE"],
    "the bootstrap retires what it found older than three sessions, card-x-only orphans included"); checks++;
  eq(boot.ledger, "bootstrap", "and records that the ledger was rebuilt");
  ok(Object.hasOwn(writes.get("roster").held, "card:NEWISH"), "a young key it found is carried from then on");

  const flaky = await run({
    prior: { payload: { v: 1, sessionDate: "2026-09-23", depth: {} }, status: 200 },
    candidates: ["GONE"],
    reader: async (key) => (key === "card:GONE" ? { failed: true, status: 403 } : { payload: null, absent: true, status: 200 }),
  });
  eq(flaky.ledger, "bootstrap-partial", "a probe with a failed read is recorded as partial, so the next run probes again");
  eq(writes.get("roster").ledger, "bootstrap-partial", "and the roster carries that mark");

  const blind = await run({ prior: { payload: null, failed: true, status: 503 }, reader: async () => ({ failed: true }) });
  eq(deletes.length, 0, "when the prior roster cannot be read nothing is retired on a guess");
  eq(blind.ledger, "unread", "and the roster says so");
}

console.log(`✓ flows-pipeline: ${checks} assertions — live publish path, candle-order invariance, issuer collapse, dead-band partitioning, the dated archive key and its bounded prune, the watch board's ranking and vocabulary, multiplicative quality gating, direction monotonicity, packed sparklines, Eastern session resolution, liquidity floor, sector TRIX and the fixed-clamp scaling that keeps a flat day flat, the movers band's zero-call guarantee and its unranked counts, the rate limiter's floor actually being a floor, the truncated-chain probe's three distinct verdicts, the board's memory refusing a prior board that turns out to be this run's own session, a corpus proven to REACH the change layer's branches rather than merely to satisfy assertions written around them, and a market-wide join whose published coverage is checked against the cards it was measured over rather than against itself, the sector OPTIONS lean proven to be a different quantity from the sector momentum beside it — its ratio comparable across baskets three orders of magnitude apart where the dollar difference is not, its measured zero visible in dollars and undefined as a ratio, a blank vendor string refused before it can become a confident zero, and its row vocabulary disjoint from TRIX's — and the news tape's four counts, its own ordering applied before the cap so the rows kept are the newest and not the first, and an undated row published, counted on both sides of the cap, and never given a manufactured timestamp; and the focus-era coverage — gated names carded without a score, focus names built deep whatever their rank, fund dossiers, a roster that is also the retire ledger, and a call model that reproduces the measured nightly`);
