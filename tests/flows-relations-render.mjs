import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../shared/flows-pages.js";
import { launch } from "./lib/browser.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const FIX = JSON.parse(read("scripts/render-preview.fixtures.json")).market;
const SRC = read("assets/js/flows-relations.js");
const REL = "/assets/js/flows-relations.js";

const SECTORS = ["Technology", "Energy", "Financials"];
const NAMES = [["NVDA", 0], ["AAPL", 0], ["MSFT", 0], ["XOM", 1], ["CVX", 1], ["JPM", 2], ["GS", 2], ["BAC", 2], ["WFC", 2]];
const UNI = { status: "ok", sessionDate: "2026-10-09", t: NAMES.map((n) => n[0]), sectors: SECTORS, sec: NAMES.map((n) => n[1]), units: {}, cols: {} };
const e = (a, b, passed, stability, lag) => ({ a, b, passed, stability, lag });
const GRAPH = {
  layers: [
    { id: "T", edges: [e("NVDA", "AAPL", true, 0.95, 5), e("NVDA", "XOM", true, 0.8, null), e("AAPL", "CVX", true, 0.6, null), e("MSFT", "JPM", true, 0.4, null),
      e("GS", "BAC", false, 0.99, null), e("NVDA", "ZZZZ", true, 0.99, null), e("JPM", "JPM", true, 0.99, null), e("WFC", "GS", true, 0.5, null), e("XOM", "CVX", true, null, null)] },
    { id: "C", edges: [e("JPM", "WFC", true, 0.92, null)] },
    { id: "F", edges: [e("NVDA", "MSFT", true, 0.99, 3)] },
  ],
};
const WANT = {
  T: [["NVDA", "AAPL", 0.95, 1], ["NVDA", "XOM", 0.8, 0.6], ["AAPL", "CVX", 0.6, 0.35], ["WFC", "GS", 0.5, 0.35]],
  C: [["JPM", "WFC", 0.92, 1]],
};

async function open(browser, { viewport = { width: 1440, height: 900 }, source = SRC } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (x) => errors.push(String(x)));
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === REL) return route.fulfill({ body: source, contentType: "text/javascript" });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/flows/universe")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(UNI) });
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const k = Object.keys(FIX).find((x) => key.includes(x.replace(/^flows\//, "")));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIX[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGES.marketPage({ username: "test", owner: true, scenes: true }) });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/market/", { waitUntil: "commit" });
  return { context, page, errors };
}

const reveal = async (page) => {
  await page.waitForSelector("#mkRelations", { state: "attached", timeout: 15000 });
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => document.getElementById("mkRelationsCard").scrollIntoView({ block: "center" }));
    if (await page.evaluate(() => Boolean(document.getElementById("mkRelations").dataset.state))) return;
    await sleep(250);
  }
  throw new Error("the relations view never mounted");
};

async function check(page) {
  const bad = [];
  const need = (c, m) => { if (!c) bad.push(m); };
  const r = await page.evaluate((graph) => {
    const R = window.FlowsUI.relations;
    const u = window.__uni;
    const ring = R.ring(u);
    const lists = R.lists(ring, graph);
    const host = document.getElementById("mkRelations");
    const out = { keys: Object.keys(lists), lists: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.map((x) => [x.a, x.b, x.stability, x.alpha])])), layers: {} };
    const mounted = R.mount(host, u, graph);
    for (const k of ["T", "C"]) {
      const b = host.querySelector(`button[data-layer="${k}"]`);
      if (b) b.click();
      const canvas = host.querySelector("canvas");
      const W = parseInt(canvas.style.width, 10);
      const g = canvas.getContext("2d");
      const c = W / 2, rad = W / 2 - 34;
      const at = (n) => { const a = mounted.ring.pos.get(n); return [c + Math.cos(a) * rad, c + Math.sin(a) * rad]; };
      const px = (L) => {
        const [x1, y1] = at(L[0]), [x2, y2] = at(L[1]);
        const x = Math.round(0.25 * x1 + 0.5 * c + 0.25 * x2), y = Math.round(0.25 * y1 + 0.5 * c + 0.25 * y2);
        let a = 0;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) a = Math.max(a, g.getImageData(x + dx, y + dy, 1, 1).data[3]);
        return a;
      };
      out.layers[k] = { rows: [...host.querySelectorAll("tbody tr")].map((tr) => [tr.dataset.a, tr.dataset.b, tr.children[2].textContent]), edges: host.dataset.edges, layer: host.dataset.layer, label: canvas.getAttribute("aria-label"), alpha: mounted.edges().map((x) => [x.a, x.b, px([x.a, x.b])]), status: host.querySelector('[role="status"]').textContent };
    }
    return out;
  }, GRAPH);
  eq(r.keys.sort(), ["C", "T"], "only the two registered layers produce edges: the flow layer is not drawn");
  for (const k of ["T", "C"]) {
    need(JSON.stringify(r.lists[k]) === JSON.stringify(WANT[k]), `layer ${k} draw list ${JSON.stringify(r.lists[k])}`);
    const L = r.layers[k];
    need(L.layer === k && L.edges === String(WANT[k].length), `layer ${k} shows ${L.edges} edges`);
    need(JSON.stringify(L.rows.map((x) => x.slice(0, 2))) === JSON.stringify(WANT[k].map((x) => x.slice(0, 2))), `layer ${k} table rows ${JSON.stringify(L.rows)}`);
    need(L.rows.every((x, i) => x[2] === WANT[k][i][2].toFixed(2)), `layer ${k} stability in the label`);
    need(L.alpha.every(([, , a], i) => (WANT[k][i][3] === 1 ? a > 200 : WANT[k][i][3] === 0.6 ? a > 110 && a < 200 : a > 55 && a < 110)), `layer ${k} opacity steps on the canvas ${JSON.stringify(L.alpha)}`);
    need(new RegExp(`${WANT[k].length} tested links`).test(L.label), "the canvas is described with its link count");
  }
  return bad;
}

const browser = await launch();
try {
  eq(!PAGES.marketPage({ username: "u", owner: true }).includes("mkRelations") && !PAGES.marketPage({ username: "u" }).includes("relations"), true, "THE RELATIONS MODULE AND ITS GROUP ARE NOT IN A PAGE WITHOUT THE SWITCH");
  eq(PAGES.marketPage({ username: "u", owner: true, scenes: true }).match(/<i\b[^>]*data-defer="relations"[^>]*>/g).length, 1, "the switched page declares the group once");

  {
    const { context, page, errors } = await open(browser);
    await reveal(page);
    ok(await page.evaluate(() => {
      const h = document.getElementById("mkRelations");
      return h.dataset.state === "untested" && h.dataset.edges === "0" && /No tested links yet/.test(h.textContent) && h.querySelector("details li") !== null;
    }), "WITH NO RELATIONS PAYLOAD ON MAIN THE MODULE IS THE RING AND A TEXT STATE: no tested links, none drawn");
    const px = await page.evaluate(() => {
      const c = document.querySelector("#mkRelations canvas");
      const g = c.getContext("2d");
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const inner = [];
      const W = c.width, cx = W / 2;
      for (let y = Math.round(cx - 40); y < cx + 40; y++) for (let x = Math.round(cx - 40); x < cx + 40; x++) inner.push(d[(y * W + x) * 4 + 3]);
      return Math.max(...inner);
    });
    eq(px, 0, "and the middle of the ring holds no pixel: no edge is invented");
    ok(await page.evaluate(() => document.querySelector("#mkRelations canvas").getAttribute("role") === "img" && /no relation has been tested/.test(document.querySelector("#mkRelations canvas").getAttribute("aria-label"))), "the canvas is described");
    eq(await page.evaluate(() => [...document.querySelectorAll("#mkRelations details li")].map((l) => l.textContent)), ["Technology: NVDA, AAPL, MSFT", "Energy: XOM, CVX", "Financials: JPM, GS, BAC, WFC"], "the ring lists the names by sector in payload order");
    await page.evaluate(async () => { window.__uni = await (await fetch("/api/flows/universe")).json(); });
    const bad = await check(page);
    eq(bad, [], "ONLY TESTED EDGES ARE DRAWN: a failed test, a stability under 0.5, an unknown name, a self-pair, a null stability and the flow layer draw nothing; the steps are 1, 0.6 and 0.35; the layers stay apart");
    await page.evaluate(() => window.FlowsUI.relations.mount(document.getElementById("mkRelations"), window.__uni, { layers: [{ id: "T", edges: [{ a: "NVDA", b: "AAPL", passed: true, stability: 0.3 }] }] }));
    ok(await page.evaluate(() => /No stable links this week/.test(document.getElementById("mkRelations").textContent) && document.getElementById("mkRelations").dataset.edges === "0"), "a layer with nothing stable says so in text");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no overflow at 1440");
    eq(errors, [], "no page error");
    await context.close();
  }

  for (const width of [390, 320]) {
    const { context, page, errors } = await open(browser, { viewport: { width, height: 800 } });
    await reveal(page);
    await page.evaluate(async (g) => { const u = await (await fetch("/api/flows/universe")).json(); window.FlowsUI.relations.mount(document.getElementById("mkRelations"), u, g); }, GRAPH);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `no horizontal overflow at ${width} with links drawn`);
    ok(await page.evaluate(() => { const c = document.querySelector("#mkRelations canvas"); return c.getBoundingClientRect().right <= innerWidth; }), `the ring fits inside the viewport at ${width}`);
    eq(errors, [], `no page error at ${width}`);
    await context.close();
  }

  const MUTANTS = [
    ["floor at 0.3", "const FLOOR = 0.5;", "const FLOOR = 0.3;"],
    ["a failed test still draws", "e.passed === true && ", ""],
    ["every step opaque", "return s >= 0.9 ? 1 : s >= 0.7 ? 0.6 : 0.35;", "return 1;"],
    ["flow layer admitted", 'C: "Residual partial correlation" }', 'C: "Residual partial correlation", F: "Flow" }'],
    ["layers merged", "const edges = cur ? by[cur] : [];", "const edges = cur ? Object.values(by).flat() : [];"],
    ["steps at the wrong edge", "s >= 0.9 ? 1 : s >= 0.7", "s >= 0.95 ? 1 : s >= 0.7"],
  ];
  for (const [name, from, to] of MUTANTS) {
    ok(SRC.includes(from), `mutant "${name}" anchors on the served module`);
    const { context, page } = await open(browser, { source: SRC.replace(from, to) });
    await reveal(page);
    await page.evaluate(async () => { window.__uni = await (await fetch("/api/flows/universe")).json(); });
    let failed = false;
    try { failed = (await check(page)).length > 0; } catch { failed = true; }
    ok(failed, `THE PLANTED WRONG BUILD "${name}" FAILS THE KNOWN-ANSWER CHECKS`);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`flows-relations-render: ${checks} checks passed`);
