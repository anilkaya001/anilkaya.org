import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";
import * as RT from "../shared/flows-rt.js";
import { STRIP_FIELDS } from "../shared/flows-live.js";
import { easternInstant } from "../shared/flows-freshness.js";
import { projectUniverse, projectionColumns } from "../shared/flows-cross.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.LIVE_SHOTS || "";
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };
const EMIT = nightlyEmit();
const rd = (f) => JSON.parse(fs.readFileSync(path.join(EMIT, f), "utf8"));
const T = "AAPL";
const card = rd(`-card-${T}.json`);
const cardX = rd(`-card-x-${T}.json`);
const hist = fs.existsSync(path.join(EMIT, `-hist-${T}.json`)) ? rd(`-hist-${T}.json`) : { status: "absent" };
const universe = rd("-universe.json");
const meta = rd("-meta.json");
const S0 = card.panels.pricedMove.spot;
const PREV = card.sessionDate;
const DAY = "2026-08-25";
const T0 = easternInstant(DAY, 10 * 60 + 30);
const iso = (ms) => new Date(ms).toISOString();
const RTH = { phase: "rth", session: DAY, trading: true, lastClosed: PREV, endsAt: iso(easternInstant(DAY, 16 * 60)) };
const CLOSED = { phase: "closed", session: PREV, trading: true, lastClosed: PREV, endsAt: iso(easternInstant(DAY, 9 * 60 + 30)) };
const POST = { phase: "post", session: DAY, trading: true, lastClosed: PREV, endsAt: iso(easternInstant(DAY, 20 * 60)) };
const T_CLOSED = Date.parse("2026-08-25T06:00:00Z");
const MINUS = "\u2212";
const FIELDS = STRIP_FIELDS.map(([n]) => n);
const px2 = (v) => v.toFixed(2);

const SUMMARY = { status: "ok", scope: T, summary: `The greeks imply a ${card.engine.state.state} state for ${T}.`, ideas: [], tier: "priced", code: null, why: null,
  context: { state: { state: card.engine.state.state, word: "Transitional", confidence: card.engine.state.confidence } }, generatedAt: card.generatedAt };

const SRC = {
  glance: fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker-glance.js"), "utf8"),
  ticker: fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8"),
  live: fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker-live.js"), "utf8"),
};
const SERVED = { "/assets/js/flows-ticker-glance.js": "glance", "/assets/js/flows-ticker.js": "ticker", "/assets/js/flows-ticker-live.js": "live" };
const HTML = PAGES.tickerPage({ username: "test" });

const pxRow = (t, qt, v) => [t, qt, ...FIELDS.map((f) => (f in v ? v[f] : null))];

function makeRail(page) {
  const R = { page, ep: 9100, now: T0, lag: 800, sq: { px: 0, fl: 0, gx: 0 }, conns: [], px: S0 * 1.004, phase: RTH, tape: 8, tapeCalls: 0, quoteAge: 3000, errors: [], requests: [] };
  R.fresh = (k, lagMs) => RT.streamEntry({ k, readAt: R.now, vendorAt: R.now - lagMs, session: DAY, now: R.now, updatedAt: R.now });
  R.snapshot = (k, rows) => RT.frame(k, { ep: R.ep, sq: R.sq[k], at: R.now, snap: true, fresh: R.fresh(k, 800),
    meta: k === "px" ? { status: "ok", reason: null, rowDate: DAY, asked: rows.length, returned: rows.length, ahead: { n: 0, maxS: 0 }, off: 0, cols: RT.RT_ROW_FIELDS.px, missing: [], prevFill: null } : k === "gx" ? { cols: RT.RT_ROW_FIELDS.gx } : {}, rows });
  R.hello = (snaps) => RT.ctlFrame("hello", { ep: R.ep, at: R.now,
    meta: { transport: "ws", upstream: "rest", mode: "on", audience: "members", topics: ["px", "fl", "gx"], hbS: 5, cold: false, phase: "rth", session: DAY, f: T },
    rows: ["px", "fl", "gx"].map((k) => R.snapshot(k, snaps[k] || [])) });
  R.greet = (snaps) => { R.send(R.hello(snaps)); R.alive = true; R.keep = true; };
  R.delta = (k, rows, extra = {}, lagMs = 800) => RT.frame(k, { ep: R.ep, sq: ++R.sq[k], at: R.now, fresh: R.fresh(k, lagMs),
    meta: k === "px" ? { status: "ok", reason: null, rowDate: DAY, asked: rows.length, returned: rows.length, ahead: { n: 0, maxS: 0 }, off: 0 } : extra, rows });
  R.send = (f) => {
    const bad = RT.checkFrame(f);
    if (bad.length) throw new Error("the test rail built a frame the contract refuses: " + bad.join(","));
    R.conns[R.conns.length - 1].send(JSON.stringify(f));
  };
  R.quoteRow = (price, lagMs = 800) => pxRow(T, R.now - lagMs, { px: price, prev: S0, chg: price / S0 - 1, net: 1e6, lean: 0.2, iv30: 0.3, qa: 1 });
  R.tick = (price, lagMs = 800) => { R.px = price; R.lag = lagMs; R.send(R.delta("px", [R.quoteRow(price, lagMs)], {}, lagMs)); };
  R.tapeBody = () => {
    const t0 = easternInstant(DAY, 9 * 60 + 30), n = R.tape;
    const t = [], net = [], nd = [];
    for (let i = 0; i < n; i++) { t.push(iso(t0 + i * 300000)); net.push(Math.round(1e6 * Math.sin(i / 3) + i * 3e5)); nd.push(Math.round(4e4 * Math.cos(i / 4))); }
    return { ticker: T, session: DAY, prem: { status: "ok", t, net, nd, ncp: net.map((v) => v * 0.6), npp: net.map((v) => v * -0.4), readAt: iso(R.now) }, units: {} };
  };
  R.adv = async (ms, step = 5000) => {
    let left = ms;
    while (left > 0) {
      const d = Math.min(step, left);
      R.now += d;
      await page.clock.runFor(d);
      R.now = await page.evaluate(() => Date.now());
      if (R.alive && R.conns.length) R.send(RT.ctlFrame("hb", { ep: R.ep, at: R.now, meta: { upstream: "rest", topics: {} } }));
      if (R.alive && R.keep && R.conns.length) R.send(R.delta("px", [], {}, R.lag));
      await page.waitForTimeout(40);
      left -= d;
    }
    await page.waitForTimeout(60);
    R.now = await page.evaluate(() => Date.now());
  };
  R.until = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return true; await page.waitForTimeout(20); }
    return fn();
  };
  return R;
}

async function open(browser, vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: !!o.touch, isMobile: !!o.touch, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const R = makeRail(page);
  R.phase = o.closed ? CLOSED : RTH;
  if (o.closed) R.now = T_CLOSED;
  page.on("pageerror", (e) => R.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) R.errors.push(m.text()); });
  page.on("request", (q) => { const u = new URL(q.url()); R.requests.push(u.pathname); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    const which = SERVED[u.pathname];
    if (which) return route.fulfill({ contentType: "text/javascript", body: o[which] ? o[which](SRC[which]) : SRC[which] });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/now") {
      const quote = { status: "ok", ticker: T, price: R.px, prevClose: S0, open: S0, high: R.px + 0.5, low: S0 - 0.5, readAt: iso(R.now - R.quoteAge), tapeTime: iso(R.now - R.quoteAge - 800) };
      return route.fulfill({ contentType: "application/json", headers: { "X-Server-Now": String(R.now) }, body: JSON.stringify({ serverNow: R.now, expected: PREV, phase: R.phase,
        keys: { ["card:" + T]: { status: "ok", updatedAt: Date.parse(card.generatedAt), fresh: { readAt: card.generatedAt, class: "nightly" } } }, quote }) });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      let body = { status: "pending" };
      if (key === "card") body = card;
      else if (key === "card-x") body = cardX;
      else if (key === "hist") body = hist;
      else if (key === "summary") body = SUMMARY;
      else if (key === "meta") body = meta;
      else if (key === "tape") { R.tapeCalls++; body = o.closed ? { status: "pending" } : R.tapeBody(); }
      else if (key === "universe") body = u.searchParams.has("cols") ? projectUniverse(universe, projectionColumns(u.searchParams.get("cols"))) : universe;
      return route.fulfill({ contentType: "application/json", headers: { "X-Server-Now": String(R.now) }, body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off" } }) });
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => {
    R.conns.push({ send: (m) => ws.send(m), url: ws.url() });
    if (o.closed || o.railOff) ws.close({ code: 4011, reason: "off" });
  });
  await page.clock.install({ time: new Date(R.now) });
  await page.goto("https://example.test/flows/ticker/?t=" + T);
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name\u2026"; }, null, { timeout: 25000 });
  await page.waitForTimeout(200);
  return { ctx, page, R };
}

const PROBE = `(() => {
  window.__mut = { removed: 0, added: 0, attrs: 0, text: 0 };
  const host = document.getElementById("ftGlanceChart");
  const count = (ms) => { for (const m of ms) { if (m.type === "attributes") { window.__mut.attrs++; continue; } if (m.type === "characterData") { window.__mut.text++; continue; } for (const n of m.removedNodes) if (n.nodeType === 1) window.__mut.removed++; for (const n of m.addedNodes) if (n.nodeType === 1) window.__mut.added++; } };
  new MutationObserver(count).observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
  window.__cardMut = { removed: 0, all: 0 };
  new MutationObserver((ms) => { for (const m of ms) { window.__cardMut.all++; for (const n of m.removedNodes) if (n.nodeType === 1) window.__cardMut.removed++; } }).observe(document.getElementById("ftGlanceCards"), { childList: true, subtree: true, attributes: true, characterData: true });
  window.__ls = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls += e.value; }).observe({ type: "layout-shift", buffered: false }); } catch (e) { window.__ls = -1; }
  window.__ref = { svg: document.querySelector("#ftGlanceChart svg"), px: document.querySelector("#ftGlanceChart svg .ftg-px"), live: document.querySelector("#ftGlanceChart [data-live] .ftg-live-p"),
    cards: [...document.querySelectorAll(".ftg-card")], flowSvg: document.querySelector('.ftg-card[data-card="flow"] .ftg-cb svg'), flowLine: document.querySelector('.ftg-card[data-card="flow"] .ftg-fl.ftg-up') };
})()`;

const SNAP = `(() => {
  const q = (s) => document.querySelector(s);
  const dot = q("#ftGlanceChart .ftg-live-d");
  const svg = q("#ftGlanceChart svg");
  const lab = q("#ftGlanceChart .ftg-lv-spot.ftg-lt");
  const R = window.__ref || {};
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const shown = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
  const desc = svg && svg.getAttribute("aria-describedby") ? (document.getElementById(svg.getAttribute("aria-describedby")) || {}).textContent || "" : "";
  return {
    cx: dot ? +dot.getAttribute("cx") : null, cy: dot ? +dot.getAttribute("cy") : null,
    label: lab ? lab.textContent : null, today: (q("#ftGlanceChart .ftg-today-tx") || {}).textContent || null,
    todayX: q("#ftGlanceChart line.ftg-today") ? +q("#ftGlanceChart line.ftg-today").getAttribute("x1") : null,
    gx: shown(q("#ftGlanceChart .ftg-gx")) ? q("#ftGlanceChart .ftg-gx").textContent : null, gxSide: q("#ftGlanceChart .ftg-gx") ? q("#ftGlanceChart .ftg-gx").getAttribute("data-side") : null,
    gxTitle: q("#ftGlanceChart .ftg-gx") ? q("#ftGlanceChart .ftg-gx").getAttribute("title") : null,
    stamp: shown(q("#ftGlanceChart .ftg-live")) ? q("#ftGlanceChart .ftg-live").textContent : null,
    path: (q("#ftGlanceChart .ftg-live-p") || { getAttribute: () => null }).getAttribute("d"),
    anchor: !!q("#ftGlanceChart circle.ftg-dot.is-anchor"),
    desc,
    hero: q("#ftPxV") ? q("#ftPxV").dataset.value : null,
    pill: (() => { const b = document.getElementById("fxFresh"); return b ? { state: b.dataset.state, label: b.textContent.replace(/\\s+/g, " ").trim() } : null; })(),
    flowFig: (q('.ftg-card[data-card="flow"] .ftg-f') || {}).textContent || null,
    flowFoot: (q('.ftg-card[data-card="flow"] .ftg-foot') || {}).textContent || null,
    flowPts: (q('.ftg-card[data-card="flow"] .ftg-fl.ftg-up') || { getAttribute: () => null }).getAttribute("points"),
    sameSvg: svg === R.svg, samePx: q("#ftGlanceChart svg .ftg-px") === R.px, sameLive: !!R.live && q("#ftGlanceChart [data-live] .ftg-live-p") === R.live,
    sameCards: R.cards ? [...document.querySelectorAll(".ftg-card")].length === R.cards.length && [...document.querySelectorAll(".ftg-card")].every((c, i) => c === R.cards[i]) : null,
    sameFlowSvg: R.flowSvg ? q('.ftg-card[data-card="flow"] .ftg-cb svg') === R.flowSvg : null,
    sameFlowLine: R.flowLine ? q('.ftg-card[data-card="flow"] .ftg-fl.ftg-up') === R.flowLine : null,
    mut: window.__mut ? { ...window.__mut } : null, cardMut: window.__cardMut ? window.__cardMut.removed : null, cardAll: window.__cardMut ? window.__cardMut.all : null, ls: window.__ls,
    boxes: { host: box(q("#ftGlanceChart")), svg: box(svg), cards: box(q("#ftGlanceCards")), rail: box(q("#ftReadRail")) },
    svgWH: svg ? [+svg.getAttribute("width"), +svg.getAttribute("height")] : null,
    hasLive: !!q("#ftGlanceChart [data-live]"),
    anims: document.getAnimations().length,
    sw: document.documentElement.scrollWidth, iw: innerWidth,
  };
})()`;

const snap = (page) => page.evaluate(SNAP);
const expectY = (page, price, wh) => page.evaluate(({ card, cardX, price, wh }) => {
  const G = window.FlowsUI.tickerGlance;
  const m = G.model(card, "1M", { cardX, last: price });
  return G.model.layout(m, wh[0], wh[1]).y(price);
}, { card, cardX, price, wh });
const resetMut = (page) => page.evaluate(() => { window.__mut = { removed: 0, added: 0, attrs: 0, text: 0 }; window.__cardMut = { removed: 0, all: 0 }; });

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: page.viewportSize().width < 600 });
}

const SLOT = `(() => {
  const G = window.FlowsUI.tickerGlance, L = window.FlowsUI.tickerLive;
  const day = "2026-08-25";
  const O = window.FlowsUI.F.open(day);
  const at = (min) => Date.UTC(2026, 7, 25, 0, 0, 0) - 3 * 3600000 + (O + min) * 60000;
  const card = window.__card, S = card.panels.pricedMove.spot;
  const m = G.model(card, "1M", { last: S * 1.01 });
  const Ly = G.model.layout(m, 700, 340);
  const samples = [[at(0), 101], [at(1), 102], [at(389), 103], [at(390), 104]].map(([t, p]) => [t, S * p / 100]);
  const geo = L.model.geom(Ly, { px: S * 1.04, at: at(390), session: day }, samples, S);
  const mid = L.model.geom(Ly, { px: S * 1.01, at: at(195), session: day }, [], S);
  return { x0: Ly.XT, x1: Ly.xf(1), d: geo.d, x: geo.x, midX: mid.x, y0: geo.y0, yS: Ly.y(S) };
})()`;

async function live(browser, o = {}) {
  const { ctx, page, R } = await open(browser, { width: 1440, height: 820 }, o);
  const r = {};
  await page.evaluate((c) => { window.__card = c; }, card);
  const pre = await snap(page);
  r.closedFirst = !pre.hasLive && !pre.stamp && !pre.anchor;
  await R.until(() => R.conns.length >= 1, 20000);
  const u = R.conns.length ? new URL(R.conns[0].url) : null;
  r.topics = !!u && u.searchParams.get("k") === "px,fl,gx" && u.searchParams.get("f") === T;
  if (!R.conns.length) throw new Error("the ticker opened no rail socket");
  const gxRow = (v, lag = 1) => [T, R.now - 1000, S0, v, 3e6, 1e6, 1, lag];
  const reqAt = R.requests.length;
  R.greet({ px: [R.quoteRow(S0 * 1.004)], gx: [gxRow(36.2e6)] });
  await R.adv(100, 100);
  await R.adv(5000);
  await page.waitForFunction(() => document.querySelector("#ftGlanceChart [data-live]") !== null, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(PROBE);
  const s0 = await snap(page);
  if (process.env.LIVE_DEBUG) console.log("s0", JSON.stringify({ ...s0, desc: s0.desc.slice(0, 200) }));
  r.liveLayer = s0.hasLive;
  r.todayFixed = pre.todayX !== null && s0.todayX === pre.todayX;
  r.labelLast = !!s0.label && /^Last \d/.test(s0.label);
  r.stampShown = !!s0.stamp && /^Last \d+\.\d\d \u00b7 \d\d:\d\d TRT$/.test(s0.stamp);
  r.todayDate = s0.today === "Aug 25";
  r.anchor = s0.anchor;
  r.gxLine = s0.gx === "Dealer \u03b3 now +$36.2M per 1%" && s0.gxSide === "long" && /dealers long calls, short puts/.test(s0.gxTitle || "");
  r.describedLive = /Live: the last price is \d/.test(s0.desc) && /Live dealer gamma is \+\$36\.2M per 1%, the open-interest book on the vendor's convention \(dealers long calls, short puts\)/.test(s0.desc);
  const slot = await page.evaluate(SLOT);
  r.slotGeom = Math.abs(slot.x - slot.x1) < 0.06 && slot.d.split("M").filter(Boolean).length === 2 && Math.abs(+slot.d.slice(1).split(/[,L]/)[0] - slot.x0) < 0.06 && Math.abs(slot.midX - (slot.x0 + slot.x1) / 2) < 0.06 && Math.abs(slot.y0 - slot.yS) < 0.06;
  await shot(page, "live-0");

  const ys = [];
  const prices = [1.006, 1.008, 1.0105, 1.0075, 1.011, 1.0135].map((k) => S0 * k);
  r.dotY = true; r.heroFollows = true; r.labelFollows = true;
  for (const p of prices) {
    await R.adv(5000);
    R.tick(p);
    await R.adv(200, 100);
    await R.adv(0);
    const s = await snap(page);
    const want = await expectY(page, p, s.svgWH);
    ys.push(s.cy);
    if (s.cy === null || Math.abs(s.cy - want) > 0.6) r.dotY = false;
    if (s.hero !== px2(p)) r.heroFollows = false;
    if (s.label !== "Last " + px2(p)) r.labelFollows = false;
  }
  r.dotMoved = new Set(ys).size >= 4;
  r.dotDirection = ys[1] < ys[0] && ys[3] > ys[2];
  await page.waitForFunction(() => { const b = document.getElementById("fxFresh"); return b && b.dataset.state === "live" && /behind the vendor/.test(b.textContent); }, null, { timeout: 4000, polling: 100 }).catch(() => {});
  const s1 = await snap(page);
  r.pillText = JSON.stringify(s1.pill);
  const segs = (p) => ((p || "").match(/[ML]/g) || []).length;
  r.pathGrows = segs(s1.path) > segs(s0.path);
  r.slot = s1.cx !== null && s0.cx !== null && s1.cx >= s0.cx - 0.01 && s1.cx > s1.todayX && s1.todayX === pre.todayX;
  r.sameSvg = s1.sameSvg && s1.samePx && s1.sameLive;
  r.noRemoval = s1.mut.removed === 0;
  r.noShift = s1.ls >= 0 && s1.ls < 0.001 && JSON.stringify(s1.boxes) === JSON.stringify(s0.boxes);
  r.cardsKept = s1.sameCards === true && s1.cardMut === 0;
  r.stampFollows = !!s1.stamp && s1.stamp.startsWith("Last " + px2(prices[prices.length - 1]));
  r.pill = !!s1.pill && s1.pill.state === "live" && /Live\s*\u00b7\s*0\.8 s behind the vendor/.test(s1.pill.label) && !/null|NaN/.test(s1.pill.label);
  await shot(page, "live-1");

  await resetMut(page);
  await R.adv(6000, 2000);
  const rest = await snap(page);
  r.census = rest.mut.removed + rest.mut.added + rest.mut.attrs + rest.mut.text === 0 && rest.cardAll === 0 && rest.hasLive;

  R.send(R.delta("gx", [gxRow(41.7e6, 2)]));
  await R.adv(200, 100);
  const sg = await snap(page);
  r.gxPatched = sg.gx === "Dealer \u03b3 now +$41.7M per 1%" && sg.sameSvg && sg.mut.removed === 0 && /read 2 s after the vendor stamped it/.test(sg.gxTitle || "");
  R.send(R.delta("gx", [gxRow(-8.4e6, 2)]));
  await R.adv(200, 100);
  const sg2 = await snap(page);
  r.gxShort = sg2.gx === "Dealer \u03b3 now " + MINUS + "$8.40M per 1%" && sg2.gxSide === "short";

  const rowsFl = [{ id: "a1", ts: R.now, t: T, prem: 2.5e6 }, { id: "a2", ts: R.now, t: T, prem: 1.5e6 }, { id: "a3", ts: R.now, t: "MSFT", prem: 9e6 }];
  R.send(R.delta("fl", rowsFl, { cursor: "c1", dropped: 0, truncated: false }));
  await R.adv(200, 100);
  const sf = await snap(page);
  if (process.env.LIVE_DEBUG) console.log("sf", sf.flowFoot);
  r.flagged = /flagged 2 \$4\.00M$/.test(sf.flowFoot || "") && sf.sameFlowSvg === true && sf.sameCards === true && sf.cardMut === 0;

  const flowBefore = sf.flowPts, calls = R.tapeCalls;
  R.tape = 14;
  for (let i = 0; i < 12 && R.tapeCalls === calls; i++) { await R.adv(10000, 10000); R.tick(prices[prices.length - 1]); }
  await page.waitForFunction((before) => { const n = document.querySelector('.ftg-card[data-card="flow"] .ftg-fl.ftg-up'); return n && n.getAttribute("points") !== before; }, flowBefore, { timeout: 4000, polling: 100 }).catch(() => {});
  await R.adv(500, 100);
  const st = await snap(page);
  if (process.env.LIVE_DEBUG) console.log("st", JSON.stringify({ flowPts: st.flowPts, flowBefore, sameFlowSvg: st.sameFlowSvg, sameFlowLine: st.sameFlowLine, sameCards: st.sameCards, cardMut: st.cardMut, sameSvg: st.sameSvg, samePx: st.samePx, mut: st.mut }));
  r.tapeFetched = R.tapeCalls > calls;
  r.tapeFlowOnly = st.flowPts !== flowBefore && st.sameFlowSvg === true && st.sameFlowLine === true && st.sameCards === true && st.cardMut === 0 && st.sameSvg && st.samePx && st.mut.removed === 0;
  r.tapeKeepsFlagged = /flagged 2 \$4\.00M$/.test(st.flowFoot || "");
  await shot(page, "live-2");

  const dom = await page.evaluate(({ card, cardX }) => { const m = window.FlowsUI.tickerGlance.model(card, "1M", { cardX }); return [m.y0, m.y1]; }, { card, cardX });
  const out = dom[1] + (dom[1] - dom[0]) * 0.12;
  R.tick(out);
  await R.adv(200, 100);
  await R.adv(5000);
  R.tick(out);
  await R.adv(200, 100);
  const sx = await snap(page);
  r.domainRepaint = !sx.sameSvg && sx.hasLive && sx.label === "Last " + px2(out) && sx.cy !== null && sx.cy >= 0 && sx.cy <= sx.svgWH[1];
  const exp = await expectY(page, out, sx.svgWH);
  r.domainDot = sx.cy !== null && Math.abs(sx.cy - exp) < 0.6;
  await page.evaluate(() => { window.__ref.svg = document.querySelector("#ftGlanceChart svg"); window.__mut.removed = 0; });
  await R.adv(5000);
  R.tick(out - (dom[1] - dom[0]) * 0.01);
  await R.adv(200, 100);
  const sy = await snap(page);
  r.afterRepaintInPlace = sy.sameSvg && sy.mut.removed === 0;
  await shot(page, "live-3");

  R.keep = false;
  await R.adv(5000);
  R.tick(out, 40000);
  await R.adv(200, 100);
  const sl = await snap(page);
  r.staleDraws = !sl.hasLive && !sl.anchor && sl.stamp === null && /^Spot /.test(sl.label || "") && sl.cy === null;
  r.staleSays = /No live price is drawn: the streamed quote is not live, it is behind the vendor\./.test(sl.desc) && !/Live: the last price/.test(sl.desc);
  r.stalePill = !!sl.pill && !/behind the vendor/.test(sl.pill.label);
  await R.adv(5000);
  R.tick(prices[0]);
  R.keep = true;
  await R.adv(200, 100);
  const sb = await snap(page);
  r.liveAgain = sb.hasLive && sb.label === "Last " + px2(prices[0]);
  R.keep = false;
  await R.adv(30000, 5000);
  const sq = await snap(page);
  r.silentGoesQuiet = !sq.hasLive && /No live price is drawn: the streamed quote is/.test(sq.desc) && sq.stamp === null;
  R.tick(prices[1]);
  await R.adv(200, 100);

  const fetched = R.requests.slice(reqAt);
  const api = [...new Set(fetched.filter((p) => p.startsWith("/api/")))].sort();
  r.noNewRequest = api.every((p) => p === "/api/flows/now" || p === "/api/flows/tape" || p === "/api/rt/ws") && fetched.filter((p) => p === "/assets/js/flows-ticker-live.js").length <= 1
    && R.requests.filter((p) => p === "/assets/js/flows-ticker-live.js").length === 1;
  r.requestList = api.join(",");

  R.phase = POST;
  R.quoteAge = 5 * 60 * 1000;
  await R.adv(40000, 10000);
  const sc = await snap(page);
  r.closesBack = !sc.hasLive && /^Spot /.test(sc.label || "") && sc.stamp === null && !sc.anchor && sc.gx === null;
  r.errors = R.errors.length === 0;
  r.errorText = R.errors.slice(0, 3).join(" | ");
  await ctx.close();
  return r;
}

const browser = await chromium.launch();

const base = await live(browser);
const expectAll = [
  ["closedFirst", "the chart opens in its closed look"], ["topics", "the ticker connects px, fl and gx for its own name"], ["liveLayer", "the live layer is on the chart once the market is open"],
  ["todayFixed", "the today marker stays where it was"], ["labelLast", "the right-edge label reads Last"], ["stampShown", "the legend row prints the last price with its TRT time"],
  ["todayDate", "the x axis today reads the live session date"], ["anchor", "the card close dot becomes a hollow anchor"], ["gxLine", "the gx topic prints a separately labelled dealer gamma line with the vendor's convention"],
  ["describedLive", "the description carries the live price and the live dealer gamma with the convention clause"], ["slotGeom", "the session's TRT minutes map open to close across the today slot, a gap breaks the path, the connector starts at the card close"],
  ["dotY", "the live dot sits at the model's y for each price"], ["heroFollows", "the hero price follows every tick"], ["labelFollows", "the Last label follows every tick"], ["dotMoved", "the dot moved"], ["dotDirection", "up is up and down is down"],
  ["pathGrows", "the intraday path gains points"], ["slot", "the dot stays in the today slot"], ["sameSvg", "the same svg and the same path elements persist across the ticks"], ["noRemoval", "no element is removed from the chart across the ticks"],
  ["noShift", "no layout shift and no host moved"], ["cardsKept", "no card element is replaced"], ["stampFollows", "the stamp follows the tick"], ["pill", "the pill says Live with the lag behind the vendor"],
  ["census", "at rest nothing in the chart or the cards is written"], ["gxPatched", "a gx tick patches the live line in place"], ["gxShort", "a negative gx reads short"], ["flagged", "fl rows for this name add a flagged count to the Flow card in place"],
  ["tapeFetched", "the session flow was re-read"], ["tapeFlowOnly", "a session flow refresh changes only the Flow card, in place"], ["tapeKeepsFlagged", "and keeps the flagged count"],
  ["domainRepaint", "a price outside the y domain repaints once and keeps the live layer"], ["domainDot", "with the dot at the new scale"], ["afterRepaintInPlace", "and the next tick is in place again"],
  ["staleDraws", "a frame that is not live draws nothing live and no zero"], ["staleSays", "and the description says why"], ["stalePill", "and the pill drops the lag"], ["liveAgain", "a live frame brings the layer back"],
  ["silentGoesQuiet", "a feed that falls silent stops drawing at the end of its live window"], ["noNewRequest", "no request but the heartbeat, the session flow and the one chunk"],
  ["closesBack", "when the session closes the chart returns to its closed look"], ["errors", "no page error"],
];
if (process.env.LIVE_DEBUG) console.log(JSON.stringify(base, null, 1));
const failed = expectAll.filter(([k]) => base[k] !== true).map(([k, m]) => `${m} (${k})`);
ok(failed.length === 0, "the live scenario fails: " + failed.join("; ") + (base.errorText ? " :: " + base.errorText : "") + " [api " + base.requestList + "] [pill " + base.pillText + "]");
for (const [k] of expectAll) ok(base[k] === true, k);

{
  const { ctx, page, R } = await open(browser, { width: 1440, height: 820 }, { reduced: true });
  await R.until(() => R.conns.length >= 1, 20000);
  R.greet({ px: [R.quoteRow(S0 * 1.004)] });
  await R.adv(100, 100);
  await R.adv(5000);
  await page.waitForFunction(() => document.querySelector("#ftGlanceChart [data-live]") !== null, null, { timeout: 8000 }).catch(() => {});
  await R.adv(5000);
  R.tick(S0 * 1.009);
  await R.adv(200, 100);
  const s = await snap(page);
  ok(s.hasLive && s.label === "Last " + px2(S0 * 1.009), `reduced motion still draws the live price (${s.label})`);
  eq(s.anims, 0, "reduced motion: no animation runs on the page with the live layer drawn");
  ok(R.errors.length === 0, `reduced motion: no page error (${R.errors.join(" | ")})`);
  await ctx.close();
}

{
  const { ctx, page, R } = await open(browser, { width: 1440, height: 820 }, { railOff: true });
  await R.adv(25000, 5000);
  await page.waitForFunction(() => !!window.FlowsUI.tickerLive, null, { timeout: 8000 }).catch(() => {});
  await R.adv(1000, 500);
  const s = await snap(page);
  ok(!s.hasLive && !s.anchor && s.stamp === null && /^Spot /.test(s.label || ""), `with no rail in the session nothing live is drawn (${s.label})`);
  ok(/No live price is drawn: no streamed quote for AAPL has arrived\./.test(s.desc), `and the description says the streamed quote never arrived (${s.desc.slice(-160)})`);
  ok(!/\b0\.00\b/.test(s.stamp || "") && s.cy === null, "and no zero stands in for the absent price");
  ok(R.errors.length === 0, `no rail: no page error (${R.errors.join(" | ")})`);
  await ctx.close();
}

for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 700 }]) {
  const { ctx, page, R } = await open(browser, vp, { touch: true });
  await R.until(() => R.conns.length >= 1, 20000);
  R.greet({ px: [R.quoteRow(S0 * 1.004)] });
  await R.adv(100, 100);
  await R.adv(5000);
  await page.waitForFunction(() => document.querySelector("#ftGlanceChart [data-live]") !== null, null, { timeout: 8000 }).catch(() => {});
  await R.adv(5000);
  R.tick(S0 * 1.007);
  await R.adv(200, 100);
  const s = await snap(page);
  ok(s.hasLive && s.cy !== null && s.cy >= 0 && s.cy <= s.svgWH[1] && s.cx <= s.svgWH[0], `${vp.width}: the live dot is drawn inside the chart (${s.cx},${s.cy} in ${s.svgWH})`);
  ok(!!s.stamp && s.stamp.startsWith("Last " + px2(S0 * 1.007)), `${vp.width}: the stamp is shown (${s.stamp})`);
  ok(s.sw <= s.iw, `${vp.width}: no sideways scroll (${s.sw} > ${s.iw})`);
  ok(!/behind the vendor/.test((s.pill || {}).label || "") || (await page.evaluate(() => { const n = document.querySelector("#fxFresh .fx-fresh-lag"); return !n || !n.getClientRects().length; })), `${vp.width}: the pill's lag is not shown on a narrow screen`);
  await shot(page, "live-" + vp.width);
  ok(R.errors.length === 0, `${vp.width}: no page error (${R.errors.join(" | ")})`);
  await ctx.close();
}

async function closedLook(vp, label) {
  const { ctx, page, R } = await open(browser, vp, { closed: true, touch: vp.width < 600 });
  await R.adv(2000, 1000);
  const r = await page.evaluate(() => ({
    live: !!document.querySelector("#ftGlanceChart [data-live]"), gx: !!document.querySelector("#ftGlanceChart .ftg-gx"), anchor: !!document.querySelector("#ftGlanceChart .is-anchor"),
    spot: (document.querySelector("#ftGlanceChart .ftg-lv-spot.ftg-lt") || {}).textContent || null, stamp: !!document.querySelector("#ftGlanceChart .ftg-live"),
    lag: !!document.querySelector("#fxFresh .fx-fresh-lag") || /null/.test(document.getElementById("fxFresh").textContent),
    sw: document.documentElement.scrollWidth, iw: innerWidth, loaded: !!window.FlowsUI.tickerLive,
  }));
  const spotOk = vp.width < 600 ? r.spot === null : /^Spot /.test(r.spot || "");
  ok(!r.live && !r.gx && !r.anchor && !r.stamp && !r.lag && spotOk, `${label}: the closed market draws no live element (${JSON.stringify(r)})`);
  ok(!r.loaded && !R.requests.includes("/assets/js/flows-ticker-live.js"), `${label}: a closed market never fetches the live chunk`);
  ok(r.sw <= r.iw, `${label}: no sideways scroll`);
  await shot(page, "closed-" + label);
  ok(R.errors.length === 0, `${label}: no page error (${R.errors.join(" | ")})`);
  await ctx.close();
}
await closedLook({ width: 1440, height: 820 }, "1440");
await closedLook({ width: 390, height: 844 }, "390");

if (!process.env.LIVE_BASE_ONLY) {
  const MUTANTS = [
    ["the chunk ignores the live quote", { live: (s) => s.replace("      S.live = n.live;\n", "      S.live = null;\n") }, ["liveLayer", "dotMoved", "dotY", "labelFollows"]],
    ["every tick rebuilds the whole svg", { live: (s) => s.replace("if (S.live) patch(kit);", "if (S.live) kit.paintChart();") }, ["sameSvg", "noRemoval"]],
    ["a session flow refresh repaints the whole glance", { live: (s) => s.replace('const tape = "tape" in next && next.tape !== st.x.tape;', 'if ("tape" in next && next.tape !== st.x.tape) return false; const tape = false;') }, ["tapeFlowOnly"]],
    ["the right-edge label stays on Spot", { glance: (s) => s.replace('text: (m.last ? "Last " : "Spot ") + F.px(m.last || m.S), px: m.last || m.S', 'text: "Spot " + F.px(m.S), px: m.S') }, ["labelFollows", "labelLast"]],
    ["the pill never learns the lag", { live: (s) => s.replace("S.lag = read !== null &&", "S.lag = null && read !== null &&") }, ["pill"]],
    ["gx and fl are never subscribed", { ticker: (s) => s.replace('topics: ["px", "fl", "gx"]', 'topics: ["px"]') }, ["topics", "gxLine", "flagged"]],
    ["a quote that is not live is still drawn", { live: (s) => s.replace('if (st !== "live") return', 'if (st === "never") return') }, ["staleDraws", "staleSays"]],
    ["the intraday path spreads the session over a whole day", { live: (s) => s.replace("clamp((a - o) / SESSION_MIN, 0, 1)", "clamp((a - o) / 1440, 0, 1)") }, ["slotGeom"]],
  ];
  for (const [name, o, keys] of MUTANTS) {
    const which = Object.keys(o)[0];
    ok(o[which](SRC[which]) !== SRC[which], `the planted build "${name}" changes the served source`);
    let r;
    try { r = await live(browser, o); } catch (e) { r = { threw: String(e) }; }
    for (const k of keys) ok(r[k] !== true, `the planted build "${name}" fails ${k}`);
  }
}

await browser.close();
console.log(`flows-glance-live-render: ${checks} checks passed`);
