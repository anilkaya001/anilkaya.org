import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../shared/flows-pages.js";
import { flowsPageRows } from "../server/routes/flows-pages.js";
import { launch } from "./lib/browser.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const FIX = JSON.parse(read("scripts/render-preview.fixtures.json")).market;
const SRC = read("assets/js/flows-skyline.js");
const SKY = "/assets/js/flows-skyline.js";

const SECTORS = ["Technology", "Energy", "Financials"];
const ROWS = [
  ["NVDA", 0, 0.05, 0.30, 40], ["AAPL", 0, -0.12, 0.30, 40], ["MSFT", 0, 0.01, 0.30, 40], ["XOM", 1, -0.03, 0.25, 40],
  ["CVX", 1, 0.045, 0.25, 40], ["JPM", 2, 0.06, 0.20, 40], ["GS", 2, -0.07, 0.40, 10], ["BAC", 2, 0.02, null, 40],
  ["WFC", 2, 0.05, 0.30, 40], ["C", 2, 0.01, 0.30, 40],
];
const universe = (rows, sectors = SECTORS) => ({
  status: "ok", sessionDate: "2026-10-09", n: rows.length, t: rows.map((r) => r[0]), sectors, sec: rows.map((r) => r[1]),
  units: { chg: ["fraction", 1e4], iv30p: ["vol", 1e3], ed: ["sessions", 1] },
  cols: { chg: rows.map((r) => Math.round(r[2] * 1e4)), iv30p: rows.map((r) => (r[3] === null ? null : Math.round(r[3] * 1e3))), ed: rows.map((r) => r[4]) },
});
const expectM = (chg, iv) => chg * Math.sqrt(252) / iv;
const KNOWN = ROWS.filter((r) => r[3] !== null && Math.abs(expectM(r[2], r[3])) >= 2).map((r) => ({ t: r[0], m: expectM(r[2], r[3]), event: r[4] <= 21 }));

{
  const rows = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => null, isOwner: () => true, scenesOn: (env) => env.on });
  const market = rows.find((r) => r.id === "flows.pages.market");
  const get = async (env) => (await market.handler({ request: new Request("https://x.test/flows/market/"), env, url: new URL("https://x.test/flows/market/") })).text();
  ok((await get({ on: true })).includes('id="mkSkylineCard"'), "THE SKYLINE MODULE IS IN THE PAGE WHEN THE SWITCH PASSES");
  ok(!(await get({ on: false })).includes("mkSkyline"), "and absent when it does not");
  const bare = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => null, isOwner: () => true }).find((r) => r.id === "flows.pages.market");
  ok(!(await bare.handler({ request: new Request("https://x.test/flows/market/"), env: {}, url: new URL("https://x.test/flows/market/") }).then((x) => x.text())).includes("mkSkyline"), "a router with no switch defaults to off");
  const w = read("worker.js");
  ok(/scenesOn: \(env, username\) => String\(\(env && env\.FLOWS_SCENES\) \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "owner" && rtIsOwner\(/.test(w), "the Worker admits only FLOWS_SCENES=owner and only an owner");
  ok(/^FLOWS_SCENES = "owner"$/m.test(read("wrangler.toml")), "wrangler.toml ships the switch at owner");
  ok(!PAGES.marketPage({ username: "u", owner: true }).includes("mkSkyline"), "an owner page without the switch has no skyline");
  ok(!/data-defer="skyline"/.test(PAGES.marketPage({ username: "u" })), "a member page declares no skyline group");
  eq(PAGES.marketPage({ username: "u", owner: true, scenes: true }).match(/<i\b[^>]*data-defer="skyline"[^>]*>/g).length, 1, "the owner page declares the group once");
}

async function open(browser, { viewport = { width: 1440, height: 900 }, uni = universe(ROWS), source = SRC } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    window.__text = [];
    window.__dash = 0;
    const p = CanvasRenderingContext2D.prototype;
    const ft = p.fillText, sd = p.setLineDash;
    p.fillText = function (t, ...a) { window.__text.push(String(t)); return ft.call(this, t, ...a); };
    p.setLineDash = function (d) { if (d && d.length) window.__dash++; return sd.call(this, d); };
  });
  const page = await context.newPage();
  const log = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    log.push(u.pathname);
    if (u.pathname === SKY) return route.fulfill({ body: source, contentType: "text/javascript" });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/flows/universe")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(uni) });
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const k = Object.keys(FIX).find((x) => key.includes(x.replace(/^flows\//, "")));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIX[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGES.marketPage({ username: "test", owner: true, scenes: true }) });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/market/", { waitUntil: "commit" });
  return { context, page, log, errors };
}

const reveal = async (page) => {
  await page.waitForSelector("#mkSkyline", { state: "attached", timeout: 15000 });
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => document.getElementById("mkSkylineCard").scrollIntoView({ block: "center" }));
    if (await page.evaluate(() => Boolean(document.getElementById("mkSkyline").dataset.state))) return;
    await sleep(250);
  }
  throw new Error("the skyline never mounted");
};

async function verify(page, expect = KNOWN) {
  const bad = [];
  const need = (c, m) => { if (!c) bad.push(m); };
  const r = await page.evaluate(() => {
    const host = document.getElementById("mkSkyline");
    const sk = window.FlowsUI.skyline;
    const w = host.clientWidth;
    const sc = sk.layout(sk.model(window.__md), w, 360);
    const rows = [...host.querySelectorAll("tbody tr")].map((tr) => ({ t: tr.dataset.t, dir: tr.dataset.dir, cells: [...tr.children].map((c) => c.textContent) }));
    const canvas = host.querySelector("canvas");
    let px = null;
    if (canvas && !canvas.hidden && window.__scene) {
      const g = canvas.getContext("2d");
      const it = window.__scene.items[window.__scene.items.length - 1];
      const x = Math.round(it.x - it.w / 2), y = Math.round((it.yt + it.yb) / 2 + it.w / 4);
      px = { t: it.t, dir: it.dir, d: Array.from(g.getImageData(x, y, 1, 1).data) };
    }
    return { sc: sc && { unit: sc.unit, items: sc.items.map((i) => ({ t: i.t, h: i.h, d: i.yb - i.yt, dir: i.dir, event: i.event })) }, rows, px, text: window.__text.slice(), dash: window.__dash, state: host.dataset.state };
  });
  const want = new Map(expect.map((e) => [e.t, e]));
  eq(new Set(r.sc.items.map((i) => i.t)), new Set(want.keys()), "the prisms are exactly the names at or beyond 2 IV-days");
  for (const i of r.sc.items) {
    const e = want.get(i.t);
    need(Math.abs(i.h - Math.abs(e.m)) < 1e-9, `${i.t} height ${i.h} is not |${e.m}| IV-days`);
    need(Math.abs(i.d - i.h * r.sc.unit) < 1e-6, `${i.t} drawn height ${i.d} is not height x unit`);
    need(i.dir === Math.sign(e.m), `${i.t} direction ${i.dir}`);
    need(i.event === e.event, `${i.t} event mark ${i.event}`);
  }
  for (const x of r.rows) need(x.dir === (want.get(x.t).m > 0 ? "up" : "down") && x.cells[3].startsWith(want.get(x.t).m > 0 ? "+" : "−"), `${x.t} table direction`);
  need(r.rows.length === want.size, "the table lists every prism");
  need(r.text.every((s) => /IV-days$/.test(s)), `no label sits on a prism: canvas text is only ${JSON.stringify(r.text)}`);
  if (r.px) {
    const [R, G] = r.px.d;
    need(r.px.dir > 0 ? G > R : R > G, `the front prism ${r.px.t} colour (${r.px.d}) carries its direction ${r.px.dir}`);
  }
  return { bad, r };
}

const browser = await launch();
try {
  {
    const { context, page, log, errors } = await open(browser);
    await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.marketKit, null, { timeout: 15000 });
    await sleep(1500);
    eq(log.filter((p) => p === SKY).length, 0, "THE SKYLINE FILE IS NOT REQUESTED WHILE ITS MODULE IS FAR BELOW THE FOLD");
    await reveal(page);
    await page.waitForFunction(() => document.querySelector("#mkSkyline canvas"), null, { timeout: 15000 });
    eq(log.filter((p) => p === SKY).length, 1, "and is requested once when the module nears the viewport");
    await page.evaluate(async () => {
      const u = await (await fetch("/api/flows/universe")).json();
      window.__md = u;
      window.__text = [];
      window.__dash = 0;
      window.__scene = window.FlowsUI.skyline.mount(document.getElementById("mkSkyline"), u).scene();
    });
    const model = await page.evaluate(() => window.FlowsUI.skyline.model(window.__md));
    eq(model.prisms.map((p) => p.t).sort(), KNOWN.map((k) => k.t).sort(), "the model keeps exactly the names beyond 2 IV-days, a null previous IV and a small move left out");
    const { bad, r } = await verify(page);
    eq(bad, [], "HEIGHT IS |IV-DAYS|, DIRECTION IS ON THE COLOUR CHANNEL AND IN THE TABLE, NO LABEL SITS ON A PRISM");
    const events = KNOWN.filter((k) => k.event).length;
    ok(r.dash > 0 && r.dash % events === 0, `each earnings-window prism has a dashed top on every draw and no other prism does (${r.dash} dashed tops for ${events} event prisms)`);
    ok(await page.evaluate(() => /No selection line|no error rate has been measured/.test(document.getElementById("mkSkyline").textContent) && /Earnings within 30 days: event not separated\./.test(document.getElementById("mkSkyline").textContent)), "the module says no error rate is measured and names the event rows");
    ok(await page.evaluate(() => { const c = document.querySelector("#mkSkyline canvas"); return c.getAttribute("role") === "img" && /2 IV-days or more/.test(c.getAttribute("aria-label")) && document.querySelector("#mkSkyline details table caption") !== null; }), "the canvas is described and a table is the alternative");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal overflow at 1440");
    eq(errors, [], "no page error");
    await context.close();
  }

  for (const width of [390, 320]) {
    const { context, page, errors } = await open(browser, { viewport: { width, height: 800 } });
    await reveal(page);
    await page.waitForFunction(() => document.querySelector("#mkSkyline table"), null, { timeout: 15000 });
    ok(await page.evaluate(() => document.querySelector("#mkSkyline canvas").hidden && document.querySelector("#mkSkyline details").open), `AT ${width} PX THE SORTED TABLE STANDS IN FOR THE CANVAS`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `no horizontal overflow at ${width}`);
    eq(errors, [], `no page error at ${width}`);
    await context.close();
  }

  {
    const many = [];
    for (let i = 0; i < 55; i++) many.push(["N" + String(i).padStart(2, "0"), i % 3, (i % 2 ? 1 : -1) * (0.05 + i * 0.001), 0.3, 40]);
    const { context, page } = await open(browser, { uni: universe(many) });
    await reveal(page);
    const md = await page.evaluate(async () => window.FlowsUI.skyline.model(await (await fetch("/api/flows/universe")).json()));
    eq(md.prisms.length, 40, "AT MOST 40 PRISMS: 55 names beyond the line keep the 40 largest");
    eq(md.beyond, 55, "and the count beyond the line is still 55");
    const kept = new Set(md.prisms.map((p) => p.t));
    ok(many.slice().sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).slice(0, 40).every((r) => kept.has(r[0])), "the 40 are the 40 largest by IV-days");
    await context.close();
  }

  {
    const { context, page, errors } = await open(browser, { uni: universe([["AAA", 0, 0.01, 0.3, 40], ["BBB", 1, -0.01, 0.3, 40]]) });
    await reveal(page);
    ok(await page.evaluate(() => document.getElementById("mkSkyline").dataset.state === "quiet" && /That is a reading, not a forecast/.test(document.getElementById("mkSkyline").textContent)), "WHEN NOTHING CROSSES THE LINE THE MODULE SAYS SO IN TEXT");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page, errors } = await open(browser, { uni: { status: "pending", rows: [] } });
    await reveal(page);
    ok(await page.evaluate(() => document.getElementById("mkSkyline").dataset.state === "pending" && /has not published/.test(document.getElementById("mkSkyline").textContent)), "AN UNPUBLISHED UNIVERSE IS A NAMED STATE, NOT AN EMPTY BOX");
    eq(errors, [], "no page error");
    await context.close();
  }

  const MUTANTS = [
    ["height from the raw change", "h: Math.abs(m),", "h: Math.abs(c) * 100,"],
    ["direction reversed", "dir: m > 0 ? 1 : -1", "dir: m > 0 ? -1 : 1"],
    ["line at 1 IV-day", "const MIN = 2;", "const MIN = 1;"],
    ["event window ignored", "e <= EVENT", "e <= -1"],
    ["drawn height off the scale", "yt: yb - p.h * unit", "yt: yb - Math.sqrt(p.h) * unit"],
    ["a ticker label on each prism", "g.globalAlpha = 1;\n      g.strokeStyle = c;", "g.fillText(it.t, it.x, it.yt);\n      g.globalAlpha = 1;\n      g.strokeStyle = c;"],
  ];
  for (const [name, from, to] of MUTANTS) {
    ok(SRC.includes(from), `mutant "${name}" anchors on the served module`);
    const { context, page } = await open(browser, { source: SRC.replace(from, to) });
    await reveal(page);
    await page.waitForFunction(() => document.querySelector("#mkSkyline canvas"), null, { timeout: 15000 });
    await page.evaluate(async () => {
      const u = await (await fetch("/api/flows/universe")).json();
      window.__md = u;
      window.__scene = window.FlowsUI.skyline.mount(document.getElementById("mkSkyline"), u).scene();
    });
    let failed = false;
    try {
      const { bad } = await verify(page);
      failed = bad.length > 0;
    } catch { failed = true; }
    ok(failed, `THE PLANTED WRONG BUILD "${name}" FAILS THE KNOWN-ANSWER CHECKS`);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`flows-skyline-render: ${checks} checks passed`);
