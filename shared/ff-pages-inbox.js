import { ABSENT_MARK, DIGEST_QUADRANTS, LIMITS, PAYLOADS } from "./ff-contract.js";

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
        <button type="button" role="tab" id="ffxIbTabHits" aria-selected="true" tabindex="0" aria-controls="ffxIbListPanel" data-v="hits">Hits</button><button type="button" role="tab" id="ffxIbTabHit" aria-selected="false" tabindex="-1" aria-controls="ffxIbHitPanel" data-v="hit">Hit</button>
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
        <header class="ffx-ib-ph"><h2 id="ffxIbHitT" tabindex="-1">Hit</h2><span class="ffx-ib-ph-n" id="ffxIbHitN"></span></header>
        <div class="ffx-ib-hit" id="ffxIbHit"><p class="ffx-ib-wait" data-ff-absent="none_selected">${ABSENT_MARK} no hit selected</p></div>
      </section>
    </div>
  </div>
  <p class="visually-hidden" id="ffxIbLive" role="status" aria-live="polite"></p>
  <dialog class="ffx-ib-dlg" id="ffxIbAllDlg" aria-labelledby="ffxIbAllT">
    <div class="ffx-ib-dg"><h2 id="ffxIbAllT">All hits</h2>
      <ul class="ffx-ib-list ffx-ib-list-all" id="ffxIbAllList"></ul>
      <div class="ffx-ib-dx"><p class="ffx-ib-dn" id="ffxIbAllNote" role="status"></p><button type="button" class="ffx-ib-link" id="ffxIbLoad" hidden>Load more</button><button type="button" class="ffx-ib-link" data-close>Close</button></div>
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

export const DIGEST_PAGE = "digest";
export const DIGEST_PATH = "/flows/digest/";
export const DIGEST_DESCRIPTION = "A session's hits by quadrant, each with its receipts line, beside the record of the house wires so far.";
export const DIGEST_STYLES = Object.freeze(["/assets/css/flows-ff-tokens.css", "/assets/css/flows-ff-inbox.css"]);
export const DIGEST_SCRIPTS = Object.freeze(["/assets/js/flows-ff-kernel.js", "/assets/js/flows-ff-client.js", "/assets/js/flows-ff-digest.js"]);
export const DIGEST_SHADOW_LINE = "Running in shadow: wires are evaluated, hits are not delivered yet. Every hit is held, so the lists stay empty; the receipts lines are real.";
export const DIGEST_SHADOW_PAST_LINE = "Running in shadow: wires are evaluated, hits are not delivered now. The hits listed here were delivered before shadow began; the receipts lines are real.";
export const DIGEST_CALIBRATION_LINE = ABSENT_MARK + " not released: the calibration leg that writes " + PAYLOADS.calibration.key + " is not built yet, so no wire has a calibration figure.";
export const DIGEST_COLUMNS = Object.freeze([
  Object.freeze({ id: "house", title: "House", quadrants: Object.freeze(["house-nightly", "house-live"]) }),
  Object.freeze({ id: "yours", title: "Yours", quadrants: Object.freeze(["yours-nightly", "yours-live"]) }),
]);
export const DIGEST_TITLES = Object.freeze({
  "house-nightly": "House · Nightly",
  "house-live": "House · Live",
  "yours-nightly": "Yours · Nightly",
  "yours-live": "Yours · Live",
});

const quadrant = (id) => `
        <section class="ffx-dig-q" id="ffxDig-${id}" data-q="${id}" aria-labelledby="ffxDig-${id}-t" aria-busy="true">
          <header class="ffx-dig-qh"><h3 id="ffxDig-${id}-t">${DIGEST_TITLES[id]}</h3><span class="ffx-dig-n" data-k="n" data-ff-absent="reading">${ABSENT_MARK} reading</span><button type="button" class="ffx-dig-all" data-k="all" hidden>Show all</button></header>
          <ul class="ffx-dig-list" data-k="list"></ul>
          <p class="ffx-dig-empty" data-k="empty" hidden></p>
          <p class="ffx-dig-inc" data-k="inc" hidden></p>
          <p class="ffx-dig-rc" data-k="rc" data-ff-absent="reading">${ABSENT_MARK} reading the receipts</p>
        </section>`;

export function digestBody(glyph, { shadow = false } = {}) {
  const g = typeof glyph === "function" ? glyph : () => "";
  if (DIGEST_QUADRANTS.join() !== DIGEST_COLUMNS.flatMap((c) => c.quadrants).join()) throw new Error("digest quadrants out of step with the contract");
  return `
  <div class="ffx ffx-dig" id="ffxDigest" data-ff-page="digest" data-view="house" data-shadow="${shadow ? "1" : "0"}">
    <header class="ffx-title" data-fx-hero>
      <h1 id="fxTitle">Digest</h1>
      <p class="ffx-cap" id="ffxDigCap" data-ff-absent="reading">${ABSENT_MARK} reading the digest</p>
      <a class="ffx-dig-latest" id="ffxDigLatest" href="${DIGEST_PATH}" hidden>Latest session</a>
      <button type="button" class="ffx-dig-btn" id="ffxDigRetry" hidden>Retry</button>
      <button type="button" class="ffx-ibtn" id="ffxDigInfoBtn" aria-haspopup="dialog" aria-label="How the Digest works">${g("info")}</button>
    </header>
    <p class="ffx-banner" id="ffxDigBanner"${shadow ? ` data-ff-mode="shadow" data-past="${DIGEST_SHADOW_PAST_LINE}"` : " hidden"}>${shadow ? DIGEST_SHADOW_LINE : ""}</p>
    <div class="ffx-tabs" role="tablist" aria-label="Digest panels" id="ffxDigTabs">
      <button type="button" role="tab" id="ffxDigTabHouse" aria-selected="true" aria-controls="ffxDigHouse" data-v="house">House</button><button type="button" role="tab" id="ffxDigTabYours" aria-selected="false" aria-controls="ffxDigYours" data-v="yours" tabindex="-1">Yours</button><button type="button" role="tab" id="ffxDigTabRecord" aria-selected="false" aria-controls="ffxDigRecord" data-v="record" tabindex="-1">Record</button>
    </div>
    <div class="ffx-dig-stage" id="ffxDigStage">${DIGEST_COLUMNS.map((c) => `
      <section class="ffx-panel ffx-dig-col" id="ffxDig${c.title}" data-col="${c.id}" role="tabpanel" aria-labelledby="ffxDigTab${c.title}">
        <h2 class="visually-hidden">${c.title}</h2>${c.quadrants.map(quadrant).join("")}
      </section>`).join("")}
      <section class="ffx-panel ffx-dig-col ffx-dig-rec" id="ffxDigRecord" data-col="record" role="tabpanel" aria-labelledby="ffxDigRecT">
        <header class="ffx-ph"><h2 id="ffxDigRecT">Record so far</h2><span class="ffx-ph-n" id="ffxDigRecN"></span><button type="button" class="ffx-dig-all" id="ffxDigRecAll" data-k="all" data-list="record" hidden>Show all</button></header>
        <p class="ffx-dig-cal" id="ffxDigCal" data-ff-absent="not_released">${DIGEST_CALIBRATION_LINE}</p>
        <ul class="ffx-dig-list ffx-dig-recs" id="ffxDigRecs" aria-busy="true"><li class="ffx-dig-wait" data-ff-absent="reading">${ABSENT_MARK} reading the house wires</li></ul>
        <div class="ffx-dig-hy" id="ffxDigHy" hidden><div class="ffx-dig-hyh"><h3>Silent wires of yours</h3><button type="button" class="ffx-dig-all" id="ffxDigHyAll" data-k="all" data-list="silent" hidden>Show all</button></div><ul class="ffx-dig-list" id="ffxDigHyList"></ul></div>
        <p class="ffx-foot">Firings are counted on the wire's current version. No price outcome is scored.</p>
      </section>
    </div>
  </div>
  <p class="visually-hidden" id="ffxDigLive" role="status" aria-live="polite"></p>
  <dialog class="ffx-dig-dlg" id="ffxDigAll" aria-labelledby="ffxDigAllT">
    <div class="ffx-dig-dg"><h2 id="ffxDigAllT">All hits</h2><ul class="ffx-dig-list ffx-dig-full" id="ffxDigAllList"></ul>
      <div class="ffx-dig-dx"><button type="button" class="ffx-dig-btn" data-close>Close</button></div>
    </div>
  </dialog>
  <dialog class="ffx-dig-dlg" id="ffxDigInfo" aria-labelledby="ffxDigInfoT">
    <div class="ffx-dig-dg"><h2 id="ffxDigInfoT">How the Digest works</h2>
      <p>The Digest is one session's delivered hits in four quadrants: house wires and yours, each read nightly or live.</p>
      <p>Each quadrant ends with its receipts line: how many armed wires were evaluated for the session, and why any were not.</p>
      <p>It is computed when you open it, with no model. A wire with more than three hits in the session is grouped.</p>
      <p>The record counts firings over sessions for each house wire you follow. A figure Flows has not measured is a dash with its reason, never zero.</p>
      <p>No price outcome is scored anywhere. Times are in TRT.</p>
      <div class="ffx-dig-dx"><button type="button" class="ffx-dig-btn" data-close>Close</button></div>
    </div>
  </dialog>`;
}
