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
  off: "Relations are off until the feed's answer shape is recorded.",
});

export const STATE_CHIPS = Object.freeze({
  loading: "Loading", quiet: "Quiet", closed: "Closed", throttled: "Held", rate_limited: "Limited", timeout: "Timed out", failed: "Unavailable",
  plan: "Plan", unshaped: "Withheld", "no-oi": "No OI", "lean-undecided": "Undecided", "few-prints": "Few prints", "no-unit": "Relative",
  candidate: "Candidate", "no-expiry-in-rows": "No expiry", "min-volume": "200 minimum", "not-optionable": "Not optionable", off: "Off",
});

export const CONVENTION = "By convention: a fill at the ask is a buy.";

export const SESSION_NOTE = "Times are Türkiye time (TRT). Session dates are US exchange dates.";

export const WHY_LINES = Object.freeze({
  noPremium: "No premium in this row.",
  noSides: "No volume was stated on an ask or bid side.",
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
  offShare: "Off-exchange share is off-exchange stock volume over lit plus off-exchange, per price bin.",
  routing: "Routing concentration sums squared exchange shares of contracts; one venue alone is 1.",
});

export const GLOSSARY_TERMS = Object.freeze({
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
  CONVENTION,
]);

export const NOT_BUILT = Object.freeze([
  "Share hedges are not computed: strike rows carry no expiry.",
  "Greek flow carries no unit, so its shape is relative only.",
]);

export const EMPTY_TITLES = Object.freeze({
  screen: "No contracts",
  strikes: "No strike rows",
  greeks: "No greek flow",
  ladders: "No price levels",
  routing: "No routing rows",
  lit: "No lit prints",
  groups: "No group reads",
  relations: "Relations are off",
});

export const DRILL = Object.freeze({
  open: "Open in Flow Lab",
  contracts: "Contracts",
  close: "Close",
  more: "More prints exist than shown.",
  back: "Back to the list",
  noAlerts: "No flagged alert was tied to these prints.",
  noStructure: "No multi-leg package matched this contract and session.",
  confirmed: "Includes this contract",
  deltaConvention: "Delta and theta use the feed's convention.",
  cancelled: "Canceled",
  firstAggressive: "First aggressive minute",
  sizeOutlier: "Size outlier",
  sharesLine: "Shares of the profile",
  venueNote: "The name's venue split today, beside this contract's prints.",
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
});

export const STATE_MAP = Object.freeze({
  loading: "loading", quiet: "quiet", closed: "closed", throttled: "held", rate_limited: "quota", timeout: "unavailable", failed: "unavailable", plan: "plan",
  unshaped: "withheld", "no-oi": "partial", "lean-undecided": "partial", "few-prints": "partial", "no-unit": "partial", candidate: "partial",
  "no-expiry-in-rows": "partial", "min-volume": "partial", "not-optionable": "withheld", off: "withheld",
});

export const clientCopy = () => ({
  states: STATES, chips: STATE_CHIPS, stateMap: STATE_MAP, why: WHY_LINES, ranks: RANKS, presets: PRESET_LABELS, labels: LABELS, drill: DRILL,
  drillTabs: DRILL_TABS, glossary: GLOSSARY_LINES, convention: CONVENTION, session: SESSION_NOTE, empty: EMPTY_TITLES, columns: SCREEN_COLUMNS,
});

export function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars || {}, k) ? String(vars[k]) : m));
}

export const SENTENCES = Object.freeze([
  SUBTITLE, DESCRIPTION, ...Object.values(STATES), CONVENTION, SESSION_NOTE, ...Object.values(WHY_LINES), RANK_NOTE, LEAD_NOTE,
  ...Object.values(GLOSSARY_LINES), ...INFO, ...NOT_BUILT, ...Object.values(DRILL),
]);
