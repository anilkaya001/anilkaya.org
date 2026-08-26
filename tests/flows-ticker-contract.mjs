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
  /* ---------- 2. every panel renders, at both widths -------------- */
  for (const width of [320, 1280]) {
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
  `shrink the panels it exists for, absent and unavailable told apart, and a page ` +
  `that answers "no name" with an index instead of an error`);
