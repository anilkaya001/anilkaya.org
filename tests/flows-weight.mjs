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
     resolves --font-figure to Inter, which is proportional. (This line read
     "Latin Modern" until the section was re-set; the argument below is
     unchanged by the swap, because it turns on PROPORTIONAL vs fixed and both
     faces are proportional — but the name had to be corrected, and AXIS_CH
     is owed a re-measurement against Inter that this note does not pretend to
     have done.) Two
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

  /* 405 -> 406, 2026-09-12, AND THE ROUTE CAME HERE AND ARGUED, which is what
     the paragraph above asked for. Byte-exact, `git cat-file -s origin/main:`
     against `stat`:

       flows-dock.js   6,007    nav.js           2,560
       flows-panels.js 56,840   flows-ticker.js 349,833  (+1,255)
       total          415,240 B = 405.51 KiB — 520 B over

     WHAT THE 1,255 BOUGHT, and it is two things with different standing.

     Roughly 540 B is comment over a net DELETION: the 23 panel questions and
     5 station blurbs stopped being drawn, a navigation clause went, and the
     status sentence went. That part earns no raise, and it did not get one —
     it was twice shortened instead, once when this ceiling first failed and
     again ten minutes later.

     The rest is a ResizeObserver on the sticky bar, and that is the gain the
     route needed. CI failed at flows-ticker-contract:3735 with a deep-linked
     panel landing 17px UNDER the bar (201 against 218): every panel's
     scroll-margin-top is built from --ft-bar-h, seven hand-driven calls wrote
     it, and clipping the blurb out of flow changed the bar in a way none of
     the seven caught. THIS SANDBOX CANNOT REPRODUCE IT — barH and --ft-bar-h
     agree at 148 locally with or without the webfont served — so a better
     guess at the missing call site would be a guess. Observing the bar is the
     same argument syncBarHeight's own comment already makes for measuring
     rather than assuming a constant, and it is the fix that holds without
     knowing which reflow did it.

     406 LEAVES 344 B, tighter than the 739 above, deliberately: the observer
     closes the defect but the route is still owed the comment strip, and the
     next change to it should have to come here too. */
  /* AND IT CAME, BECAUSE THE OBSERVER ALONE DID NOT CLOSE IT. 408 now:

       flows-dock.js      6,007      nav.js             2,560
       flows-panels.js   56,840      flows-ticker.js  351,521
       total            416,928 B = 407.16 KiB, 165 B over 406

     WHAT THE 1,193 B BOUGHT, and the measurement that says the previous fix
     was incomplete rather than wrong. CI failed again at the same assertion
     with the panel at 172 and the bar ending at 218 — and 172 is
     4.4rem + 5.5rem + 0.6rem to the pixel, which is the STYLESHEET's
     placeholder --ft-bar-h, not any height the bar ever had after paint. So
     the jump happened while the tab row was one unwrapped line in the
     fallback face, the webfont then swapped, the row wrapped, the bar grew
     92 -> 148, and --ft-bar-h was dutifully updated by the observer for a
     `scroll-margin-top` the browser had already read and would never read
     again. Setting the variable was never going to move the page: only a
     second scrollIntoView can, and only for a reader still sitting where the
     first one left them, which is what `jumped` records and checks.

     408 LEAVES 1,024 B. Wider than the 344 above on purpose: that margin was
     set on the belief the defect was closed, and it was not, so the next
     attempt should not also have to spend its first hour here. The route is
     still owed the comment strip. */
  /* 412, AND WHAT IT BOUGHT IS A DRAWING THAT DELETED THREE PATCHES:

       flows-dock.js      6,007      nav.js             2,560
       flows-panels.js   59,479      flows-ticker.js  352,124
       total            420,170 B = 410.32 KiB, 2,378 B over 408

     The score over price panel drew the score as a second LINE, and three
     defects in the file were each patched around that choice: a gap had to be
     PROGRAMMED to break the path (a bridged hole is a score nobody computed,
     and a zero would be worse — zero is NEUTRAL and this system means it); a
     lone scored session between two holes drew a zero-length subpath, which
     renders as nothing, so a real measurement needed a hand-placed dot; and
     two strokes on one date axis look comparable, so the units note had to
     end by saying the two crossing means nothing at all.

     Drawn as BARS all three go away, and the code for two of them with it. A
     session with no score has no rect — the refusal is structural, and there
     is no stroke that could bridge anything. A lone bar is a bar. And a set
     of filled rects beside a dashed line is visibly not two comparable
     series, so shared/flows-overlay.js gave that clause back.

     THE BYTES ARE THE ARGUMENT, NOT THE DRAWING. The bar loop is shorter than
     the path loop plus the dot loop it replaced; what grew is the reasoning
     above each — including the one recording that the FIRST render of this
     came out unreadable, bars four pixels tall on a ±100 domain for a name
     scoring +16, which is why the domain is now the name's own extent with a
     floor and why that floor is PRINTED in the panel's own stat list.

     412 LEAVES 1,718 B. The route is still owed the comment strip. */
  /* 415, AND THE PATTERN IS NOW THE POINT. Measured:

       flows-dock.js      6,007      nav.js             2,560
       flows-panels.js   62,280      flows-ticker.js  352,124
       total            422,971 B = 413.06 KiB, 1,086 B over 412

     WHAT IT BOUGHT. The overlay's closing note was ONE paragraph of three
     unrelated sentences and the largest block of text on the ticker page.
     This file's own rule at NOTE_WALL_CHARS says which may fold, and the
     panel had never applied it: the population and what it left out stay
     OPEN (qualifier), the units stay OPEN (they change what the drawing
     means), and the join — how the two series were matched — FOLDS into the
     disclosure appendMethod already builds. Nothing is deleted; the node is
     moved, so the sentence is still in textContent for a find-in-page, which
     the ticker suite asserts. The card measured ~1000px and now measures
     ~490px, which is the whole reason for the change.

     appendMethod gained an `always` flag: the 420-character wall is the right
     question for a caller that hands over everything and lets length decide,
     and the wrong one for a caller that has already sorted method from
     qualifier itself.

     AND THE PATTERN: this is the third raise on this route in one session,
     each of a kilobyte or two, each of it reasoning rather than behaviour —
     my own comments were trimmed twice before this number was touched and
     still cost more than the code. The route's real fix is the comment strip:
     built, merged, measured at ~253 KB of comment on this route, and waiting
     on one Workers Builds field that is not mine to set. Until it is set,
     this ceiling will keep climbing a kilobyte at a time and every raise will
     be honest and pointless in the same breath.

     415 LEAVES 1,973 B. */
  /* 417, for the change that made the page a card wall:

       flows-dock.js      6,007      nav.js             2,560
       flows-panels.js   64,465      flows-ticker.js  352,124
       total            425,156 B = 415.19 KiB, 194 B over 415

     The default view is now all 23 panels rather than the first station's
     three, the station grid is three columns at 76rem and four at 110 with no
     panel spanning a full row, nothing is stretched to a row it does not
     fill, and the conviction arithmetic folds. The 194 B is the reasoning for
     the default — the measurement that justified opening on one station, and
     why a change in COLUMN COUNT is what retired it.

     417 LEAVES 1,852 B. */
  /* 439, FOR THE HEADER A READER LANDS ON AND THE LEDGER UNDER THE CHARTS:

       flows-dock.js      6,007      nav.js             2,560
       flows-panels.js   61,048      flows-ticker.js  378,964
       total            448,579 B = 438.07 KiB, 21,459 B over 417

     WHAT IT BOUGHT, AND THIS ROUTE OWES AN ACCOUNT OF EVERY KILOBYTE:

       - THE ARRIVAL HEADER. The page's answer to "what is this name" was one
         run-on line — "SYN002 +16 $34.87 −1.7% bullish +1 score point over 1
         session — 81 conviction short Γ session 2026-08-24 · built
         2026-09-12" — seven readings a reader parses apart before using one.
         It is five labelled blocks now, above the sticky bar rather than in
         it, because a block that has to survive the whole scroll must stay
         one line and a block a reader lands on has height for free.
       - THE FLAGS ROW. Five marks, each a restatement of a panel's own
         reading past a threshold its title names. No new opinion; a scan
         layer over four stations' worth of findings.
       - THE SESSION LEDGER. One row a session — close, score, the move and
         net premium — joined ON THE DATE from two panels already on the card.
         A sentinel like __stats, so the payload does not grow: the charts
         above show the shape and this answers "what happened on the 14th",
         which is a lookup and wants rows.

     AND ONE THING IT DID NOT BUY: `sideOf`, which is a REMOVAL. The
     side-against-the-dead-band decision now exists once for the three
     surfaces that state it, where a second copy is how a header comes to call
     a name bullish while a pill four lines up calls it unranked.

     THE PATTERN THE PARAGRAPH ABOVE NAMES IS NOW A LEDGER OF ITS OWN: this is
     the fourth raise on this route, and unlike the three before it this one
     is BEHAVIOUR rather than reasoning — three surfaces that did not exist.
     That does not retire the argument, it sharpens it. The route's real fix
     is still the comment strip: built, merged, measured at ~253 KB of comment
     on this route, and waiting on one Workers Builds field that is not mine
     to set. This route is 438 KiB of source and roughly 185 KiB of it is
     what a browser would actually parse with that field set.

     439 LEAVES 917 B, which is deliberately not room for anything: the next
     change to this route should have to come here and argue in the open. */
  /* 441, AND THE 917 B ABOVE IS WHY THIS PARAGRAPH EXISTS AT ALL.

       flows-dock.js      6,007   nav.js             2,560
       flows-panels.js   62,318   flows-ticker.js  379,949
       total            450,834 B = 440.27 KiB, 1,298 B over 439

     The change block leads on a two-word verdict now — "Bullish drift",
     "Cleared the band" — with a glyph that says the direction without the
     hue. The block answers "did anything happen" and a reader had to read a
     sentence to find out; every other panel on this page has a headline and
     the one a reader lands on did not.

     IT ADDS NO OPINION, which is what made it cheap: the word is derived from
     the crossing the change layer already published, and drift is named by
     its own sign. A move of exactly zero gets its own word rather than being
     rounded into a direction, and a window with no earlier score gets no
     verdict at all — there is nothing for one to be about.

     441 LEAVES 750 B. The reserve is smaller than the last raise left, on
     purpose: this route is 440 KiB of source and roughly 187 KiB of it is
     what a browser would parse with the comment strip's one Workers Builds
     field set. Every kilobyte argued here is a kilobyte that field would
     return. */
  /* 441 -> 449, THE FIFTH RAISE, and the first that buys a DRAWING.

       flows-dock.js      6,007   nav.js             2,560
       flows-panels.js   69,370   flows-ticker.js  380,664
       total            458,601 B = 447.85 KiB, 6,857 B over 441

     +7,052 B, all of it in flows-panels.js: the score gauge at the head of
     the score-derivation panel.

     WHAT IT BOUGHT IS A SCALE, NOT A NUMBER. The score is on this page twice
     already — the hero states it, this panel's stat list repeats it — and a
     third printing would have been worth nothing. What no surface stated was
     the RANGE: the score is bounded to +/-100, and that bound appeared in
     exactly one place on the whole route, a closing sentence inside the
     score-over-price note. So "+16" arrived with no way to tell whether it
     was most of the scale or a rounding error in it. The arc answers that by
     construction, which is the only reason it earns bytes on this route.

     AND IT ADDS NO VERDICT. "Bearish" and "Bullish" sit at the ends as axis
     labels, naming what the ends of the scale mean; the word for THIS name
     stays in the hero, which owns it. No dead band is drawn, because the card
     does not publish one at this level and a guessed band is a free parameter
     wearing a measurement's clothes. An absent score withholds the marker
     rather than pointing it at zero.

     1,924 OF THOSE BYTES ARE A DEFECT THE TICKER SUITE FOUND, and they are
     the most useful ones in the raise. The first draft drew a fixed 128x78
     box; flows-ticker-contract refused it in one line — "a span-1 panel at
     least doubles when enlarged (128 to 128)" — because a fixed viewBox makes
     the enlarge button a no-op on the panel it was pressed for. The shipped
     version sizes through panelWidth() like every other drawing here, and
     radius, stroke, marker inset, the number's lift and the end labels' width
     are all derived from that one measurement rather than from constants that
     would only be right at one host width. The suite counts 28 more
     assertions than before this raise: the gauge is now a chart it checks.

     449 LEAVES 1,175 B, AND 448 WAS REJECTED FOR LEAVING 151. A reserve below
     the cost of one edited sentence is not a reserve — it is a promise that
     the next typo fix on this route fails CI and gets "fixed" by deleting a
     comment, which is the bookkeeping the unusualPage paragraph below refuses
     by name. 1,175 B is the same order as the 917 and 750 the last two raises
     left: room for a fix, not for a feature.

     AND THE RESERVE WAS SPENT ON A FIX, WHICH IS WHAT IT WAS FOR — 449 -> 450
     in the same session. flows-sign found two places in flows-ticker.js where
     this branch decided a sign in two arms: the flags row calling a move of
     exactly zero "Score down", and the change verdict calling a zero-move
     flip "Flipped bearish". Both now carry a third arm, at 960 B of reasoning.

       flows-dock.js      6,007   nav.js             2,560
       flows-panels.js   69,370   flows-ticker.js  381,624
       total            459,561 B = 448.79 KiB, 215 B under 449

     215 B is by the argument above not a reserve, so the ceiling follows the
     fix rather than leaving the next one nothing: 450 leaves 1,239 B, the
     same order as before. A reserve that is never allowed to be spent is just
     a smaller ceiling with extra steps; one that is spent and not restored is
     a trap for whoever edits next.

     THE STANDING ACCOUNT IS UNCHANGED AND IT IS STILL THE REAL ANSWER: this
     route is 448 KiB of source and roughly 191 KiB of it is what a browser
     would parse with the comment strip's one Workers Builds field set. Every
     kilobyte argued here is a kilobyte that field would return. */
  /* 450 -> 454 FOR THE TWO VOLATILITY COLUMNS. Re-derived on disk against
     `git show HEAD:` rather than read off the paragraph above:

       file                  before      after
       flows-ticker.js     381,624    385,079
       flows-panels.js      69,370     69,370
       nav.js                2,560      2,560
       flows-dock.js         6,007      6,007
       total               459,561    463,016 B = 452.16 KiB

     The room under 450 was 1,239 B and this needs 3,455.

     WHAT IT BOUGHT: the header the owner's design specifies carries four
     figures beside the price — IV, IV rank, volume and market cap — and this
     card publishes two of them on every name and neither of the other two on
     any name. So the strip grew the two that are real, each reading its own
     published field and quoting the panel's own horizon rule rather than
     describing it, and the two that are not published were left out rather
     than filled with something adjacent. The sector and the session moved
     under the symbol in the same pass, which is where the design puts a
     name's identity and which is what keeps the strip on one row.

     454 LEAVES 1,880 B, AND THE REST OF THIS WAVE WILL NOT FIT IN IT. The
     stat cards and the chart interactivity the same design calls for are
     several kilobytes each, and each will have to argue its own raise here.
     That is the honest cost of this route carrying ~253 KB of comment that
     the comment-stripping build already knows how to remove: it is built and
     merged and waits on one dashboard field, and until that lands every
     feature on this route is paying for prose the browser parses and no
     reader reads. */
  /* 454 -> 464 FOR THE CURSOR EVERY CHART SHARES. Derived on disk:

       file                  before      after
       flows-cursor.js            0     10,016   (new)
       flows-panels.js       69,370     70,841
       flows-ticker.js      385,079    385,079
       nav.js                 2,560      2,560
       flows-dock.js          6,007      6,007
       total                463,016    474,503 B = 463.38 KiB

     WHAT IT BOUGHT, AND WHY IT IS A FILE RATHER THAN A FUNCTION. Every chart
     in this section draws a series and labels a handful of ticks, which
     answers "what is the shape" and refuses "what was it on the 14th" — the
     values were all in hand when the marks were placed. Some charts carried a
     native title per mark: a tooltip a mouse can find, after a delay, one
     mark at a time, and one a keyboard cannot reach at all.

     flows-cursor.js is that reading, once: a renderer hands over the points
     it already computed and gets a rule, a readout, arrow-key navigation and
     a live region. It is a separate file because the same cursor belongs on
     the overview and the market charts next, and a copy per bundle is how two
     charts end up disagreeing about what a hover means.

     VERIFIED BY DRIVING IT, not by reading it: on the rendered ticker page a
     pointer at 35% of the score chart reports 2026-08-04, close 34.47, score
     +13, and the rule lands at x=265.8; moving to 75% reports 2026-08-17 and
     the rule moves to x=560.4. Focus plus Home then ArrowRight reports
     2026-07-24 in both the readout and the live region, and Escape clears
     both. The values come from the same rows array the marks were drawn from,
     so the readout cannot disagree with the drawing.

     464 LEAVES 897 B, which is not room for the next thing and is not meant
     to be. This route is 463 KiB of JavaScript of which roughly 253 KiB is
     comment that the merged comment-stripping build already knows how to
     remove; until that is switched on, every feature here is paying to ship
     prose the browser parses and no reader reads. The next raise on this
     route should be that switch, not another ten kilobytes. */
  /* 464 -> 473 FOR THE SIX CARDS AND THE CURSOR'S SECOND AXIS. On disk:

       file                  before      after
       flows-cursor.js       10,016     12,009
       flows-ticker.js      385,079    392,544
       flows-panels.js       70,841     70,841
       nav.js                 2,560      2,560
       flows-dock.js          6,007      6,007
       total                474,503    483,961 B = 472.62 KiB

     THE CARDS ARE THE DESIGN'S SIX AND NOT THE HEADER'S FIVE AGAIN. The strip
     above them carries price, score, conviction and the two volatility
     figures; these six say what the FLOW did — the premium run and its gaps,
     the session's own premium, the net delta the tape ended holding, the
     aggressor ladder, where open interest moved, and what printed
     off-exchange. Each is one panel's published figure with that panel's own
     unit and coverage caveat, lifted to the top of the page; a panel that did
     not read gets no card, because six greyed boxes would turn six silences
     into six claims that the session was quiet.

     THE CURSOR GREW A SECOND AXIS in the same pass. A reading agent sent to
     spec the gamma profile's cursor came back with "not drawable": that chart
     is transposed — its shared index is the STRIKE, down the y axis — so an
     x-only cursor either had nothing to say there or would have been forced
     onto the wrong axis to look like it worked. `axis: "y"` searches the
     other coordinate and draws a horizontal rule; the readout is unchanged.

     473 LEAVES 1,110 B. Third raise on this route in one wave, each measured,
     and the reason is the same each time: 253 KiB of this route is comment
     that the merged stripping build removes and that is waiting on one
     dashboard field. */
  /* 473 -> 477 FOR THE FINDINGS INDEX. On disk: flows-ticker.js 384,452 ->
     386,860 and flows-drawers.js is not on this route, so the route moves
     484,268 -> 486,832 B = 475.42 KiB.

     WHAT IT BOUGHT: the design's top-right panel, which it calls an AI
     summary. This product's AI summary is Neuron and it is generated per
     SESSION, not per name, so calling this that would be a claim about how it
     was made. What it is instead is the panels' OWN published leads, gathered
     above the fold with a link into each — one source rendered twice, not two
     spellings of one reading, so the index and the panel cannot disagree
     about a figure. It states its own denominator ("the first 5 of 18"),
     because a list of five under a card with eighteen readings is a selection
     and a selection that hides its denominator reads as a census.

     477 LEAVES 1,616 B. Fourth raise on this route in one wave. Every one is
     measured and argued, and every one is also evidence for the same point:
     253 KiB of what this route ships is comment that the merged stripping
     build removes, and it is waiting on one dashboard field. */
  /* 477 -> 482 FOR THE SECTOR PEERS. flows-ticker.js 386,860 -> 392,336, so
     the route moves 486,832 -> 492,308 B = 480.77 KiB.

     WHAT IT BOUGHT, AND IT IS THE ONE THING ON THIS PAGE THAT IS NOT ABOUT
     THIS NAME. Every other reading here was measured on this ticker; the peer
     strip says which OTHER names the same session's boards ranked in the same
     sector, so a reader who has just formed a view can see whether it is one
     name or a group. It is today's boards and not a correlation, and the
     subtitle says that in those words.

     AND IT CHANGED WHEN THE BOARDS ARE FETCHED, which is the part to weigh.
     They were fetched only when someone opened the name switcher, so the rank
     chip ("3 of 40", a board field the card has no copy of) and the peer set
     were blank on every visit where nobody clicked. They are now fetched once
     on idle, after first paint: two cached GETs per visit that this page did
     not previously make, for two readings that could not otherwise exist. The
     alternative was a peer strip announcing an empty sector on a page that
     had simply never looked — which it did, in the first render, until the
     pending silence was given its own sentence.

     482 -> 483 IN THE SAME WAVE, FOR A SILENCE ONE LEVEL DOWN. The peer
     strip's pending sentence fixed the case where the boards had not been
     FETCHED; the preview harness then showed the case underneath it, because
     it stubs those fetches with a payload that carries no rows: boardRows
     maps `payload.rows || []`, so a board that has not published, one that
     failed to read, and one that genuinely ranked nobody all arrive as the
     same empty array — and the strip announced an empty sector for all three.
     The envelopes are read once now and the three get three sentences.
     493,943 B = 482.37 KiB.

     483 LEAVES 649 B. */

  /* 483 -> 494, AND THE ROUTE CAME HERE AND ARGUED, which is what every
     paragraph above asks of it. Byte-exact, `git cat-file -s HEAD:` against
     `stat` on disk:

       flows-dock.js       6,007      nav.js             2,560
       flows-cursor.js    12,009 ->  13,123  (+1,114)
       flows-panels.js    70,841 ->  71,727  (+  886)
       flows-ticker.js   402,526 -> 411,696  (+9,170)
       total             493,943 -> 505,113 B = 493.27 KiB — 10,521 B over

     AND THIS PARAGRAPH SAID 493 UNTIL TEN MINUTES AGO, which belongs in the
     file whose subject is figures going stale — this time caught inside a
     single change rather than a PR later. It was derived against a 503,715 B
     route and read "493 leaves 1,117 B". Then CI failed a second assertion,
     flows-ticker-contract's phone-width hit test, the fix for it added 1,398
     B of reasoning to flows-ticker.js, and the ceiling I had just argued for
     was 281 B short. Re-derived rather than re-quoted, and the trigger is the
     same one every paragraph above records: editing this comment does not
     change the file it describes.

     WHAT THE 9,772 B BOUGHT: every drawing on this route now reads out. The
     count is not a vibe — the preview harness censuses it, and before this
     change it stood at 7 drawings of 21 with a cursor. It is 16 of 18 now,
     and the other two are accounted for rather than outstanding: the score
     dial and the priced-move band each hold ONE observation and print every
     number they encode on their own face, which they now say in the markup
     with data-fx-read="face" so the census can prove the claim instead of
     carrying two remembered exceptions. Nothing is left in `bare`.

     (21 became 18 because the first census counted three legend swatches as
     charts. A swatch is an <svg> holding a drawn line; the discriminator is
     aria-hidden, which is the renderer saying there is nothing here to read.)

     THE FIVE NEW REGISTRATIONS ARE NOT FIVE COPIES OF ONE. Two are transposed
     — gamma and aggressor share a strike ladder that runs DOWN the panel, and
     they are the reason `axis: "y"` exists in flows-cursor.js at all. One
     covers three panels at once, because vanna, charm and delta exposure
     already share a drawer. One reads a heatmap's COLUMN headers rather than
     its cells, because the cells print their own numbers and the columns
     never printed theirs. Each of those is a decision that had to be argued
     where the code is.

     6,915 B OF THE 9,772 IS COMMENT, and 1,114 of the rest is the de-
     duplication that made this raise smaller than it started. The first draft
     restated the same three contract rules at each of five sites; they are
     properties of the API, so they moved into flows-cursor.js's header once —
     the trade greekTermPanel's own comment records making for its repeated
     paragraph, measured there at 1,350 bytes. It cost this route 1,114 B in
     flows-cursor.js and saved 2,600 in the two renderers, and it also costs
     overviewPage 1,114 B, which is why that ceiling moves below.

     THE EXECUTABLE COST IS 3,764 B, not 9,772: stripComments over the route's
     five scripts gives 227,657 -> 231,421. That is context and not an excuse.
     This table measures the REPOSITORY, deliberately — the paragraph on the
     404 reduction says why, and the strip still waits on the dashboard field
     — so 9,772 is the number that moves this ceiling.

     THE SECOND FIX IS WHY THE CARDS AND THE BAR CHANGED PLACES. The six
     cards, the findings index, the flag row and the sector strip all landed
     above #ftBar in this wave, and at 320px they stack: measured on a fresh
     load, the station tabs sat 1,941px down a 900px viewport, so the page's
     whole navigation was two screens below the fold and the contract's
     elementFromPoint walk reached it on zero rows of pixels. The bar moved
     above the cards, the cards went two-up at phone width, and the "what
     changed" region's insertion re-anchored from the bar to the cards so it
     could not land between the identity and the figures. 639px now.

     494 LEAVES 743 B, which is room for a fix and not for a feature, the
     standard every raise above claimed and the 496 paragraph made real. */
  tickerPage: 494,
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
     asked for and no more.

     160 -> 161, 2026-09-12, AND THE 13.8k IS GONE — spent, not overrun in one
     step. Measured at this branch's base (f22060f), byte-exact with
     `git cat-file -s` against `stat`:

       flows-dock.js      6,007      nav.js           2,560
       flows-ui.js       25,136      flows-overview.js  129,437
       total            163,140 B = 159.32 KiB, 700 B of hand

     So the route arrived here with 700 bytes, not 13.8k: the Neuron dock and
     the candidate-B rollout had already taken the rest, each inside the
     ceiling and none of them re-deriving what was left. This branch adds
     1,223 B to flows-overview.js — 164,363 B = 160.51 KiB, 523 B over.

     WHAT THE 1,223 BOUGHT, since that is the question this assertion asks.
     Net of 86 insertions against 60 deletions, and the deletions are real:
     the verdict strip's tile definitions, its duplicated disagreement note
     and two dead helpers all went. The additions are the alerts subtitle's
     cadence clause — a published caveat that was, for one commit, printed
     NOWHERE, because it was removed from a tile on the false belief that
     this subtitle carried it — and the comments explaining both.

     NOT BOUGHT BACK BY SHORTENING COMMENTS. The tickerPage entry above
     records what that costs: "bookkeeping rather than engineering: it
     degrades the one thing this codebase is strictest about to satisfy a
     number." The comment that would go first here is the one recording how a
     caveat came to be deleted, which is exactly the comment worth keeping.

     161 LEAVES 501 B, deliberately. The structural fix this route is still
     owed is the one the paragraph above named and got done once already, and
     the next one is the comment strip: measured, merged, and waiting on a
     single Workers Builds field. Until that lands, this route should have to
     come here and argue rather than find room waiting. */
  /* AND IT CAME BACK, ONE BRANCH LATER, TO ARGUE. 163 now. Measured the same
     way, `git cat-file -s HEAD:` against `stat`:

       flows-dock.js      6,007      nav.js             2,560
       flows-ui.js       25,136      flows-overview.js 132,152
       total            165,855 B = 161.97 KiB, 991 B over 161

     WHAT THE 2,715 B BOUGHT. Three changes, and two of them DELETE what a
     reader sees: the verdict strip's two tilt tiles are now "Lean · names"
     and "Lean · dollars" (the word "tilt" is jargon this page never defined
     and the value is already a signed per cent), and the status line above
     the strip stopped reprinting the session date and both board counts,
     which the Session and Cleared tiles carry twelve pixels below it. That
     line now prints only what the strip cannot: the rows-against-pool
     TRUNCATION when the two part company, the band count, and the
     unread-board refusal. The third change ADDS: the company name under the
     symbol on every ranked row, drawn only where the vendor sent one.

     NOT BOUGHT BACK BY SHORTENING COMMENTS — except my own, twice, which is
     a different act: both blocks written on this branch were over-written on
     their first draft and were cut to what they had to say (−316 B) before
     this number was touched. Nothing that predates this branch was trimmed.

     163 LEAVES 1,057 B, which is room for a fix and not for a feature. The
     paragraph above still stands: the structural fix owed here is the
     comment strip, measured and merged and waiting on one Workers Builds
     field, and until it lands this route argues for every raise. */
  /* 166, FOR FOUR DIAGRAMS AND WHAT THEY REPLACE A READER DOING:

       flows-dock.js   6,007   nav.js            2,560
       flows-ui.js    25,136   flows-overview.js 135,724
       total         169,427 B = 165.46 KiB, 2,517 B over 163

     Four of the seven verdict tiles now carry the shape of their own number:
     a bar off a centre line for each lean, a proportional split for breadth
     and for cleared. "−7.9%" and "41 bull / 48 bear" are the same two facts —
     which side, and by how much — and a reader had to decode both from digits
     every time. The bar answers the first before the number is read at all.

     BUILT FROM THE VALUE THE TILE PRINTS, never a second read of the payload,
     because a diagram that can disagree with the number beside it is worse
     than no diagram; and a SILENT tile gets no bar, because a zero-width one
     would read as a measured zero.

     Two rects and a rule each, no library. The bytes are the viz() closure
     and the reasoning above it.

     166 LEAVES 586 B, which is tight on purpose: this route is still owed the
     comment strip, and the next change should have to come here too. */
  /* 185, FOR THE THREE THINGS THIS PAGE PUBLISHED, SERVED AND NEVER DREW:

       flows-dock.js   6,007   nav.js            2,560
       flows-ui.js    25,136   flows-overview.js 154,731
       total         188,434 B = 184.02 KiB, 18,450 B over 166

     The raise is one number and it buys three regions, so it is worth saying
     what each cost and what each is:

       - INTRADAY FLOW. The `pulse` key has carried a timestamped net-premium
         series — 78 intraday intervals plus twenty sessions of daily totals —
         since the intraday wave, worker.js has answered /api/flows/pulse
         since then, and the landing page's fetch list never asked for it. The
         one series in this product with TIME on an axis reached no reader at
         all. Two signed bars a slot against a marked zero, plus a period
         control that switches SOURCE and says which source is drawn.
       - FLOW DISTRIBUTION. `market.premium` publishes the two premium pools
         and the page's only reading of them was a signed tilt ratio in a
         tile — a reader who wanted "how much of this session was calls" had
         to invert a percentage. A ring, with the total in its hole and both
         dollar pools beside it.
       - THE SESSION'S CAPTION. Two tiles that were never measurements — a
         date and a population — moved out of the verdict strip into the
         line above it, and took the newest read stamp across the payloads
         with them.

     THE ROUTE PARSES MORE AND THE READER GETS THREE SURFACES THAT DID NOT
     EXIST, out of keys already fetched or one fetch added. That is the trade
     and it is a good one; what makes it a decision rather than a drift is
     that it is written here.

     185 LEAVES 1,006 B. The paragraph above still stands and is now overdue:
     the structural fix this route is owed is the comment strip — measured,
     merged, and waiting on one Workers Builds field — and until it lands
     every raise here is paid for in a reader's parse time. */
  /* 196, FOR THE SECTOR STRIP AND THE TILE THAT CARRIES ITS OWN HISTORY:

       flows-dock.js   6,007   nav.js            2,560
       flows-ui.js    25,136   flows-overview.js 166,062
       total         199,765 B = 195.08 KiB, 10,325 B over 185

     Two additions and one re-setting:

       - THE SECTOR STRIP. Eleven baskets as eleven chips in the publisher's
         own order, each with its signed lean and a bar on one shared ±1
         scale. The region answered "what exactly did Energy clear" with an
         eleven-row table and had no answer at all to "where did the money go
         this session", which is what a reader opens it for — that question
         was being answered by reading eleven names, finding the numeric
         column and ranking eleven figures by eye. The table is the record and
         folds behind a summary; every figure in it is also in the strip.
       - THE DOLLAR LEAN'S RECENT HISTORY. A 21-session sparkline under the
         tile's figure, derived from the same daily totals the flow chart
         draws — so the line on the tile and the bars in the region below are
         the same numbers. "−4.1%" is today; whether today is the third
         session leaning that way or a reversal of a fortnight is a different
         fact the tile could not state in words.
       - THE QUALIFIERS ARE A LIST, NOT A PARAGRAPH. Seven claims joined with
         spaces rendered as an eleven-line block under a chart, which is the
         shape a reader skips — and a qualifier that is skipped does not
         qualify. Same words, same count, none folded, one to a line.

     196 LEAVES 916 B, which is again deliberately not room for anything. This
     route and the ticker are now both within a kilobyte of their ceilings and
     both are owed the same structural fix. */
  /* 198, FOR A COLLAPSE THIS CHANGE INTRODUCED AND THEN HAD TO UNDO:

       flows-dock.js   6,007   nav.js            2,560
       flows-ui.js    25,136   flows-overview.js 167,664
       total         201,367 B = 196.65 KiB, 663 B over 196

     The session moved out of the verdict strip and into the caption above it,
     and the first draft of that caption printed ONE sentence for what the
     tile had said four ways — "could not be read", "not published yet", "not
     on this payload" are three different facts about the pipeline and only
     one of them is about the market. That is the collapse this whole page is
     built to refuse, reintroduced by a layout change, and it would have
     shipped: the page renders, the line reads plausibly, and nothing about it
     looks wrong.

     The 663 B is `boardsRead`, lifted out of paintVerdict so the caption and
     the Cleared tile decide it once. Two callers, one decision — which is
     also why a second copy was never the cheaper option: it is how the
     caption comes to say "not published yet" over a strip saying "could not
     be read", about the same two payloads, four lines apart.

     198 LEAVES 1,385 B. */
  /* 200, FOR THE SECOND HALF OF THE SAME COLLAPSE:

       flows-dock.js   6,007   nav.js            2,560
       flows-ui.js    25,136   flows-overview.js 169,742
       total         203,445 B = 198.68 KiB, 693 B over 198

     The session kept its four silences when it moved to the caption; the
     SCREENED POPULATION, which moved with it, did not. That slot simply hid
     itself whenever the figure was absent — so a market key that failed to
     read and one nobody has published looked identical, which is the same
     collapse one line over and was caught by the same suite, one phase
     further in.

     `keySilence` is the 693 B: the four-kind decision lifted out of
     paintVerdict so the strip's tiles and the caption's two slots ask it of
     one function. That is now the second helper this change had to lift for
     the same reason — boardsRead was the first — and the pattern is worth
     naming: moving a reading from one element to another moves nothing else
     with it. Every silence, unit and population it carried has to be carried
     across by hand, and the only way to know they were is a test that asks.

     200 LEAVES 1,355 B. */
  /* 200 -> 203, AND THE 1,355 B WENT ON TWO WRONG READINGS.

       flows-dock.js      6,007   nav.js             2,560
       flows-ui.js       25,136   flows-overview.js 173,641
       total            207,344 B = 202.48 KiB, 2,544 B over 200

     +3,899 B in flows-overview.js, and almost all of it is the reasoning for
     two defects this route had SHIPPED. Neither was a layout slip; both were
     the confident reading this section exists to refuse.

     THE DAILY CHART CLAIMED A SIGN IT DOES NOT HAVE. paintTide's own comment
     said "call premium and put premium are NET figures: the vendor publishes
     them signed... and the sign is the reading". True of `pulse.points`,
     which shapeTide builds from net_call_premium/net_put_premium — and this
     chart draws `pulse.totals`, which shapeTotals builds from the GROSS
     call_premium/put_premium columns. The two arrays carry the SAME FIELD
     NAMES for two different quantities (shared/flows-pulse.js:132-133 against
     :154-155), which is exactly how the claim survived being re-pointed at a
     daily source. Calls are drawn upward and puts downward as magnitudes now,
     and the axis marks name the side instead of printing "-$60M" for a total
     that was never negative.

     THE RING CALLED TWO POOLS "CALLS" AND "PUTS". paintSplit read
     market.premium.netPositive/netNegative — the sums of positive and
     negative NET premium — assigned them to variables named `call` and `put`,
     and labelled them so. shared/flows-market.js:147-150 says verbatim that
     these are "not call premium and not put premium, both of which are
     separate screener columns a reader could hold beside these and have no
     way to know are unrelated". The warning predates the ring; the ring did
     it anyway. It reads the pulse totals' own callPrem/putPrem now, which ARE
     those columns, and its sub-line names the session the row is dated to
     rather than assuming it is this page's.

     A third fix rides along at no argument: the chart carried
     preserveAspectRatio="none", the same defect found on the premium-track
     panel this session, which scales bar HEIGHTS by the host ratio.

     203 LEAVES 1,424 B, the same order the last two raises left. The route is
     owed the comment strip like every other one here. */
  /* 203 -> 207, FOR THE STRIP THE TARGET DESIGN ASKS FOR.

     The verdict strip now reads BREADTH / CLEARED / FLOW BIAS / PREMIUM /
     FLAGGED, which is the target's five. Three things bought the bytes:

       - A SIXTH SLOT ON THE TILE TUPLE, so a tile can carry a qualifier when
         it is NOT silent. The silence sentence still wins when there is one:
         a silent tile has no reading for a qualifier to be about.
       - THE TWO LEANS BECAME ONE TILE WITHOUT LOSING ONE. The payload
         publishes a names-weighted and a dollars-weighted tilt on purpose —
         shared/flows-market.js says publishing both is what removes the
         choice — so matching the target by deleting one would have made that
         choice silently. The dollar lean takes the tile, the name lean takes
         its sub-line, and they end up beside each other where they are
         actually comparable.
       - THE PREMIUM TILE, which cost almost nothing to feed: `daily.gross`
         was already built from the same pulse rows the ring and the daily
         chart read, and used for nothing. The tile, the ring and the chart
         now cannot disagree about a session's premium.

     NO DELTA BESIDE THAT FIGURE, though the target prints "+4.1%". Nothing
     publishes a session-over-session premium delta for this population, and
     differencing the two newest rows of a 20-row window at the render is an
     invented reading. The sparkline carries the direction instead.

     207 LEAVES 1,368 B. */
  /* 207 -> 209, AND THE BYTES ARE A SILENCE THAT WAS NEARLY LOST TWICE.

       flows-dock.js      6,007   nav.js             2,560
       flows-ui.js       25,136   flows-overview.js 178,098
       total            211,801 B = 206.84 KiB, 167 B under 207

     The five-tile strip demotes the equal-weight tilt into the dollar tilt's
     tile. Demoting a reading is where silences die, and this one nearly died
     twice in one sitting:

       - FIRST as a bare pct() rendered only when the value was non-null, so
         unreadable / pending / unavailable / empty all became "no sub-line".
         CI caught the missing VALUE. It would not have caught the missing
         silences.
       - THEN as an `else if` against the tile's own silence span, so on a
         market key that failed to read — where BOTH tilts are silent — the
         tile's sentence won and the demoted one was never rendered at all.
         Two facts shown as one, which is the same collapse in a new place.

     What ships is two slots that are not alternatives: `.cc-tile-s` is the
     tile's own silence, `.cc-tile-q` is the demoted reading with its own
     figure, its own sign-tone and its own data-empty. The contract asserts
     the sub's kind and wording on all four phases, not just the tile's,
     because the first draft passed every assertion that only looked at the
     tile.

     209 LEAVES 2,215 B. Deliberately a little wider than this route's last
     two raises: it is now carrying a second reading per tile and the next
     edit here should not have to argue for forty bytes. */
  /* 209 -> 213 FOR THE SECTOR STRIP'S THREE QUANTITIES. Re-derived rather
     than reasoned from the paragraph above — `stat` on disk against
     `git cat-file -s HEAD:` at the branch head:

       file                  before      after
       flows-overview.js    178,098    182,865
       flows-ui.js           25,136     25,136
       nav.js                 2,560      2,560
       flows-dock.js          6,007      6,007
       total                211,801    216,568 B = 211.49 KiB

     The room under 209 was 2,215 B and this change needs 4,767, so 209 is
     2,552 B short and no amount of re-reading makes it fit.

     WHAT IT BOUGHT. The sector strip could be read three ways — net premium
     in dollars, net contracts, and the share of a basket's own premium that
     leaned — and drew only the third, which is the one quantity that carries
     no size. The other two were already published per basket
     (`netPremiumUsd`; `callVolume` and `putVolume`, whose difference is
     arithmetic on two counts in one unit), so what was missing was a way to
     ask for them. It is a toggle rather than three strips because eleven
     baskets drawn three times is a region nobody scrolls past.

     AND THE SILENCES ARE PER MODE, which is the half that cost the bytes. A
     row's `read` state is about its PREMIUM pair, and the volumes are read
     independently of it, so each mode counts its own reporting baskets, names
     its own missing ones in its own sentence, and scales its own axis — a
     ratio is bounded to +/-1 by construction and a dollar sum is not. One
     shared count over three quantities would have been wrong in two of them.

     213 LEAVES 1,544 B, which is less than the last raise left on purpose:
     this route has now taken three raises in a row, and the next edit to it
     should have to make its argument in the open rather than find room
     already cleared for it.

     213 -> 217, ONE COMMIT LATER, WHICH IS THE ARGUMENT THAT PARAGRAPH ASKED
     FOR. Re-derived the same way:

       flows-overview.js  182,865 -> 187,001; the other three unchanged
       total              216,568 -> 220,704 B = 215.53 KiB

     WHAT IT BOUGHT: the flagged-windows table drew four columns over rows
     carrying `spanStart`, `spanEnd`, `askPrem` and `bidPrem` — so a reader
     could see that $3.0M was flagged and not WHEN inside the session, nor
     which side of the quote the vendor attributed it to. Both are now
     columns: the window start on the EASTERN clock, named in the header
     because a table of session windows with an unnamed clock is a number
     nobody can place, with both ends of the span in the cell's title; and
     the ask/bid share, which carries no hue precisely because green means
     bullish everywhere else on this page and a print at the ask is not
     proof of a buyer. Plus the route to the whole population beside the
     count, which is markup rather than script.

     217 LEAVES 1,504 B. The paragraph above said the next edit to this route
     should argue in the open rather than find room waiting, and this is that
     argument rather than an exception to it: two raises inside one PR is
     worth saying out loud, and what a reader gets for them is five readings
     the payload was already carrying and the page was dropping. */
  /* 217 -> 227 FOR THE SAME CURSOR, ON THE PAGE WITH THE OTHER BIG CHART.
     Derived on disk:

       file                  before      after
       flows-cursor.js            0     10,016   (the ticker route's file,
       flows-overview.js    187,001    187,927    served here too)
       flows-ui.js           25,136     25,136
       nav.js                 2,560      2,560
       flows-dock.js          6,007      6,007
       total                220,704    232,620 B = 227.17 KiB

     ONE FILE, TWO ROUTES, AND THAT IS THE ARGUMENT. The daily flow chart is
     this page's largest drawing and it withheld every session's two figures
     between its axis marks. It could have grown its own hover — a few hundred
     bytes here — and then the ticker's cursor and the overview's would be two
     implementations of one idea, drifting on what a rule looks like and
     whether a keyboard can reach it. The shared file is the more expensive
     and the more honest of the two.

     228 AND NOT 227, AND THE 502 BYTES BETWEEN THEM ARE THE POINT. 227 was
     written against 232,118 B — the figure before the label fix that went in
     with it. The cursor's first registration here read `r.d` for the session,
     which is the BOARD row's key; tideSeries renames `date` to `at`, so every
     readout printed an em dash for its heading. That was caught by driving
     the chart rather than by reading the diff, and the comment recording it
     is what took the route 172 B past a ceiling set minutes earlier. Raising
     to the measurement rather than trimming the note is this file's own rule
     — "bookkeeping rather than engineering" is what it calls the alternative.

     228 -> 230, AND THIS ROUTE DID NOT CHANGE. flows-cursor.js grew from
     10,016 to 12,009 B when it learned a second axis for the ticker's
     transposed gamma profile, and this route serves the same file: 232,620 ->
     234,613 B = 229.11 KiB. That is the cost of one implementation instead of
     two, and it is worth saying out loud rather than discovering twice — a
     change to the shared cursor lands on every route that serves it, so the
     next feature added to it is a raise HERE as well as there.

     230 LEAVES 1,907 B. As on the ticker route, the real answer to this
     route's weight is the comment-stripping build that is already merged and
     waiting on a switch, not a further raise here. */
  /* 230 -> 231, AND THIS ROUTE DID NOT GAIN A FEATURE. flows-cursor.js is
     shared with the ticker, and the ticker's cursor work moved three
     contract rules out of five renderer comments and into that file's
     header: 12,009 -> 13,123 B, +1,114, of which this route pays every byte
     and gains nothing it can see. Measured:

       flows-dock.js   6,007   nav.js         2,560   flows-ui.js     25,136
       flows-cursor.js 12,009 -> 13,123       flows-overview.js  188,901
       total         234,613 -> 235,727 B = 230.20 KiB — 207 B over

     SAYING SO IS THE POINT. A shared file's comment is billed to every route
     that serves it, and the de-duplication that made the ticker's raise
     smaller made this one necessary — a net win across the two (+1,114 here
     against −2,600 there) but not a free one, and a ceiling that absorbed it
     quietly would hide the transfer. 231 leaves 817 B. */

  /* 231 -> 237, AND THIS TIME THE ROUTE DID GAIN SOMETHING. The chart census
     the ticker's raise describes was pointed at this page too — the directive
     is about the section, not one route — and it read 1 cursor against 20
     drawings. It reads 19 and 1 now, with nothing left in `bare`. Byte-exact,
     `git cat-file -s HEAD:` against `stat`:

       flows-dock.js    6,007   nav.js            2,560   flows-cursor.js 13,123
       flows-ui.js     25,136   flows-overview.js 188,901 -> 195,296 (+6,395)
       total          235,727 -> 242,122 B = 236.45 KiB — 5,578 B over

     THREE DRAWINGS, THREE DIFFERENT ANSWERS. The call/put ring declares
     data-fx-read="face": its total sits in the hole and its legend prints
     both shares and both dollar figures, so a cursor would read back what is
     already on screen. The spine takes one, grouped BY SCORE rather than by
     mark — two names on +62 are two circles at one x, and a cursor over the
     flat list would have named one of them and silently dropped the rest.

     THE PER-ROW SCORE STRIPS ARE THE REST, AND THEY REGISTER AT THE CALL SITE
     rather than inside scoreStrip. flows-ui.js is served on four routes and
     only this one links flows-cursor.js — /flows/long/, /flows/track/ and the
     strategy tester do not — so the shared builder would have shipped the
     bytes to three routes where the feature cannot exist at all. That is the
     mirror of the deferral trap this file already names: not a cost moved out
     of a measurement, but a cost that could never be spent. Those three
     ceilings are untouched by this change, which is the evidence the
     placement was right.

     237 LEAVES 566 B, tighter than the 817 above and deliberately so: this
     route is owed the same comment strip the ticker is. */
  overviewPage: 237,
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
