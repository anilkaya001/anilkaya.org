# Fire & Forget: the transport

Fire & Forget is how data moves through Flows without anyone waiting on it: reads are fired at the feed as fast as the feed
allows, writes travel in batches that do not wait key by key, and a final reconcile proves the store holds what the run
believes it wrote. This document is the specification of that transport and the argument for each rule. The wires product
that carries the same name is specified in `docs/ff/contract.md`.

Three planes:

| Plane | What it decides | Code |
|---|---|---|
| Fire | who may call the feed now, and how fast | `shared/flows-transport.js` (`allocate`, `shareOf`, `stepLine`), `scripts/flows-nightly/vendor.mjs` (`stepRateController`) |
| Forget | how a write leaves the run | `scripts/flows-nightly/store.mjs` (`publish`, the batch pump) |
| Reconcile | whether the store holds what was written | `scripts/flows-nightly/store.mjs` (`reconcile`), `shared/flows-transport.js` (`reconcilePlan`, `reconcileVerdict`) |

The real-time rail is the fourth hop, from the store to a reader. It already has this shape (a sequence number per topic, an
epoch, a snapshot on a gap) and is specified in `AGENTS.md` under "Real-time rail".

## 1. What is known about the feed's limit

- The plan's page states a daily allowance of 100,000,000 requests and no line per minute.
- Every response carries a per-minute counter. Read on 156 of 156 responses on 2026-10-04 it said 1,000,000 left and never
  counted down. The nightly now records the least and the greatest value it sees each run, so the next reading is on record.
- The feed does refuse: an HTTP 429. Refusals are the only signal of the real limit.
- On 2026-11-09 the nightly made 23,304 calls in 4,842 s. One call was refused. The average answer took 73 ms.

So the minute line the site paces by (500) is the site's own working figure, not the feed's. The transport treats it as a
starting point and moves it on evidence.

## 2. Fire: allocation

Four classes share the line `L` (calls a minute):

| Class | Rank | Reserve | Who |
|---|---|---|---|
| member | 0 | 60 | a member's on-demand read through the Worker |
| live | 1 | 40 | the rail and the live ticks |
| nightly | 2 | 0 | the nightly run |
| background | 3 | 0 | rotation, paging and backfill outside the nightly |

Each class `c` asks for `d_c` calls a minute and holds a reserve `r_c`. `allocate` returns `a_c`:

1. Reserves, in rank order: `g_c = min(d_c, r_c, what is left)`.
2. The excess `L - sum g`, in rank order: a class takes `min(d_c - g_c, what is left)`. Classes of one rank share it evenly.

Properties, each held by `tests/flows-transport.mjs` over 2,000 seeded instances and by a brute-force search on the instances
with distinct ranks:

- **Feasible.** `0 <= a_c <= d_c` and `sum a <= L`.
- **Participation.** When the reserves fit the line, `a_c >= min(d_c, r_c)`. A class is never left with less than it would hold
  under a fixed split at its reserve, so no class does better outside the shared line.
- **Work conserving.** `sum a = min(L, sum d)`. Nothing is idle while a class still asks, so no class can be given more without
  taking from another.
- **Priority.** A class gets more than its reserve only when every class above it is satisfied.
- **Truthful.** Let a class have a true need `theta` and value `min(a_c, theta)`. Reporting `theta` is a dominant strategy.
  Proof sketch: `a_c = min(d_c, X)` where `X` is what the line leaves the class, and `X` does not fall when `d_c` rises. Asking
  for less yields at most `d_c < theta`. Asking for more yields `min(X, theta)`, which the true report already gives.
- **Lexicographic optimum.** Among feasible allocations that honour the reserves, the result is the best by rank.

In mechanism-design terms the rule is individually rational against the fixed split, strategy-proof, and efficient. That is
the precise sense in which it is incentive and participation optimal. All four classes are the site's own code, so the
result is a design guarantee: no part of the system gains by overstating what it needs, and none is starved.

What the rule cannot do: the Worker and the Actions runner share no counter. The runner plans on the assumption that members
and the live layer use their whole reserve (`shareOf`: at a 500 line the nightly's share is 400), and learns of anything
beyond that only from refusals. The Worker's own limiters are unchanged.

## 3. Fire: pacing inside a run

The run spaces its calls at its share (`paceOf`: 400 a minute is 150 ms). A refusal raises the spacing floor by half.
Until 2026-11-10 that floor never came down, so one refusal slowed the rest of the night by a third: on 2026-11-09 the run
spent 3,868 s of its 4,842 s waiting in its own queue after a single refused call.

The floor now eases: after 600 clean calls it comes down by a factor of 1.25, and never under the paced spacing
(`RATE.recoverAfter`, `RATE.recoverX`). One refusal costs about two minutes at the slower spacing, not the night. A failure
that is not a refusal neither counts as clean nor clears the count. With no pace set the floor still never comes down.

The run counts the calls it issued while backed off (`stats.slowedCalls`) and its busiest clock minute (`stats.peakMinute`).

## 4. Fire: finding the line across nights

The line is carried in the deepening ledger (`deepen.line`): `{ perMinute, good, bad, avoid, since, history }`. `stepLine`
reads one night and returns the next line:

| Night | Rule | Verdict |
|---|---|---|
| under 5,000 calls | no evidence | `thin` (`start` on the first night) |
| 2% refused, or 25% of calls issued while backed off | back to the last line that held, else seven tenths | `cut` |
| over 0.2% refused, or over 8% backed off | back to the last line that held | `ease`, else `hold` |
| clean, but the busiest minute was under 60% of the share | a clean night that never ran near its share proves nothing | `idle` |
| clean and used, never cut before | raise by a quarter | `raise` |
| clean and used, a refused line on record | halfway between the line that held and the one that did not, until they are within 15% | `raise`, then `capped` |
| clean and used, settled for 14 nights | probe 8% higher | `raise` |

The line stays between 250 and 1,500 a minute and moves at most once a night. Against a hidden capacity in simulation it
settles within a few nights, serves 93 to 100 per cent of what the capacity allows, and draws about seven refused nights in
a hundred, each of which the pacing in section 3 absorbs.

## 5. Forget: writes

A per-name key (`card:`, `card-x:`, `hist:`, `oracle:`) is not written alone. Keys published together travel as one request
of at most 40 keys and 1,400 KiB, in publish order, and one answer covers them all. An item the store refuses, a request it
refuses, and an answer that does not account for every item are each written again one key a request. `FLOWS_WRITE_BATCH=off`
restores one key a request.

## 6. Reconcile

A write that was acknowledged is not yet a write that is held. When a key lands, the run keeps the SHA-256 of the canonical
form of the exact text it sent (keys sorted, the volatile stamps dropped: the store's own rule in `shared/flows-door.js`).
Before the run record is written, `reconcile`:

1. asks the store, ninety keys a request, which of those hashes it holds;
2. writes again every key that differs, up to 120;
3. asks once more about the keys it wrote again.

The verdict is one line in the log and a `reconcile` block in the run record: keys asked, differed, written again, still
differing. A store that does not answer the check, a short answer, and an answer naming a key that was not asked are read
as no answer, never as agreement.

Guarantee: after a reconcile that reports nothing still differing, every reconciled key in the store has the content the
run last sent for it, up to the volatile stamps. Limits: dated archive keys, live keys and the run record are not
reconciled (the first two carry no content hash in the store, the third is written after the check), and the check proves
the store's row, not what a reader's cache holds. `FLOWS_RECONCILE=off` skips it.

## 7. Switches and tests

| Switch | Effect |
|---|---|
| `FLOWS_DEEPEN=off` | no rotation, so no learned line; the run paces by the working line |
| `FLOWS_WRITE_BATCH=off` | one key a request |
| `FLOWS_RECONCILE=off` | no reconcile |

`tests/flows-transport.mjs` holds the allocation properties, the line rule against worked answers, random nights and hidden
capacities, the floor's recovery, and the reconcile against a store that computes its hash independently and that loses,
refuses or misreports writes. It plants 32 wrong builds; each must fail the check written for it.
