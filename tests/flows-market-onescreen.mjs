import assert from "node:assert/strict";
import { launch } from "./lib/browser.mjs";
import { openMarket, TABS } from "./lib/market-fixtures.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const JS = "/assets/js/flows-market.js";
const CSS = "/assets/css/flows-market.css";

const MEASURE = () => {
  const d = document.documentElement;
  const clip = [];
  for (const m of document.querySelectorAll(".mk-mod")) {
    if (m.closest("[inert]") || getComputedStyle(m).visibility === "hidden") continue;
    const r = m.getBoundingClientRect();
    if (!r.height) continue;
    for (const e of m.querySelectorAll("*")) {
      if (e.closest("dialog") || e.closest("[hidden]") || e.closest("details:not([open])")) continue;
      if (getComputedStyle(e).visibility === "hidden") continue;
      const q = e.getBoundingClientRect();
      if (q.height && q.width && (q.bottom > r.bottom + 1 || q.right > r.right + 1)) { clip.push(m.id + ">" + e.tagName.toLowerCase() + ":" + Math.round(Math.max(q.bottom - r.bottom, q.right - r.right))); break; }
    }
  }
  const panels = [...document.querySelectorAll(".mk-panel")].map((p) => ({ k: p.dataset.panel, inert: p.inert, hidden: getComputedStyle(p).visibility === "hidden" }));
  const sel = [...document.querySelectorAll("#mkTabs [role=tab]")].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.dataset.tab);
  const visibleMods = [...document.querySelectorAll(".mk-mod")].filter((m) => !m.closest("[inert]") && getComputedStyle(m).visibility !== "hidden" && m.getBoundingClientRect().height > 40).map((m) => m.id);
  const painted = [...document.querySelectorAll(".mk-mod")].filter((m) => getComputedStyle(m).visibility !== "hidden" && m.getBoundingClientRect().height > 40).map((m) => m.id);
  const sub = document.getElementById("mkSub");
  return { sh: d.scrollHeight, ih: innerHeight, sw: d.scrollWidth, iw: innerWidth, clip, panels, sel, view: document.getElementById("mkStage").dataset.view, hash: location.hash, visibleMods, painted, subCount: sub ? sub.children.length : 0, subHidden: sub ? sub.hidden : true };
};

async function sweep(page, label, { phone }) {
  const bad = [];
  for (const t of TABS) {
    await page.click(`#mkT-${t}`);
    await page.waitForTimeout(450);
    const mods = await page.evaluate((k) => [...document.querySelectorAll(`#mkP-${k} > .mk-mod`)].map((m) => m.id), t);
    const rounds = phone ? mods.length : 1;
    for (let i = 0; i < rounds; i++) {
      if (phone && mods.length > 1) {
        const btn = page.locator(`#mkSub button`).nth(i);
        await btn.click();
        await page.waitForTimeout(350);
      }
      let m = await page.evaluate(MEASURE);
      for (let n = 0; n < 6 && m.clip.length; n++) { await page.waitForTimeout(250); m = await page.evaluate(MEASURE); }
      const at = `${label} ${t}${phone && mods.length > 1 ? "/" + mods[i] : ""}`;
      if (m.sh > m.ih + 1) bad.push(`${at}: the page scrolls (${m.sh} against ${m.ih})`);
      if (m.sw > m.iw) bad.push(`${at}: the page scrolls sideways`);
      if (m.clip.length) bad.push(`${at}: content is clipped: ${m.clip.join(", ")}`);
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
    await page.click(`#mkT-${t}`);
    await page.waitForTimeout(350);
    const n = await page.locator(`#mkP-${t} .mk-all:not([hidden])`).count();
    for (let i = 0; i < n; i++) {
      const btn = page.locator(`#mkP-${t} .mk-all:not([hidden])`).nth(i);
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
  await page.focus(`#mkT-${TABS[0]}`);
  await page.keyboard.press("ArrowRight");
  let v = await page.evaluate(() => document.getElementById("mkStage").dataset.view);
  if (v !== TABS[1]) bad.push(`${label}: ArrowRight did not move to ${TABS[1]} (${v})`);
  if (await page.evaluate(() => document.activeElement.id) !== "mkT-" + TABS[1]) bad.push(`${label}: focus did not follow the tab`);
  await page.keyboard.press("End");
  v = await page.evaluate(() => document.getElementById("mkStage").dataset.view);
  if (v !== TABS[TABS.length - 1]) bad.push(`${label}: End did not reach ${TABS[TABS.length - 1]} (${v})`);
  await page.keyboard.press("ArrowRight");
  v = await page.evaluate(() => document.getElementById("mkStage").dataset.view);
  if (v !== TABS[0]) bad.push(`${label}: the tab list does not wrap (${v})`);
  await page.keyboard.press("Home");
  const roving = await page.evaluate(() => [...document.querySelectorAll("#mkTabs [role=tab]")].filter((t) => t.tabIndex === 0).length);
  if (roving !== 1) bad.push(`${label}: ${roving} tabs are in the tab order`);
  return bad;
}

const browser = await launch();

for (const [w, h] of [[1440, 820], [1024, 768], [390, 844]]) {
  const { context, page, errors } = await openMarket(browser, { viewport: { width: w, height: h }, coarse: w < 500 });
  await page.waitForTimeout(2500);
  const phone = w < 900;
  eq(await sweep(page, `${w}`, { phone }), [], `${w}x${h}: EVERY TAB (AND EVERY MODULE ON A PHONE) FITS ONE SCREEN WITH NOTHING CLIPPED AND NO PAGE SCROLL`);
  eq(await allDialogs(page, `${w}`), [], `${w}x${h}: every Show all dialog fits the screen and closes on Escape`);
  eq(await keyboard(page, `${w}`), [], `${w}x${h}: the tab list works from the keyboard`);
  if (w < 500) {
    const small = await page.evaluate(() => [...document.querySelectorAll("#mkTabs button, #mkSub button")].filter((b) => b.getBoundingClientRect().height && b.getBoundingClientRect().height < 43.5).length);
    eq(small, 0, `${w}: tabs and the module switch are 44 px tall`);
  }
  const head = await page.evaluate(() => ({ h1: document.querySelectorAll("h1").length, lv: [...document.querySelectorAll("main h1, main h2")].map((e) => e.tagName) }));
  eq(head.h1, 1, `${w}: one h1`);
  eq(errors, [], `${w}: no page error`);
  await context.close();
}

{
  const { context, page } = await openMarket(browser, { hash: "#view=network" });
  await page.waitForTimeout(1500);
  eq(await page.evaluate(() => document.getElementById("mkStage").dataset.view), "network", "AN ADDRESS WITH #view= OPENS THAT TAB");
  await page.evaluate(() => { location.hash = "#view=prints"; });
  await page.waitForTimeout(300);
  eq(await page.evaluate(() => document.getElementById("mkStage").dataset.view), "prints", "and following another address changes it");
  await page.evaluate(() => { location.hash = "#view=nonsense"; });
  await page.waitForTimeout(300);
  eq(await page.evaluate(() => document.getElementById("mkStage").dataset.view), TABS[0], "an unknown view falls back to the first");
  await context.close();
}

{
  const { context, page, errors } = await openMarket(browser, { scenes: false });
  await page.waitForTimeout(1500);
  eq(await page.evaluate(() => [...document.querySelectorAll("#mkTabs [role=tab]")].map((t) => t.dataset.tab)), TABS.filter((t) => t !== "relations"), "with the scenes switch off there is no Relations tab and no skyline module");
  ok(await page.evaluate(() => !document.getElementById("mkSkylineCard") && !document.getElementById("mkRelationsCard")), "and neither module is in the page");
  eq(errors, [], "no page error without the scenes");
  await context.close();
}

{
  const { context, page, errors } = await openMarket(browser, { reduced: true, viewport: { width: 1024, height: 768 } });
  await page.waitForTimeout(1500);
  eq(await sweep(page, "reduced", { phone: false }), [], "under reduced motion every tab still fits");
  eq(errors, [], "and draws with no page error");
  await context.close();
}

const BELOW = "/assets/js/flows-market-below.js";
async function extremesReach(page, phone) {
  await page.click("#mkT-extremes");
  if (phone) await page.locator("#mkSub button").nth(0).click();
  await page.waitForFunction(() => document.querySelectorAll("#mktMovers .mk-movers-col").length === 4, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const visible = () => page.evaluate(() => [...document.querySelectorAll("#mktMovers .mk-movers-col")]
    .filter((c) => getComputedStyle(c).display !== "none" && c.getBoundingClientRect().height > 0)
    .map((c) => c.querySelector("h3").firstChild.textContent.trim()));
  const seen = new Set(await visible());
  const btns = page.locator("#mkMoversSeg .ui-seg-i");
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    if (!(await btns.nth(i).isVisible())) continue;
    await btns.nth(i).click();
    await page.waitForFunction((k) => { const g = document.querySelector("#mktMovers .mk-movers-grid"); return g && g.dataset.show === String(k); }, i, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(100);
    for (const t of await visible()) seen.add(t);
  }
  return [...seen].sort();
}

for (const [w, h] of [[1920, 1080], [1440, 820], [390, 844]]) {
  const { context, page, errors } = await openMarket(browser, { viewport: { width: w, height: h }, coarse: w < 500, hash: "#view=extremes" });
  eq(await extremesReach(page, w < 900), ["Calls", "Fallers", "Puts", "Risers"], `${w}x${h}: EVERY EXTREMES COLUMN CAN BE REACHED: Risers, Fallers, Calls and Puts, by the switch where only one column fits`);
  eq(errors, [], `${w}: no page error on Extremes`);
  await context.close();
}
{
  const { context, page } = await openMarket(browser, { viewport: { width: 1440, height: 820 }, hash: "#view=extremes", patch: { [BELOW]: [['if (seg) seg.append(UI.segmented("Extreme"', 'if (false) seg.append(UI.segmented("Extreme"']] } });
  const got = await extremesReach(page, false).catch((e) => ["threw " + e.message.split("\n")[0]]);
  ok(got.join() !== "Calls,Fallers,Puts,Risers", `PLANTED WRONG BUILD IS CAUGHT: the Extremes switch never filled leaves only ${got.join(", ")}`);
  await context.close();
}

for (const [w, h] of [[1440, 820], [390, 844]]) {
  const { context, page } = await openMarket(browser, { viewport: { width: w, height: h }, coarse: w < 500, hash: "#view=context" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => new Promise((done) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/css/flows-oracle.css";
    link.onload = done;
    document.head.append(link);
    const orb = document.createElement("div");
    orb.id = "fxOracle";
    orb.className = "orc";
    document.body.append(orb);
  }));
  await page.waitForTimeout(300);
  const bad = [];
  for (const t of TABS) {
    await page.click(`#mkT-${t}`);
    await page.waitForTimeout(250);
    const mods = await page.evaluate((k) => [...document.querySelectorAll(`#mkP-${k} > .mk-mod`)].length, t);
    for (let i = 0; i < (w < 900 ? mods : 1); i++) {
      if (w < 900 && mods > 1) { await page.locator("#mkSub button").nth(i).click(); await page.waitForTimeout(150); }
      const hit = await page.evaluate(() => {
        const o = document.getElementById("fxOracle").getBoundingClientRect();
        return [...document.querySelectorAll(".mk-panel > .mk-mod")].filter((m) => !m.closest("[inert]") && getComputedStyle(m).visibility !== "hidden")
          .filter((m) => { const r = m.getBoundingClientRect(); return r.width && r.left < o.right && o.left < r.right && r.top < o.bottom && o.top < r.bottom; }).map((m) => m.id);
      });
      if (hit.length) bad.push(t + ": " + hit.join(","));
      if ((await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1))) bad.push(t + ": the page scrolls with the orb's corner reserved");
    }
  }
  eq(bad, [], `${w}x${h}: WITH THE ORACLE ORB ON THE PAGE NO MARKET MODULE RUNS UNDER IT, ON ANY TAB, AND THE PAGE STILL DOES NOT SCROLL`);
  await context.close();
}

{
  const { context, page, release } = await openMarket(browser, { viewport: { width: 1440, height: 820 }, hold: true });
  await page.waitForTimeout(800);
  const said = () => [...document.querySelectorAll(".mk-panel > .mk-mod > .mk-body[id]")].filter((b) => !b.children.length && !/Loading/.test(getComputedStyle(b, "::before").content)).map((b) => b.id);
  const waiting = await page.evaluate(() => [...document.querySelectorAll(".mk-panel > .mk-mod > .mk-body[id]")].filter((b) => !b.children.length).length);
  eq(await page.evaluate(said), [], "BEFORE ANY DATA ARRIVES EVERY MODULE BODY SAYS IT IS LOADING, NONE IS AN EMPTY CARD");
  ok(waiting > 0, `and some bodies really are waiting on their data (${waiting})`);
  release();
  await page.waitForFunction(() => ["mkP-tide", "mkP-indices"].every((p) => [...document.querySelectorAll("#" + p + " .mk-body[id]")].every((b) => b.children.length)), null, { timeout: 20000 });
  eq(await page.evaluate(said), [], "and no body is left empty and silent after the data lands");
  ok(true, "and the loading lines give way to the modules once the data has painted them");
  await context.close();
}

const MUTANTS = [
  ["panels stack in the flow and the page scrolls", CSS, [[".mk-panel { position: absolute; inset: 0;", ".mk-panel { position: relative;"]]],
  ["the fitter never runs", JS, [["if (!body || !mod.getBoundingClientRect().height) return;", "return;"]]],
  ["inactive panels stay interactive", JS, [["p.inert = p.dataset.panel !== key;", "p.inert = false;"]]],
  ["inactive panels stay visible", CSS, [["visibility: hidden; min-height: 0; min-width: 0; }", "min-height: 0; min-width: 0; }"]]],
  ["the phone has no module switch", JS, [["subBar.hidden = mods.length < 2;", "subBar.hidden = true;"]]],
  ["the selected tab is never marked", JS, [["x.setAttribute(\"aria-selected\", String(on));", "void on;"]]],
  ["the address is ignored", JS, [["showTab(fromHash(), false, true);\n  addEventListener", "showTab(\"tide\", false, true);\n  addEventListener"]]],
  ["the tab list ignores the keyboard", JS, [["if (to === null) return;", "return;"]]],
  ["every module is shown on the phone", CSS, [[".mk-panel > .mk-mod { position: absolute; inset: 0; visibility: hidden; }", ".mk-panel > .mk-mod { position: absolute; inset: 0; }"]]],
];

for (const [name, file, edits] of MUTANTS) {
  const bad = [];
  for (const [w, h] of [[1024, 768], [390, 844]]) {
    const { context, page } = await openMarket(browser, { viewport: { width: w, height: h }, coarse: w < 500, patch: { [file]: edits }, hash: "#view=network" });
    await page.waitForTimeout(1800);
    try {
      if ((await page.evaluate(() => document.getElementById("mkStage").dataset.view)) !== "network") bad.push(`${w}: the address #view=network did not open the Network tab`);
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
console.log(`flows-market-onescreen: ${checks} checks, ${TABS.length} tabs at 1440x820, 1024x768 and 390x844 with nothing clipped and no page scroll, dialogs, keyboard, the address, and ${MUTANTS.length} planted wrong builds`);
