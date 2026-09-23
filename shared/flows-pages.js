import {
  TICKER_PANELS, TICKER_GROUPS, SENTINEL_KEYS, STATION_SIDE_COUNTS,
} from "./flows-panels.js";

export const ASSET_VERSION = "223";

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

const ICONS = {
  ask: "M4 5h16v11H9l-5 4Z M8.6 9.2a3.4 3.4 0 0 1 5.6 2.1c0 1.7-2 2-2 3.2M12.2 17.4h.01",
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
<aside class="ak-dock" id="askDock" data-src="${v("/assets/js/flows-ask.js")}">
  <div class="ak-dock-scrim" hidden></div>
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
        <h2 class="hm-verdict-line" id="hmVerdictT">No read yet</h2>
        <div class="hm-verdict-meta"><span class="hm-verdict-by">Neuron</span>
          <span class="ui-state hm-mark" data-state="pending" title="Pending" aria-label="Pending: not published yet — not a quiet session. Nothing here is claimed about the market.">${glyph("pending")}</span></div>
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
  return `${head("Flows — Today", "The market in one glance: the tide, the regime, both leaders, what changed and what reports next.", ["/assets/css/flows-home.css"])}
${shell("Today", "overview", username, `
  <header class="flows-head hm-head" data-fx-hero>
    <h1 id="fxTitle">Today</h1>
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
        <div class="dk-chips" id="deskList" role="group" aria-label="Watchlist"></div>
      </div>
      <div class="dk-row2" id="dkFilters">
        <label class="dk-all"><input type="checkbox" id="deskAll"><span>All</span></label>
        <button type="button" class="dk-pill" id="deskRefresh">Refresh</button>
        <button type="button" class="dk-pill" id="deskClear">Clear</button>
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
${marketModule("mkSeasonCard", "Seasonality", "mkSeason")}
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
  const lede = "The same score the board prints after each close, traced name by " +
    "name across sessions. The boards show a ranking's two tails; this page " +
    "keeps the whole distribution, so a name drifting toward a board is " +
    "visible before the session it arrives. A gap means the name was not " +
    "scored that session — never zero.";
  return `${head("Flows — Score track", "Each name's daily score, traced across sessions.")}
${shell("Track", "track", username, `
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
${UI_SCRIPT}
<script src="${v("/assets/js/flows-track.js")}" defer></script>
</body>
</html>`;
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

  const lede = "One name and its whole option book: where dealer gamma sits " +
    "and what flips it, what the chain is charging across strikes and " +
    "expiries, which contracts carry the volume, and how far the price is " +
    "from every level that matters — all of it read off the card the pipeline " +
    "published after the last close, with only the last price re-read live every five seconds.";

  const panelMarkup = (p) => `
    <section class="fc-panel ft-panel${p.span === 2 ? " is-wide" : p.span === 3 ? " is-full" : ""}"
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
${shell("Ticker", "ticker", username, `
  <div class="flows-status" id="ftStatus" role="status">Loading the name…</div>
  <p class="flows-stale fc-staleband" id="ftStale" role="status" hidden></p>

  <div class="ft-scroll flows-scroll" id="ftScroll">
  <section class="ft-hero" id="ftHero" hidden data-fx-hero aria-label="This name at a glance">

    <div class="ft-hero-id">
      <span class="ft-hero-t" id="ftHeroT" data-fx-title></span>
      <span class="ft-hero-nm" id="ftHeroNm" hidden></span>
      <span class="ft-hero-sub">
        <span class="ft-hero-m" id="ftHeroSector"></span>

        <span class="ft-hero-m is-faint" id="ftHeroWhen"></span>
      </span>
    </div>
    <div class="ft-hero-px">
      <span class="ft-hero-k">Last</span>
      <span class="ft-hero-v" id="ftHeroPx"></span>
      <span class="ft-hero-stack">
        <span class="ft-hero-chg" id="ftHeroChg" hidden></span>
        <span class="ft-hero-live" id="ftHeroLive" role="status" hidden></span>
      </span>
    </div>

    <div class="ft-hero-b" id="ftHeroScoreB">
      <span class="ft-hero-k">Options score</span>
      <span class="ft-hero-v" id="ftHeroScore"></span>
      <span class="ft-hero-stack">
        <span class="ft-hero-bar" id="ftHeroScoreBar" aria-hidden="true"></span>
        <span class="ft-hero-pill" id="ftHeroSide" hidden></span>
      </span>
    </div>
    <div class="ft-hero-b" id="ftHeroConvB">
      <span class="ft-hero-k">Conviction</span>
      <span class="ft-hero-v" id="ftHeroConv"></span>
      <span class="ft-hero-stack">
        <span class="ft-hero-seg" id="ftHeroConvSeg" aria-hidden="true"></span>
      </span>
    </div>

    <div class="ft-hero-b" id="ftHeroIvB" hidden>
      <span class="ft-hero-k">ATM IV</span>
      <span class="ft-hero-v" id="ftHeroIv"></span>
      <span class="ft-hero-stack">
        <span class="ft-hero-m is-faint" id="ftHeroIvSub" hidden></span>
      </span>
    </div>
    <div class="ft-hero-b" id="ftHeroIvrB" hidden>
      <span class="ft-hero-k">IV rank</span>
      <span class="ft-hero-v" id="ftHeroIvr"></span>
      <span class="ft-hero-stack">
        <span class="ft-hero-seg" id="ftHeroIvrSeg" aria-hidden="true"></span>
      </span>
    </div>
    <div class="ft-hero-state" id="ftHeroStateB" hidden>
      <span class="ft-hero-k">Implied state</span>
      <span class="ft-hero-v ft-hero-v--word" id="ftHeroState"></span>
      <span class="ft-hero-pill" id="ftHeroStateSide" hidden></span>
      <span class="ft-hero-seg ft-hero-seg--3" id="ftHeroStateSeg" aria-hidden="true"></span>
      <span class="ft-hero-state-chip" id="ftHeroStateChip"></span>
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
  </div>

  <div class="ft-row1" id="ftRow1"></div>

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
      <h2 class="ft-chart-h" id="ftGarchH">GARCH(1,1) — skewed t</h2>
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

  <aside class="ft-lv" id="ftLv" hidden aria-labelledby="ftLvH">
    <h2 class="ft-lv-h" id="ftLvH">Key levels</h2>
    <ol class="ft-lv-l" id="ftLvL"></ol>
    <p class="ft-lv-s" id="ftLvS"></p>
  </aside>

  <aside class="ft-flow" id="ftFlow" hidden aria-labelledby="ftFlowH">
    <h2 class="ft-flow-h" id="ftFlowH">Recent flow <span class="ft-flow-hz">times in UTC</span></h2>
    <ol class="ft-flow-l" id="ftFlowL"></ol>
    <p class="ft-flow-s" id="ftFlowS"></p>
  </aside>

  <section class="ft-ivt" id="ftIvt" hidden aria-labelledby="ftIvtH">
    <h2 class="ft-chart-h ft-ivt-h" id="ftIvtH">Implied volatility term structure</h2>
    <div class="ft-chart-body" id="ftIvtBody"></div>
    <p class="ft-chart-s" id="ftIvtS"></p>
  </section>

  <section class="ft-mix" id="ftMix" hidden aria-labelledby="ftMixH">
    <h2 class="ft-mix-h" id="ftMixH">Volume by type</h2>
    <div class="ft-mix-body" id="ftMixBody"></div>
    <p class="ft-mix-s" id="ftMixS"></p>
  </section>

  <aside class="ft-rel" id="ftRel" hidden aria-labelledby="ftRelH">
    <h2 class="ft-rel-h" id="ftRelH">Others in this sector</h2>
    <div class="ft-rel-l" id="ftRelL"></div>
    <p class="ft-rel-s" id="ftRelS"></p>
  </aside>
  </div>

    </div>
    <div class="ft-split-side">
  <aside class="ft-brief" id="ftBrief" hidden aria-labelledby="ftBriefH">
    <h2 class="ft-brief-h" id="ftBriefH">
      <span class="ft-brief-ic" aria-hidden="true">${icon("sun")}</span>
      <span class="ft-brief-hn">Brief</span>
      <span class="ft-brief-beta">Beta</span>
    </h2>
    <div class="ft-brief-body" id="ftBriefBody">
    <div class="ak-neuron ft-neuron is-pending" id="ftNeuron" hidden>
      ${neuronMark("t", false)}
      <div class="ak-neuron-body">
        <p class="ak-neuron-h" id="ftNeuronH">Neuron</p>
        <div class="ft-state" id="ftNeuronState" hidden>
          <div class="ft-state-top">
            <span class="ft-state-w" id="ftStateWord"></span>
            <span class="ft-state-conf" id="ftStateConf" aria-hidden="true"></span>
          </div>
          <p class="ft-state-chip" id="ftStateChip"></p>
          <dl class="ft-state-m" id="ftStateMeta"></dl>
        </div>
        <p class="ak-neuron-say" id="ftNeuronSay"></p>
        <ol class="ft-ideas" id="ftNeuronIdeas" hidden aria-label="Trade ideas, ranked by robustness"></ol>
        <button class="ft-ideas-more" id="ftNeuronMore" type="button" hidden aria-expanded="false"
                aria-controls="ftNeuronIdeas"></button>
        <p class="ak-neuron-src" id="ftNeuronSrc"></p>
        <p class="ak-neuron-cov" id="ftNeuronCov" hidden></p>
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
    </div>
  </aside>
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
${UI_SCRIPT}

<script src="${v("/assets/js/flows-cursor.js")}" defer></script>
<script src="${v("/assets/js/flows-panels.js")}" defer></script>
<script src="${v("/assets/js/flows-ticker.js")}" defer></script>
</body>
</html>`;
}

export function historyPage({ username = "" } = {}) {
  const lede = "What the board said, and what happened next.";
  return `${head("Flows \u2014 Track record", lede)}
${shell("History", "history", username, `
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
          return, measured inside each session on the return scaled by the
          name’s own volatility, then averaged across sessions. A single
          correlation pooled across sessions scores a volatility column on
          which way the market went; it is kept, labelled, as the secondary
          figure. This is the research loop, in public: the features the score
          is built from, measured against what happened next, with the sample
          they were measured on. An IC near zero is a finding too.
        </caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col" class="c-num"><abbr title="Mean of the per-session Spearman coefficients with the volatility-scaled forward return at the stated horizon">Mean IC</abbr></th>
            <th scope="col" class="c-num"><abbr title="Standard deviation of the per-session coefficients">SD</abbr></th>
            <th scope="col" class="c-num"><abbr title="Sessions whose coefficient was positive, of the sessions scored">Positive</abbr></th>
            <th scope="col" class="c-num"><abbr title="Mean over its standard error with the effective sample of sessions divided by the horizon; computed only once a feature is ranked">t</abbr></th>
            <th scope="col" class="c-num"><abbr title="Correlation of each session’s coefficient with that session’s mean forward return: near one means the feature is a bet on market direction">Market</abbr></th>
            <th scope="col" class="c-num"><abbr title="Secondary: one Spearman coefficient over every session’s raw pairs pooled together">Pooled IC</abbr></th>
            <th scope="col" class="c-num"><abbr title="Measured feature-return pairs behind the pooled figure. Consecutive sessions overlap, so the effective sample is far smaller">Pairs</abbr></th>
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
${UI_SCRIPT}
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

  const summary = "What the session says, what changed to get here, and what is " +
    "already on the calendar before the next one — assembled from the same " +
    "published readings every other page here draws. Ask a question and the " +
    "wording may be a model's; the figures never are. Anything it writes that " +
    "is not already in the measurements it was handed is refused, and the " +
    "measured reading is served instead.";
  const lede = "Yesterday, today, and what is already scheduled — from the readings " +
    "this site has published.";
  return `${head("Flows — Ask", summary)}
${shell("Ask", "ask", username, `
  <div class="flows-status" id="askStatus" role="status">Reading the session’s briefing…</div>

  <div class="flows-controls">
    <p class="flows-lede">${lede}</p>
  </div>

  <div id="askApp"></div>
  <div id="askFoot" class="flows-foot"></div>
`)}
${UI_SCRIPT}
<script src="${v("/assets/js/flows-ask.js")}" defer></script>
</body>
</html>`;
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

