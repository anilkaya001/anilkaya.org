import {
  TICKER_PANELS, TICKER_GROUPS, SENTINEL_KEYS, STATION_SIDE_COUNTS,
} from "./flows-panels.js";

export const ASSET_VERSION = "214";

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
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4",
};
const icon = (name) => {
  const d = ICONS[name];
  return d
    ? `<svg class="ic" viewBox="0 0 24 24" width="16" height="16" fill="none" ` +
      `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
      `stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`
    : "";
};

const initials = (username) => {
  const name = String(username || "").trim();
  if (!name) return "\u2014";
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const said = parts.length >= 2
    ? parts[0].slice(0, 1) + parts[1].slice(0, 1)
    : name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  return escapeHTML(said.toUpperCase() || "\u2014");
};

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

    <form class="flows-find" method="GET" action="/flows/ticker/" role="search">
      <label class="visually-hidden" for="flowsFind">Open a ticker page</label>
      ${icon("search")}
      <input class="flows-find-i" id="flowsFind" name="t" type="search"
             autocomplete="off" spellcheck="false" maxlength="10"
             pattern="[A-Za-z][A-Za-z0-9.\\-]{0,9}" placeholder="Search a ticker"
             title="A ticker symbol: a letter, then up to nine letters, digits, dots or dashes.">
    </form>

    <a class="topbar__bell" href="/flows/ask/" aria-label="Session briefing and warnings">
      ${icon("bell")}<span class="topbar__bell-n" data-warn-count hidden></span>
    </a>
    <span class="topbar__who" title="Signed in as ${escapeHTML(String(username || ""))}"
          aria-label="Signed in as ${escapeHTML(String(username || ""))}">${initials(username)}</span>

    <form method="POST" action="/flows/logout" class="topbar__out">
      <button type="submit" class="flows-signout">Sign out</button>
    </form>
  </div>` : ""}
</header>`;

const rail = (active) => {

  const item = (href, label, key) => {
    const on = active === key;

    const badge = key === "long" || key === "short" || key === "watch" || key === "events"
      ? `<span class="rail-count" data-rail-count="${key}" hidden></span>` : "";

    return `<a href="${href}"${on ? ' class="is-on" aria-current="page"' : ""}>` +
      `${icon(key)}<span class="rail-label">${label}</span>${badge}</a>`;
  };
  return `
<nav class="flows-rail" aria-label="Flows">

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

  <p class="rail-foot">Nightly pipeline.<br>Intraday refresh.<br>Every silence named.</p>
</nav>`;
};

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

function neuronMark(id, live) {

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

  return String(text).split(/\s+/).filter(Boolean).map((word, i) =>
    `<span class="ak-w" style="--d:${Math.min(i, NEURON_CLAMP)}">${escapeHTML(word)}</span>`).join(" ");
}

export function neuronProvenance(summary) {
  if (summary.llm) {
    return "Wording by " + escapeHTML(summary.model || "a language model") + "; figures measured by the pipeline.";
  }
  const guard = typeof summary.guard === "string" ? summary.guard : "";

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

  <nav class="flows-crumbs" aria-label="Breadcrumb">
    <a href="/flows/">Flows</a>
    <span class="flows-crumbs-sep" aria-hidden="true">/</span>
    <span aria-current="page">${title}</span>
  </nav>

  <header class="flows-head${active === "ticker" ? " flows-head--quiet" : ""}">
    <div>
      <p class="flows-kicker">${kicker}</p>
      <h1>${title}</h1>
    </div>
  </header>
${body}
</main>
${dock(active)}`;

export function loginPage({ error = "" } = {}) {

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

export function overviewPage({ username = "", summary = null } = {}) {
  return `${head("Flows — Overview", "The whole session on one screen: both tails, the level, what moved, and what reports next.")}
${shell("Session Overview", "Options-flow intelligence", "overview", username, `
  <div class="flows-status" id="flowsStatus" role="status">Loading the latest session…</div>
  <p class="flows-stale" id="flowsStale" role="status" hidden></p>

  <div class="flows-scroll" id="ccScroll">
${neuronDock(summary)}

  <nav class="cc-jump" aria-label="Overview sections">
    <a href="#ccChgH">Changes</a><a href="#ccBullH">Candidates</a>
    <a href="#ccAlertsH">Activity</a><a href="#ccEventsH">Catalysts</a>
    <a href="#ccTideH">Daily flow</a><a href="#ccLeanH">Sectors</a>
    <a href="#ccSplitH">Split</a><a href="#ccSpineH">Distribution</a>
  </nav>
  <div class="cc">

    <div class="cc-meta" id="ccMeta" hidden>
      <span class="cc-meta-d" id="ccMetaDate"></span>
      <span class="cc-meta-n" id="ccMetaScreened"></span>
      <span class="cc-meta-live" id="ccMetaLive" hidden></span>
    </div>

    <section class="cc-verdict" id="ccVerdict" aria-label="Session verdict"></section>

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

    <section class="cc-region cc-chg" aria-labelledby="ccChgH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccChgH">What changed</h2>

        <span class="cc-h-s" id="ccChgSub">since each name&#39;s prior scored session</span>
      </div>
      <div class="cc-body" id="ccChg"></div>
    </section>

    <section class="cc-region cc-alerts" aria-labelledby="ccAlertsH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccAlertsH">Largest flagged windows</h2>
        <span class="cc-h-s" id="ccAlertsSub"></span>

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

    <section class="cc-region cc-watch" aria-labelledby="ccWatchH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccWatchH">Nearly in</h2>
        <a class="cc-h-s" href="/flows/watch/" id="ccWatchSub">inside the dead band</a>
      </div>
      <div class="cc-body" id="ccWatch"></div>
    </section>

    <section class="cc-region cc-lean" aria-labelledby="ccLeanH">
      <div class="cc-h">
        <h2 class="cc-h-t" id="ccLeanH">Sector lean · options premium</h2>

        <span class="cc-h-s" id="ccLeanSub">options premium, not price momentum</span>

        <div class="cc-seg" id="ccLeanSeg" role="group"
             aria-label="Which quantity the sector strip draws"></div>
      </div>
      <div class="cc-body" id="ccLean"></div>
    </section>

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

  <p class="flows-foot">
    Scores are a ranked attention signal, not a return forecast. Names inside
    the dead band are not published on either side.
    <span class="foot-hit" id="flowsHitRate">Whether this board has been right
    is measured rather than asserted, session by session, on the
    <a href="/flows/history/">track record</a>.</span>
  </p>
  </div>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>

<script src="${v("/assets/js/flows-cursor.js")}" defer></script>
<script src="${v("/assets/js/flows-ui.js")}" defer></script>
<script src="${v("/assets/js/flows-overview.js")}" defer></script>
</body>
</html>`;
}

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

  <div class="flows-deck" id="flowsDeck" role="list" aria-label="Ranked candidates"></div>

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

          <th scope="col" class="c-num"><abbr title="Where the last close sits in its own 52-week range: 0% at the year's low, 100% at the high. A position in a range, not a return — a name can sit at 95% after a year of going nowhere and a month of going up">52w</abbr></th>
          <th scope="col" class="c-num"><abbr title="Thirty-day implied volatility minus the volatility this name has actually delivered over the 21 sessions spanning the same thirty calendar days, both annualised, in volatility points. The difference between two measurements — not a forecast, not an edge, and not a variance premium in the swap sense. It says what the option market is charging against what the stock has been doing, and nothing about which of the two is right">VRP</abbr></th>
          <th scope="col" class="c-num"><abbr title="Where 30-day implied volatility sits within its own past year: 0 at the year's low, 100 at the high. A percentile of volatility, not a level of it — a 20 IVR name can still be the most volatile name on the board">IVR</abbr></th>
        </tr>
      </thead>
      <tbody id="flowsBody"></tbody>
    </table>
  </div>

  <p class="flows-foot">
    Scores are a ranked attention signal, not a return forecast.
    <span class="foot-hit" id="flowsHitRate">Whether this side has been right
    is measured rather than asserted, session by session, on the
    <a href="/flows/history/">track record</a>.</span>
  </p>
`)}
<script src="${v("/assets/js/nav.js")}" defer></script>

<script src="${v("/assets/js/flows-ui.js")}" defer></script>
<script src="${v("/assets/js/flows-board.js")}" defer></script>
</body>
</html>`;
}

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

export function marketPage({ username = "" } = {}) {
  const lede = "Whether the screened universe was bought or sold, how broad " +
    "that was, and how much of it is five names.";
  return `${head("Flows \u2014 Market", lede)}
${shell("Market Level", "Options-flow intelligence", "market", username, `
  <div class="flows-status" id="mktStatus" role="status">Loading the session\u2026</div>
  <p class="flows-stale" id="mktStale" role="status" hidden></p>

  <div class="flows-controls">

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

export function tickerPage({ username = "" } = {}) {

  const lede = "One name and its whole option book: where dealer gamma sits " +
    "and what flips it, what the chain is charging across strikes and " +
    "expiries, which contracts carry the volume, and how far the price is " +
    "from every level that matters — all of it read off the card the pipeline " +
    "published this morning, with no vendor call made by this page.";

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

  const stations = TICKER_GROUPS.map((g) => `
  <section class="ft-station" id="ftst-${g.key}" role="tabpanel"
           aria-labelledby="${g.hash}" data-group="${g.key}" data-side="${g.key}">
    <h2 class="ft-group" id="${g.hash}" tabindex="-1" data-group="${g.key}"><span class="ft-group-n">${escapeHTML(g.label)}</span><span class="ft-group-b">${escapeHTML(g.blurb)}</span></h2>
    <p class="ft-station-lead" id="ftlead-${g.key}"></p>${
    TICKER_PANELS.filter((p) => p.group === g.key).map(panelMarkup).join("")}
  </section>`).join("");

  const tabs = TICKER_GROUPS.map((g) => `
      <a class="ft-tab" role="tab" id="fttab-${g.key}" href="#${g.hash}"
         aria-controls="ftst-${g.key}" aria-selected="false"
         data-group="${g.key}" data-side="${g.key}">${escapeHTML(g.label)} <span
         class="ft-tab-n">${STATION_SIDE_COUNTS[g.key]}</span></a>`).join("");

  return `${head("Flows — Ticker", lede)}
${shell("Ticker", "Options-flow intelligence", "ticker", username, `
  <div class="flows-status" id="ftStatus" role="status">Loading the name…</div>
  <p class="flows-stale fc-staleband" id="ftStale" role="status" hidden></p>

  <div class="ft-scroll flows-scroll" id="ftScroll">
  <section class="ft-hero" id="ftHero" hidden aria-label="This name at a glance">

    <div class="ft-hero-id">
      <span class="ft-hero-t" id="ftHeroT"></span>
      <span class="ft-hero-nm" id="ftHeroNm" hidden></span>
      <span class="ft-hero-sub">
        <span class="ft-hero-m" id="ftHeroSector"></span>

        <span class="ft-hero-m is-faint" id="ftHeroWhen"></span>
      </span>
    </div>
    <div class="ft-hero-px">
      <span class="ft-hero-k">Last</span>

      <span class="ft-hero-stack">
        <span class="ft-hero-v" id="ftHeroPx"></span>
        <span class="ft-hero-chg" id="ftHeroChg" hidden></span>
        <span class="ft-hero-live" id="ftHeroLive" role="status" hidden></span>
      </span>
    </div>

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

  <div class="ft-bar" id="ftBar" hidden>
    <nav class="ft-tabs" role="tablist" aria-label="Stations of this name">${tabs}
    </nav>

    <a class="ft-all-link" id="ftAll" href="#ftGrid"
       data-side="all">All ${TICKER_PANELS.length} panels</a>

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

  <div class="ft-split">
    <div class="ft-split-main">

  <div class="ft-row0">
    <div class="ft-row0-l">
  <div class="ft-cards" id="ftCards" hidden aria-label="This session's flow"></div>
  <div class="ft-flags" id="ftFlags" hidden></div>
    </div>
    <div class="ft-row0-r">

  <aside class="ft-brief" id="ftBrief" hidden aria-labelledby="ftBriefH">
    <h2 class="ft-brief-h" id="ftBriefH">
      <span class="ft-brief-ic" aria-hidden="true">${icon("sun")}</span>
      <span class="ft-brief-hn">Brief</span>
      <span class="ft-brief-beta">Beta</span>
    </h2>
    <div class="ak-neuron ft-neuron is-pending" id="ftNeuron" hidden>
      ${neuronMark("t", false)}
      <div class="ak-neuron-body">
        <p class="ak-neuron-h" id="ftNeuronH">Neuron</p>
        <p class="ak-neuron-say" id="ftNeuronSay"></p>
        <p class="ak-neuron-src" id="ftNeuronSrc"></p>
      </div>
    </div>
    <ol class="ft-brief-l" id="ftBriefL"></ol>
    <p class="ft-brief-s" id="ftBriefS"></p>

    <form class="ft-brief-ask" id="ftBriefAsk" hidden>
      <label class="ft-brief-ask-l" for="ftBriefQ" id="ftBriefQL">Ask about this name</label>
      <span class="ft-brief-ask-row">
        <input class="ft-brief-ask-i" id="ftBriefQ" type="text" autocomplete="off"
               aria-describedby="ftBriefQL">
        <button class="ft-brief-ask-b" type="submit">${icon("ask")}<span
          class="ft-brief-ask-bt">Ask</span></button>
      </span>
    </form>
  </aside>
    </div>
  </div>

  <div class="ft-top">

  <section class="ft-chart" id="ftChart" hidden aria-labelledby="ftChartH">

    <div class="ft-chart-top">
      <h2 class="ft-chart-h" id="ftChartH">Series</h2>
      <div class="ft-period" id="ftPeriod" role="group"
           aria-label="Window the series below"></div>
      <div class="ft-chart-tabs" id="ftChartTabs" role="tablist"
           aria-label="Which series to draw"></div>
    </div>
    <div class="ft-chart-body" id="ftChartBody"></div>
    <p class="ft-chart-s" id="ftChartS"></p>
  </section>

  <section class="ft-garch" id="ftGarch" hidden aria-labelledby="ftGarchH">
    <div class="ft-chart-top">
      <h2 class="ft-chart-h" id="ftGarchH">GARCH(1,1) — GED</h2>
      <div class="ft-period" id="ftGarchTabs" role="group"
           aria-label="Window the volatility path"></div>
    </div>
    <div class="ft-chart-body" id="ftGarchBody"></div>
    <p class="ft-chart-s" id="ftGarchS"></p>
  </section>
  </div>

  <div class="ft-band3">

  <section class="ft-chain" id="ftChain" hidden aria-labelledby="ftChainH">
    <div class="ft-chain-top">
      <h2 class="ft-chain-h" id="ftChainH">Options chain</h2>
      <div class="ft-chain-tabs" id="ftChainTabs" role="tablist"
           aria-label="How to order the chain"></div>
    </div>
    <div class="ft-chain-body" id="ftChainBody"></div>
    <p class="ft-chain-s" id="ftChainS"></p>
  </section>
    <div class="ft-col">
    <section class="ft-mix" id="ftMix" hidden aria-labelledby="ftMixH">
      <h2 class="ft-mix-h" id="ftMixH">Volume by type</h2>
      <div class="ft-mix-body" id="ftMixBody"></div>
      <p class="ft-mix-s" id="ftMixS"></p>
    </section>

  <aside class="ft-flow" id="ftFlow" hidden aria-labelledby="ftFlowH">
    <h2 class="ft-flow-h" id="ftFlowH">Recent flow</h2>
    <ol class="ft-flow-l" id="ftFlowL"></ol>
    <p class="ft-flow-s" id="ftFlowS"></p>
  </aside>
    </div>
    <div class="ft-col">

  <aside class="ft-lv" id="ftLv" hidden aria-labelledby="ftLvH">
    <h2 class="ft-lv-h" id="ftLvH">Key levels</h2>
    <ol class="ft-lv-l" id="ftLvL"></ol>
    <p class="ft-lv-s" id="ftLvS"></p>
  </aside>

  <aside class="ft-rel" id="ftRel" hidden aria-labelledby="ftRelH">
    <h2 class="ft-rel-h" id="ftRelH">Others in this sector</h2>
    <div class="ft-rel-l" id="ftRelL"></div>
    <p class="ft-rel-s" id="ftRelS"></p>
  </aside>
    </div>
  </div>

  <div class="ft-band4">

  <section class="ft-ivt" id="ftIvt" hidden aria-labelledby="ftIvtH">
    <h2 class="ft-chart-h ft-ivt-h" id="ftIvtH">Implied volatility term structure</h2>
    <div class="ft-chart-body" id="ftIvtBody"></div>
    <p class="ft-chart-s" id="ftIvtS"></p>
  </section>
  </div>
    </div>
  </div>

  <header class="ft-head" id="ftHead" hidden>
    <h2 id="ftTicker" tabindex="-1">&nbsp;</h2>
    <span class="fc-score" id="ftScore"></span>

    <span class="fc-meta" id="ftConv"></span>
    <span class="fc-meta" id="ftRegime"></span>
    <span class="fc-meta" id="ftDates"></span>

    <button type="button" class="ft-switch" id="ftSwitch" hidden>Switch name</button>
  </header>

  <section class="ft-picker" id="ftPicker" hidden aria-labelledby="ftPickerH">
    <h2 id="ftPickerH">Every name on today’s board</h2>

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
  </div>
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

<script src="${v("/assets/js/flows-cursor.js")}" defer></script>
<script src="${v("/assets/js/flows-panels.js")}" defer></script>
<script src="${v("/assets/js/flows-ticker.js")}" defer></script>
</body>
</html>`;
}

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

export function politicalPage({ username = "" } = {}) {
  const lede = "Who disclosed the largest purchases, and in what — ranked by " +
    "size, with the range each filing actually stated drawn across it.";
  return `${head("Flows — Political", lede)}
${shell("Political Disclosures", "Options-flow intelligence", "political", username, `
  <div class="flows-status" id="plStatus" role="status">Loading the disclosure window…</div>
  <p class="flows-stale" id="plStale" role="status" hidden></p>
  <p class="flows-stale" id="plSource" role="status" hidden></p>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

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

export function askPage({ username = "" } = {}) {

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

  <div class="sg-desk">
  <div class="sg-desk__book">
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

    <div class="fc-note" id="sgChainNote"></div>
    <div class="flows-tablewrap sg-chainwrap" id="sgChainWrap" tabindex="0" role="region"
         aria-label="Listed contracts at the selected expiry" hidden>
      <table class="flows-table sg-chain">
        <caption class="flows-caption">
          Every contract the vendor lists at this expiry, unfiltered. Click an
          ASK to buy that contract and a BID to sell it — the side each price is
          actually dealt on. The premium desk screens this same endpoint down to
          what is sellable; this page does not, because a long in-the-money call
          is a position a reader builds and the desk&#39;s universe cannot express
          it. A greek the vendor did not send is an em dash — the vendor marks
          all five nullable and its own example carries a row with none of them.
        </caption>

        <thead>
          <tr>
            <th scope="col" colspan="4" class="sg-side">Calls</th>

            <th scope="col" class="c-num sg-k"><span class="visually-hidden">Strike</span></th>
            <th scope="col" colspan="4" class="sg-side">Puts</th>
          </tr>
          <tr>
            <th scope="col" class="c-num"><abbr title="Delta as quoted, per share">&#916;</abbr></th>
            <th scope="col" class="c-num"><abbr title="The vendor's implied volatility for this contract, as a fraction. The percent-or-fraction convention is decided once from the whole expiry's median, never per contract">IV</abbr></th>
            <th scope="col" class="c-num"><abbr title="The bid. Click it to SELL this contract — a short leg is opened at the bid, which is the price a seller is actually offered">Bid</abbr></th>
            <th scope="col" class="c-num"><abbr title="The ask. Click it to BUY this contract — a long leg is opened at the ask, which is the price a buyer actually pays">Ask</abbr></th>
            <th scope="col" class="c-num sg-k">Strike</th>
            <th scope="col" class="c-num"><abbr title="The bid. Click it to SELL this contract">Bid</abbr></th>
            <th scope="col" class="c-num"><abbr title="The ask. Click it to BUY this contract">Ask</abbr></th>
            <th scope="col" class="c-num"><abbr title="The vendor's implied volatility for this contract, as a fraction">IV</abbr></th>
            <th scope="col" class="c-num"><abbr title="Delta as quoted, per share">&#916;</abbr></th>
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

  </div>
  <div class="sg-desk__work">

  <section class="fc-panel sg-panel" id="sgPlotPanel" hidden aria-labelledby="sgPlotH">
    <h2 class="fc-panel-h" id="sgPlotH">Payoff at expiry</h2>
    <div id="sgPlot"></div>
    <p class="fc-note" id="sgPlotNote"></p>
  </section>

  <section class="fc-panel sg-panel" id="sgReadPanel" hidden aria-labelledby="sgReadH">
    <h2 class="fc-panel-h" id="sgReadH">What it costs, what it can pay, what it is exposed to</h2>
    <div id="sgReadings"></div>
    <p class="fc-note" id="sgReadNote"></p>
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
  </div>
  </div>

  <section class="fc-panel sg-panel" id="sgRefusePanel" aria-labelledby="sgRefuseH">
    <h2 class="fc-panel-h" id="sgRefuseH">What this page will not tell you</h2>
    <dl class="sg-refuse">
      <div class="sg-refuse-i">
        <dt>Buying power reduction</dt>
        <dd>
          <strong>Refused.</strong> It is a broker&#39;s number, not the market&#39;s:
          the same short put reduces buying power by different amounts at two
          brokers on the same afternoon, and by different amounts again in a
          portfolio-margin account. Nothing in the vendor&#39;s specification
          mentions buying power, margin or collateral anywhere in its 28,755
          lines. Publishing one would be inventing a figure about your money.
        </dd>
      </div>
      <div class="sg-refuse-i">
        <dt>Conditional value at risk</dt>
        <dd>
          <strong>Refused.</strong> A tail expectation is an average over a
          distribution, and no distribution is quoted anywhere on this page. It
          would need a volatility surface, a drift and a horizon, none of which
          the vendor supplies and all of which would be chosen here. The
          distribution-free statement this page can make instead is the maximum
          loss at expiry, which is below and is exact.
        </dd>
      </div>
      <div class="sg-refuse-i">
        <dt>Beta-weighted delta</dt>
        <dd>
          <strong>Published, with its terms stated.</strong> It is not delta
          times beta. It is delta &#215; beta &#215; (this stock&#39;s price &#247; the
          index&#39;s price), so it needs a reference index and that index&#39;s live
          price, and it is a different number against a different index. Both
          are named and printed in the readings above rather than assumed, and
          when either is missing the reading is an em dash — never a zero.
        </dd>
      </div>
      <div class="sg-refuse-i">
        <dt>A share leg</dt>
        <dd>
          <strong>Not offered yet.</strong> A covered call or a collar cannot be
          expressed here, because this page builds positions out of listed
          contracts only. Said out loud rather than left for you to discover by
          looking for a control that is not there.
        </dd>
      </div>
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

