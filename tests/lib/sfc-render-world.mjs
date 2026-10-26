import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorld } from "./sfc-world.mjs";
import { storedInput, NOW_INTRADAY } from "./sfc-stored.mjs";
import { runProduction } from "./sfc-run.mjs";
import { mulberry32 } from "./sfc-rng.mjs";
import { ledgerView, parseScope } from "../../shared/flows-sfc-view.js";
import { SECTORS } from "../../shared/flows-sfc.js";
import * as PAGES from "../../shared/flows-pages.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const HTML = PAGES.ledgerPage({ username: "test" });

export const JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-sfc.js"), "utf8");

export const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-sfc.css"), "utf8");

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

export function realisticWorld(seed = 20261023, over = {}) {
  const world = makeWorld(seed, { tickers: 90, perName: 7, pathologies: false, floor: 20000, magnitude: 4.4, ...over });
  const rnd = mulberry32(seed + 7);
  const held = runProduction(world);
  world.tide = {};
  for (const s of SECTORS) {
    const t = held.columns.get(s);
    const hc = t ? t.AC - t.BC : 0;
    const hp = t ? t.AP - t.BP : 0;
    world.tide[s] = { calls: hc + Math.round((rnd() - 0.4) * 4e9), puts: hp + Math.round((rnd() - 0.5) * 3e9) };
  }
  return world;
}

export function determinedWorld() {
  for (let seed = 40; seed < 400; seed++) {
    const world = makeWorld(seed, { tickers: 90, perName: 7, pathologies: false, tight: true, floor: 20000, magnitude: 4.4 });
    const rnd = mulberry32(seed + 3);
    const held = runProduction(world);
    world.tide = {};
    for (const sector of SECTORS) {
      const t = held.columns.get(sector);
      world.tide[sector] = { calls: (t ? t.AC - t.BC : 0) + Math.round((rnd() - 0.4) * 4e9), puts: (t ? t.AP - t.BP : 0) + Math.round((rnd() - 0.5) * 3e9) };
    }
    const view = ledgerView(storedInput(world));
    if (view.status !== "ok" || view.tilt.status !== "ok") continue;
    const verdicts = view.tilt.rows.map((r) => r.verdict);
    if (verdicts.includes("above") && verdicts.includes("below") && view.tilt.rows.length >= 7) return world;
  }
  throw new Error("no world with a proven over and under was found");
}

export function inputFor(world, over = {}) {
  return { ...storedInput(world), ...over };
}

export function respondWith(world, overrides = {}) {
  const base = inputFor(world, overrides);
  return (url) => {
    const scope = parseScope(url.searchParams.get("scope")) || { kind: "all", key: "all" };
    const period = url.searchParams.get("period") || null;
    return ledgerView({ ...base, scope, period });
  };
}

export async function mount(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", ...(o.context || {}) });
  const page = await ctx.newPage();
  if (o.now) await page.clock.setFixedTime(new Date(o.now));
  const errors = [];
  const asked = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  const world = o.world || realisticWorld();
  const respond = o.respond || respondWith(world, o.input || {});
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/assets/js/flows-sfc.js" && o.js) return r.fulfill({ contentType: "text/javascript", body: o.js });
    if (u.pathname === "/assets/css/flows-sfc.css" && o.css) return r.fulfill({ contentType: "text/css", body: o.css });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) asked.push(u.pathname + u.search);
    if (u.pathname === "/api/flows/ledger") {
      if (o.fail) return r.fulfill({ status: o.fail, contentType: "application/json", body: "{}" });
      const body = await respond(u);
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(body), headers: { "X-Payload-Updated": String(NOW_INTRADAY) } });
    }
    if (u.pathname === "/api/flows/now") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ serverNow: NOW_INTRADAY, phase: null, keys: {} }) });
    if (u.pathname === "/api/flows/meta") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
  });
  await page.goto("https://example.test/flows/ledger/" + (o.hash || ""));
  await page.waitForSelector("#sf[data-busy='false']", { timeout: 15000 });
  await page.waitForTimeout(o.settle === undefined ? 250 : o.settle);
  return { ctx, page, errors, asked, world };
}
