/* Does the card actually DRAW what the payload says?

   Every other flows test asserts numbers. This one asserts pixels, because
   this repository's chart bugs have not been arithmetic bugs — they have been
   drawing bugs that left the arithmetic intact:

     four panels fixed their viewBox at 560 units and emitted width="100%", so
     a 9px axis label rendered at 4.6 CSS px on a phone. Nothing overflowed and
     no number was wrong; the type was simply unreadable, silently;

     a magnitude rail promised in its own comment to always mark the widest bar
     and marked it on none of 109 emitted cards, because the mark landed
     exactly on the edge its own filter discarded;

     a gamma profile summed the wrong four field names, so every strike came to
     exactly zero and the panel drew 54 correctly-priced bars of nothing.

   None of those is catchable without rendering. So this loads the REAL board
   markup, the REAL stylesheet and a REAL emitted card, draws the surface at a
   320px viewport, and counts what came out.

   The surface is the panel under test because it is the newest and the densest
   — 126 cells at 7px each is where a layout gives up first. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildSurface } from "../shared/flows-card.js";
import { FLOWS_PAGES } from "../shared/flows-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* A surface with every feature the renderer has to handle: both signs, a hole
   the vendor did not return, and one cell far past the colour cap. */
function fixture() {
  const rows = [];
  const expiries = ["2026-08-28", "2026-09-04", "2026-09-18", "2026-10-16"];
  for (let i = 0; i < 25; i++) {
    const k = 90 + i;
    for (const [j, e] of expiries.entries()) {
      if (k === 97 && e === "2026-09-04") continue;          // the hole
      const lean = (k - 100) / 100;
      const g = (k === 100 && j === 0 ? 9e9 : 1e6 * (1 + j)) * (lean >= 0 ? 1 : -1);
      rows.push({
        strike: String(k), expiry: e,
        call_gamma_ask: String(g * 0.6), call_gamma_bid: String(g * 0.4),
        put_gamma_ask: "0", put_gamma_bid: "0",
      });
    }
  }
  return buildSurface(rows, { spot: 100.4, asOf: "2026-08-25" });
}

const panel = fixture();
ok(panel.status === "ok", "the fixture builds a surface");

/* Test-only: the module is an IIFE with no export. The rewrite happens in
   memory; the source on disk is never touched. */
let src = fs.readFileSync(path.join(ROOT, "assets/js/flows-card.js"), "utf8");
const close = src.lastIndexOf("})();");
assert.ok(close > 0, "flows-card.js is still an IIFE");
src = src.slice(0, close) + "  window.__renderSurface = renderSurface;\n" + src.slice(close);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  /* THE REAL MARKUP. A stub dialog would pass this test while the shipped page
     was missing the panel's own container — which is the failure the id in
     flows-pages.js and the id in flows-card.js exist to keep in step. */
  const boardHTML = FLOWS_PAGES.boardPage({ username: "test" })
    .replace(/<script[^>]*><\/script>/g, "")
    .replace("</body>", '<div id="h"></div></body>');
  await page.setContent(boardHTML);
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/base.css") });
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/flows.css") });
  await page.addScriptTag({ content: src });
  eq(errors.length, 0, "the card module loads against the real board markup without throwing");

  ok(await page.evaluate(() => !!document.getElementById("fcSurface")),
     "the board's card dialog carries the container the surface renderer targets");

  const r = await page.evaluate(({ panel }) => {
    const host = document.getElementById("h");
    window.__renderSurface(host, panel, { regime: "short_gamma" });
    const svg = host.querySelector("svg.gs");
    if (!svg) return { error: "no svg" };
    const q = (sel) => svg.querySelectorAll(sel).length;
    const label = svg.querySelector(".gs-price");
    const cellRect = svg.querySelector(".gs-cell").getBoundingClientRect();
    return {
      cells: q(".gs-cell"), voids: q(".gs-void"), hatches: q(".gs-hatch"),
      clips: q(".gs-clip"), priceLabels: q(".gs-price"), expLabels: q(".gs-exp"),
      spotRule: q(".gs-spot"), callWall: q(".gs-callwall"), putWall: q(".gs-putwall"),
      stats: host.querySelectorAll(".fc-stat").length,
      note: (host.querySelector(".fc-note") || {}).textContent || "",
      svgWidth: Math.round(svg.getBoundingClientRect().width),
      labelPx: label ? label.getBoundingClientRect().height : 0,
      cellW: cellRect.width, cellH: cellRect.height,
      pageOverflow: document.documentElement.scrollWidth > 320,
      // Opacity must vary, or magnitude is not being encoded at all.
      opacities: new Set(Array.from(svg.querySelectorAll(".gs-cell"))
        .map((n) => n.getAttribute("fill-opacity"))).size,
    };
  }, { panel });

  ok(!r.error, "the surface renders an svg");

  /* EVERY CELL IS ACCOUNTED FOR. Drawn cells plus explicit voids must equal
     the grid — a renderer that silently skips a null leaves a hole that looks
     exactly like a cell of zero gamma. */
  eq(r.cells + r.voids, panel.strikes.length * panel.expiries.length,
     "drawn cells plus voids reconcile against the grid");
  ok(r.voids >= 1, "the pair the vendor did not return is drawn as an explicit void");
  ok(r.hatches >= 1, "short-gamma cells carry the hatch that encodes sign without hue");
  eq(r.clips, panel.clipped, "every cell past the colour cap is marked, and only those");
  ok(r.opacities > 3, `magnitude is encoded in opacity, not flattened (${r.opacities} levels)`);

  eq(r.expLabels, panel.expiries.length, "every expiry column is labelled");
  ok(r.priceLabels >= 3, "the price ladder is labelled");
  eq(r.spotRule, 1, "spot is drawn");
  eq(r.callWall, 1, "the call wall is marked");
  eq(r.putWall, 1, "the put wall is marked");
  ok(r.stats >= 3, "the legend names spot and both walls");
  ok(/capped at/.test(r.note), "the note says the colour scale is capped");
  /* Singular and plural must AGREE with the count, both branches. The fixture
     clips exactly one cell, so this exercises the singular; the plural branch
     is driven below. */
  eq(panel.clipped, 1, "the fixture clips exactly one cell");
  ok(/one cell runs past it/.test(r.note) && /and is marked/.test(r.note),
     "one clipped cell is described in the singular");
  ok(!/6 of 6|4 of 4/.test(r.note), "it does not report a window that windows nothing");

  /* THE FOUR-PANEL BUG. A viewBox fixed in absolute units with width="100%"
     scales the type down with the drawing: 9px became 4.6 CSS px at this
     viewport, unreadably and silently, because nothing overflows. The panel
     must size its viewBox from its host so one unit stays one CSS pixel. */
  eq(r.svgWidth, 320, "the surface fills the viewport width");
  ok(r.labelPx >= 8, `axis type renders at its intended size, not scaled down (${r.labelPx}px)`);
  ok(r.cellH >= 6.5, `cells stay tall enough to be cells (${r.cellH}px)`);
  ok(r.cellW >= 6.5, `and wide enough (${r.cellW}px)`);
  eq(r.pageOverflow, false, "and nothing overflows a 320px viewport");

  /* THE PLURAL BRANCH, so neither half of the sentence can rot unseen. */
  const many = await page.evaluate(({ panel }) => {
    const host = document.getElementById("h");
    // Two cells far past the cap rather than one.
    const p2 = JSON.parse(JSON.stringify(panel));
    p2.clipped = 2;
    p2.grid[0][0] = p2.scaleCap * 40;
    p2.grid[1][0] = p2.scaleCap * 40;
    window.__renderSurface(host, p2, {});
    return {
      note: (host.querySelector(".fc-note") || {}).textContent || "",
      clips: host.querySelectorAll(".gs-clip").length,
    };
  }, { panel });
  ok(/2 cells run past it/.test(many.note) && /and are marked/.test(many.note),
     "two clipped cells are described in the plural");
  ok(many.clips >= 2, "and both are actually marked on the grid");

  /* A CARD FROM BEFORE THIS PANEL EXISTED must degrade, not throw. Published
     cards outlive the code that reads them. */
  const legacy = await page.evaluate(() => {
    const host = document.getElementById("h");
    try {
      window.__renderSurface(host, undefined, {});
      return { threw: false, dead: !!host.querySelector(".fc-dead"), svg: !!host.querySelector("svg") };
    } catch (e) { return { threw: true, error: String(e) }; }
  });
  eq(legacy.threw, false, "a card with no surface panel does not throw");
  eq(legacy.dead, true, "it reports the panel unavailable");
  eq(legacy.svg, false, "and draws no chart at all rather than an empty grid");

  console.log(`✓ flows-card-render: ${checks} assertions — cells reconcile against the grid, ` +
    `sign survives without hue, the colour cap is marked, axis type is not silently shrunk, ` +
    `and a pre-surface card degrades`);
} finally {
  await browser.close();
}
