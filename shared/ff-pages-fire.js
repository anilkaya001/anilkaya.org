import {
  AST_VERSION, CADENCES, FF_CONTRACT_VERSION, LIMITS, METRICS, OPS, REGISTRY_VERSION, SYMBOL_RE, TEMPLATES, UNITS, ABSENT_MARK,
} from "./ff-contract.js";

export const FIRE_PAGE = "fire";
export const FIRE_PATH = "/flows/fire/";
export const FIRE_DESCRIPTION = "Arm a standing condition on the nightly run or the live loop, see which names hold it right now, and read the hits in the Inbox.";
export const FIRE_STYLES = Object.freeze(["/assets/css/flows-ff-tokens.css", "/assets/css/flows-ff-fire.css"]);
export const FIRE_SCRIPTS = Object.freeze([
  "/assets/js/flows-ff-kernel.js", "/assets/js/flows-ff-client.js",
  "/assets/js/flows-ff-composer.js", "/assets/js/flows-ff-preview.js", "/assets/js/flows-ff-fire.js",
]);
export const FIRE_DATA_ID = "ffxData";

const USABLE = Object.freeze(["ready", "limited"]);
const RANK = Object.freeze({ ready: 0, limited: 1, warming: 2, hidden: 3 });
const DOMAINS = Object.freeze([
  ["flow", "Flow"], ["vol", "Volatility"], ["earn", "Earnings"], ["contract", "Flagged window"], ["sector", "Sector"],
]);

const metricMap = new Map(METRICS.map((m) => [m.id, m]));

const worst = (ids) => ids.reduce((w, id) => {
  const m = metricMap.get(id);
  const s = m ? m.status : "hidden";
  return RANK[s] > RANK[w] ? s : w;
}, "ready");

const blankAst = () => ({
  v: AST_VERSION, cadence: "live", scope: { kind: "names", symbols: [] },
  all: [{ m: "contract.premium", op: ">=", x: 0 }],
  persist: 1, cooldown: { unit: LIMITS.cooldownUnit, n: LIMITS.cooldownDefault.live },
});

export const BLANK = Object.freeze({
  key: "blank", id: "blank", title: "Any flagged window on these names", cadence: "live", status: "ready", note: "Flows flags a window on these names.",
  house: [], ast: blankAst(),
});

export function templateRows() {
  const rows = [];
  for (const t of TEMPLATES) {
    if (t.ast === null) continue;
    if (Array.isArray(t.variants)) {
      t.variants.forEach((v, i) => {
        const ast = { ...t.ast, all: v.clauses.map((c) => ({ ...c })) };
        const status = worst(ast.all.map((c) => c.m));
        rows.push({ key: t.id + String.fromCharCode(97 + i), id: t.id, title: v.sentence, cadence: t.cadence, status, note: t.note, house: [v.id], ast });
      });
    } else {
      const status = worst(t.ast.all.map((c) => c.m));
      rows.push({ key: t.id, id: t.id, title: t.title, cadence: t.cadence, status, note: t.note, house: t.house.slice(), ast: t.ast });
    }
  }
  return rows.filter((r) => USABLE.includes(r.status));
}

export function metricRows() {
  return METRICS.filter((m) => USABLE.includes(m.status)).map((m) => ({
    id: m.id, label: m.label, unit: m.unit, kind: m.kind, edge: m.edge, subject: m.subject, cadence: m.cadence.slice(), range: m.range.slice(),
    status: m.status, reason: m.reason, liveKey: m.source && m.source.live ? m.source.live.key : null, domain: m.id.split(".")[0],
  }));
}

export function fireRegistry() {
  const units = {};
  for (const [id, u] of Object.entries(UNITS)) units[id] = { step: u.step, xStep: u.xStep };
  return {
    v: FF_CONTRACT_VERSION,
    registryVersion: REGISTRY_VERSION,
    astVersion: AST_VERSION,
    absent: ABSENT_MARK,
    ops: OPS.slice(),
    cadences: CADENCES.slice(),
    symbolRe: SYMBOL_RE,
    domains: DOMAINS.map(([id, label]) => ({ id, label })),
    units,
    limits: {
      clausesMin: LIMITS.clausesMin, clausesMax: LIMITS.clausesMax, clausesPerMetric: LIMITS.clausesPerMetric, symbolsMax: LIMITS.symbolsMax,
      persistNightly: LIMITS.persistNightly.slice(), persistLive: LIMITS.persistLive.slice(),
      cooldownChoices: { live: LIMITS.cooldownChoices.live.slice(), nightly: LIMITS.cooldownChoices.nightly.slice() },
      cooldownDefault: { ...LIMITS.cooldownDefault }, cooldownUnit: LIMITS.cooldownUnit, sentenceChars: LIMITS.sentenceChars, titleChars: LIMITS.titleChars,
      armedMemberWires: LIMITS.armedMemberWires, universeMemberWires: LIMITS.universeMemberWires, liveMemberWires: LIMITS.liveMemberWires,
      budgetChoices: LIMITS.budgetChoices.slice(),
    },
    metrics: metricRows(),
    templates: [BLANK, ...templateRows()].map((t) => ({ ...t, ast: JSON.parse(JSON.stringify(t.ast)) })),
  };
}

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const dataBlock = (registry = fireRegistry()) =>
  `<script type="application/json" id="${FIRE_DATA_ID}">${JSON.stringify(registry).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")}</script>`;

const templateRow = (t) => `
        <li class="ffx-tli"><button type="button" class="ffx-trow" data-template="${esc(t.key)}" aria-pressed="false">
          <span class="ffx-trow-t" title="${esc(t.title)}">${esc(t.title)}</span>
          <span class="ffx-trow-m"><span class="ffx-chip" data-cadence="${esc(t.cadence)}">${t.cadence === "live" ? "Live" : "Nightly"}</span>${t.status === "limited" ? '<span class="ffx-chip ffx-chip-lim" title="Sees part of the universe only">Limited</span>' : ""}<span class="ffx-trow-r" data-rate="${esc(t.key)}" data-ff-absent="reading">${ABSENT_MARK} reading</span></span>
        </button></li>`;

export function fireBody(glyph, registry = fireRegistry()) {
  const g = typeof glyph === "function" ? glyph : () => "";
  return `
  ${dataBlock(registry)}
  <div class="ffx ffx-fire" id="ffxFire" data-ff-page="fire" data-view="start">
    <header class="ffx-title" data-fx-hero>
      <h1 id="fxTitle">Fire</h1>
      <p class="ffx-cap" id="ffxCap">${ABSENT_MARK} reading your wires</p>
      <button type="button" class="ffx-ibtn" id="ffxInfoBtn" aria-haspopup="dialog" aria-label="How a wire works">${g("info")}</button>
    </header>
    <p class="ffx-banner" id="ffxBanner" hidden></p>
    <div class="ffx-tabs" role="tablist" aria-label="Fire panels" id="ffxTabs">
      <button type="button" role="tab" id="ffxTabStart" aria-selected="true" aria-controls="ffxTpl" data-v="start">Start</button><button type="button" role="tab" id="ffxTabWire" aria-selected="false" aria-controls="ffxComp" data-v="wire">Wire</button><button type="button" role="tab" id="ffxTabNow" aria-selected="false" aria-controls="ffxPrev" data-v="now">Right now</button>
    </div>
    <div class="ffx-stage" id="ffxStage">
      <section class="ffx-panel ffx-tpl" id="ffxTpl" role="tabpanel" aria-labelledby="ffxTplT">
        <header class="ffx-ph"><h2 id="ffxTplT">Start from</h2></header>
        <ul class="ffx-tpls" id="ffxTpls">${registry.templates.map(templateRow).join("")}
        </ul>
        <p class="ffx-foot">A template that needs data Flows does not hold yet is not listed.</p>
      </section>
      <section class="ffx-panel ffx-comp" id="ffxComp" role="tabpanel" aria-labelledby="ffxCompT">
        <header class="ffx-ph"><h2 id="ffxCompT">Wire</h2><span class="ffx-ph-n" id="ffxCompN"></span></header>
        <div class="ffx-comp-host" id="ffxComposer"><p class="ffx-wait">Loading the wire builder.</p></div>
      </section>
      <section class="ffx-panel ffx-prev" id="ffxPrev" role="tabpanel" aria-labelledby="ffxPrevT">
        <header class="ffx-ph"><h2 id="ffxPrevT">Right now</h2></header>
        <div class="ffx-prev-host" id="ffxPreview"><p class="ffx-wait">Waiting for a wire to read.</p></div>
      </section>
    </div>
  </div>
  <p class="visually-hidden" id="ffxLive" role="status" aria-live="polite"></p>
  <dialog class="ffx-dlg" id="ffxInfo" aria-labelledby="ffxInfoT">
    <div class="ffx-dg"><h2 id="ffxInfoT">How a wire works</h2>
      <p>A wire is a standing condition. Flows reads it on every run, and a hit is written once when every condition first holds.</p>
      <p>After a hit the wire stays quiet for the period you pick, then re-arms once the condition has cleared.</p>
      <p>A figure Flows cannot read is a dash with its reason. It is never read as zero.</p>
      <p>A wire is judged on its condition and its record of firings. No price outcome is scored.</p>
      <p>Delivery is the in-app Inbox and the Digest. Times are in TRT.</p>
      <div class="ffx-dx"><button type="button" class="ffx-link" data-close>Close</button></div>
    </div>
  </dialog>`;
}
