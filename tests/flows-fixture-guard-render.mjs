import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";
import * as RT from "../shared/flows-rt.js";
import { STRIP_FIELDS } from "../shared/flows-live.js";
import { easternInstant } from "../shared/flows-freshness.js";
import { nightlyEmit, emitRead } from "./lib/nightly-emit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const PROD = "https://anilkaya.org";
const TEST = "https://example.test";
const NOW = Date.parse("2026-08-24T22:25:00.000Z");
const DAY = "2026-08-24";
const EMIT = nightlyEmit();
const emitted = (name) => emitRead(EMIT, name);
const SYN = /\bSY[NLSW]\d{3}\b/;
const SIDE = PAGES.FLOWS_PAGES.sidePage({ username: "test", side: "long" });
const TICKER = PAGES.FLOWS_PAGES.tickerPage({ username: "test" });

function answer(route, u, over) {
  const q = u.searchParams;
  if (over && route in over) return over[route](q);
  if (over && over.only) return { status: "pending" };
  switch (route) {
    case "board": return emitted("board:" + (q.get("side") || "long"));
    case "card": return emitted("card:" + q.get("t")) || { status: "pending" };
    case "card-x": return emitted("card-x:" + q.get("t")) || { status: "pending" };
    case "hist": return emitted("hist:" + q.get("t")) || { status: "pending" };
    case "summary": return { status: "ok", scope: q.get("t") || "", summary: null, ideas: [], tier: "family", code: null, why: "x" };
    case "lk": case "now": return { serverNow: NOW, keys: {} };
    default: return emitted(route) || { status: "pending" };
  }
}

async function open(browser, { origin, url, html, over = null, viewport = { width: 1440, height: 900 }, rail = null, setup = null, assets = null }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const asked = [];
  const errors = [];
  const logged = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") logged.push(m.text()); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (assets && assets[path.basename(f)]) return route.fulfill({ body: assets[path.basename(f)], contentType: MIME[".js"] });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/snap")) return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":{"code":"rt_off","message":"x"}}' });
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":{"code":"rt_off","message":"x"}}' });
    if (u.pathname.startsWith("/api/flows/")) {
      const route_ = u.pathname.slice("/api/flows/".length);
      asked.push(route_ + u.search);
      const body = answer(route_, u, over) || { status: "pending" };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
  });
  if (rail) {
    await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => rail(ws));
  }
  if (setup) await setup(page);
  await page.clock.install({ time: new Date(NOW) });
  await page.goto(origin + url, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  return { ctx, page, asked, errors, logged };
}

const view = (page) => page.evaluate(() => {
  const main = document.getElementById("flowsMain");
  const shown = !!main && !main.hidden && main.offsetParent !== null && main.getBoundingClientRect().height > 0;
  return {
    attr: document.documentElement.getAttribute("data-fixture"),
    mainShown: shown,
    mainText: shown ? main.innerText : "",
    mainAll: shown ? main.textContent : "",
    links: [...document.querySelectorAll("a[href*='/flows/ticker/?t=']")].map((a) => a.getAttribute("href")),
    gate: (document.getElementById("fxGate") || {}).textContent || null,
    gateKind: (document.getElementById("fxGate") || { dataset: {} }).dataset.state || null,
  };
});

const browser = await chromium.launch();
try {
  {
    const html = PAGES.FLOWS_PAGES.sidePage({ username: "test", side: "long" });
    const prod = await open(browser, { origin: PROD, url: "/flows/long/", html });
    const v = await view(prod.page);
    ok(v.attr && SYN.test(v.attr), "THE LONG BOARD ON THE PRODUCTION ORIGIN is quarantined: the document says which name arrived (" + v.attr + ")");
    eq(v.mainShown, false, "and the main region is hidden");
    eq(v.links.filter((h) => /t=SY[NLSW]\d{3}/.test(h)), [], "with no link to a fixture ticker page left in the document");
    ok(v.links.length === 0 || v.links.every((h) => !SYN.test(h)), "nor to any name that is one");
    eq(v.gateKind, "off", "the status pill is the unavailable one");
    await prod.page.click("#fxGate");
    await prod.page.waitForTimeout(300);
    ok(/This page was sent test data \(SY[NLSW]\d{3}\), so nothing on it is shown\./.test(await prod.page.evaluate(() => document.body.innerText)), "and says the page was sent test data, naming it");
    ok(prod.logged.some((t) => /fixture data refused/.test(t)), "one console error says so");
    eq(prod.logged.filter((t) => /fixture data refused/.test(t)).length, 1, "and only one");
    const before = prod.asked.length;
    await prod.page.evaluate(() => { window.fetch("/api/flows/board?side=short").then(() => { window.__late = true; }); });
    await prod.page.waitForTimeout(400);
    eq(await prod.page.evaluate(() => !!window.__late), false, "a later Flows request is held, not answered");
    eq(prod.asked.length, before, "and never leaves the page");
    await prod.ctx.close();

    const control = await open(browser, { origin: TEST, url: "/flows/long/", html });
    const c = await view(control.page);
    eq(c.attr, null, "THE SAME PAGE ON A .test ORIGIN (the control) is left alone");
    eq(c.mainShown, true, "with its main region shown");
    const names = new Set(c.mainAll.match(/SY[NLSW]\d{3}/g) || []);
    ok(names.size >= 20, "and prints the board's fixture names as it did before (" + names.size + " distinct)");
    ok(c.links.filter((h) => /t=SY[NLSW]\d{3}/.test(h)).length >= 10, "with their links (" + c.links.filter((h) => /t=SY/.test(h)).length + ")");
    eq(control.logged.filter((t) => /fixture data refused/.test(t)), [], "and no refusal logged");
    await control.ctx.close();

    const local = await open(browser, { origin: "http://127.0.0.1:8787", url: "/flows/long/", html });
    eq((await view(local.page)).attr, null, "a loopback origin is a test host too");
    await local.ctx.close();
  }

  {
    const html = PAGES.FLOWS_PAGES.tickerPage({ username: "test" });
    const prod = await open(browser, { origin: PROD, url: "/flows/ticker/?t=SYN001", html });
    eq(prod.asked.filter((k) => /^(?:card|card-x|hist|summary|dossier|live|chain)\b/.test(k)), [], "A FIXTURE ?t= ON THE PRODUCTION ORIGIN requests no card, no card-x, no history, no summary and no quote");
    const v = await view(prod.page);
    ok(!/SYN001/.test(v.mainText.replace(/\?t=SYN001/g, "")) || v.attr === null, "and the page does not present it as a name");
    await prod.ctx.close();

    const control = await open(browser, { origin: TEST, url: "/flows/ticker/?t=SYN001", html });
    ok(control.asked.some((k) => /^card\?t=SYN001/.test(k)), "while on a .test origin the same address asks for the card, as before");
    await control.ctx.close();

    const real = emitted("card:AAPL");
    ok(real && real.fixture === true, "THE DRY EMIT STAMPS A REAL-NAMED CARD: card AAPL says fixture:true");
    const stamped = await open(browser, { origin: PROD, url: "/flows/ticker/?t=AAPL", html });
    const sv = await view(stamped.page);
    ok(sv.attr !== null, "and a stamped card under a real name is quarantined on the production origin (" + sv.attr + ")");
    eq(sv.mainShown, false, "with the main region hidden");
    await stamped.ctx.close();

    const { fixture, ...plain } = real;
    const unstamped = await open(browser, { origin: PROD, url: "/flows/ticker/?t=AAPL", html, over: { only: true, card: () => plain } });
    const uv = await view(unstamped.page);
    eq(uv.attr, null, "while the same card without the stamp, under a real name, is not a fixture by any rule the client holds");
    ok(unstamped.asked.some((k) => /^card\?t=AAPL/.test(k)), "and was asked for");
    await unstamped.ctx.close();
  }

  const FIELDS = STRIP_FIELDS.map(([n]) => n);
  {
    const T0 = easternInstant("2026-09-29", 10 * 60 + 30);
    const pxRow = (t, qt, v = {}) => [t, qt, ...FIELDS.map((f) => (f in v ? v[f] : null))];
    const quote = (t, px, prev, qt) => pxRow(t, qt, { px, prev, chg: Math.round((px / prev - 1) * 1e6) / 1e6, net: 1e6, lean: 0.2, iv30: 0.3, qa: 1 });
    const fresh = (k) => RT.streamEntry({ k, readAt: T0, vendorAt: T0 - 1000, session: "2026-09-29", now: T0, updatedAt: T0 });
    const snapshot = (k, rows) => RT.frame(k, { ep: 7000, sq: 0, at: T0, snap: true, fresh: fresh(k), meta: { status: "ok", reason: null, rowDate: "2026-09-29", asked: rows.length, returned: rows.length, ahead: { n: 0, maxS: 0 }, off: 0, cols: RT.RT_ROW_FIELDS.px, missing: [], prevFill: null }, rows });
    const delta = (k, sq, rows) => RT.frame(k, { ep: 7000, sq, at: T0, fresh: fresh(k), meta: { status: "ok", reason: null, rowDate: "2026-09-29", asked: rows.length, returned: rows.length, ahead: { n: 0, maxS: 0 }, off: 0 }, rows });
    const hello = () => RT.ctlFrame("hello", { ep: 7000, at: T0, meta: { transport: "ws", upstream: "rest", mode: "on", audience: "owner", topics: ["px"], hbS: 5, cold: false, phase: "rth", session: "2026-09-29", f: null }, rows: [snapshot("px", [])] });
    const html = PAGES.flowsDocument({
      title: "Rail", description: "x", active: "ticker", username: "test", chrome: false, body: '<main id="flowsMain"><div id="rtHost"></div></main>',
      scripts: ["/assets/js/flows-fresh.js", "/assets/js/flows-rt.js"],
    });
    const run = async (origin, rows, assets = null) => {
      const sent = [];
      const o = await open(browser, {
        origin, url: "/flows/fixture-rail/", html, assets,
        rail: (ws) => {
          ws.send(JSON.stringify(hello()));
          setTimeout(() => { ws.send(JSON.stringify(delta("px", 1, rows))); }, 200);
          ws.onMessage((m) => sent.push(String(m)));
        },
        setup: async (page) => { await page.addInitScript(() => { window.__connect = () => window.FlowsUI.rt.connect({ topics: ["px"] }); }); },
      });
      await o.page.evaluate(() => window.__connect());
      await o.page.waitForTimeout(900);
      const out = await o.page.evaluate(() => ({ stats: window.FlowsUI.rt.measure(), status: window.FlowsUI.rt.status(), strips: window.FlowsUI.rt.strips() }));
      await o.ctx.close();
      return out;
    };
    const prod = await run(PROD, [quote("SYN001", 100, 99, T0 - 500)]);
    eq(prod.stats.fixture, 1, "A RAIL FRAME NAMING SYN001 ON THE PRODUCTION ORIGIN is dropped and counted");
    eq(prod.status.topics.px.sq, 0, "it advanced no sequence");
    eq(prod.status.topics.px.rows, 0, "and merged no row");
    const rows = JSON.stringify(prod.strips || {});
    ok(!/SYN001/.test(rows), "so the adapters hold no trace of it");
    const clean = await run(PROD, [quote("AAPL", 100, 99, T0 - 500)]);
    eq(clean.stats.fixture, 0, "while a frame of real names is not counted");
    eq(clean.status.topics.px.rows, 1, "and is merged");
    const control = await run(TEST, [quote("SYN001", 100, 99, T0 - 500)]);
    eq([control.stats.fixture, control.status.topics.px.rows], [0, 1], "and on a .test origin the same frame merges as before");

    const edit = (list) => Object.fromEntries(list.map(([f, from, to]) => {
      const text = fs.readFileSync(path.join(ROOT, "assets/js", f), "utf8");
      assert.ok(text.indexOf(from) >= 0 && text.indexOf(from) === text.lastIndexOf(from), f + ": the planted edit must occur exactly once: " + from);
      return [f, text.replace(from, () => to)];
    }));
    const probes = async (assets) => {
      const missed = [];
      const board = await open(browser, { origin: PROD, url: "/flows/long/", html: SIDE, assets });
      const bv = await view(board.page);
      await board.ctx.close();
      if (!(bv.attr !== null && !bv.mainShown)) missed.push("quarantine");
      const ticker = await open(browser, { origin: PROD, url: "/flows/ticker/?t=SYN001", html: TICKER, assets });
      if (ticker.asked.some((k) => /^card\?t=SYN001/.test(k))) missed.push("ticker");
      await ticker.ctx.close();
      const rail = await run(PROD, [quote("SYN001", 100, 99, T0 - 500)], assets);
      if (!(rail.stats.fixture === 1 && rail.status.topics.px.rows === 0)) missed.push("rail");
      const control = await open(browser, { origin: TEST, url: "/flows/long/", html: SIDE, assets });
      if ((await view(control.page)).attr !== null) missed.push("control");
      await control.ctx.close();
      const headline = await open(browser, { origin: PROD, url: "/flows/long/", html: SIDE, assets,
        over: { only: true, board: (q) => (q.get("side") === "short" ? { rows: [] } : { sessionDate: DAY, rows: [{ t: "NVDA", s: 60, r: 1, note: "SYS100 launch" }] }) } });
      if ((await view(headline.page)).attr !== null) missed.push("headline");
      await headline.ctx.close();
      return missed;
    };
    eq(await probes(null), [], "THE SHIPPED FILES pass the five probes: quarantine, ticker, rail, .test control and a headline that says SYS100");
    const planted = {
      "the fetch scan removed": [[["flows-ui.js", "if (!FIXTURE.host && r.ok) {", "if (false) {"]], "quarantine"],
      "the scan applied on test hosts too": [[["flows-ui.js", "if (!FIXTURE.host && r.ok) {", "if (r.ok) {"]], "control"],
      "the rail keeping fixture frames": [[["flows-rt.js", "if (!UI.fixture.host && UI.fixture.nameIn(data)) {", "if (false) {"]], "rail"],
      "the ticker page not refusing": [[["flows-ticker.js", " && !UI.fixture.refuses(t) ? t : null;", " ? t : null;"]], "ticker"],
      "a token rule with no closing quote": [[["flows-ui.js", 'const TOKEN = /"(SY[A-Z]\\d{3}|GONE\\d)"/', 'const TOKEN = /"(SY[A-Z]\\d{3}|GONE\\d)/']], "headline"],
    };
    for (const [name, [list, want]] of Object.entries(planted)) {
      const missed = await probes(edit(list));
      ok(missed.includes(want), `PLANTED WRONG BUILD (${name}) fails the ${want} probe (failed: ${missed.join(", ") || "none"})`);
    }
  }

  {
    const html = PAGES.FLOWS_PAGES.sidePage({ username: "test", side: "long" });
    const lists = (rows) => ({ only: true, board: (q) => (q.get("side") === "short" ? { rows: [] } : { sessionDate: DAY, rows }) });
    const clean = await open(browser, { origin: PROD, url: "/flows/long/", html, over: lists([{ t: "NVDA", s: 60, r: 1 }, { t: "SYNA", s: 40, r: 2 }]) });
    const cv = await view(clean.page);
    eq(cv.attr, null, "REAL NAMES AND LOOKALIKES ARE NOT QUARANTINED: NVDA and SYNA on the production origin render");
    await clean.ctx.close();
    const dirty = await open(browser, { origin: PROD, url: "/flows/long/", html, over: lists([{ t: "NVDA", s: 60, r: 1 }, { t: "SYN001", s: 40, r: 2 }]) });
    const dv = await view(dirty.page);
    eq(dv.attr, "SYN001", "one fixture name among real ones quarantines the page, and names it");
    await dirty.ctx.close();
    const marked = await open(browser, { origin: PROD, url: "/flows/long/", html, over: { only: true, board: () => ({ fixture: true, sessionDate: DAY, rows: [{ t: "NVDA", s: 60, r: 1 }] }) } });
    const mv = await view(marked.page);
    ok(mv.attr !== null && mv.mainShown === false, "a payload stamped fixture:true with only real names is quarantined too");
    await marked.ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`✓ flows-fixture-guard-render: ${checks} assertions — the long board from the dry emit quarantined on the production origin (hidden main, no fixture link, the status pill naming the test data, one console error, later requests held) and rendered as before on .test and loopback origins; a fixture ?t= requesting nothing; a stamped real-named card quarantined and the same card unstamped left alone; a rail frame naming a fixture dropped and counted; real names and lookalikes untouched`);
