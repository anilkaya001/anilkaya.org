import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../../shared/flows-pages.js";
import { buildMacro } from "../../shared/flows-macro.js";
import { buildLive, BOARD_FUTURES } from "../../shared/flows-macro-live.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-macro.json"), "utf8"));

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

export const NOW = Date.parse(FX.now);

export const world = (name) => structuredClone({ ...FX.worlds.ok, ...(FX.worlds[name] || {}) });

export function macroPayload(name = "ok", edit = null) {
  const w = world(name);
  if (edit) edit(w);
  return buildMacro(w, { test: true });
}

export function symbolsOf(payload) {
  const out = {};
  for (const p of BOARD_FUTURES) {
    const x = payload.futures && payload.futures.products ? payload.futures.products[p] : null;
    if (x && x.sym) out[p] = x.sym;
  }
  return out;
}

export function liveBodies(payload, zone = "ok") {
  const live = FX.live[zone];
  const symbols = symbolsOf(payload);
  const common = { now: NOW, symbols, test: true };
  return {
    board: buildLive("board", live.board, common),
    futures: buildLive("futures", live.futures, common),
    crypto: buildLive("crypto", live.crypto, common),
    fx: (pair) => buildLive("fx", live.fx, { ...common, pair }),
  };
}

export async function openMacro(browser, { viewport = { width: 1440, height: 820 }, payload = null, live = true, liveZone = "ok", hash = "", reduced = false, coarse = false, onRoute = null, patch = null, pending = false, macroStatus = 200 } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: coarse, isMobile: coarse });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.errors = errors;
  const requests = [];
  page.requests = requests;
  await page.clock.install({ time: NOW });
  const body = payload || macroPayload("ok");
  const bodies = liveBodies(body, liveZone);
  const html = PAGES.macroPage({ username: "test", live });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    requests.push(u.pathname + u.search);
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
    if (u.pathname === "/api/flows/macro") {
      if (pending) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending", why: "not_published" }) });
      return route.fulfill({ status: macroStatus, contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname === "/api/flows/macro/now") {
      const part = u.searchParams.get("part");
      if (part === "fx") return route.fulfill({ contentType: "application/json", body: JSON.stringify(bodies.fx(u.searchParams.get("pair"))) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(bodies[part]) });
    }
    if (u.pathname.startsWith("/api/flows/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending", rows: [] }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/macro/" + hash);
  return { context, page, errors, requests };
}

export async function settle(page) {
  await page.waitForFunction(() => document.querySelector("#mcStatus") && /loaded|published/.test(document.querySelector("#mcStatus").textContent));
  await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.macro && window.FlowsUI.macro.state().painters, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
}
