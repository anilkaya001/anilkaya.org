# Vendor coverage matrix

What the committed OpenAPI document (`docs/uw-openapi.yaml`, the 2026-08-30 copy, 217 paths) offers for one name, what production reads, and what this branch added. The recorded plan is API Advanced (100M calls a day included); the binding limits are the 500 a minute working line (the nightly rotation paces at 80 per cent of it), the 90 minute nightly deadline, D1 rows, the card-x cap of 100 KiB and the 128 KiB ingest cap, not the day count. This table is held to the registry by `tests/flows-vendor-extras.mjs`: a path marked read or added must be a registry operation with that id, every registry operation must appear as read or added, and every spec path with a `{ticker}` must appear once.

How to read the columns. **Status**: `read` is in the registry before this branch; `added` is registered and read by the extras leg on this branch; `probe only` is asked about weekly and never read; `not added` has a reason in the last column; `deprecated` and `enterprise` are the spec's own words. **Wire** says whether the weekly probe has recorded a shape for the operation in `scripts/flows-probe-shapes.json`; the four added operations have none yet, so their reducers fail by name until the first Sunday probe records them, and their fixtures (`tests/fixtures-vendor-extras.json`) are spec-derived, not observed. **Unit status** follows the repository rule that a number travels with its unit and a field whose unit the schema does not state is withheld with a reason.

## Per-name operations (87 paths with a ticker in the path)

84 spec paths carry a ticker, and 3 more are read from the live documentation: 45 read before this branch, 4 added, 7 probe only, 3 deprecated, 3 Enterprise only, 25 not added.

| Operation | Status | Registry id | Plan | Wire | Returns | Unit status | Surface | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/companies/{ticker}/dividends` | added | dividends | Advanced+ | not observed | ex, declaration, record and payment dates of each event; the amount | dates stated; amount withheld (the schema states no unit) | events packet; the desk's early-assignment window (`exercisePressure`); the reading | added: `vx.dividends`, refreshed every 3 days |
| `/api/companies/{ticker}/earnings-estimates` | read | earnings-estimates | Advanced+ | observed | estimates, date, horizon, eps_estimate_average, eps_estimate_high, ... | read by the code | dossier | read |
| `/api/companies/{ticker}/profile` | read | profile | Advanced+ | observed | name, sector, industry, exchange, country, ... | read by the code | dossier, engines | read |
| `/api/companies/{ticker}/splits` | added | splits | Advanced+ | not observed | effective date and split factor of each split | date stated; factor withheld (4 or 0.25 for a 4-for-1 is not stated) | events packet; break mask for the typical-day scale | added: `vx.splits`, refreshed every 14 days |
| `/api/companies/{ticker}/transcripts/{quarter}` | not added | - | Advanced+ | not observed | the full earnings call text | text | none | no: size, the 8 KiB cache rows and the sanitiser's surface all argue against it |
| `/api/darkpool/{ticker}` | read | darkpool | any | observed | whole body | read by the code | dossier, engines, nightly | read |
| `/api/darkpool/{ticker}/price-levels` | read | darkpool-levels | any | observed | date, price, dark_pool_volume, regular_volume | read by the code | dossier, nightly | read |
| `/api/earnings/{ticker}` | read | earnings | any | observed | report_date, report_time, source, expected_move_perc, post_earnings_move_1d, ... | read by the code | dossier, engines, nightly | read |
| `/api/etfs/{ticker}/exposure` | added | etf-exposure | any | not observed | every ETF that holds the name: ticker, shares, weight, fund name, prices | ticker and shares stated; weight, prices and fund name withheld | peers packet | added: `vx.etf`, refreshed every 7 days, top ten by weight |
| `/api/etfs/{ticker}/holdings` | read | etf-holdings | any | observed | ticker, type, weight | read by the code | nightly | read |
| `/api/etfs/{ticker}/in-outflow` | read | etf-in-outflow | any | observed | whole body | read by the code | nightly | read |
| `/api/etfs/{ticker}/info` | not added | - | any | not observed | an ETF's identity, assets, expense ratio | stated for ETFs only | fund cards (nine funds) | no: an ETF-only read, a follow-up for the fund cards |
| `/api/etfs/{ticker}/weights` | not added | - | any | not observed | an ETF's sector and country weights | stated for ETFs only | fund cards | no: an ETF-only read, a follow-up for the fund cards |
| `/api/insider/{ticker}` | not added | - | any | not observed | the names of a company's insiders | third-party names | none | no: names of people; the insider batch and `insider-flow` already carry the flow |
| `/api/insider/{ticker}/ticker-flow` | read | insider-flow | any | observed | date, buy_sell, transactions, uniq_insiders, volume, ... | read by the code | dossier | read |
| `/api/institution/{ticker}/ownership` | read | ownership | any | observed | name, short_name, units, units_changed, historical_units, ... | read by the code | dossier | read |
| `/api/lit-flow/{ticker}` | probe only | - | any | not observed | lit-exchange stock prints | stated | none | no: print-level and heavy; asked weekly as an entitlement question (tier 2) |
| `/api/market/{ticker}/etf-tide` | read | etf-tide | any | observed | timestamp, net_call_premium, net_put_premium, net_volume, underlying_price | read by the code | Tier 2, nightly | read |
| `/api/politician-portfolios/holders/{ticker}` | read | politician-holders | Enterprise | not observed | whole body | read by the code | nightly | read |
| `/api/politics/fec/company/{ticker}/lobbying` | enterprise | - | Enterprise | not observed | lobbying spend by quarter and issue | stated | none | no: Enterprise only |
| `/api/politics/fec/company/{ticker}/people` | enterprise | - | Enterprise | not observed | people linked to a company | third-party names | none | no: Enterprise only |
| `/api/seasonality/{ticker}/monthly` | not added | - | any | not observed | average and median change, share of positive closes and years by calendar month | share stated; the change fields are described as per day for the month | price packet | no: each month has 10 to 20 years, so a 60 per cent share is under one standard error from a coin; the change wording is ambiguous |
| `/api/seasonality/{ticker}/year-month` | not added | - | any | not observed | open, close and change for every past month | open and close stated as prices | price packet | no: derivable from the daily candles the nightly already holds |
| `/api/shorts/{ticker}/data` | read | shorts-data | any | observed | whole body | read by the code | nightly | read |
| `/api/shorts/{ticker}/ftds` | not added | - | any | not observed | failures to deliver per settlement date: shares and price | quantity stated in shares; price withheld | positioning packet | no: published twice a month with a lag of weeks, a squeeze narrative and not a desk input; first to add if wanted |
| `/api/shorts/{ticker}/interest-float` | deprecated | - | any | not observed | short interest and float (version 1) | - | - | deprecated: version 2 is read |
| `/api/shorts/{ticker}/interest-float/v2` | read | short-interest | any | observed | market_date, short_interest, total_float, days_to_cover | read by the code | dossier | read |
| `/api/shorts/{ticker}/volume-and-ratio` | read | shorts-volume | any | observed | whole body | read by the code | nightly | read |
| `/api/shorts/{ticker}/volumes-by-exchange` | not added | - | any | not observed | short volume by exchange | shares stated | positioning packet | no: `shorts-volume` already carries the ratio |
| `/api/stock/{ticker}/atm-chains` | not added | - | any | not observed | at-the-money chains for expirations the caller names | stated | options | no: needs `expirations[]` and duplicates `option-contracts` |
| `/api/stock/{ticker}/balance-sheets` | not added | - | any | not observed | balance sheet statements | stated | fundamentals packet | no: duplicate of `financials` |
| `/api/stock/{ticker}/cash-flows` | not added | - | any | not observed | cash flow statements | stated | fundamentals packet | no: duplicate of `financials` |
| `/api/stock/{ticker}/earnings` | not added | - | any | not observed | reported and estimated EPS with the surprise | strings | earnings packet | no: the EPS history is inside `financials.earnings`, which the dossier stores |
| `/api/stock/{ticker}/expiry-breakdown` | read | expiry-breakdown | any | observed | whole body | read by the code | Worker | read |
| `/api/stock/{ticker}/financials` | read | financials | any | observed | income_statements, balance_sheets, cash_flows, earnings, fiscal_date_ending, ... | read by the code | dossier | read |
| `/api/stock/{ticker}/flow-alerts` | deprecated | - | any | not observed | a name's flow alerts | - | - | deprecated: the market-wide alerts route is read |
| `/api/stock/{ticker}/flow-per-expiry` | read | flow-per-expiry | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/flow-per-strike` | read | flow-per-strike | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/flow-per-strike-intraday` | probe only | - | any | not observed | flow by strike through the day | stated | flow | no: entitlement unanswered; asked weekly (tier 2) |
| `/api/stock/{ticker}/flow-recent` | not added | - | any | not observed | call and put premium and volume splits by expiry | stated | flow | no: duplicate of `flow-per-expiry` |
| `/api/stock/{ticker}/fundamental-breakdown` | read | fundamental-breakdown | any | observed | rev_breakdown, report_date, rev_group, members, value, ... | read by the code | dossier | read |
| `/api/stock/{ticker}/gex-levels` | read | gex-levels | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/greek-exposure` | read | greek-exposure | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/greek-exposure/expiry` | read | greek-exposure-expiry | any | observed | whole body | read by the code | Worker, engines, nightly | read |
| `/api/stock/{ticker}/greek-exposure/strike` | not added | - | any | not observed | greek exposure by strike | stated | gamma modules | no: duplicate of `spot-exposures/strike` |
| `/api/stock/{ticker}/greek-exposure/strike-expiry` | not added | - | any | not observed | greek exposure by strike and expiry | stated | gamma modules | no: duplicate of `spot-exposures/expiry-strike` |
| `/api/stock/{ticker}/greek-flow` | read | greek-flow | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/greek-flow/{expiry}` | not added | - | any | not observed | delta and vega flow per minute for one expiry | stated | flow | no: large, and the engines use the all-expiry series |
| `/api/stock/{ticker}/greeks` | probe only | - | any | observed | the vendor's greeks per strike and expiry | strings | engine cross-check | no: observed on the wire but large; a follow-up as an independent check of the engine's greeks |
| `/api/stock/{ticker}/historical-risk-reversal-skew` | read | rr-skew | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/income-statements` | not added | - | any | not observed | income statements | stated | fundamentals packet | no: duplicate of `financials` |
| `/api/stock/{ticker}/info` | read | info | any | observed | full_name, sector, issue_type, marketcap, avg30_volume, ... | read by the code | Worker, dossier, engines | read |
| `/api/stock/{ticker}/insider-buy-sells` | not added | - | any | not observed | insider purchases and sales with notional | notional stated as value | positioning packet | no: duplicate of the insider batch and `insider-flow` |
| `/api/stock/{ticker}/interpolated-iv` | added | interpolated-iv | any | not observed | implied volatility, implied move and 1-year percentile for each tenor | days and percentile stated; volatility and implied move withheld | peers packet | added: `vx.ivp`, read every night; overlaps the screener's 30-day `iv_percentile_1y`, so its unique value is the other tenors |
| `/api/stock/{ticker}/iv-rank` | read | iv-rank | any | observed | whole body | read by the code | engines, nightly | read |
| `/api/stock/{ticker}/max-pain` | read | max-pain | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/net-prem-ticks` | read | net-prem-ticks | any | observed | tape_time, net_call_premium, net_put_premium, net_delta, call_volume, ... | read by the code | Worker, engines, nightly | read |
| `/api/stock/{ticker}/nope` | read | nope | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/ohlc/{candle_size}` | read | ohlc-1d | any | observed | open, high, low, close, volume | read by the code | Worker, nightly | read |
| `/api/stock/{ticker}/oi-change` | read | oi-change | any | observed | whole body | read by the code | engines, nightly | read |
| `/api/stock/{ticker}/oi-per-expiry` | not added | - | any | not observed | call and put open interest per expiry | stated | options | no: a sum of `option-contracts`, which can disagree with a second source |
| `/api/stock/{ticker}/oi-per-strike` | read | oi-per-strike | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/option-chains` | probe only | - | any | observed | option chains with greeks | strings | options | no: observed on the wire (tier 1) but duplicates `option-contracts` |
| `/api/stock/{ticker}/option-contracts` | read | option-contracts | any | observed | whole body | read by the code | Worker, nightly | read |
| `/api/stock/{ticker}/option-stance` | probe only | - | any | not observed | a vendor trade-stance ranking of contracts with a fit score, return on capital and pop | return on capital unit not stated | none | probe only: asked weekly (tier 2) for a later comparison with our own ratio and Win %, never displayed |
| `/api/stock/{ticker}/option/stock-price-levels` | not added | - | any | not observed | option volume by price level | stated | flow | no: low value |
| `/api/stock/{ticker}/option/volume-oi-expiry` | not added | - | any | not observed | volume and open interest per expiry | stated | options | no: a sum of `option-contracts` |
| `/api/stock/{ticker}/options-pulse` | not added | - | any | not observed | the Nasdaq options pulse for a name | the spec documents no response | flow | no: the response schema is empty in the committed spec |
| `/api/stock/{ticker}/options-volume` | read | options-volume | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/ownership` | enterprise | - | Enterprise | not observed | institutions, insiders and politicians with the most shares | stated | positioning packet | no: Enterprise only; `institution/{ticker}/ownership` is read |
| `/api/stock/{ticker}/quote` | probe only | - | any | not observed | the latest trade, NBBO and quote statistics | stated | price packet | no: entitlement unanswered; asked weekly (tier 2); `stock-state` is read |
| `/api/stock/{ticker}/spot-exposures` | read | spot-exposures | any | observed | start_time, price, gamma_per_one_percent_move_oi, gamma_per_one_percent_move_vol, gamma_per_one_percent_move_dir | read by the code | Worker, nightly, rail | read |
| `/api/stock/{ticker}/spot-exposures/expiry-strike` | read | spot-exposures-expiry-strike | any | observed | whole body | read by the code | engines, nightly | read |
| `/api/stock/{ticker}/spot-exposures/strike` | read | spot-exposures-strike | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/spot-exposures/{expiry}/strike` | deprecated | - | any | not observed | spot gamma by strike for one expiry | - | - | deprecated: the expiry-strike route is read |
| `/api/stock/{ticker}/stock-state` | read | stock-state | any | observed | close, prev_close, open, high, low, ... | read by the code | Worker, dossier, engines | read |
| `/api/stock/{ticker}/stock-volume-price-levels` | probe only | - | any | not observed | lit and off-lit stock volume by price | shares stated | flow | no: entitlement unanswered; asked weekly (tier 2); if it answers it ranks above the ETF read |
| `/api/stock/{ticker}/technical-indicator/{function}` | not added | - | any | not observed | any technical indicator series | per function | price packet | no: computed from the candles the nightly holds |
| `/api/stock/{ticker}/volatility/anomaly` | read | vol-anomaly | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/volatility/character` | read | vol-character | any | observed | whole body | read by the code | nightly | read |
| `/api/stock/{ticker}/volatility/realized` | not added | - | any | not observed | 30-day implied against 21-session realised volatility | strings, units not stated | options | no: duplicate of `vrp` and the realised-volatility section |
| `/api/stock/{ticker}/volatility/stats` | not added | - | any | not observed | implied and realised volatility with 1-year highs and lows | every field is described only as the implied volatility value | options | no: the schema is copied between fields, so even the meaning is unknown; duplicates `iv-rank`, `vrp` and the realised section |
| `/api/stock/{ticker}/volatility/term-structure` | read | term-structure | any | observed | whole body | read by the code | engines, nightly | read |
| `/api/stock/{ticker}/volatility/variance-risk-premium` | read | vrp | any | observed | whole body | read by the code | dossier, engines, nightly | read |
| `/api/stock/{ticker}/volatility/term-structure/distribution` | read | term-structure-dist | Advanced+ | observed | whole body | read by the code | nightly | read; in the live documentation and not in the committed copy |
| `/api/stock/{ticker}/interpolated-iv/distribution` | read | iv-dist | Advanced+ | observed | whole body | read by the code | nightly | read; in the live documentation and not in the committed copy |
| `/api/stock/{ticker}/volatility/option-sentiment` | read | vol-sentiment | Advanced+ | observed | whole body | read by the code | nightly | read; in the live documentation and not in the committed copy |

## Registered operations without a ticker in the path

30 registry operations (market-wide, calendars, screeners, groups, sectors) all read before this branch.

| Operation | Status | Registry id | Plan | Wire | Consumers |
| --- | --- | --- | --- | --- | --- |
| `/api/option-contract/{id}/historic` | read | contract-historic | Advanced | observed | nightly |
| `/api/option-trades/multi-leg` | read | multi-leg | Advanced | observed | nightly |
| `/api/congress/recent-trades` | read | congress-recent | Advanced | observed | nightly |
| `/api/screener/stocks` | read | screener-stocks | Advanced | observed | Tier 2, Worker, nightly, rail |
| `/api/short_screener` | read | short-screener | Advanced | observed | nightly |
| `/api/option-trades/flow-alerts` | read | flow-alerts | Advanced | observed | Tier 2, Worker, nightly, rail |
| `/api/insider/transactions` | read | insider-transactions | Advanced | observed | nightly |
| `/api/market/market-tide` | read | market-tide | Advanced | observed | engines, nightly |
| `/api/market/total-options-volume` | read | total-options-volume | Advanced | observed | nightly |
| `/api/market/oi-change` | read | market-oi-change | Advanced | observed | nightly |
| `/api/market/top-net-impact` | read | top-net-impact | Advanced | observed | nightly |
| `/api/market/insider-buy-sells` | read | insider-buy-sells | Advanced | observed | nightly |
| `/api/darkpool/recent` | read | darkpool-recent | Advanced | observed | nightly |
| `/api/seasonality/market` | read | seasonality-market | Advanced | observed | nightly |
| `/api/market/sector-etfs` | read | sector-etfs | Advanced | observed | engines, nightly |
| `/api/news/headlines` | read | news | Advanced | observed | Tier 2, Worker, dossier, engines, nightly, rail |
| `/api/market/daily-report` | read | daily-report | Advanced | observed | nightly |
| `/api/net-flow/expiry` | read | net-flow-expiry | Advanced | not observed | Tier 2, nightly |
| `/api/market/economic-calendar` | read | economic-calendar | Advanced | observed | nightly |
| `/api/earnings/afterhours` | read | earnings-afterhours | Advanced | not observed | nightly |
| `/api/earnings/premarket` | read | earnings-premarket | Advanced | not observed | nightly |
| `/api/economy/{indicator}` | read | treasury-yield | Advanced | observed | nightly |
| `/api/group-flow/{flow_group}/greek-flow` | read | group-flow-greek | Advanced | observed | nightly |
| `/api/market/{sector}/sector-tide` | read | sector-tide | Advanced | observed | Tier 2, nightly |
| `/api/market/fda-calendar` | read | fda-calendar | Advanced | observed | nightly |
| `/api/option-activity/unusual` | read | option-activity-unusual | Advanced | observed | nightly |
| `/api/options-pulse/total` | read | options-pulse-total | Advanced | observed | nightly |
| `/api/volatility/anomaly/top` | read | vol-anomaly-top | Advanced | observed | nightly |
| `/api/volatility/option-sentiment/top` | read | vol-sentiment-top | Advanced | observed | nightly |
| `/api/screener/analysts` | read | analysts | Advanced | observed | dossier, engines |

## The screener is the cheapest lever

`/api/screener/stocks` is harvested for the whole screened universe every night. The wire (the 2026-10-04 shape manifest) carries about 200 keys a row; the committed spec documents 45 and the probe list's `expect` has 204 from the live documentation. `UNIVERSE_COLUMNS` reads about 35. The rest cost no call and are not stored: dividend dates and amounts (`next_dividend_date`, `latest_dividend`, `latest_dividend_date`, `latest_dividend_payment_date`, `ttm_dividend`, `dividend_yield`), the other tenors of `volatility_N` and `implied_move_perc_N`, `iv_percentile_1m`, `eps_growth_N`, `insider_*_volume_N`, `etf_share_flow`, `earnings_perc`, the moving averages and oscillators, the daily gamma components and the premium sides. The mentor's rule for storing them is a nightly unit check against the screener's own other fields (a family is unlocked for seven days after its last pass, otherwise its fields print an em dash with the reason unit unverified); it is not built on this branch and is listed under what remains in the pull request.

## Constraints that bound the additions

- Calls: the nightly pace is 150 ms between calls (400 a minute), so every call costs time; the rotation's time term is (deadline x 0.8 - baseline) / ms per name, which this branch moves from 535 to 478 names a night (two nights still cover the 794 names behind the board).
- The slow parts (the seven dossier sources, dividends, splits, ETF exposure) are read on a cadence under a per-night cap of 2,000 calls: a cold start of 856 names takes five nights, then about 1,300 to 1,900 calls a night, and no part is ever older than its maximum age.
- Bytes: `dx` is held to 24 KiB and `vx` to 8 KiB; a deep name's card-x grows by about 6 KiB in the dry run (53.5 to 59.6 KB) and is shed (as stubs) before any volatility or flow section if it nears 100 KiB.
- The dossier's on-demand fan-out stays at nine calls and charges a member token per call; nothing here widens it. A fresh nightly part is a cache hit, which frees one of the nine.
- Third-party text is cleaned with the dossier sanitiser before it is stored.
