import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorld } from "./sfc-world.mjs";
import { storedInput, NOW_INTRADAY } from "./sfc-stored.mjs";
import { mulberry32, between, chance } from "./sfc-rng.mjs";
import { ledgerView, parseScope } from "../../shared/flows-sfc-view.js";
import { buildBook, notLive } from "../../shared/flows-ledger-live.js";
import { SECTORS } from "../../shared/flows-sfc.js";
import * as PAGES from "../../shared/flows-pages.js";
import * as RT from "../../shared/flows-rt.js";
import { alertKey } from "../../shared/flows-alerts.js";
import { freshHeaders } from "../../shared/flows-freshness.js";
import { liveMeta } from "../../shared/flows-live-worker.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const NOW = NOW_INTRADAY;

export const HTML = PAGES.ledgerPage({ username: "test", live: true });

export const HTML_OFF = PAGES.ledgerPage({ username: "test", live: false });

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

const iso = (ms) => new Date(ms).toISOString();

export function liveWorld(seed = 20261026, { tickers = 60, perName = 8 } = {}) {
  const world = makeWorld(seed, { tickers, perName, pathologies: false, floor: 20000, magnitude: 4.4 });
  const start = Date.UTC(2026, 9, 23, 13, 30, 0);
  const seen = new Set();
  world.rows = world.rows.filter((row, i) => {
    const at = start + ((i * 97) % 85) * 60000 + (i % 60) * 1000;
    row.spanStart = iso(at);
    row.spanEnd = iso(Math.min(at + (i % 7) * 60000, NOW - 120000));
    const key = alertKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  world.tide = {};
  const rnd = mulberry32(seed + 5);
  for (const s of SECTORS) world.tide[s] = { calls: Math.round((rnd() - 0.4) * 9e9), puts: Math.round((rnd() - 0.5) * 6e9) };
  return world;
}

export function streamRow(world, rnd, i, at, over = {}) {
  const base = world.rows[between(rnd, 0, world.rows.length - 1)];
  const prem = Math.round((20000 + rnd() * 900000) * 100) / 100;
  const ask = Math.round(prem * (0.3 + rnd() * 0.5) * 100) / 100;
  const bid = Math.round((prem - ask) * rnd() * 0.9 * 100) / 100;
  const cp = chance(rnd, 0.5) ? "C" : "P";
  const spanStart = iso(at - between(rnd, 5, 40) * 1000);
  return {
    t: base.t, oc: base.t + "261120" + cp + String(between(rnd, 1, 400) * 1000).padStart(8, "0"), cp, k: between(rnd, 5, 600), exp: "2026-10-30", prem, size: between(rnd, 1, 4000),
    trades: between(rnd, 1, 20), askPrem: ask, bidPrem: bid, sweep: chance(rnd, 0.2), floor: false, single: true, opening: null, oi: null, voi: null,
    ivStart: 0.2 + rnd() * 0.5, ivEnd: 0.2 + rnd() * 0.5, px: Math.round((10 + rnd() * 400) * 100) / 100, spanStart, spanEnd: iso(at - 2000),
    rule: "r", st: null, id: "a" + seed32(world.seed, i), ts: at - 1500, ...over,
  };
}

const seed32 = (seed, i) => (seed * 100003 + i).toString(36);

export function serverInput(world, over = {}) {
  return { ...storedInput(world), ...over };
}

export function serverBook(world, over = {}) {
  const input = serverInput(world, over);
  const at = over.now || NOW;
  const view = ledgerView({ ...input, now: at });
  if (view.status !== "ok" || view.period.id !== "intraday") return notLive({ at, view });
  return buildBook({ at, view, live: input.live, nightly: input.nightly, breadth: input.breadth, universe: input.universe, clock: input.clock });
}

export function serverHeaders(world, over = {}) {
  const at = over.now || NOW;
  const input = serverInput(world, over);
  const headers = freshHeaders(liveMeta({ readAt: input.live.readAt, session: input.live.session, cadenceS: 300, source: "live" }), at, null).headers;
  return { ...headers, "X-Payload-Updated": String(input.live.readAt + 1000) };
}

export function serverView(world, url, over = {}) {
  const input = serverInput(world, over);
  const scope = parseScope(url.searchParams.get("scope")) || { kind: "all", key: "all" };
  const period = url.searchParams.get("period") || null;
  return ledgerView({ ...input, now: over.now || NOW, scope, period });
}

export const ep = 880001;

export function railFrames(day = "2026-10-23") {
  const R = { ep, sq: { fl: 0 }, now: NOW, ws: null, sent: [], hellos: 0, conns: 0, closes: [] };
  R.fresh = (readAt = R.now, over = {}) => RT.streamEntry({ k: "fl", readAt, vendorAt: null, session: day, now: R.now, updatedAt: readAt, ...over });
  R.snapshot = (rows, over = {}) => RT.frame("fl", { ep, sq: over.sq ?? R.sq.fl, at: R.now, snap: true, fresh: R.fresh(over.readAt ?? R.now), meta: { cursor: null, dropped: 0, truncated: false }, rows });
  R.delta = (rows, over = {}) => RT.frame("fl", { ep, sq: over.sq ?? ++R.sq.fl, at: R.now, fresh: R.fresh(over.readAt ?? R.now), meta: { cursor: null, dropped: 0, truncated: false }, rows });
  R.hello = (rows = []) => RT.ctlFrame("hello", { ep, at: R.now, meta: { transport: "ws", upstream: "socket", mode: "on", audience: "members", topics: ["fl"], hbS: 5, cold: false, phase: "rth", session: day, f: null }, rows: [R.snapshot(rows)] });
  R.hb = (readAt = R.now) => RT.ctlFrame("hb", { ep, at: R.now, meta: { upstream: "up", phase: "rth", sockets: 1, degraded: null, topics: { fl: { sq: R.sq.fl, readAt, lagMs: null, fresh: R.fresh(readAt) } } } });
  R.send = (frame) => { if (R.ws) { R.ws.send(JSON.stringify(frame)); R.sent.push(frame); return true; } return false; };
  return R;
}

export async function mountLive(browser, w, h, o = {}) {
  const ctx = o.newContext || await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: o.reduced === false ? "no-preference" : "reduce", ...(o.context || {}) });
  const page = await ctx.newPage();
  if (o.fixed !== false) await page.clock.setFixedTime(new Date(o.now || NOW));
  const errors = [];
  const asked = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  const world = o.world || liveWorld();
  const R = railFrames();
  R.page = page;
  const baseOver = o.baseOver || {};
  const state = { book: o.book || (() => serverBook(world, baseOver)), views: 0, books: 0, bookStatus: o.bookStatus || 200, beatKeys: o.beatKeys || null, updated: NOW - 300000 };
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => {
    R.conns++;
    if (o.rail === "off") { ws.close({ code: 4011, reason: "off" }); return; }
    R.ws = ws;
    ws.onMessage(() => {});
    ws.onClose((code, reason) => { R.closes.push({ code, reason }); if (R.ws === ws) R.ws = null; });
    R.hellos++;
    ws.send(JSON.stringify(R.hello(o.ring || [])));
    if (o.onConnect) o.onConnect(R, ws);
  });
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/assets/js/flows-sfc-live.js" && o.liveJs) return r.fulfill({ contentType: "text/javascript", body: o.liveJs });
    if (u.pathname === "/assets/js/flows-sfc.js" && o.js) return r.fulfill({ contentType: "text/javascript", body: o.js });
    if (u.pathname === "/assets/js/flows-ledger.bundle.js" && o.bundle) return r.fulfill({ contentType: "text/javascript", body: o.bundle });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) asked.push(u.pathname + u.search);
    if (u.pathname === "/api/flows/ledger") {
      if (u.searchParams.get("part") === "book") {
        state.books++;
        if (state.bookStatus !== 200) return r.fulfill({ status: state.bookStatus, contentType: "application/json", body: JSON.stringify({ error: { code: "ledger_live_off", message: "off" } }) });
        const book = typeof state.book === "function" ? state.book() : state.book;
        return r.fulfill({ contentType: "application/json", body: JSON.stringify(book), headers: serverHeaders(world, baseOver) });
      }
      state.views++;
      const body = o.view ? o.view(u) : serverView(world, u, baseOver);
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(body), headers: serverHeaders(world, baseOver) });
    }
    if (u.pathname === "/api/flows/now") {
      const keys = state.beatKeys || {};
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ serverNow: NOW, phase: { phase: "rth", endsAt: iso(NOW + 3600000) }, keys }) });
    }
    if (u.pathname === "/api/flows/meta") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/api/rt/snap")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: o.html || HTML });
  });
  await page.goto("https://example.test/flows/ledger/" + (o.hash || ""));
  await page.waitForSelector("#sf[data-busy='false']", { timeout: 15000 });
  if (o.waitLive !== false) await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.ledgerLive && window.FlowsUI.ledgerLive.status().active, null, { timeout: 15000 });
  await page.waitForTimeout(o.settle === undefined ? 150 : o.settle);
  return { ctx, page, errors, asked, world, R, state };
}
