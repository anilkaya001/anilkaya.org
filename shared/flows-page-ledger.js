import { INFO, NOT_BUILT, TITLE, BALANCING_DEFINITION, KEY_LINE, ZERO_LINE } from "./flows-sfc-copy.js";

export const LEDGER_DESCRIPTION = "A closed ledger of option premium in held windows: who paid, who received, and where each sector sits against its market-cap share.";

export const LEDGER_STYLES = Object.freeze(["/assets/css/flows-sfc.css"]);

export const LEDGER_SCRIPTS = Object.freeze(["/assets/js/flows-fresh.js", "/assets/js/flows-sfc.js"]);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const para = (list) => list.map((s) => `<p>${esc(s)}</p>`).join("");

export function ledgerBody(glyph) {
  return `
  <p class="visually-hidden" id="sfStatus" role="status">Loading the ledger…</p>
  <div class="sf" id="sf">
    <div class="sf-title" data-fx-hero>
      <h1 id="fxTitle">${esc(TITLE)}</h1>
      <div class="sf-stamp" id="sfStamp"></div>
      <button type="button" class="sf-ibtn" id="sfInfoBtn" aria-label="How to read this page" aria-haspopup="dialog">${glyph("info")}</button>
    </div>
    <div class="sf-ctl">
      <div class="sf-seg" role="group" aria-label="Period" id="sfPeriod">
        <button type="button" data-p="intraday" aria-pressed="false">Intraday</button><button type="button" data-p="session" aria-pressed="false">Session</button><button type="button" data-p="five" aria-pressed="false">5 sessions</button>
      </div>
      <nav class="sf-crumbs" aria-label="Scope" id="sfCrumbs"></nav>
      <p class="sf-scope" id="sfScope"></p>
    </div>
    <div class="sf-checks" id="sfChecks" role="group" aria-label="Checks"></div>
    <p class="sf-checkline" id="sfCheckLine"></p>
    <p class="sf-note" id="sfNote" hidden></p>
    <div class="sf-tabs" role="tablist" aria-label="Panels" id="sfTabs">
      <button type="button" role="tab" aria-selected="true" aria-controls="sfLedger" data-v="ledger">Ledger</button><button type="button" role="tab" aria-selected="false" aria-controls="sfSide" data-v="side">Sectors</button><button type="button" role="tab" aria-selected="false" aria-controls="sfRead" data-v="read">Reading</button>
    </div>
    <div class="sf-stage" id="sfStage" data-view="ledger">
      <section class="sf-panel sf-ledger" id="sfLedger" aria-label="Ledger">
        <div class="sf-ph"><h2>Ledger</h2><span class="sf-cap" id="sfCap"></span><div class="sf-seg r sf-groups" role="group" aria-label="Columns" id="sfGroups"></div></div>
        <p class="sf-key" id="sfKey">${esc(KEY_LINE)}</p>
        <div class="sf-mat" id="sfMatrix"></div>
        <p class="sf-cell" id="sfCellLine" data-zero="${esc(ZERO_LINE)}">${esc(ZERO_LINE)}</p>
      </section>
      <section class="sf-panel sf-side" id="sfSide" aria-label="Sectors">
        <div class="sf-ph"><h2 id="sfSideT">Sectors</h2><span class="sf-cap" id="sfSideCap"></span>
          <div class="sf-seg r" role="group" aria-label="View" id="sfView"><button type="button" data-w="table" aria-pressed="true" id="sfViewT">Sectors</button><button type="button" data-w="flow" aria-pressed="false">Flow</button></div>
        </div>
        <div class="sf-body" id="sfBody"></div>
        <p class="sf-foot" id="sfFoot"></p>
      </section>
      <section class="sf-panel sf-read" id="sfRead" aria-label="Reading">
        <div class="sf-ph"><h2>Reading</h2></div>
        <div class="sf-readbox" id="sfReadBox"></div>
      </section>
    </div>
  </div>
  <dialog class="sf-dlg" id="sfInfoDlg" aria-labelledby="sfInfoT"><div class="dg"><h2 id="sfInfoT">How to read this page</h2>
    <div class="body">${para(INFO)}<p>${esc(BALANCING_DEFINITION)}</p><h3>Not built</h3>${para(NOT_BUILT)}</div>
    <div class="x"><button type="button" class="link" id="sfInfoX">Close</button></div></div></dialog>
`;
}

