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
const FIX = JSON.parse(read("scripts/render-preview.fixtures.json"));
const HTML = PAGES.overviewPage({ username: "test", summary: FIX.summary });
const CHUNK = "/assets/js/flows-overview-below.js";
const SINGLE_FILE_BYTES = 120103;
const DEFERRED = ["hmChg", "hmVol", "hmEvents", "hmNews"];

{
  const eager = fs.statSync(path.join(ROOT, "assets/js/flows-overview.js")).size;
  const chunk = fs.statSync(path.join(ROOT, "assets/js/flows-overview-below.js")).size;
  ok(SINGLE_FILE_BYTES - eager >= 10 * 1024, `THE FIRST-PAINT FILE IS AT LEAST 10 KB SMALLER THAN THE SINGLE FILE IT REPLACED: ${eager} B against ${SINGLE_FILE_BYTES} B (${SINGLE_FILE_BYTES - eager} B freed)`);
  ok(chunk > 10 * 1024 && chunk + eager < SINGLE_FILE_BYTES + 4096, `and the two files together are within 4 KB of the single file (${chunk + eager} B): a visit pays the same bytes`);
  ok(!new RegExp(`<script[^>]+${CHUNK.replace(/\./g, "\\.")}`).test(HTML), "the chunk is not a script src of the page");
  eq(HTML.match(/<i\b[^>]*data-defer="home-below"[^>]*>/g).length, 1, "the page declares the home-below group once");
  const first = read("assets/js/flows-overview.js");
  const below = read("assets/js/flows-overview-below.js");
  const names = ["paintChanged", "paintVol", "paintEvents", "paintNews", "renderSpine"];
  for (const n of names) {
    ok(new RegExp(`\\bfunction ${n}\\(`).test(below), `${n} is defined in the deferred chunk`);
    ok(!new RegExp(`\\bfunction ${n}\\(`).test(first), `and not in the first-paint file`);
  }
  ok(/kit\.attach\(\{ paintChanged, paintVol, paintEvents, paintNews, renderSpine \}\)/.test(below), "the chunk hands exactly those five painters back");
  ok(/UI\.defer\("home-below", \{ when: "visible", el: \$\("hmChg"\)/.test(first), "the first-paint file asks for the group when the first deferred module is visible");
}

async function open(browser, { viewport = { width: 1440, height: 900 }, chunk = "ok", chunkDelay = 0, dataDelay = 0, saveData = false } = {}) {
  const context = await browser.newContext({ viewport });
  const log = [];
  const state = { chunk, atLoad: null };
  await context.addInitScript((sd) => {
    window.__lcp = [];
    window.__loadAt = 0;
    addEventListener("load", () => { window.__loadAt = performance.timeOrigin + performance.now(); });
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__lcp.push(e.element ? (e.element.closest("section") || {}).id || e.element.tagName : "none");
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    if (sd) Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  }, saveData);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    log.push({ path: u.pathname, at: Date.now() });
    if (u.pathname === CHUNK) {
      state.atLoad = await page.evaluate(() => ({
        metals: document.getElementById("ccMetals").children.length,
        lean: document.getElementById("ccLean").children.length,
        bull: document.querySelectorAll("#ccBull .hm-lrow").length,
        chg: document.getElementById("ccChgList").children.length + document.getElementById("ccChgNote").children.length,
        news: document.getElementById("ccNews").children.length,
        loaded: window.__loadAt,
        homeKit: Boolean(window.FlowsUI.homeKit),
        attached: window.FlowsUI.homeKit.attached,
      })).catch(() => null);
      if (chunkDelay) await sleep(chunkDelay);
      if (state.chunk === "404") return route.fulfill({ status: 404, body: "" });
    }
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      if (dataDelay) await sleep(dataDelay);
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const k = Object.keys(FIX.overview).find((x) => key.includes(x));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIX.overview[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  return { context, page, log, state, errors };
}

const requested = (log) => log.filter((x) => x.path === CHUNK);
const hostsPainted = (page) => page.evaluate(() => {
  const n = (ids) => ids.reduce((a, id) => a + document.getElementById(id).children.length, 0);
  return { chg: n(["ccChgStats", "ccChgNote", "ccChgList", "spinePlot"]), vol: n(["ccVol"]), events: n(["ccEvents"]), news: n(["ccNews"]) };
});
const scrollNear = (page, margin) => page.evaluate((m) => window.scrollTo(0, document.getElementById("hmChg").getBoundingClientRect().top + scrollY - innerHeight - m), margin);
const firstPaintReady = (page) => page.waitForFunction(() => document.getElementById("ccMetals").children.length > 0 && document.getElementById("ccLean").children.length > 0 && document.querySelectorAll("#ccBull .hm-lrow").length > 0, null, { timeout: 15000 });
const modulesPainted = (page) => page.waitForFunction(() => document.querySelectorAll("#ccChgList .hm-crow").length > 0 && document.querySelectorAll("#spinePlot svg").length === 1 &&
  document.querySelectorAll("#ccEvents .ui-row").length > 0 && document.querySelectorAll("#ccNews .hm-news-open").length === 1 && document.querySelectorAll("#ccVol [data-empty]").length === 1, null, { timeout: 15000 });

const browser = await launch();
try {
  {
    const { context, page, log, state, errors } = await open(browser, { chunkDelay: 400 });
    await page.goto("https://example.test/flows/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await page.waitForFunction(() => window.__loadAt > 0, null, { timeout: 15000 });
    await sleep(2500);
    eq(requested(log).length, 0, "THE CHUNK IS NOT REQUESTED WHILE THE FIRST DEFERRED MODULE IS FAR BELOW THE FOLD: nothing asked for it in 2.5 s after the load event at 1440x900");
    eq(await hostsPainted(page), { chg: 0, vol: 0, events: 0, news: 0 }, "and the four deferred modules are empty bodies, not painted");
    eq(await page.evaluate(() => window.FlowsUI.homeKit.attached), false, "FlowsUI.homeKit says it is not attached");
    ok(await page.evaluate(() => document.getElementById("hmChg").getBoundingClientRect().top > innerHeight + 200), "the first deferred module is more than 200 px below the viewport");
    eq(await page.evaluate(() => window.__lcp.filter((x) => ["hmChg", "hmVol", "hmEvents", "hmNews"].includes(x))), [], "THE LARGEST CONTENTFUL PAINT IS NOT IN A DEFERRED MODULE");
    ok(await page.evaluate(() => window.__lcp.length > 0), "and one was recorded");
    const before = await page.evaluate(() => ({ metals: document.getElementById("ccMetals").children.length, hero: document.getElementById("hmHero").innerHTML.length }));
    ok(before.metals > 0 && before.hero > 200, "the hero and the first-paint modules were painted with no chunk in sight");
    const heroHtml = await page.evaluate(() => document.getElementById("hmHero").innerHTML);

    await scrollNear(page, 400);
    await sleep(700);
    eq(requested(log).length, 0, "nor 400 px below the viewport, outside the 200 px margin");
    await scrollNear(page, 150);
    await page.waitForFunction(() => window.FlowsUI.homeKit.attached, null, { timeout: 15000 });
    eq(requested(log).length, 1, "but 150 px below the viewport it is requested, once");
    const at = requested(log)[0].at;
    ok(at >= state.atLoad.loaded - 5, "AND THE REQUEST CAME AFTER THE LOAD EVENT, not before it");
    ok(state.atLoad.metals > 0 && state.atLoad.lean > 0 && state.atLoad.bull > 0, "with the first-paint modules already painted when the request began");
    eq(state.atLoad.chg + state.atLoad.news, 0, "and the deferred ones not");
    eq(state.atLoad.attached, false, "the kit was not attached when the request began");
    await modulesPainted(page);
    eq(Object.values(await hostsPainted(page)).every((n) => n > 0), true, "once the chunk has run all four modules are painted");
    eq(errors, [], "no page error");
    ok(await page.evaluate(() => document.getElementById("hmHero").innerHTML) === heroHtml, "THE HERO IS BYTE FOR BYTE WHAT IT WAS BEFORE THE CHUNK ARRIVED");
    eq(await page.evaluate(() => [...document.querySelectorAll('script[src*="flows-overview-below"]')].length), 1, "and the chunk is one script element");
    await context.close();
  }

  {
    const { context, page, log, state, errors } = await open(browser, { chunkDelay: 1200 });
    await page.goto("https://example.test/flows/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await scrollNear(page, 100);
    await page.waitForFunction(() => window.FlowsUI.homeKit.attached, null, { timeout: 15000 });
    await modulesPainted(page);
    eq(state.atLoad.chg, 0, "DATA THAT ARRIVED BEFORE THE CHUNK IS HELD AND PAINTED WHEN IT LANDS: the module was empty when the chunk was asked for");
    const rows = await page.evaluate(() => ({
      chg: document.querySelectorAll("#ccChgList .hm-crow").length, sub: document.getElementById("ccChgSub").textContent.trim(),
      ev: document.querySelectorAll("#ccEvents .ui-row").length, evSub: document.getElementById("ccEventsSub").textContent.trim(),
      news: document.getElementById("ccNewsSub").textContent.trim(), vol: document.querySelector("#ccVol [data-empty]").dataset.empty,
    }));
    ok(rows.chg > 0 && /\d/.test(rows.sub), `What changed draws its rows and its count (${rows.chg}, ${rows.sub})`);
    ok(rows.ev > 0 && /\d/.test(rows.evSub), `Reporting draws its rows and its count (${rows.ev}, ${rows.evSub})`);
    ok(/\d/.test(rows.news), `Headlines say how many (${rows.news})`);
    eq(rows.vol, "pending", "Volatility shows its named state when the regime key has not published");
    eq(errors, [], "no page error");
    eq(requested(log).length, 1, "one request for the chunk");
    await context.close();
  }

  {
    const { context, page, log, errors } = await open(browser, { dataDelay: 1800 });
    await page.goto("https://example.test/flows/", { waitUntil: "commit" });
    await page.waitForFunction(() => window.__loadAt > 0, null, { timeout: 15000 });
    await scrollNear(page, 100);
    await page.waitForFunction(() => window.FlowsUI.homeKit.attached, null, { timeout: 15000 });
    eq(await hostsPainted(page), { chg: 0, vol: 0, events: 0, news: 0 }, "THE CHUNK BEFORE THE DATA: attached and nothing painted for data that has not arrived");
    await firstPaintReady(page);
    await modulesPainted(page);
    eq(errors, [], "and when the data lands the modules paint straight away with no page error");
    eq(requested(log).length, 1, "one request for the chunk");
    await context.close();
  }

  {
    const { context, page, log, state, errors } = await open(browser, { chunk: "404" });
    await page.goto("https://example.test/flows/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await scrollNear(page, 100);
    await page.waitForSelector("#hmChg .ui-defer", { timeout: 15000 });
    const said = await page.evaluate(() => document.querySelector("#hmChg .ui-defer").textContent);
    ok(/The lower modules is unavailable/.test(said) && /Retry/.test(said), `A CHUNK THAT DOES NOT LOAD SAYS SO AT THE MODULES IT OWES: ${said}`);
    eq(await hostsPainted(page), { chg: 0, vol: 0, events: 0, news: 0 }, "and the four modules stay empty");
    ok(await page.evaluate(() => document.querySelectorAll("#ccBull .hm-lrow").length > 0 && document.getElementById("ccMetals").children.length > 0), "while the first-paint modules are untouched");
    state.chunk = "ok";
    await page.click("#hmChg .ui-defer button");
    await modulesPainted(page);
    eq(await page.evaluate(() => document.querySelectorAll("#hmChg .ui-defer").length), 0, "Retry loads the chunk, paints the modules and removes the line");
    ok(requested(log).length >= 2, "by asking again");
    eq(errors.filter((e) => !/404|Failed to load/.test(e)), [], "no page error");
    await context.close();
  }

  {
    const { context, page, log, errors } = await open(browser, { saveData: true });
    await page.goto("https://example.test/flows/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await scrollNear(page, 100);
    await page.waitForSelector("#hmChg .ui-defer", { timeout: 15000 });
    await sleep(800);
    eq(requested(log).length, 0, "DATA SAVER: nothing is requested until the button is pressed");
    ok(/Data Saver is on/.test(await page.evaluate(() => document.querySelector("#hmChg .ui-defer").textContent)), "and the line says why");
    await page.click("#hmChg .ui-defer button");
    await modulesPainted(page);
    eq(requested(log).length, 1, "pressing it loads the chunk once and paints the modules");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page, errors } = await open(browser, { viewport: { width: 390, height: 844 } });
    await page.goto("https://example.test/flows/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await scrollNear(page, 100);
    await modulesPainted(page);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "AT 390 PX nothing overflows once the lower modules are drawn");
    eq(errors, [], "no page error at 390 px");
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`flows-home-below-render: ${checks} checks passed`);
