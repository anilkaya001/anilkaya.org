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
   the least of four limits: the cap (530, `FLOWS_DEEPEN_CAP`, hard ceiling 900),
   the backlog, the calls the day line leaves (85 per cent of the line less the
   larger of what the run has spent and the key's own daily count, and less the
   nightly's baseline with a 10 per cent margin, at 38 calls a name), and the
   time the deadline leaves (80 per cent of the 90 minute `DEADLINE_MS` less the
   projected baseline, at 6.5 s a name). A batch under four names is not run.
   The key's daily count is `x-uw-daily-req-count`, the highest value any of the
   run's own responses has carried (`stats.dailySeen` in `vendor.mjs`); it counts
   every caller of the key, so a day on which the Worker, the rail or an owner's
   session has already spent calls shrinks the night instead of being found out
   at the line. An unread counter is not a reading and changes nothing.
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

## The recorded plan, 2026-10-19

The table below was worked against the 60,000 working line of an unread plan.
The owner's screenshot of the vendor's API dashboard has since named the plan,
API Advanced with 100M daily requests included, and `FLOWS_UW_PLAN = "advanced"`
is set for the Worker and for the nightly's build step. The governor's day term
is therefore about 2.2 million names and never binds: an ordinary night is still
the cap (530), an uncapped one still the deadline (535), and the pace still comes
from the minute line, which the dashboard does not state and so stays the 500
working line (400 a minute for the rotation). The only night that changes is one
on which more than about 30,400 calls of the key were already spent, by the run or
by other callers, before the rotation was planned: it used to shrink and now reads
the cap. A whole night at the hard cap (4,500 + 900 x 38 = 38,700 calls) is under
a two-thousandth of the day line.

## Sizing, 2026-10-18: spend the budget

The owner's directive was to use almost all of the vendor limit until no name
has a gap, so the first sizing (80 a night, a quarter of the day line, a 36
minute deadline) was replaced. What binds now, with the figures the governor
works from:

| | before | now |
|---|---|---|
| day share of the 60,000 working line | 25 per cent (15,000) | 85 per cent (51,000), leaving 9,000 calls to the Worker, the rail, members and probes |
| run deadline (`DEADLINE_MS`) | 36 minutes | 90 minutes, workflow `timeout-minutes` 120 (30 minutes for the stages after the deadline) |
| time term | (36 x 0.8 - 14) x 60 / 6.5 = 80 names | (90 x 0.8 - 14) x 60 / 6.5 = 535 names |
| day term, nothing else spent | 267 names | (51,000 - 4,950) / 38 = 1,211 names |
| default cap, hard ceiling | 80, 240 | 530, 900 |
| minute pace | 80 per cent of 500 (400 a minute) | unchanged |
| names a night | 80 | 530 |
| nights for the 794 names behind the board | 10 | 2 |
| calls a night, rotation plus baseline | 7,440 (12 per cent of the day) | 24,640 (41 per cent of the day, 48 per cent of the 51,000 allowed) |

The deadline is what binds, not the day line or the minute line: 530 names at
6.5 s is 57 minutes, which with the 14 minute baseline is 71 minutes of the 72
the time share allows, and 20,140 rotation calls in those 57 minutes is 353 a
minute, under the 400 pace. The day line would allow 1,211 names, the cap 900.
A one-night full cover of 794 names needs (794 x 6.5 s + 14 min) / 0.8 = 125
minutes of deadline and a workflow timeout of about 150, which the platform
allows (a job may run six hours) and which is a two-line change (`DEADLINE_MS` in
`scripts/flows-nightly/vendor-params.mjs`, `timeout-minutes` in
`.github/workflows/flows-pipeline.yml`) once a measured night shows the
6.5 s a name is right. It is not done now because that figure is a model, not a
measurement of a rotated night, and every stage after the rotation shares the
same deadline.

Steady state is each name re-read about every 1.6 nights (856 names over 530 a
night), oldest first. The ceiling on a night is the least of the four terms, so
a night that begins with the key already spent (the Worker's own counter says
so) or that runs slowly shrinks on its own; `meta.deepen.binding` and the Status
page's Deepening card say which term bound.

Other budgets, checked, not assumed:

- D1 writes. A full rotation adds up to 535 cards, 535 card-x and 535 hist
  posts to the nightly's 698, 2,303 in all, and the door's manifest row and
  warn-mode quarantine ring scale with them: `tests/lib/d1-budget.mjs` now
  prices 2,303 posts and the door at 9,212 rows written, which keeps the day's
  sum under the 100,000 free-plan cap with the rest.
- Roster. 856 names landing tonight are about 50 KB of the 96 KiB roster budget
  and 856 names all carried (three held keys each) about 70 KB; the test builds
  both. The ledger for 856 names is about 35 KB of its 64 KiB budget and the
  128 KiB ingest cap.
- The compute stage's per-name CPU budget, the ledger rules, the backoff
  (1, 2, 4, 8 sessions), carried deep reads and `FLOWS_DEEPEN=off` are unchanged.

## A daytime freshness rotation: what is built and what is the owner's

The panels that decay fastest on a deep card are flow, short volume and
earnings. The question is whether to refresh the oldest deep cards' fast panels
in the day. Nothing is built for it, deliberately:

- The Tier 2 live leg writes `live:*` keys only, one writer each, and a card is
  not a live key. A fast-panel patch would have to rewrite `card:<T>` and
  `card-x:<T>`, which the nightly owns, so two writers would race on one row
  unless the door's compare-and-set were enforcing (it is in warn mode, B3b).
- The day's key budget is not idle. Tier 2 spends up to 180 calls a minute in
  session and the rail up to 240 while a member watches, against the 500 line
  the 120-a-minute on-demand limiter already shares. A refresh job would need a
  rate the owner chooses to take from them.
- The honest safe subset ships instead: the deep read of the night itself now
  lands every name within two nights, which makes the oldest panel at most about
  two sessions old, and the Status page shows the oldest read.

The design the owner would need to choose: (a) a scheduled Actions job at, say,
10:00 ET on trading days that reads flow, short volume and earnings for the 100
oldest deep cards (about 5 calls a name, 500 calls, once a day, 60 seconds at
the minute pace) and writes only a `card-x` fast-panels patch under its own
producer id, which needs B3b's enforcing door; or (b) nothing, and the nightly
alone, at two nights of age. Until (a) is chosen the repository carries (b).

## One job or two

The rotation runs inside the nightly job. A separate chained workflow would give
the rotation its own timeout, but it would have to rebuild the run's context
(the cross-section feeds, the variation probes, the quant pass, the vol and flow
legs' inputs) from stored payloads, which is a second implementation of the
card builder that would drift. The measured budget leaves room: at the shipped
cap a night adds about 20,000 calls and 57 minutes to a run of 4,500 calls and
about 14: 71 minutes against the 72 the governor allows (80 per cent of the 90 minute deadline). If a
measured run shows the time term binding (`binding: "time"` in the stage record
and `meta.deepen.binding`), the next step is the second job; the ledger and the
`planNight` / `settleNight` functions are already independent of the process
that calls them.

## Numbers

| | per night |
|---|---|
| calls added by 530 rotated names | 20,140 (38 each: 5 enrichment, 7 per-name reads, 1.4 chain, 8 volatility, 12.2 flow, 2 ownership, 1 earnings, batches) |
| calls for borrow, short volume and earnings of non-deep cross names | about 420 |
| nightly total | about 24,500, 41 per cent of a 60,000 day, under the 85 per cent share |
| minutes added | about 57 at 6.5 s a name; the pace never exceeds 400 calls a minute |
| nights to first deep read of 794 names behind the board | 2 at 530 a night, with nothing failing; more with failures |
| steady state | each name re-read about every 1.6 nights |

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
