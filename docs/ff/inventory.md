# Fire & Forget: Phase 0 data inventory

Read on 2026-10-26 from the repository at the commit this file ships in and from a dry-run emit of the nightly (`FLOWS_DRY_NOW=2026-08-24T21:45:00Z`, 438 invented names). Nothing here called the vendor. A figure the dry run could not show was read from the builder that writes it.

The rule that decides what ships: evaluation reads only what the pipeline already holds. A template whose current value is not in the pipeline is **hidden**. A template whose current value is held and whose history will exist once one column is added is **warming**: it is registered, shown on the Wires page with `— baseline 0/20 sessions`, and a member cannot save a clause on it. A template that sees only part of the universe is **limited** and says so on its preview line. Everything else is **available**. The verdict of a template is the worst verdict among its metrics, and `tests/ff-contract.mjs` holds this file equal to the registry in `shared/ff-contract.js`.

## What the pipeline holds, and for how long

| Store | Key or table | Names | Sessions kept | What it carries that Fire & Forget can use |
|---|---|---|---|---|
| Nightly per-name history | `hist:<T>` | every carded name of the board, focus, deep and cross tiers (about 850 after the deepening rotation; index and fund tiers have no `hist`) | up to 252, trimmed from the oldest in steps of 21 to stay under 16 KiB | `np` net call minus net put premium (usd), `bb` bullish minus bearish premium (usd), `vol` call plus put contracts, `pc` put volume over call volume (a volume ratio), `oi` contracts, `gex`, `nope` |
| Nightly per-name detail | `card-x:<T>` | the same carded names | the latest session, plus series inside it | `earnings` (next date, `confirmed`, sessions to report, up to 12 past reports with expected move, 1d and 1w move), `skew` (`rr25`, `rr10` and a dated series of about 150 sessions, sign put minus call), `term` (event implied move and its mean absolute form), `ivDyn` (volatility of volatility in decimal vol, no raw series), `volume` (z and percentile over 252 sessions, not robust over 20), `alerts` (the name's flagged windows) |
| Nightly per-name card | `card:<T>` | the same carded names | latest | `panels.oiDeltas` (the vendor's ten largest open-interest changes: `prevOi`, `currOi`, volume, `avgPx`), levels, gamma grid by strike and expiry, `pricedMove`, and the `engine` block with `facts` such as `iv.cm.30` and `skew.rr25.30` (sign call minus put) |
| Nightly universe | `universe` | about 850 | latest only, overwritten, no dated archive | `iv30`, `iv30p` (the vendor's previous-day 30-day IV), `dIv1d` (the change, decimal vol), `ivp`, `ts`, `tilt`, `ed` (sessions to earnings), `im5`, `im30` |
| Nightly flagged windows | `flowalerts` | the vendor's flagged list at the close | latest only | per window: `t`, `oc` (OCC symbol), `cp`, `k`, `exp`, `prem`, `askPrem`, `bidPrem`, `sweep`, `opening`, `oi`, `voi`, `px` |
| Nightly sector snapshots | `sector:premium`, `regime.sectors` | eleven sector ETFs | latest only | bullish, bearish, call and put premium, volume per ETF (a single day: not used) |
| Live strips | `live:strips` | about 160 (focus, board and watch) | the current session | `px`, cumulative `ncp`, `npp`, `net` (the same quantity as `hist` `np`), `cp`, `pp` (total call and put premium), `cv`, `pv`, `iv30`, `ivRank` |
| Live flagged windows | `live:alerts` | the vendor's flagged windows | the current session's record, 180 rows retained | as `flowalerts`, with `spanStart` and `spanEnd` |
| Live heartbeat | `live:heartbeat`, `flows_clock`, `flows_ledger` | the loops themselves | seven ledger days | the evidence behind the health states |
| Dated archives | `board:long:<date>`, `board:short:<date>`, `scores:<date>`, `ideas:<date>` | boards only | by date | nothing Fire & Forget reads |

Facts that bound the design:

1. **There is no archive of intraday blocks.** Nothing stores a quantity at 5-minute resolution beyond the current session's `live:*` keys, which are overwritten. Detectors that need a 60-session null of 5-minute blocks cannot arm in version 1. Daily nulls exist: 252 sessions of `np`, `bb`, `vol`, `pc`, `oi`, and about 150 of `rr25`. `ff_arch` starts the intraday archive (28 rows a session) so a later version can arm them.
2. **`card-x` `volume` z is not Fire & Forget's z.** It is a mean and standard deviation over up to 252 sessions with a minimum of 60. The wire's robust z (median and 1.4826 times MAD over the 20 sessions before the current one, with a floor) is computed afresh from `hist` by the nightly leg.
3. **Put premium is not stored, but the vendor row that feeds `hist` carries it.** The `options-volume` row has `call_premium` and `put_premium` beside the fields `hist` keeps (checked against `docs/uw-openapi.yaml`, schema `Ticker Options Volume`). Adding `cp` and `pp` columns to `hist` gives T04 252 sessions of backfill on the first run; until that change lands T04 is warming.
4. **Covered-call yield and Win % are not stored.** The Premium Desk computes them on demand from a chain read that costs a vendor call. The engine stores a few top structures only, and `covered-call` is a family it may not rank.
5. **Per-strike open-interest contract counts are not stored.** The `surface.oi` grid is dealer gamma exposure by strike and expiry, which is a different quantity.
6. **A flagged window is the vendor's selection.** Absence from the list is not evidence of quiet. Every wire that reads it says so.
7. **Live z forms do not exist in version 1.** A cumulative `live:strips` value against a full-day baseline pushes z toward zero early in the day and intraday flow is U-shaped, so scaling by elapsed time does not repair it. `z20` and `zvov` are nightly only; a live wire is a fact over level or event metrics.
8. **`card-x` `earnings.next` is an estimate until `confirmed` is true.** `earn.confirmed` carries that flag so T01 can require it.

## Metric inventory

Ids are permanent. "Names" is the coverage of the current value; "history" is what a baseline can be built from on day one.

| Metric id | Quantity | Source (key, path) | Names | History on day one | Cadence | Status |
|---|---|---|---|---|---|---|
| `flow.net_premium` | net call minus net put premium, usd | nightly `hist:<T>` `volume.np`; live `live:strips` `rows[T].net` | nightly all carded; live about 160 | 252 sessions | nightly, live | available |
| `flow.net_premium.z20` | robust z of net premium against the 20 prior sessions, floor $100,000 | `hist:<T>` `volume.np` | all carded | 252 sessions | nightly | available |
| `flow.volume.z20` | robust z of option volume, floor 500 contracts or 10% of the median | `hist:<T>` `volume.vol` | all carded | 252 sessions | nightly | available |
| `flow.pc_volume.z20` | robust z of the put to call volume ratio in log space, floor 0.10; unknown under 100 contracts on either side | `hist:<T>` `volume.pc`, `volume.vol` | all carded | 252 sessions | nightly | available |
| `flow.put_premium` | total put premium, usd | live `live:strips` `rows[T].pp`; nightly `hist:<T>` `volume.pp` (not yet kept) | live about 160 | none stored | nightly, live | warming |
| `flow.put_premium.z20` | robust z of put premium | `hist:<T>` `volume.pp` (not yet kept) | all carded | none stored | nightly | warming |
| `flow.pc_premium.z20` | robust z of the put to call premium ratio in log space | `hist:<T>` `volume.pp`, `volume.cp` (not yet kept) | all carded | none stored | nightly | warming |
| `earn.sessions` | sessions to the next report | `universe` `ed` | 223 of 438 in the dry run | not needed | nightly | available |
| `earn.confirmed` | the report date is confirmed by the company | `card-x:<T>` `earnings.next.confirmed` | carded | not needed | nightly | available |
| `earn.clear_10` | no report due within 10 sessions; 1 for a name that never reports, unknown for a company with no calendar date | `universe` `ed` and the tier | all | not needed | nightly | available |
| `earn.implied_ratio` | implied mean absolute move over the mean absolute 1d move of the last 8 reports; at least 6 reports | `card-x:<T>` `term.eventMove.meanAbs`, `earnings.events` | carded with a report in the horizon | up to 12 reports | nightly | available |
| `vol.iv.30d.chg1d` | one-day change of 30-day implied volatility, vol points | `universe` `dIv1d` | 430 of 438 | the vendor's lags only | nightly | available |
| `vol.iv.30d.zvov` | the day's change over the volatility of daily changes, floor 0.5 vol point | `universe` `dIv1d` over `card-x:<T>` `ivDyn.volOfVol` | carded | about 247 changes | nightly | available |
| `vol.rr25.30d` | 25-delta call minus put implied volatility, 30 days, vol points | `card:<T>` `engine.facts` `skew.rr25.30` | carded and priced | about 150 sessions | nightly | limited |
| `vol.rr25.30d.x0` | call minus put crossed above zero tonight from a value of at most minus 0.5 point | `card-x:<T>` `skew.series.rr25` with the sign inverted | carded | about 150 sessions | nightly | limited |
| `contract.premium` | premium of one flagged window, usd | `live:alerts` and `flowalerts` rows `prem` | flagged windows only | the session's record | live, nightly | available |
| `contract.dte` | calendar days from the window's date to expiry | rows `exp` and `spanStart` | flagged windows only | not needed | live, nightly | available |
| `contract.otm_pct` | distance out of the money as percent of the underlying price at the window, positive means out of the money | rows `k`, `cp`, `px` | flagged windows only | not needed | live, nightly | available |
| `contract.vol_oi` | contract volume over open interest | rows `voi` | flagged windows only | not needed | live, nightly | available |
| `contract.oi_confirm` | share of a flagged opening window that appears in the next night's open interest | `ff-carry` windows against `card:<T>` `panels.oiDeltas.rows` | the ten largest open-interest changes of each carded name | not needed | nightly | limited |
| `sector.net_premium.z20` | robust z of the sum of net premium over a sector's carded constituents, floor $1,000,000; at least 10 constituents | `hist:<T>` `volume.np` summed by sector | 7 to 11 sectors | 252 sessions | nightly | available |
| `sector.breadth_pos` | share of the sector's carded constituents with positive net premium | `hist:<T>` `volume.np` | 7 to 11 sectors | 252 sessions | nightly | available |
| `desk.yield_cc` | annualised premium yield of the best 30 to 45 day call with delta at most 0.30 | the Premium Desk, on demand | none stored | none | nightly | hidden |
| `desk.win_cc` | risk-neutral Win % of that call | the Premium Desk, on demand | none stored | none | nightly | hidden |
| `oi.strike_share` | open interest at one strike within 2% of spot over front-month open interest | not stored | none | none | nightly | hidden |

## Templates: what ships

| Template | Title | Requires | Cadence | Verdict | Reason or limit |
|---|---|---|---|---|---|
| T01 | Earnings run-up | `flow.net_premium.z20`, `earn.confirmed`, `earn.sessions` | nightly | available | Baseline from `hist` on day one. The live form of the original template is removed: a cumulative intraday value is not comparable with a full-day baseline. |
| T02 | Opening confirmed | `contract.vol_oi`, `contract.premium`, `contract.oi_confirm` | nightly | limited | Reads the vendor's ten largest open-interest changes of each carded name; the preview says "reads each name's ten largest open-interest changes". Confirmation crosses two nights through `ff-carry`; absence is unobservable, never a refutation. |
| T03 | Short-dated OTM aggression | `contract.dte`, `contract.otm_pct`, `contract.premium`, `contract.vol_oi` | live, with a nightly catch-up | available | Flagged windows only; the receipt says so and adds "record truncated" when `live:alerts` is at its 180-row cap. |
| T04 | Hedge demand on my names | `flow.put_premium.z20`, `flow.pc_premium.z20`, `flow.put_premium` | nightly | warming | Waits for the `cp` and `pp` columns of `hist`. The wire reads `— baseline 0/20 sessions`; the leg change is one column and gives 252 sessions of backfill. |
| T05 | Vol break without a catalyst | `vol.iv.30d.chg1d`, `vol.iv.30d.zvov`, `earn.clear_10` | nightly | available | Names with a report inside 10 sessions are excluded and listed; the z clause reads carded names only. |
| T06 | Upside skew flip | `vol.rr25.30d.x0` | nightly | limited | Carded and priced names only. The sign is inverted from the stored put-minus-call series and a 0.5 vol point band stops oscillation near zero from firing. |
| T07 | Implied move vs history | `earn.implied_ratio` | nightly | available | Two house wires, above 1.5 and below 0.7, because the grammar has no or. Fewer than 6 past reports is unknown with the count. |
| T08 | Sector premium surge with breadth | `sector.net_premium.z20`, `sector.breadth_pos` | nightly | available | Built from the carded constituents of each sector, the same set tonight and in the baseline. Net premium is calls minus puts; the original wording said net call premium, which `hist` does not keep. |
| T09 | Overwrite window | `desk.yield_cc`, `desk.win_cc` | none | hidden | The Premium Desk's yield and Win % are computed on demand from a chain read; no second definition is allowed and nothing is stored per name. |
| T10 | Pin into expiry | `oi.strike_share` | none | hidden | Per-strike open-interest counts are not stored; the gamma grid is a different quantity. |

Five templates are available (T01, T03, T05, T07, T08), two are limited (T02, T06), one is warming (T04) and two are hidden (T09, T10). The ten ids stay reserved.

## What would unlock the warming and hidden templates

| Template | Change | Where it belongs |
|---|---|---|
| T04 | `hist` gains `cp` and `pp` columns from the `options-volume` row; the metrics move to ready in registry version 2 | a flow-leg change in `scripts/flows-legs/flow.mjs` and `shared/flows-positioning.js`, lane G, after version 1 lands |
| T09 | A nightly stage that runs the Premium Desk's own `shortCallLine` over the chain the nightly already holds for deep names and stores its yield and Win % per name | after version 1; it must import the Premium Desk's functions |
| T10 | A nightly product with per-strike open interest for the front monthly expiry | after version 1 |
| Intraday anomaly detectors | 60 sessions of the `ff_arch` archive, then a null at the cadence the data arrives (about 15 minutes) | after version 1 |
