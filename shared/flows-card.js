/* =============================================================
   flows-card.js — assembly of one ticker's detail card.

   Pure functions over already-fetched vendor arrays. No network, no
   clock: every input is passed in, so the whole surface is testable
   and the --dry-run harness exercises it before any live quota is
   spent.

   THREE RULES, each written because the alternative has already
   shipped a bug in this repository.

   1. A MISSING VALUE IS null, NEVER 0.
      num() defaults to 0, which is correct for a cross-sectional
      ranking — one name's zero sits in the middle of a winsorized
      column. A card has no cross-section. Here a fallback zero
      renders as the most extreme reading the panel can produce:
      "distance to max pain: -100%", "spot is exactly at the gamma
      flip", "IV at the 0th percentile", "0 congressional buyers".
      Absence degrades to maximum conviction, not to neutral. So card
      assembly uses numOrNull and every panel is a tagged union with
      an explicit status.

   2. EVERY PANEL CARRIES THE SESSION IT DESCRIBES.
      The pipeline runs 05:15 ET, before the open. Endpoints called
      with no `date` return the most recent COMPLETED session, which
      is yesterday's. A panel headed with today's date would be
      mislabelled on day one, before any failure occurs. sessionDate
      and asOf are therefore not optional decoration.

   3. POLARITY IS A PROPERTY OF THE FIELD, NOT OF THE NUMBER.
      net_put_premium positive means put BUYING, which is bearish. A
      generic "positive is green" renderer paints it backwards. The
      POLARITY table below is the single place that mapping lives,
      and the renderer must look a field up by key rather than by
      sign.
   ============================================================= */

/**
 * THE CARD'S SCHEMA VERSION, and the one rule for bumping it.
 *
 * Bump when a field's MEANING changes, not when a field is added — a renderer
 * can ignore a field it does not know, but it cannot detect that a number it
 * already reads now means something else.
 *
 * 1 -> 2: fam.V and fam.O were SIGNED family votes in [-100, 100]. They are now
 * UNSIGNED gauges in [0, 100] — V the volatility regime, O the quality
 * multiplier — because neither carries a direction and adding an unsigned
 * magnitude to a signed sum is what made the board rank against its own flow.
 * The live board carried `"O": 53` under the old meaning and `"O": -22` on
 * another name; drawn by a v2 renderer those become a 53%-full gauge and a
 * negative-width bar under the number -22. Cards published before this change
 * therefore render V and O as absent rather than as numbers whose meaning
 * silently moved. F, P and D are unchanged and keep rendering.
 */
export const CARD_SCHEMA_VERSION = 2;

/* Every import here is pure, and each is shared rather than copied for the
   same reason: the square-root-of-time scaling and the horizon it is stated in
   belong to the scorer too, and the expiry-gamma leg names have already been
   wrong once in two places at once. Two copies of a convention are two chances
   to disagree about it. */
import {
  horizonMove, HORIZON_SESSIONS, callGammaLeg, putGammaLeg, pathSignature,
  greekTermStructure, callVannaLeg, putVannaLeg, callCharmLeg, putCharmLeg,
  callDeltaLeg, putDeltaLeg, CONVICTION_WEIGHTS,
} from "./flows-features.js";
import {
  shapeStockDarkpool, shapeStockOiChange, buildVolContext, STOCK_NOTES,
} from "./flows-stock.js";
/* The volume floor the basis check applies, imported rather than repeated:
   a copy here would silently stop matching the check the moment that number
   moves, and the card publishes it as the population the counts describe. */
import { UA_MIN_VOLUME } from "./flows-unusual.js";
import { joinScoreToPrice } from "./flows-overlay.js";
export { HORIZON_SESSIONS };

/** Parse to a finite number, or null. The counterpart to num()'s zero. */
export function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A panel that has its data. */
export function ok(values, asOf) {
  return { status: "ok", asOf: asOf || null, ...values };
}

/** A panel whose source did not arrive. Never carries numbers. */
export function unavailable(reason) {
  return { status: "unavailable", reason: reason || "no data", asOf: null };
}

/**
 * A panel whose source ARRIVED AND MEASURED NOTHING. Never carries numbers.
 *
 * THE THIRD SILENCE, AND THE CARD IS THE LAST SURFACE TO GET IT. Every other
 * section in this product tells three empties apart — the key was never
 * published, the request did not come back, the pipeline read and found
 * nothing — because only the last of those is a fact about the market. The
 * card boundary had exactly two states, so a measured emptiness had to
 * borrow `unavailable`, and the live product printed
 *
 *     "Unavailable. no disclosed transactions"
 *
 * which is both silences in one sentence: an unavailability status carrying a
 * measured-emptiness reason. A reader cannot tell whether nobody in Congress
 * traded this name or whether the request failed, and those are opposite
 * facts about the same blank space.
 *
 * Widening the union is deliberate and is done for EVERY panel at once. The
 * source-ablation sweep asserts the union over every panel on every ablation
 * precisely so that this cannot be widened by accident for one new panel;
 * doing it here, with the renderer taught the third arm in the same change,
 * is what that assertion was protecting.
 */
export function quiet(reason) {
  return { status: "quiet", reason: reason || "measured nothing", asOf: null };
}

/**
 * Directional polarity per card field.
 *   +1  a larger number is more bullish
 *   -1  a larger number is more bearish
 *    0  no directional meaning; must never be coloured
 */
export const POLARITY = Object.freeze({
  netCallPremium: +1,
  // Positive net PUT premium is put BUYING. Bearish. This is the entry the
  // whole table exists for.
  netPutPremium: -1,
  netPremium: +1,
  dirDelta: +1,
  pathNet: +1,
  netGamma: 0,          // a regime, not a direction
  flipDistPct: 0,       // meaningful only together with the regime
  purity: 0,            // a confidence, not a direction
  otmShare: 0,
  vegaTilt: 0,
  atr: 0,
  distPct: 0,
  distAtr: 0,
  changePct: +1,
  // risk_reversal is IV(put) - IV(call): negative means calls are bid, bullish.
  riskReversal: -1,
  ivRank: 0,
  disclosureLagDays: 0,
  /* The volatility block. NONE of it is directional, and that is the point:
     there is no identified relation turning "implied vol is rich" into "this
     name goes up". A renderer that green-tints a high VRP is inventing a
     forecast the data does not support. */
  iv30: 0,
  rv30: 0,
  vrp: 0,
  ivMomentum: 0,
  impliedMovePerc: 0,
  // Where new dealer gamma is building relative to the standing book: signed,
  // positive means above.
  displacement: +1,
  // Cumulative dealer gamma at spot as a share of the ladder's peak. A regime,
  // not a direction: negative amplifies whatever the flow is pushing.
  spotGammaShare: 0,
  gammaFrontLoad: 0,
  gammaMeanLifeDays: 0,
  week52Pos: 0,
  /* The chain block, added when /flows/ticker/ gave the four chain panels a
     renderer for the first time.

     NAMED AFTER THE FIELDS THAT EXIST, which is the whole discipline of this
     table and is easy to get wrong here. The ticker spec first proposed an
     entry called `netAggr`. No payload field is called netAggr — the fields
     are `aggressor.bars[].net` and `topContracts.rows[].aggr`. polarityOf()
     returns 0 for a key it does not know, so that entry would have been a
     silent NEUTRAL on the one panel where the flow pair is genuinely correct,
     and the sign colour would simply have vanished with nothing failing. */
  skew: -1,     // put iv - call iv, the SAME construction as riskReversal:
                // a larger number is the put wing bid over the call wing,
                // which is bearish. If these two ever disagree, one is wrong.
  term: 0,      // far atm iv - near atm iv: a SHAPE, not a direction
  atmIv: 0,     // a level
  net: +1,      // aggressor.bars[].net - calls lifted +, puts lifted -
  aggr: +1,     // topContracts.rows[].aggr = ask_volume - bid_volume
});

/** Look up a field's polarity. Unknown fields are neutral, never guessed. */
export function polarityOf(key) {
  return Object.hasOwn(POLARITY, key) ? POLARITY[key] : 0;
}

/* ---------- levels ---------------------------------------------- */

/**
 * The key-level ladder, each level measured against spot in BOTH percent
 * and ATR units.
 *
 * ATR is what makes the two comparable across names: 3% is a routine day in
 * one name and a three-sigma move in another, and a trader placing a stop
 * needs the second number, not the first.
 */
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
      // null rather than Infinity when ATR is unavailable: a distance in
      // sigma units with no sigma is not a small number, it is no number.
      distAtr: a !== null && a > 0 ? (px - s) / a : null,
    };
  };

  const levels = [
    measure("gamma_flip", "Gamma flip", gammaFlip),
    measure("max_pain", "Max pain", maxPain),
    measure("call_wall", "Call wall", callWall),
    measure("put_wall", "Put wall", putWall),
  ].filter(Boolean);

  if (!levels.length) return unavailable("no levels resolved");
  // Nearest first: the level a move reaches next is the one that matters.
  levels.sort((x, y) => Math.abs(x.distPct) - Math.abs(y.distPct));
  return ok({ spot: s, atr: a, levels });
}

/**
 * The gamma profile: net dealer gamma per strike, reduced to a drawable
 * ladder, plus the walls.
 *
 * put_gamma arrives ALREADY dealer-signed, so total exposure per strike is a
 * SUM. Subtracting double-negates and inverts every regime call — the
 * convention flows-features.js calls load-bearing, restated here because this
 * is a second consumer of the same fields.
 */
export function buildGammaProfile(strikeRows, { spot, maxBars = 60 } = {}) {
  /* THE AGGRESSOR-SPLIT FIELDS, matching aggressorGamma() exactly.

     /spot-exposures/strike returns call_gamma_ask, call_gamma_bid,
     call_gamma_oi and call_gamma_vol — and the put equivalents. It does NOT
     return an unsplit call or put leg; the whole-expiry aggregate belongs to
     /greek-exposure/expiry, a different endpoint with a different shape, which
     names its legs call_gex and put_gex (see callGammaLeg in flows-features).

     Reading the wrong names cost nothing loudly and everything quietly: every
     strike summed to exactly 0, so the published cards carried 54 correctly
     priced bars of zero gamma, both walls came out null, and the panel drew an
     empty plot beside a flip line the pipeline had computed correctly from the
     same rows. The ablation test did not catch it because its fixture used the
     field names this function was guessing at — it validated the guess against
     itself. That fixture now carries the real names.

     put_gamma_* arrives ALREADY dealer-signed, so all four legs are SUMMED. */
  const rows = (strikeRows || []).map((r) => {
    const legs = [r.call_gamma_ask, r.call_gamma_bid, r.put_gamma_ask, r.put_gamma_bid];
    const present = legs.some((v) => numOrNull(v) !== null);
    return {
      strike: numOrNull(r.strike ?? r.price),
      // null, not 0, when the row carries no gamma at all: a strike whose
      // exposure is unknown must not be drawn as a measured zero.
      gamma: present ? legs.reduce((a, v) => a + (numOrNull(v) ?? 0), 0) : null,
    };
  }).filter((r) => r.strike !== null && r.gamma !== null);

  if (!rows.length) return unavailable("no strike ladder");
  rows.sort((a, b) => a.strike - b.strike);

  // Reduce to at most maxBars buckets so the SVG stays readable and the
  // payload stays inside the ingest cap. An unbanded ladder is ~600 KB.
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
    /* THE BAND IS PART OF THE READING, not an implementation detail.

       The ladder is fetched over spot*[0.7, 1.3], so every cumulative on it is
       the true cumulative minus a constant — the book below the floor. The
       panel used to present the result as "net gamma" without qualification
       and the flip as an unconditional level. Publishing the bounds lets the
       card say "net dealer gamma between $X and $Y", which is what was
       actually measured. */
    bandMin: rows[0].strike,
    bandMax: rows[rows.length - 1].strike,
  });
}

/* ---------- gamma expiry calendar --------------------------------- */

/**
 * The roll-off staircase: what share of this name's dealer gamma expires
 * when.
 *
 * Gamma exposure is almost always published as a scalar. It has a term
 * structure, and the term structure is the difference between "it's pinned"
 * and "it's pinned until Friday, and then it isn't". These rows are already
 * fetched for the score and were thrown away at the card boundary.
 *
 * put_gamma arrives ALREADY dealer-signed, so the GROSS roll-off sums the
 * magnitudes: a front week of 1e9 call against -999e6 put is 2.0e9 of gamma
 * about to expire, not the 1e6 residual their signed sum leaves behind.
 */
export function buildCalendar(expiryRows, { asOf = null, maxRows = 10 } = {}) {
  const rows = (expiryRows || []).map((r) => {
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

  return ok({
    // The first `maxRows` expiries carry the decision; the tail is a footnote.
    schedule: schedule.slice(0, maxRows),
    expiries: schedule.length,
    halfLifeExpiry,
    halfLifeDays,
    /* frontLoad is PARTITION-DEPENDENT — it is the first LISTED expiry's
       share, so a weekly chain and a monthly chain are not comparable and
       adding an expiry changes it without the book changing. The gamma-
       weighted mean life is identified: E[days to expiry] under the gross-
       gamma measure, in days, invariant to how the chain is cut. */
    frontLoad: schedule.length ? schedule[0].share : null,
    meanLifeDays: total > 0 && Number.isFinite(base)
      ? Number((lifeWeighted / total).toFixed(1))
      : null,
  }, asOf);
}

/* ---------- book displacement ------------------------------------- */

/**
 * Where today's flow is building gamma, against where the book already is.
 *
 * *_oi is the standing book; *_vol is what traded today. Compared as
 * DISTRIBUTIONS rather than totals — the gap between their gamma centroids,
 * in ATR units. Conventional GEX describes the regime you are in; this says
 * the regime is moving, and which way. Same rows as the gamma panel, so it
 * costs nothing.
 */
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

  return ok({
    oiCentroid: Number(oi.c.toFixed(2)),
    volCentroid: Number(vol.c.toFixed(2)),
    spot: numOrNull(spot),
    gapPx: Number((vol.c - oi.c).toFixed(2)),
    // null, not Infinity, when there is no sigma: a distance in sigma units
    // with no sigma is not a small number, it is no number.
    gapAtr: a !== null && a > 0 ? Number(((vol.c - oi.c) / a).toFixed(3)) : null,
  });
}

/* ---------- the priced move ---------------------------------------- */

/**
 * The band the option market has already quoted, and whether it is rich.
 *
 * This is a PRICE, not a prediction. implied_move_perc is the move the ATM
 * contracts imply to a quoted expiry; it is a risk-neutral quantity, so it is
 * what someone would have to pay to be long that move, not what the stock is
 * expected to do. Two consequences the panel is built around:
 *
 *  - The horizon is the EXPIRY THE VENDOR QUOTED, never "ten days". Relabelling
 *    a quoted-expiry number as a fixed horizon silently rescales it by the
 *    ratio of the two maturities, differently for every name.
 *  - No point target, no direction, no probability. The variance risk premium
 *    beside it is the only observable that says whether the band is expensive
 *    against what this stock has actually been delivering.
 *
 * THE VENDOR'S QUOTE IS NOT DATED, because its date cannot be observed. The
 * schema behind implied_move says: "If no expiry date is included, then the
 * implied move is for the nearest end of the week expiration (the nearest
 * monthly expiration if there are no weekly contracts)" — and the screener
 * accepts no expiry parameter, so that default always applies. This panel used
 * to name that horizon from the max-pain chain's nearest expiry, which is the
 * same date only when the nearest listed expiry happens to be the coming
 * Friday; any intra-week expiry breaks it. The quote is therefore labelled by
 * the RULE the vendor states rather than by a date this code inferred.
 *
 * TWO BANDS, and only one of them is a cross-section.
 *
 * The vendor's implied_move_perc is quoted to each name's own next listed
 * expiry, so it is a different horizon for every name — a name expiring
 * tomorrow and one expiring in a month print bands that cannot be compared, and
 * setting them side by side on a board is a category error. The FIXED-HORIZON
 * band scales 30-day implied volatility to a stated number of trading sessions
 * by the square-root-of-time rule, which is the same horizon for every name.
 * The realized band does the same to the volatility the stock has actually been
 * delivering, so the gap between them is the variance risk premium expressed in
 * the units a reader sizes in.
 */
export function buildPricedMove({
  spot, impliedMovePerc, vrp, iv30, rv30, ivRank, ivMomentum, atmVol, ivStrip, asOf,
  sessions = HORIZON_SESSIONS,
}) {
  const s = numOrNull(spot);
  const m = numOrNull(impliedMovePerc);
  const impliedH = horizonMove(numOrNull(iv30), { sessions });
  const realizedH = horizonMove(numOrNull(rv30), { sessions });
  // Either band alone is worth publishing; only both missing is unavailable.
  if (s === null || !(s > 0)) return unavailable("no spot price");
  if ((m === null || !(m > 0)) && impliedH === null) return unavailable("no implied volatility");

  const quoted = m !== null && m > 0;
  return ok({
    /* --- the vendor's quote, to ITS OWN undated horizon: real, but neither
       comparable across names nor datable from anything this pipeline sees. --- */
    movePerc: quoted ? Number(m.toFixed(5)) : null,
    low: quoted ? Number((s * (1 - m)).toFixed(2)) : null,
    high: quoted ? Number((s * (1 + m)).toFixed(2)) : null,
    // The vendor's stated rule, carried verbatim so the renderer states it
    // rather than inventing a date for it.
    horizonRule: quoted ? "the nearest end-of-week expiry" : null,

    // --- the fixed horizon, which IS comparable across the board ---
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
    /* Where this name's implied vol sits in its own year, and whether it is
       rising. Neither is directional — a rich, rising option market says
       buyers are paying up, not that the stock goes up — so both live beside
       the band as context and are summarised by the unsigned V gauge on the
       score panel. They used to sit in a separate `vol` panel that was built,
       serialised and published on every card, and that no renderer drew. */
    ivRank: numOrNull(ivRank),
    ivMomentum: numOrNull(ivMomentum),
    /* THE VENDOR'S OWN AT-THE-MONEY VOLATILITY, parsed since the first
       screener call and dropped at this boundary every session since. It is a
       different measurement from iv30 — the vendor's `volatility` field rather
       than its 30-day interpolation — and publishing both lets a reader see
       them disagree instead of trusting one silently. */
    atmVol: numOrNull(atmVol),
    /* THIS NAME'S OWN 30-DAY IMPLIED VOL, four points, zero extra calls: the
       screener has carried iv30d_1d and iv30d_1m alongside iv30d and iv30d_1w
       from the beginning and nothing has ever read the first two. Ordered
       oldest to newest so a renderer draws it left to right without deciding
       an order of its own. A point the vendor did not send is null, never
       carried forward from its neighbour. */
    ivStrip: Array.isArray(ivStrip)
      ? ivStrip.map((p) => ({ h: p.h, v: numOrNull(p.v) }))
      : null,
    // The one comparative statement the data supports, as a tag rather than
    // prose so the renderer cannot embellish it.
    richness: numOrNull(vrp) === null ? null : (vrp > 0 ? "rich" : "cheap"),
  }, asOf);
}

/* ---------- price context ------------------------------------------ */

/** Where the name has been: period returns and its position in a year's range. */
export function buildContext(
  { closes, closeDates, r5, r21, r42, week52Pos, changePct }, { asOf = null } = {},
) {
  /* FILTERED IN LOCKSTEP, WHICH IS THE WHOLE POINT.

     This function drops any close that is null or non-positive, which is
     correct — an unreadable candle is not a price. What it could not do was
     say WHEN the survivors happened, so `closes` was a positional array and
     every reader had to treat index as time. That holds only while nothing
     is missing, and this filter is what makes things missing: drop one
     session out of the middle and two non-adjacent days become neighbours,
     silently, with the sparkline drawing a smooth step across a gap.

     It is also why nothing in this product could put the daily-close score on
     the same axis as price — the payload carried no key to join on. Both
     halves have been published and rendered for weeks, on separate pages, in
     incompatible shapes.

     Zipping the two arrays BEFORE the filter is what keeps them parallel. A
     dates array bolted on afterwards and filtered separately — or not
     filtered at all — is misaligned by exactly the number of dropped
     sessions, which is the defect this comment exists to prevent someone
     reintroducing while "adding dates". */
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
  return ok({
    ...fields,
    closes: series.map((c) => Number(c.toFixed(4))),
    /* Same length as `closes` by construction, with null where the candle
       carried no readable date. Absent entirely when the publisher sent no
       dates at all — a card from before this field existed says so by not
       having it, rather than by carrying a row of nulls that looks like a
       measurement of nothing. */
    ...(dated ? { closeDates: dates } : {}),
    sessions: series.length,
    /* How many of the retained closes can actually be placed on a time axis.
       A chart that joins on date must know this is not always `sessions`. */
    datedSessions: dated,
    /* Sessions the filter removed. Non-zero means index is NOT time in the
       arrays above, which is precisely when a reader needs the dates. */
    dropped: rawCloses.length - series.length,
  }, asOf);
}

/* ---------- intraday path ---------------------------------------- */

/**
 * The tick tape, downsampled and CUMULATED.
 *
 * Raw is ~390 one-minute rows of 13 fields, about 130 KB — every liquid
 * name's card would exceed the 128 KB ingest cap on its own. 78 five-minute
 * buckets of three numbers is about 2 KB.
 *
 * Each row is that tick's OWN value, not a running total, so the series a
 * trader wants is the cumulative sum. Rendering the raw per-minute values
 * would show noise around zero rather than the shape of the accumulation.
 */
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
    // Net premium as a directional quantity: call buying minus put buying.
    cumP += r.cp - r.pp;
    const b = span > 0 ? Math.min(buckets - 1, Math.floor((r.t - first) / width)) : 0;
    acc[b] = { d: cumD, p: cumP };
  }
  // Carry the running total forward through quiet buckets; a gap is not a
  // return to zero.
  let last = { d: 0, p: 0 };
  const series = acc.map((v) => {
    if (v) last = v;
    return [Math.round(last.d), Math.round(last.p)];
  });

  /* THE SHAPE OF THE ACCUMULATION, PUBLISHED AS NUMBERS AND NOT ONLY AS A CURVE.
     
     pathSignature's own docstring says why the panel exists: "two names with
     the same end-of-day net delta and different paths mean opposite things",
     steady accumulation against the tape versus one spike already in the
     price. Those three numbers ARE that distinction, they drive the D axis of
     the score and the persistence term of conviction — and the card published
     none of them, so the panel could show the reader a curve and three
     end-of-day totals and could not state the one thing it is for. This is the
     same failure as the `vol` block that was built, serialised and shipped on
     every card with no renderer: computed, paid for, unreadable.

     RECOMPUTED FROM THE SAME ROWS rather than plumbed through from the
     scorer's feature object, for the reason the import block already gives:
     two copies of a convention are two chances to disagree about it. The
     scorer reads pathSignature on these very ticks, so recomputing costs one
     pass over an array already in memory and guarantees the number on the card
     is the number in the score.

     NULL WHEN THE TAPE DID NOT MOVE. pathSignature falls back to
     persistence 0, concentration 0 and centroid 0.5 on a tape it cannot
     measure, which is correct for a cross-sectional column and is exactly the
     manufactured extreme this file's first rule forbids on a card: 0.5 is
     "the day's weight sat precisely at midday", a real and unusual reading,
     and 0 concentration is the flattest session possible. A tape whose every
     minute is zero has no direction to persist in and no busiest minute, so
     all three are withheld. */
  const moved = rows.reduce((a, r) => a + Math.abs(r.d), 0);
  const sig = moved > 0 ? pathSignature(tickRows) : null;

  return ok({
    series,
    netDelta: Math.round(cumD),
    netPremium: Math.round(cumP),
    minutes: rows.length,
    startedAt: new Date(first).toISOString(),
    // Share of minutes moving WITH the day's net direction. 0.5 is a
    // directionless tape; 1 is a buyer who never let up.
    persistence: sig ? sig.persistence : null,
    // Share of absolute movement contributed by the busiest 5% of minutes.
    // 0.05 is a perfectly uniform session, so the reading is read against
    // that baseline rather than against zero.
    concentration: sig ? sig.concentration : null,
    // Movement-weighted mean minute, 0 at the open and 1 at the close.
    centroid: sig ? sig.centroid : null,
  }, sessionDate);
}

/* ---------- congress ---------------------------------------------- */

const AMOUNT_RANGE = /\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/;

/**
 * Disclosed congressional transactions in this name.
 *
 * Deliberately NOT "congressional buyers", and deliberately without a member
 * track record or an average return.
 *
 * ONE OF THE TWO ORIGINAL REASONS HAS EXPIRED, AND SAYING SO IS THE POINT.
 * This comment used to argue that /api/congress/congress-trader "accepts only
 * limit, date, ticker and name — no page and no offset", so a member's
 * history could not be walked. The specification now documents `page`
 * (1-indexed), `date_from` and `date` on that route, and the political
 * section walks exactly that ladder. A refusal resting on a vendor
 * limitation has to be re-read when the vendor changes, or it becomes
 * folklore that outlives its own reason.
 *
 * The reason that has not expired is the one that never could:
 *
 *  - A disclosure reports an OPENING with no paired closing print, so any
 *    "return" attributed to it is invented. No amount of pagination supplies
 *    the closing print, so no budget makes a track record computable here.
 *
 * What IS informative, and free: the disclosure lag. The STOCK Act allows 45
 * days and late filers routinely exceed 100, so a trade surfacing today may
 * be three days old or eighty. That number belongs in the row, not a footnote.
 */
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
      // A large share of filings are a spouse's or a dependent's. Attributing
      // those to a member's judgement is the classic error, so the issuer is
      // shown rather than collapsed away.
      issuer: r.issuer || null,
      // The vendor writes "Sale" and "Purchase", not "sell" and "buy", so the
      // obvious /sell/ test matches neither and silently returns null for
      // every row. Both spellings are accepted.
      side: /sale|sell|sold/i.test(r.txn_type || "") ? "sell"
        : /purchase|buy|bought/i.test(r.txn_type || "") ? "buy"
        : null,
      txnDate: r.transaction_date || null,
      filedDate: r.filed_at_date || null,
      disclosureLagDays: lag,
      // The bracket verbatim. Any dollar figure derived from a midpoint is
      // fabricated precision.
      amountRange: typeof r.amounts === "string" ? r.amounts.trim() : null,
      amountLow: m ? Number(m[1].replace(/,/g, "")) : null,
      amountHigh: m ? Number(m[2].replace(/,/g, "")) : null,
      _sort: Number.isFinite(txn) ? txn : 0,
    };
  }).filter((r) => r.member);

  if (!rows.length) {
    /* WHICH EMPTY THIS IS, decided by what the caller handed over.

       `null` means the congress read did not happen for this name — the
       market-wide fetch threw, or the deadline cut the per-name fallback
       short. `[]` means it DID happen and this ticker appeared in none of
       the filings. Those are opposite facts, and until now both produced
       "Unavailable. no disclosed transactions": an unavailability status
       carrying a measured-emptiness reason, printed on every card.

       Cards published before the pipeline learned this distinction hand over
       `undefined`, which is honestly unknown and reads as unavailable. */
    if (tradeRows === null || tradeRows === undefined) {
      return unavailable("the disclosure tape was not read for this name in this run");
    }
    return quiet("the disclosure tape was read and named no member trading this ticker");
  }
  rows.sort((a, b) => b._sort - a._sort);
  const kept = rows.slice(0, limit).map(({ _sort, ...r }) => r);

  const lags = kept.map((r) => r.disclosureLagDays).filter((n) => n !== null);
  return ok({
    trades: kept,
    total: rows.length,
    buys: kept.filter((r) => r.side === "buy").length,
    sells: kept.filter((r) => r.side === "sell").length,
    medianLagDays: lags.length
      ? lags.slice().sort((a, b) => a - b)[lags.length >> 1]
      : null,
  }, asOf);
}

/* ---------- assembly ---------------------------------------------- */

/**
 * One card. Every panel is independent: a dead congress feed still ships a
 * live gamma panel, and no panel failure can remove the name from the board.
 */
/**
 * The score history laid over the dated price window, or a stated absence.
 *
 * A THIN WRAPPER ON PURPOSE. The join itself lives in shared/flows-overlay.js
 * where it is tested against hand-checkable inputs; this only maps the two
 * ways the INPUTS can be missing onto the sentences a card reader needs, and
 * keeps them apart from the two ways the JOIN can come back empty.
 *
 * Four states reach the page and they are four different facts:
 *   - the track was never read this run          → unavailable, pipeline-side
 *   - the track was read and this name is absent → quiet, a fact about the name
 *   - the card has no dated price window         → unavailable, from the join
 *   - both windows read, no shared session       → quiet, from the join
 * Collapsing any two of them into "no data" is how a reader loses the ability
 * to tell a skipped leg from a name that was never on a board.
 */
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
  return joinScoreToPrice({
    closes: ctx ? ctx.closes : null,
    closeDates: ctx ? ctx.closeDates : null,
    sessions: history.sessions,
    scores: history.scores,
    deadBand: history.deadBand,
  });
}

/**
 * The open-interest basis check, in the shape a card publishes.
 *
 * THE LOG LINE DOES NOT SHIP. describeOiBasis returns a `line` written for a
 * pipeline job log — it carries a "[dry-run]" tag, it addresses a maintainer,
 * and it names other pages of this product. A card is read by someone holding
 * a table, so the payload carries the three counts and the verdict and the
 * renderer composes the sentence beside the column. That also keeps this
 * prose inside the files the vocabulary suites scan.
 *
 * `minVolume` TRAVELS WITH THE COUNTS because the check is not run over every
 * row in the table. shared/flows-unusual.js applies it only to contracts
 * trading at least UA_MIN_VOLUME lots, so `seen` is a subset of the rows on
 * screen and a reader told "3 of 8" without the threshold would look for
 * eight rows and count something else.
 */
function oiBasisReading(basis) {
  if (!basis || typeof basis !== "object") return null;
  const seen = numOrNull(basis.seen);
  if (seen === null) return null;
  return {
    seen,
    exceeded: numOrNull(basis.exceeded),
    exceedShare: numOrNull(basis.exceedShare),
    /* "no-data" | "falsified" | "inconclusive" — and the renderer switches on
       it rather than re-deriving the verdict from the counts, so the two can
       never drift into disagreeing about the same rows. */
    verdict: typeof basis.verdict === "string" ? basis.verdict : null,
    minVolume: UA_MIN_VOLUME,
  };
}

/**
 * One chain panel, or a stated absence.
 *
 * The chain leg is the last vendor spend of the run and the first thing a slow
 * morning drops, so "this card has no chain" is an ORDINARY state rather than
 * an error — and it has to arrive as a reason a reader can see, never as an
 * empty panel or a zero.
 */
function chainPanel(chain, key) {
  if (!chain) {
    return {
      status: "unavailable",
      reason: "no option chain was fetched for this name this session — the chain leg " +
        "is the last call the pipeline spends and the first it gives up on a slow morning",
    };
  }
  const panel = chain[key] || { status: "unavailable", reason: "this panel was not built from the chain" };
  /* HOW MUCH OF THE BOOK THIS WAS BUILT FROM, on every panel that was built.

     The vendor's page ceiling is 500 contracts and a wide name has more than
     that, so a surface can be complete-looking and drawn from a slice. A panel
     that does not carry its own coverage lets a reader mistake "these are the
     strikes that fit on one page" for "these are the strikes". The filter is
     stated for the same reason: the leg excludes zero-open-interest chains,
     which is a selection rather than a fact about the market. */
  if (panel.status !== "ok") return panel;
  return {
    ...panel,
    /* THE OPEN-INTEREST BASIS CHECK TRAVELS WITH THE TABLE THAT PRINTS THE
       COLUMN IT JUDGES, and only with that table.

       shared/flows-chain.js runs this on every chain because it is arithmetic
       over rows already in memory, and until now the pipeline logged one of
       them and published none. That left the reader holding a caption which
       claimed the open-interest change and the volume span the same interval,
       on a page that had already measured names where they cannot — an
       open-interest change larger than the contract's own volume is not
       possible across one settlement, so any such row falsifies the pairing.
       Publishing the measurement is what lets the caption say what was found
       for THIS name instead of asserting a general alignment nothing checked.

       Three panels do not carry it: only `topContracts` prints the column.
       Publishing a field the other three never read would be shape noise the
       payload/renderer contract would have to carry forever. */
    ...(key === "topContracts" && chain.oiBasis
      ? { oiBasis: oiBasisReading(chain.oiBasis) }
      : {}),
    coverage: {
      truncated: chain.truncated === true,
      /* THREE COUNTS, NOT ONE, because they are three different populations
         and a renderer holding only the middle one cannot explain itself.
         `rowsReturned` is what the vendor sent and is what `truncated` is
         decided on; `rowsSeen` is what survived the adjusted-series filter;
         `pricedRows` is what carried a live bid and reached the surface. A
         card publishing "a full page of 500 contracts" beside rowsSeen 499
         looks like a contradiction until the first of these is present. */
      rowsReturned: numOrNull(chain.rowsReturned),
      rowsSeen: numOrNull(chain.rowsSeen),
      pricedRows: numOrNull(chain.pricedRows),
      filter: "contracts with no open interest are excluded upstream by the vendor",
    },
  };
}

/**
 * One second-order Greek term structure, in the card's own status vocabulary.
 *
 * THE CARD BOUNDARY HAS EXACTLY TWO STATES, and this maps onto them rather
 * than widening them. Every panel here is `ok` or `unavailable` — an
 * invariant the source-ablation sweep asserts over every panel on every
 * ablation, because the renderer switches on status before it touches a
 * number. greekTermStructure distinguishes three silences internally (the
 * vendor sent no such leg / the leg was there but nothing was readable /
 * rows survived), which is the right resolution AT THE SHAPER. Emitting that
 * third state here would have failed a test that exists for a good reason,
 * and the correct response to that is to map, not to widen the test so the
 * new code passes.
 *
 * NO INFORMATION IS LOST IN THE MAPPING: the two dead states carry different
 * REASON strings, which is how every other dead panel on this card already
 * tells its story. What is missing is a machine-readable tag distinguishing
 * them, and that is a real gap — the card's shared renderer hardcodes
 * "Unavailable." for every non-ok status and sets no data-empty attribute, so
 * no suite can tell these two apart without matching on prose. That is one
 * defect, in one place, and it belongs to the renderer rather than here;
 * fixing it widens this union deliberately and for every panel at once.
 */
function greekPanel(name, expiries, callLeg, putLeg, sessionDate) {
  const built = greekTermStructure(expiries, { name, callLeg, putLeg, asOf: sessionDate });
  if (built.status === "ok") return built;
  return {
    status: "unavailable",
    reason: built.reason || `no ${name} exposure was readable on this response`,
    /* The unit rides even on a dead panel: a reader who sees the heading
       still learns what the number would have been measured in. */
    unit: built.unit,
    rows: [], legs: built.legs,
  };
}

/**
 * THE COHORT THIS NAME WAS COMPARED AGAINST — named, sized, and ranked.
 *
 * A 21-PANEL WORKSPACE THAT COULD NOT SAY WHO THE NAME WAS MEASURED AGAINST.
 * `grep -c "peer\|sector" shared/flows-card.js` returned zero. The published
 * score is a cross-sectional residual with sector and log-capitalisation
 * neutralised out before ranking — that sentence appears on four surfaces —
 * and the page a reader opens to understand one name could not tell them
 * which cohort the "cross-section" was, how many names were in it, or whether
 * this name's sector had so few members that it was pooled into the reference
 * bucket rather than given a level of its own.
 *
 * THE QUESTION THIS ANSWERS, and it is the obvious follow-up to every strong
 * reading on the page: is my top long simply the strongest name in a sector
 * that is being bought wholesale? A reader told "+71, sector neutralised"
 * cannot ask it. A reader told "+71, rank 1 of 9 in Technology, whose median
 * is +3" has the answer in the same glance — and a reader told "+71, rank 1
 * of 9, whose median is +58" has a very different answer and needs it more.
 *
 * WHAT THE SCORES HERE ARE, because getting this wrong would make the panel
 * worse than nothing: they are the PUBLISHED, POST-NEUTRALISATION scores —
 * the same numbers every other surface prints. Neutralisation removes the
 * cohort's LINEAR mean, so a cohort median near zero is the ordinary outcome
 * and is not a finding. A median far from zero is: it means the adjustment
 * did not absorb the cohort's tilt, which happens when the level was pooled
 * for being under `minGroup`, when the cohort is small enough that its mean
 * is noise, or when the tilt is not linear in the terms that were removed.
 * That is a fact about the SCORE rather than about the sector, and the panel
 * says so rather than inviting the reader to read a sector call out of it.
 *
 * POOLED IS NOT MISSING. A name whose sector had fewer than `minGroup`
 * members was not left un-neutralised; it was folded in with every other
 * small level into one reference bucket, so it WAS adjusted — against a
 * cohort that is not its sector. Rendering that as "no cohort" would be a
 * lie in the reassuring direction, and it is the case a reader most needs
 * flagged, because the name's score carries an adjustment estimated off names
 * it has nothing to do with.
 *
 * @param {object}   input
 * @param {string}   input.ticker    The name this card is for.
 * @param {string}   input.sector    Its sector label, as the scorer saw it.
 * @param {Array}    input.peers     [{t, s}] for every name in the same
 *                                   neutralisation level, this name included.
 * @param {number}   input.minGroup  The pooling floor the scorer used.
 * @param {boolean}  input.pooled    Whether this level was pooled into the
 *                                   reference bucket. Passed rather than
 *                                   re-derived: the scorer's own rule decides
 *                                   it, and a second implementation of that
 *                                   rule here is a second thing to drift.
 */
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
    /* A PEER WITH NO SCORE IS NOT A PEER WITH A SCORE OF ZERO. Zero sits at
       the centre of the dead band and is a reading this pipeline assigns, so
       coercing an absent one would move the cohort's median toward a value
       nobody measured — and the median is the number this panel is read for. */
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
    /* MEASURED, AND THIS NAME IS NOT IN IT. Not an error and not an absence:
       a card can be built for a name the scorer dropped after the cohort was
       assembled, and the honest reading is the cohort's own shape with this
       name stated as absent from it rather than a rank invented for it. */
    return quiet(
      "this name is not in the scored cohort that was carried in, so it has no " +
      "rank within it. The cohort held " + rows.length +
      (rows.length === 1 ? " name" : " names") + " and this was not one of them");
  }

  /* The median of an even-length list is the mean of the two middle values —
     written out rather than reached for, because the off-by-one is the whole
     of it and a list of two would otherwise report its larger member. */
  const mid = rows.length >> 1;
  const median = rows.length % 2
    ? rows[mid].s
    : (rows[mid - 1].s + rows[mid].s) / 2;

  const self = rows[at].s;
  /* HOW MUCH OF THE COHORT AGREES WITH THIS NAME, which is the wholesale
     question stated as a count. Names at exactly zero belong to neither side
     and are counted apart rather than assigned to one: zero is the centre of
     the dead band and is a reading, so folding it into "agrees" or
     "disagrees" would invent a position it does not hold. */
  let sameSide = 0, otherSide = 0, neutral = 0;
  for (const r of rows) {
    if (r.s === 0 || self === 0) { if (r.s === 0) neutral++; continue; }
    if (Math.sign(r.s) === Math.sign(self)) sameSide++; else otherSide++;
  }

  return ok({
    sector: sector === null || sector === undefined || sector === "" ? null : String(sector),
    /* NULL, NOT FALSE, when the caller did not say. "This level was not
       pooled" and "nobody told this panel whether it was" are different
       facts, and the second must not render as the first — pooling is the
       case a reader most needs flagged. */
    pooled: pooled === null || pooled === undefined ? null : !!pooled,
    minGroup: numOrNull(minGroup),
    n: rows.length,
    /* One-based, to match every other rank this product prints. */
    rank: at + 1,
    score: self,
    median,
    best: rows[0].s,
    worst: rows[rows.length - 1].s,
    sameSide, otherSide, neutral,
    /* THE COHORT ITSELF, CAPPED AND SAID TO BE CAPPED. A reader who cannot
       see the nine names that made the median has been given a number to
       trust rather than a comparison to check. Twelve is the card's own
       convention for a peer list and the payload states the cut. */
    rows: rows.slice(0, COHORT_ROWS),
    shown: Math.min(rows.length, COHORT_ROWS),
    notes: COHORT_NOTES,
  });
}

/** How many peers a cohort panel carries. A cut, stated on the payload. */
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

export function buildCard({
  ticker, row, features, strikes, ticks, expiries, maxPain, congress, surface,
  chain, generatedAt, sessionDate, weights,
  /* The wave-2 per-name raws. `null` means the fetch itself failed and the
     panel says unavailable-with-reason; `[]` means the vendor answered with
     nothing and the panel says quiet — the three-silences rule at the card
     boundary. Cards from before these existed simply lack the keys, which
     is the same transitional story the chain panels told. */
  darkpool = null, oiDeltas = null, termStructure = null, ivRank = null,
  /* THIS NAME'S SCORE HISTORY, out of the scoretrack payload the pipeline has
     already built by the time it reaches the card loop. `{ sessions, scores,
     deadBand }` — sessions is the track's own dated calendar and scores is
     index-aligned to it, exactly as the track publishes them.

     null means the track was not read this run, which is an ORDINARY state:
     the track leg walks the dated archive and can be skipped or fail without
     costing any other panel. */
  scoreHistory = null,
}) {
  const f = features || {};
  const spot = numOrNull(row && row.close) ?? numOrNull(features && features.spot);
  const gamma = buildGammaProfile(strikes, { spot });
  const painRow = pickMaxPainRow(maxPain, { asOf: sessionDate });
  const prev = numOrNull(row && row.prev_close);
  const close = numOrNull(row && row.close);

  /* BUILT BEFORE THE RETURN because two panels need it: `context` publishes
     it, and `scoreOverlay` joins the score history onto its dated closes. A
     second call would build it twice and, worse, let the two drift if either
     ever took an argument the other did not. */
  const contextPanel = buildContext({
    closes: f.closes,
    closeDates: f.closeDates,
    r5: f.r5, r21: f.r21, r42: f.r42,
    week52Pos: f.week52Pos,
    changePct: prev !== null && prev > 0 && close !== null ? (close - prev) / prev : null,
  }, { asOf: sessionDate });

  return {
    v: CARD_SCHEMA_VERSION,
    ticker,
    generatedAt: generatedAt || null,
    // The trading session the DATA describes, which is not the day the job
    // ran: a pre-open run reads the previous completed session.
    sessionDate: sessionDate || null,
    score: numOrNull(features && features.score),
    conviction: numOrNull(features && features.conviction),
    fam: f.fam || null,
    /* THE WEIGHTS THE SCORE WAS BUILT FROM. Without them the family bars are
       five numbers with no stated relationship to the headline, and a reader
       cannot tell that one axis carried half the board and another a tenth. */
    weights: weights || null,
    /* THE COMPOSITE'S OWN ARITHMETIC, complete enough to be re-done.

       `conviction` above is 0.45·agreement + 0.35·coverage + 0.20·persistence
       rounded to an integer, and this block used to publish two of those three
       terms — so the number could be described but not checked, and the third
       term could move a published 76 to a published 87 with nothing on the
       card accounting for the difference.

       THE WEIGHTS SHIP TOO. A renderer that restated 0.45/0.35/0.20 in its own
       prose would be a second copy of a constant that has already moved once,
       and when the two disagree the page describes arithmetic the pipeline did
       not do. `coverage` here is the CLAMPED value the sum used, not the raw
       measurement, for the same reason: a reconstruction has to close.

       The shape matters as much as the terms. `agreement` is agree/present
       over at most three signed families — a count over a count, which steps
       rather than varying smoothly — and it carries the heaviest weight while
       the other two are continuous. A reader given only the composite cannot
       tell a step from a change of degree, which on the emitted corpus is the
       difference between the 60-66, 75-82 and 90-96 clusters and the spread
       inside each. */
    conv: {
      agreement: numOrNull(f.agreement),
      breadth: numOrNull(f.breadth),
      coverage: numOrNull(f.convCoverage !== undefined ? f.convCoverage : f.coverage),
      persistence: numOrNull(f.convPersistence),
      weights: CONVICTION_WEIGHTS,
      gate: numOrNull(f.gate),
    },
    /* THE TWO REASONS THE GATE SUPPRESSED THIS NAME, as numbers rather than
       as one digit under the O gauge.
       
       positioningQuality computes both, the scorer gates on both, and POLARITY
       has carried an entry for each since before this line existed — a
       reserved entry for a field the card never published, which is the shape
       this repository's unrendered quantities keep taking. Folded into O they
       are unrecoverable: a name whose flow is 95% out-of-the-money lottery
       tickets and a name whose participant is trading vol rather than
       direction reach the reader as the same middling gauge, and the two call
       for opposite handling.

       Both are unit-free ratios of gross sums with no free parameter:
       otmShare is |otm directional delta| over |directional delta|, in [0,1]
       by construction, and vegaTilt is gross vega flow per unit of gross delta
       flow. numOrNull, not zero — positioningQuality returns null when there
       is no directional flow to measure, and zero is the TOP of the otmShare
       column once it is oriented, so imputing it rewards a name for having no
       data. That exact substitution has already shipped here twice. */
    quality: {
      otmShare: numOrNull(f.otmShare),
      vegaTilt: numOrNull(f.vegaTilt),
    },
    regime: f.netGamma !== undefined
      ? {
        netGamma: numOrNull(f.netGamma),
        label: f.gRegime || null,
        /* WHICH SIDE OF THE FLIP DEALERS ARE SHORT ON, as data. The panel used
           to assert "short below, long above" as a hardcoded sentence; whether
           that holds depends on the sign of the cumulative at the crossing the
           code actually picked, and on the live board it was frequently the
           other way round. */
        flipSide: f.flipSide || null,
        // Cumulative dealer gamma AT SPOT, as a share of the ladder's peak.
        // Unit-free, so it is comparable across a $35 name and a $900 one.
        spotGammaShare: numOrNull(f.spotGammaShare),
        // How many material crossings the ladder has. More than one means
        // "the gamma flip" is a simplification, and the card should say so.
        crossings: numOrNull(f.flipCount),
        /* How much book the published flip separates, as a share of the
           ladder's peak cumulative. On the live INTC book the sign genuinely
           changes 1.3% from spot, and the long-gamma side carries a tenth of
           the exposure — a reader told only the level would size against a
           boundary that is barely there. */
        flipSeparation: numOrNull(f.flipSeparation),
        bandMin: numOrNull(f.bandMin),
        bandMax: numOrNull(f.bandMax),
      }
      : null,
    // The flip price is the flagship number on the whole card — the gamma
    // panel draws its line from here — so it is a top-level field rather than
    // something the renderer has to dig out of the level list.
    gammaFlip: numOrNull(features && features.gammaFlip),
    atr: numOrNull(features && features.atr),
    panels: {
      gamma,
      /* The joint the profile and the calendar are both marginals of. It is
         built from its own endpoint rather than derived: an outer product of
         two marginals is a model of a surface, not a measurement of one, and
         this project does not publish the difference silently. */
      surface: buildSurface(surface, { spot, asOf: sessionDate }),
      levels: buildLevels({
        spot,
        atr: features && features.atr,
        gammaFlip: features && features.gammaFlip,
        // The SAME row the priced-move panel resolved — dated, so an expiry
        // from the vendor's 120-day window that has already passed does not
        // reach the rail as a live level.
        maxPain: painRow ? painRow.px : null,
        callWall: gamma.status === "ok" ? gamma.callWall : null,
        putWall: gamma.status === "ok" ? gamma.putWall : null,
      }),
      /* THE OPTION CHAIN'S FOUR PANELS, built in shared/flows-chain.js from the
         one /option-contracts call the chain leg spends per board name.

         They are `unavailable` with a reason on any card the leg could not
         reach — a name whose chain came back empty, a run that hit the
         deadline before this name's turn, or any session before the leg
         shipped. A renderer that has not been written yet simply has no host
         for them, and a payload from before they existed carries the key not
         at all, which is the same transitional story every other panel here
         already tells. */
      /* THE SCORE LAID OVER THE PRICE IT WAS SCORED AGAINST, joined by date.

         `scoreHistory` is this name's row out of the scoretrack payload plus
         that payload's session calendar — the pipeline holds both by the time
         it builds cards, so the join is done once here rather than in a
         browser. shared/flows-overlay.js states why the join is a named
         operation: both series are about forty points and both run oldest
         first, so an index zip draws a plausible chart out of two windows
         that need not describe the same days. */
      scoreOverlay: scoreOverlayPanel(scoreHistory, contextPanel),
      ivSurface: chainPanel(chain, "ivSurface"),
      skewTerm: chainPanel(chain, "skewTerm"),
      topContracts: chainPanel(chain, "topContracts"),
      aggressor: chainPanel(chain, "aggressor"),
      path: buildPath(ticks, { sessionDate }),
      calendar: buildCalendar(expiries, { asOf: sessionDate }),
      /* THE FIVE LEGS THE GAMMA CALL ALREADY PAID FOR.

         `expiries` is one /greek-exposure/expiry response carrying call/put
         pairs for gex, delta, charm AND vanna. buildCalendar above reads the
         gamma pair; until now the other six were parsed by JSON.parse and
         dropped on the floor, once per name, every run.

         Charm is why pinning accelerates into a Friday close — dollar-delta
         bleeding out with time alone, spot unchanged. Vanna is why a vol
         crush forces mechanical delta buying at unchanged spot. Neither is
         visible in a gamma ladder, and both are named in this product's own
         brief. They cost nothing here: no vendor call, no deadline, no
         rate-limit budget, just a second read of a response already in hand.

         Each is ABSENT rather than empty when the vendor sends no such leg,
         so a response without vanna says so instead of drawing a flat line a
         reader takes for a book with no vanna in it. And the two legs are
         never netted: the put leg's sign convention differs BY GREEK on this
         endpoint, so a single netting rule would invert one of them. */
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
      congress: buildCongress(congress, { asOf: sessionDate }),
      darkpool: stockPanel(darkpool, shapeStockDarkpool, STOCK_NOTES.darkpool),
      oiDeltas: stockPanel(oiDeltas, shapeStockOiChange, STOCK_NOTES.oiDeltas),
      volContext: darkNull(termStructure) && darkNull(ivRank)
        ? { status: "unavailable", reason: "neither volatility feed could be read this run",
            note: STOCK_NOTES.volContext }
        : { ...buildVolContext(termStructure || [], ivRank || []), note: STOCK_NOTES.volContext },
    },
  };
}

/* A raw of null is a failed READ; a raw of [] is a vendor answering nothing.
   The panels keep those apart because the pages must say different
   sentences for them. */
const darkNull = (raw) => raw === null || raw === undefined;

function stockPanel(raw, shaper, note) {
  if (darkNull(raw)) {
    return { status: "unavailable", reason: "the feed could not be read this run", note };
  }
  return { ...shaper(raw), note };
}

/**
 * The nearest expiry's max pain, with its expiry. The array is one row per
 * expiry.
 *
 * MAX PAIN IS A LEVEL, NOT A TARGET. It is the strike minimising aggregate
 * option-holder value against TODAY'S open interest — a statement about the
 * current book, recomputed every session, with no mechanism that moves price
 * toward it. The card ranks it beside the walls as another level, and never
 * as a forecast.
 */
export function pickMaxPainRow(rows, { asOf = null } = {}) {
  const parsed = (rows || [])
    .map((r) => ({ expiry: r.expiry, px: numOrNull(r.max_pain) }))
    .filter((r) => r.expiry && r.px !== null)
    .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  if (!parsed.length) return null;
  /* THE NEAREST LIVE EXPIRY, not the first row.

     The vendor documents /max-pain as returning "the max pain for all
     expirations for the given ticker for the last 120 days", so the array can
     carry expiries that have already passed. Sorting ascending and taking
     rows[0] therefore took the OLDEST — up to four months stale — and drew it
     on the levels rail beside spot as though it were a level that still
     existed. No fixture supplied a past expiry, so nothing caught it. */
  if (asOf) {
    const live = parsed.filter((r) => String(r.expiry).slice(0, 10) >= String(asOf).slice(0, 10));
    if (live.length) return live[0];
    // Every expiry on file has passed: there is no live max pain to report.
    return null;
  }
  return parsed[0];
}

export function pickMaxPain(rows, options) {
  const row = pickMaxPainRow(rows, options);
  return row ? row.px : null;
}

/* =============================================================
   THE SPOT GAMMA SURFACE — strike x expiry

   The gamma profile answers "where is the dealer book long or
   short" and collapses the term structure to do it. The roll-off
   calendar answers "when does that book expire" and collapses the
   strikes. Both are marginals of the same joint distribution, and
   the joint is the thing worth looking at: a put wall that
   evaporates on Friday and one that runs to January are the same
   number on the profile and completely different trades.

   /spot-exposures/expiry-strike returns that joint in ONE call —
   "Spot GEX exposures by strike & expiry", with expirations[] as an
   array parameter, so the horizon is a choice rather than a call
   count. Its legs carry the SAME names the strike ladder uses:
   call_gamma_ask, call_gamma_bid, call_gamma_oi, call_gamma_vol and
   the put equivalents. That is why this reuses buildGammaProfile's
   summing convention exactly rather than inventing a second one —
   the put legs arrive ALREADY dealer-signed, so all four are SUMMED,
   and summing this surface across expiries has to reproduce the
   profile. The tests assert that reconciliation, because two views
   of one book that disagree are worse than one view.

   THE COLOUR SCALE IS CAPPED, AND SAYS SO. A single ATM cell on the
   front expiry routinely carries more gamma than the rest of the
   grid combined; scaling to the maximum paints one red square on a
   field of grey and hides the structure the panel exists to show.
   The cap is a high quantile of the non-zero magnitudes, cells
   beyond it are drawn at full saturation, and `scaleCap` and
   `clipped` both ship so the renderer can mark them rather than
   quietly flattening them.
   ============================================================= */

/** Rows per side of spot to keep. An odd total, so spot's own row is centred. */
const SURFACE_STRIKES = 21;
export const SURFACE_EXPIRIES = 8;

export function buildSurface(rows, {
  spot, maxStrikes = SURFACE_STRIKES, maxExpiries = SURFACE_EXPIRIES, asOf = null,
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return unavailable("no expiry-strike gamma");
  const s = numOrNull(spot);
  if (s === null || !(s > 0)) return unavailable("no spot");

  /* THE SAME FOUR LEGS, SUMMED, as buildGammaProfile. A row with none of them
     measured is dropped rather than counted as a zero cell: an unmeasured
     strike-expiry pair and one carrying no gamma look identical once a
     fallback zero is written into the grid, and only one of them is a fact. */
  const cells = new Map();                 // expiry -> Map(strike -> gamma)
  const strikeTotals = new Map();
  const expirySeen = new Map();            // expiry -> gross magnitude, for ranking

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

  /* EXPIRIES ARE TAKEN IN DATE ORDER, NOT BY SIZE. Keeping the eight largest
     would produce a column axis with holes in it that still reads as
     consecutive — a January LEAP drawn next to this Friday, with nothing
     saying six weeks were skipped. The horizon is the near end of the term
     structure, which is also where the hedging happens. */
  const expiries = Array.from(cells.keys()).sort().slice(0, maxExpiries);

  /* STRIKES ARE TAKEN AROUND SPOT, not by size either, and for the same
     reason: the grid's vertical axis is a price ladder and a ladder with
     rungs missing is not a ladder. */
  const allStrikes = Array.from(strikeTotals.keys()).sort((a, b) => a - b);
  let nearest = 0;
  for (let i = 1; i < allStrikes.length; i++) {
    if (Math.abs(allStrikes[i] - s) < Math.abs(allStrikes[nearest] - s)) nearest = i;
  }
  const half = Math.floor(maxStrikes / 2);
  let from = Math.max(0, nearest - half);
  let to = Math.min(allStrikes.length, from + maxStrikes);
  from = Math.max(0, to - maxStrikes);                 // refill when spot sits at an edge
  const strikes = allStrikes.slice(from, to);
  if (!strikes.length || !expiries.length) return unavailable("no strikes in band");

  const grid = strikes.map((k) => expiries.map((e) => {
    const col = cells.get(e);
    const v = col ? col.get(k) : undefined;
    return v === undefined ? null : v;     // null is "not measured", never 0
  }));

  /* The capped colour scale. Quantile over NON-ZERO magnitudes: a grid that is
     mostly empty would otherwise put the quantile at zero and saturate every
     cell that carries anything at all. */
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

  /* WALLS ARE READ OFF THE ROW MARGINAL, over the strikes actually drawn.
     Taking them from the full ladder would name a call wall the grid does not
     contain, which is a label pointing off the edge of its own picture. */
  let callWall = null, putWall = null;
  for (const k of strikes) {
    const total = strikeTotals.get(k) ?? 0;
    if (total > 0 && (callWall === null || total > callWall.gamma)) callWall = { strike: k, gamma: total };
    if (total < 0 && (putWall === null || total < putWall.gamma)) putWall = { strike: k, gamma: total };
  }

  return ok({
    spot: s,
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
    /* How much of the term structure is on screen. A surface showing 8 of 40
       expiries is a window, and a window that does not say so reads as the
       whole book. */
    expiriesShown: expiries.length,
    expiriesTotal: cells.size,
    strikesShown: strikes.length,
    strikesTotal: allStrikes.length,
  }, asOf);
}
