export const TITLE = "Flow Lab";

export const SUBTITLE = "Contracts behind today's flow, read from the feed.";

export const DESCRIPTION = "Contracts behind today's option flow, screened, mapped by strike and traced through the session.";

export const TABS = Object.freeze([
  Object.freeze({ id: "screen", label: "Screen" }),
  Object.freeze({ id: "strikes", label: "Strikes" }),
  Object.freeze({ id: "greeks", label: "Greeks" }),
  Object.freeze({ id: "ladders", label: "Ladders" }),
  Object.freeze({ id: "routing", label: "Routing" }),
  Object.freeze({ id: "lit", label: "Lit prints" }),
  Object.freeze({ id: "groups", label: "Groups" }),
  Object.freeze({ id: "relations", label: "Relations" }),
]);

export const DRILL_TABS = Object.freeze([
  Object.freeze({ id: "prints", label: "Prints" }),
  Object.freeze({ id: "minutes", label: "Minutes" }),
  Object.freeze({ id: "profile", label: "Profile" }),
  Object.freeze({ id: "alerts", label: "Alerts" }),
  Object.freeze({ id: "structure", label: "Structure" }),
  Object.freeze({ id: "routing", label: "Routing" }),
]);

export const STATES = Object.freeze({
  loading: "Reading the feed.",
  quiet: "The feed returned no rows for this.",
  closed: "The market is closed; showing the last session, {date}.",
  throttled: "Your read limit was reached; showing the copy from {TRT}.",
  rate_limited: "Your read limit was reached; try again in a minute.",
  timeout: "The feed did not answer in time.",
  failed: "Reading the feed failed.",
  plan: "This read is not on the site's plan.",
  unshaped: "The feed's answer had an unexpected shape; nothing is shown.",
  "no-oi": "No open interest, so no volume to open interest ratio.",
  "lean-undecided": "Undecided: the range includes 50%.",
  "few-prints": "Fewer than 20 prints; no size outliers named.",
  "no-unit": "Relative shape only; the feed states no unit.",
  candidate: "Same name and strike; not yet confirmed to include this contract.",
  "no-expiry-in-rows": "Strike rows carry no expiry, so no share hedge is computed.",
  "min-volume": "The feed returns contracts with 200 or more contracts only.",
  "not-optionable": "{T} has no listed options in last night's list.",
  off: "Relations are switched off on this site.",
  "not-session": "The feed sent the {date} session, not this one.",
  too_large: "The feed's answer was larger than this page reads.",
  status_5xx: "The feed answered with an error, status {status}.",
  status_4xx: "The feed refused this request, status {status}.",
  unparsable: "The feed's answer was not readable data.",
  network: "The feed was not reachable.",
  feed_limited: "The feed is limiting reads; try again in a minute.",
  unconfigured: "Live reads are not configured on this server.",
  "net-undecided": "Undecided: the range includes zero.",
  "choose-ticker": "Choose a ticker to read this view.",
  "choose-ticker-codes": "Choose a ticker to read its codes.",
  "reading-groups": "Reading the 25 flow groups from the feed.",
  earlier: "From the {date} session; the newer read is not in.",
  kept: "The latest read failed; showing the copy from {TRT}.",
});

export const STATE_CHIPS = Object.freeze({
  loading: "Loading", quiet: "Quiet", closed: "Closed", throttled: "Held", rate_limited: "Limited", timeout: "Timed out", failed: "Unavailable",
  plan: "Plan", unshaped: "Withheld", "no-oi": "No OI", "lean-undecided": "Undecided", "few-prints": "Few prints", "no-unit": "Relative",
  candidate: "Candidate", "no-expiry-in-rows": "No expiry", "min-volume": "200 minimum", "not-optionable": "Not optionable", off: "Off",
  "not-session": "Other session", too_large: "Too large", status_5xx: "Feed error", status_4xx: "Refused", unparsable: "Unreadable", network: "Unreachable",
  feed_limited: "Limited", unconfigured: "Off", "net-undecided": "Undecided", "choose-ticker": "No ticker", "choose-ticker-codes": "No ticker",
  "reading-groups": "Loading", earlier: "Earlier", kept: "Held",
});

export const CONVENTION = "By convention: a fill on the ask side is a buy.";

export const SESSION_NOTE = "Times are Türkiye time (TRT). Session dates are US exchange dates.";

export const WHY_LINES = Object.freeze({
  noPremium: "No premium in this row.",
  noSides: "No volume was stated on an ask or bid side.",
  sidesExceed: "The stated sides exceed the total, so no range is drawn.",
  noVolume: "No total was stated, so no range is drawn.",
  lowCoverage: "Under 40% of volume has a stated side.",
  smallClassified: "Under $250k of premium, so no ask share is drawn.",
  "no-volume": "No volume, so no ratio.",
});

export const RANKS = Object.freeze([
  Object.freeze({ id: "premium", label: "Premium" }),
  Object.freeze({ id: "voi", label: "Vol/OI" }),
  Object.freeze({ id: "nameShare", label: "Name share" }),
  Object.freeze({ id: "askLo", label: "Ask share low" }),
  Object.freeze({ id: "sweepShare", label: "Sweep" }),
]);

export const PRESET_LABELS = Object.freeze({
  premium: "Largest premium",
  voi: "Volume above open interest",
  sweep: "Mostly sweeps",
  floor: "Mostly floor trades",
  opening: "Open interest rising",
  earnings: "Report ahead",
});

export const SCREEN_COLUMNS = Object.freeze([
  Object.freeze({ id: "contract", label: "Contract" }),
  Object.freeze({ id: "fill", label: "Last fill" }),
  Object.freeze({ id: "premium", label: "Premium" }),
  Object.freeze({ id: "voi", label: "Vol/OI" }),
  Object.freeze({ id: "ask", label: "Ask share" }),
  Object.freeze({ id: "sweep", label: "Sweep" }),
  Object.freeze({ id: "name", label: "Name share" }),
  Object.freeze({ id: "flags", label: "Flags" }),
]);

export const RANK_NOTE = "The feed picks which 250 contracts return. The key above ranks them.";

export const LEAD_NOTE = "Premium and share figures are the site's own ratios of the feed's counts.";

export const GLOSSARY_LINES = Object.freeze({
  voi: "Volume to open interest is today's contracts over contracts open at the start.",
  askShare: "Ask share range: the ask-side share of volume, widened by volume of unknown side.",
  valueArea: "Value area is the band around the busiest level holding 70% of volume.",
  poc: "Point of control is the busiest price level; a tie goes lower.",
  strikeMap: "Strike map shows signed contracts per strike; ask-side calls and bid-side puts count positive.",
  netRange: "The range adds contracts of unknown side to either end of the net.",
  premiumRange: "The range adds premium of unknown side to either end of the net.",
  sidedShare: "Sided share is the part with a stated ask or bid side.",
  offShare: "Off-exchange share is off-exchange stock volume over lit plus off-exchange, per price bin.",
  routing: "Routing concentration sums squared exchange shares of contracts; one venue alone is 1.",
});

export const GLOSSARY_TERMS = Object.freeze({
  netRange: "Net range",
  premiumRange: "Premium range",
  sidedShare: "Sided share",
  voi: "Volume to open interest",
  askShare: "Ask share range",
  valueArea: "Value area",
  poc: "Point of control",
  strikeMap: "Strike map",
  offShare: "Off-exchange share",
  routing: "Routing concentration",
});

export const INFO = Object.freeze([
  "Contracts come from the feed's screener, ranked by the site's own ratios.",
  "Ask share is a range. Volume of unknown side widens it.",
  "It is withheld when too little volume has a stated side.",
  "A dash means the feed sent no figure, or none with a stated unit.",
  "A strike outside a minute's busiest list is not counted that minute.",
  "The strike map is centred on the day's median strike by volume.",
  CONVENTION,
]);

export const NOT_BUILT = Object.freeze([
  "Share hedges are not computed: strike rows carry no expiry.",
  "Greek flow carries no unit, so its shape is relative only.",
  "Group tiles carry no direction: the feed sends no sided share for a group.",
]);

export const NOTES = Object.freeze({
  strikeMap: "Each minute's busiest strikes, summed by quarter hour.",
  strikeCell: "A cell is coloured only when its range excludes zero.",
  strikeRail: "Session totals by strike.",
  railMark: "Triangles mark ranges clear of zero.",
  sided: "Sided share {pct} of contracts.",
  sidedPremium: "Sided share {pct} of premium.",
  premiumNet: "Net is premium on a stated side, ask minus bid, calls less puts.",
  priorSession: "From the {date} session.",
  stockStep: "Stock levels are the feed's buckets, {step} apart.",
  widened: "Bins widened to {w} to match them.",
  groupNet: "Net call minus put premium, as the feed sends it.",
  groupRead: "Read from the feed at {TRT}.",
  groupSession: "From the {date} nightly read.",
  litMarket: "The {n} newest prints over $500K, ranked by premium.",
  codes: "Trade codes of {T}, from the same read as its exchanges.",
  litBelow: "{n} prints under $500K are not listed.",
  greekOpen: "Minutes before the open are left out.",
  greekNeeds: "Greek flow takes its expiry from Premium by expiry.",
  groupSided: "The feed sends no sided share for a group.",
});

export const EMPTY_TITLES = Object.freeze({
  screen: "No contracts",
  strikes: "No strike rows",
  greeks: "No greek flow",
  ladders: "No price levels",
  routing: "No routing rows",
  lit: "No lit prints",
  groups: "No group reads",
  relations: "No relations read",
});

export const DRILL = Object.freeze({
  open: "Open in Flow Lab",
  contracts: "Contracts",
  close: "Close",
  more: "More prints exist than shown.",
  back: "Back to the list",
  noAlerts: "No flagged alert was tied to these prints.",
  noStructure: "None of the {n} packages read matched this contract.",
  confirmed: "Includes this contract",
  deltaConvention: "Delta and theta use the feed's convention.",
  cancelled: "Canceled",
  firstAggressive: "First aggressive minute",
  sizeOutlier: "Size outlier",
  sharesLine: "Shares of the profile",
  venueNote: "The name's venue split, beside this contract's prints.",
});

export const LABELS = Object.freeze({
  spot: "Spot",
  lastFill: "Last fill",
  readAt: "Read",
  show: "Show all",
  refresh: "Refresh",
  ticker: "Ticker",
  expiry: "Expiry",
  directional: "Directional",
  total: "Total",
  otm: "Out of the money only",
  delta: "Delta flow",
  vega: "Vega flow",
  calls: "Calls",
  puts: "Puts",
  lit: "Lit",
  offExchange: "Off exchange",
  contracts: "Contracts",
  trades: "Trades",
  premium: "Premium",
  netCallPut: "Net call minus put premium",
  up: "Up",
  down: "Down",
  flat: "Flat",
  retry: "Retry",
  unranked: "{n} without this key sit last.",
  moreIn: "+{n} more {what} in Details",
  net: "Net",
  readOk: "Read",
  litMarket: "Lit prints over $500K",
});

export const STATE_MAP = Object.freeze({
  loading: "loading", quiet: "quiet", closed: "closed", throttled: "held", rate_limited: "quota", timeout: "unavailable", failed: "unavailable", plan: "plan",
  unshaped: "withheld", "no-oi": "partial", "lean-undecided": "partial", "few-prints": "partial", "no-unit": "partial", candidate: "partial",
  "no-expiry-in-rows": "partial", "min-volume": "partial", "not-optionable": "withheld", off: "withheld",
  "not-session": "stale", too_large: "unavailable", status_5xx: "unavailable", status_4xx: "unavailable", unparsable: "unavailable", network: "unavailable",
  feed_limited: "quota", unconfigured: "unavailable", "net-undecided": "partial", "choose-ticker": "quiet", "choose-ticker-codes": "quiet",
  "reading-groups": "loading", earlier: "stale", kept: "held",
});

export const CLASS_STATES = Object.freeze({
  too_large: "too_large", status_5xx: "status_5xx", status_4xx: "status_4xx", unparsable: "unparsable", timeout: "timeout", network: "network",
  limited: "feed_limited", plan: "plan", empty: "quiet", unconfigured: "unconfigured",
});

export const WHY_STATES = Object.freeze({
  empty: "quiet", plan: "plan", limited: "feed_limited", timeout: "timeout", failed: "failed", cap: "too_large", "not-session": "not-session",
});

export const ERROR_STATES = Object.freeze({
  rate_limited: "rate_limited", chain_rate_limited: "feed_limited", chain_timeout: "timeout", chain_too_large: "too_large", chain_unconfigured: "unconfigured",
  chain_upstream: "failed",
});

export const clientCopy = () => ({
  states: STATES, chips: STATE_CHIPS, stateMap: STATE_MAP, why: WHY_LINES, ranks: RANKS, presets: PRESET_LABELS, labels: LABELS, drill: DRILL,
  drillTabs: DRILL_TABS, glossary: GLOSSARY_LINES, convention: CONVENTION, session: SESSION_NOTE, empty: EMPTY_TITLES, columns: SCREEN_COLUMNS,
  notes: NOTES, classes: CLASS_STATES, whys: WHY_STATES, errors: ERROR_STATES,
});

export const drillCopy = () => ({
  states: STATES, chips: STATE_CHIPS, stateMap: STATE_MAP, labels: LABELS, drill: DRILL, drillTabs: DRILL_TABS, convention: CONVENTION,
  classes: CLASS_STATES, whys: WHY_STATES, errors: ERROR_STATES,
});

export function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars || {}, k) ? String(vars[k]) : m));
}

export const SENTENCES = Object.freeze([
  SUBTITLE, DESCRIPTION, ...Object.values(STATES), CONVENTION, SESSION_NOTE, ...Object.values(WHY_LINES), RANK_NOTE, LEAD_NOTE,
  ...Object.values(GLOSSARY_LINES), ...INFO, ...NOT_BUILT, ...Object.values(DRILL), ...Object.values(NOTES),
]);
