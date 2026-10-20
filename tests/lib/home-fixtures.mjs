import fs from "node:fs";
import path from "node:path";
import * as PAGES_MOD from "../../shared/flows-pages.js";
import { ROOT, alertsFixture, universeFixture, richAnswer, RICH_NOW } from "./market-fixtures.mjs";
import { nightlyEmit, emitRead } from "./nightly-emit.mjs";

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/render-preview.fixtures.json"), "utf8"));

export const FITS = {
  xl: [[1920, 1080], [1920, 969], [1920, 937], [1920, 929], [1920, 900], [2560, 1440]],
  l: [[1680, 1050], [1600, 900], [1440, 900], [1440, 820], [1366, 768]],
  m: [[1280, 800], [1024, 768], [1280, 720]],
  s: [[768, 1024], [390, 844], [375, 667], [320, 568]],
};
export const PAGES = ["now", "flow", "names", "glance"];

function homeRich(dir, route, u) {
  const own = richAnswer(dir, route, u);
  if (own !== undefined) return own;
  switch (route) {
    case "sector-premium": case "events": case "news": case "scoretrack": case "focus": case "flowalerts": return emitRead(dir, route);
    case "universe": return emitRead(dir, "universe");
    default: return undefined;
  }
}

function assertAnchors(patch) {
  if (!patch) return;
  for (const [file, edits] of Object.entries(patch)) {
    const f = path.join(ROOT, file);
    if (!fs.existsSync(f)) throw new Error("mutant file missing: " + file);
    const src = fs.readFileSync(f, "utf8");
    for (const [from] of edits) if (!src.includes(from)) throw new Error("mutant anchor missing in " + file + ": " + from);
  }
}

export async function openHome(browser, { viewport = { width: 1440, height: 820 }, net = true, summary = FIX.summary, alerts = null, universe = null, reduced = false, coarse = false, hash = "", patch = null, overrides = {}, rich = false, dock = false, now = RICH_NOW, onRoute = null } = {}) {
  assertAnchors(patch);
  const context = await browser.newContext({ viewport, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: coarse, isMobile: coarse });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.errors = errors;
  const dir = rich ? nightlyEmit() : null;
  if (rich) await page.clock.install({ time: now });
  const alertRows = alerts || (rich ? emitRead(dir, "flowalerts") : alertsFixture());
  const universeBody = universe || (rich ? emitRead(dir, "universe") : universeFixture());
  const html = PAGES_MOD.overviewPage({ username: "test", summary, net });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (onRoute) { const done = await onRoute(route, u); if (done) return; }
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) src = src.replaceAll(from, to);
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname === "/api/flows/flowalerts" && !overrides.flowalerts) return route.fulfill({ contentType: "application/json", body: JSON.stringify(alertRows) });
    if (u.pathname === "/api/flows/universe" && !overrides.universe) return route.fulfill({ contentType: "application/json", body: JSON.stringify(universeBody) });
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const own = Object.keys(overrides).find((x) => key.includes(x));
      if (own) return route.fulfill({ contentType: "application/json", body: JSON.stringify(overrides[own]) });
      if (rich) {
        const body = homeRich(dir, u.pathname.slice("/api/flows/".length), u);
        if (body !== undefined && body !== null) return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      }
      const k = Object.keys(FIX.overview).find((x) => key.includes(x));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIX.overview[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/" + hash);
  if (dock) await openDock(page);
  return { context, page, errors };
}

export async function openDock(page) {
  await page.click("#askDockTab");
  await page.waitForSelector(".ak-dock.is-open");
  await page.evaluate(() => new Promise((done) => {
    const panel = document.querySelector(".ak-dock-panel");
    const end = () => done();
    if (!panel || getComputedStyle(panel).transitionDuration === "0s") return done();
    panel.addEventListener("transitionend", end, { once: true });
    setTimeout(end, 700);
  }));
}
