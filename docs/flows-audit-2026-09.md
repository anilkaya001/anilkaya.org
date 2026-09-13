# Flows — integrity audit and implementation-ready proposal

**Scope.** `anilkaya.org/flows` — Overview, Market, Unusual, Political, Side,
the per-ticker reader, the strategy desk and `/flows/ask/`.
**Date of evidence.** 2026-09-13, against branch
`claude/unusual-whales-options-signals-9r4mkw` and the live `iewt` D1 store.
**Status.** Audit and proposal. **No production change, merge or deploy is
part of this document.** Every code reference is a citation, not a patch.

Each claim below is labelled:

- **[O]** observation — something I read out of the source or the store
- **[C]** confirmed cause — a chain traced end to end, with the numbers
- **[H]** hypothesis — consistent with the evidence, not yet proven
- **[J]** design judgment — my opinion, arguable

---

## 1. Executive assessment

The section's engineering discipline is unusually high: three-armed silences,
refusal to let two different absences share a sentence, byte-exact weight
ceilings, a payload/renderer shape contract. That discipline is aimed almost
entirely at **presentation honesty** — whether a sentence is allowed to be
written — and almost not at all at **input integrity** — whether the numbers
entering that sentence mean what their names say.

The result is a section that is scrupulously careful about how it says things
that are, in several measured cases, wrong.

### The five highest-impact fixes, in order

| # | Fix | Why first |
|---|---|---|
| 1 | **De-duplicate the OHLC series to one bar per session** | It is the root of three separate defects (candles, realized vol, the price disagreement) and it corrupts a *scored* feature. See §2.1. |
| 2 | **Stop rendering the seasonality feed as twelve months** | The chart labels twelve *instruments* as Jan–Dec. It is the only surface currently showing a reader a fabricated axis. See §2.2. |
| 3 | **Rename `vrp`, or compute the thing it is named after** | `iv30 − rv30` is a vol-point spread, not a variance risk premium — and with fix 1 outstanding it is biased high by construction. See §2.3. |
| 4 | **Publish a card for every enriched name** | 163 of 213 stored cards are stale, up to 19 days; `enrich()` already computes what the other 97 names need and discards it. Fix is on the branch. See §2.4. |
| 5 | **Validate one signal end to end before adding a sixth** | Nothing in the repo currently answers "has this ever worked". §6 specifies the harness. |

Fixes 1–3 are integrity repairs and must land before any interface work: a
consolidated, beautiful reader over a mislabelled axis is worse than the
current one, because it is more persuasive.

---

## 2. Section-by-section audit

### 2.1 The candle series is not daily — and it corrupts a scored feature

**[O]** `scripts/flows-pipeline.mjs:1488` requests
`/api/stock/{t}/ohlc/1d` with `timeframe: "1Y"`.
`candlesAscending()` (`:1662`) sorts by `Date.parse(start_time || end_time ||
date)` and `:1826` keeps `.slice(-252)`.

**[C] This affects every carded name — zero exceptions.** Across all 50
carded names in the live store, **not one** has `rows == distinct dates`:

| metric | value |
|---|---|
| names surveyed | 50 |
| names with a clean daily series | **0** |
| rows-per-session, min / mean / max | 2.377 / 2.917 / 3.000 |
| distinct sessions retained, min / max | 84 / 106 |

The mean of 2.917 and a ceiling of exactly 3.000 are consistent with three
snapshots per session. And because the 252-row cap is spent on duplicates,
**no name in the store holds more than 106 sessions** — every "1Y" chart in
the section is showing about five months.

The vendor does not return one row per session. ROST's stored card
(`card:ROST`, `$.panels.context.candles`) holds **252 rows over 92 distinct
dates — 2.739 rows per session.** The duplicates are not identical rows; they
are progressive intraday snapshots of the same date:

| date | closes | volumes |
|---|---|---|
| 2026-05-04 | 230.49 / 226.02 / 226.02 | 6,361 / 442,349 / 2,341,823 |
| 2026-08-20 | 230.33 / **248.75** / 228.99 | 6,900 / 2,648,942 / 6,306,524 |

6,361 shares is not a daily volume. The 248.75 print on 08-20 is a mid-session
snapshot sitting in an array the whole section treats as settled daily closes.

**Consequences, each measured:**

1. **The "1Y" chart is 4–5 months, board-wide.** The 252-row cap is consumed
   by duplicates: 84–106 sessions retained across all 50 names (ROST: 92,
   2026-05-01 → 2026-09-11).
2. **Realized vol is understated by 2.34×.** `shared/flows-features.js`
   `realizedVol(closes, {window})` takes the last `window` **array elements**,
   not sessions. `scripts/flows-pipeline.mjs:1712` calls it with
   `{window: 21}`. On ROST's real series that window spans **9 sessions, not
   21**, and the returns inside it are sub-daily but annualised by √252:

   ```
   SHIPPED  rv30 (21 bars of a 2.74x series, ppy 252) = 12.23%
   CORRECT  rv30 (21 true sessions,          ppy 252) = 28.62%
   understated by 2.340x -> 16.39 vol points
   ```
3. **`vrp` is therefore biased systematically high** by ~16 vol points on this
   name. `:1792` computes `vrp: iv30 - rv30`. A feature that is wrong in a
   *known direction* is worse than a noisy one: it will look like signal.
4. **The pipeline's own comment is false.** `:1786` states rv30 is
   "close-to-close realized vol over the same 30 sessions" and that "both are
   annualized vols … over the same horizon." Neither half holds.
5. **[C] The price disagreement (previously logged as a separate defect) is
   this same defect.** ROST's series ends `2026-09-11:231.9` then
   `2026-09-11:230.74`. The ticker reader takes the last element; the desk and
   strategy paths take the other. Two readers, one date, two prices, no bug in
   either reader.

**Fix.** De-duplicate by date in `candlesAscending()`, keeping the
highest-volume row per date (the settled bar), *before* the `.slice(-252)`.
Then `realizedVol`'s window is sessions again and `slice(-252)` means a year.
This is one function, and it repairs items 1–5 together.

**Acceptance:** for every carded name, `new Set(candles.map(c => c.d)).size ===
candles.length`; ROST's rv30 reads ≈28.6%, not ≈12.2%; the reader's spot and
the desk's spot agree to the cent.

### 2.2 Seasonality renders twelve instruments as twelve months

**[C]** Root-caused decisively. `scripts/flows-pipeline.mjs:7809` calls
`/api/seasonality/market` with no params. The stored payload records its own
arithmetic:

```
"seen": 168, "cap": 12, "shed": 156
```

168 = **14 instruments × 12 months**. The feed is per-ticker-per-month.
`shapeSeasonality` (`shared/flows-pulse.js:278`) sorts by `month` and takes the
first 12 — which are twelve *different instruments'* January rows. All twelve
stored rows carry `"month": 1`; their `years` values are the discriminator:
`19, 19, 19, 18, 7, 18, 18, 18, 18, 18, 10, 18` — 7 and 10 are young ETFs, not
months of a calendar.

`assets/js/flows-market.js:1777` then renders `MONTH_ABBR[r.month - 1]`, so the
chart draws twelve bars all labelled Jan, or (depending on the caller's index)
a Jan–Dec axis over data that has no month dimension at all.

**Neither the shaper nor the renderer is at fault** — both read the vendor
field faithfully. The defect is that the instrument identity is discarded at
ingest and a per-ticker cross-section is stored under a name that promises a
time series.

**Fix (two options, `[J]` I prefer the first):**
- **(a)** Keep the ticker field, filter to the index the section already
  benchmarks against, and request all twelve months for that one name. The
  chart then means what its axis says.
- **(b)** If the endpoint cannot be asked per-month, retitle the surface to
  what it is — "this month, across the majors" — and label bars by ticker.

**Acceptance:** no surface renders a month label for a row whose month field is
constant across the set; a contract test asserts
`new Set(rows.map(r => r.month)).size === rows.length` for any month-axis chart.

### 2.3 `vrp` is a misnomer

**[C]** `shared/flows-card.js:~636` documents `iv30 − rv30` as "the variance
risk premium". A variance risk premium is `IV² − RV²`. What is computed is a
**volatility spread** in vol points. Independent of §2.1, the name promises a
quantity in variance units and delivers one in vol units — and the two rank
names differently whenever the vol level varies across the board, which it does.

**Fix.** `[J]` Rename the field `ivRvSpread` and say "vol points" in the
reading. Renaming is honest and free; switching to true variance units changes
every downstream rank and needs §6's validation harness first.

### 2.4 Coverage: 163 of 213 stored cards are stale

**[C]** D1 shows 213 `card:*` rows, 50 carrying candles for the current
session, 163 stale by up to 19 days. `/api/flows/meta` reports
`enriched: 147`. Only the 50 board names get a card written; `enrich()`
computes candles and GARCH for all 147 and discards ~97.

**Status: fixed on the branch.** The cross-section card lane writes those names
at **zero additional vendor calls**, and widens `indexMarketCross` membership to
`cardedTickers` so `marketRank` does not tell a cross-section name it "did not
place" when it did. Dry run: `cross-section cards: 50/50 built — 100 name(s)
now carry a card for this session`. Cross-section cards carry
`depth: "cross-section"` and null vendor-only panels with an `unfetched` reason,
so a thin card is never mistaken for a quiet one.

### 2.5 Findings that did NOT reproduce

Reported earlier in this workstream; re-checked against current `main` and
**refuted**. Recording them so they are not re-fixed:

- **[O] "The dated expiry retry never tries `dailyDate`, so it is a no-op
  pre-open."** `worker.js:2548` reads `const asOf = tapeDay || dailyDate` and
  throws if both are absent, so the retry at `:2592` does get a date pre-open.
  The retry is sound as written.
- **[O] "Contract identity is ambiguous."** Every consumer keys on the OCC
  `option_symbol` through the one parser in `shared/flows-premium.js:73`
  (`worker.js:2715`, `flows-card.js:2009`, `flows-chain.js:560/923`,
  `flows-pulse.js:171`, `flows-stock.js:139`, `flows-unusual.js:162`). One
  parser, one identity. No divergence found.
- **[O] `/api/shorts/AAPL/volume-and-ratio` is hard-coded** — this is a
  deliberate, documented one-call shape probe (`:8311-8322`), not a leaked
  constant.

### 2.6 Open items carried forward (reported, not actioned)

| Item | Evidence | Owner's call? |
|---|---|---|
| `/flows/ask/` footer always empty | `flows-ask.js:1403` reads `brief.notes`; `buildBrief` returns only `{today, yesterday, next}`; live brief row has `has_notes: 0` | Yes — needs authored caveats |
| Neuron block prints a time with the date dropped | `flows-pages.js:457`; `readFlowsSummary` has no age bound | No — bug |
| `flows-political.js` drops `X-Payload-Updated` | no payload-age check on that route | No — bug |
| Per-ticker AI summary does not exist | `flows_ai_summary` is keyed on scope; every read/write hard-binds `"board"` | Yes — build it (worker + cron, zero client bytes) or retitle the card |
| Strategy: no payoff row above the highest strike | `flows-strategy.js` | No — bug |
| Strategy: plot note blames absent greeks when the cause is a one-sided quote leaving `markValue()` null | — | No — wrong diagnosis shown to reader |

---

## 3. Issue matrix

| ID | Issue | Evidence | Impact | Pri | Depends on | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| I-1 | OHLC series carries ~2.9 rows/session | 50/50 names contaminated; ratio 2.377–3.000 | Corrupts charts, rv30, vrp, spot agreement | **P0** | — | `scripts/flows-pipeline.mjs:1662,1826` | one row per date, all cards |
| I-2 | `realizedVol` windows bars, not sessions | 21-bar window spans 9 sessions | rv30 understated 2.34× | **P0** | I-1 | `shared/flows-features.js` | ROST rv30 ≈28.6% |
| I-3 | `vrp` biased high; name wrong | §2.1, §2.3 | A feature that looks like signal | **P0** | I-2 | `flows-pipeline.mjs:1792`, `flows-card.js:636` | renamed + unbiased |
| I-4 | Seasonality axis fabricated | `seen:168 cap:12 shed:156`; all `month:1` | Reader shown a false axis | **P0** | — | `flows-pulse.js:278`, `flows-market.js:1777` | month labels only over a real month axis |
| I-5 | Two readers, one date, two prices | ROST `09-11: 231.9` and `230.74` | Cross-surface contradiction | **P0** | I-1 | resolved by I-1 | spot agrees to the cent |
| I-6 | 163/213 cards stale | D1 census | Reader sees 19-day-old data | **P1** | — | pipeline card lane | every enriched name carded today |
| I-7 | Ask-page caveat footer always empty | `flows-ask.js:1403` | Served, styled, never filled | **P1** | owner decision | `shared/flows-brief.js` | footer filled or removed |
| I-8 | Neuron timestamp drops the date | `flows-pages.js:457` | "15:16 UTC" could be any day | **P1** | — | `flows-pages.js` | date shown; age-bounded |
| I-9 | Political route ignores payload age | no `X-Payload-Updated` read | Stale data with no staleness mark | **P1** | — | `assets/js/flows-political.js` | age check, four silences |
| I-10 | No signal validation exists anywhere | repo-wide | Cannot answer "has this worked" | **P1** | I-1..I-3 | new `scripts/` harness | §6 |
| I-11 | Per-ticker AI summary card titled for data that doesn't exist | `flows_ai_summary` scope-bound to `"board"` | Card promises what it cannot deliver | **P2** | owner decision | `worker.js`, cron | built or retitled |
| I-12 | Strategy payoff table truncated at top strike | — | Reader can't see the capped region | **P2** | — | `flows-strategy.js` | row above highest strike |
| I-13 | Strategy plot note misattributes the cause | one-sided quote → `markValue()` null | Wrong explanation shown | **P2** | — | `flows-strategy.js` | note names the real cause |

---

## 4. Information architecture

`[J]` throughout this section.

### The problem the current IA has

The reader is organised by **data source** (a panel per endpoint family) rather
than by **the question a reader arrives with**. The four silences make each
panel individually honest, but a reader scanning nineteen panels cannot tell
which three matter today. `.ft-station-lead` was designed for exactly this and
is the right mechanism; it is a coverage line, not a summary.

### Overview — desktop

```
┌──────────────────────────────────────────────────────────────┐
│ SESSION LINE  2026-09-11 · 147 enriched · 100 carded · 18:59 │ ← one row, always
├──────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────┐ ┌───────────────────────────┐ │
│ │ THE THREE THINGS           │ │ NEURON                    │ │
│ │ 1. <lead, with a digit>    │ │ written 2026-09-11 15:16  │ │ ← date restored (I-8)
│ │ 2. <lead, with a digit>    │ │ <summary, word-animated>  │ │
│ │ 3. <lead, with a digit>    │ │ [ ask about this ▸ ]      │ │ ← hands off to the dock
│ └────────────────────────────┘ └───────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ BOARD  50 names · sortable · each row carries its own silence │
├──────────────────────────────────────────────────────────────┤
│ CROSS-SECTION  97 further names, thinner cards, marked so     │ ← new, from §2.4
└──────────────────────────────────────────────────────────────┘
```

The "three things" are not new prose. They are the three station leads with the
largest magnitude, **moved** (not copied) out of their panels — the mechanism
the codebase already uses for `.ft-panel-one`: a reading is written once.

### Ticker reader — desktop

Five stations, each with one coverage line above its panels:

```
IDENTITY   ticker · spot · session · depth badge (board | cross-section)
CONTEXT    candles · levels · GARCH · realized vol      [lead: N of 4 read]
FLOW       tape · alerts · net premium · dark pool      [lead: N of 4 read]
SURFACE    IV · skew · term structure · gamma           [lead: N of 4 read]
POSITION   OI change · max pain · greeks · congress     [lead: N of 4 read]
```

The depth badge is load-bearing: a cross-section card is thin *by design*, and
without the badge its nulls read as failures.

### Ticker reader — mobile (~400px)

Stations collapse to accordions, closed except IDENTITY and the station whose
lead carries the largest magnitude. Panels inside a station are one column.
Charts get `overflow-x: auto` on their own container; nothing else scrolls
sideways.

### Contract → scenario flow

Today this is a jump between two mental models (a chain row, then a payoff
plot). Proposed as one continuous move:

```
chain row  ──click──▶  contract header pinned
                       ├ quote: bid/ask/mark, and WHICH of the three is
                       │        missing when mark is null  (fixes I-13)
                       ├ payoff plot, x-range spanning ALL strikes (I-12)
                       └ scenario strip: spot −2σ … +2σ using the CORRECTED
                                          rv30 (so it needs I-2 first)
```

The scenario strip is the reason I-2 is P0 and not P1: a σ that is 2.34× too
small draws a scenario band a reader would size a position against.

---

## 5. Vendor endpoint → decision inventory

Twenty-six distinct paths are called. Grouped by what they are allowed to
decide:

**Per-name, decision-bearing (12):** `ohlc/1d`, `option-contracts`,
`greek-exposure/expiry`, `greek-flow`, `spot-exposures/strike`,
`spot-exposures/expiry-strike`, `volatility/term-structure`, `iv-rank`,
`max-pain`, `oi-change`, `net-prem-ticks`, `darkpool/{t}`.

**Market-wide, context-bearing (9):** `market/market-tide`,
`market/total-options-volume`, `market/oi-change`, `market/top-net-impact`,
`market/insider-buy-sells`, `market/sector-etfs`, `darkpool/recent`,
`news/headlines`, `screener/stocks`.

**Disclosure (3):** `congress/recent-trades`,
`politician-portfolios/holders/{t}`, `option-trades/flow-alerts`.

**Mislabelled (1):** `seasonality/market` — see I-4. It is a per-ticker
cross-section being read as a time series.

**Probe (1):** `shorts/AAPL/volume-and-ratio` — deliberate, bounded.

### Coverage-recovery plan

1. **Recover what is already paid for.** `enrich()` computes candles and GARCH
   for 147 names and publishes 50. Landed on branch: +97 names, **0 calls**.
2. **Recover what is fetched and discarded.** `ivStrip`
   (`shared/flows-card.js:525-527`) — one series of four points, `−1m −1w −1d
   now` — is published and read by no renderer (grep finds it only in
   `shared/`, `scripts/`, `tests/`). That is a free volatility-context lead.
3. **Fix before extending.** `seasonality/market` is the only endpoint whose
   *meaning* is wrong; asking it correctly costs at most one call.
4. **Only then add.** `shorts/{t}/volume-and-ratio` per name is the highest-value
   unadded feed, and the probe already exists to tell you whether it returns.

`[J]` No new endpoint should be added until I-1 through I-4 are closed. Adding
breadth over a corrupted base multiplies the surface area of the same lie.

---

## 6. Signal-validation specification

Nothing in the repo answers "has this feature ever predicted anything." That is
the single largest gap, and it is why I-3 matters: without it there is no way to
notice that a feature is biased.

**Harness** (`scripts/flows-validate.mjs`, offline, reads D1 only):

1. **Panel.** Every `card:{t}` row carries `sessionDate`. Snapshot the feature
   vector `{score, vrp, ivRank, gammaFlip, netPremium, oiDelta, …}` per name per
   session into a `flows_feature_history` table. **This must start now** — the
   store keeps only the latest card, so history that is not captured is gone.
2. **Forward return.** For horizons h ∈ {1, 5, 21} sessions, from the
   **de-duplicated** close series (I-1), compute `r_{t,t+h}`.
3. **Metric.** Per feature, per horizon: rank IC (Spearman) across the
   cross-section each session; report the mean IC, its t-statistic with a
   Newey–West correction at lag h−1, and the hit rate of the top decile.
4. **Null.** Shuffle the name labels within each session 1,000 times. A feature
   whose IC does not clear the 95th percentile of that null **does not get a
   reading on the page** — it gets a silence, which the codebase already knows
   how to draw.
5. **Publication rule.** A feature's panel prints its own IC and sample size
   next to the reading. `[J]` This is the strongest honesty mechanism available
   and it costs one line per panel.

**Acceptance:** the harness runs on stored history alone, emits a table of
(feature, horizon, IC, t, n), and at least one currently-displayed feature is
demonstrated to fail it — if none fails, the null is wrong.

---

## 7. Staged roadmap

### Stage A — integrity repairs (no visual change)
- I-1 de-duplicate OHLC by date, highest volume wins
- I-2 window `realizedVol` by sessions, assert it
- I-3 rename `vrp` → `ivRvSpread`, correct the two false comment sentences
- I-4 seasonality: fix the request or retitle the surface
- I-5 falls out of I-1; assert spot agreement across reader/desk/strategy
- Start the feature-history capture (§6.1) — **day one, it is lossy otherwise**

Nothing ships to the reader in Stage A except corrected numbers.

### Stage B — interface consolidation
- Session line, the three-things block, station coverage leads
- Depth badge for cross-section cards
- I-8 date on the Neuron stamp; I-9 payload age on Political
- Mobile accordions

### Stage C — connected features
- Contract → scenario flow (needs I-2)
- I-12, I-13 strategy fixes
- `ivStrip` promoted to a volatility-context lead
- I-11 per-ticker summary, or the retitle
- §6 IC readings published beside each feature

---

## 8. First release — bounded, with rollback

**Contents:** I-1 and I-2 only. One function changed
(`candlesAscending` in `scripts/flows-pipeline.mjs`), one function changed
(`realizedVol` in `shared/flows-features.js`), plus their assertions.

**Why this boundary:** it is the smallest change that repairs five defects, it
touches no renderer, it adds zero client bytes (so no weight ceiling moves and
no asset-version bump is required), and its effect is fully observable in the
next pipeline run's emitted payloads.

**Verification before push:**
1. `node tests/flows-pipeline-contract.mjs`
2. `node tests/flows-weight.mjs` and `node tests/contracts.mjs`
3. Dry run the pipeline; assert `candles.length === distinct dates` for all cards
4. Recompute ROST rv30 from the emitted payload; expect ≈28.6%, not ≈12.2%
5. Assert reader spot === desk spot === strategy spot for ten names

**Observability:** the run log prints, per name, `candles: N rows / N dates`
and the rv30 before/after. A ratio above 1.0 anywhere is a failure, not a note.

**Rollback:** revert the single commit. The change is confined to ingest; no
schema migration, no stored-payload shape change (the array is the same shape,
shorter), no client asset. A reverted run republishes the previous shape on its
next cron wake with no manual step.

**Explicitly out of scope for this release:** I-3's rename (it changes a field
name that renderers read), I-4 (it needs an endpoint decision), and everything
in Stages B and C.

---

## 9. Self-review — where this document is weakest

- **[H]** The "highest volume wins" de-duplication rule is inferred from the
  volume ladder in ROST's series (6k / 442k / 2.3M). It fits every date I
  checked in that one name. The *presence* of duplication is now confirmed
  board-wide (50/50), but the tie-break rule itself is still evidenced from one
  name and should be confirmed against two or three more before implementation.
- **[H]** The seasonality fix option (a) assumes the endpoint accepts a month or
  ticker parameter. The vendor MCP server returned HTTP 403 in this session, so
  the parameter surface was not confirmed from the vendor's own schema. Option
  (b) — retitle — needs no such assumption and is the safe fallback.
- **[O]** The 2.34× realized-vol figure is one name on one day. The *direction*
  and *mechanism* are certain, and the contamination is now surveyed and
  universal (50/50, ratio 2.377–3.000), but I did not recompute rv30 for each
  name — so the per-name magnitude of the vol understatement is still a single
  measurement generalised by argument rather than by census.
- **[J]** §4's IA is my judgment and has not been put in front of a user.
- Three defects in §2.6 are reported but untraced to a line; they are listed as
  carried-forward items, not as confirmed causes.
