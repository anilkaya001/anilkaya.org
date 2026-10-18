import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../../shared/flows-pages.js";
import { liveEntry, phaseView } from "../../shared/flows-live-worker.js";
import { phaseAt } from "../../shared/flows-freshness.js";
import { nightlyEmit, emitRead } from "./nightly-emit.mjs";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
export const SESSION = "2026-09-29";
const FIXTURES = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/render-preview.fixtures.json"), "utf8")).market;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const NAMES = [
  ["NVDA", "Technology", 1.0, 0.7], ["TSLA", "Consumer Cyclical", 0.92, 0.45], ["SPY", null, 0.86, 0.35], ["QQQ", null, 0.6, 0.4],
  ["AAPL", "Technology", 0.5, 0.62], ["AMZN", "Consumer Cyclical", 0.46, 0.66], ["META", "Communication Services", 0.42, 0.7],
  ["MSFT", "Technology", 0.4, 0.58], ["AMD", "Technology", 0.36, 0.64], ["PLTR", "Technology", 0.31, 0.72], ["AVGO", "Technology", 0.28, 0.6],
  ["GOOGL", "Communication Services", 0.27, 0.6], ["IWM", null, 0.25, 0.3], ["NFLX", "Communication Services", 0.2, 0.55],
  ["COIN", "Financial Services", 0.2, 0.6], ["MU", "Technology", 0.18, 0.66], ["JPM", "Financial Services", 0.15, 0.4],
  ["XOM", "Energy", 0.14, 0.35], ["LLY", "Healthcare", 0.14, 0.5], ["UNH", "Healthcare", 0.12, 0.3], ["SMCI", "Technology", 0.12, 0.55],
  ["BA", "Industrials", 0.11, 0.42], ["GS", "Financial Services", 0.07, 0.5], ["CVX", "Energy", 0.07, 0.4], ["WMT", "Consumer Defensive", 0.06, 0.6],
  ["CAT", "Industrials", 0.06, 0.55], ["MRNA", "Healthcare", 0.05, 0.3], ["FCX", "Basic Materials", 0.05, 0.6], ["DIS", "Communication Services", 0.05, 0.5],
  ["NEE", "Utilities", 0.04, 0.5], ["KO", "Consumer Defensive", 0.03, 0.5],
];
const EXPIRIES = ["2026-09-29", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-30", "2026-11-20", "2026-12-18", "2027-01-15"];

export function alertsFixture({ n = 160, seed = 11, names = NAMES, burst = true } = {}) {
  const r = rng(seed);
  const rows = [];
  const bursts = [[9 * 60 + 40, 0, 1, 3], [11 * 60 + 5, 4, 5, 7], [13 * 60 + 20, 0, 8, 9]];
  for (let i = 0; i < n; i++) {
    let pick = r() * names.reduce((s, x) => s + x[2], 0), j = 0;
    while (pick > names[j][2] && j < names.length - 1) { pick -= names[j][2]; j++; }
    let minute = 9 * 60 + 31 + Math.floor(r() * 300);
    if (burst && r() < 0.45) {
      const b = bursts[Math.floor(r() * bursts.length)];
      j = b[1 + Math.floor(r() * 3)] % names.length;
      minute = b[0] + Math.floor(r() * 25);
    }
    const [t, , , callBias] = names[j];
    const cp = r() < callBias ? "C" : "P";
    const prem = Math.round(120000 * Math.exp(r() * 3.1) * (0.6 + names[j][2]));
    const askShare = Math.min(0.97, Math.max(0.03, (cp === "C" ? 0.58 : 0.5) + (r() - 0.5) * 0.9));
    const between = r() * 0.18;
    const askPrem = Math.round(prem * (1 - between) * askShare), bidPrem = Math.round(prem * (1 - between) * (1 - askShare));
    const exp = EXPIRIES[Math.floor(Math.pow(r(), 1.6) * EXPIRIES.length)];
    const spanStart = new Date(Date.parse(SESSION + "T00:00:00-04:00") + minute * 60000).toISOString();
    const k = Math.round(100 + r() * 400);
    rows.push({
      t, oc: t + "260000" + cp + String(k * 1000).padStart(8, "0") + i, cp, k, exp, prem, size: Math.round(prem / 300), trades: 1 + Math.floor(r() * 40),
      askPrem, bidPrem: r() < 0.06 ? null : bidPrem, sweep: r() < 0.4, floor: false, single: true, opening: r() < 0.5,
      spanStart, spanEnd: spanStart, rule: "RepeatedHits", st: null, firstAt: spanStart, lastAt: "2026-09-29T18:41:00.000Z", reads: 3,
    });
  }
  rows.sort((a, b) => b.prem - a.prem);
  return {
    v: 1, status: "ok", generatedAt: "2026-09-29T18:41:05.000Z", sessionDate: SESSION, readAt: "2026-09-29T18:41:00.000Z",
    refreshed: "intraday", rows, seen: rows.length, unusable: 0, shed: 0, cap: 180, coverage: {}, notes: {},
  };
}

export function universeFixture(names = NAMES) {
  const sectors = [...new Set(names.filter((x) => x[1]).map((x) => x[1]))];
  const r = rng(7);
  const cols = { chg: [], iv30p: [], ed: [], sig: [], f2: [], f3: [], mcap: [] };
  names.forEach((x, i) => {
    const sig = 0.008 + r() * 0.02;
    const k = (r() - 0.5) * 7;
    cols.chg.push(Math.round(k * sig * 1e4));
    cols.iv30p.push(Math.round((0.2 + r() * 0.5) * 1e3));
    cols.ed.push(i % 7 === 0 ? 3 : 40);
    cols.sig.push(Math.round(sig * 1e5));
    cols.f2.push(Math.floor(r() * 18));
    cols.f3.push(Math.floor(r() * 5));
    cols.mcap.push(Math.round(50 + r() * 3000));
  });
  return {
    v: 1, status: "ok", sessionDate: "2026-09-28", t: names.map((x) => x[0]), sectors, sec: names.map((x) => (x[1] ? sectors.indexOf(x[1]) : -1)),
    cols, units: { chg: ["fraction", 1e4], iv30p: ["vol", 1e3], ed: ["sessions", 1], sig: ["fraction", 1e5], f2: ["days per 252", 1], f3: ["days per 252", 1], mcap: ["usd b", 1] },
  };
}

const RICH_NOW = Date.parse("2026-08-24T15:25:00.000Z");

function richAnswer(dir, route, u) {
  const q = u.searchParams;
  const read = (k) => emitRead(dir, k);
  switch (route) {
    case "board": return read("board-" + (q.get("side") || "long"));
    case "sectors": return read("sector-trix") || { status: "pending", rows: [] };
    case "market": case "pulse": case "movers": case "regime": return read(route) || { status: "pending" };
    case "lk": {
      const keys = {};
      for (const k of String(q.get("k") || "").split(",").filter(Boolean)) {
        const p = read("live-" + k);
        const f = p && p.fresh;
        keys[k] = p ? { status: "ok", payload: p, updatedAt: Date.parse(f.readAt), fresh: liveEntry({ readAt: Date.parse(f.readAt), session: f.session, cadenceS: f.cadenceS, source: f.source }, Date.parse(f.readAt), RICH_NOW, null) }
          : { status: "pending", fresh: { state: "pending", reason: "unpublished", klass: "market" } };
      }
      return { serverNow: RICH_NOW, phase: phaseView(phaseAt(RICH_NOW, null)), keys };
    }
    default: return undefined;
  }
}

export async function openMarket(browser, { rich = false, tweak = null, now = RICH_NOW, viewport = { width: 1440, height: 820 }, alerts = alertsFixture(), universe = universeFixture(), alertsStatus = 200, scenes = true, owner = true, reduced = false, coarse = false, patch = null, hash = "" } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: coarse, isMobile: coarse });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.errors = errors;
  const dir = rich ? nightlyEmit() : null;
  if (rich) await page.clock.install({ time: now });
  const html = PAGES.marketPage({ username: "test", owner, scenes });
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
    if (u.pathname === "/api/flows/flowalerts") {
      if (alertsStatus !== 200) return route.fulfill({ status: alertsStatus, contentType: "application/json", body: "{}" });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(alerts) });
    }
    if (u.pathname === "/api/flows/universe") return route.fulfill({ contentType: "application/json", body: JSON.stringify(universe) });
    if (u.pathname.startsWith("/api/flows/")) {
      if (rich) {
        const body = richAnswer(dir, u.pathname.slice("/api/flows/".length), u);
        if (body && tweak) tweak(u.pathname.slice("/api/flows/".length), body);
        if (body !== undefined) return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      }
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const k = Object.keys(FIXTURES).find((x) => key.includes(x.replace(/^flows\//, "")));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIXTURES[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/market/" + hash);
  return { context, page, errors };
}

export const TABS = ["session", "tide", "sectors", "indices", "network", "extremes", "relations", "prints", "context"];

export async function showTab(page, selector) {
  const key = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const panel = el && el.closest(".mk-panel");
    return panel ? panel.dataset.panel : null;
  }, selector);
  if (!key) return;
  if ((await page.evaluate(() => document.getElementById("mkStage").dataset.view)) !== key) await page.click("#mkT-" + key);
  const sub = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const mod = el && el.closest(".mk-mod");
    const bar = document.getElementById("mkSub");
    if (!mod || !bar || getComputedStyle(bar).display === "none" || bar.hidden) return -1;
    return [...mod.parentElement.querySelectorAll(":scope > .mk-mod")].indexOf(mod);
  }, selector);
  if (sub >= 0) await page.locator("#mkSub button").nth(sub).click();
}
