import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../../shared/flows-pages.js";
import { createFlowlab } from "../../server/flowlab.js";
import * as LEG from "../../scripts/flows-legs/flowlab.mjs";
import { launch } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, "..", "..");
export const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures-flowlab.json"), "utf8"));
export const SESSION = FX.session;
export const CONTRACT = FX.contract;
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const NOW = Date.parse("2026-10-23T19:45:00Z");

export function feedOf(world, seen = null) {
  const pick = (key, p, q) => (typeof world[key] === "function" ? world[key](p, q) : world[key]);
  return async (p, q = {}) => {
    if (seen) seen.push({ p, q });
    const at = (key) => pick(key, p, q);
    const has = (s) => p.includes(s);
    if (p === "/api/screener/option-contracts") return at("contract-screener");
    if (has("/volume-profile")) return at("contract-profile");
    if (has("/intraday") && has("/api/option-contract/")) return at("contract-intraday");
    if (p.startsWith("/api/option-contract/") && p.endsWith("/flow")) return at("contract-flow");
    if (p.startsWith("/api/option-trades/flow-alerts/")) return at("flow-alert-trades");
    if (p.endsWith("/legs")) return at("multi-leg-legs");
    if (p === "/api/option-trades/multi-leg") return at("multi-leg");
    if (p.startsWith("/api/option-trades/exchange-breakdown/")) return q.by_trade_code ? at("exchange-breakdown-codes") : at("exchange-breakdown");
    if (p.endsWith("/flow-per-strike-intraday")) return at("strike-flow-intraday");
    if (p.endsWith("/flow-per-strike")) return at("flow-per-strike");
    if (p.endsWith("/flow-per-expiry")) return at("flow-per-expiry");
    if (p.startsWith("/api/group-flow/")) return at("group-greek-flow-expiry");
    if (p.includes("/greek-flow/")) return at("greek-flow-expiry");
    if (p.endsWith("/option/stock-price-levels")) return at("option-price-levels");
    if (p.startsWith("/api/darkpool/") && p.endsWith("/price-levels")) return at("darkpool-levels");
    if (p === "/api/lit-flow/recent") return at("lit-recent");
    if (p.startsWith("/api/lit-flow/")) return at("lit-ticker");
    throw new Error("unexpected feed path " + p);
  };
}

export async function nightlyBodies(world, { analytics = false } = {}) {
  const vendor = async (p, q) => {
    if (p === "/api/option-trades/optionable-tickers") return world["optionable-roots"];
    if (p.startsWith("/api/option-trades/exchange-breakdown/")) return q.by_trade_code ? world["exchange-breakdown-codes"] : world["exchange-breakdown"];
    if (p === "/api/screener/option-contracts") return world["contract-screener"];
    if (p.startsWith("/api/group-flow/")) return world["group-greek-flow-expiry"];
    if (p === "/api/analytics/window") return world["analytics-window"];
    if (p === "/api/analytics/sliding") return world["analytics-sliding"];
    throw new Error(p + " -> HTTP 404");
  };
  const out = await LEG.readFlowlab({ vendor, sessionDate: SESSION, generatedAt: "2026-10-23T21:45:00.000Z", cap: 40, env: analytics ? { FLOWS_FLOWLAB_ANALYTICS: "on" } : {}, alertRows: [{ t: "SYX101", prem: 5e6 }, { t: "SYX202", prem: 4e6 }, { t: "SYX303", prem: 3e6 }] });
  return out.payloads;
}

export async function memberBody(url, world, now = NOW) {
  const B = createFlowlab({ isRefusal: () => false });
  const vf = feedOf(world);
  const u = new URL("http://x" + url);
  const p = u.pathname.replace("/api/flows/flowlab/", "");
  const q = (k) => u.searchParams.get(k);
  const common = { session: SESSION, now, closed: false };
  if (p === "screen") return B.buildScreen(vf, { preset: q("preset"), ticker: q("t"), ...common });
  if (p === "contract") {
    const part = q("part") || "core";
    if (part === "core") return B.buildContractCore(vf, { c: q("c"), ...common });
    if (part === "alert") return B.buildAlert(vf, { id: q("id"), ...common });
    if (part === "legs") return B.buildLegs(vf, { id: q("id"), c: q("c"), ...common });
    return B.buildStructure(vf, { c: q("c"), ...common });
  }
  if (p === "name") return B.buildNameView(vf, { t: q("t"), view: q("view"), exp: q("exp"), ...common });
  if (p === "group") return B.buildGroup(vf, { g: q("g"), exp: q("exp"), ...common });
  if (p === "lit") return B.buildLitMarket(vf, common);
  if (p === "venues") return B.buildVenuesToday(vf, { t: q("t"), ...common });
  return null;
}

export async function onDemandBody(k, world, now = NOW) {
  const B = createFlowlab({ isRefusal: () => false });
  const vf = feedOf(world);
  const common = { session: SESSION, now, closed: false };
  if (k === "groups") return B.buildGroups(vf, common);
  if (k === "venues") return B.buildVenuesUniverse(vf, common);
  return null;
}

export const entryBody = (slug) => `<main class="flows-main" id="main"><h1 id="fxTitle">${slug}</h1><div id="stub">x</div></main>`;

export async function open(browser, o = {}) {
  const {
    width = 1440, height = 820, reduced = false, world = FX.worlds.normal, nightly = null, url = "/flows/flowlab/", failing = [], extraRoutes = null, time = "2026-10-23T15:30:00Z",
    touch = false, mutate = {}, responses = {}, held = {},
  } = o;
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const log = { requests: [], errors: [] };
  const page = await context.newPage();
  page.on("pageerror", (e) => log.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.errors.push(m.text()); });
  const stored = nightly !== null;
  const nightlyAll = nightly || (await nightlyBodies(world));
  const html = PAGES.flowlabPage({ username: "test" });
  const shell = (body, slug) => body;
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    log.requests.push(u.pathname + u.search);
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      let data = fs.readFileSync(f);
      const key = path.basename(u.pathname);
      if (mutate[key]) data = Buffer.from(mutate[key](data.toString("utf8")));
      return route.fulfill({ body: data, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (extraRoutes) { const r = await extraRoutes(route, u); if (r !== false) return r; }
    if (u.pathname.startsWith("/api/flows/flowlab/")) {
      const name = u.pathname.replace("/api/flows/flowlab/", "");
      const sub = name + ":" + (u.searchParams.get("view") || u.searchParams.get("part") || u.searchParams.get("k") || "");
      if (failing.includes(name) || failing.includes(sub)) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "x" } }) });
      const canned = responses[sub] || responses[name];
      if (canned) return route.fulfill({ status: canned.status || 200, contentType: "application/json", headers: canned.headers || {}, body: JSON.stringify(canned.body) });
      if (name === "nightly") {
        const k = u.searchParams.get("k");
        if (held[k]) return route.fulfill({ contentType: "application/json", headers: { "X-Flowlab-Held": held[k] }, body: JSON.stringify(nightlyAll["flowlab-" + k]) });
        if (!stored && (k === "groups" || k === "venues")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(await onDemandBody(k, world)) });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(nightlyAll["flowlab-" + k] || { status: "pending" }) });
      }
      try {
        const body = await memberBody(u.pathname + u.search, world);
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      } catch (e) {
        if (!(e && Number.isInteger(e.status) && typeof e.code === "string")) throw e;
        return route.fulfill({ status: e.status, contentType: "application/json", body: JSON.stringify({ error: { code: e.code, message: e.message }, ...(e.details || {}) }) });
      }
    }
    if (u.pathname === "/api/flows/universe") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ t: FX.tickers }) });
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: shell(html) });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.clock.install({ time: new Date(time) });
  await page.goto("http://flowlab.test" + url, { waitUntil: "load" });
  return { context, page, log, close: () => context.close() };
}

export const settle = async (page, ms = 600) => {
  await page.clock.runFor(ms);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
};

export async function until(page, fn, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(fn)) return true;
    await page.clock.runFor(200);
    await new Promise((r) => setTimeout(r, 40));
  }
  return false;
}

export { launch };
