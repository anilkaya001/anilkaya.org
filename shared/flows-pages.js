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

export const ASSET_VERSION = "59";

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

/* ---------- board ---------------------------------------------- */

export function boardPage({ username = "" } = {}) {
  return `${head("Flows — Board", "Ranked options-flow candidates.")}
<body class="flows-body">
${topbar(true)}
<main class="flows-main">
  <header class="flows-head">
    <div>
      <p class="flows-kicker">Options-flow intelligence</p>
      <h1>Flows Board</h1>
    </div>
    <div class="flows-session">
      <span class="flows-user">${escapeHTML(username)}</span>
      <form method="POST" action="/flows/logout"><button type="submit" class="flows-signout">Sign out</button></form>
    </div>
  </header>

  <nav class="flows-subnav" aria-label="Flows sections">
    <a href="/flows/" class="is-active" aria-current="page">Board</a>
    <a href="/flows/desk/">Premium desk</a>
  </nav>

  <div class="flows-status" id="flowsStatus" role="status">Loading the latest session…</div>
  <p class="flows-stale" id="flowsStale" role="status" hidden></p>

  <div class="flows-controls">
    <div class="flows-sides" role="group" aria-label="Board side">
      <button type="button" class="flows-side is-on" data-side="long" aria-pressed="true">Long</button>
      <button type="button" class="flows-side" data-side="short" aria-pressed="false">Short</button>
    </div>
    <div class="flows-views" role="group" aria-label="Layout">
      <button type="button" class="flows-view is-on" data-view="deck" aria-pressed="true">Deck</button>
      <button type="button" class="flows-view" data-view="table" aria-pressed="false">Table</button>
    </div>
  </div>

  <!-- One payload, two renderers, exactly one mounted at a time. The deck is
       the default because the table's ten columns are wider than any phone. -->
  <div class="flows-deck" id="flowsDeck" role="list" aria-label="Ranked candidates"></div>

  <!-- tabindex + role: the table is wider than any phone viewport, so this
       wrapper always scrolls horizontally. Without a tabindex a keyboard-only
       user tabs straight past it and seven of the ten columns are unreachable;
       without role and a name it is not announced as a scrollable region. -->
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
        </tr>
      </thead>
      <tbody id="flowsBody"></tbody>
    </table>
  </div>

  <p class="flows-foot">
    Scores are a ranked attention signal, not a return forecast. At the information
    coefficient this class of signal supports, expect a hit rate near 51&ndash;52%.
  </p>
</main>
<dialog id="flowsCard" class="fc" aria-labelledby="fcTitle">
  <article class="fc-inner">
    <header class="fc-head">
      <div class="fc-id">
        <h2 id="fcTitle" tabindex="-1">&nbsp;</h2>
        <span class="fc-score" id="fcScore"></span>
        <span class="fc-meta" id="fcConv"></span>
        <span class="fc-meta" id="fcRegime"></span>
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
</dialog>
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-board.js")}" defer></script>
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
<body class="flows-body">
${topbar(true)}
<main class="flows-main flows-desk">
  <header class="flows-head">
    <div>
      <p class="flows-kicker">Options-flow intelligence</p>
      <h1>Premium Desk</h1>
    </div>
    <div class="flows-session">
      <span class="flows-user">${escapeHTML(username)}</span>
      <form method="POST" action="/flows/logout"><button type="submit" class="flows-signout">Sign out</button></form>
    </div>
  </header>

  <nav class="flows-subnav" aria-label="Flows sections">
    <a href="/flows/">Board</a>
    <a href="/flows/desk/" class="is-active" aria-current="page">Premium desk</a>
  </nav>

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
      <label for="deskStrategy">Sell</label>
      <select id="deskStrategy">
        <option value="both">Puts and calls</option>
        <option value="csp">Cash-secured puts</option>
        <option value="cc">Covered calls</option>
      </select>
      <label for="deskRank">Rank by</label>
      <select id="deskRank">
        <option value="annualized">Annualised yield</option>
        <option value="premium">Premium received</option>
        <option value="yieldOnCollateral">Yield on collateral</option>
        <option value="cushionSigmas">Cushion</option>
      </select>
    </div>
  </div>

  <div class="flows-status" id="deskStatus" role="status">Add a symbol to begin.</div>

  <div class="flows-tablewrap" id="deskTableWrap" tabindex="0" role="region"
       aria-label="Sellable contracts" hidden>
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

  <p class="flows-foot" id="deskFoot"></p>

  <p class="flows-foot">
    Premium is quoted at the bid and every number here is arithmetic on a quote.
    Nothing on this page estimates a probability of assignment: that needs a
    distribution, which needs a risk-free rate and a dividend yield, and this
    desk does not publish numbers that depend on parameters it invented.
    Selling options has unbounded loss on the call side and equity-sized loss
    on the put side. This is a screen, not advice.
  </p>
</main>
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-desk.js")}" defer></script>
</body>
</html>`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export const FLOWS_PAGES = { loginPage, boardPage, deskPage, ASSET_VERSION };
