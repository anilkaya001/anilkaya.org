/* =============================================================
   flows-weight.mjs — what each route actually ships.

   THE ONE NUMBER NOBODY TOOK. This product's owner asked for it to
   be "blazing fast", and every performance conversation in this
   repository has been about the PIPELINE: the vendor's rate limit,
   the sleep that overlapped nothing, the eight sorts per column. All
   of that is real and all of it happens at 05:15 in a runner nobody
   is watching.

   The speed a reader actually experiences is the other one, and it
   had never been measured: the bytes a browser must fetch, parse and
   compile before a single panel draws. Both bundles on the deepest
   route are `defer`, so they do not block the parser — and then they
   run, in order, before anything appears.

   WHY A BUDGET AND NOT A BENCHMARK. A timing benchmark on shared CI
   measures the runner's mood: it passes on a quiet box, flakes on a
   loaded one, and proves nothing either way. Bytes are exact, they
   are the input the timing is a function of, and a route that grew
   by a hundred kilobytes did so in a diff somebody wrote. This suite
   turns "blazing fast" from an aspiration into a number that fails a
   build when it moves the wrong way.

   THE LIST IS DERIVED, NEVER TYPED. Every route's scripts are read
   out of the HTML the page function actually emits, so a route that
   gains a bundle is measured with it on the next run rather than
   whenever somebody remembers to update a list here. A hand-written
   inventory of what each page loads is a second copy of a fact the
   page already states, and this repository's own history is a
   catalogue of what happens to those.

   THE CEILINGS ARE A RATCHET, NOT A TARGET. Each is set above
   today's measurement with room for ordinary work, so a route has to
   grow materially before it trips. Tripping one is not a failure to
   fix by raising it: it is a prompt to ask whether the route needed
   what it just gained. Raising a ceiling is a decision, and it should
   look like one in a diff.
   ============================================================= */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import * as PAGES from "../shared/flows-pages.js";

/* PATHS RESOLVE AGAINST THIS FILE, NEVER AGAINST THE PROCESS.

   The first version measured `statSync("." + src)`, which resolves against the
   CURRENT WORKING DIRECTORY. Run from the repository root that is correct; run
   the way CI runs it — npm scripts execute with the cwd set to `tests/` — it
   is `tests/assets/js/nav.js`, which does not exist, and every single file
   came back missing. The suite then failed with its own words: "a deferred
   script that 404s leaves the route a shell with no renderer".

   The irony is the useful part. A file-existence assertion whose path is wrong
   reports exactly what a genuinely missing file reports, so the failure text
   was a confident, well-argued lie about the repository. Every other suite in
   this directory resolves through `import.meta.url` for this reason, and this
   one now does too: the file's location is a fact about the file, and the
   working directory is a fact about whoever happened to run it. */
const REPO = new URL("../", import.meta.url);
const sizeOf = (src) => statSync(new URL("." + src, REPO)).size;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* Per-route ceilings in KiB of UNCOMPRESSED JavaScript. Uncompressed because
   that is what the browser parses and compiles: transfer is gzipped and is
   roughly a quarter of this, but the parse is not, and the parse is the part
   that happens on the reader's own CPU before anything draws.

   FIRST MEASURED 2026-09-03, then RE-RATCHETED the same day when the
   early-warning refit landed. Both numbers are kept, because the delta is the
   part worth looking at and a ceiling that quietly absorbs its own overrun is
   not a ceiling:

     route      before   after   what it bought
     ticker       365k    413k   grouped panels, a jump index, deep-linking
     side         214k    254k   search, sort, and the board's memory columns
     overview     233k    251k   the change lead, the earnings join, staleness
     watch        182k    192k   the direction of travel and its projection
     desk          85k    107k   a named cut, a sticky header, a live clock
     track         51k     89k   sorts that answer "what moved"
     market        72k     73k   the sector sign fix
     unusual       61k     61k   unchanged
     events        60k     60k   unchanged
     political     28k     28k   unchanged
     history       26k     26k   unchanged
     login          3k      3k   unchanged

   THE SHARED BUNDLE WAS WHERE THE COST COMPOUNDED, AND IT IS ONE ROUTE NOW.
   flows-panels.js went from 137k to 147k while loaded on FOUR routes, so ten
   kilobytes of panel work was forty kilobytes of parse across the section,
   three quarters of it on routes that are not the panel workspace. Keeping
   that visible is what got it fixed: those three carried the library for a
   card dialog, the dialog is retired, and it is on /flows/ticker/ alone. A
   per-route ceiling is what made the cost attributable; one total would have
   hidden it in an average.

   RAISING A CEILING IS A DECISION AND IT LOOKS LIKE ONE HERE. These are set
   above the post-refit measurement with room for ordinary work, not fitted
   snugly to it — a ceiling set at today's number turns every subsequent commit
   into a budget negotiation. Tripping one is still not a failure to fix by
   raising it again: it is a prompt to ask whether the route needed what it
   just gained.

   RE-RATCHETED AGAIN 2026-09-04, when the ticker page's injected stylesheet
   moved into flows.css:

     route      before   after   what changed
     ticker       422k    411k   236 lines of CSS stopped shipping as JS

   AND RATCHETED DOWN HARD 2026-09-05, WHEN THE CARD DIALOG WAS RETIRED — the
   largest movement this table has recorded, in the good direction, so it is
   written as plainly as a raise would be:

     route      before   after   what it shed
     overview   312.57k 146.23k  flows-panels.js 150.91k + flows-card.js 15.41k
     side       306.44k 139.62k  the same 166.32k
     watch      202.75k  36.72k  the same 166.32k

   Each row's before-minus-after misses 166.32k by a few hundred bytes in one
   direction or the other, and that residue is the route's OWN renderer
   changing size in the same patch: flows-overview.js lost 25 bytes and
   flows-board.js 513 as their openers became links, while flows-watch.js
   gained 296 saying why a watched name may have no card. Stated rather than
   rounded away, because a shed that does not reconcile is how a second change
   hides inside a first.

   ONE MODAL, THREE ROUTES, 166 KiB EACH — the only caller of the panel library
   on any of them, and assets/js/flows-watch.js does not contain the string
   `FlowsPanels` at all.

   Note the direction. A shed has to move the ceiling too, or the room the
   ceiling was written with silently becomes room plus the shed, and the next
   route to grow inherits headroom nobody decided to give it. 480 was set
   against a 413k measurement — 67k of deliberate room — so 470 against 411k
   keeps that same room rather than banking the saving.

   POLITICAL WAS SITTING AT ITS CEILING EXACTLY, 45k against 45k. That ceiling
   was set when the route measured 28k, and the route then gained its whole
   render layer: a midpoint bar drawn inside its own whisker on a shared axis,
   a holder table, an executing-account column, a breadth block. Nobody
   re-examined the number, so it stopped being a ratchet and became a
   tripwire — the next kilobyte on that route, from any commit, fails this
   suite with a message about a budget rather than about whatever the commit
   was doing. 55k restores the room this file's own rule asks for. That is the
   one case where raising a ceiling is not absorbing an overrun: the route is
   inside it, and the ceiling was left behind by work that already shipped. */
const CEILING_KIB = {
  /* 470 -> 480, AND THE FIRST NUMBER IS THE ONE THIS CHANGE DID NOT CAUSE:
     the route measured 468.53k against 470 before a byte of it landed. 470 was
     set 2026-09-04 against 411k and the route then spent all but 1.5k of that
     room with nobody re-deriving the number — the political case this file's
     header describes, on the heaviest route here. This change added 4,140
     bytes to flows-panels.js, and they are a fix and its argument: the priced
     move's caption painted 289.4 units across a 282-unit viewBox at 320px and
     was clipped at both ends, silently, on 48 of the 50 cards a dry run emits.
     480 leaves 7.0k on 472.95k — room for a fix, not for a feature.

     THE THREE FIGURES IN THIS PARAGRAPH WERE EACH WRONG ONCE, which is worth
     recording where the next person to quote a number will read it. Drafts of
     this comment said 3,376 and 3,977 bytes and put the route at 472.08k and
     472.79k — all taken mid-edit and never re-derived, in the one file whose
     whole subject is figures going stale. The values above are `git cat-file
     -s HEAD:` against `stat` on disk (154,528 -> 158,668) and the sum of the
     route's four scripts (6,003 + 2,560 + 158,668 + 317,065 = 484,296 B =
     472.95 KiB, leaving 7,224 B under 480). Re-derive, never re-quote: editing
     THIS comment does not change flows-panels.js, so a figure measured before
     the edit and pasted after it is wrong by the size of the edit.

     480 -> 493, AND THE PARAGRAPH ABOVE ALREADY NAMED THIS DECISION: "480
     leaves 7.0k on 472.95k — room for a fix, not for a feature." The station
     switcher is the feature, so it does not get to spend that reserve quietly;
     it has to move the number in the open, which is this.

     WHAT IT BOUGHT. The ticker page measured 11,468px of continuous scroll at
     1440 and 19,978px at 390 — 23 panels stacked, with a tab row that anchored
     into them rather than switching between them. On the default address it now
     measures 2,622px and 4,309px: 77% and 78% less page to read. `?s=all` still
     renders 11,468 and 19,978 EXACTLY, at both widths, which is the measurement
     that proves the switcher changed what is in the flow and nothing about the
     layout.

     WHERE THE 13k WENT, re-derived rather than quoted — the four scripts of
     tickerPage(), `stat` on disk: 6,003 + 2,560 + 159,278 + 329,821 =
     497,662 B = 486.00 KiB. Two changes, and only the second is this PR's:
     PR 2's stations took flows-panels.js from 158,668 to 159,278 and had
     already moved the route to 477.66k, spending 4.7k of the reserve before a
     byte of the switcher landed. The switcher itself is 8,543 B of
     flows-ticker.js (321,278 -> 329,821). 493 leaves 7,168 B on 486.00 KiB —
     the same reserve the last decision set, and for the same reason: a fix,
     not the next feature.

     493 -> 496, AND THE FIRST THING TO SAY IS THAT THE PARAGRAPH ABOVE WAS
     QUOTED AS A MEASUREMENT AND IS NOT ONE. "493 leaves 7,168 B" was true of a
     486.00 KiB route on 2026-09-05; two PRs have landed on it since. Re-derived
     — `stat` on disk against `git cat-file -s` at the merge base:

       file                before     after
       flows-dock.js        6,003     6,003
       nav.js               2,560     2,560
       flows-panels.js    159,290   161,628
       flows-ticker.js    336,334   336,334
       total              504,187   506,525 B = 494.65 KiB

     The room under 493 was 645 B, not 7,168, and this change needs 2,338. A
     comment read as if it were a reading is the precise failure this file
     exists to catch, and it happened here, to the person writing this line.

     WHAT IT BOUGHT, AND IT IS A FIX RATHER THAN A FEATURE. renderContext
     positioned the price sparkline BY INDEX and read none of `dropped`,
     `sessions`, `datedSessions` or `closeDates` — four fields buildContext
     (shared/flows-card.js, `buildContext`) publishes, the last of them carrying its own
     note: "Non-zero means index is NOT time in the arrays above, which is
     precisely when a reader needs the dates." So on a name with a session
     dropped from the window, the line was drawn straight across the hole as
     though the window were continuous. The pipeline computed the warning,
     published it, wrote down why it mattered, and the renderer discarded it.
     The panel now states the window's real extent in three branches — gapless,
     gapped, and a payload too old to say which — and only the gapped one tells
     the reader to read the line's shape and not its steepness.

     THE BYTES WERE NOT BOUGHT BACK BY SHORTENING THE COMMENT. The note on
     unusualPage below already settled that trade: doing so "is bookkeeping
     rather than engineering: it degrades the one thing this codebase is
     strictest about to satisfy a number." The number moves instead, in a diff,
     where it can be argued with.

     AND 496 RATHER THAN 502 — THE RESERVE IS DELIBERATELY NOT RESTORED. Both
     raises above left ~7 KiB as "room for a fix, not for a feature", and the
     470 paragraph records what became of one: the route "spent all but 1.5k of
     that room with nobody re-deriving the number." 496 leaves 1,379 B, which is
     room for nothing, and that is the intent. This route is already owed the
     reduction below; until it lands, the next change here has to move this
     number in the open rather than find room waiting for it.

     496 -> 500, AND THIS IS THE THIRD CONSECUTIVE RAISE, WHICH IS THE PATTERN
     THIS FILE'S HEADER WARNS ABOUT. Saying so is the point: 480 -> 493 -> 496
     -> 500, three PRs in a row, each argued and each measured, and a series
     that only goes one way is a ratchet pointing the wrong direction however
     good each individual argument was. Measured: 510,955 B = 498.98 KiB,
     leaving 1,045 B under 500.

     WHAT IT BOUGHT: five of the twenty-eight slots the design reserved and
     never filled. `.ft-station-lead` is served on all five stations and
     `.ft-panel-one` on all 23 panels; all of them styled, all
     `:empty{display:none}`, all asserted to arrive empty — and NOTHING had
     ever written to any of them. The stylesheet's own comment read "PR 4's
     one-line answer. Empty until then", and PR 4 shipped something else. Each
     station now carries a coverage line counted off the DOM the renderers
     actually emitted, answering the one question no panel can — what is
     missing here, before a reader scrolls six boxes to find out — with
     `unavailable` and `quiet` counted and named separately rather than
     collapsed.

     4,430 B of flows-ticker.js, AND MOST OF IT IS THE ARGUMENT FOR WHAT IS NOT
     THERE. The panel slots are not filled, because the obvious implementation
     — lift each panel's existing lead reading into its slot — was refused
     twice by the ticker contract, and reading the two failures together is
     what produced the rule now written beside the code: the slot sits
     immediately above the drawing, so moving a sentence up by one element
     changes nothing a reader sees while breaking invariants about where a
     finding lives. The nineteen panels that do not lead in their drawing are
     the ones the slot is for. Recording why the cheap version was wrong costs
     more bytes than the cheap version would have, and is worth them.

     THE REDUCTION IS NOT A HOPE, IT IS TWO MEASURED PATHS AND A BLOCKER EACH:

       comment-stripping the served copy   -229.96 KiB  (route 498.98 -> 269.03)
       a station-scoped panel deferral     -114.07 KiB  (upper bound, first paint)

     The first is measured here, byte-accurate: 235,481 B of this route's
     510,955 is comment, 46.1%. It is also the RIGHT reduction — gzip already
     handles transfer, and only stripping touches the parse this file's own
     header calls "the part that happens on the reader's own CPU". It is
     blocked on one field in the Workers Builds dashboard: Cloudflare's docs
     state twice that Workers Builds "does not honor the configurations set in
     Custom Builds within your Wrangler configuration file", so a `[build]`
     step in wrangler.toml would never run and the change would ship as a
     silent no-op behind a diff claiming the win. That is written down here so
     the next person does not spend the day discovering it.

     THE TRIGGER, AND IT IS NOT A PROMISE IN PROSE: the next change that would
     take this route past 500 does the reduction FIRST. Not alongside, not
     after. A fourth raise with neither path landed is this file failing at the
     one job it has.

     WHAT THE PREVIOUS RAISE SAID, AND THE FIGURE THAT SENTENCE USED TO CARRY
     WAS NOT A MEASUREMENT EITHER. It read "the deferral PRs (the eight
     ticker-only drawers out of flows-panels.js) take roughly 230k off this
     route". Nothing in the repository defines those eight drawers or that
     number — it appears here and nowhere else — and the table below now makes
     it arithmetically impossible: flows-panels.js is 161,628 B ENTIRE and, by
     the panelRoutes assertion further down, is on this route alone, so moving
     parts of it cannot take 230k off anything. The claim dates from when the
     bundle was on four routes and its cross-route total was the number in
     view.

     WHAT IS ACTUALLY DEFERRABLE, measured: the library splits at line 465 into
     22,589 B of scaffolding and 137,457 B of drawers. The default address
     shows ONE station, and the signal station needs exactly two of those
     drawers — renderOverlay and renderScore, 20,645 B — so an upper bound on
     what a station-scoped deferral takes off FIRST PAINT is 116,812 B =
     114.07 KiB. Upper bound, not a target: it assumes the switch to any other
     station pays the fetch, and the reader who arrives at #panel-gamma pays it
     immediately.

     AND A DEFERRED COST IS STILL A COST, WHICH THIS SUITE ALREADY KNOWS HOW TO
     HOLD. assets/js/flows-dock.js states in its own header what it defers and
     what that weighs, and the block at the foot of this file reads that
     sentence back out of the source and checks it against this table. A
     deferral of the panel library states its cost the same way, or it has
     moved bytes out of a measurement rather than off a reader's CPU. */

  /* 500 -> 404, AND IT IS THE FIRST TIME THIS NUMBER HAS EVER GONE DOWN.
     Four raises are recorded above — 470, 480, 493, 496, 500 — and the last of
     them set a trigger rather than a hope: "the next change that would take
     this route past 500 does the reduction FIRST. Not alongside, not after."
     The note fold that wanted 914 bytes was held behind that sentence and is
     still waiting; this is the reduction it was waiting for.

     MEASURED, `stat` on disk against `git cat-file -s` at the merge base:

       file                before      after
       flows-dock.js        6,003      6,003
       nav.js               2,560      2,560
       flows-panels.js    161,628     54,525
       flows-ticker.js    341,689    348,566
       total              511,880    411,654 B = 402.01 KiB

     97.88 KiB OFF FIRST PAINT, AND NOT THE 105.6 THE PLAN PREDICTED. The
     deferred file is 110.57 KiB, but the walk that defers it GREW: drawing one
     station instead of twenty-three panels, plus resolving each deferred
     drawer by name at call time, cost flows-ticker.js 6,877 bytes. The route's
     number is the honest one — the file's would credit this change with bytes
     it did not take off the page.

     AND THIS PARAGRAPH WAS WRITTEN TWICE, which is worth recording in the file
     whose whole subject is figures going stale. Its first draft said 99.70 KiB
     against a 400.18 KiB route and a 402 ceiling — measured before three
     defects surfaced in the loader: the enlarge dialog still called a drawer
     that had become a string, the station memo handed its second caller a
     resolved promise instead of the in-flight one, and a script tag answered
     with HTML fires onload rather than onerror. Fixing them added bytes, and a
     ceiling derived before the fixes would have been measured against code
     that never shipped.

     AND THE CEILING FOLLOWS THE ROUTE DOWN RATHER THAN STAYING WHERE IT WAS.
     Leaving it at 500 would bank 99.70 KiB of unargued room on the one route
     whose whole history is room being spent with nobody re-deriving the
     number — the 470 paragraph records exactly that happening. 402 leaves
     1,880 B, which is room for a fix and not for a feature, the same standard
     every raise above claimed and the 496 paragraph made real.

     WHAT IS STILL OWED, AND IT IS NOW BUILT RATHER THAN PROPOSED.
     scripts/strip-comments.mjs removes the comments from the SERVED copy and
     nothing else, and tests/flows-strip.mjs proves it: every output re-parsed,
     the pass proven idempotent, seven hand-written traps that look like
     comments and are not, and — the assertion that actually settles it —
     twenty emitted cards rendered through fourteen drawers TWICE, stripped
     and unstripped, with byte-equality of the drawn DOM.

     MEASURED OVER assets/js: 2,310,246 B -> 1,536,285 B, so 755.82 KiB and
     33.5% of the tree is prose the browser parses and no reader sees. Per
     route, against the ceilings in this table:

       ticker    403k -> 188k        market    102k ->  60k
       overview  146k ->  71k        ask        97k ->  49k
       unusual    93k ->  55k

     THE ONE THING IT WAITS ON IS NOT CODE. Cloudflare documents twice that
     Workers Builds ignores wrangler.toml's [build], so the command goes in
     the dashboard — Workers Builds -> Settings -> Build command ->
     `node scripts/strip-comments.mjs`. Until someone sets that field the
     script runs in CI and never in a deploy, which is why flows-strip proves
     CORRECTNESS and claims nothing about what production is serving.

     AND THE CEILINGS HERE GO ON MEASURING THE REPOSITORY. Once the field is
     set the served tree is smaller than every number this file prints, and
     that asymmetry is deliberate: a ceiling measured against the stripped
     output is one nobody editing this repository could check.

     404 LEAVES 2,042 B. The four raises above each claimed "room for a fix,
     not for a feature" and the 496 paragraph made that real by leaving 1,379;
     this leaves a comparable margin on a route that has just given back 97.88
     KiB, rather than banking the lot where the next change would find it
     waiting.

     404 -> 405, AND THE PARAGRAPH ABOVE HAD ALREADY STOPPED BEING TRUE. Before
     anything in this change touched the route, `stat` on the four scripts at
     origin/main gave 6,003 + 2,560 + 55,172 + 348,560 = 412,295 B against a
     413,696 B ceiling — 1,401 B of room, not the 2,042 the line above claims.
     Nothing was done wrong: the figure was measured when it was written and a
     later PR spent 641 B of it without re-deriving the number. That is the
     third time this file has caught its own prose drifting, and it is worth
     saying plainly that the drift is the normal case rather than the
     exception — a recorded number is a measurement with a date on it, and
     this file is the only thing that puts the date on it.

     WHAT THE 1,686 B BOUGHT, measured: flows-panels.js +1,668 and
     flows-ticker.js +18, for 413,981 B = 404.27 KiB, which is 285 B over.
     Almost all of it is comment, and it is the comment that was the point.
     Flows stopped using the mono family in this change: --font-mono was a
     JetBrains stack chosen for a FIXED 0.600 em advance, and the section now
     resolves --font-figure to Latin Modern, which is proportional. Two
     measurements had to be written down beside the code that rests on them or
     the next reader inherits a number whose face no longer exists — AXIS_CH,
     re-derived from 6.421 to the widest real caption at 5.079 and rounded to
     5.5, carrying the admission that "errs wide" is now a bound on the
     captions that EXIST rather than on any string; and atrDist, which records
     why the ATR-normalised distances stopped printing σ (Latin Modern does
     not draw it) and why the desk's identical-looking glyph became SD instead
     (it was never the same denominator).

     THE BYTES ARE NOT BOUGHT BACK BY SHORTENING EITHER ONE. The unusualPage
     note below settled that trade and this change is the case it was written
     for: a font swap whose whole risk is unmeasured numbers is the worst
     possible place to delete the measurements to save 285 B.

     405 LEAVES 739 B, which is less than the 1,401 this route actually had and
     far less than the 2,042 it believed it had. That is deliberate and it is
     the same argument the 496 paragraph made: this route is still owed a
     reduction, so the next change to it should have to come here and argue
     rather than find room waiting. */
  tickerPage: 405,
  /* 300 -> 312 on 2026-09-04, and this is a decision rather than an absorbed
     overrun. The route gained two regions a reader asked for: the eleven-
     basket sector premium lean and the news feed, ~27k of renderer between
     them. It came to 300.00 KiB against a 300 KiB ceiling — four bytes over —
     and the four bytes were briefly bought back by shortening comments, which
     is bookkeeping rather than engineering: it degrades the one thing this
     codebase is strictest about to satisfy a number.

     THE STRUCTURAL FIGURE IS NOT THE RENDERER, IT IS THE SHARED BUNDLE.
     flows-overview.js is 111k of this route; flows-panels.js is 148k — half
     the weight — and the overview loads it for the card dialog alone. The
     honest fix is not a bigger number here, it is that the overview should
     not parse the whole panel library to open one dialog. Until that is done,
     12k of headroom is what the two new regions need to be maintainable
     rather than golfed.

     +1, 2026-09-05, FOR THE DOCK'S KEYSTROKE — see the note on unusualPage
     below, which states this decision once for the three routes it lands on.
     Measured here: 584 bytes over before the raise, 440 in hand after.

     313 -> 160, AND THE PARAGRAPH ABOVE STANDS BECAUSE IT IS THE ONE THAT GOT
     DONE: it named the honest fix — the overview should not parse the whole
     panel library to open one dialog — and deferred it behind 12k of headroom.
     312.57k this morning, 146.23k now. THE NUMBER COMES DOWN WITH THE WEIGHT,
     this file's rule for a shed: room the ceiling was written with must not
     silently become room plus the shed. 160 leaves the 13.8k the entry above
     asked for and no more. */
  overviewPage: 160,
  /* 300 -> 306 FOR THE DOCKED ASSISTANT, WHICH COST 5k ON EVERY ROUTE WHEN
     THIS WAS WRITTEN AND COSTS 6k NOW. The board was at 297k and the tab,
     the empty panel and the loader took it to 302k. Raising the number is
     the honest move rather than shaving five kilobytes of comment out of
     flows-board.js to fit under a line nobody re-derived — this file's own
     header calls that degrading the thing this codebase is strictest about.

     THE DOCK IS 6,004 BYTES AS MEASURED 2026-09-05, up from 5,282: a "?"
     shortcut, the guard that keeps "?" a typeable character inside a field,
     and a focus call at the moment the renderer arrives. It grew to 7,254
     first and has been shed back by 1,250 bytes of block comment, because
     the dock is on twelve routes and market had 782 bytes of headroom — see
     marketPage below for why the shed happened there rather than here. 60
     bytes of that headroom are left, and unusualPage records what happened
     on the one route a shed could not cover.

     WHAT IS NOT COUNTED HERE IS THE RENDERER THE DOCK FETCHES. flows-ask.js
     is 94k as measured 2026-09-05 — it was 55k when this note was written
     and 79k at the last re-measure, and a figure left at the size a file
     used to be is worse than no figure, because a reader takes it for a
     measurement. It arrives only when a reader opens the panel, so it is
     absent from a measurement of what a route loads ON ARRIVAL, which is
     what this suite measures and should keep measuring. It is a real cost,
     paid on open, by the readers who asked for it. Stating it here is what
     stops a lazy import from looking free. */
  /* +1, 2026-09-05, the same raise for the same reason — the argument is on
     unusualPage below. Measured here: 455 bytes over before, 569 in hand
     after.

     307 -> 155 THE SAME DAY AND FOR THE SAME REASON AS overviewPage ABOVE:
     306.44k to 139.62k. What the reader loses is a modal; what they get is
     /flows/ticker/?t=, an address the row links to directly. 155 keeps 15.4k,
     about the proportion the entry above kept.

     155 -> 157, AND THE FIRST THING TO SAY IS WHAT THIS ROUTE JUST SPENT.
     Measured, `git cat-file -s` at the merge base against `stat` on disk:
     flows-board.js 115,523 -> 125,607 B, a growth of 10,084 in one wave. The
     route is 6,007 + 2,560 + 25,136 + 125,607 = 159,310 B against a 158,720 B
     ceiling — 590 B OVER, which is why this number moves.

     THE COMMENTS ARE NOT THE PLACE TO FIND 590 BYTES. unusualPage below
     already settled that trade: buying a breach back by shortening prose "is
     bookkeeping rather than engineering: it degrades the one thing this
     codebase is strictest about to satisfy a number." The number moves in a
     diff, where it can be argued with.

     WHAT IT BOUGHT, IN TWO PARTS.
       6,421 B — the re-sort became a MOVEMENT. Sorting fifty cards replaced
       the deck in one call, so a name's new position carried no relation to
       its old one and the only way to see that a name climbed was to have
       memorised where it was. The emphasis is recomputed in the same instant,
       so position and loudness change together; cutting between two such
       states asks a reader to diff two boards from memory. Plus the price
       line drawing itself on arrival, which is one CSS rule for all fifty
       because the path declares pathLength="1".
       3,663 B — three bug fixes on that code, two of them reproduced in a
       browser before being written: an entrance that re-ran on every card
       when a reader toggled reduced motion off (measured at opacity 0), and a
       `is-flipping` class stranded forever when the preference cancelled a
       transform transition without firing transitionend (measured with
       z-index 1 still set). Neither is polish; both are the interactive layer
       misbehaving for exactly the reader who asked it not to.

     157 AND NOT 160, AND THE ROUTE IS OWED A REDUCTION. 157 leaves 1,458 B,
     the same order the 493 -> 496 raise on tickerPage deliberately left, and
     for the identical reason stated there: a reserve gets spent by whoever
     finds it, so the next change to this route should have to argue in the
     open rather than discover pre-authorised room waiting. The reduction that
     exists and has not been taken: this file loads ONE script that renders
     BOTH the deck and the thirteen-column table, and a reader sees one of
     them — ?view= decides which. Deferring the table the way flows-dock.js
     defers the assistant is the move, and it is a change of its own rather
     than something to bundle into a bug fix. */
  sidePage: 157,
  /* 240 -> 48, AND HERE THE COST WAS PUREST WASTE: assets/js/flows-watch.js
     does not contain the string `FlowsPanels`, so all 150.91k was fetched,
     parsed and compiled on every visit for a dialog flows-card.js drew.
     202.75k to 36.72k, the right weight for a page whose content is one
     table. 48 rather than 40 for the proportion this header asks for. */
  watchPage: 48,
  deskPage: 135,
  /* SET AT FIRST MEASUREMENT, 2026-09-04, against 102k — nav 3k, flows-ui 25k,
     flows-strategy 75k.

     THE ROUTE'S BUDGET WAS AN ARGUMENT BEFORE IT WAS A NUMBER, and the
     argument is what it does NOT load. The strategy tester needs a payoff
     engine, a diagram, a chain table and a leg editor; what it emphatically
     does not need is flows-panels.js, which is 155k.

     THAT SENTENCE USED TO END "and sits on four other routes for the sake of
     a card dialog this page has no reason to open". It sits on ONE now: the
     three whose own renderers never named it gave back 166k each.
     This route's decision is unchanged and was right before the others caught
     up with it — weight should be what a page uses, not what it inherited.
     Putting the tester on the premium desk's route — its natural neighbour,
     and the one other page that spends live vendor calls on the request
     path — would have cost the desk 75k against 15k of headroom, so it is its
     own route and the desk is untouched.

     Every kilobyte of the 102 is either this page's own code or FlowsUI, which
     is 25k and is the reason the page has no second copy of isNum, the em dash
     or the U+2212 formatter. That is the shape a route has when its weight is
     what it uses rather than what it inherited.

     120 rather than 105: the proportion of room this file's own rule asks for,
     and the same the desk and the track pages were given, so ordinary work on
     the engine is not a budget negotiation on every commit. */
  /* MEASURED AT 57k, CEILING 70k. The page's own HTML is a lede and one
     empty container — the renderer builds everything else — so nearly all
     of this is assets/js/flows-ask.js, and the headroom is for the
     briefing's regions rather than for the shell. It is the ONLY route
     here whose weight buys a reader a whole session's readings without a
     second page load, which is why it sits above the market page and
     below the ticker. If it approaches the ceiling, the answer is to move
     work into shared/flows-ask.js — which is bundled into the Worker and
     costs the browser nothing — not to shorten what the page says. */
  /* 70 -> 78. The dock's 5k is on this route too — /flows/ask does not
     draw the rail, but flows-ask.js is the file the rail loads, so the
     route and the rail have grown together. The rest is the density pass:
     folding a region's meta into its disclosure and splitting the
     forecast qualifier into an arm that folds and an arm that never does
     cost bytes to SAVE a reader lines, which is the trade this page was
     asked to make. */
  /* 78 -> 84 on 2026-09-04, and it is the political case above rather than
     an absorbed overrun: 78 was set against a 77.5k measurement, which is
     the snug fit this file's own header refuses. A ceiling with half a
     kilobyte of room is a tripwire, and the next commit to trip it fails
     with a message about a budget rather than about what the commit did.

     WHAT THE ROUTE GAINED IS THREE CORRECTED CLAIMS, all of them the page
     stating something it had not measured: a consistency report printing
     `warningsChecked` with no denominator, so four of thirteen questions
     asked read as a complete sweep; a provenance line telling a reader
     "every figure it wrote was checked" over an answer that stated no
     figure; and an audit paragraph offering `n` as the set of figures in
     the prose when the guard scans `say`, so a ticker's own digits looked
     like a figure that had slipped through. The prose that fixes them is
     the deliverable, and the entry above says what to do if this route
     approaches its ceiling — move work into shared/flows-ask.js, which the
     Worker bundles and the browser never pays for — not shorten what the
     page says. That is the shed to make; it is not this change. */
  /* 84 -> 97 on 2026-09-04, and this is the SECOND consecutive raise, which
     is the pattern the entry above said to watch for. What the route gained
     is the model budget — a gauge drawn above the field rather than under
     the answer, because a budget you can only see after spending from it is
     a receipt — and Enter-to-send with its input-method guard.

     I TRIMMED MY OWN COMMENTS RATHER THAN THE PAGE'S PROSE, and the
     distinction is the one this file keeps making. The change first
     measured 95k: +12k, of which +6.8k was comment and +5.2k code. Comments
     I had just written are mine to edit and 2.2k of restatement came out;
     the page's sentences are the deliverable and none of them did.

     THE SHED IS NOW OWED. The entry above named it — move work into
     shared/flows-ask.js, which the Worker bundles and the browser never
     pays for — and deferred it once. Deferring it twice is how a ceiling
     becomes a ratchet, so it is filed as its own task rather than as a
     third comment promising it. 97 against a 93k measurement leaves 4k,
     which is room for a fix and not room for a feature: the next thing
     that wants space here should find the shed already done.

     THE NEXT WAVE SPENT THAT 4k AND PAID FOR THE REST IN COMMENT BYTES,
     which is the shed this file's own header sanctions and the one the
     entry above described. It bought: an evidence list that fits the
     docked rail rather than overflowing it, each selected sentence printed
     once rather than as an answer and again as evidence, the key and stamp
     stated once with a denominator instead of under all fourteen facts, a
     withholding lifted out of the method disclosure, three example
     questions and the name of the page the rail is docked to. Measured
     94k against 97, so the ceiling did not move; what moved was 14k of
     block comment inside assets/js/flows-ask.js — the restatement, the
     stale flows.css line references, and a class inventory that had become
     a commentary. Not one sentence a reader sees was shortened.

     THE MARGIN IS 163 BYTES, and that is the whole number rather than a
     rounded reassurance: the route measures 99,165 bytes against 99,328.
     The repair pass that widened the page's ticker bound to the shape
     /flows/ticker actually serves spent the last of it and bought a
     further 1,300 bytes of comment back to stay inside. There is nothing
     left to sell here. The shed named above — moving prose into
     shared/flows-ask.js, which the Worker bundles and the browser never
     fetches — is no longer owed at some point, it is owed before the next
     sentence of code lands on this route. */
  askPage: 97,
  strategyPage: 120,
  trackPage: 118,
  /* 95 -> 102, THE SAME DOCK AS EVERY OTHER ROUTE. The market page was the
     tightest of the mid-weight routes at 95k against 95, so it is the one
     the assistant pushed over. See sidePage above for why the number moves
     rather than the comment budget, and for what this measurement
     deliberately does NOT count.

     AND THIS IS THE ROUTE THAT MADE THE DOCK GIVE BYTES BACK. The 102 was
     set with 782 bytes in hand against a 5,282-byte dock; flows-market.js
     then grew to 95,824 and the assistant's second wave took the dock to
     7,254, which put the route 1,190 bytes OVER. Raising 102 would have
     been absorbing an overrun, which is the one thing the header above
     forbids, and shedding from flows-market.js would have paid for the
     dock's bytes out of a file that did not spend them. So the dock shed
     1,439 bytes of its own block comment and the route measures 102k
     against 102 with 249 bytes in hand. That margin is thin and it is
     stated so nobody spends it twice: the next thing that wants space on
     this route should expect to argue for it.

     102 -> 109, AND THIS IS THAT ARGUMENT. Re-derived rather than quoted,
     `stat` on disk against `git cat-file -s` at the merge base:

       file                before      after
       flows-dock.js        6,003      6,003
       nav.js               2,560      2,560
       flows-market.js     95,824    101,923
       total              104,387    110,486 B = 107.90 KiB

     WHAT IT BOUGHT. Four panels — tilt, breadth, sector momentum and against
     the tape — each wrote ONE paragraph holding three different kinds of
     sentence: the finding, the caveats that change what the drawing means,
     and the decoder. A reader met them as an undifferentiated block BELOW
     the marks they were about. They are sorted now: the finding leads above
     the drawing as `.fc-reading.is-lead`, the caveats sit under it as
     `.fc-note.is-qualifier` with the rule down their left, and the method is
     last. Not one sentence was deleted, and tests/flows-market-contract.mjs
     asserts the placement separately from the wording, because every regex
     it already had would pass with all three kinds back in one paragraph.

     THE SPLIT IS 6,099 BYTES AND ONLY 1,045 OF THEM ARE CODE. The rest is
     the argument for it, and the two figures are given separately because
     they have different futures: measured through scripts/strip-comments.mjs
     the route goes 60.44 -> 61.46 KiB, so once the Workers Builds command is
     set the comment costs a reader nothing at all and this ceiling is
     measuring a file no browser will parse.

     THE ARGUMENT IS THE LARGEST SINGLE ITEM IN IT, and that is deliberate.
     An adversarial pass over the eleven sentences on this page that read as
     foldable derivation refuted ALL ELEVEN, and for one structural reason:
     seven are the `cost` argument of pendingLine(what, cost), which puts
     both halves in one <p data-empty="pending">, so folding one splits a
     silence and moves half of it outside the mark every test and every
     reader finds it by. That finding is worth more than the bytes it costs,
     because the next person to look at this page will otherwise reach for
     the fold again. It is written down once, in flows-market.js's header,
     rather than at the five sites that would each have restated it.

     109 LEAVES 1,130 BYTES, which is room for a fix and not for a feature —
     the reserve the ticker's 496 left, for the same reason. Two leads this
     route was measured to be missing, on the tape and over the pulse grid,
     are NOT in this change: they are new sentences rather than sorted ones,
     and they should arrive with their own argument.

     109 -> 111, AND IT IS THE FIX THAT 1,130 WAS RESERVED FOR — spent within
     the hour, on the same route, which is worth saying plainly rather than
     burying. Measured: 110,486 -> 112,515 B = 109.88 KiB, of which 280 bytes
     are code. Two defects and one stale figure, all three found by a review
     of the merged diff after BOTH bot reviewers declined it:

       paintAgainst cleared only its note, so the four early returns below it
       left the previous paint's join count standing at lead size above a
       silence. paintSectors had been given exactly this fix in the change
       that introduced the slots; paintAgainst had not.

       paintBreadth led with the premium concentration even when the name
       split it sits above could not be drawn, so a figure at lead size stood
       over the panel's own "cannot be drawn".

       And the header's list of measured method groups read "322, 230, 143,
       119 and 81" when the 143 no longer existed — measured honestly, then
       invalidated by an edit in the same PR and not re-derived.

     THE RATCHET IS REAL AND THIS IS THE SECOND RAISE IN TWO PRs. What ends
     it is not shedding prose — the header of flows-market.js now records why
     nothing on that route folds — but the Workers Builds command, which
     takes the route to 61.74 KiB and makes every byte of this argument free.
     Until then the ceiling measures a file no reader will parse once it is
     set, and 111 leaves 1,149 bytes. */
  marketPage: 111,
  /* THE +7 ON THIS AND THE FOUR ENTRIES BELOW IS THE DOCKED ASSISTANT.
     assets/js/flows-dock.js now ships on every gated route but /flows/ask,
     and these were the routes with less than that in hand. The reasoning is
     sidePage's, once: the number moves rather than the comment budget, and
     the renderer the dock fetches on first open is deliberately NOT in this
     measurement, which is of what a route loads on arrival.

     AND +1 MORE, 2026-09-05, WHICH IS A DECISION AND IS WRITTEN DOWN AS ONE.
     IT IS THE SAME DECISION ON THREE ROUTES — overviewPage and sidePage above
     take the identical +1 and point here rather than repeat it; the other
     nine dock routes absorbed the growth out of headroom they already had.

     The route measures 92.53k. The dock went 5,268 -> 6,004 bytes: the "?"
     shortcut, the guard keeping "?" typeable inside a field, and the focus
     call at the moment the renderer arrives. THE GROWTH IS CODE — its
     comments came out 74 bytes SMALLER than they went in — which is why
     shedding prose could not pay for all of it.

     SHEDDING WAS STILL TRIED FIRST, AND IS SPENT. About a thousand bytes of
     genuine restatement came out of flows-dock.js, flows-ask.js and
     flows-unusual.js: a paragraph repeating a measurement its own opening
     already gave, a rule stated twice in two files, the long form of a dedup
     note. That cleared market and ask without moving either line. Two further
     attempts were reverted BY THIS SUITE, which asserts the dock's
     deferred-renderer paragraph down to its sentence shape — the mechanism
     working, and the boundary between restatement and argument drawn by
     something other than my own judgement. What is left is argument, and
     shortening an argument to fit a byte ceiling is what this file's header
     calls degrading the thing the codebase is strictest about.

     WHAT THE ROUTE GAINED FOR THE KILOBYTE: the assistant is reachable here
     by one keystroke instead of a navigation away from the reading. That is
     the question the assertion below asks, answered rather than dodged. The
     margin is 485 bytes and it is thin; the next thing that wants space on
     this route should expect to argue for it. */
  unusualPage: 93,
  eventsPage: 92,
  politicalPage: 62,
  historyPage: 52,
  loginPage: 12,
};

/* Every exported page function, found rather than listed — so a route added
   without a ceiling fails here instead of shipping unmeasured. */
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
    html = String(PAGES[name]({ username: "tester", ticker: "AAPL" }));
  } catch (error) {
    assert.fail(`${name} threw while rendering: ${error && error.message}`);
  }

  /* Scripts with a src only. An inline script is bytes too, but it arrives
     inside the HTML this same function emitted and is counted by the document
     size rather than by a separate fetch. */
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((m) => m[1].split("?")[0]);

  ok(srcs.length > 0, `${name} emits at least one script, so the measurement has a subject`);

  let bytes = 0;
  const parts = [];
  for (const src of srcs) {
    /* THE SCRIPT MUST EXIST. A rename or a moved file that misses one page
       yields a 404 for a deferred script, which fails silently: the document
       renders, no renderer runs, and the route is a shell with a spinner that
       never resolves. Nothing throws and nothing overflows. */
    let size = null;
    try { size = sizeOf(src); } catch { size = null; }
    ok(size !== null,
       `${name} emits ${src} and that file exists — a deferred script that 404s leaves the ` +
       `route a shell with no renderer, and it fails silently: the document renders, nothing ` +
       `draws, and no error reaches anything that watches`);
    if (size === null) continue;
    ok(size > 0, `${src} is not empty`);
    bytes += size;
    parts.push(src.split("/").pop() + " " + Math.round(size / 1024) + "k");
  }

  measured.push({ name, kib: bytes / 1024, parts });
}

/* THE TABLE IS THE DELIVERABLE. Printed on every run so the number exists in
   the log of a build that passed, not only in the message of one that failed. */
measured.sort((a, b) => b.kib - a.kib);
console.log("  route JavaScript, uncompressed:");
for (const m of measured) {
  const ceiling = CEILING_KIB[m.name];
  console.log(
    "    " + String(Math.round(m.kib)).padStart(4) + "k" +
    (ceiling ? " / " + String(ceiling) + "k" : "  (no ceiling)") +
    "  " + m.name.replace(/Page$/, "").padEnd(10) + m.parts.join("  "));
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

/* NO CEILING WITHOUT A ROUTE, either: a stale entry here would quietly stop
   guarding anything while still reading as a guard. */
for (const name of Object.keys(CEILING_KIB)) {
  ok(pageNames.includes(name),
     `the ceiling for ${name} guards a route that still exists — a stale entry reads as a ` +
     `budget and enforces nothing`);
}

/* THE SHAPE OF THE PROBLEM, ASSERTED RATHER THAN LEFT TO THE EYE. The heaviest
   route is heavier than the lightest non-trivial one by an order of magnitude,
   and one bundle carries most of that difference across four routes. This is
   not a failure — it is the fact the table exists to keep visible, and it is
   pinned so that a change which fixes it is visible as a change. */
{
  const heaviest = measured[0];
  const panelRoutes = measured.filter((m) => m.parts.some((p) => /^flows-panels\.js/.test(p)));
  ok(heaviest.kib > 350,
     `the heaviest route still ships over 350k (${Math.round(heaviest.kib)}k on ` +
     `${heaviest.name}) — asserted as a STANDING FACT rather than as a target, so that the ` +
     `day someone splits that bundle this line fails and has to be rewritten deliberately ` +
     `rather than the improvement passing unnoticed`);
  /* THE BUNDLE IS ON THE ONE ROUTE THAT DRAWS WITH IT. This inverts the
     assertion it replaces, which read `panelRoutes.length >= 3` over four
     routes loading 151k for "the card overlay a deep link opens, which most
     visitors to those routes never open" — a standing fact, pinned so the day
     somebody fixed it the line would fail and be rewritten deliberately. This
     is that rewrite. EXACTLY ONE, not "at most one": a route that quietly
     picks the bundle up again fails here, and so does a ticker page that stops
     loading the library it is built out of. */
  eq(panelRoutes.length, 1,
     `the panel bundle is on exactly one route (${panelRoutes.map((m) => m.name).join(", ") ||
      "none"}) — it was on four, and on three of them the only thing that ever reached it ` +
     `was the card dialog: none of flows-overview.js, flows-board.js or flows-watch.js ` +
     `contains the string FlowsPanels, and on /flows/watch/ not even the dialog did, ` +
     `because that page minted no opener for its delegation to find`);
  eq(panelRoutes[0] && panelRoutes[0].name, "tickerPage",
     "and that route is the panel workspace itself, not a board that inherited it");
}

/* =============================================================
   ONE FILE, ONE MEASUREMENT, WHEREVER IT IS QUOTED.

   assets/js/flows-dock.js exists to keep the assistant's renderer OFF every
   route until somebody opens the rail, and the whole argument for that is a
   number: how big flows-ask.js is. That number is written down twice — in
   the dock's own header and in this file's sidePage note — and one wave
   left it saying "95KB" in one place and "94k" in the other, for a file
   that is neither 95 KB nor 95 KiB. A reader who checks one of them has
   been told something false about the cost of a feature, and the two
   disagreeing is the tell that neither was re-measured.

   The dock's header also stated a CONSEQUENCE — how many routes the
   renderer would break if it shipped on arrival — and that count was left
   at "six" from when the renderer was 55k, inside a sentence whose
   measurement the same commit had just rewritten. It is now every one of
   the twelve, and it is derived below from the same table the ceilings are
   checked against rather than counted by hand a second time.

   THESE ASSERTIONS ARE DELIBERATELY BRITTLE. They fail whenever flows-ask.js
   crosses a kilobyte, and the fix is to update the SENTENCE, never to loosen
   the test: a comment carrying a measurement is a claim this suite is
   already standing in front of the data to check, and an unchecked one is
   exactly how "55k" survived two rewrites of the file it describes.
   ============================================================= */
{
  /* THE SECOND DEFERRAL, HELD TO THE SAME STANDARD AS THE FIRST.
     assets/js/flows-drawers.js is fetched on demand and therefore appears in
     no route's total — which is precisely why it has to state its own weight
     where a reader will meet it, and why that sentence is read back here. A
     deferral nobody can audit is a way of moving bytes out of a measurement
     rather than off a reader's CPU, and this file's tickerPage comment says so
     in terms. */
  {
    const drawersBytes = sizeOf("/assets/js/flows-drawers.js");
    const drawersKib = Math.round(drawersBytes / 1024);
    const src = readFileSync(new URL("./assets/js/flows-drawers.js", REPO), "utf8");
    const says = /this file is (\d+)k as\s+measured on (\d{4}-\d{2}-\d{2})/.exec(src);
    ok(says !== null,
       `flows-drawers.js states its own size and the date it was measured — it is on no ` +
       `route's total, so this sentence is the only place its cost is written down`);
    if (says) {
      eq(Number(says[1]), drawersKib,
         `flows-drawers.js says it is ${says[1]}k and it measures ${drawersKib}k ` +
         `(${drawersBytes} bytes). A figure left at the size a file used to be is worse ` +
         `than no figure, because a reader takes it for a measurement`);
    }
    /* AND IT IS DEFERRED, NOT LINKED. The moment a page emits a script tag for
       it the whole argument collapses: the bytes would be back on first paint
       AND still absent from the table, which is the one outcome worse than
       never having split the file. */
    for (const route of measured) {
      ok(!route.parts.some((part) => /^flows-drawers\.js/.test(part)),
         `no route links flows-drawers.js — it is fetched by FlowsPanels.need() when a ` +
         `station that needs it is drawn, and a page that linked it would pay the bytes ` +
         `on arrival while this table went on not counting them (${route.name})`);
    }
  }

  const askBytes = sizeOf("/assets/js/flows-ask.js");
  const askKib = Math.round(askBytes / 1024);
  const dockSrc = readFileSync(new URL("./assets/js/flows-dock.js", REPO), "utf8");
  const hereSrc = readFileSync(new URL("./tests/flows-weight.mjs", REPO), "utf8");

  const dockSays = /assets\/js\/flows-ask\.js is\s+(\d+)k as measured on (\d{4}-\d{2}-\d{2})/
    .exec(dockSrc);
  ok(dockSays !== null,
     `flows-dock.js states the size of the renderer it defers, and the date it was ` +
     `measured — the whole argument for that file is that the renderer is too big to ship ` +
     `on arrival, and an argument from a number nobody wrote down is not one`);
  const hereSays = /flows-ask\.js\s+is (\d+)k as measured (\d{4}-\d{2}-\d{2})/.exec(hereSrc);
  ok(hereSays !== null, "and this file's sidePage note states the same measurement");
  if (dockSays && hereSays) {
    eq(Number(dockSays[1]), askKib,
       `flows-dock.js says flows-ask.js is ${dockSays[1]}k and it measures ${askKib}k ` +
       `(${askBytes} bytes). Update the sentence in that header — a figure left at the size ` +
       `a file used to be is worse than no figure, because a reader takes it for a ` +
       `measurement`);
    eq(Number(hereSays[1]), askKib,
       `and this file says ${hereSays[1]}k for the same file, which measures ${askKib}k — ` +
       `one population, one number, in every place the page states it`);
    eq(hereSays[2], dockSays[2],
       `and both name the same measurement date, because two dates on one number is two ` +
       `measurements and only one of them can be this one`);
  }

  /* THE CONSEQUENCE, COUNTED FROM THE TABLE ABOVE RATHER THAN BY HAND. */
  const dockRoutes = measured.filter((m) => m.parts.some((p) => /^flows-dock\.js/.test(p)));
  const spare = (m) => (CEILING_KIB[m.name] - m.kib) * 1024;
  const wouldFit = dockRoutes.filter((m) => spare(m) >= askBytes);
  const roomiest = dockRoutes.slice().sort((a, b) => spare(b) - spare(a))[0];

  const claim = /On all (\w+) dock routes it would\s+break every ceiling; the widest headroom of\s+the (\w+) is (\w+)'s\s+(\d+)k/
    .exec(dockSrc);
  ok(claim !== null,
     `flows-dock.js states which routes the renderer would break and by how much it misses ` +
     `— that sentence IS the argument for the file, and this is the table it argues about`);
  const WORDS = { twelve: 12, thirteen: 13 };
  if (claim) {
    eq(WORDS[claim[1]], dockRoutes.length,
       `flows-dock.js says "all ${claim[1]} dock routes" and the dock is emitted on ` +
       `${dockRoutes.length}, counted from the HTML each page function actually writes`);
    eq(WORDS[claim[2]], dockRoutes.length,
       `and names that same count the second time the sentence refers to them, rather than ` +
       `two counts of one population in one sentence`);
    eq(claim[3], roomiest.name.replace(/Page$/, ""),
       `and names the route with the most room, which is ` +
       `${roomiest.name.replace(/Page$/, "")}`);
    eq(Number(claim[4]), Math.round(spare(roomiest) / 1024),
       `with that room stated as ${Math.round(spare(roomiest) / 1024)}k. It is the number ` +
       `that makes "it would break every one of them" true, so it is the one a reader ` +
       `checking the claim would reach for`);
  }
  eq(wouldFit.length, 0,
     `and flows-ask.js (${askKib}k) fits inside the headroom of NONE of the ` +
     `${dockRoutes.length} routes the dock ships on, which is what the header claims. That ` +
     `claim read "six" for as long as the renderer was 55k, and it stayed "six" through two ` +
     `re-measurements of the one number that decides it`);
}

console.log(`✓ flows-weight: ${checks} assertions — every route's JavaScript weighed from the ` +
  `HTML it actually emits rather than from a list that could go stale, every emitted script ` +
  `proven to exist so a deferred 404 cannot leave a route a silent shell, a stated ceiling ` +
  `per route and no ceiling without a route, the table printed on every run so the number ` +
  `lives in the log of a build that passed, and every measurement the dock's own header ` +
  `quotes about the renderer it defers — its size, its date, the routes it would break ` +
  `and the widest headroom it misses — checked against this table rather than left to ` +
  `go stale in prose`);
