import { ASSET_VERSION } from "./flows-pages.js";

export const MEMBER_SLUGS = Object.freeze(["overview", "long", "short", "watch", "market", "network", "now", "desk", "strategy", "ticker", "moves", "unusual", "ledger", "events", "political"]);

export const MEMBER_ROOT = 'id="fxMember"';

const SLUGS = new Set(MEMBER_SLUGS);

const FRESH = '<button type="button" class="ui-fresh" id="fxFresh"';

const HERO = '<h1 class="ft-t" id="ftHeroT" data-fx-title></h1>';

const WATCH = '<h2 class="ui-mod-t" id="bdModT">Near the edge</h2><span class="ui-mod-sp"></span>';

export const EXPORT_ANCHORS = Object.freeze({
  moves: /<button type="button" class="mv-ibtn" id="mvInfoBtn"[^>]*>[\s\S]*?<\/button>/,
  unusual: '<span class="fd-about-slot" id="uaAboutSlot"></span>',
  events: '<span class="fd-about-slot" id="evAboutSlot"></span>',
  political: /<button type="button" class="pl-ibtn" id="plInfoBtn"[^>]*>[\s\S]*?<\/button>/,
});

const v = (path) => path + "?v=" + ASSET_VERSION;

const glyph = (name) => `<svg class="ui-g" aria-hidden="true" focusable="false"><use href="#g-${name}"/></svg>`;

const BAR = `<button type="button" class="fx-search fx-mem" data-member data-member-open="since" aria-haspopup="dialog" aria-label="Since your last visit">${glyph("clock")}<span class="fx-search-l">Since your last visit</span></button>
  <button type="button" class="fx-search fx-mem" data-member data-member-open="list" aria-haspopup="dialog" aria-label="My list">${glyph("star")}<span class="fx-search-l">My list</span></button>
  `;

const STAR_SLOT = '<span class="fm-star-slot" data-member></span>';

const WATCH_ACTION = `<button type="button" class="fm-act" data-member data-member-open="list" aria-haspopup="dialog">${glyph("star")}<span>My list</span></button>`;

const EXPORT_MENU = '<details class="ui-exp" data-member data-member-export><summary class="ui-exp-b">Export</summary><div class="ui-exp-m" role="group" aria-label="Export"><span class="ui-exp-n" role="status">Loading.</span></div></details>';

const once = (html, anchor) => {
  if (typeof anchor === "string") {
    const i = html.indexOf(anchor);
    return i !== -1 && i === html.lastIndexOf(anchor);
  }
  const all = new RegExp(anchor.source, "g");
  let n = 0;
  while (all.exec(html) !== null) {
    n += 1;
    if (n > 1) return false;
  }
  return n === 1;
};

const after = (html, anchor, text) => html.replace(anchor, (match) => match + text);

const before = (html, anchor, text) => html.replace(anchor, (match) => text + match);

export function memberShell(html, { slug = "", on = false, exportOpen = false, exportsOn = false } = {}) {
  if (typeof html !== "string" || on !== true || !SLUGS.has(slug) || html.includes(MEMBER_ROOT)) return html;
  if (!once(html, FRESH) || !once(html, "</body>")) return html;
  let out = before(html, FRESH, BAR);
  if (slug === "ticker" && once(out, HERO)) out = after(out, HERO, STAR_SLOT);
  if (slug === "watch" && once(out, WATCH)) out = after(out, WATCH, WATCH_ACTION);
  const exports = exportOpen === true && Object.hasOwn(EXPORT_ANCHORS, slug) && once(out, EXPORT_ANCHORS[slug]);
  if (exports) out = after(out, EXPORT_ANCHORS[slug], EXPORT_MENU);
  const group = (name, files, css) => files.map((src, i) => `<i hidden data-defer="${name}" data-src="${src}"${css && i === files.length - 1 ? ` data-css="${css}"` : ""}></i>`).join("\n");
  const defers = [
    group("member", [...(exports && !out.includes("/assets/js/flows-export.js") ? [v("/assets/js/flows-export.js")] : []), v("/assets/js/flows-member.js")]),
    group("member-ui", [v("/assets/js/flows-member-ui.js")], v("/assets/css/flows-member.css")),
    ...(out.includes("/assets/js/storage.js") ? [] : [group("member-store", [v("/assets/js/storage.js")])]),
  ].join("\n");
  const root = `<div ${MEMBER_ROOT} hidden data-member data-page="${slug}" data-export="${exports ? "1" : "0"}" data-exports="${exportsOn === true ? "1" : "0"}"></div>\n${defers}\n<script src="${v("/assets/js/flows-member-boot.js")}" defer></script>`;
  return out.replace("</body>", () => root + "\n</body>");
}
