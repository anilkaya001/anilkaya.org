import { ABSENT_MARK, LIMITS } from "./ff-contract.js";

export const WIRES_PAGE = "wires";
export const WIRES_PATH = "/flows/wires/";
export const WIRES_DESCRIPTION = "Your wires in one place: arm, pause, adjust or retire each, and read every version it has had.";
export const WIRES_STYLES = Object.freeze(["/assets/css/flows-ff-tokens.css", "/assets/css/flows-ff-fire.css", "/assets/css/flows-ff-inbox.css"]);
export const WIRES_SCRIPTS = Object.freeze(["/assets/js/flows-ff-kernel.js", "/assets/js/flows-ff-client.js", "/assets/js/flows-ff-wires.js"]);
export const WIRES_SHEET_GROUP = "ff-sheet";
export const WIRES_SHEET_FILES = Object.freeze(["/assets/js/flows-ff-composer.js", "/assets/js/flows-ff-preview.js", "/assets/js/flows-ff-fire.js"]);
export const WIRES_SHADOW_LINE = "Running in shadow: wires are evaluated, hits are not delivered yet.";
export const WIRES_LIMITS_LINE = "At most " + LIMITS.armedMemberWires + " armed wires, of which at most " + LIMITS.liveMemberWires + " live and " + LIMITS.universeMemberWires + " on the whole universe.";
export const WIRES_FILTERS = Object.freeze([
  Object.freeze({ id: "live", label: "In use" }),
  Object.freeze({ id: "retired", label: "Retired" }),
  Object.freeze({ id: "house", label: "House" }),
]);

const filterButton = (f, i) =>
  `<button type="button" role="tab" id="ffxWrF-${f.id}" aria-selected="${i === 0 ? "true" : "false"}" tabindex="${i === 0 ? "0" : "-1"}" aria-controls="ffxWrList" data-f="${f.id}">${f.label}</button>`;

export function wiresBody(glyph, { shadow = false, v = (p) => p, data = "" } = {}) {
  const g = typeof glyph === "function" ? glyph : () => "";
  return `
  ${data}
  <div class="ffx ffx-wr" id="ffxWires" data-ff-page="wires" data-view="list" data-filter="live" data-armed-max="${LIMITS.armedMemberWires}" data-live-max="${LIMITS.liveMemberWires}" data-universe-max="${LIMITS.universeMemberWires}">
    <header class="ffx-title" data-fx-hero>
      <h1 id="fxTitle">Wires</h1>
      <p class="ffx-cap" id="ffxWrCap" data-ff-absent="reading">${ABSENT_MARK} reading your wires</p>
      <a class="ffx-btn ffx-primary ffx-wr-new" id="ffxWrNew" href="/flows/fire/">Arm a wire</a>
      <button type="button" class="ffx-ibtn" id="ffxWrInfoBtn" aria-haspopup="dialog" aria-label="How the Wires page works">${g("info")}</button>
    </header>
    <p class="ffx-banner" id="ffxWrBanner"${shadow ? ' data-ff-mode="shadow"' : " hidden"}>${shadow ? WIRES_SHADOW_LINE : ""}</p>
    <div class="ffx-tabs" role="tablist" aria-label="Wires panels" id="ffxWrTabs">
      <button type="button" role="tab" id="ffxWrTabList" aria-selected="true" aria-controls="ffxWrListPanel" data-v="list">List</button><button type="button" role="tab" id="ffxWrTabWire" aria-selected="false" aria-controls="ffxWrDetailPanel" data-v="wire" tabindex="-1">Wire</button>
    </div>
    <div class="ffx-wr-stage" id="ffxWrStage">
      <section class="ffx-panel ffx-wr-lp" id="ffxWrListPanel" role="tabpanel" aria-labelledby="ffxWrListT">
        <header class="ffx-ph"><h2 id="ffxWrListT">Your wires</h2><span class="ffx-ph-n" id="ffxWrCount"></span></header>
        <div class="ffx-seg ffx-wr-filters" role="tablist" aria-label="Which wires" id="ffxWrFilters">${WIRES_FILTERS.map(filterButton).join("")}</div>
        <ul class="ffx-wr-list" id="ffxWrList" aria-labelledby="ffxWrListT"></ul>
        <p class="ffx-wait ffx-wr-state" id="ffxWrState" data-ff-absent="reading">${ABSENT_MARK} reading your wires</p>
        <footer class="ffx-wr-lfoot"><span class="ffx-wr-more" id="ffxWrMore"></span><button type="button" class="ffx-link" id="ffxWrAll" aria-haspopup="dialog" hidden>Show all</button><button type="button" class="ffx-link" id="ffxWrRetry" hidden>Retry</button></footer>
      </section>
      <section class="ffx-panel ffx-wr-dp" id="ffxWrDetailPanel" role="tabpanel" aria-labelledby="ffxWrDetailT">
        <header class="ffx-ph"><h2 id="ffxWrDetailT">Wire</h2><span class="ffx-ph-n" id="ffxWrVer"></span></header>
        <div class="ffx-wr-detail" id="ffxWrDetail"><p class="ffx-wait" data-ff-absent="none_selected">${ABSENT_MARK} no wire selected</p></div>
      </section>
    </div>
  </div>
  <p class="visually-hidden" id="ffxWrLive" role="status" aria-live="polite"></p>
  <dialog class="ffx-dlg ffx-wr-dlg" id="ffxWrAllDlg" aria-labelledby="ffxWrAllT">
    <div class="ffx-dg"><h2 id="ffxWrAllT">All wires</h2>
      <ul class="ffx-wr-list ffx-wr-list-all" id="ffxWrAllList"></ul>
      <div class="ffx-dx"><button type="button" class="ffx-link" data-close>Close</button></div>
    </div>
  </dialog>
  <dialog class="ffx-dlg ffx-wr-dlg" id="ffxWrHistDlg" aria-labelledby="ffxWrHistT">
    <div class="ffx-dg"><h2 id="ffxWrHistT">Every version</h2>
      <ol class="ffx-wr-vers ffx-wr-vers-all" id="ffxWrHistList"></ol>
      <div class="ffx-dx"><button type="button" class="ffx-link" data-close>Close</button></div>
    </div>
  </dialog>
  <dialog class="ffx-dlg ffx-wr-dlg" id="ffxWrInfo" aria-labelledby="ffxWrInfoT">
    <div class="ffx-dg"><h2 id="ffxWrInfoT">How the Wires page works</h2>
      <p>${WIRES_LIMITS_LINE}</p>
      <p>Pause stops a wire from being read and keeps it. Arm puts it back. Retire takes it out of use; a retired wire can be restored.</p>
      <p>Adjust saves a new version. An armed version is never changed, so an old hit keeps the sentence it was written under.</p>
      <p>A house wire is written by Flows. You can turn it off or on, never edit it.</p>
      <p>A figure Flows did not read is a dash with its reason. Times are in TRT.</p>
      <div class="ffx-dx"><button type="button" class="ffx-link" data-close>Close</button></div>
    </div>
  </dialog>
  ${WIRES_SHEET_FILES.map((f) => `<i hidden data-defer="${WIRES_SHEET_GROUP}" data-src="${v(f)}"></i>`).join("\n  ")}`;
}
