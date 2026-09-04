/* =============================================================
   flows-ticker-contract.mjs — /flows/ticker/, in a real browser.

   THE PANEL THIS PAGE EXISTS FOR HAD NEVER BEEN DRAWN. Four chain
   panels have been published in every card since the chain leg
   shipped and no renderer touched them, which is a defect no test
   could have caught: every payload assertion passed, every byte was
   on the wire, and the product simply did not show them. The
   registry assertions below are the ones that would have.

   ON FIXTURES. Every card here starts as one the pipeline's OWN
   emitter produced — the rule tests/flows-sections-contract.mjs
   states as "the fixture crosses the wire boundary". Where a state
   does not occur in any emitted card, the fixture is an emitted card
   with ONE NAMED FIELD MUTATED, and the mutation is the point of the
   test. A fixture written from the same assumption as the code
   proves only that the assumption is self-consistent; this repo has
   paid for that five times.
   ============================================================= */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import {
  TICKER_PANELS, TICKER_PANEL_KEYS, SCORE_KEY, TICKER_GROUPS, PANEL_TIERS,
} from "../shared/flows-panels.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* ---------- fixtures: real emitted cards ------------------------- */

/* The emitter writes one file per card. Running it here rather than
   committing a fixture is what keeps "the fixture crosses the wire boundary"
   true as the payload evolves — a committed card would freeze the schema of
   the day it was captured. */
const EMIT_DIR = path.join(ROOT, "tests", ".ticker-emit");
fs.rmSync(EMIT_DIR, { recursive: true, force: true });
fs.mkdirSync(EMIT_DIR, { recursive: true });
const { execFileSync } = await import("node:child_process");
execFileSync(process.execPath,
  [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", EMIT_DIR + "/"],
  { stdio: "ignore" });

const cards = fs.readdirSync(EMIT_DIR)
  .filter((f) => f.startsWith("-card-"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(EMIT_DIR, f), "utf8")));
ok(cards.length >= 5, `the emitter produced ${cards.length} cards to test against`);

const withChain = cards.filter((c) =>
  TICKER_PANEL_KEYS.every((k) => c.panels && c.panels[k]) &&
  ["ivSurface", "skewTerm", "topContracts", "aggressor"]
    .every((k) => c.panels[k].status === "ok"));
ok(withChain.length > 0,
   `at least one emitted card carries all four chain panels (${withChain.length} do)`);

const truncated = cards.filter((c) =>
  c.panels && c.panels.ivSurface && c.panels.ivSurface.coverage &&
  c.panels.ivSurface.coverage.truncated === true);

/* ---------- 1. registry integrity, before any browser ------------- */
{
  /* THE DRAW TABLE AND THE REGISTRY MUST NAME THE SAME PANELS, in both
     directions. A drawer with no registry entry never mounts and is dead code
     nobody notices; a registry entry with no drawer is a panel that renders a
     visible "no renderer is registered" notice, which is survivable but is a
     bug. Parsed from the source because DRAW lives inside the controller's
     IIFE — the invariant is a source-level one, and reading it out of a
     running page would only prove the page ran. */
  const src = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
  const block = src.slice(src.indexOf("const DRAW = {"));
  const drawBody = block.slice(0, block.indexOf("\n  };"));
  const drawKeys = new Set(
    [...drawBody.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]));

  const regKeys = new Set(TICKER_PANELS.map((p) => p.key));
  for (const k of regKeys) {
    ok(drawKeys.has(k), `registry panel "${k}" has an entry in the controller's DRAW table`);
  }
  for (const k of drawKeys) {
    ok(regKeys.has(k), `DRAW entry "${k}" is a panel the registry actually mounts`);
  }
  eq(drawKeys.size, regKeys.size, "the two panel lists are the same size");

  /* Every registry key other than the score sentinel names a real payload
     panel. This is the assertion that would have caught four published,
     served, undrawn panels. */
  for (const card of withChain) {
    for (const k of TICKER_PANEL_KEYS) {
      ok(Object.hasOwn(card.panels, k),
         `${card.ticker}: the emitted card carries panel "${k}"`);
    }
  }
  ok(!TICKER_PANEL_KEYS.includes(SCORE_KEY),
     "the score sentinel is excluded from the payload-key list, since it is drawn from the card's top level");

  /* ---------- AND THE OTHER DIRECTION, which is the one that was missing.

     The assertion above catches a registry entry with no payload behind it.
     It does NOT catch the reverse — a panel the pipeline publishes on every
     card that no registry entry mounts — and that is the failure this file's
     own header describes: four chain panels shipped for weeks, on the wire,
     costing vendor calls, and simply not drawn.

     It happened again while this suite was passing. `vanna`, `charm` and
     `deltaExposure` were added to buildCard, published on every emitted card,
     and reached no page. Nothing failed, because nothing looked this way.

     A panel may be published and undrawn only by being named below, with a
     reason. That keeps the omission an argued decision rather than the silent
     default it was. The list is empty today and that is the point: every
     panel this pipeline pays for is on a page. */
  const DELIBERATELY_UNDRAWN = new Map([
    /* e.g. ["someKey", "why the ticker page is not where this belongs"] */
  ]);
  for (const card of withChain) {
    for (const key of Object.keys(card.panels)) {
      if (DELIBERATELY_UNDRAWN.has(key)) continue;
      ok(TICKER_PANEL_KEYS.includes(key),
         `${card.ticker}: published panel "${key}" is mounted by the registry — a panel on ` +
         `the wire that no page draws is a vendor call nobody reads`);
    }
  }
  for (const [key, why] of DELIBERATELY_UNDRAWN) {
    ok(typeof why === "string" && why.length > 20,
       `the exemption for "${key}" states a real reason rather than a placeholder`);
    ok(!TICKER_PANEL_KEYS.includes(key),
       `and "${key}" is genuinely not in the registry — a stale exemption is a comment ` +
       `that has stopped being true`);
  }

  /* Ids are unique, or getElementById silently returns the first and one
     panel draws into another's box. */
  const ids = TICKER_PANELS.map((p) => p.id);
  eq(new Set(ids).size, ids.length, "every registry id is unique");
  for (const p of TICKER_PANELS) {
    ok(p.question && p.question.trim().length > 8, `panel "${p.key}" states a real question`);
    ok(p.title && p.title.trim().length > 2, `panel "${p.key}" has a title`);
    ok(p.span === 1 || p.span === 2, `panel "${p.key}" has a legal span`);
  }

  /* THE ALIGNMENT REQUIREMENT AND THE LAYOUT MUST NOT MAKE EACH OTHER
     IMPOSSIBLE. The term line's j-th bar centre has to coincide with the
     surface's j-th column centre, which can only hold if the two panels mount
     at the SAME host width — so both must be span 2 and adjacent. At span 1
     and span 2 the hosts are 424px and 896px at a 1216px viewport and no
     amount of arithmetic in either drawer could align them. */
  const iIvs = TICKER_PANELS.findIndex((p) => p.key === "ivSurface");
  const iTerm = TICKER_PANELS.findIndex((p) => p.key === "skewTerm");
  eq(TICKER_PANELS[iIvs].span, 2, "the IV surface spans both columns");
  eq(TICKER_PANELS[iTerm].span, 2, "and so does the term line, or they can never align");
  eq(iTerm, iIvs + 1, "and they are adjacent, so they mount at the same width");

  /* THE THREE WAVE-2 STOCK PANELS ARE SINGLE-COLUMN BY CONTRACT: the
     landscape tiers (two columns at 76rem, three at 110rem) slot them as
     single cells, and a span-2 entry here would silently re-argue that
     layout from the registry. */
  for (const key of ["darkpool", "oiDeltas", "volContext"]) {
    const p = TICKER_PANELS.find((x) => x.key === key);
    ok(p, `the registry mounts the ${key} panel`);
    eq(p.span, 1, `${key} is a single-column panel at every landscape tier`);
  }

  /* The pipeline's shed ladder drops panels by key when a card is over the
     100KB self-check. A key it can shed that the registry does not mount
     would be shed into a panel nobody draws. */
  const pipe = fs.readFileSync(path.join(ROOT, "scripts/flows-pipeline.mjs"), "utf8");
  const shedBlock = pipe.slice(pipe.indexOf("dropped to fit the payload cap") - 400,
                               pipe.indexOf("shed ") + 200);
  for (const m of shedBlock.matchAll(/\[\s*"([a-zA-Z]+)",\s*"dropped to fit/g)) {
    ok(regKeys.has(m[1]), `the pipeline's shed ladder only names registry panels ("${m[1]}")`);
  }
}

/* ---------- the browser ------------------------------------------ */

const pageHTML = FLOWS_PAGES.tickerPage({ username: "test" })
  .replace(/<script[^>]*><\/script>/g, "");
const panelsSrc = fs.readFileSync(path.join(ROOT, "assets/js/flows-panels.js"), "utf8");
const tickerSrc = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");

/**
 * Mount the real page markup, stub the two fetches, and let the real
 * controller paint a real card.
 *
 * THE FETCH IS STUBBED, NOT THE CONTROLLER. Feeding a card straight into a
 * private paint() hook would skip readTicker, the 401 branch, the pending
 * discrimination and the header wiring — every part of this file that decides
 * WHICH state the reader gets. The stub answers the two real endpoints.
 */
async function mount(page, card, { ticker = null, boards = null, hash = "", events = null } = {}) {
  await page.addInitScript(({ card, boards, events }) => {
    window.__requested = [];
    window.fetch = (url) => {
      window.__requested.push(String(url));
      /* THE TWO SIDES ARE DIFFERENT REQUESTS, and answering both with the
         same payload double-counts every name in the picker — which is a
         defect in this stub, not in the page. `boards` stands for the LONG
         side; the short side answers empty unless a test says otherwise. */
      const u = String(url);
      /* THE FUNNEL IS ITS OWN ENDPOINT and must be answered as one: it carries
         no "side", so without this arm it fell through to the short board and
         answered every gated-name question with an empty board payload. */
      const body = u.includes("/api/flows/card")
        ? card
        : u.includes("/api/flows/events")
          ? (events || { rows: [], status: "pending" })
          : (u.includes("side=long") ? (boards || { rows: [], status: "pending" })
                                     : { rows: [], status: "pending" });
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => String(Date.now()) },
        json: () => Promise.resolve(JSON.parse(JSON.stringify(body))),
      });
    };
  }, { card, boards, events });
  /* THE HASH IS PART OF THE URL THE READER WAS SENT, so it has to be on the
     goto rather than assigned afterwards: the controller reads it once the
     card has painted, and a hash set after load would test a different code
     path from the one a pasted link exercises. */
  const url = "https://example.test/flows/ticker/" +
    (ticker ? "?t=" + encodeURIComponent(ticker) : "") +
    (hash ? "#" + hash : "");
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: pageHTML }));
  await page.goto(url);
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/base.css") });
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/flows.css") });
  await page.addScriptTag({ content: panelsSrc });
  await page.addScriptTag({ content: tickerSrc });
  await page.waitForFunction(() => {
    const g = document.getElementById("ftGrid");
    return g && (!g.hidden || document.getElementById("ftStatus").textContent !== "Loading the name…");
  }, null, { timeout: 5000 });
}

/** Every panel's rendered state, read out of the DOM rather than from source. */
function sweepPanels() {
  const out = [];
  for (const section of document.querySelectorAll(".ft-panel[data-panel]")) {
    const host = section.querySelector("div");
    /* DECORATIVE SVGs ARE EXCLUDED, and the exclusion is the aria-hidden
       attribute the markup already sets rather than a size heuristic. The
       path panel's legend swatches are 26x10 marks that mean nothing on
       their own and are correctly hidden from the accessibility tree; an
       aria-label on one would make a screen reader announce a colour chip. */
    const svgs = [...host.querySelectorAll("svg")]
      .filter((s) => s.getAttribute("aria-hidden") !== "true");
    const decorative = [...host.querySelectorAll('svg[aria-hidden="true"]')];
    let minText = Infinity, clipped = false;
    for (const svg of svgs) {
      const box = svg.getBoundingClientRect();
      for (const t of svg.querySelectorAll("text")) {
        const r = t.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.height > 0) minText = Math.min(minText, r.height);
        /* TWO PIXELS, not zero. Text metrics carry sub-pixel rounding and a
           glyph's ink box is not its advance box, so a strict edge test
           reports overhang on captions that are visually flush. */
        if (r.left < box.left - 2 || r.right > box.right + 2) clipped = true;
      }
    }
    out.push({
      key: section.dataset.panel,
      question: section.dataset.question || "",
      dead: !!host.querySelector(".fc-dead"),
      empty: host.childElementCount === 0,
      wide: section.classList.contains("is-wide"),
      boxW: Math.round(section.getBoundingClientRect().width),
      minText: minText === Infinity ? null : Math.round(minText * 10) / 10,
      clipped,
      scales: svgs.map((s) => {
        const vb = (s.getAttribute("viewBox") || "").split(/\s+/);
        return [Number(vb[2]), Math.round(s.getBoundingClientRect().width),
                getComputedStyle(s).transform];
      }),
      labelled: svgs.every((s) => !!s.getAttribute("aria-label") && s.getAttribute("role") === "img"),
      unlabelled: svgs.filter((s) => !s.getAttribute("aria-label")).length,
      svgCount: svgs.length,
      /* A decorative mark must carry NEITHER a role nor a label, or it is
         announced twice — once as itself and once as part of its caption. */
      decorativeClean: decorative.every(
        (s) => !s.getAttribute("aria-label") && s.getAttribute("role") !== "img"),
    });
  }
  return out;
}

const browser = await chromium.launch();
try {
  /* ---------- 2. every panel renders, at all three widths ---------- */
  /* 1840px is past the 110rem tier, where the grid opens its third column;
     every assertion in this loop — no clipped type, no sideways scroll, one
     viewBox unit one CSS pixel — must hold there too. */
  for (const width of [320, 1280, 1840]) {
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });

    eq(errors.length, 0, `${width}px: the ticker page paints a real card without throwing (${errors.join("; ")})`);

    const swept = await page.evaluate(sweepPanels);
    eq(swept.length, TICKER_PANELS.length, `${width}px: every registry panel is mounted`);

    for (const p of swept) {
      /* NO PANEL IS SILENTLY BLANK. An empty host is neither a chart nor an
         explanation — it is the one state a reader cannot tell from a broken
         page, and it is exactly what an unhandled tagged-union branch makes. */
      ok(!p.empty, `${width}px ${p.key}: renders content or an explicit unavailable notice`);
      ok(p.question.length > 0, `${width}px ${p.key}: its question reached the DOM`);
      if (p.dead) continue;

      if (p.minText !== null) {
        ok(p.minText >= 8,
           `${width}px ${p.key}: axis type renders at its intended size (${p.minText}px)`);
      }
      eq(p.clipped, false, `${width}px ${p.key}: draws no text outside its own canvas`);
      if (p.svgCount) {
        ok(p.labelled,
           `${width}px ${p.key}: every non-decorative chart carries role=img and an ` +
           `aria-label (${p.unlabelled} without one)`);
      }
      ok(p.decorativeClean,
         `${width}px ${p.key}: decorative marks stay out of the accessibility tree`);

      /* ONE VIEWBOX UNIT IS ONE CSS PIXEL. A viewBox fixed in absolute units
         under width:100% scales the type down with the drawing — 9px axis
         type became 4.6 CSS px on the card panels, silently, because nothing
         overflows when everything shrinks together. */
      for (const [vb, rendered, transform] of p.scales) {
        ok(vb > 0, `${width}px ${p.key}: the chart declares a viewBox width`);
        const ratio = rendered / vb;
        ok(ratio > 0.85 && ratio < 1.15,
           `${width}px ${p.key}: one viewBox unit is one CSS pixel (${ratio.toFixed(3)})`);
        eq(transform, "none", `${width}px ${p.key}: the chart is drawn, never CSS-scaled`);
      }
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, `${width}px: the page itself never scrolls sideways (${overflow}px over)`);

    /* THE WIDE PANELS REALLY SPAN, above the breakpoint. Below it every panel
       is one column and the comparison is meaningless. */
    if (width >= 1280) {
      const wide = swept.filter((p) => p.wide);
      const narrow = swept.filter((p) => !p.wide);
      ok(wide.length > 0 && narrow.length > 0, "1280px: the grid mixes wide and narrow panels");
      const narrowW = Math.max(...narrow.map((p) => p.boxW));
      for (const p of wide) {
        ok(p.boxW > narrowW * 1.8,
           `1280px ${p.key}: is-wide really spans both columns (${p.boxW} vs ${narrowW})`);
      }
      /* The alignment precondition, measured rather than assumed. */
      const ivs = swept.find((p) => p.key === "ivSurface");
      const term = swept.find((p) => p.key === "skewTerm");
      ok(Math.abs(ivs.boxW - term.boxW) <= 1,
         `1280px: the surface and the term line mount at the same width (${ivs.boxW} vs ${term.boxW})`);

      /* THE COLUMNS THEMSELVES LINE UP — and the assertion is written the way
         it is because the obvious form of it is ILL-FORMED on the case this
         page was built for.

         The spec claimed skewTerm.points IS ivSurface.expiries in the same
         order, citing shared/flows-chain.js, where it is true. The PIPELINE
         then splices two different calls together: on a truncated chain it
         keeps the broad-call ivSurface and replaces skewTerm wholesale with a
         second single-expiry read (flows-pipeline.mjs, the recovery leg). The
         two panels stop sharing a column list at exactly that point —
         measured, freshly emitted: 8 surface expiries against 1 term point.
         A per-index sweep of both arrays is then comparing different things,
         not failing.

         So the term drawer borrows the surface's column POSITIONS by matching
         expiry, never its levels, and what is asserted here is what a reader
         can actually see: every term column centre sits on a surface column
         centre. On the spliced card that is one marker under the right
         column; on a clean card it is all of them. */
      const align = await page.evaluate(() => {
        const xs = (sel, attr) => [...document.querySelectorAll(sel)]
          .map((n) => Number(n.getAttribute(attr)))
          .filter((v) => Number.isFinite(v));
        return {
          surface: xs('.ft-panel[data-panel="ivSurface"] text.fts-exp', "x"),
          term: xs('.ft-panel[data-panel="skewTerm"] .ftm-dot', "cx"),
        };
      });
      ok(align.surface.length > 0, "1280px: the surface draws column heads to align against");
      if (align.term.length) {
        for (const cx of align.term) {
          const nearest = Math.min(...align.surface.map((x) => Math.abs(x - cx)));
          ok(nearest <= 1,
             `1280px: a term marker at ${cx.toFixed(1)} sits on a surface column ` +
             `(nearest ${nearest.toFixed(2)}px)`);
        }
      }
    }

    /* THE 110rem TIER. The shell caps content at 78rem, so the third column
       buys DENSITY rather than width: three tracks inside the same content
       box, every span-1 host still above the 300 chart floor, and .is-wide
       still `1 / -1` across all three — the same span rule, not a new one. */
    if (width >= 1840) {
      const tracks = await page.evaluate(() =>
        getComputedStyle(document.getElementById("ftGrid")).gridTemplateColumns
          .split(" ").filter((t) => parseFloat(t) > 0).length);
      eq(tracks, 3, `${width}px: the grid opens its third column at the 110rem tier`);
    }
    await page.close();
  }

  /* ---------- 3. the minus sign, on numbers only ------------------ */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });
    /* SCOPED TO NUMERIC STRINGS. A page-wide "contains no U+002D" assertion is
       UNSATISFIABLE here: every expiry is an ISO date and the surface prints
       `expiry.slice(5)` = "08-31", so 57 of 115 strings in a real card carry
       an ASCII hyphen legitimately. A guaranteed-red assertion gets deleted,
       not fixed. */
    const bad = await page.evaluate(() => {
      const out = [];
      const numeric = /^[−+-]?[\d.,]+\s*[%σd]?$/;
      const nodes = [...document.querySelectorAll(".ft-panel .c-num, .ft-panel .fc-reading"),
                     ...document.querySelectorAll(".ft-panel svg text")];
      for (const n of nodes) {
        const t = (n.textContent || "").trim();
        if (!t || !numeric.test(t)) continue;
        if (t.includes("-")) out.push(t);
      }
      return out;
    });
    eq(bad.length, 0, `every numeric cell uses U+2212, not a hyphen (${bad.slice(0, 5).join(", ")})`);
    await page.close();
  }

  /* ---------- 4. the enlarge dialog redraws, and never shrinks ----- */
  for (const width of [1280, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });

    for (const key of ["aggressor", "ivSurface"]) {
      const section = TICKER_PANELS.find((p) => p.key === key);
      const gridW = await page.evaluate((k) => {
        const s = document.querySelector('.ft-panel[data-panel="' + k + '"] svg');
        return s ? Number((s.getAttribute("viewBox") || "0 0 0 0").split(/\s+/)[2]) : 0;
      }, key);
      if (!gridW) continue;

      await page.click('.ft-panel[data-panel="' + key + '"] .ft-zoom-open');
      await page.waitForFunction(
        () => document.querySelectorAll("#ftZoomHost svg").length > 0, null, { timeout: 3000 });
      const zoomed = await page.evaluate(() => {
        const s = document.querySelector("#ftZoomHost svg");
        const vb = Number((s.getAttribute("viewBox") || "0 0 0 0").split(/\s+/)[2]);
        return { vb, rendered: Math.round(s.getBoundingClientRect().width),
                 transform: getComputedStyle(s).transform };
      });

      /* SPAN-AWARE, because a flat 2x threshold FAILS BY CONSTRUCTION on
         exactly the two panels the button matters most for: an is-wide grid
         panel is already 896px and the dialog host is ~1113px, a 1.24x gain
         that is real and is not two. */
      if (section.span === 1) {
        ok(zoomed.vb >= gridW * 2,
           `${width}px ${key}: a span-1 panel at least doubles when enlarged (${gridW} to ${zoomed.vb})`);
      } else {
        ok(zoomed.vb > gridW,
           `${width}px ${key}: a span-2 panel still grows when enlarged (${gridW} to ${zoomed.vb})`);
      }
      /* ENLARGE MUST NEVER SHRINK. With width:min(74rem,96vw) the dialog host
         is 1129.6px while an is-wide grid panel at >=1328px is 1136px — the
         button would have made the two widest panels SMALLER. */
      ok(zoomed.vb >= gridW,
         `${width}px ${key}: enlarging never shrinks the drawing (${gridW} to ${zoomed.vb})`);
      /* showModal() on a display:none element gives clientWidth 0 in the same
         tick, so a drawer called without the rAF floors to 300. */
      ok(zoomed.vb > 400, `${width}px ${key}: the zoom draw did not floor to the 300 minimum`);
      /* THE SPAN-INDEPENDENT ANTI-transform:scale() TEST. A scaled
         implementation gives a ratio near 2.6 and a non-none transform, and
         passes every other assertion in this suite. */
      const ratio = zoomed.rendered / zoomed.vb;
      ok(ratio > 0.85 && ratio < 1.15,
         `${width}px ${key}: the enlarged chart is redrawn, not scaled (${ratio.toFixed(3)})`);
      eq(zoomed.transform, "none", `${width}px ${key}: no CSS transform on the enlarged chart`);

      /* EVERY <defs> ID IS UNIQUE WHILE BOTH COPIES EXIST. url(#id) resolves
         to the first match in document order, so a duplicated pattern id
         silently gives the zoomed drawing the grid drawing's tile. */
      const dup = await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map((n) => n.id);
        const seen = new Set(), dupes = [];
        for (const id of ids) { if (seen.has(id)) dupes.push(id); seen.add(id); }
        return dupes;
      });
      eq(dup.length, 0,
         `${width}px ${key}: no id is duplicated while the zoom dialog is open (${dup.join(", ")})`);

      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.getElementById("ftZoom").open, null, { timeout: 2000 });
    }
    eq(errors.length, 0, `${width}px: the enlarge cycle throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 5. the three page-level states --------------------- */
  {
    /* NO NAME IS THE INDEX, NOT AN ERROR — and it must not fetch a card. */
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, withChain[0], {
      ticker: null,
      boards: { rows: [{ t: "AAA", r: 1, s: 42, dp: 1 }, { t: "BBB", r: 2, s: 30, dp: 0 }] },
    });
    const state = await page.evaluate(() => ({
      status: document.getElementById("ftStatus").textContent,
      pickerShown: !document.getElementById("ftPicker").hidden,
      gridShown: !document.getElementById("ftGrid").hidden,
      rows: document.querySelectorAll("#ftPickerBody tr").length,
      requested: window.__requested.slice(),
    }));
    ok(state.pickerShown, "with no ?t= the page shows the picker");
    ok(!state.gridShown, "and hides the panel grid");
    ok(!state.status.toLowerCase().includes("error"), "and calls it a choice, not an error");
    eq(state.requested.filter((u) => u.includes("/api/flows/card")).length, 0,
       "and spends no card read at all");
    /* A NAME WITH NO CARD GETS NO ROW. A link that usually leads to "no card
       for this name" is worse than no link. */
    eq(state.rows, 1, "only the names with a card are listed (dp:0 is excluded)");
    await page.close();
  }
  {
    /* THE TWO PENDING STATES ARE DIFFERENT FACTS and must read differently. */
    for (const [onBoard, want] of [[true, "has not landed"], [false, "not on today"]]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(page, { status: "pending", ticker: "ZZZ" }, {
        ticker: "ZZZ",
        boards: { rows: onBoard ? [{ t: "ZZZ", r: 1, s: 5, dp: 1 }] : [{ t: "QQQ", r: 1, s: 5, dp: 1 }] },
      });
      const status = await page.evaluate(
        () => document.getElementById("ftStatus").textContent);
      ok(status.includes(want),
         `a pending card ${onBoard ? "on" : "off"} the board says so specifically ("${want}")`);
      await page.close();
    }
  }
  {
    /* ?t=nvda IS THE NVDA PAGE. The Worker uppercases before testing its own
       ticker pattern; routing lowercase to "choose a name" would break every
       hand-typed URL and contradict the deep link the dialog already ships. */
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const card = withChain[0];
    await mount(page, card, { ticker: String(card.ticker).toLowerCase() });
    const requested = await page.evaluate(() => window.__requested.slice());
    ok(requested.some((u) => u.includes("t=" + card.ticker)),
       "a lowercase ?t= is uppercased and fetched, not sent to the picker");
    await page.close();
  }
  {
    /* A HOSTILE ?t= NEVER REACHES A FETCH. */
    for (const bad of ["../etc", "", "!!!"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(page, withChain[0], { ticker: bad, boards: { rows: [] } });
      const requested = await page.evaluate(() => window.__requested.slice());
      eq(requested.filter((u) => u.includes("/api/flows/card")).length, 0,
         `?t=${JSON.stringify(bad)} is rejected before any fetch`);
      await page.close();
    }
  }

  /* ---------- 6. legacy and unavailable payloads ------------------ */
  {
    /* A CARD FROM BEFORE THE CHAIN LEG carries no ivSurface KEY AT ALL —
       `undefined`, not {status:"unavailable"} — and the two must not be
       conflated: one is a card built before the panel existed, the other is
       this run declining to publish and carrying its own reason. */
    const legacy = JSON.parse(JSON.stringify(withChain[0]));
    delete legacy.panels.ivSurface;
    legacy.panels.aggressor = { status: "unavailable", reason: "the vendor reported no aggressor split." };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, legacy, { ticker: legacy.ticker });
    const said = await page.evaluate(() => ({
      ivs: document.querySelector('.ft-panel[data-panel="ivSurface"] .fc-dead').textContent,
      aggr: document.querySelector('.ft-panel[data-panel="aggressor"] .fc-dead').textContent,
    }));
    ok(said.ivs.includes("before the option chain leg"),
       "an absent panel key says the card predates the panel");
    ok(said.aggr.includes("no aggressor split"),
       "an unavailable panel prints the builder's own reason verbatim");
    eq(errors.length, 0, "neither absence throws");
    await page.close();
  }

  /* ---------- 6b. the three stock panels: readings ----------------- */
  {
    /* THE FIXTURE IS AN EMITTED CARD WITH NAMED FIELDS MUTATED, and each
       mutation is the point of its own test. The emitted corpus carries no
       cancelled print, no null oiUpDays beside real counters on row 0, and
       no pinned rank value — those states are staged by name. */
    const base = withChain.find((c) =>
      c.panels.darkpool.status === "ok" &&
      c.panels.oiDeltas.status === "ok" &&
      c.panels.volContext.status === "ok" &&
      c.panels.volContext.term.status === "ok" &&
      c.panels.volContext.ivRank.status === "ok");
    ok(base, "an emitted card carries all three stock panels with data");
    const card = JSON.parse(JSON.stringify(base));
    card.panels.darkpool.rows[0].canceled = true;          // the tape's cancel flag, staged
    card.panels.oiDeltas.rows[0].oiUpDays = null;          // an unpublished counter, staged
    card.panels.volContext.ivRank.rows[0].rank1y = 57.5;   // a pinned headline the drawer must not rescale
    card.panels.volContext.ivRank.rows[5].rank1y = null;   // a guaranteed gap for the strip

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { ticker: card.ticker });

    const dp = card.panels.darkpool;
    const oi = card.panels.oiDeltas;
    const vc = card.panels.volContext;
    /* The strip's segment count, computed from the payload the way the
       drawer must draw it: oldest first, a segment only between ADJACENT
       measured sessions. The staged null guarantees the count is strictly
       below n − 1, so a drawer that bridges gaps (or zeroes them) fails. */
    const series = vc.ivRank.rows.slice().reverse()
      .map((r) => (typeof r.rank1y === "number" && Number.isFinite(r.rank1y) ? r.rank1y : null));
    let wantSegments = 0;
    for (let i = 0; i + 1 < series.length; i++) {
      if (series[i] !== null && series[i + 1] !== null) wantSegments++;
    }
    ok(wantSegments < series.length - 1,
       "the fixture really carries a gap for the strip to refuse to bridge");

    const got = await page.evaluate(() => {
      const panelOf = (key) =>
        document.querySelector('.ft-panel[data-panel="' + key + '"] > div');
      const text = (root, sel) => {
        const n = root.querySelector(sel);
        return n ? n.textContent : null;
      };
      const dpHost = panelOf("darkpool");
      const oiHost = panelOf("oiDeltas");
      const vcHost = panelOf("volContext");
      /* Everything a panel SAYS, tooltips included, for the vocabulary sweep. */
      const saidBy = (root) => root.textContent + " " +
        [...root.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join(" ");
      return {
        dpRows: dpHost.querySelectorAll(".fdp-table tbody tr").length,
        dpTags: [...dpHost.querySelectorAll(".fdp-tag")].map((n) => n.textContent),
        /* The first TEXT node only: a cancelled row's cell is "HH:MM" plus its
           tag element, and the clock claim is about the clock. */
        dpTimes: [...dpHost.querySelectorAll(".fdp-time")]
          .map((n) => (n.firstChild ? n.firstChild.textContent : "")),
        dpQuotes: [...dpHost.querySelectorAll(".fdp-quote")].map((n) => n.textContent),
        dpCount: text(dpHost, ".fdp-count"),
        dpNotes: [...dpHost.querySelectorAll(".fc-note")].map((n) => n.textContent).join(" "),
        oiContracts: [...oiHost.querySelectorAll(".foi-oc")].map((n) => n.textContent),
        oiChanges: [...oiHost.querySelectorAll(".foi-chg")].map((n) => n.textContent),
        oiStreaks: [...oiHost.querySelectorAll(".foi-streaks")]
          .map((n) => [...n.querySelectorAll(".foi-streak")].map((s) => s.textContent)),
        oiCount: text(oiHost, ".foi-count"),
        oiNotes: [...oiHost.querySelectorAll(".fc-note")].map((n) => n.textContent).join(" "),
        oiSaid: saidBy(oiHost),
        rankHead: text(vcHost, ".fvc-rank"),
        rankN: text(vcHost, ".fvc-rank-n"),
        axisLabels: [...vcHost.querySelectorAll(".fvc-axis")].map((n) => n.textContent),
        dots: vcHost.querySelectorAll(".fvc-dot").length,
        curvePoints: (vcHost.querySelector(".fvc-line") || { getAttribute: () => "" })
          .getAttribute("points"),
        miniRows: vcHost.querySelectorAll(".fvc-mini tbody tr").length,
        miniIvs: [...vcHost.querySelectorAll(".fvc-mini tbody tr td:nth-child(2)")]
          .map((n) => n.textContent),
        segments: vcHost.querySelectorAll(".fvc-spark-l").length,
        sparkDots: vcHost.querySelectorAll(".fvc-spark-d").length,
        vcNotes: [...vcHost.querySelectorAll(".fc-note")].map((n) => n.textContent).join(" "),
        vcSaid: saidBy(vcHost),
      };
    });

    /* --- darkpool: the table is the payload, row for row -------------- */
    eq(got.dpRows, dp.rows.length, "darkpool draws one row per published print");
    ok(got.dpTimes.every((t) => /^\d{2}:\d{2}$/.test(t) || t === "—"),
       `every time cell is HH:MM off the tape's own timestamp (${got.dpTimes[0]})`);
    /* THE CANCEL FLAG HAS ONE HONEST RENDERING: a tag on true, NOTHING on
       false and on null — a "live" badge on the false rows would turn the
       null rows' bare absence into a claim. */
    const wantTags = dp.rows.filter((r) => r.canceled === true).length;
    eq(got.dpTags.length, wantTags, "exactly the cancelled prints carry the tag");
    ok(got.dpTags.every((t) => t === "cancelled"), "and the tag says what the flag says");
    const iBoth = dp.rows.findIndex((r) => r.bid !== null && r.ask !== null);
    const iNone = dp.rows.findIndex((r) => r.bid === null || r.ask === null);
    if (iBoth !== -1) {
      ok(/^\d+\.\d{2} \/ \d+\.\d{2}$/.test(got.dpQuotes[iBoth]),
         `a quoted print shows bid and ask side by side ("${got.dpQuotes[iBoth]}")`);
    }
    if (iNone !== -1) {
      eq(got.dpQuotes[iNone], "—",
         "a print missing either side of the quote shows the dash, never half a spread");
    }
    /* The capped-list line, in the shaper's own numbers. Every emitted card
       sheds and counts out today, so both clauses are exercised. */
    if (dp.shed > 0) {
      ok(got.dpCount && got.dpCount.includes(dp.rows.length + " kept of " + dp.seen),
         `the caption states ${dp.rows.length} kept of ${dp.seen}`);
    }
    if (dp.unpriced > 0) {
      ok(got.dpCount && got.dpCount.includes("+" + dp.unpriced + " unpriced print"),
         "and counts the unpriced prints out rather than seating them");
    }
    ok(got.dpNotes.includes(dp.note.slice(0, 60)),
       "the payload's own darkpool note is rendered, not paraphrased");

    /* --- oiDeltas: signed changes, vendor counters, vendor prose ------- */
    eq(got.oiContracts.length, oi.rows.length, "oiDeltas draws one row per published change");
    ok(/^[CP] [\d.]+ · \d{2}-\d{2}$/.test(got.oiContracts[0]),
       `the contract cell is built from cp, strike and expiry ("${got.oiContracts[0]}")`);
    const iNeg = oi.rows.findIndex((r) => typeof r.change === "number" && r.change < 0);
    if (iNeg !== -1) {
      ok(got.oiChanges[iNeg].startsWith("−"),
         `a negative change leads with U+2212 ("${got.oiChanges[iNeg]}")`);
    }
    const iPos = oi.rows.findIndex((r) => typeof r.change === "number" && r.change > 0);
    if (iPos !== -1) {
      ok(got.oiChanges[iPos].startsWith("+"),
         `a positive change leads with its sign ("${got.oiChanges[iPos]}")`);
    }
    /* Row 0's oiUpDays was staged to null: its ↑OI half is the dash, and its
       V>OI half still renders — a missing counter is not a streak of zero
       and must not take its neighbour down with it. */
    eq(got.oiStreaks[0][0], "—", "a null counter is the dash, never a zero");
    ok(/^\d+d V>OI$/.test(got.oiStreaks[0][1]),
       `while the sibling counter still renders ("${got.oiStreaks[0][1]}")`);
    const iBothStreaks = oi.rows.findIndex((r, i) => i > 0 &&
      typeof r.oiUpDays === "number" && typeof r.volGtOiDays === "number");
    if (iBothStreaks !== -1) {
      ok(/^\d+d ↑OI$/.test(got.oiStreaks[iBothStreaks][0]),
         `a published counter renders as the vendor's own streak ("${got.oiStreaks[iBothStreaks][0]}")`);
    }
    if (oi.shed > 0) {
      ok(got.oiCount && got.oiCount.includes(oi.rows.length + " kept of " + oi.seen),
         "the oiDeltas caption states the capped list");
    }
    ok(got.oiNotes.includes("selection rule"),
       "the vendor-selection caveat reaches the reader from the payload's note");
    ok(got.oiNotes.includes(oi.note.slice(0, 60)),
       "and it is the note verbatim, not a paraphrase");

    /* --- volContext: the rank is NEVER rescaled ------------------------ */
    eq(got.rankN, "57.5",
       "the pinned rank renders as its own number — 0.6 or 5750 here is the rescale " +
       "this vendor's rank fields have already burned once");
    ok(got.rankHead.includes("57.5 / 100"), "and the headline states the unit's ceiling");
    eq(got.dots, vc.term.rows.length, "the term curve dots every listed expiry");
    eq((got.curvePoints || "").split(" ").length, vc.term.rows.length,
       "and the polyline runs through all of them");
    eq(got.axisLabels.length, 2, "the y rail is labelled at min and max");
    ok(got.axisLabels.every((t) => /^\d+%$/.test(t)),
       `both labels are whole percents (${got.axisLabels.join(", ")})`);
    eq(got.miniRows, Math.min(4, vc.term.rows.length),
       "the mini-table holds the first four expiries");
    ok(got.miniIvs.every((t) => /^\d+\.\d%$/.test(t) || t === "—"),
       `mini-table volatilities are percents to one decimal (${got.miniIvs[0]})`);
    /* THE STRIP'S GAPS ARE GAPS. Segment count is computed from the payload
       the way the drawer must draw it; a drawer that bridges a null (or
       draws it at zero) lands on n − 1 and fails by count. */
    eq(got.segments, wantSegments,
       `the rank strip draws a segment only between adjacent measured sessions ` +
       `(${got.segments} of a bridged ${series.length - 1})`);
    ok(got.sparkDots >= 1, "and the newest measured session carries its dot");
    ok(got.vcNotes.includes(vc.note.slice(0, 60)),
       "the volContext note is rendered from the payload");

    /* --- vocabulary: the darkpool words stay in the darkpool panel ----- */
    /* "print"/"trade" are accurate for reported equity executions and are
       allowed THERE; the other two panels describe clearing snapshots and
       quotes, and may not borrow them. The side-attribution words are banned
       in all three by the same refusals the payload's notes state. */
    for (const [key, said] of [["oiDeltas", got.oiSaid], ["volContext", got.vcSaid]]) {
      ok(!/print|trade|bought|sold|buyer|seller|whale|institutional|smart money/i.test(said),
         `${key} never borrows the tape's vocabulary or attributes a side`);
    }
    eq(errors.length, 0, `the stock panels render without throwing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6c. the three stock panels: silences ----------------- */
  {
    /* THE THREE SILENCES, one per panel, same construction as section 6:
       an emitted card with one named mutation each. `undefined` predates
       the deep feeds — a DIFFERENT wave from the chain four, and the
       sentence must date the absence by its own wave. "unavailable"
       carries the builder's reason verbatim. "quiet" is an ordinary
       reading and must not wear the Unavailable banner. */
    const legacy = JSON.parse(JSON.stringify(withChain[0]));
    delete legacy.panels.darkpool;
    legacy.panels.oiDeltas = {
      status: "unavailable", reason: "the feed could not be read this run",
      note: legacy.panels.oiDeltas.note,
    };
    legacy.panels.volContext = {
      status: "quiet",
      term: { status: "quiet", rows: [], seen: 0, cap: 16, shed: 0 },
      ivRank: { status: "quiet", rows: [], seen: 0, cap: 60, shed: 0,
        rankUnit: "percent 0-100, as published" },
      note: legacy.panels.volContext.note,
    };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, legacy, { ticker: legacy.ticker });
    const said = await page.evaluate(() => {
      const host = (key) => document.querySelector('.ft-panel[data-panel="' + key + '"] > div');
      const vc = host("volContext");
      return {
        dark: host("darkpool").querySelector(".fc-dead").textContent,
        oi: host("oiDeltas").querySelector(".fc-dead").textContent,
        vcQuiet: vc.querySelector('[data-empty="quiet"]') !== null,
        vcDead: vc.querySelector(".fc-dead") !== null,
        vcText: vc.textContent,
      };
    });
    ok(said.dark.includes("before the per-name deep feeds"),
       "an absent stock key dates the card by ITS wave, not the chain leg's");
    ok(said.oi.includes("the feed could not be read this run"),
       "an unavailable stock panel prints the builder's reason verbatim");
    ok(said.vcQuiet, "a quiet panel is marked data-empty=quiet");
    ok(!said.vcDead, "and never wears the Unavailable banner");
    eq(errors.length, 0, "none of the three silences throws");
    await page.close();
  }
  {
    /* EACH HALF OF volContext SURVIVES THE OTHER'S ABSENCE — the payload's
       own design ("a name with a curve but no rank history is half a panel,
       not an unavailable one"), asserted from the reader's side. */
    const half = JSON.parse(JSON.stringify(withChain.find((c) =>
      c.panels.volContext.status === "ok" && c.panels.volContext.ivRank.status === "ok")));
    half.panels.volContext.term = { status: "quiet", rows: [], seen: 0, cap: 16, shed: 0 };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, half, { ticker: half.ticker });
    const got = await page.evaluate(() => {
      const vc = document.querySelector('.ft-panel[data-panel="volContext"] > div');
      return {
        termQuiet: vc.querySelector('.fvc-termhalf [data-empty="quiet"]') !== null,
        curve: vc.querySelector(".fvc-line") !== null,
        rank: (vc.querySelector(".fvc-rank") || { textContent: "" }).textContent,
      };
    });
    ok(got.termQuiet, "a quiet term half says so under its own heading");
    ok(!got.curve, "and draws no curve");
    ok(/\/ 100/.test(got.rank), "while the rank half still states its reading");
    eq(errors.length, 0, "the half-silence throws nothing");
    await page.close();
  }

  /* ---------- 6d. the open-interest basis note --------------------

     THE CAPTION USED TO MAKE A CLAIM THE PAYLOAD HAD ALREADY REFUTED.
     It read "ΔOI is open_interest − prev_oi: what stuck overnight, as
     against what churned", which asserts two things the vendor never
     states: that the two open-interest counts bracket the same span as
     the volume, and that the span is one night. describeOiBasis exists
     to test the first, and on a live run it found four of eight
     contracts whose open interest moved further than their own volume —
     which cannot happen across one settlement. The measurement was
     logged and thrown away while the page kept asserting the opposite.

     All three verdicts are staged here because the ASYMMETRY is the
     whole reading: exceeding rows falsify the pairing, while zero
     exceeding rows prove nothing at all. A note that phrased the second
     as reassurance would be the confident inference this panel exists
     to avoid, and it would read as the more natural sentence — which is
     exactly why it needs a test and not a comment. */
  {
    const base = withChain.find((c) => c.panels.topContracts.oiBasis);
    ok(base, "an emitted card carries the basis check on its top-contracts panel");

    const staged = (verdict, seen, exceeded) => {
      const c = JSON.parse(JSON.stringify(base));
      c.panels.topContracts.oiBasis = {
        seen, exceeded, exceedShare: seen ? exceeded / seen : null,
        verdict, minVolume: 250,
      };
      return c;
    };

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const read = async (card) => {
      await mount(page, card, { ticker: card.ticker });
      return page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="topContracts"] > div');
        const note = host.querySelector(".ftt-oibasis");
        const basis = host.querySelector(".ftt-basis");
        return {
          note: note ? note.textContent : null,
          cls: note ? note.className : null,
          empty: note ? note.getAttribute("data-empty") : null,
          caption: basis ? basis.textContent : "",
          /* Everything the ΔOI column says in its tooltips, which is where
             the overnight claim survived longest. */
          doiTitles: [...host.querySelectorAll(".ftt-doi[title]")]
            .map((n) => n.getAttribute("title")).join(" "),
        };
      });
    };

    const falsified = await read(staged("falsified", 105, 4));
    ok(falsified.note, "a falsified check renders a note beside the table");
    ok(/\b4\b/.test(falsified.note) && /\b105\b/.test(falsified.note),
       "carrying both counts, so the reader can see the share for themselves");
    ok(/250/.test(falsified.note),
       "and the volume floor, so '4 of 105' beside a ten-row table is not a contradiction");
    ok(/NOT/.test(falsified.note),
       "and saying plainly that the two counts are not describing the same span");
    ok(!/inconclusive/i.test(falsified.note),
       "a falsification is not hedged: this is the branch that actually proves something");

    const inconclusive = await read(staged("inconclusive", 105, 0));
    ok(/INCONCLUSIVE/.test(inconclusive.note),
       "a zero count says INCONCLUSIVE in the sentence, not merely in a comment");
    ok(/not evidence/i.test(inconclusive.note),
       "and refuses the reading that finding none confirms the pairing");
    ok(!/aligned\.|confirm|verified/i.test(inconclusive.note),
       "with no word that would let a skimming reader take it as reassurance");

    const nodata = await read(staged("no-data", 0, 0));
    eq(nodata.empty, "quiet",
       "and a check that could not run is the MEASURED silence, not a failure");
    ok(/could not be checked/i.test(nodata.note),
       "saying which of the silences it is");

    /* THE CONTRADICTORY PAYLOAD, which is where the first draft of this
       renderer was wrong. A "falsified" verdict whose count is absent fell
       through to the branch that says "none of 105 exceeded" — a confident
       claim about every contract on the chain, built from a number nobody
       read, and the FRIENDLIER of the two available sentences. That is the
       house defect exactly, and it appeared in the code written to fix an
       instance of it, so it is pinned in both directions. */
    const noCount = await read(staged("falsified", 105, null));
    ok(!/none of/i.test(noCount.note),
       "a verdict with no count never falls through to claiming none exceeded");
    eq(noCount.empty, "unavailable",
       "it is a publisher fault and is tagged as one, not as a measured silence");

    const contradictory = await read(staged("falsified", 105, 0));
    ok(!/none of/i.test(contradictory.note),
       "and a falsified verdict carrying zero exceeding rows is not reported as the quiet half " +
       "of its own contradiction");
    eq(contradictory.empty, "unavailable", "that too is a publisher fault");

    /* THE CAPTION ITSELF. The claim is gone from the prose and from every
       tooltip on the column — a note that contradicts the sentence above it
       would leave the reader to pick, and they would pick the shorter one. */
    for (const got of [falsified, inconclusive, nodata, noCount, contradictory]) {
      ok(!/stuck overnight/i.test(got.caption),
         "the caption no longer claims ΔOI is what stuck overnight against what churned");
      ok(!/overnight/i.test(got.doiTitles),
         "and no ΔOI tooltip names a span the vendor never stamped");
    }
    ok(/spacing|whatever span/i.test(falsified.caption),
       "it says instead that the spacing of the two counts is unstated");

    eq(errors.length, 0, "and none of the three verdicts throws");
    await page.close();
  }

  /* ---------- 6e. the conviction arithmetic ------------------------

     THE PANEL SHOWED THE PARTS AND NEVER THE SUM. Conviction is a weighted
     blend of agreement, source coverage and persistence; this list published
     two of those three terms and the weights lived only in
     shared/flows-features.js, so a reader could see 67%, 5-of-5 and a
     conviction of 76 with no way to connect them — and the missing third
     term could move the composite eleven points with nothing on the card
     accounting for it.

     The line is drawn ONLY when the terms reconstruct the published number.
     An identity that does not close is worse than no identity, because it
     invites trust in a derivation the numbers do not support — so the
     broken cases below must render nothing rather than something wrong. */
  {
    const base = withChain.find((c) => c.conv && c.conv.weights &&
      isFinite(c.conviction) && c.conv.persistence !== null);
    ok(base, "an emitted card carries the full conviction decomposition");

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const readMath = async (card) => {
      await mount(page, card, { ticker: card.ticker });
      return page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="__score"] > div');
        const math = host.querySelector(".fc-conv-math");
        return { math: math ? math.textContent : null, said: host.textContent };
      });
    };

    const good = await readMath(base);
    ok(good.math, "the arithmetic is stated beside the terms it uses");
    ok(good.math.includes("Conviction " + base.conviction),
       "naming the published composite, so the reader knows which number is being explained");
    /* THE WEIGHTS COME FROM THE PAYLOAD. A renderer restating 0.45/0.35/0.20
       in its own prose is a second copy of a constant that has already moved
       once, and on the day it moves again the page describes arithmetic the
       pipeline did not do — the sector-momentum defect, in prose. */
    for (const [k, w] of Object.entries(base.conv.weights)) {
      ok(good.math.includes(Math.round(w * 100) + "%"),
         `the ${k} weight is the payload's own (${Math.round(w * 100)}%), not a copy in the renderer`);
    }
    ok(/persistence/i.test(good.said),
       "and persistence, the term this panel never showed, is in the stat list");
    ok(/COUNT/.test(good.math) && /steps/.test(good.math),
       "the note says agreement is a count that steps, which is why two nearby " +
       "convictions can differ by a whole axis");

    /* THREE WAYS FOR IT NOT TO CLOSE, and none may draw a line. */
    const mutate = (fn) => { const c = JSON.parse(JSON.stringify(base)); fn(c); return c; };
    const broken = await readMath(mutate((c) => { c.conviction = c.conviction + 7; }));
    ok(!broken.math,
       "a composite the terms do not reconstruct draws no arithmetic at all");
    const noPer = await readMath(mutate((c) => { c.conv.persistence = null; }));
    ok(!noPer.math, "nor does a card missing the third term");
    const noWeights = await readMath(mutate((c) => { delete c.conv.weights; }));
    ok(!noWeights.math, "nor a card published before the weights shipped");
    ok(/Conviction/.test(noWeights.said),
       "though the composite itself still prints — losing the derivation is not losing the number");

    eq(errors.length, 0, "and none of the four states throws");
    await page.close();
  }

  /* ---------- 6f. the score laid over the price -------------------

     THE CHART THE DIRECTIVE ASKED FOR, and the one whose failure mode is
     invisible: two ~40-point series zipped by position draw a smooth,
     plausible, entirely fictional line. The join is tested in
     tests/flows-overlay-contract.mjs against a fixture built to break an
     index join; what is tested HERE is that the drawing tells the truth
     about what the join returned — above all that a gap breaks the line
     rather than being bridged or zeroed. */
  {
    const base = withChain.find((c) =>
      c.panels.scoreOverlay && c.panels.scoreOverlay.status === "ok" &&
      c.panels.scoreOverlay.rows.length >= 6);
    ok(base, "an emitted card carries a joined score overlay");

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const readOvl = async (card) => {
      await mount(page, card, { ticker: card.ticker });
      return page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="scoreOverlay"] > div');
        const svg = host.querySelector("svg.ovl");
        const score = host.querySelector(".ovl-score");
        return {
          hasSvg: !!svg,
          viewBox: svg ? svg.getAttribute("viewBox") : null,
          par: svg ? svg.getAttribute("preserveAspectRatio") : null,
          box: svg ? (({ width, height }) => ({ width, height }))(svg.getBoundingClientRect()) : null,
          scoreD: score ? score.getAttribute("d") : null,
          dots: host.querySelectorAll(".ovl-dot").length,
          band: !!host.querySelector(".ovl-band"),
          said: host.textContent,
          aria: svg ? svg.getAttribute("aria-label") : null,
          empty: [...host.querySelectorAll("[data-empty]")].map((n) => n.getAttribute("data-empty")),
        };
      });
    };

    const good = await readOvl(base);
    ok(good.hasSvg, "the overlay draws a chart");
    eq(good.par, "xMidYMid meet",
       "with the aspect ratio that keeps one viewBox unit at one CSS pixel — `none` " +
       "scales the axes independently and distorts every slope on the panel");
    /* THE REPOSITORY'S CHART INVARIANT, measured from the visible host. */
    const vbW = Number(good.viewBox.split(/\s+/)[2]);
    const ratio = good.box.width / vbW;
    ok(Math.abs(ratio - 1) < 0.02,
       `one viewBox unit is one CSS pixel (drawn ${vbW}, laid out ${good.box.width.toFixed(1)}, ` +
       `ratio ${ratio.toFixed(3)})`);
    ok(/\bM/.test(good.scoreD), "the score line is drawn");
    ok(good.aria && /sessions from/.test(good.aria),
       "and the chart names its own window to a screen reader");

    /* ---- THE GAP. A hole must break the path, not bridge it. ---- */
    const holed = JSON.parse(JSON.stringify(base));
    const mid = Math.floor(holed.panels.scoreOverlay.rows.length / 2);
    holed.panels.scoreOverlay.rows[mid].score = null;
    holed.panels.scoreOverlay.scored -= 1;
    holed.panels.scoreOverlay.gaps += 1;
    const gapped = await readOvl(holed);
    const moveCount = (d) => (d.match(/M/g) || []).length;
    eq(moveCount(gapped.scoreD), moveCount(good.scoreD) + 1,
       "a hole in the middle splits the score path into one more subpath — the line " +
       "BREAKS rather than bridging a session nobody scored");
    ok(/no score/i.test(gapped.said),
       "and the panel says in words how many sessions carry no score");

    /* ---- A LONE SCORED SESSION BETWEEN TWO HOLES. A one-point subpath has
       no length and renders as nothing at all, so a real measurement would
       simply vanish. It gets a dot instead. ---- */
    const island = JSON.parse(JSON.stringify(base));
    const rows = island.panels.scoreOverlay.rows;
    for (let i = 0; i < rows.length; i++) if (i !== 2) rows[i].score = null;
    island.panels.scoreOverlay.scored = 1;
    island.panels.scoreOverlay.gaps = rows.length - 1;
    const lone = await readOvl(island);
    eq(lone.dots, 1, "a scored session with holes on both sides is drawn as a dot, not lost");

    /* ---- A ZERO IS A READING, NOT A HOLE. ---- */
    const zeroed = JSON.parse(JSON.stringify(base));
    zeroed.panels.scoreOverlay.rows[mid].score = 0;
    const atZero = await readOvl(zeroed);
    eq(moveCount(atZero.scoreD), moveCount(good.scoreD),
       "a measured zero does NOT break the line: it is a name sitting at neutral, " +
       "which is a reading this system publishes and means");

    /* ---- THE TWO EMPTY STATES, which are not the same sentence. ---- */
    const disjoint = JSON.parse(JSON.stringify(base));
    disjoint.panels.scoreOverlay = {
      status: "quiet",
      reason: "the price window and the score window do not share a single session",
      priceSpan: { from: "2027-01-04", to: "2027-03-01", sessions: 42 },
      scoreSpan: { from: "2026-08-03", to: "2026-08-24", sessions: 16 },
      overlap: 0,
    };
    const noOverlap = await readOvl(disjoint);
    ok(!noOverlap.hasSvg, "disjoint windows draw no chart");
    ok(noOverlap.empty.includes("quiet"),
       "and are tagged as the MEASURED silence: both windows were read in full");

    const absent = JSON.parse(JSON.stringify(base));
    absent.panels.scoreOverlay = {
      status: "unavailable",
      reason: "the score track was not assembled this run",
    };
    const noTrack = await readOvl(absent);
    ok(noTrack.empty.includes("unavailable"),
       "while a track that was never assembled is the pipeline-side absence, tagged " +
       "differently — a reader must be able to tell a skipped leg from a name that " +
       "was never on a board");

    eq(errors.length, 0, `the overlay renders without throwing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6g. the second-order Greeks -------------------------

     PAID FOR, PUBLISHED, AND INVISIBLE until now. These three come off a
     vendor call the pipeline was already making, and they sat on every card
     with no renderer — the same failure the four chain panels had, repeated
     while this suite was green, because nothing asserted the payload→registry
     direction. That assertion now exists in §1; this section checks the
     drawing.

     THE SIGN CONVENTION IS THE THING TO GET RIGHT. The payload says the
     vendor's put leg is dealer-signed against its call leg for gamma and
     charm and is NOT for vanna — on the same endpoint. So the two legs must
     never be netted, and this proves the renderer does not net them by
     counting the bars. */
  {
    const base = withChain.find((c) =>
      ["vanna", "charm", "deltaExposure"].every((k) =>
        c.panels[k] && c.panels[k].status === "ok" && c.panels[k].rows.length >= 2));
    ok(base, "an emitted card carries all three second-order Greek ladders with data");

    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, base, { ticker: base.ticker });

    for (const key of ["vanna", "charm", "deltaExposure"]) {
      const panel = base.panels[key];
      const got = await page.evaluate((k) => {
        const host = document.querySelector('.ft-panel[data-panel="' + k + '"] > div');
        if (!host) return null;
        const svg = host.querySelector("svg.gts");
        const bars = [...host.querySelectorAll(".gts-bar")];
        const zero = host.querySelector(".gts-zero");
        return {
          bars: bars.length,
          calls: bars.filter((b) => b.classList.contains("is-call")).length,
          puts: bars.filter((b) => b.classList.contains("is-put")).length,
          above: bars.filter((b) => b.classList.contains("is-pos")).length,
          below: bars.filter((b) => b.classList.contains("is-neg")).length,
          zeroY: zero ? Number(zero.getAttribute("y1")) : null,
          negBelow: bars.filter((b) => b.classList.contains("is-neg"))
            .every((b) => Number(b.getAttribute("y")) >= (zero ? Number(zero.getAttribute("y1")) - 0.5 : 0)),
          par: svg ? svg.getAttribute("preserveAspectRatio") : null,
          said: host.textContent,
        };
      }, key);

      ok(got, `panel ${key} has a drawing host`);
      /* ONE BAR PER PRESENT LEG, NEVER ONE PER EXPIRY. If the renderer ever
         nets the two legs this count halves, which is the cheapest possible
         detector for the defect the sign convention warns about. */
      let legs = 0;
      for (const r of panel.rows) {
        if (typeof r.call === "number") legs++;
        if (typeof r.put === "number") legs++;
      }
      eq(got.bars, legs,
         `${key}: one bar per PRESENT leg (${legs}), never one per expiry — the two legs ` +
         `are never netted, because the vendor's put convention differs by Greek`);
      ok(got.calls > 0 && got.puts > 0,
         `${key}: both legs are drawn and told apart by class`);
      ok(got.negBelow,
         `${key}: every negative leg is drawn BELOW the zero line — sign lives in position, ` +
         `so it survives greyscale and a printout`);
      eq(got.par, "xMidYMid meet",
         `${key}: one viewBox unit is one CSS pixel`);
      /* THE UNIT IS THE PAYLOAD'S OWN, not a copy in the renderer: three
         panels share one drawer and only the unit distinguishes a per-day
         figure from a per-vol-point one. */
      ok(got.said.includes(panel.unit),
         `${key}: the panel's own published unit is on the page verbatim`);
      ok(got.said.includes(panel.signConvention),
         `${key}: and its sign convention, which is why nothing here is a direction`);
      ok(/[Gg]ross size/.test(got.said),
         `${key}: the total is labelled a SIZE — with two un-nettable legs it cannot be a direction`);
    }

    /* A MEASURED ZERO IS NOT AN ABSENCE, and on this panel the difference is
       a hairline bar versus no bar at all. */
    const zeroed = JSON.parse(JSON.stringify(base));
    zeroed.panels.charm.rows[0].call = 0;
    zeroed.panels.charm.rows[0].put = null;
    await mount(page, zeroed, { ticker: zeroed.ticker });
    const zg = await page.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="charm"] > div');
      const bars = [...host.querySelectorAll(".gts-bar")];
      return {
        flats: bars.filter((b) => b.classList.contains("is-flat")).length,
        flatHeight: bars.filter((b) => b.classList.contains("is-flat"))
          .map((b) => Number(b.getAttribute("height"))),
      };
    });
    eq(zg.flats, 1, "a leg measured at exactly zero is still drawn");
    ok(zg.flatHeight.every((h) => h >= 1),
       "as a visible hairline, because a zero-height bar is indistinguishable from the leg " +
       "the vendor never sent — and those are different facts");

    eq(errors.length, 0, `the Greek ladders render without throwing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6h. the page was a dead end -------------------------

     The index renders only when `?t=` is absent, so a reader who had arrived
     on a name could not reach another one without editing the URL — on a
     section whose whole purpose is comparing names against each other.

     THE BOARDS MUST NOT BE FETCHED UNLESS THE CONTROL IS USED. Two requests
     on every ticker page view would be paid by every reader to serve the few
     who switch, and the card is what this page is. That is asserted first,
     because it is the property a later "simplification" would quietly lose. */
  {
    const card = withChain[0];
    const boards = { rows: [{ t: "AAA", r: 1, s: 40, dp: 1 }, { t: "BBB", r: 2, s: 30, dp: 1 }] };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { ticker: card.ticker, boards });

    const before = await page.evaluate(() =>
      window.__requested.filter((u) => u.includes("/api/flows/board")).length);
    eq(before, 0,
       "loading a named ticker page fetches NO board — the switcher's cost is paid only " +
       "by the readers who use it");

    const btn = await page.evaluate(() => {
      const b = document.getElementById("ftSwitch");
      return b ? { hidden: b.hidden, text: b.textContent } : null;
    });
    ok(btn && !btn.hidden, "but the control is there, in the header, beside the name");

    await page.click("#ftSwitch");
    await page.waitForSelector("#ftPickerBody tr");
    const after = await page.evaluate(() => ({
      fetched: window.__requested.filter((u) => u.includes("/api/flows/board")).length,
      rows: [...document.querySelectorAll("#ftPickerBody .ft-link")].map((a) => a.textContent),
      gridHidden: document.getElementById("ftGrid")
        ? document.getElementById("ftGrid").hidden
        : document.querySelector(".ft-grid").hidden,
      backShown: !document.getElementById("ftBackTo").hidden,
      backText: document.getElementById("ftBackTo").textContent,
      note: document.getElementById("ftPickerNote").textContent,
    }));
    ok(after.fetched > 0, "clicking it fetches the boards, then");
    ok(after.rows.includes("AAA"), "and the index lists the names to switch to");
    ok(after.backShown,
       "opened FROM a name, the picker offers a way back — hiding twenty panels with no " +
       "return is a worse dead end than the one this fixes");
    ok(after.backText.includes(card.ticker),
       `and names it (${after.backText.trim()}), so the reader knows what they are returning to`);
    ok(after.note.includes(card.ticker), "the note says which name they are on");

    /* CLICKING AGAIN MUST NOT RE-FETCH. Opening the switcher twice is not two
       different questions. */
    await page.click("#ftBackTo");
    await page.click("#ftSwitch");
    await page.waitForSelector("#ftPickerBody tr");
    const twice = await page.evaluate(() =>
      window.__requested.filter((u) => u.includes("/api/flows/board")).length);
    eq(twice, after.fetched, "re-opening the switcher re-uses what it already fetched");

    /* AND THE WAY BACK ACTUALLY RESTORES THE PAGE. */
    await page.click("#ftBackTo");
    const restored = await page.evaluate(() => ({
      pickerHidden: document.getElementById("ftPicker").hidden,
      panels: document.querySelectorAll(".ft-panel[data-panel]").length,
      headShown: !document.getElementById("ftHead").hidden,
    }));
    ok(restored.pickerHidden, "going back hides the index");
    ok(restored.headShown, "restores the header");
    ok(restored.panels > 15, `and the panels are still there (${restored.panels})`);

    eq(errors.length, 0, `the switcher throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6i. the score derivation leads --------------------------

     IT USED TO BE ENTRY 21 OF 21. The explanation of the single number this
     page is about sat below a twenty-panel scroll — defensible when the
     chain panels above it were the undrawn half of the payload, and stale
     once they were drawn and four more panels were added on top.

     Asserted on the REGISTRY and on the rendered DOM, because the page is
     generated from the registry and a test that only read the registry would
     pass on a page that never mounted it. */
  {
    eq(TICKER_PANELS[0].key, SCORE_KEY,
       "the score derivation is the first panel the registry mounts");
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    await mount(page, withChain[0], { ticker: withChain[0].ticker });
    const order = await page.evaluate(() =>
      [...document.querySelectorAll(".ft-panel[data-panel]")].map((s) => s.dataset.panel));
    eq(order[0], "__score",
       "and it is first in the document too — a reader arrives from a board row carrying " +
       "a score, and the first thing the page owes them is what it is made of");
    await page.close();
  }

  /* ---------- 6j. the registry's chrome reaches the page --------------

     TWENTY-ONE PANELS IN ONE FLAT SCROLL, no index, no group boundaries and
     no way to link a colleague to one of them. The registry now carries a
     `group` and a `tier` for every panel — but `shared/` is never served, so
     the browser cannot import it and the controller keeps a PANEL_CHROME
     projection of the same two fields.

     A PROJECTION IS ONLY SAFE IF SOMETHING COMPARES IT. This is that
     comparison, and it is made against the RENDERED DOM rather than against
     the controller's source: reading the table out of the file would prove
     the two literals match and nothing about whether either reached a panel.
     Both directions, because one direction is how four published panels went
     undrawn for weeks. */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, withChain[0], { ticker: withChain[0].ticker });

    const dom = await page.evaluate(() =>
      [...document.querySelectorAll(".ft-panel[data-panel]")].map((s) => ({
        key: s.dataset.panel, group: s.dataset.group, tier: s.dataset.tier, id: s.id,
      })));

    eq(dom.length, TICKER_PANELS.length, "every registry panel is mounted");
    for (let i = 0; i < TICKER_PANELS.length; i++) {
      const want = TICKER_PANELS[i];
      eq(dom[i].key, want.key, `panel ${i} of the DOM is the registry's ${want.key}`);
      /* REGISTRY → DOM. A group or tier that never reaches an element is a
         field the emitter and the controller disagree about. */
      eq(dom[i].group, want.group,
         `${want.key} is mounted in its registry group (${want.group})`);
      eq(dom[i].tier, want.tier,
         `${want.key} wears its registry chrome tier (${want.tier})`);
      /* DOM → REGISTRY. A panel the controller had no chrome entry for would
         mount with no group and no tier at all, and would look like an
         ordinary chart rather than like the omission it is. */
      ok(dom[i].group && dom[i].tier,
         `${want.key} carries BOTH a group and a tier — a panel the controller's ` +
         `chrome table has never heard of mounts with neither`);
      eq(dom[i].id, "panel-" + want.key,
         `${want.key} has its own fragment id, so it can be linked to`);
    }

    /* THE VALUES ARE LEGAL, not merely present. A tier with no stylesheet
       rule is a box with no chrome and a group with no heading is a panel
       that never appears in the index. */
    const groupKeys = TICKER_GROUPS.map((g) => g.key);
    for (const p of TICKER_PANELS) {
      ok(groupKeys.includes(p.group), `panel "${p.key}" names a declared group`);
      ok(PANEL_TIERS.includes(p.tier), `panel "${p.key}" names a declared tier`);
    }

    /* THE GROUPS ARE CONTIGUOUS AND IN THE DECLARED ORDER. Non-contiguous
       groups would make the heading meaningless — a "Tape" heading followed
       by two tape panels, a volatility panel and another tape panel is worse
       than no heading, because it says the boundary is real. */
    const runs = [];
    for (const p of TICKER_PANELS) {
      if (!runs.length || runs[runs.length - 1] !== p.group) runs.push(p.group);
    }
    eq(runs.length, new Set(runs).size,
       `each group is one contiguous run (${runs.join(" ")})`);
    eq(runs.join(","), groupKeys.join(","),
       "and the runs come in the order the group list declares");

    /* EXACTLY ONE LEAD PER GROUP, AND IT IS FIRST. With 21 boxes of identical
       chrome the eye has no way to find the primary reading of a section, so
       the lead wears heavier chrome — which is only true if there is exactly
       one of it and it is the panel the reader meets first. */
    for (const g of TICKER_GROUPS) {
      const members = TICKER_PANELS.filter((p) => p.group === g.key);
      ok(members.length > 0, `group "${g.key}" has panels in it`);
      const leads = members.filter((p) => p.tier === "lead");
      eq(leads.length, 1, `group "${g.key}" has exactly one lead panel`);
      eq(members[0].tier, "lead",
         `and it is the group's first panel (${members[0].key}), not one buried inside it`);
    }
    eq(TICKER_PANELS[0].key, SCORE_KEY,
       "and the very first lead is still the score derivation");

    /* THE HEADINGS ARE IN THE GRID, IN ORDER, EACH IMMEDIATELY BEFORE ITS OWN
       GROUP. They are grid children spanning every column, so DOM order stays
       tab order and nothing is hidden — the whole point of not using tabs. */
    const flow = await page.evaluate(() =>
      [...document.getElementById("ftGrid").children].map((n) =>
        n.classList.contains("ft-group")
          ? { kind: "h", id: n.id, text: n.textContent }
          : { kind: "p", key: n.dataset.panel }));
    const heads = flow.filter((n) => n.kind === "h");
    eq(heads.length, TICKER_GROUPS.length,
       `the grid opens each group with a heading (${heads.length})`);
    for (let i = 0; i < TICKER_GROUPS.length; i++) {
      const g = TICKER_GROUPS[i];
      eq(heads[i].id, g.hash,
         `heading ${i} carries the group's own fragment id (${g.hash}) — a slug computed ` +
         `at render time would break every link the moment a label was reworded`);
      ok(heads[i].text.includes(g.label), `and its label (${g.label})`);
      ok(heads[i].text.includes(g.blurb.slice(0, 40)),
         "and the group's own published sentence, verbatim");
      const at = flow.findIndex((n) => n.kind === "h" && n.id === g.hash);
      const first = TICKER_PANELS.find((p) => p.group === g.key);
      eq(flow[at + 1].key, first.key,
         `and it sits immediately before ${first.key}, the group's first panel`);
    }

    /* THE JUMP STRIP AND THE FULL INDEX. Five anchors answer "where is the
       volatility section"; they do not answer "where is the gamma roll-off",
       which is the question that made a reader scan seven screens — so every
       panel is named too, and every href in both resolves. */
    const nav = await page.evaluate(() => {
      const strip = [...document.querySelectorAll(".ft-jump .ft-jump-b")]
        .map((a) => a.getAttribute("href"));
      const all = [...document.querySelectorAll(".ft-all-l a")]
        .map((a) => a.getAttribute("href"));
      const resolves = [...strip, ...all].filter((h) => {
        try { return !document.getElementById(decodeURIComponent(h.slice(1))); }
        catch { return true; }
      });
      const bar = document.querySelector(".ft-bar");
      return {
        strip, all, dead: resolves,
        sticky: bar ? getComputedStyle(bar).position : null,
        holdsHead: !!(bar && bar.contains(document.getElementById("ftHead"))),
        holdsJump: !!(bar && bar.querySelector(".ft-jump")),
      };
    });
    eq(nav.strip.join(","), TICKER_GROUPS.map((g) => "#" + g.hash).join(","),
       "the jump strip lists every group, in reading order");
    eq(nav.all.length, TICKER_PANELS.length,
       `the full index names all ${TICKER_PANELS.length} panels`);
    eq(nav.dead.length, 0,
       `every anchor in the index resolves to an element (${nav.dead.join(", ")})`);
    eq(nav.sticky, "sticky",
       "the identity bar is sticky — it used to scroll away after the first panel, " +
       "taking the name, the score and the session date with it");
    ok(nav.holdsHead && nav.holdsJump,
       "and it carries BOTH the identity and the index, so neither can outscroll the other");

    eq(errors.length, 0, `the workspace chrome throws nothing (${errors.join("; ")})`);
    await page.close();

    /* THE JUMP CHIPS ARE A REAL TOUCH TARGET, MEASURED BY HIT-TESTING.

       They are 25px boxes carrying a 44px transparent pseudo-element, which
       is the pattern .ft-zoom-open already uses — and it silently did not
       work here: a box with overflow-x auto has its overflow-y COMPUTED to
       auto, so the strip is a scroll container in BOTH axes and clipped the
       extension back to the chip. Nothing looked wrong; the control simply
       claimed a target it did not have. A geometry assertion on the
       pseudo-element's declared height would have passed on the broken
       version, so this walks the viewport with elementFromPoint and counts
       the rows of pixels that actually hit the anchor. */
    const touch = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await mount(touch, withChain[0], { ticker: withChain[0].ticker });
    const hit = await touch.evaluate(() => {
      const b = document.querySelector(".ft-jump-b");
      const r = b.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      let span = 0;
      for (let y = Math.round(r.top) - 25; y <= Math.round(r.bottom) + 25; y++) {
        if (document.elementFromPoint(cx, y) === b) span++;
      }
      return { box: Math.round(r.height), span };
    });
    ok(hit.span >= 44,
       `a jump chip is at least 44px of hit area at 320px (${hit.span}px over a ` +
       `${hit.box}px box) — the extension is worthless if its own scroll container clips it`);
    await touch.close();
  }

  /* ---------- 6k. the page leads on CHANGE ----------------------------

     THE PRODUCT IS READ AS AN EARLY WARNING AND THE PAGE OPENED ON A
     SNAPSHOT. Twenty-one panels described one session in enormous detail and
     nothing said what the number had done: no move against the previous
     scored session, no run, no dead-band crossing, no notice that the newest
     reading was three sessions old.

     EVERY FIXTURE BELOW IS AN EMITTED CARD WITH NAMED SCORES MUTATED, and the
     mutation is the branch. A crossing, a multi-session gap and a stale
     reading do not all occur in one dry run, and a fixture that cannot reach
     the branch it certifies is this repository's most repeated mistake. */
  {
    const base = withChain.find((c) =>
      c.panels.scoreOverlay && c.panels.scoreOverlay.status === "ok" &&
      c.panels.scoreOverlay.rows.length >= 6 &&
      typeof c.panels.scoreOverlay.deadBand === "number");
    ok(base, "an emitted card carries a joined overlay with a published dead band");
    const BAND = base.panels.scoreOverlay.deadBand;

    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    /** An emitted card whose last two scored sessions are set by name. */
    const staged = (fn) => {
      const c = JSON.parse(JSON.stringify(base));
      fn(c.panels.scoreOverlay, c.panels.scoreOverlay.rows);
      const ovl = c.panels.scoreOverlay;
      /* The counters are kept honest with the rows the mutation left behind,
         so the overlay panel below the block does not contradict it. A
         mutation that removes `rows` outright is one of the two silences and
         has no counters to keep. */
      if (Array.isArray(ovl.rows)) {
        ovl.scored = ovl.rows.filter((r) => typeof r.score === "number").length;
        ovl.gaps = ovl.rows.length - ovl.scored;
      }
      return c;
    };

    const read = async (card) => {
      await mount(page, card, { ticker: card.ticker });
      return page.evaluate(() => {
        const c = document.getElementById("ftChange");
        const pick = (sel) => {
          const n = c && c.querySelector(sel);
          return n ? n.textContent : "";
        };
        const chip = (id) => {
          const n = document.getElementById(id);
          return n ? { text: n.textContent, empty: n.getAttribute("data-empty") } : null;
        };
        return {
          hidden: !c || c.hidden,
          text: c ? c.textContent : "",
          lead: pick(".ft-chg-lead"),
          event: pick(".ft-chg-e"),
          stale: pick(".ft-chg-stale"),
          empties: c ? [...c.querySelectorAll("[data-empty]")]
            .map((n) => n.getAttribute("data-empty")) : [],
          d1: chip("ftD1"), price: chip("ftPrice"), side: chip("ftSide"),
        };
      });
    };

    /* THE ORDINARY CASE: the newest scored session and the one before it. */
    const rows = base.panels.scoreOverlay.rows;
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    if (typeof last.score === "number" && typeof prev.score === "number") {
      const got = await read(base);
      ok(!got.hidden, "the change block is drawn above the panels");
      ok(got.lead.includes(prev.d),
         `the headline names the previous scored session (${prev.d})`);
      ok(/1 session earlier/.test(got.lead),
         "and how many sessions the move spans — a delta without its gap is the defect " +
         "this layer replaced");
      ok(/score points?\b/.test(got.text),
         "the move carries its unit: a bare number is not a reading, and the score is an " +
         "index whose differences are POINTS rather than percent");
      ok(got.d1 && /session/.test(got.d1.text),
         `the sticky header carries the move and its gap too (${got.d1 && got.d1.text})`);
    }

    /* A MOVE OF EXACTLY ZERO IS A MEASUREMENT. It must read as "unchanged",
       never as an absence and never as a missing reading — the two are one
       keystroke apart in every renderer this repository has shipped. */
    const flat = await read(staged((o, r) => { r[r.length - 1].score = r[r.length - 2].score; }));
    ok(/unchanged/i.test(flat.lead),
       `an identical score reads as unchanged (${flat.lead.slice(0, 90)})`);
    ok(flat.d1 && /^0/.test(flat.d1.text.trim()),
       `and the header chip shows the measured zero (${flat.d1 && flat.d1.text})`);
    ok(!/no move to state/i.test(flat.lead),
       "and is NOT reported as an absence — a measured zero and an unmeasured session " +
       "are different facts");

    /* THE FOUR DEAD-BAND VERDICTS. The band is the board's own membership
       rule, so crossing it is the event and everything else is drift. */
    const cleared = await read(staged((o, r) => {
      r[r.length - 2].score = 0;
      r[r.length - 1].score = BAND + 40;
    }));
    ok(/cleared the dead band/i.test(cleared.event),
       `a name leaving the band is called out as the entry event (${cleared.event})`);
    ok(/actionable/i.test(cleared.event), "in the words the payload's own layer uses");

    const faded = await read(staged((o, r) => {
      r[r.length - 2].score = BAND + 40;
      r[r.length - 1].score = 0;
    }));
    ok(/faded into the dead band/i.test(faded.event),
       `a name entering the band is the exit signal (${faded.event})`);

    const flipped = await read(staged((o, r) => {
      r[r.length - 2].score = BAND + 40;
      r[r.length - 1].score = -(BAND + 30);
    }));
    ok(/flipped/i.test(flipped.event),
       `a sign change outside the band on both ends is a flip (${flipped.event})`);

    const held = await read(staged((o, r) => {
      r[r.length - 2].score = BAND + 40;
      r[r.length - 1].score = BAND + 45;
    }));
    ok(/no crossing/i.test(held.event),
       "and a name that did not cross says so, rather than leaving a blank where the " +
       "event would be");
    ok(held.empties.includes("quiet"),
       "tagged as the MEASURED silence: both ends were scored and neither crossed");

    /* THE BAND ITSELF CAN BE ABSENT, and then the crossing is UNKNOWN rather
       than absent — the friendlier of the two sentences is the wrong one. */
    const noBand = await read(staged((o) => { o.deadBand = null; }));
    ok(/cannot be stated/i.test(noBand.event),
       `an unpublished dead band makes the crossing unknowable, and says so (${noBand.event})`);
    ok(noBand.empties.includes("unavailable"),
       "and tags it as a publisher-side absence, not as a measured one");
    ok(!/no crossing/i.test(noBand.event),
       "it never reports 'no crossing' from a band nobody published — that is a " +
       "confident answer built out of a missing input");

    /* A GAP IS NOT AN OVERNIGHT MOVE. Null the previous session and the same
       delta now spans two sessions with the name unscored in between. */
    const gapped = await read(staged((o, r) => {
      r[r.length - 2].score = null;
      r[r.length - 1].score = BAND + 40;
    }));
    ok(/2 sessions earlier/.test(gapped.lead),
       `the gap is counted and printed (${gapped.lead.slice(0, 120)})`);
    ok(/not an overnight one/i.test(gapped.lead),
       "and the sentence refuses the overnight reading a bare delta would invite");

    /* A STALE READING SAYS SO BEFORE IT SAYS ANYTHING ELSE. */
    const stale = await read(staged((o, r) => { r[r.length - 1].score = null; }));
    ok(/1 session old/.test(stale.stale),
       `a newest session with no score for this name is announced as stale (${stale.stale.slice(0, 110)})`);
    ok(stale.stale.length > 0 && stale.text.indexOf(stale.stale.slice(0, 20)) <
       stale.text.indexOf(stale.lead.slice(0, 20)),
       "and the staleness line comes BEFORE the move, so no reader takes the move for " +
       "this morning's");

    /* THE RUN, AND THE GAP IT REFUSES TO STEP OVER. */
    const broken = await read(staged((o, r) => {
      for (let i = 0; i < r.length; i++) r[i].score = BAND + 10;
      r[r.length - 4].score = null;
    }));
    ok(/consecutive scored sessions on the bullish side/i.test(broken.text),
       "the run states its side and its length");
    ok(/not\s+stepped over that gap/i.test(broken.text),
       "and says it stopped at an unscored session rather than counting through it — " +
       "continuity nobody measured is not continuity");

    /* A NEWEST SCORE OF EXACTLY ZERO IS THE CENTRE OF THE BAND, not a run of
       zero on some side. */
    const atZero = await read(staged((o, r) => { r[r.length - 1].score = 0; }));
    ok(/exactly zero/i.test(atZero.text),
       "a newest score of zero is named as the centre of the dead band");
    ok(!/on the bullish side|on the bearish side/i.test(atZero.text.split("Derived from")[0]),
       "and is not assigned a side it does not hold");

    /* ONE SCORED SESSION IS NOT A MOVE OF ZERO. */
    const lone = await read(staged((o, r) => {
      for (let i = 0; i < r.length - 1; i++) r[i].score = null;
      r[r.length - 1].score = BAND + 5;
    }));
    ok(/no move to state/i.test(lone.lead),
       "a single scored session states the reading and refuses to derive a move from it");
    ok(/not a move of zero/i.test(lone.lead),
       "in the words that rule out the substitution");
    ok(!lone.d1, "and the header carries no move chip at all rather than a zero");

    /* THE THREE SILENCES, one sentence and one tag each. */
    const unavailable = await read(staged((o) => {
      o.status = "unavailable";
      o.reason = "the score track was not assembled this run";
      delete o.rows;
    }));
    ok(unavailable.text.includes("the score track was not assembled this run"),
       "an unavailable track prints the publisher's own reason verbatim");
    ok(unavailable.empties.includes("unavailable"), "and is tagged as a publisher fault");

    const quiet = await read(staged((o) => {
      o.status = "quiet";
      o.reason = "the price window and the score window do not share a single session";
      delete o.rows;
    }));
    ok(quiet.empties.includes("quiet"),
       "two windows read in full and found disjoint is the MEASURED silence");
    ok(!quiet.empties.includes("unavailable"),
       "and never wears the unavailable tag — one is a skipped leg, the other an " +
       "ordinary state for a name new to the board");

    const legacy = JSON.parse(JSON.stringify(base));
    delete legacy.panels.scoreOverlay;
    const predates = await read(legacy);
    ok(/predates|built before/i.test(predates.text),
       `a card from before the overlay dates its own absence (${predates.text.slice(0, 110)})`);
    ok(predates.empties.includes("unavailable"), "and tags it as an absence, not a silence");

    /* THE IDENTITY STRIP. Price, side and score, from the card's own panels —
       and each absence named rather than dashed. */
    const idOk = await read(base);
    ok(/^\$\d/.test(idOk.price.text.trim()),
       `the strip carries the spot the card was measured at (${idOk.price.text})`);
    ok(idOk.side.text.trim().length > 0, `and the side (${idOk.side.text})`);

    /* THE SIDE IS THE CARD'S PUBLISHED SCORE READ AGAINST THE PUBLISHED BAND,
       so the fixture stages the score itself — mutating the overlay's newest
       row would test a different number. A score of +1 with a band of ±1 is
       not a bullish name; it is a name the board declined to rank, and the
       header calling it bullish is exactly the confident reading this product
       exists to refuse. */
    const inside = JSON.parse(JSON.stringify(base));
    inside.score = BAND;
    const inBand = await read(inside);
    ok(/dead band/i.test(inBand.side.text),
       `a score inside the band is not called bullish (${inBand.side.text})`);
    ok(!/bullish|bearish/i.test(inBand.side.text),
       "and is given no side at all, because it holds none");

    const noSpot = JSON.parse(JSON.stringify(base));
    for (const k of ["levels", "pricedMove", "gamma"]) {
      noSpot.panels[k] = { status: "unavailable", reason: "no spot price" };
    }
    const priceless = await read(noSpot);
    eq(priceless.price.empty, "unavailable",
       "a card whose three spot-carrying panels are all unavailable says the price is " +
       "UNAVAILABLE — never $0.00, which is what Number(null) would have produced");
    ok(!/\$0/.test(priceless.price.text), `and prints no dollar figure (${priceless.price.text})`);

    eq(errors.length, 0, `no change-block state throws (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6l. the shaper itself, on payloads no run produces -------

     changeFrom is the arithmetic the header and the block both read, so it is
     exercised directly as well as through the DOM: a renderer assertion can
     pass on a shaper that returns the right SHAPE and the wrong number. */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await mount(page, withChain[0], { ticker: withChain[0].ticker });
    const got = await page.evaluate(() => {
      const f = window.FlowsPanels.changeFrom;
      const mk = (scores, deadBand) => ({
        status: "ok", deadBand,
        rows: scores.map((s, i) => ({ d: "2026-08-" + String(10 + i).padStart(2, "0"),
          close: 100 + i, score: s })),
      });
      return {
        /* Six sessions, the last two scored one apart. */
        plain: f(mk([5, 6, 7, 8, 9, 12], 1)),
        /* The name is unscored for two sessions before the newest. */
        gapped: f(mk([5, 6, 7, null, null, 12], 1)),
        /* The newest session carries no score: the reading is three old. */
        stale: f(mk([5, 6, 40, null, null, null], 1)),
        /* Inside the band, then outside it. */
        cleared: f(mk([0, 0, 0, 0, 0, 40], 1)),
        /* Outside, then inside. */
        faded: f(mk([40, 40, 40, 40, 40, 0], 1)),
        /* Outside on both ends, opposite signs. */
        flipped: f(mk([40, 40, 40, 40, 40, -40], 1)),
        /* A run broken by an unscored session rather than by a sign change. */
        broken: f(mk([9, 9, null, 9, 9, 9], 1)),
        /* Zero is a reading, not an absence. */
        zero: f(mk([9, 9, 9, 9, 9, 0], 1)),
        /* No band published. */
        bandless: f(mk([0, 0, 0, 0, 0, 40], null)),
        /* Nothing scored at all. */
        empty: f(mk([null, null, null], 1)),
        /* The three non-ok inputs. */
        absent: f(undefined),
        dead: f({ status: "unavailable", reason: "the track was not assembled" }),
        disjoint: f({ status: "quiet", reason: "no shared session" }),
      };
    });

    eq(got.plain.d1.v, 3, "the move is the difference between the two newest scored sessions");
    eq(got.plain.d1.gap, 1, "and an overnight move spans one session");
    eq(got.plain.stale, 0, "a newest session that is scored is not stale");
    eq(got.plain.run, 6, "the run counts every consecutive session on the current sign");
    ok(got.plain.runCapped,
       "and says so when it reached the start of the window — the run may be older than " +
       "this card can see");
    eq(got.plain.ext.hi, 12, "the window high is the largest score in it");
    eq(got.plain.ext.lo, 5, "and the low the smallest");
    eq(got.plain.ext.hiAt, "2026-08-15", "each extreme carries the date it was set on");

    eq(got.gapped.d1.gap, 3,
       "a move over an absence spans every session between the two readings — 3, not 1");
    eq(got.gapped.d1.v, 5, "and is still the difference between the two scored ends");
    eq(got.gapped.run, 1,
       "the run stops at the unscored session rather than counting through it");
    ok(got.gapped.runBroken, "and says which of the two reasons it stopped for");
    ok(!got.gapped.runCapped, "a run that ended at a gap did not end at the window edge");

    eq(got.stale.stale, 3,
       "three unscored sessions after the newest score make the reading three sessions old");
    eq(got.stale.at.d, "2026-08-12", "and the reading itself is dated by ITS session");

    eq(got.cleared.cross, "cleared", "inside the band then outside it is a clearing");
    eq(got.faded.cross, "faded", "outside then inside is a fade");
    eq(got.flipped.cross, "flipped", "outside at both ends on opposite signs is a flip");
    eq(got.plain.cross, null, "and a name that stayed put crossed nothing");
    ok(got.plain.crossKnown,
       "which is KNOWN, because a band was published and both ends were scored");

    eq(got.broken.run, 3, "a run counts back to the gap and stops");
    ok(got.broken.runBroken, "and reports the gap as the reason");

    eq(got.zero.run, 0,
       "a newest score of exactly zero is a run of 0 — the centre of the dead band, not " +
       "a length-zero run on a side it does not hold");
    eq(got.zero.d1.v, -9, "while the move to it is still a measured move");

    eq(got.bandless.band, null, "an unpublished dead band is null, never zero");
    eq(got.bandless.cross, null, "so no crossing is claimed");
    eq(got.bandless.crossKnown, false, "and the renderer is told the difference");
    eq(got.bandless.inside, null,
       "and whether the name sits inside the band is UNKNOWN rather than false");

    eq(got.empty.status, "quiet",
       "a window with no scored session at all is a measured emptiness");
    eq(got.absent.status, "unavailable", "a card with no overlay key predates the panel");
    ok(/built before/.test(got.absent.reason), "and says so");
    eq(got.dead.status, "unavailable", "an unavailable track is a publisher-side absence");
    ok(got.dead.reason.includes("the track was not assembled"),
       "carrying the publisher's own reason");
    eq(got.disjoint.status, "quiet", "and disjoint windows are the measured silence");

    await page.close();
  }

  /* ---------- 6m. deep links, both directions -------------------------

     `location.hash` was read in NO file in this product, so there was no way
     to send a colleague panel 14 — the URL got them the name and a sentence
     told them to scroll. The grid is `hidden` while the card is in flight, so
     the browser's own fragment scroll on load lands on an element with no box
     and does nothing; the controller has to re-run the jump after paint, and
     that is what is asserted here.

     ONE PAGE PER HASH, and the reason is not tidiness. Two goto()s to the
     same path differing only in fragment are a SAME-DOCUMENT navigation:
     Playwright does not reload, mount() injects the two controllers a second
     time into a document that already has them, and the page ends up with two
     of everything. A fresh page per hash is what a reader following a link
     actually gets. */
  {
    const card = withChain[0];
    const target = TICKER_PANELS[TICKER_PANELS.length - 2].key;

    /* THE SCROLL HAS TO SETTLE BEFORE IT IS MEASURED. base.css sets
       `html { scroll-behavior: smooth }`, so a position test that fires the
       moment the target enters the viewport is measuring a page in motion —
       which is how the first draft of this section read a heading at 23px
       against a sticky bar that had not reached its offset yet. Two
       consecutive animation frames at the same offset is settled. */
    const settled = (page) => page.waitForFunction(() => {
      const y = Math.round(window.scrollY);
      const same = window.__lastY === y;
      window.__lastY = y;
      return same && y > 100;
    }, null, { timeout: 8000 });

    const open = async (hash) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker, hash });
      return { page, errors };
    };

    {
      const { page, errors } = await open("panel-" + target);
      await settled(page);
      const landed = await page.evaluate((k) => {
        const s = document.getElementById("panel-" + k);
        const r = s.getBoundingClientRect();
        return {
          top: r.top, focused: document.activeElement === s, scrolled: window.scrollY,
          /* The sticky bar must not be sitting ON the panel the link named. */
          barBottom: document.querySelector(".ft-bar").getBoundingClientRect().bottom,
        };
      }, target);
      ok(landed.scrolled > 200,
         `an incoming #panel-${target} scrolls the page to it (${Math.round(landed.scrolled)}px)`);
      ok(landed.top >= landed.barBottom - 4,
         `and lands BELOW the sticky bar rather than under it (panel ${Math.round(landed.top)}, ` +
         `bar ends ${Math.round(landed.barBottom)})`);
      ok(landed.focused,
         "and focus follows the jump, or a keyboard reader lands on panel 20 and carries " +
         "on tabbing from panel 1");
      eq(errors.length, 0, `a panel deep link throws nothing (${errors.join("; ")})`);
      await page.close();
    }

    /* A GROUP ANCHOR IS THE OTHER HALF OF THE INDEX. */
    {
      const g = TICKER_GROUPS[3];
      const { page, errors } = await open(g.hash);
      await settled(page);
      const grp = await page.evaluate((h) => ({
        scrolled: window.scrollY,
        current: [...document.querySelectorAll(".ft-jump-b[aria-current='true']")]
          .map((a) => a.getAttribute("href")),
        headTop: document.getElementById(h).getBoundingClientRect().top,
        barBottom: document.querySelector(".ft-bar").getBoundingClientRect().bottom,
      }), g.hash);
      ok(grp.scrolled > 100, "a group anchor scrolls to its heading");
      ok(grp.headTop >= grp.barBottom - 4,
         `and the heading clears the sticky bar rather than hiding behind it ` +
         `(heading ${Math.round(grp.headTop)}, bar ends ${Math.round(grp.barBottom)})`);
      eq(errors.length, 0, `a group deep link throws nothing (${errors.join("; ")})`);
      await page.close();
    }

    /* A HOSTILE HASH REACHES getElementById AND NOTHING ELSE. querySelector
       ('#' + hash) throws on anything that is not an identifier, and a throw
       here would take the whole paint down AFTER the card had arrived — the
       worst possible moment, because every panel is already on the page. */
    for (const bad of ["../etc", "panel-<script>", "%%%", "a b c"]) {
      const { page, errors } = await open(encodeURIComponent(bad));
      const alive = await page.evaluate(() =>
        document.querySelectorAll(".ft-panel[data-panel]").length);
      eq(alive, TICKER_PANELS.length, `a hash of ${JSON.stringify(bad)} paints the page anyway`);
      eq(errors.length, 0, `and throws nothing (${errors.join("; ")})`);
      await page.close();
    }

    /* THE OPEN PANEL IS REFLECTED INTO THE URL, and closing puts back what was
       there. replaceState rather than an assignment to location.hash, so
       twenty enlarges do not become twenty back-button steps. */
    {
      const { page, errors } = await open(TICKER_GROUPS[1].hash);
      const before = await page.evaluate(() => location.hash);
      await page.click('.ft-panel[data-panel="gamma"] .ft-zoom-open');
      await page.waitForFunction(
        () => document.querySelectorAll("#ftZoomHost svg").length > 0, null, { timeout: 3000 });
      const opened = await page.evaluate(() => location.hash);
      eq(opened, "#panel-gamma",
         "enlarging a panel puts that panel in the URL, so a reader can send the chart " +
         "they are looking at");
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.getElementById("ftZoom").open, null, { timeout: 2000 });
      const closed = await page.evaluate(() => location.hash);
      eq(closed, before,
         "and closing restores the hash the reader arrived on rather than clearing it");
      eq(errors.length, 0, `the enlarge round trip throws nothing (${errors.join("; ")})`);
      await page.close();
    }
  }

  /* ---------- 6n. a gated name lands on a page that used to deny -----

     EVERY TICKER ON /flows/events/ LINKS HERE, and 57 of the 60 rows on a
     typical funnel payload are gated — so the sentence a reader met most
     often was this one, and both halves of it were wrong for exactly those
     names: "Cards are built only for the names the board publishes, so there
     is nothing to show for this name today — it may be on the watch list."
     A gated name is absent because the board was FORBIDDEN to score it, and
     it cannot be on the watch list, which holds only names that WERE scored
     and landed inside the dead band. */
  {
    const say = async (events) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, { status: "pending", ticker: "ZZZ" }, {
        ticker: "ZZZ",
        boards: { rows: [{ t: "QQQ", r: 1, s: 5, dp: 1 }] },
        events,
      });
      const got = await page.evaluate(() => ({
        text: document.getElementById("ftStatus").textContent,
        href: (document.querySelector("#ftStatus a") || {}).getAttribute
          ? document.querySelector("#ftStatus a").getAttribute("href") : null,
      }));
      eq(errors.length, 0, `the absent-name branch throws nothing (${errors.join("; ")})`);
      await page.close();
      return got;
    };

    const gated = await say({
      gateOrigin: "2026-09-03", gateDays: 12,
      rows: [{ t: "ZZZ", d: "2026-09-08", dte: 5, st: "gated", s: null }],
    });
    ok(gated.text.includes("2026-09-08"),
       `a gated name is told when it reports (${gated.text.slice(0, 120)})`);
    ok(/5 calendar days/.test(gated.text),
       "with the count in its own unit — calendar days, which is what the gate measures in");
    ok(gated.text.includes("2026-09-03"),
       "and the origin the gate counted from, so the number can be checked");
    ok(/BEFORE the composite ran/.test(gated.text),
       "and says the gate fired before any score existed — not that it scored badly");
    ok(/not a low one/.test(gated.text),
       "which is the reading a reader would otherwise take");
    ok(!/it may be on the watch list/.test(gated.text),
       "the false watch-list suggestion is gone");
    ok(/holds only names that were scored/.test(gated.text),
       "and is replaced by what the watch list actually holds");
    eq(gated.href, "/flows/events/",
       "and the page offers the way on, which the old dead end did not");

    const stalled = await say({
      gateOrigin: "2026-09-03", gateDays: 12,
      rows: [{ t: "ZZZ", d: "2026-11-01", dte: 59, st: "eligible", s: null }],
    });
    ok(/eligible/.test(stalled.text),
       `a name that cleared the gate is told which stage it stopped at (${stalled.text.slice(0, 120)})`);
    ok(/cleared the earnings gate/.test(stalled.text),
       "and told that it was NOT gated — the opposite fact from the row above");
    ok(!/BEFORE the composite ran/.test(stalled.text),
       "and never borrows the gated sentence");

    const missing = await say({ gateOrigin: "2026-09-03", gateDays: 12, rows: [] });
    ok(/cannot say which stage/.test(missing.text),
       `a name with no funnel row gets no invented stage (${missing.text.slice(0, 120)})`);
    ok(/capped/.test(missing.text),
       "and is told the calendar is capped, so its silence is not evidence the name was " +
       "never gated — the reassuring inference is the one refused here");

    const unread = await say({ status: "pending" });
    ok(/could not be read/.test(unread.text),
       `an unreadable funnel says so rather than guessing (${unread.text.slice(0, 120)})`);
    ok(/not on today/.test(unread.text),
       "while still stating the one thing that IS known: the name is not on the board");
  }

  /* ---------- 7. motion, in both states and both halves ----------- */
  {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce" });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });
    await page.mouse.move(300, 300);
    await page.mouse.move(420, 380);
    await page.mouse.move(540, 460);
    const calm = await page.evaluate(() => {
      const p = document.querySelector(".ft-panel");
      const cs = getComputedStyle(p);
      return {
        duration: cs.transitionDuration,
        after: getComputedStyle(p, "::after").display,
        mx: p.style.getPropertyValue("--mx"),
      };
    });
    eq(calm.duration, "0s", "under reduced motion the panel does not transition");
    eq(calm.after, "none", "and the spotlight layer is not painted");
    eq(calm.mx, "", "and the controller never attaches, so no custom property is written");
    await page.close();
  }
  {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 }, reducedMotion: "no-preference" });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });
    const box = await page.evaluate(() => {
      const p = document.querySelector(".ft-panel");
      /* SCROLLED INTO VIEW FIRST, and `instant` because base.css sets
         `html { scroll-behavior: smooth }` — a rect read in the same tick as a
         smooth scroll is the rect from before it. The sticky bar and the
         change block now sit above the grid, so the first panel starts below
         the fold at this viewport and a mouse.move to a point outside the
         viewport lands on nothing at all. That is a property of the page, not
         of the spotlight this section is about. */
      p.scrollIntoView({ block: "center", behavior: "instant" });
      const r = p.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    /* 70%/60% of the panel, so a hard-coded 50/50 fails. */
    await page.mouse.move(box.x + box.w * 0.7, box.y + box.h * 0.6);
    await page.waitForFunction(
      () => document.querySelector(".ft-panel").style.getPropertyValue("--mx") !== "",
      null, { timeout: 2000 });
    const spot = await page.evaluate(() => {
      const p = document.querySelector(".ft-panel");
      return { mx: Number(p.style.getPropertyValue("--mx")),
               my: Number(p.style.getPropertyValue("--my")) };
    });
    ok(Math.abs(spot.mx - 70) < 6, `the spotlight tracks the pointer horizontally (${spot.mx})`);
    ok(Math.abs(spot.my - 60) < 6, `and vertically (${spot.my})`);
    await page.close();
  }
  {
    /* THE ENLARGE BUTTON IS A 44px TARGET without being a 44px box. */
    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });
    /* THE HIT AREA IS MEASURED, NOT RECONSTRUCTED. Deriving it as
       `glyph + 2 * inset` requires knowing the glyph's advance, which is a
       property of the font file and silently different under a fallback —
       and it reads a `top` that is now a percentage. The pseudo-element
       declares its own size; read that. */
    const hit = await page.evaluate(() => {
      const b = document.querySelector(".ft-zoom-open");
      const cs = getComputedStyle(b, "::after");
      const r = b.getBoundingClientRect();
      return {
        h: Math.max(r.height, parseFloat(cs.height) || 0),
        w: Math.max(r.width, parseFloat(cs.width) || 0),
      };
    });
    ok(hit.h >= 44, `the enlarge control is at least 44px tall including its hit extension (${hit.h})`);
    ok(hit.w >= 44, `and at least 44px wide (${hit.w})`);
    await page.close();
  }
} finally {
  await browser.close();
  fs.rmSync(EMIT_DIR, { recursive: true, force: true });
}

console.log(`✓ flows-ticker: ${checks} assertions — one registry the markup, the ` +
  `drawers, the chrome and the shed ladder all read, four payloads that shipped for ` +
  `weeks with no renderer finally drawn, an enlarge that redraws rather than scales ` +
  `and cannot shrink the panels it exists for, absent and unavailable told apart, the ` +
  `three stock panels rendering the payload's own numbers and notes with quiet, ` +
  `unavailable and pre-wave absence held apart, a rank that is never rescaled and ` +
  `a strip that never bridges a gap, twenty-one panels grouped into five contiguous ` +
  `sections with one lead each and an index that links to every one of them, a page ` +
  `that opens on the overnight move with its gap and its dead-band crossing rather ` +
  `than on a snapshot — with a measured zero told from an unmeasured session in both ` +
  `directions — deep links that survive a hidden grid and a hostile hash, and a gated ` +
  `name that is finally told the gate removed it instead of being pointed at a watch ` +
  `list it cannot be on`);
