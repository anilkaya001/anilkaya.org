# Oracle: the Neuron's always-on view of each name

The server lane. It stores one deterministic record for every carded name each night, serves it through one read route, and ships the pure leaves the client lane derives its live layer from. It makes no vendor call and no model call.

## The record

Key `oracle:<TICKER>` (a name-keyed product beside `card`, `card-x` and `hist`, kept out of `NAME_KINDS` and `INGEST_LIST_KINDS`: the ingest listing stops at 2,000 rows and the three listed kinds already take about 2,600 for a full rotation, so a fourth would truncate the ledger's view; the door grammar and the product registry accept it), written by the nightly compute stage, at most 6,144 bytes, `v: 1`. The field list is the specification's section 1.2 with these decisions:

- `sessionDate` repeats `session`, because the ingest door and the payload contract read `sessionDate` for every name key.
- `modelImplied` (the fixed footer) and `line` (the one sentence for the state) are added at the top level so the client prints them without a table lookup.
- `calls[i].lossUnbounded`, `calls[i].event` and `calls[i].maxGain` are added; `bid`, `ask` and `spreadPct` are present and null when the engine's leg does not carry them.

## Where a call comes from

A call is built from the options engine's published single-leg structures (`long-call`, `long-put`, `short-put`). Nothing is re-priced:

- `marketIv` is the leg's own implied volatility from its mid quote.
- The engine's `ev.edge` is the real-world law's discounted expectation minus the smile-implied price, per contract, for the position. A position with a positive edge is the engine saying the option is mispriced in the holder's favour: a long with a positive edge is `cheap`, a short with a positive edge is `rich`. A negative edge is no call, because the opposite position is not a structure the engine published.
- `fairIv` is the volatility at which Black-76 on the expiry's forward gives the fair price, where fair = model price + side x edge / 100 per share.
- `ev`, `pop`, `breakeven` and the loss bounds are the structure's own (`ev.p`, `prob.popP`, `breakevens`, `maxLoss`). They are never filled from another structure.

Pre-registered bars, all required: `|edgeVol| >= 2.0` vol points, edge `>= $15` a contract, edge over spread cost `>= 1.5` where the spread cost is `(ask - bid) x 100 / 2`; the slice must be `svi` (not repaired, not absent) with its butterfly check not failed; grade `>= 2`; `dte >= 14`; a two-sided quote with mid `>= 0.05`, spread under half the mid, and open interest or volume `>= 10`. At most two expiries and three calls, ranked by dollar edge.

Honest limit: the card carries the smile's parameters and each published leg's quote, not the whole chain's bid and ask. A call can therefore only come from a strike the engine already priced as a structure. The realised-law blend named in the specification is the engine's real-world law itself, which is what `ev.edge` already uses.

## States

`calm`, `building`, `signal`, `conflict`, `stale`, judged at write time and re-judged at read time (`staleView`): one session behind is `stale/behind1` with grades capped at 1, two or more is `stale/expired` with no calls. A priced name with calls but a stance under conviction 2 stays `calm` and shows its calls; the specification's `signal` needs conviction 2 or more.

## Norms

`oracle-norm` is its own nightly global (the `regime` payload has no spare room, and the specification names this fallback). It holds `[windows, premiumMedian, premiumP90, sizeMedian, sizeP90, day]` per name over a 40-session decaying window, folded from the `flowalerts` rows of the session. The medians and 90th percentiles of two days are blended by window count, which is an approximation of the pooled quantile, not the quantile. A name with under 20 windows has `context.norm: null` and the withheld reason `null`; the live detectors are then silent for it.

## Live detectors

`shared/flows-oracle-live.js` is the client's detector set (surge, repeat, flip, cluster, sweeps, size, sector). `detect(state, rows, contexts, nowMs, { openMs, closeMs, fresh })` takes `contexts` as a map from ticker to the record's `context` and returns the new messages; `state.more` counts the quiet ones held back by the cap and `state.silent` names the names skipped for a thin norm. It is silent outside the regular session, in the first 20 minutes, on a stale feed, for a name with under five windows and without a norm. The surge bar follows the specification literally (`max(3 x premiumP90 x 30/390, $500k)`); for most names the $500k floor sets it, which is a known weakness to retune once real norms exist. The sector message is ranked above the name messages so the cap does not hide it.

## Route

`GET /api/flows/oracle?t=<T>`, `?ts=A,B,...` (up to 12) and `?top=1`, behind the Flows session. `FLOWS_ORACLE` is `on`, `owner` or off; anything else fails closed as the 404 `oracle_off`, and a member is told nothing when it is staged for the owner. Row cost: one primary-key read for a name, one `IN` statement for a batch, one read for `top`. A refused store gives the last good copy, else a 200 with `why: "store"` (a batch likewise); `top` gives the standard 503.

## Not built in this lane

The optional model wording (`FLOWS_ORACLE_AI`, the `oracle` broker surface and `flows-oracle-ai.js`) is not built: the deterministic wording passes every guard on its own, and the cap and the broker's outcome tables stay untouched. A settlement ledger for shown calls (`oracle-out:<date>`) is the follow-up the footer's "no track record yet" refers to.
