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

export const ASSET_VERSION = "77";

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
    const badge = key === "long" || key === "short" || key === "watch"
      ? `<span class="rail-count" data-rail-count="${key}" hidden></span>` : "";
    return `<a href="${href}"${on ? ' class="is-on" aria-current="page"' : ""}>` +
      `<span class="rail-label">${label}</span>${badge}</a>`;
  };
  return `
<nav class="flows-rail" aria-label="Flows">
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
  </div>
  <p class="rail-group" id="railDesk">Desk</p>
  <div class="rail-items" role="group" aria-labelledby="railDesk">
    ${item("/flows/desk/", "Premium desk", "desk")}
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
</main>`;

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

/* ---------- overview: both tails at once ------------------------ */

/**
 * The landing page.
 *
 * It used to be the board with a LONG/SHORT toggle, which is two problems in
 * one control: it hides half the session behind a click, and a toggle has no
 * URL, so a reader cannot link to, bookmark or send the bearish side.
 *
 * The main section now shows BOTH POLES AT ONCE over a fixed score axis, and
 * the dead band is drawn rather than described. That band is the reason the
 * page is usually short — 17 of 24 names landed inside it on the session now
 * live — and a reader who cannot see it reads a three-name page as a broken
 * one. Drawing it turns "why is this empty" into "most of the market is not
 * leaning, and here is how much of it".
 *
 * The full ranked lists move to their own routes, where they are pages rather
 * than a state of this one.
 */
export function overviewPage({ username = "" } = {}) {
  return `${head("Flows — Overview", "Where the session leans, both tails at once.")}
${shell("Session Overview", "Options-flow intelligence", "overview", username, `
  <div class="flows-status" id="flowsStatus" role="status">Loading the latest session…</div>
  <p class="flows-stale" id="flowsStale" role="status" hidden></p>

  <!-- THE SPINE. A fixed -100..+100 axis with the dead band hatched, so the
       band that excluded most of the market is visible rather than inferred. -->
  <section class="spine" aria-labelledby="spineH">
    <h2 id="spineH" class="spine-h">Where the session leans</h2>
    <div id="spinePlot"></div>
  </section>

  <div class="poles">
    <section class="pole is-bull" aria-labelledby="bullH">
      <header class="pole-head">
        <h2 id="bullH">Most bullish-leaning</h2>
        <a href="/flows/long/" class="pole-all" id="bullAll">All bullish</a>
      </header>
      <div class="pole-deck" id="bullDeck" role="list" aria-labelledby="bullH"></div>
    </section>

    <section class="pole is-bear" aria-labelledby="bearH">
      <header class="pole-head">
        <h2 id="bearH">Most bearish-leaning</h2>
        <a href="/flows/short/" class="pole-all" id="bearAll">All bearish</a>
      </header>
      <div class="pole-deck" id="bearDeck" role="list" aria-labelledby="bearH"></div>
    </section>
  </div>

  <p class="flows-foot">
    Scores are a ranked attention signal, not a return forecast. At the
    information coefficient this class of signal supports, expect a hit rate near
    51&ndash;52%. Names inside the dead band are not published on either side.
  </p>
`)}
${cardDialog()}
<script src="${v("/assets/js/nav.js")}" defer></script>
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

  <p class="flows-foot">
    Scores are a ranked attention signal, not a return forecast. At the
    information coefficient this class of signal supports, expect a hit rate near
    51&ndash;52%.
  </p>
`)}
${cardDialog()}
<script src="${v("/assets/js/nav.js")}" defer></script>
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
    <p class="fc-note">
      Ranked over the whole screened universe, not over the board. Tickers here
      are plain text: a detail card exists only for the names the board went
      deep on, and a link that usually leads nowhere is worse than no link.
    </p>
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
    "Nothing here says who traded, or why.";
  return `${head("Flows — Unusual activity", "Contracts carrying volume far above their own open interest.")}
${shell("Unusual Activity", "Options-flow intelligence", "unusual", username, `
  <div class="flows-status" id="uaStatus" role="status">Loading the feed…</div>
  <p class="flows-stale" id="uaStale" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

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
  const lede = "One name, the whole option book — including the four panels " +
    "the card has published since the chain leg shipped and nothing has drawn.";

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
  </header>

  <!-- THE INDEX, not an error state. With no ?t= this page is the list of
       every name the board published, which is the only place in the section
       that offers one. -->
  <section class="ft-picker" id="ftPicker" hidden aria-labelledby="ftPickerH">
    <h2 id="ftPickerH">Every name on today’s board</h2>
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

export const FLOWS_PAGES = {
  loginPage, overviewPage, sidePage, watchPage, marketPage, historyPage, deskPage,
  tickerPage, unusualPage, eventsPage, trackPage, ASSET_VERSION,
};
