import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { FLOWS_COOKIE, FLOWS_USERNAMES, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import * as W from "../shared/flows-live-worker.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const SESSION_SECRET = "reads-session-secret-abcdefghijklmnopqrstuvwxyz";
globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const trips = [];
  let failing = null;
  const reads = /^\s*(SELECT|PRAGMA|WITH)/i;
  const exec = (sql, args) => {
    if (failing && failing.test(sql)) throw new Error("fake D1 refused " + sql.slice(0, 40));
    const st = db.prepare(sql);
    if (reads.test(sql)) return { results: st.all(...args), meta: {} };
    return { results: [], meta: { changes: st.run(...args).changes } };
  };
  const trip = (kind, sqls, fn) => new Promise((resolve, reject) => setImmediate(() => {
    trips.push({ kind, sqls });
    try { resolve(fn()); } catch (error) { reject(error); }
  }));
  const D1 = {
    prepare(sql) {
      const st = { sql, args: [], bind(...a) { st.args = a; return st; },
        first: () => trip("first", [sql], () => exec(sql, st.args).results[0] ?? null),
        all: () => trip("all", [sql], () => exec(sql, st.args)),
        run: () => trip("run", [sql], () => exec(sql, st.args)) };
      return st;
    },
    batch: (list) => trip("batch", list.map((s) => s.sql), () => list.map((s) => exec(s.sql, s.args))),
  };
  const put = (id, value, at = 1790380000000) => db.prepare(
    "INSERT OR REPLACE INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?)",
  ).run(id, typeof value === "string" ? value : JSON.stringify(value), at);
  const live = (id, value, readAt, session) => db.prepare(
    "INSERT OR REPLACE INTO flows_live (id, payload, read_at, session, cadence_s, source, writer, updated_at) VALUES (?, ?, ?, ?, 300, 'worker', 'worker@rth', ?)",
  ).run(id, JSON.stringify(value), readAt, session, readAt);
  return { D1, db, trips, put, live, fail: (re) => { failing = re; },
    since: (n) => trips.slice(n), count: (re, from = 0) => trips.slice(from).filter((t) => t.sqls.some((s) => re.test(s))).length };
}

let instance = 0;
async function client(D1, extra = {}) {
  const env = { DB: D1, SESSION_SECRET, FLOWS_CREDENTIALS: JSON.stringify({ [FLOWS_USERNAMES[0]]: "x".repeat(43) }), ...extra };
  const token = await signFlowsSession(FLOWS_USERNAMES[0], env.SESSION_SECRET, 3600, sessionEpoch(env));
  const worker = (await import("../worker.js?reads=" + (++instance))).default;
  return async (route) => {
    const background = [];
    const ctx = { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) };
    const req = new Request("https://anilkaya.org" + route,
      { headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin" } });
    const res = await worker.fetch(req, env, ctx);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { res, body, text, settle: () => Promise.all(background) };
  };
}

const SESSION = "2026-09-24";
const NIGHTLY = { v: 1, sessionDate: SESSION, generatedAt: "2026-09-25T00:10:00.000Z" };
const PANELS = { pricedMove: { status: "ok", impliedMove: 0.05, realizedMove: 0.04, sessions: 10, iv30: 0.31, rv30: 0.25 } };
function seed(f) {
  for (const key of ["board:long", "board:short", "board:watch", "market", "scoretrack", "sector:premium", "news", "regime", "focus", "meta"]) {
    f.put(key, { ...NIGHTLY, rows: [] });
  }
  f.put("events", { ...NIGHTLY, rows: [{ t: "GATED", d: "2026-09-29", dte: 5, st: "gated" }] });
  f.put("flowalerts", { v: 2, ...NIGHTLY, readAt: NIGHTLY.generatedAt, rows: [], status: "quiet" });
  f.put("pulse", { ...NIGHTLY, totals: { calls: 1 }, tide: { status: "ok", points: [] } });
  f.put("universe", { ...NIGHTLY, n: 3, t: ["NVDA", "LITE", "GATED"], sectors: ["Technology"], sec: [0, 0, 0],
    units: { px: ["usd", 100] }, cols: { px: [17000, 7252, 900] }, pct: { px: [90, 50, 10] } });
  f.put("roster", { v: 1, sessionDate: "2020-01-02", depth: { NVDA: "focus", PEND: "cross", IDX: "index" } });
  f.put("card:NVDA", { ...NIGHTLY, ticker: "NVDA", panels: PANELS, score: 61, conviction: 70 });
}

const HOME = [
  "/api/flows/board?side=long", "/api/flows/board?side=watch", "/api/flows/market", "/api/flows/flowalerts", "/api/flows/events",
  "/api/flows/scoretrack", "/api/flows/sector-premium", "/api/flows/news", "/api/flows/pulse", "/api/flows/regime",
  "/api/flows/lk?k=market", "/api/flows/lk?k=vol", "/api/flows/lk?k=breadth", "/api/flows/focus", "/api/flows/lk?k=strips",
  "/api/flows/lk?k=strips:series", "/api/flows/now?n=board:long,board:short,meta,focus",
];
const SCHEMA_RE = /^CREATE TABLE IF NOT EXISTS flows_payload/;
const PRAGMA_RE = /^PRAGMA table_info\(flows_clock\)/;

{
  const f = fakeD1();
  seed(f);
  W.memoClock(null, 0);
  const get = await client(f.D1);
  const answers = await Promise.all(HOME.map(get));
  ok(answers.every((a) => a.res.status === 200), "a cold isolate answers all seventeen home-page reads at once");
  eq(f.count(SCHEMA_RE), 1,
     "SINGLE-FLIGHT SCHEMA: seventeen concurrent requests on a cold isolate run the ten-statement schema batch once, " +
     "not once each (the investigation counted 17 redundant batches per cold home load)");
  eq(f.count(PRAGMA_RE), 1, "and the clock-column PRAGMA of upgradeClockColumns once");
  ok(!f.trips.some((t) => t.sqls.some((s) => /^ALTER TABLE flows_clock/.test(s))), "with no ALTER on a table that already has every column");
  const before = f.trips.length;
  await get("/api/flows/meta");
  eq(f.count(SCHEMA_RE, before), 0, "once ready, a later request runs no schema statement");
  eq(f.trips.length - before, 1, "and a nightly passthrough is one trip");
}

{
  const f = fakeD1();
  seed(f);
  f.fail(/^CREATE TABLE IF NOT EXISTS flows_payload/);
  const get = await client(f.D1);
  const answers = await Promise.all(["/api/flows/board?side=long", "/api/flows/board?side=watch", "/api/flows/market",
    "/api/flows/events", "/api/flows/scoretrack", "/api/flows/news"].map(get));
  eq(f.count(SCHEMA_RE), 1, "A FAILING SCHEMA BATCH is attempted once for six concurrent callers");
  ok(answers.every((a) => a.res.status === 200), "who all still answer, as they did when each ran its own batch");
  const retry = f.trips.length;
  await get("/api/flows/meta");
  eq(f.count(SCHEMA_RE, retry), 1, "the failure clears the flight, so the next request retries the batch");
  f.fail(null);
  const healed = f.trips.length;
  await get("/api/flows/meta");
  eq(f.count(SCHEMA_RE, healed), 1, "and retries again while it keeps failing");
  const ready = f.trips.length;
  await Promise.all([get("/api/flows/meta"), get("/api/flows/market")]);
  eq(f.count(SCHEMA_RE, ready), 0, "until one batch succeeds, after which the schema is ready for good");
}

console.log(`flows-reads-contract: ${checks} checks passed`);
