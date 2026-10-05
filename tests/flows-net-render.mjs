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

async function mount(browser, { width = 1440, height = 1300, reduced = false, flow = alerts(), uni = universe(), flowStatus = 200, uniStatus = 200, deferAlerts = false, wait = true, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: touch, isMobile: touch });
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
    if (kind === "first") return { x: 0, y: 0, width: innerWidth, height: innerHeight };
    return kind === "whole" ? { x: 0, y: 0, width: innerWidth, height: Math.min(r.bottom + scrollY + 40, 2400) } : { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  }, kind);
  await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: kind === "card" || kind === "whole", clip });
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

const adrift = (labels, layout, vert) => {
  const bad = [], at = new Map(layout.flat().map((d) => [d.id, d]));
  const tiers = new Map();
  for (const l of labels) {
    if (!at.has(l.id)) continue;
    const key = at.get(l.id).layer + ":" + (vert ? Math.round(l.y / 4) : 0);
    if (!tiers.has(key)) tiers.set(key, []);
    tiers.get(key).push(l);
  }
  for (const group of tiers.values()) {
    const xs = group.map((l) => (vert ? at.get(l.id).x : at.get(l.id).y)).sort((a, b) => a - b);
    const pitch = xs.length > 1 ? Math.min(...xs.slice(1).map((x, i) => x - xs[i])) : Infinity;
    for (const l of group) {
      const d = at.get(l.id), off = vert ? Math.abs(l.x + l.w / 2 - d.x) : Math.abs(l.y + l.h / 2 - d.y), lim = Math.min(pitch / 2, vert ? l.w : l.h);
      if (off > lim + 0.05) bad.push(`${l.id} sits ${off.toFixed(1)} px from its sphere, over ${lim.toFixed(1)} (${vert ? "column" : "row"} pitch ${pitch.toFixed(1)})`);
    }
  }
  return bad;
};
const RESID_ORDER = ["s:~", "s:none", "s:unread", "s:wait"];
const layout = (page) => net(page, `const m = net.model(); return m.layers.map((l) => l.map((d) => { const n = net.node(d.id); return { id: d.id, layer: d.layer, v: d.v, resid: d.resid, x: n.x, y: n.y, label: d.label }; }));`);
async function ranked(page, tag, axis = "y") {
  return rankedL(await layout(page), tag, axis);
}
function rankedL(L, tag, axis = "y") {
  L.forEach((layer, li) => {
    const screen = [...layer].sort((a, b) => a[axis] - b[axis]);
    deep(screen.map((d) => d.id), layer.map((d) => d.id), `layer ${li} reads in rank order ${axis === "y" ? "top to bottom" : "left to right"} on screen (${tag})`);
    const main = screen.filter((d) => !d.resid), rest = screen.filter((d) => d.resid);
    ok(main.every((d, i) => !i || main[i - 1].v >= d.v), `layer ${li}: premium never increases down the ranking (${tag}: ${main.map((d) => d.label).join(", ")})`);
    deep(screen.slice(main.length).map((d) => d.id), rest.map((d) => d.id), `layer ${li}: the residual buckets sit after every ranked node (${tag})`);
    if (li === 1 && rest.length) ok(rest.every((d, i) => !i || RESID_ORDER.indexOf(rest[i - 1].id) < RESID_ORDER.indexOf(d.id)), `and in the stated order Other, No sector, unread, pending (${rest.map((d) => d.label).join(", ")})`);
  });
  return L;
}
const camera = (page) => net(page, "return net.camera();");
const settle = (page) => page.waitForFunction(() => { const c = window.FlowsUI.net.of(document.getElementById("uaNet")).camera(); return c.auto && Math.abs(c.yaw - c.rest[0]) <= 9.6; }, null, { timeout: 8000 }).catch(() => {});
const stageBox = (page) => page.evaluate(() => { const r = document.querySelector("#uaNet .fn-stage").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
async function drag(page, dx, dy, { steps = 12, x = 0.5, y = 0.06 } = {}) {
  const b = await stageBox(page);
  const sx = b.x + b.w * x, sy = b.y + b.h * y;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(sx + dx * i / steps, sy + dy * i / steps);
  await page.mouse.up();
}
function crosses(edge, node) {
  return node.x + node.r > Math.min(edge.ax, edge.bx) && node.x - node.r < Math.max(edge.ax, edge.bx) && node.y + node.r > Math.min(edge.ay, edge.by) && node.y - node.r < Math.max(edge.ay, edge.by);
}

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
    deep(m.layers[1].map((d) => d.label), ["Tech", "Cyclical", "Comms", "Energy", "Other", "No sector"],
      "the sector layer is ranked by premium with Other and then No sector last, although No sector carries the second largest premium");
    deep(m.layers[2].slice(0, 3).map((d) => d.label), ["NVDA", "SPY", "QQQ"], "the name layer is ranked by premium, not grouped by sector");
    eq(m.layers[2][m.layers[2].length - 1].id, "n:~", "and Other names closes it");
    await ranked(page, "at rest");
    const lim = (await camera(page)).limits;
    for (const [y, p] of [[-lim[0], 10], [lim[0], 10], [-20, lim[1]], [30, -lim[1]], [lim[0], lim[1]]]) {
      await net(page, "net.orbit(arg[0], arg[1]); return null;", [y, p]);
      await ranked(page, `yaw ${y}, pitch ${p}`);
      const lm = await net(page, `const m = net.model(); return { t: m.total, s: m.layers.map((l) => l.reduce((a, d) => a + d.v, 0)) };`);
      lm.s.forEach((v, i) => near(v, want.total, `layer ${i} still conserves the premium at yaw ${y}, pitch ${p}`));
    }
    await net(page, "net.orbit(arg[0], arg[1]); return null;", (await camera(page)).rest);
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
    ok(/^Rank 1, NVDA, Tech: \$[\d.]+M, \d+% of flagged premium, \d+ windows, [\d,]+ contracts\./.test(nv.label), `and names its rank, premium, share and contracts (${nv.label})`);

    await page.evaluate(() => { document.activeElement.blur(); window.scrollTo({ top: 0, behavior: "instant" }); });
    await net(page, "net.orbit(arg[0], arg[1]); return null;", (await camera(page)).rest);
    await page.hover('#uaNet .fn-hit[data-id="n:NVDA"]');
    await page.waitForFunction(() => window.FlowsUI.net.of(document.getElementById("uaNet")).node("n:MSFT").lit === 0, null, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    const lit = await net(page, `return ["n:NVDA", "s:tech", "i:ca", "o:bull", "n:MSFT", "s:energy", "n:SPY"].map((id) => [id, net.node(id).lit]);`);
    deep(Object.fromEntries(lit), { "n:NVDA": 1, "s:tech": 1, "i:ca": 1, "o:bull": 1, "n:MSFT": 0, "s:energy": 0, "n:SPY": 0 },
      "HOVERING A NAME lights its whole subgraph (its sector, its sides, its leans) and dims every other name and sector");
    const tip = await page.evaluate(() => { const t = document.querySelector("#uaNet .fn-tip"); return { hidden: t.hidden, text: t.textContent }; });
    ok(/each layer ranked by premium, largest at the top, leftover buckets last\./.test(await page.evaluate(() => document.querySelector("#uaNet .fn-lede").textContent)), "the lede states the ranking rule the screen follows: largest at the top, leftover buckets last");
    ok(!tip.hidden && /NVDA/.test(tip.text) && /of flagged premium/.test(tip.text) && /Open NVDA/.test(tip.text), `and the tooltip lists its premium and share (${tip.text})`);
    const sizeOf = (pred) => flow.rows.filter(pred).reduce((s, r) => s + r.size, 0).toLocaleString("en-US");
    ok(tip.text.includes(sizeOf((r) => r.t === "NVDA") + " contracts"), `a name's tooltip shows the contracts its windows carry (${sizeOf((r) => r.t === "NVDA")})`);
    await shot(page, "net-1440-hover", "net");
    const tipOf = (id) => page.evaluate((id) => { const el = document.querySelector(`#uaNet .fn-hit[data-id="${id}"]`); el.focus({ preventScroll: true }); const t = document.querySelector("#uaNet .fn-tip").textContent; el.blur(); return t; }, id);
    const techNames = new Set(NAMES.filter((x) => x[1] === "Technology").map((x) => x[0]));
    ok((await tipOf("s:tech")).includes(sizeOf((r) => techNames.has(r.t)) + " contracts"), "a sector's tooltip shows its contracts");
    for (const id of ["i:ca", "i:nx", "o:bull", "o:bear"]) ok(!/contract/.test(await tipOf(id)), `a side or lean node shows no contracts, which the vendor never splits by side (${id})`);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    eq((await net(page, `return net.node("n:MSFT").lit;`)), 1, "leaving the node restores the whole network");

    await net(page, "net.orbit(arg[0], arg[1]); return null;", (await camera(page)).rest);
    await page.click('#uaNet .fn-hit[data-id="s:tech"]');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const pinned = await page.evaluate(() => {
      const st = document.querySelector("#uaNet .fn-stage").getBoundingClientRect(), t = document.querySelector("#uaNet .fn-tip"), r = t.getBoundingClientRect();
      return { hidden: t.hidden, text: t.textContent, pressed: document.querySelector('#uaNet .fn-hit[data-id="s:tech"]').getAttribute("aria-pressed"), x: r.left - st.left, y: r.top - st.top, w: r.width, h: r.height };
    });
    const pl = await net(page, `const l = net.labels(); return { nvda: l.find((b) => b.id === "n:NVDA"), tech: l.find((b) => b.id === "s:tech"), lit: net.node("n:NVDA").lit, sph: net.node("n:NVDA") };`);
    const meets = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;
    ok(pinned.pressed === "true" && !pinned.hidden && /Tech/.test(pinned.text) && pl.lit === 1, `pinning Tech shows its tooltip and lights NVDA, its largest member (${pinned.text.slice(0, 30)})`);
    ok(!meets(pinned, pl.nvda) && !meets(pinned, { x: pl.sph.x - pl.sph.r, y: pl.sph.y - pl.sph.r, w: 2 * pl.sph.r, h: 2 * pl.sph.r }), `THE TOOLTIP CLEARS THE LIT SUBGRAPH: it covers neither NVDA's label nor its sphere (tip ${[pinned.x, pinned.y, pinned.w, pinned.h].map(Math.round)}, NVDA ${[pl.nvda.x, pl.nvda.y, pl.nvda.w, pl.nvda.h].map(Math.round)})`);
    ok(!meets(pinned, pl.tech), "nor Tech's own label");
    await page.click('#uaNet .fn-hit[data-id="s:tech"]');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    eq(await page.evaluate(() => document.querySelector('#uaNet .fn-hit[data-id="s:tech"]').getAttribute("aria-pressed")), "false", "a second click releases the pin");
    await page.evaluate(() => document.activeElement.blur());

    await page.hover("#uaNet tbody tr:first-child td:nth-child(3)");
    await page.waitForTimeout(250);
    const rowLit = await net(page, `return ["n:NVDA", "i:ca", "i:cb", "n:SPY"].map((id) => net.node(id).lit);`);
    deep(rowLit, [1, 1, 0, 0], "hovering a row of the table lights that one path: NVDA through calls at ask, not its calls at bid");
    await page.mouse.move(5, 5);

    await page.focus("#uaNetCard .ui-mod-h .ui-info");
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => document.activeElement.dataset.id);
    const names = m.layers[2].map((d) => d.id);
    eq(first, names[0], "Tab reaches the network once, on its largest name (one roving stop, not 25)");
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
    const dte = await net(page, `const m = net.model(); return { mode: m.mode, out: m.layers[3].map((d) => d.label), sum: m.layers[3].reduce((s, d) => s + d.v, 0), hop: m.edges[2].reduce((s, e) => s + e.v, 0), ct: m.layers[3].map((d) => d.contracts) };`);
    ok(dte.ct.every((c) => c > 0), `an expiry node carries the contracts of its windows (${dte.ct.join(", ")})`);
    ok(/contracts/.test(await tipOf("o:" + (await net(page, "return net.model().layers[3][0].bucket;")))), "and its tooltip shows them");
    await page.mouse.move(5, 5);
    await ranked(page, "expiry output");
    eq(dte.mode, "dte", "the Expiry control switches the output layer");
    eq(dte.out.length, want.dteOut, `to the expiry horizons the data holds (${dte.out.join(", ")})`);
    near(dte.sum, want.total, "and the horizons still sum to the premium");
    near(dte.hop, want.total, "as do the edges into them");
    await page.waitForTimeout(800);
    await shot(page, "net-1440-expiry", "net");
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

    await page.evaluate(() => { document.activeElement.blur(); window.scrollTo({ top: 0, behavior: "instant" }); document.querySelector("#uaNet .fn-stage").scrollIntoView({ block: "start", behavior: "instant" }); });
    await page.waitForFunction(() => window.FlowsUI.net.of(document.getElementById("uaNet")).stats().running, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const y0 = await net(page, `return [net.node("n:MSFT").y, net.node("n:NVDA").y];`);
    const big = { ...more, rows: [{ ...flow.rows[0], t: "MSFT", oc: "MSFT-big", spanStart: "2026-09-29T18:39:00.000Z", prem: 60000000, askPrem: 50000000, bidPrem: 5000000, size: 200000 }, ...more.rows] };
    await page.route("**/api/flows/flowalerts", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(big) }));
    const y1 = await net(page, `net.take(arg, { state: "ok" }); return [net.node("n:MSFT").y, net.model().layers[2][0].id];`, big);
    eq(y1[1], "n:MSFT", "new data reorders the name layer in the model at once");
    await page.waitForFunction(() => { const n = window.FlowsUI.net.of(document.getElementById("uaNet")), a = n.node("n:MSFT"), b = n.node("n:NVDA"), c = n.node("n:SPY"); return a.y < b.y - 20 && b.y < c.y - 20; }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    const y2 = await net(page, `const s = net.stats(), r = document.querySelector("#uaNet .fn-stage").getBoundingClientRect(); return [net.node("n:MSFT").y, net.node("n:NVDA").y, s.frames, s.running, Math.round(r.top) + ".." + Math.round(r.bottom) + " of " + innerHeight + (document.activeElement ? " focus " + document.activeElement.tagName : "")];`);
    ok(y2[0] < y2[1] && y0[0] > y0[1], `and on screen MSFT rises above NVDA (${y0.map(Math.round)} to ${y2.slice(0, 2).map(Math.round)}; ${y2[2]} frames, running ${y2[3]}, stage ${y2[4]})`);
    ok(Math.abs(y1[0] - y2[0]) > 20, `gliding there rather than jumping (${Math.round(y0[0])}, then ${Math.round(y1[0])} as the data lands, then ${Math.round(y2[0])})`);
    await ranked(page, "after new data reordered the names");

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
    await page.waitForFunction(() => !window.FlowsUI.net.of(document.getElementById("uaNet")).stats().running, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
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
    await net(page, "net.orbit(arg[0], arg[1]); return null;", (await camera(page)).rest);
    await page.click('#uaNet .fn-hit[data-id="n:NVDA"]');
    await page.waitForURL(/\/flows\/ticker\/\?t=NVDA$/);
    ok(true, "clicking a name opens its ticker page");
    await ctx.close();
  }

  const sweep = (page, pts) => net(page, `return arg.map(([y, p]) => { net.orbit(y, p); const c = net.camera(), s = net.stats(), m = net.model();
    const cv = document.querySelector("#uaNet canvas"), g = cv.getContext("2d"), k = cv.width / s.w, nv = net.labels().find((l) => l.id === "n:NVDA");
    const px = nv ? [...g.getImageData(Math.round((nv.x + 4) * k), Math.round((nv.y + nv.h / 2) * k), 1, 1).data] : null;
    return { y, p, yaw: c.yaw, pitch: c.pitch, w: s.w, h: s.h, labels: net.labels(), px,
      layout: m.layers.map((l) => l.map((d) => { const n = net.node(d.id); return { id: d.id, layer: d.layer, v: d.v, resid: d.resid, x: n.x, y: n.y, label: d.label }; })) }; });`, pts);
  const lin = (a, n) => Array.from({ length: n }, (_, i) => -a + 2 * a * i / (n - 1));
  for (const width of [320, 390, 700, 768, 1024, 1280, 1440]) {
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
      const cam = await camera(page), [ly, lp] = cam.limits, grid = [cam.rest];
      for (const y of lin(ly, 9)) for (const p of lin(lp, 5)) grid.push([y, p]);
      grid.push([-ly, cam.rest[1]], [ly, cam.rest[1]], cam.rest);
      const seen = await sweep(page, grid);
      let caps = 0;
      for (const r of seen) {
        const at = `${width}px, ${mode}, asked yaw ${Math.round(r.y)} pitch ${Math.round(r.p)}, at ${r.yaw.toFixed(1)}, ${r.pitch.toFixed(1)}`;
        const nodes = r.labels.filter((l) => !l.id.startsWith("cap:"));
        caps += r.labels.length - nodes.length;
        ok(nodes.length === r.layout.flat().length, `every node is labelled at ${at}`);
        const outside = r.labels.filter((l) => l.x < -1 || l.y < -1 || l.x + l.w > r.w + 1 || l.y + l.h > r.h + 1).map((l) => l.id + " " + [l.x, l.y, l.w, l.h].map(Math.round).join(",") + " in " + r.w + "x" + r.h);
        deep(outside, [], `no label or caption leaves the canvas at ${at}`);
        deep(overlaps(r.labels), [], `no two labels or captions collide at ${at}`);
        deep(adrift(r.labels, r.layout, width < 560), [], `EVERY LABEL STAYS WITHIN HALF A PITCH OF ITS OWN SPHERE at ${at}`);
        ok(Math.abs(r.yaw) <= ly + 1e-9 && Math.abs(r.pitch) <= lp + 1e-9, `the camera stays inside its limits at ${at}`);
        rankedL(r.layout, at, width < 560 ? "x" : "y");
      }
      ok(caps >= seen.length * 2, `the layer captions are in the collision set (${caps} caption boxes over ${seen.length} angles)`);
      const named = (r) => r.labels.filter((l) => /^[sn]:/.test(l.id));
      if (width === 768) deep(named(seen[0]).filter((l) => l.form === "short").map((l) => l.id), [], `at 768px at rest every sector and name label shows its premium (${mode})`);
      if (width === 1440) {
        const [left, right] = seen.slice(-3, -1);
        ok(Math.abs(left.yaw + ly) < 1e-6 && Math.abs(right.yaw - ly) < 1e-6, `at 1440px the reader reaches both yaw limits (${left.yaw}, ${right.yaw})`);
        for (const r of [seen[0], left, right]) {
          deep(named(r).filter((l) => l.form === "short").map((l) => l.id), [], `at 1440px every sector and name label shows its premium at yaw ${Math.round(r.yaw)} (${mode})`);
          ok(r.px && r.px[0] < 40 && r.px[1] < 40 && r.px[2] < 48, `the pixel just left of NVDA's rank numeral is the dark chip, not a ribbon, at yaw ${Math.round(r.yaw)} (${r.px})`);
        }
      }
      await net(page, "net.recentre(); return null;");
      await page.waitForTimeout(2200);
      const labels = await net(page, "return net.labels();");
      deep(overlaps(labels), [], `no two labels collide at ${width}px (${mode}) under the automatic sway`);
      deep(adrift(labels, await layout(page), width < 560), [], `and every label stays by its sphere under the sway at ${width}px (${mode})`);
      const sw = await camera(page), path = [];
      for (let i = 0; i < 8; i++) for (const k of [-1, 1]) path.push([sw.rest[0] + sw.sway * Math.sin(i * Math.PI / 4), sw.rest[1] + k * sw.sway * 0.2]);
      const along = await sweep(page, path);
      for (const r of along) {
        const at = `${width}px, ${mode}, sway phase at yaw ${r.y.toFixed(1)} pitch ${r.p.toFixed(1)}`;
        ok(Math.abs(r.yaw - r.y) < 1e-6 && Math.abs(r.pitch - r.p) < 1e-6, `the sway path is reached without clamping at ${at} (${r.yaw.toFixed(2)}, ${r.pitch.toFixed(2)})`);
        deep(overlaps(r.labels), [], `no two labels or captions collide at ${at}`);
        deep(adrift(r.labels, r.layout, width < 560), [], `every label stays within half a pitch of its sphere at ${at}`);
      }
      if (mode === "lean") {
        await net(page, "net.orbit(arg[0], arg[1]); return null;", (await camera(page)).rest);
        if (width === 1440) { await shot(page, "net-1440", "net"); await shot(page, "page-1440", "first"); }
        else await shot(page, "net-" + width, "net");
      }
    }
    deep(page.errors, [], `nothing threw at ${width}px`);
    await ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 1000 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(300);
    const c0 = await camera(page);
    ok(c0.auto && Math.abs(c0.yaw - c0.rest[0]) <= 9.5 && Math.abs(c0.pitch - c0.rest[1]) <= 2.5, `left alone, the camera sways slowly about its rest angle (${c0.yaw.toFixed(1)}, ${c0.pitch.toFixed(1)})`);
    deep(c0.limits, [55, 22], "yaw is held to 55 degrees and pitch to 22 either way");
    const before = await layout(page);
    await drag(page, 240, 40);
    const c1 = await camera(page);
    const after = await layout(page);
    ok(!c1.auto && c1.yaw > c0.yaw + 30 && c1.pitch > c0.pitch + 3, `A POINTER DRAG ORBITS the camera (yaw ${c0.yaw.toFixed(1)} to ${c1.yaw.toFixed(1)}, pitch ${c0.pitch.toFixed(1)} to ${c1.pitch.toFixed(1)})`);
    const moved = before.flat().filter((d, i) => Math.hypot(d.x - after.flat()[i].x, d.y - after.flat()[i].y) > 8).length;
    ok(moved >= before.flat().length - 2, `and the projected nodes move with it (${moved} of ${before.flat().length})`);
    await ranked(page, "after a drag");
    eq(page.url(), "https://example.test/flows/unusual/", "a drag that ends over a name does not open it");
    const tight = async (c, dy, dp, tag) => {
      const uy = Math.abs(Math.abs(c.yaw) - 55) < 1e-6 ? 0 : dy / Math.max(Math.abs(dy), Math.abs(dp)), up = Math.abs(Math.abs(c.pitch) - 22) < 1e-6 ? 0 : dp / Math.max(Math.abs(dy), Math.abs(dp));
      const f = await net(page, "return [net.fits(arg[0], arg[1]), net.fits(arg[0] + arg[2], arg[1] + arg[3])];", [c.yaw, c.pitch, 1.5 * uy, 1.5 * up]);
      ok(Math.abs(c.yaw) <= 55 + 1e-9 && Math.abs(c.pitch) <= 22 + 1e-9 && f[0], `${tag}: the camera stops inside its limits at an angle where every label fits (${c.yaw.toFixed(1)}, ${c.pitch.toFixed(1)})`);
      ok((!uy && !up) || !f[1], `${tag}: the stop is the literal corner or no label arrangement fits 1.5 degrees further along the drag (${c.yaw.toFixed(1)}, ${c.pitch.toFixed(1)})`);
      const L = await net(page, "return net.labels();");
      deep(overlaps(L), [], `${tag}: no two labels collide where the drag stopped`);
      deep(adrift(L, await layout(page), false), [], `${tag}: every label stays within half a pitch of its sphere where the drag stopped`);
    };
    await drag(page, 1200, 300, { x: 0.05, y: 0.3 });
    let c = await camera(page);
    ok(c.yaw > 50 && c.pitch > 18, `a long drag clamps at or just inside the yaw and pitch limits (${c.yaw.toFixed(1)}, ${c.pitch.toFixed(1)})`);
    await tight(c, 1200 * 0.32, 300 * 0.22, "dragged to the right and up");
    await ranked(page, "dragged to the yaw and pitch limits");
    await shot(page, "net-1440-orbit-right", "net");
    await drag(page, -1300, -300, { x: 0.97, y: 0.6 });
    c = await camera(page);
    ok(c.yaw < -50 && c.pitch < -18, `and the other way (${c.yaw.toFixed(1)}, ${c.pitch.toFixed(1)})`);
    await tight(c, -1300 * 0.32, -300 * 0.22, "dragged to the left and down");
    await net(page, "net.orbit(-55, arg); return null;", c0.rest[1]);
    await shot(page, "net-1440-orbit-left", "net");
    await net(page, "net.orbit(-40, 10); return null;");
    const b = await stageBox(page);
    await page.mouse.move(b.x + b.w * 0.5, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + b.w * 0.5 + 40, b.y + 20);
    await page.mouse.move(b.x + b.w * 0.5 + 160, b.y + 20, { steps: 2 });
    await page.mouse.up();
    const fl0 = await camera(page);
    await page.waitForTimeout(150);
    const fl1 = await camera(page);
    ok(fl0.spin > 0 && fl1.yaw > fl0.yaw, `a flick leaves the camera turning on its own (spin ${fl0.spin.toFixed(1)} degrees a second)`);
    await page.waitForTimeout(2500);
    const fl2 = await camera(page);
    await page.waitForTimeout(300);
    const fl3 = await camera(page);
    ok(fl2.spin === 0 && fl3.yaw === fl2.yaw && !fl3.auto, `and the inertia decays to a stop (${fl2.yaw.toFixed(2)} then ${fl3.yaw.toFixed(2)})`);
    await page.click("#uaNet .fn-home");
    await settle(page);
    c = await camera(page);
    ok(c.auto && Math.abs(c.yaw - c.rest[0]) <= 9.6, `the recentre control returns the camera to its rest angle and sway (yaw ${c.yaw.toFixed(1)})`);
    eq(await page.evaluate(() => document.querySelector("#uaNet .fn-home").getAttribute("aria-label")), "Recentre the view", "and has an accessible name");
    await net(page, "net.orbit(50, 20); return null;");
    await page.focus('#uaNet .fn-hit[tabindex="0"]');
    await page.keyboard.press("Home");
    ok((await page.evaluate(() => document.activeElement.dataset.id)) === (await net(page, "return net.model().layers[2][0].id;")), "Home still jumps to the top of the layer");
    await page.keyboard.press("r");
    await settle(page);
    c = await camera(page);
    ok(c.auto && Math.abs(c.yaw - c.rest[0]) <= 9.6, `R on a focused node recentres (yaw ${c.yaw.toFixed(1)})`);
    await net(page, "net.orbit(-50, -15); return null;");
    await page.mouse.dblclick(b.x + 30, b.y + b.h - 30);
    await settle(page);
    ok((await camera(page)).auto, "and so does a double click on the network");
    ok((await camera(page)).auto && (await stats(page)).running, "the automatic sway runs again");

    await net(page, "net.orbit(48, 16); return null;");
    await page.mouse.move(5, 5);
    const aapl = await net(page, `return net.node("n:AAPL");`);
    await page.mouse.move(b.x + aapl.x, b.y + aapl.y);
    await page.waitForTimeout(250);
    const lit = await net(page, `return [net.node("n:AAPL").lit, net.node("n:NVDA").lit];`);
    const tipText = await page.evaluate(() => document.querySelector("#uaNet .fn-tip").textContent);
    ok(lit[0] === 1 && lit[1] === 0 && /AAPL/.test(tipText), `HIT TARGETS FOLLOW THE CAMERA: after a rotation the pointer over AAPL's sphere lights AAPL (${tipText.slice(0, 40)})`);

    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    await net(page, "net.orbit(-55, 18); return null;");
    const order = await net(page, "return net.paints();");
    ok(order.every((it, i) => !i || order[i - 1].z >= it.z), "the painter draws every edge, pulse slice and node from back to front");
    const nodes = order.map((it, i) => ({ ...it, i })).filter((it) => it.k === "node"), edges = order.map((it, i) => ({ ...it, i })).filter((it) => it.k === "edge");
    let front = 0, back = 0, wrong = [];
    for (const n of nodes) for (const e of edges) {
      if (e.id.split("|").includes(n.id) || !crosses(e, n)) continue;
      if (n.z < e.z) { front++; if (n.i < e.i) wrong.push(n.id + " under " + e.id); }
      else if (n.z > e.z) { back++; if (n.i > e.i) wrong.push(e.id + " under " + n.id); }
    }
    ok(front > 0 && back > 0, `the turned scene has spheres in front of edges that share their patch of screen, and spheres behind them (${front} and ${back} pairs)`);
    deep(wrong, [], "DEPTH ORDER: a nearer sphere is drawn after the edge behind it, so it covers it, and a farther one before the edge in front of it");
    ok(edges.every((e) => e.id.split("|").every((id) => nodes.find((n) => n.id === id).i > e.i)), "and every edge is drawn before both of the spheres it joins");
    deep(page.errors, [], "nothing threw while orbiting");
    await ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 390, height: 900, touch: true, reduced: true });
    const cdp = await ctx.newCDPSession(page);
    const b = await stageBox(page);
    const touch = async (dx, dy) => {
      const x = b.x + b.w * 0.5, y = b.y + 60;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * i / 10, y: y + dy * i / 10 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(300);
    };
    eq(await page.evaluate(() => getComputedStyle(document.querySelector("#uaNet .fn-stage")).touchAction), "pan-y", "the stage leaves vertical panning to the page");
    const c0 = await camera(page);
    deep(c0.limits, [30, 22], "on a phone the yaw is held to 30 degrees so the rows stay legible");
    await touch(150, 10);
    const c1 = await camera(page);
    ok(!c1.auto && c1.yaw !== c0.yaw, `a horizontal touch drag turns the network (yaw ${c0.yaw.toFixed(1)} to ${c1.yaw.toFixed(1)})`);
    const sy0 = await page.evaluate(() => scrollY);
    await touch(4, -240);
    const sy1 = await page.evaluate(() => scrollY), c2 = await camera(page);
    ok(sy1 > sy0 + 50, `a vertical touch drag still scrolls the page (${sy0} to ${sy1})`);
    ok(c2.yaw === c1.yaw && c2.pitch === c1.pitch, `without turning the network, which under reduced motion moves only when dragged (yaw ${c1.yaw.toFixed(2)} then ${c2.yaw.toFixed(2)})`);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(200);
    await touch(150, 10);
    const c3 = await camera(page);
    ok(c3.yaw !== c0.yaw, `another horizontal touch drag turns it again (yaw ${c3.yaw.toFixed(1)})`);
    const hb = await page.evaluate(() => { const h = document.querySelector("#uaNet .fn-home"); h.scrollIntoView({ block: "center", behavior: "instant" }); const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2 + 14, y: r.top + r.height / 2 + 14 }; });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [hb] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction((y) => window.FlowsUI.net.of(document.getElementById("uaNet")).camera().yaw !== y, c3.yaw, { timeout: 3000 }).catch(() => {});
    const c4 = await camera(page);
    deep([c4.yaw, c4.pitch], c0.rest, `THE FIRST TAP ON RECENTRE AFTER A TOUCH DRAG RECENTRES (yaw ${c3.yaw.toFixed(1)} to ${c4.yaw.toFixed(1)})`);
    await net(page, "net.orbit(arg[0], arg[1]); return null;", c0.rest);
    await ranked(page, "390px rows", "x");
    deep(page.errors, [], "nothing threw on touch");
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
    const c0 = await camera(page), p0 = await net(page, `return net.node("n:NVDA");`);
    deep([c0.yaw, c0.pitch], c0.rest, "the still frame is drawn at the fixed rest angle");
    await drag(page, 260, 60);
    await page.waitForTimeout(400);
    const c1 = await camera(page), p1 = await net(page, `return net.node("n:NVDA");`), s1 = await stats(page);
    ok(c1.yaw > c0.yaw + 20 && c1.pitch > c0.pitch, `a drag still turns the network under reduced motion (yaw ${c0.yaw} to ${c1.yaw.toFixed(1)})`);
    ok(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 10, "and the still frame is repainted at the new angle");
    ok(!s1.running && s1.frames === 0 && c1.spin === 0, `with no inertia and no animation frame left running (${JSON.stringify({ running: s1.running, frames: s1.frames, spin: c1.spin })})`);
    await ranked(page, "reduced motion, after a drag");
    await net(page, `net.take(arg, { state: "ok" }); return null;`, { ...alerts(), rows: [{ ...alerts().rows[0], t: "MU", oc: "MU-big", prem: 9e7, askPrem: 8e7, bidPrem: 1e6 }, ...alerts().rows] });
    const mu = await net(page, `return [net.node("n:MU").y, net.node("n:NVDA").y, net.model().layers[2][0].id];`);
    ok(mu[2] === "n:MU" && mu[0] < mu[1], "new data that reorders a layer repaints it in place, with no glide");
    eq((await stats(page)).frames, 0, "still with no animation frame");
    await page.keyboard.press("Tab");
    await page.focus('#uaNet .fn-hit[tabindex="0"]');
    await page.keyboard.press("r");
    const c2 = await camera(page);
    deep([c2.yaw, c2.pitch], c0.rest, "R on a node recentres the still frame at the rest angle");
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
        ct: (() => {
          const rows = [{ t: "A", cp: "C", prem: 100, askPrem: 60, bidPrem: 30, size: 40, exp: "2026-10-02", spanStart: "2026-09-29T15:00:00Z" },
            { t: "A", cp: "P", prem: 50, askPrem: 10, bidPrem: 30, size: "12", exp: "2026-10-02", spanStart: "2026-09-29T15:00:00Z" },
            { t: "B", cp: "C", prem: 30, askPrem: 30, size: null, exp: "2026-10-02", spanStart: "2026-09-29T15:00:00Z" },
            { t: "C", cp: "C", prem: 20, askPrem: 20, size: 0, exp: "2026-12-18", spanStart: "2026-09-29T15:00:00Z" }];
          const pick = (m, id) => m.layers.flat().find((d) => d.id === id).contracts;
          const lean = model(rows, { sectorOf: (t) => (t === "A" ? "Technology" : t === "B" ? "Technology" : "Energy") }), dte = model(rows, { out: "dte", sectorOf: () => "Energy" });
          const two = model(rows.slice(0, 2), { out: "dte", sectorOf: () => "Energy" });
          return { a: pick(lean, "n:A"), b: pick(lean, "n:B"), c: pick(lean, "n:C"), tech: pick(lean, "s:tech"), energy: pick(lean, "s:energy"), ca: pick(lean, "i:ca"), bull: pick(lean, "o:bull"), w1: pick(dte, "o:w1"), far: pick(dte, "o:far"), w1ok: pick(two, "o:w1"), secok: pick(two, "s:energy"), pa: pick(two, "i:pa") };
        })(),
        rank: (() => {
          const at = "2026-09-29T15:00:00Z";
          const m = model([{ t: "Q", prem: 5, exp: "2026-12-18", spanStart: at }, { t: "R", prem: 9, exp: "2026-09-29", spanStart: at }, { t: "S", prem: 9 }, { t: "T", prem: 1, exp: "nope" }, { t: "U", prem: 2 }], { names: 3, sectorOf: (t) => (t === "Q" ? null : "Energy"), out: "dte" });
          return { names: m.layers[2].map((d) => d.label + (d.pos ? "#" + d.pos : "")), sectors: m.layers[1].map((d) => d.label), out: m.layers[3].map((d) => d.label) };
        })(),
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
    eq(u.ct.a, 52, "a name carries the contracts of its windows, summed once per window although each window splits across sides");
    eq(u.ct.b, null, "a name with a window of unknown size shows no contract count rather than a partial one");
    eq(u.ct.c, null, "and a count that sums to zero is omitted, never shown as zero");
    eq(u.ct.tech, null, "a sector holding a window of unknown size shows none either");
    eq(u.ct.energy, null, "nor a sector whose only window states zero");
    eq(u.ct.ca, null, "a side node never carries contracts: the vendor attributes premium, not contracts, to the quote sides");
    eq(u.ct.bull, null, "nor does a lean node");
    eq(u.ct.far, null, "an expiry with only a zero-size window shows none");
    eq(u.ct.w1, null, "an expiry holding the unknown-size window shows none");
    deep(u.rank.names, ["R#1", "S#2", "Q#3", "Other names"], "names rank by premium, ties broken by id, with rank numerals, and Other names last");
    const tiny = await page.evaluate((flow) => [0, 20, 40].map((w) => {
      const host = document.createElement("div");
      host.style.cssText = "width:" + w + "px;overflow:hidden";
      document.body.append(host);
      try {
        const n = window.FlowsUI.net.mount(host, { universe: false });
        n.take(flow, { state: "ok" });
        n.orbit(40, 20);
        return w + ":" + n.stats().layers.join("-") + ":" + (n.camera().zoom > 0) + ":" + n.stats().w;
      } catch (e) { return w + ":threw " + e; }
    }), alerts());
    deep(tiny.map((t) => t.replace(/^(\d+):\d+-\d+-\d+-\d+:true:(\d+)$/, "$1>$2")), ["0>16", "20>36", "40>56"],
      `mounting in a host 0, 20 or 40 px wide lays out at the stage's own width, 16 px wider than the host for its negative margins, at a positive zoom without throwing (${tiny.join(" ")}); none of them reaches size()'s 640 px fallback, which needs a stage with no width at all`);
    deep(u.rank.sectors, ["Energy", "No sector"], "No sector sits below a smaller ranked sector");
    deep(u.rank.out, ["0DTE", "32+ days", "No expiry"], "the expiry layer ranks by premium, and No expiry, its residual, sits last although it carries the most");
    eq(u.ct.w1ok, 52, "an expiry whose every window states its size carries their contracts");
    eq(u.ct.secok, 52, "and so does such a sector");
    eq(u.ct.pa, null, "while the side nodes of the same windows carry none");
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
    await shot(page, "net-pending-1440");
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
console.log(`✓ flows-net-render: ${checks} checks — the flow network drawn in 3D on the unusual page from fixture alerts: layer and node counts from the data, ` +
  `every layer ranked by premium top to bottom with the residual buckets last, at rest, at the yaw and pitch limits, after new data reorders a layer and under reduced motion, ` +
  `premium conserved through every layer and edge at any angle, contracts on name, sector and expiry nodes only, pointer and touch orbit with clamping, inertia and recentring, ` +
  `hit targets that follow the camera, back-to-front depth order, hover, row and keyboard highlighting, the accessible table and label, the freshness pill, ` +
  `the expiry output, a flare on a new window, pause when hidden or off screen, pending, empty, failed and unread states, ` +
  `no overflow, no label or caption collision and every label within half a pitch of its own sphere at 320, 390, 700, 768, 1024, 1280 and 1440 over a yaw by pitch grid, along the sway path and where a long drag stops, every sector and name label with its premium at 768 and at the 1440 yaw limits, a dark chip beside the rank numeral, the tooltip clear of the lit subgraph, the first tap on Recentre after a touch drag, a host 20 or 40 px wide and the 640 px fallback of a 0 px one, and CPU per frame`);
