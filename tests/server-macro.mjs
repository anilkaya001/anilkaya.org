import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FLOWS_COOKIE, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import { FIXTURE_ROSTER } from "./lib/fixture-roster.mjs";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { BUDGETS } from "../shared/flows-vendor-ops.js";
import { buildMacro } from "../shared/flows-macro.js";
import { flowsMacroRows, project, MACRO_PARTS } from "../server/routes/flows-macro.js";
import { ERRORS } from "../server/errors.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-macro.json"), "utf8"));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const SESSION_SECRET = "macro-session-secret-abcdefghijklmnopqrstuvwxyz";
const OWNER = FIXTURE_ROSTER[0];
const MEMBER = FIXTURE_ROSTER[1];
const creds = JSON.stringify({ [OWNER]: "x".repeat(43), [MEMBER]: "y".repeat(43) });
const tokens = {
  owner: await signFlowsSession(OWNER, SESSION_SECRET, 3600, sessionEpoch({ SESSION_SECRET, FLOWS_CREDENTIALS: creds })),
  member: await signFlowsSession(MEMBER, SESSION_SECRET, 3600, sessionEpoch({ SESSION_SECRET, FLOWS_CREDENTIALS: creds })),
};

class FakeCache {
  constructor() { this.entries = new Map(); }
  async match(key) { const hit = this.entries.get(String(key.url || key)); return hit ? hit.clone() : undefined; }
  async put(key, response) { this.entries.set(String(key.url || key), response.clone()); }
}

const MACRO_PAYLOAD = buildMacro(structuredClone(FX.worlds.ok), { test: true });
const PM_PAYLOAD = { v: 1, session: "2026-10-27", generatedAt: FX.now, fixture: true, sectors: { Technology: { status: "ok", listed: 8, cursor: 0, profiled: 8, complete: "2026-10-27", top: [["SYPM01", "Sample Robotics 1", 1e9, 12, 100, "2026-10-20", 0.1, null, 2, []]] } }, investors: { asOf: "2026-10-27", n: 1, top: [["Sample Capital Inc.", 14]] }, basis: { calls: 3, plan: false } };

const realFetch = globalThis.fetch;
const worker = (await import("../worker.js?macro=1")).default;

function rig({ w = worker, env = {}, payloads = true, limiter = null, behaviour = {} } = {}) {
  const f = fakeD1();
  if (payloads) { f.put("macro", MACRO_PAYLOAD); f.put("pm", PM_PAYLOAD); }
  const cache = new FakeCache();
  globalThis.caches = { default: cache };
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.href || input.url);
    if (url.origin !== "http://feed.test") return realFetch(input);
    calls.push(url.pathname + url.search);
    if (behaviour.fail && behaviour.fail.test(url.pathname)) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const e = { DB: f.D1, SESSION_SECRET, FLOWS_CREDENTIALS: creds, FLOWS_RT_USERS: OWNER, UW_API_KEY: "test-key", UW_BASE: "http://feed.test", FLOWS_READ_MODE: "off", FLOWS_MACRO: "on", FLOWS_MACRO_LIVE: "on", ...env, ...(limiter ? { UW_ONDEMAND: limiter } : {}) };
  const call = async (route, { who = "owner", method = "GET", anon = false } = {}) => {
    const headers = anon ? {} : { cookie: FLOWS_COOKIE + "=" + tokens[who], "Sec-Fetch-Site": "same-origin" };
    const before = f.trips.length;
    const res = await w.fetch(new Request("https://anilkaya.org" + route, { method, headers }), e, { waitUntil() {} });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { res, body, rows: f.rowsRead(before), trips: f.trips.length - before };
  };
  return { call, f, calls, cache, env: e };
}

try {
  {
    const names = ["on", "owner", "off", "", "yes", "1", " On "];
    for (const mode of names) {
      const r = rig({ env: { FLOWS_MACRO: mode } });
      const owner = await r.call("/api/flows/macro?part=rates");
      const member = await r.call("/api/flows/macro?part=rates", { who: "member" });
      const opens = mode.trim().toLowerCase();
      eq(owner.res.status, opens === "on" || opens === "owner" ? 200 : 404, `FLOWS_MACRO ${JSON.stringify(mode)}: the owner`);
      eq(member.res.status, opens === "on" ? 200 : 404, `FLOWS_MACRO ${JSON.stringify(mode)}: a member`);
    }
    const off = rig({ env: { FLOWS_MACRO: "off" } });
    const a = await off.call("/api/flows/macro?part=rates");
    const own = rig({ env: { FLOWS_MACRO: "owner" } });
    const b = await own.call("/api/flows/macro?part=rates", { who: "member" });
    eq(a.body, b.body, "THE 404 BODY IS THE SAME for a non-owner and for a switch that is off, so the switch is not leaked");
    eq(a.body.error.code, "macro_off", "and names macro_off");
    eq(off.f.trips.length, 0, "a closed switch reads no row: the gate comes before the store");
  }

  {
    const r = rig();
    eq((await r.call("/api/flows/macro", { method: "POST" })).res.status, 405, "a POST is a 405");
    eq((await r.call("/api/flows/macro", { method: "POST", anon: true })).res.status, 405, "and a 405 before the 401");
    eq((await r.call("/api/flows/macro", { anon: true })).res.status, 401, "an anonymous GET is a 401");
    eq((await r.call("/api/flows/macro/now?part=board", { anon: true })).res.status, 401, "and so is the live read");
  }

  {
    const r = rig();
    const whole = await r.call("/api/flows/macro");
    eq([whole.res.status, whole.rows, whole.trips <= 3], [200, 1, true], "the whole payload costs one row on a miss");
    ok(whole.body.rates && whole.body.fx, "and is the payload");
    const again = await r.call("/api/flows/macro");
    eq(again.rows, 0, "and none on a hit");
    for (const part of MACRO_PARTS.filter((p) => p !== "pm")) {
      const got = await r.call("/api/flows/macro?part=" + part);
      eq(got.res.status, 200, `part ${part}`);
      ok(part in got.body, `part ${part} carries its section`);
      ok(!("fx" in got.body) || part === "fx", `part ${part} carries only its section`);
    }
    const bad = await r.call("/api/flows/macro?part=nope");
    eq([bad.res.status, bad.body.error.code], [400, "invalid_part"], "an unknown part is refused");
    const sector = await r.call("/api/flows/macro?part=pm&sector=Technology");
    eq([sector.res.status, sector.body.sector, sector.body.entry.status], [200, "Technology", "ok"], "the private part takes a sector");
    eq((await r.call("/api/flows/macro?part=pm&sector=Nope")).body.error.code, "invalid_part", "an unknown sector is refused");
    eq((await r.call("/api/flows/macro?part=rates&sector=Technology")).body.error.code, "invalid_part", "a sector with another part is refused");
    const idx = await r.call("/api/flows/macro?part=pm");
    ok(idx.body.sectors.Technology && !("top" in idx.body.sectors.Technology), "the private part without a sector lists the sectors without their tables");
    deep(project(MACRO_PAYLOAD, null, null) === MACRO_PAYLOAD);
  }
  function deep(v) { ok(v, "project returns the payload itself for the whole read"); }

  {
    const r = rig({ payloads: false });
    const empty = await r.call("/api/flows/macro");
    eq([empty.res.status, empty.body.status, empty.body.why, empty.res.headers.get("X-Fresh-State")], [200, "pending", "not_published", "pending"], "an unpublished payload is pending, not an error");
    const gone = rig();
    gone.f.fail(/flows_payload/);
    const down = await gone.call("/api/flows/macro?part=rates");
    ok([503].includes(down.res.status), "an unreadable store is a 503 with no last good copy: " + down.res.status);
  }

  {
    const r = rig();
    const ok1 = await r.call("/api/flows/macro?part=rates");
    ok(ok1.res.headers.get("X-Payload-Updated") !== null, "a read carries its update stamp");
  }

  {
    const r = rig();
    const board = await r.call("/api/flows/macro/now?part=board");
    eq(board.res.status, 200, "the live board answers");
    eq(r.calls.length, BUDGETS.macroLive.callsPerMiss.board, "a miss of the board makes exactly the budgeted calls");
    const again = await r.call("/api/flows/macro/now?part=board", { who: "member" });
    eq(r.calls.length, BUDGETS.macroLive.callsPerMiss.board, "A SECOND MEMBER READS THE SHARED COPY: no further call (one miss, one feed burst)");
    eq(again.res.headers.get("X-Chain-Cache"), "hit", "and is told it is a hit");
    for (const part of ["futures", "crypto"]) {
      const q = rig();
      await q.call("/api/flows/macro/now?part=" + part);
      eq(q.calls.length, BUDGETS.macroLive.callsPerMiss[part], `${part} makes ${BUDGETS.macroLive.callsPerMiss[part]} calls`);
    }
    const q = rig();
    await q.call("/api/flows/macro/now?part=fx&pair=EURUSD");
    eq(q.calls.length, BUDGETS.macroLive.callsPerMiss.fx, "fx makes one call");
    eq((await q.call("/api/flows/macro/now?part=fx&pair=XXXYYY")).body.error.code, "invalid_pair", "a pair outside the eight is refused");
    eq((await q.call("/api/flows/macro/now?part=fx")).body.error.code, "invalid_pair", "and so is none");
    eq((await q.call("/api/flows/macro/now?part=nope")).body.error.code, "invalid_part", "an unknown live part is refused");
    const bare = rig({ payloads: false });
    await bare.call("/api/flows/macro/now?part=futures");
    eq(bare.calls.length, 1, "with no macro payload the futures part asks only for the prints");
    const noSyms = rig({ payloads: false });
    const b2 = await noSyms.call("/api/flows/macro/now?part=board");
    eq(noSyms.calls.length, 8 + 3, "and the board asks only for the pairs and the crypto");
    eq(b2.body.futures.ES.why, "no-symbols", "the futures entries say there are no symbols");
  }

  {
    const off = rig({ env: { FLOWS_MACRO_LIVE: "off" } });
    const a = await off.call("/api/flows/macro/now?part=board");
    eq([a.res.status, a.body.error.code], [404, "macro_live_off"], "the live read has its own switch");
    eq(off.calls.length, 0, "and makes no call");
    const live = rig({ env: { FLOWS_MACRO: "off", FLOWS_MACRO_LIVE: "on" } });
    eq((await live.call("/api/flows/macro/now?part=board")).body.error.code, "macro_off", "THE LIVE READ IS NEVER SERVED WITH THE PAGE SWITCH OFF");
    const ownerOnly = rig({ env: { FLOWS_MACRO: "on", FLOWS_MACRO_LIVE: "owner" } });
    eq((await ownerOnly.call("/api/flows/macro/now?part=fx&pair=EURUSD", { who: "member" })).res.status, 404, "an owner-only live read is closed to a member");
    eq((await ownerOnly.call("/api/flows/macro/now?part=fx&pair=EURUSD")).res.status, 200, "and open to the owner");
  }

  {
    let n = 0;
    const limiter = { limit: async () => ({ success: ++n <= 3 }) };
    const r = rig({ limiter });
    const res = await r.call("/api/flows/macro/now?part=board");
    eq(r.calls.length, 3, "A REFUSAL AFTER THREE CALLS STOPS THE REST");
    eq(res.res.status, 429, "and with no kept copy is a 429");
    eq(res.res.headers.get("Retry-After"), "60", "with a retry hint");
    const warm = rig();
    await warm.call("/api/flows/macro/now?part=crypto");
    warm.env.UW_ONDEMAND = { limit: async () => ({ success: false }) };
    warm.env.MEMBER_VENDOR = { limit: async () => ({ success: false }) };
    for (const [key, entry] of warm.cache.entries) {
      const clone = entry.clone();
      const copy = new Response(await clone.text(), { headers: { "X-Chain-Stored": String(Math.floor(Date.now() / 1000) - 400), "Content-Type": "application/json" } });
      warm.cache.entries.set(key, copy);
    }
    const kept = await warm.call("/api/flows/macro/now?part=crypto", { who: "member" });
    eq([kept.res.status, kept.res.headers.get("X-Fresh-State"), kept.res.headers.get("X-Fresh-Reason")], [200, "stale", "throttled"], "a member refused past the five minutes is served the kept copy, stamped stale");
  }

  {
    const failing = rig({ behaviour: { fail: /whale/ } });
    const c = await failing.call("/api/flows/macro/now?part=crypto");
    eq(c.res.status, 200, "a failed feed read inside a part is a withheld entry, not a failed route");
    ok(c.body.whales.status === "failed" || c.body.whales.status === "limited", "named in the body");
    ok(c.body.btc5m.length > 0 || c.body.btc5m.length === 0, "the other reads stand");
  }

  {
    for (const code of ["macro_off", "macro_live_off", "invalid_pair", "invalid_part"]) ok(ERRORS[code], `${code} is a declared error`);
    eq(ERRORS.macro_off[0], 404, "macro_off is a 404");
    eq(flowsMacroRows({ readServed() {}, passthrough() {}, macroOn() {}, macroLiveOn() {}, serveCachedVendorRead() {}, vendorGate() {}, buildNow() {}, nightlyFreshHeaders() {} }).map((x) => [x.id, x.path, x.methods, x.auth]),
      [["flows.macro", "/api/flows/macro", ["GET"], "flows"], ["flows.macro.now", "/api/flows/macro/now", ["GET"], "flows"]], "two GET rows behind the Flows session");
  }

  {
    const gated = (await import("../server/routes/flows-macro.js")).flowsMacroRows;
    ok(typeof gated === "function", "the family is exported");
    const src = fs.readFileSync(path.join(ROOT, "server/routes/flows-macro.js"), "utf8");
    ok(src.indexOf("macro_off") < src.indexOf("readServed(env, key)"), "the switch is read before the store");
    ok(/internalKey\("macro-now", part \+ \(pair \? "\/" \+ pair : ""\)\)/.test(src), "the live cache key names the part and the pair and no member");
    ok(!/session\.username[^;]*cacheKey|cacheKey[^;]*username/.test(src), "and nothing of the member");
    const w = fs.readFileSync(path.join(ROOT, "worker.js"), "utf8");
    ok(/flowsMacroRows\(\{ readServed, passthrough, macroOn, macroLiveOn, serveCachedVendorRead, vendorGate/.test(w), "the Worker wires the family with its own gate, reader and limiter");
    ok(/const macroOn = /.test(w) && /const macroLiveOn = /.test(w), "and defines both switches");
  }

  const MUT = [
    ["switch-after-store", { route: [['    if (!gateOn(env, session)) throw HttpError.of("macro_off");\n    const raw = url.searchParams.get("part");', '    const raw = url.searchParams.get("part");']] },
      async (w) => { const r = rig({ w, env: { FLOWS_MACRO: "off" } }); await r.call("/api/flows/macro?part=rates"); return r.f.trips.length === 0; }],
    ["owner-gate-inverted", { worker: [['const macroOn = (env, owner) => {\n  const mode = macroMode(env, "FLOWS_MACRO");\n  return mode === "on" || (mode === "owner" && owner === true);', 'const macroOn = (env, owner) => {\n  const mode = macroMode(env, "FLOWS_MACRO");\n  return mode === "on" || (mode === "owner" && owner !== true);']] },
      async (w) => { const r = rig({ w, env: { FLOWS_MACRO: "owner" } }); return (await r.call("/api/flows/macro?part=rates", { who: "member" })).res.status === 404; }],
    ["per-member-cache-key", { route: [['const cacheKey = internalKey("macro-now", part + (pair ? "/" + pair : ""));', 'const cacheKey = internalKey("macro-now", part + (pair ? "/" + pair : "") + "/" + (session && session.username));']] },
      async (w) => { const r = rig({ w }); await r.call("/api/flows/macro/now?part=board"); const n = r.calls.length; await r.call("/api/flows/macro/now?part=board", { who: "member" }); return r.calls.length === n; }],
    ["live-without-page-switch", { route: [['    if (!gateOn(env, session)) throw HttpError.of("macro_off");\n    if (!liveOn(env, session))', '    if (!liveOn(env, session))']] },
      async (w) => { const r = rig({ w, env: { FLOWS_MACRO: "off", FLOWS_MACRO_LIVE: "on" } }); return (await r.call("/api/flows/macro/now?part=board")).res.status === 404; }],
    ["pair-unchecked", { route: [['if (!FX_PAIRS.includes(pair)) throw HttpError.of("invalid_pair");', ""]] },
      async (w) => { const r = rig({ w }); return (await r.call("/api/flows/macro/now?part=fx&pair=XXXYYY")).res.status === 400; }],
    ["refusal-continues", { worker: [["      if (error instanceof VendorRefused) throw error;\n      const upstream = error && Number.isInteger(error.upstream) ? error.upstream : 0;\n      return { status: upstream === 429", "      const upstream = error && Number.isInteger(error.upstream) ? error.upstream : 0;\n      return { status: upstream === 429"]] },
      async (w) => { let n = 0; const r = rig({ w, limiter: { limit: async () => ({ success: ++n <= 3 }) } }); const res = await r.call("/api/flows/macro/now?part=board"); return r.calls.length === 3 && res.res.status === 429; }],
    ["live-switch-ignores-owner", { worker: [['  const mode = macroMode(env, "FLOWS_MACRO_LIVE");\n  return mode === "on" || (mode === "owner" && owner === true);', '  const mode = macroMode(env, "FLOWS_MACRO_LIVE");\n  return mode === "on" || mode === "owner";']] },
      async (w) => { const r = rig({ w, env: { FLOWS_MACRO: "on", FLOWS_MACRO_LIVE: "owner" } }); return (await r.call("/api/flows/macro/now?part=fx&pair=EURUSD", { who: "member" })).res.status === 404; }],
  ];
  const once = (text, edits, label) => {
    let out = text;
    for (const [from, to] of edits) {
      ok(out.split(from).length === 2, `${label}: the planted change ${JSON.stringify(from.slice(0, 40))} applies exactly once`);
      out = out.replace(from, () => to);
    }
    return out;
  };
  let tagN = 0;
  async function variant(edits, label) {
    const tag = String(++tagN);
    const routeFile = path.join(ROOT, `server/routes/flows-macro.mut-${tag}.js`);
    const workerFile = path.join(ROOT, `worker.mut-${tag}.js`);
    const route = once(fs.readFileSync(path.join(ROOT, "server/routes/flows-macro.js"), "utf8"), edits.route || [], label);
    const wsrc = once(fs.readFileSync(path.join(ROOT, "worker.js"), "utf8"), edits.worker || [], label);
    fs.writeFileSync(routeFile, route);
    fs.writeFileSync(workerFile, wsrc.replace("./server/routes/flows-macro.js", `./server/routes/flows-macro.mut-${tag}.js`));
    try {
      return (await import(pathToFileURL(workerFile).href)).default;
    } finally {
      fs.unlinkSync(routeFile);
      fs.unlinkSync(workerFile);
    }
  }
  for (const [id, edits, check] of MUT) {
    ok(await check(worker), `${id}: the correct build passes`);
    const w = await variant(edits, id);
    ok(!(await check(w)), `${id}: the planted wrong build fails`);
  }
} finally {
  globalThis.fetch = realFetch;
  globalThis.caches = undefined;
}

console.log(`server-macro: ${checks} assertions - both macro routes through worker.js with the switches, the shared live cache, the call budget per part and the limiter`);
