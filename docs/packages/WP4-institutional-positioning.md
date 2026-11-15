# WP4 Institutional and insider positioning: the Positioning page and two Political layers

Status: specification, written 2026-10-27 by the mentor of package WP4 for the implementer.
The implementer follows it exactly; a point it does not settle is asked, never guessed.
Base: `origin/main` at `36c1ea1`. Branch for the implementation: `claude/wp4-institutional-positioning`
(the spec is committed on it; the implementation continues on the same branch).

## 0. What this package adds, in one paragraph

Flows reads fast money (flagged option windows) and, for each name, a little slow money (13F ownership
rows, short interest, insider flow). It does not yet show slow money across the market. This package adds
(a) a new page, **Positioning** (`/flows/positioning/`), with four views: **Rotation** (how a fixed set of
13F filers moved their book between sectors from one quarter to the next), **Filings** (the newest 13F
filings and what each filer changed most), **Insiders** (insider buyers against sellers by sector over
time) and **Short side** (failures to deliver and short-sale volume by exchange, by sector and by name);
and (b) three new layers on the existing Political page, keyed by stock: **Late** (disclosures filed after
the legal limit, each tagged with its lag in exchange sessions), **Unusual** (disclosures the feed flagged,
with the move since the trade date against SPY) and **Money** (company PAC and lobbying totals for the
cycle). Every read is nightly. No member request makes a feed call. Everything is behind
`FLOWS_POSITIONING` (shipped `owner`) and the nightly half behind `FLOWS_POSITIONING_NIGHTLY`.

Out of scope (named so nobody adds it to this branch): the Market Floor ETF coverage (WP1), the Flow Lab
(WP2), any rail or hub change, any model call, any change to the ticker page, any change to the
existing `shared/flows-positioning.js` or `shared/flows-ownership.js` beyond what section 6.7 states.

## 1. Rules this package is held to

1. AGENTS.md in full. No comments in any source file. Generated files are regenerated, never edited
   (`docs/index.md`, the `gen:` blocks of AGENTS.md, the asset version).
2. No call to the live feed from any session, script or test. `UW_API_KEY` is never read by a test or a
   script of this package. The MCP tools of `.mcp.json` are never called. Fixtures are written by a
   generator from `docs/uw-openapi.yaml` and `scripts/flows-probe-shapes.json` (section 12).
3. Served copy (HTML, page script strings, payload strings a page prints, `title` and `aria-label`
   attributes) never names the data provider and never uses the word "vendor"; it says "the feed". The
   word "tape" appears in no new file: no copy, identifier, CSS class, id, key, test name or fixture field.
   New ids on the Political page use `plLate`, `plUnu`, `plMoney`, never a `Tape` suffix.
4. Every time a page prints is TRT through `FlowsUI.F.time`, `F.stamp` or `F.when`. Report dates,
   filing dates, settlement dates and session dates are dates, not instants; they are printed as dates
   (`F.day`) and the page says once, in its info dialog, that they are US dates.
5. A figure the feed did not send, could not be read, was refused by the plan, or has no stated unit is an
   em dash with its reason. A zero the feed sent is printed as zero. No sum treats a missing part as zero:
   every aggregate carries the count of parts it summed and the count it could not.
6. People appear only as initials (politicians, insiders) or as a 13F filer's registered filer name, which
   is public on the filing. A person's full name, a `people` array, a `founder_img_url`, a `logo_url`, a
   `social_links` value or a candidate name is never stored in a payload. The initials are computed in the
   nightly, not in the browser (section 6.6).
7. Pages are one screen with no page scroll and no inner scroll at 1920x1080, 1440x820, 1024x768 and
   390x844, in every view, every dialog and every state.
8. Every change is behind a switch. With `FLOWS_POSITIONING` off and `FLOWS_POSITIONING_NIGHTLY=off`, every
   existing page, route and payload is byte for byte what it was (section 13.6 holds it).
9. Every new pure function has an independent oracle; every suite plants wrong builds that must fail.
10. Before the push: the suites of section 13 green and `node scripts/prepush.mjs` green. Do not merge.

## 2. Switches

| Name | Where | Values | Shipped | Meaning |
|---|---|---|---|---|
| `FLOWS_POSITIONING` | `wrangler.toml` [vars] | `on`, `owner`, `off`; anything else is `owner` | `owner` | `on`: every member; `owner`: owners (`isOwner`, `FLOWS_RT_USERS`) only; `off`: nobody. When closed for a caller: the page is the unknown-page 404, `GET /api/flows/positioning` is `404 positioning_off` (after the method gate and the session, before any store read), the Political page is served without the layer controls and with no `data-layers`, and the read routes strip the new sections (section 7.3). |
| `FLOWS_POSITIONING_NIGHTLY` | nightly env and `.github/workflows/flows-pipeline.yml` | `off`, anything else on | on | `off`: the `positioning` stage is `skipped`, the extras leg plans no `ps` part, the `political` stage reads none of the new routes and `buildPolitical` emits exactly today's payload. |
| `FLOWS_POSITIONING_CAP` | nightly env | integer 0 to 1,500 | unset (600) | The per-night call cap of the `ps` parts (section 4.2), separate from `FLOWS_EXTRAS_CAP` so the new parts never starve `dx` and `vx`. 0 plans none. A value that is not an integer, or negative, is the default; above 1,500 is 1,500. |

`positioningMode(env, owner)` in `shared/flows-pos-switch.js` (a leaf that imports nothing) is the one
reader of `FLOWS_POSITIONING`: the trimmed lowercased value `on` is `"on"`; `off` is `"off"`; anything else,
unset included, is `"owner"`; the function returns `true` when the mode is `on`, or `owner` and
`owner === true`. The page row uses `gate: "FLOWS_POSITIONING"`, whose existing reading in
`server/routes/flows-pages.js` agrees with this rule (`off` closes, `on` opens, anything else is owner);
the test of section 13.1 holds the two equal over 12 spellings. Add the three names to `OPS_SWITCHES` in
`server/ops.js` (the cap only as its raw value, like the others).

`positioningNightly(env)` in the same leaf: `false` only for the trimmed lowercased `off`.
`positioningCap(env)`: the rule in the table.

## 3. The twenty-six endpoints and where each is read

Every entry goes into `RAW` of `shared/flows-vendor-ops.js` with `id`, `path`, `licence`, `klass`, `plan`,
`maxBytes` and `reads` (the fields this package reads, held strict by the weekly probe once the shape is
observed, section 12.2). Add `"premium"` to `PLANS` (the spec calls four congressional routes "a premium
endpoint"; it is neither `advanced` nor `enterprise`) and update `tests/flows-probe-contract.mjs` where it
enumerates the plan vocabulary. `limiter` is `null` for every entry: no member request reaches any of them.
No path is spelled anywhere outside the registry; every call is `pathFor(id, params)`.

| # | id | path | plan | klass | licence | Read by | Cadence and budget |
|---|---|---|---|---|---|---|---|
| 1 | `inst-list` | `/api/institutions` | advanced | slow | text | positioning stage | 1 page (`limit` 100, `order` `total_value`, desc) every night; reads `cik`, `name`, `short_name`, `is_hedge_fund`, `date`, `filing_date`, `total_value`, `share_value`, `call_value`, `put_value`, `buy_value`, `sell_value`. Never `people`, `founder_img_url`, `logo_url`, `description`, `website`, `tags`. |
| 2 | `inst-latest` | `/api/institutions/latest_filings` | advanced | slow | text | positioning stage | 1 page, `limit` 100, `order` `filing_date` desc; reads `cik`, `name`, `short_name`, `is_hedge_fund`, `filing_date`. |
| 3 | `inst-holdings` | `/api/institution/{name}/holdings` | advanced | slow | aggregate | positioning stage | only for a tracked filer whose `filing_date` is newer than the stored one, at most 12 a night, `limit` 100, `order` `value` desc; reads `ticker`, `sector`, `units`, `units_change`, `value`, `perc_of_share_value`, `put_call`, `security_type`, `date`. |
| 4 | `inst-activity-v1` | `/api/institution/{name}/activity` | advanced | slow | aggregate | positioning stage | deprecated in the spec. Called only when `inst-activity` answered 404 or 410 for that filer that night, at most 3 a night. Same `reads` as row 5. Registered with `deprecated: true` (a new optional registry field; the probe contract treats it as documentation, not as a request to call). |
| 5 | `inst-activity` | `/api/institution/{name}/activity/v2` | advanced | slow | aggregate | positioning stage | same filers as row 3, `start_date` the stored report date, `limit` 200; reads `ticker`, `units`, `units_change`, `report_date`, `filing_date`, `put_call`, `security_type`, `price_on_report`. |
| 6 | `inst-sectors` | `/api/institution/{name}/sectors` | advanced | slow | aggregate | positioning stage | each tracked filer (section 4.1) once its stored sector rows are older than 20 days or its filing is new, `limit` 40 (both report dates fit); reads `sector`, `report_date`, `value`, `positions`, `positions_increased`, `positions_decreased`, `positions_closed`. |
| 7 | `insider-sector` | `/api/insider/{sector}/sector-flow` | advanced | slow | aggregate | positioning stage | 11 calls a night (one per value of the spec's `Sector` enum), `limit` 120; reads `date`, `buy_sell`, `transactions`, `uniq_insiders`, `volume`. `premium` and `avg_price` are not read (unit not stated; the dossier already withholds the same field on the ticker route). |
| 8 | `insiders` | `/api/insider/{ticker}` | advanced | slow | text | extras leg, part `ins` | per name, refresh 30 days, max 60; reads `is_person` only (a count of persons against entities). Never `name`, `name_slug`, `cik`, `logo_url`, `social_links`. |
| 9 | `insider-bs` | `/api/stock/{ticker}/insider-buy-sells` | advanced | slow | aggregate | extras leg, part `ibs` | per name, refresh 3 days, max 7; reads `filing_date`, `purchases`, `sells`. `purchases_notional` and `sells_notional` are read into the extract only as `withheld: "unit"` until a probe states a unit (section 6.3). |
| 10 | `ftds` | `/api/shorts/{ticker}/ftds` | advanced | slow | aggregate | extras leg, part `ftd` | per name, refresh 7 days, max 21; reads `date`, `quantity`, `price`. |
| 11 | `short-venues` | `/api/shorts/{ticker}/volumes-by-exchange` | advanced | slow | aggregate | extras leg, part `svx` | deep names only (board, focus, owner holdings, deepening rotation), refresh 20 hours, max 3 days, `newer_than` 14 calendar days back; reads `date`, `exchange_name`, `market_center`, `short_volume`, `total_volume`. |
| 12 | `cg-unusual` | `/api/congress/unusual-trades` | premium | nightly | print | political stage | 1 page `limit` 200; reads `id`, `ticker`, `transaction_date`, `filing_date`, `transaction_type`, `amount`, `asset_type`, `unusual_activity_tags`, `politician_id`, `politician_name` (initials only, section 6.6). |
| 13 | `cg-unusual-tickers` | `/api/congress/unusual-trades/by-tickers` | premium | nightly | print | political stage | 1 call, `tickers` the board's and focus roster's names (at most 60, comma joined), `date_from` 90 days back; same reads as row 12. Rows are merged with row 12 by `id`. |
| 14 | `cg-unusual-stats` | `/api/congress/unusual-trades/stats` | premium | nightly | aggregate | political stage | 1 call; reads only the top-tickers and industry groupings of `data` (the keys are recorded by the probe; until then the stage stores the count of top-level keys and nothing else). Party, chamber, committee and politician lists are never read. |
| 15 | `cg-unusual-chart` | `/api/congress/unusual-trades/chart-data` | premium | nightly | aggregate | political stage | 1 call, `date_from` 90 days back; reads `spy_prices[].date`, `spy_prices[].close`, `trades[].id`, `trades[].ticker`, `trades[].transaction_date`, `trades[].price_at_trade`, `trades[].price_current`, `trades[].sector`, `trades[].is_unusual`. |
| 16 | `cg-late` | `/api/congress/late-reports` | advanced | nightly | print | political stage | up to 3 pages, `limit` 200, walked back by `date` like the existing ladder; reads `ticker`, `transaction_date`, `filed_at_date`, `txn_type`, `amounts`, `politician_id`, `name`, `reporter`, `member_type`. |
| 17 | `cg-politicians` | `/api/congress/politicians` | advanced | nightly | text | political stage | 1 call, `last_traded_within_months` 6; used only to map `politician_id` to initials and chamber; reads `politician_id`, `name`, `member_type`. |
| 18 | `cg-trader` | `/api/congress/congress-trader` | advanced | nightly | print | political stage | at most 6 calls: the filers with the most late reports in the window, `limit` 100, `date_from` 365 days back, by `name`; gives each filer's late share (late rows over all rows of the year). Same reads as row 16. |
| 19 | `pp-disclosures` | `/api/politician-portfolios/disclosures` | enterprise | slow | text | political stage | 1 call, `latest_only` true; reads `politician_id`, `disclosure_year`, `filing_date`, `chamber`. Never `url`, `name`, `politician_name`. |
| 20 | `pp-people` | `/api/politician-portfolios/people` | enterprise | slow | text | political stage | 1 call; reads `id`, `name` (initials only). |
| 21 | `pp-recent` | `/api/politician-portfolios/recent_trades` | enterprise | nightly | print | political stage | 1 call, `filter_late_reports` true, `limit` 200; merged into the Late layer by identity (section 6.6). |
| 22 | `pp-portfolio` | `/api/politician-portfolios/{politician_id}` | enterprise | slow | aggregate | political stage | at most 6 a night (the ids of row 18), refresh 30 days from the stored payload; reads the holdings' ticker and position count only (the probe records the nested key names; until then the stage stores the count of portfolios). |
| 23 | `pol-trades` | `/api/politics/politician/trades` | enterprise | nightly | print | political stage | 1 call, `filter_late_reports` true, `limit` 200; merged like row 21. |
| 24 | `fec-candidates` | `/api/politics/fec/candidates` | enterprise | slow | aggregate | political stage | 1 page, `limit` 100; stores only the count of candidates and of distinct companies. No candidate name is stored. |
| 25 | `fec-companies` | `/api/politics/fec/companies` | advanced | slow | aggregate | political stage | up to 3 pages, `limit` 200, `cycle` the current even year; reads `ticker`, `cycle`, `pac_total`, `pac_count`, `pac_contribution_count`, `dem_total`, `rep_total`, `other_total`, `lobbying_total`, `employee_total_estimated`. Refresh 7 days from the stored payload. |
| 26 | `fec-contributions` | `/api/politics/fec/contributions` | enterprise | slow | aggregate | political stage | 1 call per board name with a `fec-companies` row, at most 12, `aggregated` true, `ticker`; stores the count of candidates and the summed PAC tier amount per ticker. |

Plan refusals. A `premium` or `enterprise` route that answers 401, 402, 403 or 404 is recorded in the
payload it feeds as `plan: { [id]: { status, since } }` and is not called again for 7 days: the stage reads
the previous stored payload first (the pattern of `holdersRefusal` in `scripts/flows-nightly/sections/alerts.mjs`)
and skips the route while `since` is younger than 7 days. A 429 or 5xx is `failed` for that night only.
The section the route feeds is then an honesty state (section 11), never an empty list.

Calls a night after the cold start, by design: rows 1, 2, 7 and 12 to 26 are at most 1 + 1 + 11 + 1 + 1 +
1 + 1 + 3 + 1 + 6 + 1 + 1 + 1 + 6 + 1 + 1 + 3 + 12 = 53; rows 3 to 6 at most 12 + 12 + 3 + 40 = 67
(cold start 60 sector reads, section 4.1); rows 8 to 11 under `FLOWS_POSITIONING_CAP` (600). Add these as
`BUDGETS.positioning` (`{ nightlyMax: 720, window: "night" }`) and hold it equal to the code constants in
`tests/flows-probe-contract.mjs` like the other `BUDGETS` figures. The day line is not approached.

## 4. Nightly plan

### 4.1 The tracked filers

`trackFilers(list, prior)` in `shared/flows-pos-13f.js`: from the `inst-list` rows, the 40 largest
`is_hedge_fund === true` by `total_value` (parsed with `centsOf` of `shared/flows-sides.js` from the
string, rounded to whole dollars) and the 20 largest of the rest, de-duplicated by `cik`, 60 at most. A
filer that was tracked the night before and left the list is kept for one quarter (90 days from its
`filing_date`) so a rotation is not made to look like an exit by the list's own churn; it is marked
`kept: true`. Filers are keyed by `cik`; the path parameter `{name}` is the filer's `name` as the list
sent it (encoded by `pathFor`).

The sector reads are planned by `planFilers(tracked, prior, now)`: a filer with no stored sector rows
first, then a filer whose `filing_date` is newer than the stored one, then the oldest stored read; at
most 40 a night; a stored read younger than 20 days is not read again unless the filing is new.

### 4.2 The `ps` parts (per name, in card-x)

Add four parts to `PARTS` in `shared/flows-vendor-extras.js` under a new group `ps`:

| id | op | rv | refreshS | maxS | scope |
|---|---|---|---|---|---|
| `ftd` | `ftds` | 1 | 7 days | 21 days | every universe name |
| `svx` | `short-venues` | 1 | 20 hours | 3 days | deep names only |
| `ibs` | `insider-bs` | 1 | 3 days | 7 days | every universe name |
| `ins` | `insiders` | 1 | 30 days | 60 days | every universe name |

`GROUPS` gains `ps`. `SLOW_IDS` and the `dx`/`vx` planner are unchanged: `planSlow` is called a second time
with `ids = PS_IDS` and `cap = positioningCap(env)`; `svx` is offered only for the deep names (a new
optional `scopeOf(id, ticker)` argument; the default answers every name, so existing calls are unchanged).
`SHED_ORDER` becomes `["svx", "ins", "ibs", "ftd", ...today's list]`: the `ps` parts shed first, so no
existing section loses room. `fitSection` and `shedNextPart` work unchanged on the new group. With
`FLOWS_POSITIONING_NIGHTLY=off` the second planner call is not made and no `ps` key is written: card-x is
then byte for byte today's.

Expected night after the cold start on 856 names: 856/7 + 856/3 + 856/30 + about 170 deep names at 20 hours,
about 122 + 285 + 29 + 170 = 606, just over the 600 cap; the planner's age order spreads the excess, and
the 40-night simulation of section 13.2 holds that no part outlives its `maxS`. The cold start reaches
every name inside 7 nights.

### 4.3 Stages

Add to `STAGES` in `scripts/flows-nightly/stages.mjs`:

- `stage("positioning", ISOLATION.isolated, ["card-x"], ["positioning"])`, inserted right after `card-x`
  (before `compute`), so it reads the night's merged `ps` parts from the run's store.

The political additions run inside the existing `political` stage (its declaration is unchanged; it
still publishes `political` only). The stage's `detail` gains at most three fields when the new reads ran:
`plRefused` (count of plan refusals), `plLate` (late rows kept), `plUnusual` (unusual rows kept).

New files: `scripts/flows-legs/positioning.mjs` (the I/O of section 3 rows 1 to 7, through the pool and
the deadline, failures filed by status like `scripts/flows-legs/extras.mjs`) and
`scripts/flows-nightly/sections/positioning.mjs` (`runPositioning(ctx)`: reads the prior `positioning`
payload, runs the leg, calls `buildPositioning`, publishes). The dry run uses a fake in
`scripts/flows-legs/positioning-fake.mjs` that touches the taint (`scripts/flows-legs/taint.mjs`) on entry
and serves the fixture bodies of section 12. The section obeys the layer rule of
`tests/flows-legs-contract.mjs` (it imports no other section) and adds itself to `nightlyExecution()`.

## 5. Payloads

### 5.1 The new global key `positioning`

Register `global("positioning", { capBytes: 96 * 1024, required: ["v", "sessionDate", "generatedAt"] })` in
`shared/flows-products.js`, add it to the door's exact-key grammar in `server/store.js` and to
`tests/lib/emit-keys.mjs`. Shape (every array capped as shown; `null` always means "not known", never 0):

```text
{
  v: 1, sessionDate, generatedAt, fixture?,
  basis: { calls, refused: { [opId]: {status, since} }, failed: { [opId]: n } },
  rotation: {
    status: ok|quiet|pending|unavailable, why?,
    quarter: { now: "2026-09-30", prior: "2026-06-30" } | null,
    filers: { tracked, compared, notFiled, unread },
    sectors: [ {                                   // the 11 sectors, fixed order of the spec's enum
      s, wNow, wPrior, dW,                         // mean portfolio weight in percent of share value, 2 dp; dW = wNow - wPrior in points
      inc, dec, closed, pos,                        // summed position counts
      breadth,                                      // (inc - dec) / pos, 4 dp, null when pos = 0
      valueNow, valuePrior,                         // summed dollars, integers
      n                                             // filers that held the sector in either quarter
    } ]
  },
  filings: {
    status, why?,
    rows: [ { cik, filer, hf, filed, report, lagD, top: [ { t, sec, du, dv } ] } ]   // 40 rows; top 5 by |dv|
  },
  insiders: {
    status, why?,
    window: { from, to, sessions },
    sectors: [ { s, buyers, sellers, buyTx, sellTx, buyVol, sellVol, net, days: [[date, b, s]] } ]   // days: 60 newest, uniq insiders
  },
  shorts: {
    status, why?,
    ftd: { asOf, names, sectors: [ { s, notional, heavy, n, unread } ], top: [ { t, sec, date, q, px, notional, adv, share } ] },  // top 40 by share
    venues: { asOf, names, mix: [ { x, short, total, share } ], sectors: [ { s, short, total, ratio, n } ], top: [ { t, sec, ratio, ratio10, venues } ] }   // top 40 by ratio
  }
}
```

Units: `dW`, `wNow`, `wPrior` in percentage points of share value; `valueNow`, `notional` in whole dollars
(integers); `q` and `short`, `total` in shares; `px` dollars to the cent (integer cents in the payload, key
`pxC`); `ratio`, `share`, `breadth` as fractions to 4 dp. Build budget: about 41 KB on the 856-name
fixture; the leaf `fitPositioning` drops `filings.rows[].top` first, then trims `top` lists to 20, and
records `shed: [..]` in `basis`.

### 5.2 Card-x `ps` section

Each part is `{ at, rv, x }` or `{ at, rv, shed: 1 }` as today. Extracts:

```text
ftd: { rows: [[date, q, pxC]] }                     // 20 newest settlement dates, q integer shares
svx: { days: [[date, short, total]], last: { date, venues: [[exchange, market_center, short, total]] } }   // 10 days; venues <= 16
ibs: { rows: [[filing_date, purchases, sells]], notional: { withheld: "unit" } }                          // 12 newest
ins: { persons, entities, total }
```

A reducer that meets an unexpected shape returns `{ fail: "unshaped" | "type:<field>" | "empty" }` exactly
as the `dx` reducers do, so `shapeHealth` reports it and the nightly gate warns under `extras-shape`.

### 5.3 Political payload additions

When the nightly switch is on, `buildPolitical(raws)` adds four keys; when off, it is byte for byte today's
(held by a golden in section 13.6):

```text
late: { status, why?, window, rows: [ { t, side, lo, hi, txn, filed, lagS, lagD, over45, who, ch, src } ],   // 200 newest by filed
        byT: { [ticker]: { n, filers, maxS, medS, who: [initials] } }, filers: [ { who, ch, late, all, share } ] },
unusual: { status, why?, rows: [ { id, t, side, lo, hi, txn, filed, lagS, tags: [code], who, ch, r, rSpy, ex } ],
           byT: { [ticker]: { n, tags: [code], filers } }, top: [ { t, n } ], groups: [ { g, n } ] },
money: { status, why?, cycle, byT: { [ticker]: { pac, pacN, dem, rep, other, lobby, emp, cands } }, candidates: n|null },
held: { status, why?, byT: { [ticker]: n }, portfolios: n|null },
plan: { [opId]: { status, since } }
```

`lagS` is exchange sessions from the trade date to the filing date (`sessionsBetween` of
`shared/flows-calendar.js`; `null` outside the table's years, and the page prints the dash with "outside the
session calendar"); `lagD` calendar days; `over45` is `lagD > 45` (the STOCK Act's 45 days). `r` is
`price_current / price_at_trade - 1` (null when either is missing or not positive), `rSpy` the SPY return
from the close on or before `txn` to the last `spy_prices` close, `ex = r - rSpy`; all three to 4 dp. `who`
is initials (section 6.6), `ch` is `H`, `S` or `X` (house, senate, other) when the feed states it, else
null. `tags` are codes from `UNUSUAL_TAGS` (section 6.5). `money` figures are whole dollars parsed with
`centsOf`; `emp` is an estimate and is printed with the word "estimated". The political cap in
`shared/flows-products.js` (today unset, so the default) is raised to 120 KiB with `fitPolitical` trimming
`late.rows` to 100 and then `unusual.rows` to 60 before anything existing is touched.

## 6. Pure leaves and their mathematics

All new leaves are under `shared/`, import only `shared/` modules, read no clock (`now` is passed), and
are held by `tests/architecture.mjs`'s layer table. Names (all free on `origin/main`):
`shared/flows-pos-switch.js`, `shared/flows-pos-13f.js`, `shared/flows-pos-insider.js`,
`shared/flows-pos-short.js`, `shared/flows-pos-build.js`, `shared/flows-pol-layers.js`.

### 6.1 13F rotation (`flows-pos-13f.js`)

For each compared filer f (tracked, with sector rows for both the latest quarter end Q and the one before
it P; Q is the modal latest `report_date` across tracked filers; a filer whose latest report date is not Q
is counted in `notFiled`, one with no rows in `unread`):

- weight `w_f,s(Q) = 100 * value_f,s(Q) / Σ_s value_f,s(Q)`; same for P. A sector a filer did not hold is
  weight 0 for that filer: this is a real zero (the filer reported its book; the sector is not in it) and
  is counted, not a missing figure.
- `wNow_s = mean_f w_f,s(Q)`, `wPrior_s = mean_f w_f,s(P)`, `dW_s = wNow_s - wPrior_s` over the compared
  filers (equal weight per filer, so the largest book does not decide the answer). Σ_s dW_s = 0 exactly up
  to rounding; the leaf rounds with `roundTable` of `shared/flows-round.js` so the printed column foots to
  0.00.
- `breadth_s = (Σ_f inc - Σ_f dec) / Σ_f pos`.
- The page states: "Weights move with prices as well as trades; this is the book, not the buying." No
  claim of flow is made from `dW` alone; `breadth` is the trading-side figure.

`filings.rows[].top`: from `inst-activity` (or `inst-holdings` when activity failed) for the filer's
latest report: `du = units_change`, `dv = units_change * price_on_report` in whole dollars (null when the
price is missing), top 5 by |dv|, with `sec` from the universe. `lagD` = filing date minus report date in
calendar days (the 45-day 13F limit is stated in the info dialog).

### 6.2 Insider flow by sector (`flows-pos-insider.js`)

Rows of `insider-sector` per sector are grouped by date and `buy_sell`. `buyers` and `sellers` are the
sums of `uniq_insiders` over the window (the 60 most recent dates both sides cover; the window is the same
for every sector: the intersection of the dates the 11 reads returned, so sectors are comparable), `buyTx`
and `sellTx` the sums of `transactions`, `buyVol` and `sellVol` the sums of `volume` (shares).
`net = (buyers - sellers) / (buyers + sellers)`, 4 dp, null when both are 0. A unique insider counted on
two dates is counted twice; the page says "insider-days" in the axis title and the info dialog says why.
No dollar figure is computed (unit not stated).

### 6.3 Short side (`flows-pos-short.js`)

- FTD per name: the newest `ftd` row; `notional = q * px` in whole dollars (half away from zero);
  `adv` = the name's `info` part `avg30_volume` from `dx` (null when the part is absent or stale past its
  `maxS`); `share = q / adv`, null when `adv` is null or 0. `heavy` per sector counts names with
  `share >= 0.005`. Sector `notional` sums the names with a row no older than 21 calendar days before the
  sector's newest `asOf`; `n` counts them, `unread` counts universe names of the sector without such a row.
- Short-sale volume per name: `ratio = Σ short / Σ total` over the newest date across venues; `ratio10`
  the pooled ratio of sums over the 10 dates held. Sector ratio: pooled sums over names whose `svx` is not
  past its `maxS`. Venue mix market-wide: per `exchange_name`, Σ short and Σ total over the newest date of
  each name, `share = Σ short_x / Σ short`.
- Copy that must appear (section 10): short-sale volume is not short interest; a market maker's hedge is a
  short sale; FTD figures are published with a lag of about two weeks.

`ibs` notional: the extract keeps `notional: { withheld: "unit" }`. Add `ibs.notional` and
`insider-sector.premium` to `UNIT_STATUS` as `"unstated"`; the Insiders view prints counts only and its
info dialog says why the dollars are not shown.

### 6.4 Assembly (`flows-pos-build.js`)

`buildPositioning({ sessionDate, generatedAt, universe, list, latest, sectorsByCik, activityByCik,
holdingsByCik, insiderBySector, psByTicker, prior, refused, failed })` returns the payload of 5.1 and
`fitPositioning(payload, cap)` sheds as stated. Every status follows section 11.

### 6.5 Political layers (`flows-pol-layers.js`)

`lateRows`, `unusualRows`, `moneyRows`, `heldRows`, `filerShares`, `mergeById`, `mergeByIdentity` (the
identity of the existing ladder: politician, ticker, trade date, filed date, amount) and
`UNUSUAL_TAGS`: a frozen table from the feed's tag strings to codes and short words, built from the
fixture and the probe's observed values; a tag not in the table becomes the code `other` and is counted,
never printed as feed text. `side` uses `sideOf` and the bands use `parseBand` of
`shared/flows-political.js`, so no second parser exists.

### 6.6 Initials

`initialsOf(name)` in `flows-pol-layers.js`: the first letter of the first and the last word of the name
after stripping honorifics (`Hon.`, `Rep.`, `Sen.`, `Mr.`, `Mrs.`, `Ms.`, `Dr.`) and suffixes (`Jr.`,
`Sr.`, `II`, `III`, `IV`), upper-cased, ASCII-folded; one word gives one letter; nothing usable is `"?"`.
The browser's `initials` in `assets/js/flows-political.js` is held equal to it on 300 names in
`tests/flows-pol-layers.mjs`. Full names never leave the leaf: the payload builder asserts that no string
in `late`, `unusual`, `money` or `held` contains a space-separated pair matching the feed's
`politician_name` or `name` values it was given (a test of section 13.3 plants a build that stores
`who: name`).

### 6.7 Existing modules touched

`shared/flows-political.js`: `buildPolitical` gains the four keys only when `raws.layers` is present.
`shared/flows-vendor-extras.js`: the `ps` group, parts, scope argument and shed order of 4.2.
`assets/js/flows-political.js`: the existing `title="The vendor feed carries no party field..."` and the
`plTape`, `plTapeP` ids are rule violations in served copy; this package rewrites the title to "The feed
carries no party per filing, so no party split is shown or inferred." and renames the ids to `plFeed`,
`plFeedP` (the CSS and tests that name them move with them). Nothing else in those files changes.

## 7. Worker

### 7.1 Route family `server/routes/flows-positioning.js`

`flowsPositioningRows(deps)` is one row, `GET /api/flows/positioning`, `auth: "flows"`. Order: method
(405 before 401), session, `positioningMode(env, isOwner(env, username))` (closed: `404 positioning_off`,
add the code to `server/errors.js`), then:

- no query: `readFlowsPayload(env, "positioning")` (one primary-key read), JSON with the `X-Fresh-*`
  headers of the nightly class, `pending` body `{ status: "pending" }` when the key was never written,
  the last good copy on a store quota day like the other nightly reads;
- `?t=<ticker>` (validated by `requireTicker`; a fixture name off a test host is `400 invalid_ticker`):
  one read of `card-x:<T>` and the answer `{ t, sessionDate, ps }` where `ps` is the card-x section or
  `null` with `why: "absent"`; the rest of the card-x is not sent.

Rows read: 1 per request. Add both to the ceilings of `tests/flows-reads-contract.mjs` (ceiling 1) and the
route to `tests/fixtures-route-matrix.json` (regenerate with `node route-matrix.mjs --write` in a commit
that moves no other code). Register the family in `worker.js`'s router after `flowsReadyRows`.

### 7.2 Page row

`server/routes/flows-pages.js` `PAGES` gains
`{ slug: "positioning", gate: "FLOWS_POSITIONING", render: (username) => FLOWS_PAGES.positioningPage({ username }) }`
and the Political row passes `layers: positioningMode(env, owner)` to `politicalPage`. `positioningPage` lives
in `shared/flows-page-positioning.js` (the ledger page's pattern) and is added to `FLOWS_PAGES`. Update the
page counts the suites hold (`flows-pages-render` fifteen to sixteen, `flows-layout-sweep` eighteen to
nineteen specs, `server-pages`' path list).

Navigation: while the switch ships `owner`, no `FLOWS_NAV` item is added (the About page's contract holds
its table equal to `FLOWS_NAV`, and a member must not see a link that answers 404). The page is reached
from a chip on the Political page title row (`Positioning`, an `<a class="pl-chip">`), rendered only when
`layers` is true, and by its address. The item (`{ key: "positioning", href: "/flows/positioning/",
label: "Positioning", glyph: "levels" }` in the Market group after Political, the `TABS` market keys and the
About row) is added in the pull request that ships the switch `on`, not here.

### 7.3 Stripping on the existing reads

- `/api/flows/political` (the `nightly("political")` row): when `positioningMode` is false for the caller,
  the body is served with `late`, `unusual`, `money`, `held` and `plan` removed. When the payload carries
  none of them (nightly off) the response is the stored bytes untouched (no parse). The parse happens only
  when the stored text contains `"late":` (a cheap check before `JSON.parse`).
- `/api/flows/card-x` (the `card-x` row): the same rule for the `ps` section.

Both are held byte for byte by section 13.6.

### 7.4 D1 budget

`tests/lib/d1-budget.mjs`: the nightly writes one more key (`positioning`), card-x writes are unchanged in
count; reads: the route's 1 row per request at the planned reader rate of the political page (declare a
reader `positioning-page` with 300 reads a day). `flows-d1-budget` must stay green.

## 8. The Positioning page: design

One screen, no page scroll, built on the `feedTabs` stage and `assets/js/flows-feed-os.js` (the Unusual
and Events pattern: a tablist over `#fdStage`, one `.fd-mod` visible, `#view=<tab>` in the address, the
fitter that trims trailing rows and adds Show all). Files: `shared/flows-page-positioning.js`,
`assets/js/flows-pos.js`, `assets/css/flows-pos.css`. No new global: `FlowsUI.pos` (a frozen object with
`mount`, `model` and `fmt`) is attached the way `FlowsUI.netMap` is; `globalThis.__PosTest` only where
there is no `document`. Only tokens: no colour literal (held by a scan in section 13.4).

### 8.1 Structure (served HTML)

```text
main.flows-main.pos
  header.pos-head                              title row, 48 px
    h1#fxTitle "Positioning"
    span.pos-stamp#posStamp                    "Built 22:41 TRT · session 2026-10-26"
    span.ui-chip.warn "Slow data"               title: "Quarterly, weekly and daily filings; none of this is live."
    button.pos-ibtn#posInfo (glyph info, aria-haspopup=dialog)
  div.pos-hero#posHero                         4 KPI cells, 64 px (phone: 2 x 2 grid, 112 px)
    cell 1 "Filers compared"   "52 of 60"       sub: "Q3 vs Q2 2026"
    cell 2 "Largest rotation"  "Technology +1.84 pts"  sub: "mean book weight"
    cell 3 "Insider net, 60 days"  "-0.42"       sub: "buyers against sellers, insider-days"
    cell 4 "Heavy fails"       "17 names"        sub: "FTD at least 0.5% of 30-day volume"
  feedTabs([["rotation","Rotation","posRotCard"],["filings","Filings","posFilCard"],
            ["insiders","Insiders","posInsCard"],["short","Short side","posShCard"]])
  div#fdStage
    section.fd-mod#posRotCard   ...           section 8.3
    section.fd-mod#posFilCard   ...
    section.fd-mod#posInsCard   ...
    section.fd-mod#posShCard    ...
  dialog.pos-sheet#posDrill                    the name drill (8.4)
  dialog.pos-info#posInfoDlg                   the info dialog (section 10)
```

Every module has its header (`h2`, a one-line `p.pos-sub`, the Show all slot the fitter fills) and a body.
The skeleton is served with the final geometry: em-dash cells and one reason line (`Loading the
positioning read.`), so nothing moves when data lands (held by the first-paint check of 13.4).

### 8.2 Layout at the four sizes

Grid of `.pos` is rows `48px auto 40px 1fr` (title, hero, tablist, stage), height `100dvh` minus the shell
chrome, as the feed pages do.

| Size | Hero | Rotation | Filings | Insiders | Short side |
|---|---|---|---|---|---|
| 1920x1080 | 4 cells in a row | diverging bar chart (left, 60%) + sector table (right, 40%) | table, 18 rows visible, top-5 changes as inline chips | heat strip 11 rows x 60 days (left, 65%) + net list (right) | two panes: FTD (sector bars over top-names table) and Short volume (venue mix stacked bar over sector ratio list over top names) |
| 1440x820 | 4 cells | chart 58% + table 42%, 11 rows (all) | 12 rows | heat strip 11 x 40 days (the oldest 20 behind Show all) + net list | same two panes, tables trimmed by the fitter |
| 1024x768 | 4 cells, subs hidden (title attr keeps them) | chart over table (chart 45% of height); table 11 rows compact (28 px) | 9 rows, chips collapse to a count "5 changes" | heat strip 11 x 30 days, net list below as one row of 11 chips | one pane at a time behind a segmented switch FTD / Volume |
| 390x844 | 2 x 2 grid | chart only, sector names on the bars, the table in Show all | 7 rows, two columns (filer, filed) + chevron opening the row's changes in the sheet | net list only (11 rows); the heat strip in Show all, landscape-scrolled inside the dialog is not allowed: the dialog shows 20 days | segmented FTD / Volume, each a 7-row list |

Targets: 44 px on coarse pointers for every control, 24 px elsewhere. Text sizes from `--t-caption` and
`--t-footnote`; figures in `font-variant-numeric: tabular-nums`.

### 8.3 Views

Rotation. A horizontal diverging bar per sector, zero centred, length `dW` on one scale (largest |dW| to
half the plot width, rounded up to the next 0.5 point for the axis), `--up-mark` for positive and
`--down-mark` for negative, with a printed signed value (`+1.84`, U+2212 for negative, `0.00` for an exact
zero) and a triangle glyph so colour is never the only channel. A second, thin bar under each shows
`breadth` on its own -1 to 1 scale, neutral `--fill-3` with a marker, labelled "breadth". The table:
Sector, Weight now, Weight before, Change, Breadth, Filers. A sector with `n = 0` prints the dash and "no
compared filer held it". Footer line: "52 filers compared · 5 not yet filed for Q3 · 3 not read".

Filings. Table: Filer (registered name, `hf` adds a small `HF` chip with title "Hedge fund, as the feed
tags it"), Filed (date), Report (quarter end), Lag (days, with "past 45" chip when over), Largest changes
(up to five chips `NVDA ▲ $412M`, `XOM ▼ $96M`; `$` from `F.usd` compact; a change with no price is
`NVDA ▲ 1.2M sh` in shares and says so in its title). A row opens the filer's changes in the sheet; a chip
opens the name drill.

Insiders. Heat strip: rows the 11 sectors, columns the window's dates (newest right), cell colour the
day's `(b - s)/(b + s)` on the sequential diverging tokens (`--up-fill`, `--down-fill`, `--fill-2` for
equal, a hatched `--fill-1` cell for a date the sector had no row: absence is not zero). Net list: sector,
buyers, sellers, net as a signed figure with triangle, transactions. Keyboard: the strip is one tab stop;
arrows move a cursor cell whose reading goes to a polite live region ("Energy, 2026-10-14: 3 buyers, 7
sellers").

Short side. FTD pane: bars per sector of `notional` (one scale, whole dollars compact), `heavy` count
printed beside, `unread` named in the footer ("212 names with no FTD row in 21 days"); top-names table:
Name, Sector, Settlement date, Shares failed, Share of 30-day volume, Notional. Volume pane: venue mix as
one stacked bar (largest six venues and "Other venues", each segment labelled when wider than 48 px and
listed in an adjacent legend always), sector ratio list (pooled ratio, 1 dp percent), top-names table:
Name, Sector, Short share today, Short share 10 days, Venues. A name opens the drill.

### 8.4 The name drill (`#posDrill`)

A `dialog` (380 px wide sheet on desktop, 70 dvh bottom sheet on a phone), focus trapped, page `inert`,
Escape and scrim close and return focus. Content from `GET /api/flows/positioning?t=`: the FTD bars of the
20 settlement dates, the 10-day short share line with today's venue breakdown, insider filings counts
(purchases and sells by filing date), persons against entities, a link "Open NVDA" to the ticker page. Each
missing part is its own dash line with the reason. One request per opened name, cached in the page for the
visit; a failure offers Retry.

### 8.5 States (section 11 applies)

Each view handles `pending` (nothing built yet tonight: "The first positioning read lands after tonight's
run."), `quiet` (built, nothing to show: the sentence names what was looked for), `unavailable` with its
`why` (`failed`, `plan`, `budget`, `off`), `partial` (a footer counts what is missing), and `stale` (the
payload's `sessionDate` is two or more sessions behind the expected session: the stamp turns `--warn` and
says "From the 2026-10-22 session"). The hero cells print the dash with the reason in their `title` and
in a visually hidden sentence.

### 8.6 Accessibility

One `h1`, `h2` per module, no skipped level. Tablist with arrows, Home, End, `aria-controls`; inactive
panels `inert` and `visibility: hidden` in the same box. Each chart has a hidden description and a table
twin (the sector table is the twin of the bars; the heat strip's twin is the Show all table). Contrast 4.5:1
for text over its surface (the glass suite's measure), focus visible, forced colors (`CanvasText` bars,
`Highlight` focus), reduced motion (no transition at all; the page has no animation otherwise).

## 9. The Political page: three layers

When `politicalPage({ username, layers: true })`, the left panel header gains a segmented group
`#plLayerSeg` (`role="group"`, `aria-label="Layer"`) after the size switch: **None** (default), **Late**,
**Unusual**, **Money**; the choice is in the address (`#layer=late`), written with `replaceState`. With
`layers` false the HTML is byte for byte today's.

- Late: each map tile and list row whose stock has a late filing carries a badge `L 38` (the largest lag in
  sessions; the tile `title` and `aria-label` add "filed 38 sessions after the trade, past the 45-day
  limit"); tiles without one are faded to `--label-3`. The right panel switches its list to the late rows
  (ticker, side, band, traded, filed, lag in sessions and days, initials), and the detail rail adds "Late
  filers" with each filer's initials and late share ("A.B. · 7 of 9 late this year").
- Unusual: badge `U 3` (flagged disclosures); the right panel lists the unusual rows with their tag words
  and "since the trade" (`r`) and "against SPY" (`ex`), signed, with the sentence under the list: "Measured
  from the trade date, which no reader knew until the filing."
- Money: tile badge removed; the detail rail adds "Company political money, cycle 2026": PAC total, PAC
  count, contributions, to Democratic and to Republican candidates and other (three neutral `--fill-3`
  segments, labelled; no party colours), lobbying, employees' giving (estimated), candidates counted.
  The panel says "Company money, not the filers on this page."

The sheet of the existing Show all dialog gets the same lists. Layers obey the page's one-screen contract
(the existing `tests/flows-political-render.mjs` sweep runs every layer at the four sizes).

## 10. Copy

Every sentence is at most 14 words, holds no forecast or advice word (the Ask guard's lexicon), names no
provider and never says "vendor" or "tape". Strings live in `shared/flows-pos-copy.js` (a leaf) for the
server half and are copied once into `assets/js/flows-pos.js`; `tests/flows-pos-render.mjs` holds the two
equal. The info dialog's sentences, in order:

1. "Slow money, read nightly from public filings the feed collects."
2. "13F filings report holdings at a quarter's end, up to 45 days later."
3. "Rotation compares each filer's book weights between the last two quarter ends."
4. "Weights move with prices as well as trades; this is the book, not the buying."
5. "Breadth counts positions raised against positions cut, by sector."
6. "Insider figures count insiders per day, so one insider can count twice."
7. "The feed states no unit for insider dollars, so none are shown."
8. "Failures to deliver are published about two weeks after settlement."
9. "Short-sale volume is not short interest; market makers' hedges count as short sales."
10. "Dates are US exchange dates; times are Türkiye time."
11. "Nothing here is advice or a forecast."

Political layer sentences: "Filed after the 45-day limit." / "Lag counted in exchange sessions from the
trade." / "Flags are the feed's; the page does not judge them." / "Measured from the trade date, which no
reader knew until the filing." / "Company money, not the filers on this page."

Honesty reason sentences (`why`): `failed` "The feed did not answer tonight." · `plan` "The site's data
plan does not include this." · `budget` "Tonight's read budget ran out before this." · `unit` "The feed
states no unit for this figure." · `unread` "Not read yet; names are read in rotation." · `stale` "From an
older session." · `absent` "No filing names this stock." · `calendar` "Outside the session calendar."

## 11. Honesty states

| State | When | Shown as |
|---|---|---|
| `pending` | key never written, or the section's stage has not run since the switch went on | the pending sentence, dashes |
| `quiet` | read ok, nothing qualifies (no late filing in the window) | a sentence naming the window and the test |
| `unavailable` | every read of the section failed, was refused, or was not made | dash and the `why` sentence; `plan` names the refused route class ("premium" or "enterprise") in the owner's Status page only |
| `partial` | some parts missing | figures from what was read, footer `n of m read` |
| `stale` | payload older than the expected session by two or more | stamp in `--warn` with the session |
| `withheld` | unit not stated | dash and the `unit` sentence |

A count or sum is never printed over zero parts. A sector with parts but every value missing prints the
dash, not 0.

## 12. Fixtures

### 12.1 Generator

`tests/gen-positioning-fixtures.py` (stdlib and PyYAML only) writes `tests/fixtures-positioning-vendor.json`
from the 200-response schemas of the 26 operations in `docs/uw-openapi.yaml`: synthetic bodies, invented
tickers in the fixture namespace (`SYX101`...; `SPY` only in `spy_prices`), invented filer names ("Fixture
Harbor Capital LP"...), invented politician names that are visibly fake ("Fixture Member Alpha"), every key
and JSON type checked against the spec, nullability honoured, string-typed numerics as strings. It records
`provenance.generator`, `nature: "synthetic, not observed on the wire"`, the spec's sha256 and the shape
manifest's sha256. For the operations `scripts/flows-probe-shapes.json` already observes it also checks the
keys against the manifest and exits 1 where they disagree; for the others it writes `observed: false`. It
includes: two quarters of sector rows for 60 filers with a planted rotation, 11 sectors of insider rows with
one sector missing three dates, FTD rows with a missing price, venues with 14 exchanges, late reports with
lags of 30, 45, 46 and 400 days and one outside the calendar's years, unusual trades with unknown tags,
chart data with a non-positive price, a premium refusal body and an enterprise refusal body.

### 12.2 Probe list

Add the 26 ids to `scripts/flows-probe-list.json` with `"tier": "planned"` (not strict) so the weekly probe
records their shapes; `tests/flows-probe-contract.mjs` holds every registry entry to the spec, the planned
tier to the new ids, and `BUDGETS.positioning` to the code constant.

## 13. Tests

Every suite gets `tests/suites/<name>.json` with a `command`, pinned to the lightest shard, then
`node tests/lib/suite-registry.mjs --write` and `node run-contract.mjs`.

### 13.1 `flows-pos-switch` (N)

The three readers over the 12 spellings (`on`, `ON`, ` on `, `owner`, `off`, `Off`, ``, unset, `yes`,
`0`, `true`, `of`), the page row's `gate` reading equal to `positioningMode`, the cap clamp. Planted: `on`
case-sensitive; unset read as `on`; misspelt read as `off` for the page but `on` for the route; cap not
clamped at 1,500; negative cap accepted.

### 13.2 `flows-pos-leaves` (N)

Oracles: `tests/gen-positioning-oracle.py` writes `tests/fixtures-positioning-oracle.json` with
Fraction-exact answers for rotation (weights, means, dW, footing), breadth, insider nets and windows, FTD
notional and share, pooled short ratios, venue shares, `lagS` by an independent session count from
`exchange_calendars` (the calendar fixture's method), `r`, `rSpy`, `ex`. The suite holds every leaf to it
on 300 seeded worlds plus the hand cases (a filer that sold a sector out entirely, a sector held by nobody,
equal buyers and sellers, zero total volume, a missing price, a trade on a holiday, a filing on the 45th and
46th day). The 40-night planner simulation for the `ps` parts on 700 and 856 names (cold start inside 7
nights; no part past `maxS`; the `dx` and `vx` planner's choices identical with and without the `ps` call).
Planted (each must fail by an assertion): rotation by summed dollars instead of mean weights; a missing
sector read as weight 0 for an unread filer; P and Q swapped; breadth over `inc + dec` instead of `pos`;
`dW` rounded per cell so the column does not foot; insider window per sector instead of the common window;
missing insider date read as zero; insider net including `premium`; FTD notional with a missing price as 0;
share against `adv` 0 as Infinity; heavy at 0.05 instead of 0.005; short ratio as mean of ratios instead of
ratio of sums; venue share over total volume; `lagS` in weekdays; `lagS` from filed to trade (negative);
`over45` as `>=`; `ex` sign flipped; `r` with a non-positive price kept; an unknown tag printed as feed
text; initials from the first two words; full name stored; `svx` offered for every name; `ps` shed after
`dx`; the `ps` planner sharing `SLOW_CAP`; the kept filer dropped the night it leaves the list.

### 13.3 `flows-pos-nightly` (N)

The dry run with the switch on and off: the `positioning` key emitted and valid under
`shared/flows-contracts.js`, no new key with the switch off, the emit otherwise byte for byte equal to the
golden manifest (`tests/fixtures-pipeline-golden.json` regenerated once in its own commit for the on case),
the stage record, plan refusals cached for 7 days from a stored payload, a 429 not cached, the fake taints,
the call count under `BUDGETS.positioning`. Planted: refusal cached forever; refusal never cached; a 5xx
cached as plan; the stage publishing with the nightly switch off; `people` stored; a candidate name stored.

### 13.4 `flows-pos-render` (C) and `flows-pos-firstpaint` (C)

Chromium, `page.route`, no server, the dry emit's `positioning` payload and fixture card-x rows. Every
view at the four sizes: no page scroll, no inner scroll, no clipped text (the layout sweep's measure), no
overflow, the Show all dialogs; every printed figure against an independent computation in Node from the
same payload; dashes with reasons for each absence; the drill (keyboard, focus return, Retry); TRT only (no
`ET`, `EDT`, `UTC` in any text node); the copy lint (no "vendor", no "tape", no provider name, 14-word
sentences, the guard's forecast lexicon); no colour literal in the CSS; axe clean at 390 and 1440; forced
colors; reduced motion. First paint: the skeleton's boxes do not move by more than 1 px when the data lands
(the ledger first-paint method, Chromium only). Planted builds of the served files: bars on two scales;
colour as the only sign channel; a missing insider date drawn as a neutral cell; `0` printed for a dash;
UTC stamp; the word "vendor" in the info dialog; the drill not returning focus; the stage scrolling at
1024x768; the hero computing "Heavy fails" from all names instead of rows; the Filings chip using shares
with a dollar sign; the venue legend dropping small segments.

### 13.5 `flows-pos-route` (N) and the Political layers in `flows-political-render` (C)

Route: gate order (405, 401, 404 `positioning_off` for a member under `owner`, open for an owner), one row
read, `pending`, `?t=` projection, fixture ticker refused, the stripping of 7.3 on both existing routes,
untouched bytes when nothing is stored. Planted: gate after the store read; stripping skipped for members;
the whole card-x served on `?t=`; parse of every political body. The political render suite gains the
three layers at the four sizes, the address, badges against the payload, initials only in every text node
and attribute of the new layers, and four planted builds (late badge in days, `ex` sign, Money coloured by
party, layers shown with `layers` false).

### 13.6 Byte-for-byte off

One block in `flows-pos-route`: with `FLOWS_POSITIONING=off` and the nightly off, every page in
`FLOWS_PAGES` renders identically to `origin/main`'s renders (snapshots from a committed fixture written by
the suite's `--write`), `/api/flows/political` and `/api/flows/card-x?t=` answer the stored bytes, and the
route matrix is unchanged apart from the new rows.

### 13.7 Existing suites to update and run

`contracts`, `docs`, `architecture`, `flows-weight` (the page's route weight and `DEFERRED` entry; the page
loads `flows-pos.js` eagerly and `flows-chart.js` after `flows-ui.js`), `flows-probe`, `flows-vendor-extras`,
`flows-registry-contract`, `flows-contracts`, `flows-legs`, `flows-pipeline` (the stage table),
`flows-reads`, `flows-d1-budget`, `flows-engine-budget`, `route-matrix`, `server-pages`, `server-router`,
`flows-pages-render`, `flows-layout-sweep`, `flows-political-render`, `flows-public` (no About change while
`owner`), `fixture-guard`, `flows-copy-lint`, `run`. Then `node scripts/prepush.mjs` from the root, green.

## 14. Registry, docs and assets

- `docs/modules.json`: rows for every new file (the leaves, the page module, the route family, the leg, the
  section, the fake, the page script and sheet, the generators, fixtures and suites), with a `show` cell on
  one row so the File map gains a line; `node scripts/gen-docs.mjs` and `--check`.
- `wrangler.toml`: `FLOWS_POSITIONING = "owner"`. `.github/workflows/flows-pipeline.yml`: pass
  `FLOWS_POSITIONING_NIGHTLY` and `FLOWS_POSITIONING_CAP` from repository variables (unset by default).
- `node scripts/bump-assets.mjs` once at the end (new CSS and JS), then `--check`.
- DEPLOY.md: one subsection "Positioning" under section 10 stating the switches, the first night's expected
  calls and the readback (the Status page's coverage view shows `positioning` with its bytes).

## 15. Order of work

1. Registry entries, `PLANS`, probe list, generator and fixtures; `flows-probe` green.
2. Leaves with their oracles and planted builds (13.1, 13.2).
3. Extras `ps` group and planner; `flows-vendor-extras` green.
4. Leg, section, stage, payload, products, door grammar; dry run; 13.3 green; golden regenerated in its own
   commit.
5. Route family, stripping, page row; 13.5, 13.6, route matrix in its own commit.
6. Page module, script, sheet; inspect screenshots at the four sizes (`scripts/render-preview.mjs`, which
   prints the Fixture data ribbon) before the render suite is written; then 13.4.
7. Political layers; the political render suite.
8. Docs, assets, registry repin if the balance moved, prepush; commit and push; report the branch. Do not
   merge.
