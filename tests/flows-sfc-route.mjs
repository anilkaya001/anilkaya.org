import assert from "node:assert/strict";
import { createRouter } from "../server/router.js";
import { flowsLedgerRows, LEDGER_TTL_S, LEDGER_ROW_CEILING } from "../server/routes/flows-ledger.js";
import { ERRORS } from "../server/errors.js";
import { ledgerView } from "../shared/flows-sfc-view.js";
import { makeWorld } from "./lib/sfc-world.mjs";
import { loadVariant } from "./lib/sfc-variant.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import { baseParity } from "../shared/flows-ledger-live.js";
import { textHash } from "../shared/flows-ledger-strip.js";
import { storedInput, NOW_INTRADAY } from "./lib/sfc-stored.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const thrown = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };

class FakeCache {
  constructor() { this.entries = new Map(); this.puts = 0; }
  async match(key) { const hit = this.entries.get(String(key.url || key)); return hit ? hit.clone() : undefined; }
  async put(key, response) { this.puts++; this.entries.set(String(key.url || key), response.clone()); }
}

const world = makeWorld(777, { tickers: 24, perName: 18, pathologies: false });
const input = storedInput(world);

const liveRow = (id, payload, readAt, extra = {}) => ({
  id, payload: JSON.stringify(payload), read_at: readAt, session: world.session, cadence_s: 300, source: "live", writer: "tier1", updated_at: readAt + 1000, ...extra,
});

function rig({ rows = null, stored = null, behaviour = {}, now = NOW_INTRADAY, ctx = {}, view = undefined, owner = false, make = flowsLedgerRows } = {}) {
  const cache = new FakeCache();
  globalThis.caches = { default: cache };
  const clock = { t: now };
  const calls = { many: [], live: [], tables: 0, waited: 0 };
  const liveRows = rows || [liveRow("live:alerts", input.live.payload, input.live.readAt), liveRow("live:breadth", input.breadth.payload, input.live.readAt)];
  const storedRows = stored || new Map([["universe", { payload: JSON.stringify(input.universe), updatedAt: now - 3600000 }]]);
  const deps = {
    store: {
      async readMany(env, keys) { calls.many.push(keys); return behaviour.manyFails ? null : new Map(keys.filter((k) => storedRows.has(k)).map((k) => [k, storedRows.get(k)])); },
    },
    ensureFlowsTables: async () => { calls.tables++; },
    readLiveRows: async (db, ids, at) => { calls.live.push([ids, at]); return behaviour.liveFails ? null : { rows: liveRows.filter((r) => ids.includes(r.id)), clock: null }; },
    now: () => clock.t,
    isOwner: (env, username) => owner && username === "member",
    ...(view ? { view } : {}),
  };
  const table = createRouter(make(deps));
  const gates = { flows: async (request) => (request.headers.get("X-Test-User") ? { username: "member" } : null) };
  const call = async (pathAndQuery, { user = true, method = "GET", env = { DB: {} }, host = "https://anilkaya.test", c = ctx } = {}) => {
    const url = new URL(host + pathAndQuery);
    const request = new Request(url, { method, headers: user ? { "X-Test-User": "member" } : {} });
    const res = await table.handle({ request, env, url, ctx: { waitUntil: (p) => { calls.waited++; return p; }, ...c } }, gates);
    return { res, body: res ? await res.json() : null };
  };
  return { call, calls, cache, table, clock };
}

{
  const r = rig();
  eq(r.table.rows.map((x) => [x.id, x.path, x.methods, x.auth]), [["flows.ledger", "/api/flows/ledger", ["GET"], "flows"]], "one row, a GET behind the Flows session");
  ok(LEDGER_TTL_S === 30 && LEDGER_ROW_CEILING === 6, "thirty seconds of edge cache and a ceiling of six rows");
  const e405 = await thrown(() => r.call("/api/flows/ledger", { method: "POST", user: false }));
  eq(e405 && e405.status, 405, "a POST is the 405 before the 401");
  const e401 = await thrown(() => r.call("/api/flows/ledger", { user: false }));
  eq(e401 && e401.status, 401, "an anonymous read is the 401");
  eq(r.calls.many.length + r.calls.live.length, 0, "and neither touched the store");
  eq(ERRORS.invalid_scope[0], 400, "invalid_scope is a 400");
  eq(ERRORS.invalid_period[0], 400, "invalid_period is a 400");
}

{
  const r = rig();
  const { res, body } = await r.call("/api/flows/ledger");
  eq(res.status, 200, "a read is a 200");
  ok((res.headers.get("Content-Type") || "").startsWith("application/json"), "JSON");
  eq(body, JSON.parse(JSON.stringify(ledgerView({ ...input, nightly: null, clock: null, scope: { kind: "all", key: "all" }, period: null, now: NOW_INTRADAY, live: { payload: input.live.payload, readAt: input.live.readAt, session: world.session }, breadth: { payload: input.breadth.payload } }))), "the body is the view of the stored record, nothing added or dropped");
  eq(body.status, "ok", "an ok view");
  ok(res.headers.get("X-Payload-Updated") !== null && Number(res.headers.get("X-Payload-Updated")) > 0, "the newest stored row's time travels in X-Payload-Updated");
  ok(res.headers.get("X-Fresh-State") !== null, "and the freshness headers of the live row");
  eq(r.calls.tables, 1, "the tables are ensured once");
  eq(r.calls.many, [["flowalerts", "universe"]], "the nightly alerts and the universe are one statement");
  eq(r.calls.live.map((c) => c[0]), [["live:alerts", "live:breadth"]], "the two live rows are one statement");
  eq(r.cache.puts, 1, "and the view is kept for the next reader");
  ok(r.calls.waited === 1, "in the background");
}

{
  const r = rig();
  const first = await r.call("/api/flows/ledger?scope=sector:Energy&period=intraday");
  const second = await r.call("/api/flows/ledger?scope=sector:Energy&period=intraday");
  eq(second.res.headers.get("X-Ledger-Cache"), "hit", "a second read of the same scope and period is served from the edge");
  eq(second.body, first.body, "with the same body");
  eq(r.calls.many.length, 1, "and no second store read");
  ok(second.res.headers.get("X-Fresh-State") === first.res.headers.get("X-Fresh-State") && second.res.headers.get("X-Server-Now") !== null, "freshness headers are kept and the server clock is current");
  await r.call("/api/flows/ledger?scope=sector:Energy&period=session");
  await r.call("/api/flows/ledger?scope=all&period=intraday");
  await r.call("/api/flows/ledger?scope=name:SYA101");
  eq(r.calls.many.length, 4, "another scope or period is another read");
  const bare = await r.call("/api/flows/ledger");
  const all = await r.call("/api/flows/ledger?scope=all");
  eq(bare.body, all.body, "no scope is the all scope");
}

{
  const r = rig();
  const bad = async (q) => (await thrown(() => r.call(q)));
  eq((await bad("/api/flows/ledger?scope=sector:Bogus")).code, "invalid_scope", "an unknown sector");
  eq((await bad("/api/flows/ledger?scope=name:../x")).code, "invalid_scope", "a path-like name");
  eq((await bad("/api/flows/ledger?scope=other")).code, "invalid_scope", "an unknown kind");
  eq((await bad("/api/flows/ledger?period=week")).code, "invalid_period", "an unknown period");
  eq((await bad("/api/flows/ledger?period=INTRADAY")).code, "invalid_period", "periods are lower case");
}

{
  const r = rig();
  const prod = await thrown(() => r.call("/api/flows/ledger?scope=name:SYA101", { host: "https://anilkaya.org" }));
  eq(prod && prod.code, "invalid_ticker", "a fixture name is refused on the production host");
  const test = await r.call("/api/flows/ledger?scope=name:SYA101");
  eq(test.res.status, 200, "and allowed on a test host");
  const real = await r.call("/api/flows/ledger?scope=name:SPY", { host: "https://anilkaya.org" });
  eq(real.res.status, 200, "a real symbol is allowed on the production host");
  const lower = await r.call("/api/flows/ledger?scope=name:spy", { host: "https://anilkaya.org" });
  eq(lower.body.scope.key, "name:SPY", "and upper-cased");
}

{
  const none = rig({ rows: [], stored: new Map() });
  const { res, body } = await none.call("/api/flows/ledger");
  eq(res.status, 200, "an empty store is a 200 that says so");
  eq(body.status, "unavailable", "unavailable");
  ok(typeof body.why === "string" && body.why.length > 0, "with a reason");
  ok(res.headers.get("X-Fresh-State") !== null, "and pending freshness headers");
  const noDb = rig();
  const e = await thrown(() => noDb.call("/api/flows/ledger", { env: {} }));
  eq(e && e.code, "store_unreadable", "no database is the standard 503");
  const manyFail = rig({ behaviour: { manyFails: true } });
  eq((await thrown(() => manyFail.call("/api/flows/ledger"))).code, "store_unreadable", "a refused statement is the 503");
  const liveFail = rig({ behaviour: { liveFails: true } });
  eq((await thrown(() => liveFail.call("/api/flows/ledger"))).code, "store_unreadable", "and so is a refused live read");
  eq(liveFail.cache.puts, 0, "which is never cached");
  const broken = rig({ rows: [{ id: "live:alerts", payload: "{nope", read_at: NOW_INTRADAY, session: world.session, cadence_s: 300, source: "live", writer: "t", updated_at: NOW_INTRADAY }] });
  eq((await thrown(() => broken.call("/api/flows/ledger"))).code, "store_unreadable", "an unparsable live payload is the 503, not a half view");
  const array = rig({ stored: new Map([["flowalerts", { payload: "[1,2]", updatedAt: 1 }]]) });
  eq((await thrown(() => array.call("/api/flows/ledger"))).code, "store_unreadable", "a payload that is not an object is refused");
  const noCtx = rig();
  const plain = await noCtx.call("/api/flows/ledger", { c: { waitUntil: null } });
  eq(plain.res.status, 200, "without a background hook the cache write is awaited");
  eq(noCtx.cache.puts, 1, "and still happens");
}

{
  const logs = [];
  const realError = console.error;
  const realWarn = console.warn;
  console.error = (line) => logs.push(String(line));
  console.warn = (line) => logs.push(String(line));
  const failing = rig({ rows: [liveRow("live:alerts", { ...input.live.payload, rows: "nope" }, input.live.readAt)] });
  const out = await failing.call("/api/flows/ledger");
  console.error = realError;
  console.warn = realWarn;
  eq(out.body.status, "failed", "a record with no windows is a failed view");
  eq(out.res.status, 200, "served as a 200 that says why");
  eq(failing.cache.puts, 0, "and a failed view is never kept at the edge");
  eq(logs.length, 0, "an unreadable record is not a closure failure and logs nothing");
  const V = await loadVariant({ file: "shared/flows-sfc.js", transforms: [["balancing[c] = s === 0n ? 0 : safe(-s);", "balancing[c] = s === 0n ? 0 : safe(-s) + 1;"]] }, "route-closure");
  const lines = [];
  console.error = (line) => lines.push(String(line));
  const broken = rig({ view: V.view.ledgerView });
  const closed = await broken.call("/api/flows/ledger");
  console.error = realError;
  eq(closed.body.status, "failed", "a ledger that does not close is a failed view");
  ok(!("ledger" in closed.body), "with no figures");
  eq(broken.cache.puts, 0, "never kept at the edge");
  const entry = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e && e.event === "ledger closure failed");
  ok(entry && entry.level === "error" && entry.scope === "all" && entry.failed.includes("columns") && /logged as [0-9a-f]{8}/.test(entry.reason), "and is logged once as an error naming the failed checks and the hash");
  eq(lines.length, 1, "exactly one line");
}

{
  const r = rig();
  const { res } = await r.call("/api/flows/ledger");
  const stamp = Number(res.headers.get("X-Payload-Updated"));
  ok(stamp >= Math.max(input.live.readAt, 0), "X-Payload-Updated is at least the newest row's update");
  const broken = new FakeCache();
  broken.match = async () => { throw new Error("cache down"); };
  globalThis.caches = { default: broken };
  const again = await r.call("/api/flows/ledger?scope=sector:Energy");
  eq(again.res.status, 200, "a cache that throws on read is a miss, not an error");
  globalThis.caches = undefined;
  const none = await r.call("/api/flows/ledger?scope=sector:Utilities");
  eq(none.res.status, 200, "and no cache at all is a miss");
}

{
  const r = rig();
  const off = await thrown(() => r.call("/api/flows/ledger?part=book"));
  eq(off && off.code, "ledger_live_off", "the book is a 404 while FLOWS_LEDGER_LIVE is unset");
  eq(ERRORS.ledger_live_off[0], 404, "which is the table's 404");
  eq(r.calls.many.length + r.calls.live.length, 0, "and it read nothing");
  const odd = await thrown(() => r.call("/api/flows/ledger?part=book", { env: { DB: {}, FLOWS_LEDGER_LIVE: "maybe" } }));
  eq(odd && odd.code, "ledger_live_off", "an odd value fails closed");
  const member = await thrown(() => r.call("/api/flows/ledger?part=book", { env: { DB: {}, FLOWS_LEDGER_LIVE: "owner" } }));
  eq(member && member.code, "ledger_live_off", "owner mode tells a member nothing");
  const bad = await thrown(() => r.call("/api/flows/ledger?part=other", { env: { DB: {}, FLOWS_LEDGER_LIVE: "on" } }));
  eq(bad && bad.code, "invalid_part", "an unknown part is a 400");
  eq(ERRORS.invalid_part[0], 400, "from the table");
  const owner = rig({ owner: true });
  const mine = await owner.call("/api/flows/ledger?part=book", { env: { DB: {}, FLOWS_LEDGER_LIVE: "owner" } });
  eq(mine.res.status, 200, "the owner reads the book in owner mode");
  eq([mine.body.status, mine.body.session, mine.body.period, mine.body.v], ["ok", world.session, "intraday", 1], "an ok intraday book for the session");
  eq(mine.body.rows.length, input.live.payload.rows.length, "with every held row");
  eq(mine.body.viewHash, textHash(JSON.stringify(ledgerView({ ...input, nightly: null, clock: null, scope: { kind: "all", key: "all" }, period: null, now: NOW_INTRADAY, live: { payload: input.live.payload, readAt: input.live.readAt, session: world.session }, breadth: { payload: input.breadth.payload } }))), "and the hash of the view the route would have sent");
  ok(baseParity(mine.body).ok, "which the browser's build reproduces");
  eq(owner.calls.many, [["flowalerts", "universe"]], "the nightly alerts and the universe are one statement");
  eq(owner.calls.live.map((c) => c[0]), [["live:alerts", "live:breadth"]], "the two live rows are one statement: no row the view does not read");
  ok(mine.res.headers.get("X-Payload-Updated") !== null && mine.res.headers.get("X-Fresh-State") !== null, "the stamp and the freshness headers travel with it");
  eq(owner.cache.puts, 1, "the book is kept for the next reader");
  const again = await owner.call("/api/flows/ledger?part=book", { env: { DB: {}, FLOWS_LEDGER_LIVE: "owner" } });
  eq([again.res.headers.get("X-Ledger-Cache"), owner.calls.many.length], ["hit", 1], "a second read is a hit and reads nothing");
  const upd = Number(mine.res.headers.get("X-Payload-Updated"));
  const env = { DB: {}, FLOWS_LEDGER_LIVE: "owner" };
  const seen = await owner.call("/api/flows/ledger?part=book&v=" + upd, { env });
  eq([seen.res.headers.get("X-Ledger-Cache"), owner.calls.many.length], ["hit", 1], "a stamp the copy already holds is a hit");
  const older = await owner.call("/api/flows/ledger?part=book&v=" + (upd - 5000), { env });
  eq(older.res.headers.get("X-Ledger-Cache"), "hit", "and so is an older one");
  const early = await owner.call("/api/flows/ledger?part=book&v=" + (upd + 1), { env });
  eq([early.res.headers.get("X-Ledger-Cache"), owner.calls.many.length], ["hit", 1], "a stamp newer than a copy built a moment ago is still the copy: nobody can force a rebuild every request");
  owner.clock.t += 6000;
  const newer = await owner.call("/api/flows/ledger?part=book&v=" + (upd + 1), { env });
  eq([newer.res.headers.get("X-Ledger-Cache"), owner.calls.many.length], [null, 2], "a stamp newer than the copy, once the copy is five seconds old, is a read, so a change the heartbeat saw is never answered with the older copy");
  const loop = await Promise.all(Array.from({ length: 5 }, () => owner.call("/api/flows/ledger?part=book&v=" + (upd + 1), { env })));
  eq([loop.map((x) => x.res.headers.get("X-Ledger-Cache")), owner.calls.many.length], [Array(5).fill("hit"), 2], "and the stamp the read could not satisfy does not make the next five requests reads: one rebuild in five seconds");
  const racing = rig({ owner: true });
  const burst = await Promise.all(Array.from({ length: 6 }, () => racing.call("/api/flows/ledger?part=book", { env })));
  eq([burst.map((x) => x.res.status), racing.calls.many.length, racing.calls.live.length], [Array(6).fill(200), 1, 1], "six readers that arrive together share one read of the store");
  const junk = await owner.call("/api/flows/ledger?part=book&v=abc", { env });
  eq(junk.res.headers.get("X-Ledger-Cache"), "hit", "a stamp that is not digits is ignored");
  const future = await owner.call("/api/flows/ledger?part=book&v=" + (NOW_INTRADAY + 80000), { env });
  eq([future.res.headers.get("X-Ledger-Cache"), owner.calls.many.length], ["hit", 2], "and a stamp from beyond the server's clock is ignored, so no stamp can keep the copy from being used");
  eq(owner.cache.puts, 2, "the cache holds one book, replaced by the read, not one for every stamp");
  const open = await r.call("/api/flows/ledger?part=book", { env: { DB: {}, FLOWS_LEDGER_LIVE: "on" } });
  eq(open.res.status, 200, "on opens it to a member");
  const late = rig({ now: NOW_INTRADAY + 3 * 3600000, owner: true });
  const quiet = await late.call("/api/flows/ledger?part=book", { env: { DB: {}, FLOWS_LEDGER_LIVE: "on" } });
  eq([quiet.body.status, quiet.body.v], ["not-live", 1], "when the intraday read is not live the answer says so and carries no rows");
  ok(!("rows" in quiet.body), "and no windows");
  eq(late.cache.puts, 0, "a not-live answer is never kept");
}

{
  const r = rig();
  const a = await r.call("/api/flows/ledger?scope=all");
  const upd = Number(a.res.headers.get("X-Payload-Updated"));
  const b = await r.call("/api/flows/ledger?scope=all&v=" + upd);
  r.clock.t += 6000;
  const c = await r.call("/api/flows/ledger?scope=all&v=" + (upd + 1));
  eq([a.res.headers.get("X-Ledger-Cache"), b.res.headers.get("X-Ledger-Cache"), c.res.headers.get("X-Ledger-Cache")], [null, "hit", null], "the view takes the stamp too: the copy it holds answers a stamp it holds, and a newer stamp is a read");
  const d = await r.call("/api/flows/ledger?scope=all&v=zz");
  eq(d.res.headers.get("X-Ledger-Cache"), "hit", "a bad stamp is ignored");
  eq(r.calls.many.length, 2, "two reads in all");
}

{
  const battery = async (make) => {
    const failed = [];
    const note = (name, good) => { if (!good && !failed.includes(name)) failed.push(name); };
    const env = { DB: {}, FLOWS_LEDGER_LIVE: "owner" };
    const r = rig({ owner: true, make });
    const first = await r.call("/api/flows/ledger?part=book", { env });
    const upd = Number(first.res.headers.get("X-Payload-Updated"));
    const seen = await r.call("/api/flows/ledger?part=book&v=" + upd, { env });
    note("seen", seen.res.headers.get("X-Ledger-Cache") === "hit" && r.calls.many.length === 1);
    const older = await r.call("/api/flows/ledger?part=book&v=" + (upd - 5000), { env });
    note("older", older.res.headers.get("X-Ledger-Cache") === "hit");
    r.clock.t += 6000;
    const future = await r.call("/api/flows/ledger?part=book&v=" + (NOW_INTRADAY + 80000), { env });
    note("future", future.res.headers.get("X-Ledger-Cache") === "hit" && r.calls.many.length === 1);
    const newer = await r.call("/api/flows/ledger?part=book&v=" + (upd + 1), { env });
    note("stamp", newer.res.headers.get("X-Ledger-Cache") === null && r.calls.many.length === 2);
    await Promise.all(Array.from({ length: 5 }, () => r.call("/api/flows/ledger?part=book&v=" + (upd + 1), { env })));
    note("throttle", r.calls.many.length === 2);
    note("keys", r.cache.puts === 2);
    const racing = rig({ owner: true, make });
    await Promise.all(Array.from({ length: 6 }, () => racing.call("/api/flows/ledger?part=book", { env })));
    note("flight", racing.calls.many.length === 1);
    return failed;
  };
  eq(await battery(flowsLedgerRows), [], "the correct route passes every check of the cache battery");
  const PLANTS = [
    ["a stamp newer than the copy rebuilds on every request", "throttle", [["      if (!(Number.isFinite(built) && at - built < LEDGER_REBUILD_MIN_MS)) return null;", "      return null;"]]],
    ["the stamp is part of the cache key", "seen", [['const key = internalKey("ledger", "book");', 'const key = internalKey("ledger", "book/" + url.searchParams.get("v"));']]],
    ["readers that arrive together each read the store", "flight", [["    const id = key.url;", "    const id = key;"]]],
    ["a stamp from the future is believed", "future", [["  return n <= at + 60000 ? n : null;", "  return n;"]]],
    ["a stamp newer than the copy is ignored", "stamp", [['    if (v !== null && kept && !(Number(kept["X-Payload-Updated"]) >= v)) {', "    if (false) {"]]],
  ];
  for (const [title, expect, transforms] of PLANTS) {
    const V = await loadMutated("server/routes/flows-ledger.js", transforms, { salt: expect.length });
    const failed = await battery(V.flowsLedgerRows);
    ok(failed.includes(expect), `${title} fails its check ${expect}; failed: ${failed.join(", ") || "none"}`);
  }
}

console.log(`✓ flows-sfc-route: ${checks} assertions`);
