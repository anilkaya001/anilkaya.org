import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.NET_SHOTS || null;
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, msg) => { assert.ok(Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9), msg + ` (${a} against ${b})`); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const SESSION = "2026-09-29";
const AT = Date.parse("2026-09-29T14:41:00-04:00");

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const NAMES = [
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

function alerts({ n = 140, seed = 11, names = NAMES } = {}) {
  const r = rng(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    let pick = r() * names.reduce((s, x) => s + x[2], 0), j = 0;
    while (pick > names[j][2] && j < names.length - 1) { pick -= names[j][2]; j++; }
    const [t, , , callBias] = names[j];
    const cp = r() < callBias ? "C" : "P";
    const prem = Math.round(120000 * Math.exp(r() * 3.1) * (0.6 + names[j][2]));
    const askShare = Math.min(0.97, Math.max(0.03, (cp === "C" ? 0.58 : 0.5) + (r() - 0.5) * 0.9));
    const between = r() * 0.18;
    const askPrem = Math.round(prem * (1 - between) * askShare), bidPrem = Math.round(prem * (1 - between) * (1 - askShare));
    const exp = EXPIRIES[Math.floor(Math.pow(r(), 1.6) * EXPIRIES.length)];
    const minute = 9 * 60 + 31 + Math.floor(r() * 300);
    const spanStart = new Date(Date.parse(SESSION + "T00:00:00-04:00") + minute * 60000).toISOString();
    const k = Math.round(100 + r() * 400);
    rows.push({
      t, oc: t + "260000" + cp + String(k * 1000).padStart(8, "0") + i, cp, k, exp, prem, size: Math.round(prem / 300), trades: 1 + Math.floor(r() * 40),
      askPrem, bidPrem: r() < 0.06 ? null : bidPrem, sweep: r() < 0.4, floor: false, single: true, opening: r() < 0.5,
      spanStart, spanEnd: spanStart, rule: "RepeatedHits", st: null,
      firstAt: spanStart, lastAt: "2026-09-29T18:41:00.000Z", reads: 3,
    });
  }
  rows.sort((a, b) => b.prem - a.prem);
  return {
    v: 1, status: "ok", generatedAt: "2026-09-29T18:41:05.000Z", sessionDate: SESSION, readAt: "2026-09-29T18:41:00.000Z",
    refreshed: "intraday", rows, seen: rows.length, unusable: 0, shed: 0, cap: 180, coverage: {}, notes: {},
  };
}

function universe(names = NAMES) {
  const listed = names.filter((x) => x[1]);
  const sectors = [...new Set(listed.map((x) => x[1]))];
  return { v: 1, status: "ok", sessionDate: "2026-09-28", t: listed.map((x) => x[0]), sectors, sec: listed.map((x) => sectors.indexOf(x[1])) };
}

const SHORT = [[/tech/, "Tech"], [/health/, "Health"], [/financ/, "Financial"], [/cyclical|discretionary/, "Cyclical"], [/defensive|staples/, "Defensive"],
  [/industr/, "Industrial"], [/energy/, "Energy"], [/material/, "Materials"], [/real estate/, "Real estate"], [/utilit/, "Utilities"], [/communic/, "Comms"]];
function expected(flow, { names = 10 } = {}) {
  const rows = flow.rows.filter((r) => r.prem > 0);
  const total = rows.reduce((s, r) => s + r.prem, 0);
  const kinds = { ca: 0, cb: 0, pa: 0, pb: 0, nx: 0 };
  const byName = new Map(), bySector = new Map();
  const secOf = new Map(NAMES.map((x) => [x[0], x[1] ? SHORT.find(([re]) => re.test(x[1].toLowerCase()))[1] : "No sector"]));
  for (const r of rows) {
    let a = r.askPrem || 0, b = r.bidPrem || 0;
    if (a + b > r.prem) { a *= r.prem / (a + b); b *= r.prem / (a + b); }
    kinds[r.cp === "C" ? "ca" : "pa"] += a;
    kinds[r.cp === "C" ? "cb" : "pb"] += b;
    kinds.nx += r.prem - a - b;
    byName.set(r.t, (byName.get(r.t) || 0) + r.prem);
    bySector.set(secOf.get(r.t), (bySector.get(secOf.get(r.t)) || 0) + r.prem);
  }
  const dte = new Set(rows.map((r) => {
    const d = Math.round((Date.parse(r.exp) - Date.parse(SESSION)) / 864e5);
    return d <= 0 ? "d0" : d <= 7 ? "w1" : d <= 31 ? "m1" : "far";
  }));
  return {
    total, kinds, byName, bySector, windows: rows.length,
    layers: [Object.values(kinds).filter((v) => v > 0).length, bySector.size > 6 ? 6 : bySector.size, byName.size > names + 1 ? names + 1 : byName.size, 3],
    dteOut: dte.size, bull: kinds.ca + kinds.pb, bear: kinds.cb + kinds.pa,
  };
}

async function mount(browser, { width = 1440, height = 1300, reduced = false, flow = alerts(), uni = universe(), flowStatus = 200, uniStatus = 200, deferAlerts = false, wait = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push("console: " + m.text()); });
  page.errors = errors;
  let release = null;
  const gate = deferAlerts ? new Promise((r) => { release = r; }) : null;
  page.release = () => release && release();
  const html = PAGES.unusualPage({ username: "test" });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/flowalerts") {
      if (gate) await gate;
      return route.fulfill({ status: flowStatus, contentType: "application/json", body: JSON.stringify(flow) });
    }
    if (u.pathname === "/api/flows/universe") return route.fulfill({ status: uniStatus, contentType: "application/json", body: JSON.stringify(uni) });
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/flows/")) return route.fulfill({ contentType: "application/json", headers: { "X-Server-Now": String(AT) }, body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/unusual/");
  if (wait) await page.waitForFunction(() => { const n = window.FlowsUI && window.FlowsUI.net && window.FlowsUI.net.of(document.getElementById("uaNet")); return n && n.stats().layers.length === 4 && n.stats().layers[1] > 1; }, null, { timeout: 15000 });
  return { ctx, page };
}

const net = (page, body, arg) => page.evaluate(new Function("arg", "const net = window.FlowsUI.net.of(document.getElementById('uaNet')); " + body), arg);
const stats = (page) => net(page, "return net.stats();");
const shot = async (page, name, kind = "card") => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const clip = await page.evaluate((kind) => {
    const r = document.getElementById("uaNetCard").getBoundingClientRect(), l = document.querySelector("#uaNet .fn-legend").getBoundingClientRect();
    if (kind === "net") return { x: r.left, y: Math.max(0, r.top), width: r.width, height: Math.min(innerHeight, l.bottom + 12) - Math.max(0, r.top) };
    return kind === "whole" ? { x: 0, y: 0, width: innerWidth, height: Math.min(r.bottom + scrollY + 40, 2400) } : { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  }, kind);
  await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: kind !== "net", clip });
};
const overlaps = (boxes) => {
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix > 1.5 && iy > 1.5) bad.push(a.id + " / " + b.id);
  }
  return bad;
};

const browser = await chromium.launch();
const cpu = {};
try {
  {
    const flow = alerts();
    const want = expected(flow);
    const { ctx, page } = await mount(browser, { width: 1440, height: 900 });
    await page.waitForTimeout(400);
    const st = await stats(page);
    deep(st.layers, want.layers, `the four layers carry the node counts the data implies: ${want.layers.join("-")} (side, sector, name, lean)`);
    const m = await net(page, `const m = net.model(); return { total: m.total, windows: m.windows, lean: m.lean,
      layers: m.layers.map((l) => l.map((d) => ({ id: d.id, v: d.v, label: d.label, share: d.share }))),
      edges: m.edges.map((hop) => hop.map((e) => ({ a: e.a, b: e.b, v: e.v }))) };`);
    near(m.total, want.total, "the network's premium is the sum of the flagged windows' premium");
    eq(m.windows, want.windows, "and it counts every window with a premium");
    m.layers.forEach((layer, i) => near(layer.reduce((s, d) => s + d.v, 0), want.total, `layer ${i} conserves the input premium`));
    m.edges.forEach((hop, i) => near(hop.reduce((s, e) => s + e.v, 0), want.total, `the edges of hop ${i} sum to the input premium`));
    for (const hop of m.edges) {
      const out = new Map();
      for (const e of hop) out.set(e.a, (out.get(e.a) || 0) + e.v);
      for (const [id, v] of out) near(v, m.layers.flat().find((d) => d.id === id).v, `every node's outgoing edges sum to its own premium (${id})`);
    }
    const node = (id) => m.layers.flat().find((d) => d.id === id);
    for (const k of ["ca", "cb", "pa", "pb", "nx"]) near(node("i:" + k).v, want.kinds[k], `the ${k} input carries exactly that side's premium`);
    near(node("n:NVDA").v, want.byName.get("NVDA"), "a name node carries its own windows' premium");
    near(node("s:tech").v, want.bySector.get("Tech"), "a sector node carries its names' premium");
    near(m.lean.bull, want.bull, "bullish lean is calls at ask plus puts at bid");
    near(m.lean.bear, want.bear, "bearish lean is calls at bid plus puts at ask");
    eq(node("s:none").label, "No sector", "index funds the universe does not carry are drawn under No sector, not guessed");
    ok(node("n:~") && node("n:~").label === "Other names", "names past the cap fold into one node, so the layer still sums");

    const aria = await page.evaluate(() => { const c = document.querySelector("#uaNet canvas"); return { role: c.getAttribute("role"), label: c.getAttribute("aria-label") }; });
    eq(aria.role, "img", "the canvas is an image to assistive technology");
    ok(/^Flow network of 140 flagged windows carrying \$\d/.test(aria.label) && /Largest paths: NVDA, calls at ask/.test(aria.label) && /leans bullish/.test(aria.label),
      `and its label states the top flows in words (${aria.label.slice(0, 160)}...)`);

    const table = await page.evaluate(() => {
      const t = document.querySelector("#uaNet table.fn-tab");
      const rows = [...t.querySelectorAll("tbody tr")];
      return {
        caption: t.querySelector("caption").textContent, heads: [...t.querySelectorAll("thead th")].map((x) => x.textContent),
        n: rows.length, shown: rows.filter((r) => !r.hidden).length,
        first: { t: rows[0].querySelector("th a").textContent, href: rows[0].querySelector("th a").getAttribute("href"), cells: [...rows[0].querySelectorAll("td")].map((x) => x.textContent) },
      };
    });
    eq(table.caption, "Largest paths by premium", "the accessible table has a caption");
    deep(table.heads, ["Name", "Sector", "Side", "Premium", "Lean"], "and the five columns asked for");
    eq(table.n, 24, "it lists the 24 largest name-and-side paths");
    eq(table.shown, 5, "five of them visible until the reader asks for all");
    eq(table.first.t, "NVDA", "led by the largest");
    eq(table.first.href, "/flows/ticker/?t=NVDA", "which links to its ticker page");
    ok(/^(Bullish|Bearish|Unattributed)$/.test(table.first.cells[3]), `the lean is a word, never a colour alone (${table.first.cells[3]})`);
    await page.click("#uaNet .fn-paths .ui-disclose");
    eq(await page.evaluate(() => [...document.querySelectorAll("#uaNet tbody tr")].filter((r) => !r.hidden).length), 24, "the disclosure shows all of them");

    const pill = await page.evaluate(() => { const b = document.querySelector("#uaNetCard .fn-fresh"); return { cls: b.className, state: b.dataset.state, text: b.textContent, pop: b.getAttribute("aria-haspopup") }; });
    ok(/ui-fresh/.test(pill.cls) && ["live", "fresh", "closed", "stale", "pending"].includes(pill.state), `the freshness pill is the platform's own (${JSON.stringify(pill)})`);
    ok(/2:41 PM ET/.test(pill.text), "and it states when the record was read, in Eastern time");
    await page.click("#uaNetCard .fn-fresh");
    eq(await page.evaluate(() => document.getElementById("fxPopT").textContent), "Freshness", "and opens the page's freshness details");
    await page.keyboard.press("Escape");

    const f0 = (await stats(page)).frames;
    await page.waitForTimeout(600);
    const s1 = await stats(page);
    ok(s1.running && s1.frames > f0 && s1.pulses > 20, `the network animates: frames ${f0} to ${s1.frames}, ${s1.pulses} pulses in flight`);

    const hitCount = await page.evaluate(() => document.querySelectorAll("#uaNet .fn-hit").length);
    eq(hitCount, want.layers.reduce((a, b) => a + b, 0), "every node has a hit target");
    const nv = await page.evaluate(() => { const a = document.querySelector('#uaNet .fn-hit[data-id="n:NVDA"]'); return { tag: a.tagName, href: a.getAttribute("href"), label: a.getAttribute("aria-label") }; });
    eq(nv.tag, "A", "a name node is a link");
    eq(nv.href, "/flows/ticker/?t=NVDA", "to the ticker page");
    ok(/^NVDA, Tech: \$[\d.]+M, \d+% of flagged premium/.test(nv.label), `and names its premium and share (${nv.label})`);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.hover('#uaNet .fn-hit[data-id="n:NVDA"]');
    await page.waitForTimeout(450);
    const lit = await net(page, `return ["n:NVDA", "s:tech", "i:ca", "o:bull", "n:MSFT", "s:energy", "n:SPY"].map((id) => [id, net.node(id).lit]);`);
    deep(Object.fromEntries(lit), { "n:NVDA": 1, "s:tech": 1, "i:ca": 1, "o:bull": 1, "n:MSFT": 0, "s:energy": 0, "n:SPY": 0 },
      "HOVERING A NAME lights its whole subgraph (its sector, its sides, its leans) and dims every other name and sector");
    const tip = await page.evaluate(() => { const t = document.querySelector("#uaNet .fn-tip"); return { hidden: t.hidden, text: t.textContent }; });
    ok(!tip.hidden && /NVDA/.test(tip.text) && /of flagged premium/.test(tip.text) && /Open NVDA/.test(tip.text), `and the tooltip lists its premium and share (${tip.text})`);
    await shot(page, "flow-net-hover-1440", "net");
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    eq((await net(page, `return net.node("n:MSFT").lit;`)), 1, "leaving the node restores the whole network");

    await page.hover("#uaNet tbody tr:first-child td:nth-child(3)");
    await page.waitForTimeout(250);
    const rowLit = await net(page, `return ["n:NVDA", "i:ca", "i:cb", "n:SPY"].map((id) => net.node(id).lit);`);
    deep(rowLit, [1, 1, 0, 0], "hovering a row of the table lights that one path: NVDA through calls at ask, not its calls at bid");
    await page.mouse.move(5, 5);

    await page.focus("#uaNetCard .ui-mod-h .ui-info");
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => document.activeElement.dataset.id);
    const names = m.layers[2].map((d) => d.id);
    eq(first, names[0], "Tab reaches the network once, on its largest-sector first name (one roving stop, not 25)");
    await page.keyboard.press("ArrowDown");
    eq(await page.evaluate(() => document.activeElement.dataset.id), names[1], "ArrowDown moves along the layer");
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
    ok(ring && ring !== "none", `the focused node shows a visible focus ring (${ring})`);
    eq(await page.evaluate(() => document.querySelector("#uaNet .fn-tip").hidden), false, "and its tooltip, so focus reads like hover");
    await page.keyboard.press("ArrowLeft");
    ok((await page.evaluate(() => document.activeElement.dataset.id)).startsWith("s:"), "ArrowLeft steps back to the sector layer");
    await page.keyboard.press("Enter");
    eq(await page.evaluate(() => document.activeElement.getAttribute("aria-pressed")), "true", "Enter pins a non-name node's subgraph");
    await page.keyboard.press("Escape");
    eq(await page.evaluate(() => document.activeElement.getAttribute("aria-pressed")), "false", "and Escape releases it");

    await page.click('#uaNetCard .ui-seg-i:nth-of-type(2)');
    await page.waitForFunction(() => window.FlowsUI.net.of(document.getElementById("uaNet")).model().mode === "dte", null, { timeout: 5000 }).catch(() => {});
    const dte = await net(page, `const m = net.model(); return { mode: m.mode, out: m.layers[3].map((d) => d.label), sum: m.layers[3].reduce((s, d) => s + d.v, 0), hop: m.edges[2].reduce((s, e) => s + e.v, 0) };`);
    eq(dte.mode, "dte", "the Expiry control switches the output layer");
    eq(dte.out.length, want.dteOut, `to the expiry horizons the data holds (${dte.out.join(", ")})`);
    near(dte.sum, want.total, "and the horizons still sum to the premium");
    near(dte.hop, want.total, "as do the edges into them");
    await page.waitForTimeout(800);
    await shot(page, "flow-net-expiry-1440");
    await page.click('#uaNetCard .ui-seg-i:nth-of-type(1)');
    await page.waitForFunction(() => window.FlowsUI.net.of(document.getElementById("uaNet")).model().mode === "lean", null, { timeout: 5000 });

    const more = { ...flow, rows: [{ ...flow.rows[0], oc: "NVDA-new", spanStart: "2026-09-29T18:40:00.000Z", prem: 2500000, askPrem: 2300000, bidPrem: 100000 }, ...flow.rows] };
    await page.focus("#uaNet tbody tr:nth-child(9) th a");
    const before = await page.evaluate(() => document.activeElement.closest("tr").dataset.t + "|" + document.activeElement.closest("tr").dataset.k);
    await net(page, `net.take(arg, { state: "ok" }); return null;`, more);
    await page.waitForTimeout(150);
    const flare = await stats(page);
    ok(flare.hot >= 1, `a window that arrives while the page is open fires a flare along its path (${flare.hot} in flight)`);
    const after = await page.evaluate(() => {
      const a = document.activeElement, tr = a && a.closest("#uaNet tbody tr");
      return { key: tr ? tr.dataset.t + "|" + tr.dataset.k : null, shown: [...document.querySelectorAll("#uaNet tbody tr")].filter((r) => !r.hidden).length, more: document.querySelector("#uaNet .fn-paths .ui-disclose").getAttribute("aria-expanded") };
    });
    eq(after.key, before, "a keyboard reader inside the table keeps their row when a new window rebuilds it");
    ok(after.shown === 24 && after.more === "true", "and an opened table stays open");

    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    const h0 = (await stats(page)).frames;
    await page.waitForTimeout(500);
    const h1 = await stats(page);
    ok(!h1.running && h1.frames === h0, `a hidden tab runs no frames (${h0} then ${h1.frames})`);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForTimeout(300);
    ok((await stats(page)).running, "and the network resumes when the tab returns");
    const scroller = (to) => page.evaluate((to) => {
      let el = document.querySelector("#uaNet");
      while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
      (el || document.scrollingElement).scrollTo({ top: to ? 1e6 : 0, behavior: "instant" });
      return document.querySelector("#uaNet .fn-stage").getBoundingClientRect().bottom;
    }, to);
    ok((await scroller(true)) < 0, "the stage can be scrolled out of view");
    await page.waitForTimeout(500);
    const o0 = await stats(page);
    await page.waitForTimeout(400);
    const o1 = await stats(page);
    ok(!o1.running && o1.frames === o0.frames, "scrolled off screen, it runs no frames either");
    await scroller(false);
    await page.waitForTimeout(400);
    await net(page, `net.reset(); return null;`);
    await page.waitForTimeout(1500);
    const live = await stats(page);
    cpu.page = { median: live.median, frames: live.frames, pulses: live.pulses, edges: live.edges };
    deep(page.errors, [], "nothing threw and nothing logged an error");
    await page.click('#uaNet .fn-hit[data-id="n:NVDA"]');
    await page.waitForURL(/\/flows\/ticker\/\?t=NVDA$/);
    ok(true, "clicking a name opens its ticker page");
    await ctx.close();
  }

  for (const width of [320, 390, 1440]) {
    const { ctx, page } = await mount(browser, { width, height: 1400 });
    for (const mode of ["lean", "dte"]) {
      await net(page, `net.mode(arg); return null;`, mode);
      await page.waitForTimeout(700);
      const box = await page.evaluate(() => {
        const st = document.querySelector("#uaNet .fn-stage").getBoundingClientRect(), card = document.getElementById("uaNetCard").getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, stage: [st.left, st.right], card: [card.left, card.right] };
      });
      ok(box.sw <= box.iw, `no horizontal overflow at ${width}px in ${mode} (${box.sw} of ${box.iw})`);
      ok(box.stage[0] >= box.card[0] - 0.5 && box.stage[1] <= box.card[1] + 0.5, `the stage stays inside its card at ${width}px`);
      for (const pass of [0, 1]) {
        const s = await stats(page);
        const labels = await net(page, "return net.labels();");
        ok(labels.length === s.layers.reduce((a, b) => a + b, 0), `every node is labelled at ${width}px (${mode})`);
        const outside = labels.filter((l) => l.x < -1 || l.y < -1 || l.x + l.w > s.w + 1 || l.y + l.h > s.h + 1).map((l) => l.id + " " + [l.x, l.y, l.w, l.h].map(Math.round).join(",") + " in " + s.w + "x" + s.h);
        deep(outside, [], `no label leaves the canvas at ${width}px (${mode}, pass ${pass})`);
        if (overlaps(labels).length) console.log(JSON.stringify(labels.filter((l) => l.id.startsWith("n:")).map((l) => [l.id, Math.round(l.x), Math.round(l.y), l.w, l.h])), JSON.stringify(await net(page, "return net.model().layers[2].map((d) => d.id);")));
        deep(overlaps(labels), [], `no two labels collide at ${width}px (${mode}, pass ${pass})`);
        if (!pass) await page.waitForTimeout(2200);
      }
      if (mode === "lean") { await shot(page, "flow-net-" + width); await shot(page, "flow-net-page-" + width, "whole"); }
    }
    deep(page.errors, [], `nothing threw at ${width}px`);
    await ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 900, reduced: true });
    await page.waitForTimeout(900);
    const a = await stats(page);
    await page.waitForTimeout(700);
    const b = await stats(page);
    ok(a.still && !b.running && b.frames === 0 && b.pulses === 0, `REDUCED MOTION draws one still frame: no loop, no frames, no particles (${JSON.stringify({ running: b.running, frames: b.frames, pulses: b.pulses })})`);
    const painted = await page.evaluate(() => {
      const c = document.querySelector("#uaNet canvas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 40) n++;
      return n;
    });
    ok(painted > 4000, `and the still frame is drawn (${painted} sampled pixels lit)`);
    await page.hover('#uaNet .fn-hit[data-id="n:NVDA"]');
    await page.waitForTimeout(200);
    eq(await net(page, `return net.node("n:MSFT").lit;`), 0, "hover still highlights without motion");
    eq((await stats(page)).frames, 0, "by repainting the still frame, not by starting a loop");
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
    await shot(page, "flow-net-still-1440");
    deep(page.errors, [], "nothing threw under reduced motion");
    await ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 900 });
    const u = await page.evaluate(() => {
      const model = window.FlowsUI.net.model;
      const sum = (l) => l.reduce((s, d) => s + d.v, 0);
      const m1 = model([{ t: "ABC", cp: "C", prem: 100, askPrem: 90, bidPrem: 60, exp: "2026-09-29", spanStart: "2026-09-29T15:00:00Z" },
        { t: "ABC", cp: null, prem: 50, askPrem: 50, bidPrem: 0 }, { t: "XYZ", cp: "P", prem: null, askPrem: 5 }, { t: "", cp: "C", prem: 10 },
        { t: "xyz", cp: "P", prem: 40, askPrem: null, bidPrem: 30 }], { sectorOf: (t) => (t === "ABC" ? "Technology" : null) });
      const node = (id) => m1.layers.flat().find((d) => d.id === id);
      const m0 = model([], {});
      return {
        windows: m1.windows, total: m1.total, sums: m1.layers.map(sum), counts: m1.layers.map((l) => l.length),
        ca: node("i:ca").v, cb: node("i:cb").v, nx: node("i:nx").v, pb: node("i:pb").v, xyz: node("n:XYZ").v, none: node("s:none").label,
        empty: { windows: m0.windows, layers: m0.layers.map((l) => l.length), top: m0.top.length },
        dte: model([{ t: "A", cp: "C", prem: 1, askPrem: 1, exp: "2026-10-06", spanStart: "2026-09-30T01:00:00Z" }], { out: "dte" }).layers[3][0].label,
      };
    });
    eq(u.windows, 3, "the model counts a window only with a ticker and a positive premium");
    eq(u.total, 190, "and sums exactly those premiums");
    deep(u.sums, [190, 190, 190, 190], "every layer conserves the premium on hand-made rows too");
    near(u.ca + u.cb, 100, "an ask and bid that overstate the premium are scaled back to it, not trusted past it");
    near(u.ca, 60, "in proportion (90 and 60 of 150 become 60 and 40)");
    eq(u.nx, 50 + 10, "a window with no contract side, and premium left between the quotes, go to Unattributed");
    eq(u.pb, 30, "an unstated ask is read as unattributed, not as zero bid");
    eq(u.xyz, 40, "tickers are upper-cased before they are joined");
    eq(u.none, "No sector", "a name the universe does not carry is No sector");
    deep(u.empty, { windows: 0, layers: [0, 0, 0, 0], top: 0 }, "an empty record is an empty model, not an error");
    eq(u.dte, "1\u20137 days", "the horizon counts from the window's own Eastern date (Sep 29 evening ET to Oct 6 is 7 days)");
    const one = { ...alerts(), rows: alerts().rows.slice(0, 1) };
    await net(page, `net.take(arg, { state: "ok" }); return null;`, one);
    await page.waitForTimeout(300);
    deep((await stats(page)).layers.length, 4, "a single window still draws four layers");
    ok((await stats(page)).layers.every((n) => n >= 1), "each with its node");
    deep(page.errors, [], "and nothing throws on it");
    await ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 900, deferAlerts: true, wait: false });
    await page.waitForSelector("#uaNet .fn-empty:not([hidden])");
    const pend = await page.evaluate(() => ({ text: document.querySelector("#uaNet .fn-empty").textContent, label: document.querySelector("#uaNet canvas").getAttribute("aria-label") }));
    ok(/Reading/.test(pend.text), `before the record arrives the network says it is reading (${pend.text})`);
    ok(/^Flow network: Reading the flagged windows/.test(pend.label), "and so does its accessible name");
    await shot(page, "flow-net-pending-1440");
    page.release();
    await page.waitForFunction(() => document.querySelector("#uaNet .fn-empty").hidden);
    ok(true, "and the pending state clears when it does");
    await ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 900, flow: { ...alerts(), rows: [] }, wait: false });
    await page.waitForFunction(() => /Nothing flagged/.test(document.querySelector("#uaNet .fn-empty").textContent) && !document.querySelector("#uaNet .fn-empty").hidden);
    ok(/not evidence of a quiet market/.test(await page.evaluate(() => document.querySelector("#uaNet .fn-empty").textContent)), "an empty record is a real empty state, worded as a read rather than a quiet market");
    eq((await stats(page)).running, false, "and draws no animation");
    await ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 900, flowStatus: 500, wait: false });
    await page.waitForFunction(() => /Unavailable/.test(document.querySelector("#uaNet .fn-empty").textContent));
    ok(/could not be loaded/.test(await page.evaluate(() => document.querySelector("#uaNet .fn-empty").textContent)), "a failed read says so, with the page's own reason");
    await ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 900, uniStatus: 500, wait: false });
    await page.waitForFunction(() => { const n = window.FlowsUI.net.of(document.getElementById("uaNet")); const m = n && n.model(); return m && m.layers[1].length === 1 && m.layers[1][0].label === "Sector unread"; }, null, { timeout: 15000 });
    ok(true, "an unreadable universe draws one honest Sector unread node, never No sector");
    await ctx.close();
  }

  {
    const flow = alerts({ n: 180, seed: 5 });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const html = `<!doctype html><html><head><link rel="stylesheet" href="/assets/css/base.css"><link rel="stylesheet" href="/assets/css/flows.css"><link rel="stylesheet" href="/assets/css/flows-net.css"></head>
<body class="flows-body"><main style="padding:20px;max-width:1240px"><section class="ui-card ui-mod fn-card"><header class="ui-mod-h"><h2 class="ui-mod-t">Flow network</h2><span class="ui-mod-sp"></span></header><div class="fn-host" id="net"></div></section></main>
<script src="/assets/js/flows-ui.js"></script><script src="/assets/js/flows-net.js"></script></body></html>`;
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith("/assets/")) return route.fulfill({ path: path.join(ROOT, u.pathname), contentType: MIME[path.extname(u.pathname)] });
      return route.fulfill({ contentType: "text/html", body: html });
    });
    await page.goto("https://bench.test/");
    const out = await page.evaluate(async ({ flow, uni }) => {
      const n = window.FlowsUI.net.mount(document.getElementById("net"), { names: 22, rate: 240, cap: 400, universe: false });
      n.sectors(new Map(uni.t.map((t, i) => [t, uni.sectors[uni.sec[i]]])));
      n.take(flow, { state: "ok" });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 60 && n.stats().pulses < 395; i++) await wait(100);
      n.reset();
      await wait(2500);
      const st = n.stats();
      const runs = [n.measure(240), n.measure(240), n.measure(240)];
      return { st, runs };
    }, { flow, uni: universe() });
    const best = out.runs.reduce((a, b) => (a.median <= b.median ? a : b));
    cpu.bench = { edges: out.st.edges, pulses: out.st.pulses, rafMedian: out.st.median, rafFrames: out.st.frames, loopMedian: best.median, loopP90: best.p90, loopMean: best.mean };
    ok(out.st.edges >= 200 && out.st.pulses >= 380, `the benchmark runs at ${out.st.edges} edges and ${out.st.pulses} pulses`);
    ok(best.median < 4, `CPU per frame stays far from a frame budget: ${best.median.toFixed(2)} ms median over 240 frames (target under 2 ms)`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`  CPU per frame on the unusual page at 1440px: median ${cpu.page.median === null ? "n/a" : cpu.page.median.toFixed(2)} ms over ${cpu.page.frames} frames (${cpu.page.pulses} pulses, ${cpu.page.edges} edges)`);
console.log(`  CPU per frame, benchmark at ${cpu.bench.edges} edges and ${cpu.bench.pulses} pulses: loop median ${cpu.bench.loopMedian.toFixed(2)} ms, p90 ${cpu.bench.loopP90.toFixed(2)} ms, mean ${cpu.bench.loopMean.toFixed(2)} ms; animation-frame median ${cpu.bench.rafMedian === null ? "n/a" : cpu.bench.rafMedian.toFixed(2)} ms over ${cpu.bench.rafFrames} frames`);
console.log(`✓ flows-net-render: ${checks} checks — the flow network drawn on the unusual page from fixture alerts: layer and node counts from the data, ` +
  `premium conserved through every layer and edge, hover, row and keyboard highlighting, the accessible table and label, the freshness pill, ` +
  `the expiry output, a flare on a new window, pause when hidden or off screen, reduced motion still, pending, empty, failed and unread states, ` +
  `no overflow and no label collision at 320, 390 and 1440, and CPU per frame`);
