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

export const PICK_SIZE = "size";
export const PICK_INDEX = "index";

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
