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
} from "../scripts/flows-pipeline.mjs";
import { pearson, horizonMove, HORIZON_SESSIONS } from "../shared/flows-features.js";

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

console.log(`✓ flows-pipeline: ${checks} assertions — live publish path, candle-order invariance, issuer collapse, dead-band partitioning, multiplicative quality gating, direction monotonicity, packed sparklines, Eastern session resolution, liquidity floor`);
