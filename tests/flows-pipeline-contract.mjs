/* Contracts for the pipeline stage — the code between the vendor's response
   and the published board.

   The unit tests in flows-features.mjs cover the mathematics. These cover the
   plumbing around it, which is where an adversarial audit found the defects
   that mattered most: a name enriched twice and ranked on both boards, an ATR
   computed backwards through time because the vendor's candle order is not
   documented, and unsigned magnitudes added to a signed composite so that
   "this flow is high quality" read as "this name is bullish". */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  candlesAscending, selectExtremes, atr14, partitionSides, scoreBoard,
  medianDollarVolume, eligible, daysToEarnings, publish, summarize,
  collapseShareClasses, returnCorrelation, packSpark, ret, easternNow, DEAD_BAND,
  screenerTilt, boardRow, toRows, toWatchRows, datedKey, pruneKeys, pruneArchive,
  describeTickFields, TICK_FIELDS_READ, republishWithChain,
  runPooled, foldCardOutcomes, poolWidth, describeFloorVerdict, POOL_MAX_WIDTH, POOL_EVIDENCE_MIN,
  POOL_REFUSAL_HALT, POOL_REFUSAL_EASE,
  unusualContractId, markNewContracts, priorNote,
  readBoardMemory, fakePriorBoard,
  stepRateController, raiseRateFloor, rateFloorSurvivesBudget, RATE, CALL_BUDGET,
  PUBLISH_SPACING_MS,
  DEADLINE_MS, CHAIN_RESERVE_MS, nearestProbeExpiry, describeChainProbe, fakeChain,
  DEEP_NAMES, deepNames, publishRetryDelay, MARKET_CROSS_LIMIT,
  WATCH_ROWS, ARCHIVE_RETENTION_DAYS, ARCHIVE_PRUNE_LOOKBACK_DAYS,
  SECTOR_ETFS, TRIX_SERIES, TRIX_MIN_CANDLES, TRIX_FULL_SCALE_BP,
  trixSeriesBp, scaleTrix, sectorTrix, MOVER_ROWS, moverRow, buildMovers,
} from "../scripts/flows-pipeline.mjs";
import { pearson, horizonMove, HORIZON_SESSIONS } from "../shared/flows-features.js";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* ---------- candle ordering is not assumed ---------------------- */
{
  // 40 sessions, a calm stretch then a volatile one, so order is detectable.
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

  // Without sorting, a reversed series would have weighted the calm bars.
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

  ok(atr14([]) === 0, "no candles yields no ATR");
  ok(atr14(ascending.slice(0, 5)) === 0, "too few candles yields no ATR rather than a guess");
}

/* ---------- the extremes are deduplicated by ticker -------------- */
{
  const ranked = (n) => Array.from({ length: n }, (_, i) => ({ row: { ticker: "T" + i }, rough: -i }));

  for (const size of [80, 60, 59, 55, 50, 40, 31, 30, 10, 1]) {
    const picks = selectExtremes(ranked(size), 30);
    const tickers = picks.map((p) => p.row.ticker);
    ok(new Set(tickers).size === tickers.length,
       `THE FIX: no ticker is enriched twice at a pool of ${size} (got ${tickers.length})`);
    ok(picks.length <= Math.min(size, 60), `pool ${size} yields at most min(size, 2n) picks`);
  }

  // The overlap was real, not hypothetical: at 55 the naive form duplicated 5.
  const naive = [...ranked(55).slice(0, 30), ...ranked(55).slice(-30)];
  ok(naive.length - new Set(naive.map((p) => p.row.ticker)).size === 5,
     "the naive head/tail slice duplicated five names at 55 survivors");

  // Both ends are still represented.
  const wide = selectExtremes(ranked(200), 30).map((p) => p.row.ticker);
  ok(wide.includes("T0") && wide.includes("T199"), "both extremes are still selected");
  ok(wide.length === 60, "a wide pool yields the full 2n");
}

/* ---------- boards are disjoint at every pool size --------------- */
{
  for (const size of [60, 55, 50, 48, 40, 21, 20, 4, 2, 1, 0]) {
    const scored = Array.from({ length: size }, (_, i) => ({ ticker: "T" + i, score: 100 - i * 3 }));
    const { long, short } = partitionSides(scored);
    const overlap = long.filter((l) => short.some((s) => s.ticker === l.ticker));
    ok(overlap.length === 0, `long and short stay disjoint at pool size ${size}`);
  }
}

/* ---------- MODIFIERS MULTIPLY, THEY DO NOT VOTE ------------------
   The composite means long when positive and short when negative, so every
   ADDED column must carry a direction of its own. A magnitude — how clean the
   positioning is, how durable the regime is — has none.

   The first version of this test caught the first version of the bug: two
   names with identical bearish flow separated by 3.8 z on positioning quality
   alone, sending the CLEAN one to the long board. The fix at the time signed
   each magnitude by sign(dirDelta) so it could stay in the additive sum, and
   that reintroduced the same inversion one level down. Measured on the
   pipeline's own cross-section afterwards: three of ten scoring columns were
   ~95% sign(dirDelta) by correlation, they carried the NEGATIVE sign and a
   quarter of the total weight, and the finished composite came out at
   corr(blend, dirDelta) = -0.07 — the long board ranking AGAINST its own
   directional flow signal.

   So the contract is now structural, not cosmetic: unsigned quantities leave
   the additive sum entirely and become a bounded multiplier. */
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

  // Both are strongly BEARISH. A is clean near-money; B is OTM lottery on vega.
  const clean = { ...base(0), ticker: "CLEAN", dirDelta: -1000, dirShare: -0.8,
                  purity: 0.9, otmShare: 0.10, vegaTilt: 0.05, pathNet: -1000 };
  const lotto = { ...base(1), ticker: "LOTTO", dirDelta: -1000, dirShare: -0.8,
                  purity: 0.2, otmShare: 0.95, vegaTilt: 5.0, pathNet: -1000 };
  const all = [clean, lotto, ...features];

  const tilts = all.map((f) => ({
    premiumTilt: f.dirShare * 0.5, netTilt: f.dirShare * 0.3,
    volTilt: f.dirShare * 0.4, oiTilt: f.dirShare * 0.2, surpriseTilt: 0,
  }));
  const sectors = all.map((_, i) => ["tech", "energy", "health", "fins"][i % 4]);
  const caps = all.map(() => 5e9);

  const scored = scoreBoard(all, tilts, sectors, caps);
  const byTicker = new Map(scored.map((r) => [r.ticker, r]));
  const c = byTicker.get("CLEAN");
  const l = byTicker.get("LOTTO");

  /* O IS A GAUGE, NOT A VOTE. It reports the multiplier the name earned, on a
     0..100 scale with no sign, so the card must never draw it on the same
     centre-origin axis as F, P and D. */
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

  /* THE MEASUREMENT THAT CAUGHT THE SECOND VERSION. Before the fix this came
     out at -0.07 on the pipeline's own cross-section: the long board was
     ranking AGAINST its own directional flow signal. */
  const r = pearson(scored.map((x) => x.residual), scored.map((x) => x.dirShare));
  ok(r > 0.2, `the composite is LONG its own directional flow signal (corr = ${r.toFixed(3)})`);
  const rF = pearson(scored.map((x) => x.fam.F), scored.map((x) => x.dirShare));
  ok(rF > 0.8, `and the flow axis itself tracks flow (corr = ${rF.toFixed(3)})`);

  /* THE SHARPER TEST, because a correlation is only as strong as the fixture's
     other columns. Take one name, reverse ONLY its direction, and rescore the
     same cross-section: the residual must follow. This is the exact property
     that failed — a name whose flow turned bullish got pushed DOWN, because
     three unsigned magnitudes signed by sign(dirDelta) outweighed the signed
     column they were modifying. */
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

  /* The gamma regime must reach the score, and it now does so through the
     gate: dealers short gamma at spot amplify whatever the flow is pushing.
     Measured at spot, not summed over the whole band. */
  const shortAtSpot = scored.filter((x) => x.spotGammaShare < -0.2);
  const longAtSpot = scored.filter((x) => x.spotGammaShare > 0.2);
  ok(shortAtSpot.length && longAtSpot.length, "the fixture covers both gamma regimes");
  const meanGate = (rows) => rows.reduce((a, x) => a + x.gate, 0) / rows.length;
  ok(meanGate(shortAtSpot) > meanGate(longAtSpot),
     `THE FIX: short gamma at spot amplifies, long gamma damps ` +
     `(${meanGate(shortAtSpot).toFixed(3)} vs ${meanGate(longAtSpot).toFixed(3)})`);

  // Signed axes are signed; gauges are gauges; absent is null, never zero.
  for (const k of ["F", "P", "D"]) {
    ok(scored.every((x) => x.fam[k] === null || (x.fam[k] >= -100 && x.fam[k] <= 100)),
       `signed axis ${k} is a bounded score or explicitly absent`);
  }
  ok(scored.every((x) => x.fam.V === null || (x.fam.V >= 0 && x.fam.V <= 100)),
     "the vol gauge is unsigned, 0..100, or explicitly absent");

  /* A DEAD SOURCE MUST NOT DRAW WEIGHT. Family V was identically zero on all
     34 live names and still counted as a fifth of the board. */
  const noPath = all.map((f) => ({ ...f, pathNet: 0, persistence: 0, pathBars: 0 }));
  const withoutD = scoreBoard(noPath, tilts, sectors, caps);
  ok(withoutD.every((x) => x.fam.D === null),
     "a family with no usable input reports absent, not neutral");
  ok(withoutD.every((x) => !("D" in x.weights)), "and draws no weight at all");

  ok(scored.every((x) => x.score >= -100 && x.score <= 100), "scores stay inside the band");
  ok(scored.every((x) => x.conviction >= 0 && x.conviction <= 100), "conviction stays inside the band");

  /* THE SCORE'S UNIT. Under the old rank ladder a 34-name board always printed
     84 77 71 65 ... whatever the data; scores must now move with dispersion
     and must NOT move with pool size at fixed rank. */
  const half = scoreBoard(all.slice(0, 24), tilts.slice(0, 24), sectors.slice(0, 24), caps.slice(0, 24));
  const ladder = (rows) => rows.map((x) => x.score).sort((a, b) => b - a);
  ok(JSON.stringify(ladder(scored).slice(0, 8)) !== JSON.stringify(ladder(half).slice(0, 8)),
     "the top of the board is not a fixed function of pool size");
  const uniq = new Set(scored.map((x) => x.score));
  ok(uniq.size < scored.length,
     "a fixed unit lets names tie, which a rank relabeling could never do");
}

/* ---------- liquidity and gating -------------------------------- */
{
  // Median, not mean: one halt-and-resume spike must not lift an illiquid name.
  const quiet = Array.from({ length: 40 }, () => ({ close: "10", volume: 100_000 }));   // $1M/day
  quiet[20] = { close: "10", volume: 500_000_000 };                                      // one $5B day
  ok(medianDollarVolume(quiet) < 5e7, "a single volume spike cannot clear the floor");
  ok(medianDollarVolume([]) === 0, "no candles reports no volume rather than a guess");

  /* THE RECENT WINDOW, not the whole series. The candle request went from two
     months to a year — for the sparkline, the 52-week range and the realized-vol
     baseline, all free in the same call — and silently took the liquidity floor
     with it. A year-old median is more robust statistically and less true
     operationally: the floor exists to say whether a name can be traded at these
     costs TODAY. */
  const day = (i, volume) => ({
    start_time: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(),
    close: "10", volume,
  });
  // $100M a day for most of the year, collapsed to $1M a quarter ago.
  const faded = [
    ...Array.from({ length: 190 }, (_, i) => day(i, 10_000_000)),
    ...Array.from({ length: 62 }, (_, i) => day(190 + i, 100_000)),
  ];
  ok(medianDollarVolume(faded) < 5e7,
     `a name whose liquidity collapsed a quarter ago fails the floor ` +
     `(got $${(medianDollarVolume(faded) / 1e6).toFixed(1)}M)`);
  ok(medianDollarVolume(faded, { window: 1e9 }) > 5e7,
     "while the whole-series median would still wave it through, which is the bug");
  // Order must not matter: the window is the last N SESSIONS, not the last N rows.
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

  /* MEASURED FROM A DATE, NOT AN INSTANT, and the change is the assertion.

     This took Date.now() and rounded a fractional day, which made the gate a
     function of THE MINUTE THE JOB FIRED: the same name and the same earnings
     date could land on either side of the twelve-day boundary depending on
     whether the runner started at 05:15 or 05:47. Nobody chose that.

     It also made two published counts arithmetically impossible.
     /flows/events/ publishes this number beside a weekday count over the same
     span, and with one measured against an instant and the other against
     midnight the WEEKDAY count overtook the CALENDAR count containing it on 8
     of 60 rows. A subset cannot be larger than its superset. */
  const today = "2026-08-25";
  ok(daysToEarnings({ next_earnings_date: "2026-08-30" }, today) === 5, "earnings distance is in days");
  ok(daysToEarnings({}, today) === null, "an absent earnings date is null, not zero");
  ok(daysToEarnings({ next_earnings_date: "2026-08-30" }, "not-a-date") === null,
     "and an origin that is not a date is null rather than NaN days");
  /* THE PROPERTY THE FIX BOUGHT: two runs on the same calendar day agree,
     whatever hour each fired. Asserted through the ISO date because that is
     now the only thing the function can see. */
  ok(daysToEarnings({ next_earnings_date: "2026-09-06" }, "2026-08-25") ===
     daysToEarnings({ next_earnings_date: "2026-09-06" }, "2026-08-25"),
     "the gate is a function of the session's calendar day, not of the firing minute");
  ok(daysToEarnings({ next_earnings_date: "2026-08-24" }, today) === -1,
     "a date already past is negative, which the gate reads as `let it through`");
}

/* ---------- THE LIVE PUBLISH PATH -------------------------------
   --dry-run returns before the live branch, so the harness that gates every
   deploy could not see this code at all. It diverged: the dry-run branch knew
   that cards and meta carry no `rows` while the live branch still read
   payload.rows.length, so a green dry run certified a path that would throw on
   the first real card, fail all fifty inside their per-card catch, and then
   take the whole job down on the uncaught meta publish — AFTER the boards had
   already been committed. These tests drive the live branch against a stub. */
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
    // A board payload: the shape the old code assumed was the only shape.
    await publish("board:long", { side: "long", rows: [{ t: "A" }, { t: "B" }] });
    eq(received.length, 1, "a board publishes over the live path");
    ok(received[0].url.includes("key=board%3Along"), "the key is url-encoded into the query");
    eq(received[0].auth, "Bearer test-token", "and carries the bearer");

    // THE REGRESSION: a card has no rows at all.
    await publish("card:AAPL", { v: 1, ticker: "AAPL", panels: {} });
    eq(received.length, 2, "a CARD publishes over the live path without throwing");

    // And so does meta.
    await publish("meta", { generatedAt: "x", cardsBuilt: 3 });
    eq(received.length, 3, "meta publishes over the live path without throwing");

    // A non-2xx must still throw, so a real ingest failure is not swallowed.
    let threw = null;
    try { await publish("card:FAILME", { ticker: "FAILME" }); }
    catch (error) { threw = error; }
    ok(threw && /HTTP 500/.test(threw.message), "a failed ingest throws with its status");

    // Both branches describe a payload the same way, by construction.
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

/* ---------- one row per ISSUER, not per listing ------------------
   GOOG entered fourth on the live long board while GOOGL — the same company —
   sat on the short side of the median. Nothing in the pipeline knew they were
   one issuer: the screener union, the earnings gate, the liquidity floor and
   the scorer all key on the raw ticker string, and neutralize() cannot help,
   because an OLS projection on sector and log-cap PRESERVES in full exactly
   the idiosyncratic difference that split them. */
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
  // The B line: same returns plus a whisper of its own liquidity noise.
  const bLine = shared.map((c, i) => ({ ...c, close: (Number(c.close) * (1 + (i % 5) * 1e-4)).toFixed(4) }));

  const rec = (ticker, cap, sector, dv, ohlc) => ({
    features: { ticker, dollarVolume: dv }, raw: { ohlc },
    row: { ticker, marketcap: String(cap), sector },
  });
  const records = [
    rec("GOOG", 2.1e12, "Communication Services", 9e9, shared),
    rec("GOOGL", 2.1e12, "Communication Services", 4e9, bLine),
    rec("MSFT", 3.0e12, "Technology", 8e9, candles(11)),
    rec("NVDA", 3.0e12, "Technology", 3e10, candles(23)),   // same cap band, different issuer
  ];

  const { kept, dropped } = collapseShareClasses(records);
  const tickers = kept.map((e) => e.features.ticker).sort();
  ok(!tickers.includes("GOOGL"), `the thinner share class is dropped (kept ${tickers.join(",")})`);
  ok(tickers.includes("GOOG"), "the more liquid line survives");
  ok(dropped.length === 1 && dropped[0].kept === "GOOG" && dropped[0].dropped === "GOOGL",
     "and the collapse is reported, not silent");
  ok(dropped[0].corr >= 0.97, `on a measured return correlation (${dropped[0].corr.toFixed(4)})`);

  /* BOTH CONDITIONS MUST HOLD. Two unrelated companies can share a sector and
     round to the same market cap; only the return correlation separates them
     from a share-class pair. */
  ok(tickers.includes("MSFT") && tickers.includes("NVDA"),
     "same sector and same cap is NOT enough to collapse two real issuers");

  ok(collapseShareClasses([]).kept.length === 0, "an empty pool is safe");
  const noCap = [rec("X", 0, "Tech", 1e9, shared), rec("Y", 0, "Tech", 1e9, shared)];
  ok(collapseShareClasses(noCap).kept.length === 2, "a missing market cap groups nothing");

  ok(Number.isNaN(returnCorrelation(shared, candles(5, 4))),
     "too few overlapping dates reports NaN rather than a confident number");
}

/* ---------- the deck's sparkline costs 84 bytes ------------------ */
{
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 8);
  const packed = packSpark(closes);
  ok(packed.length === 84, `42 sessions at two characters each (got ${packed.length})`);
  ok(/^[A-Za-z0-9+/]+$/.test(packed), "and it is plain base-64 alphabet, safe in JSON");

  // The shape must survive the round trip: decode and check monotone segments.
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

  // Period returns, from the full series rather than the retained window.
  const rising = Array.from({ length: 60 }, (_, i) => 100 * 1.01 ** i);
  ok(Math.abs(ret(rising, 5) - (1.01 ** 5 - 1)) < 1e-9, "the 5-session return is exact");
  ok(ret(rising, 42) !== null, "a 42-session return resolves when the series is long enough");
  ok(ret(rising.slice(-42), 42) === null,
     "and reports null rather than a wrong number when it is not");
}

/* ---------- the board's forecast column is a CROSS-SECTION -------- */
{
  /* THE DEFECT THIS GUARDS. The deck's footer sets one name's priced move
     beside another's. The vendor's implied_move_perc is quoted to each name's
     NEXT LISTED EXPIRY, so a name expiring tomorrow and one expiring in a month
     print bands measured over different horizons — on the pipeline's own
     cross-section, one name quoted 7.1% to a four-day expiry while its
     ten-session move was 13.0%. A column of those is not a cross-section. */
  const iv = 0.42;
  const h10 = horizonMove(iv);
  const h40 = horizonMove(iv, { sessions: 40 });
  ok(h40 > h10, "a longer horizon prices a wider band, from the same volatility");
  ok(Math.abs(h40 / h10 - 2) < 1e-9,
     "and exactly twice as wide at four times the horizon — square root of time");

  // Two names with IDENTICAL volatility must publish the SAME comparable band,
  // whatever their expiry calendars look like.
  ok(horizonMove(iv) === horizonMove(iv),
     "the fixed-horizon band depends on volatility alone, not on the expiry chain");
  ok(HORIZON_SESSIONS === 10, "the published horizon is ten trading sessions");
}

/* ---------- iv_rank is a percentile, not a fraction --------------- */
{
  /* THE VENDOR'S OWN SCHEMA IS WRONG HERE, and the generated reference inherits
     the error: iv_rank is declared `$ref: 'Stock IV 30d 1M'`, so every doc
     shows iv30d_1m's description ("The 30 day implied volatility from 1 month
     ago") and iv30d_1m's example (0.2136...). The screener's EXAMPLE OBJECT is
     the only place the truth appears, and it is unambiguous:
     `iv_rank: '13.52369891956068210400'` sitting beside `iv30d: '0.2038...'`
     in the same response.

     Read as a fraction, 13.52 would have printed "1352% of its year" on the
     card. The scoring was unharmed either way — percentileRank is
     scale-invariant — which is exactly why only the display would have shown
     it, and why the fixture had to carry the real scale to catch it. */
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
  /* A value at or below 1 is ambiguous between the two conventions; treating it
     as already-a-fraction is the reading that cannot produce a nonsense
     number. */
  ok(tilt("0.5").ivRank === 0.5, "an ambiguous 0.5 is left as a fraction");
  ok(Number.isNaN(tilt(null).ivRank), "a missing rank is not a zero percentile");
  ok(Number.isNaN(tilt("-3").ivRank), "and neither is a negative one");
}

/* ---------- the re-publish writes DATED FIRST, or not at all -----

   The ordering is the whole design of step 7f, and it is the kind of invariant
   that lives inside a 3000-line main() and is asserted by nothing. A dry-run
   emit cannot see it — both files end up on disk either way — so the function
   takes its publisher as a parameter and this block hands it a recorder. */
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
      ["BBB", chain(null, null, null, null)],  // measured nothing: still merged, as nulls
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

  /* THE FAILURE PATH IS THE POINT. When the archive write fails, the live
     board must be left as the store already had it. */
  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const chains = new Map([["AAA", chain(0.04, -0.02, 0.31, 25)], ["CCC", chain(0.06, 0.01, 0.28, 32)]]);
    const lines = await republishWithChain(payloads, chains, "2026-08-24", async (key) => {
      seen.push(key);
      if (key === "board:long:2026-08-24") throw new Error("archive write refused");
    });
    ok(!seen.includes("board:long"),
       `a failed archive write does NOT go on to publish the live board (${seen.join(", ")})`);
    ok(lines.some((l) => /keeps the pre-chain board/.test(l)),
       "and it says which copy the reader is left holding");
    /* The OTHER side is independent: one failure must not cost both boards. */
    ok(seen.includes("board:short:2026-08-24") && seen.includes("board:short"),
       "while the other side re-publishes normally — sides fail independently");
  }

  /* No chain at all is a skip, not an empty write. */
  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const lines = await republishWithChain(payloads, new Map(), "2026-08-24", async (key) => { seen.push(key); });
    eq(seen.length, 0,
       "a run whose chain leg never reached a board name re-publishes NOTHING — the session's " +
       "row is simply gappy, which the IC table's per-column n reports on its own");
    eq(lines.length, 0, "and says nothing it did not do");
  }

  /* An unresolved session date must not mint an unpruneable key. */
  {
    const seen = [];
    const payloads = { long: board("long", ["AAA"]), short: board("short", ["CCC"]) };
    const chains = new Map([["AAA", chain(0.04, -0.02, 0.31, 25)], ["CCC", chain(0.06, 0.01, 0.28, 32)]]);
    await republishWithChain(payloads, chains, null, async (key) => { seen.push(key); });
    ok(!seen.some((k) => /board:(long|short):/.test(k)),
       `with no session date, no dated key is written at all (${seen.join(", ")})`);
    ok(seen.includes("board:long") && seen.includes("board:short"),
       "though the live boards still gain the columns");
  }
}

/* ---------- the tick probe runs before it matters ----------------

   A diagnostic that has never executed throws on the first live run, which is
   exactly the moment it exists for. The dry run substitutes fakeEnrichment and
   never calls enrich(), so this probe would otherwise reach production
   untested — the same shape of blindness that let call_gex ship wrong. */
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

  /* BOUNDED. A tick row is vendor data of unknown width and a log line is not
     a payload: an unbounded dump on a wide row floods the Actions log, which
     is the one place a live diagnostic gets read. */
  const wide = { tape_time: "x" };
  for (let i = 0; i < 40; i++) wide["f" + i] = "y".repeat(500);
  const bounded = describeTickFields("WIDE", wide);
  ok(bounded[1].length < 900, `a forty-field row logs ${bounded[1].length} chars, not thousands`);
  ok(/\+28 more/.test(bounded[1]), `with the remainder counted rather than dropped (${bounded[1].slice(-20)})`);

  /* An empty row is a fact about the vendor, said out loud. */
  const none = describeTickFields("EMPTY", {});
  eq(none.length, 1, "an empty row logs one line");
  ok(/no keys at all/.test(none[0]), `saying what came back (${none[0]})`);
}

/* ---------- a missing volume norm is unmeasured, not average ------ */
{
  const base = {
    ticker: "T", close: "100", prev_close: "100",
    bullish_premium: "1", bearish_premium: "1", call_premium: "1", put_premium: "1",
    call_volume: 9000, put_volume: 6000, total_open_interest: 10,
  };
  const both = screenerTilt({ ...base, avg_30_day_call_volume: 3000, avg_30_day_put_volume: 3000 });
  ok(Math.abs(both.surpriseTilt - Math.log(3.1 / 2.1)) < 1e-12,
     "with both norms on the wire, surpriseTilt is the log ratio of the two surprises");
  /* THE CONFIDENT ZERO. The old fallback answered 1 — "an average day" — for
     a side the vendor never averaged, so a name with no norm at all published
     surpriseTilt 0, which is a real reading of this field ("exactly as much
     call as put surprise") and rendered as such on the watch list. */
  eq(screenerTilt(base).surpriseTilt, null,
     "a name with NO 30-day volume norm publishes null, never a balanced zero");
  eq(screenerTilt({ ...base, avg_30_day_call_volume: 3000 }).surpriseTilt, null,
     "and one norm alone cannot measure a ratio of two surprises");
}

/* ---------- a probe that learns nothing must not act -------------- */
{
  /* THE MISFIRE, from the first live run on main. verifyDating drops `date`
     when the dated call comes back unusable — and the first version did that
     even when the UNDATED call was unusable too, which is precisely the case
     where the probe has distinguished nothing. Both calls returned no usable
     gamma, so the guard concluded `date` was at fault and reverted the entire
     run to the undated behaviour it exists to replace.

     The decision is a two-input truth table and only one row may drop it. */
  const keepDate = (datedUsable, undatedUsable) => datedUsable || !undatedUsable;

  ok(keepDate(true, true), "both usable: keep the dated call, it is correct by construction");
  ok(keepDate(true, false), "dated works and undated does not: obviously keep it");
  ok(!keepDate(false, true),
     "dated fails while undated succeeds: the ONLY evidence that `date` is at fault");
  ok(keepDate(false, false),
     "neither works: the probe learned nothing, so it must not change behaviour");
}

/* ---------- the session is resolved, not inferred ---------------- */
{
  // 09:00 New York on a summer weekday is 13:00 UTC (EDT, UTC-4).
  const morning = easternNow(new Date("2026-08-25T13:00:00Z"));
  ok(morning.date === "2026-08-25", `the Eastern calendar date (got ${morning.date})`);
  ok(morning.minutes === 9 * 60, `and the minute of the Eastern day (got ${morning.minutes})`);
  ok(morning.minutes < 16 * 60, "before the close, so today's candle is a partial session");

  const evening = easternNow(new Date("2026-08-25T21:30:00Z"));   // 17:30 EDT
  ok(evening.minutes >= 16 * 60, "after the close, so today's candle is complete");

  // Winter is EST, UTC-5: the same UTC instant is an hour earlier locally.
  const winter = easternNow(new Date("2026-01-15T13:00:00Z"));
  ok(winter.minutes === 8 * 60, `daylight saving is handled by the zone, not by arithmetic (got ${winter.minutes})`);

  // Midnight must never render as minute 1440.
  const midnight = easternNow(new Date("2026-08-25T04:00:00Z"));
  ok(midnight.minutes === 0, `midnight is minute zero, not 1440 (got ${midnight.minutes})`);

  ok(DEAD_BAND > 0 && DEAD_BAND < 100, "the dead band is a publishable threshold");
}

/* ---------- the dead band is a LIST as well as a count ------------
   ~48 of 60 fully scored names land inside +-20 on a normal session. They were
   counted at the payload boundary and discarded, so the payload could say "48
   neutral" and could not say WHICH — a name at 19, one session from breaking
   out, was indistinguishable from one at 1. The list is what the watch board
   publishes, and these are the two ways publishing it can go wrong: the count
   and the list disagreeing, or the count changing TYPE under a renderer that
   already reads it. */
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

/* ---------- the dated archive key --------------------------------
   flows_payload is keyed `id TEXT PRIMARY KEY` and the ingest upserts, so
   every morning's board:long destroyed yesterday's. The dated key is the
   record; the prune is what stops the record from being unbounded. Both are
   pure functions of the session date precisely so they can be tested here
   rather than discovered in a table nobody can query cheaply. */
{
  eq(datedKey("long", "2026-08-26"), "board:long:2026-08-26", "a dated board key is side and session");
  eq(datedKey("short", "2026-08-26"), "board:short:2026-08-26", "and both sides are dated");

  /* THE UNPRUNABLE ROW. sessionDate is legitimately null in this pipeline —
     resolveSessionDate falls back to undated vendor calls and says so — and
     "board:long:null" would be a key pruneKeys can never name, i.e. a row that
     lives forever in a table whose whole retention story is that every dated
     key is recomputable from a date. */
  eq(datedKey("long", null), null, "no session date yields NO key rather than an unprunable one");
  eq(datedKey("long", undefined), null, "and neither does an undefined one");
  eq(datedKey("long", ""), null, "nor an empty string");
  eq(datedKey("long", "2026-8-6"), null, "a non-ISO date is refused rather than normalised");
  eq(datedKey("long", "not-a-date"), null, "and so is anything else");
}

/* ---------- the prune is BOUNDED and it is PREDICTABLE ------------
   There is no `DELETE ... WHERE id LIKE 'board:%:%'` in this design and there
   must not be: the pipeline holds a route-scoped bearer rather than an
   account-scoped Cloudflare token, and a pattern delete is the operation whose
   row count nobody can state before it runs. The sweep names its keys. */
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
    /* The sweep names exactly the dated archive: the two board sides and the
       scores pool. Anything else in this list is the off-by-one that could
       name a live key, which is the blast radius the worker's DELETE gate
       and this pin both exist to contain. */
    const m = /^(?:board:(?:long|short)|scores):(\d{4}-\d{2}-\d{2})$/.exec(k);
    ok(m, `every swept key is a dated archive key and nothing else (${k})`);
    ok(Date.parse(m[1] + "T00:00:00Z") < Date.parse(session + "T00:00:00Z") - ARCHIVE_RETENTION_DAYS * 86400000,
       `${k} is strictly older than the retention window`);
  }
  ok(keys.some((k) => k.startsWith("scores:")),
     "and the dated scores pool IS in the sweep — an archive key the prune " +
     "does not name grows forever");

  /* THE BOUND, asserted after the shape checks so that a sweep which walks the
     wrong WAY is reported as a wrong boundary rather than as a wrong count. */
  eq(keys.length, 3 * ARCHIVE_PRUNE_LOOKBACK_DAYS,
     "THE BOUND: one run deletes at most three archive keys x the lookback " +
     "(two board sides and the scores pool), and that number is knowable before it runs");
  eq(new Set(keys).size, keys.length, "and never names the same row twice");

  // A key this pipeline never wrote must never be nameable by the sweep.
  ok(!keys.some((k) => k.startsWith("card:") || k === "meta" || k === "board:watch" ||
                       k === "board:long" || k === "board:short"),
     "the sweep cannot name a live key, a card or the meta row");

  eq(pruneKeys(null).length, 0, "no session date means no sweep rather than a sweep of garbage keys");
  eq(pruneKeys("2026-8-6").length, 0, "and neither does a malformed one");

  // The retention window is stated in calendar days because the KEYS are.
  ok(ARCHIVE_RETENTION_DAYS >= 120 && ARCHIVE_RETENTION_DAYS <= 135,
     "126 calendar days is 90 trading sessions at 5/7 — nine times the ten-session forecast horizon");
  ok(ARCHIVE_RETENTION_DAYS / 7 * 5 >= 9 * HORIZON_SESSIONS,
     "the window holds many multiples of the horizon, so the archive is a record and not a buffer");
}

/* ---------- a route that refuses does not get asked sixty times ----
   The sweep is sixty named DELETEs. If the ingest route does not accept the
   method at all — which is the state of the world the day this ships, since
   the route is declared GET and POST — then every one of those sixty fails
   identically, and the pipeline spends nine seconds a day and sixty log lines
   discovering the same fact. A 404 is different in kind: it is the ORDINARY
   answer for a day this pipeline never published, and treating it as a refusal
   would abandon the sweep on the first gap in the archive and leak every
   expired key behind it. */
{
  const http = await import("node:http");
  const prevUrl = process.env.FLOWS_INGEST_URL;
  const prevTok = process.env.FLOWS_INGEST_TOKEN;
  process.env.FLOWS_INGEST_TOKEN = "test-token";

  /* A SHORT SKIRT here on purpose: the property under test is the breaker and
     the 404 rule, and driving the production 60 through a 150ms publish spacing
     would put nineteen seconds into the suite to re-prove arithmetic pruneKeys
     already proves above. */
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

/* ---------- the watch board ---------------------------------------
   The names inside the dead band, ranked by how close they are to leaving it,
   carrying the three screener observables the pipeline has always computed and
   never displayed. surpriseTilt in particular — the log ratio of call-side to
   put-side volume surprise, each against the name's OWN 30-day norm — is the
   most conventional unusual-activity measure in the product and was used once
   as a pre-enrichment sort key and dropped. */
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
    /* B's 30-day volume norm is missing, which the vendor reports as no field
       at all. screenerTilt now answers null for that; NaN is kept here because
       the row builder must flatten EITHER unmeasured shape to null on the
       wire, and NaN is the one JSON would otherwise mangle. */
    ["B", { surpriseTilt: NaN, relVolume: NaN, putCallRatio: NaN }],
  ]);

  // Deliberately unsorted, and mixing signs: the ranking must come from the
  // magnitude, not from the input order and not from the sign.
  const pool = [mk("C", 3), mk("A", -19), mk("B", 12), mk("D", -7)];
  const rows = toWatchRows(pool, screener, tilts);

  eq(rows.map((r) => r.t).join(","), "A,B,D,C",
     "THE RANKING: the name CLOSEST to leaving the band is first, whichever side it is closest on");
  eq(rows.map((r) => r.r).join(","), "1,2,3,4", "and the published rank agrees with the order");

  /* ONE VOCABULARY. A watch row is a board row plus three columns. A second
     name for `px` or for `s` on this surface would mean a downstream scorer has
     to know which of two surfaces it is holding before it can read a close. */
  const board = toRows([mk("A", -19)], screener, []);
  eq(board.length, 1, "the board builder still produces a row");
  for (const key of Object.keys(board[0])) {
    ok(key in rows[0], `a watch row carries the board's own \`${key}\`, not a synonym for it`);
  }

  // Problem 3: w52, vrp and ivr are emitted on every board row and no renderer
  // has ever drawn them. Confirm they are there, on BOTH surfaces, unrenamed.
  for (const key of ["w52", "vrp", "ivr"]) {
    ok(board[0][key] !== undefined, `the board row still emits \`${key}\``);
    ok(rows[0][key] !== undefined, `and the watch row carries \`${key}\` too`);
  }
  /* THE TWO BUILDERS AGREE ON THE DEGENERATE CASE TOO.

     boardRow published `netPrem: 0` for a name the vendor quoted neither
     premium leg for, because num() answers 0 for an absent column. The board
     renders that column with fmtMoney and a tone class, so the reader was
     shown an explicit "$0" and a neutral tint where the truth was "not
     quoted" — a confident zero on the board's own table.

     It survived on the argument that a ranking of extremes never sees a zero.
     True, and beside the point: this is a DISPLAYED column. moverRow had
     already reached the opposite conclusion on the same two fields, and two
     builders disagreeing about one quantity is how a renderer ends up needing
     to know which surface produced its row. */
  {
    const base = screener.get("A");
    const withScreener = (extra) => new Map([["A", { ...base, ...extra }]]);
    const row = (map) => toRows([mk("A", -19)], map, new Map())[0];

    eq(row(withScreener({ net_call_premium: "900000", net_put_premium: "400000" })).netPrem,
       500000, "a quoted name publishes call premium minus put premium");

    /* NEITHER LEG ON THE WIRE. `base` carries no premium columns at all, which
       is exactly the shape the vendor sends for a name it did not quote. */
    eq(row(withScreener({})).netPrem, null,
       "and a name the vendor quoted NEITHER leg for publishes null, never a balanced zero");

    /* ZERO IS STILL A REAL READING when both legs are on the wire and cancel.
       A fix that turned every zero into null would trade one lie for another. */
    eq(row(withScreener({ net_call_premium: "250000", net_put_premium: "250000" })).netPrem, 0,
       "while two legs that genuinely cancel still publish zero, which is a measurement");

    /* ONE LEG IS ENOUGH TO BE A MEASUREMENT. A name with call premium quoted
       and no put premium has a real, signed net — treating it as unquoted
       would discard a reading the vendor actually sent. */
    eq(row(withScreener({ net_call_premium: "700000" })).netPrem, 700000,
       "and one quoted leg alone is a measurement, not an absence");
  }

  eq(board[0].w52, 0.42, "w52 is the 52-week position from the candles, unchanged in name and unit");
  eq(rows[0].w52, 0.42, "and the watch row publishes the SAME 52-week position, not a second one");

  // The three new columns, at the precision their source actually has.
  eq(rows[0].surpriseTilt, 1.235, "surpriseTilt is finally published, rounded to a thousandth");
  eq(rows[0].relVolume, 2.72, "relative volume at the two decimals the vendor quotes");
  eq(rows[0].putCallRatio, 0.877, "and the put/call ratio at three");

  /* A MISSING READING IS NULL, NEVER ZERO. Zero is a real value of
     surpriseTilt — it means call and put surprise are equal — so rendering an
     absent 30-day norm as 0 would publish "perfectly balanced unusual
     activity" for a name the vendor said nothing about. */
  const b = rows.find((r) => r.t === "B");
  eq(b.surpriseTilt, null, "a name with no 30-day volume norm reports null, not a balanced zero");
  eq(b.relVolume, null, "an absent relative volume is null, not a flat 0x");
  eq(b.putCallRatio, null, "an absent put/call ratio is null, not a call-only 0");

  // A name the screener tilt map has no entry for at all must not throw.
  const orphan = toWatchRows([mk("Z", 5)], screener, tilts);
  eq(orphan[0].surpriseTilt, null, "a name with no tilt row at all is null across the three columns");

  /* THE CAP. The band holds ~48 names on a normal session; the list is capped
     and truncates from the QUIET end, so what falls off is the names furthest
     from ever leaving the band. */
  const wide = toWatchRows(
    Array.from({ length: 90 }, (_, i) => mk("W" + i, 19 - (i % 19))), screener, new Map());
  eq(wide.length, WATCH_ROWS, `the watch list is capped at ${WATCH_ROWS} rows however wide the band is`);
  ok(Math.abs(wide[0].s) >= Math.abs(wide[wide.length - 1].s),
     "and the rows that survive the cap are the ones nearest the edge of the band");
  eq(toWatchRows([], screener, tilts).length, 0, "an empty band publishes an empty list, not a crash");
}

/* ---------- sector TRIX: the mathematics ------------------------- */
{
  /** A constant log drift of `driftBp` per session, oldest first. */
  const ramp = (n, driftBp, p0 = 100) => {
    const out = [];
    let logPx = Math.log(p0);
    for (let i = 0; i < n; i++) { out.push(Math.exp(logPx)); logPx += driftBp / 10000; }
    return out;
  };
  const last = (xs) => xs[xs.length - 1];

  /* THE RELATION HAS NO FREE PARAMETER IN IT. Under a constant log drift d the
     triple EMA converges on the same ramp and its first difference is exactly
     d, so a 200 bp/session ramp must read 200.00 bp and not 200-ish. */
  const up = trixSeriesBp(ramp(200, 200));
  near(last(up), 200, 1e-6,
       "TRIX of a constant 200 bp/session log ramp settles at exactly 200 bp");

  /* THE LOG IS LOAD-BEARING, and this is the assertion that proves it rather
     than asserting it. A difference of logs is exactly antisymmetric: a ramp
     down reads the negative of the same ramp up, to machine precision. The
     textbook percentage form (e3[t] - e3[t-1]) / e3[t-1] is NOT — it reads
     +202.0 against -198.0 on this pair, because a 2% gain and a 2% loss are
     not the same size in percent. */
  const down = trixSeriesBp(ramp(200, -200));
  near(last(up), -last(down), 1e-6,
       "THE LOG: a ramp down reads exactly the negative of the same ramp up");

  const flatSeries = trixSeriesBp(new Array(200).fill(100));
  eq(last(flatSeries), 0, "a price that never moves reads exactly 0 bp, not epsilon");

  /* THE PUBLISHED SCALING, applied by hand rather than by calling the code it
     is meant to check. */
  eq(scaleTrix(0), 50, "zero momentum is the midpoint of the scale, not the bottom");
  eq(scaleTrix(TRIX_FULL_SCALE_BP), 100, "the positive rail is the full-scale band");
  eq(scaleTrix(-TRIX_FULL_SCALE_BP), 0, "and the negative rail its mirror");
  eq(scaleTrix(TRIX_FULL_SCALE_BP * 4), 100, "past the rail it clamps rather than overflowing");
  eq(scaleTrix(NaN), null, "an unmeasurable reading scales to null, never to 50");
  ok(scaleTrix(TRIX_FULL_SCALE_BP / 2) > scaleTrix(TRIX_FULL_SCALE_BP / 4),
     "and inside the rails it is strictly monotone in the raw reading");
}

/* ---------- sector TRIX: the scaling rule is the product --------- */
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
  /** One session's eleven sectors, each on its own constant drift. */
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

  /* THE TEST THE BRIEF ASKS FOR, AND THE REASON MIN-MAX WAS REJECTED.

     A session in which every sector sat within half a basis point of flat, and
     a session in which the sectors ran from -40 bp to +45 bp, must not render
     the same. Under a cross-sectional min-max they render IDENTICALLY: both
     span exactly 0 to 100, because min-max always emits exactly one 0 and
     exactly one 100 whatever the inputs were. */
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

  /* THE IDENTIFICATION BAR, checked on the payload itself: every scaled
     reading is the PUBLISHED relation applied to the PUBLISHED raw reading,
     with no third input. The arithmetic is written out here rather than
     borrowed from scaleTrix, so this is a statement about the payload and not
     a tautology about the function.

     This is also what rules out the second rejected scaling. A percentile of
     each sector's own history is not a function of that sector's trixBp alone
     — two sectors on the same raw reading would scale differently — so it
     cannot satisfy this assertion at all. */
  for (const r of [...flat, ...rotating]) {
    const want = Number(
      (50 + 50 * Math.max(-1, Math.min(1, r.trixBp / TRIX_FULL_SCALE_BP))).toFixed(1));
    eq(r.trix, want,
       `${r.etf}: the scaled reading is exactly the published relation applied to the published raw bp`);
  }

  /* THE AXIS DOES NOT MOVE WITH THE COMPANY IT KEEPS. The same sector on the
     same drift must read the same number whether its ten neighbours were
     asleep or on fire — which is the property that makes yesterday's 62 and
     today's 62 the same basis points, and therefore the property that makes
     the published trend line mean anything. */
  const quiet = sectorTrix(day([20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const wild = sectorTrix(day([20, -90, 80, -70, 60, -50, 90, -80, 70, -60, 95]));
  eq(quiet[0].trix, wild[0].trix,
     "XLB on a 20 bp drift reads the same beside ten flat sectors as beside ten extreme ones");
  near(quiet[0].trix, 70, 0.2, "and that reading is the fixed relation's answer, 70");

  /* SATURATION ANNOUNCES ITSELF. Past the rail the scale stops
     distinguishing, so a reading that is sitting on one has to say so —
     otherwise a historic trend and an unprecedented one both print 100 and
     nothing in the payload separates them. */
  const extreme = sectorTrix(day([200, 10, -200, -10, 0, 0, 0, 0, 0, 0, 0]));
  eq(extreme[0].trix, 100, "a 200 bp sector prints the top of the scale");
  eq(extreme[0].clamped, true, "and declares itself clamped");
  eq(extreme[0].clampedPoints, TRIX_SERIES, "with every point of its drawn line on the rail");
  eq(extreme[2].trix, 0, "a -200 bp sector prints the bottom");
  eq(extreme[2].clamped, true, "and declares itself clamped too");
  eq(extreme[1].clamped, false, "a 10 bp sector is nowhere near a rail");
  eq(extreme[1].clampedPoints, 0, "and none of its line is pinned");

  /* THE PUBLISHED LINE IS A TREND LINE AND IT IS THE RECENT ONE.

     Every fixture above runs on a constant drift, and a constant drift makes a
     constant TRIX — thirty identical numbers — which cannot detect either of
     the two ways this series goes wrong: publishing the OLDEST window instead
     of the newest, or publishing the scalar thirty times. So this sector is
     genuinely flat for 195 sessions and then turns up at 40 bp, which puts the
     turn inside the published window and nowhere else. An oldest-first slice
     of the same data would be thirty readings of exactly 50. */
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

  /* THE SERIES IS DRAWABLE. Long enough for a shape, on the same 0-100 axis
     as the scalar, and ending on it. */
  for (const r of rotating) {
    eq(r.series.length, TRIX_SERIES, `${r.etf} publishes ${TRIX_SERIES} sessions of history`);
    ok(r.series.every((v) => Number.isFinite(v) && v >= 0 && v <= 100),
       `${r.etf}'s whole line sits on the published 0-100 axis`);
    eq(last_(r.series), r.trix, `${r.etf}'s line ends on the scalar it is published beside`);
  }
  function last_(xs) { return xs[xs.length - 1]; }
}

/* ---------- sector TRIX: unmeasured is null, never zero ---------- */
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
    ["XLB", candles(ramp(200, 20))],                 // healthy
    ["XLC", []],                                      // the endpoint answered nothing
    ["XLE", candles(ramp(46, 30))],                   // enough to compute, not enough to settle
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
    /* NEVER A CONFIDENT ZERO. On this scale 0 is the bottom rail — a maximal
       DOWNTREND — and 50 is "no momentum". Either would be a confident, wrong,
       readable claim about a sector nobody measured. */
    ok(r.trix !== 0 && r.trix !== 50, `${etf} is not rendered as a confident reading`);
    eq(r.trixBp, null, `${etf} publishes no raw reading either`);
    eq(r.series, null, `${etf} publishes no trend line`);
    eq(r.clamped, null, `${etf}'s clamp flag is null, not a definite false`);
    ok(typeof r.reason === "string" && r.reason.length > 10,
       `${etf} states WHY it is unmeasured: "${r.reason}"`);
  }
  eq(by.get("XLB").reason, null, "and a measured sector carries no reason");

  ok(/no candles/.test(by.get("XLC").reason), "an empty response says so");
  /* The reason text is tied to the EXPORTED constant rather than to a literal,
     so a change to the warm-up cannot leave the published sentence claiming a
     minimum the code no longer enforces. */
  ok(new RegExp(`^46 usable XLE closes of 46 returned; ${TRIX_MIN_CANDLES} are needed`)
       .test(by.get("XLE").reason),
     `a short series names both what it had and what it needed: "${by.get("XLE").reason}"`);

  /* THE WARM-UP GATE IS SUBSTANTIVE, not a formality. 46 candles is plenty to
     run the arithmetic — it just runs it on a smoother that is still
     remembering its seed, and the answer is materially wrong. */
  const unsettled = trixSeriesBp(ramp(46, 30));
  ok(Math.abs(unsettled[unsettled.length - 1] - 30) > 1.5,
     `and the unsettled reading really was different (${unsettled[unsettled.length - 1].toFixed(2)} bp against a true 30.00)`);
  const settled = trixSeriesBp(ramp(TRIX_MIN_CANDLES, 30));
  near(settled[settled.length - 1], 30, 0.1,
       "while at the published minimum the same ramp reads its true drift");

  /* THE CLEAN TAIL. A bad candle inside the published window takes the sector
     out; a bad patch from a year earlier does not, because the reading is
     computed on the longest run of good closes ENDING AT THE LAST BAR. */
  ok(/^2 usable XLF closes of 200 returned/.test(by.get("XLF").reason),
     `a zero close three sessions ago takes the sector out: "${by.get("XLF").reason}"`);
  ok(by.get("XLI").trix !== null,
     "but a bad candle 224 sessions ago does NOT — the reading is computed on the clean tail");
  near(by.get("XLI").trixBp, 20, 0.05,
     "and that tail reads its true drift, so the bad bar left nothing behind in the smoother");
}

/* ---------- movers and premium: zero API calls ------------------- */
{
  const mk = (ticker, opts = {}) => ({
    ticker,
    close: String(opts.close === undefined ? 100 : opts.close),
    prev_close: String(opts.prev_close === undefined ? 100 : opts.prev_close),
    sector: opts.sector === undefined ? "Technology" : opts.sector,
    net_call_premium: String(opts.nc === undefined ? 0 : opts.nc),
    net_put_premium: String(opts.np === undefined ? 0 : opts.np),
  });
  /* Columns are removed by DELETING them, not by setting them to 0 or "".
     Every one of these tests is about the difference between "the vendor sent
     zero" and "the vendor sent nothing", so a helper that conflated the two
     would test the opposite of what it claims. */
  const strip = (row, ...keys) => {
    const out = { ...row };
    for (const k of keys) delete out[k];
    return out;
  };
  const tilt = (relVolume, surpriseTilt) => ({ relVolume, surpriseTilt });

  /* THE ZERO-CALL GUARANTEE, made structural. A synchronous function cannot
     await a fetch, so this surface cannot quietly acquire an API cost later
     without the change being obvious in the diff. The whole justification for
     the movers band is that the screener rows were already paid for. */
  const probe = buildMovers([{ row: mk("A", { close: 101 }), tilt: {} }]);
  ok(!(probe instanceof Promise),
     "THE BUDGET: buildMovers is synchronous — a surface that cannot await cannot make an API call");

  /* A day with a clear top and bottom, plus the two things that must not be
     fabricated: a name the vendor quoted no prior close for, and a name it
     quoted no premium for at all. */
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

  /* BOTH DIRECTIONS, CLEARLY SEPARATED, AND EACH LEADING WITH ITS LARGEST. */
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

  /* THE UNIT. chg is a FRACTION of the prior close, exactly as boardRow
     publishes it: 0.1 is +10%, not 10 and not 0.001. */
  eq(m.risers.find((r) => r.t === "UP1").chg, 0.1, "chg is a fraction of the prior close");
  eq(m.fallers.find((r) => r.t === "DN1").chg, -0.1, "signed, with the same unit in both directions");

  /* A MISSING PRIOR CLOSE IS NOT A ZERO MOVE. The name is excluded from the
     ranking and COUNTED, so that if the vendor ever stops sending prev_close
     the payload reports "nothing could be ranked" instead of "nothing moved". */
  eq(moverRow(strip(mk("X"), "prev_close"), {}).chg, null,
     "a name with no prior close reports a null move, never 0");
  eq(m.unrankedChange, 1, "and is counted as unranked rather than silently dropped");
  eq(m.ranked, rows.length - 1, "the ranked population is published beside the lists");
  ok(!m.risers.some((r) => r.t === "NOPREV") && !m.fallers.some((r) => r.t === "NOPREV"),
     "it appears on neither list");

  /* LARGEST NET PREMIUM, BY NAME, IN EACH DIRECTION. */
  eq(m.premium.basis, "byName",
     "the premium lists say they are BY NAME — per-contract needs a flow-alerts endpoint this key cannot reach");
  eq(m.premium.bullish.map((r) => r.t).join(","), "UP1,NOPREV,UP2",
     "the bullish list leads with the largest net call-over-put premium");
  /* THE TWO RANKINGS ARE INDEPENDENT. NOPREV cannot be ranked on change at all
     and still carries the second-largest premium of the day, which is the
     whole reason the unranked counts are per-question rather than one number:
     a name is missing from a list because THAT column was missing, not because
     the name was unusable. */
  ok(m.premium.bullish.some((r) => r.t === "NOPREV"),
     "a name with no prior close is still ranked on premium — the two lists gate independently");
  eq(m.premium.bearish.map((r) => r.t).join(","), "DN1,DN2",
     "and the bearish list leads with the largest net put-over-call premium");
  eq(m.premium.bullish[0].netPrem, 10_000_000,
     "netPrem is net call premium minus net put premium, in signed dollars");
  eq(m.premium.bearish[0].netPrem, -9_000_000, "negative on the put side");
  ok(!m.premium.bullish.some((r) => r.t === "FLAT") && !m.premium.bearish.some((r) => r.t === "FLAT"),
     "a name whose two premium legs cancel is on neither list");

  /* AN UNQUOTED PREMIUM IS NOT A BALANCED ONE. num() answers 0 for a column
     the vendor never sent, and on a surface whose whole subject is premium
     that 0 would be a published claim of perfect balance. */
  eq(m.risers.find((r) => r.t === "NOPREM").netPrem, null,
     "a name the screener quoted no premium for reports null, never a balanced zero");
  eq(m.unrankedPremium, 1, "and is counted out of the premium population");
  eq(m.priced, rows.length - 1, "which is published too");

  /* THE COLUMNS THE BRIEF ASKS FOR, at the precision their source has. */
  const up1 = m.risers.find((r) => r.t === "UP1");
  eq(up1.relVolume, 3.2, "relative volume rides along at the two decimals the vendor quotes");
  eq(up1.surpriseTilt, 0.51, "so does surpriseTilt, at three");
  eq(up1.sector, "Technology", "and the vendor's own sector string, verbatim");
  eq(moverRow(mk("Y", { sector: null }), {}).sector, null, "an absent sector is null, not an empty string");
  eq(moverRow(mk("Y"), {}).relVolume, null, "a name with no tilt row reports null rather than 0x volume");
  eq(moverRow(mk("Y"), null).surpriseTilt, null, "and does not throw when there is no tilt at all");
}

/* ---------- movers: one vocabulary, and the thin-side rule ------- */
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

  /* ONE ROW VOCABULARY ACROSS SURFACES. This file already carries the scar
     from inventing a `px` on one surface and a `close` on another; a renderer
     then has to know which surface it is holding. */
  for (const k of ["t", "px", "chg", "netPrem"]) {
    ok(k in mrow, `the mover row uses the board's name for \`${k}\``);
    eq(mrow[k], k === "netPrem" ? Math.round(b[k]) : b[k],
       `and the board's RELATION for \`${k}\`, not a second one that disagrees`);
  }
  for (const k of ["relVolume", "surpriseTilt"]) {
    ok(k in mrow, `and the watch list's name for \`${k}\``);
  }

  /* A THIN SIDE IS INFORMATION. On a day the whole market rose, the fallers
     list is EMPTY — not filled with the fifteen names that rose least under a
     heading that says they fell. */
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

/* ---------- the two new payloads, as the pipeline actually emits them ------

   The blocks above test the builders. This one tests the WIRING, which is a
   different thing and is where the interesting mistake lives: buildMovers is
   correct for whatever population it is handed, so a unit test cannot tell
   `withTilt` (the whole eligible universe) from `tilted` (the earnings-gated
   subset the board is selected from). Handing it the wrong one would publish
   "the day's biggest movers, among the names that do not report soon" under a
   heading that claims otherwise, and every pure test would still pass.

   The payload catches it because it publishes its own population: `universe`
   is the board's count, and `ranked + unrankedChange` has to add up to it. */
{
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "flows-emit-")) + "/e";
  /* BOTH STREAMS. The probe reports through console.log and every refusal
     through console.warn, so a capture of stdout alone reads "one probe, zero
     truncations" — which is exactly the shape this assertion exists to rule
     out, and it would have passed. */
  const run = spawnSync(process.execPath,
               ["../scripts/flows-pipeline.mjs", "--dry-run", "--emit", prefix],
               { cwd: import.meta.dirname, encoding: "utf8" });
  eq(run.status, 0, "the dry run exits clean");
  const runLog = run.stdout + run.stderr;

  /* THE PROBE IS SPENT ONCE PER RUN, NOT ONCE PER TRUNCATED NAME.

     This is a cost assertion, and it needs the whole run to make it: the
     fixture truncates two names precisely so that "once" and "once per
     truncated name" are different numbers here. On the live board of
     2026-08-26 they differed by nine vendor calls — spent, at the very end of
     the run, on re-asking a question whose answer cannot vary by ticker. */
  const probeLines = runLog.split("\n").filter((l) => l.includes("chain probe"));
  eq(probeLines.length, 1,
     "exactly one truncation probe is spent per run, however many names truncate");
  /* EVIDENCE THAT MORE THAN ONE NAME TRUNCATED, taken from the recovery count
     rather than from the refusal messages.

     It used to count "no skew — the vendor returned a full page" lines, which
     was the right evidence right up until truncation stopped implying a
     refusal. Once the single-expiry read landed, a truncated name recovers its
     scalars and prints no refusal at all — so the old assertion read zero and
     failed, correctly, on a change that made the product better. The count
     that still measures truncation is the one that counts what truncation now
     COSTS: a second vendor call. */
  const recovered = /(\d+) of them recovered by a second single-expiry call/.exec(runLog);
  ok(recovered && Number(recovered[1]) >= 2,
     `and the fixture really does truncate more than one name (${recovered ? recovered[1] : 0} ` +
     "recovered), so the probe count above is a measurement rather than an accident of there " +
     "being only one candidate");
  const read = (key) => JSON.parse(fs.readFileSync(`${prefix}-${key}.json`, "utf8"));
  const board = read("board-long");
  const movers = read("movers");
  const trix = read("sector-trix");

  /* THE EXPENSIVE LEGS SPEND ONLY ON THE NAMES THE BOARD SAYS THEY DID.

     The board is free to widen — it is built from data already fetched — so it
     is ~93 rows. A chain is one vendor call and a card is two, so those legs
     are capped at DEEP_NAMES and the rows that got one are stamped `dp`.

     Nothing about a card built for a 94th name looks wrong: it renders
     perfectly, it is correct, and it costs three calls that the deadline
     budget did not allocate. So the assertion is an EQUALITY between two
     independently-derived sets — the cards actually emitted, and the rows that
     claim to have one — rather than a bound on either alone. A cap enforced in
     the chain leg but not the card leg would satisfy any looser check. */
  {
    const emitted = new Set(fs.readdirSync(path.dirname(prefix))
      .map((f) => /-card-(.+)\.json$/.exec(f))
      .filter(Boolean).map((m) => m[1]));
    const claimed = new Set();
    const long = read("board-long"), short = read("board-short");
    for (const b of [long, short]) {
      for (const r of b.rows) if (r.dp) claimed.add(r.t);
    }
    ok(emitted.size > 0, `the dry run emitted ${emitted.size} cards`);
    ok(emitted.size <= DEEP_NAMES,
       `and no more than the ${DEEP_NAMES}-name deep budget (${emitted.size}), however wide the board got`);
    assert.deepEqual([...emitted].sort(), [...claimed].sort(),
      "the cards that exist are EXACTLY the rows that advertise one — a row promising a card " +
      "the pipeline never wrote opens a 404, and a card nobody links to is three calls burned"); checks++;

    const total = long.rows.length + short.rows.length;
    ok(total > emitted.size,
       `the board (${total} rows) is genuinely wider than the deep set (${emitted.size}), so this ` +
       "equality is a measurement rather than a tautology over a board where every row is deep");
    eq(long.deep, long.rows.filter((r) => r.dp).length,
       "the published `deep` count agrees with the rows it counts");
    ok(typeof long.deepRule === "string" && long.deepRule.length > 40,
       "and the rule that chose them is published in words, not left to be inferred from which rows are clickable");
  }

  /* ---------- the market-wide join: coverage that is a MEASUREMENT ------

     The two feeds this joins are market-wide reads the pulse leg already
     makes once a run, so the join costs no vendor call. What it can cost a
     reader is a wrong impression, and the wrong impression has a shape: a
     join that reaches three of fifty names leaves forty-seven cards each
     saying "not in this feed", which reads as forty-seven findings and is
     one thin join.

     THE COVERAGE COUNT IS THEREFORE CHECKED AGAINST THE CARDS THEMSELVES —
     two independently-derived numbers, the way the deep-set equality above
     is. A coverage number computed from a different population than the one
     the cards were built for would be a plausible integer on every card and
     nothing would look wrong. */
  {
    const cardFiles = fs.readdirSync(path.dirname(prefix))
      .filter((f) => /-card-.+\.json$/.test(f))
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
      /* THE PANEL MUST BE ABLE TO SAY BOTH THINGS, or half of it is untested
         wiring: at least one card in the feed and at least one outside it. */
      ok(placed > 0 && placed < cardFiles.length,
         `and the corpus exercises both arms: ${placed} of ${cardFiles.length} names place ` +
         "in this feed, so neither the reading nor the measured absence is checked against " +
         "an empty set");
      /* Every card agrees about the cross-section, because there is exactly
         one: the index is built once for the run. Fifty cards each indexing
         a hundred rows could disagree about the ordering or the unit and no
         single card would look wrong. */
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

    /* THE RANK IS FROM ANOTHER SESSION, AND THE RUN SAYS SO OUT LOUD. The
       vendor updates /market/oi-change at about 06:45 ET and the cron fires
       at 05:15 ET, so this is the ordinary case rather than an edge one. */
    ok(/cross oiChange: \d+ of \d+ deep name/.test(runLog),
       "the run reports the join's own reach once, rather than leaving it to be counted " +
       "off fifty cards");
    ok(/NOT this run's session/.test(runLog),
       "and reports that the market-wide ranking it joined is from a different session than " +
       "the per-name data it joined it onto — the log line that makes the timing trap " +
       "visible in a job log rather than only on a card");

    /* THE REQUESTED LIMIT IS THE PUBLISHED ONE. A card that says "14 of 100"
       while the run asked for 40 is a fabricated denominator. */
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


  /* THE POPULATION INVARIANT. Every name the movers band was handed is either
     ranked or explicitly counted as unrankable, and the total is the same
     universe the board reports. */
  eq(movers.universe, board.universe,
     "THE MOVERS ARE RANKED OVER THE BOARD'S OWN UNIVERSE, not over the earnings-gated subset");
  eq(movers.ranked + movers.unrankedChange, movers.universe,
     "and every one of those names is either ranked or counted as unrankable — none quietly vanish");
  /* THE INVARIANT ONLY BITES IF THE TWO NUMBERS CAN DIFFER. The synthetic
     screener withholds prev_close on five rows in 420 precisely so that
     `universe` and `ranked` are not the same integer here — otherwise an
     implementation that published the ranked count as the universe would
     satisfy the line above trivially, which is how a fixture passes while
     proving nothing. */
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

  /* THE CHOICE IS DECLARED IN THE PAYLOAD, which is the whole of this
     project's identification bar for a quantity that is not recoverable from
     observables alone. A reader holding this blob and nothing else can
     reproduce every scaled reading, and undo it if they disagree. */
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

  /* THE UNMEASURED PATH RUNS ON EVERY DRY RUN, on purpose. A fixture in which
     all eleven sectors succeed never executes the branch this project has been
     burned by most. */
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

  /* ---------- the record, as the dry run emits it ----------

     A dry run has no store to read, so the record leg replays the current
     boards at prior candle dates — synthetic sessions over synthetic closes.
     What can be asserted here is the WIRING and the payload's own coherence:
     the pinned renderer shape, the horizons ladder, the honesty strings
     carried verbatim, and the exclusions that keep the IC table from ranking
     share prices. */
  /* THE PUBLISH ITSELF IS THE ASSERTION. `record` was an accepted, served
     and rendered key that NOTHING EVER WROTE — the page promised a record
     the pipeline could not fill. A missing emit file must fail by name
     here, not as an ENOENT stack trace fifty lines down. */
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
  for (const key of ["method", "selection", "overlap", "calendar"]) {
    ok(typeof feat[key] === "string" && feat[key].length > 20,
       `the ${key} statement rides the payload`);
  }
  ok(/not side-signed/.test(feat.method), "and the method names the return convention");

  /* ---------- the corpus must be able to reach the change layer ------

     THE FIXTURE THAT COULD NOT EXECUTE THE BRANCH IT CERTIFIED — caught by
     reading an emitted payload rather than by any assertion, which is exactly
     why these lines exist.

     collectDatedBoards' dry-run arm pushed the CURRENT board once per prior
     day, the same object twenty-two times, so every name carried an identical
     score across the whole window. Against the backfill path that was a
     perfectly good fixture: the walk, the dedup and the window cut were all
     exercised, and the comment above it said as much.

     What a constant series cannot exercise is any question about CHANGE.
     Measured on the corpus the moment the change layer shipped: 94 names
     comparable, ZERO moved, 94 held, every run length exactly 23, zero
     crossings of any kind, and not one name carrying a residual difference.
     Four branches certified by a corpus that could not reach one of them —
     and every suite over that corpus passed, because a suite cannot see the
     absence of a case it was never handed.

     So the branches are asserted as REACHED, not merely as correct. The unit
     fixtures in flows-scores-contract prove the arithmetic; these prove the
     corpus every other suite runs over can get to it. */
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

    /* THE BOARD'S EARNINGS COLUMN, on the same principle. The screener
       generated a date for 15% of rows inside a 0-19 day window, three
       quarters of which the twelve-day gate then removed — so the emitted
       corpus carried ONE board row in 96 with an earnings date: a branch that
       technically executed and proved nothing. */
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


  /* ---------- the chain leg, as the dry run emits it ----------

     The leg is fifty vendor calls the dry run does not make, so what is
     asserted here is the WIRING: that the three scalars reached the board row
     in the right place, that the dated copy carries them too (which is the
     whole point — a skew percentile exists only from the first session that
     archived a skew), and that the four panels reached the card. */
  const boardShort = read("board-short");
  const chainCols = ["skew", "term", "atmIv", "skewDays"];
  for (const [side, b] of [["long", board], ["short", boardShort]]) {
    ok(b.rows.length > 0, `the ${side} board has rows to carry the chain columns`);
    const keys = Object.keys(b.rows[0]);
    for (const col of chainCols) {
      ok(keys.includes(col), `${side} rows carry \`${col}\``);
    }
    /* APPENDED, NEVER INSERTED. The board table binds columns positionally, so
       a field added anywhere but the end shifts every column after it under a
       heading that no longer describes it. */
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

  /* THE DATED COPY IS THE ARCHIVE, and it must carry what the live board
     carries or the history the scalars exist for never accumulates. Byte
     identity is the invariant: the re-publish writes the SAME object twice. */
  const datedLong = JSON.parse(fs.readFileSync(`${prefix}-board-long:${board.sessionDate}.json`, "utf8"));
  assert.deepEqual(datedLong, board,
    "THE DATED BOARD IS BYTE-IDENTICAL TO THE LIVE ONE at final state, chain columns included — " +
    "the re-publish writes one object to two keys rather than reconstructing it"); checks++;

  /* The card's four chain panels. */
  const cardFile = fs.readdirSync(path.dirname(prefix))
    .find((f) => /-card-[A-Z0-9]+\.json$/.test(f));
  ok(cardFile, "the dry run emitted a card");
  const card = JSON.parse(fs.readFileSync(path.join(path.dirname(prefix), cardFile), "utf8"));
  /* THE SCHEMA VERSION DOES NOT MOVE FOR AN ADDITION. It is a contract with
     the renderer about MEANING: it went to 2 when fam.V and fam.O stopped
     being signed votes and became unsigned gauges, so a renderer switching on
     it could refuse to redraw a published 53 as a 53%-full gauge it never
     meant. Four new panels change nothing that already existed — an older
     renderer simply has no host for them and an older payload simply lacks
     the keys, which is the transitional story every panel here already tells.
     Bumping the number for an addition would spend the one signal that means
     "a field you already draw now means something else". */
  eq(card.v, 2, "the schema version is unmoved: these panels are additions, not redefinitions");
  for (const key of ["ivSurface", "skewTerm", "topContracts", "aggressor"]) {
    const panel = card.panels[key];
    ok(panel, `the card carries panels.${key}`);
    ok(panel.status === "ok" || (panel.status === "unavailable" && panel.reason),
       `and it is either built or unavailable WITH a reason (${key}: ${panel.status})`);
  }
  /* The surface is parallel arrays, and every matrix is the same shape — a
     renderer reads them by index, so a ragged one would draw a lie. */
  const surf = card.panels.ivSurface;
  if (surf.status === "ok") {
    for (const key of ["iv", "skew", "traded", "strike"]) {
      eq(surf[key].length, surf.rows.length, `surface.${key} has one row per ladder row`);
      ok(surf[key].every((r) => r.length === surf.expiries.length),
         `and one column per expiry (${key})`);
    }
  }

  /* THE EMITTED BOARDS, LOADED ONCE AND ASSERTED TO EXIST.

     A FILE THAT IS NOT THERE MUST FAIL, NOT SKIP. The first version of the
     agreement-count block below built its path as `-board-long.json` when the
     emitter writes `e-board-long.json`, then guarded the read with
     `if (!fs.existsSync(full)) continue;`. Every assertion in it was skipped
     silently — the suite reported its total and none of those checks had run.
     A test that passes by not executing is worse than a missing test, because
     it reads as coverage. So the path is built from the emitter's own prefix
     and the file's absence is an assertion, not a branch. */
  const boardFile = (side) => prefix + `-board-${side}.json`;
  const readBoard = (side) => {
    const full = boardFile(side);
    ok(fs.existsSync(full), `the dry run emitted board:${side} at ${path.basename(full)}`);
    return JSON.parse(fs.readFileSync(full, "utf8"));
  };

  /* ---------- every scored name reaches a surface, or is counted -----

     THE PRODUCT'S RULE IS THAT THE DEAD BAND DECIDES: a name outside it is a
     signal and goes on a board, a name inside it goes on the watch list. The
     rule was not quite true. `boardSize` truncates each side, and the
     overflow reached NEITHER surface — the watch list holds only the names
     inside the band, so a name that cleared the threshold and ranked 51st on
     its side simply vanished.

     Measured on the emitted corpus before the fix: 100 scored, 3 inside the
     band, 97 therefore cleared it, 93 published. Four names fully scored,
     past the threshold this product names as the threshold, on no surface at
     all — and no published number from which a reader could work out that
     they existed.

     This is the assertion that closes the arithmetic, and it is written as a
     conservation law rather than as four separate counts, because that is the
     property that actually matters: nothing scored may go missing unrecorded. */
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

    /* THE CONSERVATION LAW. Every scored name is inside the band or outside
       it; the ones outside are on a board or counted as shed. If this ever
       fails, some name was scored and went missing with nothing saying so —
       which is the whole defect, restated as arithmetic. */
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

    /* AND THE FIXTURE ACTUALLY EXERCISES THE SHEDDING BRANCH. A corpus where
       nothing is ever shed would pass every assertion above while proving
       nothing about the case they exist for. */
    ok(shed > 0,
       `the emitted corpus really does shed names (${shed}), so these assertions are ` +
       `about a branch that runs rather than one that never fires`);

    /* THE WATCH LIST IS THE OTHER HALF, and it is not where shed names go.
       Asserting this is what stops a future "fix" that quietly dumps the
       overflow onto the watch list, where it would read as "inside the band"
       — a wrong reading rather than a missing one. */
    if (boards.watch) {
      const banded = new Set(boards.watch.rows.map((r) => r.t));
      for (const r of [...boards.long.rows, ...boards.short.rows]) {
        ok(!banded.has(r.t),
           `${r.t} is on a ranked board, so it is NOT also on the watch list — the two ` +
           `surfaces partition the pool, they do not overlap`);
      }
    }
  }

  /* ---------- the board says what its own sort key is made of --------

     THE BOARD RANKS ON A COMPOSITE AND PUBLISHED ONLY THE COMPOSITE.
     Conviction is 0.45·agreement + 0.35·coverage + 0.20·persistence, and the
     heaviest term is a COUNT of how many signed axes point the same way — so
     the largest single input to the sort key stepped, invisibly, and two
     names ten points apart might differ by a whole axis or by nothing at all.
     On this corpus the values cluster at 60-66, 75-82 and 90-96, one cluster
     per agreement level.

     Counts, not the ratio: agree/present is a fraction of two small integers
     that no decimal holds, so a board rounding it to three places publishes
     0.667 for two-of-three and any consumer multiplying back is doing
     arithmetic on a rounding error. */
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

  /* ---------- the composite can be re-done from the card -------------

     A PUBLISHED BLEND WHOSE TERMS DO NOT RECONSTRUCT IT IS A LIE, and until
     this assertion existed nothing checked. The card published two of the
     three terms and none of the weights, so the number could be described
     and not verified. */
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
    /* THE CLAMPED COVERAGE, not the raw measurement: a name whose coverage
       came in above 1 would close the identity in the pipeline and fail it
       here if the wrong one of the two shipped. */
    ok(conv.coverage >= 0 && conv.coverage <= 1,
       "the published coverage is the clamped value the arithmetic used");
    ok(conv.persistence >= 0 && conv.persistence <= 1, "and likewise persistence");
  }

  /* ---------- the basis check reaches the reader ---------------------

     THE MEASUREMENT EXISTED AND WAS THROWN AWAY. describeOiBasis has run on
     every chain since it was written — arithmetic over rows already in memory
     — and the pipeline logged one of them and published none. Meanwhile the
     top-contracts caption told readers ΔOI was "what stuck overnight, as
     against what churned", which asserts the open-interest pair and the
     volume span the same interval. The check exists precisely to test that,
     and on live rows it has refuted it. A maintainer reading a job log knew;
     a reader holding the table did not.

     So this pins the plumbing: the counts must arrive on the panel that
     prints the column they judge, and on no other. */
  const tc = card.panels.topContracts;
  if (tc.status === "ok") {
    const basis = tc.oiBasis;
    ok(basis && typeof basis === "object",
       "the top-contracts panel publishes the open-interest basis check it was measured with");
    ok(Number.isFinite(basis.seen) && basis.seen >= 0,
       "carrying how many contracts could be checked at all");
    ok(["no-data", "falsified", "inconclusive"].includes(basis.verdict),
       `and one of the three verdicts, never a bare number (got ${basis.verdict})`);
    /* THE FLOOR TRAVELS OR THE COUNT IS UNREADABLE. The check runs only over
       contracts clearing UA_MIN_VOLUME, so `seen` is a subset of the rows on
       screen; "2 of 105" beside a ten-row table is not a contradiction, but
       only if the reader is told what the 105 were drawn from. */
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
  /* AND ON NO OTHER PANEL. Three of the four chain panels do not print ΔOI;
     publishing the check on them would be a field no renderer reads, which
     the payload/renderer contract would then have to carry forever. */
  for (const key of ["ivSurface", "skewTerm", "aggressor"]) {
    ok(!("oiBasis" in card.panels[key]),
       `panels.${key} does not carry the basis check — it prints no open-interest change to judge`);
  }

  /* The two free screener readings that were parsed and dropped for months. */
  const pm = card.panels.pricedMove;
  ok("atmVol" in pm, "the priced-move panel finally publishes the vendor's own at-the-money vol");
  ok(Array.isArray(pm.ivStrip) && pm.ivStrip.length === 4,
     "and a four-point history of this name's 30-day implied vol, at zero extra calls");
  assert.deepEqual(pm.ivStrip.map((p) => p.h), ["−1m", "−1w", "−1d", "now"],
    "ordered oldest to newest, so a renderer draws it left to right without inventing an order"); checks++;

  /* ---------- the rate limiter's floor -------------------------------

     THE DEFECT THIS PINS WAS SHIPPED AND MEASURED. From the first version of
     this pipeline until 2026-08-26, the 429 branch carried the comment "raise
     the floor permanently" over code that raised only the current delay; the
     decay on a clean response clamped to an immutable RATE.minDelayMs, so six
     clean responses walked it back to the 60ms that had earned the 429 in the
     first place. The live run of that morning: 408 calls, 43 rate-limited, and
     a final inter-call delay of exactly 60ms — a controller that observed 43
     refusals and concluded nothing.

     The lesson is about WHERE the assertion goes. Every piece was individually
     reasonable; the bug lived in the wiring between them, so the fix moved the
     wiring into a pure function and these assertions hold the invariant over
     the thing that actually runs. */
  {
    // The floor rises and never falls, no matter how long the quiet spell.
    let s = { delayMs: RATE.startDelayMs, floorMs: RATE.minDelayMs };
    s = stepRateController(s, "limited");
    const afterLimit = s.floorMs;
    ok(afterLimit > RATE.minDelayMs, "a 429 raises the floor above the starting minimum");
    for (let i = 0; i < 200; i++) s = stepRateController(s, "ok");
    eq(s.floorMs, afterLimit, "and two hundred clean responses do not lower it again");
    ok(s.delayMs >= afterLimit,
       `the delay decays to the raised floor and stops there (${Math.round(s.delayMs)}ms ` +
       `>= ${Math.round(afterLimit)}ms) — the exact assertion the shipped code failed`);

    /* THE MUTATION THIS KILLS: clamping the decay to RATE.minDelayMs instead
       of to floorMs. That is not a hypothetical mutation — it is the code that
       ran in production, and under it this next line reads 60. */
    ok(s.delayMs > RATE.minDelayMs,
       "and it does NOT settle back at RATE.minDelayMs, which is what the defect did");

    // Repeated 429s converge on the ceiling rather than running away to maxDelayMs.
    let t = { delayMs: RATE.startDelayMs, floorMs: RATE.minDelayMs };
    for (let i = 0; i < 50; i++) t = stepRateController(t, "limited");
    eq(t.floorMs, RATE.floorCeilingMs,
       "fifty consecutive 429s pin the floor at its ceiling, not at maxDelayMs");
    ok(RATE.floorCeilingMs < RATE.maxDelayMs,
       "and the floor's ceiling is strictly below the per-call backoff ceiling: a single " +
       "call may sleep 5s, but every call may not");

    /* A 500 IS NOT A RATE LIMIT. Raising the floor on a transport failure
       would slow the whole run for a reason that has nothing to do with the
       key's tier — and 5xx storms are exactly when the run can least afford
       it. */
    const before = { delayMs: 300, floorMs: 240 };
    eq(stepRateController(before, "error").floorMs, 240,
       "a 5xx or a transport failure backs off WITHOUT teaching the floor anything");

    /* THE DEADLINE HAS TO SURVIVE THE FLOOR. A floor that fits the budget but
       eats the card window has only changed which surface goes missing, so the
       reserve is subtracted. */
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

    /* ---- the ingest lane, stated as the incident rather than as a number ----

       THE ONE RATE THE EDGE HAS EVER REFUSED is 37 POSTs inside eleven
       seconds, and publish()'s comment concludes the challenge was "purely a
       function of burst rate". It cost two payloads silently — `sector:trix`
       never landed and `board:long` kept its pre-chain copy.

       THE LANE MAKES DEPARTURES EVEN, which is why this is expressible as an
       invariant at all: with one departure every PUBLISH_SPACING_MS, the most
       POSTs that can enter any eleven-second window is exactly
       11000/PUBLISH_SPACING_MS, no matter how many workers are producing. That
       number must stay under the 37 that was refused.

       ASSERTED AS THE WINDOW, NOT AS THE CONSTANT, because a test that pins
       150 or 400 only tells the next reader what the number is. This one tells
       them what it is FOR, and it fails for the right reason: the lane was set
       to 150ms, which admits 73 POSTs in eleven seconds — twice the refused
       shape — and the comment above it claimed that was "comfortably under".
       Nothing in this suite disagreed, which is how an inverted comparison
       survived in a file this careful. */
    const REFUSED_POSTS = 37, REFUSED_WINDOW_MS = 11000;
    const admits = REFUSED_WINDOW_MS / PUBLISH_SPACING_MS;
    ok(admits < REFUSED_POSTS,
       `the ingest lane cannot put ${REFUSED_POSTS} writes into ${REFUSED_WINDOW_MS / 1000} ` +
       `seconds: at ${PUBLISH_SPACING_MS}ms the most any such window holds is ` +
       `${admits.toFixed(1)}, against the ${REFUSED_POSTS} that drew a Cloudflare challenge ` +
       "and lost two payloads on the first wide-board run");

    /* AND THE CARDS LEG IS THE STRETCH THAT SATURATES IT. Fifty card writes
       queue back to back since the leg was pooled; every other write on this
       route trickles. If the lane ever admits them faster than the refused
       shape, it is this leg that will draw the challenge. */
    const CARD_WRITES = 50, INGEST_WRITES_PER_RUN = 162;
    const cardsSeconds = (CARD_WRITES * PUBLISH_SPACING_MS) / 1000;
    ok(cardsSeconds > (CARD_WRITES / REFUSED_POSTS) * (REFUSED_WINDOW_MS / 1000),
       `and the pooled cards leg is stretched past the refused shape: ${CARD_WRITES} writes ` +
       `take ${cardsSeconds.toFixed(1)}s, where the refused run put ${REFUSED_POSTS} into ` +
       `${REFUSED_WINDOW_MS / 1000}s — so the one stretch that saturates this lane is slower ` +
       "than the burst that drew the challenge, not faster");

    /* THE COST IS AN ASSERTION TOO, so raising the spacing can never be a free
       decision made quietly. This is the whole run's ingest traffic against
       the 1502s the last measured run took under a 2700s job kill. */
    const laneSeconds = (INGEST_WRITES_PER_RUN * PUBLISH_SPACING_MS) / 1000;
    ok(laneSeconds < 120,
       `and the whole run's ${INGEST_WRITES_PER_RUN} ingest writes cost ` +
       `${laneSeconds.toFixed(1)}s of lane — bounded here so that buying burst safety with ` +
       "spacing stays a trade someone has to justify against a 1502s run, rather than a " +
       "constant that can drift upward one incident at a time");
  }

  /* ---------- the publish retry, bounded twice ------------------------

     THE FIRST WIDE-BOARD RUN LOST TWO PAYLOADS TO THE EDGE. Publishing fifty
     cards instead of eleven earned a Cloudflare 403 on `sector:trix` and on
     the re-publish of `board:long`, so one page went a day stale and one board
     shipped without four columns — both silent to a reader.

     Retrying is right, and retrying without a global bound is a different bug
     with the same shape. Three retries is 1 + 4 + 9 = fourteen seconds per
     failing key; a run publishes upwards of sixty keys, and a burst-rate
     challenge is by nature systemic rather than per-key. Unbounded, the policy
     would spend fourteen minutes of a thirty-minute deadline asleep and then
     drop the cards at the back of the queue to pay for the retries at the
     front — trading twenty silent losses for two. */
  {
    eq(publishRetryDelay(0), 1000, "the first retry waits a second");
    eq(publishRetryDelay(1), 4000, "the second, four");
    eq(publishRetryDelay(2), 9000, "the third, nine — quadratic, because an edge challenge " +
       "clears on elapsed quiet rather than on attempt count");
    eq(publishRetryDelay(3), null, "and there is no fourth: three RETRIES, four attempts");
    eq(publishRetryDelay(-1), null, "a nonsense attempt index retries nothing");

    /* THE GLOBAL BUDGET IS PART OF THE ANSWER, not a check somewhere near it.
       The only retry defect this repository has shipped twice is a policy
       whose comment and code disagreed, so the arithmetic lives in one
       function a test can call. */
    eq(publishRetryDelay(0, { spentMs: 89_500 }), null,
       "a wait that would exceed the run's remaining retry budget is refused outright, " +
       "rather than truncated to fit — a shortened wait is the one length that neither " +
       "clears the challenge nor saves the time");
    eq(publishRetryDelay(0, { spentMs: 89_000 }), 1000,
       "a wait that fits is granted in full");

    /* THE BUDGET BINDS BEFORE THE DEADLINE DOES. Whatever the per-key policy
       costs, a whole run of failures must not consume the window the cards
       need — this is the relation, asserted rather than described. */
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

  /* ---------- the truncated-chain probe ------------------------------

     Ten of eleven board names filled the vendor's 500-row page on the first
     live morning, so the truncation refusal — designed for the largest names —
     is the common case. The probe spends one call asking whether the endpoint
     can be narrowed to a single expiry. These assertions are about the probe
     REPORTING HONESTLY, because a diagnostic that misreads its own answer is
     worse than none: it would send the next release down the wrong design. */
  {
    const expiries = [
      { expiry: "2026-08-27" },              // inside the 7-day floor
      { expiry: "2026-09-04" }, { expiry: "2026-09-18" },
      { expiry: "2026-08-20" },              // already past
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

    /* THE THIRD OUTCOME, which is neither of the other two and must not be
       collapsed into either. An accepted-and-empty filter looks like success
       to a row counter and like failure to a naive reader. */
    const empty = describeChainProbe("AAPL", "2026-09-04", []).join(" ");
    ok(!empty.includes("FILTER WORKS") && !empty.includes("FILTER IGNORED"),
       "an empty response is reported as its own outcome, not as either verdict");

    /* A single expiry that STILL fills the page is not a solved problem: the
       strike set is then itself an arbitrary subset. */
    const full = Array.from({ length: 500 }, (_, i) =>
      ({ option_symbol: sym("2026-09-04", "C", 100 + i) }));
    const stillFull = describeChainProbe("AAPL", "2026-09-04", full).join(" ");
    ok(stillFull.includes("still fills the page"),
       "and a filtered response that itself hits the cap says so rather than declaring victory");
  }

  /* ---------- the fixture's own honesty -------------------------------

     THE FIXTURE IS THE THING THAT HAS BEEN WRONG MOST OFTEN IN THIS
     REPOSITORY. Three times a dry run passed because the fixture agreed with
     the code's guess instead of with the vendor: call_gamma against the wire's
     call_gex, the aggressor split, and one option type per strike hiding the
     put/call collision. A fourth was live for a release — the narrow book fit
     the vendor's page, so the truncation branch that fires on ten names of
     eleven never executed in any dry run.

     So the fixture's claims get assertions of their own. The shuffle in
     particular: a page cut from an already-sorted book leaves the front
     expiries whole, which is exactly the convenience the vendor does not
     promise and the refusal exists to survive. Without this assertion, dropping
     the shuffle changes nothing any other test can see. */
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

  /* BOTH PAYLOADS FIT. The ingest route refuses anything over 128KB, and it
     refuses it as a 413 from the Worker rather than here. */
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

/* ---------- every ingest request looks like the same client ----------

   THE READ PATH WAS ANONYMOUS AND THE EDGE DROPPED IT.

   publish() and retire() each carried their own copy of a User-Agent header,
   and publish()'s comment said exactly why it was needed: Node's fetch sends
   none, and an anonymous request from a datacenter address is the shape edge
   bot heuristics drop. fetchStoredPayload() never got a copy — so writes and
   deletes reached the Worker and every READ was refused by Cloudflare with
   403. Measured on 2026-08-27: 8 of 8, with a retry recovering none, because a
   bot heuristic is deterministic rather than a rate limit.

   It surfaced as the track record reporting "0 retained session(s) of 180
   dated key(s) probed" while the page called that the ordinary first state of
   a cold archive. It had also been silently disabling board hysteresis, which
   reads through the same function, since the day hysteresis was wired up.

   Two copies of a string that three call sites must agree on is what allowed
   one to be missing. This asserts there is one builder and that every request
   to the ingest route goes through it. */
{
  const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");

  const uaLiterals = src.match(/anilkaya-flows-pipeline\/1/g) || [];
  eq(uaLiterals.length, 1,
     `the ingest User-Agent is written down ONCE (found ${uaLiterals.length}). Two copies is ` +
     "how the read path came to have none");

  ok(/function ingestHeaders\(/.test(src),
     "and it is reached through a single builder every call site shares");

  /* Every fetch to the ingest route must take its headers from that builder.
     Checked by locating each call and reading forward to its options — a
     bare `Authorization:` literal at one of these sites is the defect. */
  const sites = [...src.matchAll(/ingestURL\(\) \+ "\?key="/g)];
  eq(sites.length, 3,
     `three call sites reach the ingest route — read, write and delete (found ${sites.length}). ` +
     "A fourth must join the builder rather than hand-rolling headers");
  for (const site of sites) {
    const window = src.slice(site.index, site.index + 900);
    ok(/headers: ingestHeaders\(/.test(window),
       "each ingest fetch takes its headers from ingestHeaders() rather than assembling its " +
       "own — the read path assembling its own is precisely the bug this pins");
    ok(!/Authorization: "Bearer " \+ process\.env\.FLOWS_INGEST_TOKEN/.test(window),
       "and none of them still builds an Authorization header inline, which is what a copied " +
       "call site looks like on the way back in");
  }
}

/* ---------- the bounded worker pool, and the run's veto over it ----

   THE DRY RUN CANNOT REACH ANY OF THIS. It makes zero vendor calls, so
   poolWidth() answers "not evidence" and every leg runs one wide — the pooled
   path and the serial path emit identical bytes there, which is the property
   the corpus block below asserts and is exactly why the corpus can say
   nothing about what happens when the pool is actually wide. These are the
   assertions that do. */
{
  /* ---- ORDER SURVIVES OUT-OF-ORDER COMPLETION ----

     The whole reason this is safe to put in front of the scorer. Item 0 is
     made the SLOWEST so that with any width above one it finishes last; if
     results were collected in completion order the array would come back
     rotated and every percentile tie downstream would move. */
  const delays = [40, 5, 5, 5, 5, 5, 5, 5];
  const items = delays.map((ms, i) => ({ i, ms }));
  const seen = [];
  let live = 0, peak = 0;
  const pooled = await runPooled(items, async (item) => {
    live++; if (live > peak) peak = live;
    await new Promise((r) => setTimeout(r, item.ms));
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

  /* ---- WIDTH 1 IS THE SERIAL LOOP, EXACTLY ----

     Every leg falls back to this whenever the run is being refused, so "width
     1 never overlaps" is the property that makes the fallback a real fallback
     rather than a smaller burst. */
  let serialLive = 0, serialPeak = 0;
  await runPooled(items, async (item) => {
    serialLive++; if (serialLive > serialPeak) serialPeak = serialLive;
    await new Promise((r) => setTimeout(r, item.ms));
    serialLive--;
  }, { width: 1 });
  eq(serialPeak, 1, "width 1 never has two items in flight — it is the serial loop it replaced");

  /* ---- `attempted` IS NOT DERIVED FROM `results` ----

     A caller counting skipped names off `results[i] === undefined` would count
     every name whose worker legitimately returned nothing. This is the same
     confident-zero confusion the payloads refuse everywhere else, and here it
     would misreport the chain leg's own deadline accounting. */
  const quiet = await runPooled([1, 2, 3], async () => undefined, { width: 2 });
  assert.deepEqual(quiet.attempted, [true, true, true],
    "an item whose work returned undefined is still ATTEMPTED — undefined is a result, not a skip");
  checks++;
  eq(quiet.done, 3, "and `done` counts attempts rather than truthy results");

  /* ---- stopEarly IS CONSULTED PER ITEM, NOT ONCE AT DISPATCH ----

     This is the chain leg's card reserve. A deadline tested only when the pool
     starts would let a leg that began in time run for as long as its longest
     queue — spending the window the cards were guaranteed. The stop here fires
     only after two items, so a pool that checked once would finish all six. */
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

  /* ---- degenerate shapes ---- */
  const empty = await runPooled([], async () => 1, { width: 4 });
  eq(empty.done, 0, "an empty list is a no-op rather than a hang");
  const narrow = await runPooled([7], async (x) => x, { width: 9 });
  assert.deepEqual(narrow.results, [7], "a width wider than the list is clamped to the list");
  checks++;

  /* ---- THE RUN'S VETO, AT EVERY RUNG ----

     poolWidth() takes its meter as a parameter precisely so this can be
     asserted. The rung that matters most is the first: on the shape the
     2026-08-26 run actually had — 170 refusals in 1022 calls — the pool must
     REFUSE to widen, because concurrency at a 17% refusal rate raises the
     refusal rate. A test suite that only ever exercised the healthy branch
     would certify the opposite of the property this gate exists for. */
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

  /* THE BOUNDARY IS EXCLUSIVE ON BOTH RUNGS, asserted rather than assumed: a
     rate exactly at a rung takes the FASTER side, and the next person to move
     a constant should find out here rather than in a live 429 regime. */
  eq(poolWidth(POOL_MAX_WIDTH, { calls: 1000, rateLimited: 1000 * POOL_REFUSAL_HALT }).width, 2,
     "a rate exactly at the halt rung is not halted");
  eq(poolWidth(POOL_MAX_WIDTH, { calls: 1000, rateLimited: 1000 * POOL_REFUSAL_EASE }).width,
     POOL_MAX_WIDTH, "and a rate exactly at the ease rung takes full width");

  /* ---- A METER WITH NO REFUSAL COUNTER IS NOT A CLEAN RUN ----

     `Number(undefined) || 0` stood in this divisor and turned a counter that
     had gone missing into a measured 0% refusal rate — which took the widest
     branch and leaned HARDER on a vendor nobody was metering. It is the same
     confident zero the payloads refuse, sitting in a control decision instead
     of a display, and absence must take the conservative branch rather than
     the optimistic one. */
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

/* ---------- the cards leg's own shape, at a width the dry run never reaches --

   THE CARDS LEG IS THE LAST SERIAL STRETCH AND THE ONE A READER PAYS FOR: six
   calls a name over up to fifty names, running after every other payload has
   committed, so the names it does not reach before the deadline are a morning
   with fewer cards. Pooling it is worth nothing if the leg then MISCOUNTS what
   it did, and the dry run cannot notice: DRY_RUN makes zero vendor calls, so
   poolWidth() answers "not evidence", the leg runs one wide, nothing overlaps
   and the fold is exercised on a list that could not have been folded wrong.

   So the coverage is here, against runPooled directly, at a width above one
   and with a fixture that COMPLETES OUT OF ORDER — which is the only shape in
   which "folds in input order" and "counts off `attempted`" can fail. */
{
  /* The board, in the order the cards leg would publish it. Name 0 is made the
     slowest so that at any width above one it lands LAST: a fold that
     collected in completion order would return its gamma profile at the end
     rather than the front. */
  const board = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
  const slow = { AAA: 40 };
  /* Four outcomes. Three are what the live worker returns:
       AAA, CCC, FFF — built, each carrying a gamma profile;
       BBB          — threw inside the worker, caught, returned "failed";
       DDD          — on the board with no enrichment row to build from.
     EEE is the fourth and it is deliberately one the worker does NOT produce
     today: a worker that returned nothing at all. `undefined` is a legal
     result — runPooled's own doc says so — and the card worker returns a
     tagged object on every path only because it is written that way this
     morning. The fold must not read that discipline as a guarantee, because
     the day one path stops returning is the day a built card would start
     being reported as a name the deadline took. */
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

  /* ---- THE COUNTERS EQUAL WHAT `attempted` SAYS ----

     The invariant, stated as arithmetic rather than as four separate numbers:
     every name the pool attempted is accounted for by exactly one of built,
     failed and unenriched, and every name it did not attempt is a deadline
     skip. If that ever stops holding, some name is being counted twice or not
     at all, whatever the individual numbers look like. */
  eq(fold.built + fold.failed + fold.unenriched, run.done,
     "built + failed + unenriched is exactly what the pool ATTEMPTED");
  eq(fold.deadlineSkipped, board.length - run.done,
     "and the deadline skips are exactly what it did not attempt");

  /* ---- THE SAME FIXTURE, COUNTED OFF TRUTHINESS, IS WRONG ----

     This is the bug the fold exists to refuse, run side by side with it so a
     reader can see the size of the lie rather than take the comment's word.
     EEE returned `undefined`; a fold reading `results[i] === undefined` as
     "never reached" reports it as a name the deadline took. */
  const naive = board.filter((_, i) => run.results[i] === undefined).length;
  eq(naive, 1,
     "counted off a missing result, this run reports a name skipped past the deadline");
  eq(fold.deadlineSkipped, 0,
     "counted off `attempted`, it reports none — the pool ran to the end of the board. The " +
     "two disagree, and only one of them can be printed under the deadline's name");

  /* ---- AND THE DEADLINE, WHICH IS THE COUNT THAT MATTERS ON A SLOW MORNING --

     stopEarly fires after two names, so four are never claimed. This is the
     shape a real slow morning has, and the one whose count reaches both the
     operator's log line and the published `meta` key. */
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

  /* ---- DEGENERATE INPUTS, because this fold reads a foreign object ---- */
  const nothing = foldCardOutcomes([], { results: [], attempted: [] });
  eq(nothing.built + nothing.failed + nothing.skipped, 0, "an empty board folds to zeros");
  eq(foldCardOutcomes(["AAA"], {}).deadlineSkipped, 1,
     "and a run object carrying no arrays at all reports the name as NOT ATTEMPTED rather " +
     "than throwing or claiming it was built");

  /* ---- main() USES THIS FOLD RATHER THAN COUNTING INLINE ----

     The extraction is the whole reason the assertions above reach anything. A
     copy of this arithmetic written back into the card loop would be a copy
     the dry run certifies at width 1 and nothing certifies at width 2. */
  const src = readFileSync(new URL("../scripts/flows-pipeline.mjs", import.meta.url), "utf8");
  ok(/foldCardOutcomes\(cardTickers, cardsRun\)/.test(src),
     "the cards leg folds its pooled run through foldCardOutcomes");
  ok(/runPooled\(cardTickers,/.test(src) && /stopEarly: \(\) => Date\.now\(\) > deadline/.test(src),
     "and the leg is pooled with the deadline checked by every worker before it claims a name, " +
     "rather than once at dispatch");
}

/* ---------- the floor verdict, at every rung it can reach ----------

   RATE.floorCeilingMs's own comment is an open question — "a higher floor
   trades a certain per-call tax against an uncertain saving, and the run has
   never been instrumented to say which is larger. Do not raise it on
   intuition; measure the 429 wait first." The meter is that measurement and
   this describer is the sentence that reads it. The branch that matters most
   is the one that says DO NOT RAISE IT, which by construction only a refused
   run produces — so it is asserted here rather than left to the first bad
   morning. */
{
  eq(describeFloorVerdict({ calls: 0, rateLimited: 0, permitWaitMs: 0, rateLimitWaitMs: 0 }), null,
     "a run that made no calls says NOTHING about the floor — an empty meter is not a " +
     "measured 0% refusal rate, and printing one would be a confident zero about the one " +
     "constant this file refuses to change on intuition");

  /* The 2026-08-26 shape, from RATE.floorCeilingMs's own comment. */
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

  /* ---- AND NO VERDICT AT ALL OFF A METER THAT LOST ITS REFUSAL COUNT ----

     This describer's output is a written recommendation about a published
     constant. Read as `Number(undefined) || 0` it said "0.0% refused, the
     floor is CONSERVATIVE, it can come down" about a run whose refusals were
     never counted — the confident zero, aimed at the one number this file
     refuses to move on intuition. */
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

  /* THE VERDICT AND THE THROTTLE READ THE SAME RUNGS. Two constants would be
     two opinions about what "being refused" means, and they would diverge on
     the first morning somebody tuned one of them. */
  eq(poolWidth(POOL_MAX_WIDTH, { calls: 1022, rateLimited: 170 }).width, 1,
     "the same meter that produces the DO-NOT-RAISE verdict also holds every pooled leg at " +
     "width 1 — the sentence and the throttle cannot disagree");
}

/* ---------- the counter feed's first-appearance marker -------------

   THE THREE SILENCES, ON A FEED WHOSE SUBJECT IS WHAT CHANGED. `nw` is the
   only field on this page that makes a claim about a prior session, so it is
   the only field that can lie about one. The emitted corpus reaches exactly
   one of its three answers — see the corpus block below — and these reach the
   other two, which are the ones that must not become a confident sweep. */
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
  /* THE SESSION THE RUN IS PUBLISHING, later than every priorBody above, and
     passed at every call below. It is the third argument because this key
     holds whatever the LAST run wrote rather than whatever YESTERDAY's run
     wrote — see the same-session block at the end. */
  const RUN = "2026-08-24";

  /* ---- the ordinary comparison ---- */
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

  /* ---- THE FAILURE CASE THIS FIELD EXISTS TO AVOID ----

     A prior payload that could not be read must not make every line today
     look new. Number(null) is 0 and an empty Set answers `has` with false for
     everything — both are the same defect wearing different syntax, and this
     one would publish fifty confident firsts on a morning the store was
     down. */
  {
    const today = [row("AAPL", 200, "2026-09-18", "C"), row("MSFT", 400, "2026-09-18", "P")];
    const mark = markNewContracts(today, null, RUN);
    eq(mark.status, "unavailable", "no prior payload is UNAVAILABLE, not an empty comparison");
    ok(today.every((r) => r.nw === null),
       "and NOT ONE row claims to be new when there was nothing to compare against");
    eq(mark.contracts, null, "the prior count is null rather than 0 — nothing was counted");
    eq(mark.fresh, null, "and so is the fresh count: zero would be a measurement");
  }

  /* ---- a prior that was read and named nothing is a THIRD answer ---- */
  {
    const today = [row("AAPL", 200, "2026-09-18", "C")];
    const mark = markNewContracts(today, priorBody([]), RUN);
    eq(mark.status, "quiet", "a prior feed read with no contracts in it is QUIET, not unavailable");
    eq(today[0].nw, null,
       "and still marks nothing new: `new` against a list that named nothing is not a reading");
    eq(mark.contracts, 0, "the prior count IS zero here, because zero was measured");
    eq(mark.fresh, null, "while fresh stays null, because no comparison was made");
  }

  /* ---- a prior whose rows carry no identifiable key ----

     What a payload written before this field shipped would look like if the
     row shape ever moved underneath it. Fifty rows in, zero keys out — and
     marking everything new off that is the same sweep as the unavailable
     case, arrived at by a different road. */
  {
    const today = [row("AAPL", 200, "2026-09-18", "C")];
    const mark = markNewContracts(today, priorBody([{ symbol: "AAPL260918C00200000" }]), RUN);
    eq(mark.status, "quiet",
       "a prior feed whose rows yield no identity is treated as no comparison, not as a clean sweep");
    eq(today[0].nw, null, "so no row claims to be new off it");
  }

  /* ---- a row TODAY that cannot be identified ---- */
  {
    const today = [row("AAPL", 200, "2026-09-18", "C"), { t: "MSFT", cp: "P" }];
    markNewContracts(today, priorBody([row("AAPL", 200, "2026-09-18", "C")]), RUN);
    eq(today[0].nw, 0, "the identifiable row is compared");
    eq(today[1].nw, null,
       "and the row this run could not build a key for is NULL — \"I cannot identify you\" " +
       "is not \"you are new\"");
  }

  /* ---- the empty feed ---- */
  {
    const mark = markNewContracts([], priorBody([row("AAPL", 200, "2026-09-18", "C")]), RUN);
    eq(mark.status, "ok", "an empty feed still records that the comparison was possible");
    eq(mark.fresh, 0, "and reports zero new contracts, which here is a measurement");
  }

  /* ---- THE RE-RUN, WHICH IS THE OTHER WAY THIS FIELD CAN LIE ----

     The `unusual` key holds whatever the LAST run wrote, not what YESTERDAY's
     run wrote. On a market holiday, an early close, a manual re-run or a cron
     that fires twice, the second run reads its own output: every contract is
     trivially its own incumbent, every `nw` comes back 0, and the page whose
     entire subject is what is new publishes "nothing is" as though it had
     been measured. The board's memory has carried this guard since the
     holiday that produced it; the counter feed shipped without one.

     THE FAILURE IS THE MIRROR OF THE UNAVAILABLE CASE. That one marks
     everything new off a comparison against nothing; this one marks nothing
     new off a comparison against itself. Both are confident readings with no
     yesterday behind them. */
  {
    const today = [row("AAPL", 200, "2026-09-18", "C"), row("MSFT", 400, "2026-09-18", "P")];
    /* The prior feed carries a DIFFERENT contract from today's, so a run that
       skipped the guard would mark both rows new — the assertion below cannot
       pass by the rows happening to match. */
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

    /* AND FROM AHEAD OF THIS RUN, which is a re-run against a stale tape. */
    const ahead = markNewContracts(
      [row("AAPL", 200, "2026-09-18", "C")],
      priorBody([row("NVDA", 900, "2026-09-18", "C")], undefined, "2026-08-25"), RUN);
    eq(ahead.status, "ahead", "a feed stamped for a LATER session is refused and named");
    eq(ahead.fresh, null, "and marks nothing either");
    ok(priorNote(ahead, RUN, 1) !== priorNote(mark, RUN, 2),
       "the two refusals do not share a sentence — a reader has to be able to tell a holiday " +
       "re-run from a stale tape");
  }

  /* ---- AN UNSTAMPED FEED IS NOT A MATCHING ONE ----

     The opposite mistake, and this file has shipped it too: discarding a real
     earlier session over a missing stamp reports a cold feed on a morning that
     had a good yesterday. The comparison is made and the payload says it could
     not be checked, which is exactly what readBoardMemory does with this gap. */
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

  /* ---- THE SENTENCE, WHICH IS THE PART THE PAGE ACTUALLY SHOWS ----

     The four refusals leave the identical mark on the rows — `nw` null
     everywhere — and `undated` marks the rows while being unable to prove what
     it compared against. If any two shared a sentence the payload would be
     publishing one silence where there are several, which is the defect the
     three-silences rule exists to stop. shared/ is not served to the browser,
     so the sentence travels on the payload or it does not travel at all. */
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
    /* REFUSAL 1 REACHES THIS PROSE TOO. The vocabulary ban in
       flows-unusual-contract.mjs scans basis and the coverage strings; this
       sentence is new and is held to the same words. */
    ok(!/\b(print|trade|block|sweep|order|bought|sold|paid|whale)\b/i.test(notes.join(" ")),
       "and none of the six says a word Refusal 1 bans on a page whose subject is a counter");
  }
}

/* ---------- the board's memory, and whose session it came from ----

   THE DEFECT: the memory is one read of the LIVE `board:<side>` key, which
   holds whatever the last run wrote. Run the pipeline twice against one
   session — a market holiday, an early close, a manual re-run, a cron that
   fires twice — and the second run reads ITS OWN OUTPUT as yesterday. Every
   name is then trivially its own incumbent, hysteresis holds the board in
   place, and the run reports `held` for names that were never tested against a
   prior session. The page then shows a stability manufactured by the re-read,
   on the one surface whose whole promise is what changed since yesterday.

   Four inputs and four different answers, and the differences ARE the fix: a
   matching session date must not be treated as a memory, an earlier one must,
   an unstamped prior board is neither, and a prior board that could not be
   read has to keep behaving exactly as it did before this shipped. */
{
  const board = (sessionDate, rows) => ({ v: 4, side: "long", sessionDate, rows });
  const yesterdayRows = [{ t: "AAA", r: 1 }, { t: "BBB", r: 2 }, { t: "CCC", r: 3 }];
  const TODAY = "2026-08-25";

  /* ---- 1. THE RE-RUN: a prior board stamped for the session being published ---- */
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

  /* ---- 2. THE ORDINARY MORNING: a prior board from an earlier session ---- */
  const warm = readBoardMemory({ payload: board("2026-08-22", yesterdayRows) }, TODAY);
  eq(warm.status, "ok", "a board stamped for an earlier session IS the memory");
  eq(warm.incumbents, 3, "all three names reach hysteresis");
  assert.deepEqual(warm.rows, yesterdayRows,
    "and they arrive as ROWS with their ranks intact — `r0` and `dr` exist only because the " +
    "rank was not thrown away on the way in"); checks++;
  eq(warm.sessionDate, "2026-08-22",
     "the payload names the session the comparison was made against, so \"new\" has a denominator");

  /* ---- 3. AN OLDER PAYLOAD, CARRYING NO SESSION DATE AT ALL ----

     Not the same as a date that matches, and it must not be coerced into one.
     Discarding a real membership over a missing stamp would report a cold
     start on a session that had a perfectly good yesterday — the confident
     zero, in prose. The memory is used and the payload says it is unverified. */
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

  /* A STAMP THAT IS NOT A DATE IS NOT A DATE. String(x || "") would have made
     "" of it, and "" sorts below every real date — reported as an earlier
     session, which is the answer that keeps the memory. */
  eq(readBoardMemory({ payload: board("yesterday", yesterdayRows) }, TODAY).status, "undated",
     "a sessionDate that is not an ISO date is unusable rather than quietly earlier than today");
  eq(readBoardMemory({ payload: board("", yesterdayRows) }, TODAY).sessionDate, null,
     "and an empty stamp is published as no stamp, never as a session");

  /* ---- 4. NO PRIOR BOARD AT ALL — the path that must not change ---- */
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

  /* THE THIRD SILENCE: read, and empty. */
  const quiet = readBoardMemory({ payload: board("2026-08-22", []) }, TODAY);
  eq(quiet.status, "quiet", "a board that was read and named no rows is quiet, not unavailable");
  eq(quiet.named, 0, "and its emptiness is a measured 0 where an unreadable board is a null");
  ok(quiet.note !== absent.note && quiet.note !== failed.note,
     "with its own sentence: a session that ranked nothing is not a store that answered nothing");

  /* A PRIOR BOARD FROM A LATER SESSION IS NOT THIS RUN'S YESTERDAY EITHER. It
     is what a re-run against a stale tape looks like from here, and holding
     today's names against a board from ahead of them is the same manufactured
     stability running backwards. */
  const ahead = readBoardMemory({ payload: board("2026-08-26", yesterdayRows) }, TODAY);
  eq(ahead.status, "ahead", "a board stamped for a LATER session is refused and named");
  eq(ahead.incumbents, 0, "its membership does not reach hysteresis");
  ok(ahead.note !== same.note, "and it says which of the two refusals happened");

  /* THIS RUN WITHOUT A SESSION DATE. resolveSessionDate answers null when the
     vendor sends no usable candle, and the board still publishes. The check
     cannot be made, so it is reported as not made rather than as passed. */
  const unstamped = readBoardMemory({ payload: board("2026-08-22", yesterdayRows) }, null);
  eq(unstamped.status, "undated", "a run that could not resolve its own session cannot run the check");
  eq(unstamped.incumbents, 3, "so it keeps the memory rather than manufacturing a cold start");
  ok(/This run could not resolve a session date/.test(unstamped.note),
     "and the sentence names which side of the comparison was missing");

  /* ---- IT IS A COMPARISON OF DATES, NOT OF INSTANTS ----

     daysToEarnings carries this lesson in capitals: MEASURED FROM A DATE, NOT
     FROM AN INSTANT. A fixture that read Date.now() while the gate counted
     from easternNow().date changed every result across midnight, silently.
     The guard therefore reads no clock at all — it compares the stamp on the
     prior payload with the stamp this run is about to write, which is the same
     origin by construction. */
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

  /* ---- AND THE EMPTY LIST TRAVELS: the refusal reaches the rows ----

     A guard that stops at the memory object would be decoration. These build
     the same board twice from one pool: once against a real prior session and
     once against that session's own output. */
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

  /* The board a first run of this session publishes: no memory anywhere. */
  const first = toRows(pool, screener, [], ORIGIN);
  ok(first.length < pool.length,
     `the fixture pool (${pool.length}) is wider than the board's entry rank (${first.length}), so ` +
     "the hysteresis band is reachable — if the board ever grows past this pool the fixture must " +
     "grow with it or these assertions stop measuring anything");

  /* What that first run published, read back the way the second run reads it:
     its own rows, its own ranks, and FIVE names that have since slipped just
     past the entry rank — the ordinary drift hysteresis exists to absorb. Two
     of today's top names are withheld from it so the warm board still has
     arrivals to mark; a prior that is a superset of today marks nothing new
     and would make the nulls below indistinguishable from a builder that never
     marks anything. */
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

  /* A PRIOR ROW WITH NO RANK IS NOT A ROW AT RANK ZERO. num()'s fallback is 0,
     so a prior row carrying no `r` — an older payload, an archive row written
     before ranks were published — came back as rank 0, passed the `!== null`
     guard written to stop exactly that, and published dr = 0 - rank: a name at
     rank 1 reported as having fallen one place from a position no board ever
     put it in. */
  {
    const rankless = toRows(pool.slice(0, 3), screener, [{ t: "W00" }, { t: "W01", r: 9 }], ORIGIN);
    const noRank = rankless.find((r) => r.t === "W00");
    eq(noRank.r0, null, "a prior row with no published rank yields no yesterday's rank");
    eq(noRank.dr, null, "and no phantom fall — before this it published dr = -1 off a rank of zero");
    eq(noRank.nw, false, "while the name is still correctly an incumbent: absence of a rank is not absence from the board");
    eq(rankless.find((r) => r.t === "W01").dr, 7, "and a row that DID publish a rank still moves by it");
  }

  /* THE DRY-RUN FIXTURE'S INTENT, PINNED. The emitted corpus below can only
     prove the refusal because one side of it is stamped for the run's own
     session on purpose. */
  eq(fakePriorBoard("short", pool, "2026-08-24").sessionDate, "2026-08-24",
     "the fixture stamps the SHORT side with the run's own session — that is the market-holiday " +
     "re-run, and it is deliberate");
  ok(fakePriorBoard("long", pool, "2026-08-24").sessionDate < "2026-08-24",
     "and the long side with an earlier weekday, so one dry run emits a used memory and a " +
     "refused one side by side");
}

/* ---------- the emitted corpus, on the fields this pass added ------

   ITS OWN DRY RUN, in its own directory, and every path built from the
   emitter's own prefix. The block above this file's summary line already
   proved why: a path guessed rather than derived, guarded by
   `if (!fs.existsSync(...)) continue`, is how a whole section of this suite
   once passed without executing. */
{
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "flows-warn-")) + "/w";
  const run = spawnSync(process.execPath,
    ["../scripts/flows-pipeline.mjs", "--dry-run", "--emit", prefix],
    { cwd: import.meta.dirname, encoding: "utf8" });
  eq(run.status, 0, "the dry run exits clean");
  const runLog = run.stdout + run.stderr;

  /* THE EMITTER REPLACES THE FIRST COLON IN A KEY WITH A DASH, so the file
     name is derived from the listing rather than from a guessed pattern —
     `board:long:2026-08-24` and `board:long` differ only past that first
     colon and a naive pattern would read the archive copy for the live one. */
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

  /* ---- the board publishes the clock its own day counts are measured from ----

     `edte` is a count of CALENDAR days from the gate's origin, and `sessionDate`
     is the last COMPLETED session — one to three days earlier at the hour this
     job runs. A renderer counting from `sessionDate` would draw the earnings
     window early and disagree with the gate that spared the row, silently,
     because both numbers look like day counts. /flows/events/ carries this
     pair for exactly this reason. */
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

    /* THE COUNT IS THE GATE'S OWN ARITHMETIC AGAINST THE PUBLISHED ORIGIN,
       reproduced here rather than trusted. A published count nobody can
       recompute is a caption. */
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
    /* THE INTERESTING CASE, and evidence that the corpus reaches it: a name
       that cleared the twelve-day gate and reports inside the ten-session
       horizon it is ranked over. */
    ok(dated.some((r) => r.edte !== null && r.edte > 12 && r.edte <= 21),
       `board:${side} holds at least one name reporting just past the gate — the row this ` +
       "column exists for, and proof the branch is reachable");
  }

  /* ---- the board's memory, and the session it was checked against ----

     THE COLD BRANCH RUNS IN THIS CORPUS RATHER THAN BEING ASSERTED AROUND.
     readStored answers every dry-run read as absent, so before fakePriorBoard
     both sides came back "unavailable", every row carried `nw: null`, and a
     suite over this corpus could certify the no-prior sentence and nothing
     else. The fixture now stamps `long` with the previous weekday and `short`
     with THIS run's own session, so one emitted payload carries a memory that
     was used and the other carries one that was read and REFUSED — and these
     assertions are over the difference between two real payloads. */
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

    /* THE PAYLOAD SAYS WHY, because the renderer cannot work it out: all four
       fields are null in four different situations and shared/ is not served
       to the browser, so the sentence travels on the payload or not at all. */
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

    /* IN THE LOG TOO. An operator reading a job log has no payload in front of
       them, and "no comparison" every morning is how a store that has been
       failing for a week goes unnoticed. */
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

  /* ---- the counter feed's memory ---- */
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

  /* ---- the pool did not change what a run publishes ----

     At zero vendor calls poolWidth answers "not evidence" and all three
     pooled legs run one wide, so this asserts the fallback IS the serial loop
     rather than the pool's behaviour. Reported in the log so the width a live
     run chose is readable there rather than inferred. */
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

  /* ---- the two Worker-only legs still complete when detached ----

     They are started before the vendor stretch and awaited after it, so the
     one way this change could have gone wrong is a run that exits with the
     sweep half-issued. The prune's own line is the evidence that it finished. */
  ok(/prune: \d+ dated keys past \d+ days named/.test(runLog),
     "the detached prune completed and reported its sweep before the run ended");
  ok(/record: \d+ retained session\(s\) of \d+ dated key\(s\) probed/.test(runLog),
     "and the detached archive walk was awaited in time for the record to score it");

  /* ---- nothing this pass added pushed a payload at the ingest cap ---- */
  for (const name of emitted) {
    const bytes = fs.statSync(path.join(dir, name)).size;
    ok(bytes <= 100 * 1024,
       `${name} is ${(bytes / 1024).toFixed(1)}KB, inside the 128KB the ingest route accepts ` +
       "(and inside the 100KB the card shedder targets)");
  }
}

console.log(`✓ flows-pipeline: ${checks} assertions — live publish path, candle-order invariance, issuer collapse, dead-band partitioning, the dated archive key and its bounded prune, the watch board's ranking and vocabulary, multiplicative quality gating, direction monotonicity, packed sparklines, Eastern session resolution, liquidity floor, sector TRIX and the fixed-clamp scaling that keeps a flat day flat, the movers band's zero-call guarantee and its unranked counts, the rate limiter's floor actually being a floor, the truncated-chain probe's three distinct verdicts, the board's memory refusing a prior board that turns out to be this run's own session, a corpus proven to REACH the change layer's branches rather than merely to satisfy assertions written around them, and a market-wide join whose published coverage is checked against the cards it was measured over rather than against itself`);
