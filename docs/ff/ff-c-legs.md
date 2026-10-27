# Fire & Forget lane C: the legs and the evaluator

Lane C is the part that feeds the engine and runs it inside Cloudflare. The nightly leg is member-free: it computes metric values and the hist-backed z from what the pipeline already holds and posts two payloads. The Worker-side evaluator reads them, calls lane A's engine and writes through lane B's store. Neither calls the vendor or a model.

## Files

| File | What it is |
|---|---|
| `scripts/flows-legs/ff-metrics.mjs` | `buildMetrics`: the `ff-metrics` payload (names, integer columns at the metric's step, baseline counts, floored indices, reasons by run, the sector block, the confirmed carry) and `requestRun`, the one `fetch` of the leg (a bearer POST that never follows a redirect). |
| `scripts/flows-legs/ff-carry.mjs` | The `ff-carry` payload (the session's opening windows, at most 180, largest premium first) and `resolveCarried`, which picks the windows of the previous session to confirm tonight. |
| `scripts/flows-nightly/sections/ff.mjs` | The `ff` stage: publishes the two payloads, then asks `/api/ff/run` for the night. `FF_NIGHTLY=off` skips it. A failed request never fails the night; the housekeeping gap check flags a night that never ran. |
| `server/ff-eval.js` | `createEvaluator({ store, flowsStore })`: `nightly`, `live` and `gap`. |

## Payload shapes

`ff-metrics.cols[id]` is an array aligned with `t`, integers at the metric's step, trailing nulls trimmed. `n[id]` is the baseline count, `f[id]` the indices where the floor was the scale (a list, not a 0 or 1 per name), `why[id][reason]` the indices, as runs of three or more `[from, to]`, a reason `missing` being the absence of one. `sectors` holds the same for the sector metrics beside `names`, `of` (the sector index of each name) and `members`. `windows.carry` is the confirmed block: the previous session's windows with `oic`, the share of the window that appears in tonight's open interest change, as an integer ratio.

Reasons are honest: `stale` (the source is not tonight's), `warming` (under 15 baseline sessions), `thin` (under 100 contracts on a side, or no spread), `not_carded` (the name has no hist or card-x), `sector_coverage` (under 10 constituents with 18 of the last 20 sessions), `short_history`. A value is never zero for want of one.

## The evaluator

`nightly(env, { session })` claims `nightly:<session>` (a lease, three attempts), seeds the house wires once, reads `ff-metrics` and `flowalerts`, builds the lane A snapshot, hands the engine the armed wires, the state rows, the session's stored hit keys, the first looks and the caps used, and writes hits, then state, then receipts, all fenced by the run's attempt token. A receipt counts the hits the store accepted; a refused hit is counted as capped. A payload that is missing is `source_missing` and one from another session `source_stale`, as a receipt with no hit.

Tonight's windows come from `flowalerts` (premium, days to expiry from the session, out of the money from strike and underlying, volume over open interest). Last night's windows come from the confirmed carry and carry only premium, volume over open interest and the confirmation, so a hit on them is about confirmation and never repeats last night's live firing; a window whose next-day open interest is not among the vendor's ten largest changes is unobservable and never a refusal.

`live(env, { alerts })` runs a tick on `live:alerts` only inside the regular session. `gap(env)` is the housekeeping check: after the nightly deadline with no done run it writes `not_evaluated` receipts (`run_late`, or `run_failed`) for every armed nightly wire, which a late run upgrades.

Switches: `FF_MODE` first (`on`, `shadow`, anything else off), then the most restrictive matching `ff_switches` row (off over hold over on); a held wire's hits are stored `held`.

## Left to lane G

Calling `createEvaluator` from `/api/ff/run` and the housekeeping firing (`evaluate`, `gap`), a `readMany` over `flows_payload`, registering `ff-metrics` and `ff-carry` as products and the `ff` stage in `scripts/flows-nightly/stages.mjs`, the dry-run emit of both keys, `FF_*` variables, and the live snapshot's strips columns (only `live:alerts` windows are read today; `flow.net_premium` has no live source). Not built here: `scripts/flows-legs/ff-calibrate.mjs` and its workflow.

## Proof

| Suite | What it holds |
|---|---|
| `ff-c-legs` | The metrics leg on the dry-run emit against an independent z, the sector sums, skew, implied ratio and confirmation oracles, synthetic edge cases, the byte cap, the carry rules, the stage, and 29 planted wrong builds. |
| `ff-c-eval` | The evaluator over the real tables in SQLite: modes, switches, sources, caps, windows, the gap check and its late upgrade, the live tick, and 23 planted wrong builds. |
| `ff-c-chain` | The legs' payloads through the evaluator into rows, with the expected hits worked from the raw emit. |
