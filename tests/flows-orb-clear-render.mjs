import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";
import { memberShell } from "../shared/flows-member-shell.js";
import { SPECS, mount, dropEmit } from "./lib/page-world.mjs";
import { open, settle, waitOracle, harnessHtml } from "./lib/oracle-world.mjs";
import * as FX from "./lib/oracle-fixtures.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const ONLY = process.env.ORB_ONLY ? new RegExp(process.env.ORB_ONLY) : null;
const PART = (() => { const m = /^--part=(\d)\/(\d)$/.exec(process.argv[2] || ""); return m ? [Number(m[1]) - 1, Number(m[2])] : [0, 1]; })();
const mine = (i) => i % PART[1] === PART[0];
const SHOTS = process.env.SHOTS || null;
const SIZES = [[1920, 1080], [1440, 820], [1024, 768], [390, 844]];
const BARLESS = new Set(["login", "about", "glossary"]);
const SLUG = { "political-layers": "political" };
const slugOf = (spec) => SLUG[spec.id] || spec.id;

const pageFunctions = Object.keys(PAGES.FLOWS_PAGES).filter((k) => typeof PAGES.FLOWS_PAGES[k] === "function").sort();
eq(SPECS.map((s) => s.fn).filter((fn, i, all) => all.indexOf(fn) === i).sort(), pageFunctions, "every page function in FLOWS_PAGES is swept, Macro and Positioning included");

const CLEAR = () => {
  const host = document.getElementById("fxOracle");
  const out = { surfaces: [], hits: [], slot: null, room: null, sayOutside: [] };
  if (!host) return out;
  const shown = (e) => {
    if (!e || e.hidden) return false;
    const r = e.getBoundingClientRect();
    if (r.width <= 0.5 || r.height <= 0.5) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05 || n.hasAttribute("hidden")) return false;
    }
    return true;
  };
  for (const [name, sel] of [["orb", ".orc-orb"], ["badge", ".orc-badge"], ["pill", ".orc-pill"], ["toast", ".orc-toast"], ["restore", ".orc-restore"]]) {
    const e = host.querySelector(sel);
    if (shown(e)) { const r = e.getBoundingClientRect(); out.surfaces.push({ name, x: r.left, y: r.top, r: r.right, b: r.bottom }); }
  }
  const slot = document.getElementById("orcSlot");
  if (slot) { const r = slot.getBoundingClientRect(); out.slot = { x: r.left, y: r.top, r: r.right, b: r.bottom }; }
  const sp = document.querySelector("#fxBar .fx-bar-sp");
  if (sp) { const r = sp.getBoundingClientRect(); out.room = { x: r.left, y: r.top, r: r.right, b: r.bottom }; }
  out.bar = [...document.getElementById("fxBar").children].map((c) => (c.id || c.className.split(" ")[0]) + ":" + Math.round(c.getBoundingClientRect().left) + "-" + Math.round(c.getBoundingClientRect().right));
  if (!out.surfaces.length) return out;
  const clipOf = (el, self) => {
    let box = { x: 0, y: 0, r: innerWidth, b: innerHeight };
    for (let n = self ? el : el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible" || cs.contain.includes("paint")) {
        const q = n.getBoundingClientRect();
        box = { x: Math.max(box.x, q.left), y: Math.max(box.y, q.top), r: Math.min(box.r, q.right), b: Math.min(box.b, q.bottom) };
      }
      if (cs.position === "fixed") break;
    }
    return box;
  };
  const cut = (r, c) => ({ x: Math.max(r.left, c.x), y: Math.max(r.top, c.y), r: Math.min(r.right, c.r), b: Math.min(r.bottom, c.b) });
  const meet = (a, s) => Math.min(a.r, s.r) - Math.max(a.x, s.x) > 0.5 && Math.min(a.b, s.b) - Math.max(a.y, s.y) > 0.5;
  const label = (e, t) => (e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/)[0] : "") + (t ? " '" + t.slice(0, 18) + "'" : ""));
  const seen = new Set();
  const test = (e, rects, t) => {
    const c = clipOf(e, !!t);
    for (const raw of rects) {
      const a = cut(raw, c);
      if (a.r - a.x <= 0.5 || a.b - a.y <= 0.5) continue;
      for (const s of out.surfaces) {
        if (!meet(a, s)) continue;
        const k = s.name + ":" + label(e, t);
        if (!seen.has(k)) { seen.add(k); out.hits.push(k); }
      }
    }
  };
  const skip = (e) => !e || e.closest("#fxOracle, #orcSlot, script, style, template, noscript, .visually-hidden, dialog:not([open])");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (!t || skip(n.parentElement) || !shown(n.parentElement)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    test(n.parentElement, [...range.getClientRects()], t);
  }
  const MARKS = "button, a[href], input, select, textarea, summary, [role=tab], [role=button], [role=switch], [tabindex]:not([tabindex='-1']), canvas, img, svg path, svg rect, svg circle, svg line, svg polyline, svg polygon, svg ellipse, svg text, svg use";
  for (const e of document.body.querySelectorAll(MARKS)) {
    if (skip(e) || !shown(e)) continue;
    test(e, [e.getBoundingClientRect()], "");
  }
  for (const s of out.surfaces) {
    if (s.name === "orb" || s.name === "badge" || (s.name === "restore" && !(host.querySelector(".orc-restore.is-undo") && host.dataset.room === "1"))) {
      if (!out.slot || s.x < out.slot.x - 6 || s.r > out.slot.r + 6 || s.y < out.slot.y - 6 || s.b > out.slot.b + 6) out.sayOutside.push(s.name + " outside its slot");
    } else if (!out.room || s.x < out.room.x - 0.5 || s.r > out.room.r + 0.5) out.sayOutside.push(s.name + " outside the free span of the bar");
  }
  return out;
};

const STATES = {
  calm: () => {},
  say: () => {
    const host = document.getElementById("fxOracle");
    const pill = host.querySelector(".orc-pill");
    host.querySelector(".orc-pill-t").textContent = "SYX101 · lean flipped toward calls on heavy flow";
    host.querySelector(".orc-pill-g").textContent = "●";
    pill.style.setProperty("--pw", "300px");
    host.classList.add("has-pill");
    const toast = host.querySelector(".orc-toast");
    toast.textContent = "SYX101 · lean flipped toward calls on heavy flow across the session";
    toast.hidden = false;
    toast.classList.add("is-on");
    window.dispatchEvent(new Event("resize"));
  },
  undo: () => {
    const host = document.getElementById("fxOracle");
    host.querySelector(".orc-orb").hidden = true;
    const b = host.querySelector(".orc-restore");
    b.hidden = false;
    b.classList.add("is-undo");
    b.querySelector(".orc-restore-t").hidden = false;
    b.querySelector(".orc-restore-u").hidden = false;
    window.dispatchEvent(new Event("resize"));
  },
};
const RESET = () => {
  const host = document.getElementById("fxOracle");
  host.classList.remove("has-pill");
  const toast = host.querySelector(".orc-toast");
  toast.hidden = true;
  toast.classList.remove("is-on");
  host.querySelector(".orc-orb").hidden = false;
  const b = host.querySelector(".orc-restore");
  b.hidden = true;
  b.classList.remove("is-undo");
};

const browser = await chromium.launch();

async function setDock(page, want, width) {
  const open = await page.evaluate(() => document.body.classList.contains("has-dock-open"));
  if (open === want) return true;
  if (want) {
    const sel = width < 768 ? "#fxTabAsk" : "#askDockTab";
    if (!(await page.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel))) return false;
  } else {
    await page.evaluate(() => { const b = document.querySelector(".ak-dock-close"); if (b) b.click(); });
  }
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(100);
    if ((await page.evaluate(() => document.body.classList.contains("has-dock-open"))) === want) break;
  }
  await page.waitForTimeout(400);
  return (await page.evaluate(() => document.body.classList.contains("has-dock-open"))) === want;
}

async function sweepSpec(spec, width, height, patch = null) {
  const out = [];
  const coarse = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: SHOTS && !patch ? 2 : 1, hasTouch: coarse, isMobile: coarse, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const tag = `${spec.id}@${width}x${height}`;
  try {
    const raw = String(PAGES[spec.fn]({ username: "anilkaya", ...(spec.args || {}) }));
    const html = memberShell(PAGES.oracleShell(raw, "on", slugOf(spec)), { slug: slugOf(spec), on: true });
    await mount(page, html, spec.url, patch);
    await page.waitForFunction(() => { const o = document.getElementById("fxOracle"); return o && !o.hidden && o.querySelector(".orc-orb"); }, null, { timeout: 20000 });
    await page.waitForTimeout(300);
    const tabs = await page.$$eval("main [role=tablist] [role=tab]", (l) => l.filter((t) => t.getBoundingClientRect().width > 0).map((t) => t.id || t.dataset.tab || t.textContent.trim()));
    for (const dock of [false, true]) {
      if (!(await setDock(page, dock, width))) { out.push({ tag, view: "dock", dock, fail: ["the Ask dock did not " + (dock ? "open" : "close")] }); continue; }
      for (const v of [null, ...tabs]) {
        if (v) {
          const sel = await page.evaluate((name) => { const t = [...document.querySelectorAll("main [role=tab]")].find((x) => (x.id || x.dataset.tab || x.textContent.trim()) === name); if (!t || t.closest("[inert]")) return false; t.click(); return true; }, v);
          if (!sel) continue;
          await page.waitForTimeout(350);
        }
        for (const [state, fn] of Object.entries(STATES)) {
          await page.evaluate(fn);
          await page.waitForTimeout(60);
          const r = await page.evaluate(CLEAR);
          if (SHOTS && !patch && state !== "undo" && (width === 1440 || width === 390) && !v) await page.screenshot({ path: path.join(SHOTS, `${spec.id}-${width}x${height}-${dock ? "dock" : "nodock"}-${state}.png`) });
          await page.evaluate(RESET);
          const fail = [...r.hits, ...r.sayOutside];
          if (fail.length && process.env.ORB_DEBUG) fail.push("bar " + r.bar.join(" "));
          if (!dock || width >= 768) {
            if (state === "calm" && !r.surfaces.some((s) => s.name === "orb")) fail.push("the orb is not shown");
            if (state === "undo" && !r.surfaces.some((s) => s.name === "restore")) fail.push("the restore control is not shown");
          }
          out.push({ tag, view: v || "-", dock, state, fail, surfaces: r.surfaces.map((s) => s.name) });
        }
      }
    }
    if (errors.length) out.push({ tag, view: "-", fail: errors.map((e) => "page error " + e) });
  } catch (error) {
    out.push({ tag, view: "-", fail: ["fatal " + String(error).slice(0, 200)] });
  }
  await ctx.close();
  return out;
}

const report = [];
const uncaught = [];
try {
  for (const [i, spec] of SPECS.entries()) {
    if (!mine(i) || process.env.MUTANTS_ONLY) continue;
    if (BARLESS.has(spec.id)) {
      const raw = String(PAGES[spec.fn]({ username: "anilkaya", ...(spec.args || {}) }));
      eq(PAGES.oracleShell(raw, "on", spec.id), raw, `${spec.id}: a page with no bar carries no orb, so there is nothing to cover`);
      continue;
    }
    for (const [w, h] of SIZES) {
      if (ONLY && !ONLY.test(`${spec.id}@${w}`)) continue;
      report.push(...await sweepSpec(spec, w, h));
    }
  }
  for (const e of report.filter((x) => x.fail.length).slice(0, 80)) console.log(e.tag, e.view, e.dock ? "dock" : "nodock", e.state || "", JSON.stringify(e.fail.slice(0, 6)));

  if (!process.env.NO_REAL && PART[0] === 0) {
    for (const [width, height] of [[1440, 820], [390, 844]]) {
      const html = harnessHtml({ mode: "on", slug: "ticker", active: "ticker" });
      const RECORDS = { SYO001: FX.record({ ticker: "SYO001" }) };
      const w = await open(browser, { width, height, touch: width < 768, url: "/flows/ticker/?t=SYO001", slug: "ticker", html, records: RECORDS, topBody: FX.top() });
      await waitOracle(w.page);
      await settle(w.page, 400);
      await w.page.evaluate((rows) => window.__fl({ rows, at: Date.now() }), Array.from({ length: 6 }, (_, i) => FX.row("SYO001", 2 + i * 4, { prem: 160000, k: 60 + i })));
      await w.page.waitForTimeout(300);
      const r = await w.page.evaluate(CLEAR);
      const what = width < 768 ? "toast" : "pill";
      const room = await w.page.evaluate(() => document.getElementById("fxOracle").dataset.room);
      if (room === "1") ok(r.surfaces.some((s) => s.name === what), `a real signal from the flow stream shows the ${what} where the bar has room, at ${width}x${height} (${r.surfaces.map((s) => s.name).join(", ")})`);
      else ok(!r.surfaces.some((s) => s.name === what) && r.surfaces.some((s) => s.name === "badge"), `where the bar has no room the ${what} stays out and the orb's count says it at ${width}x${height} (${r.surfaces.map((s) => s.name).join(", ")})`);
      eq(room, width < 768 ? "0" : "1", `the bar has room for a message on a desktop and none beside a phone's controls at ${width}x${height}`);
      eq([...r.hits, ...r.sayOutside], [], `the real ${what} sits in the bar's free span and covers nothing at ${width}x${height}`);
      await w.page.evaluate(() => window.FlowsUI.oracle.open());
      await w.page.waitForTimeout(400);
      await w.page.click('.orc-pref-b[data-pref="off"]');
      await w.page.waitForTimeout(400);
      const u = await w.page.evaluate(CLEAR);
      ok(u.surfaces.some((s) => s.name === "restore"), `choosing Hidden leaves a restore control at ${width}x${height}`);
      eq([...u.hits, ...u.sayOutside], [], `the Undo control after hiding covers nothing at ${width}x${height}`);
      await w.close();
    }
  }

  if (!ONLY && !process.env.NO_MUTANTS) {
    const byId = (id) => SPECS.find((x) => x.id === id);
    const MUTANTS = [
      ["the orb floats in the bottom right corner again", "market", 1440, 820, { "/assets/css/flows-oracle.css": [["  top: calc(var(--safe-t) + (var(--bar-h) - 44px) / 2);\n  right: max(var(--gutter), var(--safe-r));\n  z-index: 110;", "  bottom: calc(24px + var(--safe-b));\n  right: max(24px, var(--safe-r));\n  z-index: 110;"]] }],
      ["the orb floats above the tab bar again on a phone", "long", 390, 844, { "/assets/css/flows-oracle.css": [["  top: calc(var(--safe-t) + (var(--bar-h) - 44px) / 2);\n  right: max(var(--gutter), var(--safe-r));\n  z-index: 110;", "  bottom: calc(var(--tab-h) + var(--safe-b) + 12px);\n  right: max(16px, var(--safe-r));\n  z-index: 110;"]] }],
      ["the bar reserves no slot for the orb", "overview", 1440, 820, { "/assets/css/flows.css": [[".fx-bar .orc-slot { flex: none; width: 44px; height: 44px; }", ".fx-bar .orc-slot { flex: none; width: 0; height: 44px; }"]] }],
      ["the pill is laid against the bar's right edge, over its controls", "ticker", 1440, 820, { "/assets/js/flows-oracle.js": [["host.style.setProperty(\"--say-r\", (r ? Math.floor(r.right) : 0) + \"px\");", "host.style.setProperty(\"--say-r\", (innerWidth - 60) + \"px\");"]] }],
      ["the toast is not held to the free span", "events", 1440, 820, { "/assets/css/flows-oracle.css": [["  max-width: var(--say-w, 0px);\n", "  max-width: none;\n"]] }],
      ["the room check lets a message into a span too narrow for it", "events", 390, 844, { "/assets/js/flows-oracle.js": [["host.setAttribute(\"data-room\", r && w >= 96 ? \"1\" : \"0\");", "host.setAttribute(\"data-room\", \"1\");"], ["host.style.setProperty(\"--say-w\", Math.max(0, w) + \"px\");", "host.style.setProperty(\"--say-w\", Math.max(160, w) + \"px\");"]] }],
      ["the Undo control spreads left from the slot over the bar", "watch", 1024, 768, { "/assets/css/flows-oracle.css": [[".orc-pill, .orc-toast, .orc[data-room=\"1\"] .orc-restore.is-undo {", ".orc-pill, .orc-toast {"]] }],
      ["the orb stays on top of an open Ask dock on a phone", "overview", 390, 844, { "/assets/css/flows-oracle.css": [["  .has-dock-open .orc:not(.is-open) { visibility: hidden; }\n", "  .has-dock-open .orc:not(.is-open) { top: auto; bottom: 120px; }\n"]] }],
    ];
    for (const [name, id, w, h, patch] of MUTANTS.filter((m, i) => mine(i))) {
      const seen = await sweepSpec(byId(id), w, h, patch);
      const caught = seen.some((e) => e.fail.length && !e.fail.some((f) => /^fatal/.test(f)));
      ok(true, name);
      if (!caught) uncaught.push(name + " " + JSON.stringify(seen.filter((e) => e.fail.length).slice(0, 2)));
    }
  }
} finally {
  await browser.close();
  dropEmit();
}

const bad = report.filter((e) => e.fail.length);
for (const name of uncaught) console.log("PLANTED WRONG BUILD NOT CAUGHT: " + name);
eq(bad.length, 0, `the orb, its pill, its toast and its Undo cover no text, figure, control or chart mark on any page, tab or dock state at four sizes (${report.length} views)`);
eq(uncaught, [], "every planted wrong build is caught");
console.log(`flows-orb-clear-render: ${checks} checks, ${report.length} views swept, ${bad.length} with findings`);
