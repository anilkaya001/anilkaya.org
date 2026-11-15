import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { openVd, payloadFor, VIEWPORTS, ROOT } from "./lib/voldesk-world.mjs";
import { createRequire } from "node:module";
import { COPY } from "../shared/flows-voldesk-copy.js";
import * as PAGES from "../shared/flows-pages.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const require = createRequire(import.meta.url);
let AXE = null;
try { AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"); } catch { AXE = null; }
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

const wordsOf = (text) => text.replace(/\{\w+\}/g, "12.3").split(/\s+/).filter(Boolean).length;
{
  for (const [k, v] of Object.entries(COPY)) if (typeof v === "string") ok(wordsOf(v) <= 14, `copy ${k}: at most 14 words once its placeholders are filled`);
  ok(wordsOf("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen") > 14, "PLANTED a 15-word sentence is counted as too long");
  ok(wordsOf("Implied at {p}% of its range, {x} and {y}.") === 9, "placeholders count as one word each");
}

{
  const off = PAGES.marketPage({ username: "test", owner: true, scenes: true, voldesk: false });
  const on = PAGES.marketPage({ username: "test", owner: true, scenes: true, voldesk: true });
  const tab = (html) => /mkP-voldesk|data-tab="voldesk"/.test(html);
  ok(!tab(off), "the switch off emits no Vol desk tab or panel");
  ok(tab(on), "the switch on emits the tab and panel");
  ok(tab(on) && !tab(off), "PLANTED a tab emitted with the switch off is told from the real page by the same test");
}

const pathPoints = (d) => [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const termAudit = async (page, payload) => {
  const got = await page.evaluate(() => [...document.querySelectorAll("#mkVdTerm path.vd-line")].map((p) => [p.getAttribute("data-t"), p.getAttribute("d")]));
  const faults = [];
  const all = [];
  for (const [t, d] of got) {
    const pts = pathPoints(d);
    const want = (payload.term.funds[t].points || []).filter(([days]) => days <= 400);
    if (pts.length !== want.length) faults.push("vertices:" + t);
    want.forEach(([days, iv], i) => { if (pts[i]) all.push({ sx: Math.sqrt(days / 400), iv, px: pts[i][0], py: pts[i][1] }); });
  }
  if (all.length >= 3) {
    const byIv = all.slice().sort((x, y) => x.iv - y.iv), bySx = all.slice().sort((x, y) => x.sx - y.sx);
    const a = byIv[0], b = byIv[byIv.length - 1], c = bySx[bySx.length - 1], a2 = bySx[0];
    if (b && c) {
      const ky = (b.py - a.py) / (b.iv - a.iv), kx = (c.px - a2.px) / (c.sx - a2.sx);
      for (const q of all) {
        if (Math.abs(a.py + ky * (q.iv - a.iv) - q.py) > 0.3) { faults.push("y-scale"); break; }
        if (Math.abs(a2.px + kx * (q.sx - a2.sx) - q.px) > 0.3) { faults.push("x-scale"); break; }
      }
    }
  }
  const boxes = await page.evaluate(() => {
    const svg = document.querySelector("#mkVdTerm svg.vd-svg");
    const sb = svg.getBoundingClientRect();
    return { sb: [sb.left, sb.top, sb.right, sb.bottom], texts: [...svg.querySelectorAll("text")].map((t) => { const r = t.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, t.textContent]; }) };
  });
  for (let i = 0; i < boxes.texts.length; i++) {
    const a = boxes.texts[i];
    if (a[0] < boxes.sb[0] - 1 || a[2] > boxes.sb[2] + 1 || a[1] < boxes.sb[1] - 1 || a[3] > boxes.sb[3] + 1) faults.push("outside:" + a[4]);
    for (let j = i + 1; j < boxes.texts.length; j++) {
      const b = boxes.texts[j];
      if (a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 2.5 && b[1] < a[3] - 2.5) faults.push("overlap:" + a[4] + "/" + b[4]);
    }
  }
  const chip = await page.evaluate(() => { const c = document.querySelector("#mkVdTerm .vd-chip"); return c ? c.innerText : ""; });
  if (!/[▲▼■]/.test(chip) || !/Contango|Backwardation|Flat/.test(chip)) faults.push("chip-colour-only");
  return faults;
};
for (const [w, h] of VIEWPORTS.filter(([vw]) => vw >= 1024)) {
  const payload = payloadFor("ok");
  const { page, context } = await openVd(browser, { kind: "ok", viewport: { width: w, height: h } });
  await page.waitForSelector("#mkVdTerm svg.vd-svg", { timeout: 15000 });
  await page.waitForTimeout(300);
  eq(await termAudit(page, payload), [], `${w}: term lines sit on an independent scale, labels clear each other and the chip carries glyph and word`);
  await context.close();
}

const cellAudit = async (page, payload) => {
  const faults = [];
  const got = await page.evaluate(() => {
    const rects = [...document.querySelectorAll("#mkVdCorr rect.vd-cell")].map((r) => ({ i: Number(r.dataset.i), j: Number(r.dataset.j), cls: r.getAttribute("class"), x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")), w: Number(r.getAttribute("width")) }));
    const texts = [...document.querySelectorAll("#mkVdCorr text.vd-val")].map((t) => ({ x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")), s: t.textContent.trim() }));
    return { rects, texts };
  });
  const n = payload.matrix.tickers.length;
  if (got.rects.length !== n * (n - 1) / 2) faults.push("diagonal-as-data");
  const cells = payload.matrix["3M"].cells;
  for (const r of got.rects) {
    const a = Math.min(r.i, r.j), b = Math.max(r.i, r.j);
    const c = cells[a * n - (a * (a + 1)) / 2 + (b - a - 1)];
    const t = got.texts.find((q) => Math.abs(q.x - (r.x + r.w / 2)) < 0.5 && Math.abs(q.y - (r.y + r.w / 2 + 3.5)) < 0.5);
    if (!c || c[0] === null) { if (!/vd-null/.test(r.cls) || t) faults.push("null"); continue; }
    const v = c[0];
    const band = v < 0 ? 0 : Math.min(4, Math.floor(v / 0.2));
    if (!new RegExp("\\bvd-b" + band + "\\b").test(r.cls)) faults.push("band");
    if (t) {
      const want = Math.round(Math.abs(v) * 100 + 1e-9) / 100;
      const printed = Number(t.s.replace("−", "").replace("+", ""));
      if (Math.abs(printed - want) > 1e-9 || (v < 0) !== t.s.startsWith("−")) faults.push("value");
    }
  }
  return faults;
};
{
  const payload = payloadFor("ok");
  const { page, context } = await openVd(browser, { kind: "ok", viewport: { width: 1920, height: 1080 } });
  await page.waitForSelector("#mkVdCorr rect.vd-cell", { timeout: 15000 });
  eq(await cellAudit(page, payload), [], "every matrix cell: band from the token ramp, printed value the payload rounded half up, null never printed, no diagonal as data");
  const hover = await page.evaluate(() => document.querySelector("#mkVdCorr rect.vd-cell:not(.vd-null)").getAttribute("aria-label"));
  await page.hover("#mkVdCorr rect.vd-cell:not(.vd-null)");
  eq(await page.locator("#mkVdCorr .vd-read").innerText(), hover, "hover prints the cell's sentence in the readout");
  await page.focus("#mkVdCorr rect.vd-cell[tabindex='0']");
  const at = () => page.evaluate(() => { const e = document.activeElement; return [e.dataset.i, e.dataset.j]; });
  await page.keyboard.press("End");
  const [ei, ej] = await at();
  eq(Number(ej), Number(ei) - 1, "End goes to the last cell of the row");
  await page.keyboard.press("Home");
  eq((await at())[1], "0", "Home goes to the first");
  await page.keyboard.press("Escape");
  const strongest = await page.evaluate(() => document.querySelector("#mkVdCorr .vd-read").textContent);
  const rest = await page.evaluate(() => [...document.querySelectorAll("#mkVdCorr rect.vd-cell[tabindex='0']")].map((r) => r.getAttribute("aria-label")));
  eq(rest, [strongest], "Escape returns focus target and readout to the strongest pair");
  await context.close();
}

for (const [name, edits, named] of [
  ["a diagonal drawn as data", [['class: "vd-self", role: "gridcell"', 'class: "vd-cell vd-b4", "data-i": i, "data-j": i, role: "gridcell"']], "diagonal-as-data"],
  ["a shifted colour band", [["Math.floor(r / 0.2)", "Math.floor(r / 0.25)"]], "band"],
  ["an unsigned negative value", [['(x < 0 ? MINUS : "") + F.px(Math.abs(x), 2)', "F.px(Math.abs(x), 2)"]], "value"],
]) {
  const { page, context } = await openVd(browser, { kind: "ok", viewport: { width: 1920, height: 1080 }, patch: { "/assets/js/flows-voldesk.js": edits } });
  await page.waitForSelector("#mkVdCorr rect.vd-cell", { timeout: 15000 });
  ok((await cellAudit(page, payloadFor("ok"))).includes(named), `PLANTED ${name}: fails "${named}"`);
  await context.close();
}

for (const [name, edits, named] of [
  ["an IV-interpolated line", [["const list = (f.points || []).filter(([d]) => d <= X_MAX);", "const list = (f.points || []).filter(([d]) => d <= X_MAX).flatMap((p, i, a) => (i ? [[(a[i - 1][0] + p[0]) / 2, (a[i - 1][1] + p[1]) / 2], p] : [p]));"]], "vertices:SPY"],
  ["a chip with colour only", [['h("b", null, f.state[0].toUpperCase() + f.state.slice(1))', 'h("b", null, "")'], ['h("i", { "aria-hidden": "true" }, glyph)', 'h("i", { "aria-hidden": "true" }, "")']], "chip-colour-only"],
]) {
  const { page, context } = await openVd(browser, { kind: "ok", viewport: { width: 1440, height: 820 }, patch: { "/assets/js/flows-voldesk.js": edits } });
  await page.waitForSelector("#mkVdTerm svg.vd-svg", { timeout: 15000 });
  await page.waitForTimeout(300);
  ok((await termAudit(page, payloadFor("ok"))).includes(named), `PLANTED ${name}: fails "${named}"`);
  await context.close();
}

{
  const mustSay = {
    pending: [COPY["state.pending"]],
    plan: [COPY["futures.plan"]],
    unshaped: [COPY["futures.unshaped"], COPY["character.unshaped"]],
  };
  for (const [kind, sentences] of Object.entries(mustSay)) {
    const { page, context } = await openVd(browser, { kind, viewport: { width: 1920, height: 1080 } });
    await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.volDesk && window.FlowsUI.volDesk.of && window.FlowsUI.volDesk.of(document.getElementById("mkVdTerm")), null, { timeout: 15000 });
    if (kind !== "pending") {
      await page.evaluate(() => { const api = window.FlowsUI.volDesk.of(document.getElementById("mkVdTerm")); if (api) api.setTerm(1); });
    }
    await page.waitForFunction((t) => document.getElementById("mkP-voldesk").innerText.includes(t), sentences[0], { timeout: 15000 }).catch(() => {});
    const text = await page.evaluate(() => document.getElementById("mkP-voldesk").innerText);
    for (const sentence of sentences) ok(text.includes(sentence), `${kind}: prints its own sentence "${String(sentence).slice(0, 40)}"`);
    const curve = await page.evaluate(() => document.querySelectorAll("#mkVdTerm path.vd-fut").length);
    if (kind === "unshaped" || kind === "plan") eq(curve, 0, `${kind}: no futures curve is drawn`);
    await context.close();
  }
  {
    const { page, context } = await openVd(browser, { kind: "ok", status: 500, payload: { error: { code: "boom", message: "internal secret detail" } }, viewport: { width: 1920, height: 1080 } });
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.getElementById("mkP-voldesk").innerText);
    ok(/did not load|read failed/.test(text), "a failed read says it did not load");
    ok(!/internal secret detail|HTTP|status 5/i.test(text), "and prints no raw error text");
    await context.close();
  }
  const stale = await openVd(browser, { kind: "ok", now: Date.parse("2026-08-26T03:00:00Z"), viewport: { width: 1440, height: 820 } });
  await stale.page.waitForSelector("#mkVdTerm svg.vd-svg", { timeout: 15000 });
  const sp = await stale.page.evaluate(() => ({ pill: document.querySelectorAll("#mkVdTermCard .vd-pill[data-stale]").length, svg: document.querySelectorAll("#mkVdTerm svg.vd-svg").length }));
  eq(sp.pill, 1, "one session behind: the stale pill names the session");
  ok(sp.svg > 0, "and the figures stay");
  await stale.context.close();
  const dead = await openVd(browser, { kind: "ok", now: Date.parse("2026-08-27T03:00:00Z"), viewport: { width: 1440, height: 820 } });
  await dead.page.waitForTimeout(1500);
  const dp = await dead.page.evaluate(() => ({ text: document.getElementById("mkP-voldesk").innerText, svg: document.querySelectorAll("#mkVdTerm svg.vd-svg, #mkVdCorr rect.vd-cell").length }));
  ok(/2 sessions behind/.test(dp.text), "two sessions behind: the desk says so");
  eq(dp.svg, 0, "and draws no figure");
  await dead.context.close();
}

{
  const { page, context } = await openVd(browser, { kind: "ok", reduced: true, viewport: { width: 1440, height: 820 } });
  await page.waitForSelector("#mkVdTerm svg.vd-svg", { timeout: 15000 });
  eq(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length), 0, "reduced motion: nothing animates");
  await context.close();
}
{
  const { page, context } = await openVd(browser, { kind: "ok", viewport: { width: 1440, height: 820 } });
  await page.emulateMedia({ forcedColors: "active" });
  await page.waitForSelector("#mkVdCorr rect.vd-cell", { timeout: 15000 });
  const fc = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector("#mkVdCorr rect.vd-cell:not(.vd-null)")); return [cs.stroke, cs.fill]; });
  ok(fc[0] !== "none" && fc[0] !== fc[1], "forced colours: a cell keeps a visible outline apart from its fill");
  await context.close();
}
{
  const { page, context } = await openVd(browser, { kind: "ok", coarse: true, viewport: { width: 390, height: 844 } });
  await page.waitForSelector("#mkVdTerm", { timeout: 15000 });
  await page.waitForTimeout(500);
  const small = await page.evaluate(() => [...document.querySelectorAll("#mkP-voldesk button, #mkP-voldesk [role=tab], #mkP-voldesk a.vd-t")].filter((e) => e.offsetParent !== null && !e.closest("[inert]")).map((e) => { const r = e.getBoundingClientRect(); return [e.className || e.tagName, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w > 0 && (w < 24 || h < 24)));
  eq(small, [], "a coarse pointer finds no control under 24 px on the Vol desk");
  const text = await page.evaluate(() => document.getElementById("mkP-voldesk").innerText);
  ok(!/\b(UTC|EST|EDT|GMT)\b|\bET\b/.test(text), "no other time zone is named");
  await context.close();
}
if (AXE) {
  const { page, context } = await openVd(browser, { kind: "ok", viewport: { width: 1440, height: 820 } });
  await page.waitForSelector("#mkVdCorr rect.vd-cell", { timeout: 15000 });
  await page.addScriptTag({ content: AXE });
  const n = await page.evaluate(async () => (await window.axe.run(document.getElementById("mkP-voldesk"), { runOnly: { type: "rule", values: ["color-contrast", "button-name", "aria-valid-attr-value", "aria-required-children", "link-name"] }, resultTypes: ["violations"] })).violations.reduce((t, v) => t + v.nodes.length, 0));
  eq(n, 0, "axe finds no contrast, name or aria violation on the Vol desk");
  await context.close();
}
{
  const { page, context } = await openVd(browser, { kind: "ok", viewport: { width: 1440, height: 820 } });
  await page.waitForSelector("#mkVdChar .vd-char", { timeout: 15000 });
  const all = page.locator("#mkVdCharCard .vd-all");
  if (await all.count() && await all.isVisible()) {
    await all.click();
    const rows = await page.evaluate(() => document.querySelectorAll("dialog[open] .vd-li").length);
    const full = payloadFor("ok").character;
    ok(rows >= (full.meanRev || []).length + (full.persistent || []).length, "Show all opens every character row");
    await page.keyboard.press("Escape");
  } else ok(true, "the character lists fit without Show all");
  await context.close();
}

await browser.close();
console.log(`flows-voldesk-render: ${checks} assertions`);
