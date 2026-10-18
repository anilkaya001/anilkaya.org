import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../shared/flows-pages.js";
import { flowsPageRows } from "../server/routes/flows-pages.js";
import { launch } from "./lib/browser.mjs";
import { BELOW_NOW } from "./lib/below-fold.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const FIX = JSON.parse(read("scripts/render-preview.fixtures.json"));
const NET_JS = "/assets/js/flows-net.js";

const ON = PAGES.overviewPage({ username: "test", summary: FIX.summary, net: true });
const OFF = PAGES.overviewPage({ username: "test", summary: FIX.summary });

eq(PAGES.overviewPage({ username: "test", summary: FIX.summary, net: false }), OFF, "net false is the page as it was");
ok(!/hmNet|home-net|flows-net/.test(OFF), "THE OLD HOME CARRIES NO NETWORK SLOT, GROUP OR STYLESHEET WITH THE SWITCH OFF");
eq(ON.match(/<i\b[^>]*data-defer="home-net"[^>]*>/g).length, 1, "the switch on declares the home-net group once");
ok(!new RegExp(`<script[^>]+${NET_JS.replace(/\./g, "\\.")}`).test(ON), "flows-net.js is never a script src of Home");
ok(ON.includes("/assets/css/flows-net.css"), "and its stylesheet is linked");

{
  const find = (rows, p) => rows.find((r) => r.path === p);
  const rows = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => FIX.summary, isOwner: (env, u) => u === "u" });
  const home = find(rows, "/flows/");
  const call = async (env, owner) => {
    const r = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => FIX.summary, isOwner: () => owner }).find((x) => x.path === "/flows/");
    return (await r.handler({ request: new Request("https://x.test/flows/"), env, url: new URL("https://x.test/flows/") })).text();
  };
  ok(home, "the Home row exists");
  for (const [env, owner, want, why] of [
    [{}, true, false, "an unset switch is off, even for the owner"],
    [{ FLOWS_HOME_NET: "off" }, true, false, "off is off"],
    [{ FLOWS_HOME_NET: "" }, true, false, "empty is off"],
    [{ FLOWS_HOME_NET: "maybe" }, true, false, "an unknown value is off"],
    [{ FLOWS_HOME_NET: "members" }, false, false, "a value other than on or owner admits nobody"],
    [{ FLOWS_HOME_NET: "owner" }, false, false, "owner mode shows a member nothing"],
    [{ FLOWS_HOME_NET: " Owner " }, true, true, "owner mode shows the owner the slot"],
    [{ FLOWS_HOME_NET: "on" }, false, true, "on shows a member the slot"],
    [{ FLOWS_HOME_NET: " ON " }, true, true, "on shows the owner the slot"],
  ]) ok((await call(env, owner)).includes('id="hmNet"') === want, `${why}`);
  ok(/^FLOWS_HOME_NET\s*=\s*"on"/m.test(read("wrangler.toml")), "wrangler.toml ships the switch on: the owner opened the Home network to every member on 2026-10-12");
}

async function open(browser, { viewport = { width: 1440, height: 900 }, html = ON, alerts = FIX.overview.flowalerts, status = 200, netStatus = 200 } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(BELOW_NOW);
  await context.addInitScript(() => {
    window.__ls = new Set();
    const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
    const ids = new WeakMap();
    let n = 0;
    const key = (t, type, fn, cap) => {
      if (!fn) return null;
      if (!ids.has(t)) ids.set(t, ++n);
      if (!ids.has(fn)) ids.set(fn, ++n);
      return ids.get(t) + ":" + type + ":" + ids.get(fn) + ":" + (typeof cap === "object" ? !!(cap && cap.capture) : !!cap);
    };
    EventTarget.prototype.addEventListener = function (type, fn, cap) { const k = key(this, type, fn, cap); if (k) window.__ls.add(k); return add.call(this, type, fn, cap); };
    EventTarget.prototype.removeEventListener = function (type, fn, cap) { const k = key(this, type, fn, cap); if (k) window.__ls.delete(k); return rem.call(this, type, fn, cap); };
  });
  const page = await context.newPage();
  const errors = [];
  const log = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    log.push(u.pathname);
    if (u.pathname === NET_JS && netStatus !== 200) return route.fulfill({ status: netStatus, body: "" });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/flowalerts") return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(alerts) });
    if (u.pathname === "/api/flows/universe") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const k = Object.keys(FIX.overview).find((x) => key.includes(x));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIX.overview[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  return { context, page, errors, log };
}

const mounted = (page) => page.waitForFunction(() => document.querySelector("#hmNetHost canvas") && window.FlowsUI.net.of(document.getElementById("hmNetHost")), null, { timeout: 20000 });

const browser = await launch();
try {
  {
    const { context, page, errors, log } = await open(browser);
    await page.goto("https://example.test/flows/");
    await mounted(page);
    ok(log.includes(NET_JS), "THE NETWORK MODULE IS REQUESTED ONLY ONCE THE SLOT IS REACHED");
    const info = await page.evaluate(() => ({ canvas: document.querySelectorAll("#hmNetHost canvas").length, global: Object.keys(window.FlowsUI.net).sort() }));
    ok(info.canvas >= 1, "the scene is mounted in the Home slot");
    eq(info.global, ["model", "mount", "of"], "the module's frozen API is untouched");
    await page.waitForFunction(() => window.FlowsUI.net.of(document.getElementById("hmNetHost")).model(), null, { timeout: 15000 });
    const cons = await page.evaluate(async () => {
      const res = await fetch("/api/flows/flowalerts").then((r) => r.json());
      const want = res.rows.reduce((a, r) => a + (Number.isFinite(r.prem) && r.prem > 0 ? r.prem : 0), 0);
      const M = window.FlowsUI.net.of(document.getElementById("hmNetHost")).model();
      const same = window.FlowsUI.net.model(res.rows, { out: "lean" });
      const sums = M.layers.map((l) => l.reduce((a, n) => a + n.v, 0));
      return { want, total: M.total, same: same.total, sums, host: document.getElementById("hmNetHost").className };
    });
    ok(cons.want > 0, "the fixture carries flagged premium");
    ok(Math.abs(cons.total - cons.want) < 1, `THE MOUNTED MODEL HOLDS EVERY FLAGGED DOLLAR: ${cons.total} against ${cons.want}`);
    ok(Math.abs(cons.same - cons.total) < 1, "and equals the pure model on the same rows, so Home and Unusual share one model");
    for (const s of cons.sums) ok(Math.abs(s - cons.want) < 1, `and every layer sums to the same premium (${s})`);
    ok(/is-slot/.test(cons.host), "the host keeps its reserved height while the network has rows");
    eq(await page.evaluate(() => window.FlowsUI.net.of(document.getElementById("hmNetHost")).ambient()), false, "the owner's Home opens still, as the Unusual page does");
    const before = await page.evaluate(() => window.__ls.size);
    await page.evaluate(() => window.FlowsUI.net.of(document.getElementById("hmNetHost")).destroy());
    const after = await page.evaluate(() => window.__ls.size);
    const own = await page.evaluate(() => document.querySelectorAll("#hmNetHost canvas").length);
    const mountedBefore = info.canvas;
    ok(mountedBefore >= 1 && after < before, `DESTROY REMOVES THE LISTENERS THE MODULE ADDED (${before} to ${after})`);
    eq(own, 0, "and its canvas");
    eq(errors, [], "no page error on the owner's Home");
    await context.close();
  }

  for (const width of [320, 390, 1440]) {
    const { context, page, errors } = await open(browser, { viewport: { width, height: 900 } });
    await page.goto("https://example.test/flows/");
    await mounted(page);
    await page.waitForTimeout(600);
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, host: document.getElementById("hmNetHost").scrollWidth, hostC: document.getElementById("hmNetHost").clientWidth, canvasW: document.querySelector("#hmNetHost canvas").getBoundingClientRect().width, cardW: document.getElementById("hmNet").getBoundingClientRect().width }));
    ok(o.sw <= o.cw, `NO HORIZONTAL OVERFLOW AT ${width}: page ${o.sw} of ${o.cw}`);
    ok(o.canvasW <= o.cardW + 1, `and the canvas fits its card at ${width}`);
    eq(errors, [], `no page error at ${width}`);
    const ref = await open(browser, { viewport: { width, height: 900 }, html: PAGES.unusualPage({ username: "test", owner: true }) });
    await ref.page.goto("https://example.test/flows/unusual/");
    await ref.page.waitForSelector("#uaNet canvas", { timeout: 20000 });
    await ref.page.waitForTimeout(600);
    const r = await ref.page.evaluate(() => ({ host: document.getElementById("uaNet").scrollWidth, hostC: document.getElementById("uaNet").clientWidth }));
    ok(o.host - o.hostC <= r.host - r.hostC + 1, `and the scene overflows its slot no more than the same module does on the Unusual page at ${width} (${o.host - o.hostC} against ${r.host - r.hostC}): one module, one behaviour`);
    await ref.context.close();
    await context.close();
  }

  {
    const { context, page, errors, log } = await open(browser, { html: OFF });
    await page.goto("https://example.test/flows/");
    await page.waitForFunction(() => document.getElementById("ccMetals").children.length > 0 && document.querySelectorAll("#ccAlerts *").length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    eq(await page.evaluate(() => document.getElementById("hmNet")), null, "WITH THE SWITCH OFF THE OLD HOME DRAWS NO NETWORK");
    ok(!log.includes(NET_JS), "and never requests the module");
    eq(errors, [], "and raises no error: the old Home works unchanged");
    await context.close();
  }

  {
    const { context, page, errors } = await open(browser, { alerts: { status: "pending", rows: [] } });
    await page.goto("https://example.test/flows/");
    await mounted(page);
    await page.waitForTimeout(500);
    const host = await page.evaluate(() => document.getElementById("hmNetHost").className);
    ok(/is-quiet/.test(host) && !/is-slot/.test(host), "A PENDING FEED LEAVES THE QUIET FORM, NOT A TALL EMPTY RESERVATION");
    eq(errors, [], "and no error");
    await context.close();
  }

  {
    const { context, page, errors } = await open(browser, { netStatus: 404 });
    await page.goto("https://example.test/flows/");
    await page.waitForFunction(() => document.getElementById("ccMetals").children.length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    ok(/The flow network is unavailable/.test(await page.evaluate(() => document.getElementById("hmNetHost").textContent)), "A FAILED MODULE FETCH SAYS SO IN THE SLOT");
    ok(await page.evaluate(() => [...document.querySelectorAll("#hmNetHost button")].some((b) => b.textContent === "Retry")), "with a Retry button");
    ok(await page.evaluate(() => document.getElementById("ccMetals").children.length > 0), "and the rest of Home is unharmed");
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-home-net-render: ${checks} checks`);
