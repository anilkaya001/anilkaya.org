import { ABSENT_MARK, LIMITS } from "./ff-contract.js";

export const INBOX_PAGE = "inbox";
export const INBOX_PATH = "/flows/inbox/";
export const INBOX_DESCRIPTION = "The hits your wires and the house wires wrote, each with its evidence and the receipts of its wire.";
export const INBOX_STYLES = Object.freeze(["/assets/css/flows-ff-tokens.css", "/assets/css/flows-ff-inbox.css"]);
export const INBOX_SCRIPTS = Object.freeze([
  "/assets/js/flows-ff-kernel.js", "/assets/js/flows-ff-client.js", "/assets/js/flows-ff-evidence.js", "/assets/js/flows-ff-inbox.js",
]);
export const INBOX_SHADOW_LINE = "Running in shadow: hits are evaluated and held, none is delivered yet.";
export const INBOX_GROUP_AFTER = LIMITS.groupInboxAfter;
export const INBOX_FILTERS = Object.freeze([
  Object.freeze({ id: "all", label: "All" }),
  Object.freeze({ id: "unread", label: "Unread" }),
  Object.freeze({ id: "pinned", label: "Pinned" }),
  Object.freeze({ id: "archived", label: "Dismissed" }),
]);

const filterButton = (f, i) =>
  `<button type="button" role="tab" id="ffxIbF-${f.id}" aria-selected="${i === 0 ? "true" : "false"}" tabindex="${i === 0 ? "0" : "-1"}" aria-controls="ffxIbList" data-state="${f.id}">${f.label}</button>`;

export function inboxBody(glyph, { shadow = false } = {}) {
  const g = typeof glyph === "function" ? glyph : () => "";
  return `
  <div class="ffx-ib" id="ffxInbox" data-ff-page="inbox" data-view="hits" data-mode="${shadow ? "shadow" : "on"}" data-group-after="${INBOX_GROUP_AFTER}">
    <header class="ffx-ib-title" data-fx-hero>
      <h1 id="fxTitle">Inbox</h1>
      <p class="ffx-ib-cap" id="ffxIbCap" data-ff-absent="reading">${ABSENT_MARK} reading your hits</p>
      <button type="button" class="ffx-ib-btn" id="ffxIbRead" disabled>Mark all read</button>
      <button type="button" class="ffx-ib-ibtn" id="ffxIbInfoBtn" aria-haspopup="dialog" aria-label="How the Inbox works">${g("info")}</button>
    </header>
    <p class="ffx-ib-banner" id="ffxIbBanner"${shadow ? ' data-ff-mode="shadow"' : " hidden"}>${shadow ? INBOX_SHADOW_LINE : ""}</p>
    <div class="ffx-ib-health" id="ffxIbHealth" data-ff-state="unknown" role="group" aria-label="Fire and Forget health">
      <span class="ffx-ib-dot" aria-hidden="true"></span>
      <span class="ffx-ib-hl" id="ffxIbHealthLine" data-ff-absent="reading">${ABSENT_MARK} reading the evaluator</span>
      <span class="ffx-ib-hn" id="ffxIbHealthNightly"></span>
      <span class="ffx-ib-hv" id="ffxIbHealthLive"></span>
    </div>
    <div class="ffx-ib-bar">
      <div class="ffx-ib-filters" role="tablist" aria-label="Which hits" id="ffxIbFilters">${INBOX_FILTERS.map(filterButton).join("")}</div>
      <div class="ffx-ib-tabs" role="tablist" aria-label="Inbox panels" id="ffxIbTabs">
        <button type="button" role="tab" id="ffxIbTabHits" aria-selected="true" aria-controls="ffxIbListPanel" data-v="hits">Hits</button><button type="button" role="tab" id="ffxIbTabHit" aria-selected="false" aria-controls="ffxIbHitPanel" data-v="hit">Hit</button>
      </div>
    </div>
    <div class="ffx-ib-stage" id="ffxIbStage">
      <section class="ffx-ib-panel ffx-ib-lp" id="ffxIbListPanel" role="tabpanel" aria-labelledby="ffxIbListT">
        <header class="ffx-ib-ph"><h2 id="ffxIbListT">Hits</h2><span class="ffx-ib-ph-n" id="ffxIbCount"></span></header>
        <ul class="ffx-ib-list" id="ffxIbList" aria-labelledby="ffxIbListT"></ul>
        <p class="ffx-ib-state" id="ffxIbState" data-ff-absent="reading">${ABSENT_MARK} reading your hits</p>
        <footer class="ffx-ib-lfoot"><span id="ffxIbMore"></span><button type="button" class="ffx-ib-link" id="ffxIbAll" hidden>Show all</button><button type="button" class="ffx-ib-link" id="ffxIbRetry" hidden>Retry</button></footer>
      </section>
      <section class="ffx-ib-panel ffx-ib-hp" id="ffxIbHitPanel" role="tabpanel" aria-labelledby="ffxIbHitT">
        <header class="ffx-ib-ph"><h2 id="ffxIbHitT">Hit</h2><span class="ffx-ib-ph-n" id="ffxIbHitN"></span></header>
        <div class="ffx-ib-hit" id="ffxIbHit"><p class="ffx-ib-wait" data-ff-absent="none_selected">${ABSENT_MARK} no hit selected</p></div>
      </section>
    </div>
  </div>
  <p class="visually-hidden" id="ffxIbLive" role="status" aria-live="polite"></p>
  <dialog class="ffx-ib-dlg" id="ffxIbAllDlg" aria-labelledby="ffxIbAllT">
    <div class="ffx-ib-dg"><h2 id="ffxIbAllT">All hits</h2>
      <ul class="ffx-ib-list ffx-ib-list-all" id="ffxIbAllList"></ul>
      <div class="ffx-ib-dx"><button type="button" class="ffx-ib-link" id="ffxIbLoad" hidden>Load more</button><button type="button" class="ffx-ib-link" data-close>Close</button></div>
    </div>
  </dialog>
  <dialog class="ffx-ib-dlg" id="ffxIbInfo" aria-labelledby="ffxIbInfoT">
    <div class="ffx-ib-dg"><h2 id="ffxIbInfoT">How the Inbox works</h2>
      <p>A hit is written once, when every condition of a wire first holds. It never changes afterwards.</p>
      <p>Your hits and the house wires' hits each keep their own numbered stream. Mark all read moves both to the newest hit this page read.</p>
      <p>A figure Flows did not read is a dash with its reason. It is never read as zero.</p>
      <p>The receipts say whether the wire was evaluated on each session, and why not when it was not.</p>
      <p>No price outcome is scored. Times are in TRT with the session label.</p>
      <div class="ffx-ib-dx"><button type="button" class="ffx-ib-link" data-close>Close</button></div>
    </div>
  </dialog>`;
}
