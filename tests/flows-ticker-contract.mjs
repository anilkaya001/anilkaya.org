import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import {
  buildLevels, buildContext, buildDisplacement, buildPath, buildCalendar, buildPricedMove,
} from "../shared/flows-card.js";
import {
  TICKER_PANELS, TICKER_PANEL_KEYS, SENTINEL_KEYS, TICKER_GROUPS, PANEL_TIERS,
  STATION_SIDE_COUNTS,
} from "../shared/flows-panels.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

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

for (const k of SENTINEL_KEYS) {
  ok(!TICKER_PANEL_KEYS.includes(k), `the sentinel "${k}" is not a card.panels key`);
}

const withChain = cards.filter((c) =>
  TICKER_PANEL_KEYS.every((k) => c.panels && c.panels[k]) &&
  ["ivSurface", "skewTerm", "topContracts", "aggressor"]
    .every((k) => c.panels[k].status === "ok"));
ok(withChain.length > 0,
   `at least one emitted card carries all four chain panels (${withChain.length} do)`);

const truncated = cards.filter((c) =>
  c.panels && c.panels.ivSurface && c.panels.ivSurface.coverage &&
  c.panels.ivSurface.coverage.truncated === true);

{

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

  const chromeBlock = src.slice(src.indexOf("const PANEL_CHROME = {"));
  const chromeBody = chromeBlock.slice(0, chromeBlock.indexOf("\n  };"));
  const chrome = new Map(
    [...chromeBody.matchAll(
      /^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{\s*group:\s*"([a-z]+)",\s*tier:\s*"([a-z]+)"/gm)]
      .map((m) => [m[1], { group: m[2], tier: m[3] }]));
  eq(chrome.size, TICKER_PANELS.length,
     `the controller's chrome table names every registry panel (${chrome.size} of ` +
     `${TICKER_PANELS.length}) — an entry that stopped parsing would silently shrink this ` +
     `comparison rather than fail it`);
  for (const p of TICKER_PANELS) {
    const got = chrome.get(p.key);
    ok(got, `the controller's chrome table has an entry for "${p.key}"`);
    if (!got) continue;
    eq(got.group, p.group, `and puts "${p.key}" in the registry's group`);
    eq(got.tier, p.tier, `and gives "${p.key}" the registry's tier`);
  }
  for (const key of chrome.keys()) {
    ok(regKeys.has(key),
       `the chrome entry "${key}" is a panel the registry mounts — an entry for a panel that ` +
       `is not on the page makes mountChrome report a disagreement on every paint`);
  }

  const PANEL_H = {
    __stats: 330, levels: 313, displacement: 360, context: 350,
    deltaExposure: 416, charm: 435, vanna: 435, congress: 632, calendar: 520,
    aggressor: 550, pricedMove: 584, surface: 668, ivSurface: 640, oiDeltas: 661,
    marketRank: 865, path: 712, darkpool: 688, gamma: 795, skewTerm: 829,
    volContext: 756, topContracts: 1044, __score: 1034,

    premiumTrack: 460, __sessions: 996,

    variation: 994,
  };
  eq(Object.keys(PANEL_H).length, TICKER_PANELS.length,
     `the measured-height table covers every registry panel (${Object.keys(PANEL_H).length} ` +
     `of ${TICKER_PANELS.length}) — a panel missing from it would be skipped by the pairing ` +
     `check below rather than fail it`);
  for (const p of TICKER_PANELS) {
    ok(Object.hasOwn(PANEL_H, p.key), `the height table knows "${p.key}"`);
  }

  for (const card of withChain) {
    for (const k of TICKER_PANEL_KEYS) {
      ok(Object.hasOwn(card.panels, k),
         `${card.ticker}: the emitted card carries panel "${k}"`);
    }
  }

  eq(SENTINEL_KEYS.size, 3,
     "the registry declares all three sentinels — the score derivation, the key " +
     "statistics and the session ledger");
  for (const key of SENTINEL_KEYS) {
    ok(TICKER_PANELS.some((p) => p.key === key),
       `the sentinel "${key}" is a panel the registry actually mounts`);
    ok(!TICKER_PANEL_KEYS.includes(key),
       `and "${key}" is excluded from the payload-key list — it is drawn from the card's ` +
       `top level or from the other panels, never from card.panels["${key}"], so a card ` +
       `that does not carry it is not a card that is missing anything`);
  }

  const DELIBERATELY_UNDRAWN = new Map([
    ["scoreOverlay",
      "published and READ but not drawn: the score-over-price series was dropped from the " +
      "page by the reader's own verdict — a daily score over a close told them nothing they " +
      "used — while the join it carries is what paintChange derives \"what changed\" from, " +
      "so it stays on the wire as the input to a panel rather than as a panel"],
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

  const ids = TICKER_PANELS.map((p) => p.id);
  eq(new Set(ids).size, ids.length, "every registry id is unique");
  for (const p of TICKER_PANELS) {
    ok(p.question && p.question.trim().length > 8, `panel "${p.key}" states a real question`);
    ok(p.title && p.title.trim().length > 2, `panel "${p.key}" has a title`);
    ok(p.span === 1 || p.span === 2 || p.span === 3, `panel "${p.key}" has a legal span`);
  }

  const iIvs = TICKER_PANELS.findIndex((p) => p.key === "ivSurface");
  const iTerm = TICKER_PANELS.findIndex((p) => p.key === "skewTerm");
  eq(TICKER_PANELS[iIvs].span, 2, "the IV surface spans both columns");
  eq(TICKER_PANELS[iTerm].span, 2, "and so does the term line, or they can never align");
  eq(iTerm, iIvs + 1, "and they are adjacent, so they mount at the same width");

  for (const key of ["darkpool", "oiDeltas", "volContext"]) {
    const p = TICKER_PANELS.find((x) => x.key === key);
    ok(p, `the registry mounts the ${key} panel`);
    eq(p.span, 1, `${key} is a single-column panel at every landscape tier`);
  }

  const pipe = fs.readFileSync(path.join(ROOT, "scripts/flows-pipeline.mjs"), "utf8");

  const shedFrom = pipe.indexOf("const shed = [");
  ok(shedFrom > 0, "the pipeline still declares its shed ladder as `const shed = [`");
  const shedBlock = pipe.slice(shedFrom, pipe.indexOf("\n      ];", shedFrom));

  let shedNamed = 0;
  for (const m of shedBlock.matchAll(/\[\s*"([A-Za-z_][A-Za-z0-9_]*)",\s*"dropped to fit/g)) {
    shedNamed++;
    ok(regKeys.has(m[1]), `the pipeline's shed ladder only names registry panels ("${m[1]}")`);

    ok(!SENTINEL_KEYS.has(m[1]),
       `and never a sentinel ("${m[1]}") — there is no card.panels entry for it to shed, ` +
       `so a drop would fabricate an unavailability and save nothing`);
  }
  ok(shedNamed >= 5,
     `the shed ladder was actually read (${shedNamed} entries) — a slice that stopped ` +
     `matching passes this block by making none of it`);
}

const pageHTML = FLOWS_PAGES.tickerPage({ username: "test" })
  .replace(/<script[^>]*><\/script>/g, "");
const panelsSrc = fs.readFileSync(path.join(ROOT, "assets/js/flows-panels.js"), "utf8");
const drawersSrc = fs.readFileSync(path.join(ROOT, "assets/js/flows-drawers.js"), "utf8");
const tickerSrc = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");

{
  ok(/class="ft-how"|"ft-how"/.test(panelsSrc),
     "flows-panels.js builds the disclosure — it is the module both the ticker grid and the " +
     "card dialog draw through, so the fold is available on all four routes that load it");
  eq((tickerSrc.match(/el\("details", "ft-how"\)/g) || []).length, 0,
     "and flows-ticker.js builds none of its own; it destructures appendMethod out of P " +
     "instead, so the wall threshold is decided in exactly one place");
  for (const name of ["appendMethod", "leadReading"]) {
    ok(new RegExp("panelHead, panelWidth, [^\\n]*" + name).test(panelsSrc),
       `flows-panels.js exports ${name} on window.FlowsPanels — an export that goes missing ` +
       "fails here rather than only on the page that consumes it");
  }
  ok(/appendMethod, leadReading,\n  \} = P;/.test(tickerSrc),
     "and flows-ticker.js reads both back out of the module rather than restating them");

  ok(/function appendNotes\(host, notes, summary\) \{\n\s*appendMethod\(/.test(tickerSrc),
     "the string-shaped appendNotes that stayed is a four-line adapter over the moved " +
     "appendMethod, not a second implementation of the fold");
  ok(!/NOTE_WALL_CHARS/.test(tickerSrc),
     "and the wall threshold itself is not restated in this file at all — two numbers named " +
     "\"how long is too long\" is two answers a reader would have to reconcile");
}

{
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const served = FLOWS_PAGES.tickerPage({ username: "test" });

  eq((served.match(/<section class="ft-station"/g) || []).length, TICKER_GROUPS.length,
     `the served page carries all ${TICKER_GROUPS.length} stations`);
  for (const g of TICKER_GROUPS) {
    ok(served.includes(`id="ftst-${g.key}" role="tabpanel"`),
       `station ${g.key} is served as a tabpanel with its own id`);
    ok(served.includes(`data-group="${g.key}" data-side="${g.key}"`),
       `and carries both its registry group and its ?s= address (${g.key})`);
    ok(served.includes(esc(g.blurb)),
       `and the group's own sentence is in the bytes (${g.key}) — not fetched, not built`);
    ok(served.includes(`>${esc(g.label)} <span`),
       `and its tab prints the label (${g.label})`);
  }

  for (const p of TICKER_PANELS) {

    ok(served.includes(`<p class="ft-panel-q">${esc(p.question)}</p>`),
       `panel ${p.key}'s question is served as visible prose, not only as an attribute`);
    ok(served.includes(`data-question="${esc(p.question)}"`),
       `and still as the attribute the drawers are handed (${p.key})`);
    ok(served.includes(`data-group="${p.group}" data-tier="${p.tier}"`),
       `panel ${p.key} is served already in its group and tier`);
    ok(served.includes(`id="panel-${p.key}"`),
       `and with the fragment id a link names it by (${p.key}), so a deep link resolves ` +
       `before any script runs`);
    ok(served.includes(`<p class="ft-panel-one" id="${p.id}One"></p>`),
       `panel ${p.key} carries an EMPTY one-line slot — a placeholder with words in it is ` +
       `a sentence a reader would believe`);
    const marked = new RegExp(
      `id="panel-${p.key}"[\\s\\S]{0,200}?data-sentinel`).test(served);
    eq(marked, SENTINEL_KEYS.has(p.key),
       `panel ${p.key} is marked data-sentinel exactly when the registry says so — the ` +
       `browser cannot import SENTINEL_KEYS, so this is how the walk knows not to tell a ` +
       `reader their card "predates" a panel no payload has ever carried`);
  }

  ok(!served.includes('class="fc-q"'),
     "no renderer's own question is in the served bytes — the served copy stands alone " +
     "until a card lands");

  for (const id of ["ftFrom", "ftSector", "ftAtr", "ftRankNav", "ftFind", "ftPrem", "ftEarn"]) {
    eq((served.match(new RegExp(`id="${id}"`, "g")) || []).length, 1,
       `the band slot ${id} is served exactly once`);

    const at = served.indexOf(`id="${id}"`);
    const close = served.indexOf(">", at);
    const attrs = served.slice(at, close);
    ok(/\bhidden\b/.test(attrs),
       `and ${id} is served hidden — a VISIBLE empty slot claims a measurement was taken ` +
       `and came back with nothing, a different fact from "not yet painted"`);
    ok(!/\bvalue=/.test(attrs), `and carries no value of its own (${id})`);

    if (id !== "ftFind") {
      eq(served.slice(close + 1, close + 3), "</",
         `and ${id} is served with nothing inside it`);
    }
  }
  ok(served.includes('<datalist id="ftFindNames"></datalist>'),
     "the find box's datalist is served empty beside it");
  ok(served.includes('id="ftBar"') && served.includes('class="ft-tabs" role="tablist"'),
     "the sticky bar and its tablist are served rather than built on first paint");
}

async function mount(page, card,
                     { ticker = null, boards = null, hash = "", events = null,
                       html = null, station = "all" } = {}) {

  const installFetch = ({ card, boards, events }) => {
    window.__requested = [];
    window.fetch = (url) => {
      window.__requested.push(String(url));

      const u = String(url);

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
  };

  const query = [
    ticker ? "t=" + encodeURIComponent(ticker) : null,
    station ? "s=" + encodeURIComponent(station) : null,
  ].filter(Boolean).join("&");
  const url = "https://example.test/flows/ticker/" +
    (query ? "?" + query : "") + (hash ? "#" + hash : "");

  await page.route("**/*",
    (route) => route.fulfill({ contentType: "text/html", body: html || pageHTML }));

  await page.route("**/assets/js/flows-drawers.js*",
    (route) => route.fulfill({ contentType: "text/javascript", body: drawersSrc }));
  await page.goto(url);
  await page.evaluate(installFetch, { card, boards, events });
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/base.css") });
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/flows.css") });
  await page.addScriptTag({ content: panelsSrc });
  await page.addScriptTag({ content: tickerSrc });
  await page.waitForFunction(() => {
    const g = document.getElementById("ftGrid");

    return g && document.getElementById("ftStatus").textContent !== "Loading the name…";
  }, null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const flow = document.getElementById("ftFlow");
    return !flow || !flow.hidden;
  }, null, { timeout: 4000 }).catch(() => {});
}

function sweepPanels() {
  const out = [];
  for (const section of document.querySelectorAll(".ft-panel[data-panel]")) {
    const host = section.querySelector("div");

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

        if (r.left < box.left - 2 || r.right > box.right + 2) clipped = true;
      }
    }
    out.push({
      key: section.dataset.panel,
      question: section.dataset.question || "",

      drawnQ: host.querySelector(".fc-q") ? host.querySelector(".fc-q").textContent : "",
      dead: !!host.querySelector(".fc-dead"),
      empty: host.childElementCount === 0,
      wide: section.classList.contains("is-wide"),
      full: section.classList.contains("is-full"),
      boxW: Math.round(section.getBoundingClientRect().width),

      hostW: Math.floor(host.getBoundingClientRect().width),

      wrapBound: [...host.querySelectorAll(".fc-tablewrap")].map((w) => [
        Math.round(w.scrollHeight), Math.round(w.clientHeight),
        w.querySelectorAll("tbody tr").length,
      ]),
      minText: minText === Infinity ? null : Math.round(minText * 10) / 10,
      clipped,

      scales: svgs.map((s) => {
        const vb = (s.getAttribute("viewBox") || "").split(/\s+/);
        return [Number(vb[2]), s.getBoundingClientRect().width,
                getComputedStyle(s).transform];
      }),
      labelled: svgs.every((s) => !!s.getAttribute("aria-label") && s.getAttribute("role") === "img"),
      unlabelled: svgs.filter((s) => !s.getAttribute("aria-label")).length,
      svgCount: svgs.length,

      decorativeClean: decorative.every(
        (s) => !s.getAttribute("aria-label") && s.getAttribute("role") !== "img"),
    });
  }
  return out;
}

const browser = await chromium.launch();
try {

  for (const width of [320, 1280, 1840]) {
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain[0];

    await mount(page, card, { ticker: card.ticker, station: "all" });

    eq(errors.length, 0, `${width}px: the ticker page paints a real card without throwing (${errors.join("; ")})`);

    const swept = await page.evaluate(sweepPanels);
    eq(swept.length, TICKER_PANELS.length, `${width}px: every registry panel is mounted`);

    for (const p of swept) {

      ok(!p.empty, `${width}px ${p.key}: renders content or an explicit unavailable notice`);
      ok(p.question.length > 0, `${width}px ${p.key}: its question reached the DOM`);

      ok(!p.drawnQ.includes("[object"),
         `${width}px ${p.key}: the question it DREW is a sentence, not a stringified ` +
         `object ("${p.drawnQ.slice(0, 56)}")`);
      eq(p.drawnQ, p.question,
         `${width}px ${p.key}: draws the registry's question verbatim — the one this ` +
         "page's markup handed it, not the drawer's own hardcoded fallback, which is how " +
         "one drawing wore two different questions while a card dialog drew these same " +
         "renderers with no question at all");
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

      for (const [vb, rendered, transform] of p.scales) {
        ok(vb > 0, `${width}px ${p.key}: the chart declares a viewBox width`);
        ok(Math.abs(rendered - vb) < 1,
           `${width}px ${p.key}: one viewBox unit is one CSS pixel — drawn ${vb}, ` +
           `rendered ${rendered.toFixed(2)} (${(rendered / vb).toFixed(4)})`);
        eq(transform, "none", `${width}px ${p.key}: the chart is drawn, never CSS-scaled`);

        ok(vb <= p.hostW + 1,
           `${width}px ${p.key}: the drawing is never wider than its host, or ` +
           `max-width:100% shrinks it and one unit stops being one pixel — ` +
           `viewBox ${vb}, host ${p.hostW}`);
      }

      if (!p.wide) {
        for (const [scrollH, clientH, rows] of p.wrapBound) {
          ok(clientH <= 417,
             `${width}px ${p.key}: a span-1 panel's table is bounded, so its ` +
             `row-mates are not stretched by a vendor's row count (${clientH}px)`);
          if (scrollH > clientH) {
            ok(rows > 0,
               `${width}px ${p.key}: the bounded table still holds its rows — ` +
               `bounded is not truncated (${rows} row(s) in ${scrollH}px of scroll)`);
          }
        }
      }
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, `${width}px: the page itself never scrolls sideways (${overflow}px over)`);

    if (width >= 1280) {
      const wide = swept.filter((p) => p.wide);
      const narrow = swept.filter((p) => !p.wide && !p.full);
      for (const p of swept.filter((x) => x.full)) {
        ok(p.boxW > Math.max(...wide.map((w) => w.boxW)) * 1.3,
           `1280px ${p.key}: is-full spans every column (${p.boxW})`);
      }
      ok(wide.length > 0 && narrow.length > 0, "1280px: the grid mixes wide and narrow panels");
      const narrowW = Math.max(...narrow.map((p) => p.boxW));
      for (const p of wide) {
        ok(p.boxW > narrowW * 1.8,
           `1280px ${p.key}: is-wide really spans both columns (${p.boxW} vs ${narrowW})`);
      }

      const ivs = swept.find((p) => p.key === "ivSurface");
      const term = swept.find((p) => p.key === "skewTerm");
      ok(Math.abs(ivs.boxW - term.boxW) <= 1,
         `1280px: the surface and the term line mount at the same width (${ivs.boxW} vs ${term.boxW})`);

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

    if (width >= 1840) {

      const tracks = await page.evaluate(() =>
        getComputedStyle(document.getElementById("ftGrid")).gridTemplateColumns
          .split(" ").filter((t) => parseFloat(t) > 0).length);
      eq(tracks, 3,
         `${width}px: the grid opens its third column at the 108rem tier (${tracks})`);
    }
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker, station: null });
    eq(errors.length, 0,
       `the switcher paints without throwing (${errors.join("; ")})`);

    const shown = () => page.evaluate(() => {
      const out = { open: [], hidden: [], selected: [], current: [], url: location.search };
      for (const s of document.querySelectorAll(".ft-station[data-group]")) {
        (s.hidden ? out.hidden : out.open).push(s.dataset.group);
      }
      for (const a of document.querySelectorAll("#ftBar [data-side]")) {
        if (a.getAttribute("aria-selected") === "true") out.selected.push(a.dataset.side);
        if (a.getAttribute("aria-current") === "true") out.current.push(a.dataset.side);
      }
      return out;
    });

    const first = await shown();
    eq(first.open.length, 5,
       `on arrival every station is in the document (${first.open.join(", ") || "none"})`);
    eq(first.hidden.length, 0,
       `and none is hidden from a reader who asked for nothing (${first.hidden.length} hidden)`);
    ok(!/[?&]s=/.test(first.url),
       `and the default writes no s= into the address, because it is what the page ` +
       `does without one (${first.url || "empty"})`);

    await page.click('.ft-tab[data-side="convexity"]');
    const after = await shown();
    eq(after.open.join(","), "convexity",
       `clicking a tab makes its station the only one open (${after.open.join(", ")})`);
    ok(after.url.includes("s=convexity"),
       `and the URL says which station a reader is looking at (${after.url})`);

    await page.goBack();

    await page.waitForFunction(() => [...document.querySelectorAll(
      '.ft-station[data-group]')].every((s) => !s.hidden), null, { timeout: 4000 });
    const back = await shown();
    eq(back.open.length, 5,
       `Back returns to the view the reader came from, which is all five (${back.open.join(", ")})`);

    const allPage = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    await mount(allPage, card, { ticker: card.ticker, station: "all" });
    const every = await allPage.evaluate(() =>
      [...document.querySelectorAll(".ft-station[data-group]")].filter((s) => !s.hidden).length);
    eq(every, 5, `s=all puts every station back in the document (${every} of 5)`);
    await allPage.close();

    const badPage = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    await mount(badPage, card, { ticker: card.ticker, station: "not-a-station" });
    const bad = await badPage.evaluate(() =>
      [...document.querySelectorAll(".ft-station[data-group]")].filter((s) => !s.hidden)
        .map((s) => s.dataset.group));

    eq(bad.length, 5,
       `an unknown ?s= falls back to the default view rather than hiding everything ` +
       `(${bad.join(", ") || "none"})`);
    await badPage.close();

    const deepPage = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    await mount(deepPage, card, { ticker: card.ticker, hash: "panel-gamma", station: null });
    const deep = await deepPage.evaluate(() => {
      const panel = document.getElementById("panel-gamma");
      const station = panel && panel.closest(".ft-station");
      return { group: station && station.dataset.group, hidden: !station || station.hidden };
    });
    eq(deep.hidden, false,
       `a deep link to a panel opens the station that holds it (${deep.group})`);
    await deepPage.close();

    for (const [query, want] of [
      ["&s=all#ftg-convexity", "signal,convexity,volatility,tape,context"],
      ["&s=all", "signal,convexity,volatility,tape,context"],
      ["#ftg-convexity", "convexity"],

      ["", "signal,convexity,volatility,tape,context"],
      ["&s=volatility#panel-gamma", "convexity"],
      ["&s=bogus", "signal,convexity,volatility,tape,context"],
    ]) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const hash = query.includes("#") ? query.slice(query.indexOf("#") + 1) : "";
      const sParam = /[?&]s=([^#&]*)/.exec(query);
      await mount(p, card, {
        ticker: card.ticker, hash,
        station: sParam ? decodeURIComponent(sParam[1]) : null,
      });
      const open = await p.evaluate(() =>
        [...document.querySelectorAll(".ft-station[data-group]")]
          .filter((s) => !s.hidden).map((s) => s.dataset.group).join(","));
      eq(open, want, `?t=X${query || " (no station named)"} opens ${want} (${open || "none"})`);
      await p.close();
    }

    const scales = await page.evaluate(() => {
      const out = [];
      for (const s of document.querySelectorAll(".ft-station[data-group]")) {
        if (s.hidden) continue;
        for (const svg of s.querySelectorAll("svg")) {
          const vb = (svg.getAttribute("viewBox") || "").split(/\s+/);
          if (vb.length !== 4) continue;
          out.push([s.dataset.group, Number(vb[2]), svg.getBoundingClientRect().width]);
        }
      }
      return out;
    });
    ok(scales.length > 0, `the open station draws at least one chart (${scales.length})`);
    for (const [group, vb, rendered] of scales) {
      ok(Math.abs(rendered - vb) < 1,
         `switched: one viewBox unit is one CSS pixel in the open station ` +
         `(${group}: drawn ${vb}, rendered ${rendered.toFixed(2)})`);
    }
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const card = JSON.parse(JSON.stringify(withChain[0]));
    card.score = 71;
    await mount(page, card, { ticker: card.ticker, station: "all" });
    const got = await page.evaluate(() => {
      const px = (n) => parseFloat(getComputedStyle(n).fontSize);
      const score = document.getElementById("ftHeroScore"), conv = document.getElementById("ftHeroConv");
      const chartPx = (id) => {
        const svg = document.querySelector("#" + id + " svg");
        const t = svg && svg.querySelector("text.ft-chart-ax");
        return t ? +(px(t) * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width)).toFixed(2) : null;
      };
      const sess = document.querySelector("#panel-__sessions tbody tr:first-child td:nth-child(3)");
      return {
        heroValues: document.querySelectorAll(".ft-hero-v").length,
        scoreCls: score.className, scorePx: px(score), convPx: px(conv),
        chgCls: document.getElementById("ftHeroChg").className,
        sessCls: sess ? sess.className : null, sessAlign: sess ? getComputedStyle(sess).textAlign : null,
        seriesPx: chartPx("ftChartBody"), garchPx: chartPx("ftGarchBody"),
        chainHead: [...document.querySelectorAll("#ftChain thead th")].map((t) => t.textContent),
        chainExp: [...document.querySelectorAll("#ftChain td.ftc-exp")].map((t) => t.textContent),
        flags: [...document.querySelectorAll(".ft-flag")].map((f) => f.textContent),
        stations: [...document.querySelectorAll("h2.ft-group")].map((h) => h.getBoundingClientRect().height),
        leads: [...document.querySelectorAll(".ft-station-lead")].map((p) => p.getBoundingClientRect().height),
        topbarVar: document.body.style.getPropertyValue("--topbar-h"),
        topbarH: Math.round(document.querySelector(".topbar").getBoundingClientRect().height),
        barTop: getComputedStyle(document.getElementById("ftBar")).top,
        headHidden: getComputedStyle(document.getElementById("ftTicker")).display,
        switchShown: getComputedStyle(document.getElementById("ftSwitch")).display,
        heroShown: document.getElementById("ftBar").classList.contains("is-hero-shown"),
        ivt: [...document.querySelectorAll("#ftIvtBody svg text.ft-chart-ax")].map((t) => t.textContent),
      };
    });
    ok(/^ft-hero-v is-(pos|neg|flat)$/.test(got.scoreCls),
       `the hero score keeps its base class beside its polarity (${got.scoreCls})`);
    eq(got.scorePx, got.convPx,
       `so it is set at the same size as its neighbours (${got.scorePx} vs ${got.convPx})`);
    ok(/^ft-hero-chg is-(pos|neg|flat|null)$/.test(got.chgCls), `and the day change likewise (${got.chgCls})`);
    ok(got.sessCls && /^c-num is-/.test(got.sessCls) && got.sessAlign === "right",
       `the ledger's score cell keeps its numeric class and stays right-aligned (${got.sessCls}, ${got.sessAlign})`);
    ok(got.seriesPx !== null && got.seriesPx >= 10 && got.garchPx !== null && got.garchPx >= 10,
       `the Series and volatility axis text renders at ten CSS pixels or more (${got.seriesPx}, ${got.garchPx})`);
    eq(got.chainHead.slice(1, 3).join(","), "Strike,Expiry",
       `the chain names the expiry beside the strike, so two lines at one strike are distinguishable (${got.chainHead.join(",")})`);
    ok(got.chainExp.length > 0 && got.chainExp.every((t) => /^\d{2}-\d{2}( · -?\d+d)?$|^—$/.test(t)),
       `and every expiry cell is a month-day with its days out (${got.chainExp.slice(0, 3).join(" | ")})`);
    ok(got.flags.every((f) => !/ flow$/.test(f)),
       `no flag claims a direction of flow from the score's side (${got.flags.join(", ")})`);
    ok(got.stations.length === TICKER_GROUPS.length && got.stations.every((h) => h > 10) && got.leads.every((h) => h > 10),
       `every station heading and lead is visible, not clipped to a pixel (${got.stations.join(",")})`);
    ok(got.topbarVar === got.topbarH + "px",
       `the page publishes the measured topbar height (${got.topbarVar} for ${got.topbarH}px)`);
    ok(got.heroShown && got.headHidden === "none" && got.switchShown !== "none",
       "at scroll zero the hero is in view, so the bar does not repeat its identity while the name switcher stays reachable");
    ok(got.ivt.length >= 2 && got.ivt.slice(3).every((t) => /^\d+d$/.test(t)),
       `the term-structure ticks count days to expiry (${got.ivt.join(",")})`);
    await page.evaluate(() => {
      const s = document.getElementById("ftScroll");
      if (s && getComputedStyle(s).overflowY !== "visible") s.scrollTo({ top: 900, behavior: "instant" });
      else window.scrollTo({ top: 900, behavior: "instant" });
    });
    await page.waitForFunction(() => !document.getElementById("ftBar").classList.contains("is-hero-shown"), null, { timeout: 3000 });
    const after = await page.evaluate(() => ({
      headDisplay: getComputedStyle(document.getElementById("ftTicker")).display,
      headH: document.getElementById("ftHead").getBoundingClientRect().height,
    }));
    ok(after.headDisplay !== "none" && after.headH > 20,
       `once the hero has scrolled away the identity row takes its place in the bar (${after.headH}px)`);
    await page.close();

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mount(phone, card, { ticker: card.ticker, station: "all" });
    await phone.evaluate(() => window.scrollTo({ top: 1200, behavior: "instant" }));
    await phone.waitForTimeout(300);
    const narrow = await phone.evaluate(() => {
      const bar = document.getElementById("ftBar"), tb = document.querySelector(".topbar");
      const tab = document.getElementById("askDockTab");
      const tabBox = tab ? tab.getBoundingClientRect() : null;
      return {
        scroller: getComputedStyle(document.getElementById("ftScroll")).overflowY,
        gap: Math.round(bar.getBoundingClientRect().top - tb.getBoundingClientRect().bottom),
        barTop: getComputedStyle(bar).top, topbarH: Math.round(tb.getBoundingClientRect().height),
        dock: tabBox ? { bottom: Math.round(innerHeight - tabBox.bottom), h: Math.round(tabBox.height), mode: getComputedStyle(tab).writingMode } : null,
        chainCut: document.getElementById("ftChainBody").classList.contains("is-cut-end"),
        chainOver: document.getElementById("ftChainBody").scrollWidth - document.getElementById("ftChainBody").clientWidth,
      };
    });
    eq(narrow.scroller, "visible", "at phone width the window is the scroller, under a fixed topbar");
    ok(narrow.gap === 0 && narrow.barTop === narrow.topbarH + "px",
       `so the sticky bar sits flush under the topbar rather than a fixed 4.4rem down (gap ${narrow.gap}px, top ${narrow.barTop} for ${narrow.topbarH}px)`);
    ok(narrow.dock && narrow.dock.mode === "horizontal-tb" && narrow.dock.bottom < 40 && narrow.dock.h >= 44,
       `the Ask tab is a bottom-right pill of at least 44px, not a vertical tab over the reading column (${JSON.stringify(narrow.dock)})`);
    ok(narrow.chainOver <= 4 || narrow.chainCut,
       `and a chain wider than its host is marked cut, so its fade says there is more (${narrow.chainOver}px over, cut ${narrow.chainCut})`);
    await phone.close();
  }

  {
    const base = JSON.parse(JSON.stringify(withChain[0]));
    base.atr = 2.5;
    base.gammaFlip = 101.25;
    base.panels.levels = {
      status: "ok", spot: 100, atr: 2.5,
      levels: [
        { kind: "max_pain", label: "Max pain", px: 105, distPct: 0.05, distAtr: 2 },
        { kind: "put_wall", label: "Put wall", px: 90, distPct: -0.1, distAtr: -4 },
        { kind: "call_wall", label: "Call wall", px: 120, distPct: 0.2, distAtr: 8 },
      ],
    };
    base.panels.pricedMove = { status: "ok", movePerc: 0.0731 };
    base.panels.volContext = {
      status: "ok",
      ivRank: {
        status: "ok", rankUnit: "percent 0-100, as published",
        rows: [
          { date: "2026-05-01", rank1y: 11.1 },
          { date: "2026-08-28", rank1y: 73.4 },
          { date: "2026-07-15", rank1y: 44.4 },
        ],
      },
    };

    const read = async (card) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      await mount(page, card, { ticker: card.ticker });
      const out = await page.evaluate(() => {
        const host = document.getElementById("ftStats");
        if (!host) return null;
        const rows = {};
        for (const stat of host.querySelectorAll(".fc-stat")) {
          const dd = stat.querySelector("dd");
          rows[stat.querySelector("dt").textContent] = {
            text: dd.textContent, empty: dd.dataset.empty || null, why: dd.title || "",
          };
        }
        return rows;
      });
      await page.close();
      return out;
    };

    const r = await read(base);
    ok(r && Object.keys(r).length >= 8,
       `key statistics draws its rows rather than a pending note (${r ? Object.keys(r).length : 0})`);
    eq(r.Spot.text, "$100.00", `spot is this card's spot (${r.Spot.text})`);
    eq(r.ATR.text, "$2.50", `the ATR is this card's (${r.ATR.text})`);
    eq(r["Max pain"].text, "$105.00 · +2.00 ATR",
       `a wall carries its price AND its distance in ATR, the unit that compares ` +
       `across names where a percentage does not (${r["Max pain"].text})`);
    eq(r["Put wall"].text, "$90.00 · \u22124.00 ATR",
       `and a wall below spot is signed (${r["Put wall"].text})`);
    eq(r["Gamma flip"].text, "$101.25", `the flip when it is published (${r["Gamma flip"].text})`);
    eq(r["Priced move"].text, "\u00b17.3%", `the priced move (${r["Priced move"].text})`);
    eq(r["IV rank"].text, "73.4% · 2026-08-28",
       `THE RANK IS PICKED BY DATE, NOT BY INDEX — 73.4 on 2026-08-28 is the ` +
       `newest of three deliberately shuffled rows; 11.1 would mean rows[0] and ` +
       `44.4 would mean the last row (${r["IV rank"].text})`);

    const noFlip = JSON.parse(JSON.stringify(base));
    noFlip.gammaFlip = null;
    const q = await read(noFlip);
    eq(q["Gamma flip"].empty, "quiet",
       `a card with no published flip says so under the quiet mark rather than ` +
       `printing a bare dash (${q["Gamma flip"].empty})`);
    ok(/does not change sign/.test(q["Gamma flip"].why),
       `and gives the gamma panel's own reason for it (${q["Gamma flip"].why})`);

    const dead = JSON.parse(JSON.stringify(base));
    dead.panels.volContext = { status: "unavailable", reason: "The vendor returned no volatility history." };
    const d = await read(dead);
    eq(d["IV rank"].empty, "unavailable",
       `an unreadable source panel makes its row unavailable, never quiet (${d["IV rank"].empty})`);
    eq(d.Spot.empty, null,
       `and it does not silence the rows that came from panels that DID publish ` +
       `(spot: ${JSON.stringify(d.Spot)})`);
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const long = JSON.parse(JSON.stringify(withChain[0]));
    const members = Array.from({ length: 40 }, (_, i) => `Representative Number ${i + 1}`);
    long.panels.congress = {
      status: "ok", asOf: "2026-08-24", total: 40, buys: 20, sells: 20,
      medianLagDays: 31,
      trades: members.map((member, i) => ({
        member, chamber: i % 2 ? "senate" : "house",
        issuer: "Synthetic Holdings Inc", side: i % 2 ? "buy" : "sell",
        txnDate: "2026-07-0" + ((i % 9) + 1), filedDate: "2026-08-0" + ((i % 9) + 1),
        lagDays: 30 + i, amountLow: 1000 * (i + 1), amountHigh: 15000 * (i + 1),
      })),
    };
    await mount(page, long, { ticker: long.ticker, station: "all" });
    eq(errors.length, 0, `a forty-row disclosure list paints without throwing (${errors.join("; ")})`);

    const seen = await page.evaluate(() => {
      const panel = document.querySelector('.ft-panel[data-panel="congress"]');
      const wrap = panel && panel.querySelector(".fc-tablewrap");
      return {
        found: !!wrap,
        clientH: wrap ? Math.round(wrap.clientHeight) : null,
        scrollH: wrap ? Math.round(wrap.scrollHeight) : null,
        rows: wrap ? wrap.querySelectorAll("tbody tr").length : 0,
        text: panel ? panel.textContent : "",

        panelH: panel ? Math.round(panel.getBoundingClientRect().height) : null,
        focusable: wrap ? wrap.tabIndex : null,
        region: wrap ? wrap.getAttribute("role") : null,
      };
    });

    ok(seen.found, "the disclosure table is inside a wrapper that can be bounded");
    ok(seen.scrollH > seen.clientH,
       `forty rows really overflow the bound, so this case exercises it — ` +
       `${seen.scrollH}px of table in ${seen.clientH}px of box`);
    ok(seen.clientH <= 417,
       `the wrapper is bounded at 26rem, so a filing count cannot set the row's ` +
       `height (${seen.clientH}px)`);
    eq(seen.rows, 40,
       `every disclosed trade is still in the DOM — bounded, never truncated (${seen.rows})`);
    const missing = members.filter((m) => !seen.text.includes(m));
    eq(missing.length, 0,
       `and every member is still findable by find-in-page, including the ones ` +
       `below the fold (${missing.slice(0, 3).join(", ")})`);

    eq(seen.focusable, 0, `the bounded region is reachable by keyboard (tabIndex ${seen.focusable})`);
    eq(seen.region, "region", `and announces itself as a region (${seen.region})`);
    ok(seen.panelH < 900,
       `the panel that was measured at 1371px no longer sets its row from the ` +
       `vendor's row count (${seen.panelH}px)`);
    await page.close();
  }

  {
    const errors = [];
    const base = withChain[0];
    const ctxOf = (patch) => {
      const card = JSON.parse(JSON.stringify(base));
      card.panels.context = { ...card.panels.context, ...patch };
      return card;
    };

    const readCtx = async (card) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker, station: "all" });
      const out = await page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="context"] div');
        const q = host && host.querySelector(".fc-note.is-qualifier");
        return { text: q ? q.textContent : null, all: host ? host.textContent : "" };
      });
      await page.close();
      return out;
    };

    const clean = await readCtx(ctxOf({ dropped: 0, sessions: 42, datedSessions: 42 }));
    ok(clean.text && /42 consecutive close/.test(clean.text),
       `a gapless window says so and says how many sessions (${clean.text})`);
    ok(clean.text && /none dropped/.test(clean.text),
       "and states the absence of gaps as a measurement rather than by silence");

    const gappy = await readCtx(ctxOf({ dropped: 3, sessions: 39, datedSessions: 39 }));
    ok(gappy.text && /3 session\(s\) dropped/.test(gappy.text),
       `a window with gaps names how many were dropped (${gappy.text})`);
    ok(gappy.text && /ORDER, not on a time axis/.test(gappy.text),
       "and warns that the axis is order rather than time, which is what makes a " +
       "segment spanning a gap indistinguishable from one spanning a session");

    const legacyCard = JSON.parse(JSON.stringify(base));
    delete legacyCard.panels.context.dropped;
    delete legacyCard.panels.context.sessions;
    delete legacyCard.panels.context.datedSessions;
    delete legacyCard.panels.context.closeDates;
    const legacy = await readCtx(legacyCard);
    eq(legacy.text, null,
       `a card that predates these fields says NOTHING about gaps — "none dropped" ` +
       `would be a confident zero about a filter that never ran (${legacy.text})`);
    ok(legacy.all.length > 0 && !/dropped/.test(legacy.all),
       "and the panel still draws its returns, so the absence costs a caveat and " +
       "not the reading");

    eq(errors.length, 0, `none of the three windows throws (${errors.join("; ")})`);
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker, station: "all" });

    const leads = await page.evaluate(() =>
      [...document.querySelectorAll("#ftGrid .ft-station[data-group]")].map((st) => ({
        group: st.dataset.group,
        text: String((st.querySelector(":scope > .ft-station-lead") || {}).textContent || "").trim(),
        panels: st.querySelectorAll(":scope > .ft-panel[data-panel]").length,

        own: st.querySelectorAll(":scope > .ft-station-lead").length,
      })));

    eq(leads.length, 5, "all five stations are inspected");
    for (const st of leads) {
      eq(st.own, 1, `station ${st.group} has exactly one lead slot of its own`);
      ok(st.text.length > 0,
         `station ${st.group} writes its coverage line — the slot was served empty and ` +
         `nothing had ever written to it on any card, for the life of the markup`);
      ok(/\d/.test(st.text),
         `and it carries a NUMBER (${st.group}: "${st.text}") — a one-liner with no ` +
         `figure in it is prose, not a reading`);
      const drawn = /(\d+) of (\d+) drawn/.exec(st.text);
      ok(drawn !== null,
         `stating a count against its own denominator — a count with no denominator ` +
         `cannot say whether a station is thin or ordinary (${st.text})`);
      if (!drawn) continue;
      eq(Number(drawn[2]), st.panels,
         `${st.group}: the denominator is this station's own panel count, not a constant ` +
         `a registry change would leave behind`);
      const withheld = /(\d+) withheld/.exec(st.text);
      const quiet = /(\d+) quiet/.exec(st.text);
      eq(Number(drawn[1]) + (withheld ? Number(withheld[1]) : 0) + (quiet ? Number(quiet[1]) : 0),
         st.panels,
         `${st.group}: drawn + withheld + quiet accounts for every panel in the station ` +
         `("${st.text}") — a coverage line whose parts do not sum to its whole is ` +
         `describing some other station`);
      if (withheld) {
        ok(/withheld — the source did not return/.test(st.text),
           `${st.group}: a withheld panel says the source did not RETURN`);
      }
      if (quiet) {
        ok(/quiet — the source answered and measured nothing/.test(st.text),
           `${st.group}: a quiet panel says the source ANSWERED and measured nothing — ` +
           `the two silences stay two sentences here as they do everywhere else`);
      }
    }

    const other = withChain.find((c) => c.ticker !== card.ticker) || fixtures[0];
    await mount(page, other, { ticker: other.ticker, station: "all" });
    const again = await page.evaluate(() =>
      [...document.querySelectorAll("#ftGrid .ft-station[data-group]")].map((st) => ({
        group: st.dataset.group,
        text: String((st.querySelector(":scope > .ft-station-lead") || {}).textContent || "").trim(),
        panels: st.querySelectorAll(":scope > .ft-panel[data-panel]").length,
      })));
    for (const st of again) {
      const drawn = /(\d+) of (\d+) drawn/.exec(st.text);
      ok(drawn !== null && Number(drawn[2]) === st.panels,
         `${st.group}: a second card rewrites the line rather than appending to it ` +
         `("${st.text}")`);
      eq((st.text.match(/drawn/g) || []).length, 1,
         `${st.group}: and says "drawn" exactly once, so nothing accumulated`);
    }

    const led = JSON.parse(JSON.stringify(card));
    led.panels.levels = buildLevels({
      spot: 180, atr: 4.2, gammaFlip: 182.5, maxPain: 175, callWall: 195, putWall: 165,
    });
    led.panels.context = buildContext({
      closes: Array.from({ length: 40 }, (_, i) => 150 + i * 0.8),
      r5: 0.012, r21: 0.084, r42: 0.11, week52Pos: 0.91, changePct: 0.004,
    });
    led.panels.displacement = buildDisplacement([
      { strike: 180, call_gamma_oi: 1e6, put_gamma_oi: 0, call_gamma_vol: 0, put_gamma_vol: 0 },
      { strike: 186, call_gamma_oi: 0, put_gamma_oi: 0, call_gamma_vol: 1e6, put_gamma_vol: 0 },
    ], { atr: 4, spot: 183 });

    led.panels.path = buildPath(Array.from({ length: 5 }, (_, i) => ({
      tape_time: new Date(Date.UTC(2026, 7, 24, 13, 31 + i)).toISOString(),
      net_delta: 250000, net_call_premium: 2500000, net_put_premium: 0,
    })), { sessionDate: "2026-08-24" });

    led.panels.calendar = buildCalendar([
      { expiry: "2026-08-28", call_gamma: 100, put_gamma: 50 },
      { expiry: "2026-09-04", call_gamma: 60, put_gamma: 40 },
      { expiry: "2026-10-16", call_gamma: 30, put_gamma: 20 },
    ], { asOf: "2026-08-24" });

    led.panels.pricedMove = buildPricedMove({
      spot: 180, iv30: 0.32, rv30: 0.21, impliedMovePerc: 0.025, vrp: 0.11,
    });
    await mount(page, led, { ticker: led.ticker, station: "all" });

    const ones = await page.evaluate(() =>
      [...document.querySelectorAll("#ftGrid .ft-panel[data-panel]")]
        .map((section) => ({
          key: section.dataset.panel,
          one: String((section.querySelector(":scope > .ft-panel-one") || {}).textContent || "").trim(),
        }))
        .filter((p) => p.one));

    assert.deepEqual(ones.map((p) => p.key).sort(),
      ["aggressor", "calendar", "charm", "congress", "context", "darkpool",
        "deltaExposure", "displacement", "levels", "marketRank", "oiDeltas",
        "path", "pricedMove", "surface", "topContracts",
        "vanna", "variation", "volContext"],
      `exactly the panels that publish a lead have a filled slot ` +
      `(${ones.map((p) => p.key).join(", ") || "none"})`); checks++;

    for (const p of ones) {
      const published = led.panels[p.key].lead;
      eq(p.one, published.say,
         `${p.key}: the slot prints the publisher's sentence VERBATIM — a renderer that ` +
         `composed or edited it would be a second author for one reading`);

      const quotedNums = new Set();
      const quotedText = new Set();
      for (const v of Object.values(published.n)) {
        if (typeof v === "number") quotedNums.add(String(v));
        else if (typeof v === "string" && /\D/.test(v)) quotedText.add(v);
      }
      let stripped = published.say;
      for (const v of quotedText) stripped = stripped.split(v).join(" ");
      for (const lit of stripped.match(/-?\d+(?:\.\d+)?/g) || []) {
        ok(quotedNums.has(lit) || quotedNums.has(String(Number(lit))),
           `${p.key}: "${lit}" in "${published.say.slice(0, 52)}" is pinned in n — an ` +
           `unpinned figure is one a rephrasing could change silently`);
      }
    }

    const blank = await page.evaluate(() =>
      [...document.querySelectorAll("#ftGrid .ft-panel-one")]
        .filter((n) => n.textContent !== "" && !String(n.textContent).trim()).length);
    eq(blank, 0, "no slot holds whitespace that would defeat :empty");

    eq(errors.length, 0, `the station walk throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });

    const bad = await page.evaluate(() => {
      const out = [];

      const numeric = /^[−+-]?[\d.,]+\s*(?:%|d|ATR|SD)?$/;
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

  for (const width of [1280, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });

    for (const key of TICKER_PANELS.map((p) => p.key)) {
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
        return { vb, rendered: s.getBoundingClientRect().width,
                 transform: getComputedStyle(s).transform };
      });

      if (section.span === 1) {
        ok(zoomed.vb >= gridW * 2,
           `${width}px ${key}: a span-1 panel at least doubles when enlarged (${gridW} to ${zoomed.vb})`);
      } else {
        ok(zoomed.vb > gridW,
           `${width}px ${key}: a span-2 panel still grows when enlarged (${gridW} to ${zoomed.vb})`);
      }

      ok(zoomed.vb >= gridW,
         `${width}px ${key}: enlarging never shrinks the drawing (${gridW} to ${zoomed.vb})`);

      ok(zoomed.vb > 600, `${width}px ${key}: the zoom draw measured a real host`);

      ok(Math.abs(zoomed.rendered - zoomed.vb) < 1,
         `${width}px ${key}: the enlarged chart is redrawn at its host's width, not ` +
         `scaled — drawn ${zoomed.vb}, rendered ${zoomed.rendered.toFixed(2)}`);
      eq(zoomed.transform, "none", `${width}px ${key}: no CSS transform on the enlarged chart`);

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

  {

    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

    await mount(page, withChain[0], {
      ticker: null,
      boards: { deep: 1, rows: [{ t: "AAA", r: 1, s: 42, dp: 1 }, { t: "BBB", r: 2, s: 30 }] },
    });
    const state = await page.evaluate(() => ({
      status: document.getElementById("ftStatus").textContent,
      pickerShown: !document.getElementById("ftPicker").hidden,
      gridShown: !document.getElementById("ftGrid").hidden,
      rows: document.querySelectorAll("#ftPickerBody tr").length,
      names: [...document.querySelectorAll("#ftPickerBody .ft-link")].map((a) => a.textContent),
      note: document.getElementById("ftPickerNote").textContent,
      requested: window.__requested.slice(),
    }));
    ok(state.pickerShown, "with no ?t= the page shows the picker");
    ok(!state.gridShown, "and hides the panel grid");
    ok(!state.status.toLowerCase().includes("error"), "and calls it a choice, not an error");
    eq(state.requested.filter((u) => u.includes("/api/flows/card")).length, 0,
       "and spends no card read at all");

    eq(state.rows, 1,
       "only the names the board stamped with a card are listed — a row the run went " +
       "deep on carries dp:1 and one it did not carries no dp at all");
    eq(state.names.join(","), "AAA", "and it is the stamped one that is listed");

    ok(/ranks 2 names/.test(state.note) && /card for 1 of them/.test(state.note),
       `the note counts the list against the board it came from (${state.note})`);
    ok(/not listed/.test(state.note),
       "and says what happened to the row it dropped rather than leaving the reader to " +
       "notice the board is longer than the list");
    await page.close();
  }
  {

    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, withChain[0], {
      ticker: null,
      boards: { rows: [{ t: "AAA", r: 1, s: 42 }, { t: "BBB", r: 2, s: 30 }] },
    });
    const state = await page.evaluate(() => ({
      rows: document.querySelectorAll("#ftPickerBody tr").length,
      note: document.getElementById("ftPickerNote").textContent,
    }));
    eq(state.rows, 2,
       "a board that publishes no `deep` count lists every row rather than none");
    ok(/does not publish/.test(state.note),
       `and the note says the flag is unpublished rather than promising a card (${state.note})`);
    ok(/may still open a page with no card/.test(state.note),
       "naming the risk it cannot rule out, instead of a claim it cannot check");
    await page.close();
  }
  {

    const pendingCases = [
      [{ deep: 1, rows: [{ t: "ZZZ", r: 1, s: 5, dp: 1 }] }, "has not landed",
       "a card that really is lagging its row"],
      [{ deep: 1, rows: [{ t: "QQQ", r: 1, s: 5, dp: 1 }] }, "not on today",
       "a name the board does not carry at all"],
      [{ deep: 1, rows: [{ t: "AAA", r: 1, s: 9, dp: 1 }, { t: "ZZZ", r: 2, s: 5 }] },
       "built no card for it", "a name the board RANKS and this run built no card for"],
    ];
    for (const [boards, want, what] of pendingCases) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(page, { status: "pending", ticker: "ZZZ" }, { ticker: "ZZZ", boards });
      const status = await page.evaluate(
        () => document.getElementById("ftStatus").textContent);
      ok(status.includes(want), `${what} says so specifically ("${want}")`);
      await page.close();
    }
    {

      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(page, { status: "pending", ticker: "ZZZ" }, {
        ticker: "ZZZ",
        boards: { deep: 1, rows: [{ t: "AAA", r: 1, s: 9, dp: 1 }, { t: "ZZZ", r: 2, s: 5 }] },
      });
      const state = await page.evaluate(() => ({
        status: document.getElementById("ftStatus").textContent,
        rows: document.querySelectorAll("#ftPickerBody tr").length,
      }));
      ok(/2 of 2 on the bullish side/.test(state.status),
         `the rank is stated against the whole side, not against the carded half ` +
         `(${state.status})`);
      ok(!/has not landed|briefly lag/.test(state.status),
         "and never as a lag, because reloading cannot produce a card the run did not " +
         "budget for");
      eq(state.rows, 1,
         "while the list beside it holds only the name that does have a card");
      await page.close();
    }
  }
  {

    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const card = withChain[0];
    await mount(page, card, { ticker: String(card.ticker).toLowerCase() });
    const requested = await page.evaluate(() => window.__requested.slice());
    ok(requested.some((u) => u.includes("t=" + card.ticker)),
       "a lowercase ?t= is uppercased and fetched, not sent to the picker");
    await page.close();
  }
  {

    for (const bad of ["../etc", "", "!!!"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(page, withChain[0], { ticker: bad, boards: { rows: [] } });
      const requested = await page.evaluate(() => window.__requested.slice());
      eq(requested.filter((u) => u.includes("/api/flows/card")).length, 0,
         `?t=${JSON.stringify(bad)} is rejected before any fetch`);
      await page.close();
    }
  }

  {

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

  {

    const base = withChain.find((c) =>
      c.panels.darkpool.status === "ok" &&
      c.panels.oiDeltas.status === "ok" &&
      c.panels.volContext.status === "ok" &&
      c.panels.volContext.term.status === "ok" &&
      c.panels.volContext.ivRank.status === "ok");
    ok(base, "an emitted card carries all three stock panels with data");
    const card = JSON.parse(JSON.stringify(base));
    card.panels.darkpool.rows[0].canceled = true;
    card.panels.oiDeltas.rows[0].oiUpDays = null;
    card.panels.volContext.ivRank.rows[0].rank1y = 57.5;
    card.panels.volContext.ivRank.rows[5].rank1y = null;

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { ticker: card.ticker });

    const dp = card.panels.darkpool;
    const oi = card.panels.oiDeltas;
    const vc = card.panels.volContext;

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

      const saidBy = (root) => root.textContent + " " +
        [...root.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join(" ");
      return {
        dpRows: dpHost.querySelectorAll(".fdp-table tbody tr").length,
        dpTags: [...dpHost.querySelectorAll(".fdp-tag")].map((n) => n.textContent),

        dpTimes: [...dpHost.querySelectorAll(".fdp-time")]
          .map((n) => (n.firstChild ? n.firstChild.textContent : "")),
        dpQuotes: [...dpHost.querySelectorAll(".fdp-quote")].map((n) => n.textContent),
        dpCount: text(dpHost, ".fdp-count"),
        dpNotes: [...dpHost.querySelectorAll(".fc-note")].map((n) => n.textContent).join(" "),
        oiContracts: [...oiHost.querySelectorAll(".foi-oc")].map((n) => n.textContent),
        oiChanges: [...oiHost.querySelectorAll(".foi-chg")].map((n) => n.textContent),
        oiGrowth: [...oiHost.querySelectorAll(".foi-growth")].map((n) => n.textContent),
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

    eq(got.dpRows, dp.rows.length, "darkpool draws one row per published print");
    ok(got.dpTimes.every((t) => /^\d{2}:\d{2}$/.test(t) || t === "—"),
       `every time cell is HH:MM off the tape's own timestamp (${got.dpTimes[0]})`);

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

    eq(got.oiContracts.length, oi.rows.length, "oiDeltas draws one row per published change");
    ok(/^[CP] [\d.]+ · \d{2}-\d{2}$/.test(got.oiContracts[0]),
       `the contract cell is built from cp, strike and expiry ("${got.oiContracts[0]}")`);

    const iNeg = oi.rows.findIndex((r) => typeof r.diff === "number" && r.diff < 0);
    const iPos = oi.rows.findIndex((r) => typeof r.diff === "number" && r.diff > 0);
    ok(iNeg !== -1 || iPos !== -1,
       "the emitted corpus carries at least one signed open-interest difference, so the " +
       "two sign assertions below are about rows that exist rather than about nothing");
    if (iNeg !== -1) {
      ok(got.oiChanges[iNeg].startsWith("−"),
         `a negative difference leads with U+2212 ("${got.oiChanges[iNeg]}")`);
    }
    if (iPos !== -1) {
      ok(got.oiChanges[iPos].startsWith("+"),
         `a positive difference leads with its sign ("${got.oiChanges[iPos]}")`);
    }

    ok(got.oiGrowth.length === oi.rows.length &&
       got.oiGrowth.every((t) => t === "\u2014" || /%$/.test(t)),
       `every growth cell carries its unit or says nothing (${got.oiGrowth.join(" ")})`);

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

    eq(got.segments, wantSegments,
       `the rank strip draws a segment only between adjacent measured sessions ` +
       `(${got.segments} of a bridged ${series.length - 1})`);
    ok(got.sparkDots >= 1, "and the newest measured session carries its dot");
    ok(got.vcNotes.includes(vc.note.slice(0, 60)),
       "the volContext note is rendered from the payload");

    for (const [key, said] of [["oiDeltas", got.oiSaid], ["volContext", got.vcSaid]]) {
      ok(!/print|trade|bought|sold|buyer|seller|whale|institutional|smart money/i.test(said),
         `${key} never borrows the tape's vocabulary or attributes a side`);
    }
    eq(errors.length, 0, `the stock panels render without throwing (${errors.join("; ")})`);
    await page.close();
  }

  {

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

  {
    const base = withChain.find((c) =>
      c.panels.marketRank &&
      c.panels.marketRank.status === "ok" &&
      c.panels.marketRank.feeds.oiChange.status === "ok" &&
      c.panels.marketRank.feeds.darkpool.status === "ok");
    ok(base, "an emitted card places in both market-wide feeds");
    const card = JSON.parse(JSON.stringify(base));

    card.panels.marketRank.feeds.oiChange.value = -4200;

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { ticker: card.ticker });

    const got = await page.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
      const blocks = [...host.querySelectorAll(".fmr-block")];
      const textOf = (n) => (n ? n.textContent : null);
      return {
        blocks: blocks.length,
        heads: blocks.map((b) => textOf(b.querySelector(".fmr-h"))),
        ranks: blocks.map((b) => textOf(b.querySelector(".fmr-rank"))),
        vals: blocks.map((b) => textOf(b.querySelector(".fmr-val"))),
        valClasses: blocks.map((b) => (b.querySelector(".fmr-val") || { className: "" }).className),
        when: blocks.map((b) => textOf(b.querySelector(".fmr-when"))),
        cut: blocks.map((b) => textOf(b.querySelector(".fmr-cut"))),
        cover: blocks.map((b) => textOf(b.querySelector(".fmr-cover"))),

        blockText: blocks.map((b) => b.textContent + " " +
          [...b.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join(" ")),
        empties: [...host.querySelectorAll("[data-empty]")].map((n) => n.getAttribute("data-empty")),
        all: host.textContent + " " +
          [...host.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join(" "),
      };
    });

    eq(got.blocks, 2, "both market-wide feeds get their own block, because they carry " +
       "different populations, different orderings and different sessions");
    ok(/Open-interest/.test(got.heads[0]) && /Off-exchange/.test(got.heads[1]),
       "each under its own heading");

    for (let i = 0; i < 2; i++) {
      ok(/\d+ of \d+/.test(got.ranks[i] || ""),
         `${got.heads[i]}: the rank is printed with the population it sits inside ` +
         `("${got.ranks[i]}") — a bare ordinal is a number a reader cannot size`);
    }

    ok(got.vals[0].startsWith("−"),
       `a negative open-interest change leads with U+2212 ("${got.vals[0]}"), so the reading ` +
       "survives greyscale and a printout");
    ok(/is-down/.test(got.valClasses[0]),
       "with the tone class as decoration on top of a sign that is already in the text");
    ok(/contract/.test(got.vals[0]),
       `and the unit travels with the number ("${got.vals[0]}")`);

    ok(/NOT the session this card describes/.test(got.when[0]),
       `the panel says outright that the ranking is from another session ("${got.when[0]}")`);
    ok(new RegExp(card.panels.marketRank.feeds.oiChange.asOf).test(got.when[0]),
       "naming the feed's own date rather than the card's");

    ok(/last place in the feed held/.test(got.cut[0]),
       `the open-interest block quotes the value at the last place ("${got.cut[0]}")`);
    ok(/reaches back to/.test(got.cut[1]),
       `and the print block quotes the time the window reaches back to, which is the fact ` +
       `that decides whether a name could have been in a recency list ("${got.cut[1]}")`);

    for (let i = 0; i < 2; i++) {
      ok(/\d+ of \d+ names? carrying a card/.test(got.cover[i] || ""),
         `${got.heads[i]}: the panel states how much of the board this join reached ` +
         `("${got.cover[i]}")`);
    }

    ok(/is-up|is-down|is-flat|is-unknown/.test(got.valClasses[0]),
       "the signed open-interest reading carries a tone class");
    ok(!/is-up|is-down|is-flat|is-unknown/.test(got.valClasses[1]),
       `and the print's dollar size carries none ("${got.valClasses[1]}") — the tape ` +
       "attributes no side, so a tint would invent one");

    const IDENTITY = /\b(whale|smart money|institutional|bought|sold|buyer|seller|paid|bullish|bearish)\b/i;
    const idHit = IDENTITY.exec(got.all);
    ok(!idHit,
       `the panel never attributes a side, an identity or an intent (found "${idHit && idHit[1]}") — ` +
       "membership in a market-wide list is not a direction");
    const exHit = /\b(print|prints|trade|trades)\b/i.exec(got.blockText[0]);
    ok(!exHit,
       `and the open-interest half never borrows the tape's vocabulary (found ` +
       `"${exHit && exHit[1]}") — it describes two clearing snapshots, not executions`);
    eq(errors.length, 0, "the panel draws without throwing");
    await page.close();
  }

  {

    const card = JSON.parse(JSON.stringify(withChain[0]));
    const quiet = withChain
      .map((c) => c.panels.marketRank && c.panels.marketRank.feeds.oiChange)
      .find((f) => f && f.status === "quiet");
    ok(quiet, "the emitted corpus contains a name that is in no market-wide list");
    card.panels.marketRank.feeds.oiChange = JSON.parse(JSON.stringify(quiet));
    card.panels.marketRank.feeds.darkpool = {
      status: "unavailable", present: null, feed: "darkpool",
      label: "the market-wide off-exchange print feed",
      reason: "the market-wide off-exchange print feed did not come back this run (timeout)",
    };

    const legacy = JSON.parse(JSON.stringify(withChain[0]));
    delete legacy.panels.marketRank;

    const page = await browser.newPage({ viewport: { width: 320, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { ticker: card.ticker });

    const got = await page.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
      const blocks = [...host.querySelectorAll(".fmr-block")];
      return {
        tags: blocks.map((b) => {
          const n = b.querySelector("[data-empty]");
          return n ? n.getAttribute("data-empty") : null;
        }),
        texts: blocks.map((b) => b.textContent),

        said: blocks.map((b) => {
          const n = b.querySelector("[data-empty]");
          return n ? n.textContent.trim() : null;
        }),

        spill: (() => {
          const s = document.querySelector('.ft-panel[data-panel="marketRank"]');
          const right = s.getBoundingClientRect().right;
          let worst = 0;
          const walk = (n) => {
            for (const c of n.children) {
              worst = Math.max(worst, c.getBoundingClientRect().right - right);
              walk(c);
            }
          };
          walk(s);
          return Math.round(worst);
        })(),
        pageSideways: document.documentElement.scrollWidth -
                      document.documentElement.clientWidth,
      };
    });

    eq(got.tags[0], "quiet",
       "a name the feed was READ without finding is tagged quiet — the request succeeded and " +
       "the market answered, and only the third silence is a fact about the market");

    ok(!/Unavailable\b/.test(got.texts[0]),
       "and it never wears the Unavailable banner");
    ok(/^Not in this feed\b/.test(got.said[0]),
       "leading instead on the reading itself — the card's other quiet lead-in, \"Nothing " +
       "to report\", is false here: what is being reported is that the feed WAS read and " +
       "this name was not in it");
    ok(/is not in the market-wide open-interest change feed/.test(got.texts[0]),
       `carrying the publisher's own sentence ("${got.texts[0].slice(0, 90)}")`);
    ok(/rows covering/.test(got.texts[0]),
       "which still reports the population the absence was measured against");
    ok(/last place in the feed held|fewer rows than/.test(got.texts[0]),
       "and the cut it did not clear, so a near miss and a name nowhere near it read " +
       "differently");

    eq(got.tags[1], "unavailable", "a feed that did not come back is tagged unavailable");
    ok(/Unavailable\b/.test(got.texts[1]), "and does wear the banner");
    ok(/timeout/.test(got.texts[1]), "with the reason it was given, verbatim");

    ok(got.spill <= 0,
       `at 320px nothing in the panel reaches past the panel's own edge (${got.spill}px)`);
    ok(got.pageSideways <= 0,
       `and the page itself does not scroll sideways with it mounted (${got.pageSideways}px)`);
    await page.close();

    const page2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    page2.on("pageerror", (e) => errors.push(String(e)));
    await mount(page2, legacy, { ticker: legacy.ticker });
    const said = await page2.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
      const n = host.querySelector("[data-empty]");
      return { tag: n ? n.getAttribute("data-empty") : null, text: host.textContent };
    });
    eq(said.tag, "unavailable", "a card built before the join shipped is an unavailability");
    ok(/before the market-wide join shipped/.test(said.text),
       "dated by ITS OWN wave — telling this reader the card predates the per-name deep " +
       "feeds would be a confident wrong fact about which card they are looking at");
    eq(errors.length, 0, "neither silence throws");
    await page2.close();
  }

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

    for (const [k, w] of Object.entries(base.conv.weights)) {
      ok(good.math.includes(Math.round(w * 100) + "%"),
         `the ${k} weight is the payload's own (${Math.round(w * 100)}%), not a copy in the renderer`);
    }
    ok(/persistence/i.test(good.said),
       "and persistence, the term this panel never showed, is in the stat list");
    ok(/COUNT/.test(good.math) && /steps/.test(good.math),
       "the note says agreement is a count that steps, which is why two nearby " +
       "convictions can differ by a whole axis");

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

      let legs = 0;
      for (const r of panel.rows) {
        if (typeof r.call === "number") legs++;
        if (typeof r.put === "number") legs++;
      }
      eq(got.bars, legs,
         `${key}: one bar per PRESENT leg (${legs}), never one per expiry — each leg is drawn ` +
         `as the vendor signed it, and the dealer net is a separate figure beside them`);
      ok(got.calls > 0 && got.puts > 0,
         `${key}: both legs are drawn and told apart by class`);
      ok(got.negBelow,
         `${key}: every negative leg is drawn BELOW the zero line — sign lives in position, ` +
         `so it survives greyscale and a printout`);
      eq(got.par, "xMidYMid meet",
         `${key}: one viewBox unit is one CSS pixel`);

      ok(got.said.includes(panel.unit),
         `${key}: the panel's own published unit is on the page verbatim`);
      ok(got.said.includes(panel.signConvention),
         `${key}: and its sign convention, which is why nothing here is a direction`);
      ok(/[Gg]ross size/.test(got.said),
         `${key}: the gross total is labelled a SIZE, never a direction`);
      ok(/Dealer net, drawn \(call (\u2212|\+) put\)/.test(got.said),
         `${key}: and the dealer net across the drawn expiries is printed with the rule that made it`);
    }

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

    await page.click("#ftBackTo");
    await page.click("#ftSwitch");
    await page.waitForSelector("#ftPickerBody tr");
    const twice = await page.evaluate(() =>
      window.__requested.filter((u) => u.includes("/api/flows/board")).length);
    eq(twice, after.fetched, "re-opening the switcher re-uses what it already fetched");

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

  {
    eq(TICKER_PANELS[0].key, "__score",
       "the derivation is the first panel the registry mounts: a reader arrives from a " +
       "board row carrying a score, and the first thing the page owes them is where it came " +
       "from (the score-over-price series that used to lead was dropped from the page)");
    eq(TICKER_PANELS[0].span, 3,
       "across the whole grid — at span 1 it was a 1,034px column beside a 330px table, the " +
       "widest void on the page, because a grid row is as tall as its tallest cell; a span-2 " +
       "host spent the width on void because the gauge and its families set their own width, " +
       "so the derivation now lays its gauge, its readings and its method out in three " +
       "columns of its own and becomes a band");
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await mount(page, withChain[0], { ticker: withChain[0].ticker });
    const order = await page.evaluate(() =>
      [...document.querySelectorAll(".ft-panel[data-panel]")].map((s) => s.dataset.panel));
    eq(order[0], "__score", "and it is first in the document too");
    const band = await page.evaluate(() => {
      const box = (n) => n.getBoundingClientRect();
      const grid = document.getElementById("ftGrid");
      const score = document.querySelector('.ft-panel[data-panel="__score"]');
      const stats = document.querySelector('.ft-panel[data-panel="__stats"]');
      const cols = score.querySelector(".fc-score-cols");
      return {
        gridW: Math.round(box(grid).width), scoreW: Math.round(box(score).width), scoreH: Math.round(box(score).height),
        statsW: Math.round(box(stats).width),
        tracks: getComputedStyle(cols).gridTemplateColumns.split(" ").length,
        colH: [...cols.children].map((c) => Math.round(box(c).height)),
      };
    });
    ok(Math.abs(band.scoreW - band.gridW) <= 1,
       `1440px: the derivation spans the whole grid (${band.scoreW} of ${band.gridW})`);
    eq(band.tracks, 3, "and lays itself out in three columns when the panel is at least 46rem wide");
    ok(band.colH.every((h) => h > 0), `each of which holds something (${band.colH.join(", ")})`);
    ok(band.scoreH < 760,
       `so the panel stands under 760px (${band.scoreH}) where the column stood at 1,034`);
    ok(Math.abs(band.statsW - band.gridW) <= 1,
       `and the key statistics beneath it span the grid too (${band.statsW} of ${band.gridW}), ` +
       "so the signal station is two bands rather than a column and a stub");
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(250);
    const narrow = await page.evaluate(() => {
      const score = document.querySelector('.ft-panel[data-panel="__score"]');
      const cols = score.querySelector(".fc-score-cols");
      const label = score.querySelector(".fc-fam-l");
      return { w: Math.round(score.getBoundingClientRect().width),
        tracks: getComputedStyle(cols).gridTemplateColumns.split(" ").length,
        colW: Math.round(cols.children[0].getBoundingClientRect().width),
        labelLines: label ? Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight)) : 0 };
    });
    ok(narrow.tracks === 2 && narrow.colW >= 300,
       `1024px: a ${narrow.w}px panel keeps two columns of ${narrow.colW}px rather than three of 218 that wrapped ` +
       "the family labels one word per line — the split follows the panel's own width, not the viewport's");
    ok(narrow.labelLines <= 2, `and a family label sits on at most two lines (${narrow.labelLines})`);
    ok(!order.includes("scoreOverlay"), "the score-over-price series is mounted nowhere");
    await page.close();

    const at = (key) => TICKER_PANELS.findIndex((p) => p.key === key);
    eq(at("displacement"), at("levels") + 1,
       "where the book is MOVING sits directly under the walls it is moving relative to, " +
       "with the gamma surface — a different question about the same book — no longer " +
       "between them");
    eq(at("path"), at("aggressor") + 1,
       "the session path sits directly under the lifted strikes: the same executions once " +
       "by strike and once by clock, with the fifty-row contract table out from between them");

    eq(at("context"), at("congress") + 1,
       "the name's own year closes the station, one place under the disclosures — still " +
       "adjacent to the market-wide standing at one remove, and no longer stretched 515px " +
       "by leading a station whose second panel is two and a half times its height");
    eq(at("marketRank"), 0 + TICKER_PANELS.findIndex((p) => p.group === "context"),
       "and the market-wide standing opens the station, which is what took the stretch out");
    eq(TICKER_GROUPS[0].label, "Overview",
       "the first station is labelled Overview: it is the station a reader LANDS on, and " +
       "\"Signal\" named a group of panels rather than a place to arrive");
    eq(TICKER_GROUPS[0].key, "signal",
       "while its key is still `signal`, the ?s= value in every link the boards have sent " +
       "since the card dialog was retired");
  }

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

      eq(dom[i].group, want.group,
         `${want.key} is mounted in its registry group (${want.group})`);
      eq(dom[i].tier, want.tier,
         `${want.key} wears its registry chrome tier (${want.tier})`);

      ok(dom[i].group && dom[i].tier,
         `${want.key} carries BOTH a group and a tier — a panel the controller's ` +
         `chrome table has never heard of mounts with neither`);
      eq(dom[i].id, "panel-" + want.key,
         `${want.key} has its own fragment id, so it can be linked to`);
    }

    const groupKeys = TICKER_GROUPS.map((g) => g.key);
    for (const p of TICKER_PANELS) {
      ok(groupKeys.includes(p.group), `panel "${p.key}" names a declared group`);
      ok(PANEL_TIERS.includes(p.tier), `panel "${p.key}" names a declared tier`);
    }

    const runs = [];
    for (const p of TICKER_PANELS) {
      if (!runs.length || runs[runs.length - 1] !== p.group) runs.push(p.group);
    }
    eq(runs.length, new Set(runs).size,
       `each group is one contiguous run (${runs.join(" ")})`);
    eq(runs.join(","), groupKeys.join(","),
       "and the runs come in the order the group list declares");

    for (const g of TICKER_GROUPS) {
      const members = TICKER_PANELS.filter((p) => p.group === g.key);
      ok(members.length > 0, `group "${g.key}" has panels in it`);
      const leads = members.filter((p) => p.tier === "lead");
      eq(leads.length, 1, `group "${g.key}" has exactly one lead panel`);
      eq(members[0].tier, "lead",
         `and it is the group's first panel (${members[0].key}), not one buried inside it`);
    }
    eq(TICKER_PANELS[0].key, "__score",
       "and the very first lead is the score derivation");

    const flow = await page.evaluate(() =>
      [...document.getElementById("ftGrid").children].map((n) => ({
        tag: n.tagName, cls: n.className, group: n.dataset.group, side: n.dataset.side,
        role: n.getAttribute("role"), labelledBy: n.getAttribute("aria-labelledby"),
        head: (() => {
          const h = n.querySelector(":scope > .ft-group");
          return h ? { id: h.id, text: h.textContent, group: h.dataset.group } : null;
        })(),
        lead: !!n.querySelector(":scope > .ft-station-lead"),
        keys: [...n.querySelectorAll(":scope > .ft-panel[data-panel]")]
          .map((s) => s.dataset.panel),
        firstChildIsHead: n.firstElementChild &&
          n.firstElementChild.classList.contains("ft-group"),
      })));
    eq(flow.length, TICKER_GROUPS.length,
       `the grid holds exactly the five stations and nothing beside them (${flow.length})`);
    for (let i = 0; i < TICKER_GROUPS.length; i++) {
      const g = TICKER_GROUPS[i];
      const st = flow[i];
      eq(st.cls, "ft-station", `station ${i} is a station`);
      eq(st.group, g.key, `and it is ${g.key}'s, in the order the registry declares`);

      eq(st.side, g.key, `and carries its own ?s= address (${g.key})`);
      eq(st.role, "tabpanel",
         "and is served as a tabpanel — the structure is in the document, not added to it " +
         "by a script, so the served page and the scripted page are the same page");
      eq(st.labelledBy, g.hash, "labelled by its own heading rather than by a repeated string");
      ok(st.firstChildIsHead, `and the heading is the station's first child (${g.key})`);
      ok(st.lead, `the station carries its empty lead slot (${g.key})`);
      eq(st.head.id, g.hash,
         `heading ${i} carries the group's own fragment id (${g.hash}) — a slug computed ` +
         `at render time would break every link the moment a label was reworded`);
      eq(st.head.group, g.key, "and names its own group, which is what the tab row matches on");
      ok(st.head.text.includes(g.label), `and its label (${g.label})`);

      eq(st.head.text, g.label + g.blurb,
         `and the group's own published sentence in full, verbatim (${g.key})`);
      eq(st.keys.join(","),
         TICKER_PANELS.filter((p) => p.group === g.key).map((p) => p.key).join(","),
         `and the station holds exactly its own panels, in registry order (${g.key})`);
      eq(st.keys.length, STATION_SIDE_COUNTS[g.key],
         `and as many of them as STATION_SIDE_COUNTS says (${g.key})`);
    }
    eq(flow.reduce((n, s) => n + s.keys.length, 0), TICKER_PANELS.length,
       "and between them the five stations hold every panel — a panel in no station is a " +
       "panel no tab can ever reach");

    const nav = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll(".ft-tabs .ft-tab")].map((a) => ({
        href: a.getAttribute("href"), group: a.dataset.group, side: a.dataset.side,
        role: a.getAttribute("role"), controls: a.getAttribute("aria-controls"),
        selected: a.getAttribute("aria-selected"),
        count: a.querySelector(".ft-tab-n") ? a.querySelector(".ft-tab-n").textContent : null,
        text: a.textContent.trim(),
      }));
      const all = document.querySelector(".ft-all-link");
      const bar = document.querySelector(".ft-bar");
      return {
        tabs,
        dead: tabs.map((t) => t.href).filter((h) => {
          try { return !document.getElementById(decodeURIComponent(h.slice(1))); }
          catch { return true; }
        }),
        deadControls: tabs.map((t) => t.controls).filter((id) => !document.getElementById(id)),
        allText: all ? all.textContent.trim() : null,
        allSide: all ? all.dataset.side : null,
        tablist: document.querySelector(".ft-tabs")
          ? document.querySelector(".ft-tabs").getAttribute("role") : null,
        sticky: bar ? getComputedStyle(bar).position : null,
        holdsHead: !!(bar && bar.contains(document.getElementById("ftHead"))),
        headIsFirst: !!(bar && bar.firstElementChild &&
          bar.firstElementChild.id === "ftHead"),
        holdsTabs: !!(bar && bar.querySelector(".ft-tabs")),
        holdsBand: !!(bar && bar.querySelector(".ft-band")),
      };
    });
    eq(nav.tablist, "tablist", "the station row is a tablist");
    eq(nav.tabs.map((t) => t.href).join(","), TICKER_GROUPS.map((g) => "#" + g.hash).join(","),
       "the tab row lists every station, in reading order");
    eq(nav.tabs.map((t) => t.group).join(","), TICKER_GROUPS.map((g) => g.key).join(","),
       "and each tab names the station it opens");
    eq(nav.dead.length, 0,
       `every tab's anchor resolves to an element (${nav.dead.join(", ")})`);
    eq(nav.deadControls.length, 0,
       `and every aria-controls names a section that exists (${nav.deadControls.join(", ")})`);
    for (const g of TICKER_GROUPS) {
      const tab = nav.tabs.find((t) => t.group === g.key);
      eq(tab.role, "tab", `the ${g.key} tab is a tab`);
      eq(tab.side, g.key, `and carries the ?s= address it will set (${g.key})`);
      eq(tab.controls, "ftst-" + g.key, `and controls its own station (${g.key})`);

      eq(tab.selected, "false",
         `and is not selected (${g.key}) — all five stations are open, so none of them is ` +
         `the one a tab has chosen`);
      eq(tab.count, String(STATION_SIDE_COUNTS[g.key]),
         `and prints how many panels it holds (${g.key}), from the one export the station ` +
         `itself is built from — a count written twice is wrong about no panel, only about ` +
         `their number`);
    }
    eq(nav.allText, "All " + TICKER_PANELS.length + " panels",
       `the way out of the five names the real total (${TICKER_PANELS.length})`);
    eq(nav.allSide, "all", "and carries the ?s= value that will mean every station");
    eq(nav.sticky, "sticky",
       "the identity bar is sticky — it used to scroll away after the first panel, " +
       "taking the name, the score and the session date with it");
    ok(nav.holdsHead && nav.holdsTabs && nav.holdsBand,
       "and carries the identity, the tabs and the fixed band, so none outscrolls the rest");
    ok(nav.headIsFirst,
       "with the identity FIRST inside it — the controller moves the served header in at " +
       "the top rather than appending it under the tabs that index it");

    eq(errors.length, 0, `the workspace chrome throws nothing (${errors.join("; ")})`);
    await page.close();

    const touch = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await mount(touch, withChain[0], { ticker: withChain[0].ticker });
    const hit = await touch.evaluate(() => {
      const b = document.querySelector(".ft-tab");
      const r = b.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      let span = 0;
      for (let y = Math.round(r.top) - 25; y <= Math.round(r.bottom) + 25; y++) {
        if (document.elementFromPoint(cx, y) === b) span++;
      }
      return { box: Math.round(r.height), span };
    });
    ok(hit.span >= 44,
       `a station tab is at least 44px of hit area at 320px (${hit.span}px over a ` +
       `${hit.box}px box) — the extension is worthless if its own scroll container clips it`);
    await touch.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    await mount(page, withChain[0], { ticker: withChain[0].ticker });

    const sheets = await page.evaluate(() => ({
      styles: document.querySelectorAll("style").length,
      injected: !!document.getElementById("ftWorkspaceCSS"),

      classes: (() => {
        const set = new Set();
        const roots = [document.querySelector(".ft-bar"),
                       document.querySelector(".ft-change"),
                       ...document.querySelectorAll(".ft-group")];
        for (const root of roots) {
          if (!root) continue;
          for (const n of [root, ...root.querySelectorAll("*")]) {
            for (const c of n.classList) set.add(c);
          }
        }
        return [...set].sort();
      })(),
    }));

    ok(!sheets.injected,
       "the controller installs no stylesheet of its own — #ftWorkspaceCSS is gone, and with " +
       "it the sheet no cache-busting query string could ever reach");
    eq(sheets.styles, 2,
       `the document carries exactly the two stylesheets this harness added (${sheets.styles}) ` +
       "— base.css and flows.css. A third is a renderer writing CSS at runtime, which is the " +
       "debt this section exists to keep paid off");

    const src = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
    ok(!/createElement\(\s*["']style["']\s*\)/.test(src),
       "and the source builds no <style> element, so the assertion above cannot pass merely " +
       "because a fixture never reached the code path that injects one");
    ok(!/adoptedStyleSheets|insertRule\(/.test(src),
       "nor reaches the CSSOM by the other two doors — adoptedStyleSheets and insertRule are " +
       "the same debt written differently, and both are equally invisible to a CSS suite");

    const CSS_TEXT = fs.readFileSync(path.join(ROOT, "assets/css/flows.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    ok(sheets.classes.length >= 20,
       `the chrome emits ${sheets.classes.length} classes to check — read off the built DOM, ` +
       "so a chip added tomorrow is checked tomorrow rather than whenever this list is edited");
    for (const c of sheets.classes) {
      const rule = new RegExp("\\." + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])");
      ok(rule.test(CSS_TEXT),
         `.${c} resolves to a rule in assets/css/flows.css — the chrome's own classes are in ` +
         "the versioned stylesheet now, not in a string the browser never asked for");
    }
    await page.close();
  }

  {
    const lastTwoScored = (rows) => rows.length >= 2 &&
      typeof rows[rows.length - 1].score === "number" && typeof rows[rows.length - 2].score === "number";
    const base = withChain.find((c) =>
      c.panels.scoreOverlay && c.panels.scoreOverlay.status === "ok" &&
      c.panels.scoreOverlay.rows.length >= 6 &&
      typeof c.panels.scoreOverlay.deadBand === "number" &&
      lastTwoScored(c.panels.scoreOverlay.rows));
    ok(base, "an emitted card carries a joined overlay with a published dead band and two scored sessions at its end");
    const BAND = base.panels.scoreOverlay.deadBand;

    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const staged = (fn) => {
      const c = JSON.parse(JSON.stringify(base));
      fn(c.panels.scoreOverlay, c.panels.scoreOverlay.rows);
      const ovl = c.panels.scoreOverlay;

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
          flip: (() => {
            const n = document.getElementById("ftFlip");
            return n ? {
              text: n.textContent,
              empty: n.getAttribute("data-empty"),
              cls: n.className,
              title: n.getAttribute("title") || "",
            } : null;
          })(),
        };
      });
    };

    const rows = base.panels.scoreOverlay.rows;
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];

    ok(typeof last.score === "number" && typeof prev.score === "number",
       `the emitted card's last two sessions are both scored (${prev.d}, ${last.d}), so ` +
       "the ordinary-case assertions below actually run");
    {
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

      const flipCard = JSON.parse(JSON.stringify(base));
      flipCard.panels.levels = {
        status: "ok", spot: 100, atr: 2,
        levels: [{ kind: "gamma_flip", label: "Gamma flip", px: 104,
                   distPct: 0.04, distAtr: 2 }],
      };
      const fg = await read(flipCard);
      ok(fg.flip, "the header carries a flip-distance chip (#ftFlip)");
      ok(fg.flip && /\+4\.0%/.test(fg.flip.text),
         `the distance is drawn from the panel's own measurement, signed and in percent ` +
         `(${fg.flip && fg.flip.text}) — read rather than re-derived, so the header and ` +
         `the levels table cannot disagree about a denominator`);
      ok(fg.flip && /to flip/.test(fg.flip.text),
         "and names what the distance is TO — a signed percent alone, in a header of " +
         "prices and score points, does not say which of them it is measured against");
      ok(fg.flip && /\+2\.00 ATR/.test(fg.flip.text),
         `and carries the same distance in this name's own ATR (${fg.flip && fg.flip.text}), ` +
         "which is the figure that compares across names: 4% is a routine day in one book " +
         "and a three-sigma move in another");
      ok(fg.flip && /is-above/.test(fg.flip.cls),
         "a flip above spot takes the GEOMETRY class, not the directional palette: the " +
         "levels table already states that above-or-below is a fact about where the price " +
         "is and not a bullish or bearish claim");
      ok(fg.flip && !/is-pos|is-neg/.test(fg.flip.cls),
         "and specifically NOT is-pos/is-neg, which would tint a distance with the " +
         "bull/bear hues and turn a measurement into an opinion");
      ok(fg.flip && /gamma flip at \$104\.00/i.test(fg.flip.title),
         "the title states the level itself, so the percent has a price behind it");

      const onFlip = JSON.parse(JSON.stringify(flipCard));
      onFlip.panels.levels.levels[0] = { kind: "gamma_flip", label: "Gamma flip",
                                         px: 100, distPct: 0, distAtr: 0 };
      const og = await read(onFlip);
      ok(og.flip && /exactly at spot/i.test(og.flip.title),
         `a distance of exactly zero says the name is sitting ON its flip ` +
         `(${og.flip && og.flip.title.slice(0, 90)}) rather than above it — the two-armed ` +
         "form would have called a measured zero “above spot” at the one moment " +
         "the reading matters most");
    }

    {
      const ladderRead = JSON.parse(JSON.stringify(base));
      ladderRead.panels.levels = {
        status: "ok", spot: 100, atr: 2,
        levels: [{ kind: "max_pain", label: "Max pain", px: 98,
                   distPct: -0.02, distAtr: -1 }],
      };
      const got = await read(ladderRead);
      ok(got.flip, "the chip is still drawn when the ladder resolved no flip — a header " +
         "that silently loses a slot teaches the eye that the slot means nothing");
      eq(got.flip && got.flip.empty, "unavailable",
         "and it is TAGGED, so a test never has to parse prose to know which silence this is");
      ok(got.flip && !/%/.test(got.flip.text),
         `and prints no percentage at all (${got.flip && got.flip.text}) — least of all ` +
         "0%, which would claim spot is sitting on a flip that was never found");
      ok(got.flip && /not a distance of zero/i.test(got.flip.title),
         "and the title refuses the inference in as many words: a book with no sign change " +
         "over the strikes read has no flip to be near, which is the opposite of being on one");

      const noPanel = JSON.parse(JSON.stringify(base));
      noPanel.panels.levels = { status: "unavailable", note: "no spot price" };
      const np = await read(noPanel);
      eq(np.flip && np.flip.empty, "unavailable",
         "a levels panel that never answered is tagged the same way to a machine");
      ok(np.flip && /not measured/i.test(np.flip.title),
         `but says something different to a reader (${np.flip && np.flip.title.slice(0, 80)}) ` +
         "— nothing was read here, so there is no finding about this name's book to report");
      ok(np.flip && !/no gamma flip resolved/i.test(np.flip.title),
         "and specifically does NOT claim the ladder resolved nothing, which would be a " +
         "statement about the name made from a panel that did not run");
    }

    const flat = await read(staged((o, r) => { r[r.length - 1].score = r[r.length - 2].score; }));
    ok(/unchanged/i.test(flat.lead),
       `an identical score reads as unchanged (${flat.lead.slice(0, 90)})`);
    ok(flat.d1 && /^0/.test(flat.d1.text.trim()),
       `and the header chip shows the measured zero (${flat.d1 && flat.d1.text})`);
    ok(!/no move to state/i.test(flat.lead),
       "and is NOT reported as an absence — a measured zero and an unmeasured session " +
       "are different facts");

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

    const noBand = await read(staged((o) => { o.deadBand = null; }));
    ok(/cannot be stated/i.test(noBand.event),
       `an unpublished dead band makes the crossing unknowable, and says so (${noBand.event})`);
    ok(noBand.empties.includes("unavailable"),
       "and tags it as a publisher-side absence, not as a measured one");
    ok(!/no crossing/i.test(noBand.event),
       "it never reports 'no crossing' from a band nobody published — that is a " +
       "confident answer built out of a missing input");

    const gapped = await read(staged((o, r) => {
      r[r.length - 2].score = null;
      r[r.length - 1].score = BAND + 40;
    }));
    ok(/2 sessions earlier/.test(gapped.lead),
       `the gap is counted and printed (${gapped.lead.slice(0, 120)})`);
    ok(/one night or two is not known/i.test(gapped.lead),
       "and the sentence refuses the overnight reading a bare delta would invite, without claiming " +
       "the opposite: an unscored session in between leaves the timing unknown, which is what the " +
       "run paragraph below says of the same gap");

    const stale = await read(staged((o, r) => { r[r.length - 1].score = null; }));
    ok(/1 session old/.test(stale.stale),
       `a newest session with no score for this name is announced as stale (${stale.stale.slice(0, 110)})`);
    ok(stale.stale.length > 0 && stale.text.indexOf(stale.stale.slice(0, 20)) <
       stale.text.indexOf(stale.lead.slice(0, 20)),
       "and the staleness line comes BEFORE the move, so no reader takes the move for " +
       "this morning's");

    const broken = await read(staged((o, r) => {
      for (let i = 0; i < r.length; i++) r[i].score = BAND + 10;
      r[r.length - 4].score = null;
    }));
    ok(/consecutive scored sessions on the bullish side/i.test(broken.text),
       "the run states its side and its length");
    ok(/not\s+stepped over that gap/i.test(broken.text),
       "and says it stopped at an unscored session rather than counting through it — " +
       "continuity nobody measured is not continuity");

    const atZero = await read(staged((o, r) => { r[r.length - 1].score = 0; }));
    ok(/exactly zero/i.test(atZero.text),
       "a newest score of zero is named as the centre of the dead band");
    ok(!/on the bullish side|on the bearish side/i.test(atZero.text.split("Derived from")[0]),
       "and is not assigned a side it does not hold");

    const lone = await read(staged((o, r) => {
      for (let i = 0; i < r.length - 1; i++) r[i].score = null;
      r[r.length - 1].score = BAND + 5;
    }));
    ok(/no move to state/i.test(lone.lead),
       "a single scored session states the reading and refuses to derive a move from it");
    ok(/not a move of zero/i.test(lone.lead),
       "in the words that rule out the substitution");
    ok(!lone.d1, "and the header carries no move chip at all rather than a zero");

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

    const idOk = await read(base);
    ok(/^\$\d/.test(idOk.price.text.trim()),
       `the strip carries the spot the card was measured at (${idOk.price.text})`);
    ok(idOk.side.text.trim().length > 0, `and the side (${idOk.side.text})`);

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

        plain: f(mk([5, 6, 7, 8, 9, 12], 1)),

        gapped: f(mk([5, 6, 7, null, null, 12], 1)),

        stale: f(mk([5, 6, 40, null, null, null], 1)),

        cleared: f(mk([0, 0, 0, 0, 0, 40], 1)),

        faded: f(mk([40, 40, 40, 40, 40, 0], 1)),

        flipped: f(mk([40, 40, 40, 40, 40, -40], 1)),

        broken: f(mk([9, 9, null, 9, 9, 9], 1)),

        zero: f(mk([9, 9, 9, 9, 9, 0], 1)),

        bandless: f(mk([0, 0, 0, 0, 0, 40], null)),

        empty: f(mk([null, null, null], 1)),

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

  {
    const card = withChain[0];
    const target = TICKER_PANELS[TICKER_PANELS.length - 2].key;

    const settled = (page) => page.waitForFunction(() => {

      const sc = document.getElementById("ftScroll");
      const y = Math.round(window.scrollY + (sc ? sc.scrollTop : 0));
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

      const stretched = await page.evaluate(() => Array.from(
        document.querySelectorAll(".ft-station:not([hidden]) .ft-panel"), (el) => ({
          key: el.dataset.panel,
          drawn: Math.round(el.getBoundingClientRect().height),
          content: el.scrollHeight,
        })).filter((p) => p.drawn - p.content > 2));
      eq(stretched.length, 0,
         "no panel is drawn taller than its own content — a grid item stretches to its " +
         "row unless the container says otherwise, so check that .ft-station still sets " +
         "align-items: start rather than reordering a station to pair a short panel with " +
         "a taller one (" +
         stretched.map((p) => `${p.key} ${p.drawn}px around ${p.content}px`).join("; ") + ")");

      const landed = await page.evaluate((k) => {
        const s = document.getElementById("panel-" + k);
        const r = s.getBoundingClientRect();
        return {
          top: r.top, focused: document.activeElement === s, scrolled: window.scrollY + (document.getElementById("ftScroll") || { scrollTop: 0 }).scrollTop,

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

    {
      const g = TICKER_GROUPS[3];
      const { page, errors } = await open(g.hash);
      await settled(page);
      const grp = await page.evaluate((h) => ({
        scrolled: window.scrollY + (document.getElementById("ftScroll") || { scrollTop: 0 }).scrollTop,
        current: [...document.querySelectorAll(".ft-tab[aria-current='true']")]
          .map((a) => a.getAttribute("href")),
        headTop: document.getElementById(h).getBoundingClientRect().top,
        barBottom: document.querySelector(".ft-bar").getBoundingClientRect().bottom,

        said: parseFloat(getComputedStyle(document.getElementById("ftGrid"))
          .getPropertyValue("--ft-bar-h")),
        barIs: document.querySelector(".ft-bar").getBoundingClientRect().height,
      }), g.hash);
      ok(grp.scrolled > 100, "a group anchor scrolls to its heading");
      ok(grp.headTop >= grp.barBottom - 4,
         `and the heading clears the sticky bar rather than hiding behind it ` +
         `(heading ${Math.round(grp.headTop)}, bar ends ${Math.round(grp.barBottom)})`);
      ok(Math.abs(grp.said - grp.barIs) <= 1,
         `and --ft-bar-h is the bar's real height once the webfont has landed ` +
         `(${grp.said} written, ${Math.round(grp.barIs)} measured)`);

      eq(grp.current.length, 1,
         `exactly one station tab is marked current (${grp.current.join(", ") || "none"})`);
      ok(grp.current[0] && grp.current[0].endsWith("#" + g.hash),
         `and it is the one deep-linked to (${grp.current[0]} for #${g.hash})`);
      eq(errors.length, 0, `a group deep link throws nothing (${errors.join("; ")})`);
      await page.close();
    }

    for (const bad of ["../etc", "panel-<script>", "%%%", "a b c"]) {
      const { page, errors } = await open(encodeURIComponent(bad));
      const alive = await page.evaluate(() =>
        document.querySelectorAll(".ft-panel[data-panel]").length);
      eq(alive, TICKER_PANELS.length, `a hash of ${JSON.stringify(bad)} paints the page anyway`);
      eq(errors.length, 0, `and throws nothing (${errors.join("; ")})`);
      await page.close();
    }

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
        () => !document.getElementById("ftZoom").open &&
          document.getElementById("ftZoomHost").childElementCount === 0,
        null, { timeout: 3000 });
      const closed = await page.evaluate(() => location.hash);
      eq(closed, before,
         "and closing restores the hash the reader arrived on rather than clearing it");

      const refocused = await page.evaluate(() => document.activeElement &&
        document.activeElement.closest(".ft-panel[data-panel]").dataset.panel);
      eq(refocused, "gamma",
         "and returns focus to the button that opened it, so a keyboard reader " +
         "keeps their place in the grid");

      await page.click('.ft-panel[data-panel="gamma"] .ft-zoom-open');
      await page.waitForFunction(
        () => document.querySelectorAll("#ftZoomHost svg").length > 0, null, { timeout: 3000 });
      const sync = await page.evaluate(() => {
        const zoom = document.getElementById("ftZoom");
        const host = document.getElementById("ftZoomHost");
        const opener = document.querySelector('.ft-panel[data-panel="gamma"] .ft-zoom-open');
        zoom.close();
        return { open: zoom.open, hash: location.hash,
                 focused: document.activeElement === opener,
                 hostChildren: host.childElementCount };
      });
      eq(sync.open, false, "close() clears .open synchronously, so .open is not a wait");
      eq(sync.focused, true,
         "and the BROWSER has already restored focus to the opener in that same turn — " +
         "which is why focus is not a wait either, however much it looks like one");
      eq(sync.hash, "#panel-gamma",
         "while the hash is still the panel's: the close HANDLER has not run yet, so a " +
         "wait satisfied by the two facts above reads the hash one task too early");
      ok(sync.hostChildren > 0,
         `and the enlarge host still holds its drawing (${sync.hostChildren} children) — ` +
         "emptying it is the handler's own work and happens after the hash is written, " +
         "which is what makes it the signal to wait on");
      await page.waitForFunction(
        () => document.getElementById("ftZoomHost").childElementCount === 0,
        null, { timeout: 3000 });
      eq(await page.evaluate(() => location.hash), before,
         "and once the host IS empty the hash is restored, every time");

      eq(errors.length, 0, `the enlarge round trip throws nothing (${errors.join("; ")})`);
      await page.close();
    }
  }

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

    const missing = await say({
      gateOrigin: "2026-09-03", gateDays: 12, windowDays: 21, capBound: false, rows: [],
    });
    ok(/cannot say which stage/.test(missing.text),
       `a name with no funnel row gets no invented stage (${missing.text.slice(0, 120)})`);
    ok(/21 calendar days/.test(missing.text),
       `and is told the window the calendar covers, in its own unit (${missing.text.slice(0, 160)})`);
    ok(/silence here is a missing row, not evidence/.test(missing.text),
       "so its silence is not read as evidence about the name — the reassuring inference " +
       "is the one refused here");
    ok(!/capped/.test(missing.text),
       "and a cap that did NOT bind is not offered as the reason: naming a cause that " +
       "did not operate is the same defect as naming none");

    const cappedOut = await say({
      gateOrigin: "2026-09-03", gateDays: 12, windowDays: 21, capBound: true, rows: [],
    });
    ok(/capped/.test(cappedOut.text),
       `and when the cap DID bind the calendar says so (${cappedOut.text.slice(0, 200)})`);
    ok(/does not reach every name even inside it/.test(cappedOut.text),
       "naming what the cap cost — a window the drawing cannot speak for all of");

    const unread = await say({ status: "pending" });
    ok(/could not be read/.test(unread.text),
       `an unreadable funnel says so rather than guessing (${unread.text.slice(0, 120)})`);
    ok(/not on today/.test(unread.text),
       "while still stating the one thing that IS known: the name is not on the board");
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    const said = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") said.push(m.text()); });
    await mount(page, withChain[0], { ticker: withChain[0].ticker });

    const boxes = await page.evaluate(() => {
      const grid = document.getElementById("ftGrid");
      const gridBox = grid.getBoundingClientRect();
      return {
        gridDisplay: getComputedStyle(grid).display,
        gridWidth: gridBox.width,

        bandH: document.getElementById("ftBand").getBoundingClientRect().height,
        bandM: getComputedStyle(document.getElementById("ftBand")).marginBottom,
        allM: getComputedStyle(document.getElementById("ftAll")).marginBottom,
        stations: [...document.querySelectorAll(".ft-station")].map((s) => {
          const cs = getComputedStyle(s);
          const r = s.getBoundingClientRect();
          return {
            group: s.dataset.group, display: cs.display,
            pad: [cs.paddingLeft, cs.paddingRight],
            border: [cs.borderLeftWidth, cs.borderRightWidth],
            margin: [cs.marginLeft, cs.marginRight],
            inset: r.left - gridBox.left, width: r.width,
          };
        }),

        wide: ["surface", "ivSurface", "skewTerm", "topContracts"].map((k) => {
          const host = document.querySelector(`#panel-${k} > div`);
          return [k, host ? Math.round(host.clientWidth * 100) / 100 : null];
        }),
      };
    });

    eq(boxes.gridDisplay, "grid",
       "the grid lays the panels out, as one continuous wall rather than five");
    eq(boxes.bandH, 0, "the served band measures nothing — every one of its slots is hidden");
    eq(boxes.bandM, "0px", "so it carries no margin under it either, until PR 4 paints it");
    eq(boxes.allM, "0px",
       "and the all-panels link declares no vertical margin, which an inline anchor discards");

    for (const st of boxes.stations) {
      eq(st.display, "contents",
         `the ${st.group} station lays nothing out — one grid holds every panel`);
    }
    const wideW = boxes.wide.filter(([, w]) => w !== null).map(([, w]) => w);
    ok(wideW.length >= 3, "there are span-2 panels in more than one station to compare");
    for (const [key, w] of boxes.wide) {
      ok(w !== null, `${key} has a drawing host`);
      ok(Math.abs(w - wideW[0]) <= 1,
         `${key} mounts at the same width as every other span-2 panel (${w} vs ${wideW[0]}), ` +
         `across three stations — which is what proves the wrapper is not in the layout`);
    }

    const q = await page.evaluate(() => {
      const s = document.getElementById("panel-gamma");
      const served = s.querySelector(".ft-panel-q");
      const drawn = s.querySelector(".fc-q");
      return {
        servedText: served ? served.textContent : null,
        servedShown: !!(served && served.getClientRects().length),
        drawnText: drawn ? drawn.textContent : null,
        drawnShown: !!(drawn && drawn.getClientRects().length),
      };
    });
    eq(q.servedText, TICKER_PANELS.find((p) => p.key === "gamma").question,
       "the served question is the registry's, verbatim");

    const qBox = await page.evaluate(() => {
      const el = document.querySelector("#panel-gamma .ft-panel-q");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), inTree: !el.hidden };
    });
    ok(qBox && qBox.w <= 2 && qBox.h <= 2,
       `the served question is clipped out of the grid rather than drawn (${JSON.stringify(qBox)})`);
    ok(qBox.inTree, "and stays in the document for assistive technology");
    eq(q.drawnText, q.servedText,
       "the renderer still draws the same sentence — deleting the drawn copy would pass " +
       "every assertion here and lose the comparison that catches a drawer handed the card " +
       "where it expected the question");
    ok(!q.drawnShown,
       "and the drawn copy is hidden inside the grid, so the reader is asked the question " +
       "once rather than twice in one box");

    const stats = await page.evaluate(() => {
      const s = document.getElementById("panel-__stats");
      const host = s.querySelector("div");
      const mark = host.querySelector("[data-empty]");
      return {
        sentinel: s.hasAttribute("data-sentinel"),
        childless: host.childElementCount === 0,
        kind: mark ? mark.getAttribute("data-empty") : null,
        text: host.textContent,
        drawnQ: host.querySelector(".fc-q") ? host.querySelector(".fc-q").textContent : null,
        dead: !!host.querySelector(".fc-dead"),
        quiet: !!host.querySelector(".ft-quiet, .fc-quiet"),
        statRows: host.querySelectorAll(".fc-stat").length,
      };
    });
    ok(stats.sentinel, "the key-statistics panel is marked as a sentinel in the served markup");
    ok(!stats.childless,
       "and it renders something — an empty host is the one state a reader cannot tell from " +
       "a broken page");
    ok(stats.statRows >= 8,
       `it draws the gathered figures rather than a placeholder (${stats.statRows} rows)`);
    ok(stats.kind === null || ["quiet", "pending", "unavailable", "unreadable"].includes(stats.kind),
       `and any figure it cannot show wears one of the four silences, never a bare ` +
       `dash (${stats.kind})`);
    ok(!stats.dead,
       "the panel as a whole wears no Unavailable banner — a source panel that declined " +
       "silences its own row and not the seven beside it");
    ok(!/predates|built before/i.test(stats.text),
       `and it never tells a reader their card predates it (${stats.text.slice(0, 70)}) — ` +
       `no card carries a panels.__stats, so that sentence is false on every card`);
    ok(/Spot/.test(stats.text) && /IV rank/.test(stats.text),
       `and it names the figures it gathered (${stats.text.slice(0, 70)})`);
    eq(stats.drawnQ, TICKER_PANELS.find((p) => p.key === "__stats").question,
       "and it heads itself with the registry's question like every other panel");

    await page.click('#panel-gamma .ft-zoom-open');
    await page.waitForFunction(
      () => document.querySelectorAll("#ftZoomHost svg").length > 0, null, { timeout: 3000 });
    const zoomQ = await page.evaluate(() => {
      const el = document.querySelector("#ftZoomHost .fc-q");
      return { text: el ? el.textContent : null, shown: !!(el && el.getClientRects().length) };
    });
    eq(zoomQ.text, q.servedText, "the enlarged panel carries the same question");
    ok(zoomQ.shown, "and it is visible there, because it is the only copy in the dialog");

    eq(errors.length, 0, `the station structure throws nothing (${errors.join("; ")})`);
    eq(said.filter((t) => /chrome/.test(t)).length, 0,
       `and mountChrome reports nothing against the markup the worker really serves ` +
       `(${said.join(" | ").slice(0, 140)})`);
    await page.close();

    {
      const badHTML = pageHTML.replace('data-group="tape" data-tier="chart"',
                                       'data-group="context" data-tier="chart"');
      ok(badHTML !== pageHTML,
         "the mutated markup differs from the served page — a replacement that matched " +
         "nothing would prove the check fires by never testing it");
      const bad = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const cried = [];
      bad.on("console", (m) => { if (m.type() === "error") cried.push(m.text()); });
      await mount(bad, withChain[0], { ticker: withChain[0].ticker, html: badHTML });
      ok(cried.some((t) => /chrome/.test(t) && /path/.test(t) && /context/.test(t)),
         `mountChrome reports the disagreement, naming the panel and both answers ` +
         `(${cried.join(" | ").slice(0, 160)})`);
      await bad.close();
    }
  }

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

      p.scrollIntoView({ block: "center", behavior: "instant" });
      const r = p.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });

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

    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });

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

    const spill = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - window.innerWidth,
      body: document.body.scrollWidth - window.innerWidth,
    }));
    ok(spill.doc <= 1,
       `the painted ticker page does not scroll sideways at 320px (${spill.doc}px)`);
    ok(spill.body <= 1, `and neither does its body (${spill.body}px)`);
    await page.close();
  }

  {

    const READ = (key) => `(() => {
      const host = document.querySelector('.ft-panel[data-panel="${key}"] > div');
      if (!host) return { missing: true };
      const txt = (n) => (n ? n.textContent.replace(/\\s+/g, " ").trim() : null);
      const folded = (n) => {
        const d = n && n.closest("details");
        return d ? { inDetails: true, open: d.open } : { inDetails: false, open: true };
      };
      const leads = [...host.querySelectorAll(".fc-reading.is-lead")];
      const notes = [...host.querySelectorAll(".fc-note")];
      const firstSvg = host.querySelector("svg");
      const firstStats = host.querySelector(".fc-stats");
      const size = (n) => (n ? parseFloat(getComputedStyle(n).fontSize) : null);
      return {
        leads: leads.map(txt),
        leadSize: size(leads[0]),
        noteSize: size(notes[0]),
        leadBeforeChart: !!(leads[0] && firstSvg &&
          (leads[0].compareDocumentPosition(firstSvg) & 4) === 4),
        leadBeforeStats: !!(leads[0] && firstStats &&
          (leads[0].compareDocumentPosition(firstStats) & 4) === 4),
        leadBeforeNote: !!(leads[0] && notes[0] &&
          (leads[0].compareDocumentPosition(notes[0]) & 4) === 4),
        qualifiers: [...host.querySelectorAll(".fc-note.is-qualifier")]
          .map((n) => ({ text: txt(n), ...folded(n) })),
        notes: notes.map((n) => ({ text: txt(n), ...folded(n) })),
        howSummaries: [...host.querySelectorAll("details.ft-how > summary")].map(txt),
        openByDefault: [...host.querySelectorAll("details.ft-how")].map((d) => d.open),
        all: host.textContent.replace(/\\s+/g, " "),
        marked: [...host.querySelectorAll(".fc-why")].length,
        titled: [...host.querySelectorAll("[title]")]
          .filter((n) => n.textContent.replace(/\\s+/g, " ").trim().length <= 48 &&
                         n.textContent.trim())
          .map((n) => ({ marked: n.classList.contains("fc-why"),
                         tag: n.tagName, text: txt(n) })),
        whyList: (() => {
          const box = host.querySelector("details.ft-why");
          if (!box) return null;
          return {
            open: box.open,
            summary: txt(box.querySelector("summary")),
            terms: [...box.querySelectorAll(".ft-why-t")].map(txt),
            whys: [...box.querySelectorAll(".ft-why-d")].map(txt),
            summaryTab: box.querySelector("summary").tabIndex,
          };
        })(),
        addedTabStops: [...host.querySelectorAll("[title][tabindex]")].length,
        decoration: (() => {
          const n = host.querySelector(".fc-why:not(.fc-stat)");
          if (!n) return null;
          const cs = getComputedStyle(n);
          return { line: cs.textDecorationLine, style: cs.textDecorationStyle,
                   cursor: cs.cursor };
        })(),
      };
    })()`;

    {
      const card = withChain[0];
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const st = await page.evaluate(READ("skewTerm"));
      const iv = await page.evaluate(READ("ivSurface"));

      eq(st.leads.length, 2,
         `skewTerm leads on its two scalars, each in its own element (${st.leads.length})`);
      ok(/^Skew /.test(st.leads[0]),
         `the skew reading is first and says so ("${(st.leads[0] || "").slice(0, 60)}")`);
      ok(/^Term /.test(st.leads[1]),
         `the term reading second ("${(st.leads[1] || "").slice(0, 60)}")`);
      ok(st.leadBeforeChart,
         "and both come BEFORE the chart in DOM order — the chart is the shape of the " +
         "term structure and the scalars are what a desk carries away from it, so the " +
         "picture is now the reading's evidence rather than its preamble");
      ok(st.leadBeforeNote,
         "and before the first method paragraph, which is the ordering this section exists " +
         "for: 87 method paragraphs against 4 readings was the ratio that named the defect");

      ok(st.leadSize > st.noteSize,
         `the reading is set larger than the method under it (${st.leadSize}px against ` +
         `${st.noteSize}px) — DOM order alone is invisible to someone scanning a page`);

      const axis = st.notes.find((n) => /The origin is ZERO/.test(n.text));
      ok(axis, "the axis policy is still on the panel, in full");
      ok(axis && axis.inDetails,
         "behind the panel's own disclosure rather than in the open — 750 characters of " +
         "how-the-bars-were-drawn is a wall a reader scrolls past, not a rule they read");
      ok(axis && !axis.open,
         "and shut by default, which is the whole saving; an open <details> is a paragraph");
      ok(/The origin is ZERO/.test(st.all),
         "and STILL IN textContent with the disclosure shut, so a find-in-page and a " +
         "screen reader's find both reach it — folded is not hidden");
      ok(st.howSummaries.some((t) => /How to read this term structure/.test(t)),
         `the disclosure names what is under it (${JSON.stringify(st.howSummaries)}) — ` +
         "a summary that says nothing is a click a reader will not spend");

      eq(iv.leads.length, 1, "the surface leads on exactly one reading");
      ok(iv.leadBeforeChart && iv.leadBeforeStats,
         "before its grid and before its stat list — the steepest cell used to be the " +
         "fourth cell of that list, below the fold on a phone");
      ok(/volatility points (above|below)/.test(iv.leads[0]),
         `and it states the steepest cell with its direction in words ("${iv.leads[0]}")`);

      ok(/[−+]\d+\.\d volatility points/.test(iv.leads[0]),
         `carrying the sign as a glyph, U+2212 for a negative ("${iv.leads[0]}")`);

      const pts = /([−+]\d+\.\d) volatility points/.exec(iv.leads[0]);
      ok(pts && iv.all.includes(pts[1] + " pts"),
         `the lead and the "Steepest cell" statistic are the same number (${pts && pts[1]}) ` +
         "— it is measured once, at the top of the drawer, so the sentence a reader reads " +
         "first and the cell they check it against cannot drift apart");

      eq(errors.length, 0, "both inverted panels draw without throwing");
      await page.close();
    }

    {
      const flat = JSON.parse(JSON.stringify(withChain[0]));
      let zeroed = 0;
      flat.panels.ivSurface.skew = flat.panels.ivSurface.skew.map((row) =>
        row.map((v) => (typeof v === "number" && Number.isFinite(v) ? (zeroed++, 0) : v)));
      ok(zeroed > 0, `the flat fixture really carries ${zeroed} measured zeros`);

      const gone = JSON.parse(JSON.stringify(withChain[0]));
      gone.panels.ivSurface.skew = gone.panels.ivSurface.skew.map((row) => row.map(() => null));

      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      await mount(page, flat, { ticker: flat.ticker });
      const a = await page.evaluate(READ("ivSurface"));
      ok(/measured flat smile/.test(a.leads[0]),
         `a surface measured flat says so ("${a.leads[0]}")`);
      ok(!/above|below/.test(a.leads[0]),
         "and claims no direction, because a zero has none");
      ok(!/No cell/.test(a.leads[0]),
         "and is never told as an absence — a flat smile is a finding about the book, and " +
         "the difference between it and an unmeasured one is the difference this whole " +
         "product is built to keep");
      ok(a.all.includes("Steepest cell"),
         "the statistic still names the cell the reading came from");
      await page.close();

      const page2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      page2.on("pageerror", (e) => errors.push(String(e)));
      await mount(page2, gone, { ticker: gone.ticker });
      const b = await page2.evaluate(READ("ivSurface"));
      ok(/^No cell on this surface carries a measured distance/.test(b.leads[0]),
         `an unmeasured surface leads on the absence instead ("${b.leads[0]}")`);
      ok(!/flat/.test(b.leads[0]), "and never borrows the flat reading's word");
      ok(!b.all.includes("Steepest cell"),
         "and publishes no steepest cell at all, rather than a confident zero in the slot");
      eq(errors.length, 0, "neither arm throws");
      await page2.close();
    }

    if (truncated.length) {
      const card = truncated[0];
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const iv = await page.evaluate(READ("ivSurface"));
      const arb = iv.qualifiers.find((n) => /arbitrary subset of the book/.test(n.text));
      ok(arb, "the truncated surface still says the picture may be an arbitrary slice");
      ok(arb && !arb.inDetails,
         "in the open, with nothing to click — this is the line that says the whole picture " +
         "may be a page of the book rather than the book, and a caveat behind a disclosure " +
         "is a caveat most readers will never meet");
      for (const q of iv.qualifiers) {
        ok(!q.inDetails,
           `no qualifier on the surface is folded ("${q.text.slice(0, 55)}") — the split is ` +
           "by whether a note changes what the reading MEANS, never by how long it is");
      }
      eq(errors.length, 0, "the truncated card draws without throwing");
      await page.close();
    }

    {
      const found = cards.find((c) => c.panels && c.panels.skewTerm &&
        c.panels.skewTerm.status === "ok" && c.panels.skewTerm.skew === null &&
        c.panels.skewTerm.skewReason);
      const card = JSON.parse(JSON.stringify(found || withChain[0]));
      if (!found) {
        card.panels.skewTerm.skew = null;
        card.panels.skewTerm.skewBasis = null;
        card.panels.skewTerm.skewReason =
          "no listed strike sat within 0.04 of either wing on an expiry past the day floor";
      }
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const st = await page.evaluate(READ("skewTerm"));
      ok(st.leads.length === 2,
         `the panel still leads on two scalars with one of them withheld (${st.leads.length})`);
      ok(/^The wing-to-wing skew is not published/.test(st.leads[0] || ""),
         `and the withheld one LEADS ("${(st.leads[0] || "").slice(0, 60)}") — demoting an ` +
         "absence would make a silence cheaper to ship than a number");
      ok(!/\d/.test(st.leads[0] || ""),
         `carrying no digit at all ("${st.leads[0]}"), because a reader who sees a number ` +
         "where a reason belongs has been told something the chain never said");
      ok(st.leadBeforeChart && st.leadBeforeNote,
         "and it is still first — an absence is a finding and is placed like one");

      const why = st.qualifiers.find((n) =>
        /is not published:|Neither scalar is published/.test(n.text));
      ok(why, "the reason it was withheld is on the panel, verbatim");
      ok(why && !why.inDetails,
         `in the open, beside the reading it explains ("${(why.text || "").slice(0, 60)}")`);
      ok(st.qualifiers.every((q) => !q.inDetails),
         "and so is every other qualifier the panel raised");
      eq(errors.length, 0, "the withheld-scalar card draws without throwing");
      await page.close();
    }

    {
      const STATS = `(() => {
        const host = document.querySelector('.ft-panel[data-panel="skewTerm"] > div');
        if (!host) return { missing: true };
        return {
          pairs: [...host.querySelectorAll(".fc-stats .fc-stat")].map((s) => {
            const dd = s.querySelector("dd");
            const cs = getComputedStyle(dd);
            return {
              term: (s.querySelector("dt").textContent || "").trim(),
              value: (dd.textContent || "").replace(/\\s+/g, " ").trim(),
              empty: dd.getAttribute("data-empty"),
              why: dd.getAttribute("title"),
              mark: getComputedStyle(dd, "::after").content,
              rule: cs.borderLeftStyle + " " + cs.borderLeftWidth,
              folded: !!dd.closest("details"),
            };
          }),
        };
      })()`;
      const base = withChain.find((c) => c.panels && c.panels.skewTerm &&
        c.panels.skewTerm.status === "ok");
      ok(base, "an emitted card carries a drawn chain panel to withhold figures from");

      const card = JSON.parse(JSON.stringify(base));
      card.panels.skewTerm.atmIv = null;
      card.panels.skewTerm.atmReason =
        "no expiry past the floor carried an at-the-money contract that traded today";
      delete card.panels.skewTerm.atmBand;

      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });
      const st = await page.evaluate(STATS);

      const lvl = st.pairs.find((p) => /^At-the-money level/.test(p.term));
      ok(lvl, "the chain panel states its headline at-the-money level as a labelled figure");
      eq(lvl && lvl.value, "—",
         "and withholds it on a card whose chain levelled nothing");
      eq(lvl && lvl.empty, "quiet",
         `naming the silence it is — measured, and empty (${lvl && lvl.empty}) — where a bare ` +
         "dash would read the same as a field this card never carried");
      eq(lvl && lvl.why, card.panels.skewTerm.atmReason,
         "carrying the chain's own reason verbatim rather than a second wording of it");
      ok(lvl && /solid/.test(lvl.rule) === true,
         `and a hairline rule beside it (${lvl && lvl.rule}) — quiet is the one kind that ` +
         "takes no glyph, so without a rule it would be faint ink alone and faint ink is " +
         "one ink in greyscale");
      ok(lvl && !lvl.folded,
         "in the open: a withholding is never folded behind a disclosure");

      const band = st.pairs.find((p) => /^Moneyness band/.test(p.term));
      ok(band, "the band the level was taken inside is stated beside it");
      eq(band && band.empty, "unavailable",
         `and a card that never published that constant says so (${band && band.empty}), ` +
         "which is a different fact from a chain that measured and found nothing");
      eq(band && band.mark, '"†"',
         `wearing the dagger this site gives that kind (${band && band.mark}) — the mark, ` +
         "not the colour, is what separates it from the level above it");
      ok(band && band.why && band.why.length > 40,
         `with the sentence that says what is missing ("${(band && band.why || "").slice(0, 48)}")`);
      eq(errors.length, 0, "the withheld-figure card draws without throwing");
      await page.close();

      const odd = JSON.parse(JSON.stringify(base));
      odd.panels.skewTerm.atmIv = "n/a";
      odd.panels.skewTerm.atmReason = null;
      const p2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errs2 = [];
      p2.on("pageerror", (e) => errs2.push(String(e)));
      await mount(p2, odd, { ticker: odd.ticker });
      const st2 = await p2.evaluate(STATS);
      const lvl2 = st2.pairs.find((p) => /^At-the-money level/.test(p.term));
      eq(lvl2 && lvl2.value, "—",
         "a level that is not a number is withheld rather than printed");
      eq(lvl2 && lvl2.empty, "unreadable",
         `and says the bytes did not read (${lvl2 && lvl2.empty}) rather than that the field ` +
         "was absent, which is the fact that would send a reader to the wrong place");
      eq(lvl2 && lvl2.mark, '"×"',
         `wearing the cross (${lvl2 && lvl2.mark}), so it is not the dagger in greyscale`);
      ok(lvl2 && lvl2.why && lvl2.why.length > 40,
         `and still carries a sentence with no reason on the payload to borrow ` +
         `("${(lvl2 && lvl2.why || "").slice(0, 48)}")`);
      eq(errs2.length, 0, "the unreadable-level card draws without throwing");
      await p2.close();
    }

    {
      const base = withChain.find((c) =>
        c.panels.marketRank && c.panels.marketRank.status === "ok" &&
        c.panels.marketRank.feeds.oiChange.status === "ok");
      ok(base, "an emitted card places in the market-wide open-interest feed");
      const card = JSON.parse(JSON.stringify(base));

      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const got = await page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
        const txt = (n) => (n ? n.textContent.replace(/\s+/g, " ").trim() : null);

        const folded = (n) => {
          const d = n && n.closest("details");
          return {
            qualifier: !!(n && n.classList.contains("is-qualifier")),
            inDetails: !!d, open: d ? d.open : true,
          };
        };
        return [...host.querySelectorAll(".fmr-block")].map((b) => {
          const lead = b.querySelector(".fc-reading.is-lead");
          const stats = b.querySelector(".fc-stats");
          return {
            lead: txt(lead),
            leadBeforeStats: !!(lead && stats &&
              (lead.compareDocumentPosition(stats) & 4) === 4),
            when: { text: txt(b.querySelector(".fmr-when")),
                    ...folded(b.querySelector(".fmr-when")) },
            cut: { text: txt(b.querySelector(".fmr-cut")),
                   ...folded(b.querySelector(".fmr-cut")) },
            said: { text: txt(b.querySelector(".fmr-said")),
                    ...folded(b.querySelector(".fmr-said")) },
            all: b.textContent.replace(/\s+/g, " "),
          };
        });
      });

      const oi = got[0];
      ok(/^This name ranks \d+ of \d+/.test(oi.lead || ""),
         `the block leads on where the name places, with the population ("${oi.lead}") — a ` +
         "bare ordinal is a number a reader cannot size, and it used to be stated in prose " +
         "underneath four paragraphs of provenance");
      ok(oi.leadBeforeStats,
         "before the figures rather than after them");
      ok(/contract|%|\$/.test(oi.lead || ""),
         `and the unit travels with the value in the sentence ("${oi.lead}")`);

      ok(/NOT the session this card describes/.test(oi.when.text || ""),
         `the ranking still says outright that it is from another session ("${
           (oi.when.text || "").slice(0, 70)}")`);
      ok(oi.when.qualifier && !oi.when.inDetails,
         "and says it in the open, marked as a qualifier — this is the difference between " +
         "\"ranks 14th across the market today\" and \"ranked 14th yesterday, joined onto " +
         "today's card\", which is the whole reason the line exists");

      ok(!oi.cut.qualifier,
         `the cut is NOT a qualifier on a name that placed ("${(oi.cut.text || "").slice(0, 55)}") ` +
         "— the name is in the list, so how the list was cut is method");

      ok(!oi.cut.qualifier && (!oi.cut.inDetails || !oi.cut.open),
         "and it is method either way — inlined when the method set is short, never " +
         "raised as a qualifier, and never behind a disclosure left open");
      ok(/last place in the feed held|reaches back to|no order this run could measure/
        .test(oi.all),
         "and still readable in the block's text with the disclosure shut");
      ok(!oi.said.qualifier && (!oi.said.inDetails || !oi.said.open),
         "so is the sentence about what a cross-section is, which is method by any reading — " +
         "same rule as the cut above, and for the same reason: the renderer never puts it on " +
         "the open side, so the class is the assertion and the disclosure is its usual effect");
      ok(!/This name places \d+ of \d+/.test(oi.all),
         "and the rank is stated ONCE — the prose copy under the figures is gone, because " +
         "two copies of one number are two numbers that can drift");
      eq(errors.length, 0, "the panel draws without throwing");
      await page.close();

      {
        const fat = JSON.parse(JSON.stringify(base));
        const cov = fat.panels.marketRank.coverage.oiChange;
        cov.in = cov.of;
        const page2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
        const errs2 = [];
        page2.on("pageerror", (e) => errs2.push(String(e)));
        await mount(page2, fat, { ticker: fat.ticker });
        const fatGot = await page2.evaluate(() => {
          const b = document.querySelector('.ft-panel[data-panel="marketRank"] .fmr-block');
          if (!b) return null;
          const q = (s) => b.querySelector(s);
          const state = (n) => (n
            ? { there: true, qualifier: n.classList.contains("is-qualifier"),
                inDetails: !!n.closest("details"),
                open: n.closest("details") ? n.closest("details").open : true }
            : { there: false });
          const method = [...b.querySelectorAll(".fmr-cut, .fmr-cover, .fmr-said")]
            .filter((n) => !n.classList.contains("is-qualifier"));
          return {
            cover: state(q(".fmr-cover")),
            cut: state(q(".fmr-cut")),
            methodChars: method.reduce((n, x) => n + (x.textContent || "").length, 0),
          };
        });
        ok(fatGot && fatGot.cover.there,
           "the fattened join still draws its coverage line");
        ok(fatGot && !fatGot.cover.qualifier,
           "and a join this wide is NOT a qualifier — the renderer only raises the coverage " +
           "line into the open when most cards would say they are not in the feed, which is " +
           "the sentence a reader has to meet unopened");

        ok(fatGot && fatGot.methodChars > 420,
           `and the method set clears the 420-character wall (${fatGot && fatGot.methodChars}), ` +
           "so the disclosure below is the branch under test rather than a short set left inline");
        ok(fatGot && fatGot.cut.inDetails && !fatGot.cut.open,
           "so the method IS folded behind a disclosure, and it is shut — the path every " +
           "emitted card stopped taking when the coverage population widened");
        eq(errs2.length, 0, "and the fattened panel draws without throwing");
        await page2.close();
      }
    }

    {
      const card = JSON.parse(JSON.stringify(withChain[0]));
      const quiet = withChain
        .map((c) => c.panels.marketRank && c.panels.marketRank.feeds.oiChange)
        .find((f) => f && f.status === "quiet");
      ok(quiet, "the emitted corpus contains a name that is in no market-wide list");
      card.panels.marketRank.feeds.oiChange = JSON.parse(JSON.stringify(quiet));
      const placed = withChain
        .map((c) => c.panels.marketRank && c.panels.marketRank.feeds.darkpool)
        .find((f) => f && f.status === "ok");
      ok(placed, "and one that places in the dark-pool list, so the folded arm is the one under test");
      card.panels.marketRank.feeds.darkpool = JSON.parse(JSON.stringify(placed));

      card.panels.marketRank.feeds.darkpool.sameSession = true;
      card.panels.marketRank.feeds.darkpool.asOfStated = true;
      card.panels.marketRank.feeds.darkpool.asOf = card.sessionDate;

      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const got = await page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
        const txt = (n) => (n ? n.textContent.replace(/\s+/g, " ").trim() : null);
        const folded = (n) => {
          const d = n && n.closest("details");
          return {
            qualifier: !!(n && n.classList.contains("is-qualifier")),
            inDetails: !!d, open: d ? d.open : true,
          };
        };
        return [...host.querySelectorAll(".fmr-block")].map((b) => ({
          cut: { text: txt(b.querySelector(".fmr-cut")),
                 ...folded(b.querySelector(".fmr-cut")) },
          when: { text: txt(b.querySelector(".fmr-when")),
                  ...folded(b.querySelector(".fmr-when")) },
          empty: (b.querySelector("[data-empty]") || {}).getAttribute
            ? b.querySelector("[data-empty]").getAttribute("data-empty") : null,
          all: b.textContent.replace(/\s+/g, " "),
        }));
      });

      eq(got[0].empty, "quiet", "the fixture really renders the quiet arm");
      ok(got[0].cut.qualifier && !got[0].cut.inDetails,
         `the cut is a QUALIFIER on a name that is NOT in the list ("${
           (got[0].cut.text || "").slice(0, 60)}") — there it is the scale of the miss, and a ` +
         "near miss and a name nowhere near the list are different readings. The same line " +
         "is method on the arm above, and the feed decides which");
      ok(got[0].cut.text && got[0].cut.text.length > 20,
         "and it carries its sentence rather than being an empty element");

      ok(!got[1].when.qualifier,
         "the session line is NOT a qualifier where the feed dates itself to this card's " +
         "own session — that branch qualifies nothing");
      ok(got[1].when.inDetails,
         `the session line folds on the ONE branch where it qualifies nothing — the feed ` +
         `dates itself to this card's own session ("${(got[1].when.text || "").slice(0, 60)}")`);
      ok(/the same session this card describes/.test(got[1].all),
         "and is still readable with the disclosure shut");
      eq(errors.length, 0, "both arms draw without throwing");
      await page.close();
    }

    {
      const card = withChain[0];
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const swept = await page.evaluate(() => {
        const out = [];
        for (const section of document.querySelectorAll(".ft-panel[data-panel] > div")) {
          const key = section.parentElement.dataset.panel;
          const titled = [...section.querySelectorAll("[title]")]
            .filter((n) => {
              const t = n.textContent.replace(/\s+/g, " ").trim();
              return t && t.length <= 48;
            });
          const box = section.querySelector("details.ft-why");
          out.push({
            key,
            titled: titled.length,
            unmarked: titled.filter((n) => !n.classList.contains("fc-why"))
              .map((n) => n.tagName + ":" + n.textContent.trim().slice(0, 24)),
            tabbed: [...section.querySelectorAll("[title][tabindex]")].length,
            terms: box ? [...box.querySelectorAll(".ft-why-t")].map((n) => n.textContent) : null,
            whys: box ? [...box.querySelectorAll(".ft-why-d")].map((n) => n.textContent) : null,
            summary: box ? box.querySelector("summary").textContent : null,
            summaryTab: box ? box.querySelector("summary").tabIndex : null,
            boxOpen: box ? box.open : null,
          });
        }
        const mark = document.querySelector(".ft-panel .fc-why:not(.fc-stat)");
        const cs = mark ? getComputedStyle(mark) : null;
        const stat = document.querySelector(".ft-panel .fc-stat.fc-why");
        return {
          panels: out,
          mark: cs ? { line: cs.textDecorationLine, style: cs.textDecorationStyle,
                       cursor: cs.cursor } : null,
          statMark: stat ? {
            self: getComputedStyle(stat).textDecorationLine,
            dt: getComputedStyle(stat.querySelector("dt")).textDecorationLine,
          } : null,
        };
      });

      const titledTotal = swept.panels.reduce((n, p) => n + p.titled, 0);
      ok(titledTotal >= 20,
         `the page really carries explained elements to mark (${titledTotal}) — an assertion ` +
         "about marking nothing would pass on a page that renders nothing");
      const unmarked = swept.panels.flatMap((p) => p.unmarked.map((t) => p.key + " " + t));
      eq(unmarked.length, 0,
         `every explained element carries the affordance (${unmarked.slice(0, 4).join(" | ")}) ` +
         "— an explanation a reader cannot tell is there is the appearance of documentation");

      ok(swept.mark && /underline/.test(swept.mark.line),
         `and the affordance is VISIBLE: a dotted rule under the marked text (${
           JSON.stringify(swept.mark)})`);
      eq(swept.mark && swept.mark.style, "dotted",
         "dotted rather than solid, because a solid underline on this page means a link");
      eq(swept.mark && swept.mark.cursor, "help",
         "with the pointer saying the same thing a second way");

      if (swept.statMark) {
        ok(!/underline/.test(swept.statMark.self),
           "a stat wrapper that carries the tooltip is NOT itself underlined — the rule " +
           "would paint across the figure too, and a child cannot take it back");
        ok(/underline/.test(swept.statMark.dt),
           "the mark goes on its label, which is the term the explanation is about");
      }

      const withList = swept.panels.filter((p) => p.terms);
      ok(withList.length >= 3,
         `${withList.length} panels publish a decoder for their marked terms`);
      for (const p of withList) {
        eq(p.terms.length, p.whys.length, `${p.key}: every listed term has an explanation`);
        ok(p.terms.every((t) => t.trim()), `${p.key}: and no term is blank`);
        ok(p.whys.every((w) => w.trim().length > 10),
           `${p.key}: and no explanation is a stub`);
        ok(p.summary.includes("(" + p.terms.length + ")"),
           `${p.key}: the summary counts what is under it ("${p.summary}") — a list that ` +
           "says nothing about its own size is a list a reader opens blind");
        eq(p.summaryTab, 0,
           `${p.key}: the summary is reachable by keyboard with no tabindex of its own`);
        eq(p.boxOpen, false, `${p.key}: and shut until it is asked for`);
      }
      const tabbed = swept.panels.reduce((n, p) => n + p.tabbed, 0);
      eq(tabbed, 0,
         `no explained element became a tab stop (${tabbed}) — tabindex="0" on 145 elements ` +
         "buys the keyboard reader the explanation at the price of 145 stops between them " +
         "and the next panel, and the browser still shows them nothing on focus");
      eq(errors.length, 0, "the sweep throws nothing");
      await page.close();
    }
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain.find((c) => c.panels.path && c.panels.path.status === "ok") ||
      withChain[0];
    await mount(page, card, { ticker: card.ticker });

    const pathPanel = card.panels.path;
    if (pathPanel && pathPanel.status === "ok") {
      ok(typeof pathPanel.netDeltaUnit === "string" && pathPanel.netDeltaUnit.length > 0,
         `the emitted card publishes a unit for path.netDelta ("${pathPanel.netDeltaUnit}")`);
      ok(typeof pathPanel.netPremiumUnit === "string" && pathPanel.netPremiumUnit.length > 0,
         `and one for path.netPremium ("${pathPanel.netPremiumUnit}")`);
      const drawn = await page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="path"] > div');
        const unit = host.querySelector(".fp-unit");
        return {
          text: host.textContent.replace(/\s+/g, " "),
          unit: unit ? unit.textContent.replace(/\s+/g, " ") : null,
          aria: (host.querySelector("svg[role=img]") || {}).getAttribute
            ? host.querySelector("svg[role=img]").getAttribute("aria-label") : "",
        };
      });
      ok(drawn.unit, "the session path prints a unit sentence under its stat block");
      ok(drawn.unit.includes(pathPanel.netDeltaUnit),
         `and it is the payload's own unit for net delta, verbatim ("${drawn.unit}")`);
      ok(drawn.unit.includes(pathPanel.netPremiumUnit),
         "and the payload's own unit for net premium, verbatim");
      ok(drawn.aria.includes(pathPanel.netDeltaUnit),
         "and the chart's aria-label — the whole panel, to a screen reader — carries the " +
         "delta unit beside the total it labels");
    }
    eq(errors.length, 0, `the unit sweep throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const base = withChain.find((c) => c.panels.pricedMove &&
      c.panels.pricedMove.status === "ok" && typeof c.panels.pricedMove.ivRank === "number");
    ok(base, "an emitted card publishes a numeric pricedMove.ivRank to mutate");
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const readRank = () => page.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="pricedMove"] > div');
      for (const stat of host.querySelectorAll(".fc-stat")) {
        const dt = stat.querySelector("dt"), dd = stat.querySelector("dd");
        if (!/IV rank/i.test(dt.textContent)) continue;
        return { label: dt.textContent, value: dd.textContent.trim(),
                 empty: dd.getAttribute("data-empty"), why: dd.getAttribute("title") || "" };
      }
      return null;
    });

    const ok1 = JSON.parse(JSON.stringify(base));
    ok1.panels.pricedMove.ivRank = 0.5215;
    await mount(page, ok1, { ticker: ok1.ticker });
    const good = await readRank();
    ok(good, "the priced move panel carries an IV rank stat");
    ok(/percentile of its own year/.test(good.label),
       `its label states the unit and the population ("${good.label}") — "% of its year" ` +
       "over a bare 52 says neither, and the card carries a second IV rank in the other unit");
    eq(good.value, "52 of 100", "and the figure is stated out of the 100 it is a percentile of");
    eq(good.empty, null, "a reading in the unit this line reads is not marked as a silence");

    const bad = JSON.parse(JSON.stringify(base));
    bad.panels.pricedMove.ivRank = 52.15;
    await mount(page, bad, { ticker: bad.ticker });
    const wrong = await readRank();
    ok(wrong, "the panel still draws its IV rank stat on the mutated card");
    ok(!/5215|521[0-9]%/.test(wrong.value),
       `a 0-100 rank never reaches the fraction formatter (got "${wrong.value}")`);
    eq(wrong.value, "\u2014", "it is withheld as an em dash rather than printed");
    eq(wrong.empty, "unreadable",
       "and marked unreadable — the field IS published, and these are bytes this page " +
       "could not parse in the unit the line reads. Absent would be `unavailable`, " +
       "which is a different fact and gets a different mark");
    ok(wrong.why.length > 20 && /unit/.test(wrong.why),
       `with the sentence that says which silence it is ("${wrong.why.slice(0, 60)}")`);

    const gone = JSON.parse(JSON.stringify(base));
    delete gone.panels.pricedMove.ivRank;
    await mount(page, gone, { ticker: gone.ticker });
    const absent = await readRank();
    eq(absent.value, "\u2014", "an absent rank is an em dash too");
    eq(absent.empty, "unavailable",
       "but marked unavailable, not unreadable: no rank at all and a rank in the wrong " +
       "unit are two different facts about the payload");

    eq(errors.length, 0, `the IV rank arms throw nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, withChain[0], { ticker: withChain[0].ticker });

    const ground = await page.evaluate(() => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      const hex = raw.replace("#", "");
      const n = hex.length === 3 ? [...hex].map((c) => parseInt(c + c, 16))
                                 : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
    });
    ok(ground > 0 && ground < 40,
       `--bg resolves to a dark ground (${ground.toFixed(2)} of 255) — the whole ` +
       "polarity argument below assumes it, so it is checked rather than assumed");

    const columns = async (shot) => page.evaluate(async (b64) => {
      const bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u8], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext("2d");
      x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
      const cols = [];
      for (let px = 0; px < bmp.width; px++) {
        let sum = 0;
        for (let y = 0; y < bmp.height; y++) {
          const i = (bmp.width * y + px) << 2;
          sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        }
        cols.push(sum / bmp.height);
      }
      return cols;
    }, shot.toString("base64"));

    const rail = await page.$(".flows-rail");
    ok(rail, "the ticker page serves the section rail this measurement reads");
    const overflow = await page.evaluate(() => {
      const el = document.querySelector(".flows-rail");
      el.scrollLeft = 0;
      return el.scrollWidth - el.clientWidth;
    });
    ok(overflow > 40,
       `and at 320px it actually scrolls, hiding ${overflow}px — an edge on a strip ` +
       "with nothing past it would be a lie, so the premise is measured first");

    const atStart = await columns(await rail.screenshot());
    await page.evaluate(() => {
      const el = document.querySelector(".flows-rail");
      el.scrollLeft = el.scrollWidth;
    });
    await page.waitForTimeout(120);
    const atEnd = await columns(await rail.screenshot());

    const W = atStart.length;
    eq(atEnd.length, W, "both screenshots are the same width, so the columns line up");

    const band = (cols, side) => Math.max(...(side === "left"
      ? cols.slice(0, 14) : cols.slice(W - 14, W - 1)));
    const LIT = 15, FLAT = 3;

    const middle = (cols) => {
      const inner = cols.slice(14, W - 14).slice().sort((a, b) => a - b);
      return inner.length ? inner[inner.length >> 1] : ground;
    };
    const startBase = middle(atStart), endBase = middle(atEnd);
    const startRight = band(atStart, "right"), startLeft = band(atStart, "left");
    const endRight = band(atEnd, "right"), endLeft = band(atEnd, "left");

    ok(startRight - startBase >= LIT,
       `scrolled to the start, the RIGHT edge stands off the ground ` +
       `(${startRight.toFixed(2)} against ${startBase.toFixed(2)}) — this is the assertion ` +
       "a black shadow on a black page fails, and did: it measured four counts");
    ok(startLeft - startBase <= FLAT,
       `and the LEFT edge is the strip itself (${startLeft.toFixed(2)} against ` +
       `${startBase.toFixed(2)}) — nothing is hidden that way, so nothing may suggest it`);
    ok(endLeft - endBase >= LIT,
       `scrolled to the end, the LEFT edge stands off the ground ` +
       `(${endLeft.toFixed(2)} against ${endBase.toFixed(2)})`);
    ok(endRight - endBase <= FLAT,
       `and the RIGHT edge has PUT ITSELF AWAY (${endRight.toFixed(2)} against ` +
       `${endBase.toFixed(2)}) — a static fade cannot do this, and would sit here ` +
       "telling a reader to swipe past the last item in the strip");

    const strips = await page.evaluate(() => {

      const layersOf = (value) => {
        if (!value || value === "none") return 0;
        let depth = 0, n = 1;
        for (const ch of value) {
          if (ch === "(") depth++;
          else if (ch === ")") depth--;
          else if (ch === "," && depth === 0) n++;
        }
        return n;
      };
      const out = [];
      for (const el of document.querySelectorAll(".ft-bar .ft-head, .flows-rail, .ft-tabs, .ft-topline, .ft-chips")) {
        if (el.scrollWidth - el.clientWidth < 8) continue;
        const cs = getComputedStyle(el);
        out.push({
          sel: el.className,
          hides: el.scrollWidth - el.clientWidth,
          layers: layersOf(cs.backgroundImage),
          attach: cs.backgroundAttachment.replace(/\s+/g, " "),
        });
      }
      return out;
    });
    ok(strips.length >= 3,
       `at 320px the chrome has ${strips.length} strips that scroll inside themselves ` +
       "— the three this rule was written for, at least");
    for (const s of strips) {
      eq(s.layers, 4,
         `"${s.sel}" hides ${s.hides}px and carries four background layers — two ground, ` +
         "two edge. A scrolling strip with fewer is one a reader is never told to swipe");
      eq(s.attach, "local, local, scroll, scroll",
         `and pairs them local/local/scroll/scroll ("${s.sel}") — the ground rides with ` +
         "the content and uncovers the edge, which is the entire mechanism; all-scroll " +
         "is a permanent fade and all-local never shows one");
    }

    eq(errors.length, 0, `the scroll-affordance measurement throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const { fitGarch } = await import("../shared/flows-garch.js");
    let seed = 0x9E3779B9 ^ 3;
    const rnd = () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const px = [100], dates = ["2020-01-01"];
    let s2 = 1;
    for (let i = 1; i <= 1500; i++) {
      const u1 = rnd() || 1e-9, u2 = rnd();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * (rnd() < 0.08 ? 3 : 1) / Math.sqrt(0.92 + 0.08 * 9);
      const e = Math.sqrt(s2) * z;
      px.push(px[px.length - 1] * Math.exp(e / 100));
      s2 = 0.05 + 0.1 * e * e + 0.85 * s2;
      dates.push(new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10));
    }
    const fitted = JSON.parse(JSON.stringify(withChain[0]));
    fitted.panels.context = { ...(fitted.panels.context || {}), status: "ok", garch: fitGarch(px, dates) };
    const g0 = fitted.panels.context.garch;
    ok(g0.status === "ok" && g0.dist === "skewt" && g0.converged === true,
       `the fixture carries a converged skewed-t fit (${g0.status}, ${g0.dist}, ${g0.reason || "settled"})`);
    await mount(page, fitted, { ticker: fitted.ticker, station: "all" });
    const garch = await page.evaluate(() => {
      const host = document.getElementById("ftGarch");
      return {
        hidden: host.hidden,
        heading: document.getElementById("ftGarchH").textContent,
        cells: [...host.querySelectorAll(".ft-garch-p")].map((c) =>
          [c.querySelector("dt").textContent, c.querySelector("dd").textContent]),
        note: document.getElementById("ftGarchS").textContent,
        leftovers: host.querySelectorAll(".ft-garch-bin, .ft-garch-dist, .ft-garch-ged, .ft-garch-dsvg").length,
        path: host.querySelectorAll(".ft-garch-line").length,
        ewma: host.querySelectorAll(".ft-garch-ewma").length,
        levels: [...host.querySelectorAll(".ft-garch-lvl-t")].map((t) => t.textContent),
        legend: [...host.querySelectorAll(".ft-garch-lg")].map((t) => t.textContent),
        qualifier: host.querySelector("#ftGarchH .ft-chart-h-q") ? getComputedStyle(host.querySelector("#ftGarchH .ft-chart-h-q")).whiteSpace : null,
      };
    });
    ok(!garch.hidden, "a fitted name shows the volatility card");
    ok(/skewed t/.test(garch.heading) && !/GED/.test(garch.heading), `the heading names the density (${garch.heading})`);
    assert.deepEqual(garch.cells.map((c) => c[0]),
      ["LAST SESSION", "NEXT SESSION", "LONG-RUN", "TAIL SHAPE ν", "SKEW λ", "α + β", "α", "β", "ω"],
      "nine cells in a fixed order: the three levels lead, then the two shape parameters, then the recursion's own"); checks++;
    ok(garch.cells.every((c) => /\d/.test(c[1])), `every cell carries a figure (${garch.cells.map((c) => c[1]).join(" | ")})`);
    eq(garch.cells[3][1], g0.nu.toFixed(1), "the tail shape prints to one decimal");
    eq(garch.cells[4][1], (g0.lambda > 0 ? "+" : g0.lambda < 0 ? "−" : "") + Math.abs(g0.lambda).toFixed(2),
       "the skew prints to two decimals with a real minus sign, because a year of returns pins it to about one");
    ok(/Hansen/.test(garch.note) && /skewed t/.test(garch.note), "the note names whose density was fitted");
    ok(!/No forecast/.test(garch.note) && /next-session cell/.test(garch.note),
       "and explains the next-session cell as the recursion's own state rather than denying a forecast beside one");
    eq(garch.leftovers, 0, "no histogram, density or GED block survives");
    eq(garch.path, 1, "the conditional-volatility path is drawn once");
    ok(!/GED/.test(garch.note), "the note carries no trace of the GED");
    eq(garch.ewma, 1, "the EWMA reference path is drawn beside it");
    {
      const pmv = fitted.panels.pricedMove;
      const want = [];
      if (pmv && pmv.status === "ok" && typeof pmv.rv30 === "number") want.push("RV 30d " + (pmv.rv30 * 100).toFixed(1) + "%");
      if (pmv && pmv.status === "ok" && (typeof pmv.atmVol === "number" || typeof pmv.iv30 === "number")) {
        want.push("IV ATM " + ((typeof pmv.atmVol === "number" ? pmv.atmVol : pmv.iv30) * 100).toFixed(1) + "%");
      }
      assert.deepEqual(garch.levels, want,
        "the realised and implied levels are ruled across the path with their figures, exactly when the priced-move panel carries them"); checks++;
      ok(garch.legend[0].startsWith("GARCH") && garch.legend.includes("EWMA(0.94) reference") && garch.legend[garch.legend.length - 1] === "Daily return",
         `the legend names the model path first, the reference and the levels, and the returns last (${garch.legend.join(" | ")})`);
    }
    ok(/penalised maximum likelihood with variance targeting/.test(garch.note) && /winsorised at six robust standard deviations/.test(garch.note),
       "the note names the method and the winsorising");
    ok(/RiskMetrics EWMA at 0.94/.test(garch.note) && /long-run cell is a measurement/.test(garch.note),
       "and explains the reference path and why the long-run cell can now be trusted");
    eq(garch.qualifier, "nowrap", "the heading's qualifier is one unbreakable phrase, so it never wraps mid-sentence");
    {
      const broken = JSON.parse(JSON.stringify(fitted));
      broken.panels.context.breaks = [{ date: "2026-04-06", ratio: 0.0426, before: 117, volumeRatio: 20.5, shape: "split" }];
      await mount(page, broken, { ticker: broken.ticker, station: "all" });
      const notes = await page.evaluate(() => ({
        garch: document.getElementById("ftGarchS").textContent,
        price: document.getElementById("ftChartS").textContent,
      }));
      ok(/The vendor\u2019s history steps on 2026-04-06 \(close \u00d70\.0426, volume \u00d721 against the sessions before, the shape of an unadjusted split\), so the 117 sessions before it are cut/.test(notes.garch),
         `a history break is named on the volatility card with its date, the price and volume steps, what shape that is and the sessions cut (${notes.garch.slice(-300)})`);
      ok(/history steps on 2026-04-06/.test(notes.price), "and on the price chart, which reads the same sessions");
    }

    const older = JSON.parse(JSON.stringify(fitted));
    delete older.panels.context.garch.dist;
    delete older.panels.context.garch.lambda;
    delete older.panels.context.garch.nextVol;
    older.panels.context.garch.nu = 1.3;
    await mount(page, older, { ticker: older.ticker, station: "all" });
    const pre = await page.evaluate(() => ({
      heading: document.getElementById("ftGarchH").textContent,
      labels: [...document.querySelectorAll("#ftGarch .ft-garch-p dt")].map((d) => d.textContent),
      note: document.getElementById("ftGarchS").textContent,
    }));
    ok(!pre.labels.some((l) => /TAIL SHAPE|SKEW|NEXT SESSION/.test(l)),
       `a card fitted before the skewed t shows no shape, skew or next-session cell (${pre.labels.join(", ")})`);
    eq(pre.labels.length, 6, "so its strip is two full rows of three rather than a lone cell on a third");
    ok(/fitted before the skewed t/.test(pre.heading),
       `and the heading says so instead of naming a density that was not fitted (${pre.heading})`);
    ok(/predates the skewed-t/.test(pre.note) && !/Hansen/.test(pre.note),
       "and its note says the fit predates the density instead of reading a GED shape as a Student-t one");

    await mount(page, fitted, { ticker: fitted.ticker, station: "all" });
    const shell = await page.evaluate(() => ({
      cols: document.querySelectorAll(".ft-col, .ft-band4").length,
      change: !!document.querySelector("#ftRow1 > #ftChange"),
    }));
    eq(shell.cols, 0, "the second row has no column wrappers left to hold a void where a hidden card was");
    ok(shell.change, "and what changed sits in its own full-width row beneath the small cards");
    await page.waitForFunction(() => !document.getElementById("ftFlow").hidden, null, { timeout: 8000 });
    const band = await page.evaluate(() => {
      const kids = [...document.querySelector(".ft-band3").children].filter((n) => !n.hidden);
      const rows = new Map();
      for (const n of kids) {
        const key = n.offsetTop;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push({ id: n.id, w: n.offsetWidth, h: n.offsetHeight, wide: n.classList.contains("is-wide") });
      }
      return [...rows.values()];
    });
    ok(band.length > 0, "the second row draws at least one card on a full card");
    for (const row of band) {
      const hs = new Set(row.map((c) => c.h));
      eq(hs.size, 1, `cards sharing a row share a height (${row.map((c) => c.id + ":" + c.h).join(", ")})`);
      const ws = new Set(row.map((c) => c.w));
      eq(ws.size, 1, `and a width (${row.map((c) => c.id + ":" + c.w).join(", ")})`);
    }
    const bandW = await page.evaluate(() => document.querySelector(".ft-band3").offsetWidth);
    for (const row of band) {
      if (row.length === 1) {
        ok(Math.abs(row[0].w - bandW) <= 1,
           `a card alone on its row spans the whole row (${row[0].id}: ${row[0].w} of ${bandW})`);
      }
    }

    await page.evaluate(() => {
      const inner = window.fetch;
      window.fetch = (url) => {
        const u = String(url);
        if (!u.includes("/api/flows/summary")) return inner(url);
        const body = {
          status: "ok", scope: "X", llm: true, model: "m", generatedAt: "2026-09-22T09:41:00.000Z",
          summary: "A summary sentence without figures.",
          provenance: "Wording by m; figures measured by the pipeline.",
          ideas: [
            { title: "Put wall credit", structure: "put credit spread", direction: "bullish", thesis: "Thesis one.",
              invalidation: "a close below the put wall", horizon: "ten sessions", restsOn: ["gamma", "levels"],
              robustness: 3, robustnessWord: "robust", fromState: true },
            { title: "Front straddle", structure: "long straddle", direction: "neutral", thesis: "Thesis two.",
              invalidation: "the range holding", horizon: "the front expiry", restsOn: ["volContext", "calendar"],
              robustness: 2, robustnessWord: "fair" },
          ],
          context: { version: 2, sessionDate: "2026-09-21", expectedSession: "2026-09-21", stale: false,
            coverage: { features: 24, read: 20, quiet: 1, withheld: 3, robust: 8, fair: 10, weak: 3 },
            state: { version: 1, state: "amplifying", word: "Amplifying", direction: "bullish", flow: "bullish", confidence: 2,
              premium: "rich", chip: "Amplifying \u00b7 short gamma, flow bullish, to the flip 44.59",
              brief: "The greeks imply an amplifying state for X with flow bullish (confidence 2 of 3).",
              preferred: ["put credit spread", "call debit spread"], avoid: ["iron condor", "call credit spread"],
              invalidation: { kind: "max_pain", px: 42.5, label: "Max pain" }, target: null,
              bound: { kind: "gamma_flip", px: 44.59, label: "Gamma flip" },
              horizon: { kind: "priced_sessions", value: 10, low: 39.63, high: 46.83, days: null }, stale: false, notes: [], drivers: [] },
            features: [{ key: "gamma", title: "Gamma convexity" }, { key: "levels", title: "Key levels & distance to spot" },
              { key: "volContext", title: "Volatility context" }, { key: "calendar", title: "Gamma roll-off" }] },
        };
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => String(Date.now()) },
          json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
      };
    });
    await page.waitForFunction(() => {
      const l = document.getElementById("ftNeuronIdeas");
      return l && !l.hidden && l.children.length === 2;
    }, null, { timeout: 15000 });
    const folded = await page.evaluate(() => ({
      second: document.querySelectorAll("#ftNeuronIdeas > .ft-idea")[1].hidden,
      more: document.getElementById("ftNeuronMore").textContent,
      moreHidden: document.getElementById("ftNeuronMore").hidden,
      expanded: document.getElementById("ftNeuronMore").getAttribute("aria-expanded"),
    }));
    ok(folded.second && !folded.moreHidden && folded.more === "Show 1 more idea" && folded.expanded === "false",
       `only the first idea is open by default, the rest wait behind a disclosure that counts them (${folded.more})`);
    await page.click("#ftNeuronMore");
    const unfolded = await page.evaluate(() => ({
      second: document.querySelectorAll("#ftNeuronIdeas > .ft-idea")[1].hidden,
      more: document.getElementById("ftNeuronMore").textContent,
      expanded: document.getElementById("ftNeuronMore").getAttribute("aria-expanded"),
    }));
    ok(!unfolded.second && unfolded.more === "Show fewer ideas" && unfolded.expanded === "true",
       "and one click opens them all with the control saying how to fold them back");
    const neuron = await page.evaluate(() => {
      const ideas = [...document.querySelectorAll("#ftNeuronIdeas > .ft-idea")].map((li) => ({
        title: li.querySelector(".ft-idea-t").textContent,
        rank: li.querySelector(".ft-idea-rank").className,
        on: li.querySelectorAll(".ft-idea-rank i.is-on").length,
        dots: li.querySelectorAll(".ft-idea-rank i").length,
        lit: [...li.querySelectorAll(".ft-idea-rank i.is-on")].every((i) => {
          const bg = getComputedStyle(i).backgroundColor;
          return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
        }),
        chips: [...li.querySelectorAll(".ft-idea-chip")].map((c) => c.textContent),
        rests: [...li.querySelectorAll(".ft-idea-m dd")].map((d) => d.textContent),
      }));
      return { ideas, cov: document.getElementById("ftNeuronCov").textContent, covHidden: document.getElementById("ftNeuronCov").hidden };
    });
    eq(neuron.ideas.length, 2, "both vetted ideas are drawn");
    eq(neuron.ideas[0].title, "1. Put wall credit", "numbered in the order the server ranked them");
    ok(/\br3\b/.test(neuron.ideas[0].rank) && neuron.ideas[0].on === 3 && neuron.ideas[0].dots === 3,
       "a robust idea lights all three dots");
    ok(/\br2\b/.test(neuron.ideas[1].rank) && neuron.ideas[1].on === 2 && neuron.ideas[1].dots === 3,
       "a fair idea lights two of three");
    ok(neuron.ideas.every((i) => i.lit),
       "and every lit dot has a painted background, so the grade is visible and not a token that never resolved");
    assert.deepEqual(neuron.ideas[0].chips, ["put credit spread", "bullish", "robust", "implied state"],
      "the chips carry the structure, the direction, the grade word and, on the state's own idea, its origin"); checks++;
    const stateUi = await page.evaluate(() => {
      const host = document.getElementById("ftNeuronState");
      const hero = document.getElementById("ftHeroStateB");
      const meta = [...host.querySelectorAll("#ftStateMeta dt")].map((d, i) => [d.textContent, host.querySelectorAll("#ftStateMeta dd")[i].textContent]);
      return {
        hidden: host.hidden, cls: host.className,
        word: document.getElementById("ftStateWord").textContent,
        dots: host.querySelectorAll("#ftStateConf i.is-on").length,
        chip: document.getElementById("ftStateChip").textContent,
        meta,
        heroHidden: hero.hidden,
        heroWord: document.getElementById("ftHeroState").textContent,
        heroSide: document.getElementById("ftHeroStateSide").textContent,
        heroSideCls: document.getElementById("ftHeroStateSide").className,
        heroDots: hero.querySelectorAll("#ftHeroStateSeg i.is-on").length,
        heroInk: getComputedStyle(document.getElementById("ftHeroState")).color,
        stripInk: getComputedStyle(document.getElementById("ftStateWord")).color,
        heroTop: hero.offsetTop, heroLeft: hero.offsetLeft, heroRight: hero.offsetLeft + hero.offsetWidth,
        heroChip: document.getElementById("ftHeroStateChip").textContent,
        ivrBottom: document.getElementById("ftHeroIvrB").offsetTop + document.getElementById("ftHeroIvrB").offsetHeight,
        ivrRight: document.getElementById("ftHeroIvrB").offsetLeft + document.getElementById("ftHeroIvrB").offsetWidth,
        idLeft: document.querySelector(".ft-hero-id").offsetLeft,
      };
    });
    ok(!stateUi.hidden && /is-amplifying/.test(stateUi.cls) && /is-pos/.test(stateUi.cls) && stateUi.word === "Amplifying" && stateUi.dots === 2,
       `the implied state strip names the state, its side and its confidence (${stateUi.cls}, ${stateUi.dots} dots)`);
    ok(stateUi.chip === "Amplifying \u00b7 short gamma, flow bullish, to the flip 44.59", "and quotes the chip the server wrote");
    assert.deepEqual(stateUi.meta, [["Flow", "bullish"], ["Premium", "rich"], ["Prefer", "put credit spread \u00b7 call debit spread"],
      ["Avoid", "iron condor \u00b7 call credit spread"], ["Ends past", "max pain 42.50"], ["Horizon", "10 sessions"]],
      "with the flow, the premium, the structures it prefers and rules out, where it ends and how long it runs"); checks++;
    ok(!stateUi.heroHidden && stateUi.heroWord === "Amplifying" && stateUi.heroSide === "BULLISH" && /is-pos/.test(stateUi.heroSideCls) && stateUi.heroDots === 2,
       "the hero carries the same state as a sixth block with its side pill and confidence dots");
    ok(stateUi.heroInk !== "rgba(0, 0, 0, 0)" && stateUi.stripInk !== "rgba(0, 0, 0, 0)", "in inks that resolved");
    ok(stateUi.heroTop >= stateUi.ivrBottom && Math.abs(stateUi.heroLeft - stateUi.idLeft) <= 1 && stateUi.heroRight >= stateUi.ivrRight - 1,
       `as a band beneath the blocks from the name's left edge to the last block's right edge, never an orphan tile beside a void (layout geometry, since the hero's children scale in with a delay) ` +
       `(${stateUi.heroLeft}..${stateUi.heroRight} against ${stateUi.idLeft}..${stateUi.ivrRight}, top ${stateUi.heroTop} vs ${stateUi.ivrBottom})`);
    ok(stateUi.heroChip === "short gamma, flow bullish, to the flip 44.59 \u2014 prefer put credit spread or call debit spread",
       `the band carries the chip's reading and the first two preferred structures (${stateUi.heroChip})`);
    ok(neuron.ideas[0].rests.some((d) => d === "Gamma convexity · Key levels & distance to spot"),
       "the features an idea rests on are named by their titles, joined by a middle dot");
    ok(!neuron.covHidden && /Neuron read 20 of 24 features/.test(neuron.cov) && /nothing here is advice/.test(neuron.cov),
       `the coverage line states what was read and disclaims advice (${neuron.cov.slice(0, 80)})`);
    ok(/8 robust · 10 fair · 3 weak · 3 withheld/.test(neuron.cov), "and counts each grade");
    eq(errors.length, 0, `the volatility, second-row and Neuron paints throw nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const card = JSON.parse(JSON.stringify(withChain.find((c) => c.panels.variation &&
      c.panels.variation.status === "ok" && c.panels.variation.grid)));
    ok(card, "an emitted card carries a hedging panel with its scenario grid");
    const V = card.panels.variation;
    for (const width of [320, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker, station: "convexity" });
      const got = await page.evaluate(() => {
        const s = document.querySelector('.ft-panel[data-panel="variation"]');
        const host = s && s.querySelector(":scope > div");
        const table = host && host.querySelector("table.fv-grid");
        const right = s ? s.getBoundingClientRect().right : 0;
        let worst = 0;
        if (s) {
          const walk = (n) => {
            for (const c of n.children) {
              if (c.closest(".fc-tablewrap") && c !== c.closest(".fc-tablewrap")) continue;
              worst = Math.max(worst, c.getBoundingClientRect().right - right);
              walk(c);
            }
          };
          walk(s);
        }
        return {
          there: !!host,
          first: s ? s.parentElement.querySelector(".ft-panel[data-panel]") === s : false,
          tier: s ? s.dataset.tier : null,
          bars: host ? host.querySelectorAll("rect.fv-bar").length : 0,
          caption: table && table.caption ? table.caption.textContent : null,
          colHeads: table ? [...table.querySelectorAll("thead th[scope=col]")].length : 0,
          rowHeads: table ? [...table.querySelectorAll("tbody th[scope=row]")].length : 0,
          cells: table ? table.querySelectorAll("tbody td").length : 0,
          silentCells: table ? table.querySelectorAll("tbody td[data-empty]").length : 0,
          text: host ? host.textContent : "",
          how: host ? !!host.querySelector("details.ft-how") : false,
          spill: Math.round(worst),
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          height: s ? Math.round(s.getBoundingClientRect().height) : 0,
          one: s ? (s.querySelector(":scope > .ft-panel-one") || {}).textContent : null,
        };
      });
      ok(got.there, `${width}px: the hedging panel mounts`);
      ok(got.first && got.tier === "lead", `${width}px: it leads the Convexity station`);
      ok(got.bars >= 1 && got.bars <= 3, `${width}px: one bar per channel with a reading (${got.bars})`);
      ok(/hedge flow over the next session/.test(got.caption || ""),
         `${width}px: the scenario grid is a real table with a caption ("${got.caption}")`);
      eq(got.colHeads, 4, `${width}px: a corner header and three vol columns, each scope=col`);
      eq(got.rowHeads, 5, `${width}px: five price rows, each a scope=row header`);
      eq(got.cells, 15, `${width}px: fifteen cells`);
      eq(got.silentCells, V.grid.cells.flat().filter((c) => c === null).length,
         `${width}px: a silent cell is drawn as a silence, not as zero`);
      ok(got.how, `${width}px: the conventions sit behind one disclosure`);
      ok(/dealer-signed under the vendor's convention/.test(got.text),
         `${width}px: which states the dealer assumption every figure rests on`);
      eq(got.one, V.lead.say, `${width}px: the panel's one-line lead is the publisher's sentence verbatim`);
      ok(got.spill <= 1, `${width}px: nothing in the panel spills past its right edge (${got.spill}px)`);
      eq(got.sideways, 0, `${width}px: and the page does not scroll sideways`);
      if (width === 1280) {
        ok(Math.abs(got.height - 994) <= 150,
           `the measured height (${got.height}px) is within reach of the table's figure, so the height ` +
           "table stays a measurement rather than a guess");
      }
      eq(errors.length, 0, `${width}px: the hedging panel draws without throwing (${errors.join("; ")})`);
      await page.close();
    }

    const silent = JSON.parse(JSON.stringify(card));
    silent.panels.variation.silences = [
      { channel: "book", kind: "unavailable", code: "no-book", reason: "the open-interest book is not on this card" },
      { channel: "vannaSize", kind: "quiet", code: "few-iv-changes", reason: "3 daily implied-volatility changes on the card; a vol-of-vol needs 20" },
      { channel: "charm", kind: "pending", code: "kc-unmeasured", reason: "the charm scale is not yet published" },
      { channel: "vanna", kind: "unreadable", code: "vanna-absent", reason: "the vanna leg could not be read" },
    ];
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    await mount(page, silent, { ticker: silent.ticker, station: "convexity" });
    const words = await page.evaluate(() =>
      [...document.querySelectorAll('.ft-panel[data-panel="variation"] .fv-silences li')]
        .map((li) => ({ kind: li.getAttribute("data-empty"), text: li.textContent })));
    assert.deepEqual(words.map((w) => w.kind), ["unavailable", "quiet", "pending", "unreadable"],
      "each silence keeps its own kind — the product's four silences, never collapsed into one"); checks++;
    ok(/^Unavailable — /.test(words[0].text) && /^Quiet — /.test(words[1].text) &&
       /^Pending — /.test(words[2].text) && /^Unreadable — /.test(words[3].text),
       "and says which one it is in words");
    ok(/3 daily implied-volatility changes/.test(words[1].text), "with the publisher's reason verbatim");
    await page.close();

    const dead = JSON.parse(JSON.stringify(card));
    dead.panels.variation = { status: "unavailable", reason: "neither the open-interest gamma book nor the day's flow ladder is on this card" };
    const page2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    await mount(page2, dead, { ticker: dead.ticker, station: "convexity" });
    const deadText = await page2.evaluate(() =>
      document.querySelector('.ft-panel[data-panel="variation"] [data-empty]').textContent);
    ok(/^Unavailable — neither the open-interest gamma book/.test(deadText),
       `a silent model draws its reason and no number (${deadText.slice(0, 70)})`);
    await page2.close();
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
  `a strip that never bridges a gap, twenty-three panels served inside five station ` +
  `sections with one lead each, a tab row that counts them from the same export the ` +
  `stations are built from, and two sentinels that reach neither the payload-key list ` +
  `nor the shed ladder they would have fabricated an unavailability in, a page ` +
  `that opens on the overnight move with its gap and its dead-band crossing rather ` +
  `than on a snapshot — with a measured zero told from an unmeasured session in both ` +
  `directions — deep links that survive a hidden grid and a hostile hash, and a gated ` +
  `name that is finally told the gate removed it instead of being pointed at a watch ` +
  `list it cannot be on, and a market-wide standing whose rank never appears without the ` +
  `population it sits inside, whose absence is quiet and carries the cut it missed, and ` +
  `which says on the page that the cross-section it ranks in is a prior session's, and ` +
  `three panels that now lead on their FINDING in the largest type they own with the ` +
  `method folded under it — measured flat told from unmeasured in both directions, ` +
  `every qualifier still in the open with nothing to click, every folded sentence still ` +
  `in textContent for a find-in-page, and every explained element wearing a visible mark ` +
  `whose explanation a keyboard and a thumb can open without adding one tab stop, ` +
  `a question DRAWN rather than merely attributed so a drawer handed the card where it ` +
  `expected the question cannot head a panel with a stringified object, an enlarge ` +
  `checked on EVERY registry panel that draws a chart rather than on a hand-picked four ` +
  `— the list that could not see the two panels still capped at the retired modal's own ` +
  `width — the session ` +
  `path's contract count and dollar sum each carrying the unit the payload publishes ` +
  `for it, and an IV rank in the wrong unit withheld under its own mark rather than ` +
  `multiplied into a percentage no year can hold`);
