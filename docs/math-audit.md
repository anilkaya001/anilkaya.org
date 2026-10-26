# Mathematical-correctness audit of Flows (lane 2, 2026-10-26)

Owner requirement: "ensure excellent coverage and mathematical correctness in all of the Flows."

Every row names the formula, the production file that computes it, the independent oracle it was held to, the result and the fix. An oracle is independent when it shares no code with production: Python `decimal`, `fractions`, `mpmath` at 50 digits, `scipy`, `exchange_calendars` and `zoneinfo`, each written by a generator under `tests/gen-math-*.py` whose SHA-256 is recorded in the fixture it writes, so a generator edited without a regenerate fails its suite. No exposure fixture uses a spot of 100, where a gamma per 1% and a gamma per dollar coincide.

Already audited by earlier lanes and not repeated here: Premium Desk ranking and forwards, Moves significance, the glance cone, the lean rule, the ask-share rule and Relations partial correlation.

## Table

| # | Formula | Production file | Oracle | Result | Fix |
|---|---|---|---|---|---|
| 1 | Rounding of every displayed figure (half away from zero on the shortest decimal) | `shared/flows-round.js`, `assets/js/flows-ui.js` | `tests/gen-math-format-fixtures.py`, Python `decimal` ROUND_HALF_UP, 17,005 cases | Defects D1 to D5 | One rounding leaf, the browser copy held equal to it |
| 2 | NYSE calendar, early closes, US daylight rule, Eastern day | `shared/flows-freshness.js`, `shared/flows-quant-time.js` | `tests/gen-math-time-fixtures.py`, `exchange_calendars` XNYS and zoneinfo, 2015 to 2031 | Pass, zero mismatches over 4,272 sessions and 297,985 instants | Regression suite `math-time` |
| 3 | TRT open and close of every session | `shared/flows-time.js` | zoneinfo, every session 2017 to 2031 | Pass | Regression suite `math-time` |
| 4 | Session key of a quote | `assets/js/flows-ticker-live.js` | zoneinfo | Defect D8 | New York day |
| 5 | Delta, gamma, vanna, charm | `shared/flows-quant-bs.js` | `tests/gen-math-dealer-fixtures.py`, mpmath 50 digits, spots 8.25 to 1450 | Pass | Regression suite `math-dealer` |
| 6 | Sticky-strike gamma profile and zero-gamma flip | `shared/flows-quant-dealer.js` | mpmath bisection of the closed-form profile | Defect D6 | Illinois polish |
| 7 | Put-sign vote, walls and book gamma by strike | `shared/flows-quant-card.js` | mpmath, dollar-weighted vote | Defect D7 | Dollar-weighted vote, mixed above 1% |
| 8 | Contract multiplier | `shared/flows-quant-bs.js`, `shared/flows-quant-card.js` | closed form | Defect D9 | Named once |

Rows for the remaining modules of the audit plan are added below as each is closed.
