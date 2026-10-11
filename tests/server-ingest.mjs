import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as K from "../server/http.js";
import { createRouter } from "../server/router.js";
import { flowsIngestRows } from "../server/routes/flows-ingest.js";
import { createFlowsStore, ingestKeyParts, storedFrom } from "../server/store.js";
import {
  FLOWS_REGISTRY, FLOWS_SCHEMA_SQL, LEDGER_ADDED_COLUMNS, applySchema, checkAdded, columnProbe, registryOf, upgradeColumns,
  upgradeTables, withAddedColumns,
} from "../server/schema.js";
import * as FLOWS_LIVE from "../shared/flows-live-worker.js";
import { LIVE_SCHEMA_SQL } from "../shared/flows-live-worker.js";
import { DOSSIER_SCHEMA_SQL } from "../shared/flows-dossier-worker.js";
import { TICKER_RE, nightlyFreshMeta } from "../shared/flows-live.js";
import { archiveWriteAction, ARCHIVE_REFUSALS } from "../shared/flows-archive.js";
import { fakeD1, SCHEMA } from "./lib/d1-fake.mjs";
import { workerSource, closure, moduleSource, expect, absent } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const { HttpError, json, readBounded, requireMethod } = K;
const norm = (sql) => sql.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").replace(/;\s*$/, "").trim().toLowerCase();

function oldIngest({ ensureFlowsTables, passthrough, storeGone }) {
  const FLOWS_MAX_PAYLOAD_BYTES = FLOWS_LIVE.FLOWS_MAX_PAYLOAD_BYTES;
  function timingSafeEqualStr(a, b) {
    const x = String(a ?? ""), y = String(b ?? "");
    const n = Math.max(x.length, y.length);
    let diff = x.length ^ y.length;
    for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    return diff === 0;
  }
  const DATED_ARCHIVE_KEY_RE = /^(board:(long|short)|scores):\d{4}-\d{2}-\d{2}$/;
  const INGEST_VIEW_KEY_RE = /^board:(long|short|watch)$|^board:(long|short):\d{4}-\d{2}-\d{2}$|^scores:\d{4}-\d{2}-\d{2}$|^scoretrack$|^flowalerts$|^pulse$|^political$|^record$|^movers$|^market$|^unusual$|^events$|^sector:trix$|^sector:premium$|^news$|^brief$|^meta$|^universe$|^regime$|^ideas$|^focus$|^roster$/;
  function ingestKeyParts(key) {
    const tickerKey = /^(card|card-x|hist):/.exec(key);
    const card = tickerKey ? key.slice(tickerKey[0].length) : null;
    return { tickerKey, valid: card !== null ? TICKER_RE.test(card) : INGEST_VIEW_KEY_RE.test(key) };
  }
  const INGEST_META_KEYS_MAX = 96;
  const INGEST_META_SQL =
    "SELECT id, updated_at, length(payload) AS bytes, json_extract(payload, '$.sessionDate') AS session, " +
    "json_extract(payload, '$.generatedAt') AS generated, json_extract(payload, '$.status') AS status " +
    "FROM flows_payload WHERE id IN (";
  const INGEST_LIST_KINDS = Object.freeze(["card", "card-x", "hist"]);
  const INGEST_LIST_MAX = 2000;
  function ingestListSql(kinds) {
    return "SELECT id, updated_at, json_extract(payload, '$.sessionDate') AS session, json_extract(payload, '$.generatedAt') AS generated, " +
      "json_extract(payload, '$.status') AS status FROM flows_payload WHERE " +
      kinds.map((k) => `(id >= '${k}:' AND id < '${k};')`).join(" OR ") + ` LIMIT ${INGEST_LIST_MAX + 1}`;
  }
  function ingestListing(rows) {
    const keys = {};
    let n = 0;
    for (const r of rows.slice(0, INGEST_LIST_MAX)) {
      if (!ingestKeyParts(r.id).valid || r.status === "pending") continue;
      keys[r.id] = { present: true, sessionDate: typeof r.session === "string" ? r.session : null,
        generatedAt: typeof r.generated === "string" ? r.generated : null, updatedAt: Number(r.updated_at) || 0 };
      n++;
    }
    return { keys, listed: n, truncated: rows.length > INGEST_LIST_MAX };
  }
  function ingestMetadata(asked, rows) {
    const byId = new Map((rows || []).map((r) => [r.id, r]));
    const keys = {};
    for (const key of asked) {
      const r = byId.get(key);
      keys[key] = r && r.status !== "pending"
        ? { present: true, sessionDate: typeof r.session === "string" ? r.session : null,
            generatedAt: typeof r.generated === "string" ? r.generated : null,
            updatedAt: Number(r.updated_at) || 0, bytes: Number(r.bytes) || 0 }
        : { present: false };
    }
    return keys;
  }
  const storedFrom = (row) => (row && row.payload
    ? { payload: row.payload, updatedAt: row.updated_at, fresh: nightlyFreshMeta(row) }
    : null);
  async function readFlowsPayload(env, key, trace) {
    if (!env.DB) { if (trace) trace.failed = true; return null; }
    await ensureFlowsTables(env);
    const row = await env.DB.prepare(FLOWS_LIVE.NIGHTLY_ROW_SQL).bind(key).first()
      .catch(() => { if (trace) trace.failed = true; return null; });
    return storedFrom(row);
  }
  return async ({ request, env, url }) => {
      requireMethod(request, ["GET", "POST", "DELETE"]);
      const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const oidc = FLOWS_LIVE.looksLikeJwt(offered);
      if (!env.FLOWS_INGEST_TOKEN && !FLOWS_LIVE.staticLiveToken(env, url) && !oidc) {
        throw new HttpError(503, "unavailable", "Ingest is not configured");
      }
      let tokenKind = FLOWS_LIVE.tokenKind(offered, env, timingSafeEqualStr, url);
      if (!tokenKind && oidc) {
        const check = await FLOWS_LIVE.oidcKind(offered, env);
        if (check.unavailable) {
          throw new HttpError(503, "unavailable", "The live credential's signing keys could not be read; retry shortly");
        }
        tokenKind = check.kind;
      }
      if (!tokenKind) throw new HttpError(401, "unauthorized", "Authentication required");
      if (url.searchParams.has("list")) {
        requireMethod(request, ["GET"]);
        if (tokenKind !== "nightly") {
          throw new HttpError(403, "live_token_scope", "The live token reads one key at a time");
        }
        const kinds = [...new Set(url.searchParams.get("list").split(",").map((k) => k.trim()).filter(Boolean))];
        if (!kinds.length || kinds.some((k) => !INGEST_LIST_KINDS.includes(k))) throw new HttpError(400, "invalid_key", "Unknown payload key");
        if (!env.DB) throw storeGone();
        await ensureFlowsTables(env);
        const rows = await env.DB.prepare(ingestListSql(kinds)).all().catch(() => null);
        if (!rows) throw storeGone();
        return json(ingestListing(rows.results || []));
      }
      if (url.searchParams.has("keys")) {
        requireMethod(request, ["GET"]);
        if (tokenKind !== "nightly") {
          throw new HttpError(403, "live_token_scope", "The live token reads one key at a time");
        }
        const asked = [...new Set(url.searchParams.get("keys").split(",").map((k) => k.trim()).filter(Boolean))];
        if (!asked.length) throw new HttpError(400, "invalid_key", "Unknown payload key");
        if (asked.length > INGEST_META_KEYS_MAX) {
          throw new HttpError(400, "too_many_keys", `At most ${INGEST_META_KEYS_MAX} keys per request`);
        }
        if (asked.some((k) => !ingestKeyParts(k).valid)) throw new HttpError(400, "invalid_key", "Unknown payload key");
        if (!env.DB) throw storeGone();
        await ensureFlowsTables(env);
        const rows = await env.DB.prepare(INGEST_META_SQL + asked.map(() => "?").join(", ") + ")").bind(...asked).all()
          .catch(() => null);
        if (!rows) throw storeGone();
        return json({ keys: ingestMetadata(asked, rows.results) });
      }
      const key = url.searchParams.get("key") || "";
      if (key === "clock") {
        requireMethod(request, ["GET"]);
        await ensureFlowsTables(env);
        return FLOWS_LIVE.serveIngestClock(env, { json, lab: tokenKind === "nightly" });
      }
      if (key.startsWith("live:")) {
        const scope = FLOWS_LIVE.ingestScope(key, request.method, tokenKind);
        if (!scope.ok) throw new HttpError(scope.status, scope.code, scope.message);
        await ensureFlowsTables(env);
        const text = request.method === "POST"
          ? new TextDecoder().decode(await readBounded(request, FLOWS_MAX_PAYLOAD_BYTES, "Payload too large"))
          : "";
        return FLOWS_LIVE.ingestLive(env, key, request.method, text, Date.now(), { json });
      }
      const { tickerKey, valid: validKey } = ingestKeyParts(key);
      if (!validKey) {
        throw new HttpError(400, "invalid_key", "Unknown payload key");
      }
      const scope = FLOWS_LIVE.ingestScope(key, request.method, tokenKind);
      if (!scope.ok) throw new HttpError(scope.status, scope.code, scope.message);
      if (request.method === "GET") {
        const stored = await readFlowsPayload(env, key);
        if (!stored) return json({ key, status: "pending" });
        return passthrough(stored);
      }
      if (request.method === "DELETE") {
        if (!DATED_ARCHIVE_KEY_RE.test(key) && !(tickerKey && tokenKind === "nightly")) {
          throw new HttpError(400, "undeletable_key", "Only dated archive keys and, for the nightly token, card, card-x and hist keys can be removed");
        }
        await ensureFlowsTables(env);
        const result = await env.DB.prepare(
          "DELETE FROM flows_payload WHERE id = ?"
        ).bind(key).run();
        const removed = result && result.meta ? Number(result.meta.changes) || 0 : 0;
        if (!removed) return json({ key, removed: 0, status: "absent" }, 404);
        return json({ ok: true, key, removed });
      }
      const payload = new TextDecoder().decode(
        await readBounded(request, FLOWS_MAX_PAYLOAD_BYTES, "Payload too large"),
      );
      try { JSON.parse(payload); }
      catch { throw new HttpError(400, "invalid_payload", "Payload is not valid JSON"); }
      await ensureFlowsTables(env);
      if (DATED_ARCHIVE_KEY_RE.test(key)) {
        const trace = {};
        const existing = await readFlowsPayload(env, key, trace);
        const action = archiveWriteAction({
          readable: !trace.failed,
          exists: !!existing,
          same: !!existing && existing.payload === payload,
        });
        if (action === "unchanged") {
          return json({ ok: true, key, bytes: payload.length, stored: "unchanged" });
        }
        if (action !== "write") {
          const refusal = ARCHIVE_REFUSALS[action];
          throw new HttpError(refusal.status, refusal.code, refusal.message);
        }
        const written = await env.DB.prepare(
          "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(id) DO NOTHING"
        ).bind(key, payload, Date.now()).run();
        const rows = written && written.meta ? Number(written.meta.changes) || 0 : 0;
        if (!rows) {
          const refusal = ARCHIVE_REFUSALS.refuse_raced;
          throw new HttpError(refusal.status, refusal.code, refusal.message);
        }
        return json({ ok: true, key, bytes: payload.length, stored: "created" });
      }
      const wroteAt = Date.now();
      const upsert = env.DB.prepare(
        "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at"
      ).bind(key, payload, wroteAt);
      const landing = key === "meta" ? FLOWS_LIVE.nightlyLedger(env.DB, JSON.parse(payload), wroteAt) : null;
      if (landing) await FLOWS_LIVE.batchWithLedger(env.DB, [upsert], landing);
      else await upsert.run();
      return json({ ok: true, key, bytes: payload.length });
  };
}

const NIGHTLY = "nightly-token-abcdefghijklmnopqrstuvwxyz";
const LIVE = "live-token-abcdefghijklmnopqrstuvwxyz0123";
const BASE = "https://anilkaya.org";
const LOCAL = "http://127.0.0.1:8787";
const FIXED_NOW = 1790380000000;
const realNow = Date.now;

const stubDeps = (d, log) => ({
  ensureFlowsTables: async () => { log.push(d.trips.length); },
  passthrough: (stored) => new Response(stored.payload, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Payload-Updated": String(stored.updatedAt || 0) },
  }),
  storeGone: () => new HttpError(503, "store_unreadable", "The store could not be read", { "Retry-After": "30" }, { status: "unavailable", reason: "store" }),
});

function seed(d) {
  d.put("board:long", { sessionDate: "2026-01-02", generatedAt: "2026-01-02T21:40:00.000Z", rows: [1] });
  d.put("board:long:2026-01-02", { sessionDate: "2026-01-02", rows: [9] });
  d.put("card:AAPL", { v: 2, ticker: "AAPL", sessionDate: "2026-01-02" });
  d.put("card:PNDG", { status: "pending", ticker: "PNDG" });
  d.put("hist:AAPL", { v: 1, ticker: "AAPL" });
  d.put("card-x:AAPL", { v: 1, ticker: "AAPL" });
  d.put("meta", { sessionDate: "2026-01-02", generatedAt: "2026-01-02T21:40:00.000Z" });
}

async function observe(run) {
  try {
    const res = await run();
    const headers = {};
    for (const [k, v] of [...res.headers.entries()].sort()) headers[k] = v;
    return { status: res.status, headers, text: await res.text() };
  } catch (error) {
    return { error: { status: error.status, code: error.code, message: error.message, headers: error.headers, details: error.details, name: error.name } };
  }
}

const dump = (d) => ({
  payload: d.db.prepare("SELECT id, payload FROM flows_payload ORDER BY id").all().map((r) => [r.id, r.payload]),
  ledger: d.db.prepare("SELECT day, nightly_runs FROM flows_ledger ORDER BY day").all().map((r) => [r.day, r.nightly_runs]),
});

const BODIES = {
  good: JSON.stringify({ sessionDate: "2026-01-02", generatedAt: "2026-01-02T21:40:00.000Z", rows: [1] }),
  other: JSON.stringify({ sessionDate: "2026-01-02", generatedAt: "2026-01-02T22:00:00.000Z", rows: [2] }),
  meta: JSON.stringify({ sessionDate: "2026-09-22", generatedAt: "2026-09-22T21:40:00.000Z" }),
  bad: "not json at all",
  empty: "",
};
const MANY = Array.from({ length: 97 }, (_, i) => "card:T" + i).join(",");
const QUERIES = [
  "", "?key=", "?key=clock", "?key=live:breadth", "?key=live:bogus", "?key=live:market", "?key=board:long", "?key=board:short",
  "?key=board:watch", "?key=board:long:2026-01-02", "?key=board:long:2026-01-09", "?key=scores:2026-01-02", "?key=card:AAPL",
  "?key=card:PNDG", "?key=card:NONE", "?key=card-x:AAPL", "?key=hist:AAPL", "?key=card:aapl", "?key=card:TOOLONGTICKERX", "?key=card:", "?key=bogus",
  "?key=meta", "?key=pulse", "?key=focus", "?key=roster", "?key=news", "?key=../../etc/passwd", "?keys=meta,board:long",
  "?keys=card:AAPL,card:PNDG,card:NONE", "?keys=", "?keys=bogus", "?keys=" + MANY, "?list=card", "?list=card,hist", "?list=card-x",
  "?list=board", "?list=", "?list=card&key=board:long", "?keys=meta&list=card",
];
const METHODS = ["GET", "POST", "DELETE", "PUT", "HEAD", "PATCH"];
const AUTHS = [
  ["none", null, BASE], ["wrong", "nope", BASE], ["nightly", NIGHTLY, BASE], ["live", LIVE, BASE], ["live-local", LIVE, LOCAL],
  ["nightly-local", NIGHTLY, LOCAL], ["bearer-case", NIGHTLY, BASE, "bearer "],
];

function* requests() {
  for (const [auth, token, base, scheme] of AUTHS) {
    for (const method of METHODS) {
      for (const q of QUERIES) {
        const bodyNames = method === "POST" ? Object.keys(BODIES) : [null];
        for (const bodyName of bodyNames) {
          const headers = {};
          if (token) headers.Authorization = (scheme || "Bearer ") + token;
          const init = { method, headers };
          if (bodyName !== null) init.body = BODIES[bodyName];
          yield { label: `${auth} ${method} ${q.slice(0, 40)} ${bodyName || ""}`, request: () => new Request(base + "/api/flows/ingest" + q, init) };
        }
      }
    }
  }
}

Date.now = () => FIXED_NOW;
try {
  const envOf = (d, extra = {}) => ({ DB: d.D1, FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_LIVE_TOKEN: LIVE, ...extra });

  {
    const log = [];
    const table = createRouter(flowsIngestRows({ store: createFlowsStore({ ensureFlowsTables: async () => {} }), ...stubDeps(fakeD1({ latencyMs: 0 }), log) }));
    eq(table.rows.map((r) => [r.id, r.path, r.methods, r.auth]), [["flows.ingest", "/api/flows/ingest", ["GET", "POST", "DELETE"], "none"]],
      "the ingest family is one row: GET, POST and DELETE on /api/flows/ingest, whose credential is its own bearer token and not the Flows session");
  }

  {
    const oldD = fakeD1({ latencyMs: 0 });
    const newD = fakeD1({ latencyMs: 0 });
    seed(oldD);
    seed(newD);
    const oldLog = [];
    const newLog = [];
    const oldDeps = stubDeps(oldD, oldLog);
    const newDeps = stubDeps(newD, newLog);
    const old = oldIngest(oldDeps);
    const table = createRouter(flowsIngestRows({ store: createFlowsStore({ ensureFlowsTables: newDeps.ensureFlowsTables }), ...newDeps }));
    const gates = { flows: async () => { throw new Error("the ingest row never consults the Flows session"); } };
    let n = 0;
    const seen = new Map();
    const compare = async (label, request) => {
      const a0 = oldD.trips.length, b0 = newD.trips.length, la = oldLog.length, lb = newLog.length;
      const want = await observe(async () => {
        const r = request();
        return old({ request: r, env: envOf(oldD), url: new URL(r.url) });
      });
      const got = await observe(async () => {
        const r = request();
        const res = await table.handle({ request: r, env: envOf(newD), url: new URL(r.url), ctx: {} }, gates);
        if (res === null) throw new Error("the router did not take the ingest path");
        return res;
      });
      assert.deepEqual(got, want, label);
      assert.deepEqual(newD.trips.slice(b0).map((t) => [t.kind, t.sqls]), oldD.trips.slice(a0).map((t) => [t.kind, t.sqls]), label + ": the same statements in the same order");
      assert.deepEqual(newLog.slice(lb).map((x) => x - b0), oldLog.slice(la).map((x) => x - a0), label + ": ensureFlowsTables at the same points");
      seen.set(want.error ? "error " + want.error.status + " " + want.error.code : "ok " + want.status, true);
      n++;
    };
    for (const { label, request } of requests()) await compare(label, request);
    const bearer = { Authorization: "Bearer " + NIGHTLY };
    await compare("delete an absent card", () => new Request(BASE + "/api/flows/ingest?key=card:GHOST", { method: "DELETE", headers: bearer }));
    await compare("delete an absent archive row", () => new Request(BASE + "/api/flows/ingest?key=board:long:2030-01-01", { method: "DELETE", headers: bearer }));
    checks += n;
    assert.deepEqual(dump(newD), dump(oldD));
    checks++;
    ok(n > 2500, "the grid ran " + n + " requests (7 credentials, 6 methods, 39 queries, 5 bodies on POST) against the old branch and the new row");
    for (const outcome of ["error 401 unauthorized", "error 403 live_token_scope", "error 403 nightly_token_scope", "error 400 invalid_key", "error 400 invalid_payload",
      "error 400 undeletable_key", "error 400 too_many_keys", "error 405 method_not_allowed", "error 409 archive_immutable", "ok 200", "ok 404"]) {
      ok(seen.has(outcome), "and it reaches " + outcome);
    }
    const rows = dump(newD).payload;
    ok(["board:short", "board:watch", "focus", "meta", "news", "pulse", "roster"].every((id) => rows.some(([row]) => row === id)), "with writes that landed in the store, identical on both sides");
    ok(dump(newD).ledger.length >= 1, "and the nightly's meta landing reached the ledger on both");
  }

  {
    for (const env of [(d) => ({ DB: d.D1 }), (d) => ({ DB: d.D1, FLOWS_LIVE_TOKEN: LIVE }), (d) => ({ FLOWS_INGEST_TOKEN: NIGHTLY })]) {
      const oldD = fakeD1({ latencyMs: 0 });
      const newD = fakeD1({ latencyMs: 0 });
      seed(oldD);
      seed(newD);
      const oldLog = [];
      const newLog = [];
      const old = oldIngest(stubDeps(oldD, oldLog));
      const nd = stubDeps(newD, newLog);
      const table = createRouter(flowsIngestRows({ store: createFlowsStore({ ensureFlowsTables: nd.ensureFlowsTables }), ...nd }));
      for (const [method, q, token, base] of [["GET", "?key=board:long", NIGHTLY, BASE], ["POST", "?key=board:long", NIGHTLY, BASE],
        ["GET", "?key=clock", null, BASE], ["GET", "?key=live:breadth", LIVE, LOCAL], ["GET", "?list=card", NIGHTLY, BASE], ["GET", "?keys=meta", NIGHTLY, BASE]]) {
        const make = () => new Request(base + "/api/flows/ingest" + q, { method, headers: token ? { Authorization: "Bearer " + token } : {}, body: method === "POST" ? BODIES.good : undefined });
        const want = await observe(async () => { const r = make(); return old({ request: r, env: env(oldD), url: new URL(r.url) }); });
        const got = await observe(async () => table.handle({ request: make(), env: env(newD), url: new URL(make().url), ctx: {} }, {}));
        eq(got, want, "a Worker with fewer bindings answers " + method + " " + q + " as the branch did");
      }
    }
  }

  {
    const d = fakeD1({ latencyMs: 0 });
    d.db.exec("DROP TABLE flows_payload");
    const log = [];
    const nd = stubDeps(d, log);
    const store = createFlowsStore({ ensureFlowsTables: nd.ensureFlowsTables });
    const table = createRouter(flowsIngestRows({ store, ...nd }));
    const env = envOf(d);
    const call = (q, method = "GET") => observe(async () => table.handle({ request: new Request(BASE + "/api/flows/ingest" + q, { method, headers: { Authorization: "Bearer " + NIGHTLY } }), env, url: new URL(BASE + "/api/flows/ingest" + q), ctx: {} }, {}));
    const metaGone = await call("?keys=meta");
    eq([metaGone.error.status, metaGone.error.code, metaGone.error.headers], [503, "store_unreadable", { "Retry-After": "30" }], "a store that cannot answer the metadata read is 503 store_unreadable, as before");
    const listGone = await call("?list=card");
    eq([listGone.error.status, listGone.error.code], [503, "store_unreadable"], "and so is the listing");
    const noDb = await observe(async () => table.handle({ request: new Request(BASE + "/api/flows/ingest?list=card", { headers: { Authorization: "Bearer " + NIGHTLY } }), env: { FLOWS_INGEST_TOKEN: NIGHTLY }, url: new URL(BASE + "/api/flows/ingest?list=card"), ctx: {} }, {}));
    eq(noDb.error.code, "store_unreadable", "and a Worker with no D1 binding says the same");
  }
} finally {
  Date.now = realNow;
}

{
  const names = ["flows_payload", "flows_login_failures", "flows_ai_usage", "flows_ai_usage_model", "flows_ai_summary", "flows_neuron",
    "flows_live", "flows_tape", "flows_clock", "flows_ledger", "flows_archive_immutable", "flows_permanent_no_update", "flows_permanent_no_delete",
    "flows_dossier_cache", "flows_ai_outcome", "flows_ai_reject"];
  eq(FLOWS_REGISTRY.map((e) => e.name), names, "THE REGISTRY HOLDS THE TWELVE STATEMENTS THE WORKER HAS ALWAYS SENT, in the order it sent them, the two triggers that keep the permanent ideas rows (P0-42) and the counter tables after them");
  eq([...FLOWS_SCHEMA_SQL], FLOWS_REGISTRY.map((e) => e.ddl), "and FLOWS_SCHEMA_SQL is derived from it");
  eq([...FLOWS_SCHEMA_SQL.slice(6, 13)], [...LIVE_SCHEMA_SQL], "with the live layer's statements as that module exports them");
  eq(FLOWS_SCHEMA_SQL[13], DOSSIER_SCHEMA_SQL, "and the dossier cache as its module exports it");
  ok(Object.isFrozen(FLOWS_REGISTRY) && Object.isFrozen(FLOWS_SCHEMA_SQL) && FLOWS_REGISTRY.every((e) => Object.isFrozen(e) && Object.isFrozen(e.addedColumns)), "all of it frozen");
  ok(FLOWS_REGISTRY.every((e) => /^CREATE (TABLE|TRIGGER) IF NOT EXISTS \w+/.test(e.ddl) && e.owner && e.migration && e.table), "every statement is idempotent and names its owner, table and migration");
  const migrations = Object.fromEntries(readdirSync(new URL("../migrations/", import.meta.url)).map((f) => [f, readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8")]));
  const schemaSql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  const statementOf = (text, name) => {
    const m = new RegExp("CREATE TRIGGER IF NOT EXISTS " + name + "\\b[\\s\\S]*?\\bEND;").exec(text)
      || new RegExp("CREATE TABLE IF NOT EXISTS " + name + "\\b[\\s\\S]*?\\)(?: WITHOUT ROWID)?;").exec(text);
    return m ? norm(m[0]) : null;
  };
  for (const e of FLOWS_REGISTRY) {
    ok(Object.hasOwn(migrations, e.migration), e.name + " names a migration that exists");
    eq(statementOf(migrations[e.migration], e.name) !== null, true, e.migration + " creates " + e.name);
    ok(statementOf(schemaSql, e.name) !== null, "schema.sql declares " + e.name);
    if (e.addedColumns.length === 0) {
      eq(statementOf(migrations[e.migration], e.name), norm(e.ddl), e.name + ": the migration declares what the Worker's first-use DDL declares");
      eq(statementOf(schemaSql, e.name), norm(e.ddl), e.name + ": and so does schema.sql");
    } else {
      for (const [column, type] of e.addedColumns) {
        const alter = Object.values(migrations).some((text) => new RegExp("ALTER TABLE " + e.table + " ADD COLUMN " + column + " " + type.split(" ")[0] + ";").test(text));
        ok(alter, e.table + "." + column + " is added by a migration with that type");
        const declared = new RegExp("\\b" + column + " " + type.split(" ")[0] + "\\b", "i");
        ok(declared.test(e.ddl) && declared.test(statementOf(schemaSql, e.name) || ""), "and declared by the DDL and schema.sql");
      }
    }
  }
  eq(upgradeTables(FLOWS_REGISTRY), ["flows_clock"], "only flows_clock is probed for added columns today");
  ok(Array.isArray(LEDGER_ADDED_COLUMNS) && Object.isFrozen(LEDGER_ADDED_COLUMNS) && LEDGER_ADDED_COLUMNS.length === 0, "the ledger's list exists and is empty, because no column has been added since its migration");

  const throws = (fn, re, msg) => { assert.throws(fn, re, msg); checks++; };
  throws(() => registryOf(["CREATE TABLE flows_payload (id TEXT)"]), /idempotent CREATE/, "a statement that is not CREATE ... IF NOT EXISTS is refused");
  throws(() => registryOf(["CREATE TABLE IF NOT EXISTS nobody (id TEXT)"]), /no registry entry/, "a table nobody registered is refused");
  throws(() => registryOf([FLOWS_SCHEMA_SQL[0], FLOWS_SCHEMA_SQL[0]]), /declared twice/, "and so is a table declared twice");
  throws(() => registryOf([FLOWS_SCHEMA_SQL[0]]), /entries without a statement/, "and a registry entry that no statement backs");
  throws(() => checkAdded("x; DROP TABLE y", []), /not a table name/, "a table name is a bare identifier");
  throws(() => checkAdded("t", [["a b", "INTEGER"]]), /not \[name, type\]/, "a column name is a bare identifier");
  throws(() => checkAdded("t", [["a", "INTEGER; DROP TABLE t"]]), /not \[name, type\]/, "a column type carries no statement");
  throws(() => checkAdded("t", [["a", "BLOB"]]), /not \[name, type\]/, "and is one of three");
  throws(() => checkAdded("t", [["a", "INTEGER"], ["a", "TEXT"]]), /added twice/, "a column is added once");
  throws(() => checkAdded("t", "a"), /lists its added columns/, "the list is a list");
  for (const type of ["INTEGER", "TEXT", "REAL", "INTEGER NOT NULL DEFAULT 0", "REAL NOT NULL DEFAULT -1.5", "TEXT NOT NULL DEFAULT 'x'"]) {
    eq(checkAdded("t", [["col_1", type]]).length, 1, type + " is a column type");
  }
  throws(() => withAddedColumns(FLOWS_REGISTRY, "nothing", []), /not in the registry/, "a registry extension names an entry that exists");
  const grown = withAddedColumns(FLOWS_REGISTRY, "flows_ledger", [["z_col", "INTEGER NOT NULL DEFAULT 0"]]);
  eq([grown.find((e) => e.name === "flows_ledger").addedColumns.length, FLOWS_REGISTRY.find((e) => e.name === "flows_ledger").addedColumns.length], [1, 0], "and returns a new registry, leaving the shipped one as it was");
  eq(upgradeTables(grown), ["flows_clock", "flows_ledger"], "which probes the ledger as well");
  eq(columnProbe("flows_clock"), "PRAGMA table_info(flows_clock)", "the probe is the PRAGMA the Worker has always sent");
}

{
  const fakeDb = (have, fail = null) => {
    const sent = [];
    return { sent, db: { prepare(sql) {
      return {
        all: async () => { sent.push(sql); if (fail && fail.probe) throw new Error("probe failed"); return { results: have.map((name) => ({ name })) }; },
        run: async () => { sent.push(sql); if (fail && fail.alter && sql.includes(fail.alter[0])) throw new Error(fail.alter[1]); return {}; },
      };
    } } };
  };
  const ADDED = [["a_at", "INTEGER"], ["b_why", "TEXT"], ["c_n", "INTEGER NOT NULL DEFAULT 0"]];
  let f = fakeDb(["id", "a_at"]);
  eq(await upgradeColumns(f.db, "t", ADDED), ["b_why", "c_n"], "only the columns a table lacks are added");
  eq(f.sent, ["PRAGMA table_info(t)", "ALTER TABLE t ADD COLUMN b_why TEXT", "ALTER TABLE t ADD COLUMN c_n INTEGER NOT NULL DEFAULT 0"], "with the probe first and one ALTER each, the declared type and default carried");
  f = fakeDb(["id"]);
  eq(await upgradeColumns(f.db, "t", ADDED, { results: [{ name: "id" }, { name: "a_at" }, { name: "b_why" }, { name: "c_n" }] }), [], "a column list handed in is trusted and a complete table adds nothing");
  eq(f.sent, [], "at no trip at all");
  f = fakeDb(["id"], { alter: ["a_at", "duplicate column name: a_at"] });
  eq(await upgradeColumns(f.db, "t", ADDED), ["b_why", "c_n"], "a racing isolate that added a column first is tolerated");
  f = fakeDb(["id"], { alter: ["b_why", "database is locked"] });
  await assert.rejects(upgradeColumns(f.db, "t", ADDED), /database is locked/, "any other failure surfaces");
  checks++;
  f = fakeDb(["id"], { probe: true });
  eq((await upgradeColumns(f.db, "t", ADDED)).length, 3, "a probe that fails is read as an empty table, and the duplicate-column tolerance keeps that safe");
  eq(await upgradeColumns(null, "t", ADDED), [], "no database adds nothing");
  f = fakeDb([]);
  await assert.rejects(upgradeColumns(f.db, "t; DROP TABLE u", ADDED), /not a table name/, "a hostile table name is refused");
  await assert.rejects(upgradeColumns(f.db, "t", [["a", "INTEGER); DROP TABLE u; --"]]), /not \[name, type\]/, "and so is a hostile type");
  eq(f.sent, [], "before any statement is sent");
}

{
  const MIG = (f) => readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8");
  const fresh = fakeD1({ schema: "", latencyMs: 0 });
  const done = await applySchema(fresh.D1);
  eq(done, {}, "a database with nothing in it takes the registry's DDL and adds no column");
  eq(fresh.trips.map((t) => [t.kind, t.sqls.length]), [["batch", 17]], "in one batch of the sixteen CREATEs and the one probe");
  eq(fresh.trips[0].sqls.slice(0, 16), [...FLOWS_SCHEMA_SQL], "in registry order");
  eq(fresh.trips[0].sqls[16], "PRAGMA table_info(flows_clock)", "with the probe last");
  eq((await applySchema(fresh.D1), fresh.trips.length), 2, "and a second bootstrap is one more batch");

  const old = fakeD1({ schema: "", latencyMs: 0 });
  for (const f of ["0005_flows.sql", "0006_flows_ai_usage.sql", "0007_flows_ai_summary.sql", "0008_flows_neuron.sql", "0009_flows_ai_usage_model.sql", "0010_flows_live.sql", "0015_flows_ledger.sql", "0016_flows_dossier_cache.sql"]) old.db.exec(MIG(f));
  const cols = (d) => d.db.prepare("PRAGMA table_info(flows_clock)").all().map((c) => c.name);
  ok(!cols(old).includes("tier1_at") && !cols(old).includes("summary_at"), "the production table before its upgrades lacks the later columns");
  eq(await applySchema(old.D1), { flows_clock: FLOWS_LIVE.CLOCK_ADDED_COLUMNS.map(([c]) => c) }, "and the first use adds every one of them");
  const migrated = fakeD1({ schema: "", latencyMs: 0 });
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).sort().filter((n) => !/^000[1-4]|0013|0018/.test(n))) migrated.db.exec(MIG(f));
  eq(cols(old), cols(migrated), "leaving the columns, in order, a database built from the migrations has");
  eq(await applySchema(old.D1), {}, "a second pass adds nothing");

  const broken = fakeD1({ schema: "", latencyMs: 0 });
  broken.fail(/CREATE TABLE IF NOT EXISTS flows_payload/);
  await assert.rejects(applySchema(broken.D1), /refused/, "a batch the database refuses fails the bootstrap");
  checks++;
  eq(broken.trips.filter((t) => t.sqls.some((s) => /ALTER/.test(s))).length, 0, "and issues no ALTER");
}

{
  const d = fakeD1({ latencyMs: 0 });
  Date.now = () => FIXED_NOW;
  try {
    seed(d);
    const store = createFlowsStore({ ensureFlowsTables: async () => {} });
    const env = { DB: d.D1 };
    const trace = {};
    const hit = await store.read(env, "board:long", trace);
    eq([hit.payload.includes("rows"), hit.updatedAt, Boolean(hit.fresh), trace.failed], [true, 1790380000000, true, undefined], "read returns the payload, its stamp and its freshness");
    eq(await store.read(env, "card:NONE", trace), null, "an absent key reads null");
    eq(trace.failed, undefined, "without marking the read failed");
    const t2 = {};
    eq(await store.read({}, "board:long", t2), null, "no binding reads null");
    eq(t2.failed, true, "and marks it failed");
    d.fail(/flows_payload/);
    const t3 = {};
    eq(await store.read(env, "board:long", t3), null, "a refused read is null");
    eq(t3.failed, true, "and marked failed");
    eq(await store.metadata(env, ["meta"]), null, "metadata is null when the store refuses");
    eq(await store.listing(env, ["card"]), null, "and so is the listing");
    d.fail(null);
    const meta = await store.metadata(env, ["card:AAPL", "card:PNDG", "card:NONE"]);
    eq([meta["card:AAPL"].present, meta["card:PNDG"], meta["card:NONE"]], [true, { present: false }, { present: false }], "metadata marks a pending or absent key as not present");
    eq(Object.keys(meta["card:AAPL"]).sort(), ["bytes", "generatedAt", "present", "sessionDate", "updatedAt"], "and a present one by five fields");
    const list = await store.listing(env, ["card", "hist"]);
    eq([Object.keys(list.keys).sort(), list.listed, list.truncated], [["card:AAPL", "hist:AAPL"], 2, false], "a listing names the ticker keys of the kinds asked and skips pending cards");
    const insert = d.db.prepare("INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, '{}', 1)");
    for (let i = 0; i < 2001; i++) insert.run("hist:Z" + String(i).padStart(4, "0"));
    const big = await store.listing(env, ["hist"]);
    eq([big.listed <= 2000, big.truncated], [true, true], "and truncates at 2,000 rows");
    eq(await store.createArchive(env, "board:short:2026-01-05", "{}", FIXED_NOW), 1, "an archive row is created once");
    eq(await store.createArchive(env, "board:short:2026-01-05", "{\"x\":1}", FIXED_NOW), 0, "and a second create changes nothing");
    await store.write(env, "pulse", "{\"a\":1}", FIXED_NOW);
    await store.write(env, "pulse", "{\"a\":2}", FIXED_NOW + 5);
    eq({ ...d.db.prepare("SELECT payload, updated_at FROM flows_payload WHERE id = 'pulse'").get() }, { payload: "{\"a\":2}", updated_at: FIXED_NOW + 5 }, "a write replaces the row");
    eq(d.db.prepare("SELECT count(*) AS n FROM flows_ledger").get().n, 0, "and lands nothing in the ledger");
    await store.write(env, "meta", BODIES.meta, FIXED_NOW);
    eq(d.db.prepare("SELECT nightly_runs FROM flows_ledger").all().map((r) => r.nightly_runs), [1], "while the nightly's meta lands its ledger row in the same batch");
    eq([await store.remove(env, "pulse"), await store.remove(env, "pulse")], [1, 0], "remove reports the rows it removed");
  } finally {
    Date.now = realNow;
  }
  eq(storedFrom(null), null, "storedFrom of no row is null");
  eq(storedFrom({ payload: "", updated_at: 1 }), null, "and of an empty payload");
  eq(Object.keys(storedFrom({ payload: "{}", updated_at: 5 })).sort(), ["fresh", "payload", "updatedAt"], "and a row is its payload, stamp and freshness");
  eq(storedFrom({ payload: "{}", updated_at: 5 }).fresh, nightlyFreshMeta({ payload: "{}", updated_at: 5 }), "the freshness being the nightly's");
  const cases = [["card:AAPL", true], ["card-x:BRK.B", true], ["hist:AAPL", true], ["card:", false], ["card:aapl", false], ["card:TOOLONGTICKERX", false], ["board:long", true], ["board:sideways", false],
    ["board:long:2026-01-02", true], ["board:watch:2026-01-02", false], ["scores:2026-01-02", true], ["live:market", false], ["news:2026-01-02", false], ["roster", true], ["../etc", false]];
  for (const [key, valid] of cases) eq(ingestKeyParts(key).valid, valid, key + (valid ? " is" : " is not") + " an ingest key");
  eq(ingestKeyParts("card:AAPL").tickerKey[1], "card", "and a ticker key reports its kind");
}

{
  const w = moduleSource("worker.js");
  const anchor = { anchor: /path === "\/auth\/google"/ };
  absent(w, /path === "\/api\/flows\/ingest"/, { ...anchor, why: "the ingest route is a table row and no longer a branch of the chain" });
  absent(w, /INGEST_VIEW_KEY_RE|INGEST_META_SQL|INGEST_LIST|ingestKeyParts|ingestListSql|ingestListing|ingestMetadata|timingSafeEqualStr|DATED_ARCHIVE_KEY_RE|FLOWS_MAX_PAYLOAD_BYTES/, { ...anchor, why: "the ingest helpers moved with the route and the store" });
  absent(w, /ARCHIVE_REFUSALS|archiveWriteAction/, { ...anchor, why: "and so did the archive policy" });
  absent(w, /\bFLOWS_SCHEMA_SQL\b|CLOCK_COLUMNS_SQL|upgradeClockColumns|CREATE TABLE IF NOT EXISTS flows_/, { ...anchor, why: "the Flows DDL is the registry's and no longer the Worker's" });
  absent(w, /INSERT INTO flows_payload|DELETE FROM flows_payload/, { ...anchor, why: "and the Worker writes flows_payload only through the store" });
  expect(w, /createRouter\(flowsReadRows\([\s\S]*?\),\s*flowsDeskRows\(\{[\s\S]*?\),\s*flowsAiRows\(\{[\s\S]*?\),\s*flowsIngestRows\(\{ store: FLOWS_STORE, ensureFlowsTables, storeGone, passthrough \}\)\)/, { min: 1, max: 1, why: "the Worker's one table takes the ingest family after the ai family" });
  expect(w, /await applySchema\(env\.DB\);\s*state\.flowsSchemaReady = true;/, { min: 1, max: 1, why: "the schema is marked ready only after the registry's batch and its column upgrades" });
  expect(w, /const FLOWS_STORE = createFlowsStore\(/, { min: 1, max: 1, why: "one store" });
  expect(w, /const readFlowsPayload = \(env, key, trace\) => FLOWS_STORE\.read\(env, key, trace\);/, { min: 1, max: 1, why: "and the Worker's own reads go through it" });
  const route = moduleSource("server/routes/flows-ingest.js");
  expect(route, /if \(!tokenKind\) throw new HttpError\(401/, { min: 1, max: 1, why: "the credential check, once" });
  ok(route.indexOf("if (!tokenKind) throw new HttpError(401") < route.indexOf('if (key === "clock")') && route.indexOf('if (key === "clock")') < route.indexOf("store.read(") && route.indexOf("store.read(") < route.indexOf("store.write("),
    "and it precedes the clock, the reads and the writes");
  absent(route, /\bprepare\(|\.batch\(|env\.DB\./, { anchor: /store\.write\(/, why: "the route holds no SQL and names no table: the store is the only module that touches flows_payload" });
  const files = ["server/schema.js", "server/store.js", "server/routes/flows-ingest.js"];
  for (const f of files) {
    const text = moduleSource(f);
    absent(text, /^(?:let|var) |cloudflare:|from "\.\.\/worker\.js"|Date\.now\(\)\s*\{/m, { anchor: /^export /m, why: f + " holds no top-level mutable state and imports neither the Worker nor the platform" });
  }
  const writers = closure("worker.js").filter((file) => /FROM flows_payload|INTO flows_payload/.test(moduleSource(file)) && file.startsWith("server/"));
  eq(writers, ["server/store.js"], "among the server modules only the store holds flows_payload SQL");
}

console.log(`✓ server-ingest: ${checks} assertions — the ingest family as one table row compared with the branch it replaced over ${AUTHS.length} credentials, ${METHODS.length} methods, ${QUERIES.length} queries and five bodies (statements, call order, errors, bodies and the rows left behind), the store's reads and writes, the registry of fourteen Flows statements with its migrations and schema.sql, upgradeColumns against hostile names, races and refused batches, and the Worker scans`);
