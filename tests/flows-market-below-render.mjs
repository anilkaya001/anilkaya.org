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
const HTML = PAGES.marketPage({ username: "test" });
const CHUNK = "/assets/js/flows-market-below.js";
const SINGLE_FILE_BYTES = 102594;
const LOWER = ["mktSectors", "mktMovers", "mktAgainst", "mkVolume", "mkOi", "mkImpact", "mkInsiders", "mkDark", "mkSeason", "mkAdv", "mkExpiry", "mkVol", "mkRadar", "mkGroups"];
const UPPER = ["mktTilt", "mktBreadth", "mktTape", "mkTide", "mkEtfSPY", "mkEtfQQQ", "mkEtfIWM", "mkSecTides"];

{
  const eager = fs.statSync(path.join(ROOT, "assets/js/flows-market.js")).size;
  const chunk = fs.statSync(path.join(ROOT, "assets/js/flows-market-below.js")).size;
  ok(SINGLE_FILE_BYTES - eager >= 40 * 1024, `THE FIRST-PAINT FILE IS AT LEAST 40 KB SMALLER THAN THE SINGLE FILE IT REPLACED: ${eager} B against ${SINGLE_FILE_BYTES} B (${SINGLE_FILE_BYTES - eager} B freed)`);
  ok(chunk + eager < SINGLE_FILE_BYTES + 4096, `and the two files together are within 4 KB of it (${chunk + eager} B): a visit pays the same bytes`);
  ok(!new RegExp(`<script[^>]+${CHUNK.replace(/\./g, "\\.")}`).test(HTML), "the chunk is not a script src of the page");
  eq(HTML.match(/<i\b[^>]*data-defer="market-below"[^>]*>/g).length, 1, "the page declares the market-below group once");
  const first = read("assets/js/flows-market.js");
  const below = read("assets/js/flows-market-below.js");
  for (const n of ["paintSectors", "paintMovers", "paintAgainst", "paintPulse", "paintUniverse", "paintExpiry", "paintVol", "paintRadar", "paintGroups", "paintVolume", "paintOi", "paintSeason"]) {
    ok(new RegExp(`\\bfunction ${n}\\(`).test(below), `${n} is defined in the deferred chunk`);
    ok(!new RegExp(`\\bfunction ${n}\\(`).test(first), `and not in the first-paint file`);
  }
  for (const n of ["paintTilt", "paintBreadth", "paintTape", "paintTide", "paintEtfs", "paintSectorTides"]) {
    ok(new RegExp(`\\bfunction ${n}\\(`).test(first) && !new RegExp(`\\bfunction ${n}\\(`).test(below), `${n} stays in the first-paint file`);
  }
  ok(/UI\.defer\("market-below", \{ when: "visible", el: \$\("mkSectorsCard"\)/.test(first), "the first-paint file asks for the group when Momentum, the first lower module, is visible");
}

async function open(browser, { viewport = { width: 1440, height: 900 }, chunk = "ok", chunkDelay = 0, dataDelay = 0, saveData = false } = {}) {
  const context = await browser.newContext({ viewport });
  const log = [];
  const state = { chunk };
  await context.addInitScript((sd) => {
    window.__loadAt = 0;
    addEventListener("load", () => { window.__loadAt = performance.timeOrigin + performance.now(); });
    if (sd) Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  }, saveData);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    log.push({ path: u.pathname, at: Date.now() });
    if (u.pathname === CHUNK) {
      if (chunkDelay) await sleep(chunkDelay);
      if (state.chunk === "404") return route.fulfill({ status: 404, body: "" });
    }
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/flows/")) {
      if (dataDelay) await sleep(dataDelay);
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const k = Object.keys(FIX).find((x) => key.includes(x.replace(/^flows\//, "")));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIX[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  return { context, page, log, state, errors };
}

const requested = (log) => log.filter((x) => x.path === CHUNK);
const bodies = (page, ids) => page.evaluate((list) => Object.fromEntries(list.map((id) => [id, document.getElementById(id).children.length])), ids);
const zero = (ids) => Object.fromEntries(ids.map((id) => [id, 0]));
const scrollNear = (page, margin) => page.evaluate((m) => window.scrollTo(0, document.getElementById("mkSectorsCard").getBoundingClientRect().top + scrollY - innerHeight - m), margin);
const upperReady = (page) => page.waitForFunction((ids) => ids.every((id) => document.getElementById(id).children.length > 0), UPPER, { timeout: 15000 });
const lowerPainted = (page) => page.waitForFunction((ids) => ids.every((id) => document.getElementById(id).children.length > 0), LOWER, { timeout: 15000 });

const browser = await launch();
try {
  {
    const { context, page, log, errors } = await open(browser, { chunkDelay: 300 });
    await page.goto("https://example.test/flows/market/", { waitUntil: "commit" });
    await upperReady(page);
    await page.waitForFunction(() => window.__loadAt > 0, null, { timeout: 15000 });
    await sleep(2500);
    eq(requested(log).length, 0, "THE CHUNK IS NOT REQUESTED WHILE THE FIRST LOWER MODULE IS FAR BELOW THE FOLD: nothing asked for it in 2.5 s after the load event at 1440x900");
    ok(await page.evaluate(() => document.getElementById("mkSectorsCard").getBoundingClientRect().top > innerHeight + 200), "Momentum is more than 200 px below the viewport");
    eq(await bodies(page, LOWER), zero(LOWER), "the fourteen lower bodies hold no drawing");
    eq(await page.evaluate(() => window.FlowsUI.marketKit.attached), false, "FlowsUI.marketKit says it is not attached");
    const sector = await page.evaluate(() => document.querySelector("#mkSecTides [data-state], #mkSecTides .mk-small") ? 1 : 0);
    ok(sector === 1 || (await bodies(page, ["mkSecTides"])).mkSecTides > 0, "Sector tides, the last first-paint module, shows its reading or its named state with no chunk");
    const stamp = await page.evaluate(() => document.getElementById("mkPulseStamp").textContent.trim());
    ok(stamp.length > 10, `the pulse stamp is worked out by the first-paint file before the chunk exists (${stamp.slice(0, 60)})`);
    await page.click("#mkTideCard .ui-info");
    await page.waitForSelector("#fxPopB");
    ok((await page.evaluate(() => document.getElementById("fxPopB").innerText)).includes(stamp.slice(0, 20)), "and the Tide's note quotes it");
    await page.keyboard.press("Escape");
    const upperHtml = await page.evaluate((ids) => ids.map((id) => document.getElementById(id).innerHTML).join("|"), UPPER);

    await scrollNear(page, 400);
    await sleep(700);
    eq(requested(log).length, 0, "nor 400 px below the viewport");
    await scrollNear(page, 150);
    await page.waitForFunction(() => window.FlowsUI.marketKit.attached, null, { timeout: 15000 });
    eq(requested(log).length, 1, "but 150 px below the viewport it is requested, once");
    await lowerPainted(page);
    ok((await bodies(page, LOWER)) && Object.values(await bodies(page, LOWER)).every((n) => n > 0), "all fourteen lower bodies draw once the chunk has run, from data that arrived before it");
    ok(await page.evaluate(() => document.querySelectorAll("#mktSectors .mk-row, #mktSectors tr, #mktSectors > *").length > 0 && !/Pending/i.test(document.getElementById("mktSectors").textContent)), "Momentum draws the fixture's sectors, not a pending line");
    ok(await page.evaluate(() => document.querySelectorAll("#mkRadar [data-state=pending], #mkRadar [data-empty]").length > 0), "and Radar shows its named state for the regime key that has not published");
    ok(await page.evaluate((ids) => ids.map((id) => document.getElementById(id).innerHTML).join("|"), UPPER) === upperHtml, "THE FIRST-PAINT MODULES ARE BYTE FOR BYTE WHAT THEY WERE BEFORE THE CHUNK ARRIVED");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page, log, errors } = await open(browser, { chunkDelay: 1200 });
    await page.goto("https://example.test/flows/market/", { waitUntil: "commit" });
    await upperReady(page);
    await scrollNear(page, 100);
    await page.waitForFunction(() => window.FlowsUI.marketKit.attached, null, { timeout: 15000 });
    await lowerPainted(page);
    eq(errors, [], "DATA THAT ARRIVED BEFORE THE CHUNK IS HELD AND PAINTED WHEN IT LANDS, with no page error");
    eq(requested(log).length, 1, "one request for the chunk");
    await context.close();
  }

  {
    const { context, page, log, errors } = await open(browser, { dataDelay: 1800 });
    await page.goto("https://example.test/flows/market/", { waitUntil: "commit" });
    await page.waitForFunction(() => window.__loadAt > 0, null, { timeout: 15000 });
    await sleep(600);
    eq(requested(log).length, 0, "THE CHUNK IS NOT ASKED FOR BEFORE THE UPPER MODULES HAVE DRAWN: with the data 1.8 s late, nothing is requested after the load event, so the trigger is measured on the settled layout and not on the empty one");
    eq(await bodies(page, LOWER), zero(LOWER), "and nothing lower is drawn");
    await upperReady(page);
    await sleep(2500);
    eq(requested(log).length, 0, "once the upper modules have drawn the lower ones are still far below the fold and nothing is requested");
    await scrollNear(page, 100);
    await page.waitForFunction(() => window.FlowsUI.marketKit.attached, null, { timeout: 15000 });
    await lowerPainted(page);
    eq(errors, [], "and scrolling to them draws them with no page error");
    eq(requested(log).length, 1, "one request for the chunk");
    await context.close();
  }

  {
    const { context, page, log, state, errors } = await open(browser, { chunk: "404" });
    await page.goto("https://example.test/flows/market/", { waitUntil: "commit" });
    await upperReady(page);
    await scrollNear(page, 100);
    await page.waitForSelector("#mkSectorsCard .ui-defer", { timeout: 15000 });
    const said = await page.evaluate(() => document.querySelector("#mkSectorsCard .ui-defer").textContent);
    ok(/The lower modules is unavailable/.test(said) && /Retry/.test(said), `A CHUNK THAT DOES NOT LOAD SAYS SO AT THE MODULE IT OWES: ${said}`);
    eq(await bodies(page, LOWER), zero(LOWER), "and the lower bodies stay empty");
    state.chunk = "ok";
    await page.click("#mkSectorsCard .ui-defer button");
    await lowerPainted(page);
    eq(await page.evaluate(() => document.querySelectorAll("#mkSectorsCard .ui-defer").length), 0, "Retry loads the chunk, draws the modules and removes the line");
    ok(requested(log).length >= 2, "by asking again");
    eq(errors.filter((e) => !/404|Failed to load/.test(e)), [], "no page error");
    await context.close();
  }

  {
    const { context, page, log, errors } = await open(browser, { saveData: true });
    await page.goto("https://example.test/flows/market/", { waitUntil: "commit" });
    await upperReady(page);
    await scrollNear(page, 100);
    await page.waitForSelector("#mkSectorsCard .ui-defer", { timeout: 15000 });
    await sleep(800);
    eq(requested(log).length, 0, "DATA SAVER: nothing is requested until the button is pressed");
    await page.click("#mkSectorsCard .ui-defer button");
    await lowerPainted(page);
    eq(requested(log).length, 1, "pressing it loads the chunk once");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page, errors } = await open(browser, { viewport: { width: 390, height: 844 } });
    await page.goto("https://example.test/flows/market/", { waitUntil: "commit" });
    await upperReady(page);
    await scrollNear(page, 100);
    await lowerPainted(page);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "AT 390 PX nothing overflows once the lower modules are drawn");
    eq(errors, [], "no page error at 390 px");
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`flows-market-below-render: ${checks} checks passed`);
