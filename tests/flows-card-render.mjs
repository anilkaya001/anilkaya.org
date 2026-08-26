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
     exactly zero and the panel drew 54 correctly-priced bars of nothing;

     a surface encoded magnitude in opacity and mapped every ordinary cell to
     between 0.130 and 0.159 of it, and THIS FILE asserted that magnitude was
     "encoded in opacity, not flattened" and passed — because it counted
     distinct values instead of measuring their spread, against a fixture
     whose cells all sat inside a 4x band. An assertion that cannot fail and a
     fixture on which the naive answer is the right one are the same bug.

   None of those is catchable without rendering. So this loads the REAL board
   markup, the REAL stylesheet and a REAL emitted card, draws the surface at a
   320px viewport, and counts what came out.

   The surface is the panel under test because it is the newest and the densest
   — 126 cells at 7px each is where a layout gives up first. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildSurface, buildPath, buildGammaProfile } from "../shared/flows-card.js";
import { FLOWS_PAGES } from "../shared/flows-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* THE SUITE EMITS ITS OWN CARDS rather than depending on a directory some
   earlier npm script may or may not have filled. A test whose fixture is a
   side effect of another test passes locally and finds nothing in CI. */
const SCRATCH = await mkdtemp(path.join(os.tmpdir(), "flows-render-"));
execFileSync(process.execPath, [
  path.join(ROOT, "scripts/flows-pipeline.mjs"),
  "--dry-run", "--emit", path.join(SCRATCH, "dry.json"),
], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* A surface with every feature the renderer has to handle: both signs, a hole
   the vendor did not return, a pair it measured at exactly zero, and one cell
   far past the colour cap.

   THE MAGNITUDE FIELD IS HEAVY-TAILED, and that is the point of it. The
   fixture this replaces put every ordinary cell in a 4x band — 1e6, 2e6, 3e6,
   4e6 — which is not what a strike ladder looks like and, worse, is a shape
   under which a magnitude encoding cannot be wrong in any way a test can see.
   The renderer mapped all four of those to fill-opacities between 0.130 and
   0.159 and the suite's own "magnitude is encoded in opacity" assertion
   passed, because it counted distinct values rather than measuring their
   spread. Real per-cell gamma decays like a gaussian out of the money and
   again with time, so it spans two or three decades inside one grid; that is
   the shape that separates a scale which earns its range from one that spends
   it all on the top decade. */
function fixture() {
  const rows = [];
  const expiries = ["2026-08-28", "2026-09-04", "2026-09-18", "2026-10-16"];
  for (let i = 0; i < 25; i++) {
    const k = 90 + i;
    for (const [j, e] of expiries.entries()) {
      if (k === 97 && e === "2026-09-04") continue;          // the hole: never returned
      let g = 3e6 * Math.exp(-Math.pow((k - 100) / 4.5, 2)) / (1 + j * 0.8) * (k >= 100 ? 1 : -1);
      if (k === 103 && j === 0) g = 9e9;                     // the one cell past the cap
      if (k === 98 && e === "2026-09-18") g = 0;             // measured, and measured at nothing
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
src = src.slice(0, close) +
  "  window.__renderSurface = renderSurface;\n" +
  "  window.__renderPath = renderPath;\n" +
  "  window.__renderGamma = renderGamma;\n" +
  "  window.__renderScore = renderScore;\n" +
  "  window.__paint = paint;\n" + src.slice(close);

const browser = await chromium.launch();
try {
  /* TWO VIEWPORTS. Every measurement here was written after a narrow-screen
     bug, so 320 is the one that matters most — but the panels size their
     viewBox from the host, which means a WIDE host is a different code path
     and an untested one. A chart that clips at 320 and a chart that draws a
     166px caption into a 900px canvas fail in opposite directions. */
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  /* THE REAL MARKUP. A stub dialog would pass this test while the shipped page
     was missing the panel's own container — which is the failure the id in
     flows-pages.js and the id in flows-card.js exist to keep in step. */
  const boardHTML = FLOWS_PAGES.sidePage({ username: "test", side: "long" })
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
      opacities: new Set(Array.from(svg.querySelectorAll(".gs-cell:not(.is-zero)"))
        .map((n) => n.getAttribute("fill-opacity"))).size,
      /* Shaded cells IN GRID ORDER. The renderer appends row-major and skips
         nothing, so this list pairs one-to-one with the grid's non-null,
         non-zero values and the magnitude behind each shade can be recovered
         in the test rather than guessed at. */
      shades: Array.from(svg.querySelectorAll(".gs-cell:not(.is-zero)"))
        .map((n) => Number(n.getAttribute("fill-opacity"))),
      zeroCells: q(".gs-cell.is-zero"),
      zeroMarks: q(".gs-zeromark"),
      zeroSigned: q(".gs-cell.is-zero.is-pos, .gs-cell.is-zero.is-neg"),
      keySwatches: Array.from(svg.querySelectorAll(".gs-key-sw.is-pos"))
        .map((n) => Number(n.getAttribute("fill-opacity"))),
      keyLabels: Array.from(svg.querySelectorAll(".gs-key")).map((n) => n.textContent),
      /* The key's sign swatch has to be the TEXTURE, drawn: a legend that
         names a colour is a legend a greyscale reader cannot use. */
      keyHatched: Array.from(svg.querySelectorAll(".gs-key-sw.is-neg")).filter((sw) => {
        const b = sw.getBoundingClientRect();
        return Array.from(svg.querySelectorAll(".gs-hatch")).some((h) => {
          const r = h.getBoundingClientRect();
          return Math.abs(r.left - b.left) < 1 && Math.abs(r.top - b.top) < 1;
        });
      }).length,
      aria: svg.getAttribute("aria-label") || "",
      priceTexts: Array.from(svg.querySelectorAll(".gs-price")).map((n) => n.textContent),
      /* Every clip mark's own extent, so a mark on one cell can be shown to
         stay on that cell. */
      clipBoxes: Array.from(svg.querySelectorAll(".gs-clip")).map((n) => [
        Math.abs(Number(n.getAttribute("x2")) - Number(n.getAttribute("x1"))),
        Math.abs(Number(n.getAttribute("y2")) - Number(n.getAttribute("y1"))),
      ]),
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

  /* THE THIRD STATE. `is-pos` was assigned by `v < 0`, so a pair the vendor
     measured at exactly zero was drawn as the palest LONG cell on the grid:
     a sign the book does not have, at the one magnitude where sign has no
     meaning, and at a shade that read as the smallest real cell rather than
     as none. Not measured, measured at nothing, and measured at something are
     three facts and the panel now draws three things. */
  eq(r.zeroCells, 1, "the pair the vendor measured at exactly zero is drawn as its own kind of cell");
  eq(r.zeroSigned, 0, "and carries NO sign class — zero is neither long nor short gamma");
  ok(r.zeroMarks >= 1, "with a mark of its own, so it cannot be mistaken for a void");

  /* THE SCALE HAS TO EARN ITS RANGE.

     Counting distinct fill-opacities cannot see the defect this panel had:
     the shipped linear map put every ordinary cell of this grid between 0.130
     and 0.159 — five "levels" spanning three hundredths of an opacity, all of
     them indistinguishable from each other and nearly indistinguishable from
     the 0.35 void. So measure the SPREAD, and measure it over the bulk rather
     than over the outlier that a capped scale exists to contain: between the
     first and ninth deciles of the drawn magnitudes, the shading must move
     across most of the range it has. */
  {
    const mags = [];
    for (const row of panel.grid) for (const v of row) if (v !== null && v !== 0) mags.push(Math.abs(v));
    eq(r.shades.length, mags.length, "every shaded cell pairs with a magnitude on the grid");
    const sorted = mags.slice().sort((a, b) => a - b);
    const d1 = sorted[Math.floor(sorted.length * 0.1)], d9 = sorted[Math.floor(sorted.length * 0.9)];
    const bulk = r.shades.filter((_, i) => mags[i] >= d1 && mags[i] <= d9);
    const spread = Math.max(...bulk) - Math.min(...bulk);
    ok(spread >= 0.4,
       `the shading spends its range on the cells rather than on the outlier ` +
       `(interdecile opacity spread ${spread.toFixed(3)} over ${bulk.length} cells)`);
    /* AND IT IS MONOTONIC. A ramp that separates cells but ranks them wrongly
       is worse than a flat one: it looks like a reading. */
    const pairs = mags.map((m, i) => [m, r.shades[i]]).sort((a, b) => a[0] - b[0]);
    let inversions = 0;
    for (let i = 1; i < pairs.length; i++) if (pairs[i][1] < pairs[i - 1][1] - 1e-9) inversions++;
    eq(inversions, 0, "and a bigger cell is never drawn paler than a smaller one");
  }

  /* THE ENCODING NEEDS A DECODER. "Magnitude by opacity" with nothing on the
     panel to read a shade against is not a quantity, it is a mood. The key
     draws the steps themselves, and its two labels must be the same numbers
     the note states — a key and a sentence that disagree are worse than
     either alone. */
  eq(r.keySwatches.length, 5, "the shading key draws every step of the ramp");
  eq(new Set(r.keySwatches).size, 5, "each step at its own shade");
  ok(r.keySwatches.every((v, i, a) => i === 0 || v > a[i - 1]),
     `the key runs pale to dark in the order the cells do (${r.keySwatches.join(", ")})`);
  ok(/Shading steps by a factor of/.test(r.note),
     `the note names the step factor, so a shade converts to a number (${r.note.slice(0, 120)})`);
  for (const lab of r.keyLabels.filter((t) => t !== "short")) {
    ok(r.note.includes(lab),
       `the key's "${lab}" is a number the note states too, so picture and prose cannot drift`);
  }
  ok(/short/.test(r.keyLabels.join(" ")), "and the key names the short-gamma texture");
  eq(r.keyHatched, 1,
     "drawing the texture itself as the swatch rather than naming a colour for it — " +
     "a legend whose sign key is a hue is a legend a greyscale reader cannot use");

  /* role="img" AND NO LABEL is a picture a screen reader announces as
     "image". 126 cells cannot be read out, so the label carries what the
     legend carries. */
  ok(/strikes/.test(r.aria) && /expir/.test(r.aria),
     `the surface has an accessible label naming both of its axes (${r.aria.slice(0, 80)})`);
  ok(/hatched/.test(r.aria), "and says what the hatch means, since a screen reader cannot see it");

  eq(r.expLabels, panel.expiries.length, "every expiry column is labelled");
  ok(r.priceLabels >= 3, "the price ladder is labelled");

  /* THE LABELS MUST NOT OUTNUMBER THE READING.

     The stride was "as many labels as fit without overlapping" — ceil(13 /
     rowH) — and a 21-rung ladder at 15 units a rung fits twenty-one of them,
     so the stride came out 1 and every strike on the grid carried a price.
     Twenty near-identical numbers down the side, all at one weight, is not a
     ladder; it is a second dataset competing with the cells. Legibility was
     never the binding constraint. So: a budget, and separately a guarantee
     that the levels which actually mean something are inside it. */
  /* Nine is the design's own ceiling — a ruler budget of five, plus the three
     levels that are guaranteed, plus a little slack for the two ends. The
     shipped renderer draws seven here; the defect drew twenty-one. */
  ok(r.priceLabels <= 9,
     `the price rail is sparse rather than exhaustive ` +
     `(${r.priceLabels} labels for ${panel.strikes.length} strikes)`);
  for (const [what, price] of [["spot's row", panel.atSpot],
                               ["the call wall", panel.callWall && panel.callWall.strike],
                               ["the put wall", panel.putWall && panel.putWall.strike]]) {
    if (price === null || price === undefined) continue;
    ok(r.priceTexts.includes(price.toFixed(2)),
       `and ${what} (${price.toFixed(2)}) is labelled inside that budget, never thinned out ` +
       `(${r.priceTexts.join(" ")})`);
  }

  /* A MARK ON A CELL STAYS ON ITS CELL. The clip slash was drawn corner to
     corner, so its angle and its length were functions of the cell's aspect
     ratio — and cells are 44 x 15 at a phone width and 240 x 15 on a desktop.
     On a wide card the mark stopped being a mark on one cell and became a
     long shallow rule running across the grid. */
  for (const [dx, dy] of r.clipBoxes) {
    ok(dx <= r.cellW + 0.5 && dy <= r.cellH + 0.5,
       `the off-scale mark stays inside its own cell (${dx.toFixed(1)}x${dy.toFixed(1)} ` +
       `in a ${r.cellW.toFixed(1)}x${r.cellH.toFixed(1)} cell)`);
    ok(Math.abs(dx - dy) < 0.5, "and is a slash at 45 degrees rather than the cell's diagonal");
  }
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

  /* A SURFACE PUBLISHED WITHOUT A COLOUR SCALE.

     The shading ramp, the key and the off-scale marks all hang off scaleCap,
     and the Worker serves new assets the moment code merges while the next
     pipeline run is hours away — so a card that predates a field is a
     certainty, not a hypothetical. The failure to avoid is not a crash: it is
     a grid drawn at one flat weight with a key beside it, which reads as a
     measurement of uniformity, and a cap sentence with an em dash in it. */
  {
    const none = await page.evaluate(({ panel }) => {
      const host = document.getElementById("h");
      const p3 = JSON.parse(JSON.stringify(panel));
      delete p3.scaleCap; delete p3.peak; delete p3.clipped;
      window.__renderSurface(host, p3, {});
      const svg = host.querySelector("svg.gs");
      return {
        cells: svg.querySelectorAll(".gs-cell").length,
        keys: svg.querySelectorAll(".gs-key-sw").length,
        clips: svg.querySelectorAll(".gs-clip").length,
        note: (host.querySelector(".fc-note") || {}).textContent || "",
      };
    }, { panel });
    ok(none.cells > 0, "a surface published before the colour scale existed still draws its grid");
    eq(none.keys, 0, "and no shading key, because there is no ramp to label");
    eq(none.clips, 0, "and marks nothing off-scale against a cap it does not have");
    ok(/no colour scale could be measured/i.test(none.note),
       "saying shade carries no magnitude here, so a flat grid is not read as uniform gamma");
    ok(!/capped at —|NaN|undefined/.test(none.note),
       `with no em-dashed or NaN cap sentence left behind (${none.note.slice(0, 120)})`);
  }

  /* ---------- EVERY PANEL, from a real emitted card -------------- */

  /* The surface assertions above are specific. This sweep is general, and it
     is the part that scales: paint() dispatches ten renderers, and the bugs
     this repository has actually shipped — type scaled to 4.6 CSS px, a mark
     that landed on none of 109 cards, 54 bars of zero — were all invisible to
     every numeric test and all visible the moment something drew them.

     A real emitted dry-run card is used rather than a hand-built one, so the
     panels see the shapes the pipeline actually produces, including the ones
     that come back "unavailable". */
  {
    const emitted = fs.readdirSync(SCRATCH).filter((f) => f.startsWith("dry-card-")).sort();
    ok(emitted.length > 0, `the dry run emitted cards to sweep (${SCRATCH})`);

    /* SEVERAL CARDS, NOT ONE. Label length is a function of the DATA — the
       clipped sentence this sweep first caught was 334px wide only because
       that card's reading happened to be the long branch. A one-card sweep
       measures one set of strings. */
    const sample = emitted.slice(0, 5);
    for (const file of sample) {
    const card = JSON.parse(fs.readFileSync(path.join(SCRATCH, file), "utf8"));

    const swept = await page.evaluate(({ card }) => {
      const errors = [];
      /* THE DIALOG MUST BE OPEN. A closed <dialog> is display:none, so every
         child measures zero and the sweep would confirm a card is fine while
         measuring nothing at all — the exact failure mode it exists to catch,
         reproduced in the test itself. */
      const dlg = document.getElementById("flowsCard");
      try { dlg.showModal(); } catch { errors.push("dialog would not open"); }
      try { window.__paint(card, Date.now()); }
      catch (e) { return { threw: String(e) }; }

      const HOSTS = ["fcGamma", "fcSurface", "fcLevels", "fcDisp", "fcCal",
                     "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"];
      const out = [];
      for (const id of HOSTS) {
        const host = document.getElementById(id);
        if (!host) { errors.push(id + ": no host element"); continue; }
        const dead = !!host.querySelector(".fc-dead");
        const svgs = Array.from(host.querySelectorAll("svg"));
        // The smallest rendered text height anywhere in this panel.
        let minText = Infinity;
        for (const t of host.querySelectorAll("text")) {
          const h = t.getBoundingClientRect().height;
          if (h > 0 && h < minText) minText = h;
        }
        // Does any svg draw outside its own box? SVG clips silently.
        let clipped = false;
        for (const svg of svgs) {
          const box = svg.getBoundingClientRect();
          for (const t of svg.querySelectorAll("text")) {
            const r = t.getBoundingClientRect();
            if (r.width === 0) continue;
            /* TWO PIXELS, not zero. Text metrics carry sub-pixel rounding and
               a glyph's ink box is not its advance box, so a strict edge test
               reports overhang on captions that are visually flush. Two pixels
               is below anything a reader can see and far below the 23px
               overhang this sweep was written after. */
            if (r.left < box.left - 2 || r.right > box.right + 2) { clipped = true; break; }
          }
        }
        out.push({
          id, dead, svgs: svgs.length,
          empty: host.childElementCount === 0,
          minText: minText === Infinity ? null : Math.round(minText * 10) / 10,
          clipped,
          widths: svgs.map((s) => Math.round(s.getBoundingClientRect().width)),
          /* [viewBox width, rendered CSS width] per svg. The invariant the
             host-sizing fix exists to hold is that these are the SAME: one
             viewBox unit is one CSS pixel. */
          scales: svgs.map((s) => {
            const vb = (s.getAttribute("viewBox") || "").split(/\s+/);
            return [Number(vb[2]), Math.round(s.getBoundingClientRect().width)];
          }),
        });
      }
      return { panels: out, errors, overflow: document.documentElement.scrollWidth > 320 };
    }, { card });

    const who = card.ticker || file;
    ok(!swept.threw, `${who}: painting a real emitted card does not throw (${swept.threw || ""})`);
    eq((swept.errors || []).length, 0,
       `${who}: every panel the renderer targets exists in the board markup (${(swept.errors || []).join("; ")})`);

    for (const p of swept.panels) {
      /* NO PANEL IS SILENTLY BLANK. A host with no children is neither a chart
         nor an explanation — it is the state a reader cannot distinguish from
         a broken page, and it is what an unhandled tagged-union branch
         produces. Either it drew something or it said why it could not. */
      ok(!p.empty, `${who} ${p.id}: renders either content or an explicit unavailable notice`);

      if (p.dead) continue;                    // an unavailable panel has no chart to measure

      /* THE FOUR-PANEL BUG, swept across all ten. A viewBox fixed in absolute
         units with width="100%" scales the type down with the drawing: 9px
         became 4.6 CSS px at this viewport, silently, because nothing
         overflows. */
      if (p.minText !== null) {
        ok(p.minText >= 8,
           `${who} ${p.id}: axis type renders at its intended size, not scaled down (${p.minText}px)`);
      }
      /* SVG CLIPPING IS SILENT. A label that runs off its own canvas simply
         is not there, and the panel looks fine. */
      eq(p.clipped, false, `${who} ${p.id}: draws no text outside its own canvas`);

      for (const w of p.widths) {
        ok(w > 0 && w <= 320,
           `${who} ${p.id}: sizes its drawing to the viewport rather than past it (${w}px)`);
      }
      /* ONE VIEWBOX UNIT IS ONE CSS PIXEL — the actual invariant the
         host-sizing fix exists to hold, and the only one that catches this
         defect in BOTH directions. preserveAspectRatio="xMidYMid meet" with a
         fixed height attribute means a drawing can never be magnified, only
         shrunk or letterboxed, so an assertion on rendered type size catches a
         viewBox that is too WIDE (type shrinks) and is structurally incapable
         of catching one that is too NARROW (the drawing is centred in empty
         space at its intended size). Comparing the two widths catches both.
         The tolerance is 15% because panelWidth clamps to [300, 760]. */
      for (const [vbW, cssW] of p.scales) {
        if (!(vbW > 0) || !(cssW > 0)) continue;
        const ratio = vbW / cssW;
        ok(ratio > 0.85 && ratio < 1.15,
           `${who} ${p.id}: one viewBox unit is one CSS pixel (viewBox ${vbW} in ${cssW}px)`);
      }
    }
    eq(swept.overflow, false, `${who}: a fully painted card overflows nothing at 320px`);

    const drew = swept.panels.filter((p) => !p.dead).length;
    ok(drew >= 4, `${who}: the sweep measured panels rather than skipping them all (${drew} live)`);
    }
  }

  /* ---------- the same sweep at a DESKTOP width ------------------ */
  {
    /* The panels size their viewBox from the host, so a wide host is a
       genuinely different layout, not a scaled one — the whole point of that
       fix. It has never been measured. */
    await page.setViewportSize({ width: 1280, height: 1000 });
    const emitted = fs.readdirSync(SCRATCH).filter((f) => f.startsWith("dry-card-")).sort();
    const card = JSON.parse(fs.readFileSync(path.join(SCRATCH, emitted[0]), "utf8"));

    const wide = await page.evaluate(({ card }) => {
      const dlg = document.getElementById("flowsCard");
      if (!dlg.open) dlg.showModal();
      window.__paint(card, Date.now());
      const out = [];
      for (const id of ["fcGamma", "fcSurface", "fcLevels", "fcDisp", "fcCal",
                        "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
        const host = document.getElementById(id);
        const svgs = Array.from(host.querySelectorAll("svg"));
        let minText = Infinity, maxText = 0, clipped = false;
        for (const t of host.querySelectorAll("text")) {
          const h = t.getBoundingClientRect().height;
          if (h > 0) { if (h < minText) minText = h; if (h > maxText) maxText = h; }
        }
        for (const svg of svgs) {
          const box = svg.getBoundingClientRect();
          for (const t of svg.querySelectorAll("text")) {
            const r = t.getBoundingClientRect();
            if (r.width === 0) continue;
            if (r.left < box.left - 2 || r.right > box.right + 2) { clipped = true; break; }
          }
        }
        out.push({
          id, dead: !!host.querySelector(".fc-dead"), empty: host.childElementCount === 0,
          minText: minText === Infinity ? null : minText, maxText, clipped,
          widths: svgs.map((s) => Math.round(s.getBoundingClientRect().width)),
          scales: svgs.map((s) => {
            const vb = (s.getAttribute("viewBox") || "").split(/\s+/);
            return [Number(vb[2]), Math.round(s.getBoundingClientRect().width)];
          }),
        });
      }
      return { panels: out, overflow: document.documentElement.scrollWidth > 1280 };
    }, { card });

    for (const p of wide.panels) {
      ok(!p.empty, `wide ${p.id}: renders content or an explicit notice`);
      if (p.dead) continue;
      eq(p.clipped, false, `wide ${p.id}: draws no text outside its own canvas`);
      if (p.minText !== null) {
        ok(p.minText >= 8, `wide ${p.id}: type is not scaled down (${p.minText}px)`);
      }
      /* THE SAME INVARIANT AT A WIDE HOST, which is where it bites the other
         way: a viewBox NARROWER than its host letterboxes, drawing at its
         intended size inside empty margins, so no type measurement can see it. */
      for (const [vbW, cssW] of p.scales) {
        if (!(vbW > 0) || !(cssW > 0)) continue;
        const ratio = vbW / cssW;
        ok(ratio > 0.85 && ratio < 1.15,
           `wide ${p.id}: the drawing fills its host rather than letterboxing (viewBox ${vbW} in ${cssW}px)`);
      }
    }
    eq(wide.overflow, false, "a painted card overflows nothing at 1280px either");
    await page.setViewportSize({ width: 320, height: 900 });
  }

  /* ---------- THE SESSION PATH DRAWS BOTH LEGS ------------------
     buildPath has always emitted [cumDelta, cumPremium] pairs and the renderer
     read p[0], so about 78 premium points per card were serialised, shipped
     and dropped. Nothing numeric could see that — the payload was correct and
     the panel drew a perfectly good curve of half of it. Only a render test
     can. */
  {
    const t0 = Date.parse("2026-08-24T13:30:00Z");
    /* A SESSION WHERE THE TWO LEGS DISAGREE, which is the whole reason the
       premium leg is worth its ink: delta is worked steadily all day while
       premium reverses after lunch — money going into structure rather than
       into a direction. A fixture where both legs are monotone and parallel
       would let a renderer plot one series twice and still pass. */
    const ticks = Array.from({ length: 390 }, (_, i) => ({
      tape_time: new Date(t0 + i * 60000).toISOString(),
      net_delta: String(i > 260 ? 800 : 60),
      net_call_premium: String(i < 200 ? 4000 : 0),
      net_put_premium: String(i < 200 ? 0 : 5000),
    }));
    const path = buildPath(ticks, { sessionDate: "2026-08-24" });
    ok(path.status === "ok" && path.persistence !== null,
       "the path fixture builds, signature and all");

    const r = await page.evaluate(({ path }) => {
      const host = document.getElementById("h");
      window.__renderPath(host, path);
      const svg = host.querySelector("svg.fp");
      if (!svg) return { error: "no path svg" };
      const line = svg.querySelector(".fp-line");
      const prem = svg.querySelector(".fp-prem");
      const cen = svg.querySelector(".fp-centroid");
      const vb = Number((svg.getAttribute("viewBox") || "").split(/\s+/)[2]);
      const stats = {};
      for (const st of host.querySelectorAll(".fc-stat")) {
        stats[st.querySelector("dt").textContent] = st.querySelector("dd").textContent;
      }
      /* The topmost point each leg reaches. Both legs' largest absolute
         readings are POSITIVE in this fixture, so under the panel's stated
         normalisation — each leg by its own extreme, sharing only the zero
         rule — the two must peak at exactly the same height. Under one shared
         axis they cannot. */
      const ys = (n) => (n.getAttribute("d").match(/ ([\d.]+)(?= |$)/g) || []).map((t) => Number(t));
      return {
        deltaTop: line ? Math.min(...ys(line)) : null,
        premTop: prem ? Math.min(...ys(prem)) : null,
        deltaD: line && line.getAttribute("d"),
        premD: prem && prem.getAttribute("d"),
        deltaDash: line && line.getAttribute("stroke-dasharray"),
        premDash: prem && prem.getAttribute("stroke-dasharray"),
        deltaFill: line && line.getAttribute("fill"),
        premFill: prem && prem.getAttribute("fill"),
        endDot: svg.querySelectorAll(".fp-line-end").length,
        endSquare: svg.querySelectorAll(".fp-prem-end").length,
        centroidX: cen && Number(cen.getAttribute("x1")),
        vb, stats,
        legend: (host.querySelector(".fp-legend") || {}).textContent || "",
        swatches: host.querySelectorAll(".fp-legend svg").length,
        reading: (host.querySelector(".fc-reading") || {}).textContent || "",
        aria: svg.getAttribute("aria-label") || "",
      };
    }, { path });

    ok(!r.error, "the session path renders an svg");
    /* THE DEFECT ITSELF: a second path element, with its own geometry. Identical
       `d` strings would mean the same series was plotted twice. */
    ok(r.premD && r.premD.length > 20, "the cumulative-premium leg is drawn at all");
    ok(r.deltaD && r.deltaD !== r.premD,
       "and it is its OWN series — the two legs do not share a path");

    /* IDENTITY WITHOUT HUE. This codebase hatches short-gamma cells because
       colour is the last channel, not the first; two lines separated only by
       stroke colour fail a greyscale print and a colour-blind reader. */
    ok(r.premDash && !r.deltaDash,
       `the premium leg is dashed and the delta leg is not, so the two survive greyscale ` +
       `(delta ${r.deltaDash}, premium ${r.premDash})`);
    eq(r.endDot, 1, "the delta leg ends in a filled disc");
    eq(r.endSquare, 1, "and the premium leg in a hollow square — a second non-colour channel");
    /* A path with no stylesheet defaults to fill:black, stroke:none — a blob.
       The renderer ships before its CSS does, every time. */
    eq(r.deltaFill, "none", "the delta leg sets fill:none as an attribute, not only in CSS");
    eq(r.premFill, "none", "and so does the premium leg");

    /* BOTH SCALES ARE STATED. The legs are contracts of delta and dollars —
       not comparable — so the panel may not draw them without saying what a
       full deflection is worth in each. */
    ok(/contracts at full deflection/.test(r.legend),
       "the legend states the delta leg's scale");
    ok(/\$[\d.]+[KMB]? at full deflection/.test(r.legend),
       `the legend states the premium leg's scale in its own units (${r.legend})`);
    ok(r.swatches >= 2,
       "and draws the strokes themselves as swatches rather than naming colours");

    /* THE TWO SCALES ARE REALLY TWO. The legend claims each leg is normalised
       by its own extreme; this is the geometry that claim commits to. Both
       legs' largest absolute readings are positive here, so both must reach
       the same top of the plot. Drawn on one shared axis the dollar leg would
       dwarf or vanish against the delta leg and this fails — and a legend
       stating a scale the drawing does not use is a worse lie than no legend. */
    ok(r.deltaTop !== null && r.premTop !== null && Math.abs(r.deltaTop - r.premTop) <= 0.5,
       `each leg is scaled by its own extreme and both reach full deflection ` +
       `(delta top ${r.deltaTop}, premium top ${r.premTop})`);

    /* THE CENTROID IS DRAWN AT THE TIME IT MEASURES, not at a decorative
       position: the rule must land where the movement-weighted mean minute
       actually is. */
    const wantX = 10 + path.centroid * (r.vb - 20);
    ok(Math.abs(r.centroidX - wantX) <= 1,
       `the centroid rule is drawn at the minute it measures ` +
       `(${r.centroidX} against ${wantX.toFixed(1)} for a centroid of ${path.centroid.toFixed(3)})`);
    ok(path.centroid > 0.55,
       "and the fixture's centroid is late enough that a hardcoded mid-session rule would miss");

    /* THE THREE NUMBERS THEMSELVES. Family D is these; the panel could not
       state them at all. */
    eq(r.stats["Minutes with the direction"], Math.round(path.persistence * 100) + "%",
       "persistence is printed, not merely computed");
    eq(r.stats["Busiest 5% of minutes"], Math.round(path.concentration * 100) + "%",
       "and so is concentration");
    eq(r.stats["Weighted mean minute"], Math.round(path.centroid * 100) + "%",
       "and the weighted mean minute");
    ok(/uniform session would put there/.test(r.reading),
       "the reading states concentration against its own 5% baseline rather than a chosen threshold");
    ok(/50% for a tape with no direction/.test(r.reading),
       "and persistence against the coin-flip baseline");
    ok(/premium/.test(r.aria), "the accessible label mentions both legs");
  }

  /* A PREMIUM LEG OF ZEROS IS NOT A MEASUREMENT. A flat line along the axis
     reads as a finding — "premium went nowhere all day" — when the truth may
     be that nothing was recorded. */
  {
    const t0 = Date.parse("2026-08-24T13:30:00Z");
    const flatPrem = buildPath(Array.from({ length: 90 }, (_, i) => ({
      tape_time: new Date(t0 + i * 60000).toISOString(),
      net_delta: "120", net_call_premium: "0", net_put_premium: "0",
    })), { sessionDate: "2026-08-24" });
    const r = await page.evaluate(({ panel }) => {
      const host = document.getElementById("h");
      window.__renderPath(host, panel);
      return {
        prem: host.querySelectorAll(".fp-prem").length,
        delta: host.querySelectorAll(".fp-line").length,
        text: host.textContent,
      };
    }, { panel: flatPrem });
    eq(r.delta, 1, "a session with no premium still draws its delta leg");
    eq(r.prem, 0, "and draws NO premium leg rather than a flat line at the axis");
    ok(/no net premium in either direction/.test(r.text),
       "the panel says why the leg is absent instead of leaving a reader to read the axis");
    ok(!/Net premium — dashed/.test(r.text),
       "and offers no legend key for a leg it did not draw — a scale stated for an " +
       "absent series is the same false measurement as the flat line itself");
  }

  /* A REAL v1 CARD, published before any of this existed. The transitional
     window is a certainty: the Worker serves new assets the moment code
     merges and the next pipeline run is hours later. */
  {
    const v1 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-flows-v1-card.json"), "utf8"));
    eq(v1.v, 1, "the legacy fixture is still a v1 card");
    ok(!("persistence" in v1.panels.path), "which carries no path signature");
    ok(!v1.quality, "and no quality pair");

    const r = await page.evaluate(({ card }) => {
      const host = document.getElementById("h");
      const out = {};
      window.__renderPath(host, card.panels.path);
      out.pathText = host.textContent;
      out.stats = {};
      for (const st of host.querySelectorAll(".fc-stat")) {
        out.stats[st.querySelector("dt").textContent] = st.querySelector("dd").textContent;
      }
      out.centroidRules = host.querySelectorAll(".fp-centroid").length;
      window.__renderScore(host, card);
      out.scoreText = host.textContent;
      out.scoreStats = Array.from(host.querySelectorAll(".fc-stat dt")).map((n) => n.textContent);
      return out;
    }, { card: v1 });

    /* NOT MEASURED, NEVER ZERO. A published 0 persistence is "not one minute
       moved with the day" and a published 0.5 centroid is "the weight sat
       exactly at midday" — both real, unusual readings, and both would be
       manufactured entirely by the card's age. */
    eq(r.stats["Minutes with the direction"], "—",
       "a pre-signature card shows an em dash for persistence, not a zero");
    eq(r.stats["Busiest 5% of minutes"], "—", "nor a zero concentration");
    eq(r.stats["Weighted mean minute"], "—", "nor a confident midday centroid");
    eq(r.centroidRules, 0, "and draws no centroid rule at a position it does not know");
    ok(/built before the path signature was published/.test(r.pathText),
       "and says so, rather than leaving three em dashes unexplained");
    /* The premium leg is v1 too and it was ALWAYS on the wire, so it must
       still draw: only the fields whose meaning is unknown are withheld. */
    eq(r.stats["Net premium"] === "—", false,
       "while the premium total, which v1 did publish, still renders");

    ok(!r.scoreStats.includes("OTM share of directional flow"),
       "a card with no quality pair shows no quality stats");
    ok(/not published on this card/.test(r.scoreText),
       "and says the two suppression reasons were not measured rather than printing zeros");
    ok(!/\b0%\b/.test(r.scoreText),
       "with no zero anywhere in that explanation — zero is the BEST reading of both");
  }

  /* ---------- THE CONVEXITY AXIS IS A RULER ---------------------

     The magnitude rail was built from the decades PLUS tau and vmax — the
     60th percentile of this book's bars and its single widest one — so a live
     card carried

         −505K  −100K  −4K   4K   100K  505K

     and a reader was left to work out what is special about four thousand.
     Two of those three magnitudes are readings, not graduations, and the
     third (10K) had been squeezed out by the smaller of them because the
     acceptance pass ran from the bottom up.

     The fixture is shaped to reproduce exactly that: a sharply peaked book
     whose widest bar is 503,823 and whose 60th percentile is a few thousand,
     so every number the old rail would print is unround. */
  {
    const ladder = (shortPeak) => {
      const rows = [];
      for (let i = 0; i <= 40; i++) {
        const k = 60 + i * 0.5;
        const bell = Math.exp(-Math.pow((k - 70.12) / 1.7, 2));
        /* shortPeak === null is a book with no short strikes AT ALL. It is
           not the same as a short peak of zero, which would draw twenty bars
           of measured nothing and move the quantile the whole axis is built
           on — the difference between "no short side" and "a short side of
           zero" is exactly the kind of thing a fixture gets wrong quietly. */
        const g = shortPeak !== null && k < 70.12
          ? -(shortPeak * bell + shortPeak * 0.05)
          : 505432 * bell + 137;
        rows.push({
          strike: String(k), call_gamma_ask: String(g * 0.5), call_gamma_bid: String(g * 0.5),
          put_gamma_ask: "0", put_gamma_bid: "0",
        });
      }
      return buildGammaProfile(rows, { spot: 71.89 });
    };
    /* THREE BOOKS, because the rail fails differently on each. A balanced one
       exercises the ladder itself; one with no short strikes at all is where
       the old guarantee printed a magnitude into an empty half-plot; and a
       LOPSIDED one — the short side 0.04% of the long, which is the case the
       zero rule's own 18/82 clamp exists for — is where it printed a
       magnitude the short side cannot reach even though that side has bars.
       Neither of the first two can see that third failure. */
    const twoSided = ladder(505432), allLong = ladder(null), lopsided = ladder(200);
    const vmax = Math.max(...twoSided.bars.map((b) => Math.abs(b.g)));
    const vmant = vmax / Math.pow(10, Math.floor(Math.log10(vmax)));
    ok([1, 2, 5].every((m) => Math.abs(vmant - m) > 0.02),
       `the fixture's widest bar is nowhere near a ladder value (${Math.round(vmax)}), so a rail ` +
       `built from this book's own numbers cannot accidentally print a round one`);

    const gr = await page.evaluate(({ twoSided, allLong, lopsided }) => {
      /* THE REAL PANEL HOST, not the bare probe div. The rail is sized as a
         fraction of the canvas and the canvas is sized from the host, so a
         320px scratch div and the dialog's own 288px column are different
         layouts — and the narrower one is the one a phone gets. */
      const host = document.getElementById("fcGamma");
      const draw = (gp) => {
        window.__renderGamma(host, gp, {
          ticker: "T", gammaFlip: 70.12, panels: {},
          regime: { spotGammaShare: -0.62, flipSide: "short_below", bandMin: 60, bandMax: 80 },
        });
        const svg = host.querySelector("svg.gp");
        const num = (n, a) => Number(n.getAttribute(a));
        const ptick = svg.querySelector(".gp-ptick");
        const negBar = svg.querySelector(".gp-bar.is-neg");
        return {
          vb: Number((svg.getAttribute("viewBox") || "").split(/\s+/)[2]),
          ticks: Array.from(svg.querySelectorAll(".gp-ticklabel"))
            .map((n) => ({ label: n.textContent, x: num(n, "x") })),
          zeroX: num(svg.querySelector(".gp-zero"), "x1"),
          plotL: ptick ? num(ptick, "x2") : null,
          plotR: num(svg.querySelector(".gp-leader"), "x1"),
          negBars: svg.querySelectorAll(".gp-bar.is-neg").length,
          hatches: svg.querySelectorAll(".gp-barhatch").length,
          negFill: negBar ? getComputedStyle(negBar).fill : null,
          plateRects: svg.querySelectorAll(".gp-plate rect").length,
          axis: (svg.querySelector(".gp-axis") || {}).textContent || "",
          prices: Array.from(svg.querySelectorAll(".gp-price")).map((n) => n.textContent),
          priceYs: Array.from(svg.querySelectorAll(".gp-price"))
            .map((n) => num(n, "y")).sort((a, b) => a - b),
          plotTop: num(svg.querySelector(".gp-zero"), "y1"),
          plotBottom: num(svg.querySelector(".gp-zero"), "y2"),
          note: (host.querySelector(".fc-note") || {}).textContent || "",
          /* How far the longest bar on each side of the zero rule reaches.
             Position IS magnitude on this axis, so no graduation may be drawn
             beyond it. */
          reach: Array.from(svg.querySelectorAll(".gp-bar")).reduce((acc, b) => {
            const x = num(b, "x"), w = num(b, "width");
            const z = num(svg.querySelector(".gp-zero"), "x1");
            if (b.classList.contains("is-neg")) acc.neg = Math.max(acc.neg, z - x);
            else acc.pos = Math.max(acc.pos, x + w - z);
            return acc;
          }, { neg: 0, pos: 0 }),
        };
      };
      return { two: draw(twoSided), long: draw(allLong), lop: draw(lopsided) };
    }, { twoSided, allLong, lopsided });

    /* EVERY GRADUATION COMES OFF THE 1-2-5 LADDER. compact() rounds, so this
       parses the printed string back: "500K" is 5e5 and passes, "505K" is
       5.05e5 and does not. */
    const parseMark = (t) => {
      const m = /^(\d+(?:\.\d+)?)([KMB])?$/.exec(t.replace(/−/, ""));
      if (!m) return NaN;
      return Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1);
    };
    ok(gr.two.ticks.length >= 2, `the axis is graduated at all (${gr.two.ticks.length} marks)`);
    for (const t of gr.two.ticks) {
      const v = parseMark(t.label);
      const mant = v / Math.pow(10, Math.floor(Math.log10(v)));
      ok(Math.abs(mant - Math.round(mant * 10) / 10) < 1e-9 && [1, 2, 5].includes(Math.round(mant)),
         `"${t.label}" is a round graduation and not a reading off this book's own data`);
    }
    /* THE GRADUATION NEAREST THE WIDEST BAR ALWAYS SURVIVES — on every book,
       which is the only form of that promise worth making. The old rail kept
       it with a special case and accepted marks from the SMALLEST up, so a
       mark near the knee claimed its space first and blocked the decade above
       it; on a narrow canvas that is how the top graduation disappeared
       altogether. Taking the biggest first is what makes the promise
       structural. Checked on all three books because the failure is a
       function of how much room is left after the small marks have taken
       theirs, which is different on each. */
    const topLadder = (bars) => {
      const v = Math.max(...bars.map((b) => Math.abs(b.g)));
      const dec = Math.pow(10, Math.floor(Math.log10(v)));
      for (const m of [5, 2, 1]) if (m * dec <= v) return m * dec;
      return dec;
    };
    for (const [who, g, prof] of [["balanced", gr.two, twoSided],
                                  ["all-long", gr.long, allLong],
                                  ["lopsided", gr.lop, lopsided]]) {
      const want = topLadder(prof.bars);
      ok(g.ticks.some((t) => parseMark(t.label) === want),
         `${who}: the graduation nearest the widest bar survives the spacing pass ` +
         `(wanted ${want}, got ${g.ticks.map((t) => t.label).join(" ") || "nothing"})`);
    }

    /* POSITION IS MAGNITUDE ON THIS AXIS. On a book with no short strikes the
       whole left of the zero rule is a region no bar can reach, and the old
       rail clamped its guaranteed −vmax mark to the left edge and labelled it
       — printing "−505K" at a place where −505K is not. */
    eq(gr.long.negBars, 0, "the all-long fixture really has no short strikes");
    eq(gr.long.ticks.filter((t) => t.label.startsWith("−")).length, 0,
       `and the axis names no negative magnitude on it ` +
       `(${gr.long.ticks.map((t) => t.label).join(" ")})`);

    /* THE SAME DEFECT ON A SIDE THAT DOES HAVE BARS, which is the case
       neither of the two above can see. The lopsided book's short side runs
       to a few tens of thousands while the long side runs to half a million,
       so the ladder produces marks the short side cannot reach — and the old
       code clamped its guaranteed −vmax to plotL + 2 and labelled it there.
       The invariant is the axis's own premise: distance from the zero rule IS
       magnitude, so a graduation past the longest bar on its own side is a
       magnitude drawn where that magnitude is not. */
    for (const [who, g] of [["lopsided", gr.lop], ["balanced", gr.two], ["all-long", gr.long]]) {
      for (const t of g.ticks) {
        const d = Math.abs(t.x - g.zeroX);
        const reach = t.label.startsWith("−") ? g.reach.neg : g.reach.pos;
        ok(d <= reach + 2,
           `${who}: the "${t.label}" graduation sits inside the reach of its own side of the ` +
           `book (${d.toFixed(1)} against ${reach.toFixed(1)})`);
      }
    }
    /* Measured on the DATA, not on the drawing: the whole point of a log axis
       is that a 2500:1 spread in gamma is a small difference in pixels, so a
       pixel-side non-vacuity check would be checking the wrong thing. */
    const shortest = Math.max(...lopsided.bars.filter((b) => b.g < 0).map((b) => -b.g), 0);
    const longest = Math.max(...lopsided.bars.map((b) => b.g));
    ok(shortest > 0 && longest > shortest * 100,
       `and the lopsided fixture really is lopsided, so that check is not vacuous ` +
       `(short side peaks at ${shortest.toFixed(0)}, long side at ${longest.toFixed(0)})`);
    ok(gr.lop.negBars > 0, "while still drawing short bars, which is what makes it the harder case");
    /* And where both sides DO carry bars, a magnitude and its negation are the
       same distance from the zero rule, which is what makes the rail readable
       as a ruler at all. */
    for (const t of gr.two.ticks.filter((t) => t.label.startsWith("−"))) {
      const mirror = gr.two.ticks.find((o) => o.label === t.label.replace("−", ""));
      if (!mirror) continue;
      ok(Math.abs((gr.two.zeroX - t.x) - (mirror.x - gr.two.zeroX)) <= 2,
         `${t.label} and ${mirror.label} sit the same distance from zero ` +
         `(${(gr.two.zeroX - t.x).toFixed(1)} against ${(mirror.x - gr.two.zeroX).toFixed(1)})`);
    }

    /* THE AXIS SAYS WHAT IT IS, ON THE AXIS. A reader who assumes a linear
       scale misjudges every bar on the panel, always in the direction that
       flatters the wings, and the only place that was stated was four
       sentences into the note below the chart. */
    ok(/log/.test(gr.two.axis), `the axis caption names the scale (${gr.two.axis})`);
    ok(/LOGARITHMIC/.test(gr.two.note) && /not off bar length|rank/.test(gr.two.note),
       "and the note says what to do about it rather than only naming it");

    /* SIGN SURVIVES GREYSCALE, AND SO DOES SIZE. A short bar was drawn as
       `fill: url(#gpNeg)` with nothing underneath — 45% coverage of diagonal
       lines against a long bar's 100% solid, so two bars carrying the same
       number were drawn with half the ink on one side. The texture that
       exists to carry the sign was setting the reader's impression of the
       balance of the book. */
    ok(gr.two.negBars > 0, "the two-sided fixture draws short bars");
    eq(gr.two.hatches, gr.two.negBars,
       "every short bar carries the texture that encodes its sign without hue");
    ok(gr.two.negFill && !/url\(/.test(gr.two.negFill),
       `and the bar underneath is a solid fill, not the pattern itself, so both signs ` +
       `carry the same ink for the same number (${gr.two.negFill})`);

    /* THE RAIL IS AN ANNOTATION COLUMN, NOT A TOOLTIP. Two labels in filled,
       outlined plates took 132 units of a 300-unit canvas — wider than the
       chart they annotated, and drawn over nothing, since the rail is empty
       space. */
    eq(gr.two.plateRects, 0,
       "the level readouts are annotations in the rail, not plates floating over the plot");
    ok(gr.two.plotL !== null, "the price rail is measurable");
    ok(gr.two.vb - gr.two.plotR < gr.two.plotR - gr.two.plotL,
       `the annotation column is narrower than the chart it annotates ` +
       `(rail ${gr.two.vb - gr.two.plotR}, plot ${gr.two.plotR - gr.two.plotL})`);

    /* AND IT DOES NOT SAY THE SAME NUMBER TWICE. Spot and the flip each had a
       rule, a rail annotation carrying px2() of the level, AND an entry in
       the price ladder on the left — the same price printed twice on one row,
       with the left copy distinguished from its neighbours by colour alone. */
    for (const p of ["71.89", "70.12"]) {
      ok(!gr.two.prices.includes(p),
         `${p} is labelled once, in the rail, not again in the price ladder ` +
         `(${gr.two.prices.join(" ")})`);
    }

    /* AND THE PRICE RAIL IS STILL A RAIL. Dropping spot and the flip from it
       left an emitted card with four labels on a 490-unit column — the three
       biggest strikes bunched around the peak, and the low end — so most of
       the ladder had no price against it at all. The earned labels are still
       earned; a round step fills the gaps behind them. The measurable form of
       "it is a ruler" is that no stretch of the column goes unlabelled for
       more than about a fifth of its height. */
    {
      const span = gr.two.plotBottom - gr.two.plotTop;
      const ys = [gr.two.plotTop, ...gr.two.priceYs, gr.two.plotBottom];
      let worst = 0;
      for (let i = 1; i < ys.length; i++) worst = Math.max(worst, ys[i] - ys[i - 1]);
      ok(worst <= span * 0.22,
         `no stretch of the price rail runs unlabelled ` +
         `(worst gap ${worst.toFixed(0)} of ${span.toFixed(0)} units, ` +
         `${gr.two.prices.length} labels)`);
      /* And filling the gaps must not stack two labels on one row. SVG will
         happily draw one price on top of another and the result reads as a
         smudge, not as an error. */
      let tightest = Infinity;
      for (let i = 1; i < gr.two.priceYs.length; i++) {
        tightest = Math.min(tightest, gr.two.priceYs[i] - gr.two.priceYs[i - 1]);
      }
      ok(tightest >= 11,
         `and no two prices are drawn on top of each other (closest pair ${tightest} units apart)`);
    }
  }

  /* ---------- HOW SHORT, NOT MERELY SHORT -----------------------
     regime.spotGammaShare is published on every card and was drawn nowhere:
     only its SIGN reached the reader, through the header badge. Dealers at
     0.9 of their peak short position at spot and dealers at 0.05 of it are
     not the same board, and the card rendered them identically. */
  {
    const strikes = [
      { strike: "95", call_gamma_ask: "0.6e8", call_gamma_bid: "0.4e8",
        put_gamma_ask: "-2.4e8", put_gamma_bid: "-1.6e8" },
      { strike: "100", call_gamma_ask: "2e8", call_gamma_bid: "1e8",
        put_gamma_ask: "-1e8", put_gamma_bid: "-1e8" },
      { strike: "105", call_gamma_ask: "4e8", call_gamma_bid: "3e8",
        put_gamma_ask: "-0.6e8", put_gamma_bid: "-0.4e8" },
    ];
    const gp = buildGammaProfile(strikes, { spot: 100 });
    ok(gp.status === "ok", "the gamma fixture builds");

    const shot = await page.evaluate(({ gp }) => {
      const host = document.getElementById("h");
      const draw = (share) => {
        window.__renderGamma(host, gp, {
          ticker: "T", gammaFlip: 99, panels: {},
          regime: { spotGammaShare: share, flipSide: "short_below", bandMin: 95, bandMax: 105 },
        });
        return {
          text: host.textContent,
          plate: Array.from(host.querySelectorAll(".gp-plate-s")).map((n) => n.textContent).join("|"),
        };
      };
      return { deep: draw(-0.93), shallow: draw(-0.05), absent: draw(null) };
    }, { gp });

    /* THE ASSERTION THE AUDIT IS ABOUT. Two books that differ by a factor of
       eighteen in how hard dealers are positioned at spot must not render the
       same words. */
    ok(shot.deep.text !== shot.shallow.text,
       "a book 0.93 of peak short at spot and one 0.05 of peak short no longer render identically");
    ok(/0\.93 of/.test(shot.deep.plate),
       `the magnitude is on the spot rule itself (${shot.deep.plate})`);
    ok(/0\.05 of/.test(shot.shallow.plate), "for both readings");
    ok(/0\.93 of this ladder's peak/.test(shot.deep.text),
       "and the note states it as a share of the ladder's peak, which is what makes it comparable across names");
    /* The panel already says "short gamma immediately below the flip" on every
       card, so a bare /short/ here would pass under any mutation. The sign must
       be attached to THIS reading. */
    ok(/peak exposure and short/.test(shot.deep.text),
       "with the sign attached to that reading rather than to the flip sentence");
    ok(!/0\.00 of|NaN|undefined/.test(shot.absent.text),
       "a card whose spot lies outside the measured band manufactures no reading");
    ok(/not published on this card/.test(shot.absent.text),
       "and says why the reading is missing");
  }

  /* ---------- THE TWO SUPPRESSION REASONS ------------------------ */
  {
    const r = await page.evaluate(() => {
      const host = document.getElementById("h");
      const base = { v: 2, fam: { F: 10, P: -5, D: 3, V: 50, O: 38 },
                     weights: { F: 1, P: 1, D: 1 }, conv: {} };
      const read = () => {
        const stats = {};
        for (const st of host.querySelectorAll(".fc-stat")) {
          stats[st.querySelector("dt").textContent] = st.querySelector("dd").textContent;
        }
        return { stats, text: host.textContent };
      };
      window.__renderScore(host, { ...base, quality: { otmShare: 0.71, vegaTilt: 1.34 } });
      const live = read();
      window.__renderScore(host, { ...base, quality: { otmShare: 0.08, vegaTilt: 0.02 } });
      const clean = read();
      window.__renderScore(host, { ...base, quality: { otmShare: null, vegaTilt: null } });
      const none = read();
      return { live, clean, none };
    });

    eq(r.live.stats["OTM share of directional flow"], "71%",
       "the OTM share of directional flow is printed, not folded into the O digit");
    eq(r.live.stats["Vega flow per unit delta"], "1.34",
       "and so is vega flow per unit of delta flow");
    eq(r.clean.stats["OTM share of directional flow"], "8%",
       "a near-money book reads differently from a lottery-ticket one");
    ok(r.live.text !== r.clean.text,
       "so two names with the same O gauge no longer say the same thing");
    ok(/lottery tickets/.test(r.live.text) && /trading VOLATILITY/.test(r.live.text),
       "each reading is named as the suppression reason it is");
    eq(r.none.stats["OTM share of directional flow"], "—",
       "no directional flow to divide by is an em dash, never 0 — zero is the TOP of that column");
    eq(r.none.stats["Vega flow per unit delta"], "—", "and likewise the vega tilt");
    ok(/no directional view/.test(r.none.text),
       "with the reason stated: a vanishing delta flow is no view, not infinite vol conviction");
  }

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
    `sign survives without hue, the shading ramp spends its range on the cells rather than ` +
    `on one outlier and is drawn as a key the note agrees with, not measured and measured ` +
    `at nothing are told apart, the price rails are rulers rather than walls of digits, ` +
    `the convexity axis is graduated on a round ladder and never names a magnitude where no ` +
    `bar can reach it, axis type is not silently shrunk, both path legs are drawn on stated ` +
    `scales, the path signature and the dealer-gamma share at spot reach the reader, and a ` +
    `pre-surface, pre-scale, pre-signature card degrades`);
} finally {
  await browser.close();
  await rm(SCRATCH, { recursive: true, force: true });
}
