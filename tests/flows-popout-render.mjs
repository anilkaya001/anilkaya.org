import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import { ROOT, openMarket, alertsFixture, universeFixture } from "./lib/market-fixtures.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const TOKEN = "0123456789abcdef";
const POPOUT = "/assets/js/flows-popout.js";
const POPOUT_CSS = "/assets/css/flows-popout.css";
const ALERTS = alertsFixture({ n: 170, seed: 23 });
const BY_NAME = new Map();
let TOTAL = 0;
for (const r of ALERTS.rows) {
  if (!(r.prem > 0)) continue;
  const sided = (Number(r.askPrem) || 0) + (Number(r.bidPrem) || 0);
  if (sided > r.prem) continue;
  BY_NAME.set(r.t, (BY_NAME.get(r.t) || 0) + sided);
  TOTAL += sided;
}
const RANKED = [...BY_NAME.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
const SIZES = [[1440, 820, false], [1024, 768, false], [390, 844, true]];

const browser = await launch();

async function openNet({ viewport = { width: 1440, height: 820 }, coarse = false, alerts = ALERTS, alertsStatus = 200, universe = universeFixture(), patch = null, hash = "" } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: coarse, isMobile: coarse, reducedMotion: "reduce" });
  const html = PAGES.networkPage({ username: "test" });
  await context.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) src = src.replaceAll(from, to);
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname === "/api/flows/flowalerts") {
      if (alertsStatus !== 200) return route.fulfill({ status: alertsStatus, contentType: "application/json", body: "{}" });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(alerts) });
    }
    if (u.pathname === "/api/flows/universe") return route.fulfill({ contentType: "application/json", body: JSON.stringify(universe) });
    if (u.pathname.startsWith("/api/flows/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending", rows: [] }) });
    if (u.pathname === "/peer.html") return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="en"><title>peer</title></html>' });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("https://example.test/flows/network/" + hash);
  return { context, page, errors };
}

function anchored(patch) {
  for (const [file, edits] of Object.entries(patch)) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const [from] of edits) ok(src.includes(from), "the planted wrong build's anchor is in " + file + ": " + from.slice(0, 60));
  }
  return patch;
}

async function waitChips(page) {
  const found = await page.waitForSelector("#pnNetHost .nm-chip", { timeout: 20000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(400);
  return found;
}

async function shape(page) {
  return page.evaluate(() => {
    const mod = document.getElementById("pnNet").getBoundingClientRect();
    const de = document.documentElement;
    const stage = document.querySelector("#pnNetHost .nm-stage");
    const within = (el) => {
      if (!el) return true;
      const r = el.getBoundingClientRect();
      if (!r.height && !r.width) return true;
      return r.top >= mod.top - 1 && r.bottom <= mod.bottom + 1 && r.left >= mod.left - 1 && r.right <= mod.right + 1;
    };
    return {
      sh: de.scrollHeight, ih: innerHeight, sw: de.scrollWidth, iw: innerWidth,
      bottom: mod.bottom, right: mod.right, left: mod.left, h: mod.height,
      svgIn: within(document.querySelector("#pnNetHost .nm-svg")),
      legIn: within(document.querySelector("#pnNetHost .nm-legend")),
      barIn: within(document.querySelector("#pnNetHost .nm-bar")),
      stageOver: stage ? stage.scrollHeight - stage.clientHeight : 0,
      stageH: stage ? stage.clientHeight : 0,
      h1: [...document.querySelectorAll("h1")].map((x) => x.textContent.trim()),
    };
  });
}

function screenProblems(s, tag) {
  const bad = [];
  if (s.sh > s.ih + 1) bad.push(tag + ": the page scrolls (" + s.sh + " against " + s.ih + ")");
  if (s.sw > s.iw + 1) bad.push(tag + ": the page scrolls sideways (" + s.sw + " against " + s.iw + ")");
  if (s.bottom > s.ih + 1 || s.right > s.iw + 1 || s.left < -1) bad.push(tag + ": the module leaves the viewport");
  if (!s.svgIn || !s.legIn || !s.barIn) bad.push(tag + ": the map, its controls or its legend are cut by the module");
  if (s.stageOver > 1) bad.push(tag + ": the map's stage scrolls inside the module");
  if (JSON.stringify(s.h1) !== JSON.stringify(["Flow network"])) bad.push(tag + ": the page's one heading is not Flow network: " + s.h1.join(" | "));
  return bad;
}

async function paintProblems({ viewport, coarse = false, patch = null }) {
  const bad = [];
  const tag = viewport.width + "x" + viewport.height;
  const { context, page, errors } = await openNet({ viewport, coarse, patch });
  try {
    if (!(await waitChips(page))) { bad.push(tag + ": no chip was drawn from the fixture alerts"); return bad; }
    const m = await page.evaluate(() => {
      const host = document.getElementById("pnNetHost");
      const api = window.FlowsUI.netMap.of(host);
      const M = api ? api.model() : null;
      return { chips: host.querySelectorAll(".nm-chip").length, total: M ? M.total : null, read: (host.querySelector(".nm-read") || {}).textContent || "",
        names: M ? M.layers[2].filter((n) => n.id !== "n:~").map((n) => n.id.slice(2)) : [] };
    });
    if (m.total === null || Math.abs(m.total - TOTAL) > 1e-6 * TOTAL) bad.push(tag + ": the network's total " + m.total + " is not the fixture's sided premium " + TOTAL);
    if (!m.names.length || JSON.stringify(m.names) !== JSON.stringify(RANKED.slice(0, m.names.length))) bad.push(tag + ": the names shown are not the largest by premium, in order");
    if (!m.read.startsWith(RANKED[0])) bad.push(tag + ": the readout at rest is not the largest name, " + RANKED[0] + ": " + m.read.slice(0, 60));
    const s = await shape(page);
    bad.push(...screenProblems(s, tag));
    if (s.stageH < 120) bad.push(tag + ": the map's stage is " + s.stageH + " px tall, so the module does not fill the screen");
    if (s.h < s.ih * 0.4) bad.push(tag + ": the module is " + Math.round(s.h) + " px of a " + s.ih + " px screen");
    if (errors.length) bad.push(tag + ": page errors " + errors.join(" | "));
  } finally {
    await context.close();
  }
  return bad;
}

async function linkProblems({ patch = null } = {}) {
  const bad = [];
  const { context, page, errors } = await openNet({ patch, hash: "#l=w=" + TOKEN });
  try {
    if (!(await waitChips(page))) { bad.push("no chip was drawn"); return bad; }
    const peer = await context.newPage();
    await peer.goto("https://example.test/peer.html");
    await peer.evaluate((token) => {
      window.__got = [];
      window.__bc = new BroadcastChannel("flows-link:" + token);
      window.__bc.onmessage = (e) => window.__got.push(e.data);
    }, TOKEN);
    const T = RANKED[1];
    const U = RANKED[2];
    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) {
      await peer.evaluate((t) => window.__bc.postMessage({ v: 1, id: "peer0001", s: { A: { kind: "ticker", value: t, source: "peer" } } }), T);
      await page.waitForTimeout(250);
      landed = await page.evaluate((t) => {
        const c = document.querySelector("#pnNetHost .nm-chip.is-sel");
        return Boolean(c && c.dataset.id === "n:" + t);
      }, T);
    }
    if (!landed) bad.push("a selection of " + T + " from the peer never reached the network");
    const read = await page.evaluate(() => document.querySelector("#pnNetHost .nm-read").textContent);
    if (!read.startsWith(T)) bad.push("the readout does not follow the peer's selection: " + read.slice(0, 60));
    await page.waitForTimeout(1200);
    const echoed = await peer.evaluate(() => window.__got.length);
    if (echoed) bad.push("the window sent the peer's selection back " + echoed + " time(s)");
    await page.click(`#pnNetHost .nm-chip[data-id="n:${U}"]`);
    for (let i = 0; i < 20; i++) {
      const has = await peer.evaluate((u) => window.__got.some((m) => m && m.s && m.s.A && m.s.A.value === u), U);
      if (has) break;
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(800);
    const got = await peer.evaluate(() => window.__got);
    const forU = got.filter((m) => m && m.s && m.s.A && m.s.A.kind === "ticker" && m.s.A.value === U);
    if (forU.length !== 1) bad.push("a click on " + U + " reached the peer " + forU.length + " times, not once");
    if (got.length !== forU.length) bad.push("the window sent the peer more than the click: " + JSON.stringify(got).slice(0, 200));
    if (errors.length) bad.push("page errors " + errors.join(" | "));
  } finally {
    await context.close();
  }
  return bad;
}

const STATES = [
  ["a failed read", { alertsStatus: 500 }, [/Unavailable/, /HTTP 500/], /HTTP 500/],
  ["an unpublished feed", { alerts: { status: "pending", rows: [] } }, [/Reading/, /not published/], /not published/],
  ["an empty read", { alerts: { ...ALERTS, rows: [] } }, [/Nothing flagged/, /quiet market/], /Nothing flagged/],
];

async function stateProblems({ patch = null, only = null } = {}) {
  const bad = [];
  for (const [name, opts, says, status] of STATES) {
    if (only && only !== name) continue;
    const { context, page, errors } = await openNet({ ...opts, patch });
    try {
      const seen = await page.waitForFunction((pats) => {
        const p = document.querySelector("#pnNetHost .nm .nm-empty");
        if (!p) return false;
        const t = p.textContent;
        return pats.every((s) => new RegExp(s).test(t)) ? t : false;
      }, says.map((r) => r.source), { timeout: 15000 }).then((hnd) => hnd.jsonValue()).catch(() => null);
      if (!seen) {
        const now = await page.evaluate(() => (document.getElementById("pnNetHost") || {}).textContent || "");
        bad.push(name + " does not say what it is with its reason: " + now.slice(0, 120));
        continue;
      }
      const st = await page.evaluate(() => ({ status: document.getElementById("pnStatus").textContent, chips: document.querySelectorAll("#pnNetHost .nm-chip").length }));
      if (!status.test(st.status)) bad.push(name + ": the status line does not carry the reason: " + st.status);
      if (st.chips) bad.push(name + ": chips are drawn");
      const s = await shape(page);
      if (s.sh > s.ih + 1 || s.sw > s.iw + 1) bad.push(name + ": the page scrolls");
      if (errors.length) bad.push(name + ": page errors " + errors.join(" | "));
    } finally {
      await context.close();
    }
  }
  return bad;
}

async function popProblems() {
  const bad = [];
  for (const [w, h, coarse] of [[1440, 820, false], [390, 844, true]]) {
    const tag = w + "x" + h;
    const { context, page, errors } = await openMarket(browser, { viewport: { width: w, height: h }, coarse, alerts: ALERTS });
    try {
      await page.waitForFunction(() => Boolean(window.FlowsUI && window.FlowsUI.link && typeof window.FlowsUI.link.join === "function"), null, { timeout: 15000 });
      await page.evaluate(() => { window.FlowsUI.link.join("probe", { on() {} }); });
      const loaded = await page.waitForFunction(() => typeof window.FlowsUI.link.popout === "function", null, { timeout: 15000 }).then(() => true).catch(() => false);
      if (!loaded) { bad.push(tag + ": the link body never offered popout"); continue; }
      await page.evaluate(() => {
        window.__opened = [];
        window.open = (...args) => { window.__opened.push(args.map(String)); return null; };
        window.FlowsUI.link.emit("probe", { kind: "ticker", value: "NVDA", source: "probe" });
      });
      await page.click("#mkT-network");
      const shown = await page.waitForSelector("#mkNetPop:not([hidden])", { timeout: 15000 }).then(() => true).catch(() => false);
      if (!shown) { bad.push(tag + ": the Pop out button is hidden although popout exists"); continue; }
      const box = await page.evaluate(() => {
        const b = document.getElementById("mkNetPop");
        const r = b.getBoundingClientRect();
        return { w: r.width, h: r.height, tab: b.tabIndex, inert: Boolean(b.closest("[inert]")), name: b.getAttribute("aria-label") || b.textContent };
      });
      if (box.tab < 0 || box.inert) bad.push(tag + ": the Pop out button is not keyboard reachable");
      if (!/Pop out/.test(box.name)) bad.push(tag + ": the button's name does not say Pop out");
      if (coarse && (box.w < 43.5 || box.h < 43.5)) bad.push(tag + ": the Pop out button is " + Math.round(box.w) + "x" + Math.round(box.h) + " on a coarse pointer");
      await page.focus("#mkNetPop");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      const opened = await page.evaluate(() => window.__opened);
      if (opened.length !== 1) bad.push(tag + ": the button opened " + opened.length + " windows");
      else {
        const [url, target] = opened[0];
        if (!/^\/flows\/network\/#l=A:t=NVDA;w=[0-9a-f]{16}$/.test(url)) bad.push(tag + ": the pop-out opened " + url + ", not the Network on the current selection");
        if (target !== "_blank") bad.push(tag + ": the pop-out did not open a new window");
      }
      if (errors.length) bad.push(tag + ": page errors " + errors.join(" | "));
    } finally {
      await context.close();
    }
  }
  return bad;
}

const MUTANTS = [
  ["a received selection is sent back to the peer", () => linkProblems({ patch: anchored({ [POPOUT]: [["want = { kind: s.kind, value: s.value };", "want = { kind: s.kind, value: s.value }; L.emit(OWNER, { kind: s.kind, value: s.value, source: \"network\" });"]] }) })],
  ["a failed alerts read is swallowed", () => stateProblems({ only: "a failed read", patch: anchored({ [POPOUT]: [[".catch((error) => ALERTS.emit(null, {", ".catch((error) => error || ALERTS.emit(null, {"]] }) })],
  ["the module overruns the screen", () => paintProblems({ viewport: { width: 1440, height: 820 }, patch: anchored({ [POPOUT_CSS]: [["height: 100dvh;", "height: 140dvh;"]] }) })],
];

try {
  for (const [w, h, coarse] of SIZES) {
    eq(await paintProblems({ viewport: { width: w, height: h }, coarse }), [], `${w}x${h}: THE NETWORK PAINTS FROM THE FIXTURE ALERTS ON ONE SCREEN, NO PAGE SCROLL AND NOTHING CLIPPED`);
  }
  eq(await linkProblems(), [], "A SELECTION FROM A BROADCASTCHANNEL PEER APPEARS ONCE WITH NO ECHO, AND A CHIP CHOSEN HERE REACHES THE PEER ONCE");
  eq(await stateProblems(), [], "A FAILED, AN UNPUBLISHED AND AN EMPTY FEED EACH SAY WHAT THEY ARE WITH THEIR REASON");
  eq(await popProblems(), [], "THE MARKET NETWORK'S POP OUT BUTTON OPENS /flows/network/ ON THE CURRENT SELECTION, FROM THE KEYBOARD, 44 PX ON A COARSE POINTER");
  for (const [name, run] of MUTANTS) ok((await run()).length > 0, `PLANTED WRONG BUILD FAILS: ${name}`);
} finally {
  await browser.close();
}

console.log(`flows-popout-render: ${checks} checks, the Network pop-out painted at 1440x820, 1024x768 and 390x844, linked to a peer window without echo, its three feed states, the Market button, and ${MUTANTS.length} planted wrong builds`);

