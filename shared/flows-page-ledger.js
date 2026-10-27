import {
  INFO, NOT_BUILT, TITLE, BALANCING_DEFINITION, KEY_LINE, ZERO_LINE, PENDING_LINE, GROUPS, COLUMN_COPY, ROW_COPY, GROUP_ROWS, NET_ROW, CHECKS, SECTOR_HEADERS, SECTOR_SHORT, SECTOR_ORDER, HERO, STRIP,
} from "./flows-sfc-copy.js";

export const LEDGER_DESCRIPTION = "A closed ledger of option premium in held windows: who paid, who received, and where each sector sits against its market-cap share.";

export const LEDGER_STYLES = Object.freeze(["/assets/css/flows-sfc.css"]);

export const LEDGER_SCRIPTS = Object.freeze(["/assets/js/flows-fresh.js", "/assets/js/flows-sfc.js"]);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const para = (list) => list.map((s) => `<p>${esc(s)}</p>`).join("");

const DASH = "—";

const GROUP_OF = Object.freeze(["held", "held", "held", "held", "noside", "noside", "noside", "noside", "outside", "outside"]);

const CELLS_OF = (i) => (i < 4 ? [0, 1] : i < 8 ? [2, 3] : i < 10 ? [4, 5] : [0, 1, 2, 3, 4, 5]);

function matrixSkeleton() {
  const col = (c) => COLUMN_COPY[c];
  const head = `<tr class="gr"><td></td>${GROUPS.map((g) => `<th scope="colgroup" colspan="2" class="g-${g.id}" title="${esc(g.hover)}">${esc(g.label)}</th>`).join("")}</tr>` +
    `<tr><td class="corner"></td>${COLUMN_COPY.map((c, k) => `<th scope="col" class="off" data-cg="${GROUPS[k >> 1].id}" title="${esc(c.hover)}"><b>${esc(c.label)}</b><i>${esc(c.sub)}</i></th>`).join("")}</tr>`;
  const rows = [];
  const flat = [...ROW_COPY.slice(0, 10).map((r, i) => ({ r, i, kind: "" })), { r: { ...NET_ROW, short: NET_ROW.label }, i: 10, kind: "net" }, { r: ROW_COPY[10], i: 11, kind: "bal" }];
  let armed = false;
  let group = null;
  for (const { r, i, kind } of flat) {
    if (r.group && r.group !== group) rows.push(`<tr class="sub" aria-hidden="true" data-gr="noside"><td title="${esc(GROUP_ROWS[r.group].hover)}">${esc(GROUP_ROWS[r.group].label)}</td>${COLUMN_COPY.map((c, k) => `<td data-cg="${GROUPS[k >> 1].id}"></td>`).join("")}</tr>`);
    group = r.group || null;
    const shown = CELLS_OF(i > 9 ? 10 : i);
    const cells = COLUMN_COPY.map((c, k) => {
      if (!shown.includes(k)) return `<td class="c b" aria-hidden="true" data-cg="${GROUPS[k >> 1].id}"></td>`;
      const tab = armed ? "-1" : "0";
      armed = true;
      return `<td class="c" data-s="pending" data-cg="${GROUPS[k >> 1].id}" data-x="${esc(PENDING_LINE)}" tabindex="${tab}" aria-label="${esc(r.label + ", " + col(k).label + " " + col(k).sub + ": waiting")}">${DASH}</td>`;
    }).join("");
    rows.push(`<tr class="${[kind, r.group ? "in" : ""].filter(Boolean).join(" ")}" data-i="${i}" data-gr="${i < 10 ? GROUP_OF[i] : "all"}"><th scope="row" title="${esc(r.hover)}">${esc(r.group ? r.short : r.label)}</th>${cells}</tr>`);
  }
  return `<table class="sf-t sf-lt" role="grid" aria-readonly="true" aria-busy="true" data-g="all"><caption class="visually-hidden">Premium ledger. A minus is premium paid and a plus is premium received.</caption><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
}

function sectorsSkeleton() {
  const head = SECTOR_HEADERS.map((h, i) => `<th scope="col" class="h-${h.id}${i ? " r" : ""}" title="${esc(h.hover)}">${esc(h.label)}${h.id === "tilt" ? "<small>&nbsp;</small>" : ""}</th>`).join("");
  const ids = ["taker", "calls", "puts", "noside", "outside"];
  const rows = SECTOR_ORDER.map((k) => `<tr data-k="${esc(k)}" data-pend="1"><th scope="row"><span class="sf-nm">${esc(SECTOR_SHORT[k] || k)}</span></th>${ids.map((id) => `<td class="n c-${id} a" data-s="absent">${DASH}</td>`).join("")}<td class="tl a">${DASH}</td><td class="n c-coverage a">${DASH}</td></tr>`).join("");
  const foot = `<tr class="tot"><th scope="row">Total</th>${ids.map((id) => `<td class="n c-${id} a">${DASH}</td>`).join("")}<td class="n c-tilt a">${DASH}</td><td class="n c-coverage"></td></tr>`;
  return `<table class="sf-t sf-st" data-skel="1" aria-busy="true"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table>`;
}

function checksSkeleton() {
  return ["rows", "columns", "sides", "sectors", "tilt", "session", "stock"].map((id) => `<button type="button" class="sf-chk" data-id="${id}" data-state="pending" title="${esc(CHECKS[id].hover)}"><i aria-hidden="true">○</i>${esc(CHECKS[id].label)}<span class="visually-hidden"> not read yet</span></button>`).join("");
}

function heroSkeleton() {
  const fig = (id, label) => `<li class="hr-f" data-id="${id}"><span class="hr-fk">${esc(label)}</span><span class="hr-fv">${DASH}</span></li>`;
  const cell = (id, label) => `<div class="hc" data-id="${id}"><span class="hc-k">${esc(label)}</span><span class="hc-v"><b>${DASH}</b><i aria-hidden="true"></i></span><span class="hc-r">&nbsp;</span><span class="hc-s">&nbsp;</span></div>`;
  return `<section class="sf-hero ui-card" id="sfHero" aria-label="Balance of held premium">
      <div class="hr-lean" id="sfLean">
        <h2 class="hr-k">${esc(HERO.lean.head)}<span class="kx">${esc(HERO.lean.tail)}</span></h2>
        <span class="hr-v" id="sfLeanV">${DASH}</span>
        <span class="hr-vd" id="sfLeanVerdict" aria-hidden="true">${esc(HERO.lean.pending)}</span>
        <p class="visually-hidden" id="sfLeanSay">${esc(HERO.lean.pending)}</p>
        <svg class="hr-bar" id="sfLeanBar" width="100%" height="24" role="img" aria-label="${esc(HERO.lean.pending)}"><rect class="bx a" x="0" y="8" width="0" height="12"/><rect class="bx u" x="0" y="8" width="0" height="12"/><rect class="bx b" x="0" y="8" width="0" height="12"/><line class="bk br" x1="0" x2="0" y1="2" y2="2"/><line class="bk bl" x1="0" x2="0" y1="2" y2="7"/><line class="bk bh" x1="0" x2="0" y1="2" y2="7"/><line class="bk mid" x1="50%" x2="50%" y1="4" y2="23"/><rect class="bx tk" x="0" y="8" width="2" height="12"/></svg>
        <ul class="hr-lg" id="sfLeanFig">${fig("ask", HERO.lean.ask)}${fig("unknown", HERO.lean.unknown)}${fig("bid", HERO.lean.bid)}</ul>
        <p class="hr-ln" id="sfLeanLine">&nbsp;</p>
      </div>
      <div class="hr-cells" id="sfCells">${cell("held", HERO.cells.held.label)}${cell("calls", HERO.cells.calls.label)}${cell("puts", HERO.cells.puts.label)}</div>
    </section>`;
}

function stripSkeleton() {
  const chip = (c, word) => `<div class="ds-st sf-sc" data-s="pending" data-k="${c.id}"><i aria-hidden="true"></i><b>${esc(c.name)}</b><span class="sc-t">${esc(word)}</span></div>`;
  return `<footer class="sf-strip" id="sfStrip" role="group" aria-label="${esc(STRIP.label)}">${chip(STRIP.windows, STRIP.windows.pending)}${chip(STRIP.held, STRIP.held.pending)}${chip(STRIP.tide, STRIP.tide.pending)}${chip(STRIP.poll, STRIP.poll.pending)}</footer>`;
}

export function ledgerBody(glyph, deferred = "") {
  return `
  <p class="visually-hidden" id="sfStatus" role="status">Loading the ledger…</p>
  <div class="sf" id="sf" data-state="loading" data-view="balance">
    <svg class="sf-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs><pattern id="sfHatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hx-bg" width="4" height="4"/><rect class="hx-ink" width="1.5" height="4"/></pattern></defs></svg>
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
    ${heroSkeleton()}
    <div class="sf-checkrow">
      <div class="sf-checks" id="sfChecks" role="group" aria-label="Checks">${checksSkeleton()}</div>
      <p class="sf-checkline" id="sfCheckLine"></p>
    </div>
    <p class="sf-note" id="sfNote" hidden></p>
    <div class="sf-tabs" role="tablist" aria-label="Panels" id="sfTabs">
      <button type="button" role="tab" aria-selected="true" aria-controls="sfHero sfRead" data-v="balance">Balance</button><button type="button" role="tab" aria-selected="false" aria-controls="sfLedger" data-v="ledger">Ledger</button><button type="button" role="tab" aria-selected="false" aria-controls="sfSide" data-v="side">Sectors</button>
    </div>
    <div class="sf-stage" id="sfStage">
      <section class="sf-panel sf-ledger ui-card" id="sfLedger" aria-label="Ledger">
        <div class="sf-ph"><h2>Ledger</h2><span class="sf-cap" id="sfCap"></span><div class="sf-seg r sf-groups" role="group" aria-label="Columns" id="sfGroups">${GROUPS.map((g, i) => `<button type="button" data-g="${g.id}" aria-pressed="${i === 0}" title="${esc(g.label)}">${esc(g.short)}</button>`).join("")}</div></div>
        <p class="sf-key" id="sfKey">${esc(KEY_LINE)}</p>
        <div class="sf-mat" id="sfMatrix">${matrixSkeleton()}</div>
        <p class="sf-cell" id="sfCellLine" data-zero="${esc(ZERO_LINE)}">${esc(PENDING_LINE)}</p>
      </section>
      <section class="sf-panel sf-side ui-card" id="sfSide" aria-label="Sectors">
        <div class="sf-ph"><h2 id="sfSideT">Sectors</h2><span class="sf-cap" id="sfSideCap"></span>
          <div class="sf-seg r" role="group" aria-label="View" id="sfView"><button type="button" data-w="table" aria-pressed="true" id="sfViewT">Sectors</button><button type="button" data-w="flow" aria-pressed="false">Flow</button></div>
        </div>
        <div class="sf-body" id="sfBody" data-kind="all">${sectorsSkeleton()}</div>
        <div class="sf-fr"><p class="sf-foot" id="sfFoot"></p><button type="button" class="link sf-all" id="sfAll" aria-haspopup="dialog" hidden></button></div>
      </section>
      <section class="sf-panel sf-read ui-card" id="sfRead" aria-label="Reading">
        <div class="sf-ph"><h2>Reading</h2></div>
        <div class="sf-readbox" id="sfReadBox"></div>
      </section>
    </div>
    ${stripSkeleton()}
  </div>
  ${deferred}
  <dialog class="sf-dlg" id="sfInfoDlg" aria-labelledby="sfInfoT"><div class="dg"><h2 id="sfInfoT">How to read this page</h2>
    <div class="body">${para(INFO)}<p>${esc(BALANCING_DEFINITION)}</p><h3>Not built</h3>${para(NOT_BUILT)}</div>
    <div class="x"><button type="button" class="link" id="sfInfoX">Close</button></div></div></dialog>
  <dialog class="sf-dlg" id="sfAllDlg" aria-labelledby="sfAllT"><div class="dg"><h2 id="sfAllT"></h2>
    <div class="body sf-allbody" id="sfAllBody"></div>
    <div class="x"><button type="button" class="link" id="sfAllX">Close</button></div></div></dialog>
`;
}
