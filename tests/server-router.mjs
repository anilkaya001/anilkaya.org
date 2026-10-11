import assert from "node:assert/strict";
import * as K from "../server/http.js";
import { createRouter } from "../server/router.js";
import { flowsReadRows } from "../server/routes/flows-read.js";
import * as FLOWS_ASK from "../shared/flows-ask.js";
import * as FLOWS_LIVE from "../shared/flows-live-worker.js";
import { workerSource, expect, absent, treeFiles, moduleSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const SEED = Date.parse("2026-09-25T13:00:00.000Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(SEED); }
  static now() { return SEED; }
};

const req = (method, path = "/api/flows/board") => new Request("https://anilkaya.org" + path, { method });
const noop = async () => null;
const handler = () => new Response("handled");
const rowOf = (over = {}) => ({ id: "t.one", path: "/api/t/one", methods: ["GET"], auth: "flows", handler, ...over });
const thrown = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };
const view = (e) => (e ? { status: e.status, code: e.code, message: e.message, headers: e.headers, details: e.details } : null);

{
  for (const [label, bad] of [
    ["a row that is not an object", null],
    ["no id", rowOf({ id: "" })],
    ["a relative path", rowOf({ path: "api/t/one" })],
    ["the bare root", rowOf({ path: "/" })],
    ["no methods", rowOf({ methods: [] })],
    ["a method that is not HTTP", rowOf({ methods: ["FETCH"] })],
    ["an unknown auth gate", rowOf({ auth: "owner" })],
    ["no handler", rowOf({ handler: null })],
  ]) {
    ok(thrown(() => createRouter([bad])) !== null && (() => { try { createRouter([bad]); } catch { return true; } return false; })(), "createRouter refuses " + label);
  }
  const dup = (rows) => { try { createRouter(...rows); } catch (e) { return e instanceof TypeError; } return false; };
  ok(dup([[rowOf(), rowOf({ id: "t.two" })]]), "a path declared twice in one family is refused");
  ok(dup([[rowOf()], [rowOf({ id: "t.two" })]]), "a path declared twice across families is refused");
  ok(dup([[rowOf()], [rowOf({ path: "/api/t/two" })]]), "an id declared twice is refused");
  const r = createRouter([rowOf()], [rowOf({ id: "t.two", path: "/api/t/two", auth: "none", methods: ["GET", "POST"] })]);
  eq(r.rows.map((x) => x.id), ["t.one", "t.two"], "families are joined in order");
  ok(Object.isFrozen(r) && Object.isFrozen(r.rows) && Object.isFrozen(r.rows[0]) && Object.isFrozen(r.rows[0].methods), "the router, its rows and their method lists are frozen");
  eq(r.find("/api/t/two").auth, "none", "find returns the row by exact path");
  eq(r.find("/api/t/two/"), null, "a trailing slash is another path and finds nothing");
  eq(r.find("/api/t/zz"), null, "an unknown path finds nothing");
  const src = [rowOf()];
  const kept = createRouter(src);
  src[0].methods.push("DELETE");
  eq(kept.rows[0].methods, ["GET"], "a row's method list is copied, so the caller cannot widen it later");
}

{
  const calls = [];
  const gates = { flows: async (request, env) => { calls.push(["gate", request.method, env.tag]); return env.user || null; } };
  const seen = [];
  const r = createRouter([
    rowOf({ handler: async (rc) => { seen.push(rc); return new Response("one"); } }),
    rowOf({ id: "t.open", path: "/api/t/open", auth: "none", methods: ["GET", "POST"], handler: async (rc) => { seen.push(rc); return new Response("open"); } }),
  ]);
  const rc = (method, path, env = {}) => ({ request: req(method, path), env, url: new URL("https://anilkaya.org" + path), ctx: { id: 1 } });

  eq(await r.handle(rc("GET", "/api/t/none"), gates), null, "a path with no row returns null, so route() falls through to its chain");
  eq(calls, [], "and no gate ran for it");

  const wrong = await thrown(() => r.handle(rc("POST", "/api/t/one", { user: { id: "u" } }), gates));
  eq(view(wrong), { status: 405, code: "method_not_allowed", message: "Method not allowed", headers: { Allow: "GET" }, details: undefined }, "a wrong method is 405 with Allow");
  eq(calls, [], "ORDER: the method gate runs before the session gate, so an anonymous POST is 405 and the session is never read");
  const head = await thrown(() => r.handle(rc("HEAD", "/api/t/one", { user: { id: "u" } }), gates));
  eq(head && head.status, 405, "HEAD is not GET: a row lists the methods it serves");

  const anon = await thrown(() => r.handle(rc("GET", "/api/t/one", { tag: "a" }), gates));
  eq(view(anon), { status: 401, code: "unauthorized", message: "Authentication required", headers: undefined, details: undefined }, "an anonymous caller is 401");
  eq(seen.length, 0, "and the handler never ran");

  const user = { id: "u1" };
  const out = await r.handle(rc("GET", "/api/t/one", { tag: "b", user }), gates);
  eq(await out.text(), "one", "a member reaches the handler");
  eq([seen[0].session, seen[0].ctx, seen[0].url.pathname, seen[0].request.method], [user, { id: 1 }, "/api/t/one", "GET"], "which receives the session, ctx, url and request");
  eq(calls.at(-1), ["gate", "GET", "b"], "the gate was handed the request and the env");

  const before = calls.length;
  const open = await r.handle(rc("POST", "/api/t/open"), gates);
  eq([await open.text(), calls.length, seen.at(-1).session], ["open", before, null], "auth none never calls the session gate and hands the handler a null session");
}

const STUB = new Proxy({}, { get: () => () => null });
const table = createRouter(flowsReadRows(STUB));

{
  eq(table.rows.length, 25, "the flows-read family is 25 rows");
  ok(table.rows.every((r) => r.auth === "flows" && r.methods.length === 1 && r.methods[0] === "GET" && /^\/api\/flows\/[a-z-]+$/.test(r.path) && r.id === "flows." + r.path.slice("/api/flows/".length)),
    "every row is a GET behind the Flows session on /api/flows/<name> with the id flows.<name>");
  eq(new Set(table.rows.map((r) => r.path)).size, 25, "and no path is twice");
  eq(table.rows.map((r) => r.path.slice("/api/flows/".length)).sort(), [
    "board", "brief", "calib", "card", "card-x", "dispersion", "events", "flowalerts", "focus", "hist", "ideas", "market", "meta", "movers", "news", "political",
    "pulse", "record", "regime", "roster", "scoretrack", "sector-premium", "sectors", "universe", "unusual"], "the names are the ones the chain served");
}

class Ref extends Error {
  constructor(status, code, message, headers, details) { super(message); this.status = status; this.code = code; this.headers = headers; this.details = details; }
}
const refJson = K.json;

function scenario(over = {}) {
  const log = [];
  const s = {
    log,
    stored: {},
    unreadable: new Set(),
    overlay: {},
    kept: null,
    merged: null,
    briefLive: null,
    ...over,
  };
  const rec = (name, ...args) => log.push([name, ...args]);
  const row = (key) => (s.stored[key] === undefined ? null : s.stored[key]);
  const deps = {
    readServed: async (env, key) => { rec("readServed", key); if (s.unreadable.has(key)) throw new Ref(503, "store_unreadable", "The store could not be read"); return row(key); },
    readFlowsPayload: async (env, key, trace) => { rec("readFlowsPayload", key); if (s.unreadable.has(key)) { trace.failed = true; return null; } return row(key); },
    readWithOverlay: async (env, key) => { rec("readWithOverlay", key); return s.overlay[key] || { stored: row(key), overlaid: null, failed: s.unreadable.has(key) }; },
    passthrough: (stored) => { rec("passthrough", stored.payload); return new Response(stored.payload, { status: 200, headers: { "X-Pass": "1", "X-Payload-Updated": String(stored.updatedAt || 0) } }); },
    recallLastGood: async (request, url) => { rec("recallLastGood", url.search); return s.kept ? new Response(s.kept, { status: 200, headers: { "X-Fresh-State": "stale" } }) : null; },
    storeGone: () => new Ref(503, "store_unreadable", "The store could not be read", { "Retry-After": "30" }, { status: "unavailable", reason: "store" }),
    absentKey: async (env, ctx, kind, ticker, session) => { rec("absentKey", kind, ticker, session && session.id); return new Response("absent:" + kind + ":" + ticker); },
    cardWithEngine: async (env, ticker, stored, trace) => { rec("cardWithEngine", ticker); if (s.mergeFails) trace.failed = true; return s.merged || { stored, card: null, unreadable: false }; },
    briefWithLive: async (env, index) => { rec("briefWithLive"); return s.briefLive || { index, overlay: null }; },
    nightlyFreshHeaders: (stored) => (stored && stored.fresh ? { "X-Fresh-State": "live" } : {}),
    splitEngineMark: '"engine":{"status":"split"',
  };
  return { s, deps };
}

const MARK = '"engine":{"status":"split"';

async function reference(path, rc, d, s) {
  const { request, env, ctx, url, session } = rc;
  const json = refJson;
  const passthrough = d.passthrough;
  const readServed = d.readServed;
  const readFlowsPayload = d.readFlowsPayload;
  const storeGone = d.storeGone;
  if (path === "/api/flows/board") {
    const raw = url.searchParams.get("side");
    const side = raw === "short" || raw === "watch" ? raw : "long";
    const trace = {};
    const stored = await readFlowsPayload(env, "board:" + side, trace);
    if (stored === null) {
      const kept = trace.failed ? await d.recallLastGood(request, url) : null;
      if (kept) return kept;
      return json(trace.failed
        ? { side, rows: [], generatedAt: null, status: "pending", reason: "read-failed" }
        : { side, rows: [], generatedAt: null, status: "pending" });
    }
    return passthrough(stored);
  }
  if (path === "/api/flows/market") {
    const stored = await readServed(env, "market");
    if (stored === null) return json({ status: "pending" });
    return passthrough(stored);
  }
  if (path === "/api/flows/events") {
    const stored = await readServed(env, "events");
    if (stored === null) return json({ status: "pending" });
    return passthrough(stored);
  }
  if (path === "/api/flows/scoretrack") {
    const stored = await readServed(env, "scoretrack");
    if (stored === null) return json({ status: "pending" });
    return passthrough(stored);
  }
  if (path === "/api/flows/calib" || path === "/api/flows/dispersion") {
    const stored = await readServed(env, path.slice("/api/flows/".length));
    if (stored === null) return json({ status: "pending" });
    let view;
    try {
      view = JSON.parse(stored.payload);
      delete view.state;
    } catch {
      throw storeGone();
    }
    return passthrough({ ...stored, payload: JSON.stringify(view) });
  }
  if (path === "/api/flows/meta") {
    const stored = await readServed(env, "meta");
    if (stored === null) return json({ status: "pending" });
    return passthrough(stored);
  }
  if (path === "/api/flows/flowalerts" || path === "/api/flows/pulse" || path === "/api/flows/news") {
    const { stored, overlaid, failed } = await d.readWithOverlay(env, path.slice("/api/flows/".length));
    if (overlaid) return overlaid;
    if (failed) throw storeGone();
    if (stored === null) return json(path.endsWith("/news") ? { status: "pending", rows: [] } : { status: "pending" });
    return passthrough(stored);
  }
  if (path === "/api/flows/political") {
    const stored = await readServed(env, "political");
    if (stored === null) return json({ status: "pending" });
    return passthrough(stored);
  }
  if (path === "/api/flows/unusual") {
    const stored = await readServed(env, "unusual");
    if (stored === null) return json({ status: "pending" });
    return passthrough(stored);
  }
  if (path === "/api/flows/movers" || path === "/api/flows/sectors") {
    const key = path.endsWith("/movers") ? "movers" : "sector:trix";
    const stored = await readServed(env, key);
    if (stored === null) return json({ status: "pending", rows: [] });
    return passthrough(stored);
  }
  if (path === "/api/flows/sector-premium") {
    const stored = await readServed(env, "sector:premium");
    if (stored === null) return json({ status: "pending", sectors: [] });
    return passthrough(stored);
  }
  if (path === "/api/flows/universe" || path === "/api/flows/regime" || path === "/api/flows/ideas" || path === "/api/flows/focus" || path === "/api/flows/roster") {
    const key = path.slice("/api/flows/".length);
    const stored = await readServed(env, key);
    if (stored === null) return json({ status: "pending" });
    return passthrough(stored);
  }
  if (path === "/api/flows/brief") {
    const stored = await readServed(env, "brief");
    if (stored === null) {
      return json({ status: "pending", today: null, yesterday: null, next: null,
        facts: [], silences: { pending: [], unreadable: [], quiet: [], unavailable: [] } });
    }
    let index = null;
    try { index = JSON.parse(stored.payload); } catch { index = null; }
    if (!index || typeof index !== "object" || Array.isArray(index)) return passthrough(stored);
    const live = await d.briefWithLive(env, index);
    return json({ ...live.index, session: FLOWS_ASK.briefAge(live.index, new Date(), FLOWS_LIVE.memoizedClock()) }, 200,
      { "X-Payload-Updated": String(stored.updatedAt || 0), ...d.nightlyFreshHeaders(stored),
        ...(live.overlay ? { "X-Live-Overlay": live.overlay } : {}) });
  }
  if (path === "/api/flows/record") {
    const stored = await readServed(env, "record");
    if (stored === null) {
      return json({ status: "pending", horizons: [], sessions: 0 });
    }
    return passthrough(stored);
  }
  if (path === "/api/flows/card" || path === "/api/flows/card-x" || path === "/api/flows/hist") {
    const ticker = K.requireTicker(url);
    const kind = path.slice("/api/flows/".length);
    const stored = await readServed(env, kind + ":" + ticker);
    if (stored === null) return d.absentKey(env, ctx, kind, ticker, session);
    if (!stored.payload.includes(MARK)) return passthrough(stored);
    const trace = {};
    const merged = await d.cardWithEngine(env, ticker, stored, trace);
    if (trace.failed) throw storeGone();
    if (!merged.card) return passthrough(stored);
    return json(merged.card, 200, { "X-Payload-Updated": String(stored.updatedAt || 0) });
  }
  throw new Error("no reference for " + path);
}

async function outcome(run) {
  try {
    const res = await run();
    return { status: res.status, headers: [...res.headers].sort(), body: await res.text() };
  } catch (e) {
    return { threw: view(e) };
  }
}

const NIGHTLY_FIXED = { payload: '{"hello":1}', updatedAt: 1234, fresh: { session: "2026-09-24" } };
const NO_FRESH = { payload: '{"plain":true}', updatedAt: 0 };
const SPLIT = { payload: '{"engine":{"status":"split","key":"card-x:NVDA"}}', updatedAt: 99, fresh: { session: "2026-09-24" } };
const BRIEF_ROW = { payload: JSON.stringify({ sessionDate: "2026-09-24", generatedAt: "2026-09-24T21:00:00Z", refreshedAt: "2026-09-25T12:00:00Z", facts: [1] }), updatedAt: 55, fresh: { session: "2026-09-24" } };
const KEYS = ["board:long", "board:short", "board:watch", "market", "events", "scoretrack", "meta", "political", "unusual", "movers", "sector:trix",
  "sector:premium", "universe", "regime", "ideas", "focus", "roster", "record", "brief", "card:NVDA", "card-x:NVDA", "hist:NVDA", "flowalerts", "pulse", "news"];

const CASES = [];
for (const r of table.rows) {
  const name = r.path.slice("/api/flows/".length);
  const urls = name === "board" ? ["?side=long", "?side=short", "?side=watch", "?side=zz", ""]
    : ["card", "card-x", "hist"].includes(name) ? ["?t=NVDA", "?t=nvda", "?t=", "?t=NOT%20A%20TICKER", ""] : [""];
  for (const q of urls) CASES.push([r.path, q]);
}

{
  const worlds = {
    empty: () => ({}),
    full: () => Object.fromEntries(KEYS.map((k) => [k, NIGHTLY_FIXED])),
    plain: () => Object.fromEntries(KEYS.map((k) => [k, NO_FRESH])),
    split: () => ({ "card:NVDA": SPLIT, "card-x:NVDA": SPLIT, "hist:NVDA": SPLIT, brief: BRIEF_ROW }),
    brief: () => ({ brief: BRIEF_ROW }),
    briefBad: () => ({ brief: { payload: "not json", updatedAt: 3 } }),
    briefArray: () => ({ brief: { payload: "[1,2]", updatedAt: 4 } }),
    briefNull: () => ({ brief: { payload: "null", updatedAt: 4 } }),
  };
  const tweaks = [
    {},
    { unreadable: new Set(KEYS) },
    { unreadable: new Set(KEYS), kept: '{"kept":true}' },
    { mergeFails: true },
    { merged: { stored: null, card: { ticker: "NVDA", merged: true }, unreadable: false } },
    { briefLive: { index: { sessionDate: "2026-09-25", facts: [2] }, overlay: "market" } },
    () => ({ overlay: { pulse: { stored: null, overlaid: new Response("overlaid-pulse"), failed: false }, flowalerts: { stored: null, overlaid: new Response("overlaid-alerts"), failed: true }, news: { stored: NIGHTLY_FIXED, overlaid: null, failed: false } } }),
  ];
  let compared = 0;
  for (const [path, q] of CASES) {
    for (const [wname, world] of Object.entries(worlds)) {
      for (const tweak of tweaks) {
        const make = () => {
          const { s, deps } = scenario({ ...(typeof tweak === "function" ? tweak() : tweak), stored: world() });
          const session = { id: "u1" };
          const rcFor = () => ({ request: req("GET", path + q), env: { DB: {} }, url: new URL("https://anilkaya.org" + path + q), ctx: { tag: "ctx" }, session });
          return { s, deps, rcFor };
        };
        const a = make();
        const b = make();
        const rows = createRouter(flowsReadRows(a.deps));
        const got = await outcome(() => rows.find(path).handler(a.rcFor()));
        const want = await outcome(() => reference(path, b.rcFor(), b.deps, b.s));
        assert.deepEqual(got, want, `${path}${q} on world ${wname} with deps behaviour ${tweaks.indexOf(tweak)}`);
        assert.deepEqual(a.s.log, b.s.log, `${path}${q} on world ${wname}: the same calls in the same order`);
        compared++;
        checks += 2;
      }
    }
  }
  ok(compared >= 25 * 8 * 7, "every row was compared with the code it replaced across 8 worlds and 7 deps behaviours: " + compared);
}

{
  const { s, deps } = scenario({ stored: { movers: NIGHTLY_FIXED } });
  const rows = createRouter(flowsReadRows(deps));
  const rc = (path) => ({ request: req("GET", path), env: {}, url: new URL("https://anilkaya.org" + path), ctx: {}, session: { id: "u" } });
  const expectKeys = { market: "market", events: "events", scoretrack: "scoretrack", meta: "meta", political: "political", unusual: "unusual",
    movers: "movers", sectors: "sector:trix", "sector-premium": "sector:premium", universe: "universe", regime: "regime", ideas: "ideas",
    focus: "focus", roster: "roster", record: "record" };
  for (const [name, key] of Object.entries(expectKeys)) {
    s.log.length = 0;
    await rows.find("/api/flows/" + name).handler(rc("/api/flows/" + name));
    eq(s.log[0], ["readServed", key], name + " reads the nightly key " + key + " and nothing else first");
  }
  const bodies = {};
  for (const name of Object.keys(expectKeys)) bodies[name] = await (await rows.find("/api/flows/" + name).handler(rc("/api/flows/" + name))).json().catch(() => null);
  eq(bodies.movers, NIGHTLY_FIXED.payload ? JSON.parse(NIGHTLY_FIXED.payload) : null, "a stored row is served as it was stored");
  const pend = createRouter(flowsReadRows(scenario().deps));
  const pending = async (name) => (await pend.find("/api/flows/" + name).handler(rc("/api/flows/" + name))).json();
  eq(await pending("sectors"), { status: "pending", rows: [] }, "sectors pends with an empty rows list");
  eq(await pending("sector-premium"), { status: "pending", sectors: [] }, "sector-premium pends with an empty sectors list");
  eq(await pending("record"), { status: "pending", horizons: [], sessions: 0 }, "record pends with its horizons and sessions");
  eq(await pending("market"), { status: "pending" }, "the rest pend bare");
  eq(await pending("news"), { status: "pending", rows: [] }, "news pends with rows");
}

{
  const w = workerSource();
  const text = moduleSource("worker.js");
  expect(w, /createRouter\(flowsReadRows\(/, { min: 1, max: 1, why: "the Worker builds one table from the flows-read family" });
  expect(text, /async function route\(request, env, url, ctx\) \{\s*const path = url\.pathname;\s*const origin = url\.origin;\s*const routed = await ROUTER\.handle\(\{ request, env, url, ctx \}, \{ flows: currentFlowsUser \}\);\s*if \(routed !== null\) return routed;/,
    { min: 1, max: 1, why: "route() consults the table first and returns what it answers" });
  expect(text, /ROUTER\.handle\(/, { min: 1, max: 1, why: "and only once" });
  const consult = text.indexOf("await ROUTER.handle(");
  const firstLiteral = text.search(/\bpath === "\//);
  ok(consult > 0 && consult < firstLiteral, "and it consults the table before the first `path ===` literal of the chain");
  for (const r of table.rows) {
    absent(text, new RegExp('path === "' + r.path.replace(/[-/]/g, "\\$&") + '"'), { anchor: /path === "\/api\/flows\/lk"/, why: r.path + " is a table row and no longer a branch of the chain" });
  }
  ok(/if \(path\.startsWith\("\/api\/flows\/"\)\) \{/.test(text), "the Flows prefix block stays for the routes not yet moved");
  ok(/requireMethod\(request, \["GET"\]\);\s*const session = await currentFlowsUser\(request, env\);/.test(text),
    "with its method gate and then its session gate, in that order");
}

{
  const files = treeFiles("server");
  ok(files.includes("server/router.js") && files.includes("server/routes/flows-read.js"), "the router and the first family are in server/");
  for (const f of files) {
    const t = moduleSource(f);
    ok(!/from "cloudflare:|import\("cloudflare:/.test(t), f + " imports nothing from cloudflare:");
    ok(!/^(let|var) /m.test(t) && !/^(const|export const) [A-Za-z_0-9]+ = new (Map|WeakMap|WeakSet|Set|Array)\(/m.test(t), f + " declares no top-level mutable state");
    ok(!/\/\/|\/\*/.test(t.replace(/https?:\/\/[^\s"'`]+/g, "")), f + " carries no comments");
  }
  for (const f of files.filter((x) => x.startsWith("server/routes/"))) {
    const imports = [...moduleSource(f).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    ok(imports.every((i) => !/routes\//.test(i) && !/^\.\/[a-z-]+\.js$/.test(i)), f + " imports no other route file");
    ok(imports.every((i) => i.startsWith("../") || i.startsWith("../../shared/")), f + " reaches only server/ and shared/");
  }
  for (const f of treeFiles("shared")) ok(!/from "\.\.\/server\//.test(moduleSource(f)), f + " never imports server/");
}

globalThis.Date = RealDate;
console.log(`server-router: ${checks} checks`);
