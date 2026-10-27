import assert from "node:assert/strict";
import { HttpError } from "../server/http.js";
import { createRouter } from "../server/router.js";
import { flowsEventRiskRows } from "../server/routes/flows-eventrisk.js";
import { flowsReadRows } from "../server/routes/flows-read.js";
import { stripEr, stripOwner } from "../shared/flows-er-strip.js";
import { eventRiskOpen } from "../shared/flows-er-switch.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const thrown = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };
const view = (e) => (e ? { status: e.status, code: e.code } : null);

const OWNER = "owner-1";
const isOwner = (env, name) => name === OWNER;
const stored = (payload, updatedAt = 7) => ({ payload: typeof payload === "string" ? payload : JSON.stringify(payload), updatedAt, fresh: {} });

function world(rows = {}, { failing = new Set(), kept = null } = {}) {
  const calls = { read: [], gate: 0, token: 0, built: 0, recalled: 0 };
  const deps = {
    readFlowsPayload: async (env, key, trace) => {
      calls.read.push(key);
      if (failing.has(key)) { trace.failed = true; return null; }
      return rows[key] || null;
    },
    recallLastGood: async () => { calls.recalled++; return kept; },
    passthrough: (s) => new Response(s.payload, { status: 200, headers: { "Content-Type": "application/json", "X-Payload-Updated": String(s.updatedAt || 0) } }),
    storeGone: () => new HttpError(503, "store_unreadable", "The store could not be read", {}, { status: "unavailable" }),
    isOwner,
    vendorGate: () => { calls.gate++; return { gate: true }; },
    quotePath: (t) => "/q/" + t,
    serveCachedVendorRead: async ({ build, gate }) => {
      ok(gate && gate.gate === true, "the quote is built behind the member's gate");
      const body = await build(async () => { calls.token++; return { data: { last: "10.00", bid: "9.99", ask: "10.01", time: "2026-10-26T15:00:00Z" } }; });
      calls.built++;
      return new Response(JSON.stringify(body), { status: 200 });
    },
    now: () => Date.parse("2026-10-26T15:00:05Z"),
  };
  const router = createRouter(flowsEventRiskRows(deps));
  const gates = { flows: async (request) => { const u = request.headers.get("x-user"); return u ? { username: u } : null; } };
  const call = (path, { user = OWNER, method = "GET", env = {} } = {}) => {
    const url = new URL("https://anilkaya.org" + path);
    const request = new Request(url, { method, headers: user ? { "x-user": user } : {} });
    return router.handle({ request, env, url, ctx: {} }, gates);
  };
  return { call, calls, router };
}

{
  const w = world();
  eq(view(await thrown(() => w.call("/api/flows/eventrisk", { method: "POST" }))), { status: 405, code: "method_not_allowed" }, "a POST is the 405 before the session");
  eq(view(await thrown(() => w.call("/api/flows/eventrisk", { user: null }))), { status: 401, code: "unauthorized" }, "an anonymous caller is the 401 before the switch");
  eq(view(await thrown(() => w.call("/api/flows/eventrisk?part=nope", { env: { FLOWS_EVENTRISK: "off" } }))), { status: 404, code: "eventrisk_off" }, "a closed switch is eventrisk_off before the part is read");
  eq(view(await thrown(() => w.call("/api/flows/eventrisk", { user: "member-2" }))), { status: 404, code: "eventrisk_off" }, "a member who is not an owner is eventrisk_off while the switch ships owner");
  eq(view(await thrown(() => w.call("/api/flows/eventrisk?part=nope"))), { status: 400, code: "invalid_part" }, "an unknown part is invalid_part");
  eq(view(await thrown(() => w.call("/api/flows/eventrisk?part=quote"))), { status: 400, code: "invalid_ticker" }, "a quote with no ticker is invalid_ticker before any gate");
  eq(w.calls.gate, 0, "and no gate was consulted");
  eq(w.calls.read, [], "no store was read by any refusal");
}

{
  const w = world({ eventrisk: stored({ v: 1, feed: { owner: { filters: [1] }, shared: 1 }, risk: { rows: [] } }) });
  const asOwner = await (await w.call("/api/flows/eventrisk")).json();
  ok(asOwner.feed.owner, "the owner reads the owner's own alert definitions");
  const open = await (await w.call("/api/flows/eventrisk", { user: "member-2", env: { FLOWS_EVENTRISK: "on" } })).json();
  ok(!("owner" in open.feed) && open.feed.shared === 1, "with the switch on, a member reads the payload without the owner's alert definitions");
  eq(w.calls.read, ["eventrisk", "eventrisk"], "one store read for each answer");
}

{
  const w = world({}, { failing: new Set(["eventrisk", "er-sectors", "card-x:NVDA"]) });
  eq(view(await thrown(() => w.call("/api/flows/eventrisk"))), { status: 503, code: "store_unreadable" }, "an unreadable store is a 503 for the plain read");
  eq(view(await thrown(() => w.call("/api/flows/eventrisk?part=sectors"))), { status: 503, code: "store_unreadable" }, "and for the sectors");
  eq(view(await thrown(() => w.call("/api/flows/eventrisk?t=NVDA"))), { status: 503, code: "store_unreadable" }, "and for a name");
  eq(w.calls.recalled, 2, "the sectors and the name ask for the last good copy first; the plain read, which differs by member, does not");
  const k = world({}, { failing: new Set(["er-sectors"]), kept: new Response("{\"kept\":1}", { status: 200 }) });
  eq(await (await k.call("/api/flows/eventrisk?part=sectors")).json(), { kept: 1 }, "a last good copy is served when the store is unreadable");
  const empty = world();
  eq(await (await empty.call("/api/flows/eventrisk")).json(), { status: "pending" }, "an absent key is pending, not unavailable");
  eq((await (await empty.call("/api/flows/eventrisk?t=NVDA")).json()).status, "pending", "an absent name is pending");
}

{
  const w = world();
  const q = await (await w.call("/api/flows/eventrisk?part=quote&t=NVDA")).json();
  eq(w.calls.gate, 1, "a quote consults the member's gate once");
  eq(w.calls.token, 1, "and makes one feed read for a miss");
  eq(w.calls.read, [], "and reads no store row");
  ok(q && typeof q === "object", "and answers a shaped body");
}

{
  const body = { t: "NVDA", er: { v: 1 }, engine: { status: "split", key: "card-x:NVDA" }, mark: "SPLITMARK" };
  const text = JSON.stringify(body);
  const stripped = JSON.parse(stripEr(stored(text)).payload);
  ok(!("er" in stripped) && stripped.engine.key === "card-x:NVDA" && stripped.mark === "SPLITMARK", "stripEr removes er and keeps every other key");
  ok(stripEr(stored("{\"a\":1}")).payload === "{\"a\":1}", "and leaves a body with no er byte for byte");
  ok(stripOwner(stored("{\"a\":1}")).payload === "{\"a\":1}", "stripOwner leaves a body with no owner block byte for byte");

  const calls = [];
  const rows = flowsReadRows(new Proxy({
    readServed: async () => stored(text),
    passthrough: (s) => new Response(s.payload, { status: 200 }),
    cardWithEngine: async (env, ticker, s, trace) => { calls.push(JSON.parse(s.payload)); return { card: { ...JSON.parse(s.payload), engine: { merged: true } } }; },
    storeGone: () => new HttpError(503, "store_unreadable", "x", {}, {}),
    splitEngineMark: "SPLITMARK",
    erClosed: (env, session) => !eventRiskOpen(env, session.username === OWNER),
  }, { get: (t, k) => (k in t ? t[k] : () => null) }));
  const row = rows.find((r) => r.path === "/api/flows/card-x");
  const url = new URL("https://anilkaya.org/api/flows/card-x?t=NVDA");
  const member = await (await row.handler({ request: new Request(url), env: {}, url, ctx: {}, session: { username: "member-2" } })).json();
  ok(member.engine && member.engine.merged === true, "A CLOSED MEMBER STILL GETS THE MERGED ENGINE on the ticker page");
  ok(!("er" in member) && !("er" in calls[0]), "and gets no er block, the merge having been handed the stripped body");
  const owner = await (await row.handler({ request: new Request(url), env: {}, url, ctx: {}, session: { username: OWNER } })).json();
  ok(owner.engine.merged === true && owner.er && owner.er.v === 1, "the owner gets both");
  const plain = JSON.stringify({ t: "NVDA", er: { v: 1 } });
  const rows2 = flowsReadRows(new Proxy({
    readServed: async () => stored(plain),
    passthrough: (s) => new Response(s.payload, { status: 200 }),
    splitEngineMark: "SPLITMARK",
    erClosed: () => true,
  }, { get: (t, k) => (k in t ? t[k] : () => null) }));
  const r2 = rows2.find((r) => r.path === "/api/flows/card-x");
  const plainBody = await (await r2.handler({ request: new Request(url), env: {}, url, ctx: {}, session: { username: "member-2" } })).json();
  ok(!("er" in plainBody) && plainBody.t === "NVDA", "a card with no split engine is served stripped without a merge");
}

console.log(`flows-er-route: ${checks} checks`);
