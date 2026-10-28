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
const HTML = PAGES.unusualPage({ username: "test" });
const CHUNK = "/assets/js/flows-unusual-below.js";
const SINGLE_FILE_BYTES = 60177;
const FLOWLAB_DRILL_BYTES = 1203;
const SESSION = "2026-09-29";

{
  const eager = fs.statSync(path.join(ROOT, "assets/js/flows-unusual.js")).size;
  const chunk = fs.statSync(path.join(ROOT, "assets/js/flows-unusual-below.js")).size;
  ok(SINGLE_FILE_BYTES - eager >= 30 * 1024, `THE FIRST-PAINT FILE IS AT LEAST 30 KB SMALLER THAN THE SINGLE FILE IT REPLACED: ${eager} B against ${SINGLE_FILE_BYTES} B (${SINGLE_FILE_BYTES - eager} B freed)`);
  ok(chunk + eager < SINGLE_FILE_BYTES + 7424 + FLOWLAB_DRILL_BYTES, `and the two files together are within 7.25 KB of it, plus the ${FLOWLAB_DRILL_BYTES} B of the Flow Lab contract button the feed rows carry when the drill is on the page (${chunk + eager} B): a visit pays the same bytes`);
  ok(!new RegExp(`<script[^>]+${CHUNK.replace(/\./g, "\\.")}`).test(HTML), "the chunk is not a script src of the page");
  eq(HTML.match(/<i\b[^>]*data-defer="flow-below"[^>]*>/g).length, 1, "the page declares the flow-below group once");
  const first = read("assets/js/flows-unusual.js");
  const below = read("assets/js/flows-unusual-below.js");
  for (const n of ["paintTimeline", "paintNames", "paintUrgency", "paintFeed", "paintSurprise", "timelineInfo", "namesInfo", "urgencyInfo", "feedInfo", "surpriseInfo"]) {
    ok(new RegExp(`\\bfunction ${n}\\(`).test(below), `${n} is defined in the deferred chunk`);
    ok(!new RegExp(`\\bfunction ${n}\\(`).test(first), `and not in the first-paint file`);
  }
  ok(/UI\.defer\("flow-below", \{ when: "idle", el: \$\("uaTimelineCard"\)/.test(first), "the first-paint file asks for the group once the page is idle");
}

const NAMES = [["NVDA", 1.0, 0.7], ["SPY", 0.8, 0.4], ["TSLA", 0.6, 0.5], ["AAPL", 0.5, 0.6], ["AMZN", 0.45, 0.65], ["META", 0.4, 0.7], ["MSFT", 0.35, 0.55],
  ["AMD", 0.3, 0.6], ["MU", 0.22, 0.66], ["NFLX", 0.2, 0.5], ["COIN", 0.15, 0.6], ["XOM", 0.1, 0.4]];
const lcg = (seed) => { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };
const alertsPayload = () => {
  const r = lcg(31), rows = [];
  for (let i = 0; i < 70; i++) {
    let pick = r() * NAMES.reduce((a, x) => a + x[1], 0), j = 0;
    while (pick > NAMES[j][1] && j < NAMES.length - 1) { pick -= NAMES[j][1]; j++; }
    const cp = r() < NAMES[j][2] ? "C" : "P", prem = Math.round(150000 * Math.exp(r() * 3) * (0.6 + NAMES[j][1]));
    const share = Math.min(0.95, Math.max(0.05, 0.55 + (r() - 0.5) * 0.9));
    const at = new Date(Date.parse(SESSION + "T13:35:00Z") + Math.floor(r() * 300) * 60000).toISOString();
    rows.push({ t: NAMES[j][0], oc: NAMES[j][0] + "261016" + cp + String(100000 + i), cp, k: 100 + i, exp: "2026-10-16", prem, size: Math.round(prem / 300), trades: 3,
      askPrem: Math.round(prem * 0.9 * share), bidPrem: Math.round(prem * 0.9 * (1 - share)), sweep: i % 3 === 0, floor: false, single: true, opening: false,
      spanStart: at, spanEnd: at, rule: "RepeatedHits", st: i % 4 === 0 ? "board:long" : null, firstAt: at, lastAt: "2026-09-29T18:41:00.000Z", reads: 2 });
  }
  rows.sort((a, b) => b.prem - a.prem);
  return { v: 1, status: "ok", generatedAt: "2026-09-29T18:41:05.000Z", sessionDate: SESSION, readAt: "2026-09-29T18:41:00.000Z", refreshed: "intraday", rows, seen: rows.length, unusable: 0, shed: 0, cap: 180, coverage: {}, notes: {} };
};
const feedPayload = () => ({
  v: 1, status: "ok", generatedAt: "2026-09-29T18:41:05.000Z", sessionDate: SESSION, readAt: "2026-09-29T18:41:00.000Z", namesSeen: 12, dteAnchor: "sessionDate",
  contracts: { shown: 6, eligible: 9, capBound: "eligible", rows: NAMES.slice(0, 6).map((x, i) => ({ t: x[0], cp: i % 2 ? "P" : "C", k: 100 + i, expiry: "2026-10-16", vol: 9000 + i, oi: 900 + i, vor: 10 - i, doi: 50 * (i - 2), lift: 0.6, nlo: 1e5, nhi: 4e5, st: null })) },
  names: { universe: 670, ranked: 6, unranked: 664, shown: 6, rows: NAMES.slice(0, 6).map((x, i) => ({ t: x[0], sc: 4 - i * 0.4, sp: 2 + i * 0.3, st: 3 + i * 0.1, chg: 0.01 * (i - 2), putCallRatio: 0.8 })) },
  coverage: NAMES.slice(0, 4).map((x) => ({ t: x[0] })), basis: { unit: { line: "A counter, not a trade." }, date: { line: "The session date." } },
});

async function open(browser, { viewport = { width: 1440, height: 900 }, chunk = "ok", chunkDelay = 0, alerts = "ok", saveData = false, motion = false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: motion ? "no-preference" : "reduce" });
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
      if (u.pathname === "/assets/js/flows-net.js") return route.fulfill({ status: 404, body: "" });
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/flowalerts") {
      if (alerts === "500") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(alertsPayload()) });
    }
    if (u.pathname === "/api/flows/unusual") return route.fulfill({ contentType: "application/json", body: JSON.stringify(feedPayload()) });
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  return { context, page, log, state, errors };
}

const requested = (log) => log.filter((x) => x.path === CHUNK);
const scrollNear = (page) => page.click("#fdT-timeline");
const firstPaintReady = (page) => page.waitForFunction(() => document.querySelectorAll("#uaChips .ui-gchip").length >= 5 && /Both tables|No filter|filtered/i.test(document.getElementById("uaFilterNote").textContent) && document.getElementById("uaStatus").textContent.includes("contracts"), null, { timeout: 15000 });
const painted = (page) => page.waitForFunction(() => document.querySelectorAll("#uaTimeline .fu-chart svg").length === 1 && document.querySelectorAll("#uaNames .fu-nrow:not(.fu-head)").length > 0 &&
  document.querySelectorAll("#uaFeed .fu-crow:not(.fu-head)").length > 0 && document.querySelectorAll("#uaSurprise .fu-srow:not(.fu-head)").length > 0 && document.querySelectorAll("#uaUrgency .fu-urow, #uaUrgency .ui-silent").length > 0, null, { timeout: 15000 });
const counts = (page) => page.evaluate(() => ({
  timeline: document.querySelectorAll("#uaTimeline .fu-chart svg").length, names: document.querySelectorAll("#uaNames .fu-nrow:not(.fu-head)").length,
  feed: document.querySelectorAll("#uaFeed .fu-crow:not(.fu-head)").length, surprise: document.querySelectorAll("#uaSurprise .fu-srow:not(.fu-head)").length,
  urgency: document.querySelectorAll("#uaUrgency > *").length,
}));
const ZERO = { timeline: 0, names: 0, feed: 0, surprise: 0, urgency: 0 };

const browser = await launch();
try {
  {
    const { context, page, log, errors } = await open(browser);
    await page.goto("https://example.test/flows/unusual/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await page.waitForFunction(() => window.__loadAt > 0, null, { timeout: 15000 });
    const loadAt = await page.evaluate(() => window.__loadAt);
    await page.waitForFunction(() => window.FlowsUI.flowKit.attached, null, { timeout: 15000 });
    ok(requested(log).every((x) => x.at >= loadAt - 50), "THE CHUNK IS NOT REQUESTED BEFORE THE LOAD EVENT: its first request came after it at 1440x900");
    eq(requested(log).length, 1, "and it is requested once");
    ok(await page.evaluate(() => document.querySelectorAll("#uaChips .ui-gchip").length === 5 && document.querySelectorAll("#uaFilters button").length > 0), "while the chips and the filters, above the tabs, are drawn");
    await painted(page);
    const c = await counts(page);
    ok(c.names > 0 && c.feed > 0 && c.surprise > 0 && c.timeline === 1, `the five modules draw from the data that arrived before the chunk (${JSON.stringify(c)})`);
    eq(await page.evaluate(() => ["uaTimelineCard", "uaNamesCard", "uaUrgencyCard", "uaFeedCard", "uaSurpriseCard"].map((id) => document.querySelectorAll("#" + id + " .ui-mod-h > .ui-info").length)), [1, 1, 1, 1, 1], "each lower header gets its notes button once the chunk is in");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page, log, errors } = await open(browser, { alerts: "500" });
    await page.goto("https://example.test/flows/unusual/", { waitUntil: "commit" });
    await page.waitForFunction(() => window.__loadAt > 0, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll("#uaTimeline .ui-silent, #uaNames .ui-silent, #uaUrgency .ui-silent").length === 3, null, { timeout: 15000 });
    ok(true, "EACH LOWER MODULE SHOWS ITS NAMED STATE: the failed alerts feed silences Timeline, Names and Urgency");
    const said = await page.evaluate(() => ["uaTimeline", "uaNames", "uaUrgency"].map((id) => document.querySelector("#" + id + " .ui-silent").getAttribute("data-state") || document.querySelector("#" + id + " .ui-silent").getAttribute("data-empty")));
    eq(said, ["unavailable", "unavailable", "unavailable"], "as unavailable");
    await scrollNear(page, 100);
    await page.waitForFunction(() => window.FlowsUI.flowKit.attached, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll("#uaFeed .fu-crow:not(.fu-head)").length > 0, null, { timeout: 15000 });
    eq(await page.evaluate(() => ["uaTimeline", "uaNames", "uaUrgency"].map((id) => document.querySelectorAll("#" + id + " .ui-silent").length)), [1, 1, 1], "and they keep it once the chunk has run, while the contract feed draws");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page, log, errors } = await open(browser, { chunkDelay: 1200 });
    await page.goto("https://example.test/flows/unusual/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await page.evaluate(() => {
      const puts = [...document.querySelectorAll("#uaFilters .ui-seg button, #uaFilters [role=radio], #uaFilters button")].find((b) => /^Puts$/.test(b.textContent.trim()));
      puts.click();
    });
    await scrollNear(page, 100);
    await page.waitForFunction(() => window.FlowsUI.flowKit.attached, null, { timeout: 15000 });
    await painted(page);
    const names = await page.evaluate(() => [...document.querySelectorAll("#uaNames .fu-nrow:not(.fu-head) b")].map((b) => b.textContent));
    const expected = [...new Set(alertsPayload().rows.filter((r) => r.cp === "P").map((r) => r.t))];
    eq(names.slice().sort(), expected.slice().sort(), "A FILTER PRESSED BEFORE THE CHUNK IS APPLIED WHEN IT LANDS: Names lists exactly the names with a flagged put");
    ok(/puts only/i.test(await page.evaluate(() => document.getElementById("uaFilterNote").textContent)), "and the filter note says puts only");
    eq(requested(log).length, 1, "one request for the chunk");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page, log, state, errors } = await open(browser, { chunk: "404" });
    await page.goto("https://example.test/flows/unusual/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await scrollNear(page, 100);
    await page.waitForSelector("#uaTimelineCard .ui-defer", { timeout: 15000 });
    const said = await page.evaluate(() => document.querySelector("#uaTimelineCard .ui-defer").textContent);
    ok(/The lower modules is unavailable/.test(said) && /Retry/.test(said), `A CHUNK THAT DOES NOT LOAD SAYS SO AT THE MODULE IT OWES: ${said}`);
    eq(await counts(page), ZERO, "and the lower bodies stay empty");
    state.chunk = "ok";
    await page.click("#uaTimelineCard .ui-defer button");
    await painted(page);
    eq(await page.evaluate(() => document.querySelectorAll("#uaTimelineCard .ui-defer").length), 0, "Retry loads the chunk, draws the modules and removes the line");
    ok(requested(log).length >= 2, "by asking again");
    eq(errors.filter((e) => !/404|Failed to load/.test(e)), [], "no page error");
    await context.close();
  }

  {
    const { context, page, log, errors } = await open(browser, { saveData: true });
    await page.goto("https://example.test/flows/unusual/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await scrollNear(page, 100);
    await page.waitForSelector("#uaTimelineCard .ui-defer", { timeout: 15000 });
    await sleep(800);
    eq(requested(log).length, 0, "DATA SAVER: nothing is requested until the button is pressed");
    await page.click("#uaTimelineCard .ui-defer button");
    await painted(page);
    eq(requested(log).length, 1, "pressing it loads the chunk once");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page, errors } = await open(browser, { motion: true });
    await page.goto("https://example.test/flows/unusual/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await scrollNear(page, 100);
    await painted(page);
    await sleep(1500);
    const ticks = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll("#uaTimeline svg text.tx-3")].map((t) => { const r = t.getBoundingClientRect(); return { text: t.textContent, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      const clash = [];
      boxes.forEach((a, i) => boxes.forEach((c, j) => { if (j > i && a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b) clash.push(a.text + "/" + c.text); }));
      return { n: boxes.length, clash, low: boxes.filter((x) => x.text === "$100K").length };
    });
    ok(ticks.n > 0 && !ticks.clash.length && ticks.low <= 1, `THE TIMELINE'S PREMIUM TICKS DO NOT TOUCH: with every window at or above $100K that tick is printed once, at the centre line (${JSON.stringify(ticks)})`);
    eq(errors, [], "no page error with motion on");
    await context.close();
  }

  {
    const { context, page, errors } = await open(browser, { viewport: { width: 390, height: 844 } });
    await page.goto("https://example.test/flows/unusual/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await scrollNear(page, 100);
    await painted(page);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "AT 390 PX nothing overflows once the lower modules are drawn");
    eq(errors, [], "no page error at 390 px");
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`flows-flow-below-render: ${checks} checks passed`);
