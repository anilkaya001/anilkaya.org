/* =============================================================
   flows-pages.js — HTML for the gated Flows section.

   These documents are deliberately NOT static assets. `flows/` is
   listed in .assetsignore, so the pages exist only here and are
   emitted by the Worker after the session check.

   That is a structural guarantee rather than a filtered one. Review
   of a prefix-test design found that /%66lows/index.html,
   //flows/index.html, /flows and /FLOWS/index.html all evade
   startsWith("/flows/"), and worker.js ends by handing anything it
   did not match to env.ASSETS.fetch(). With the markup held here
   instead, a missed path can only ever produce a 404 — there is no
   file in the bundle for it to leak.

   ASSET_VERSION is pinned by tests/flows-features contract against
   assets/version.txt, so a bump cannot silently desynchronise.
   ============================================================= */

import { TICKER_PANELS } from "./flows-panels.js";

export const ASSET_VERSION = "112";

const v = (path) => `${path}?v=${ASSET_VERSION}`;

const head = (title, description) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${v("/assets/css/base.css")}">
<link rel="stylesheet" href="${v("/assets/css/flows.css")}">
</head>`;

const topbar = (active) => `
<header class="topbar">
  <a class="topbar__brand" href="/" aria-label="Home">&#949;</a>
  <nav class="pill" aria-label="Primary">
    <a href="/">Home</a>
    <a href="/articles/">Articles</a>
    <a href="/lab/"><span class="lab-full">Econometrics&nbsp;Lab</span><span class="lab-short">Lab</span></a>
    <a href="/flows/"${active ? ' class="is-active" aria-current="page"' : ""}>Flows</a>
  </nav>
</header>`;


/* ---------- the rail ------------------------------------------- */

/**
 * The persistent left navigation, on every Flows page.
 *
 * The section had more navigable surface than its two-item subnav admitted:
 * the ticker card has shipped a working ?t= deep link that nothing linked to,
 * and the long and short sides were a TOGGLE — a control that hides half the
 * product behind a click and cannot be linked to, bookmarked or sent to
 * anyone. Splitting them into routes makes each a place rather than a state.
 *
 * A RAIL ON A PHONE IS A DRAWER, NOT A COLUMN. At 320px a persistent 200px
 * column would leave 120px for a thirteen-column table. Below 60rem it
 * collapses to a horizontal strip of the same links, scrollable, with the
 * group labels dropped — the destinations survive, the chrome does not.
 * There is no hamburger and nothing to open: a menu you must open is a menu
 * that hides the product, which is the problem this replaces.
 */
const rail = (active) => {
  /* THE COUNTS ARE FILLED IN THE BROWSER, not here. The Worker would have to
     read both board rows out of D1 on every page view to render a two-digit
     badge — two row reads per view, against a free-tier quota shared with a
     live app, for a number the page is about to fetch anyway. So the slot is
     emitted empty and hidden, and whichever controller already has the
     payload fills it. A badge that says nothing until the data lands is
     honest; a badge that says 0 while the fetch is in flight is not. */
  const item = (href, label, key) => {
    const on = active === key;
    /* EVENTS WAS QUERYING A SLOT THAT WAS NEVER RENDERED. flows-events.js has
       filled [data-rail-count="events"] since the calendar shipped; this set
       emitted a slot for three keys and not that one, so the query matched
       nothing and the badge could never appear — a silent no-op rather than an
       error, which is why it survived. The set and the fillers agree now. */
    const badge = key === "long" || key === "short" || key === "watch" || key === "events"
      ? `<span class="rail-count" data-rail-count="${key}" hidden></span>` : "";
    return `<a href="${href}"${on ? ' class="is-on" aria-current="page"' : ""}>` +
      `<span class="rail-label">${label}</span>${badge}</a>`;
  };
  return `
<nav class="flows-rail" aria-label="Flows">
  <!-- FIRST, BECAUSE IT IS THE FRONT DOOR. Every group below answers a
       question a reader already knew to ask; this one answers the question
       they arrive with. A rail that buried it under twelve destinations
       would be a table of contents for a book nobody opened. -->
  <p class="rail-group" id="railBrief">Briefing</p>
  <div class="rail-items" role="group" aria-labelledby="railBrief">
    ${item("/flows/ask/", "Ask the data", "ask")}
  </div>
  <p class="rail-group" id="railSession">Session</p>
  <div class="rail-items" role="group" aria-labelledby="railSession">
    ${item("/flows/", "Overview", "overview")}
    ${item("/flows/long/", "Bullish", "long")}
    ${item("/flows/short/", "Bearish", "short")}
    ${item("/flows/watch/", "Watch", "watch")}
    ${item("/flows/market/", "Market", "market")}
    ${item("/flows/unusual/", "Unusual", "unusual")}
    ${item("/flows/events/", "Events", "events")}
  </div>
  <p class="rail-group" id="railName">Name</p>
  <div class="rail-items" role="group" aria-labelledby="railName">
    ${item("/flows/ticker/", "Ticker page", "ticker")}
  </div>${active === "ticker" ? `
  <!-- THE ONLY COLUMN ON THE PAGE THAT SURVIVES A SCROLL, and on the one
       route that is about a single name it spent its whole height on twelve
       destinations. This is the host for that name's key readings — price,
       levels, convexity, quality — filled by assets/js/flows-ticker.js from
       the card it already holds. No new fetch: every number is on the payload
       the page has in hand.

       EMITTED EMPTY AND HIDDEN, on this route only. A rail block that says
       nothing until the card lands is honest; one that renders a frame of em
       dashes while a fetch is in flight is a set of readings that came back
       blank, which is a different and false claim. The stylesheet also drops
       it entirely below 60rem, where the rail is a horizontal strip and a
       stat wall would push every destination off the screen. -->
  <div class="rail-stats" id="ftRail" hidden></div>` : ""}
  <p class="rail-group" id="railDesk">Desk</p>
  <div class="rail-items" role="group" aria-labelledby="railDesk">
    ${item("/flows/desk/", "Premium desk", "desk")}
    ${item("/flows/strategy/", "Strategy tester", "strategy")}
  </div>
  <p class="rail-group" id="railDisclosures">Disclosures</p>
  <div class="rail-items" role="group" aria-labelledby="railDisclosures">
    ${item("/flows/political/", "Political", "political")}
  </div>
  <p class="rail-group" id="railEvidence">Evidence</p>
  <div class="rail-items" role="group" aria-labelledby="railEvidence">
    ${item("/flows/history/", "Track record", "history")}
    ${item("/flows/track/", "Score track", "track")}
  </div>
</nav>`;
};


/* The chrome every Flows page shares. Kept in one place so the rail, the
   identity block and the heading structure cannot drift between four pages. */
/* THE ASSISTANT, DOCKED ON EVERY GATED PAGE BUT ITS OWN.
 *
 * A question box at one route is a destination: a reader looking at the
 * bearish board and wondering what changed has to leave the board to ask.
 * This puts the same box on the right edge of every page, one key away.
 *
 * NOT ON /flows/ask, WHERE THE PAGE IS THE ASSISTANT. Two mounts would
 * collide on `#askApp` — one id, two elements, and the renderer takes
 * whichever the DOM hands it — and a floating copy of the page you are
 * already reading is noise rather than access.
 *
 * THE RENDERER IS NOT LOADED HERE. `data-src` names it and
 * assets/js/flows-dock.js fetches it on first open. flows-ask.js is 55KB;
 * served on all thirteen routes it would break six weight ceilings and
 * bill every reader who never opens the rail. What ships on arrival is
 * the tab, the empty panel and a loader.
 *
 * `hidden` ON THE PANEL AND NOT ON THE TAB: the tab is the affordance and
 * must survive a page with no JavaScript at all, where it does nothing and
 * says nothing — which is better than a rail that paints an empty box.
 */
const dock = (active) => (active === "ask" ? "" : `
<button type="button" class="ak-dock-tab" id="askDockTab"
        aria-expanded="false" aria-controls="askDockPanel">
  <span class="ak-dock-tab-l">Ask</span>
</button>
<aside class="ak-dock" id="askDock" data-src="${v("/assets/js/flows-ask.js")}">
  <div class="ak-dock-panel" id="askDockPanel" role="complementary"
       aria-label="Ask about the published readings" hidden tabindex="-1">
    <div class="ak-dock-head">
      <p class="ak-dock-title">Ask about what has been published</p>
      <button type="button" class="ak-dock-close" aria-label="Close the assistant">×</button>
    </div>
    <p class="flows-status" id="askStatus" role="status"></p>
    <div id="askApp" data-mode="dock"></div>
  </div>
</aside>
<script src="${v("/assets/js/flows-dock.js")}" defer></script>`);

const shell = (title, kicker, active, username, body) => `
<body class="flows-body has-rail">
${topbar(true)}
${rail(active)}
<main class="flows-main">
  <header class="flows-head">
    <div>
      <p class="flows-kicker">${kicker}</p>
      <h1>${title}</h1>
    </div>
    <div class="flows-session">
      <span class="flows-user">${escapeHTML(username)}</span>
      <form method="POST" action="/flows/logout"><button type="submit" class="flows-signout">Sign out</button></form>
    </div>
  </header>
${body}
</main>
${dock(active)}`;

/* ---------- login ---------------------------------------------- */

export function loginPage({ error = "" } = {}) {
  // Escaped like every other interpolation in this file. Both call sites pass
  // literals today, so this is not a live hole — but an unescaped sink that
  // happens to be safe is one careless caller away from not being.
  const message = error
    ? `<p class="flows-alert" role="alert">${escapeHTML(error)}</p>`
    : "";
  return `${head("Flows — Sign in", "Restricted options-flow intelligence.")}
<body class="flows-body">
${topbar(true)}
<main class="flows-auth">
  <div class="flows-auth__card">
    <p class="flows-kicker">Restricted</p>
    <h1>Flows</h1>
    <p class="flows-auth__lede">Options-flow intelligence. Access is by assigned credential.</p>
    ${message}
    <form method="POST" action="/flows/login" class="flows-form">
      <label for="u">Username</label>
      <input id="u" name="username" type="text" autocomplete="username"
             autocapitalize="none" autocorrect="off" spellcheck="false" required>
      <label for="p">Password</label>
      <input id="p" name="password" type="password" autocomplete="current-password" required>
      <button type="submit" class="flows-submit">Sign in</button>
    </form>
  </div>
</main>
<script src="${v("/assets/js/nav.js")}" defer></script>
</body>
</html>`;
}


/* The ticker card, shared by every page that lists tickers. Extracted so the
   overview and the two side pages cannot drift apart on the markup the card
   renderer targets by id — a mismatch there is a panel that silently never
   draws, which this repo has shipped before. */
const cardDialog = () => `
<dialog id="flowsCard" class="fc" aria-labelledby="fcTitle">
  <article class="fc-inner">
    <header class="fc-head">
      <div class="fc-id">
        <h2 id="fcTitle" tabindex="-1">&nbsp;</h2>
        <span class="fc-score" id="fcScore"></span>
        <span class="fc-meta" id="fcConv"></span>
        <span class="fc-meta" id="fcRegime"></span>
        <!-- THE WAY OUT OF THE MODAL, and it lives here rather than on the
             deck card because .fd-card IS a <button> and an <a> inside a
             button is invalid HTML — interactive content cannot nest. Putting
             it in the dialog reaches every surface that opens a card at once,
             which the deck-card version would not have. href is filled by
             paint(); the anchor stays hidden until a card is painted. -->
        <a class="ft-link fc-full" id="fcFull" hidden>Full page &#8599;</a>
      </div>
      <button type="button" class="fc-close" id="fcClose" aria-label="Close">&times;</button>
    </header>

    <p class="fc-staleband" id="fcStale" role="status" hidden></p>

    <section class="fc-panel" aria-labelledby="fcGammaH">
      <h3 id="fcGammaH">Gamma convexity</h3>
      <div id="fcGamma"></div>
    </section>

    <section class="fc-panel" aria-labelledby="fcSurfaceH">
      <h3 id="fcSurfaceH">Gamma surface &mdash; strike &times; expiry</h3>
      <div id="fcSurface"></div>
    </section>

    <section class="fc-panel" aria-labelledby="fcLevelsH">
      <h3 id="fcLevelsH">Key levels &amp; distance to spot</h3>
      <div id="fcLevels"></div>
    </section>

    <section class="fc-panel" aria-labelledby="fcDispH">
      <h3 id="fcDispH">Where the book is moving</h3>
      <div id="fcDisp"></div>
    </section>

    <section class="fc-panel" aria-labelledby="fcCalH">
      <h3 id="fcCalH">Gamma roll-off</h3>
      <div id="fcCal"></div>
    </section>

    <section class="fc-panel" aria-labelledby="fcMoveH">
      <h3 id="fcMoveH">The priced move</h3>
      <div id="fcMove"></div>
    </section>

    <section class="fc-panel" aria-labelledby="fcCtxH">
      <h3 id="fcCtxH">Price context</h3>
      <div id="fcCtx"></div>
    </section>

    <section class="fc-panel" aria-labelledby="fcPathH">
      <h3 id="fcPathH">Session path</h3>
      <div id="fcPath"></div>
    </section>

    <section class="fc-panel" aria-labelledby="fcCongressH">
      <h3 id="fcCongressH">Disclosed congressional transactions</h3>
      <div id="fcCongress"></div>
    </section>

    <section class="fc-panel" aria-labelledby="fcWhyH">
      <h3 id="fcWhyH">Score derivation</h3>
      <div id="fcWhy"></div>
    </section>

    <p class="fc-prov" id="fcProv"></p>
  </article>
</dialog>`;

/* ---------- overview: the command center ------------------------ */

/**
 * The landing page, and the one screen that answers "what should I look at
 * today" without leaving it.
 *
 * IT USED TO THROW AWAY WHAT IT HAD ALREADY FETCHED. The page pulled both
 * full board payloads — every ranked name on each side — and drew SIX TILES
 * from them, three a side. Everything else the session knows sat on four
 * other routes, so the first question anyone asks cost five page loads.
 *
 * NINE REGIONS NOW, FROM NINE ENDPOINTS THAT ALREADY EXISTED. A verdict
 * bar, both ranked sides ten deep with a score strip per row, what moved
 * since the prior session, the freshest flagged windows, what reports next,
 * what is a hair outside the band, where the eleven sector baskets leaned in
 * OPTION premium, the headline tape with its age on it, and the spine. No new
 * vendor call, no pipeline change: the difference is that the page stopped
 * discarding what was already in its hands — the last two keys had been
 * published and served for a whole wave with nothing anywhere drawing them.
 *
 * THE REGION SHELLS ARE EMITTED HERE, THE CONTENTS IN THE BROWSER — the same
 * split marketPage() uses for its .fc-panel skeletons. A heading is prose and
 * belongs in the document; a subtitle that reads "top 10 of 43" is a
 * measurement and cannot be written before the payload lands.
 *
 * THE SPINE KEEPS ITS PLACE at the foot, inside a region of its own. It is
 * the only view of the WHOLE distribution — one mark per published name on a
 * fixed −100..+100 axis with the dead band hatched onto it — and the regions
 * above it are an index of that distribution, not a replacement for it. That
 * band is why this page is usually short, and a reader who cannot see it
 * reads a ten-name page as a broken one.
 */
export function overviewPage({ username = "" } = {}) {
  return `${head("Flows — Overview", "The whole session on one screen: both tails, the level, what moved, and what reports next.")}
${shell("Session Overview", "Options-flow intelligence", "overview", username, `
  <div class="flows-status" id="flowsStatus" role="status">Loading the latest session…</div>
  <p class="flows-stale" id="flowsStale" role="status" hidden></p>

  <!-- THE COMMAND CENTER. Twelve columns at desk widths, stacking to one on a
       phone. Every region below is a HOST: the shell, its heading and its
       accessible name are emitted here; the rows, the tiles and the strips are
       filled by flows-overview.js from payloads this page cannot see. A region
       that stays empty says which of the three silences it is in — the key was
       never published, the request never came back, or the pipeline measured
       and found nothing — because only the last of those is about the market. -->
  <div class="cc">

    <!-- Six readings the rest of the page then explains. Any of them may be an
         em dash: a tile whose endpoint did not answer says so by not saying a
         number. -->
    <section class="cc-verdict" id="ccVerdict" aria-label="Session verdict"></section>

    <section class="cc-region cc-bull" aria-labelledby="ccBullH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccBullH">Bullish</h2>
        <!-- The subtitle IS the way to the rest of them: it says how many this
             region is NOT showing, and goes there. -->
        <a class="cc-h-s" href="/flows/long/" id="ccBullSub" hidden></a>
      </div>
      <div class="cc-body" id="ccBull"></div>
    </section>

    <section class="cc-region cc-bear" aria-labelledby="ccBearH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccBearH">Bearish</h2>
        <a class="cc-h-s" href="/flows/short/" id="ccBearSub" hidden></a>
      </div>
      <div class="cc-body" id="ccBear"></div>
    </section>

    <!-- THE QUESTION NO OTHER ROUTE ANSWERS. Every surface in this section
         reports a level; none of them reports a CHANGE, so a name that moved
         forty points overnight looks exactly like one that has sat still for a
         month. "Prior session" means the previous session the name was SCORED:
         a gap in the trace means it was not scored that day, never that it
         scored zero. -->
    <section class="cc-region cc-chg" aria-labelledby="ccChgH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccChgH">What changed</h2>
        <!-- A SLOT, and its default text is the whole truth when nothing
             fills it. The region caps at twelve rows and this span said no
             count at all, so a session in which thirty-four names moved
             showed twelve under a subtitle a reader takes for the whole
             list. flows-overview.js prefixes the count it drew, and only on
             the branch that drew rows. -->
        <span class="cc-h-s" id="ccChgSub">since each name&#39;s prior scored session</span>
      </div>
      <div class="cc-body" id="ccChg"></div>
    </section>

    <!-- The vendor's own rules, not this pipeline's. Tickers here are plain
         text: a detail card exists only for the names the board went deep on,
         and an opener that usually opens nothing is worse than no opener. -->
    <section class="cc-region cc-alerts" aria-labelledby="ccAlertsH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccAlertsH">Freshest flagged windows</h2>
        <span class="cc-h-s" id="ccAlertsSub"></span>
      </div>
      <div class="cc-body" id="ccAlerts"></div>
    </section>

    <section class="cc-region cc-ev" aria-labelledby="ccEventsH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccEventsH">Reporting soon</h2>
        <span class="cc-h-s" id="ccEventsSub"></span>
      </div>
      <div class="cc-body" id="ccEvents"></div>
    </section>

    <!-- Fully scored, published on neither side. Until the watch board existed
         these names reached the reader as a single integer in the band label. -->
    <section class="cc-region cc-watch" aria-labelledby="ccWatchH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccWatchH">Nearly in</h2>
        <a class="cc-h-s" href="/flows/watch/" id="ccWatchSub">inside the dead band</a>
      </div>
      <div class="cc-body" id="ccWatch"></div>
    </section>

    <!-- WHERE THE ELEVEN SECTORS LEAN, IN OPTION PREMIUM.

         DELIBERATELY NOT THE SECTOR PANEL ON /flows/market/, AND THE WHOLE
         DESIGN OF THIS ONE IS ABOUT KEEPING THE TWO APART. That panel draws
         sector:trix — TRIX on each sector ETF's daily log closes, quoted in
         basis points per session, containing not one option. This draws
         sector:premium: today's bullish minus bearish OPTION premium over the
         same eleven SPDR baskets. worker.js:2721 gave them separate routes for
         exactly that reason: "the two can disagree for weeks without either
         being wrong, and a reader who asked for one must never be handed the
         other".

         SO A READER WHO HAS SEEN THE OTHER PANEL IS TOLD APART FROM IT FOUR
         WAYS, AND NONE OF THEM IS THE COLOUR:

           1. THE HEADING NAMES THE QUANTITY. "options premium", never
              "momentum" — in the one place a reader looks first.
           2. EVERY NUMERIC COLUMN CARRIES ITS UNIT. "% of premium" and "$".
              The word "bp" — that panel's unit — appears nowhere in this
              region, and the suite asserts that it does not.
           3. THE NOTE NAMES THE OTHER KEY OUTRIGHT, out of the publisher's own
              notSameAs field, and names the route that draws it. Carried
              rather than paraphrased, so the two cannot drift.
           4. THE DRAWING IS A DIFFERENT SHAPE. A table with the dollars beside
              the bar, rather than that page's bare bar-and-value list —
              because a ratio with no magnitude cannot tell a reader whether a
              strong lean is $62K or $400M.

         AND THE ORDER IS THE PUBLISHER'S. lean.rank says leanRatio and says
         why: XLK clears hundreds of millions of premium on an ordinary day and
         XLB tens of thousands, so ranking eleven baskets on the DOLLAR
         difference ranks them by basket size with a faint conviction signal on
         top. -->
    <section class="cc-region cc-lean" aria-labelledby="ccLeanH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccLeanH">Sector lean · options premium</h2>
        <!-- A SLOT WITH A TRUE DEFAULT. Before the payload lands the only
             honest thing this can say is what the panel is made of; the count
             of baskets that actually leaned is a measurement and is written
             by flows-overview.js. -->
        <span class="cc-h-s" id="ccLeanSub">options premium, not price momentum</span>
      </div>
      <div class="cc-body" id="ccLean"></div>
    </section>

    <!-- THE HEADLINE TAPE, AND THE REASON IT IS NOT CALLED "LATEST".

         FRESHNESS IS THE HONEST PROBLEM HERE. The pipeline reads this feed once
         on a weekday-morning cron — 05:15 America/New_York — and news is a
         stream: a headline fetched at 09:15 and read at 15:00 is six hours old.
         A news region that LOOKS live and is six hours old is worse than no
         news region at all, because a reader acts on it.

         SO THE PAGE STATES THE AGE RATHER THAN IMPLYING FRESHNESS, and it
         states it in the order that matters: the age of the fetch is the FIRST
         node in the region, above the first headline, because a footnote under
         the last one is read after the damage is done. Every row then carries
         its own age from the vendor's own created_at stamp, and a row the
         vendor sent undated says "undated" rather than being dated to now —
         which would be the confident zero in the one dimension where it is
         invisible.

         TWO CEILINGS, TWO SENTENCES, AND THEY SAY OPPOSITE THINGS.
         atVendorLimit means the VENDOR'S own maximum was returned, so the
         true population is unknown and at least that large. capped/shed
         means OUR row cap dropped rows we did see, so their number is known
         exactly. A single word — "truncated" — for both would leave a reader
         unable to tell an unknown population from a known one.

         AND A TICKER LINKS ONLY WHERE THERE IS SOMETHING BEHIND IT. Every row
         carries the vendor's tickers array, which is a genuine join between a
         headline and a name this product ranks — but the card dialog only
         exists for the names the run went deep on, so the rest are printed
         plain. An opener that usually opens nothing is worse than no opener. -->
    <section class="cc-region cc-news" aria-labelledby="ccNewsH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccNewsH">Headlines</h2>
        <span class="cc-h-s" id="ccNewsSub"></span>
      </div>
      <div class="cc-body" id="ccNews"></div>
    </section>

    <!-- THE SPINE, re-seated rather than replaced. A fixed -100..+100 axis with
         the dead band hatched, so the band that excluded most of the market is
         visible rather than inferred. It is the only view of the whole
         distribution on the page, which is why it survived the redesign intact. -->
    <section class="cc-region cc-spine" aria-labelledby="ccSpineH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccSpineH">The whole distribution</h2>
        <span class="cc-h-s">every published name on a fixed axis</span>
      </div>
      <section class="spine" aria-labelledby="spineH">
        <h2 id="spineH" class="spine-h">Where the session leans</h2>
        <div id="spinePlot"></div>
      </section>
    </section>

  </div>

  <!-- THE NUMBER THAT WAS A CLAIM. This footer named an expected hit rate as
       a two-point range, on the landing page of a paid product, through
       months in which the store could not hold a past and nothing was being
       measured at all — the exact defect the track record was built to
       correct, restated as a literal in the one file that is not allowed to
       hold derived numbers. It sat a rail-click from the page that now
       measures the real one. The figure is deliberately not repeated here:
       a number in a comment is still a number a reader can quote.

       It is a SLOT now. The default sentence below is true whether or not any
       controller ever fills it, which is the test a default has to pass; when
       /api/flows/record answers, flows-overview.js replaces the span with the
       measured rate, its horizon and its n, or with the pending sentence when
       too few sessions have closed to measure anything. A measured hit rate
       and an asserted one are not the same number even when they agree. -->
  <p class="flows-foot">
    Scores are a ranked attention signal, not a return forecast. Names inside
    the dead band are not published on either side.
    <span class="foot-hit" id="flowsHitRate">Whether this board has been right
    is measured rather than asserted, session by session, on the
    <a href="/flows/history/">track record</a>.</span>
  </p>
`)}
${cardDialog()}
<script src="${v("/assets/js/nav.js")}" defer></script>
<!-- flows-ui.js BEFORE flows-overview.js: the overview reads window.FlowsUI at
     module scope, and two deferred scripts execute in document order, so the
     library has to be the earlier tag. It is a hard dependency and the page
     says so on the status line rather than throwing when it is missing. -->
<script src="${v("/assets/js/flows-ui.js")}" defer></script>
<script src="${v("/assets/js/flows-overview.js")}" defer></script>
<script src="${v("/assets/js/flows-panels.js")}" defer></script>
<script src="${v("/assets/js/flows-card.js")}" defer></script>
</body>
</html>`;
}

/* ---------- board ---------------------------------------------- */

/**
 * A candidate list — /flows/long/ or /flows/short/ — as a PAGE, not a toggle.
 *
 * The side used to be a control on the landing page. That is two problems: it
 * hid half the session behind a click, and a toggle has no address, so a
 * reader could not link to the bearish side, bookmark it, or send it to
 * anyone. As routes they are places, the rail can mark which one you are on,
 * and the overview can link to both.
 *
 * The deck/table toggle stays a toggle, because it genuinely is a preference
 * about the same rows rather than a different set of them.
 */
export function sidePage({ username = "", side = "long" } = {}) {
  const bear = side === "short";
  const title = bear ? "Bearish candidates" : "Bullish candidates";
  const lede = bear
    ? "Names leaning bearish this session, ranked by score."
    : "Names leaning bullish this session, ranked by score.";
  return `${head("Flows — " + title, lede)}
${shell(title, "Options-flow intelligence", bear ? "short" : "long", username, `
  <div class="flows-status" id="flowsStatus" role="status">Loading the latest session…</div>
  <p class="flows-stale" id="flowsStale" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
    <div class="flows-views" role="group" aria-label="Layout">
      <button type="button" class="flows-view is-on" data-view="deck" aria-pressed="true">Deck</button>
      <button type="button" class="flows-view" data-view="table" aria-pressed="false">Table</button>
    </div>
  </div>

  <!-- One payload, two renderers, exactly one mounted at a time. The deck is
       the default because the table's columns are wider than any phone. -->
  <div class="flows-deck" id="flowsDeck" role="list" aria-label="Ranked candidates"></div>

  <!-- tabindex + role: the table is wider than any phone viewport, so this
       wrapper always scrolls horizontally. Without a tabindex a keyboard-only
       user tabs straight past it and most columns are unreachable. -->
  <div class="flows-tablewrap" id="flowsTableWrap" tabindex="0" role="region" aria-label="Ranked candidates" hidden>
    <table class="flows-table" id="flowsTable">
      <caption class="flows-caption">Ranked candidates. Select a ticker for its gamma profile, key levels and disclosed congressional trades. Every score decomposes into its contributing families.</caption>
      <thead>
        <tr>
          <th scope="col" class="c-rank">#</th>
          <th scope="col">Ticker</th>
          <th scope="col" class="c-num">Last</th>
          <th scope="col" class="c-num">Score</th>
          <th scope="col" class="c-num">Conv</th>
          <th scope="col" class="c-num"><abbr title="Three signed axes — Flow, Positioning, Path — then two unsigned gauges: Vol regime and Quality">F&middot;P&middot;D&middot;V&middot;O</abbr></th>
          <th scope="col" class="c-num">&Pi;</th>
          <th scope="col" class="c-num">&Gamma; regime</th>
          <th scope="col" class="c-num">&Gamma;&#8320; dist</th>
          <th scope="col" class="c-num">Net prem</th>
          <!-- APPENDED, NEVER INSERTED. The board controller binds its column
               model positionally, and tests/flows-legacy-payload.mjs reads the
               families glyph at a fixed child index, so anything placed before
               Net prem silently shifts every cell after it under the wrong
               heading — a table that still renders perfectly and is wrong.

               All three arrived on every board row from the first day and no
               renderer drew them, which is the same class of defect as the
               desk's If-called column: computed, serialised, shipped, unread. -->
          <th scope="col" class="c-num"><abbr title="Where the last close sits in its own 52-week range: 0% at the year's low, 100% at the high. A position in a range, not a return — a name can sit at 95% after a year of going nowhere and a month of going up">52w</abbr></th>
          <th scope="col" class="c-num"><abbr title="Thirty-day implied volatility minus the volatility this name has actually delivered over the 21 sessions spanning the same thirty calendar days, both annualised, in volatility points. The difference between two measurements — not a forecast, not an edge, and not a variance premium in the swap sense. It says what the option market is charging against what the stock has been doing, and nothing about which of the two is right">VRP</abbr></th>
          <th scope="col" class="c-num"><abbr title="Where 30-day implied volatility sits within its own past year: 0 at the year's low, 100 at the high. A percentile of volatility, not a level of it — a 20 IVR name can still be the most volatile name on the board">IVR</abbr></th>
        </tr>
      </thead>
      <tbody id="flowsBody"></tbody>
    </table>
  </div>

  <!-- The same asserted hit rate the overview carried, and the same slot. See
       the note in overviewPage: an unmeasured performance number restated in a
       renderer is a claim wearing a measurement's clothes. -->
  <p class="flows-foot">
    Scores are a ranked attention signal, not a return forecast.
    <span class="foot-hit" id="flowsHitRate">Whether this side has been right
    is measured rather than asserted, session by session, on the
    <a href="/flows/history/">track record</a>.</span>
  </p>
`)}
${cardDialog()}
<script src="${v("/assets/js/nav.js")}" defer></script>
<!-- flows-ui.js BEFORE flows-board.js, for the reason the overview states at
     its own tag: two deferred scripts execute in document order and the board
     reads window.FlowsUI at module scope (flows-board.js:36).

     WITHOUT THIS TAG THE BOARD'S CONTROL BAR DID NOT EXIST. buildControls()
     opens "if (!host || !UI …) return;" — so on a page where the library was
     never served it returned on its first statement, and the ticker filter,
     the eight-way order select and the "8 of 63 names match" denominator were
     ~130 lines of finished, commented, argued code that never entered the DOM
     on the two busiest routes in the section. Nothing failed. The guard is
     correct — a page that cannot build the controls should not throw — and a
     correct guard over an absent dependency is silence, which is why this
     survived: the page looked finished because the missing part was the part
     that would have drawn itself.

     NOT ADDED TO THE OTHER NINE ROUTES, and that is a measurement rather than
     an oversight. The library is 24k of uncompressed parse; tests/flows-weight
     measures each route's JavaScript against a stated ceiling, and serving it
     everywhere trips five of them at once (desk 141/135, market 115/95,
     unusual 104/85, political 73/55, history 68/45) while leaving events 1k
     and ticker 6k. flows-weight.mjs:92 already says where that cost comes
     from — "THE SHARED BUNDLE IS WHERE THE COST COMPOUNDS" — so the library
     goes where something on the page actually calls it. Here, 267k to 291k
     against a 300k ceiling, and it buys back a whole control bar. -->
<script src="${v("/assets/js/flows-ui.js")}" defer></script>
<script src="${v("/assets/js/flows-board.js")}" defer></script>
<script src="${v("/assets/js/flows-panels.js")}" defer></script>
<script src="${v("/assets/js/flows-card.js")}" defer></script>
</body>
</html>`;
}

/* ---------- desk ------------------------------------------------ */

/**
 * The premium desk.
 *
 * The board answers "which names deserve attention", chosen by a pipeline
 * from a screened universe. This page answers a different question — "what
 * can I sell on the names I care about, and for how much" — and the names
 * are whatever the user types. There is no candidate list, because a
 * candidate list is precisely what this page exists not to be.
 *
 * The watchlist lives in the URL rather than in browser storage.
 * assets/js/storage.js is the sanctioned owner of that, and a second owner is
 * how two of them disagree; the URL also makes a desk shareable and survivable
 * across a reload, which a private per-browser key does not. It is the same
 * idiom the board's side and view toggles already use.
 */
export function deskPage({ username = "" } = {}) {
  return `${head("Flows — Premium desk", "Option-sale economics for any listed name.")}
${shell("Premium Desk", "Options-flow intelligence", "desk", username, `
<form class="desk-entry" id="deskEntry" autocomplete="off">
    <label for="deskInput">Add symbols</label>
    <div class="desk-entry__row">
      <input id="deskInput" name="tickers" type="text" inputmode="latin"
             autocapitalize="characters" autocorrect="off" spellcheck="false"
             placeholder="AAPL MSFT NVDA"
             aria-describedby="deskInputHelp">
      <button type="submit" class="desk-add">Add</button>
    </div>
    <p class="desk-help" id="deskInputHelp">Separate with spaces or commas. Any listed US symbol.</p>
  </form>

  <div class="desk-list" id="deskList" role="group" aria-label="Watchlist"></div>

  <div class="desk-controls">
    <div class="desk-bulk">
      <label class="desk-check">
        <input type="checkbox" id="deskAll"> <span>Select all</span>
      </label>
      <button type="button" class="desk-refresh" id="deskRefresh">Refresh</button>
      <button type="button" class="desk-clear" id="deskClear">Clear</button>
    </div>
    <div class="desk-filters">
      <!-- Each label is wrapped WITH its control. A flat flex row wraps
           between them on a phone, which orphans "Rank by" onto the line above
           its own select and directly under the other one — a label that reads
           as belonging to the wrong control is worse than no label. -->
      <span class="desk-field">
      <label for="deskStrategy">Sell</label>
      <select id="deskStrategy">
        <option value="both">Puts and calls</option>
        <option value="csp">Cash-secured puts</option>
        <option value="cc">Covered calls</option>
      </select>
      </span>
      <span class="desk-field">
      <label for="deskRank">Rank by</label>
      <select id="deskRank">
        <option value="annualized">Annualised yield</option>
        <option value="premium">Premium received</option>
        <option value="yieldOnCollateral">Yield on collateral</option>
        <option value="cushionSigmas">Cushion</option>
        <option value="collectible">Premium collectible</option>
      </select>
      </span>
    </div>
  </div>

  <div class="desk-capital">
    <div class="desk-capital__entry">
      <label for="deskBP">Buying power</label>
      <div class="desk-capital__field">
        <span class="desk-capital__prefix" aria-hidden="true">$</span>
        <input id="deskBP" name="bp" type="text" inputmode="numeric" autocomplete="off"
               spellcheck="false" placeholder="25,000" aria-describedby="deskBPHelp">
      </div>
      <button type="button" class="desk-capital__clear" id="deskBPClear" hidden>Clear</button>
    </div>
    <p class="desk-help" id="deskBPHelp">
      Cash. Puts are sized cash-secured — the whole strike is reserved — so this
      under-counts what a margin account could write. Held in this page&#39;s address
      so a reload keeps it, which means a link you share carries it too.
    </p>
  </div>

  <p class="desk-plan" id="deskPlan" role="status" hidden></p>

  <div class="flows-status" id="deskStatus" role="status">Add a symbol to begin.</div>

  <!-- THE PANE IS ANCHORED AT ITS TOP-LEFT, and only its right edge, bottom
       edge and bottom-right corner are draggable. A grip on the top or left
       would have to MOVE the box rather than resize it, which in normal
       document flow means every element above the table shifts under the
       cursor mid-drag. Four of the eight grips an "all corners" pane implies
       are therefore not resize handles at all; they are page-reflow handles.
       The right edge, the bottom edge and the bottom-right corner between
       them reach every size the other six could, and all three answer the
       keyboard, which a browser's native resize corner does not. -->
  <div class="desk-pane" id="deskPane" hidden>
    <div class="flows-tablewrap desk-tablewrap" id="deskTableWrap" tabindex="0" role="region"
         aria-label="Sellable contracts">
      <table class="flows-table desk-table">
        <caption class="flows-caption">
        Every quoted contract that clears the liquidity gates, ranked across all selected
        symbols. Premium is what the bid pays today; the mid is not a price anyone must trade at.
      </caption>
      <thead>
        <tr>
          <th scope="col">Symbol</th>
          <th scope="col">Sell</th>
          <th scope="col" class="c-num">Strike</th>
          <th scope="col" class="c-num">Expiry</th>
          <th scope="col" class="c-num">Bid</th>
          <th scope="col" class="c-num">Premium</th>
          <th scope="col" class="c-num c-collect" id="deskCollectHead" hidden><abbr title="What your stated buying power collects on this line: contracts affordable times the premium each pays. Integer division — you cannot sell a third of a contract">Collect</abbr></th>
          <th scope="col" class="c-num"><abbr title="Premium as a fraction of the collateral the trade ties up">Yield</abbr></th>
          <th scope="col" class="c-num"><abbr title="Simple 365/days scaling of the yield. A convention for comparing tenors, not a return anyone earns">Ann.</abbr></th>
          <th scope="col" class="c-num"><abbr title="Distance from spot to breakeven, in units of the move this option's own implied volatility prices over its own remaining life. Not a probability">Cushion</abbr></th>
          <th scope="col" class="c-num">Breakeven</th>
          <th scope="col" class="c-num"><abbr title="A covered call's total return if the shares are called away: the premium plus the move to the strike. A cash-secured put has no upside cap, so its best case is simply the premium — the Yield column">If called</abbr></th>
          <th scope="col" class="c-num"><abbr title="Bid-ask spread as a fraction of the mid">Spread</abbr></th>
          <th scope="col" class="c-num"><abbr title="Open interest, and the change since the prior session">OI</abbr></th>
        </tr>
      </thead>
        <tbody id="deskBody"></tbody>
      </table>
    </div>
    <div class="desk-grip desk-grip--x" id="deskGripX" role="separator"
         aria-orientation="vertical" aria-label="Pane width" tabindex="0"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"></div>
    <div class="desk-grip desk-grip--y" id="deskGripY" role="separator"
         aria-orientation="horizontal" aria-label="Pane height" tabindex="0"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"></div>
    <!-- NO ROLE, deliberately. role="button" was wrong: a button promises
         Enter and Space activation, and this handle answers arrow keys. There
         is no ARIA role for a two-axis resize handle — separator carries an
         orientation and slider is one-dimensional — so it is a focusable
         element whose label says what the keys do, which is honest where a
         borrowed role is a promise it breaks. -->
    <div class="desk-grip desk-grip--xy" id="deskGripXY" tabindex="0"
         aria-label="Pane size, both axes — arrow keys resize width and height"></div>
    <button type="button" class="desk-grip-reset" id="deskGripReset" hidden>Reset size</button>
  </div>

  <p class="flows-foot" id="deskFoot"></p>

  <p class="flows-foot">
    Premium is quoted at the bid and every number here is arithmetic on a quote.
    Nothing on this page estimates a probability of assignment: that needs a
    distribution, which needs a risk-free rate and a dividend yield, and this
    desk does not publish numbers that depend on parameters it invented.
    Selling options has unbounded loss on the call side and equity-sized loss
    on the put side. This is a screen, not advice.
  </p>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-desk.js")}" defer></script>
</body>
</html>`;
}

/* ---------- the watch list ------------------------------------- */

/**
 * THE DEAD BAND, WHICH WAS AN INTEGER.
 *
 * Roughly forty-eight of every sixty scored names land inside the +-20 band
 * each session. They are fully scored -- every family, every gate, every
 * quality multiplier -- and then discarded at the payload boundary, reported
 * to the reader as a single count in a status line.
 *
 * That count is the least useful form of the information. A name sitting at
 * +19 is one session from being published and nothing on the site would let
 * you see it coming; a name at +2 with the largest options-volume surprise in
 * the universe is the most interesting row of the day and had nowhere to
 * appear at all. The band is where a signal is BORN, and it was the one part
 * of the cross-section the product threw away.
 *
 * IT IS NOT A THIRD SIDE. Nothing here cleared the bar, and the page says so
 * in its own lede rather than letting proximity to the band read as a
 * recommendation.
 */
export function watchPage({ username = "" } = {}) {
  const lede = "Scored names that did not clear the band on either side, " +
    "ranked by how close they came. Nothing here is a candidate.";
  return `${head("Flows \u2014 Watch", lede)}
${shell("Watch List", "Options-flow intelligence", "watch", username, `
  <div class="flows-status" id="watchStatus" role="status">Loading the session\u2026</div>
  <p class="flows-stale" id="watchStale" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <div class="flows-tablewrap" id="watchTableWrap" tabindex="0" role="region"
       aria-label="Names inside the dead band" hidden>
    <table class="flows-table watch-table">
      <caption class="flows-caption">
        Every name the pipeline scored and published on neither side. Distance is
        how far the score sits from the band edge, so a row near zero is one
        session from appearing on a board. Surprise is the log ratio of
        call-side to put-side volume surprise, each side against this
        name&#39;s own thirty-day norm &#8212; the most conventional reading of
        &#8220;unusual activity&#8221; there is, signed by which side is doing
        the surprising, and one this product computed and never showed.
      </caption>
      <thead>
        <tr>
          <th scope="col">Ticker</th>
          <th scope="col" class="c-num">Last</th>
          <th scope="col" class="c-num">Score</th>
          <th scope="col" class="c-num"><abbr title="How far this score sits from the nearest edge of the dead band, in score units. Zero means it would publish">To band</abbr></th>
          <th scope="col" class="c-num">Conv</th>
          <th scope="col" class="c-num"><abbr title="Log ratio of call to put volume surprise, each side against this name&#39;s own thirty-day average. 0 is a balanced day for this name; positive means the call side is doing the surprising, negative the put side">Surprise</abbr></th>
          <th scope="col" class="c-num"><abbr title="Today&#39;s share volume against its own recent norm, as the vendor reports it">Rel vol</abbr></th>
          <th scope="col" class="c-num"><abbr title="Put contracts traded per call contract. A ratio of the tape, not a positioning estimate">P/C</abbr></th>
          <th scope="col" class="c-num"><abbr title="Where the last price sits between the 52-week low and high. 0% is the low, 100% the high">52w</abbr></th>
        </tr>
      </thead>
      <tbody id="watchBody"></tbody>
    </table>
  </div>

  <p class="flows-foot">
    A name inside the band is one the cross-section could not separate from
    noise this session. Proximity to the edge is not a weaker version of a
    signal &#8212; it is the absence of one, measured. Read this list for what
    is stirring, never for what to do.
  </p>
`)}
${cardDialog()}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-watch.js")}" defer></script>
<script src="${v("/assets/js/flows-panels.js")}" defer></script>
<script src="${v("/assets/js/flows-card.js")}" defer></script>
</body>
</html>`;
}


/* ---------- the market level ------------------------------------ */

/**
 * THE ONE READING EVERY OTHER SURFACE HERE HAS NEUTRALISED AWAY.
 *
 * The board score is a residual within the day's cross-section, computed after
 * sector and log-capitalisation have been divided out. That is deliberate and
 * it is what makes the score a comparison between names rather than a bet on
 * the tape — but it means a board reporting fifty bullish names is
 * structurally incapable of saying whether the tape as a whole was bought or
 * sold. The level was removed on purpose, upstream of everything.
 *
 * This page reads the level, and it costs nothing: the numbers come from the
 * screener rows the universe was already built from.
 *
 * IT IS NOT "THE MARKET" AND NOTHING ON IT SAYS SO. The vendor's screener caps
 * each band at about fifty rows, so the population is the names this run's
 * ladder returned and the gate admitted. Every heading says "screened
 * universe", and the count is on the page beside the numbers.
 */
export function marketPage({ username = "" } = {}) {
  const lede = "Whether the screened universe was bought or sold, how broad " +
    "that was, and how much of it is five names.";
  return `${head("Flows \u2014 Market", lede)}
${shell("Market Level", "Options-flow intelligence", "market", username, `
  <div class="flows-status" id="mktStatus" role="status">Loading the session\u2026</div>
  <p class="flows-stale" id="mktStale" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <section class="fc-panel" id="mktTiltPanel" hidden>
    <h2 class="fc-panel-h">Bought or sold, two ways</h2>
    <div id="mktTilt"></div>
    <p class="fc-note" id="mktTiltNote"></p>
  </section>

  <section class="fc-panel" id="mktBreadthPanel" hidden>
    <h2 class="fc-panel-h">Breadth, and what it is made of</h2>
    <div id="mktBreadth"></div>
    <p class="fc-note" id="mktBreadthNote"></p>
  </section>

  <section class="fc-panel" id="mktTapePanel" hidden>
    <h2 class="fc-panel-h">The tape</h2>
    <div class="flows-tablewrap" tabindex="0" role="region"
         aria-label="Aggregate tape readings over the screened universe">
      <table class="flows-table" id="mktTape">
        <caption class="flows-caption">
          Sums and ratios over the screened universe. Each row states the
          population it was measured over, because a ratio whose numerator and
          denominator come from different sets of names is not a ratio of
          anything.
        </caption>
        <thead>
          <tr>
            <th scope="col">Reading</th>
            <th scope="col" class="c-num">Value</th>
            <th scope="col" class="c-num"><abbr title="How many names of the screened universe quoted every field this reading needs">Names</abbr></th>
          </tr>
        </thead>
        <tbody id="mktTapeBody"></tbody>
      </table>
    </div>
  </section>

  <section class="fc-panel" id="mktSectorPanel" hidden>
    <h2 class="fc-panel-h">Sector momentum</h2>
    <div id="mktSectors"></div>
    <p class="fc-note" id="mktSectorNote"></p>
  </section>

  <section class="fc-panel" id="mktMoversPanel" hidden>
    <h2 class="fc-panel-h">The session&#39;s extremes</h2>
    <div id="mktMovers"></div>
    <div id="mktMoversBand"></div>
    <p class="fc-note">
      Ranked over the whole screened universe, not over the board. Tickers here
      are plain text: a detail card exists only for the names the board went
      deep on, and a link that usually leads nowhere is worse than no link.
    </p>
  </section>

  <section class="fc-panel" id="mkPulsePanel" hidden>
    <h2 class="fc-panel-h">Market pulse</h2>
    <p class="fc-note" id="mkPulseStamp"></p>
    <div class="mk-pulse-grid" id="mkPulseGrid"></div>
    <p class="fc-note" id="mkPulseFoot"></p>
  </section>

  <p class="flows-foot" id="mktFoot"></p>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-market.js")}" defer></script>
</body>
</html>`;
}


/* ---------- the events calendar --------------------------------- */

/**
 * THE NAMES THE BOARD WAS FORBIDDEN TO SCORE.
 *
 * The pipeline's earnings gate removes every name reporting inside twelve
 * days before the composite is built, and it is right to: the score is a
 * PREDICTIVE ranking, and a name with a scheduled binary event is not being
 * priced by the process that ranking models. But the names it removes are,
 * by construction, the most event-exposed in the universe — and until this
 * page existed they reached the reader as a single integer in a log line and
 * were otherwise discarded.
 *
 * So the funnel stage is a COLUMN here, and `gated` is its most important
 * value: it says the board was forbidden from holding an opinion on this
 * name, which is a different fact from the board having found nothing in it.
 *
 * TWO CLOCKS, AND THE PAGE STATES WHICH IS WHICH. Every price describes the
 * last completed session; every day count is measured from the run's own
 * Eastern date, because that is the origin the gate itself used. At 05:15
 * those differ by one to three days, and counting from the wrong one draws
 * the window early and classifies every name against a gate that never ran —
 * silently, and in a way a fixture built the same way would agree with.
 *
 * ZERO VENDOR CALLS, the second such surface after the movers band.
 */
export function eventsPage({ username = "" } = {}) {
  const lede = "What the screened universe reports next, what the option market " +
    "is charging for the sessions between now and the report, and where each name " +
    "stopped in the board's own funnel — including the ones the board was gated " +
    "out of scoring at all.";
  return `${head("Flows — Events", "What reports next, and what is priced into it.")}
${shell("Events", "Options-flow intelligence", "events", username, `
  <div class="flows-status" id="evStatus" role="status">Loading the calendar…</div>
  <p class="flows-stale" id="evStale" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <section class="fc-panel" id="evWindowPanel" hidden aria-labelledby="evWindowH">
    <h2 class="fc-panel-h" id="evWindowH">The window, and where the gate falls</h2>
    <div id="evWindow"></div>
    <p class="fc-note" id="evWindowNote"></p>
  </section>

  <section class="fc-panel" id="evTablePanel" hidden aria-labelledby="evTableH">
    <h2 class="fc-panel-h" id="evTableH">Reporting next</h2>
    <div class="flows-tablewrap" tabindex="0" role="region"
         aria-label="Names reporting inside the window">
      <table class="flows-table" id="evTable">
        <caption class="flows-caption" id="evCap"></caption>
        <thead><tr>
          <th scope="col">Name</th>
          <th scope="col">Reports</th>
          <th scope="col" class="c-num"><abbr title="Trading sessions between the run's own Eastern date and the report, counted as weekdays. Market holidays are not removed.">Sessions</abbr></th>
          <th scope="col" class="c-num">Last</th>
          <th scope="col" class="c-num"><abbr title="The name's 30-day implied volatility scaled to the sessions before the report by the square root of time. What the option market is charging for that stretch — not a forecast.">Priced</abbr></th>
          <th scope="col" class="c-num"><abbr title="The vendor's own implied move, quoted to the vendor's own next expiry — a different horizon from the column beside it, and deliberately not reconciled with it.">Vendor</abbr></th>
          <th scope="col" class="c-num"><abbr title="30-day implied volatility.">IV</abbr></th>
          <th scope="col" class="c-num"><abbr title="Realized 30-day volatility. Measured only for the enriched names, so most rows withhold it.">RV</abbr></th>
          <th scope="col" class="c-num"><abbr title="Where iv30 sits in its own year, as a fraction.">IV rank</abbr></th>
          <th scope="col"><abbr title="How far this name got in the board&#39;s funnel. &quot;gated&quot; means the board was FORBIDDEN from scoring it, not that it scored badly.">Stage</abbr></th>
        </tr></thead>
        <tbody id="evBody"></tbody>
      </table>
    </div>
    <p class="fc-note" id="evTableNote"></p>
  </section>

  <section class="fc-panel" id="evBasisPanel" hidden aria-labelledby="evBasisH">
    <h2 class="fc-panel-h" id="evBasisH">What these numbers are, and what they are not</h2>
    <div id="evBasis"></div>
  </section>

  <p class="flows-foot" id="evFoot"></p>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-events.js")}" defer></script>
</body>
</html>`;
}


/* ---------- score track ----------------------------------------- */

/**
 * EACH NAME'S DAILY SCORE, TRACED.
 *
 * The boards are a ranking's two tails; this page is the whole distribution
 * over time. One row per name, one cell per session, the cell being the same
 * composite the board printed that morning — no new arithmetic, no new call.
 *
 * The honesty this page must carry above every other: A GAP IS NOT A ZERO.
 * A name absent from a session was not scored that day (out of the screener,
 * under the liquidity floor, inside the earnings gate, or simply not
 * enriched); zero is a score the pipeline assigns. The renderer keeps the two
 * on different channels entirely, and sessions reconstructed from the boards
 * alone are marked board-only so their sparseness reads as a fact about the
 * archive rather than about the market.
 */
export function trackPage({ username = "" } = {}) {
  const lede = "The same score the board prints each morning, traced name by " +
    "name across sessions. The boards show a ranking's two tails; this page " +
    "keeps the whole distribution, so a name drifting toward a board is " +
    "visible before the morning it arrives. A gap means the name was not " +
    "scored that session — never zero.";
  return `${head("Flows — Score track", "Each name's daily score, traced across sessions.")}
${shell("Score track", "Options-flow intelligence", "track", username, `
  <div class="flows-status" id="stStatus" role="status">Loading the track…</div>
  <p class="flows-stale" id="stStale" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <section class="fc-panel" id="stTrackPanel" hidden aria-labelledby="stTrackH">
    <h2 class="fc-panel-h" id="stTrackH">The score, session by session</h2>
    <div id="stTrack"></div>
    <p class="fc-note" id="stTrackNote"></p>
  </section>

  <section class="fc-panel" id="stBasisPanel" hidden aria-labelledby="stBasisH">
    <h2 class="fc-panel-h" id="stBasisH">What this number is, and what a gap is not</h2>
    <div id="stBasis"></div>
  </section>

  <p class="flows-foot" id="stFoot"></p>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-ui.js")}" defer></script>
<script src="${v("/assets/js/flows-track.js")}" defer></script>
</body>
</html>`;
}


/* ---------- unusual activity ----------------------------------- */

/**
 * A COUNTER, NOT A TRADE — and the page is built around that sentence.
 *
 * The recognisable Unusual Whales surface is a per-trade feed: individual
 * prints with a size, a timestamp, an execution price and a sweep flag. Its
 * source is an endpoint this pipeline asserts it cannot reach; a probe now
 * records what that endpoint actually answers, so the assertion will finally
 * have provenance either way.
 *
 * Meanwhile this is what can be built honestly and for nothing. The option
 * chain the pipeline already buys for every board name carries one row per
 * listed strike with a volume total, an open interest and a two-sided quote.
 * That is a contract AGGREGATE. It has no size, no timestamp, no execution
 * price and no counterparty, so this page may never say print, trade, block,
 * sweep, order, bought, sold or paid — a rule a test enforces rather than a
 * habit anyone has to remember.
 *
 * AND IT MAY NEVER SAY "TODAY". The endpoint accepts no date and returns no
 * as-of stamp, and the pipeline reads it four and a quarter hours before the
 * opening bell — so at read time today has not happened. What the counter
 * spans is unobserved. The page publishes readAt, and volumeAsOf: null with
 * the reason beside it, rather than borrowing the session date and quietly
 * turning a free parameter into a fact.
 *
 * TWO PANELS BECAUSE THEY SEE DIFFERENT POPULATIONS. The contract feed can
 * only cover names whose chain was bought — a few dozen, the honest ceiling
 * of a zero-call design. The name panel is built from the screener rows held
 * for every eligible name, hundreds of them, for the same zero calls. Saying
 * so on the surface is what stops the first panel being read as the market.
 */
export function unusualPage({ username = "" } = {}) {
  const lede = "Contracts whose volume counter stands far above the open interest " +
    "beside it. A counter, not a trade: the vendor reports a total for each strike " +
    "with no size, no time and no execution price — and this endpoint carries no " +
    "as-of date, so the counter is stamped with when it was read and nothing more. " +
    "Nothing here says who traded, or why. Above that counter now sit the vendor's " +
    "own flow alerts: windows of activity the vendor's rules flagged, each carrying " +
    "a stated span, a size, a premium and the vendor's sweep flag — richer than the " +
    "counter, and still not a trade, because a window aggregates its executions and " +
    "the selection is the vendor's, not the market's.";
  return `${head("Flows — Unusual activity", "Contracts carrying volume far above their own open interest.")}
${shell("Unusual Activity", "Options-flow intelligence", "unusual", username, `
  <div class="flows-status" id="uaStatus" role="status">Loading the feed…</div>
  <p class="flows-stale" id="uaStale" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <section class="fc-panel" id="uaAlertsPanel" hidden aria-labelledby="uaAlertsH">
    <h2 class="fc-panel-h" id="uaAlertsH">What the vendor's rules flagged</h2>
    <div class="flows-tablewrap" tabindex="0" role="region"
         aria-label="Vendor-flagged windows of option activity">
      <table class="flows-table" id="uaAlerts">
        <caption class="flows-caption" id="uaAlertsCap"></caption>
        <thead><tr>
          <th scope="col">Name</th>
          <th scope="col"><abbr title="The flagged contract: side, strike and expiry, parsed from the vendor&#39;s option symbol.">Contract</abbr></th>
          <th scope="col" class="c-num"><abbr title="The vendor&#39;s total premium across the window, in dollars.">Premium</abbr></th>
          <th scope="col" class="c-num"><abbr title="The vendor&#39;s attribution of the window&#39;s dollars to the ask side of the quote. The split is carried as published and adds no inference about who initiated.">Ask-side</abbr></th>
          <th scope="col" class="c-num"><abbr title="The vendor&#39;s attribution to the bid side. The two sides need not sum to the total.">Bid-side</abbr></th>
          <th scope="col" class="c-num"><abbr title="Contracts across the window, as the vendor totals them.">Size</abbr></th>
          <th scope="col" class="c-num"><abbr title="The vendor&#39;s count of executions inside the window.">Count</abbr></th>
          <th scope="col"><abbr title="The vendor&#39;s own activity flags, reported as sent. An em dash means the vendor did not carry that flag on this row — which is not the same fact as the flag being off.">Flags</abbr></th>
          <th scope="col"><abbr title="The vendor&#39;s stated span of the window, in UTC.">Window</abbr></th>
          <th scope="col"><abbr title="How far the name got in the board&#39;s own funnel this run. &quot;foreign&quot; means the screener never returned it.">Stage</abbr></th>
        </tr></thead>
        <tbody id="uaAlertsBody"></tbody>
      </table>
    </div>
    <p class="fc-note" id="uaAlertsNote"></p>
  </section>

  <section class="fc-panel" id="uaFeedPanel" hidden aria-labelledby="uaFeedH">
    <h2 class="fc-panel-h" id="uaFeedH">Contracts by volume over open interest</h2>
    <div class="flows-tablewrap" tabindex="0" role="region"
         aria-label="Contracts ranked by volume over open interest">
      <table class="flows-table" id="uaFeed">
        <caption class="flows-caption" id="uaFeedCap"></caption>
        <thead><tr>
          <th scope="col">Name</th>
          <th scope="col" class="c-num">Strike</th>
          <th scope="col">Expiry</th>
          <th scope="col">C/P</th>
          <th scope="col" class="c-num"><abbr title="The vendor's volume counter for this strike. Undated: this endpoint carries no as-of stamp.">Vol</abbr></th>
          <th scope="col" class="c-num"><abbr title="Open interest as the vendor reported it on this response, undated.">OI</abbr></th>
          <th scope="col" class="c-num"><abbr title="volume divided by open interest — a ratio of two counts, and the ranking key">Vol/OI</abbr></th>
          <th scope="col" class="c-num"><abbr title="Open interest minus the previous open interest: contracts that stuck between two settlements. It does not say on which side.">&#916;OI</abbr></th>
          <th scope="col" class="c-num"><abbr title="Share of the volume the vendor classified that hit the offer. Not a share of all volume, and not a claim about buying.">Lift</abbr></th>
          <th scope="col" class="c-num"><abbr title="Volume times the quote times 100 shares, both ends. A scale for the money involved, not a bound on it.">Notional</abbr></th>
        </tr></thead>
        <tbody id="uaFeedBody"></tbody>
      </table>
    </div>
    <p class="fc-note" id="uaFeedNote"></p>
  </section>

  <section class="fc-panel" id="uaNamePanel" hidden aria-labelledby="uaNameH">
    <h2 class="fc-panel-h" id="uaNameH">Names against their own thirty-day average</h2>
    <div class="flows-tablewrap" tabindex="0" role="region"
         aria-label="Names ranked by option volume against their own average">
      <table class="flows-table" id="uaNames">
        <caption class="flows-caption" id="uaNameCap"></caption>
        <thead><tr>
          <th scope="col">Name</th>
          <th scope="col" class="c-num">Last</th>
          <th scope="col" class="c-num">Change</th>
          <th scope="col" class="c-num"><abbr title="Call plus put volume over the sum of both thirty-day averages. Withheld when either average is missing.">Both</abbr></th>
          <th scope="col" class="c-num">Calls</th>
          <th scope="col" class="c-num">Puts</th>
          <th scope="col" class="c-num"><abbr title="The vendor's own put/call ratio, passed through.">P/C</abbr></th>
        </tr></thead>
        <tbody id="uaNameBody"></tbody>
      </table>
    </div>
    <p class="fc-note" id="uaNameNote"></p>
  </section>

  <section class="fc-panel" id="uaBasisPanel" hidden aria-labelledby="uaBasisH">
    <h2 class="fc-panel-h" id="uaBasisH">What these numbers are, and what they are not</h2>
    <div id="uaBasis"></div>
  </section>

  <p class="flows-foot" id="uaFoot"></p>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-unusual.js")}" defer></script>
</body>
</html>`;
}


/* ---------- the ticker page ------------------------------------ */

/**
 * ONE NAME, THE WHOLE BOOK — and the four panels nothing has ever drawn.
 *
 * The card dialog answers "what about this name?" in a modal over the board,
 * which is right for a quick look and wrong for the drill: a modal cannot be
 * linked to, cannot be sent to anyone, and has to give every panel the same
 * cramped width. This page is the drill. The dialog stays.
 *
 * THE HALF OF THE PAYLOAD THAT WAS NEVER RENDERED. `ivSurface`, `skewTerm`,
 * `topContracts` and `aggressor` have been built, published, served and
 * cached in every card since the chain leg shipped, and no renderer has ever
 * touched them — 42.8% of the mean card's bytes, drawn by nothing. They are
 * the first four panels here for that reason.
 *
 * IT SPENDS NO VENDOR CALL. Every field on this page is already in
 * `card:<TICKER>`, already allow-listed, already served by /api/flows/card.
 * The chain call it depends on was paid for at 05:15 and thrown away at the
 * renderer. This is the highest-value work available per API call in the
 * whole product, because the API call is zero.
 *
 * THE PANEL LIST IS NOT HERE. It is shared/flows-panels.js, which the browser
 * cannot import (`shared/` is in .assetsignore and is never served), so each
 * panel's question is emitted into a data-question attribute and read back
 * out of the DOM. See that file for why one list beats three.
 */
export function tickerPage({ username = "" } = {}) {
  /* THIS SENTENCE IS THE MOST-READ PROSE ON THE PAGE and it used to be a
     changelog entry: "including the four panels the card has published since
     the chain leg shipped and nothing has drawn". Those four panels have
     been drawn since the day that sentence was written — ivSurface, skewTerm,
     topContracts and aggressor all have entries in the ticker's draw table —
     so the lede described the implementation to its author, inaccurately, and
     did it again as the page's <meta name="description">. What a reader wants
     from a lede is what the page will tell them about the NAME. */
  const lede = "One name and its whole option book: where dealer gamma sits " +
    "and what flips it, what the chain is charging across strikes and " +
    "expiries, which contracts carry the volume, and how far the price is " +
    "from every level that matters — all of it read off the card the pipeline " +
    "published this morning, with no vendor call made by this page.";

  /* Emitted from the registry rather than hand-written, unlike the card
     dialog's ten <section> blocks above. Every id, title, question and span
     comes from the one array, so adding a panel is a one-line edit that the
     markup, the drawer table and the pipeline's shed order all pick up. */
  const panels = TICKER_PANELS.map((p) => `
  <section class="fc-panel ft-panel${p.span === 2 ? " is-wide" : ""}"
           data-panel="${escapeHTML(p.key)}" data-question="${escapeHTML(p.question)}"
           aria-labelledby="${p.id}H">
    <h3 id="${p.id}H"><span class="ft-panel-t">${p.title}</span>
      <button type="button" class="ft-zoom-open" data-panel="${escapeHTML(p.key)}"
              aria-label="Enlarge: ${escapeHTML(p.title)}">&#10529;</button></h3>
    <div id="${p.id}"></div>
  </section>`).join("");

  return `${head("Flows — Ticker", lede)}
${shell("Ticker", "Options-flow intelligence", "ticker", username, `
  <div class="flows-status" id="ftStatus" role="status">Loading the name…</div>
  <p class="flows-stale fc-staleband" id="ftStale" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <header class="ft-head" id="ftHead" hidden>
    <h2 id="ftTicker" tabindex="-1">&nbsp;</h2>
    <span class="fc-score" id="ftScore"></span>
    <span class="fc-meta" id="ftConv"></span>
    <span class="fc-meta" id="ftRegime"></span>
    <span class="fc-meta" id="ftDates"></span>
    <!-- THE PRICE IS IN THE HEADER NOW, AS CHIPS, AND THIS SPAN IS GONE.

         It used to read: "THE PRICE, WHICH THIS PAGE NEVER SHOWED ... spot,
         today's change, ATR, the gamma flip and its distance are all already
         on the card this page holds; they cost no vendor call and no payload
         change." Every word of that was right, and the span it justified was
         emitted, hidden, styled by four CSS rules, and written to by NOTHING —
         no JavaScript in the repository ever referenced ftQuote. A promise in
         a comment over an element no controller fills is a claim that the
         feature exists.

         paintIdentity builds ftPrice, ftChgPct, ftSide, ftD1, ftRank and now
         ftFlip through the one idChip() helper, so there is one way a header
         reading is drawn rather than a chip mechanism and a quote-bar
         mechanism that would drift apart. The header is persistent either way:
         flows-ticker.js re-parents it into .ft-bar, sticky at the site's
         4.4rem topbar clearance, so it stays on screen for the whole scroll.
         (.ft-head carries a sticky rule of its own, but only as the fallback
         for the frames before that re-parenting — see the note in
         assets/css/flows.css. It is not what makes this stay.) -->
    <!-- ONCE YOU WERE ON A NAME THERE WAS NO WAY OFF IT. The index below
         renders only when ?t= is absent, so comparing two names meant editing
         the URL by hand. This is the way back to it, and it is in the header
         because that is where the name it would replace is. -->
    <button type="button" class="ft-switch" id="ftSwitch" hidden>Switch name</button>
  </header>

  <!-- THE INDEX, not an error state. With no ?t= this page is the list of
       every name the board published, which is the only place in the section
       that offers one. -->
  <section class="ft-picker" id="ftPicker" hidden aria-labelledby="ftPickerH">
    <h2 id="ftPickerH">Every name on today’s board</h2>
    <!-- Only rendered when the picker was opened FROM a name: with no ?t= at
         all there is nothing to go back to, and a dead "back" control is
         worse than none. -->
    <button type="button" class="ft-backto" id="ftBackTo" hidden></button>
    <p class="fc-note" id="ftPickerNote"></p>
    <div class="flows-tablewrap" tabindex="0" role="region"
         aria-label="Board names">
      <table class="flows-table" id="ftPickerTable">
        <thead><tr>
          <th scope="col">Ticker</th>
          <th scope="col">Side</th>
          <th scope="col" class="c-num">Rank</th>
          <th scope="col" class="c-num">Score</th>
        </tr></thead>
        <tbody id="ftPickerBody"></tbody>
      </table>
    </div>
  </section>

  <div class="ft-grid" id="ftGrid" hidden>${panels}
  </div>

  <p class="flows-foot" id="ftFoot"></p>
`)}
<dialog id="ftZoom" class="ft-zoom" aria-labelledby="ftZoomH">
  <div class="ft-zoom-inner">
    <section class="fc-panel" id="ftZoomPanel">
      <h3 id="ftZoomH"><span class="ft-panel-t"></span>
        <button type="button" class="ft-zoom-close" id="ftZoomClose"
                aria-label="Close">&times;</button></h3>
      <div id="ftZoomHost"></div>
    </section>
  </div>
</dialog>
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-panels.js")}" defer></script>
<script src="${v("/assets/js/flows-ticker.js")}" defer></script>
</body>
</html>`;
}


/* ---------- the track record ----------------------------------- */

/**
 * HAS THIS SIGNAL EVER BEEN RIGHT?
 *
 * The product asserted a 51-52% hit rate in a footer for months and measured
 * nothing, because the store could not hold a past. flows_payload was keyed by
 * id alone and every morning `board:long` overwrote `board:long`, so by the
 * time any forward return existed there was no record of what had been claimed.
 * A signal you cannot score is a claim, not a measurement.
 *
 * Each session's board is now retained under a dated key and scored against
 * later closes by the pipeline, which is where every other heavy computation
 * on this site already lives.
 *
 * THIS PAGE STARTS EMPTY AND IT SAYS SO. Retention begins with the first run
 * after deploy; nothing can be scored at the shortest horizon until that many
 * sessions have passed. A track record that appeared fully formed on the day
 * it shipped would be a backtest wearing a live-results label, which is the
 * single most misleading object in this field.
 */
export function historyPage({ username = "" } = {}) {
  const lede = "What the board said, and what happened next.";
  return `${head("Flows \u2014 Track record", lede)}
${shell("Track Record", "Options-flow intelligence", "history", username, `
  <div class="flows-status" id="recStatus" role="status">Loading the record\u2026</div>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <section class="rec-block" aria-labelledby="recCurveH">
    <h2 id="recCurveH">Forward return by horizon</h2>
    <p class="rec-note" id="recCurveNote"></p>
    <div id="recCurve"></div>
  </section>

  <section class="rec-block" aria-labelledby="recTableH">
    <h2 id="recTableH">Every scored session</h2>
    <div class="flows-tablewrap" id="recTableWrap" tabindex="0" role="region"
         aria-label="Scored sessions" hidden>
      <table class="flows-table rec-table">
        <caption class="flows-caption">
          One row per published session, once enough sessions have passed to
          measure it. Return is the equal-weighted price return of that
          session&#39;s names, long side minus short side, from the close the
          board was published at. Not a strategy: no costs, no slippage, no
          borrow, and no position sizing.
        </caption>
        <thead>
          <tr>
            <th scope="col">Session</th>
            <th scope="col" class="c-num">Long</th>
            <th scope="col" class="c-num">Short</th>
            <th scope="col" class="c-num"><abbr title="Equal-weighted price return of the long names minus that of the short names, over the stated horizon">L&#8722;S</abbr></th>
            <th scope="col" class="c-num"><abbr title="Share of published names whose price moved in the direction the board leaned">Hit</abbr></th>
            <th scope="col" class="c-num"><abbr title="Names that could not be scored because they left the screened universe before the horizon closed. A high number makes the row&#39;s return unreliable, not merely noisy">Lost</abbr></th>
          </tr>
        </thead>
        <tbody id="recBody"></tbody>
      </table>
    </div>
  </section>

  <section class="rec-block" aria-labelledby="recFeatH">
    <h2 id="recFeatH">What actually predicted, feature by feature</h2>
    <div class="flows-tablewrap" id="recFeatWrap" tabindex="0" role="region"
         aria-label="Feature information coefficients" hidden>
      <table class="flows-table rec-table rec-feat">
        <caption class="flows-caption">
          The rank correlation of each archived board column with the forward
          price return, pooled across every retained session and both sides.
          This is the research loop, in public: the features the score is
          built from, measured against what happened next, with the sample
          they were measured on. An IC near zero is a finding too.
        </caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col" class="c-num"><abbr title="Spearman information coefficient: rank correlation with the forward price return at the stated horizon">IC</abbr></th>
            <th scope="col" class="c-num"><abbr title="Measured feature-return pairs. Consecutive sessions overlap, so the effective sample is far smaller">n</abbr></th>
          </tr>
        </thead>
        <tbody id="recFeatBody"></tbody>
      </table>
    </div>
    <div id="recFeatNotes" class="rec-notes"></div>
  </section>

  <p class="flows-foot">
    These are PRICE returns of an equal-weighted basket, gross of everything:
    no commissions, no slippage, no short borrow, no dividends. They are the
    arithmetic of published closes and nothing more, which is the only claim
    this page can make without inventing a parameter. A handful of sessions is
    not evidence of anything; the sample size is stated because it is the most
    important number here.
  </p>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-history.js")}" defer></script>
</body>
</html>`;
}


function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/* ---------- the political disclosures --------------------------- */

/**
 * WHO DISCLOSED THE LARGEST PURCHASES.
 *
 * A SEPARATE RAIL GROUP, AND THAT IS THE ARGUMENT. Every other gated page
 * answers a question about a session: what was bought today, what is unusual
 * today, what reports this week. This one cannot. The STOCK Act allows 45
 * days between a transaction and its disclosure and late filers routinely
 * exceed 100, so the newest row here describes something that happened
 * closer to two months ago than to this morning. Filing it under "Session"
 * would put a two-month-old fact beside today's tape under one heading and
 * invite the reading the whole page is built to refuse. It sits under
 * "Disclosures" instead, next to nothing that claims to be current.
 *
 * FOUR PANELS, ONE SHELL EACH. Every heading and every accessible name is
 * emitted here; every row, bar and band is filled by flows-political.js from
 * a payload this document cannot see. A panel that stays empty says WHICH of
 * the three silences it is in — the key was never published, the request did
 * not come back, or the window was read and held nothing — because only the
 * last of those is a fact about politicians.
 *
 * THE HOLDER PANEL IS EXPECTED TO BE UNAVAILABLE. The vendor marks
 * /politician-portfolios/holders as enterprise-only, so on this key it
 * answers 403. The panel ships anyway: an empty shell that names the refusal
 * is honest, and it costs one line the day the entitlement changes.
 */
export function politicalPage({ username = "" } = {}) {
  const lede = "Who disclosed the largest purchases, and in what — ranked by " +
    "size, with the range each filing actually stated drawn across it.";
  return `${head("Flows — Political", lede)}
${shell("Political Disclosures", "Options-flow intelligence", "political", username, `
  <div class="flows-status" id="plStatus" role="status">Loading the disclosure window…</div>
  <p class="flows-stale" id="plSource" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <!-- THE LAG, ABOVE THE FOLD AND NOT IN THE FOOTER. Everything below is
       weeks old by construction. A reader who scrolls to a ranking without
       having read that will read it as news, so it is said before the first
       number rather than after the last. -->
  <p class="pl-lede-warn">
    Every row on this page is a statutory disclosure, not a trade seen on a
    tape. Filing is late by law and later in practice: the STOCK Act allows
    45 days and late filers routinely exceed 100. Each row carries the days
    between its transaction and its filing, and each ranked total carries the
    median lag of the filings behind it. This page ranks what has been
    <em>disclosed</em>, which is never the same question as what is being
    done now.
  </p>

  <section class="fc-panel is-wide" id="plBuyersPanel" hidden>
    <h2 class="fc-panel-h">Who disclosed the largest purchases</h2>
    <div id="plBuyers"></div>
    <p class="fc-note" id="plBuyersNote"></p>
  </section>

  <section class="fc-panel is-wide" id="plAssetsPanel" hidden>
    <h2 class="fc-panel-h">What was bought the most</h2>
    <div id="plAssets"></div>
    <p class="fc-note" id="plAssetsNote"></p>
  </section>

  <section class="fc-panel is-wide" id="plRecentPanel" hidden>
    <h2 class="fc-panel-h">Newest disclosures</h2>
    <div id="plRecent"></div>
    <p class="fc-note" id="plRecentNote"></p>
  </section>

  <section class="fc-panel" id="plHoldersPanel" hidden>
    <h2 class="fc-panel-h">Holdings in the board&#39;s names</h2>
    <div id="plHolders"></div>
    <p class="fc-note" id="plHoldersNote"></p>
  </section>

  <div class="flows-foot" id="plFoot"></div>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-political.js")}" defer></script>
</body>
</html>`;
}

/* ---------- the strategy tester -------------------------------- */

/**
 * BUILD A POSITION FROM REAL CONTRACTS AND SEE WHAT IT PAYS.
 *
 * THE PAYOFF LINE IS THE ONE READING ON THIS PAGE THAT NEEDS NOTHING. At
 * expiry an option is worth its intrinsic value, which is arithmetic on the
 * strike and the underlying and contains no rate, no dividend, no volatility
 * and no distribution. Everything else on the page is either a sum of quoted
 * numbers or a labelled convention, and the difference is stated wherever a
 * reader might mistake one for the other.
 *
 * THE DATE SLIDER WAS THE DESIGN DECISION AND IT WENT TO TAYLOR. Two engines
 * could draw a curve between today and expiry:
 *
 *   BLACK-SCHOLES re-prices every leg at every point, which is what a
 *   textbook does — and it needs a risk-free rate and a dividend yield.
 *   Those are the exact two free parameters shared/flows-chain.js and
 *   shared/flows-premium.js refuse by name, and the refusal is the reason
 *   this section has never published an assignment probability or a fair
 *   value. Adopting them here to draw a nicer curve would overturn the
 *   discipline of the whole product for a line.
 *
 *   A TAYLOR EXPANSION in the vendor's own quoted greeks needs nothing that
 *   is not on the wire: delta, gamma, theta and vega come per contract on the
 *   endpoint this page already reads. It is a LOCAL approximation and it is
 *   least accurate exactly where a reader looks hardest — near the strike,
 *   near expiry — so the page says so beside the curve rather than in a
 *   footnote, and the slider refuses to run past the nearest leg's expiry,
 *   where an expansion around today's greeks stops describing anything at all.
 *
 * Taylor wins because its inaccuracy is STATED and bounded, where the
 * alternative's is two invented numbers a reader cannot see. That choice is
 * on the page in the reader's own words, not only here.
 *
 * WHAT IS REFUSED IS NAMED ON THE PAGE RATHER THAN OMITTED. Buying power
 * reduction is broker-specific and appears nowhere in 28,755 lines of the
 * vendor's spec; conditional value at risk needs a distribution nobody
 * quoted. A calculator that silently lacks a reading its competitors show
 * reads as an oversight. One that says which readings it will not invent, and
 * why, is making an argument — and that argument is this product.
 */
/**
 * /flows/ask — the briefing, and a question box over it.
 *
 * THE FRONT DOOR, AND THAT IS WHY THE RAIL LISTS IT FIRST. Every other
 * route answers a question a reader already knew to ask. This one answers
 * the question they arrive with — what happened, what is happening, what
 * is already scheduled — before they type anything, and only then offers
 * the box.
 *
 * THE SHELL IS ONE ELEMENT ON PURPOSE. assets/js/flows-ask.js:32 states
 * the contract: `#askApp` is the container, `#askStatus` and `#askFoot`
 * are filled if present and created if not. Rendering a frame of headings
 * here that the script then re-fills would put the same structure in two
 * files, and the pair drift apart the first time one is edited — which is
 * the argument every other page in this file already makes for its own
 * skeleton. The lede is prose the script never touches, so it stays.
 *
 * NO SKELETON ROWS. A page that painted em dashes while the fetch is in
 * flight would be showing a set of readings that came back blank, which
 * is a different and false claim from "this has not loaded yet".
 */
export function askPage({ username = "" } = {}) {
  /* TWO LEDES, AND ONLY THE SHORT ONE IS PRINTED. `head()` needs a
     description for the document and for anything that quotes the page;
     the reader in front of it needs one line and then the readings. The
     long form said in six lines what the short one says in one, and it
     stood between every visit and the first number on the page — which is
     what the owner meant by too much text.

     NOTHING IS LOST: the guarantee the long form spelled out is stated
     where it can be acted on, in the question panel's own note, beside
     the box it constrains. A promise about a model belongs next to the
     model, not in a preamble a reader scrolls past to reach the data. */
  const summary = "What the session says, what changed to get here, and what is " +
    "already on the calendar before the next one — assembled from the same " +
    "published readings every other page here draws. Ask a question and the " +
    "wording may be a model's; the figures never are. Anything it writes that " +
    "is not already in the measurements it was handed is refused, and the " +
    "measured reading is served instead.";
  const lede = "Yesterday, today, and what is already scheduled — from the readings " +
    "this site has published.";
  return `${head("Flows — Ask", summary)}
${shell("Ask", "Options-flow intelligence", "ask", username, `
  <div class="flows-status" id="askStatus" role="status">Reading the session’s briefing…</div>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <div id="askApp"></div>
  <div id="askFoot"></div>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-ask.js")}" defer></script>
</body>
</html>`;
}

export function strategyPage({ username = "" } = {}) {
  const lede = "Pick a name, build a position out of the contracts that are " +
    "actually listed, and see what it pays at expiry. Every quote is the " +
    "vendor's; every sum is arithmetic on those quotes; every extrapolation " +
    "carries the name of the assumption it rests on.";
  return `${head("Flows — Strategy tester", lede)}
${shell("Strategy Tester", "Options-flow intelligence", "strategy", username, `
  <div class="flows-status" id="sgStatus" role="status">Enter a symbol to begin.</div>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <form class="sg-entry" id="sgEntry" autocomplete="off">
    <label for="sgTicker">Symbol</label>
    <div class="sg-entry__row">
      <input id="sgTicker" name="ticker" type="text" inputmode="latin"
             autocapitalize="characters" autocorrect="off" spellcheck="false"
             placeholder="NVDA" aria-describedby="sgEntryHelp">
      <button type="submit" class="sg-load">Load</button>
      <!-- RE-PRICING IS A SEPARATE BUTTON FROM LOADING because the two spend
           different amounts of a shared vendor quota, and a reader who has
           spent ten minutes building a four-leg position should be able to
           refresh the price it is measured against without the page deciding
           to do it for them. -->
      <button type="button" class="sg-reprice" id="sgReprice" hidden>Re-price</button>
    </div>
    <p class="desk-help" id="sgEntryHelp">
      One listed US symbol. The book is read one expiry at a time — that is the
      read this page can afford against a metered vendor key on a request path.
    </p>
  </form>

  <section class="fc-panel sg-panel" id="sgContextPanel" hidden aria-labelledby="sgContextH">
    <h2 class="fc-panel-h" id="sgContextH">What this name is trading at</h2>
    <div id="sgContext"></div>
    <p class="fc-note" id="sgContextNote"></p>
  </section>

  <section class="fc-panel sg-panel" id="sgChainPanel" hidden aria-labelledby="sgChainH">
    <h2 class="fc-panel-h" id="sgChainH">The book, one expiry at a time</h2>
    <div class="sg-controls">
      <span class="sg-field">
        <label for="sgExpiry">Expiry</label>
        <select id="sgExpiry"></select>
      </span>
      <span class="sg-field">
        <label for="sgWindow">Strikes within</label>
        <select id="sgWindow">
          <option value="0.1">10% of spot</option>
          <option value="0.25" selected>25% of spot</option>
          <option value="0.5">50% of spot</option>
          <option value="0">Every listed strike</option>
        </select>
      </span>
    </div>
    <!-- A DIV RATHER THAN A PARAGRAPH because FlowsUI.emptyState() returns a
         <p>, and the three silences this note carries are emitted through that
         shared primitive so the stylesheet can tell them apart. A <p> inside a
         <p> is invalid markup even when the DOM will hold it. -->
    <div class="fc-note" id="sgChainNote"></div>
    <div class="flows-tablewrap sg-chainwrap" id="sgChainWrap" tabindex="0" role="region"
         aria-label="Listed contracts at the selected expiry" hidden>
      <table class="flows-table sg-chain">
        <caption class="flows-caption">
          Every contract the vendor lists at this expiry, unfiltered. The premium
          desk screens this same endpoint down to what is sellable; this page does
          not, because a long in-the-money call is a position a reader builds and
          the desk&#39;s universe cannot express it. A greek the vendor did not send
          is an em dash — the vendor marks all five nullable and its own example
          carries a row with none of them.
        </caption>
        <thead>
          <tr>
            <th scope="col" class="c-num">Bid</th>
            <th scope="col" class="c-num">Ask</th>
            <th scope="col" class="c-num"><abbr title="The vendor's implied volatility for this contract, as a fraction. The percent-or-fraction convention is decided once from the whole expiry's median, never per contract">IV</abbr></th>
            <th scope="col" class="c-num"><abbr title="Delta as quoted, per share">&#916;</abbr></th>
            <th scope="col" class="c-num">Call</th>
            <th scope="col" class="c-num sg-k">Strike</th>
            <th scope="col" class="c-num">Put</th>
            <th scope="col" class="c-num"><abbr title="Delta as quoted, per share">&#916;</abbr></th>
            <th scope="col" class="c-num"><abbr title="The vendor's implied volatility for this contract, as a fraction">IV</abbr></th>
            <th scope="col" class="c-num">Bid</th>
            <th scope="col" class="c-num">Ask</th>
          </tr>
        </thead>
        <tbody id="sgChainBody"></tbody>
      </table>
    </div>
  </section>

  <section class="fc-panel sg-panel" id="sgLegsPanel" hidden aria-labelledby="sgLegsH">
    <h2 class="fc-panel-h" id="sgLegsH">The position</h2>
    <div class="sg-controls">
      <span class="sg-field">
        <label for="sgBasis">Price legs at</label>
        <select id="sgBasis">
          <option value="mid">The mid</option>
          <option value="marketable">Marketable — ask on buys, bid on sells</option>
        </select>
      </span>
      <button type="button" class="sg-clear" id="sgClear">Clear position</button>
    </div>
    <div class="flows-tablewrap" id="sgLegsWrap" tabindex="0" role="region"
         aria-label="Position legs" hidden>
      <table class="flows-table sg-legs">
        <caption class="flows-caption">
          One row per leg. The mid is not a price anyone is obliged to trade at;
          the marketable basis is what crossing the spread on every leg actually
          costs. Switching between them moves the whole diagram, which is the
          honest way to show what a spread is worth.
        </caption>
        <thead>
          <tr>
            <th scope="col">Leg</th>
            <th scope="col" class="c-num">Qty</th>
            <th scope="col" class="c-num">Bid</th>
            <th scope="col" class="c-num">Ask</th>
            <th scope="col" class="c-num">Priced at</th>
            <th scope="col" class="c-num"><abbr title="Delta as quoted, per share">&#916;</abbr></th>
            <th scope="col" class="c-num"><abbr title="Gamma as quoted: the change in delta per one dollar of underlying">&#915;</abbr></th>
            <th scope="col" class="c-num"><abbr title="Theta as quoted, taken as a one-day derivative of the contract's price">&#920;</abbr></th>
            <th scope="col" class="c-num"><abbr title="Vega as quoted, taken as the change in the contract's price for a one-point move in implied volatility">V</abbr></th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody id="sgLegsBody"></tbody>
      </table>
    </div>
    <div class="fc-note" id="sgLegsNote"></div>
  </section>

  <section class="fc-panel sg-panel" id="sgReadPanel" hidden aria-labelledby="sgReadH">
    <h2 class="fc-panel-h" id="sgReadH">What it costs, what it can pay, what it is exposed to</h2>
    <div id="sgReadings"></div>
    <p class="fc-note" id="sgReadNote"></p>
  </section>

  <section class="fc-panel sg-panel" id="sgPlotPanel" hidden aria-labelledby="sgPlotH">
    <h2 class="fc-panel-h" id="sgPlotH">Payoff at expiry</h2>
    <div id="sgPlot"></div>
    <p class="fc-note" id="sgPlotNote"></p>
  </section>

  <section class="fc-panel sg-panel" id="sgScenePanel" hidden aria-labelledby="sgSceneH">
    <h2 class="fc-panel-h" id="sgSceneH">One scenario, priced two ways</h2>
    <div class="sg-controls">
      <span class="sg-field">
        <label for="sgScenePx">Underlying at</label>
        <input id="sgScenePx" type="text" inputmode="decimal" autocomplete="off" spellcheck="false">
      </span>
      <span class="sg-field">
        <label for="sgSceneDays">Days from now</label>
        <input id="sgSceneDays" type="range" min="0" max="0" step="1" value="0">
      </span>
    </div>
    <div id="sgScene"></div>
    <p class="fc-note" id="sgSceneNote"></p>
  </section>

  <!-- STATIC, AND IN THE DOCUMENT RATHER THAN IN THE RENDERER. These are the
       claims the page declines to make; they are true before any fetch, they
       are true if every fetch fails, and a reader who arrives with JavaScript
       still parsing should see them. A refusal that only appears once data
       lands is a refusal that can disappear with a bug. -->
  <section class="fc-panel sg-panel" id="sgRefusePanel" aria-labelledby="sgRefuseH">
    <h2 class="fc-panel-h" id="sgRefuseH">What this page will not tell you</h2>
    <dl class="sg-refuse">
      <dt>Buying power reduction</dt>
      <dd>
        <strong>Refused.</strong> It is a broker&#39;s number, not the market&#39;s:
        the same short put reduces buying power by different amounts at two
        brokers on the same afternoon, and by different amounts again in a
        portfolio-margin account. Nothing in the vendor&#39;s specification
        mentions buying power, margin or collateral anywhere in its 28,755
        lines. Publishing one would be inventing a figure about your money.
      </dd>
      <dt>Conditional value at risk</dt>
      <dd>
        <strong>Refused.</strong> A tail expectation is an average over a
        distribution, and no distribution is quoted anywhere on this page. It
        would need a volatility surface, a drift and a horizon, none of which
        the vendor supplies and all of which would be chosen here. The
        distribution-free statement this page can make instead is the maximum
        loss at expiry, which is below and is exact.
      </dd>
      <dt>Beta-weighted delta</dt>
      <dd>
        <strong>Published, with its terms stated.</strong> It is not delta
        times beta. It is delta &#215; beta &#215; (this stock&#39;s price &#247; the
        index&#39;s price), so it needs a reference index and that index&#39;s live
        price, and it is a different number against a different index. Both
        are named and printed in the readings above rather than assumed, and
        when either is missing the reading is an em dash — never a zero.
      </dd>
      <dt>A share leg</dt>
      <dd>
        <strong>Not offered yet.</strong> A covered call or a collar cannot be
        expressed here, because this page builds positions out of listed
        contracts only. Said out loud rather than left for you to discover by
        looking for a control that is not there.
      </dd>
    </dl>
  </section>

  <p class="flows-foot">
    <span class="flows-foot-p">
      THE EXPIRY LINE IS MODEL-FREE. At expiry an option is worth its intrinsic
      value, so the payoff diagram&#39;s solid line is arithmetic on the strikes,
      the quoted premiums and the underlying &#8212; it contains no volatility,
      no interest rate, no dividend and no distribution. The maximum profit,
      the maximum loss and the breakevens are read off that same line and are
      exact to the quotes they were built from. A leg with unbounded loss
      reports <em>unbounded</em> rather than a large number, because there is
      no number there to report.
    </span>
    <span class="flows-foot-p">
      THE PROJECTED LINE IS A TAYLOR EXPANSION IN THE VENDOR&#39;S OWN GREEKS,
      and that is a stated convention, not a measurement. Each leg is moved by
      delta and gamma in the underlying, by theta in time and by vega in
      implied volatility, all as quoted for that contract. It is a local
      approximation: it is least accurate exactly where you will look hardest,
      near a strike and near expiry, and it degrades as the horizon lengthens.
      The slider therefore stops at the nearest leg&#39;s expiry, where an
      expansion around today&#39;s greeks has stopped describing anything, and the
      exact line takes over. The alternative &#8212; re-pricing every leg with
      Black-Scholes &#8212; would need a risk-free rate and a dividend yield, the
      two free parameters this codebase refuses everywhere else, so it was not
      taken.
    </span>
    <span class="flows-foot-p">
      MONTHLY DECAY IS THIRTY TIMES A ONE-DAY DERIVATIVE, which is a
      convention in the same sense the premium desk&#39;s annualised yield is one:
      theta is convex in time and thirty days of it is not thirty of today&#39;s.
      It is offered because it is the number a reader is comparing against a
      position&#39;s cost, and it is labelled because nobody earns it. Days are
      calendar days, counted from the session the quotes were read on.
    </span>
    <span class="flows-foot-p">
      Options can lose their entire premium, and a short call&#39;s loss has no
      upper bound. This is a calculator, not advice.
    </span>
  </p>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-ui.js")}" defer></script>
<script src="${v("/assets/js/flows-strategy.js")}" defer></script>
</body>
</html>`;
}

export const FLOWS_PAGES = {
  loginPage, overviewPage, sidePage, watchPage, marketPage, historyPage, deskPage,
  politicalPage,
  tickerPage, unusualPage, eventsPage, trackPage, strategyPage, askPage, ASSET_VERSION,
};
