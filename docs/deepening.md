# Deepening rotation

Design note for the nightly's rotation that gives every name in the universe a
full deep card within a bounded number of nights. Written 2026-10-18.

## The problem, measured

On 2026-10-16 the roster held 201 cards for a universe of 856 names: board 50,
focus 13, cross 126, index 3, fund 9. A cross-section card (KLAC) has eight
panels that say "this name was measured in the run's cross-section but is not on
today's board": surface, ivSurface, skewTerm, topContracts, aggressor, darkpool,
oiDeltas, volContext. The run made about 3,900 vendor calls against a working
line of 60,000 a day and 500 a minute (`shared/flows-plan-facts.js`), and took
about twelve minutes of a 36 minute deadline (`DEADLINE_MS`). The binding
constraint was the rule "only the board's top fifty and the focus names get the
per-name reads", not budget.

Positioning and Earnings for KLAC were empty for two gating rules, not for
missing data or a failed read:

- `ownershipParts` (`scripts/flows-legs/ownership.mjs`) wrote `short.borrow` and
  `short.volume` as "only the deep names carry a ... read" for every name outside
  `deepTickers`. The short-interest settlement and the insiders were read in
  batches for all carded names, which is why `short.interest` and `insiders` were
  ok and the rest was not.
- `runMarketLegs` read the earnings history only for `deepTickers` and the
  ten-session earnings window, so a cross name outside the window had no
  `earnings` section in its card-x at all.

Both are fixed by reading them for every carded name (`readTickers`): about
2 + 1 calls for each of the roughly 140 non-deep carded names, 420 calls a
night. The squeeze score keeps its cohort of board and focus names, so the
rotation does not move it.

## The design

Each night, after the boards are fixed and before the market legs, a stage
`deepen-plan` picks the names that join the deep build. They are built by the
existing deep path (enrichment, chain, per-name reads, volatility, flow,
ownership, earnings, engine, card-x, hist), not by a second implementation.

1. The governor (`governor` in `shared/flows-deepen.js`) sizes the rotation as
   the least of four limits: the cap (80, `FLOWS_DEEPEN_CAP`, hard ceiling 240),
   the backlog, the calls the day line leaves (25 per cent of the line less what
   the run has spent and the rest of the nightly is projected to spend, at 38
   calls a name), and the time the deadline leaves (80 per cent of it less the
   projected baseline, at 6.5 s a name). A batch under four names is not run.
   The result also carries a pace: the rotation raises the read pace so the run
   never claims more than 80 per cent of the minute line (150 ms between calls at
   500 a minute), which leaves the rest to the live layer, the rail and members.
2. A ledger, the `deepen` key (`at[T]` = the session of the name's last deep
   read, `tries[T]` = session and count of consecutive failures), is the memory.
   `pickRotation` takes names with no deep read first, by liquidity (the
   screener's dollar volume), then the oldest read first. A name that failed
   waits 1, 2, 4, then 8 sessions between attempts. Board and focus names are
   deep every night and are recorded on the ledger as such.
3. A name counts as read only when its card and its card-x landed
   (`settleNight`). One that did not keeps its last card and goes on the retry
   list; the ledger never claims a read that did not happen.
4. Honesty. A deepened card is published with `depth: "deepened"` and its own
   session date; the roster counts it as `deep`; the page shows the Stale chip
   with the session and a sentence that the name is read in turn. A name whose
   deep read is on the ledger and whose stored card is the one the ledger dated
   is "carried": the nightly builds no cross-section card, no cross volatility
   or flow read and no card-x for it, so a shallower card never replaces a deeper
   one and the deep read keeps its true date. The roster's retire step exempts
   carried names (it ages a card out after three sessions otherwise), up to 40
   sessions. When the ledger cannot be read the night chooses nothing, builds no
   cross cards and retires nothing, because it cannot tell which cards are deep.
   A card that was rebuilt shallower since the ledger dated it (the switch was
   off for a night) is no longer carried and rejoins the queue.
5. Nothing the board is made of moves. Rotation names are left out of the ideas
   list and its track record, the board's chain columns, the unusual screen, the
   vanna unit probe and the risk-reversal ranking cohort. A test compares fifteen
   payloads byte for byte with the rotation switched off.

`FLOWS_DEEPEN=off` returns the nightly to its previous behaviour (no rotation,
no protection, no ledger read). `FLOWS_DEEPEN_CAP` and the workflow's
`deepen_cap` dispatch input set the size for one run or for good.

## One job or two

The rotation runs inside the nightly job. A separate chained workflow would give
the rotation its own 45 minutes, but it would have to rebuild the run's context
(the cross-section feeds, the variation probes, the quant pass, the vol and flow
legs' inputs) from stored payloads, which is a second implementation of the
card builder that would drift. The measured budget leaves room: at the shipped
cap a night adds about 3,000 calls and 8.7 minutes to a run of 4,400 calls and
about 14: 22.7 minutes against the 28.8 the governor allows (80 per cent of the 36 minute deadline). If a
measured run shows the time term binding (`binding: "time"` in the stage record
and `meta.deepen.binding`), the next step is the second job; the ledger and the
`planNight` / `settleNight` functions are already independent of the process
that calls them.

## Numbers

| | per night |
|---|---|
| calls added by 80 rotated names | 3,040 (38 each: 5 enrichment, 7 per-name reads, 1.4 chain, 8 volatility, 12.2 flow, 2 ownership, 1 earnings, batches) |
| calls for borrow, short volume and earnings of non-deep cross names | about 420 |
| nightly total | about 7,900, 13 per cent of a 60,000 day, under the 25 per cent share |
| minutes added | about 8.7 at 6.5 s a name; the pace never exceeds 400 calls a minute |
| nights to first deep read of 794 names behind the board | 10 at 80 a night, with nothing failing; more with failures |
| steady state | each name re-read about every 10 nights |

The per-name figures are the model in `vendor-params.mjs` and the stage
durations of the 2026-10-16 run, not a measurement of a rotated night. The first
live nights are the measurement; `meta.deepen`, the `deepen-plan` stage record
and the run's `deepen:` log lines carry it.

## What this does not do

- A deepened card is up to ten sessions old between turns, and its Neuron tier
  falls to expired at two sessions. The basic panels of a carried name (price,
  gamma, levels) are as old as its deep read; the live quote and the universe
  row stay current. Merging a fresh cross card's panels over a deep card's, with
  per-panel dates, would fix that and needs a panel-level as-of the card does not
  carry today.
- Real vendor behaviour for a rotated night (rate refusals, the time per name,
  names the chain endpoint returns nothing for) is unverified offline. A name
  with no chain fails its turn, goes on the retry list and waits out its backoff.
- The squeeze score is computed for board and focus names only.
