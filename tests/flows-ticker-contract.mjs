import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import * as NEURON from "../shared/flows-neuron.js";
import { briefAge } from "../shared/flows-ask.js";
import { TICKER_PANELS, TICKER_PANEL_KEYS, SENTINEL_KEYS } from "../shared/flows-panels.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const EMIT_DIR = path.join(ROOT, "tests", ".ticker-emit");
fs.rmSync(EMIT_DIR, { recursive: true, force: true });
fs.mkdirSync(EMIT_DIR, { recursive: true });
execFileSync(process.execPath, [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", EMIT_DIR + "/"], { stdio: "ignore" });
const emitted = (name) => { const f = path.join(EMIT_DIR, name); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; };
const cards = fs.readdirSync(EMIT_DIR).filter((f) => /^-card-[A-Z][A-Z0-9.\-]*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(EMIT_DIR, f), "utf8")));
ok(cards.length >= 5, `the emitter produced ${cards.length} cards to test against`);

const withChain = cards.filter((c) => c.depth !== "index" && TICKER_PANEL_KEYS.every((k) => c.panels && c.panels[k]) &&
  ["ivSurface", "skewTerm", "topContracts", "aggressor"].every((k) => c.panels[k].status === "ok"));
ok(withChain.length > 0, `at least one emitted card carries all four chain panels (${withChain.length} do)`);
const engineCards = cards.filter((c) => c.engine && Array.isArray(c.engine.structures) && c.engine.structures.length >= 2 && Array.isArray(c.engine.expiries) && c.engine.expiries.length);
ok(engineCards.length > 0, `at least one emitted card carries a priced engine block (${engineCards.length} do)`);
const full = engineCards.find((c) => withChain.includes(c)) || engineCards[0];
const cardXOf = (t) => emitted("-card-x-" + t + ".json");
const histOf = (t) => emitted("-hist-" + t + ".json");
ok(cardXOf(full.ticker), `the emitter wrote the card-x companion for ${full.ticker}`);
ok(histOf(full.ticker), `and the one-year history for ${full.ticker}`);

const TICKER_SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
const TICKER_CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-ticker.css"), "utf8");
const FLOWS_CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows.css"), "utf8");
const UI_SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ui.js"), "utf8");
const VERSION = fs.readFileSync(path.join(ROOT, "assets/version.txt"), "utf8").trim();

function neuronFor(card) {
  const age = briefAge({ sessionDate: card.sessionDate }, new Date(Date.parse(card.generatedAt || card.sessionDate + "T21:00:00Z") + 3600e3));
  const ctx = NEURON.buildContext(card, { expectedSession: age.expected });
  if (!ctx.coverage || !ctx.coverage.read) return { status: "quiet", scope: card.ticker, summary: null, ideas: [], context: NEURON.publicContext(ctx) };
  const st = NEURON.stateIdea(ctx);
  return { status: "ok", scope: card.ticker, summary: NEURON.deterministicSummary(ctx), ideas: NEURON.vetIdeas(st ? [st] : [], ctx).ideas,
    context: NEURON.publicContext(ctx), llm: false, model: null, guard: null, generatedAt: card.generatedAt || null, provenance: null };
}

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const PAGE_HTML = FLOWS_PAGES.tickerPage({ username: "test" });

async function mount(page, card, o = {}) {
  const ticker = o.ticker === undefined ? card && card.ticker : o.ticker;
  const api = {
    card: card === null ? { ticker, status: "pending" } : card,
    summary: o.neuron !== undefined ? o.neuron : card ? neuronFor(card) : { status: "pending" },
    "card-x": o.cardX !== undefined ? o.cardX : card ? cardXOf(card.ticker) || { status: "pending" } : { status: "pending" },
    hist: o.hist !== undefined ? o.hist : card ? histOf(card.ticker) || { status: "pending" } : { status: "pending" },
    tape: o.tape || { status: "pending" },
    meta: o.meta || { status: "pending" },
    events: o.events || { status: "pending", rows: [] },
    now: o.now || { serverNow: Date.parse("2026-08-24T22:00:00Z"), phase: { phase: "closed", session: card ? card.sessionDate : "2026-08-24", trading: false, endsAt: null }, keys: {} },
  };
  const requested = [];
  page._requested = requested;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      requested.push(key + u.search);
      let body = key === "board" ? (o.boards && o.boards[u.searchParams.get("side")]) || { status: "pending", rows: [] } : api[key];
      if (body === undefined) body = { status: "pending" };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: o.html || PAGE_HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  if (!page._clocked) {
    page._clocked = true;
    const at = card && card.generatedAt ? Date.parse(card.generatedAt) + 3600e3 : Date.parse("2026-08-24T22:00:00Z");
    await page.clock.setFixedTime(new Date(o.at || at));
  }
  const query = o.query !== undefined ? o.query : ticker ? "?t=" + encodeURIComponent(ticker) : "";
  await page.goto("https://example.test/flows/ticker/" + query + (o.hash ? "#" + o.hash : ""));
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name…"; }, null, { timeout: 15000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(o.settle || 250);
  await settleMotion(page);
}

async function settleMotion(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      if (t && Number.isFinite(t.endTime)) { try { a.finish(); } catch {} }
    }
  });
  await page.waitForTimeout(80);
}

async function infoText(page, sel) {
  return page.evaluate((sel) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : null;
    if (!el) return null;
    const b = el.matches("[data-info]") ? el : el.querySelector("[data-info]");
    if (!b) return null;
    window.FlowsUI.openInfo(b);
    const pop = document.getElementById("fxPop");
    const t = pop ? pop.innerText : "";
    window.FlowsUI.closeInfo();
    return t;
  }, sel);
}

async function modInfo(page, id) {
  return page.evaluate((id) => {
    const sec = document.getElementById(id);
    if (!sec) return null;
    const b = sec.querySelector(".ui-mod-h .ui-info");
    if (!b) return null;
    window.FlowsUI.openInfo(b);
    const t = document.getElementById("fxPop").innerText;
    window.FlowsUI.closeInfo();
    return t;
  }, id);
}

async function allInfo(page, scope = "body") {
  return page.evaluate((scope) => {
    const out = [];
    for (const b of document.querySelector(scope).querySelectorAll("[data-info]")) {
      window.FlowsUI.openInfo(b);
      const p = document.getElementById("fxPop");
      if (p) out.push(p.innerText);
    }
    window.FlowsUI.closeInfo();
    return out.join("\n");
  }, scope);
}

async function pickView(page, mod, label) {
  const i = await page.evaluate(({ mod, label }) => [...document.querySelectorAll("#" + mod + " .ui-seg-i")].findIndex((b) => b.textContent.trim() === label), { mod, label });
  if (i < 0) return false;
  const already = await page.evaluate(({ mod, i }) => {
    const b = document.querySelectorAll("#" + mod + " .ui-seg-i")[i];
    const box = document.querySelector("#" + mod + " .ft-cbox");
    if (box && box.firstElementChild) box.firstElementChild.dataset.stale = "1";
    return b.getAttribute("aria-selected") === "true";
  }, { mod, i });
  if (!already) {
    await page.locator("#" + mod + " .ui-seg-i").nth(i).click();
    await page.waitForFunction((mod) => { const box = document.querySelector("#" + mod + " .ft-cbox"); return !box || (box.firstElementChild && !box.firstElementChild.dataset.stale); }, mod, { timeout: 5000 });
  }
  await page.waitForTimeout(60);
  await settleMotion(page);
  return true;
}

const MODULES = ["m-worlds", "m-signal", "m-gamma", "m-hedge", "m-vol", "m-flow", "m-tape", "m-events", "m-pos", "m-context"];

{
  for (const k of SENTINEL_KEYS) ok(!TICKER_PANEL_KEYS.includes(k), `the sentinel "${k}" is not a card.panels key`);
  const block = TICKER_SRC.slice(TICKER_SRC.indexOf("const PANEL_MOD = {"));
  const body = block.slice(0, block.indexOf("};"));
  const map = new Map([...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*): "([a-zA-Z-]+)"/g)].map((m) => [m[1], m[2]]));
  const built = new Set([...TICKER_SRC.matchAll(/mod\(\{ id: "(m-[a-z]+)"/g)].map((m) => m[1]));
  eq([...built].sort().join(" "), [...MODULES].sort().join(" "), "the page builds exactly the ten modules this contract sweeps");
  for (const p of TICKER_PANELS) {
    ok(map.has(p.key), `registry panel "${p.key}" is placed in a module by the page's panel map — a panel no module reads is a vendor call nobody sees`);
    ok(built.has(map.get(p.key)) || map.get(p.key) === "ftHero", `and "${p.key}" is placed in ${map.get(p.key)}, a module the page actually builds`);
  }
  for (const card of withChain) {
    for (const key of Object.keys(card.panels)) {
      ok(TICKER_PANEL_KEYS.includes(key) || key === "scoreOverlay",
         `${card.ticker}: published panel "${key}" is mounted by the registry, or is the score overlay the hero strip and the Signal module read`);
    }
  }
  ok(/scoreOverlay/.test(TICKER_SRC.slice(TICKER_SRC.indexOf("function renderHeroChart"), TICKER_SRC.indexOf("function breaksOf"))),
     "the score overlay is drawn: the hero chart's score strip reads it, so the one panel the old grid published but never drew now has a place on the page");
  const ids = TICKER_PANELS.map((p) => p.id);
  eq(new Set(ids).size, ids.length, "every registry id is unique");
  for (const p of TICKER_PANELS) {
    ok(p.question && p.question.trim().length > 8, `panel "${p.key}" states a real question`);
    ok(p.title && p.title.trim().length > 2, `panel "${p.key}" has a title`);
  }
  const pipe = fs.readFileSync(path.join(ROOT, "scripts/flows-pipeline.mjs"), "utf8");
  const shedFrom = pipe.indexOf("const shed = [");
  ok(shedFrom > 0, "the pipeline still declares its shed ladder as `const shed = [`");
  const shedBlock = pipe.slice(shedFrom, pipe.indexOf("\n      ];", shedFrom));
  let shedNamed = 0;
  const regKeys = new Set(TICKER_PANELS.map((p) => p.key));
  for (const m of shedBlock.matchAll(/\[\s*"([A-Za-z_][A-Za-z0-9_]*)",\s*"dropped to fit/g)) {
    shedNamed++;
    ok(regKeys.has(m[1]), `the pipeline's shed ladder only names registry panels ("${m[1]}")`);
    ok(!SENTINEL_KEYS.has(m[1]), `and never a sentinel ("${m[1]}") — there is no card.panels entry to shed`);
  }
  ok(shedNamed >= 5, `the shed ladder was actually read (${shedNamed} entries)`);
}

{
  const served = PAGE_HTML;
  ok(/<div class="visually-hidden ft-status" id="ftStatus" role="status">Loading the name…<\/div>/.test(served),
     "the status line is served as a live region with its loading text, so a screen reader hears the page arrive");
  ok(/<section class="ft-hero is-loading" id="ftHero" data-fx-hero aria-labelledby="ftHeroT">/.test(served), "the hero is served as a labelled section the toolbar can mirror");
  ok(/<h1 class="ft-t" id="ftHeroT" data-fx-title><\/h1>/.test(served), "with an EMPTY h1 — a placeholder name is a name a reader would believe");
  for (const id of ["ftVerdict", "ftGrid", "ftPicker"]) {
    const at = served.indexOf(`id="${id}"`);
    ok(at > 0, `#${id} is served`);
    const tag = served.slice(served.lastIndexOf("<", at), served.indexOf(">", at) + 1);
    ok(/\bhidden\b/.test(tag), `and served hidden, so nothing reads as a finding before a card lands (${id})`);
    eq(served.slice(served.indexOf(">", at) + 1, served.indexOf(">", at) + 3), "</", `and served empty (${id})`);
  }
  const at = (s) => served.indexOf(s);
  ok(at(`/assets/css/flows-ticker.css?v=${VERSION}`) > at(`/assets/css/flows.css?v=${VERSION}`),
     "the route stylesheet is linked after the shared one, at the canonical asset version, through the per-route stylesheet hook");
  const ui = at(`/assets/js/flows-ui.js?v=${VERSION}`), fresh = at(`/assets/js/flows-fresh.js?v=${VERSION}`);
  const quant = at(`/assets/js/flows-quant.bundle.js?v=${VERSION}`), tick = at(`/assets/js/flows-ticker.js?v=${VERSION}`);
  ok(ui > 0 && ui < fresh && fresh < quant && quant < tick,
     "the scripts load in dependency order: the Depth primitives, the freshness layer, the pricing bundle, then the controller");
  for (const gone of ["flows-panels.js", "flows-drawers.js", "flows-cursor.js"]) ok(!served.includes(gone), `the page no longer links ${gone}`);
  ok(!/<style[\s>]/.test(served), "the page serves no inline stylesheet");
  ok(!/document\.createElement\("style"\)|adoptedStyleSheets|insertRule\(/.test(TICKER_SRC),
     "and the controller builds no stylesheet of its own through any of the three doors");
}

const browser = await chromium.launch();

function sweep() {
  const out = { mods: [], overflow: document.documentElement.scrollWidth - innerWidth, body: document.body.scrollWidth - innerWidth };
  for (const sec of document.querySelectorAll("#ftGrid > section")) {
    const svgs = [...sec.querySelectorAll("svg")].filter((s) => s.getAttribute("aria-hidden") !== "true" && !s.closest(".ui-mod-h") && !s.classList.contains("ui-g") && !s.closest("button") && s.getBoundingClientRect().width > 40);
    let minText = Infinity, clipped = [];
    for (const svg of svgs) {
      const box = svg.getBoundingClientRect();
      for (const t of svg.querySelectorAll("text")) {
        const r = t.getBoundingClientRect();
        if (!r.width) continue;
        minText = Math.min(minText, parseFloat(getComputedStyle(t).fontSize));
        if (r.left < box.left - 2 || r.right > box.right + 2) clipped.push(t.textContent);
      }
    }
    const secBox = sec.getBoundingClientRect();
    const spill = [...sec.querySelectorAll("*")].filter((n) => !n.closest(".visually-hidden") && !n.closest(".ui-readout") && n.getBoundingClientRect().width > 0)
      .map((n) => n.getBoundingClientRect().right - secBox.right).reduce((a, b) => Math.max(a, b), -Infinity);
    out.mods.push({
      id: sec.id, empty: !sec.querySelector(".ui-mod-h ~ *, .ui-mod-h + *") || sec.textContent.trim().length < 3,
      silent: sec.querySelectorAll(".ui-silent[data-state]").length, drawn: svgs.length + sec.querySelectorAll(".ui-row, .ft-crow, .ft-fam, .ft-range-t").length,
      scales: svgs.map((s) => [Number((s.getAttribute("viewBox") || "").split(/\s+/)[2]), s.getBoundingClientRect().width, s.getAttribute("preserveAspectRatio") || ""]),
      labelled: svgs.every((s) => s.getAttribute("role") === "img" && (s.getAttribute("aria-label") || "").length > 8),
      minText: minText === Infinity ? null : minText, clipped, spill: Math.round(spill), heading: (sec.querySelector("h2") || {}).textContent || "",
    });
  }
  return out;
}

try {
  for (const width of [320, 390, 768, 1280, 1440, 1840]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 800, isMobile: width < 800 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, full);
    eq(errors.length, 0, `${width}px: the ticker page paints a real engine card without throwing (${errors.join("; ")})`);
    const got = await page.evaluate(sweep);
    eq(got.mods.map((m) => m.id).join(" "), MODULES.join(" "), `${width}px: every module is mounted, in reading order`);
    for (const m of got.mods) {
      ok(!m.empty, `${width}px ${m.id}: renders content or an explicit designed silence`);
      ok(m.heading.length > 1 && m.heading.split(/\s+/).length <= 3, `${width}px ${m.id}: its title is one to three words ("${m.heading}")`);
      ok(m.drawn > 0 || m.silent > 0, `${width}px ${m.id}: draws a chart, rows, or a silence glyph — never a blank module`);
      ok(m.labelled, `${width}px ${m.id}: every chart carries role=img and a label naming what it draws`);
      for (const [vb, css, par] of m.scales) {
        ok(Math.abs(vb - css) <= 1, `${width}px ${m.id}: one viewBox unit is one CSS pixel (viewBox ${vb} drawn at ${css.toFixed(1)}px)`);
        ok(par !== "none", `${width}px ${m.id}: no chart stretches with preserveAspectRatio="none"`);
      }
      ok(m.minText === null || m.minText >= 10, `${width}px ${m.id}: chart type renders at ten CSS pixels or more (${m.minText}px)`);
      eq(m.clipped.length, 0, `${width}px ${m.id}: draws no text outside its own canvas (${m.clipped.slice(0, 3).join(" | ")})`);
      ok(m.spill <= 1, `${width}px ${m.id}: nothing reaches past the module's own right edge (${m.spill}px)`);
    }
    ok(got.overflow <= 0 && got.body <= 0, `${width}px: the page never scrolls sideways (${got.overflow}px, body ${got.body}px)`);
    const heads = await page.evaluate(() => [...document.querySelectorAll("h1, h2, h3")].filter((n) => !n.closest("#fxPop, .fx-side, .fx-bar, .fx-dock, [hidden]")).map((n) => n.tagName));
    eq(heads[0], "H1", `${width}px: the page opens on one h1, the name`);
    eq(heads.filter((t) => t === "H1").length, 1, `${width}px: and carries exactly one`);
    ok(heads.slice(1).every((t) => t === "H2" || t === "H3"), `${width}px: every heading below it is an h2 or h3, no level skipped (${heads.join(",")})`);
    await page.close();
  }

  {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 800, isMobile: width < 800 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, full);
      const tabs = await page.evaluate(() => [...document.querySelectorAll("#ftGrid .ui-seg")].map((s) => [s.closest("section").id, [...s.querySelectorAll(".ui-seg-i")].map((b) => b.textContent.trim())]));
      let views = 0;
      for (const [mod, labels] of tabs) {
        for (const label of labels) {
          await pickView(page, mod, label);
          views++;
          const got = await page.evaluate((mod) => {
            const sec = document.getElementById(mod);
            const box = sec.querySelector(".ft-cbox");
            const svgs = [...(box || sec).querySelectorAll("svg")].filter((s) => s.getBoundingClientRect().width > 40 && !s.classList.contains("ui-g"));
            return { kids: box ? box.childElementCount : -1, silent: !!(box && box.querySelector(".ui-silent[data-state]")),
              scales: svgs.map((s) => [Number((s.getAttribute("viewBox") || "").split(/\s+/)[2]), s.getBoundingClientRect().width]),
              overflow: document.documentElement.scrollWidth - innerWidth };
          }, mod);
          ok(got.kids > 0, `${width}px ${mod}/${label}: the view draws something or a designed silence`);
          for (const [vb, css] of got.scales) ok(Math.abs(vb - css) <= 1, `${width}px ${mod}/${label}: one viewBox unit is one CSS pixel (${vb} in ${css.toFixed(1)}px)`);
          ok(got.overflow <= 0, `${width}px ${mod}/${label}: switching views never widens the page (${got.overflow}px)`);
        }
      }
      ok(views >= 25, `${width}px: the view walk visited every view of every module (${views})`);
      eq(errors.length, 0, `${width}px: no view throws when chosen (${errors.join("; ")})`);
      await page.close();
    }
  }

  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await mount(page, full);
    const fold = await page.evaluate(() => {
      const r = (sel) => { const n = document.querySelector(sel); return n ? n.getBoundingClientRect() : null; };
      const ideas = [...document.querySelectorAll("#ftVerdict .ft-idea")].map((n) => n.getBoundingClientRect());
      return { px: r("#ftPxV"), chart: r("#ftHc svg[role=img]"), chips: r("#ftChips .ui-chips"), verdict: r("#ftVerdictT"), ideas: ideas.map((b) => [b.top, b.bottom]) };
    });
    for (const k of ["px", "chart", "chips", "verdict"]) ok(fold[k] && fold[k].bottom <= 900, `1440x900: the ${k} sits above the fold (${fold[k] && Math.round(fold[k].bottom)}px)`);
    eq(fold.ideas.length, 3, "1440x900: the engine's three ranked ideas are drawn");
    ok(fold.ideas.every(([, b]) => b <= 900), `1440x900: and all three sit above the fold (${fold.ideas.map(([, b]) => Math.round(b)).join(", ")})`);
    const words = await page.evaluate(() => document.body.innerText.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length);
    ok(words < 600, `the whole page carries ${words} words of surface text — the method lives behind the disclosures, an order of magnitude under the 5,006 the station grid printed`);
    await page.close();
  }

  {
    const base = clone(withChain[0]);
    base.atr = 2.5;
    base.strikeSumCrossing = 101.25;
    base.zeroGamma = 99.5;
    base.panels.levels = { status: "ok", spot: 100, atr: 2.5, levels: [
      { kind: "max_pain", label: "Max pain", px: 105, distPct: 0.05, distAtr: 2 },
      { kind: "put_wall", label: "Put wall", px: 90, distPct: -0.1, distAtr: -4 },
      { kind: "call_wall", label: "Call wall", px: 120, distPct: 0.2, distAtr: 8 },
    ] };
    base.panels.pricedMove = { status: "ok", movePerc: 0.0731 };
    base.panels.volContext = { ...base.panels.volContext, status: "ok", ivRank: { status: "ok", rankUnit: "percent 0-100, as published", rows: [
      { date: "2026-05-01", rank1y: 11.1 }, { date: "2026-08-28", rank1y: 73.4 }, { date: "2026-07-15", rank1y: 44.4 }] } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const read = async (card) => {
      await mount(page, card);
      const t = await infoText(page, "#ftHeroFlags .ui-info");
      const rows = {};
      const lines = String(t || "").split("\n");
      for (let i = 0; i < lines.length - 1; i++) rows[lines[i].trim()] = lines[i + 1].trim();
      return { text: t || "", rows };
    };
    const r = await read(base);
    ok(Object.keys(r.rows).length >= 8, `the name's disclosure carries the key statistics rather than a pending note (${JSON.stringify(r.text.slice(0, 300))})`);
    eq(r.rows.Spot, "$100.00", `spot is this card's spot (${r.rows.Spot})`);
    eq(r.rows.ATR, "$2.50", `the ATR is this card's (${r.rows.ATR})`);
    eq(r.rows["Max pain"], "$105.00 · +2.00 ATR", `a level carries its price AND its distance in ATR, the unit that compares across names (${r.rows["Max pain"]})`);
    eq(r.rows["Put wall"], "$90.00 · −4.00 ATR", `and a level below spot is signed with U+2212 (${r.rows["Put wall"]})`);
    eq(r.rows["Strike-sum crossing"], "$101.25", "the strike-sum crossing under its own name");
    eq(r.rows["Zero-gamma level"], "$99.50", "and the zero-gamma level beside it, never merged with it");
    ok(!("Gamma flip" in r.rows), "no row is labelled with the ambiguous 'Gamma flip'");
    eq(r.rows["Priced move"], "±7.3%", "the priced move");
    eq(r.rows["IV rank"], "73.4% · 2026-08-28", "THE RANK IS PICKED BY DATE, NOT BY INDEX — 73.4 on 2026-08-28 is the newest of three shuffled rows");

    const edged = clone(base);
    edged.panels.levels.levels[2] = { ...edged.panels.levels.levels[2], label: "Call wall (window edge)", edge: "window", note: "this wall is the last strike of the ladder the run read, so the strike window ends here" };
    const ew = await read(edged);
    ok(ew.rows["Call wall (window edge)"] && /^\$120\.00 · \+8\.00 ATR/.test(ew.rows["Call wall (window edge)"]) && /last strike of the ladder/.test(ew.rows["Call wall (window edge)"]) && !("Call wall" in ew.rows),
       "a wall on the last strike the run read is marked as the window's edge, with the reason beside it, not printed as where the book peaks");

    const noFlip = clone(base);
    noFlip.strikeSumCrossing = null;
    noFlip.zeroGamma = null;
    const q = await read(noFlip);
    ok(/^— quiet/.test(q.rows["Strike-sum crossing"]) && /does not change sign/.test(q.rows["Strike-sum crossing"]),
       `a card with no published crossing says so under the quiet mark, with the gamma panel's own reason (${q.rows["Strike-sum crossing"]})`);
    ok(/^— unavailable/.test(q.rows["Zero-gamma level"]), "a card with no chain profile marks the zero-gamma level unavailable");
    const dead = clone(base);
    dead.panels.volContext = { status: "unavailable", reason: "The vendor returned no volatility history." };
    const d = await read(dead);
    ok(/^— unavailable/.test(d.rows["IV rank"]) && /no volatility history/.test(d.rows["IV rank"]), `an unreadable source makes its row unavailable, never quiet, with the source's reason (${d.rows["IV rank"]})`);
    eq(d.rows.Spot, "$100.00", "and it does not silence the rows that came from panels that DID publish");
    eq(errors.length, 0, `the key statistics throw nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const base = clone(withChain[0]);
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const readFlip = async (card) => {
      await mount(page, card);
      return page.evaluate(() => {
        const m = document.querySelector('[data-metric="ftFlip"]');
        if (!m) return null;
        const st = m.querySelector(".ui-state");
        return { text: m.innerText, tone: (m.querySelector(".ui-metric-s") || {}).dataset ? m.querySelector(".ui-metric-s") && m.querySelector(".ui-metric-s").getAttribute("data-tone") : null,
          state: st ? st.dataset.state : null, why: st ? (window.FlowsUI.openInfo(st), document.getElementById("fxPop").innerText) : "" };
      });
    };
    const flipCard = clone(base);
    flipCard.panels.levels = { status: "ok", spot: 100, atr: 2, levels: [{ kind: "zero_gamma", label: "Zero-gamma level", px: 104, distPct: 0.04, distAtr: 2 }] };
    const fg = await readFlip(flipCard);
    ok(fg, "the gamma module carries the flip distance");
    ok(fg && /104\.00/.test(fg.text), `with the level itself, so the distance has a price behind it (${fg && fg.text})`);
    ok(fg && /\+4\.0%/.test(fg.text), "drawn from the panel's own measurement, signed and in percent");
    ok(fg && /\+2\.00 ATR/.test(fg.text), "and in this name's own ATR, the figure that compares across names");
    ok(fg && !fg.tone, "a flip above spot carries no directional tone: above or below is geometry, not a bullish or bearish claim");
    const onFlip = clone(flipCard);
    onFlip.panels.levels.levels[0] = { kind: "zero_gamma", label: "Zero-gamma level", px: 100, distPct: 0, distAtr: 0 };
    const og = await readFlip(onFlip);
    ok(og && /at spot/.test(og.text), `a distance of exactly zero says the name is sitting ON its flip (${og && og.text})`);
    const ladderRead = clone(base);
    ladderRead.panels.levels = { status: "ok", spot: 100, atr: 2, levels: [{ kind: "max_pain", label: "Max pain", px: 98, distPct: -0.02, distAtr: -1 }] };
    ladderRead.gammaFlip = null; ladderRead.zeroGamma = null;
    const lr = await readFlip(ladderRead);
    ok(lr && lr.state, "the flip is still drawn when the ladder resolved none — a slot that silently vanishes teaches the eye it means nothing");
    ok(lr && !/%/.test(lr.text), `and prints no percentage at all, least of all 0% (${lr && lr.text})`);
    ok(lr && /not a distance of zero/i.test(lr.why), "and its reason refuses the inference: a book with no sign change has no flip to be near");
    const noPanel = clone(base);
    noPanel.panels.levels = { status: "unavailable", note: "no spot price" };
    noPanel.gammaFlip = null; noPanel.zeroGamma = null;
    const np = await readFlip(noPanel);
    eq(np && np.state, "unavailable", "a levels panel that never answered is tagged unavailable");
    ok(np && /not measured/i.test(np.why) && !/resolved no/i.test(np.why), "and says nothing was measured rather than that the ladder resolved nothing");
    await page.close();
  }

  {
    const lastTwoScored = (rows) => rows.length >= 2 && typeof rows[rows.length - 1].score === "number" && typeof rows[rows.length - 2].score === "number";
    const base = withChain.find((c) => c.panels.scoreOverlay && c.panels.scoreOverlay.status === "ok" && c.panels.scoreOverlay.rows.length >= 6 &&
      typeof c.panels.scoreOverlay.deadBand === "number" && lastTwoScored(c.panels.scoreOverlay.rows));
    ok(base, "an emitted card carries a joined overlay with a published dead band and two scored sessions at its end");
    const BAND = base.panels.scoreOverlay.deadBand;
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const staged = (fn) => { const c = clone(base); fn(c.panels.scoreOverlay, c.panels.scoreOverlay.rows); return c; };
    const read = async (card) => {
      await mount(page, card);
      const text = (await modInfo(page, "m-signal")) || "";
      return page.evaluate((text) => {
        const d1 = document.querySelector('[data-metric="ftD1"]');
        const cr = document.getElementById("ftCross");
        const st = d1 ? d1.querySelector(".ui-state") : null;
        return { text, d1: d1 ? d1.innerText : null, d1State: st ? st.dataset.state : null, cross: cr ? cr.dataset.cross : null, crossText: cr ? cr.innerText : "",
          crossState: cr && cr.querySelector(".ui-state") ? cr.querySelector(".ui-state").dataset.state : null };
      }, text);
    };
    const rows = base.panels.scoreOverlay.rows;
    const prev = rows[rows.length - 2];
    const got = await read(base);
    ok(got.text.includes(prev.d), `the Signal disclosure names the previous scored session (${prev.d})`);
    ok(/1 session earlier/.test(got.text), "and how many sessions the move spans");
    ok(/score points?\b/.test(got.text), "the move carries its unit: score points, not percent");
    ok(got.d1 && /session/.test(got.d1), `the change metric carries the move and its gap (${got.d1})`);
    const flat = await read(staged((o, r) => { r[r.length - 1].score = r[r.length - 2].score; }));
    ok(/unchanged/i.test(flat.text), "an identical score reads as unchanged");
    ok(flat.d1 && /^Change\s*\n?\s*0/.test(flat.d1.trim().replace(/−|\+/g, "")), `and the metric shows the measured zero (${flat.d1})`);
    ok(!flat.d1State, "and is NOT reported as an absence — a measured zero and an unmeasured session are different facts");
    const cleared = await read(staged((o, r) => { r[r.length - 2].score = 0; r[r.length - 1].score = BAND + 40; }));
    eq(cleared.cross, "cleared", "a name leaving the band is tagged as the entry event");
    ok(/cleared the dead band/i.test(cleared.text) && /actionable/i.test(cleared.text), "and the disclosure says so in the payload layer's words");
    const faded = await read(staged((o, r) => { r[r.length - 2].score = BAND + 40; r[r.length - 1].score = 0; }));
    eq(faded.cross, "faded", "a name entering the band is the exit signal");
    ok(/faded into the dead band/i.test(faded.text), "named as such");
    const flipped = await read(staged((o, r) => { r[r.length - 2].score = BAND + 40; r[r.length - 1].score = -(BAND + 30); }));
    eq(flipped.cross, "flipped", "a sign change outside the band on both ends is a flip");
    const held = await read(staged((o, r) => { r[r.length - 2].score = BAND + 40; r[r.length - 1].score = BAND + 45; }));
    eq(held.cross, "none", "a name that did not cross says so rather than leaving a blank");
    ok(/no crossing/i.test(held.crossText), "and the tag reads as the MEASURED silence");
    const noBand = await read(staged((o) => { o.deadBand = null; }));
    eq(noBand.cross, "unknown", "an unpublished dead band makes the crossing unknowable");
    eq(noBand.crossState, "unavailable", "tagged as a publisher-side absence, not a measured one");
    ok(!/no crossing/i.test(noBand.crossText), "it never reports 'no crossing' from a band nobody published");
    ok(/cannot be stated/i.test(noBand.text), "and says the crossing cannot be stated");
    const gapped = await read(staged((o, r) => { r[r.length - 2].score = null; r[r.length - 1].score = BAND + 40; }));
    ok(/2 sessions earlier/.test(gapped.text), "the gap is counted and printed");
    ok(/one night or two is not known/i.test(gapped.text), "and the sentence refuses the overnight reading a bare delta would invite");
    const stale = await read(staged((o, r) => { r[r.length - 1].score = null; }));
    ok(/1 session old/.test(stale.text), "a newest session with no score for this name is announced as stale");
    ok(stale.text.indexOf("session old") < stale.text.indexOf("earlier"), "and the staleness line comes BEFORE the move");
    const broken = await read(staged((o, r) => { for (let i = 0; i < r.length; i++) r[i].score = BAND + 10; r[r.length - 4].score = null; }));
    ok(/consecutive scored sessions on the bullish side/i.test(broken.text), "the run states its side and its length");
    ok(/not\s+stepped over that gap/i.test(broken.text), "and says it stopped at an unscored session rather than counting through it");
    const atZero = await read(staged((o, r) => { r[r.length - 1].score = 0; }));
    ok(/exactly zero/i.test(atZero.text), "a newest score of zero is named as the centre of the dead band");
    const lone = await read(staged((o, r) => { for (let i = 0; i < r.length - 1; i++) r[i].score = null; r[r.length - 1].score = BAND + 5; }));
    ok(/no move to state/i.test(lone.text) && /not a move of zero/i.test(lone.text), "a single scored session refuses to derive a move, in the words that rule out the substitution");
    eq(lone.d1State, "quiet", "and the change metric wears the quiet glyph rather than a zero");
    const unavailable = await read(staged((o) => { o.status = "unavailable"; o.reason = "the score track was not assembled this run"; delete o.rows; }));
    ok(unavailable.text.includes("the score track was not assembled this run"), "an unavailable track prints the publisher's own reason verbatim");
    eq(unavailable.d1State, "unavailable", "and is tagged as a publisher fault");
    const quiet = await read(staged((o) => { o.status = "quiet"; o.reason = "the price window and the score window do not share a single session"; delete o.rows; }));
    eq(quiet.d1State, "quiet", "two windows read in full and found disjoint is the MEASURED silence, never the unavailable tag");
    const legacy = clone(base);
    delete legacy.panels.scoreOverlay;
    const predates = await read(legacy);
    ok(/built before/i.test(predates.text), "a card from before the overlay dates its own absence");
    eq(predates.d1State, "unavailable", "and tags it as an absence, not a silence");
    const inside = clone(base);
    inside.score = BAND;
    delete inside.engine;
    await mount(page, inside, { neuron: { status: "pending" } });
    const side = await page.evaluate(() => (document.querySelector("#ftVerdict .ui-capsule") || {}).textContent || "");
    ok(!/bullish|bearish/i.test(side), `a score inside the dead band is given no side (${side})`);
    const noSpot = clone(base);
    for (const k of ["levels", "pricedMove", "gamma", "context"]) noSpot.panels[k] = { status: "unavailable", reason: "no spot price" };
    delete noSpot.spot; delete noSpot.engine; delete noSpot.readPx;
    await mount(page, noSpot);
    const px = await page.evaluate(() => (document.getElementById("ftPx") || {}).innerText || "");
    ok(!/\$?0\.00/.test(px), `a card with no spot never prints $0.00 for it (${px.trim()})`);
    eq(errors.length, 0, `no change state throws (${errors.join("; ")})`);
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await mount(page, withChain[0]);
    const src = TICKER_SRC.slice(TICKER_SRC.indexOf("  function changeFrom(join) {"));
    let depth = 0, end = 0;
    for (let i = src.indexOf("{"); i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (!depth) { end = i + 1; break; } } }
    const got = await page.evaluate((code) => {
      const f = new Function("num", code + "\nreturn changeFrom;")(window.FlowsUI.num);
      const mk = (scores, deadBand) => ({ status: "ok", deadBand, rows: scores.map((s, i) => ({ d: "2026-08-" + String(10 + i).padStart(2, "0"), close: 100 + i, score: s })) });
      return { plain: f(mk([5, 6, 7, 8, 9, 12], 1)), gapped: f(mk([5, 6, 7, null, null, 12], 1)), stale: f(mk([5, 6, 40, null, null, null], 1)),
        cleared: f(mk([0, 0, 0, 0, 0, 40], 1)), faded: f(mk([40, 40, 40, 40, 40, 0], 1)), flipped: f(mk([40, 40, 40, 40, 40, -40], 1)),
        broken: f(mk([9, 9, null, 9, 9, 9], 1)), zero: f(mk([9, 9, 9, 9, 9, 0], 1)), bandless: f(mk([0, 0, 0, 0, 0, 40], null)), empty: f(mk([null, null, null], 1)),
        absent: f(undefined), dead: f({ status: "unavailable", reason: "the track was not assembled" }), disjoint: f({ status: "quiet", reason: "no shared session" }) };
    }, src.slice(0, end));
    eq(got.plain.d1.v, 3, "the move is the difference between the two newest scored sessions");
    eq(got.plain.d1.gap, 1, "and an overnight move spans one session");
    eq(got.plain.stale, 0, "a newest session that is scored is not stale");
    eq(got.plain.run, 6, "the run counts every consecutive session on the current sign");
    ok(got.plain.runCapped, "and says so when it reached the start of the window");
    eq(got.plain.ext.hi, 12, "the window high is the largest score in it");
    eq(got.plain.ext.lo, 5, "and the low the smallest");
    eq(got.plain.ext.hiAt, "2026-08-15", "each extreme carries the date it was set on");
    eq(got.gapped.d1.gap, 3, "a move over an absence spans every session between the two readings — 3, not 1");
    eq(got.gapped.d1.v, 5, "and is still the difference between the two scored ends");
    eq(got.gapped.run, 1, "the run stops at the unscored session rather than counting through it");
    ok(got.gapped.runBroken && !got.gapped.runCapped, "and says which of the two reasons it stopped for");
    eq(got.stale.stale, 3, "three unscored sessions after the newest score make the reading three sessions old");
    eq(got.stale.at.d, "2026-08-12", "and the reading itself is dated by ITS session");
    eq(got.cleared.cross, "cleared", "inside the band then outside it is a clearing");
    eq(got.faded.cross, "faded", "outside then inside is a fade");
    eq(got.flipped.cross, "flipped", "outside at both ends on opposite signs is a flip");
    eq(got.plain.cross, null, "and a name that stayed put crossed nothing");
    ok(got.plain.crossKnown, "which is KNOWN, because a band was published and both ends were scored");
    eq(got.broken.run, 3, "a run counts back to the gap and stops");
    ok(got.broken.runBroken, "and reports the gap as the reason");
    eq(got.zero.run, 0, "a newest score of exactly zero is a run of 0, the centre of the dead band");
    eq(got.zero.d1.v, -9, "while the move to it is still a measured move");
    eq(got.bandless.band, null, "an unpublished dead band is null, never zero");
    eq(got.bandless.cross, null, "so no crossing is claimed");
    eq(got.bandless.crossKnown, false, "and the renderer is told the difference");
    eq(got.bandless.inside, null, "and whether the name sits inside the band is UNKNOWN rather than false");
    eq(got.empty.status, "quiet", "a window with no scored session at all is a measured emptiness");
    eq(got.absent.status, "unavailable", "a card with no overlay key predates the panel");
    ok(/built before/.test(got.absent.reason), "and says so");
    eq(got.dead.status, "unavailable", "an unavailable track is a publisher-side absence");
    ok(got.dead.reason.includes("the track was not assembled"), "carrying the publisher's own reason");
    eq(got.disjoint.status, "quiet", "and disjoint windows are the measured silence");
    await page.close();
  }

  {
    const base = withChain.find((c) => c.conv && c.conv.weights && isFinite(c.conviction) && c.conv.persistence !== null);
    ok(base, "an emitted card carries the full conviction decomposition");
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const readMath = async (card) => { await mount(page, card); return { sig: (await modInfo(page, "m-signal")) || "", chip: (await infoText(page, "#ftChips .ui-gchip:nth-child(2)")) || "" }; };
    const good = await readMath(base);
    for (const said of [good.sig, good.chip]) {
      ok(said.includes("Conviction " + base.conviction), "the arithmetic names the published composite");
      for (const [k, w] of Object.entries(base.conv.weights)) ok(said.includes(Math.round(w * 100) + "%"), `the ${k} weight is the payload's own (${Math.round(w * 100)}%)`);
      ok(/persistence/i.test(said), "and persistence, the third term, is in the stat list");
      ok(/COUNT/.test(said) && /steps/.test(said), "the note says agreement is a count that steps");
    }
    const mutate = (fn) => { const c = clone(base); fn(c); return c; };
    const hasMath = (s) => /Conviction \d+ =/.test(s);
    ok(hasMath(good.sig), "the reconstructed composite is written as arithmetic");
    ok(!hasMath((await readMath(mutate((c) => { c.conviction = c.conviction + 7; }))).sig), "a composite the terms do not reconstruct draws no arithmetic at all");
    ok(!hasMath((await readMath(mutate((c) => { c.conv.persistence = null; }))).sig), "nor does a card missing the third term");
    const noWeights = await readMath(mutate((c) => { delete c.conv.weights; }));
    ok(!hasMath(noWeights.sig), "nor a card published before the weights shipped");
    ok(await page.evaluate(() => /\d/.test(document.querySelector("#ftChips .ui-gchip:nth-child(2) .ui-chip-v").textContent)), "though the composite itself still prints");
    eq(errors.length, 0, `none of the conviction states throws (${errors.join("; ")})`);
    await page.close();
  }

  {
    const base = clone(withChain[0]);
    const session = base.sessionDate;
    const staleOf = async (generatedAt, meta) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, { ...base, generatedAt }, { meta });
      await page.waitForFunction(() => performance.getEntriesByType("resource").some((e) => /\/api\/flows\/meta/.test(e.name)), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      const text = await page.evaluate(() => {
        const out = [];
        for (const b of document.querySelectorAll('#ftHeroFlags .ui-state[data-state="stale"]')) { window.FlowsUI.openInfo(b); out.push(document.getElementById("fxPop").innerText); }
        window.FlowsUI.closeInfo();
        return out.join("\n");
      });
      await page.close();
      return { text, errors };
    };
    const earlier = await staleOf(`${session}T14:02:18.489Z`, { sessionDate: session, generatedAt: `${session}T17:18:54.000Z` });
    ok(/built by an earlier run of the \d{4}-\d{2}-\d{2} session/.test(earlier.text), "UW-6: a card left by an earlier run of the board's own session is flagged, with the run times");
    eq(earlier.errors.length, 0, "and the flag costs no exception");
    ok(!/earlier run/.test((await staleOf(`${session}T21:40:00.000Z`, { sessionDate: session, generatedAt: `${session}T21:40:00.000Z` })).text), "a card from the run that built the board carries no flag");
    ok(!/earlier run/.test((await staleOf(`${session}T21:40:00.000Z`, { sessionDate: session, generatedAt: `${session}T21:30:00.000Z` })).text), "nor one written after the meta it is compared with");
    ok(!/earlier run/.test((await staleOf(`${session}T14:02:18.489Z`, { sessionDate: session })).text), "and a meta with no build time proves nothing, so it flags nothing");
  }

  {
    const card = withChain[0];
    const boards = { long: { deep: 2, rows: [{ t: "AAA", r: 1, s: 40, dp: 1 }, { t: "BBB", r: 2, s: 30, dp: 1 }] } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { boards });
    await page.waitForTimeout(400);
    eq(page._requested.filter((u) => u.startsWith("board")).length, 0, "loading a named ticker page fetches NO board — the name switcher's cost is paid only by the readers who use it");
    ok(await page.evaluate(() => !!document.getElementById("fxSearch")), "but the switcher is there, in the toolbar, on every width");
    await page.click("#fxSearch");
    await page.waitForFunction(() => /AAA/.test((document.querySelector(".ui-pal") || {}).textContent || ""), null, { timeout: 5000 });
    ok(page._requested.some((u) => u.startsWith("board")), "opening it fetches the boards, then");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.querySelectorAll("#ftGrid > section").length === 10 && !document.getElementById("ftGrid").hidden), "and closing it leaves the dossier exactly where it was");
    eq(errors.length, 0, `the switcher throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, withChain[0], { ticker: null, query: "", boards: { long: { deep: 1, rows: [{ t: "AAA", r: 1, s: 42, dp: 1 }, { t: "BBB", r: 2, s: 30 }] } } });
    await page.waitForSelector("#ftPicker:not([hidden])");
    const state = await page.evaluate(() => ({
      status: document.getElementById("ftStatus").textContent, gridShown: !document.getElementById("ftGrid").hidden,
      names: [...document.querySelectorAll("#ftPicker a.ui-row")].map((a) => a.querySelector(".ui-row-m b").textContent), note: document.getElementById("ftPickerNote").textContent,
      h1: (document.querySelector("#ftPicker h1") || {}).textContent }));
    ok(!state.gridShown, "with no ?t= the page shows the picker and hides the modules");
    eq(state.h1, "Choose a name", "and calls it a choice, not an error");
    eq(page._requested.filter((u) => u.startsWith("card")).length, 0, "and spends no card read at all");
    eq(state.names.join(","), "AAA", "only the names the board stamped with a card are listed");
    ok(/ranks 2 names/.test(state.note) && /card for 1 of them/.test(state.note), `the note counts the list against the board it came from (${state.note})`);
    ok(/not listed/.test(state.note), "and says what happened to the row it dropped");
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, withChain[0], { ticker: null, query: "", boards: { long: { rows: [{ t: "AAA", r: 1, s: 42 }, { t: "BBB", r: 2, s: 30 }] } } });
    await page.waitForSelector("#ftPicker:not([hidden])");
    const state = await page.evaluate(() => ({ rows: document.querySelectorAll("#ftPicker a.ui-row").length, note: document.getElementById("ftPickerNote").textContent }));
    eq(state.rows, 2, "a board that publishes no `deep` count lists every row rather than none");
    ok(/does not publish/.test(state.note) && /may still open a page with no card/.test(state.note), "and the note names the risk it cannot rule out");
    await page.close();
  }
  {
    const pendingCases = [
      [{ long: { deep: 1, rows: [{ t: "ZZZ", r: 1, s: 5, dp: 1 }] } }, "has not landed", "a card that really is lagging its row"],
      [{ long: { deep: 1, rows: [{ t: "QQQ", r: 1, s: 5, dp: 1 }] } }, "not on today", "a name the board does not carry at all"],
      [{ long: { deep: 1, rows: [{ t: "AAA", r: 1, s: 9, dp: 1 }, { t: "ZZZ", r: 2, s: 5 }] } }, "built no card for it", "a name the board RANKS and this run built no card for"],
    ];
    for (const [boards, want, what] of pendingCases) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(page, null, { ticker: "ZZZ", boards });
      await page.waitForFunction(() => document.getElementById("ftStatus").textContent.length > 20, null, { timeout: 5000 });
      const got = await page.evaluate(() => ({ status: document.getElementById("ftStatus").textContent, silent: !!document.querySelector("#ftPx .ui-silent[data-state]"), picker: document.querySelectorAll("#ftPicker a.ui-row").length }));
      ok(got.status.includes(want), `${what} says so specifically ("${want}")`);
      ok(got.silent, `and the hero draws the designed silence in place of a price (${what})`);
      if (want === "built no card for it") {
        ok(/2 of 2 on the bullish side/.test(got.status), "the rank is stated against the whole side, not against the carded half");
        ok(!/has not landed|briefly lag/.test(got.status), "and never as a lag, because reloading cannot produce a card the run did not budget for");
        eq(got.picker, 1, "while the list beside it holds only the name that does have a card");
      }
      await page.close();
    }
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const card = withChain[0];
    await mount(page, card, { query: "?t=" + String(card.ticker).toLowerCase() });
    ok(page._requested.some((u) => u.includes("t=" + card.ticker)), "a lowercase ?t= is uppercased and fetched, not sent to the picker");
    await page.close();
    for (const bad of ["../etc", "!!!", "A".repeat(12)]) {
      const p2 = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(p2, withChain[0], { query: "?t=" + encodeURIComponent(bad), boards: { long: { rows: [] } } });
      eq(p2._requested.filter((u) => u.startsWith("card")).length, 0, `?t=${JSON.stringify(bad)} is rejected before any fetch`);
      await p2.close();
    }
  }
  {
    const legacy = clone(withChain[0]);
    delete legacy.panels.ivSurface;
    legacy.panels.aggressor = { status: "unavailable", reason: "the vendor reported no aggressor split." };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, legacy, { cardX: { status: "pending" } });
    await pickView(page, "m-vol", "Surface");
    const ivs = await infoText(page, "#m-vol .ft-cbox .ui-silent");
    ok(/before the option chain leg/.test(ivs || ""), `an absent panel key says the card predates the panel (${(ivs || "").slice(0, 90)})`);
    ok(/no aggressor split/.test(await modInfo(page, "m-flow")), "an unavailable panel prints the builder's own reason verbatim");
    eq(errors.length, 0, "neither absence throws");
    await page.close();
  }

  {
    const base = withChain.find((c) => c.panels.darkpool.status === "ok" && c.panels.oiDeltas.status === "ok" && c.panels.volContext.status === "ok");
    ok(base, "an emitted card carries the darkpool, open-interest and volatility-context panels with data");
    const card = clone(base);
    card.panels.darkpool.rows[0].canceled = true;
    card.panels.oiDeltas.rows[0].oiUpDays = null;
    card.panels.oiDeltas.rows[1].diff = null;
    const dp = card.panels.darkpool, oi = card.panels.oiDeltas;
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card);
    const rowsOf = async (view) => {
      await pickView(page, "m-tape", view);
      await page.evaluate(() => { for (const b of document.querySelectorAll("#m-tape .ui-list button")) if (/^All\b/.test(b.textContent.trim())) b.click(); });
      await page.waitForTimeout(100);
      return page.evaluate(() => [...document.querySelectorAll("#m-tape .ft-cbox .ui-row")].map((r) => ({ text: r.innerText.replace(/\s+/g, " "), title: r.title || "",
        time: r.dataset.time || null, quote: r.dataset.quote || null, canceled: r.dataset.canceled === "true", tags: [...r.querySelectorAll(".ui-tag")].map((t) => t.textContent),
        signed: (r.querySelector(".ui-row-s, [data-signed]") || r.lastElementChild || {}).textContent || "",
        dashes: [...r.querySelectorAll(".ui-row-v")].filter((v) => v.textContent.trim().startsWith("\u2014")).map((v) => (v.querySelector(".ui-state") || {}).dataset ? v.querySelector(".ui-state") && v.querySelector(".ui-state").dataset.state : null) })));
    };
    const prints = await rowsOf("Prints");
    eq(prints.length, dp.rows.filter((r) => typeof r.prem === "number").length, "the tape draws one row per published priced print");
    ok(prints.every((r) => /^\d{1,2}:\d{2} [AP]M$/.test(r.time) || r.time === "—"), `every print carries its time off the tape's own timestamp (${prints[0] && prints[0].time})`);
    eq(prints.filter((r) => r.tags.includes("cancelled")).length, dp.rows.filter((r) => r.canceled === true && typeof r.prem === "number").length, "exactly the cancelled prints carry the tag, and the tag says what the flag says");
    const iBoth = dp.rows.findIndex((r) => typeof r.bid === "number" && typeof r.ask === "number");
    if (iBoth >= 0) ok(/^\d+\.\d{2} \/ \d+\.\d{2}$/.test(prints[iBoth].quote), `a quoted print carries bid and ask side by side (${prints[iBoth].quote})`);
    const iNone = dp.rows.findIndex((r) => r.bid === null || r.ask === null);
    if (iNone >= 0) eq(prints[iNone].quote, "—", "a print missing either side of the quote carries the dash, never half a spread");
    const tapeInfo = await modInfo(page, "m-tape");
    if (dp.shed > 0) ok(tapeInfo.includes(dp.rows.length + " kept of " + dp.seen), `the disclosure states ${dp.rows.length} kept of ${dp.seen}`);
    if (dp.unpriced > 0) ok(tapeInfo.includes("+" + dp.unpriced + " unpriced print"), "and counts the unpriced prints out rather than seating them");
    ok(tapeInfo.includes(dp.note.slice(0, 60)), "the payload's own darkpool note is rendered, not paraphrased");
    const ois = await rowsOf("OI");
    eq(ois.length, oi.rows.length, "the tape draws one row per published open-interest change — a change with no difference is still a row");
    ok(/^[CP]/.test(ois[0].text), `the contract is built from cp, strike and expiry (${ois[0].text.slice(0, 40)})`);
    const iNeg = oi.rows.findIndex((r) => typeof r.diff === "number" && r.diff < 0);
    const iPos = oi.rows.findIndex((r) => typeof r.diff === "number" && r.diff > 0);
    ok(iNeg !== -1 || iPos !== -1, "the emitted corpus carries at least one signed open-interest difference");
    if (iNeg !== -1) ok(/−[\d.]+K?/.test(ois[iNeg].text) && !/-\d/.test(ois[iNeg].text), `a negative difference leads with U+2212 (${ois[iNeg].text})`);
    if (iPos !== -1) ok(/\+[\d.]+/.test(ois[iPos].text), `a positive difference leads with its sign (${ois[iPos].text})`);
    ok(/—$/.test(ois[1].text.trim()) || ois[1].text.includes("—"), "a row with no difference shows the dash, never a zero");
    ok(ois.every((r) => r.dashes.every((st) => st && st !== "ok")), `and every dash in the list carries the state that explains it — a bare dash is a silence with no reason (${ois.map((r) => r.dashes.join("/")).filter(Boolean).join(", ")})`);
    ok(!/\b0d ↑OI\b/.test(ois[0].text) && /\d+d V>OI/.test(ois[0].text), `a null counter is left out rather than printed as zero, while its sibling still renders (${ois[0].text})`);
    ok(ois.every((r) => /growth [+−]\d+%|^Open interest/.test(r.title)), "every row's detail carries its growth with its unit or says nothing");
    if (oi.shed > 0) ok(tapeInfo.includes(oi.rows.length + " kept of " + oi.seen), "the disclosure states the capped list");
    ok(tapeInfo.includes("selection rule") && tapeInfo.includes(oi.note.slice(0, 60)), "the vendor-selection caveat reaches the reader verbatim from the payload's note");
    const oiText = tapeInfo.slice(tapeInfo.indexOf("Open interest"), tapeInfo.indexOf("Alerts", tapeInfo.indexOf("Open interest")));
    ok(!/\bprint|bought|sold|buyer|seller|whale|institutional|smart money/i.test(oiText + ois.map((r) => r.text).join(" ")), "the open-interest reading never borrows the tape's vocabulary or attributes a side");
    ok(!/stuck overnight/i.test(tapeInfo) && /spacing of the two counts is unstated/.test(tapeInfo), "ΔOI is never said to be what stuck overnight: the spacing of the two counts is stated as unstated");
    eq(errors.length, 0, `the tape renders without throwing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const base = withChain.find((c) => c.panels.topContracts.oiBasis) || withChain[0];
    const staged = (verdict, seen, exceeded) => { const c = clone(base); c.panels.topContracts.oiBasis = { seen, exceeded, exceedShare: seen ? exceeded / seen : null, verdict, minVolume: 250 }; return c; };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const read = async (c) => { await mount(page, c); const t = await modInfo(page, "m-tape"); return t.slice(t.indexOf("Contracts"), t.indexOf("Open interest")); };
    const fals = await read(staged("falsified", 105, 4));
    ok(/\b4\b/.test(fals) && /\b105\b/.test(fals) && /250/.test(fals) && /NOT/.test(fals) && !/inconclusive/i.test(fals), "a falsified basis check carries both counts, the volume floor, and says plainly the counts are NOT the same span");
    const inc = await read(staged("inconclusive", 105, 0));
    ok(/INCONCLUSIVE/.test(inc) && /not evidence/i.test(inc) && !/aligned\.|confirm|verified/i.test(inc), "a zero count is INCONCLUSIVE and refuses the reassuring reading");
    const nd = await read(staged("no-data", 0, 0));
    ok(/^Quiet — /m.test(nd) && /could not be checked/i.test(nd), "a check that could not run is the measured silence and says which");
    const nc = await read(staged("falsified", 105, null));
    ok(/Unavailable — /.test(nc) && !/none of/i.test(nc), "a verdict with no count is a publisher fault, never a claim that none exceeded");
    const cx = await read(staged("falsified", 105, 0));
    ok(/Unavailable — /.test(cx) && !/none of/i.test(cx), "and so is a falsified verdict carrying zero exceeding rows");
    await page.close();
  }

  {
    const legacy = clone(withChain[0]);
    delete legacy.panels.darkpool;
    legacy.panels.oiDeltas = { status: "unavailable", reason: "the feed could not be read this run", note: legacy.panels.oiDeltas.note };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, legacy);
    const t = await modInfo(page, "m-tape");
    ok(/before the per-name deep feeds/.test(t), "an absent stock key dates the card by ITS wave, not the chain leg's");
    ok(/the feed could not be read this run/i.test(t), "an unavailable stock panel prints the builder's reason verbatim");
    await pickView(page, "m-tape", "Prints");
    eq(await page.evaluate(() => (document.querySelector("#m-tape .ft-cbox .ui-silent") || {}).dataset && document.querySelector("#m-tape .ft-cbox .ui-silent").dataset.state), "unavailable", "and the view draws the designed silence, tagged as an absence");
    eq(errors.length, 0, "none of the silences throws");
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain.find((c) => c.panels.ivSurface && c.panels.ivSurface.status === "ok");
    await mount(page, card);
    const iv = await modInfo(page, "m-vol");
    const lead = (iv.match(/The steepest quote on this surface is [^\n]+/) || [""])[0];
    ok(/volatility points (above|below)/.test(lead) && /[−+]\d+\.\d volatility points/.test(lead), `the surface reads its steepest cell with its direction in words and its sign as a glyph (${lead.slice(0, 90)})`);
    const pts = /([−+]\d+\.\d) volatility points/.exec(lead);
    ok(pts && iv.includes(pts[1] + " pts"), "and the reading and the Steepest cell statistic are the same number, measured once");
    const flat = clone(card);
    let zeroed = 0;
    flat.panels.ivSurface.skew = flat.panels.ivSurface.skew.map((row) => row.map((v) => (typeof v === "number" ? (zeroed++, 0) : v)));
    ok(zeroed > 0, `the flat fixture really carries ${zeroed} measured zeros`);
    await mount(page, flat);
    const a = await modInfo(page, "m-vol");
    ok(/measured flat smile/.test(a) && !/steepest quote/.test(a) && !/No cell on this surface/.test(a), "a surface measured flat says so, claims no direction, and is never told as an absence");
    const gone = clone(card);
    gone.panels.ivSurface.skew = gone.panels.ivSurface.skew.map((row) => row.map(() => null));
    await mount(page, gone);
    const b = await modInfo(page, "m-vol");
    ok(/No cell on this surface carries a measured distance/.test(b) && !/flat smile/.test(b) && !/Steepest cell/.test(b), "an unmeasured surface reads the absence, never the flat word, and publishes no steepest cell");
    const trunc = cards.find((c) => c.panels && c.panels.ivSurface && c.panels.ivSurface.coverage && c.panels.ivSurface.coverage.truncated === true);
    const tc = clone(trunc || card);
    if (!trunc) tc.panels.ivSurface.coverage = { truncated: true, rowsReturned: 500, filter: "contracts with no open interest are excluded upstream by the vendor" };
    await mount(page, tc);
    ok(/arbitrary subset of the book/.test(await modInfo(page, "m-vol")), "a truncated surface still says the picture may be an arbitrary slice of the book");
    const sk = clone(card);
    sk.panels.skewTerm.skew = null; sk.panels.skewTerm.skewBasis = null; sk.panels.skewTerm.skewReason = "no listed strike sat within 0.04 of either wing on an expiry past the day floor";
    await mount(page, sk);
    const s1 = await modInfo(page, "m-vol");
    const withheld = (s1.match(/The wing-to-wing skew is not published for this name[^\n]*/) || [""])[0];
    ok(withheld && !/\d/.test(withheld), "a withheld skew leads with its absence and carries no digit");
    ok(s1.includes("The wing-to-wing skew is not published: no listed strike sat within 0.04"), "and the reason it was withheld is stated verbatim beside it");
    ok(/\nSkew\n+The wing-to-wing skew is not published for this name/.test(s1), "an absence is a finding and is placed first in its section, like one");
    const atm = clone(card);
    atm.panels.skewTerm.atmIv = null; atm.panels.skewTerm.atmReason = "no expiry past the floor carried an at-the-money contract that traded today"; delete atm.panels.skewTerm.atmBand;
    await mount(page, atm);
    const s2 = await modInfo(page, "m-vol");
    ok(/At-the-money level\n— quiet: no expiry past the floor carried an at-the-money contract that traded today/.test(s2), "a chain that levelled nothing withholds the level as quiet, with the chain's own reason verbatim");
    ok(/Moneyness band\n— unavailable: /.test(s2), "and a card that never published the band says so as unavailable, a different fact");
    const odd = clone(card);
    odd.panels.skewTerm.atmIv = "n/a"; odd.panels.skewTerm.atmReason = null;
    await mount(page, odd);
    ok(/At-the-money level\n— withheld: /.test(await modInfo(page, "m-vol")), "a level that is not a number is withheld rather than printed, under its own mark");
    const ivr = (v) => { const c = clone(card); c.panels.pricedMove.ivRank = v; return c; };
    await mount(page, ivr(0.52));
    ok(/IV rank\n52\b/.test(await page.evaluate(() => document.querySelector("#m-vol .ui-metrics").innerText)), "a 0–1 rank reads as 52 of 100");
    ok(/percentile of its own year/.test(await modInfo(page, "m-vol")), "and says whose year it is a percentile of");
    await mount(page, ivr(52.15));
    const w1 = await page.evaluate(() => { const m = [...document.querySelectorAll("#m-vol .ui-metric")].find((n) => /IV rank/.test(n.innerText)); const b = m && m.querySelector(".ui-state"); return b ? [b.dataset.state, (window.FlowsUI.openInfo(b), document.getElementById("fxPop").innerText)] : null; });
    ok(w1 && w1[0] === "withheld" && /52\.15/.test(w1[1]) && /fraction of one/.test(w1[1]), "a rank in the wrong unit is withheld under its own mark, never multiplied into a percentage");
    await mount(page, ivr(null));
    const w2 = await page.evaluate(() => { const m = [...document.querySelectorAll("#m-vol .ui-metric")].find((n) => /IV rank/.test(n.innerText)); const b = m && m.querySelector(".ui-state"); return b ? b.dataset.state : null; });
    eq(w2, "unavailable", "and an absent rank is unavailable, not the bottom of the year");
    const band = async (over) => { const c = clone(card); for (const k of ["vrpTrailing", "vrpTrailingVar", "rvForward", "rvForwardGrade", "vrpForward", "vrpForwardVar", "vrpForwardRel", "richnessFrom", "richnessRel"]) delete c.panels.pricedMove[k]; Object.assign(c.panels.pricedMove, over); await mount(page, c); const t = await infoText(page, "#ftHc .ui-info"); return (t.match(/\nBand\n([^\n]+)/) || [])[1]; };
    eq(await band({ richness: "rich", vrp: 0.03087, rv30: 0.49813 }), "fair", "A CARD BUILT BEFORE THE THREE-WAY BAND still stores 'rich' for +6% of realised; the page derives the band at the shared line");
    eq(await band({ richness: "cheap", vrp: 0.1, rv30: 0.5 }), "rich", "the derivation wins in either direction");
    eq(await band({ richness: "fair", vrp: -0.05, rv30: 0.5 }), "cheap", "and exactly at the line the band is cheap, as the card builder rules it");
    eq(await band({ richness: "rich", vrp: null, rv30: 0.5 }), "rich", "with no premium to divide, the stored band is shown, not a guess");
    eq(await band({ richness: "rich", richnessFrom: "forward", iv30: 0.419, rv30: 0.356, rvForward: 0.46, vrpTrailing: 0.063, vrpForward: -0.041 }), "fair", "a schema-3 card derives the band from the forward premium against the GARCH forecast");
    eq(await band({ richness: "event-pinned", vrp: 0.1, rv30: 0.5 }), "event-pinned", "a withheld verdict the builder published is never overwritten by the arithmetic it withheld");
    eq(await band({ richness: null, vrp: null, rv30: null }), "—", "and no band at all is an em dash");
    eq(errors.length, 0, `the volatility readings throw nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const base = withChain.find((c) => c.panels.marketRank && c.panels.marketRank.status === "ok" && c.panels.marketRank.feeds.oiChange.status === "ok" && c.panels.marketRank.feeds.darkpool.status === "ok")
      || withChain.find((c) => c.panels.marketRank && c.panels.marketRank.status === "ok");
    ok(base, "an emitted card carries the market-wide join");
    const page = await browser.newPage({ viewport: { width: 320, height: 1000 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, base);
    const t = await modInfo(page, "m-context");
    for (const f of Object.values(base.panels.marketRank.feeds)) {
      const head = f.label.replace(/^the /, "");
      ok(t.toLowerCase().includes(head.toLowerCase()), `each market-wide feed gets its own heading (${head})`);
      if (f.status === "ok") {
        ok(t.includes("Ranks " + f.rank + " of " + f.population), "the rank is printed with the population it sits inside");
        ok(f.sameSession ? /Dated the same session this card describes/.test(t) : t.includes("Dated " + f.asOf + " — NOT the session this card describes"), "and says outright which session the ranking is from");
      }
    }
    ok(!/\b(whale|institution|smart money|insider|buyer|seller)\b/i.test(t.slice(t.indexOf("Market lists"))), "the market-wide lists never attribute a side, an identity or an intent");
    const quiet = withChain.map((c) => c.panels.marketRank && c.panels.marketRank.feeds.oiChange).find((f) => f && f.status === "quiet");
    ok(quiet, "the emitted corpus contains a name that is in no market-wide list");
    const q = clone(base);
    q.panels.marketRank.feeds.oiChange = clone(quiet);
    q.panels.marketRank.feeds.darkpool = { status: "unavailable", present: null, feed: "darkpool", label: "the market-wide off-exchange print feed", reason: "the market-wide off-exchange print feed did not come back this run (timeout)" };
    await mount(page, q);
    const qt = await modInfo(page, "m-context");
    ok(/Not in this list — /.test(qt) && /is not in the market-wide open-interest change feed/.test(qt) && /rows covering/.test(qt), "a name the feed was READ without finding leads on the reading itself, with the publisher's sentence and the population");
    ok(/last place in the list held|fewer rows than/.test(qt), "and the cut it did not clear");
    ok(/Unavailable — the market-wide off-exchange print feed did not come back this run \(timeout\)/i.test(qt), "a feed that did not come back is unavailable with the reason verbatim");
    const m = await page.evaluate(() => { const r = [...document.querySelectorAll("#m-context .ft-crow")].find((n) => /Market lists/.test(n.innerText)); const b = r && r.querySelector(".ui-state"); return b ? b.dataset.state : null; });
    eq(m, "quiet", "the row itself wears the quiet glyph, never the unavailable one, when the name was simply not listed");
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(sideways <= 0, `at 320px the page does not scroll sideways with the lists mounted (${sideways}px)`);
    const legacy = clone(base);
    delete legacy.panels.marketRank;
    await mount(page, legacy);
    ok(/before the market-wide join shipped/.test(await modInfo(page, "m-context")), "a card built before the join is dated by ITS OWN wave");
    eq(errors.length, 0, `the market-wide lists throw nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const base = withChain.find((c) => ["vanna", "charm", "deltaExposure"].every((k) => c.panels[k] && c.panels[k].status === "ok" && c.panels[k].rows.length >= 2));
    ok(base, "an emitted card carries all three second-order Greek ladders with data");
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, base);
    await pickView(page, "m-hedge", "Greeks");
    const got = await page.evaluate(() => [...document.querySelectorAll("#m-hedge .ft-greek")].map((row) => {
      const bars = [...row.querySelectorAll("rect.ft-gl")];
      const z = row.querySelector(".ft-glz");
      const zy = z ? Number(z.getAttribute("y1")) : null;
      return { name: row.querySelector(".ft-greek-l").textContent, bars: bars.length, calls: bars.filter((b) => b.classList.contains("is-call")).length, puts: bars.filter((b) => b.classList.contains("is-put")).length,
        negBelow: bars.filter((b) => b.classList.contains("is-neg")).every((b) => Number(b.getAttribute("y")) >= zy - 0.5), posAbove: bars.filter((b) => b.classList.contains("is-pos")).every((b) => Number(b.getAttribute("y")) + Number(b.getAttribute("height")) <= zy + 0.5),
        flats: bars.filter((b) => b.classList.contains("is-flat")).map((b) => Number(b.getAttribute("height"))) };
    }));
    const info = await modInfo(page, "m-hedge");
    for (const [key, name] of [["vanna", "Vanna"], ["charm", "Charm"], ["deltaExposure", "Delta"]]) {
      const p = base.panels[key];
      const g = got.find((x) => x.name === name);
      let legs = 0;
      for (const r of p.rows) { if (typeof r.call === "number") legs++; if (typeof r.put === "number") legs++; }
      eq(g && g.bars, legs, `${key}: one bar per PRESENT leg (${legs}), never one per expiry — each leg drawn as the vendor signed it`);
      ok(g && g.calls > 0 && g.puts > 0, `${key}: both legs are drawn and told apart by class`);
      ok(g && g.negBelow && g.posAbove, `${key}: every negative leg is drawn BELOW the zero line — sign lives in position, so it survives greyscale`);
      ok(info.includes(p.unit), `${key}: the panel's own published unit is in the disclosure verbatim`);
      ok(info.includes(p.signConvention), `${key}: and its sign convention`);
    }
    ok(/Gross size/.test(info), "the gross total is labelled a SIZE, never a direction");
    ok(/Dealer net, drawn \(call (−|\+) put\)/.test(info), "and the dealer net across the drawn expiries is printed with the rule that made it");
    const zeroed = clone(base);
    zeroed.panels.charm.rows[0].call = 0;
    zeroed.panels.charm.rows[0].put = null;
    await mount(page, zeroed);
    await pickView(page, "m-hedge", "Greeks");
    const flats = await page.evaluate(() => { const row = [...document.querySelectorAll("#m-hedge .ft-greek")].find((r) => /Charm/.test(r.textContent)); return [...row.querySelectorAll("rect.ft-gl.is-flat")].map((b) => Number(b.getAttribute("height"))); });
    eq(flats.length, 1, "a leg measured at exactly zero is still drawn");
    ok(flats.every((h) => h >= 1), "as a visible hairline, because a zero-height bar is indistinguishable from the leg the vendor never sent");
    eq(errors.length, 0, `the Greek ladders render without throwing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const card = withChain.find((c) => c.panels.variation && c.panels.variation.status === "ok" && c.panels.variation.grid);
    ok(card, "an emitted card carries a hedging panel with its scenario grid");
    const V = card.panels.variation;
    for (const width of [320, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 1200 }, hasTouch: width < 800, isMobile: width < 800 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card);
      await pickView(page, "m-hedge", "Grid");
      const got = await page.evaluate(() => {
        const s = document.getElementById("m-hedge");
        const table = s.querySelector("table");
        return { caption: table && table.caption ? table.caption.textContent : null, colHeads: table ? table.querySelectorAll("thead th[scope=col]").length : 0,
          rowHeads: table ? table.querySelectorAll("tbody th[scope=row]").length : 0, cells: table ? table.querySelectorAll("tbody td").length : 0,
          silentCells: table ? table.querySelectorAll("tbody td[data-empty]").length : 0, split: s.querySelectorAll(".ft-shares .ui-split, .ft-shares [role=img]").length,
          sideways: document.documentElement.scrollWidth - innerWidth };
      });
      const info = await modInfo(page, "m-hedge");
      ok(/hedge flow over the next session/.test(got.caption || ""), `${width}px: the scenario grid is a real table with a caption`);
      eq(got.colHeads, 4, `${width}px: a corner header and three vol columns, each scope=col`);
      eq(got.rowHeads, 5, `${width}px: five price rows, each a scope=row header`);
      eq(got.cells, 15, `${width}px: fifteen cells`);
      eq(got.silentCells, V.grid.cells.flat().filter((c) => c === null).length, `${width}px: a silent cell is drawn as a silence, not as zero`);
      ok(/dealer-signed under the vendor's convention/.test(info), `${width}px: the disclosure states the dealer assumption every figure rests on`);
      ok(info.includes(V.lead.say), `${width}px: the hedging lead is the publisher's sentence verbatim`);
      const negative = V.variance && Object.values(V.variance.shares).some((x) => x !== null && x < 0);
      ok(negative ? /channels offset/.test(info) : got.split >= 1, `${width}px: a part-of-whole bar is drawn only when every share is a part of the whole, and the offset is said otherwise`);
      ok(got.sideways <= 0, `${width}px: the page does not scroll sideways`);
      eq(errors.length, 0, `${width}px: the hedging module draws without throwing (${errors.join("; ")})`);
      await page.close();
    }
    const silent = clone(card);
    silent.panels.variation.silences = [
      { channel: "book", kind: "unavailable", code: "no-book", reason: "the open-interest book is not on this card" },
      { channel: "vannaSize", kind: "quiet", code: "few-iv-changes", reason: "3 daily implied-volatility changes on the card; a vol-of-vol needs 20" },
      { channel: "charm", kind: "pending", code: "kc-unmeasured", reason: "the charm scale is not yet published" },
      { channel: "vanna", kind: "unreadable", code: "vanna-absent", reason: "the vanna leg could not be read" },
    ];
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, silent);
    const t = await modInfo(page, "m-hedge");
    ok(/Unavailable — the open-interest book/.test(t) && /Quiet — 3 daily implied-volatility changes/.test(t) && /Pending — the charm scale/.test(t) && /Unreadable — the vanna leg/.test(t), "each silence keeps its own kind and says which one it is in words, with the publisher's reason verbatim");
    const dead = clone(card);
    dead.panels.variation = { status: "unavailable", reason: "neither the open-interest gamma book nor the day's flow ladder is on this card" };
    await mount(page, dead);
    ok(/neither the open-interest gamma book/i.test(await modInfo(page, "m-hedge")), "a silent model draws its reason and no number");
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const long = clone(withChain[0]);
    const members = Array.from({ length: 40 }, (_, i) => `Representative Number ${i + 1}`);
    long.panels.congress = { status: "ok", asOf: "2026-08-24", total: 40, buys: 20, sells: 20, medianLagDays: 31,
      trades: members.map((member, i) => ({ member, chamber: i % 2 ? "senate" : "house", issuer: "Synthetic Holdings Inc", side: i % 2 ? "buy" : "sell",
        txnDate: "2026-07-0" + ((i % 9) + 1), filedDate: "2026-08-0" + ((i % 9) + 1), lagDays: 30 + i, amountLow: 1000 * (i + 1), amountHigh: 15000 * (i + 1) })) };
    await mount(page, long);
    const info = await modInfo(page, "m-context");
    eq(members.filter((m) => !info.includes(m)).length, 0, "every disclosed trade is in the Context disclosure — bounded by the popover, never truncated, every member findable");
    const h40 = await page.evaluate(() => document.getElementById("m-context").getBoundingClientRect().height);
    const short = clone(withChain[0]);
    short.panels.congress = { ...long.panels.congress, total: 2, buys: 1, sells: 1, trades: long.panels.congress.trades.slice(0, 2) };
    await mount(page, short);
    const h2 = await page.evaluate(() => document.getElementById("m-context").getBoundingClientRect().height);
    ok(Math.abs(h40 - h2) <= 2, `a filing count cannot set the module's height (${Math.round(h40)}px for 40, ${Math.round(h2)}px for 2)`);
    const ctxOf = (patch) => { const c = clone(withChain[0]); c.panels.context = { ...c.panels.context, ...patch }; return c; };
    await mount(page, ctxOf({ dropped: 0, sessions: 42, datedSessions: 42 }));
    const clean = await modInfo(page, "m-context");
    ok(/42 consecutive closes, none dropped/.test(clean), "a gapless window says so, counts its sessions, and states the absence of gaps as a measurement");
    await mount(page, ctxOf({ dropped: 3, sessions: 39, datedSessions: 39 }));
    const gappy = await modInfo(page, "m-context");
    ok(/3 session\(s\) dropped/.test(gappy) && /ORDER, not on a time axis/.test(gappy), "a window with gaps names how many were dropped and warns that the axis is order rather than time");
    const legacyCard = clone(withChain[0]);
    for (const k of ["dropped", "sessions", "datedSessions", "closeDates"]) delete legacyCard.panels.context[k];
    await mount(page, legacyCard);
    const lg = await modInfo(page, "m-context");
    ok(!/dropped/.test(lg), "a card that predates these fields says NOTHING about gaps — none dropped would be a confident zero about a filter that never ran");
    ok(await page.evaluate(() => document.querySelectorAll("#m-context .ft-ret b").length >= 1), "and the module still draws its returns");
    eq(errors.length, 0, `the Context module throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const { buildLevels, buildContext, buildDisplacement, buildPath, buildCalendar, buildPricedMove } = await import("../shared/flows-card.js");
    const led = clone(withChain[0]);
    led.panels.levels = buildLevels({ spot: 180, atr: 4.2, zeroGamma: 182.5, strikeSumCrossing: 181, maxPain: 175, callWall: 195, putWall: 165 });
    led.panels.context = { ...led.panels.context, ...buildContext({ closes: Array.from({ length: 40 }, (_, i) => 150 + i * 0.8), r5: 0.012, r21: 0.084, r42: 0.11, week52Pos: 0.91, changePct: 0.004 }) };
    led.panels.displacement = buildDisplacement([{ strike: 180, call_gamma_oi: 1e6, put_gamma_oi: 0, call_gamma_vol: 0, put_gamma_vol: 0 }, { strike: 186, call_gamma_oi: 0, put_gamma_oi: 0, call_gamma_vol: 1e6, put_gamma_vol: 0 }], { atr: 4, spot: 183 });
    led.panels.path = buildPath(Array.from({ length: 5 }, (_, i) => ({ tape_time: new Date(Date.UTC(2026, 7, 24, 13, 31 + i)).toISOString(), net_delta: 250000, net_call_premium: 2500000, net_put_premium: 0 })), { sessionDate: "2026-08-24" });
    led.panels.calendar = buildCalendar([{ expiry: "2026-08-28", call_gamma: 100, put_gamma: 50 }, { expiry: "2026-09-04", call_gamma: 60, put_gamma: 40 }, { expiry: "2026-10-16", call_gamma: 30, put_gamma: 20 }], { asOf: "2026-08-24" });
    led.panels.pricedMove = buildPricedMove({ spot: 180, iv30: 0.32, rv30: 0.21, impliedMovePerc: 0.025 });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, led);
    const said = await allInfo(page);
    const withLead = Object.entries(led.panels).filter(([, p]) => p && p.status === "ok" && p.lead && typeof p.lead.say === "string");
    ok(withLead.length >= 15, `the fixture publishes a lead on ${withLead.length} panels to check`);
    for (const [key, p] of withLead) {
      ok(said.includes(p.lead.say), `${key}: the publisher's sentence is in a disclosure VERBATIM — a renderer that composed or edited it would be a second author for one reading ("${p.lead.say.slice(0, 60)}")`);
      const quotedNums = new Set(), quotedText = new Set();
      for (const v of Object.values(p.lead.n || {})) { if (typeof v === "number") quotedNums.add(String(v)); else if (typeof v === "string" && /\D/.test(v)) quotedText.add(v); }
      let stripped = p.lead.say;
      for (const v of quotedText) stripped = stripped.split(v).join(" ");
      for (const lit of stripped.match(/-?\d+(?:\.\d+)?/g) || []) ok(quotedNums.has(lit) || quotedNums.has(String(Number(lit))), `${key}: "${lit}" in the lead is pinned in n — an unpinned figure is one a rephrasing could change silently`);
    }
    const bad = await page.evaluate(() => {
      const out = [];
      const numeric = /^[−+\-]?\$?[\d.,]+[KMB%]?\s*(?:%|d|ATR|pts|Γ)?$/;
      const nodes = [...document.querySelectorAll("#ftHero .ui-chip-v, #ftGrid .ui-metric-v, #ftGrid .ui-metric-s, #ftGrid .ui-row-v, #ftGrid .ui-row span, .ft-slot-v, #ftGrid svg text, #ftHc svg text, .ft-idea svg text")];
      for (const n of nodes) { const t = (n.textContent || "").trim(); if (t && numeric.test(t) && t.includes("-")) out.push(t); }
      return out;
    });
    eq(bad.length, 0, `every numeric figure uses U+2212, never a hyphen (${bad.slice(0, 5).join(", ")})`);
    eq(errors.length, 0, `the lead walk throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const say = async (events) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, null, { ticker: "ZZZ", boards: { long: { deep: 1, rows: [{ t: "QQQ", r: 1, s: 5, dp: 1 }] } }, events });
      await page.waitForFunction(() => document.getElementById("ftStatus").textContent.length > 20, null, { timeout: 5000 });
      const got = await page.evaluate(() => ({ text: document.getElementById("ftStatus").textContent, href: (document.querySelector("#ftStatus a") || { getAttribute: () => null }).getAttribute("href"),
        why: (() => { const b = document.querySelector("#ftPx .ui-silent [data-info]"); if (!b) return ""; window.FlowsUI.openInfo(b); return document.getElementById("fxPop").innerText; })() }));
      eq(errors.length, 0, `the absent-name branch throws nothing (${errors.join("; ")})`);
      await page.close();
      return got;
    };
    const gated = await say({ gateOrigin: "2026-09-03", gateDays: 12, rows: [{ t: "ZZZ", d: "2026-09-08", dte: 5, st: "gated", s: null }] });
    ok(gated.text.includes("2026-09-08") && /5 calendar days/.test(gated.text) && gated.text.includes("2026-09-03"), "a gated name is told when it reports, in calendar days, from the origin the gate counted from");
    ok(/BEFORE the composite ran/.test(gated.text) && /not a low one/.test(gated.text), "and that the gate fired before any score existed — not that it scored badly");
    ok(!/it may be on the watch list/.test(gated.text) && /holds only names that were scored/.test(gated.text), "the false watch-list suggestion is replaced by what the watch list actually holds");
    eq(gated.href, "/flows/events/", "and the page offers the way on");
    ok(gated.why.includes("BEFORE the composite ran"), "the hero's silence carries the same account in its own disclosure");
    const stalled = await say({ gateOrigin: "2026-09-03", gateDays: 12, rows: [{ t: "ZZZ", d: "2026-11-01", dte: 59, st: "eligible", s: null }] });
    ok(/eligible/.test(stalled.text) && /cleared the earnings gate/.test(stalled.text) && !/BEFORE the composite ran/.test(stalled.text), "a name that cleared the gate is told the stage it stopped at, and never borrows the gated sentence");
    const missing = await say({ gateOrigin: "2026-09-03", gateDays: 12, windowDays: 21, capBound: false, rows: [] });
    ok(/cannot say which stage/.test(missing.text) && /21 calendar days/.test(missing.text) && /silence here is a missing row, not evidence/.test(missing.text) && !/capped/.test(missing.text), "a name with no funnel row gets no invented stage, is told the calendar's window, and is not handed a cap that did not bind");
    const cappedOut = await say({ gateOrigin: "2026-09-03", gateDays: 12, windowDays: 21, capBound: true, rows: [] });
    ok(/capped/.test(cappedOut.text) && /does not reach every name even inside it/.test(cappedOut.text), "and when the cap DID bind the calendar says so, naming what it cost");
    const unread = await say({ status: "pending" });
    ok(/could not be read/.test(unread.text) && /not on today/.test(unread.text), "an unreadable funnel says so rather than guessing, while stating the one thing known");
  }

  {
    for (const [hash, want] of [["m-gamma", "m-gamma"], ["panel-vanna", "m-hedge"], ["panel-darkpool", "m-tape"], ["m-worlds", "m-worlds"]]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, full, { hash, settle: 600 });
      const got = await page.evaluate((want) => {
        const t = document.getElementById(want);
        const bar = document.getElementById("fxBar");
        return { scrolled: scrollY, top: t.getBoundingClientRect().top, bar: bar ? bar.getBoundingClientRect().bottom : 0, focused: document.activeElement === t };
      }, want);
      ok(got.scrolled > 100, `#${hash} scrolls the page to ${want} (${Math.round(got.scrolled)}px)`);
      ok(got.top >= got.bar - 1, `and lands below the sticky bar rather than under it (module ${Math.round(got.top)}, bar ${Math.round(got.bar)})`);
      ok(got.focused, "and focus follows the jump, so a keyboard reader continues from the module");
      eq(errors.length, 0, `a deep link throws nothing (${errors.join("; ")})`);
      await page.close();
    }
    for (const bad of ["<img src=x onerror=alert(1)>", "panel-", "%E0%A4%A", "m-nothing"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, full, { hash: bad });
      ok(await page.evaluate(() => document.querySelectorAll("#ftGrid > section").length === 10), `a hash of ${JSON.stringify(bad)} paints the page anyway`);
      eq(errors.length, 0, `and throws nothing (${errors.join("; ")})`);
      await page.close();
    }
  }

  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, full);
    const used = await page.evaluate(() => {
      const out = new Set();
      for (const el of document.querySelectorAll("#ftHero *, #ftVerdict *, #ftGrid *, #ftPicker *")) if (!(el instanceof SVGElement)) for (const c of el.classList) out.add(c);
      return [...out];
    });
    const has = (css, c) => new RegExp("\\." + c.replace(/[-]/g, "\\-") + "(?![\\w-])").test(css);
    const ftMissing = used.filter((c) => c.startsWith("ft-") && !has(TICKER_CSS, c) && !/^ft-(lg|md)\d+$/.test(c));
    eq(ftMissing.length, 0, `every ft- class the page's HTML carries resolves to a rule in the route stylesheet — SVG marks are styled by their own presentation attributes, so their classes are identity hooks (${ftMissing.join(", ")})`);
    const spans = used.filter((c) => /^ft-(lg|md)\d+$/.test(c));
    ok(spans.every((c) => has(TICKER_CSS, c)), `and every span class the modules carry is one the grid actually lays out (${spans.join(", ")})`);
    const uiHooks = new Set([...UI_SRC.matchAll(/querySelector(?:All)?\("\.(ui-[\w-]+)"\)/g)].map((m) => m[1]));
    const uiMissing = used.filter((c) => c.startsWith("ui-") && !has(FLOWS_CSS, c) && !has(TICKER_CSS, c) && !uiHooks.has(c));
    eq(uiMissing.length, 0, `every ui- class the page emits resolves to a rule in the shared stylesheet, or is a hook the foundation itself queries (${uiMissing.join(", ")})`);
    ok(!/#[0-9a-fA-F]{3,8}\b/.test(TICKER_CSS.replace(/url\([^)]*\)/g, "")), "the route stylesheet carries no raw hex colour: tokens only");
    ok(/@container/.test(TICKER_CSS), "and lays its modules out with container queries");
    const sheets = await page.evaluate(() => ({ styles: document.querySelectorAll("style").length, adopted: (document.adoptedStyleSheets || []).length }));
    eq(sheets.adopted, 0, "the controller adopts no stylesheet at runtime");
    const hits = await page.evaluate(() => {
      const hit = (el) => {
        const r = el.getBoundingClientRect();
        const after = getComputedStyle(el, "::after");
        const ext = after && after.content !== "none" && after.position === "absolute" ? { t: -parseFloat(after.top) || 0, b: -parseFloat(after.bottom) || 0, l: -parseFloat(after.left) || 0, r: -parseFloat(after.right) || 0 } : { t: 0, b: 0, l: 0, r: 0 };
        return [Math.round(r.height + Math.max(0, ext.t) + Math.max(0, ext.b)), Math.round(r.width + Math.max(0, ext.l) + Math.max(0, ext.r))];
      };
      const pick = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.getBoundingClientRect().width > 0).map((n) => [sel, n.textContent.trim().slice(0, 12), ...hit(n)]);
      return [...pick("#ftGrid .ui-seg-i"), ...pick("#ftHero .ui-gchip"), ...pick("#ftGrid .ui-mod-h .ui-info"), ...pick(".ft-more"), ...pick("#ftHc .ui-seg-i")];
    });
    ok(hits.length > 20, `the 44px sweep measured the page's primary controls (${hits.length})`);
    for (const [sel, text, hgt, wid] of hits) ok(hgt >= 44 && wid >= 24, `${sel} "${text}": at least 44px of hit height on a coarse pointer (${hgt}×${wid})`);
    const ground = await page.evaluate(() => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      const hex = raw.replace("#", "");
      const n = hex.length === 3 ? [...hex].map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
    });
    ok(ground > 0 && ground < 40, `--bg resolves to a dark ground (${ground.toFixed(2)} of 255)`);
    const strip = async () => page.evaluate(() => {
      const el = document.querySelector(".ft-ideas");
      const cs = getComputedStyle(el);
      return { hides: el.scrollWidth - el.clientWidth, left: el.scrollLeft, cls: el.className, mask: cs.maskImage || cs.webkitMaskImage || "none" };
    });
    const at0 = await strip();
    ok(at0.hides > 40, `at 390px the ideas row is a carousel that hides ${at0.hides}px`);
    ok(/is-cut-end/.test(at0.cls) && !/is-cut-start/.test(at0.cls) && /gradient/.test(at0.mask), "at its start it fades ONLY the end, where content is hidden — a reader is told to swipe, and told which way");
    await page.evaluate(() => { const el = document.querySelector(".ft-ideas"); el.scrollLeft = el.scrollWidth; el.dispatchEvent(new Event("scroll")); });
    await page.waitForTimeout(150);
    const atEnd = await strip();
    ok(/is-cut-start/.test(atEnd.cls) && !/is-cut-end/.test(atEnd.cls), "at its end it fades ONLY the start — a permanent fade over the last card would tell a reader to swipe toward nothing");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    const wide = await strip();
    ok(wide.hides <= 1 && !/gradient/.test(wide.mask), "at desktop width the three ideas sit side by side with no fade at all");
    eq(errors.length, 0, `the chrome sweep throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const { fitGarch } = await import("../shared/flows-garch.js");
    let seed = 0x9E3779B9 ^ 3;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const base = withChain[0];
    const ivr = base.panels.volContext && base.panels.volContext.ivRank && Array.isArray(base.panels.volContext.ivRank.rows) ? base.panels.volContext.ivRank.rows.map((r) => r.date).sort() : [];
    ok(ivr.length > 4, `the fixture carries an implied-volatility history for the fit to sit on (${ivr.length} rows)`);
    const end = Date.parse(ivr[ivr.length - 1] + "T00:00:00Z");
    const dayOf = (i) => new Date(end - (1500 - i) * 86400000).toISOString().slice(0, 10);
    const px = [100], dates = [dayOf(0)];
    let s2 = 1;
    for (let i = 1; i <= 1500; i++) {
      const u1 = rnd() || 1e-9, u2 = rnd();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * (rnd() < 0.08 ? 3 : 1) / Math.sqrt(0.92 + 0.08 * 9);
      const e = Math.sqrt(s2) * z;
      px.push(px[px.length - 1] * Math.exp(e / 100));
      s2 = 0.05 + 0.1 * e * e + 0.85 * s2;
      dates.push(dayOf(i));
    }
    const fitted = clone(withChain[0]);
    fitted.panels.context = { ...(fitted.panels.context || {}), status: "ok", garch: fitGarch(px, dates) };
    const g0 = fitted.panels.context.garch;
    ok(g0.status === "ok" && g0.dist === "skewt" && g0.converged === true, `the fixture carries a converged skewed-t fit (${g0.status}, ${g0.dist})`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, fitted);
    const t = await modInfo(page, "m-vol");
    ok(/GARCH\(1,1\), Hansen skewed t/.test(t) && !/GED/.test(t), "the volatility disclosure names the density fitted, and carries no trace of the GED");
    const cells = ["GARCH σ last session", "GARCH σ next session", "GARCH σ long run", "Tail shape ν", "Skew λ", "α + β", "α", "β", "ω"];
    let last = -1;
    for (const c of cells) { const at = t.indexOf("\n" + c + "\n"); ok(at > last, `the fit's cell "${c}" is stated, in the fixed order: levels, then shape, then the recursion's own`); last = at; }
    ok(t.includes("\nTail shape ν\n" + g0.nu.toFixed(1) + "\n"), "the tail shape prints to one decimal");
    ok(t.includes("\nSkew λ\n" + (g0.lambda > 0 ? "+" : g0.lambda < 0 ? "−" : "") + Math.abs(g0.lambda).toFixed(2) + "\n"), "the skew prints to two decimals with a real minus sign");
    ok(/penalised maximum likelihood with variance targeting/.test(t) && /winsorised at six robust standard deviations/.test(t), "the disclosure names the method and the winsorising");
    ok(/next-session cell is the recursion's own state/.test(t) && /RiskMetrics EWMA at 0\.94/.test(t) && /long-run cell is a measurement/.test(t), "and explains the next-session cell and the reference path");
    await pickView(page, "m-vol", "History");
    const hist = await page.evaluate(() => ({ dashed: document.querySelectorAll("#m-vol .ft-cbox path[stroke-dasharray]").length, legend: document.querySelector("#m-vol .ft-leg-row").innerText }));
    ok(hist.dashed >= 1 && /EWMA\(0\.94\)/.test(hist.legend) && /GARCH σ/.test(hist.legend), `the history view draws the conditional-volatility path and its EWMA reference, dashed, and names both (${JSON.stringify(hist)})`);
    const broken = clone(fitted);
    broken.panels.context.breaks = [{ date: "2026-04-06", ratio: 0.0426, before: 117, volumeRatio: 20.5, shape: "split" }];
    await mount(page, broken);
    const brk = /The vendor’s history steps on 2026-04-06 \(close ×0\.0426, volume ×21 against the sessions before, the shape of an unadjusted split\), so the 117 sessions before it are cut/;
    ok(brk.test(await modInfo(page, "m-vol")), "a history break is named on the volatility disclosure with its date, the price and volume steps, its shape and the sessions cut");
    ok(brk.test(await infoText(page, "#ftHc .ui-info")), "and on the price chart's, which reads the same sessions");
    const older = clone(fitted);
    delete older.panels.context.garch.dist; delete older.panels.context.garch.lambda; delete older.panels.context.garch.nextVol;
    older.panels.context.garch.nu = 1.3;
    await mount(page, older);
    const pre = await modInfo(page, "m-vol");
    ok(!/\nTail shape ν\n|\nSkew λ\n|\nGARCH σ next session\n/.test(pre), "a card fitted before the skewed t shows no shape, skew or next-session figure");
    ok(/fitted before the skewed t/.test(pre) && /predates the skewed-t/.test(pre) && !/Hansen/.test(pre), "and says so instead of naming a density that was not fitted");
    eq(errors.length, 0, `the GARCH readings throw nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const card = clone(withChain.find((c) => !c.engine) || withChain[0]);
    delete card.engine;
    const neuron = {
      status: "ok", scope: "X", llm: true, model: "m", generatedAt: "2026-09-22T09:41:00.000Z", summary: "A summary sentence without figures. And a second one for the disclosure.",
      provenance: "Wording by m; figures measured by the pipeline.",
      ideas: [
        { title: "Put wall credit", structure: "put credit spread", direction: "bullish", thesis: "Thesis one.", invalidation: "a close below the put wall", horizon: "ten sessions", restsOn: ["gamma", "levels"], robustness: 3, robustnessWord: "robust", fromState: true },
        { title: "Front straddle", structure: "long straddle", direction: "neutral", thesis: "Thesis two.", invalidation: "the range holding", horizon: "the front expiry", restsOn: ["volContext", "calendar"], robustness: 2, robustnessWord: "fair" },
      ],
      context: { version: 2, sessionDate: "2026-09-21", expectedSession: "2026-09-21", stale: false, coverage: { features: 24, read: 20, quiet: 1, withheld: 3, robust: 8, fair: 10, weak: 3 },
        state: { version: 1, state: "amplifying", word: "Amplifying", direction: "bullish", flow: "bullish", confidence: 2, premium: "rich", chip: "Amplifying · short gamma, flow bullish, to the flip 44.59",
          preferred: ["put credit spread", "call debit spread"], avoid: ["iron condor", "call credit spread"], invalidation: { kind: "max_pain", px: 42.5, label: "Max pain" }, target: null,
          bound: { kind: "gamma_flip", px: 44.59, label: "Gamma flip" }, horizon: { kind: "priced_sessions", value: 10, low: 39.63, high: 46.83, days: null }, stale: false, notes: [], drivers: [] },
        features: [{ key: "gamma", title: "Gamma convexity" }, { key: "levels", title: "Key levels & distance to spot" }, { key: "volContext", title: "Volatility context" }, { key: "calendar", title: "Gamma roll-off" }] },
    };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { neuron });
    const got = await page.evaluate(() => ({
      line: document.getElementById("ftVerdictT").textContent,
      ideas: [...document.querySelectorAll("#ftVerdict .ft-idea")].map((a) => ({ title: a.querySelector(".ft-idea-t").textContent, on: a.querySelectorAll(".ui-bars i.is-on").length, dots: a.querySelectorAll(".ui-bars i").length,
        dir: a.querySelector(".ft-dir").getAttribute("aria-label"), tags: [...a.querySelectorAll(".ui-tag")].map((t) => t.textContent), slots: [...a.querySelectorAll(".ft-slots .ft-slot")].filter((x) => x.querySelector(".ui-dash .ui-state[data-state=pending]") && !/\d/.test(x.querySelector(".ft-slot-v").textContent)).length })),
      lit: [...document.querySelectorAll("#ftVerdict .ui-bars i.is-on")].every((i) => { const bg = getComputedStyle(i).backgroundColor; return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent"; }),
      chip: (document.getElementById("ftStateChip") || {}).textContent, cov: (document.getElementById("ftNeuronCov") || {}).textContent,
      meta: [...document.querySelectorAll("#ftStateMeta dt")].map((d, i) => [d.textContent, document.querySelectorAll("#ftStateMeta dd")[i].textContent]),
      tag: [...document.querySelectorAll("#ftVerdict .ft-v-meta .ui-tag")].map((t) => t.textContent) }));
    eq(got.line, "A summary sentence without figures.", "the verdict is ONE sentence; the rest waits behind More");
    eq(got.ideas.length, 2, "both vetted ideas are drawn");
    eq(got.ideas.map((i) => i.title).join(" | "), "Put credit spread | Long straddle", "in the order the server ranked them, titled by structure");
    ok(got.ideas[0].on === 3 && got.ideas[0].dots === 3 && got.ideas[1].on === 2, "a robust idea lights all three bars, a fair one two of three");
    ok(got.lit, "and every lit bar has a painted background, so the grade is visible and not a token that never resolved");
    eq(got.ideas[0].dir, "Bullish", "the direction is carried by the idea's badge, with its word for a screen reader");
    ok(got.ideas[0].tags.includes("Implied state"), "the state's own idea says where it came from");
    ok(got.ideas.every((i) => i.slots === 3), `an unpriced idea shows the pending glyph in each of its three price slots, never a figure from nowhere (${got.ideas.map((i) => i.slots).join(", ")})`);
    ok(got.tag.includes("Amplifying"), "the implied state is named beside the stance");
    eq(got.chip, "Amplifying · short gamma, flow bullish, to the flip 44.59", "and More quotes the chip the server wrote");
    assert.deepEqual(got.meta, [["Flow", "bullish"], ["Premium", "rich"], ["Prefer", "put credit spread · call debit spread"], ["Avoid", "iron condor · call credit spread"], ["Ends past", "max pain 42.50"], ["Horizon", "10 sessions"]],
      "with the flow, the premium, the structures it prefers and rules out, where it ends and how long it runs"); checks++;
    ok(/Neuron read 20 of 24 features/.test(got.cov) && /nothing here is advice/.test(got.cov) && /8 robust · 10 fair · 3 weak · 3 withheld/.test(got.cov), "the coverage line states what was read, counts each grade and disclaims advice");
    const ideaInfo = await infoText(page, "#ftVerdict .ft-idea .ft-idea-t");
    ok(/Gamma convexity · Key levels & distance to spot/.test(ideaInfo), "the features an idea rests on are named by their titles, joined by a middle dot");
    await page.click("#ftVerdict .ft-more");
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.getElementById("ftVerdictX").classList.contains("is-open") && /second one/.test(document.getElementById("ftVerdictX").innerText)), "More opens the rest of the summary");
    eq(errors.length, 0, `the Neuron paints throw nothing (${errors.join("; ")})`);
    await page.close();
  }

  {
    const card = clone(full);
    const st = card.engine.structures.find((s) => new Set((s.legs || []).map((l) => l.expiry)).size === 1) || card.engine.structures[0];
    const facts = card.engine.facts.filter((f) => typeof f.v === "number" && f.g > 0).slice(0, 2);
    const neuron = { status: "ok", scope: card.ticker, llm: true, model: "m", generatedAt: "2026-09-22T09:41:00.000Z", engine: true, verdict: "harvest-rich-premium", verdictWord: "Harvest rich premium", claims: [], refused: [],
      summary: "A summary sentence without figures.", provenance: "Figures, facts and structures computed by the engine; the summary is deterministic.",
      ideas: [{ structure: st.id, verdict: "harvest-rich-premium", word: "Harvest rich premium", because: facts.map((f) => f.id), grade: 2, from: "model" }, { structure: "S99", verdict: null, word: null, because: [], grade: 1, from: "engine" }],
      context: { version: 3, sessionDate: card.sessionDate, expectedSession: card.sessionDate, stale: false, coverage: { features: 24, read: 20, quiet: 1, withheld: 3, robust: 8, fair: 10, weak: 3 }, state: null, features: [] } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { neuron });
    const got = await page.evaluate(() => [...document.querySelectorAll("#ftVerdict .ft-idea")].map((a) => ({ title: (a.querySelector(".ft-idea-t") || {}).textContent, tags: [...a.querySelectorAll(".ui-tag")].map((t) => t.textContent),
      on: a.querySelectorAll(".ui-bars i.is-on").length, legs: a.querySelectorAll(".ft-leg").length, pay: !!a.querySelector(".ft-idea-pay svg"), silent: !!a.querySelector(".ui-silent"), text: a.innerText })));
    const pc = (v) => (v * 100).toFixed(0) + "%";
    const usd = (v) => (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(0);
    ok(await page.evaluate(() => [...document.querySelectorAll("#ftVerdict .ft-v-meta .ui-tag")].some((t) => t.textContent === "Harvest rich premium")), "the verdict word the server attached heads the verdict");
    eq(got[0].title, st.family.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), "an engine idea is titled by its structure family, read off the card's own structure");
    ok(got[0].tags.includes("Harvest rich premium"), "and carries the verdict word the server vetted");
    eq(got[0].on, 2, "and lights the grade the server vetted");
    eq(got[0].legs, st.legs.length, "every leg of the priced structure is listed with its strike, expiry and delta");
    ok(got[0].pay, "and its priced payoff is drawn from the engine's own points");
    ok(got[0].text.includes(pc(st.prob.popQ)) && got[0].text.includes(pc(st.prob.popP)), "the chance of profit on the smile (Q) and in the real world (P) are the engine's own figures");
    const meta = await infoText(page, "#ftVerdict .ft-idea .ft-idea-t");
    ok(meta.includes("Q " + pc(st.prob.popQ) + " · P " + pc(st.prob.popP)), "its disclosure states both chances of profit");
    ok(meta.includes(usd(st.ev.p) + " real world · " + usd(st.ev.q) + " on the smile"), "and the expected P&L in both worlds");
    ok(meta.includes(st.lossUnbounded ? "unbounded" : usd(st.maxLoss)), "and the max loss");
    ok(facts.every((f) => meta.includes(f.id)), "and names the facts it rests on by id with their values");
    ok(/model's pick/i.test(meta), "and who picked it");
    ok(got[1].silent && /engine ranking/i.test(got[1].text), "an id the card no longer carries is drawn as a silence tagged by who ranked it");
    ok(/not on the card this page holds/.test(await infoText(page, "#ftVerdict .ft-idea:nth-child(2) .ui-silent")), "and says the structure is missing rather than drawing it with figures from nowhere");
    const src = TICKER_SRC.slice(TICKER_SRC.indexOf("  function clipTo(pts, a, b) {"));
    let depth = 0, end = 0, seen = 0;
    for (let i = 0; i < src.length; i++) { if (src[i] === "{") { depth++; seen++; } else if (src[i] === "}") { depth--; if (!depth && seen > 1 && src.slice(i + 1, i + 40).includes("function ideaFacts")) { end = i + 1; break; } } }
    const exact = await page.evaluate(({ code, st }) => {
      const num = window.FlowsUI.num, numOr = (...a) => { for (const v of a) if (num(v) !== null) return v; return null; }, LOT = 100;
      const pp = new Function("num", "numOr", "LOT", code + "\nreturn payoffPoints;")(num, numOr, LOT);
      const S = st.legs[0].k;
      const r = pp(st, S);
      if (!r) return null;
      const ys = r.points.map((p) => p[1]);
      return { exact: r.exact, max: Math.max(...ys), min: Math.min(...ys), cross: r.points.filter((p, i) => i && Math.sign(p[1]) !== Math.sign(r.points[i - 1][1])).length };
    }, { code: src.slice(0, end), st });
    ok(exact && exact.exact, "a single-expiry structure's payoff is the exact piecewise expiry value, not a sampled curve");
    if (exact && !st.profitUnbounded) ok(Math.abs(exact.max - st.maxProfit) <= 1, `and its top is the engine's own max profit ($${exact.max.toFixed(0)} against $${st.maxProfit.toFixed(0)})`);
    if (exact && !st.lossUnbounded) ok(Math.abs(exact.min - st.maxLoss) <= 1, `and its floor the engine's own max loss, which the engine signs as the payoff's minimum ($${exact.min.toFixed(0)} against $${st.maxLoss.toFixed(0)})`);
    const worlds = await page.evaluate(() => {
      const m = [...document.querySelectorAll("#m-worlds .ui-metric")].map((n) => n.innerText.split("\n").filter(Boolean));
      return { metrics: m, svg: !!document.querySelector("#m-worlds svg[role=img]"), seg: [...document.querySelectorAll("#m-worlds .ui-seg-i")].map((b) => [b.textContent, b.getAttribute("aria-selected")]) };
    });
    ok(worlds.svg, "Two worlds draws the implied and real-world distributions on one price axis");
    const sel = worlds.seg.find((s) => s[1] === "true");
    ok(sel && sel[0] === (card.engine.expiries.find((e) => e.expiry === st.expiry) || {}).dte + "d", `it opens on the lead idea's own expiry (${sel && sel[0]})`);
    const lead = worlds.metrics.find((m) => m[0] === "Lead PoP");
    ok(lead && lead[1] === pc(st.prob.popP), `and the lead idea's real-world chance of profit is the engine's own figure (${lead && lead[1]})`);
    eq(errors.length, 0, `the engine ideas and Two worlds throw nothing (${errors.join("; ")})`);
    await page.close();
  }

} finally {
  await browser.close();
  fs.rmSync(EMIT_DIR, { recursive: true, force: true });
}
console.log(`flows-ticker-contract: ${checks} checks passed`);
