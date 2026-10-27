import { HORIZON_SESSIONS, horizonWords } from "./flows-horizon.js";

const HOME = { file: "assets/js/flows-overview.js", page: "Home", href: "/flows/" };
const EVENTS = { file: "assets/js/flows-events.js", page: "Events", href: "/flows/events/" };
const MARKET = { file: "assets/js/flows-market.js", page: "Market", href: "/flows/market/" };
const MARKET_BELOW = { ...MARKET, file: "assets/js/flows-market-below.js" };
const TICKER = { file: "assets/js/flows-ticker.js", page: "each name's Ticker page", href: null };
const POLITICAL = { file: "assets/js/flows-political.js", page: "Political", href: "/flows/political/" };
const MOVES = { file: "assets/js/flows-moves.js", page: "Moves", href: "/flows/moves/" };
const UNUSUAL = { file: "assets/js/flows-unusual.js", page: "Unusual", href: "/flows/unusual/" };
const VOLDESK = { file: "assets/js/flows-voldesk.js", page: "Market", href: "/flows/market/" };
const XCHECK = { file: "assets/js/flows-ticker-xcheck.js", page: "each name's Ticker page", href: null };
const BOARDS = { file: "assets/js/flows-board.js", page: "the Bullish and Bearish boards", href: "/flows/long/" };

export const GLOSSARY = Object.freeze([
  { key: "advancers", term: "Advancers", ...MARKET_BELOW, lines: [
    "The session's price change for every eligible name in the screened universe, in half-point bins.",
  ] },
  { key: "ask-share", term: "Ask share", ...UNUSUAL, lines: [
    "Of the premium the vendor attributed to the ask side or the bid side, the share on the ask side.",
  ] },
  { key: "beyond-2", term: "Beyond 2", ...MOVES, lines: [
    "Beyond 2 counts names more than 2 IV-days from flat, up or down.",
    "Share is that count over the sector's names.",
  ] },
  { key: "engine-cross-check", term: "Engine cross-check", ...XCHECK, lines: [
    "The feed's own figures, checked against the site's engine.",
  ] },
  { key: "board-map", term: "Board map", ...BOARDS, lines: [
    "Every name on the board, grouped by sector. A tile's area is its net premium and its color is its score, deeper for stronger.",
  ] },
  { key: "backwardation", term: "Backwardation", ...VOLDESK, lines: [
    "Backwardation: 30-day implied above 90-day.",
  ] },
  { key: "bounds-agree", term: "Bounds agree", ...POLITICAL, lines: [
    "The whole whisker is on the buying side of zero. Even the low bound is a net purchase.",
  ] },
  { key: "contango", term: "Contango", ...VOLDESK, lines: [
    "Contango: 90-day implied above 30-day.",
  ] },
  { key: "correlation-window", term: "Correlation window", ...VOLDESK, lines: [
    "Correlation window: the span of daily returns compared, three months or one year.",
  ] },
  { key: "disclosed-net", term: "Disclosed net", ...POLITICAL, lines: [
    "The bar is disclosed purchases minus disclosed sales from the midpoint of each dollar band.",
    "The whisker runs from the low bound (purchases at their band floor, sales at twice their midpoint) to the high bound (purchases at their band ceiling, sales at an eighth of their midpoint).",
    "Sales carry midpoints only, so no name is ever called a firm reduction.",
  ] },
  { key: "filers", term: "Filers", ...POLITICAL, lines: [
    "Distinct people. Breadth tells you more than the size of one account.",
    "The feed has no party field, no current positions and no per-filer split by stock, so none is shown or inferred.",
  ] },
  { key: "flagged-premium", term: "Flagged premium", ...UNUSUAL, lines: [
    "The vendor's total premium across every flagged window in the record.",
  ] },
  { key: "how-often", term: "How often", ...MOVES, lines: [
    "How often counts days in the last year beyond that many typical days. It is never a model probability.",
  ] },
  { key: "implied-day", term: "Implied day", ...MOVES, lines: [
    "The implied day is prior-close 30-day IV over the square root of 252.",
  ] },
  { key: "iv-days", term: "IV-days", ...MOVES, lines: [
    "IV-days is the move divided by the implied day. The lists rank by it.",
  ] },
  { key: "lean", term: "Lean", ...UNUSUAL, lines: [
    "Lean is a convention: ask-side calls and bid-side puts count bullish.",
  ] },
  { key: "parts-of-move", term: "Parts of the move", ...MOVES, lines: [
    "Parts of the move: market, peers against market, the name against its peers.",
    "The parts add to the move. They are not beta-adjusted.",
  ] },
  { key: "sector-median", term: "Sector median", ...MOVES, lines: [
    "Each sector's median move, and its names beyond 2 IV-days.",
    "Median is signed, in IV-days.",
    horizonWords(HORIZON_SESSIONS).leftOut,
  ] },
  { key: "sided-coverage", term: "Sided coverage", file: "assets/js/flows-net.js", page: "Unusual", href: "/flows/unusual/", lines: [
    "Premium with no stated side is not drawn as a node.",
    "Lean is shown as a range from the sided premium alone.",
    "Beside it is the share of flagged premium with a stated side.",
  ] },
  { key: "score", term: "Score", ...BOARDS, lines: [
    "Scores run from −100 to +100 and rank names against every scored name; they are a ranked attention signal, not a return forecast.",
  ] },
  { key: "still-blind", term: "Still blind", ...POLITICAL, lines: [
    "The share of the window inside the name’s median filing lag, drawn as the ring on a tile. Trades that recent are typically not filed yet, and no dollars are guessed for them.",
  ] },
  { key: "sweep-share", term: "Sweep share", ...UNUSUAL, lines: [
    "Premium on windows the vendor flagged as sweeps, over the windows that carry the flag at all.",
  ] },
  { key: "typical-day", term: "Typical day", ...MOVES, lines: [
    "A typical day is a robust one-day scale from the last 252 sessions.",
  ] },
  { key: "cleared-the-band", term: "Cleared the band", ...HOME, lines: [
    "Names past the dead band on each board, counted whole rather than to the rows this page draws.",
  ] },
  { key: "earnings-bars", term: "Earnings bars", ...EVENTS, lines: [
    "The blue bar is the move the option market prices for the report; the gray bar is the median absolute one-day move over the name's past reports. A blue bar longer than the gray one is a report priced richer than this name usually moves.",
  ] },
  { key: "flagged-windows", term: "Flagged windows", ...HOME, lines: [
    "Option windows the vendor's own rules flagged in this read.",
  ] },
  { key: "implied-move", term: "Implied move", ...EVENTS, lines: [
    "The vendor's expected earnings move where its calendar states one, otherwise the vendor's implied move to its next expiry, which is a different horizon.",
  ] },
  { key: "put-call", term: "Put/call volume", ...HOME, lines: [
    "Put contracts traded per call contract across the whole options market, on the vendor's daily totals.",
  ] },
  { key: "reaction", term: "Reaction", ...EVENTS, lines: [
    "The last session's reporters: each bar is the realized one-day move over the move the options implied, less one.",
    "Above the line a name moved more than it was priced to; below, less.",
  ] },
  { key: "report-timing", term: "Before the open or after the close", ...EVENTS, lines: [
    "A sun marks a report before the open and a moon one after the close, where the vendor's earnings calendar states it.",
  ] },
  { key: "conviction", term: "Conviction", ...TICKER, lines: [
    "How far the families agree, how much of the card was measured, and how long the flow persisted.",
  ] },
  { key: "dark-pool", term: "Dark pool", ...MARKET_BELOW, lines: [
    "The largest off-exchange prints by dollar size.",
  ] },
  { key: "expiry", term: "Expiry", ...MARKET_BELOW, lines: [
    "How much of the session's net option premium sat in contracts expiring the same day, against the weekly expiries.",
    "The share is |0DTE net| over |0DTE net| plus |weekly net|, on the last cumulative values.",
  ] },
  { key: "groups", term: "Groups", ...MARKET_BELOW, lines: [
    "Customer-signed delta flow for the session by industry group: positive is delta bought.",
  ] },
  { key: "index-etfs", term: "Index ETFs", ...MARKET, lines: [
    "The ETF's own options tide, its creation and redemption flow, and its fixed-tenor implied volatility.",
  ] },
  { key: "insiders", term: "Insiders", ...MARKET_BELOW, lines: [
    "Form 4 buys against sells, in dollars, per filing day.",
  ] },
  { key: "net-impact", term: "Net impact", ...MARKET_BELOW, lines: [
    "The names the vendor ranks by net premium impact, split by sign.",
  ] },
  { key: "open-interest", term: "Open interest", ...MARKET_BELOW, lines: [
    "Contracts whose open interest grew most between the two clearing snapshots.",
  ] },
  { key: "q-and-p", term: "Risk-neutral and real-world chance", ...TICKER, lines: [
    "Priced by the options engine on this name's own smile: the chance of profit and the expected P&L are computed twice, under the risk-neutral density the smile implies (Q) and under the real-world GARCH law (P).",
  ] },
  { key: "implied-against-realised", term: "Implied against realised", ...VOLDESK, lines: [
    "Implied is option-market volatility today; realised is the last 21 sessions' moves.",
  ] },
  { key: "roll-per-30-days", term: "Roll per 30 days", ...VOLDESK, lines: [
    "Roll: second-month futures against the front, per 30 days.",
  ] },
  { key: "sector-tides", term: "Sector tides", ...MARKET, lines: [
    "Net option premium through the session for each of the eleven sectors, on one shared scale so heights compare.",
  ] },
  { key: "tape", term: "Prints", ...MARKET, lines: [
    "Seven aggregate readings over the screened universe; each names the population it was measured over.",
  ] },
  { key: "tide", term: "Tide", ...MARKET, lines: [
    "Net call premium minus net put premium is the net; a put line below zero is puts sold.",
  ] },
  { key: "volatility-half-life", term: "Volatility half-life", ...VOLDESK, lines: [
    "Half-life: sessions for a volatility shock to halve.",
  ] },
  { key: "volatility", term: "Volatility", ...MARKET_BELOW, lines: [
    "The index ETFs' fixed-tenor implied volatility stands in for the VIX curve, which the vendor plan does not serve.",
    "Contango (a rising curve) is the calm shape; an inverted front is stress.",
    "Implied correlation is the index variance left after the members' own variances, over what perfect correlation would add; dispersion is the members' weighted 30-day IV less the index's, in volatility points.",
  ] },
  { key: "volatility-radar", term: "Volatility radar", ...MARKET_BELOW, lines: [
    "The vendor's anomaly screen ranks names whose options are rich or cheap against their own history; its sentiment screen ranks bullish and bearish positioning.",
  ] },
]);

export const GLOSSARY_PAGES = Object.freeze([HOME.page, MARKET.page, MOVES.page, UNUSUAL.page, POLITICAL.page, EVENTS.page, BOARDS.page, TICKER.page]);
