import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "../server/router.js";
import { flowsOracleRows, ORACLE_BATCH_MAX, nextViewAt } from "../server/routes/flows-oracle.js";
import { buildOracle } from "../shared/flows-oracle.js";
import { expectedNightlySession } from "../shared/flows-freshness.js";
import { card, SESSION, NORM } from "./lib/oracle-fixtures.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const thrown = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-10-16T23:30:00Z");

const record = (t, over = {}) => ({ ...buildOracle({ ticker: t, session: SESSION, card: { ...card(), ticker: t }, flowNorm: NORM, expectedSession: SESSION, now: NOW }), ...over });
const stored = (body) => ({ payload: JSON.stringify(body), updatedAt: NOW, fresh: { readAt: new Date(NOW).toISOString(), session: SESSION, cadenceS: 0, source: "nightly", klass: "nightly" } });

function world(rows = {}, behaviour = {}) {
  const calls = { read: [], many: [] };
  const store = {
    async read(env, key, trace) {
      calls.read.push(key);
      if (behaviour.fail) { if (trace) trace.failed = true; return null; }
      return rows[key] || null;
    },
    async readMany(env, keys) {
      calls.many.push(keys);
      if (behaviour.fail) return null;
      return new Map(keys.filter((k) => rows[k]).map((k) => [k, rows[k]]));
    },
  };
  const deps = {
    store, ensureFlowsTables: async () => {}, isOwner: (env, u) => u === "owner", nightlyFreshHeaders: () => ({ "X-Fresh-State": "fresh" }),
    recallLastGood: async () => behaviour.kept || null, now: () => NOW,
  };
  const table = createRouter(flowsOracleRows(deps));
  const gates = { flows: async (request) => (request.headers.get("X-Test-User") ? { username: request.headers.get("X-Test-User") } : null) };
  const call = async (pathAndQuery, { user = "member", env = { FLOWS_ORACLE: "on" }, method = "GET" } = {}) => {
    const url = new URL("https://anilkaya.test" + pathAndQuery);
    const request = new Request(url, { method, headers: user ? { "X-Test-User": user } : {} });
    const res = await table.handle({ request, env, url, ctx: {} }, gates);
    return { res, body: res ? await res.json() : null };
  };
  return { call, calls, table };
}

{
  const w = world({ "oracle:SYO001": stored(record("SYO001")) });
  eq(w.table.rows.map((r) => r.path), ["/api/flows/oracle"], "one row in the table");
  const e405 = await thrown(() => w.call("/api/flows/oracle?t=SYO001", { method: "POST", user: null }));
  eq(e405 && e405.status, 405, "a POST is the 405 before the 401");
  const e401 = await thrown(() => w.call("/api/flows/oracle?t=SYO001", { user: null }));
  eq(e401 && e401.status, 401, "an anonymous read is the 401");
  const { body, res } = await w.call("/api/flows/oracle?t=SYO001");
  eq(res.status, 200, "a stored record is a 200");
  eq(body.ticker, "SYO001", "for its name");
  eq(body.state, "signal", "with its state");
  eq(res.headers.get("X-Fresh-State"), "fresh", "and the freshness headers");
  eq(w.calls.read, ["oracle:SYO001"], "one primary-key read");
}

{
  const w = world({});
  const off = await thrown(() => w.call("/api/flows/oracle?t=SYO001", { env: {} }));
  eq(off && off.code, "oracle_off", "unset is off");
  const odd = await thrown(() => w.call("/api/flows/oracle?t=SYO001", { env: { FLOWS_ORACLE: "yes" } }));
  eq(odd && odd.code, "oracle_off", "an odd value fails closed");
  const ownerOnly = await thrown(() => w.call("/api/flows/oracle?t=SYO001", { env: { FLOWS_ORACLE: "owner" } }));
  eq(ownerOnly && ownerOnly.code, "oracle_off", "a member is told nothing when it is staged for the owner");
  const { res } = await w.call("/api/flows/oracle?t=SYO001", { env: { FLOWS_ORACLE: "owner" }, user: "owner" });
  eq(res.status, 200, "the owner reads it");
  eq(w.calls.read.length, 1, "and only the owner's read touched the store");
}

{
  const w = world({});
  const bad = await thrown(() => w.call("/api/flows/oracle?t=%24%24"));
  eq(bad && bad.code, "invalid_ticker", "a malformed ticker is a 400");
  const none = await thrown(() => w.call("/api/flows/oracle"));
  eq(none && none.code, "invalid_ticker", "and so is none");
  const { body } = await w.call("/api/flows/oracle?t=SYO009");
  eq(body.state, "building", "no record is a building record, not a 404");
  eq(body.stateWhy, "unbuilt", "whose reason is that the view is not written yet, not that the name has no card");
  eq([body.session, body.sessionDate, body.grade, body.stance, body.provenance.ideas], [null, null, null, null, null], "with no session, grade, stance or ideas it could be mistaken for");
  eq(body.withheld, [], "and no withheld entry for the view itself");
  eq(body.due, "2026-10-19T22:30:00.000Z", "it says when the next nightly is due: Monday's close plus the oracle's target");
  ok(body.modelImplied.length > 0 && /not written a view/.test(body.line), "and says so in a line");
  eq(nextViewAt(Date.parse("2026-10-19T15:00:00Z")), "2026-10-19T22:30:00.000Z", "mid-session, the view is due after that session's close");
  eq(nextViewAt(Date.parse("2026-10-19T22:31:00Z")), "2026-10-20T22:30:00.000Z", "past the target it is the next session's");
  eq(nextViewAt(Date.parse("2026-11-26T12:00:00Z")), "2026-11-27T20:30:00.000Z", "a holiday rolls to the next session, and an early close moves the time");
  eq(nextViewAt(Number.NaN), null, "an unreadable clock has no due time");
  const tooMany = await thrown(() => w.call("/api/flows/oracle?ts=" + Array.from({ length: ORACLE_BATCH_MAX + 1 }, (_, i) => "A" + i).join(",")));
  eq(tooMany && tooMany.code, "too_many_keys", "a batch over twelve is refused");
  const badBatch = await thrown(() => w.call("/api/flows/oracle?ts=AAPL,bad%20name"));
  eq(badBatch && badBatch.code, "invalid_ticker", "a bad name in a batch is refused");
}

{
  const w = world({ "oracle:SYO001": stored(record("SYO001")), "oracle:SYO002": stored(record("SYO002")) });
  const { body } = await w.call("/api/flows/oracle?ts=SYO001,SYO002,SYO003,SYO001");
  eq(Object.keys(body.records), ["SYO001", "SYO002", "SYO003"], "a batch dedupes and keeps order");
  eq(body.records.SYO003, null, "a name with no record is null");
  eq(w.calls.many.length, 1, "one statement for the batch");
  eq(w.calls.many[0].length, 3, "with one key a name");
  eq(w.calls.read.length, 0, "and no single reads");
}

{
  const old = record("SYO001", { session: "2026-10-13", sessionDate: "2026-10-13" });
  const w = world({ "oracle:SYO001": stored({ ...old, session: "2026-10-13" }) });
  const exp = expectedNightlySession(NOW);
  const { body } = await w.call("/api/flows/oracle?t=SYO001");
  ok(exp > "2026-10-13", "the clock is past the record");
  eq(body.state, "stale", "an old record is re-judged at read time");
  eq(body.calls.length, 0, "and two sessions behind has no calls");
}

{
  const w = world({}, { fail: true });
  const { body } = await w.call("/api/flows/oracle?t=SYO001");
  eq(body.why, "store", "a refused store is a 200 that says why");
  eq([body.stateWhy, body.withheld], ["unbuilt", [{ k: "view", reason: "failed" }]], "and names the failed read");
  const kept = new Response(JSON.stringify({ kept: true }), { status: 200 });
  const w2 = world({}, { fail: true, kept });
  const second = await w2.call("/api/flows/oracle?t=SYO001");
  eq(second.body.kept, true, "or the last good copy");
  const batch = await w.call("/api/flows/oracle?ts=SYO001");
  eq(batch.body.why, "store", "a refused batch says so");
  const top = await thrown(() => w.call("/api/flows/oracle?top=1"));
  eq(top && top.code, "store_unreadable", "and top is the standard 503");
}

{
  const items = [{ t: "SYO001", state: "signal", stance: { lean: "up", conviction: 3 }, topCall: null }];
  const w = world({ "oracle-top": stored({ v: 1, session: SESSION, sessionDate: SESSION, generatedAt: new Date(NOW).toISOString(), items }) });
  const { body } = await w.call("/api/flows/oracle?top=1");
  eq(body.items, items, "top serves the stored items");
  eq(w.calls.read, ["oracle-top"], "from one primary-key read");
  const empty = await world({}).call("/api/flows/oracle?top=1");
  eq(empty.body.items, [], "an absent top is an empty list");
  eq(empty.body.status, "pending", "marked pending");
}

{
  const src = fs.readFileSync(path.join(ROOT, "server/routes/flows-oracle.js"), "utf8") + fs.readFileSync(path.join(ROOT, "server/store.js"), "utf8").match(/async readMany[\s\S]*?\n    },/)[0];
  ok(!/json_each/.test(src), "no json_each");
  ok(!/\bAI\b|env\.AI|askModels|aiCall/.test(src), "no model call from the route");
  ok(!/fetch\(/.test(src), "no feed call from the route");
  const worker = fs.readFileSync(path.join(ROOT, "worker.js"), "utf8");
  ok(/flowsOracleRows\(\{ store: FLOWS_STORE/.test(worker), "the Worker mounts the family");
  const toml = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
  ok(/^FLOWS_ORACLE = "owner"$/m.test(toml), "and ships it staged for the owner");
}

console.log(`server-oracle: ${checks} checks passed`);
