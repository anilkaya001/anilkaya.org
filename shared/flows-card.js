export const CARD_SCHEMA_VERSION = 2;

import {
  horizonMove, HORIZON_SESSIONS, callGammaLeg, putGammaLeg, pathSignature,
  greekTermStructure, callVannaLeg, putVannaLeg, callCharmLeg, putCharmLeg,
  callDeltaLeg, putDeltaLeg, CONVICTION_WEIGHTS, liveExpiry,
} from "./flows-features.js";
import {
  shapeStockDarkpool, shapeStockOiChange, buildVolContext, STOCK_NOTES,
} from "./flows-stock.js";
import { variation, cardVariationInput } from "./flows-variation.js";

import { UA_MIN_VOLUME } from "./flows-unusual.js";
import { joinScoreToPrice } from "./flows-overlay.js";

import { unwrapRows } from "./flows-pulse.js";
import { easternDay } from "./flows-freshness.js";

import { parseOptionSymbol } from "./flows-premium.js";
export { HORIZON_SESSIONS };

export function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function ok(values, asOf) {
  return { status: "ok", asOf: asOf || null, ...values };
}

export function panelLead(say, n) {
  const sentence = String(say === null || say === undefined ? "" : say).trim();
  if (!sentence) return null;
  return { say: sentence, n: n && typeof n === "object" ? { ...n } : {} };
}

export function saidMagnitude(value) {
  const mag = Math.abs(value);
  return {
    shown: mag >= 1e6 ? Number((mag / 1e6).toFixed(2))
      : mag >= 1e3 ? Number((mag / 1e3).toFixed(1))
        : Number(mag.toFixed(2)),
    suffix: mag >= 1e6 ? "M" : mag >= 1e3 ? "k" : "",
    exact: mag,
  };
}

export function unavailable(reason) {
  return { status: "unavailable", reason: reason || "no data", asOf: null };
}

export function quiet(reason) {
  return { status: "quiet", reason: reason || "measured nothing", asOf: null };
}

export const POLARITY = Object.freeze({
  netCallPremium: +1,

  netPutPremium: -1,
  netPremium: +1,
  dirDelta: +1,
  pathNet: +1,
  netGamma: 0,
  flipDistPct: 0,
  purity: 0,
  otmShare: 0,
  vegaTilt: 0,
  atr: 0,
  distPct: 0,
  distAtr: 0,
  changePct: +1,

  riskReversal: -1,
  ivRank: 0,
  disclosureLagDays: 0,

  iv30: 0,
  rv30: 0,
  vrp: 0,
  ivMomentum: 0,
  impliedMovePerc: 0,

  displacement: +1,

  spotGammaShare: 0,
  gammaFrontLoad: 0,
  gammaMeanLifeDays: 0,
  week52Pos: 0,

  skew: -1,

  term: 0,
  atmIv: 0,
  net: +1,
  aggr: +1,
});

export function polarityOf(key) {
  return Object.hasOwn(POLARITY, key) ? POLARITY[key] : 0;
}

export function buildLevels({ spot, atr, gammaFlip, maxPain, callWall, putWall }) {
  const s = numOrNull(spot);
  const a = numOrNull(atr);
  if (s === null || !(s > 0)) return unavailable("no spot price");

  const measure = (kind, label, raw) => {
    const px = numOrNull(raw);
    if (px === null || !(px > 0)) return null;
    return {
      kind,
      label,
      px,
      distPct: (px - s) / s,

      distAtr: a !== null && a > 0 ? (px - s) / a : null,
    };
  };

  const cw = numOrNull(callWall), pw = numOrNull(putWall);
  const levels = [
    measure("gamma_flip", "Gamma flip", gammaFlip),
    measure("max_pain", "Max pain", maxPain),
    measure("call_wall", cw !== null && cw < s ? "Largest long-gamma strike" : "Call wall", callWall),
    measure("put_wall", pw !== null && pw > s ? "Largest short-gamma strike" : "Put wall", putWall),
  ].filter(Boolean);

  if (!levels.length) return unavailable("no levels resolved");

  levels.sort((x, y) => Math.abs(x.distPct) - Math.abs(y.distPct));

  const near = levels[0];
  const above = near.distPct >= 0;
  const pct = Math.abs(near.distPct * 100);
  const lead = panelLead(
    `Nearest: ${near.label.toLowerCase()} at ${near.px.toFixed(2)}, ` +
    `${pct.toFixed(1)}% ${above ? "above" : "below"} spot ${s.toFixed(2)}` +
    (near.distAtr === null
      ? " (ATR unavailable, so no distance in ATR)."
      : ` — ${Math.abs(near.distAtr).toFixed(2)} ATR.`),
    {
      px: Number(near.px.toFixed(2)),
      spot: Number(s.toFixed(2)),
      distPct: Number(pct.toFixed(1)),
      distAtr: near.distAtr === null ? null : Number(Math.abs(near.distAtr).toFixed(2)),
    });
  return ok({ spot: s, atr: a, levels, lead });
}

export function buildGammaProfile(strikeRows, { spot, maxBars = 60 } = {}) {

  const rows = (strikeRows || []).map((r) => {
    const legs = [r.call_gamma_ask, r.call_gamma_bid, r.put_gamma_ask, r.put_gamma_bid];
    const present = legs.some((v) => numOrNull(v) !== null);
    return {
      strike: numOrNull(r.strike ?? r.price),

      gamma: present ? legs.reduce((a, v) => a + (numOrNull(v) ?? 0), 0) : null,
    };
  }).filter((r) => r.strike !== null && r.gamma !== null);

  if (!rows.length) return unavailable("no strike ladder");
  rows.sort((a, b) => a.strike - b.strike);

  const step = Math.max(1, Math.ceil(rows.length / maxBars));
  const bars = [];
  for (let i = 0; i < rows.length; i += step) {
    const slice = rows.slice(i, i + step);
    const gamma = slice.reduce((a, r) => a + r.gamma, 0);
    const strike = slice.reduce((a, r) => a + r.strike, 0) / slice.length;
    bars.push({ k: Number(strike.toFixed(2)), g: gamma });
  }

  const callWall = rows.reduce((best, r) => (r.gamma > (best?.gamma ?? -Infinity) ? r : best), null);
  const putWall = rows.reduce((best, r) => (r.gamma < (best?.gamma ?? Infinity) ? r : best), null);

  return ok({
    bars,
    callWall: callWall && callWall.gamma > 0 ? callWall.strike : null,
    putWall: putWall && putWall.gamma < 0 ? putWall.strike : null,
    spot: numOrNull(spot),
    strikes: rows.length,
    bucketed: step > 1,

    bandMin: rows[0].strike,
    bandMax: rows[rows.length - 1].strike,
    reads: GAMMA_FLOW_READS,
  });
}

export const GAMMA_FLOW_READS =
  "Gamma dealers added today: the vendor's directionalized volume by strike (ask and bid legs " +
  "summed, each signed by its aggressor), not the standing open-interest book. The strike " +
  "ladder aggregates every expiry the vendor carries at the session, including any that " +
  "expired at its close. The open-interest book's net is on the hedging panel.";

export function buildCalendar(expiryRows, { asOf = null, maxRows = 10 } = {}) {
  const rows = (expiryRows || []).filter((r) => r && liveExpiry(r.expiry, asOf)).map((r) => {
    const c = numOrNull(callGammaLeg(r));
    const p = numOrNull(putGammaLeg(r));
    if (c === null && p === null) return null;
    return { expiry: r.expiry || null, gamma: Math.abs(c ?? 0) + Math.abs(p ?? 0) };
  }).filter((r) => r && r.expiry && r.gamma > 0)
    .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));

  if (!rows.length) return unavailable("no expiry gamma");

  const total = rows.reduce((a, r) => a + r.gamma, 0);
  const base = asOf ? Date.parse(String(asOf).slice(0, 10) + "T00:00:00Z") : NaN;
  const daysTo = (expiry) => {
    if (!Number.isFinite(base)) return null;
    const t = Date.parse(String(expiry).slice(0, 10) + "T00:00:00Z");
    return Number.isFinite(t) ? Math.round((t - base) / 86400000) : null;
  };

  let cum = 0, halfLifeExpiry = null, halfLifeDays = null;
  let lifeWeighted = 0;
  const schedule = rows.map((r) => {
    cum += r.gamma;
    const days = daysTo(r.expiry);
    if (halfLifeExpiry === null && cum / total >= 0.5) {
      halfLifeExpiry = r.expiry;
      halfLifeDays = days;
    }
    if (days !== null) lifeWeighted += days * r.gamma;
    return {
      expiry: r.expiry,
      share: Number((r.gamma / total).toFixed(4)),
      cumShare: Number((cum / total).toFixed(4)),
      days,
    };
  });

  const lead = (() => {
    if (halfLifeExpiry === null) return null;
    const when = halfLifeDays === null
      ? `by ${halfLifeExpiry} (no session date, so no horizon in days)`
      : `by ${halfLifeExpiry}, ${halfLifeDays} day${halfLifeDays === 1 ? "" : "s"} out`;
    const meanLife = total > 0 && Number.isFinite(base)
      ? Number((lifeWeighted / total).toFixed(1))
      : null;
    return panelLead(
      `Half the book's gamma expires ${when}, across ${schedule.length} ` +
      `expir${schedule.length === 1 ? "y" : "ies"}` +
      (meanLife === null ? "." : ` — mean life ${meanLife} days.`),
      {

        halfLifeExpiry,
        halfLifeDays,
        expiries: schedule.length,
        meanLifeDays: meanLife,
      });
  })();

  return ok({

    schedule: schedule.slice(0, maxRows),
    expiries: schedule.length,
    lead,
    halfLifeExpiry,
    halfLifeDays,

    frontLoad: schedule.length ? schedule[0].share : null,
    meanLifeDays: total > 0 && Number.isFinite(base)
      ? Number((lifeWeighted / total).toFixed(1))
      : null,
  }, asOf);
}

export function buildDisplacement(strikeRows, { atr, spot } = {}) {
  const a = numOrNull(atr);
  const centroid = (call, put) => {
    let wsum = 0, wx = 0;
    for (const r of strikeRows || []) {
      const k = numOrNull(r.strike);
      const cw = numOrNull(r[call]);
      const pw = numOrNull(r[put]);
      if (k === null || !(k > 0) || (cw === null && pw === null)) continue;
      const w = Math.abs(cw ?? 0) + Math.abs(pw ?? 0);
      if (!(w > 0)) continue;
      wsum += w; wx += k * w;
    }
    return wsum > 0 ? { c: wx / wsum, w: wsum } : null;
  };

  const oi = centroid("call_gamma_oi", "put_gamma_oi");
  const vol = centroid("call_gamma_vol", "put_gamma_vol");
  if (!oi || !vol) return unavailable("no open-interest or volume gamma");

  const gapPx = Number((vol.c - oi.c).toFixed(2));
  const gapAtr = a !== null && a > 0 ? Number(((vol.c - oi.c) / a).toFixed(3)) : null;

  const dir = gapPx > 0 ? "above" : gapPx < 0 ? "below" : "on top of";
  const size = gapAtr === null
    ? `${Math.abs(gapPx).toFixed(2)} in price`
    : `${Math.abs(gapAtr).toFixed(2)} ATR`;
  const lead = panelLead(
    gapPx === 0
      ? `Today's flow is building gamma exactly where the book already sits — ` +
        `both centroids at ${oi.c.toFixed(2)}.`
      : `Today's flow is building gamma ${size} ${dir} the book, at ` +
        `${vol.c.toFixed(2)} against ${oi.c.toFixed(2)}.`,
    {
      volCentroid: Number(vol.c.toFixed(2)),
      oiCentroid: Number(oi.c.toFixed(2)),
      gapPx: Math.abs(gapPx),
      gapAtr: gapAtr === null ? null : Math.abs(gapAtr),
    });

  return ok({
    lead,
    oiCentroid: Number(oi.c.toFixed(2)),
    volCentroid: Number(vol.c.toFixed(2)),
    spot: numOrNull(spot),
    gapPx,

    gapAtr,
  });
}

export const RICHNESS_LINE = 0.1;

export function buildPricedMove({
  spot, impliedMovePerc, vrp, iv30, rv30, ivRank, ivMomentum, atmVol, ivStrip, asOf,
  sessions = HORIZON_SESSIONS,
}) {
  const s = numOrNull(spot);
  const m = numOrNull(impliedMovePerc);
  const impliedH = horizonMove(numOrNull(iv30), { sessions });
  const realizedH = horizonMove(numOrNull(rv30), { sessions });

  if (s === null || !(s > 0)) return unavailable("no spot price");
  if ((m === null || !(m > 0)) && impliedH === null) return unavailable("no implied volatility");

  const quoted = m !== null && m > 0;

  const pct = (x) => Number((x * 100).toFixed(1));
  const lead = (() => {
    if (impliedH !== null) {
      const lo = Number((s * (1 - impliedH)).toFixed(2));
      const hi = Number((s * (1 + impliedH)).toFixed(2));
      return panelLead(
        `Options price a \u00b1${pct(impliedH)}% move over ${sessions} session` +
        `${sessions === 1 ? "" : "s"} \u2014 ${lo.toFixed(2)} to ${hi.toFixed(2)}` +
        (realizedH === null
          ? ", with no realized volatility to compare it against."
          : `, against ${pct(realizedH)}% realized.`),
        {
          impliedPct: pct(impliedH),
          sessions,
          low: lo,
          high: hi,
          realizedPct: realizedH === null ? null : pct(realizedH),
        });
    }
    if (!quoted) return null;
    const lo = Number((s * (1 - m)).toFixed(2));
    const hi = Number((s * (1 + m)).toFixed(2));
    return panelLead(
      `Options price a \u00b1${pct(m)}% move to the nearest end-of-week expiry ` +

      `\u2014 ${lo.toFixed(2)} to ${hi.toFixed(2)}. No interpolated implied ` +
      `volatility, so no fixed-horizon band to compare across names.`,
      { quotedPct: pct(m), low: lo, high: hi });
  })();

  return ok({
    lead,

    movePerc: quoted ? Number(m.toFixed(5)) : null,
    low: quoted ? Number((s * (1 - m)).toFixed(2)) : null,
    high: quoted ? Number((s * (1 + m)).toFixed(2)) : null,

    horizonRule: quoted ? "the nearest end-of-week expiry" : null,

    sessions,
    impliedMove: impliedH === null ? null : Number(impliedH.toFixed(5)),
    impliedLow: impliedH === null ? null : Number((s * (1 - impliedH)).toFixed(2)),
    impliedHigh: impliedH === null ? null : Number((s * (1 + impliedH)).toFixed(2)),
    realizedMove: realizedH === null ? null : Number(realizedH.toFixed(5)),
    realizedLow: realizedH === null ? null : Number((s * (1 - realizedH)).toFixed(2)),
    realizedHigh: realizedH === null ? null : Number((s * (1 + realizedH)).toFixed(2)),

    spot: s,
    vrp: numOrNull(vrp),
    iv30: numOrNull(iv30),
    rv30: numOrNull(rv30),

    ivRank: numOrNull(ivRank),
    ivMomentum: numOrNull(ivMomentum),

    atmVol: numOrNull(atmVol),

    ivStrip: Array.isArray(ivStrip)
      ? ivStrip.map((p) => ({ h: p.h, v: numOrNull(p.v) }))
      : null,

    richness: numOrNull(vrp) === null || numOrNull(rv30) === null || !(rv30 > 0) ? null
      : vrp / rv30 >= RICHNESS_LINE ? "rich" : vrp / rv30 <= -RICHNESS_LINE ? "cheap" : "fair",
  }, asOf);
}

export function buildContext(
  { closes, closeDates, r5, r21, r42, week52Pos, changePct, candles, garch, breaks, rangeSessions },
  { asOf = null } = {},
) {

  const rawCloses = Array.isArray(closes) ? closes : [];
  const rawDates = Array.isArray(closeDates) ? closeDates : [];
  const kept = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = numOrNull(rawCloses[i]);
    if (c === null || !(c > 0)) continue;
    const d = rawDates[i];
    kept.push({ c, d: typeof d === "string" && d ? d.slice(0, 10) : null });
  }
  const series = kept.map((k) => k.c);
  const dates = kept.map((k) => k.d);

  const fields = {
    r5: numOrNull(r5), r21: numOrNull(r21), r42: numOrNull(r42),
    week52Pos: numOrNull(week52Pos), changePct: numOrNull(changePct),
  };
  if (series.length < 2 && Object.values(fields).every((x) => x === null)) {
    return unavailable("no price history");
  }
  const dated = dates.filter(Boolean).length;

  const posPct = fields.week52Pos === null ? null : fields.week52Pos * 100;
  const r21Pct = fields.r21 === null ? null : fields.r21 * 100;
  const span = numOrNull(rangeSessions);
  const fullYear = span === null || span >= 252;
  const where = posPct === null ? null
    : `Sitting at ${posPct.toFixed(0)}% of its ${fullYear ? "52-week" : `${span}-session`} range`;
  const moved = r21Pct === null ? null
    : `${r21Pct >= 0 ? "up" : "down"} ${Math.abs(r21Pct).toFixed(1)}% over 21 sessions`;
  const lead = panelLead(
    where === null && moved === null ? ""
      : where === null ? `Price is ${moved}.`
      : moved === null ? `${where}.`
      : `${where}, ${moved}.`,
    {
      week52Pos: posPct === null ? null : Number(posPct.toFixed(0)),
      r21: r21Pct === null ? null : Number(Math.abs(r21Pct).toFixed(1)),
      sessions: 21,
      ...(fullYear ? { weeks: 52 } : { rangeSessions: span }),
    });

  return ok({
    ...(lead ? { lead } : {}),
    ...fields,
    closes: series.map((c) => Number(c.toFixed(4))),

    ...(dated ? { closeDates: dates } : {}),
    sessions: series.length,

    datedSessions: dated,

    dropped: rawCloses.length - series.length,
    ...candleFields(candles),

    ...(garch && typeof garch === "object" ? { garch } : {}),
    ...(span !== null && !fullYear ? { rangeSessions: span } : {}),
    ...(Array.isArray(breaks) && breaks.length ? { breaks: breaks.map((b) => ({
      date: typeof b.date === "string" ? b.date.slice(0, 10) : null,
      ratio: numOrNull(b.ratio), before: numOrNull(b.before),
      volumeRatio: numOrNull(b.volumeRatio),
      shape: typeof b.shape === "string" ? b.shape : null,
    })) } : {}),
  }, asOf);
}

export const SMA_SESSIONS = 50;
function candleFields(candles) {
  if (!Array.isArray(candles)) return {};

  const rows = [];
  for (const c of candles) {
    if (!Array.isArray(c) || c.length < 6) continue;
    const close = numOrNull(c[4]);
    if (close === null || !(close > 0)) continue;
    const d = typeof c[0] === "string" && c[0] ? c[0].slice(0, 10) : null;
    const px = (v) => { const n = numOrNull(v); return n === null || !(n > 0) ? null : Number(n.toFixed(4)); };
    const vol = numOrNull(c[5]);
    rows.push([d, px(c[1]), px(c[2]), px(c[3]), Number(close.toFixed(4)),
      vol === null || vol < 0 ? null : Math.round(vol)]);
  }
  if (rows.length < 2) return {};

  const sma = new Array(rows.length).fill(null);
  let run = 0;
  for (let i = 0; i < rows.length; i++) {
    run += rows[i][4];
    if (i >= SMA_SESSIONS) run -= rows[i - SMA_SESSIONS][4];
    if (i >= SMA_SESSIONS - 1) sma[i] = Number((run / SMA_SESSIONS).toFixed(4));
  }
  return { candles: rows, candleKeys: ["date", "open", "high", "low", "close", "volume"], sma50: sma };
}

export function buildPath(tickRows, { buckets = 78, sessionDate = null } = {}) {
  const rows = (tickRows || [])
    .map((r) => ({
      t: Date.parse(r.tape_time),
      d: numOrNull(r.net_delta) ?? 0,
      cp: numOrNull(r.net_call_premium) ?? 0,
      pp: numOrNull(r.net_put_premium) ?? 0,
    }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);

  if (rows.length < 3) return unavailable("no intraday tape");

  const first = rows[0].t;
  const span = rows[rows.length - 1].t - first;
  const width = span > 0 ? span / buckets : 1;

  const acc = new Array(buckets).fill(null);
  let cumD = 0, cumP = 0;
  for (const r of rows) {
    cumD += r.d;

    cumP += r.cp - r.pp;
    const b = span > 0 ? Math.min(buckets - 1, Math.floor((r.t - first) / width)) : 0;
    acc[b] = { d: cumD, p: cumP };
  }

  let last = { d: 0, p: 0 };
  const series = acc.map((v) => {
    if (v) last = v;
    return [Math.round(last.d), Math.round(last.p)];
  });

  const moved = rows.reduce((a, r) => a + Math.abs(r.d), 0);
  const sig = moved > 0 ? pathSignature(tickRows) : null;

  const nd = Math.round(cumD);
  const mins = rows.length;
  const pers = sig && sig.persistence !== null && sig.persistence !== undefined
    ? Number(sig.persistence) : null;
  const held = pers === null ? ""
    : ` — ${Math.round(pers * 100)}% of minutes ran with it, against 50% for a directionless tape`;

  const mag = Math.abs(nd);
  const shown = mag >= 1e6 ? Number((mag / 1e6).toFixed(2))
    : mag >= 1e3 ? Number((mag / 1e3).toFixed(1))
      : mag;
  const suffix = mag >= 1e6 ? "M" : mag >= 1e3 ? "k" : "";
  const lead = panelLead(
    nd === 0
      ? `The tape closed FLAT on net delta over ${mins} minute(s): what was bought was sold.`
      : `Net ${nd > 0 ? "buying" : "selling"} of ${shown}${suffix} delta-weighted ` +
        `contracts over ${mins} minute(s)${held}.`,
    {
      shown,
      netDelta: mag,
      minutes: mins,
      persistencePct: pers === null ? null : Math.round(pers * 100),
      directionless: 50,
    });

  return ok({
    lead,
    series,
    netDelta: Math.round(cumD),
    netDeltaUnit: "delta-weighted contracts, side-signed",
    netPremium: Math.round(cumP),
    netPremiumUnit: "US dollars, net premium, side-signed",
    minutes: rows.length,
    startedAt: new Date(first).toISOString(),

    persistence: sig ? sig.persistence : null,

    concentration: sig ? sig.concentration : null,

    centroid: sig ? sig.centroid : null,
  }, sessionDate);
}

const AMOUNT_RANGE = /\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/;

export function buildCongress(tradeRows, { asOf = null, limit = 12 } = {}) {
  const rows = (tradeRows || []).map((r) => {
    const txn = r.transaction_date ? Date.parse(r.transaction_date + "T00:00:00Z") : NaN;
    const filed = r.filed_at_date ? Date.parse(r.filed_at_date + "T00:00:00Z") : NaN;
    const lag = Number.isFinite(txn) && Number.isFinite(filed)
      ? Math.round((filed - txn) / 86400000)
      : null;
    const m = typeof r.amounts === "string" ? AMOUNT_RANGE.exec(r.amounts) : null;
    return {
      member: String(r.name || r.reporter || "").trim() || null,
      chamber: r.member_type || null,

      issuer: r.issuer || null,

      side: /sale|sell|sold/i.test(r.txn_type || "") ? "sell"
        : /purchase|buy|bought/i.test(r.txn_type || "") ? "buy"
        : null,
      txnDate: r.transaction_date || null,
      filedDate: r.filed_at_date || null,
      disclosureLagDays: lag,

      amountRange: typeof r.amounts === "string" ? r.amounts.trim() : null,
      amountLow: m ? Number(m[1].replace(/,/g, "")) : null,
      amountHigh: m ? Number(m[2].replace(/,/g, "")) : null,
      _sort: Number.isFinite(txn) ? txn : 0,
    };
  }).filter((r) => r.member);

  if (!rows.length) {

    if (tradeRows === null || tradeRows === undefined) {
      return unavailable("the disclosure tape was not read for this name in this run");
    }
    return quiet("the disclosure tape was read and named no member trading this ticker");
  }
  rows.sort((a, b) => b._sort - a._sort);
  const kept = rows.slice(0, limit).map(({ _sort, ...r }) => r);

  const lags = kept.map((r) => r.disclosureLagDays).filter((n) => n !== null);
  const buys = kept.filter((r) => r.side === "buy").length;
  const sells = kept.filter((r) => r.side === "sell").length;

  const dated = kept.filter((r) => r.disclosureLagDays !== null);
  const late = dated.filter((r) => r.disclosureLagDays > 45).length;
  const scope = rows.length === kept.length
    ? ""
    : ` — the ${kept.length} largest of them shown`;
  const lateClause = dated.length === 0
    ? ", and no filing here carries both dates, so none can be timed against " +
      "the 45-day window"
    : `, and ${late} of the ${dated.length} that can be timed ` +
      `${late === 1 ? "was" : "were"} filed after the 45-day window had lapsed`;
  const lead = panelLead(
    `Congress disclosed ${rows.length} trade${rows.length === 1 ? "" : "s"} ` +
    `in this name${scope}: ${buys} buy${buys === 1 ? "" : "s"} against ` +
    `${sells} sell${sells === 1 ? "" : "s"}${lateClause}.`,
    {
      total: rows.length,
      shown: kept.length,
      buys,
      sells,
      datable: dated.length,
      late,
      lateWindowDays: 45,
    });

  return ok({
    trades: kept,
    total: rows.length,
    buys,
    sells,
    medianLagDays: lags.length
      ? lags.slice().sort((a, b) => a - b)[lags.length >> 1]
      : null,
    lead,
  }, asOf);
}

function premiumTrackPanel(history) {
  if (!history || !Array.isArray(history.sessions)) {
    return {
      status: "unavailable",
      reason: "the score track was not assembled this run, and the net-premium history " +
        "is read out of the same archive walk — it is a leg of its own and can be " +
        "skipped without costing any other panel",
    };
  }
  if (!Array.isArray(history.scores)) {
    return {
      status: "unavailable",
      reason: "the score track was assembled but holds no session for this name — it " +
        "covers only names that appeared on a board inside its window",
    };
  }
  const series = Array.isArray(history.premium) ? history.premium : null;
  const priced = series ? series.filter((v) => typeof v === "number" && Number.isFinite(v)) : [];
  if (!series || priced.length === 0) {
    return {
      status: "quiet",
      reason: "no session in this name's window carries an archived net premium — the " +
        "figure is read from the dated score key and, before that key existed, from " +
        "the archived boards, and this name appears in neither with a premium on it",
    };
  }
  if (priced.length < 2) {
    return {
      status: "quiet",
      reason: "exactly one session in this window carries an archived net premium. One " +
        "reading is a level, not a path, and this panel is about the path",
    };
  }

  const rows = history.sessions.map((x, i) => ({
    d: x && x.d,
    source: x && x.source,
    preEpoch: !!(x && x.preEpoch),
    p: typeof series[i] === "number" && Number.isFinite(series[i]) ? series[i] : null,
  }));

  let net = 0, up = 0, down = 0, flat = 0;
  for (const r of rows) {
    if (r.p === null) continue;
    net += r.p;
    if (r.p > 0) up++; else if (r.p < 0) down++; else flat++;
  }

  return {
    status: "ok",
    unit: "dollars of net premium, calls minus puts",
    rows,
    sessions: rows.length,
    priced: priced.length,

    gaps: rows.length - priced.length,
    up, down, flat,
    net,

    peak: priced.reduce((m, v) => (Math.abs(v) > m ? Math.abs(v) : m), 0),
  };
}

function scoreOverlayPanel(history, contextPanel) {
  if (!history || !Array.isArray(history.sessions)) {
    return {
      status: "unavailable",
      reason: "the score track was not assembled this run, so there is no score history " +
        "to lay over this name's price. It is built by walking the dated board archive, " +
        "which is a leg of its own and can be skipped without costing any other panel",
    };
  }
  if (!Array.isArray(history.scores)) {
    return {
      status: "unavailable",
      reason: "the score track was assembled but holds no session for this name — it " +
        "covers only names that appeared on a board inside its window",
    };
  }
  const ctx = contextPanel && contextPanel.status === "ok" ? contextPanel : null;
  const join = joinScoreToPrice({
    closes: ctx ? ctx.closes : null,
    closeDates: ctx ? ctx.closeDates : null,
    sessions: history.sessions,
    scores: history.scores,
    deadBand: history.deadBand,
  });
  if (join.status !== "ok") return join;

  const scoredRows = join.rows.filter((r) => r.score !== null);
  if (scoredRows.length < 2) return join;
  const a = scoredRows[0], z = scoredRows[scoredRows.length - 1];
  const ds = z.score - a.score;
  const dp = z.close - a.close;
  const word = (v) => (v > 0 ? "rose" : v < 0 ? "fell" : "is unchanged");
  const points = Math.abs(ds);
  const move = ds === 0
    ? "Score is unchanged"
    : `Score ${ds > 0 ? "up" : "down"} ${points} point${points === 1 ? "" : "s"}`;
  const agreement = (ds === 0 || dp === 0)
    ? ""
    : ` — the two ${(ds > 0) === (dp > 0) ? "agree" : "disagree"}`;
  const px = (v) => Number(v.toFixed(2));
  join.lead = panelLead(
    `${move} across ${scoredRows.length} scored session` +
    `${scoredRows.length === 1 ? "" : "s"}, ${a.d} to ${z.d}, while price ` +
    `${word(dp)}` + (dp === 0 ? ` at ${px(z.close)}` : ` from ${px(a.close)} to ${px(z.close)}`) +
    `${agreement}.`,
    {
      scoredSessions: scoredRows.length,
      firstScored: a.d,
      lastScored: z.d,
      scorePoints: points,
      scoreFrom: a.score,
      scoreTo: z.score,
      priceFrom: px(a.close),
      priceTo: px(z.close),
    });
  return join;
}

function oiBasisReading(basis) {
  if (!basis || typeof basis !== "object") return null;
  const seen = numOrNull(basis.seen);
  if (seen === null) return null;
  return {
    seen,
    exceeded: numOrNull(basis.exceeded),
    exceedShare: numOrNull(basis.exceedShare),

    verdict: typeof basis.verdict === "string" ? basis.verdict : null,
    minVolume: UA_MIN_VOLUME,
  };
}

function chainPanel(chain, key) {
  if (!chain) {
    return {
      status: "unavailable",
      reason: "no option chain was fetched for this name this session — the chain leg " +
        "is the last call the pipeline spends and the first it gives up on a slow morning",
    };
  }
  const panel = chain[key] || { status: "unavailable", reason: "this panel was not built from the chain" };

  if (panel.status !== "ok") return panel;
  return {
    ...panel,

    ...(key === "topContracts" && chain.oiBasis
      ? { oiBasis: oiBasisReading(chain.oiBasis) }
      : {}),
    coverage: {
      truncated: chain.truncated === true,

      rowsReturned: numOrNull(chain.rowsReturned),
      rowsSeen: numOrNull(chain.rowsSeen),
      pricedRows: numOrNull(chain.pricedRows),
      filter: "contracts with no open interest are excluded upstream by the vendor",
    },
  };
}

const GREEK_SUBJECT = Object.freeze({
  vanna: "Vol sensitivity",
  charm: "Time decay",
  delta: "Open-interest delta",
});

function greekLead(name, built) {
  const subject = GREEK_SUBJECT[name];
  const rows = built.rows || [];
  if (!subject || !rows.length || !(built.grossAbs > 0)) return null;
  const gross = (r) => Math.abs(r.call ?? 0) + Math.abs(r.put ?? 0);
  const scope = built.shed > 0 ? "drawn ladder" : "ladder";
  if (rows.length === 1) {
    const only = rows[0];
    return panelLead(
      `${subject} sits entirely in one expiry, ${only.expiry}` +
      (only.dte === null ? " (the vendor sent no horizon in days)"
        : only.dte === 0 ? ", expiring today" : `, ${only.dte} days out`) + ".",
      { expiry: only.expiry, dte: only.dte, expiries: 1 });
  }
  let top = rows[0];
  for (const r of rows) if (gross(r) > gross(top)) top = r;
  const share = Math.round((gross(top) / built.grossAbs) * 100);

  const c = Math.abs(top.call ?? 0), pu = Math.abs(top.put ?? 0);
  const leg = c === pu ? null : c > pu ? "call" : "put";
  return panelLead(
    `${subject} concentrates at ${top.expiry}` +
    (top.dte === null ? " (the vendor sent no horizon in days)"
      : top.dte === 0 ? ", expiring today" : `, ${top.dte} days out`) +
    `: ${share}% of the ${scope}'s gross size sits on that one expiry, ` +
    (leg === null
      ? "split evenly between the call and put legs."
      : `carried mostly by the ${leg} leg.`),
    {
      expiry: top.expiry,
      dte: top.dte,
      sharePct: share,
      expiries: rows.length,
      leg,
    });
}

function greekPanel(name, expiries, callLeg, putLeg, sessionDate) {
  const built = greekTermStructure(expiries, { name, callLeg, putLeg, asOf: sessionDate });
  if (built.status === "ok") {
    const lead = greekLead(name, built);
    return lead ? { ...built, lead } : built;
  }
  return {
    status: "unavailable",
    reason: built.reason || `no ${name} exposure was readable on this response`,

    unit: built.unit,
    rows: [], legs: built.legs,
  };
}

export function buildCohort({
  ticker, sector = null, peers = null, minGroup = 3, pooled = null,
} = {}) {
  if (!ticker) {
    return unavailable(
      "this card carries no ticker, so there is no name to place inside a cohort");
  }
  if (!Array.isArray(peers)) {
    return unavailable(
      "the scored pool was not carried into the card build for this run, so the " +
      "cohort this name was measured against cannot be named. The score itself is " +
      "unaffected — this panel reports the comparison, it does not perform it");
  }

  const want = String(ticker).toUpperCase();
  const rows = [];
  for (const p of peers) {
    const t = p && p.t;
    const s = numOrNull(p && p.s);

    if (!t || s === null) continue;
    rows.push({ t: String(t).toUpperCase(), s });
  }

  if (!rows.length) {
    return quiet(
      "no name in this cohort carried a score this session, so there is nothing " +
      "to rank this one against");
  }

  rows.sort((a, b) => b.s - a.s || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  const at = rows.findIndex((r) => r.t === want);
  if (at < 0) {

    return quiet(
      "this name is not in the scored cohort that was carried in, so it has no " +
      "rank within it. The cohort held " + rows.length +
      (rows.length === 1 ? " name" : " names") + " and this was not one of them");
  }

  const mid = rows.length >> 1;
  const median = rows.length % 2
    ? rows[mid].s
    : (rows[mid - 1].s + rows[mid].s) / 2;

  const self = rows[at].s;

  let sameSide = 0, otherSide = 0, neutral = 0;
  for (const r of rows) {
    if (r.s === 0 || self === 0) { if (r.s === 0) neutral++; continue; }
    if (Math.sign(r.s) === Math.sign(self)) sameSide++; else otherSide++;
  }

  return ok({
    sector: sector === null || sector === undefined || sector === "" ? null : String(sector),

    pooled: pooled === null || pooled === undefined ? null : !!pooled,
    minGroup: numOrNull(minGroup),
    n: rows.length,

    rank: at + 1,
    score: self,
    median,
    best: rows[0].s,
    worst: rows[rows.length - 1].s,
    sameSide, otherSide, neutral,

    rows: rows.slice(0, COHORT_ROWS),
    shown: Math.min(rows.length, COHORT_ROWS),
    notes: COHORT_NOTES,
  });
}

export const COHORT_ROWS = 12;

export const COHORT_NOTES = Object.freeze({
  scores:
    "These are the published scores, after neutralisation — the same numbers " +
    "every other surface prints for these names.",
  median:
    "Neutralisation removes the cohort's linear mean, so a median near zero is " +
    "the ordinary outcome and is not a finding. A median far from zero means " +
    "the adjustment did not absorb the cohort's tilt, which happens when the " +
    "level was pooled for being small, when the cohort is small enough that " +
    "its mean is noise, or when the tilt is not linear in the terms removed. " +
    "That is a fact about the score, not a sector call.",
  pooled:
    "A sector with fewer than the pooling floor's worth of members is not left " +
    "un-neutralised. It is folded in with every other small level into one " +
    "reference bucket, so the name WAS adjusted — against a cohort that is not " +
    "its sector.",
  sides:
    "Names scoring exactly zero sit at the centre of the dead band and belong " +
    "to neither side, so they are counted apart rather than assigned to one.",
});

export const CROSS_ROWS = 3;

export const CROSS_FEEDS = Object.freeze(["oiChange", "darkpool"]);

const CROSS_LABEL = Object.freeze({
  oiChange: "the market-wide open-interest change feed",
  darkpool: "the market-wide off-exchange print feed",
});

export function measureOrder(values) {
  const nums = [];
  for (const v of values) {
    const n = numOrNull(v);
    if (n === null) return null;
    nums.push(n);
  }
  if (nums.length < 2) return null;
  let down = true, up = true, moved = false;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] > nums[i - 1]) down = false;
    if (nums[i] < nums[i - 1]) up = false;
    if (nums[i] !== nums[i - 1]) moved = true;
  }
  if (!moved) return null;
  return down ? "descending" : up ? "ascending" : null;
}

export function measureOiBasis(rows) {
  let ratio = 0, plain = 0, checked = 0;
  for (const r of rows) {
    const change = numOrNull(r && r.oi_change);
    const curr = numOrNull(r && r.curr_oi);
    const last = numOrNull(r && r.last_oi);
    if (change === null || curr === null || last === null) continue;
    const diff = curr - last;
    checked++;
    if (Math.abs(change - diff) <= Math.max(1, Math.abs(diff) * 0.02)) plain++;
    if (last !== 0 && Math.abs(change - diff / last) <= Math.max(1e-6, Math.abs(diff / last) * 0.02)) ratio++;
  }
  if (!checked) return { basis: null, checked: 0, agreed: 0 };

  if (plain > checked / 2 && plain > ratio) return { basis: "contracts", checked, agreed: plain };
  if (ratio > checked / 2 && ratio > plain) return { basis: "ratio", checked, agreed: ratio };
  return { basis: null, checked, agreed: Math.max(plain, ratio) };
}

const isoDay = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(typeof v === "string" ? v : "");
  return m ? m[1] : null;
};

function feedSession(days) {
  const seen = new Set();
  for (const d of days) if (d) seen.add(d);
  if (!seen.size) return { day: null, days: 0 };
  const sorted = [...seen].sort();
  return { day: sorted[sorted.length - 1], days: sorted.length };
}

const crossDark = (feed, reason) => ({
  status: "unavailable", feed, label: CROSS_LABEL[feed], reason,
  entries: null, coverage: null,
});

export function indexCrossFeed(feed, raw, { limit = null, tickers = [], sessionDate = null } = {}) {
  if (!CROSS_FEEDS.includes(feed)) {
    return crossDark(feed, "no such market-wide feed is indexed by this build");
  }
  if (raw === null || raw === undefined) {
    return crossDark(feed,
      CROSS_LABEL[feed] + " was not carried into the card build this run, so this name " +
      "could not be placed against the market. Nothing here is a reading about the name");
  }
  if (typeof raw === "object" && !Array.isArray(raw) && raw.__failed) {
    return crossDark(feed,
      CROSS_LABEL[feed] + " did not come back this run (" + String(raw.__failed) + "), so " +
      "there is no cross-section to place this name inside");
  }

  const rows = unwrapRows(raw);
  const shaped = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (feed === "oiChange") {
      const oc = typeof r.option_symbol === "string" ? r.option_symbol : null;
      const parsed = oc ? parseOptionSymbol(oc) : null;
      const t = (typeof r.underlying_symbol === "string" && r.underlying_symbol)
        || (parsed ? parsed.ticker : null);
      const value = numOrNull(r.oi_change);
      if (!t || value === null) continue;
      shaped.push({ t: String(t).toUpperCase(), value, at: null, day: isoDay(r.curr_date), raw: r });
    } else {
      const t = typeof r.ticker === "string" && r.ticker ? r.ticker : null;
      const value = numOrNull(r.premium);
      const at = typeof r.executed_at === "string" && r.executed_at ? r.executed_at : null;

      if (!t || (value === null && at === null)) continue;

      shaped.push({ t: String(t).toUpperCase(), value, at, day: easternDay(at), raw: r });
    }
  }

  const wanted = new Set((tickers || []).map((t) => String(t || "").toUpperCase()).filter(Boolean));

  if (!shaped.length) {

    return {
      status: "quiet", feed, label: CROSS_LABEL[feed],
      reason: CROSS_LABEL[feed] + " was read this run and carried no row that could be " +
        "placed against a ticker, so no name in the board made it and none missed it",
      population: 0, requested: numOrNull(limit), rowsSeen: rows.length,
      entries: {}, coverage: { of: wanted.size, in: 0 },
      asOf: null, asOfStated: false, asOfSessions: 0, sameSession: null,
    };
  }

  const byValue = measureOrder(shaped.map((s) => s.value));
  const byTime = feed === "darkpool"
    ? measureOrder(shaped.map((s) => (s.at ? Date.parse(s.at) : null)))
    : null;

  const edgeOf = (dir, pick) =>
    pick(dir === "descending" ? shaped[shaped.length - 1] : shaped[0]);

  let ordered = null, orderedBy = null, cut = null, cutAt = null;
  if (byTime) {
    ordered = byTime;
    orderedBy = byTime === "descending" ? "execution time, newest first" : "execution time, oldest first";
    cutAt = edgeOf(byTime, (r) => r.at);
  } else if (byValue) {
    ordered = byValue;
    orderedBy = feed === "oiChange"
      ? "the vendor's own open-interest change field"
      : "the print's dollar size";
    cut = edgeOf(byValue, (r) => r.value);
  }

  const oi = feed === "oiChange" ? measureOiBasis(rows) : { basis: null, checked: 0, agreed: 0 };

  const unit = feed === "darkpool"
    ? { unit: "dollars", unitOne: "dollar", unitOf: null, kind: "money" }
    : oi.basis === "contracts"
      ? { unit: "contracts", unitOne: "contract", unitOf: null, kind: "count" }
      : oi.basis === "ratio"
        ? { unit: "%", unitOne: "%",
            unitOf: "of the previous session's open interest", kind: "ratio" }
        : { unit: null, unitOne: null, unitOf: null, kind: null };

  const entries = {};
  for (let i = 0; i < shaped.length; i++) {
    const s = shaped[i];
    const e = entries[s.t];
    if (!e) {
      entries[s.t] = { rank: i + 1, value: s.value, at: s.at, count: 1, rows: [i + 1] };
      continue;
    }
    e.count++;
    if (e.rows.length < CROSS_ROWS) e.rows.push(i + 1);
  }

  const session = feedSession(shaped.map((s) => s.day));
  let present = 0;
  for (const t of wanted) if (entries[t]) present++;

  const lim = numOrNull(limit);
  const capped = lim !== null && shaped.length >= lim;

  return {
    status: "ok", feed, label: CROSS_LABEL[feed],
    population: shaped.length,
    requested: numOrNull(limit),
    capped,
    rowsSeen: rows.length,
    names: Object.keys(entries).length,
    ordered, orderedBy, cut, cutAt,
    ...unit,
    oiBasis: feed === "oiChange" ? oi.basis : null,
    oiBasisChecked: feed === "oiChange" ? oi.checked : null,

    asOf: session.day,
    asOfStated: session.day !== null,
    asOfSessions: session.days,

    sameSession: session.day === null || !sessionDate ? null : session.day === sessionDate,
    entries,
    coverage: { of: wanted.size, in: present },
  };
}

export function indexMarketCross({
  oiChange, darkpool, limits = {}, tickers = [], sessionDate = null,
} = {}) {
  return {
    sessionDate: sessionDate || null,
    oiChange: indexCrossFeed("oiChange", oiChange,
      { limit: limits.oiChange, tickers, sessionDate }),
    darkpool: indexCrossFeed("darkpool", darkpool,
      { limit: limits.darkpool, tickers, sessionDate }),
  };
}

function crossFrame(f) {
  return {
    feed: f.feed, label: f.label,
    population: numOrNull(f.population), requested: numOrNull(f.requested),
    names: numOrNull(f.names),
    capped: f.capped === null || f.capped === undefined ? null : !!f.capped,
    ordered: f.ordered || null, orderedBy: f.orderedBy || null,
    cut: numOrNull(f.cut), cutAt: f.cutAt || null,
    unit: f.unit || null, unitOne: f.unitOne || null, unitOf: f.unitOf || null,
    kind: f.kind || null,
    asOf: f.asOf || null, asOfStated: !!f.asOfStated,
    asOfSessions: numOrNull(f.asOfSessions), sameSession:
      f.sameSession === null || f.sameSession === undefined ? null : !!f.sameSession,

  };
}

export function readCrossFeed(indexed, ticker) {
  if (!indexed || typeof indexed !== "object") {
    return { status: "unavailable", present: null,
      reason: "this market-wide feed was not indexed for this run" };
  }
  if (indexed.status === "unavailable") {
    return { status: "unavailable", present: null, feed: indexed.feed || null,
      label: indexed.label || null, reason: indexed.reason };
  }
  const want = String(ticker || "").toUpperCase();
  const frame = crossFrame(indexed);
  if (indexed.status === "quiet" || !indexed.entries) {
    return { status: "quiet", present: false, ...frame, reason: indexed.reason };
  }
  const e = want ? indexed.entries[want] : null;
  if (!e) {
    return {
      status: "quiet", present: false, ...frame,

      reason: "this name is not in " + indexed.label + " this run. The feed was read " +
        "and held " + indexed.population +
        (indexed.population === 1 ? " row" : " rows") + " covering " + indexed.names +
        (indexed.names === 1 ? " name" : " names") + ", and this was not one of them. " +
        (indexed.capped
          ? "The feed filled the " + indexed.requested +
            (indexed.requested === 1 ? " row" : " rows") + " this run asked for, so this " +
            "name was below the cut rather than outside the request. "
          : "The feed returned fewer rows than the " + indexed.requested +
            " requested, so nothing was cut off by this run's own limit: the name is " +
            "outside the vendor's selection for this list, not below a threshold we set. ") +
        "Either way it is a fact about a market-wide selection, not about this name's own " +
        "activity — the per-name feeds on this page are what measure that",
    };
  }
  return {
    status: "ok", present: true, ...frame,
    rank: numOrNull(e.rank),
    value: numOrNull(e.value),
    at: e.at || null,
    count: numOrNull(e.count),
    rows: Array.isArray(e.rows) ? e.rows.slice(0, CROSS_ROWS) : [],
    shown: Math.min(numOrNull(e.count) || 0, CROSS_ROWS),
  };
}

export function buildMarketCross(index, ticker, { asOf = null } = {}) {
  if (!index || typeof index !== "object") {
    return {
      status: "unavailable",
      reason: "neither market-wide feed was carried into the card build this run, so this " +
        "name could not be placed against the market's own cross-section",
      notes: CROSS_NOTES,
    };
  }
  const feeds = {};
  for (const feed of CROSS_FEEDS) feeds[feed] = readCrossFeed(index[feed], ticker);
  if (CROSS_FEEDS.every((f) => feeds[f].status === "unavailable")) {
    return {
      status: "unavailable",
      reason: "neither market-wide feed could be read this run: " +
        CROSS_FEEDS.map((f) => feeds[f].reason).join("; "),
      notes: CROSS_NOTES,
    };
  }

  const coverage = {};
  for (const feed of CROSS_FEEDS) {

    const f = index[feed];
    coverage[feed] = f && f.coverage ? f.coverage : null;
  }

  const rankLead = (() => {
    const placed = CROSS_FEEDS.filter((f) => feeds[f].status === "ok"
      && feeds[f].rank !== null && feeds[f].population !== null);
    const read = CROSS_FEEDS.filter((f) => feeds[f].status !== "unavailable");
    const dark = CROSS_FEEDS.filter((f) => feeds[f].status === "unavailable");
    const said = (f) => {
      const r = feeds[f];
      const when = r.sameSession === true ? ""
        : r.asOf ? ` on ${r.asOf}`
          : ", which states no session of its own";
      return `${r.rank} of ${r.population} in ${r.label}${when}`;
    };
    const pins = {};
    for (const f of CROSS_FEEDS) {
      const r = feeds[f];
      pins[f + "Rank"] = r.status === "ok" ? r.rank : null;
      pins[f + "Population"] = r.population === undefined ? null : r.population;

      pins[f + "AsOf"] = r.asOf || null;
    }
    if (placed.length === CROSS_FEEDS.length) {
      return panelLead(`Places in both market-wide lists: ${said(placed[0])}, ` +
        `and ${said(placed[1])}.`, pins);
    }
    if (placed.length === 1) {
      const other = CROSS_FEEDS.filter((f) => f !== placed[0])[0];

      return panelLead(`Places ${said(placed[0])}` +
        (dark.indexOf(other) !== -1
          ? `; ${feeds[other].label} was not read this run, so only one list was checked.`
          : `, and is not in ${feeds[other].label}.`), pins);
    }
    if (!read.length) return null;
    if (dark.length) {
      return panelLead(`Not in ${read.map((f) => feeds[f].label).join(" or ")}` +
        `; ${dark.map((f) => feeds[f].label).join(" or ")} was not read this ` +
        `run, so the other list was never checked.`, pins);
    }
    const sized = read.filter((f) => feeds[f].population !== null);
    return panelLead(sized.length
      ? `In neither market-wide list this run: ` +
        sized.map((f) => `${feeds[f].label} held ${feeds[f].population} rows`)
          .join(", ") + `, and this name is in neither.`
      : `In neither market-wide list this run, and neither feed published the ` +
        `size of the list it returned.`, pins);
  })();

  return ok({ feeds, coverage, lead: rankLead, notes: CROSS_NOTES }, asOf);
}

export const CROSS_NOTES = Object.freeze({
  what:
    "Both feeds here are market-wide reads this run already makes once for " +
    "the market pulse. Membership is the reading: a name inside one of them " +
    "is a name whose open-interest change or off-exchange print was large or " +
    "recent enough to place in a market-wide list, which a per-name request " +
    "cannot say because it has no cross-section in it.",
  absence:
    "These lists are SELECTIONS, not the whole market. A name that is not in " +
    "one did not make a market-wide list; it is not a name with no " +
    "open-interest change and no off-exchange prints. The per-name feeds on " +
    "this page are what measure that, and they are read separately for every " +
    "name on the board. The vendor states that its open-interest list carries " +
    "no index or exchange-traded-fund contracts at all, so a fund cannot " +
    "appear in it at any size and its absence there says nothing whatever " +
    "about it.",
  timing:
    "The vendor states that its market-wide open-interest feed updates once a " +
    "trading day at about 06:45 Eastern, and this pipeline runs after the close, " +
    "at 17:30 Eastern (16:30 in winter), so a run reads the update published that " +
    "morning rather than one describing the session just closed. The session each " +
    "feed describes is therefore published from the " +
    "feed's own rows, beside the session this card describes. Where a feed " +
    "states no date of its own, that is said rather than assumed, and a rank " +
    "from another session is never presented as today's.",
  rank:
    "A rank is the row's position in the feed as the vendor returned it, and " +
    "it is meaningless without the population it sits inside, which is " +
    "published beside it. Whether that order is an order at all is measured " +
    "here rather than taken from the vendor's documentation.",
  units:
    "The open-interest feed's own change field is reconciled against the two " +
    "clearing snapshots the same rows publish, because the vendor's example " +
    "carries it as a ratio and this repository's fixtures have carried it as " +
    "a contract count. Where neither reconciles, the number is published " +
    "with no unit rather than with the more plausible of two guesses.",
});

export function buildCard({
  ticker, row, features, strikes, ticks, expiries, maxPain, congress, surface,
  chain, generatedAt, sessionDate, weights,

  darkpool = null, oiDeltas = null, termStructure = null, ivRank = null,

  scoreHistory = null,

  marketCross = null,

  unfetched = null,

  variation: variationOpts = null,
}) {
  const f = features || {};
  const spot = numOrNull(row && row.close) ?? numOrNull(features && features.spot);
  const gamma = buildGammaProfile(strikes, { spot });
  const painRow = pickMaxPainRow(maxPain, { asOf: sessionDate });
  const prev = numOrNull(row && row.prev_close);
  const close = numOrNull(row && row.close);

  const contextPanel = buildContext({
    closes: f.closes,
    closeDates: f.closeDates,
    r5: f.r5, r21: f.r21, r42: f.r42,
    week52Pos: f.week52Pos,
    changePct: prev !== null && prev > 0 && close !== null ? (close - prev) / prev : null,
    candles: f.candles,
    garch: f.garch,
    breaks: f.priceBreaks,
    rangeSessions: f.rangeSessions,
  }, { asOf: sessionDate });

  const card = {
    v: CARD_SCHEMA_VERSION,
    ticker,

    depth: unfetched ? "cross-section" : "board",

    nm: (row && typeof row.nm === "string" && row.nm.trim()) ? row.nm.trim() : null,
    sector: (row && typeof row.sector === "string" && row.sector.trim())
      ? row.sector.trim() : null,
    generatedAt: generatedAt || null,

    sessionDate: sessionDate || null,
    score: numOrNull(features && features.score),
    conviction: numOrNull(features && features.conviction),
    fam: f.fam || null,

    weights: weights || null,

    conv: {
      agreement: numOrNull(f.agreement),
      breadth: numOrNull(f.breadth),
      coverage: numOrNull(f.convCoverage !== undefined ? f.convCoverage : f.coverage),
      persistence: numOrNull(f.convPersistence),
      weights: CONVICTION_WEIGHTS,
      gate: numOrNull(f.gate),
    },

    quality: {
      otmShare: numOrNull(f.otmShare),
      vegaTilt: numOrNull(f.vegaTilt),
    },
    regime: f.netGamma !== undefined
      ? {
        netGamma: numOrNull(f.netGamma),
        flowGamma: numOrNull(f.netGamma),
        label: f.gRegime || null,
        labelFrom: f.gRegimeFrom || null,
        bookGammaRaw: numOrNull(f.gammaBookRaw),
        bookShare: numOrNull(f.gammaBookShare),

        flipSide: f.flipSide || null,

        spotGammaShare: numOrNull(f.spotGammaShare),

        crossings: numOrNull(f.flipCount),

        flipSeparation: numOrNull(f.flipSeparation),
        bandMin: numOrNull(f.bandMin),
        bandMax: numOrNull(f.bandMax),
      }
      : null,

    gammaFlip: numOrNull(features && features.gammaFlip),
    atr: numOrNull(features && features.atr),
    panels: {
      gamma,

      surface: unfetched && (surface === null || surface === undefined)
        ? { status: "unavailable", reason: unfetched }
        : buildSurface(surface, { spot, asOf: sessionDate }),
      levels: buildLevels({
        spot,
        atr: features && features.atr,
        gammaFlip: features && features.gammaFlip,

        maxPain: painRow ? painRow.px : null,
        callWall: gamma.status === "ok" ? gamma.callWall : null,
        putWall: gamma.status === "ok" ? gamma.putWall : null,
      }),

      scoreOverlay: scoreOverlayPanel(scoreHistory, contextPanel),

      premiumTrack: premiumTrackPanel(scoreHistory),
      ivSurface: chainPanel(chain, "ivSurface"),
      skewTerm: chainPanel(chain, "skewTerm"),
      topContracts: chainPanel(chain, "topContracts"),
      aggressor: chainPanel(chain, "aggressor"),
      path: buildPath(ticks, { sessionDate }),
      calendar: buildCalendar(expiries, { asOf: sessionDate }),

      vanna: greekPanel("vanna", expiries, callVannaLeg, putVannaLeg, sessionDate),
      charm: greekPanel("charm", expiries, callCharmLeg, putCharmLeg, sessionDate),
      deltaExposure: greekPanel("delta", expiries, callDeltaLeg, putDeltaLeg, sessionDate),
      displacement: buildDisplacement(strikes, { atr: f.atr, spot }),
      pricedMove: buildPricedMove({
        spot,
        impliedMovePerc: f.impliedMovePerc,
        vrp: f.vrp, iv30: f.iv30, rv30: f.rv30,
        ivRank: f.ivRank, ivMomentum: f.ivMomentum,
        atmVol: f.atmVol,
        ivStrip: f.ivStrip,
        asOf: sessionDate,
        sessions: HORIZON_SESSIONS,
      }),
      context: contextPanel,

      congress: unfetched && (congress === null || congress === undefined)
        ? { status: "unavailable", reason: unfetched }
        : buildCongress(congress, { asOf: sessionDate }),

      marketRank: buildMarketCross(marketCross, ticker, { asOf: sessionDate }),
      darkpool: stockPanel(darkpool, shapeStockDarkpool, STOCK_NOTES.darkpool,
        darkpoolLead, unfetched),
      oiDeltas: stockPanel(oiDeltas, shapeStockOiChange, STOCK_NOTES.oiDeltas,
        oiDeltasLead, unfetched),
      volContext: darkNull(termStructure) && darkNull(ivRank)
        ? { status: "unavailable",
            reason: unfetched || "neither volatility feed could be read this run",
            note: STOCK_NOTES.volContext }

        : withVolLead({ ...buildVolContext(termStructure, ivRank, { sessionDate }),
            note: STOCK_NOTES.volContext }),
    },
  };
  card.panels.variation = buildVariation(card, { expiries, options: variationOpts });
  if (card.regime && card.panels.variation.inputs) {
    card.regime.bookGamma = numOrNull(card.panels.variation.inputs.gammaBook);
  }
  return card;
}

export function buildVariation(card, { expiries = null, options = null } = {}) {
  try {
    return variation(cardVariationInput(card, { expiries }), options || {});
  } catch (error) {
    return { status: "unavailable",
      reason: "the hedging model failed on this card: " + String(error && error.message || error) };
  }
}

function withVolLead(panel) {
  if (panel.status !== "ok") return panel;
  const term = panel.term && panel.term.status === "ok" ? panel.term : null;
  const rows = term ? term.rows.filter((r) => r.vol !== null) : [];
  if (!rows.length) return panel;
  const pct = (v) => Number((v * 100).toFixed(1));
  const listed = rows.length;

  if (listed === 1) {
    const lead = panelLead(
      `The chain lists one expiry, ${rows[0].expiry}, at ${pct(rows[0].vol)}% ` +
      `— one point, so there is no term slope to read.`,
      { frontExpiry: rows[0].expiry, frontPct: pct(rows[0].vol), listed: 1 });
    return lead ? { ...panel, lead } : panel;
  }

  const f = rows[0], b = rows[rows.length - 1];
  const spread = Number(Math.abs(pct(f.vol) - pct(b.vol)).toFixed(1));
  const lead = panelLead(
    (spread === 0
      ? `The curve is flat across ${listed} listed expiries: the chain charges ` +
        `the same from ${f.expiry} out to ${b.expiry}`
      : `${f.vol > b.vol ? "The front is bid" : "The back is bid"}: the chain ` +
        `charges ${spread} points more at ${f.vol > b.vol ? f.expiry : b.expiry} ` +
        `than at ${f.vol > b.vol ? b.expiry : f.expiry}, across ${listed} ` +
        `listed expiries`) + ".",
    {

      spreadPts: spread,
      frontExpiry: f.expiry,
      backExpiry: b.expiry,

      frontPct: pct(f.vol),
      backPct: pct(b.vol),
      listed,
    });
  return lead ? { ...panel, lead } : panel;
}

const darkNull = (raw) => raw === null || raw === undefined;

function stockPanel(raw, shaper, note, lead, unfetched) {
  if (darkNull(raw)) {

    return { status: "unavailable", reason: unfetched || "the feed could not be read this run", note };
  }
  const panel = { ...shaper(raw), note };

  if (lead && panel.status === "ok") {
    const said = lead(panel);
    if (said) panel.lead = said;
  }
  return panel;
}

function darkpoolLead(panel) {
  const rows = panel.rows || [];
  if (!rows.length) return null;
  const total = rows.reduce((a, r) => a + (r.prem || 0), 0);
  const top = rows[0].prem;
  const scope = panel.shed > 0
    ? `the ${rows.length} largest of ${panel.seen} rankable prints`
    : `all ${rows.length} rankable print${rows.length === 1 ? "" : "s"}`;
  const unpriced = panel.unpriced > 0
    ? ` ${panel.unpriced} further print${panel.unpriced === 1 ? "" : "s"} ` +
      `carried no premium and could not be ranked.`
    : "";
  if (!(total > 0)) {
    return panelLead(
      `Off-exchange prints in this name carry $0 across ${scope} — a measured ` +
      `zero, not a missing reading.${unpriced}`,
      { kept: rows.length, seen: panel.seen, shed: panel.shed,
        unpriced: panel.unpriced, dollars: 0 });
  }
  const t = saidMagnitude(total);
  const topPct = Math.round((top / total) * 100);
  return panelLead(
    `Off-exchange prints carry $${t.shown}${t.suffix} in this name across ` +
    `${scope} — ${topPct}% of it in the single largest.${unpriced}`,
    { shown: t.shown, dollars: t.exact, topPct, topDollars: top,
      kept: rows.length, seen: panel.seen, shed: panel.shed,
      unpriced: panel.unpriced });
}

function oiDeltasLead(panel) {
  const rows = (panel.rows || []).filter((r) => r.diff !== null);
  if (!rows.length) return null;
  const calls = rows.filter((r) => r.cp === "C");
  const puts = rows.filter((r) => r.cp === "P");
  const sum = (list) => list.reduce((a, r) => a + r.diff, 0);
  const c = sum(calls), pu = sum(puts), net = c + pu;
  const sign = (v) => (v > 0 ? "+" : v < 0 ? "\u2212" : "");
  const say = (v) => { const m = saidMagnitude(v); return sign(v) + m.shown + m.suffix; };
  const side = net > 0 ? "grew" : net < 0 ? "fell" : "is unchanged on net";
  return panelLead(
    `Of the ${rows.length} line${rows.length === 1 ? "" : "s"} the vendor ` +
    `surfaced with a contract count, open interest ${side}: ` +
    `${say(c)} across ${calls.length} call line${calls.length === 1 ? "" : "s"} ` +
    `against ${say(pu)} across ${puts.length} put line${puts.length === 1 ? "" : "s"} ` +
    `— one clearing day late, never today's tape.`,
    {
      counted: rows.length,
      callLines: calls.length,
      putLines: puts.length,
      callNet: Math.abs(c), putNet: Math.abs(pu), net: Math.abs(net),
      callShown: saidMagnitude(c).shown, putShown: saidMagnitude(pu).shown,
    });
}

export function pickMaxPainRow(rows, { asOf = null } = {}) {
  const parsed = (rows || [])
    .map((r) => ({ expiry: r.expiry, px: numOrNull(r.max_pain) }))
    .filter((r) => r.expiry && r.px !== null)
    .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  if (!parsed.length) return null;

  if (asOf) {
    const live = parsed.filter((r) => String(r.expiry).slice(0, 10) >= String(asOf).slice(0, 10));
    if (live.length) return live[0];

    return null;
  }
  return parsed[0];
}

export function pickMaxPain(rows, options) {
  const row = pickMaxPainRow(rows, options);
  return row ? row.px : null;
}

const SURFACE_STRIKES = 21;
export const SURFACE_EXPIRIES = 8;

export function buildSurface(rows, {
  spot, maxStrikes = SURFACE_STRIKES, maxExpiries = SURFACE_EXPIRIES, asOf = null,
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return unavailable("no expiry-strike gamma");
  const s = numOrNull(spot);
  if (s === null || !(s > 0)) return unavailable("no spot");

  const cells = new Map();
  const strikeTotals = new Map();
  const expirySeen = new Map();

  for (const r of list) {
    const strike = numOrNull(r.strike ?? r.price);
    const expiry = r.expiry ? String(r.expiry).slice(0, 10) : null;
    if (strike === null || !expiry) continue;
    const legs = [r.call_gamma_ask, r.call_gamma_bid, r.put_gamma_ask, r.put_gamma_bid];
    if (!legs.some((v) => numOrNull(v) !== null)) continue;
    const g = legs.reduce((a, v) => a + (numOrNull(v) ?? 0), 0);

    if (!cells.has(expiry)) cells.set(expiry, new Map());
    const col = cells.get(expiry);
    col.set(strike, (col.get(strike) ?? 0) + g);
    strikeTotals.set(strike, (strikeTotals.get(strike) ?? 0) + g);
    expirySeen.set(expiry, (expirySeen.get(expiry) ?? 0) + Math.abs(g));
  }
  if (!cells.size) return unavailable("no measured gamma legs");

  const expiries = Array.from(cells.keys()).sort().slice(0, maxExpiries);

  const allStrikes = Array.from(strikeTotals.keys()).sort((a, b) => a - b);
  let nearest = 0;
  for (let i = 1; i < allStrikes.length; i++) {
    if (Math.abs(allStrikes[i] - s) < Math.abs(allStrikes[nearest] - s)) nearest = i;
  }
  const half = Math.floor(maxStrikes / 2);
  let from = Math.max(0, nearest - half);
  let to = Math.min(allStrikes.length, from + maxStrikes);
  from = Math.max(0, to - maxStrikes);
  const strikes = allStrikes.slice(from, to);
  if (!strikes.length || !expiries.length) return unavailable("no strikes in band");

  const grid = strikes.map((k) => expiries.map((e) => {
    const col = cells.get(e);
    const v = col ? col.get(k) : undefined;
    return v === undefined ? null : v;
  }));

  const mags = [];
  for (const row of grid) for (const v of row) if (v !== null && v !== 0) mags.push(Math.abs(v));
  mags.sort((a, b) => a - b);
  const peak = mags.length ? mags[mags.length - 1] : 0;
  const q = (p) => {
    if (!mags.length) return 0;
    const i = (mags.length - 1) * p;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return mags[lo] + (mags[hi] - mags[lo]) * (i - lo);
  };
  const scaleCap = mags.length ? Math.max(q(0.95), peak / 100) : 0;
  let clipped = 0;
  for (const row of grid) for (const v of row) if (v !== null && Math.abs(v) > scaleCap) clipped++;

  let callWall = null, putWall = null;
  for (const k of strikes) {
    const total = strikeTotals.get(k) ?? 0;
    if (total > 0 && (callWall === null || total > callWall.gamma)) callWall = { strike: k, gamma: total };
    if (total < 0 && (putWall === null || total < putWall.gamma)) putWall = { strike: k, gamma: total };
  }

  const colNet = expiries.map((_, j) => {
    let sum = null;
    for (const row of grid) if (row[j] !== null) sum = (sum ?? 0) + row[j];
    return sum;
  });
  const surfaceLead = (() => {
    const front = colNet[0];
    if (front === null) return null;
    const rest = colNet.slice(1).filter((v) => v !== null);
    const window = expiries.length === cells.size
      ? ""
      : ` — over the ${strikes.length} strikes and ${expiries.length} of ` +
        `${cells.size} expiries drawn`;
    const word = (v) => (v > 0 ? "long" : v < 0 ? "short" : "flat");
    const f = saidMagnitude(front);
    if (!rest.length) {
      return panelLead(
        `The grid holds one measured expiry, ${expiries[0]}: dealers are net ` +
        `${word(front)} ${f.shown}${f.suffix} of gamma there${window}.`,
        { frontShown: f.shown, frontGamma: f.exact, frontExpiry: expiries[0],
          expiriesShown: expiries.length, expiriesTotal: cells.size,
          strikesShown: strikes.length });
    }
    const back = rest.reduce((a, v) => a + v, 0);
    const b = saidMagnitude(back);
    const flips = (front > 0 && back < 0) || (front < 0 && back > 0);
    return panelLead(
      (flips
        ? `The book flips sign along the term: ${expiries[0]} is net ${word(front)} `
        : `The book keeps its sign along the term: ${expiries[0]} is net ${word(front)} `) +
      `${f.shown}${f.suffix} of gamma, and the ${rest.length} measured ` +
      `expir${rest.length === 1 ? "y" : "ies"} out to ` +
      `${expiries[expiries.length - 1]} are net ${word(back)} ` +
      `${b.shown}${b.suffix} together${window}.`,
      {
        frontExpiry: expiries[0],
        lastExpiry: expiries[expiries.length - 1],
        frontShown: f.shown,
        frontGamma: f.exact,
        backShown: b.shown,
        backGamma: b.exact,
        backExpiries: rest.length,
        expiriesShown: expiries.length,
        expiriesTotal: cells.size,
        strikesShown: strikes.length,
      });
  })();

  return ok({
    spot: s,
    lead: surfaceLead,
    expiries,
    strikes,
    grid,
    rowTotals: strikes.map((k) => strikeTotals.get(k) ?? 0),
    atSpot: allStrikes[nearest],
    callWall,
    putWall,
    scaleCap,
    peak,
    clipped,

    expiriesShown: expiries.length,
    expiriesTotal: cells.size,
    strikesShown: strikes.length,
    strikesTotal: allStrikes.length,
  }, asOf);
}
