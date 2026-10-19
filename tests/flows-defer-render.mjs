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

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const body = `
<div id="top" style="height:40px">top</div>
<section id="slot1"><table id="t1"><tbody><tr><td>placeholder one</td></tr></tbody></table></section>
<i hidden data-defer="idle1" data-src="/fx/idle1.js?v=1"></i>
<div id="spacer" style="height:3000px"></div>
<section id="slot2" style="height:300px"><table id="t2"><tbody><tr><td>placeholder two</td></tr></tbody></table></section>
<i hidden data-defer="vis1" data-src="/fx/vis1.js?v=1"></i>
<section id="slot3"><table id="t3"><tbody><tr><td>placeholder three</td></tr></tbody></table></section>
<i hidden data-defer="sd1" data-src="/fx/sd1.js?v=1"></i>
<section id="slot4"><table id="t4"><tbody><tr><td>placeholder four</td></tr></tbody></table></section>
<i hidden data-defer="bad1" data-src="/fx/bad1.js?v=1"></i>
<section id="slot5"></section>
<i hidden data-defer="ord1" data-src="/fx/ord-a.js?v=1"></i>
<i hidden data-defer="ord1" data-src="/fx/ord-b.js?v=1"></i>
<section id="slot6"></section>
<i hidden data-defer="seq1" data-src="/fx/seq-a.js?v=1"></i>
<i hidden data-defer="seq1" data-src="/fx/seq-b.js?v=1"></i>
<img id="slowimg" src="/fx/slow.png" alt="" width="1" height="1">`;

const HTML = PAGES.flowsDocument({ title: "Defer", description: "x", active: "ticker", username: "test", chrome: false, body });

async function open(browser, { saveData = false, badFirst = false, slowImg = 700, seqBad = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const log = [];
  const state = { bad: badFirst, seqBad };
  await context.addInitScript((sd) => {
    window.__order = [];
    window.__loadAt = 0;
    addEventListener("load", () => { window.__loadAt = performance.now(); });
    if (sd) Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  }, saveData);
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    const name = u.pathname.replace(/^\/fx\//, "");
    if (u.pathname === "/fx/slow.png") {
      log.push("slow-start");
      await sleep(slowImg);
      log.push("slow-done");
      return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==", "base64") });
    }
    if (u.pathname.startsWith("/fx/")) {
      log.push(name);
      if (name === "bad1.js" && state.bad) return route.fulfill({ status: 404, body: "" });
      if (name === "seq-a.js" && state.seqBad) return route.fulfill({ status: 404, body: "" });
      if (name === "ord-a.js") await sleep(300);
      const id = name.replace(/\.js$/, "");
      return route.fulfill({ contentType: "text/javascript", body: `window.__order.push(${JSON.stringify(id)});` });
    }
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const slot = (id) => document.getElementById(id);
      window.__p = {
        idle1: window.FlowsUI.defer("idle1", { label: "Idle one", el: slot("slot1") }),
        vis1: window.FlowsUI.defer("vis1", { when: "visible", label: "Visible one", el: slot("slot2") }),
        sd1: window.FlowsUI.defer("sd1", { label: "Saver one", el: slot("slot3") }),
        bad1: window.FlowsUI.defer("bad1", { label: "Bad one", el: slot("slot4") }),
        ord1: window.FlowsUI.defer("ord1", { label: "Order one", el: slot("slot5") }),
        seq1: window.FlowsUI.defer("seq1", { label: "Sequence one", el: slot("slot6") }),
      };
      window.__resolved = {};
      for (const k of Object.keys(window.__p)) window.__p[k].then(() => { window.__resolved[k] = performance.now(); });
    });
  });
  return { context, page, log, state, errors };
}

const browser = await launch();
try {
  {
    const { context, page, log, errors } = await open(browser, { slowImg: 700 });
    await page.goto("https://example.test/flows/defer/", { waitUntil: "commit" });
    await page.waitForFunction(() => window.__loadAt > 0, null, { timeout: 15000 });
    ok(log.indexOf("slow-done") !== -1, "the page's load waited for the slow image, so the next lines compare against a late load");
    ok(log.indexOf("idle1.js") === -1 || log.indexOf("idle1.js") > log.indexOf("slow-done"),
       "NO DEFERRED REQUEST BEFORE THE LOAD EVENT: the idle file was not asked for while the slow image was still in flight");
    await page.waitForFunction(() => window.__resolved && window.__resolved.idle1, null, { timeout: 10000 });
    ok(await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => /idle1\.js/.test(r.name)).every((r) => r.startTime >= performance.getEntriesByType("navigation")[0].loadEventStart)),
       "and the resource timing agrees: the request started at or after loadEventStart");
    eq(await page.evaluate(() => window.__order.filter((x) => x === "idle1")), ["idle1"], "the idle group ran once");
    eq(await page.evaluate(() => document.querySelector("#slot1 table") !== null && document.querySelector("#slot1 .ui-defer") === null), true,
       "and left the slot's own content alone when nothing went wrong");

    await sleep(500);
    eq(log.filter((x) => x === "vis1.js").length, 0, "A VISIBLE GROUP FAR BELOW THE FOLD IS NOT REQUESTED: the slot is thousands of pixels away");
    await page.evaluate(() => window.scrollTo(0, document.getElementById("slot2").offsetTop - innerHeight - 400));
    await sleep(700);
    eq(log.filter((x) => x === "vis1.js").length, 0, "nor 400 px below the viewport, outside the 200 px margin");
    await page.evaluate(() => window.scrollTo(0, document.getElementById("slot2").offsetTop - innerHeight - 150));
    await page.waitForFunction(() => window.__resolved.vis1, null, { timeout: 10000 });
    eq(log.filter((x) => x === "vis1.js").length, 1, "but 150 px below the viewport it is, once");

    eq(log.filter((x) => x === "sd1.js").length, 1, "without Data Saver the plain group loads on its own");

    const ordered = await page.evaluate(() => window.__resolved.ord1 ? window.__order.filter((x) => /^ord-/.test(x)) : null);
    eq(ordered, ["ord-a", "ord-b"], "files of one group run in the order they are declared even when the first is slow (async = false)");

    const again = await page.evaluate(async () => {
      const a = window.FlowsUI.defer("idle1", { el: document.getElementById("slot1") });
      return { same: a === window.__p.idle1, n: window.__order.filter((x) => x === "idle1").length };
    });
    eq(again, { same: true, n: 1 }, "a second call for the same group returns the same promise and loads nothing more");
    eq(log.filter((x) => x === "idle1.js").length, 1, "one request for the file in all");
    eq(errors, [], "and nothing throws");
    await context.close();
  }

  {
    const { context, page, log, errors } = await open(browser, { saveData: true, slowImg: 50 });
    await page.goto("https://example.test/flows/defer/");
    await page.waitForSelector("#slot3 .ui-defer button");
    await sleep(900);
    eq(log.filter((x) => /^(idle1|sd1|ord-a|ord-b)\.js$/.test(x)).length, 0, "SAVE-DATA MAKES NO DEFERRED REQUEST: four groups with a slot, none fetched in a second after load");
    const said = await page.evaluate(() => [...document.querySelectorAll("#slot3 .ui-defer")].map((p) => ({ text: p.textContent, role: p.getAttribute("role"), first: p === document.getElementById("slot3").firstElementChild })));
    eq(said.length, 1, "the slot carries one note");
    ok(/Data Saver is on/.test(said[0].text) && /Load Saver one/.test(said[0].text), `saying why and naming what the button loads (${said[0].text})`);
    eq([said[0].role, said[0].first], ["status", true], "as a status above the placeholder table");
    ok(await page.evaluate(() => document.querySelector("#slot3 table") !== null), "which is still there");
    eq(await page.evaluate(() => document.querySelector("#slot3 .ui-defer button").getBoundingClientRect().height >= 44), true, "and the button is a 44 px target");
    await page.click("#slot3 .ui-defer button");
    await page.waitForFunction(() => window.__resolved.sd1, null, { timeout: 10000 });
    eq(log.filter((x) => x === "sd1.js").length, 1, "the click fetches the file once");
    eq(await page.evaluate(() => document.querySelector("#slot3 .ui-defer")), null, "and the note goes away");
    eq(errors, [], "and nothing throws");
    await context.close();
  }

  {
    const { context, page, log, state, errors } = await open(browser, { badFirst: true, slowImg: 50 });
    await page.goto("https://example.test/flows/defer/");
    await page.waitForSelector("#slot4 .ui-defer button");
    const said = await page.evaluate(() => ({ text: document.querySelector("#slot4 .ui-defer").textContent, table: !!document.querySelector("#slot4 table"), button: document.querySelector("#slot4 .ui-defer button").textContent }));
    ok(/Bad one is unavailable/.test(said.text), `A 404 ON A DEFERRED FILE SHOWS THE UNAVAILABLE STATE, NOT A BLANK SLOT (${said.text})`);
    eq([said.table, said.button], [true, "Retry"], "above the table that was already there, with a Retry button");
    eq(await page.evaluate(() => !!window.__resolved.bad1), false, "and the group's promise stays pending, so no mount runs on a module that never arrived");
    eq(await page.evaluate(() => !!document.querySelector('script[src*="bad1.js"]')), false, "the failed script element is removed so a retry adds a fresh one");
    state.bad = false;
    await page.click("#slot4 .ui-defer button");
    await page.waitForFunction(() => window.__resolved.bad1, null, { timeout: 10000 });
    eq(log.filter((x) => x === "bad1.js").length, 2, "Retry asks again");
    eq(await page.evaluate(() => [document.querySelector("#slot4 .ui-defer"), window.__order.includes("bad1")]), [null, true], "and on success the note is gone and the file ran");
    eq(errors.filter((e) => !/bad1/.test(e)), [], "and nothing else throws");
    await context.close();
  }

  {
    const { context, page, log, state, errors } = await open(browser, { seqBad: true, slowImg: 50 });
    await page.goto("https://example.test/flows/defer/");
    await page.waitForSelector("#slot6 .ui-defer button");
    await sleep(300);
    eq(log.filter((x) => /^seq-/.test(x)), ["seq-a.js"], "A GROUP LOADS ITS FILES ONE AFTER ANOTHER: when the first file fails the second is never requested");
    eq(await page.evaluate(() => window.__order.filter((x) => /^seq-/.test(x))), [], "so nothing of the group has run while the group is reported unavailable");
    state.seqBad = false;
    await page.click("#slot6 .ui-defer button");
    await page.waitForFunction(() => window.__resolved.seq1, null, { timeout: 10000 });
    eq(await page.evaluate(() => window.__order.filter((x) => /^seq-/.test(x))), ["seq-a", "seq-b"], "and after Retry the files run in the declared order, the one that failed first");
    eq(log.filter((x) => /^seq-/.test(x)), ["seq-a.js", "seq-a.js", "seq-b.js"], "the retry asks for the failed file again and then for the next, once each");
    eq(errors.filter((e) => !/seq-a/.test(e)), [], "and nothing else throws");
    await context.close();
  }

  {
    const { context, page } = await open(browser, { slowImg: 50 });
    await page.goto("https://example.test/flows/defer/");
    const kind = await page.evaluate(() => Object.keys(window.FlowsUI).filter((k) => k === "defer").concat(typeof window.FlowsUI.defer));
    eq(kind, ["defer", "function"], "FlowsUI.defer is exported");
    await context.close();
  }

  {
    const SESSION = "2026-09-29";
    const NAMES = [["NVDA", 1.0, 0.7], ["SPY", 0.8, 0.4], ["TSLA", 0.6, 0.5], ["AAPL", 0.5, 0.6], ["AMZN", 0.45, 0.65], ["META", 0.4, 0.7], ["MSFT", 0.35, 0.55],
      ["AMD", 0.3, 0.6], ["MU", 0.22, 0.66], ["NFLX", 0.2, 0.5], ["COIN", 0.15, 0.6], ["XOM", 0.1, 0.4]];
    const lcg = (seed) => { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };
    const flow = () => {
      const r = lcg(31), rows = [];
      for (let i = 0; i < 70; i++) {
        let pick = r() * NAMES.reduce((a, x) => a + x[1], 0), j = 0;
        while (pick > NAMES[j][1] && j < NAMES.length - 1) { pick -= NAMES[j][1]; j++; }
        const cp = r() < NAMES[j][2] ? "C" : "P", prem = Math.round(150000 * Math.exp(r() * 3) * (0.6 + NAMES[j][1]));
        const share = Math.min(0.95, Math.max(0.05, 0.55 + (r() - 0.5) * 0.9));
        const ask = Math.round(prem * 0.9 * share), bid = Math.round(prem * 0.9 * (1 - share));
        const at = new Date(Date.parse(SESSION + "T13:35:00Z") + Math.floor(r() * 300) * 60000).toISOString();
        rows.push({ t: NAMES[j][0], oc: NAMES[j][0] + "261016" + cp + String(100000 + i), cp, k: 100 + i, exp: "2026-10-16", prem, size: Math.round(prem / 300), trades: 3, askPrem: ask, bidPrem: bid, sweep: false, floor: false, single: true, opening: false, spanStart: at, spanEnd: at, rule: "RepeatedHits", st: null, firstAt: at, lastAt: "2026-09-29T18:41:00.000Z", reads: 2 });
      }
      rows.sort((a, b) => b.prem - a.prem);
      return { v: 1, status: "ok", generatedAt: "2026-09-29T18:41:05.000Z", sessionDate: SESSION, readAt: "2026-09-29T18:41:00.000Z", refreshed: "intraday", rows, seen: rows.length, unusable: 0, shed: 0, cap: 180, coverage: {}, notes: {} };
    };
    const expectTop = (payload) => {
      const by = new Map();
      for (const r of payload.rows) {
        const e = by.get(r.t) || { t: r.t, v: 0, up: 0, down: 0 };
        e.v += r.prem; e.up += r.cp === "C" ? r.askPrem : r.bidPrem; e.down += r.cp === "C" ? r.bidPrem : r.askPrem;
        by.set(r.t, e);
      }
      return [...by.values()].sort((a, b) => b.v - a.v).slice(0, 8).map((e) => [e.t, e.up > e.down ? "Bullish" : e.down > e.up ? "Bearish" : "Unsided"]);
    };
    const HTML_U = PAGES.unusualPage({ username: "test" });
    const universe = { v: 1, status: "ok", sessionDate: "2026-09-28", t: NAMES.map((x) => x[0]), sectors: ["Technology"], sec: NAMES.map(() => 0) };

    async function openUnusual({ width = 1440, height = 900, saveData = false, netStatus = 200, flowStatus = 200, flowDelay = 0, netDelay = 0, empty = false } = {}) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      const log = [], state = { net: netStatus };
      await context.addInitScript((sd) => {
        window.__cls = 0;
        window.__lcp = null;
        try {
          window.__ls = [];
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) {
              if (e.hadRecentInput) continue;
              window.__cls += e.value;
              const card = document.getElementById("uaNetCard");
              window.__ls.push({ at: Math.round(e.startTime), value: e.value, outside: (e.sources || []).filter((x) => x.node && card && (card.compareDocumentPosition(x.node) & Node.DOCUMENT_POSITION_FOLLOWING) && !card.contains(x.node)).map((x) => x.node.id || x.node.className || x.node.nodeName) });
            }
          }).observe({ type: "layout-shift", buffered: true });
          new PerformanceObserver((l) => { const e = l.getEntries().pop(); window.__lcp = { tag: e.element ? e.element.tagName : null, at: e.startTime }; }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch (e) { void e; }
        if (sd) Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
      }, saveData);
      const payload = empty ? { ...flow(), rows: [], seen: 0 } : flow();
      await context.route("**/*", async (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith("/assets/")) {
          if (u.pathname === "/assets/js/flows-net.js") {
            log.push("net.js");
            if (netDelay) await sleep(netDelay);
            if (state.net !== 200) return route.fulfill({ status: state.net, body: "" });
          }
          const f = path.join(ROOT, u.pathname);
          if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
          return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
        }
        if (u.pathname === "/api/flows/flowalerts") {
          log.push("alerts");
          if (flowDelay) await sleep(flowDelay);
          return route.fulfill({ status: flowStatus, contentType: "application/json", body: JSON.stringify(payload) });
        }
        if (u.pathname === "/api/flows/universe") return route.fulfill({ contentType: "application/json", body: JSON.stringify(universe) });
        if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
        if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
        if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML_U });
        return route.fulfill({ status: 404, body: "" });
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
      return { context, page, log, state, errors, payload };
    }
    const mounted = (page) => page.waitForFunction(() => !!(window.FlowsUI && window.FlowsUI.net && window.FlowsUI.net.of(document.getElementById("uaNet"))), null, { timeout: 20000 });
    const below = (page) => page.evaluate(() => { const c = document.getElementById("uaChips"); return Math.round((c.getBoundingClientRect().top + scrollY) * 10) / 10; });

    for (const width of [1440, 390]) {
      const { context, page, log, errors, payload } = await openUnusual({ width, height: width === 1440 ? 900 : 844, flowDelay: 150, netDelay: 2500 });
      await page.goto("https://example.test/flows/unusual/");
      await page.waitForSelector("#uaNet .fn-slot-tab tbody tr");
      const slot = await page.evaluate(() => ({
        rows: [...document.querySelectorAll("#uaNet .fn-slot-tab tbody tr")].map((r) => [r.querySelector("th").textContent, r.lastElementChild.textContent.replace(/^\S+\s/, "")]),
        title: document.querySelector("#uaNet .fn-slot-t").textContent,
        note: document.querySelector("#uaNet .fn-slot-n:last-child").textContent,
        heights: document.getElementById("uaNet").getBoundingClientRect().height,
        netNode: !!document.querySelector("#uaNet canvas"),
      }));
      eq(slot.rows, expectTop(payload), `BEFORE THE MODULE MOUNTS THE SLOT SHOWS ITS TABLE (${width} px): the eight largest names by flagged premium, each with its lean by the convention`);
      ok(/Lean is a convention/.test(slot.note), "with the convention said under it");
      eq(slot.netNode, false, "and there is no canvas yet");
      const before = await below(page);
      await mounted(page);
      const loadAt = await page.evaluate(() => performance.getEntriesByType("navigation")[0].loadEventStart);
      const netAt = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => /flows-net\.js/.test(r.name)).map((r) => r.startTime));
      eq(netAt.length, 1, "the network script is fetched once");
      ok(netAt[0] >= loadAt, `and not before the load event (${Math.round(netAt[0])} ms against ${Math.round(loadAt)} ms)`);
      eq(log.filter((x) => x === "net.js").length, 1, "one request for it in all");
      await page.waitForFunction(() => document.querySelector("#uaNet .fn-stage"));
      const after = await below(page);
      const hostH = await page.evaluate(() => Math.round(document.getElementById("uaNet").getBoundingClientRect().height));
      console.log(`  unusual ${width}px: card ${await page.evaluate(() => Math.round(document.getElementById('uaNet').getBoundingClientRect().width))} px, slot ${Math.round(slot.heights)} px, mounted ${hostH} px, chips ${before} to ${after}, layout shift ${await page.evaluate(() => window.__cls.toFixed(4))}`);
      ok(Math.abs(after - before) <= 8, `THE SLOT RESERVES ITS SPACE (${width} px): what sits below the card moved ${Math.abs(after - before)} px when the network mounted, of ${hostH}`);
      await sleep(700);
      const moved = await page.evaluate(() => window.__ls.filter((e) => e.outside.length).map((e) => e.at + " ms: " + e.outside.join(", ")));
      eq(moved, [], `NOTHING BELOW THE NETWORK'S CARD MOVES (${width} px): no layout shift, from first paint to the mounted network, has a source that comes after #uaNetCard in the page`);
      const lcp = await page.evaluate(() => window.__lcp);
      ok(lcp && lcp.tag !== "CANVAS", `the largest contentful paint is not a canvas (${lcp && lcp.tag})`);
      eq(await page.evaluate(() => document.querySelector("#uaNet .fn-slot")), null, "the slot's table is gone once the module has mounted");
      eq(errors, [], "and nothing throws");
      await context.close();
    }

    {
      const off = [];
      for (const w of [320, 360, 480, 600, 768, 900, 1100, 1280, 1366, 1680, 1920]) {
        const { context, page } = await openUnusual({ width: w, height: 900 });
        await page.goto("https://example.test/flows/unusual/");
        await mounted(page);
        await page.waitForFunction(() => document.querySelector("#uaNet .fn-stage"));
        await sleep(300);
        const m = await page.evaluate(() => {
          const h = document.getElementById("uaNet");
          const content = [...h.children].reduce((a, c) => a + c.getBoundingClientRect().height, 0) + (h.children.length - 1) * parseFloat(getComputedStyle(h).rowGap || 0);
          return { w: Math.round(h.getBoundingClientRect().width), content: Math.round(content), reserved: parseFloat(getComputedStyle(h).minHeight) };
        });
        off.push({ ...m, d: m.content - m.reserved });
        await context.close();
      }
      const worst = off.reduce((a, b) => (b.d > a.d ? b : a));
      console.log("  slot reservation against the mounted height at 11 widths, worst shortfall " + worst.d + " px at a card of " + worst.w + " px, widest surplus " + Math.min(...off.map((x) => x.d)) + " px");
      ok(off.every((x) => x.d <= 6), `THE RESERVATION NEVER FALLS SHORT: on a fresh load at every width the mounted network fits inside the height reserved for it to within 6 px (${off.filter((x) => x.d > 6).map((x) => x.w + ": " + x.d).join(", ") || "none"})`);
      ok(off.every((x) => x.d >= -80), `and never reserves more than 80 px of empty space (the module is its own scroller now, so a classic scrollbar narrows it by up to 15 px) under it (${off.filter((x) => x.d < -80).map((x) => x.w + ": " + x.d).join(", ") || "none"})`);
    }

    {
      const { context, page, log, errors } = await openUnusual({ saveData: true });
      await page.goto("https://example.test/flows/unusual/");
      await page.waitForSelector("#uaNet .ui-defer button");
      await sleep(900);
      eq(log.filter((x) => x === "net.js").length, 0, "SAVE-DATA MAKES NO DEFERRED REQUEST ON UNUSUAL: nothing for the network in a second after load");
      ok(await page.evaluate(() => !!document.querySelector("#uaNet .fn-slot-tab tbody tr")), "the table is still there with the button above it");
      ok(/Load The flow network/.test(await page.evaluate(() => document.querySelector("#uaNet .ui-defer").textContent)), "and the button names what it loads");
      await page.click("#uaNet .ui-defer button");
      await mounted(page);
      eq(log.filter((x) => x === "net.js").length, 1, "pressing it loads the network once");
      eq(errors, [], "and nothing throws");
      await context.close();
    }

    {
      const { context, page, log, state, errors } = await openUnusual({ netStatus: 404 });
      await page.goto("https://example.test/flows/unusual/");
      await page.waitForSelector("#uaNet .ui-defer button");
      const said = await page.evaluate(() => ({ text: document.querySelector("#uaNet .ui-defer").textContent, table: !!document.querySelector("#uaNet .fn-slot-tab tbody tr") }));
      ok(/The flow network is unavailable/.test(said.text), `A 404 ON THE NETWORK SHOWS UNAVAILABLE, NOT A BLANK SLOT (${said.text})`);
      ok(said.table, "with the table still under it");
      state.net = 200;
      await page.click("#uaNet .ui-defer button");
      await mounted(page);
      eq(log.filter((x) => x === "net.js").length, 2, "Retry asks again and the network mounts");
      eq(errors.filter((e) => !/flows-net/.test(e)), [], "and nothing else throws");
      await context.close();
    }

    {
      const { context, page, errors } = await openUnusual({ flowStatus: 500 });
      await page.goto("https://example.test/flows/unusual/");
      await page.waitForSelector("#uaNet .fn-slot-n");
      await mounted(page);
      const fn = await page.evaluate(() => document.querySelector("#uaNet .fn-empty") && document.querySelector("#uaNet .fn-empty").textContent);
      ok(/Unavailable|could not be loaded/.test(fn || ""), `a failed read still reaches the network once it mounts (${fn})`);
      eq(errors, [], "and nothing throws");
      await context.close();
    }
    const natural = (page) => page.evaluate(() => {
      const h = document.getElementById("uaNet"), reserved = parseFloat(getComputedStyle(h).minHeight) || 0;
      h.style.setProperty("min-height", "0", "important");
      const own = Math.round(h.getBoundingClientRect().height);
      h.style.removeProperty("min-height");
      const card = document.getElementById("uaNetCard");
      return { own, reserved, host: Math.round(h.getBoundingClientRect().height), slot: h.classList.contains("is-slot"), quiet: h.classList.contains("is-quiet"), inner: card ? card.scrollHeight - card.clientHeight : 0 };
    });
    for (const [label, opts] of [["an empty feed", { empty: true }], ["a 500", { flowStatus: 500 }]]) {
      for (const width of [1440, 390]) {
        const { context, page, errors } = await openUnusual({ width, height: width === 1440 ? 900 : 844, ...opts });
        await page.goto("https://example.test/flows/unusual/");
        await mounted(page);
        await page.waitForSelector("#uaNet .fn-empty:not([hidden])");
        await sleep(500);
        const m = await natural(page);
        const cls = await page.evaluate(() => window.__cls);
        const moved = await page.evaluate(() => window.__ls.filter((e) => e.outside.length).map((e) => e.at + " ms: " + e.outside.join(", ")));
        console.log(`  unusual ${label} ${width}px: host ${m.host} px, natural ${m.own} px, reserved ${m.reserved} px, layout shift ${cls.toFixed(4)}`);
        eq([m.slot, m.quiet], [false, true], `THE FULL-SCENE RESERVATION IS RELEASED FOR ${label.toUpperCase()} (${width} px): the host carries is-quiet and not is-slot`);
        ok(m.host - m.own <= 50, `and the card is not a one-line message in a reserved box: host ${m.host} px against its own ${m.own} px`);
        ok(m.reserved === 0 && m.inner <= 1, `inside the one-screen stage the quiet network reserves nothing and fills its own card without an inner scroll (${m.reserved} px reserved, ${m.own} px mounted, ${m.inner} px of inner scroll)`);
        eq(moved, [], `and NOTHING BELOW THE NETWORK'S CARD MOVES (${width} px)`);
        ok(cls < 0.15, `with a layout shift of ${cls.toFixed(4)}, under the 0.15 line (the network card scrolls inside its own module now)`);
        eq(errors, [], "and nothing throws");
        await context.close();
      }
    }

    {
      const off = [];
      for (const w of [320, 360, 480, 600, 768, 900, 1100, 1280, 1366, 1680, 1920]) {
        const { context, page } = await openUnusual({ width: w, height: 900, empty: true });
        await page.goto("https://example.test/flows/unusual/");
        await mounted(page);
        await page.waitForSelector("#uaNet .fn-empty:not([hidden])");
        await sleep(300);
        const m = await natural(page);
        off.push({ w, reserved: m.reserved, gap: m.host - m.own, inner: m.inner });
        await context.close();
      }
      console.log("  quiet network in the stage at 11 widths: reserved " + [...new Set(off.map((x) => x.reserved))].join("/") + " px, worst host surplus " + Math.max(...off.map((x) => x.gap)) + " px, worst inner scroll " + Math.max(...off.map((x) => x.inner)) + " px");
      ok(off.every((x) => x.reserved === 0 && x.gap <= 1), `THE QUIET NETWORK FILLS ITS CARD AT EVERY WIDTH: no height is reserved inside the one-screen stage, so the host is its card's own height (${off.filter((x) => x.reserved !== 0 || x.gap > 1).map((x) => x.w + ": " + x.reserved + "/" + x.gap).join(", ") || "none"})`);
      ok(off.every((x) => x.inner <= 1), `and the card never scrolls for an empty feed (${off.filter((x) => x.inner > 1).map((x) => x.w + ": " + x.inner).join(", ") || "none"})`);
    }

    {
      const { context, page } = await openUnusual({ width: 1440, flowDelay: 300, netDelay: 100 });
      await page.goto("https://example.test/flows/unusual/");
      await mounted(page);
      await page.waitForSelector("#uaNet .fn-stage");
      const full = await natural(page);
      eq([full.slot, full.quiet], [true, false], "a feed with rows keeps the full-scene reservation and not the quiet one");
      await context.close();
    }
  }

  console.log(`✓ flows-defer-render: ${checks} assertions — FlowsUI.defer asks for nothing before the load event, a visible group waits for its slot to come within 200 px, files of a group run in declared order, save-data shows a button and fetches nothing until it is clicked, and a 404 leaves the slot's table with an unavailable note and a Retry that works`);
} finally {
  await browser.close();
}
