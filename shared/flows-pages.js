export const ASSET_VERSION = "228";

const v = (path) => `${path}?v=${ASSET_VERSION}`;

const head = (title, description, styles = []) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#07090e">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${v("/assets/css/base.css")}">
<link rel="stylesheet" href="${v("/assets/css/flows.css")}">
${styles.map((href) => `<link rel="stylesheet" href="${v(String(href))}">`).join("\n")}
</head>`;

const GLYPHS = {
  info: '<circle cx="12" cy="12" r="9.25"/><path d="M12 11v5.5"/><circle cx="12" cy="7.6" r="1.2" fill="currentColor" stroke="none"/>',
  live: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8.5" opacity=".35"/>',
  closed: '<path d="M19.6 14.7A8.2 8.2 0 0 1 9.3 4.4a8.2 8.2 0 1 0 10.3 10.3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  pending: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2.3 3.05"/>',
  quiet: '<circle cx="12" cy="12" r="9"/><path d="M8.2 12h7.6"/>',
  withheld: '<path d="M3 12s3.3-6 9-6c1.6 0 3 .4 4.2 1.1M21 12s-3.3 6-9 6c-1.7 0-3.1-.5-4.3-1.2"/><path d="M9.9 14.1a3 3 0 0 1 4.2-4.2"/><path d="M4.5 19.5 19.5 4.5"/>',
  unavailable: '<circle cx="12" cy="12" r="9"/><path d="M5.7 18.3 18.3 5.7"/>',
  up: '<path d="M12 4.5 21 19H3z" fill="currentColor" stroke="none"/>',
  down: '<path d="M12 19.5 3 5h18z" fill="currentColor" stroke="none"/>',
  flat: '<rect x="4" y="10" width="16" height="4" rx="2" fill="currentColor" stroke="none"/>',
  gamma: '<path d="M5 7c2.5 0 3.6 1.9 5 5.5L12 17l2-4.5C15.4 9 16.5 7 19 7"/><path d="M12 17c-1 1.4-1.1 3.1 0 3.4 1.1-.3 1-2 0-3.4"/>',
  vega: '<path d="M6 7l6 11c3.5-3 5.5-7 5.5-11"/>',
  expand: '<path d="M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z"/>',
  neuron: '<path d="M11 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z"/><path d="M18.5 15c.2 1.6.8 2.2 2.4 2.4-1.6.2-2.2.8-2.4 2.4-.2-1.6-.8-2.2-2.4-2.4 1.6-.2 2.2-.8 2.4-2.4z"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  stop: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="3.2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  hall: '<path d="M4 20h16M5.5 17h13M7 10.5V17M10.3 10.5V17M13.7 10.5V17M17 10.5V17M3.8 9.5 12 4.5l8.2 5z"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.8" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="17" r="1" fill="currentColor" stroke="none"/>',
  stack: '<rect x="4" y="9" width="16" height="11" rx="2.8"/><path d="M6.5 6h11M9 3.2h6"/>',
  wave: '<path d="M3 12.5c2.3-5.3 4.7-5.3 7 0s4.7 5.3 7 0c1.2-2.7 2.5-3.5 4-3"/>',
  levels: '<path d="M4 7h16M4 12h9M4 17h16"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z"/>',
  uncovered: '<path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z"/><path d="M4 4l16 16"/>',
  home: '<path d="M4 10.4 12 4l8 6.4V19a1.2 1.2 0 0 1-1.2 1.2H14.5v-5.4h-5v5.4H5.2A1.2 1.2 0 0 1 4 19z"/>',
  long: '<path d="M4 17l5.2-5.2 3.6 3.6L20 8.2"/><path d="M15 8h5v5"/>',
  short: '<path d="M4 7l5.2 5.2 3.6-3.6L20 15.8"/><path d="M15 16h5v-5"/>',
  market: '<path d="M5 19.5v-5M10 19.5V9M15 19.5v-7.5M20 19.5V5.5"/>',
  unusual: '<path d="M13.2 3 5.5 13.4h6L10.8 21l7.7-10.4h-6z"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v5.6L5.4 17.6A2 2 0 0 0 7.1 20.5h9.8a2 2 0 0 0 1.7-2.9l-5.1-8.5V3.5"/><path d="M7.6 14.5h8.8"/>',
  layers: '<path d="M12 4 3.5 8.4 12 12.8l8.5-4.4z"/><path d="M3.5 12.4 12 16.8l8.5-4.4"/><path d="M3.5 16.2 12 20.6l8.5-4.4"/>',
  bubble: '<path d="M6 5h12a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 17h-6.2l-4.3 3.4V17H6a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 6 5z"/>',
  track: '<path d="M3 13h3.2l2.3-6 3.4 11 3.2-8.5 1.9 3.5H21"/>',
  history: '<path d="M4.6 12a7.4 7.4 0 1 0 2.2-5.3"/><path d="M4.5 4.6v3.6h3.6"/><path d="M12 8.2V12l2.8 1.8"/>',
  sidebar: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M9.5 5v14"/>',
  boards: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  bars: '<path d="M6 18v-3M12 18v-7M18 18V7"/>',
};

const SPRITE = `<svg class="ui-sprite" aria-hidden="true" focusable="false" width="0" height="0">${
  Object.entries(GLYPHS).map(([k, d]) => `<symbol id="g-${k}" viewBox="0 0 24 24">${d}</symbol>`).join("")}</svg>`;

const glyph = (name) => `<svg class="ui-g" aria-hidden="true" focusable="false"><use href="#g-${name}"/></svg>`;

const initials = (username) => {
  const name = String(username || "").trim();
  if (!name) return "—";
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const said = parts.length >= 2
    ? parts[0].slice(0, 1) + parts[1].slice(0, 1)
    : name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  return escapeHTML(said.toUpperCase() || "—");
};

const sitePill = () => `
<header class="topbar">
  <a class="topbar__brand" href="/" aria-label="Home">&#949;</a>
  <nav class="pill" aria-label="Primary">
    <a href="/">Home</a>
    <a href="/articles/">Articles</a>
    <a href="/lab/"><span class="lab-full">Econometrics&nbsp;Lab</span><span class="lab-short">Lab</span></a>
    <a href="/flows/" class="is-active" aria-current="page">Flows</a>
  </nav>
</header>`;

export const FLOWS_NAV = [
  { group: "Today", id: "railToday", items: [
    { key: "overview", href: "/flows/", label: "Home", glyph: "home", title: "Today" },
    { key: "watch", href: "/flows/watch/", label: "Watchlist", glyph: "star", count: true },
  ] },
  { group: "Boards", id: "railBoards", items: [
    { key: "long", href: "/flows/long/", label: "Bullish", glyph: "long", count: true },
    { key: "short", href: "/flows/short/", label: "Bearish", glyph: "short", count: true },
  ] },
  { group: "Market", id: "railMarket", items: [
    { key: "market", href: "/flows/market/", label: "Market", glyph: "market" },
    { key: "unusual", href: "/flows/unusual/", label: "Unusual", glyph: "unusual" },
    { key: "events", href: "/flows/events/", label: "Events", glyph: "cal", count: true },
    { key: "political", href: "/flows/political/", label: "Political", glyph: "hall" },
  ] },
  { group: "Tools", id: "railTools", items: [
    { key: "strategy", href: "/flows/strategy/", label: "Strategy", glyph: "flask" },
    { key: "desk", href: "/flows/desk/", label: "Premium desk", glyph: "layers" },
    { key: "ask", href: "/flows/ask/", label: "Ask", glyph: "bubble" },
  ] },
  { group: "Record", id: "railRecord", items: [
    { key: "track", href: "/flows/track/", label: "Track", glyph: "track" },
    { key: "history", href: "/flows/history/", label: "History", glyph: "history" },
  ] },
];

const TABS = [
  { href: "/flows/", label: "Home", glyph: "home", keys: ["overview"] },
  { href: "/flows/long/", label: "Boards", glyph: "boards", keys: ["long", "short"] },
  { href: "/flows/ticker/", label: "Search", glyph: "search", keys: ["ticker"], search: true },
  { href: "/flows/market/", label: "Market", glyph: "market", keys: ["market", "unusual", "events", "political"] },
  { href: "/flows/ask/", label: "Ask", glyph: "bubble", keys: ["ask"] },
];

const sidebar = (active, username) => {
  const item = (it) => {
    const on = it.key === active;
    const badge = it.count ? `<span class="rail-count" data-rail-count="${it.key}" hidden></span>` : "";
    return `<a href="${it.href}"${on ? ' class="is-on" aria-current="page"' : ""}>` +
      `${glyph(it.glyph)}<span class="rail-label">${it.label}</span>${badge}</a>`;
  };
  const who = escapeHTML(String(username || ""));
  return `
<aside class="fx-side" id="fxSide" aria-label="Sidebar">
  <div class="fx-side-h">
    <a class="fx-mark" href="/" aria-label="anilkaya.org">&#949;</a>
    <span class="fx-side-t">Flows</span>
  </div>
  <nav class="flows-rail" aria-label="Flows">${FLOWS_NAV.map((g) => `
    <p class="rail-group" id="${g.id}">${g.group}</p>
    <div class="rail-items" role="group" aria-labelledby="${g.id}">
      ${g.items.map(item).join("\n      ")}
    </div>`).join("")}
  </nav>
  <div class="fx-side-f">
    <nav class="fx-site" aria-label="Site">
      <a href="/">Home</a><a href="/articles/">Articles</a><a href="/lab/">Lab</a><a href="/flows/" aria-current="true">Flows</a>
    </nav>
    <div class="fx-who">
      <span class="fx-avatar" aria-hidden="true">${initials(username)}</span>
      <span class="fx-who-n" title="Signed in as ${who}">${who}</span>
      <form method="POST" action="/flows/logout" class="fx-out">
        <button type="submit" class="flows-signout">Sign out</button>
      </form>
    </div>
  </div>
</aside>
<div class="fx-scrim" id="fxScrim"></div>`;
};

const toolbar = (title, active, hero) => `
<header class="topbar fx-bar${hero ? " has-hero" : ""}" id="fxBar">
  <button type="button" class="fx-iconbtn" id="fxSideBtn" aria-controls="fxSide"
          aria-expanded="false" aria-label="Sidebar">${glyph("sidebar")}</button>
  <span class="fx-bar-t" id="fxBarT" aria-hidden="true">${title}</span>
  <span class="fx-bar-sp"></span>
  <a class="fx-search" id="fxSearch" href="/flows/ticker/" aria-haspopup="dialog"
     aria-keyshortcuts="Meta+K Control+K">${glyph("search")}<span class="fx-search-l">Search</span><kbd>&#8984;K</kbd></a>${dockTab(active)}
  <button type="button" class="ui-fresh" id="fxFresh" data-state="pending"
          aria-haspopup="dialog" aria-label="Freshness">${glyph("pending")}<span class="fx-fresh-l">Session</span></button>
</header>`;

const tabbar = (active) => `
<nav class="fx-tabs" id="fxTabs" aria-label="Sections">${TABS.map((t) => `
  <a href="${t.href}"${t.search ? " data-fx-search" : ""}${t.keys.includes(active) ? ' aria-current="true"' : ""}>${glyph(t.glyph)}<span>${t.label}</span></a>`).join("")}
</nav>`;

const dockTab = (active) => (active === "ask" ? "" : `
  <button type="button" class="ak-dock-tab" id="askDockTab"
          aria-expanded="false" aria-controls="askDockPanel"
          aria-keyshortcuts="?" title="Ask about what has been published — press ? to open">${glyph("bubble")}<span class="ak-dock-tab-l">Ask</span><span class="ak-dock-tab-k" aria-hidden="true">?</span></button>`);

const dock = (active) => (active === "ask" ? "" : `
<aside class="ak-dock" id="askDock" data-src="${v("/assets/js/flows-ask.js")}" data-css="${v("/assets/css/flows-ask.css")}">
  <div class="ak-dock-scrim" hidden></div>
  <div class="ak-dock-panel" id="askDockPanel" role="complementary"
       aria-label="Ask about the published readings" hidden tabindex="-1">
    <div class="ak-dock-head">
      <p class="ak-dock-title">${glyph("neuron")}Ask</p>
      <button type="button" class="ak-dock-close" aria-label="Close the assistant">${glyph("x")}</button>
    </div>
    <p class="visually-hidden" id="askStatus" role="status"></p>
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

export function modelName(id) {
  if (typeof id !== "string" || !id) return "a language model";
  if (!id.startsWith("@cf/")) return id;
  const words = id.split("/").pop().split("-")
    .filter((w) => !/^(fp8|fp16|int8|int4|awq|fast|instruct|it|chat|hf)$/i.test(w));
  return words.map((w) => (/^\d/.test(w) || /^(gpt|oss)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

export function neuronProvenance(summary) {
  if (summary.llm) {
    return "Wording by " + escapeHTML(modelName(summary.model)) + "; figures measured by the pipeline.";
  }
  const guard = typeof summary.guard === "string" ? summary.guard : "";

  if (guard === "invented") return "Deterministic reading. A model\u2019s wording named an unsupported figure and was refused.";
  if (guard === "forecast") return "Deterministic reading. A model\u2019s wording claimed what happens next and was refused.";
  if (guard === "ideas:unparsable") return "Deterministic reading: the model\u2019s reply could not be parsed.";
  if (guard === "summary:empty") return "Deterministic reading: the model returned ideas without a summary.";
  if (guard.startsWith("unreachable:reparse:")) {
    const why = guard.slice("unreachable:reparse:".length);
    return "Deterministic reading: the model\u2019s reply carried no usable summary, and asking it again " +
      (why === "allowance" ? "found the day\u2019s free model allowance spent, resetting 00:00 UTC"
        : why === "capacity" ? "found no capacity"
          : why === "plan" ? "found the configured model not available on this plan"
            : "failed") + ".";
  }
  if (guard.startsWith("unreachable:")) {
    const why = guard.slice("unreachable:".length);
    const said = why === "allowance" || why === "3036"
      ? "the day\u2019s free model allowance is spent, resetting 00:00 UTC"
      : why === "capacity" || why === "3040" ? "the model had no capacity, and nothing was spent"
        : why === "plan" || why === "5035" ? "the configured model is not available on this plan"
          : why === "empty" ? "the model answered with nothing"
            : why === "length" ? "the model spent its whole answer budget before writing any text"
              : "the model did not answer";
    return "Deterministic reading: " + said + ".";
  }
  return "Deterministic reading. No model was asked.";
}

function neuronVerdict(summary) {
  const glyphTile = `<span class="hm-verdict-g" aria-hidden="true">${glyph("neuron")}</span>`;
  if (!summary || typeof summary.text !== "string" || !summary.text.trim()) {
    return `
  <section class="ui-card hm-verdict is-pending" id="hmVerdict" aria-labelledby="hmVerdictT">
    <div class="hm-verdict-h">
      ${glyphTile}
      <div class="hm-verdict-b">
        <h2 class="hm-verdict-line" id="hmVerdictT">No summary yet</h2>
        <div class="hm-verdict-meta"><span class="hm-verdict-by">Neuron</span>
          <span class="ui-state hm-mark" data-state="quiet" title="Quiet" aria-label="Quiet: the written summary for this session has not been generated yet.">${glyph("quiet")}</span></div>
      </div>
    </div>
  </section>`;
  }
  const text = String(summary.text).trim();
  const cut = /^(.+?[.!?])(\s+[A-Z(\u2212+\-\d])/.exec(text);
  const headline = cut ? cut[1] : text;
  const rest = cut ? text.slice(cut[1].length).trim() : "";
  const at = typeof summary.generatedAt === "string" && summary.generatedAt ? summary.generatedAt : null;
  const when = at
    ? `<time datetime="${escapeHTML(at)}">${escapeHTML(at.slice(0, 10))} ${escapeHTML(at.slice(11, 16))} UTC</time>`
    : "";
  return `
  <section class="ui-card hm-verdict${summary.llm ? " is-llm" : ""}" id="hmVerdict" aria-labelledby="hmVerdictT">
    <div class="hm-verdict-h">
      ${glyphTile}
      <div class="hm-verdict-b">
        <h2 class="hm-verdict-line" id="hmVerdictT">${escapeHTML(headline)}</h2>
        <div class="hm-verdict-meta"><span class="hm-verdict-by">Neuron</span>${when}</div>
      </div>
      <button class="hm-more" type="button" id="hmNeuronMore" aria-expanded="false" aria-controls="hmNeuronX"><span>More</span>${glyph("chev")}</button>
    </div>
    <div class="hm-verdict-x" id="hmNeuronX" hidden>
      ${rest ? `<p class="hm-verdict-rest">${escapeHTML(rest)}</p>` : ""}
      <p class="hm-verdict-src"${summary.llm && summary.model ? ` title="${escapeHTML(summary.model)}"` : ""}>${neuronProvenance(summary)}</p>
    </div>
  </section>`;
}

const pageHead = (title, active) => `
  <header class="flows-head${active === "ticker" ? " flows-head--quiet" : ""}"${active === "ticker" ? "" : " data-fx-hero"}>
    <h1 id="fxTitle">${title}</h1>
  </header>`;

const UI_SCRIPT = `<script src="${v("/assets/js/flows-ui.js")}" defer></script>`;

const shell = (title, active, username, body, { chrome = true } = {}) => {
  const lead = chrome ? pageHead(title, active) : "";
  return `
<body class="flows-body has-rail" data-flows-page="${active}">
${SPRITE}
<a class="flows-skip" href="#flowsMain">Skip to content</a>
${sidebar(active, username)}
${toolbar(title, active, /data-fx-hero/.test(lead + body))}
<main class="flows-main" id="flowsMain" tabindex="-1">
${lead}
${body}
</main>
${tabbar(active)}
${dock(active)}`;
};

export function loginPage({ error = "" } = {}) {

  const message = error
    ? `<p class="flows-alert" role="alert">${escapeHTML(error)}</p>`
    : "";
  return `${head("Flows — Sign in", "Restricted options-flow intelligence.")}
<body class="flows-body">
${sitePill()}
<main class="flows-auth">
  <div class="flows-auth__card">
    <span class="fx-mark" aria-hidden="true">&#949;</span>
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

const homeModule = (id, title, bodyId, { span = "", sub = "", seg = "", body = "" } = {}) => `
    <section class="ui-card ui-mod hm-mod${span ? " ui-span-" + span : ""}" id="${id}" aria-labelledby="${id}T">
      <header class="ui-mod-h"><h2 class="ui-mod-t" id="${id}T">${title}</h2><span class="ui-mod-sp"></span>${sub}${seg}</header>
      ${body || `<div class="hm-body" id="${bodyId}"></div>`}
    </section>`;

export function overviewPage({ username = "", summary = null } = {}) {
  return `${head("Flows — Home", "The market in one glance: the tide, the regime, both leaders, what changed and what reports next.", ["/assets/css/flows-home.css"])}
${shell("Session", "overview", username, `
  <header class="flows-head hm-head" data-fx-hero>
    <h1 id="fxTitle">Session</h1>
    <p class="hm-meta"><time id="ccMetaDate"></time><span id="ccMetaScreened" hidden></span><span id="hmStale"></span></p>
  </header>
  <p class="visually-hidden" id="flowsStatus" role="status">Loading the latest session…</p>
  <p class="visually-hidden" id="flowsStale" role="status" hidden></p>

  <div class="ui-grid hm-grid">
    <section class="ui-card hm-hero" id="hmHero" aria-labelledby="hmHeroT"><div class="hm-hero-in">
      <div class="hm-hero-id">
        <div class="hm-hero-k"><h2 class="hm-hero-t" id="hmHeroT">Market tide</h2><span id="hmTideState"></span></div>
        <div class="hm-hero-v" id="hmTideV" data-tone="silent">—</div>
        <div class="hm-hero-cap" id="hmTideCap"></div>
        <div class="hm-hero-legs" id="hmTideLegs"></div>
      </div>
      <div class="hm-hero-chart" id="hmTide"></div>
      <div class="hm-hero-chips" id="ccVerdict" role="group" aria-label="Session readings"></div>
    </div></section>
${neuronVerdict(summary)}
${homeModule("hmBull", "Bullish", "ccBull", { span: 6, sub: `<a class="hm-count cc-bull" href="/flows/long/" id="ccBullSub" hidden></a>` })}
${homeModule("hmBear", "Bearish", "ccBear", { span: 6, sub: `<a class="hm-count cc-bear" href="/flows/short/" id="ccBearSub" hidden></a>` })}
${homeModule("hmChg", "What changed", "ccChg", { span: 7, sub: `<span class="hm-count" id="ccChgSub"></span>`,
    body: `<div class="hm-body" id="ccChg"><div id="ccChgStats"></div><div class="hm-spine" id="spinePlot"></div><div id="ccChgNote"></div><div id="ccChgList"></div></div>` })}
${homeModule("hmVol", "Volatility", "ccVol", { span: 5 })}
${homeModule("hmLean", "Sectors", "ccLean", { sub: `<span class="hm-count" id="ccLeanSub"></span>`, seg: `<div class="hm-seg" id="ccLeanSeg"></div>` })}
${homeModule("hmAlerts", "Flagged", "ccAlerts", { span: 4, sub: `<a class="hm-count" href="/flows/unusual/" id="ccAlertsSub"></a>` })}
${homeModule("hmEvents", "Reporting", "ccEvents", { span: 4, sub: `<a class="hm-count" href="/flows/events/" id="ccEventsSub"></a>` })}
${homeModule("hmWatch", "Nearly in", "ccWatch", { span: 4, sub: `<a class="hm-count" href="/flows/watch/" id="ccWatchSub"></a>` })}
${homeModule("hmNews", "Headlines", "ccNews", { sub: `<span class="hm-count" id="ccNewsSub"></span>` })}
  </div>

  <p class="flows-foot hm-foot"><span class="foot-hit" id="flowsHitRate"><a href="/flows/history/">Track record</a></span></p>
`, { chrome: false })}
${UI_SCRIPT}
<script src="${v("/assets/js/flows-fresh.js")}" defer></script>
<script src="${v("/assets/js/flows-overview.js")}" defer></script>
</body>
</html>`;
}

const SECTOR_GLYPHS = {
  tech: '<rect x="7" y="7" width="10" height="10" rx="2.2"/><path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3"/>',
  health: '<path d="M9.6 4h4.8v5.6H20v4.8h-5.6V20H9.6v-5.6H4V9.6h5.6z"/>',
  fin: '<path d="M4 20h16M5.5 17h13M7 10.5V17M10.3 10.5V17M13.7 10.5V17M17 10.5V17M3.8 9.5 12 4.5l8.2 5z"/>',
  disc: '<path d="M5.6 8.5h12.8l-1.1 11.5H6.7z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  staples: '<path d="M4 9.5h16l-1.9 10H5.9z"/><path d="M8.5 9.5 11 4.5M15.5 9.5 13 4.5"/>',
  ind: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9 18 18M6 18l2.1-2.1M15.9 8.1 18 6"/>',
  energy: '<path d="M12 3.5c1 3.4 5 5.2 5 9.8a5 5 0 0 1-10 0c0-2.5 1.3-3.9 2.5-5.2.3 1.5 1 2.5 2.1 3C11.4 8.6 11 6.2 12 3.5z"/>',
  mat: '<path d="M12 3.8 19.2 7.7v8.6L12 20.2l-7.2-3.9V7.7z"/><path d="M4.8 7.7 12 11.6l7.2-3.9M12 11.6v8.6"/>',
  re: '<path d="M4 10.4 12 4l8 6.4V19a1.2 1.2 0 0 1-1.2 1.2H14.5v-5.4h-5v5.4H5.2A1.2 1.2 0 0 1 4 19z"/>',
  util: '<path d="M9 3.5v4.5M15 3.5v4.5M6.5 8h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5v4"/>',
  comm: '<circle cx="12" cy="12" r="1.8"/><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.7 5.7a8.9 8.9 0 0 0 0 12.6M18.3 5.7a8.9 8.9 0 0 1 0 12.6"/>',
  none: '<circle cx="12" cy="12" r="3"/>',
};

const SECTOR_SPRITE = `<svg class="ui-sprite" aria-hidden="true" focusable="false" width="0" height="0">${
  Object.entries(SECTOR_GLYPHS).map(([k, d]) => `<symbol id="g-sec-${k}" viewBox="0 0 24 24">${d}</symbol>`).join("")}</svg>`;

const BOARD_SIDES = [
  { key: "long", href: "/flows/long/", label: "Bullish", glyph: "long" },
  { key: "short", href: "/flows/short/", label: "Bearish", glyph: "short" },
  { key: "watch", href: "/flows/watch/", label: "Watch", glyph: "star" },
];

const boardBody = (key, { status, body, label }) => `
  <nav class="bd-sides" aria-label="Boards">${BOARD_SIDES.map((b) =>
    `<a href="${b.href}"${b.key === key ? ' aria-current="page"' : ""}>${glyph(b.glyph)}<span>${b.label}</span></a>`).join("")}</nav>
  <div class="bd-hero" id="bdHero" hidden></div>
  <section class="ui-card ui-mod bd-mod" id="bdMod" aria-labelledby="bdModT">
    ${SECTOR_SPRITE}
    <p class="visually-hidden" id="${status}" role="status">Loading the latest session\u2026</p>
    <header class="ui-mod-h"><h2 class="ui-mod-t" id="bdModT">${key === "watch" ? "Near the edge" : "Names"}</h2><span class="ui-mod-sp"></span></header>
    <div class="bd-tools" id="bdTools"></div>
    <div class="bd-table" id="bdTable" data-board="${key === "watch" ? "watch" : "side"}" role="table" aria-label="${label}" aria-describedby="${status}">
      <div class="bd-head" role="rowgroup"><div class="bd-row bd-hrow" role="row" id="bdHead"></div></div>
      <div class="bd-body" role="rowgroup" id="${body}" aria-busy="true"></div>
    </div>
    ${key === "watch" ? "" : '<div class="bd-map" id="bdMap" hidden></div>'}
    <div class="bd-empty" id="bdEmpty" hidden></div>
  </section>
  <p class="flows-foot bd-foot"><span class="foot-hit" id="flowsHitRate"><a href="/flows/history/">${glyph("history")}<span>Track record</span></a></span></p>
`;

export function sidePage({ username = "", side = "long" } = {}) {
  const bear = side === "short";
  const title = bear ? "Bearish candidates" : "Bullish candidates";
  const lede = bear
    ? "Names leaning bearish this session, ranked by score."
    : "Names leaning bullish this session, ranked by score.";
  return `${head("Flows \u2014 " + title, lede, ["/assets/css/flows-boards.css"])}
${shell(bear ? "Bearish" : "Bullish", bear ? "short" : "long", username,
    boardBody(bear ? "short" : "long", { status: "flowsStatus", body: "flowsBody", label: "Ranked candidates" }))}
${UI_SCRIPT}
<script src="${v("/assets/js/flows-board.js")}" defer></script>
</body>
</html>`;
}

export function deskPage({ username = "" } = {}) {
  return flowsDocument({
    title: "Premium desk",
    description: "Option sales across your names, priced by the engine and ranked on a frontier.",
    active: "desk", username,
    styles: ["/assets/css/flows-tools.css"],
    scripts: ["/assets/js/flows-quant.bundle.js", "/assets/js/flows-desk.js"],
    body: `
  <div class="tl dk" id="dkMain">
    <section class="ui-card dk-bar" aria-label="Desk controls">
      <div class="dk-row1">
        <form class="tl-find dk-find" id="deskEntry" role="search" autocomplete="off">
          <label class="visually-hidden" for="deskInput">Add symbols</label>
          ${glyph("search")}
          <input id="deskInput" name="tickers" type="text" inputmode="latin" autocapitalize="characters" autocorrect="off"
                 spellcheck="false" placeholder="Add symbols" enterkeyhint="go">
          <button type="submit" class="desk-add">Add</button>
        </form>
        <div class="tl-stripw dk-chipw"><div class="dk-chips" id="deskList" role="group" aria-label="Watchlist"></div></div>
      </div>
      <div class="dk-row2" id="dkFilters">
        <label class="dk-all"><input type="checkbox" id="deskAll"><span>All names</span></label>
        <button type="button" class="dk-pill" id="deskRefresh">Refresh</button>
        <button type="button" class="dk-pill" id="deskClear">Remove all</button>
      </div>
      <p class="dk-note visually-hidden" id="deskStatus" role="status">Add a symbol to begin.</p>
    </section>
    <div class="ui-grid dk-grid" id="dkGrid"></div>
    <p class="visually-hidden" id="deskFoot" role="note"></p>
  </div>
  <div id="dkCopy" hidden>
      <p data-k="bp">Cash. Puts are sized cash-secured, the whole strike reserved, so this under-counts what a margin account could write. Held in this page&#39;s address so a reload keeps it, which means a link you share carries it too.</p>
      <p data-k="frontier">Every sellable line on the desk as a point: annualised yield up, risk across. The frontier joins the lines no other line beats on both, so a point below it pays less for the same risk.</p>
      <p data-k="frontier-x">Delta is the forward delta of the short option on its own implied volatility; the implied chance of profit is the engine&#39;s, on the same volatility. A point pinned to the top edge pays more than the axis shows.</p>
      <p data-k="engine">Each line is priced by the same engine as the strategy lab, on a flat slice at the contract&#39;s own implied volatility, inverted from its mid: the model value is the mid, and the chance of profit is the lognormal one at that volatility. The smile&#39;s skew correction is not in this number; open the line in the lab for the smile-priced figure. The real-world figures use the GARCH law the name&#39;s card publishes, and are an em dash where no card carries one.</p>
      <p data-k="premium">Premium is what the bid pays today; the mid is not a price anyone must trade at. Where a strike is in the money, part of the premium is intrinsic value that assignment returns rather than keeps.</p>
      <p data-k="annualized">Simple 365 over days scaling of the yield. A convention for comparing tenors, not a return anyone earns.</p>
      <p data-k="cushion">Distance from spot to breakeven in units of the move this option&#39;s own implied volatility prices over its remaining life. Not a probability.</p>
      <p data-k="smile">Each cell is one quoted contract&#39;s implied volatility, shaded by how far it sits above or below its own expiry&#39;s at-the-money level, so a seller can see where the smile pays for the risk.</p>
      <p data-k="sm-shade">The shade is that volatility against its own expiry&#39;s at-the-money quote — hatched below it, plain above — so the smile is readable without the term structure swamping it. The strip beneath the grid, read left to right, is the term structure.</p>
      <p data-k="sm-num">The number in a cell is the contract&#39;s own quoted implied volatility.</p>
      <p data-k="sm-narrow">The columns are too narrow at this width to print a volatility inside each cell, so every cell carries its own in a tooltip instead.</p>
      <p data-k="sm-nolevel">Those columns carry their quoted volatilities and no shade, and the term-structure line does not bridge them.</p>
      <p data-k="sm-last">This vendor&#39;s implied volatility is the LAST TRANSACTION&#39;s, not a quote.</p>
      <p data-k="sm-fresh">every cell on this surface is a print from today.</p>
      <p data-k="sm-aged">so their volatility is of unknown age. Those cells are drawn with a broken border and NONE of them set an expiry&#39;s level — a stale cell is one marked number, but a stale level would tilt a whole column&#39;s smile with no marker on any cell it moved.</p>
      <p data-k="sm-built">Built from every contract with a two-sided quote, before the liquidity gates that decide the lines above and regardless of the Sell toggle — those gates fall hardest on the wings, and a smile with its tails cut off is a different smile.</p>
      <p data-k="sm-cut">This chain is larger than the desk fetches, so the surface is taken over a partial chain.</p>
      <p data-k="sm-quoted">Quoted volatilities, and differences between quoted volatilities on the same expiry. Nothing here is fitted, interpolated or repriced.</p>
      <p data-k="sm-crowd">contracts fall in this row of this column; the one shown is the print this surface prefers — today&#39;s first, then nearest the row&#39;s centre. The cell is never an average of quotes.</p>
      <p data-k="sm-untraded">This contract has NOT traded today, so its implied volatility is the last transaction&#39;s — of unknown age. It is drawn but it did not set this expiry&#39;s level.</p>
      <p data-k="sm-novol">The vendor reported no volume for this contract, so the age of its implied volatility is unknown. It did not set this expiry&#39;s level.</p>
      <p data-k="refuse">Selling options has unbounded loss on the call side and equity-sized loss on the put side. This is a screen, not advice.</p>
  </div>`,
  });
}

export function watchPage({ username = "" } = {}) {
  const lede = "Scored names that did not clear the band on either side, " +
    "ranked by how close they came. Nothing here is a candidate.";
  return `${head("Flows \u2014 Watch", lede, ["/assets/css/flows-boards.css"])}
${shell("Watchlist", "watch", username,
    boardBody("watch", { status: "watchStatus", body: "watchBody", label: "Names inside the dead band" }))}
${UI_SCRIPT}
<script src="${v("/assets/js/flows-board.js")}" defer></script>
</body>
</html>`;
}

const marketModule = (id, title, bodyId, { span = "", sub = "", seg = "", body = "" } = {}) => `
    <section class="ui-card ui-mod mk-mod${span ? " ui-span-" + span : ""}" id="${id}" aria-labelledby="${id}T">
      <header class="ui-mod-h"><h2 class="ui-mod-t" id="${id}T">${title}</h2><span class="ui-mod-sp"></span>${sub}${seg}</header>
      ${body || `<div class="mk-body" id="${bodyId}"></div>`}
    </section>`;

const dossier = (t) => `<a class="mk-dossier" href="/flows/ticker/?t=${t}">Dossier</a>`;

export function marketPage({ username = "" } = {}) {
  return `${head("Flows \u2014 Market", "The market in depth: the session tide, breadth, sectors, index ETFs, expiries, volatility and the market-wide feeds.", ["/assets/css/flows-market.css"])}
${shell("Market", "market", username, `
  <header class="flows-head mk-head" data-fx-hero>
    <h1 id="fxTitle">Market</h1>
    <p class="mk-meta" id="mkMeta"></p><span id="mkStalePill"></span>
  </header>
  <p class="visually-hidden" id="mktStatus" role="status">Loading the session\u2026</p>
  <p class="visually-hidden" id="mktStale" role="status" hidden></p>
  <p class="visually-hidden" id="mkPulseStamp"></p>

  <div class="ui-grid mk-grid">
${marketModule("mkTideCard", "Tide", "mkTide", { seg: `<div class="mk-segc" id="mkTideSeg"></div>`,
    body: `<div class="mk-body"><div id="mkTideLegs"></div><div id="mkTide"></div></div>` })}
${marketModule("mkBreadthCard", "Breadth", "", { span: 5, body: `<div class="mk-body"><div id="mktTilt"></div><div id="mktBreadth"></div></div>` })}
${marketModule("mkTapeCard", "Tape", "mktTape", { span: 7 })}
${["SPY", "QQQ", "IWM"].map((t) => marketModule("mkEtf" + t + "Card", t, "mkEtf" + t, { span: 4, sub: dossier(t) })).join("")}
${marketModule("mkSecTidesCard", "Sector tides", "mkSecTides")}
${marketModule("mkSectorsCard", "Momentum", "mktSectors", { span: 6 })}
${marketModule("mkGroupsCard", "Groups", "mkGroups", { span: 6 })}
${marketModule("mkExpiryCard", "Expiry", "mkExpiry", { span: 5 })}
${marketModule("mkVolCard", "Volatility", "mkVol", { span: 7 })}
${marketModule("mkRadarCard", "Radar", "mkRadar", { span: 6, seg: `<div class="mk-segc" id="mkRadarSeg"></div>` })}
${marketModule("mkAdvCard", "Advancers", "mkAdv", { span: 6 })}
${marketModule("mkVolumeCard", "Volume", "mkVolume", { span: 6, seg: `<div class="mk-segc" id="mkVolumeSeg"></div>` })}
${marketModule("mkAgainstCard", "Against the tape", "mktAgainst", { span: 6 })}
${marketModule("mkMoversCard", "Extremes", "mktMovers", { seg: `<div class="mk-segc mk-seg-phone" id="mkMoversSeg"></div>` })}
${marketModule("mkOiCard", "Open interest", "mkOi", { span: 6 })}
${marketModule("mkDarkCard", "Dark pool", "mkDark", { span: 6 })}
${marketModule("mkImpactCard", "Net impact", "mkImpact", { span: 6 })}
${marketModule("mkInsidersCard", "Insiders", "mkInsiders", { span: 6 })}
${marketModule("mkSeasonCard", "Seasonality", "mkSeason", { seg: `<div class="mk-segc" id="mkSeasonSeg"></div>` })}
  </div>
  <p class="visually-hidden" id="mkPulseFoot"></p>
  <p class="visually-hidden" id="mktFoot"></p>
`, { chrome: false })}
${UI_SCRIPT}
<script src="${v("/assets/js/flows-fresh.js")}" defer></script>
<script src="${v("/assets/js/flows-market.js")}" defer></script>
</body>
</html>`;
}

const FEEDS_CSS = ["/assets/css/flows-feeds.css"];

const feedModule = (id, title, body, { span = "", seg = "" } = {}) => `
    <section class="ui-card ui-mod ui-enter fd-mod${span ? " ui-span-" + span : ""}" id="${id}" aria-labelledby="${id}T">
      <header class="ui-mod-h"><h2 class="ui-mod-t" id="${id}T">${title}</h2><span class="ui-mod-sp"></span>${seg}</header>
      ${body}
    </section>`;

const feedHead = (key, title) => `
  <header class="flows-head fd-head" data-fx-hero>
    <div class="fd-head-t"><h1 id="fxTitle">${title}</h1><span class="fd-about-slot" id="${key}AboutSlot"></span></div>
    <p class="fd-meta" id="${key}Meta"></p>
  </header>`;

export function eventsPage({ username = "" } = {}) {
  return `${head("Flows — Events", "What reports next, what is priced into it, and what else is on the calendar.", FEEDS_CSS)}
${shell("Events", "events", username, `${feedHead("ev", "Events")}
  <p class="visually-hidden" id="evStatus" role="status">Loading the calendar…</p>
  <div class="fd-about" id="evAbout" hidden>
    <p>What the screened universe reports next, what the option market is charging for it,
    and what else is scheduled: economic prints and FDA dates.</p>
    <p>Gated: the board was FORBIDDEN from scoring a name that reports inside the gate window.
    It is not a low score. There is no score under it at all.</p>
    <p>Every day count is measured from the run&#39;s own Eastern date; every price is the last
    completed session&#39;s close. Nothing here is a forecast.</p>
  </div>
  <div class="fd-chips" id="evChips"></div>
  <div class="ui-grid fd-grid">
${feedModule("evWeekCard", "Week ahead", `<div class="fd-body" id="evWeek"></div>`)}
${feedModule("evEarnCard", "Earnings", `<div class="fd-body" id="evEarn"></div>`, { span: 7 })}
${feedModule("evMacroCard", "Macro", `<div class="fd-body" id="evMacro"></div>`, { span: 5 })}
${feedModule("evFdaCard", "FDA", `<div class="fd-body" id="evFda"></div>`, { span: 6 })}
${feedModule("evReactCard", "Reaction", `<div class="fd-body" id="evReact"></div>`, { span: 6 })}
  </div>
`, { chrome: false })}
${UI_SCRIPT}
<script src="${v("/assets/js/flows-events.js")}" defer></script>
</body>
</html>`;
}

export function trackPage({ username = "" } = {}) {
  return flowsDocument({
    title: "Track",
    description: "Each name's daily score traced across sessions, with what followed each call. A gap is a session the name was not scored, never zero.",
    active: "track",
    username,
    chrome: false,
    styles: ["/assets/css/flows-record.css"],
    scripts: ["/assets/js/flows-track.js"],
    body: `
  <header class="flows-head rec-head" data-fx-hero>
    <h1 id="fxTitle">Track</h1>
    <span class="rec-head-s" id="stHeadState"></span>
    <button type="button" class="ui-info" id="stBasis" aria-label="About the score track"
            aria-haspopup="dialog" aria-controls="fxPop" aria-expanded="false">${glyph("info")}</button>
  </header>
  <p class="visually-hidden" id="stStatus" role="status">Loading the track\u2026</p>
  <div class="ui-grid st-grid" id="stTrack"></div>
`,
  });
}

export function unusualPage({ username = "" } = {}) {
  return `${head("Flows — Unusual activity", "Windows of option activity the vendor flagged, and contracts carrying volume far above their own open interest.", FEEDS_CSS)}
${shell("Unusual", "unusual", username, `${feedHead("ua", "Unusual")}
  <p class="visually-hidden" id="uaStatus" role="status">Loading the feed…</p>
  <div class="fd-about" id="uaAbout" hidden>
    <p class="flows-lede">The timeline is the vendor&#39;s own flow alerts: windows of activity the
    vendor&#39;s rules flagged, each carrying a stated span, a size, a premium and the vendor&#39;s
    sweep flag. A window aggregates its executions and the selection is the vendor&#39;s, not the
    market&#39;s, so a window is not a trade. Beneath it sit contracts whose volume counter stands
    far above the open interest beside it. A counter, not a trade: the vendor reports a total for
    each strike with no size, no time and no execution price, and this endpoint carries no as-of
    date, so the counter is stamped with when it was read and nothing more. Nothing here says who
    traded, or why.</p>
    <p>A dash where a vendor flag belongs means the vendor did not carry that flag on the window,
    which is not the same fact as the flag being off.</p>
  </div>
  <div class="fd-chips" id="uaChips"></div>
  <div class="fd-filters" id="uaFilters" role="group" aria-label="Narrow the page"></div>
  <p class="visually-hidden" id="uaFilterNote" role="status"></p>
  <div class="ui-grid fd-grid">
${feedModule("uaTimelineCard", "Timeline", `<div class="fd-body" id="uaTimeline"></div>`)}
${feedModule("uaNamesCard", "Names", `<div class="fd-body" id="uaNames"></div>`, { span: 7 })}
${feedModule("uaUrgencyCard", "Urgency", `<div class="fd-body" id="uaUrgency"></div>`, { span: 5 })}
${feedModule("uaFeedCard", "Volume over OI", `<div class="fd-body" id="uaFeed"></div>`, { span: 6 })}
${feedModule("uaSurpriseCard", "Surprise", `<div class="fd-body" id="uaSurprise"></div>`, { span: 6 })}
  </div>
`, { chrome: false })}
${UI_SCRIPT}
<script src="${v("/assets/js/flows-fresh.js")}" defer></script>
<script src="${v("/assets/js/flows-unusual.js")}" defer></script>
</body>
</html>`;
}

export function tickerPage({ username = "" } = {}) {
  return flowsDocument({
    title: "Ticker",
    description: "One name's options dossier: price against the priced move, the Neuron verdict with priced structures, and the dealer book, volatility, flow and positioning behind it.",
    active: "ticker",
    username,
    chrome: false,
    styles: ["/assets/css/flows-ticker.css"],
    scripts: ["/assets/js/flows-fresh.js", "/assets/js/flows-quant-read.bundle.js", "/assets/js/flows-ticker.js"],
    body: `
  <div class="visually-hidden ft-status" id="ftStatus" role="status">Loading the name…</div>
  <section class="ft-hero is-loading" id="ftHero" data-fx-hero aria-labelledby="ftHeroT"><div class="ft-hero-in">
    <div class="ft-id">
      <div class="ft-name"><h1 class="ft-t" id="ftHeroT" data-fx-title></h1><span class="ft-sub" id="ftHeroSub"></span><span class="ft-flags" id="ftHeroFlags"></span></div>
      <div class="ft-px" id="ftPx"></div>
      <div class="ft-last" id="ftLast" hidden></div>
      <div class="ft-chips" id="ftChips"></div>
    </div>
    <div class="ft-hc" id="ftHc"></div>
  </div></section>
  <section class="ui-card ft-verdict" id="ftVerdict" aria-labelledby="ftVerdictT" hidden></section>
  <div class="ft-grid" id="ftGrid" hidden></div>
  <section class="ft-picker" id="ftPicker" aria-labelledby="ftPickerT" hidden></section>
`,
  });
}

export function historyPage({ username = "" } = {}) {
  return flowsDocument({
    title: "History",
    description: "What the board said, and what happened next.",
    active: "history",
    username,
    chrome: false,
    styles: ["/assets/css/flows-record.css"],
    scripts: ["/assets/js/flows-history.js"],
    body: `
  <header class="flows-head rec-head" data-fx-hero>
    <h1 id="fxTitle">History</h1>
    <span class="rec-head-s" id="recHeadState"></span>
    <button type="button" class="ui-info" id="recAbout" aria-label="About the track record"
            aria-haspopup="dialog" aria-controls="fxPop" aria-expanded="false">${glyph("info")}</button>
  </header>
  <p class="visually-hidden" id="recStatus" role="status">Loading the record\u2026</p>
  <div class="ui-grid rec-grid" id="recApp"></div>
`,
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function politicalPage({ username = "" } = {}) {
  return `${head("Flows — Political", "Who disclosed the largest purchases, and in what, with the range each filing stated and the delay since the trade.", FEEDS_CSS)}
${shell("Political", "political", username, `${feedHead("pl", "Political")}
  <p class="visually-hidden" id="plStatus" role="status">Loading the disclosure window…</p>
  <div class="fd-about" id="plAbout" hidden>
    <p class="pl-lede-warn">Every row on this page is a statutory disclosure, not a trade seen on
    a tape. Filing is late by law and later in practice: the STOCK Act allows 45 days and late
    filers routinely exceed 100. Each row carries the days between its transaction and its filing,
    and each ranked total carries the median lag of the filings behind it. This page ranks what has
    been <em>disclosed</em>, which is never the same question as what is being done now.</p>
  </div>
  <div class="fd-chips" id="plChips"></div>
  <div class="ui-grid fd-grid">
${feedModule("plBuyersCard", "Buyers", `<div class="fd-body" id="plBuyers"></div>`, { span: 7 })}
${feedModule("plAssetsCard", "Names", `<div class="fd-body" id="plAssets"></div>`, { span: 5 })}
${feedModule("plRecentCard", "Newest", `<div class="fd-body" id="plRecent"></div>`)}
${feedModule("plHoldersCard", "Holdings", `<div class="fd-body" id="plHolders"></div>`)}
  </div>
`, { chrome: false })}
${UI_SCRIPT}
<script src="${v("/assets/js/flows-political.js")}" defer></script>
</body>
</html>`;
}
export function askPage({ username = "" } = {}) {
  return flowsDocument({
    title: "Ask",
    description: "Yesterday, today, and what is already scheduled, from the readings this site has published. The wording may be a model's; the figures never are.",
    active: "ask",
    username,
    chrome: false,
    styles: ["/assets/css/flows-ask.css"],
    scripts: ["/assets/js/flows-ask.js"],
    body: `
  <header class="flows-head ak-head" data-fx-hero>
    <h1 id="fxTitle">Ask</h1>
    <span class="ak-head-s" id="askHeadState"></span>
    <button type="button" class="ui-info" id="askAbout" aria-label="About Ask"
            aria-haspopup="dialog" aria-controls="fxPop" aria-expanded="false">${glyph("info")}</button>
  </header>
  <p class="visually-hidden" id="askStatus" role="status">Reading the session\u2019s briefing\u2026</p>
  <div id="askApp" class="ak-app"></div>
`,
  });
}

export function strategyPage({ username = "" } = {}) {
  return flowsDocument({
    title: "Strategy",
    description: "Price any listed option structure on the smile, with the same engine as the server.",
    active: "strategy", username, chrome: false,
    styles: ["/assets/css/flows-tools.css"],
    scripts: ["/assets/js/flows-quant.bundle.js", "/assets/js/flows-strategy.js"],
    body: `
  <div class="tl" id="sgMain">
    <header class="tl-hero" id="sgHero" data-fx-hero>
      <div class="tl-id">
        <h1 class="tl-t"><span id="sgTitle" data-fx-title>Strategy</span><span class="tl-sub" id="sgSub"></span></h1>
        <div class="tl-px" id="sgPx"></div>
      </div>
      <form class="tl-find" id="sgEntry" role="search" autocomplete="off" action="/flows/strategy/" method="get">
        <label class="visually-hidden" for="sgTicker">Symbol</label>
        ${glyph("search")}
        <input id="sgTicker" name="t" type="text" inputmode="latin" autocapitalize="characters" autocorrect="off"
               spellcheck="false" placeholder="Symbol" enterkeyhint="go">
        <button type="submit" class="sg-load">Load</button>
      </form>
    </header>
    <p class="visually-hidden" id="sgStatus" role="status">Enter a symbol to begin.</p>
    <section class="ui-card tl-build" id="sgPick" aria-labelledby="sgPickH" hidden>
      <h2 class="visually-hidden" id="sgPickH">Structure and expiry</h2>
    </section>
    <div class="ui-grid tl-grid" id="sgGrid"></div>
  </div>
  <section id="sgRefusePanel" hidden aria-labelledby="sgRefuseH">
    <h2 id="sgRefuseH">What this page will not tell you</h2>
    <dl class="sg-refuse">
      <dt>Buying power reduction</dt>
      <dd>Refused. It is a broker&#39;s number, not the market&#39;s: the same short put reduces buying power by
        different amounts at two brokers on the same afternoon, and by different amounts again in a
        portfolio-margin account. Nothing in the vendor&#39;s specification mentions buying power, margin or
        collateral anywhere in its 28,755 lines. The capital shown here is the maximum loss of a defined-risk
        position, or the exchange&#39;s Reg-T minimum formula for an uncovered one, and it is labelled as such.</dd>
      <dt>Conditional value at risk</dt>
      <dd>Published only under the real-world law. A tail expectation is an average over a distribution; this page
        takes it over the GARCH law the name&#39;s card publishes, at expiry, and prints nothing when no card
        carries one. It never takes a tail over the risk-neutral density, which prices risk rather than
        forecasting it.</dd>
      <dt>Beta-weighted delta</dt>
      <dd>Published, with its terms stated. It is not delta times beta. It is delta &#215; beta &#215; (this
        stock&#39;s price &#247; the index&#39;s price), so it needs a reference index and that index&#39;s live
        price, and it is a different number against a different index. When either is missing the reading is an
        em dash, never a zero.</dd>
      <dt>A share leg</dt>
      <dd>Offered. A covered call and a collar carry 100 shares per lot, valued at spot, so their payoff and their
        capital include the stock.</dd>
    </dl>
    <p>The expiry line is model-free. At expiry an option is worth its intrinsic value, so the solid line is
      arithmetic on the strikes, the premiums and the underlying: no volatility, no interest rate, no dividend
      and no distribution. The maximum profit, the maximum loss and the breakevens are read off that line and are
      exact to the quotes they were built from. A position with unbounded loss reports unbounded rather than a
      large number, because there is no number there to report.</p>
    <p>The today line re-prices every leg on this expiry&#39;s fitted smile with Black-76 against a put-call parity
      forward, so the dividend is implied by the book rather than assumed, and the rate is the card&#39;s. It
      holds the smile sticky in moneyness as spot moves. It is least accurate where the smile is extrapolated,
      beyond the last quoted strike, and it is only as good as the fit grade beside it.</p>
    <p>Options can lose their entire premium, and a short call&#39;s loss has no upper bound. This is a
      calculator, not advice.</p>
  </section>
  <div id="sgCopy" hidden>
      <p data-k="ctx-dash">An em dash for beta means the vendor has none, never a beta of zero.</p>
      <p data-k="ctx-earn">A contract that outlives an earnings report is a different trade at the same premium.</p>
      <p data-k="about">Pick a name and a structure; the engine chooses each strike by delta on this expiry&#39;s fitted smile and prices the position exactly as the server does. Drag a strike and everything re-prices in the page.</p>
      <p data-k="struct">Twenty-two structures from the engine&#39;s catalogue. Each chooses its expiry inside its own window of days to expiry and its strikes by forward delta on the fitted smile, snapped to a listed, two-sided strike.</p>
      <p data-k="struct-risk">A tile marked with the slashed shield sells an option no other leg of it covers. Its capital is the exchange&#39;s Reg-T formula rather than a maximum loss, its grade is capped at 2, and a short call among its legs can lose without limit.</p>
      <p data-k="struct-picks">Numbered tiles are the engine&#39;s own ranking on this expiry, by expected value under the real-world law per dollar of capital, among structures graded at least 1.</p>
      <p data-k="struct-nopick">The engine ranked nothing on this expiry, so no tile is numbered.</p>
      <p data-k="exp">Each chip is one listed expiry, with its calendar days to expiry from the session and a bar for how many contracts it lists. Chips inside the structure&#39;s window are underlined. The book is read one expiry at a time.</p>
      <p data-k="exp-oi">The list came from open interest rather than the session&#39;s activity, so no expiry carries its contract count.</p>
      <p data-k="payoff">Profit and loss per lot against the underlying. The white line is the payoff at expiry; the blue line is the position&#39;s value today on the fitted smile.</p>
      <p data-k="payoff-exact">The expiry line is model-free and it is exact: at expiry an option is worth its intrinsic value, so nothing on that line needs a volatility, a rate or a distribution. Profit is above the zero rule and loss below it; the sign is carried by position, never by colour alone, and the green columns mark where the position ends in profit.</p>
      <p data-k="payoff-today">The today line re-prices every leg on the fitted smile with Black-76 against a put-call parity forward, holding the smile sticky in moneyness as spot moves. It is least accurate where the smile is extrapolated, beyond the last quoted strike.</p>
      <p data-k="payoff-pu">The position is net long calls, so its profit rises without limit as the underlying rises. There is no number there, so none is printed.</p>
      <p data-k="payoff-lu">The position is net short calls. A share has no upper bound, so neither does this loss, which is why it is reported as unbounded and not as a large number.</p>
      <p data-k="payoff-put">A share cannot trade below zero, so this loss is bounded: the &#39;unlimited downside&#39; often said of a naked short put is not what the arithmetic says.</p>
      <p data-k="payoff-drag">Drag a strike handle, or focus it and use the arrow keys, to move a leg to the next listed strike with a two-sided quote. Everything on the page re-prices in the browser, with the same engine code the server runs.</p>
      <p data-k="odds">The chance the position ends in profit at expiry, under the market&#39;s own risk-neutral density read off the smile (implied) and under the real-world law simulated from this name&#39;s GARCH model (real world). The gap between them is the edge the position carries if the model is right.</p>
      <p data-k="odds-ev">Discounted expectation of the payoff under each law, less the position&#39;s cost at the chosen basis, per lot. Under the implied density a position bought at its model value is worth zero by construction, so a negative implied EV is the spread you pay to trade.</p>
      <p data-k="odds-grade">The weakest of five parts: the smile fit, the legs&#39; liquidity, the real-world model, whether the edge keeps its sign under three laws, and how an earnings date inside the expiry is handled.</p>
      <p data-k="greeks">Dollar greeks of the whole position per lot, from Black-Scholes at each leg&#39;s own smile volatility with the carry the parity forward implies. Theta and charm are per calendar day.</p>
      <p data-k="greeks-bw">Withheld. It needs the position delta, this name&#39;s beta and a live price for the reference index, and at least one of those is absent. It is NOT delta times beta, so there is no cheaper version of it to print instead.</p>
      <p data-k="greeks-ror">Expected value under the real-world law divided by the capital the position ties up: the engine&#39;s own ranking key.</p>
      <p data-k="scen">Profit and loss per lot if spot moves by a multiple of the expiry&#39;s at-the-money sigma, at four points in time, with implied volatility shifted in parallel by the control above.</p>
      <p data-k="scen-method">Every cell re-prices every leg on the fitted smile, sticky in moneyness, at the chosen basis. The ringed cell is today at spot with volatility unchanged, which equals the today line at spot.</p>
      <p data-k="legs">One row per leg. Buy and Sell switch a leg&#39;s side, the stepper sets how many contracts, and editing any of these turns the structure into a custom position.</p>
      <p data-k="legs-mid">Halfway between bid and ask; no one is obliged to trade there</p>
      <p data-k="legs-fill">Mid plus a quarter of the spread, the engine&#39;s execution assumption</p>
      <p data-k="legs-nat">The ask on every buy and the bid on every sell: what crossing the spread costs</p>
      <p data-k="no-legs">No listed strikes on {d} reach the deltas a {s} is built from.</p>
      <p data-k="why-jade">These strikes no longer make a jade lizard: the credit does not cover the call spread&#39;s width, so the position carries upside risk the structure exists to remove.</p>
      <p data-k="why-quote">A leg has no two-sided quote on the book the engine read, so the position has no mid to price from.</p>
      <p data-k="ctx">every reading on this page is measured from. Re-loading the symbol re-reads it; picking another expiry does not, because a second read per pick would spend a shared vendor quota to re-learn a number the page already holds and can date.</p>
      <p data-k="exp-q">{n} of {m} contracts read at {d} carry a two-sided quote. Strike handles snap only to those.</p>
      <p data-k="exp-cut">{w} of this expiry is CUT OFF: the provider caps a page at {n} contracts and this page reads {p} of them per side, so strikes beyond those are not listed here at all.</p>
      <p data-k="exp-off">the provider returned belonged to a different expiry or option type and were dropped, so treat the strike list as incomplete.</p>
      <p data-k="no-back">No listed expiry sits in a {s}&#39;s back-month window behind {d}.</p>
      <p data-k="st-fail">Nothing below was read — this is the request failing, not the market being quiet.</p>
      <p data-k="st-list">the expiry list did not come back, so there is nothing to pick from. The price above was read; this one request was not.</p>
      <p data-k="st-none">was read and lists no option expiries. That is a reading about the name, not a failure of this page.</p>
      <p data-k="st-book">Nothing is priced because nothing was read, which is not the same as this expiry being empty.</p>
      <p data-k="no-q">The engine bundle did not load, so nothing on the smile can be computed in this page.</p>
      <p data-k="no-fit">No smile could be fitted to this expiry&#39;s quotes, so no leg can be priced on it.</p>
      <p data-k="bad-read">did not come back. Nothing here is computed from a partial position.</p>
      <p data-k="bad-gone">is no longer listed at that expiry. The contract was read for and is not in the book, so remove the leg.</p>
      <p data-k="bad-quote">A position with one unpriced leg has an unknown cost, not a smaller one.</p>
      <p data-k="law-none">no card with a GARCH law is published for {t} this session, so there is no real-world distribution to take a probability over</p>
      <p data-k="pts">Profit and loss at expiry at each turning point; between two rows it is a straight line.</p>
      <p data-k="bad-sym">That is not a symbol this page accepts: one to ten characters, starting with a letter.</p>
      <p data-k="empty">No symbol yet. Enter one above and the lab reads its option book, fits the smile and prices the structure you pick on it.</p>
      <p data-k="legs-link">A link to this page carries the legs as contracts with signed quantities and never their prices: a quote is a fact about a moment, and a link opened tomorrow re-reads the book.</p>
  </div>`,
  });
}

export const FLOWS_SPRITE = SPRITE;

export function flowsDocument({
  title = "Flows", description = "", active = "", username = "", body = "", scripts = [], styles = [], chrome = true,
} = {}) {
  const t = escapeHTML(String(title));
  return `${head("Flows — " + t, escapeHTML(String(description)), styles)}
${shell(t, String(active), username, String(body), { chrome })}
${UI_SCRIPT}
${scripts.map((src) => `<script src="${v(String(src))}" defer></script>`).join("\n")}
</body>
</html>`;
}

export const FLOWS_PAGES = {
  loginPage, overviewPage, sidePage, watchPage, marketPage, historyPage, deskPage,
  politicalPage,
  tickerPage, unusualPage, eventsPage, trackPage, strategyPage, askPage, ASSET_VERSION,
};

