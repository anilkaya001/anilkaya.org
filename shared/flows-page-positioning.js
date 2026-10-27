import { INFO_SENTENCES, STATE_SENTENCES } from "./flows-pos-copy.js";
import { SECTOR_ORDER } from "./flows-pos-13f.js";

export const POSITIONING_DESCRIPTION = "How a fixed set of 13F filers moved their book between sectors, what insiders did by sector, and where failures to deliver and short-sale volume sit.";

export const POSITIONING_STYLES = Object.freeze(["/assets/css/flows-feeds.css", "/assets/css/flows-pos.css"]);

export const POSITIONING_SCRIPTS = Object.freeze(["/assets/js/flows-feed-os.js", "/assets/js/flows-pos.js"]);

export const POSITIONING_TABS = Object.freeze([
  ["rotation", "Rotation", "posRotCard"],
  ["filings", "Filings", "posFilCard"],
  ["insiders", "Insiders", "posInsCard"],
  ["short", "Short side", "posShCard"],
]);

export const HERO_CELLS = Object.freeze([
  Object.freeze({ id: "filers", label: "Filers compared", sub: "Quarter over quarter" }),
  Object.freeze({ id: "rotation", label: "Largest rotation", sub: "Mean book weight" }),
  Object.freeze({ id: "insiders", label: "Insider net, 60 days", sub: "Buyers against sellers, insider-days" }),
  Object.freeze({ id: "fails", label: "Heavy fails", sub: "Failures at least 0.5% of 30-day volume" }),
]);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const DASH = "—";

const heroCell = (c) => `<div class="pos-kpi" data-id="${c.id}" title="${esc(c.sub)}"><span class="k">${esc(c.label)}</span><b class="v">${DASH}</b><span class="s">${esc(c.sub)}</span></div>`;

const module_ = (id, title, tab, body, sub) => `
    <section class="ui-card ui-mod ui-enter fd-mod pos-mod" id="${id}" aria-labelledby="${id}T" data-tab="${tab}">
      <header class="ui-mod-h"><h2 class="ui-mod-t" id="${id}T">${esc(title)}</h2><span class="ui-mod-sp"></span></header>
      <p class="pos-sub" id="${id}S">${esc(sub)}</p>
      <div class="fd-body pos-body" id="${id}B">${body}</div>
    </section>`;

const tabs = () => `
  <div class="fd-tabs" role="tablist" aria-label="Views" id="fdTabs">${POSITIONING_TABS.map(([k, t, id], i) => `<button type="button" role="tab" id="fdT-${k}" aria-controls="${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${k}">${esc(t)}</button>`).join("")}</div>`;

const sectorRows = (cols) => SECTOR_ORDER.map((s) => `<div class="pos-row" data-s="${esc(s)}"><span class="nm">${esc(s)}</span>${cols}</div>`).join("");

export function positioningBody(glyph) {
  const loading = `<p class="pos-load">${esc(STATE_SENTENCES.loading)}</p>`;
  return `
  <p class="visually-hidden" id="posStatus" role="status">${esc(STATE_SENTENCES.loading)}</p>
  <div class="pos" id="pos">
    <header class="pos-head" data-fx-hero>
      <h1 id="fxTitle">Positioning</h1>
      <span class="pos-stamp" id="posStamp">${DASH}</span>
      <span class="pos-chip" title="Quarterly, weekly and daily filings; none of this is live.">Slow data</span>
      <button type="button" class="pos-ibtn" id="posInfo" aria-label="How to read this page" aria-haspopup="dialog">${glyph("info")}</button>
    </header>
    <div class="pos-hero" id="posHero">${HERO_CELLS.map(heroCell).join("")}</div>
${tabs()}
    <div class="fd-stage" id="fdStage" data-view="rotation">
${module_("posRotCard", "Rotation by sector", "rotation", `<div class="pos-rot-head" aria-hidden="true"><span>Sector</span><span>Change in weight</span><span>Now</span><span>Before</span><span>Change</span><span>Breadth</span><span>Filers</span></div><div class="pos-rot" id="posRot">${sectorRows(`<span class="bar" aria-hidden="true"></span><span class="n now">${DASH}</span><span class="n was">${DASH}</span><span class="n chg">${DASH}</span><span class="n brd">${DASH}</span><span class="n fil">${DASH}</span>`)}</div>`, "Mean book weight of the same filers, last quarter against the one before.")}
${module_("posFilCard", "Newest 13F filings", "filings", `<div class="pos-fil" id="posFil">${loading}</div>`, "Each filer's largest changes in its latest report.")}
${module_("posInsCard", "Insiders by sector", "insiders", `<div class="pos-ins" id="posIns">${loading}</div>`, "Buyers against sellers, counted in insider-days.")}
${module_("posShCard", "Short side", "short", `<div class="pos-sh" id="posSh">${loading}</div>`, "Failures to deliver and short-sale volume, by sector and by name.")}
    </div>
  </div>
  <dialog class="pos-dlg pos-sheet" id="posDrill" aria-labelledby="posDrillT"><div class="dg"><h2 id="posDrillT">Name</h2><div class="body" id="posDrillB"></div><div class="x"><button type="button" class="link" id="posDrillX">Close</button></div></div></dialog>
  <dialog class="pos-dlg" id="posInfoDlg" aria-labelledby="posInfoT"><div class="dg"><h2 id="posInfoT">How to read this page</h2><div class="body" id="posInfoB">${INFO_SENTENCES.map((s) => `<p>${esc(s)}</p>`).join("")}</div><div class="x"><button type="button" class="link" id="posInfoX">Close</button></div></div></dialog>
`;
}
