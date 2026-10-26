import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../shared/flows-pages.js";
import { launch } from "./lib/browser.mjs";
import { nightlyEmit, emitRead } from "./lib/nightly-emit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const SESSION = "2026-09-29";
const NOW = Date.parse("2026-08-24T15:25:00.000Z");
const SIZES = [{ width: 1440, height: 820 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 844 }];

const NAMES = [["NVDA", 1.0, 0.7], ["SPY", 0.8, 0.4], ["TSLA", 0.6, 0.5], ["AAPL", 0.5, 0.6], ["AMZN", 0.45, 0.65], ["META", 0.4, 0.7], ["MSFT", 0.35, 0.55],
  ["AMD", 0.3, 0.6], ["MU", 0.22, 0.66], ["NFLX", 0.2, 0.5], ["COIN", 0.15, 0.6], ["XOM", 0.1, 0.4]];
const lcg = (seed) => { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };
const alertsPayload = () => {
  const r = lcg(31), rows = [];
  for (let i = 0; i < 90; i++) {
    let pick = r() * NAMES.reduce((a, x) => a + x[1], 0), j = 0;
    while (pick > NAMES[j][1] && j < NAMES.length - 1) { pick -= NAMES[j][1]; j++; }
    const cp = r() < NAMES[j][2] ? "C" : "P", prem = Math.round(150000 * Math.exp(r() * 3) * (0.6 + NAMES[j][1]));
    const share = Math.min(0.95, Math.max(0.05, 0.55 + (r() - 0.5) * 0.9));
    const at = new Date(Date.parse(SESSION + "T13:35:00Z") + Math.floor(r() * 300) * 60000).toISOString();
    rows.push({ t: NAMES[j][0], oc: NAMES[j][0] + "261016" + cp + String(100000 + i), cp, k: 100 + i, exp: "2026-10-16", prem, size: Math.round(prem / 300), trades: 3,
      askPrem: Math.round(prem * 0.9 * share), bidPrem: Math.round(prem * 0.9 * (1 - share)), sweep: i % 3 === 0, floor: false, single: true, opening: false,
      spanStart: at, spanEnd: at, rule: "RepeatedHits", st: i % 4 === 0 ? "board:long" : null, firstAt: at, lastAt: "2026-09-29T18:41:00.000Z", reads: 2 });
  }
  rows.sort((a, b) => b.prem - a.prem);
  return { v: 1, status: "ok", generatedAt: "2026-09-29T18:41:05.000Z", sessionDate: SESSION, readAt: "2026-09-29T18:41:00.000Z", refreshed: "intraday", rows, seen: rows.length, unusable: 0, shed: 0, cap: 180, coverage: {}, notes: {} };
};
const MANY = Array.from({ length: 40 }, (_, i) => (i < NAMES.length ? NAMES[i] : ["SYN" + (100 + i), 0.1, 0.5]));
const feedPayload = () => ({
  v: 1, status: "ok", generatedAt: "2026-09-29T18:41:05.000Z", sessionDate: SESSION, readAt: "2026-09-29T18:41:00.000Z", namesSeen: 12, dteAnchor: "sessionDate",
  contracts: { shown: 40, eligible: 40, capBound: "eligible", rows: MANY.map((x, i) => ({ t: x[0], cp: i % 2 ? "P" : "C", k: 100 + i, expiry: "2026-10-16", vol: 9000 + i, oi: 900 + i, vor: 10 - i / 2, doi: 50 * (i - 2), lift: 0.6, nlo: 1e5, nhi: 4e5, st: null })) },
  names: { universe: 670, ranked: 40, unranked: 630, shown: 40, rows: MANY.map((x, i) => ({ t: x[0], sc: 4 - i * 0.3, sp: 2 + i * 0.3, st: 3 + i * 0.1, chg: 0.01 * (i - 2), putCallRatio: 0.8 })) },
  coverage: NAMES.slice(0, 4).map((x) => ({ t: x[0] })), basis: { unit: { line: "A counter, not a trade." }, date: { line: "The session date." } },
});

const dir = nightlyEmit();

async function open(browser, kind, viewport, patch = null) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => { errors.push(String(e)); if (process.env.DBG) console.log("PAGEERROR", String(e)); });
  if (kind === "events") await page.clock.install({ time: NOW });
  const html = kind === "events" ? PAGES.eventsPage({ username: "test" }) : PAGES.unusualPage({ username: "test" });
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
    if (u.pathname === "/api/flows/flowalerts") return route.fulfill({ contentType: "application/json", body: JSON.stringify(alertsPayload()) });
    if (u.pathname === "/api/flows/unusual") return route.fulfill({ contentType: "application/json", body: JSON.stringify(feedPayload()) });
    if (u.pathname === "/api/flows/events") return route.fulfill({ contentType: "application/json", body: JSON.stringify(emitRead(dir, "events")) });
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending", rows: [] }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  if (process.env.DBG) { page.on("console", (m) => console.log("console", m.text().slice(0, 200))); page.on("request", (r) => console.log("req", new URL(r.url()).pathname)); page.on("requestfailed", (r) => console.log("failed", r.url())); }
  await page.goto(`https://example.test/flows/${kind}/`);
  await page.waitForTimeout(kind === "events" ? 1500 : 5000);
  return { context, page, errors };
}

const MEASURE = () => {
  const d = document.documentElement;
  const clip = [];
  const inner = [], canv = [];
  for (const m of document.querySelectorAll(".fd-mod[data-on]")) {
    if (m.scrollHeight > m.clientHeight + 1) inner.push(m.id + " " + m.scrollHeight + ">" + m.clientHeight);
    for (const e of m.querySelectorAll("*")) {
      if (e.tagName !== "CANVAS" || e.closest("[hidden]") || e.clientWidth < 100 || e.clientHeight < 100) continue;
      const rx = e.width / e.clientWidth, ry = e.height / e.clientHeight;
      if (Math.abs(rx - ry) / Math.max(rx, ry) > 0.02) canv.push(m.id + " css " + e.clientWidth + "x" + e.clientHeight + " backing " + e.width + "x" + e.height);
    }
    const lg = m.querySelector(".fn-scale:not([hidden])");
    if (lg) { const a = lg.getBoundingClientRect(), b = m.getBoundingClientRect(); if (a.bottom > b.bottom + 1 || lg.scrollHeight > lg.clientHeight + 1) inner.push(m.id + " legend cut"); }
  }
  for (const m of document.querySelectorAll(".fd-mod[data-on]:not([data-free])")) {
    const r = m.getBoundingClientRect();
    for (const e of m.querySelectorAll("*")) {
      if (e.closest("dialog, [hidden], .fd-cut, svg, details:not([open])")) continue;
      const q = e.getBoundingClientRect();
      if (q.height && q.width && (q.bottom > r.bottom + 1 || q.right > r.right + 1)) { clip.push(m.id + ">" + e.tagName.toLowerCase() + "." + String(e.className).slice(0, 20) + ":" + Math.round(Math.max(q.bottom - r.bottom, q.right - r.right))); break; }
    }
  }
  const sel = [...document.querySelectorAll("#fdTabs [role=tab]")].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.dataset.tab);
  const on = [...document.querySelectorAll(".fd-mod")].filter((m) => m.hasAttribute("data-on") && getComputedStyle(m).visibility !== "hidden").map((m) => m.dataset.tab);
  const off = [...document.querySelectorAll(".fd-mod")].filter((m) => !m.hasAttribute("data-on")).every((m) => m.inert && getComputedStyle(m).visibility === "hidden");
  return { inner, canv, sh: d.scrollHeight, ih: innerHeight, sw: d.scrollWidth, iw: innerWidth, clip, sel, on, off, view: document.getElementById("fdStage").dataset.view, hash: location.hash };
};

async function sweep(page, label) {
  const bad = [];
  const tabs = await page.$$eval("#fdTabs [role=tab]", (l) => l.map((t) => t.dataset.tab));
  for (const t of tabs) {
    await page.click(`#fdT-${t}`);
    await page.waitForTimeout(400);
    let m = await page.evaluate(MEASURE);
    for (let n = 0; n < 6 && m.clip.length; n++) { await page.waitForTimeout(250); m = await page.evaluate(MEASURE); }
    const at = `${label} ${t}`;
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, label.replace(/ /g, "-") + "-" + t + ".png") });
    if (m.sh > m.ih + 1) bad.push(`${at}: the page scrolls (${m.sh} against ${m.ih})`);
    if (m.sw > m.iw) bad.push(`${at}: the page scrolls sideways`);
    if (m.inner.length) bad.push(`${at}: a module scrolls inside or cuts its legend: ${m.inner.join(", ")}`);
    if (m.canv.length) bad.push(`${at}: a canvas is drawn at one size and shown at another: ${m.canv.join(", ")}`);
    if (m.clip.length && process.env.DBG) console.log(at, await page.evaluate(() => { const b = document.querySelector(".fd-mod[data-on] .fd-body"); return [b.clientHeight, b.scrollHeight, b.querySelectorAll(".fd-cut").length, b.children.length, b.firstElementChild.className, b.firstElementChild.children.length, b.firstElementChild.scrollHeight].join(" | "); }));
    if (m.clip.length) bad.push(`${at}: content is clipped: ${m.clip.join(", ")}`);
    if (m.view !== t || m.sel.join() !== t || m.on.join() !== t) bad.push(`${at}: tab state is ${m.view}/${m.sel}/${m.on}`);
    if (!m.off) bad.push(`${at}: a module that is not on is visible or not inert`);
    if (m.hash !== "#view=" + t) bad.push(`${at}: the address says ${m.hash}`);
  }
  return bad;
}

async function dialogs(page, label) {
  const bad = [];
  const tabs = await page.$$eval("#fdTabs [role=tab]", (l) => l.map((t) => t.dataset.tab));
  let seen = 0;
  for (const t of tabs) {
    await page.click(`#fdT-${t}`);
    await page.waitForTimeout(350);
    if (process.env.DBG) console.log(label, t, await page.evaluate(() => { const b = document.querySelector(".fd-mod[data-on] .fd-body"); if (!b) return "nobody"; return document.querySelectorAll(".fd-cut").length + " cut " + document.querySelectorAll(".fd-all").length + " btn |" +b.clientHeight + "/" + b.scrollHeight + " " + b.innerHTML.slice(0, 120); }));
    const btn = page.locator(".fd-mod[data-on] .fd-all:not([hidden])");
    if (!(await btn.count()) || !(await btn.first().isVisible())) continue;
    seen++;
    await btn.first().click();
    await page.waitForSelector("dialog[open]");
    const g = await page.evaluate(() => { const d = document.querySelector("dialog[open]"); const r = d.getBoundingClientRect(); return { h: r.height, w: r.width, ih: innerHeight, iw: innerWidth, sh: document.documentElement.scrollHeight, rows: d.querySelectorAll("li, tr, .ui-row, div").length }; });
    if (g.h > g.ih + 1 || g.w > g.iw + 1) bad.push(`${label} ${t}: the Show all dialog is larger than the screen`);
    if (g.rows < 4) bad.push(`${label} ${t}: the Show all dialog is empty`);
    if (g.sh > g.ih + 1) bad.push(`${label} ${t}: opening the dialog scrolls the page`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
  return { bad, seen };
}

for (const html of [PAGES.unusualPage({ username: "t" }), PAGES.eventsPage({ username: "t" })]) {
  ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), "the served page carries no inline script for the content policy to refuse");
  ok(!/Eastern/.test(html), "and names no Eastern date");
}

const browser = await launch({});
try {
  for (const kind of ["unusual", "events"]) {
    for (const size of SIZES) {
      const label = `${kind} ${size.width}x${size.height}`;
      const { context, page, errors } = await open(browser, kind, size);
      const bad = await sweep(page, label);
      const dl = await dialogs(page, label);
      bad.push(...dl.bad);
      ok(!bad.length, `ONE SCREEN: ${bad.join("; ")}`);
      ok(dl.seen > 0 || kind === "unusual" && size.width < 500, `${label}: at least one module cuts rows and offers Show all`);
      ok(!errors.length, `${label}: no page error: ${errors.join(" | ")}`);
      if (kind === "unusual") {
        await page.click("#fdT-network");
        await page.waitForTimeout(300);
        const w = await page.evaluate(() => { const m = document.getElementById("uaNetCard"); return [m.scrollWidth, m.clientWidth]; });
        ok(w[0] <= w[1] + 1, `${label}: the network module does not scroll sideways (${w[0]} in ${w[1]})`);
      }
      await page.click("#fdTabs [role=tab]:nth-child(2)");
      await page.focus("#fdTabs [role=tab][aria-selected=true]");
      await page.keyboard.press("ArrowRight");
      const k = await page.evaluate(() => document.getElementById("fdStage").dataset.view);
      const second = await page.$$eval("#fdTabs [role=tab]", (l) => l[2].dataset.tab);
      ok(k === second, `${label}: ArrowRight moves to the next tab`);
      await context.close();
    }
  }

  {
    const { context, page } = await open(browser, "events", SIZES[0]);
    const text = await page.evaluate(() => document.body.innerText);
    ok(!/Eastern/.test(text), "Events names no Eastern date");
    const html = await page.evaluate(() => document.getElementById("evAbout").textContent + document.getElementById("evStatus").textContent);
    ok(!/Eastern/.test(html), "and neither does its explanation or status line");
    ok(/\d{2}:\d{2} TRT/.test(await page.evaluate(() => document.getElementById("evMeta").textContent)), "the head prints the build time in TRT");
    await page.click("#fdT-week");
    const dashes = await page.evaluate(() => [...document.querySelectorAll("#evWeek .fe-cell")].filter((c) => /^\s*[—–-]\s*$/.test(c.textContent)).length);
    ok(dashes === 0, `no week cell is a bare dash (${dashes})`);
    await context.close();
  }

  const MUTANTS = [
    ["the stage no longer clips: the page scrolls", "events", { "/assets/css/flows-feeds.css": [["  overflow: hidden;\n}\n.flows-body[data-flows-page=\"unusual\"] .flows-main > *", "}\n.flows-body[data-flows-page=\"unusual\"] .flows-main > *"], ["height: 100dvh;\n  padding-bottom: var(--fd-pad-b)", "height: auto;\n  padding-bottom: var(--fd-pad-b)"]] }],
    ["the network module scrolls inside and its stage keeps a fixed height", "unusual", { "/assets/css/flows-feeds.css": [[".fd-stage > .fd-mod[data-free] { overflow: hidden; }", ".fd-stage > .fd-mod[data-free] { overflow-y: auto; }"], [".fd-stage > .fd-mod[data-free] > .fn-host > .fn-stage { flex: 1; min-height: 0; height: auto; margin: 0; }", ".fd-stage > .fd-mod[data-free] > .fn-host > .fn-stage { flex: none; height: 560px; margin: 0; }"]] }],
    ["the scene is laid out at a clamped height the canvas is not shown at", "unusual", { "/assets/js/flows-net.js": [["H = FIT ? avail :", "H = FIT ? Math.max(avail, 700) :"]] }],
    ["the fitter is off: content is clipped", "events", { "/assets/js/flows-feed-os.js": [["const later = () => { if (!queued) queued = requestAnimationFrame(fitAll); };", "const later = () => {};"]] }],
    ["inactive modules stay visible", "unusual", { "/assets/css/flows-feeds.css": [[".fd-stage > .fd-mod { position: absolute; inset: 0; visibility: hidden;", ".fd-stage > .fd-mod { position: absolute; inset: 0; visibility: visible;"]] }],
  ];
  for (const [name, kind, patch] of MUTANTS) {
    const { context, page } = await open(browser, kind, SIZES[0], patch);
    const bad = await sweep(page, name);
    ok(bad.length > 0, `PLANTED WRONG BUILD FAILS: ${name}`);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-feeds-onescreen: ${checks} checks`);
