const MARKET = { file: "assets/js/flows-market.js", page: "Market", href: "/flows/market/" };
const TICKER = { file: "assets/js/flows-ticker.js", page: "Ticker", href: "/flows/ticker/" };

export const GLOSSARY = Object.freeze([
  { key: "advancers", term: "Advancers", ...MARKET, lines: [
    "The session's price change for every eligible name in the screened universe, in half-point bins.",
  ] },
  { key: "conviction", term: "Conviction", ...TICKER, lines: [
    "How far the families agree, how much of the card was measured, and how long the flow persisted.",
  ] },
  { key: "dark-pool", term: "Dark pool", ...MARKET, lines: [
    "The largest off-exchange prints by dollar size.",
  ] },
  { key: "expiry", term: "Expiry", ...MARKET, lines: [
    "How much of the session's net option premium sat in contracts expiring the same day, against the weekly expiries.",
    "The share is |0DTE net| over |0DTE net| plus |weekly net|, on the last cumulative values.",
  ] },
  { key: "groups", term: "Groups", ...MARKET, lines: [
    "Customer-signed delta flow for the session by industry group: positive is delta bought.",
  ] },
  { key: "index-etfs", term: "Index ETFs", ...MARKET, lines: [
    "The ETF's own options tide, its creation and redemption flow, and its fixed-tenor implied volatility.",
  ] },
  { key: "insiders", term: "Insiders", ...MARKET, lines: [
    "Form 4 buys against sells, in dollars, per filing day.",
  ] },
  { key: "net-impact", term: "Net impact", ...MARKET, lines: [
    "The names the vendor ranks by net premium impact, split by sign.",
  ] },
  { key: "open-interest", term: "Open interest", ...MARKET, lines: [
    "Contracts whose open interest grew most between the two clearing snapshots.",
  ] },
  { key: "q-and-p", term: "Risk-neutral and real-world chance", ...TICKER, lines: [
    "Priced by the options engine on this name's own smile: the chance of profit and the expected P&L are computed twice, under the risk-neutral density the smile implies (Q) and under the real-world GARCH law (P).",
  ] },
  { key: "sector-tides", term: "Sector tides", ...MARKET, lines: [
    "Net option premium through the session for each of the eleven sectors, on one shared scale so heights compare.",
  ] },
  { key: "tape", term: "Tape", ...MARKET, lines: [
    "Seven aggregate readings over the screened universe; each names the population it was measured over.",
  ] },
  { key: "tide", term: "Tide", ...MARKET, lines: [
    "Net call premium minus net put premium is the net; a put line below zero is puts sold.",
  ] },
  { key: "volatility", term: "Volatility", ...MARKET, lines: [
    "The index ETFs' fixed-tenor implied volatility stands in for the VIX curve, which the vendor plan does not serve.",
    "Contango (a rising curve) is the calm shape; an inverted front is stress.",
    "Implied correlation is the index variance left after the members' own variances, over what perfect correlation would add; dispersion is the members' weighted 30-day IV less the index's, in volatility points.",
  ] },
  { key: "volatility-radar", term: "Volatility radar", ...MARKET, lines: [
    "The vendor's anomaly screen ranks names whose options are rich or cheap against their own history; its sentiment screen ranks bullish and bearish positioning.",
  ] },
]);
