import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ORIGIN = "https://chart.test";
export const VERSION = fs.readFileSync(path.join(ROOT, "assets/version.txt"), "utf8").trim();
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

export const TOKENS = `:root{color-scheme:dark;--label-1:#f2f2f7;--label-2:#c7c7cc;--label-3:#8e8e93;--label-4:#636366;--accent:#0a84ff;--s-blue:#0a84ff;--s-gray:#98989d;--s-orange:#ff9f0a;--up:#30d158;--down:#ff453a;--up-mark:#34c759;--down-mark:#ff6961;--g-long:#2ac3a2;--g-short:#e0813b;--fill-2:#3a3a3c;--fill-4:#2c2c2e;--sep:#38383a;--sep-strong:#545458;--ground-base:#000;--mat-opaque:#1c1c1e;--lvl-flip:#bf5af2;--lvl-call:#30d158;--lvl-put:#ff453a;--lvl-pain:#ffd60a}`;

export function pageHtml({ full = false, extra = "", width = 640 } = {}) {
  const css = full
    ? `<link rel="stylesheet" href="/assets/css/base.css?v=${VERSION}"><link rel="stylesheet" href="/assets/css/flows.css?v=${VERSION}">`
    : `<style>${TOKENS}
.ui-chart{position:relative;width:100%;min-width:0}.ui-chart>svg{display:block;width:100%;height:auto;overflow:visible}
.ui-chart>.ui-chart-w{position:absolute;inset:0 0 auto;height:0;visibility:hidden}.ui-readout{position:absolute;white-space:nowrap}
.visually-hidden{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}</style>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chart</title>${css}
<style>body{margin:0;padding:8px;background:#000}#stage{width:${width}px}.host{width:100%;margin:0 0 12px}</style></head>
<body class="flows-body"><div id="stage"></div>
<script src="/assets/js/flows-ui.js?v=${VERSION}"></script>
<script src="/assets/js/flows-chart.js?v=${VERSION}"></script>
${extra}
</body></html>`;
}

export async function serve(page, html) {
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/chart") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
}
