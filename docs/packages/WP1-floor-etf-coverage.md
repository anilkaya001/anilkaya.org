# WP1: every fund on the Market Floor has data

Package spec, written by the mentor for the implementer. Read `AGENTS.md` first; every rule
there applies (no comments in source, no fixture leak, TRT only, a dash with a reason and
never a fake zero, no word "vendor" or the provider's name in served copy: say "the feed",
never the word "tape", one screen at 1920x1080, 1440x820, 1024x768 and 390x844).
Never call the live feed and never read `UW_API_KEY`. Fixtures are written from
`docs/uw-openapi.yaml` by a generator, with invented figures and `fixture: true`.

## 1. Root cause (read, not assumed)

`model(alerts, o)` in `assets/js/flows-market-floor.js` builds every pillar from
`/api/flows/flowalerts` rows alone. A tile is created for each of the 4 index funds and
the 11 sector ETFs whatever happens, and for an `OTHER` class only when one of its
tickers was flagged. `valueOf` returns `null` when `t.n` is 0, so an unflagged fund draws
as the dashed slate tile with "No window of this class was flagged this session." The
feed publishes the whole session's options activity for every one of these funds; the
site reads it for some (`sector-etfs` for SPY and XLB..XLY in
`publishSectorPremium`, `etf-tide` for SPY, QQQ, IWM, DIA in `regime.mjs` and the live
breadth pass) and never hands it to the Floor. Nothing reads it at all for the 62 tickers
of `OTHER`.

The fix is at the source: read whole-session activity for every Floor fund, publish it
once, and draw it as a second, labelled basis, never summed with flagged premium.

## 2. Scope

In scope: one pure leaf, one nightly leg, one block in the `market` payload, one live key
refreshed by the Tier 2 pass, the Floor's model, layout, readout and copy, one switch,
one new suite and an extension of `flows-market-floor-render`.

Out of scope, with the reason recorded in the commit message: `options-pulse/sectors` and
`options-pulse/top` (sentiment scores, not activity, and already summarised in
`regime.optionsPulse`); per-name stock session activity (the stock rows keep their flagged
basis; the universe already carries `chg` and the screener premiums for a later package).

## 3. The fund table (one definition, two copies)

New leaf `shared/flows-floor-funds.js`, imports nothing. It is the single list; the page
carries a copy because `assets/js` imports nothing, and the new suite holds the two equal
token for token.

```js
export const FLOOR_FUNDS = Object.freeze({
  funds: ["SPY", "QQQ", "IWM", "DIA"],
  etf: ["XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLB", "XLU", "XLRE"],
  other: {
    Bonds: [...], Commodities: [...], "Index options": [...], Volatility: [...], Crypto: [...], International: [...],
  },
});
export const ROOT_ALIAS = Object.freeze({ SPXW: "SPX", NDXP: "NDX", RUTW: "RUT", VIXW: "VIX", MRUT: "RUT" });
export const FUNDS_VERSION = 1;
export function readList()
export function shapeFundRow(row, source)
export function fundActivity({ screenerRows, volumeRaws, sectorRows, infoParts, session, readAt, prior })
export function fitFunds(block, maxBytes)
export const FUND_WHY = Object.freeze({ ... })
```

The `other` lists are copied verbatim from `OTHER` in `flows-market-floor.js` today (Bonds
11, Commodities 14, Index options 11, Volatility 6, Crypto 8, International 12: 62).
`readList()` is the 77 tickers in that order less the five weekly roots of `ROOT_ALIAS`,
which are never read on their own: the feed reports options activity per underlying, so
`SPXW` is counted inside `SPX`. A weekly root's entry in the block is
`{ alias: "SPX" }` with no figures, and the page prints "Counted under SPX".

## 4. Sources, in the order they are tried

| Order | Operation (`shared/flows-vendor-ops.js` id) | Calls | What it gives |
|---|---|---|---|
| 1 | `screener-stocks` with `ticker=<readList joined by commas>`, `limit=500` | 1 | `call_premium`, `put_premium`, `call_volume`, `put_volume`, `bullish_premium`, `bearish_premium`, `close`, `prev_close`, `issue_type`, `full_name` for each fund the screener lists |
| 2 | `sector-etfs` (already read by `publishSectorPremium`; reuse its raw, no second call) | 0 | the same six figures for SPY and the eleven XL funds when the screener missed one |
| 3 | `options-volume` with `{ticker}` and `limit=1`, for each fund still without a row after 1 and 2, at most `FUNDS_FALLBACK_MAX` (24) a night | 0 to 24 | the session's `call_premium`, `put_premium`, `call_volume`, `put_volume`, `bullish_premium`, `bearish_premium`, `date` |
| 4 | `etf-info` (new registry entry, `/api/etfs/{ticker}/info`, `klass: "slow"`, reads `name`, `etf_company`, `aum`, `expense_ratio`, `holdings_count`, `has_options`) and `etf-weights` (new, `/api/etfs/{ticker}/weights`, reads `sector`, `country`, `weight`) | rotation, at most 30 a night | readout context, refreshed at most every 14 days, carried from the prior night |
| 5 | `ticker-exchanges` (new, `/api/stock-directory/ticker-exchanges`, `klass: "slow"`) | 1 a week | confirms each listed fund still trades; a ticker absent from the directory becomes `why: "not_listed"` |
| 6 | `etf-in-outflow` (exists in the registry) | inside the same rotation as 4 | the latest daily creation and redemption flow for the readout, dated |

Add `etf-info`, `etf-weights` and `ticker-exchanges` to `shared/flows-vendor-ops.js` with
their `reads`; `tests/flows-probe-contract.mjs` holds every entry to the committed spec, so
a field the spec does not document is not read. Add `options-volume` `reads` (it has none
today): `date`, `call_premium`, `put_premium`, `call_volume`, `put_volume`,
`bullish_premium`, `bearish_premium`. Add `CALL_COST.funds` to
`scripts/flows-nightly/vendor-params.mjs` (1 + 24 + 30 + 30 + 1 at most) so the nightly
budget counts it.

Precedence when two sources give a fund: screener, then sector-etfs, then options-volume,
then nothing. A source whose session date is not the payload's session never wins over
one that is (screener rows carry the session through the request's `date`; options-volume
through `date`; sector-etfs through `sectorEtfsDay`). The chosen source is recorded per
fund in `src`.

## 5. Payload shapes

### 5.1 Nightly: `market.funds`

`runMarket` (`scripts/flows-nightly/sections/market.mjs`) spreads one more field into the
`market` payload. The reads happen in a new isolated stage `funds`, placed in
`scripts/flows-nightly/stages.mjs` immediately before `market`, `publishes: []`, that
stores its result on `ctx.funds`. Its leg is `scripts/flows-legs/funds.mjs`
(`runFundsLeg(ctx, { uw, read, prior })`); the prior is `readStored("market")`'s `funds`.
If the stage fails or is skipped, `market.funds` is
`{ v: 1, status: "unavailable", why: "not_read" }` and the market payload is otherwise
byte for byte what it is today.

```text
funds: {
  v: 1, status: "ok" | "partial" | "unavailable" | "off",
  session: "YYYY-MM-DD",       readAt: ISO instant,
  units: { prem: "usd", vol: "contracts", net: "usd" },
  basis: "whole-session options activity per fund, as the feed reports it",
  counts: { listed, read, fromScreener, fromSectorEtfs, fromVolume, missing, alias },
  rows: { "<TICKER>": {
      c: "funds" | "etf" | "<other class>",
      src: "screener" | "sector-etfs" | "options-volume",
      d: "YYYY-MM-DD",                       the session the figures belong to
      cp, pp,                                 call and put premium, usd, integers
      cv, pv,                                 call and put contracts, integers
      bu, be,                                 bullish and bearish premium, usd, integers
    } | { c, why: "<FUND_WHY key>" } | { c, alias: "SPX" } },
  meta: { "<TICKER>": { at, name, issuer, aum, er, n, sec: [[name, w]...3], ctry: [[name, w]...3], flow: { d, usd } | null, why? } },
}
```

Rules, each held by a test:

- A figure is an integer or `null`. A missing field is `null`, never 0. A field the feed
  answered with `0` stays `0` and is a measured zero.
- `prem = cp + pp` and `vol = cv + pv` are computed by the page, never stored; a pillar
  whose `cp` or `pp` is `null` has no premium and says which side is missing.
- Net lean is `bu - be` with the ratio `(bu - be) / (bu + be)`, `null` when `bu + be` is
  0 (0/0 is undefined, as `sectorLean` already says).
- `FUND_WHY` keys and their sentences (page copy, at most 14 words):
  `no_row` "The feed returned no row for this fund this session.",
  `stale` "The feed's row is for an earlier session.",
  `not_listed` "This ticker is not in the feed's directory.",
  `over_cap` "Not read tonight: the fallback read cap was reached.",
  `refused` "The feed refused this read.",
  `failed` "The read failed; it will be tried again.",
  `off` "Whole-session activity is switched off.".
- `fitFunds(block, 6 * 1024)` keeps the block under 6 KiB by dropping `meta` entries
  oldest first, then `meta` entirely; `rows` are never shed. Measured size on the dry emit
  is recorded in the commit (expected about 4.5 KiB for 77 rows).
- The `meta` rotation carries the prior night's entry while it is under 14 days old;
  `info` and `weights` amounts whose unit the spec does not state are withheld, as in
  `shared/flows-vendor-extras.js` (`UNIT_STATUS`).

### 5.2 Live: `live:funds`

Add `"live:funds": spec("breadth", "actions", 12 * 1024, 1)` to `LIVE_KEYS` in
`shared/flows-live.js`, with a pure builder `shapeFunds(raw, { at, session, writer })` that
reuses `shapeFundRow` from the leaf and returns `{ v: 1, key: "live:funds", session,
fresh, rows }` with the same row shape as 5.1 (no `meta`). The Tier 2 pass
(`scripts/flows-legs/live.mjs`) makes the one screener call of order 1 per pass inside
`LIVE_BUDGET.tier2MaxCalls` (count it in the pass's planned calls and in
`tests/flows-vendor-budget.mjs`), only in the regular session and the post-market, and
writes `live:funds` only when the read answered. No options-volume fallback runs live.
The page reads it through the existing `GET /api/flows/lk?k=funds` (`serveLiveKey`
already serves any registered live key; confirm `liveKeyFromParam` accepts it and add a
rows-read ceiling line in `tests/flows-reads-contract.mjs`). Declare the writer and its
rows in `tests/lib/d1-budget.mjs` (one row per pass, at most 108 a weekday) so
`flows-d1-budget` prices it.

Which copy the Floor shows: the live row when its `session` equals the alerts' session
and its `fresh` state is `live` or `fresh`; else the nightly block when its `session`
equals the alerts' session; else the newest of the two, labelled
"Previous session · <date>" and never mixed with today's flagged windows on one pillar.

## 6. The switch

`FLOWS_FLOOR_FUNDS` in `wrangler.toml` [vars], shipped `on`: `on` shows the session basis
to every member, `owner` to owners only (`FLOWS_RT_USERS` through `isOwner`), anything
else is off and fails closed. The Worker passes `floorFunds: true|false` to `marketPage`
(`server/routes/flows-pages.js`), which writes `data-funds="on"` on `#mkFloor`; off, the
served HTML is byte for byte today's (the suite compares it). The same name in the
nightly's and the live leg's environment: `off` skips every read of section 4 and
publishes `funds: { v: 1, status: "off" }` and no `live:funds`; unset or any other value
is on. Add the switch to `OPS_SWITCHES` in `server/ops.js` so the Status page lists it.

## 7. The Floor (assets/js/flows-market-floor.js)

`mount(host, { universe, funds })`: `flows-market.js` adds `optional("/api/flows/market")`'s
`funds` field (it already reads the market payload) and, when `data-funds` is `on`, one
`GET /api/flows/lk?k=funds` at mount and on the `live:funds` heartbeat; it passes both to
`mount`, and `api.take` gains `api.funds(nightly, live)`.

`model(alerts, o)` gains `o.funds` (the chosen copy from section 5.2). Fund tiles are
created for every ticker of the table, as today for `funds` and `etf`, and now for every
`OTHER` class whatever was flagged (a class tile with no flagged window and session data
is no longer dashed). Each fund tile carries two separate records:

```text
t.flag = { n, prem, up, down, nx, vol, volN }            from flagged windows, as today
t.sess = { n, prem, cp, pp, vol, cv, pv, net, bu, be,     from the funds block, summed over
           src: Set, d, why: Map<ticker, FUND_WHY key>, alias: [...] }   the class's tickers
```

Nothing ever adds `t.flag.prem` to `t.sess.prem`.

A new segmented control beside the measure switch, **Basis**: `Flagged` and `Session`
(`FlowsUI.segmented`, arrow keys, `#view=floor&basis=session` in the address).

- `Flagged` (the default, and the only basis when the switch is off): today's floor,
  heights on the flagged scale. A fund tile with no flagged window keeps the dashed tile
  but its label gains a second line "Session $41.3M" (or the dash and its reason), so
  the reader sees the fund was active without the height claiming it was flagged.
- `Session`: the four fund rows only (index funds, sector ETFs, other classes), heights on
  one session scale for the active measure (Premium `cp + pp`, Volume `cv + pv`, Net lean
  `|bu - be|`, colour by `(bu - be) / (bu + be)` with the existing edges). The stock row
  is not drawn and the caption says "Stocks show flagged windows only." A tile whose
  figure is `null` is the dashed tile with the reason from `FUND_WHY`, the only case in
  which a fund shows a dash.
- The subtitle `#mkFloorSub` names the basis and its time: "Whole session · read 22:41 TRT"
  or "Flagged windows · <session>"; the date appears only when it is not today, as on the
  Status page. Every time is TRT, built with the page kernel's TRT formatter.
- Per pillar, the hit button's sentence and the readout carry the basis word
  ("Whole session" or "Flagged windows"), the source in plain words ("the feed's screener
  row", "the feed's sector fund row", "the feed's per-fund volume"), the class's tickers
  with their own figures, aliases as "SPXW counted under SPX", and the `meta` context when
  present: issuer, assets under management, holdings count, the top three sectors and
  countries with weights, and the latest creation or redemption flow with its date. A
  `meta` field that is absent is left out, not printed as a dash.
- The side list at rest ranks the classes by the active basis and measure; drilling a
  fund class lists its tickers with both bases in two columns, flagged first.
- Copy lint: every new string goes through `tests/lib/copy-lint.mjs` (no "tape", no
  provider name, no "vendor", sentences at most 14 words, no forecast word).

Layout and one-screen rules are unchanged; the Basis control sits in `#mkFloorSeg` with
the measure switch and both must fit at 390x844 (the measure switch wraps under it there).

## 8. Tests

New suite `tests/flows-floor-funds.mjs` (class N), registered in
`tests/suites/flows-floor-funds.json` with a `command` and a shard pin (lightest shard, then
`node run-contract.mjs`):

1. The leaf: `readList()` is 72 tickers, the five aliases excluded; the page's table
   (parsed from `flows-market-floor.js`) equals `FLOOR_FUNDS` token for token.
2. `shapeFundRow`: string and number numerics read exactly, `null` stays `null`, `0`
   stays `0`, a negative premium or volume is refused as `null` with `why` kept.
3. Precedence over a table of 12 source combinations, including a screener row of an
   earlier session losing to a same-session options-volume row.
4. The fallback cap: 30 funds missing gives 24 reads and 6 `over_cap`.
5. The dry emit (`nightlyEmit()` from `tests/lib/nightly-emit.mjs`): `market.funds.status`
   is `ok`; each of the 15 index and sector funds and each of the 57 read `OTHER` tickers
   has non-null `cp`, `pp`, `cv`, `pv`, `bu`, `be`; each alias row names its parent; the
   block is under 6 KiB; `FLOWS_FLOOR_FUNDS=off` makes `funds.status` `off`, adds no call,
   and leaves every other payload byte for byte equal (hash them).
6. `shapeFunds` against the same rows gives the same per-fund figures as the nightly.
7. Planted wrong builds through `tests/truth/mutants.mjs` (exact-once transforms, each must
   fail its named check and the correct build must pass):
   - `fund-dropped-from-read`: one ticker removed from `readList`;
   - `zero-for-missing`: `shapeFundRow` writes 0 for an absent field;
   - `alias-read-alone`: SPXW read as its own ticker;
   - `stale-wins`: precedence ignores the session date;
   - `cap-ignored`: the fallback reads every missing fund;
   - `meta-sheds-rows`: `fitFunds` drops `rows` before `meta`;
   - `switch-fails-open`: a misspelt switch value treated as on.

Extend `tests/flows-market-floor-render.mjs` (class C, `page.route`, no server); serve a
synthetic funds block and `live:funds` row built by the same generator:

8. With the switch on, in `Session` basis, every fund tile has a non-null value in all
   three measures at 1920x1080, 1440x820, 1024x768 and 390x844; heights equal an
   independent computation on the session scale; colour by the net ratio.
9. A fund with `why: "no_row"` is the only dashed fund tile and its readout prints the
   `FUND_WHY` sentence.
10. `Flagged` basis: heights are unchanged from today's computation (re-run the existing
    assertions), and an unflagged fund tile shows its session caption.
11. Basis by keyboard and click, the address round trip, the subtitle's TRT stamp on a
    pinned clock, a previous-session copy labelled as such, the stock row absent in
    `Session` with its caption.
12. Switch off: the served HTML and the floor's pixels equal today's (screenshot hash at
    1440x820) and no request to `lk?k=funds` is made.
13. No page scroll, no clipped text, no overlap of labels at the four sizes in both bases
    (the existing label audit).
14. Planted wrong builds of the served script:
    - `sum-bases`: `t.flag.prem + t.sess.prem` as the height;
    - `one-scale`: session values drawn on the flagged scale;
    - `zero-not-dash`: a `null` session figure drawn as 0;
    - `fund-dropped-page`: one `OTHER` ticker removed from the page's table;
    - `stale-as-today`: a previous-session copy printed without its label;
    - `stocks-in-session`: the stock row drawn in `Session` basis;
    - `eastern-stamp`: the subtitle in Eastern time.

Also touched and run: `flows-market-onescreen`, `flows-market-visual`,
`flows-layout-sweep`, `flows-legs` (stage table), `flows-pipeline-golden` (rewrite the
manifest with `--write` in this pull request and name the payload that moved: `market`
only), `flows-registry-contract`, `flows-probe-contract`, `flows-vendor-budget`,
`flows-d1-budget`, `flows-reads-contract`, `flows-live-contract`, `server-pages`,
`route-matrix`, `server-ops`, `flows-weight` (the floor's deferred file grows; state the
new size), `fixture-guard`, `flows-copy-lint`, `contracts` (asset bump), `docs`.

## 9. Fixtures

Extend `scripts/flows-nightly/fixtures.mjs` and `scripts/flows-legs/live-fake.mjs` with
fakes for the screener fund read, options-volume, etf-info, etf-weights and
ticker-exchanges, each calling `touch()` on entry. Leave the screener fake missing three
`OTHER` tickers so the dry run exercises the options-volume fallback, and one Index options
root with no row at all so `no_row` is exercised outside the emit assertions (the emit
assertion of test 5 then names that root as the expected exception; record it in the
suite, not as a loosened check). Real symbols are allowed only because the Floor keys on
these names (AGENTS.md fixture rule 2); the figures are invented and the payload carries
`fixture: true`.

## 10. Order of work

1. Leaf and its unit tests (1 to 4, 7).
2. Registry entries, leg, stage, `market.funds`, dry emit tests (5), golden rewrite.
3. `live:funds`, its budgets and test 6.
4. Switch plumbing, page model, Basis control, copy.
5. Visual inspection: screenshots of both bases at the four sizes, compared against
   today's; fix anything that reads as two scales in one picture.
6. Render tests (8 to 14), docs (`docs/modules.json` rows for the new files,
   `node scripts/gen-docs.mjs`), `node scripts/bump-assets.mjs`, `node run.mjs --repin`
   only if the balance line asks, `node scripts/prepush.mjs`.
7. Commit, push the branch, open a draft pull request; do not merge.

## 11. Honesty states the page must be able to show

| State | When | Pillar | Readout |
|---|---|---|---|
| Session, today | block or live row for the alerts' session | solid, session scale | "Whole session · read HH:MM TRT" |
| Session, previous | only an earlier session is held | solid, labelled | "Previous session · <date>" |
| Flagged only | basis `Flagged` | today's floor | session caption on unflagged funds |
| No row | `why` set for every ticker of the tile | dashed | the `FUND_WHY` sentence |
| Partial class | some tickers have rows, some `why` | solid on the read tickers | "N of M funds read", each missing one named |
| Alias | weekly root | no own pillar | "Counted under SPX" |
| Off | switch off | today's floor, no Basis control | nothing new |
| Unavailable | block `unavailable` and no live row | `Session` disabled with the reason | "Whole-session activity was not read tonight." |
