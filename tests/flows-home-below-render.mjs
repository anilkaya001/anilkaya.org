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
const HOME_BENTO = { bytes: 12000, why: "design v3 Lane 3: the fit controller, the pager, the sheet, the numerals and the net decision live in the first-paint file, and the lower modules it hands to the chunk are unchanged" };

{
  const eager = fs.statSync(path.join(ROOT, "assets/js/flows-overview.js")).size;
  const chunk = fs.statSync(path.join(ROOT, "assets/js/flows-overview-below.js")).size;
  ok(SINGLE_FILE_BYTES - eager >= 10 * 1024, `THE FIRST-PAINT FILE IS AT LEAST 10 KB SMALLER THAN THE SINGLE FILE IT REPLACED: ${eager} B against ${SINGLE_FILE_BYTES} B (${SINGLE_FILE_BYTES - eager} B freed)`);
  ok(chunk > 10 * 1024 && chunk + eager < SINGLE_FILE_BYTES + 16384 + HOME_BENTO.bytes, `and the two files together are within 16 KB of the single file plus the named bento allowance (${chunk + eager} B)`);
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
  ok(/UI\.defer\("home-below", \{ when: "visible", el: \$\("hmChg"\)/.test(first), "the first-paint file asks for the group through the visible trigger on What changed, which is on the first screen at the xl, l and m fits");
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
        news: document.querySelectorAll("#ccNews .hm-news-open").length,
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

const LIVE_NOW = "2026-08-25T15:00:00Z";
const LIVE_DAY = "2026-08-25";
const BOARDS_DAY = FIX.overview["board?side=long"].sessionDate;
async function openLive(browser, { viewport = { width: 1440, height: 820 }, tideDay = LIVE_DAY, hash = "" } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const nowMs = Date.parse(LIVE_NOW);
  const iso = (ms) => new Date(ms).toISOString();
  await page.clock.install({ time: new Date(LIVE_NOW) });
  const tide = { status: "ok", t: [tideDay + "T13:30:00Z", tideDay + "T14:00:00Z", tideDay + "T14:30:00Z", tideDay + "T14:55:00Z"],
    ncp: [1e7, 5e7, 9e7, 1.06e8], npp: [5e6, 1e7, 2e7, 2.7e7], net: [5e6, 4e7, 7e7, 132.4e6] };
  const fresh = { state: "live", readAt: iso(nowMs - 20000), liveUntil: iso(nowMs + 600000), staleAt: iso(nowMs + 1800000) };
  const strips = { status: "ok", session: tideDay, fields: ["px", "prev", "chg", "net", "lean", "iv30", "iv30p"],
    rows: { SYN046: [380, 386.4, -0.0166, 1e6, 0.2, 0.3, 0.3], SYX901: [101, 100, 0.01, 1e6, 0.2, 0.3, 0.29], SYX902: [52, 50, 0.04, -2e6, -0.4, 0.5, 0.48] }, fresh: { readAt: fresh.readAt } };
  const focus = { status: "ok", sessionDate: BOARDS_DAY, readAt: iso(nowMs - 86400e3), fields: strips.fields,
    rows: { SYX901: [100, 99, 0.0101, 1e6, 0.2, 0.3, 0.29], SYX902: [50, 49, 0.0204, -2e6, -0.4, 0.5, 0.48] },
    groups: [{ id: "mag7", label: "Mag 7", kind: "lead", tickers: ["SYX901", "SYX902"] }], closes: {} };
  const env = (keys) => ({ serverNow: nowMs, phase: { phase: "rth", endsAt: iso(nowMs + 3600e3), nextOpen: iso(nowMs + 86400e3) },
    keys: Object.fromEntries(keys.map((k) => [k, k === "market" ? { status: "ok", updatedAt: nowMs - 20000, fresh, payload: { status: "ok", session: tideDay, fresh: { readAt: fresh.readAt }, tide } }
      : k === "strips" ? { status: "ok", updatedAt: nowMs - 20000, fresh, payload: strips } : { status: "pending" }])) });
  const ev = FIX.overview.events;
  const days = ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31", "2026-09-01"];
  const events = { ...ev, sessionDate: BOARDS_DAY, gateOrigin: LIVE_DAY, rows: ev.rows.slice(0, 6).map((r, i) => ({ ...r, d: days[i], sdte: i })) };
  const alerts = { ...FIX.overview.flowalerts, rows: [{ t: "SPX", oc: "SPXW260825C06500000", cp: "C", k: 6500, exp: LIVE_DAY, prem: 1.19e8, size: 900, askPrem: 0, bidPrem: 0,
    spanStart: LIVE_DAY + "T14:47:00Z", spanEnd: LIVE_DAY + "T14:49:00Z", rule: "x" }, ...FIX.overview.flowalerts.rows] };
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (u.pathname.startsWith("/api/rt/")) return j({ error: { code: "rt_off", message: "off" } }, 404);
    if (u.pathname === "/api/flows/lk") return j(env(u.searchParams.get("k").split(",")));
    if (u.pathname === "/api/flows/now") return j({ serverNow: nowMs, expected: BOARDS_DAY, phase: { phase: "rth", endsAt: iso(nowMs + 3600e3), nextOpen: iso(nowMs + 86400e3) }, keys: {} });
    if (u.pathname === "/api/flows/flowalerts") return j(alerts);
    if (u.pathname === "/api/flows/events") return j(events);
    if (u.pathname === "/api/flows/focus") return j(focus);
    if (u.pathname === "/api/flows/universe") return j({ status: "pending" });
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const k = Object.keys(FIX.overview).find((x) => key.includes(x));
      return j(k ? FIX.overview[k] : { status: "pending", rows: [] });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.goto("https://example.test/flows/" + hash);
  await page.waitForFunction(() => document.querySelectorAll("#ccVerdict [data-chip]").length === 5 && document.querySelector("#hmTideState .hm-pill:not([data-state=pending])")
    && document.querySelectorAll("#ccBull .hm-lrow").length > 0, null, { timeout: 15000 });
  await page.clock.runFor(1500);
  return { context, page, errors };
}

const requested = (log) => log.filter((x) => x.path === CHUNK);
const hostsPainted = (page) => page.evaluate(() => {
  const n = (ids) => ids.reduce((a, id) => a + [...document.getElementById(id).children].filter((c) => !c.hasAttribute("data-loading")).length, 0);
  return { chg: n(["ccChgStats", "ccChgNote", "ccChgList", "spinePlot"]), vol: n(["ccVol"]), events: n(["ccEvents"]), news: n(["ccNews"]) };
});
const scrollNear = (page) => page.click("#hmPager [data-page=glance]");
const firstPaintReady = (page) => page.waitForFunction(() => document.getElementById("ccMetals").children.length > 0 && document.getElementById("ccLean").children.length > 0 && document.querySelectorAll("#ccBull .hm-lrow").length > 0, null, { timeout: 15000 });
const modulesPainted = (page) => page.waitForFunction(() => document.querySelectorAll("#ccChgList .hm-crow").length > 0 &&
  document.querySelectorAll("#ccEvents .ui-row").length > 0 && document.querySelectorAll("#ccNews .hm-news-open").length === 1 && document.querySelectorAll("#ccVol [data-empty]:not([data-loading])").length === 1, null, { timeout: 15000 });

const browser = await launch();
try {
  {
    const { context, page, log, state, errors } = await open(browser, { chunkDelay: 400 });
    await page.goto("https://example.test/flows/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await page.waitForFunction(() => window.__loadAt > 0, null, { timeout: 15000 });
    await page.waitForFunction(() => window.FlowsUI.homeKit.attached, null, { timeout: 15000 });
    eq(requested(log).length, 1, "AT 1440x900 THE CHUNK IS REQUESTED ONCE WITHOUT ANYONE ASKING: What changed is on the first screen, so the request follows the load event");
    const at = requested(log)[0].at;
    ok(at >= state.atLoad.loaded - 5, "AND THE REQUEST CAME AFTER THE LOAD EVENT, not before it");
    ok(state.atLoad.metals > 0 && state.atLoad.lean > 0 && state.atLoad.bull > 0, "with the first-paint modules already painted when the request began");
    eq(state.atLoad.chg + state.atLoad.news, 0, "and the deferred ones not");
    eq(state.atLoad.attached, false, "the kit was not attached when the request began");
    eq(await page.evaluate(() => document.getElementById("hmStage").dataset.fit + "/" + document.getElementById("hmStage").dataset.page), "l/now", "the stage is at the l fit on the Now page");
    eq(await page.evaluate(() => window.__lcp.filter((x) => ["hmChg", "hmVol", "hmEvents", "hmNews"].includes(x))), [], "THE LARGEST CONTENTFUL PAINT IS NOT IN A DEFERRED MODULE");
    ok(await page.evaluate(() => window.__lcp.length > 0), "and one was recorded");
    ok(await page.evaluate(() => document.getElementById("hmHero").innerHTML.length > 200), "the hero was painted with no chunk in sight");
    const heroHtml = await page.evaluate(() => document.getElementById("hmHero").innerHTML);
    await modulesPainted(page);
    eq(Object.values(await hostsPainted(page)).every((n) => n > 0), true, "once the chunk has run all four modules are painted");
    eq(errors, [], "no page error");
    ok(await page.evaluate(() => document.getElementById("hmHero").innerHTML) === heroHtml, "THE HERO IS BYTE FOR BYTE WHAT IT WAS BEFORE THE CHUNK ARRIVED");
    eq(await page.evaluate(() => [...document.querySelectorAll('script[src*="flows-overview-below"]')].length), 1, "and the chunk is one script element");
    eq(await page.evaluate(() => ["hmVol", "hmEvents", "hmNews"].map((id) => document.querySelector("#" + id + " [data-loading]") === null)), [true, true, true], "the loading faces of Volatility, Reporting and Headlines are gone once the chunk has painted them");
    eq(await page.evaluate(() => document.querySelectorAll("#spinePlot svg").length), 0, "the score spine is not drawn in the What changed strip, which has no room for it");
    await page.click("#hmChg .hm-all");
    await page.waitForFunction(() => document.querySelectorAll("dialog.hm-sheet #spinePlot svg").length === 1 && document.querySelectorAll("dialog.hm-sheet #ccChgList .hm-crow").length > 0, null, { timeout: 15000 });
    ok(true, "AND SHOW ALL OPENS WHAT CHANGED IN THE SHEET WITH ITS SPINE AND ITS ROWS drawn");
    await context.close();
  }

  {
    const { context, page, log, state } = await open(browser, { viewport: { width: 390, height: 844 }, chunkDelay: 200 });
    await page.goto("https://example.test/flows/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await page.waitForFunction(() => window.__loadAt > 0, null, { timeout: 15000 });
    await sleep(2500);
    eq(requested(log).length, 0, "AT 390x844 THE CHUNK IS NOT REQUESTED UNTIL THE GLANCE PAGE OPENS: nothing asked for it in 2.5 s after the load event");
    eq(await page.evaluate(() => window.FlowsUI.homeKit.attached), false, "FlowsUI.homeKit says it is not attached");
    eq(await page.evaluate(() => document.getElementById("hmStage").dataset.fit + "/" + document.getElementById("hmStage").dataset.page), "s/now", "the stage is at the s fit on the Now page");
    eq(await hostsPainted(page), { chg: 0, vol: 0, events: 0, news: 0 }, "and the four deferred modules are not painted");
    await page.click("#hmPager [data-page=names]");
    await page.click("#hmPager [data-page=flow]");
    await sleep(700);
    eq(requested(log).length, 0, "nor when the Flow or Names page opens, which hold no deferred module");
    await scrollNear(page);
    await page.waitForFunction(() => window.FlowsUI.homeKit.attached, null, { timeout: 15000 });
    eq(requested(log).length, 1, "but opening the Glance page requests it, once");
    ok(requested(log)[0].at >= state.atLoad.loaded - 5, "after the load event");
    await context.close();
  }

  {
    const { context, page, log, state, errors } = await open(browser, { chunkDelay: 1200 });
    await page.goto("https://example.test/flows/", { waitUntil: "commit" });
    await firstPaintReady(page);
    await page.waitForFunction(() => window.FlowsUI.homeKit.attached, null, { timeout: 15000 });
    await modulesPainted(page);
    eq(state.atLoad.chg, 0, "DATA THAT ARRIVED BEFORE THE CHUNK IS HELD AND PAINTED WHEN IT LANDS: the module was empty when the chunk was asked for");
    const rows = await page.evaluate(() => ({
      chg: document.querySelectorAll("#ccChgList .hm-crow").length, sub: document.getElementById("ccChgSub").textContent.trim(),
      ev: document.querySelectorAll("#ccEvents .ui-row").length, evSub: document.getElementById("ccEventsSub").textContent.trim(),
      news: document.getElementById("ccNewsSub").textContent.trim(), vol: document.querySelector("#ccVol [data-empty]:not([data-loading])").dataset.empty,
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
    await scrollNear(page);
    await modulesPainted(page);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "AT 390 PX nothing overflows once the lower modules are drawn");
    eq(errors, [], "no page error at 390 px");
    await context.close();
  }

  {
    const { context, page, errors } = await openLive(browser);
    const head = await page.evaluate(() => ({
      title: document.getElementById("fxTitle").textContent,
      date: document.getElementById("ccMetaDate").getAttribute("datetime"),
      dateText: document.getElementById("ccMetaDate").textContent,
      boards: (document.getElementById("hmBoardsDay") || {}).textContent || null,
    }));
    eq(head.title, "Today", "DURING A LIVE SESSION WHOSE TIDE IS TODAY'S, THE HOME HEADER SAYS TODAY, not Last session over the nightly boards' date");
    eq(head.date, LIVE_DAY, "and the caption names today's session machine-readably");
    eq(head.dateText, "Tuesday, Aug 25", "in words");
    eq(head.boards, "Boards from Mon, Aug 24", "while the boards' own session moves into the caption, so neither date is hidden");
    const chips = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#ccVerdict [data-chip]")].map((c) => [c.dataset.chip,
      { session: c.dataset.session || null, stamp: (c.querySelector(".hm-chip-s") || {}).textContent || null }])));
    for (const k of ["Flow bias", "Breadth", "Cleared"]) {
      eq(chips[k].session, BOARDS_DAY, `THE NIGHTLY ${k.toUpperCase()} CHIP NAMES ITS SESSION under a live tide of another day`);
      eq(chips[k].stamp, "Mon close", `and prints it on the chip (${k})`);
    }
    const said = await page.evaluate(() => { document.querySelector('#ccVerdict [data-chip="Breadth"]').click(); return document.getElementById("fxPopB").textContent; });
    ok(/SessionMon, Aug 24/.test(said), `the chip's disclosure states the session too (${said.slice(0, 160)})`);
    await page.keyboard.press("Escape");
    const tideEnd = await page.evaluate(() => {
      const svg = document.querySelector("#hmTide svg[role=img]");
      const r = svg.getBoundingClientRect();
      const t = [...svg.querySelectorAll("text")].find((n) => n.textContent === "+$132.4M");
      return t ? { right: t.getBoundingClientRect().right, edge: r.right } : null;
    });
    ok(tideEnd && tideEnd.right <= tideEnd.edge + 0.5, `the tide's end label sits inside the chart (${JSON.stringify(tideEnd)})`);

    const names = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#ccBull .hm-lrow")].slice(0, 3).map((r) => {
      const c = r.querySelector(".hm-chg");
      return [r.dataset.ticker, { text: c.textContent, src: c.dataset.src || null, session: c.dataset.session || null }];
    })));
    eq(names.SYN046.text, "−1.66%", "A NAMES ROW WHOSE TICKER IS IN TODAY'S LIVE STRIPS SHOWS TODAY'S CHANGE, as the boards do, not the nightly close-over-close");
    eq(names.SYN046.src, "live", "marked as the live read");
    eq(names.SYN351.session, BOARDS_DAY, "a row with no live price keeps its nightly change and names the session it is from");
    ok(/Mon$/.test(names.SYN351.text), `with the weekday printed under the figure (${names.SYN351.text})`);

    const side = await page.evaluate(() => {
      const row = [...document.querySelectorAll("#ccAlerts .hm-arow")].find((r) => r.querySelector("b").textContent === "SPX");
      const s = row && row.querySelector(".hm-side");
      return s ? { meter: s.classList.contains("ui-meter"), text: s.textContent, title: s.title } : null;
    });
    eq(side && side.meter, false, "A FLAGGED WINDOW THE VENDOR DID NOT SIDE DRAWS NO METER TRACK, which would read as a zero");
    eq(side && side.text, "none sided", "it says none sided in the meter's place, the word the Unusual page uses");
    eq(side && side.title, "Ask-side share of the premium the vendor sided: none sided", "under the meter's own label");

    await page.waitForFunction(() => document.querySelectorAll("#ccEvents .ui-row").length >= 6, null, { timeout: 15000 });
    const ev = await page.evaluate(() => [...document.querySelectorAll("#ccEvents .ui-row")].slice(0, 6).map((r) => r.textContent));
    ok(/Aug 25 · today/.test(ev[0]), `REPORTING COUNTS SESSIONS FROM TODAY, not from the nightly's session: a report today says today (${ev[0]})`);
    ok(/Aug 26 · next session/.test(ev[1]), `tomorrow's is the next session (${ev[1]})`);
    ok(/Aug 27 · in 2 sessions/.test(ev[2]), `and the one after says sessions in words (${ev[2]})`);
    ok(/Aug 31 · in 4 sessions/.test(ev[4]), `across a weekend the count is trading sessions (${ev[4]})`);
    ok(ev.every((t) => !/in \d+s\b/.test(t)), "no row prints a bare s that reads as seconds");
    eq(errors, [], "no page error in the live session");
    await context.close();
  }

  {
    const { context, page, errors } = await openLive(browser, { tideDay: BOARDS_DAY });
    const head = await page.evaluate(() => ({
      title: document.getElementById("fxTitle").textContent, boards: Boolean(document.getElementById("hmBoardsDay")),
      stamped: [...document.querySelectorAll("#ccVerdict [data-session]")].map((c) => c.dataset.chip + " " + c.querySelector(".hm-chip-s").textContent),
    }));
    eq(head.title, "Last session", "WITH NOTHING OF TODAY ON THE PAGE (a tide and boards of yesterday) the header stays Last session");
    eq(head.boards, false, "and no second date is printed");
    eq(head.stamped, ["Put/call Jul 24 close"], "and only a chip read from an older session than the caption's is stamped, with its own date: the fixture's put/call totals are a month old");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page, errors } = await openLive(browser, { viewport: { width: 390, height: 844 } });
    const head = await page.evaluate(() => {
      const meta = document.querySelector(".hm-meta");
      const b = document.getElementById("hmBoardsDay");
      return { fits: meta.scrollWidth <= meta.clientWidth + 1 && (!b || b.scrollWidth <= b.clientWidth + 1), wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        chips: [...document.querySelectorAll("#ccVerdict [data-chip] .ui-chip-v")].filter((v) => v.scrollWidth > v.clientWidth + 1).length };
    });
    ok(head.fits, "AT 390 PX the caption with both dates fits without an ellipsis");
    eq(head.wide, 0, "and the page does not scroll sideways");
    eq(head.chips, 0, "no stamped chip figure is cut");
    const tideEnd = await page.evaluate(() => {
      const svg = document.querySelector("#hmTide svg[role=img]");
      const r = svg.getBoundingClientRect();
      const t = [...svg.querySelectorAll("text")].find((n) => n.textContent === "+$132.4M");
      return t ? { right: t.getBoundingClientRect().right, edge: r.right } : null;
    });
    ok(tideEnd && tideEnd.right <= tideEnd.edge + 0.5, `AT 390 PX THE TIDE'S END LABEL IS WHOLE inside the chart, not cut to +$132.4l (${JSON.stringify(tideEnd)})`);
    await page.click("#hmPager [data-page=glance]");
    await page.click("#hmLeaders .hm-open");
    await page.waitForSelector("dialog.hm-sheet #ccLeaders .hm-qhead", { timeout: 15000 });
    const headCells = await page.evaluate(() => [...document.querySelectorAll("#ccLeaders .hm-qhead:not(.is-2) > span")]
      .filter((s) => s.offsetWidth > 0).map((s) => ({ text: s.textContent, cut: s.scrollWidth > s.clientWidth + 1 })));
    const net = headCells.find((c) => c.text === "Net premium");
    ok(net && !net.cut, `AT 390 PX THE LEADERS HEADER PRINTS Net premium WHOLE (${JSON.stringify(headCells)})`);
    eq(errors, [], "no page error at 390 px");
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`flows-home-below-render: ${checks} checks passed`);
