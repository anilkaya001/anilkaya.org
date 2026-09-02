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
import { TICKER_PANELS, TICKER_PANEL_KEYS, SCORE_KEY } from "../shared/flows-panels.js";

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
async function mount(page, card, { ticker = null, boards = null } = {}) {
  await page.addInitScript(({ card, boards }) => {
    window.__requested = [];
    window.fetch = (url) => {
      window.__requested.push(String(url));
      /* THE TWO SIDES ARE DIFFERENT REQUESTS, and answering both with the
         same payload double-counts every name in the picker — which is a
         defect in this stub, not in the page. `boards` stands for the LONG
         side; the short side answers empty unless a test says otherwise. */
      const u = String(url);
      const body = u.includes("/api/flows/card")
        ? card
        : (u.includes("side=long") ? (boards || { rows: [], status: "pending" })
                                   : { rows: [], status: "pending" });
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => String(Date.now()) },
        json: () => Promise.resolve(JSON.parse(JSON.stringify(body))),
      });
    };
  }, { card, boards });
  const url = "https://example.test/flows/ticker/" +
    (ticker ? "?t=" + encodeURIComponent(ticker) : "");
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
  `drawers and the shed ladder all read, four payloads that shipped for weeks with ` +
  `no renderer finally drawn, an enlarge that redraws rather than scales and cannot ` +
  `shrink the panels it exists for, absent and unavailable told apart, the three ` +
  `stock panels rendering the payload's own numbers and notes with quiet, ` +
  `unavailable and pre-wave absence held apart, a rank that is never rescaled and ` +
  `a strip that never bridges a gap, and a page that answers "no name" with an ` +
  `index instead of an error`);
