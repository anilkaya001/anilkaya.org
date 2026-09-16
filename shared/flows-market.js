const onWire = (v) => v !== undefined && v !== null && v !== "";

function numOrNull(v) {
  if (!onWire(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const round = (v, dp) => (v === null ? null : Number(v.toFixed(dp)));

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

export function marketAggregate(eligibleRows, tiltsByTicker = new Map(), { screened = null } = {}) {
  const rows = Array.isArray(eligibleRows) ? eligibleRows.filter(Boolean) : [];
  const n = rows.length;

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

  const top5 = [...nu].map(Math.abs).sort((a, b) => b - a).slice(0, 5);
  const topShare = gross > 0 ? top5.reduce((s, v) => s + v, 0) / gross : null;

  const pcrVolume = jointRatio(rows, "put_volume", "call_volume");
  const pcrPremium = jointRatio(rows, "put_premium", "call_premium");

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

      ivRankMedian: round(median(ranks), 4),
      ivRankQuoted: ranks.length,
    },
  };
}

export const MARKET_NOTES = Object.freeze({
  population:

    "Every reading here is over the SCREENED UNIVERSE and not over the " +
    "market: the " +
    "names this run's band ladder returned and the universe gate admitted. " +
    "The vendor caps each band at about fifty rows, so the population is " +
    "bounded by how the ladder was walked.",
  presence:
    "Net premium is measured only where BOTH legs were quoted. A name " +
    "quoting one leg is counted separately, never folded into a total — " +
    "an unquoted leg treated as a zero would publish a name as balanced " +
    "when one side was never reported.",
  weighting:
    "Breadth counts names; premium tilt weights them by dollars. When they " +
    "disagree in sign, that is the reading.",
  concentration:
    "A market-wide total is a number one large print can own, so the five " +
    "largest names' share of gross net premium is published beside it.",
  aggressor:
    "Lift is the share of volume that traded at the offer, over names that " +
    "quoted both sides. It says which side of the quote was hit — not who " +
    "was buying, and not why.",
  refused:
    "No probability, no forecast and no direction is claimed for the " +
    "market. These are sums and ratios of quoted numbers over a stated " +
    "population.",
});
