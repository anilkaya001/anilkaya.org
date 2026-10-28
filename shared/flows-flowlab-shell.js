import { ASSET_VERSION } from "./flows-pages.js";
import { copyScript } from "./flows-page-flowlab.js";

export const ENTRY_PAGES = Object.freeze(["unusual", "ticker", "moves"]);

const v = (path) => `${path}?v=${ASSET_VERSION}`;

const NAV_GLYPH = '<svg class="ui-g" aria-hidden="true" focusable="false"><use href="#g-flask"/></svg>';

const NAV_ITEM = `<a href="/flows/flowlab/" data-flowlab-nav>${NAV_GLYPH}<span class="rail-label">Flow Lab</span></a>`;

export function flowlabShell(html, slug, on) {
  if (typeof html !== "string" || on !== true) return html;
  let out = html;
  if (slug !== "flowlab" && !out.includes("data-flowlab-nav") && out.includes('<a href="/flows/ledger/"')) {
    out = out.replace('<a href="/flows/ledger/"', () => NAV_ITEM + '<a href="/flows/ledger/"');
  }
  if (!ENTRY_PAGES.includes(slug)) return out;
  const root = `<div id="fxFlowlab" hidden data-page="${slug}"></div>
${copyScript(true)}
<i hidden data-defer="drill" data-src="${v("/assets/js/flows-drill.js")}" data-css="${v("/assets/css/flows-flowlab.css")}"></i>`;
  return out.replace("</body>", () => root + "\n</body>");
}
