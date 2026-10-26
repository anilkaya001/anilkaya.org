import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { openGlass, settle, VIEWPORTS } from "./lib/glass-world.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-boards.css"), "utf8");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TARGET = 24;
const FIXED = ".bd-hs::after { content: \"\"; position: absolute; inset: -6px min(-4px, calc((100% - 24px) / 2)); }";

const probe = (page) => page.evaluate(() => {
  const out = [];
  for (const b of document.querySelectorAll(".bd-hrow .bd-hs:not(:disabled)")) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hits = (x, y) => { const e = document.elementFromPoint(x, y); return Boolean(e) && (e === b || b.contains(e)); };
    let lo = 0, hi = 0, up = 0, dn = 0;
    while (lo < 80 && hits(cx - lo - 1, cy)) lo++;
    while (hi < 80 && hits(cx + hi + 1, cy)) hi++;
    while (up < 80 && hits(cx, cy - up - 1)) up++;
    while (dn < 80 && hits(cx, cy + dn + 1)) dn++;
    out.push({ col: b.parentElement.dataset.col, text: b.textContent.trim(), own: [Math.round(r.width), Math.round(r.height)], w: lo + hi + 1, h: up + dn + 1, centre: hits(cx, cy) });
  }
  return out;
});

const measure = async (browser, viewport, patch) => {
  const { context, page, errors } = await openGlass(browser, { kind: "long", viewport, patch });
  try {
    await settle(page);
    await page.waitForSelector(".bd-hrow .bd-hs", { state: "attached", timeout: 15000 });
    return { rows: await probe(page), errors };
  } finally {
    await context.close();
  }
};

const failures = (rows) => rows.filter((r) => !r.centre || r.w < TARGET || r.h < TARGET);

ok(CSS.includes(FIXED), "the header sort button's hit area is the wider of four pixels a side and enough to make 24 pixels");

const browser = await launch();
const seen = new Set();
const DESKTOP = VIEWPORTS.filter((v) => v.width >= 900);
for (const viewport of DESKTOP) {
  const tag = viewport.width + "x" + viewport.height;
  const { rows, errors } = await measure(browser, viewport, null);
  ok(errors.length === 0, tag + ": no page error " + errors.join(" | "));
  ok(rows.length >= 8, tag + ": at least eight sortable headers are in view to measure (" + rows.length + ")");
  for (const r of rows) {
    seen.add(r.col);
    ok(r.centre, tag + ": " + r.col + " answers a click at its own centre");
    ok(r.w >= TARGET && r.h >= TARGET, tag + ": the header " + r.col + " (" + r.text + ") has a real hit area of " + r.w + " by " + r.h + " px, at least " + TARGET + " each way (own box " + r.own.join(" by ") + ")");
  }
  ok(rows.some((r) => r.own[0] < 16), tag + ": the suite includes a header whose own box is narrower than 16 px, the case the extension is for");
}
ok(["r", "g", "siP"].every((c) => seen.has(c)), "the three narrowest columns, the rank, the gamma mark and short interest, were measured");

const MUTANTS = [
  ["the extension back to four pixels a side", FIXED, ".bd-hs::after { content: \"\"; position: absolute; inset: -6px -4px; }"],
  ["no extension", FIXED, ".bd-hs::after { content: \"\"; position: absolute; inset: 0; }"],
  ["an extension that lets clicks through", FIXED, FIXED.replace("; }", "; pointer-events: none; }")],
  ["the larger of the two instead of the smaller", FIXED, FIXED.replace("min(", "max(")],
  ["a target of six pixels", FIXED, FIXED.replace("24px", "6px")],
];
for (const [name, from, to] of MUTANTS) {
  ok(CSS.includes(from), "the planted build's anchor is in the sheet: " + name);
  const { rows } = await measure(browser, DESKTOP[1], { "/assets/css/flows-boards.css": [[from, to]] });
  ok(failures(rows).length > 0, "PLANTED WRONG BUILD CAUGHT: " + name + " (" + failures(rows).map((r) => r.col + " " + r.w + "x" + r.h).join(", ") + ")");
}
await browser.close();
console.log("✓ flows-board-hit-render: " + checks + " assertions — the long board's sortable column headers in Chromium against the dry-run emit, no server: every header that is in view answers a click at its centre and, by elementFromPoint in all four directions, has a real hit area of at least 24 by 24 px at 1920 and 1440 wide, the rank, gamma and short-interest headers (7, 7 and 11 px of text) included, and five planted sheets (the old four pixels a side, no extension, an extension that lets clicks through, max for min, a six pixel target) each fail it.");
