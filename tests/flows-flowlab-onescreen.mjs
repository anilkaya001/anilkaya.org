import assert from "node:assert/strict";
import { CONTRACT, open, launch, until, settle } from "./lib/flowlab-world.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const SIZES = [[1920, 1080], [1440, 820], [1024, 768], [390, 844]];
const TABS = ["screen", "strikes", "greeks", "ladders", "routing", "lit", "groups", "relations"];

async function sweep(browser, plant, { first = false } = {}) {
  const bad = [];
  for (const [w, h] of SIZES) {
    for (const tab of TABS) {
      const s = await open(browser, { width: w, height: h, url: "/flows/flowlab/#view=" + tab + "&t=SYX101", mutate: plant ? { "flows-flowlab.css": plant } : {} });
      await until(s.page, () => !document.querySelector(".fl-panel[data-on] .fl-wait"), 50);
      await settle(s.page, 400);
      const r = await s.page.evaluate(() => {
        const de = document.documentElement;
        const panel = document.querySelector(".fl-panel[data-on]");
        const inactive = [...document.querySelectorAll(".fl-panel:not([data-on])")];
        const clipped = [];
        for (const el of panel.querySelectorAll(".fl-mod, .fl-body")) {
          const r = el.getBoundingClientRect();
          for (const c of el.children) {
            if (c.hidden || c.offsetParent === null) continue;
            const q = c.getBoundingClientRect();
            if (q.height > 0 && q.bottom > r.bottom + 1.5) clipped.push((el.id || el.className) + ">" + (c.id || c.className));
          }
        }
        return {
          page: de.scrollHeight - innerHeight, side: de.scrollWidth - innerWidth,
          inertOk: inactive.every((p) => p.hasAttribute("inert") && getComputedStyle(p).visibility === "hidden"),
          clipped, cutNotes: [...panel.querySelectorAll(".fl-note")].filter((n) => n.offsetParent !== null && n.scrollHeight > n.clientHeight + 1).map((n) => n.id),
          inner: [...panel.querySelectorAll(".fl-body")].filter((b) => b.scrollHeight > b.clientHeight + 1 && b.offsetParent !== null && !b.querySelector("table[data-what]")).map((b) => b.id),
          errors: 0,
        };
      });
      const tag = tab + "@" + w + "x" + h;
      if (r.page > 1) bad.push(tag + " scrolls the page by " + r.page);
      if (r.side > 1) bad.push(tag + " scrolls sideways by " + r.side);
      if (!r.inertOk) bad.push(tag + " leaves an inactive panel live");
      if (r.clipped.length) bad.push(tag + " clips " + r.clipped.join());
      if (r.cutNotes.length) bad.push(tag + " cuts the note of " + r.cutNotes.join());
      if (r.inner.length) bad.push(tag + " hides content in " + r.inner.join());
      if (s.log.errors.length) bad.push(tag + " page error " + s.log.errors[0]);
      await s.close();
      if (first && bad.length) return bad;
    }
  }
  return bad;
}

async function keyboard(browser) {
  const bad = [];
  const s = await open(browser, { width: 1440, height: 820 });
  await until(s.page, () => !!document.querySelector("#flScreenB tbody tr"));
  await s.page.focus('.fl-tab[data-view="screen"]');
  await s.page.keyboard.press("ArrowRight");
  await settle(s.page, 200);
  let v = await s.page.evaluate(() => document.querySelector(".fl-panel[data-on]").getAttribute("data-view"));
  if (v !== "strikes") bad.push("ArrowRight went to " + v);
  await s.page.keyboard.press("End");
  await settle(s.page, 200);
  v = await s.page.evaluate(() => document.querySelector(".fl-panel[data-on]").getAttribute("data-view"));
  if (v !== "relations") bad.push("End went to " + v);
  await s.page.keyboard.press("Home");
  await settle(s.page, 200);
  v = await s.page.evaluate(() => document.querySelector(".fl-panel[data-on]").getAttribute("data-view"));
  if (v !== "screen") bad.push("Home went to " + v);
  await s.close();
  return bad;
}

async function showAll(browser) {
  const bad = [];
  const s = await open(browser, { width: 1024, height: 700, url: "/flows/flowlab/#view=lit" });
  await until(s.page, () => !!document.querySelector("#flLitMarketB tbody tr"));
  await settle(s.page, 400);
  const r = await s.page.evaluate(() => {
    const m = document.getElementById("flLitMarketM");
    const rows = document.querySelectorAll("#flLitMarketB tbody tr");
    return { shown: [...rows].filter((q) => !q.hidden).length, all: rows.length, btn: m && !m.hidden };
  });
  if (r.all > r.shown && !r.btn) bad.push("rows are hidden and Show all is not offered");
  if (r.btn) {
    await s.page.click("#flLitMarketM");
    await settle(s.page, 200);
    const d = await s.page.evaluate(() => ({ open: document.getElementById("flAll").open, rows: document.querySelectorAll("#flAllB tbody tr").length }));
    if (!d.open || d.rows !== r.all) bad.push("Show all holds " + d.rows + " of " + r.all);
    await s.page.keyboard.press("Escape");
  }
  await s.close();
  return bad;
}

const browser = await launch();
try {
  const a = await sweep(browser, null);
  ok(a.length === 0, "layout: " + a.slice(0, 6).join("; "));
  const k = await keyboard(browser);
  ok(k.length === 0, "keyboard: " + k.join("; "));
  const t = await showAll(browser);
  ok(t.length === 0, "show all: " + t.join("; "));
  const grow = (src) => src + "\n.fl-body { min-height: 2400px; }\n";
  const p1 = await sweep(browser, grow, { first: true });
  ok(p1.length > 0, "planted build 43 (modules taller than the stage) survived");
  const loose = (src) => src.replace(".fl-panel { grid-area: 1 / 1;", ".fl-panel { grid-area: auto;");
  const p2 = await sweep(browser, loose, { first: true });
  ok(p2.length > 0, "planted build 44 (panels not stacked) survived");
  const live = (src) => src.replace(".fl-panel { grid-area: 1 / 1; min-height: 0; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; visibility: hidden; }", ".fl-panel { grid-area: 1 / 1; min-height: 0; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; visibility: visible; }");
  const p3 = await sweep(browser, live, { first: true });
  ok(p3.length > 0, "planted build 45 (inactive panels visible) survived");
  const short = (src) => src.replace("  .fl-note { max-height: 5.2em; }\n", "");
  const p4 = await sweep(browser, short, { first: true });
  ok(p4.some((b) => / cuts the note of /.test(b)), "planted build 94 (phone notes held to three lines) survived: " + p4.join("; "));
} finally {
  await browser.close();
}
console.log("flows-flowlab-onescreen: " + checks + " checks");
