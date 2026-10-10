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

async function mount(browser, { width = 1440, height = 1300, reduced = false, flow = alerts(), uni = universe(), flowStatus = 200, uniStatus = 200, deferAlerts = false, wait = true, touch = false, patch = null, delayFonts = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push("console: " + m.text()); });
  page.errors = errors;
  let release = null;
  const gate = deferAlerts ? new Promise((r) => { release = r; }) : null;
  page.release = () => release && release();
  const html = PAGES.unusualPage({ username: "test" }).replace("</head>", "<style>html{scroll-behavior:auto!important}</style></head>");
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (delayFonts && u.pathname.endsWith(".woff2")) await new Promise((r) => setTimeout(r, delayFonts));
      if (patch && u.pathname === "/assets/js/flows-net.js") {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch) { if (!src.includes(from)) throw new Error("mutant anchor missing: " + from); src = src.replaceAll(from, to); }
        return route.fulfill({ body: src, contentType: "text/javascript" });
      }
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
  await page.goto("https://example.test/flows/unusual/", delayFonts ? { waitUntil: "commit" } : undefined);
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

function auditFn(sc, rest) {
  const bad = [], S = sc.spheres, L = sc.labels, B = sc.bands, k = sc.scale, box = { w: sc.w, h: sc.h };
  const clampv = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hit = (l, s) => { const nx = Math.max(l.x, Math.min(s.cx, l.x + l.w)), ny = Math.max(l.y, Math.min(s.cy, l.y + l.h)); return s.r - Math.hypot(s.cx - nx, s.cy - ny); };
  for (let i = 0; i < S.length; i++) {
    for (let j = i + 1; j < S.length; j++) if (S[i].r + S[j].r - Math.hypot(S[i].cx - S[j].cx, S[i].cy - S[j].cy) > 0) bad.push("spheres " + S[i].key + " " + S[j].key);
    if (S[i].cx - S[i].r < 0 || S[i].cx + S[i].r > box.w || S[i].cy - S[i].r < 0 || S[i].cy + S[i].r > box.h) bad.push("sphere out " + S[i].key);
  }
  for (let i = 0; i < L.length; i++) {
    for (const s of S) if (hit(L[i], s) > 0) bad.push("chip " + L[i].key + " over sphere " + s.key);
    for (let j = i + 1; j < L.length; j++) if (Math.min(L[i].x + L[i].w, L[j].x + L[j].w) - Math.max(L[i].x, L[j].x) > 0.5 && Math.min(L[i].y + L[i].h, L[j].y + L[j].h) - Math.max(L[i].y, L[j].y) > 0.5) bad.push("chips " + L[i].key + " " + L[j].key);
    if (L[i].x < 0 || L[i].y < 0 || L[i].x + L[i].w > box.w || L[i].y + L[i].h > box.h) bad.push("chip out " + L[i].key);
  }
  for (const hd of sc.heads) {
    if (hd.x < 0 || hd.y < 0 || hd.x + hd.w > box.w || hd.y + hd.h > box.h) bad.push("header out " + hd.text);
    for (const s of S) if (hit(hd, s) > 0) bad.push("header " + hd.text.split(" ")[0] + " over sphere " + s.key);
    if (sc.readout && hd.y - (sc.readout.y + sc.readout.h) < 12) bad.push("readout within " + (hd.y - sc.readout.y - sc.readout.h).toFixed(1) + " px of header " + hd.text.split(" ")[0]);
  }
  if (sc.readout && (sc.readout.x < 0 || sc.readout.x + sc.readout.w > box.w)) bad.push("readout out of the canvas");
  if (!rest) return bad;
  const along = (s) => (sc.vert ? s.cy : s.cx), cross = (s) => (sc.vert ? s.cx : s.cy), cols = [0, 1, 2, 3].map((c) => S.filter((s) => s.col === c));
  const pos = cols.map((c) => c.reduce((a, s) => a + along(s), 0) / c.length);
  for (let i = 2; i < 4; i++) if (Math.abs((pos[i] - pos[i - 1]) - (pos[1] - pos[0])) > 1) bad.push("spacing " + pos.map((x) => x.toFixed(1)).join(","));
  cols.forEach((c, i) => {
    for (const s of c) if (Math.abs(along(s) - pos[i]) > 1) bad.push("layer " + i + " not on one line");
    const lo = Math.min(...c.map((s) => cross(s) - s.r)), hi = Math.max(...c.map((s) => cross(s) + s.r));
    if (Math.abs((lo + hi) / 2 - sc.midC) > 1) bad.push("layer " + i + " centred at " + ((lo + hi) / 2).toFixed(1) + " not " + sc.midC.toFixed(1));
    if (!sc.vert) {
      const edges = new Set(L.filter((l) => l.col === i).map((l) => Math.round((i === 0 ? l.x + l.w : l.x) * 2)));
      if (edges.size > 1) bad.push("layer " + i + " chips on " + edges.size + " x edges");
    }
  });
  const sums = {};
  for (const b of B) {
    const want = clampv(b.v * k.bandPerM / 1e6, k.bandMin, k.bandMax);
    if (Math.abs(b.w0 - want) > 0.05) bad.push("band width " + b.from + ">" + b.to + " " + b.w0 + " vs " + want);
    if (b.drawn < b.w0 - 0.05) bad.push("band drawn thinner than its width " + b.from + ">" + b.to);
    sums[b.from] = (sums[b.from] || 0) + b.slice;
  }
  for (const n of sc.nodes) if (n.out && Math.abs((sums[n.key] || 0) - n.v * k.bandPerM / 1e6) > 1) bad.push("slices of " + n.key + " sum " + (sums[n.key] || 0).toFixed(2) + " vs " + (n.v * k.bandPerM / 1e6).toFixed(2));
  const vm = Math.max(...sc.nodes.map((n) => n.v));
  for (const s of S) {
    const n = sc.nodes.find((x) => x.key === s.key), want = Math.max(k.minR, (6 + 28 * Math.sqrt(n.v / vm)) * k.k);
    if (Math.abs(s.r - want) > 0.05) bad.push("sphere " + s.key + " radius " + s.r.toFixed(2) + " vs " + want.toFixed(2));
  }
  const tot = new Set(sc.heads.map((h) => h.text.split(" \u00b7 ")[1]));
  if (sc.heads.length !== 4 || tot.size !== 1) bad.push("headers carry " + [...tot].join(" / "));
  return bad;
}
const camera = (page) => net(page, "return net.camera();");
const toStage = async (page, pad = 96, running = true) => {
  await page.evaluate((pad) => { const r = document.querySelector("#uaNet .fn-stage").getBoundingClientRect(); window.scrollTo({ top: Math.max(0, scrollY + r.top - pad), behavior: "instant" }); }, pad);
  await page.waitForFunction((running) => { const r = document.querySelector("#uaNet .fn-stage").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && (!running || window.FlowsUI.net.of(document.getElementById("uaNet")).stats().running); }, running, { timeout: 15000 });
};
const hoverNode = async (page, id) => {
  await page.mouse.move(5, 5);
  const p = await page.evaluate((id) => { const r = document.querySelector("#uaNet .fn-stage").getBoundingClientRect(), n = window.FlowsUI.net.of(document.getElementById("uaNet")).node(id); return { x: r.left + n.x, y: r.top + n.y }; }, id);
  await page.mouse.move(p.x, p.y);
};
const litVector = (page, ids, want, what) => page.waitForFunction(({ ids, want }) => { const n = window.FlowsUI.net.of(document.getElementById("uaNet")); return ids.every((id, i) => n.node(id).lit === want[i]); }, { ids, want }, { timeout: 8000 }).catch(async () => { throw new Error(`${what}: the lit vector never reached ${JSON.stringify(want)}; it is ${JSON.stringify(await net(page, "return arg.map((id) => net.node(id).lit);", ids))}`); });
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
const FLUSH_K = 2.5;
const FLUSH_FLOOR = 12;
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

    await toStage(page);
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

    await page.evaluate(() => document.activeElement.blur());
    await toStage(page);
    await net(page, "net.orbit(arg[0], arg[1]); return null;", (await camera(page)).rest);
    await hoverNode(page, "n:NVDA");
    await litVector(page, ["n:NVDA", "s:tech", "i:ca", "o:bull", "n:MSFT", "s:energy", "n:SPY"], [1, 1, 1, 1, 0, 0, 0], "hovering NVDA");
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
    await litVector(page, ["n:MSFT", "n:NVDA", "s:energy"], [1, 1, 1], "leaving NVDA");
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

    await page.evaluate(() => document.querySelector("#uaNet tbody tr:first-child td:nth-child(3)").scrollIntoView({ block: "center", behavior: "instant" }));
    const cell = await page.evaluate(() => { const r = document.querySelector("#uaNet tbody tr:first-child td:nth-child(3)").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(cell.x, cell.y);
    await page.waitForFunction(() => document.querySelector("#uaNet tbody tr:first-child").classList.contains("is-lit"), null, { timeout: 8000 });
    await litVector(page, ["n:NVDA", "i:ca", "i:cb", "n:SPY"], [1, 1, 0, 0], "hovering the first table row");
    const rowLit = await net(page, `return ["n:NVDA", "i:ca", "i:cb", "n:SPY"].map((id) => net.node(id).lit);`);
    deep(rowLit, [1, 1, 0, 0], "hovering a row of the table lights that one path: NVDA through calls at ask, not its calls at bid");
    await page.mouse.move(5, 5);

    await page.focus("#uaNet .fn-home");
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
    const onScreen = async () => {
      await page.evaluate(() => document.querySelector("#uaNet .fn-stage").scrollIntoView({ block: "start", behavior: "instant" }));
      return page.waitForFunction(() => { const r = document.querySelector("#uaNet .fn-stage").getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && window.FlowsUI.net.of(document.getElementById("uaNet")).stats().running; }, null, { timeout: 10000 }).then(() => true, () => false);
    };
    if (!(await onScreen()) && !(await onScreen())) {
      const why = await page.evaluate(() => { const r = document.querySelector("#uaNet .fn-stage").getBoundingClientRect(); return `stage ${Math.round(r.top)}..${Math.round(r.bottom)} of ${innerHeight}, running ${window.FlowsUI.net.of(document.getElementById("uaNet")).stats().running}`; });
      throw new Error(`GLIDE PRECONDITION: the stage is not on screen with its loop running after two scrolls (${why})`);
    }
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
      if (mode === "lean" && width <= 540) {
        const lg = await page.evaluate(() => {
          const rows = (sel) => [...document.querySelectorAll("#uaNet .fn-scale .fn-lg-g")].map((g) => [...g.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)));
          const sc = document.querySelector("#uaNet .fn-scale").getBoundingClientRect();
          const items = [...document.querySelectorAll("#uaNet .fn-scale .fn-lg-i")].map((el) => el.getBoundingClientRect());
          return { items: rows(".fn-lg-i"), n: document.querySelectorAll("#uaNet .fn-scale .fn-lg-i").length, inside: items.every((r) => r.left >= sc.left - 0.5 && r.right <= sc.right + 0.5), box: [sc.left, sc.right, items.map((r) => [Math.round(r.left), Math.round(r.right)])] };
        });
        ok(lg.n === 6 && lg.items.length === 2 && lg.items.every((g) => g.length === 3 && Math.max(...g) - Math.min(...g) <= 2), `the legend's three reference circles share one row and its three band swatches share one row at ${width}px (${JSON.stringify(lg.items)})`);
        ok(lg.inside, `and every legend item sits inside the scale row at ${width}px (${JSON.stringify(lg.box)})`);
        const th = await page.evaluate(() => [...document.querySelectorAll("#uaNet table.fn-tab thead th")].filter((e) => e.offsetParent).map((e) => ({ t: e.textContent, sw: e.scrollWidth, cw: e.clientWidth })));
        ok(th.length >= 4 && th.every((x) => x.sw <= x.cw), `no table header is truncated at ${width}px (${JSON.stringify(th)})`);
      }
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
        ok(left.yaw < -20 && right.yaw > 20 && left.yaw >= -ly && right.yaw <= ly, `at 1440px the reader can turn the network at least 20 degrees either way before a label would collide, inside the ${ly} degree limit (${left.yaw.toFixed(1)}, ${right.yaw.toFixed(1)})`);
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
      for (let i = 0; i < 16; i++) path.push([sw.rest[0] + sw.sway * Math.sin(i * Math.PI / 8), sw.rest[1]]);
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

  for (const width of [320, 700]) {
    const { ctx, page } = await mount(browser, { width, height: 1400, delayFonts: 3000 });
    const atRest = async () => {
      await page.waitForFunction(() => { const n = window.FlowsUI.net.of(document.getElementById("uaNet")), c = n.camera(); n.orbit(c.rest[0], c.rest[1]); return n.model().layers.flat().every((d) => { const k = n.node(d.id); return Math.abs(k.x - k.sx) < 0.6 && Math.abs(k.y - k.sy) < 0.6; }); }, null, { timeout: 15000, polling: 100 });
      const [r] = await sweep(page, [(await camera(page)).rest]);
      return r;
    };
    const widths = async () => (await net(page, "return net.labels();")).filter((l) => !l.id.startsWith("cap:")).reduce((a, l) => a + l.w, 0);
    ok(await page.evaluate(() => document.fonts.status === "loading" || [...document.fonts].some((f) => f.status !== "loaded")), `PRECONDITION: the web font has not arrived when the network first draws (${width}px)`);
    await page.waitForTimeout(900);
    const w0 = await widths();
    const r0 = await atRest();
    deep(overlaps(r0.labels), [], `no two labels or captions collide at rest in the fallback face, ${width}px`);
    deep(adrift(r0.labels, r0.layout, width < 560), [], `and every label stays by its sphere in the fallback face, ${width}px`);
    await page.waitForFunction(() => document.fonts.status === "loaded" && [...document.fonts].some((f) => f.status === "loaded"), null, { timeout: 20000 });
    await page.waitForTimeout(600);
    const w1 = await widths();
    ok(Math.abs(w1 - w0) > 1, `THE CHIPS ARE MEASURED AGAIN WHEN THE FONT ARRIVES: total chip width ${w0.toFixed(0)} px in the fallback face, ${w1.toFixed(0)} px in the loaded one (${width}px)`);
    const r1 = await atRest();
    deep(overlaps(r1.labels), [], `no two labels or captions collide at rest once the font has arrived, ${width}px`);
    deep(adrift(r1.labels, r1.layout, width < 560), [], `and every label stays by its sphere once the font has arrived, ${width}px`);
    deep(await page.evaluate(`(${auditFn})(window.FlowsUI.net.of(document.getElementById("uaNet")).scene(), false)`), [], `and nothing touches a header or leaves the canvas (${width}px)`);
    deep(page.errors, [], `nothing threw while the font loaded at ${width}px`);
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
    ok(!c1.auto && c1.yaw > c0.yaw + 12 && c1.pitch > c0.pitch + 1, `A POINTER DRAG ORBITS the camera (yaw ${c0.yaw.toFixed(1)} to ${c1.yaw.toFixed(1)}, pitch ${c0.pitch.toFixed(1)} to ${c1.pitch.toFixed(1)})`);
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
    ok(c.yaw > 15 && c.pitch > 5, `a long drag stops where a label would next collide, inside the yaw and pitch limits (${c.yaw.toFixed(1)}, ${c.pitch.toFixed(1)})`);
    await tight(c, 1200 * 0.32, 300 * 0.22, "dragged to the right and up");
    await ranked(page, "dragged to the yaw and pitch limits");
    await shot(page, "net-1440-orbit-right", "net");
    await drag(page, -1300, -300, { x: 0.97, y: 0.6 });
    c = await camera(page);
    ok(c.yaw < -15 && c.pitch < c0.rest[1], `and the other way (${c.yaw.toFixed(1)}, ${c.pitch.toFixed(1)})`);
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
    await net(page, "net.recentre(); return null;");
    await settle(page);
    await page.mouse.move(b.x + b.w * 0.5, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + b.w * 0.5 + 40, b.y + 20);
    await page.mouse.move(b.x + b.w * 0.5 + 160, b.y + 20, { steps: 2 });
    await page.mouse.up();
    const fr0 = await camera(page);
    await page.waitForTimeout(2500);
    const fr1 = await camera(page);
    ok(fr1.spin === 0 && fr1.yaw - fr0.yaw <= 20 && fr1.yaw <= fr1.limits[0] - 5, `A FLICK FROM REST COASTS A LITTLE: released at yaw ${fr0.yaw.toFixed(1)}, settled at ${fr1.yaw.toFixed(1)} with spin ${fr1.spin}, limit ${fr1.limits[0]}`);
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
    const backUrl = page.url(), sy = await page.evaluate(() => scrollY);
    await net(page, "net.orbit(48, 16); return null;");
    await page.mouse.move(5, 5);
    const aapl2 = await net(page, `return net.node("n:AAPL");`);
    await Promise.all([page.waitForURL(/\/flows\/ticker\/\?t=AAPL$/, { timeout: 10000 }), page.mouse.click(b.x + aapl2.x, b.y + aapl2.y)]);
    ok(true, `and a click there after the rotation opens AAPL's ticker page (${page.url()})`);
    await page.goto(backUrl);
    await page.waitForFunction(() => { const n = window.FlowsUI && window.FlowsUI.net && window.FlowsUI.net.of(document.getElementById("uaNet")); return n && n.stats().layers.length === 4 && n.stats().layers[1] > 1; }, null, { timeout: 15000 });
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), sy);

    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    await net(page, "net.orbit(-55, 18); return null;");
    const order = await net(page, "return net.paints();");
    deep(order.filter((it) => it.k !== "node").map((it) => it.k), ["floor", "shadows", "planes", "bands", "pulses", "heads", "spheres", "labels"], "PAINTER'S ORDER: floor, shadows, glass planes, bands, pulses, headers, spheres, then the labels last");
    const nodes = order.filter((it) => it.k === "node");
    ok(nodes.length === 25 && nodes.every((n, i) => !i || nodes[i - 1].z >= n.z), "the spheres are drawn back to front");
    const ix = (k) => order.findIndex((it) => it.k === k);
    ok(order.findIndex((it) => it.k === "node") > ix("heads") && order.findIndex((it) => it.k === "node") < ix("spheres"), "after every band and pulse, so a sphere always covers the light that reaches it");
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
    eq(await page.evaluate(() => getComputedStyle(document.querySelector("#uaNet .fn-stage")).touchAction), "pan-y pinch-zoom", "the stage leaves vertical panning and pinch-zoom to the page");
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
    const hb = await page.evaluate(() => new Promise((done) => {
      const h = document.querySelector("#uaNet .fn-home");
      let last = NaN, calm = 0, n = 0;
      const tick = () => {
        h.scrollIntoView({ block: "center", behavior: "instant" });
        const r = h.getBoundingClientRect(), at = scrollY + "," + r.top;
        calm = at === last ? calm + 1 : 0; last = at;
        if (calm < 10 && ++n < 600) { requestAnimationFrame(tick); return; }
        const x = r.left + r.width / 2 + 14, y = r.top + r.height / 2 + 14;
        done({ x, y, calm, on: h.contains(document.elementFromPoint(x, y)) });
      };
      tick();
    }));
    ok(hb.calm >= 10 && hb.on, `PRECONDITION: the page has stopped scrolling and the tap point lies on the Recentre button (settled ${hb.calm} frames, on the button ${hb.on})`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: hb.x, y: hb.y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const moved = await page.waitForFunction((y) => window.FlowsUI.net.of(document.getElementById("uaNet")).camera().yaw !== y, c3.yaw, { timeout: 3000 }).then(() => true, () => false);
    ok(moved, `PRECONDITION: the camera answered the tap on Recentre within 3 s (yaw still ${c3.yaw.toFixed(1)})`);
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
    const restOf = async (page) => {
      await net(page, "net.freeze(true); net.recentre(); return null;");
      await page.waitForTimeout(150);
      return page.evaluate(`(${auditFn})(window.FlowsUI.net.of(document.getElementById("uaNet")).scene(), true)`);
    };
    const sweepOf = (page) => page.evaluate(`(() => { const n = window.FlowsUI.net.of(document.getElementById("uaNet")), c = n.camera(), bad = [], f = ${auditFn}; let seen = 0;
      for (let i = 0; i <= 400; i++) { const t = i / 10, sc = n.scene({ yaw: c.sway * Math.sin(2 * Math.PI * t / c.period), pitch: c.rest[1], t }); seen++; for (const b of f(sc, false)) if (bad.length < 8) bad.push("t=" + t + " " + b); }
      return { bad, seen, sway: c.sway }; })()`);
    for (const width of [1440, 1024, 390]) {
      const { ctx, page } = await mount(browser, { width, height: 1400 });
      const sc0 = await net(page, "return net.scale();");
      eq(sc0.vert, width < 640, `the rows layout is used below 640 px and the columns above (${width})`);
      deep(await restOf(page), [], `SYMMETRY AND THE MONEY SCALE AT REST, ${width}px: layers equally spaced, every stack centred on the midline, chips on one edge per column, sphere radius, band width and the outgoing slices of every node on the one scale, one total on every header, nothing overlapping`);
      const sc = await net(page, "return net.scene();");
      ok(sc.rest, "the scene read is the rest frame");
      deep(sc.nodes.filter((n) => !n.out).map((n) => n.key).length > 0, true, "the last layer sends nothing on");
      const lg = await net(page, "return net.legend();");
      eq(lg.length, 6, "the legend has three reference circles and three band swatches");
      const vm = Math.max(...sc.nodes.map((n) => n.v));
      lg.slice(0, 3).forEach((c) => ok(Math.abs(c.r - Math.max(sc0.minR, (6 + 28 * Math.sqrt(c.v * 1e6 / vm)) * sc0.k)) < 0.01, `the $${c.v}M reference circle is drawn on the scene's own sphere scale (${c.r})`));
      lg.slice(3).forEach((b) => ok(Math.abs(b.w - Math.max(1.25, Math.min(sc0.bandMax, b.v * sc0.bandPerM))) < 0.01, `the $${b.v}M band swatch is drawn on the scene's own band scale (${b.w})`));
      ok(lg[2].v > lg[1].v && lg[1].v > lg[0].v && lg[5].v > lg[4].v && lg[4].v > lg[3].v, "reference values rise");
      if (width === 1440) {
        eq(sc0.k, 1, "at 1440 the scale is the stated one");
        near(sc0.bandPerM, 0.75, "0.75 px of band per $1M while the largest node is under $75M");
        const big = Math.max(...sc.spheres.map((s) => s.r));
        near(big, 34, "the largest node is 34 px (r = 6 + 28 sqrt(v / vMax))");
        ok(sc.spheres.every((s) => s.r >= 9 - 1e-9), "and no node is under 9 px");
        eq((await net(page, "return net.scale().form;")), "line", "chips are 22 px single lines");
        ok(sc.labels.every((l) => Math.abs(l.h - 22) < 1e-9), "every chip is 22 px tall");
      }
      await net(page, "net.freeze(false); return null;");
      const sw = await sweepOf(page);
      eq(sw.seen, 401, "the sweep reads 401 frames, 0 to 40 s at 0.1 s");
      deep(sw.bad, [], `NO CHIP OVERLAPS A SPHERE OR A CHIP, NOTHING LEAVES THE CANVAS, over the 0 to 40 s sway at ${width}px (sway ${sw.sway} degrees)`);
      ok(sw.sway > 0, `the sway is on (${sw.sway} degrees)`);
      await page.waitForTimeout(1200);
      await shot(page, "v3-" + width + "-motion", "net");
      await toStage(page);
      await hoverNode(page, "n:NVDA");
      await litVector(page, ["n:NVDA", "n:~"], [1, 0], `hovering NVDA at ${width}px`);
      const hv = await net(page, "return net.scene();");
      eq(!!hv.readout, width >= 640, `the hover readout is drawn in the columns layout and not in the rows layout (${width}px)`);
      deep(await page.evaluate(`(${auditFn})(window.FlowsUI.net.of(document.getElementById("uaNet")).scene(), false)`), [], `THE READOUT CLEARS THE HEADERS BY 12 PX AND NO HEADER TOUCHES A SPHERE while a node is hovered, ${width}px`);
      await page.waitForTimeout(500);
      await shot(page, "v3-" + width + "-hover", "net");
      deep(page.errors, [], `nothing threw at ${width}px`);
      await ctx.close();
    }
  }

  {
    const mutants = [
      ["every sphere the same size", [["(R0 + R1 * Math.sqrt(Math.max(0, v) / (vMax || 1)))", "(R0 + 8)"]], /radius/],
      ["bands not sized by premium", [["r.ws = e.v * G.bpd;", "r.ws = 7;"]], /band width|slices/],
      ["columns unequally spaced", [["[-3, -1, 1, 3].forEach", "[-3, -1, 0.4, 3].forEach"]], /spacing/],
      ["a stack off the midline", [["let y = -(sum + gap * units) / 2;", "let y = -(sum + gap * units) / 2 + 20;"]], /centred/],
      ["chips on a ragged edge", [["n.px + cl.rMax * n.f + 8", "n.px + n.R + 8"]], /x edges/],
      ["a header with another total", [['t.toUpperCase() + " " + MID + " " + total', 't.toUpperCase() + " " + MID + " " + (i === 2 ? "$1M" : total)']], /headers/],
      ["headers up under the readout", [["G.hd = cols.map((c) => [c.x, 52]);", "G.hd = cols.map((c) => [c.x, 34]);"]], /readout within/, true],
      ["headers down on the spheres", [["G.hd = cols.map((c) => [c.x, 52]);", "G.hd = cols.map((c) => [c.x, 100]);"]], /over sphere/],
    ];
    for (const [name, patch, want, hover] of mutants) {
      const { ctx, page } = await mount(browser, { width: 1440, height: 1300, patch });
      await net(page, "net.freeze(true); net.recentre(); return null;");
      await page.waitForTimeout(150);
      if (hover) { await toStage(page, 40, false); await hoverNode(page, "n:NVDA"); await litVector(page, ["n:NVDA"], [1], "the mutant hover"); }
      const bad = await page.evaluate(`(${auditFn})(window.FlowsUI.net.of(document.getElementById("uaNet")).scene(), true)`);
      ok(bad.some((b) => want.test(b)), `THE AUDIT FAILS ON A MUTANT (${name}): ${bad.slice(0, 2).join("; ")}`);
      await ctx.close();
    }
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 1000 });
    const a = await stats(page);
    ok(a.pulses >= a.edges && a.edges > 40, `every band carries light: ${a.pulses} pulses on ${a.edges} bands`);
    const radii = (t) => net(page, "return net.scene({ yaw: 0, pitch: 11, t: arg }).spheres.map((s) => s.r);", t);
    await net(page, "net.freeze(true); return null;");
    const flat = await net(page, "return net.scene({ yaw: 0, pitch: 11 }).spheres.map((s) => s.r);");
    await net(page, "net.freeze(false); return null;");
    const r0 = await radii(0), r3 = await radii(3);
    const rel = r3.map((r, i) => r / flat[i]), rel0 = r0.map((r, i) => r / flat[i]);
    ok(Math.min(...rel, ...rel0) >= 1 - 1e-9 && Math.max(...rel, ...rel0) <= 1.0301 && Math.max(...rel) - Math.min(...rel0) > 0.01, `the spheres breathe between 1.00 and 1.03 of their size (${Math.min(...rel).toFixed(4)} to ${Math.max(...rel).toFixed(4)})`);
    ok(new Set(rel0.map((x) => x.toFixed(3))).size > 3, "each in its own phase");
    await page.click("#uaNet .fn-freeze");
    await page.waitForTimeout(200);
    const fz = await page.evaluate(() => ({ p: document.querySelector("#uaNet .fn-freeze").hasAttribute("aria-pressed"), t: document.querySelector("#uaNet .fn-freeze").textContent }));
    const f1 = await stats(page);
    ok(fz.p === false && /Resume/.test(fz.t) && f1.still && !f1.running && f1.pulses === 0, `FREEZE stops the pulses, the breathing and the sway and the loop with them (${JSON.stringify(fz)})`);
    const fc = await camera(page);
    await page.waitForTimeout(500);
    eq((await camera(page)).yaw, fc.yaw, "and the camera holds");
    await drag(page, 120, 10);
    ok((await camera(page)).yaw !== fc.yaw && !(await stats(page)).running, "a drag still turns a frozen network, with no loop");
    await page.click("#uaNet .fn-freeze");
    await page.waitForTimeout(300);
    ok((await stats(page)).running && !(await stats(page)).still, "and Resume starts it again");
    await ctx.close();
    const rm = await mount(browser, { width: 1440, height: 1000, reduced: true });
    eq(await rm.page.evaluate(() => document.querySelector("#uaNet .fn-freeze").hidden), true, "under reduced motion there is nothing to freeze, so the control is hidden");
    await rm.ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 1000 });
    await page.waitForTimeout(500);
    const out = await page.evaluate(async (flow) => {
      const live = new Map(), obs = new Set();
      const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
      const key = (t, e) => (t === document ? "doc" : t === window ? "win" : t instanceof MediaQueryList ? "mq" : null) + ":" + e;
      EventTarget.prototype.addEventListener = function (e, f, o) { if (key(this, e).indexOf("null") !== 0) live.set(key(this, e), (live.get(key(this, e)) || 0) + 1); return add.call(this, e, f, o); };
      EventTarget.prototype.removeEventListener = function (e, f, o) { if (key(this, e).indexOf("null") !== 0) live.set(key(this, e), (live.get(key(this, e)) || 0) - 1); return rem.call(this, e, f, o); };
      for (const name of ["ResizeObserver", "IntersectionObserver", "MutationObserver"]) {
        const C = window[name];
        window[name] = class extends C { constructor(f) { super(f); obs.add(this); } disconnect() { obs.delete(this); super.disconnect(); } };
      }
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;top:0;left:0;width:900px;z-index:-1";
      document.body.append(host);
      const pre = obs.size;
      window.FlowsUI.segmented("Baseline", [{ label: "A" }, { label: "B" }], () => {}, 0);
      const own = obs.size - pre;
      const baseline = new Map(live);
      const n = window.FlowsUI.net.mount(host, { universe: false });
      n.take(flow, { state: "ok" });
      await new Promise((r) => setTimeout(r, 600));
      const during = { running: n.stats().running, obs: obs.size };
      n.destroy();
      const frames = n.stats().frames;
      await new Promise((r) => setTimeout(r, 400));
      const after = n.stats();
      const left = {};
      for (const [k, v] of live) if (v - (baseline.get(k) || 0) !== 0) left[k] = v - (baseline.get(k) || 0);
      return { during, left, obs: obs.size - pre - 2 * own, own, still: after.frames === frames && !after.running, empty: host.childElementCount, again: !!window.FlowsUI.net.of(host) };
    }, alerts());
    ok(out.during.running && out.during.obs >= 2, `PRECONDITION: the mounted network runs and holds observers (${JSON.stringify(out.during)})`);
    eq(out.obs, 0, `DESTROY disconnects every observer it made (the one observer the shared segmented control leaves on its own detached element, ${out.own}, is the page library's, and is counted once for the network's control and once for a baseline control)`);
    deep(Object.keys(out.left).filter((k) => !/^doc:(pointer|click|keydown|keyup|focus|mouse)/.test(k)), [], `and leaves no listener of its own on the document, the window or the motion query (${JSON.stringify(out.left)})`);
    ok(out.still, "its animation loop stops and counts no more frames");
    eq(out.empty, 0, "its DOM is removed");
    eq(out.again, false, "and the host can be mounted afresh");
    await ctx.close();
  }

  {
    const { ctx, page } = await mount(browser, { width: 1440, height: 1000 });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    const heap = async (gc) => { if (gc) await cdp.send("HeapProfiler.collectGarbage"); return (await cdp.send("Runtime.getHeapUsage")).usedSize; };
    await net(page, "net.measure(300); return null;");
    const h0 = await heap(true);
    await net(page, "net.measure(1500); return null;");
    const h1 = await heap(true);
    await net(page, "net.measure(1500); return null;");
    const h2 = await heap(true);
    ok(h2 - h0 < 262144, `NO PER-FRAME RETENTION: the live heap after 1,500 and 3,000 more frames, each after a collection, grew ${h1 - h0} then ${h2 - h1} bytes`);
    const t0 = await heap(false);
    await net(page, "net.measure(600); return null;");
    const t1 = await heap(false);
    cpu.alloc = Math.max(0, (t1 - t0) / 600);
    ok(cpu.alloc < 3072, `and the allocation per frame stays small (${cpu.alloc.toFixed(0)} bytes a frame)`);
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
      const cv = document.querySelector("#net canvas"), g = cv.getContext("2d"), flush = [], refs = [], ratios = [];
      const rc = document.createElement("canvas"), sp = document.createElement("canvas");
      rc.width = cv.width; rc.height = cv.height; sp.width = sp.height = 160;
      const rg = rc.getContext("2d"), sg = sp.getContext("2d"), gr = sg.createRadialGradient(54, 48, 0, 80, 80, 80);
      gr.addColorStop(0, "#fff"); gr.addColorStop(0.5, "#4a7bd0"); gr.addColorStop(1, "#06101f");
      sg.fillStyle = gr; sg.beginPath(); sg.arc(80, 80, 80, 0, 6.2832); sg.fill();
      const ref = () => {
        rg.setTransform(1, 0, 0, 1, 0, 0);
        rg.clearRect(0, 0, rc.width, rc.height);
        rg.globalCompositeOperation = "screen";
        rg.fillStyle = "#3a6fd8"; rg.strokeStyle = "#8fb4ff";
        for (let i = 0; i < 160; i++) {
          const x = 40 + (i * 37) % (rc.width - 480), y = 60 + (i * 53) % (rc.height - 160), h = 6 + (i % 9) * 3;
          rg.globalAlpha = 0.25 + (i % 5) * 0.08;
          rg.beginPath(); rg.moveTo(x, y); rg.bezierCurveTo(x + 160, y, x + 240, y + 90, x + 400, y + 90); rg.lineTo(x + 400, y + 90 + h); rg.bezierCurveTo(x + 240, y + 90 + h, x + 160, y + h, x, y + h); rg.closePath(); rg.fill(); rg.stroke();
        }
        rg.globalCompositeOperation = "source-over";
        for (let i = 0; i < 25; i++) { rg.globalAlpha = 0.9; rg.drawImage(sp, 80 + (i * 211) % (rc.width - 300), 80 + (i * 97) % (rc.height - 240), 70, 70); }
        rg.getImageData(0, 0, 1, 1);
      };
      for (let i = 0; i < 30; i++) { n.measure(1); g.getImageData(0, 0, 1, 1); ref(); }
      for (let r = 0; r < 3; r++) {
        const ts = [], rs = [];
        for (let i = 0; i < 240; i++) {
          const t0 = performance.now(); n.measure(1); g.getImageData(0, 0, 1, 1); const t1 = performance.now(); ref(); const t2 = performance.now();
          ts.push(t1 - t0); rs.push(t2 - t1);
        }
        ts.sort((a, b) => a - b); rs.sort((a, b) => a - b);
        flush.push(ts[120]); refs.push(rs[120]); ratios.push(ts[120] / rs[120]);
      }
      return { st, runs, flush: Math.min(...flush), ref: Math.min(...refs), ratio: Math.min(...ratios), ratios };
    }, { flow, uni: universe() });
    const best = out.runs.reduce((a, b) => (a.median <= b.median ? a : b));
    cpu.bench = { flush: out.flush, edges: out.st.edges, pulses: out.st.pulses, rafMedian: out.st.median, rafFrames: out.st.frames, loopMedian: best.median, loopP90: best.p90, loopMean: best.mean };
    ok(out.st.edges >= 100 && out.st.pulses >= 200, `the benchmark runs at ${out.st.edges} bands and ${out.st.pulses} pulses`);
    cpu.bench.ref = out.ref;
    cpu.bench.ratio = out.ratio;
    ok(out.flush <= Math.max(FLUSH_K * out.ref, FLUSH_FLOOR), `CPU per frame with the raster forced to finish (a pixel read after every draw), held as a ratio to a reference canvas workload timed in the same interleaved windows: ${out.flush.toFixed(1)} ms against ${out.ref.toFixed(1)} ms for the reference, ratio ${out.ratio.toFixed(2)} (runs ${out.ratios.map((x) => x.toFixed(2)).join(", ")}), limit ${FLUSH_K} with a floor of ${FLUSH_FLOOR} ms`);
    ok(best.median < 4, `CPU per frame stays far from a frame budget: ${best.median.toFixed(2)} ms median over 240 frames (target under 2 ms)`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`  CPU per frame on the unusual page at 1440px: median ${cpu.page.median === null ? "n/a" : cpu.page.median.toFixed(2)} ms over ${cpu.page.frames} frames (${cpu.page.pulses} pulses, ${cpu.page.edges} edges)`);
console.log(`  CPU per frame, benchmark at ${cpu.bench.edges} edges and ${cpu.bench.pulses} pulses: loop median ${cpu.bench.loopMedian.toFixed(2)} ms, p90 ${cpu.bench.loopP90.toFixed(2)} ms, mean ${cpu.bench.loopMean.toFixed(2)} ms; animation-frame median ${cpu.bench.rafMedian === null ? "n/a" : cpu.bench.rafMedian.toFixed(2)} ms over ${cpu.bench.rafFrames} frames; with the raster forced to finish ${cpu.bench.flush.toFixed(1)} ms against ${cpu.bench.ref.toFixed(1)} ms for the reference (ratio ${cpu.bench.ratio.toFixed(2)}); ${cpu.alloc.toFixed(0)} bytes allocated a frame`);
console.log(`✓ flows-net-render: ${checks} checks — the flow network drawn in 3D on the unusual page from fixture alerts: layer and node counts from the data, ` +
  `every layer ranked by premium top to bottom with the residual buckets last, at rest, at the yaw and pitch limits, after new data reorders a layer and under reduced motion, ` +
  `premium conserved through every layer and edge at any angle, contracts on name, sector and expiry nodes only, pointer and touch orbit with clamping, inertia and recentring, ` +
  `hit targets that follow the camera, back-to-front depth order, hover, row and keyboard highlighting, the accessible table and label, the freshness pill, ` +
  `the expiry output, a flare on a new window, pause when hidden or off screen, pending, empty, failed and unread states, ` +
  `no overflow, no label or caption collision and every label within half a pitch of its own sphere at 320, 390, 700, 768, 1024, 1280 and 1440 over a yaw by pitch grid, along the sway path and where a long drag stops, every sector and name label with its premium at 768 and at the 1440 yaw limits, a dark chip beside the rank numeral, the tooltip clear of the lit subgraph, the first tap on Recentre after a touch drag, a host 0, 20 or 40 px wide laid out at its stage's own 16, 36 or 56 px, and CPU per frame`);
