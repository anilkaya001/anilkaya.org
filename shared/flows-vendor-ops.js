export const LIMITERS = Object.freeze(["ondemand", "feature"]);

export const LICENCES = Object.freeze(["aggregate", "derived", "print", "quote", "text"]);

export const PLANS = Object.freeze(["advanced", "addon:volatility", "addon:futures", "enterprise"]);

const DEFAULTS = Object.freeze({ method: "GET", plan: "advanced", envelope: "data", limiter: null, liveOnly: false, maxBytes: null, reads: null });

const RAW = [
  { id: "ohlc-1d", path: "/api/stock/{ticker}/ohlc/1d", op: "/api/stock/{ticker}/ohlc/{candle_size}", licence: "quote", klass: "static", limiter: "ondemand", reads: ["open", "high", "low", "close", "volume"] },
  { id: "stock-state", path: "/api/stock/{ticker}/stock-state", licence: "quote", klass: "quote", limiter: "ondemand", reads: ["close", "prev_close", "open", "high", "low", "volume", "tape_time", "market_time"] },
  { id: "info", path: "/api/stock/{ticker}/info", licence: "text", klass: "slow", limiter: "ondemand", maxBytes: 32768, reads: ["full_name", "sector", "issue_type", "marketcap", "avg30_volume", "beta", "has_options", "has_dividend", "has_earnings_history", "next_earnings_date", "announce_time", "short_description"] },
  { id: "greek-flow", path: "/api/stock/{ticker}/greek-flow", licence: "aggregate", klass: "nightly" },
  { id: "net-prem-ticks", path: "/api/stock/{ticker}/net-prem-ticks", licence: "aggregate", klass: "tape", limiter: "ondemand", reads: ["tape_time", "net_call_premium", "net_put_premium", "net_delta", "call_volume", "put_volume", "call_volume_ask_side", "call_volume_bid_side", "put_volume_ask_side", "put_volume_bid_side"] },
  { id: "spot-exposures-strike", path: "/api/stock/{ticker}/spot-exposures/strike", licence: "aggregate", klass: "nightly" },
  { id: "greek-exposure-expiry", path: "/api/stock/{ticker}/greek-exposure/expiry", licence: "aggregate", klass: "nightly", limiter: "ondemand" },
  { id: "spot-exposures-expiry-strike", path: "/api/stock/{ticker}/spot-exposures/expiry-strike", licence: "aggregate", klass: "nightly" },
  { id: "max-pain", path: "/api/stock/{ticker}/max-pain", licence: "derived", klass: "nightly" },
  { id: "expiry-breakdown", path: "/api/stock/{ticker}/expiry-breakdown", licence: "aggregate", klass: "nightly", limiter: "ondemand" },
  { id: "option-contracts", path: "/api/stock/{ticker}/option-contracts", licence: "quote", klass: "nightly", limiter: "ondemand" },
  { id: "contract-historic", path: "/api/option-contract/{id}/historic", licence: "aggregate", klass: "nightly" },
  { id: "term-structure", path: "/api/stock/{ticker}/volatility/term-structure", licence: "derived", klass: "nightly" },
  { id: "term-structure-dist", path: "/api/stock/{ticker}/volatility/term-structure/distribution", licence: "derived", klass: "nightly", liveOnly: true },
  { id: "iv-dist", path: "/api/stock/{ticker}/interpolated-iv/distribution", licence: "derived", klass: "nightly", liveOnly: true },
  { id: "iv-rank", path: "/api/stock/{ticker}/iv-rank", licence: "derived", klass: "nightly" },
  { id: "vrp", path: "/api/stock/{ticker}/volatility/variance-risk-premium", licence: "derived", klass: "nightly" },
  { id: "rr-skew", path: "/api/stock/{ticker}/historical-risk-reversal-skew", licence: "derived", klass: "nightly" },
  { id: "greek-exposure", path: "/api/stock/{ticker}/greek-exposure", licence: "aggregate", klass: "nightly" },
  { id: "gex-levels", path: "/api/stock/{ticker}/gex-levels", licence: "derived", klass: "nightly" },
  { id: "spot-exposures", path: "/api/stock/{ticker}/spot-exposures", licence: "aggregate", klass: "tape", limiter: "ondemand", reads: ["start_time", "price", "gamma_per_one_percent_move_oi", "gamma_per_one_percent_move_vol", "gamma_per_one_percent_move_dir"] },
  { id: "oi-per-strike", path: "/api/stock/{ticker}/oi-per-strike", licence: "aggregate", klass: "nightly" },
  { id: "oi-change", path: "/api/stock/{ticker}/oi-change", licence: "aggregate", klass: "nightly" },
  { id: "flow-per-expiry", path: "/api/stock/{ticker}/flow-per-expiry", licence: "aggregate", klass: "nightly" },
  { id: "flow-per-strike", path: "/api/stock/{ticker}/flow-per-strike", licence: "aggregate", klass: "nightly" },
  { id: "options-volume", path: "/api/stock/{ticker}/options-volume", licence: "aggregate", klass: "nightly", reads: ["date", "call_premium", "put_premium", "call_volume", "put_volume", "bullish_premium", "bearish_premium"] },
  { id: "nope", path: "/api/stock/{ticker}/nope", licence: "derived", klass: "nightly" },
  { id: "vol-anomaly", path: "/api/stock/{ticker}/volatility/anomaly", licence: "derived", klass: "nightly" },
  { id: "vol-sentiment", path: "/api/stock/{ticker}/volatility/option-sentiment", licence: "derived", klass: "nightly", liveOnly: true },
  { id: "vol-character", path: "/api/stock/{ticker}/volatility/character", licence: "derived", klass: "nightly" },
  { id: "darkpool", path: "/api/darkpool/{ticker}", licence: "print", klass: "nightly" },
  { id: "darkpool-levels", path: "/api/darkpool/{ticker}/price-levels", licence: "aggregate", klass: "tape", limiter: "ondemand", maxBytes: 131072, reads: ["date", "price", "dark_pool_volume", "regular_volume"] },
  { id: "earnings", path: "/api/earnings/{ticker}", licence: "aggregate", klass: "slow", limiter: "ondemand", maxBytes: 131072, reads: ["report_date", "report_time", "source", "expected_move_perc", "post_earnings_move_1d", "post_earnings_move_1w", "pre_earnings_move_1w", "long_straddle_1d", "long_straddle_1w"] },
  { id: "shorts-data", path: "/api/shorts/{ticker}/data", licence: "aggregate", klass: "nightly" },
  { id: "shorts-volume", path: "/api/shorts/{ticker}/volume-and-ratio", licence: "aggregate", klass: "nightly" },
  { id: "multi-leg", path: "/api/option-trades/multi-leg", licence: "print", klass: "nightly", limiter: "ondemand", maxBytes: 262144, reads: ["id", "ticker", "executed_at", "strategy", "code", "leg_count", "strikes", "total_premium", "net_premium", "direction", "size"] },
  { id: "congress-recent", path: "/api/congress/recent-trades", licence: "print", klass: "nightly" },
  { id: "politician-holders", path: "/api/politician-portfolios/holders/{ticker}", plan: "enterprise", licence: "text", klass: "nightly" },
  { id: "screener-stocks", path: "/api/screener/stocks", licence: "quote", klass: "quote", limiter: "ondemand", reads: ["ticker", "close", "prev_close", "net_call_premium", "net_put_premium", "bullish_premium", "bearish_premium", "call_volume", "put_volume", "call_volume_ask_side", "put_volume_ask_side", "iv30d", "iv_rank", "implied_move_perc", "gex_gamma_per_one_percent_move_oi", "gex_gamma_per_one_percent_move_vol", "gex_gamma_per_one_percent_move_dir", "put_call_ratio", "relative_volume", "stock_volume", "call_premium", "put_premium", "call_volume_bid_side", "put_volume_bid_side", "iv30d_1d", "marketcap", "issue_type", "full_name"] },
  { id: "short-screener", path: "/api/short_screener", licence: "aggregate", klass: "nightly" },
  { id: "flow-alerts", path: "/api/option-trades/flow-alerts", licence: "print", klass: "tape", limiter: "ondemand", reads: ["created_at", "ticker", "option_chain", "strike", "expiry", "total_premium", "total_ask_side_prem", "total_bid_side_prem", "total_size", "trade_count", "open_interest", "volume_oi_ratio", "underlying_price", "has_sweep", "has_floor", "has_singleleg", "all_opening_trades", "start_time", "end_time", "iv_start", "iv_end"] },
  { id: "insider-transactions", path: "/api/insider/transactions", licence: "print", klass: "nightly" },
  { id: "market-tide", path: "/api/market/market-tide", licence: "aggregate", klass: "market", reads: ["timestamp", "net_call_premium", "net_put_premium", "net_volume"] },
  { id: "total-options-volume", path: "/api/market/total-options-volume", licence: "aggregate", klass: "market", reads: ["date", "call_volume", "put_volume", "call_premium", "put_premium"] },
  { id: "market-oi-change", path: "/api/market/oi-change", licence: "aggregate", klass: "nightly" },
  { id: "top-net-impact", path: "/api/market/top-net-impact", licence: "aggregate", klass: "breadth", reads: ["ticker", "net_premium"] },
  { id: "insider-buy-sells", path: "/api/market/insider-buy-sells", licence: "aggregate", klass: "nightly" },
  { id: "darkpool-recent", path: "/api/darkpool/recent", licence: "print", klass: "breadth", reads: ["executed_at", "canceled", "ext_hour_sold_codes", "ticker", "price", "size", "premium"] },
  { id: "seasonality-market", path: "/api/seasonality/market", licence: "aggregate", klass: "nightly" },
  { id: "sector-etfs", path: "/api/market/sector-etfs", licence: "quote", klass: "market", reads: ["ticker", "last", "prev_close", "prev_date", "bullish_premium", "bearish_premium", "call_premium", "put_premium", "call_volume", "put_volume", "volume"] },
  { id: "news", path: "/api/news/headlines", licence: "text", klass: "news", limiter: "ondemand", maxBytes: 98304, reads: ["created_at", "headline", "source", "is_major", "sentiment", "tickers"] },
  { id: "daily-report", path: "/api/market/daily-report", licence: "aggregate", klass: "nightly", liveOnly: true },
  { id: "net-flow-expiry", path: "/api/net-flow/expiry", licence: "aggregate", klass: "breadth", reads: ["timestamp", "net_call_premium", "net_put_premium", "net_volume", "underlying_price"] },
  { id: "economic-calendar", path: "/api/market/economic-calendar", licence: "aggregate", klass: "nightly" },
  { id: "earnings-afterhours", path: "/api/earnings/afterhours", licence: "aggregate", klass: "nightly" },
  { id: "earnings-premarket", path: "/api/earnings/premarket", licence: "aggregate", klass: "nightly" },
  { id: "treasury-yield", path: "/api/economy/treasury-yield", op: "/api/economy/{indicator}", licence: "aggregate", klass: "nightly" },
  { id: "etf-holdings", path: "/api/etfs/{ticker}/holdings", licence: "aggregate", klass: "nightly", reads: ["ticker", "type", "weight"] },
  { id: "etf-in-outflow", path: "/api/etfs/{ticker}/in-outflow", licence: "aggregate", klass: "nightly", reads: ["date", "change"] },
  { id: "etf-tide", path: "/api/market/{ticker}/etf-tide", licence: "aggregate", klass: "breadth", reads: ["timestamp", "net_call_premium", "net_put_premium", "net_volume", "underlying_price"] },
  { id: "group-flow-greek", path: "/api/group-flow/{flow_group}/greek-flow", licence: "aggregate", klass: "nightly" },
  { id: "sector-tide", path: "/api/market/{sector}/sector-tide", licence: "aggregate", klass: "breadth", reads: ["timestamp", "net_call_premium", "net_put_premium", "net_volume"] },
  { id: "fda-calendar", path: "/api/market/fda-calendar", licence: "aggregate", klass: "nightly" },
  { id: "option-activity-unusual", path: "/api/option-activity/unusual", licence: "print", klass: "nightly" },
  { id: "options-pulse-total", path: "/api/options-pulse/total", licence: "aggregate", klass: "nightly" },
  { id: "vol-anomaly-top", path: "/api/volatility/anomaly/top", licence: "derived", klass: "nightly" },
  { id: "vol-sentiment-top", path: "/api/volatility/option-sentiment/top", licence: "derived", klass: "nightly", liveOnly: true },
  { id: "profile", path: "/api/companies/{ticker}/profile", licence: "text", klass: "slow", limiter: "ondemand", maxBytes: 32768, reads: ["name", "sector", "industry", "exchange", "country", "currency", "description", "market_cap", "pe_ratio", "peg_ratio", "beta", "week_52_high", "week_52_low", "analyst_target_price", "shares_outstanding"] },
  { id: "financials", path: "/api/stock/{ticker}/financials", licence: "aggregate", klass: "slow", limiter: "ondemand", maxBytes: 262144, reads: ["income_statements", "balance_sheets", "cash_flows", "earnings", "fiscal_date_ending", "report_type", "total_revenue", "gross_profit", "operating_income", "net_income", "ebitda", "cash_and_short_term_investments", "short_long_term_debt_total", "total_shareholder_equity", "total_assets", "total_liabilities", "total_current_assets", "total_current_liabilities", "common_stock_shares_outstanding", "operating_cashflow", "capital_expenditures", "report_date", "reported_eps", "estimated_eps", "reported_currency"] },
  { id: "fundamental-breakdown", path: "/api/stock/{ticker}/fundamental-breakdown", licence: "aggregate", klass: "slow", limiter: "ondemand", maxBytes: 262144, reads: ["rev_breakdown", "report_date", "rev_group", "members", "value", "field"] },
  { id: "earnings-estimates", path: "/api/companies/{ticker}/earnings-estimates", licence: "aggregate", klass: "slow", limiter: "ondemand", maxBytes: 65536, reads: ["estimates", "date", "horizon", "eps_estimate_average", "eps_estimate_high", "eps_estimate_low", "eps_estimate_analyst_count", "revenue_estimate_average", "revenue_estimate_analyst_count"] },
  { id: "analysts", path: "/api/screener/analysts", licence: "text", klass: "slow", limiter: "ondemand", maxBytes: 98304, reads: ["ticker", "timestamp", "firm", "action", "recommendation", "target"] },
  { id: "ownership", path: "/api/institution/{ticker}/ownership", licence: "text", klass: "slow", limiter: "ondemand", maxBytes: 131072, reads: ["name", "short_name", "units", "units_changed", "historical_units", "report_date", "filing_date", "shares_outstanding", "value"] },
  { id: "short-interest", path: "/api/shorts/{ticker}/interest-float/v2", licence: "aggregate", klass: "slow", limiter: "ondemand", maxBytes: 32768, reads: ["market_date", "short_interest", "total_float", "days_to_cover"] },
  { id: "insider-flow", path: "/api/insider/{ticker}/ticker-flow", licence: "aggregate", klass: "slow", limiter: "ondemand", maxBytes: 65536, reads: ["date", "buy_sell", "transactions", "uniq_insiders", "volume", "premium"] },
  { id: "dividends", path: "/api/companies/{ticker}/dividends", licence: "aggregate", klass: "slow", maxBytes: 65536, reads: ["dividends", "ex_date", "declaration_date", "record_date", "payment_date", "amount"] },
  { id: "splits", path: "/api/companies/{ticker}/splits", licence: "aggregate", klass: "slow", maxBytes: 32768, reads: ["splits", "effective_date", "split_factor"] },
  { id: "interpolated-iv", path: "/api/stock/{ticker}/interpolated-iv", licence: "derived", klass: "nightly", maxBytes: 32768, reads: ["date", "days", "percentile"] },
  { id: "etf-exposure", path: "/api/etfs/{ticker}/exposure", licence: "aggregate", klass: "slow", maxBytes: 131072, reads: ["etf", "weight", "shares"] },
  { id: "contract-screener", path: "/api/screener/option-contracts", licence: "aggregate", klass: "quote", limiter: "ondemand", maxBytes: 524288, reads: ["option_symbol", "option_type", "strike", "expiry", "stock_price", "volume", "open_interest", "premium", "avg_price", "ask_side_volume", "bid_side_volume", "mid_volume", "no_side_volume", "sweep_volume", "floor_volume", "multileg_volume", "stock_multi_leg_volume", "cross_volume", "ticker_vol", "trades", "last_fill", "sector", "next_earnings_date", "er_time"] },
  { id: "contract-flow", path: "/api/option-contract/{id}/flow", licence: "print", klass: "quote", limiter: "ondemand", maxBytes: 262144, reads: ["id", "executed_at", "price", "size", "premium", "nbbo_bid", "nbbo_ask", "exchange", "canceled", "report_flags", "tags", "flow_alert_id", "implied_volatility", "delta", "open_interest", "multi_vol", "stock_multi_vol", "option_type", "strike", "expiry"] },
  { id: "contract-intraday", path: "/api/option-contract/{id}/intraday", licence: "aggregate", klass: "breadth", limiter: "ondemand", maxBytes: 262144, reads: ["start_time", "open", "high", "low", "close", "avg_price", "iv_low", "iv_high", "volume_ask_side", "volume_bid_side", "volume_mid_side", "volume_no_side", "volume_multi", "volume_stock_multi", "premium_ask_side", "premium_bid_side", "premium_mid_side", "premium_no_side"] },
  { id: "contract-profile", path: "/api/option-contract/{id}/volume-profile", licence: "aggregate", klass: "breadth", limiter: "ondemand", maxBytes: 131072, reads: ["price", "volume", "ask_vol", "bid_vol", "mid_vol", "sweep_vol", "floor_vol", "multi_vol", "cross_vol", "transactions", "date"] },
  { id: "flow-alert-trades", path: "/api/option-trades/flow-alerts/{id}", licence: "print", klass: "quote", limiter: "ondemand", maxBytes: 131072, reads: ["alert", "trades", "has_more"] },
  { id: "multi-leg-legs", path: "/api/option-trades/multi-leg/{id}/legs", licence: "print", klass: "quote", limiter: "ondemand", maxBytes: 32768, reads: ["option_symbol", "type", "strike", "expiry", "side", "size", "price", "premium", "nbbo_bid", "nbbo_ask", "delta", "theta", "open_interest", "volume"] },
  { id: "exchange-breakdown", path: "/api/option-trades/exchange-breakdown/{date}", licence: "aggregate", klass: "breadth", limiter: "ondemand", maxBytes: 524288, reads: ["underlying_symbol", "exchange", "trade_code", "trade_count", "contracts", "premium", "call_trades", "put_trades"] },
  { id: "optionable-roots", path: "/api/option-trades/optionable-tickers", licence: "aggregate", klass: "slow", maxBytes: 524288 },
  { id: "strike-flow-intraday", path: "/api/stock/{ticker}/flow-per-strike-intraday", licence: "aggregate", klass: "breadth", limiter: "ondemand", maxBytes: 524288, reads: ["timestamp", "strike", "call_volume_ask_side", "call_volume_bid_side", "put_volume_ask_side", "put_volume_bid_side", "call_premium_ask_side", "call_premium_bid_side", "put_premium_ask_side", "put_premium_bid_side", "call_volume", "put_volume"] },
  { id: "flow-recent", path: "/api/stock/{ticker}/flow-recent", licence: "aggregate", klass: "breadth", limiter: "ondemand", maxBytes: 131072, reads: ["date", "expiry", "call_premium", "put_premium", "call_premium_ask_side", "call_premium_bid_side", "put_premium_ask_side", "put_premium_bid_side", "call_volume", "put_volume", "call_otm_premium", "put_otm_premium", "call_trades", "put_trades"] },
  { id: "greek-flow-expiry", path: "/api/stock/{ticker}/greek-flow/{expiry}", licence: "aggregate", klass: "breadth", limiter: "ondemand", maxBytes: 131072, reads: ["timestamp", "expiry", "dir_delta_flow", "dir_vega_flow", "total_delta_flow", "total_vega_flow", "otm_dir_delta_flow", "otm_dir_vega_flow", "transactions", "volume"] },
  { id: "group-greek-flow-expiry", path: "/api/group-flow/{flow_group}/greek-flow/{expiry}", licence: "aggregate", klass: "breadth", limiter: "ondemand", maxBytes: 131072, reads: ["timestamp", "expiry", "dir_delta_flow", "dir_vega_flow", "total_delta_flow", "total_vega_flow", "otm_dir_delta_flow", "otm_dir_vega_flow", "transactions", "volume", "flow_group", "net_call_premium", "net_put_premium", "net_call_volume", "net_put_volume"] },
  { id: "option-price-levels", path: "/api/stock/{ticker}/option/stock-price-levels", licence: "aggregate", klass: "breadth", limiter: "ondemand", maxBytes: 131072, reads: ["price", "call_volume", "put_volume"] },
  { id: "stock-price-levels", path: "/api/stock/{ticker}/stock-volume-price-levels", licence: "aggregate", klass: "breadth", limiter: "ondemand", maxBytes: 131072, reads: ["price", "lit_vol", "off_vol"] },
  { id: "lit-recent", path: "/api/lit-flow/recent", licence: "print", klass: "quote", limiter: "ondemand", maxBytes: 262144, reads: ["ticker", "executed_at", "price", "size", "premium", "nbbo_bid", "nbbo_ask", "market_center", "canceled", "trade_code", "sale_cond_codes"] },
  { id: "lit-ticker", path: "/api/lit-flow/{ticker}", licence: "print", klass: "quote", limiter: "ondemand", maxBytes: 262144, reads: ["ticker", "executed_at", "price", "size", "premium", "nbbo_bid", "nbbo_ask", "market_center", "canceled", "trade_code", "sale_cond_codes"] },
  { id: "analytics-window", path: "/api/analytics/window", licence: "derived", klass: "nightly", maxBytes: 262144 },
  { id: "analytics-sliding", path: "/api/analytics/sliding", licence: "derived", klass: "nightly", maxBytes: 262144 },
  { id: "etf-info", path: "/api/etfs/{ticker}/info", licence: "text", klass: "slow", maxBytes: 32768, reads: ["name", "etf_company", "holdings_count", "has_options"] },
  { id: "etf-weights", path: "/api/etfs/{ticker}/weights", licence: "aggregate", klass: "slow", maxBytes: 32768, reads: ["sector", "country", "weight"] },
  { id: "ticker-exchanges", path: "/api/stock-directory/ticker-exchanges", licence: "aggregate", klass: "slow", maxBytes: 1048576, reads: ["ticker", "exchange"] },
];

export const OPS = Object.freeze(RAW.map((e) => Object.freeze({
  ...DEFAULTS,
  op: e.path,
  ...e,
  reads: e.reads ? Object.freeze([...e.reads]) : null,
})));

const BY_ID = new Map(OPS.map((e) => [e.id, e]));

const TOKEN = /\{([a-z_]+)\}/g;

export function opById(id) {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`feed operation ${String(id)} is not in the registry`);
  return e;
}

export function pathFor(id, params) {
  const e = opById(id);
  const given = params || {};
  return e.path.replace(TOKEN, (_, name) => {
    const v = given[name];
    if (v === undefined || v === null || v === "") throw new Error(`feed operation ${id}: ${name} is missing`);
    return encodeURIComponent(String(v));
  });
}

export function opsFor(limiter) {
  return OPS.filter((e) => e.limiter === (limiter === undefined ? null : limiter));
}

export const BUDGETS = Object.freeze({
  nightly: Object.freeze({ window: "17:30-17:50 ET", minDelayMs: 60, perMinute: null }),
  tier1: Object.freeze({ window: "13:00-21:00 UTC, Monday to Friday", callsPerTick: 2, focusCallsPerTick: 1, tickMinutes: 5 }),
  funds: Object.freeze({ window: "13:00-21:00 UTC, Monday to Friday", callsPerTick: 1, tickMinutes: 5, fillMaxCalls: 2, fillMarkerS: 60 }),
  tier2: Object.freeze({ window: "09:30-16:25 ET", paceMs: 333, perMinute: 180, maxCallsPerPass: 48 }),
  rail: Object.freeze({ window: "04:00-20:00 ET, trading days, while demanded", perMinute: 240 }),
  premarketNews: Object.freeze({ window: "04:00-09:30 ET, trading days", everyMin: 30, callsPerFiring: 1, maxFiringsPerDay: 11, perMinute: 1 }),
  ondemand: Object.freeze({ binding: "UW_ONDEMAND", limit: 120, periodS: 60, failsOpen: true }),
  flowlab: Object.freeze({
    nightlyMax: 40,
    memberCallsPerRead: Object.freeze({ screen: 1, core: 3, alert: 1, structure: 1, legs: 1, strikes: 1, recent: 1, greek: 1, levels: 2, lit: 1, venues: 1, group: 1, litMarket: 1 }),
  }),
});

export const PLAN = Object.freeze({
  selected: "observed",
  observed: Object.freeze({ perMinute: 1000000, perDay: null, tokenLimit: 100000000 }),
  startup: Object.freeze({ perMinute: 500, perDay: 80000, lookbackDays: 90 }),
});
