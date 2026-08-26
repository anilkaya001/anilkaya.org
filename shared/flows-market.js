/**
 * THE MARKET LEVEL — the one reading this section could not previously give.
 *
 * Every other surface in Flows is a RESIDUAL. The board score is a name's
 * position within the day's cross-section after sector and log-capitalisation
 * have been deliberately neutralised out, which is what makes it a comparison
 * between names rather than a bet on the tape. That design has a consequence
 * nobody can argue their way around: a board reporting that fifty names lean
 * bullish is structurally incapable of saying whether the tape as a whole was
 * bought or sold, because the level was removed on purpose before the ranking
 * was taken.
 *
 * This module reads the level. It is the complement to the board, not a
 * second opinion about it.
 *
 * EVERY NUMBER HERE COSTS NOTHING. The rows are the screener response the
 * universe was built from and are already in memory; no endpoint is called.
 *
 * IT IS NOT "THE MARKET", AND THE VOCABULARY MUST NEVER SAY SO. The screener
 * caps at ~50 rows per market-cap band, so the population is the names this
 * run's band ladder returned and its gate admitted — a screened universe, and
 * every label on the page says exactly that.
 */

/** Present on the wire. NOT num(), whose zero-fallback is the whole hazard. */
const onWire = (v) => v !== undefined && v !== null && v !== "";

/** A finite number, or null. Never a fallback zero. */
function numOrNull(v) {
  if (!onWire(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const round = (v, dp) => (v === null ? null : Number(v.toFixed(dp)));

/**
 * A ratio of two sums over ONE population.
 *
 * Joint presence is not pedantry. The sum of put volume over the names that
 * quoted put volume, divided by the sum of call volume over the names that
 * quoted call volume, is not a ratio of anything — it is two numbers divided,
 * and it moves when a name drops one leg. The population is therefore the
 * names that quoted BOTH, and its size is published so a reader can see how
 * much of the universe the ratio speaks for.
 */
function jointRatio(rows, numKey, denKey) {
  let num = 0, den = 0, n = 0;
  for (const row of rows) {
    const a = numOrNull(row && row[numKey]);
    const b = numOrNull(row && row[denKey]);
    if (a === null || b === null) continue;
    num += a; den += b; n++;
  }
  return { ratio: den > 0 ? num / den : null, n };
}

/**
 * The market aggregate.
 *
 * `tiltsByTicker` is passed rather than re-read from the row, and that is
 * load-bearing: `iv_rank` arrives on 0..100 while `screenerTilt().ivRank` is a
 * FRACTION, because the vendor's own schema misdeclares the field and this
 * repository has already published "1352% of its year" once. Re-reading the
 * raw column here would put one quantity on two scales, a factor of a hundred
 * apart, on two surfaces of the same site.
 */
export function marketAggregate(eligibleRows, tiltsByTicker = new Map(), { screened = null } = {}) {
  const rows = Array.isArray(eligibleRows) ? eligibleRows.filter(Boolean) : [];
  const n = rows.length;

  /* ---- net premium, and the presence rule that is the whole correctness
     argument of this file ------------------------------------------------

     moverRow gates net premium on `onWire(call) || onWire(put)` and then
     subtracts with a zero fallback. On THAT surface the disjunction is
     survivable, because a one-legged row's value only ever enters a ranking of
     extremes, where a spurious near-zero lands in neither tail.

     Here the same rule would publish a MEASURED ZERO. A row quoting a call leg
     and no put leg would contribute (call − 0) to a signed total, and a row
     quoting `net_call_premium: "0"` alone would be counted in `flat` — that is,
     published as a name whose call and put premium were equal, when one side
     was never quoted at all. So nu is defined only where BOTH legs are on the
     wire, and the one-legged rows are counted beside the aggregate rather than
     folded into it. */
  const nu = [];
  let oneLegged = 0;
  for (const row of rows) {
    const call = numOrNull(row.net_call_premium);
    const put = numOrNull(row.net_put_premium);
    if (call === null && put === null) continue;
    if (call === null || put === null) { oneLegged++; continue; }
    nu.push(call - put);
  }

  let netPositive = 0, netNegative = 0, gross = 0, net = 0;
  let bull = 0, bear = 0, flat = 0;
  for (const v of nu) {
    net += v;
    gross += Math.abs(v);
    if (v > 0) { netPositive += v; bull++; } else if (v < 0) { netNegative += -v; bear++; } else flat++;
  }

  /* THE CONCENTRATION READING. A market-wide total is the one number a single
     takeover print can own, so the share the five largest absolute movements
     account for is published beside it. Without this, "the tape bought calls"
     and "one name bought calls" are the same sentence. */
  const top5 = [...nu].map(Math.abs).sort((a, b) => b - a).slice(0, 5);
  const topShare = gross > 0 ? top5.reduce((s, v) => s + v, 0) / gross : null;

  const pcrVolume = jointRatio(rows, "put_volume", "call_volume");
  const pcrPremium = jointRatio(rows, "put_premium", "call_premium");

  /* ---- the aggressor split ------------------------------------------------
     Summed over the names that quoted BOTH sides of a leg, so the lift's
     numerator and denominator describe the same population. */
  const legs = { callAsk: 0, callBid: 0, putAsk: 0, putBid: 0 };
  let aggressorRows = 0;
  for (const row of rows) {
    const ca = numOrNull(row.call_volume_ask_side), cb = numOrNull(row.call_volume_bid_side);
    const pa = numOrNull(row.put_volume_ask_side), pb = numOrNull(row.put_volume_bid_side);
    if (ca === null || cb === null || pa === null || pb === null) continue;
    legs.callAsk += ca; legs.callBid += cb; legs.putAsk += pa; legs.putBid += pb;
    aggressorRows++;
  }
  const lift = (ask, bid) => (ask + bid > 0 ? ask / (ask + bid) : null);

  /* ---- the volatility level ----------------------------------------------
     A MEDIAN, not a mean: one name at 300% implied vol would own a mean of two
     hundred, and this column exists to describe where the middle of the
     screened universe sits. */
  const ivs = rows.map((r) => numOrNull(r.iv30d)).filter((v) => v !== null && v > 0).sort((a, b) => a - b);
  const ranks = rows
    .map((r) => {
      const t = tiltsByTicker.get(r.ticker);
      return t && Number.isFinite(t.ivRank) ? t.ivRank : null;
    })
    .filter((v) => v !== null).sort((a, b) => a - b);
  const median = (a) => (a.length ? (a.length % 2
    ? a[(a.length - 1) / 2]
    : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null);

  return {
    n,
    screened: Number.isFinite(screened) ? screened : null,
    premium: {
      /* NAMED FOR WHAT THE ARITHMETIC DOES. These are the sums of positive and
         negative NET premium — not call premium and not put premium, both of
         which are separate screener columns a reader could hold beside these
         and have no way to know are unrelated. */
      netPositive: nu.length ? Math.round(netPositive) : null,
      netNegative: nu.length ? Math.round(netNegative) : null,
      net: nu.length ? Math.round(net) : null,
      priced: nu.length,
      oneLegged,
      tilt: gross > 0 ? round(net / gross, 4) : null,
      topShare: round(topShare, 4),
    },
    breadth: {
      bull, bear, flat,
      unpriced: n - nu.length,
      /* THE SAME FUNCTIONAL FORM AS premium.tilt UNDER A DIFFERENT WEIGHTING —
         equal-weight here, dollar-weight there. Publishing both is what removes
         the weighting choice instead of burying it, and their DISAGREEMENT is
         the most informative reading on the page: breadth positive with premium
         negative is a lot of small buying against a little large selling. */
      tilt: bull + bear > 0 ? round((bull - bear) / (bull + bear), 4) : null,
    },
    pcr: {
      volume: round(pcrVolume.ratio, 4),
      premium: round(pcrPremium.ratio, 4),
      quotedVolume: pcrVolume.n,
      quotedPremium: pcrPremium.n,
    },
    aggressor: {
      callAsk: aggressorRows ? Math.round(legs.callAsk) : null,
      callBid: aggressorRows ? Math.round(legs.callBid) : null,
      putAsk: aggressorRows ? Math.round(legs.putAsk) : null,
      putBid: aggressorRows ? Math.round(legs.putBid) : null,
      callLift: aggressorRows ? round(lift(legs.callAsk, legs.callBid), 4) : null,
      putLift: aggressorRows ? round(lift(legs.putAsk, legs.putBid), 4) : null,
      quoted: aggressorRows,
    },
    vol: {
      iv30dMedian: round(median(ivs), 4),
      iv30dQuoted: ivs.length,
      /* A FRACTION IN [0,1], from screenerTilt, never the raw column. */
      ivRankMedian: round(median(ranks), 4),
      ivRankQuoted: ranks.length,
    },
  };
}

/**
 * The prose the payload carries, published verbatim beside the numbers.
 *
 * These are not captions a renderer may reword. They are the statements that
 * make the numbers legible, and they live with the arithmetic so the two
 * cannot drift.
 */
export const MARKET_NOTES = Object.freeze({
  population:
    "Every reading on this page is over the SCREENED UNIVERSE — the names this " +
    "run's market-cap band ladder returned and the universe gate admitted — not " +
    "over the market. The vendor's screener caps each band at about fifty rows, " +
    "so the population is bounded by how the ladder was walked.",
  presence:
    "Net premium is measured only where BOTH the call and the put leg were " +
    "quoted. A name quoting one leg is counted separately and never folded into " +
    "a total: treating an unquoted leg as a zero would publish a name as balanced " +
    "when one side was never reported.",
  weighting:
    "Breadth counts names; premium tilt weights them by dollars. They are the " +
    "same ratio under two weightings, published together so the choice is visible " +
    "rather than made silently. When they disagree in sign, that is the reading.",
  concentration:
    "A market-wide total is a number one large print can own, so the share of " +
    "gross net premium accounted for by the five largest names is published " +
    "beside it.",
  aggressor:
    "Lift is the share of volume that traded at the offer, over the names that " +
    "quoted both sides. It describes which side of the quote was hit — not who " +
    "was buying, and not why.",
  refused:
    "No probability, no forecast, and no direction is claimed for the market. " +
    "These are sums and ratios of quoted numbers over a stated population.",
});
