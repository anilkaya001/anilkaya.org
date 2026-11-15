# WP3: volatility structure and the engine cross-check

Package spec, written by the mentor for the implementer. Read `AGENTS.md` first; every rule
there applies: no comments in source, no fixture leak, TRT only, a dash with a reason and
never a fake zero, no provider name and no word "vendor" in served copy (say "the feed"),
never the word "tape" in served copy, one screen at 1920x1080, 1440x820, 1024x768 and
390x844. Never call the live feed and never read `UW_API_KEY`. Every fixture is written
from `docs/uw-openapi.yaml` (and `scripts/flows-probe-shapes.json` where the spec states no
schema) by a generator, with invented figures, fixture tickers and `fixture: true`.

## 1. What this package adds, and why

Two surfaces, one nightly leg, one owner-and-member switch.

1. **Vol desk**, a new tab on Market (`#view=voldesk`): the index term structure
   (contango or backwardation, the feed's futures curve and its roll when the shape is
   known), implied against realised for the four index funds, the cross-name correlation
   matrix of the index funds and sector ETFs at two windows, and the names whose
   volatility character changed. These are the regime inputs a volatility desk reads
   first and Flows does not show.
2. **Engine cross-check**, a strip in the ticker's Surface & terrain tab: the feed's own
   greeks, chain, open interest by expiry and exposure by strike are read as an
   **independent audit of the site's engine**, never as a second truth. The strip prints
   the engine's figure, the feed's figure, the gap, and a verdict against a stated
   tolerance. The nightly health gate counts the disagreements.
3. **Stance store**: `option-stance` is read and stored for a later calibration
   comparison with the desk's Win %. It is never served to a page and never displayed.

Everything sits behind `FLOWS_VOLDESK` (pages and route) and `FLOWS_VOLDESK_BUILD`
(the nightly leg). Both ship so that production behaviour is unchanged until the owner
opens it (section 9).

## 2. The thirteen operations (read from `docs/uw-openapi.yaml`, not assumed)

| id (new, in `shared/flows-vendor-ops.js`) | path | schema stated? | read by | calls a night |
|---|---|---|---|---|
| `vix-term` | `/api/volatility/vix-term-structure` | **No** (`Volatility Result`, `additionalProperties: true`, "`{ latest, history }` objects"); plan add-on `volatility` | voldesk leg | 1 |
| `vol-character-top` | `/api/volatility/character/top` | **No** (same `Volatility Result`, "arrays of ticker rows") | voldesk leg | 2 |
| `vol-realized` | `/api/stock/{ticker}/volatility/realized` | Yes (`date`, `implied_volatility`, `realized_volatility`, `price`, `unshifted_rv_date`, all strings) | voldesk leg | 4 |
| `vol-stats` | `/api/stock/{ticker}/volatility/stats` | Yes, with mislabelled descriptions (section 4.3) | voldesk leg | 4 |
| `greeks` | `/api/stock/{ticker}/greeks` (`expiry` required) | Yes; observed shape in `flows-probe-shapes.json` | audit leg | 1 a name |
| `option-chains` | `/api/stock/{ticker}/option-chains?greeks=true` | Prose only (`Option Chains response`); observed enriched shape in `flows-probe-shapes.json` | audit leg | 1 a name |
| `atm-chains` | `/api/stock/{ticker}/atm-chains` (`expirations[]` required) | Yes | audit leg | 1 a name |
| `oi-per-expiry` | `/api/stock/{ticker}/oi-per-expiry` | Yes (`call_oi`, `put_oi` integers, `date`, `expiry`) | audit leg | 1 a name |
| `volume-oi-expiry` | `/api/stock/{ticker}/option/volume-oi-expiry` | Yes (`expires`, `oi`, `volume` integers) | audit leg | 1 a name |
| `greek-exposure-strike` | `/api/stock/{ticker}/greek-exposure/strike` | Yes; "sum of the X values ... multiplied by the open interest and the number of shares per contract" | audit leg | 1 a name |
| `greek-exposure-strike-expiry` | `/api/stock/{ticker}/greek-exposure/strike-expiry` (`expiry` required) | Yes, same wording | audit leg | 1 a name |
| `option-stance` | `/api/stock/{ticker}/option-stance` (`stance` required) | Yes (`fit_score` 0..5, `pop` "≈ 1−\|Δ\|", `context`) | audit leg | 1 a name |
| `market-correlations` | `/api/market/correlations` (`tickers` required, `interval`) | Yes (`fst`, `snd`, `correlation`, `rows`, `min_date`, `max_date`; the schema's `correlation` refers to itself, the example is a number) | voldesk leg | 2 |

Registry entries (append to `RAW`, in this order, after `etf-exposure`):

```js
{ id: "vix-term", path: "/api/volatility/vix-term-structure", plan: "addon:volatility", licence: "derived", klass: "nightly", maxBytes: 131072, reads: [] },
{ id: "vol-character-top", path: "/api/volatility/character/top", licence: "derived", klass: "nightly", maxBytes: 131072, reads: [] },
{ id: "vol-realized", path: "/api/stock/{ticker}/volatility/realized", licence: "derived", klass: "nightly", maxBytes: 65536, reads: ["date", "implied_volatility", "realized_volatility", "price", "unshifted_rv_date"] },
{ id: "vol-stats", path: "/api/stock/{ticker}/volatility/stats", licence: "derived", klass: "nightly", maxBytes: 8192, reads: ["date", "iv", "iv_high", "iv_low", "rv", "ticker"] },
{ id: "greeks", path: "/api/stock/{ticker}/greeks", licence: "derived", klass: "nightly", maxBytes: 262144, reads: ["strike", "expiry", "date", "call_delta", "put_delta", "call_gamma", "put_gamma", "call_volatility", "put_volatility"] },
{ id: "option-chains", path: "/api/stock/{ticker}/option-chains", licence: "quote", klass: "nightly", maxBytes: 4194304, reads: ["option_symbol", "strike", "expires", "option_type", "open_interest", "implied_volatility", "delta", "gamma"] },
{ id: "atm-chains", path: "/api/stock/{ticker}/atm-chains", licence: "aggregate", klass: "nightly", maxBytes: 65536, reads: ["option_symbol", "expiry", "strike", "option_type", "open_interest", "stock_price", "volume"] },
{ id: "oi-per-expiry", path: "/api/stock/{ticker}/oi-per-expiry", licence: "aggregate", klass: "nightly", maxBytes: 65536, reads: ["date", "expiry", "call_oi", "put_oi"] },
{ id: "volume-oi-expiry", path: "/api/stock/{ticker}/option/volume-oi-expiry", licence: "aggregate", klass: "nightly", maxBytes: 65536, reads: ["expires", "oi", "volume"] },
{ id: "greek-exposure-strike", path: "/api/stock/{ticker}/greek-exposure/strike", licence: "aggregate", klass: "nightly", maxBytes: 262144, reads: ["strike", "call_delta", "put_delta", "call_gex", "put_gex"] },
{ id: "greek-exposure-strike-expiry", path: "/api/stock/{ticker}/greek-exposure/strike-expiry", licence: "aggregate", klass: "nightly", maxBytes: 131072, reads: ["strike", "expiry", "call_delta", "put_delta", "call_gex", "put_gex"] },
{ id: "option-stance", path: "/api/stock/{ticker}/option-stance", licence: "derived", klass: "nightly", maxBytes: 131072, reads: ["as_of_date", "data", "option_symbol", "pop", "delta", "iv", "dte", "fit_score", "expires", "option_type", "strike"] },
{ id: "market-correlations", path: "/api/market/correlations", licence: "derived", klass: "nightly", maxBytes: 65536, reads: ["fst", "snd", "correlation", "rows", "min_date", "max_date"] },
```

`reads: []` for the two unschema'd operations is deliberate: the weekly probe
(`scripts/flows-probe.mjs`) records their wire shape into `scripts/flows-probe-shapes.json`
on its next run, and until it has, the reducers answer `unshaped` (section 4.1). Do not
invent their keys in the registry. `tests/flows-probe-contract.mjs` must accept an entry
with `reads: []` only for an operation whose spec response is `Volatility Result`; add that
rule and a planted entry that breaks it.

Never read: `call_rho`, `put_rho`, `*_theta`, `*_vega`, `*_charm`, `*_vanna` from `greeks`;
`*_charm`, `*_vanna` from either exposure route; `iv_rank`, `rv_high`, `rv_low` from
`vol-stats`; `components`, `explanation`, `roc`, `premium`, `avg_price`, `rank_metric`,
`disclaimer` from `option-stance`. Section 4.3 gives the reason for each, and the leaf's
`WITHHELD` table prints it.

## 3. Files

New:

| path | role |
|---|---|
| `shared/flows-voldesk.js` | Pure leaf. Imports `flows-vendor-core.js` (`unwrap`), `flows-quant-bs.js`, `flows-stats.js`, `flows-calendar.js`, `flows-fixture-names.js` only. Reducers, term state, roll, matrix assembly, character movers, the audit comparisons, tolerances, the stance extract, the payload builders and their byte fitters. |
| `shared/flows-voldesk-copy.js` | Every reader-facing sentence (section 8), a frozen table; imports nothing. |
| `scripts/flows-legs/voldesk.mjs` | The nightly I/O: `runVolAudit(ctx)` and `runVolDesk(ctx)` through `uw()`, the pool and the deadline. |
| `scripts/flows-nightly/sections/voldesk.mjs` | The two sections (`vol-audit`, `voldesk`), layered as every other section: no section imports another. |
| `server/routes/flows-voldesk.js` | `flowsVoldeskRows(deps)`: `GET /api/flows/voldesk`. |
| `assets/js/flows-voldesk.js` | The Market tab's controller, deferred group `voldesk`. |
| `assets/css/flows-voldesk.css` | Its sheet, loaded through `data-css` on the group's first element. |
| `assets/js/flows-ticker-xcheck.js` | The ticker's cross-check strip, deferred group `xcheck`. |
| `tests/gen-voldesk-fixtures.py` | Writes `tests/fixtures-voldesk.json` (section 10.1). |
| `tests/flows-voldesk.mjs` | Class N, the leaf and the leg. |
| `tests/server-voldesk.mjs` | Class N, the route. |
| `tests/flows-voldesk-render.mjs` | Class C, the Market tab. |
| `tests/flows-xcheck-render.mjs` | Class C, the ticker strip. |
| `tests/lib/voldesk-world.mjs` | Builds payloads and serves the market and ticker pages with `page.route`. |
| `tests/suites/{flows-voldesk,server-voldesk,flows-voldesk-render,flows-xcheck-render}.json` | Registry files, each with a `command` and a `shard` pin on the lightest shard. |

Edited (and only these): `shared/flows-vendor-ops.js` (section 2), `shared/flows-products.js`
(two globals), `server/store.js` (`INGEST_VIEW_KEY_RE` gains `^voldesk$|^voldesk-stance$`),
`server/errors.js` (`voldesk_off`), `server/routes/flows-pages.js` (passes `voldesk` to
`marketPage` and `xcheck` to `tickerPage`), `shared/flows-pages.js` (tab, panel, the two
defer declarations), `worker.js` (one router family line and the `voldeskOn` predicate,
modelled on `scenesOn`), `scripts/flows-nightly/stages.mjs` (two stages),
`scripts/flows-nightly/sections/cards.mjs` or the card-x writer (merge the `va` section),
`shared/flows-vendor-extras.js` (`SHED_ORDER` puts `va` first), `scripts/flows-legs/health.mjs`
(`volAuditChecks`, two codes), `shared/flows-glossary.js` (seven lines),
`assets/js/flows-market.js` (tab hook only: hand the payload to `FlowsUI.volDesk.mount`),
`assets/js/flows-ticker-surface.js` (one host element and one `defer("xcheck")` call),
`wrangler.toml` and `wrangler.staging.toml` (switches), `tests/lib/d1-budget.mjs`,
`tests/flows-weight.mjs` (`DEFERRED`), `docs/modules.json`, `assets/version.txt` via
`node scripts/bump-assets.mjs`.

## 4. The leaf: `shared/flows-voldesk.js`

### 4.1 Shape gate for the two unschema'd operations

```js
export const SHAPE = Object.freeze({
  "vix-term": Object.freeze({ root: "object", latest: "data.latest", history: "data.history[]" }),
  "vol-character-top": Object.freeze({ root: "array", rows: "data[]" }),
});
export function shapeKnown(opId, shapes)
```

`shapeKnown` answers `{ ok, keys, why }` from the probe manifest handed in (the leg reads
`scripts/flows-probe-shapes.json`; the leaf reads nothing). It is `ok` only when the
manifest carries the operation path with the set named in `SHAPE`.

- `vix-term`: the curve reducer needs, per point, a maturity date and a price. It looks for
  them by **exact key name** in this order: maturity `expiry`, `expiration`, `settle_date`,
  `date`; price `price`, `close`, `settle`, `last`; spot `vix`, `spot`, `index`. It uses a key
  only if the manifest lists it at that path with type `str#`, `str` (a date can only be a string) or `num`. If a maturity or a
  price key is missing, the result is `{ status: "unshaped", why: "keys" }`. Never fall back
  to a positional read.
- `vol-character-top`: rows use the names the per-ticker `/volatility/character`
  `data.latest` set already shows on the wire: `ticker`, `character`, `half_life_days`,
  `hurst_rv`, `date`. The same rule: a key the manifest does not list at `data[]` for this
  path makes the result `unshaped`.

Until the probe has run, the Vol desk shows both modules in the `unshaped` state
(section 8). That is the honest state, and it is the shipped state.

### 4.2 Number reading

Every numeric field on these routes is a decimal string. Read it with `Number(s)` only
when `/^-?\d+(\.\d+)?(e-?\d+)?$/i` matches. Anything else is `null` with reason
`type:<field>`. A null is never coerced to zero. Integers (`call_oi`, `oi`, `volume`,
`open_interest`, `rows`) must be safe integers ≥ 0, otherwise `type:<field>`.

### 4.3 Units and withheld fields (`WITHHELD`, frozen, printed in the strip's details)

| field | treatment | reason printed |
|---|---|---|
| `greeks.call_delta`, `put_delta` | read; delta is a pure number; refused outside [−1, 1] (`range:delta`) | none |
| `greeks.call_gamma`, `put_gamma` | read, compared only after the unit test (4.6) | "The feed does not state gamma's unit." |
| `greeks.*_volatility`, `option-chains.implied_volatility` | read as an annual fraction; refused outside (0, 5] | none |
| `greeks.*_theta`, `*_vega`, `*_rho`, `*_charm`, `*_vanna` | not read | "The feed does not state the unit." |
| exposure `call_delta`, `put_delta` | read in shares (delta × open interest × shares per contract, the schema's own words) | none |
| exposure `call_gex`, `put_gex` | read, compared only after the unit test | "The feed does not state gamma's unit." |
| exposure `*_charm`, `*_vanna` | not read | "The feed does not state the unit." |
| `vol-stats.iv_rank` | not read | "The feed does not say whether this is a fraction or a percent." |
| `vol-stats.rv_high`, `rv_low` | not read | "The feed describes this as an implied volatility." |
| `vol-stats.iv`, `iv_high`, `iv_low`, `rv` | read as annual fractions | none |
| `vol-realized.*` | read as annual fractions; `realized_volatility` is 21 sessions | none |
| `option-stance.pop`, `delta`, `iv`, `dte`, `fit_score` | stored, never displayed | n/a |
| `market-correlations.correlation` | read as a number in [−1, 1]; refused otherwise (`range:correlation`) | none |

### 4.4 Term structure

```js
export function termState(points)
```

`points`: `[{ dte, iv }]` from the existing `term-structure` operation for SPY, QQQ, IWM,
DIA (the leg reads it for the four funds; do not re-derive from the card). Interpolate
**total variance** `w = iv² · dte/365` linearly in `dte` between the bracketing points;
no extrapolation beyond the first or last point (answer `null` with `edge`).
`iv30`, `iv90` are `sqrt(w / (d/365))` at d = 30 and 90. `slope = iv90 − iv30`, in vol
points (×100). State: `contango` when `slope ≥ +0.50`, `backwardation` when
`slope ≤ −0.50`, `flat` between, `null` when either end is `null`. The thresholds are
`TERM_FLAT_PTS = 0.5` and appear once.

```js
export function futuresCurve(raw, shapes)
```

Returns `{ status, points: [{ expiry, days, price }], spot, front, second, roll30 }`.
`days` are calendar days from the payload's session date (UTC date arithmetic). Points
are sorted by `days`, duplicates by expiry collapse to the later row, non-positive prices
are refused. `roll30 = (second.price / front.price − 1) × 30 / (second.days − front.days)`
as a fraction, only when both exist and `second.days > front.days`; else `null` with
`why`. Its sign is printed with the word for it: positive is "the second month above the
front", never a recommendation.

### 4.5 Implied against realised

`realizedRow(rows, session)` takes the row whose `date` equals the session; with none, the
newest row not after the session, marked `asOf` with its own date and `stale: true` when
it is older than one session (`flows-calendar.js` `sessionsBetween`). `spread = iv − rv`
in vol points. `statsRow` reads `iv`, `iv_high`, `iv_low`, `rv`, and computes
`ivPlace = (iv − iv_low)/(iv_high − iv_low)` only when `iv_high > iv_low`; the page prints
it as "IV at 64% of its 1-year range", never as an IV rank (the site has its own).

### 4.6 The audit comparisons

```js
export const XCHECK_TOL = Object.freeze({
  delta: 0.03, ivPts: 1.5, gammaRel: 0.15, gammaFloor: 1e-4,
  oiRel: 0.01, dexRel: 0.05, gexRel: 0.10, spotRel: 0.0025, unitBand: 1.15,
});
export function chooseExpiry(engineExpiries, session)
export function auditName({ card, chain, greeks, chains, atm, oiExpiry, volOi, exStrike, exStrikeExpiry, session })
```

`chooseExpiry`: the engine expiry (`card.engine.expiries[]`, fitted smile and forward)
whose `dte` is nearest 30 among `dte ≥ 7`; ties to the earlier. No engine expiry: the
name is `notCompared` with `engine`.

Strikes: the five strikes nearest the engine forward `F` that appear in the feed's
`greeks` rows for that expiry with both a call and a put delta. Fewer than three:
per-strike rows `notCompared` with `strikes`.

Engine figures come from the site's own code and nothing new: the smile from
`sliceFromSummary` (`flows-quant-read.js`), `forwardDelta` and the Black-76 gamma in
`flows-quant-bs.js`, the engine's `F`, `T`, discount `D`. The engine's spot gamma per
share per dollar is `D_q · φ(d1) / (S σ √T)` where `D_q = F·D/S`; write it once in the
leaf through `flows-quant-bs.js` (no second normal pdf: `tests/math-duplicates.mjs`
scans for one). The engine's open interest is the sum of `open_interest` over the
`option-contracts` rows the run already read for that expiry (`ctx` holds them; no new
call). If that chain read was truncated (`cut.truncated` or a page refused), the OI rows
are `notCompared` with `partial chain`.

Rows of the result (`va.rows`, fixed order, ids frozen):

| id | engine | feed | gap | agrees when |
|---|---|---|---|---|
| `spot` | card spot | `atm-chains.stock_price` (first row of the expiry) | relative | ≤ `spotRel` |
| `delta` | mean over the strikes of the call forward delta | mean of `greeks.call_delta` | absolute | ≤ `delta` |
| `iv` | mean smile IV at the strikes, out-of-the-money side | mean `call_volatility` for K ≥ F, `put_volatility` for K < F | vol points | ≤ `ivPts` |
| `gamma` | mean spot gamma per share per $1 | mean `call_gamma` | relative, floor `gammaFloor` | ≤ `gammaRel`, only if `unit` is `per$` |
| `oiExpiry` | engine OI on the expiry | `oi-per-expiry` `call_oi + put_oi` for that expiry | relative | ≤ `oiRel` |
| `oiAll` | engine OI over every expiry read | sum of `volume-oi-expiry.oi` | relative | ≤ `oiRel` |
| `dexExpiry` | Σ (Δ_call·OI_call + Δ_put·OI_put)·100 on the expiry, shares | Σ `call_delta + put_delta` of `strike-expiry` | relative to gross | ≤ `dexRel` |
| `gexAll` | Σ Γ·OI·100·S²/100, dollars per 1% move, every expiry | Σ (`call_gex` + `put_gex`) × S²/100 of `greek-exposure/strike` | relative | ≤ `gexRel`, only if `unit` is `per$` |
| `chainSelf` | n/a | `option-chains` per-contract OI against `atm-chains` OI for the same symbols | count of symbols that differ | 0 differ; a feed-against-feed row, labelled so |

Dates: a feed row whose own `date` is not the session is `notCompared` with `date`.

**Gamma unit test.** The schema does not state whether gamma is per $1 or per 1% move.
Compute `r = median(feed gamma / engine gamma)` over the strikes. `unit = "per$"` when
`1/unitBand ≤ r ≤ unitBand`; `unit = "per1%"` when `r` lies within the same band of
`S/100`; otherwise `unit = null`. Only `per$` is compared. `per1%` and `null` make the
gamma rows `notCompared` with `units`, and the strip says which ("The feed's gamma reads
as per 1% move, so it is not compared." / "The feed does not state gamma's unit and its
figures match neither unit."). The test never rescales a number to make it agree.

Each row: `{ id, e, f, gap, tol, v }` with `v` one of `agree`, `differs`, `nc` and, for `nc`,
`why` from the frozen list `engine | strikes | date | partial chain | units | absent |
type:<field> | range:<field> | failed | plan | limited`. `e` or `f` null never yields
`agree` or `differs`.

Name verdict `va.v`: `differs` when any row differs, else `agree` when at least three rows
were compared, else `nc` (`few`). `va.n = { agree, differs, nc }`.

### 4.7 Correlation matrix

```js
export const CORR_TICKERS = Object.freeze(["SPY", "QQQ", "IWM", "DIA", "XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLB", "XLU", "XLRE"]);
export const CORR_WINDOWS = Object.freeze(["3M", "1Y"]);
export function corrMatrix(rows, tickers)
```

One call per window with `tickers` the fifteen joined by commas and `interval` the window.
Assemble an upper-triangle array of `n(n−1)/2` cells in row-major order. The feed returns
both orders of a pair; if the two values differ by more than `1e-9` the cell is `null` with
`asym`; one present is used. A missing pair is `null` with `absent`. The diagonal is not
stored. Keep per cell `[r, rows]` and per window `{ minDate, maxDate }` from the most
common pair (ties to the earliest). Sector average: the mean of the 55 sector-ETF pairs
that are present, with `n` present; printed only with `n ≥ 40`, else a dash with
"Too few pairs".

Beside it, when the `dispersion` payload exists, print the site's own Nasdaq-100 implied
and realised correlation with their dates, labelled as the site's. Never subtract one from
the other: the baskets differ.

### 4.8 Character movers

`characterMovers(today, prev)`: `today` the two reduced lists (sort `half_life` asc,
`hurst` desc, limit 50 each); `prev` the previous night's lists from the prior `voldesk`
payload. A row is a mover when its `character` label changed or
`|ln(half_life_today / half_life_prev)| ≥ ln(1.3)`. Rank movers by that absolute log
ratio, label changes first. Keep at most 12. A name absent from `prev` is `new`, never a
mover. With no `prev`, `movers` is `null` with `first`.

### 4.9 Stance extract (never displayed)

`stanceExtract(raw, ticker, session)`: rows with `dte ≤ 14`, top 3 by `fit_score`, each
`[option_symbol, pop, delta, iv, dte, fit_score]`, numbers rounded to 4 decimals. The
store is a ring of the last 14 sessions inside one key (section 5.3).

### 4.10 Fixture refusal

Every builder runs `fixtureNameIn` over its output and throws on a fixture name unless it
is handed `{ test: true }`; the leg passes it only in the dry run. This mirrors the door.

## 5. Payloads

### 5.1 `voldesk` (nightly global, cap 64 KiB, `fitVoldesk` sheds in order: `character.prev`, `matrix.1Y`, `history` of the futures curve)

```text
{ v: 1, session: "YYYY-MM-DD", generatedAt: ISO, fixture?: true,
  term: { status, why?, funds: { SPY: { status, why?, points: [[dte, iv]], iv30, iv90, slope, state, asOf } , QQQ, IWM, DIA },
          futures: { status: ok|unshaped|plan|failed|absent, why?, points: [[expiry, days, price]], spot, roll30, asOf } },
  ivrv: { SPY: { status, why?, iv, rv, spread, asOf, stale, stats: { iv, ivHigh, ivLow, rv, ivPlace } }, QQQ, IWM, DIA },
  matrix: { tickers: [...15], "3M": { status, why?, cells: [[r|null, rows|null, why?]], minDate, maxDate, sectorAvg, sectorN },
            "1Y": { ... } },
  site: { implied, realized21, realized63, asOf } | null,
  character: { status, why?, meanRev: [[t, label, halfLife, hurst]], persistent: [...], movers: [[t, label, prevLabel, halfLife, prevHalfLife, kind]] | null, moversWhy?, prev: { meanRev, persistent } },
  audit: { names, compared, agree, differs, nc, worst: [[t, rowId, gap]] (≤ 8), calls },
  basis: { ops: { "<op id>": { status, n, why? } } } }
```

### 5.2 `va` section of `card-x:<T>` (budget 2 KiB; `SHED_ORDER` sheds it first)

```text
va: { at: ISO, rv: 1, session, expiry, dte, F, unit: "per$"|"per1%"|null,
      v: agree|differs|nc, why?, n: { agree, differs, nc },
      rows: [[id, e, f, gap, tol, v, why?]],
      strikes: [[K, eDelta, fDelta, eIv, fIv, eGamma, fGamma]] (≤ 5) }
```

A name not audited tonight keeps its previous `va` if `sessionsBetween(va.session,
session) ≤ 5`; older it is dropped and the strip says "Not audited in the last five
sessions." The audit runs on a rotation (5.4).

### 5.3 `voldesk-stance` (nightly global, cap 96 KiB, no read route ever)

`{ v: 1, ring: [{ session, rows: { T: [[...6]] } }] }`, newest first, at most 14 sessions;
`fitStance` drops the oldest session until it fits. `tests/server-voldesk.mjs` and
`tests/flows-reads-contract.mjs` assert no route returns it; `tests/flows-voldesk.mjs`
scans `assets/js` and `shared/flows-pages.js` for the string `voldesk-stance` and for
`fit_score` and `pop` reads and fails on any.

### 5.4 The audit rotation

Audited every night: SPY, QQQ, IWM, DIA. Then up to `VOLAUDIT_CAP = 36` carded names
(`FLOWS_VOLAUDIT_CAP`, 0..120), never-audited first by liquidity, then the oldest
`va.session`. No separate ledger is stored: the leg reads each name's
prior `card-x` `va.session` from the card-x rows the run already reads. A name whose chain
read failed tonight is skipped and counted.

Calls: 8 a name (`greeks`, `option-chains`, `atm-chains`, `oi-per-expiry`,
`volume-oi-expiry`, `greek-exposure-strike`, `greek-exposure-strike-expiry`,
`option-stance` with `stance=sell_premium&limit=20`), so at most 320; plus 17 market-level
calls (term-structure ×4, realized ×4, stats ×4, vix-term 1, character-top 2,
correlations 2). Add `CALL_COST.voldesk` and hold it in `tests/flows-vendor-budget.mjs`
and `BUDGETS.voldesk` in the registry. Status filing as the extras leg: 429 limited, 401,
402, 403, 404, 422 plan (stored, not asked again for 7 sessions), else failed.

### 5.5 Registry and budget

`shared/flows-products.js`: `voldesk` and `voldesk-stance` as globals (level nightly,
executor actions, byte caps 65536 and 98304, due 120 minutes after the close, volatile
stamps `generatedAt`). `tests/lib/d1-budget.mjs`: the nightly writer `+2` rows written;
reader: the route reads one row (`voldesk`). `flows-d1-budget` must price the new
statement.

## 6. Pipeline

`scripts/flows-nightly/stages.mjs`:

```js
stage("vol-audit", ISOLATION.isolated, ["dossiers"]),           // after "dossiers", before "focus"
stage("voldesk", ISOLATION.isolated, ["compute"], ["voldesk", "voldesk-stance"]),  // after "oracle-publish"
```

`vol-audit` puts `ctx.volAudit = Map<T, va>` and `ctx.stance`; the existing `card-x`
stage merges `va` into the one card-x write it already makes (no second write).
`voldesk` builds both payloads and publishes them; `meta.volaudit` gets the summary
`{ names, compared, agree, differs, nc, shape: { "<op>": { n, bad } }, calls }`.
`FLOWS_VOLDESK_BUILD=off` skips both stages (records `skip`), the card-x bytes equal the
off run, and the golden emit is unchanged byte for byte for every other key. The dry run
uses fixture-generated bodies through the existing fake vendor (add the thirteen
operations to `scripts/flows-legs/fake-vendor.mjs`, built from `tests/fixtures-voldesk.json`).
Regenerate `tests/fixtures-pipeline-golden.json` with `--write` in the same commit and read
the diff: only `voldesk`, `voldesk-stance`, `meta` and `card-x:*` may move.

Health (`scripts/flows-legs/health.mjs`):

```js
export function volAuditChecks(volaudit, standing)
```

- `volaudit-gap`: share `differs / (agree + differs)` over compared rows. Above 0.10 warn;
  above 0.25 fail, but only with seven clean nights behind it and no failure the night
  before (the `extrasStanding` rule), otherwise warn. Under 50 compared rows: a note.
- `volaudit-shape`: an operation whose reducer failed (`type:`, `range:`, `unshaped`
  excluded) on more than 20% of at least 20 attempts: warn.
- Add both to `HEALTH_CODES`.

## 7. Worker

`server/routes/flows-voldesk.js`:

```js
export function flowsVoldeskRows({ store, ensureFlowsTables, isOwner, nightlyFreshHeaders, recallLastGood })
```

One row: `{ id: "voldesk", path: "/api/flows/voldesk", methods: ["GET"], auth: "flows" }`.
Order: method (router), session (router), then the switch: `FLOWS_VOLDESK` `on` admits
every member, `owner` admits `isOwner`, anything else is `404 voldesk_off` for everyone
(a non-owner under `owner` gets the same 404, so the switch's existence is not leaked).
Then one `store.read("voldesk")`; absent is `200 { status: "pending", why: "not_published" }`
with `X-Fresh-State: pending`; an unreadable store serves the last good copy
(`recallLastGood`, `X-Fresh-Reason: store`) or `503 store_quota`. Rows read: 1.
`?part=` is refused with `400 invalid_part`. Add `voldesk_off` to `server/errors.js`
(`[404, "Not found"]`).

`worker.js`: `voldeskOn(env, username)` exactly like `scenesOn`, reading `FLOWS_VOLDESK`;
pass it to `flowsPageRows` and add the family to the router. `tests/flows-reads-contract.mjs`
gains the ceiling (1 row).

## 8. Copy (`shared/flows-voldesk-copy.js`; ≤ 14 words a sentence; no forecast, advice, "tape", "vendor" or provider name)

```text
title.tab            Vol desk
title.term           Index term structure
title.ivrv           Implied against realised
title.matrix         Correlation
title.character      Volatility character
title.xcheck         Engine cross-check
state.contango       Contango: 90-day implied above 30-day.
state.backwardation  Backwardation: 30-day implied above 90-day.
state.flat           Flat: 30-day and 90-day implied within half a point.
futures.unshaped     The feed's futures table has not been read by the shape probe yet.
futures.plan         The futures table needs a feed plan the site does not hold.
futures.roll         Second month {sign}{x}% against the front, per 30 days.
ivrv.line            Implied {iv}, realised over 21 sessions {rv}, spread {sign}{s} points.
ivrv.place           Implied at {p}% of its 1-year range.
ivrv.stale           Realised as of {date}, the feed's latest.
matrix.cell          {a} and {b}: {r} over {rows} sessions, {from} to {to}.
matrix.asym          The feed gave two values for this pair, so it is withheld.
matrix.absent        The feed returned no value for this pair.
matrix.avg           Sector ETF average {r} over {n} pairs.
matrix.site          Site's Nasdaq-100 implied correlation {i}, realised {r}; different baskets.
character.first      Movers start after the second night this table is read.
character.unshaped   The feed's character table has not been read by the shape probe yet.
character.def        Half-life: sessions for a volatility shock to halve.
character.hurst      Hurst above 0.5 persists; below 0.5 reverts.
xcheck.what          The feed's own figures, checked against the site's engine.
xcheck.agree         Agrees within tolerance on {n} checks.
xcheck.differs       Differs on {n} of {m} checks.
xcheck.nc            Not compared: {reason}.
xcheck.units.1pct    The feed's gamma reads as per 1% move, so it is not compared.
xcheck.units.none    The feed does not state gamma's unit; its figures match neither.
xcheck.stale         Last audited {date}; names rotate through the audit.
xcheck.never         Not audited in the last five sessions.
xcheck.convention    Delta conventions can differ by the dividend discount; tolerance covers it.
xcheck.self          Feed against feed: its chain and its at-the-money table.
state.pending        Tonight's run has not published this yet.
state.failed         The feed's {what} read failed tonight; this is not an empty table.
```

Every sentence passes `tests/flows-guard-lexicon.mjs`'s forecast lexicon and
`tests/lib/copy-lint.mjs`. Dealer exposure wording uses "on the feed's convention (dealers
long calls, short puts)". (The existing Surface tab's clause still says "vendor's"; that is
outside this package; leave it.)

Glossary (`shared/flows-glossary.js`, each the exact string the information button
opens): Contango, Backwardation, Roll per 30 days, Implied against realised, Correlation
window, Volatility half-life, Engine cross-check.

## 9. Switches

| name | values | shipped (`wrangler.toml`) | staging | effect |
|---|---|---|---|---|
| `FLOWS_VOLDESK` | `on`, `owner`, else off | `owner` | `on` | Market tab, `/api/flows/voldesk`, ticker strip |
| `FLOWS_VOLDESK_BUILD` | `off`, else on (pipeline env, set in the nightly workflow) | on | n/a | the two stages |
| `FLOWS_VOLAUDIT_CAP` | 0..120 (pipeline) | 36 | n/a | audit rotation size |

Off means byte-for-byte the current pages: `marketPage` without `voldesk` emits no tab, no
panel and no defer element; `tickerPage` without `xcheck` emits no host and no defer
element. `tests/server-pages.mjs` holds both directions.

## 10. Tests

### 10.1 Fixtures: `tests/gen-voldesk-fixtures.py`

Writes `tests/fixtures-voldesk.json` with `provenance: { generator, sha256 of itself,
spec sha256, shapes sha256, nature: "synthetic, written from the schema; not feed data" }`.

- Schema'd operations: every key and JSON type from the 200 schema; string numerics as
  strings; the generator exits 1 on any key the observed manifest set lists differently.
- `vix-term`, `vol-character-top`: two variants each. `conjectured` uses the key names of
  section 4.1 and is fed to the leaf with a **synthetic shapes manifest** that lists them;
  `unseen` is fed with the real manifest (no entry), and must reduce to `unshaped`.
- Tickers: fixture names (`SYX101`…) for audit names; real symbols only for SPY, QQQ, IWM,
  DIA and the eleven XL funds, which the code keys on; their figures invented.
- Worlds: `agree` (feed figures derived from the engine with noise inside tolerance),
  `differs` (delta +0.05, OI −3%), `per1pct` (feed gamma × S/100), `nounit` (gamma × 7),
  `dateoff` (feed date one session back), `asym` (pair values disagree), `truncated chain`,
  `plan` (402 for vix-term), `failed` (500 for greeks).

### 10.2 `tests/flows-voldesk.mjs` (N)

Holds: number reading (decimal strings, `"NaN"`, `""`, `"1e-3"`, a number), every
`WITHHELD` row printed and never read (recording `Proxy` over the raw rows, as
`flows-dossier-contract` does), `termState` against an independent total-variance
interpolation at 400 random curves and the three state boundaries at ±0.4999/0.5/0.5001,
`futuresCurve` and `roll30` worked by hand (equal days refused), `corrMatrix` symmetry,
`asym`, absent pairs, sector average count gate at 39/40, `characterMovers` at the 1.3
boundary both sides, `auditName` on every world with every row's verdict, the unit test at
r = 1.149, 1.151, S/100 × 1.149, the tolerance of each row from both sides, `chooseExpiry`
ties, `stanceExtract` (`dte` 14 kept, 15 dropped), the byte fitters at the caps, the
fixture refusal, the never-displayed scan, the call budget (8 a name, 17 market, cap
clamped to 0..120), the build switch off leaving the dry emit unchanged, and the health
checks at 0.10/0.25 with and without standing.

Planted wrong builds (via `tests/truth/mutants.mjs`, exact-once transforms; each must fail
its named check):

1. interpolate IV instead of total variance;
2. extrapolate past the last term point;
3. `TERM_FLAT_PTS` read as 0.05;
4. roll without the 30/Δdays scaling;
5. a missing correlation pair written as 0;
6. `asym` resolved by averaging;
7. diagonal stored and counted in the sector average;
8. sector average printed under 40 pairs;
9. character mover on a new name;
10. gamma rescaled by S/100 to make it agree;
11. gamma compared with `unit` null;
12. delta tolerance compared on the signed gap only;
13. engine OI from a truncated chain compared;
14. a feed row from another date compared;
15. `nc` counted as `agree` in the name verdict;
16. the verdict `agree` with fewer than three compared rows;
17. `iv_rank` read and served;
18. `rv_high` read and served;
19. `option-stance` rows copied into `voldesk`;
20. the unschema'd reducer reading a key the manifest does not list;
21. a null decimal string read as 0;
22. stance ring keeping a contract with `dte` 15;
23. health failing at 0.25 without standing;
24. fixture names allowed outside the test flag.

### 10.3 `tests/server-voldesk.mjs` (N)

The row over the router with a fake store: the switch `on`, `owner` (owner, member),
`off`, unset, `ON `, mistyped; 405 before 401; 404 `voldesk_off` body identical for
anonymous member and non-owner; absent payload `pending`; store refusal with and without a
last good copy; rows read 1; `?part=` 400; `voldesk-stance` never served by any path in
the route table (enumerate them). Planted: switch read after the store, owner gate
inverted, stance key readable, `?part` ignored.

### 10.4 `tests/flows-voldesk-render.mjs` (C, `page.route`, no server)

Serves `marketPage({ voldesk: true })` with the market fixtures and a built `voldesk`
payload; opens `#view=voldesk`. At 1920x1080, 1440x820, 1024x768, 390x844: no page
scroll, no inner scroll except the Show all dialog, nothing clipped (`flows-layout-sweep`
rules), every module in its grid area to 1 px; term lines against an independent scale,
end labels never overlapping (`labelProblems`), state chip word and glyph; matrix cell
colour from the token ramp and printed value equal to the payload rounded half up to 2
decimals, `null` cells hatched with no number, the readout sentence on hover and on
keyboard focus, arrow keys, Home, End, Escape; character lists fitted with Show all; every
state of section 11.3 rendered from its fixture; axe clean; forced colors; reduced motion;
44 px targets on a coarse pointer; TRT only (no `ET`, `EST`, `UTC` in text). Planted
(served-copy mutations): a null cell drawn as 0.00; a term line drawn on an IV not
interpolated in variance; the futures module showing a curve while `unshaped`; the tab
emitted with the switch off; the matrix drawing the diagonal as data; colour-only state chip;
a sentence over 14 words; "vendor" in served text.

### 10.5 `tests/flows-xcheck-render.mjs` (C)

The ticker page against the dry emit's card and a card-x carrying each `va` world: strip
figures against the payload; verdict glyph and word; `nc` reasons; the units sentences;
the stale and never states; the 390 dialog (focus trap, Escape, focus return); the strip
never covers the surface's controls (`elementFromPoint` at their centres); no new request
(the strip reads the card-x the page already has; assert the request list). Planted: `nc`
drawn as agree; gap printed without its sign; a stale `va` shown as tonight's; a dialog
without focus return; a fetch added.

### 10.6 Existing suites to extend or regenerate

`flows-probe-contract` (13 entries, the `reads: []` rule), `flows-registry-contract`,
`flows-vendor-budget`, `flows-d1-budget`, `flows-reads-contract`, `flows-legs-contract`
(stage table), `flows-pipeline-contract` and `pipeline` (golden `--write`), `server-pages`,
`route-matrix` (`--write` in its own commit with no code change), `flows-weight`
(`DEFERRED.market` gains `voldesk`, `DEFERRED.ticker` gains `xcheck`), `flows-public`
(glossary), `flows-copy-lint`, `flows-guard-lexicon`, `flows-market-onescreen` (the new
tab in its sweep), `flows-layout-sweep`, `docs` (regenerate with `node scripts/gen-docs.mjs`),
`contracts` (asset bump). Run `node run.mjs --affected-list` and then
`node scripts/prepush.mjs`; both must be green before the push.

## 11. UI design

### 11.1 Market: the Vol desk tab

`MARKET_TABS(scenes, voldesk)` inserts `["voldesk", "Vol desk"]` after `["indices",
"Indices"]` when `voldesk` is true. The panel:

```html
<div class="mk-panel" role="tabpanel" id="mkP-voldesk" aria-labelledby="mkT-voldesk" data-panel="voldesk" inert>
  marketModule("mkVdTermCard", "Index term structure", "mkVdTerm", { seg: <div class="mk-segc" id="mkVdTermSeg"></div> })
  marketModule("mkVdIvrvCard", "Implied against realised", "mkVdIvrv")
  marketModule("mkVdCorrCard", "Correlation", "mkVdCorr", { seg: <div class="mk-segc" id="mkVdCorrSeg"></div> })
  marketModule("mkVdCharCard", "Volatility character", "mkVdChar")
  <i hidden data-defer="voldesk" data-src="${v("/assets/js/flows-voldesk.js")}" data-css="${v("/assets/css/flows-voldesk.css")}"></i>
</div>
```

`flows-market.js` calls `FlowsUI.defer("voldesk", { when: "visible", el: #mkVdTermCard })`
when the tab is first opened and then `FlowsUI.volDesk.mount(hosts, payload)` with one
`GET /api/flows/voldesk` (no poll; nightly data). `FlowsUI.volDesk` is a property of the
existing global (`mount`, `model`, `of`); no new global.

Grid (`.mk-stage[data-view="voldesk"] .mk-panel`), template areas:

| size | columns | areas |
|---|---|---|
| 1920x1080 | `5fr 4fr 3fr` | `"term corr char" "ivrv corr char"`, rows `3fr 2fr` |
| 1440x820 | `6fr 5fr` | `"term corr" "ivrv char"`, rows `3fr 2fr` |
| 1024x768 | `1fr 1fr` | `"term corr" "ivrv char"`, rows `1fr 1fr`; matrix cells drop their printed value under 26 px and rely on the readout |
| 390x844 (below 900 px) | one module at a time through the existing `#mkSub` switch: Term, Implied vs realised, Correlation, Character | the module fills the stage |

Gap `var(--sp-3)`, module surfaces the existing `.ui-mod` glass; nothing new in
elevation. Every size: no page scroll; the existing fitter trims list rows and adds Show
all in the module header.

**Term module.** Segmented control (`FlowsUI.segmented`): `Index funds` | `Futures`.
- Index funds: one SVG chart; x = days to expiry on a square-root scale 0 to 400 with
  ticks 7, 30, 60, 90, 180, 365; y = implied volatility in percent, nice ticks. Four series
  with token and marker so colour is never alone: SPY `--label-1` solid with circles, QQQ
  `--accent-ink` solid with squares, IWM `--vol-5` dashed `4 3` with triangles, DIA
  `--label-3` dotted `1 3` with diamonds; markers at each published point, direct end
  labels placed by the clustering rule `flows-ticker-glance.js` uses (labels stack a label
  height apart). Vertical guides at 30 and 90 days in `--label-4`. Header line: a state chip
  for SPY (`.ds-` state chip: glyph ▲ contango, ▼ backwardation, ■ flat, plus the word)
  and `30d 14.2% · 90d 16.0% · slope +1.8 pts`. A readout row under the chart names the
  hovered or focused point: "QQQ, 62 days: 18.4% implied."
- Futures: when `ok`, the curve as points joined by a line (`--accent-ink`), spot as a
  horizontal `--label-3` dashed line labelled "Index level", roll sentence under it. When
  not `ok`, `UI.silent` with the state's sentence and nothing drawn.

**Implied against realised.** Four rows (SPY, QQQ, IWM, DIA), each 44 px tall: ticker, a
horizontal range bar of the 1-year IV low to high (`--seq-2` track) with a tick at IV
(`--label-1`) and a hollow ring at RV (`--label-2`), then `IV 14.2% · RV 11.0% · +3.2 pts`.
A row missing any figure shows the dash and its reason in place of that figure only.

**Correlation.** Segmented `3M` | `1Y`. A 15×15 lower-triangle heatmap in SVG: cell fill
`--seq-1..5` by r in five bands of 0.2 from 0 to 1, negative r hatched (`--label-3`
pattern `defs` outside the panel) with the minus printed; `null` cells empty with a
dashed `--label-4` outline; diagonal cells blank and labelled "self" for assistive tech.
Row and column labels (tickers) on the left and bottom; a 1 px `--label-4` divider after
DIA separates funds from sector ETFs. Printed r with two decimals when the cell is ≥ 26
px. Readout line under the matrix (role `status`, polite): the `matrix.cell` sentence for
the focused cell, at rest the strongest off-diagonal pair. Foot: `matrix.avg` and, when
present, `matrix.site`, plus the window's dates in TRT-free date form (dates are dates).
Keyboard: the matrix is one tab stop (`role="grid"`, cells `role="gridcell"`, roving
`tabindex`), arrows move within the lower triangle, Home and End go to the row ends,
Escape returns to rest. A "Table" button opens a dialog with the full table (the
accessible twin).

**Volatility character.** Two compact lists side by side (one above the other under 520 px
of module width): "Reverting fastest" (shortest half-life) and "Most persistent" (highest
Hurst), each row `ticker · label · half-life 3.1 sessions · Hurst 0.42`, rows link to the
ticker page. A third block "Changed since last session" lists movers with `prev → now`
label or half-life ratio. Fitter trims and adds Show all. Real symbols only; nothing from
the stance store.

### 11.2 Ticker: the Engine cross-check strip

Inside the Surface & terrain tab, below the scene and above its dock: a host
`<div class="ftxc" id="ftXcheck" hidden>` added by `flows-ticker-surface.js` only when the
page was rendered with `xcheck` (a `data-xcheck` attribute on `#ftSurface`), and the
deferred group `xcheck` asked for when the tab opens. It reads `card-x.va` the page
already holds; no request.

- ≥ 1024 px: a 112 px strip. Left: title "Engine cross-check", the verdict chip (✓ Agrees,
  ✕ Differs, – Not compared, each glyph plus word, `--up-mark`/`--down-mark`/`--label-3`
  only as secondary tint), and `xcheck.stale` when the `va` session is not the card's.
  Right: a compact table, two columns of four rows (Spot, Delta, IV, Gamma | OI expiry, OI
  all, Delta exposure, Gamma exposure): each cell `Engine 0.512 · Feed 0.498 · gap −0.014`
  and a glyph. A "Details" button opens a dialog with the per-strike table (strike, engine
  and feed delta, IV, gamma), the `chainSelf` row, the tolerance of every row, the
  `WITHHELD` list with reasons, the convention sentence and the expiry checked.
- 390 px: no strip; a 44 px button in the tab header "Cross-check · ✓ Agrees" opens the
  same dialog as a bottom sheet (70 dvh), focus trapped, Escape and the scrim close it and
  return focus to the button.
- Absent `va`: the strip shows `xcheck.never` and nothing else.

Numbers: delta three decimals, IV one decimal percent, gamma four significant figures,
OI integer with thin grouping, exposure through `F.money` / `F.num` with U+2212 minus,
gap signed. All through `FlowsUI.F` (no local rounding: `tests/math-format.mjs` ratchets
local rounding sites).

### 11.3 States (each module and the strip)

| state | when | drawn |
|---|---|---|
| loading | request in flight | the module's skeleton with reserved height |
| pending | route `pending` / payload missing a part | `state.pending` |
| unshaped | 4.1 | the module's `unshaped` sentence, no chart |
| plan | 402/403 filed as plan | `futures.plan` |
| failed | the operation failed tonight | `state.failed` with the operation's plain name |
| stale | payload session behind the last close by one session | data drawn, the stale pill with the payload's date |
| expired | two or more sessions behind | `UI.silent` withheld, no figures |
| off | switch off | the tab does not exist |
| ok | — | as above |

### 11.4 Tokens and accessibility

Only existing tokens (`--label-1..4`, `--accent-ink`, `--vol-5`, `--seq-1..5`,
`--up-mark`, `--down-mark`, `--mat-*`); no colour literal in CSS or JS (scanned). Text at
4.5:1 over the composited glass (`tests/flows-glass-render.mjs` rules). Focus ring the
system's. Every chart has a hidden description and a table twin. No animation except the
existing segmented knob; nothing runs at rest (paint census zero). Times printed as
`HH:MM TRT` (generatedAt), dates as dates.

## 12. Order of work for the implementer

1. Registry entries and the probe contract rule; fixtures generator and fixtures.
2. The leaf and `tests/flows-voldesk.mjs` with all 24 planted builds failing as named.
3. Leg, sections, stages, card-x merge, health; dry emit and golden regeneration.
4. Store grammar, products, route, errors, Worker wiring, `tests/server-voldesk.mjs`,
   reads ceiling, d1 budget.
5. Page wiring, controller, sheet, ticker strip; render suites; visual inspection at the
   four sizes with screenshots saved under the scratchpad (not committed).
6. Glossary, copy lint, weight, docs, asset bump, `node scripts/prepush.mjs`, commit,
   push the branch, do not merge.
