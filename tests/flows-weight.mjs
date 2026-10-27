import assert from "node:assert/strict";
import { readFileSync, statSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import * as PAGES from "../shared/flows-pages.js";
import { memberShell } from "../shared/flows-member-shell.js";

const REPO = new URL("../", import.meta.url);
const sizeOf = (src) => statSync(new URL("." + src, REPO)).size;
const gzipOf = (src) => gzipSync(readFileSync(new URL("." + src, REPO)), { level: 9 }).length;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const TICKER_RAISE = { od: "OD-08", bytes: 1613, why: "FlowsUI.defer ships on every route that ships flows-ui.js and the ticker defers no group, so the raise is a debt that P2-18 pays with measured savings in its own PR" };
const GLASS_V3 = { bytes: 3833, gzip: 571, why: "design v3 Lane 1: the liquid-glass tokens, the aurora ground, the .ui-card rim, caustic and lift, the chrome, the glass segmented control, .ui-num and the three fallbacks in flows.css, measured against 8ab346eb (the base the branch was rebased onto) after the dead .ak-nn rules and nineteen unread tokens were deleted; every Flows route links flows.css" };
const GLASS_LENS = { bytes: 396, gzip: 78, why: "design v3 Lane 1, refraction on four surfaces: the --glass-lens token, its @supports gate, the reduced-transparency and forced-colours drops, and the two backdrop-filter pairs on .ui-seg-knob and .ak-dock-head in flows.css; the filter itself is page markup, outside this table; every Flows route links flows.css" };
const GLASS_SITE = { bytes: 84, gzip: 5, why: "design v3 Lane 1, one more place for visual integration: the sidebar's two switchers (.fx-site, Home Articles Lab Flows and About Glossary) are segmented controls in everything but their paint, so they take the glass well and the glass knob of .ui-seg instead of the flat fills" };
const GLASS_REBASE = { bytes: 480, gzip: 80, why: "design v3 Lane 1 rebased onto main: the shared flows.css grew under it, 449 to 469 B over the raw CSS ceiling on every page at the rebase; raise approved by the owner" };
const HOME_BENTO = { od: "OD-HOME-BENTO", bytes: 11200, gzip: 2950, cssBytes: 23900, cssGzip: 3450, why: "owner-approved: the Home bento puts every module on one screen at five sizes, which costs the faces (strip, row, glance, sheet), the pager and the net decision in flows-overview.js (+10.8 KB raw, +2.9 KB gzip) and the grid, container-query fit blocks and compact faces in flows-home.css (+23.9 KB raw, +3.5 KB gzip), measured against origin/main"};
const STATUS_RAISE = { od: "OD-STATUS-1", bytes: 300, deferredBytes: 850, why: "owner-approved: the whole-card counts, per-key caps and readable rail and vendor cards cost 281 B of eager flows-status.js on statusPage, measured against the 115.68 KiB ceiling, and 817 B across the status-panels files, measured against the 179 KiB deferred allowance; the follow-up moves the status painters that only the non-Health tabs use into the status-panels group and deletes this raise" };
const MOVES_PARTS = { bytes: 3557, gzip: 1005, why: "lane 5: the Moves drill panel prints the parts of a move (market, the median of at least ten same-sector peers, the name against them) in the header strip: peerParts and partsHtml, the five explanatory sentences and the labels in flows-moves.js, which retires the info dialog's line that said parts of the move were not built; measured against main at 161.25 KiB raw and 49.97 KiB gzip of eager JavaScript on movesPage" };
const MOVES_EARNINGS = { od: "LANE-4", bytes: 3640, gzip: 1027, why: "lane 4: the Moves controller reads the earnings window, the report-session column and the unstated-time ages from the universe payload instead of a literal 21, ages them by the sessions between the nightly and the live roster, sets a name that has just reported apart under a Reaction day or Day after chip, and says in the foot when the payload states no window, the nightly is more than two sessions old or the report column is withheld; a report whose time is not stated is its own state (Report time not stated, chip Time unstated) beside an unplaced state that is never tested, which the carried forward ages (edUnstated, read with the horizon the map is complete through, edUnstatedThrough, by F.later) and the sector medians need, 53,277 to 56,917 B raw and 16,022 to 17,049 B gzip" };
const MOVES_SECTORS = { bytes: 6927, gzip: 1661, cssBytes: 1422, cssGzip: 173, why: "lane 5: the Moves lists panel gets the Sectors view its own info dialog and leaf sentences described and the radar rebuild dropped: sectorStats and shareText, the row and dialog painters, the keyboard and the switch, and the rules for the table, in flows-moves.js and flows-moves.css; measured against the same files at the commit before it" };
const SKIP_FOCUS = { bytes: 50, why: "lane 5: the sign-in, About, Glossary and not-found pages open with a skip link to a main that takes focus, and that main draws no outline of its own: one rule in flows.css, which every Flows page carries, and the desk's CSS ceiling had no headroom left" };
const NETWORK_TICKER = { bytes: 687, why: "lane 5: the ticker builds the Flow network module the dock always named (buildNetwork, 0.7 KB of flows-ticker.js) and defers the group file; the dock button no longer says not built" };
const NETWORK_GROUP = { bytes: 23757, why: "lane 5, plus 34 bytes for the sided-only nodes: flows-ticker-network.js is the deferred group network, asked for when the module nears the viewport; it adds nothing to the eager JavaScript" };
const LEDGER_PAGE = { bytes: 42161, gzip: 11353, cssBytes: 34571, cssGzip: 6733, why: "the Premium ledger is a new route: its controller flows-sfc.js and its sheet flows-sfc.css are the whole cost of it above the shared kernel (flows-ui.js, flows-dock.js, flows-fresh.js, base.css, flows.css), and it defers nothing but the dock's Ask file; measured when the page landed and again when the page was redrawn with its skeleton, hero, strip and fixed-layout tables, which added 5.9 KB of controller and 12.3 KB of sheet, and again when the page was redesigned as a Balance hero with a lean interval bar, sign marks, responsive wordings that fit instead of cut, panel tabs and the first-paint skeleton of every cell, which added 4.5 KB of controller and 2.9 KB of sheet, plus the 1 KiB of eager headroom the floor requires" };
const RT_STAMP = { bytes: 184, gzip: 51, why: "the live ledger: flows-rt.js stamps each topic with the page's monotonic time when a frame arrives (performance.now(), three sites and the topic record) and status() hands that stamp, the hub's send time, the hub's read time and the poll interval back, 184 B raw (35,965 to 36,149) on every route that loads the rail eagerly; the strip needs the stamp to print a receipt age that does not depend on the wall clock" };
const LEDGER_HOOKS = { bytes: 2259, gzip: 719, why: "the live ledger: flows-sfc.js writes a repaint into the cells that changed instead of replacing the markup (the morph seam, setText and the in-place attribute writes), keeps keyboard focus and the figure line through it, and hands the heartbeat's update time to the live module, 2,259 B raw (42,377 to 44,636) over the controller the page landed with" };
const LEDGER_LIVE = { bytes: 138867, why: "the live Premium ledger, owner-only behind FLOWS_LEDGER_LIVE: the deferred group ledger-live is the rail client (flows-rt.js, 36,149 B), the browser build of the book and view code (flows-ledger.bundle.js, 80,563 B: the same shared modules the Worker builds the view with, so the page can apply each arriving window exactly) and the glue (flows-sfc-live.js, 22,155 B); a page with the switch off declares none of it and the eager JavaScript does not move" };
const NN_ORB = { bytes: 9815, why: "design v3 Lane 2, the physics orb: flows-nn-orb.js is a deferred group (WebGL ray-traced glass sphere with Fresnel, Snell per channel, thin-film caustic and an environment read from the page tokens) asked for after load on Home and the ticker; it adds nothing to the eager JavaScript" };
const NN_KERNEL = { bytes: 974, uiBytes: 524, gzip: 250, why: "design v3 Lane 2, owner-approved: FlowsUI.nn in flows-ui.js (the six-state setter and the busy flag, 524 B raw) and the dock's two-stylesheet loader and phone Ask slot in flows-dock.js (450 B) ship on every gated route, measured with node tests/flows-weight.mjs against the Lane 1 base" };
const NN_TICKER = { bytes: 2438, gzip: 685, why: "design v3 Lane 2, owner-approved: flows-ticker.js wiring on the ticker, the strip, verdict card and rail states, the schedule flags that clear at the give-up, the edges and the evidence rims, measured against the Lane 1 base" };
const NN_HOME = { bytes: 452, gzip: 129, why: "design v3 Lane 2, owner-approved: flows-overview.js swaps the orb for the calc tile on the computed line and asks for the physics orb group, measured against the Lane 1 base" };
const NN_ASK = { bytes: 1004, why: "design v3 Lane 2, owner-approved: flows-ask.js settles the dock head and the screen edge on every answer path and draws the answer tile as the app tile; it is the shared deferred dock file of every gated route, measured against the Lane 1 base" };
const NN_FLOWS_CSS = { bytes: 451, gzip: 69, why: "design v3 Lane 2, owner-approved: flows.css gains the phone Ask slot style and the sticky dock head, measured against the Lane 1 base; every Flows route links flows.css" };
const NN_IDENTITY = { ticker: { bytes: 12191, gzip: 2722 }, overview: { bytes: 12301, gzip: 2750 }, why: "design v3 Lane 2, owner-approved: flows-nn.css (12.6 KB: the tokens, the CSS orb, the four-strip edge, the screen edge, the motion and the forced-colours block, linked eagerly by Home and the ticker) net of the gradient tiles it deletes from flows-home.css, flows-ticker.css and flows-ask.css, measured against the Lane 1 base; the spec estimated 6.5 KiB and the finished sheet with the cite rims and calc tile is larger" };
const ASK_STORED_RAISE = { od: "OD-12", bytes: 57, why: "P1-42: the Ask guarantee now says the box answers from what the site has stored, names the stored sources and that asking places no market-data request, which grew the dock file flows-ask.js by 57 B raw (68,331 to 68,388) on every route that defers it; raised only on the routes whose deferred allowance had under 57 B of headroom" };
const LEAN_RULE = { bytes: 405, why: "lane 4 audit: the Floor and the River added each flagged window's whole premium to its majority side, so a 510k ask against 490k bid window read as 100% bullish while the Network read it as +2%; both now add the window's ask, bid and unattributed dollars (the Network's rule) and the River colours a sphere by the Now list's rule, which costs 399 B in the two deferred files, and the earnings copy that now names its unit (\"within 21 sessions\", 4 B longer than \"within 30 days\") costs 4 B in flows-market-below.js, 403 B together, measured with node tests/flows-weight.mjs" };
const ASK_RULE = { bytes: 215, why: "lane 4 audit: the ticker printed its alert card's Ask side as the ask dollars over the whole premium, 38% for a name whose ask-side attribution is 75% of the part the vendor sided, while the Unusual page prints the sided share; the card now prints the site's one rule through F.askSaid with its sided share and withholds the figure from a card written before the change, which costs about 210 B of flows-ticker.js, measured with node tests/flows-weight.mjs" };
const DESK_FORWARD = { bytes: 9900, gzip: 3350, why: "Premium Desk decisions 1 and 2: flows-desk.js reads the server's forward records and cut (bandOf and winHalf, the delta and Win % bands, the forward sentences, the cut note: 6.5 KB raw, 1.9 KB gzip) and the browser bundle gains carryOf, deltaBand, lineCompare, winRange and outsideRange with the card's forward-aware frame (2.5 KB raw, 1.1 KB gzip), measured against 8b47e40, plus the 1 KiB of headroom the floor requires; the early-exercise correction then added the slope t-statistic, the ramp and the flag to the bundle and one forward sentence to flows-desk.js, 150 B of gzip over the first measure, and the visible note on how the short-call list was cut (one status line, 0.7 KB raw, 0.2 KB gzip, so the phone keeps its first line in view); the short-call chunk is deferred and adds nothing to the eager JavaScript" };
const STRATEGY_BUNDLE = { gzip: 250, why: "Premium Desk decisions 1 and 2: the strategy page loads the same flows-quant.bundle.js as the desk, which gained carryOf, deltaBand, lineCompare, winRange and outsideRange (+2.5 KB raw, +1.1 KB gzip); raw JavaScript stayed inside its ceiling and only the gzip ceiling had less than 1.1 KB of room, measured against 8b47e40; the early-exercise correction (the slope t-statistic, the ramp, the flag) then added another 0.15 KB of gzip to the same bundle" };
const DESK_CALLS = { bytes: 2500, why: "Premium Desk decisions 1 and 2: the deferred short-call chunk reads the server's cut and forward records (the lazy engine for cut rows, the bands in the Net delta and Win % cells, the neighbouring-quote range and its information line, the delta floor in the formula, the EV label and the band column of the export), 2.5 KB raw over 8b47e40; it adds nothing to the eager JavaScript" };
const GLASS_BYTES_PLAIN = (GLASS_V3.bytes + GLASS_LENS.bytes + GLASS_SITE.bytes) / 1024;
const GLASS_BYTES = (GLASS_V3.bytes + GLASS_LENS.bytes + GLASS_SITE.bytes + GLASS_REBASE.bytes) / 1024;
const GLASS_GZIP = (GLASS_V3.gzip + GLASS_LENS.gzip + GLASS_SITE.gzip) / 1024;
const GLASS_V3_TICKER = { bytes: 219, gzip: 37, why: "design v3 Lane 1: the ticker's strip, rail and chart panels take the sheen, the caustic and the lift in flows-ticker.css" };
const KERNEL_LIMIT = { kib: 3.8, decision: "F-07 PR 1 measured FlowsUI.defer at 1.6 KB where section 2.10 ruling 8 counted 0.9 KB, so the V and L share of the kernel is stated as 3.8 KB instead of 3.1" };

const CEILING_KIB = {
  tickerPage: 411 + (6504 + 752) / 1024 + (411 + 6504 / 1024 + 2310 / 1024) - (411 + 6504 / 1024) + (411 + 6504 / 1024 + 2310 / 1024 + 265 / 1024) - (411 + 6504 / 1024 + 2310 / 1024) + (411 + 6504 / 1024 + 2310 / 1024 + 265 / 1024 - 65 / 1024) - (411 + 6504 / 1024 + 2310 / 1024 + 265 / 1024) + 405 / 1024 + 64 / 1024 + 702 / 1024 + 56300 / 1024 + 2400 / 1024 + 32000 / 1024 + 2348 / 1024 + 210 / 1024 + 1400 / 1024 + 5700 / 1024 + 2500 / 1024 + 2895 / 1024 + 1300 / 1024 + 2200 / 1024 + 256 / 1024 + NN_KERNEL.bytes / 1024 + NN_TICKER.bytes / 1024 + NETWORK_TICKER.bytes / 1024 + RT_STAMP.bytes / 1024,
  overviewPage: 246 + 1483 / 1024 + (246 + 2327 / 1024) - (246) + (246 + 2327 / 1024 + 265 / 1024) - (246 + 2327 / 1024) + (246 + 2327 / 1024 + 265 / 1024 - 958 / 1024) - (246 + 2327 / 1024 + 265 / 1024) + 2322 / 1024 + 3600 / 1024 + 3900 / 1024 + 442 / 1024 + NN_KERNEL.bytes / 1024 + NN_HOME.bytes / 1024 + HOME_BENTO.bytes / 1024 + 9 / 1024 + RT_STAMP.bytes / 1024,
  sidePage: 230 + 7778 / 1024 + (230 + 7778 / 1024 + 2327 / 1024) - (230 + 7778 / 1024) + (230 + 7778 / 1024 + 2327 / 1024 + 265 / 1024) - (230 + 7778 / 1024 + 2327 / 1024) + 2322 / 1024 + 608 / 1024 + 608 / 1024 + 1536 / 1024 + 1470 / 1024 + 442 / 1024 + NN_KERNEL.bytes / 1024 + RT_STAMP.bytes / 1024,
  watchPage: 230 + 7778 / 1024 + (230 + 7778 / 1024 + 2327 / 1024) - (230 + 7778 / 1024) + (230 + 7778 / 1024 + 2327 / 1024 + 265 / 1024) - (230 + 7778 / 1024 + 2327 / 1024) + 2322 / 1024 + 608 / 1024 + 608 / 1024 + 1536 / 1024 + 1470 / 1024 + 442 / 1024 + NN_KERNEL.bytes / 1024 + RT_STAMP.bytes / 1024,
  deskPage: 243 + 7093 / 1024 + (243 + 7093 / 1024 + 2327 / 1024) - (243 + 7093 / 1024) + (243 + 7093 / 1024 + 2327 / 1024 + 265 / 1024) - (243 + 7093 / 1024 + 2327 / 1024) + 2010 / 1024 + 360 / 1024 + 8400 / 1024 + 442 / 1024 + 10050 / 1024 + 128 / 1024 + NN_KERNEL.bytes / 1024 + DESK_FORWARD.bytes / 1024 + 165 / 1024,
  strategyPage: 261 + 5786 / 1024 + (261 + 5786 / 1024 + 2327 / 1024) - (261 + 5786 / 1024) + (261 + 5786 / 1024 + 2327 / 1024 + 265 / 1024) - (261 + 5786 / 1024 + 2327 / 1024) + 2010 / 1024 + 442 / 1024 + NN_KERNEL.bytes / 1024,
  marketPage: 213 + 293 / 1024 + (213 + 2327 / 1024) - (213) + (213 + 2327 / 1024 + 265 / 1024) - (213 + 2327 / 1024) + (213 + 2327 / 1024 + 265 / 1024 - 939 / 1024) - (213 + 2327 / 1024 + 265 / 1024) + 2322 / 1024 + 846 / 1024 + 846 / 1024 + 9.5 + 442 / 1024 + NN_KERNEL.bytes / 1024 + 191 / 1024 + 300 / 1024 + RT_STAMP.bytes / 1024 + 784 / 1024,
  networkPage: 125,
  nowPage: 129,
  unusualPage: 191 + (191 + 2327 / 1024) - (191) + (191 + 2327 / 1024 + 265 / 1024) - (191 + 2327 / 1024) + (191 + 2327 / 1024 + 265 / 1024 - 314 / 1024) - (191 + 2327 / 1024 + 265 / 1024) + 2322 / 1024 + 2000 / 1024 + 1300 / 1024 + 2400 / 1024 + 442 / 1024 + NN_KERNEL.bytes / 1024 + 700 / 1024 + 1306 / 1024 + RT_STAMP.bytes / 1024,
  eventsPage: 155 + 5786 / 1024 + (155 + 5786 / 1024 + 2327 / 1024) - (155 + 5786 / 1024) + (155 + 5786 / 1024 + 2327 / 1024 + 265 / 1024) - (155 + 5786 / 1024 + 2327 / 1024) + 2010 / 1024 + NN_KERNEL.bytes / 1024,
  movesPage: 151 + 5522 / 1024 + 442 / 1024 + 320 / 1024 + 64 / 1024 + NN_KERNEL.bytes / 1024 + MOVES_PARTS.bytes / 1024 + MOVES_SECTORS.bytes / 1024 + 144 / 1024 + MOVES_EARNINGS.bytes / 1024 + RT_STAMP.bytes / 1024,
  ledgerPage: 82.6 + LEDGER_PAGE.bytes / 1024 + LEDGER_HOOKS.bytes / 1024,
  politicalPage: 118 + 2010 / 1024 + 700 / 1024 + 442 / 1024 + NN_KERNEL.bytes / 1024,
  loginPage: 5,
  aboutPage: 5,
  glossaryPage: 5,
  notFoundPage: 5,
  statusPage: 80 + 1792 / 1024 + 24.5 + 9 + 442 / 1024 + STATUS_RAISE.bytes / 1024 + NN_KERNEL.bytes / 1024,
};

const GZIP_KIB = {
  tickerPage: 125 + (2126 + 226) / 1024 + (125 + 2126 / 1024 + 821 / 1024) - (125 + 2126 / 1024) + (125 + 2126 / 1024 + 821 / 1024 + 101 / 1024) - (125 + 2126 / 1024 + 821 / 1024) + 150 / 1024 + 15600 / 1024 + 800 / 1024 + 8800 / 1024 + 736 / 1024 + 420 / 1024 + 3500 / 1024 + 1618 / 1024 + NN_KERNEL.gzip / 1024 + NN_TICKER.gzip / 1024,
  overviewPage: 82 - 7712 / 1024 + (82 - 7712 / 1024 + 830 / 1024) - (82 - 7712 / 1024) + (82 - 7712 / 1024 + 830 / 1024 + 101 / 1024) - (82 - 7712 / 1024 + 830 / 1024) + (82 - 7712 / 1024 + 830 / 1024 + 101 / 1024 - 288 / 1024) - (82 - 7712 / 1024 + 830 / 1024 + 101 / 1024) + 722 / 1024 + 1800 / 1024 + 1350 / 1024 + 149 / 1024 + NN_KERNEL.gzip / 1024 + NN_HOME.gzip / 1024 + HOME_BENTO.gzip / 1024,
  sidePage: 69 + 2571 / 1024 + (69 + 2571 / 1024 + 830 / 1024) - (69 + 2571 / 1024) + (69 + 2571 / 1024 + 830 / 1024 + 101 / 1024) - (69 + 2571 / 1024 + 830 / 1024) + 722 / 1024 + 428 / 1024 + 428 / 1024 + 450 / 1024 + 149 / 1024 + NN_KERNEL.gzip / 1024,
  watchPage: 69 + 2571 / 1024 + (69 + 2571 / 1024 + 830 / 1024) - (69 + 2571 / 1024) + (69 + 2571 / 1024 + 830 / 1024 + 101 / 1024) - (69 + 2571 / 1024 + 830 / 1024) + 722 / 1024 + 428 / 1024 + 428 / 1024 + 450 / 1024 + 149 / 1024 + NN_KERNEL.gzip / 1024,
  deskPage: 80 + 1937 / 1024 + (80 + 1937 / 1024 + 830 / 1024) - (80 + 1937 / 1024) + (80 + 1937 / 1024 + 830 / 1024 + 101 / 1024) - (80 + 1937 / 1024 + 830 / 1024) + (80 + 1937 / 1024 + 830 / 1024 + 101 / 1024 + 10 / 1024) - (80 + 1937 / 1024 + 830 / 1024 + 101 / 1024) + 641 / 1024 + 680 / 1024 + 2900 / 1024 + 184 / 1024 + 1480 / 1024 + 64 / 1024 + NN_KERNEL.gzip / 1024 + DESK_FORWARD.gzip / 1024,
  strategyPage: 83 + 1932 / 1024 + (83 + 1932 / 1024 + 830 / 1024) - (83 + 1932 / 1024) + (83 + 1932 / 1024 + 830 / 1024 + 101 / 1024) - (83 + 1932 / 1024 + 830 / 1024) + 641 / 1024 + 149 / 1024 + NN_KERNEL.gzip / 1024 + STRATEGY_BUNDLE.gzip / 1024,
  marketPage: 76 - 10914 / 1024 + (76 - 10998 / 1024 + 830 / 1024) - (76 - 10998 / 1024) + (76 - 10998 / 1024 + 830 / 1024 + 101 / 1024) - (76 - 10998 / 1024 + 830 / 1024) + (76 - 10998 / 1024 + 830 / 1024 + 101 / 1024 - 322 / 1024) - (76 - 10998 / 1024 + 830 / 1024 + 101 / 1024) + 722 / 1024 + 3.3 + 149 / 1024 + NN_KERNEL.gzip / 1024,
  networkPage: 39,
  nowPage: 40.3,
  unusualPage: 87 - 30788 / 1024 + (87 - 30788 / 1024 + 830 / 1024) - (87 - 30788 / 1024) + (87 - 30788 / 1024 + 830 / 1024 + 101 / 1024) - (87 - 30788 / 1024 + 830 / 1024) + 722 / 1024 + 2000 / 1024 + 149 / 1024 + NN_KERNEL.gzip / 1024 + 200 / 1024 + 531 / 1024 + 100 / 1024,
  eventsPage: 34 + 1932 / 1024 + (34 + 1932 / 1024 + 830 / 1024) - (34 + 1932 / 1024) + (34 + 1932 / 1024 + 830 / 1024 + 101 / 1024) - (34 + 1932 / 1024 + 830 / 1024) + (34 + 1932 / 1024 + 830 / 1024 + 101 / 1024 - 98 / 1024) - (34 + 1932 / 1024 + 830 / 1024 + 101 / 1024) + 641 / 1024 + 2000 / 1024 + 149 / 1024 + NN_KERNEL.gzip / 1024,
  movesPage: 47.5 + 1122 / 1024 + 149 / 1024 + NN_KERNEL.gzip / 1024 + MOVES_PARTS.gzip / 1024 + MOVES_SECTORS.gzip / 1024 + MOVES_PARTS.gzip / 1024 + MOVES_SECTORS.gzip / 1024 + MOVES_EARNINGS.gzip / 1024,
  ledgerPage: 27 + LEDGER_PAGE.gzip / 1024 + LEDGER_HOOKS.gzip / 1024,
  politicalPage: 37.5 + 641 / 1024 + 149 / 1024 + NN_KERNEL.gzip / 1024,
  loginPage: 3,
  aboutPage: 3,
  glossaryPage: 3,
  notFoundPage: 3,
  statusPage: 27 + 9.5 + NN_KERNEL.gzip / 1024,
};

const CSS_KIB = {
  tickerPage: 103 + (565 + 1294) / 1024 + 1861 / 1024 + 320 / 1024 + 2107 / 1024 + 9900 / 1024 + 12150 / 1024 + 6400 / 1024 + 1030 / 1024 + 3600 / 1024 + 1286 / 1024 + GLASS_BYTES + GLASS_V3_TICKER.bytes / 1024 + NN_FLOWS_CSS.bytes / 1024 + NN_IDENTITY.ticker.bytes / 1024,
  overviewPage: 104 + (779 + 11690) / 1024 + 300 / 1024 + 1700 / 1024 + 15400 / 1024 + 800 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024 + NN_IDENTITY.overview.bytes / 1024 + HOME_BENTO.cssBytes / 1024,
  sidePage: 102 + 565 / 1024 + 1700 / 1024 + 2400 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024,
  watchPage: 102 + 565 / 1024 + 1700 / 1024 + 2400 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024,
  deskPage: 111 + 880 / 1024 + 1700 / 1024 + 8600 / 1024 + (1180 + SKIP_FOCUS.bytes) / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024 + 63 / 1024,
  strategyPage: 111 + 880 / 1024 + 1700 / 1024 + 640 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024 + 32 / 1024 + 69 / 1024,
  marketPage: 94 + 1263 / 1024 + 1230 / 1024 + 160 / 1024 + 13.4 + 8.5 + 2000 / 1024 + 5.8 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024 + 842 / 1024 + 160 / 1024 + 41 / 1024,
  networkPage: 96,
  nowPage: 90,
  unusualPage: 113 + 5007 / 1024 + 1700 / 1024 + 6000 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024,
  eventsPage: 105 + 565 / 1024 + 160 / 1024 + 367 / 1024 + 367 / 1024 + 1500 / 1024 + 4700 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024,
  movesPage: 95.5 + 1700 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024 + MOVES_SECTORS.cssBytes / 1024,
  ledgerPage: 86.5 + LEDGER_PAGE.cssBytes / 1024,
  politicalPage: 100.5 + 1700 / 1024 + 400 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024,
  loginPage: 80 + 565 / 1024 + 1700 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024,
  aboutPage: 81 + 565 / 1024 + 1700 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024,
  glossaryPage: 81 + 565 / 1024 + 1700 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024,
  notFoundPage: 81 + 565 / 1024 + 1700 / 1024 + GLASS_BYTES + NN_FLOWS_CSS.bytes / 1024,
  statusPage: 82 + 7.5 + 5.5 + 1700 / 1024 + GLASS_BYTES_PLAIN + NN_FLOWS_CSS.bytes / 1024,
};

const CSS_GZIP_KIB = {
  tickerPage: 23 + (64 + 269) / 1024 + 308 / 1024 + 1400 / 1024 + 2900 / 1024 + 2700 / 1024 + 248 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + GLASS_V3_TICKER.gzip / 1024 + NN_FLOWS_CSS.gzip / 1024 + NN_IDENTITY.ticker.gzip / 1024,
  overviewPage: 23 + (100 + 2592) / 1024 + 400 / 1024 + 2400 / 1024 + 150 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024 + NN_IDENTITY.overview.gzip / 1024 + HOME_BENTO.cssGzip / 1024 + 11 / 1024,
  sidePage: 22 + 64 / 1024 + 400 / 1024 + 150 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024 + 27 / 1024,
  watchPage: 22 + 64 / 1024 + 400 / 1024 + 150 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024 + 27 / 1024,
  deskPage: 24 + 64 / 1024 + 400 / 1024 + 1500 / 1024 + 113 / 1024 + 64 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
  strategyPage: 24 + 64 / 1024 + 400 / 1024 - 17 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
  marketPage: 21 + 206 / 1024 + 2516 / 1024 + 2516 / 1024 + 300 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024 + 408 / 1024 + 60 / 1024 + 21 / 1024 + 8 / 1024,
  networkPage: 21,
  nowPage: 21,
  unusualPage: 25 + 599 / 1024 + 400 / 1024 + 1800 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
  eventsPage: 23 + 64 / 1024 + 400 / 1024 + 1800 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
  movesPage: 21 + 400 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024 + MOVES_SECTORS.cssGzip / 1024,
  ledgerPage: 18.6 + LEDGER_PAGE.cssGzip / 1024,
  politicalPage: 22.5 + 400 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
  loginPage: 18 + 64 / 1024 + 400 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
  aboutPage: 18 + 64 / 1024 + 400 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
  glossaryPage: 18 + 64 / 1024 + 400 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
  notFoundPage: 18 + 64 / 1024 + 400 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
  statusPage: 18 + 4 + 400 / 1024 + (GLASS_V3.gzip + GLASS_REBASE.gzip) / 1024 + NN_FLOWS_CSS.gzip / 1024,
};

const FORMAT_CORE = { od: "MATH-1", bytes: 1737, gzip: 543, why: "lane 2 math audit: flows-ui.js carries the one rounding rule of shared/flows-display-round.js (fixedHalfUp, formatFixed, formatScaled and the unit floors, 1,344 B), F.strike and F.etDay (228 B) and the guards that make an unreadable number throw or answer null instead of printing a zero (165 B), measured as 71,076 to 72,813 B raw and 22,524 to 23,067 B gzip, so every route that ships flows-ui.js grows by it; the browser imports nothing, so the copy is the price of one rounding rule that tests/math-format.mjs holds equal to the leaf" };
const TICKER_DEALER_LABELS = { bytes: 1595, gzip: 601, why: "lane 2 math audit: the ticker's Dealers tiles state their convention (dollars per 1% move, over dollar average daily volume, the vendor's sign) in long text with an information button, the zero-gamma line counts its crossings, and the ticker's rounding sites call the shared rule, measured as 263,737 to 265,332 B raw and 77,181 to 77,782 B gzip" };
const TICKER_PRINTS_MOVE = { bytes: 1137, gzip: 322, why: "lane 2 math audit: the ticker lists canceled prints after the live ones with their own count and sentence, names the vendor's end-of-week move and the one-standard-deviation move by what each is, and states the convention and the zero-gamma assumption in the chip facts, measured as 265,332 to 266,469 B raw and 77,782 to 78,104 B gzip" };
const BOARD_MOVE_LABEL = { bytes: 280, gzip: 80, why: "lane 2 math audit: the board's Move column title, cell tooltip and legend line say it is one standard deviation of 30-day implied volatility over the board's horizon on a 252-session year, a priced range and not a forecast, measured as 85,645 to 85,925 B raw and 24,959 to 25,039 B gzip in flows-board.js" };
const NO_UI_ROUTES = new Set(["loginPage", "aboutPage", "glossaryPage", "notFoundPage"]);
for (const name of Object.keys(CEILING_KIB)) {
  if (NO_UI_ROUTES.has(name)) continue;
  if (name !== "eventsPage") CEILING_KIB[name] += FORMAT_CORE.bytes / 1024;
  GZIP_KIB[name] += FORMAT_CORE.gzip / 1024;
}
const HORIZON_CORE = { od: "LANE-4", bytes: 1867, gzip: 677, why: "lane 4: flows-ui.js carries the page copy of the earnings state (F.earn, F.earnIn), of the sessions elapsed since the nightly (F.elapsed) and of the window sentence (F.horizon), 72,813 to 74,680 B raw and 23,120 to 23,797 B gzip, because the Moves page, Home's Leaders, Market's Volatility lens and Skyline and the ticker's Move lab each used to carry the number 21 and now read the window and the report-session column from the universe payload; the state has two candidate reaction sessions for a report whose time is not stated (F.later, which reads the carried map of unstated forward reports with the horizon it is complete through, so that a report missing from a cut map is never taken as stated, is 287 B of the 1,867; 337 B are the two-candidate rule and the by-membership elapsed count), and one copy in the kernel, held equal to shared/flows-horizon.js over 218,790 cells by tests/flows-horizon.mjs, replaces five" };
for (const name of Object.keys(CEILING_KIB)) {
  if (NO_UI_ROUTES.has(name)) continue;
  if (name !== "eventsPage") CEILING_KIB[name] += HORIZON_CORE.bytes / 1024;
  GZIP_KIB[name] += HORIZON_CORE.gzip / 1024;
}
const EVENTS_RECENT = { od: "LANE-4", bytes: 4498, gzip: 1127, cssBytes: 379, cssGzip: 46, why: "lane 4: the Events page counts the names whose report moved the price on the reaction session and the one before and the names whose report time is not stated, lists the largest movers among those that reacted on the nightly's session in typical days, names those that reacted two to five sessions ago, says why when the report column is withheld, pending or empty, cut or has no window, and prints its window in sessions through a date (flows-events.js 49,488 to 53,986 B raw and 14,009 to 15,136 B gzip, flows-feeds.css 31,209 to 31,588 B raw and 6,129 to 6,175 B gzip); the raw JavaScript ceiling is held by HELD_RAW_KIB, so only gzip and the sheet rise" };
GZIP_KIB.eventsPage += EVENTS_RECENT.gzip / 1024;
CSS_KIB.eventsPage += EVENTS_RECENT.cssBytes / 1024;
CSS_GZIP_KIB.eventsPage += EVENTS_RECENT.cssGzip / 1024;
CEILING_KIB.tickerPage += (TICKER_DEALER_LABELS.bytes + TICKER_PRINTS_MOVE.bytes) / 1024;
GZIP_KIB.tickerPage += (TICKER_DEALER_LABELS.gzip + TICKER_PRINTS_MOVE.gzip) / 1024;
for (const name of ["sidePage", "watchPage"]) {
  CEILING_KIB[name] += BOARD_MOVE_LABEL.bytes / 1024;
  GZIP_KIB[name] += BOARD_MOVE_LABEL.gzip / 1024;
}
const MEMBER_CSS = { bytes: 1525, gzip: 263, why: "lane 6 member state: flows.css carries the two toolbar buttons the member shell injects (.fx-mem, an icon on a phone and a labelled button from 1100 px), the Watch page's My list action (.fm-act), the disabled export item and the member export menu's width, opaque ground and 44 px size for any coarse pointer, measured as 77,391 to 78,916 B raw and 15,634 to 15,897 B gzip; the action takes the header row's own height so the Watch title and tools do not move when the info button arrives; the dialogs, rows and switch sit in flows-member.css, loaded only when a member opens one" };
const MEMBER_TICKER_CSS = { bytes: 1145, gzip: 220, why: "lane 6 member state: the ticker's star slot is reserved in the server HTML by two rules in flows-ticker.css (a 44 px inline box of no height beside the title and an absolutely placed button inside it), so the subtitle and flags never move when the star arrives, and the star's own rules (size, hover, focus, pressed fill, a dimmer colour while the list cannot be read, forced colours) sit there too so that the star needs no sheet of its own: the ticker pays 1,145 B raw and 220 B gzip of eager style to save the 8 KB sheet and the 13 KB of dialogs and store that every ticker view used to fetch for it" };
const MEMBER_EXPORT_JS = { bytes: 1483, gzip: 510, why: "lane 6 member state: FlowsUI.exportMenu adopts a server-rendered details element (opts.el), fills its items from opts.remote with a quota note that a late answer cannot overwrite, keeps an item with aria-disabled instead of disabled, returns focus to the Export button, and no longer prints the text null when an input is missing, adopts the toggle event that opened it by identity so one opening reads the limit once, ties the limited items to the limit line with aria-describedby, measured as 4,630 to 6,113 B raw on the three routes that load flows-export.js" };
for (const name of Object.keys(CSS_KIB)) {
  CSS_KIB[name] += MEMBER_CSS.bytes / 1024;
  CSS_GZIP_KIB[name] += MEMBER_CSS.gzip / 1024;
}
CSS_KIB.tickerPage += MEMBER_TICKER_CSS.bytes / 1024;
CSS_GZIP_KIB.tickerPage += MEMBER_TICKER_CSS.gzip / 1024;
for (const name of ["deskPage", "sidePage", "watchPage"]) {
  CEILING_KIB[name] += MEMBER_EXPORT_JS.bytes / 1024;
  GZIP_KIB[name] += MEMBER_EXPORT_JS.gzip / 1024;
}

const RATCHET_KIB = { raw: 12, gzip: 3, css: 3, cssGzip: 3 };
const HELD_RAW_KIB = { eventsPage: 50 };

const BASES = [
  { key: "raw", label: "JS raw", ceilings: CEILING_KIB },
  { key: "gzip", label: "JS gzip", ceilings: GZIP_KIB },
  { key: "css", label: "CSS raw", ceilings: CSS_KIB },
  { key: "cssGzip", label: "CSS gzip", ceilings: CSS_GZIP_KIB },
];

const judge = (row, bases = BASES) => {
  const faults = [];
  for (const base of bases) {
    const ceiling = base.ceilings[row.name];
    if (ceiling === undefined) { faults.push(`${row.name} has no ${base.label} ceiling`); continue; }
    const used = row[base.key];
    if (used > ceiling * 1024) {
      faults.push(`${row.name} ${base.label} ${used} B is over its ${ceiling} KiB ceiling`);
    }
    const slackLimit = base.key === "raw" && HELD_RAW_KIB[row.name] !== undefined
      ? HELD_RAW_KIB[row.name] : RATCHET_KIB[base.key];
    if (ceiling * 1024 - used > slackLimit * 1024) {
      faults.push(`${row.name} ${base.label} ceiling ${ceiling} KiB sits ${Math.round((ceiling * 1024 - used) / 1024)} KiB ` +
        `above ${used} B, past the ${slackLimit} KiB the ratchet allows`);
    }
  }
  return faults;
};

const DEFERRED = {
  tickerPage: { groups: { surface: "/assets/js/flows-ticker-surface.js", movelab: "/assets/js/flows-ticker-movelab.js", network: "/assets/js/flows-ticker-network.js", live: "/assets/js/flows-ticker-live.js", "nn-orb": "/assets/js/flows-nn-orb.js" } },
  unusualPage: { groups: { net: "/assets/js/flows-net.js", netmap: "/assets/js/flows-net-map.js", "flow-below": "/assets/js/flows-unusual-below.js" }, modules: ["uaTimelineCard", "uaNamesCard", "uaUrgencyCard", "uaFeedCard", "uaSurpriseCard"] },
  marketPage: { groups: { floor: "/assets/js/flows-market-floor.js", river: "/assets/js/flows-market-river.js", "market-below": "/assets/js/flows-market-below.js", net: "/assets/js/flows-net.js", netmap: "/assets/js/flows-net-map.js" }, modules: ["mkSectorsCard", "mkGroupsCard", "mkExpiryCard", "mkVolCard", "mkRadarCard", "mkAdvCard", "mkVolumeCard", "mkAgainstCard", "mkMoversCard", "mkOiCard", "mkDarkCard", "mkImpactCard", "mkInsidersCard", "mkSeasonCard"] },
  networkPage: { groups: { net: "/assets/js/flows-net.js", netmap: "/assets/js/flows-net-map.js" } },
  deskPage: { groups: { "desk-calls": "/assets/js/flows-desk-calls.js" } },
  ledgerPage: { groups: { "ledger-live": ["/assets/js/flows-rt.js", "/assets/js/flows-ledger.bundle.js", "/assets/js/flows-sfc-live.js"] } },
  statusPage: { groups: { "status-panels": ["/assets/js/flows-chart.js", "/assets/js/flows-status-latency.js", "/assets/js/flows-status-capacity.js", "/assets/js/flows-status-coverage.js"] } },
  overviewPage: { groups: { "home-below": "/assets/js/flows-overview-below.js", "home-net": "/assets/js/flows-net.js", "home-netmap": "/assets/js/flows-net-map.js", "nn-orb": "/assets/js/flows-nn-orb.js" }, modules: ["hmChg", "hmVol", "hmEvents", "hmNews"] },
};
const SHARED_DEFERRED = {
  dock: { file: "/assets/js/flows-ask.js", declared: /<aside[^>]*\bid="askDock"[^>]*\bdata-src="([^"?]+)/ },
  link: { file: "/assets/js/flows-link.js", declared: null },
};
const GPU_ONLY = {};
const SHARED_GROUPS = new Set(["oracle", "member"]);
const MEMBER_BOOT_MAX = 2318;
const MEMBER_CORE_GZIP_MAX = 6 * 1024;
const MEMBER_GROUP = ["/assets/js/storage.js", "/assets/js/flows-member.js", "/assets/js/flows-member-ui.js"];
const MEMBER_GROUP_KIB = 75;
const MEMBER_MARKUP_BYTES = 2400;
const MEMBER_SLUG = { overviewPage: "overview", sidePage: "long", watchPage: "watch", marketPage: "market", networkPage: "network", nowPage: "now", deskPage: "desk", strategyPage: "strategy", tickerPage: "ticker", movesPage: "moves", unusualPage: "unusual", ledgerPage: "ledger", eventsPage: "events", politicalPage: "political" };
const ORACLE_FILES = ["/assets/js/flows-oracle-core.js", "/assets/js/flows-oracle.js", "/assets/js/flows-oracle-boot.js"];
const ORACLE_DEFERRED_KIB = 60;
const ORACLE_MARKUP_BYTES = 720;
const DEFERRED_KIB = {
  tickerPage: 80 + (38836 + 18916) / 1024 + 23400 / 1024 + 15800 / 1024 + NN_ORB.bytes / 1024 + NN_ASK.bytes / 1024 + NETWORK_GROUP.bytes / 1024, overviewPage: 120 + 82272 / 1024 + 24200 / 1024 + NN_ORB.bytes / 1024 + NN_ASK.bytes / 1024 + (260 + 848) / 1024, sidePage: 80 + NN_ASK.bytes / 1024, watchPage: 80 + NN_ASK.bytes / 1024, deskPage: 120 + NN_ASK.bytes / 1024 + DESK_CALLS.bytes / 1024, strategyPage: 80 + NN_ASK.bytes / 1024, marketPage: 323 + LEAN_RULE.bytes / 1024 + NN_ASK.bytes / 1024 + (2240 + 627) / 1024, networkPage: 210 + NN_ASK.bytes / 1024, nowPage: 80 + NN_ASK.bytes / 1024,
  unusualPage: 196 + 960 / 1024 + NN_ASK.bytes / 1024 + (26400 + 745) / 1024, eventsPage: 80 + NN_ASK.bytes / 1024, movesPage: 80 + NN_ASK.bytes / 1024, ledgerPage: 80 + NN_ASK.bytes / 1024 + LEDGER_LIVE.bytes / 1024, politicalPage: 80 + NN_ASK.bytes / 1024, loginPage: 0, aboutPage: 0, glossaryPage: 0, notFoundPage: 0, statusPage: 80 + 80 + 15 + 4 + STATUS_RAISE.deferredBytes / 1024 + NN_ASK.bytes / 1024 + ASK_STORED_RAISE.bytes / 1024,
};
const DARK_POOL_TIME = { bytes: 107, why: "lane 2 math audit: the Market page's dark-pool list drops canceled prints, prints its times in TRT through F.time and its prices through F.px, and says how many canceled prints it left out, measured as 58,946 to 59,053 B raw in the deferred flows-market-below.js" };
DEFERRED_KIB.marketPage += DARK_POOL_TIME.bytes / 1024;
const FLOOR_FUNDS_DEFERRED = { bytes: 21330, eagerBytes: 784, why: "WP1: the Floor draws a second, labelled basis from the market payload's funds block and the live:funds row (a Basis control, the session model, the previous-session choice, the plain-words readouts, the session tables and side list), measured as 46,657 to 67,987 B raw in the deferred flows-market-floor.js and 64,771 to 65,609 B in the eager flows-market.js, which reads the block and the live row and keeps the Basis address through a tab change" };
DEFERRED_KIB.marketPage += FLOOR_FUNDS_DEFERRED.bytes / 1024;
const HORIZON_DEFERRED = { od: "LANE-4", tickerBytes: 2947, marketBytes: 1261, why: "lane 4: the ticker's Move lab reads the earnings window and the report-session column from the universe, ages them by the sessions elapsed and shows a Reacting today, Reacted one session ago or Report time not stated state, and reads the carried forward ages of unstated report times (flows-ticker-movelab.js 19,302 to 22,249 B), and Market's Skyline and Volatility lens read the same window, column and ages in place of a literal 21 (flows-skyline.js 22,056 to 22,571 B, flows-market-below.js 59,053 to 59,799 B)" };
DEFERRED_KIB.tickerPage += HORIZON_DEFERRED.tickerBytes / 1024;
DEFERRED_KIB.marketPage += HORIZON_DEFERRED.marketBytes / 1024;

const FLOOR_BYTES = 1024;
const EAGER_KERNEL = [
  { team: "V", name: "freshness pill", kib: 0.3, landed: { file: "/assets/js/flows-ui.js", has: /\bfreshAll\b/ } },
  { team: "V", name: "FlowsUI.defer", kib: 1.6, landed: { file: "/assets/js/flows-ui.js", has: /\bfunction defer\(/, from: /\n  const loadJs = /, to: /\n  const link = / } },
  { team: "V", name: "FlowsUI.link queue stub", kib: 0.4, landed: { file: "/assets/js/flows-ui.js", has: /\bconst link = / } },
  { team: "L", name: "frame scheduler core", kib: 1.5, landed: null },
  { team: "F", name: "Flow Radar stub", kib: 0.4, landed: null },
  { team: "F", name: "X-Basis", kib: 0.3, landed: null },
];
const NO_RELIEF_ROW = "no relief row yet (plan 5.7)";
const BELOW_FLOOR = {
  tickerPage: "OD-08",
  sidePage: NO_RELIEF_ROW,
  watchPage: NO_RELIEF_ROW,
  movesPage: NO_RELIEF_ROW,
  marketPage: NO_RELIEF_ROW,
  networkPage: NO_RELIEF_ROW,
  nowPage: NO_RELIEF_ROW,
  overviewPage: NO_RELIEF_ROW,
  statusPage: "OD-STATUS-1: the follow-up that moves the non-Health painters of flows-status.js into the status-panels group",
};

const LOADER = /createElement\(\s*["']script["']\s*\)|\bh\(\s*["']script["']|\bimport\(|new\s+Worker\(|importScripts\(/;
const LOADERS = new RegExp(LOADER.source, "g");

function declarationProblems(html, table, route) {
  const problems = [];
  const seen = new Map();
  const own = new Set([...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<i\b[^>]*\bdata-defer=[^>]*>/g)) {
    const tag = m[0];
    const group = (/\bdata-defer="([^"]*)"/.exec(tag) || [])[1];
    const src = (/\bdata-src="([^"]*)"/.exec(tag) || [])[1];
    if (!group) { problems.push("a deferred element has no group name"); continue; }
    if (!/\shidden(\s|>|=)/.test(tag)) problems.push(`${group}: the element is not hidden`);
    if (src === undefined) { problems.push(`${group}: no data-src`); continue; }
    if (/[\s,;|]/.test(src)) { problems.push(`${group}: one file per element, and ${JSON.stringify(src)} is a list the version scan cannot read past its first URL`); continue; }
    const m2 = /^(\/assets\/js\/[A-Za-z0-9._-]+\.js)\?v=\d+$/.exec(src);
    if (!m2) { problems.push(`${group}: ${src} is not a versioned /assets/js/ path`); continue; }
    const file = m2[1];
    if (own.has(file)) problems.push(`${group}: ${file} is also a script src of the route`);
    const listed = table.groups[group];
    if (listed === undefined) problems.push(`${group}: not in DEFERRED for ${route}`);
    else if (!(Array.isArray(listed) ? listed : [listed]).includes(file)) problems.push(`${group}: ${file} is not among DEFERRED's files for the group`);
    if (!seen.has(group)) seen.set(group, []);
    seen.get(group).push(file);
  }
  for (const [group, files] of Object.entries(table.groups)) {
    const want = Array.isArray(files) ? files : [files];
    const got = seen.get(group) || [];
    for (const f of want) if (!got.includes(f)) problems.push(`${group}: DEFERRED lists ${f} and the page declares no element for it`);
  }
  return problems;
}

const pageNames = Object.keys(PAGES)
  .filter((k) => typeof PAGES[k] === "function" && /Page$/.test(k))
  .sort();

ok(pageNames.length >= 12,
   `every page function is discovered from the module rather than listed here ` +
   `(${pageNames.length} found) — a route added without a ceiling below fails this suite ` +
   `rather than shipping unmeasured`);

const measured = [];

for (const name of pageNames) {
  let html;
  try {
    html = String(PAGES[name]({ username: "tester", ticker: "AAPL", net: true, live: name === "ledgerPage", scenes: name === "tickerPage" }));
  } catch (error) {
    assert.fail(`${name} threw while rendering: ${error && error.message}`);
  }

  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((m) => m[1].split("?")[0]);

  ok(srcs.length > 0, `${name} emits at least one script, so the measurement has a subject`);

  let bytes = 0;
  let gzip = 0;
  const parts = [];
  for (const src of srcs) {

    let size = null;
    try { size = sizeOf(src); } catch { size = null; }
    ok(size !== null,
       `${name} emits ${src} and that file exists — a deferred script that 404s leaves the ` +
       `route a shell with no renderer, and it fails silently: the document renders, nothing ` +
       `draws, and no error reaches anything that watches`);
    if (size === null) continue;
    ok(size > 0, `${src} is not empty`);
    bytes += size;
    gzip += gzipOf(src);
    parts.push(src.split("/").pop() + " " + Math.round(size / 1024) + "k");
  }

  const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map((m) => m[1].split("?")[0]);
  ok(hrefs.length > 0, `${name} emits at least one stylesheet, so the CSS measurement has a subject`);
  let css = 0;
  let cssGzip = 0;
  for (const href of hrefs) {
    let size = null;
    try { size = sizeOf(href); } catch { size = null; }
    ok(size !== null, `${name} links ${href} and that file exists`);
    if (size === null) continue;
    css += size;
    cssGzip += gzipOf(href);
  }

  measured.push({ name, kib: bytes / 1024, raw: bytes, bytes, gzip, css, cssGzip, parts, html, srcs });
}

measured.sort((a, b) => b.kib - a.kib);
console.log("  route JavaScript, uncompressed:");
for (const m of measured) {
  const ceiling = CEILING_KIB[m.name];
  console.log(
    "    " + String(Math.round(m.kib)).padStart(4) + "k" +
    (ceiling ? " / " + String(ceiling) + "k" : "  (no ceiling)") +
    "  " + m.name.replace(/Page$/, "").padEnd(10) + m.parts.join("  "));
}

{
  const kib = (n) => (n / 1024).toFixed(1);
  const rows = [...measured].sort((a, b) => a.name.localeCompare(b.name));
  const head = ["route", "JS raw", "JS gzip", "CSS raw", "CSS gzip"];
  const line = (cells) => "  " + cells.map((c, i) => (i === 0 ? String(c).padEnd(10) : String(c).padStart(22))).join("");
  console.log("  weight ledger, KiB used / ceiling (headroom):");
  console.log(line(head));
  const table = [];
  for (const m of rows) {
    const cells = BASES.map((b) => `${kib(m[b.key])} / ${b.ceilings[m.name]} (${kib(b.ceilings[m.name] * 1024 - m[b.key])})`);
    console.log(line([m.name.replace(/Page$/, ""), ...cells]));
    table.push("| " + [m.name.replace(/Page$/, ""), ...cells].join(" | ") + " |");
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        "\n### Flows weight ledger, KiB used / ceiling (headroom)\n\n| route | JS raw | JS gzip | CSS raw | CSS gzip |\n|---|---|---|---|---|\n" +
        table.join("\n") + "\n");
    } catch {}
  }
}

for (const m of measured) {
  const faults = judge(m);
  eq(faults.join("; "), "",
     `${m.name} is inside all four ceilings and no ceiling hangs loose of it. Raw JavaScript stays the binding ` +
     `basis (parse and compile cost follows raw bytes); gzip and CSS ceilings sit 2-3 KiB above the measurement. ` +
     `A change that saves bytes lowers the ceiling in the same diff, so the saving cannot be spent by the next ` +
     `change unseen; one that adds them raises it in the diff where it can be argued`);
}

{
  const base = { name: "marketPage", raw: 233434, gzip: 70800, css: 132602 + MEMBER_CSS.bytes, cssGzip: 27457 + MEMBER_CSS.gzip };
  eq(judge(base).join("; "), "", "the ledger judge passes today's market route");
  ok(judge({ ...base, gzip: base.gzip + 8 * 1024 }).length > 0,
     "the judge fails a route inflated by 8 KiB of gzip");
  ok(judge({ ...base, raw: base.raw + 8 * 1024 }).length > 0, "the judge fails a route inflated by 8 KiB raw");
  ok(judge({ ...base, css: base.css + 8 * 1024 }).length > 0, "the judge fails a stylesheet inflated by 8 KiB");
  ok(judge({ ...base, cssGzip: base.cssGzip + 8 * 1024 }).length > 0, "the judge fails a stylesheet inflated by 8 KiB of gzip");
  ok(judge({ ...base, gzip: base.gzip - 8 * 1024 }).length > 0,
     "the ratchet fails a route that saved 8 KiB of gzip and left its ceiling where it was");
  ok(judge({ ...base, raw: base.raw - 13 * 1024 }).length > 0,
     "the ratchet fails a route that saved 13 KiB raw and left its ceiling where it was");
  ok(judge({ ...base, name: "nowhere" }).length === 4, "a route with no ceilings fails on all four bases");
  const events = { name: "eventsPage", raw: 118228 + NN_KERNEL.bytes, gzip: 39938 + NN_KERNEL.gzip, css: 118855 + NN_FLOWS_CSS.bytes, cssGzip: 24824 + NN_FLOWS_CSS.gzip };
  eq(judge(events).join("; "), "", "events, whose ceiling is held for the earnings strip, passes with its wide raw headroom");
  eq(Object.keys(HELD_RAW_KIB).join(", "), "eventsPage", "events is the only route whose raw ceiling is held above the ratchet");
}

for (const name of Object.keys(CEILING_KIB)) {
  for (const t of [GZIP_KIB, CSS_KIB, CSS_GZIP_KIB]) {
    ok(Object.prototype.hasOwnProperty.call(t, name) && Object.keys(t).length === Object.keys(CEILING_KIB).length,
       `${name} has an entry in every ceiling table and no table has a stray one`);
  }
}

for (const m of measured) {
  const ceiling = CEILING_KIB[m.name];
  ok(ceiling !== undefined,
     `${m.name} has a stated ceiling — a route measured at ${Math.round(m.kib)}k with no ` +
     `budget is a route nobody chose the size of`);
  if (ceiling === undefined) continue;
  ok(m.kib <= ceiling,
     `${m.name} ships ${Math.round(m.kib)}k of JavaScript, inside its ${ceiling}k ceiling. ` +
     `If this fails, the question is whether the route needed what it just gained — raising ` +
     `the ceiling is a decision and should look like one in the diff`);
}

for (const name of Object.keys(CEILING_KIB)) {
  ok(pageNames.includes(name),
     `the ceiling for ${name} guards a route that still exists — a stale entry reads as a ` +
     `budget and enforces nothing`);
}

{
  const heaviest = measured[0];
  const panelRoutes = measured.filter((m) => m.parts.some((p) => /^flows-panels\.js/.test(p)));
  const dossierRoutes = measured.filter((m) => m.parts.some((p) => /^flows-ticker\.js/.test(p)));
  ok(heaviest.kib > 250,
     `the heaviest route still ships over 250k (${Math.round(heaviest.kib)}k on ` +
     `${heaviest.name}) — asserted as a STANDING FACT rather than as a target, so that the ` +
     `day someone splits that bundle this line fails and has to be rewritten deliberately ` +
     `rather than the improvement passing unnoticed`);

  eq(panelRoutes.length, 0,
     `no route links flows-panels.js (${panelRoutes.map((m) => m.name).join(", ") || "none"}) — the panel ` +
     `library was deleted when the ticker dossier was rebuilt on FlowsUI, and its renderers now live in ` +
     `the dossier's own controller`);
  ok(!existsSync(new URL("assets/js/flows-panels.js", REPO)), "and the file itself is gone, not orphaned");
  eq(dossierRoutes.map((m) => m.name).join(", "), "tickerPage",
     `the dossier's renderers ship on exactly one route — the bundle they replaced was on four, and on ` +
     `three of them the only thing that ever reached it was the card dialog: none of flows-overview.js, ` +
     `flows-board.js or flows-watch.js contains the string FlowsPanels, and on /flows/watch/ not even the ` +
     `dialog did, because that page minted no opener for its delegation to find`);
}

{

  {
    for (const route of measured) {
      ok(!route.parts.some((part) => /^flows-drawers\.js/.test(part)),
         `no route links flows-drawers.js (${route.name}) — it was the deferred half of the old panel library`);
    }
    ok(!existsSync(new URL("assets/js/flows-drawers.js", REPO)),
       "and it is deleted rather than orphaned: its drawers were folded into the dossier's modules");
    const dossier = readFileSync(new URL("assets/js/flows-ticker.js", REPO), "utf8");
    ok(!/createElement\(\s*["']script["']\s*\)|import\(/.test(dossier),
       "the dossier defers no script of its own, so the ticker row above counts every byte the page " +
       "runs — the old page arrived at 422k and fetched 89k of drawers after it, which this table never saw");
  }

  {
    const ui = readFileSync(new URL("assets/js/flows-chart.js", REPO), "utf8");
    const exported = ui.match(/const chart = Object\.freeze\(\{([\s\S]*?)\}\);/);
    ok(exported && /\bline\b/.test(exported[1]) && /\bLEVELS\b/.test(exported[1]),
       "the chart export list is found, so the next line reads it rather than nothing");
    const dead = ["cone", "levels", "area"].filter((name) => new RegExp("\\b" + name + "\\b").test(exported[1]));
    eq(dead.join(", "), "",
       "FlowsUI.chart exports none of cone, levels or area: no page drew them, and they shipped on every Flows route");
    ok(!/function (cone|levels|area)\(/.test(ui), "and their bodies are deleted, not merely unexported");
    for (const route of measured) {
      ok(!route.parts.some((part) => /^flows-cursor\.js/.test(part)), `no route links flows-cursor.js (${route.name})`);
    }
    ok(!existsSync(new URL("assets/js/flows-cursor.js", REPO)), "and flows-cursor.js is deleted rather than orphaned");
  }

  {
    const CHART_ROUTES = ["deskPage", "marketPage", "overviewPage", "sidePage", "strategyPage", "tickerPage",
      "unusualPage", "watchPage"];
    const FREE_ROUTES = ["aboutPage", "eventsPage", "glossaryPage", "loginPage", "notFoundPage", "politicalPage"];
    const chartRoutes = measured.filter((m) => m.parts.some((p) => /^flows-chart\.js/.test(p))).map((m) => m.name).sort();
    eq(chartRoutes.join(", "), CHART_ROUTES.join(", "),
       "the chart library ships on exactly the eight routes that draw a chart, and the routes that draw none never download it");
    for (const name of FREE_ROUTES) {
      ok(pageNames.includes(name) && !chartRoutes.includes(name), `${name} does not link flows-chart.js`);
    }
    for (const name of CHART_ROUTES) {
      const html = String(PAGES[name]({ username: "tester", ticker: "AAPL", net: true, live: name === "ledgerPage", scenes: name === "tickerPage" }));
      const order = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].split("?")[0]);
      const at = order.indexOf("/assets/js/flows-ui.js");
      ok(at >= 0 && order[at + 1] === "/assets/js/flows-chart.js",
         `${name} links flows-chart.js directly after flows-ui.js, so no script between them captures a FlowsUI without chart`);
      ok(/<script src="[^"]*flows-chart\.js\?v=\d+" defer><\/script>/.test(html), `${name} loads it deferred at the asset version`);
    }
    const core = sizeOf("/assets/js/flows-ui.js"), lib = sizeOf("/assets/js/flows-chart.js");
    console.log("  flows-ui.js " + core + " B, flows-chart.js " + lib + " B");
    ok(core < 71000 + NN_KERNEL.uiBytes + 64 + FORMAT_CORE.bytes + HORIZON_CORE.bytes, `flows-ui.js is the core alone (${core} B): the chart library is not in it`);
    ok(!/const chart = Object\.freeze|function (drawLine|diverging|heatmap|payoff|sparkline)\(/.test(readFileSync(new URL("assets/js/flows-ui.js", REPO), "utf8")),
       "and none of the chart drawing functions is left behind in the core");
  }

  const askBytes = sizeOf("/assets/js/flows-ask.js");
  const askKib = Math.round(askBytes / 1024);
  const dockRoutes = measured.filter((m) => m.parts.some((p) => /^flows-dock\.js/.test(p)));
  const spare = (m) => (CEILING_KIB[m.name] - m.kib) * 1024;
  const wouldFit = dockRoutes.filter((m) => spare(m) >= askBytes);
  eq(wouldFit.length, 0,
     `flows-ask.js (${askKib}k) fits inside the headroom of NONE of the ` +
     `${dockRoutes.length} routes the dock ships on — the whole reason the dock defers it`);
}

{
  const read = (src) => readFileSync(new URL("." + src, REPO), "utf8");
  const sizes = new Map();
  const bytesOf = (src) => { if (!sizes.has(src)) sizes.set(src, sizeOf(src)); return sizes.get(src); };

  console.log("  deferred JavaScript, uncompressed (allowance in KiB is stated, not derived):");
  for (const m of measured) {
    const table = DEFERRED[m.name] || { groups: {} };
    const problems = declarationProblems(m.html, table, m.name);
    eq(problems.join("; "), "", `${m.name} declares exactly the files DEFERRED lists for it, one per <i hidden data-defer data-src> element`);

    const files = [];
    for (const [group, list] of Object.entries(table.groups)) for (const f of Array.isArray(list) ? list : [list]) files.push({ f, how: "group " + group });
    const dockMatch = SHARED_DEFERRED.dock.declared.exec(m.html);
    if (dockMatch) {
      eq(dockMatch[1], SHARED_DEFERRED.dock.file, `${m.name}'s dock declares ${SHARED_DEFERRED.dock.file} and nothing else`);
      files.push({ f: dockMatch[1], how: "dock" });
    }
    if (m.srcs.includes("/assets/js/flows-ui.js")) files.push({ f: SHARED_DEFERRED.link.file, how: "link" });
    for (const f of GPU_ONLY[m.name] || []) files.push({ f, how: "gpu" });

    let total = 0;
    for (const { f } of files) {
      ok(existsSync(new URL("." + f, REPO)) && bytesOf(f) > 0, `${m.name}: deferred ${f} exists and is not empty`);
      ok(!m.srcs.includes(f), `${m.name}: ${f} is deferred and also a script src of the route, so it would be paid for twice`);
      total += bytesOf(f);
    }
    m.deferredBytes = total;
    m.deferredFiles = files;
    const allowance = DEFERRED_KIB[m.name];
    ok(allowance !== undefined, `${m.name} has a stated deferred allowance`);
    ok(total <= allowance * 1024,
       `${m.name} defers ${Math.round(total / 1024)}k (${files.map((x) => x.f.split("/").pop()).join(", ") || "nothing"}), inside its stated ${allowance}k allowance — a deferred file that grows is a decision`);
    ok(m.bytes + total <= (CEILING_KIB[m.name] + allowance) * 1024,
       `${m.name}: eager plus deferred plus GPU-only is ${Math.round((m.bytes + total) / 1024)}k, inside ceiling ${CEILING_KIB[m.name]}k plus allowance ${allowance}k`);
    console.log("    " + m.name.replace(/Page$/, "").padEnd(10) + String(Math.round(total / 1024)).padStart(4) + "k / " + String(allowance).padStart(2) + "k  " + files.map((x) => x.f.split("/").pop() + " (" + x.how + ")").join("  "));
  }
  for (const m of measured) {
    const table = DEFERRED[m.name];
    if (!table || !table.modules) continue;
    for (const id of table.modules) ok(new RegExp(`<section[^>]*\\bid="${id}"`).test(m.html), `${m.name}: the module ${id} that DEFERRED lists is a section of the page`);
    for (const [group, list] of Object.entries(table.groups)) {
      for (const f of Array.isArray(list) ? list : [list]) {
        const chunk = read(f);
        const attached = /\.attach\(\{([^}]*)\}\)/.exec(chunk);
        if (!attached) continue;
        const names = attached[1].split(",").map((x) => x.trim()).filter(Boolean);
        ok(names.length >= 4, `${m.name}: the ${group} chunk hands ${names.length} painters back`);
        for (const nme of names) {
          ok(new RegExp(`\\bfunction ${nme}\\(`).test(chunk), `${m.name}: ${nme} is defined in ${f.split("/").pop()}`);
          for (const src of m.srcs) {
            if (/flows-(ui|fresh|rt|dock)\.js$/.test(src)) continue;
            ok(!new RegExp(`\\bfunction ${nme}\\(`).test(read(src)), `${m.name}: and ${nme} is not also defined in the first-paint file ${src.split("/").pop()}`);
          }
        }
      }
    }
  }
  for (const name of Object.keys(DEFERRED)) ok(pageNames.includes(name), `DEFERRED names ${name}, a route that still exists`);
  for (const name of Object.keys(DEFERRED_KIB)) ok(pageNames.includes(name), `the allowance for ${name} guards a route that still exists`);

  {
    const bad = { groups: { net: "/assets/js/flows-net.js" } };
    const base = (extra) => `<script src="/assets/js/flows-ui.js?v=1" defer></script>${extra}`;
    const good = base('<i hidden data-defer="net" data-src="/assets/js/flows-net.js?v=1"></i>');
    eq(declarationProblems(good, bad, "fixture").join("; "), "", "the declaration checker passes a well-formed element");
    const has = (html, table, text) => declarationProblems(html, table, "fixture").some((p) => p.includes(text));
    ok(has(base('<i hidden data-defer="net" data-src="/assets/js/flows-net.js?v=1 /assets/js/flows-x.js?v=1"></i>'), bad, "one file per element"),
       "A SPACE-SEPARATED data-src FAILS: the version scan cannot see a second URL in a list");
    ok(has(base('<i hidden data-defer="net" data-src="/assets/js/flows-net.js?v=1,/assets/js/flows-x.js?v=1"></i>'), bad, "one file per element"), "and so does a comma-separated one");
    ok(has(good, { groups: {} }, "not in DEFERRED"), "A DEFERRED FILE MISSING FROM THE DEFERRED TABLE FAILS");
    ok(has(base(""), bad, "declares no element"), "a table entry with no element on the page fails");
    ok(has(base('<i hidden data-defer="net" data-src="/assets/js/flows-net.js"></i>'), bad, "not a versioned"), "an unversioned data-src fails");
    ok(has(base('<i data-defer="net" data-src="/assets/js/flows-net.js?v=1"></i>'), bad, "not hidden"), "an element that is not hidden fails");
    ok(has(`${good}<script src="/assets/js/flows-net.js?v=1" defer></script>`, bad, "also a script src"), "a file that is deferred and also a script src fails");
    ok(has(base('<i hidden data-defer="net" data-src="/assets/js/flows-other.js?v=1"></i>'), bad, "not among DEFERRED"), "a file other than the one the table names fails");
  }

  {
    const assetDir = new URL("assets/js/", REPO);
    const names = readdirSync(assetDir).filter((n) => /^flows-.*\.js$/.test(n));
    ok(names.includes("flows-ui.js") && names.includes("flows-dock.js") && names.length > 15, "the loader scan reads every flows-*.js file");
    const found = {};
    for (const n of names) {
      const src = readFileSync(new URL(n, assetDir), "utf8");
      const hits = [...src.matchAll(LOADERS)];
      if (hits.length) found[n] = { count: hits.length, at: hits.map((x) => x.index) };
    }
    eq(Object.keys(found).sort().join(", "), "flows-dock.js, flows-ui.js", "ONE LOADER: a script element or a dynamic import is created only by the dock and by FlowsUI.defer");
    eq(found["flows-dock.js"].count, 1, "the dock creates one script element");
    eq(found["flows-ui.js"].count, 1, "and flows-ui.js creates one, shared by FlowsUI.defer and the FlowsUI.link stub");
    const ui = read("/assets/js/flows-ui.js");
    const from = ui.indexOf("const loadJs = ");
    const to = ui.indexOf("const queued = ");
    ok(from > 0 && to > from && found["flows-ui.js"].at[0] > from && found["flows-ui.js"].at[0] < to, "and it sits in loadJs, the function FlowsUI.defer calls");
    const linkAt = ui.indexOf("const link = ");
    ok(linkAt > to && /loadJs\(me\.replace\("flows-ui\.js", "flows-link\.js"\)\)/.test(ui.slice(linkAt, linkAt + 700)), "the link stub loads its body through that same function");
    ok(/\bdefer,/.test(ui.slice(ui.lastIndexOf("window.FlowsUI = Object.freeze({"))), "FlowsUI.defer is exported");

    for (const m of measured) {
      const table = DEFERRED[m.name] || { groups: {} };
      const used = new Set();
      for (const src of m.srcs) {
        let code;
        try { code = read(src); } catch { continue; }
        for (const g of code.matchAll(/\.defer\(\s*["']([\w-]+)["']/g)) used.add(g[1]);
      }
      const extra = [...used].filter((g) => table.groups[g] === undefined && !SHARED_GROUPS.has(g));
      eq(extra.join(", "), "", `${m.name} defers only what DEFERRED lists for it (${Object.keys(table.groups).join(", ") || "nothing"})`);
    }
    const oracleBytes = ORACLE_FILES.reduce((a, f) => a + sizeOf(f), 0);
    ok(oracleBytes > 0 && oracleBytes <= ORACLE_DEFERRED_KIB * 1024, `the Neuron's two files weigh ${oracleBytes} B, inside their stated ${ORACLE_DEFERRED_KIB} KiB, and load only when a page carries its markup`);
    for (const m of measured) {
      if (!m.parts.some((p) => /^flows-dock\.js/.test(p))) continue;
      const shelled = PAGES.oracleShell(m.html, "on", "overview");
      const added = shelled.length - m.html.length;
      ok(added > 0 && added <= ORACLE_MARKUP_BYTES + 400, `${m.name}: the Neuron's placeholder adds ${added} B of markup`);
      eq(PAGES.oracleShell(m.html, "off", "overview"), m.html, `${m.name}: with the switch off the page is untouched`);
    }
    const bootBytes = sizeOf("/assets/js/flows-member-boot.js");
    ok(bootBytes > 0 && bootBytes <= MEMBER_BOOT_MAX, `the member boot weighs ${bootBytes} B, inside its stated ${MEMBER_BOOT_MAX} B, and is the only eager member script`);
    const memberBytes = MEMBER_GROUP.reduce((a, f) => a + sizeOf(f), 0);
    ok(memberBytes > 0 && memberBytes <= MEMBER_GROUP_KIB * 1024, `the member files (storage.js, the module and the dialogs) weigh ${memberBytes} B together, inside their stated ${MEMBER_GROUP_KIB} KiB`);
    const coreGzip = gzipOf("/assets/js/flows-member.js");
    ok(coreGzip > 0 && coreGzip <= MEMBER_CORE_GZIP_MAX, `the module the ticker's star and the export menu load weighs ${coreGzip} B gzip, inside ${MEMBER_CORE_GZIP_MAX} B: the dialogs and the store load only when a member opens one`);
    const coreText = read("/assets/js/flows-member.js");
    ok(!/IEWTStorage\.(?!flowsWatchlist|setFlowsWatchlist|clearFlowsWatchlist|onFlowsWatchlist)/.test(coreText) && !coreText.includes("createElement(\"dialog\")") && !coreText.includes("showModal"), "the module holds no dialog and calls only the watch-list part of the store");
    ok(sizeOf("/assets/css/flows-member.css") <= 10 * 1024, "the member sheet stays under 10 KiB and rides on the group, not on the page");
    for (const m of measured) {
      const slug = MEMBER_SLUG[m.name];
      if (!slug) continue;
      ok(!m.html.includes("flows-member"), `${m.name}: the page itself carries no member script or sheet`);
      const shelled = memberShell(m.html, { slug, on: true, exportOpen: false });
      const added = shelled.length - m.html.length;
      ok(added > 0 && added <= MEMBER_MARKUP_BYTES, `${m.name}: the member markup adds ${added} B`);
      eq(memberShell(m.html, { slug, on: false }), m.html, `${m.name}: with the switch off the page is untouched`);
    }
    const dossier = read("/assets/js/flows-ticker.js");
    ok(!LOADER.test(dossier), "the dossier creates no script element of its own");
    eq(/\.defer\(/.test(dossier), Object.keys(DEFERRED.tickerPage.groups).length > 0,
       "and calls FlowsUI.defer only if DEFERRED.tickerPage lists a group");
  }

  {
    const kernelV = EAGER_KERNEL.filter((k) => k.team !== "F").reduce((a, k) => a + k.kib, 0);
    ok(kernelV <= KERNEL_LIMIT.kib + 1e-9, `the shared eager kernel of teams V and L is ${kernelV.toFixed(1)} KB, at most ${KERNEL_LIMIT.kib} (${KERNEL_LIMIT.decision})`);
    for (const k of EAGER_KERNEL) {
      if (!k.landed) continue;
      const src = read(k.landed.file);
      ok(k.landed.has.test(src), `kernel entry "${k.name}" is marked landed and is in ${k.landed.file}`);
      if (k.landed.from) {
        const a = src.search(k.landed.from), b = src.search(k.landed.to);
        ok(a >= 0 && b > a, `kernel entry "${k.name}" has a measurable span in ${k.landed.file}`);
        const kib = Buffer.byteLength(src.slice(a, b)) / 1024;
        ok(Math.abs(kib - k.kib) <= 0.15, `kernel entry "${k.name}" is stated at ${k.kib} KB and measures ${kib.toFixed(2)} KB, so the ledger says what landed`);
      }
    }
    if (TICKER_RAISE) {
      const grouped = Object.entries(DEFERRED.tickerPage.groups).filter(([g]) => g !== "surface" && g !== "movelab" && g !== "network" && g !== "live" && g !== "nn-orb").map(([, f]) => f).flat().reduce((a, f) => a + bytesOf(f), 0);
      ok(TICKER_RAISE.bytes <= 1613, `the ticker's raise (${TICKER_RAISE.od}) is at most the 1,613 B it was made with`);
      ok(grouped < TICKER_RAISE.bytes, `THE TICKER'S ${TICKER_RAISE.bytes} B RAISE STAYS ONLY WHILE THE TICKER DEFERS LESS THAN IT: ${grouped} B of group files are deferred; once they reach the raise, delete TICKER_RAISE (${TICKER_RAISE.od}) and the ceiling returns to 400 KiB`);
      console.log(`  ticker ceiling carries a pending ${TICKER_RAISE.od} deduction of ${TICKER_RAISE.bytes} B: ${TICKER_RAISE.why}`);
    }
    for (const k of EAGER_KERNEL) {
      if (k.landed) continue;
      const hit = readdirSync(new URL("assets/js/", REPO)).filter((n) => /^flows-.*\.js$/.test(n)).filter((n) => /\bFlowsUI\.(scheduler|frame)\b|\bX-Basis\b|\bflowRadarStub\b/.test(readFileSync(new URL("assets/js/" + n, REPO), "utf8")));
      eq(hit.join(", "), "", `kernel entry "${k.name}" is pending and absent from the tree, so the list cannot claim bytes already counted`);
    }
    const pending = EAGER_KERNEL.filter((k) => !k.landed).reduce((a, k) => a + k.kib * 1024, 0);
    console.log(`  eager headroom against the 1 KiB floor, with the ${(pending / 1024).toFixed(1)} KB of pending kernel entries still to land on a live route:`);
    const live = (m) => m.srcs.includes("/assets/js/flows-rt.js");
    const below = [];
    for (const m of [...measured].sort((a, b) => (CEILING_KIB[a.name] * 1024 - a.bytes) - (CEILING_KIB[b.name] * 1024 - b.bytes))) {
      const headroom = Math.round(CEILING_KIB[m.name] * 1024 - m.bytes);
      const after = live(m) ? Math.round(headroom - pending) : headroom;
      console.log("    " + m.name.replace(/Page$/, "").padEnd(10) + String(headroom).padStart(7) + " B now" + (live(m) ? String(after).padStart(8) + " B after the kernel" : "") + (after < FLOOR_BYTES ? "   BELOW THE FLOOR" + (BELOW_FLOOR[m.name] ? " (" + BELOW_FLOOR[m.name] + ")" : "") : ""));
      ok(headroom >= 0, `${m.name} has non-negative headroom`);
      if (after < FLOOR_BYTES) below.push(m.name);
    }
    eq(below.sort().join(", "), Object.keys(BELOW_FLOOR).sort().join(", "),
       "THE ROUTES BELOW THE 1 KiB FLOOR ARE EXACTLY THE ONES NAMED WITH A RELIEF ROW: a route that falls under it without a named relief fails, and a route that gets back over it must leave the list, so the list only shrinks on purpose");
  }
}

console.log(`✓ flows-weight: ${checks} assertions — every route's JavaScript weighed from the ` +
  `HTML it actually emits rather than from a list that could go stale, every emitted script ` +
  `proven to exist so a deferred 404 cannot leave a route a silent shell, a stated ceiling ` +
  `per route and no ceiling without a route, the table printed on every run so the number ` +
  `lives in the log of a build that passed, and the deferred renderer proven to fit inside ` +
  `no dock route's headroom`);
