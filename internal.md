# Shipment tracker

Last updated: 2026-11-21, 12:20 TRT. Live site version: 436.

How to read this: **Live** means merged and deployed. **In CI** means pushed and waiting for the checks. **Built** means a pull request exists and its checks passed once, but it still has to be merged with the current main branch. **Not started** means no code yet.

If the session stops (usage limit, restart), nothing here is lost: every item below is a branch and a pull request on GitHub. Work resumes from the first item that is not Live.

## 1. In progress now

| Item | Pull request | State | What is left |
|---|---|---|---|
| Fire & Forget: Digest page | #324 | In CI | Merge when the checks pass |

## 2. Built, waiting their turn to merge (one at a time, in this order)

| # | Item | Pull request | Notes |
|---|---|---|---|
| 1 | Fire & Forget: Wires page, sidebar mark, name panel on the ticker | #326 | Reviewed once: 5 defects found, not yet fixed |
| 2 | Market Floor: fund pillars never blank, each names its session | #327 | Not reviewed yet |
| 3 | Pulse: the mark beats only when data really advanced | #328 | Not reviewed yet |
| 4 | Neuron orb docked in the top bar so it never covers content | #329 | Not reviewed yet |
| 5 | Always-fresh data: say how old a kept card is and why | #330 | Not reviewed yet |
| 6 | Reading and Neuron never stuck: every wait ends with a reason and a retry time | #331 | Not reviewed yet |
| 7 | Endpoint coverage: IPO calendar on Events, the census of feed operations | #332 | Not reviewed yet |
| 8 | Real time, stage 1: the pulse topic on the live rail | #333 | Not reviewed yet |
| 9 | Safari Home fix: all tiles show even if Safari mishandles the layout; lighter glass on large windows | #334 | Not reproduced on real Safari; needs your check after it ships |
| 10 | Third math audit: forty displayed-figure defects on Home, Events, Desk, Strategy, Glance, Macro | #336 | Each defect must be reproduced before it is fixed |

For each of these I merge the current main branch in, fix what breaks, wait for the checks, merge, and confirm the live site.

## 3. Shipped (live)

| Item | Pull request |
|---|---|
| Landing page: market board centred, redundant title removed, depth-rendered 3D field | #306 and follow-ups |
| Market Tide on the full universe with market-cap weights | #316 |
| Fire & Forget transport: budget allocator and pacer; the line no longer eases on two refusals | #317 and earlier |
| Same background on all pages; sidebar stays open between pages | #318, #319 |
| Google Sans on every page | #320, #321 |
| Positioning page (institutional and insider) | #291 |
| Macro page, odds beside the Events calendar, private-markets lens | #292 |
| Shell follow-ups: Positioning in the sidebar, sidebar fits without scrolling | #322 |
| Nightly health: four fixes from the 13 November run | #323 |
| Event-risk console on Events, halts channel, Fire feed templates | #293, #294, #335 |
| Fire & Forget: Inbox page | #325 |
| "The feed" wording everywhere (no data-source name in any page or model text) | #295 |
| Fire & Forget runs in shadow mode (wires evaluated, nothing delivered) | earlier |

## 4. Not started

| Item | Why it waits |
|---|---|
| Fire & Forget switched from shadow to live delivery | Needs the Digest and Wires pages merged and a check on real nightly data first |
| Real time, later stages (after stage 1) | Stage 1 (#333) must land first |
| Endpoint coverage, remaining feed families | The census in #332 lists them; each is its own piece of work |
| Size-limit follow-up: the private-markets section is shed before the vol-desk section | Found by the advisor on 21 November; small, separate change |
| Close the old checkpoint pull request #296 | After the last paused package is live |
| Dependency updates #297, #163, #162 | Routine; after the queue above |

## 5. Checks still owed on real data

None of these has been looked at on the live site with real data yet.

- Macro page showing figures (it showed "not published yet" on 14 November).
- Cap-weighted tide line on Home during a session.
- Positioning page with real data.
- Fire & Forget nightly stage wrote its metrics.
- The four nightly-health fixes (#323): multi-leg pages, extras shape, busiest minute, weekly probe.
- Transport line climbing back from 500 calls a minute.

To do these I need to be signed in to the site. The saved sign-in is from 14 November and has probably expired.

## 6. Waiting on you

- **Safari Home bug:** does it still happen after Cmd+0 (reset zoom)? Does it happen on Market or Ledger? Which Safari version?
- **"Top pill stays open":** I made the Flows sidebar stay open. Say so if you meant the Home / Articles / Lab / Flows pill instead.
- **Landing page now scrolls** (for the 3D field). Say so if you want it back to one screen.
- **Lab lost its serif look** with Google Sans. Say so if the Lab should keep its old typeface.
- **Lab sign-in check:** the nightly health gate turns red from 27 November unless the Lab's Google sign-in is used or the gate is changed. This is an account action only you can take.
- **Sign-in for live checks:** if you want me to verify section 5, sign-in details are needed again (they are never stored or written anywhere).

## 7. Working rules in force

- No sub-agents; I do each step myself.
- Advisor: Opus 5.5 at max effort through your API key, used for design and correctness questions only. The key is kept outside the repository.
- Merge as soon as the checks are green; no waiting on review.
- Times in TRT; missing values are a dash with a reason, never a zero; one screen with no scroll at the four standard sizes.
- The data source is called "the feed" in everything a reader or a model sees.
