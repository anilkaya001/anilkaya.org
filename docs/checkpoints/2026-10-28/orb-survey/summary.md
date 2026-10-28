# Neuron corner survey

Run it (from any directory; the checkout needs `tests/node_modules`, linked from another checkout is fine):

```bash
# the whole survey (about 15 to 25 minutes; two pages at a time on one Chromium)
PLAYWRIGHT_BROWSERS_PATH=<browsers> node docs/checkpoints/2026-10-28/orb-survey/survey.mjs --repo <checkout>
# one page after a fix, folded into this inventory (same page and size replaced), with corner crops
PLAYWRIGHT_BROWSERS_PATH=<browsers> node docs/checkpoints/2026-10-28/orb-survey/survey.mjs --repo <checkout> --only '^market$' --merge docs/checkpoints/2026-10-28/orb-survey/inventory.json --shots <dir>
# rewrite this file, or print the ranked list and counts as JSON
node docs/checkpoints/2026-10-28/orb-survey/survey.mjs --summarize docs/checkpoints/2026-10-28/orb-survey/inventory.json
node docs/checkpoints/2026-10-28/orb-survey/report.mjs docs/checkpoints/2026-10-28/orb-survey/inventory.json --json
```

`--help` lists every option (`--sizes`, `--views default`, `--no-dock`, `--no-scroll`, `--no-check`, `--jobs`, `--step`, `--as owner`, `--env main`, `--emit-dir`, `--shots-views all`). The checkout needs `tests/node_modules` (a symlink to another checkout's is fine); nothing in it is modified. `in-page.js` is the in-browser measurer and `strategy-world.mjs` the stubbed feed behind the Strategy page.

This run: 2026-10-28T16:24:41.199Z, commit `c94806e16806e141dcfa117260cf15ab7105343d`, 90 page and size pairs, 388 measured views, 734 s. The full inventory is `docs/checkpoints/2026-10-28/orb-survey/inventory.json` (every page, size, view, scroll position, state, part box and covered element with its area).
Corner crops of the default view (the bottom-right 760 × 420 px at most, JPEG) are in `docs/checkpoints/2026-10-28/orb-survey/shots`: `<page>-<size>-<state>.jpg` for rest, pill or toast, undo and restore, and `<page>-<size>-dock-<state>.jpg` with the Ask dock open; 468 files.

## Findings

- Distinct covered items (merged across states, views and scroll positions; text and icons inside a covered control counted once, as the control): **243 controls, 513 text runs, 93 graphics**, on **18 of 18 pages**.
- The orb at rest alone covers content on 15 pages: Home (1920x1080, 1440x820, 1024x768, 390x844, 320x568); Bullish board (320x568); Bearish board (320x568); Network (320x568); Moves (390x844, 320x568); Unusual (1920x1080, 1440x820, 1024x768, 390x844, 320x568); Flow Lab (1920x1080, 1440x820, 1024x768, 390x844, 320x568); Ledger (1024x768, 390x844, 320x568); Events (1920x1080, 1440x820, 390x844, 320x568); Political (390x844, 320x568); Strategy (1920x1080, 1440x820, 390x844, 320x568); Premium desk (1920x1080, 1440x820, 1024x768, 390x844, 320x568); Ticker (1440x820, 320x568); Status (1920x1080, 1440x820, 1024x768, 390x844, 320x568); Fire (1024x768, 390x844, 320x568).
- The signal pill (desktop, measured at its 300 px cap) covers content on 12 pages: Home, Market, Unusual, Flow Lab, Ledger, Events, Political, Strategy, Premium desk, Ticker, Status, Fire.
- The phone toast covers content on 18 pages: Home, Bullish board, Bearish board, Watchlist, Market, Network, Now, Moves, Unusual, Flow Lab, Ledger, Events, Political, Strategy, Premium desk, Ticker, Status, Fire.
- The 10 s “Neuron hidden · Undo” chip covers content on 17 pages: Home, Bullish board, Bearish board, Watchlist, Market, Network, Moves, Unusual, Flow Lab, Ledger, Events, Political, Strategy, Premium desk, Ticker, Status, Fire.
- The collapsed restore button covers content on 14 pages: Home, Bullish board, Bearish board, Moves, Unusual, Flow Lab, Ledger, Events, Political, Strategy, Premium desk, Ticker, Status, Fire.
- With the Ask dock open (768 px and wider) the orb moves left onto the page (1024x768 444 px, 1440x820 444 px, 1920x1080 444 px) and covers content on 11 pages: Home, Market, Moves, Unusual, Flow Lab, Ledger, Political, Strategy, Ticker, Status, Fire.
- Nothing is drawn over the Neuron (0 sample hits above its layer) and no chrome is covered (0 hits on the top bar, tab bar, sidebar or dock). 45 covered items are inert: behind the modal Ask dock at 1024x768, Home's Glance tiles at 390x844, Home's Glance tiles at 320x568.
- The hooked states match the real path (open the sheet, press Hidden, wait 10 s, press the restore button) on 90 of 90 page and size pairs, and the WebGL orb mounted inside the CSS orb's box on 90 of 90.
- No page error, no mount failure, no sample point that lost the probe.

## Covered items by page and size

Counts of distinct covered items in any view of the page (c controls, t text runs, g graphics; · nothing covered; empty: not measured).

**The orb at rest**

| Page | 1920x1080 | 1440x820 | 1024x768 | 390x844 | 320x568 |
|---|---|---|---|---|---|
| Home | 1c | 1t | 1c | 3c 1t | 4c 2t |
| Bullish board | · | · | · | · | 2c 1t |
| Bearish board | · | · | · | · | 2c 1t |
| Watchlist | · | · | · | · | · |
| Market | · | · | · | · | · |
| Network | · | · | · | · | 1t |
| Now | · | · | · | · | · |
| Moves | · | · | · | 2c 1t | 2c |
| Unusual | 1c | 1c 1t | 2c 1t 1g | 2c 1t | 7c 4t |
| Flow Lab | 1t | 1t | 3t | 1c 9t 2g | 3c 16t 2g |
| Ledger | · | · | 1c | 1c 1t | 1c 4t |
| Events | 1c | 2c | · | 2c | 3c 3t |
| Political | · | · | · | 1t | 1c 2t 1g |
| Strategy | 1c | 1c | · | 1c | 3c |
| Premium desk | 2c | 1c | 1c | 1t | 1c |
| Ticker | · | 1c | · | · | 4c |
| Status | 1t | 1t | 1t | 1t | 9t 1g |
| Fire | · | · | 1c | 1c 1t | 2c |

**The pill and badge (desktop) or the toast and badge (phone)**

| Page | 1920x1080 | 1440x820 | 1024x768 | 390x844 | 320x568 |
|---|---|---|---|---|---|
| Home | 2c 3t 1g | 6t | 2c 2t 1g | 6c 3t 1g | 11c 10t 1g |
| Bullish board | · | · | · | 1c 1t 1g | 4c 1t |
| Bearish board | · | · | · | 1c 1t 1g | 4c 1t |
| Watchlist | · | · | · | · | 1g |
| Market | 1t 1g | 3c 7t 5g | 2c 5t 4g | 12c 11t 6g | 25c 58t 17g |
| Network | · | · | · | 1c 1g | 1t |
| Now | · | · | · | 1t | 1t |
| Moves | · | · | · | 3c 5t 1g | 3c 18t 2g |
| Unusual | 2c | 1c 2t 1g | 2c 3t 2g | 5c 8t 6g | 12c 9t |
| Flow Lab | 5t 1g | 6t 1g | 14t 1g | 5c 31t 4g | 16c 29t 4g |
| Ledger | · | 1t | 1c 1t | 1c 6t | 6c 13t |
| Events | 1c | 2c | · | 5c 5t 2g | 13c 18t |
| Political | 1t | 1t | 1t | 5c 6t | 4c 7t 1g |
| Strategy | 4c 1t 1g | 1c 1t | · | 2c | 7c |
| Premium desk | 2c 2t | 1c 2t | 1c 3t | 3t | 7c 1g |
| Ticker | 1c | 3c | 2c | 5c | 6c 1t 1g |
| Status | 2t | 1t | 1t | 1c 7t 1g | 1c 48t 3g |
| Fire | · | · | 1c | 1c 1t | 7c 1t |

**The 10 s Undo chip or the restore button**

| Page | 1920x1080 | 1440x820 | 1024x768 | 390x844 | 320x568 |
|---|---|---|---|---|---|
| Home | 2c 1t 1g | 3t | 1c 2t 1g | 4c 1t | 5c 3t 1g |
| Bullish board | · | · | · | · | 3c 1t |
| Bearish board | · | · | · | · | 3c 1t |
| Watchlist | · | · | · | · | 2t |
| Market | 1g | 3c 4t 1g | 2c 3t | · | · |
| Network | · | · | · | 1c | 1c 1t |
| Now | · | · | · | · | · |
| Moves | · | · | · | 2c 2t | 2c 5t |
| Unusual | 1c | 1c 1t | 2c 2t 2g | 3c | 6c 9t |
| Flow Lab | 4t 1g | 5t 1g | 10t 1g | 1c 22t 3g | 3c 36t 5g |
| Ledger | · | · | 1c 1t | 4t | 2c 9t 1g |
| Events | 1c | 2c | · | 1c 2t 1g | 4c 8t 2g |
| Political | · | · | · | 4t 1g | 2c 6t 1g |
| Strategy | 3c 1t 1g | 1c | · | 1c 1g | 2c |
| Premium desk | 1c 1t | 1c | 1c | 4t | 2c 3t 2g |
| Ticker | 1c | 2c | 1c | 1t | 5c 1g |
| Status | 1t | 1t | 1t | 1t | 24t 1g |
| Fire | · | · | 1c | 1c 1t | 3c 1t |

**Any state with the Ask dock open**

| Page | 1920x1080 | 1440x820 | 1024x768 | 390x844 | 320x568 |
|---|---|---|---|---|---|
| Home | 4t | 1c | 1c | · | · |
| Bullish board | · | · | · | · | · |
| Bearish board | · | · | · | · | · |
| Watchlist | · | · | · | · | · |
| Market | 1t | · | 2c 1t | · | · |
| Network | · | · | · | · | · |
| Now | · | · | · | · | · |
| Moves | · | 2t 1g | 6t 1g | · | · |
| Unusual | 1t 1g | 1g | 1g | · | · |
| Flow Lab | 3t | 3t | 6t | · | · |
| Ledger | 1t | 1c 3t | 2c 5t | · | · |
| Events | · | · | · | · | · |
| Political | · | 1c 2t | 1c 3t 2g | · | · |
| Strategy | 1c | 1c 1t | · | · | · |
| Premium desk | · | · | · | · | · |
| Ticker | 3c | 2c | 2c | · | · |
| Status | 1t | 5t | 4t | · | · |
| Fire | · | · | 1c 1t | · | · |

## Free corner by page and size

Each cell is the side of the largest square anchored at the content corner that holds no content, then the distance to the nearest content, both in CSS px, default view, page scrolled to the top (`corner` in each run of the inventory has both, the point and the element). The content corner is the viewport's bottom-right corner on a desktop and the top of the tab bar on a phone (the tab bar is 50 px tall at 390x844 and 320x568; phone cells add the same two figures measured from the viewport's own corner). A free square says nothing about the pill, which reaches 324 × 76 px from the corner on a desktop; the state tables measure it directly. The orb needs 76 px on a desktop (24 px gap plus 52 px) and 68 px on a phone (16 px gap plus 52 px, 12 px above the tab bar); ✗ marks a corner smaller than that. Content means a control, a text run or a graphic (canvas pixels, SVG marks, an image, a painted leaf box such as a meter bar); chrome (top bar, tab bar, sidebar, dock) is not content here.

| Page | 1920x1080 | 1440x820 | 1024x768 | 390x844 | 320x568 |
|---|---|---|---|---|---|
| Home | 60 / 84 ✗ | 47 / 63 ✗ | 74 / 83 ✗ | 38 / 53 ✗ · viewport 78 / 92 | 37 / 53 ✗ · viewport 79 / 92 |
| Bullish board | 88 / 103 | 118 / 125 | 132 / 138 | 85 / 89 · viewport 135 / 137 | 26 / 28 ✗ · viewport 60 / 65 |
| Bearish board | 88 / 103 | 118 / 125 | 132 / 138 | 85 / 89 · viewport 135 / 137 | 26 / 28 ✗ · viewport 60 / 65 |
| Watchlist | free (none in 720×480) | 558 / 663 | 402 / 406 | 255 / 311 · viewport 305 / 354 | 116 / 118 · viewport 116 / 136 |
| Market | 194 / 218 | 183 / 202 | 179 / 204 | 82 / 93 · viewport 132 / 139 | 80 / 87 · viewport 130 / 134 |
| Network | 346 / 362 | 82 / 104 | 98 / 114 | 105 / 113 · viewport 147 / 161 | 56 / 71 ✗ · viewport 78 / 93 |
| Now | 137 / 161 | 140 / 151 | 148 / 158 | 135 / 140 · viewport 185 / 189 | 114 / 119 · viewport 128 / 168 |
| Moves | 93 / 116 | 95 / 110 | 95 / 110 | 51 / 61 ✗ · viewport 83 / 97 | 83 / 87 · viewport 119 / 136 |
| Unusual | 96 / 124 | 82 / 96 | 54 / 76 ✗ | 68 / 72 · viewport 118 / 120 | 37 / 38 ✗ · viewport 59 / 70 |
| Flow Lab | 66 / 84 ✗ | 65 / 77 ✗ | 65 / 77 ✗ | 33 / 41 ✗ · viewport 75 / 82 | 40 / 40 ✗ · viewport 50 / 64 |
| Ledger | 174 / 181 | 85 / 94 | 47 / 62 ✗ | 58 / 59 ✗ · viewport 64 / 86 | 38 / 38 ✗ · viewport 50 / 63 |
| Events | 290 / 372 | 138 / 183 | 123 / 148 | 138 / 144 · viewport 188 / 193 | 69 / 86 · viewport 119 / 129 |
| Political | 98 / 132 | 96 / 122 | 96 / 128 | 55 / 66 ✗ · viewport 87 / 103 | 58 / 74 ✗ · viewport 108 / 117 |
| Strategy | 63 / 74 ✗ (scrolls) | 35 / 35 ✗ (scrolls) | 246 / 309 (scrolls) | 132 / 174 · viewport 164 / 199 (scrolls) | 19 / 19 ✗ · viewport 51 / 54 (scrolls) |
| Premium desk | 594 / 692 | 426 / 438 | 366 / 372 | 160 / 183 · viewport 210 / 232 | 29 / 30 ✗ · viewport 59 / 66 |
| Ticker | 82 / 104 | 58 / 68 ✗ | 92 / 98 | 71 / 76 · viewport 121 / 124 (scrolls) | 29 / 29 ✗ · viewport 51 / 58 (scrolls) |
| Status | 53 / 74 ✗ | 68 / 79 ✗ | 68 / 79 ✗ | 131 / 135 · viewport 181 / 184 | 50 / 58 ✗ · viewport 100 / 104 |
| Fire | free (none in 720×480) | 475 / 658 | 49 / 63 ✗ | 47 / 58 ✗ · viewport 85 / 97 | 24 / 28 ✗ · viewport 60 / 67 |

## The Neuron's parts

Boxes in viewport px, read from the module's own elements after it painted each state (one representative page per size; the parts are fixed to the viewport, so every page shares them).

| Size | State | Parts (x, y, w × h, corner radius) |
|---|---|---|
| 1920x1080 | rest | orb 1844, 1004, 52 × 52, r 26 |
| 1920x1080 | pill | orb 1844, 1004, 52 × 52, r 26; pill 1596, 1004, 300 × 52, r 26 “●GOOGL · flow in one expiry”; badge 1880, 1000, 20 × 20, r 10 “1” |
| 1920x1080 | badge | orb 1844, 1004, 52 × 52, r 26; badge 1880, 1000, 20 × 20, r 10 “1” |
| 1920x1080 | undo | undo 1706.9, 1012, 189.1 × 44, r 22 “Neuron hiddenUndo” |
| 1920x1080 | restore | restore 1860, 1020, 36 × 36, r 18 “Neuron hiddenUndo” |
| 1440x820 | rest | orb 1364, 744, 52 × 52, r 26 |
| 1440x820 | pill | orb 1364, 744, 52 × 52, r 26; pill 1116, 744, 300 × 52, r 26 “●GOOGL · flow in one expiry”; badge 1400, 740, 20 × 20, r 10 “1” |
| 1440x820 | badge | orb 1364, 744, 52 × 52, r 26; badge 1400, 740, 20 × 20, r 10 “1” |
| 1440x820 | undo | undo 1226.9, 752, 189.1 × 44, r 22 “Neuron hiddenUndo” |
| 1440x820 | restore | restore 1380, 760, 36 × 36, r 18 “Neuron hiddenUndo” |
| 1024x768 | rest | orb 948, 692, 52 × 52, r 26 |
| 1024x768 | pill | orb 948, 692, 52 × 52, r 26; pill 700, 692, 300 × 52, r 26 “●GOOGL · flow in one expiry”; badge 984, 688, 20 × 20, r 10 “1” |
| 1024x768 | badge | orb 948, 692, 52 × 52, r 26; badge 984, 688, 20 × 20, r 10 “1” |
| 1024x768 | undo | undo 810.9, 700, 189.1 × 44, r 22 “Neuron hiddenUndo” |
| 1024x768 | restore | restore 964, 708, 36 × 36, r 18 “Neuron hiddenUndo” |
| 390x844 | rest | orb 322, 730, 52 × 52, r 26 |
| 390x844 | badge | orb 322, 730, 52 × 52, r 26; badge 358, 726, 20 × 20, r 10 “1” |
| 390x844 | toast | orb 322, 730, 52 × 52, r 26; badge 358, 726, 20 × 20, r 10 “1”; toast 165, 675, 209 × 43, r 14 “GOOGL · flow in one expiry” |
| 390x844 | undo | undo 184.9, 738, 189.1 × 44, r 22 “Neuron hiddenUndo” |
| 390x844 | restore | restore 330, 738, 44 × 44, r 22 “Neuron hiddenUndo” |
| 320x568 | rest | orb 252, 454, 52 × 52, r 26 |
| 320x568 | badge | orb 252, 454, 52 × 52, r 26; badge 288, 450, 20 × 20, r 10 “1” |
| 320x568 | toast | orb 252, 454, 52 × 52, r 26; badge 288, 450, 20 × 20, r 10 “1”; toast 95, 399, 209 × 43, r 14 “GOOGL · flow in one expiry” |
| 320x568 | undo | undo 114.9, 462, 189.1 × 44, r 22 “Neuron hiddenUndo” |
| 320x568 | restore | restore 260, 462, 44 × 44, r 22 “Neuron hiddenUndo” |

The pill, the count badge and the phone toast come only from a live flow message, which reaches the Neuron on pages that subscribe it to the flow topic of the real-time rail (Home, Bullish board, Bearish board, Watchlist, Market, Network, Now, Ticker, Moves, Unusual, Ledger), or from a signal record on the ticker page. On Premium desk, Strategy, Flow Lab, Events, Political, Status, Fire the Neuron is not subscribed, so those three states cannot occur there today; they are measured anyway because a later change could subscribe them.

## The orb at rest

| Page | View | Size | Kind | What is covered | Area px² in this state |
|---|---|---|---|---|---:|
| Home | Glance | 390x844 | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 2108 |
| Home | Glance | 320x568 | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 2108 |
| Ledger | Ledger | 320x568 | control | region: Ledger, scrollable · div#sfMatrix.sf-mat | 2108 |
| Moves | Lists | 390x844 | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 1780 |
| Moves | Lists | 320x568 | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 1780 |
| Premium desk | default | 320x568 | control | group: Frontier. Use the arrow keys to step through the lines. · div#dkScatter.dk-scatter.ui-chart > div.tl-scrub | 1700 |
| Fire | default | 320x568 | control | button: Implied move above past report moves Nightly · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 1540 |
| Flow Lab | Screen › Presets | 320x568 | control | radio: Volume above open interest — · div#flPresetB.fl-body > button.fl-pre | 1460 |
| Ticker | default | 320x568 | control | tab: 1Y · span#ftGRange > div.ui-seg > button.ui-seg-i | 1396 |
| Unusual | Names | 1024x768 | control | a: GOOG 4 windows $9.59M 83% , Ask-side share of the premium the feed sided: 83% ask side … · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 1208 |
| Unusual | Timeline | 320x568 | control | group: Flagged windows over the session. Use the arrow keys to read each window. · div#uaTimeline.fd-body > div.fu-chart.ui-chart | 1120 |
| Events | Earnings | 320x568 | control | a: Tue Aug 25 SYN151 ±6.0% — · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow | 1052 |
| Ledger | default | 1024x768 | control | button: Show all 13 · button#sfAll.link.sf-all | 1028 |
| Unusual | Names | 1440x820 | control | a: SYN200 4 windows $9.21M 79% thin , Ask-side share of the premium the feed sided: 79% as… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 1020 |
| Strategy | default | 1440x820 | control | button: About greeks · section#sgGreeksM.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 1016 |
| Fire | default | 1024x768 | control | button: Sector premium surge with breadth Nightly — no record · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 996 |
| Home | default | 390x844 | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 992 |
| Home | default | 320x568 | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 992 |
| Political | Detail | 320x568 | control | button: 90 d · div.pl-rc.chart > h3 > span.pl-seg.sm > button | 984 |
| Home | Glance | 320x568 | control | button: Synthetic headline 1 about SYN090 (inert, still drawn) · div#ccNews.hm-body > button.hm-news-open | 944 |
| Home | Names | 320x568 | control | a: SYN326, score −44, conviction 95, price −0.82%, net premium $3.2M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 892 |
| Premium desk | Lines | 1920x1080 | control | button: About NVDA 103 call · div#dkList.dk-list > div.dk-row > button.ui-info.ui-info--sm | 884 |
| Unusual | Names | 390x844 | control | a: SYN003 4 windows $10.0M 57% , Ask-side share of the premium the feed sided: 57% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 768 |
| Bullish board | default | 320x568 | control | a: SYN351, rank 1, score 58, last 376.75, +0.26% today, conviction 93, with 2 of 2 signed ax… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 720 |
| Bearish board | default | 320x568 | control | a: SYN300, rank 1, score -52, last 146.27, +0.45% today, conviction 92, with 2 of 2 signed a… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 720 |
| Ticker | default | 1440x820 | control | section: Range · section#ftgc-range-9.ftg-card | 720 |
| Events | Earnings | 1440x820 | control | a: Wed Aug 26 SYN400 ±4.5% ±4.3% 25% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 612 |
| Flow Lab | Strikes | 390x844 | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 584 |
| Flow Lab | Strikes | 320x568 | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 584 |
| Bullish board | default | 320x568 | control | summary: Export · div#bdTools.bd-tools > details.ui-exp > summary.ui-exp-b | 572 |
| Bearish board | default | 320x568 | control | summary: Export · div#bdTools.bd-tools > details.ui-exp > summary.ui-exp-b | 572 |
| Events | Reaction | 1440x820 | control | a: SYN078 +4.2% 0.45× · div#evReact.fd-body > div.ui-list.fu-list > a.fe-rrow | 544 |
| Premium desk | Lines | 1440x820 | control | button: About NVDA 103 call · div#dkList.dk-list > div.dk-row > button.ui-info.ui-info--sm | 520 |
| Premium desk | Lines | 1024x768 | control | button: About NVDA 100 call · div#dkList.dk-list > div.dk-row > button.ui-info.ui-info--sm | 496 |
| Home | Names | 390x844 | control | a: SYN182, score −36, conviction 69, price −0.51%, net premium −$29.9M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 480 |
| Unusual | default | 320x568 | control | button: Table · div.nm-bar > div.nm-ctl > div.nm-seg > button | 400 |
| Strategy | default | 1920x1080 | control | button: About legs · section#sgLegsM.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 396 |
| Strategy | default | 390x844 | control | button: + Add leg · button#sgAdd.tl-addrow | 380 |
| Strategy | default | 320x568 | control | button: + Add leg · button#sgAdd.tl-addrow | 380 |
| Unusual | Urgency | 390x844 | control | a: SYN003 54 alerts · 47% sweep 0.85% · div#uaUrgency.fd-body > div.ui-list.fu-list > a.fu-urow | 340 |
| Events | Earnings | 390x844 | control | a: Wed Aug 26 SYN324 ±3.7% ±3.9% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 340 |
| Moves | Lists | 390x844 | control | button: SYN404 down −2.2 IV-days, −2.9% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 328 |
| Moves | Lists | 320x568 | control | button: SYN404 down −2.2 IV-days, −2.9% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 328 |
| Events | FDA | 320x568 | control | a: SYN074 Data Q4 2026 · div#evFda.fd-body > div > div.ui-list.fu-list > a.fe-frow | 328 |
| Fire | default | 320x568 | control | button: Implied move below past report moves Nightly · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 308 |
| Unusual | Timeline | 1024x768 | control | group: Flagged windows over the session. Use the arrow keys to read each window. · div#uaTimeline.fd-body > div.fu-chart.ui-chart | 288 |
| Ticker | default | 320x568 | control | img: NVDA price, the priced range and the real-world range, with levels and dealer gamma · div#ftGlanceChart.ft-glance-chart.ftg-host > div.ftg-chart > div.ftg-box > svg.ftg-svg | 284 |
| Unusual | Vol/OI | 320x568 | control | button: About volume over open interest · section#uaFeedCard.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 244 |
| Home | default | 1920x1080 | control | a: all 0 inside the dead band — open the watch board · a#ccWatchSub.hm-count | 232 |
| Unusual | Timeline | 320x568 | control | button: About the timeline · section#uaTimelineCard.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 168 |
| Unusual | Names | 320x568 | control | button: About names · section#uaNamesCard.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 168 |
| Unusual | Urgency | 320x568 | control | button: About urgency · section#uaUrgencyCard.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 168 |
| Unusual | Surprise | 320x568 | control | button: About volume surprise · section#uaSurpriseCard.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 168 |
| Unusual | Names | 1920x1080 | control | a: SYN129 2 windows $5.18M 66% , Ask-side share of the premium the feed sided: 66% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 144 |
| Flow Lab | Screen › Presets | 320x568 | control | radio: Mostly sweeps — · div#flPresetB.fl-body > button.fl-pre | 144 |
| Strategy | default | 320x568 | control | radio: Oct 16, 53 days, 90 listed · div.tl-exprow > div.tl-stripw.is-r > div.tl-strip.tl-exp > button.tl-chip | 100 |
| Fire | default | 390x844 | control | button: Sector premium surge with breadth Nightly — no record · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 100 |
| Events | Earnings | 1920x1080 | control | a: Fri Aug 28 SYN332 ±5.2% ±3.4% 33% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 72 |
| Events | Reaction | 320x568 | control | a: SYN342 +0.8% +0.6 · section.fe-recent > div > div.ui-list.fu-list > a.fe-rrow | 60 |
| Events | Reaction | 390x844 | control | a: SYN078 +4.2% 0.45× · div#evReact.fd-body > div.ui-list.fu-list > a.fe-rrow | 48 |
| Ticker | default | 320x568 | control | tab: Surface & terrain · button#ftTabSurface.ui-seg-i | 48 |
| Ticker | default | 320x568 | control | tab: 6M · span#ftGRange > div.ui-seg > button.ui-seg-i | 48 |
| Home | default | 1024x768 | control | button: Why · div#ccWatch.hm-body > div.ui-silent.hm-hush > button | 44 |
| Strategy | default | 320x568 | control | button: About payoff · section#sgPayoffM.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 44 |
| Premium desk | Lines | 1920x1080 | control | button: About NVDA 105 call · div#dkList.dk-list > div.dk-row > button.ui-info.ui-info--sm | 12 |
| Ledger | Sectors | 390x844 | control | button: Show all 13 · button#sfAll.link.sf-all | 4 |
| Status | Latency › Session | 320x568 | text | Price age on each Tier 2 pass, in TRT; the rail's own latency stays in memory and is not … [covered: ys in memory and is noted: the live window, 20 min. 1 ofp90 past it. The largest age ran] · div#stSession.st-cb > p.st-foot | 996 |
| Status | Latency › Session | 390x844 | text | Price age on each Tier 2 pass, in TRT; the rail's own latency stays in memory and is not … [covered: ecorded. Dashed: the livees had p90 past it. The largestss; every figure is in Details.] · div#stSession.st-cb > p.st-foot | 648 |
| Flow Lab | Lit prints › Newest prints for the name | 320x568 | text | $50.3K · table.fl-t > tbody > tr > td.num | 636 |
| Home | Flow | 320x568 | text | $3.0M · div > div.ui-list > div.ui-row.hm-arow > span.ui-row-v | 588 |
| Events | Reaction | 320x568 | text | Typical days · div#evReact.fd-body > section.fe-recent > div.fe-rrow.fu-head > span.fu-v | 576 |
| Flow Lab | default | 390x844 | text | The feed returns contracts with 200 or more contracts only. [covered: with 200 or more contracts only.] · p#flScreenN.fl-note > span | 568 |
| Unusual | Vol/OI | 1440x820 | text | 40% sweep-coded · div#uaFeed.fd-body > div.ui-list.fu-list > div.fu-arow > span.fu-v.fu-wide | 536 |
| Flow Lab | Routing | 320x568 | text | $640K · 50% calls [covered: $640K · 5] · div.fl-route > div.fl-bars > div.fl-brow > span.fl-bs | 536 |
| Unusual | Urgency | 320x568 | text | of ADV · div#uaUrgency.fd-body > div.fu-urow.fu-head > span.fu-v | 528 |
| Events | FDA | 320x568 | text | Mid 2026 · div > div.ui-list.fu-list > div.fe-frow > span.fu-v | 528 |
| Flow Lab | Greeks | 390x844 | text | Solid line: delta flow. Dashed line: vega flow. Triangles show the sign of directional de… [covered: Solid line: delta Triangles show the sign of] · p#flGreeksN.fl-note > span | 524 |
| Status | default | 320x568 | text | 2026-10-12: 120 written, 4 partial, 1 failed [covered: 2026-10-12: 120written, 4 partial,] · tbody > tr > td > span.st-t | 476 |
| Home | default | 1440x820 | text | gated · div.ui-list > div.ui-row > span.ui-row-v > span.hm-tag | 436 |
| Unusual | Surprise | 320x568 | text | Both · div#uaSurprise.fd-body > div.fu-srow.fu-head > span.fu-v | 384 |
| Flow Lab | Greeks › Premium by expiry | 320x568 | text | +$85.0K · tbody > tr > td.num > span.ds-sg | 380 |
| Flow Lab | Ladders | 390x844 | text | Bin width 0.50. Off-exchange share is off-exchange stock volume over lit plus off-exchang… [covered: e share is off-exchange stockange, per price bin.] · p#flLadderN.fl-note > span | 376 |
| Flow Lab | Lit prints | 1024x768 | text | $404K · table.fl-t > tbody > tr > td.num | 372 |
| Unusual | Vol/OI | 320x568 | text | Ratio · div#uaFeed.fd-body > div.fu-crow.fu-head > span.fu-v | 364 |
| Status | default | 1920x1080 | text | unset · table.st-mt > tbody > tr > td | 360 |
| Flow Lab | Strikes | 320x568 | text | Strike rows carry no expiry, so no share hedge is computed. [covered: y no expiry, so no share hedge] · p#flStrikesN.fl-note > span | 348 |
| Flow Lab | Groups | 390x844 | text | Net call minus put premium. Relative shape only; the feed states no unit. [covered: Relative shape only; the feed] · p#flGroupsN.fl-note > span | 344 |
| Ledger | default | 320x568 | text | Takers bought 59% of premium with a stated side; bounds 38–74%. [covered: 59% of premium with a stated8–74%.] · p#sfLeanLine.hr-ln | 344 |
| Unusual | Names | 320x568 | text | Ask · div#uaNames.fd-body > div.fu-nrow.fu-head > span.fu-v | 320 |
| Status | Coverage › Coverage | 320x568 | text | 03:30 TRT · session 2026-10-09 [covered: 03:] · table.st-mt > tbody > tr > td | 320 |
| | | | | 54 more in inventory.json | |

## The signal pill and badge (desktop)

| Page | View | Size | Kind | What is covered | Area px² in this state |
|---|---|---|---|---|---:|
| Unusual | Names | 1920x1080 | control | a: SYN129 2 windows $5.18M 66% , Ask-side share of the premium the feed sided: 66% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 11512 |
| Unusual | Names | 1024x768 | control | a: GOOG 4 windows $9.59M 83% , Ask-side share of the premium the feed sided: 83% ask side … · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 11128 |
| Unusual | Names | 1440x820 | control | a: SYN200 4 windows $9.21M 79% thin , Ask-side share of the premium the feed sided: 79% as… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 9452 |
| Fire | default | 1024x768 | control | button: Sector premium surge with breadth Nightly — no record · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 7964 |
| Market | Indices | 1440x820 | control | group: Implied volatility by tenor for the index ETFs. Use the arrow keys to read values. · div#mkVol.mk-body > div.mk-term.ui-chart | 6704 |
| Events | Earnings | 1920x1080 | control | a: Fri Aug 28 SYN332 ±5.2% ±3.4% 33% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 6468 |
| Events | Earnings | 1440x820 | control | a: Wed Aug 26 SYN400 ±4.5% ±4.3% 25% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 6068 |
| Events | Reaction | 1440x820 | control | a: SYN078 +4.2% 0.45× · div#evReact.fd-body > div.ui-list.fu-list > a.fe-rrow | 5504 |
| Market | Extremes | 1440x820 | control | summary: Notes and what the picture is not · div#mkSkyline.mk-body > details.mk-sky-nd > summary | 5388 |
| Market | Prints | 1024x768 | control | group: Call and put contracts per session. Use the arrow keys to read values. · div#mkVolume.mk-body > div.mk-pairs-w > div.mk-pairs.ui-chart | 5336 |
| Market | Indices | 1024x768 | control | group: Implied volatility by tenor for the index ETFs. Use the arrow keys to read values. · div#mkVol.mk-body > div.mk-term.ui-chart | 4424 |
| Market | Prints | 1440x820 | control | group: Call and put contracts per session. Use the arrow keys to read values. · div#mkVolume.mk-body > div.mk-pairs-w > div.mk-pairs.ui-chart | 3968 |
| Ticker | default | 1920x1080 | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 3840 |
| Ticker | default | 1024x768 | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 3840 |
| Ticker | default | 1440x820 | control | section: Range · section#ftgc-range-9.ftg-card | 3560 |
| Unusual | Timeline | 1024x768 | control | group: Flagged windows over the session. Use the arrow keys to read each window. · div#uaTimeline.fd-body > div.fu-chart.ui-chart | 3264 |
| Ticker | default | 1440x820 | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 3200 |
| Strategy | default | 1920x1080 | control | tab: Fill · div#sgBasis.ui-seg > button.ui-seg-i | 2888 |
| Strategy | default | 1920x1080 | control | tab: Natural · div#sgBasis.ui-seg > button.ui-seg-i | 2888 |
| Ledger | default | 1024x768 | control | button: Show all 13 · button#sfAll.link.sf-all | 2612 |
| Strategy | default | 1920x1080 | control | tab: Mid · div#sgBasis.ui-seg > button.ui-seg-i | 2288 |
| Ticker | default | 1440x820 | control | section: Earnings · section#ftgc-earnings-8.ftg-card | 1920 |
| Strategy | default | 1920x1080 | control | button: About legs · section#sgLegsM.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 1748 |
| Premium desk | Lines | 1920x1080 | control | button: About NVDA 103 call · div#dkList.dk-list > div.dk-row > button.ui-info.ui-info--sm | 1232 |
| Strategy | default | 1440x820 | control | button: About greeks · section#sgGreeksM.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 1208 |
| Home | default | 1920x1080 | control | button: Why · div#ccWatch.hm-body > div.ui-silent.hm-hush > button | 1072 |
| Home | default | 1024x768 | control | button: Why · div#ccWatch.hm-body > div.ui-silent.hm-hush > button | 1024 |
| Unusual | Names | 1920x1080 | control | a: SYN277 2 windows $5.18M 80% , Ask-side share of the premium the feed sided: 80% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 952 |
| Home | default | 1024x768 | control | button: Show all · section#hmEvents.ui-card.ui-mod > header.ui-mod-h > button.hm-all | 672 |
| Home | default | 1920x1080 | control | a: all 0 inside the dead band — open the watch board · a#ccWatchSub.hm-count | 556 |
| Premium desk | Lines | 1440x820 | control | button: About NVDA 103 call · div#dkList.dk-list > div.dk-row > button.ui-info.ui-info--sm | 556 |
| Premium desk | Lines | 1024x768 | control | button: About NVDA 100 call · div#dkList.dk-list > div.dk-row > button.ui-info.ui-info--sm | 516 |
| Premium desk | Lines | 1920x1080 | control | button: About NVDA 105 call · div#dkList.dk-list > div.dk-row > button.ui-info.ui-info--sm | 56 |
| Ticker | default | 1024x768 | control | button: Flow network · nav#ftDock.ft-dock > button.ft-dock-b | 4 |
| Market | Network | 1024x768 | text | Lean is a convention: calls on the ask side and puts on the bid side read bullish, calls … [covered: onvention: calls on the ask side and putsside read bullish, calls on the bid side and ask…] · div#mkNet.mk-body > div.nm > div.nm-legend > span.nm-lg.nm-conv | 7716 |
| Flow Lab | Greeks | 1024x768 | text | By convention: a fill on the ask side is a buy. [covered: By convention: a fill on the ask side is a buy] · p#flRecentN.fl-note > span | 3904 |
| Flow Lab | default | 1024x768 | text | 1 contract has no ratio and is not drawn. · p#flScatterN.fl-note | 3520 |
| Market | Network | 1440x820 | text | Lean is a convention: calls on the ask side and puts on the bid side read bullish, calls … [covered: the bid side and puts on the ask side] · div#mkNet.mk-body > div.nm > div.nm-legend > span.nm-lg.nm-conv | 3288 |
| Flow Lab | Greeks | 1440x820 | text | By convention: a fill on the ask side is a buy. [covered: ntion: a fill on the ask side is a buy.] · p#flRecentN.fl-note > span | 3072 |
| Flow Lab | Greeks | 1920x1080 | text | By convention: a fill on the ask side is a buy. [covered: ion: a fill on the ask side is a buy.] · p#flRecentN.fl-note > span | 2880 |
| | | | | 85 more in inventory.json | |

## The count badge (Count preference)

| Page | View | Size | Kind | What is covered | Area px² in this state |
|---|---|---|---|---|---:|
| Home | Glance | 390x844 | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 2264 |
| Home | Glance | 320x568 | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 2264 |
| Ledger | Ledger | 320x568 | control | region: Ledger, scrollable · div#sfMatrix.sf-mat | 2264 |
| Moves | Lists | 390x844 | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 1792 |
| Moves | Lists | 320x568 | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 1792 |
| Premium desk | default | 320x568 | control | group: Frontier. Use the arrow keys to step through the lines. · div#dkScatter.dk-scatter.ui-chart > div.tl-scrub | 1708 |
| Fire | default | 320x568 | control | button: Implied move above past report moves Nightly · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 1596 |
| Flow Lab | Screen › Presets | 320x568 | control | radio: Volume above open interest — · div#flPresetB.fl-body > button.fl-pre | 1464 |
| Ticker | default | 320x568 | control | tab: 1Y · span#ftGRange > div.ui-seg > button.ui-seg-i | 1396 |
| Unusual | Names | 1024x768 | control | a: GOOG 4 windows $9.59M 83% , Ask-side share of the premium the feed sided: 83% ask side … · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 1208 |
| Unusual | Timeline | 320x568 | control | group: Flagged windows over the session. Use the arrow keys to read each window. · div#uaTimeline.fd-body > div.fu-chart.ui-chart | 1120 |
| Events | Earnings | 320x568 | control | a: Tue Aug 25 SYN151 ±6.0% — · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow | 1052 |
| Ledger | default | 1024x768 | control | button: Show all 13 · button#sfAll.link.sf-all | 1040 |
| Unusual | Names | 1440x820 | control | a: SYN200 4 windows $9.21M 79% thin , Ask-side share of the premium the feed sided: 79% as… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 1020 |
| Fire | default | 1024x768 | control | button: Sector premium surge with breadth Nightly — no record · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 1020 |
| Strategy | default | 1440x820 | control | button: About greeks · section#sgGreeksM.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 1016 |
| Home | default | 390x844 | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 992 |
| Home | default | 320x568 | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 992 |
| Political | Detail | 320x568 | control | button: 90 d · div.pl-rc.chart > h3 > span.pl-seg.sm > button | 984 |
| Home | Glance | 320x568 | control | button: Synthetic headline 1 about SYN090 (inert, still drawn) · div#ccNews.hm-body > button.hm-news-open | 944 |
| | | | | 125 more in inventory.json | |

## The phone toast

| Page | View | Size | Kind | What is covered | Area px² in this state |
|---|---|---|---|---|---:|
| Premium desk | default | 320x568 | control | group: Frontier. Use the arrow keys to step through the lines. · div#dkScatter.dk-scatter.ui-chart > div.tl-scrub | 9872 |
| Home | Glance | 390x844 | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 9520 |
| Flow Lab | Strikes | 390x844 | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 8756 |
| Fire | default | 390x844 | control | button: Sector premium surge with breadth Nightly — no record · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 8556 |
| Political | Filings | 320x568 | control | button: SYN351 bought, $1.0M to $5.0M, traded Aug 12, filed Nov 21, 101 days late. Select SYN351 · div#plTapeList.pl-listbox > button.pl-trow | 8232 |
| Flow Lab | Strikes | 320x568 | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 8000 |
| Market | Tide | 390x844 | control | group: Market tide: net call and net put premium across the session, times in TRT. Use the arrow… · div#mkTide > div.mk-river.ui-chart | 7784 |
| Market | Indices | 390x844 | control | group: SPY options tide. Use the arrow keys to read values. · div#mkEtfSPY.mk-body > div.mk-etf-p.ui-chart | 7784 |
| Market | Indices › QQQ | 390x844 | control | group: QQQ options tide. Use the arrow keys to read values. · div#mkEtfQQQ.mk-body > div.mk-etf-p.ui-chart | 7784 |
| Market | Indices › IWM | 390x844 | control | group: IWM options tide. Use the arrow keys to read values. · div#mkEtfIWM.mk-body > div.mk-etf-p.ui-chart | 7784 |
| Fire | default | 320x568 | control | button: Upside skew flip Nightly Limited · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 7624 |
| Home | Names | 320x568 | control | a: SYN300, score −52, conviction 92, price +0.45%, net premium −$35.9M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 7400 |
| Flow Lab | Screen › Presets | 320x568 | control | radio: Largest premium 5 · div#flPresetB.fl-body > button.fl-pre | 7396 |
| Bullish board | default | 390x844 | control | a: SYN002, rank 3, score 34, last 34.87, +1.28% today, conviction 90, with 2 of 2 signed axe… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 7156 |
| Bearish board | default | 390x844 | control | a: SYN206, rank 3, score -36, last 289.23, −1.36% today, conviction 68, with 1 of 2 signed a… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 7156 |
| Political | Filings | 390x844 | control | button: SYN002 bought, $1.0M to $5.0M, traded Aug 11, filed Nov 13, 94 days late. Select SYN002 · div#plTapeList.pl-listbox > button.pl-trow | 7004 |
| Market | Indices › Expiry | 390x844 | control | group: 0DTE net premium through the session, times in TRT. Use the arrow keys to read values. · div#mkExpiry.mk-body > div.mk-expiry-p.ui-chart | 6556 |
| Unusual | Names | 390x844 | control | a: SYN208 4 windows $10.6M 70% , Ask-side share of the premium the feed sided: 70% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 6556 |
| Premium desk | Plan | 320x568 | control | input: Buying power in dollars · input#deskBP | 6420 |
| Flow Lab | Groups | 390x844 | control | button: Healthcare, net call minus put premium +$1.33M · div#flGroupsB.fl-body > div.fl-tiles > button.fl-tile | 6384 |
| Status | Latency › Session | 320x568 | control | group: Tier 2 quote age per pass. Use the arrow keys to read values. · div#stSessionChart.lt-chart.ui-chart | 5840 |
| Market | Session | 390x844 | control | button: Tables: the lanes and the largest windows · div#mkRiver.mk-body > div.mk-rv > div.mk-rv-d > button.mk-rv-tb | 5776 |
| Bullish board | default | 320x568 | control | input: Filter by ticker or sector · input#fbQ.bd-q-in | 5720 |
| Bearish board | default | 320x568 | control | input: Filter by ticker or sector · input#fbQ.bd-q-in | 5720 |
| Political | default | 320x568 | control | button: Open detail for the selected stock · button#plSelbar.pl-selbar | 5692 |
| Flow Lab | Greeks | 320x568 | control | button: Out of the money only · button#flOtm.fl-tog | 5480 |
| Events | Reaction | 390x844 | control | a: SYN078 +4.2% 0.45× · div#evReact.fd-body > div.ui-list.fu-list > a.fe-rrow | 5452 |
| Home | Names | 390x844 | control | a: SYN206, score −36, conviction 68, price −1.36%, net premium −$38.8M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 5392 |
| Home | Glance | 390x844 | control | button: Synthetic headline 1 about SYN090 (inert, still drawn) · div#ccNews.hm-body > button.hm-news-open | 5208 |
| Premium desk | Lines | 320x568 | control | select: Rank by · select#deskRank.dk-select | 5044 |
| Status | Latency › Session | 390x844 | control | group: Tier 2 quote age per pass. Use the arrow keys to read values. · div#stSessionChart.lt-chart.ui-chart | 4664 |
| Events | Earnings | 390x844 | control | a: Wed Aug 26 SYN317 ±4.8% ±3.9% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 4616 |
| Moves | Lists | 390x844 | control | button: SYN404 down −2.2 IV-days, −2.9% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 4580 |
| Moves | Lists | 320x568 | control | button: SYN404 down −2.2 IV-days, −2.9% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 4580 |
| Unusual | Urgency | 390x844 | control | a: SYN003 54 alerts · 47% sweep 0.85% · div#uaUrgency.fd-body > div.ui-list.fu-list > a.fu-urow | 4580 |
| Ticker | default | 320x568 | control | tab: Surface & terrain · button#ftTabSurface.ui-seg-i | 4528 |
| Moves | Lists | 390x844 | control | button: SYN086 up +2.2 IV-days, +2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 4508 |
| Moves | Lists | 320x568 | control | button: SYN086 up +2.2 IV-days, +2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 4508 |
| Unusual | Urgency | 390x844 | control | a: SYN351 72 alerts · 46% sweep 1.12% · div#uaUrgency.fd-body > div.ui-list.fu-list > a.fu-urow | 4228 |
| Market | default | 390x844 | control | button: Tables: the classes and their names · div#mkFloor.mk-body > div.mk-fl > div.mk-fl-d > button.mk-fl-tb | 4200 |
| | | | | 500 more in inventory.json | |

## Hidden: the 10 s Undo chip

| Page | View | Size | Kind | What is covered | Area px² in this state |
|---|---|---|---|---|---:|
| Ledger | Ledger | 320x568 | control | region: Ledger, scrollable · div#sfMatrix.sf-mat | 7892 |
| Premium desk | default | 320x568 | control | group: Frontier. Use the arrow keys to step through the lines. · div#dkScatter.dk-scatter.ui-chart > div.tl-scrub | 7524 |
| Home | Glance | 390x844 | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 7424 |
| Moves | Lists | 390x844 | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 7272 |
| Moves | Lists | 320x568 | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 7272 |
| Flow Lab | Screen › Presets | 320x568 | control | radio: Volume above open interest — · div#flPresetB.fl-body > button.fl-pre | 6160 |
| Home | Glance | 320x568 | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 5928 |
| Unusual | Names | 1920x1080 | control | a: SYN129 2 windows $5.18M 66% , Ask-side share of the premium the feed sided: 66% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 5840 |
| Fire | default | 320x568 | control | button: Implied move above past report moves Nightly · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 5648 |
| Unusual | Timeline | 320x568 | control | group: Flagged windows over the session. Use the arrow keys to read each window. · div#uaTimeline.fd-body > div.fu-chart.ui-chart | 5508 |
| Unusual | Names | 1024x768 | control | a: GOOG 4 windows $9.59M 83% , Ask-side share of the premium the feed sided: 83% ask side … · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 5368 |
| Events | Earnings | 320x568 | control | a: Tue Aug 25 SYN151 ±6.0% — · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow | 5172 |
| Unusual | Names | 1440x820 | control | a: SYN200 4 windows $9.21M 79% thin , Ask-side share of the premium the feed sided: 79% as… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 4348 |
| Bullish board | default | 320x568 | control | a: SYN351, rank 1, score 58, last 376.75, +0.26% today, conviction 93, with 2 of 2 signed ax… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 3512 |
| Bearish board | default | 320x568 | control | a: SYN300, rank 1, score -52, last 146.27, +0.45% today, conviction 92, with 2 of 2 signed a… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 3512 |
| Fire | default | 1024x768 | control | button: Sector premium surge with breadth Nightly — no record · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 3448 |
| Home | default | 390x844 | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 3444 |
| Home | default | 320x568 | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 3444 |
| Home | Names | 320x568 | control | a: SYN326, score −44, conviction 95, price −0.82%, net premium $3.2M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 3380 |
| Home | Glance | 320x568 | control | button: Synthetic headline 1 about SYN090 (inert, still drawn) · div#ccNews.hm-body > button.hm-news-open | 3016 |
| Unusual | Names | 390x844 | control | a: SYN003 4 windows $10.0M 57% , Ask-side share of the premium the feed sided: 57% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 2996 |
| Network | default | 320x568 | control | button: Legend: colours, band width, figures · div#pnNetHost.pn-host > div.nm > div.nm-legend > button.nm-link | 2992 |
| Market | Extremes | 1440x820 | control | summary: Notes and what the picture is not · div#mkSkyline.mk-body > details.mk-sky-nd > summary | 2664 |
| Market | Indices | 1440x820 | control | group: Implied volatility by tenor for the index ETFs. Use the arrow keys to read values. · div#mkVol.mk-body > div.mk-term.ui-chart | 2476 |
| Events | Earnings | 1920x1080 | control | a: Fri Aug 28 SYN332 ±5.2% ±3.4% 33% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 2476 |
| Ticker | default | 1440x820 | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 2320 |
| Events | Earnings | 1440x820 | control | a: Wed Aug 26 SYN400 ±4.5% ±4.3% 25% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 2300 |
| Strategy | default | 1920x1080 | control | tab: Natural · div#sgBasis.ui-seg > button.ui-seg-i | 2280 |
| Ticker | default | 1920x1080 | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 2164 |
| Ledger | Ledger | 320x568 | control | td: Calls, ask side, Takers held: −$25,466,768.00 · table.sf-t.sf-lt > tbody > tr > td.c | 2072 |
| Ticker | default | 1440x820 | control | section: Range · section#ftgc-range-9.ftg-card | 2024 |
| Flow Lab | Strikes | 390x844 | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 1980 |
| Flow Lab | Strikes | 320x568 | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 1980 |
| Events | Reaction | 1440x820 | control | a: SYN078 +4.2% 0.45× · div#evReact.fd-body > div.ui-list.fu-list > a.fe-rrow | 1960 |
| Ledger | default | 1024x768 | control | button: Show all 13 · button#sfAll.link.sf-all | 1904 |
| Unusual | default | 390x844 | control | button: Legend: colours, band width, figures · div#uaNet.fn-host.is-slot > div.nm > div.nm-legend > button.nm-link | 1840 |
| Ticker | default | 1024x768 | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 1840 |
| Market | Prints | 1024x768 | control | group: Call and put contracts per session. Use the arrow keys to read values. · div#mkVolume.mk-body > div.mk-pairs-w > div.mk-pairs.ui-chart | 1776 |
| Fire | default | 320x568 | control | button: Implied move below past report moves Nightly · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 1720 |
| Events | FDA | 320x568 | control | a: SYN074 Data Q4 2026 · div#evFda.fd-body > div > div.ui-list.fu-list > a.fe-frow | 1716 |
| | | | | 267 more in inventory.json | |

## Hidden: the restore button after the chip collapses

| Page | View | Size | Kind | What is covered | Area px² in this state |
|---|---|---|---|---|---:|
| Home | Glance | 390x844 | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 1500 |
| Home | Glance | 320x568 | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 1500 |
| Ledger | Ledger | 320x568 | control | region: Ledger, scrollable · div#sfMatrix.sf-mat | 1500 |
| Moves | Lists | 390x844 | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 1460 |
| Moves | Lists | 320x568 | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 1460 |
| Premium desk | default | 320x568 | control | group: Frontier. Use the arrow keys to step through the lines. · div#dkScatter.dk-scatter.ui-chart > div.tl-scrub | 1132 |
| Fire | default | 320x568 | control | button: Implied move above past report moves Nightly · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 1000 |
| Flow Lab | Screen › Presets | 320x568 | control | radio: Volume above open interest — · div#flPresetB.fl-body > button.fl-pre | 932 |
| Ticker | default | 320x568 | control | tab: 1Y · span#ftGRange > div.ui-seg > button.ui-seg-i | 884 |
| Unusual | Timeline | 320x568 | control | group: Flagged windows over the session. Use the arrow keys to read each window. · div#uaTimeline.fd-body > div.fu-chart.ui-chart | 856 |
| Events | Earnings | 320x568 | control | a: Tue Aug 25 SYN151 ±6.0% — · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow | 812 |
| Home | Glance | 320x568 | control | button: Synthetic headline 1 about SYN090 (inert, still drawn) · div#ccNews.hm-body > button.hm-news-open | 704 |
| Strategy | default | 1440x820 | control | button: About greeks · section#sgGreeksM.ui-card.ui-mod > header.ui-mod-h > button.ui-info | 648 |
| Bullish board | default | 320x568 | control | a: SYN351, rank 1, score 58, last 376.75, +0.26% today, conviction 93, with 2 of 2 signed ax… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 604 |
| Bearish board | default | 320x568 | control | a: SYN300, rank 1, score -52, last 146.27, +0.45% today, conviction 92, with 2 of 2 signed a… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 604 |
| Political | Detail | 320x568 | control | button: 90 d · div.pl-rc.chart > h3 > span.pl-seg.sm > button | 552 |
| Home | default | 390x844 | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 548 |
| Home | default | 320x568 | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 548 |
| Home | Names | 320x568 | control | a: SYN326, score −44, conviction 95, price −0.82%, net premium $3.2M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 476 |
| Unusual | Names | 390x844 | control | a: SYN003 4 windows $10.0M 57% , Ask-side share of the premium the feed sided: 57% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 384 |
| Unusual | Names | 1024x768 | control | a: GOOG 4 windows $9.59M 83% , Ask-side share of the premium the feed sided: 83% ask side … · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 364 |
| Unusual | default | 320x568 | control | button: Table · div.nm-bar > div.nm-ctl > div.nm-seg > button | 304 |
| Fire | default | 320x568 | control | button: Implied move below past report moves Nightly · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 268 |
| Events | FDA | 320x568 | control | a: SYN074 Data Q4 2026 · div#evFda.fd-body > div > div.ui-list.fu-list > a.fe-frow | 264 |
| Unusual | Names | 1440x820 | control | a: SYN200 4 windows $9.21M 79% thin , Ask-side share of the premium the feed sided: 79% as… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 256 |
| Ledger | default | 1024x768 | control | button: Show all 13 · button#sfAll.link.sf-all | 248 |
| Flow Lab | Strikes | 390x844 | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 240 |
| Flow Lab | Strikes | 320x568 | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 240 |
| Bullish board | default | 320x568 | control | summary: Export · div#bdTools.bd-tools > details.ui-exp > summary.ui-exp-b | 236 |
| Bearish board | default | 320x568 | control | summary: Export · div#bdTools.bd-tools > details.ui-exp > summary.ui-exp-b | 236 |
| | | | | 73 more in inventory.json | |

## The Ask dock open

| Page | Size | Dock | Orb moved to | Free square / nearest (px, from the dock's left edge) | Covered at rest | Covered by the pill |
|---|---|---|---|---|---|---|
| Home | 1920x1080 | beside the page | 1400, 1004 | 123 / 138 | — | text “Aug 25 · next session” 1248; text “±2.2%” 672; text “SYN383” 572; text “gated” 420 |
| Home | 1440x820 | beside the page | 920, 744 | 108 / 116 | — | control “Ask Neuron” 3976 |
| Home | 1024x768 | modal (page inert) | 504, 692 | 510 / 536 | — | control “Ask Neuron” 3976 |
| Bullish board | 1920x1080 | beside the page | 1400, 1004 | 114 / 145 | — | — |
| Bullish board | 1440x820 | beside the page | 920, 744 | 118 / 156 | — | — |
| Bullish board | 1024x768 | modal (page inert) | 504, 692 | 522 / 530 | — | — |
| Bearish board | 1920x1080 | beside the page | 1400, 1004 | 114 / 145 | — | — |
| Bearish board | 1440x820 | beside the page | 920, 744 | 118 / 156 | — | — |
| Bearish board | 1024x768 | modal (page inert) | 504, 692 | 522 / 530 | — | — |
| Watchlist | 1920x1080 | beside the page | 1400, 1004 | free / free | — | — |
| Watchlist | 1440x820 | beside the page | 920, 744 | 375 / 512 | — | — |
| Watchlist | 1024x768 | modal (page inert) | 504, 692 | 546 / 678 | — | — |
| Market | 1920x1080 | beside the page | 1400, 1004 | 197 / 247 | — | text “Height: whole-session premium, one scale” 192 |
| Market | 1440x820 | beside the page | 920, 744 | 159 / 209 | — | — |
| Market | 1024x768 | modal (page inert) | 504, 692 | 582 / 589 | — | control “Recentre” 1776; control “Tables: the classes and their names” 760; text “Height: whole-session premium, one scale” 120 |
| Network | 1920x1080 | beside the page | 1400, 1004 | 162 / 191 | — | — |
| Network | 1440x820 | beside the page | 920, 744 | 123 / 170 | — | — |
| Network | 1024x768 | modal (page inert) | 504, 692 | 534 / 552 | — | — |
| Now | 1920x1080 | beside the page | 1400, 1004 | 138 / 191 | — | — |
| Now | 1440x820 | beside the page | 920, 744 | 141 / 183 | — | — |
| Now | 1024x768 | modal (page inert) | 504, 692 | 546 / 566 | — | — |
| Moves | 1920x1080 | beside the page | 1400, 1004 | 129 / 159 | — | — |
| Moves | 1440x820 | beside the page | 920, 744 | 103 / 126 | — | text “Aug 24” 456; text “Jul 27” 376; graphic “svg (2 marks) Closes for SYN188 over 21 ” 80 |
| Moves | 1024x768 | modal (page inert) | 504, 692 | 510 / 535 | — | text “0 of 252” 768; text “Aug 24” 456; text “Jul 27” 384; text “Past 3 typical” 332 |
| Unusual | 1920x1080 | beside the page | 1400, 1004 | 117 / 150 | — | text “$10M” 544; graphic “canvas #uaNet” 128 |
| Unusual | 1440x820 | beside the page | 920, 744 | 105 / 133 | — | graphic “svg (12 marks) Flow network: Sector to S” 448 |
| Unusual | 1024x768 | modal (page inert) | 504, 692 | 534 / 538 | — | graphic “svg (12 marks) Flow network: Sector to S” 3284 |
| Flow Lab | 1920x1080 | beside the page | 1400, 1004 | 114 / 132 | — | text “1 contract has no ratio and is not drawn” 1920; text “10x” 192; text “1x” 96 |
| Flow Lab | 1440x820 | beside the page | 920, 744 | 147 / 162 | — | text “1 contract has no ratio and is not drawn” 2112; text “10x” 120; text “1x” 80 |
| Flow Lab | 1024x768 | modal (page inert) | 504, 692 | 522 / 574 | — | text “1 contract has no ratio and is not drawn” 3072; text “Times are Türkiye time (TRT). Session da” 544; text “0.10x” 128; text “10x” 80 |
| Ledger | 1920x1080 | beside the page | 1400, 1004 | 159 / 173 | — | text “Not built yet: open interest, beta adjus” 1788 |
| Ledger | 1440x820 | beside the page | 920, 744 | 103 / 135 | — | control “Show all 13” 988; text “18:00:00 TRT” 544; text “Last poll” 352; text “as of 17:55 TRT” 348 |
| Ledger | 1024x768 | modal (page inert) | 504, 692 | 462 / 523 | — | control “Show all 13” 2544; text “Every row and column sums to zero by con” 556; text “Sector tide” 448; text “18:00:00” 352 |
| Events | 1920x1080 | beside the page | 1400, 1004 | 292 / 347 | — | — |
| Events | 1440x820 | beside the page | 920, 744 | 260 / 341 | — | — |
| Events | 1024x768 | modal (page inert) | 504, 692 | 510 / 570 | — | — |
| Political | 1920x1080 | beside the page | 1400, 1004 | 147 / 177 | — | — |
| Political | 1440x820 | beside the page | 920, 744 | 102 / 142 | — | control “Open detail for the selected stock” 5724; text “◔ share still unfiled” 1152; text “Leans reducing” 288 |
| Political | 1024x768 | modal (page inert) | 504, 692 | 522 / 534 | — | control “Open detail for the selected stock” 2200; text “Leans reducing” 1092; text “Mixed” 448; text “Leans accumulating” 444 |
| Strategy | 1920x1080 | beside the page | 1400, 1004 | 108 / 108 | — | control “About legs” 704 |
| Strategy | 1440x820 | beside the page | 920, 744 | 98 / 98 | control “About greeks” 84 | control “About greeks” 1204; text “Greeks” 1088; control “About greeks” 84 |
| Strategy | 1024x768 | modal (page inert) | 504, 692 | 510 / 567 | — | — |
| Premium desk | 1920x1080 | beside the page | 1400, 1004 | 498 / 611 | — | — |
| Premium desk | 1440x820 | beside the page | 920, 744 | 330 / 450 | — | — |
| Premium desk | 1024x768 | modal (page inert) | 504, 692 | 534 / 668 | — | — |
| Ticker | 1920x1080 | beside the page | 1400, 1004 | 102 / 120 | — | control “Range” 3456; control “Every module, as one page” 2880; control “Earnings” 1040 |
| Ticker | 1440x820 | beside the page | 920, 744 | 90 / 90 | control “Range” 208; control “Positioning” 32 | control “Range” 7424; control “Positioning” 3456; control “Range” 208; control “Positioning” 32 |
| Ticker | 1024x768 | modal (page inert) | 504, 692 | 510 / 510 | control “Positioning” 356 | control “Positioning” 10672; control “Flow” 356; control “Positioning” 356 |
| Status | 1920x1080 | beside the page | 1400, 1004 | 113 / 116 | — | text “unset” 544; text “unset” 544; text “unset” 68 |
| Status | 1440x820 | beside the page | 920, 744 | 102 / 115 | — | text “+10 more switches in Details” 1152; text “FLOWS_LIVE_MODE” 1136; text “actions” 704; text “FLOWS_RT_SOCKET_HOURS” 212 |
| Status | 1024x768 | modal (page inert) | 504, 692 | 510 / 511 | text “socket” 156; text “session” 96 | text “FLOWS_RT_SOCKET_HOURS” 2816; text “FLOWS_RT_UPSTREAM” 2304; text “session” 412; text “socket” 260 |
| Fire | 1920x1080 | beside the page | 1400, 1004 | free / free | — | — |
| Fire | 1440x820 | beside the page | 920, 744 | 366 / 404 | — | — |
| Fire | 1024x768 | modal (page inert) | 504, 692 | 522 / 525 | control “Sector premium surge with breadth Nightl” 64 | control “Sector premium surge with breadth Nightl” 6892; text “A template that needs data Flows does no” 1776; control “Sector premium surge with breadth Nightl” 64 |

## Ranked list (most serious first: controls, then text, then graphics, larger areas first)

One row per covered element of a page at a size (the same element in several views or states is one row). Area is the element's covered area in its worst state, summed over the parts that cover it there; States lists every state that covers it, then the worst; the What column ends with the element's selector.

| # | Page [views] | Size | States | Part | Kind | What | Area px² |
|---:|---|---|---|---|---|---|---:|
| 1 | Unusual [Names] | 1920x1080 | rest, pill, badge, undo; worst pill | orb + pill + undo | control | a: SYN129 2 windows $5.18M 66% , Ask-side share of the premium the feed sided: 66% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 11512 |
| 2 | Unusual [Names] | 1024x768 | rest, pill, badge, undo, restore; worst pill | orb + pill + undo + restore | control | a: GOOG 4 windows $9.59M 83% , Ask-side share of the premium the feed sided: 83% ask side … · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 11128 |
| 3 | Ticker | 1024x768 | dock:rest, dock:pill, dock:badge, dock:undo; worst dock:pill | orb + pill + undo (dock open) | control | section: Positioning (inert: behind the modal Ask dock) · section#ftgc-positioning-7.ftg-card | 11028 |
| 4 | Premium desk | 320x568 | rest, badge, toast, undo, restore; worst toast | orb + badge + toast + undo + restore | control | group: Frontier. Use the arrow keys to step through the lines. · div#dkScatter.dk-scatter.ui-chart > div.tl-scrub | 9872 |
| 5 | Home [Glance] | 390x844 | rest, badge, toast, undo, restore; worst toast | orb + badge + toast + undo + restore | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 9520 |
| 6 | Unusual [Names] | 1440x820 | rest, pill, badge, undo, restore; worst pill | orb + pill + undo + restore | control | a: SYN200 4 windows $9.21M 79% thin , Ask-side share of the premium the feed sided: 79% as… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 9452 |
| 7 | Flow Lab [Strikes] | 390x844 | rest, badge, toast, undo, restore; worst toast | orb + badge + toast + undo + restore | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 8756 |
| 8 | Fire | 390x844 | rest, badge, toast; worst toast | orb + badge + toast | control | button: Sector premium surge with breadth Nightly — no record · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 8556 |
| 9 | Political [Filings] | 320x568 | toast | toast | control | button: SYN351 bought, $1.0M to $5.0M, traded Aug 12, filed Nov 21, 101 days late. Select SYN351 · div#plTapeList.pl-listbox > button.pl-trow | 8232 |
| 10 | Flow Lab [Strikes] | 320x568 | rest, badge, toast, undo, restore; worst toast | orb + badge + toast + undo + restore | control | group: Signed contracts by strike and quarter hour for SYX101. Use the arrow keys to move betwee… · div#flStrikesB.fl-body > div.fl-plot.fl-heat | 8000 |
| 11 | Fire | 1024x768 | rest, pill, badge, undo, restore; worst pill | orb + badge + pill + undo + restore | control | button: Sector premium surge with breadth Nightly — no record · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 7964 |
| 12 | Ledger [Ledger] | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + badge + undo + restore | control | region: Ledger, scrollable · div#sfMatrix.sf-mat | 7892 |
| 13 | Market [Tide] | 390x844 | toast | toast | control | group: Market tide: net call and net put premium across the session, times in TRT. Use the arrow… · div#mkTide > div.mk-river.ui-chart | 7784 |
| 14 | Market [Indices] | 390x844 | toast | toast | control | group: SPY options tide. Use the arrow keys to read values. · div#mkEtfSPY.mk-body > div.mk-etf-p.ui-chart | 7784 |
| 15 | Market [Indices › QQQ] | 390x844 | toast | toast | control | group: QQQ options tide. Use the arrow keys to read values. · div#mkEtfQQQ.mk-body > div.mk-etf-p.ui-chart | 7784 |
| 16 | Market [Indices › IWM] | 390x844 | toast | toast | control | group: IWM options tide. Use the arrow keys to read values. · div#mkEtfIWM.mk-body > div.mk-etf-p.ui-chart | 7784 |
| 17 | Ticker | 1440x820 | dock:rest, dock:pill, dock:badge, dock:undo; worst dock:pill | orb + pill + undo (dock open) | control | section: Range · section#ftgc-range-9.ftg-card | 7632 |
| 18 | Fire | 320x568 | toast | toast | control | button: Upside skew flip Nightly Limited · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 7624 |
| 19 | Home [Names] | 320x568 | toast | toast | control | a: SYN300, score −52, conviction 92, price +0.45%, net premium −$35.9M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 7400 |
| 20 | Flow Lab [Screen › Presets] | 320x568 | toast | toast | control | radio: Largest premium 5 · div#flPresetB.fl-body > button.fl-pre | 7396 |
| 21 | Moves [Lists] | 390x844 | rest, badge, toast, undo, restore; worst undo | orb + badge + undo + restore | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 7272 |
| 22 | Moves [Lists] | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + badge + undo + restore | control | button: SYN114 down −2.1 IV-days, −2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 7272 |
| 23 | Bullish board | 390x844 | toast | toast | control | a: SYN002, rank 3, score 34, last 34.87, +1.28% today, conviction 90, with 2 of 2 signed axe… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 7156 |
| 24 | Bearish board | 390x844 | toast | toast | control | a: SYN206, rank 3, score -36, last 289.23, −1.36% today, conviction 68, with 1 of 2 signed a… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 7156 |
| 25 | Political [Filings] | 390x844 | toast | toast | control | button: SYN002 bought, $1.0M to $5.0M, traded Aug 11, filed Nov 13, 94 days late. Select SYN002 · div#plTapeList.pl-listbox > button.pl-trow | 7004 |
| 26 | Fire | 1024x768 | dock:rest, dock:pill, dock:badge, dock:undo; worst dock:pill | orb + pill + undo (dock open) | control | button: Sector premium surge with breadth Nightly — no record (inert: behind the modal Ask dock) · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 6956 |
| 27 | Market [Indices] | 1440x820 | pill, undo; worst pill | pill + undo | control | group: Implied volatility by tenor for the index ETFs. Use the arrow keys to read values. · div#mkVol.mk-body > div.mk-term.ui-chart | 6704 |
| 28 | Market [Indices › Expiry] | 390x844 | toast | toast | control | group: 0DTE net premium through the session, times in TRT. Use the arrow keys to read values. · div#mkExpiry.mk-body > div.mk-expiry-p.ui-chart | 6556 |
| 29 | Unusual [Names] | 390x844 | toast | toast | control | a: SYN208 4 windows $10.6M 70% , Ask-side share of the premium the feed sided: 70% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 6556 |
| 30 | Events [Earnings] | 1920x1080 | rest, pill, badge, undo; worst pill | orb + pill + undo | control | a: Fri Aug 28 SYN332 ±5.2% ±3.4% 33% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 6468 |
| 31 | Premium desk [Plan] | 320x568 | toast | toast | control | input: Buying power in dollars · input#deskBP | 6420 |
| 32 | Flow Lab [Groups] | 390x844 | toast | toast | control | button: Healthcare, net call minus put premium +$1.33M · div#flGroupsB.fl-body > div.fl-tiles > button.fl-tile | 6384 |
| 33 | Flow Lab [Screen › Presets] | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + badge + undo + restore | control | radio: Volume above open interest — · div#flPresetB.fl-body > button.fl-pre | 6160 |
| 34 | Events [Earnings] | 1440x820 | rest, pill, badge, undo, restore; worst pill | orb + pill + undo + restore | control | a: Wed Aug 26 SYN400 ±4.5% ±4.3% 25% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 6068 |
| 35 | Home [Glance] | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + badge + toast + undo + restore | control | button: Open Headlines · section#hmNews.ui-card.ui-mod > button.hm-open | 5928 |
| 36 | Status [Latency › Session] | 320x568 | toast | toast | control | group: Tier 2 quote age per pass. Use the arrow keys to read values. · div#stSessionChart.lt-chart.ui-chart | 5840 |
| 37 | Market [Session] | 390x844 | toast | toast | control | button: Tables: the lanes and the largest windows · div#mkRiver.mk-body > div.mk-rv > div.mk-rv-d > button.mk-rv-tb | 5776 |
| 38 | Political | 1440x820 | dock:pill, dock:undo; worst dock:pill | pill + undo (dock open) | control | button: Open detail for the selected stock · button#plSelbar.pl-selbar | 5724 |
| 39 | Bullish board | 320x568 | toast | toast | control | input: Filter by ticker or sector · input#fbQ.bd-q-in | 5720 |
| 40 | Bearish board | 320x568 | toast | toast | control | input: Filter by ticker or sector · input#fbQ.bd-q-in | 5720 |
| 41 | Political | 320x568 | toast | toast | control | button: Open detail for the selected stock · button#plSelbar.pl-selbar | 5692 |
| 42 | Fire | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + badge + undo + restore | control | button: Implied move above past report moves Nightly · ul#ffxTpls.ffx-tpls > li.ffx-tli > button.ffx-trow | 5648 |
| 43 | Unusual [Timeline] | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + undo + restore | control | group: Flagged windows over the session. Use the arrow keys to read each window. · div#uaTimeline.fd-body > div.fu-chart.ui-chart | 5508 |
| 44 | Events [Reaction] | 1440x820 | rest, pill, badge, undo, restore; worst pill | orb + pill + undo + restore | control | a: SYN078 +4.2% 0.45× · div#evReact.fd-body > div.ui-list.fu-list > a.fe-rrow | 5504 |
| 45 | Flow Lab [Greeks] | 320x568 | toast | toast | control | button: Out of the money only · button#flOtm.fl-tog | 5480 |
| 46 | Events [Reaction] | 390x844 | rest, badge, toast; worst toast | orb + toast | control | a: SYN078 +4.2% 0.45× · div#evReact.fd-body > div.ui-list.fu-list > a.fe-rrow | 5452 |
| 47 | Home [Names] | 390x844 | toast | toast | control | a: SYN206, score −36, conviction 68, price −1.36%, net premium −$38.8M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 5392 |
| 48 | Market [Extremes] | 1440x820 | pill, undo; worst pill | pill + undo | control | summary: Notes and what the picture is not · div#mkSkyline.mk-body > details.mk-sky-nd > summary | 5388 |
| 49 | Market [Prints] | 1024x768 | pill, undo; worst pill | pill + undo | control | group: Call and put contracts per session. Use the arrow keys to read values. · div#mkVolume.mk-body > div.mk-pairs-w > div.mk-pairs.ui-chart | 5336 |
| 50 | Home [Glance] | 390x844 | toast | toast | control | button: Synthetic headline 1 about SYN090 (inert, still drawn) · div#ccNews.hm-body > button.hm-news-open | 5208 |
| 51 | Events [Earnings] | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + undo + restore | control | a: Tue Aug 25 SYN151 ±6.0% — · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow | 5172 |
| 52 | Premium desk [Lines] | 320x568 | toast | toast | control | select: Rank by · select#deskRank.dk-select | 5044 |
| 53 | Status [Latency › Session] | 390x844 | toast | toast | control | group: Tier 2 quote age per pass. Use the arrow keys to read values. · div#stSessionChart.lt-chart.ui-chart | 4664 |
| 54 | Events [Earnings] | 390x844 | toast | toast | control | a: Wed Aug 26 SYN317 ±4.8% ±3.9% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 4616 |
| 55 | Moves [Lists] | 390x844 | rest, badge, toast, undo, restore; worst toast | orb + badge + toast + undo + restore | control | button: SYN404 down −2.2 IV-days, −2.9% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 4580 |
| 56 | Moves [Lists] | 320x568 | rest, badge, toast, undo, restore; worst toast | orb + badge + toast + undo + restore | control | button: SYN404 down −2.2 IV-days, −2.9% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 4580 |
| 57 | Unusual [Urgency] | 390x844 | rest, badge, toast, undo, restore; worst toast | orb + badge + toast + undo + restore | control | a: SYN003 54 alerts · 47% sweep 0.85% · div#uaUrgency.fd-body > div.ui-list.fu-list > a.fu-urow | 4580 |
| 58 | Ticker | 320x568 | rest, badge, toast; worst toast | orb + toast | control | tab: Surface & terrain · button#ftTabSurface.ui-seg-i | 4528 |
| 59 | Moves [Lists] | 390x844 | toast | toast | control | button: SYN086 up +2.2 IV-days, +2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 4508 |
| 60 | Moves [Lists] | 320x568 | toast | toast | control | button: SYN086 up +2.2 IV-days, +2.5% on the day. No typical day is published for this name. · div#mvApart.mv-listbox > button.mv-row | 4508 |
| 61 | Market [Indices] | 1024x768 | pill, undo; worst pill | pill + undo | control | group: Implied volatility by tenor for the index ETFs. Use the arrow keys to read values. · div#mkVol.mk-body > div.mk-term.ui-chart | 4424 |
| 62 | Unusual [Urgency] | 390x844 | toast | toast | control | a: SYN351 72 alerts · 46% sweep 1.12% · div#uaUrgency.fd-body > div.ui-list.fu-list > a.fu-urow | 4228 |
| 63 | Market | 390x844 | toast | toast | control | button: Tables: the classes and their names · div#mkFloor.mk-body > div.mk-fl > div.mk-fl-d > button.mk-fl-tb | 4200 |
| 64 | Political | 390x844 | toast | toast | control | button: Open detail for the selected stock · button#plSelbar.pl-selbar | 4000 |
| 65 | Home | 1440x820 | dock:pill, dock:undo; worst dock:pill | pill + undo (dock open) | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 3976 |
| 66 | Home | 1024x768 | dock:pill, dock:undo; worst dock:pill | pill + undo (dock open) | control | button: Ask Neuron (inert: behind the modal Ask dock) · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 3976 |
| 67 | Market [Prints] | 1440x820 | pill, undo; worst pill | pill + undo | control | group: Call and put contracts per session. Use the arrow keys to read values. · div#mkVolume.mk-body > div.mk-pairs-w > div.mk-pairs.ui-chart | 3968 |
| 68 | Market [Extremes › Move skyline] | 390x844 | toast | toast | control | button: Show all 8 names · div#mkSkyline.mk-body > button.nm-link | 3880 |
| 69 | Ticker | 1920x1080 | pill, undo; worst pill | pill + undo | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 3840 |
| 70 | Ticker | 1024x768 | pill, undo; worst pill | pill + undo | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 3840 |
| 71 | Events [Earnings] | 390x844 | rest, badge, toast, undo, restore; worst toast | orb + badge + toast + undo + restore | control | a: Wed Aug 26 SYN324 ±3.7% ±3.9% · div#evEarn.fd-body > div > div.ui-list.fu-list > a.fe-erow.is-cont | 3804 |
| 72 | Flow Lab | 320x568 | toast | toast | control | radio: Name share · div#flRank.fl-rank > button | 3784 |
| 73 | Ticker | 1440x820 | rest, pill, badge, undo, restore; worst pill | orb + badge + pill + undo + restore | control | section: Range · section#ftgc-range-9.ftg-card | 3560 |
| 74 | Home [Glance] | 320x568 | toast | toast | control | button: Open Volatility · section#hmVol.ui-card.ui-mod > button.hm-open | 3516 |
| 75 | Bullish board | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + undo + restore | control | a: SYN351, rank 1, score 58, last 376.75, +0.26% today, conviction 93, with 2 of 2 signed ax… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 3512 |
| 76 | Bearish board | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + undo + restore | control | a: SYN300, rank 1, score -52, last 146.27, +0.45% today, conviction 92, with 2 of 2 signed a… · div.bd-c > span.bd-nm > span.bd-nm-1 > a.bd-open | 3512 |
| 77 | Ticker | 1440x820 | dock:rest, dock:pill, dock:badge, dock:undo; worst dock:pill | orb + pill + undo (dock open) | control | section: Positioning · section#ftgc-positioning-7.ftg-card | 3488 |
| 78 | Ticker | 1920x1080 | dock:pill, dock:undo; worst dock:pill | pill + undo (dock open) | control | section: Range · section#ftgc-range-9.ftg-card | 3456 |
| 79 | Home | 390x844 | rest, badge, toast, undo, restore; worst undo | orb + undo + restore | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 3444 |
| 80 | Home | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + undo + restore | control | button: Ask Neuron · section#hmVerdict.ui-card.hm-verdict > button.hm-ask | 3444 |
| 81 | Strategy (scrolled to the end) | 390x844 | rest, badge, toast, undo, restore; worst toast | orb + toast + undo + restore | control | button: + Add leg · button#sgAdd.tl-addrow | 3424 |
| 82 | Strategy (scrolled to the end) | 320x568 | rest, badge, toast, undo, restore; worst toast | orb + toast + undo + restore | control | button: + Add leg · button#sgAdd.tl-addrow | 3424 |
| 83 | Home [Names] | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + badge + toast + undo + restore | control | a: SYN326, score −44, conviction 95, price −0.82%, net premium $3.2M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 3380 |
| 84 | Unusual [Timeline] | 1024x768 | rest, pill, badge, undo; worst pill | orb + pill + undo | control | group: Flagged windows over the session. Use the arrow keys to read each window. · div#uaTimeline.fd-body > div.fu-chart.ui-chart | 3264 |
| 85 | Ticker | 1440x820 | pill, undo; worst pill | pill + undo | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 3200 |
| 86 | Home [Names] | 390x844 | rest, badge, toast, undo, restore; worst toast | orb + badge + toast + undo + restore | control | a: SYN182, score −36, conviction 69, price −0.51%, net premium −$29.9M. Open the reader. · div#ccBear.hm-body > div > div.ui-list > a.ui-row.hm-lrow | 3168 |
| 87 | Market [Extremes › Move skyline] | 390x844 | toast | toast | control | summary: Notes and what the picture is not · div#mkSkyline.mk-body > details.mk-sky-nd > summary | 3120 |
| 88 | Events [FDA] | 390x844 | toast | toast | control | a: SYN037 PDUFA Oct 3 · div#evFda.fd-body > div > div.ui-list.fu-list > a.fe-frow | 3064 |
| 89 | Home [Glance] | 320x568 | rest, badge, toast, undo, restore; worst undo | orb + undo + restore | control | button: Synthetic headline 1 about SYN090 (inert, still drawn) · div#ccNews.hm-body > button.hm-news-open | 3016 |
| 90 | Unusual [Names] | 390x844 | rest, badge, toast, undo, restore; worst undo | orb + badge + toast + undo + restore | control | a: SYN003 4 windows $10.0M 57% , Ask-side share of the premium the feed sided: 57% ask sid… · div#uaNames.fd-body > div.fu-list > div.ui-list > a.fu-nrow | 2996 |
| 91 | Network | 320x568 | undo | undo | control | button: Legend: colours, band width, figures · div#pnNetHost.pn-host > div.nm > div.nm-legend > button.nm-link | 2992 |
| 92 | Strategy | 1920x1080 | pill, undo; worst pill | pill + undo | control | tab: Fill · div#sgBasis.ui-seg > button.ui-seg-i | 2888 |
| 93 | Strategy | 1920x1080 | pill, undo; worst pill | pill + undo | control | tab: Natural · div#sgBasis.ui-seg > button.ui-seg-i | 2888 |
| 94 | Ticker | 1920x1080 | dock:pill, dock:undo; worst dock:pill | pill + undo (dock open) | control | a: Every module, as one page · nav#ftDock.ft-dock > a.ft-dock-a | 2880 |
| 95 | Market | 390x844 | toast | toast | control | button: Recentre · div#mkFloor.mk-body > div.mk-fl > div.mk-fl-d > button.mk-fl-tb.mk-fl-rc | 2700 |
| 96 | Market [Network] | 390x844 | toast | toast | control | button: Legend: colours, band width, figures · div#mkNet.mk-body > div.nm > div.nm-legend > button.nm-link | 2692 |
| 97 | Flow Lab [Screen › Presets] | 390x844 | toast | toast | control | radio: Report ahead — · div#flPresetB.fl-body > button.fl-pre | 2684 |
| 98 | Events [Reaction] | 390x844 | toast | toast | control | a: SYN060 +11.4% 1.19× · div#evReact.fd-body > div.ui-list.fu-list > a.fe-rrow | 2676 |
| 99 | Ledger [Sectors] | 390x844 | rest, badge, toast; worst toast | orb + badge + toast | control | button: Show all 13 · button#sfAll.link.sf-all | 2640 |
| 100 | Ledger | 1024x768 | rest, pill, badge, undo, restore; worst pill | orb + badge + pill + undo + restore | control | button: Show all 13 · button#sfAll.link.sf-all | 2612 |
| 101 | Ledger | 1024x768 | dock:pill, dock:undo; worst dock:pill | pill + undo (dock open) | control | button: Show all 13 (inert: behind the modal Ask dock) · button#sfAll.link.sf-all | 2544 |
| 102 | Ledger [Ledger] | 320x568 | toast | toast | control | button: Side unknown · div#sfGroups.sf-seg.r > button | 2520 |
| 103 | Ticker | 390x844 | toast | toast | control | button: Sep 11 18d · div.ftg-chart > div.ftg-railbox > div.ftg-xchips > button.ftg-xchip | 2436 |
| 104 | Flow Lab | 320x568 | toast | toast | control | radio: Vol/OI · div#flRank.fl-rank > button | 2312 |
| 105 | Strategy | 1920x1080 | pill | pill | control | tab: Mid · div#sgBasis.ui-seg > button.ui-seg-i | 2288 |
| 106 | Political | 1024x768 | dock:pill, dock:undo; worst dock:pill | pill + undo (dock open) | control | button: Open detail for the selected stock (inert: behind the modal Ask dock) · button#plSelbar.pl-selbar | 2200 |
| 107 | Flow Lab | 320x568 | toast | toast | control | radio: Ask share low · div#flRank.fl-rank > button | 2108 |
| 108 | Market [Extremes] | 320x568 | toast | toast | control | tab: Calls · div#mkMoversSeg.mk-segc.mk-seg-phone > div.ui-seg > button.ui-seg-i | 2080 |
| 109 | Market [Context › Radar] | 320x568 | toast | toast | control | tab: Bullish · div#mkRadarSeg.mk-segc > div.ui-seg > button.ui-seg-i | 2080 |
| 110 | Ticker | 390x844 | toast | toast | control | button: Sep 4 11d · div.ftg-chart > div.ftg-railbox > div.ftg-xchips > button.ftg-xchip | 2080 |
| 111 | Ledger [Ledger] | 320x568 | undo | undo | control | td: Calls, ask side, Takers held: −$25,466,768.00 · table.sf-t.sf-lt > tbody > tr > td.c | 2072 |
| 112 | Strategy | 320x568 | rest, badge, toast; worst toast | orb + badge + toast | control | radio: Oct 16, 53 days, 90 listed · div.tl-exprow > div.tl-stripw.is-r > div.tl-strip.tl-exp > button.tl-chip | 2072 |
| 113 | Flow Lab [Greeks] | 320x568 | toast | toast | control | radio: Total · div#flBasis.fl-rank > button | 2036 |
| 114 | Market [Extremes] | 320x568 | toast | toast | control | tab: Puts · div#mkMoversSeg.mk-segc.mk-seg-phone > div.ui-seg > button.ui-seg-i | 2032 |
| 115 | Market [Context › Radar] | 320x568 | toast | toast | control | tab: Bearish · div#mkRadarSeg.mk-segc > div.ui-seg > button.ui-seg-i | 2032 |
| 116 | Market [Extremes] | 320x568 | toast | toast | control | tab: Fallers · div#mkMoversSeg.mk-segc.mk-seg-phone > div.ui-seg > button.ui-seg-i | 1996 |
| 117 | Market [Context › Radar] | 320x568 | toast | toast | control | tab: Cheap · div#mkRadarSeg.mk-segc > div.ui-seg > button.ui-seg-i | 1996 |
| 118 | Ticker | 1440x820 | pill | pill | control | section: Earnings · section#ftgc-earnings-8.ftg-card | 1920 |
| 119 | Strategy | 320x568 | toast | toast | control | radio: Sep 18, 25 days, 100 listed · div.tl-exprow > div.tl-stripw.is-r > div.tl-strip.tl-exp > button.tl-chip.is-on | 1912 |
| 120 | Strategy | 320x568 | toast | toast | control | radio: Sep 4, 11 days, 110 listed · div.tl-exprow > div.tl-stripw.is-r > div.tl-strip.tl-exp > button.tl-chip | 1904 |

## Check of the hooked states

The real path (open the sheet, press Hidden, wait 10.1 s on the page clock, press the restore button) was run once per page and size and compared with the hooked states: 90 of 90 matched to 0.6 px.

## How it measures

- **Pages.** Every member page row of `server/routes/flows-pages.js` is rendered by calling that row's own handler, so each page is `memberShell(oracleShell(flowlabShell(page)))` exactly as served, with `ownerNav` for the owner. The switches come from `wrangler.toml` [vars] with `FLOWS_ORACLE=on` and the switches PR #286 opens to every member (`FLOWS_LEDGER`, `FLOWS_LEDGER_LIVE`, `FLOWS_FLOWLAB`, `FLOWS_FLOWLAB_ANALYTICS`, `FLOWS_EXPORTS` = on). The viewer is a member; Status is rendered for the owner. Premium desk: opened with ?t=NVDA so the frontier and lines are drawn from a synthetic chain. Strategy: /api/flows/strategy is the Worker's own route run in-process (worker.fetch) against a stubbed feed on a .test host with a dummy key, so no network call is made. Flow Lab: opened with #t=SYX101 so the per-name views read the Flow Lab fixture world. Fire: shared/ff-pages-fire.js builds the page but no route serves it on this commit; it is rendered as tests/lib/ff-d-world.mjs builds it. ask: /flows/ask/ redirects to /flows/ (FLOWS_GONE_SLUGS); the Ask surface is the dock, measured as the dock states on every page at 768 px and wider.
- **Data.** Served from `page.route` with no server and no feed call: the pipeline's dry-run emit (`tests/lib/nightly-emit.mjs`) answers the Flows routes the way `tests/flows-layout-sweep.mjs` does, the emitted `oracle-*` records answer `/api/flows/oracle`, the Ledger reads `tests/lib/sfc-render-world.mjs` (its live book is answered 404, so the live layer stands down to the server ledger), Flow Lab reads `tests/lib/flowlab-world.mjs`, Status reads `tests/lib/status-world.mjs`, Fire reads `tests/lib/ff-d-world.mjs`, the desk reads a chain built with `tests/desk-fixtures.mjs`. The rail (`/api/rt/*`) answers `rt_off` and member state (`/api/me/*`) answers 404. The page clock is pinned: default 2026-08-24T15:25:00.000Z, flowlab 2026-10-23T15:30:00.000Z, status 2026-10-12T18:41:07.000Z, fire wall clock. Motion is reduced and transitions are switched off.
- **Sizes.** 1920x1080, 1440x820, 1024x768, 390x844, 320x568; under 768 px wide the context has touch and a coarse pointer.
- **Views.** The default view, then every page-level tab and sub-tab (Home's pager, Market's views and its phone module switch, Unusual and Events tabs, Flow Lab views and its phone module switch, Ledger, Moves and Political phone panels, the desk tabs, Status tabs and its phone card switch, Fire's panels), and for a page that scrolls, the same view scrolled to the end. The Ask dock is opened on the default view at 768 px and wider.
- **States.** `assets/js/flows-oracle.js` is served with one added line that exposes its state object and paint functions (`window.__orcHook`); the states are then set through the module's own `paint()`: rest (no message, preference on), pill (one synthetic live message, “GOOGL · flow in one expiry”, preference on; the pill is widened to its 300 px cap, which a ticker page's call headline reaches), badge (the same message, preference Count), toast (phones only: `showToast`), undo (preference off with the 10 s window open) and restore (preference off, window closed). The sheet is out of scope.
- **Coverage.** The union of all parts is sampled on a 2 px grid, only at points inside a part's rounded shape (circle for the orb, stadium for the pill, chip and badge). At each point `document.elementsFromPoint` is read with every element made hit-testable and the Neuron replaced by a transparent probe in its own stacking context, so the stack says what lies under the Neuron (`under`) and what is drawn over it (`over`); clipped, hidden and `visibility: hidden` content never appears. A control is `a[href]`, `button`, `input`, `select`, `textarea`, `summary`, a button, tab, link, switch, checkbox or option role, or `tabindex` ≥ 0. Text is every non-space text node whose `Range` client rects contain the point while its box is in the stack. A graphic is a canvas (only where its own pixels have alpha above 8 when the canvas can be read), the marks of one SVG drawing (hit only where painted), an image, or a leaf element with a painted background or border. Each point stands for 4 px² and belongs to the topmost part (badge, orb, pill, toast, chip). Text and icons inside a covered control are kept in the inventory with `inControl` and left out of the counts and the ranking.
- **Not measured.** The signal state's 22 px glow around the orb, the orb's focus ring (2 px at 3 px offset) and the sheet. Pages render from fixtures, so a row count or a label length in production can put different content in the corner; the inventory names the selector of every covered element so a builder can find it on the real page. A live message's headline makes the pill 200 to 292 px wide; the ranking uses the 300 px cap.
