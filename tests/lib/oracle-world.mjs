import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../../shared/flows-pages.js";
import { launch } from "./browser.mjs";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

export const FAKE_RT = `(() => {
  const U = window.FlowsUI;
  const subs = [];
  window.__fl = (c) => subs.forEach((f) => f(c));
  window.__flState = { state: "live" };
  const rt = Object.freeze({
    on: (topic, fn) => { if (topic === "fl") subs.push(fn); return () => {}; },
    fresh: () => window.__flState,
    quote: (t) => (window.__quotes && window.__quotes[t]) || null,
  });
  window.FlowsUI = Object.freeze({ ...U, rt });
})();`;

export const BODY = `
<header class="flows-head fd-head" data-fx-hero><div class="fd-head-t"><h1 id="fxTitle">Unusual</h1></div><p class="fd-meta"></p></header>
<section class="ui-card ui-mod ui-enter fn-card" id="uaNetCard" aria-labelledby="uaNetCardT">
  <header class="ui-mod-h"><h2 class="ui-mod-t" id="uaNetCardT">Flow network</h2></header>
  <div style="height:200px" id="uaNet">The flow network</div>
</section>
<div id="stub-focus"><button id="before" type="button">A control behind the sheet</button></div>`;

export function harnessHtml({ mode = "on", slug = "unusual", body = BODY, active = "unusual" } = {}) {
  const html = PAGES.flowsDocument({ title: "Unusual", description: "x", active, username: "test", body, chrome: false, scripts: ["/fx/fake-rt.js"] });
  return PAGES.oracleShell(html, mode, slug);
}

export async function open(browser, o = {}) {
  const {
    width = 1440, height = 820, reduced = false, mode = "on", slug = "unusual", html = null, records = {}, topBody, oracle = "ok",
    time = "2026-10-14T15:30:00Z", cookies = [], mutate = {}, url = "/flows/unusual/", touch = false, extraRoutes = null, rt = true, fixtureHost = true,
  } = o;
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const log = { requests: [], errors: [], vibrate: 0, oracleHits: 0, rafCalls: 0 };
  await context.addInitScript(() => {
    window.__vib = 0;
    navigator.vibrate = () => { window.__vib++; return true; };
    const raf = window.requestAnimationFrame.bind(window);
    window.__raf = 0;
    window.requestAnimationFrame = (f) => { window.__raf++; return raf(f); };
  });
  if (cookies.length) await context.addCookies(cookies.map((c) => ({ domain: "oracle.test", ...c })));
  const state = { oracle, records, topBody };
  const page = await context.newPage();
  page.on("pageerror", (e) => log.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push(m.text()); });
  const pageHtml = html || harnessHtml({ mode, slug });
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    log.requests.push(u.pathname + u.search);
    if (u.pathname === "/fx/fake-rt.js") return route.fulfill({ contentType: "text/javascript", body: rt ? FAKE_RT : "" });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      let body = fs.readFileSync(f);
      const key = path.basename(u.pathname);
      if (mutate[key]) body = Buffer.from(mutate[key](body.toString("utf8")));
      return route.fulfill({ body, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/oracle") {
      log.oracleHits++;
      if (state.oracle === "absent") return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "no" } }) });
      if (state.oracle === "failed") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      if (u.searchParams.get("top") === "1") return route.fulfill({ contentType: "application/json", body: JSON.stringify(state.topBody) });
      if (u.searchParams.has("ts")) {
        const list = u.searchParams.get("ts").split(",");
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ v: 1, records: Object.fromEntries(list.map((t) => [t, state.records[t] || null])) }) });
      }
      const t = u.searchParams.get("t");
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(state.records[t] || state.records["*"]) });
    }
    if (extraRoutes) { const r = await extraRoutes(route, u, state); if (r !== false) return r; }
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: pageHtml });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.clock.install({ time: new Date(time) });
  await page.goto("http://oracle.test" + url, { waitUntil: "load" });
  return { context, page, log, state, close: () => context.close() };
}

export const settle = async (page, ms = 800) => {
  await page.clock.runFor(ms);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
};

export async function waitOracle(page) {
  for (let i = 0; i < 60; i++) {
    const ready = await page.evaluate(() => !!(window.FlowsUI && window.FlowsUI.oracle && document.querySelector("#fxOracle") && !document.querySelector("#fxOracle").hidden));
    if (ready) return;
    await page.clock.runFor(400);
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error("the Neuron never mounted");
}

export { launch };
