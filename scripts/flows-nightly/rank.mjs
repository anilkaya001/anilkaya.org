import {
  num, quantile, winsorize, robustZ, neutralize, flowPurity, aggressorGamma, bookDisplacement, pathSignature,
  gammaDecayCalendar, positioningQuality, effectiveBreadth, crossFamilyRedundancy, qualityGate, percentileRank,
  realizedVol, isLiveColumn, pearson, SCORE_SCALE, horizonMove, boundedScore, conviction, applyHysteresis,
  callGammaLeg, openInterestGammaBook, strikeBookPutSign,
} from "../../shared/flows-features.js";
import {
  conventionProbe, estimateKc, unitFamily, nextSessionAfter, scoreVarianceShares, VARIATION_LINES, VARIATION_CODES,
} from "../../shared/flows-variation.js";
import { SPOT_EXPOSURE_PAGE } from "../../shared/flows-card.js";
import { fitGarch } from "../../shared/flows-garch.js";
import { unwrapRows as unwrapVendorRows } from "../../shared/flows-political.js";
import { yearOfCandles } from "../flows-legs/vol.mjs";
import { newsFields } from "../../shared/flows-news.js";
import { NEWS_VENDOR_LIMIT, UNIVERSE } from "./vendor-params.mjs";
import { uw } from "./vendor.mjs";
import { ARCHIVE_DATE_RE } from "./store.mjs";

let tickFieldsReported = false;

let greekFieldsReported = false;

export const TICK_FIELDS_READ = Object.freeze([
  "tape_time", "net_delta", "net_call_premium", "net_put_premium",
]);

export function describeTickFields(ticker, row, { max = 12, valueChars = 40 } = {}) {
  const keys = Object.keys(row || {});
  if (!keys.length) return [`  tick fields (${ticker}): the first row carried no keys at all`];
  const unknown = keys.filter((k) => !TICK_FIELDS_READ.includes(k));
  const lines = [`  tick fields (${ticker}): ${keys.length} keys, ${unknown.length} unread`];
  if (unknown.length) {
    const sample = unknown.slice(0, max)
      .map((k) => `${k}=${String(JSON.stringify(row[k])).slice(0, valueChars)}`)
      .join(" ");
    lines.push(`    unread: ${sample}${unknown.length > max ? ` (+${unknown.length - max} more)` : ""}`);
  }
  return lines;
}

export function eligible(row, { skipCap = false } = {}) {
  const price = num(row.close);
  const cap = num(row.marketcap);
  const callVol = num(row.call_volume);
  const putVol = num(row.put_volume);
  const oi = num(row.total_open_interest) ||
             (num(row.call_open_interest) + num(row.put_open_interest));

  if (row.is_index === true) return false;
  if (UNIVERSE.excludeIssueTypes.includes(row.issue_type)) return false;
  if (!(price >= UNIVERSE.minPrice)) return false;
  if (!skipCap && !(cap >= UNIVERSE.minMarketCap)) return false;
  if (!(callVol + putVol >= UNIVERSE.minOptionVolume)) return false;
  if (!(oi >= UNIVERSE.minOpenInterest)) return false;
  return true;
}

export const GATED_LIQUIDITY_MARGIN = 0.8;

export function screenerDollarVolume(row) {
  const px = vendorNum(row && row.close);
  const adv = vendorNum(row && row.avg30_volume);
  return px !== null && adv !== null && px > 0 && adv >= 0 ? px * adv : null;
}

export function gatedWorthEnriching(row, { focus = new Set(), floor = UNIVERSE.minDollarVolume,
  margin = GATED_LIQUIDITY_MARGIN } = {}) {
  if (!row || typeof row.ticker !== "string") return false;
  if (focus.has(row.ticker)) return true;
  const dv = screenerDollarVolume(row);
  return dv === null || dv >= floor * margin;
}

export function screenerTilt(row) {
  const both = (a, b) => a !== null && b !== null;
  const bull = vendorNum(row.bullish_premium);
  const bear = vendorNum(row.bearish_premium);
  const netCall = vendorNum(row.net_call_premium);
  const netPut = vendorNum(row.net_put_premium);

  const gross = both(bull, bear) ? Math.abs(bull) + Math.abs(bear) : 0;
  const premiumTilt = gross > 0 ? (bull - bear) / gross : null;

  const callPrem = vendorNum(row.call_premium);
  const putPrem = vendorNum(row.put_premium);
  const grossPremium = both(callPrem, putPrem) ? Math.abs(callPrem) + Math.abs(putPrem) : 0;
  const netTilt = both(netCall, netPut) && grossPremium > 0
    ? (netCall - netPut) / grossPremium : null;

  const callVol = vendorNum(row.call_volume);
  const putVol = vendorNum(row.put_volume);
  const callAvg = vendorNum(row.avg_30_day_call_volume);
  const putAvg = vendorNum(row.avg_30_day_put_volume);
  const callSurprise = callVol !== null && callAvg > 0 ? callVol / callAvg : null;
  const putSurprise = putVol !== null && putAvg > 0 ? putVol / putAvg : null;

  const callOi = vendorNum(row.call_open_interest);
  const putOi = vendorNum(row.put_open_interest);
  const prevCallOi = vendorNum(row.prev_call_oi);
  const prevPutOi = vendorNum(row.prev_put_oi);
  const oiBase = vendorNum(row.total_open_interest) ||
    (both(callOi, putOi) ? callOi + putOi : 0);
  const oiTilt = both(callOi, prevCallOi) && both(putOi, prevPutOi) && oiBase > 0
    ? ((callOi - prevCallOi) - (putOi - prevPutOi)) / oiBase : null;

  const legs = [row.call_volume_ask_side, row.call_volume_bid_side,
    row.put_volume_ask_side, row.put_volume_bid_side].map(vendorNum);
  const volBase = both(callVol, putVol) ? callVol + putVol : 0;
  const volTilt = legs.every((v) => v !== null) && volBase > 0
    ? ((legs[0] - legs[1]) - (legs[2] - legs[3])) / volBase
    : null;

  const iv30 = num(row.iv30d, NaN);
  return {
    premiumTilt,
    netTilt,
    volTilt,
    surpriseTilt: (callSurprise === null || putSurprise === null)
      ? null : Math.log((callSurprise + 0.1) / (putSurprise + 0.1)),
    oiTilt,

    iv30: Number.isFinite(iv30) ? iv30 : null,
    ivMomentum: Number.isFinite(iv30) ? iv30 - num(row.iv30d_1w, NaN) : null,

    iv30d1d: num(row.iv30d_1d, NaN),
    iv30d1m: num(row.iv30d_1m, NaN),
    ivRank: ivRankFraction(row.iv_rank),
    impliedMovePerc: num(row.implied_move_perc, NaN),
    impliedMove: num(row.implied_move, NaN),
    atmVol: num(row.volatility, NaN),
    relVolume: num(row.relative_volume, NaN),
    putCallRatio: num(row.put_call_ratio, NaN),

    callSurprise,
    putSurprise,
    week52High: num(row.week_52_high, NaN),
    week52Low: num(row.week_52_low, NaN),
  };
}

function ivRankFraction(raw) {
  const v = num(raw, NaN);
  if (!Number.isFinite(v) || v < 0 || v > 100) return NaN;
  return v / 100;
}

export function daysToEarnings(row, origin) {
  if (!row.next_earnings_date) return null;
  const t = Date.parse(row.next_earnings_date + "T00:00:00Z");
  const from = Date.parse(String(origin || "") + "T00:00:00Z");
  if (!Number.isFinite(t) || !Number.isFinite(from)) return null;
  return Math.round((t - from) / 86400000);
}

export async function enrich(ticker, spot, sessionDate, dating = { date: true, endDate: true }) {
  const band = spot > 0
    ? { min_strike: Math.round(spot * 0.7), max_strike: Math.round(spot * 1.3) }
    : {};

  const dated = sessionDate && dating.date ? { date: sessionDate } : {};

  const [greekFlow, ticks, strikes, expiries, ohlc] = await Promise.all([
    uw(`/api/stock/${ticker}/greek-flow`, dated).catch(() => []),
    uw(`/api/stock/${ticker}/net-prem-ticks`, dated).catch(() => []),
    uw(`/api/stock/${ticker}/spot-exposures/strike`, { ...band, ...dated, limit: SPOT_EXPOSURE_PAGE }).catch(() => []),
    uw(`/api/stock/${ticker}/greek-exposure/expiry`, dated).catch(() => []),

    uw(`/api/stock/${ticker}/ohlc/1d`, {
      timeframe: "2Y",
      ...(sessionDate && dating.endDate ? { end_date: sessionDate } : {}),
    }).catch(() => []),
  ]);

  if (!tickFieldsReported && ticks.length) {
    tickFieldsReported = true;
    for (const line of describeTickFields(ticker, ticks[0])) console.log(line);
  }

  if (!greekFieldsReported && expiries.length) {
    greekFieldsReported = true;
    const first = expiries[0] || {};
    const keys = Object.keys(first);
    const legs = ["call_gex", "put_gex", "call_delta", "put_delta",
      "call_charm", "put_charm", "call_vanna", "put_vanna"];
    const present = legs.filter((k) => first[k] !== null && first[k] !== undefined && first[k] !== "");
    const absent = legs.filter((k) => !present.includes(k));
    console.log(`  greek-exposure/expiry fields (${ticker}): ${keys.length} keys, ` +
      `${present.length} of ${legs.length} expected legs present`);
    if (absent.length) console.log(`    ABSENT legs: ${absent.join(", ")}`);
    const unread = keys.filter((k) => !legs.includes(k) && k !== "expiry" && k !== "date" && k !== "dte");
    if (unread.length) console.log(`    unread keys: ${unread.slice(0, 12).join(", ")}`);

    const sign = (v) => (v === null || v === undefined || v === "" ? "-" : (Number(v) < 0 ? "neg" : "pos"));
    console.log(`    signs: gex ${sign(first.call_gex)}/${sign(first.put_gex)} ` +
      `charm ${sign(first.call_charm)}/${sign(first.put_charm)} ` +
      `vanna ${sign(first.call_vanna)}/${sign(first.put_vanna)} ` +
      `delta ${sign(first.call_delta)}/${sign(first.put_delta)} (call/put)`);
  }

  const kept = sessionCandles(ohlc, sessionDate);

  const missing = [];
  if (!greekFlow.length) missing.push("greek-flow");
  if (!strikes.length) missing.push("spot-exposures/strike");
  if (!kept.length) missing.push(ohlc.length ? `ohlc/1d on or before ${sessionDate}` : "ohlc/1d");
  if (missing.length) throw new Error(`no data from ${missing.join(", ")}`);

  const past = candleCut(ohlc, sessionDate);
  return {
    raw: { greekFlow, ticks, strikes, expiries, ohlc: yearOfCandles(kept, sessionDate), ohlc2y: kept },
    pastSession: past.past,
    pastLatest: past.latest,
  };
}

export function medianDollarVolume(candles, { window = 60 } = {}) {

  const values = candlesAscending(candles).slice(-window)
    .map((c) => num(c.close) * num(c.volume))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (!values.length) return 0;
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export function candlesAscending(candles) {
  const rows = (candles || []).map((c) => ({
    c,
    t: Date.parse(c.start_time || c.end_time || c.date || ""),
    day: String((c && (c.start_time || c.end_time || c.date)) || "").slice(0, 10),
  }));

  if (!rows.some((r) => Number.isFinite(r.t))) return candles || [];

  const bySession = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r.t)) continue;
    const key = r.day.length === 10 ? r.day : String(r.t);
    const held = bySession.get(key);
    if (!held || num(r.c.volume, -1) >= num(held.c.volume, -1)) bySession.set(key, r);
  }
  return [...bySession.values()]
    .sort((a, b) => a.t - b.t)
    .map((r) => r.c);
}

export function atr14(candles) {
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

export const CANDLE_BREAK_LOG = 0.4;

export const CANDLE_BREAK_VOLUME = 4;

function medianVolume(rows) {
  const xs = rows.map((c) => num(c.volume)).filter((v) => v > 0).sort((a, b) => a - b);
  return xs.length ? xs[xs.length >> 1] : null;
}

export function repairCandles(candles) {
  const rows = candlesAscending(candles);
  const breaks = [];
  let cut = 0;
  let prev = null;
  for (let i = 0; i < rows.length; i++) {
    const b = num(rows[i].close);
    if (!(b > 0)) continue;
    if (prev !== null && Math.abs(Math.log(b / prev)) > CANDLE_BREAK_LOG) {
      const ratio = b / prev;
      const before = medianVolume(rows.slice(Math.max(0, i - 10), i));
      const after = medianVolume(rows.slice(i, i + 10));
      const volumeRatio = before !== null && after !== null ? after / before : null;
      const scaled = volumeRatio !== null && Math.abs(Math.log(volumeRatio * ratio)) <= Math.log(2);
      const regime = volumeRatio !== null && (volumeRatio >= CANDLE_BREAK_VOLUME || volumeRatio <= 1 / CANDLE_BREAK_VOLUME);
      if (volumeRatio === null || scaled || regime) {
        breaks.push({
          date: candleDate(rows[i]), ratio: Number(ratio.toPrecision(4)), before: i,
          volumeRatio: volumeRatio === null ? null : Number(volumeRatio.toPrecision(3)),
          shape: scaled ? "split" : regime ? "regime" : "unverified",
        });
        cut = i;
      }
    }
    prev = b;
  }
  return { candles: cut ? rows.slice(cut) : rows, breaks, full: rows };
}

export function sessionReference(candles, sessionDate, readSpot) {
  const asc = candlesAscending(candles);
  const last = asc.length ? asc[asc.length - 1] : null;
  const onSession = !!last && ARCHIVE_DATE_RE.test(String(sessionDate || "")) &&
    candleDate(last) === sessionDate && num(last.close) > 0;
  if (onSession) {
    const prior = asc.length > 1 ? num(asc[asc.length - 2].close) : 0;
    return { spot: num(last.close), prevClose: prior > 0 ? prior : null, basis: "session-close" };
  }
  const read = num(readSpot);
  return { spot: read > 0 ? read : 0, prevClose: null, basis: read > 0 ? "read" : null };
}

export function sessionRow(row, features) {
  const f = features || {};
  if (!row || f.spotBasis !== "session-close" || !(num(f.spot) > 0)) return row;
  return {
    ...row,
    close: f.spot,
    prev_close: num(f.prevClose) > 0 ? f.prevClose : null,
  };
}

export function readPxOf(e, readAt) {
  const px = num(e && e.row && e.row.close);
  const basis = (e && e.features && e.features.spotBasis) || null;
  return {
    px: px > 0 ? px : null,
    readAt: readAt || null,
    source: "screener",
    spotBasis: basis,
    note: basis === "session-close"
      ? "The screener's last price when this run read it. Every level, distance and change " +
        "on this card is measured from the session's daily close instead, so the two differ " +
        "by whatever traded after that close."
      : "The screener's last price when this run read it. The vendor returned no daily bar " +
        "for this session, so this read price is also the reference every level on this " +
        "card is measured from.",
  };
}

export function computeFeatures({ ticker, spot: readSpot, greekFlow, ticks, strikes, expiries, ohlc: rawOhlc, sessionDate, tilt }) {
  const { candles: ohlc, breaks, full } = repairCandles(sessionCandles(rawOhlc, sessionDate));
  const garchSeries = breaks.length ? {
    closes: full.map((c) => num(c.close)), dates: full.map(candleDate), mask: breaks.map((b) => b.date),
  } : null;
  const reference = sessionReference(ohlc, sessionDate, readSpot);
  const spot = reference.spot;
  const purity = flowPurity(greekFlow);
  const quality = positioningQuality(greekFlow);
  const gamma = aggressorGamma(strikes, { spot });
  const atr = atr14(ohlc);
  const displacement = bookDisplacement(strikes, atr);
  const path = pathSignature(ticks);
  const calendar = gammaDecayCalendar(expiries, { asOf: sessionDate });
  const book = openInterestGammaBook(expiries, { asOf: sessionDate });
  const regimeFrom = book.net !== null ? "book" : gamma.netGamma !== null ? "flow" : null;
  const regimeNet = book.net !== null ? book.net : gamma.netGamma;

  const dollarVolume = medianDollarVolume(ohlc);

  const closes = candlesAscending(ohlc).map((c) => num(c.close));

  const rv30 = realizedVol(closes, { window: 21 });
  const iv30 = tilt && Number.isFinite(tilt.iv30) ? tilt.iv30 : null;

  const flipDist = gamma.flip && spot > 0 ? (gamma.flip - spot) / spot : null;

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
    spotBasis: reference.basis,
    prevClose: reference.prevClose,
    readPx: num(readSpot) > 0 ? num(readSpot) : null,
    atr,
    dollarVolume,
    sessionDate: sessionDate || null,

    purity: purity.purity,
    dirDelta: purity.dirDelta,
    dirShare: purity.dirShare,
    otmShare: quality.otmShare,
    vegaTilt: quality.vegaTilt,
    hasView: quality.hasDirectionalView,

    netGamma: gamma.netGamma,
    gammaGross: gamma.gross,
    gammaPeak: gamma.peak,
    gammaFlip: gamma.flip,
    flipSide: gamma.flipSide,
    flipCount: gamma.crossings.length,

    flipSeparation: gamma.flipSeparation,
    spotGammaShare: gamma.spotGammaShare,
    bandMin: gamma.bandMin,
    bandMax: gamma.bandMax,
    flipDist,
    flipDistAtr: gamma.flip && atr > 0 ? (gamma.flip - spot) / atr : null,

    gRegime: regimeNet === null ? null : regimeNet >= 0 ? "long" : "short",
    gRegimeFrom: regimeFrom,
    gammaBookRaw: book.net,
    gammaBookGrossRaw: book.gross,
    gammaBookShare: book.share,
    gammaBookExpiries: book.expiries,
    displacement: displacement.displacement,
    displacementWeight: displacement.weight,

    persistence: path.persistence,
    concentration: path.concentration,
    centroid: path.centroid,
    pathNet: path.net,
    pathBars: path.bars,

    gammaHalfLife: calendar.halfLifeExpiry,
    gammaHalfLifeDays: calendar.halfLifeDays,
    gammaMeanLifeDays: calendar.meanLifeDays,
    gammaFrontLoad: calendar.frontLoad,

    iv30,
    rv30,

    vrp: iv30 !== null && rv30 !== null ? iv30 - rv30 : null,
    ivMomentum: tilt && tilt.ivMomentum !== null ? tilt.ivMomentum : null,
    ivRank: tilt && Number.isFinite(tilt.ivRank) ? tilt.ivRank : null,

    atmVol: tilt && Number.isFinite(tilt.atmVol) ? tilt.atmVol : null,
    ivStrip: tilt ? [
      { h: "−1m", v: Number.isFinite(tilt.iv30d1m) ? tilt.iv30d1m : null },
      { h: "−1w", v: Number.isFinite(tilt.iv30) && Number.isFinite(tilt.ivMomentum)
        ? Number((tilt.iv30 - tilt.ivMomentum).toFixed(4)) : null },
      { h: "−1d", v: Number.isFinite(tilt.iv30d1d) ? tilt.iv30d1d : null },
      { h: "now", v: Number.isFinite(tilt.iv30) ? tilt.iv30 : null },
    ] : null,
    impliedMovePerc: tilt && Number.isFinite(tilt.impliedMovePerc) ? tilt.impliedMovePerc : null,

    closes: closes.slice(-42),

    closeDates: candlesAscending(ohlc).slice(-42).map(candleDate),

    candles: candlesAscending(ohlc).slice(-252).map((c) => [
      candleDate(c), num(c.open, null), num(c.high, null), num(c.low, null),
      num(c.close, null), num(c.volume, null),
    ]),

    garch: garchSeries
      ? fitGarch(garchSeries.closes, garchSeries.dates, { mask: garchSeries.mask })
      : fitGarch(closes, candlesAscending(ohlc).map(candleDate)),
    ...(garchSeries ? { garchSeries } : {}),
    priceBreaks: breaks,

    r5: ret(closes, 5),
    r21: ret(closes, 21),
    r42: ret(closes, 42),
    week52Pos: week52Position(closes),
    rangeSessions: Math.min(252, closes.filter((c) => Number.isFinite(c) && c > 0).length),

    coverage: usable.filter(Boolean).length / usable.length,
    sources: {
      greekFlow: greekFlow.length,
      ticks: path.bars,
      strikes: gamma.ladder.length,
      expiries: calendar.schedule.length,
      candles: (rawOhlc || []).length,
      candlesKept: ohlc.length,
    },
  };
}

export function measureVariationProbes(enriched, sessionDate) {
  const list = (enriched || []).filter((e) => e && e.raw);
  const names = list.map((e) => ({
    rows: e.raw.expiries || [],
    iv30: e.tilt && Number.isFinite(e.tilt.iv30) ? e.tilt.iv30 : null,
  }));
  const probe = conventionProbe(names, { asOf: sessionDate });
  const kc = estimateKc(names, { asOf: sessionDate });
  const unit = unitFamily(list.map((e) => {
    let oi = 0, gex = 0;
    for (const r of e.raw.strikes || []) {
      const v = num(r && r.call_gamma_oi, NaN);
      if (Number.isFinite(v)) oi += v;
    }
    for (const r of e.raw.expiries || []) {
      const v = num(callGammaLeg(r), NaN);
      if (Number.isFinite(v)) gex += v;
    }
    return { spot: e.features ? e.features.spot : null, callGammaOi: oi, callGex: gex };
  }));
  const strikeSign = strikeBookPutSign(list.map((e) => e.raw.strikes || []));
  const next = nextSessionAfter(sessionDate) ||
    { date: null, h: 1, rule: "one calendar day; the run carries no session date" };
  const pctOf = (v) => (v === null || v === undefined ? "n/a" : (v * 100).toFixed(1) + "%");
  const lines = [
    `  variation: put convention call ${probe.call}, put ${probe.put} — |charm|-weighted opposite-sign share ` +
      `${pctOf(probe.oppositeShare.call)} call / ${pctOf(probe.oppositeShare.put)} put over ` +
      `${probe.rows.call}/${probe.rows.put} expiry rows at ${VARIATION_LINES.PROBE_DTE_MAX} days or less ` +
      `(counted by row: ${pctOf(probe.countShare.put)} put)`,
    `  variation: charm scale K_c ${kc.value === null ? "n/a" : kc.value} over ${kc.n} expiry reading(s)` +
      (kc.iqrRatio === null ? "" : `, IQR ${(kc.iqrRatio * 100).toFixed(0)}% of the median`) +
      ` — ${kc.status}${kc.reason ? ": " + kc.reason : ""}`,
    `  variation: unit family ${unit.family} (${unit.share} share, ${unit.pct} dollars-per-1% of ` +
      `${unit.n} names priced at ${VARIATION_LINES.UNIT_MIN_SPOT} or more); used: ${unit.used}`,
    `  variation: strike book ${strikeSign.reading} (${strikeSign.rows} rows)`,
    `  variation: next session ${next.date || "unknown"}, ${next.h} calendar day(s) ahead`,
  ];
  return {
    probe, kc, unit, strikeSign, next,
    vannaScale: { status: "unmeasured", ratio: null, n: 0,
      reason: "the chain leg has not run yet" },
    lines,
  };
}

export function boardVariationMeta(run) {
  if (!run) return null;
  return {
    fields: "variation on each row: gammaPerSigmaPctAdv, charmPctAdv and vannaPerPointPctAdv are " +
      "fractions of a typical day's dollar volume, each signed as the CHANGE IN DEALER DELTA (per " +
      "one-sigma rise, per session, per vol point), so dealers re-hedge the other way: a negative " +
      "figure means dealers buy stock; driftInSd is the session's charm drift over the standard " +
      "deviation of the random part, signed the same way, and sdBasis names what that deviation " +
      "holds: \"gamma\" is the spot channel alone, which is every board row, since a row carries no " +
      "implied-volatility history to size the vol channel or its co-movement with spot; a deep " +
      "card's panel, whose sdBasis is \"gamma+vanna\", can therefore read a different drift for the " +
      "same name; a null carries a code in why, spelled out in codes",
    codes: VARIATION_CODES,
    kc: { value: run.kc.value, n: run.kc.n, status: run.kc.status },
    unit: { family: run.unit.family, used: run.unit.used },
    probe: { call: run.probe.call, put: run.probe.put },
    vannaScale: { status: run.vannaScale.status, ratio: run.vannaScale.ratio, n: run.vannaScale.n,
      family: run.vannaScale.family || null, used: run.vannaScale.used || null },
    next: { date: run.next.date, h: run.next.h },
  };
}

export function featuresVariationInput(e, sessionDate) {
  const f = (e && e.features) || {};
  return {
    ticker: f.ticker || null,
    sessionDate: sessionDate || f.sessionDate || null,
    spot: f.spot,
    iv30: f.iv30,
    gammaFlow: f.netGamma,
    gammaBookRaw: f.gammaBookRaw,
    candles: f.candles || null,
    closes: f.closes || null,
    closeDates: f.closeDates || null,
    garch: f.garch || null,
    ivRankRows: null,
    expiries: (e && e.raw && e.raw.expiries) || null,
  };
}

export function variationOptions(run) {
  if (!run) return null;
  return { kc: run.kc, unit: run.unit, probe: run.probe, next: run.next, vannaScale: run.vannaScale };
}

const SIGNED = ["F", "P", "D"];

export const DEAD_BAND = 1;

export const BOARD_SCHEMA_VERSION = 2;

export function scoreBoard(features, tilts, sectors, caps) {
  const n = features.length;
  if (!n) return [];

  const raw = (fn) => features.map((f, i) => {
    const v = fn(f, tilts[i], i);
    return v === null || v === undefined || !Number.isFinite(v) ? NaN : v;
  });
  const z = (fn) => robustZ(winsorize(raw(fn), 0.02));

  const fDelta = z((f) => f.dirShare);
  const fTilt = z((f, t) => t.premiumTilt);
  const fNet = z((f, t) => t.netTilt);
  const fOi = z((f, t) => t.oiTilt);
  const fVol = z((f, t) => t.volTilt);

  const pDisp = z((f) => (f.displacementWeight > 0 ? f.displacement : null));

  const dPath = z((f) =>
    (f.pathBars > 0 ? Math.sign(f.pathNet) * f.persistence * (1 - f.concentration) : null));

  const familyCols = {
    F: [fDelta, fTilt, fNet, fOi, fVol],
    P: [],
    D: [dPath],
  };

  const familyScores = {};
  for (const [key, cols] of Object.entries(familyCols)) {
    const live = cols.filter(isLiveColumn);
    familyScores[key] = live.length
      ? features.map((_, i) => live.reduce((a, c) => a + c[i], 0) / live.length)
      : null;
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

  const gateAxes = [
    raw((f) => f.purity),
    raw((f) => (f.otmShare === null ? null : -f.otmShare)),
    raw((f) => (f.vegaTilt === null ? null : -f.vegaTilt)),
    raw((f) => (f.gammaFrontLoad === null ? null : -f.gammaFrontLoad)),

    raw((f) => (f.gammaBookShare === null || f.gammaBookShare === undefined ? null : -f.gammaBookShare)),
  ];
  const gate = qualityGate(gateAxes);

  const composite = blended.map((b, i) => b * gate[i]);

  const logCap = caps.map((c) => (c > 0 ? Math.log(c) : 0));
  const residual = neutralize(composite, { numeric: [logCap], groups: sectors });

  const scoreVariance = scoreVarianceShares(
    { fDelta, fTilt, fNet, fOi, fVol, pDisp, dPath },
    Object.fromEntries(liveKeys.map((k) => [k, weights[k]])),
    gate, residual,
    { families: { fDelta: "F", fTilt: "F", fNet: "F", fOi: "F", fVol: "F", pDisp: "P", dPath: "D" } });
  if (scoreVariance) {
    scoreVariance.horizonOnly = {
      pDisp: "displacement is sign-agnostic (buying and selling at the same strikes move it alike), " +
        "so it sits on the horizon axis with no weight until it is signed by initiator and its " +
        "per-session IC is measured",
    };
  }

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
      agree: conv.agree,
      breadth: conv.breadth,

      convCoverage: conv.coverage,
      convPersistence: conv.persistence,
      dispersion,
      weights,
      scoreVariance,
    };
  });
}

export function partitionSides(scored, { deadBand = DEAD_BAND } = {}) {

  const sorted = scored.slice().sort((a, b) => b.residual - a.residual);

  const neutralRows = sorted.filter((r) => Math.abs(r.score) < deadBand);
  return {
    long: sorted.filter((r) => r.score >= deadBand),
    short: sorted.filter((r) => r.score <= -deadBand).reverse(),
    neutralRows,
    neutral: neutralRows.length,
    deadBand,
  };
}

export function collapseShareClasses(records, { minCorr = 0.97 } = {}) {
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
      const r = returnCorrelation(repairCandles(keeper.raw.ohlc).candles, repairCandles(other.raw.ohlc).candles);
      if (Number.isFinite(r) && r >= minCorr) {
        remove.add(other.features.ticker);
        dropped.push({ kept: keeper.features.ticker, dropped: other.features.ticker, corr: r });
      }
    }
  }
  return { kept: records.filter((e) => !remove.has(e.features.ticker)), dropped };
}

export function returnCorrelation(a, b) {
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

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function packSpark(closes, { window = 42 } = {}) {
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

function week52Position(closes) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0).slice(-252);
  if (xs.length < 20) return null;
  let lo = Infinity, hi = -Infinity;
  for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi > lo ? (xs[xs.length - 1] - lo) / (hi - lo) : 0.5;
}

export function ret(closes, n) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0);
  if (xs.length < n + 1) return null;
  const a = xs[xs.length - 1 - n];
  return a > 0 ? xs[xs.length - 1] / a - 1 : null;
}

export const candleDate = (c) => {
  const d = String((c && (c.start_time || c.end_time || c.date)) || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

export function barsInHand(entry) {
  const list = entry && entry.features && Array.isArray(entry.features.candles) ? entry.features.candles : null;
  if (!list) return null;
  const bars = [];
  for (const c of list) if (Array.isArray(c) && c[0]) bars.push({ d: String(c[0]), h: num(c[2], null), l: num(c[3], null), c: num(c[4], null) });
  return { bars, breaks: (entry.features.priceBreaks || []).map((b) => b && b.date).filter(Boolean) };
}

export function sessionCandles(candles, sessionDate) {
  const list = Array.isArray(candles) ? candles : [];
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return list;
  return list.filter((c) => {
    const d = candleDate(c);
    return d !== null && d <= sessionDate;
  });
}

export function candleCut(candles, sessionDate) {
  const list = Array.isArray(candles) ? candles : [];
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return { past: 0, latest: null };
  const after = list.map(candleDate).filter((d) => d !== null && d > sessionDate).sort();
  return { past: after.length, latest: after.length ? after[after.length - 1] : null };
}

export function sessionRows(raw, dayOf, sessionDate, { through = false } = {}) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return { raw, cut: 0 };
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.data) ? raw.data : null;
  if (!list) return { raw, cut: 0 };
  const kept = list.filter((r) => {
    const d = dayOf(r);
    if (d === null) return true;
    return through ? d <= sessionDate : d === sessionDate;
  });
  const cut = list.length - kept.length;
  if (!cut) return { raw, cut: 0 };
  return { raw: Array.isArray(raw) ? kept : { ...raw, data: kept }, cut };
}

export function selectExtremes(ranked, n) {
  const picked = new Map();
  for (const p of [...ranked.slice(0, n), ...ranked.slice(-n)]) {
    if (!picked.has(p.row.ticker)) picked.set(p.row.ticker, p);
  }
  return [...picked.values()];
}

const hz = (v) => (v === null ? null : Number(v.toFixed(4)));

export function boardRow(r, s, rank, memory = null, origin = null) {
  const close = num(s.close);
  const prev = num(s.prev_close);

  const edte = daysToEarnings(s, origin);
  return {
    t: r.ticker,
    r: rank,
    s: r.score,
    cnv: r.conviction,

    agr: r.agree === null || r.agree === undefined ? null : r.agree,
    bth: r.breadth === null || r.breadth === undefined ? null : r.breadth,
    px: close || r.spot,
    chg: prev > 0 ? (close - prev) / prev : null,
    purity: r.purity === null ? null : Number(r.purity.toFixed(3)),
    gRegime: r.gRegime,
    gFlipDist: r.flipDist === null ? null : Number(r.flipDist.toFixed(4)),

    sector: s.sector || null,

    nm: typeof s.full_name === "string" && s.full_name.trim() ? s.full_name.trim() : null,
    netPrem: netPremiumOf(s),
    fam: r.fam,

    spark: packSpark(r.closes),

    pr: [r.r5, r.r21, r.r42].map((x) => (x === null ? null : Math.round(x * 10000))),
    w52: r.week52Pos === null ? null : Number(r.week52Pos.toFixed(3)),
    vrp: r.vrp === null ? null : Number(r.vrp.toFixed(4)),
    ivr: r.ivRank === null ? null : Number(r.ivRank.toFixed(3)),

    im: r.impliedMovePerc === null ? null : Number(r.impliedMovePerc.toFixed(4)),
    hm: hz(horizonMove(r.iv30)),
    hr: hz(horizonMove(r.rv30)),

    nw: memory ? memory.nw : null,
    hy: memory ? memory.hy : null,
    r0: memory ? memory.r0 : null,

    dr: memory && memory.r0 !== null ? memory.r0 - rank : null,

    ed: s.next_earnings_date || null,
    edte,
  };
}

export function ideasPayload(ideaByTicker, { sessionDate, generatedAt, built = 0 }) {
  const rows = [...ideaByTicker.keys()].sort().map((t) => ({ t, ...ideaByTicker.get(t) }));
  return { v: 1, status: rows.length ? "ok" : "quiet", sessionDate, generatedAt, built, n: rows.length, rows };
}

const IDEAS_REVISION_CAP = 9;
const PERMANENT_PREFIXES = Object.freeze(["ideas", "ideas-out"]);

export function permanentArchiveKey(prefix, sessionDate, revision = 0) {
  if (!PERMANENT_PREFIXES.includes(prefix) || !ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return null;
  return revision > 0 ? `${prefix}:${sessionDate}:r${revision}` : `${prefix}:${sessionDate}`;
}

export function ideasArchiveKey(sessionDate, revision = 0) {
  return permanentArchiveKey("ideas", sessionDate, revision);
}

export async function archivePermanent(prefix, payload, sessionDate, publishFn) {
  if (!permanentArchiveKey(prefix, sessionDate)) {
    return { state: "skipped", key: null, line: `  ${prefix} archive: session date ${JSON.stringify(sessionDate)} is not an archive date — nothing recorded` };
  }
  for (let revision = 0; revision <= IDEAS_REVISION_CAP; revision++) {
    const key = permanentArchiveKey(prefix, sessionDate, revision);
    try {
      await publishFn(key, payload);
      return { state: revision ? "revision" : "written", key, revision,
        line: revision
          ? `  ${prefix} archive: ${prefix}:${sessionDate} already holds a different payload, so this run's ${prefix} are recorded as ${key}`
          : `  ${prefix} archive: ${key} recorded (permanent)` };
    } catch (error) {
      const refused = error && error.status === 409 && /archive_permanent/.test(String(error.message));
      if (!refused) {
        return { state: "lost", key, revision, line: `  ${prefix} archive ${key}: NOT RECORDED — ${error && error.message ? error.message : error}` };
      }
    }
  }
  return { state: "capped", key: permanentArchiveKey(prefix, sessionDate, IDEAS_REVISION_CAP), revision: IDEAS_REVISION_CAP,
    line: `  ${prefix} archive: ${prefix}:${sessionDate} and its ${IDEAS_REVISION_CAP} revisions all hold other payloads — this run's ${prefix} are not recorded` };
}

export function archiveIdeas(payload, sessionDate, publishFn) {
  return archivePermanent("ideas", payload, sessionDate, publishFn);
}

export function congressRows(ticker, { byTicker = null, read = null, tapeRows = 0, namesRead = null } = {}) {
  const rows = byTicker ? byTicker.get(ticker) : undefined;
  if (rows) return rows;
  return (read === "ok" && tapeRows > 0) || Boolean(namesRead && namesRead.has(ticker)) ? [] : null;
}

export function toRows(pool, screenerByTicker, previousRows, origin) {
  const prior = Array.isArray(previousRows) ? previousRows : [];
  const memo = applyHysteresis(
    pool.map((r) => r.ticker), prior.map((r) => r.t),
    { entryRank: UNIVERSE.boardSize, exitRank: Math.round(UNIVERSE.boardSize * 1.4) },
  );
  const byTicker = new Map(pool.map((r) => [r.ticker, r]));

  const rankBefore = new Map();
  for (const r of prior) {
    const v = num(r.r, null);
    if (v !== null) rankBefore.set(r.t, v);
  }
  const entered = new Set(memo.entered);
  const held = new Set(memo.held);

  return memo.ids.map((ticker, i) => boardRow(
    byTicker.get(ticker),
    screenerByTicker.get(ticker) || {},
    i + 1,

    memo.cold ? null : {
      nw: entered.has(ticker),
      hy: held.has(ticker),
      r0: rankBefore.has(ticker) ? rankBefore.get(ticker) : null,
    },
    origin,
  ));
}

export const WATCH_ROWS = 80;

const fixed = (v, digits) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null);

export function toWatchRows(pool, screenerByTicker, tiltByTicker, { cap = WATCH_ROWS } = {}) {

  const ranked = (pool || []).slice().sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
  const tilts = tiltByTicker || new Map();
  return ranked.slice(0, cap).map((r, i) => {
    const t = tilts.get(r.ticker) || {};
    return {
      ...boardRow(r, screenerByTicker.get(r.ticker) || {}, i + 1),

      resid: fixed(r.residual, 4),
      surpriseTilt: fixed(t.surpriseTilt, 3),
      relVolume: fixed(t.relVolume, 2),
      putCallRatio: fixed(t.putCallRatio, 3),
    };
  });
}

export function unusualContractId(row) {
  if (!row) return null;
  const t = row.t;
  const k = row.k;
  const expiry = row.expiry;
  const cp = row.cp;
  if (typeof t !== "string" || !t) return null;
  if (!Number.isFinite(Number(k))) return null;
  if (typeof expiry !== "string" || !expiry) return null;
  if (cp !== "C" && cp !== "P") return null;
  return `${t}|${k}|${expiry}|${cp}`;
}

export function markNewContracts(rows, priorBody, runSessionDate = null) {
  const list = Array.isArray(rows) ? rows : [];
  const priorRows = priorBody && priorBody.contracts && Array.isArray(priorBody.contracts.rows)
    ? priorBody.contracts.rows : null;
  const readAt = priorBody && typeof priorBody.readAt === "string" ? priorBody.readAt : null;
  const sessionDate = priorBody && typeof priorBody.sessionDate === "string"
    ? priorBody.sessionDate : null;

  const noComparison = (status, contracts) => {
    for (const row of list) row.nw = null;
    return { status, contracts, fresh: null, readAt, sessionDate };
  };

  if (!priorRows || !priorRows.length) {
    return noComparison(priorRows ? "quiet" : "unavailable", priorRows ? 0 : null);
  }

  const seen = new Set();
  for (const row of priorRows) {
    const id = unusualContractId(row);
    if (id) seen.add(id);
  }

  if (!seen.size) return noComparison("quiet", 0);

  const stamp = (v) => (typeof v === "string" && ARCHIVE_DATE_RE.test(v) ? v : null);
  const prior = stamp(sessionDate);
  const run = stamp(runSessionDate);
  if (prior !== null && run !== null) {
    if (prior === run) return noComparison("same-session", seen.size);

    if (prior > run) return noComparison("ahead", seen.size);
  }

  const status = prior === null || run === null ? "undated" : "ok";
  let fresh = 0;
  for (const row of list) {
    const id = unusualContractId(row);

    if (!id) { row.nw = null; continue; }
    const isNew = !seen.has(id);
    row.nw = isNew ? 1 : 0;
    if (isNew) fresh++;
  }
  return { status, contracts: seen.size, fresh, readAt, sessionDate };
}

export function priorNote(mark, runSessionDate, shown) {
  const when = mark.readAt ? `read at ${mark.readAt}` : "with no read time on it";

  const named = mark.contracts === null || mark.contracts === undefined
    ? "no countable contracts"
    : `${mark.contracts} contract${mark.contracts === 1 ? "" : "s"}`;
  switch (mark.status) {
    case "ok":
      return `The counter feed published for ${mark.sessionDate}, ${when}, named ` +
        `${named} this run can identify. ${mark.fresh} of today's ${shown} were absent from ` +
        "it and are marked as first appearances; the rest were in it and are marked as " +
        "carried over. A first appearance is a statement about this ranked list, not about " +
        "the strike: a contract can be absent from the earlier feed because it was quiet, or " +
        "because it sat below that run's per-name cap.";
    case "undated":
      return "The counter feed this run read carries no session date, or this run could not " +
        `resolve its own, so it could not be checked that the ${named} compared against came ` +
        "from an EARLIER session rather than from this run's own output. The comparison was " +
        "made anyway: discarding a real earlier session over a missing stamp would report a " +
        "cold feed on a session that had a good yesterday. Read the marks as unverified " +
        "rather than as a comparison against a named session.";
    case "same-session":
      return `The counter feed this run read is stamped ${mark.sessionDate}, the same session ` +
        "this run is publishing, so it is this run's own output rather than an earlier " +
        `session. Its ${named} were discarded and no row here claims to be a first ` +
        "appearance. Comparing a feed against itself marks every line carried over, and " +
        "publishing that would report a session in which nothing was newly crowded when what " +
        "really happened is that this pipeline ran twice against one session.";
    case "ahead":
      return `The counter feed this run read is stamped ${mark.sessionDate}, a LATER session ` +
        `than the ${runSessionDate || "unresolved session"} this run is publishing, so it ` +
        `cannot be this run's yesterday. Its ${named} were discarded and no row here claims ` +
        "to be a first appearance. A run publishing an earlier session than the feed already " +
        "live usually means a re-run against a stale tape, and that is worth understanding " +
        "before these marks are read as a comparison.";
    case "quiet":
      return "The counter feed was read and named no contract this run can identify, so there " +
        "was no list to compare against and no row here claims to be a first appearance. A " +
        "feed that named nothing is not a session in which nothing was crowded — it is a " +
        "payload with nothing in it to match on, which is a fact about that payload.";
    default:
      return "No counter feed could be read on this run — either none has ever been published " +
        "under this key, or the read did not complete — so there is no earlier session to " +
        "compare against and no row here claims to be a first appearance. The comparison " +
        "begins on the next run that finds a feed to read.";
  }
}

export const SECTOR_ETFS = [
  { sector: "Materials", etf: "XLB" },
  { sector: "Communication Services", etf: "XLC" },
  { sector: "Energy", etf: "XLE" },
  { sector: "Financials", etf: "XLF" },
  { sector: "Industrials", etf: "XLI" },
  { sector: "Information Technology", etf: "XLK" },
  { sector: "Consumer Staples", etf: "XLP" },
  { sector: "Real Estate", etf: "XLRE" },
  { sector: "Utilities", etf: "XLU" },
  { sector: "Health Care", etf: "XLV" },
  { sector: "Consumer Discretionary", etf: "XLY" },
];

export const TRIX_SPAN = 15;

export const TRIX_SERIES = 30;

export const TRIX_WARMUP = 5 * TRIX_SPAN;

export const TRIX_MIN_CANDLES = TRIX_WARMUP + TRIX_SERIES + 1;

export function ema(values, span) {
  const alpha = 2 / (span + 1);
  const out = new Array(values.length);
  let prev = values.length ? values[0] : NaN;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : prev + alpha * (values[i] - prev);
    out[i] = prev;
  }
  return out;
}

export function trixSeriesBp(closes, { span = TRIX_SPAN } = {}) {
  const e3 = ema(ema(ema(closes.map((c) => Math.log(c)), span), span), span);
  const out = [];
  for (let i = 1; i < e3.length; i++) out.push((e3[i] - e3[i - 1]) * 10000);
  return out;
}

export const TRIX_FULL_SCALE_BP = 50;

export function scaleTrix(bp) {
  if (!Number.isFinite(bp)) return null;
  return Number((50 + 50 * Math.max(-1, Math.min(1, bp / TRIX_FULL_SCALE_BP))).toFixed(1));
}

export function sectorTrix(candlesByEtf, { span = TRIX_SPAN, series = TRIX_SERIES, warmup = TRIX_WARMUP } = {}) {
  const minCandles = warmup + series + 1;
  const get = (etf) => (candlesByEtf instanceof Map
    ? candlesByEtf.get(etf)
    : (candlesByEtf || {})[etf]) || [];

  return SECTOR_ETFS.map(({ sector, etf }) => {
    const unmeasured = (reason) => ({
      sector, etf,
      trix: null, trixBp: null, clamped: null, series: null, clampedPoints: null,
      reason,
    });

    const raw = get(etf);
    if (!raw.length) return unmeasured(`no candles returned for ${etf}`);

    const closes = candlesAscending(raw).map((c) => num(c.close, NaN));
    let start = closes.length;
    while (start > 0 && Number.isFinite(closes[start - 1]) && closes[start - 1] > 0) start--;
    const clean = closes.slice(start);

    if (clean.length < minCandles) {
      return unmeasured(
        `${clean.length} usable ${etf} closes of ${closes.length} returned; ` +
        `${minCandles} are needed for a settled TRIX(${span}) plus ${series} sessions`);
    }

    const settled = trixSeriesBp(clean, { span }).slice(warmup);
    const window = settled.slice(-series);
    if (!window.every((v) => Number.isFinite(v))) {
      return unmeasured(`${etf} produced a non-finite TRIX over the published window`);
    }

    const bp = window.map((v) => Number(v.toFixed(2)));
    const last = bp[bp.length - 1];
    return {
      sector, etf,
      trix: scaleTrix(last),
      trixBp: last,
      clamped: Math.abs(last) >= TRIX_FULL_SCALE_BP,
      series: bp.map((v) => scaleTrix(v)),

      clampedPoints: bp.filter((v) => Math.abs(v) >= TRIX_FULL_SCALE_BP).length,
      reason: null,
    };
  });
}

export function vendorNum(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : num(trimmed, null);
  }
  return num(value, null);
}

export function sectorLean(rows) {
  const byTicker = new Map();
  for (const row of unwrapVendorRows(rows)) {
    const ticker = row && typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";

    if (ticker && !byTicker.has(ticker)) byTicker.set(ticker, row);
  }

  return SECTOR_ETFS.map(({ sector, etf }) => {
    const base = {
      sector, etf,

      fullName: null,
      bullishPremiumUsd: null, bearishPremiumUsd: null,
      grossPremiumUsd: null, netPremiumUsd: null, leanRatio: null,
      callPremiumUsd: null, putPremiumUsd: null,
      callVolume: null, putVolume: null,
      lastUsd: null, prevCloseUsd: null, changeRatio: null,
      stockVolume: null,
      read: "unreadable", reason: null,
    };

    const row = byTicker.get(etf);
    if (!row || typeof row !== "object") {
      return { ...base, reason: `no ${etf} row in the sector-etfs response` };
    }

    const fullName = typeof row.full_name === "string" && row.full_name.trim()
      ? row.full_name.trim() : null;

    const last = vendorNum(row.last);
    const prevClose = vendorNum(row.prev_close);
    const context = {
      fullName,
      callPremiumUsd: vendorNum(row.call_premium),
      putPremiumUsd: vendorNum(row.put_premium),
      callVolume: vendorNum(row.call_volume),
      putVolume: vendorNum(row.put_volume),
      lastUsd: last, prevCloseUsd: prevClose,

      changeRatio: last !== null && prevClose !== null && prevClose !== 0
        ? Number(((last - prevClose) / prevClose).toFixed(6)) : null,
      stockVolume: vendorNum(row.volume),
    };

    const bullish = vendorNum(row.bullish_premium);
    const bearish = vendorNum(row.bearish_premium);

    if (bullish === null && bearish === null) {
      return { ...base, ...context,
        reason: `${etf} carried neither bullish_premium nor bearish_premium` };
    }
    if (bullish === null || bearish === null) {
      return { ...base, ...context,

        bullishPremiumUsd: bullish, bearishPremiumUsd: bearish,
        reason: `${etf} carried ${bullish === null ? "bearish_premium" : "bullish_premium"} ` +
          "but not the other side, and a lean needs both terms" };
    }

    const gross = bullish + bearish;
    const net = bullish - bearish;
    return { ...base, ...context,
      bullishPremiumUsd: bullish, bearishPremiumUsd: bearish,
      grossPremiumUsd: gross,
      netPremiumUsd: net,

      leanRatio: gross === 0 ? null : Number((net / gross).toFixed(6)),
      read: gross === 0 ? "quiet" : "ok",
      reason: gross === 0
        ? `${etf} was read and both premium sums were zero — measured and empty, ` +
          "not missing"
        : null,
    };
  });
}

export const HOLDERS_RETRY_DAYS = 7;

export function holdersRefusal(prior, sessionDate, { days = HOLDERS_RETRY_DAYS } = {}) {
  const h = prior && prior.holders;
  if (!h || h.status !== "unavailable" || typeof h.reason !== "string") return null;
  const status = /HTTP (4(?!08|29)\d\d)/.exec(h.reason);
  if (!status || !ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return null;
  const since = /refused since (\d{4}-\d{2}-\d{2})/.exec(h.reason);
  const first = since ? since[1]
    : typeof prior.sessionDate === "string" && ARCHIVE_DATE_RE.test(prior.sessionDate)
      ? prior.sessionDate : null;
  if (!first) return null;
  const age = (Date.parse(sessionDate + "T00:00:00Z") - Date.parse(first + "T00:00:00Z")) / 86400000;
  if (!(age >= 0) || age >= days) return null;
  return {
    status: Number(status[1]), since: first,
    reason: `not requested this run: the vendor answered this route with HTTP ${status[1]}, ` +
      `refused since ${first}, and a refusal that is a property of the plan is not bought ` +
      `again every night — it is asked once more ${days} days after ${first}`,
  };
}

export const NEWS_ROWS = 60;

export function shapeNews(raw, { cap = NEWS_ROWS, requested = NEWS_VENDOR_LIMIT } = {}) {
  const wire = unwrapVendorRows(raw);

  let unusable = 0, undatedSeen = 0;
  const shaped = [];
  for (const row of wire) {
    const fields = newsFields(row);
    if (fields === null) { unusable++; continue; }
    if (fields.createdAtMs === null) undatedSeen++;
    shaped.push(fields);
  }

  shaped.sort((a, b) => {
    if (a.createdAtMs === null && b.createdAtMs === null) return 0;
    if (a.createdAtMs === null) return 1;
    if (b.createdAtMs === null) return -1;
    return b.createdAtMs - a.createdAtMs;
  });

  const rows = shaped.slice(0, cap);
  const dated = rows.map((r) => r.createdAtMs).filter((ms) => ms !== null);

  return {
    rows,

    requested, returned: wire.length, kept: rows.length,
    cap, capped: shaped.length > cap, shed: Math.max(0, shaped.length - cap),
    atVendorLimit: wire.length >= requested,
    unusable,

    undatedKept: rows.filter((r) => r.createdAtMs === null).length,
    undatedSeen,

    newest: dated.length ? new Date(Math.max(...dated)).toISOString() : null,
    oldest: dated.length ? new Date(Math.min(...dated)).toISOString() : null,
    ordered: true, orderedBy: "createdAt", orderedDesc: true,

    status: rows.length ? "ok" : (wire.length ? "unreadable" : "quiet"),
    reason: rows.length
      ? null
      : (wire.length
        ? `the headlines feed returned ${wire.length} row(s) and none carried a headline`
        : "the headlines feed was read and returned no rows"),
  };
}

export const MOVER_ROWS = 15;

export const onWire = (v) => v !== undefined && v !== null && v !== "";

export function netPremiumOf(row) {
  if (!row) return null;
  if (!(onWire(row.net_call_premium) || onWire(row.net_put_premium))) return null;
  return Math.round(num(row.net_call_premium) - num(row.net_put_premium));
}

export function moverRow(row, tilt) {
  const close = num(row.close);
  const prev = num(row.prev_close);
  const t = tilt || {};
  return {
    t: row.ticker,
    px: close > 0 ? close : null,

    chg: prev > 0 && close > 0 ? Number(((close - prev) / prev).toFixed(5)) : null,

    netPrem: netPremiumOf(row),
    relVolume: fixed(t.relVolume, 2),
    surpriseTilt: fixed(t.surpriseTilt, 3),

    sector: row.sector || null,
  };
}

export function buildMovers(withTilt, { cap = MOVER_ROWS } = {}) {
  const rows = (withTilt || []).map(({ row, tilt }) => moverRow(row, tilt));

  const movable = rows.filter((r) => r.chg !== null);
  const byChange = movable.slice().sort((a, b) => b.chg - a.chg);
  const risers = byChange.filter((r) => r.chg > 0).slice(0, cap);

  const fallers = byChange.filter((r) => r.chg < 0).slice(-cap).reverse();

  const priced = rows.filter((r) => r.netPrem !== null);
  const byPremium = priced.slice().sort((a, b) => b.netPrem - a.netPrem);
  const bullish = byPremium.filter((r) => r.netPrem > 0).slice(0, cap);
  const bearish = byPremium.filter((r) => r.netPrem < 0).slice(-cap).reverse();

  return {
    risers,
    fallers,
    premium: { basis: "byName", bullish, bearish },
    ranked: movable.length,
    priced: priced.length,

    unrankedChange: rows.length - movable.length,
    unrankedPremium: rows.length - priced.length,
  };
}
