/**
 * WHICH NAMES THE BOARD IS ALLOWED TO SEE.
 *
 * This module exists because of one measurement. On 2026-08-26 the live board
 * published ELEVEN names — six long, five short — and the funnel that produced
 * that number was:
 *
 *     264 screened  ->  205 eligible  ->  190 past the earnings gate
 *  ->   60 enriched ->   23 clear the liquidity floor  ->  11 published
 *
 * Every stage above is defensible on its own and the product of them is a
 * board nobody would call a market view. Two of those stages are the reason,
 * and neither is the board size:
 *
 * THE SCREENER CAP. /api/screener/stocks returns at most ~50 rows and accepts
 * no limit, no page and no offset. The universe is therefore walked in
 * market-cap bands, and with six bands the ceiling on the entire investable
 * universe was 300 names before a single filter ran. Six bands was never a
 * measurement of the market; it was the number of calls that fit a budget.
 *
 * THE ENRICHMENT POOL. Enrichment costs five vendor calls per name, so the
 * pool was 60 — thirty per side of a rough pre-score. That pre-score is the
 * second problem and it is subtler than the first: it selected the extremes of
 * the very tilt columns the real score is built from, so the cross-section the
 * scorer normalised against had already been trimmed to its own tails. A
 * z-score against a pool selected for extreme z-scores is not the quantity its
 * name claims.
 *
 * So the fix is not "raise the number". It is to state a UNIVERSE and score
 * every name in it: a fixed, published, reproducible set chosen WITHOUT
 * reference to the flow being measured. Market capitalisation is that axis. It
 * is observable, it is on the screener row already, it is stable session to
 * session, and — the property that matters — it is independent of the option
 * flow the score reads, so selecting on it cannot bias the cross-section.
 */

/**
 * A disjoint geometric ladder of market-cap bands.
 *
 * WHY GEOMETRIC AND NOT THE SIX HAND-PICKED BANDS IT REPLACES. The vendor's
 * ~50-row cap binds per band, and listed companies are distributed roughly
 * log-uniformly by market cap: there are far more $1-2B names than $200B+
 * ones. A ladder of equal RATIO therefore puts roughly equal pressure on every
 * band's cap, while the old ladder's first band ($1-3B, a 3x span) was
 * saturated at 50 rows and silently truncating the small-cap end of the market
 * on every single run.
 *
 * Bands are half-open [min, max) so a name at a boundary lands in exactly one,
 * and the last is unbounded so nothing above the top is lost. Both properties
 * are asserted rather than described: a ladder with a gap loses names to
 * nobody's band and the loss is invisible in the log, which prints only what
 * each band returned.
 */
export function capBands({ min = 1e9, max = 4e12, ratio = 1.3 } = {}) {
  if (!(min > 0) || !(max > min) || !(ratio > 1)) return [];
  const bands = [];
  let lo = min;
  while (lo < max) {
    const hi = lo * ratio;
    bands.push([lo, hi >= max ? null : hi]);
    if (hi >= max) break;
    lo = hi;
  }
  return bands;
}

/**
 * THE NASDAQ-100, AS A DATED REPOSITORY CONSTANT.
 *
 * No endpoint on this vendor key returns index membership, so this list cannot
 * be measured — it is a CHOICE, and it is published as one, with the date it
 * was written. Anything derived from it carries {choice: true} onto the wire.
 *
 * IT DEGRADES GRACEFULLY, WHICH IS THE ONLY REASON A STALE CONSTANT IS
 * TOLERABLE HERE. This set is used ADDITIVELY: it guarantees inclusion, it
 * never excludes. A name that has since left the index is merely enriched
 * anyway, at the cost of five calls and no wrong number. A name that has since
 * joined is almost certainly inside the market-cap cohort already, because
 * index entry is itself largely a size event. So the failure mode of letting
 * this list rot is a slightly different hundred names, never a wrong reading.
 */
export const NDX_AS_OF = "2026-01-01";

export const NDX_100 = Object.freeze([
  "AAPL", "ABNB", "ADBE", "ADI", "ADP", "ADSK", "AEP", "AMAT", "AMD", "AMGN",
  "AMZN", "ANSS", "APP", "ARM", "ASML", "AVGO", "AXON", "AZN", "BIIB", "BKNG",
  "BKR", "CCEP", "CDNS", "CDW", "CEG", "CHTR", "CMCSA", "COST", "CPRT", "CRWD",
  "CSCO", "CSGP", "CSX", "CTAS", "CTSH", "DASH", "DDOG", "DXCM", "EA", "EXC",
  "FANG", "FAST", "FTNT", "GEHC", "GFS", "GILD", "GOOG", "GOOGL", "HON", "IDXX",
  "INTC", "INTU", "ISRG", "KDP", "KHC", "KLAC", "LIN", "LRCX", "LULU", "MAR",
  "MCHP", "MDB", "MDLZ", "MELI", "META", "MNST", "MRVL", "MSFT", "MSTR", "MU",
  "NFLX", "NVDA", "NXPI", "ODFL", "ON", "ORLY", "PANW", "PAYX", "PCAR", "PDD",
  "PEP", "PLTR", "PYPL", "QCOM", "REGN", "ROP", "ROST", "SBUX", "SNPS", "TEAM",
  "TMUS", "TSLA", "TTD", "TTWO", "TXN", "VRSK", "VRTX", "WBD", "WDAY", "XEL",
  "ZS",
]);

/** Why a name is in the enrichment pool. Rendered, so the words are the wire. */
export const PICK_SIZE = "size";
export const PICK_INDEX = "index";

/**
 * The enrichment pool: the largest `count` names, plus every guaranteed name
 * the universe actually contains.
 *
 * THE ORDER OF THE TWO RULES IS LOAD-BEARING. Size first, then the guarantee
 * set as an ADDITION, means the pool is never smaller than the size cohort and
 * a stale guarantee list can only add names. Guarantee-first with a cap would
 * let a rotten constant push real large caps out of the board, which is the
 * one way a dated list could produce a wrong reading rather than a wasted call.
 *
 * Ties on market cap are broken by ticker so the pool is a pure function of
 * the response and two runs over the same data enrich the same names. An
 * unstable pool would make the archive incomparable session to session for a
 * reason no reader could see.
 */
export function selectCoverage(universe, { count = 100, guaranteed = NDX_100 } = {}) {
  const rows = Array.isArray(universe) ? universe.filter((r) => r && r.ticker) : [];
  const capOf = (r) => {
    const v = Number(r.marketcap);
    return Number.isFinite(v) ? v : -1;
  };
  const bySize = [...rows].sort((a, b) =>
    capOf(b) - capOf(a) || String(a.ticker).localeCompare(String(b.ticker)));

  const picked = new Map();
  for (const row of bySize.slice(0, Math.max(0, count))) {
    picked.set(row.ticker, { row, why: PICK_SIZE });
  }
  const want = new Set(guaranteed || []);
  for (const row of bySize) {
    if (picked.has(row.ticker) || !want.has(row.ticker)) continue;
    picked.set(row.ticker, { row, why: PICK_INDEX });
  }
  return [...picked.values()];
}

/**
 * THE SELECTION EPOCH.
 *
 * The score is a residual against the cross-sectional spread of the pool it
 * was computed over, so the same integer means a different thing under a
 * different pool. Before this date the pool was sixty tilt-extremes that
 * cleared a liquidity floor; after it, a stated size cohort. Both are honest;
 * averaged together they are two experiments reported as one.
 *
 * The track-record scorer PARTITIONS on this date rather than the archive
 * being discarded, because a schema bump would zero 126 days of retained
 * sessions to say a sentence that fits in a footnote.
 */
export const SELECTION_EPOCH = "2026-08-26";

export const UNIVERSE_NOTES = Object.freeze({
  rule:
    "Every name in the screened universe whose market capitalisation puts it in " +
    "the largest hundred, plus any Nasdaq-100 member the screen returned. " +
    "Market cap is the selection axis because it is observable, stable, and " +
    "independent of the option flow being scored — selecting on the flow itself " +
    "would trim the cross-section to its own tails before the score is taken.",
  index:
    "Nasdaq-100 membership is a repository constant dated " + NDX_AS_OF + ", not a " +
    "measurement: no endpoint on this key returns index membership. It is used " +
    "only to ADD names, never to remove them, so a stale list costs calls rather " +
    "than correctness.",
  epoch:
    "Boards published before " + SELECTION_EPOCH + " were drawn from a different pool " +
    "and their scores are not comparable with later ones. The record scorer " +
    "reports the two separately rather than averaging them.",
});
