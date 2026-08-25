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
     FLOWS_INGEST_URL     optional; defaults to https://anilkaya.org/api/flows/ingest
     FLOWS_INGEST_TOKEN   bearer token for that endpoint
   ============================================================= */

import {
  num, quantile, winsorize, robustZ, neutralize,
  flowPurity, aggressorGamma, bookDisplacement, pathSignature,
  gammaDecayCalendar, positioningQuality, effectiveBreadth,
  crossFamilyRedundancy, qualityGate, percentileRank, realizedVol,
  isLiveColumn, pearson, SCORE_SCALE,
  boundedScore, conviction, applyHysteresis,
} from "../shared/flows-features.js";
import { buildCard } from "../shared/flows-card.js";

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has("--dry-run");
const EMIT = process.argv.includes("--emit")
  ? process.argv[process.argv.indexOf("--emit") + 1]
  : null;

const BASE = "https://api.unusualwhales.com";

/* The ingest endpoint is a PUBLIC URL, not a secret — the bearer token is what
   protects it. Requiring it as a repository secret added a configuration step
   and a place to typo, and getting it wrong is the failure that looks like
   success: the pipeline runs, every publish 401s or redirects, and the board
   silently keeps yesterday's data. It defaults to production and stays
   overridable for a staging Worker or a local test.

   Resolved per call rather than captured at import: a module-level constant
   freezes whatever the environment held when the file was first imported, so
   a test that sets FLOWS_INGEST_URL after importing would silently POST to
   PRODUCTION. The contract test caught exactly that. */
function ingestURL() {
  return process.env.FLOWS_INGEST_URL || "https://anilkaya.org/api/flows/ingest";
}

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
  // The $50M ADV floor the cost model depends on. It canNOT be applied here:
  // /api/screener/stocks returns options volume only and never absolute stock
  // volume, so there is no way to compute dollar ADV from the one universe
  // call. It is enforced after enrichment instead, from the ohlc/1d candles
  // that are fetched anyway for ATR. See dollarVolume in computeFeatures.
  minDollarVolume: 5e7,
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
const RATE = {
  startDelayMs: 120, minDelayMs: 60, maxDelayMs: 5000, maxRetries: 4,
  maxRetryAfterMs: 30_000,   // the ceiling on a vendor-supplied Retry-After
};

/* The wall-clock budget.
   GitHub kills the job at 45 minutes. The backoff above has no notion of that,
   so a sustained 429 regime just walks into the timeout — and because cards
   are built before the boards publish, a slow day would take the RANKING down
   with the cards. Boards publish first, and card building abandons at this
   deadline and reports how many it managed. */
const DEADLINE_MS = 30 * 60 * 1000;

/** Delay between publishes, to stay under the edge's burst-rate challenge. */
const PUBLISH_SPACING_MS = 150;

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
      // CAPPED. Retry-After is a value the vendor controls, and honouring it
      // literally hands them a lever on this job's 45-minute budget: a single
      // `Retry-After: 3600` would sleep one hour inside one call and guarantee
      // a timeout with no board published. Above the cap, back off on our own
      // schedule and let the retry limit end it.
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, RATE.maxRetryAfterMs)
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
  const premiumTilt = gross > 0 ? (bull - bear) / gross : null;

  /* EVERY tilt is made unit-free here, against the name's own scale.
     robustZ normalises a column across the cross-section but cannot undo the
     fact that a mega-cap's ordinary session carries a hundred times the raw
     dollars of a mid-cap's event: z-scoring a dollar column ranks market caps
     with a flow-shaped wobble on top. neutralize() removes the LINEAR log-cap
     component from the blend afterwards, which is a much weaker instrument
     than never letting the size in. */
  const grossPremium = Math.abs(num(row.call_premium)) + Math.abs(num(row.put_premium));
  const netTilt = grossPremium > 0 ? (netCall - netPut) / grossPremium : null;

  // Volume surprise relative to the name's own 30-day norm, so a
  // mega-cap's ordinary Tuesday does not outrank a real event.
  const callSurprise = num(row.avg_30_day_call_volume) > 0
    ? num(row.call_volume) / num(row.avg_30_day_call_volume) : 1;
  const putSurprise = num(row.avg_30_day_put_volume) > 0
    ? num(row.put_volume) / num(row.avg_30_day_put_volume) : 1;

  // Open-interest change: what actually stuck from yesterday, as a share of
  // the standing book rather than in raw contracts.
  const callOiChange = num(row.call_open_interest) - num(row.prev_call_oi);
  const putOiChange = num(row.put_open_interest) - num(row.prev_put_oi);
  const oiBase = num(row.total_open_interest) ||
    (num(row.call_open_interest) + num(row.put_open_interest));

  /* AGGRESSOR-SIDE VOLUME, in contracts. The premium tilts are size-weighted
     by option price, so one deep-ITM print can outweigh ten thousand cheap
     ones; the contract count is a genuinely different view of the same tape
     and the screener has been returning it, unread, all along. */
  const callVol = num(row.call_volume);
  const putVol = num(row.put_volume);
  const volBase = callVol + putVol;
  const volTilt = volBase > 0
    ? ((num(row.call_volume_ask_side) - num(row.call_volume_bid_side)) -
       (num(row.put_volume_ask_side) - num(row.put_volume_bid_side))) / volBase
    : null;

  const iv30 = num(row.iv30d, NaN);
  return {
    premiumTilt,
    netTilt,
    volTilt,
    surpriseTilt: Math.log((callSurprise + 0.1) / (putSurprise + 0.1)),
    oiTilt: oiBase > 0 ? (callOiChange - putOiChange) / oiBase : null,

    /* The volatility surface, all of it already paid for by the one screener
       call and all of it previously computed and thrown away. */
    iv30: Number.isFinite(iv30) ? iv30 : null,
    ivMomentum: Number.isFinite(iv30) ? iv30 - num(row.iv30d_1w, NaN) : null,
    ivRank: num(row.iv_rank, NaN),
    impliedMovePerc: num(row.implied_move_perc, NaN),
    impliedMove: num(row.implied_move, NaN),
    atmVol: num(row.volatility, NaN),
    relVolume: num(row.relative_volume, NaN),
    putCallRatio: num(row.put_call_ratio, NaN),
    week52High: num(row.week_52_high, NaN),
    week52Low: num(row.week_52_low, NaN),
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

/**
 * PROVE THE NEW PARAMETERS WORK BEFORE BETTING THE RUN ON THEM.
 *
 * Dating every per-name call is the fix for a board stamped with the wrong
 * session and a family that measured nothing — and it is also a way to lose
 * the whole run. A date the vendor will not accept, or a session it has no
 * data for, does not error: it returns an empty array. Every name then fails
 * the required-source gate, the 80% completeness gate throws, and nothing
 * publishes at all. The undated behaviour was wrong but it was not an outage.
 *
 * Two calls against SPY settle it. `date` is checked for USABLE output rather
 * than a 200, because the exact failure that started this was a 200 carrying
 * rows whose greeks were null. When a probe fails the run continues with that
 * parameter dropped, loudly, rather than publishing nothing.
 */
async function verifyDating(sessionDate) {
  if (!sessionDate || DRY_RUN) return { date: !!sessionDate, endDate: !!sessionDate };

  const usable = (rows) => (rows || []).some(
    (r) => r && r.expiry && (num(r.call_gamma) !== 0 || num(r.put_gamma) !== 0));

  const [dated, undated, capped] = await Promise.all([
    uw("/api/stock/SPY/greek-exposure/expiry", { date: sessionDate }).catch(() => []),
    uw("/api/stock/SPY/greek-exposure/expiry").catch(() => []),
    uw("/api/stock/SPY/ohlc/1d", { timeframe: "1M", end_date: sessionDate }).catch(() => []),
  ]);

  const date = usable(dated);
  const endDate = Array.isArray(capped) && capped.length > 0;
  if (!date) {
    console.warn(
      `WARNING: /greek-exposure/expiry?date=${sessionDate} returns no usable gamma for SPY` +
      (usable(undated) ? ", while the undated call does" : ", and neither does the undated call") +
      " — dropping `date` for this run. The board will carry whatever session the " +
      "vendor defaults to, which is the behaviour that mislabelled it before.");
  }
  if (!endDate) {
    console.warn(
      `WARNING: /ohlc/1d?end_date=${sessionDate} returned no candles for SPY — ` +
      "dropping `end_date` for this run. Candles will include the session in progress.");
  }
  return { date, endDate };
}

async function enrich(ticker, spot, sessionDate, dating = { date: true, endDate: true }) {
  const band = spot > 0
    ? { min_strike: Math.round(spot * 0.7), max_strike: Math.round(spot * 1.3) }
    : {};

  /* ONE SESSION, named explicitly, for all five sources.
     Every call used to go out undated, and the five endpoints did not agree
     about which day that meant: /net-prem-ticks returned a complete prior
     session while /ohlc/1d returned a candle stamped for a day that had not
     opened, so the board was headed with the wrong date. Worse,
     /greek-exposure/expiry is an end-of-day open-interest aggregate — asked
     for a session that has not happened it returns rows with null greeks,
     which is exactly how family V came out identically zero on all thirty-four
     published names while coverage went on reporting five sources of five. */
  const dated = sessionDate && dating.date ? { date: sessionDate } : {};

  // Bounding the strike ladder is what makes per-name enrichment
  // affordable: an unbanded ladder is ~600 KB, a banded one a fraction.
  const [greekFlow, ticks, strikes, expiries, ohlc] = await Promise.all([
    uw(`/api/stock/${ticker}/greek-flow`, dated).catch(() => []),
    uw(`/api/stock/${ticker}/net-prem-ticks`, dated).catch(() => []),
    uw(`/api/stock/${ticker}/spot-exposures/strike`, { ...band, ...dated, limit: 500 }).catch(() => []),
    uw(`/api/stock/${ticker}/greek-exposure/expiry`, dated).catch(() => []),
    /* A YEAR of candles rather than two months, for no extra call: the
       sparkline, the 5/21/42-session returns, the 30-day realized vol behind
       the variance risk premium and the 52-week position all come out of this
       one response. end_date pins it to the same session as the rest. */
    uw(`/api/stock/${ticker}/ohlc/1d`, {
      timeframe: "1Y",
      ...(sessionDate && dating.endDate ? { end_date: sessionDate } : {}),
    }).catch(() => []),
  ]);

  /* A missing source is NOT a zero.
     Each call above is individually caught, so enrich() could not throw and
     the completeness gate — which counts only thrown exceptions — reported
     100% for a name that had lost four of its five sources. Worse, the zeros
     were not neutral: a missing greek-flow gives otmShare = 0 and vegaTilt = 0,
     which is the TOP of family O's winsorized column, so losing the data
     scored BETTER than having it. A name that cannot be measured must be
     dropped, not ranked.

     greek-flow carries families F and O, spot-exposures carries P, and the
     candles carry both the ATR that normalises every distance and the dollar
     volume the liquidity floor needs. Those three are required. Ticks (family
     D) and expiries (family V) degrade coverage instead, which conviction
     already discounts. */
  const missing = [];
  if (!greekFlow.length) missing.push("greek-flow");
  if (!strikes.length) missing.push("spot-exposures/strike");
  if (!ohlc.length) missing.push("ohlc/1d");
  if (missing.length) throw new Error(`no data from ${missing.join(", ")}`);

  /* The raw arrays are RETAINED, not discarded.

     computeFeatures reduces four multi-hundred-row responses to twenty-odd
     scalars and the arrays were thrown away — so the card reader looked like
     it needed a twelve-call-per-name fan-out when in fact the gamma ladder,
     the tick tape, the expiry gamma and the candles are already paid for. The
     highest-value panels cost nothing extra; only max-pain and the congress
     filings are new. */
  return {
    features: computeFeatures({ ticker, spot, greekFlow, ticks, strikes, expiries, ohlc, sessionDate }),
    raw: { greekFlow, ticks, strikes, expiries, ohlc },
  };
}

/**
 * THE TRADING SESSION THE DATA DESCRIBES, resolved once and pinned.
 *
 * This used to be read back out of whatever the enrichment happened to
 * return — the newest parseable candle across every name — on the stated
 * premise that "every endpoint called without a date returns the most recent
 * COMPLETED session". That premise is false for /ohlc/1d, which returns a
 * candle stamped for the day in progress. The published INTC card proved it:
 * generated 08:01 Eastern, stamped sessionDate 2026-08-25, carrying a tick
 * tape of 390 minutes beginning 2026-08-24 09:30 — a complete prior session
 * under the wrong date.
 *
 * Resolve it FIRST, from one call, so the same date can be handed to every
 * per-name source; then all five describe one session by construction rather
 * than by hope. A candle stamped for today is a partial session until the
 * 16:00 Eastern close, so it is not eligible before then.
 */
async function resolveSessionDate() {
  const candles = await uw("/api/stock/SPY/ohlc/1d", { timeframe: "1M" }).catch(() => []);
  const dates = candlesAscending(candles)
    .map((c) => String(c.start_time || c.end_time || c.date || "").slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!dates.length) return null;

  const now = easternNow();
  const complete = dates.filter((d) => d < now.date || (d === now.date && now.minutes >= 16 * 60));
  if (complete.length) return complete[complete.length - 1];
  // Every candle we have is for a session still in progress. Step back one.
  return dates.length > 1 ? dates[dates.length - 2] : null;
}

/** Today's Eastern calendar date and minutes-since-midnight, DST included. */
function easternNow(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    // Some ICU builds render midnight as hour 24 under hour12:false.
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

/**
 * Median daily dollar volume over the candle window. Median rather than mean
 * so a single earnings-day volume spike cannot lift an otherwise illiquid
 * name over the floor.
 */
function medianDollarVolume(candles) {
  const values = (candles || [])
    .map((c) => num(c.close) * num(c.volume))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (!values.length) return 0;
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/**
 * Sort candles oldest-first.
 *
 * The vendor does not document the order /ohlc returns, and every consumer
 * here assumes oldest-first: atr14 runs Wilder's forward recursion and uses
 * each bar's PREVIOUS close, and both take the newest window off the end. If
 * the response is newest-first, `.slice(-40)` silently keeps the OLDEST bars
 * and the recursion runs backwards through time. Rather than depend on an
 * undocumented convention, sort explicitly — correct under either.
 */
function candlesAscending(candles) {
  const rows = (candles || []).map((c) => ({
    c,
    t: Date.parse(c.start_time || c.end_time || c.date || ""),
  }));
  // If no candle carries a parseable timestamp there is nothing to sort by;
  // fall back to the given order rather than discarding the whole series.
  if (!rows.some((r) => Number.isFinite(r.t))) return candles || [];
  return rows
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t)
    .map((r) => r.c);
}

/** Wilder's ATR(14) — the sigma unit for distance-to-spot. */
function atr14(candles) {
  const rows = candlesAscending(candles).slice(-40).map((c) => ({
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

function computeFeatures({ ticker, spot, greekFlow, ticks, strikes, expiries, ohlc, sessionDate, tilt }) {
  const purity = flowPurity(greekFlow);
  const quality = positioningQuality(greekFlow);
  const gamma = aggressorGamma(strikes, { spot });
  const atr = atr14(ohlc);
  const displacement = bookDisplacement(strikes, atr);
  const path = pathSignature(ticks);
  const calendar = gammaDecayCalendar(expiries, { asOf: sessionDate });
  const dollarVolume = medianDollarVolume(ohlc);

  const closes = candlesAscending(ohlc).map((c) => num(c.close));
  const rv30 = realizedVol(closes, { window: 30 });
  const iv30 = tilt && Number.isFinite(tilt.iv30) ? tilt.iv30 : null;

  const flipDist = gamma.flip && spot > 0 ? (gamma.flip - spot) / spot : null;

  /* COVERAGE counts USABLE OUTPUT, not array length.
     enrich()'s own docstring commits to "a missing source is NOT a zero"; a
     source that returns rows which every downstream filter then drops defeats
     that in exactly the same way, and did — the vendor returned expiry rows
     with null greeks, gammaDecayCalendar dropped all of them, family V was
     identically zero on all 34 published names, and coverage still reported
     5/5 so conviction paid full price for a source that produced nothing. */
  const usable = [
    greekFlow.length > 0,
    path.bars > 0,
    gamma.ladder.length > 0,
    calendar.schedule.length > 0,
    ohlc.length > 0,
  ];

  return {
    ticker,
    spot,
    atr,
    dollarVolume,
    sessionDate: sessionDate || null,

    // --- flow, unit-free ---
    purity: purity.purity,
    dirDelta: purity.dirDelta,
    dirShare: purity.dirShare,
    otmShare: quality.otmShare,
    vegaTilt: quality.vegaTilt,
    hasView: quality.hasDirectionalView,

    // --- dealer positioning ---
    netGamma: gamma.netGamma,
    gammaPeak: gamma.peak,
    gammaFlip: gamma.flip,
    flipSide: gamma.flipSide,
    flipCount: gamma.crossings.length,
    spotGammaShare: gamma.spotGammaShare,
    bandMin: gamma.bandMin,
    bandMax: gamma.bandMax,
    flipDist,
    flipDistAtr: gamma.flip && atr > 0 ? (gamma.flip - spot) / atr : null,
    /* The regime AT SPOT, which is the question the netGamma sign was being
       asked to answer. netGamma is the whole band's total; what a hedger
       responds to is the gamma where the stock actually is. */
    gRegime: gamma.spotGammaShare === null
      ? (gamma.netGamma >= 0 ? "long" : "short")
      : (gamma.spotGammaShare >= 0 ? "long" : "short"),
    displacement: displacement.displacement,
    displacementWeight: displacement.weight,

    // --- path ---
    persistence: path.persistence,
    concentration: path.concentration,
    centroid: path.centroid,
    pathNet: path.net,
    pathBars: path.bars,

    // --- gamma term structure ---
    gammaHalfLife: calendar.halfLifeExpiry,
    gammaHalfLifeDays: calendar.halfLifeDays,
    gammaMeanLifeDays: calendar.meanLifeDays,
    gammaFrontLoad: calendar.frontLoad,

    // --- volatility, entirely from data already fetched ---
    iv30,
    rv30,
    /* THE VARIANCE RISK PREMIUM. iv30d is the 30-day implied vol the screener
       already returns; rv30 is close-to-close realized vol over the same 30
       sessions, from the candles fetched for ATR. Both are annualized vols of
       the same underlying over the same horizon, so the difference is
       identified with no free parameter and no extra API call: positive means
       the option market is charging more than the stock has been delivering. */
    vrp: iv30 !== null && rv30 !== null ? iv30 - rv30 : null,
    ivMomentum: tilt && tilt.ivMomentum !== null ? tilt.ivMomentum : null,
    ivRank: tilt && Number.isFinite(tilt.ivRank) ? tilt.ivRank : null,
    impliedMovePerc: tilt && Number.isFinite(tilt.impliedMovePerc) ? tilt.impliedMovePerc : null,

    // The last 42 sessions of closes, retained so the deck's sparkline and
    // its 5/21/42-session returns cost nothing: these candles were already
    // fetched for ATR, the liquidity floor and the realized-vol baseline.
    closes: closes.slice(-42),
    /* Computed from the FULL year, not from the 42 retained for the
       sparkline: a 42-session return needs 43 closes, so reading it back out
       of the 42-element slice resolved to null on every name. */
    r5: ret(closes, 5),
    r21: ret(closes, 21),
    r42: ret(closes, 42),
    week52Pos: week52Position(closes),

    coverage: usable.filter(Boolean).length / usable.length,
    sources: {
      greekFlow: greekFlow.length,
      ticks: path.bars,
      strikes: gamma.ladder.length,
      expiries: calendar.schedule.length,
      candles: ohlc.length,
    },
  };
}

/* ---------- scoring ---------------------------------------------
   THREE SIGNED AXES and TWO GAUGES, not five families of votes.

   The five-family blend that shipped had a structural fault that its own
   comment describes and does not fix. Three of its ten columns were unsigned
   magnitudes multiplied by sign(dirDelta) so they could be ADDED to a signed
   sum. Measured on the pipeline's own cross-section, those columns were 95%
   sign(dirDelta) by correlation, they carried the negative sign and a quarter
   of the weight, and the composite came out with corr(blend, dirDelta) =
   -0.07: the long board was ranking AGAINST its own directional flow signal.

   A magnitude that carries no direction of its own is a MODIFIER. Modifiers
   multiply. So:

     signed axes   F (flow), P (positioning), D (path)   -- added, z-scored
     gate          O (quality)                           -- multiplies
     context       V (vol regime)                        -- published, unscored

   V is published and not scored on purpose. There is no identified sign that
   turns "implied vol is rich" into "this name goes up", and the family that
   used to be called "vol" contained no volatility at all — its single column
   was the first expiry's share of gross dealer gamma. Rather than keep a
   directional claim nobody can defend, the volatility surface is measured
   properly (variance risk premium, IV rank, IV innovation) and shown as
   regime context beside the score.
*/

const FAMILIES = {
  F: "flow",          // SIGNED — directional flow, unit-free
  P: "positioning",   // SIGNED — where new dealer gamma is building
  D: "path",          // SIGNED — intraday accumulation shape
  V: "vol",           // GAUGE  — volatility regime, 0..100, no direction
  O: "quality",       // GAUGE  — the multiplicative gate, 0..100
};

/** The signed axes. Only these three enter the composite additively. */
const SIGNED = ["F", "P", "D"];

/**
 * The dead band, in published score points.
 *
 * partitionSides used to split at the MEDIAN, unconditionally, so exactly half
 * the pool was labelled long and half short whatever the day looked like: on
 * the live board GOOGL scored -2 and was published as a short candidate
 * because rank 18 of 34 fell on the short side of the median. A board with no
 * neutral state cannot report a quiet session.
 *
 * This is a PRESENTATION threshold, not an identification claim: a name whose
 * score is inside +-20 is not shown on either board. Published in the payload
 * so the reader can see the bar that was applied.
 */
const DEAD_BAND = 20;

function scoreBoard(features, tilts, sectors, caps) {
  const n = features.length;
  if (!n) return [];

  // A column is built from a per-name accessor that may return null for
  // "not measured". null becomes NaN, robustZ ignores it when finding the
  // median and the MAD, and emits 0 for it — the neutral vote, not the worst.
  const raw = (fn) => features.map((f, i) => {
    const v = fn(f, tilts[i], i);
    return v === null || v === undefined || !Number.isFinite(v) ? NaN : v;
  });
  const z = (fn) => robustZ(winsorize(raw(fn), 0.02));

  /* ---- F, flow. Every column is a RATIO, bounded and unit-free, so the
     cross-section compares flow rather than market capitalisation. ---- */
  const fDelta = z((f) => f.dirShare);          // net directional delta / gross delta
  const fTilt = z((f, t) => t.premiumTilt);     // bullish vs bearish premium
  const fNet = z((f, t) => t.netTilt);          // net premium / gross premium
  const fOi = z((f, t) => t.oiTilt);            // OI change / standing book
  const fVol = z((f, t) => t.volTilt);          // aggressor-side contract count

  /* ---- P, positioning. Displacement is already in ATR units and is the one
     genuinely SIGNED quantity in the gamma block: it says which way today's
     flow is moving the book relative to where the book already is. ---- */
  const pDisp = z((f) => (f.displacementWeight > 0 ? f.displacement : null));

  /* ---- D, path. Signed by the day's own net direction, discounted when all
     of it arrived in one spike. ---- */
  const dPath = z((f) =>
    (f.pathBars > 0 ? Math.sign(f.pathNet) * f.persistence * (1 - f.concentration) : null));

  const familyCols = {
    F: [fDelta, fTilt, fNet, fOi, fVol],
    P: [pDisp],
    D: [dPath],
  };

  /* ---- weights. Two levels of the same n_eff algebra.

     Within a family, effectiveBreadth discounts columns that restate each
     other — and now refuses to pay for a column with no dispersion at all,
     which is how a dead family drew a live family's weight.

     BETWEEN families, crossFamilyRedundancy does the same thing one level up.
     effectiveBreadth was only ever called with one family's own columns, so
     it was structurally incapable of seeing that the two most correlated
     columns on the board lived in different families. ---- */
  const familyScores = {};
  for (const [key, cols] of Object.entries(familyCols)) {
    const live = cols.filter(isLiveColumn);
    familyScores[key] = live.length
      ? features.map((_, i) => live.reduce((a, c) => a + c[i], 0) / live.length)
      : null;                                   // absent, not neutral
  }

  const liveKeys = SIGNED.filter((k) => familyScores[k] !== null);
  const redundancy = crossFamilyRedundancy(
    Object.fromEntries(liveKeys.map((k) => [k, familyScores[k]])));

  const weights = {};
  let weightTotal = 0;
  for (const key of liveKeys) {
    const w = effectiveBreadth(familyCols[key]) / redundancy[key];
    weights[key] = w;
    weightTotal += w;
  }

  const blended = features.map((_, i) =>
    (weightTotal > 0
      ? liveKeys.reduce((a, k) => a + (weights[k] / weightTotal) * familyScores[k][i], 0)
      : 0));

  /* ---- O, the quality gate. Each axis is ORIENTED so larger is more
     trustworthy, then reduced to its cross-sectional percentile, so no axis
     needs a unit or a hand-set coefficient and a near-constant axis
     contributes almost nothing. The gate is bounded in (0,2) with a mean of
     one by construction, so it reallocates conviction across the board
     without inventing a scale — and it cannot flip a sign. ---- */
  const gateAxes = [
    raw((f) => f.purity),                          // directional share of the tape
    raw((f) => (f.otmShare === null ? null : -f.otmShare)),      // lottery tickets discount
    raw((f) => (f.vegaTilt === null ? null : -f.vegaTilt)),      // trading vol, not direction
    raw((f) => (f.gammaFrontLoad === null ? null : -f.gammaFrontLoad)), // regime expires soon
    /* Dealers SHORT gamma at spot amplify whatever the flow is pushing; long
       gamma damps it. Measured at spot rather than summed over the whole band,
       and expressed as a share of the ladder's peak so it is comparable across
       names. This is the amplification mechanism family P's old comment
       described and the code never contained. */
    raw((f) => (f.spotGammaShare === null ? null : -f.spotGammaShare)),
  ];
  const gate = qualityGate(gateAxes);

  const composite = blended.map((b, i) => b * gate[i]);

  // Neutralize against sector and size: the board should rank names against
  // their peers, not rediscover "semis were strong today".
  const logCap = caps.map((c) => (c > 0 ? Math.log(c) : 0));
  const residual = neutralize(composite, { numeric: [logCap], groups: sectors });

  /* ---- V, the volatility regime gauge. Published, never scored. Three
     percentiles averaged: how rich options are against delivered vol, where
     30-day IV sits in its own year, and whether it is rising. ---- */
  const volAxes = [
    raw((f) => f.vrp),
    raw((f) => f.ivRank),
    raw((f) => f.ivMomentum),
  ].filter(isLiveColumn).map(percentileRank);

  const dispersion = quantile(residual.map(Math.abs), 0.95);

  return features.map((f, i) => {
    const subs = {};
    for (const k of SIGNED) {
      subs[k] = familyScores[k] === null ? null : boundedScore(familyScores[k][i], SCORE_SCALE);
    }
    // Both gauges are 0..100 and carry NO sign. The card must not draw them
    // on the same centre-origin axis as F, P and D.
    subs.O = Math.round(50 * Math.min(gate[i], 2));
    const vs = volAxes.map((c) => c[i]).filter((v) => v !== null);
    subs.V = vs.length ? Math.round(100 * (vs.reduce((a, b) => a + b, 0) / vs.length)) : null;

    const conv = conviction({
      familyScores: SIGNED.map((k) => subs[k]),
      coverage: f.coverage,
      persistence: f.persistence,
    });
    return {
      ...f,
      residual: residual[i],
      gate: gate[i],
      score: boundedScore(residual[i], SCORE_SCALE),
      fam: subs,
      conviction: conv.conviction,
      agreement: conv.agreement,
      breadth: conv.breadth,
      dispersion,
      weights,
    };
  });
}

/* ---------- payload --------------------------------------------- */

/**
 * Split the scored pool into two DISJOINT halves before either board is
 * built. Taking the top N and the bottom N of one sorted list looks
 * equivalent and is not: once the pool drops below 2*boardSize the two
 * slices overlap and a name appears on BOTH boards at once, presented as
 * simultaneously a top long and a top short candidate.
 *
 * That is reachable in normal operation, not a pathological case. With
 * enrichPerSide 30 the pool is 60 and the completeness gate passes at 80%,
 * i.e. 48 survivors — which overlaps by 2. At 40 survivors it overlaps by 10.
 *
 * Partitioning at the median makes the boards disjoint by construction at
 * any pool size, and a shrunken pool then yields a SHORTER board rather than
 * an incoherent one.
 */
function partitionSides(scored, { deadBand = DEAD_BAND } = {}) {
  /* Order on the FULL-PRECISION residual, not the rounded score. Under the old
     rank ladder two names could never tie — a 34-name board had 34 distinct
     values by construction — so sorting on `score` was safe by accident. Under
     a fixed unit two names round to the same integer routinely, and sorting on
     the rounded value hands the tie to Array.prototype.sort's stability rather
     than to the data. `score` is for display; `residual` decides. */
  const sorted = scored.slice().sort((a, b) => b.residual - a.residual);
  /* A DEAD BAND, not a median split.

     Splitting at the median made the board's length a constant and its
     contents a formality: exactly half the pool was labelled long and half
     short whatever the session looked like. On the live board that published
     GOOGL at -2 — the median name of thirty-four — as a short candidate,
     while its own share class GOOG sat fourth on the long board.

     Filtering on the score instead makes the two slices disjoint by
     construction at any pool size (the old comment's requirement is met a
     fortiori), and a quiet session now yields a SHORT board rather than a
     full one made of noise. */
  return {
    long: sorted.filter((r) => r.score >= deadBand),
    short: sorted.filter((r) => r.score <= -deadBand).reverse(),   // most negative first
    neutral: sorted.filter((r) => Math.abs(r.score) < deadBand).length,
    deadBand,
  };
}

/**
 * Collapse share classes of one issuer to a single row BEFORE scoring.
 *
 * GOOG and GOOGL are one company's cash flows with different voting rights.
 * Nothing in the pipeline knew that: the screener union keys on the raw
 * ticker string, the earnings gate, the liquidity floor and the scorer all
 * key on ticker, and neutralize() cannot help — an OLS projection on sector
 * and log-cap removes what the two share, and PRESERVES in full exactly the
 * idiosyncratic difference that put them on opposite boards.
 *
 * Identification: two listings of one issuer have the same company market
 * capitalisation, sit in the same sector, and their daily log returns differ
 * only by the liquidity of the two lines. Both conditions must hold. The
 * survivor is the more liquid line, which is the one a reader can trade.
 */
function collapseShareClasses(records, { minCorr = 0.97 } = {}) {
  const key = (e) => {
    const cap = num(e.row.marketcap);
    if (!(cap > 0)) return null;
    return (e.row.sector || "") + "|" + cap.toPrecision(6);
  };
  const groups = new Map();
  for (const e of records) {
    const k = key(e);
    if (k === null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const dropped = [];
  const remove = new Set();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ranked = members.slice()
      .sort((a, b) => b.features.dollarVolume - a.features.dollarVolume);
    const keeper = ranked[0];
    for (const other of ranked.slice(1)) {
      const r = returnCorrelation(keeper.raw.ohlc, other.raw.ohlc);
      if (Number.isFinite(r) && r >= minCorr) {
        remove.add(other.features.ticker);
        dropped.push({ kept: keeper.features.ticker, dropped: other.features.ticker, corr: r });
      }
    }
  }
  return { kept: records.filter((e) => !remove.has(e.features.ticker)), dropped };
}

/** Pearson correlation of daily log returns over the overlapping dates. */
function returnCorrelation(a, b) {
  const series = (candles) => {
    const map = new Map();
    for (const c of candlesAscending(candles)) {
      const d = String(c.start_time || c.end_time || c.date || "").slice(0, 10);
      const close = num(c.close);
      if (d && close > 0) map.set(d, close);
    }
    return map;
  };
  const A = series(a), B = series(b);
  const dates = [...A.keys()].filter((d) => B.has(d)).sort();
  if (dates.length < 10) return NaN;
  const ra = [], rb = [];
  for (let i = 1; i < dates.length; i++) {
    ra.push(Math.log(A.get(dates[i]) / A.get(dates[i - 1])));
    rb.push(Math.log(B.get(dates[i]) / B.get(dates[i - 1])));
  }
  return pearson(ra, rb);
}

/**
 * The top n and bottom n of a ranked list, DEDUPLICATED by ticker.
 *
 * slice(0, n) and slice(-n) overlap whenever the list holds fewer than 2n
 * entries — a state this pipeline explicitly permits, since it only refuses a
 * universe below 50 against an enrich buffer of 30 per side. The same name was
 * then enriched twice (five wasted calls each), entered the scored pool twice,
 * and could land on the long AND the short board at once, presented as two
 * independent opinions. partitionSides guarantees its slices are INDEX-disjoint,
 * not TICKER-disjoint, so it does not cover this. At 55 survivors five names
 * duplicated; at 50, ten did.
 */
/* ---------- deck encoding ---------------------------------------- */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Forty-two sessions of closes as a base-64 string, two characters a session.
 *
 * Each close is quantised to twelve bits across the window's OWN min and max,
 * which is all a sparkline needs: the shape is scale-free and the levels are
 * published separately as px and pr. Eighty-four bytes a card, against a card
 * that already measures in kilobytes, and no API call that was not already
 * being made.
 */
function packSpark(closes, { window = 42 } = {}) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0).slice(-window);
  if (xs.length < 2) return null;
  let lo = Infinity, hi = -Infinity;
  for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;
  let out = "";
  for (const v of xs) {
    const q = span > 0 ? Math.round(4095 * ((v - lo) / span)) : 2048;
    out += B64[(q >> 6) & 63] + B64[q & 63];
  }
  return out;
}

/** Where the last close sits in its own 52-week range, 0 at the low, 1 at the high. */
function week52Position(closes) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0).slice(-252);
  if (xs.length < 20) return null;
  let lo = Infinity, hi = -Infinity;
  for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi > lo ? (xs[xs.length - 1] - lo) / (hi - lo) : 0.5;
}

/** Simple return over the last n sessions, or null when the window is short. */
function ret(closes, n) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0);
  if (xs.length < n + 1) return null;
  const a = xs[xs.length - 1 - n];
  return a > 0 ? xs[xs.length - 1] / a - 1 : null;
}

/**
 * The tickers on the currently published board, for hysteresis.
 *
 * Non-fatal by design: if this cannot be read, the board is simply built with
 * no incumbents, which is exactly what shipped before hysteresis was wired up.
 * A stale-board read must never stop today's board from publishing.
 */
async function fetchPublishedTickers(key) {
  if (DRY_RUN) return [];
  try {
    const response = await fetch(
      ingestURL() + "?key=" + encodeURIComponent(key),
      {
        redirect: "error",   // same reasoning as publish(): never redirect a bearer
        headers: { Authorization: "Bearer " + process.env.FLOWS_INGEST_TOKEN },
      },
    );
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body.rows) ? body.rows.map((r) => r.t).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function selectExtremes(ranked, n) {
  const picked = new Map();
  for (const p of [...ranked.slice(0, n), ...ranked.slice(-n)]) {
    if (!picked.has(p.row.ticker)) picked.set(p.row.ticker, p);
  }
  return [...picked.values()];
}

function toRows(pool, screenerByTicker, previousIds) {
  const ids = applyHysteresis(
    pool.map((r) => r.ticker), previousIds,
    { entryRank: UNIVERSE.boardSize, exitRank: Math.round(UNIVERSE.boardSize * 1.4) },
  );
  const byTicker = new Map(pool.map((r) => [r.ticker, r]));

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
      purity: r.purity === null ? null : Number(r.purity.toFixed(3)),
      gRegime: r.gRegime,
      gFlipDist: r.flipDist === null ? null : Number(r.flipDist.toFixed(4)),
      netPrem: num(s.net_call_premium) - num(s.net_put_premium),
      fam: r.fam,
      // 42 sessions of closes, base-64 packed: two characters a session, so
      // the whole sparkline costs 84 bytes on a card that already measures in
      // kilobytes, and it needs no API call the pipeline was not making.
      spark: packSpark(r.closes),
      // Period returns in basis points, so the deck can rank without decoding
      // the sparkline.
      pr: [r.r5, r.r21, r.r42].map((x) => (x === null ? null : Math.round(x * 10000))),
      w52: r.week52Pos === null ? null : Number(r.week52Pos.toFixed(3)),
      vrp: r.vrp === null ? null : Number(r.vrp.toFixed(4)),
      ivr: r.ivRank === null ? null : Number(r.ivRank.toFixed(3)),
      im: r.impliedMovePerc === null ? null : Number(r.impliedMovePerc.toFixed(4)),
    };
  });
}

/**
 * One description of a payload, used by BOTH publish branches.
 *
 * It was written twice, and the two copies diverged: the dry-run branch was
 * taught that cards and meta carry no `rows` while the live branch kept
 * reading `payload.rows.length` directly. Since --dry-run returns before ever
 * reaching the live branch, the harness could not see it — so a green dry run
 * certified a path that would throw on the first real card, fail all fifty
 * inside their per-card catch, and then take the whole job down on the
 * uncaught meta publish, AFTER the boards had already been committed.
 *
 * Sharing the function is the fix; the test below exercises the live branch
 * against a stub so the two can never silently disagree again.
 */
function summarize(payload) {
  return Array.isArray(payload.rows) ? `${payload.rows.length} rows` : "no rows";
}

async function publish(key, payload) {
  const body = JSON.stringify(payload);
  if (EMIT || DRY_RUN) {
    if (EMIT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(EMIT.replace(/\.json$/, "") + "-" + key.replace(":", "-") + ".json", body);
    }
    console.log(`  [dry-run] ${key}: ${summarize(payload)}, ${body.length} bytes`);
    return;
  }
  const response = await fetch(
    ingestURL() + "?key=" + encodeURIComponent(key),
    {
      method: "POST",
      // Never follow a redirect while carrying a bearer token. If
      // FLOWS_INGEST_URL is set to the apex when the site redirects to www, or
      // to http when the zone upgrades to https, the client would re-issue the
      // request — with the Authorization header — against whatever the
      // redirect named. Failing loudly on a misconfigured URL is the correct
      // outcome; silently handing the ingest token to another host is not.
      redirect: "error",
      headers: {
        Authorization: "Bearer " + process.env.FLOWS_INGEST_TOKEN,
        "Content-Type": "application/json",
        // Identify the client honestly. Node's fetch sends no User-Agent, and
        // an anonymous POST from a datacenter address is exactly the shape
        // edge bot heuristics drop. Naming the caller is also what lets the
        // operator write a precise WAF skip rule instead of a broad one.
        "User-Agent": "anilkaya-flows-pipeline/1 (+https://github.com/anilkaya001/anilkaya.org)",
      },
      body,
    },
  );
  // Space the writes. 37 POSTs inside eleven seconds from one datacenter
  // address is what tripped Cloudflare's rate challenge on the first live run;
  // the boards and every card had already landed, so the challenge was purely
  // a function of burst rate. 150ms puts the whole publish phase near six
  // seconds and well under the threshold, against a job budgeted in minutes.
  await sleep(PUBLISH_SPACING_MS);
  if (!response.ok) {
    /* Report WHOSE rejection this is.
       The Worker's own failures are the project's JSON envelope; an edge
       rejection is an HTML block page with a cf-ray. Only the status was
       reported, so a 403 from Cloudflare's WAF — a status this Worker never
       returns on the ingest path — was indistinguishable from an application
       error, and there was nothing in the log to act on. */
    const detail = await response.text().catch(() => "");
    const ray = response.headers.get("cf-ray") || "none";
    const server = response.headers.get("server") || "unknown";
    throw new Error(
      `ingest ${key} -> HTTP ${response.status}` +
      ` (server: ${server}, cf-ray: ${ray})` +
      (detail ? ` body: ${detail.slice(0, 300).replace(/\s+/g, " ")}` : " body: <empty>"),
    );
  }
  console.log(`  published ${key}: ${summarize(payload)}, ${body.length} bytes`);
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
      call_premium: String(Math.round(bull + rnd() * 2e7)),
      put_premium: String(Math.round(bear + rnd() * 2e7)),
      call_volume_ask_side: Math.round(callVol * (0.3 + rnd() * 0.4)),
      call_volume_bid_side: Math.round(callVol * (0.3 + rnd() * 0.4)),
      put_volume_ask_side: Math.round(putVol * (0.3 + rnd() * 0.4)),
      put_volume_bid_side: Math.round(putVol * (0.3 + rnd() * 0.4)),
      iv30d: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1w: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1d: (0.18 + rnd() * 0.5).toFixed(4),
      iv30d_1m: (0.18 + rnd() * 0.5).toFixed(4),
      iv_rank: rnd().toFixed(4),
      implied_move: (price * (0.02 + rnd() * 0.06)).toFixed(4),
      implied_move_perc: (0.02 + rnd() * 0.06).toFixed(6),
      volatility: (0.18 + rnd() * 0.5).toFixed(4),
      put_call_ratio: (putVol / callVol).toFixed(4),
      week_52_high: (price * (1.05 + rnd() * 0.6)).toFixed(2),
      week_52_low: (price * (0.4 + rnd() * 0.4)).toFixed(2),
      relative_volume: (0.5 + rnd() * 3).toFixed(2),
      next_earnings_date: rnd() > 0.85
        ? new Date(Date.now() + Math.floor(rnd() * 20) * 86400000).toISOString().slice(0, 10)
        : null,
    });
  }
  return rows;
}

/** Max pain per expiry, nearest first — the shape /max-pain returns. */
function fakeMaxPain(ticker, spot) {
  const rnd = mulberry(ticker.length * 977 + Math.round(spot));
  return Array.from({ length: 5 }, (_, i) => ({
    expiry: new Date(Date.UTC(2026, 7, 28) + i * 7 * 86400000).toISOString().slice(0, 10),
    max_pain: (spot * (0.94 + rnd() * 0.12)).toFixed(0),
  }));
}

/** Disclosed congressional filings, including a deliberately late one. */
function fakeCongress(ticker) {
  const rnd = mulberry(ticker.length * 613);
  const n = Math.floor(rnd() * 5);
  return Array.from({ length: n }, (_, i) => {
    const txn = Date.UTC(2026, 6, 5 + i * 4);
    // Lags of 3 to 80 days, because that spread is the point of the panel.
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

  /* PER-TICK increments, matching the vendor's own definition — every field
     on a /net-prem-ticks row is that tick's value, not a running total. This
     fixture used to accumulate before storing, which pinned the opposite
     convention and hid the fact that pathSignature was differencing its input. */
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

  /* A BOOK THAT CAN ACTUALLY FLIP.

     The previous fixture drew every rung from `w * 4e6 * (rnd() - 0.45)` and
     then summed four legs whose expectation was negative, so the cumulative
     was monotone by construction and no ladder it produced could ever change
     sign. gammaFlip therefore had NOTHING to exercise in the dry run — the
     same shape of blindness that let the call_gamma / call_gamma_ask field
     names ship: a fixture that avoids the input the function exists for.

     The realistic shape is the textbook one: put gamma dominates below spot
     and call gamma above, so the cumulative starts negative, crosses once near
     the money and ends positive. `tilt` moves the crossing off spot and, on
     roughly one name in six, pushes it out of the band entirely so the
     no-flip path is exercised too. */
  /* Pivot near the money and a wide envelope, which is what a real ladder
     looks like: measured on the live INTC book, the cumulative carries 5% of
     its peak by four strikes below spot. A narrow envelope starves the lower
     lobe and every name comes back with no flip — which is a property of the
     fixture, not of the market. One name in eight is drawn one-signed so the
     genuine no-flip path is exercised too. */
  const tilt = 0.94 + rnd() * 0.12;
  const oneSided = rnd() < 0.125;
  const strikes = Array.from({ length: 41 }, (_, i) => {
    const k = spot * (0.7 + i * 0.015);
    const w = Math.exp(-Math.pow((k - spot) / (spot * 0.3), 2));
    const lean = oneSided
      ? Math.abs((k - spot * tilt) / spot)
      : (k - spot * tilt) / spot;                   // negative below the pivot
    const scale = w * 4e6 * (0.6 + rnd() * 0.8);
    const callLeg = scale * Math.max(0, lean) * 8;
    const putLeg = -scale * Math.max(0, -lean) * 8;
    return {
      strike: k.toFixed(2),
      call_gamma_ask: String(callLeg * (0.4 + rnd() * 0.3)),
      call_gamma_bid: String(callLeg * (0.3 + rnd() * 0.3)),
      put_gamma_ask: String(putLeg * (0.4 + rnd() * 0.3)),
      put_gamma_bid: String(putLeg * (0.3 + rnd() * 0.3)),
      call_gamma_oi: String(Math.abs(callLeg) * 2 + scale * 0.2),
      put_gamma_oi: String(-Math.abs(putLeg) * 1.6 - scale * 0.2),
      call_gamma_vol: String(Math.abs(callLeg) * rnd() * 2),
      put_gamma_vol: String(-Math.abs(putLeg) * rnd() * 1.4),
    };
  });

  const expiries = Array.from({ length: 6 }, (_, i) => ({
    expiry: new Date(Date.UTC(2026, 7, 28) + i * 7 * 86400000).toISOString().slice(0, 10),
    call_gamma: String(9e6 / (i + 1) * (0.6 + rnd())),
    put_gamma: String(-7e6 / (i + 1) * (0.6 + rnd())),
  }));

  let px = spot;
  const day0 = Date.UTC(2026, 5, 24, 13, 30);
  const ohlc = Array.from({ length: 252 }, (_, i) => {
    const move = (rnd() - 0.5) * spot * 0.03;
    const open = px; px = Math.max(1, px + move);
    return {
      // A real candle carries a timestamp; without one the fixture would not
      // exercise either candlesAscending or the session-date derivation.
      start_time: new Date(day0 + i * 86400000).toISOString(),
      open: open.toFixed(2), close: px.toFixed(2),
      high: (Math.max(open, px) * 1.008).toFixed(2),
      low: (Math.min(open, px) * 0.992).toFixed(2),
      volume: Math.round((3e6 + rnd() * 2e7)),
    };
  });

  return { ticker, spot, greekFlow, ticks, strikes, expiries, ohlc };
}

/* ---------- main ------------------------------------------------- */

async function main() {
  const today = Date.now();
  console.log(DRY_RUN ? "Flows pipeline — DRY RUN (synthetic, no network)" : "Flows pipeline — live");

  if (!DRY_RUN) {
    /* Report EVERY missing variable at once. Throwing on the first one costs a
       round trip per secret: the operator sets UW_API_KEY, re-runs, waits, and
       only then learns FLOWS_INGEST_TOKEN is also unset. */
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

  /* 0. THE SESSION, resolved before anything else is fetched, so every
        per-name call can be pinned to it. */
  const sessionDate = DRY_RUN ? "2026-08-24" : await resolveSessionDate();
  console.log(`session date: ${sessionDate || "unresolved — falling back to undated calls"}`);
  const dating = await verifyDating(sessionDate);
  console.log(`dating: date=${dating.date} end_date=${dating.endDate}`);

  // 1. Universe, from a single screener call.
  /* THE UNIVERSE IS FETCHED IN MARKET-CAP BANDS, because one call cannot
     return enough names.

     /api/screener/stocks accepts no `limit`, no `page` and no `offset` — the
     full parameter list has sixty-odd filters and not one of them pages — and
     a live run proved what that means in practice: the endpoint returned
     exactly 50 rows against filters that thousands of US names satisfy. 50 is
     a fixed page cap. The original `limit: 500` was a silent no-op, so this
     pipeline could never have cleared its own 50-name universe floor; the
     failure only surfaced once real credentials let the call through.

     With no pagination parameter, the way to see more of the market is to ask
     narrower questions. Market cap is the right axis: the bands are disjoint
     so the pages cannot overlap, `min_marketcap` and `max_marketcap` are
     unambiguous numerics already proven to work in the live call, and no enum
     value has to be guessed — unlike `sectors[]`, whose accepted spellings are
     undocumented here and would silently return nothing if wrong.

     Six bands, up to 50 each, deduplicated by ticker. Sector diversity comes
     along for free, which matters because the score neutralises on sector: a
     universe drawn entirely from one industry makes that step meaningless. */
  const CAP_BANDS = [
    [UNIVERSE.minMarketCap, 3e9],
    [3e9, 1e10],
    [1e10, 5e10],
    [5e10, 2e11],
    [2e11, 1e12],
    [1e12, null],
  ];

  let screener;
  if (DRY_RUN) {
    screener = fakeScreener(420);
  } else {
    const byTicker = new Map();
    for (const [min, max] of CAP_BANDS) {
      const page = await uw("/api/screener/stocks", {
        min_underlying_price: UNIVERSE.minPrice,
        min_volume: UNIVERSE.minOptionVolume,
        min_oi: UNIVERSE.minOpenInterest,
        min_marketcap: min,
        ...(max === null ? {} : { max_marketcap: max }),
      }).catch(() => []);
      for (const row of page) if (row && row.ticker) byTicker.set(row.ticker, row);
      const label = max === null
        ? `>= $${(min / 1e9).toFixed(0)}B`
        : `$${(min / 1e9).toFixed(0)}-${(max / 1e9).toFixed(0)}B`;
      console.log(`  screener ${label.padEnd(12)} ${String(page.length).padStart(3)} rows` +
                  `  (union ${byTicker.size})`);
    }
    screener = [...byTicker.values()];
  }

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
    /* netTilt is now net premium divided by GROSS premium, a ratio in
       [-1,1]; it used to be raw dollars, which is why it was squashed through
       tanh(x / 2e7). Dividing a ratio by twenty million made the term
       identically zero, so the selection composite silently lost a third of
       itself the moment the column was made unit-free. */
    rough: (tilt.premiumTilt || 0) + (tilt.netTilt || 0) + (tilt.volTilt || 0) +
           Math.tanh(tilt.surpriseTilt),
  })).sort((a, b) => b.rough - a.rough);

  // 3. Enrich only the extremes. This two-stage split is the entire
  //    request economy: 1 screener call plus ~5 per enriched name.
  /* Deduplicate by ticker. slice(0, n) and slice(-n) overlap whenever fewer
     than 2n names survive the earnings gate — a state this pipeline explicitly
     permits, since it only refuses below 50 — and the same name was then
     enriched twice (five wasted calls each), entered the scored pool twice,
     and could land on the long AND the short board simultaneously.
     partitionSides guarantees its two slices are INDEX-disjoint, not
     TICKER-disjoint, so the downstream fix did not cover this. At 55 survivors
     five names duplicated; at 50, ten did. */
  const picks = selectExtremes(composite, UNIVERSE.enrichPerSide);
  console.log(`enriching ${picks.length} names (${UNIVERSE.enrichPerSide} per side)`);

  const enriched = [];
  let failed = 0;
  for (const [i, pick] of picks.entries()) {
    const ticker = pick.row.ticker;
    const spot = num(pick.row.close);
    try {
      let features, raw;
      if (DRY_RUN) {
        const fake = fakeEnrichment(ticker, spot, 1000 + i);
        features = computeFeatures({ ...fake, sessionDate, tilt: pick.tilt });
        raw = fake;
      } else {
        ({ features, raw } = await enrich(ticker, spot, sessionDate, dating));
        features = computeFeatures({ ...raw, ticker, spot, sessionDate, tilt: pick.tilt });
      }
      enriched.push({ features, raw, tilt: pick.tilt, row: pick.row });
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

  // A board thinner than this is not worth showing: the cross-section it was
  // ranked against is no longer meaningful.
  const MIN_ROWS = 10;

  // 5. THE LIQUIDITY FLOOR, applied here because the screener cannot supply it.
  //    Below ~$50M median daily dollar volume, round-trip cost is 40-100 bp
  //    against a gross 10-day decile spread of 30-80 bp — the edge is gone.
  //    A name with no usable candles reports 0 and is dropped rather than
  //    waved through, because an unknown liquidity is not a passing one.
  const liquid = enriched.filter((e) => e.features.dollarVolume >= UNIVERSE.minDollarVolume);
  const dropped = enriched.length - liquid.length;
  console.log(
    `liquidity floor: ${liquid.length}/${enriched.length} clear ` +
    `$${(UNIVERSE.minDollarVolume / 1e6).toFixed(0)}M median daily dollar volume` +
    (dropped ? ` (${dropped} dropped)` : ""),
  );
  if (liquid.length < 2 * MIN_ROWS) {
    throw new Error(
      `only ${liquid.length} names clear the liquidity floor — publishing nothing ` +
      `rather than a board of names that cannot be traded at these costs`,
    );
  }

  /* 5b. ONE ROW PER ISSUER, before scoring rather than after, so the
     cross-section the scorer normalises against is not double-counting a
     company and n is right. GOOG entered fourth on the long board while
     GOOGL — the same company — sat on the short side of the median. */
  const { kept: unique, dropped: shareClasses } = collapseShareClasses(liquid);
  for (const d of shareClasses) {
    console.log(
      `share class: kept ${d.kept}, dropped ${d.dropped} ` +
      `(same sector and market cap, return correlation ${d.corr.toFixed(3)})`);
  }

  // 6. Score.
  const scored = scoreBoard(
    unique.map((e) => e.features),
    unique.map((e) => e.tilt),
    unique.map((e) => e.row.sector || ""),
    unique.map((e) => num(e.row.marketcap)),
  );

  // 7. Publish both sides.
  const generatedAt = new Date().toISOString();
  const sides = partitionSides(scored);
  console.log(
    `sides: ${sides.long.length} long, ${sides.short.length} short, ` +
    `${sides.neutral} inside the +-${sides.deadBand} dead band ` +
    `(dispersion ${(scored[0] && scored[0].dispersion || 0).toFixed(3)})`);

  /* A THIN side is information, not a failure. The old gate threw the whole
     run away when either side held fewer than MIN_ROWS — which, under a
     median split, could only ever mean the pool itself was tiny. Under a dead
     band a short side of four means four names cleared the bar, and refusing
     to publish that would misreport a quiet session as an outage. Both sides
     empty is still a failure: that is a scoring fault, not a quiet day. */
  if (!sides.long.length && !sides.short.length) {
    throw new Error(
      `no name on either side cleared the +-${sides.deadBand} dead band across ` +
      `${scored.length} scored names — publishing nothing rather than an empty board`,
    );
  }

  /* Hysteresis needs a yesterday. previousIds was a hardcoded [], so
     applyHysteresis had nothing to hold and the enrichPerSide buffer — 30 a
     side instead of 25, ten extra names of API cost every run — bought
     nothing. Read the currently published board and pass its tickers. One
     request per side, and a failure is non-fatal: no incumbents simply means
     the plain top-N, which is what shipped anyway. */
  const previous = {};
  for (const side of ["long", "short"]) {
    previous[side] = await fetchPublishedTickers("board:" + side);
  }

  const published = {};
  const first = scored[0] || {};
  for (const side of ["long", "short"]) {
    const rows = toRows(sides[side], screenerByTicker, previous[side]);
    published[side] = rows;
    await publish("board:" + side, {
      side, generatedAt, sessionDate, rows,
      universe: universe.length,
      enriched: enriched.length,
      /* WHAT THE SCORE MEANS, published beside it. The score is now a fixed
         unit — a residual two robust sigma from the cross-sectional median
         scores 80, at any pool size — so `scored` and `dispersion` are what
         let a reader tell a genuinely wide session from a flat one. Under the
         old rank ladder both printed the same +84. */
      scored: scored.length,
      dispersion: Number.isFinite(first.dispersion) ? Number(first.dispersion.toFixed(4)) : null,
      deadBand: sides.deadBand,
      neutral: sides.neutral,
      weights: first.weights || null,
      shareClasses,
      status: rows.length ? "ok" : "thin",
    });
  }

  /* 8. CARDS — after the boards are safely committed, and best-effort.

     Ordering is deliberate. Cards are the decorative half; the ranking is the
     product. Building them first would mean a slow vendor day takes the board
     down with the cards, turning a survivable degradation into a total
     outage. Published first, cards can fail freely.

     The deadline is what makes "best effort" true rather than aspirational.
     GitHub kills the job at 45 minutes and the backoff has no notion of that,
     so a sustained 429 regime would otherwise walk straight into the timeout.
     At the 5s ceiling this loop abandons at 30 minutes and reports how many
     it managed. */
  const onBoard = new Map();
  for (const side of ["long", "short"]) {
    for (const row of published[side]) onBoard.set(row.t, side);
  }
  const byTicker = new Map(liquid.map((e) => [e.features.ticker, e]));
  const scoredByTicker = new Map(scored.map((r) => [r.ticker, r]));

  let cardsBuilt = 0, cardsFailed = 0, cardsSkipped = 0;
  const deadline = stats.startedAt + DEADLINE_MS;
  for (const ticker of onBoard.keys()) {
    if (Date.now() > deadline) { cardsSkipped++; continue; }
    const e = byTicker.get(ticker);
    if (!e) { cardsSkipped++; continue; }
    try {
      const [maxPain, congress] = DRY_RUN
        ? [fakeMaxPain(ticker, num(e.row.close)), fakeCongress(ticker)]
        : await Promise.all([
          uw(`/api/stock/${ticker}/max-pain`).catch(() => []),
          uw("/api/congress/recent-trades", { ticker, limit: 50 }).catch(() => []),
        ]);

      const card = buildCard({
        ticker,
        row: e.row,
        features: { ...e.features, ...(scoredByTicker.get(ticker) || {}) },
        strikes: e.raw.strikes,
        ticks: e.raw.ticks,
        // The expiry gamma was fetched for the score and thrown away at the
        // card boundary; the roll-off staircase costs nothing to add.
        expiries: e.raw.expiries,
        weights: first.weights || null,
        maxPain, congress, generatedAt, sessionDate,
      });

      const body = JSON.stringify(card);
      // Fail loudly at the source rather than as an opaque 413 from the
      // Worker, and never let one fat card abort the rest of the loop.
      if (body.length > 100 * 1024) {
        throw new Error(`card is ${(body.length / 1024).toFixed(0)}KB, over the ingest cap`);
      }
      await publish("card:" + ticker, card);
      cardsBuilt++;
    } catch (error) {
      cardsFailed++;
      console.warn(`  card ${ticker}: ${error.message}`);
    }
  }
  console.log(
    `cards: ${cardsBuilt}/${onBoard.size} built` +
    (cardsFailed ? `, ${cardsFailed} failed` : "") +
    (cardsSkipped ? `, ${cardsSkipped} skipped past the ${DEADLINE_MS / 60000}min deadline` : ""),
  );

  /* meta is a DIAGNOSTIC, not the product, so its failure must not fail the
     run. The first live publish proved why: both boards and all 34 cards
     landed, and then this last write tripped a Cloudflare rate challenge — so
     a job that had successfully published 36 rows exited non-zero and reported
     failure. A scheduled run is judged by its exit code, and that one lied. */
  try {
    await publish("meta", {
      generatedAt, sessionDate,
      universe: universe.length,
      enriched: enriched.length,
      liquid: liquid.length,
      cardsBuilt, cardsFailed, cardsSkipped,
      apiCalls: stats.calls,
    });
  } catch (error) {
    console.warn(`  meta: ${error.message}`);
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

export {
  partitionSides, screenerTilt, eligible, atr14, daysToEarnings, medianDollarVolume,
  candlesAscending, selectExtremes, scoreBoard, publish, summarize,
  collapseShareClasses, returnCorrelation, packSpark, ret, easternNow,
  computeFeatures, DEAD_BAND,
};

// Only run when invoked directly. Without this guard, importing the module —
// which the contract tests do, to exercise partitionSides — would fire the
// whole pipeline as an import side effect.
const invokedDirectly = process.argv[1]
  && (await import("node:url")).fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((error) => {
    console.error("pipeline failed:", error.message);
    process.exit(1);
  });
}
