# WP2 Flow intelligence: the Flow Lab and the contract drill

Status: specification, written 2026-10-27 by the mentor of package WP2 for the implementer.
The implementer follows it exactly; a point it does not settle is asked, never guessed.
Base: `origin/main` at `36c1ea1`. Branch for the implementation: `claude/wp2-flowlab`.

## 0. What this package adds, in one paragraph

Today the flow stops at the name: a flagged window on Unusual, on the ticker's Flow network or on the
Moves list cannot be opened to see the contract's own day. This package adds (a) a **contract drill
sheet**, one dialog reachable from those three places and from the new page, that shows one option
contract's prints, its minute-by-minute side volume, its volume profile by price, the alerts and the
multi-leg structures it took part in, and its routing by exchange; and (b) a new owner-first page,
**Flow Lab** (`/flows/flowlab/`), with a contract screener ranked by the site's own ratios, a strike map
of signed contracts through the session, the feed's delta and vega flow per expiry for a name and for a
group, the option and stock volume ladders by price side by side, routing by exchange, and a correlation
view of the session's flow-heavy names. Every member read goes through `vendorGate` and `chargedFetch`
inside `serveCachedVendorRead`; nightly reads stay under the extras cap. Everything is behind
`FLOWS_FLOWLAB` (shipped `owner`).

Out of scope here (named so nobody adds it to this branch): the Market Floor ETF coverage the owner asked
for separately, any change to the rail hub, any model call.

## 1. Rules this package is held to

1. AGENTS.md in full. No comments in any source file. Generated files are regenerated, never edited.
2. No call to the live feed from any session, script or test. `UW_API_KEY` is never read by a test or a
   script of this package. Fixtures are written by a generator from `docs/uw-openapi.yaml` and
   `scripts/flows-probe-shapes.json` (section 9).
3. Served copy never names the data provider and never uses the word "vendor"; it says "the feed". The
   word "tape" appears in no new file (copy, identifier, CSS class, test name or fixture); the only
   exception is the import path of the existing module `shared/flows-tape-stats.js`. Where an existing
   registry value is spelled that way it is not reused: new registry entries use the classes in section 3.
4. Every time is printed in TRT through `FlowsUI.F.time`, `F.stamp` or `F.when`; session dates are US
   exchange dates and say so once per page (the existing kernel sentence).
5. A figure the feed did not send, could not be read or has no stated unit is an em dash with its reason,
   never a zero. A zero the feed did send is printed as zero.
6. One screen with no page scroll at 1920x1080, 1440x820, 1024x768 and 390x844, for every tab, every
   drill tab and every state.
7. Every change is behind a switch; with every switch off, every existing page, route and payload is byte
   for byte what it was (a test holds this).
8. Every new pure function has an independent oracle; every suite plants wrong builds that must fail.
9. Before the push: the suites of section 12 green and `node scripts/prepush.mjs` green. Do not merge.

## 2. Switches

| Name | Where | Values | Shipped | Meaning |
|---|---|---|---|---|
| `FLOWS_FLOWLAB` | `wrangler.toml` [vars] | `on`, `owner`, anything else off | `owner` | `on`: every member; `owner`: owners (`isOwner`, `FLOWS_RT_USERS`) only; off: the page is the unknown-page 404, every `/api/flows/flowlab/*` route is `404 flowlab_off` (read before the session gate's owner check, after the method gate), and the drill entry points are not in the served HTML. |
| `FLOWS_FLOWLAB_NIGHTLY` | nightly process env and `.github/workflows/flows-pipeline.yml` | `off`, anything else on | on | `off` skips the `flowlab` stage (recorded `skipped`), publishes nothing new. |
| `FLOWS_FLOWLAB_ANALYTICS` | `wrangler.toml` [vars] and the nightly env | `on`, anything else off | off | The two analytics reads (section 3, rows 17 and 18) run only when `on`. They stay off until a probe run records their body shape in `scripts/flows-probe-shapes.json`; the schema documents only `{data: {meta: object, payload: object}}`. |

`flowlabMode(env, owner)` in `shared/flows-flowlab.js` is the one reader of `FLOWS_FLOWLAB`:
`"on"` when the trimmed lowercased value is `on`, or `owner` and `owner === true`; else `"off"`. A
misspelled value is off (fail closed; this differs from the page-row `gate` default, so the page row uses
`flowlabMode`, not `gate`). Add the three names to `OPS_SWITCHES` in `server/ops.js`.

## 3. The eighteen endpoints and where each is read

Registry entries go into `shared/flows-vendor-ops.js` (`OPS`), each with `id`, `path`, `licence`,
`klass`, `limiter`, `maxBytes`, `reads`. `klass` uses `breadth` for intraday series, `quote` for print
lists, `nightly` for nightly-only reads and `slow` for the root list; never the other intraday class.
`limiter: "ondemand"` for every operation a member route calls; `null` for nightly-only. The `reads`
lists below are exactly the fields the reducers read; `tests/flows-probe-contract.mjs` holds each to the
spec.

| # | id | path | read by | calls | reads |
|---|---|---|---|---|---|
| 1 | `contract-screener` | `/api/screener/option-contracts` | nightly (3 presets) and member `screen` | 1 | `option_symbol`, `option_type`, `strike`, `expiry`, `stock_price`, `volume`, `open_interest`, `premium`, `avg_price`, `ask_side_volume`, `bid_side_volume`, `mid_volume`, `no_side_volume`, `sweep_volume`, `floor_volume`, `multileg_volume`, `stock_multi_leg_volume`, `cross_volume`, `ticker_vol`, `trades`, `last_fill`, `sector`, `next_earnings_date`, `er_time` |
| 2 | `contract-flow` | `/api/option-contract/{id}/flow` | member `contract` core | 1 | `id`, `executed_at`, `price`, `size`, `premium`, `nbbo_bid`, `nbbo_ask`, `exchange`, `canceled`, `report_flags`, `tags`, `flow_alert_id`, `implied_volatility`, `delta`, `open_interest`, `multi_vol`, `stock_multi_vol`, `option_type`, `strike`, `expiry` |
| 3 | `contract-intraday` | `/api/option-contract/{id}/intraday` | member `contract` core | 1 | `start_time`, `open`, `high`, `low`, `close`, `avg_price`, `iv_low`, `iv_high`, `volume_ask_side`, `volume_bid_side`, `volume_mid_side`, `volume_no_side`, `volume_multi`, `volume_stock_multi`, `premium_ask_side`, `premium_bid_side`, `premium_mid_side`, `premium_no_side` |
| 4 | `contract-profile` | `/api/option-contract/{id}/volume-profile` | member `contract` core | 1 | `price`, `volume`, `ask_vol`, `bid_vol`, `mid_vol`, `sweep_vol`, `floor_vol`, `multi_vol`, `cross_vol`, `transactions`, `date` |
| 5 | `flow-alert-trades` | `/api/option-trades/flow-alerts/{id}` | member `contract` part `alert` | 1 | `alert`, `trades`, `has_more` (the objects inside are opaque: section 6.4) |
| 6 | `multi-leg-legs` | `/api/option-trades/multi-leg/{id}/legs` | member `contract` part `legs` | 1 | `option_symbol`, `type`, `strike`, `expiry`, `side`, `size`, `price`, `premium`, `nbbo_bid`, `nbbo_ask`, `delta`, `theta`, `open_interest`, `volume` |
| 7 | `exchange-breakdown` | `/api/option-trades/exchange-breakdown/{date}` | nightly (universe, 2 pages) and member `venues` (one ticker, today) | 1 | `underlying_symbol`, `exchange`, `trade_code`, `trade_count`, `contracts`, `premium`, `call_trades`, `put_trades` |
| 8 | `optionable-roots` | `/api/option-trades/optionable-tickers` | nightly | 1 | the array of strings |
| 9 | `strike-flow-intraday` | `/api/stock/{ticker}/flow-per-strike-intraday` | member `name` view `strikes` | 1 | `timestamp`, `strike`, `call_volume_ask_side`, `call_volume_bid_side`, `put_volume_ask_side`, `put_volume_bid_side`, `call_premium_ask_side`, `call_premium_bid_side`, `put_premium_ask_side`, `put_premium_bid_side`, `call_volume`, `put_volume` |
| 10 | `flow-recent` | `/api/stock/{ticker}/flow-recent` | member `name` view `recent` | 1 | `date`, `expiry`, `call_premium`, `put_premium`, `call_premium_ask_side`, `call_premium_bid_side`, `put_premium_ask_side`, `put_premium_bid_side`, `call_volume`, `put_volume`, `call_otm_premium`, `put_otm_premium`, `call_trades`, `put_trades` |
| 11 | `greek-flow-expiry` | `/api/stock/{ticker}/greek-flow/{expiry}` | member `name` view `greek` | 1 | `timestamp`, `expiry`, `dir_delta_flow`, `dir_vega_flow`, `total_delta_flow`, `total_vega_flow`, `otm_dir_delta_flow`, `otm_dir_vega_flow`, `transactions`, `volume` |
| 12 | `group-greek-flow-expiry` | `/api/group-flow/{flow_group}/greek-flow/{expiry}` | nightly (25 groups) and member `group` | 1 | as row 11 plus `flow_group`, `net_call_premium`, `net_put_premium`, `net_call_volume`, `net_put_volume` |
| 13 | `option-price-levels` | `/api/stock/{ticker}/option/stock-price-levels` | member `name` view `levels` | 1 | `price`, `call_volume`, `put_volume` |
| 14 | `stock-price-levels` | `/api/stock/{ticker}/stock-volume-price-levels` | member `name` view `levels` | 1 | `price`, `lit_vol`, `off_vol` |
| 15 | `lit-recent` | `/api/lit-flow/recent` | member `lit` | 1 | `ticker`, `executed_at`, `price`, `size`, `premium`, `nbbo_bid`, `nbbo_ask`, `market_center`, `canceled`, `trade_code`, `sale_cond_codes` |
| 16 | `lit-ticker` | `/api/lit-flow/{ticker}` | member `name` view `lit` | 1 | as row 15 |
| 17 | `analytics-window` | `/api/analytics/window` | nightly, `FLOWS_FLOWLAB_ANALYTICS=on` | 1 | `data.meta`, `data.payload` |
| 18 | `analytics-sliding` | `/api/analytics/sliding` | nightly, `FLOWS_FLOWLAB_ANALYTICS=on` | 1 | `data.meta`, `data.payload` |

The existing `multi-leg` entry (`/api/option-trades/multi-leg`) gains `limiter: "ondemand"` and a
`reads` list (`id`, `ticker`, `executed_at`, `strategy`, `code`, `leg_count`, `strikes`,
`total_premium`, `net_premium`, `direction`, `size`) because the drill's Structure tab reads it once per
ticker and session (section 6.5). No other existing entry changes.

`BUDGETS` gains `flowlab: { nightlyMax: 40, memberCallsPerRead: { screen: 1, core: 3, alert: 1, structure: 1, legs: 1, strikes: 1, recent: 1, greek: 1, levels: 2, lit: 1, venues: 1, group: 1, litMarket: 1 } }`,
and `tests/flows-probe-contract.mjs` holds each figure equal to the constant it names in
`server/flowlab.js` (`FLOWLAB_CALLS`).

## 4. Files

New:

| File | Role |
|---|---|
| `shared/flows-flowlab.js` | Pure leaf. Imports only `flows-sides.js` (`centsOf`), `flows-tape-stats.js` (`classifyPrint`), `flows-display-round.js`, `flows-calendar.js`. Holds `flowlabMode`, `osiOf`, `parseOsi`, the reducers of section 6, the ratios of section 5, `PRESETS`, `GROUPS`, `FLOWLAB_LIMITS`, `REASONS`. No clock (callers pass `now`), no I/O. |
| `shared/flows-flowlab-copy.js` | Every reader-facing string of the page and the sheet (section 8). Leaf, no imports. |
| `server/flowlab.js` | I/O half: the builders handed to `serveCachedVendorRead` (`buildScreen`, `buildContractCore`, `buildAlert`, `buildStructure`, `buildLegs`, `buildNameView`, `buildGroup`, `buildLitMarket`, `buildVenuesToday`) and `FLOWLAB_CALLS`. Takes the charged fetch as its first argument and never imports `worker.js` or `cloudflare:`. No top-level mutable binding. |
| `server/routes/flows-flowlab.js` | `flowsFlowlabRows(deps)`: the route family of section 7. |
| `scripts/flows-legs/flowlab.mjs` | The nightly leg: plans and reads rows 1, 7, 8, 12 (and 17, 18 under the switch), reduces with the leaf, returns the payloads. |
| `scripts/flows-nightly/sections/flowlab.mjs` | `runFlowlab(ctx)`: isolated stage `flowlab`, after `extras`' calls are known and before `roster`; publishes the keys of section 7.2. |
| `shared/flows-page-flowlab.js` | `flowlabPage({ username, owner })`: the server-rendered skeleton with the geometry of the data (section 10). Exported through `FLOWS_PAGES`. |
| `shared/flows-flowlab-shell.js` | `flowlabShell(html, slug, on)`: when `on`, adds to the Unusual, ticker and Moves pages the hidden `#fxFlowlab` root and the `<i hidden data-defer="drill">` elements; when off returns the text unchanged. Called in `server/routes/flows-pages.js` inside `memberShell(oracleShell(...))`, innermost. |
| `assets/js/flows-flowlab.js` | Page controller (tabs, fitters, reads, paint). Adds `FlowsUI.flowlab`. |
| `assets/js/flows-drill.js` | The contract drill sheet, deferred group `drill` (`FlowsUI.drill`: `open(spec)`, `close()`, `model`). Loaded by the Flow Lab page eagerly and by the three entry pages through `FlowsUI.defer("drill")` on the first press of a drill control. |
| `assets/css/flows-flowlab.css` | The page and the sheet. Tokens only, no colour literal. Carried on the first `drill` element as `data-css` for the entry pages. |
| `tests/flows-flowlab.mjs` | Leaf suite (N). |
| `tests/server-flowlab.mjs` | Route family and builders over a counting fake (N). |
| `tests/flows-flowlab-nightly.mjs` | The leg and the section on a fake feed and the dry run (N). |
| `tests/flows-flowlab-render.mjs` | Page and sheet in Chromium, `page.route`, no server (C). |
| `tests/flows-flowlab-onescreen.mjs` | The four-size sweep of every tab, drill tab and state (C). |
| `tests/lib/flowlab-world.mjs` | Serves the page, the entry pages with the shell on, and stubs every route from the fixture. |
| `tests/gen-flowlab-fixtures.py` | Writes `tests/fixtures-flowlab.json` (section 9). |
| `tests/fixtures-flowlab.json` | Synthetic bodies for the eighteen operations and the multi-leg feed. |
| `tests/suites/flows-flowlab.json`, `server-flowlab.json`, `flows-flowlab-nightly.json`, `flows-flowlab-render.json`, `flows-flowlab-onescreen.json` | One registry file each, with a `command` and a shard pin chosen by the contract's lightest shard. |

Changed:

| File | Change |
|---|---|
| `shared/flows-vendor-ops.js` | Section 3 entries and `BUDGETS.flowlab`. |
| `scripts/flows-probe-list.json` (if it lists strict reads) | The new `reads`. |
| `worker.js` | Mount `flowsFlowlabRows({ vendorGate, serveCachedVendorRead, readFlowsPayload, isOwner, builders })` in the router families, after `flowsDeskRows`. Nothing else. |
| `server/routes/flows-pages.js` | A page row `{ slug: "flowlab", render: ... }` whose handler checks `flowlabMode(env, owner)` and throws `not_found` when off (no `gate` key). Wrap the three entry pages with `flowlabShell`. |
| `shared/flows-pages.js` | `FLOWS_PAGES.flowlabPage`; a `FLOWS_NAV` item `{ key: "flowlab", href: "/flows/flowlab/", label: "Flow Lab", glyph: "flask", ownerOnly: true }` in the Market group after Unusual, shown only when the page is open to the member (the existing `ownerOnly` rail rule hides it unless active; when `FLOWS_FLOWLAB` is `on` the page renders the item for everyone through a `data-flowlab-nav` swap done by `flowlabShell`); TABS `Market` keys gain `flowlab`. |
| `shared/flows-products.js` | Nightly globals `flowlab-screen`, `flowlab-venues`, `flowlab-groups`, `flowlab-roots`, `flowlab-corr` (level nightly, executor `nightly`, epoch 1, byte caps of section 7.2, volatile stamps `generatedAt`, due 50 minutes after the close). |
| `server/store.js` | The door's exact-key grammar admits the five keys (the registry contract holds both directions). |
| `shared/flows-contracts.js` | `validate` knows each key's top-level shape (section 7.2). |
| `shared/flows-glossary.js`, `aboutPage` table | Lines for the Flow Lab terms; the about table must equal `FLOWS_NAV`, so the page is listed with "for the account owner while it is tested". |
| `tests/lib/d1-budget.mjs` | Declares the five nightly writes (5 rows) and the route reads (section 7.3). |
| `tests/fixtures-route-matrix.json` | The matrix gains the new routes, so it is regenerated in this branch with `node route-matrix.mjs --write`, in its own commit that moves no code, and the commit says so. |
| `tests/flows-weight.mjs` | `DEFERRED` gains the `drill` group for `unusual`, `ticker`, `moves`, `flowlab`; the route allowance for `flowlab`. |
| `docs/modules.json` | Rows for every new file (the File map row is written by `gen-docs`). |
| `AGENTS.md` | Only through `node scripts/gen-docs.mjs` (the File map row). Add `FLOWS_FLOWLAB` to the switches mentioned in the File map row text. |
| `assets/version.txt` and references | `node scripts/bump-assets.mjs`. |

## 5. The site's own ratios (leaf, exact)

All money is integer cents from `centsOf` on the feed's decimal strings; contract counts are integers.
A ratio whose denominator is null or zero is `null` with a reason; never 0.

| Name | Definition | Null reason |
|---|---|---|
| `voi` | `volume / open_interest` | `no-oi` when OI null or 0 |
| `nameShare` | `volume / ticker_vol` | `no-name-volume` |
| `sweepShare`, `floorShare`, `crossShare` | `sweep_volume / volume`, `floor_volume / volume`, `cross_volume / volume` | `no-volume` |
| `multiShare` | `(multileg_volume + stock_multi_leg_volume) / volume` | `no-volume` |
| `stated` | `(ask + bid + mid) / volume` (the share whose side the feed stated) | `no-volume` |
| `askBounds` | `lo = ask / volume`, `hi = (ask + no_side) / volume`; `mid` counts to neither side | shown only when `stated >= 0.40` and `premium >= 25,000,00` cents, else `why` = `LEAN_WHY` code from `flows-sides.js` |
| `avgFill` | `premium cents / (volume x 100)` | `no-volume` |
| `lean` | `+1` when `lo > 0.5`, `-1` when `hi < 0.5`, else `0` (undecided); for a put the sign flips (bought puts are bearish) by convention | as `askBounds` |

Ranking keys for the screener: `premium` (cents), `voi`, `nameShare`, `askLo` (the conservative ask
share `lo`), `sweepShare`. Ties: premium descending, then `option_symbol` ascending. A row whose key is
null sorts after every row with a value, in premium order, and is counted (`unranked`).

`osiOf(ticker, expiry, cp, strike)`: `ROOT + YYMMDD + C|P + 8-digit strike x 1000`, root uppercased and
not padded; `parseOsi` is its inverse and returns null for anything else. The suite holds the round trip
over 5,000 generated contracts and the feed's documented example `TSLA230526P00167500`.

## 6. Reducers (leaf) and what each returns

Each reducer is `reduceX(body, ctx)` and returns `{ ok: true, x }` or `{ ok: false, why }` with `why` in
`REASONS` (`unshaped`, `empty`, `type:<field>`, `plan`, `limited`, `failed`, `timeout`, `cap`). Rows that
fail a type check are dropped and counted in `x.dropped`, never coerced.

### 6.1 Screener row (`reduceScreen`)
`{ asOf, date, preset, rows: [ { c, t, cp, k, e, dte, px, vol, oi, premC, ratios: {...section 5},
flags: { sweep, floor, multi, cross }, ed, lastFill } ], n, unranked, dropped, minVolume: 200 }`.
`minVolume` is printed because the feed does not return contracts under 200 contracts; the page says so.

### 6.2 Contract core (`reduceContract`)
- `prints`: from row 2, newest first, at most 50: `{ at, px, size, premC, bid, ask, venue, side, tier,
  canceled, multi, alertId }`, `side` and `tier` from `classifyPrint`. A canceled print is listed, tagged,
  and left out of every sum. `alertIds`: the distinct non-empty `flow_alert_id` values.
- `minutes`: from row 3, ascending by `start_time`: `{ m, o, h, l, c, ivL, ivH, va, vb, vm, vn, vMulti,
  pa, pb, pm, pn }` (cents for premiums). Derived: cumulative ask minus bid contracts; `firstAggressive`,
  the first minute whose ask volume is at least 3 times its bid volume and at least 10% of the session's
  volume to that minute (null when none).
- `profile`: from row 4: levels `{ px, v, va, vb, vm, vSweep, vFloor, vMulti, vCross, n }` sorted by price;
  `poc` (the price with the most volume; ties to the lower price), `valueArea` (start at the POC, add
  whichever adjacent level has more volume, ties go up, until the included volume is at least 70% of the
  total; returns `[lo, hi]` and the exact share), `vwapC` (`sum(px cents x v) / sum(v)` in BigInt, half
  up to a cent).
- `sizeOutliers`: prints whose size is at least 10 times the median print size, only with 20 or more
  uncanceled prints; else `null` with `few-prints`.

### 6.3 Strike map (`reduceStrikes`)
Rows of row 9 are minute by strike. Bucket to 15-minute TRT columns from the session open. Cell
`s(k, b) = (call_ask - call_bid) - (put_ask - put_bid)` in contracts, by the convention that a fill at the
ask is a taker's buy; a cell with no row is `null` (drawn hatched), never 0. Output `{ strikes, buckets,
cells (Int32 or null), spot, rows, dropped }`, keeping the 24 strikes nearest the session spot (`spot`
from the card's close when the route passes it, else the median strike of the volume; the page says which).
No delta or share figure is derived: the rows carry no expiry, so a hedge in shares cannot be computed and
the page says so.

### 6.4 Alert (`reduceAlert`)
The schema states `alert` and `trades` only as objects. The reducer reads, from `alert`, only the keys the
observed `flow-alerts` list rows carry in `scripts/flows-probe-shapes.json` (`alert_rule`, `option_chain`,
`total_premium`, `total_size`, `created_at`, `has_sweep`, `has_floor`, `has_multileg`), and from each trade
only keys that row 2 documents (`executed_at`, `price`, `size`, `premium`, `nbbo_bid`, `nbbo_ask`,
`exchange`). Any other key is ignored; a trade missing `executed_at` or `size` is dropped and counted.
`has_more` is printed as "more prints exist than shown".

### 6.5 Structure (`reduceStructures`, `reduceLegs`)
The multi-leg feed for the ticker and the session (registry `multi-leg`, `limit 100`, the session window)
gives candidates: rows whose `strikes` includes the contract's strike and whose `executed_at` falls in the
contract's session; at most 5, by `total_premium`. A candidate is labelled `confirmed` only after its
`legs` read (row 6) lists the contract's OSI symbol among `option_symbol`; until then `candidate` with the
copy "same name and strike; not yet confirmed to include this contract". Legs: `{ c, cp, k, e, side, size,
pxC, premC, delta, theta }`; `delta` and `theta` print with the feed's convention clause.

### 6.6 Greek flow (`reduceGreek`, rows 11 and 12)
The schema states no unit for `*_delta_flow` and `*_vega_flow`. The reducer keeps them as numbers and
marks `unit: null`. The page draws them only as shape: each series divided by the session's largest
absolute value of that series, labelled "relative, the feed states no unit", with no axis figures. Sign
is printed (Up or Down triangle and word). Group rows add `net_call_premium`, `net_put_premium` as cents
(their unit is dollars by the field name and the screener's premium convention; the unit test pins that a
row whose premium is not a decimal string is dropped).

### 6.7 Price ladders (`reduceLadders`)
Row 13 `[px, call, put]`, row 14 `[px, lit, off]`. Both are binned to one grid: width `w` is the smallest
of `0.01, 0.02, 0.05, 0.10, 0.25, 0.50, 1, 2.5, 5` that gives at most 48 bins across the union range. A
bin with no row on one side is `null` on that side. Derived per bin: `offShare = off / (lit + off)`;
total `offShare` over the session. Output `{ w, bins: [{ lo, call, put, lit, off }], spot }`.

### 6.8 Lit prints (`reduceLit`)
`{ at, t, px, size, premC, venue (market_center), canceled, code }`, canceled kept, tagged, out of sums;
for the market list, the top 40 by premium; for a ticker, newest 100.

### 6.9 Venues (`reduceVenues`)
Per ticker: `{ t, exchanges: [{ x, trades, contracts, premC, callTrades, putTrades }], hhi }` where
`hhi = sum((contracts_x / contracts)^2)` exactly (Fraction in the oracle). Trade-code page: per ticker
the top 6 codes by contracts with their share. Universe page keeps the 500 tickers the feed ranked.

### 6.10 Roots (`reduceRoots`)
A sorted unique list of uppercase strings matching `^[A-Z][A-Z0-9.]{0,9}$`; anything else dropped and
counted. Stored as one `|`-joined string (`flowlab-roots.list`), so a reader tests membership by
`("|" + list + "|").includes("|" + T + "|")` without parsing an array.

### 6.11 Analytics (`reduceAnalytics`, only under the switch)
Accepted only if `data.payload` is an object keyed by the requested symbols whose values are objects of
finite numbers or a numeric matrix; anything else is `unshaped` and the key is published as
`{ status: "unshaped" }`. Correlation cells outside [-1, 1] are refused, not clipped.

## 7. Routes and payloads

### 7.1 Member routes (`server/routes/flows-flowlab.js`)

All `GET`, `auth: "flows"`, ids `flows.flowlab.<name>`, paths `/api/flows/flowlab/<name>`. Order inside
each handler: `flowlabMode` (404 `flowlab_off`), parameter validation (400 before any gate, cache key or
feed call), then `serveCachedVendorRead({ cacheKey: internalKey("flowlab", key), gate: vendorGate(env,
session), wantsRefresh: refresh === "1", ttlSeconds, build })`. The refused member gets the kept copy
stamped `stale` / `throttled` or `429 rate_limited`, exactly as the desk. Error rows to add to
`server/errors.js`: `flowlab_off` (404), `invalid_contract` (400), `invalid_preset` (400), `invalid_view`
(400), `invalid_group` (400), `invalid_alert` (400), `invalid_expiry` exists.

`ttlSeconds`: 60 during the regular session for today's reads, 300 outside it, 86,400 for a past date.
The session test uses `flows-freshness.js`' phase.

| Route | Query | Key | Calls | Body |
|---|---|---|---|---|
| `screen` | `preset` in `PRESETS`, optional `t` | `screen/<preset>/<T or *>/<day>` | 1 | 6.1 |
| `contract` | `c` (OSI, `parseOsi` non-null), optional `d` (real date, not after today), `part` in `core`, `alert`, `structure`, `legs`, plus `id` (UUID for `alert` and `legs`) | `c/<OSI>/<day>/<part>[/<id>]` | 3, 1, 1, 1 | 6.2, 6.4, 6.5 |
| `name` | `t`, `view` in `strikes`, `recent`, `greek`, `levels`, `lit`, `exp` for `greek` | `n/<T>/<view>[/<exp>]/<day>` | 1 or 2 | 6.3, recent rows, 6.6, 6.7, 6.8 |
| `group` | `g` in `GROUPS` (the 25 values of the schema's enum), `exp` | `g/<g>/<exp>/<day>` | 1 | 6.6 |
| `lit` | none | `lit/<day>` | 1 | 6.8 market |
| `venues` | `t` | `v/<T>/<day>` | 1 | 6.9 for one ticker today |
| `nightly` | `k` in `screen`, `venues`, `groups`, `roots`, `corr` | not cached here: `readFlowsPayload("flowlab-<k>")` with the nightly freshness headers | 0 | the stored payload |

`PRESETS` (fixed so the cache keys are bounded): `premium` (order premium), `voi` (order volume_oi_ratio,
`vol_greater_oi=true`, `min_premium=100000`), `sweep` (order premium, `min_sweep_volume_ratio=0.5`),
`floor` (order premium, `min_floor_volume_ratio=0.3`), `opening` (order premium,
`min_days_of_oi_increases=2`), `earnings` (order premium, `max_earnings_dte` = the calendar days from the
read's session to `horizonEnd(asOf)` of `shared/flows-calendar.js`, never a literal, because
`tests/flows-horizon-lint.mjs` refuses an earnings window written as a number). Every preset asks
`limit=250`. With `t`, `ticker_symbol=T` is added. The page ranks the returned rows by the site's own
keys (section 5); the feed's `order` only chooses which 250 come back, and the page says so.

Every body carries `{ v: 1, asOf (the read, ISO), session, part, calls, why? }`, where `calls` is the
number of charged calls this build made.

### 7.2 Nightly keys (`runFlowlab`)

The stage's call ceiling is `min(40, extrasCap(env) - meta.extras.calls)`. Sections in priority order,
each skipped with reason `cap` when the remainder will not cover it: roots (1), venues (2), screen (3),
groups (25), analytics (2, switch). The stage record's `detail` adds `flCalls`, `flSkipped`.

| Key | Shape | Cap |
|---|---|---|
| `flowlab-roots` | `{ v:1, generatedAt, session, n, list, dropped }` | 64 KiB |
| `flowlab-venues` | `{ v:1, generatedAt, session, tickers: [6.9], codes: [{ t, top }] }` | 96 KiB |
| `flowlab-screen` | `{ v:1, generatedAt, session, presets: { premium, voi, sweep }: 6.1 }` | 96 KiB, rows cut to 120 a preset when over |
| `flowlab-groups` | `{ v:1, generatedAt, session, expiry, groups: { <g>: { bars (13 half-hour), net call and put premium cents, status } } }` | 24 KiB |
| `flowlab-corr` | `{ v:1, generatedAt, session, status, symbols, window, sliding }` or `{ status: "off" }` | 32 KiB |

The groups' expiry is the third Friday of the current month when at least 5 sessions away, else of the
next month (calendar from `flows-calendar.js`); a group whose read fails keeps `status` with its reason.
Dry run: the leg reads `scripts/flows-legs/flowlab-fake.mjs` (a fake that taints on entry, invented
tickers only), and every payload carries `fixture: true`. Add the five keys to the golden manifest with
`node flows-pipeline-golden.mjs --write` and say so in the commit.

### 7.3 Row budget

Member routes touch D1 only through `readFlowsPayload` on the `nightly` route (1 row each) and the
session read; declare in `tests/lib/d1-budget.mjs`: `flowlab-nightly-read` 1 row a read. Nightly: 5
rows written. `flows-reads-contract` gains a ceiling for every new path (the enumeration fails without
one).

## 8. Copy (all in `shared/flows-flowlab-copy.js`)

Sentences at most 14 words, no forecast, modal or advice word (run through `tests/lib/copy-lint.mjs`),
no "vendor", provider name or the forbidden word of rule 3.

Page: title `Flow Lab`; subtitle `Contracts behind today's flow, read from the feed.`
Tabs: `Screen`, `Strikes`, `Greeks`, `Ladders`, `Routing`, `Lit prints`, `Groups`, `Relations`.
Drill tabs: `Prints`, `Minutes`, `Profile`, `Alerts`, `Structure`, `Routing`.

States (each a `.ds-` state chip plus one sentence):

| Code | Sentence |
|---|---|
| `loading` | `Reading the feed.` |
| `quiet` | `The feed returned no rows for this.` |
| `closed` | `The market is closed; showing the last session, {date}.` |
| `throttled` | `Your read limit was reached; showing the copy from {TRT}.` |
| `rate_limited` | `Your read limit was reached; try again in a minute.` |
| `timeout` | `The feed did not answer in time.` |
| `failed` | `The feed could not be read.` |
| `plan` | `This read is not on the site's plan.` |
| `unshaped` | `The feed's answer had an unexpected shape; nothing is shown.` |
| `no-oi` | `No open interest, so no volume to open interest ratio.` |
| `lean-undecided` | `Undecided: the range includes 50%.` |
| `few-prints` | `Fewer than 20 prints; no size outliers named.` |
| `no-unit` | `Relative shape only; the feed states no unit.` |
| `candidate` | `Same name and strike; not yet confirmed to include this contract.` |
| `no-expiry-in-rows` | `Strike rows carry no expiry, so no share hedge is computed.` |
| `min-volume` | `The feed returns contracts with 200 or more contracts only.` |
| `not-optionable` | `{T} has no listed options in last night's list.` |
| `off` | `Relations are off until the feed's answer shape is recorded.` |

Convention line under every lean, strike map and leg delta: `By convention: a fill at the ask is a buy.`
Glossary lines: `Volume to open interest`, `Ask share range`, `Value area`, `Point of control`, `Strike
map`, `Off-exchange share`, `Routing concentration`, each the exact string its info button opens.

## 9. Fixtures

`tests/gen-flowlab-fixtures.py` (Python 3, standard library and PyYAML only; writes its own sha256, the
spec's sha256 and the shape manifest's sha256 into the file) builds, for each of the eighteen operations
and the multi-leg feed, bodies from the 200-response schema: every key and JSON type taken from the spec,
string-typed numerics as decimal strings, invented tickers only (`SYX101`, `SYX202`, `SYX303`; the group
enum values as they are; `SPY` only in `analytics`), invented UUIDs, contracts built with `osiOf`'s rule.
Worlds: `normal` (a session with 380 minutes of bars, 50 prints of which 2 canceled, a 30-level profile,
a 3-leg strategy that includes the contract and one that does not), `thin` (5 prints, no OI), `empty`,
`unshaped` (one body per operation with a wrong type), `plan` (status 403 bodies). For the analytics
operations the generator writes an assumed shape and marks the file's entry `shape: "assumed"`; the
suite asserts that the switch stays off in `wrangler.toml` while any entry is assumed.
`tests/flows-probe-contract.mjs` holds the fixtures to the spec and fails a fixture whose `source` claims
to be observed.

## 10. UI design

### 10.1 Structure

`flowlabPage` is the shell (rail, title row, freshness pill) plus:

```
.fl            one CSS grid, height 100dvh minus the shell header, no page scroll
  .fl-head     title, subtitle, ticker field (combobox over the universe names), Refresh, info
  .fl-tabs     role=tablist, eight tabs (FlowsUI.segmented semantics: arrows, Home, End), #view=<tab>
  .fl-stage    the tab panels stacked in one grid cell; inactive panels inert and visibility:hidden
```

Each panel is a grid of `ui-card` modules (the existing glass material, tokens from
`docs/flows-design-system.md`, `.ds-` state chips). A module has a header (title, the TRT read stamp,
Show all where it fits rows) and a body that never scrolls: a fitter (`fit` from the Status page's
pattern: hide trailing rows, say `+N more <what> in Details`) runs on resize, font load and data.

### 10.2 Panels by size

Sizes: XL 1920x1080, L 1440x820, M 1024x768, S 390x844. At S a second segmented switch under the tabs
picks one module of the panel at a time.

| Tab | XL and L | M | S |
|---|---|---|---|
| Screen | Left 62%: contract table (columns: contract, last fill TRT, premium, Vol/OI, ask share range bar, sweep %, name share %, flags), sorted by a rank switch (Premium, Vol/OI, Name share, Ask share low, Sweep); right 38%: Preset list (six presets as radio rows with counts) over a scatter of Vol/OI (log x) against premium (sqrt y), dot = contract, colour = lean token, hollow = undecided | Table full width, scatter as a second module below at 34% height | Table (contract, premium, Vol/OI, lean glyph) or scatter |
| Strikes | Heatmap strike (rows, 24) by 15-minute TRT column, diverging tokens `--up-mark`/`--down-mark` at magnitude, hatched null cells, spot line; right rail: cumulative signed contracts by strike as horizontal bars | Heatmap full width, rail below | Heatmap only, 12 strikes nearest spot, the rest behind Show all |
| Greeks | Expiry chips (from the card's expiries) over two relative-shape lines, delta flow and vega flow, directional and total, OTM toggle; a sign row of triangles per 30 minutes | same, stacked | one series at a time |
| Ladders | One shared price axis (vertical); left: call and put volume bars mirrored; right: lit and off bars; spot line; off share per bin as a thin column; a total row | same | lit/off or option side by a switch |
| Routing | Exchange bars by contracts with premium and call/put trade split, HHI figure; trade codes as a second list | stacked | bars only |
| Lit prints | Market list (top 40 by premium) and, with a ticker, the ticker's newest 100 | one list by switch | one list |
| Groups | 25 group tiles (5x5 at XL, 5x5 at L, 5x5 compressed at M) each a sparkline of directional delta flow (relative) and the net call minus put premium figure; a tile opens the group's live read | 5x5 | list of 25 rows |
| Relations | Correlation matrix of up to 20 names (only when `flowlab-corr.status` is `ok`), else the `off` state | same | the top 10 pairs as a list |

### 10.3 The drill sheet

`FlowsUI.drill.open({ c, d?, alertId?, from })` opens a native `dialog.dr-sheet` (a 760 px side sheet
from 1024 px up, a 92dvh bottom sheet on S), focus trapped, page `inert`, Escape and scrim close, focus
returns to the control that opened it. Head: the contract in words (`SYX101 2026-11-20 120 Call`), the
OSI symbol in a monospace caption, spot and last fill TRT, a `Open in Flow Lab` link
(`/flows/flowlab/#view=screen&c=<OSI>`), close. Tabs (role=tablist):

- Prints: 50 rows (time TRT, price, size, premium, side glyph and tier word, venue, flags; canceled
  struck-through and tagged); bid and ask shown as the quote at the fill.
- Minutes: a price candle strip (minute OHLC) over stacked side-volume bars (ask, mid, bid, no side;
  tokens `--up-mark`, slate, `--down-mark`, hatched) with a cumulative ask-minus-bid line; the IV low-high
  band as a thin band on a second scale; the first aggressive minute marked.
- Profile: horizontal bars by price, side-stacked, POC bar outlined, value area bracket, VWAP line; sweep,
  floor, multi and cross shares of the profile as four meters.
- Alerts: one row per `flow_alert_id` seen in the prints; pressing one reads part `alert`.
- Structure: candidates of 6.5 with their state; pressing one reads part `legs` and draws a leg table and
  a payoff-free leg diagram (strikes on an axis, legs as arrows by side).
- Routing: the name's venue split today (route `venues`) with this contract's prints by venue beside it.

Every tab reads lazily on first open; Prints, Minutes and Profile share one `core` read (3 calls). The
sheet adds no global but `FlowsUI.drill`.

### 10.4 Entry points

`flowlabShell` puts a hidden `#fxFlowlab` root on the three pages. Their controllers render a drill
control only when `document.getElementById("fxFlowlab")` exists:

- Unusual: the network readout of a Name node and each row of the paths table gain a `Contracts`
  button listing the node's windows (from the alert rows it holds, each with `oc`); choosing one opens the
  drill with `c = oc`.
- Ticker Flow network: the readout of a selected chip lists its windows' contracts built by `osiOf(t, e,
  cp, k)` from the `dots`; choosing one opens the drill.
- Moves: the drill panel gains `Contracts`, which opens the sheet in screen mode for the ticker (route
  `screen?preset=premium&t=T`, 20 rows), each row opening the drill.

With the switch off none of these controls exist and `tests/flows-flowlab-render.mjs` compares the
three pages' HTML with the switch off to the base build byte for byte.

### 10.5 Tokens, motion, accessibility

Tokens only (`--label-1..3`, `--up-mark`, `--down-mark`, `--accent-ink`, the `.ds-` state chips, the
sequential tokens for magnitude); a colour literal anywhere in the new CSS or JS fails the suite. Direction
is never colour alone: a triangle and a signed figure accompany every coloured mark. No motion but the
existing sheet transition, none under reduced motion; no frame loop. Canvas is not used: every chart is SVG
from `FlowsUI.chart` kinds (`heatmap`, `bars`, `diverging`, `line`, `sparkline`), so the kernel's
keyboard, description, table view and provenance come with them. Every control 44 px on coarse pointers,
24 px otherwise; forced colors draws marks in `CanvasText`; axe clean at the four sizes.

## 11. Planted wrong builds (each must fail its named check)

Leaf (`tests/flows-flowlab.mjs`, through `tests/truth/mutants.mjs`):
1. `voi` with OI 0 returns 0 instead of null.
2. `askBounds.hi` excludes the no-side volume.
3. `mid` counted on the ask side.
4. Lean of a put not flipped.
5. Value area ties go down.
6. POC ties go to the higher price.
7. VWAP by float multiply (fails the BigInt oracle at the cent).
8. Canceled print included in the profile sums.
9. Size outliers named with 19 prints.
10. Strike map null cell written as 0.
11. Strike map sign of puts not reversed.
12. Ladder bin width rule picks the largest width.
13. `offShare` over lit only.
14. HHI by trades instead of contracts.
15. `parseOsi` accepts a 7-digit strike.
16. Roots accept a lowercase symbol.
17. Analytics correlation clipped to [-1, 1] instead of refused.
18. Greek flow printed with an absolute axis.
19. Structure labelled `confirmed` without a legs read.
20. First aggressive minute without the 10% clause.

Server (`tests/server-flowlab.mjs`):
21. Parameter validation after the gate (a bad `c` costs a token).
22. Cache key omits the day (yesterday's copy served today).
23. `core` charged once for three calls.
24. A refused second call in `core` still calls the third.
25. Switch read after the session check (owner-only leaks to a member as 403 not 404).
26. `owner` mode admits a member.
27. Misspelled switch admits the owner.
28. `nightly` route makes a feed call.

Nightly (`tests/flows-flowlab-nightly.mjs`):
29. Stage ignores the extras remainder.
30. Groups published with a failed group as zeros.
31. Dry-run payload without `fixture: true`.
32. Analytics read with the switch off.

Page and sheet (render suites):
33. A null figure printed as `0`.
34. A time printed in Eastern time.
35. Served copy containing the provider's name, "vendor" or the forbidden word.
36. Focus not returned to the opener on Escape.
37. Inactive panel not `inert`.
38. Page scroll at 1024x768 on Strikes.
39. Drill controls present on Unusual with the switch off.
40. Lean drawn by colour alone (no triangle).

## 12. Tests and gates to run

From `tests/`:
`node flows-flowlab.mjs`, `node server-flowlab.mjs`, `node flows-flowlab-nightly.mjs`,
`node flows-flowlab-render.mjs`, `node flows-flowlab-onescreen.mjs`, and the touched suites:
`contracts`, `lib-contract`, `docs`, `architecture`, `run`, `route-matrix`, `server-router`,
`server-pages`, `server-kernel`, `server-log`, `flows-probe`, `flows-registry-contract`,
`flows-contracts`, `flows-d1-budget`, `flows-reads`, `flows-weight`, `flows-vendor-budget`,
`flows-pipeline` (golden), `flows-pages-render`, `flows-layout-sweep`, `flows-public`,
`flows-net-render`, `flows-flow-net-render`, `flows-moves-render`, `fixture-guard`, `flows-copy-lint`.
Then from the root `node scripts/prepush.mjs` (with `PLAYWRIGHT_BROWSERS_PATH` and `FLOWS_TEST_SANDBOX=1`).

`tests/flows-flowlab-render.mjs` asserts every printed figure against an independent computation from
the fixture (exact integers and fractions, not the leaf), every state of section 8 by forcing each route's
stub, TRT only, the keyboard on tabs, rows and the sheet, the entry points from the three pages with the
switch on and byte equality with it off, axe at the four sizes, reduced motion, forced colors and the
planted builds 33 to 40. `tests/flows-flowlab-onescreen.mjs` sweeps every tab, every S module, every drill
tab and the empty, failed and throttled states at the four sizes for page scroll, inner scroll, clipped text
(zero tolerance, as `flows-layout-sweep`) and elements leaving their module.

## 13. Commit order

1. Registry entries, leaf, copy, fixtures and generator, leaf suite.
2. Server builders, route family, errors, worker mount, server suite, reads ceilings, budget lines.
3. Nightly leg, fake, section, products, door grammar, contracts, golden manifest, nightly suite.
4. Page, shell, controller, sheet, CSS, nav, glossary, about table, weight, render suites.
5. Docs rows, `gen-docs`, asset bump, suite registry pins, route matrix regeneration, prepush.

Each commit leaves the tree green for the suites it touches. Push `claude/wp2-flowlab`; do not merge.
