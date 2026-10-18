import assert from "node:assert/strict";
import { launch } from "./lib/browser.mjs";
import { openHome, TABS } from "./lib/home-fixtures.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const JS = "/assets/js/flows-overview.js";
const CSS = "/assets/css/flows-home.css";

const MEASURE = () => {
  const d = document.documentElement;
  const clip = [];
  const mods = [...document.querySelectorAll(".hm-panel > *")].filter((m) => !m.hidden);
  for (const m of mods) {
    if (m.closest("[inert]") || getComputedStyle(m).visibility === "hidden") continue;
    const r = m.getBoundingClientRect();
    if (!r.height) continue;
    for (const e of m.querySelectorAll("*")) {
      if (e.closest("dialog") || e.closest("[hidden]") || e.closest("details:not([open])") || e.closest(".visually-hidden") || e.closest(".fn-lede, .fn-legend, .fn-paths, .ui-roll")) continue;
      if (getComputedStyle(e).visibility === "hidden") continue;
      if (e.closest("svg") && e.tagName.toLowerCase() !== "svg") continue;
      const q = e.getBoundingClientRect();
      let box = r;
      for (let a = e.parentElement; a && a !== m.parentElement; a = a.parentElement) {
        if (a.matches(".fn-stage, .nm-stage, .fn-hits")) { box = a.getBoundingClientRect(); break; }
        const o = getComputedStyle(a);
        if (o.overflowY !== "visible" || o.overflowX !== "visible") { const t = a.getBoundingClientRect(); if (t.bottom < box.bottom) box = t; }
      }
      if (q.height && q.width && (q.bottom > box.bottom + 1 || q.right > r.right + 1)) clip.push(m.id + ">" + e.tagName.toLowerCase() + "." + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(" ")[0] + ":" + Math.round(Math.max(q.bottom - box.bottom, q.right - r.right)));
    }
  }
  const panels = [...document.querySelectorAll(".hm-panel")].map((p) => ({ k: p.dataset.panel, inert: p.inert, hidden: getComputedStyle(p).visibility === "hidden" }));
  const sel = [...document.querySelectorAll("#hmTabs [role=tab]")].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.dataset.tab);
  const shown = (m) => !m.closest("[inert]") && getComputedStyle(m).visibility !== "hidden" && m.getBoundingClientRect().height > 40;
  const visibleMods = mods.filter(shown).map((m) => m.id);
  const sub = document.getElementById("hmSub");
  return {
    sh: d.scrollHeight, ih: innerHeight, sw: d.scrollWidth, iw: innerWidth, clip, panels, sel,
    view: document.getElementById("hmStage").dataset.view, hash: location.hash, visibleMods,
    painted: mods.filter((m) => getComputedStyle(m).visibility !== "hidden" && m.getBoundingClientRect().height > 40).map((m) => m.id),
    subHidden: !sub || sub.hidden || getComputedStyle(sub).display === "none", subCount: sub ? sub.querySelectorAll("button").length : 0,
    inner: [...document.querySelectorAll(".hm-panel *")].filter((e) => !e.closest("[inert]") && !e.closest("dialog") && e.clientHeight > 20 && e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map((e) => e.id || e.className).slice(0, 3),
  };
};

async function sweep(page, label, { phone }) {
  const bad = [];
  for (const t of TABS) {
    await page.click(`#hmT-${t}`);
    await page.waitForTimeout(450);
    const mods = await page.evaluate((k) => [...document.querySelectorAll(`#hmP-${k} > *`)].filter((m) => !m.hidden).map((m) => m.id), t);
    const rounds = phone ? mods.length : 1;
    for (let i = 0; i < rounds; i++) {
      if (phone && mods.length > 1) {
        await page.locator("#hmSub button").nth(i).click();
        await page.waitForTimeout(350);
      }
      let m = await page.evaluate(MEASURE);
      for (let n = 0; n < 6 && m.clip.length; n++) { await page.waitForTimeout(250); m = await page.evaluate(MEASURE); }
      const at = `${label} ${t}${phone && mods.length > 1 ? "/" + mods[i] : ""}`;
      if (m.sh > m.ih + 1) bad.push(`${at}: the page scrolls (${m.sh} against ${m.ih})`);
      if (m.sw > m.iw) bad.push(`${at}: the page scrolls sideways`);
      if (m.clip.length) bad.push(`${at}: content is clipped: ${m.clip.slice(0, 4).join(", ")}`);
      if (m.inner.length) bad.push(`${at}: a module scrolls inside itself: ${m.inner.join(", ")}`);
      if (m.view !== t || m.sel.join() !== t) bad.push(`${at}: tab state is ${m.view}/${m.sel}`);
      if (m.panels.some((p) => p.inert !== (p.k !== t))) bad.push(`${at}: an inactive panel is not inert`);
      if (m.panels.some((p) => p.k !== t && !p.hidden)) bad.push(`${at}: an inactive panel is visible`);
      if (!m.visibleMods.length) bad.push(`${at}: no module is visible`);
      if (phone && mods.length > 1 && (m.subHidden || m.subCount !== mods.length)) bad.push(`${at}: the module switch is missing`);
      if (phone && m.painted.length !== 1) bad.push(`${at}: ${m.painted.length} modules share the phone screen`);
      if (m.hash !== "#view=" + t) bad.push(`${at}: the address says ${m.hash}`);
    }
  }
  return bad;
}

async function allDialogs(page, label) {
  const bad = [];
  for (const t of TABS) {
    await page.click(`#hmT-${t}`);
    await page.waitForTimeout(350);
    const n = await page.locator(`#hmP-${t} .hm-all:not([hidden])`).count();
    for (let i = 0; i < n; i++) {
      const btn = page.locator(`#hmP-${t} .hm-all:not([hidden])`).nth(i);
      if (!(await btn.isVisible())) continue;
      await btn.click();
      await page.waitForSelector("dialog[open]");
      const g = await page.evaluate(() => { const d = document.querySelector("dialog[open]"); const r = d.getBoundingClientRect(); return { h: r.height, w: r.width, rows: d.querySelectorAll("li, tr, .ui-row, svg, p, div").length, sh: document.documentElement.scrollHeight, ih: innerHeight, iw: innerWidth }; });
      if (g.h > g.ih + 1 || g.w > g.iw + 1) bad.push(`${label} ${t}: the Show all dialog is larger than the screen`);
      if (g.rows < 3) bad.push(`${label} ${t}: the Show all dialog is empty`);
      if (g.sh > g.ih + 1) bad.push(`${label} ${t}: opening the dialog scrolls the page`);
      await page.keyboard.press("Escape");
      if (await page.locator("dialog[open]").count()) bad.push(`${label} ${t}: Escape does not close the dialog`);
    }
  }
  return bad;
}

async function keyboard(page, label) {
  const bad = [];
  await page.focus("#hmT-session");
  await page.keyboard.press("ArrowRight");
  let v = await page.evaluate(() => document.getElementById("hmStage").dataset.view);
  if (v !== "flow") bad.push(`${label}: ArrowRight did not move to Flow (${v})`);
  if (await page.evaluate(() => document.activeElement.id) !== "hmT-flow") bad.push(`${label}: focus did not follow the tab`);
  await page.keyboard.press("End");
  v = await page.evaluate(() => document.getElementById("hmStage").dataset.view);
  if (v !== TABS[TABS.length - 1]) bad.push(`${label}: End did not reach ${TABS[TABS.length - 1]} (${v})`);
  await page.keyboard.press("ArrowRight");
  v = await page.evaluate(() => document.getElementById("hmStage").dataset.view);
  if (v !== "session") bad.push(`${label}: the tab list does not wrap (${v})`);
  await page.keyboard.press("Home");
  const roving = await page.evaluate(() => [...document.querySelectorAll("#hmTabs [role=tab]")].filter((t) => t.tabIndex === 0).length);
  if (roving !== 1) bad.push(`${label}: ${roving} tabs are in the tab order`);
  return bad;
}

const browser = await launch();

for (const [w, h] of [[1440, 820], [1024, 768], [390, 844]]) {
  const { context, page, errors } = await openHome(browser, { viewport: { width: w, height: h }, coarse: w < 500 });
  await page.waitForTimeout(2500);
  const phone = w < 900;
  eq(await sweep(page, `${w}`, { phone }), [], `${w}x${h}: EVERY TAB (AND EVERY MODULE ON A PHONE) FITS ONE SCREEN WITH NOTHING CLIPPED AND NO PAGE SCROLL`);
  eq(await allDialogs(page, `${w}`), [], `${w}x${h}: every Show all dialog fits the screen and closes on Escape`);
  eq(await keyboard(page, `${w}`), [], `${w}x${h}: the tab list works from the keyboard`);
  if (w < 500) {
    const small = await page.evaluate(() => [...document.querySelectorAll("#hmTabs button, #hmSub button")].filter((b) => b.getBoundingClientRect().height && b.getBoundingClientRect().height < 43.5).length);
    eq(small, 0, `${w}: tabs and the module switch are 44 px tall`);
  }
  const head = await page.evaluate(() => ({ h1: document.querySelectorAll("h1").length, h2: document.querySelectorAll("main h2, .flows-main h2").length > 5 }));
  eq(head.h1, 1, `${w}: one h1`);
  ok(head.h2, `${w}: every module keeps its h2`);
  eq(errors, [], `${w}: no page error`);
  await context.close();
}

{
  const { context, page } = await openHome(browser, { hash: "#view=flow" });
  await page.waitForTimeout(1500);
  eq(await page.evaluate(() => document.getElementById("hmStage").dataset.view), "flow", "AN ADDRESS WITH #view= OPENS THAT TAB");
  await page.evaluate(() => { location.hash = "#view=names"; });
  await page.waitForTimeout(300);
  eq(await page.evaluate(() => document.getElementById("hmStage").dataset.view), "names", "and following another address changes it");
  await page.evaluate(() => { location.hash = "#view=nonsense"; });
  await page.waitForTimeout(300);
  eq(await page.evaluate(() => document.getElementById("hmStage").dataset.view), "session", "an unknown view falls back to the first");
  await context.close();
}

{
  const { context, page, errors } = await openHome(browser, { net: false });
  await page.waitForTimeout(1500);
  eq(await page.evaluate(() => [...document.querySelectorAll("#hmP-flow > *")].map((m) => m.id)), ["hmAlerts", "hmLean"], "without the network switch the Flow tab holds Flagged and Sectors");
  eq(await sweep(page, "no-net", { phone: false }), [], "and still fits the screen");
  eq(errors, [], "no page error without the network");
  await context.close();
}

{
  const { context, page, errors } = await openHome(browser, { reduced: true, viewport: { width: 1024, height: 768 } });
  await page.waitForTimeout(1500);
  eq(await sweep(page, "reduced", { phone: false }), [], "under reduced motion every tab still fits");
  eq(errors, [], "and draws with no page error");
  await context.close();
}

{
  const { context, page } = await openHome(browser, { overrides: { "flows/market": { status: "pending" }, "flows/news": { status: "pending", rows: [] }, "flows/events": { status: "pending", rows: [] }, "flows/pulse": { status: "pending" } } });
  await page.waitForTimeout(1500);
  eq(await sweep(page, "pending", { phone: false }), [], "with the feeds pending every tab still fits and says so");
  await context.close();
}

const MUTANTS = [
  ["panels stack in the flow and the page scrolls", CSS, [[".hm-panel { position: absolute; inset: 0;", ".hm-panel { position: relative;"]]],
  ["the fitter never runs", JS, [["if (!body || mod.classList.contains(\"fn-card\") || !mod.getBoundingClientRect().height) return;", "return;"]]],
  ["inactive panels stay interactive", JS, [["p.inert = p.dataset.panel !== key;", "p.inert = false;"]]],
  ["inactive panels stay visible", CSS, [["visibility: hidden; min-height: 0; min-width: 0; }", "min-height: 0; min-width: 0; }"]]],
  ["the phone has no module switch", JS, [["subBar.hidden = mods.length < 2;", "subBar.hidden = true;"]]],
  ["the selected tab is never marked", JS, [["x.setAttribute(\"aria-selected\", String(on));", "void on;"]]],
  ["the address is ignored", JS, [["showTab(fromHash(), false, true);\n  addEventListener", "showTab(\"session\", false, true);\n  addEventListener"]]],
  ["the tab list ignores the keyboard", JS, [["if (to === null) return;", "return;"]]],
  ["every module is shown on the phone", CSS, [[".hm-panel > .hm-mod, .hm-panel > .hm-hero, .hm-panel > .hm-verdict { position: absolute; inset: 0; visibility: hidden; }", ".hm-panel > .hm-mod, .hm-panel > .hm-hero, .hm-panel > .hm-verdict { position: absolute; inset: 0; }"]]],
];

for (const [name, file, edits] of MUTANTS) {
  const bad = [];
  for (const [w, h] of [[1024, 768], [390, 844]]) {
    const { context, page } = await openHome(browser, { viewport: { width: w, height: h }, coarse: w < 500, patch: { [file]: edits }, hash: "#view=flow" });
    await page.waitForTimeout(1800);
    try {
      if ((await page.evaluate(() => document.getElementById("hmStage").dataset.view)) !== "flow") bad.push(`${w}: the address #view=flow did not open the Flow tab`);
      bad.push(...(await sweep(page, `${w}`, { phone: w < 900 })));
      bad.push(...(await keyboard(page, `${w}`)));
    } catch (error) {
      bad.push("threw: " + error.message.split("\n")[0]);
    }
    await context.close();
  }
  ok(bad.length > 0, `PLANTED WRONG BUILD IS CAUGHT BY THE ONE-SCREEN SWEEP: ${name}`);
}

await browser.close();
console.log(`flows-home-onescreen: ${checks} checks, ${TABS.length} tabs at 1440x820, 1024x768 and 390x844 with nothing clipped and no page scroll, dialogs, keyboard, the address, and ${MUTANTS.length} planted wrong builds`);
