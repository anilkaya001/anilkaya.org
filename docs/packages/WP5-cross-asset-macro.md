# WP5: cross-asset and macro backdrop

Package spec, written by the mentor for the implementer. Read `AGENTS.md` first; every rule
there applies: no comments in source, no fixture leak, TRT only, a dash with a reason and
never a fake zero, no provider name and no word "vendor" in served copy (say "the feed"),
never the word "tape" in served copy, one screen at 1920x1080, 1440x820, 1024x768 and
390x844. Never call the live feed and never read `UW_API_KEY`. Every fixture is written
from `docs/uw-openapi.yaml` (and `scripts/flows-probe-shapes.json` where it has observed a
path) by a generator, with invented figures, fixture tickers and `fixture: true`.

## 1. What this package adds, and why

Equity option flow is read against rates, the dollar, oil, gold, index futures and crypto
risk appetite. Flows shows none of it. This package adds four surfaces, three nightly
stages, one member read, and three switches.

1. **Macro page** `/flows/macro/`: one screen, eight tabs (Overview, Rates, FX,
   Commodities, Crypto, Futures, Odds, Seasonality). Every figure carries its own date or
   TRT time and its source class (`nightly` or `5-min read`).
2. **Odds beside the calendar**: prediction-market prices for scheduled macro releases
   (FOMC, CPI, payrolls, GDP, PCE, PPI), matched to the economic calendar rows the `events`
   payload already holds. Printed as "the market's price", never as the site's forecast.
   The Events page's Macro tab gains an Odds column under the same switch.
3. **Seasonality with its sample**: every seasonal share is printed with its count of
   years, a Wilson 95% interval and a coin verdict; the month's average change with a t
   interval. This answers the objection recorded in `docs/vendor-coverage.md` (line 34):
   the share is never shown bare.
4. **Private-markets lens** on the ticker page: whether the company is a disclosed
   investor in private companies, and the largest private peers in its sector by disclosed
   funding, with the feed's implied per-share mark and its date. Slow cadence, stored in
   card-x and one global.

Everything reaches a member only through `FLOWS_MACRO`; the nightly stages run under
`FLOWS_MACRO_BUILD`; the 5-minute read under `FLOWS_MACRO_LIVE`. Section 9 has the values.

Out of scope, and the reason: a dollar index (the feed has no DXY; a basket of our own
would be an invented index, so the page prints a count of majors instead, section 4.5);
gold as a commodity series (the commodities route has no gold; gold comes from the GC
futures contract and says so); any composite "risk appetite" score (no invented
indices).

## 2. The operations (read from `docs/uw-openapi.yaml`)

### 2.1 Facts the spec states and the code must respect

| path | params used | 200 shape (spec) | numerics | notes |
|---|---|---|---|---|
| `/api/futures/contracts` | `days=3` | `data[]`: `name`, `product`, `security_id`, `is_spread`, `volume`, `trades`, `high`, `low`, `last_trade` | `high`, `low` decimal strings; `volume`, `trades` integers | most active first |
| `/api/futures/flow` | `limit=500`, `products`, `include_spreads=false`, `min_size` | `data[]`: `executed_at`, `product`, `sym`, `side` (`buy`/`sell`/`none`), `size`, `price`, `nbbo_bid`, `nbbo_ask`, `crossed`, `trade_id` | `price`, `nbbo_*` strings; `size` integer | newest first |
| `/api/futures/{contract}/candles` | `interval=1d&range=3m` nightly, `interval=5m&range=1d` live | `data[]`: `o`,`h`,`l`,`c` strings, `v` integer, `start`, `end`, `date` | strings | contract is the dated symbol (`ESZ6`) |
| `/api/futures/{contract}/stats` | none | `data`: `settlement`, `settlement_date`, `open_interest`, `session_volume` | `settlement` string | the day-change reference |
| `/api/futures/{contract}/trades` | `limit=500` | as flow without `product`, `sym` | strings | live only |
| `/api/commodities/{name}` | `interval` | `data`: `{ name, unit, interval, data[]: { date, value } }` | `value` number, nullable | names: wti, brent, natural-gas, copper, aluminum, wheat, corn, cotton, sugar, coffee, all-commodities |
| `/api/economy/{indicator}` | `interval`, `maturity` | same series shape | `value` number (observed `num`) | already registered as `treasury-yield` for the 3-month rate |
| `/api/forex/rate` | `from`, `to` | `data`: `rate`, `bid`, `ask` (numbers), `from`, `to`, `last_refreshed`, `time_zone` | numbers | live only |
| `/api/forex/history` | `from`, `to`, `interval=daily` | `data`: `{ bars[]: { timestamp, open, high, low, close, volume }, from, to, interval, time_zone, ... }` | numbers | `Series Response` |
| `/api/forex/intraday` | `interval=60min` | same | numbers | live, one pair per read |
| `/api/digital-currencies/history` | `symbol`, `market=USD`, `interval=daily` | same `Series Response` | numbers | |
| `/api/digital-currencies/intraday` | `interval=5min` | same | numbers | live |
| `/api/crypto/{pair}/state` | pair `BTC-USD` | `data`: `open_24h`, `high_24h`, `low_24h`, `close_24h`, `volume_24h` strings, `timestamp`, `date` (or `null`) | strings | live |
| `/api/crypto/{pair}/ohlc/{candle_size}` | `1d` nightly `limit=90`, `5m` live `limit=288` | `data[]`: `open`,`high`,`low`,`close`,`volume` strings, `start_time`, `timestamp` | strings | |
| `/api/crypto/whales/recent` | `limit=100` | `data[]`: `pair`, `side`, `size`, `price`, `total`, `exchange`, `whaled_at`, `symbol`, `id` | strings | live |
| `/api/crypto/whale-transactions` | `limit=100` | `data[]`: `usd_value`, `transaction_type`, `blockchain`, `token_symbol`, `timestamp`, `whale_score`, plus addresses and hash | `usd_value` string | addresses never read (2.3) |
| `/api/market/movers` | none | `data`: `top_gainers[]`, `top_losers[]`, `most_active[]` of `ticker`, `price`, `change`, `change_percent`, `volume`; `last_updated` | numbers | `change_percent` unit is not stated (4.10) |
| `/api/seasonality/{month}/performers` | `min_years=10`, `s_p_500_nasdaq_only=true`, `limit=50` | rows: `ticker`, `sector`, `years`, `positive_closes`, `positive_months_perc`, `median_change`, ... | spec says number; the observed sibling route sends `str#` | read both forms |
| `/api/seasonality/{ticker}/monthly` | none | rows: `month`, `years`, `positive_closes`, `median_change`, `avg_change`, ... | as above | `avg_change` is "per day for the month": not read |
| `/api/seasonality/{ticker}/year-month` | none | rows: `year`, `month`, `open`, `close` (strings), `change` (number) | mixed | the source of every interval |
| `/api/predictions/unusual` | `categories=Finance&limit=100` | `data`: `{ categories, data[]: { asset_id, market, outcome, current, resolves, category, volume, smart_volume, unusual_score, ... } }` | strings | candidate source |
| `/api/predictions/smart-money` | `categories=Finance` | `data.data[]`: `question_id`, `title`, `resolves`, `outcomes[]: { asset_id, label, price, ... }`, `smart_gap` | strings | candidate source |
| `/api/predictions/whales` | none | `data.data[]`: `asset_id`, `question`, `outcome`, `category`, `current_price`, `resolves`, `invested_usd`, ... | strings | candidate source; filter `category == "Finance"` |
| `/api/predictions/insiders` | none | `data.data[]`: `asset_id`, `question`, `outcome`, `category`, `current_price`, `resolves`, `total_invested_usd`, ... | strings | candidate source; same filter |
| `/api/predictions/market/{asset_id}` | none | `data`: `question`, `question_type`, `outcomes[]`, `outcome_index`, `outcome_assets[]: { asset_id, label, prices[]: { date, price } }`, `liquidity`, `volume`, `end_date`, `closed`, `active`, `category` | strings | matched markets only |
| `/api/predictions/market/{asset_id}/liquidity` | none | `data`: `best_bid`, `best_ask`, `mid_price`, `spread`, `bid_liquidity`, `ask_liquidity`, `total_liquidity`, `timestamp`, `bids[]`, `asks[]` | strings | matched only |
| `/api/predictions/market/{asset_id}/positions` | none | `data[]`: `invested_usd`, `tags[]` (`bot`, ...), `smart_score`, `user_address`, ... | strings | matched only; aggregate only |
| `/api/predictions/user/{user_id}` | none | `data`: `category_scores[]: { category, win_rate, num_markets }`, ... | strings | top three holders of a matched market only; aggregate only |
| `/api/private-markets/companies` | `sector`, `limit=200`, `offset` | `data[]`: `id`, `npm_ticker`, `name`, `sector`, `sub_sectors[]`, `year_founded`, `headquarters`, `description` | n/a | alphabetical; premium |
| `/api/private-markets/companies/{npm_ticker}` | none | `data`: `company`, `total_funding` (number), `investor_count`, `latest_price: { date, price } \| null` | numbers | premium |
| `/api/private-markets/companies/{npm_ticker}/funding` | `limit=20` | `data[]`: `financing_round`, `investment_amount` (number), `investment_date` | numbers | premium |
| `/api/private-markets/companies/{npm_ticker}/pricing` | `start_date` one year back | `data[]`: `date`, `price` (number) | numbers | premium |
| `/api/private-markets/companies/{npm_ticker}/investors` | `limit=200` | `data[]`: `name` | n/a | count and firm names |
| `/api/private-markets/companies/{npm_ticker}/management` | `limit=50` | `data[]`: `first_name`, `last_name`, `title` | n/a | titles and count only (2.3) |
| `/api/private-markets/investors` | `limit=500` | `data[]`: `name`, `company_count` | integers | prolific-investor counts |
| `/api/private-markets/investors/{name}` | none | `data`: `{ name, companies[] }` | n/a | investor-match names only |
| `/api/private-markets/search` | `query`, `limit=20` | `data`: `{ companies[], investors[]: { name, company_count } }` | n/a | investor match |

### 2.2 Registry entries (`shared/flows-vendor-ops.js`, append to `RAW` after `etf-exposure`)

Add `"addon:private"` to `PLANS` (the spec calls these "a premium endpoint ... request
access"). `tests/flows-probe-contract.mjs` must accept it and plant an entry with an
unknown plan that fails.

```js
{ id: "futures-contracts", path: "/api/futures/contracts", licence: "aggregate", klass: "nightly", maxBytes: 262144, reads: ["name", "product", "is_spread", "volume", "trades", "last_trade"] },
{ id: "futures-flow", path: "/api/futures/flow", licence: "print", klass: "quote", limiter: "ondemand", maxBytes: 262144, reads: ["executed_at", "product", "sym", "side", "size", "price", "crossed"] },
{ id: "futures-candles", path: "/api/futures/{contract}/candles", licence: "quote", klass: "nightly", limiter: "ondemand", maxBytes: 131072, reads: ["o", "h", "l", "c", "v", "start", "end", "date"] },
{ id: "futures-stats", path: "/api/futures/{contract}/stats", licence: "quote", klass: "quote", limiter: "ondemand", maxBytes: 4096, reads: ["settlement", "settlement_date", "open_interest", "session_volume"] },
{ id: "futures-trades", path: "/api/futures/{contract}/trades", licence: "print", klass: "quote", limiter: "ondemand", maxBytes: 262144, reads: ["executed_at", "side", "size", "price", "crossed"] },
{ id: "commodity", path: "/api/commodities/{name}", licence: "aggregate", klass: "nightly", maxBytes: 262144, reads: ["name", "unit", "interval", "data", "date", "value"] },
{ id: "economy", path: "/api/economy/{indicator}", licence: "aggregate", klass: "nightly", maxBytes: 524288, reads: ["name", "unit", "interval", "data", "date", "value"] },
{ id: "fx-rate", path: "/api/forex/rate", licence: "quote", klass: "quote", limiter: "ondemand", maxBytes: 4096, reads: ["rate", "bid", "ask", "from", "to", "last_refreshed", "time_zone"] },
{ id: "fx-history", path: "/api/forex/history", licence: "quote", klass: "nightly", maxBytes: 524288, reads: ["bars", "timestamp", "open", "high", "low", "close", "time_zone"] },
{ id: "fx-intraday", path: "/api/forex/intraday", licence: "quote", klass: "quote", limiter: "ondemand", maxBytes: 262144, reads: ["bars", "timestamp", "open", "high", "low", "close", "time_zone"] },
{ id: "digital-history", path: "/api/digital-currencies/history", licence: "quote", klass: "nightly", maxBytes: 524288, reads: ["bars", "timestamp", "close", "time_zone"] },
{ id: "digital-intraday", path: "/api/digital-currencies/intraday", licence: "quote", klass: "quote", limiter: "ondemand", maxBytes: 262144, reads: ["bars", "timestamp", "close", "time_zone"] },
{ id: "crypto-state", path: "/api/crypto/{pair}/state", licence: "quote", klass: "quote", limiter: "ondemand", maxBytes: 4096, reads: ["open_24h", "high_24h", "low_24h", "close_24h", "volume_24h", "timestamp", "date"] },
{ id: "crypto-ohlc", path: "/api/crypto/{pair}/ohlc/{candle_size}", licence: "quote", klass: "nightly", limiter: "ondemand", maxBytes: 131072, reads: ["open", "high", "low", "close", "volume", "start_time", "timestamp"] },
{ id: "crypto-whales", path: "/api/crypto/whales/recent", licence: "print", klass: "quote", limiter: "ondemand", maxBytes: 65536, reads: ["pair", "side", "size", "price", "total", "whaled_at"] },
{ id: "crypto-whale-tx", path: "/api/crypto/whale-transactions", licence: "print", klass: "quote", limiter: "ondemand", maxBytes: 131072, reads: ["usd_value", "transaction_type", "blockchain", "token_symbol", "timestamp"] },
{ id: "market-movers", path: "/api/market/movers", licence: "quote", klass: "nightly", maxBytes: 32768, reads: ["top_gainers", "top_losers", "most_active", "ticker", "price", "change_percent", "volume", "last_updated"] },
{ id: "seasonality-performers", path: "/api/seasonality/{month}/performers", licence: "aggregate", klass: "nightly", maxBytes: 65536, reads: ["ticker", "sector", "years", "positive_closes"] },
{ id: "seasonality-monthly", path: "/api/seasonality/{ticker}/monthly", licence: "aggregate", klass: "nightly", maxBytes: 8192, reads: ["month", "years", "positive_closes"] },
{ id: "seasonality-year-month", path: "/api/seasonality/{ticker}/year-month", licence: "aggregate", klass: "nightly", maxBytes: 32768, reads: ["year", "month", "open", "close", "change"] },
{ id: "pred-unusual", path: "/api/predictions/unusual", licence: "derived", klass: "nightly", maxBytes: 262144, reads: ["asset_id", "market", "outcome", "current", "resolves", "category", "volume"] },
{ id: "pred-smart-money", path: "/api/predictions/smart-money", licence: "derived", klass: "nightly", maxBytes: 262144, reads: ["title", "resolves", "category", "outcomes", "asset_id", "label", "price"] },
{ id: "pred-whales", path: "/api/predictions/whales", licence: "derived", klass: "nightly", maxBytes: 262144, reads: ["asset_id", "question", "outcome", "category", "current_price", "resolves"] },
{ id: "pred-insiders", path: "/api/predictions/insiders", licence: "derived", klass: "nightly", maxBytes: 262144, reads: ["asset_id", "question", "outcome", "category", "current_price", "resolves"] },
{ id: "pred-market", path: "/api/predictions/market/{asset_id}", licence: "text", klass: "nightly", maxBytes: 524288, reads: ["question", "question_type", "outcomes", "outcome_index", "outcome_assets", "asset_id", "label", "prices", "date", "price", "volume", "end_date", "closed", "active", "category"] },
{ id: "pred-liquidity", path: "/api/predictions/market/{asset_id}/liquidity", licence: "quote", klass: "nightly", maxBytes: 131072, reads: ["best_bid", "best_ask", "mid_price", "spread", "total_liquidity", "timestamp"] },
{ id: "pred-positions", path: "/api/predictions/market/{asset_id}/positions", licence: "aggregate", klass: "nightly", maxBytes: 524288, reads: ["invested_usd", "tags", "user_address"] },
{ id: "pred-user", path: "/api/predictions/user/{user_id}", licence: "aggregate", klass: "nightly", maxBytes: 262144, reads: ["category_scores", "category", "win_rate", "num_markets"] },
{ id: "pm-companies", path: "/api/private-markets/companies", plan: "addon:private", licence: "text", klass: "slow", maxBytes: 524288, reads: ["npm_ticker", "name", "sector", "sub_sectors", "year_founded"] },
{ id: "pm-company", path: "/api/private-markets/companies/{npm_ticker}", plan: "addon:private", licence: "aggregate", klass: "slow", maxBytes: 16384, reads: ["company", "npm_ticker", "name", "sector", "total_funding", "investor_count", "latest_price", "date", "price"] },
{ id: "pm-funding", path: "/api/private-markets/companies/{npm_ticker}/funding", plan: "addon:private", licence: "aggregate", klass: "slow", maxBytes: 32768, reads: ["financing_round", "investment_amount", "investment_date"] },
{ id: "pm-pricing", path: "/api/private-markets/companies/{npm_ticker}/pricing", plan: "addon:private", licence: "quote", klass: "slow", maxBytes: 65536, reads: ["date", "price"] },
{ id: "pm-investors-of", path: "/api/private-markets/companies/{npm_ticker}/investors", plan: "addon:private", licence: "text", klass: "slow", maxBytes: 65536, reads: ["name"] },
{ id: "pm-management", path: "/api/private-markets/companies/{npm_ticker}/management", plan: "addon:private", licence: "text", klass: "slow", maxBytes: 32768, reads: ["title"] },
{ id: "pm-investors", path: "/api/private-markets/investors", plan: "addon:private", licence: "aggregate", klass: "slow", maxBytes: 131072, reads: ["name", "company_count"] },
{ id: "pm-investor", path: "/api/private-markets/investors/{name}", plan: "addon:private", licence: "text", klass: "slow", maxBytes: 131072, reads: ["name", "companies", "npm_ticker", "sector"] },
{ id: "pm-search", path: "/api/private-markets/search", plan: "addon:private", licence: "text", klass: "slow", maxBytes: 32768, reads: ["investors", "name", "company_count"] },
```

The existing `treasury-yield` entry stays (its `op` already names `/api/economy/{indicator}`);
`economy` is the general entry for the other nine indicators and the five other maturities.
`tests/flows-probe-contract.mjs` holds two entries sharing one spec operation as legal only
when one of them carries `op` (add the rule and a planted duplicate without `op`).

`BUDGETS` gains `macroLive: { binding: "UW_ONDEMAND", ttlS: 300, callsPerMiss: { board: 18, futures: 3, crypto: 4, fx: 1 } }`
and `macroNightly: { calls: 152 }`, `privateMarkets: { calls: 150, max: 400 }`; the probe contract holds each
figure equal to the code constant it names (`MACRO_LIVE_CALLS`, `MACRO_NIGHTLY_CALLS`, `PM_CAP`).

### 2.3 Never read, never called

| what | rule | reason (printed in the page's "What is not shown" dialog) |
|---|---|---|
| `/api/predictions/search-users` | **not registered and never called** | "The site does not look people up." A test scans `shared/`, `scripts/`, `server/`, `worker.js` and `assets/js` for the string `search-users` and fails on any hit. |
| `user_address`, `from_address`, `to_address`, `maker_address`, `taker_address`, `transaction_hash`, `user_name`, `address` | `user_address` is read transiently by the odds leg to call `pred-user` for three holders; nothing else reads it; nothing stores or prints any of them | "Wallet addresses are not shown." The payload scan (10.2) fails on `/0x[0-9a-fA-F]{40}/`, on any 64-hex string, and on any key named in this row. |
| `first_name`, `last_name` (management) | not read | "Leaders are counted by title; names are not shown." |
| `avg_change`, `max_change`, `min_change`, `median_change`, `positive_months_perc` | not read | "The feed describes the average as per day for the month; the site computes its own from each year's open and close." `positive_months_perc` is not read because it is derivable and its unit (fraction or percent) is not stated. |
| `whale_score`, `unusual_score`, `smart_score`, `smart_gap`, `tags_score`, `invested_zscore`, `pnl_percent` | not read | "The feed's scores are not explained, so they are not shown." |
| `change_percent` of movers | read, printed only after the unit test (4.10) | "The feed does not state whether this is a fraction or a percent." |
| `volume` of forex and digital-currency bars | not read | "Spot FX has no consolidated volume." |
| `description` (private companies), `question` (prediction markets) | read through the dossier sanitiser (`sanitizeText` in `shared/flows-dossier.js`), capped at 140 characters, carried with `untrusted: true` | none |

## 3. Files

New:

| path | role |
|---|---|
| `shared/flows-macro.js` | Pure leaf. Imports `flows-vendor-core.js` (`unwrap`), `flows-stats.js` (`sampleSd`, `wilson`, `meanCi`, `median`, `benjaminiHochberg`), `flows-calendar.js`, `flows-catalysts.js` (`macroTag`), `flows-fixture-names.js`, `flows-dossier.js` (sanitiser only) and `flows-macro-copy.js`. Reducers, series math, curve, odds matching, seasonality intervals, payload builder and byte fitter. |
| `shared/flows-macro-live.js` | Pure leaf for the 5-minute read: reducers of `fx-rate`, `crypto-state`, `futures-stats`, `futures-flow`, `futures-trades`, `futures-candles` (5m), `crypto-ohlc` (5m), `digital-intraday`, `fx-intraday`, `crypto-whales`, `crypto-whale-tx`, and `buildLive(part, raws, ctx)`. Imports `flows-vendor-core.js`, `flows-macro.js` (number reading, futures symbol parse), `flows-fixture-names.js`. |
| `shared/flows-private.js` | Pure leaf: private-markets reducers, the sector rotation, the investor match, the `pm` card-x section and the `pm` global builder. Imports `flows-vendor-core.js`, `flows-dossier.js` (sanitiser), `flows-fixture-names.js`. |
| `shared/flows-macro-copy.js` | Every reader-facing sentence (section 8), one frozen table, imports nothing. |
| `scripts/flows-legs/macro.mjs` | Nightly I/O: `runMacro(ctx)` through `uw()`, the pool and the deadline. |
| `scripts/flows-legs/private.mjs` | Nightly I/O: `runPrivateSectors(ctx)` and `runPrivateNames(ctx)`. |
| `scripts/flows-nightly/sections/macro.mjs` | The sections `macro`, `pm-sectors`, `pm-names`; no section imports another. |
| `server/routes/flows-macro.js` | `flowsMacroRows(deps)`: `GET /api/flows/macro` and `GET /api/flows/macro/now`. |
| `assets/js/flows-macro.js` | The page controller (`FlowsUI.macro`: `mount`, `model`, `of`). |
| `assets/js/flows-macro-charts.js` | Deferred group `macro-charts`: the curve, sparkline grid, odds history and seasonality strip painters, built on `FlowsUI.chart`. |
| `assets/js/flows-ticker-private.js` | Deferred group `private` on the ticker page. |
| `assets/css/flows-macro.css` | The page sheet. |
| `assets/css/flows-ticker-private.css` | The lens sheet, loaded through `data-css`. |
| `tests/gen-macro-fixtures.py` | Writes `tests/fixtures-macro.json` (10.1). |
| `tests/flows-macro.mjs` | Class N: the leaves, the legs, the budget. |
| `tests/server-macro.mjs` | Class N: the routes. |
| `tests/flows-macro-render.mjs` | Class C: the page. |
| `tests/flows-private-render.mjs` | Class C: the ticker lens. |
| `tests/lib/macro-world.mjs` | Builds payloads and live bodies and serves the pages with `page.route`. |
| `tests/suites/{flows-macro,server-macro,flows-macro-render,flows-private-render}.json` | Registry files with a `command` and a `shard` pin on the lightest shard. |

Edited (and only these): `shared/flows-vendor-ops.js` (2.2), `shared/flows-products.js`
(globals `macro` and `pm`), `server/store.js` (`INGEST_VIEW_KEY_RE` gains `^macro$|^pm$`),
`server/errors.js` (`macro_off`, `macro_live_off`, `invalid_part`, `invalid_pair` if absent),
`server/routes/flows-pages.js` (the `macro` page row with `gate: "FLOWS_MACRO"`, and the
`macro` flag passed to `eventsPage` and `tickerPage`), `shared/flows-pages.js` (`macroPage`,
`FLOWS_NAV` item, `TABS` keys, the events odds column flag, the ticker defer element, a
`globe` glyph), `worker.js` (one router family line, `macroOn(env, username)` modelled on
`scenesOn`, and the bound `serveCachedVendorRead`, `vendorGate`, `chargedFetch` handed to the
family), `scripts/flows-nightly/stages.mjs` (three stages), the card-x writer (merge the `pm`
section), `shared/flows-vendor-extras.js` (`SHED_ORDER` puts `pm` first), `scripts/flows-legs/health.mjs`
(`macroChecks`, three codes), `scripts/flows-legs/fake-vendor.mjs` (the 37 operations from
`tests/fixtures-macro.json`), `shared/flows-glossary.js` (twelve lines), `shared/flows-dossier.js`
(the peers packet reads `pm`, section 7.3; the macro packet reads the `macro` payload, 7.4),
`assets/js/flows-events.js` (odds column), `assets/js/flows-ticker.js` (one `buildPrivate`
call), `wrangler.toml` and `wrangler.staging.toml`, `tests/lib/d1-budget.mjs`,
`tests/flows-weight.mjs` (`DEFERRED`), `tests/flows-public-contract.mjs` (about table),
`docs/modules.json`, `assets/version.txt` via `node scripts/bump-assets.mjs`.

## 4. The leaf: `shared/flows-macro.js`

### 4.1 Number reading

`num(v)`: a finite JavaScript number passes; a string passes only when it matches
`/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i`, else `null` with reason `type:<field>`. A null is never
zero. `int(v)` requires a safe integer ≥ 0. Dates: `YYYY-MM-DD` that `flows-calendar.js`
or `Date.UTC` round-trips, else `type:date`. Instants: `instantOf` of `shared/flows-time.js`
(a zone-less string is refused, so the TRT clock is never guessed).

`time_zone` (FX and digital series, `fx-rate`): a bar `timestamp` or `last_refreshed` is an
instant only when it carries `Z` or an offset, or when `time_zone` is exactly `UTC` (then
`Z` is appended). Any other zone: the date part is kept, the time is withheld with
`zone`, and the page prints the date alone. The site never converts a named zone it was
not built to read.

### 4.2 Series

```js
export function seriesOf(raw, { field = "data" })      // economy, commodity
export function barsOf(raw)                             // fx-history, digital-history
export function dailyStats(points, { year = 252 })
```

`seriesOf` returns `{ status, unit, interval, name, points: [[date, value]] }`, sorted by
date ascending, duplicate dates collapse to the later row, null values dropped and counted
in `nulls`. `unit` is the feed's string, sanitised, at most 40 characters, or `null`.
**A series with `unit === null` is `withheld` with `unit`**: its points are kept for the
spark line but no value or change is printed (the spark has no y labels in that state).

`dailyStats` on `[[date, close]]`: `last`, `prev` (the previous point), `chg1 = last/prev − 1`,
`chg21` (21 points back, else `null` with `short`), `rv21 = sampleSd(ln returns of the last
22 points) × sqrt(year)` with `year` 252 for futures and FX and 365 for crypto (labelled
"annualised on 252 days" or "365 days"), `null` with `short` under 22 points.

Economy and commodity series are **not** daily unless `interval === "daily"`: for monthly or
quarterly series `chg1` is renamed `chgPrev` and printed as "against the previous
release", and `rv21` is not computed. No day change is ever printed for a series that is
not daily.

### 4.3 Rates

Treasury maturities `["3month", "2year", "5year", "7year", "10year", "30year"]`, interval
`daily`. `curve(points)` returns, per maturity, the latest value and its date, and the
values on the latest date at or before 21 and 252 points back (`m1`, `y1`), each with its
own date. A maturity whose latest date differs from the 10-year's latest date is drawn,
but marked `asOf` with its own date. Spreads in basis points: `s2s10 = (10y − 2y) × 100`,
`s3m10 = (10y − 3m) × 100`, only when both legs share a date, else `null` with `dates`.
State: `inverted` when the spread is below −5 bp, `flat` within ±5 bp, `normal` above.
`RATE_FLAT_BP = 5` appears once. Values are percent, as the series unit says; if the unit
string of a maturity does not contain `percent` (case-insensitive), the whole curve is
`withheld` with `unit` (never rescaled).

Fed funds: `economy/fed-funds?interval=daily`. Printed beside the curve with its date.

Indicators `["cpi", "inflation", "unemployment", "payrolls", "retail-sales", "durables",
"gdp", "gdp-per-capita"]`, interval `monthly` (`quarterly` for gdp and gdp-per-capita):
last, previous, `chgPrev`, the last 24 points for the spark, the date of the last point,
and `ageDays` from the last point's date to the session.

### 4.4 Commodities

`wti`, `brent`, `natural-gas` with `interval=daily`; `copper`, `aluminum`, `wheat`, `corn`,
`cotton`, `sugar`, `coffee`, `all-commodities` with `monthly`. Gold is not in this route:
its tile reads the GC futures front contract (4.6) and says "from the gold futures
contract". `wti` and `brent` both present on a shared date: `brentWti = brent − wti` in the
series unit.

### 4.5 FX

Pairs, fixed: `EURUSD`, `USDJPY`, `GBPUSD`, `USDCHF`, `AUDUSD`, `USDCAD`, `USDCNY`, `USDTRY`
(from/to split at three letters). Daily bars, 63 points kept. `dailyStats` as 4.2.

Dollar breadth, never an index: over the seven pairs other than `USDTRY` and with a
`chg1`, count how many show the dollar stronger (`USDxxx` up, `xxxUSD` down). Printed as
"Dollar up against 5 of 7 majors over the last day", with `n` the pairs that had a
change. Fewer than five pairs: `null` with `few`.

### 4.6 Futures

```js
export const PRODUCTS = Object.freeze({
  ES: "S&P 500", NQ: "Nasdaq-100", RTY: "Russell 2000", YM: "Dow",
  ZT: "2-year note", ZN: "10-year note", ZB: "Bond",
  CL: "Crude oil", NG: "Natural gas", GC: "Gold", SI: "Silver", HG: "Copper",
  "6E": "Euro", "6J": "Yen",
});
export const MONTH_CODES = "FGHJKMNQUVXZ";
export function parseContract(sym, product, session)
export function frontOf(contracts, product)
export function curveOf(contracts, statsBySym, product, session)
```

`parseContract`: `^(<product>)([FGHJKMNQUVXZ])(\d{1,2})$`. A one-digit year resolves to the
year in `[sessionYear, sessionYear + 9]` whose last digit matches; a two-digit year to
`2000 + yy`. A contract month before the session's month is refused (`expired`). Returns
`{ sym, product, y, m, label: "Dec 26" }` or `null` with `symbol`.

`frontOf`: among `futures-contracts` rows with `product === p`, `is_spread === false` and a
parseable symbol, the one with the largest `volume` (ties to the earlier month). The page
names it "most active contract", never "front month", because the feed orders by activity.

`curveOf` for `ES`, `CL`, `ZN`: the up to six parseable non-spread contracts of the product
nearest in month, each with `futures-stats` `settlement`, `settlement_date`,
`open_interest`, `session_volume`. A contract whose `settlement_date` is not the session
or the session's previous trading day is drawn hollow with `stale`. `spread12 =
second.settlement / first.settlement − 1` by month order, only when both share a
`settlement_date`, else `null` with `dates`. The state word is `contango` when `spread12 > 0`,
`backwardation` when below, `flat` when exactly zero; for ES the page adds "index futures
usually sit above spot by carry" so the word is not read as a signal.

Daily candles: `futures-candles` `interval=1d&range=3m` for the most active contract of each
of the fourteen products; `dailyStats` with `year` 252. A candle's `date` is the session
date; `end` is the instant.

Large prints: `futures-flow` with `include_spreads=false&limit=500` and `products=` one
group at a time, `min_size` from `LARGE = { ES: 100, NQ: 50, RTY: 50, YM: 50, ZN: 500, ZB: 200, ZT: 500, CL: 50, NG: 50, GC: 25, SI: 25, HG: 25, "6E": 100, "6J": 100 }`,
grouped into five calls (`ES,NQ,RTY,YM`, `ZT,ZN,ZB`, `CL,NG`, `GC,SI,HG`, `6E,6J`; the
minimum of the group's floors is sent and each row is filtered by its own product's floor
in the leaf). Per product: buy, sell and none counts and contract totals over the window,
the window's first and last `executed_at`, and the twenty largest prints `[at, product,
sym, side, size, price]`. `crossed === true` prints are counted apart and never sided.
`side: "none"` is unsided, never split.

### 4.7 Crypto

Pairs `BTC-USD`, `ETH-USD`, `SOL-USD` (symbols `BTC`, `ETH`, `SOL`, market `USD`).
Nightly: `digital-history` daily and `crypto-ohlc` `1d` `limit=90`. `dailyStats` with `year`
365 on the digital series. **Source check**: on the latest date both carry, `gap = |a/b − 1|`;
`agree` when `gap ≤ 0.005`, `differs` above, `nc` with `dates` when no common date. The
page prints the digital series and the check, never an average of the two.

### 4.8 Movers

`market-movers` lists, five rows each, real symbols only where the feed sends them;
`price`, `volume`, `change_percent` (4.10). `last_updated` is an instant or withheld.

### 4.9 Seasonality

```js
export const SEASON_FUNDS = Object.freeze(["SPY", "QQQ", "IWM", "DIA", "XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLB", "XLU", "XLRE"]);
export function monthRows(yearMonthRaw, month, sessionYear)
export function seasonCell(rows)
export function performersTable(raw, month)
```

`monthRows`: rows with `month` equal to the target month and `year < sessionYear` (the
current year's month is incomplete and never counted). Each row's change is computed as
`close / open − 1` from the row's own `open` and `close` ("first open to last close of
the month"). The feed's `change` is checked against it: `fraction` when every row agrees
within `1e-3`, `percent` when every row agrees after dividing by 100, else `mixed`; the
page prints the unit check in the details dialog and always uses the computed change.

`seasonCell(rows)`: `n` years, `k` positive, `share = k/n`, Wilson 95% `[lo, hi]`
(`wilson` in `flows-stats.js`), mean change and its t interval (`meanCi`), median.
`coin = lo ≤ 0.5 ≤ hi`, `zero = meanLo ≤ 0 ≤ meanHi`. Under 8 years: `null` with `few`
and nothing but the count printed.

`performersTable`: `seasonality-performers` for the session's month and the next month,
`min_years=10&s_p_500_nasdaq_only=true&limit=50`. Per row `n = years`, `k =
positive_closes` (integers; a row whose `k > n` is refused `range:positive_closes`), Wilson
interval, and a one-sided exact binomial p of `k` or more successes at 0.5. Benjamini-
Hochberg at q = 0.10 across the rows returned (`benjaminiHochberg`). Rank by Wilson lower
bound, not by the share. Keep ten. Print the count that survives the correction ("2 of 50
names remain distinguishable from a coin after correcting for 50 tested"), even when it
is zero. No change figure is printed for a performer: the feed's change fields carry no
stated unit and no year-month rows are read for performers to test one, so the only column
is the Wilson interval.

Cross-check: `seasonality-monthly` for SPY, QQQ, IWM, DIA; its `years` and
`positive_closes` for the month must equal the leaf's `n` and `k` from year-month; a
mismatch is recorded in `basis` and printed in the details dialog ("The feed's two
seasonality tables count 18 and 17 years for SPY."), and the year-month figures stand.

### 4.10 The percent test for `change_percent`

Movers: `r = change / (price − change)` when all three are numbers. `fraction` when
`|change_percent − r| ≤ 1e-3`, `percent` when `|change_percent/100 − r| ≤ 1e-3` over at
least three rows and every tested row agrees, else `null`. With `null` the column is
withheld for the whole list with reason `unit`. The leaf never rescales to agree.

### 4.11 Odds beside the calendar

```js
export const ODDS_TAGS = Object.freeze({
  fomc: /\b(fed|fomc|federal reserve|interest rates?|rate (cut|hike)|basis points?|bps)\b/i,
  cpi: /\b(cpi|inflation)\b/i,
  nfp: /\b(non-?farm|payrolls?|jobs report|unemployment rate)\b/i,
  gdp: /\b(gdp|recession)\b/i,
  pce: /\bpce\b/i,
  ppi: /\bppi\b/i,
});
export const ODDS_WINDOW = Object.freeze({ beforeMs: 864e5, afterMs: 7 * 864e5 });
export const ODDS_THIN = Object.freeze({ liquidityUsd: 50000, spread: 0.05 });
export function candidates({ unusual, smart, whales, insiders })
export function matchOdds(calendarRows, candidates)
export function oddsMarket(detail, liquidity, positions, holders)
```

`candidates`: the union by `asset_id` of the four list routes, `category === "Finance"`
(case-sensitive, as the spec lists it) or, for the two routes taken with `categories=Finance`,
every row. Each candidate: `{ id: asset_id, question (sanitised), outcome, resolves (instant),
price }`. Prices are strings in [0, 1]; outside is refused `range:price`.

`matchOdds`: a calendar row (from the `events` payload's `macro.rows`, `tag` from
`macroTag`) matches a candidate when the candidate's question matches `ODDS_TAGS[tag]` and
`resolves` lies in `[at − beforeMs, at + afterMs]`. A candidate may match one row only: the
nearest by `|resolves − at|`. At most two markets per calendar row (largest volume first) and
eight in all. Unmatched Finance candidates with an `ODDS_TAGS` hit and `resolves` within 30
days: kept separately (`unmatched`, at most six), printed as "Not tied to a calendar
release".

`oddsMarket` on the three detail calls (`pred-market`, `pred-liquidity`, `pred-positions`):
- the outcome printed is the one whose `asset_id` is the matched id (its `label`); for a
  binary question that is usually "Yes", and the page prints the label as the feed gives it;
- `price` = `mid_price` when `best_bid` and `best_ask` are both present and the spread is
  at most `ODDS_THIN.spread`, else the last of the outcome's `prices`, marked `last`;
- `thin` when `total_liquidity < 50,000` (USD, as the field name says) or the spread is
  above 0.05: the price is drawn hollow with "thin market";
- `history`: the outcome's `prices` for the last 30 dates;
- `top5Share`: invested by the five largest positions over the sum of all positions'
  `invested_usd`; `botShare`: share of invested held by positions tagged `bot`. Fewer than
  ten positions: both `null` with `few`;
- `holders`: `pred-user` for the three largest positions; the median `win_rate` of their
  `category_scores` row whose `category` is the market's category, with `n` the holders
  that had one; addresses dropped at once (`holders` is computed and the address array
  is cleared inside the function; 10.2 checks).
- `closed === true` or `active === false`: the market is kept with `resolved` and its last
  price, printed "resolved", never as live odds.

Wording is fixed (section 8): "Prediction-market price 62%: the market's number, not a
forecast." The page never prints "probability" or "chance" alone.

### 4.12 Fixture refusal

Every builder runs `fixtureNameIn` over its output and throws on a fixture name unless
handed `{ test: true }`; the leg passes it only in the dry run.

## 5. Payloads

### 5.1 `macro` (nightly global, cap 96 KiB; `fitMacro` sheds in order: `futures.large`, `odds.unmatched`, `seasonality.performers.next`, every `spark` cut to its last 21 points, `odds[].history`)

```text
{ v: 1, session: "YYYY-MM-DD", generatedAt: ISO, fixture?: true,
  rates: { status, why?, unit, curve: [[maturity, value, date, m1Value, m1Date, y1Value, y1Date]],
           spreads: { s2s10, s3m10, state }, fedFunds: [value, date] | null },
  economy: { "<indicator>": { status, why?, unit, interval, last: [date, value], prev: [date, value], chgPrev, ageDays, spark: [[date, value]] } },
  commodities: { "<name>": { status, why?, unit, interval, last, prev, chg1 | chgPrev, spark }, brentWti },
  fx: { pairs: { "<PAIR>": { status, why?, last: [date, close], chg1, chg21, rv21, spark } }, breadth: { up, n } | null, breadthWhy? },
  crypto: { "<SYM>": { status, why?, last: [date, close], chg1, chg21, rv21, spark, check: { v, gap, date } } },
  futures: { asOf, products: { "<P>": { status, why?, sym, label, volume, trades, last, chg1, rv21, spark } },
             curves: { ES | CL | ZN: { status, why?, points: [[sym, label, settlement, settleDate, oi, vol, stale]], spread12, state } },
             large: { window: [from, to], byProduct: { "<P>": { buy: [n, size], sell: [n, size], none: [n, size], crossed: [n, size] } }, top: [[at, p, sym, side, size, price]] } },
  movers: { status, why?, asOf, unit, gainers: [[t, price, pct, volume]], losers, active },
  seasonality: { month, next, funds: { this: [[t, n, k, lo, hi, mean, meanLo, meanHi, median]], next: [...] },
                 performers: { this: { tested, survive, rows: [[t, sector, n, k, lo, hi, q]] }, next: { ... } },
                 checks: { "<T>": { feedYears, years, feedPositive, positive, unit } } },
  odds: { status, why?, events: [{ at, event, tag, markets: [{ id, question, outcome, price, basis: "mid"|"last",
          bid, ask, spread, liquidity, volume, thin, resolved, resolves, top5Share, botShare, holders: { median, n } | null, history }] }],
          unmatched: [{ id, question, outcome, price, resolves, tag }], counts: { candidates, finance, matched, thin } },
  basis: { ops: { "<op id>": { status, n, why? } }, calls } }
```

### 5.2 `pm` (nightly global, cap 64 KiB)

```text
{ v: 1, session, generatedAt, fixture?,
  sectors: { "<universe sector>": { status: ok|unmatched|plan|failed, listed, cursor, profiled, complete: date|null,
             top: [[npm, name, totalFunding, investorCount, price, priceDate, chg1y, lastRound: [date, round, amount], leaders, subSectors]] } },
  investors: { asOf, n, top: [[name, companyCount]] (≤ 300) },
  basis: { calls, plan: bool } }
```

`top` holds at most 40 per sector by `total_funding` among the profiled companies; the page
shows six. `price` is the latest `pricing` point and `chg1y` uses the point nearest one
year before it, at most 30 days away, else `null` with `gap`. `leaders` is the count of
management rows with a non-empty title.

### 5.3 `pm` section of `card-x:<T>` (budget 1.5 KiB; `SHED_ORDER` sheds it first)

```text
pm: { at: ISO, rv: 1, session, match: { name, companyCount, companies: [[npm, name, sector]] (≤ 8) } | null, why? }
```

`why` when `match` is null: `none` (searched, no investor of that name), `ambiguous`
(more than one investor normalises to the name), `plan`, `failed`.

### 5.4 The 5-minute member read (never stored in D1)

```text
GET /api/flows/macro/now?part=board
{ v: 1, part: "board", readAt: ISO,
  fx: { "<PAIR>": { status, rate, bid, ask, at, why? } },
  crypto: { "<PAIR>": { status, close, open, high, low, volume, at, chg24, why? } },
  futures: { "<P>": { status, sym, settlement, settlementDate, oi, volume, why? } } }   (P in ES, NQ, RTY, YM, ZN, CL, GC: 8 + 3 + 7 = 18 calls)
part=futures: { window: [from, to], byProduct, es: { sym, window, buy, sell, none, crossed }, candles: [[endAt, o, h, l, c, v]] }
part=crypto:  { btc5m: [[at, close]], intradayCheck: { v, gap, at }, whales: { window, buy: [n, usd], sell: [n, usd], byPair: [[pair, buyUsd, sellUsd]] },
                transfers: { window, n, usd, byType: [[type, n, usd]], byChain: [[chain, n, usd]] } }
part=fx&pair=EURUSD: { pair, bars: [[at, close]], timeZone }
```

`chg24 = close_24h / open_24h − 1`. Whale `total` and `usd_value` are dollars as their
names say; a row with a null value is counted in `n` and excluded from the sums, with the
count printed.

### 5.5 Registry and budget

`shared/flows-products.js`: `global("macro", { capBytes: 96 * 1024, required: ["v", "session"] })`
and `global("pm", { capBytes: 64 * 1024, required: ["v", "session"] })`. `tests/lib/d1-budget.mjs`:
nightly writer `+2` rows; readers: `/api/flows/macro` 1 row (or 0 from the Cache API),
`/api/flows/macro/now` 1 row on a cache miss (the `macro` payload for the most active
symbols), 0 on a hit. `flows-d1-budget` must price both statements.

## 6. Pipeline

### 6.1 Stages (`scripts/flows-nightly/stages.mjs`)

```js
stage("macro", ISOLATION.isolated, ["events"], ["macro"]),          // after "events"
stage("pm-names", ISOLATION.isolated, ["dossiers"]),               // after "dossiers", before "focus"
stage("pm-sectors", ISOLATION.isolated, ["compute"], ["pm"]),       // after "oracle-publish"
```

`macro` reads `ctx.publishedStore.events.macro.rows` for the calendar (no second calendar
call). `pm-names` puts `ctx.pmNames = Map<T, pm>`; the existing `card-x` stage merges it
into the one write it already makes. `meta.macro` gets
`{ calls, ops: { "<op>": { n, bad } }, odds: { matched, thin }, pm: { calls, names, sectors } }`.

`FLOWS_MACRO_BUILD=off` skips the three stages (records `skip`), the card-x bytes equal the
off run, and the golden emit is unchanged for every other key. Regenerate
`tests/fixtures-pipeline-golden.json` with `--write`; only `macro`, `pm`, `meta` and
`card-x:*` may move.

### 6.2 Calls and status filing

Nightly `macro`, at most 152 (`MACRO_NIGHTLY_CALLS`): economy 15 (six maturities, fed funds,
eight indicators), commodities 11, fx-history 8, digital-history 3, crypto-ohlc 3,
futures-contracts 1, futures-stats 18 (three curves of six), futures-candles 14, futures-flow
5, movers 1, seasonality 21 (performers 2, year-month 15, monthly 4), predictions at most 52
(four lists, three detail calls for at most eight markets, three holder calls for each).

`pm-names`: up to `PM_NAMES_CAP = 30` carded names a night, never-searched first by
liquidity, then the oldest `pm.at`; search 1, and `pm-investor` 1 only for a unique match.
Refresh 30 days, maximum age 60 (the extras rule: a failed read keeps the good section
inside its maximum age). Query: the company name from card-x `dx.info.full_name`, else
`dx.profile.name`, normalised by removing a trailing `Inc`, `Inc.`, `Corp`, `Corporation`,
`Co`, `Ltd`, `plc`, `Holdings`, `Group`, `Class A`, punctuation and case; names shorter than
four characters after normalising are not searched (`short`). A match is an investor whose
normalised name equals the query.

`pm-sectors`: one rotation sector a night, in a fixed order over the universe's sectors;
`pm-companies` with `sector=<universe sector string>` and `offset=cursor`, 200 a page, one
page; `pm-company` for every row of the page not profiled within 60 days, up to the cap;
then for the sector's top six by funding whose detail is older than 14 days, `pm-funding`,
`pm-pricing`, `pm-management`, `pm-investors-of` (the latter two every 60 days); then
`pm-investors` once a week. A page that returns no rows at `offset=0` is `unmatched`
("The feed lists no private companies under this sector name"). The total of both PM
stages is capped by `FLOWS_PM_CAP` (default 150, clamped 0 to 400).

Status filing as the extras leg: 429 `limited`; 401, 402, 403, 404, 422 `plan` (stored; the
operation is not asked again for 7 sessions, and with a plan refusal on `pm-companies` the
whole PM group sleeps for 7 sessions); anything else `failed`.

### 6.3 Health (`scripts/flows-legs/health.mjs`)

```js
export function macroChecks(meta, standing)
```

- `macro-shape`: an operation whose reducer failed (`type:`, `range:`) on more than 20% of at
  least 10 attempts: warn.
- `macro-missing`: the `macro` key not written while `FLOWS_MACRO_BUILD` is on: warn; fail
  only with seven clean nights behind it (the `extrasStanding` rule).
- `macro-address`: any address-shaped string in the built payload (the 10.2 scan run on the
  real output): fail at once, no standing needed.
Add the three to `HEALTH_CODES`.

## 7. Worker

### 7.1 `server/routes/flows-macro.js`

```js
export function flowsMacroRows({ store, ensureFlowsTables, isOwner, macroOn, macroLiveOn, nightlyFreshHeaders, recallLastGood, edgeCache, internalKey, serveCachedVendorRead, vendorGate, chargedFetch, uwFetchFor })
```

Rows, both `methods: ["GET"]`, `auth: "flows"`:

1. `macro`, `/api/flows/macro`. After the router's method and session gates: `macroOn`
   (`FLOWS_MACRO` `on` admits every member, `owner` admits `isOwner`, anything else `404
   macro_off` for everyone, the same body for a non-owner so the switch is not leaked).
   `part` from the closed list `rates|economy|commodities|fx|crypto|futures|movers|seasonality|odds|pm`
   or absent; anything else `400 invalid_part`. `part=pm` also takes `sector=` (a string
   that is a key of `pm.sectors`, else `400 invalid_part`) and reads the `pm` key; every
   other part reads `macro`. One `store.read`; the projection is cached in the Cache API for
   300 s under `internalKey("macro", part + "/" + sector)`, never written over the whole
   payload's last good copy. Absent: `200 { status: "pending", why: "not_published" }` with
   `X-Fresh-State: pending`. Unreadable store: last good copy (`X-Fresh-Reason: store`) or
   `503 store_quota`. Rows read 1, or 0 on a cache hit.
2. `macro-now`, `/api/flows/macro/now`. The same `macroOn` gate, then `macroLiveOn`
   (`FLOWS_MACRO_LIVE`: `on`, `owner`, else `404 macro_live_off`). `part` one of
   `board|futures|crypto|fx`, else `400 invalid_part`; `fx` requires `pair` in the eight of
   4.5, else `400 invalid_pair`. The cache key is **shared by all members**:
   `internalKey("macro-now", part + (pair ? "/" + pair : ""))`. Served through
   `serveCachedVendorRead({ cacheKey, ttlSeconds: 300, gate: vendorGate(env, session), build })`,
   whose builder takes `chargedFetch(env, gate)` and makes exactly the calls of
   `BUDGETS.macroLive.callsPerMiss[part]`; a refusal mid-build stops the remaining calls
   (`VendorRefused`), and the response follows the existing rules: the kept copy (six
   hours) stamped `X-Fresh-State: stale`, `X-Fresh-Reason: throttled`, or `429
   rate_limited` with `Retry-After: 60`. `board` and `futures` read the `macro` payload
   (1 row) for the most active symbols; with no payload, `futures` entries are `null` with
   `no-symbols` and only FX and crypto are called. No `refresh` parameter.

`server/errors.js` gains `macro_off: [404, "Not found"]`, `macro_live_off: [404, "Not found"]`,
`invalid_pair: [400, "Invalid pair"]` (and `invalid_part` if absent).

`worker.js`: `macroOn` and `macroLiveOn` exactly like `scenesOn`; the family on the router;
`tests/flows-reads-contract.mjs` gains both ceilings. The vendor-budget suite holds
`callsPerMiss` against the `UW_ONDEMAND` limit: the worst case of one miss of every part in
one minute (26 calls) is under the limiter's 120.

### 7.2 Pages

`server/routes/flows-pages.js`: `{ slug: "macro", gate: "FLOWS_MACRO", render: (username, summary, owner, scenes, env) => FLOWS_PAGES.macroPage({ username, live: macroLiveOn(env, owner) }) }`
after `ledger`. `eventsPage({ username, odds })` and `tickerPage({ username, scenes, privateLens })`
receive the flag from `macroOn`. Off: byte-for-byte the current pages (no nav item, no
column, no defer element). `FLOWS_NAV` gains `{ key: "macro", href: "/flows/macro/", label:
"Macro", glyph: "globe", gate: "macro" }` after `ledger`, emitted only when the shell is told
`macro: true` (add a `gates` option to `shell` the way `ownerNav` is added after the fact:
`macroNav(rendered)` inserts the item, so the off page is unchanged). `TABS` Market keys gain
`"macro"`. Glyph `globe`: a 24-unit circle with one meridian ellipse and the equator,
stroke only, added to `GLYPHS`.

### 7.3 Dossier peers packet

`buildPeersPacket` reads card-x `pm` and, when the route's caller passes it, the `pm` sector
entry. Facts (grade 2 when the section is inside its refresh age, 1 inside its maximum age,
held `expired` beyond): `pm.investor` ("Disclosed investor in private companies", count),
`pm.peers` ("Largest private peers by disclosed funding", up to five names, text),
`pm.peerMark` (the largest peer's implied per-share mark with its date, `usd`, note "the
feed's implied per-share price, not a trade"). Held reasons: `plan`, `unmatched`, `none`.
These ids need no entry in `shared/flows-fact-ids.js` (dossier ids outside
`options.engine.*` are not registered there); `tests/flows-dossier-contract.mjs` gains them
in its recording-proxy read list.

### 7.4 Dossier macro packet

`buildMacroPacket` adds, from the `macro` payload when its session is under two sessions
behind: `rates.s2s10` (bp, signed), `rates.10y` (percent), `fx.breadth` (count text),
`futures.ES.chg1` (fraction, signed), `crypto.BTC.chg1`, and `odds.next` (the nearest matched
release with its market price, text, note "the market's number, not a forecast"). The
reading's numeral guard sees each as a cited fact; `tests/flows-reading.mjs` gains one
archetype dossier with the macro facts.

## 8. Copy (`shared/flows-macro-copy.js`; at most 14 words a sentence; no forecast, advice, "tape", "vendor" or provider name)

```text
title.page            Macro
title.overview        Cross-asset board
title.rates           Rates
title.curve           Treasury curve
title.indicators      Economy
title.fx              Currencies
title.commodities     Commodities
title.crypto          Crypto
title.futures         Futures
title.large           Large futures prints
title.odds            Odds beside the calendar
title.season          Seasonality
src.nightly           Nightly, as of {date}.
src.live              Read {time}, refreshed at most every 5 minutes.
src.live.stale        Kept copy from {time}; the read limit was reached.
rates.spread          2s10s {sign}{bp} bp: {state}.
rates.state.inverted  Inverted: the 2-year yields more than the 10-year.
rates.state.flat      Flat: within 5 bp.
rates.state.normal    Normal: the 10-year yields more than the 2-year.
rates.asof            This maturity is as of {date}.
series.prevrelease    {chg} against the previous release of {date}.
series.unit           The feed states no unit, so no value is printed.
series.age            Last release {date}, {days} days ago.
fx.breadth            Dollar up against {up} of {n} majors over the last day.
fx.breadth.few        Too few pairs read to count the dollar's breadth.
fx.nodxy              The feed carries no dollar index; this count is not one.
fx.zone               Time withheld: the feed names a zone the site does not read.
commodities.gold      Gold is read from the most active gold futures contract.
commodities.monthly   Monthly series: compared with the previous month, not the previous day.
crypto.check.agree    Two of the feed's tables agree within 0.5%.
crypto.check.differs  The feed's two tables differ by {gap}; the daily series is shown.
crypto.rv             Realised, annualised on 365 days.
futures.active        Most active contract, as the feed ranks them.
futures.curve         Settlement by contract month.
futures.carry         Index futures usually sit above spot by carry.
futures.stale         Settled {date}; not the last session.
futures.window        Prints from {from} to {to}.
futures.none          Unsided: the feed gives no aggressor side.
futures.crossed       Crossed-quote prints are counted apart, never sided.
odds.price            Prediction-market price {p}: the market's number, not a forecast.
odds.thin             Thin market: under $50K of liquidity or a spread above 5 points.
odds.last             Last traded price; no two-sided quote.
odds.resolved         Resolved; this is the final price.
odds.concentration    Five largest holders hold {s} of the money in it.
odds.bots             Accounts the feed tags as bots hold {s}.
odds.holders          Its three largest holders win {w} of {cat} markets, by the feed's record.
odds.unmatched        Not tied to a calendar release.
odds.none             No prediction market matches this release.
season.cell           Up in {k} of {n} years: {lo} to {hi} at 95%.
season.coin           Indistinguishable from a coin flip.
season.mean           Average {m}, interval {a} to {b}.
season.zero           The average is not distinguishable from zero.
season.few            Fewer than 8 years: no share is shown.
season.def            First open to last close of each month, past years only.
season.screen         {s} of {n} names remain distinguishable from a coin after correction.
season.rank           Ranked by the low end of the interval, not the share.
season.check          The feed's two seasonality tables count {a} and {b} years.
movers.unit           The feed does not state whether this is a fraction or a percent.
private.investor      Disclosed investor in {n} private companies.
private.none          Not listed as a disclosed private-markets investor.
private.peers         Largest private peers in {sector}, by disclosed funding.
private.mark          The feed's implied per-share price on {date}; not a trade.
private.coverage      Profiles read for {p} of {l} companies listed in this sector.
private.unmatched     The feed lists no private companies under this sector name.
private.plan          Private-markets data needs a feed plan the site does not hold.
private.leaders       {n} disclosed leaders; names are not shown.
state.pending         Tonight's run has not published this yet.
state.failed          The feed's {what} read failed tonight; this is not an empty table.
state.limited         The feed's read limit was reached; tonight's run kept the last copy.
state.live.off        Live reads are off; nightly figures only.
state.withheld        Withheld: {reason}.
nothere.title         What is not shown
nothere.people        The site does not look people up or show wallet addresses.
nothere.scores        The feed's scores are not explained, so they are not shown.
```

Every sentence passes `tests/flows-guard-lexicon.mjs`, `tests/lib/copy-lint.mjs` and
`tests/flows-copy-lint.mjs`. Glossary (`shared/flows-glossary.js`, each the exact string the
information button opens): 2s10s spread, Inverted curve, Dollar breadth, Most active
contract, Contango (futures), Aggressor side, Prediction-market price, Thin market,
Wilson interval, Distinguishable from a coin, Implied per-share mark, Disclosed investor.
`aboutPage` gains a Macro line (`flows-public-contract` holds its table equal to `FLOWS_NAV`).

## 9. Switches

| name | values | shipped (`wrangler.toml`) | staging | effect |
|---|---|---|---|---|
| `FLOWS_MACRO` | `on`, `owner`, else off | `owner` | `on` | the page, its nav item, `/api/flows/macro`, the Events odds column, the ticker lens, the dossier facts |
| `FLOWS_MACRO_LIVE` | `on`, `owner`, else off | `owner` | `off` (staging has no feed key) | `/api/flows/macro/now` |
| `FLOWS_MACRO_BUILD` | `off`, else on (pipeline env, set in the nightly workflow) | on | n/a | the three stages |
| `FLOWS_PM_CAP` | 0 to 400 (pipeline) | 150 | n/a | private-markets calls a night |

`tests/server-pages.mjs` holds both directions of `FLOWS_MACRO` for every page it touches.

## 10. Tests

### 10.1 Fixtures: `tests/gen-macro-fixtures.py`

Writes `tests/fixtures-macro.json` with `provenance: { generator, sha256 of itself, spec
sha256, shapes sha256, nature: "synthetic, written from the schema; not feed data" }`.
Every key and JSON type from the 200 schemas of 2.1; decimal strings as strings where the
schema says string; the seasonality rows in both the spec's number form and the observed
`str#` form; the generator exits 1 on a key the observed manifest lists differently
(`/api/economy/{indicator}`, `/api/seasonality/market`). Real symbols only where the code
keys on them (the fourteen futures products, the fifteen funds, the eight pairs, BTC, ETH,
SOL); every mover, performer and investor-matched ticker is a fixture name (`SYX101`...).
Private companies and investors are invented (`Sample Robotics`, `npm_ticker` `SYPM01`...);
prediction questions are invented sentences; addresses are generated as
`"0x" + 40 hex` so the scan has something to catch, and are only ever in the raw bodies.

Worlds: `ok`; `curve-inverted` (2y above 10y by 12 bp); `curve-mixed-dates`; `unit-null`
(cpi and copper with `unit: null`); `fx-zone` (`time_zone: "US/Eastern"`); `crypto-differs`
(gap 0.8%); `futures-stale` (one settlement two sessions back); `symbol-bad` (`ESZ`,
`ES-Z6`, `NQH9` in a 2026 session resolving to 2029); `movers-percent`, `movers-fraction`,
`movers-mixed`; `season-few` (seven years); `season-percent-change`; `season-feed-mismatch`;
`performers-null` (all shares ≈ 0.6 over 12 years, none survive); `performers-strong`
(two with 19 of 20); `odds-matched`, `odds-thin`, `odds-resolved`, `odds-unmatched`,
`odds-none`; `pm-ok`, `pm-unmatched`, `pm-plan` (402), `pm-ambiguous`; `limited` (429 on
fx-history); `failed` (500 on futures-contracts).

### 10.2 `tests/flows-macro.mjs` (N)

Holds: number reading (decimal strings, `"NaN"`, `""`, `"1e-3"`, numbers, the `str#` and
number forms of seasonality), every 2.3 row never read (recording `Proxy` over the raw rows
as `flows-dossier-contract` does), `seriesOf` duplicates and nulls, `dailyStats` against an
independent log-return computation at 300 random series (252 and 365), no day change for a
monthly series, the curve's spreads at −5.0001/−5/5/5.0001 bp, a curve withheld on a
non-percent unit, dollar breadth orientation for every pair and the five-pair gate,
`parseContract` on every month code, one- and two-digit years, decade wrap and the expired
refusal, `frontOf` ties, `spread12` only on shared dates, large-print floors per product
inside a group call, crossed and none never sided, the crypto source check at 0.4999% and
0.5001%, the percent test at the 1e-3 boundary and with two rows, `monthRows` excluding
the current year, the computed change against the feed's in all three unit cases,
`seasonCell` against an independent Wilson and t interval at 400 random samples and the
8-year gate, `performersTable` binomial p against an exact enumeration and BH against an
independent step-up at 200 random tables, ranking by lower bound, `matchOdds` window
edges at exactly −24 h and +7 d, one candidate to one row, the eight-market cap, thin at
$49,999.99 and spread 0.0501, mid against last, resolved markets, `top5Share` and
`botShare` against hand sums and the ten-position gate, holders median and the address
cleared, the PM normaliser table (twenty names), `ambiguous`, rotation order and cursor
wrap with `complete`, the 1-year change gap rule, the byte fitters at their caps in shed
order, the fixture refusal, the **address scan** (no `0x`+40 hex, no 64-hex, no key of 2.3
in `macro`, `pm`, card-x or any live body built from every world), the `search-users`
string scan, the call budget (152 nightly, live per part, PM cap clamped 0..400), the
build switch off leaving the dry emit unchanged, and `macroChecks`.

Planted wrong builds (via `tests/truth/mutants.mjs`, exact-once transforms; each must fail
its named check):

1. a null `value` read as 0;
2. a monthly series given a day change;
3. a `unit: null` series printed with a value;
4. a curve rescaled when the unit is not percent;
5. 2s10s computed across two dates;
6. `RATE_FLAT_BP` read as 0.5;
7. dollar breadth counting `USDJPY` up as dollar down;
8. a dollar index built from the pairs;
9. a one-digit futures year resolved to the past decade;
10. the most active contract labelled front month in the payload;
11. a crossed print counted on its side;
12. `none` prints split half and half;
13. a group's minimum floor applied to every product;
14. the crypto check averaging the two sources;
15. FX bar times converted from a named zone;
16. `change_percent` divided by 100 without the test;
17. the current year's month counted in seasonality;
18. the feed's `change` used instead of close over open;
19. Wilson replaced by the normal approximation;
20. the seasonal share printed under 8 years;
21. performers ranked by share instead of the lower bound;
22. BH skipped (raw p);
23. a candidate matched to two calendar rows;
24. the odds window extended to 30 days;
25. a thin market printed solid;
26. a resolved market printed as live odds;
27. the last price used while a two-sided quote under the spread limit exists;
28. `top5Share` over the five positions only;
29. a wallet address kept in `holders`;
30. management names read;
31. `search-users` called;
32. a `pm` sector unmatched written as an empty `top` with status `ok`;
33. a PM plan refusal retried the next night;
34. fixture names allowed outside the test flag.

### 10.3 `tests/server-macro.mjs` (N)

Both rows over the router with a fake store, a Cache API fake and a scripted feed:
`FLOWS_MACRO` `on`, `owner` (owner, member), `off`, unset, `ON `, mistyped; `FLOWS_MACRO_LIVE`
the same; 405 before 401; `404 macro_off` body identical for a non-owner and for off;
every `part` and an unknown one; `pair` allowed and refused; absent payload `pending`;
store refusal with and without a last good copy; rows read 1 on a miss and 0 on a hit;
the shared cache key (two members, one miss, one feed burst); calls per miss equal to
`BUDGETS.macroLive.callsPerMiss`; a member refusal with and without a kept copy; a
`VendorRefused` after three calls stops the rest; `futures` with no `macro` payload makes
no futures call. Planted: the switch read after the store; owner gate inverted; a per-member
cache key; the live route served with `FLOWS_MACRO` off; `pair` unchecked; a refusal that
continues calling.

### 10.4 `tests/flows-macro-render.mjs` (C, `page.route`, no server)

Serves `macroPage({ live: true })` with a built `macro` payload and live bodies from every
world. At 1920x1080, 1440x820, 1024x768, 390x844 and for every tab: no page scroll, no inner
scroll except dialogs, nothing clipped (`flows-layout-sweep` rules), every module in its grid
area to 1 px; every printed figure equal to the payload through an independent formatter;
the curve's points against an independent scale; spark lines' last point equal to `last`;
dashes with reasons for every withheld state; the odds bar's fill equal to the price and
hollow when thin; seasonality cells' interval bars against Wilson; TRT only (no `ET`,
`EST`, `UTC` in text); the source tag of every tile (nightly or 5-min); `live: false`
making no `macro/now` request; a hidden tab making none; axe clean; forced colours;
reduced motion; 44 px targets on a coarse pointer; colour never alone (glyph and sign
beside every up and down). Planted (served-copy mutations): a null drawn as 0; a monthly
series with a day change; a thin market drawn solid; the share printed without its
interval; a sentence over 14 words; "vendor" in served text; "tape" in served text; an
address rendered; a tab that scrolls at 1024x768; the live read polled faster than 5
minutes; a request made while the tab is hidden.

### 10.5 `tests/flows-private-render.mjs` (C)

The ticker page against the dry emit's card and card-x carrying each `pm` world and the
`pm` sector entry: the module's figures against the payload, the investor count and list,
the peers table, the mark's date, the coverage sentence, the plan and unmatched states,
no leader names anywhere in the DOM, the module absent with the switch off, one request
(`/api/flows/macro?part=pm&sector=`) and only when the module nears the viewport.
Planted: a mark printed without its date; leaders' names shown; the module fetched with
the switch off; `unmatched` drawn as an empty table.

### 10.6 Existing suites to extend or regenerate

`flows-probe-contract` (37 entries, the plan, the shared-operation rule), `flows-registry-contract`,
`flows-vendor-budget`, `flows-d1-budget`, `flows-reads-contract`, `flows-legs-contract` (stage
table), `flows-pipeline-contract` and `pipeline` (golden `--write`), `flows-dossier-contract`,
`flows-reading`, `flows-events` (odds column), `server-pages`, `route-matrix` (`--write` in its
own commit with no code change), `flows-weight` (`DEFERRED.macro` = `macro-charts`,
`DEFERRED.ticker` gains `private`), `flows-public`, `flows-copy-lint`, `flows-guard-lexicon`,
`flows-layout-sweep` (the new page spec), `flows-pages-render` (the sixteenth page and its
baseline), `docs` (`node scripts/gen-docs.mjs`), `contracts` (asset bump). Run `node run.mjs
--affected-list` and then `node scripts/prepush.mjs`; both must be green before the push.

## 11. UI design

### 11.1 Page structure

`macroPage({ username, live })` through `flowsDocument` with `chrome: false`, `chart: true`,
styles `["/assets/css/flows-macro.css"]`, scripts `["/assets/js/flows-fresh.js",
"/assets/js/flows-macro.js"]`, and the deferred group:

```html
<div class="mc" id="mc" data-live="on|off">
  <div class="mc-top">
    <header class="flows-head mc-head" data-fx-hero>
      <h1 id="fxTitle">Macro</h1>
      <p class="mc-meta" id="mcMeta"></p>
      <button type="button" class="mc-ibtn" id="mcInfoBtn" aria-label="What is not shown" aria-haspopup="dialog">(glyph info)</button>
    </header>
    <div class="mc-tabs" role="tablist" aria-label="Macro views" id="mcTabs">(eight tabs)</div>
  </div>
  <section class="mc-hero" id="mcHero" aria-label="Cross-asset at a glance"></section>
  <div class="mc-sub" id="mcSub" role="tablist" aria-label="Modules in this view" hidden></div>
  <div class="mc-stage" id="mcStage" data-view="overview">(eight tabpanels, inactive ones inert and visibility: hidden)</div>
  <p class="visually-hidden" id="mcStatus" role="status"></p>
  <i hidden data-defer="macro-charts" data-src="/assets/js/flows-macro-charts.js?v=..."></i>
</div>
```

Tabs, address `#view=<key>` with `replaceState`: `overview` Overview, `rates` Rates, `fx`
FX, `commod` Commodities, `crypto` Crypto, `futures` Futures, `odds` Odds, `season`
Seasonality. The tablist answers arrows, Home and End (`FlowsUI.segmented` pattern from
Market). One `GET /api/flows/macro` on load (whole payload, at most 96 KiB); the live
parts are asked only for the tab that shows them and only while the page is visible:
`board` for Overview, FX, Crypto and Futures; `futures` for Futures; `crypto` for Crypto;
`fx&pair=` for FX when a pair is selected. One timer, 300 s, never faster, none while
hidden, one read on return (the Status page's loop, copied in behaviour, written in the
controller).

### 11.2 Hero strip (all tabs, `#mcHero`, 64 px tall at desktop, 56 px at 390)

Seven cells at 1920 and 1440 (ES, 10-year, 2s10s, WTI, Gold, EURUSD, BTC), five at 1024
(ES, 10-year, 2s10s, WTI, BTC), three at 390 (ES, 10-year, BTC). Each cell: label
(`--label-2`, 12 px), value (`--label-1`, 20 px tabular), signed change with ▲ or ▼ and
`--up-mark` or `--down-mark` (the glyph carries the sign; colour is secondary), and a 9 px
source line (`src.nightly` date or `src.live` time). A withheld value is an em dash with the
reason in the cell's `title` and visually hidden text.

### 11.3 Tab layouts (grid template areas inside `.mc-stage`)

| tab | 1920x1080 | 1440x820 | 1024x768 | 390x844 |
|---|---|---|---|---|
| Overview | `"eq rt fx cm cr"`, five columns `1fr`, then `"cal cal cal mv mv"`, rows `3fr 2fr` | `"eq rt fx" "cm cr cal"`, rows `1fr 1fr` | `"eq rt" "fx cr"`, `cm` and `cal` behind `#mcSub` | one module at a time through `#mcSub` (Equities, Rates, FX, Commodities, Crypto, Calendar) |
| Rates | `"curve curve ind" "sprd ff ind"`, columns `2fr 1fr 2fr`, rows `3fr 2fr` | `"curve ind" "sprd ind"`, `6fr 5fr`, rows `3fr 2fr` | `"curve" "ind"` rows `1fr 1fr`, spreads inside the curve header | `#mcSub`: Curve, Economy |
| FX | `"grid chart"`, `5fr 4fr` | same | `"grid" "chart"` rows `3fr 2fr` | `#mcSub`: Pairs, Chart |
| Commodities | `"grid grid"` single grid of eleven spark tiles plus Gold, four columns | three columns | three columns, fitter trims to nine with Show all | two columns of tiles, fitted, Show all |
| Crypto | `"pairs whales" "chart whales"`, `3fr 2fr`, rows `1fr 1fr` | same | `"pairs chart" "whales whales"` | `#mcSub`: Pairs, Chart, Large trades |
| Futures | `"board curve" "board large"`, `4fr 5fr`, rows `1fr 1fr` | same | `"board curve" "large large"` | `#mcSub`: Board, Curve, Large prints |
| Odds | `"cal detail"`, `3fr 2fr` | same | same | `#mcSub`: Calendar, Detail |
| Seasonality | `"funds perf"`, `1fr 1fr` | same | `"funds" "perf"` rows `1fr 1fr` | `#mcSub`: Funds, Screen |

Gap `var(--sp-3)`; module surfaces the existing `.ui-mod` glass; no new elevation. The page
reuses the Market fitter's rules (hide trailing list rows, keep at least two, Show all in the
module header opens the whole body in a dialog); `flows-macro.js` carries its own small
fitter written to the same contract, since `flows-market.js` is not loaded here.

### 11.4 Modules

**Spark tile** (Overview, Commodities, FX grid, Futures board): 44 px row at 390, 64 px
tile elsewhere: label and product name, value, signed change, a 120x28 sparkline drawn by
`FlowsUI.chart.sparkline` (`--label-2` line, last point dot `--label-1`, no fill, no axis),
the date or TRT time. Rows link nowhere (cross-asset symbols have no ticker page), except
movers, which link to `/flows/ticker/?t=`.

**Treasury curve**: SVG, x = maturity on a log scale with ticks 3M, 2Y, 5Y, 7Y, 10Y, 30Y, y =
yield in percent, nice ticks. Three series: today `--label-1` solid with circles, one month
back `--accent-ink` dashed `4 3` with squares, one year back `--label-3` dotted `1 3` with
triangles; direct end labels (`Now`, `1M`, `1Y`) placed by the clustering rule of
`flows-ticker-glance.js`. A maturity with its own date is drawn hollow, its date in the
readout. Header: state chip (`.ds-` chip: ▼ Inverted, ■ Flat, ▲ Normal, glyph plus word) and
`2s10s −12 bp · 3m10s +34 bp · Fed funds 4.33%`. Readout row (`role=status`, polite) names
the hovered or focused point: "10-year, Oct 24: 4.12%." Keyboard: one tab stop, arrows move
across maturities, Up and Down across the three dates, Escape to rest. Table twin in a
dialog.

**Economy list**: eight rows (CPI, Inflation, Unemployment, Payrolls, Retail sales, Durable
goods, GDP, GDP per capita): name, last value with the feed's unit word, `series.prevrelease`,
release date and age, a 96x22 spark of 24 points. A withheld unit: the em dash and
`series.unit`.

**FX**: the eight pairs as rows (a tile grid at desktop): pair, last (four decimals, two for
JPY and TRY pairs), 1-day and 21-day change, realised 21, spark of 63 closes; live rate and
bid and ask when the `board` part has them, with its TRT time. Above the grid,
`fx.breadth` and the `fx.nodxy` line in `--label-3`. Selecting a pair (click, Enter) draws
the 60-minute chart from `part=fx&pair=` (`FlowsUI.chart.line`, TRT axis through `F.tick`).

**Crypto**: three pair rows (24-hour change from live, 1-day and 21-day from nightly, realised
on 365 days, source check chip ✓ or ✕ with its sentence); the 5-minute BTC chart; the large
trades block: buy and sell counts and dollars over the window as two horizontal bars on one
scale with the window in TRT, and transfers by type and by chain as a compact table.

**Futures**: board of fourteen products in four groups (Equity, Rates, Energy and metals,
Currencies): product name, contract label (`Dec 26`, `futures.active` in the title), last,
1-day change, settlement and open interest from live; the curve module with a segmented
control ES | CL | ZN, settlement by contract month (points joined, stale points hollow),
`spread12` with its state chip and, for ES, `futures.carry`; the large prints module: per
product a three-part bar (buy `--up-mark`, sell `--down-mark`, unsided hatched `--label-3`,
crossed listed apart in text), the window in TRT, and the top prints list (time TRT, product,
contract, ▲ buy or ▼ sell or – unsided, size, price).

**Odds**: the calendar column lists the next ten releases from `events.macro` in time
order (day and TRT time, event name, tag chip). Beside each matched release, up to two
market rows: the outcome label, a 120 px horizontal bar filled to the price on a 0 to 100
scale with ticks at 25, 50 and 75 (solid `--accent-ink` fill when not thin; outline only
with diagonal hatch when thin), the price as `62%` with `odds.price` in the row's title and
visually hidden text, and a 30-day history spark. Unmatched releases: `odds.none` in
`--label-3`. The detail column shows the selected market: the question (untrusted text, set
as text), resolve time in TRT, bid, ask, spread, liquidity, volume, the concentration,
bots and holders lines, and the history chart. Below, the "Not tied to a calendar release"
list. Keyboard: rows are buttons in a roving group; arrows move, Enter selects.

**Seasonality**: segmented control This month | Next month. The funds module is a table of
fifteen rows (four index funds, a 1 px `--label-4` divider, eleven sector funds): ticker,
`n` years, an interval bar on a 0 to 100% axis (the Wilson interval as a `--seq-3` bar, the
share as a `--label-1` tick, a dashed `--label-4` line at 50%), `k of n`, the mean with its
interval in a compact text cell, and a coin chip (● Coin when the interval holds 50%, ▲ or ▼
otherwise). The screen module: `season.screen` sentence first, then up to ten rows ranked by
the lower bound, each with the same interval bar, the BH-survivor rows marked ✓. Every cell's
full `season.cell` sentence is in its accessible name.

### 11.5 Events page odds column

With `odds: true`, `eventsPage` emits `data-odds="on"` on `#evMacroCard`. `flows-events.js`
then reads `/api/flows/macro?part=odds` once and adds a last column "Market price" to the
Macro rows that matched: `62%` with a hollow mark when thin, the full `odds.price` sentence
as its accessible name; unmatched rows get an em dash with `odds.none`. The column fits the
existing fitter; nothing else on the Events page changes.

### 11.6 Ticker: the Private markets module

`tickerPage({ privateLens: true })` declares
`<i hidden data-defer="private" id="ftPrivate" data-src=".../flows-ticker-private.js?v=" data-css=".../flows-ticker-private.css?v="></i>`.
`flows-ticker.js` adds `buildPrivate`, which makes the `m-private` module ("Private markets")
for a card that is not an index or a fund, and asks for the group with
`FlowsUI.defer("private", { when: "visible" })`, handing it the card-x `pm` section and the
card's sector. The file (`FlowsUI.privateLens`: `mount`, `model`) reads
`/api/flows/macro?part=pm&sector=<sector>` once.

Layout: two blocks side by side from 720 px of module width, stacked below. "As an investor":
`private.investor` with the count as a numeral, then up to eight company names with their
sector, or `private.none`. "Private peers": `private.peers`, a table of six (name, disclosed
funding through `F.money`, investors, the mark and its date, 1-year change signed, last round
with date and amount, leaders count), `private.mark` under the table, `private.coverage` in
`--label-3`. States: `plan`, `unmatched`, `pending`, `failed` (section 8 sentences), never an
empty table. In the dock's sheet at 390 px the table becomes cards of three lines.

### 11.7 States (every module)

| state | when | drawn |
|---|---|---|
| loading | request in flight | the module's skeleton at its reserved height |
| pending | route `pending` or part missing | `state.pending` |
| withheld | a reducer withheld (unit, zone, few, dates) | the figure's em dash with `state.withheld` and the reason |
| plan | 402/403 filed as plan | `private.plan` or `state.failed` with the plain name |
| limited | 429 at night | the kept copy with `state.limited` |
| failed | the operation failed tonight | `state.failed` |
| stale | payload one session behind the last close | data drawn, the stale pill with the payload's date |
| expired | two or more sessions behind | `UI.silent` withheld, no figures |
| live off | `FLOWS_MACRO_LIVE` off for this member | nightly figures, `state.live.off` once in the meta line |
| live stale | kept copy served | `src.live.stale` on the affected tiles |
| off | `FLOWS_MACRO` off | the page is the unknown-page 404; nothing elsewhere changes |

### 11.8 Tokens and accessibility

Only existing tokens (`--label-1..4`, `--accent-ink`, `--seq-1..5`, `--up-mark`,
`--down-mark`, `--vol-5`, `--mat-*`); no colour literal in CSS or JS (scanned by the render
suite). Text at 4.5:1 over the composited glass (`tests/flows-glass-render.mjs` rules). Every
chart has a hidden description naming its last value with its unit and date, and a table
twin. Up and down always carry a glyph and a sign. Focus ring the system's. No animation
except the segmented knob; nothing runs at rest (paint census zero). Numbers through
`FlowsUI.F` only (`tests/math-format.mjs` ratchets local rounding). Instants as `HH:MM TRT`
through `F.time` or `F.when`; dates as dates through `F.day`. Untrusted text (questions,
company names and descriptions) set with `textContent`, never markup.

## 12. Order of work for the implementer

1. Registry entries, the `addon:private` plan and the probe contract rules; the fixture
   generator and fixtures.
2. The three leaves and `tests/flows-macro.mjs` with all 34 planted builds failing as named.
3. Legs, sections, stages, card-x merge, health, fake feed; dry emit and golden regeneration.
4. Store grammar, products, routes, errors, Worker wiring, `tests/server-macro.mjs`, reads
   ceilings, D1 budget, vendor budget.
5. Page, nav, controller, charts group, sheet; Events column; ticker module; dossier
   packets; render suites; visual inspection at the four sizes for every tab with
   screenshots under the scratchpad (not committed), compared against this section.
6. Glossary, about, copy lint, weight, docs, asset bump, `node scripts/prepush.mjs`, commit,
   push the branch, do not merge.
