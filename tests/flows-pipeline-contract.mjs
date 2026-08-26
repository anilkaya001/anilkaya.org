/* Contracts for the pipeline stage — the code between the vendor's response
   and the published board.

   The unit tests in flows-features.mjs cover the mathematics. These cover the
   plumbing around it, which is where an adversarial audit found the defects
   that mattered most: a name enriched twice and ranked on both boards, an ATR
   computed backwards through time because the vendor's candle order is not
   documented, and unsigned magnitudes added to a signed composite so that
   "this flow is high quality" read as "this name is bullish". */

import assert from "node:assert/strict";
import {
  candlesAscending, selectExtremes, atr14, partitionSides, scoreBoard,
  medianDollarVolume, eligible, daysToEarnings, publish, summarize,
  collapseShareClasses, returnCorrelation, packSpark, ret, easternNow, DEAD_BAND,
  screenerTilt, boardRow, toRows, toWatchRows, datedKey, pruneKeys, pruneArchive,
  WATCH_ROWS, ARCHIVE_RETENTION_DAYS, ARCHIVE_PRUNE_LOOKBACK_DAYS,
  SECTOR_ETFS, TRIX_SERIES, TRIX_MIN_CANDLES, TRIX_FULL_SCALE_BP,
  trixSeriesBp, scaleTrix, sectorTrix, MOVER_ROWS, moverRow, buildMovers,
} from "../scripts/flows-pipeline.mjs";
import { pearson, horizonMove, HORIZON_SESSIONS } from "../shared/flows-features.js";
import { execFileSync } from "node:child_process";
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

  const today = Date.UTC(2026, 7, 25);
  ok(daysToEarnings({ next_earnings_date: "2026-08-30" }, today) === 5, "earnings distance is in days");
  ok(daysToEarnings({}, today) === null, "an absent earnings date is null, not zero");
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
    const m = /^board:(long|short):(\d{4}-\d{2}-\d{2})$/.exec(k);
    ok(m, `every swept key is a dated board key and nothing else (${k})`);
    ok(Date.parse(m[2] + "T00:00:00Z") < Date.parse(session + "T00:00:00Z") - ARCHIVE_RETENTION_DAYS * 86400000,
       `${k} is strictly older than the retention window`);
  }

  /* THE BOUND, asserted after the shape checks so that a sweep which walks the
     wrong WAY is reported as a wrong boundary rather than as a wrong count. */
  eq(keys.length, 2 * ARCHIVE_PRUNE_LOOKBACK_DAYS,
     "THE BOUND: one run deletes at most two sides x the lookback, and that number is knowable before it runs");
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
    eq(missing.seen.length, 2 * LOOKBACK,
       "a 404 is an ordinary empty day, so the sweep runs the whole skirt rather than stopping at the first gap");
    ok(!missing.result.abandoned, "and reports no abandonment");
    eq(missing.result.removed, 0, "with nothing removed, honestly");

    const done = await run(200);
    eq(done.result.removed, 2 * LOOKBACK,
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
   never displayed. surpriseTilt in particular — options volume against the
   name's OWN 30-day norm — is the most conventional unusual-activity measure
   in the product and was used once as a pre-enrichment sort key and dropped. */
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
    // B's 30-day volume norm is missing, which the vendor reports as no field
    // at all; screenerTilt turns that into NaN rather than into a number.
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
  execFileSync(process.execPath,
               ["../scripts/flows-pipeline.mjs", "--dry-run", "--emit", prefix],
               { cwd: import.meta.dirname, stdio: "ignore" });
  const read = (key) => JSON.parse(fs.readFileSync(`${prefix}-${key}.json`, "utf8"));
  const board = read("board-long");
  const movers = read("movers");
  const trix = read("sector-trix");

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

  /* BOTH PAYLOADS FIT. The ingest route refuses anything over 128KB, and it
     refuses it as a 413 from the Worker rather than here. */
  for (const [key, payload] of [["movers", movers], ["sector:trix", trix]]) {
    const bytes = JSON.stringify(payload).length;
    ok(bytes < 32 * 1024,
       `${key} is ${(bytes / 1024).toFixed(1)}KB, comfortably inside the 128KB ingest cap`);
  }

  fs.rmSync(path.dirname(prefix), { recursive: true, force: true });
}

console.log(`✓ flows-pipeline: ${checks} assertions — live publish path, candle-order invariance, issuer collapse, dead-band partitioning, the dated archive key and its bounded prune, the watch board's ranking and vocabulary, multiplicative quality gating, direction monotonicity, packed sparklines, Eastern session resolution, liquidity floor, sector TRIX and the fixed-clamp scaling that keeps a flat day flat, the movers band's zero-call guarantee and its unranked counts`);
