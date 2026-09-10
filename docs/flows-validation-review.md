# Flows coverage and validation review — 2026-09-10

## Baseline observed in production

Session 2026-09-09: all 50 sampled chains were truncated. Nine archived sessions were retained. The current selection rule had eight one-session observations (49.88% pooled hits across 419 measured name-session pairs), five five-session observations (44.03% across 293), and one ten-session observation. That ten-session row measured 29 of 103 names and lost 74. These are descriptive reference-close outcomes, not executable performance or evidence of a reliable edge.

## Changes and acceptance criteria

| Area | Change | What establishes success |
| --- | --- | --- |
| Chains | Follow documented zero-based pages; deduplicate option symbols; stop on overlap, malformed rows, error, page allowance or deadline | Live payload reports unique rows, pages and stop reason for each name; only a clean short terminal page establishes completeness |
| Quota | Maximum eight pages per name; 140 continuation calls shared by the run; preserve the card deadline reserve | Measured call count and card completion remain visible; partial reads remain labelled |
| Outcome attrition | Up to 30 extra daily-candle reads, selected from missing dates of archived names, not today's selected names | Count attempted names, recovered closes and failures; remeasure attrition without zero-filling |
| Integrity | Exclude post-session candles; pass the selection epoch into the feature-correlation helper | Future candle fixture cannot enter the close map; live feature payload identifies its selection epoch |
| Validation | Missing-outcome hit bounds and chronologically selected disjoint windows, split to the current selection epoch | Counts and bounds match independently constructed fixtures; empty/immature horizons show absence |
| Interpretation | Visible research-only status and reference-close timing; no calibrated probability or executable-profit claim | UI carries the limitation beside the validation table, including on legacy payloads |

The optional recovery allowances add 170 calls to the 1,079-call model, keeping it inside the existing 1,250-call model. This is a scheduling model, not a promise about vendor retries. Deadlines and the existing limiter still apply.

## What this does not establish

- A full-market census: the screener cohort, deep-name selection, zero-OI exclusion, display caps, endpoint-specific limits and plan permissions still define the observed population.
- Atomic chain snapshots: numbered pages can shift during a live read. Overlap refuses completeness; a short terminal page establishes pagination exhaustion, not an exchange-level atomic snapshot.
- A tradable backtest: archived boards are published after their reference close. A future execution study must preserve first-available timestamps, use subsequent executable entries, verify corporate actions, include costs and borrow assumptions, and evaluate frozen rules on untouched future data.
- Statistical independence: disjoint holding windows remove overlap, but repeated names and common shocks remain. Hit bounds cover missing outcomes, not sampling uncertainty. No significance claim is made.
- Full outcome recovery: unavailable/delisted prices and names beyond the per-run allowance remain missing and counted. Daily-candle backfills currently repeat on later runs; a separately versioned price archive would make this more efficient as history grows.

## Review of the previous work

1. The UI release was useful but too narrowly scoped relative to the original request for data robustness. UI and regression success did not establish data completeness or predictive quality.
2. I should have quantified missing outcomes before discussing signal quality. The 29/103 ten-session denominator is the relevant baseline.
3. I initially described overlap as though the scorer lacked a caveat. It already documented it; the missing piece was prominent UI interpretation and an additional descriptive check.
4. The live header smoke check encountered a dashboard override. Accepting the observed value did not reconcile it with the repository policy. Header readback must compare the intended policy, not merely check response success.
5. Future release reports should distinguish code deployed, fresh payload verified, empirical coverage improved, and predictive quality established. These are four separate claims.

## Vendor references checked

- [Option contracts: limit 500, zero-based page parameter](https://api.unusualwhales.com/docs/operations/PublicApi.OptionContractController.option_contracts)
- [Daily OHLC: timeframe and end_date](https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.ohlc)
- [UW API examples](https://github.com/unusual-whales/api-examples)

## Infrastructure correction

The Cloudflare zone response-transform rule `Security Headers` was updated on 2026-09-10 to preserve `X-Frame-Options: DENY` and include `payment=()` in Permissions-Policy. Live header readback confirmed both. The existing stronger HSTS `includeSubDomains` setting remains intentional.
