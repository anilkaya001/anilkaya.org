import { COPY } from "./flows-macro-copy.js";

export const MACRO_DESCRIPTION = "Rates, currencies, commodities, crypto and futures beside the equity option flow, with prediction-market prices for scheduled releases and seasonality shown with its sample.";

export const MACRO_STYLES = Object.freeze(["/assets/css/flows-macro.css"]);

export const MACRO_SCRIPTS = Object.freeze(["/assets/js/flows-fresh.js", "/assets/js/flows-macro.js"]);

export const MACRO_DEFER = "/assets/js/flows-macro-charts.js";

export const MACRO_TABS = Object.freeze([
  ["overview", "Overview"], ["rates", "Rates"], ["fx", "FX"], ["commod", "Commodities"], ["crypto", "Crypto"], ["futures", "Futures"], ["odds", "Odds"], ["season", "Seasonality"],
]);

export const MACRO_MODULES = Object.freeze({
  overview: [["eq", "Equity futures", "Equities"], ["rt", COPY["title.rates"], "Rates"], ["fx", COPY["title.fx"], "FX"], ["cm", COPY["title.commodities"], "Commodities"], ["cr", COPY["title.crypto"], "Crypto"], ["cal", "Calendar and odds", "Calendar"], ["mv", "Movers", "Movers"]],
  rates: [["curve", COPY["title.curve"], "Curve"], ["sprd", "Spreads", "Spreads"], ["ff", "Fed funds", "Fed funds"], ["ind", COPY["title.indicators"], "Economy"]],
  fx: [["fxg", "Pairs", "Pairs"], ["fxc", "Hourly chart", "Chart"]],
  commod: [["cmg", COPY["title.commodities"], "Commodities"]],
  crypto: [["crp", "Pairs", "Pairs"], ["crc", "BTC, 5-minute", "Chart"], ["crw", "Large trades", "Large trades"]],
  futures: [["fub", "Board", "Board"], ["fuc", "Curve", "Curve"], ["ful", COPY["title.large"], "Large prints"]],
  odds: [["odc", "Releases and prices", "Calendar"], ["odd", "Market detail", "Detail"]],
  season: [["sef", "Funds", "Funds"], ["sep", "Screen", "Screen"]],
});

export const HERO_CELLS = Object.freeze([
  ["es", "S&P 500 futures", "LMSX"], ["ty", "10-year yield", "LMSX"], ["sp", "2s10s", "LMS"], ["wti", "WTI crude", "LMS"], ["gc", "Gold futures", "LM"], ["eur", "EURUSD", "LM"], ["btc", "Bitcoin", "LMSX"],
]);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const DASH = "—";

export function macroBody(glyph, { live = false } = {}) {
  const tabs = MACRO_TABS.map(([key, label], i) =>
    `<button type="button" role="tab" id="mcT-${key}" class="mc-tab" aria-controls="mcV-${key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-v="${key}">${esc(label)}</button>`).join("");
  const hero = HERO_CELLS.map(([key, label, fits], i) =>
    `<div class="mc-cell" id="mcH-${key}" data-k="${key}" data-fits="${fits}"><span class="mc-ck">${esc(label)}</span><span class="mc-cv">${DASH}</span><span class="mc-cc"></span><span class="mc-cs">&nbsp;</span></div>`).join("");
  const views = MACRO_TABS.map(([key], i) => {
    const mods = MACRO_MODULES[key].map(([m, title, short]) =>
      `<section class="ui-card ui-mod mc-mod" id="mcM-${m}" data-m="${m}" data-short="${esc(short)}" aria-labelledby="mcMT-${m}">` +
      `<header class="ui-mod-h"><h2 class="ui-mod-t" id="mcMT-${m}">${esc(title)}</h2><span class="ui-mod-sp"></span><span class="mc-src" id="mcS-${m}"></span><button type="button" class="mc-all" id="mcA-${m}" hidden aria-haspopup="dialog">Show all</button></header>` +
      `<div class="mc-body" id="mcB-${m}"><p class="mc-pend">${esc(COPY["state.pending"])}</p></div></section>`).join("");
    return `<div class="mc-view" id="mcV-${key}" role="tabpanel" aria-labelledby="mcT-${key}" data-v="${key}"${i === 0 ? "" : " inert"}>${mods}</div>`;
  }).join("\n");
  return `
  <div class="mc" id="mc" data-live="${live ? "on" : "off"}" data-view="overview" data-fit="L">
    <div class="mc-top">
      <header class="flows-head mc-head" data-fx-hero>
        <h1 id="fxTitle">${esc(COPY["title.page"])}</h1>
        <p class="mc-meta" id="mcMeta"></p>
        <button type="button" class="mc-ibtn" id="mcInfoBtn" aria-label="${esc(COPY["nothere.title"])}" aria-haspopup="dialog">${glyph("info")}</button>
      </header>
      <div class="mc-tabs" role="tablist" aria-label="Macro views" id="mcTabs">${tabs}</div>
    </div>
    <section class="mc-hero" id="mcHero" aria-label="Cross-asset at a glance">${hero}</section>
    <div class="mc-sub" id="mcSub" role="tablist" aria-label="Modules in this view" hidden></div>
    <div class="mc-stage" id="mcStage" data-view="overview">
${views}
    </div>
    <p class="visually-hidden" id="mcStatus" role="status">Loading the macro board\u2026</p>
    <script type="application/json" id="mcCopy">${JSON.stringify(COPY).replace(/</g, "\\u003c")}</script>
    <dialog class="mc-dlg" id="mcDlg" aria-labelledby="mcDlgT"><div class="dg"><h2 id="mcDlgT"></h2><div class="body" id="mcDlgB"></div><div class="x"><button type="button" class="link" id="mcDlgX">Close</button></div></div></dialog>
  </div>`;
}
