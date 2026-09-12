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

import {
  TICKER_PANELS, TICKER_GROUPS, SENTINEL_KEYS, STATION_SIDE_COUNTS,
} from "./flows-panels.js";

export const ASSET_VERSION = "185";

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

/* ---------- one icon set, drawn once ----------------------------

   THE REPOSITORY HAD NO ICONS AT ALL and the design the section is being
   built to has one on every rail item and in the search field. So this is
   the set, and it is deliberately the smallest thing that can be: 16px
   line glyphs on a 24-unit grid, stroked in currentColor so every one of
   them inherits the state of the element it sits in — an active rail item
   tints its icon by tinting its text, with no second rule.

   INLINE AND NOT A SPRITE FILE. A sprite is a second request on a route
   whose first paint is already the thing being optimised, and these are
   HTML bytes rather than JavaScript ones: they cost no parse, and no
   route's weight ceiling measures them. They are emitted once per page by
   the server that already emits the markup around them.

   `aria-hidden` ON EVERY ONE, WITHOUT EXCEPTION. Each of these sits beside
   its own text label; an icon announced next to the word it duplicates is
   one more thing for a screen reader to read and nothing more to know. */
const ICONS = {
  overview: "M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z",
  ticker: "M4 19V9M9 19V5M14 19v-7M19 19V7",
  unusual: "M12 3v3M12 18v3M3 12h3M18 12h3M7.8 7.8 5.6 5.6M18.4 18.4l-2.2-2.2M16.2 7.8l2.2-2.2M5.6 18.4l2.2-2.2",
  watch: "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
  long: "M4 17 10 11l4 4 6-7M20 8v5M20 8h-5",
  short: "M4 7l6 6 4-4 6 7M20 16v-5M20 16h-5",
  events: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  market: "M3 17l5-6 4 3 4-6 5 4M3 21h18",
  desk: "M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5",
  strategy: "M9 3h6M10 3v6.2L4.8 17.6A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-3.4L14 9.2V3M7.2 14h9.6",
  political: "M3 20h18M5 20V9M9.5 20V9M14.5 20V9M19 20V9M12 3 3 8h18Z",
  ask: "M4 5h16v11H9l-5 4Z M8.6 9.2a3.4 3.4 0 0 1 5.6 2.1c0 1.7-2 2-2 3.2M12.2 17.4h.01",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4.2-4.2",
  bell: "M12 3a6 6 0 0 0-6 6c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6a6 6 0 0 0-6-6ZM10 19a2 2 0 0 0 4 0",
};
const icon = (name) => {
  const d = ICONS[name];
  return d
    ? `<svg class="ic" viewBox="0 0 24 24" width="16" height="16" fill="none" ` +
      `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
      `stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`
    : "";
};

/* THE INITIALS ARE THE READER'S OWN NAME, SHORTENED, AND NOTHING ELSE.

   The design has a round avatar in the corner. There is no profile behind
   it, no photo store and no display name — what the session carries is the
   username the credential was issued for, so that is what it draws: one or
   two letters taken off the name itself. A generated face, a gravatar or a
   stock silhouette would each be a claim about a person this product has
   never been told anything about. */
const initials = (username) => {
  const name = String(username || "").trim();
  if (!name) return "\u2014";
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const said = parts.length >= 2
    ? parts[0].slice(0, 1) + parts[1].slice(0, 1)
    : name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  return escapeHTML(said.toUpperCase() || "\u2014");
};

/* THE TOP BAR CARRIES THE SESSION'S TOOLS ON THE GATED ROUTES ONLY.

   The pill is the site's and is identical on all four sections; what joins
   it here is a search that only means something behind the gate and a name
   that only exists behind it. THE GATE IS THE USERNAME, NOT THE SECTION —
   which is not a distinction I drew until the suite drew it: keyed on
   `active`, the sign-in page rendered a ticker search and an avatar for a
   session that does not exist yet, and referenced a name that is not in
   scope there. `active` still marks the pill; the tools belong to whoever
   is signed in. */
const topbar = (active, username) => `
<header class="topbar">
  <a class="topbar__brand" href="/" aria-label="Home">&#949;</a>
  <nav class="pill" aria-label="Primary">
    <a href="/">Home</a>
    <a href="/articles/">Articles</a>
    <a href="/lab/"><span class="lab-full">Econometrics&nbsp;Lab</span><span class="lab-short">Lab</span></a>
    <a href="/flows/"${active ? ' class="is-active" aria-current="page"' : ""}>Flows</a>
  </nav>${username ? `
  <div class="topbar__tools">
    <!-- A PLAIN GET FORM, WHICH IS THE WHOLE IMPLEMENTATION. It works with
         JavaScript disabled, it works with the back button, and what it
         produces is a bookmarkable URL rather than an in-page state.
         flows-ticker.js already uppercases and validates what arrives in
         ?t=, so nothing here is a second spelling of that rule. -->
    <form class="flows-find" method="GET" action="/flows/ticker/" role="search">
      <label class="visually-hidden" for="flowsFind">Open a ticker page</label>
      ${icon("search")}
      <input class="flows-find-i" id="flowsFind" name="t" type="search"
             autocomplete="off" spellcheck="false" maxlength="10"
             pattern="[A-Za-z][A-Za-z0-9.\\-]{0,9}" placeholder="Search a ticker"
             title="A ticker symbol: a letter, then up to nine letters, digits, dots or dashes.">
    </form>
    <span class="topbar__who" title="Signed in as ${escapeHTML(String(username || ""))}"
          aria-label="Signed in as ${escapeHTML(String(username || ""))}">${initials(username)}</span>
    <!-- THE WAY OUT SITS WITH THE IDENTITY, WHICH IS WHERE A READER LOOKS FOR
         IT, and it is a POST form rather than a link because signing out
         changes state on the server — a GET that ends a session is one
         prefetch away from ending it for a reader who never clicked. -->
    <form method="POST" action="/flows/logout" class="topbar__out">
      <button type="submit" class="flows-signout">Sign out</button>
    </form>
  </div>` : ""}
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
/* NO NAME BLOCK ON THE TICKER ROUTE, AND THE ELEMENT THAT PROMISED ONE IS GONE.

   This function used to emit a hidden `div.rail-stats#ftRail` on that route
   under a comment saying it was "filled by assets/js/flows-ticker.js from the
   card it already holds", with seven rules waiting for it in flows.css.
   Nothing ever wrote to it: grepping the id across assets/ returned this
   emitter, the stylesheet, and no assignment at all — so the route shipped an
   empty hidden box and a block of dead CSS to every reader, and the promise in
   the comment had been false since it was written.

   IT IS DELETED RATHER THAN FILLED, BECAUSE THE READINGS ARE ALREADY PINNED.
   flows-ticker.js re-parents `#ftHead` into `.ft-bar`, which is
   `position: sticky` at `top: 4.4rem`, so the name, the score, the conviction,
   the regime, the spot, the day's move, the side, the overnight delta and the
   distance to the gamma flip all stay on screen for the whole scroll — at
   EVERY viewport, where `.rail-stats` was `display: none` below 60rem. A rail
   copy of those readings would print one population twice, buy a reader
   nothing they could not already see, and spend it on the route with the least
   headroom under tests/flows-weight.mjs. tests/flows-motion.mjs asserts both
   halves are gone: no `#ftRail` in the markup, no `.rail-stats` in the
   stylesheet. */
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
    /* THE ICON IS BEFORE THE LABEL AND CARRIES NO INFORMATION OF ITS OWN.
       It is a landmark for a reader who already knows where they are going —
       which is what a rail is for on the fifth visit — and it is aria-hidden,
       so the label remains the whole of what is announced. */
    return `<a href="${href}"${on ? ' class="is-on" aria-current="page"' : ""}>` +
      `${icon(key)}<span class="rail-label">${label}</span>${badge}</a>`;
  };
  return `
<nav class="flows-rail" aria-label="Flows">
  <!-- TWO GROUPS, WHICH IS THE SHAPE OF THE DESIGN THIS IS BUILT TO, and the
       destinations are this product's own. The reference rail names Scanner,
       Strategies, Volatility and Macro; three of those are this section's
       routes under different words and one of them is not built, so what is
       drawn here is every route that exists and nothing that does not. A rail
       item that leads nowhere is the one thing a rail must never contain.

       THE SPLIT IS BY WHAT A READER IS ASKING, not by how the pipeline is
       organised. The first group is the session and the names inside it: what
       happened, to whom, and where to look next. The second is the market
       around them — the whole tape, the desks that price it, and who
       disclosed what.

       THE ASSISTANT LEADS, AS IT DID. It answers the question a reader
       arrives with rather than one they already knew to ask, so it stays
       first, above both groups. -->
  <div class="rail-items rail-items--lead" role="group" aria-label="Ask">
    ${item("/flows/ask/", "Ask the data", "ask")}
  </div>
  <p class="rail-group" id="railSession">Options flow</p>
  <div class="rail-items" role="group" aria-labelledby="railSession">
    ${item("/flows/", "Overview", "overview")}
    ${item("/flows/ticker/", "Ticker", "ticker")}
    ${item("/flows/unusual/", "Unusual", "unusual")}
    ${item("/flows/watch/", "Watch", "watch")}
    ${item("/flows/long/", "Bullish", "long")}
    ${item("/flows/short/", "Bearish", "short")}
    ${item("/flows/events/", "Events", "events")}
  </div>
  <p class="rail-group" id="railMarket">Market</p>
  <div class="rail-items" role="group" aria-labelledby="railMarket">
    ${item("/flows/market/", "Market", "market")}
    ${item("/flows/desk/", "Premium desk", "desk")}
    ${item("/flows/strategy/", "Strategy tester", "strategy")}
    ${item("/flows/political/", "Political", "political")}
  </div>
  <!-- THE FOOT SAYS WHAT THE PRODUCT IS, AND IT IS NOT "REAL-TIME".

       The design's rail ends with a three-line claim, and the first word of
       it is one this product cannot make: the boards are built by a nightly
       pipeline and the intraday keys refresh on a cadence each page states.
       So the shape is kept and the claim is made true — three short lines,
       each one a thing a reader can check on the page above it.

       AND THE WORDING OF THIS COMMENT IS ITSELF CONSTRAINED, which is worth
       recording because it cost a CI run. This rail is SHARED markup, so
       every word of it — comments included — is served on the unusual route,
       where flows-worker-contract holds a list of per-transaction words that
       may appear ONLY inside the prose whose job is to refuse them. The
       sentence above used one of them as an ordinary verb. The rule is right
       and the comment was wrong: a reader cannot tell which served bytes were
       meant for them, so the page either keeps that vocabulary out or it is
       making the claim. The list lives in that test; do not restate it here,
       because restating it trips it. -->
  <p class="rail-foot">Nightly pipeline.<br>Intraday refresh.<br>Every silence named.</p>
</nav>`;
};


/* The chrome every Flows page shares. Kept in one place so the rail, the
   identity block and the heading structure cannot drift between four pages. */
/* THE ASSISTANT, DOCKED ON EVERY GATED PAGE BUT ITS OWN.
 *
 * A question box at one route is a destination: a reader looking at the
 * bearish board and wondering what changed has to leave the board to ask.
 * This puts the same box on the right edge of every page, behind the tab
 * or behind the "?" key.
 *
 * THE KEY IS PRINTED ON THE TAB, because a shortcut nobody is told about
 * is not an affordance — the same rule assets/js/flows-ask.js applies to
 * the Enter hint inside the question field's own label. The glyph is
 * aria-hidden and `aria-keyshortcuts` carries the same fact to assistive
 * technology in the form it reads, so the key is announced once rather
 * than as a stray "?" in the middle of the button's name.
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
        aria-expanded="false" aria-controls="askDockPanel"
        aria-keyshortcuts="?" title="Ask about what has been published — press ? to open">
  <span class="ak-dock-tab-l">Ask</span>
  <span class="ak-dock-tab-k" aria-hidden="true">?</span>
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

/* ---------- Neuron, the standing summary ------------------------ */

/**
 * The session's summary, as it reaches a reader.
 *
 * IT IS RENDERED HERE AND NOT FETCHED, WHICH IS THE WHOLE REASON IT EXISTS AT
 * ALL RATHER THAN STAYING A ROUTE NOBODY CALLED. `refreshFlowsSummary` has
 * been generating this on the cron and `/api/flows/summary` has been serving
 * it, and nothing anywhere read either — a finished feature with no reader.
 *
 * A CLIENT FETCH COULD NOT HAVE PAID FOR ITSELF. The obvious home for the
 * fetch is flows-dock.js, the one script already on twelve routes. Measured
 * against tests/flows-weight.mjs, those twelve share 486 BYTES of headroom at
 * the tightest (unusual), with overview at 704 and ticker at 739 — so the
 * smallest honest fetcher would break three ceilings on arrival. Emitting the
 * sentence server-side costs ZERO client bytes, and readFlowsSummary says in
 * its own docstring that it is "one indexed read of one short row — cheap
 * enough to sit on a page load, which is the whole point of generating on the
 * cron instead".
 *
 * SO THE WRITING EFFECT IS CSS AND NOT SCRIPT. Each word is its own span with
 * its own delay; flows.css animates them in. Nothing runs, so the sentence
 * cannot arrive half-written and cannot fail to arrive — a reader with
 * JavaScript off gets the whole thing, immediately, which is the correct
 * degradation for a paragraph.
 *
 * THE STAGGER IS CLAMPED AT 32 WORDS. Ungated, a long summary would still be
 * arriving two seconds after the page painted; past the clamp the remaining
 * words share the last delay and land together.
 *
 * FOUR STATES, AND THE READER IS TOLD WHICH. `llm` records whether a model
 * wrote the wording, because that is NOT inferable from the prose — one that
 * reads well may be the deterministic fallback and one that reads badly may be
 * the model's. `guard` carries WHY a generation was refused, and an invented
 * figure and a claim about the future are not the same fault. A null summary
 * is PENDING and says so: the briefing has not been published for this
 * session, which is not a statement about the market.
 */
function neuronMark(id, live) {
  /* Three layers, 3-4-2, every edge drawn — the smallest graph that still
     reads as a network rather than a molecule, and it survives at 13px, which
     is the size that actually decides the design. Cyan at the input and gold
     at the output: the gradient is the page's own, so the mark is MADE OF the
     palette rather than placed on top of it. */
  const L = [[5, [7, 14, 21]], [14, [4.5, 11, 17.5, 24]], [23, [10, 18]]];
  let edges = "";
  for (let l = 0; l < 2; l++) {
    for (const a of L[l][1]) for (const b of L[l + 1][1]) {
      edges += `<line x1="${L[l][0]}" y1="${a}" x2="${L[l + 1][0]}" y2="${b}"/>`;
    }
  }
  let nodes = "";
  L.forEach(([x, ys], i) => ys.forEach((y, j) => {
    nodes += `<circle cx="${x}" cy="${y}" r="${i === 1 ? 1.7 : 2}" class="ak-nn-n" style="--d:${((i * 4 + j) * 0.09).toFixed(2)}s"/>`;
  }));
  return `<svg class="ak-nn${live ? " is-live" : ""}" viewBox="0 0 28 28" aria-hidden="true" focusable="false">` +
    `<defs><linearGradient id="akNN${id}" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="#9bc4d2"/><stop offset="1" stop-color="#da9100"/>` +
    `</linearGradient></defs>` +
    `<g class="ak-nn-e" stroke="url(#akNN${id})">${edges}</g>` +
    `<g fill="url(#akNN${id})">${nodes}</g></svg>`;
}

const NEURON_CLAMP = 32;

function neuronWords(text) {
  /* Split on whitespace and keep ordinary spaces BETWEEN the spans, so the
     paragraph is still one run of text to a screen reader, to find-in-page and
     to a copy. A per-letter split would not survive any of the three — and a
     per-letter typewriter running through "$412.8M" reads as a figure counting
     up, which is a figure a reader has every reason to distrust. */
  return String(text).split(/\s+/).filter(Boolean).map((word, i) =>
    `<span class="ak-w" style="--d:${Math.min(i, NEURON_CLAMP)}">${escapeHTML(word)}</span>`).join(" ");
}

/** Which silence, in the reader's words rather than in the column's. */
function neuronProvenance(summary) {
  if (summary.llm) {
    return "Wording by " + escapeHTML(summary.model || "a language model") + "; figures measured by the pipeline.";
  }
  const guard = typeof summary.guard === "string" ? summary.guard : "";
  /* EVERY BRANCH STILL NAMES WHICH OF THE TWO A READER IS HOLDING, because
     that is the whole job of this line and it is a NOT-CLAIMED: a sentence
     assembled by code in this repository must never be mistaken for one a
     model wrote. What went is the paragraph around it — three lines of
     reassurance under a two-line summary, restating on every page load that
     the figures were measured, which the deterministic reading demonstrates
     by existing. The refusals keep their reason: "refused" with no cause
     would leave a reader unable to tell a guard from an outage. */
  if (guard === "invented") return "Deterministic reading. A model\u2019s wording named an unsupported figure and was refused.";
  if (guard === "forecast") return "Deterministic reading. A model\u2019s wording claimed what happens next and was refused.";
  if (guard.startsWith("unreachable:")) {
    const why = guard.slice("unreachable:".length);
    const said = why === "3036"
      ? "the day\u2019s free model allowance is spent, resetting 00:00 UTC"
      : why === "3040" ? "the model had no capacity, and nothing was spent"
        : why === "5035" ? "the configured model is not available on this plan"
          : why === "empty" ? "the model answered with nothing"
            : "the model did not answer";
    return "Deterministic reading: " + said + ".";
  }
  return "Deterministic reading. No model was asked.";
}

function neuronDock(summary, { scope = "this session" } = {}) {
  if (!summary || typeof summary.text !== "string" || !summary.text.trim()) {
    /* PENDING IS NOT A QUIET MARKET AND NOT AN ERROR. Nothing has been
       measured for this session yet, so the honest thing is to say which of
       those it is. The mark does not pulse: there is no sentence arriving. */
    return `
  <section class="ak-neuron is-pending" aria-labelledby="akNeuronH">
    ${neuronMark("p", false)}
    <div class="ak-neuron-body">
      <p class="ak-neuron-h" id="akNeuronH">Neuron</p>
      <p class="ak-neuron-say ak-neuron-none">No summary has been written for ${escapeHTML(scope)} yet.</p>
      <p class="ak-neuron-src">Not published yet \u2014 not a quiet session. Nothing here is claimed about the market.</p>
    </div>
  </section>`;
  }
  const when = typeof summary.generatedAt === "string" && summary.generatedAt
    ? `<span class="ak-neuron-when">&middot; written <time datetime="${escapeHTML(summary.generatedAt)}">${escapeHTML(summary.generatedAt.slice(11, 16))} UTC</time></span>`
    : "";
  const words = neuronWords(summary.text);
  const caretAt = Math.min(String(summary.text).split(/\s+/).filter(Boolean).length, NEURON_CLAMP) + 1;
  /* THE MARK PULSES ONLY WHEN A MODEL ACTUALLY WROTE THIS, and the first draft
     of this function got it wrong in a way worth recording: it passed `true`
     unconditionally, so a panel whose own provenance line read "No model was
     asked" sat under an animated neural graph. The animation is a claim. A
     deterministic reading is assembled from published facts by code in this
     repository, and dressing it in the same movement as a generation would be
     the section's own `llm` column contradicted by its decoration — on the one
     element whose whole job is to say which of the two a reader is holding. */
  return `
  <section class="ak-neuron${summary.llm ? " is-llm" : ""}" aria-labelledby="akNeuronH">
    ${neuronMark(summary.llm ? "d" : "s", summary.llm)}
    <div class="ak-neuron-body">
      <p class="ak-neuron-h" id="akNeuronH">Neuron ${when}</p>
      <p class="ak-neuron-say">${words}<span class="ak-caret" style="--d:${caretAt}" aria-hidden="true"></span></p>
      <p class="ak-neuron-src">${neuronProvenance(summary)}</p>
    </div>
  </section>`;
}

const shell = (title, kicker, active, username, body) => `
<body class="flows-body has-rail" data-flows-page="${active}">
<a class="flows-skip" href="#flowsMain">Skip to content</a>
${topbar(true, username)}
${rail(active)}
<main class="flows-main" id="flowsMain" tabindex="-1">
  <!-- THE BREADCRUMB THE DESIGN OPENS WITH, AND IT REPLACES A SECOND COPY OF
       THE READER'S NAME. The header carried the username and a Sign out
       button; both now live beside the avatar in the top bar, which is where
       the design puts them and where they are said once rather than twice.

       IT IS A REAL TRAIL, NOT A DECORATION: the first crumb is a link to the
       section's front door and the last is the page a reader is on, marked
       aria-current so it is announced as the destination rather than read as
       one more place to go. -->
  <nav class="flows-crumbs" aria-label="Breadcrumb">
    <a href="/flows/">Flows</a>
    <span class="flows-crumbs-sep" aria-hidden="true">/</span>
    <span aria-current="page">${title}</span>
  </nav>
  <header class="flows-head">
    <div>
      <p class="flows-kicker">${kicker}</p>
      <h1>${title}</h1>
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


/* ---------- the retired card dialog ----------------------------
   THE ONE FULL STATEMENT OF THE RETIREMENT; everywhere else points here.
   cardQ() and cardDialog() stood here: a `<dialog id="flowsCard">` of ten
   hand-written <section class="fc-panel"> blocks emitted into the overview,
   both sides and the watch list, with the flows-panels.js and flows-card.js
   tags each of those four routes parsed to open it.

   THREE DEFECTS, ONE FIX. (a) Two answers to one question: /flows/ticker/?t=
   draws the SAME renderers and has an address, so it can be bookmarked, sent,
   and give each panel the width it measured for. (b) 166.3 KiB on four routes
   — flows-panels.js 150.91k plus flows-card.js 15.41k — where only the dialog
   called in; assets/js/flows-watch.js does not contain the string
   `FlowsPanels` at all. (c) It put the score derivation LAST, under nine
   panels, on the surface a reader always reaches from a row carrying a score,
   while shared/flows-panels.js had already moved that panel FIRST.

   WHAT REPLACED IT: every opener is an
   <a href="/flows/ticker/?t=…&s=signal&from=…">, and worker.js 302s the four
   board routes' own ?t= addresses there. A row with no card is still not a
   link — deckCard() in assets/js/flows-board.js says why. */
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
 * since the prior session, the largest flagged windows, what reports next,
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
export function overviewPage({ username = "", summary = null } = {}) {
  return `${head("Flows — Overview", "The whole session on one screen: both tails, the level, what moved, and what reports next.")}
${shell("Session Overview", "Options-flow intelligence", "overview", username, `
  <div class="flows-status" id="flowsStatus" role="status">Loading the latest session…</div>
  <p class="flows-stale" id="flowsStale" role="status" hidden></p>
${neuronDock(summary)}

  <!-- THE COMMAND CENTER. Twelve columns at desk widths, stacking to one on a
       phone. Every region below is a HOST: the shell, its heading and its
       accessible name are emitted here; the rows, the tiles and the strips are
       filled by flows-overview.js from payloads this page cannot see. A region
       that stays empty says which of the three silences it is in — the key was
       never published, the request never came back, or the pipeline measured
       and found nothing — because only the last of those is about the market. -->
  <nav class="cc-jump" aria-label="Overview sections">
    <a href="#ccChgH">Changes</a><a href="#ccBullH">Candidates</a>
    <a href="#ccAlertsH">Activity</a><a href="#ccEventsH">Catalysts</a>
    <a href="#ccTideH">Daily flow</a><a href="#ccLeanH">Sectors</a>
    <a href="#ccSplitH">Split</a><a href="#ccSpineH">Distribution</a>
  </nav>
  <div class="cc">

    <!-- Six readings the rest of the page then explains. Any of them may be an
         em dash: a tile whose endpoint did not answer says so by not saying a
         number. -->
    <!-- THE SESSION'S OWN IDENTITY, ABOVE THE READINGS RATHER THAN AMONG THEM.
         "Session" and "Screened" were tiles, sitting in a row of five
         MEASUREMENTS as though a date were one. They are the row's caption:
         which session these numbers are of, and how many names it looked at.
         A reader checking "is this today" should not have to scan a grid of
         figures to find out, and a tile that can never be compared to its
         neighbours does not belong beside them. -->
    <div class="cc-meta" id="ccMeta" hidden>
      <span class="cc-meta-d" id="ccMetaDate"></span>
      <span class="cc-meta-n" id="ccMetaScreened"></span>
      <span class="cc-meta-live" id="ccMetaLive" hidden></span>
    </div>

    <section class="cc-verdict" id="ccVerdict" aria-label="Session verdict"></section>

    <!-- HOW THE MARKET GOT HERE, WHICH THIS PAGE HAS NEVER DRAWN.
         Every other region here reports a LEVEL at today's close; the pulse
         key has carried a dated call/put premium series all along and no
         route asked for it. Both are drawn as two bars from a marked zero at
         each session, each on its own sign, because both are net figures that
         go negative and an unsigned bar would turn premium sold into premium
         bought.

         DAILY, AND THE PERIOD CONTROL IS A WINDOW RATHER THAN A SOURCE: every
         length offered is the same series, so a reader moving between them is
         changing how far back they look and nothing else. The same key also
         carries an intraday series; it answers a different question — how did
         TODAY accumulate — and is left to a panel that asks it. -->
    <section class="cc-region cc-tide" aria-labelledby="ccTideH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccTideH">Daily flow</h2>
        <div class="cc-seg" id="ccTideSeg" role="group" aria-label="How many sessions this flow is drawn over"></div>
      </div>
      <div class="cc-body" id="ccTide"></div>
    </section>

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
        <h2 class="cc-h-t" id="ccAlertsH">Largest flagged windows</h2>
        <span class="cc-h-s" id="ccAlertsSub"></span>
        <!-- THE WAY TO THE REST OF THEM, AND IT IS A DIFFERENT SENTENCE FROM
             THE ONE BESIDE IT. #ccAlertsSub states how many of how many this
             region drew and when the feed was read — a measurement, written
             by flows-overview.js. This is the address of the route that draws
             the whole population, and it is static because it is true whether
             or not the key read: a reader whose alerts key failed here is
             exactly the reader who wants the other route. Two elements rather
             than one anchor, so the count can keep being asserted as its own
             text. -->
        <a class="cc-h-s cc-h-all" href="/flows/unusual/">All flagged windows \u2192</a>
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
        <!-- THREE QUANTITIES, ONE STRIP. The baskets can be ranked on the
             dollars they cleared, on the contracts they traded, or on the
             share of their own premium that leaned — and each answers a
             different question, so none of them is the strip's "real" number.
             The buttons are written by flows-overview.js, which is the only
             place that knows which of the three actually read. -->
        <div class="cc-seg" id="ccLeanSeg" role="group"
             aria-label="Which quantity the sector strip draws"></div>
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
         headline and a name this product ranks — but a detail card exists only
         for the names the run went deep on, so the rest are printed plain. A
         link to a reader with nothing to read is worse than no link. -->
    <!-- THE SESSION'S CALL/PUT SPLIT AS ONE FIGURE. The two numbers are on
         market.premium and were reachable only as a signed tilt ratio in a
         tile — a reader who wanted "how much of the session was calls" had to
         invert a percentage. A ring states the share and the two dollar totals
         beside it state what it is a share OF, so neither can be read without
         the other. -->
    <section class="cc-region cc-split" aria-labelledby="ccSplitH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccSplitH">Flow distribution</h2>
        <span class="cc-h-s" id="ccSplitSub"></span>
      </div>
      <div class="cc-body" id="ccSplit"></div>
    </section>

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
<script src="${v("/assets/js/nav.js")}" defer></script>
<!-- flows-ui.js BEFORE flows-overview.js: the overview reads window.FlowsUI at
     module scope, and two deferred scripts execute in document order, so the
     library has to be the earlier tag. It is a hard dependency and the page
     says so on the status line rather than throwing when it is missing. -->
<!-- Before the renderer that registers with it; both deferred, so both run in
     document order after parsing. -->
<script src="${v("/assets/js/flows-cursor.js")}" defer></script>
<script src="${v("/assets/js/flows-ui.js")}" defer></script>
<script src="${v("/assets/js/flows-overview.js")}" defer></script>
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

     NOT ADDED TO THE OTHER ROUTES, and that is a measurement rather than an
     oversight. The library is 24.6k of uncompressed parse; tests/flows-weight
     measures each route against a stated ceiling, and serving it everywhere
     trips SIX at once — desk 151/135, market 126/102, unusual 117/93, events
     104/92, political 82/62, history 74/52 — for a control bar none of those
     pages builds. A library goes where something on the page calls it, which
     is the rule that just took flows-panels.js off this route with the card
     dialog. Here, 115.1k to 139.6k against a 155k ceiling. -->
<script src="${v("/assets/js/flows-ui.js")}" defer></script>
<script src="${v("/assets/js/flows-board.js")}" defer></script>
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
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-watch.js")}" defer></script>
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
    <!-- THE LEDE IS THIS PAGE'S <meta> DESCRIPTION AND IS NO LONGER DRAWN.
         "Whether the screened universe was bought or sold, how broad that was,
         and how much of it is five names" is a table of contents for the three
         headings underneath it — "Bought or sold, two ways", "Breadth, and what
         it is made of", "The tape" — the DEFINITION case. It still reaches
         head() above, where a one-line description of a page is exactly what a
         search result and a link preview are for.

         ONLY THIS PAGE. Nine pages share this markup and an earlier pass at
         this edit replaced the FIRST of them — the bullish/bearish board —
         leaving a comment there that described Market's headings. The side
         page's lede is a different sentence and is still drawn. -->
  </div>

  <section class="fc-panel" id="mktTiltPanel" hidden>
    <h2 class="fc-panel-h">Bought or sold, two ways</h2>
    <p class="fc-reading is-lead" id="mktTiltLead"></p>
    <div id="mktTilt"></div>
    <p class="fc-note" id="mktTiltNote"></p>
  </section>

  <section class="fc-panel" id="mktBreadthPanel" hidden>
    <h2 class="fc-panel-h">Breadth, and what it is made of</h2>
    <p class="fc-reading is-lead" id="mktBreadthLead"></p>
    <div id="mktBreadth"></div>
    <p class="fc-note is-qualifier" id="mktBreadthQual"></p>
    <p class="fc-note" id="mktBreadthNote"></p>
  </section>

  <section class="fc-panel" id="mktTapePanel" hidden>
    <h2 class="fc-panel-h">The tape</h2>
    <div class="flows-tablewrap" tabindex="0" role="region"
         aria-label="Aggregate tape readings over the screened universe">
      <table class="flows-table" id="mktTape">
        <!-- WHAT SURVIVED AND WHY. "Sums and ratios over the screened universe"
             repeats the heading "The tape" and the Names column beside it, and
             the "because a ratio whose numerator and denominator come from
             different sets of names is not a ratio of anything" clause is the
             REASON for a rule rather than the rule — method, in the
             flows-overview.js:325 sense. What is left is the rule itself, which
             is a population statement and therefore never folded away; the
             Names column and its abbr title carry it per row, and this says
             once that they do. -->
        <caption class="flows-caption">
          Each row states the population it was measured over.
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
    <p class="fc-reading is-lead" id="mktSectorLead"></p>
    <div id="mktSectors"></div>
    <p class="fc-note is-qualifier" id="mktSectorQual"></p>
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
 * ONE NAME, THE WHOLE BOOK — and now the ONLY per-name reader in the section.
 *
 * This docblock used to end "This page is the drill. The dialog stays." It
 * does not; the retirement note above argues that once. Every board row links
 * here, and worker.js 302s the four board routes' own ?t= addresses here.
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

  /* Emitted from the registry rather than hand-written. That used to be a
     contrast with the card dialog's ten hand-written <section> blocks; the
     dialog is gone and the registry is now the only list there is. Every id,
     title, question, span, group and tier comes from the one array, so adding
     a panel is a one-line edit the markup, the drawer table and the shed
     order all pick up.

     FOUR THINGS THE CONTROLLER USED TO WRITE ARE EMITTED HERE NOW, for one
     reason: they answer "what is this panel", and a reader should have that
     before a fetch rather than after one.

       data-group / data-tier  written by mountChrome on first paint, so a
                               reader with a slow card, or with JavaScript
                               that threw, got 23 identical boxes in no groups.
       ft-panel-q              the question, VISIBLE. It was already an
                               attribute no reader can see, and drawn by each
                               renderer — after the card landed.
       data-sentinel           `shared/` is never served, so the browser
                               cannot import SENTINEL_KEYS. Rather than a
                               third copy, of two strings, that nothing
                               compares, it travels as markup the way
                               `question` does: such a panel is drawn from the
                               top level or from its neighbours, so the "this
                               card predates the panel" branch must not fire.

     THE DRAWN QUESTION IS NOT DELETED, ONLY HIDDEN IN THE GRID (`.ft-grid
     .fc-q`, where that rule's own comment argues it). */
  const panelMarkup = (p) => `
    <section class="fc-panel ft-panel${p.span === 2 ? " is-wide" : ""}"
             id="panel-${escapeHTML(p.key)}" data-panel="${escapeHTML(p.key)}"
             data-group="${escapeHTML(p.group)}" data-tier="${escapeHTML(p.tier)}"${
      SENTINEL_KEYS.has(p.key) ? " data-sentinel" : ""}
             data-question="${escapeHTML(p.question)}"
             aria-labelledby="${p.id}H">
      <h3 id="${p.id}H"><span class="ft-panel-t">${p.title}</span>
        <button type="button" class="ft-zoom-open" data-panel="${escapeHTML(p.key)}"
                aria-label="Enlarge: ${escapeHTML(p.title)}">&#10529;</button></h3>
      <p class="ft-panel-q">${escapeHTML(p.question)}</p>
      <p class="ft-panel-one" id="${p.id}One"></p>
      <div id="${p.id}"></div>
    </section>`;

  /* THE FIVE STATIONS, SERVED. The page carried zero group boundaries in its
     markup until now: five <h2>s were built by the controller and inserted
     between panels, so the served document was one undifferentiated run and
     each group's question existed only after a script ran. A station is a real
     <section> now — linkable, labelled, and what a later change hides.

     role="tabpanel" ON A SECTION NOTHING HIDES YET, deliberately. This change
     ships the structure and no tab logic: all five stations are visible — the
     "all panels" state — and no tab is selected. The roles are served because
     a document that becomes a tablist only once a script runs is two
     documents to a screen reader, and one of them tested.

     A STATION LAYS OUT NOTHING HORIZONTALLY. It is the grid now and .ft-grid
     is a plain block, so every panel host measures what it did before this
     wrapper existed — a border, a padding or a margin here is a wrong chart,
     and the argument is stated in full at .ft-station in flows.css. */
  const stations = TICKER_GROUPS.map((g) => `
  <section class="ft-station" id="ftst-${g.key}" role="tabpanel"
           aria-labelledby="${g.hash}" data-group="${g.key}" data-side="${g.key}">
    <h2 class="ft-group" id="${g.hash}" tabindex="-1" data-group="${g.key}"><span class="ft-group-n">${escapeHTML(g.label)}</span><span class="ft-group-b">${escapeHTML(g.blurb)}</span></h2>
    <p class="ft-station-lead" id="ftlead-${g.key}"></p>${
    TICKER_PANELS.filter((p) => p.group === g.key).map(panelMarkup).join("")}
  </section>`).join("");

  /* THE TAB ROW, AND WHY THE COUNT IS NOT COUNTED HERE. Each tab prints how
     many panels its station holds, and that number is STATION_SIDE_COUNTS —
     the export the station is built from — rather than a filter written twice.
     A count computed twice is not wrong about any panel, only about how many
     there are, the one error a per-panel assertion cannot see.

     ANCHORS, NOT BUTTONS, and that survives the tab logic that is coming: a
     plain fragment link is keyboard-native, copyable out of the status bar and
     works with no script. aria-selected is false on all five — nothing is
     selected while everything is shown, and saying otherwise is untrue. */
  const tabs = TICKER_GROUPS.map((g) => `
      <a class="ft-tab" role="tab" id="fttab-${g.key}" href="#${g.hash}"
         aria-controls="ftst-${g.key}" aria-selected="false"
         data-group="${g.key}" data-side="${g.key}">${escapeHTML(g.label)} <span
         class="ft-tab-n">${STATION_SIDE_COUNTS[g.key]}</span></a>`).join("");

  return `${head("Flows — Ticker", lede)}
${shell("Ticker", "Options-flow intelligence", "ticker", username, `
  <div class="flows-status" id="ftStatus" role="status">Loading the name…</div>
  <p class="flows-stale fc-staleband" id="ftStale" role="status" hidden></p>

  <!-- THE LEDE IS THE PAGE'S DESCRIPTION, NOT ONE OF ITS READINGS, and this
       is the one route where that distinction costs something. It is still
       served — head() above puts it in <meta name="description">, which is
       where a description belongs and where a search result reads it. What is
       gone is the visible copy: 95px measured, on a page a reader opens every
       morning to look at ONE name, spent every time on six lines about what
       the page is.

       THIS IS NOT THE CAVEATS MOVING. The provenance prose — what a number
       was measured over, which session it belongs to, why a silence is the
       silence it is — stays exactly where it is on every panel, because that
       is evidence and a reader needs it beside the figure it qualifies. A
       paragraph explaining the ROUTE is navigation, and navigation is read
       once. The other six Flows routes keep theirs; they are not opened
       daily to re-read one name. -->

  <!-- THE ARRIVAL HEADER, AND IT IS NOT THE STICKY ONE.

       .ft-head below is re-parented into the sticky bar by the controller and
       has to stay one line for that to be worth having: a four-line block
       pinned under the topbar would spend a fifth of a laptop viewport on
       chrome for the whole scroll. So the two headers are two jobs. This one
       is what a reader lands on — the name, what it costs, what this product
       thinks of it and how strongly — laid out so each of those is a block
       rather than a chip in a run-on line. That one is what survives the
       scroll, and it stays terse.

       ABOVE THE STICKY BAR, NOT BELOW IT, and that is a position rather than
       a preference. The controller inserts the change section as the bar's
       nextSibling, so anything served between the bar and .ft-head lands
       UNDER a full panel of prose — the first draft of this block rendered
       735px down the page, below the reading it was meant to introduce.
       Above the bar it is what a reader lands on and it scrolls away, leaving
       the tabs and the terse strip pinned, which is the division of labour
       the two headers were split for.

       NOTHING HERE IS A SECOND MEASUREMENT. Every slot is filled from the
       same value the strip and the panels use; the difference is presentation
       only. A hero that re-derived a score would be a header that can
       disagree with the panel under it. -->
  <section class="ft-hero" id="ftHero" hidden aria-label="This name at a glance">
    <!-- THE IDENTITY IS THE SYMBOL AND WHAT IDENTIFIES IT, stacked, which is
         where the design puts the company name and where a "Sector" column of
         its own does not need to be. The strip wrapped to two rows at 1440
         with seven blocks in it; folding the two identity lines under the
         symbol is what puts it back on one — and it reads better, because a
         sector is a property of the name rather than a fifth measurement
         beside four figures. -->
    <div class="ft-hero-id">
      <span class="ft-hero-t" id="ftHeroT"></span>
      <span class="ft-hero-nm" id="ftHeroNm" hidden></span>
      <span class="ft-hero-sub">
        <span class="ft-hero-m" id="ftHeroSector"></span>
        <!-- WHICH SESSION EVERY FIGURE ON THIS PAGE IS OF. -->
        <span class="ft-hero-m is-faint" id="ftHeroWhen"></span>
      </span>
    </div>
    <div class="ft-hero-px">
      <span class="ft-hero-k">Last</span>
      <!-- THE PRICE AND ITS CHANGE SHARE ONE ROW CELL, in a wrapper, so the
           change is a qualifier under the figure rather than a fifth reading
           taking a row track of its own. Separate elements, because the
           controller writes the price with textContent and a nested child
           would be wiped by it. -->
      <span class="ft-hero-stack">
        <span class="ft-hero-v" id="ftHeroPx"></span>
        <span class="ft-hero-chg" id="ftHeroChg" hidden></span>
      </span>
    </div>
    <!-- EVERY BLOCK IS LABEL + ONE CELL, whatever it holds. The strip's rows
         are shared by all five (subgrid, see flows.css), so a block that put
         four children straight into the grid would spread them across tracks
         sized for two and land its bar on top of its own figure. The stack
         wrapper is what keeps the row count at two while the contents vary. -->
    <div class="ft-hero-b" id="ftHeroScoreB">
      <span class="ft-hero-k">Options score</span>
      <span class="ft-hero-stack">
        <span class="ft-hero-row">
          <span class="ft-hero-v" id="ftHeroScore"></span>
          <span class="ft-hero-bar" id="ftHeroScoreBar" aria-hidden="true"></span>
        </span>
        <span class="ft-hero-pill" id="ftHeroSide" hidden></span>
      </span>
    </div>
    <div class="ft-hero-b" id="ftHeroConvB">
      <span class="ft-hero-k">Conviction</span>
      <span class="ft-hero-stack">
        <span class="ft-hero-v" id="ftHeroConv"></span>
        <span class="ft-hero-seg" id="ftHeroConvSeg" aria-hidden="true"></span>
      </span>
    </div>
    <!-- THE TWO VOLATILITY COLUMNS THE DESIGN PUTS BESIDE THE PRICE, and they
         are the two of its four that this product actually publishes. The
         reference's header carries IV, IV Rank, Volume and Mkt Cap; the card
         carries at-the-money vol and an IV rank on every name, and carries
         neither a whole-tape share volume nor a market capitalisation on any
         name. Two real columns beat four with two invented ones. -->
    <div class="ft-hero-b" id="ftHeroIvB" hidden>
      <span class="ft-hero-k">ATM IV</span>
      <span class="ft-hero-stack">
        <span class="ft-hero-v" id="ftHeroIv"></span>
        <span class="ft-hero-m is-faint" id="ftHeroIvSub" hidden></span>
      </span>
    </div>
    <div class="ft-hero-b" id="ftHeroIvrB" hidden>
      <span class="ft-hero-k">IV rank</span>
      <span class="ft-hero-stack">
        <span class="ft-hero-v" id="ftHeroIvr"></span>
        <span class="ft-hero-seg" id="ftHeroIvrSeg" aria-hidden="true"></span>
      </span>
    </div>

  </section>
  <!-- THE BAR SITS DIRECTLY UNDER THE HERO, AND IT USED TO SIT UNDER FOUR
       MORE BLOCKS. The six cards, the findings index, the flag row and the
       sector strip were all added above it in this wave, and on a phone they
       are not a column beside the page — they stack. Measured at 320px on a
       fresh load: hero 307 + cards 576 + brief 514 + flags 61 + related 87
       put #ftBar's top at 1,941px in a 900px viewport, so the five station
       tabs — this page's whole navigation — were nearly two screens below the
       fold and could not be reached without scrolling past everything they
       exist to skip. Moving it under the CARDS was not enough on its own:
       that still measured 1,230px, because hero and cards alone are 883 of
       it. Under the hero it measures 629.

       IT WAS NOT MERELY UGLY, IT FAILED A CONTRACT. flows-ticker-contract
       hit-tests a tab with elementFromPoint at 320px and counts the rows of
       pixels that actually reach it; a rect 1,941px down returns null at
       every one of them, so the assertion read "0px over a 25px box" — a
       touch target that does not exist rather than one that is merely small.
       A geometry assertion on the pseudo-element would have passed.

       MOVED RATHER THAN SHRUNK: nothing above it was cut. The identity and
       the tabs belong between the name's figures and the stations they index,
       which is where the design puts them, and the three blocks read just as
       well after the bar as before it — they are what this card FOUND, and a
       reader reaches them by scrolling rather than by scrolling past. -->
  <!-- THE STICKY BAR IS SERVED NOW, AND THE IDENTITY BLOCK STILL MOVES INTO
       IT. The controller used to build this <div> from nothing on first paint,
       which put the whole index — five tabs and their counts — behind a fetch
       of a payload none of it depends on. It still re-parents #ftHead in as
       the first child: a second markup for that block, built in the browser,
       is the defect the registry exists to prevent. It is "hidden" for the
       grid's reason — a bar of tabs over an empty page offers to move a
       reader between five empty stations. -->
  <div class="ft-bar" id="ftBar" hidden>
    <nav class="ft-tabs" role="tablist" aria-label="Stations of this name">${tabs}
    </nav>
    <!-- ONE LINK OUT OF THE TABLIST AND DELIBERATELY NOT IN IT: "everything
         at once" is not one of the five stations a tab selects. Today it
         scrolls to the top of the grid, because every station is already
         open; the change that hides four gives it the ?s=all address it
         names, which this function cannot write, not knowing the ticker. -->
    <a class="ft-all-link" id="ftAll" href="#ftGrid"
       data-side="all">All ${TICKER_PANELS.length} panels</a>
    <!-- THE FIXED BAND: seven slots, served EMPTY and HIDDEN. Each is a fact
         this page already holds and has never shown in the bar — where the
         reader came from, the name's sector, its ATR, its neighbours by rank,
         a way to reach another name, the premium desk for this symbol, and
         the next earnings date. They are emitted rather than created by the
         controller so the rules that lay them out ship in the stylesheet the
         page is versioned against, and so PR 4 fills slots rather than
         inventing them. The row costs no height and no margin until it does
         (see .ft-band in flows.css): every slot is hidden, and 9.6px of
         nothing under the tabs is a gap, not a reserved height.

         EMPTY AND HIDDEN IS THE HONEST SERVED STATE. A dash claims a
         measurement came back empty; a label with no value claims one is
         coming. Neither is true before a card lands. -->
    <div class="ft-band" id="ftBand">
      <a class="ft-band-b" id="ftFrom" hidden></a>
      <span class="ft-band-v" id="ftSector" hidden></span>
      <span class="ft-band-v" id="ftAtr" hidden></span>
      <nav class="ft-band-nav" id="ftRankNav" hidden
           aria-label="Neighbouring names by rank"></nav>
      <input class="ft-band-find" id="ftFind" type="search" list="ftFindNames"
             autocomplete="off" aria-label="Find another name" hidden>
      <datalist id="ftFindNames"></datalist>
      <a class="ft-band-b" id="ftPrem" hidden></a>
      <span class="ft-band-v" id="ftEarn" hidden></span>
    </div>
  </div>
  <!-- WHAT IS TRUE OF THIS NAME RIGHT NOW, AS A ROW OF MARKS.

       Each one is a threshold already computed and already drawn somewhere on
       this page; the row is a scan layer over them, not a new opinion. A flag
       appears only when its own reading is present and past its threshold —
       never as a greyed-out "no", which would turn five absences into five
       claims. The threshold rides in the title of each. -->
  <!-- SIX CARDS, WHICH IS THE SHAPE OF THE DESIGN AND NOT A COPY OF THE STRIP
       ABOVE IT. The header already carries price, score, conviction and the
       two volatility figures; repeating any of them here would spend a card
       on a number a reader has just read. These six are the name's FLOW —
       what the session cleared, over how long, on which side of the quote,
       where the open interest moved, how much printed off-exchange, and what
       delta the tape ended up holding — each from its own panel and each
       carrying that panel's own unit and coverage.

       THE CARDS ARE WRITTEN BY flows-ticker.js. The host is served empty and
       hidden, the same way the hero above is, so a page whose card never
       arrives shows no empty furniture. -->
  <div class="ft-cards" id="ftCards" hidden aria-label="This session's flow"></div>
  <!-- WHAT THIS CARD FOUND, AND WHY IT IS AN INDEX RATHER THAN A SUMMARY.

       The design puts a findings panel at the top right and calls it an AI
       summary. This product has one of those — Neuron, on the overview — and
       it is generated per SESSION, not per name; a per-name one is a pipeline
       change, not a renderer change, so calling this that would be a claim
       about how it was made. What this is instead: the leads the panels below
       already publish, gathered at the top with a way into each.

       IT IS ONE SOURCE RENDERED TWICE, NOT TWO SPELLINGS OF ONE READING. Each
       line is the panel's own published lead — the same string the panel
       prints, read from the same field — so
       the two cannot disagree about a number; what this adds is that a reader
       sees the findings before scrolling, and can go straight to the one that
       matters. A second sentence ABOUT the same data, written here, is what
       the rule forbids, and there is none.

       NO SEVERITY DOTS. The design colours each bullet red, amber or green.
       Nothing on this card ranks its findings by severity, so a coloured dot
       would be this renderer inventing an opinion the payload does not carry;
       the marks are neutral and the reading carries its own sign in its own
       words. -->
  <aside class="ft-brief" id="ftBrief" hidden aria-labelledby="ftBriefH">
    <h2 class="ft-brief-h" id="ftBriefH">What this card found</h2>
    <ol class="ft-brief-l" id="ftBriefL"></ol>
    <p class="ft-brief-s" id="ftBriefS"></p>
  </aside>
  <div class="ft-flags" id="ftFlags" hidden></div>
  <!-- THE OTHER NAMES IN THIS SECTOR, which the design puts at the foot of its
       right column and calls Related. Drawn from the same session's BOARDS —
       the only place this page learns about any name but its own — so the
       claim is that one run ranked them and put them in one sector, and the
       subtitle says so rather than letting the word "related" imply a model
       nobody built. Written by flows-ticker.js once the boards arrive, which
       is a different fetch from the card's. -->
  <aside class="ft-rel" id="ftRel" hidden aria-labelledby="ftRelH">
    <h2 class="ft-rel-h" id="ftRelH">Others in this sector</h2>
    <div class="ft-rel-l" id="ftRelL"></div>
    <p class="ft-rel-s" id="ftRelS"></p>
  </aside>


  <header class="ft-head" id="ftHead" hidden>
    <h2 id="ftTicker" tabindex="-1">&nbsp;</h2>
    <span class="fc-score" id="ftScore"></span>
    <!-- THREE SLOTS THE CONTROLLER NO LONGER FILLS, kept because emptying a
         served slot is cheaper and safer than deleting one: the chrome check
         reads this markup, and a slot that exists and is empty is the page's
         own honest served state. Conviction and the session date moved to the
         hero above; the gamma regime is the gamma panel's own lead, stated
         beside the ladder it was measured from. See paintCard. -->
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

  <div class="ft-grid" id="ftGrid" hidden>${stations}
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
<!-- BEFORE THE LIBRARY THAT REGISTERS WITH IT. Both are deferred, so both run
     in document order after parsing: the cursor defines window.FlowsCursor
     and the panel library asks for it while drawing. Reversing these two
     would not throw — every call site tests for it first — it would simply
     draw every chart without a cursor, silently, which is the worse failure
     of the two. -->
<script src="${v("/assets/js/flows-cursor.js")}" defer></script>
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
