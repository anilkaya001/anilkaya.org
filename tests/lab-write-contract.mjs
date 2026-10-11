import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { signSession } from "../shared/session.js";
import { easternInstant } from "../shared/flows-freshness.js";
import { SKILL_BY_ID } from "../shared/skill-manifest.js";
import { REVIEW_ITEMS } from "../shared/review-manifest.js";
import { COURSE_STAGE_POINTS } from "../shared/course-points.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const SESSION_SECRET = "lab-write-session-secret-abcdefghijklmnopqrstuvwxyz";
globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

function fakeD1({ schema = SCHEMA } = {}) {
  const db = new DatabaseSync(":memory:");
  if (schema) db.exec(schema);
  const trips = [];
  const returns = /^\s*(SELECT|PRAGMA|WITH)|\bRETURNING\b/i;
  const exec = (sql, args) => {
    const st = db.prepare(sql);
    if (returns.test(sql)) return { results: st.all(...args), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(st.run(...args).changes) } };
  };
  const trip = (kind, sqls, fn) => new Promise((resolve, reject) => setTimeout(() => {
    trips.push({ kind, sqls });
    try { resolve(fn()); } catch (error) { reject(error); }
  }, 0));
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
  return { D1, db, trips };
}

function limiter(limit) {
  const seen = new Map();
  const calls = [];
  return {
    calls,
    seen,
    async limit({ key }) {
      calls.push(key);
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      return { success: n <= limit };
    },
    reset() { seen.clear(); },
  };
}

let instance = 0;
const worker = (await import("../worker.js?labwrite=" + (++instance))).default;
const ORIGIN = "https://anilkaya.org";
const exp = () => Date.now() + 10 * 60 * 1000;
const tokenFor = (sub) => signSession({ sub, email: "t@example.com", name: "T", exp: exp() }, SESSION_SECRET);

async function call(env, { method = "PUT", path, body, sub = "g_lab", generation = "0", owner = sub, cookie = true, extra = {} }) {
  const headers = { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", ...extra };
  if (cookie) headers.cookie = "session=" + (await tokenFor(sub));
  if (owner !== null) headers["X-IEWT-Owner"] = owner;
  if (generation !== null) headers["X-IEWT-Generation"] = generation;
  const background = [];
  const ctx = { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) };
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const text = await res.text();
  await Promise.all(background);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { res, body: parsed };
}

const skillId = Object.keys(SKILL_BY_ID)[0];
const reviewItem = REVIEW_ITEMS[0];
const course = Object.keys(COURSE_STAGE_POINTS)[0];
const stageKey = Object.keys((await import("../shared/stage-manifest.js")).COURSE_STAGE_BY_ID).find((k) => k.startsWith(course + ":"));
const stageId = stageKey.slice(course.length + 1);
const attempt = (n) => ({ skillId, itemId: `${skillId}:v1`, attemptId: "a-" + n, correct: true, hinted: false, day: "2026-10-09" });
const mastery = (n) => ({ itemId: reviewItem.id, attemptId: "m-" + n, correct: true, hinted: false, day: "2026-10-09" });

const MUTATIONS = [
  { name: "PUT /api/v2/attempt", method: "PUT", path: "/api/v2/attempt", body: (n) => attempt(n) },
  { name: "PUT /api/mastery", method: "PUT", path: "/api/mastery", body: (n) => mastery(n) },
  { name: "PUT /api/v2/progress", method: "PUT", path: "/api/v2/progress", body: () => ({ courseId: course, stageId, complete: true }) },
  { name: "PUT /api/v2/preferences", method: "PUT", path: "/api/v2/preferences", body: () => ({ activePathId: "complete-core", sessionMinutes: 20, weeklyGoalMinutes: 120 }) },
  { name: "PUT /api/v2/project", method: "PUT", path: "/api/v2/project", body: () => ({ projectId: "x", mode: "guided", completedTaskIds: [] }) },
  { name: "PUT /api/progress", method: "PUT", path: "/api/progress", body: () => ({ model: course, done: [0] }) },
  { name: "PUT /api/stats", method: "PUT", path: "/api/stats", body: () => ({ streak: 1, last: "2026-10-09" }) },
  { name: "PUT /api/placement", method: "PUT", path: "/api/placement", body: () => ({ band: "applied", score: 8, total: 15, completedDay: "2026-10-09", recommendedTopic: "ols" }) },
  { name: "DELETE /api/placement", method: "DELETE", path: "/api/placement", body: () => undefined },
  { name: "DELETE /api/progress", method: "DELETE", path: "/api/progress", body: () => undefined },
];

{
  const f = fakeD1();
  const LAB_WRITE = limiter(30);
  const env = { DB: f.D1, SESSION_SECRET, LAB_WRITE };
  const statuses = [];
  for (let i = 1; i <= 31; i++) {
    const r = await call(env, { path: "/api/v2/attempt", body: attempt(i) });
    statuses.push(r.res.status);
    if (i === 31) {
      eq(r.res.status, 429, "the 31st Lab mutation in the window answers 429");
      eq(r.body.error.code, "rate_limited", "the 429 carries the JSON error envelope");
      eq(r.res.headers.get("Retry-After"), "60", "the 429 names the period as Retry-After");
      eq(r.res.headers.get("Cache-Control"), "no-store", "the 429 is not cached");
      ok(/^application\/json/.test(r.res.headers.get("Content-Type")), "the 429 is JSON");
    }
  }
  deep(statuses.slice(0, 30), Array(30).fill(200), "the first 30 attempts in the window are accepted");
  eq(f.db.prepare("SELECT count(*) AS n FROM skill_attempts").get().n, 30, "the refused 31st attempt wrote nothing");
  deep([...new Set(LAB_WRITE.calls)], ["g_lab"], "the limiter key is the verified user id");
  const before = f.trips.length;
  const refused = await call(env, { path: "/api/v2/attempt", body: attempt(32) });
  eq(refused.res.status, 429, "the window stays closed");
  eq(f.trips.length, before, "a refused mutation makes no D1 round trip at all");
  const other = await call(env, { path: "/api/v2/attempt", body: attempt(1), sub: "g_other" });
  eq(other.res.status, 200, "another user is not charged for this user's flood");
  LAB_WRITE.reset();
  eq((await call(env, { path: "/api/v2/attempt", body: attempt(33) })).res.status, 200, "a new window admits the user again");
}

for (const m of MUTATIONS) {
  const f = fakeD1();
  const LAB_WRITE = limiter(0);
  const env = { DB: f.D1, SESSION_SECRET, LAB_WRITE };
  const r = await call(env, { method: m.method, path: m.path, body: m.body(1) });
  eq(r.res.status, 429, `${m.name} is behind the Lab write limiter`);
  eq(r.res.headers.get("Retry-After"), "60", `${m.name}: Retry-After`);
  eq(f.trips.length, 0, `${m.name}: a refused request reads and writes nothing`);
}

{
  const f = fakeD1();
  const LAB_WRITE = limiter(0);
  const env = { DB: f.D1, SESSION_SECRET, LAB_WRITE };
  for (const path of ["/api/progress", "/api/stats", "/api/mastery", "/api/placement", "/api/bootstrap", "/api/v2/bootstrap", "/api/me"]) {
    const r = await call(env, { method: "GET", path, body: undefined, generation: null });
    ok(r.res.status === 200, `GET ${path} is never limited (${r.res.status})`);
  }
  eq(LAB_WRITE.calls.length, 0, "reads do not touch the limiter");
}

{
  const f = fakeD1();
  const LAB_WRITE = limiter(0);
  const env = { DB: f.D1, SESSION_SECRET, LAB_WRITE };
  eq((await call(env, { path: "/api/v2/attempt", body: attempt(1), cookie: false })).res.status, 401, "an anonymous mutation is a 401 before the limiter");
  eq((await call(env, { path: "/api/v2/attempt", body: attempt(1), owner: "g_someone_else" })).res.status, 409, "a wrong owner is a 409 before the limiter");
  eq((await call(env, { path: "/api/v2/attempt", body: attempt(1), extra: { Origin: "https://evil.example" } })).res.status, 403, "a cross-origin mutation is a 403 before the limiter");
  eq(LAB_WRITE.calls.length, 0, "only an authenticated same-origin owner-matched mutation is counted");
}

{
  const down = { limit: async () => { throw new Error("limiter down"); } };
  for (const LAB_WRITE of [undefined, down, { limit: async () => undefined }]) {
    const f = fakeD1();
    const r = await call({ DB: f.D1, SESSION_SECRET, LAB_WRITE }, { path: "/api/v2/attempt", body: attempt(1) });
    eq(r.res.status, 200, "a missing, failing or silent limiter admits the write: the brake fails open");
  }
}

{
  const f = fakeD1();
  const env = { DB: f.D1, SESSION_SECRET, LAB_WRITE: limiter(1000) };
  const tables = ["skill_attempts", "mastery_attempts"];
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
  const insertSkill = f.db.prepare("INSERT INTO skill_attempts (user_id, attempt_id, skill_id, item_id, correct, hinted, attempt_day, applied, received_at) VALUES (?, ?, ?, ?, 1, 0, '2026-09-01', 1, ?)");
  const insertMastery = f.db.prepare("INSERT INTO mastery_attempts (user_id, attempt_id, item_id, correct, hinted, attempt_day, applied, received_at) VALUES (?, ?, ?, 1, 0, '2026-09-01', 1, ?)");
  f.db.exec("BEGIN");
  for (let i = 0; i < 3000; i++) {
    insertSkill.run("g_lab", "old-s-" + i, skillId, `${skillId}:v1`, old);
    insertMastery.run("g_lab", "old-m-" + i, reviewItem.id, old);
  }
  f.db.exec("COMMIT");
  const r1 = await call(env, { path: "/api/v2/attempt", body: attempt(1) });
  const r2 = await call(env, { path: "/api/mastery", body: mastery(1) });
  eq(r1.res.status, 200, "skill attempt accepted with 3,000 old rows stored");
  eq(r2.res.status, 200, "review attempt accepted with 3,000 old rows stored");
  eq(f.db.prepare("SELECT count(*) AS n FROM skill_attempts WHERE received_at < ?").get(Date.now() - 48 * 3600 * 1000).n, 3000, "the request path no longer prunes the ledger");
  eq(f.db.prepare("SELECT count(*) AS n FROM mastery_attempts WHERE received_at < ?").get(Date.now() - 48 * 3600 * 1000).n, 3000, "the request path no longer prunes the review ledger");

  const issued = f.trips.flatMap((t) => t.sqls);
  ok(!issued.some((sql) => /received_at\s*</.test(sql)), "no request-path statement ranges over received_at");
  const batches = f.trips.filter((t) => t.kind === "batch" && t.sqls.some((s) => /INTO (skill|mastery)_attempts/.test(s)));
  eq(batches.length, 2, "one batch per attempt");
  for (const b of batches) {
    for (const sql of b.sqls) {
      const bindCount = (sql.match(/\?/g) || []).length;
      const probe = f.db.prepare("EXPLAIN QUERY PLAN " + sql).all(...Array(bindCount).fill("g_lab"));
      for (const row of probe) {
        const m = /^(SCAN|SEARCH)\s+(skill_attempts|mastery_attempts)\b(.*)$/.exec(row.detail);
        if (!m) continue;
        ok(m[1] === "SEARCH" && /\(user_id=\? AND attempt_id=\?\)/.test(m[3]), `attempt statement reads by its primary key only: ${row.detail}`);
      }
    }
  }
  for (const t of tables) {
    const index = `${t}_by_received`;
    const plan = f.db.prepare(`EXPLAIN QUERY PLAN DELETE FROM ${t} WHERE received_at < ?`).all(0).map((r) => r.detail).join(" | ");
    ok(plan.includes(`USING INDEX ${index}`) && !/SCAN/.test(plan), `the prune of ${t} is a range seek on ${index}: ${plan}`);
    const names = f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").all(index);
    eq(names.length, 1, `schema.sql creates ${index}`);
  }

  const tuesdayNight = easternInstant("2026-10-13", 3 * 60);
  f.db.prepare("UPDATE skill_attempts SET received_at=? WHERE attempt_id='a-1'").run(tuesdayNight - 60 * 1000);
  f.db.prepare("UPDATE mastery_attempts SET received_at=? WHERE attempt_id='m-1'").run(tuesdayNight - 60 * 1000);
  const before = f.trips.length;
  const background = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("no network in this suite"); };
  try {
    await worker.scheduled({ cron: "*/30 * * * *", scheduledTime: tuesdayNight }, env, { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) });
    await Promise.all(background);
  } finally { globalThis.fetch = realFetch; }
  const pruneBatches = f.trips.slice(before).filter((t) => t.kind === "batch" && t.sqls.some((s) => /DELETE FROM (skill|mastery)_attempts WHERE received_at/.test(s)));
  eq(pruneBatches.length, 2, "the 03:00 ET housekeeping firing prunes both ledgers, one batch each");
  for (const b of pruneBatches) {
    eq(b.sqls.length, 2, "a prune batch is the idempotent index statement and one DELETE");
    ok(/^CREATE INDEX IF NOT EXISTS/.test(b.sqls[0]), "the index is ensured before the range delete");
  }
  eq(f.db.prepare("SELECT count(*) AS n FROM skill_attempts WHERE attempt_id LIKE 'old-s-%'").get().n, 0, "old skill attempts are gone after the nightly prune");
  eq(f.db.prepare("SELECT count(*) AS n FROM mastery_attempts WHERE attempt_id LIKE 'old-m-%'").get().n, 0, "old review attempts are gone after the nightly prune");
  eq(f.db.prepare("SELECT count(*) AS n FROM mastery_attempts WHERE attempt_id='m-1'").get().n, 1, "a recent review attempt survives");
  eq(f.db.prepare("SELECT count(*) AS n FROM skill_attempts WHERE attempt_id='a-1'").get().n, 1, "a recent skill attempt survives");

  const noonFiring = f.trips.length;
  await worker.scheduled({ cron: "*/30 * * * *", scheduledTime: easternInstant("2026-10-13", 12 * 60) }, env, { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) });
  await Promise.all(background);
  eq(f.trips.slice(noonFiring).filter((t) => t.sqls.some((s) => /_attempts WHERE received_at/.test(s))).length, 0, "the prune runs only in the 03:00 ET firing");
}

{
  const f = fakeD1({ schema: null });
  const background = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("no network in this suite"); };
  try {
    await worker.scheduled({ cron: "*/30 * * * *", scheduledTime: easternInstant("2026-10-13", 3 * 60) }, { DB: f.D1, SESSION_SECRET }, { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) });
    await Promise.all(background);
  } finally { globalThis.fetch = realFetch; }
  ok(true, "a database with neither ledger table yet does not fail the housekeeping firing");
}

{
  const f = fakeD1({ schema: null });
  const env = { DB: f.D1, SESSION_SECRET, LAB_WRITE: limiter(1000) };
  const r = await call(env, { path: "/api/mastery", body: mastery(1) });
  eq(r.res.status, 200, "a database that predates the ledger creates it on first use");
  const idx = f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='mastery_attempts_by_received'").all();
  eq(idx.length, 1, "the first-use schema creates the received_at index for the review ledger");
  const s = await call(env, { path: "/api/v2/attempt", body: attempt(1) });
  eq(s.res.status, 200, "a database that predates the academy tables creates them on first use");
  eq(f.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='skill_attempts_by_received'").all().length, 1, "the first-use schema creates the received_at index for the skill ledger");
}

console.log(`✓ lab-write: ${checks} checks`);
