import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const HTML = PAGES.flowsDocument({
  title: "Link", description: "x", active: "ticker", username: "test", chrome: false,
  body: '<button id="btn" type="button">focus</button><div id="table"></div><div id="chart"></div><div id="scene"></div><div id="b1"></div><div id="b2"></div><div id="solo"></div>',
});

async function serve(context) {
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await context.addInitScript(() => {
    window.__v = {};
    window.__opened = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
    window.__mk = (name, cfg) => {
      const el = document.getElementById(name);
      const rec = { calls: [], el };
      rec.h = window.FlowsUI.link.join(name, Object.assign({}, cfg, { on(sel) { rec.calls.push(sel); if (sel.kind !== "time") el.dataset.lit = String(sel.value); } }));
      window.__v[name] = rec;
      return rec;
    };
    window.__frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  });
}

const attached = (page) => page.waitForFunction(() => typeof window.FlowsUI.link.attach === "undefined", null, { timeout: 8000 });
const lit = (page, ids) => page.evaluate((ids) => Object.fromEntries(ids.map((i) => [i, document.getElementById(i).dataset.lit || null])), ids);
const URL0 = "https://example.test/flows/fixture/";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await serve(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL0);

  eq(await page.evaluate(() => Object.keys(window.FlowsUI.link).sort()), ["attach", "context", "cursor", "describe", "emit", "join", "popout", "ready"],
    "FlowsUI.link exists from the first byte of flows-ui.js as a queue stub, with the body not yet loaded");
  eq(await page.evaluate(() => performance.getEntriesByType("resource").some((r) => /flows-link\.js/.test(r.name))), false,
    "and the body is not fetched by a page that never joins");

  await page.evaluate(() => {
    window.__mk("table", { channel: "A" });
    window.__mk("chart", { channel: "A" });
    window.__mk("b1", { channel: "B" });
    window.__mk("solo", { channel: null });
  });
  await attached(page);
  ok(await page.evaluate(() => performance.getEntriesByType("resource").some((r) => /flows-link\.js\?v=\d+/.test(r.name))), "the first join loads the body from beside flows-ui.js with the same ?v=");
  eq(await page.evaluate(() => Object.keys(window.FlowsUI.link).sort()), ["context", "cursor", "describe", "emit", "join", "popout", "ready"], "and attach removes itself once the body is in");
  eq(await lit(page, ["table", "chart", "b1", "solo"]), { table: null, chart: null, b1: null, solo: null }, "a join with nothing selected lights nothing");

  const storage = () => page.evaluate(() => JSON.stringify({ l: Object.keys(localStorage), s: Object.keys(sessionStorage), c: document.cookie }));
  const storage0 = await storage();
  await page.focus("#btn");

  const one = await page.evaluate(async () => {
    window.FlowsUI.link.emit("table", { kind: "ticker", value: "nvda", source: "table" });
    await window.__frame();
    return { chart: window.__v.chart.el.dataset.lit, table: window.__v.table.el.dataset.lit || null, solo: window.__v.solo.el.dataset.lit, b1: window.__v.b1.el.dataset.lit || null,
      calls: [window.__v.table.calls.length, window.__v.chart.calls.length, window.__v.solo.calls.length, window.__v.b1.calls.length], first: window.__v.chart.calls[0] };
  });
  eq([one.chart, one.solo], ["NVDA", "NVDA"], "A SELECTION IN ONE VIEW SETS data-lit IN THE OTHERS ON THE SAME CHANNEL (and in a member on no channel) before the frame it was made in is over, value normalised");
  eq([one.table, one.b1], [null, null], "and in neither the emitter itself nor a member of another channel");
  eq(one.calls, [0, 1, 1, 0], "each receiver is called once, the emitter never");
  eq(one.first, { channel: "A", kind: "ticker", value: "NVDA", source: "table" }, "with the channel, kind, value and source");

  const late = await page.evaluate(async () => {
    window.__mk("scene", { channel: "A", kinds: ["ticker", "sector"] });
    await window.__frame();
    const caught = document.getElementById("scene").dataset.lit || null;
    window.FlowsUI.link.emit("chart", { kind: "ticker", value: "AMD", source: "chart" });
    await window.__frame();
    return { caught, scene: document.getElementById("scene").dataset.lit, table: document.getElementById("table").dataset.lit, chart: document.getElementById("chart").dataset.lit };
  });
  eq(late.caught, "NVDA", "A MEMBER THAT JOINS LATE (the 3D module arriving after first paint) is lit with the current selection in its first frame");
  eq([late.scene, late.table, late.chart], ["AMD", "AMD", "NVDA"], "and with the module present a selection made anywhere reaches it and the 2D views in one frame, the emitter keeping its own");

  const burst = await page.evaluate(async () => {
    const before = ["table", "scene", "solo"].map((k) => window.__v[k].calls.length);
    for (let i = 0; i < 100; i++) window.FlowsUI.link.emit("chart", { kind: "ticker", value: "T" + i, source: "chart" });
    await window.__frame();
    const after = ["table", "scene", "solo"].map((k) => window.__v[k].calls.length);
    return { delta: after.map((n, i) => n - before[i]), lit: document.getElementById("table").dataset.lit, chartCalls: window.__v.chart.calls.length };
  });
  eq(burst.delta, [1, 1, 1], "100 EMISSIONS IN ONE FRAME DELIVER ONE to each receiver");
  eq(burst.lit, "T99", "and the last one wins");

  eq(await page.evaluate(() => document.activeElement && document.activeElement.id), "btn", "FOCUS IS UNCHANGED by any of it: the button that held it still does");
  const live = await page.evaluate(() => { const n = document.getElementById("fxLive"); return n ? { text: n.textContent, live: n.getAttribute("aria-live") } : null; });
  ok(live && live.live === "polite" && /Linked views follow ticker/.test(live.text), `the receivers are told in a polite live region (${JSON.stringify(live)})`);

  const spoken = await page.evaluate(async () => {
    const n = document.getElementById("fxLive");
    let writes = 0;
    const mo = new MutationObserver(() => { writes++; });
    mo.observe(n, { childList: true, characterData: true, subtree: true });
    for (let i = 0; i < 6; i++) { window.FlowsUI.link.emit("chart", { kind: "sector", value: "XL" + "KFEUVP"[i], source: "chart" }); await window.__frame(); await window.__frame(); }
    await new Promise((r) => setTimeout(r, 30));
    mo.disconnect();
    return writes;
  });
  ok(spoken <= 1, `and spoken at most once in five seconds, however many selections are made in them (${spoken} writes in six selections)`);

  eq(await page.evaluate(() => location.hash), "#l=A:s=XLP", "THE URL CARRIES THE SELECTION: one entry per channel, the last emission of the channel");
  await page.evaluate(async () => {
    window.FlowsUI.link.emit("b1", { kind: "sector", value: "XLK", source: "b1" });
    window.FlowsUI.link.emit("solo", { kind: "expiry", value: "2026-10-16", source: "solo" });
    window.FlowsUI.link.emit("table", { kind: "strike", value: 450.5, source: "table" });
    window.FlowsUI.link.cursor({ tau: "2026-10-05T14:41:00Z", clock: "known" });
    await window.__frame();
  });
  const hash = await page.evaluate(() => location.hash);
  eq(hash, "#l=A:k=450.5;B:s=XLK;tc=known@2026-10-05T14:41:00Z", "and the time cursor with its clock, in the form the plan writes");

  const d = await page.evaluate(() => window.FlowsUI.link.describe());
  eq(Object.keys(d), ["scene", "mode", "tau", "clock", "selection"], "describe() returns the scene, mode, tau, clock and selection");
  eq([d.scene, d.tau, d.clock, d.selection], ["fixture", "2026-10-05T14:41:00.000Z", "known", { A: "k=450.5", B: "s=XLK" }], "from the live state");
  const long = await page.evaluate(() => {
    window.FlowsUI.link.context({ scene: "s".repeat(80), mode: "m".repeat(80) });
    window.FlowsUI.link.emit("b1", { kind: "sector", value: "S" + "x".repeat(23), source: "b1" });
    window.FlowsUI.link.emit("table", { kind: "expiry", value: "2026-10-16", source: "table" });
    window.FlowsUI.link.emit("solo", { kind: "side", value: "abcdefgh", source: "solo" });
    return { d: window.FlowsUI.link.describe(), n: JSON.stringify(window.FlowsUI.link.describe()).length };
  });
  ok(long.n <= 256, `and never more than 256 bytes, whatever the page put in it (${long.n})`);
  eq([long.d.scene.length, long.d.mode.length], [24, 16], "its free text capped");

  await page.evaluate(async () => { await window.__frame(); });
  eq(await page.evaluate(() => document.activeElement && document.activeElement.id), "btn", "focus still on the button after the cursor and the rest");
  eq(await storage(), storage0, "NO BROWSER STORAGE: no local or session key and no cookie was written by any of it");

  const src = fs.readFileSync(path.join(ROOT, "assets/js/flows-link.js"), "utf8");
  ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(src), "and the body names no storage API");

  eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
  await page.close();

  {
    const p = await context.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(URL0 + "#l=" + hash.slice(3));
    await p.evaluate(() => {
      window.__mk("table", { channel: "A" });
      window.__mk("b1", { channel: "B" });
      window.__mk("solo", { channel: null, kinds: ["time", "ticker", "strike", "sector"] });
    });
    await attached(p);
    const got = await p.evaluate(async () => {
      await window.__frame();
      return { table: document.getElementById("table").dataset.lit || null, b1: document.getElementById("b1").dataset.lit || null, solo: window.__v.solo.calls.map((c) => c.kind + "=" + c.value), cur: window.FlowsUI.link.cursor() };
    });
    eq([got.table, got.b1], ["450.5", "XLK"], "THE HASH ROUND-TRIPS: a page opened on the URL lights its views from it, strike and sector alike");
    eq(got.solo.slice().sort(), ["sector=XLK", "strike=450.5", "time=2026-10-05T14:41:00.000Z"], "and delivers the time cursor as a time selection, to the members that take it");
    eq(got.cur, { tau: "2026-10-05T14:41:00.000Z", clock: "known" }, "which cursor() reads back");
    ok(await p.evaluate(() => location.hash) === hash, "without rewriting the URL it was given");
    eq(errs.length, 0, `nothing threw (${errs.join("; ")})`);
    await p.close();
  }

  for (const bad of ["#l=A:t=%00;Z:q=1;tc=bogus@x;B:s=%3Cscript%3E;A:t=%E0%A4%A;C:d=BUY;A:k=1e9", "#l=", "#l=;;;", "#l=A:constructor=x;A:__proto__=y", "#x=1"]) {
    const p = await context.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(URL0 + bad);
    await p.evaluate(() => { window.__mk("table", { channel: null }); });
    await attached(p);
    const got = await p.evaluate(async () => { await window.__frame(); await window.__frame(); return { calls: window.__v.table.calls.length, cur: window.FlowsUI.link.cursor() }; });
    eq([got.calls, got.cur, errs.length], [0, null, 0], `a hash that says nothing valid is ignored, not thrown at: ${bad}`);
    await p.close();
  }

  {
    const p = await context.newPage();
    await p.goto(URL0);
    const out = await p.evaluate(async () => {
      const a = window.__mk("table", { channel: "A", clocks: ["event"] });
      const b = window.__mk("chart", { channel: "A", kinds: ["sector"] });
      const c = window.__mk("b1", { channel: "A" });
      const e = window.__mk("solo", { channel: "A" });
      const f = window.__mk("b2", { channel: "B" });
      await new Promise((r) => { const t = setInterval(() => { if (typeof window.FlowsUI.link.attach === "undefined") { clearInterval(t); r(); } }, 5); });
      const link = window.FlowsUI.link;
      const refused = [["constructor", "x"], ["__proto__", "x"], ["ticker", "<img src=x>"], ["ticker", "toolongticker1"], ["ticker", 5], ["strike", -1], ["strike", "1e9"], ["expiry", "2026-13-99x"], ["time", "not a time"], ["side", "Call"], ["sector", "a;b"], [["ticker"], "NVDA"]]
        .map(([k, v]) => link.emit("solo", { kind: k, value: v, source: "x" }));
      await window.__frame();
      const afterBad = [a, b, c].map((r) => r.calls.length);
      link.emit("solo", { kind: "ticker", value: "AAPL", source: "solo" });
      await window.__frame();
      const kinds = [a, b, c, f].map((r) => r.calls.length);
      link.cursor({ tau: Date.parse("2026-10-05T14:41:00Z"), clock: "known" }, "solo");
      await window.__frame();
      await new Promise((r) => setTimeout(r, 5300));
      const afterKnown = { a: a.calls.map((x) => x.kind), c: c.calls.map((x) => x.kind), e: e.calls.length, say: document.getElementById("fxLive").textContent };
      link.cursor({ tau: "2026-10-05T14:42:00Z", clock: "event" });
      await window.__frame();
      const afterEvent = { a: a.calls.map((x) => x.kind + ":" + x.clock), c: c.calls[c.calls.length - 1].clock, cur: link.cursor() };
      link.cursor(null);
      await window.__frame();
      const live = { a: a.calls[a.calls.length - 1], cur: link.cursor(), hash: location.hash };
      const bogus = [link.cursor({ tau: "x", clock: "known" }), link.cursor({ tau: "2026-10-05T14:42:00Z", clock: "wall" })];
      b.h.leave();
      link.emit("solo", { kind: "sector", value: "XLF", source: "solo" });
      await window.__frame();
      return { refused, afterBad, kinds, afterKnown, afterEvent, live, bogus, left: b.calls.length };
    });
    eq(out.refused, new Array(12).fill(false), "AN EMISSION THAT IS NOT A KIND WITH A VALID VALUE IS REFUSED, prototype names, a kind that is an array, markup, separators and bad numbers included");
    eq(out.afterBad, [0, 0, 0], "and reaches no one");
    eq(out.kinds, [1, 0, 1, 0], "a member that lists its kinds hears only those, and a member of another channel nothing");
    eq(out.afterKnown.c, ["ticker", "time"], "the time cursor reaches every member that takes time, but not the one that set it");
    eq(out.afterKnown.a, ["ticker"], "A MEMBER THAT CANNOT HONOUR A CLOCK IS NOT HANDED ONE");
    ok(/table has only event time and cannot follow the known clock/.test(out.afterKnown.say), `and the page is told so in the live region (${out.afterKnown.say})`);
    eq(out.afterEvent.a.slice(-1), ["time:event"], "while an event clock reaches it");
    eq(out.afterEvent.c, "event", "and the others with the clock named");
    eq(out.live.a.value, null, "cursor(null) hands a time of null to the members: back to live");
    eq([out.live.cur, out.live.hash], [null, "#l=A:t=AAPL"], "and the hash drops its tc");
    eq(out.bogus, [null, null], "a cursor with a bad time or an unknown clock changes nothing");
    eq(out.left, 0, "a member that has left is not called again");
    await p.close();
  }

  {
    const p = await context.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(URL0 + "#l=A:t=NVDA");
    await p.evaluate(() => { window.__mk("table", { channel: "A" }); window.__mk("chart", { channel: "A" }); });
    await attached(p);
    const nav = (h) => p.evaluate((h) => new Promise((r) => { addEventListener("hashchange", () => setTimeout(r, 30), { once: true }); location.hash = h; }), h);
    const sel = () => p.evaluate(() => window.FlowsUI.link.describe().selection);
    for (const h of ["#panel-gamma", "#flowsMain", "#ftg-x", "#m-1"]) {
      await nav(h);
      eq(await sel(), { A: "t=NVDA" }, `THE SELECTION SURVIVES A JUMP TO ${h}: a hash that is not the link's is not a clear`);
      await p.evaluate(async () => { window.FlowsUI.link.emit("chart", { kind: "ticker", value: "AMD", source: "chart" }); await window.__frame(); window.FlowsUI.link.emit("chart", { kind: "ticker", value: "NVDA", source: "chart" }); await window.__frame(); });
      eq(await p.evaluate(() => location.hash), h, `and an emission does not overwrite the page's own ${h}`);
    }
    const calls = await p.evaluate(() => window.__v.table.calls.length);
    await nav("#l=A:t=TSLA");
    eq(await p.evaluate(() => [location.hash, window.__v.table.calls.length > 0, document.getElementById("table").dataset.lit]), ["#l=A:t=TSLA", true, "TSLA"], "while a link hash arriving later is taken as before");
    await nav("#l=");
    eq(await sel(), {}, "and a link hash that carries no selection still clears it");
    ok(calls >= 0 && errs.length === 0, `nothing threw (${errs.join("; ")})`);
    await p.close();
  }

  {
    const p = await context.newPage();
    await p.goto(URL0);
    const r = await p.evaluate(async () => {
      const L = window.FlowsUI.link;
      const early = typeof L.popout("/flows/fixture/");
      const pr = L.ready();
      const same = pr === L.ready();
      await Promise.race([pr, new Promise((x) => setTimeout(x, 6000))]);
      const attachedNow = typeof L.attach === "undefined";
      window.__opened.length = 0;
      const tok = L.popout("/flows/fixture/?a=1");
      return { early, same, attachedNow, tok: typeof tok, opened: window.__opened.slice() };
    });
    eq([r.early, r.same, r.attachedNow, r.tok], ["boolean", true, true, "string"], "READY LOADS THE BODY WITHOUT A JOIN and settles once it is attached, so a pop-out control can be armed before it can be clicked");
    ok(r.opened.length === 1 && /^\/flows\/fixture\/\?a=1#l=w=[0-9a-f]{16}$/.test(r.opened[0]), `and a pop-out after it opens synchronously, path and query kept (${r.opened[0]})`);
    await p.close();
  }

  await context.close();

  {
    const win = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await serve(win);
    const A = await win.newPage();
    const errs = [];
    A.on("pageerror", (e) => errs.push(String(e)));
    await A.goto(URL0);
    await A.evaluate(() => { window.__mk("table", { channel: "A" }); window.__mk("chart", { channel: "A" }); });
    await attached(A);
    eq(await A.evaluate(() => [window.FlowsUI.link.popout("https://evil.example/x"), window.FlowsUI.link.popout("//evil.example/x"), window.FlowsUI.link.popout("javascript:alert(1)"), window.FlowsUI.link.popout("x".repeat(300)), window.__opened.length]), [null, null, null, null, 0],
      "popout opens only a path on this origin: an absolute URL, a protocol-relative one, a script URL or an enormous one open nothing");
    const sneaky = ["/\\evil.example/x", "/\t/evil.example/x", "/\n/evil.example", "/\r/evil.example", "/\u0000/evil.example", "/\u0085/x", "/ok\\..\\x", "\\\\evil.example/x", "", 5, null, ["/a"]];
    const verdicts = await A.evaluate((list) => ({ got: list.map((p) => window.FlowsUI.link.popout(p)), opened: window.__opened.length }), sneaky);
    eq(verdicts, { got: new Array(12).fill(null), opened: 0 },
      "AND A BACKSLASH, TAB, NEWLINE, RETURN, NUL OR C1 CONTROL IN THE PATH, which the URL parser turns into another host, opens nothing");
    await A.evaluate(async () => { window.FlowsUI.link.emit("table", { kind: "ticker", value: "NVDA", source: "table" }); await window.__frame(); });
    const token = await A.evaluate(() => window.FlowsUI.link.popout("/flows/fixture/"));
    ok(/^[0-9a-f]{16}$/.test(token), `popout makes a 16 hex digit window-group token (${token})`);
    const opened = await A.evaluate(() => window.__opened.slice());
    eq(opened, ["/flows/fixture/#l=A:t=NVDA;w=" + token], "and opens the path on the current selection and that token, so the new window starts where this one is");
    eq(await A.evaluate(() => location.hash), "#l=A:t=NVDA;w=" + token, "this window carries the token too, so a reload keeps the group");

    const B = await win.newPage();
    B.on("pageerror", (e) => errs.push(String(e)));
    await B.addInitScript((tok) => {
      window.__frames = 0;
      (function loop() { window.__frames++; requestAnimationFrame(loop); })();
      window.__msgAt = [];
      window.__litAt = [];
      window.addEventListener("DOMContentLoaded", () => {
        const ch = new BroadcastChannel("flows-link:" + tok);
        ch.onmessage = () => window.__msgAt.push(window.__frames);
        new MutationObserver(() => window.__litAt.push(window.__frames)).observe(document.getElementById("chart"), { attributes: true, attributeFilter: ["data-lit"] });
      });
    }, token);
    await B.goto("https://example.test" + opened[0]);
    await B.evaluate(() => { window.__mk("table", { channel: "A" }); window.__mk("chart", { channel: "A" }); });
    await attached(B);
    await B.evaluate(() => window.__frame());
    eq(await lit(B, ["table", "chart"]), { table: "NVDA", chart: "NVDA" }, "THE POPPED-OUT WINDOW STARTS ON THE SELECTION it was opened with");

    const keys = (p) => p.evaluate(() => JSON.stringify({ l: Object.keys(localStorage), s: Object.keys(sessionStorage), c: document.cookie }));
    const keysA = await keys(A), keysB = await keys(B);
    await B.evaluate(() => { window.__msgAt.length = 0; window.__litAt.length = 0; });
    await A.evaluate(() => { window.FlowsUI.link.emit("table", { kind: "ticker", value: "AMD", source: "table" }); });
    await B.waitForFunction(() => document.getElementById("chart").dataset.lit === "AMD", null, { timeout: 5000 });
    const lat = await B.evaluate(() => ({ msg: window.__msgAt.slice(), lit: window.__litAt.slice(), table: document.getElementById("table").dataset.lit }));
    eq(lat.msg.length, 1, "A SELECTION IN ONE WINDOW reaches the other as one message");
    ok(lat.lit.length >= 1 && lat.lit[0] - lat.msg[0] <= 1, `and sets data-lit there within one frame of arriving (message in frame ${lat.msg[0]}, lit in frame ${lat.lit[0]})`);
    eq(lat.table, "AMD", "in every view of the other window, including the one that shares the emitter's name");
    eq(await A.evaluate(() => document.getElementById("chart").dataset.lit), "AMD", "and the emitting window lit its own other view as before");

    await A.evaluate(() => { window.__msgCount = 0; new BroadcastChannel("flows-link:" + location.hash.match(/w=([0-9a-f]+)/)[1]).onmessage = () => { window.__msgCount++; }; });
    await B.evaluate(() => { window.FlowsUI.link.emit("chart", { kind: "sector", value: "XLK", source: "chart" }); window.FlowsUI.link.cursor({ tau: "2026-10-05T14:41:00Z", clock: "event" }); });
    await A.waitForFunction(() => document.getElementById("table").dataset.lit === "XLK", null, { timeout: 5000 });
    await A.waitForTimeout(150);
    const back = await A.evaluate(() => ({ count: window.__msgCount, cur: window.FlowsUI.link.cursor(), hash: location.hash }));
    eq(back.count, 1, "the reply travels once and is not echoed back and forth between the windows");
    eq(back.cur, { tau: "2026-10-05T14:41:00.000Z", clock: "event" }, "the time cursor crosses with its clock");
    eq(back.hash, "#l=A:s=XLK;tc=event@2026-10-05T14:41:00Z;w=" + token, "and the first window's own URL follows");
    await B.evaluate(() => { window.FlowsUI.link.cursor(null); });
    await A.waitForFunction(() => window.FlowsUI.link.cursor() === null, null, { timeout: 5000 });
    ok(true, "and cursor(null) travels as well");

    eq([await keys(A), await keys(B)], [keysA, keysB], "NO STORAGE KEY OR COOKIE IS WRITTEN in either window by any of it");

    const C = await win.newPage();
    C.on("pageerror", (e) => errs.push(String(e)));
    await C.goto(URL0 + "#l=w=0123456789abcdef");
    await C.evaluate(() => { window.__mk("table", { channel: "A" }); });
    await attached(C);
    await A.evaluate(() => { window.FlowsUI.link.emit("table", { kind: "ticker", value: "TSLA", source: "table" }); });
    await C.waitForTimeout(250);
    eq(await lit(C, ["table"]), { table: null }, "a window in another group hears nothing");

    const before = await lit(A, ["table", "chart"]);
    await C.evaluate((tok) => {
      const ch = new BroadcastChannel("flows-link:" + tok);
      const send = (m) => ch.postMessage(m);
      send({ v: 1, id: "x", s: { A: { kind: "ticker", value: "<b>x</b>", source: "x" } } });
      send({ v: 2, id: "x", s: { A: { kind: "ticker", value: "FAKE", source: "x" } } });
      send({ v: 1, id: "x", s: { A: { kind: "constructor", value: "FAKE" } } });
      send({ v: 1, id: "x", s: { A: { kind: ["ticker"], value: "FAKE", source: "x" } } });
      send({ v: 1, id: "x", s: { A: { kind: "ticker", value: "FAKE", source: "y".repeat(900) } } });
      send({ v: 1, id: "x", s: "FAKE" });
      send({ v: 1, id: "x", s: {}, c: { tau: "nope", clock: "known" } });
      send({ v: 1, id: "x", s: {}, c: { tau: "2026-10-05T14:41:00Z", clock: "wall" } });
      send(null);
      send("FAKE");
    }, token);
    await A.waitForTimeout(300);
    eq(await lit(A, ["table", "chart"]), before, "MESSAGES THAT ARE NOT A VALID SELECTION (bad kind, an array kind, bad value, wrong version, oversize, a cursor with a bad time or clock, junk) change nothing");
    await C.evaluate((tok) => {
      new BroadcastChannel("flows-link:" + tok).postMessage({ v: 1, id: "x", s: { A: { kind: "ticker", value: "ok1", source: "peer" } } });
    }, token);
    await A.waitForFunction(() => document.getElementById("table").dataset.lit === "OK1", null, { timeout: 5000 });
    ok(true, "while a valid one from the same group is taken, value normalised");
    eq(errs.length, 0, `nothing threw (${errs.join("; ")})`);
    await win.close();
  }

} finally {
  await browser.close();
}
console.log(`flows-link: ${checks} checks passed`);
