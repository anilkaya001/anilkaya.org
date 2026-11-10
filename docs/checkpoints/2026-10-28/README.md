# Checkpoint, 28 October 2026

The owner stopped all work on the evening of 28 October 2026 (TRT). This folder keeps what was in flight and existed only inside the session's container, and it says where everything else lives. Nothing here is served, because `docs/` is outside the static bundle, and CI runs none of it.

The files here name the session's own paths through four placeholders. Set them when you resume:

| Placeholder | Stands for |
|---|---|
| `<checkout>` | The main checkout |
| `<scratchpad>` | The scratch directory |
| `<journals>` | The workflow journals |
| `<browsers>` | The Playwright browsers |

A file under `<scratchpad>` that is not in this folder was not kept.

## On main

Merged on 28 October, times in TRT:

| PR | Commit | Merged | Change | Assets |
|---|---|---|---|---|
| #282 | `90cb057` | 06:56 | Market Floor: every fund pillar carries stored data | 409 |
| #283 | `b0b6e7c` | 14:51 | Flow Lab: contract drill and flow intelligence page (WP2) | 412 |
| #285 | `dfe0cad` | 16:46 | Market Floor: no fund pillar is empty while the source can answer | 413 |
| #287 | `c4bc833` | 17:32 | `flows-home-net-render` counts only the network's own listeners | 413 |
| #284 | `d70dcaf` | 17:49 | Neuron: Hidden leaves an Undo and a restore button | 414 |
| #286 | `15f1e6f` | 18:25 | Every reader feature is open to every signed-in member | 415 |
| #289 | `c94806e` | 18:58 | Neuron: a restore inside an open sheet keeps focus there | 416 |
| #288 | `4b82631` | 19:34 | Vol desk (WP3) | 417 |

**Checked on production, signed in.** The Neuron's Hidden, Undo and restore at assets 416 passed 20 of 20 checks at 1440x820 and 390x844:

- Hidden leaves Undo with focus on it.
- Once focus leaves Undo, a 36 px Show button remains (44 px on touch).
- Restoring brings back the orb and the earlier mode.
- Alt+Shift+N inside an open sheet keeps focus in the sheet.

**Not yet checked on production:**

- The Vol desk (#288), signed in at 1920x1080, 1440x820, 1024x768 and 390x844.
- Whether the next nightly lands the `voldesk` key and records its two stages.
- Whether the funds tick from #285 writes `live:funds` every five minutes during a session.
- #286 as seen by a member who is not an owner.

## Paused, with draft pull requests

Nobody is watching these PRs. CI runs on each one once, when the PR is opened.

| PR | Branch | Assets | Where it stopped |
|---|---|---|---|
| #290 | `claude/flowlab-reads` | 418 | The fix is committed and main is merged in. Suites have not run on this head. |
| #291 | `claude/pkg-WP4-institutional-positioning-train` | 418 | Contains main. Ready for prepush and CI. |
| #292 | `claude/pkg-WP5-cross-asset-macro-train` | 416 | Two commits behind main. |
| #293 | `claude/pkg-WP6-event-risk-train` | 416 | Two commits behind main. Its nightly gate already defaults to on in the workflow. |
| #294 | `claude/wp6-halts-feed`, based on #293 | 416 | The halt channel is half built. The Fire feed group and the route-matrix row are not started. |
| #295 | `claude/copy-feed` | 415 | The copy scrub is done. Six suites' expected copy is updated but has not been re-run. Three commits behind main. |

**Merge order:** #290, #291, #292, #293, then #294 (retargeted to main), and #295 last. Going last lets #295's copy lint catch the strings the others add.

**For each PR:**

1. Merge main into the branch.
2. Run `node scripts/bump-assets.mjs` so assets move past main's version.
3. Regenerate whatever the merge moves: the golden manifest, the route matrix, page baselines and stage-record ceilings.
4. If the shard balance fails, run `node run.mjs --repin` from `tests/`.
5. Run `node scripts/prepush.mjs`, mark the PR ready, wait for CI to go green, and squash-merge.
6. Check the page on production, signed in, at the four sizes.

Each PR's body lists the steps specific to it.

## Not started

From the plan approved before the stop (`workflows/ship-everything-v2.js`):

- **C. Pulse:** beats from committed keys, so the system visibly breathes and is honest about its gaps. Source: consult section 5, and step 1 of section 7.
- **D. Fire & Forget mounted live, in shadow mode.** Source: consult section 4, and step 3 of section 7.
- **E. Coverage of all 217 paths,** with a surface for everything added.
- **F. The remaining real-time stages of consult section 7.**
- **The Neuron corner,** described in the next section.

## The Neuron corner, paused after the survey

The floating Neuron covers page content in the bottom-right corner. The survey in `orb-survey/` measured 18 pages at five sizes, in every state, on commit `c94806e`: 90 page-and-size pairs and 388 views.

- In at least one state, the Neuron covers content on all 18 pages: 243 controls, 513 text runs and 93 graphics.
- The orb at rest covers content on 15 pages.
- The phone toast covers content on all 18 pages.
- With the Ask dock open, the orb moves left onto the page and covers content on 11 pages.
- Nothing is drawn over the Neuron, and no page chrome is covered.

**Designs.** Three were planned: dock the Neuron in the page chrome, reserve the corner on every page, or find a free slot on each page. `orb-prototypes/chrome.patch` and `orb-prototypes/reserve.patch` are partial builds of the first two, made against `c94806e`. Neither has been judged or tested.

**Next step:**

1. Judge the designs against the survey.
2. Build the winner, with a sweep suite and planted wrong builds.
3. Rerun `survey.mjs` to show that nothing is covered.

**Files.**

- `orb-survey/summary.md` is the report, and its head lists the survey's options.
- `orb-survey/inventory.json.gz` is the full measurement. Gunzip it before passing it to `report.mjs` or `survey.mjs --summarize`.
- The corner screenshots were not kept.
- Page text quoted in these files writes the data source as "the feed".

## Flow Lab

`flowlab/diagnosis.json` holds the diagnosis of the four failing Flow Lab reads, two independent challenges to it, and the fixes that were decided. Those fixes are #290.

## Endpoint coverage

Counted on 28 October against the committed OpenAPI document in `docs/`. The document has 217 paths and 218 operations; the one operation that is not a GET is the alert-configuration write.

| Scope | Paths used |
|---|---|
| Main before #286 | 95 (81 reachable by members) |
| Main now, after WP3 | 108 |
| After WP4, WP5 and WP6 merge | 186, or 190 counting the four stream channels the rail joins |
| End target | All 217 paths, and 217 of 218 operations: the alert-configuration write stays unused |

- **Still uncovered after WP6:** 31 paths. 19 are stream paths (`/api/socket*`) and 12 are REST paths, three of them deprecated.
- **Stream address:** the stream connects at `wss://<feed host>/socket`, not the `/api/socket` the document names.
- **Recount after #290 merges:** the census predates #290, which stops reading two operations.

**Files.**

- `census/census.mjs <checkout> <paths.json> <out.json>` counts one checkout. `paths.json` must be `{"info": {...}}`, with the document's paths as the keys of `info`.
- `census/reconcile.json` reconciles three independent counts.
- `census/pr284-review-verified.json` is the verified review of #284; #284 and #289 fixed its findings.

## Workflows

These are the four workflow scripts that ran in the session. Their run journals were inside the container and are gone, so a resume starts fresh.

| Script | Stages | Where it stopped |
|---|---|---|
| `workflows/ship-everything-v2.js` | The plan, items A0 to F | During WP4 (A3) and the copy scrub (B) |
| `workflows/flowlab-reads-fix.js` | Diagnose, two challenges, build, two reviews, ship | After the build, which is #290 |
| `workflows/neuron-orb-clear.js` | Survey, three designs, three judges, build, review, ship | After the survey and two partial prototypes |
| `workflows/coverage-census.js` | — | Finished; its result is in the Endpoint coverage section above |

## Consults

**`consults/no-nightly-architecture.md`** is the architecture consult of 27 October behind items C, D and F. It covers:

- data classes and a pacer;
- compare-and-set at the ingest door;
- Fire & Forget as the backbone;
- the Pulse surface and latency targets;
- an eight-step migration in section 7, each step behind a switch.

Its file paths are generic: read `worker/` as `worker.js` and `server/`, and `web/` as `assets/`. The answer was cut off at the model's output limit, in the rollback line of step 8 of section 7, so nothing after that step exists. `consults/no-nightly-question.md` is the question it answers.

**`consults/merge-order-2026-10-27.md`** and **`consults/merge-order-question.md`** are the earlier consult on merge order. Everything it names has merged.

## Decisions write-up

`decisions-2026-10-26.md` was never committed. It was found in a worktree of `claude/decisions-closed` (head `ffe3fb5`).

The decisions themselves merged as #269 from `claude/decisions-closed-2`, which added `tests/flows-decisions-closed.mjs` and `docs/math-audit.md`. This write-up names suites (`decisions-math`, `decisions-desk`) that are not on main. Read it as the reasoning behind those decisions, not as a description of main.

## Older worktrees, not kept

Twenty-four worktrees in the container held uncommitted changes. Each belongs to work that has already merged, so the leftovers were not kept.

| Worktree | Branch | Head | Changed files | Outcome |
|---|---|---|---|---|
| `agent-a032a2c2438f898a2` | `claude/layout-polish` | `4613224` | 70 | Merged as #273 |
| `agent-a08243b6c7e3e302f` | `claude/decisions-closed` | `ffe3fb5` | 39 | Superseded by #269; its write-up is kept here |
| `agent-a1430ec4a73f5c56b` | `claude/ledger-redesign` | `4417b32` | 271 | Merged as #272 |
| `agent-a20a8e858b4021914` | `claude/sides-everywhere` | `38dda76` | 47 | Never pushed; the work merged as #270 |
| `agent-a849d2b6bfea5be1d` | `claude/ledger-redesign` | `4417b32` | 309 | Merged as #272 |
| `agent-a9cef08d522040a45` | `claude/ledger-redesign` | `4417b32` | 43 | Merged as #272 |
| `agent-aa6f5c6677ad4fa95` | `claude/ledger-live` | `3ba56e4` | 3 | Merged as #276 |
| `agent-ad410e0e4963e20d0` | `claude/sides-lean` | `eadafbd` | 241 | Merged as #270 |
| `wf_08339d76-de5-2` | `claude/sides-lean` | `eadafbd` | 350 | Merged as #270 |
| `wf_73d5e274-2c1-2` | `claude/ledger-redesign` | `4417b32` | 316 | Merged as #272 |
| `wf_73d5e274-2c1-3` | `claude/ledger-live` | `3ba56e4` | 320 | Merged as #276 |
| `wf_76486966-43e-1` | `claude/sfc-ledger` | `9dcc002` | 5 | Merged as #262 |
| `wf_76486966-43e-2` | `claude/math-audit` | `593e655` | 212 | Merged as #263 |
| `wf_76486966-43e-5` | `claude/member-state` | `9cb73c9` | 416 | Merged as #271 |
| `wf_8e9ade18-e43-3` | `claude/ff-store` | `536bcfc` | 226 | Merged as #274 |
| `wf_8e9ade18-e43-5` | `claude/ff-fire` | `c2a9642` | 295 | Merged as #278 |
| `wf_c439e838-2a5-10` | `claude/pkg-WP3-volatility-structure` | `77627ff` | 361 | Merged as #288 |
| `wf_dc88ab76-054-1` | `wp1-floor-etf-coverage` | `9fa2bfe` | 4 | Merged as #282 |
| `wf_dc88ab76-054-2` | `claude/pkg-WP2-flow-intelligence` | `64d6f1e` | 67 | Merged as #283 |
| `wf_dc88ab76-054-3` | `claude/pkg-WP3-volatility-structure` | `77627ff` | 346 | Merged as #288 |
| `ws_fix` | `claude/fix-strip-flake` | `86c16ed` | 1 | Merged as #281 |
| `ws_main` | detached at `43fb5c9` | `43fb5c9` | 1 | A debug script on main, nothing to keep |
| `wt264` | `claude/unusual-layout-fix` | `43e0eb5` | 65 | Merged as #264 |
| `wtflick` | `claude/surface-flick-flake` | `435b00b` | 1 | Never pushed. It added a retry loop to the flick check; `flows-surface-render` now measures flicks on the virtual frame clock instead |
