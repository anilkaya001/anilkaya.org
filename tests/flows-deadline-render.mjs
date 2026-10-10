import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const T0 = Date.parse("2026-09-29T13:30:00-04:00");

const SCAN_DIR = path.join(ROOT, "assets/js");
for (const f of fs.readdirSync(SCAN_DIR)) {
  if (!f.endsWith(".js") || /\.bundle\.js$/.test(f)) continue;
  const src = fs.readFileSync(path.join(SCAN_DIR, f), "utf8");
  for (const m of src.matchAll(/AbortSignal\s*\.\s*(timeout|any)(\?\.)?/g)) ok(Boolean(m[2]), `${f} calls AbortSignal.${m[1]} unguarded, which throws on Safari below 16 (17.4 for any)`);
}
{
  const ui = fs.readFileSync(path.join(SCAN_DIR, "flows-ui.js"), "utf8");
  ok(/deadlineMs/.test(ui) && /new AbortController\(\)/.test(ui), "the wrapper bounds its own GET with an AbortController and a deadlineMs option");
  for (const f of ["flows-overview.js", "flows-ask.js"]) {
    const src = fs.readFileSync(path.join(SCAN_DIR, f), "utf8");
    ok(/deadlineMs:\s*15000/.test(src) && !/AbortSignal/.test(src), `${f} keeps its 15 s deadline through deadlineMs, not AbortSignal.timeout`);
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const mode = server.mode || {};
  if (u.pathname.startsWith("/assets/")) {
    const f = path.join(ROOT, u.pathname);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(f).pipe(res);
    return;
  }
  if (u.pathname.startsWith("/api/flows/")) {
    server.asked.push(u.pathname.slice("/api/flows/".length) + u.search);
    if (mode.api === "hang") return;
    if (mode.api === "body") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.write('{"status":"ok","rows":[');
      return;
    }
    if (mode.api === "fast") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ status: "pending" }));
      return;
    }
    if (mode.api === "401") {
      res.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end('{"error":{"code":"unauthorized"}}');
      return;
    }
  }
  if (u.pathname.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"error":{"code":"not_found"}}');
    return;
  }
  if (server.html && u.pathname.startsWith("/flows/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(server.html);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;

const WATCH = () => {
  window.__fx = [];
  const real = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = String((input && input.url) || input);
    const rec = { url, method: String((init && init.method) || "GET"), t0: Date.now(), t1: null, outcome: "open", signal: !!(init && init.signal) };
    window.__fx.push(rec);
    if (init && init.signal) init.signal.addEventListener("abort", () => { rec.t1 = Date.now(); rec.outcome = "aborted"; });
    const p = real(input, init);
    p.then((r) => { rec.headersAt = Date.now(); return r; }, () => { if (rec.outcome === "open") rec.outcome = "failed"; });
    return p;
  };
};

const LOADING = () => {
  const out = [];
  for (const el of document.querySelectorAll("#flowsMain *")) {
    if (!el.checkVisibility || !el.checkVisibility()) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
    if (/^(loading|reading|fetching)\b|…$|\.\.\.$/i.test(own) && /loading|reading|fetching|waiting|checking/i.test(own)) out.push(own.slice(0, 80));
  }
  const failed = document.querySelectorAll("[data-empty=unavailable],[data-empty=unreadable],[data-state=unavailable],[data-state=error],.is-error,[data-state=failed]").length;
  const busy = document.querySelectorAll("[aria-busy=true]").length;
  return { loading: [...new Set(out)], failed, busy };
};

const SUITE = [
  { id: "home", fn: "overviewPage", url: "/flows/", ms: 15000, args: { username: "anilkaya" } },
  { id: "board", fn: "sidePage", url: "/flows/long/", ms: 20000, args: { username: "anilkaya", side: "long" } },
  { id: "market", fn: "marketPage", url: "/flows/market/", ms: 20000 },
  { id: "events", fn: "eventsPage", url: "/flows/events/", ms: 20000 },
  { id: "ticker", fn: "tickerPage", url: "/flows/ticker/?t=NVDA", ms: 20000 },
  { id: "political", fn: "politicalPage", url: "/flows/political/", ms: 20000 },
  { id: "history", fn: "historyPage", url: "/flows/history/", ms: 20000 },
  { id: "track", fn: "trackPage", url: "/flows/track/", ms: 20000 },
  { id: "unusual", fn: "unusualPage", url: "/flows/unusual/", ms: 20000 },
  { id: "desk", fn: "deskPage", url: "/flows/desk/?t=NVDA", ms: 45000 },
  { id: "strategy", fn: "strategyPage", url: "/flows/strategy/?t=NVDA", ms: 45000 },
  { id: "ask", fn: "askPage", url: "/flows/ask/", ms: 15000 },
];

const browser = await launch();
try {
  for (const spec of SUITE) {
    server.html = String(PAGES[spec.fn]({ username: "anilkaya", ...(spec.args || {}) }));
    server.mode = { api: "hang" };
    server.asked = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(WATCH);
    await page.clock.install({ time: new Date(T0) });
    await page.clock.pauseAt(new Date(T0 + 1000));
    await page.goto(ORIGIN + spec.url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__fx.some((x) => /\/api\/flows\//.test(x.url)), null, { timeout: 20000 });
    await page.clock.runFor(2000);
    const early = await page.evaluate(() => window.__fx.filter((x) => /\/api\/flows\//.test(x.url)));
    ok(early.length > 0, `${spec.id}: the page asked for data (${early.length} requests)`);
    ok(early.every((x) => x.outcome === "open"), `${spec.id}: nothing has been abandoned at 3 s`);
    const lead = await page.evaluate(LOADING);
    await page.clock.runFor(spec.ms - 3000 - 1500);
    const before = await page.evaluate(() => window.__fx.filter((x) => /\/api\/flows\//.test(x.url) && x.outcome === "aborted").length);
    eq(before, 0, `${spec.id}: no request is abandoned before ${spec.ms} ms`);
    await page.clock.runFor(2500);
    const after = await page.evaluate(() => window.__fx.filter((x) => /\/api\/flows\//.test(x.url)));
    const waits = after.filter((x) => x.outcome === "aborted").map((x) => x.t1 - x.t0);
    ok(waits.length > 0, `${spec.id}: a hung request is abandoned (${waits.length} of ${after.length})`);
    ok(waits.every((w) => Math.abs(w - spec.ms) <= 5), `${spec.id}: at ${spec.ms} ms and not otherwise (${waits.join(", ")})`);
    await page.clock.runFor(1000);
    const end = await page.evaluate(LOADING);
    ok(end.loading.length === 0, `${spec.id}: no loading text survives 21 s (${JSON.stringify(end.loading)}; was ${JSON.stringify(lead.loading)})`);
    ok(end.failed > 0 || end.busy === 0, `${spec.id}: the page shows its own failure state (${JSON.stringify(end)})`);
    eq(errors.length, 0, `${spec.id}: nothing threw (${errors.join("; ")})`);
    await ctx.close();
  }
  {
    server.html = String(PAGES.marketPage({ username: "anilkaya" }));
    server.mode = { api: "fast" };
    server.asked = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(WATCH);
    await page.clock.install({ time: new Date(T0) });
    await page.clock.pauseAt(new Date(T0 + 1000));
    await page.goto(ORIGIN + "/flows/market/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__fx.some((x) => /\/api\/flows\//.test(x.url)), null, { timeout: 20000 });
    await page.clock.runFor(1000);
    server.mode = { api: "body" };
    await page.evaluate(() => {
      window.__r = {};
      const note = (k, p) => {
        const t0 = Date.now();
        window.__r[k] = "open";
        p.then(() => { window.__r[k] = "ok@" + (Date.now() - t0); }, (e) => { window.__r[k] = e.name + "@" + (Date.now() - t0); });
      };
      note("stall", fetch("/api/flows/stall").then((r) => r.json()));
      note("stall5", fetch("/api/flows/stall5", { deadlineMs: 5000 }).then((r) => r.text()));
      const own = new AbortController();
      note("own", fetch("/api/flows/own", { signal: own.signal }).then((r) => r.json()));
      window.__own = own;
      note("post", fetch("/api/flows/ask", { method: "POST", body: "{}" }).then((r) => r.text()));
      note("asset", fetch("/assets/version.txt").then((r) => r.text()));
    });
    await page.waitForFunction(() => window.__fx.filter((x) => /\/api\/flows\/(stall|stall5)$/.test(x.url)).every((x) => x.headersAt) && window.__r.asset !== "open", null, { timeout: 20000 });
    await page.clock.runFor(100);
    const rec = () => page.evaluate(() => ({ r: window.__r, fx: window.__fx.filter((x) => /\/api\/flows\/(stall|stall5|own|ask)$/.test(x.url) || /version/.test(x.url)).map((x) => [x.url.replace(/^.*\//, ""), x.method, x.signal]) }));
    const first = await rec();
    eq(first.r.stall, "open", "a body that has sent its headers and stalls is still pending at 0.1 s");
    ok(first.fx.some((x) => x[0] === "ask" && x[1] === "POST" && x[2] === false), `a POST is given no signal (${JSON.stringify(first.fx)})`);
    ok(first.fx.some((x) => x[0] === "version.txt" && x[2] === false), "a request outside /api/flows/ is given no signal");
    await page.clock.runFor(5000);
    ok(/^AbortError@50\d\d$|^AbortError@51\d\d$/.test((await rec()).r.stall5), `deadlineMs: 5000 ends a stalled body at 5 s (${(await rec()).r.stall5})`);
    eq((await rec()).r.stall, "open", "while the default 20 s deadline is still running");
    await page.clock.runFor(14000);
    eq((await rec()).r.stall, "open", "at 19.1 s the stalled body is still within its deadline");
    await page.clock.runFor(1500);
    const late = (await rec()).r;
    ok(/^AbortError@20\d\d\d?$/.test(late.stall) && Number(late.stall.split("@")[1]) <= 20300, `A BODY THAT STALLS AFTER ITS HEADERS ENDS AT THE DEADLINE, rejecting the pending json() (${late.stall})`);
    eq(late.own, "open", "a caller's own signal wins: the wrapper adds no deadline to it");
    eq(late.post, "open", "a POST is never aborted by the wrapper, a model call can outlast any fixed deadline");
    ok(/^ok@/.test(late.asset), "a request outside /api/flows/ is untouched");
    await page.clock.runFor(60000);
    eq((await rec()).r.own, "open", "and still pending after a minute");
    await page.evaluate(() => window.__own.abort());
    await page.clock.runFor(10);
    ok(/^AbortError/.test((await rec()).r.own), "until the caller aborts it");
    server.mode = { api: "fast" };
    await page.evaluate(() => {
      window.__r2 = "open";
      fetch("/api/flows/quick").then((r) => r.json()).then(() => { window.__r2 = "ok"; }, (e) => { window.__r2 = e.name; });
    });
    await page.waitForFunction(() => window.__r2 !== "open", null, { timeout: 20000 });
    eq(await page.evaluate(() => window.__r2), "ok", "a prompt answer is read");
    await page.clock.runFor(60000);
    const quick = await page.evaluate(() => window.__fx.filter((x) => /quick$/.test(x.url)).map((x) => x.outcome));
    eq(quick.join(), "open", `the deadline is disarmed once the body is read: the finished request is never aborted later (${quick})`);
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections?.();
  server.close();
}
console.log(`✓ flows-deadline-render: ${checks} assertions`);
