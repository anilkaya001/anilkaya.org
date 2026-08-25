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

export const ASSET_VERSION = "43";

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

  <div class="flows-status" id="flowsStatus" role="status">Loading the latest session…</div>

  <div class="flows-sides" role="group" aria-label="Board side">
    <button type="button" class="flows-side is-on" data-side="long" aria-pressed="true">Long</button>
    <button type="button" class="flows-side" data-side="short" aria-pressed="false">Short</button>
  </div>

  <div class="flows-tablewrap">
    <table class="flows-table" id="flowsTable">
      <caption class="flows-caption">Ranked candidates. Every score decomposes into its contributing families.</caption>
      <thead>
        <tr>
          <th scope="col" class="c-rank">#</th>
          <th scope="col">Ticker</th>
          <th scope="col" class="c-num">Last</th>
          <th scope="col" class="c-num">Score</th>
          <th scope="col" class="c-num">Conv</th>
          <th scope="col" class="c-num"><abbr title="Family sub-scores: Flow, Positioning, Path, Vol, Quality">F&middot;P&middot;D&middot;V&middot;O</abbr></th>
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
<script src="${v("/assets/js/nav.js")}" defer></script>
<script src="${v("/assets/js/flows-board.js")}" defer></script>
</body>
</html>`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export const FLOWS_PAGES = { loginPage, boardPage, ASSET_VERSION };
