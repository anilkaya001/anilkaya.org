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

export const CARD_SCHEMA_VERSION = 1;

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
     return call_gamma or put_gamma; those belong to /greek-exposure/expiry,
     a different endpoint with a different shape.

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
  });
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

  return ok({
    series,
    netDelta: Math.round(cumD),
    netPremium: Math.round(cumP),
    minutes: rows.length,
    startedAt: new Date(first).toISOString(),
  }, sessionDate);
}

/* ---------- congress ---------------------------------------------- */

const AMOUNT_RANGE = /\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/;

/**
 * Disclosed congressional transactions in this name.
 *
 * Deliberately NOT "congressional buyers", and deliberately without a member
 * track record or an average return. Two reasons, both hard:
 *
 *  - Not computable. /api/congress/congress-trader accepts only limit, date,
 *    ticker and name — no page and no offset — so a member's disclosure
 *    history cannot be walked past the first page at any budget.
 *  - Not a return even if it were. A disclosure reports an OPENING with no
 *    paired closing print, so any "return" attributed to it is invented.
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

  if (!rows.length) return unavailable("no disclosed transactions");
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
export function buildCard({
  ticker, row, features, strikes, ticks, maxPain, congress,
  generatedAt, sessionDate,
}) {
  const spot = numOrNull(row && row.close) ?? numOrNull(features && features.spot);
  const gamma = buildGammaProfile(strikes, { spot });

  return {
    v: CARD_SCHEMA_VERSION,
    ticker,
    generatedAt: generatedAt || null,
    // The trading session the DATA describes, which is not the day the job
    // ran: a pre-open run reads the previous completed session.
    sessionDate: sessionDate || null,
    score: numOrNull(features && features.score),
    conviction: numOrNull(features && features.conviction),
    fam: (features && features.fam) || null,
    regime: features && features.netGamma !== undefined
      ? { netGamma: numOrNull(features.netGamma), label: features.gRegime || null }
      : null,
    // The flip price is the flagship number on the whole card — the gamma
    // panel draws its line from here — so it is a top-level field rather than
    // something the renderer has to dig out of the level list.
    gammaFlip: numOrNull(features && features.gammaFlip),
    atr: numOrNull(features && features.atr),
    panels: {
      gamma,
      levels: buildLevels({
        spot,
        atr: features && features.atr,
        gammaFlip: features && features.gammaFlip,
        maxPain: pickMaxPain(maxPain),
        callWall: gamma.status === "ok" ? gamma.callWall : null,
        putWall: gamma.status === "ok" ? gamma.putWall : null,
      }),
      path: buildPath(ticks, { sessionDate }),
      congress: buildCongress(congress, { asOf: sessionDate }),
    },
  };
}

/** The nearest expiry's max pain. The array is one row per expiry. */
export function pickMaxPain(rows) {
  const parsed = (rows || [])
    .map((r) => ({ expiry: r.expiry, px: numOrNull(r.max_pain) }))
    .filter((r) => r.expiry && r.px !== null)
    .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  return parsed.length ? parsed[0].px : null;
}
