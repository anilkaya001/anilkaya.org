import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../../shared/flows-pages.js";
import { memberShell } from "../../shared/flows-member-shell.js";
import * as SN from "./member-since-batteries.mjs";
import * as X from "./member-export-world.mjs";
import { sinceModel } from "../../shared/flows-since.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const ORIGIN = "https://member.test";
export const MEMBER = "member.alpha";
export const UNIVERSE = ["SYA001", "SYA002", "SYA003", "SYA004", "SYA005", "SYA006", "SYA007", "SYA008", "SYA009", "SYA010", "SYA011", "SYA012"];
export const VIEWPORTS = [[1920, 1080], [1440, 820], [1024, 768], [390, 844]];

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

export const PAGE_HTML = {
  overview: (u) => PAGES.overviewPage({ username: u }),
  watch: (u) => PAGES.watchPage({ username: u }),
  ticker: (u) => PAGES.tickerPage({ username: u }),
  moves: (u) => PAGES.movesPage({ username: u }),
  unusual: (u) => PAGES.unusualPage({ username: u }),
  events: (u) => PAGES.eventsPage({ username: u }),
  political: (u) => PAGES.politicalPage({ username: u }),
  market: (u) => PAGES.marketPage({ username: u }),
};

export function htmlOf(slug, { shell = true, exportOpen = false, exportsOn = exportOpen, username = MEMBER, shellFn = memberShell } = {}) {
  const raw = PAGE_HTML[slug](username);
  return shell ? shellFn(raw, { slug, on: true, exportOpen, exportsOn }) : raw;
}

export function mutateText(text, transforms, label) {
  let out = text;
  for (const [from, to] of transforms) {
    const first = out.indexOf(from);
    if (first === -1 || first !== out.lastIndexOf(from)) throw new Error("mutant did not apply: " + label + ": " + from.slice(0, 70));
    out = out.slice(0, first) + to + out.slice(first + from.length);
  }
  return out;
}

export const deviceKey = (member = MEMBER) => "iewt:flows-watchlist:v1:" + encodeURIComponent("user:" + member);

export const INIT = {
  hidden: "Object.defineProperty(document, 'visibilityState', { get: () => window.__vs || 'visible', configurable: true }); window.__vs = 'hidden';",
  prerender: "Object.defineProperty(document, 'prerendering', { get: () => window.__pre === true, configurable: true }); window.__pre = true;",
  saveData: "Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });",
  silentStorage: "const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('iewt:flows-watchlist') === 0) return; return real.call(this, k, v); };",
  throwingStorage: "const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('iewt:flows-watchlist') === 0) throw new Error('quota'); return real.call(this, k, v); };",
  seed: (names, member = MEMBER) => "if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem(" + JSON.stringify(deviceKey(member)) + ", " + JSON.stringify(JSON.stringify({ version: 1, owner: "user:" + member, value: { names, at: null } })) + "); }",
  revokes: "window.__revokes = []; const realRevoke = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = (u) => { window.__revokes.push(Date.now()); return realRevoke(u); }; window.__downloads = []; const realCreate = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__downloads.push(Date.now()); return realCreate(b); };",
  shifts: "window.__shifts = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts.push({ v: e.value, nodes: (e.sources || []).map((s) => s.node && s.node.parentElement ? (s.node.parentElement.closest('.ft-name') ? 'ft-name' : 'other') : 'none') }); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) { window.__shifts = null; }",
};

export function fakeMe(o = {}) {
  const s = {
    member: o.member || MEMBER, version: o.version || 0, names: (o.names || []).slice().sort(), deviceOnly: o.deviceOnly === true, keyAbsent: o.keyAbsent === true,
    unreadable: o.unreadable === true, universe: new Set(o.universe || UNIVERSE), since: o.since || null, exports: (o.exports || []).slice(), used: o.used || 0, cap: 50,
    freesAtMs: o.freesAtMs || null, staleTimes: o.staleTimes || 0, concurrent: o.concurrent || null, unreadableOnStale: o.unreadableOnStale === true, deviceOnStale: o.deviceOnStale === true, latency: o.latency || 0, offline: false, failNext: null, unauthorized: false,
    weak: o.weak !== false, serverNow: o.serverNow || SN.NOW, universeFails: false, sinceFails: false, exportsFails: false, log: [], inflight: 0, maxInflight: 0, dispo: o.dispo || null,
    putStorage: [], page: null, pages: o.pages || {
      moves: { open: true }, unusual: { open: true },
      events: { open: false, hold: "held_event_dates", why: "held until event dates are cleared" },
      political: { open: false, hold: "held_licence", why: "held pending licence review" },
    },
    calls: [], file: o.file || { csv: "﻿asof_trt,method_version,ticker\r\n", json: "{}" }, truncated: o.truncated || null, deleted: 0, visits: 0,
  };
  s.view = () => ({
    member: s.member, version: s.version, maxNames: 200,
    mode: s.keyAbsent || s.deviceOnly ? "device-only" : "server", reason: s.keyAbsent ? "key_absent" : s.deviceOnly ? "member_choice" : null,
    watchlist: s.keyAbsent || s.deviceOnly || s.unreadable ? null : s.names, unreadable: s.unreadable,
  });
  s.count = (match) => s.calls.filter((c) => c === match || c.startsWith(match + "?")).length;
  s.bodies = (match) => s.log.filter((l) => l.method + " " + l.path === match).map((l) => (l.body ? JSON.parse(l.body) : null));
  return s;
}

const json = (status, body, headers = {}) => ({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function handleMe(route, s) {
  const req = route.request();
  const u = new URL(req.url());
  const method = req.method();
  s.calls.push(method + " " + u.pathname + u.search);
  s.log.push({ method, path: u.pathname, search: u.search, headers: req.headers(), body: req.postData() || null });
  if (method === "PUT" && u.pathname === "/api/me/state") { s.inflight += 1; s.maxInflight = Math.max(s.maxInflight, s.inflight); }
  try {
    if (s.latency) await delay(s.latency);
    if (s.offline) return await route.abort("failed");
    if (s.unauthorized) return await route.fulfill(json(401, { error: { code: "unauthorized" } }));
    if (s.failNext && s.failNext.match === method + " " + u.pathname) {
      const f = s.failNext;
      f.times = (f.times ?? 1) - 1;
      if (f.times <= 0) s.failNext = null;
      if (f.abort) return await route.abort("failed");
      return await route.fulfill(json(f.status, f.body || { error: { code: "internal" } }, f.headers || {}));
    }
    return await answer(route, s, req, u, method);
  } finally {
    if (method === "PUT" && u.pathname === "/api/me/state") s.inflight -= 1;
  }
}

async function answer(route, s, req, u, method) {
  const tag = () => ({ ETag: (s.weak ? 'W/"w' : '"w') + s.version + '"' });
  if (u.pathname === "/api/me/state") {
    if (method === "GET") return route.fulfill(json(200, s.view(), tag()));
    if (method === "DELETE") {
      if (s.version > 0 || s.names.length || s.deviceOnly || s.unreadable) s.version += 1;
      s.names = []; s.deviceOnly = false; s.unreadable = false; s.deleted += 1;
      return route.fulfill(json(200, { deleted: { state: 1 }, kept: { exports: s.exports.length, untilMs: null, reason: "export record, kept 90 days" } }));
    }
    if (method === "PUT") {
      const header = req.headers()["if-match"];
      const body = JSON.parse(req.postData() || "{}");
      if (header === undefined) return route.fulfill(json(428, { error: { code: "precondition_required" } }));
      const match = /^"w(\d+)"$/.exec(header);
      if (!match) return route.fulfill(json(400, { error: { code: "invalid_precondition" } }));
      if (s.staleTimes > 0 || Number(match[1]) !== s.version) {
        if (s.staleTimes > 0) {
          s.staleTimes -= 1;
          s.version += 1;
          if (s.concurrent) s.names = [...new Set([...s.names, ...s.concurrent])].sort();
          if (s.unreadableOnStale) s.unreadable = true;
          if (s.deviceOnStale) { s.deviceOnly = true; s.names = []; }
        }
        return route.fulfill(json(412, { error: { code: "stale_version" }, version: s.version }, tag()));
      }
      if (s.unreadable && body.replaceUnreadable !== true && !(body.deviceOnly === false && s.keyAbsent)) return route.fulfill(json(409, { error: { code: "unreadable_row" } }));
      if (body.deviceOnly === true) {
        if (s.page) s.putStorage.push(await s.page.evaluate((k) => localStorage.getItem(k), deviceKey(s.member)));
        s.deviceOnly = true; s.names = []; s.version += 1;
        return route.fulfill(json(200, s.view(), tag()));
      }
      if (s.keyAbsent) return route.fulfill(json(503, { error: { code: "member_state_unavailable" } }));
      if (s.universeFails) return route.fulfill(json(503, { error: { code: "universe_unreadable" } }, { "Retry-After": "30" }));
      if (body.watchlist.length > 200) return route.fulfill(json(400, { error: { code: "invalid_watchlist" }, limit: 200, distinct: body.watchlist.length }));
      const bad = body.watchlist.filter((n) => !s.universe.has(String(n).toUpperCase()) && !s.names.includes(String(n).toUpperCase()));
      if (bad.length) return route.fulfill(json(400, { error: { code: "invalid_watchlist" }, rejected: bad.map((ticker) => ({ ticker, reason: "not in the universe" })), rejectedCount: bad.length }));
      s.names = [...new Set(body.watchlist.map((n) => String(n).toUpperCase()))].sort();
      s.deviceOnly = false;
      s.unreadable = false;
      s.version += 1;
      return route.fulfill(json(200, s.view(), tag()));
    }
  }
  if (u.pathname === "/api/me/visit" && method === "POST") {
    s.visits += 1;
    return route.fulfill(json(200, { visit: { startedMs: 1, lastSeenMs: 1, previousEndedMs: null, firstVisit: true, newVisit: s.visits === 1 } }));
  }
  if (u.pathname === "/api/me/since") {
    if (s.sinceFails) return route.fulfill(json(500, { error: { code: "store_unreadable" } }));
    return route.fulfill(json(200, s.since || sinceModel({ now: SN.NOW, prevSeenMs: SN.PREV, ...SN.worldOf(SN.PREV) })));
  }
  if (u.pathname === "/api/me/exports") {
    if (s.exportsFails) return route.fulfill(json(500, { error: { code: "store_unreadable" } }));
    return route.fulfill(json(200, { exports: s.exports, retentionDays: 90, window: { used: s.used, cap: s.cap, freesAtMs: s.used >= s.cap ? s.freesAtMs : null }, pages: s.pages, formats: ["csv", "json"], serverNow: s.serverNow }));
  }
  if (u.pathname === "/api/me/export" && method === "POST") {
    const body = JSON.parse(req.postData() || "{}");
    if (s.pages[body.page] && s.pages[body.page].open !== true) return route.fulfill(json(403, { error: { code: "export_held" }, hold: s.pages[body.page].hold }));
    if (s.used >= s.cap) return route.fulfill(json(429, { error: { code: "export_limit" }, freesAtMs: s.freesAtMs, serverNow: s.serverNow }, { "Retry-After": "60" }));
    s.used += 1;
    s.exports.unshift({ page: body.page, rows: 8, cols: ["asof_trt", "ticker"], atMs: SN.NOW });
    const csv = body.format === "csv";
    return route.fulfill({
      status: 200, contentType: csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      headers: {
        "Content-Disposition": s.dispo || 'attachment; filename="flows-' + body.page + "-2026-10-24-TRT." + body.format + '"', "X-Export-Rows": String(s.truncated ? s.truncated.shown : 8),
        "X-Export-Available": String(s.truncated ? s.truncated.available : 8), "X-Export-Truncated": s.truncated ? "1" : "0", "X-Export-Method": "flows-export-1",
      },
      body: csv ? s.file.csv : s.file.json,
    });
  }
  return route.fulfill(json(404, { error: { code: "not_found" } }));
}

export async function open(browser, slug, o = {}) {
  const { w = 1440, h = 820, state = fakeMe(), shell = true, exportOpen = false, exportsOn = exportOpen, controllers = false, reduced = false, forced = false, mobile = false, init = [], username, mutate = {}, shellFn, clock = null, failAssets = [], holdAssets = {}, timezoneId = null } = o;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, ...(timezoneId ? { timezoneId } : {}), reducedMotion: reduced ? "reduce" : "no-preference", forcedColors: forced ? "active" : "none", acceptDownloads: true,
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  for (const script of [].concat(init)) await ctx.addInitScript(script);
  const page = await ctx.newPage();
  state.page = page;
  const errors = [];
  const logs = [];
  const requests = [];
  const assets = [];
  page.on("pageerror", (e) => { errors.push(String(e)); logs.push({ type: "pageerror", text: String(e) }); });
  page.on("console", (m) => { logs.push({ type: m.type(), text: m.text() }); if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
  const html = htmlOf(slug, { shell, exportOpen, exportsOn, username, shellFn });
  const keep = new Set(controllers === true ? [] : controllers || []);
  let served = false;
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    requests.push(route.request().method() + " " + u.pathname + u.search);
    if (u.pathname.startsWith("/api/me/")) return handleMe(route, state);
    if (u.pathname === "/api/flows/universe") return state.universeFails ? route.fulfill(json(500, { error: { code: "store_unreadable" } })) : route.fulfill(json(200, { v: 1, status: "ok", t: [...state.universe] }));
    if (u.pathname.startsWith("/api/")) return route.fulfill(json(404, { error: { code: "not_found" } }));
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      const base = path.basename(u.pathname);
      assets.push(base);
      if (failAssets.includes(base)) return route.fulfill({ status: 404, body: "" });
      if (holdAssets[base]) await holdAssets[base];
      const mine = /^(flows-ui|flows-member|flows-member-ui|flows-member-boot|flows-export|storage)\.js$/.test(base);
      if (u.pathname.endsWith(".js") && !mine && !keep.has(base) && controllers !== true) return route.fulfill({ contentType: "text/javascript", body: "" });
      const type = MIME[path.extname(f)] || "application/octet-stream";
      if (mutate[base]) return route.fulfill({ contentType: type, body: mutateText(fs.readFileSync(f, "utf8"), mutate[base], base) });
      return route.fulfill({ path: f, contentType: type });
    }
    if (served && route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: "<title>" + u.pathname + "</title><p>stub</p>" });
    served = true;
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
  });
  if (clock) await page.clock.install({ time: clock });
  const url = ORIGIN + "/flows/" + (slug === "overview" ? "" : slug + "/") + (slug === "ticker" ? "?t=SYA001" : "");
  await page.goto(url, { waitUntil: "load" });
  return {
    ctx, page, errors, logs, requests, assets, state, url,
    again: async (other) => { served = false; await other.goto(url, { waitUntil: "load" }); },
    close: () => ctx.close(),
  };
}

export const geometry = (page, selector) => page.evaluate((q) => {
  const el = document.querySelector(q);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
}, selector);

export const fits = (page) => page.evaluate(() => {
  const se = document.scrollingElement;
  return { v: se.scrollHeight <= innerHeight + 1, h: se.scrollWidth <= innerWidth + 1, sh: se.scrollHeight, ih: innerHeight, sw: se.scrollWidth, iw: innerWidth };
});

export { X, SN };
