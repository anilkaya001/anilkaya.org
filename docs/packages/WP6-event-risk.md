# WP6 Event-risk console: the Events page grows, a halt channel, and feed-side alert templates

Status: specification, written 2026-10-27 by the mentor of package WP6 for the implementer.
The implementer follows it exactly; a point it does not settle is asked, never guessed.
Base: `origin/main` at `36c1ea1`. Branch: `claude/wp6-event-risk` (the spec is committed on it; the
implementation continues on the same branch). Do not merge.

## 0. What this package adds, in one paragraph

The Events page today answers "who reports in the next sessions and what is priced into it", plus macro
prints, FDA dates and the names that just reacted. This package turns it into an event-risk console. It adds
four views to the same one-screen stage: **Risk** (for every name reporting inside the earnings window, how
the options market has priced this name's past reports: the implied move at each report against the move
that followed, the earnings surprise beside it, a verdict with an interval, and today's implied move set
against that record), **New issues** (IPOs in the next three months, names listed in the last 30 days and
names delisted in the last ten sessions), **Policy** (the President's public schedule for the coming
sessions and the posts of the last five sessions, each placed against the US session in TRT) and **Halts**
(trading halts and resumptions as the feed streams them, plus the last 14 days the feed account has
recorded). The Week view gains IPO and policy marks. On the Fire page, Fire & Forget gains a read-only
group of **feed-side alert templates**: the feed's own alert types and query fields, mirrored nightly, each
mapped to the closest Flows template or saying that Flows has none. Everything is behind `FLOWS_EVENTRISK`
(shipped `owner`); the nightly half is behind `FLOWS_EVENTRISK_NIGHTLY`, the halt channel behind
`FLOWS_EVENTRISK_HALTS`.

Out of scope (named so nobody adds it): earnings-call transcripts (size and sanitiser surface), any POST to
the feed (alert configurations are read, never created or changed), any model call, any change to the
ticker page beyond what section 9.4 states, any change to the FF contract (`shared/ff-contract.js`,
`shared/ff-schema.js`, migration 0026) or the FF evaluator, the Market Floor (WP1), any new D1 table.

## 1. Rules this package is held to

1. AGENTS.md in full. No comments in any source file. Generated files are regenerated, never edited
   (`docs/index.md`, the `gen:` blocks of AGENTS.md, the bundles, the asset version through
   `node scripts/bump-assets.mjs`).
2. No call to the live feed from any session, script or test; `UW_API_KEY` is never read by a test or a
   script of this package; the MCP tools of `.mcp.json` are never called. Fixtures come from a generator
   that reads `docs/uw-openapi.yaml` and `scripts/flows-probe-shapes.json` only (section 12).
3. Served copy (HTML, page-script strings, payload strings a page prints, `title`, `aria-label`, CSV
   headers) never names the data provider and never uses the word "vendor": it says "the feed". The word
   "tape" appears in no new file and no new line of an existing file: not in copy, identifiers, CSS classes,
   ids, keys, test names or fixture fields. The feed's `tape_time` field of `/api/alerts` is never read
   (the reducer reads `created_at`), and the `reads` list of that operation does not name it.
4. Every printed time is TRT through `FlowsUI.F.time`, `F.stamp` or `F.when` (pages) or
   `shared/flows-time.js` (`clock`, `stamp`, `boundaries`) on the server. Report, IPO, listing and
   schedule dates are dates, printed with `F.day`; the info dialog says once that they are US dates. A
   schedule entry whose `time` is null prints `Time not stated`, never midnight.
5. A figure the feed did not send, could not be read, was refused by the plan, or has no stated unit is an
   em dash with its reason. A zero the feed sent is printed as zero. Every aggregate carries the count of
   parts it used and the count it could not. A missing surprise, a missing move or a missing implied move
   removes that event from the statistic that needs it and is counted, never treated as zero.
6. Third-party text (IPO company names, listing names, schedule details and locations, posts, the feed's
   alert-type and filter descriptions, the owner's alert names) passes `sanitizeText` or `cleanLabel` of
   `shared/flows-dossier.js` at the nightly boundary, is capped, is stored with `u: 1` (untrusted) and is
   written by the page with `textContent` only. No URL from the feed is stored (the schedule's `url` and
   `video_url` are not read).
7. Pages are one screen with no page scroll and no inner scroll at 1920x1080, 1440x820, 1024x768 and
   390x844, in every view, dialog and state.
8. Every change is behind a switch. With `FLOWS_EVENTRISK=off`, `FLOWS_EVENTRISK_NIGHTLY=off` and
   `FLOWS_EVENTRISK_HALTS=off`, every existing page, route, payload, card-x and rail frame is byte for byte
   what it was (section 13.7 holds it).
9. Every new pure function has an independent oracle; every new suite plants wrong builds that must fail.
10. Before the push: the suites of section 13 green and `node scripts/prepush.mjs` green. Commit and push
    the branch; do not merge.

## 2. Switches

| Name | Where | Values | Shipped | Meaning |
|---|---|---|---|---|
| `FLOWS_EVENTRISK` | `wrangler.toml` [vars] | `on`, `owner`, `off`; anything else is `owner` | `owner` | `on`: every member; `owner`: owners (`isOwner`, `FLOWS_RT_USERS`) only; `off`: nobody. Closed for a caller: the Events page is served exactly as today (five tabs, no new script), `GET /api/flows/eventrisk` is `404 eventrisk_off` (after the method gate and the session, before any store read), the Fire page has no "From the feed" switch, and the rail refuses the `ht` topic for that caller (section 8.3). |
| `FLOWS_EVENTRISK_NIGHTLY` | nightly env and `.github/workflows/flows-pipeline.yml` | `off`, anything else on (the workflow passes `off` while the repository variable is unset) | off in the workflow | `off`: the `eventrisk` stage is `skipped`, the extras planner plans no `er` part, nothing new is read or published, card-x has no `er` key. |
| `FLOWS_EVENTRISK_CAP` | nightly env | integer 0 to 1,000 | unset (400) | Per-night call cap of the `er` card-x parts (section 4.2), separate from `FLOWS_EXTRAS_CAP`. Not an integer or negative: the default; above 1,000: 1,000; 0 plans none. |
| `FLOWS_EVENTRISK_HALTS` | `wrangler.toml` [vars] | `on`, anything else off | `off` until the rail carries the `ht` topic | Whether the hub may join the feed's halt channel. Off: the `ht` topic is refused for everyone and the hub never joins the channel; the Halts view prints its `off` state. |

`shared/flows-er-switch.js` is a leaf that imports nothing and is the only reader of the four names:

- `eventRiskMode(env)` returns `"on"`, `"off"` or `"owner"` (trimmed, lowercased; anything else and unset
  are `"owner"`); `eventRiskOpen(env, owner)` is `mode === "on" || (mode === "owner" && owner === true)`.
- `eventRiskNightly(env)` is `false` only for the trimmed lowercased `off`.
- `eventRiskCap(env)` is the rule of the table (`/^\d+$/` after trim, else 400).
- `eventRiskHalts(env)` is `true` only for the trimmed lowercased `on`.

Add the four names to `OPS_SWITCHES` in `server/ops.js` (raw values; none is secret-shaped). Add
`FLOWS_EVENTRISK = "owner"` and `FLOWS_EVENTRISK_HALTS = "off"` to `wrangler.toml` [vars] after
`FLOWS_EXPORTS`; `wrangler.staging.toml` gets `FLOWS_EVENTRISK = "on"` and `FLOWS_EVENTRISK_HALTS = "off"`
(staging has no socket). `tests/contracts.mjs` and `tests/staging-contract.mjs` read the files through
wrangler's reader and must stay green.

## 3. The seventeen endpoints and where each is read

Every operation goes into `RAW` of `shared/flows-vendor-ops.js` with `id`, `path` (and `op` where the call
template differs from the spec's operation), `licence`, `klass`, `plan` (`advanced` unless stated),
`maxBytes`, `limiter` and `reads`. No path is spelled anywhere outside the registry; every call is
`pathFor(id, params)`. `method` stays the default `GET` for every entry, including `alerts-config`: the
feed's `POST /api/alerts/configuration` is never registered and never called (section 13.2 plants a build
that registers it).

| # | Spec path | Registry id | klass | limiter | maxBytes | Read by | When | Calls a night |
|---|---|---|---|---|---|---|---|---|
| 1 | `/api/calendar/ipo` | `calendar-ipo` | `nightly` | null | 131072 | `eventrisk` stage | every night | 1 |
| 2 | `/api/stock/{ticker}/earnings` | `stock-earnings` | `slow` | null | 65536 | `er.eps` part | planner (4.2) | within the cap |
| 3 | `/api/stock/{ticker}/income-statements` | `income-statements` | `slow` | null | 262144 | `er.fin` part | only when `dx.financials` is unusable (4.2) | within the cap |
| 4 | `/api/stock/{ticker}/balance-sheets` | `balance-sheets` | `slow` | null | 262144 | `er.fin` part | as row 3 | within the cap |
| 5 | `/api/stock/{ticker}/cash-flows` | `cash-flows` | `slow` | null | 262144 | `er.fin` part | as row 3 | within the cap |
| 6 | `/api/companies/listings` | `listings-active` (`status=active`) and `listings-delisted` (`status=delisted&date=`) | `nightly` | null | 8388608 and 1048576 | `eventrisk` stage | active: when the stored copy is 7 or more days old; delisted: each session since the last read, at most 5 | 1 weekly + up to 5 |
| 7 | `/api/potus/schedule` | `potus-schedule` | `nightly` | null | 131072 | `eventrisk` stage | `date` = the session date and the next 3 calendar days | 4 |
| 8 | `/api/potus/posts` | `potus-posts` | `text` licence, `nightly` | null | 524288 | `eventrisk` stage | `limit=200&page=0` | 1 |
| 9 | `/api/stock/{ticker}/technical-indicator/{function}` | `tech-natr` (`path` `/api/stock/{ticker}/technical-indicator/NATR`, `op` the template) | `nightly` | null | 65536 | `eventrisk` stage | names of the earnings window (at most 60), `interval=daily&time_period=14` | up to 60 |
| 10 | `/api/stock/{ticker}/options-pulse` | `stock-options-pulse` | `nightly` | null | 131072 | `eventrisk` stage | names reporting within the next 2 sessions, `date` = session date | up to 40 |
| 11 | `/api/stock/{ticker}/quote` | `stock-quote` | `quote` | `ondemand` | 16384 | the Halts and New issues drill (7.3) | on a member's request, gated | 0 nightly |
| 12 | `/api/stock/{ticker}/tickers` | does not exist in `docs/uw-openapi.yaml`; the nearest operation, `/api/stock/{sector}/tickers`, is registered as `sector-tickers` | `slow` | null | 262144 | `eventrisk` stage, the `er-sectors` key | when the stored map is 7 or more days old, one call per sector of the spec's 11-value `Sector` enum | 11 weekly |
| 13 | `/api/socket/trading_halts` | `socket-halts` (`liveOnly: true`, `envelope: null`, `klass: "news"`) | `news` | null | null | the rail's socket upstream, topic `ht` (8.3) | while demanded | 0 REST |
| 14 | `/api/alerts` | `alerts-fired` | `nightly` | null | 1048576 | `eventrisk` stage | `limit=500`, `noti_types[]` = `trading_state`, `earnings`, `economic_release`, `fda`; `newer_than` = 14 days before the run | 1 |
| 15 | `/api/alerts/configuration` | `alerts-config` | `nightly` | null | 262144 | `eventrisk` stage | every night | 1 |
| 16 | `/api/alerts/filters` | `alerts-filters` | `nightly` | null | 262144 | `eventrisk` stage | when the stored copy is 7 or more days old | 1 weekly |
| 17 | `/api/alerts/query/grammar` | `alerts-grammar` | `nightly` | null | 262144 | `eventrisk` stage | as row 16: no `target`, then each of the 7 targets of the spec's enum | 8 weekly |

Row 12 is recorded in `docs/vendor-coverage.md` (its table gains a line: "`/api/stock/{ticker}/tickers`:
not in the committed spec; `/api/stock/{sector}/tickers` read instead") and in the commit message. If the
weekly spec refresh (`scripts/uw-spec-diff.mjs`) ever adds the per-ticker path, it is a new row, not a
rename.

`reads` (held strict by the weekly probe once observed; until then the probe contract's `unseen` rule
applies):

- `calendar-ipo`: `ipos`, `ticker`, `name`, `exchange`, `ipo_date`, `price_range_low`, `price_range_high`, `currency`.
- `stock-earnings`: `ticker`, `report_type`, `fiscal_date_ending`, `report_date`, `report_time`, `reported_eps`, `estimated_eps`, `surprise`, `surprise_percentage`.
- `income-statements`: `report_type`, `fiscal_date_ending`, `reported_currency`, `total_revenue`, `gross_profit`, `operating_income`, `net_income`.
- `balance-sheets`: `report_type`, `fiscal_date_ending`, `cash_and_short_term_investments`, `short_long_term_debt_total`, `total_shareholder_equity`.
- `cash-flows`: `report_type`, `fiscal_date_ending`, `operating_cashflow`, `capital_expenditures`.
- `listings-active`, `listings-delisted`: `listings`, `ticker`, `name`, `exchange`, `asset_type`, `ipo_date`, `delisting_date`, `status`.
- `potus-schedule`: `date`, `time`, `type`, `details`, `location`, `coverage`.
- `potus-posts`: `timestamp`, `post`.
- `tech-natr`: `date`, `values`, `indicator`, `interval`, `time_period`.
- `stock-options-pulse`: `latest`, `intraday`, `hr_min`, `trd_dt`, `call_txn`, `put_txn` (`sntm_score`, `intvl_sntm_score` and `mkt_sntm` are deliberately not read: the spec states no scale; section 6.4).
- `stock-quote`: `last_trade`, `quote`, `bid`, `ask`, `price`, `size`, `time`, `vol`, `market_time`.
- `sector-tickers`: `data` (a list of ticker strings; the reducer accepts an array of strings or of objects carrying `ticker` and names `unshaped` otherwise).
- `alerts-fired`: `id`, `created_at`, `noti_type`, `symbol`, `user_noti_config_id`, `meta` (only `meta.state`, `meta.reason`, `meta.time` are read, each by a pattern, section 6.6).
- `alerts-config`: `id`, `noti_type`, `status`, `name`, `created_at`, `config` (keys only, section 6.6).
- `alerts-filters`: `data`, `access`, `noti_type_descriptions`, `filter_descriptions`, `rate_limits`.
- `alerts-grammar`: `targets`, `fields`, `name`, `type` (the reducer walks `additionalProperties` objects for field names and types only, section 6.6).

`CALL_COST` in `scripts/flows-nightly/vendor-params.mjs` gains `eventrisk` (the fixed reads of a night:
1 + 1 + 4 + 1 + 1 + 1 + up to 5 delisted + the weekly 21) and `eventriskNames` (natr + pulse); the
call meter files them under their ids through `opIdOf`, and `tests/flows-probe-contract.mjs` holds every
new id to the spec or `liveOnly`.

## 4. Nightly plan

### 4.1 Stage and files

`STAGES` in `scripts/flows-nightly/stages.mjs` gains
`stage("eventrisk", ISOLATION.isolated, ["card-x"], ["eventrisk", "er-sectors"])`, inserted right after
`card-x` (and after WP4's `positioning` if that branch has merged first; the two are independent). It reads
the night's merged card-x store, the `events` payload the run just built (from `ctx`), the prior
`eventrisk` and `er-sectors` payloads, and publishes `eventrisk` every night and `er-sectors` only on the
nights it re-read the sectors. Its `detail` carries at most six fields: `erCalls`, `erRefused`,
`erFailed`, `erNames` (window names with a verdict), `erPosts`, `erHalts14` (alerts-fired trading-state
rows kept).

New files:

- `scripts/flows-legs/eventrisk.mjs`: the I/O of section 3 rows 1, 6 to 10, 12, 14 to 17, through the run's
  pool and deadline, failures filed by status exactly as `scripts/flows-legs/extras.mjs` files them (429
  `limited`; 401, 402, 403, 404, 422 `plan`, kept with `since` so a refused route is asked again only after
  7 days; anything else `failed`).
- `scripts/flows-nightly/sections/eventrisk.mjs`: `runEventRisk(ctx)`; imports no other section; added to
  `nightlyExecution()` of `tests/lib/source-scan.mjs` the way the other sections are.
- `scripts/flows-legs/eventrisk-fake.mjs`: the dry run's fake, which touches the taint
  (`scripts/flows-legs/taint.mjs`) on entry and serves the generated fixture bodies of section 12, keyed
  by registry id. `scripts/flows-legs/fake-vendor.mjs` routes the new paths to it.

### 4.2 The `er` parts (per name, in card-x)

Add to `PARTS` of `shared/flows-vendor-extras.js` a group `er` with two parts:

| id | ops | rv | refreshS | maxS | scope |
|---|---|---|---|---|---|
| `eps` | `stock-earnings` | 1 | 5 days; 20 hours when the name's `rd` (sessions since its last report, from the universe) is 0 to 2 or its `ed` is 0 to 1 | 30 days | every carded name |
| `fin` | `income-statements`, `balance-sheets`, `cash-flows` (three calls, one part) | 1 | 7 days | 45 days | only names whose `dx.financials` part is absent, `shed`, failed or outdated |

`planSlow` is called a third time with `ids = ["eps", "fin"]`, `cap = eventRiskCap(env)` and a new optional
`scopeOf(id, ticker)` (the default answers every name, so the existing calls are unchanged; WP4 adds the
same argument, and if both land the first merged definition is kept). `fin` costs three calls in the cap.
`GROUPS` gains `er`. `SHED_ORDER` gets `["fin", "eps"]` prepended: the `er` parts shed before every
existing part. With the nightly switch off the third call is not made and no `er` key is written.

Extracts (each part `{ at, rv, x }` or the stub `{ at, rv, shed: 1 }`):

```text
eps: { rows: [[fiscalEnd, reportDate, when, repC, estC, sx, unit]] }      // 12 newest quarterly rows
     // repC, estC: EPS in integer hundredths of a cent (centsOf x 100 of the numeric strings), null when null
     // sx: our surprise (rep - est) / |est| as a fraction to 6 dp, null when est is 0 or either is null
     // unit: 1 when the feed's surprise_percentage / 100 agrees with sx within 0.0005, 0 when it disagrees,
     //       null when the feed sent none; the feed's own figure is never stored
     // when: "pre" | "post" | null  (premarket/bmo -> pre, postmarket/amc -> post, case-insensitive)
fin: { cur, q: [[fiscalEnd, rev, gp, oi, ni, ocf, capex, cash, debt, eq]] }  // 8 newest quarterly rows, whole units of `cur`
```

Reducers return `{ fail: "unshaped" | "type:<field>" | "empty" }` exactly as the `dx` reducers do, so
`shapeHealth` reports them and the nightly gate warns under `extras-shape`. A row whose three statements
do not share a `fiscal_date_ending` keeps the fields it has and nulls the rest; none is filled from another
quarter.

Expected night after the cold start: about 600 carded names / 5 days = 120 `eps` calls, plus about 60
reporting names refreshed at 20 hours, plus `fin` for the few names whose bundled read fails (3 each):
about 200, half the cap. The 40-night simulation of 13.3 holds that no part outlives its `maxS` and that
the cold start reaches every carded name inside 6 nights.

## 5. Payloads

### 5.1 The new global key `eventrisk`

Register `global("eventrisk", { capBytes: 96 * 1024, required: ["v", "sessionDate", "generatedAt"] })` in
`shared/flows-products.js`, add it to the door's exact-key grammar in `server/store.js`, to
`tests/lib/emit-keys.mjs` and to `COVERAGE_KEYS` of `server/ops.js`. `null` always means "not known",
never zero.

```text
{
  v: 1, sessionDate, generatedAt, fixture?,
  basis: { calls, refused: { [opId]: { status, since } }, failed: { [opId]: n }, shed: [string] },
  risk: {
    status: ok|quiet|pending|unavailable, why?,
    window: { sessions, through, names },                  // the events payload's window; names = rows considered
    pooled: { n, rich, cheap, inline, few, meanLog, lo, hi },  // 6.2
    rows: [ {
      t, sec, d, when, ed,                                 // report date, "pre"|"post"|null, sessions to its impact session
      at,                                                  // ISO instant of the impact (the open for pre, the close for post), null when when is null
      emNow,                                               // today's implied move, fraction, from the events calendar, null when none
      hist: { n, used, zeros, missing, medR, beat, beatLo, beatHi, meanLog, lo, hi, verdict, mv, hit, hitN },
      todayR, todayZ,                                      // emNow / mv; (ln emNow - mean ln|m1d|) / sd ln|m1d|
      sur: { n, with, against, flat, lo, hi, last: [sx] },  // concordance, Wilson bounds, 4 newest surprises
      natr, natrAt, ratioNatr,                             // percent, its date, emNow / (natr / 100)
      pulse: { at, calls, puts, ratio } | null,            // opening-buy transaction counts, puts per call
      ev: [[d, em, m1d, sx]]                               // up to 12 events, newest first, for the drill sparkline
    } ]                                                    // at most 60, ordered by d then t
  },
  issues: {
    status, why?,
    ipos: { asOf, rows: [ { t, name, ex, d, lo, hi, cur, s } ] },        // s = sessions to d; at most 60
    listed: { asOf, rows: [ { t, name, ex, kind, d } ] },                 // ipo_date within 30 calendar days; at most 60
    delisted: { asOf, days: [date], rows: [ { t, name, ex, kind, d, u } ] }, // u = 1 when the name is in the universe; at most 60
    activeReadAt                                                          // ISO, the weekly read's time
  },
  policy: {
    status, why?,
    schedule: { dates: [date], rows: [ { d, at, type, text, where, cov, phase } ] },  // phase: pre|rth|post|closed|null
    posts: { from, rows: [ { at, phase, text, tags: [code], tickers: [t], cut } ] }   // at most 60, newest first
  },
  halts14: { status, why?, configured, rows: [ { t, at, state, reason } ] },          // trading_state alerts, 14 days, at most 120
  feed: {
    status, why?, readAt,
    types: [ { id, label, can, perDay, fields: [string], target } ],   // from filters and grammar
    grammar: { targets: [ { id, fields: [[name, type]] } ] },           // field names and types only
    owner: { configs: [ { k, type, status, label, keys: [string] } ], fired: { [type]: n } } | null
  }
}
```

Units and rules: `emNow`, `em`, `m1d`, `mv`, `sx`, `beat`, `hit` fractions to 6 dp; `natr` the feed's
NATR in percent (its unit is stated by the indicator's definition, average true range over close times
100; held by the fixture check of section 12); `lo`, `hi` on the log scale to 4 dp; IPO `lo`, `hi` in
integer cents of `cur` (null when the feed sent null, never 0); `pulse.calls`, `pulse.puts` integer counts;
`at` ISO instants; `d` US dates. `feed.owner` is written into the payload but stripped by the route for a
non-owner (7.4). `owner.configs[].k` is the first 12 hex of SHA-256 of the feed's config `id` (the raw id
is not stored); `label` is the config name through `cleanLabel` at 40 characters; `keys` are the config's
top-level keys only, sorted, at most 12, never values.

Budget: about 48 KB on the dry-run emit. `fitEventRisk(payload, max = 96 * 1024)` sheds in this order and
records each step in `basis.shed`: `risk.rows[].ev` to 8, then 6; `policy.posts.rows[].text` cut to 140
characters (`cut: 1`); `policy.posts.rows` to 30; `issues.listed.rows` and `issues.delisted.rows` to 30;
`halts14.rows` to 60; `feed.grammar` dropped (status `shed`); `risk.rows[].ev` dropped. A payload still over
after the last step is published with `risk.rows` cut to whole report dates (the `wholeDays` rule of
`shared/flows-events.js`) and `risk.status` `ok` with `basis.shed` naming it.

### 5.2 The global key `er-sectors`

`global("er-sectors", { capBytes: 96 * 1024, required: ["v", "readAt"] })`, written only when re-read:

```text
{ v: 1, readAt, fixture?, sectors: { [sectorName]: "AAA,BBB,..." }, n, refused: [sectorName] }
```

Each value is the sector's tickers sorted and joined by commas, de-duplicated across sectors (a ticker in
two lists keeps the first in enum order and is counted in `dup`). Over budget, a sector's list keeps its
names that are in the universe or in `eventrisk.issues` and drops the rest, counted in `dropped[sector]`.

### 5.3 What does not change

The `events` payload, its 120 KiB budget, `EVENTS_NOTES`, `buildEvents`, `assembleCatalysts` and the
existing card-x `earnings` and `dx` sections are untouched. The Risk view reads card-x `earnings.events`
through the nightly (the leaf joins it inside the `eventrisk` stage); the page never re-derives it.

## 6. Pure leaves and their mathematics

All leaves import only `shared/flows-stats.js`, `shared/flows-calendar.js`, `shared/flows-time.js`,
`shared/flows-cross.js`, `shared/flows-horizon.js`, `shared/flows-sides.js` (for `centsOf`) and
`shared/flows-dossier.js` (for `sanitizeText`, `cleanLabel`), as each needs. `tests/architecture.mjs`
declares them leaves of the `shared/` layer.

### 6.1 `shared/flows-er-eps.js`

- `reduceStockEarnings(raw)` to the `eps` extract of 4.2. `centsOf` reads the numeric strings exactly;
  `repC = centsOf(rep) * 100` would lose the sub-cent digits, so the reducer reads the string to integer
  hundredths of a cent with its own exact decimal parse (`hundredthsOf(str)`: optional sign, digits,
  optional point and up to 4 decimals, half away from zero beyond; anything else null).
- `surpriseOf(repC, estC)`: `(repC - estC) / |estC|`, null when `estC` is 0 or null. The fraction is
  rounded half away from zero to 6 dp through `fixedHalfUp` of `shared/flows-display-round.js`.
- `joinSurprise(events, epsRows, finEps)`: for each card-x earnings event `[d, when, em, m1d, ...]`, the
  `eps` row whose `reportDate` is within 3 calendar days of `d` (nearest; ties to the earlier), else the
  `dx.financials.eps` row (`rd` within 3 days) with `sx` computed the same way, else null. Returns
  `[d, em, m1d, sx]`.

### 6.2 `shared/flows-er-score.js` (how the options market has priced this name's reports)

For one name, events `e_j = (em_j, m1d_j)` from card-x `earnings.events` (fractions; at most 12, newest
first), skipping events whose `em` or `m1d` is null (counted in `missing`) and events with `m1d === 0`
(counted in `zeros`, since the log of zero is not defined; they are still counted in `beat` as not beating):

- `x_j = ln(|m1d_j| / em_j)`; `used` = the count of `x_j`; `n` = events with both figures (`used + zeros`).
- `meanLog` = mean of `x_j`; `lo`, `hi` = `meanLog -/+ tCritical975(used - 1) * sampleSd / sqrt(used)`
  (the 95% t interval of `shared/flows-stats.js`).
- `verdict`: `few` when `used < EARNINGS_MIN_EVENTS` (6, imported from `shared/flows-catalysts.js`);
  `rich` when `hi < 0` (the past realised move sat below the implied move, by an interval that excludes
  equality); `cheap` when `lo > 0`; `inline` otherwise. These are codes; the words are in section 10.
- `medR` = median of `|m1d| / em` over the `n` events; `beat` = share with `|m1d| > em`; `beatLo`, `beatHi`
  = `wilson(beat, n)` at z 1.96.
- `mv` = median `|m1d|`; `hit` = share of events with `ls1d > 0` among `hitN` events that carry `ls1d`
  (the long straddle figure the card-x row already holds); null when `hitN` is 0.
- `todayR = emNow / mv` (null when either is null or `mv` is 0); `todayZ = (ln emNow - mean ln|m1d|) /
  sampleSd(ln|m1d|)` over the `used` events, null under 6 or with `sd` 0.
- `concordance(evs)`: over events with both `m1d` and `sx`, `with` = sign agreement with neither zero,
  `against` = opposite signs, `flat` = either zero; `lo`, `hi` = `wilson(with / (with + against), with +
  against)`; null bounds under 4.
- `pooledVerdict(rows)`: counts of the four verdicts, and over names with `used >= 6` the mean of their
  `meanLog` with a 95% t interval across names (`n` names). The info copy says it is a description of this
  window's names, not a test of skill and not a forecast.

### 6.3 `shared/flows-er-calendar.js`

- `impactInstant(d, when)`: through `impactSession` and `boundaries` of the calendar and time leaves, the
  ISO instant of the regular open of the impact session for `pre`, the regular close of the report date's
  session for `post` (early closes included), null for `when === null` or a date outside the calendar.
- `ipoRows(raw, sessionDate, universe)`: rows with a valid `ipo_date` on or after `sessionDate`, `s` =
  `sessionsBetween(sessionDate, d)`, `lo`/`hi` integer cents (null stays null; `lo > hi` swaps nothing
  and marks the row `badRange: 1`, printed as a dash with "range not readable"), `name` through
  `cleanLabel` at 60, at most 60 ordered by `d` then `t`.
- `listedRows(active, sessionDate)`: `ipo_date` within the 30 calendar days up to `sessionDate`.
- `delistedRows(reads, universe)`: the union of the per-date delisted reads, de-duplicated by ticker and
  date, `u` from the universe.
- `phaseOf(instant)`: `pre`, `rth`, `post` or `closed` by the TRT boundaries of its New York session
  (`boundaries` of `shared/flows-time.js`), null for a null instant.

### 6.4 `shared/flows-er-pulse.js` and NATR

- `pulseRead(raw)`: the newest bucket of `data.intraday` (or `data.latest` when the series is empty) with
  integer `call_txn` and `put_txn`; `ratio = put_txn / call_txn` to 4 dp, null when `call_txn` is 0. The
  sentiment scores are never stored: the spec states no scale for them, so printing one would claim a
  meaning the page cannot back. `at` is the bucket's `trd_dt` plus `hr_min` read as Eastern wall time
  through the calendar leaf's Eastern arithmetic, ISO; a bucket whose time does not parse keeps the counts
  and `at: null`.
- `natrRead(raw)`: the newest point's `values` entry whose key matches `/^NATR$/i`, parsed as a number;
  null and `fail: "unshaped"` otherwise. A value outside 0 to 100 is refused as a unit slip
  (`fail: "unit"`), never clamped.

### 6.5 `shared/flows-er-policy.js`

- `scheduleRows(reads, sessionDate)`: entries of the four reads, de-duplicated on `date|time|details`;
  `at` = `time` when it parses as an ISO instant with a zone, else null (and `Time not stated`); `text`
  from `details` through `sanitizeText` at 160; `where` from `location` through `cleanLabel` at 60; `cov`
  through `cleanLabel` at 40; `type` lowercased and kept only when it matches `/^[a-z][a-z _-]{0,30}$/`;
  `phase` from 6.3. At most 40 rows ordered by `at` (null last within its date).
- `postRows(raw, sessionDate)`: posts whose `timestamp` falls on or after the regular open of the session
  four sessions before `sessionDate` (five sessions in all); `at` from the epoch milliseconds; `text`
  through `sanitizeText` at 280 (`cut: 1` when shortened); a post that the sanitiser drops whole is
  counted in `dropped` and not listed. `tags` from the fixed lexicon `POLICY_TAGS` (whole-word,
  case-insensitive): `trade` (tariff, tariffs, trade deal, import, export), `rates` (Fed, interest rate,
  rates, Powell, inflation), `energy` (oil, gas, energy, OPEC, drilling), `defense` (military, defense,
  Pentagon, missile), `crypto` (bitcoin, crypto), `china` (China, Chinese, Beijing), `tax` (tax, taxes);
  `tickers` are `$` cashtags (`/\$([A-Z]{1,5})\b/`) that name a universe ticker, at most 5. The tags are
  labels of words in the text and the info copy says so; they are not a reading of meaning.

### 6.6 `shared/flows-er-feed.js` (the feed's alert definitions)

- `reduceFilters(raw)`: `types` from the keys of `noti_type_descriptions` and `data` that match the spec's
  `Noti Types` enum (an unknown key is counted in `unknownTypes`, not kept); `label` through `cleanLabel`
  at 60; `can` = `access[type] === true` (a missing entry is null, printed "Not stated"); `perDay` an
  integer from `rate_limits[type]` or null; `fields` the filter field names (strings matching
  `/^[a-z][a-z0-9_]{0,40}$/`), at most 24.
- `reduceGrammar(overview, perTarget)`: for each of the 7 targets of the enum, `fields` as
  `[name, type]` pairs found by walking the object (any object whose `name` and `type` are strings of the
  pattern above), at most 80 a target; a target whose read failed has `fields: null` and its reason.
- `reduceConfigs(raw)`: section 5.1's `owner.configs`.
- `reduceFired(raw, from)`: rows with `created_at` an instant on or after `from`; `type` from the enum; for
  `trading_state` only, `state` from `meta.state` when it matches `/^[a-z_]{1,20}$/`, `reason` from
  `meta.reason` when it matches `/^[A-Z0-9]{0,6}$/` (the empty string kept as `""`, meaning none given),
  `at` from `meta.time` when it is an instant, else `created_at`; `t` from `symbol` when it matches
  `SYMBOL_RE` of `shared/ff-contract.js` (an option symbol is not a halt and is dropped). `fired` counts per
  type for the owner block. No `name`, no other `meta` key, no `tape_time`.
- `halts14(fired, filters)`: the trading-state rows; `configured` = true when at least one config of type
  `trading_state` exists, false when the configs were read and none is, null when the configs were not
  read. With `configured: false` the view says so (section 11) rather than showing an empty list as "no
  halts".

### 6.7 `shared/ff-feed-templates.js` (read-only feed templates)

A leaf that imports `shared/ff-contract.js` (for `templateById`) and nothing else. `FEED_TEMPLATES` is a
frozen table, each entry `{ id, title, type, target, fields, closest, differs }`:

| id | title | feed type | target | fields named in the feed's grammar | closest Flows template | what differs (copy, section 10) |
|---|---|---|---|---|---|---|
| `F01` | Trading halt on a name | `trading_state` | `trading_state` | `state`, `reason` | none | Flows has no halt quantity a wire can test; the Halts view shows them. |
| `F02` | Earnings report | `earnings` | none | none | `T07` | The feed alerts on the report itself; T07 tests the implied move against past report moves. |
| `F03` | Economic release | `economic_release` | none | none | none | Flows lists releases on the Macro view; no wire tests them. |
| `F04` | FDA date | `fda` | none | none | none | Flows lists dates on the FDA view; no wire tests them. |
| `F05` | Large flagged window | `flow_alerts` | `flow_alert` | `total_premium`, `volume_oi_ratio`, `dte` | `T03` | T03 also asks for out of the money by 10 per cent and 21 days or less. |
| `F06` | Open-interest change before the open | `chain_oi_change` | `option_contract` | `oi_change` | `T02` | T02 confirms the opening on the next night's open interest. |

`feedTemplateRows(feed)` joins the table with `eventrisk.feed`: `can` from `types[type].can`; `fields`
present only where the stored grammar lists every field named (a field the grammar does not list makes the
row `fields: null` with reason "not in the feed's grammar"); `closest` resolved through `templateById` and
kept only when the template's `ast` is not null; `state` `ready` (the feed lists the type and the account
can create it), `plan` (the account cannot), `unlisted` (the type is not in the stored filters), `unread`
(no `feed` block). Nothing in the leaf builds a query string, a request body or a URL.

## 7. Worker

### 7.1 Route family `server/routes/flows-eventrisk.js`

`flowsEventRiskRows(deps)` is one row, `GET /api/flows/eventrisk`, `auth: "flows"`. Order: method (405
before 401), session, `eventRiskOpen(env, isOwner(env, username))` (closed: `404 eventrisk_off`, a new
code in `server/errors.js` with message "The event-risk console is off"), then by query:

- no `part`, no `t`: `readFlowsPayload(env, "eventrisk")`, JSON with the nightly `X-Fresh-*` headers,
  `{ status: "pending" }` when never written, the last good copy on a store quota day as the nightly reads
  do; `feed.owner` removed unless the caller is an owner (7.4). One row read.
- `?t=<ticker>` (`requireTicker`; a fixture name off a test host is `400 invalid_ticker`): one read of
  `card-x:<T>`, answering `{ t, sessionDate, earnings, er, fin }` where `earnings` is the card-x
  `earnings` section (events, next, medianRatio), `er` the `er` section, `fin` the `dx.financials` part or
  null; nothing else of the card-x is sent. One row read.
- `?part=sectors`: one read of `er-sectors`. One row read.
- `?part=quote&t=<ticker>`: the member-gated on-demand quote (7.3). Zero rows read.
- any other `part`: `400 invalid_part`.

Register the family in `worker.js`'s router after `flowsReadyRows`. Add the four forms to the ceilings of
`tests/flows-reads-contract.mjs` (ceiling 1, quote 0) and the route to `tests/fixtures-route-matrix.json`
(regenerate with `node route-matrix.mjs --write` in a commit that moves no other code).

### 7.2 Page rows

`server/routes/flows-pages.js`: the `events` row becomes
`{ slug: "events", render: (username, summary, owner, scenes, env) => FLOWS_PAGES.eventsPage({ username, eventrisk: eventRiskOpen(env, owner), halts: eventRiskHalts(env) }) }`
and the Fire row passes `feed: eventRiskOpen(env, owner)` to the Fire page function. With `eventrisk`
false, `eventsPage` returns exactly today's string (13.7). No `FLOWS_NAV` change: Events is already linked.

### 7.3 The on-demand quote

`?part=quote&t=` is the only member-facing feed read of this package, and it follows AGENTS.md's vendor
gate: `vendorGate(env, session)` once per request (the `MEMBER_VENDOR` binding, then one `UW_ONDEMAND`
token through `chargedFetch`), single flight per ticker, the copy kept 15 s in the Cache API
(`internalKey("eventrisk", "quote/" + T)`) and served as a hit inside that TTL with no token. A refused
member with a kept copy gets it stamped `X-Fresh-State: stale`, `X-Fresh-Reason: throttled`; with none,
JSON `429 rate_limited` with `Retry-After: 60`. The `uwFetch` deadline is the 4 s default. The body:

```text
{ t, status: ok|quiet|unavailable, why?, readAt,
  last: { pxC, at, vol } | null, bid: { pxC, size } | null, ask: { pxC, size } | null, quoteAt, session }
```

Prices in integer cents read exactly from the strings with `centsOf`; `at`, `quoteAt` ISO from the
milliseconds; `session` the feed's `market_time` when it is one of the three enum values, else null. A
locked or crossed quote (`ask <= bid`) is kept and flagged `crossed: 1`, never repaired. The quote-change
counters are not read. `tests/flows-reads-contract.mjs` and `tests/flows-vendor-budget.mjs` hold that the
route consults the member gate at most once and spends at most one `UW_ONDEMAND` token per miss.

### 7.4 Stripping

- `feed.owner` is deleted from the `eventrisk` body for a non-owner (parse only when the stored text
  contains `"owner":{`; otherwise the bytes pass untouched).
- `/api/flows/card-x` (the existing row): when `eventRiskOpen` is false for the caller, the `er` section is
  removed (parse only when the stored text contains `"er":{`). The ticker page does not read `er` in this
  package.

### 7.5 D1 budget

`tests/lib/d1-budget.mjs`: the nightly writes `eventrisk` every night and `er-sectors` weekly; card-x write
counts are unchanged. Readers: `eventrisk-page` (the Events page: 1 row per open of a new view, 400 reads a
day), `eventrisk-drill` (1 row, 200 a day), `fire-feed` (1 row, 100 a day). `flows-d1-budget` stays green.

## 8. Rail: the halt channel

### 8.1 Topic table

`shared/flows-rt.js`: `RT_TOPIC_KEYS` gains `"ht"` (and so `RT_KINDS`). `RT_TOPICS.ht = { k: "ht", klass:
"rtNews", cadenceMs: null, extendedMs: null, merge: "append", key: null, stamp: "event", barS: 0,
rowMax: 200 }`. `RT_ROW_FIELDS.ht = ["id", "ts", "t", "state", "reason"]`. `RT_UPSTREAM.ht = { rest: () =>
[], socket: ["trading_halts"] }`. `rtCadenceMs("ht")` is null and the table test of `flows-rt-contract`
skips a topic with no REST request (and says so in its message).

### 8.2 Socket half

`shared/flows-rt-socket.js`: `SOCKET_TOPICS` gains `"ht"`; `SOCKET_CHANNELS.ht = { scope: "global",
channel: () => "trading_halts", template: "trading_halts", max: 1 }`; `channelTopic("trading_halts")` is
`{ k: "ht", name: null }`; `shapeSocketFrame("ht", batch, { at })` maps each payload `{ ticker, state,
reason, time }` to the row `[id, ts, t, state, reason]` with `t` matching `SYMBOL_RE` (else dropped and
counted in `meta.dropped`), `state` lowercased and kept when it matches `/^[a-z_]{1,20}$/`, `reason` kept
when it matches `/^[A-Z0-9]{0,6}$/`, `ts` the epoch milliseconds of `time` (a time that does not parse:
dropped), `id` = `t + "|" + ts + "|" + state`. Appended and de-duplicated by `id`, at most 200 held, the
newest last.

### 8.3 Hub and routes

- The hub asks for `ht` only while a socket or snapshot demands it and `eventRiskHalts(env)` is true; the
  composite upstream joins `trading_halts` then. `ht` has no REST fallback: while the channel is not
  acknowledged, refused or silent for 120 s outside a halt, every `ht` frame carries `fresh` with state
  `unavailable` and reason `socket-only` (a new `RT_REASONS` entry), `liveUntil` null, and the rows the hub
  already holds. While acknowledged it is live by the channel's own heartbeat, as `nw` is live by the
  success of its poll. Silence on a live channel is not a failure: halts are rare.
- The hub keeps the rows in memory for its epoch only (it never writes D1); the snapshot carries
  `meta.since` = the epoch's start, which the page prints as "since HH:MM TRT".
- `serveRt` (`shared/flows-rt-routes.js`): when the caller's `k` names `ht` and either
  `eventRiskOpen(env, owner)` or `eventRiskHalts(env)` is false, `ht` is treated exactly as an unknown
  topic (the existing 400 on the topic list when it is the only one; dropped from the list otherwise, with
  `X-RT-Dropped: ht` on the snapshot). Owners are read with the existing `isOwner`.
- `FLOWS_RT_CALLS_PER_MIN` is unchanged: `ht` makes no REST call. `tests/flows-vendor-budget.mjs` holds the
  minute line unchanged.

### 8.4 Client

`assets/js/flows-rt.js` gains the adapter `halts()` (rows as objects `{ id, ts, t, state, reason }`,
newest first) and the `rt:ht` freshness entry like the others. No other change; a page that never names
`ht` is byte for byte unaffected in what it requests.

## 9. The Events page: design

Built on today's feed stage (`feedTabs`, `#fdStage`, `assets/js/flows-feed-os.js` with its fitter and Show
all dialog, `#view=<tab>` in the address). Files: `shared/flows-pages.js` (`eventsPage` gains the two
options), `assets/js/flows-er.js` (the new views, deferred), `assets/css/flows-er.css` (loaded by
`flows-er.js` through `data-css`, like the network sheet, so the eager weight of the page does not move).
No new global: `FlowsUI.er` (frozen: `mount`, `model`, `fmt`) is attached the way `FlowsUI.netMap` is;
`globalThis.__ErTest` only where there is no `document`. Only tokens: no colour literal (13.5 scans it).

### 9.1 Structure (served HTML when `eventrisk` is true)

```text
feedHead("ev", "Events")                         unchanged
p#evStatus, div#evAbout                          unchanged
div.fd-chips#evChips                             unchanged; gains a chip "Event risk" (ui-chip, title "Behind a switch; owners only" while owner)
feedTabs([
  ["week","Week","evWeekCard"], ["earn","Earnings","evEarnCard"], ["risk","Risk","erRiskCard"],
  ["macro","Macro","evMacroCard"], ["fda","FDA","evFdaCard"], ["issues","New issues","erIssuesCard"],
  ["policy","Policy","erPolicyCard"], ["halts","Halts","erHaltsCard"], ["react","Reaction","evReactCard"]])
div#fdStage
  the five existing modules, unchanged
  feedModule("erRiskCard", "Report risk", body 9.3.1, { tab: "risk" })
  feedModule("erIssuesCard", "New issues", body 9.3.2, { tab: "issues" })
  feedModule("erPolicyCard", "Policy calendar", body 9.3.3, { tab: "policy" })
  feedModule("erHaltsCard", "Halts", body 9.3.4, { tab: "halts" })
<i hidden data-defer="er" data-src="${v("/assets/js/flows-er.js")}" data-css="${v("/assets/css/flows-er.css")}" id="erDefer">
dialog.er-sheet#erDrill                          the name drill (9.4)
```

`flows-events.js` asks for the group with `FlowsUI.defer("er", { when: "idle" })` after its own first
paint when `#erDefer` exists, and calls `FlowsUI.er.mount(payloadOfEvents)` when it lands; the Week view's
extra marks are painted by `FlowsUI.er.weekMarks(weekHost, eventrisk)` after both payloads are in. Each new
module is served with its final geometry: a header (`h2`, a one-line `p.er-sub`, the Show all slot the
fitter fills) and a body of em-dash rows with the one reason line `Loading the event-risk read.`, so
nothing moves when the data lands (13.5's first-paint check).

The Events page's `flows-weight` allowance for the eager route is unchanged; `DEFERRED.events` lists
`flows-er.js`.

### 9.2 Layout at the four sizes

The tablist: above 899 px one row (nine tabs fit at 13 px from 1024 px: measured budget 9 x 92 px); from
899 px down a grid of three columns and three rows (`.fd-tabs:has(> :nth-child(9):last-child) {
grid-template-columns: repeat(3, minmax(0, 1fr)) }`), each button 36 px tall (44 px on a coarse pointer).
The stage is the rest of `100dvh` as today.

| Size | Risk | New issues | Policy | Halts |
|---|---|---|---|---|
| 1920x1080 | head strip (pooled verdict counts, 56 px) over a table of up to 20 rows (40 px), 10 columns: Name, Reports, Implied now, Past median move, Today vs past, Verdict, Straddle paid, Moved with surprise, Implied in NATR, Opening puts per call | three panes side by side (IPOs 40%, Listed 30%, Delisted 30%), each a list | two panes: Schedule (55%) as a day-grouped timeline with the US session band, Posts (45%) as a list | two panes: Live (60%, a list with a running-halt counter in its header) and Last 14 days (40%) |
| 1440x820 | head strip, table of 14 rows, 9 columns (Implied in NATR moves into the row's title and the drill) | three panes, lists trimmed by the fitter | two panes, posts 2 lines each | two panes |
| 1024x768 | head strip one line, table of 11 rows, 7 columns (Name, Reports, Implied now, Today vs past, Verdict, Straddle paid, Moved with surprise) | a segmented switch IPOs / Listed / Delisted, one list | a segmented switch Schedule / Posts | a segmented switch Live / 14 days |
| 390x844 | rows as two-line cards (Name and Verdict chip on line 1; Implied now · Today vs past · Reports on line 2), 7 cards | the same switch, 7 rows | the same switch, 6 entries, posts 2 lines | the same switch, 8 rows |

Targets: 44 px on coarse pointers for every control and row, 24 px elsewhere. Text from `--t-caption` and
`--t-footnote`; figures `font-variant-numeric: tabular-nums`; signed figures with U+2212.

### 9.3 Views

#### 9.3.1 Risk

Head strip: four counts as chips with glyph and word (`rich` ▼ "Priced above past moves", `cheap` ▲
"Priced below past moves", `inline` ● "Within past range", `few` ○ "Too few reports"), and the pooled
line "Across 34 names with six or more reports: realised moves averaged 0.82 times the implied move (0.74
to 0.91)", where the figures are `exp(meanLog)`, `exp(lo)`, `exp(hi)` of `risk.pooled` with two decimals.
A pooled `n` under 5 prints the dash with "fewer than five names to pool".

Table columns and cells:

- Name: ticker link to `/flows/ticker/?t=` (a non-universe name is plain text), sector under it at 1440 and
  up.
- Reports: `F.day(d)` and the impact in TRT (`Before the open · 16:30 TRT`, `After the close · 23:00 TRT`,
  `Time not stated`), then `in 3 sessions` (`ed`).
- Implied now: `emNow` as a percent with one decimal (`±6.4%`), or the dash with "no calendar move".
- Past median move: `mv` as a percent with one decimal and `(n of 12)` muted.
- Today vs past: `todayR` with two decimals and a `×` (`1.35×`), with `todayZ` in the title.
- Verdict: chip by code with its glyph and word (section 10); the cell's title prints `medR`, the interval
  `exp(lo)` to `exp(hi)`, `n`, `zeros` and `missing`.
- Straddle paid: `k of hitN` (`hit` share in the title), dash with "no straddle figure" when `hitN` is 0.
- Moved with surprise: `with of with+against` and a mini row of the four newest surprises as up or down
  triangles with the signed percent in each triangle's title; dash with "no surprise on record".
- Implied in NATR: `ratioNatr` with one decimal and `×`, title "Implied move over NATR(14) on <date>".
- Opening puts per call: `ratio` with two decimals, title "Opening put buys per opening call buy, the
  feed's counts at HH:MM TRT"; dash with "not read for this name" outside the two-session set.

Order: by `d`, then `t` (never by a score: the console is not a leaderboard; the info copy says so). A row
opens the drill (9.4). Keyboard: rows are one roving tab stop; Enter opens the drill, the ticker link is
the row's second stop.

#### 9.3.2 New issues

IPOs list rows: date (`F.day`) and `in 12 sessions`, ticker, name, exchange, price range
(`$18.00 to $20.00`; a non-USD `cur` prints `EUR 18.00 to 20.00`; a null end prints the dash with "range
not stated"). Listed: ticker, name, exchange, listed on. Delisted: ticker, name, exchange, delisted on, and
an "in the universe" chip when `u`. Each row's ticker opens the quote drill (9.4, quote only). Footer:
"Listings read 21:58 TRT on 2026-10-24" from `activeReadAt` (weekly), and the delisted dates read.

#### 9.3.3 Policy

Schedule: the next dates as day groups. Each group draws a thin horizontal TRT axis from 09:00 to 01:00
next day TRT with the US session as three bands (pre, regular, post, from `boundaries`, tokens
`--fill-3`, `--fill-2`, `--fill-3`) and each entry with a time as a dot at its TRT position (a dot inside
the regular band carries a ring); under the axis the entries as rows: time TRT (or `Time not stated`),
type, text, location. Posts: rows with time TRT and a phase chip (`Pre-market`, `In session`,
`After hours`, `Market closed`), the text (two lines, full in the row's dialog via Show all), tag chips and
cashtag ticker links. A notice line under the pane head: "Quoted as published, cut at 280 characters.
Tags mark words, not meaning."

#### 9.3.4 Halts

Live pane (rail `ht`): rows `HH:MM:SS TRT`, ticker (link when in the universe), state word (`Halted`,
`Paused`, `Resumed`, or the feed's word capitalised), reason (section 10's reason table; an unknown code
prints the code and "code not in this page's table"), and for a halt with no later resume in the held
rows, `open 4 min` counted from the row's time on the page's clock (repainted once a minute, no animation).
Header: "Since 13:02 TRT · 3 open". Last 14 days pane: the `halts14` rows with date and time TRT, ticker,
state, reason. A ticker opens the quote drill.

### 9.4 The drill (`#erDrill`)

A `dialog` (420 px sheet on desktop, 72 dvh bottom sheet on a phone), focus trapped, page `inert`, Escape
and the scrim close and return focus. For a Risk row: from `GET /api/flows/eventrisk?t=`, a strip chart of
the up to 12 past reports (x: report date; for each, a bar of `|m1d|` and a tick at `em` on one percent
scale, `--up-mark` for an up move, `--down-mark` for a down move, a triangle glyph so colour is not the only
channel; the surprise's sign as a small triangle above), a table twin of the same rows, the last report's
figures from `fin` or `er.fin` (revenue against the same quarter a year earlier as a percent, operating
margin as a percent, free cash flow as `ocf - capex` in compact dollars, each a dash with its reason), and
"Open <T>". For a Halts or New issues ticker: the quote from `?part=quote`, `Last $12.34 at 14:31:02 TRT`,
bid and ask with sizes, `Crossed quote` chip when flagged, the session word; a 429 prints "The quote limit
is reached; try again in a minute." with Retry after the `Retry-After`. One request per opened name per
visit (cached in the page), Retry on failure.

### 9.5 Week view marks

`FlowsUI.er.weekMarks` adds to each day of the existing Week view: an `IPO` pill per IPO that day (ticker
in the pill, name in its title) and a `Policy` pill with the count of schedule entries (title lists their
times in TRT). The pills use the existing `.fe-` pill classes with two new modifiers in `flows-er.css`
(`.fe-pill.er-ipo`, `.fe-pill.er-pol`); with `eventrisk` false the Week view is today's.

### 9.6 States (section 11 applies)

Each view: `pending` ("The first event-risk read lands after tonight's run."), `quiet` (the sentence names
what was looked for), `unavailable` with its `why` (`failed`, `plan`, `shed`, `off`), `partial` (a footer
counts what is missing), `stale` (the payload's `sessionDate` two or more sessions behind the expected
session: the module stamp turns `--warn`, "From the 2026-10-22 session"). Halts adds `socket-only`,
`closed` (outside 04:00 to 20:00 ET or a closed day: "The halt channel is not watched outside 04:00 to
20:00 ET."), `off`, and for the 14-day pane `not-configured`.

### 9.7 Accessibility

One `h1`, `h2` per module, no skipped level. Tablist with arrows, Home, End, `aria-controls`; inactive
panels `inert` and `visibility: hidden`. Each chart (the schedule axis, the drill strip) has a hidden
description and a table twin. The Halts live list is a `role="log"` with `aria-live="polite"` that
announces at most one new halt every five seconds ("ABCD halted, volatility pause, 14:31 TRT"). Contrast
4.5:1 measured over the surface (the glass suite's measure), visible focus, forced colours (`CanvasText`
bars and dots, `Highlight` focus), reduced motion (no transition; the page has no animation otherwise).

## 10. Fire page: feed-side templates

`shared/ff-pages-fire.js`: `fireBody(glyph, registry, { feed = false } = {})`. With `feed` false the
string is today's. With `feed` true the Start panel's header gains a two-segment control
(`FlowsUI.segmented`, `role="radiogroup"`, labels `Flows` and `From the feed`), and the panel holds a
second list `ul#ffxFeedTpls` in the same box (hidden until chosen), plus
`<i hidden data-defer="ff-feed" data-src="${v("/assets/js/flows-ff-feed.js")}">`. Choosing the segment
calls `FlowsUI.defer("ff-feed")`; `flows-ff-feed.js` (adds `FlowsUI.ffFeed`, a property, no global) reads
`GET /api/flows/eventrisk` once, runs its copy of `feedTemplateRows` (held equal to the leaf by 13.6) and
paints one row per `F0n`: title, a `Read-only` chip, a state chip (`On the feed`, `Not on this account's
plan`, `Not listed by the feed`, `Not read yet`), the feed's per-day limit (`up to 50 a day`, or the dash
"limit not stated"), the field names as code chips, and `differs` as the row's second line. A row's button
is "Use closest Flows template" (when `closest` is set; it selects that template in the Flows list and
switches the segment back) or "Open the <view> view" for F01, F03, F04 (a link to `/flows/events/#view=`
halts, macro, fda). No row can be armed, saved or sent; the module never builds a request to the feed.
For an owner, a footer line "Your feed account: 7 alert definitions, 3 fired in 14 days" from
`feed.owner`, with Show all opening a dialog of the configs (label, type, status, keys).

The segment fits the panel's existing header height (the Fire one-screen suite, `flows-ff-*` render
suites, must stay green at the seven FF viewports).

## 11. Copy

All strings live in `shared/flows-er-copy.js` (pages) and its browser twin inside `flows-er.js`, held equal
by 13.5. Sentences are 14 words at most, no forecast word (the Ask guard's `FORECAST_ALT`), no "tape", no
"vendor", no provider name, no second person except on the Fire page's existing voice.

Verdict words: `rich` "Priced above past moves", `cheap` "Priced below past moves", `inline` "Within past
range", `few` "Too few reports". Verdict note: "Past report moves against the implied move at each report."

Info dialog (Risk): "Each past report's implied move is set against the move that followed." / "The
verdict needs six reports and an interval that excludes the implied move." / "It describes this name's
past reports. It is not a forecast." / "Report dates are US dates. Times are in TRT."

Halt reason table (`HALT_REASONS`): `LUDP` "Volatility pause (limit up, limit down)", `LUDS` "Volatility
pause, straddle state", `M` "Volatility trading pause", `T1` "News pending", `T2` "News released", `T3`
"News and resumption times", `T5` "Single-stock trading pause", `T6` "Extraordinary market activity",
`T8` "Exchange-traded fund issue", `T12` "Additional information requested", `H4` "Not in compliance",
`H9` "Not current in filings", `H10` "Regulatory suspension", `H11` "Regulatory concern", `""` "No reason
given".

Honesty sentences (section 12 of the states): `socket-only` "The feed's halt channel is not connected, so
no halt is shown. That is not the same as none.", `not-configured` "No trading-state alert is set on the
feed account, so there is no 14-day record.", `plan` "The feed's plan does not include this.", `few`
"Fewer than six past reports with both moves.", `shed` "Cut to stay under the size limit.", NATR `unit`
"The feed's NATR was outside 0 to 100, so it is not shown.", pulse "Sentiment scores are not shown: the
feed states no scale for them."

## 12. Fixtures

### 12.1 Generator

`tests/gen-eventrisk-fixtures.py` writes `tests/fixtures-eventrisk.json`: for each registry id of section 3
(and the socket channel's payloads), synthetic bodies built from the 200-response schema in
`docs/uw-openapi.yaml` (JSON types, nullability, numeric strings) and, where an operation was observed, the
key set in `scripts/flows-probe-shapes.json`; the generator exits 1 where the two disagree. Tickers are
fixture names only (`SYX101`...; `SYE` prefix for event names: `SYE001` to `SYE060`; halts `SYH001`...),
except SPY and QQQ where the code keys on them; company names, schedule details, locations and posts are
invented sentences that name no real person, issuer or place (the President is never quoted: posts are
invented neutral sentences such as "Meeting on SYE004 trade terms today. $SYE004"). It includes the hostile
cases the sanitiser and reducers must survive: a post with a chat marker, a URL, bidi characters and an
instruction-shaped sentence; a schedule `time` with no zone; a NATR of 140; an options-pulse with
`call_txn` 0; an EPS row whose `surprise_percentage` disagrees with its own figures; an IPO with `lo > hi`;
a trading-state alert whose `symbol` is an option contract; an alert config whose `name` holds markup.
The file records `provenance.generator`, its sha256, `nature: "synthetic, written from the committed
spec, not observed feed data"` and the sha256 of the spec and the shape manifest;
`tests/flows-probe-contract.mjs` holds the hashes and refuses a fixture whose `source` claims a live read.

### 12.2 Probe list

`scripts/flows-probe-list.json` gains the new ids with their `reads` (section 3); the socket channel and
`stock-quote` are `liveOnly` for the weekly probe's REST walk until observed. The probe itself is not run.

## 13. Tests

Register every new suite with a `tests/suites/<name>.json` carrying a `command` and a `shard` pin on the
lightest shard (then `node run-contract.mjs` from `tests/`). Planted wrong builds load through
`tests/truth/mutants.mjs` (exact-once transforms of a copy; production is never edited) and each must fail
its own named check by an assertion, not a crash.

### 13.1 `flows-er-switch` (N)

The four readers over 14 spellings each (`on`, ` ON `, `owner`, `off`, `Off`, empty, unset, `true`, `1`,
`yes`, `onn`, `0`, `-1`, `1001` as applicable); the page row and the route agree with the leaf for owner
and member. Planted: `owner` read as `on`; unset read as `on`; cap above 1,000 not clamped; halts on for
`true`.

### 13.2 `flows-er-leaves` (N)

`tests/gen-er-fixtures.py` (numpy, scipy, Python `decimal` and `fractions`; versions and its own sha256 in
the fixture) writes `tests/fixtures-er.json`: 400 seeded name histories with the expected `meanLog`,
`lo`, `hi` (scipy `t.ppf(0.975, n-1)`), `medR`, `beat` and its Wilson bounds, `verdict`, `todayR`,
`todayZ`, concordance and its bounds; 2,000 EPS strings with exact hundredths and surprises (Decimal,
ROUND_HALF_UP away from zero); impact instants for 300 report dates under both times against
`exchange_calendars` sessions and the IANA zones; 200 posts and schedule entries with expected phases. The
suite holds every leaf to it, then: the join window of 3 days from both sides, the ties, `m1d = 0`,
missing figures counted, NATR unit refusal, pulse counts and the sentiment never stored, every sanitiser
case of 12.1, `fitEventRisk` shed order step by step on a payload built to overflow, `feedTemplateRows`
states, the grammar walk on nested objects, and a scan that no new file contains `tape` or `vendor` in a
string literal or identifier and that `opById("alerts-config").method === "GET"`.

Planted builds (each must fail): the t critical of the normal (1.96) instead of t; `rich` and `cheap`
swapped; `beat` with `>=`; zeros dropped from `n`; a missing `m1d` read as 0; `sx` against the signed
estimate (no absolute value); the feed's `surprise_percentage` stored instead of ours; the join taking the
later of two tied rows; NATR clamped to 100; pulse ratio with calls over puts; the sentiment score stored;
a schedule time with no zone read as UTC midnight; a post in the pre-market phased `rth`; a cashtag outside
the universe kept; a trading-state alert keeping an option symbol; `tape_time` read; the config's raw id
stored; config values stored; a `POST` entry registered for `alerts-config`; `feedTemplateRows` reporting
`ready` when the account cannot create the type; the shed order with `ev` dropped first; `fin` read for a
name whose `dx.financials` is fresh.

### 13.3 `flows-er-nightly` (N)

Against the fake and the dry-run emit: the stage table entry and its order, the calls of a night equal to
`CALL_COST`, plan refusals filed with `since` and not re-asked inside 7 days, the weekly reads on their
schedule over a 15-night simulation, the `er` planner over 40 nights on 856 names (cold start inside 6
nights, no part past `maxS`, never over the cap), the payload under 96 KiB on the emit and the shed
recorded, `eventrisk` and `er-sectors` registered and emitted, the fixture stamp on every emitted object,
the publish refusal for a fixture name off a test host, and with `FLOWS_EVENTRISK_NIGHTLY=off` a dry-run
emit byte for byte the golden (`tests/fixtures-pipeline-golden.json` regenerated with `--write` only for
the on run, in its own commit).

### 13.4 `flows-er-route` (N) and `flows-er-rt` (N)

Route: gates and their order (405 before 401, 404 `eventrisk_off` before any store read, counted on the
counting D1 fake), each query form's rows read, `invalid_part`, `invalid_ticker` for a fixture name off a
test host, the owner block stripped for a member and kept for an owner, the bytes untouched when nothing is
stripped, card-x `er` stripped when closed, the quote's gate (member once, one token a miss, hit with none,
stale and 429 paths, crossed flag, deadline as `504 chain_timeout` or the `unavailable` body). Planted: the
switch read after the store; the owner block served to a member; a second member check per request; the
quote kept 60 s.

Rail: the topic in the envelope tables, the socket frame shaper (drops, ids, de-duplication, 200 cap), the
hub's `socket-only` state when unacknowledged, live when acknowledged and silent, the `ht` refusal for a
closed member and with the halts switch off (400 alone, dropped with `X-RT-Dropped` in a list), no REST
call ever for `ht`, `meta.since`, and the vendor minute line unchanged. Planted: `ht` live while
unacknowledged; a REST fallback invented; `ht` admitted for a closed member; an option symbol kept; the
200 cap missing.

### 13.5 `flows-er-render` (C) and `flows-er-firstpaint` (C)

Chromium with `page.route` stubs and `page.routeWebSocket`, no server; `tests/lib/er-world.mjs` serves the
Events page from `eventsPage({ eventrisk: true, halts: true })` with the dry-run emit's `events` and
`eventrisk`, a fixture `card-x`, and a scripted `ht` stream. At 1920x1080, 1440x820, 1024x768 and 390x844,
in every view and every segment: no page scroll, no inner scroll, nothing clipped (the layout sweep's
measures), the tablist from the keyboard and the address; every printed figure against an independent
formatter over the payload (percent, ratio, counts, TRT times, the impact words); the verdict chips'
glyph and word; dashes with their reasons for each null path; the drill (focus trap, inert, Escape, table
twin, quote states including 429 and Retry); the schedule axis positions against `boundaries` within
1 px; the halts list from the stream (append, de-duplication, `open N min` on a paused clock, the
throttled announcements, the `socket-only`, `closed` and `off` states); the Week marks; the 14-day pane's
`not-configured` state; a hostile post and alert label that never reach `innerHTML`; colour-literal and
comment scans of the new files; axe clean at 390 and 1440; reduced motion and forced colours.

First paint (Chromium, WebKit and Firefox where installed, as `flows-sfc-firstpaint` does): the four new
modules do not move by more than 1 px from the skeleton to the data, with the data held until four frames
of the skeleton have drawn.

Planted wrong builds of the served files (each must fail): the verdict chip by colour only; Implied now
printed as a fraction; TRT replaced by Eastern time; a null `emNow` printed as 0.0%; the ticker link built
with `innerHTML`; rows ordered by `todayR`; the tablist two rows at 1024; the Halts pane showing "No halts"
for `socket-only`; the 14-day pane empty instead of `not-configured`; `open N min` counted from page load;
the schedule dot placed by Eastern minutes; the drill not returning focus; the deferred sheet loaded
eagerly (the eager weight check of `flows-weight`).

### 13.6 `flows-ff-feed-render` (C)

The Fire page with `feed: true` at the seven FF viewports: the segment by keyboard and click, the list
swap in the same box (no height change, no scroll), each state chip from a stub payload, the closest
template selection, the view links, the owner footer and its dialog for an owner only, no request to any
path but `/api/flows/eventrisk`, and the browser copy of `feedTemplateRows` equal to the leaf over 200
random `feed` blocks. With `feed: false` the page string is byte for byte today's. Planted: a row with an
Arm button; a request to a feed path; the owner footer for a member; `closest` kept for a null-`ast`
template.

### 13.7 Byte for byte off

One block in `flows-er-route` renders `eventsPage({ username })`, `eventsPage({ username, eventrisk:
false, halts: true })` and today's string from `git show origin/main:shared/flows-pages.js` loaded through
a data URL, and requires them equal; the same for `fireBody`; card-x and political reads with the switch
closed equal the stored bytes; the rail's snapshot for `k=px,fl,mk,nw` equal with the halts switch on and
off; the dry-run emit with the nightly switch off equal to the golden.

### 13.8 Existing suites to update and run

`flows-feeds-onescreen` (Events tab count and the 3 x 3 phone grid), `flows-pages-render` (baseline for
Events may not rise), `flows-layout-sweep`, `route-matrix` (regenerated in its own commit),
`flows-reads-contract`, `flows-registry-contract`, `flows-probe-contract`, `flows-d1-budget`,
`flows-vendor-budget`, `flows-rt-contract`, `flows-rt-client`, `server-rt`, `flows-copy-lint`,
`fixture-guard`, `flows-weight`, `architecture`, `docs`, `contracts`, `lib-contract`, `ff-contract`
(must pass unchanged: the FF contract is not edited), `flows-legs`, `flows-pipeline-golden`, `server-pages`,
`server-ops`, `flows-public` (the About page's table is unchanged: no nav change). Run the workerd suites
with `FLOWS_TEST_SANDBOX=1` and the browser suites with `PLAYWRIGHT_BROWSERS_PATH`.

## 14. Registry, docs and assets

`docs/modules.json` gains one row per new file group (with a `show` cell for the File map), then
`node scripts/gen-docs.mjs`; `docs/vendor-coverage.md` gains the seventeen rows and the row-12 note;
`DEPLOY.md` gains a short section after 10.6 naming the three switches and the order to turn them on
(nightly first, then `FLOWS_EVENTRISK=owner`, read one night's payload, then halts). `node
scripts/bump-assets.mjs` once at the end, then `--check`. `node run.mjs --repin` only if the balance line
fails.

## 15. Order of work

1. Switch leaf and its suite (13.1). 2. Registry entries, fixtures generator and probe list (3, 12).
3. Leaves 6.1 to 6.7 with `flows-er-leaves` (13.2). 4. The `er` parts and the nightly stage (4) with
`flows-er-nightly` (13.3). 5. Route family, page rows, stripping, quote (7) with `flows-er-route`.
6. Rail topic (8) with `flows-er-rt`. 7. The Events page views (9) with `flows-er-render` and
`flows-er-firstpaint`; inspect screenshots at the four sizes (`SHOTS=<dir>`) before calling the view done.
8. Fire page feed group (10) with `flows-ff-feed-render`. 9. Section 13.7 and 13.8, docs and assets (14),
`node scripts/prepush.mjs`, commit, push `claude/wp6-event-risk`, report the branch. Do not merge.
