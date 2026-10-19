import fs from "node:fs";
import path from "node:path";
import * as PAGES from "../../shared/flows-pages.js";
import { ROOT, alertsFixture, universeFixture } from "./market-fixtures.mjs";

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/render-preview.fixtures.json"), "utf8"));

export const TABS = ["session", "flow", "names", "focus", "moves", "calendar"];

export async function openHome(browser, { viewport = { width: 1440, height: 820 }, net = true, summary = FIX.summary, alerts = alertsFixture(), universe = universeFixture(), reduced = false, coarse = false, hash = "", patch = null, overrides = {} } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: coarse, isMobile: coarse });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const html = PAGES.overviewPage({ username: "test", summary, net });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) { if (!src.includes(from)) throw new Error("mutant anchor missing: " + from); src = src.replaceAll(from, to); }
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname === "/api/flows/flowalerts") return route.fulfill({ contentType: "application/json", body: JSON.stringify(alerts) });
    if (u.pathname === "/api/flows/universe") return route.fulfill({ contentType: "application/json", body: JSON.stringify(universe) });
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const own = Object.keys(overrides).find((x) => key.includes(x));
      if (own) return route.fulfill({ contentType: "application/json", body: JSON.stringify(overrides[own]) });
      const k = Object.keys(FIX.overview).find((x) => key.includes(x));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIX.overview[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/" + hash);
  return { context, page, errors };
}
