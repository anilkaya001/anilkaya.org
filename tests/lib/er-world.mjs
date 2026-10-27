import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../../shared/flows-pages.js";
import { buildEventRisk, fitEventRisk } from "../../shared/flows-er-payload.js";
import { natrRead, pulseRead } from "../../shared/flows-er-pulse.js";
import { reduceFin } from "../../shared/flows-er-eps.js";
import { nightlyEmit, emitRead } from "./nightly-emit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-eventrisk.json"), "utf8")).bodies;
export const SESSION = "2026-10-26";
export const NOW = Date.parse("2026-10-26T18:00:00.000Z");
export const GENERATED = "2026-10-26T01:58:00.000Z";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

export const lcg = (seed) => { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export function shiftDates(value, days) {
  if (typeof value === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(value);
    return m && !Number.isNaN(Date.parse(m[1] + "T00:00:00Z")) ? addDays(m[1], days) + m[2] : value;
  }
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)]));
  return value;
}

export function eventsPayload() {
  const dir = nightlyEmit();
  const base = emitRead(dir, "events");
  const out = shiftDates(base, 63);
  out.sessionDate = SESSION;
  out.gateOrigin = SESSION;
  const tickers = ["NVDA", "AAPL", "MSFT", "AMZN", "META", "TSLA", "AMD", "MU", "NFLX", "COIN", "XOM", "SPY"];
  return { out, tickers };
}

export function worldCards(names, seed = 11) {
  const rnd = lcg(seed);
  const cards = new Map();
  names.forEach((row, k) => {
    const events = [];
    const n = [12, 12, 9, 6, 7, 3, 12, 0, 12, 5][k % 10];
    const bias = [-0.5, 0.45, 0, -0.2, 0.6, 0, -0.55, 0, 0.1, 0][k % 10];
    for (let i = 0; i < n; i++) {
      const em = 0.03 + rnd() * 0.07;
      const mag = em * Math.exp(bias + (rnd() - 0.5) * 0.5);
      const m1d = (rnd() > 0.5 ? 1 : -1) * mag;
      events.push([addDays(row.d, -(91 * (i + 1) - 4)), i % 3 ? "postmarket" : "premarket", Number(em.toFixed(6)), Number(m1d.toFixed(6)), null, null, rnd() > 0.5 ? 0.2 : -0.3, null]);
    }
    const eps = events.slice(0, 8).map((e, i) => [addDays(e[0], -35), e[0], i % 3 ? "post" : "pre", 10000 + i * 100, 9000 + i * 70, rnd() > 0.5 ? 0.12 : -0.08, 1]);
    cards.set(row.t, {
      earnings: { events, next: { d: row.d, when: k % 3 === 0 ? "premarket" : k % 3 === 1 ? "postmarket" : "unknown" } },
      er: { v: 1, status: "ok", parts: { eps: { at: NOW, rv: 1, x: { ok: true, rows: eps } } } },
    });
  });
  return cards;
}

export function erPayload({ seed = 11 } = {}) {
  const { out: events } = eventsPayload();
  const rows = events.rows.slice(0, 60);
  const cards = worldCards(rows, seed);
  const natr = new Map();
  const pulse = new Map();
  rows.forEach((r, i) => {
    if (i % 7 !== 0) natr.set(r.t, natrRead({ data: [{ date: addDays(SESSION, -1), values: { NATR: String(1.2 + (i % 5) * 0.8) } }] }));
    if (i % 4 === 0) pulse.set(r.t, pulseRead({ data: { intraday: [{ trd_dt: SESSION, hr_min: "1000", call_txn: 5 + i, put_txn: 9 + (i % 6) * 3 }] } }));
  });
  const reads = {
    ipo: { status: "ok", body: FX["calendar-ipo"] },
    active: { status: "ok", body: FX["listings-active"] },
    delisted: Object.entries(FX["listings-delisted"]).map(([date, body]) => ({ status: "ok", date, body })),
    schedule: Object.entries(FX["potus-schedule"]).map(([date, rows2]) => ({ status: "ok", date, body: { data: rows2 } })),
    posts: { status: "ok", body: FX["potus-posts"] },
    fired: { status: "ok", body: FX["alerts-fired"] },
    configs: { status: "ok", body: FX["alerts-config"] },
    filters: { status: "ok", body: FX["alerts-filters"] },
    grammar: { status: "ok", body: FX["alerts-grammar"].overview },
    grammarTargets: Object.fromEntries(Object.entries(FX["alerts-grammar"].targets).map(([k, b]) => [k, b.fail ? { status: "plan" } : { status: "ok", body: b }])),
  };
  const universe = new Set(["SYE004", "SYE001", ...rows.map((r) => r.t)]);
  const payload = buildEventRisk({
    sessionDate: SESSION, generatedAt: new Date(NOW - 16 * 3600000).toISOString(), events, cardX: (t) => cards.get(t) || null,
    natr, pulse, reads, prior: null, universe, basis: { calls: 105, refused: {}, failed: {} }, readAt: GENERATED,
  });
  payload.fixture = true;
  return fitEventRisk(payload);
}

export function cardPayload(t, withFin = true) {
  const fin = reduceFin(FX["income-statements"], FX["balance-sheets"], FX["cash-flows"]);
  return { t, sessionDate: SESSION, earnings: null, er: withFin ? { v: 1, status: "ok", parts: { fin: { at: NOW, rv: 1, x: fin } } } : null, fin: null };
}

export async function openEvents(browser, viewport, opts = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: opts.reduced === false ? "no-preference" : "reduce", hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (process.env.DBG) { page.on("console", (m) => console.log("console", m.text().slice(0, 200))); page.on("requestfailed", (r) => console.log("failed", r.url())); }
  await page.clock.install({ time: NOW });
  const html = PAGES.eventsPage({ username: "test", eventrisk: opts.eventrisk !== false, halts: opts.halts !== false });
  const payload = opts.payload || erPayload();
  const world = { errors, requests, payload, html };
  const { out: events } = opts.events ? { out: opts.events } : eventsPayload();
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    requests.push(u.pathname + u.search);
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (opts.patch && opts.patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of opts.patch[u.pathname]) {
          if (!src.includes(from)) throw new Error("mutant anchor missing: " + from);
          src = src.replaceAll(from, to);
        }
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/eventrisk") {
      if (opts.route) { const r = await opts.route(u, route.request()); if (r) return route.fulfill(r); }
      if (u.searchParams.get("part") === "quote") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ t: u.searchParams.get("t"), status: "ok", readAt: new Date(NOW).toISOString(), last: { pxC: 1234, at: new Date(NOW - 30000).toISOString(), vol: 100 }, bid: { pxC: 1233, size: 200 }, ask: { pxC: 1235, size: 300 }, quoteAt: new Date(NOW - 20000).toISOString(), session: "regular" }) });
      if (u.searchParams.has("t")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(cardPayload(u.searchParams.get("t"))) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
    }
    if (u.pathname === "/api/flows/events") return route.fulfill({ contentType: "application/json", body: JSON.stringify(events) });
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending", rows: [] }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/events/");
  await page.waitForFunction(() => document.querySelector("#erRisk .er-row, #erRisk .ui-silent"), null, { timeout: 15000 }).catch(() => {});
  return { context, page, world };
}
