import { ASSET_VERSION } from "./flows-pages.js";

export const researchPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#07090d">
<title>NVDA Price Response Map | Flows 2.0</title>
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="/assets/css/base.css?v=${ASSET_VERSION}">
<link rel="stylesheet" href="/assets/css/flows-research.css?v=${ASSET_VERSION}">
</head>
<body>
<div class="app-shell">
<header class="topbar">
  <div class="shell top-inner">
    <a class="brand" href="/flows/" aria-label="Flows home">
      <span class="logo" aria-hidden="true">ε</span>
      <span>Flows <i>2.0</i></span>
    </a>
    <nav class="topnav" aria-label="Research navigation"><a href="#overview" aria-current="page">Response map</a><a href="#methodology">Methodology</a></nav>
    <div class="top-actions">
      <span class="status" id="data-status">Awaiting data</span>
      <button class="export" id="export" type="button" disabled><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>Export CSV</button>
    </div>
  </div>
</header>
<main class="shell" id="overview">
  <div class="hero">
    <div class="instrument"><span class="instrument-icon" aria-hidden="true">NV</span><div><div class="eyebrow">NASDAQ-listed · Equity options</div><h1>NVDA <span>NVIDIA Corporation</span></h1></div></div>
    <div class="quote" aria-label="Latest price in market snapshot" id="quote" hidden><strong>—</strong><span class="change" title="Change from the first bar in this snapshot"></span><span class="quote-context">Latest price in snapshot</span></div>
  </div>
  <section class="panel load-row" aria-label="Market data source">
    <div><strong id="source-title">Load a recorded NVDA snapshot</strong><p id="source-caption">Choose a normalized JSON file containing NVDA bars and option inputs from an authorized data source. The file is processed in this browser.</p></div>
    <div class="load-actions">
      <input type="file" id="snapshot" accept=".json,application/json" hidden>
      <button type="button" class="export" id="choose-snapshot">Load JSON snapshot</button>
    </div>
  </section>
  <p class="failure" id="failure" role="alert" hidden></p>
  <div class="controls" id="model-controls" aria-label="Model inputs" hidden>
    <div class="control"><span class="small-label" id="horizon-label">Horizon</span><div id="horizons" class="segment" role="group" aria-labelledby="horizon-label"></div></div>
    <div class="control"><span class="small-label" id="liquidity-label">Liquidity</span><div id="liquidity" class="segment" role="group" aria-labelledby="liquidity-label"></div></div>
    <div class="control"><label class="small-label" for="inventory">Inventory</label><span class="select-wrap"><select id="inventory"></select></span></div>
    <div class="controls-end" id="run-label">Conditional repricing · USD</div>
  </div>
  <div class="workspace idle" id="workspace">
    <section class="panel" aria-labelledby="chart-title">
      <header class="panel-head"><div><h2 id="chart-title">Price response map</h2><p class="panel-sub" id="chart-sub">Underlying history and conditional price zones</p></div><span class="unit">USD / SHARE</span></header>
      <div class="chart-wrap" id="chart-wrap">
        <svg id="chart" tabindex="0" role="application" aria-label="Price chart. Press the arrow keys to inspect the price history and price bands. Press Enter to select a band." hidden></svg>
        <div id="chart-empty" class="chart-empty"><div><h3>Awaiting market data</h3><p>Load a recorded NVDA snapshot to show the price history and calculate its conditional response zones.</p></div></div>
        <div class="chart-tooltip" id="chart-tooltip" hidden></div>
      </div>
      <span class="sr-only" id="chart-live" aria-live="polite"></span>
      <div class="layers" id="layer-controls" role="group" aria-label="Visible chart overlays" hidden><span class="small-label layers-label" aria-hidden="true">Layers</span><div id="layers"></div></div>
      <p class="chart-caption" id="chart-caption" hidden>The right panel shares the price axis. Green, red and amber lines show upside, downside and volatility response relative to 1.00×.</p>
    </section>
    <aside class="panel inspector" aria-labelledby="inspector-title">
      <header class="panel-head"><div><h2 id="inspector-title">Zone inspector</h2><p class="panel-sub" id="inspector-sub">Conditional response by price interval</p></div></header>
      <div class="zone-list" id="zone-list" role="group" aria-label="Price zones"><p class="zone-empty">Zones appear after a valid snapshot is loaded.</p></div>
      <div class="zone-detail" id="zone-detail" aria-live="polite"></div>
      <p class="inspector-foot" id="inspector-foot">Volatility, amplification and dampening are calculated from snapshot inputs.</p>
    </aside>
  </div>
  <section class="readouts" id="readouts" aria-label="Model inputs and diagnostics" hidden></section>
  <section class="panel method" id="methodology" aria-label="Methodology and provenance">
    <details><summary>Model and interpretation</summary><section id="model-notes"></section></details>
    <details><summary>Data provenance and validation</summary><section id="validation-notes"></section></details>
  </section>
  <footer class="footer"><span>FLOWS 2.0 / QUANTITATIVE RESEARCH</span><span id="footer-status">NVDA · USD</span></footer>
</main>
</div>


<script defer src="/assets/js/flows-research-model.bundle.js?v=${ASSET_VERSION}"></script>
<script defer src="/assets/js/flows-research-ui.js?v=${ASSET_VERSION}"></script>
</body>
</html>
`;
