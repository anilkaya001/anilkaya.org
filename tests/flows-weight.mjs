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
import { statSync } from "node:fs";
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

   THE SHARED BUNDLE IS WHERE THE COST COMPOUNDS. flows-panels.js went from
   137k to 147k, and it is loaded on FOUR routes — so ten kilobytes of panel
   work is forty kilobytes of parse across the section, three quarters of it on
   routes that are not the panel workspace. That is the number this table
   exists to keep visible, and it is the reason a ceiling per route beats one
   total.

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
  tickerPage: 470,
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
     rather than golfed. */
  overviewPage: 312,
  /* 300 -> 306 FOR THE DOCKED ASSISTANT, WHICH COSTS 5k ON EVERY ROUTE.
     The board was at 297k and the tab, the empty panel and the loader took
     it to 302k. Raising the number is the honest move rather than shaving
     five kilobytes of comment out of flows-board.js to fit under a line
     nobody re-derived — this file's own header calls that degrading the
     thing this codebase is strictest about.

     WHAT IS NOT COUNTED HERE IS THE RENDERER THE DOCK FETCHES. flows-ask.js
     is 55k and arrives only when a reader opens the panel, so it is absent
     from a measurement of what a route loads ON ARRIVAL — which is what
     this suite measures and should keep measuring. It is a real cost, paid
     on open, by the readers who asked for it. Stating it here is what stops
     a lazy import from looking free. */
  sidePage: 306,
  watchPage: 240,
  deskPage: 135,
  /* SET AT FIRST MEASUREMENT, 2026-09-04, against 102k — nav 3k, flows-ui 25k,
     flows-strategy 75k.

     THE ROUTE'S BUDGET WAS AN ARGUMENT BEFORE IT WAS A NUMBER, and the
     argument is what it does NOT load. The strategy tester needs a payoff
     engine, a diagram, a chain table and a leg editor; what it emphatically
     does not need is flows-panels.js, which is 152k and sits on four other
     routes for the sake of a card dialog this page has no reason to open.
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
  askPage: 78,
  strategyPage: 120,
  trackPage: 118,
  /* 95 -> 102, THE SAME 5k OF DOCK AS EVERY OTHER ROUTE. The market page
     was the tightest of the mid-weight routes at 95k against 95, so it is
     the one the assistant pushed over. See sidePage above for why the
     number moves rather than the comment budget, and for what this
     measurement deliberately does NOT count. */
  marketPage: 102,
  /* THE +7 ON THIS AND THE FOUR ENTRIES BELOW IS THE DOCKED ASSISTANT.
     assets/js/flows-dock.js is 5k and now ships on every gated route but
     /flows/ask, and these were the routes with less than that in hand. The
     reasoning is sidePage's, once: the number moves rather than the comment
     budget, and the 55k renderer the dock fetches on first open is
     deliberately NOT in this measurement, which is of what a route loads on
     arrival. */
  unusualPage: 92,
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
  ok(panelRoutes.length >= 3,
     `the panel bundle is loaded on ${panelRoutes.length} routes, most of which are not the ` +
     `panel workspace — it is there for the card overlay a deep link opens, which most ` +
     `visitors to those routes never open`);
}

console.log(`✓ flows-weight: ${checks} assertions — every route's JavaScript weighed from the ` +
  `HTML it actually emits rather than from a list that could go stale, every emitted script ` +
  `proven to exist so a deferred 404 cannot leave a route a silent shell, a stated ceiling ` +
  `per route and no ceiling without a route, and the table printed on every run so the number ` +
  `lives in the log of a build that passed`);
