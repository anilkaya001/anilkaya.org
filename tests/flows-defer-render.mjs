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
<img id="slowimg" src="/fx/slow.png" alt="" width="1" height="1">`;

const HTML = PAGES.flowsDocument({ title: "Defer", description: "x", active: "ticker", username: "test", chrome: false, body });

async function open(browser, { saveData = false, badFirst = false, slowImg = 700 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const log = [];
  const state = { bad: badFirst };
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
    const { context, page } = await open(browser, { slowImg: 50 });
    await page.goto("https://example.test/flows/defer/");
    const kind = await page.evaluate(() => Object.keys(window.FlowsUI).filter((k) => k === "defer").concat(typeof window.FlowsUI.defer));
    eq(kind, ["defer", "function"], "FlowsUI.defer is exported");
    await context.close();
  }

  console.log(`✓ flows-defer-render: ${checks} assertions — FlowsUI.defer asks for nothing before the load event, a visible group waits for its slot to come within 200 px, files of a group run in declared order, save-data shows a button and fetches nothing until it is clicked, and a 404 leaves the slot's table with an unavailable note and a Retry that works`);
} finally {
  await browser.close();
}
