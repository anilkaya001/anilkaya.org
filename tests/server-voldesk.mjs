import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "../server/router.js";
import { flowsVoldeskRows, VOLDESK_PENDING } from "../server/routes/flows-voldesk.js";
import { ERRORS } from "../server/errors.js";
import { loadMutated } from "./truth/mutants.mjs";
import { payloadFor } from "./lib/voldesk-world.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const thrown = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE = "server/routes/flows-voldesk.js";
const NOW = Date.parse("2026-08-24T22:00:00Z");
const BODY = payloadFor("ok");
const stored = (body = BODY) => ({ payload: JSON.stringify(body), updatedAt: NOW, fresh: { readAt: new Date(NOW).toISOString(), session: "2026-08-24", cadenceS: 0, source: "nightly", klass: "nightly" } });

function world(rows = {}, behaviour = {}, rowsFn = flowsVoldeskRows) {
  const calls = { read: [] };
  const store = {
    async read(env, key, trace) {
      calls.read.push(key);
      if (behaviour.fail) { if (trace) trace.failed = true; return null; }
      return rows[key] || null;
    },
  };
  const deps = {
    store, isOwner: (env, u) => u === "owner",
    passthrough: (s) => new Response(s.payload, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "X-Fresh-State": "fresh" } }),
    recallLastGood: async () => behaviour.kept || null,
    storeGone: () => Object.assign(new Error("store"), { status: 503, code: "store_unreadable" }),
  };
  const table = createRouter(rowsFn(deps));
  const gates = { flows: async (request) => (request.headers.get("X-Test-User") ? { username: request.headers.get("X-Test-User") } : null) };
  const call = async (pathAndQuery, { user = "member", env = { FLOWS_VOLDESK: "on" }, method = "GET" } = {}) => {
    const url = new URL("https://anilkaya.test" + pathAndQuery);
    const request = new Request(url, { method, headers: user ? { "X-Test-User": user } : {} });
    const res = await table.handle({ request, env, url, ctx: {} }, gates);
    return { res, body: res ? await res.json() : null };
  };
  return { call, calls, table };
}

function battery(rowsFn) {
  const found = [];
  const check = async (name, fn) => { try { await fn(); } catch (error) { found.push(name + ": " + String(error.message).split("\n")[0].slice(0, 140)); } };
  return { found, run: async () => {
    await check("gate-order", async () => {
      const w = world({ voldesk: stored() }, {}, rowsFn);
      const e405 = await thrown(() => w.call("/api/flows/voldesk", { method: "POST", user: null }));
      assert.equal(e405 && e405.status, 405);
      const e401 = await thrown(() => w.call("/api/flows/voldesk", { user: null }));
      assert.equal(e401 && e401.status, 401);
    });
    await check("switch-words", async () => {
      for (const env of [{}, { FLOWS_VOLDESK: "" }, { FLOWS_VOLDESK: "ON " }, { FLOWS_VOLDESK: "On" }, { FLOWS_VOLDESK: "yes" }, { FLOWS_VOLDESK: "off" }, { FLOWS_VOLDESK: "owner " }]) {
        const w = world({ voldesk: stored() }, {}, rowsFn);
        const e = await thrown(() => w.call("/api/flows/voldesk", { env, user: "owner" }));
        assert.equal(e && e.code, "voldesk_off", JSON.stringify(env));
      }
      const on = await world({ voldesk: stored() }, {}, rowsFn).call("/api/flows/voldesk");
      assert.equal(on.res.status, 200);
      const ownerOwner = await world({ voldesk: stored() }, {}, rowsFn).call("/api/flows/voldesk", { env: { FLOWS_VOLDESK: "owner" }, user: "owner" });
      assert.equal(ownerOwner.res.status, 200);
    });
    await check("owner-gate", async () => {
      const w = world({ voldesk: stored() }, {}, rowsFn);
      const e = await thrown(() => w.call("/api/flows/voldesk", { env: { FLOWS_VOLDESK: "owner" }, user: "member" }));
      assert.equal(e && e.code, "voldesk_off");
      assert.equal(e.status, 404);
    });
    await check("off-before-store", async () => {
      const w = world({ voldesk: stored() }, {}, rowsFn);
      await thrown(() => w.call("/api/flows/voldesk", { env: {} }));
      await thrown(() => w.call("/api/flows/voldesk", { env: { FLOWS_VOLDESK: "owner" }, user: "member" }));
      await thrown(() => w.call("/api/flows/voldesk?part=x", { env: {} }));
      assert.deepEqual(w.calls.read, [], "a refused request never reads the store");
    });
    await check("one-row", async () => {
      const w = world({ voldesk: stored(), "voldesk-stance": stored({ ring: [] }) }, {}, rowsFn);
      const { res, body } = await w.call("/api/flows/voldesk");
      assert.equal(res.status, 200);
      assert.equal(body.v, 1);
      assert.deepEqual(w.calls.read, ["voldesk"]);
      assert.equal(res.headers.get("X-Fresh-State"), "fresh");
    });
    await check("stance-never-served", async () => {
      for (const q of ["?k=stance", "?key=voldesk-stance", "?t=voldesk-stance", "?stance=1", "?k=voldesk-stance"]) {
        const w = world({ voldesk: stored(), "voldesk-stance": stored({ ring: [{ session: "x", rows: { A: [["A", 1]] } }] }) }, {}, rowsFn);
        const { body } = await w.call("/api/flows/voldesk" + q);
        assert.deepEqual(w.calls.read, ["voldesk"], q);
        assert.ok(!JSON.stringify(body).includes("ring"), q);
      }
    });
    await check("part-refused", async () => {
      const w = world({ voldesk: stored() }, {}, rowsFn);
      for (const q of ["?part=ai", "?part=", "?part=stance"]) {
        const e = await thrown(() => w.call("/api/flows/voldesk" + q));
        assert.equal(e && e.code, "invalid_part", q);
        assert.equal(e.status, 400);
      }
      assert.deepEqual(w.calls.read, []);
    });
    await check("pending", async () => {
      const w = world({}, {}, rowsFn);
      const { res, body } = await w.call("/api/flows/voldesk");
      assert.equal(res.status, 200);
      assert.deepEqual(body, { status: "pending", why: "not_published" });
      assert.equal(res.headers.get("X-Fresh-State"), "pending");
    });
    await check("store-refusal", async () => {
      const kept = new Response(JSON.stringify(BODY), { status: 200, headers: { "X-Fresh-State": "stale", "X-Fresh-Reason": "store" } });
      const w = world({}, { fail: true, kept }, rowsFn);
      const { res } = await w.call("/api/flows/voldesk");
      assert.equal(res.headers.get("X-Fresh-Reason"), "store");
      const w2 = world({}, { fail: true }, rowsFn);
      const e = await thrown(() => w2.call("/api/flows/voldesk"));
      assert.equal(e && e.code, "store_unreadable");
      assert.equal(e.status, 503);
    });
  } };
}

const real = battery(flowsVoldeskRows);
await real.run();
eq(real.found, [], "THE REAL ROUTE PASSES EVERY CHECK");

{
  const w = world({});
  eq(w.table.rows.map((r) => r.path), ["/api/flows/voldesk"], "one row in the table");
  eq(w.table.rows[0].methods, ["GET"], "GET alone");
  eq(w.table.rows[0].auth, "flows", "behind the Flows session");
  eq(ERRORS.voldesk_off, [404, "Not found"], "the off answer is a plain not-found");
  eq(VOLDESK_PENDING, { status: "pending", why: "not_published" }, "the pending body");
  const off = await thrown(() => w.call("/api/flows/voldesk", { env: {} }));
  const staged = await thrown(() => world({}).call("/api/flows/voldesk", { env: { FLOWS_VOLDESK: "owner" }, user: "member" }));
  eq([off.status, off.code, off.message], [staged.status, staged.code, staged.message], "OFF AND STAGED look the same: a member under owner cannot tell the switch exists");
}

const MUTANTS = [
  ["switch-read-after-the-store", [["    const mode = modeOf(env);\n    if (mode === \"off\" || (mode === \"owner\" && !isOwner(env, session.username))) throw HttpError.of(\"voldesk_off\");\n", ""],
    ["    if (stored === null && trace.failed) {", "    const mode = modeOf(env);\n    if (mode === \"off\" || (mode === \"owner\" && !isOwner(env, session.username))) throw HttpError.of(\"voldesk_off\");\n    if (stored === null && trace.failed) {"]], "off-before-store"],
  ["owner-gate-inverted", [["(mode === \"owner\" && !isOwner(env, session.username))", "(mode === \"owner\" && isOwner(env, session.username))"]], "owner-gate"],
  ["stance-key-readable", [["store.read(env, \"voldesk\", trace)", "store.read(env, url.searchParams.get(\"k\") === \"stance\" ? \"voldesk-stance\" : \"voldesk\", trace)"]], "stance-never-served"],
  ["part-ignored", [["    if (url.searchParams.has(\"part\")) throw HttpError.of(\"invalid_part\");\n", ""]], "part-refused"],
  ["pending-as-error", [["if (stored === null) return json(VOLDESK_PENDING, 200, { \"X-Fresh-State\": \"pending\" });", "if (stored === null) throw storeGone();"]], "pending"],
  ["mistyped-switch-on", [["return v === \"on\" || v === \"owner\" ? v : \"off\";", "return v.trim().toLowerCase() === \"on\" ? \"on\" : v === \"owner\" ? v : \"off\";"]], "switch-words"],
];
for (const [id, transforms, named] of MUTANTS) {
  const mod = await loadMutated(ROUTE, transforms, { salt: checks });
  const b = battery(mod.flowsVoldeskRows);
  await b.run();
  ok(b.found.some((f) => f.startsWith(named + ":")), `PLANTED ${id}: fails "${named}" (failed: ${b.found.map((f) => f.split(":")[0]).join(", ") || "nothing"})`);
}

{
  const scan = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
  const routes = fs.readdirSync(path.join(ROOT, "server/routes")).map((f) => "server/routes/" + f);
  for (const f of [...routes, "worker.js"]) ok(!scan(f).includes("voldesk-stance"), `${f}: no route or Worker module names the stance store`);
  const worker = scan("worker.js");
  ok(/flowsVoldeskRows\(\{ store: FLOWS_STORE,/.test(worker), "the Worker mounts the family on the Flows store");
  ok(/voldeskOn: \(env, username\)/.test(worker) && /env\.FLOWS_VOLDESK/.test(worker), "and passes the page predicate that reads FLOWS_VOLDESK");
  ok(/"voldesk"\]\)/.test(worker) || /"hist", "voldesk"\]/.test(worker), "and keeps a last good copy of the read");
  const toml = scan("wrangler.toml");
  ok(/^FLOWS_VOLDESK = "owner"$/m.test(toml), "wrangler.toml ships the switch staged for the owner");
  ok(/^FLOWS_VOLDESK = "on"$/m.test(scan("wrangler.staging.toml")), "and staging opens it");
}

console.log(`server-voldesk: ${checks} assertions`);
