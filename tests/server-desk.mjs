import assert from "node:assert/strict";
import * as K from "../server/http.js";
import { createRouter } from "../server/router.js";
import { flowsDeskRows } from "../server/routes/flows-desk.js";
import { RANK_KEYS } from "../shared/flows-premium.js";
import { workerSource, expect, absent, moduleSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const req = (method, path) => new Request("https://anilkaya.org" + path, { method });
const view = (e) => (e ? { status: e.status, code: e.code, message: e.message, headers: e.headers, details: e.details } : null);
const STUB = new Proxy({}, { get: () => () => null });
const table = createRouter(flowsDeskRows(STUB));

eq(table.rows.map((r) => r.path), ["/api/flows/chain", "/api/flows/strategy", "/api/flows/live"], "the flows-desk family is chain, strategy and live");
ok(table.rows.every((r) => r.auth === "flows" && r.methods.length === 1 && r.methods[0] === "GET" && r.id === "flows." + r.path.slice("/api/flows/".length)),
  "each is a GET behind the Flows session with the id flows.<name>");

function scenario(over = {}) {
  const log = [];
  const rec = (name, ...args) => log.push([name, ...args]);
  const deps = {
    vendorGate: (env, session) => { rec("vendorGate", session && session.id); return { gate: "g", env }; },
    serveCachedVendorRead: async (a) => {
      rec("serve", a.cacheKey.url, a.wantsRefresh, a.gate.gate, a.ctx && a.ctx.tag, a.ttlSeconds);
      const vf = (path) => { rec("vf", path); return null; };
      const built = await a.build(vf);
      rec("built", built);
      return K.json({ cacheKey: a.cacheKey.url, built }, 200, { "X-Chain-Cache": "miss" });
    },
    buildChainPayload: async (env, ctx, vf, opts) => { rec("chain", ctx && ctx.tag, opts); return { chain: opts }; },
    buildStrategyContext: async (env, ctx, vf, ticker) => { rec("context", ctx && ctx.tag, ticker); return { context: ticker }; },
    buildStrategyExpiry: async (env, ctx, vf, ticker, expiry, flags) => { rec("expiry", ctx && ctx.tag, ticker, expiry, flags); return { expiry, ticker, flags }; },
    quoteResponse: async (env, ctx, ticker, allowed) => { rec("quote", ctx && ctx.tag, ticker, allowed.gate); return K.json({ ticker, quote: true }); },
    ...over,
  };
  return { log, deps };
}

const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}$/;
async function reference(path, rc, d) {
  const { url, env, ctx, session } = rc;
  const requireTicker = K.requireTicker;
  const internalKey = K.internalKey;
  const HttpError = K.HttpError;
  const vendorGate = d.vendorGate;
  const serveCachedVendorRead = d.serveCachedVendorRead;
  if (path === "/api/flows/live") {
    const ticker = requireTicker(url);
    return d.quoteResponse(env, ctx, ticker, vendorGate(env, session));
  }
  if (path === "/api/flows/chain") {
    const ticker = requireTicker(url);

    const rawStrategy = url.searchParams.get("strategy");
    const strategy = rawStrategy === "csp" || rawStrategy === "cc" ? rawStrategy : "both";
    const rawRank = url.searchParams.get("rank");
    const rankBy = RANK_KEYS.includes(rawRank) ? rawRank : "annualized";

    return serveCachedVendorRead({
      env,
      ctx,
      cacheKey: internalKey("chain", `${ticker}?strategy=${strategy}&rank=${rankBy}`),
      wantsRefresh: url.searchParams.get("refresh") === "1",
      gate: vendorGate(env, session),
      build: (vf) => d.buildChainPayload(env, ctx, vf, { ticker, strategy, rankBy, limit: 120 }),
    });
  }
  if (path === "/api/flows/strategy") {
    const ticker = requireTicker(url);
    const rawExpiry = url.searchParams.get("expiry");

    if (rawExpiry !== null && !EXPIRY_RE.test(rawExpiry)) {
      throw new HttpError(400, "invalid_expiry", "Expiry must be YYYY-MM-DD");
    }
    const expiry = rawExpiry === null ? null : rawExpiry;
    const engine = expiry !== null && url.searchParams.get("engine") === "1";

    return serveCachedVendorRead({
      env,
      ctx,
      cacheKey: internalKey("strategy", `${ticker}${expiry ? "/" + expiry : ""}${engine ? "?engine=1" : ""}`),
      wantsRefresh: url.searchParams.get("refresh") === "1",
      gate: vendorGate(env, session),
      build: (vf) => (expiry
        ? d.buildStrategyExpiry(env, ctx, vf, ticker, expiry, { engine })
        : d.buildStrategyContext(env, ctx, vf, ticker)),
    });
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

const TICKERS = ["?t=NVDA", "?t=nvda", "?t=BRK.B", "?t=", "?t=NOT%20A%20TICKER", "", "?t=AAPL&t=MSFT"];
const CHAIN_QS = ["", "&strategy=csp", "&strategy=cc", "&strategy=both", "&strategy=zz", "&strategy=CSP",
  ...RANK_KEYS.map((k) => "&rank=" + k), "&rank=nonsense", "&rank=", "&refresh=1", "&refresh=0", "&refresh=true",
  "&strategy=csp&rank=premium&refresh=1", "&strategy=cc&rank=cushionSigmas"];
const STRATEGY_QS = ["", "&expiry=2026-10-16", "&expiry=2026-10-16&engine=1", "&expiry=2026-10-16&engine=0", "&engine=1", "&expiry=", "&expiry=2026-1-16",
  "&expiry=2026-10-16x", "&expiry=2026-10-16&refresh=1", "&refresh=1", "&expiry=9999-99-99&engine=1", "&expiry=%202026-10-16"];

const CASES = [];
for (const t of TICKERS) {
  const lead = t === "" ? "?" : t;
  const join = (q) => (t === "" ? (q ? "?" + q.slice(1) : "") : t + q);
  for (const q of CHAIN_QS) CASES.push(["/api/flows/chain", join(q)]);
  for (const q of STRATEGY_QS) CASES.push(["/api/flows/strategy", join(q)]);
  CASES.push(["/api/flows/live", t], ["/api/flows/live", lead === "?" ? "" : t + "&refresh=1"]);
}

{
  let compared = 0;
  const sessions = [{ id: "u1" }, { id: "u2" }];
  for (const [path, q] of CASES) {
    for (const session of sessions) {
      const ctx = { tag: "ctx" };
      const mk = () => { const sc = scenario(); return { sc, rc: { request: req("GET", path + q), env: { tag: "env" }, url: new URL("https://anilkaya.org" + path + q), ctx, session } }; };
      const a = mk();
      const b = mk();
      const rows = createRouter(flowsDeskRows(a.sc.deps));
      const got = await outcome(() => rows.find(path).handler(a.rc));
      const want = await outcome(() => reference(path, b.rc, b.sc.deps));
      assert.deepEqual(got, want, `${path}${q} for ${session.id}`);
      assert.deepEqual(a.sc.log, b.sc.log, `${path}${q} for ${session.id}: the same calls in the same order`);
      compared++;
      checks += 2;
    }
  }
  ok(compared >= 300, "every row was compared with the code it replaced over the parameter grid and two members: " + compared);
}

{
  const { log, deps } = scenario();
  const rows = createRouter(flowsDeskRows(deps));
  const rc = (path) => ({ request: req("GET", path), env: {}, url: new URL("https://anilkaya.org" + path), ctx: { tag: "c" }, session: { id: "m" } });
  await rows.find("/api/flows/chain").handler(rc("/api/flows/chain?t=NVDA&strategy=csp&rank=premium&refresh=1"));
  eq(log[0], ["vendorGate", "m"], "the member's gate is built from the session, once");
  eq(log[1], ["serve", "https://flows-chain.internal/NVDA?strategy=csp&rank=premium", true, "g", "c", undefined], "the chain read is keyed by ticker, strategy and rank, refreshed on request");
  eq(log[2], ["chain", "c", { ticker: "NVDA", strategy: "csp", rankBy: "premium", limit: 120 }], "and builds 120 rows");
  log.length = 0;
  await rows.find("/api/flows/strategy").handler(rc("/api/flows/strategy?t=NVDA&expiry=2026-10-16&engine=1"));
  eq(log[1][1], "https://flows-strategy.internal/NVDA/2026-10-16?engine=1", "the strategy expiry read is keyed with the engine flag");
  eq(log[2], ["expiry", "c", "NVDA", "2026-10-16", { engine: true }], "and prices the engine");
  log.length = 0;
  await rows.find("/api/flows/strategy").handler(rc("/api/flows/strategy?t=NVDA&engine=1"));
  eq(log[1][1], "https://flows-strategy.internal/NVDA", "no expiry reads the context and drops the engine flag");
  const bad = await outcome(() => rows.find("/api/flows/strategy").handler(rc("/api/flows/strategy?t=NVDA&expiry=tomorrow")));
  eq(bad.threw, { status: 400, code: "invalid_expiry", message: "Expiry must be YYYY-MM-DD", headers: undefined, details: undefined }, "a malformed expiry is 400 before any gate or vendor work");
  const noTicker = await outcome(() => rows.find("/api/flows/live").handler(rc("/api/flows/live")));
  eq(noTicker.threw.status, 400, "a missing ticker is 400");
}

{
  const gateCalls = [];
  const gates = { flows: async (request, env) => { gateCalls.push(request.method); return env.user || null; } };
  const { deps, log } = scenario();
  const r = createRouter(flowsDeskRows(deps));
  const rc = (method, path, env = {}) => ({ request: req(method, path), env, url: new URL("https://anilkaya.org" + path), ctx: {} });
  for (const path of ["/api/flows/chain?t=NVDA", "/api/flows/strategy?t=NVDA", "/api/flows/live?t=NVDA"]) {
    gateCalls.length = 0;
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD"]) {
      let e = null;
      try { await r.handle(rc(method, path, { user: { id: "u" } }), gates); } catch (x) { e = x; }
      eq([e && e.status, e && e.code, e && e.headers], [405, "method_not_allowed", { Allow: "GET" }], method + " " + path + " is 405 with Allow: GET");
    }
    eq(gateCalls, [], path + ": the method gate runs before the session is read");
    let anon = null;
    try { await r.handle(rc("GET", path), gates); } catch (x) { anon = x; }
    eq([anon && anon.status, anon && anon.code, anon && anon.message], [401, "unauthorized", "Authentication required"], path + ": an anonymous caller is 401");
    eq(log.length, 0, path + ": and no vendor gate was built for it");
  }
}

{
  const w = workerSource();
  const text = moduleSource("worker.js");
  expect(w, /createRouter\(flowsReadRows\([\s\S]*?\),\s*flowsDeskRows\(\{/, { min: 1, max: 1, why: "the Worker's one table takes the flows-desk family after the flows-read family" });
  expect(text, /ROUTER\.handle\(/, { min: 1, max: 1, why: "and is consulted once" });
  for (const r of table.rows) {
    absent(text, new RegExp('path === "' + r.path.replace(/[-/]/g, "\\$&") + '"'), { anchor: /path === "\/api\/flows\/lk"/, why: r.path + " is a table row and no longer a branch of the chain" });
  }
  absent(text, /const EXPIRY_RE\b/, { anchor: /const STRATEGY_INDEX = "SPY";/, why: "the expiry pattern moved with the strategy handler" });
  absent(text, /\bRANK_KEYS\b/, { anchor: /rankChain, crossesEarnings/, why: "the rank allow-list is read by the chain handler, not by the Worker" });
  ok(/serveCachedVendorRead\(\{\s*env,\s*ctx,\s*cacheKey: internalKey\("chain"/.test(moduleSource("server/routes/flows-desk.js")), "the chain row hands the single-flight reader its key, the member's gate and its builder");
  expect(w, /async function serveCachedVendorRead\(/, { min: 1, max: 1, why: "the reader the rows call stays the one Worker-local copy" });
  expect(w, /function vendorGate\(env, session\)/, { min: 1, max: 1, why: "and so does the member and on-demand gate" });
  const src = moduleSource("server/routes/flows-desk.js");
  ok(!/\buwFetch\b|\bUW_ONDEMAND\b|\bMEMBER_VENDOR\b/.test(src), "the family names no limiter and makes no vendor call itself: both stay behind the injected gate and reader");
  ok(!/from "\.\.\/\.\.\/worker\.js"|cloudflare:/.test(src), "and imports neither the Worker nor the platform");
}

console.log(`server-desk: ${checks} checks`);
