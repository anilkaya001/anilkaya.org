import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FLOWS_COOKIE, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import { FIXTURE_OWNER, FIXTURE_MEMBER, FIXTURE_MEMBER_2 } from "./lib/fixture-roster.mjs";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { cronStrings, dayFirings, WEEKDAY } from "./lib/d1-budget.mjs";
import { pruneDue } from "../shared/flows-live-worker.js";
import { closure, moduleSource } from "./lib/source-scan.mjs";
import * as W from "./lib/member-world.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const SECRET = "member-worker-session-secret-abcdefghijklmnopqrstuvwxyz";
const BASE = "https://flows.test";
const realFetch = globalThis.fetch;
const realConsole = { error: console.error, warn: console.warn };
console.error = console.warn = () => {};

const tokens = {
  owner: await signFlowsSession(FIXTURE_OWNER, SECRET, 3600, sessionEpoch({ SESSION_SECRET: SECRET })),
  member: await signFlowsSession(FIXTURE_MEMBER, SECRET, 3600, sessionEpoch({ SESSION_SECRET: SECRET })),
  member2: await signFlowsSession(FIXTURE_MEMBER_2, SECRET, 3600, sessionEpoch({ SESSION_SECRET: SECRET })),
};

let instance = 0;
const loadWorker = async () => (await import("../worker.js?member=" + (++instance))).default;

function world(extra = {}) {
  const f = fakeD1({ latencyMs: 0 });
  f.put("universe", W.universePayload());
  const limits = { read: W.limiter(120), write: W.limiter(30), export: W.limiter(10) };
  const env = {
    DB: f.D1, SESSION_SECRET: SECRET, FLOWS_PEPPER: "member-worker-pepper", FLOWS_READ_MODE: "off",
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
    FLOWS_CREDENTIALS: JSON.stringify({ [FIXTURE_OWNER]: "x".repeat(43), [FIXTURE_MEMBER]: "y".repeat(43), [FIXTURE_MEMBER_2]: "z".repeat(43) }),
    FLOWS_MEMBER_STATE: "on", FLOWS_EXPORTS: "on", MEMBER_STATE_KEY: W.KEY,
    MEMBER_STATE_READ: limits.read, MEMBER_STATE_WRITE: limits.write, MEMBER_EXPORT: limits.export,
    ...extra,
  };
  return { f, env, limits };
}

async function call(worker, env, path, { principal = "member", method = "GET", body, headers = {}, contentType = "application/json" } = {}) {
  const h = { "Sec-Fetch-Site": "same-origin", Origin: BASE, ...(contentType ? { "Content-Type": contentType } : {}), ...headers };
  if (principal !== "anon") h.cookie = FLOWS_COOKIE + "=" + tokens[principal];
  const bg = [];
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => bg.push(Promise.resolve(p).catch(() => {})) });
  const text = await res.text();
  await Promise.all(bg);
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { res, text, json, bg: bg.length };
}

{
  const { f, env } = world();
  const worker = await loadWorker();
  const anon = await call(worker, env, "/api/me/state", { principal: "anon" });
  eq([anon.res.status, anon.json.error.code], [401, "unauthorized"], "an anonymous caller is 401");
  const got = await call(worker, env, "/api/me/state");
  eq(got.res.status, 200, "a signed-in member reads their state");
  eq(got.res.headers.get("Cache-Control"), "no-store", "no-store");
  eq(got.res.headers.get("Content-Type"), "application/json; charset=utf-8", "JSON");
  ok(got.res.headers.get("Strict-Transport-Security") && got.res.headers.get("X-Content-Type-Options") === "nosniff", "with the security headers");
  eq(got.res.headers.get("ETag"), '"w0"', "and the etag");
  ok(!got.res.headers.get("Set-Cookie"), "and no cookie");
  const post = await call(worker, env, "/api/me/state", { method: "POST", body: {} });
  eq([post.res.status, post.res.headers.get("Allow")], [405, "GET, PUT, DELETE"], "POST on the state route is 405 with Allow");
  const visitGet = await call(worker, env, "/api/me/visit");
  eq([visitGet.res.status, visitGet.res.headers.get("Allow")], [405, "POST"], "GET on the visit route is 405");
  eq((await call(worker, env, "/api/me/zz")).res.status, 404, "an unknown /api/me route is JSON 404");
  const put = await call(worker, env, "/api/me/state", { method: "PUT", headers: { "If-Match": '"w0"' }, body: { deviceOnly: false, watchlist: ["SYA002", "SYA001"] } });
  eq([put.res.status, put.json.watchlist, put.json.member], [200, ["SYA001", "SYA002"], FIXTURE_MEMBER], "a PUT through the Worker saves and names the caller");
  const other = await call(worker, env, "/api/me/state", { principal: "member2" });
  eq([other.json.watchlist, other.json.member], [null, FIXTURE_MEMBER_2], "another member sees none of it");
  const evil = await call(worker, env, "/api/me/state", { method: "PUT", headers: { "If-Match": '"w1"', Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }, body: { deviceOnly: true } });
  eq(evil.res.status, 403, "a cross-origin PUT is 403");
  const lab = await call(worker, env, "/api/me/state", { principal: "anon", headers: { cookie: "iewt_session=zz" } });
  eq(lab.res.status, 401, "and a Lab cookie is not a Flows session");
}

{
  const { f, env } = world({ MEMBER_STATE_KEY: undefined });
  const worker = await loadWorker();
  const got = await call(worker, env, "/api/me/state");
  eq([got.json.mode, got.json.reason], ["device-only", "key_absent"], "without the secret the Worker reports device-only mode");
  const put = await call(worker, env, "/api/me/state", { method: "PUT", headers: { "If-Match": '"w0"' }, body: { deviceOnly: false, watchlist: ["SYA001"] } });
  eq([put.res.status, put.json.error.code], [503, "member_state_unavailable"], "and refuses a list");
  eq(f.db.prepare("SELECT count(*) AS n FROM member_state").get().n, 0, "storing nothing");
}

{
  const { f, env } = world();
  const worker = await loadWorker();
  const ddl = () => f.trips.filter((t) => t.sqls.some((s) => /CREATE TABLE IF NOT EXISTS member_state/.test(s))).length;
  await call(worker, env, "/api/flows/universe?cols=t", { principal: "member" });
  await call(worker, env, "/api/me/state");
  await call(worker, env, "/api/me/state");
  await call(worker, env, "/api/me/visit", { method: "POST" });
  eq(ddl(), 1, "the member tables are created once per database object, on the first /api/me request");
  const g = fakeD1({ latencyMs: 0 });
  const w2 = world();
  const other = { ...w2.env, DB: g.D1 };
  g.put("universe", W.universePayload());
  await call(worker, other, "/api/flows/universe?cols=t", { principal: "member" });
  await call(worker, other, "/api/flows/long");
  ok(!g.trips.some((t) => t.sqls.some((s) => /member_state|member_export/.test(s))), "and no other route creates or reads them");
}

{
  const { f, env, limits } = world();
  const worker = await loadWorker();
  const reads = [];
  const touched = new Set();
  const spyEnv = new Proxy(env, { get(target, key) { touched.add(String(key)); return target[key]; } });
  globalThis.fetch = async (url) => { reads.push(String(url)); throw new Error("a network call was made"); };
  const ai = { run: async () => { throw new Error("a model was asked"); } };
  spyEnv.AI = ai;
  const universe = f.db.prepare("SELECT updated_at FROM flows_payload WHERE id = 'universe'").get();
  ok(universe, "the universe row exists");
  let waited = 0;
  const run = async (path, opts) => {
    const res = await worker.fetch(new Request(BASE + path, { method: (opts && opts.method) || "GET", headers: { Origin: BASE, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", cookie: FLOWS_COOKIE + "=" + tokens.member, ...((opts && opts.headers) || {}) }, body: opts && opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), spyEnv, { waitUntil: () => { waited++; } });
    return res.status;
  };
  const statuses = [
    await run("/api/me/state"),
    await run("/api/me/state", { method: "PUT", headers: { "If-Match": '"w0"' }, body: { deviceOnly: false, watchlist: ["SYA001", "SYA400"] } }),
    await run("/api/me/state", { method: "PUT", headers: { "If-Match": '"w0"' }, body: { deviceOnly: false, watchlist: ["SYA001", "SYA002"] } }),
    await run("/api/me/visit", { method: "POST" }),
    await run("/api/me/since"),
    await run("/api/me/exports"),
    await run("/api/me/export", { method: "POST", body: { page: "moves", format: "csv" } }),
    await run("/api/me/state", { method: "DELETE" }),
  ];
  globalThis.fetch = realFetch;
  eq(statuses.slice(0, 1).concat(statuses.slice(2)), [200, 200, 200, 200, 200, 200, 200], "every /api/me route answers while the network and the model are refused");
  eq(reads, [], "none made a network call, so none reached the vendor");
  eq(waited, 0, "none used waitUntil");
  const allowed = new Set(["DB", "SESSION_SECRET", "FLOWS_CREDENTIALS", "FLOWS_SESSION_EPOCH", "FLOWS_MEMBER_STATE", "FLOWS_EXPORTS", "MEMBER_STATE_KEY", "MEMBER_STATE_KEY_PREV",
    "MEMBER_STATE_READ", "MEMBER_STATE_WRITE", "MEMBER_EXPORT", "FLOWS_RT_USERS", "FLOWS_RT_MODE", "FLOWS_RT_AUDIENCE", "FLOWS_RT_HINT", "FLOWS_RT_UPSTREAM",
    "FLOWS_RT_SOCKET_HOURS", "FLOWS_RT_USER_CAP", "FLOWS_RT_CALLS_PER_MIN", "FLOWS_RT_SCALE", "UW_BASE", "UW_NOW", "FLOWS_METER", "FLOWS_READ_MODE", "then"]);
  const extra = [...touched].filter((k) => !allowed.has(k));
  eq(extra, [], "and the environment properties they touched are the database, the session, the switches and the limiters: " + extra.join(", "));
  ok(!touched.has("AI") && !touched.has("UW_API_KEY") && !touched.has("PULSE"), "never the model, the vendor key or the rail");
  eq([limits.read.calls.length > 0, limits.write.calls.length > 0, limits.export.calls.length > 0], [true, true, true], "each route spent its own limiter");
}

{
  const { f, env } = world({ UW_API_KEY: "k" });
  const worker = await loadWorker();
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 503 });
  const firings = dayFirings(cronStrings(), WEEKDAY);
  const pick = (job, test = () => true) => firings.find((x) => x.job === job && test(x));
  const chosen = [pick("rth"), pick("focus"), pick("summary"), pick("housekeeping", (x) => !pruneDue(x.at)), pick("housekeeping", (x) => pruneDue(x.at))];
  ok(chosen.every(Boolean), "a firing of each kind was found");
  const seen = [];
  for (const firing of chosen) {
    const n = f.trips.length;
    const bg = [];
    await worker.scheduled({ cron: firing.cron, scheduledTime: firing.at }, env, { waitUntil: (p) => bg.push(Promise.resolve(p)) });
    await Promise.all(bg);
    seen.push([firing.job, pruneDue(firing.at), f.trips.slice(n).some((t) => t.sqls.some((s) => /\bmember_(state|export)\b/.test(s)))]);
  }
  globalThis.fetch = realFetch2;
  eq(seen, [["rth", false, false], ["focus", false, false], ["summary", false, false], ["housekeeping", false, false], ["housekeeping", true, true]],
    "the vendor ticks, the summary and an ordinary housekeeping firing never name the member tables; only the 03:00 ET prune does");
}

const MODULES = ["server/member-store.js", "server/routes/flows-me.js", "shared/flows-member-crypto.js", "shared/flows-member-state.js", "shared/flows-member-calendar.js",
  "shared/flows-member-windows.js", "shared/flows-since.js", "shared/flows-columns.js", "shared/flows-export-format.js", "shared/flows-export-build.js"];

for (const file of MODULES) {
  const text = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const imports = [...text.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);
  const banned = imports.filter((s) => /vendor|flows-live|dossier|reading|flows-ai|neuron|flows-rt|quant/.test(s));
  eq(banned, [], file + " imports no vendor, live, model or rail module");
  ok(!/\bAI\b|env\.AI|uwFetch|\bfetch\(|XMLHttpRequest|WebSocket/.test(text), file + " names no model, no vendor call and no network call");
  ok(!/console\./.test(text), file + " writes nothing to the console");
  const logs = [...text.matchAll(/logFailure\(([^;]*)\);/g)].map((m) => m[1]);
  for (const log of logs) ok(/^"error", "member state unreadable", \{ route: "\/api\/me\/state", code: "unreadable" \}$/.test(log.trim()), file + " logs only a fixed event with a route and a code: " + log);
}

{
  const sources = ["worker.js", ...closure("worker.js")].filter((f, i, a) => a.indexOf(f) === i);
  const users = sources.filter((f) => /\bmember_(state|export)\b/.test(moduleSource(f)));
  eq(users.sort(), ["server/member-store.js", "worker.js"], "only the member store and the Worker's DDL constant name the member tables");
  const lines = moduleSource("worker.js").split("\n");
  const start = lines.findIndex((l) => l.startsWith("const MEMBER_STATE_SCHEMA_SQL = Object.freeze(["));
  const end = lines.findIndex((l, i) => i > start && l === "]);");
  ok(start > 0 && end > start, "the DDL constant was found");
  const outside = lines.map((l, i) => [i, l]).filter(([i, l]) => (i < start || i > end) && /\bmember_(state|export)\b/.test(l)).map(([, l]) => l.trim());
  eq(outside.filter((l) => !/MEMBER_STORE|MEMBER_STATE_SCHEMA_SQL/.test(l)), [], "and in worker.js only inside that constant");
}

{
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const staging = readFileSync(new URL("../wrangler.staging.toml", import.meta.url), "utf8");
  const block = (text, name) => new RegExp(`\\[\\[ratelimits\\]\\]\\s*name = "${name}"\\s*namespace_id = "(\\d+)"\\s*simple = \\{ limit = (\\d+), period = (\\d+) \\}`).exec(text);
  const ids = [];
  for (const [name, limit] of [["MEMBER_STATE_READ", "120"], ["MEMBER_STATE_WRITE", "30"], ["MEMBER_EXPORT", "10"]]) {
    const a = block(toml, name);
    const b = block(staging, name);
    ok(a && b, name + " is declared in production and staging");
    eq([a[2], a[3], b[2], b[3]], [limit, "60", limit, "60"], name + " is " + limit + " a minute in both");
    ok(a[1] !== b[1], name + " has a staging namespace of its own");
    ids.push(a[1], b[1]);
  }
  const all = [...toml.matchAll(/namespace_id = "(\d+)"/g)].map((m) => m[1]).concat([...staging.matchAll(/namespace_id = "(\d+)"/g)].map((m) => m[1]));
  eq(new Set(all).size, all.length, "every rate-limit namespace in either file is distinct");
  ok(/FLOWS_MEMBER_STATE = "on"/.test(toml) && /FLOWS_EXPORTS = "owner"/.test(toml), "production ships member state on and exports for the owner only");
  ok(!/MEMBER_STATE_KEY/.test(toml) && !/MEMBER_STATE_KEY/.test(staging), "and no key value is in either file");
}

{
  const { f, env } = world();
  const worker = await loadWorker();
  const rows = { state: [], put: [], visit: [], del: [], exports: [] };
  const cost = async (bucket, path, opts) => {
    const n = f.trips.length;
    const out = await call(worker, env, path, opts);
    rows[bucket].push(f.rowsRead(n));
    return out;
  };
  await cost("state", "/api/me/state");
  await cost("put", "/api/me/state", { method: "PUT", headers: { "If-Match": '"w0"' }, body: { deviceOnly: false, watchlist: W.names("SYA", 200) } });
  await cost("state", "/api/me/state");
  await cost("visit", "/api/me/visit", { method: "POST" });
  await cost("exports", "/api/me/exports");
  await cost("del", "/api/me/state", { method: "DELETE" });
  const CEILING = { state: 2, put: 6, visit: 3, del: 2, exports: 201 };
  for (const [k, list] of Object.entries(rows)) for (const n of list) ok(n <= CEILING[k], `rows read by ${k}: ${n}, ceiling ${CEILING[k]}`);
  const { createRouter } = await import("../server/router.js");
  const { flowsMeRows } = await import("../server/routes/flows-me.js");
  const stub = new Proxy({}, { get: () => () => null });
  const paths = createRouter(flowsMeRows(stub)).rows.map((r) => r.path);
  eq(paths.sort(), ["/api/me/export", "/api/me/exports", "/api/me/since", "/api/me/state", "/api/me/visit"], "the family holds these five routes");
  const priced = new Set(["/api/me/state", "/api/me/visit", "/api/me/exports", "/api/me/since", "/api/me/export"]);
  eq(paths.filter((p) => !priced.has(p)), [], "and every one of them has a ceiling declared here");
}

console.error = realConsole.error;
console.warn = realConsole.warn;
console.log("flows-member-worker: " + checks + " checks");
