import { TITLE, SUBTITLE, DESCRIPTION, TABS, STATES, SESSION_NOTE, RANKS, PRESET_LABELS, SCREEN_COLUMNS, INFO, NOT_BUILT, LABELS, RANK_NOTE, DRILL, CONVENTION, clientCopy, drillCopy } from "./flows-flowlab-copy.js";
import { PRESET_IDS } from "./flows-flowlab.js";

export const FLOWLAB_DESCRIPTION = DESCRIPTION;

export const FLOWLAB_STYLES = Object.freeze(["/assets/css/flows-flowlab.css"]);

export const FLOWLAB_SCRIPTS = Object.freeze(["/assets/js/flows-chart.js", "/assets/js/flows-fresh.js", "/assets/js/flows-drill.js", "/assets/js/flows-flowlab.js"]);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const DASH = "—";

export const copyScript = (entry = false) => `<script type="application/json" id="flCopy">${JSON.stringify(entry ? drillCopy() : clientCopy()).replace(/</g, "\\u003c")}</script>`;

const wait = () => `<p class="fl-wait" role="status">${esc(STATES.loading)}</p>`;

const mod = (id, title, { more = false, tools = "", note = "", cls = "" } = {}) => `
      <section class="ui-card fl-mod${cls ? " " + cls : ""}" id="${id}" aria-labelledby="${id}T" data-short="${esc(title)}">
        <header class="fl-mh"><h2 id="${id}T">${esc(title)}</h2>${tools}<span class="fl-stamp" id="${id}S"></span>${more ? `<button type="button" class="fl-more" id="${id}M" data-all="${id}" aria-haspopup="dialog" hidden>${esc(LABELS.show)}</button>` : ""}</header>
        <div class="fl-body" id="${id}B">${wait()}</div>
        <p class="fl-note" id="${id}N">${note}</p>
      </section>`;

function screenTable() {
  const head = SCREEN_COLUMNS.map((c) => `<th scope="col" class="c-${c.id}">${esc(c.label)}</th>`).join("");
  const rows = Array.from({ length: 12 }, () => `<tr aria-hidden="true">${SCREEN_COLUMNS.map((c) => `<td class="c-${c.id}">${DASH}</td>`).join("")}</tr>`).join("");
  return `<table class="fl-t fl-skel" aria-hidden="true"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function presetRows() {
  return PRESET_IDS.map((id, i) => `<button type="button" role="radio" class="fl-pre" data-p="${id}" aria-checked="${i === 0 ? "true" : "false"}" tabindex="${i === 0 ? "0" : "-1"}"><span class="fl-pre-l">${esc(PRESET_LABELS[id])}</span><span class="fl-pre-n" data-n="${id}">${DASH}</span></button>`).join("");
}

function groupTiles() {
  return Array.from({ length: 25 }, () => `<div class="fl-tile" aria-hidden="true"><span class="fl-tile-n">${DASH}</span></div>`).join("");
}

export function flowlabBody(glyph) {
  const tabs = TABS.map((t, i) => `<button type="button" role="tab" class="fl-tab" id="flTab-${t.id}" data-view="${t.id}" aria-selected="${i === 0 ? "true" : "false"}" aria-controls="flP-${t.id}" tabindex="${i === 0 ? "0" : "-1"}">${esc(t.label)}</button>`).join("");
  const panel = (id, inner) => `
    <div class="fl-panel" id="flP-${id}" role="tabpanel" aria-labelledby="flTab-${id}" data-view="${id}"${id === "screen" ? " data-on" : " inert"}>${inner}
    </div>`;
  const rankTools = `<div class="fl-rank" role="radiogroup" aria-label="Rank by" id="flRank">${RANKS.map((r, i) => `<button type="button" role="radio" data-rank="${r.id}" aria-checked="${i === 0 ? "true" : "false"}" tabindex="${i === 0 ? "0" : "-1"}">${esc(r.label)}</button>`).join("")}</div>`;
  const greekTools = `<div class="fl-greek-tools"><div class="fl-rank" role="radiogroup" aria-label="Basis" id="flBasis"><button type="button" role="radio" data-basis="dir" aria-checked="true" tabindex="0">${esc(LABELS.directional)}</button><button type="button" role="radio" data-basis="tot" aria-checked="false" tabindex="-1">${esc(LABELS.total)}</button></div><button type="button" class="fl-tog" id="flOtm" aria-pressed="false">${esc(LABELS.otm)}</button></div>`;
  const body = `
  <p class="visually-hidden" id="flStatus" role="status">${esc(STATES.loading)}</p>
  <div class="fl" id="flMain" data-fl>
    <header class="fl-head" data-fx-hero>
      <div class="fl-title"><h1 id="fxTitle">${esc(TITLE)}</h1><p class="fl-sub">${esc(SUBTITLE)}</p></div>
      <form class="fl-tk" id="flTk" autocomplete="off"><label class="visually-hidden" for="flT">${esc(LABELS.ticker)}</label><input id="flT" name="t" type="text" inputmode="text" maxlength="10" spellcheck="false" autocapitalize="characters" placeholder="${esc(LABELS.ticker)}" list="flTL" aria-label="${esc(LABELS.ticker)}"><datalist id="flTL"></datalist><button type="submit" class="ds-btn">Read</button></form>
      <div class="fl-act"><span class="fl-stamp" id="flStamp"></span><button type="button" class="ds-btn" id="flRefresh">${esc(LABELS.refresh)}</button><button type="button" class="fl-ibtn" id="flInfo" aria-label="How to read this page" aria-haspopup="dialog">${glyph("info")}</button></div>
    </header>
    <div class="fl-tabs" id="flTabs" role="tablist" aria-label="Flow Lab views">${tabs}</div>
    <div class="fl-mods" id="flMods" role="tablist" aria-label="Module" hidden></div>
    <div class="fl-stage" id="flStage" data-view="screen">${panel("screen", `
      <div class="fl-col fl-col-main">${mod("flScreen", "Contracts", { more: true, tools: rankTools, note: esc(RANK_NOTE) })}</div>
      <div class="fl-col fl-col-side">${mod("flPreset", "Presets", { cls: "fl-mod-pre" })}${mod("flScatter", "Volume to open interest")}</div>`)}${panel("strikes", `
      <div class="fl-col fl-col-main">${mod("flStrikes", "Strike map", { more: true, note: esc(CONVENTION) })}</div>
      <div class="fl-col fl-col-side">${mod("flStrikeRail", "Signed contracts by strike", { more: true })}</div>`)}${panel("greeks", `
      <div class="fl-col fl-col-main">${mod("flGreeks", "Greek flow", { tools: greekTools, note: "" })}</div>
      <div class="fl-col fl-col-side">${mod("flRecent", "Premium by expiry")}</div>`)}${panel("ladders", `
      <div class="fl-col fl-col-wide">${mod("flLadder", "Price ladders", { more: true })}</div>`)}${panel("routing", `
      <div class="fl-col fl-col-main">${mod("flRoute", "Exchanges", { more: true })}</div>
      <div class="fl-col fl-col-side">${mod("flCodes", "Trade codes", { more: true })}</div>`)}${panel("lit", `
      <div class="fl-col fl-col-main">${mod("flLitMarket", "Largest lit prints", { more: true })}</div>
      <div class="fl-col fl-col-side">${mod("flLitTicker", "Newest prints for the name", { more: true })}</div>`)}${panel("groups", `
      <div class="fl-col fl-col-wide">${mod("flGroups", "Flow groups", { more: true })}</div>`)}${panel("relations", `
      <div class="fl-col fl-col-wide">${mod("flRel", "Names that moved together", { more: true })}</div>`)}
    </div>
    <p class="fl-foot" id="flFoot">${esc(SESSION_NOTE)}</p>
  </div>
  <dialog class="fl-dlg" id="flAll" aria-labelledby="flAllT"><div class="fl-dg"><header class="fl-dh"><h2 id="flAllT"></h2><button type="button" class="fl-x" data-close>${esc(DRILL.close)}</button></header><div class="fl-db" id="flAllB"></div></div></dialog>
  <dialog class="fl-dlg" id="flInfoDlg" aria-labelledby="flInfoT"><div class="fl-dg"><header class="fl-dh"><h2 id="flInfoT">How to read this page</h2><button type="button" class="fl-x" data-close>${esc(DRILL.close)}</button></header><div class="fl-db">${[...INFO, ...NOT_BUILT].map((s) => `<p>${esc(s)}</p>`).join("")}</div></div></dialog>
  ${copyScript()}`;
  return body;
}
