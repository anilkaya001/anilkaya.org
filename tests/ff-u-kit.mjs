import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { HOOKS } from "../shared/ff-contract.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const KERNEL = "assets/js/flows-ff-kernel.js";
const CLIENT = "assets/js/flows-ff-client.js";
const TOKENS = HOOKS.tokensFile;
const DASH = "—";

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const plant = (file, from, to) => {
  const src = read(file);
  if (src.split(from).length !== 2) throw new Error("plant anchor must occur exactly once in " + file + ": " + from.slice(0, 70));
  return src.replace(from, () => to);
};

function tokenProblems(css, globals) {
  const out = [];
  const block = /:root\s*\{([^}]*)\}/.exec(css);
  if (!block) return ["no :root block"];
  const decls = block[1].split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(":"); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; });
  const names = decls.map((d) => d[0]);
  if (!same(names, HOOKS.tokens)) out.push("the tokens are not the contract's list, in its order");
  for (const [name, value] of decls) {
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (!m) { out.push(name + " is not one existing token"); continue; }
    if (m[1].startsWith("--ff-")) out.push(name + " points at another Fire token");
    else if (!new RegExp("(^|[\\s;{])" + m[1] + "\\s*:").test(globals)) out.push(name + " points at " + m[1] + ", which no shipped sheet defines");
  }
  if (/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\(/.test(css)) out.push("a colour literal");
  if (/\/\*/.test(css)) out.push("a comment");
  const selectors = [...css.matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) => m[2].trim());
  for (const s of selectors) if (s !== ":root" && !/^\.ffx-[a-z-]+$/.test(s)) out.push("a selector outside :root and .ffx-: " + s);
  return out;
}

function sourceProblems(src, file) {
  const out = [];
  if (!/^\(function \(\) \{\n {2}"use strict";/.test(src) || !/\}\)\(\);\n$/.test(src)) out.push(file + " is not one strict IIFE");
  if (/\/\*|(^|[^:"'`\\])\/\/[^\n]*$/m.test(src)) out.push(file + " carries a comment");
  if (/\b(localStorage|sessionStorage|indexedDB|XMLHttpRequest|sendBeacon|WebSocket|EventSource|innerHTML|outerHTML|insertAdjacentHTML|eval)\b|new Function|\bimport\(/.test(src)) out.push(file + " reaches for storage, markup or another network door");
  if (/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test(src)) out.push(file + " carries a colour literal");
  const globals = [...src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=[^=]/g)].map((m) => m[1]);
  if (!same([...new Set(globals)], ["FlowsUI"])) out.push(file + " assigns a global other than FlowsUI");
  return out;
}

const STUB = `(function () {
  "use strict";
  window.__fix = { host: false, nameIn: function (t) { return /"SY[A-Z][0-9]{3}"/.test(t); }, marked: function (t) { return /"fixture":true/.test(t); } };
  window.__calls = [];
  var real = window.fetch;
  window.fetch = function (path, init) {
    window.__calls.push({ path: String(path), method: init && init.method, credentials: init && init.credentials, signal: !!(init && init.signal), self: this === window });
    return real.call(window, path, init);
  };
  window.FlowsUI = Object.freeze({ fixture: window.__fix });
})();`;

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>kit</title><link rel="stylesheet" href="/t.css"></head><body>
<main data-ff-page="fire"><span id="a"></span><span id="b"></span><i data-ff-slot="mark" id="mark"></i><i data-ff-slot="bogus" id="bogus"></i>
<ul id="list" style="height:60px;overflow:hidden;margin:0;padding:0;list-style:none"><li style="height:25px">1</li><li style="height:25px">2</li><li style="height:25px">3</li><li style="height:25px">4</li></ul>
<p id="clip" class="ffx-clip" style="width:60px;margin:0">A line that is far too long for its sixty pixel box</p>
<p id="fits" class="ffx-clip" style="width:600px;margin:0">Short</p>
<p id="own" class="ffx-clip" title="Mine" style="width:60px;margin:0">Another line that is far too long for its box</p></main>
<script src="/stub.js"></script><script src="/kernel.js"></script><script src="/client.js"></script></body></html>`;

async function open(browser, { kernel = read(KERNEL), client = read(CLIENT), tokens = read(TOKENS) } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  const seen = { etag: [], echo: [] };
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const json = (body, status = 200, headers = {}) => r.fulfill({ status, contentType: "application/json", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
    if (p === "/stub.js") return r.fulfill({ contentType: "text/javascript", body: STUB });
    if (p === "/kernel.js") return r.fulfill({ contentType: "text/javascript", body: kernel });
    if (p === "/client.js") return r.fulfill({ contentType: "text/javascript", body: client });
    if (p === "/t.css") return r.fulfill({ contentType: "text/css", body: ":root{--up:green;--label-1:black;--label-2:gray;--label-3:silver;--warn:orange;--down:red;--accent-ink:blue;--sep:gray;--mat-regular:white}" + tokens });
    if (p === "/api/ff/ok") return json({ v: 1, a: 1 });
    if (p === "/api/flows/universe") return json({ status: "ok", n: 2 });
    if (p === "/api/ff/echo") { seen.echo.push({ method: req.method(), body: req.postData(), headers: req.headers() }); return json({ v: 1, method: req.method() }); }
    if (p === "/api/ff/refuse") return json({ error: { code: "ff_budget_exceeded", message: "The weekly budget is spent" }, used: 1.9, adding: 0.4, max: 2 }, 409);
    if (p === "/api/ff/nested") return json({ error: { code: "ff_wire_invalid", message: "m", details: { where: "all[0]" } }, other: 1 }, 400);
    if (p === "/api/ff/limited") return json({ error: { code: "rate_limited", message: "Too many requests; try again shortly." } }, 429, { "Retry-After": "60" });
    if (p === "/api/ff/bare503") return r.fulfill({ status: 503, contentType: "text/plain", body: "" });
    if (p === "/api/ff/teapot") return r.fulfill({ status: 418, contentType: "text/plain", body: "nope" });
    if (p === "/api/ff/garbage") return r.fulfill({ status: 200, contentType: "text/html", body: "<html>" });
    if (p === "/api/ff/empty") return r.fulfill({ status: 204, body: "" });
    if (p === "/api/ff/hang") return new Promise((resolve) => setTimeout(() => resolve(r.abort().catch(() => {})), 2500));
    if (p === "/api/ff/down") return r.abort();
    if (p === "/api/ff/etag") {
      const inm = req.headers()["if-none-match"] || null;
      seen.etag.push(inm);
      if (inm === '"a1"') return r.fulfill({ status: 304, headers: { ETag: '"a1"' }, body: "" });
      return json({ v: 1, n: seen.etag.length }, 200, { ETag: '"a1"' });
    }
    if (p === "/api/ff/preview") return json({ v: 1, serverNow: 5, preview: { status: "ok", coverage: { wouldHit: 3 } } });
    if (p === "/api/ff/fixture") return json({ v: 1, t: "SYA101" });
    if (p === "/api/ff/marked") return json({ fixture: true, v: 1 });
    if (p.startsWith("/api/")) return json({ error: { code: "not_found", message: "Not found" } }, 404);
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
  });
  await page.goto("https://example.test/");
  return { ctx, page, seen, errors };
}

async function observeKernel(browser, over) {
  const { ctx, page, errors } = await open(browser, over);
  try {
    const got = await page.evaluate(async () => {
      const K = window.FlowsUI.ffKernel;
      const o = {};
      const $ = (id) => document.getElementById(id);
      o.shape = [Object.keys(K).sort(), Object.keys(K.hooks).sort(), Object.keys(K.fit).sort(), Object.isFrozen(K), Object.isFrozen(K.hooks), Object.isFrozen(K.fit), Object.isFrozen(window.FlowsUI)];
      o.lists = [K.hooks.PAGES, K.hooks.STATES, K.hooks.SLOTS, K.hooks.EVENTS];
      o.dash = K.DASH;
      o.page = K.hooks.page();
      o.slot = [K.hooks.slot("mark") === $("mark"), K.hooks.slot("bogus"), K.hooks.slot("history")];
      const a = $("a");
      o.state = [K.hooks.state(a, "live"), a.getAttribute("data-ff-state"), K.hooks.state(a, "sparkling"), a.getAttribute("data-ff-state"), K.hooks.state(null, "live")];
      o.absent = [K.hooks.absent(a, "source_missing", "the nightly figures are not in yet"), a.getAttribute("data-ff-absent"), a.textContent];
      o.absentBare = [K.hooks.absent(a, "run_late"), a.textContent];
      o.absentBad = [K.hooks.absent(a, "Not A Code!", "— already dashed"), a.getAttribute("data-ff-absent"), a.textContent];
      o.present = [K.hooks.present(a, "1 in 12 sessions"), a.hasAttribute("data-ff-absent"), a.textContent];
      o.presentEmpty = [K.hooks.present(a, "  "), a.getAttribute("data-ff-absent"), K.hooks.present(a, "—"), a.textContent];
      o.zero = [K.hooks.present(a, "0"), a.hasAttribute("data-ff-absent")];
      const b = $("b");
      o.figure = [
        K.hooks.figure(b, { v: 4, text: "1 in 4 sessions" }), b.hasAttribute("data-ff-absent"),
        K.hooks.figure(b, { v: null, text: "—", reason: "short_history", reasonText: "under 20 sessions of history" }), b.getAttribute("data-ff-absent"),
        K.hooks.figure(b, { v: 0, text: "0", reason: "stale" }), b.getAttribute("data-ff-absent"),
        K.hooks.figure(b, null, "not measured"), b.getAttribute("data-ff-absent"),
      ];
      let writes = 0;
      const mo = new MutationObserver((list) => { writes += list.length; });
      mo.observe(a, { attributes: true, childList: true, characterData: true, subtree: true });
      K.hooks.state(a, "live");
      K.hooks.present(a, "steady");
      await Promise.resolve();
      mo.takeRecords();
      writes = 0;
      K.hooks.state(a, "live");
      K.hooks.present(a, "steady");
      writes += mo.takeRecords().length;
      mo.disconnect();
      o.idle = writes;
      const heard = [];
      const off = K.hooks.on("ff:unread", (d) => heard.push(d));
      const raw = [];
      document.addEventListener("ff:health", (e) => raw.push(e.detail));
      o.emit = [
        K.hooks.emit("ff:unread", { house: 2, member: 1, total: 3, extra: 9 }),
        K.hooks.emit("ff:unread", { house: 2 }),
        K.hooks.emit("ff:nope", { a: 1 }),
        K.hooks.emit("ff:health", { state: "sparkling", evaluator: "nightly" }),
      ];
      document.dispatchEvent(new CustomEvent("ff:unread", { detail: { house: 1 } }));
      off();
      K.hooks.emit("ff:unread", { house: 0, member: 0, total: 0 });
      o.heard = heard;
      o.raw = raw;
      o.onBad = typeof K.hooks.on("ff:nope", () => {});
      const list = $("list");
      o.rows = K.fit.rows(list);
      o.rowsCut = [...list.children].map((c) => c.classList.contains("ffx-cut"));
      o.rowsHidden = [...list.children].map((c) => getComputedStyle(c).display);
      list.style.height = "10px";
      o.rowsKeep = K.fit.rows(list, { keep: 2 });
      list.style.height = "200px";
      o.rowsBack = K.fit.rows(list);
      o.rowsNone = K.fit.rows(null);
      o.clip = [K.fit.clip($("clip")), $("clip").getAttribute("title"), K.fit.clip($("fits")), $("fits").hasAttribute("title"), K.fit.clip($("own")), $("own").getAttribute("title")];
      $("clip").style.width = "900px";
      o.unclip = [K.fit.clip($("clip")), $("clip").hasAttribute("title")];
      $("own").style.width = "900px";
      o.ownKept = [K.fit.clip($("own")), $("own").getAttribute("title")];
      let runs = 0;
      const stop = K.fit.watch(list, () => { runs++; });
      const first = runs;
      list.style.height = "120px";
      await new Promise((resolve) => setTimeout(resolve, 200));
      const grown = runs;
      stop();
      list.style.height = "40px";
      await new Promise((resolve) => setTimeout(resolve, 200));
      o.watch = [first >= 1, grown > first, runs === grown];
      const cs = getComputedStyle(document.documentElement);
      o.tokens = ["--ff-live", "--ff-down", "--ff-rule", "--ff-surface"].map((t) => cs.getPropertyValue(t).trim());
      return o;
    });
    got.errors = errors;
    return got;
  } finally {
    await ctx.close();
  }
}

const KERNEL_WANT = {
  shape: [["DASH", "fit", "hooks"], ["EVENTS", "PAGES", "SLOTS", "STATES", "absent", "emit", "figure", "on", "page", "present", "slot", "state"], ["clip", "rows", "watch"], true, true, true, true],
  lists: [HOOKS.pages, HOOKS.states, HOOKS.slots, Object.fromEntries(Object.entries(HOOKS.events).map(([k, v]) => [k, v.detail]))],
  dash: DASH,
  page: "fire",
  slot: [true, null, null],
  state: ["live", "live", "unknown", "unknown", null],
  absent: [DASH + " the nightly figures are not in yet", "source_missing", DASH + " the nightly figures are not in yet"],
  absentBare: [DASH + " run late", DASH + " run late"],
  absentBad: [DASH + " already dashed", "missing", DASH + " already dashed"],
  present: ["1 in 12 sessions", false, "1 in 12 sessions"],
  presentEmpty: [DASH + " missing", "missing", DASH + " missing", DASH + " missing"],
  zero: ["0", false],
  figure: ["1 in 4 sessions", false, DASH + " under 20 sessions of history", "short_history", DASH + " stale", "stale", DASH + " not measured", "missing"],
  idle: 0,
  emit: [true, false, false, true],
  heard: [{ house: 2, member: 1, total: 3 }],
  raw: [{ state: "unknown", evaluator: "nightly" }],
  onBad: "function",
  rows: { total: 4, shown: 2, cut: 2 },
  rowsCut: [false, false, true, true],
  rowsHidden: ["list-item", "list-item", "none", "none"],
  rowsKeep: { total: 4, shown: 2, cut: 2 },
  rowsBack: { total: 4, shown: 4, cut: 0 },
  rowsNone: { total: 0, shown: 0, cut: 0 },
  clip: [true, "A line that is far too long for its sixty pixel box", false, false, true, "Mine"],
  unclip: [false, false],
  ownKept: [false, "Mine"],
  watch: [true, true, true],
  tokens: ["green", "red", "gray", "white"],
  errors: [],
};

const KERNEL_SAYS = {
  shape: "FlowsUI.ffKernel is { DASH, hooks, fit }, frozen, on a frozen FlowsUI",
  lists: "its pages, states, slots and events are the contract's",
  dash: "its dash is the em dash",
  page: "page() reads data-ff-page",
  slot: "slot() finds a contract slot and refuses any other name",
  state: "state() writes one of the five health states and anything else as unknown",
  absent: "absent() writes an em dash with the reason sentence and the reason code",
  absentBare: "a reason with no sentence is said in words",
  absentBad: "a reason that is not a code is filed as missing and a leading dash is not doubled",
  present: "present() writes the figure and clears the absent mark",
  presentEmpty: "an empty figure or a bare dash is absent, never blank",
  zero: "a zero is a figure",
  figure: "figure() prints an API figure, or the dash with the API's reason, and a figure that carries a reason is absent",
  idle: "an unchanged state and figure write nothing",
  emit: "emit() sends only a contract event with every field of its detail",
  heard: "on() hands a listener the contract's fields alone and stops when asked",
  raw: "a health event with an unknown state travels as unknown",
  onBad: "on() of an unknown event is a no-op that still returns a function",
  rows: "rows() hides trailing rows until the list fits",
  rowsCut: "from the end",
  rowsHidden: "with a class the tokens sheet hides",
  rowsKeep: "and keeps the rows it is told to keep",
  rowsBack: "a list with room shows every row again",
  rowsNone: "rows() of nothing is an empty count",
  clip: "clip() says whether a line is cut and puts the whole line in its title, never over a title the page wrote",
  unclip: "a line that fits again loses the title the kernel gave it",
  ownKept: "and keeps a title the page wrote",
  watch: "watch() runs at once, again on a resize, and not after it is stopped",
  tokens: "the tokens resolve to the page's own tokens",
  errors: "no page error",
};

async function observeClient(browser, over) {
  const { ctx, page, seen, errors } = await open(browser, over);
  try {
    const got = await page.evaluate(async () => {
      const C = window.FlowsUI.ffClient;
      const o = {};
      const fail = (p) => p.then((v) => ({ resolved: v }), (e) => ({ code: e.code, status: e.status, message: e.message, details: e.details, retryAfterS: e.retryAfterS, isError: e instanceof Error }));
      o.shape = [Object.keys(C).sort(), Object.isFrozen(C), Object.isFrozen(window.FlowsUI), !!window.FlowsUI.ffKernel];
      o.get = await C.get("/api/ff/ok");
      o.flows = await C.get("/api/flows/universe?cols=t");
      const before = window.__calls.length;
      o.post = await C.post("/api/ff/echo", { ast: { v: 1 } }, { headers: { "Idempotency-Key": "k-1", "If-None-Match": "x" } });
      await C.post("/api/ff/echo");
      await C.patch("/api/ff/echo", { id: "w" });
      await C.put("/api/ff/echo", { a: 1 });
      await C.del("/api/ff/echo");
      o.init = window.__calls.slice(before);
      o.refuse = await fail(C.post("/api/ff/refuse", {}));
      o.nested = await fail(C.post("/api/ff/nested", {}));
      o.limited = await fail(C.get("/api/ff/limited"));
      o.bare = await fail(C.get("/api/ff/bare503"));
      o.teapot = await fail(C.get("/api/ff/teapot"));
      o.missing = await fail(C.get("/api/ff/nothing-here"));
      o.garbage = await fail(C.get("/api/ff/garbage"));
      o.empty = await fail(C.get("/api/ff/empty"));
      o.down = await fail(C.get("/api/ff/down"));
      const t0 = performance.now();
      o.hang = await fail(C.get("/api/ff/hang", { deadlineMs: 150 }));
      o.hangFast = performance.now() - t0 < 1500;
      const n = window.__calls.length;
      o.paths = [];
      for (const [m, p] of [["get", "https://evil.test/api/ff/ok"], ["get", "//evil.test/api/ff/ok"], ["get", "/api/me/state"], ["get", "/api/ff/../me/state"], ["get", "/flows/fire/"], ["post", "/api/flows/ingest"], ["del", "/api/flows/ingest"], ["get", 5], ["get", "/api/ff/ok#x"]]) {
        o.paths.push((await fail(C[m](p))).code);
      }
      o.pathsSent = window.__calls.length - n;
      o.etag = [await C.get("/api/ff/etag"), await C.get("/api/ff/etag"), await C.get("/api/ff/etag", { headers: { "If-None-Match": '"zz"' } })];
      o.preview = await C.post("/api/ff/preview", { ast: {} });
      o.fixture = await fail(C.get("/api/ff/fixture"));
      o.marked = await fail(C.get("/api/ff/marked"));
      window.__fix.host = true;
      o.fixtureOnTestHost = await fail(C.get("/api/ff/fixture"));
      window.__fix.host = false;
      return o;
    });
    got.echo = seen.echo.map((e) => [e.method, e.body, e.headers["content-type"] || null, e.headers.accept, e.headers["idempotency-key"] || null, e.headers["if-none-match"] || null]);
    got.etagSeen = seen.etag;
    got.errors = errors;
    return got;
  } finally {
    await ctx.close();
  }
}

const sent = (method) => ({ path: "/api/ff/echo", method, credentials: "same-origin", signal: true, self: true });
const CLIENT_WANT = {
  shape: [["del", "get", "patch", "post", "put"], true, true, true],
  get: { v: 1, a: 1 },
  flows: { status: "ok", n: 2 },
  post: { v: 1, method: "POST" },
  init: ["POST", "POST", "PATCH", "PUT", "DELETE"].map(sent),
  refuse: { code: "ff_budget_exceeded", status: 409, message: "The weekly budget is spent", details: { used: 1.9, adding: 0.4, max: 2 }, retryAfterS: null, isError: true },
  nested: { code: "ff_wire_invalid", status: 400, message: "m", details: { where: "all[0]" }, retryAfterS: null, isError: true },
  limited: { code: "rate_limited", status: 429, message: "Too many requests; try again shortly.", details: null, retryAfterS: 60, isError: true },
  bare: { code: "service_unavailable", status: 503, message: "Service is temporarily unavailable", details: null, retryAfterS: null, isError: true },
  teapot: { code: "http_418", status: 418, message: "The request failed", details: null, retryAfterS: null, isError: true },
  missing: { code: "not_found", status: 404, message: "Not found", details: null, retryAfterS: null, isError: true },
  garbage: { code: "unreadable", status: 200, message: "Flows sent an answer that could not be read", details: null, retryAfterS: null, isError: true },
  empty: { resolved: null },
  down: { code: "network", status: 0, message: "Flows did not answer", details: null, retryAfterS: null, isError: true },
  hang: { code: "timeout", status: 0, message: "Flows did not answer in time", details: null, retryAfterS: null, isError: true },
  hangFast: true,
  paths: Array(9).fill("client_path"),
  pathsSent: 0,
  etag: [{ v: 1, n: 1 }, { v: 1, n: 1 }, { v: 1, n: 1 }],
  preview: { status: "ok", coverage: { wouldHit: 3 } },
  fixture: { code: "fixture", status: 200, message: "Flows was sent test data, so nothing is shown", details: null, retryAfterS: null, isError: true },
  marked: { code: "fixture", status: 200, message: "Flows was sent test data, so nothing is shown", details: null, retryAfterS: null, isError: true },
  fixtureOnTestHost: { resolved: { v: 1, t: "SYA101" } },
  echo: [
    ["POST", JSON.stringify({ ast: { v: 1 } }), "application/json", "application/json", "k-1", null],
    ["POST", "{}", "application/json", "application/json", null, null],
    ["PATCH", JSON.stringify({ id: "w" }), "application/json", "application/json", null, null],
    ["PUT", JSON.stringify({ a: 1 }), "application/json", "application/json", null, null],
    ["DELETE", null, null, "application/json", null, null],
  ],
  etagSeen: [null, '"a1"', '"a1"'],
  errors: [],
};

const CLIENT_SAYS = {
  shape: "FlowsUI.ffClient is { get, post, patch, put, del }, frozen, beside the kernel",
  get: "get() resolves the JSON body",
  flows: "and may read a Flows route",
  post: "post() resolves the JSON body",
  init: "every request goes through the page's own fetch, same-origin, with a deadline signal",
  refuse: "a refusal rejects with the Worker's code, status, message and the fields the Worker put beside the error",
  nested: "details nested in the error win over the fields beside it",
  limited: "a 429 carries Retry-After in seconds",
  bare: "a refusal with no body takes the Worker's code and message for its status",
  teapot: "an unknown status is http_<status>",
  missing: "a 404 is the Worker's own error",
  garbage: "a 200 that is not JSON is unreadable, never a value",
  empty: "an empty answer resolves null",
  down: "a network failure is code network",
  hang: "an answer that never comes is code timeout",
  hangFast: "at the deadline the caller asked for",
  paths: "any path but this site's Fire routes, and any write outside /api/ff/, is refused",
  pathsSent: "before a request is made",
  etag: "a 304 resolves the body the ETag was stored with",
  preview: "the preview route's envelope is unwrapped to the view",
  fixture: "a fixture name off a test host is refused",
  marked: "and so is a stamped body",
  fixtureOnTestHost: "on a test host the same answer is served",
  echo: "bodies are JSON with a JSON content type, a write with no body sends {}, a delete sends none, caller headers travel and a caller cannot set If-None-Match",
  etagSeen: "a repeat read is conditional on the stored ETag",
  errors: "no page error",
};

const judge = (got, want, says) => Object.keys(want).filter((k) => !same(got[k], want[k])).map((k) => says[k] + " (got " + JSON.stringify(got[k]) + ", want " + JSON.stringify(want[k]) + ")");

const KERNEL_PLANTS = [
  ["an absent figure is written as zero", ["write(el, DASH + \" \" + (said || why.replace(/_/g, \" \")))", "write(el, \"0\")"]],
  ["any word is a health state", ["var v = has(STATES, value) ? value : \"unknown\";", "var v = value;"]],
  ["an event travels without all its fields", ["      if (!own(detail, keys[i]) || detail[keys[i]] === undefined) return null;\n", ""]],
  ["the fitter cuts the rows it was told to keep", ["for (var i = kids.length - 1; i >= keep; i--) {", "for (var i = kids.length - 1; i >= 0; i--) {"]],
  ["a cut line gets no title", ["if (over && text) {", "if (over && !text) {"]],
  ["a figure keeps the absent mark", ["    if (el.hasAttribute(\"data-ff-absent\")) el.removeAttribute(\"data-ff-absent\");\n", ""]],
  ["any name is a slot", ["return has(SLOTS, name) ? document.querySelector", "return true ? document.querySelector"]],
  ["an unchanged figure is written again", ["if (el.textContent !== line) el.textContent = line;", "el.textContent = line;"]],
  ["a figure with a reason is printed", ["&& o.text.trim() !== DASH && !o.reason) return present(el, o.text);", "&& o.text.trim() !== DASH) return present(el, o.text);"]],
  ["a stopped watcher keeps running", ["      watching = false;\n      if (ro) ro.disconnect();", "      watching = true;"]],
  ["the kernel's title replaces the page's", ["if (!el.hasAttribute(\"title\") || TITLED.get(el) === true) {", "if (true) {"]],
];

const CLIENT_PLANTS = [
  ["the fields beside the error are dropped", ["res.status, detailsOf(body, e), isFinite(wait)", "res.status, isObj(e.details) ? e.details : null, isFinite(wait)"]],
  ["the preview envelope is not unwrapped", ["var UNWRAP = Object.freeze({ \"/api/ff/preview\": \"preview\" });", "var UNWRAP = Object.freeze({});"]],
  ["the caller's deadline is ignored", ["var ms = typeof o.deadlineMs === \"number\" && o.deadlineMs > 0 ? o.deadlineMs : DEADLINE_MS;", "var ms = DEADLINE_MS;"]],
  ["a write may leave the Fire routes", ["if (!m || (method !== \"GET\" && m[1] !== \"ff\")) {", "if (!m) {"]],
  ["any path is fetched", ["var m = typeof path === \"string\" ? PATH_RE.exec(path) : null;", "var m = typeof path === \"string\" ? [path, \"ff\"] : null;"]],
  ["a repeat read is never conditional", ["    if (known) headers.set(\"If-None-Match\", known.etag);\n", ""]],
  ["a 304 is read as a refusal", ["if (res.status === 304 && known) return", "if (false) return"]],
  ["fixture data is shown", ["if (guard && !guard.host && (guard.nameIn(text) || guard.marked(text))) {", "if (false) {"]],
  ["the fixture guard also refuses a test host", ["if (guard && !guard.host && (", "if (guard && ("]],
  ["Retry-After is dropped", ["isFinite(wait) && wait > 0 ? wait : null);", "null);"]],
  ["an unreadable 200 resolves", ["    if (!parsed.ok) return { error: failure(\"unreadable\", \"Flows sent an answer that could not be read\", res.status, null, null) };\n", ""]],
  ["a network failure has no code of its own", ["close({ error: failure(\"network\", \"Flows did not answer\", 0, null, null) });", "close({ error: failure(\"http_0\", \"Flows did not answer\", 0, null, null) });"]],
  ["the Worker's code is ignored", ["typeof e.code === \"string\" && e.code ? e.code : known", "false ? e.code : known"]],
  ["a write with no body sends none", ["return request(method, path, body === undefined ? {} : body, opts);", "return request(method, path, body, opts);"]],
  ["the session cookie is not sent", ["credentials: \"same-origin\"", "credentials: \"omit\""]],
  ["a caller sets If-None-Match", ["&& !/^if-none-match$/i.test(k)) headers.set", ") headers.set"]],
  ["caller headers are dropped", ["    Object.keys(given).forEach(function (k) {\n      if (typeof given[k] === \"string\" && !/^if-none-match$/i.test(k)) headers.set(k, given[k]);\n    });\n", ""]],
  ["no deadline signal", ["    if (ctl) init.signal = ctl.signal;\n", ""]],
  ["an unknown status has no code", ["known ? known[0] : \"http_\" + res.status,", "known ? known[0] : \"error\","]],
];

const TOKEN_PLANTS = [
  ["a colour literal in the tokens", (css) => css.replace("var(--up)", "#19c37d")],
  ["a contract token is missing", (css) => css.replace(/\s*--ff-absent:[^;]*;/, "")],
  ["a token nobody defines", (css) => css.replace("var(--sep)", "var(--separator-nope)")],
  ["a token the contract does not list", (css) => css.replace("--ff-rule:", "--ff-glow: var(--up);\n  --ff-rule:")],
  ["a rule that restyles the page", (css) => css + "\nbody { margin: 0; }\n"],
  ["a token that mixes a colour", (css) => css.replace("var(--warn)", "color-mix(in srgb, var(--warn) 50%, var(--up))")],
];

const globals = read("assets/css/base.css") + "\n" + read("assets/css/flows.css");
const tokensCss = read(TOKENS);
for (const p of tokenProblems(tokensCss, globals)) ok(false, "tokens: " + p);
ok(true, "the tokens sheet holds the contract's tokens, each one existing token, and no literal");
for (const f of [KERNEL, CLIENT]) {
  for (const p of sourceProblems(read(f), f)) ok(false, p);
  ok(true, f + " is one strict IIFE with no comment, no storage and one global");
}
ok(read(CLIENT).split("window.fetch.call(window, path, init)").length === 2 && (read(CLIENT).match(/fetch/g) || []).length === 1, "the client has one network door");
ok(!/fetch|XMLHttpRequest/.test(read(KERNEL)), "the kernel makes no request");
let tokenKills = 0;
for (const [name, make] of TOKEN_PLANTS) {
  const css = make(tokensCss);
  if (css === tokensCss) throw new Error("token plant changed nothing: " + name);
  if (tokenProblems(css, globals).length) tokenKills++;
  else failures.push("planted build survives: " + name);
}
const sourceKills = [
  ["a comment in the client", read(CLIENT).replace("  var DEADLINE_MS = 20000;", "  var DEADLINE_MS = 20000; // ms")],
  ["a second global", read(CLIENT).replace("  var etags = new Map();", "  var etags = new Map();\n  window.ffEtags = etags;")],
  ["browser storage in the client", read(CLIENT).replace("  var etags = new Map();", "  var etags = new Map();\n  localStorage.setItem(\"ff\", \"1\");")],
  ["a sloppy script", read(CLIENT).replace("  \"use strict\";\n", "")],
].map(([name, src]) => {
  if (sourceProblems(src, CLIENT).length) return 1;
  failures.push("planted build survives: " + name);
  return 0;
}).reduce((a, b) => a + b, 0);

const browser = await launch();
let kernelKills = 0;
let clientKills = 0;
try {
  const k = await observeKernel(browser);
  for (const key of Object.keys(KERNEL_WANT)) ok(same(k[key], KERNEL_WANT[key]), KERNEL_SAYS[key] + " (got " + JSON.stringify(k[key]) + ", want " + JSON.stringify(KERNEL_WANT[key]) + ")");
  const c = await observeClient(browser);
  for (const key of Object.keys(CLIENT_WANT)) ok(same(c[key], CLIENT_WANT[key]), CLIENT_SAYS[key] + " (got " + JSON.stringify(c[key]) + ", want " + JSON.stringify(CLIENT_WANT[key]) + ")");
  if (!failures.length) {
    for (const [name, [from, to]] of KERNEL_PLANTS) {
      const got = await observeKernel(browser, { kernel: plant(KERNEL, from, to) }).catch((e) => ({ crash: String(e) }));
      if (got.crash || judge(got, KERNEL_WANT, KERNEL_SAYS).length) kernelKills++;
      else failures.push("planted build survives: " + name);
    }
    for (const [name, [from, to]] of CLIENT_PLANTS) {
      const got = await observeClient(browser, { client: plant(CLIENT, from, to) }).catch((e) => ({ crash: String(e) }));
      if (got.crash || judge(got, CLIENT_WANT, CLIENT_SAYS).length) clientKills++;
      else failures.push("planted build survives: " + name);
    }
  }
} finally {
  await browser.close();
}

if (failures.length) {
  for (const f of failures) process.stderr.write("✗ " + f + "\n");
  process.stderr.write(`ff-u-kit: ${failures.length} failed of ${checks} checks\n`);
  process.exit(1);
}
process.stdout.write(`✓ ff-u-kit: ${checks} checks hold on the tokens, the kernel and the client\n`);
process.stdout.write(`✓ ff-u-kit: ${tokenKills + sourceKills + kernelKills + clientKills} of ${TOKEN_PLANTS.length + 4 + KERNEL_PLANTS.length + CLIENT_PLANTS.length} planted wrong builds fail\n`);
