import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";
import { liveEntry, phaseView } from "../shared/flows-live-worker.js";
import { phaseAt, expectedNightlySession, freshHeaders } from "../shared/flows-freshness.js";
import { realisticWorld, respondWith } from "./lib/sfc-render-world.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const ONLY = process.env.LAYOUT_SWEEP_ONLY ? new RegExp(process.env.LAYOUT_SWEEP_ONLY) : null;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const require = createRequire(import.meta.url);

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const NOW = Date.parse("2026-08-24T15:25:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

let ledgerAnswer = null;
const dir = mkdtempSync(path.join(tmpdir(), "flows-pages-"));
try {
  execFileSync("node", [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", path.join(dir, "p.json")], { stdio: "pipe" });
} catch (error) {
  console.error("the pipeline itself failed to run, so no page can be rendered against its emit");
  console.error(String(error.stdout || "") + String(error.stderr || ""));
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

const emitted = (name) => {
  const flat = path.join(dir, "p-" + name.replace(":", "-") + ".json");
  if (existsSync(flat)) return JSON.parse(readFileSync(flat, "utf8"));
  const raw = path.join(dir, "p-" + name + ".json");
  return existsSync(raw) ? JSON.parse(readFileSync(raw, "utf8")) : null;
};

const liveFile = (key) => emitted("live-" + (key.startsWith("live:") ? key.slice(5) : key));

const entryFor = (payload) => {
  const f = payload && payload.fresh;
  if (!f) return null;
  return liveEntry({ readAt: Date.parse(f.readAt), session: f.session, cadenceS: f.cadenceS, source: f.source }, Date.parse(f.readAt), NOW, null);
};

const nightlyEntry = (p) => {
  if (!p) return { state: "pending", reason: "unpublished", klass: "nightly" };
  const meta = { readAt: Date.parse(p.generatedAt || p.readAt || "2026-08-24T22:00:00Z"), session: p.sessionDate, cadenceS: 86400, source: "actions", klass: "nightly" };
  return liveEntry(meta, meta.readAt, NOW, null);
};

const READ = {
  version: 1, status: "fallback", ticker: "NVDA", generated: false, label: "Deterministic reading", model: null, modelName: null, neurons: null, tokens: null,
  provenance: "Deterministic reading: assembled from templates over the dossier's facts.", note: null, why: "cooldown",
  fingerprint: "d1.abc", asOf: iso(NOW), session: "2026-08-24", generatedAt: null, coverage: { ok: 8, partial: 2, withheld: 2, pending: 0 },
  tags: [{ code: "dealer-pinned", label: "Dealers pinning", sentence: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", evidence: ["options.state"] }],
  sections: {
    identity: { text: "NVIDIA designs graphics processors and data-centre accelerators.", cites: [{ id: "identity.description", label: "Company description", display: "profile", asOf: iso(NOW), kind: "identity", grade: 2 }] },
    now: { text: "The last price is $127.40, +1.27% from the previous close.", cites: [{ id: "price.last", label: "Last price", display: "$127.40", asOf: iso(NOW), kind: "price", grade: 3 }] },
    drivers: [{ text: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", cites: [{ id: "options.state", label: "Implied dealer state", display: "pinned", asOf: iso(NOW), kind: "options", grade: 2 }] }],
    tensions: [], watch: [], unknown: [{ text: "Fundamentals are withheld, so nothing is claimed about revenue.", missing: ["fundamentals"] }],
  },
  refused: [],
};

function answer(route, u) {
  const q = u.searchParams;
  switch (route) {
    case "board": return emitted("board-" + (q.get("side") || "long"));
    case "market": case "events": case "scoretrack": case "meta": case "flowalerts": case "pulse": case "news":
    case "political": case "positioning": case "unusual": case "movers": case "universe": case "regime": case "ideas": case "focus": case "roster": case "record": case "brief":
      return emitted(route) || { status: "pending" };
    case "sectors": return emitted("sector-trix") || { status: "pending", rows: [] };
    case "sector-premium": return emitted("sector-premium") || { status: "pending", sectors: [] };
    case "card": return emitted("card-" + q.get("t")) || { status: "pending" };
    case "card-x": return emitted("card-x-" + q.get("t")) || { status: "pending" };
    case "hist": return emitted("hist-" + q.get("t")) || { status: "pending" };
    case "flowlab/nightly": return emitted("flowlab-" + q.get("k")) || { status: "pending" };
    case "flowlab/screen": case "flowlab/contract": case "flowlab/name": case "flowlab/group": case "flowlab/lit": case "flowlab/venues":
      return { v: 1, asOf: new Date(NOW).toISOString(), session: null, part: route.slice(8), calls: 1, why: "empty", x: null };
    case "ai-usage": return { spend: { neurons: 4200, cap: 30000, calls: 40 } };
    case "ledger": { ledgerAnswer ||= respondWith(realisticWorld()); return ledgerAnswer(u); }
    case "summary": return { status: "ok", scope: q.get("t") || "", summary: null, ideas: [], tier: "family", code: null, why: "x", read: READ };
    case "lk": {
      const keys = {};
      for (const k of String(q.get("k") || "").split(",")) {
        const p = liveFile("live:" + k);
        keys[k] = p ? { status: "ok", payload: p, updatedAt: Date.parse(p.fresh.readAt), fresh: entryFor(p) } : { status: "pending", fresh: { state: "pending", reason: "unpublished", klass: "market" } };
      }
      return { serverNow: NOW, phase: phaseView(phaseAt(NOW, null)), keys };
    }
    case "now": {
      const keys = {};
      for (const k of String(q.get("k") || "").split(",").filter(Boolean)) {
        const id = k.startsWith("live:") ? k : "live:" + k;
        const p = liveFile(id);
        keys[id] = p ? entryFor(p) : { state: "pending", reason: "unpublished", klass: "market" };
      }
      for (const k of String(q.get("n") || "").split(",").filter(Boolean)) keys[k] = nightlyEntry(emitted(k.replace(":", "-")));
      return { serverNow: NOW, tier1: { at: iso(NOW - 120000), okAt: iso(NOW - 120000), why: null }, clock: null,
        expected: expectedNightlySession(NOW, null), phase: phaseView(phaseAt(NOW, null)), keys };
    }
    default: return null;
  }
}

const SPECS = [
  { id: "login", fn: "loginPage", url: "/flows/login/", dock: false },
  { id: "about", fn: "aboutPage", url: "/flows/about/", dock: false },
  { id: "glossary", fn: "glossaryPage", url: "/flows/glossary/", dock: false },
  { id: "overview", fn: "overviewPage", url: "/flows/" },
  { id: "long", fn: "sidePage", args: { side: "long" }, url: "/flows/long/" },
  { id: "short", fn: "sidePage", args: { side: "short" }, url: "/flows/short/" },
  { id: "watch", fn: "watchPage", url: "/flows/watch/" },
  { id: "market", fn: "marketPage", url: "/flows/market/" },
  { id: "network", fn: "networkPage", url: "/flows/network/" },
  { id: "now", fn: "nowPage", url: "/flows/now/" },

  { id: "unusual", fn: "unusualPage", url: "/flows/unusual/" },
  { id: "events", fn: "eventsPage", url: "/flows/events/" },
  { id: "moves", fn: "movesPage", url: "/flows/moves/" },
  { id: "political", fn: "politicalPage", url: "/flows/political/" },
  { id: "political-layers", fn: "politicalPage", args: { layers: true }, url: "/flows/political/" },
  { id: "positioning", fn: "positioningPage", url: "/flows/positioning/" },
  { id: "strategy", fn: "strategyPage", url: "/flows/strategy/?t=NVDA" },
  { id: "desk", fn: "deskPage", url: "/flows/desk/" },
  { id: "ticker", fn: "tickerPage", url: "/flows/ticker/?t=NVDA" },
  { id: "ledger", fn: "ledgerPage", url: "/flows/ledger/" },
  { id: "flowlab", fn: "flowlabPage", url: "/flows/flowlab/" },
  { id: "status", fn: "statusPage", url: "/flows/status/" },
];

const pageFunctions = Object.keys(PAGES.FLOWS_PAGES).filter((k) => typeof PAGES.FLOWS_PAGES[k] === "function").sort();
const covered = SPECS.map((s) => s.fn).filter((fn, i, all) => all.indexOf(fn) === i).sort();
assert.deepEqual(covered, pageFunctions, "every page function in FLOWS_PAGES is rendered by this suite");
checks++;

async function mount(page, html, url, patch = null) {
  const asked = [];
  let inflight = 0;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) { if (!src.includes(from)) throw new Error("mutant anchor missing: " + from); src = src.replaceAll(from, to); }
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":{"code":"rt_off"}}' });
    if (u.pathname.startsWith("/api/flows/")) {
      const r = u.pathname.slice("/api/flows/".length);
      asked.push(r);
      const body = answer(r, u) || { status: "pending" };
      let headers = { "X-Server-Now": String(NOW) };
      if (body && body.generatedAt && body.sessionDate) {
        const meta = { readAt: Date.parse(body.generatedAt), session: body.sessionDate, cadenceS: 86400, source: "actions", klass: "nightly" };
        try { headers = { ...headers, ...freshHeaders(meta, NOW, null).headers, "X-Payload-Updated": String(Date.parse(body.generatedAt)) }; } catch {}
      }
      return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/") || u.pathname === "/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  const track = (r) => { if (/\/api\/flows\//.test(r.url())) inflight += r._d; };
  page.on("request", (r) => { r._d = 1; track(r); });
  page.on("requestfinished", (r) => { r._d = -1; track(r); });
  page.on("requestfailed", (r) => { r._d = -1; track(r); });
  await page.clock.install({ time: new Date(NOW) });
  await page.goto("https://example.test" + url, { waitUntil: "load" });
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }" });
  await page.waitForTimeout(400);
  let stable = 0;
  let last = -1;
  for (let i = 0; i < 160 && stable < 4; i++) {
    await page.waitForTimeout(100);
    const size = await page.evaluate(() => document.getElementsByTagName("*").length + document.body.innerText.length);
    if (inflight === 0 && size === last) stable++;
    else stable = 0;
    last = size;
  }
  return asked;
}


const SIZES = (process.env.SIZES || "1920x1080,1440x820,1024x768,390x844").split(",").map((s) => s.split("x").map(Number));
const ONE_SCREEN = new Set(["overview", "market", "moves", "unusual", "events", "political", "status", "network", "now", "ledger", "flowlab"]);

const SWEEP = () => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || n.inert || n.hasAttribute("hidden") || (cs.clipPath && cs.clipPath !== "none")) return false;
    }
    return !e.closest("dialog:not([open]), .visually-hidden, .fd-cut");
  };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/)[0] : "");
  const out = { scroll: [], inner: [], clipped: [], outside: [], canvas: [] };
  const d = document.documentElement;
  if (d.scrollHeight > innerHeight + 1) out.scroll.push("page height " + d.scrollHeight + " over " + innerHeight);
  if (d.scrollWidth > innerWidth + 1) out.scroll.push("page width " + d.scrollWidth + " over " + innerWidth);
  for (const e of document.querySelectorAll("body *")) {
    if (!vis(e) || e.closest("svg, dialog, #askDock, #fxPop, .ui-roll")) continue;
    const cs = getComputedStyle(e);
    if (e.clientWidth <= 2 || e.clientHeight <= 2 || (e.parentElement && (e.parentElement.clientWidth <= 2 || e.parentElement.clientHeight <= 2))) continue;
    const clamped = (n) => { for (; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if ((c.webkitLineClamp && c.webkitLineClamp !== "none") || (c.lineClamp !== undefined && c.lineClamp !== "none" && c.lineClamp !== "")) return true; } return false; };
    if (clamped(e)) continue;
    if (!e.matches(".fx-side > .flows-rail") && /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 0 && e !== d && e !== document.body) out.inner.push(name(e) + " " + e.scrollHeight + ">" + e.clientHeight);
    if (/(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== "ellipsis" && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && e.children.length === 0 && (e.textContent || "").trim()) out.clipped.push(name(e) + " " + e.scrollWidth + ">" + e.clientWidth + " " + (e.textContent || "").trim().slice(0, 24));
    if (/(hidden|clip)/.test(cs.overflowY) && cs.textOverflow !== "ellipsis" && e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 0 && e.children.length === 0 && (e.textContent || "").trim()) out.clipped.push(name(e) + " v" + e.scrollHeight + ">" + e.clientHeight + " " + (e.textContent || "").trim().slice(0, 24));
    const p = e.parentElement;
    if (p && p !== document.body) {
      const pc = getComputedStyle(p);
      if (/(hidden|clip)/.test(pc.overflow) && !/(auto|scroll)/.test(pc.overflow) && cs.position !== "absolute" && cs.position !== "fixed") {
        const r = e.getBoundingClientRect(), q = p.getBoundingClientRect();
        if ((r.bottom > q.bottom + 1.5 || r.right > q.right + 1.5 || r.top < q.top - 1.5 || r.left < q.left - 1.5) && r.width > 2 && r.height > 2 && !p.closest(".fd-cut")) out.outside.push(name(e) + " in " + name(p) + " by " + Math.round(Math.max(r.bottom - q.bottom, r.right - q.right, q.top - r.top, q.left - r.left)));
      }
    }
    if (e.tagName === "CANVAS" && e.clientWidth > 40 && e.clientHeight > 40) {
      const rx = e.width / e.clientWidth, ry = e.height / e.clientHeight;
      if (Math.abs(rx - ry) / Math.max(rx, ry) > 0.02) out.canvas.push(name(e) + " css " + e.clientWidth + "x" + e.clientHeight + " backing " + e.width + "x" + e.height);
    }
  }
  return out;
};

const STANDARD = ["1440x820", "1024x768", "390x844", "1920x1080"];
const gate = (e) => e.fatal || (e.one && STANDARD.includes(e.size) && (e.scroll.length || e.inner.length)) || e.canvas.length || (STANDARD.includes(e.size) && (e.clipped.length || e.outside.length)) || (e.errors || []).length > 0;

const browser = await chromium.launch();
async function sweepSpec(spec, width, height, patch = null) {
  const out = [];
  const coarse = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: coarse, isMobile: coarse, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    const html = String(PAGES[spec.fn]({ username: "anilkaya", ...(spec.args || {}) }));
    await mount(page, html, spec.url, patch);
    const tabs = await page.$$eval("main [role=tablist] [role=tab], .flows-main [role=tablist] [role=tab]", (l) => l.filter((t) => t.getBoundingClientRect().width > 0).map((t) => t.id || t.dataset.tab || t.textContent.trim()));
    for (const v of [null, ...tabs]) {
      if (v) {
        const sel = await page.evaluate((name) => { const t = [...document.querySelectorAll("[role=tab]")].find((x) => (x.id || x.dataset.tab || x.textContent.trim()) === name); if (!t) return false; t.click(); return true; }, v);
        if (!sel) continue;
        await page.waitForTimeout(500);
      }
      const r = await page.evaluate(SWEEP);
      if (process.env.SHOTS && !patch) await page.screenshot({ path: path.join(process.env.SHOTS, `${spec.id}-${width}x${height}${v ? "-" + v.replace(/\W+/g, "_") : ""}.png`) });
      out.push({ page: spec.id, size: width + "x" + height, view: v, one: ONE_SCREEN.has(spec.id), ...r, errors });
    }
  } catch (error) {
    out.push({ page: spec.id, size: width + "x" + height, fatal: String(error).slice(0, 200) });
  }
  await ctx.close();
  return out;
}

const report = [];
const mutantsFailed = [];
try {
  for (const spec of SPECS) {
    for (const [width, height] of SIZES) {
      if (ONLY && !ONLY.test(`${spec.id}@${width}`)) continue;
      report.push(...await sweepSpec(spec, width, height));
    }
  }
  if (!ONLY && !process.env.NO_MUTANTS) {
    const byId = (id) => SPECS.find((x) => x.id === id);
    const MUTANTS = [
      ["the sidebar scrolls inside itself at a short height", "status", 1440, 820, { "/assets/css/flows.css": [["  overflow: hidden;\n  visibility: hidden;", "  overflow-y: auto;\n  visibility: hidden;"], [".fx-side > .flows-rail { flex: 1 1 auto; min-height: 0; overflow-y: auto;", ".fx-side > .flows-rail { flex: 0 0 auto; min-height: 0;"]] }],
      ["the network module scrolls inside and keeps a fixed stage", "unusual", 1440, 820, { "/assets/css/flows-feeds.css": [[".fd-stage > .fd-mod[data-free] { overflow: hidden; }", ".fd-stage > .fd-mod[data-free] { overflow-y: auto; }"], [".fd-stage > .fd-mod[data-free] > .fn-host > .fn-stage { flex: 1; min-height: 0; height: auto; margin: 0; }", ".fd-stage > .fd-mod[data-free] > .fn-host > .fn-stage { flex: none; height: 560px; margin: 0; }"]] }],
      ["the index volatility chart is taller than its card", "market", 1440, 820, { "/assets/js/flows-market-below.js": [["height: [150, 160, 180],\n      xTicks: [{ v: 7", "height: [180, 210, 230],\n      xTicks: [{ v: 7"]] }],
      ["the small sector tiles print a value wider than the tile", "market", 390, 844, { "/assets/css/flows-market.css": [["clamp(9px, min(11cqmin, 17cqw), 28px)", "clamp(14px, 11cqmin, 30px)"], [".mk-small-h b { grid-area: v; min-width: 0; overflow: visible;", ".mk-small-h b { grid-area: v; min-width: 0; overflow: hidden;"]] }],
      ["the feed fitter trims only one stacked group", "unusual", 390, 844, { "/assets/js/flows-feed-os.js": [["for (const kids of groups) {", "for (const kids of groups.slice(0, 1)) {"]] }],
      ["the scene is laid out at a clamped height the canvas is not shown at", "unusual", 1440, 820, { "/assets/js/flows-net.js": [["H = FIT ? avail :", "H = FIT ? Math.max(avail, 700) :"]] }],
    ];
    for (const [name, id, w, h, patch] of MUTANTS) {
      const seen = await sweepSpec(byId(id), w, h, patch);
      if (!seen.some(gate)) mutantsFailed.push(name);
    }
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
const bad = report.filter(gate);
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(report, null, 1));
for (const e of bad) console.log(e.page, e.size, e.view || "-", JSON.stringify({ fatal: e.fatal, scroll: e.scroll, inner: (e.inner || []).slice(0, 4), clipped: (e.clipped || []).slice(0, 4), outside: (e.outside || []).slice(0, 4), canvas: e.canvas }));
for (const name of mutantsFailed) console.log("PLANTED WRONG BUILD NOT CAUGHT: " + name);
console.log(`flows-layout-sweep: ${report.length} views swept, ${bad.length} with findings, ${mutantsFailed.length} planted wrong builds uncaught`);
process.exit(process.env.REPORT_ONLY === "1" || (bad.length === 0 && mutantsFailed.length === 0) ? 0 : 1);
