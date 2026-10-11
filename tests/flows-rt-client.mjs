import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";
import * as RT from "../shared/flows-rt.js";
import { STRIP_FIELDS } from "../shared/flows-live.js";
import { easternInstant } from "../shared/flows-freshness.js";
import { createHub } from "../shared/flows-rt-hub.js";
import { createFakeVendor, fetchFor } from "./rt-fixtures.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const DAY = "2026-09-29";
const PREV = "2026-09-28";
const T0 = easternInstant(DAY, 10 * 60 + 30);
const T1 = T0 + 5000;
const TOPICS = RT.RT_TOPIC_KEYS;
const FIELDS = STRIP_FIELDS.map(([n]) => n);
const iso = (ms) => new Date(ms).toISOString();
const RTH = { phase: "rth", session: DAY, trading: true, lastClosed: PREV, endsAt: iso(easternInstant(DAY, 16 * 60)) };

const INSTRUMENT = `
(() => {
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  window.__setHidden = (v) => { hidden = v; document.dispatchEvent(new Event("visibilitychange")); };
  Math.random = () => 0.5;
  const mine = () => /flows-rt\\.js/.test(new Error().stack || "");
  const live = new Set();
  const rafs = new Set();
  window.__rtTimers = live;
  window.__rtRafs = rafs;
  window.__rafMs = [];
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window);
  window.setTimeout = function (fn, ms, ...a) {
    const own = mine();
    const id = st(function (...args) { live.delete(id); return typeof fn === "function" ? fn.apply(this, args) : undefined; }, ms, ...a);
    if (own) live.add(id);
    return id;
  };
  window.clearTimeout = function (id) { live.delete(id); return ct(id); };
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = function (fn) {
    const own = mine();
    const id = raf(function (t) {
      rafs.delete(id);
      const t0 = performance.now();
      const r = fn(t);
      if (own) window.__rafMs.push(performance.now() - t0);
      return r;
    });
    if (own) rafs.add(id);
    return id;
  };
  window.cancelAnimationFrame = function (id) { rafs.delete(id); return caf(id); };
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const ev = window.__rtListeners = {};
  const key = (t, ty) => (t === document ? "document:" : t === window ? "window:" : null) && (t === document ? "document:" : "window:") + ty;
  const seen = new WeakMap();
  EventTarget.prototype.addEventListener = function (ty, fn, o) {
    const k = key(this, ty);
    if (k && /visibilitychange|pagehide|pageshow/.test(ty) && mine()) {
      const set = seen.get(this) || new Set();
      seen.set(this, set);
      if (!set.has(ty + fn)) { set.add(ty + fn); ev[k] = (ev[k] || 0) + 1; }
    }
    return add.call(this, ty, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (ty, fn, o) {
    const k = key(this, ty);
    const set = seen.get(this);
    if (k && set && set.has(ty + fn)) { set.delete(ty + fn); ev[k] = (ev[k] || 0) - 1; }
    return rem.call(this, ty, fn, o);
  };
  window.__html = [];
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(Element.prototype, "innerHTML", { configurable: true, get: desc.get, set(v) { window.__html.push(String(v)); return desc.set.call(this, v); } });
  const outer = Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML");
  Object.defineProperty(Element.prototype, "outerHTML", { configurable: true, get: outer.get, set(v) { window.__html.push(String(v)); return outer.set.call(this, v); } });
  const iah = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (p, v) { window.__html.push(String(v)); return iah.call(this, p, v); };
  const dw = Document.prototype.write;
  Document.prototype.write = function (...a) { window.__html.push(a.join("")); return dw.apply(this, a); };
  window.__drops = [];
  window.__wrapDrop = () => {
    const f = window.FlowsUI && window.FlowsUI.freshness;
    if (!f || f.__wrapped) return;
    const orig = f.drop;
    f.drop = (s) => { window.__drops.push(s); return orig(s); };
    f.__wrapped = true;
  };
})();
`;

const fresh = (klass, state, reason, readAt, staleAt, session = DAY, cadence = 900) => ({
  "X-Fresh-State": state, "X-Fresh-Reason": reason, "X-Fresh-Class": klass, "X-Fresh-Read-At": iso(readAt), "X-Fresh-Source": "actions",
  "X-Fresh-Cadence": String(cadence), "X-Fresh-Session": session, "X-Fresh-Live-Until": iso(readAt + 1200000), "X-Fresh-Stale-At": iso(staleAt),
  "X-Fresh-Phase": "rth", "X-Fresh-Phase-Ends": RTH.endsAt,
});

const pxRow = (t, qt, v = {}) => [t, qt, ...FIELDS.map((f) => (f in v ? v[f] : null))];
const chgOf = (px, prev) => Math.round((px / prev - 1) * 1e6) / 1e6;
const quote = (t, px, prev, qt, extra = {}) => pxRow(t, qt, { px, prev, chg: chgOf(px, prev), net: 1e6, lean: 0.2, iv30: 0.3, qa: 1, ...extra });

function makeRail(page, { ep = 7000 } = {}) {
  const R = {
    page, ep, now: T1, sq: { px: 0, fl: 0, gx: 0, mk: 0, nw: 0 }, conns: [], mode: "open", onConn: null,
    snap: { status: 200, frames: () => [], headers: {} }, snapHits: [], waited: 0,
  };
  R.fresh = (k, lagMs = 1000, over = {}) => RT.streamEntry({ k, readAt: R.now, vendorAt: R.now - lagMs, session: DAY, now: R.now, updatedAt: R.now, ...over });
  R.meta = (k, rows, extra = {}) => {
    if (k === "px") return { status: "ok", reason: null, rowDate: DAY, asked: rows.length, returned: rows.length, ahead: { n: 0, maxS: 0 }, off: 0, ...extra };
    return extra;
  };
  R.snapshot = (k, rows, o = {}) => {
    const meta = k === "px" ? { ...R.meta(k, rows), cols: RT.RT_ROW_FIELDS.px, missing: [], prevFill: null, ...o.meta }
      : k === "gx" ? { cols: RT.RT_ROW_FIELDS.gx, ...o.meta } : { ...o.meta };
    return RT.frame(k, { ep: o.ep ?? R.ep, sq: o.sq ?? R.sq[k], at: R.now, snap: true, fresh: o.fresh === null ? undefined : (o.fresh || R.fresh(k, o.lag ?? 1000)), meta, rows });
  };
  R.delta = (k, rows, o = {}) => {
    const sq = o.sq ?? ++R.sq[k];
    if (o.sq !== undefined) R.sq[k] = Math.max(R.sq[k], o.sq);
    return RT.frame(k, { ep: o.ep ?? R.ep, sq, at: R.now, fresh: R.fresh(k, o.lag ?? 1000), meta: { ...R.meta(k, rows), ...o.meta }, rows });
  };
  R.hello = (topics = TOPICS, snaps = {}, o = {}) => RT.ctlFrame("hello", {
    ep: o.ep ?? R.ep, at: R.now,
    meta: { transport: "ws", upstream: "rest", mode: "on", audience: "owner", topics, hbS: 5, cold: false, phase: "rth", session: DAY, f: null },
    rows: topics.map((k) => R.snapshot(k, snaps[k] || [], { lag: o.lag })),
  });
  R.ctl = (t, meta = {}, o = {}) => RT.ctlFrame(t, { ep: o.ep ?? R.ep, at: R.now, meta });
  R.send = (conn, f, { clean = true } = {}) => {
    if (clean) {
      const bad = RT.checkFrame(f);
      if (bad.length) throw new Error("the test rail built a frame the contract refuses: " + bad.join(","));
    }
    conn.ws.send(JSON.stringify(f));
  };
  R.last = () => R.conns[R.conns.length - 1];
  R.messages = (conn = R.last()) => conn.received.map((m) => JSON.parse(m));
  R.until = async (fn, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return true; await page.waitForTimeout(15); }
    return fn();
  };
  R.nextConn = async (n = 1) => { await R.until(() => R.conns.length >= n); return R.conns[n - 1]; };
  R.pump = async (ms = 40) => { await page.waitForTimeout(40); await page.clock.runFor(ms); await page.waitForTimeout(30); };
  R.alive = async (ms, step = 4000, topics = []) => {
    let left = ms;
    while (left > 0) {
      const d = Math.min(step, left);
      R.send(R.last(), R.ctl("hb", { upstream: "up", phase: "rth", sockets: 1, degraded: null, topics: {} }));
      for (const k of topics) R.send(R.last(), R.delta(k, []));
      await R.adv(d, d);
      left -= d;
    }
  };
  R.adv = async (ms, step = 1000) => {
    let left = ms;
    while (left > 0) {
      const d = Math.min(step, left);
      R.now += d;
      await page.clock.runFor(d);
      await page.waitForTimeout(25);
      left -= d;
    }
    await page.waitForTimeout(40);
  };
  return R;
}

async function mount(browser, { html, url = "/flows/", answer = null, reduced = false, viewport = { width: 1280, height: 900 }, rail = true, setup = null, fake = true } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const R = makeRail(page);
  const asked = [];
  page.asked = asked;
  page.errors = errors;
  R.page = page;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/rt/snap") {
      R.snapHits.push({ at: R.now, k: u.searchParams.get("k"), f: u.searchParams.get("f") });
      const s = R.snap;
      if (s.status !== 200) {
        return route.fulfill({ status: s.status, contentType: "application/json", headers: s.headers || {}, body: JSON.stringify({ error: { code: "x", message: "x" } }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store", ...(s.headers || {}) }, body: JSON.stringify(s.frames()) });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      asked.push({ key, at: R.now });
      const got = answer ? answer(key, u, R) : null;
      const a = got || { body: { status: "pending" } };
      return route.fulfill({ status: a.status || 200, contentType: "application/json", headers: { "X-Server-Now": String(R.now), ...(a.headers || {}) }, body: JSON.stringify(a.body) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  if (rail) {
    await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => {
      const conn = { ws, url: ws.url(), received: [], closed: null, at: R.now };
      R.conns.push(conn);
      ws.onMessage((m) => { conn.received.push(String(m)); if (conn.onMessage) conn.onMessage(String(m)); });
      ws.onClose((code, reason) => { conn.closed = { code, reason }; if (conn.onClose) conn.onClose(); });
      if (R.mode === "refuse") ws.close({ code: 1011, reason: "refused" });
      else if (R.onConn) R.onConn(conn);
    });
  }
  R.fake = fake;
  if (fake) await page.clock.install({ time: new Date(T0) });
  await page.addInitScript(INSTRUMENT);
  if (setup) await setup(R, page);
  await page.goto("https://example.test" + url);
  await page.waitForTimeout(120);
  if (fake) await page.clock.pauseAt(new Date(T1));
  await page.waitForTimeout(40);
  return { ctx, page, R };
}

const coreHtml = () => PAGES.flowsDocument({
  title: "Rail", description: "x", active: "ticker", username: "test", chrome: false, body: '<div id="rtHost"></div>',
  scripts: ["/assets/js/flows-fresh.js", "/assets/js/flows-rt.js"],
});

async function connect(page, opts, tag = "h") {
  await page.evaluate(({ opts, tag }) => {
    window.__ch = window.__ch || [];
    window.__wrapDrop();
    const h = window.FlowsUI.rt.connect(opts);
    window["__" + tag] = h;
    for (const k of opts.topics || ["px", "fl", "gx", "mk", "nw"]) h.on(k, (c) => window.__ch.push({ k: c.k, snap: c.snap, reset: c.reset, ids: c.ids.slice(), rows: c.rows.length }));
    return !!h;
  }, { opts, tag });
}

const rt = (page, expr) => page.evaluate(new Function("return (" + expr + ")"));
const strips = (page) => rt(page, "window.FlowsUI.rt.strips()");
const status = (page) => rt(page, "window.FlowsUI.rt.status()");
const measure = (page) => rt(page, "window.FlowsUI.rt.measure()");
const transport = (page) => rt(page, "window.FlowsUI.rt.transport()");
const landed = async (page, R, want, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await transport(page)) === want) return want;
    await R.pump();
  }
  return transport(page);
};
const pill = (page) => page.evaluate(() => { const b = document.getElementById("fxFresh"); return b ? { state: b.dataset.state, label: b.dataset.label, feed: b.dataset.feed || "" } : null; });
const facts = (page) => page.evaluate(() => Object.fromEntries(window.FlowsUI.freshness.details().facts.filter(([, v]) => v !== null && v !== undefined)));

function rigHub(page, R, { roster = async () => null } = {}) {
  const clock = { t: R.now };
  const vendor = createFakeVendor({ session: DAY, clock: () => clock.t });
  const socks = [];
  const hub = createHub({
    env: { FLOWS_RT_MODE: "on", UW_API_KEY: "k", UW_BASE: "http://uw.test" },
    now: () => clock.t, fetchImpl: fetchFor(vendor), random: () => 0.5, log: () => {},
    host: { sockets: () => socks.filter((x) => x.readyState === 1), wake() {} }, loadRoster: roster,
  });
  const lose = { px: 0, skip: new Set() };
  R.onConn = (conn) => {
    const sock = {
      readyState: 1, att: null, sentFrames: 0,
      send(text) {
        const f = JSON.parse(text);
        if (f.k === "px" && !f.snap && lose.skip.has(f.sq)) { lose.px++; return; }
        sock.sentFrames++;
        conn.ws.send(text);
      },
      close(code, reason) { sock.readyState = 3; conn.ws.close({ code, reason }); },
      serializeAttachment(a) { sock.att = JSON.parse(JSON.stringify(a)); },
      deserializeAttachment() { return sock.att; },
    };
    socks.push(sock);
    const u = new URL(conn.url);
    conn.sock = sock;
    conn.onMessage = (m) => hub.onMessage(sock, m);
    conn.onClose = () => { sock.readyState = 3; hub.onClose(sock); };
    hub.admit(sock, { u: "anilkaya", exp: Date.now() + 3600e3, topics: u.searchParams.get("k").split(","), f: u.searchParams.get("f") || null });
  };
  const step = async (n, ms = 1000) => {
    for (let i = 0; i < n; i++) {
      await hub.tick();
      clock.t += ms;
      R.now = clock.t;
      if (R.fake) await page.clock.runFor(ms);
      await page.waitForTimeout(R.fake ? 12 : 30);
    }
    await page.waitForTimeout(40);
  };
  const same = async () => {
    const held = new Map();
    for (const [t, h] of hub.topics.px.state.rows) held.set(t, h.value.slice(2, -1));
    const got = await strips(page);
    const mine = new Map(Object.entries(got ? got.rows : {}).map(([t, v]) => [t, v.slice(0, -1)]));
    return { held, mine };
  };
  return { clock, vendor, socks, hub, lose, step, same };
}

const want = (name) => !process.env.RT_ONLY || new RegExp(process.env.RT_ONLY).test(name);
const browser = await chromium.launch();
try {
  if (want("merge")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    eq(await rt(page, "typeof window.FlowsUI.rt"), "object", "FlowsUI.rt is attached to the allowlisted global, no new global");
    deep(await rt(page, "Object.keys(window.FlowsUI.rt).sort()"),
      ["alerts", "connect", "feeds", "fresh", "gex", "market", "measure", "news", "on", "quote", "status", "strips", "transport"],
      "and offers connect, on and transport with the adapters the pages read");
    eq(await transport(page), "off", "before any page asks for a topic the rail is off and nothing is opened");
    eq(R.conns.length, 0, "no socket without a connect");
    eq(R.snapHits.length, 0, "and no poll");
    await connect(page, { topics: ["px"] });
    const c1 = await R.nextConn();
    eq(new URL(c1.url).pathname, "/api/rt/ws", "the socket is /api/rt/ws");
    eq(new URL(c1.url).searchParams.get("k"), "px", "asking for the topics it wants");
    eq(c1.url.startsWith("wss://example.test/"), true, "over wss on an https page");
    eq(await transport(page), "heartbeat", "until the server's hello arrives the only live rung is the pages' own heartbeat");
    const q0 = T1 - 2000;
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 200, 190, q0), quote("AMD", 100, 99, q0), quote("SPY", 500, 498, q0)] }));
    await R.pump();
    eq(await transport(page), "socket", "hello puts the page on the socket rung");
    const s = await strips(page);
    deep(s.fields, FIELDS, "px rows map back to the live:strips field order the pages already read");
    deep(Object.keys(s.rows).sort(), ["AMD", "NVDA", "SPY"], "one row per ticker");
    eq(s.rows.NVDA.length, FIELDS.length, "each row is the 23 strip values, without the ticker and the vendor stamp");
    eq(s.rows.NVDA[0], 200, "px first");
    eq(s.rows.NVDA[FIELDS.indexOf("chg")], chgOf(200, 190), "and the change the server computed from the same row's prev");
    eq(s.session, DAY, "the session comes from the frame's fresh entry");
    eq(s.status, "ok", "status ok");
    eq(s.key, "live:strips", "it stands in for the stored key");
    eq(s.__rt, true, "and says it is streamed");
    deep(s.__verdict.slice(0, 1), ["live"], "with the server's own verdict for the pages that compare it");
    eq((await status(page)).topics.px.synced, true, "px is synced");
    ok(await rt(page, "window.FlowsUI.rt.feeds('px')"), "and feeding the page");
    ok((await page.evaluate(() => window.__ch)).some((c) => c.k === "px" && c.snap && c.ids.length === 3), "the first snapshot reaches the listener with all three names");

    R.now += 1000;
    await page.clock.runFor(1000);
    await page.evaluate(() => { window.__ch = []; });
    R.send(c1, R.delta("px", [quote("NVDA", 201, 190, q0 + 2000), quote("AMD", 1, 99, q0 - 5000), quote("MSFT", 400, 399, q0)]));
    await R.pump();
    const d = await strips(page);
    eq(d.rows.NVDA[0], 201, "a delta with a newer vendor quote time replaces the row");
    eq(d.rows.AMD[0], 100, "a delta with an OLDER quote time is ignored: the latest vendor stamp wins, not the latest arrival");
    eq(d.rows.MSFT[0], 400, "a name the page had not seen is added");
    deep((await page.evaluate(() => window.__ch)).map((c) => [c.snap, c.ids.sort().join()]), [[false, "MSFT,NVDA"]], "and the listener hears only the names that changed, once, after one animation frame");
    R.send(c1, R.delta("px", [quote("NVDA", 201, 190, q0 + 2000, { qa: 9 })]));
    await R.pump();
    eq((await page.evaluate(() => window.__ch)).length, 1, "a row that differs only in its read lag (qa) is not a change and wakes nobody");
    eq(R.messages(c1).filter((m) => m.t === "rs").length, 0, "no resync was asked for on a clean run");
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (want("gap")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    await connect(page, { topics: ["px"] });
    const c1 = await R.nextConn();
    const q0 = T1 - 2000;
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 200, 190, q0), quote("AMD", 100, 99, q0)] }));
    await R.pump();
    await page.evaluate(() => { window.__ch = []; });
    R.send(c1, R.delta("px", [quote("NVDA", 201, 190, q0 + 1000)]));
    await R.pump();
    R.sq.px++;
    R.send(c1, R.delta("px", [quote("NVDA", 205, 190, q0 + 9000), quote("AMD", 103, 99, q0 + 9000)]));
    await R.pump();
    const asked = R.messages(c1).filter((m) => m.t === "rs");
    deep(asked, [{ t: "rs", k: "px" }], "A GAP IN sq (a frame missed) sends exactly one {t:'rs',k:'px'}");
    ok(R.conns[0].received.every((m) => new TextEncoder().encode(m).length <= RT.RT_CLIENT_MAX_BYTES), "within the 256 byte client message cap");
    const st = await status(page);
    eq(st.topics.px.resync, true, "and the topic is marked resyncing");
    eq((await strips(page)).rows.NVDA[0], 201, "the gap frame itself is not applied");
    eq(await rt(page, "window.FlowsUI.rt.feeds('px')"), false, "a resyncing topic is not feeding the page");
    R.send(c1, R.delta("px", [quote("NVDA", 210, 190, q0 + 10000)]));
    await R.pump();
    eq((await strips(page)).rows.NVDA[0], 201, "deltas that arrive while resyncing are ignored until the snapshot");
    R.now += 1000;
    await page.clock.runFor(2700);
    await R.pump();
    eq(R.messages(c1).filter((m) => m.t === "rs").length, 2, "a snapshot that never comes is asked for again after 2.6 s, past the server's 2 s floor");
    R.send(c1, R.snapshot("px", [quote("NVDA", 220, 190, q0 + 12000), quote("AMD", 104, 99, q0 + 12000)], { sq: R.sq.px }));
    await R.pump();
    const after = await status(page);
    eq(after.topics.px.resync, false, "the snapshot ends the resync");
    eq((await strips(page)).rows.NVDA[0], 220, "and replaces the state");
    eq(await rt(page, "window.FlowsUI.rt.feeds('px')"), true, "the topic feeds again");
    R.send(c1, R.delta("px", [quote("NVDA", 221, 190, q0 + 13000)]));
    await R.pump();
    eq((await strips(page)).rows.NVDA[0], 221, "and sq+1 after the snapshot's sq applies");
    R.send(c1, R.delta("px", [quote("NVDA", 999, 190, q0 + 14000)], { sq: R.sq.px }));
    await R.pump();
    eq((await strips(page)).rows.NVDA[0], 221, "a duplicate (sq not above the held one) is dropped without a resync");
    eq(R.messages(c1).filter((m) => m.t === "rs").length, 2, "and without another rs");

    R.ep = 8000;
    R.send(c1, R.ctl("hb", { upstream: "up", phase: "rth", sockets: 1, degraded: null, topics: {} }));
    await R.pump();
    eq(await strips(page), null, "AN EPOCH CHANGE DISCARDS THE TOPIC'S STATE: the old rows belong to a hub that no longer exists");
    eq((await status(page)).topics.px.resync, true, "and awaits a snapshot");
    R.sq.px = 40;
    R.send(c1, R.delta("px", [quote("NVDA", 230, 190, q0 + 20000)], { sq: 41 }));
    await R.pump();
    eq(R.messages(c1).filter((m) => m.t === "rs").length, 3, "a delta in the new epoch before any snapshot is an orphan and asks for one");
    eq(await strips(page), null, "without being applied");
    R.send(c1, R.snapshot("px", [quote("NVDA", 231, 190, q0 + 21000)], { sq: 41 }));
    await R.pump();
    eq((await strips(page)).rows.NVDA[0], 231, "the new epoch's snapshot is adopted");
    R.send(c1, R.delta("px", [quote("NVDA", 232, 190, q0 + 22000)], { sq: 42 }));
    await R.pump();
    eq((await strips(page)).rows.NVDA[0], 232, "and its sq+1 is accepted from there");
    ok((await page.evaluate(() => window.__ch)).some((c) => c.reset), "listeners were told about the reset");
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (want("ctl")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    await connect(page, { topics: ["px", "mk"] });
    const c1 = await R.nextConn();
    R.send(c1, R.hello(["px", "mk"], { px: [quote("NVDA", 200, 190, T1 - 2000)] }));
    await R.pump();
    R.send(c1, R.ctl("degraded", { reason: "vendor-throttled", k: ["px"], since: iso(R.now), retryAt: null }));
    await R.pump();
    eq((await status(page)).degraded.reason, "vendor-throttled", "degraded names its reason");
    R.send(c1, R.ctl("resync", { reason: "recovered", k: ["px"] }));
    await R.pump();
    eq((await status(page)).degraded, null, "a recovered resync clears it");
    eq((await status(page)).topics.px.resync, true, "and holds the named topic until its snapshot");
    R.send(c1, R.snapshot("px", [quote("NVDA", 202, 190, T1 - 1000)], { sq: R.sq.px + 1 }));
    await R.pump();
    eq((await status(page)).topics.px.resync, false, "which clears it");
    R.send(c1, R.ctl("closed", { phase: "closed", reason: "weekend", day: "2026-10-03", lastClosed: DAY, nextOpenAt: iso(T0 + 3 * 86400000), nextRthOpenAt: iso(T0 + 3 * 86400000 + 5 * 3600000) }));
    await R.pump();
    eq((await status(page)).closed.reason, "weekend", "a closed frame is a state, not an error");
    eq(R.conns.length, 1, "the socket stays up through the weekend frame");
    await R.adv(60000, 5000);
    eq(R.conns.length, 1, "AND DOES NOT TRIP ITS SILENCE WATCHDOG at the 30 s closed heartbeat gap (sixteen seconds of quiet is normal while closed)");
    ok(c1.closed === null, "the server saw no close");
    R.send(c1, R.ctl("hb", { upstream: "up", phase: "rth", sockets: 1, degraded: null, topics: {} }));
    await R.pump();
    eq((await status(page)).closed, null, "a heartbeat that says the upstream is up ends the closed state");
    await ctx.close();
  }

  if (want("silent")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    await connect(page, { topics: ["px"] });
    const c1 = await R.nextConn();
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 200, 190, T1 - 2000)] }));
    await R.pump();
    eq(await transport(page), "socket", "on the socket");
    await R.adv(15500, 500);
    ok(c1.closed === null, "a socket quiet for 15.5 s is still trusted");
    await R.adv(1000, 500);
    await R.until(() => c1.closed !== null, 1500);
    ok(c1.closed !== null, "a socket that goes silent for 16 s with the market open is dropped by the client");
    await R.adv(1500, 500);
    await R.until(() => R.conns.length >= 2, 1500);
    eq(R.conns.length, 2, "and reopened a second later");
    eq(c1.closed && c1.closed.code, 1000, "with a normal close from our end");
    await ctx.close();
  }

  if (want("bye")) for (const [code, snapStatus, expect, again] of [[4009, 200, "poll", true], [4012, 200, "poll", true], [4011, 404, "off", false], [4001, 401, "off", false]]) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    R.snap = { status: snapStatus, frames: () => [R.snapshot("px", [quote("NVDA", 200, 190, R.now - 1000)])], headers: {} };
    await connect(page, { topics: ["px"] });
    const c1 = await R.nextConn();
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 200, 190, T1 - 2000)] }));
    await R.pump();
    R.send(c1, RT.ctlFrame("bye", { ep: R.ep, at: R.now, meta: { reason: "test", code } }));
    await R.until(() => c1.closed !== null);
    ok(c1.closed !== null, `bye ${code}: THE CLIENT CLOSES ITS OWN END (the server never raises a close for a socket it closed without a message)`);
    eq(c1.closed.code, 1000, `bye ${code}: with a normal close`);
    await R.until(() => R.snapHits.length >= 1);
    await R.pump();
    eq(await landed(page, R, expect), expect, `bye ${code}: the ladder lands on ${expect}`);
    await R.adv(50000, 5000);
    eq(R.conns.length, 1, `bye ${code}: it does not reconnect inside a minute`);
    if (again) {
      ok(R.snapHits.length >= 8, `bye ${code}: it polls every five seconds meanwhile (${R.snapHits.length})`);
      await R.adv(15000, 5000);
      await R.until(() => R.conns.length >= 2, 1500);
      eq(R.conns.length, 2, `bye ${code}: and probes the socket again after a minute`);
    } else {
      const n = R.snapHits.length;
      await R.adv(30000, 5000);
      eq(R.snapHits.length, n, `bye ${code}: the rail is off for this page, so nothing polls any more`);
      eq(R.conns.length, 1, `bye ${code}: and nothing reconnects`);
      eq((await status(page)).final, snapStatus, `bye ${code}: the answer that ended it is kept (${snapStatus})`);
    }
    deep(page.errors, [], `bye ${code}: nothing threw`);
    await ctx.close();
  }

  if (want("backoff")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    R.mode = "refuse";
    R.snap = { status: 503, frames: () => [], headers: {} };
    await connect(page, { topics: ["px"] });
    await R.nextConn();
    const marks = [[1000, 1], [3000, 2], [7000, 3], [15000, 4], [75000, 5]];
    let t = 0;
    for (const [at, n] of marks) {
      const before = at - 1 - t;
      if (before > 0) { R.now += before; await page.clock.runFor(before); await page.waitForTimeout(30); }
      eq(R.conns.length, n, `reconnect backoff: still ${n} attempt${n > 1 ? "s" : ""} one millisecond before ${at} ms`);
      R.now += 2;
      await page.clock.runFor(2);
      await R.until(() => R.conns.length >= n + 1, 800);
      eq(R.conns.length, n + 1, `reconnect backoff: attempt ${n + 1} at ${at} ms (1, 2, 4, 8 s, then one a minute)`);
      t = at + 1;
      await page.waitForTimeout(30);
    }
    ok(R.snapHits.length >= 2, `the poll rung ran in the meantime and failed (${R.snapHits.length} requests)`);
    eq(await transport(page), "heartbeat", "with the snapshot route also failing the page is on the last rung: its own heartbeats");
    eq((await status(page)).label, "Heartbeat", "named Heartbeat");
    eq((await pill(page)).feed, "Heartbeat", "and the pill says so");
    await ctx.close();
  }

  if (want("poll")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    R.mode = "refuse";
    let n = 0;
    R.snap = { status: 200, frames: () => { n++; return [R.snapshot("px", [quote("NVDA", 200 + n, 190, R.now - 1000)])]; }, headers: {} };
    await connect(page, { topics: ["px"] });
    await R.nextConn();
    await R.until(() => R.snapHits.length >= 1);
    await R.pump();
    eq(await landed(page, R, "poll"), "poll", "A SOCKET THAT WILL NOT OPEN FALLS TO THE POLL RUNG at once");
    eq((await status(page)).label, "Polling 5 s", "named Polling 5 s");
    eq((await pill(page)).feed, "Polling 5 s", "on the pill too");
    eq((await facts(page)).Feed, "Polling 5 s", "and in the freshness popover");
    eq((await strips(page)).rows.NVDA[0], 201, "polled snapshots feed the same adapter");
    const h0 = R.snapHits.length;
    await R.adv(30000, 5000);
    const polled = R.snapHits.length - h0;
    ok(polled >= 5 && polled <= 7, `it polls about every 5 s (${polled} requests in 30 s)`);
    ok(R.snapHits.every((h) => h.k === "px"), "for the topics it holds");
    R.mode = "open";
    R.onConn = (c) => R.send(c, R.hello(["px"], { px: [quote("NVDA", 300, 190, R.now - 1000)] }));
    await R.until(() => R.conns.length >= 6 || false, 100);
    await R.adv(60000, 5000);
    await R.until(() => R.last() && R.last().received.length >= 0 && R.conns.some((c) => c.closed === null), 1500);
    await R.pump();
    eq(await transport(page), "socket", "A RECOVERED SOCKET TAKES THE PAGE BACK: the probe reconnects and hello puts it on the socket rung");
    await page.waitForTimeout(200);
    const n2 = R.snapHits.length;
    await R.alive(20000);
    eq(R.snapHits.length, n2, "and the polling stops");
    eq((await strips(page)).rows.NVDA[0], 300, "the socket's state replaced the polled one");
    await ctx.close();
  }

  if (want("memberpoll")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    R.mode = "refuse";
    let n = 0;
    R.snap = {
      status: 200, frames: () => { n++; return [R.snapshot("px", [quote("NVDA", 200 + n, 190, R.now - 1000)])]; },
      headers: { "X-RT-Poll-Ms": "15000", "X-RT-Poll-Cap-Ms": "600000" },
    };
    await connect(page, { topics: ["px"], focus: "nvda" });
    await R.nextConn();
    await R.until(() => R.snapHits.length >= 1);
    await R.pump();
    eq(R.snapHits[0].f, "NVDA", "A MEMBER ON THE POLL RUNG NAMES THE FOCUS: the first snapshot request carries f=NVDA, normalised");
    eq(await transport(page), "poll", "the poll rung");
    eq((await status(page)).label, "Polling 15 s", "named for the interval the server set");
    eq((await pill(page)).feed, "Polling 15 s", "on the pill too");
    const h0 = R.snapHits.length;
    await R.adv(60000, 5000);
    const polled = R.snapHits.length - h0;
    ok(polled >= 3 && polled <= 5, `it polls about every 15 s (${polled} requests in 60 s)`);
    await R.adv(480000, 15000);
    eq(await transport(page), "poll", "and is still polling eight minutes in");
    await R.adv(180000, 15000);
    const total = R.snapHits.length;
    ok(total <= 42, `an episode costs at most 40 snapshot requests, a few over for the interval's rounding (${total})`);
    eq(await transport(page), "heartbeat", "AFTER TEN MINUTES THE PAGE FALLS TO ITS OWN HEARTBEATS");
    eq((await pill(page)).feed, "Heartbeat", "and the pill says so");
    const conns = R.conns.length;
    await R.adv(300000, 15000);
    eq(R.snapHits.length, total, "it asks the snapshot route no more, though the socket probes carry on");
    ok(R.conns.length > conns, "the socket is still probed while the page waits on heartbeats");
    await page.evaluate(() => window.__setHidden(true));
    await R.adv(40000, 10000);
    await page.evaluate(() => window.__setHidden(false));
    await R.adv(2000, 500);
    ok(R.snapHits.length > total, "a returning reader starts a new episode");
    eq((await measure(page)).polling, 1, "and the poll timer is armed again");
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (want("ownerpoll")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    R.mode = "refuse";
    let n = 0;
    R.snap = {
      status: 200, frames: () => { n++; return [R.snapshot("px", [quote("NVDA", 200 + n, 190, R.now - 1000)])]; },
      headers: { "X-RT-Poll-Ms": "5000", "X-RT-Poll-Cap-Ms": "0" },
    };
    await connect(page, { topics: ["px"] });
    await R.nextConn();
    await R.until(() => R.snapHits.length >= 1);
    await R.pump();
    eq(R.snapHits[0].f, null, "no focus on the page, no f on the request");
    eq((await status(page)).label, "Polling 5 s", "THE OWNER KEEPS 5 s");
    await R.adv(900000, 5000);
    eq(await transport(page), "poll", "and is never cut off: still polling after fifteen minutes");
    ok(R.snapHits.length >= 100, `at the owner's cadence (${R.snapHits.length} requests in fifteen minutes)`);
    await ctx.close();
  }

  if (want("off")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    R.snap = { status: 403, frames: () => [], headers: {} };
    R.mode = "refuse";
    await connect(page, { topics: ["px"] });
    await R.nextConn();
    await R.until(() => R.snapHits.length >= 1);
    await R.pump();
    eq(await transport(page), "off", "A MEMBER OUTSIDE THE AUDIENCE (403 on the snapshot) IS OFF");
    const hits = R.snapHits.length;
    const conns = R.conns.length;
    await R.adv(120000, 10000);
    eq(R.snapHits.length, hits, "it never asks again");
    eq(R.conns.length, conns, "and never reopens a socket");
    eq((await pill(page)).feed, "", "the pill carries no feed text: the page behaves as it always did");
    eq((await measure(page)).timers, 0, "and holds no timer");
    await page.reload();
    await page.waitForTimeout(200);
    await connect(page, { topics: ["px"] });
    await page.waitForTimeout(400);
    eq(R.conns.length, conns, "AND A RELOAD IN THE SAME TAB DOES NOT PROBE AGAIN for ten minutes: no socket");
    eq(R.snapHits.length, hits, "and no snapshot request");
    eq(await transport(page), "off", "the page is simply off");
    await ctx.close();
  }

  if (want("fresh")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    await connect(page, { topics: ["px", "mk"] });
    const c1 = await R.nextConn();
    const live = quote("NVDA", 200, 190, R.now - 1000);
    R.send(c1, R.hello(["px", "mk"], { px: [live], mk: [{ id: "tide", status: "ok", date: DAY, t: iso(T1 - 60000), ncp: 1, npp: 2, net: -1, nv: 3 }] }));
    await R.pump(80);
    const f1 = await facts(page);
    ok(f1["Price read"], `a live px frame is the price read the pill may call live (${JSON.stringify(f1)})`);
    eq(f1.Feed, "Socket", "and the popover names the socket");
    eq((await pill(page)).feed, "Socket", "the pill too");
    eq((await measure(page)).reg, 2, "one registration per topic from the hello (px and mk), not one per row");
    for (let i = 0; i < 4; i++) { R.now += 200; await page.clock.runFor(200); R.send(c1, R.delta("px", [quote("NVDA", 201 + i, 190, R.now)])); await page.waitForTimeout(20); }
    eq((await measure(page)).reg, 2, "frames inside the same second register nothing more: at most once a second per topic");
    R.now += 1200;
    await page.clock.runFor(1200);
    R.send(c1, R.delta("px", [quote("NVDA", 210, 190, R.now)]));
    await R.pump();
    eq((await measure(page)).reg, 3, "and the next second registers once");
    await R.adv(1000);
    R.snap = { status: 503, frames: () => [], headers: {} };
    c1.ws.close({ code: 1011, reason: "gone" });
    await R.until(() => R.snapHits.length >= 1);
    await R.pump();
    const drops = await page.evaluate(() => window.__drops.slice());
    deep([...new Set(drops.filter((s) => /^rt:/.test(s)))].sort(), ["rt:fl", "rt:gx", "rt:mk", "rt:nw", "rt:px"], "WHEN THE SOCKET FALLS every rt:* freshness entry is dropped, so a dead socket cannot leave the pill stale");
    const f2 = await facts(page);
    ok(!f2["Price read"] && !f2.Payloads, `and the price-read claim and the payload count go with them (${JSON.stringify(f2)})`);
    await ctx.close();
  }

  if (want("transit")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    await connect(page, { topics: ["px"] });
    const c1 = await R.nextConn();
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 200, 190, R.now - 1000)] }));
    await R.pump(80);
    deep((await measure(page)).transitMs, { n: 0, p50: null, p95: null, estimate: true }, "transit: the hello teaches the clock offset and is not itself a sample");
    for (const wait of [0, 300, 700, 1200]) {
      const f = R.delta("px", [quote("NVDA", 201, 190, R.now)]);
      R.now += wait;
      await page.clock.runFor(wait);
      R.send(c1, f);
      await page.waitForTimeout(20);
    }
    const t = (await measure(page)).transitMs;
    deep([t.n, t.estimate, t.p95 - t.p50], [4, true, 900], "transit: receive time minus the frame's own stamp, against the offset the hello taught, as p50 and p95 and labelled an estimate");
    const base = t.p50 - 300;
    ok(base >= 0 && base <= 200, `transit: and the frame that waited 1200 ms reads ${t.p95} ms over a base of ${base} ms (the page's own pump after the hello)`);
    R.now += 5000;
    await page.clock.runFor(5000);
    R.send(c1, R.ctl("hb", { upstream: "up", phase: "rth", sockets: 1, degraded: null, topics: {} }));
    await page.waitForTimeout(20);
    eq((await measure(page)).transitMs.n, 5, "transit: a control frame is a sample too");
    const early = R.delta("px", [quote("NVDA", 202, 190, R.now)]);
    R.now -= 0;
    R.send(c1, early);
    await page.waitForTimeout(20);
    ok((await measure(page)).transitMs.p50 >= 0, "transit: no sample is negative");
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (want("notlive")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    await connect(page, { topics: ["px"] });
    const c1 = await R.nextConn();
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 200, 190, R.now - 40000)] }, { lag: 40000 }));
    await R.pump();
    const f = await page.evaluate(() => ({ s: window.FlowsUI.freshness.state(), d: window.FlowsUI.freshness.details(), p: document.getElementById("fxFresh").dataset.state }));
    ok(f.p !== "live" && f.s !== "live", `A FRAME WHOSE OWN FRESH STATE IS NOT LIVE (the vendor's quote is 40 s old: fresh, vendor-lag) NEVER CLAIMS A LIVE PILL (${f.p}/${f.s})`);
    ok(!f.d.facts.some(([k, v]) => k === "Price read" && v), "and sets no price-read time");
    await ctx.close();
  }

  if (want("hidden")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    const base = await page.evaluate(() => ({ l: JSON.stringify(window.__rtListeners), t: window.__rtTimers.size }));
    await connect(page, { topics: ["px"] });
    const c1 = await R.nextConn();
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 200, 190, R.now - 1000)] }));
    await R.pump();
    const during = await page.evaluate(() => ({ l: window.__rtListeners, t: window.__rtTimers.size }));
    ok(during.t >= 2, `while open it holds timers (${during.t})`);
    await page.evaluate(() => { window.__setHidden(true); });
    await R.alive(29000, 4000);
    ok(c1.closed === null, "a tab hidden for 29 s keeps its socket");
    await R.adv(2000, 1000);
    await R.until(() => c1.closed !== null, 1500);
    ok(c1.closed !== null, "A TAB HIDDEN FOR 30 S CLOSES ITS SOCKET");
    eq(c1.closed.code, 1000, "normally");
    const m = await measure(page);
    deep([m.timers, m.socket, m.polling, m.raf], [0, 0, 0, 0], "and NO TIMER, poll or frame callback is left running while hidden");
    eq(await page.evaluate(() => window.__rtTimers.size), 0, "which the independent timer census (every setTimeout made from flows-rt.js) agrees with");
    eq(await transport(page), "heartbeat", "the rt entries are gone and the pages' own heartbeats are the only feed");
    const hits = R.snapHits.length;
    await R.adv(60000, 10000);
    eq(R.snapHits.length, hits, "nothing polls while hidden");
    eq(R.conns.length, 1, "nor reconnects");
    await page.evaluate(() => { window.__setHidden(false); });
    await R.nextConn(2);
    ok(R.conns.length === 2, "BECOMING VISIBLE REOPENS THE SOCKET AT ONCE");
    R.onConn = null;
    R.send(R.last(), R.hello(["px"], { px: [quote("NVDA", 205, 190, R.now - 500)] }));
    await R.pump();
    eq(await transport(page), "socket", "and the hello takes the page back to the socket rung");
    const after = await page.evaluate(() => window.__rtListeners);
    eq(JSON.stringify(Object.keys(after).sort()), JSON.stringify(Object.keys(during.l).sort()), "with one listener each, none added by the cycle");
    await ctx.close();
  }

  if (want("refs")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    await connect(page, { topics: ["px"] }, "a");
    const c1 = await R.nextConn();
    await connect(page, { topics: ["px"] }, "a");
    await page.waitForTimeout(80);
    eq(R.conns.length, 1, "connect is idempotent: the same request opens no second socket");
    eq(await page.evaluate(() => window.__a === window.FlowsUI.rt.connect({ topics: ["px"] })), true, "and returns the same handle");
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 200, 190, R.now - 1000)] }));
    await R.pump();
    await connect(page, { topics: ["fl"], focus: "tsla" }, "b");
    await R.until(() => R.messages(c1).some((m) => m.t === "sub"));
    deep(R.messages(c1).filter((m) => m.t === "sub"), [{ t: "sub", k: ["px", "fl"], f: "TSLA" }], "a second handle for another topic widens the one socket's subscription (and normalises the focus ticker)");
    eq(R.conns.length, 1, "still one socket per tab");
    R.send(c1, R.snapshot("fl", []));
    await R.pump();
    await page.evaluate(() => window.__a.close());
    await R.until(() => R.messages(c1).filter((m) => m.t === "sub").length >= 2);
    deep(R.messages(c1).filter((m) => m.t === "sub")[1], { t: "sub", k: ["fl"], f: "TSLA" }, "closing one handle drops only the topic nobody else holds");
    eq((await status(page)).topics.px.synced, false, "and frees that topic's state");
    await R.alive(31000, 4000);
    const parsed = R.conns[0].received.map((m) => ({ size: new TextEncoder().encode(m).length, p: RT.parseClientMessage(m) }));
    ok(parsed.every((x) => x.size <= RT.RT_CLIENT_MAX_BYTES && x.p.ok), `every client message is at most 256 B and parses under the server's own parser (${parsed.length} sent)`);
    ok(R.messages(c1).some((m) => m.t === "p" && typeof m.sq === "object"), "a position message {t:'p',sq} goes out about every 30 s");
    const ps = R.messages(c1).filter((m) => m.t === "p");
    ok(ps.length === 1, `exactly one in 31 s (${ps.length})`);
    await page.evaluate(() => window.__b.close());
    await R.until(() => c1.closed !== null);
    ok(c1.closed !== null, "closing the last handle closes the socket");
    const m = await measure(page);
    deep([m.timers, m.listeners, m.socket, m.polling, m.handles, m.raf], [0, 0, 0, 0, 0, 0], "and leaves no timer, listener, socket, poll, handle or frame callback behind");
    eq(await page.evaluate(() => window.__rtTimers.size), 0, "by the independent census too");
    const left = await page.evaluate(() => window.__rtListeners);
    ok(Object.keys(left).length === 3 && Object.values(left).every((v) => v === 0), `and every document and window listener it added (visibilitychange, pagehide, pageshow) is removed again (${JSON.stringify(left)})`);
    const n = R.snapHits.length;
    await R.adv(120000, 10000);
    eq(R.snapHits.length, n, "nothing wakes after close");
    eq(R.conns.length, 1, "nor reconnects");
    await ctx.close();
  }

  if (want("pollclose")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    R.mode = "refuse";
    R.snap = { status: 200, frames: () => [R.snapshot("px", [quote("NVDA", 200, 190, R.now - 1000)])], headers: {} };
    await connect(page, { topics: ["px"] });
    await R.until(() => R.snapHits.length >= 1);
    await R.adv(10000, 5000);
    await page.evaluate(() => window.__h.close());
    await page.waitForTimeout(50);
    const n = R.snapHits.length;
    const m = await measure(page);
    deep([m.timers, m.listeners, m.polling, m.socket], [0, 0, 0, 0], "closing while on the poll rung also leaves nothing behind");
    await R.adv(60000, 10000);
    eq(R.snapHits.length, n, "and the polling stops with it");
    await ctx.close();
  }

  if (want("board")) {
    const TICKERS = ["NVDA", "AMD", "MSFT"];
    const board = {
      side: "long", generatedAt: iso(T0 - 20 * 3600000), sessionDate: PREV, status: "ok", universe: 264, enriched: 60,
      rows: TICKERS.map((t, i) => ({ t, r: i + 1, s: 90 - i * 7, cnv: 80 - i * 3, px: 100 + i, chg: 0.01 * (i + 1), purity: 0.02, sector: "Technology",
        gRegime: "long", gFlipDist: -0.1, netPrem: 1e7 - i * 1e5, fam: { F: 10, P: 20, D: 30, V: 40, O: 50 }, edte: 20 + i })),
    };
    const rest = (R, px) => ({
      headers: fresh("breadth", "live", "cadence", R.now - 60000, R.now + 2640000),
      body: { v: 1, key: "live:strips", status: "ok", session: DAY, fields: ["px", "chg"], rows: Object.fromEntries(TICKERS.map((t, i) => [t, [px + i, 0.5]])),
        fresh: { readAt: iso(R.now - 60000), session: DAY, cadenceS: 900, source: "actions", writer: "flows-live" } },
    });
    const state = { px: 999 };
    const answer = (key, u, R) => (key.startsWith("board?side=long") ? { body: board } : key.startsWith("lk?k=strips") ? rest(R, state.px) : null);
    const rows = (page) => page.evaluate(() => [...document.querySelectorAll("#flowsBody .bd-row")].map((r) => {
      const px = r.querySelector(".bd-px"), chg = r.querySelector(".bd-chg");
      return { t: r.getAttribute("data-flip"), px: px ? px.textContent.trim() : null, live: !!(px && px.classList.contains("is-live")), chg: chg ? chg.textContent.trim() : null,
        tick: [...r.querySelectorAll('[data-col="px"]')].reduce((n, c) => n + c.getAnimations().length, 0) };
    }));
    const { ctx, page, R } = await mount(browser, { html: PAGES.sidePage({ username: "test", side: "long" }), url: "/flows/long/", answer });
    await page.waitForSelector("#flowsBody .bd-row");
    await R.until(() => R.conns.length >= 1);
    eq(R.conns.length, 1, "the board opens one socket");
    eq(new URL(R.conns[0].url).searchParams.get("k"), "px", "for prices alone");
    const before = await rows(page);
    ok(before.every((r) => r.live), "the polled read already put the dots on");
    const c1 = R.conns[0];
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 200, 190, R.now - 1000), pxRow("AMD", R.now - 1000, { px: 150, prev: null, chg: null, qa: 1 })] }));
    await R.pump(80);
    const now = await rows(page);
    deep(now.map((r) => [r.t, r.px]), [["NVDA", "200.00"], ["AMD", "150.00"], ["MSFT", "1001.00"]], "streamed prices replace the polled ones on the names the stream carries, and leave the others on their last read");
    ok(/5\.26/.test(now[0].chg), `NVDA's change is the stream's own, ${now[0].chg}`);
    ok(!/1\.00%|50\.00%|2\.00%/.test(now[1].chg) && /—|–|-/.test(now[1].chg), `AMD arrived with a price and no previous close: its change is a dash, NOT the board's nightly percentage and not the polled 50% (${now[1].chg}): A BOARD NEVER MIXES A LIVE PRICE WITH A NIGHTLY CHANGE`);
    ok(now.slice(0, 2).every((r) => r.live), "and both carry the live dot");
    eq(now[0].tick, 0, "the first streamed value is not a tick (there is nothing to compare it with)");
    R.now += 1000;
    await page.clock.runFor(1000);
    R.send(c1, R.delta("px", [quote("NVDA", 201, 190, R.now - 500)]));
    await R.pump(30);
    const up = await rows(page);
    eq(up[0].px, "201.00", "a delta repaints the one row");
    eq(up[0].tick, 1, "and flashes it once");
    eq(up[1].tick + up[2].tick, 0, "the untouched rows are not touched");
    await page.evaluate(() => { window.__rows = [...document.querySelectorAll("#flowsBody .bd-row")]; });
    R.send(c1, R.delta("px", [quote("NVDA", 202, 190, R.now - 400)]));
    await R.pump(30);
    eq(await page.evaluate(() => [...document.querySelectorAll("#flowsBody .bd-row")].every((r, i) => r === window.__rows[i])), true, "no row element is rebuilt: the cells of the changed row are swapped in place");

    const restHits = () => page.asked.filter((a) => a.key.startsWith("lk?k=strips")).length;
    const h0 = restHits();
    state.px = 555;
    await R.alive(15 * 60000 + 30000, 14000, ["px"]);
    ok(restHits() > h0, `the polled strips are still read underneath at their own cadence (${restHits() - h0} more)`);
    eq((await rows(page))[0].px, "202.00", "but while the stream feeds the page the older polled read does not overwrite it");

    c1.ws.close({ code: 1011, reason: "gone" });
    R.snap = { status: 503, frames: () => [], headers: {} };
    R.mode = "refuse";
    await R.adv(100000, 10000);
    const fell = await rows(page);
    eq(fell[0].px, "555.00", "ONCE THE STREAM HAS BEEN SILENT FOR 20 S THE POLLED READ TAKES THE PAGE BACK, within a minute");
    deep(page.errors, [], "nothing threw");
    await ctx.close();

    const calm = await mount(browser, { html: PAGES.sidePage({ username: "test", side: "long" }), url: "/flows/long/", answer, reduced: true });
    await calm.page.waitForSelector("#flowsBody .bd-row");
    await calm.R.until(() => calm.R.conns.length >= 1);
    const k1 = calm.R.conns[0];
    calm.R.send(k1, calm.R.hello(["px"], { px: [quote("NVDA", 200, 190, calm.R.now - 1000)] }));
    await calm.R.pump(80);
    calm.R.now += 1000;
    await calm.page.clock.runFor(1000);
    calm.R.send(k1, calm.R.delta("px", [quote("NVDA", 203, 190, calm.R.now - 500)]));
    await calm.R.pump(30);
    const still = await rows(calm.page);
    eq(still[0].px, "203.00", "reduced motion still gets the new price");
    eq(still[0].tick, 0, "WITH prefers-reduced-motion THERE IS NO FLASH");
    await calm.ctx.close();
  }

  if (want("home")) {
    const focus = {
      status: "ok", sessionDate: PREV, generatedAt: iso(T0 - 20 * 3600000), readAt: iso(T0 - 20 * 3600000),
      fields: ["px", "prev", "chg", "net", "lean", "iv30"],
      groups: [
        { id: "mag7", kind: "leaders", label: "Mag 7", tickers: ["NVDA", "AAPL"], lead: "NVDA" },
        { id: "gold", kind: "metal", label: "Gold", tickers: ["GLD", "GDX"], lead: "GLD" },
      ],
      rows: { NVDA: [190, 188, 0.01, 1e6, 0.1, 0.4], AAPL: [200, 199, 0.005, 2e6, 0.2, 0.3], GLD: [300, 299, 0.003, 3e6, 0.1, 0.2], GDX: [50, 49, 0.02, 1e6, 0.1, 0.5] },
      closes: { NVDA: [180, 188, 190], AAPL: [195, 199, 200], GLD: [290, 299, 300], GDX: [48, 49, 50] },
    };
    const news = (R) => ({
      headers: fresh("breadth", "live", "cadence", R.now - 60000, R.now + 2640000),
      body: { v: 1, key: "live:news", status: "ok", generatedAt: iso(R.now - 60000), sessionDate: DAY, readAt: iso(R.now - 60000), refreshed: "intraday", cadenceMinutes: 15,
        live: { key: "live:news", session: DAY }, rows: Array.from({ length: 3 }, (_, i) => ({ headline: "wire " + i, source: "wire", createdAt: iso(R.now - 3600000 - i * 60000), createdAtMs: R.now - 3600000 - i * 60000, major: false, sentiment: "neutral", tickers: ["SPY"], tags: [] })),
        requested: 100, returned: 3, kept: 3, cap: 60, capped: false, shed: 0, atVendorLimit: false, unusable: 0, undatedKept: 0, undatedSeen: 0, reason: null },
    });
    const answer = (key, u, R) => {
      if (key.startsWith("focus")) return { body: focus };
      if (key.startsWith("news")) return news(R);
      if (key.startsWith("now")) return { body: { serverNow: R.now, expected: PREV, phase: RTH, keys: {} } };
      return null;
    };
    const { ctx, page, R } = await mount(browser, { html: PAGES.overviewPage({ username: "test" }), url: "/flows/", answer });
    await page.waitForSelector("#ccLeaders a[data-ticker]", { timeout: 15000 });
    await R.until(() => R.conns.length >= 1, 15000);
    eq(R.conns.length, 1, "the home page opens one socket");
    deep(new URL(R.conns[0].url).searchParams.get("k").split(",").sort(), ["mk", "nw", "px"], "for prices, the market tide and headlines");
    const c1 = R.conns[0];
    const HOSTILE = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script>';
    const hostileRow = { id: "h1", ts: R.now, headline: HOSTILE, source: '<b onmouseover="window.__pwn=3">src</b>', createdAt: iso(R.now), createdAtMs: R.now, major: true, sentiment: "<i>neutral</i>", tickers: ["<svg onload=window.__pwn=4>", "NVDA"], tags: ["<u>t</u>"] };
    const pxs = [quote("NVDA", 191, 188, R.now - 1000, { net: 4e6 }), quote("AAPL", 201, 199, R.now - 1000), quote("GLD", 301, 299, R.now - 1000), quote("GDX", 51, 49, R.now - 1000)];
    const tidePoint = (min, net) => ({ id: "tide", status: "ok", date: DAY, t: iso(easternInstant(DAY, 9 * 60 + 30 + min)), ncp: 3e8, npp: 1e8, net, nv: 9 });
    R.send(c1, R.hello(["px", "mk", "nw"], { px: pxs, mk: [tidePoint(0, 2e8)], nw: [hostileRow] }));
    await R.pump(80);
    const q = () => page.evaluate(() => ({
      px: document.querySelector('#ccLeaders a[data-ticker="NVDA"] .hm-qpx').textContent,
      src: document.querySelector('#ccLeaders a[data-ticker="NVDA"]').dataset.src,
      aria: document.querySelector('#ccLeaders a[data-ticker="NVDA"]').getAttribute("aria-label"),
    }));
    const first = await q();
    eq(first.px, "191.00", "the first streamed snapshot repaints the focus module from the stream");
    eq(first.src, "live", "as a live read");
    await page.click("#ccNews .hm-news-open");
    await page.waitForSelector("#fxPopB .cc-nw-h");
    const news1 = await page.evaluate(() => ({
      head: document.querySelector("#ccNews .hm-news-h").textContent,
      text: [...document.querySelectorAll("#fxPopB .cc-nw-h")].map((n) => n.textContent),
      imgs: document.querySelectorAll("#ccNews img, #ccNews script, #fxPopB img, #fxPopB script, #fxPopB svg[onload], #fxPopB [onmouseover], #fxPopB [onerror]").length,
      pwn: window.__pwn === undefined, html: window.__html.filter((x) => /onerror|onload|onmouseover|<script/i.test(x)).length,
      tickers: [...document.querySelectorAll("#fxPopB .cc-nw-tks")].map((n) => n.textContent),
    }));
    eq(news1.head, HOSTILE, "the card's headline is the stream's newest, shown as TEXT, verbatim");
    ok(news1.text.includes(HOSTILE), `and so is the same row in the list (${news1.text[0]})`);
    eq(news1.imgs, 0, "no element was created from it");
    ok(news1.pwn, "no handler ran");
    eq(news1.html, 0, "and nothing hostile ever went through innerHTML, outerHTML, insertAdjacentHTML or document.write");
    ok(news1.tickers.some((t) => /<svg onload/i.test(t)), "the tickers are text too");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const a = document.querySelector('#ccLeaders a[data-ticker="NVDA"]');
      const b = document.querySelector('#ccLeaders a[data-ticker="AAPL"]');
      a.__k = 1; b.__k = 1; b.querySelector(".hm-qpx").__k = 1;
    });
    R.now += 1000;
    await page.clock.runFor(1000);
    R.send(c1, R.delta("px", [quote("NVDA", 192.5, 188, R.now - 500, { net: 5e6 })]));
    await R.pump(40);
    const after = await q();
    eq(after.px, "192.50", "a delta patches the changed name in place");
    ok(/192\.50/.test(after.aria), "including the sentence a screen reader gets");
    const kept = await page.evaluate(() => ({
      a: document.querySelector('#ccLeaders a[data-ticker="NVDA"]').__k === 1,
      b: document.querySelector('#ccLeaders a[data-ticker="AAPL"]').__k === 1 && document.querySelector('#ccLeaders a[data-ticker="AAPL"] .hm-qpx').__k === 1,
    }));
    const pill1 = await page.evaluate(() => { const b = document.querySelector("#ccLeadersWhen .hm-pill"); return b ? [b.dataset.state, b.textContent] : null; });
    ok(pill1 && pill1[0] === "live", `the module's pill reads Live while the stream's frames are live (${JSON.stringify(pill1)})`);
    await R.alive(120000, 10000, ["px", "mk", "nw"]);
    R.send(c1, R.delta("px", [quote("NVDA", 193, 188, R.now - 500)]));
    await R.pump(40);
    const pill2 = await page.evaluate(() => document.querySelector("#ccLeadersWhen .hm-pill").textContent);
    ok(pill1[1] !== pill2, `and its read time follows the stream, not the first paint (${pill1[1]} then ${pill2})`);
    ok(kept.a, "the anchor is the same element: nothing was rebuilt");
    ok(kept.b, "and the untouched name's anchor and cells were not re-rendered");
    R.send(c1, R.delta("mk", [tidePoint(5, 2.5e8)]));
    await R.pump(40);
    const tide = await page.evaluate(() => ({ v: document.getElementById("hmTideV").textContent, river: !!document.querySelector("#hmTide .hm-river") }));
    ok(/\$|M|K|B/.test(tide.v) && tide.river, `a market-tide delta redraws the hero river (${tide.v})`);
    const look = (sel) => { const svg = document.querySelector(sel); const host = svg && svg.parentElement;
      const was = !!(svg && svg.__rtMark); if (svg) svg.__rtMark = true;
      const run = host ? host.getAnimations({ subtree: true }).filter((a) => { const t = a.effect && a.effect.getComputedTiming(); return t && Number.isFinite(t.endTime); }).length : -1;
      return { svg: !!svg, was, still: !!(svg && svg.classList.contains("no-anim")), run, svgs: host ? host.querySelectorAll(":scope > svg").length : 0 }; };
    await page.waitForFunction((sel) => document.querySelector(sel), "#hmTide .hm-river > svg", { timeout: 5000 }).catch(() => {});
    const t0 = await page.evaluate(look, "#hmTide .hm-river > svg");
    ok(t0.svg && !t0.was, "the river's first paint draws one svg");
    for (const k of [10, 15]) {
      R.send(c1, R.delta("mk", [tidePoint(k, 2.5e8 + k * 1e6)]));
      await R.pump(40);
      const t1 = await page.evaluate(look, "#hmTide .hm-river > svg");
      ok(t1.svg && t1.was && t1.svgs === 1, `IN PLACE: tide point ${k} keeps the same river svg node on Home (${JSON.stringify(t1)})`);
      ok(t1.still && t1.run === 0, `and nothing in it replays its entrance (${JSON.stringify(t1)})`);
    }
    R.send(c1, R.delta("nw", [{ ...hostileRow, id: "h2", ts: R.now + 1, headline: "plain headline two", createdAt: iso(R.now + 1), createdAtMs: R.now + 1 }]));
    await R.pump(40);
    eq(await page.evaluate(() => document.querySelector("#ccNews .hm-news-h").textContent), "plain headline two", "a new headline lands at the top of the card");
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (want("unusual")) {
    const alert = (t, prem, at) => ({
      t, oc: t + "260929C00100000", cp: "C", k: 100, exp: "2026-09-29", prem, size: 10, trades: 2, askPrem: prem * 0.6, bidPrem: prem * 0.3,
      sweep: true, floor: false, single: true, opening: false, oi: 1000, voi: 1.5, ivStart: 0.3, ivEnd: 0.31, px: 100.5, spanStart: iso(at), spanEnd: iso(at + 500), rule: "RepeatedHits", st: "board:long",
    });
    const base = [alert("NVDA", 900000, T0 - 3600000)];
    const answer = (key, u, R) => {
      if (key.startsWith("flowalerts")) {
        return { headers: { ...fresh("breadth", "live", "cadence", R.now - 60000, R.now + 2640000), "X-Live-Overlay": "live:alerts" },
          body: { status: "ok", sessionDate: DAY, generatedAt: iso(R.now - 60000), rows: base.map((r) => ({ ...r, firstAt: iso(R.now - 60000), lastAt: iso(R.now - 60000), reads: 2 })), seen: 1, shed: 0, cap: 60, record: { date: DAY, reads: 2 } } };
      }
      if (key.startsWith("now")) return { body: { serverNow: R.now, expected: PREV, phase: RTH, keys: {} } };
      return null;
    };
    const { ctx, page, R } = await mount(browser, { html: PAGES.unusualPage({ username: "test" }), url: "/flows/unusual/", answer });
    await R.until(() => R.conns.length >= 1, 15000);
    eq(R.conns.length, 1, "the unusual page opens one socket");
    eq(new URL(R.conns[0].url).searchParams.get("k"), "fl", "for flow alerts");
    const c1 = R.conns[0];
    const wire = (r, id, ts) => ({ ...r, id, ts });
    const meta = { cursor: iso(R.now), read: 3, unusable: 0, dropped: 3, truncated: false };
    const snap = RT.frame("fl", { ep: R.ep, sq: 0, at: R.now, snap: true, fresh: R.fresh("fl"), meta,
      rows: [wire(base[0], "a1", T0 - 3600000), wire(alert("TSLA", 400000, T0 - 60000), "a2", T0 - 60000), wire(alert("AMD", 200000, T0 - 30000), "a3", T0 - 30000)] });
    R.send(c1, RT.ctlFrame("hello", { ep: R.ep, at: R.now, meta: { transport: "ws", upstream: "rest", mode: "on", audience: "owner", topics: ["fl"], hbS: 5, cold: false, phase: "rth", session: DAY, f: null }, rows: [snap] }));
    await R.pump(80);
    const meta1 = await page.evaluate(() => ({ meta: document.getElementById("uaMeta").textContent, chips: document.getElementById("uaChips").textContent }));
    ok(/3 held back by the stream/.test(meta1.meta), `the dropped counter is on the page (${meta1.meta})`);
    ok(/3\s*Windows|Windows\s*3/.test(meta1.chips), `the alert already on the page is not counted twice: three windows, not four (${meta1.chips})`);
    const look = (sel) => { const svg = document.querySelector(sel); const host = svg && svg.parentElement;
      const was = !!(svg && svg.__rtMark); if (svg) svg.__rtMark = true;
      const run = host ? host.getAnimations({ subtree: true }).filter((a) => { const t = a.effect && a.effect.getComputedTiming(); return t && Number.isFinite(t.endTime); }).length : -1;
      return { svg: !!svg, was, still: !!(svg && svg.classList.contains("no-anim")), run, svgs: host ? host.querySelectorAll(":scope > svg").length : 0 }; };
    await page.waitForFunction((sel) => document.querySelector(sel), "#uaTimeline .fu-chart > svg", { timeout: 5000 }).catch(() => {});
    const u0 = await page.evaluate(look, "#uaTimeline .fu-chart > svg");
    R.send(c1, R.delta("fl", [wire(alert("AAPL", 700000, T0 - 1000), "a4", T0 - 1000), wire(base[0], "a1", T0 - 3600000)], { meta: { cursor: iso(R.now), read: 2, unusable: 0, dropped: 5, truncated: true } }));
    await R.pump(80);
    const meta2 = await page.evaluate(() => ({ meta: document.getElementById("uaMeta").textContent, chips: document.getElementById("uaChips").textContent }));
    ok(/4\s*Windows|Windows\s*4/.test(meta2.chips), `a new alert appends (four) and the repeated id does not (${meta2.chips})`);
    const u1 = await page.evaluate(look, "#uaTimeline .fu-chart > svg");
    ok(u0.svg && u1.svg && u1.was && u1.svgs === 1, `IN PLACE: a streamed alert keeps the same timeline svg node (${JSON.stringify(u1)})`);
    ok(u1.still && u1.run === 0, `and no bubble replays its entrance (${JSON.stringify(u1)})`);
    ok(/5 held back by the stream/.test(meta2.meta) && /stream missed a page/.test(meta2.meta), `and the counters move (${meta2.meta})`);
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (want("market")) {
    const answer = (key, u, R) => (key.startsWith("now") ? { body: { serverNow: R.now, expected: PREV, phase: RTH, keys: {} } } : null);
    const { ctx, page, R } = await mount(browser, { html: PAGES.marketPage({ username: "test" }), url: "/flows/market/", answer });
    await R.until(() => R.conns.length >= 1, 15000);
    eq(R.conns.length, 1, "the market page opens one socket");
    eq(new URL(R.conns[0].url).searchParams.get("k"), "mk", "for the tide");
    const c1 = R.conns[0];
    const tidePoint = (min, net) => ({ id: "tide", status: "ok", date: DAY, t: iso(easternInstant(DAY, 9 * 60 + 30 + min)), ncp: 3e8, npp: 1e8, net, nv: 9 });
    const etf = (e, chg) => ({ id: e, etf: e, name: e, px: 100, prev: 99, chg, callPrem: 1e6, putPrem: 5e5, bull: 1e6, bear: 5e5, net: 5e5, lean: 0.3, leanWhy: null, callVol: 10, putVol: 5, vol: 15 });
    R.send(c1, R.hello(["mk"], { mk: [tidePoint(0, 2e8), etf("XLK", 0.01)] }));
    await R.pump(80);
    const a = await page.evaluate(() => document.querySelectorAll("#mkTide .mk-river").length);
    eq(a, 0, "one tide point draws no river (it needs two reads)");
    R.now += 1000;
    await page.clock.runFor(1000);
    R.send(c1, R.delta("mk", [tidePoint(5, 2.4e8)]));
    await R.pump(80);
    const b = await page.evaluate(() => ({ river: document.querySelectorAll("#mkTide .mk-river").length, legs: document.getElementById("mkTideLegs").textContent }));
    eq(b.river, 1, "the second point draws the river on the market page");
    ok(/240|\$/.test(b.legs), `with the stream's own latest net (${b.legs.slice(0, 60)})`);
    const look = (sel) => { const svg = document.querySelector(sel); const host = svg && svg.parentElement;
      const was = !!(svg && svg.__rtMark); if (svg) svg.__rtMark = true;
      const run = host ? host.getAnimations({ subtree: true }).filter((a) => { const t = a.effect && a.effect.getComputedTiming(); return t && Number.isFinite(t.endTime); }).length : -1;
      return { svg: !!svg, was, still: !!(svg && svg.classList.contains("no-anim")), run, svgs: host ? host.querySelectorAll(":scope > svg").length : 0 }; };
    await page.waitForFunction((sel) => document.querySelector(sel), "#mkTide .mk-river > svg", { timeout: 5000 }).catch(() => {});
    await page.evaluate(look, "#mkTide .mk-river > svg");
    for (const k of [10, 15]) {
      R.now += 1000;
      await page.clock.runFor(1000);
      R.send(c1, R.delta("mk", [tidePoint(k, 2.4e8 + k * 1e6)]));
      await R.pump(80);
      const m1 = await page.evaluate(look, "#mkTide .mk-river > svg");
      ok(m1.svg && m1.was && m1.svgs === 1, `IN PLACE: tide point ${k} keeps the same river svg node on Market (${JSON.stringify(m1)})`);
      ok(m1.still && m1.run === 0, `and nothing in it replays its entrance (${JSON.stringify(m1)})`);
    }
    eq(await page.evaluate(() => document.querySelectorAll("#mkTide .mk-river").length), 1, "still one river");
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (want("ticker")) {
    const card = {
      ticker: "NVDA", lite: true, depth: "index", status: "ok", sessionDate: PREV, generatedAt: iso(T0 - 20 * 3600000), nm: "NVIDIA", sector: "Technology", type: "stock", rank: 1, n: 400,
      u: { iv30: 0.4, ivp: 60, ivRank: 55, net: 1e6, lean: 0.1, pcr: 0.8, rvol: 1.1 }, pct: { iv30: 50, vrp: 40 }, gate: null,
    };
    const rest = (R) => ({ ticker: "NVDA", status: "ok", readAt: iso(R.now), price: 400, prevClose: 395, changePct: 400 / 395 - 1, open: 396, high: 402, low: 395, volume: 12345678, marketTime: null, tapeTime: iso(R.now) });
    const answer = (key, u, R) => {
      const p = key.split("?")[0];
      if (p === "card") return { body: card };
      if (p === "summary") return { body: { status: "quiet", scope: "NVDA", summary: null, ideas: [] } };
      if (p === "now") return { body: { serverNow: R.now, expected: PREV, phase: RTH, keys: {}, quote: rest(R) } };
      return null;
    };
    const { ctx, page, R } = await mount(browser, { html: PAGES.tickerPage({ username: "test" }), url: "/flows/ticker/?t=NVDA", answer });
    await R.until(() => R.conns.length >= 1, 15000);
    eq(R.conns.length, 1, "the ticker opens one socket");
    const url = new URL(R.conns[0].url);
    deep([url.searchParams.get("k"), url.searchParams.get("f")], ["px", "NVDA"], "for the quote, naming the focus ticker so the hub reads this name's gamma too");
    const c1 = R.conns[0];
    await page.waitForFunction(() => /400\.00/.test(document.getElementById("ftPx").textContent), null, { timeout: 5000 }).catch(() => {});
    const px = () => page.evaluate(() => document.getElementById("ftPx").textContent);
    ok(/400/.test(await px()), `the polled quote paints first (${(await px()).slice(0, 40)})`);
    R.send(c1, R.hello(["px"], { px: [quote("NVDA", 401.25, 395, R.now - 500)] }));
    await R.pump(80);
    ok(/401\.25/.test(await px()), `the streamed quote repaints the ticker's price (${(await px()).slice(0, 40)})`);
    R.now += 1000;
    await page.clock.runFor(1000);
    R.send(c1, R.delta("px", [quote("NVDA", 402.5, 395, R.now - 300)]));
    await R.pump(80);
    ok(/402\.50/.test(await px()), `and a delta moves it again (${(await px()).slice(0, 40)})`);
    R.send(c1, R.delta("px", [quote("AMD", 100, 99, R.now)]));
    await R.pump(40);
    ok(/402\.50/.test(await px()), "a delta for another name leaves it alone");
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (want("hub")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    const { clock, vendor, hub, lose, step, same } = rigHub(page, R);
    await connect(page, { topics: ["px", "fl", "gx", "mk", "nw"], focus: "NVDA" });
    await R.nextConn();
    await step(12);
    eq(await transport(page), "socket", "THE CLIENT AGAINST THE REAL HUB: hello over a bridged socket lands the page on the socket rung");
    const st = await status(page);
    ok(TOPICS.every((k) => st.topics[k].synced && !st.topics[k].resync), `every topic synced (${JSON.stringify(Object.fromEntries(TOPICS.map((k) => [k, st.topics[k].sq])))})`);
    ok(hub.topics.px.state.rows.size >= 3, `the hub holds ${hub.topics.px.state.rows.size} px rows`);
    let cmp = await same();
    deep([...cmp.mine.keys()].sort(), [...cmp.held.keys()].sort(), "the page holds exactly the hub's tickers");
    ok([...cmp.held].every(([t, v]) => JSON.stringify(cmp.mine.get(t)) === JSON.stringify(v)), "with the hub's own values, row for row");
    eq((await page.evaluate(() => window.FlowsUI.rt.alerts().rows.length)) > 0, true, "flow alerts flowed");
    eq((await measure(page)).gaps, 0, "no gap on a clean run");
    ok((await page.evaluate(() => window.FlowsUI.rt.alerts().rows.map((r) => r.id))).every((id) => hub.topics.fl.state.ring.some((r) => r.id === id)), "and the page's alert ids are the hub's");

    const sq = hub.counter.peek("px");
    lose.skip.add(sq + 1);
    await step(12);
    eq(lose.px, 1, "ONE px FRAME LOST IN TRANSIT");
    ok((await measure(page)).gaps >= 1, "the client saw the gap");
    await step(8);
    const st2 = await status(page);
    eq(st2.topics.px.resync, false, "and the hub's snapshot (answered to the rs) ended the resync");
    cmp = await same();
    ok([...cmp.held].every(([t, v]) => JSON.stringify(cmp.mine.get(t)) === JSON.stringify(v)), "leaving the page equal to the hub again");
    ok(R.messages().some((m) => m.t === "rs" && m.k === "px"), "after exactly the message the contract names");

    hub.start(clock.t, { notify: "restart" });
    await step(10);
    const st3 = await status(page);
    ok(TOPICS.every((k) => st3.topics[k].synced && !st3.topics[k].resync), "A HUB RESTART (new epoch, resync, fresh snapshots) is absorbed: every topic is synced in the new epoch");
    eq(st3.topics.px.ep, hub.ep, "on the hub's epoch");
    cmp = await same();
    ok(cmp.held.size > 0 && [...cmp.held].every(([t, v]) => JSON.stringify(cmp.mine.get(t)) === JSON.stringify(v)), "with equal state");

    vendor.fault = "500";
    await step(25);
    ok((await status(page)).degraded !== null, `a vendor that fails twenty-five seconds shows as degraded (${JSON.stringify((await status(page)).degraded)})`);
    vendor.fault = null;
    await step(25);
    const st4 = await status(page);
    eq(st4.degraded, null, "and recovery clears it");
    ok(TOPICS.every((k) => st4.topics[k].synced && !st4.topics[k].resync), "with every topic resynced from the recovery snapshots");

    const gxT = [...hub.topics.gx.state.rows.keys()][0];
    const gxRow = await page.evaluate((t) => window.FlowsUI.rt.gex(t), gxT);
    ok(gxRow && gxRow.t === gxT && gxRow.px === hub.topics.gx.state.rows.get(gxT).value[2], `the gamma row for ${gxT} reaches the page as the hub holds it`);
    const nwIds = await page.evaluate(() => window.FlowsUI.rt.news().map((r) => r.id));
    deep(nwIds, hub.topics.nw.state.ring.map((r) => r.id), "and the headlines are the hub's, in its order");
    const mkP = await page.evaluate(() => window.FlowsUI.rt.market(null));
    ok(mkP && mkP.tide.n >= 1 && mkP.sectors && mkP.sectors.rows.length > 0, "and the market adapter builds a live:market body from the tide point and the sector rows");
    const frames = (await measure(page)).frames;
    ok(frames > 40, `(${frames} topic frames, ${(await measure(page)).bytes} bytes received in all)`);
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (process.env.RT_ONLY && want("measure")) {
    const NAMES = Array.from({ length: 157 }, (_, i) => "N" + String(i).padStart(3, "0"));
    const board = {
      side: "long", generatedAt: iso(T0 - 20 * 3600000), sessionDate: PREV, status: "ok", universe: 264, enriched: 60,
      rows: NAMES.map((t, i) => ({ t, r: i + 1, s: 90 - (i % 40), cnv: 80, px: 100 + i, chg: 0.01, purity: 0.02, sector: "Technology",
        gRegime: "long", gFlipDist: -0.1, netPrem: 1e7, fam: { F: 10, P: 20, D: 30, V: 40, O: 50 }, edte: 20 })),
    };
    const roster = async () => ({ clock: null, boards: { long: { sessionDate: PREV, rows: NAMES.map((t) => ({ t, s: 50, px: 100 })) }, short: null, watch: null }, focus: null });
    let rig = null;
    const { ctx, page, R } = await mount(browser, {
      html: PAGES.sidePage({ username: "test", side: "long" }), url: "/flows/long/", fake: false,
      answer: (key) => (key.startsWith("board?side=long") ? { body: board } : null),
      setup: async (R, page) => {
        rig = rigHub(page, R, { roster });
        await page.addInitScript(() => {
          window.__m = { mut: 0 };
          document.addEventListener("DOMContentLoaded", () => new MutationObserver((rs) => { window.__m.mut += rs.length; }).observe(document.body, { childList: true, attributes: true, characterData: true, subtree: true }));
        });
      },
    });
    await page.waitForSelector("#flowsBody .bd-row", { state: "attached" });
    await R.until(() => R.conns.length >= 1);
    await rig.step(14);
    eq(await transport(page), "socket", "measure: the board is on the socket against the real hub");
    eq(rig.hub.topics.px.state.rows.size >= 157, true, `measure: the hub holds ${rig.hub.topics.px.state.rows.size} px rows`);
    await page.evaluate(() => { window.__m.mut = 0; window.__rafMs.length = 0; });
    const k0 = JSON.parse(JSON.stringify((await measure(page)).kinds));
    await rig.step(60);
    const m = await page.evaluate(() => ({ mut: window.__m.mut, raf: window.__rafMs.slice() }));
    const k1 = (await measure(page)).kinds;
    const diff = (k) => { const a = k0[k] || [0, 0, 0], b = k1[k] || [0, 0, 0]; return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; };
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const kinds = Object.keys(k1);
    const bytes = kinds.reduce((a, k) => a + diff(k)[1], 0);
    const msgs = kinds.reduce((a, k) => a + diff(k)[0], 0);
    const px = diff("px");
    const snap = async (ks) => JSON.stringify((await rig.hub.snap(ks)).frames).length;
    const one = await snap(["px"]);
    const all = await snap(TOPICS);
    const strips = (await import("../shared/flows-live.js")).shapeStrips;
    const live = await import("../scripts/flows-legs/live-fake.mjs");
    const rest = JSON.stringify(strips(live.fakeScreenerRows(NAMES, { session: DAY, dated: true, now: R.now }), { at: R.now, session: DAY, names: NAMES, writer: "w" })).length;
    console.log("MEASURE px frames in 60 s:", px[0], "mean bytes", Math.round(px[1] / px[0]), "mean receive path ms (parse, merge, queue, register)", (px[2] / px[0]).toFixed(2));
    console.log("MEASURE per kind [frames, mean bytes, mean ms]:", JSON.stringify(Object.fromEntries(kinds.map((k) => { const d = diff(k); return [k, [d[0], Math.round(d[1] / Math.max(1, d[0])), +(d[2] / Math.max(1, d[0])).toFixed(3)]]; }))));
    console.log("MEASURE animation-frame flushes:", m.raf.length, "mean ms", avg(m.raf).toFixed(2), "max", Math.max(0, ...m.raf).toFixed(2), "| DOM mutation records:", m.mut, "per px frame", (m.mut / Math.max(1, px[0])).toFixed(1));
    console.log("MEASURE transitMs (an estimate, relative to the hello):", JSON.stringify((await measure(page)).transitMs));
    console.log("MEASURE bytes per minute received on the socket (every topic, a vendor that moves every row each poll):", bytes, "in", msgs, "messages");
    console.log("MEASURE one snapshot response: px", one, "all five topics", all, "=> poll rung per minute: px only", one * 12, "all five", all * 12, "| stored strips body, 157 names:", rest);
    const pxs = { length: px[0] };
    ok(pxs.length >= 10, "measure: about twelve px frames in a minute");
    await ctx.close();

    let rig2 = null;
    const all5 = await mount(browser, { html: coreHtml(), fake: false, setup: async (R2, page2) => { rig2 = rigHub(page2, R2, { roster }); } });
    await connect(all5.page, { topics: TOPICS });
    await all5.R.nextConn();
    await rig2.step(14);
    const j0 = JSON.parse(JSON.stringify((await measure(all5.page)).kinds));
    await rig2.step(60);
    const j1 = (await measure(all5.page)).kinds;
    const per = Object.fromEntries(Object.keys(j1).map((k) => { const a = j0[k] || [0, 0, 0], b = j1[k]; return [k, [b[0] - a[0], Math.round((b[1] - a[1]) / Math.max(1, b[0] - a[0])), +((b[2] - a[2]) / Math.max(1, b[0] - a[0])).toFixed(3)]]; }));
    const total = Object.keys(j1).reduce((n, k) => n + j1[k][1] - (j0[k] || [0, 0, 0])[1], 0);
    console.log("MEASURE all five topics, per kind [frames, mean bytes, mean ms] in 60 s:", JSON.stringify(per), "| bytes per minute:", total);
    await all5.ctx.close();
  }

  if (want("closedpoll")) {
    const { ctx, page, R } = await mount(browser, { html: coreHtml() });
    R.mode = "refuse";
    const closed = () => R.ctl("closed", { phase: "closed", reason: "overnight", day: DAY, lastClosed: PREV, nextOpenAt: iso(R.now + 120000), nextRthOpenAt: iso(R.now + 3600000) });
    const state = { closed: true };
    R.snap = { status: 200, headers: {}, frames: () => [R.snapshot("px", [quote("NVDA", 200, 190, R.now - 1000)]), ...(state.closed ? [closed()] : [])] };
    await connect(page, { topics: ["px"] });
    await R.nextConn();
    await R.until(() => R.snapHits.length >= 1);
    await R.pump();
    eq(await transport(page), "poll", "on the poll rung");
    eq((await status(page)).closed.reason, "overnight", "A CLOSED FRAME IN A SNAPSHOT RESPONSE IS A STATE, not an error: the page is told the market is closed");
    eq((await status(page)).final, 0, "and the rail is not off");
    const n = R.snapHits.length;
    await R.adv(100000, 10000);
    eq(R.snapHits.length, n, "polling STOPS while closed: no request in the next 100 s");
    state.closed = false;
    await R.adv(40000, 5000);
    await R.until(() => R.snapHits.length > n, 2000);
    ok(R.snapHits.length > n, "and wakes at the open the frame named (a request after nextOpenAt)");
    await R.adv(20000, 5000);
    ok(R.snapHits.length >= n + 4, `then polls every five seconds again (${R.snapHits.length - n} requests)`);
    eq((await status(page)).closed, null, "with the closed state cleared");
    deep(page.errors, [], "nothing threw");
    await ctx.close();
  }

  if (want("heartbeat")) {
    const run = async (rail) => {
      const { ctx, page, R } = await mount(browser, {
        html: PAGES.unusualPage({ username: "test" }), url: "/flows/unusual/", rail,
        answer: (key, u, R) => {
          if (key.startsWith("now")) return { body: { serverNow: R.now, expected: PREV, phase: RTH, keys: {} } };
          return null;
        },
      });
      if (!rail) R.snap = { status: 404, frames: () => [], headers: {} };
      else R.onConn = (c) => R.send(c, R.hello(["fl"], {}));
      await page.waitForTimeout(100);
      await R.adv(100000, 5000);
      const now = page.asked.filter((a) => /^now/.test(a.key)).map((a) => decodeURIComponent(a.key));
      const other = page.asked.map((a) => a.key.replace(/\?.*/, "")).filter((k) => k !== "now").sort().join();
      const res = { now, other, transport: await transport(page) };
      await ctx.close();
      return res;
    };
    const off = await run(false);
    const on = await run(true);
    eq(off.transport, "off", "a page whose rail answers 404 is off");
    eq(on.transport, "socket", "and one whose rail is up is on the socket");
    deep(on.now, off.now, "THE EXISTING HEARTBEAT IS UNTOUCHED: the same /api/flows/now requests at the same cadence with the socket up as without it");
    ok(on.now.length >= 3, `(${on.now.length} beats in 100 s)`);
    eq(on.other, off.other, "and the rail adds no other /api/flows request");
  }
} finally {
  await browser.close();
}
console.log(`flows-rt-client: ${checks} checks passed`);
