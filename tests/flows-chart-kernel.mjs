import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { launch } from "./lib/browser.mjs";
import { ORIGIN, pageHtml, serve } from "./lib/chart-page.mjs";
import { CASES_SRC } from "./fixtures-chart-kernel.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, "fixtures-chart-kernel.json");
const WRITE = process.env.CHART_GOLDEN === "write";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const browser = await launch();
const errors = [];

const SERIALIZE = String.raw`
window.ser = (n) => {
  if (n.nodeType === 3) return n.textContent;
  if (n.nodeType !== 1) return "";
  const a = [...n.attributes].map((x) => x.name + "=" + JSON.stringify(x.value)).sort().join(" ");
  return "<" + n.localName + (a ? " " + a : "") + ">" + [...n.childNodes].map(window.ser).join("") + "</" + n.localName + ">";
};
`;

async function open(width, extra = "", full = false) {
  const page = await browser.newPage({ viewport: { width: Math.max(width + 16, 320), height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await serve(page, pageHtml({ width, full, extra: `<script>${SERIALIZE}</script><script>${CASES_SRC}</script>${extra}` }));
  await page.goto(ORIGIN + "/chart");
  await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.chart && window.CASES);
  return page;
}

const KEYS = { "line-dates": "End", "line-twotone": "ArrowLeft", "bars": "End", "diverging-index": "End", "diverging-number": "Home", "payoff-host": "End", "heatmap": "ArrowRight" };

async function snapshot(name, width) {
  const page = await open(width);
  const out = await page.evaluate(async ({ name }) => {
    const C = window.FlowsUI.chart;
    const stage = document.getElementById("stage");
    if (window.FREE[name]) {
      const node = window.FREE[name](C);
      stage.append(node);
      return { html: window.ser(node), after: null };
    }
    const host = document.createElement("div");
    host.className = "host";
    stage.append(host);
    const handle = window.CASES[name](C, host);
    for (let i = 0; i < 60 && !(handle.el._fxChart && handle.el._fxChart.drawn); i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 60));
    return { html: window.ser(host), after: null };
  }, { name });
  if (KEYS[name]) {
    const sel = ".host";
    await page.focus(sel);
    await page.keyboard.press(KEYS[name]);
    await page.waitForTimeout(80);
    out.after = await page.evaluate(() => window.ser(document.querySelector(".host")));
  }
  await page.close();
  return out;
}

const names = await (async () => {
  const page = await open(640);
  const list = await page.evaluate(() => [...Object.keys(window.CASES), ...Object.keys(window.FREE)]);
  await page.close();
  return list;
})();

const golden = WRITE ? {} : JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
const next = {};
for (const name of names) {
  for (const width of [390, 960]) {
    const key = name + "@" + width;
    const got = await snapshot(name, width);
    next[key] = got;
    if (WRITE) continue;
    ok(golden[key] !== undefined, `${key} has a recorded snapshot`);
    eq(got.html, golden[key].html, `${key}: every v1 call renders the same marks (node and attribute snapshot)`);
    eq(got.after, golden[key].after, `${key}: and the same readout after the key press`);
  }
}
if (WRITE) {
  fs.writeFileSync(GOLDEN, JSON.stringify(next, null, 1) + "\n");
  console.log("wrote " + Object.keys(next).length + " snapshots");
}


const PLOT_SRC = String.raw`
window.mkHost = (id) => { const d = document.createElement("div"); d.className = "host"; d.id = id; document.getElementById("stage").append(d); return d; };
window.settle = async (hd) => { for (let i = 0; i < 80 && !(hd.el._fxChart && hd.el._fxChart.drawn); i++) await new Promise((r) => setTimeout(r, 25)); await new Promise((r) => setTimeout(r, 60)); };
window.MONEY = (v) => window.FlowsUI.F.unit("moneyCompact", v, { dp: "short", signed: true });
window.V = [1.3e6, -2.1e6, -6.0e6, 0, 3e6, null, 2e6, -4.2e6];
window.T = ["9:30", "9:45", "10:00", "10:15", "10:30", "10:45", "11:00", "11:15"];
`;

{
  const page = await open(640, `<script>${PLOT_SRC}</script>`, true);
  const first = await page.evaluate(async () => {
    const C = window.FlowsUI.chart, F = window.FlowsUI.F;
    const el = window.mkHost("a");
    const hd = C.plot(el, { kind: "line", label: "Net premium", series: [{ values: window.V, format: window.MONEY }], x: window.T, yFormat: window.MONEY, table: true,
      provenance: { grade: 2, why: "Two sources agree", asOf: "As of 11:15 ET", convention: "Calls minus puts" } });
    await window.settle(hd);
    const svg = el.querySelector("svg");
    const desc = el.querySelector(".visually-hidden");
    const box = el.nextElementSibling;
    const out = {
      description: hd.describe(), hidden: desc && desc.textContent, describedBy: el.getAttribute("aria-describedby"), descId: desc && desc.id,
      segments: svg.querySelectorAll("path.ln").length,
      prov: el.querySelector(".ui-prov") && el.querySelector(".ui-prov").textContent, provWhy: el.querySelector(".ui-prov-g") && el.querySelector(".ui-prov-g").title,
      hasBox: !!(box && box.classList.contains("ui-tbl")), wrapHidden: box && box.querySelector(".ui-tbl-w").hidden,
      expanded0: box && box.querySelector("button").getAttribute("aria-expanded"),
      animations: svg.getAnimations({ subtree: true }).length,
    };
    box.querySelector("button").click();
    const rows = [...box.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent));
    out.expanded1 = box.querySelector("button").getAttribute("aria-expanded");
    out.wrapShown = !box.querySelector(".ui-tbl-w").hidden;
    out.rows = rows;
    out.head = [...box.querySelectorAll("thead th")].map((c) => c.textContent);
    out.noAscii = rows.flat().every((c) => !/^-/.test(c));
    hd.update({ series: [{ values: window.V.map((v, i) => (i === 7 ? 9e6 : v)), format: window.MONEY }] });
    out.updated = [...box.querySelectorAll("tbody tr")].pop().lastElementChild.textContent;
    box.querySelector("button").click();
    out.wrapHidden2 = box.querySelector(".ui-tbl-w").hidden;
    hd.destroy();
    out.boxGone = !box.isConnected;
    return out;
  });
  eq(first.description, "Net premium, 9:30 to 11:15. Net premium: last −$4.2M at 11:15; low −$6.0M at 10:00; high +$3.0M at 10:30.",
    "plot: the description names the plot, its window, and the last value with its unit and time, then the low and high with theirs; negatives carry U+2212");
  eq(first.hidden, first.description, "and it sits in a visually hidden element");
  ok(first.descId && first.describedBy === first.descId, "referenced from the chart host by aria-describedby");
  eq(first.segments, 2, "a gap is not zero: the null reading splits the line into two paths rather than dipping to the axis");
  ok(!/no readings/.test(first.description) && !/\$0\b.*low/.test(first.description), "and the zero reading is not mistaken for the low");
  eq(first.prov, "Grade 2As of 11:15 ETCalls minus puts", "the provenance footer carries the grade, the as-of and the convention");
  eq(first.provWhy, "Two sources agree", "and the grade's reason on its title");
  ok(first.hasBox && first.wrapHidden === true && first.expanded0 === "false", "the table view is a sibling toggle, closed until asked");
  ok(first.wrapShown && first.expanded1 === "true", "opening it shows the table and flips aria-expanded");
  eq(first.head, ["Point", "Net premium"], "the table has a header for the x axis and one column per series");
  eq(first.rows.length, 8, "one row per reading");
  eq(first.rows[3], ["10:15", "$0"], "an exact zero is a reading and prints as zero, unsigned");
  eq(first.rows[5], ["10:45", "—"], "a null prints as the em dash, never as zero");
  eq(first.rows[2], ["10:00", "−$6.0M"], "and a negative as U+2212");
  ok(first.noAscii, "no table cell starts with an ASCII hyphen-minus");
  eq(first.updated, "+$9.0M", "update() refreshes an open table");
  ok(first.wrapHidden2 === true && first.boxGone, "the toggle closes again and destroy() removes the table box");
  ok(first.animations > 0, "the first draw of a plot animates in");
  await page.close();
}

{
  const page = await open(640, `<script>${PLOT_SRC}</script>`);
  const r = await page.evaluate(async () => {
    const C = window.FlowsUI.chart;
    const out = {};
    const a = window.mkHost("d"), b = window.mkHost("b"), c = window.mkHost("l"), g = window.mkHost("g");
    const dv = C.plot(a, { kind: "diverging", label: "Net", values: [0, 5, -5, 0, null], x: ["a", "b", "c", "d", "e"] });
    const bs = C.plot(b, { kind: "bars", label: "Counts", values: [3, 8, 5], labels: ["x", "y", "z"] });
    const ln = C.plot(c, { kind: "line", label: "Tide", series: [{ values: Array.from({ length: 24 }, (_, i) => i * 3 - 20) }], x: Array.from({ length: 24 }, (_, i) => "t" + i) });
    const hm = C.plot(g, { kind: "heatmap", label: "Grid", rows: ["r1", "r2"], cols: ["a", "b"], grid: [[1, -2], [0, null]] });
    for (const hd of [dv, bs, ln, hm]) await window.settle(hd);
    out.zeroRects = a.querySelectorAll("rect.zero").length;
    out.bars = a.querySelectorAll("rect.grow").length;
    out.voids = a.querySelectorAll("circle").length;
    out.upFill = [...a.querySelectorAll("rect.grow")].map((r) => r.getAttribute("fill"));
    out.zeroFill = [...a.querySelectorAll("rect.zero")].map((r) => r.getAttribute("fill"));
    out.dvDesc = dv.describe();
    out.desc = [dv, bs, ln, hm].map((hd) => hd.describe());
    out.described = [a, b, c, g].map((el) => !!document.getElementById(el.getAttribute("aria-describedby")));
    out.hm = hm.describe();
    out.hmRows = hm.table().querySelectorAll("tbody tr").length;
    out.hmCells = [...hm.table().querySelectorAll("tbody td")].map((x) => x.textContent);
    const f = window.FlowsUI.F;
    const tk = C.ticks(C.scale("linear", -0.06, 0.04, 0, 100), 4, "pct");
    out.ticks = tk.map((x) => x.text);
    const svg = window.FlowsUI.s("svg", { width: 300, height: 200 });
    const L = C.layout(300, {});
    C.axes(svg, L, 300, { x: [{ x: 10, text: "09:30" }, { x: 290, text: "16:00", end: true }], y: [{ y: 50, text: "−5" }, { y: 100, text: "0" }], grid: true });
    out.axes = { base: svg.querySelectorAll("line.base").length, hair: svg.querySelectorAll("line.hair").length, texts: [...svg.querySelectorAll("text")].map((x) => x.textContent), anchors: [...svg.querySelectorAll("text")].map((x) => x.getAttribute("text-anchor")) };
    return out;
  });
  eq(r.zeroRects, 2, "zero is not positive: each exact zero draws the neutral tick");
  eq(r.bars, 2, "and only the two non-zero readings draw a bar");
  eq(r.voids, 1, "a null draws the small void, not a bar");
  ok(r.upFill.length === 2 && r.upFill[0] !== r.upFill[1], "the positive and negative bar take different fills");
  ok(r.zeroFill.every((f) => f !== r.upFill[0] && f !== r.upFill[1]), "and the zero ticks take neither direction's fill");
  eq(r.dvDesc, "Net, a to e. Net: last 0 at d; low −5 at c; high +5 at b.", "an exact zero is described as 0, not +0, and is the last reading when the series ends in a gap");
  ok(r.desc.every((d) => d.length > 20), "every plot kind writes a non-empty description");
  eq(r.described, [true, true, true, true], "and every chart host points at its description");
  eq(r.hm, "Grid, r1, a to r2, b. Grid: last 0 at r2, a; low −2 at r1, b; high +1 at r1, a.", "the heatmap describes its cells in row-major order, the null cell skipped");
  eq(r.hmRows, 4, "and tables one row per cell");
  eq(r.hmCells, ["+1", "−2", "0", "—"], "with zero as 0 and the void as an em dash");
  ok(r.ticks.every((x) => !/^-/.test(x)) && r.ticks.some((x) => x.startsWith("−")), `ticks through F.unit('pct') carry U+2212 on negatives (${r.ticks.join(" ")})`);
  eq(r.axes.base, 1, "axes() draws the baseline once");
  eq(r.axes.hair, 2, "a hairline per y tick when the grid is asked for");
  eq(r.axes.texts, ["−5", "0", "09:30", "16:00"], "y labels then x labels, minus as U+2212");
  eq(r.axes.anchors, [null, null, "middle", "end"], "an end tick anchors to its end");
  await page.close();
}

{
  const page = await open(640, `<script>${PLOT_SRC}</script>`);
  const names = await page.evaluate(async () => {
    const C = window.FlowsUI.chart;
    const N = 24;
    const specs = {
      line: { kind: "line", label: "Tide", series: [{ values: Array.from({ length: N }, (_, i) => i * 3 - 20) }], x: Array.from({ length: N }, (_, i) => "t" + i) },
      bars: { kind: "bars", label: "Counts", values: [3, 8, 5, 2, 9, 4, 6], labels: ["a", "b", "c", "d", "e", "f", "g"] },
      diverging: { kind: "diverging", label: "Net", values: [1, -2, 3, 0, -4, 5, -6, 7, 0, 2], x: Array.from({ length: 10 }, (_, i) => "k" + i) },
    };
    for (const k in specs) { const hd = C.plot(window.mkHost("k-" + k), specs[k]); await window.settle(hd); }
    return Object.keys(specs);
  });
  const counts = { line: 24, bars: 7, diverging: 10 };
  for (const name of names) {
    await page.focus("#k-" + name);
    await page.keyboard.press("Home");
    const seen = [];
    const read = () => page.evaluate((n) => document.querySelector("#k-" + n + " .ui-readout").textContent, name);
    seen.push(await read());
    for (let i = 1; i < counts[name]; i++) { await page.keyboard.press("ArrowRight"); seen.push(await read()); }
    eq(new Set(seen).size, counts[name], `${name}: the keyboard reaches every one of its ${counts[name]} marks, one distinct readout each`);
    await page.keyboard.press("ArrowRight");
    eq(await read(), seen[seen.length - 1], `${name}: and stops at the last mark`);
    await page.keyboard.press("Home");
    eq(await read(), seen[0], `${name}: Home returns to the first`);
    await page.keyboard.press("End");
    eq(await read(), seen[seen.length - 1], `${name}: End goes to the last`);
    eq((await page.evaluate(() => document.getElementById("fxLive").textContent)).replace(/\s/g, ""), seen[seen.length - 1].replace(/\s/g, ""), `${name}: and the reading is announced`);
  }
  await page.close();
}

{
  const page = await open(640, `<script>${PLOT_SRC}</script>`, true);
  const r = await page.evaluate(async () => {
    const C = window.FlowsUI.chart;
    const el = window.mkHost("u");
    const vals = Array.from({ length: 24 }, (_, i) => i * 3 - 20);
    const spec = { kind: "line", label: "Tide", series: [{ values: vals }], x: Array.from({ length: 24 }, (_, i) => "t" + i) };
    const hd = C.plot(el, spec);
    await window.settle(hd);
    const out = { first: el.querySelector("svg").getAnimations({ subtree: true }).length };
    el.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    out.on0 = el.querySelector(".ui-readout").classList.contains("is-on");
    out.text0 = el.querySelector(".ui-readout").textContent;
    const svg0 = el.querySelector("svg");
    hd.update({ series: [{ values: vals.map((v, i) => (i === 23 ? 500 : v)) }] });
    out.on1 = el.querySelector(".ui-readout").classList.contains("is-on");
    out.text1 = el.querySelector(".ui-readout").textContent;
    out.noAnim = el.querySelector("svg").classList.contains("no-anim");
    out.anims = el.querySelector("svg").getAnimations({ subtree: true }).length;
    out.same = el.querySelector("svg") === svg0;
    const N = 40;
    const med = (f) => { const ts = []; for (let k = 0; k < 7; k++) { const t0 = performance.now(); for (let i = 0; i < N; i++) f(i); ts.push((performance.now() - t0) / N); } return ts.sort((a, b) => a - b)[3]; };
    const big = Array.from({ length: 390 }, (_, i) => Math.sin(i / 20) * 100 + i);
    const labels = big.map((_, i) => "2026-09-" + String(1 + (i % 28)).padStart(2, "0"));
    const o1 = { label: "Tide", series: [{ values: big }], x: labels };
    const v1 = C.line(window.mkHost("v1"), o1), v2 = C.plot(window.mkHost("v2"), { ...o1, kind: "line" });
    await window.settle(v1); await window.settle(v2);
    const refCost = med((i) => v1.set({ ...o1, series: [{ values: big.map((v) => v + i) }] }, false));
    const kernCost = med((i) => v2.update({ series: [{ values: big.map((v) => v + i) }] }));
    out.ratio = kernCost / refCost;
    return out;
  });
  ok(r.first > 0, "the first draw animates");
  ok(r.on0 && /t23/.test(r.text0), "End puts the crosshair on the last reading");
  ok(r.on1, "an update keeps the crosshair on");
  ok(/500/.test(r.text1), "and refreshes what it reads");
  ok(r.noAnim && r.anims === 0 && r.same, "and does not animate: the same svg is reused with its entrance suppressed");
  ok(r.ratio < 1.6, `a kernel update costs no more than 1.6x a v1 redraw of the same 390-point tide (${r.ratio.toFixed(2)}x)`);
  await page.close();
}

{
  const page = await open(640, `<script>${PLOT_SRC}</script>`);
  const r = await page.evaluate(async () => {
    const C = window.FlowsUI.chart;
    let draws = 0, last = null;
    C.kind("demo", {
      draw: (el, w, animate, spec) => { draws++; last = spec; el.append(document.createTextNode(spec.text)); },
      data: (spec) => ({ title: "Demo", x: ["a"], cols: [{ label: "v", values: [spec.n], fmt: (v) => v + " units" }] }),
    });
    const el = window.mkHost("demo");
    const hd = C.plot(el, { kind: "demo", text: "hello", n: 4 });
    await window.settle(hd);
    const out = { text: el.textContent, desc: hd.describe(), draws };
    hd.update({ text: "again" });
    out.text2 = el.textContent.replace(/Demo.*/, "");
    out.kept = last.n;
    hd.set({ kind: "demo", text: "replaced" });
    out.replaced = last.n === undefined;
    hd.destroy();
    out.empty = el.children.length === 0;
    return out;
  });
  ok(/^hello/.test(r.text), "a registered kind draws through plot()");
  eq(r.desc, "Demo, a to a. v: last 4 units at a; low 4 units at a; high 4 units at a.", "and takes its description from its data() and its own unit format");
  ok(/^again/.test(r.text2) && r.kept === 4, "update() merges a patch into the spec");
  ok(r.replaced, "set() with an object replaces it, as the v1 handles always did");
  ok(r.empty, "destroy() empties the host");
  await page.close();
}

{
  const page = await open(640, `<script>${PLOT_SRC}</script>`);
  await page.evaluate(async () => {
    const C = window.FlowsUI.chart, s = window.FlowsUI.s;
    const PTS = [{ x: 50, y: 150, r: 6 }, { x: 120, y: 40, r: 10 }, { x: 120, y: 160, r: 4 }, { x: 300, y: 90, r: 8 }];
    for (const [id, first] of [["bub-first", true], ["bub-left", true], ["bub-last", false]]) {
      const hd = C.mount(window.mkHost(id), (el, w, animate) => {
        const svg = C.svgRoot(el, w, 200, false, "Bubbles");
        for (const p of PTS) s("circle", { cx: p.x, cy: p.y, r: p.r, class: "b" }, svg);
        C.scrub(el, svg, {
          xs: PTS.map((p) => p.x), ys: PTS.map((p) => p.y), rs: PTS.map((p) => p.r), yw: 0.6, first, xh: 0.5, reach: 40, top: 0, bottom: 200, label: "Bubbles",
          onMove: (i) => ({ x: PTS[i].x, top: 0, parts: [C.part("p" + i, "k")], dots: [{ x: PTS[i].x, y: PTS[i].y, r: PTS[i].r + 3, cls: "b-ring", fill: "none" }] }),
        });
      });
      await window.settle(hd);
    }
  });
  const read = (id) => page.evaluate((i) => { const r = document.querySelector("#" + i + " .ui-readout"); return r.classList.contains("is-on") ? r.textContent : null; }, id);
  await page.focus("#bub-first");
  await page.keyboard.press("ArrowRight");
  eq(await read("bub-first"), "p0", "scrub with first: the first ArrowRight from nothing lands on the first mark, not the last");
  eq(await page.evaluate(() => document.querySelector("#bub-first line.xh").getAttribute("opacity")), "0.5", "and the crosshair takes the opacity the chart asked for");
  eq(await page.evaluate(() => { const c = document.querySelector("#bub-first circle.b-ring"); return [c.getAttribute("r"), c.getAttribute("fill"), c.getAttribute("cx"), c.getAttribute("cy")]; }), ["9", "none", "50", "150"], "and the dot is the ring the chart described, sized past the bubble");
  await page.focus("#bub-left");
  await page.keyboard.press("ArrowLeft");
  eq(await read("bub-left"), "p3", "and the first ArrowLeft from nothing lands on the last");
  await page.focus("#bub-last");
  await page.keyboard.press("ArrowRight");
  eq(await read("bub-last"), "p3", "without first the standing behaviour holds: the first ArrowRight lands on the newest mark");
  const box = await page.evaluate(() => { const b = document.querySelector("#bub-last svg").getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.mouse.move(box.x + 120, box.y + 150);
  await page.waitForTimeout(80);
  eq(await read("bub-last"), "p2", "pointer: two marks share an x and the nearer in y wins");
  await page.mouse.move(box.x + 120, box.y + 55);
  await page.waitForTimeout(80);
  eq(await read("bub-last"), "p1", "and moving up reaches the other");
  await page.mouse.move(box.x + 560, box.y + 10);
  await page.waitForTimeout(80);
  eq(await read("bub-last"), null, "a pointer farther than reach from every mark reads nothing");
  await page.close();
}

{
  const src = fs.readFileSync(path.join(HERE, "..", "assets/js/flows-chart.js"), "utf8");
  const fmtUnit = (kind, v) => kind + ":" + v;
  const members = {
    h: () => ({}), s: () => ({}), num: (v) => (typeof v === "number" && Number.isFinite(v) ? v : null),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), glyph: () => ({}),
    F: Object.freeze({ unit: fmtUnit, num: (v) => String(v) }), tone: () => "flat", announce: () => {}, silent: () => ({}),
    cssVar: (v) => v, DASH: "—", reduced: () => false,
  };
  const ctx = { window: { FlowsUI: Object.freeze(members), ResizeObserver: undefined }, document: {}, requestAnimationFrame: (f) => f() };
  vm.createContext(ctx);
  vm.runInContext('"use strict";\n' + src, ctx);
  const C = ctx.window.FlowsUI.chart;
  const near = (a, b, msg) => ok(Math.abs(a - b) < 1e-9, msg + ` (${a} vs ${b})`);

  const ref = (d0, d1, r0, r1) => { const k = (r1 - r0) / ((d1 - d0) || 1); return (v) => r0 + (v - d0) * k; };
  for (const [d0, d1, r0, r1] of [[0, 10, 0, 100], [-5, 5, 300, 20], [3, 3, 0, 50], [1e6, 5e6, 10, 400]]) {
    const f = C.lin(d0, d1, r0, r1), g = ref(d0, d1, r0, r1);
    for (const v of [d0, (d0 + d1) / 2, d1, d1 + 3]) near(f(v), g(v), `lin(${d0},${d1}) maps ${v} as the old closure did`);
    near(C.scale("linear", d0, d1, r0, r1)(d1), g(d1), "and scale('linear') is the same function");
  }
  const lg = C.scale("log", 1e5, 1e7, 0, 200);
  near(lg(1e5), 0, "log: the low end sits at the range start"); near(lg(1e6), 100, "log: a decade is half the range here"); near(lg(1e7), 200, "log: the high end");
  near(lg.inv(lg(3e5)) / 3e5, 1, "log: inv undoes the map");
  const sq = C.scale("sqrt", 0, 100, 0, 10);
  near(sq(25), 5, "sqrt: 25 of 100 is half of 10"); near(sq.inv(5), 25, "sqrt: inv"); near(sq(-4), 0, "sqrt: a negative clamps to the origin rather than NaN");
  const bd = C.scale("band", 0, 4, 10, 50);
  near(bd(0), 15, "band: the first centre"); near(bd(3), 45, "band: the last centre"); near(bd.step, 10, "band: step"); eq(bd.inv(44), 3, "band: inv finds the band");
  const ss = C.scale("session", 240, 1200, 0, 1000);
  ok(ss(570) > ss(240) && ss(960) > ss(570) && ss(1200) > ss(960), "session: monotone");
  near(ss(1200), 1000, "session: the full day spans the range");
  ok((ss(960) - ss(570)) / 390 > ((ss(570) - ss(240)) / 330) * 2.5, "session: a regular-session minute is drawn wider than a closed-hours minute");
  for (const m of [240, 400, 570, 700, 960, 1000, 1200]) near(ss.inv(ss(m)), m, `session: inv undoes ${m}`);
  const tk = C.ticks(C.scale("log", 1e5, 1e7, 0, 200), 3, "moneyCompact");
  eq([...tk.map((x) => x.v)], [1e5, 1e6, 1e7], "log ticks fall on decades");
  eq([...tk.map((x) => x.text)], ["moneyCompact:100000", "moneyCompact:1000000", "moneyCompact:10000000"], "and take their labels from F.unit by kind name");
  eq([...C.ticks(C.scale("session", 570, 960, 0, 100), 8).map((x) => x.v)], [600, 660, 720, 780, 840, 900, 960], "session ticks fall on the hour");
  eq([...C.ticks(C.scale("session", 570, 960, 0, 100), 3).map((x) => x.v)], [600, 780, 960], "and thin to every few hours when asked for fewer");
  eq([...C.ticks(C.scale("linear", 0, 10, 0, 100), 5, (v) => "<" + v + ">").map((x) => x.text).slice(0, 2)], ["<0>", "<2>"], "a function is used as given");
  const L = C.layout(390, { labels: ["$1.2M", "−$4.0M"], height: [200, 220, 240] });
  ok(L.phone && L.H === 200 && L.top === 14 && L.bot === 24 && L.left === 2, "layout: phone, height band and default margins");
  ok(L.right > 40 && L.right < 120, `layout: the right gutter grows with the longest label (${L.right})`);
  ok(C.layout(390, { labels: ["$1.2M", "−$4.0M and more"] }).right > L.right, "layout: a longer label widens it");
  eq(C.layout(1000, {}).right, 62, "layout: no labels gives the standing wide gutter");
  eq(C.layout(1000, { right: 9 }).right, 9, "layout: an explicit margin wins");
  eq(C.layout(1000, { height: [200, 220, 240] }).H, 240, "layout: the wide band");
  let threw = 0;
  for (const bad of [() => C.kind("", { draw() {} }), () => C.kind("x", null), () => C.kind("y", {}), () => C.plot({}, { kind: "nope" })]) { try { bad(); } catch { threw++; } }
  eq(threw, 4, "kind() refuses an empty name, a missing or drawless implementation, and plot() refuses an unknown kind");
  C.kind("dup", { draw() {} });
  try { C.kind("dup", { draw() {} }); ok(false, "a duplicate kind name throws"); } catch (e) { ok(/dup/.test(e.message), "a duplicate kind name throws"); }
  ok(Object.isFrozen(C), "the chart object is frozen: the registry lives in a closure Map and kind() never mutates it");
  ok(["kind", "plot", "scale", "ticks", "layout", "axes"].every((n) => typeof C[n] === "function"), "kind, plot, scale, ticks, layout and axes are exported");
}

await browser.close();
eq(errors, [], "no page error or console error");
console.log(`✓ flows-chart-kernel: ${checks} assertions`);
