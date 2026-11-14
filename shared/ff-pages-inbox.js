import { ABSENT_MARK, DIGEST_QUADRANTS, PAYLOADS } from "./ff-contract.js";

export const DIGEST_PAGE = "digest";
export const DIGEST_PATH = "/flows/digest/";
export const DIGEST_DESCRIPTION = "A session's hits by quadrant, each with its receipts line, beside the record of the house wires so far.";
export const DIGEST_STYLES = Object.freeze(["/assets/css/flows-ff-tokens.css", "/assets/css/flows-ff-inbox.css"]);
export const DIGEST_SCRIPTS = Object.freeze(["/assets/js/flows-ff-kernel.js", "/assets/js/flows-ff-client.js", "/assets/js/flows-ff-digest.js"]);
export const DIGEST_SHADOW_LINE = "Running in shadow: wires are evaluated, hits are not delivered yet. Every hit is held, so the lists stay empty; the receipts lines are real.";
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
    <p class="ffx-banner" id="ffxDigBanner"${shadow ? ' data-ff-mode="shadow"' : " hidden"}>${shadow ? DIGEST_SHADOW_LINE : ""}</p>
    <div class="ffx-tabs" role="tablist" aria-label="Digest panels" id="ffxDigTabs">
      <button type="button" role="tab" id="ffxDigTabHouse" aria-selected="true" aria-controls="ffxDigHouse" data-v="house">House</button><button type="button" role="tab" id="ffxDigTabYours" aria-selected="false" aria-controls="ffxDigYours" data-v="yours" tabindex="-1">Yours</button><button type="button" role="tab" id="ffxDigTabRecord" aria-selected="false" aria-controls="ffxDigRecord" data-v="record" tabindex="-1">Record</button>
    </div>
    <div class="ffx-dig-stage" id="ffxDigStage">${DIGEST_COLUMNS.map((c) => `
      <section class="ffx-panel ffx-dig-col" id="ffxDig${c.title}" data-col="${c.id}" role="tabpanel" aria-labelledby="ffxDigTab${c.title}">
        <h2 class="visually-hidden">${c.title}</h2>${c.quadrants.map(quadrant).join("")}
      </section>`).join("")}
      <section class="ffx-panel ffx-dig-col ffx-dig-rec" id="ffxDigRecord" data-col="record" role="tabpanel" aria-labelledby="ffxDigRecT">
        <header class="ffx-ph"><h2 id="ffxDigRecT">Record so far</h2><span class="ffx-ph-n" id="ffxDigRecN"></span></header>
        <p class="ffx-dig-cal" id="ffxDigCal" data-ff-absent="not_released">${DIGEST_CALIBRATION_LINE}</p>
        <ul class="ffx-dig-list ffx-dig-recs" id="ffxDigRecs" aria-busy="true"><li class="ffx-dig-wait" data-ff-absent="reading">${ABSENT_MARK} reading the house wires</li></ul>
        <div class="ffx-dig-hy" id="ffxDigHy" hidden><h3>Silent wires of yours</h3><ul class="ffx-dig-list" id="ffxDigHyList"></ul></div>
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
