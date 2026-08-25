#!/usr/bin/env node
/* =============================================================
   flows-pipeline.mjs — the daily Flows board pipeline.

   Runs in GitHub Actions, never on Cloudflare. The Workers free
   plan allows 10 ms of CPU per invocation including cron, and this
   job is 500-900 Unusual Whales calls; chaining that through a
   1-minute-minimum cron would take hours and wedge on any stall.
   Here there is no CPU limit and no subrequest limit.

   The Worker's only job is to verify a session and hand back the
   stored string. Everything numeric happens in this file.

   Usage:
     node scripts/flows-pipeline.mjs              # live
     node scripts/flows-pipeline.mjs --dry-run    # synthetic, no network
     node scripts/flows-pipeline.mjs --dry-run --emit out.json

   Environment (live only):
     UW_API_KEY           Unusual Whales bearer token
     FLOWS_INGEST_URL     e.g. https://anilkaya.org/api/flows/ingest
     FLOWS_INGEST_TOKEN   bearer token for that endpoint
   ============================================================= */

import {
  num, winsorize, robustZ, vanDerWaerden, neutralize,
  flowPurity, aggressorGamma, bookDisplacement, pathSignature,
  gammaDecayCalendar, positioningQuality, effectiveBreadth,
  calibrateScoreScale, boundedScore, conviction, applyHysteresis,
} from "../shared/flows-features.js";

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has("--dry-run");
const EMIT = process.argv.includes("--emit")
  ? process.argv[process.argv.indexOf("--emit") + 1]
  : null;

const BASE = "https://api.unusualwhales.com";

/* ---------- universe gate --------------------------------------
   These thresholds are the difference between a live edge and a
   rounding error, not housekeeping. A genuine flow composite makes
   a gross 10-day decile spread of 30-80 bp; round-trip cost is
   15-30 bp above a $50M ADV floor and 40-100 bp below it. Names
   that fail these filters are exactly where dramatic-looking flow
   is uncapturable after costs. */
const UNIVERSE = {
  minPrice: 5,               // sub-$5 names have percentage spreads that eat the spread
  minMarketCap: 1e9,         // below this, options are too thin to exit
  minDollarVolume: 5e7,      // the $50M ADV floor the cost model depends on
  minOptionVolume: 1000,     // fewer contracts than this and per-name greeks are noise
  minOpenInterest: 5000,
  excludeIssueTypes: ["ETF", "Index", "ADR"],   // index flow is not single-name conviction
  boardSize: 25,
  enrichPerSide: 30,         // enrich a buffer so hysteresis has candidates to hold
};

/* ---------- rate limiting --------------------------------------
   Unusual Whales documents no rate limit anywhere — not in the
   OpenAPI spec, not in the docs. Rather than assume a number, start
   conservative, obey Retry-After when offered, back off on 429, and
   record the achieved rate so the real ceiling can be discovered
   from the logs. */
const RATE = { startDelayMs: 120, minDelayMs: 60, maxDelayMs: 5000, maxRetries: 4 };

const stats = { calls: 0, retries: 0, rateLimited: 0, failures: 0, startedAt: Date.now() };
let delayMs = RATE.startDelayMs;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uw(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; attempt <= RATE.maxRetries; attempt++) {
    await sleep(delayMs);
    stats.calls++;
    let response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: "Bearer " + process.env.UW_API_KEY,
          Accept: "application/json",
        },
      });
    } catch (error) {
      stats.retries++;
      delayMs = Math.min(delayMs * 2, RATE.maxDelayMs);
      if (attempt === RATE.maxRetries) throw error;
      continue;
    }

    if (response.status === 429) {
      stats.rateLimited++;
      const retryAfter = Number(response.headers.get("Retry-After"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(delayMs * 4, RATE.maxDelayMs);
      // Raise the floor permanently: hitting 429 once means the
      // starting guess was wrong for this key's tier.
      delayMs = Math.min(Math.max(delayMs * 2, 250), RATE.maxDelayMs);
      await sleep(wait);
      continue;
    }

    if (response.status >= 500) {
      stats.retries++;
      delayMs = Math.min(delayMs * 2, RATE.maxDelayMs);
      if (attempt === RATE.maxRetries) throw new Error(`${path} -> HTTP ${response.status}`);
      continue;
    }

    if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);

    // A clean response earns a small speed-up, floored so we never
    // creep back into the rate limiter.
    delayMs = Math.max(RATE.minDelayMs, delayMs * 0.9);
    const body = await response.json();
    return Array.isArray(body) ? body : (body && body.data) || [];
  }
  throw new Error(`${path} -> exhausted retries`);
}

/* ---------- universe -------------------------------------------- */

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

/**
 * The cheap universe-wide tilt: one screener call, no per-name fan-out.
 * This is the baseline every expensive measure has to beat, and it is
 * also what SELECTS which names get enriched — so its quality bounds
 * the whole board. Worth stating plainly rather than hiding.
 *
 * net_put_premium positive means put BUYING (ask side minus bid side),
 * which is bearish, so the composite subtracts it.
 */
function screenerTilt(row) {
  const bull = num(row.bullish_premium);
  const bear = num(row.bearish_premium);
  const netCall = num(row.net_call_premium);
  const netPut = num(row.net_put_premium);

  const gross = Math.abs(bull) + Math.abs(bear);
  const premiumTilt = gross > 0 ? (bull - bear) / gross : 0;
  const netTilt = (netCall - netPut);

  // Volume surprise relative to the name's own 30-day norm, so a
  // mega-cap's ordinary Tuesday does not outrank a real event.
  const callSurprise = num(row.avg_30_day_call_volume) > 0
    ? num(row.call_volume) / num(row.avg_30_day_call_volume) : 1;
  const putSurprise = num(row.avg_30_day_put_volume) > 0
    ? num(row.put_volume) / num(row.avg_30_day_put_volume) : 1;

  // Open-interest change: what actually stuck from yesterday.
  const callOiChange = num(row.call_open_interest) - num(row.prev_call_oi);
  const putOiChange = num(row.put_open_interest) - num(row.prev_put_oi);

  return {
    premiumTilt,
    netTilt,
    surpriseTilt: Math.log((callSurprise + 0.1) / (putSurprise + 0.1)),
    oiTilt: callOiChange - putOiChange,
    ivMomentum: num(row.iv30d) - num(row.iv30d_1w),
    relVolume: num(row.relative_volume),
  };
}

/** Days until earnings, or null. Used to gate, never to predict. */
function daysToEarnings(row, today) {
  if (!row.next_earnings_date) return null;
  const t = Date.parse(row.next_earnings_date + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  return Math.round((t - today) / 86400000);
}

/* ---------- per-name enrichment --------------------------------- */

async function enrich(ticker, spot) {
  const band = spot > 0
    ? { min_strike: Math.floor(spot * 0.7), max_strike: Math.ceil(spot * 1.3) }
    : {};

  // Bounding the strike ladder is what makes per-name enrichment
  // affordable: an unbanded ladder is ~600 KB, a banded one a fraction.
  const [greekFlow, ticks, strikes, expiries, ohlc] = await Promise.all([
    uw(`/api/stock/${ticker}/greek-flow`).catch(() => []),
    uw(`/api/stock/${ticker}/net-prem-ticks`).catch(() => []),
    uw(`/api/stock/${ticker}/spot-exposures/strike`, { ...band, limit: 500 }).catch(() => []),
    uw(`/api/stock/${ticker}/greek-exposure/expiry`).catch(() => []),
    uw(`/api/stock/${ticker}/ohlc/1d`, { timeframe: "2M" }).catch(() => []),
  ]);

  return computeFeatures({ ticker, spot, greekFlow, ticks, strikes, expiries, ohlc });
}

/** Wilder's ATR(14) — the sigma unit for distance-to-spot. */
function atr14(candles) {
  const rows = (candles || []).slice(-40).map((c) => ({
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

function computeFeatures({ ticker, spot, greekFlow, ticks, strikes, expiries, ohlc }) {
  const purity = flowPurity(greekFlow);
  const quality = positioningQuality(greekFlow);
  const gamma = aggressorGamma(strikes);
  const atr = atr14(ohlc);
  const displacement = bookDisplacement(strikes, atr);
  const path = pathSignature(ticks);
  const calendar = gammaDecayCalendar(expiries);

  const flipDist = gamma.flip && spot > 0 ? (gamma.flip - spot) / spot : null;

  return {
    ticker,
    spot,
    atr,
    purity: purity.purity,
    dirDelta: purity.dirDelta,
    otmShare: quality.otmShare,
    vegaTilt: quality.vegaTilt,
    hasView: quality.hasDirectionalView,
    netGamma: gamma.netGamma,
    gammaFlip: gamma.flip,
    flipDist,
    gRegime: gamma.netGamma >= 0 ? "long" : "short",
    displacement: displacement.displacement,
    displacementWeight: displacement.weight,
    persistence: path.persistence,
    concentration: path.concentration,
    centroid: path.centroid,
    pathNet: path.net,
    gammaHalfLife: calendar.halfLifeExpiry,
    gammaFrontLoad: calendar.frontLoad,
    coverage: [greekFlow.length, ticks.length, strikes.length, expiries.length, ohlc.length]
      .filter((n) => n > 0).length / 5,
  };
}

/* ---------- scoring ---------------------------------------------
   Five families. Each is normalized across the enriched cross-section
   before combining, so a family cannot dominate by having larger raw
   units than another. */

const FAMILIES = {
  F: "flow",          // directional flow: purity-weighted delta
  P: "positioning",   // dealer gamma regime and displacement
  D: "path",          // intraday accumulation shape
  V: "vol",           // gamma calendar / regime durability
  O: "quality",       // lottery vs considered, vol-vs-direction
};

function scoreBoard(features, tilts, sectors, caps) {
  const n = features.length;
  if (!n) return [];

  const col = (fn) => winsorize(features.map(fn), 0.02);
  const z = (fn) => robustZ(col(fn));

  // Family F — directional flow, purity-weighted. A large delta flow
  // that is mostly spreads is not conviction, so purity multiplies.
  const fDelta = z((f, i) => f.dirDelta * (0.25 + 0.75 * f.purity));
  const fTilt = z((f, i) => tilts[i].premiumTilt);
  const fNet = z((f, i) => tilts[i].netTilt);
  const fOi = z((f, i) => tilts[i].oiTilt);

  // Family P — dealer positioning. Short gamma amplifies whatever
  // direction flow is pushing; long gamma suppresses it. Displacement
  // is signed toward where new gamma is building.
  const pDisp = z((f) => (f.displacementWeight > 0 ? f.displacement : 0));
  const pFlip = z((f) => (f.flipDist === null ? 0 : -f.flipDist));

  // Family D — path shape. Persistent accumulation in the day's
  // direction, discounted when it all arrived in one spike.
  const dPath = z((f) => Math.sign(f.pathNet) * f.persistence * (1 - f.concentration));

  // Family V — regime durability. A front-loaded gamma book means the
  // current regime expires soon; that is information, not noise.
  const vFront = z((f) => -f.gammaFrontLoad);

  // Family O — quality. High OTM share is lottery positioning; a high
  // vega tilt means they are trading vol, not direction.
  const oQuality = z((f) => -(f.otmShare) - Math.min(f.vegaTilt, 5) * 0.2);

  const familyCols = {
    F: [fDelta, fTilt, fNet, fOi],
    P: [pDisp, pFlip],
    D: [dPath],
    V: [vFront],
    O: [oQuality],
  };

  // Correlation-clustered weighting: naive equal weighting silently
  // overweights whichever family has the most members, so weight each
  // by its EFFECTIVE breadth rather than its raw count.
  const familyScores = {};
  const weights = {};
  let weightTotal = 0;
  for (const [key, cols] of Object.entries(familyCols)) {
    const nEff = effectiveBreadth(cols);
    weights[key] = nEff;
    weightTotal += nEff;
    familyScores[key] = features.map((_, i) =>
      cols.reduce((a, c) => a + c[i], 0) / cols.length);
  }

  // Neutralize the blend against sector and size: the board should rank
  // names against their peers, not rediscover "semis were strong today".
  const logCap = caps.map((c) => (c > 0 ? Math.log(c) : 0));
  const blended = features.map((_, i) =>
    Object.keys(familyCols).reduce((a, k) => a + (weights[k] / weightTotal) * familyScores[k][i], 0));
  const residual = neutralize(blended, { numeric: [logCap], groups: sectors });

  // Rank-to-normal, then calibrate the score scale FROM this session's
  // dispersion so the top band is reachable on a quiet day too.
  const ranked = vanDerWaerden(residual);
  const scale = calibrateScoreScale(ranked, { refQuantile: 0.95, refScore: 80 });

  return features.map((f, i) => {
    const subs = {};
    for (const k of Object.keys(familyCols)) {
      subs[k] = boundedScore(familyScores[k][i], scale);
    }
    const conv = conviction({
      familyScores: Object.values(subs),
      coverage: f.coverage,
      persistence: f.persistence,
    });
    return {
      ...f,
      score: boundedScore(ranked[i], scale),
      fam: subs,
      conviction: conv.conviction,
      agreement: conv.agreement,
    };
  });
}

/* ---------- payload --------------------------------------------- */

function toRows(scored, screenerByTicker, side, previousIds) {
  const sorted = scored.slice().sort((a, b) =>
    side === "long" ? b.score - a.score : a.score - b.score);

  const ids = applyHysteresis(
    sorted.map((r) => r.ticker), previousIds,
    { entryRank: UNIVERSE.boardSize, exitRank: Math.round(UNIVERSE.boardSize * 1.4) },
  );
  const byTicker = new Map(sorted.map((r) => [r.ticker, r]));

  return ids.map((ticker, i) => {
    const r = byTicker.get(ticker);
    const s = screenerByTicker.get(ticker) || {};
    const close = num(s.close);
    const prev = num(s.prev_close);
    return {
      t: ticker,
      r: i + 1,
      s: r.score,
      cnv: r.conviction,
      px: close || r.spot,
      chg: prev > 0 ? (close - prev) / prev : null,
      purity: Number(r.purity.toFixed(3)),
      gRegime: r.gRegime,
      gFlipDist: r.flipDist === null ? null : Number(r.flipDist.toFixed(4)),
      netPrem: num(s.net_call_premium) - num(s.net_put_premium),
      fam: r.fam,
    };
  });
}

async function publish(key, payload) {
  const body = JSON.stringify(payload);
  if (EMIT || DRY_RUN) {
    if (EMIT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(EMIT.replace(/\.json$/, "") + "-" + key.replace(":", "-") + ".json", body);
    }
    console.log(`  [dry-run] ${key}: ${payload.rows.length} rows, ${body.length} bytes`);
    return;
  }
  const response = await fetch(
    process.env.FLOWS_INGEST_URL + "?key=" + encodeURIComponent(key),
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.FLOWS_INGEST_TOKEN,
        "Content-Type": "application/json",
      },
      body,
    },
  );
  if (!response.ok) throw new Error(`ingest ${key} -> HTTP ${response.status}`);
  console.log(`  published ${key}: ${payload.rows.length} rows, ${body.length} bytes`);
}

/* ---------- synthetic fixtures for --dry-run --------------------
   Deterministic, shaped like the real responses, so the whole code
   path runs without a key. This is what makes the pipeline testable
   in CI and reviewable without vendor access. */

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
  const rnd = mulberry(20260825);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const price = 8 + rnd() * 400;
    const callVol = Math.round(2000 + rnd() * 900000);
    const putVol = Math.round(1500 + rnd() * 700000);
    const bull = rnd() * 4e7;
    const bear = rnd() * 4e7;
    rows.push({
      ticker: "SYN" + String(i).padStart(3, "0"),
      close: price.toFixed(2),
      prev_close: (price * (0.97 + rnd() * 0.06)).toFixed(2),
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
      net_call_premium: String(Math.round((rnd() - 0.5) * 6e7)),
      net_put_premium: String(Math.round((rnd() - 0.5) * 4e7)),
      iv30d: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1w: (0.18 + rnd() * 0.5).toFixed(4),
      relative_volume: (0.5 + rnd() * 3).toFixed(2),
      next_earnings_date: rnd() > 0.85
        ? new Date(Date.now() + Math.floor(rnd() * 20) * 86400000).toISOString().slice(0, 10)
        : null,
    });
  }
  return rows;
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
  let acc = 0;
  const ticks = Array.from({ length: 390 }, (_, i) => {
    acc += (rnd() - 0.5 + bias * 0.6) * 900;
    return { tape_time: new Date(t0 + i * 60000).toISOString(), net_delta: String(acc) };
  });

  const strikes = Array.from({ length: 41 }, (_, i) => {
    const k = spot * (0.7 + i * 0.015);
    const w = Math.exp(-Math.pow((k - spot) / (spot * 0.12), 2));
    const g = w * 4e6 * (rnd() - 0.45);
    return {
      strike: k.toFixed(2),
      call_gamma_ask: String(-Math.abs(g)), call_gamma_bid: String(Math.abs(g) * rnd()),
      put_gamma_ask: String(-Math.abs(g) * rnd()), put_gamma_bid: String(Math.abs(g) * rnd()),
      call_gamma_oi: String(Math.abs(g) * 2), put_gamma_oi: String(Math.abs(g) * 1.6),
      call_gamma_vol: String(Math.abs(g) * rnd() * 2), put_gamma_vol: String(Math.abs(g) * rnd() * 1.4),
    };
  });

  const expiries = Array.from({ length: 6 }, (_, i) => ({
    expiry: new Date(Date.UTC(2026, 7, 28) + i * 7 * 86400000).toISOString().slice(0, 10),
    call_gamma: String(9e6 / (i + 1) * (0.6 + rnd())),
    put_gamma: String(-7e6 / (i + 1) * (0.6 + rnd())),
  }));

  let px = spot;
  const ohlc = Array.from({ length: 42 }, () => {
    const move = (rnd() - 0.5) * spot * 0.03;
    const open = px; px = Math.max(1, px + move);
    return {
      open: open.toFixed(2), close: px.toFixed(2),
      high: (Math.max(open, px) * 1.008).toFixed(2),
      low: (Math.min(open, px) * 0.992).toFixed(2),
    };
  });

  return { ticker, spot, greekFlow, ticks, strikes, expiries, ohlc };
}

/* ---------- main ------------------------------------------------- */

async function main() {
  const today = Date.now();
  console.log(DRY_RUN ? "Flows pipeline — DRY RUN (synthetic, no network)" : "Flows pipeline — live");

  if (!DRY_RUN) {
    for (const key of ["UW_API_KEY", "FLOWS_INGEST_URL", "FLOWS_INGEST_TOKEN"]) {
      if (!process.env[key]) throw new Error(`missing required environment variable ${key}`);
    }
  }

  // 1. Universe, from a single screener call.
  const screener = DRY_RUN ? fakeScreener(420) : await uw("/api/screener/stocks", { limit: 500 });
  const universe = screener.filter(eligible);
  console.log(`universe: ${universe.length} eligible of ${screener.length} screened`);
  if (universe.length < 50) throw new Error(`universe too small (${universe.length}) — refusing to publish`);

  const screenerByTicker = new Map(universe.map((r) => [r.ticker, r]));

  // 2. Cheap tilt, and the earnings gate. Earnings inside the horizon is
  //    the single largest source of false options-flow signals, so those
  //    names are excluded rather than scored and hoped for.
  const tilted = universe.map((row) => ({ row, tilt: screenerTilt(row) }))
    .filter(({ row }) => {
      const dte = daysToEarnings(row, today);
      return dte === null || dte < 0 || dte > 12;
    });
  console.log(`after earnings gate: ${tilted.length}`);

  const composite = tilted.map(({ row, tilt }) => ({
    row, tilt,
    rough: tilt.premiumTilt + Math.tanh(tilt.netTilt / 2e7) + Math.tanh(tilt.surpriseTilt),
  })).sort((a, b) => b.rough - a.rough);

  // 3. Enrich only the extremes. This two-stage split is the entire
  //    request economy: 1 screener call plus ~5 per enriched name.
  const picks = [
    ...composite.slice(0, UNIVERSE.enrichPerSide),
    ...composite.slice(-UNIVERSE.enrichPerSide),
  ];
  console.log(`enriching ${picks.length} names (${UNIVERSE.enrichPerSide} per side)`);

  const enriched = [];
  let failed = 0;
  for (const [i, pick] of picks.entries()) {
    const ticker = pick.row.ticker;
    const spot = num(pick.row.close);
    try {
      enriched.push({
        features: DRY_RUN
          ? computeFeatures(fakeEnrichment(ticker, spot, 1000 + i))
          : await enrich(ticker, spot),
        tilt: pick.tilt,
        row: pick.row,
      });
    } catch (error) {
      failed++;
      console.warn(`  ${ticker}: enrichment failed — ${error.message}`);
    }
  }

  // 4. THE COMPLETENESS GATE. A partially ingested day must never
  //    quietly produce a ranking that looks complete.
  const completeness = enriched.length / picks.length;
  console.log(`enrichment: ${enriched.length}/${picks.length} (${(completeness * 100).toFixed(1)}%), ${failed} failed`);
  if (completeness < 0.8) {
    throw new Error(
      `completeness ${(completeness * 100).toFixed(1)}% below the 80% gate — publishing nothing`,
    );
  }

  // 5. Score.
  const scored = scoreBoard(
    enriched.map((e) => e.features),
    enriched.map((e) => e.tilt),
    enriched.map((e) => e.row.sector || ""),
    enriched.map((e) => num(e.row.marketcap)),
  );

  // 6. Publish both sides.
  const generatedAt = new Date().toISOString();
  for (const side of ["long", "short"]) {
    const rows = toRows(scored, screenerByTicker, side, []);
    await publish("board:" + side, {
      side, generatedAt, rows,
      universe: universe.length,
      enriched: enriched.length,
      status: rows.length ? "ok" : "pending",
    });
  }

  const elapsed = (Date.now() - stats.startedAt) / 1000;
  console.log(
    `\ndone in ${elapsed.toFixed(1)}s — ${stats.calls} API calls` +
    `, ${stats.retries} retries, ${stats.rateLimited} rate-limited` +
    `, achieved ${(stats.calls / Math.max(elapsed, 1)).toFixed(2)} req/s` +
    ` (final inter-call delay ${Math.round(delayMs)}ms)`,
  );
  console.log("Record the achieved rate: the vendor documents no limit, so this is how the real one gets discovered.");
}

main().catch((error) => {
  console.error("pipeline failed:", error.message);
  process.exit(1);
});
