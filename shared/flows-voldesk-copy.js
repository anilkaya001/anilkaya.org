export const COPY = Object.freeze({
  "title.tab": "Vol desk",
  "title.term": "Index term structure",
  "title.ivrv": "Implied against realised",
  "title.matrix": "Correlation",
  "title.character": "Volatility character",
  "title.xcheck": "Engine cross-check",
  "state.contango": "Contango: 90-day implied above 30-day.",
  "state.backwardation": "Backwardation: 30-day implied above 90-day.",
  "state.flat": "Flat: 30-day and 90-day implied within half a point.",
  "futures.unshaped": "The feed's futures table has not been read by the shape probe yet.",
  "futures.plan": "The futures table needs a feed plan the site does not hold.",
  "futures.roll": "Second month {sign}{x}% against the front, per 30 days.",
  "ivrv.line": "Implied {iv}, realised over 21 sessions {rv}, spread {sign}{s} points.",
  "ivrv.place": "Implied at {p}% of its 1-year range.",
  "ivrv.stale": "Realised as of {date}, the feed's latest.",
  "matrix.cell": "{a} and {b}: {r} over {rows} sessions, {from} to {to}.",
  "matrix.asym": "The feed gave two values for this pair, so it is withheld.",
  "matrix.absent": "The feed returned no value for this pair.",
  "matrix.avg": "Sector ETF average {r} over {n} pairs.",
  "matrix.few": "Too few pairs for a sector average.",
  "matrix.site": "Site's Nasdaq-100 implied correlation {i}, realised {r}; different baskets.",
  "character.first": "Movers start after the second night this table is read.",
  "character.unshaped": "The feed's character table has not been read by the shape probe yet.",
  "character.def": "Half-life: sessions for a volatility shock to halve.",
  "character.hurst": "Hurst above 0.5 persists; below 0.5 reverts.",
  "xcheck.what": "The feed's own figures, checked against the site's engine.",
  "xcheck.agree": "Agrees within tolerance on {n} checks.",
  "xcheck.differs": "Differs on {n} of {m} checks.",
  "xcheck.nc": "Not compared: {reason}.",
  "xcheck.units.1pct": "The feed's gamma reads as per 1% move, so it is not compared.",
  "xcheck.units.none": "The feed does not state gamma's unit; its figures match neither.",
  "xcheck.stale": "Last audited {date}; names rotate through the audit.",
  "xcheck.never": "Not audited in the last five sessions.",
  "xcheck.convention": "Delta conventions can differ by the dividend discount; tolerance covers it.",
  "xcheck.self": "Feed against feed: its chain and its at-the-money table.",
  "state.pending": "Tonight's run has not published this yet.",
  "state.failed": "The feed's {what} read failed tonight; this is not an empty table.",
});

export const NC_WORDS = Object.freeze({
  engine: "the engine has no fit for this expiry",
  strikes: "fewer than three strikes in common",
  date: "the feed row is from another session",
  "partial chain": "the chain read was partial",
  units: "the gamma unit is not stated",
  absent: "the feed returned nothing",
  failed: "the feed read failed",
  plan: "the feed plan does not include it",
  limited: "the feed was rate limited",
  few: "too few checks",
});

export const ROW_LABELS = Object.freeze({
  spot: "Spot",
  delta: "Delta",
  iv: "IV",
  gamma: "Gamma",
  oiExpiry: "OI expiry",
  oiAll: "OI all",
  dexExpiry: "Delta exposure",
  gexAll: "Gamma exposure",
  chainSelf: "Chain vs ATM",
});

export function say(key, values = {}) {
  const t = COPY[key];
  if (typeof t !== "string") throw new Error(`voldesk copy: no sentence ${key}`);
  return t.replace(/\{([a-z]+)\}/g, (whole, name) => (Object.hasOwn(values, name) ? String(values[name]) : whole));
}
