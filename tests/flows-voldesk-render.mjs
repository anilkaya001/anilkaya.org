import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { openVd, payloadFor, VIEWPORTS, ROOT } from "./lib/voldesk-world.mjs";
import { COPY } from "../shared/flows-voldesk-copy.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const browser = await launch();

const geometry = (page) => page.evaluate(() => {
  const el = document.documentElement;
  const panel = document.getElementById("mkP-voldesk");
  const box = (n) => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const mods = ["mkVdTermCard", "mkVdIvrvCard", "mkVdCorrCard", "mkVdCharCard"].map((id) => { const n = document.getElementById(id); return [id, n ? box(n) : null, n ? getComputedStyle(n).display : null]; });
  const stage = box(document.getElementById("mkStage"));
  const clipped = [...panel.querySelectorAll("*")].filter((e) => !e.closest("svg") && getComputedStyle(e).overflow === "hidden" && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1).map((e) => e.className);
  const leaving = [...panel.querySelectorAll(".mk-mod, .ui-mod")].filter((m) => m.offsetParent !== null).map((m) => {
    const mb = m.getBoundingClientRect();
    return [...m.querySelectorAll("*")].filter((e) => e.offsetParent !== null && !e.closest("dialog") && e.getBoundingClientRect().height > 0 && (e.getBoundingClientRect().bottom > mb.bottom + 1 || e.getBoundingClientRect().right > mb.right + 1)).length;
  });
  return { scrollH: el.scrollHeight, innerH: innerHeight, scrollW: el.scrollWidth, innerW: innerWidth, mods, stage, clipped, leaving, view: document.getElementById("mkStage").dataset.view };
});

for (const [w, h] of VIEWPORTS) {
  const { page, context, errors } = await openVd(browser, { kind: "ok", viewport: { width: w, height: h } });
  await page.waitForSelector("#mkVdTerm svg", { timeout: 15000 });
  await page.waitForTimeout(400);
  const g = await geometry(page);
  eq(g.view, "voldesk", `${w}: the hash opens the Vol desk`);
  ok(g.scrollH <= g.innerH + 1, `${w}: no page scroll (${g.scrollH} vs ${g.innerH})`);
  ok(g.scrollW <= g.innerW + 1, `${w}: no sideways scroll`);
  eq(g.clipped, [], `${w}: nothing clipped by its own box`);
  const shown = g.mods.filter(([, b, d]) => b && d !== "none");
  ok(shown.length >= 1, `${w}: a module is shown`);
  for (const [id, b] of shown) ok(b[0] >= g.stage[0] - 1 && b[2] <= g.stage[2] + 1 && b[3] <= g.stage[3] + 1, `${w}: ${id} sits inside the stage`);
  eq(page.vdRequests, ["/api/flows/voldesk"], `${w}: exactly one request for the desk`);
  eq(errors, [], `${w}: no page error`);
  const text = await page.evaluate(() => document.getElementById("mkP-voldesk").innerText);
  ok(!/vendor|tape|unusual whales/i.test(text), `${w}: no forbidden word in the served text`);
  ok(!/\bNaN\b|\bundefined\b|\bnull\b|\[object/.test(text), `${w}: no leaked placeholder`);
  if (w >= 1024) {
    const term = await page.evaluate(() => {
      const svg = document.querySelector("#mkVdTerm svg");
      return { circles: svg.querySelectorAll("circle, .vd-pt").length, label: (document.querySelector("#mkVdTerm .vd-chart") || svg).getAttribute("aria-label") || "", role: svg.getAttribute("role") };
    });
    ok(term.circles > 0, `${w}: the term chart draws points`);
    ok(term.label.length > 0, `${w}: the chart carries a spoken label`);
  }
  await context.close();
}

const probe = (page) => page.evaluate(() => {
  const rects = [...document.querySelectorAll("#mkVdCorr rect.vd-cell")];
  const texts = [...document.querySelectorAll("#mkVdCorr text.vd-val")];
  const vals = texts.map((t) => t.textContent.trim());
  const onNull = rects.filter((r) => r.classList.contains("vd-null")).filter((r) => texts.some((t) => Math.abs(Number(t.getAttribute("x")) - (Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2)) < 1 && Math.abs(Number(t.getAttribute("y")) - (Number(r.getAttribute("y")) + Number(r.getAttribute("height")) / 2 + 3.5)) < 1)).length;
  return { onNull, rects: rects.length, nulls: rects.filter((r) => r.classList.contains("vd-null")).length, vals, tabs: rects.filter((r) => r.getAttribute("tabindex") === "0").length, html: document.getElementById("mkP-voldesk").outerHTML };
});
const matrixWorld = async (patch) => {
  const { page, context } = await openVd(browser, { kind: "asym", viewport: { width: 1920, height: 1080 }, patch });
  await page.waitForSelector("#mkVdCorr rect.vd-cell", { timeout: 15000 });
  const r = await probe(page);
  const requests = page.vdRequests.length;
  return { page, context, r, requests };
};
const faults = (r, requests) => {
  const out = [];
  if (r.onNull > 0 || r.vals.length > r.rects - r.nulls) out.push("null-printed");
  if (!r.vals.every((v) => /^[−+]?\d\.\d\d$/.test(v))) out.push("format");
  if (/vendor|\btape\b/i.test(r.html)) out.push("forbidden");
  if (r.tabs !== 1) out.push("tabstop");
  if (requests !== 1) out.push("requests");
  return out;
};
{
  const { page, context, r, requests } = await matrixWorld(undefined);
  eq(faults(r, requests), [], "the real build passes every matrix check");
  ok(r.rects > 0 && r.nulls > 0 && r.vals.length > 0, "the matrix draws cells, some null, and prints the others");
  await page.focus("#mkVdCorr rect.vd-cell[tabindex='0']");
  await page.keyboard.press("ArrowLeft");
  const moved = await page.evaluate(() => (document.activeElement.closest("#mkVdCorr") ? document.activeElement.getAttribute("role") : "outside:" + document.activeElement.tagName));
  eq(moved, "gridcell", "arrow keys keep focus on a cell");
  await context.close();
}

const STATES = [
  ["pending", COPY["state.pending"] || null],
  ["unshaped", null],
  ["plan", null],
  ["failed", null],
];
for (const [kind] of STATES) {
  const { page, context, errors } = await openVd(browser, { kind, viewport: { width: 1440, height: 820 } });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({ text: document.getElementById("mkP-voldesk").innerText, fig: document.querySelectorAll("#mkP-voldesk .vd-cell:not(.vd-null)").length }));
  ok(info.text.length > 0, `${kind}: the desk says something`);
  ok(!/\bNaN\b|\bnull\b|undefined/.test(info.text), `${kind}: no placeholder leaks`);
  ok(!/vendor|tape/i.test(info.text), `${kind}: no forbidden word`);
  eq(errors, [], `${kind}: no page error`);
  await context.close();
}

{
  const { page, context } = await openVd(browser, { kind: "ok", status: 404, payload: { error: { code: "voldesk_off" } }, viewport: { width: 1440, height: 820 } });
  await page.waitForTimeout(1200);
  const text = await page.evaluate(() => document.getElementById("mkP-voldesk").innerText);
  ok(!/\bnull\b|NaN/.test(text), "a refused read prints no placeholder");
  await context.close();
}

{
  const sentences = Object.values(COPY).filter((v) => typeof v === "string");
  for (const s of sentences) {
    ok(s.split(/\s+/).length <= 14 || /\{/.test(s) || s.length < 5, `copy sentence within 14 words: ${s.slice(0, 40)}`);
    ok(!/vendor|\btape\b|unusual whales/i.test(s), `copy: no forbidden word in ${s.slice(0, 40)}`);
  }
  const served = await (async () => {
    const { page, context } = await openVd(browser, { kind: "ok" });
    await page.waitForSelector("#mkVdTerm svg", { timeout: 15000 });
    const c = await page.evaluate(() => JSON.stringify(window.FlowsUI.volDesk.copy));
    await context.close();
    return JSON.parse(c);
  })();
  const whole = JSON.parse(JSON.stringify(COPY));
  eq(Object.fromEntries(Object.keys(served).map((k) => [k, whole[k]])), served, "every served sentence equals the shared one");
  ok(Object.keys(served).length > 20, "and the desk serves its sentences");
}

{
  const css = fs.readFileSync(path.join(ROOT, "assets/css/flows-voldesk.css"), "utf8");
  ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), "the sheet uses tokens only, no colour literal");
  const js = fs.readFileSync(path.join(ROOT, "assets/js/flows-voldesk.js"), "utf8");
  ok(!/innerHTML/.test(js), "the controller writes text and never markup");
}

{
  const JS = "/assets/js/flows-voldesk.js";
  const planted = [
    ["null cell printed as 0.00", [['class: "vd-cell vd-null" }));', 'class: "vd-cell vd-null" }), svg("text", { x: x + c / 2, y: y + c / 2 + 3.5, class: "vd-val vd-vb0", "text-anchor": "middle" }, document.createTextNode("0.00")));']], "null-printed"],
    ["value printed to one decimal", [["F.px(Math.abs(x), 2)", "F.px(Math.abs(x), 1)"]], "format"],
    ["forbidden word in the served markup", [["use the arrow keys to step through points", "vendor arrow keys"]], "forbidden"],
    ["second request for the same read", [["const sgn =", 'fetch("/api/flows/voldesk"); const sgn =']], "requests"],
  ];
  for (const [name, edits, named] of planted) {
    const patch = { [JS]: edits };
    const { context, r, requests } = await matrixWorld(patch);
    ok(faults(r, requests).includes(named), `PLANTED ${name}: fails "${named}"`);
    await context.close();
  }
}

await browser.close();
console.log(`flows-voldesk-render: ${checks} assertions`);
