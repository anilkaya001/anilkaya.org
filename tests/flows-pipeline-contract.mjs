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
  medianDollarVolume, eligible, daysToEarnings,
} from "../scripts/flows-pipeline.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };

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

/* ---------- THE SIGN RULE ---------------------------------------
   The composite means long when positive and short when negative, so every
   column must carry a direction. A magnitude — how clean the positioning is,
   how durable the regime is — has none, and adding it to a signed sum turns
   "high quality flow" into "bullish". Two names with IDENTICAL bearish flow
   used to separate by 3.8 z purely on positioning quality, sending the clean
   one to the LONG board. */
{
  // A neutral cross-section, plus two names that differ ONLY in quality.
  const base = (i) => ({
    ticker: "N" + i,
    dirDelta: (i % 2 ? 1 : -1) * (500 + i * 10),
    purity: 0.6,
    otmShare: 0.3 + (i % 7) * 0.05,
    vegaTilt: (i % 5) * 0.6,
    netGamma: (i % 3 - 1) * 1e9,
    flipDist: (i % 11 - 5) / 100,
    displacement: (i % 9 - 4) / 2,
    displacementWeight: 1,
    persistence: 0.6,
    concentration: 0.2,
    pathNet: (i % 2 ? 1 : -1) * 1000,
    gammaFrontLoad: 0.3,
    coverage: 1,
  });
  const features = Array.from({ length: 46 }, (_, i) => base(i + 2));

  // Both are strongly BEARISH. A is clean near-money; B is OTM lottery on vega.
  const clean = { ...base(0), ticker: "CLEAN", dirDelta: -1000, otmShare: 0.10, vegaTilt: 0.05, pathNet: -1000 };
  const lotto = { ...base(1), ticker: "LOTTO", dirDelta: -1000, otmShare: 0.95, vegaTilt: 5.0, pathNet: -1000 };
  const all = [clean, lotto, ...features];

  const tilts = all.map(() => ({ premiumTilt: 0, netTilt: 0, oiTilt: 0, surpriseTilt: 0 }));
  const sectors = all.map((_, i) => ["tech", "energy", "health", "fins"][i % 4]);
  const caps = all.map(() => 5e9);

  const scored = scoreBoard(all, tilts, sectors, caps);
  const byTicker = new Map(scored.map((r) => [r.ticker, r]));
  const c = byTicker.get("CLEAN");
  const l = byTicker.get("LOTTO");

  ok(c.fam.O <= 0,
     `THE FIX: clean BEARISH flow gets a non-positive quality vote (O = ${c.fam.O})`);
  ok(c.fam.O <= l.fam.O,
     `and the clean bearish name is no less bearish than the lottery one (${c.fam.O} vs ${l.fam.O})`);
  ok(c.score < 0, `the clean bearish name scores short overall (${c.score})`);

  // The gamma regime must actually reach the score, not just the payload.
  const shortGamma = scored.filter((r) => r.netGamma < 0 && r.dirDelta > 0);
  const longGamma = scored.filter((r) => r.netGamma > 0 && r.dirDelta > 0);
  ok(shortGamma.length && longGamma.length, "the fixture covers both gamma regimes");
  const meanP = (rows) => rows.reduce((a, r) => a + r.fam.P, 0) / rows.length;
  ok(meanP(shortGamma) > meanP(longGamma),
     `THE FIX: bullish flow into SHORT gamma scores above the same flow into long gamma ` +
     `(${meanP(shortGamma).toFixed(1)} vs ${meanP(longGamma).toFixed(1)})`);

  // Every family is reported for the UI decomposition.
  for (const k of ["F", "P", "D", "V", "O"]) {
    ok(scored.every((r) => Number.isFinite(r.fam[k])), `family ${k} is finite for every row`);
  }
  ok(scored.every((r) => r.score >= -100 && r.score <= 100), "scores stay inside the band");
  ok(scored.every((r) => r.conviction >= 0 && r.conviction <= 100), "conviction stays inside the band");
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

console.log(`✓ flows-pipeline: ${checks} assertions — candle-order invariance, ticker dedupe, board disjointness, the signed-column rule, gamma regime in the score, liquidity floor`);
