import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { syxChain, nvdaAfter, openDesk, showView, REPO } from "./desk-fixtures.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const VIEWPORTS = [[1440, 820], [1024, 768], [390, 844]];
const payloads = () => ({
  SYX101: syxChain("SYX101", { spot: 100 }),
  SYX102: syxChain("SYX102", { spot: 52.4, start: 30, facts: [{ id: "carry.implied", v: 0.08, u: "frac", g: 3 }] }),
  NVDA: nvdaAfter(),
});

const STATES = [
  ["empty desk", "", 0],
  ["puts", "?t=SYX101,SYX102,NVDA&strategy=csp", 12],
  ["calls", "?t=SYX101,SYX102,NVDA&strategy=cc", 12],
  ["short calls, contracts only", "?t=SYX101,SYX102,NVDA&strategy=sc", 12],
  ["short calls with buying power", "?t=SYX101,SYX102,NVDA&strategy=sc&bp=25000", 12],
];

const measure = () => {
  const de = document.documentElement;
  const visible = (n) => !n.closest("[inert]") && getComputedStyle(n).visibility !== "hidden" && n.getBoundingClientRect().height > 0;
  const clipped = [...document.querySelectorAll(".dk-panel > .ui-mod")].filter(visible).filter((m) => m.scrollHeight > m.clientHeight + 1 || m.scrollWidth > m.clientWidth + 8).map((m) => m.id + " " + m.scrollWidth + "x" + m.scrollHeight + " in " + m.clientWidth + "x" + m.clientHeight);
  const offscreen = [...document.querySelectorAll(".dk-panel > .ui-mod")].filter(visible).filter((m) => { const q = m.getBoundingClientRect(); return q.bottom > innerHeight + 1 || q.top < 0 || q.right > innerWidth + 1; }).map((m) => m.id);
  const leaving = [];
  for (const m of document.querySelectorAll(".dk-panel > .ui-mod")) {
    if (!visible(m)) continue;
    const r = m.getBoundingClientRect();
    for (const c of m.querySelectorAll(".ui-mod-h > *, .dk-scatter svg, .tl-legend, .dk-assume, .dk-plan, .dk-row:not([hidden])")) {
      const q = c.getBoundingClientRect();
      if (!q.width || !q.height || c.closest("[hidden]")) continue;
      if (q.left < r.left - 1 || q.right > r.right + 1 || q.bottom > r.bottom + 1) leaving.push(m.id + " > " + (c.className.baseVal === undefined ? c.className : "svg").toString().slice(0, 30));
    }
  }
  const panels = [...document.querySelectorAll(".dk-panel")].map((p) => ({ id: p.dataset.panel, inert: p.inert, hidden: getComputedStyle(p).visibility === "hidden" }));
  return { sh: de.scrollHeight, ih: innerHeight, sw: de.scrollWidth, iw: innerWidth, clipped, offscreen, leaving, panels, view: document.getElementById("dkGrid").dataset.view, bar: (() => { const bar = document.querySelector(".dk-bar"); const notes = [...bar.children].filter((c) => !c.classList.contains("dk-row1") && !c.classList.contains("dk-row2") && c.getBoundingClientRect().height > 0); return bar.getBoundingClientRect().height - notes.reduce((t, c) => t + c.getBoundingClientRect().height + 8, 0); })() };
};

async function sweep(page, label, w) {
  const bad = [];
  const views = await page.evaluate(() => [...document.querySelectorAll("#dkTabs [role=tab]")].filter((t) => !t.hidden).map((t) => t.dataset.tab));
  for (const v of views) {
    await showView(page, v);
    await page.waitForTimeout(250);
    const m = await page.evaluate(measure);
    if (m.sh > m.ih + 1) bad.push(`${label} ${v}: page scrolls ${m.sh} > ${m.ih}`);
    if (m.sw > m.iw) bad.push(`${label} ${v}: sideways scroll ${m.sw} > ${m.iw}`);
    if (m.clipped.length) bad.push(`${label} ${v}: clipped ${m.clipped.join("; ")}`);
    if (m.offscreen.length) bad.push(`${label} ${v}: ${m.offscreen.join(", ")} is not inside the viewport`);
    if (m.leaving.length) bad.push(`${label} ${v}: leaves its module ${[...new Set(m.leaving)].join("; ")}`);
    for (const p of m.panels) {
      const active = p.id === m.view;
      if (active === p.inert || active === p.hidden) bad.push(`${label} ${v}: panel ${p.id} inert=${p.inert} hidden=${p.hidden}`);
    }
    if (w >= 1024 && m.bar > 112) bad.push(`${label} ${v}: bar ${m.bar}px over 112`);
    if (w < 640 && m.bar > 150) bad.push(`${label} ${v}: bar ${m.bar}px over 150`);
  }
  return bad;
}

const browser = await chromium.launch();
const errors = [];

try {
  for (const [w, h] of VIEWPORTS) {
    for (const [name, query] of STATES) {
      const page = await openDesk(browser, { payloads: payloads(), query, errors, viewport: { width: w, height: h } });
      await page.waitForTimeout(query ? 2500 : 1200);
      const bad = await sweep(page, `${w}x${h} ${name}`, w);
      eq(bad, [], `${w}x${h} ${name}: one screen, nothing clipped, inactive panels inert and hidden`);
      await page.close();
    }
  }

  for (const [w, h] of VIEWPORTS) {
    const page = await openDesk(browser, { payloads: payloads(), query: "?t=SYX101,SYX102,NVDA&strategy=sc", errors, viewport: { width: w, height: h } });
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='sc']").length >= 12, null, { timeout: 20000 });
    await showView(page, "lines");
    await page.waitForTimeout(300);
    const total = await page.evaluate(() => document.querySelectorAll("#dkList .dk-row").length);
    const shown = await page.evaluate(() => [...document.querySelectorAll("#dkList .dk-row")].filter((r) => !r.hidden).length);
    ok(shown >= 1 && shown <= total, `${w}: the fitter keeps ${shown} of ${total} lines`);
    if (shown < total) {
      const label = await page.locator("#dkShowAll").textContent();
      eq(label.trim(), `Show all ${total}`, `${w}: the button counts every line`);
      await page.locator("#dkShowAll").click();
      await page.waitForSelector(".dk-all-dlg[open]");
      eq(await page.evaluate(() => document.querySelectorAll(".dk-all-dlg .dk-row").length), total, `${w}: the dialog holds every line`);
      const g = await page.evaluate(() => { const d = document.querySelector(".dk-all-dlg"); const r = d.getBoundingClientRect(); return { h: r.height, ih: innerHeight, sh: document.documentElement.scrollHeight }; });
      ok(g.h <= g.ih + 1 && g.sh <= g.ih + 1, `${w}: the dialog fits the viewport and the page behind does not scroll`);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".dk-all-dlg[open]"));
      eq(await page.evaluate(() => document.activeElement.id), "dkShowAll", `${w}: focus returns to the button`);
    } else {
      eq(await page.locator("#dkShowAll").isHidden(), true, `${w}: no Show all button when every line fits`);
    }
    await page.close();
  }

  {
    const page = await openDesk(browser, { payloads: payloads(), query: "?t=SYX101,SYX102&strategy=sc", errors, viewport: { width: 1440, height: 820 } });
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='sc']").length >= 12, null, { timeout: 20000 });
    const names = await page.$$eval("#dkTabs [role=tab]:not([hidden])", (t) => t.map((x) => x.dataset.tab));
    ok(names[0] === "frontier" && names.includes("lines"), "the tablist opens on the Frontier");
    await page.locator("#dkT-frontier").focus();
    await page.keyboard.press("ArrowRight");
    eq(await page.evaluate(() => document.getElementById("dkGrid").dataset.view), "lines", "ArrowRight moves to Lines");
    eq(await page.evaluate(() => document.activeElement.id), "dkT-lines", "and focus follows");
    await page.keyboard.press("End");
    const last = await page.evaluate(() => document.getElementById("dkGrid").dataset.view);
    eq(last, names[names.length - 1], "End goes to the last tab");
    await page.keyboard.press("Home");
    eq(await page.evaluate(() => document.getElementById("dkGrid").dataset.view), "frontier", "Home goes to the first");
    ok((await page.evaluate(() => location.hash)) === "#view=frontier", "the address follows with replaceState");
    await page.evaluate(() => { location.hash = "#view=lines"; });
    await page.waitForFunction(() => document.getElementById("dkGrid").dataset.view === "lines");
    ok(true, "following another address changes the view");
    await page.evaluate(() => { location.hash = "#view=nonsense"; });
    await page.waitForFunction(() => document.getElementById("dkGrid").dataset.view === "frontier");
    ok(true, "an unknown view falls back to the Frontier");
    const rel = await page.evaluate(() => [...document.querySelectorAll("#dkTabs [role=tab]")].every((t) => document.getElementById(t.getAttribute("aria-controls")).getAttribute("aria-labelledby") === t.id));
    ok(rel, "every tab and panel name each other");
    await page.close();
  }

  {
    const p2 = await openDesk(browser, { payloads: payloads(), query: "?t=SYX101,SYX102&strategy=sc", errors, viewport: { width: 390, height: 844 } });
    await p2.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='sc']").length >= 12, null, { timeout: 20000 });
    const tabs = await p2.$$eval("#dkTabs [role=tab]:not([hidden])", (t) => t.map((x) => x.dataset.tab));
    ok(tabs.includes("plan"), "a phone has a Plan tab holding Sizing");
    ok(await p2.evaluate(() => !!document.querySelector("#dkP-plan #dkSizingM")), "and Sizing lives in it");
    ok(await p2.locator("#dkFilterBtn").isVisible(), "the phone has one Filters button");
    await p2.locator("#dkFilterBtn").click();
    await p2.waitForSelector("#dkFilterDlg[open]");
    const inside = await p2.evaluate(() => [...document.querySelectorAll("#dkFilterDlg .ui-seg, #dkFilterDlg #dkTerms")].length);
    ok(inside >= 3, `the dialog holds Sell, Tenor and Terms (${inside})`);
    await p2.keyboard.press("Escape");
    await p2.waitForFunction(() => !document.querySelector("#dkFilterDlg[open]"));
    await p2.close();
  }

  const board = (u) => (u.pathname === "/api/flows/board" ? { status: "ok", rows: [{ t: "SYX101" }] } : null);
  const frozen = async (p) => { const cdp = await p.context().newCDPSession(p); await cdp.send("Animation.enable"); await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 }); };
  const emptyStage = () => {
    const vis = (id) => { const n = document.getElementById(id); if (!n || n.closest("[inert]")) return false; const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return r.height > 40 && cs.visibility !== "hidden" && Number(cs.opacity) > 0.99 && r.bottom <= innerHeight + 1; };
    const tab = document.getElementById("dkT-lines"), go = document.querySelector(".dk-suggest"), find = document.querySelector(".dk-find");
    const gs = go ? getComputedStyle(go) : null, gr = go && go.getBoundingClientRect(), fr = find.getBoundingClientRect();
    return { view: document.getElementById("dkGrid").dataset.view, linesTab: tab.hidden, frontier: vis("dkFrontierM"), quiet: !!document.querySelector("#dkFrontierM .ui-silent"), sizing: vis("dkSizingM") || !!document.querySelector("#dkP-plan #dkSizingM"),
      go: go ? { text: go.textContent, bg: gs.backgroundColor, color: gs.color, ring: gs.boxShadow, mid: gr.top < fr.bottom ? Math.abs((gr.top + gr.bottom) / 2 - (fr.top + fr.bottom) / 2) : Math.abs(gr.left - fr.left), h: gr.height, need: matchMedia("(pointer: coarse)").matches ? 44 : 36 } : null };
  };
  for (const [w, h] of [[1920, 1080], [1440, 820], [390, 844]]) {
    const page = await openDesk(browser, { payloads: payloads(), query: "#view=lines", errors, viewport: { width: w, height: h }, api: board });
    await page.waitForSelector(".dk-suggest", { timeout: 10000 });
    await page.waitForTimeout(1900);
    const m = await page.evaluate(emptyStage);
    eq([m.view, m.linesTab], ["frontier", true], `${w}x${h} AN EMPTY DESK asked for #view=lines opens the Frontier and hides the Lines tab, so no blank stage is reachable (${m.view}, Lines tab hidden ${m.linesTab})`);
    ok(m.frontier && m.quiet, `${w}x${h}: the Frontier module is on screen with its quiet state inviting a symbol`);
    ok(m.go && m.go.text === "Try SYX101" && m.go.color === "rgb(245, 245, 247)" && !/^rgb\(13, 16, 23\)$/.test(m.go.bg) && /inset/.test(m.go.ring) && m.go.mid <= 2, `${w}x${h}: the suggestion chip is drawn in Flows tokens (label colour, a translucent fill and an inset rule) and sits on the search box's centre line, or under its left edge where the row wraps (${JSON.stringify(m.go)})`);
    ok(m.go && m.go.h >= m.go.need - 0.5, `${w}x${h}: the chip is a full-size target (${m.go && m.go.h} px)`);
    await page.close();
  }
  {
    const page = await openDesk(browser, { payloads: payloads(), query: "?t=SYX101", errors, viewport: { width: 1440, height: 820 } });
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row").length > 0, null, { timeout: 20000 });
    await page.evaluate(() => { location.hash = "view=lines"; });
    await page.waitForFunction(() => document.getElementById("dkGrid").dataset.view === "lines");
    await page.locator("#deskClear").click();
    await page.waitForFunction(() => document.querySelectorAll(".desk-chip").length === 0, null, { timeout: 8000 });
    await page.waitForTimeout(1900);
    const m = await page.evaluate(emptyStage);
    eq([m.view, m.linesTab, m.frontier], ["frontier", true, true], `clearing the book while on Lines falls back to the Frontier with the Lines tab hidden (${m.view})`);
    await page.close();
  }
  for (let i = 0; i < 4; i++) {
    const page = await openDesk(browser, { payloads: payloads(), query: "", errors, viewport: { width: 1440, height: 820 }, api: board, before: frozen });
    await page.waitForTimeout(2200);
    const m = await page.evaluate(emptyStage);
    ok(m.frontier && m.sizing, `LOAD ${i + 1} AT 1440x820 WITH NO ANIMATION FRAME (a background tab, a headless capture): the Frontier and Sizing cards are on screen, not stuck at their entrance animation's first frame (${JSON.stringify(m)})`);
    await page.close();
  }

  const SRC = (rel) => fs.readFileSync(new URL(rel, REPO), "utf8");
  const MUT = [
    ["an unfitted lines list", "assets/js/flows-desk.js", [["while (shown > 1 && box.scrollHeight > box.clientHeight + 1) rows[--shown].hidden = true;", "void shown;"]]],
    ["an active panel left inert", "assets/js/flows-desk.js", [["panels[x].inert = !on;", "panels[x].inert = true;"]]],
    ["inactive panels stay interactive", "assets/js/flows-desk.js", [["panels[x].inert = !on;", "panels[x].inert = false;"]]],
    ["a fixed 300 px chart on a short stage", "assets/js/flows-desk.js", [["if (!(stage > 0)) return w < 600 ? 240 : 300;", "return 420;"]]],
    ["the bar grows past its budget", "assets/css/flows-desk.css", [[".flows-body[data-flows-page=\"desk\"] .dk-bar { flex: none;", ".flows-body[data-flows-page=\"desk\"] .dk-bar { min-height: 220px; flex: none;"]]],
    ["panels stack in the flow", "assets/css/flows-desk.css", [[".dk-panel { position: absolute; inset: 0;", ".dk-panel { position: relative;"]]],
  ];
  for (const [name, rel, edits] of MUT) {
    let text = SRC(rel);
    for (const [from, to] of edits) {
      assert.equal(text.split(from).length - 1, 1, `mutant "${name}" applies exactly once`);
      text = text.replace(from, () => to);
    }
    const bad = [];
    for (const [w, h] of VIEWPORTS) {
      const page = await openDesk(browser, { payloads: payloads(), query: "?t=SYX101,SYX102,NVDA&strategy=sc&bp=25000", errors: [], viewport: { width: w, height: h },
        before: async (p) => {
          await p.route(new RegExp("/" + rel.replace(/[.]/g, "\\.") + "(\\?.*)?$"), (r) => r.fulfill({ contentType: rel.endsWith(".css") ? "text/css" : "text/javascript", body: text }));
        } });
      await page.waitForTimeout(2500);
      try { bad.push(...(await sweep(page, `${w}`, w))); } catch (e) { bad.push("threw " + String(e.message).split("\n")[0]); }
      await page.close();
    }
    ok(bad.length > 0, `PLANTED WRONG BUILD IS CAUGHT: ${name}`);
  }
  eq(errors, [], "no page error");
} finally {
  await browser.close();
}

console.log(`flows-desk-onescreen: ${checks} checks`);
