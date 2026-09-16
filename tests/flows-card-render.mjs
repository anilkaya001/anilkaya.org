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
import { TICKER_PANELS } from "../shared/flows-panels.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCRATCH = await mkdtemp(path.join(os.tmpdir(), "flows-render-"));
execFileSync(process.execPath, [
  path.join(ROOT, "scripts/flows-pipeline.mjs"),
  "--dry-run", "--emit", path.join(SCRATCH, "dry.json"),
], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

function fixture() {
  const rows = [];
  const expiries = ["2026-08-28", "2026-09-04", "2026-09-18", "2026-10-16"];
  for (let i = 0; i < 25; i++) {
    const k = 90 + i;
    for (const [j, e] of expiries.entries()) {
      if (k === 97 && e === "2026-09-04") continue;
      let g = 3e6 * Math.exp(-Math.pow((k - 100) / 4.5, 2)) / (1 + j * 0.8) * (k >= 100 ? 1 : -1);
      if (k === 103 && j === 0) g = 9e9;
      if (k === 98 && e === "2026-09-18") g = 0;
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

const panelsSrc = fs.readFileSync(path.join(ROOT, "assets/js/flows-panels.js"), "utf8");
assert.ok(panelsSrc.lastIndexOf("})();") > 0, "flows-panels.js is still an IIFE");

const drawersSrc = fs.readFileSync(path.join(ROOT, "assets/js/flows-drawers.js"), "utf8");
assert.ok(/__register\(/.test(drawersSrc),
  "flows-drawers.js hands its drawers back through FlowsPanels.__register");

const browser = await chromium.launch();
try {

  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const pageHTML = FLOWS_PAGES.tickerPage({ username: "test" })
    .replace(/<script[^>]*><\/script>/g, "")
    .replace("</body>", '<div id="h"></div></body>');
  await page.setContent(pageHTML);
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/base.css") });
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/flows.css") });

  await page.evaluate(() => { document.getElementById("ftGrid").hidden = false; });
  await page.addScriptTag({ content: panelsSrc });
  await page.addScriptTag({ content: drawersSrc });

  const DRAWN_HOSTS = await page.evaluate((all) => {
    const P = window.FlowsPanels;
    const pairs = all.filter(([, key]) =>
      typeof (key === "__score" ? P.score : P[key]) === "function");
    window.__paintAll = (card) => {
      for (const [id, key] of pairs) {
        const host = document.getElementById(id);
        if (!host) continue;
        host.textContent = "";
        const sec = document.querySelector('.ft-panel[data-panel="' + key + '"]');
        const q = sec ? sec.dataset.question : "";
        if (key === "__score") P.score(host, card, q);
        else P[key](host, (card.panels || {})[key], card, q);
      }
    };
    return pairs;
  }, TICKER_PANELS.map((e) => [e.id, e.key]));

  eq(DRAWN_HOSTS.length, 14,
     `fourteen registry panels are drawn by window.FlowsPanels — eleven with a drawer ` +
     `of their own plus the three second-order Greeks that share one (${
       DRAWN_HOSTS.length})`);

  await page.evaluate(() => {
    const P = window.FlowsPanels;
    window.__renderSurface = P.surface;
    window.__renderPath = P.path;
    window.__renderGamma = P.gamma;
    window.__renderScore = P.score;
  });
  eq(errors.length, 0, "the panel module loads against the real page markup without throwing");

  ok(await page.evaluate(() => !!document.getElementById("ftSurface")),
     "the ticker page carries the container the surface renderer targets, under the id " +
     "the registry names");

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

      opacities: new Set(Array.from(svg.querySelectorAll(".gs-cell:not(.is-zero)"))
        .map((n) => n.getAttribute("fill-opacity"))).size,

      shades: Array.from(svg.querySelectorAll(".gs-cell:not(.is-zero)"))
        .map((n) => Number(n.getAttribute("fill-opacity"))),
      zeroCells: q(".gs-cell.is-zero"),
      zeroMarks: q(".gs-zeromark"),
      zeroSigned: q(".gs-cell.is-zero.is-pos, .gs-cell.is-zero.is-neg"),
      keySwatches: Array.from(svg.querySelectorAll(".gs-key-sw.is-pos"))
        .map((n) => Number(n.getAttribute("fill-opacity"))),
      keyLabels: Array.from(svg.querySelectorAll(".gs-key")).map((n) => n.textContent),

      keyHatched: Array.from(svg.querySelectorAll(".gs-key-sw.is-neg")).filter((sw) => {
        const b = sw.getBoundingClientRect();
        return Array.from(svg.querySelectorAll(".gs-hatch")).some((h) => {
          const r = h.getBoundingClientRect();
          return Math.abs(r.left - b.left) < 1 && Math.abs(r.top - b.top) < 1;
        });
      }).length,
      aria: svg.getAttribute("aria-label") || "",
      priceTexts: Array.from(svg.querySelectorAll(".gs-price")).map((n) => n.textContent),

      clipBoxes: Array.from(svg.querySelectorAll(".gs-clip")).map((n) => [
        Math.abs(Number(n.getAttribute("x2")) - Number(n.getAttribute("x1"))),
        Math.abs(Number(n.getAttribute("y2")) - Number(n.getAttribute("y1"))),
      ]),
    };
  }, { panel });

  ok(!r.error, "the surface renders an svg");

  eq(r.cells + r.voids, panel.strikes.length * panel.expiries.length,
     "drawn cells plus voids reconcile against the grid");
  ok(r.voids >= 1, "the pair the vendor did not return is drawn as an explicit void");
  ok(r.hatches >= 1, "short-gamma cells carry the hatch that encodes sign without hue");
  eq(r.clips, panel.clipped, "every cell past the colour cap is marked, and only those");
  ok(r.opacities > 3, `magnitude is encoded in opacity, not flattened (${r.opacities} levels)`);

  eq(r.zeroCells, 1, "the pair the vendor measured at exactly zero is drawn as its own kind of cell");
  eq(r.zeroSigned, 0, "and carries NO sign class — zero is neither long nor short gamma");
  ok(r.zeroMarks >= 1, "with a mark of its own, so it cannot be mistaken for a void");

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

    const pairs = mags.map((m, i) => [m, r.shades[i]]).sort((a, b) => a[0] - b[0]);
    let inversions = 0;
    for (let i = 1; i < pairs.length; i++) if (pairs[i][1] < pairs[i - 1][1] - 1e-9) inversions++;
    eq(inversions, 0, "and a bigger cell is never drawn paler than a smaller one");
  }

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

  ok(/strikes/.test(r.aria) && /expir/.test(r.aria),
     `the surface has an accessible label naming both of its axes (${r.aria.slice(0, 80)})`);
  ok(/hatched/.test(r.aria), "and says what the hatch means, since a screen reader cannot see it");

  eq(r.expLabels, panel.expiries.length, "every expiry column is labelled");
  ok(r.priceLabels >= 3, "the price ladder is labelled");

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

  eq(panel.clipped, 1, "the fixture clips exactly one cell");
  ok(/one cell runs past it/.test(r.note) && /and is marked/.test(r.note),
     "one clipped cell is described in the singular");
  ok(!/6 of 6|4 of 4/.test(r.note), "it does not report a window that windows nothing");

  eq(r.svgWidth, 320, "the surface fills the viewport width");
  ok(r.labelPx >= 8, `axis type renders at its intended size, not scaled down (${r.labelPx}px)`);
  ok(r.cellH >= 6.5, `cells stay tall enough to be cells (${r.cellH}px)`);
  ok(r.cellW >= 6.5, `and wide enough (${r.cellW}px)`);
  eq(r.pageOverflow, false, "and nothing overflows a 320px viewport");

  const many = await page.evaluate(({ panel }) => {
    const host = document.getElementById("h");

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

  {
    const emitted = fs.readdirSync(SCRATCH).filter((f) => f.startsWith("dry-card-")).sort();
    ok(emitted.length > 0, `the dry run emitted cards to sweep (${SCRATCH})`);

    {
      const card = JSON.parse(fs.readFileSync(path.join(SCRATCH, emitted[0]), "utf8"));
      const drawn = await page.evaluate(({ card, hosts }) => {
        window.__paintAll(card);
        const out = {};
        for (const id of hosts) {
          const q = document.querySelector("#" + id + " .fc-q");
          out[id] = q ? q.textContent : null;
        }
        return out;
      }, { card, hosts: DRAWN_HOSTS.map(([id]) => id) });

      for (const [id, key] of DRAWN_HOSTS) {
        const entry = TICKER_PANELS.find((e) => e.key === key);
        ok(entry && entry.question, `the registry carries a question for "${key}"`);
        ok(drawn[id], `${id}: the panel drew a question at all`);
        ok(!String(drawn[id]).includes("[object"),
           `${id}: and it is a sentence, not a stringified object ("${
             String(drawn[id]).slice(0, 48)}")`);
        eq(drawn[id], entry.question,
           `${id}: draws the registry's question, the one /flows/ticker/ puts over this ` +
           "drawing");
      }
    }

    const sample = emitted.slice(0, 5);
    for (const file of sample) {
    const card = JSON.parse(fs.readFileSync(path.join(SCRATCH, file), "utf8"));

    const swept = await page.evaluate(({ card, HOSTS }) => {
      const errors = [];
      try { window.__paintAll(card); }
      catch (e) { return { threw: String(e) }; }

      const out = [];
      for (const id of HOSTS) {
        const host = document.getElementById(id);
        if (!host) { errors.push(id + ": no host element"); continue; }
        const dead = !!host.querySelector(".fc-dead");
        const svgs = Array.from(host.querySelectorAll("svg"));

        let minText = Infinity;
        for (const t of host.querySelectorAll("text")) {
          const h = t.getBoundingClientRect().height;
          if (h > 0 && h < minText) minText = h;
        }

        let clipped = false;
        for (const svg of svgs) {
          const box = svg.getBoundingClientRect();
          for (const t of svg.querySelectorAll("text")) {
            const r = t.getBoundingClientRect();
            if (r.width === 0) continue;

            if (r.left < box.left - 2 || r.right > box.right + 2) { clipped = true; break; }
          }
        }
        out.push({
          id, dead, svgs: svgs.length,
          empty: host.childElementCount === 0,
          minText: minText === Infinity ? null : Math.round(minText * 10) / 10,
          clipped,
          widths: svgs.map((s) => Math.round(s.getBoundingClientRect().width)),

          scales: svgs.map((s) => {
            const vb = (s.getAttribute("viewBox") || "").split(/\s+/);
            return [Number(vb[2]), s.getBoundingClientRect().width];
          }),

          par: svgs.map((s) => s.getAttribute("preserveAspectRatio") || "(default)"),
        });
      }
      return { panels: out, errors, overflow: document.documentElement.scrollWidth > 320 };
    }, { card, HOSTS: DRAWN_HOSTS.map(([id]) => id) });

    const who = card.ticker || file;
    ok(!swept.threw, `${who}: painting a real emitted card does not throw (${swept.threw || ""})`);
    eq((swept.errors || []).length, 0,
       `${who}: every panel the renderer targets exists in the served markup (${(swept.errors || []).join("; ")})`);

    for (const p of swept.panels) {

      for (const par of p.par || []) {
        ok(par !== "none",
           `${who}/${p.id}: no chart stretches — preserveAspectRatio="none" scales ` +
           "x and y apart, so the width stays right while the drawing inside is " +
           "distorted, and every width-based assertion here would still pass");
      }

      ok(!p.empty, `${who} ${p.id}: renders either content or an explicit unavailable notice`);

      if (p.dead) continue;

      if (p.minText !== null) {
        ok(p.minText >= 8,
           `${who} ${p.id}: axis type renders at its intended size, not scaled down (${p.minText}px)`);
      }

      eq(p.clipped, false, `${who} ${p.id}: draws no text outside its own canvas`);

      for (const w of p.widths) {
        ok(w > 0 && w <= 320,
           `${who} ${p.id}: sizes its drawing to the viewport rather than past it (${w}px)`);
      }

      for (const [vbW, cssW] of p.scales) {
        if (!(vbW > 0) || !(cssW > 0)) continue;
        ok(Math.abs(vbW - cssW) < 1,
           `${who} ${p.id}: one viewBox unit is one CSS pixel (viewBox ${vbW} in ${
             cssW.toFixed(2)}px)`);
      }
    }
    eq(swept.overflow, false, `${who}: a fully painted card overflows nothing at 320px`);

    const drew = swept.panels.filter((p) => !p.dead).length;
    ok(drew >= 4, `${who}: the sweep measured panels rather than skipping them all (${drew} live)`);
    }
  }

  {

    await page.setViewportSize({ width: 1280, height: 1000 });
    const emitted = fs.readdirSync(SCRATCH).filter((f) => f.startsWith("dry-card-")).sort();
    const card = JSON.parse(fs.readFileSync(path.join(SCRATCH, emitted[0]), "utf8"));

    const wide = await page.evaluate(({ card, HOSTS }) => {
      window.__paintAll(card);
      const out = [];
      for (const id of HOSTS) {
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
            return [Number(vb[2]), s.getBoundingClientRect().width];
          }),

          par: svgs.map((s) => s.getAttribute("preserveAspectRatio") || "(default)"),
        });
      }
      return { panels: out, overflow: document.documentElement.scrollWidth > 1280 };
    }, { card, HOSTS: DRAWN_HOSTS.map(([id]) => id) });

    for (const p of wide.panels) {
      ok(!p.empty, `wide ${p.id}: renders content or an explicit notice`);
      if (p.dead) continue;
      eq(p.clipped, false, `wide ${p.id}: draws no text outside its own canvas`);
      if (p.minText !== null) {
        ok(p.minText >= 8, `wide ${p.id}: type is not scaled down (${p.minText}px)`);
      }

      for (const [vbW, cssW] of p.scales) {
        if (!(vbW > 0) || !(cssW > 0)) continue;
        ok(Math.abs(vbW - cssW) < 1,
           `wide ${p.id}: the drawing fills its host rather than letterboxing (viewBox ${
             vbW} in ${cssW.toFixed(2)}px)`);
      }
    }
    eq(wide.overflow, false, "a painted card overflows nothing at 1280px either");
    await page.setViewportSize({ width: 320, height: 900 });
  }

  {
    const t0 = Date.parse("2026-08-24T13:30:00Z");

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

    ok(r.premD && r.premD.length > 20, "the cumulative-premium leg is drawn at all");
    ok(r.deltaD && r.deltaD !== r.premD,
       "and it is its OWN series — the two legs do not share a path");

    ok(r.premDash && !r.deltaDash,
       `the premium leg is dashed and the delta leg is not, so the two survive greyscale ` +
       `(delta ${r.deltaDash}, premium ${r.premDash})`);
    eq(r.endDot, 1, "the delta leg ends in a filled disc");
    eq(r.endSquare, 1, "and the premium leg in a hollow square — a second non-colour channel");

    eq(r.deltaFill, "none", "the delta leg sets fill:none as an attribute, not only in CSS");
    eq(r.premFill, "none", "and so does the premium leg");

    ok(/contracts at full deflection/.test(r.legend),
       "the legend states the delta leg's scale");
    ok(/\$[\d.]+[KMB]? at full deflection/.test(r.legend),
       `the legend states the premium leg's scale in its own units (${r.legend})`);
    ok(r.swatches >= 2,
       "and draws the strokes themselves as swatches rather than naming colours");

    ok(r.deltaTop !== null && r.premTop !== null && Math.abs(r.deltaTop - r.premTop) <= 0.5,
       `each leg is scaled by its own extreme and both reach full deflection ` +
       `(delta top ${r.deltaTop}, premium top ${r.premTop})`);

    const wantX = 10 + path.centroid * (r.vb - 20);
    ok(Math.abs(r.centroidX - wantX) <= 1,
       `the centroid rule is drawn at the minute it measures ` +
       `(${r.centroidX} against ${wantX.toFixed(1)} for a centroid of ${path.centroid.toFixed(3)})`);
    ok(path.centroid > 0.55,
       "and the fixture's centroid is late enough that a hardcoded mid-session rule would miss");

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
      out.scoreNotes = Array.from(host.querySelectorAll(".fc-note")).map((n) => n.textContent);
      return out;
    }, { card: v1 });

    eq(r.stats["Minutes with the direction"], "—",
       "a pre-signature card shows an em dash for persistence, not a zero");
    eq(r.stats["Busiest 5% of minutes"], "—", "nor a zero concentration");
    eq(r.stats["Weighted mean minute"], "—", "nor a confident midday centroid");
    eq(r.centroidRules, 0, "and draws no centroid rule at a position it does not know");
    ok(/built before the path signature was published/.test(r.pathText),
       "and says so, rather than leaving three em dashes unexplained");

    eq(r.stats["Net premium"] === "—", false,
       "while the premium total, which v1 did publish, still renders");

    ok(!r.scoreStats.includes("OTM share of directional flow"),
       "a card with no quality pair shows no quality stats");

    ok(r.scoreNotes.some((t) => /built before the volatility and quality readings became/.test(t)),
       "and a NOTE explains the suppression reasons were not measured rather than printing zeros");
    ok(!/\b0%\b/.test(r.scoreText),
       "with no zero anywhere in that explanation — zero is the BEST reading of both");
  }

  {
    const ladder = (shortPeak) => {
      const rows = [];
      for (let i = 0; i <= 40; i++) {
        const k = 60 + i * 0.5;
        const bell = Math.exp(-Math.pow((k - 70.12) / 1.7, 2));

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

    const twoSided = ladder(505432), allLong = ladder(null), lopsided = ladder(200);
    const vmax = Math.max(...twoSided.bars.map((b) => Math.abs(b.g)));
    const vmant = vmax / Math.pow(10, Math.floor(Math.log10(vmax)));
    ok([1, 2, 5].every((m) => Math.abs(vmant - m) > 0.02),
       `the fixture's widest bar is nowhere near a ladder value (${Math.round(vmax)}), so a rail ` +
       `built from this book's own numbers cannot accidentally print a round one`);

    const gr = await page.evaluate(({ twoSided, allLong, lopsided }) => {

      const host = document.getElementById("ftGamma");
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

          leads: Array.from(host.querySelectorAll(".fc-reading.is-lead"))
            .map((n) => n.textContent.replace(/\s+/g, " ").trim()),
          leadBeforeChart: (() => {
            const lead = host.querySelector(".fc-reading.is-lead");

            return !!(lead && (lead.compareDocumentPosition(svg) & 4) === 4);
          })(),
          notes: Array.from(host.querySelectorAll(".fc-note")).map((n) => ({
            text: n.textContent.replace(/\s+/g, " ").trim(),
            qualifier: n.classList.contains("is-qualifier"),
            inDetails: !!n.closest("details"),
            open: n.closest("details") ? n.closest("details").open : true,
          })),
          howSummary: (host.querySelector("details.ft-how > summary") || {}).textContent || "",

          howChrome: (() => {
            const sm = host.querySelector("details.ft-how > summary");
            if (!sm) return null;
            const cs = getComputedStyle(sm);
            return { marker: getComputedStyle(sm, "::before").content,
                     cursor: cs.cursor, tab: sm.tabIndex, size: parseFloat(cs.fontSize) };
          })(),
          all: host.textContent.replace(/\s+/g, " "),

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

    eq(gr.long.negBars, 0, "the all-long fixture really has no short strikes");
    eq(gr.long.ticks.filter((t) => t.label.startsWith("−")).length, 0,
       `and the axis names no negative magnitude on it ` +
       `(${gr.long.ticks.map((t) => t.label).join(" ")})`);

    for (const [who, g] of [["lopsided", gr.lop], ["balanced", gr.two], ["all-long", gr.long]]) {
      for (const t of g.ticks) {
        const d = Math.abs(t.x - g.zeroX);
        const reach = t.label.startsWith("−") ? g.reach.neg : g.reach.pos;
        ok(d <= reach + 2,
           `${who}: the "${t.label}" graduation sits inside the reach of its own side of the ` +
           `book (${d.toFixed(1)} against ${reach.toFixed(1)})`);
      }
    }

    const shortest = Math.max(...lopsided.bars.filter((b) => b.g < 0).map((b) => -b.g), 0);
    const longest = Math.max(...lopsided.bars.map((b) => b.g));
    ok(shortest > 0 && longest > shortest * 100,
       `and the lopsided fixture really is lopsided, so that check is not vacuous ` +
       `(short side peaks at ${shortest.toFixed(0)}, long side at ${longest.toFixed(0)})`);
    ok(gr.lop.negBars > 0, "while still drawing short bars, which is what makes it the harder case");

    for (const t of gr.two.ticks.filter((t) => t.label.startsWith("−"))) {
      const mirror = gr.two.ticks.find((o) => o.label === t.label.replace("−", ""));
      if (!mirror) continue;
      ok(Math.abs((gr.two.zeroX - t.x) - (mirror.x - gr.two.zeroX)) <= 2,
         `${t.label} and ${mirror.label} sit the same distance from zero ` +
         `(${(gr.two.zeroX - t.x).toFixed(1)} against ${(mirror.x - gr.two.zeroX).toFixed(1)})`);
    }

    ok(/log/.test(gr.two.axis), `the axis caption names the scale (${gr.two.axis})`);

    const axisNote = gr.two.notes.find((n) => /LOGARITHMIC/.test(n.text));
    ok(axisNote, "the axis instruction is still on the panel, in full");
    ok(axisNote && /not off bar length|rank/.test(axisNote.text),
       "and it says what to do about it rather than only naming the scale");

    ok(gr.two.negBars > 0, "the two-sided fixture draws short bars");
    eq(gr.two.hatches, gr.two.negBars,
       "every short bar carries the texture that encodes its sign without hue");
    ok(gr.two.negFill && !/url\(/.test(gr.two.negFill),
       `and the bar underneath is a solid fill, not the pattern itself, so both signs ` +
       `carry the same ink for the same number (${gr.two.negFill})`);

    eq(gr.two.plateRects, 0,
       "the level readouts are annotations in the rail, not plates floating over the plot");
    ok(gr.two.plotL !== null, "the price rail is measurable");
    ok(gr.two.vb - gr.two.plotR < gr.two.plotR - gr.two.plotL,
       `the annotation column is narrower than the chart it annotates ` +
       `(rail ${gr.two.vb - gr.two.plotR}, plot ${gr.two.plotR - gr.two.plotL})`);

    for (const p of ["71.89", "70.12"]) {
      ok(!gr.two.prices.includes(p),
         `${p} is labelled once, in the rail, not again in the price ladder ` +
         `(${gr.two.prices.join(" ")})`);
    }

    {
      const span = gr.two.plotBottom - gr.two.plotTop;
      const ys = [gr.two.plotTop, ...gr.two.priceYs, gr.two.plotBottom];
      let worst = 0;
      for (let i = 1; i < ys.length; i++) worst = Math.max(worst, ys[i] - ys[i - 1]);
      ok(worst <= span * 0.22,
         `no stretch of the price rail runs unlabelled ` +
         `(worst gap ${worst.toFixed(0)} of ${span.toFixed(0)} units, ` +
         `${gr.two.prices.length} labels)`);

      let tightest = Infinity;
      for (let i = 1; i < gr.two.priceYs.length; i++) {
        tightest = Math.min(tightest, gr.two.priceYs[i] - gr.two.priceYs[i - 1]);
      }
      ok(tightest >= 11,
         `and no two prices are drawn on top of each other (closest pair ${tightest} units apart)`);
    }

    eq(gr.two.leads.length, 2,
       `the profile leads on its two findings, each in its own element (${gr.two.leads.length})`);
    ok(/^Dealers are (long|short) gamma immediately below/.test(gr.two.leads[0] || ""),
       `the flip regime is first, and still derived rather than asserted ("${
         (gr.two.leads[0] || "").slice(0, 62)}")`);
    ok(/^Dealer gamma AT SPOT is/.test(gr.two.leads[1] || ""),
       `and how hard dealers sit at spot is second ("${(gr.two.leads[1] || "").slice(0, 48)}")`);
    ok(gr.two.leadBeforeChart,
       "and both come BEFORE the drawing in DOM order — the chart is the evidence for the " +
       "reading rather than its preamble, and a sentence under a 220-unit canvas is below " +
       "the fold on a phone");

    ok(axisNote.inDetails,
       "the axis instruction is behind the panel's own disclosure rather than in the open — " +
       "1,400 characters of how-the-bars-were-drawn is a wall a reader scrolls past");
    ok(!axisNote.open,
       "and shut by default, which is the whole saving; an open <details> is a paragraph");
    ok(/LOGARITHMIC/.test(gr.two.all),
       "and STILL IN textContent with it shut, so a find-in-page and a screen reader's find " +
       "both still reach it — folded is not hidden");
    ok(/How this profile was drawn/.test(gr.two.howSummary),
       `the disclosure names what is under it ("${gr.two.howSummary.trim()}") — a summary ` +
       "that says nothing is a click a reader will not spend");

    ok(/normalised separately from the bars/.test(gr.two.all) && /Distances are in ATR\(14\)/.test(gr.two.all),
       "and the curve-scale and unit sentences survived the move too, in full");

    ok(gr.two.howChrome, "the fold has a summary to operate");
    ok(gr.two.howChrome && /\+/.test(gr.two.howChrome.marker),
       `and a visible closed-state marker on it (${gr.two.howChrome
         && gr.two.howChrome.marker}) — the default triangle is suppressed by the same rule ` +
       "set, so a scoped replacement would leave nothing at all");
    eq(gr.two.howChrome && gr.two.howChrome.cursor, "pointer",
       "the pointer says it is a control");
    eq(gr.two.howChrome && gr.two.howChrome.tab, 0,
       "and it is one tab stop for the whole method set, which a <summary> is for free — " +
       "the alternative this design refused was a tabindex on every explained element");

    const bandNote = gr.two.notes.find((n) => /not the whole book/.test(n.text));
    ok(bandNote, "the band the profile was measured over is still stated");
    ok(bandNote && bandNote.qualifier && !bandNote.inDetails,
       "in the open and marked as a qualifier, with nothing to click — this is the line that " +
       "says the picture may be a page of the book rather than the book");
    for (const n of gr.two.notes) {
      ok(!(n.qualifier && n.inDetails),
         `no qualifier on this panel is folded ("${n.text.slice(0, 50)}") — the split is by ` +
         "whether a note changes what the reading MEANS, never by how long it is");
    }
  }

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
          leads: Array.from(host.querySelectorAll(".fc-reading.is-lead"))
            .map((n) => n.textContent.replace(/\s+/g, " ").trim()),
          quals: Array.from(host.querySelectorAll(".fc-note.is-qualifier"))
            .map((n) => ({ text: n.textContent.replace(/\s+/g, " ").trim(),
                           inDetails: !!n.closest("details") })),
        };
      };
      return { deep: draw(-0.93), shallow: draw(-0.05), absent: draw(null) };
    }, { gp });

    ok(shot.deep.text !== shot.shallow.text,
       "a book 0.93 of peak short at spot and one 0.05 of peak short no longer render identically");
    ok(/0\.93 of/.test(shot.deep.plate),
       `the magnitude is on the spot rule itself (${shot.deep.plate})`);
    ok(/0\.05 of/.test(shot.shallow.plate), "for both readings");

    ok(/0\.93 of this ladder's peak/.test(shot.deep.leads[1] || ""),
       `the at-spot magnitude LEADS the panel ("${(shot.deep.leads[1] || "").slice(0, 60)}")`);
    ok(/share of this ladder's peak rather than a dollar figure/.test(shot.deep.text),
       "and what makes it comparable across names is still said, in the folded method");

    ok(/peak exposure and short/.test(shot.deep.text),
       "with the sign attached to that reading rather than to the flip sentence");
    ok(!/0\.00 of|NaN|undefined/.test(shot.absent.text),
       "a card whose spot lies outside the measured band manufactures no reading");
    ok(/not published on this card/.test(shot.absent.text),
       "and says why the reading is missing");

    ok(/^Where spot sits in the cumulative is not published/.test(shot.absent.leads[1] || ""),
       `the unmeasured at-spot share still LEADS ("${(shot.absent.leads[1] || "").slice(0, 52)}")`);
    ok(!/\d/.test(shot.absent.leads[1] || ""),
       `carrying no digit at all ("${shot.absent.leads[1]}") — a reader who sees a number ` +
       "where a reason belongs has been told something the book never said");
    const edge = shot.absent.quals.find((n) => /edge rung/.test(n.text));
    ok(edge, "and the reason it was withheld is on the panel, verbatim");
    ok(edge && !edge.inDetails,
       "in the open, beside the absence it explains rather than behind a click");
  }

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

  {
    const ladder = [100, 110, 120, 130, 140, 145, 150, 155, 160, 162.5, 165,
                    167.5, 170, 172.5, 175, 180, 185, 190, 200, 210, 220, 240, 260, 270];
    const gaps = ladder.slice(1).map((k, i) => k - ladder[i]);
    ok(Math.max(...gaps) > 3 * Math.min(...gaps),
       `the fixture ladder is genuinely non-uniform (steps ${Math.min(...gaps)} to ` +
       `${Math.max(...gaps)}), so the two mappings CANNOT agree by construction — on a ` +
       "uniform ladder this whole block would pass against the defect it exists to catch");

    const placed = await page.evaluate((ks) => {
      const host = document.getElementById("ftGamma");
      window.__renderGamma(host, {
        status: "ok",
        bars: ks.map((k, i) => ({ k, g: (i % 5) - 2, cum: i - 10 })),
        callWall: 190, putWall: 140, band: [100, 270],
      }, {
        ticker: "T", gammaFlip: 170, panels: {},
        regime: { spotGammaShare: -0.4, flipSide: "short_below", bandMin: 100, bandMax: 270 },
        row: { px: 170 },
      });
      const svg = host.querySelector("svg.gp");
      if (!svg) return null;
      const num = (n, a) => Number(n.getAttribute(a));
      const bars = Array.from(svg.querySelectorAll(".gp-bar"))
        .map((b) => ({ y: num(b, "y") + num(b, "height") / 2 }))
        .sort((a, b) => a.y - b.y);
      const flip = svg.querySelector(".gp-flip");
      return {
        barYs: bars.map((b) => b.y),
        flipY: flip ? num(flip, "y1") : null,
        rows: bars.length,
      };
    }, ladder);

    ok(placed && placed.rows > 0, `the panel drew ${placed ? placed.rows : 0} bars`);

    if (placed && placed.flipY !== null) {
      const idx = ladder.indexOf(170);
      const expected = placed.barYs[placed.barYs.length - 1 - idx];
      const off = Math.abs(placed.flipY - expected);
      ok(off < 1.5,
         `the gamma-flip rule at a price that IS a listed strike lands on that strike's own ` +
         `bar (off by ${off.toFixed(1)}px). Under the linear-on-price mapping it sat ` +
         "4.8 bar rows away, pointing at a different strike entirely");
    }
  }

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
